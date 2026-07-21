import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicationOperationRepository } from './publication-operation-repository';
import { openRegistryDatabase, type RegistryDatabase } from './registry-database';
import { RegistryStore } from './registry-store';
import { REGISTRY_SCHEMA_VERSION } from './schema';
import { RegistryError } from './types';

const audit = { actorId: 'test:publication', reason: 'PH3-13C4 发布操作仓储自动验收' };

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
  return (prefix) => `${prefix}_publication_test_${++sequence}`;
}

async function withRegistry(
  run: (context: {
    registry: RegistryDatabase;
    store: RegistryStore;
    operations: PublicationOperationRepository;
    clock: ReturnType<typeof createClock>;
  }) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'layout3-publication-operation-test-'));
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
    await run({
      registry,
      store: new RegistryStore(registry, { now: clock.now, createId }),
      operations: new PublicationOperationRepository(registry, { now: clock.now, createId }),
      clock,
    });
  } finally {
    registry?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function assertRegistryError(error: unknown, code: RegistryError['code']): boolean {
  return error instanceof RegistryError && error.code === code;
}

function seedPublishTarget(registry: RegistryDatabase, store: RegistryStore): void {
  store.createMaterial({ canonicalId: 'mat-publication', stableTitle: '发布测试资料', domain: 'education', audit });
  store.createPublicationBranch({
    canonicalId: 'mat-publication',
    branchKey: 'default',
    branchType: 'default',
    displayName: '默认版本',
    isDefault: true,
    audit,
  });
  store.createMaterialVersion({
    versionId: 'ver-publication',
    canonicalId: 'mat-publication',
    publicationBranchKey: 'default',
    contentHash: 'a'.repeat(64),
    parserProfile: 'education-textbook-v1',
    audit,
  });
  const timestamp = '2026-07-11T00:00:00.000Z';
  registry.connection.prepare(`
    UPDATE material_versions
    SET workflow_status = 'pending_publication', processing_health = 'healthy',
        index_publication_status = 'pending', updated_at = ?
    WHERE version_id = 'ver-publication'
  `).run(timestamp);
  registry.connection.prepare(`
    INSERT INTO ragflow_bindings (
      binding_id, version_id, index_generation, dataset_id, document_id,
      remote_status, is_healthy, last_verified_at, created_at, updated_at,
      remote_run_status, chunk_count
    ) VALUES (
      'binding-publication', 'ver-publication', 'generation-publication',
      'dataset-publication', 'document-publication', 'pending', 1,
      ?, ?, ?, 'DONE', 8
    )
  `).run(timestamp, timestamp, timestamp);
  registry.connection.prepare(`
    INSERT INTO processing_jobs (
      job_id, version_id, stage, status, input_hash, profile_version,
      attempt_count, max_attempts, created_at, updated_at
    ) VALUES (
      'job-quality-publication', 'ver-publication', 'quality', 'succeeded',
      'quality-input-publication', 'quality-gate-v1', 1, 3, ?, ?
    )
  `).run(timestamp, timestamp);
  registry.connection.prepare(`
    INSERT INTO quality_runs (
      quality_run_id, version_id, job_id, binding_id, status, conclusion,
      binding_snapshot_json, questions_snapshot_json, input_snapshot_json,
      profile_snapshot_json, config_snapshot_json, expires_at,
      started_at, completed_at, created_at, updated_at
    ) VALUES (
      'quality-publication', 'ver-publication', 'job-quality-publication',
      'binding-publication', 'passed', 'passed', ?, '[]', ?, ?, ?,
      '2026-07-11T01:00:00.000Z', ?, ?, ?, ?
    )
  `).run(
    JSON.stringify({ bindingId: 'binding-publication' }),
    JSON.stringify({ requiredBlockingResultKeys: [], artifacts: [] }),
    JSON.stringify({ parserProfile: 'education-textbook-v1' }),
    JSON.stringify({ baseUrl: 'http://127.0.0.1:9380' }),
    timestamp,
    timestamp,
    timestamp,
    timestamp,
  );
}

function createPublishOperation(operations: PublicationOperationRepository, suffix = 'one') {
  return operations.createOperation({
    operationId: `operation-${suffix}`,
    jobId: `job-publication-${suffix}`,
    operationType: 'publish',
    canonicalId: 'mat-publication',
    publicationBranchKey: 'default',
    targetVersionId: 'ver-publication',
    qualityRunId: 'quality-publication',
    releaseId: `release-${suffix}`,
    targetPublicationId: `publication-${suffix}`,
    inputSnapshot: { reason: '用户确认首次发布。' },
    configSnapshot: {
      baseUrl: 'http://127.0.0.1:9380',
      stagingDatasetId: 'dataset-publication',
      indexGeneration: 'generation-publication',
    },
    inputHash: `publication-input-${suffix}`,
    audit,
  });
}

test('PH3-13C4 Schema V5 原子创建 publication operation 与持久任务并阻止同分支并发', async () => {
  await withRegistry(({ registry, store, operations }) => {
    seedPublishTarget(registry, store);
    assert.equal(
      Number(registry.connection.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()),
      REGISTRY_SCHEMA_VERSION,
    );
    const created = createPublishOperation(operations);
    assert.equal(created.operation.phase, 'prepared');
    assert.equal(created.operation.targetBindingId, 'binding-publication');
    assert.equal(created.job.stage, 'publication_compensation');
    assert.equal(created.job.status, 'queued');
    assert.equal(operations.listOpenOperations().length, 1);

    assert.throws(
      () => createPublishOperation(operations, 'parallel'),
      (error) => error instanceof RegistryError
        && (error.code === 'PUBLICATION_CONFLICT' || error.code === 'JOB_STATE_CONFLICT'),
    );
    assert.equal(
      Number(registry.connection.prepare("SELECT COUNT(*) FROM processing_jobs WHERE job_id = 'job-publication-parallel'").pluck().get()),
      0,
    );
  });
});

test('PH3-13C4 发布操作阶段更新绑定当前有效任务租约，补偿失败按业务失败安全收口', async () => {
  await withRegistry(({ registry, store, operations, clock }) => {
    seedPublishTarget(registry, store);
    const created = createPublishOperation(operations);
    const claimed = store.claimNextJob({
      workerId: 'worker-publication',
      leaseDurationMs: 10_000,
      stages: ['publication_compensation'],
      audit,
    });
    assert.equal(claimed?.jobId, created.job.jobId);
    assert.equal(
      operations.advancePhase({
        operationId: created.operation.operationId,
        workerId: 'worker-publication',
        nextPhase: 'restore_target_pending',
        audit,
      }).phase,
      'restore_target_pending',
    );
    const closed = operations.compensateAndCloseFailed({
      operationId: created.operation.operationId,
      workerId: 'worker-publication',
      errorCode: 'QUALITY_BLOCK',
      errorMessage: '预发布 smoke 未通过，目标已恢复 pending。',
      audit,
    });
    assert.equal(closed.operation.phase, 'failed');
    assert.equal(closed.operation.errorCode, 'QUALITY_BLOCK');
    assert.equal(closed.job.status, 'succeeded');
    assert.equal(operations.listOpenOperations().length, 0);

    const second = createPublishOperation(operations, 'after-failed');
    const secondClaimed = store.claimNextJob({
      workerId: 'worker-old',
      leaseDurationMs: 1_000,
      stages: ['publication_compensation'],
      audit,
    });
    assert.equal(secondClaimed?.jobId, second.job.jobId);
    clock.advance(1_001);
    assert.throws(
      () => operations.advancePhase({
        operationId: second.operation.operationId,
        workerId: 'worker-old',
        nextPhase: 'target_active_verified',
        audit,
      }),
      (error) => assertRegistryError(error, 'JOB_STATE_CONFLICT'),
    );
    assert.equal(
      Number(registry.connection.prepare(`
        SELECT COUNT(*) FROM audit_events
        WHERE entity_type = 'publication_operation'
      `).pluck().get()) >= 3,
      true,
    );
  });
});

test('PH3-13C4 发布操作快照拒绝凭据字段', async () => {
  await withRegistry(({ registry, store, operations }) => {
    seedPublishTarget(registry, store);
    assert.throws(
      () => operations.createOperation({
        operationType: 'publish',
        canonicalId: 'mat-publication',
        publicationBranchKey: 'default',
        targetVersionId: 'ver-publication',
        qualityRunId: 'quality-publication',
        releaseId: 'release-secret',
        targetPublicationId: 'publication-secret',
        inputSnapshot: { reason: '安全测试' },
        configSnapshot: { baseUrl: 'http://127.0.0.1:9380', apiKey: 'secret-value' },
        inputHash: 'publication-secret-input',
        audit,
      }),
      (error) => assertRegistryError(error, 'INPUT_VALIDATION'),
    );
    assert.equal(Number(registry.connection.prepare('SELECT COUNT(*) FROM publication_operations').pluck().get()), 0);
  });
});

test('PH3-13C4 满尝试发布任务人工重试会归零尝试次数并可再次领取', async () => {
  await withRegistry(({ registry, store, operations }) => {
    seedPublishTarget(registry, store);
    const created = createPublishOperation(operations, 'manual-retry');
    registry.connection.prepare(`
      UPDATE processing_jobs SET max_attempts = 1 WHERE job_id = ?
    `).run(created.job.jobId);
    const claimed = store.claimNextJob({
      workerId: 'worker-publication-first',
      leaseDurationMs: 60_000,
      stages: ['publication_compensation'],
      audit,
    });
    assert.equal(claimed?.attemptCount, 1);
    const failed = operations.failAttempt({
      operationId: created.operation.operationId,
      workerId: 'worker-publication-first',
      errorCode: 'REMOTE_CONTRACT',
      errorMessage: '需要人工确认后重试。',
      retryAt: null,
      audit,
    });
    assert.equal(failed.job.status, 'failed');
    assert.equal(failed.job.attemptCount, 1);

    const retried = operations.retryOperation(created.operation.operationId, audit);
    assert.equal(retried.job.status, 'queued');
    assert.equal(retried.job.attemptCount, 0);
    const reclaimed = store.claimNextJob({
      workerId: 'worker-publication-second',
      leaseDurationMs: 60_000,
      stages: ['publication_compensation'],
      audit,
    });
    assert.equal(reclaimed?.jobId, created.job.jobId);
    assert.equal(reclaimed?.attemptCount, 1);
  });
});
