import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessingRunner } from './processing-runner';
import { IntakeStore } from './intake-store';
import { PublicationOperationRepository } from './publication-operation-repository';
import { PublicationService } from './publication-service';
import { QualityGateRepository } from './quality-gate-repository';
import { RagflowIngestionConfigStore } from './ragflow-config-store';
import { RagflowError } from './ragflow/errors';
import type {
  RagflowDocument,
  RagflowMetadata,
  RagflowRetrievalCandidate,
  RagflowRetrievalInput,
} from './ragflow/types';
import { openRegistryDatabase, type RegistryDatabase } from './registry-database';
import { RegistryStore } from './registry-store';
import { RegistryError, type QualityQuestionSnapshot } from './types';

const audit = { actorId: 'test:publication-service', reason: 'PH3-13C4 发布服务自动验收' };

function createClock(initial = '2026-07-11T00:00:00.000Z') {
  let current = Date.parse(initial);
  return {
    now: () => new Date(current),
    advance: (milliseconds: number) => {
      current += milliseconds;
    },
  };
}

function createIdFactory(): (prefix: string) => string {
  let sequence = 0;
  return (prefix) => `${prefix}_publication_service_test_${++sequence}`;
}

function question(index: number, evidence: string): QualityQuestionSnapshot {
  return {
    questionKey: `question-${index}`,
    question: `第 ${index} 条发布问题是什么？`,
    evidenceExcerpt: evidence,
    evidenceSha256: createHash('sha256').update(evidence, 'utf8').digest('hex'),
    startOffset: index * 10,
    endOffset: index * 10 + evidence.length,
    locatorLabel: `段落 ${index}`,
  };
}

const questions = [
  question(1, '第一条发布唯一证据'),
  question(2, '第二条发布唯一证据'),
  question(3, '第三条发布唯一证据'),
];

class FakePublicationRemote {
  readonly statuses = new Map<string, string>();
  readonly patches: Array<{ documentId: string; status: string }> = [];
  zeroResults = false;
  failSupersededOnce = false;

  constructor(private readonly contents: Map<string, string>) {}

  async patchDocumentMetadataAndVerify(input: {
    datasetId: string;
    documentId: string;
    metadata: RagflowMetadata;
  }): Promise<RagflowDocument> {
    const status = String(input.metadata.status ?? '');
    if (status === 'superseded' && this.failSupersededOnce) {
      this.failSupersededOnce = false;
      throw new RagflowError({
        code: 'REMOTE_TRANSIENT',
        reason: 'SERVER_ERROR',
        message: '模拟旧版 superseded 暂时失败。',
        retryable: true,
      });
    }
    this.statuses.set(input.documentId, status);
    this.patches.push({ documentId: input.documentId, status });
    return {
      id: input.documentId,
      name: `${input.documentId}.txt`,
      run: 'DONE',
      chunk_count: 6,
      meta_fields: input.metadata,
    };
  }

  async retrieveCandidates(input: RagflowRetrievalInput): Promise<RagflowRetrievalCandidate[]> {
    if (this.zeroResults) return [];
    const documentId = input.documentIds[0]!;
    return [{
      chunkId: `chunk-${documentId}`,
      content: this.contents.get(documentId) ?? '',
      datasetId: input.datasetIds[0]!,
      documentId,
      similarity: 0.99,
    }];
  }
}

async function withContext(
  run: (context: Awaited<ReturnType<typeof createContext>>) => Promise<void> | void,
): Promise<void> {
  const context = await createContext();
  try {
    await run(context);
  } finally {
    context.registry.close();
    rmSync(context.root, { recursive: true, force: true });
  }
}

