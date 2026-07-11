import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRegistryDatabase, type RegistryDatabase } from './registry-database';
import { RegistryStore } from './registry-store';
import { REGISTRY_SCHEMA_VERSION } from './schema';
import { RegistryError } from './types';

const audit = { actorId: 'test:user', reason: 'PH3-13B 自动验收' };

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
  return (prefix) => `${prefix}_test_${++sequence}`;
}

async function withRegistry(
  run: (context: {
    registry: RegistryDatabase;
    store: RegistryStore;
    root: string;
    clock: ReturnType<typeof createClock>;
  }) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'layout3-registry-test-'));
  const clock = createClock();
  let registry: RegistryDatabase | null = null;

  try {
    registry = await openRegistryDatabase({
      databasePath: join(root, 'registry.sqlite'),
      backupDirectory: join(root, 'backups'),
      now: clock.now,
      allowTestProcess: true,
    });
    const store = new RegistryStore(registry, { now: clock.now, createId: createIdFactory() });
    await run({ registry, store, root, clock });
  } finally {
    registry?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

async function withReopenableRegistry(
  run: (context: {
    readonly registry: RegistryDatabase;
    readonly store: RegistryStore;
    clock: ReturnType<typeof createClock>;
    reopen: () => Promise<void>;
  }) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'layout3-registry-recovery-test-'));
  const databasePath = join(root, 'registry.sqlite');
  const clock = createClock();
  const createId = createIdFactory();
  const state: {
    registry: RegistryDatabase | null;
    store: RegistryStore | null;
  } = { registry: null, store: null };

  const open = async (): Promise<void> => {
    state.registry = await openRegistryDatabase({
      databasePath,
      backupDirectory: join(root, 'backups'),
      now: clock.now,
      allowTestProcess: true,
    });
    state.store = new RegistryStore(state.registry, { now: clock.now, createId });
  };

  try {
    await open();
    await run({
      get registry() {
        return state.registry!;
      },
      get store() {
        return state.store!;
      },
      clock,
      reopen: async () => {
        state.registry?.close();
        state.registry = null;
        state.store = null;
        await open();
      },
    });
  } finally {
    state.registry?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function createMaterialAndBranch(
  store: RegistryStore,
  input: {
    canonicalId: string;
    branchKey: string;
    branchType?: 'default' | 'edition' | 'curriculum' | 'legal';
  },
): void {
  store.createMaterial({
    canonicalId: input.canonicalId,
    stableTitle: `${input.canonicalId} 测试资料`,
    domain: 'education',
    audit,
  });
  store.createPublicationBranch({
    canonicalId: input.canonicalId,
    branchKey: input.branchKey,
    branchType: input.branchType ?? 'edition',
    displayName: input.branchKey,
    isDefault: true,
    audit,
  });
}

function createReadyVersion(
  registry: RegistryDatabase,
  store: RegistryStore,
  input: {
    versionId: string;
    canonicalId: string;
    branchKey: string;
    contentHash: string;
  },
): void {
  store.createMaterialVersion({
    versionId: input.versionId,
    canonicalId: input.canonicalId,
    publicationBranchKey: input.branchKey,
    contentHash: input.contentHash,
    metadata: { subject: '英语' },
    audit,
  });
  store.transitionVersionState(input.versionId, { workflowStatus: 'pending_confirmation' }, audit);
  store.transitionVersionState(
    input.versionId,
    { workflowStatus: 'processing', processingHealth: 'processing' },
    audit,
  );
  store.transitionVersionState(
    input.versionId,
    { workflowStatus: 'quality_check', processingHealth: 'healthy' },
    audit,
  );
  // 这些 PH3-13B 用例只验证发布关系与回滚；待发布质量门禁由 C3 仓储测试单独覆盖。
  registry.connection
    .prepare("UPDATE material_versions SET workflow_status = 'pending_publication' WHERE version_id = ?")
    .run(input.versionId);
}

function createRunningQualityRecoveryFixture(
  registry: RegistryDatabase,
  store: RegistryStore,
  clock: ReturnType<typeof createClock>,
  input: {
    versionId: string;
    jobId: string;
    qualityRunId: string;
    workerId: string;
    maxAttempts: number;
  },
): void {
  const canonicalId = `mat-${input.versionId}`;
  createMaterialAndBranch(store, { canonicalId, branchKey: 'default' });
  store.createMaterialVersion({
    versionId: input.versionId,
    canonicalId,
    publicationBranchKey: 'default',
    contentHash: `sha256:${input.versionId}`,
    parserProfile: 'quality-profile-v1',
    audit,
  });
  store.transitionVersionState(input.versionId, { workflowStatus: 'pending_confirmation' }, audit);
  store.transitionVersionState(
    input.versionId,
    { workflowStatus: 'processing', processingHealth: 'processing' },
    audit,
  );
  store.transitionVersionState(
    input.versionId,
    { workflowStatus: 'quality_check', processingHealth: 'healthy' },
    audit,
  );
  const bindingId = store.bindRagflowDocument({
    bindingId: `binding-${input.versionId}`,
    versionId: input.versionId,
    indexGeneration: 'generation-staging-1',
    datasetId: 'dataset-staging',
    documentId: `document-${input.versionId}`,
    remoteStatus: 'pending',
    isHealthy: true,
    lastVerifiedAt: clock.now().toISOString(),
    audit,
  });
  store.enqueueJob({
    jobId: input.jobId,
    versionId: input.versionId,
    stage: 'quality',
    inputHash: `input-${input.jobId}`,
    profileVersion: 'quality-profile-v1',
    maxAttempts: input.maxAttempts,
    audit,
  });
  const claimed = store.claimNextJob({
    workerId: input.workerId,
    leaseDurationMs: 60_000,
    stages: ['quality'],
    audit,
  });
  assert.equal(claimed?.jobId, input.jobId);

  const timestamp = clock.now().toISOString();
  registry.connection
    .prepare(`
      INSERT INTO quality_runs (
        quality_run_id, version_id, job_id, binding_id, status, conclusion,
        binding_snapshot_json, questions_snapshot_json, input_snapshot_json,
        profile_snapshot_json, config_snapshot_json, expires_at, started_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'running', NULL, ?, '[]', ?, ?, '{}', ?, ?, ?, ?)
    `)
    .run(
      input.qualityRunId,
      input.versionId,
      input.jobId,
      bindingId,
      JSON.stringify({
        bindingId,
        datasetId: 'dataset-staging',
        documentId: `document-${input.versionId}`,
      }),
      JSON.stringify({ request: {}, requiredBlockingResultKeys: [], artifacts: [] }),
      JSON.stringify({ parserProfile: 'quality-profile-v1', request: {} }),
      new Date(clock.now().getTime() + 5 * 60_000).toISOString(),
      timestamp,
      timestamp,
      timestamp,
    );
}

function bindActiveDocument(
  store: RegistryStore,
  versionId: string,
  documentId: string,
  datasetId = 'dataset-live',
): void {
  store.bindRagflowDocument({
    versionId,
    indexGeneration: 'generation-1',
    datasetId,
    documentId,
    remoteStatus: 'active',
    isHealthy: true,
    lastVerifiedAt: '2026-07-11T00:00:00.000Z',
    audit,
  });
}

function assertRegistryError(error: unknown, code: RegistryError['code']): boolean {
  return error instanceof RegistryError && error.code === code;
}

test('PH3-13B 迁移前会备份旧库，并启用正式 SQLite 基础设置', async () => {
  const root = mkdtempSync(join(tmpdir(), 'layout3-registry-migration-test-'));
  const databasePath = join(root, 'registry.sqlite');
  const backupDirectory = join(root, 'backups');
  const legacyDatabase = new Database(databasePath);
  legacyDatabase.exec('CREATE TABLE legacy_marker (value TEXT NOT NULL); INSERT INTO legacy_marker VALUES (\'kept\');');
  legacyDatabase.close();

  let registry: RegistryDatabase | null = null;
  try {
    registry = await openRegistryDatabase({
      databasePath,
      backupDirectory,
      now: () => new Date('2026-07-11T00:00:00.000Z'),
      allowTestProcess: true,
    });

    assert.ok(registry.migrationBackupPath);
    assert.equal(existsSync(registry.migrationBackupPath), true);
    assert.equal(Number(registry.connection.pragma('foreign_keys', { simple: true })), 1);
    assert.equal(String(registry.connection.pragma('journal_mode', { simple: true })), 'wal');
    assert.equal(Number(registry.connection.pragma('busy_timeout', { simple: true })), 5000);
    assert.equal(String(registry.connection.pragma('integrity_check', { simple: true })), 'ok');
    assert.equal(
      Number(registry.connection.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()),
      REGISTRY_SCHEMA_VERSION,
    );

    const tables = registry.connection
      .prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'materials', 'material_versions', 'publication_branches', 'material_publications',
          'ragflow_bindings', 'audit_events', 'processing_jobs'
        )
      `)
      .pluck()
      .all();
    assert.equal(tables.length, 7);

    const backup = new Database(registry.migrationBackupPath!, { readonly: true });
    assert.equal(backup.prepare('SELECT value FROM legacy_marker').pluck().get(), 'kept');
    assert.equal(
      backup.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'materials'").pluck().get(),
      0,
    );
    backup.close();

    const restoredPath = join(root, 'restored.sqlite');
    copyFileSync(registry.migrationBackupPath!, restoredPath);
    const restoredRegistry = await openRegistryDatabase({
      databasePath: restoredPath,
      backupDirectory,
      now: () => new Date('2026-07-11T00:01:00.000Z'),
      allowTestProcess: true,
    });
    try {
      assert.equal(restoredRegistry.connection.prepare('SELECT value FROM legacy_marker').pluck().get(), 'kept');
      assert.equal(
        Number(restoredRegistry.connection.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()),
        REGISTRY_SCHEMA_VERSION,
      );
      assert.equal(String(restoredRegistry.connection.pragma('integrity_check', { simple: true })), 'ok');
    } finally {
      restoredRegistry.close();
    }
  } finally {
    registry?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('PH3-13B 登记库拒绝非 Main 且未显式授权的测试进程', async () => {
  const root = mkdtempSync(join(tmpdir(), 'layout3-registry-owner-test-'));
  try {
    await assert.rejects(
      openRegistryDatabase({ databasePath: join(root, 'registry.sqlite') }),
      (error) => assertRegistryError(error, 'DATABASE_OWNER_VIOLATION'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PH3-13B 资料版本按分支递增，并全局阻止重复 content_hash', async () => {
  await withRegistry(({ store }) => {
    store.createMaterial({ canonicalId: 'mat-textbook', stableTitle: '英语教材', domain: 'education', audit });
    store.createPublicationBranch({
      canonicalId: 'mat-textbook',
      branchKey: 'edition-2025',
      branchType: 'edition',
      displayName: '2025 版',
      isDefault: true,
      audit,
    });
    store.createPublicationBranch({
      canonicalId: 'mat-textbook',
      branchKey: 'edition-2026',
      branchType: 'edition',
      displayName: '2026 版',
      audit,
    });

    const first = store.createMaterialVersion({
      versionId: 'ver-2025-1',
      canonicalId: 'mat-textbook',
      publicationBranchKey: 'edition-2025',
      contentHash: 'sha256:2025-1',
      audit,
    });
    const second = store.createMaterialVersion({
      versionId: 'ver-2025-2',
      canonicalId: 'mat-textbook',
      publicationBranchKey: 'edition-2025',
      contentHash: 'sha256:2025-2',
      audit,
    });
    const otherBranch = store.createMaterialVersion({
      versionId: 'ver-2026-1',
      canonicalId: 'mat-textbook',
      publicationBranchKey: 'edition-2026',
      contentHash: 'sha256:2026-1',
      audit,
    });

    assert.equal(first.versionNo, 1);
    assert.equal(second.versionNo, 2);
    assert.equal(second.previousVersionId, first.versionId);
    assert.equal(otherBranch.versionNo, 1);
    assert.throws(
      () => store.createMaterialVersion({
        canonicalId: 'mat-textbook',
        publicationBranchKey: 'edition-2026',
        contentHash: 'sha256:2025-1',
        audit,
      }),
      (error) => assertRegistryError(error, 'DUPLICATE_CONTENT_HASH'),
    );
  });
});

test('PH3-13B 状态机拒绝跳级，并保护分支内唯一发布版本', async () => {
  await withRegistry(({ registry, store }) => {
    createMaterialAndBranch(store, { canonicalId: 'mat-state', branchKey: 'edition-a' });
    store.createMaterialVersion({
      versionId: 'ver-state',
      canonicalId: 'mat-state',
      publicationBranchKey: 'edition-a',
      contentHash: 'sha256:state',
      audit,
    });
    assert.throws(
      () => store.transitionVersionState('ver-state', { workflowStatus: 'quality_check' }, audit),
      (error) => assertRegistryError(error, 'INVALID_STATE_TRANSITION'),
    );

    createReadyVersion(registry, store, {
      versionId: 'ver-published',
      canonicalId: 'mat-state',
      branchKey: 'edition-a',
      contentHash: 'sha256:published',
    });
    store.publishVersion({ versionId: 'ver-published', publicationId: 'pub-only', audit });
    assert.throws(
      () => store.transitionVersionState(
        'ver-published',
        { workflowStatus: 'quarantined', indexPublicationStatus: 'superseded' },
        audit,
      ),
      (error) => assertRegistryError(error, 'LAST_ACTIVE_PUBLICATION'),
    );
    assert.equal(store.getMaterialVersion('ver-published').workflowStatus, 'published');

    const auditEventId = String(store.listAuditEvents('material_version', 'ver-published')[0]?.event_id);
    assert.throws(
      () => registry.connection.prepare('UPDATE audit_events SET reason = ? WHERE event_id = ?').run('覆盖', auditEventId),
      /AUDIT_EVENTS_ARE_IMMUTABLE/,
    );
    assert.throws(
      () => registry.connection.prepare('DELETE FROM audit_events WHERE event_id = ?').run(auditEventId),
      /AUDIT_EVENTS_ARE_IMMUTABLE/,
    );
  });
});

test('PH3-13B 教材分支可并存，同分支替代与回滚会原子切换路线 A ID', async () => {
  await withRegistry(({ registry, store }) => {
    store.createMaterial({ canonicalId: 'mat-english', stableTitle: '英语教材', domain: 'education', audit });
    for (const branchKey of ['edition-a', 'edition-b']) {
      store.createPublicationBranch({
        canonicalId: 'mat-english',
        branchKey,
        branchType: 'edition',
        displayName: branchKey,
        isDefault: branchKey === 'edition-a',
        audit,
      });
    }

    createReadyVersion(registry, store, {
      versionId: 'ver-a1',
      canonicalId: 'mat-english',
      branchKey: 'edition-a',
      contentHash: 'sha256:a1',
    });
    bindActiveDocument(store, 'ver-a1', 'doc-a1');
    store.publishVersion({ versionId: 'ver-a1', publicationId: 'pub-a1', audit });

    createReadyVersion(registry, store, {
      versionId: 'ver-a2',
      canonicalId: 'mat-english',
      branchKey: 'edition-a',
      contentHash: 'sha256:a2',
    });
    bindActiveDocument(store, 'ver-a2', 'doc-a2');
    store.publishVersion({ versionId: 'ver-a2', publicationId: 'pub-a2', audit });

    createReadyVersion(registry, store, {
      versionId: 'ver-b1',
      canonicalId: 'mat-english',
      branchKey: 'edition-b',
      contentHash: 'sha256:b1',
    });
    bindActiveDocument(store, 'ver-b1', 'doc-b1', 'dataset-edition-b');
    store.publishVersion({ versionId: 'ver-b1', publicationId: 'pub-b1', audit });

    assert.equal(store.getMaterialVersion('ver-a1').workflowStatus, 'superseded');
    assert.deepEqual(
      store.resolveActiveRetrievalScope({ branchKeys: ['edition-a'] }).documentIds,
      ['doc-a2'],
    );
    assert.deepEqual(
      store.resolveActiveRetrievalScope().documentIds,
      ['doc-a2', 'doc-b1'],
    );

    assert.deepEqual(
      store.validateReturnedDocumentIds(['doc-a2', 'doc-a1', 'unknown'], { branchKeys: ['edition-a'] }),
      {
        acceptedDocumentIds: ['doc-a2'],
        rejectedDocumentIds: ['doc-a1', 'unknown'],
      },
    );

    store.rollbackPublication({
      currentPublicationId: 'pub-a2',
      targetPublicationId: 'pub-a1',
      quarantineCurrent: true,
      audit: { actorId: 'test:user', reason: '回滚有问题的新修订' },
    });
    assert.equal(store.getMaterialVersion('ver-a1').workflowStatus, 'published');
    assert.equal(store.getMaterialVersion('ver-a2').workflowStatus, 'quarantined');
    assert.deepEqual(
      store.resolveActiveRetrievalScope({ branchKeys: ['edition-a'] }).documentIds,
      ['doc-a1'],
    );
  });
});

test('PH3-13B 法规有效区间可并存，但数据库拒绝歧义重叠', async () => {
  await withRegistry(({ registry, store }) => {
    createMaterialAndBranch(store, {
      canonicalId: 'mat-regulation',
      branchKey: 'legal-main',
      branchType: 'legal',
    });
    for (const [versionId, hash, documentId] of [
      ['ver-legal-1', 'sha256:legal-1', 'doc-legal-1'],
      ['ver-legal-2', 'sha256:legal-2', 'doc-legal-2'],
      ['ver-legal-3', 'sha256:legal-3', 'doc-legal-3'],
    ]) {
      createReadyVersion(registry, store, {
        versionId,
        canonicalId: 'mat-regulation',
        branchKey: 'legal-main',
        contentHash: hash,
      });
      bindActiveDocument(store, versionId, documentId);
    }

    store.publishVersion({
      versionId: 'ver-legal-1',
      publicationId: 'pub-legal-1',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-07-01T00:00:00.000Z',
      audit,
    });
    store.publishVersion({
      versionId: 'ver-legal-2',
      publicationId: 'pub-legal-2',
      effectiveFrom: '2026-07-01T00:00:00.000Z',
      effectiveTo: null,
      audit,
    });
    assert.throws(
      () => store.publishVersion({
        versionId: 'ver-legal-3',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        effectiveTo: '2026-08-01T00:00:00.000Z',
        audit,
      }),
      (error) => assertRegistryError(error, 'PUBLICATION_CONFLICT'),
    );
    assert.equal(store.getMaterialVersion('ver-legal-3').workflowStatus, 'pending_publication');
    assert.throws(
      () => store.transitionVersionState(
        'ver-legal-1',
        { workflowStatus: 'quarantined', indexPublicationStatus: 'superseded' },
        audit,
      ),
      (error) => assertRegistryError(error, 'LAST_ACTIVE_PUBLICATION'),
    );
    assert.deepEqual(
      store.resolveActiveRetrievalScope({ effectiveAt: '2026-05-01T00:00:00.000Z' }).documentIds,
      ['doc-legal-1'],
    );
    assert.deepEqual(
      store.resolveActiveRetrievalScope({ effectiveAt: '2026-08-01T00:00:00.000Z' }).documentIds,
      ['doc-legal-2'],
    );
  });
});

test('PH3-13B 路线 A 在空集合或映射不完整时本地失败关闭', async () => {
  await withRegistry(({ registry, store }) => {
    assert.throws(
      () => store.resolveActiveRetrievalScope(),
      (error) => assertRegistryError(error, 'EMPTY_ACTIVE_DOCUMENT_SET'),
    );

    createMaterialAndBranch(store, { canonicalId: 'mat-incomplete', branchKey: 'edition-a' });
    createReadyVersion(registry, store, {
      versionId: 'ver-incomplete',
      canonicalId: 'mat-incomplete',
      branchKey: 'edition-a',
      contentHash: 'sha256:incomplete',
    });
    store.publishVersion({ versionId: 'ver-incomplete', publicationId: 'pub-incomplete', audit });
    assert.throws(
      () => store.resolveActiveRetrievalScope(),
      (error) => assertRegistryError(error, 'INCOMPLETE_RAGFLOW_MAPPING'),
    );
  });
});

test('PH3-13B 持久任务支持租约、关闭重开恢复、重试和取消', async () => {
  const root = mkdtempSync(join(tmpdir(), 'layout3-registry-job-test-'));
  const databasePath = join(root, 'registry.sqlite');
  const clock = createClock();
  const ids = createIdFactory();
  let registry: RegistryDatabase | null = null;

  try {
    registry = await openRegistryDatabase({ databasePath, now: clock.now, allowTestProcess: true });
    let store = new RegistryStore(registry, { now: clock.now, createId: ids });
    createMaterialAndBranch(store, { canonicalId: 'mat-job', branchKey: 'edition-a' });
    store.createMaterialVersion({
      versionId: 'ver-job',
      canonicalId: 'mat-job',
      publicationBranchKey: 'edition-a',
      contentHash: 'sha256:job',
      audit,
    });
    store.enqueueJob({
      jobId: 'job-main',
      versionId: 'ver-job',
      stage: 'conversion',
      inputHash: 'input-1',
      profileVersion: 'profile-1',
      maxAttempts: 3,
      audit,
    });
    const firstClaim = store.claimNextJob({ workerId: 'worker-a', leaseDurationMs: 60_000, audit });
    assert.equal(firstClaim?.status, 'running');
    assert.equal(firstClaim?.attemptCount, 1);
    store.heartbeatJob({ jobId: 'job-main', workerId: 'worker-a', leaseDurationMs: 60_000 });

    clock.advance(61_000);
    registry.close();
    registry = await openRegistryDatabase({ databasePath, now: clock.now, allowTestProcess: true });
    store = new RegistryStore(registry, { now: clock.now, createId: ids });
    const recovered = store.recoverExpiredJobs({ actorId: 'system:startup', reason: '应用启动恢复过期租约' });
    assert.equal(recovered[0]?.status, 'queued');

    const secondClaim = store.claimNextJob({ workerId: 'worker-b', leaseDurationMs: 60_000, audit });
    assert.equal(secondClaim?.attemptCount, 2);
    const retryAt = new Date(clock.now().getTime() + 30_000).toISOString();
    const failed = store.failJob({
      jobId: 'job-main',
      workerId: 'worker-b',
      errorCode: 'FILE_PROCESSING',
      errorMessage: '可重试转换失败',
      retryAt,
      audit,
    });
    assert.equal(failed.status, 'failed');
    assert.equal(store.claimNextJob({ workerId: 'worker-c', leaseDurationMs: 60_000, audit }), null);

    clock.advance(30_000);
    const thirdClaim = store.claimNextJob({ workerId: 'worker-c', leaseDurationMs: 60_000, audit });
    assert.equal(thirdClaim?.attemptCount, 3);
    assert.equal(store.requestJobCancellation('job-main', audit).status, 'cancel_requested');
    assert.equal(
      store.acknowledgeJobCancellation({ jobId: 'job-main', workerId: 'worker-c', audit }).status,
      'cancelled',
    );

    store.enqueueJob({
      jobId: 'job-queued-cancel',
      versionId: 'ver-job',
      stage: 'quality',
      inputHash: 'input-2',
      profileVersion: 'profile-1',
      audit,
    });
    assert.equal(store.requestJobCancellation('job-queued-cancel', audit).status, 'cancelled');
  } finally {
    registry?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('PH3-13C2 runner 只领取允许阶段，并原子衔接下一任务', async () => {
  await withRegistry(({ store }) => {
    createMaterialAndBranch(store, { canonicalId: 'mat-c2-runner', branchKey: 'default' });
    store.createMaterialVersion({
      versionId: 'ver-c2-runner',
      canonicalId: 'mat-c2-runner',
      publicationBranchKey: 'default',
      contentHash: 'sha256:c2-runner',
      audit,
    });
    store.enqueueJob({
      jobId: 'job-quality-future',
      versionId: 'ver-c2-runner',
      stage: 'quality',
      inputHash: 'quality-input',
      profileVersion: 'profile-1',
      audit,
    });
    store.enqueueJob({
      jobId: 'job-extraction-c2',
      versionId: 'ver-c2-runner',
      stage: 'extraction',
      inputHash: 'source-input',
      profileVersion: 'profile-1',
      audit,
    });

    const claimed = store.claimNextJob({
      workerId: 'worker-c2',
      leaseDurationMs: 60_000,
      stages: ['extraction', 'upload', 'parse_wait'],
      audit,
    });
    assert.equal(claimed?.jobId, 'job-extraction-c2');
    const chained = store.completeJobAndEnqueue({
      jobId: 'job-extraction-c2',
      workerId: 'worker-c2',
      nextStage: 'upload',
      nextInputHash: 'artifact-input',
      nextProfileVersion: 'profile-1',
      audit,
    });
    assert.equal(chained.completed.status, 'succeeded');
    assert.equal(chained.next.stage, 'upload');
    assert.equal(chained.next.status, 'queued');
    assert.deepEqual(
      store.listProcessingJobs('ver-c2-runner').map((job) => job.stage).sort(),
      ['extraction', 'quality', 'upload'],
    );

    assert.equal(store.requestJobCancellation('job-quality-future', audit).status, 'cancelled');
    assert.equal(store.retryJob('job-quality-future', audit).status, 'queued');
    assert.throws(
      () => store.retryJob(chained.next.jobId, audit),
      (error) => assertRegistryError(error, 'JOB_STATE_CONFLICT'),
    );
  });
});

test('PH3-13C3 quality 取消请求在重启恢复后同步取消 run/job，且不污染版本健康', async () => {
  await withReopenableRegistry(async (context) => {
    createRunningQualityRecoveryFixture(context.registry, context.store, context.clock, {
      versionId: 'ver-quality-cancel-recovery',
      jobId: 'job-quality-cancel-recovery',
      qualityRunId: 'run-quality-cancel-recovery',
      workerId: 'worker-quality-cancel-recovery',
      maxAttempts: 3,
    });
    assert.equal(
      context.store.requestJobCancellation('job-quality-cancel-recovery', audit).status,
      'cancel_requested',
    );

    context.clock.advance(61_000);
    await context.reopen();
    const recovered = context.store.recoverExpiredJobs({
      actorId: 'system:startup',
      reason: '应用启动恢复 quality 取消请求',
    });

    assert.equal(recovered[0]?.status, 'cancelled');
    assert.equal(context.store.getProcessingJob('job-quality-cancel-recovery').status, 'cancelled');
    assert.deepEqual(
      context.registry.connection
        .prepare(`
          SELECT status, conclusion, error_code
          FROM quality_runs WHERE quality_run_id = 'run-quality-cancel-recovery'
        `)
        .get(),
      { status: 'cancelled', conclusion: 'cancelled', error_code: 'CANCELLED' },
    );
    assert.equal(
      context.store.getMaterialVersion('ver-quality-cancel-recovery').processingHealth,
      'healthy',
    );
  });
});

test('PH3-13C3 quality 满尝试租约在重启恢复后同步失败 run/job，且不污染版本健康', async () => {
  await withReopenableRegistry(async (context) => {
    createRunningQualityRecoveryFixture(context.registry, context.store, context.clock, {
      versionId: 'ver-quality-exhausted-recovery',
      jobId: 'job-quality-exhausted-recovery',
      qualityRunId: 'run-quality-exhausted-recovery',
      workerId: 'worker-quality-exhausted-recovery',
      maxAttempts: 1,
    });

    context.clock.advance(61_000);
    await context.reopen();
    const recovered = context.store.recoverExpiredJobs({
      actorId: 'system:startup',
      reason: '应用启动恢复满尝试 quality 租约',
    });

    assert.equal(recovered[0]?.status, 'failed');
    assert.equal(recovered[0]?.errorCode, 'PROCESSING_RETRY_EXHAUSTED');
    assert.deepEqual(
      context.registry.connection
        .prepare(`
          SELECT status, conclusion, error_code
          FROM quality_runs WHERE quality_run_id = 'run-quality-exhausted-recovery'
        `)
        .get(),
      {
        status: 'failed',
        conclusion: 'technical_failure',
        error_code: 'PROCESSING_RETRY_EXHAUSTED',
      },
    );
    assert.equal(
      context.store.getMaterialVersion('ver-quality-exhausted-recovery').processingHealth,
      'healthy',
    );
  });
});

test('PH3-13C3 quality 可重排队租约在重启后保留同一 run 并恢复领取', async () => {
  await withReopenableRegistry(async (context) => {
    createRunningQualityRecoveryFixture(context.registry, context.store, context.clock, {
      versionId: 'ver-quality-requeue-recovery',
      jobId: 'job-quality-requeue-recovery',
      qualityRunId: 'run-quality-requeue-recovery',
      workerId: 'worker-quality-requeue-recovery',
      maxAttempts: 2,
    });

    context.clock.advance(61_000);
    await context.reopen();
    const recovered = context.store.recoverExpiredJobs({
      actorId: 'system:startup',
      reason: '应用启动恢复可重排队 quality 租约',
    });

    assert.equal(recovered[0]?.status, 'queued');
    assert.deepEqual(
      context.registry.connection
        .prepare(`
          SELECT quality_run_id, job_id, status, conclusion, completed_at
          FROM quality_runs WHERE version_id = 'ver-quality-requeue-recovery'
        `)
        .get(),
      {
        quality_run_id: 'run-quality-requeue-recovery',
        job_id: 'job-quality-requeue-recovery',
        status: 'running',
        conclusion: null,
        completed_at: null,
      },
    );
    const resumed = context.store.claimNextJob({
      workerId: 'worker-quality-requeue-resumed',
      leaseDurationMs: 60_000,
      stages: ['quality'],
      audit,
    });
    assert.equal(resumed?.jobId, 'job-quality-requeue-recovery');
    assert.equal(resumed?.attemptCount, 2);
    assert.equal(
      context.store.getMaterialVersion('ver-quality-requeue-recovery').processingHealth,
      'healthy',
    );
  });
});
