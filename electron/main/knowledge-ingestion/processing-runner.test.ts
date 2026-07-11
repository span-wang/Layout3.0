import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openRegistryDatabase, type RegistryDatabase } from './registry-database';
import { RegistryStore } from './registry-store';
import { ProcessingRunner } from './processing-runner';
import type { ProcessingArtifactSet } from './processing';
import type { PendingIndexRemote } from './pending-index-service';
import { RagflowError } from './ragflow/errors';
import type { RagflowDocument, RagflowMetadata } from './ragflow/types';
import { RegistryError } from './types';

const sourceHash = 'a'.repeat(64);
const bodyHash = 'b'.repeat(64);
const audit = { actorId: 'test:runner', reason: 'PH3-13C2 ProcessingRunner 定向验收' };

class MutableClock {
  constructor(private timestamp = Date.parse('2026-07-11T08:00:00.000Z')) {}

  now = (): Date => new Date(this.timestamp);

  advance(milliseconds: number): void {
    this.timestamp += milliseconds;
  }
}

class FakeArtifactService {
  readonly calls: string[] = [];

  async processVersion(input: {
    versionId: string;
    processingProfile?: string;
    signal?: AbortSignal;
  }): Promise<ProcessingArtifactSet> {
    if (input.signal?.aborted) throw new RegistryError('CANCELLED', 'fake 工件处理已取消。');
    this.calls.push(input.versionId);
    const common = {
      versionId: input.versionId,
      sourceHash,
      processingProfile: input.processingProfile ?? 'education-textbook-v1',
      toolName: 'fake-extractor',
      toolVersion: '1.0.0',
      lineage: {},
      createdAt: '2026-07-11T08:00:00.000Z',
      updatedAt: '2026-07-11T08:00:00.000Z',
    };
    return {
      versionId: input.versionId,
      sourceHash,
      processingProfile: common.processingProfile,
      reused: this.calls.length > 1,
      body: {
        ...common,
        artifactId: 'artifact-body',
        artifactType: 'extracted_text',
        relativePath: 'artifacts/fake/body.txt',
        absolutePath: 'C:\\managed\\artifacts\\fake\\body.txt',
        mediaType: 'text/plain; charset=utf-8',
        sizeBytes: 120,
        sha256: bodyHash,
      },
      locatorMap: {
        ...common,
        artifactId: 'artifact-locator',
        artifactType: 'locator_map',
        relativePath: 'artifacts/fake/locator-map.json',
        absolutePath: 'C:\\managed\\artifacts\\fake\\locator-map.json',
        mediaType: 'application/json; charset=utf-8',
        sizeBytes: 80,
        sha256: 'c'.repeat(64),
      },
      manifest: {
        ...common,
        artifactId: 'artifact-manifest',
        artifactType: 'manifest',
        relativePath: 'artifacts/fake/manifest.json',
        absolutePath: 'C:\\managed\\artifacts\\fake\\manifest.json',
        mediaType: 'application/json; charset=utf-8',
        sizeBytes: 90,
        sha256: 'd'.repeat(64),
      },
    };
  }
}

class FakeRagflowRemote implements PendingIndexRemote {
  readonly calls: string[] = [];
  existing = false;
  failure: RagflowError | null = null;
  metadata: RagflowMetadata = {};
  document: RagflowDocument = {
    id: 'doc-stage-1',
    name: '',
    run: 'UNSTART',
    chunk_count: 0,
  };

  async reconcileDocumentByExactName(_datasetId: string, remoteFileName: string) {
    this.calls.push('reconcile');
    if (this.failure) {
      const failure = this.failure;
      this.failure = null;
      throw failure;
    }
    this.document.name = remoteFileName;
    return this.existing
      ? { kind: 'existing' as const, remoteFileName, document: { ...this.document } }
      : { kind: 'missing' as const, remoteFileName };
  }

  async uploadDocument(input: { remoteFileName: string }) {
    this.calls.push('upload');
    this.existing = true;
    this.document.name = input.remoteFileName;
    return { ...this.document };
  }