async function createContext() {
  const root = mkdtempSync(join(tmpdir(), 'layout3-publication-service-test-'));
  const clock = createClock();
  const createId = createIdFactory();
  const registry = await openRegistryDatabase({
    databasePath: join(root, 'registry.sqlite'),
    backupDirectory: join(root, 'backups'),
    now: clock.now,
    allowTestProcess: true,
  });
  const store = new RegistryStore(registry, { now: clock.now, createId });
  const quality = new QualityGateRepository(registry, { now: clock.now, createId });
  const operations = new PublicationOperationRepository(registry, { now: clock.now, createId });
  const cipher = {
    isAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
  };
  const config = new RagflowIngestionConfigStore(join(root, 'ragflow.json'), cipher, clock.now);
  await config.save({
    baseUrl: 'http://127.0.0.1:9380',
    apiKey: 'publication-key',
    stagingDatasetId: 'dataset-publication',
    indexGeneration: 'generation-publication',
  });
  const contents = new Map<string, string>();
  const remote = new FakePublicationRemote(contents);
  const service = new PublicationService(
    registry,
    operations,
    store,
    quality,
    config,
    { now: clock.now, createId, remoteFactory: () => remote },
  );
  const runner = new ProcessingRunner(
    store,
    { processVersion: async () => { throw new Error('发布测试不应执行抽取。'); } },
    config,
    {
      workerId: 'worker-publication-service',
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 10_000,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 100,
      now: clock.now,
      publicationExecutor: service,
    },
  );
  return { root, registry, store, quality, operations, config, service, runner, remote, contents, clock };
}

function seedArtifacts(registry: RegistryDatabase, versionId: string, sourceHash: string): void {
  const timestamp = '2026-07-11T00:00:00.000Z';
  const insert = registry.connection.prepare(`
    INSERT INTO processing_artifacts (
      artifact_id, version_id, artifact_type, relative_path, media_type, size_bytes,
      sha256, source_hash, processing_profile, tool_name, tool_version,
      lineage_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 100, ?, ?, 'education-textbook-v1',
      'layout3-basic-extractor', '1.0.0', '{}', ?, ?)
  `);
  for (const [type, suffix] of [
    ['extracted_text', 'body'],
    ['locator_map', 'locator'],
    ['manifest', 'manifest'],
  ] as const) {
    insert.run(
      `${versionId}-${suffix}`,
      versionId,
      type,
      `${versionId}/${suffix}.json`,
      type === 'extracted_text' ? 'text/plain' : 'application/json',
      createHash('sha256').update(`${versionId}-${suffix}`).digest('hex'),
      sourceHash,
      timestamp,
      timestamp,
    );
  }
}

