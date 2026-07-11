import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLayout3PendingMetadata } from './ingestion-metadata';
import { openRegistryDatabase, type RegistryDatabase } from './registry-database';
import { RegistryStore } from './registry-store';
import { RegistryError } from './types';

const audit = { actorId: 'test:c2', reason: 'PH3-13C2 pending 仓储自动验收' };

function createClock(initial = '2026-07-11T08:00:00.000Z'): {
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
  return (prefix) => `${prefix}_pending_${++sequence}`;
}

async function withRegistry(
  run: (context: {
    registry: RegistryDatabase;
    store: RegistryStore;
    clock: ReturnType<typeof createClock>;
  }) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'layout3-pending-repository-test-'));
  const clock = createClock();
  let registry: RegistryDatabase | null = null;
  try {
    registry = await openRegistryDatabase({
      databasePath: join(root, 'registry.sqlite'),
      now: clock.now,
      allowTestProcess: true,
    });
    const store = new RegistryStore(registry, {
      now: clock.now,
      createId: createIdFactory(),
    });
    await run({ registry, store, clock });
  } finally {
    registry?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function createProcessingVersion(
  store: RegistryStore,
  input: {
    canonicalId: string;
    versionId: string;
    contentHash: string;
    metadata?: Record<string, unknown>;
    parserProfile?: string | null;
    embeddingProfile?: string | null;
    profileBundleHash?: string | null;
  },
): void {
  store.createMaterial({
    canonicalId: input.canonicalId,
    stableTitle: `${input.canonicalId} 资料`,
    domain: '教育',
    audit,
  });
  store.createPublicationBranch({
    canonicalId: input.canonicalId,
    branchKey: 'default',
    branchType: 'default',
    displayName: '默认版本',
    isDefault: true,
    audit,
  });
  store.createMaterialVersion({
    versionId: input.versionId,
    canonicalId: input.canonicalId,
    publicationBranchKey: 'default',
    contentHash: input.contentHash,
    metadata: input.metadata,
    metadataSchemaVersion: 'layout3_ingestion_v1',
    parserProfile: input.parserProfile,
    embeddingProfile: input.embeddingProfile,
    profileBundleHash: input.profileBundleHash,
    audit,
  });
  store.transitionVersionState(input.versionId, { workflowStatus: 'pending_confirmation' }, audit);
  store.transitionVersionState(
    input.versionId,
    { workflowStatus: 'processing', processingHealth: 'processing' },
    audit,
  );
}

function assertRegistryError(error: unknown, code: RegistryError['code']): boolean {
  return error instanceof RegistryError && error.code === code;
}

test('PH3-13C2 不健康 pending 绑定创建幂等，并拒绝身份漂移与同代次多份绑定', async () => {
  await withRegistry(({ registry, store }) => {
    createProcessingVersion(store, {
      canonicalId: 'mat-binding',
      versionId: 'ver-binding',
      contentHash: 'a'.repeat(64),
    });
    const created = store.ensureUnhealthyPendingBinding({
      bindingId: 'binding-main',
      versionId: 'ver-binding',
      indexGeneration: 'generation-1',
      datasetId: 'dataset-stage',
      documentId: 'doc-1',
      audit,
    });
    assert.deepEqual(
      {
        versionId: created.versionId,
        indexGeneration: created.indexGeneration,
        datasetId: created.datasetId,
        documentId: created.documentId,
        remoteStatus: created.remoteStatus,
        isHealthy: created.isHealthy,
        remoteRunStatus: created.remoteRunStatus,
        chunkCount: created.chunkCount,
        lastVerifiedAt: created.lastVerifiedAt,
      },
      {
        versionId: 'ver-binding',
        indexGeneration: 'generation-1',
        datasetId: 'dataset-stage',
        documentId: 'doc-1',
        remoteStatus: 'pending',
        isHealthy: false,
        remoteRunStatus: null,
        chunkCount: null,
        lastVerifiedAt: null,
      },
    );
    assert.equal(
      store.ensureUnhealthyPendingBinding({
        versionId: 'ver-binding',
        indexGeneration: 'generation-1',
        datasetId: 'dataset-stage',
        documentId: 'doc-1',
        audit,
      }).bindingId,
      'binding-main',
    );
    assert.equal(
      Number(registry.connection
        .prepare("SELECT COUNT(*) FROM audit_events WHERE action = 'ragflow_binding.pending_unhealthy_created'")
        .pluck()
        .get()),
      1,
    );
    assert.throws(
      () => store.ensureUnhealthyPendingBinding({
        versionId: 'ver-binding',
        indexGeneration: 'generation-1',
        datasetId: 'dataset-stage',
        documentId: 'doc-drift',
        audit,
      }),
      (error) => assertRegistryError(error, 'INCOMPLETE_RAGFLOW_MAPPING'),
    );

    registry.connection.prepare(`
      INSERT INTO ragflow_bindings (
        binding_id, version_id, index_generation, dataset_id, document_id,
        remote_status, is_healthy, created_at, updated_at
      ) VALUES ('binding-duplicate', 'ver-binding', 'generation-1', 'dataset-stage',
        'doc-2', 'pending', 0, '2026-07-11T08:00:00.000Z', '2026-07-11T08:00:00.000Z')
    `).run();
    assert.throws(
      () => store.findPendingBinding({ versionId: 'ver-binding', indexGeneration: 'generation-1' }),
      (error) => assertRegistryError(error, 'INCOMPLETE_RAGFLOW_MAPPING'),
    );
  });
});

test('PH3-13C2 重启恢复只接受 version 唯一 pending 绑定', async () => {
  await withRegistry(({ store }) => {
    createProcessingVersion(store, {
      canonicalId: 'mat-recovery',
      versionId: 'ver-recovery',
      contentHash: 'b'.repeat(64),
    });
    store.ensureUnhealthyPendingBinding({
      versionId: 'ver-recovery',
      indexGeneration: 'generation-1',
      datasetId: 'dataset-stage',
      documentId: 'doc-1',
      audit,
    });
    assert.equal(store.findUniquePendingBindingForVersion('ver-recovery')?.documentId, 'doc-1');
    store.ensureUnhealthyPendingBinding({
      versionId: 'ver-recovery',
      indexGeneration: 'generation-2',
      datasetId: 'dataset-stage',
      documentId: 'doc-2',
      audit,
    });
    assert.throws(
      () => store.findUniquePendingBindingForVersion('ver-recovery'),
      (error) => assertRegistryError(error, 'INCOMPLETE_RAGFLOW_MAPPING'),
    );
  });
});

test('PH3-13C2 健康标记原子写入 binding、版本三维状态和不可变审计', async () => {
  await withRegistry(({ registry, store }) => {
    createProcessingVersion(store, {
      canonicalId: 'mat-healthy',
      versionId: 'ver-healthy',
      contentHash: 'c'.repeat(64),
    });
    store.transitionVersionState('ver-healthy', { errorMessage: '旧错误' }, audit);
    store.ensureUnhealthyPendingBinding({
      versionId: 'ver-healthy',
      indexGeneration: 'generation-1',
      datasetId: 'dataset-stage',
      documentId: 'doc-healthy',
      audit,
    });
    const healthy = store.markPendingBindingHealthy({
      versionId: 'ver-healthy',
      indexGeneration: 'generation-1',
      datasetId: 'dataset-stage',
      documentId: 'doc-healthy',
      chunkCount: 8,
      lastVerifiedAt: '2026-07-11T08:01:00.000Z',
      audit,
    });
    assert.equal(healthy.isHealthy, true);
    assert.equal(healthy.remoteRunStatus, 'DONE');
    assert.equal(healthy.chunkCount, 8);
    assert.equal(healthy.lastVerifiedAt, '2026-07-11T08:01:00.000Z');
    const version = store.getMaterialVersion('ver-healthy');
    assert.equal(version.workflowStatus, 'quality_check');
    assert.equal(version.processingHealth, 'healthy');
    assert.equal(version.indexPublicationStatus, 'pending');
    assert.equal(version.errorMessage, null);
    assert.equal(version.lastVerifiedAt, '2026-07-11T08:01:00.000Z');
    assert.equal(
      Number(registry.connection
        .prepare('SELECT COUNT(*) FROM material_publications WHERE version_id = ?')
        .pluck()
        .get('ver-healthy')),
      0,
    );
    assert.equal(
      store.markPendingBindingHealthy({
        versionId: 'ver-healthy',
        indexGeneration: 'generation-1',
        datasetId: 'dataset-stage',
        documentId: 'doc-healthy',
        chunkCount: 8,
        lastVerifiedAt: '2026-07-11T08:02:00.000Z',
        audit,
      }).lastVerifiedAt,
      '2026-07-11T08:01:00.000Z',
    );
    assert.throws(
      () => store.ensureUnhealthyPendingBinding({
        versionId: 'ver-healthy',
        indexGeneration: 'generation-1',
        datasetId: 'dataset-stage',
        documentId: 'doc-healthy',
        audit,
      }),
      (error) => assertRegistryError(error, 'INCOMPLETE_RAGFLOW_MAPPING'),
    );
  });
});

test('PH3-13C2 已存在 publication 时健康收口失败且不留下半提交', async () => {
  await withRegistry(({ registry, store }) => {
    createProcessingVersion(store, {
      canonicalId: 'mat-publication-block',
      versionId: 'ver-publication-block',
      contentHash: 'd'.repeat(64),
    });
    store.ensureUnhealthyPendingBinding({
      versionId: 'ver-publication-block',
      indexGeneration: 'generation-1',
      datasetId: 'dataset-stage',
      documentId: 'doc-blocked',
      audit,
    });
    registry.connection.prepare(`
      INSERT INTO material_publications (
        publication_id, release_id, canonical_id, publication_branch_key, version_id,
        publication_status, created_at, updated_at
      ) VALUES ('pub-blocked', 'rel-blocked', 'mat-publication-block', 'default',
        'ver-publication-block', 'archived', '2026-07-11T08:00:00.000Z', '2026-07-11T08:00:00.000Z')
    `).run();
    assert.throws(
      () => store.markPendingBindingHealthy({
        versionId: 'ver-publication-block',
        indexGeneration: 'generation-1',
        datasetId: 'dataset-stage',
        documentId: 'doc-blocked',
        chunkCount: 3,
        lastVerifiedAt: '2026-07-11T08:01:00.000Z',
        audit,
      }),
      (error) => assertRegistryError(error, 'PUBLICATION_PRECONDITION_FAILED'),
    );
    assert.equal(store.findPendingBinding({
      versionId: 'ver-publication-block',
      indexGeneration: 'generation-1',
    })?.isHealthy, false);
    assert.equal(store.getMaterialVersion('ver-publication-block').processingHealth, 'processing');
  });
});

test('PH3-13C2 parse_wait 在一个事务完成 binding、版本和 job，并支持提交后幂等回读', async () => {
  await withRegistry(({ store }) => {
    createProcessingVersion(store, {
      canonicalId: 'mat-parse-wait',
      versionId: 'ver-parse-wait',
      contentHash: 'e'.repeat(64),
    });
    store.ensureUnhealthyPendingBinding({
      versionId: 'ver-parse-wait',
      indexGeneration: 'generation-1',
      datasetId: 'dataset-stage',
      documentId: 'doc-parse-wait',
      audit,
    });
    store.enqueueJob({
      jobId: 'job-parse-wait',
      versionId: 'ver-parse-wait',
      stage: 'parse_wait',
      inputHash: 'artifact-hash',
      profileVersion: 'basic-v1',
      audit,
    });
    store.claimNextJob({
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      stages: ['parse_wait'],
      audit,
    });
    const completed = store.completeParseWaitJob({
      jobId: 'job-parse-wait',
      workerId: 'worker-a',
      versionId: 'ver-parse-wait',
      indexGeneration: 'generation-1',
      datasetId: 'dataset-stage',
      documentId: 'doc-parse-wait',
      chunkCount: 5,
      lastVerifiedAt: '2026-07-11T08:01:00.000Z',
      audit,
    });
    assert.equal(completed.status, 'succeeded');
    assert.equal(store.getMaterialVersion('ver-parse-wait').workflowStatus, 'quality_check');
    assert.equal(store.findPendingBinding({
      versionId: 'ver-parse-wait',
      indexGeneration: 'generation-1',
    })?.remoteRunStatus, 'DONE');
    assert.equal(store.completeParseWaitJob({
      jobId: 'job-parse-wait',
      workerId: 'worker-a',
      versionId: 'ver-parse-wait',
      indexGeneration: 'generation-1',
      datasetId: 'dataset-stage',
      documentId: 'doc-parse-wait',
      chunkCount: 5,
      lastVerifiedAt: '2026-07-11T08:01:00.000Z',
      audit,
    }).status, 'succeeded');
  });
});

test('PH3-13C2 parse_wait 租约核验失败时回滚 binding 与版本更新', async () => {
  await withRegistry(({ store }) => {
    createProcessingVersion(store, {
      canonicalId: 'mat-rollback',
      versionId: 'ver-rollback',
      contentHash: 'f'.repeat(64),
    });
    store.ensureUnhealthyPendingBinding({
      versionId: 'ver-rollback',
      indexGeneration: 'generation-1',
      datasetId: 'dataset-stage',
      documentId: 'doc-rollback',
      audit,
    });
    store.enqueueJob({
      jobId: 'job-rollback',
      versionId: 'ver-rollback',
      stage: 'parse_wait',
      inputHash: 'artifact-hash',
      profileVersion: 'basic-v1',
      audit,
    });
    store.claimNextJob({ workerId: 'worker-a', leaseDurationMs: 60_000, stages: ['parse_wait'], audit });
    assert.throws(
      () => store.completeParseWaitJob({
        jobId: 'job-rollback',
        workerId: 'worker-b',
        versionId: 'ver-rollback',
        indexGeneration: 'generation-1',
        datasetId: 'dataset-stage',
        documentId: 'doc-rollback',
        chunkCount: 5,
        lastVerifiedAt: '2026-07-11T08:01:00.000Z',
        audit,
      }),
      (error) => assertRegistryError(error, 'JOB_STATE_CONFLICT'),
    );
    assert.equal(store.findPendingBinding({
      versionId: 'ver-rollback',
      indexGeneration: 'generation-1',
    })?.isHealthy, false);
    assert.equal(store.getMaterialVersion('ver-rollback').processingHealth, 'processing');
    assert.equal(store.getProcessingJob('job-rollback').status, 'running');
  });
});

test('PH3-13C2 停机释放不消耗尝试次数，过期租约满尝试会终态失败', async () => {
  await withRegistry(({ store, clock }) => {
    createProcessingVersion(store, {
      canonicalId: 'mat-job-recovery',
      versionId: 'ver-job-recovery',
      contentHash: '1'.repeat(64),
    });
    store.enqueueJob({
      jobId: 'job-release',
      versionId: 'ver-job-recovery',
      stage: 'upload',
      inputHash: 'input-release',
      profileVersion: 'basic-v1',
      maxAttempts: 1,
      audit,
    });
    store.claimNextJob({ workerId: 'worker-a', leaseDurationMs: 1_000, stages: ['upload'], audit });
    const released = store.releaseJobForShutdown({ jobId: 'job-release', workerId: 'worker-a', audit });
    assert.equal(released.status, 'queued');
    assert.equal(released.attemptCount, 0);
    assert.equal(
      store.claimNextJob({ workerId: 'worker-b', leaseDurationMs: 1_000, stages: ['upload'], audit })?.jobId,
      'job-release',
    );
    clock.advance(1_001);
    const recovered = store.recoverExpiredJobs(audit);
    assert.equal(recovered[0]?.status, 'failed');
    assert.equal(recovered[0]?.errorCode, 'PROCESSING_RETRY_EXHAUSTED');
    assert.equal(store.getMaterialVersion('ver-job-recovery').processingHealth, 'failed');
    assert.equal(store.claimNextJob({
      workerId: 'worker-c',
      leaseDurationMs: 1_000,
      stages: ['upload'],
      audit,
    }), null);

    createProcessingVersion(store, {
      canonicalId: 'mat-cancel-recovery',
      versionId: 'ver-cancel-recovery',
      contentHash: '4'.repeat(64),
    });
    store.enqueueJob({
      jobId: 'job-cancel-recovery',
      versionId: 'ver-cancel-recovery',
      stage: 'upload',
      inputHash: 'input-cancel-recovery',
      profileVersion: 'basic-v1',
      audit,
    });
    store.claimNextJob({ workerId: 'worker-d', leaseDurationMs: 1_000, stages: ['upload'], audit });
    store.requestJobCancellation('job-cancel-recovery', audit);
    clock.advance(1_001);
    const cancelledRecovery = store.recoverExpiredJobs(audit);
    assert.equal(cancelledRecovery[0]?.status, 'cancelled');
    assert.equal(store.getMaterialVersion('ver-cancel-recovery').processingHealth, 'failed');
    assert.match(store.getMaterialVersion('ver-cancel-recovery').errorMessage ?? '', /CANCELLED/);
  });
});

test('PH3-13C2 job 失败重试与取消会原子同步版本健康和安全错误', async () => {
  await withRegistry(({ store, clock }) => {
    createProcessingVersion(store, {
      canonicalId: 'mat-job-state',
      versionId: 'ver-job-state',
      contentHash: '2'.repeat(64),
    });
    store.enqueueJob({
      jobId: 'job-fail',
      versionId: 'ver-job-state',
      stage: 'upload',
      inputHash: 'input-fail',
      profileVersion: 'basic-v1',
      maxAttempts: 2,
      audit,
    });
    store.claimNextJob({ workerId: 'worker-a', leaseDurationMs: 60_000, stages: ['upload'], audit });
    const retryAt = new Date(clock.now().getTime() + 1_000).toISOString();
    const retrying = store.failJobAndUpdateVersion({
      jobId: 'job-fail',
      workerId: 'worker-a',
      errorCode: 'REMOTE_TRANSIENT',
      errorMessage: 'Bearer secret-value 网络暂时不可用',
      retryAt,
      audit,
    });
    assert.equal(retrying.nextRetryAt, retryAt);
    assert.equal(store.getMaterialVersion('ver-job-state').processingHealth, 'processing');
    assert.equal(store.getMaterialVersion('ver-job-state').errorMessage?.includes('secret-value'), false);
    clock.advance(1_000);
    store.claimNextJob({ workerId: 'worker-b', leaseDurationMs: 60_000, stages: ['upload'], audit });
    const terminal = store.failJobAndUpdateVersion({
      jobId: 'job-fail',
      workerId: 'worker-b',
      errorCode: 'REMOTE_CONTRACT',
      errorMessage: '不可重试',
      retryAt: new Date(clock.now().getTime() + 1_000).toISOString(),
      audit,
    });
    assert.equal(terminal.nextRetryAt, null);
    assert.equal(store.getMaterialVersion('ver-job-state').processingHealth, 'failed');

    createProcessingVersion(store, {
      canonicalId: 'mat-cancel',
      versionId: 'ver-cancel',
      contentHash: '3'.repeat(64),
    });
    store.enqueueJob({
      jobId: 'job-cancel',
      versionId: 'ver-cancel',
      stage: 'extraction',
      inputHash: 'input-cancel',
      profileVersion: 'basic-v1',
      audit,
    });
    store.claimNextJob({ workerId: 'worker-c', leaseDurationMs: 60_000, stages: ['extraction'], audit });
    store.requestJobCancellation('job-cancel', audit);
    const cancelled = store.acknowledgeJobCancellationAndUpdateVersion({
      jobId: 'job-cancel',
      workerId: 'worker-c',
      errorMessage: '用户取消了处理。',
      audit,
    });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(store.getMaterialVersion('ver-cancel').processingHealth, 'failed');
    assert.match(store.getMaterialVersion('ver-cancel').errorMessage ?? '', /CANCELLED/);
  });
});

test('PH3-13C2 metadata builder 覆盖方案最小字段并保留现有人工元数据', async () => {
  await withRegistry(({ store }) => {
    createProcessingVersion(store, {
      canonicalId: 'mat-metadata',
      versionId: 'ver-metadata',
      contentHash: 'A'.repeat(64),
      parserProfile: 'parser-v2',
      embeddingProfile: 'embedding-v3',
      profileBundleHash: 'bundle-hash',
      metadata: {
        stableTitle: '七年级英语上册',
        domain: '教育',
        subject: '英语',
        materialType: '教材',
        language: '中文',
        educationStage: '初中',
        grade: '七年级',
        semester: '上学期',
        edition: '人教版',
        unit: 'Unit 1',
        status: 'active',
        canonical_id: '伪造身份',
      },
    });
    const metadata = buildLayout3PendingMetadata(
      store.getMaterialVersion('ver-metadata'),
      'generation-2026-07',
    );
    assert.equal(metadata.metadata_schema, 'layout3_ingestion_v1');
    assert.equal(metadata.status, 'pending');
    assert.equal(metadata.canonical_id, 'mat-metadata');
    assert.equal(metadata.publication_branch_key, 'default');
    assert.equal(metadata.version_id, 'ver-metadata');
    assert.equal(metadata.version_no, 1);
    assert.equal(metadata.source_hash, 'a'.repeat(64));
    assert.equal(metadata.parser_profile, 'parser-v2');
    assert.equal(metadata.embedding_profile, 'embedding-v3');
    assert.equal(metadata.profile_bundle_hash, 'bundle-hash');
    assert.equal(metadata.stable_title, '七年级英语上册');
    assert.equal(metadata.material_type, '教材');
    assert.equal(metadata.education_stage, '初中');
    assert.equal(metadata.curriculum_year, null);
    assert.equal(metadata.chapter, null);
    assert.equal(metadata.effective_from, null);
    assert.equal(metadata.effective_to, null);
  });
});
