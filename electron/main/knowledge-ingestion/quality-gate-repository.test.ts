import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRegistryDatabase, type RegistryDatabase } from './registry-database';
import { RegistryStore } from './registry-store';
import { PublicationOperationRepository } from './publication-operation-repository';
import { QualityGateRepository } from './quality-gate-repository';
import { REGISTRY_SCHEMA_VERSION } from './schema';
import type { QualityQuestionSnapshot } from './types';
import { RegistryError } from './types';

const audit = { actorId: 'test:quality', reason: 'PH3-13C3 质量门禁自动验收' };
const sourceHash = 'a'.repeat(64);
const parserProfile = 'education-textbook-v1';

function createClock(initial = '2026-07-11T00:00:00.000Z'): {
  now: () => Date;
  advance: (milliseconds: number) => void;
} {
  let current = Date.parse(initial);
  return {
    now: () => new Date(current),
    advance: (milliseconds) => {
      current += milliseconds;
    },
  };
}

function createIdFactory(): (prefix: string) => string {
  let sequence = 0;
  return (prefix) => `${prefix}_quality_test_${++sequence}`;
}

async function withRegistry(
  run: (context: {
    registry: RegistryDatabase;
    store: RegistryStore;
    quality: QualityGateRepository;
    clock: ReturnType<typeof createClock>;
  }) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'layout3-quality-gate-test-'));
  const clock = createClock();
  const createId = createIdFactory();
  let registry: RegistryDatabase | null = null;
  try {
    registry = await openRegistryDatabase({
      databasePath: join(root, 'registry.sqlite'),
      backupDirectory: join(root, 'backups'),
      now: clock.now,
      allowTestProcess: true,
    });
    const store = new RegistryStore(registry, { now: clock.now, createId });
    const quality = new QualityGateRepository(registry, { now: clock.now, createId });
    await run({ registry, store, quality, clock });
  } finally {
    registry?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function question(
  questionKey: string,
  value: string,
  evidenceExcerpt: string,
  startOffset: number,
): QualityQuestionSnapshot {
  return {
    questionKey,
    question: value,
    evidenceExcerpt,
    evidenceSha256: createHash('sha256').update(evidenceExcerpt, 'utf8').digest('hex'),
    startOffset,
    endOffset: startOffset + evidenceExcerpt.length,
    locatorLabel: `段落 ${startOffset + 1}`,
  };
}

function questions(): QualityQuestionSnapshot[] {
  return [
    question('question-1', '第一条资料内问题是什么？', '第一条唯一证据', 0),
  ];
}

function assertRegistryError(error: unknown, code: RegistryError['code']): boolean {
  return error instanceof RegistryError && error.code === code;
}

function seedCompleteArtifacts(registry: RegistryDatabase, versionId = 'ver-quality'): void {
  const timestamp = '2026-07-11T00:00:00.000Z';
  const insert = registry.connection.prepare(`
    INSERT INTO processing_artifacts (
      artifact_id, version_id, artifact_type, relative_path, media_type, size_bytes,
      sha256, source_hash, processing_profile, tool_name, tool_version, lineage_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const rows = [
    ['artifact-body', 'extracted_text', 'artifacts/body.txt', 'text/plain', 'b'.repeat(64)],
    ['artifact-locator', 'locator_map', 'artifacts/locator.json', 'application/json', 'c'.repeat(64)],
    ['artifact-manifest', 'manifest', 'artifacts/manifest.json', 'application/json', 'd'.repeat(64)],
  ] as const;
  for (const [artifactId, artifactType, relativePath, mediaType, sha256] of rows) {
    insert.run(
      `${versionId}-${artifactId}`,
      versionId,
      artifactType,
      `${versionId}/${relativePath}`,
      mediaType,
      128,
      sha256,
      sourceHash,
      parserProfile,
      'layout3-basic-extractor',
      '1.0.0',
      JSON.stringify({ schemaVersion: 'layout3_lineage_v1', artifactSetKey: 'set-quality' }),
      timestamp,
      timestamp,
    );
  }
}

function createEligibleVersion(context: {
  registry: RegistryDatabase;
  store: RegistryStore;
}, versionId = 'ver-quality'): void {
  context.store.createMaterial({
    canonicalId: `mat-${versionId}`,
    stableTitle: '质量门禁测试资料',
    domain: 'education',
    audit,
  });
  context.store.createPublicationBranch({
    canonicalId: `mat-${versionId}`,
    branchKey: 'default',
    branchType: 'default',
    displayName: '默认分支',
    isDefault: true,
    audit,
  });
  context.store.createMaterialVersion({
    versionId,
    canonicalId: `mat-${versionId}`,
    publicationBranchKey: 'default',
    contentHash: sourceHash,
    metadata: { title: '质量门禁测试资料', subject: '英语' },
    parserProfile,
    audit,
  });
  context.store.transitionVersionState(versionId, { workflowStatus: 'pending_confirmation' }, audit);
  context.store.transitionVersionState(
    versionId,
    { workflowStatus: 'processing', processingHealth: 'processing' },
    audit,
  );
  seedCompleteArtifacts(context.registry, versionId);
  context.store.ensureUnhealthyPendingBinding({
    bindingId: `binding-${versionId}`,
    versionId,
    indexGeneration: 'generation-staging-1',
    datasetId: 'dataset-staging',
    documentId: `document-${versionId}`,
    audit,
  });
  context.store.markPendingBindingHealthy({
    versionId,
    indexGeneration: 'generation-staging-1',
    datasetId: 'dataset-staging',
    documentId: `document-${versionId}`,
    chunkCount: 12,
    lastVerifiedAt: '2026-07-11T00:00:00.000Z',
    audit,
  });
}

function createRun(
  context: { quality: QualityGateRepository; clock: ReturnType<typeof createClock> },
  input: {
    inputHash?: string;
    requiredBlockingResultKeys?: string[];
  } = {},
) {
  return context.quality.createRun({
    versionId: 'ver-quality',
    questions: questions(),
    requiredBlockingResultKeys: input.requiredBlockingResultKeys ?? ['metadata_complete', 'candidate_top10:question-1'],
    inputHash: input.inputHash ?? 'quality-input-1',
    profileVersion: parserProfile,
    inputSnapshot: { itemId: 'item-quality' },
    profileSnapshot: { qualityProfile: 'quality-gate-v1' },
    configSnapshot: { configIdentity: 'staging-config-1' },
    expiresAt: new Date(context.clock.now().getTime() + 5 * 60_000).toISOString(),
    audit,
  });
}

function claimAndStart(context: {
  store: RegistryStore;
  quality: QualityGateRepository;
}, qualityRunId: string, workerId = 'worker-quality'): void {
  const claimed = context.store.claimNextJob({
    workerId,
    leaseDurationMs: 60_000,
    stages: ['quality'],
    audit,
  });
  assert.ok(claimed);
  context.quality.startRun({ qualityRunId, workerId, audit });
}

function recordPassedResult(
  quality: QualityGateRepository,
  qualityRunId: string,
  resultKey: string,
  workerId = 'worker-quality',
): void {
  quality.recordResult({
    qualityRunId,
    workerId,
    checkKey: resultKey.split(':')[0]!,
    resultKey,
    blockingLevel: 'blocking',
    passed: true,
    threshold: { required: true },
    actual: { passed: true },
    evidence: { summary: `${resultKey} 已通过` },
    audit,
  });
}

test('PH3-13C3 Schema V4 原子创建 quality job/run 并固定版本、binding、三工件与问题快照', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    const created = createRun({ quality, clock });

    assert.equal(
      Number(registry.connection.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()),
      REGISTRY_SCHEMA_VERSION,
    );
    assert.deepEqual(
      registry.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'quality_%' ORDER BY name")
        .pluck()
        .all(),
      ['quality_results', 'quality_runs'],
    );
    assert.equal(created.job.stage, 'quality');
    assert.equal(created.job.status, 'queued');
    assert.equal(created.run.status, 'queued');
    assert.equal(created.run.bindingId, 'binding-ver-quality');
    assert.deepEqual(created.run.bindingSnapshot, {
      bindingId: 'binding-ver-quality',
      indexGeneration: 'generation-staging-1',
      datasetId: 'dataset-staging',
      documentId: 'document-ver-quality',
      remoteRunStatus: 'DONE',
      chunkCount: 12,
      lastVerifiedAt: '2026-07-11T00:00:00.000Z',
    });
    assert.equal(created.run.questionsSnapshot.length, 1);
    assert.deepEqual(
      created.run.inputSnapshot.artifacts.map((artifact) => artifact.artifactType),
      ['extracted_text', 'locator_map', 'manifest'],
    );
    assert.equal(
      Number(registry.connection.prepare('SELECT COUNT(*) FROM quality_runs').pluck().get()),
      1,
    );
    assert.equal(
      Number(registry.connection.prepare("SELECT COUNT(*) FROM processing_jobs WHERE stage = 'quality'").pluck().get()),
      1,
    );
    assert.throws(
      () => createRun({ quality, clock }, { inputHash: 'quality-input-duplicate' }),
      (error) => assertRegistryError(error, 'QUALITY_BLOCK'),
    );
  });
});

test('PH3-13C3 质量运行、问题和逐项结果在关闭重开后仍可回读', async () => {
  await withRegistry(async ({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    const created = createRun({ quality, clock });
    claimAndStart({ store, quality }, created.run.qualityRunId);
    recordPassedResult(quality, created.run.qualityRunId, 'metadata_complete');

    const databasePath = registry.databasePath;
    registry.close();
    const reopened = await openRegistryDatabase({
      databasePath,
      now: clock.now,
      allowTestProcess: true,
    });
    try {
      const reopenedQuality = new QualityGateRepository(reopened, { now: clock.now });
      const persisted = reopenedQuality.getRun(created.run.qualityRunId);
      assert.equal(persisted.status, 'running');
      assert.equal(persisted.questionsSnapshot.length, 1);
      assert.equal(reopenedQuality.listResults(created.run.qualityRunId)[0]?.resultKey, 'metadata_complete');
    } finally {
      reopened.close();
    }
  });
});

test('PH3-13C3 同一 run 的同 resultKey 会更新为当前 attempt 结果且只保留一行', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    const created = createRun({ quality, clock });
    claimAndStart({ store, quality }, created.run.qualityRunId);
    const first = quality.recordResult({
      qualityRunId: created.run.qualityRunId,
      workerId: 'worker-quality',
      checkKey: 'candidate_top10',
      resultKey: 'candidate_top10:question-1',
      blockingLevel: 'blocking',
      passed: true,
      threshold: { topK: 10 },
      actual: { targetRank: 1 },
      evidence: { message: '第一次 attempt 命中' },
      audit,
    });
    const updated = quality.recordResult({
      qualityRunId: created.run.qualityRunId,
      workerId: 'worker-quality',
      checkKey: 'candidate_top10',
      resultKey: 'candidate_top10:question-1',
      blockingLevel: 'blocking',
      passed: false,
      threshold: { topK: 10 },
      actual: { targetRank: null },
      evidence: { message: '当前 attempt 未命中' },
      audit,
    });

    assert.equal(updated.qualityResultId, first.qualityResultId);
    assert.equal(updated.passed, false);
    assert.deepEqual(updated.actual, { targetRank: null });
    assert.equal(
      Number(registry.connection.prepare(`
        SELECT COUNT(*) FROM quality_results
        WHERE quality_run_id = ? AND result_key = 'candidate_top10:question-1'
      `).pluck().get(created.run.qualityRunId)),
      1,
    );
    const recheckedAudit = registry.connection.prepare(`
      SELECT before_json, after_json FROM audit_events
      WHERE entity_id = ? AND action = 'quality_result.rechecked'
    `).get(first.qualityResultId) as { before_json: string; after_json: string } | undefined;
    assert.ok(recheckedAudit);
    assert.equal((JSON.parse(recheckedAudit.before_json) as { passed: boolean }).passed, true);
    assert.equal((JSON.parse(recheckedAudit.after_json) as { passed: boolean }).passed, false);
  });
});

test('PH3-13C3 旧 worker 在租约过期和新 worker 接管后不能覆盖当前 attempt 结果', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    const created = createRun({ quality, clock });
    const workerA = 'worker-quality-a';
    const workerB = 'worker-quality-b';
    const claimedByA = store.claimNextJob({
      workerId: workerA,
      leaseDurationMs: 1_000,
      stages: ['quality'],
      audit,
    });
    assert.ok(claimedByA);
    quality.startRun({ qualityRunId: created.run.qualityRunId, workerId: workerA, audit });

    clock.advance(1_001);
    assert.throws(
      () => quality.resolveValidScope(created.run.qualityRunId, workerA),
      (error) => assertRegistryError(error, 'JOB_STATE_CONFLICT'),
    );
    assert.throws(
      () => quality.recordResult({
        qualityRunId: created.run.qualityRunId,
        workerId: workerA,
        checkKey: 'candidate_top10',
        resultKey: 'candidate_top10:question-1',
        blockingLevel: 'blocking',
        passed: true,
        threshold: { topK: 10 },
        actual: { targetRank: 1 },
        evidence: { message: '旧 worker 的迟到通过结果' },
        audit,
      }),
      (error) => assertRegistryError(error, 'JOB_STATE_CONFLICT'),
    );

    const recovered = store.recoverExpiredJobs({
      actorId: 'system:startup',
      reason: '测试新 worker 接管过期质量租约',
    });
    assert.equal(recovered[0]?.status, 'queued');
    const claimedByB = store.claimNextJob({
      workerId: workerB,
      leaseDurationMs: 60_000,
      stages: ['quality'],
      audit,
    });
    assert.equal(claimedByB?.jobId, created.job.jobId);
    quality.startRun({ qualityRunId: created.run.qualityRunId, workerId: workerB, audit });
    quality.recordResult({
      qualityRunId: created.run.qualityRunId,
      workerId: workerB,
      checkKey: 'candidate_top10',
      resultKey: 'candidate_top10:question-1',
      blockingLevel: 'blocking',
      passed: false,
      threshold: { topK: 10 },
      actual: { targetRank: null },
      evidence: { message: '当前 worker 的未命中结果' },
      audit,
    });

    assert.throws(
      () => quality.recordResult({
        qualityRunId: created.run.qualityRunId,
        workerId: workerA,
        checkKey: 'candidate_top10',
        resultKey: 'candidate_top10:question-1',
        blockingLevel: 'blocking',
        passed: true,
        threshold: { topK: 10 },
        actual: { targetRank: 1 },
        evidence: { message: '旧 worker 不能覆盖当前结果' },
        audit,
      }),
      (error) => assertRegistryError(error, 'JOB_STATE_CONFLICT'),
    );
    assert.equal(
      quality.listResults(created.run.qualityRunId)
        .find((result) => result.resultKey === 'candidate_top10:question-1')?.passed,
      false,
    );
    assert.deepEqual(
      quality.resolveValidScope(created.run.qualityRunId, workerB).documentIds,
      ['document-ver-quality'],
    );
  });
});

test('PH3-13C3 完全相同问题可在前一运行结束后创建新的 run/job，并保留问题身份', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    const first = createRun({ quality, clock });
    claimAndStart({ store, quality }, first.run.qualityRunId);
    quality.cancelRun({
      qualityRunId: first.run.qualityRunId,
      workerId: 'worker-quality',
      audit,
    });

    const second = createRun({ quality, clock });
    assert.notEqual(second.run.qualityRunId, first.run.qualityRunId);
    assert.notEqual(second.job.jobId, first.job.jobId);
    assert.notEqual(second.job.inputHash, first.job.inputHash);
    assert.equal(first.run.inputSnapshot.request.semanticInputHash, 'quality-input-1');
    assert.equal(second.run.inputSnapshot.request.semanticInputHash, 'quality-input-1');
    assert.deepEqual(
      second.run.questionsSnapshot.map((question) => question.questionKey),
      first.run.questionsSnapshot.map((question) => question.questionKey),
    );
  });
});

test('PH3-13C3 创建前拒绝缺失三工件、非健康版本与多份 pending binding', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    registry.connection.prepare("DELETE FROM processing_artifacts WHERE artifact_type = 'manifest'").run();
    assert.throws(
      () => createRun({ quality, clock }),
      (error) => assertRegistryError(error, 'QUALITY_BLOCK'),
    );

    registry.connection.prepare('DELETE FROM processing_artifacts').run();
    seedCompleteArtifacts(registry);
    registry.connection.prepare(`
      INSERT INTO ragflow_bindings (
        binding_id, version_id, index_generation, dataset_id, document_id,
        remote_status, is_healthy, remote_run_status, chunk_count,
        last_verified_at, created_at, updated_at
      ) VALUES ('binding-extra', 'ver-quality', 'generation-staging-2', 'dataset-staging',
        'document-extra', 'pending', 1, 'DONE', 2,
        '2026-07-11T00:00:00.000Z', '2026-07-11T00:00:00.000Z', '2026-07-11T00:00:00.000Z')
    `).run();
    assert.throws(
      () => createRun({ quality, clock }),
      (error) => assertRegistryError(error, 'INCOMPLETE_RAGFLOW_MAPPING'),
    );
  });
});

test('PH3-13C3 运行中只解析精确 pending scope，过期、结束与 binding 漂移均失败关闭', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    const created = createRun({ quality, clock });
    claimAndStart({ store, quality }, created.run.qualityRunId);
    assert.deepEqual(quality.resolveValidScope(created.run.qualityRunId, 'worker-quality'), {
      qualityRunId: created.run.qualityRunId,
      versionId: 'ver-quality',
      bindingId: 'binding-ver-quality',
      datasetIds: ['dataset-staging'],
      documentIds: ['document-ver-quality'],
      expiresAt: created.run.expiresAt,
    });

    registry.connection
      .prepare("UPDATE ragflow_bindings SET document_id = 'document-drift' WHERE binding_id = 'binding-ver-quality'")
      .run();
    assert.throws(
      () => quality.resolveValidScope(created.run.qualityRunId, 'worker-quality'),
      (error) => assertRegistryError(error, 'INCOMPLETE_RAGFLOW_MAPPING'),
    );
    registry.connection
      .prepare("UPDATE ragflow_bindings SET document_id = 'document-ver-quality' WHERE binding_id = 'binding-ver-quality'")
      .run();
    clock.advance(5 * 60_000 + 1);
    assert.throws(
      () => quality.resolveValidScope(created.run.qualityRunId, 'worker-quality'),
      (error) => assertRegistryError(error, 'QUALITY_BLOCK'),
    );
  });
});

test('PH3-13C3 通过路径缺项时整体回滚，完整后原子收口 run/job/version/audit', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    assert.throws(
      () => store.transitionVersionState('ver-quality', { workflowStatus: 'pending_publication' }, audit),
      (error) => assertRegistryError(error, 'QUALITY_BLOCK'),
    );

    const created = createRun({ quality, clock });
    claimAndStart({ store, quality }, created.run.qualityRunId);
    recordPassedResult(quality, created.run.qualityRunId, 'metadata_complete');
    assert.throws(
      () => quality.finalizePassed({
        qualityRunId: created.run.qualityRunId,
        workerId: 'worker-quality',
        audit,
      }),
      (error) => assertRegistryError(error, 'QUALITY_BLOCK'),
    );
    assert.equal(quality.getRun(created.run.qualityRunId).status, 'running');
    assert.equal(store.getProcessingJob(created.job.jobId).status, 'running');
    assert.equal(store.getMaterialVersion('ver-quality').workflowStatus, 'quality_check');

    recordPassedResult(quality, created.run.qualityRunId, 'candidate_top10:question-1');
    const finalized = quality.finalizePassed({
      qualityRunId: created.run.qualityRunId,
      workerId: 'worker-quality',
      audit,
    });
    assert.equal(finalized.run.status, 'passed');
    assert.equal(finalized.run.conclusion, 'passed');
    assert.equal(finalized.job.status, 'succeeded');
    assert.equal(finalized.version.workflowStatus, 'pending_publication');
    assert.equal(finalized.version.processingHealth, 'healthy');
    assert.equal(finalized.version.indexPublicationStatus, 'pending');
    assert.equal(
      quality.assertPublishablePassedRun('ver-quality').qualityRunId,
      created.run.qualityRunId,
    );
    assert.throws(
      () => quality.resolveValidScope(created.run.qualityRunId, 'worker-quality'),
      (error) => assertRegistryError(error, 'QUALITY_BLOCK'),
    );
    assert.equal(
      Number(registry.connection.prepare(`
        SELECT COUNT(*) FROM audit_events
        WHERE action IN (
          'quality_run.passed', 'processing_job.succeeded',
          'material_version.quality_passed_pending_publication'
        )
      `).pluck().get()),
      3,
    );
    clock.advance(5 * 60_000 + 1);
    assert.throws(
      () => quality.assertPublishablePassedRun('ver-quality'),
      (error) => assertRegistryError(error, 'QUALITY_BLOCK'),
    );
  });
});

test('PH3-13C4 待发布质量结论在失效边界可原子退回并创建全新运行', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    const first = createRun({ quality, clock });
    claimAndStart({ store, quality }, first.run.qualityRunId);
    recordPassedResult(quality, first.run.qualityRunId, 'metadata_complete');
    recordPassedResult(quality, first.run.qualityRunId, 'candidate_top10:question-1');
    quality.finalizePassed({ qualityRunId: first.run.qualityRunId, workerId: 'worker-quality', audit });

    assert.throws(
      () => store.transitionVersionState('ver-quality', { workflowStatus: 'quality_check' }, audit),
      (error) => assertRegistryError(error, 'INVALID_STATE_TRANSITION'),
    );

    clock.advance(5 * 60_000);
    const second = createRun({ quality, clock });

    assert.notEqual(second.run.qualityRunId, first.run.qualityRunId);
    assert.equal(second.run.status, 'queued');
    assert.equal(store.getMaterialVersion('ver-quality').workflowStatus, 'quality_check');
    assert.equal(
      Number(registry.connection.prepare(
        "SELECT COUNT(*) FROM audit_events WHERE action = 'material_version.expired_quality_reopened'",
      ).pluck().get()),
      1,
    );
  });
});

test('PH3-13C4 已有开放发布操作时拒绝过期质量重开且不留下半成品', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    const first = createRun({ quality, clock });
    claimAndStart({ store, quality }, first.run.qualityRunId);
    recordPassedResult(quality, first.run.qualityRunId, 'metadata_complete');
    recordPassedResult(quality, first.run.qualityRunId, 'candidate_top10:question-1');
    quality.finalizePassed({ qualityRunId: first.run.qualityRunId, workerId: 'worker-quality', audit });
    const operations = new PublicationOperationRepository(registry, { now: clock.now });
    operations.createOperation({
      operationId: 'operation-quality-expired-open',
      jobId: 'job-quality-expired-open',
      operationType: 'publish',
      canonicalId: 'mat-ver-quality',
      publicationBranchKey: 'default',
      targetVersionId: 'ver-quality',
      qualityRunId: first.run.qualityRunId,
      releaseId: 'release-quality-expired-open',
      targetPublicationId: 'publication-quality-expired-open',
      inputSnapshot: { reason: '验证开放发布操作阻止质量重开。' },
      configSnapshot: {
        baseUrl: 'http://127.0.0.1:9380',
        stagingDatasetId: 'dataset-staging',
        indexGeneration: 'generation-staging-1',
      },
      inputHash: 'quality-expired-open-operation',
      audit,
    });

    clock.advance(5 * 60_000);
    assert.throws(
      () => createRun({ quality, clock }),
      (error) => assertRegistryError(error, 'PUBLICATION_CONFLICT'),
    );
    assert.equal(store.getMaterialVersion('ver-quality').workflowStatus, 'pending_publication');
    assert.equal(
      Number(registry.connection.prepare('SELECT COUNT(*) FROM quality_runs WHERE version_id = ?').pluck().get('ver-quality')),
      1,
    );
    assert.equal(
      Number(registry.connection.prepare(
        "SELECT COUNT(*) FROM audit_events WHERE action = 'material_version.expired_quality_reopened'",
      ).pluck().get()),
      0,
    );
  });
});

test('PH3-13C3 确定性阻断令 job 成功、run blocked、版本进入 quarantined', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    const created = createRun({ quality, clock });
    claimAndStart({ store, quality }, created.run.qualityRunId);
    quality.recordResult({
      qualityRunId: created.run.qualityRunId,
      workerId: 'worker-quality',
      checkKey: 'candidate_top10',
      resultKey: 'candidate_top10:question-1',
      blockingLevel: 'blocking',
      passed: false,
      threshold: { topK: 10 },
      actual: { targetRank: null },
      evidence: { message: '目标资料未进入 Top 10' },
      audit,
    });
    const finalized = quality.finalizeBlocked({
      qualityRunId: created.run.qualityRunId,
      workerId: 'worker-quality',
      reason: '冒烟检索未命中目标资料，已隔离。',
      audit,
    });
    assert.equal(finalized.run.status, 'blocked');
    assert.equal(finalized.job.status, 'succeeded');
    assert.equal(finalized.version.workflowStatus, 'quarantined');
    assert.equal(Number(registry.connection.prepare('SELECT COUNT(*) FROM material_publications').pluck().get()), 0);
  });
});

test('PH3-13C3 远端 scope 外返回会留存阻断证据并禁止通过', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    const created = createRun({ quality, clock });
    claimAndStart({ store, quality }, created.run.qualityRunId);
    quality.recordRemoteContractViolation({
      qualityRunId: created.run.qualityRunId,
      workerId: 'worker-quality',
      returnedDocumentIds: ['document-ver-quality', 'document-outside'],
      allowedDocumentIds: ['document-ver-quality'],
      audit: {
        returnedDatasetIds: ['dataset-staging', 'dataset-outside'],
        allowedDatasetIds: ['dataset-staging'],
        outOfScopeDocumentIds: ['document-outside'],
        outOfScopeDatasetIds: ['dataset-outside'],
      },
    });
    assert.throws(
      () => quality.finalizePassed({
        qualityRunId: created.run.qualityRunId,
        workerId: 'worker-quality',
        audit,
      }),
      (error) => assertRegistryError(error, 'QUALITY_BLOCK'),
    );
    const blocked = quality.finalizeBlocked({
      qualityRunId: created.run.qualityRunId,
      workerId: 'worker-quality',
      reason: '候选检索返回了 scope 外文档。',
      audit,
    });
    assert.equal(blocked.version.workflowStatus, 'quarantined');
    assert.equal(
      Number(registry.connection.prepare(`
        SELECT COUNT(*) FROM audit_events WHERE action = 'quality_run.remote_contract_violation'
      `).pluck().get()),
      1,
    );
  });
});

test('PH3-13C3 技术失败支持原运行退避重试，取消和最终失败均不进入待发布', async () => {
  await withRegistry(({ registry, store, quality, clock }) => {
    createEligibleVersion({ registry, store });
    const created = createRun({ quality, clock });
    claimAndStart({ store, quality }, created.run.qualityRunId);
    const retryAt = new Date(clock.now().getTime() + 10_000).toISOString();
    const retryable = quality.failRun({
      qualityRunId: created.run.qualityRunId,
      workerId: 'worker-quality',
      errorCode: 'REMOTE_TRANSIENT',
      errorMessage: 'RAGFlow 暂时不可用。',
      retryAt,
      audit,
    });
    assert.equal(retryable.run.status, 'queued');
    assert.equal(retryable.run.conclusion, null);
    assert.equal(retryable.job.status, 'failed');
    assert.equal(retryable.job.nextRetryAt, retryAt);
    assert.equal(store.getMaterialVersion('ver-quality').workflowStatus, 'quality_check');

    clock.advance(10_000);
    const claimed = store.claimNextJob({
      workerId: 'worker-quality-retry',
      leaseDurationMs: 60_000,
      stages: ['quality'],
      audit,
    });
    assert.equal(claimed?.jobId, created.job.jobId);
    quality.startRun({
      qualityRunId: created.run.qualityRunId,
      workerId: 'worker-quality-retry',
      audit,
    });
    store.requestJobCancellation(created.job.jobId, audit);
    const cancelled = quality.cancelRun({
      qualityRunId: created.run.qualityRunId,
      workerId: 'worker-quality-retry',
      audit,
    });
    assert.equal(cancelled.run.status, 'cancelled');
    assert.equal(cancelled.job.status, 'cancelled');
    assert.equal(store.getMaterialVersion('ver-quality').workflowStatus, 'quality_check');

    const second = createRun({ quality, clock }, { inputHash: 'quality-input-2' });
    claimAndStart({ store, quality }, second.run.qualityRunId, 'worker-quality-final-fail');
    const failed = quality.failRun({
      qualityRunId: second.run.qualityRunId,
      workerId: 'worker-quality-final-fail',
      errorCode: 'REMOTE_AUTH_CONFIG',
      errorMessage: 'RAGFlow 凭据不可用。',
      audit,
    });
    assert.equal(failed.run.status, 'failed');
    assert.equal(failed.run.conclusion, 'technical_failure');
    assert.equal(failed.job.status, 'failed');
    assert.equal(store.getMaterialVersion('ver-quality').workflowStatus, 'quality_check');
    assert.equal(Number(registry.connection.prepare('SELECT COUNT(*) FROM material_publications').pluck().get()), 0);
  });
});