function seedIntakeItem(
  registry: RegistryDatabase,
  versionId: string,
  contentHash: string,
): string {
  const itemId = `intake-${versionId}`;
  const timestamp = '2026-07-11T00:00:00.000Z';
  registry.connection.transaction(() => {
    registry.connection.prepare(`
      INSERT INTO intake_batches (batch_id, source_type, status, item_count, created_at, updated_at)
      VALUES (?, 'single_file', 'completed', 1, ?, ?)
    `).run(`batch-${versionId}`, timestamp, timestamp);
    registry.connection.prepare(`
      INSERT INTO source_occurrences (
        occurrence_id, version_id, source_path, file_name, content_hash, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `occurrence-${versionId}`,
      versionId,
      `C:\\test\\${versionId}.docx`,
      `${versionId}.docx`,
      contentHash,
      timestamp,
    );
    registry.connection.prepare(`
      INSERT INTO intake_items (
        item_id, batch_id, version_id, occurrence_id, original_file_name,
        file_extension, file_size_bytes, content_hash, intake_status,
        duplicate_of_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '.docx', 128, ?, 'processing', NULL, ?, ?)
    `).run(
      itemId,
      `batch-${versionId}`,
      versionId,
      `occurrence-${versionId}`,
      `${versionId}.docx`,
      contentHash,
      timestamp,
      timestamp,
    );
  })();
  return itemId;
}

function createQualityPassedVersion(
  context: Awaited<ReturnType<typeof createContext>>,
  input: {
    versionId: string;
    contentHash: string;
    documentId: string;
    createMaterial?: boolean;
  },
): void {
  if (input.createMaterial ?? false) {
    context.store.createMaterial({
      canonicalId: 'mat-publication-service',
      stableTitle: '发布服务测试资料',
      domain: 'education',
      audit,
    });
    context.store.createPublicationBranch({
      canonicalId: 'mat-publication-service',
      branchKey: 'default',
      branchType: 'default',
      displayName: '默认版本',
      isDefault: true,
      audit,
    });
  }
  context.store.createMaterialVersion({
    versionId: input.versionId,
    canonicalId: 'mat-publication-service',
    publicationBranchKey: 'default',
    contentHash: input.contentHash,
    metadata: {
      stableTitle: '发布服务测试资料',
      domain: '教育',
      subject: '英语',
      materialType: '讲义',
      language: '中文',
      parserProfile: 'education-textbook-v1',
    },
    parserProfile: 'education-textbook-v1',
    audit,
  });
  context.store.transitionVersionState(input.versionId, { workflowStatus: 'pending_confirmation' }, audit);
  context.store.transitionVersionState(
    input.versionId,
    { workflowStatus: 'processing', processingHealth: 'processing' },
    audit,
  );
  seedArtifacts(context.registry, input.versionId, input.contentHash);
  context.store.ensureUnhealthyPendingBinding({
    bindingId: `binding-${input.versionId}`,
    versionId: input.versionId,
    indexGeneration: 'generation-publication',
    datasetId: 'dataset-publication',
    documentId: input.documentId,
    audit,
  });
  context.store.markPendingBindingHealthy({
    versionId: input.versionId,
    indexGeneration: 'generation-publication',
    datasetId: 'dataset-publication',
    documentId: input.documentId,
    chunkCount: 6,
    lastVerifiedAt: context.clock.now().toISOString(),
    audit,
  });
  const created = context.quality.createRun({
    versionId: input.versionId,
    questions,
    requiredBlockingResultKeys: ['publication-ready'],
    inputHash: `quality-${input.versionId}`,
    profileVersion: 'education-textbook-v1',
    inputSnapshot: { schemaVersion: 'test' },
    profileSnapshot: { schemaVersion: 'test' },
    configSnapshot: {
      baseUrl: 'http://127.0.0.1:9380',
      stagingDatasetId: 'dataset-publication',
      indexGeneration: 'generation-publication',
    },
    expiresAt: new Date(context.clock.now().getTime() + 60 * 60_000).toISOString(),
    audit,
  });
  const claimed = context.store.claimNextJob({
    workerId: `worker-quality-${input.versionId}`,
    leaseDurationMs: 60_000,
    stages: ['quality'],
    audit,
  });
  assert.equal(claimed?.jobId, created.job.jobId);
  context.quality.startRun({
    qualityRunId: created.run.qualityRunId,
    workerId: `worker-quality-${input.versionId}`,
    audit,
  });
  context.quality.recordResult({
    qualityRunId: created.run.qualityRunId,
    workerId: `worker-quality-${input.versionId}`,
    checkKey: 'publication',
    resultKey: 'publication-ready',
    blockingLevel: 'blocking',
    passed: true,
    threshold: { required: true },
    actual: { passed: true },
    evidence: { message: '测试质量结论已通过' },
    audit,
  });
  context.quality.finalizePassed({
    qualityRunId: created.run.qualityRunId,
    workerId: `worker-quality-${input.versionId}`,
    audit,
  });
  context.contents.set(input.documentId, questions.map((item) => item.evidenceExcerpt).join('\n'));
  context.remote.statuses.set(input.documentId, 'pending');
}

test('PH3-13C4 首次发布、同分支替代与回滚只切换 SQLite 精确 active scope', async () => {
  await withContext(async (context) => {
    createQualityPassedVersion(context, {
      versionId: 'ver-publication-v1',
      contentHash: 'a'.repeat(64),
      documentId: 'document-publication-v1',
      createMaterial: true,
    });
    await context.service.createPublishOperation({ versionId: 'ver-publication-v1' });
    assert.equal(await context.runner.runNextJob(), true);
    assert.equal(context.store.getMaterialVersion('ver-publication-v1').workflowStatus, 'published');
    assert.deepEqual(
      context.store.resolveActivePublicationScope({
        canonicalId: 'mat-publication-service',
        publicationBranchKey: 'default',
      }).documentIds,
      ['document-publication-v1'],
    );

    createQualityPassedVersion(context, {
      versionId: 'ver-publication-v2',
      contentHash: 'b'.repeat(64),
      documentId: 'document-publication-v2',
    });
    await context.service.createPublishOperation({ versionId: 'ver-publication-v2' });
    assert.equal(await context.runner.runNextJob(), true);
    assert.equal(context.store.getMaterialVersion('ver-publication-v1').workflowStatus, 'superseded');
    assert.equal(context.store.getMaterialVersion('ver-publication-v2').workflowStatus, 'published');
    assert.equal(context.remote.statuses.get('document-publication-v1'), 'superseded');
    assert.deepEqual(
      context.store.resolveActivePublicationScope({
        canonicalId: 'mat-publication-service',
        publicationBranchKey: 'default',
      }).documentIds,
      ['document-publication-v2'],
    );

    const intakeItemId = seedIntakeItem(context.registry, 'ver-publication-v2', 'b'.repeat(64));
    const rendererItem = new IntakeStore(context.registry, { now: context.clock.now }).getItem(intakeItemId);
    assert.equal(rendererItem.publication.canRollback, true);
    assert.equal(rendererItem.lifecycle.qualitySummary.conclusion, '最近一次快速质量门禁已通过。');
    const rollbackOperation = await context.service.createRollbackOperation({
      currentVersionId: 'ver-publication-v2',
      reason: '新版存在内容问题，恢复上一版。',
    });
    assert.equal(rollbackOperation.inputSnapshot.reason, '新版存在内容问题，恢复上一版。');
    assert.equal(await context.runner.runNextJob(), true);
    assert.equal(context.store.getMaterialVersion('ver-publication-v1').workflowStatus, 'published');
    assert.equal(context.store.getMaterialVersion('ver-publication-v2').workflowStatus, 'quarantined');
    assert.equal(context.remote.statuses.get('document-publication-v1'), 'active');
    assert.equal(context.remote.statuses.get('document-publication-v2'), 'superseded');
    const rolledBackItem = new IntakeStore(context.registry, { now: context.clock.now }).getItem(intakeItemId);
    assert.equal(rolledBackItem.lifecycle.workflowStatus, 'quarantined');
    assert.equal(rolledBackItem.lifecycle.qualitySummary.conclusion, '最近一次快速质量门禁已通过。');
    assert.match(rolledBackItem.publication.operationMessage, /问题版本已隔离/);
    assert.deepEqual(
      context.store.resolveActivePublicationScope({
        canonicalId: 'mat-publication-service',
        publicationBranchKey: 'default',
      }).documentIds,
      ['document-publication-v1'],
    );
    assert.equal(context.operations.listOpenOperations().length, 0);
  });
});

test('PH3-13C4 回滚在建档前拒绝不健康旧版与已存在更高版本的分支', async () => {
  await withContext(async (context) => {
    createQualityPassedVersion(context, {
      versionId: 'ver-rollback-guard-v1',
      contentHash: '1'.repeat(64),
      documentId: 'document-rollback-guard-v1',
      createMaterial: true,
    });
    await context.service.createPublishOperation({ versionId: 'ver-rollback-guard-v1' });
    assert.equal(await context.runner.runNextJob(), true);
    createQualityPassedVersion(context, {
      versionId: 'ver-rollback-guard-v2',
      contentHash: '2'.repeat(64),
      documentId: 'document-rollback-guard-v2',
    });
    await context.service.createPublishOperation({ versionId: 'ver-rollback-guard-v2' });
    assert.equal(await context.runner.runNextJob(), true);

    context.registry.connection.prepare(`
      UPDATE material_versions
      SET processing_health = 'failed'
      WHERE version_id = 'ver-rollback-guard-v1'
    `).run();
    await assert.rejects(
      context.service.createRollbackOperation({
        currentVersionId: 'ver-rollback-guard-v2',
        reason: '验证不健康旧版必须失败关闭。',
      }),
      (error) => error instanceof RegistryError && error.code === 'PUBLICATION_PRECONDITION_FAILED',
    );
    context.registry.connection.prepare(`
      UPDATE material_versions
      SET processing_health = 'healthy'
      WHERE version_id = 'ver-rollback-guard-v1'
    `).run();

    context.store.createMaterialVersion({
      versionId: 'ver-rollback-guard-v3',
      canonicalId: 'mat-publication-service',
      publicationBranchKey: 'default',
      contentHash: '3'.repeat(64),
      audit,
    });
    await assert.rejects(
      context.service.createRollbackOperation({
        currentVersionId: 'ver-rollback-guard-v2',
        reason: '验证更高版本存在时不能改变分支拓扑。',
      }),
      (error) => error instanceof RegistryError && error.code === 'PUBLICATION_CONFLICT',
    );
    assert.equal(context.operations.listOpenOperations().length, 0);
    assert.deepEqual(
      context.store.resolveActivePublicationScope({
        canonicalId: 'mat-publication-service',
        publicationBranchKey: 'default',
      }).documentIds,
      ['document-rollback-guard-v2'],
    );
  });
});

test('PH3-13C4 回滚等待配置期间接收更高版本时在 operation 事务内失败关闭', async () => {
  await withContext(async (context) => {
    createQualityPassedVersion(context, {
      versionId: 'ver-rollback-race-v1',
      contentHash: '4'.repeat(64),
      documentId: 'document-rollback-race-v1',
      createMaterial: true,
    });
    await context.service.createPublishOperation({ versionId: 'ver-rollback-race-v1' });
    assert.equal(await context.runner.runNextJob(), true);
    createQualityPassedVersion(context, {
      versionId: 'ver-rollback-race-v2',
      contentHash: '5'.repeat(64),
      documentId: 'document-rollback-race-v2',
    });
    await context.service.createPublishOperation({ versionId: 'ver-rollback-race-v2' });
    assert.equal(await context.runner.runNextJob(), true);

    const originalGetPrivateConfig = context.config.getPrivateConfig.bind(context.config);
    let insertedNewerVersion = false;
    context.config.getPrivateConfig = async () => {
      const config = await originalGetPrivateConfig();
      if (!insertedNewerVersion) {
        insertedNewerVersion = true;
        context.store.createMaterialVersion({
          versionId: 'ver-rollback-race-v3',
          canonicalId: 'mat-publication-service',
          publicationBranchKey: 'default',
          contentHash: '6'.repeat(64),
          audit,
        });
      }
      return config;
    };

    await assert.rejects(
      context.service.createRollbackOperation({
        currentVersionId: 'ver-rollback-race-v2',
        reason: '验证配置读取窗口中的新版竞态。',
      }),
      (error) => error instanceof RegistryError && error.code === 'PUBLICATION_CONFLICT',
    );
    assert.equal(context.operations.listOpenOperations().length, 0);
    assert.deepEqual(
      context.store.resolveActivePublicationScope({
        canonicalId: 'mat-publication-service',
        publicationBranchKey: 'default',
      }).documentIds,
      ['document-rollback-race-v2'],
    );
  });
});

test('PH3-13C4 回滚建档后状态漂移会在任何远端写入前终止', async () => {
  await withContext(async (context) => {
    createQualityPassedVersion(context, {
      versionId: 'ver-rollback-prewrite-v1',
      contentHash: '7'.repeat(64),
      documentId: 'document-rollback-prewrite-v1',
      createMaterial: true,
    });
    await context.service.createPublishOperation({ versionId: 'ver-rollback-prewrite-v1' });
    assert.equal(await context.runner.runNextJob(), true);
    createQualityPassedVersion(context, {
      versionId: 'ver-rollback-prewrite-v2',
      contentHash: '8'.repeat(64),
      documentId: 'document-rollback-prewrite-v2',
    });
    await context.service.createPublishOperation({ versionId: 'ver-rollback-prewrite-v2' });
    assert.equal(await context.runner.runNextJob(), true);
    const operation = await context.service.createRollbackOperation({
      currentVersionId: 'ver-rollback-prewrite-v2',
      reason: '验证远端写入前的状态漂移复核。',
    });
    const patchCountBefore = context.remote.patches.length;
    context.registry.connection.prepare(`
      UPDATE material_versions
      SET processing_health = 'failed'
      WHERE version_id = 'ver-rollback-prewrite-v1'
    `).run();

    assert.equal(await context.runner.runNextJob(), true);
    assert.equal(context.remote.patches.length, patchCountBefore);
    assert.equal(context.operations.getOperation(operation.operationId).phase, 'failed');
    assert.equal(context.store.getProcessingJob(operation.jobId).status, 'succeeded');
    assert.deepEqual(
      context.store.resolveActivePublicationScope({
        canonicalId: 'mat-publication-service',
        publicationBranchKey: 'default',
      }).documentIds,
      ['document-rollback-prewrite-v2'],
    );
  });
});

test('PH3-13C4 预发布 smoke 失败会恢复 pending，SQLite 发布关系保持零变化', async () => {
  await withContext(async (context) => {
    createQualityPassedVersion(context, {
      versionId: 'ver-publication-failed',
      contentHash: 'c'.repeat(64),
      documentId: 'document-publication-failed',
      createMaterial: true,
    });
    context.remote.zeroResults = true;
    const operation = await context.service.createPublishOperation({ versionId: 'ver-publication-failed' });
    assert.equal(await context.runner.runNextJob(), true);
    assert.equal(context.operations.getOperation(operation.operationId).phase, 'failed');
    assert.equal(context.remote.statuses.get('document-publication-failed'), 'pending');
    assert.equal(context.store.getMaterialVersion('ver-publication-failed').workflowStatus, 'pending_publication');
    assert.equal(
      Number(context.registry.connection.prepare('SELECT COUNT(*) FROM material_publications').pluck().get()),
      0,
    );
  });
});

test('PH3-13C4 SQLite 切换后的旧版 superseded 失败保持新 scope，并由原任务退避恢复', async () => {
  await withContext(async (context) => {
    createQualityPassedVersion(context, {
      versionId: 'ver-publication-old',
      contentHash: 'd'.repeat(64),
      documentId: 'document-publication-old',
      createMaterial: true,
    });
    await context.service.createPublishOperation({ versionId: 'ver-publication-old' });
    await context.runner.runNextJob();

    createQualityPassedVersion(context, {
      versionId: 'ver-publication-new',
      contentHash: 'e'.repeat(64),
      documentId: 'document-publication-new',
    });
    context.remote.failSupersededOnce = true;
    const operation = await context.service.createPublishOperation({ versionId: 'ver-publication-new' });
    await context.runner.runNextJob();
    const failedJob = context.store.getProcessingJob(operation.jobId);
    assert.equal(failedJob.status, 'failed');
    assert.ok(failedJob.nextRetryAt);
    assert.equal(context.operations.getOperation(operation.operationId).phase, 'sqlite_switched');
    assert.deepEqual(
      context.store.resolveActivePublicationScope({
        canonicalId: 'mat-publication-service',
        publicationBranchKey: 'default',
      }).documentIds,
      ['document-publication-new'],
    );

    context.clock.advance(11);
    await context.runner.runNextJob();
    assert.equal(context.operations.getOperation(operation.operationId).phase, 'completed');
    assert.equal(context.remote.statuses.get('document-publication-old'), 'superseded');
    assert.equal(context.store.getProcessingJob(operation.jobId).status, 'succeeded');
  });
});