  async patchDocumentMetadataAndVerify(input: { metadata: RagflowMetadata }) {
    this.calls.push('patch_metadata');
    this.metadata = input.metadata;
    this.document.meta_fields = input.metadata;
    return { ...this.document };
  }

  async verifyDocumentMetadata() {
    this.calls.push('verify_metadata');
    return { ...this.document, meta_fields: this.metadata };
  }

  async triggerParse() {
    this.calls.push('trigger_parse');
    this.document.run = 'RUNNING';
  }

  async waitForDocumentReady() {
    this.calls.push('wait_ready');
    this.document.run = 'DONE';
    this.document.chunk_count = 4;
    return { ...this.document };
  }
}

class FakeConfigStore {
  readonly config = {
    baseUrl: 'http://127.0.0.1:9380',
    apiKey: 'fake-secret',
    stagingDatasetId: 'dataset-stage',
    indexGeneration: 'staging-v1',
  };

  async getPrivateConfig() {
    return { ...this.config };
  }

  async assertStagingDataset(datasetId: string): Promise<void> {
    if (datasetId !== this.config.stagingDatasetId) {
      throw new RegistryError('REMOTE_AUTH_CONFIG', 'fake 暂存数据集不匹配。');
    }
  }
}

async function createContext(clock = new MutableClock()): Promise<{
  root: string;
  registry: RegistryDatabase;
  store: RegistryStore;
  clock: MutableClock;
  cleanup: () => void;
}> {
  const root = mkdtempSync(join(tmpdir(), 'layout3-runner-test-'));
  const registry = await openRegistryDatabase({
    databasePath: join(root, 'registry.sqlite'),
    backupDirectory: join(root, 'backups'),
    allowTestProcess: true,
    now: clock.now,
  });
  return {
    root,
    registry,
    store: new RegistryStore(registry, { now: clock.now }),
    clock,
    cleanup: () => {
      registry.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function seedVersion(
  store: RegistryStore,
  options: { versionId?: string; stage?: 'extraction' | 'upload'; maxAttempts?: number } = {},
): { versionId: string; jobId: string } {
  const versionId = options.versionId ?? 'ver-runner-1';
  const canonicalId = `mat-${versionId}`;
  store.createMaterial({
    canonicalId,
    stableTitle: 'Runner 测试资料',
    domain: '教育',
    audit,
  });
  store.createPublicationBranch({
    canonicalId,
    branchKey: 'default',
    branchType: 'default',
    displayName: '默认版本',
    isDefault: true,
    audit,
  });
  store.createMaterialVersion({
    versionId,
    canonicalId,
    publicationBranchKey: 'default',
    contentHash: sourceHash,
    metadataSchemaVersion: 'layout3_ingestion_v1',
    metadata: {
      stableTitle: 'Runner 测试资料',
      domain: '教育',
      subject: '语文',
      materialType: '讲义',
      language: '中文',
      educationStage: '初中',
      grade: '七年级',
      semester: '上学期',
      edition: '测试版',
      unit: '第一单元',
      parserProfile: 'education-textbook-v1',
    },
    parserProfile: 'education-textbook-v1',
    sourcePath: 'C:\\source\\runner.docx',
    managedSourcePath: 'C:\\managed\\runner.docx',
    audit,
  });
  store.transitionVersionState(versionId, { workflowStatus: 'pending_confirmation' }, audit);
  store.transitionVersionState(
    versionId,
    { workflowStatus: 'processing', processingHealth: 'processing' },
    audit,
  );
  const stage = options.stage ?? 'extraction';
  const job = store.enqueueJob({
    jobId: `job-${versionId}-${stage}`,
    versionId,
    stage,
    inputHash: stage === 'extraction' ? sourceHash : bodyHash,
    profileVersion: 'education-textbook-v1',
    maxAttempts: options.maxAttempts,
    audit,
  });
  return { versionId, jobId: job.jobId };
}

test('PH3-13C2 ProcessingRunner 完成 extraction→upload→parse_wait 并原子进入质量检查', async () => {
  const context = await createContext();
  const artifacts = new FakeArtifactService();
  const remote = new FakeRagflowRemote();
  const config = new FakeConfigStore();
  try {
    const { versionId } = seedVersion(context.store);
    const runner = new ProcessingRunner(context.store, artifacts, config, {
      workerId: 'worker-happy',
      now: context.clock.now,
      heartbeatIntervalMs: 5_000,
      remoteFactory: () => remote,
    });

    assert.equal(await runner.runNextJob(), true);
    assert.equal(await runner.runNextJob(), true);
    assert.equal(await runner.runNextJob(), true);
    assert.equal(await runner.runNextJob(), false);

    const jobs = context.store.listProcessingJobs(versionId);
    assert.equal(jobs.find((job) => job.stage === 'extraction')?.status, 'succeeded');
    assert.equal(jobs.find((job) => job.stage === 'upload')?.status, 'succeeded');
    assert.equal(jobs.find((job) => job.stage === 'parse_wait')?.status, 'succeeded');
    const version = context.store.getMaterialVersion(versionId);
    assert.equal(version.workflowStatus, 'quality_check');
    assert.equal(version.processingHealth, 'healthy');
    assert.equal(version.indexPublicationStatus, 'pending');
    assert.equal(version.errorMessage, null);
    const binding = context.store.findPendingBinding({
      versionId,
      indexGeneration: config.config.indexGeneration,
    });
    assert.equal(binding?.isHealthy, true);
    assert.equal(binding?.remoteRunStatus, 'DONE');
    assert.equal(binding?.chunkCount, 4);
    assert.equal(
      Number(context.registry.connection
        .prepare('SELECT COUNT(*) FROM material_publications WHERE version_id = ?')
        .pluck()
        .get(versionId)),
      0,
    );
    assert.equal(remote.metadata.metadata_schema, 'layout3_ingestion_v1');
    assert.equal(remote.metadata.status, 'pending');
    assert.equal(remote.metadata.version_id, versionId);
    assert.equal(remote.metadata.source_hash, sourceHash);
    assert.equal(remote.metadata.publication_branch_key, 'default');
    assert.equal(remote.calls.includes('upload'), true);
    assert.equal(remote.calls.includes('verify_metadata'), true);
    await runner.stop();
  } finally {
    context.cleanup();
  }
});

test('PH3-13C2 ProcessingRunner 对可重试远端错误写入确定性指数退避', async () => {
  const context = await createContext();
  const artifacts = new FakeArtifactService();
  const remote = new FakeRagflowRemote();
  const config = new FakeConfigStore();
  try {
    const { versionId, jobId } = seedVersion(context.store, { stage: 'upload' });
    remote.failure = new RagflowError({
      code: 'REMOTE_TRANSIENT',
      reason: 'RATE_LIMITED',
      message: 'fake 429',
      retryable: true,
      httpStatus: 429,
    });
    const runner = new ProcessingRunner(context.store, artifacts, config, {
      workerId: 'worker-retry',
      now: context.clock.now,
      retryBaseDelayMs: 2_000,
      retryMaxDelayMs: 30_000,
      heartbeatIntervalMs: 5_000,
      remoteFactory: () => remote,
    });

    assert.equal(await runner.runNextJob(), true);
    const failed = context.store.getProcessingJob(jobId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'REMOTE_TRANSIENT:RATE_LIMITED');
    assert.equal(failed.nextRetryAt, '2026-07-11T08:00:02.000Z');
    assert.equal(context.store.getMaterialVersion(versionId).processingHealth, 'processing');
    assert.equal(await runner.runNextJob(), false);

    context.clock.advance(2_000);
    assert.equal(await runner.runNextJob(), true);
    const retried = context.store.getProcessingJob(jobId);
    assert.equal(retried.status, 'succeeded');
    assert.equal(retried.attemptCount, 2);
    assert.equal(
      context.store.listProcessingJobs(versionId).some((job) => (
        job.stage === 'parse_wait' && job.status === 'queued'
      )),
      true,
    );
    await runner.stop();
  } finally {
    context.cleanup();
  }
});

test('PH3-13C2 ProcessingRunner 会在旧租约之后到期时周期恢复并继续任务', async () => {
  const context = await createContext();
  const artifacts = new FakeArtifactService();
  try {
    const { jobId } = seedVersion(context.store, { versionId: 'ver-recover' });
    context.store.claimNextJob({
      workerId: 'worker-before-crash',
      leaseDurationMs: 1_000,
      stages: ['extraction'],
      audit,
    });
    const runner = new ProcessingRunner(context.store, artifacts, new FakeConfigStore(), {
      workerId: 'worker-after-restart',
      now: context.clock.now,
      heartbeatIntervalMs: 500,
    });

    assert.equal(await runner.runNextJob(), false);
    context.clock.advance(1_001);
    assert.equal(await runner.runNextJob(), true);
    assert.equal(context.store.getProcessingJob(jobId).status, 'succeeded');
    assert.equal(context.store.getProcessingJob(jobId).attemptCount, 2);
    await runner.stop();
  } finally {
    context.cleanup();
  }
});

test('PH3-13C2 ProcessingRunner 停机时先中止工作并释放租约，不消耗业务尝试次数', async () => {
  const context = await createContext();
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const hangingArtifacts = {
    processVersion: ({ signal }: { signal?: AbortSignal }): Promise<ProcessingArtifactSet> => {
      notifyStarted();
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new RegistryError('CANCELLED', 'fake 长任务已因停机中止。'));
        }, { once: true });
      });
    },
  };
  try {
    const { jobId } = seedVersion(context.store, { versionId: 'ver-shutdown' });
    const runner = new ProcessingRunner(context.store, hangingArtifacts, new FakeConfigStore(), {
      workerId: 'worker-shutdown',
      now: context.clock.now,
      heartbeatIntervalMs: 500,
    });
    const running = runner.runNextJob();
    await started;
    await runner.stop();
    assert.equal(await running, true);

    const released = context.store.getProcessingJob(jobId);
    assert.equal(released.status, 'queued');
    assert.equal(released.attemptCount, 0);
    assert.equal(released.leaseOwner, null);
    assert.equal(
      context.store.listAuditEvents('processing_job', jobId)
        .some((event) => event.action === 'processing_job.released_for_shutdown'),
      true,
    );
  } finally {
    context.cleanup();
  }
});

