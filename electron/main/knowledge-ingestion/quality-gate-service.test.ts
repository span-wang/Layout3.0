import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ProcessingArtifactSet } from './processing';
import { ProcessingRunner } from './processing-runner';
import { QualityGateRepository } from './quality-gate-repository';
import { QualityGateService } from './quality-gate-service';
import type { QualityRetrievalRemoteCandidate } from './quality-retrieval-service';
import { RagflowError } from './ragflow/errors';
import { openRegistryDatabase, type RegistryDatabase } from './registry-database';
import { RegistryStore } from './registry-store';

const sourceHash = 'a'.repeat(64);
const parserProfile = 'education-textbook-v1';
const audit = { actorId: 'test:quality-service', reason: 'PH3-13C3 质量执行服务验收' };

class FixedClock {
  constructor(private timestamp = Date.parse('2026-07-11T08:00:00.000Z')) {}

  now = (): Date => new Date(this.timestamp);

  advance(milliseconds: number): void {
    this.timestamp += milliseconds;
  }
}

class FakeConfigStore {
  readonly config = {
    baseUrl: 'http://127.0.0.1:9380',
    apiKey: 'fake-secret',
    stagingDatasetId: 'dataset-staging',
    indexGeneration: 'generation-staging-1',
  };

  async getPrivateConfig() {
    return { ...this.config };
  }

  async getProtectedDatasetIds(): Promise<string[]> {
    return [this.config.stagingDatasetId];
  }

  async assertStagingDataset(datasetId: string): Promise<void> {
    assert.equal(datasetId, this.config.stagingDatasetId);
  }
}

class FakeQualityRemote {
  mode: 'success' | 'zero' | 'outside' = 'success';
  readonly calls: string[] = [];