test('PH3-13C2 ProcessingRunner 发现 running 任务的用户取消请求后会中止并原子确认', async () => {
  const context = await createContext();
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const hangingArtifacts = {
    processVersion: ({ signal }: { signal?: AbortSignal }): Promise<ProcessingArtifactSet> => {
      notifyStarted();
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new RegistryError('CANCELLED', 'fake 长任务已响应用户取消。'));
        }, { once: true });
      });
    },
  };
  try {
    const { versionId, jobId } = seedVersion(context.store, { versionId: 'ver-user-cancel' });
    const runner = new ProcessingRunner(context.store, hangingArtifacts, new FakeConfigStore(), {
      workerId: 'worker-user-cancel',
      now: context.clock.now,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 10,
    });
    const running = runner.runNextJob();
    await started;
    context.store.requestJobCancellation(jobId, audit);
    await Promise.race([
      running,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('等待 runner 响应用户取消超时。')), 1_000);
      }),
    ]);

    const cancelled = context.store.getProcessingJob(jobId);
    assert.equal(cancelled.status, 'cancelled');
    const version = context.store.getMaterialVersion(versionId);
    assert.equal(version.processingHealth, 'failed');
    assert.match(version.errorMessage ?? '', /取消/);
    await runner.stop();
  } finally {
    context.cleanup();
  }
});