  async retrieveCandidates(input: {
    question: string;
    datasetIds: string[];
    documentIds: string[];
    signal?: AbortSignal;
  }): Promise<QualityRetrievalRemoteCandidate[]> {
    this.calls.push(input.question);
    if (input.signal?.aborted) throw new Error('fake cancelled');
    if (this.mode === 'zero') return [];
    const evidence = input.question.includes('第一')
      ? '第一条唯一正文证据。'
      : input.question.includes('第二')
        ? '第二条唯一正文证据。'
        : '第三条唯一正文证据。';
    return [{
      chunkId: `chunk-${this.calls.length}`,
      content: `上下文 ${evidence} 后续内容`,
      datasetId: this.mode === 'outside' ? 'dataset-outside' : input.datasetIds[0]!,
      documentId: input.documentIds[0]!,
      similarity: 0.92,
    }];
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function createContext(): Promise<{
  root: string;
  registry: RegistryDatabase;
  store: RegistryStore;
  repository: QualityGateRepository;
  artifacts: ProcessingArtifactSet;
  clock: FixedClock;
  cleanup(): void;
}> {
  const root = mkdtempSync(join(tmpdir(), 'layout3-quality-service-test-'));
  const clock = new FixedClock();
  const registry = await openRegistryDatabase({
    databasePath: join(root, 'registry.sqlite'),
    backupDirectory: join(root, 'backups'),
    allowTestProcess: true,
    now: clock.now,
  });
  const store = new RegistryStore(registry, { now: clock.now });
  const repository = new QualityGateRepository(registry, { now: clock.now });
  store.createMaterial({
    canonicalId: 'mat-quality-service',
    stableTitle: '质量执行测试资料',
    domain: '教育',
    audit,
  });
  store.createPublicationBranch({
    canonicalId: 'mat-quality-service',
    branchKey: 'default',
    branchType: 'default',
    displayName: '默认分支',
    isDefault: true,
    audit,
  });
  store.createMaterialVersion({
    versionId: 'ver-quality-service',
    canonicalId: 'mat-quality-service',
    publicationBranchKey: 'default',
    contentHash: sourceHash,
    metadataSchemaVersion: 'layout3_ingestion_v1',
    metadata: {
      stableTitle: '质量执行测试资料',
      domain: '教育',
      subject: '语文',
      materialType: '讲义',
      language: '中文',
      parserProfile,
    },
    parserProfile,
    audit,
  });
  store.transitionVersionState('ver-quality-service', { workflowStatus: 'pending_confirmation' }, audit);
  store.transitionVersionState(
    'ver-quality-service',
    { workflowStatus: 'processing', processingHealth: 'processing' },
    audit,
  );

  const bodyText = '第一条唯一正文证据。\n第二条唯一正文证据。\n第三条唯一正文证据。\n';
  const bodyPath = join(root, 'body.txt');
  const locatorPath = join(root, 'locator.json');
  const manifestPath = join(root, 'manifest.json');
  writeFileSync(bodyPath, bodyText, 'utf8');
  const locatorText = JSON.stringify({
    schemaVersion: 'layout3_locator_v1',
    sourceFormat: 'docx',
    sourceHash,
    offsetEncoding: 'utf16-code-unit',
    physicalPageNumbersAvailable: false,
    blocks: [{
      blockId: 'paragraph-1',
      blockType: 'paragraph',
      startOffset: 0,
      endOffset: bodyText.length,
      headingPath: ['测试章节'],
      headingLevel: null,
      paragraphNumber: 1,
      tableNumber: null,
      rowCount: null,
      columnCount: null,
      explicitPageBreaks: [],
    }],
  });
  const manifestText = '{}';
  writeFileSync(locatorPath, locatorText, 'utf8');
  writeFileSync(manifestPath, manifestText, 'utf8');
  const timestamp = clock.now().toISOString();
  const common = {
    versionId: 'ver-quality-service',
    sourceHash,
    processingProfile: parserProfile,
    toolName: 'fake-extractor',
    toolVersion: '1.0.0',
    lineage: { schemaVersion: 'layout3_lineage_v1', artifactSetKey: 'quality-service-set' },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const artifacts: ProcessingArtifactSet = {
    versionId: common.versionId,
    sourceHash,
    processingProfile: parserProfile,
    reused: true,
    body: {
      ...common,
      artifactId: 'artifact-quality-body',
      artifactType: 'extracted_text',
      relativePath: 'body.txt',
      absolutePath: bodyPath,
      mediaType: 'text/plain; charset=utf-8',
      sizeBytes: Buffer.byteLength(bodyText),
      sha256: sha256(bodyText),
    },
    locatorMap: {
      ...common,
      artifactId: 'artifact-quality-locator',
      artifactType: 'locator_map',
      relativePath: 'locator.json',
      absolutePath: locatorPath,
      mediaType: 'application/json; charset=utf-8',
      sizeBytes: Buffer.byteLength(locatorText),
      sha256: sha256(locatorText),
    },
    manifest: {
      ...common,
      artifactId: 'artifact-quality-manifest',
      artifactType: 'manifest',
      relativePath: 'manifest.json',
      absolutePath: manifestPath,
      mediaType: 'application/json; charset=utf-8',
      sizeBytes: 2,
      sha256: sha256(manifestText),
    },
  };
  const insertArtifact = registry.connection.prepare(`
    INSERT INTO processing_artifacts (
      artifact_id, version_id, artifact_type, relative_path, media_type, size_bytes,
      sha256, source_hash, processing_profile, tool_name, tool_version, lineage_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const artifact of [artifacts.body, artifacts.locatorMap, artifacts.manifest]) {
    insertArtifact.run(
      artifact.artifactId,
      artifact.versionId,
      artifact.artifactType,
      artifact.relativePath,
      artifact.mediaType,
      artifact.sizeBytes,
      artifact.sha256,
      artifact.sourceHash,
      artifact.processingProfile,
      artifact.toolName,
      artifact.toolVersion,
      JSON.stringify(artifact.lineage),
      artifact.createdAt,
      artifact.updatedAt,
    );
  }
  store.ensureUnhealthyPendingBinding({
    bindingId: 'binding-quality-service',
    versionId: 'ver-quality-service',
    indexGeneration: 'generation-staging-1',
    datasetId: 'dataset-staging',
    documentId: 'document-quality-service',
    audit,
  });
  store.markPendingBindingHealthy({
    versionId: 'ver-quality-service',
    indexGeneration: 'generation-staging-1',
    datasetId: 'dataset-staging',
    documentId: 'document-quality-service',
    chunkCount: 6,
    lastVerifiedAt: timestamp,
    audit,
  });
  return {
    root,
    registry,
    store,
    repository,
    artifacts,
    clock,
    cleanup: () => {
      registry.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function qualityQuestions() {
  return [
    { question: '第一条资料的要求是什么？', evidence: '第一条唯一正文证据。' },
    { question: '第二条资料的要求是什么？', evidence: '第二条唯一正文证据。' },
    { question: '第三条资料的要求是什么？', evidence: '第三条唯一正文证据。' },
  ];
}

function createArtifactService(
  context: Awaited<ReturnType<typeof createContext>>,
  listArtifacts = () => [context.artifacts.body, context.artifacts.locatorMap, context.artifacts.manifest],
) {
  return {
    processVersion: async () => context.artifacts,
    listArtifacts,
  };
}

test('PH3-13C3 QualityGateService 通过 runner 完成 Top 10、证据、零泄漏和原子待发布', async () => {
  const context = await createContext();
  const remote = new FakeQualityRemote();
  const config = new FakeConfigStore();
  const artifactService = createArtifactService(context);
  try {
    const service = new QualityGateService(
      context.repository,
      context.store,
      artifactService,
      config,
      { now: context.clock.now, remoteFactory: () => remote },
    );
    const created = await service.createRun({
      versionId: 'ver-quality-service',
      questions: qualityQuestions(),
    });
    const runner = new ProcessingRunner(context.store, artifactService, config, {
      workerId: 'worker-quality-service-pass',
      now: context.clock.now,
      heartbeatIntervalMs: 5_000,
      qualityExecutor: service,
    });

    assert.equal(await runner.runNextJob(), true);
    assert.equal(context.repository.getRun(created.run.qualityRunId).status, 'passed');
    assert.equal(context.store.getProcessingJob(created.job.jobId).status, 'succeeded');
    const version = context.store.getMaterialVersion('ver-quality-service');
    assert.equal(version.workflowStatus, 'pending_publication');
    assert.equal(version.processingHealth, 'healthy');
    assert.equal(version.indexPublicationStatus, 'pending');
    const results = context.repository.listResults(created.run.qualityRunId);
    assert.equal(results.filter((result) => result.blockingLevel === 'blocking').every((result) => result.passed), true);
    assert.equal(results.some((result) => result.resultKey === 'formal_zero_leak'), true);
    assert.equal(remote.calls.length, 3);
    await runner.stop();
  } finally {
    context.cleanup();
  }
});

test('PH3-13C3 execute 会重新读取三工件，删除、篡改或快照元数据漂移均隔离且不请求远端', async (t) => {
  const cases: Array<{
    name: string;
    mutate(context: Awaited<ReturnType<typeof createContext>>): void;
    createArtifactService?(context: Awaited<ReturnType<typeof createContext>>): ReturnType<typeof createArtifactService>;
  }> = [
    {
      name: '正文工件被篡改',
      mutate(context) {
        writeFileSync(context.artifacts.body.absolutePath, '已被篡改的正文', 'utf8');
      },
    },
    {
      name: '来源定位工件被删除',
      mutate(context) {
        rmSync(context.artifacts.locatorMap.absolutePath, { force: true });
      },
    },
    {
      name: '类型、sourceHash、profile 与工具版本发生漂移',
      mutate() {},
      createArtifactService(context) {
        return createArtifactService(context, () => [
          {
            ...context.artifacts.body,
            artifactType: 'manifest',
            sourceHash: 'f'.repeat(64),
            processingProfile: 'drift-profile',
            toolVersion: '9.9.9',
          },
          context.artifacts.locatorMap,
          context.artifacts.manifest,
        ]);
      },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const context = await createContext();
      const remote = new FakeQualityRemote();
      const config = new FakeConfigStore();
      const artifactService = entry.createArtifactService?.(context) ?? createArtifactService(context);
      try {
        const service = new QualityGateService(
          context.repository,
          context.store,
          artifactService,
          config,
          { now: context.clock.now, remoteFactory: () => remote },
        );
        const created = await service.createRun({
          versionId: 'ver-quality-service',
          questions: qualityQuestions(),
        });
        entry.mutate(context);
        const runner = new ProcessingRunner(context.store, artifactService, config, {
          workerId: `worker-artifact-${entry.name}`,
          now: context.clock.now,
          heartbeatIntervalMs: 5_000,
          qualityExecutor: service,
        });

        assert.equal(await runner.runNextJob(), true);
        assert.equal(context.repository.getRun(created.run.qualityRunId).status, 'blocked');
        assert.equal(context.store.getProcessingJob(created.job.jobId).status, 'succeeded');
        assert.equal(context.store.getMaterialVersion('ver-quality-service').workflowStatus, 'quarantined');
        assert.equal(remote.calls.length, 0);
        const artifactResult = context.repository.listResults(created.run.qualityRunId)
          .find((result) => result.resultKey === 'artifacts_complete');
        assert.equal(artifactResult?.passed, false);
        await runner.stop();
      } finally {
        context.cleanup();
      }
    });
  }
});

test('PH3-13C3 同一 run 远端退避重试时以当前 attempt 覆盖旧结果', async () => {
  const context = await createContext();
  const config = new FakeConfigStore();
  const artifactService = createArtifactService(context);
  let retryStarted = false;
  const calls: string[] = [];
  const remote = {
    async retrieveCandidates(input: {
      question: string;
      datasetIds: string[];
      documentIds: string[];
    }): Promise<QualityRetrievalRemoteCandidate[]> {
      calls.push(input.question);
      if (!retryStarted && input.question.includes('第二')) {
        retryStarted = true;
        throw new RagflowError({
          code: 'REMOTE_TRANSIENT',
          reason: 'RATE_LIMITED',
          message: 'fake 远端限流',
          retryable: true,
        });
      }
      if (retryStarted && input.question.includes('第一')) {
        return [];
      }
      const evidence = input.question.includes('第一')
        ? '第一条唯一正文证据。'
        : input.question.includes('第二')
          ? '第二条唯一正文证据。'
          : '第三条唯一正文证据。';
      return [{
        chunkId: `chunk-stateful-${calls.length}`,
        content: evidence,
        datasetId: input.datasetIds[0]!,
        documentId: input.documentIds[0]!,
      }];
    },
  };
  try {
    const service = new QualityGateService(
      context.repository,
      context.store,
      artifactService,
      config,
      { now: context.clock.now, remoteFactory: () => remote },
    );
    const created = await service.createRun({
      versionId: 'ver-quality-service',
      questions: qualityQuestions(),
    });
    const runner = new ProcessingRunner(context.store, artifactService, config, {
      workerId: 'worker-quality-retry-results',
      now: context.clock.now,
      heartbeatIntervalMs: 5_000,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 1_000,
      qualityExecutor: service,
    });

    assert.equal(await runner.runNextJob(), true);
    assert.equal(context.repository.getRun(created.run.qualityRunId).status, 'queued');
    assert.equal(
      context.repository.listResults(created.run.qualityRunId)
        .find((result) => result.resultKey.endsWith(':candidate_top10'))?.passed,
      true,
    );

    context.clock.advance(1_000);
    assert.equal(await runner.runNextJob(), true);
    assert.equal(context.repository.getRun(created.run.qualityRunId).status, 'blocked');
    assert.equal(context.store.getMaterialVersion('ver-quality-service').workflowStatus, 'quarantined');
    const firstQuestionKey = created.run.questionsSnapshot[0]!.questionKey;
    const currentResults = context.repository.listResults(created.run.qualityRunId)
      .filter((result) => result.resultKey === `${firstQuestionKey}:candidate_top10`);
    assert.equal(currentResults.length, 1);
    assert.equal(currentResults[0]?.passed, false);
    await runner.stop();
  } finally {
    context.cleanup();
  }
});

test('PH3-13C3 时钟跨过租约且 heartbeat 尚未恢复时 runner 会先恢复再继续', async () => {
  const context = await createContext();
  const remote = new FakeQualityRemote();
  const originalRetrieve = remote.retrieveCandidates.bind(remote);
  let advancedPastLease = false;
  remote.retrieveCandidates = async (input) => {
    const candidates = await originalRetrieve(input);
    if (!advancedPastLease) {
      advancedPastLease = true;
      // 模拟系统休眠或事件循环长停顿：业务回调先恢复，heartbeat 尚未来得及续租。
      context.clock.advance(1_001);
    }
    return candidates;
  };
  const config = new FakeConfigStore();
  const artifactService = createArtifactService(context);
  try {
    const service = new QualityGateService(
      context.repository,
      context.store,
      artifactService,
      config,
      { now: context.clock.now, remoteFactory: () => remote },
    );
    const created = await service.createRun({
      versionId: 'ver-quality-service',
      questions: qualityQuestions(),
    });
    const runner = new ProcessingRunner(context.store, artifactService, config, {
      workerId: 'worker-quality-lease-resume',
      now: context.clock.now,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 500,
      qualityExecutor: service,
    });

    assert.equal(await runner.runNextJob(), true);
    assert.equal(context.store.getProcessingJob(created.job.jobId).status, 'running');
    assert.equal(context.repository.getRun(created.run.qualityRunId).status, 'running');

    assert.equal(await runner.runNextJob(), true);
    assert.equal(context.store.getProcessingJob(created.job.jobId).status, 'succeeded');
    assert.equal(context.repository.getRun(created.run.qualityRunId).status, 'passed');
    assert.equal(context.store.getMaterialVersion('ver-quality-service').workflowStatus, 'pending_publication');
    await runner.stop();
  } finally {
    context.cleanup();
  }
});

test('PH3-13C3 候选零结果会成功执行检查但将版本隔离，不误判为技术失败', async () => {
  const context = await createContext();
  const remote = new FakeQualityRemote();
  remote.mode = 'zero';
  const config = new FakeConfigStore();
  const artifactService = createArtifactService(context);
  try {
    const service = new QualityGateService(
      context.repository,
      context.store,
      artifactService,
      config,
      { now: context.clock.now, remoteFactory: () => remote },
    );
    const created = await service.createRun({
      versionId: 'ver-quality-service',
      questions: qualityQuestions(),
    });
    const runner = new ProcessingRunner(context.store, artifactService, config, {
      workerId: 'worker-quality-service-zero',
      now: context.clock.now,
      heartbeatIntervalMs: 5_000,
      qualityExecutor: service,
    });

    assert.equal(await runner.runNextJob(), true);
    assert.equal(context.repository.getRun(created.run.qualityRunId).status, 'blocked');
    assert.equal(context.store.getProcessingJob(created.job.jobId).status, 'succeeded');
    assert.equal(context.store.getMaterialVersion('ver-quality-service').workflowStatus, 'quarantined');
    await runner.stop();
  } finally {
    context.cleanup();
  }
});

test('PH3-13C3 scope 外候选先记录阻断结果，再由执行服务原子隔离', async () => {
  const context = await createContext();
  const remote = new FakeQualityRemote();
  remote.mode = 'outside';
  const config = new FakeConfigStore();
  const artifactService = createArtifactService(context);
  try {
    const service = new QualityGateService(
      context.repository,
      context.store,
      artifactService,
      config,
      { now: context.clock.now, remoteFactory: () => remote },
    );
    const created = await service.createRun({
      versionId: 'ver-quality-service',
      questions: qualityQuestions(),
    });
    const runner = new ProcessingRunner(context.store, artifactService, config, {
      workerId: 'worker-quality-service-outside',
      now: context.clock.now,
      heartbeatIntervalMs: 5_000,
      qualityExecutor: service,
    });

    assert.equal(await runner.runNextJob(), true);
    assert.equal(context.repository.getRun(created.run.qualityRunId).status, 'blocked');
    assert.equal(
      context.repository.listResults(created.run.qualityRunId)
        .some((result) => result.checkKey === 'candidate_scope_contract' && !result.passed),
      true,
    );
    assert.equal(context.store.getMaterialVersion('ver-quality-service').workflowStatus, 'quarantined');
    await runner.stop();
  } finally {
    context.cleanup();
  }
});
