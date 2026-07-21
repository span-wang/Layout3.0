import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { RegistryDatabase } from './registry-database';
import {
  RegistryError,
  type MaterialVersionRecord,
  type ProcessingJobRecord,
  type PublicationOperationPhase,
  type PublicationOperationRecord,
  type PublicationOperationType,
} from './types';

interface PublicationOperationRepositoryOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
}

interface AuditContext {
  actorId: string;
  reason: string;
}

interface OperationRow {
  operation_id: string;
  job_id: string;
  operation_type: PublicationOperationType;
  canonical_id: string;
  publication_branch_key: string;
  target_version_id: string;
  current_version_id: string | null;
  quality_run_id: string;
  release_id: string;
  target_publication_id: string;
  current_publication_id: string | null;
  target_binding_id: string;
  current_binding_id: string | null;
  phase: PublicationOperationPhase;
  input_snapshot_json: string;
  config_snapshot_json: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface JobRow {
  job_id: string;
  version_id: string;
  stage: ProcessingJobRecord['stage'];
  status: ProcessingJobRecord['status'];
  input_hash: string;
  profile_version: string;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  cancel_requested_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface BindingRow {
  binding_id: string;
  version_id: string;
  index_generation: string;
  dataset_id: string;
  document_id: string;
  remote_status: 'pending' | 'active' | 'superseded' | 'archived';
  is_healthy: number;
  remote_run_status: string | null;
  chunk_count: number | null;
  last_verified_at: string | null;
}

interface PublicationRow {
  publication_id: string;
  canonical_id: string;
  publication_branch_key: string;
  version_id: string;
  publication_status: 'active' | 'superseded' | 'archived';
  effective_from: string | null;
  effective_to: string | null;
}

interface VersionIdentityRow {
  version_id: string;
  canonical_id: string;
  publication_branch_key: string;
  version_no: number;
  previous_version_id: string | null;
  workflow_status: MaterialVersionRecord['workflowStatus'];
  processing_health: MaterialVersionRecord['processingHealth'];
  index_publication_status: MaterialVersionRecord['indexPublicationStatus'];
}

const PHASE_TRANSITIONS: Record<PublicationOperationPhase, readonly PublicationOperationPhase[]> = {
  prepared: ['target_active_verified', 'restore_target_pending', 'restore_target_superseded'],
  target_active_verified: ['sqlite_switched', 'restore_target_pending', 'restore_target_superseded'],
  sqlite_switched: ['cleanup_verified'],
  cleanup_verified: ['completed'],
  restore_target_pending: ['failed'],
  restore_target_superseded: ['failed'],
  completed: [],
  failed: [],
};

function mapOperation(row: OperationRow): PublicationOperationRecord {
  return {
    operationId: row.operation_id,
    jobId: row.job_id,
    operationType: row.operation_type,
    canonicalId: row.canonical_id,
    publicationBranchKey: row.publication_branch_key,
    targetVersionId: row.target_version_id,
    currentVersionId: row.current_version_id,
    qualityRunId: row.quality_run_id,
    releaseId: row.release_id,
    targetPublicationId: row.target_publication_id,
    currentPublicationId: row.current_publication_id,
    targetBindingId: row.target_binding_id,
    currentBindingId: row.current_binding_id,
    phase: row.phase,
    inputSnapshot: JSON.parse(row.input_snapshot_json) as Record<string, unknown>,
    configSnapshot: JSON.parse(row.config_snapshot_json) as Record<string, unknown>,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapJob(row: JobRow): ProcessingJobRecord {
  return {
    jobId: row.job_id,
    versionId: row.version_id,
    stage: row.stage,
    status: row.status,
    inputHash: row.input_hash,
    profileVersion: row.profile_version,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextRetryAt: row.next_retry_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    heartbeatAt: row.heartbeat_at,
    cancelRequestedAt: row.cancel_requested_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isSensitiveKey(key: string): boolean {
  return /api.?key|authorization|token|secret|password/i.test(key);
}

function assertSafeSnapshot(value: unknown, path = 'configSnapshot'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeSnapshot(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      throw new RegistryError('INPUT_VALIDATION', `${path} 不能保存凭据字段 ${key}。`);
    }
    assertSafeSnapshot(child, `${path}.${key}`);
  }
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RegistryError('INPUT_VALIDATION', `${label} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

export interface CreatePublicationOperationInput {
  operationId?: string;
  jobId?: string;
  operationType: PublicationOperationType;
  canonicalId: string;
  publicationBranchKey: string;
  targetVersionId: string;
  currentVersionId?: string | null;
  qualityRunId: string;
  releaseId: string;
  targetPublicationId: string;
  currentPublicationId?: string | null;
  inputSnapshot: Record<string, unknown>;
  configSnapshot: Record<string, unknown>;
  inputHash: string;
  profileVersion?: string;
  maxAttempts?: number;
  audit: AuditContext;
}

export class PublicationOperationRepository {
  private readonly database: Database.Database;
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;

  constructor(registryDatabase: RegistryDatabase, options: PublicationOperationRepositoryOptions = {}) {
    this.database = registryDatabase.connection;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  createOperation(input: CreatePublicationOperationInput): {
    operation: PublicationOperationRecord;
    job: ProcessingJobRecord;
  } {
    const timestamp = this.now().toISOString();
    const operationId = input.operationId ?? this.createId('publication_operation');
    const jobId = input.jobId ?? this.createId('job');
    const currentVersionId = input.currentVersionId ?? null;
    const currentPublicationId = input.currentPublicationId ?? null;
    const inputSnapshot = assertRecord(input.inputSnapshot, 'inputSnapshot');
    const configSnapshot = assertRecord(input.configSnapshot, 'configSnapshot');
    assertSafeSnapshot(configSnapshot);

    try {
      return this.database.transaction(() => {
        const targetVersion = this.getVersionIdentity(input.targetVersionId);
        if (
          targetVersion.canonical_id !== input.canonicalId
          || targetVersion.publication_branch_key !== input.publicationBranchKey
          || targetVersion.workflow_status !== (input.operationType === 'publish' ? 'pending_publication' : 'superseded')
          || targetVersion.processing_health !== 'healthy'
          || targetVersion.index_publication_status !== (input.operationType === 'publish' ? 'pending' : 'superseded')
        ) {
          throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '目标版本分支或三维状态不符合发布操作要求。');
        }
        const qualityRun = this.database.prepare(`
          SELECT version_id, status, conclusion, expires_at
          FROM quality_runs WHERE quality_run_id = ?
        `).get(input.qualityRunId) as {
          version_id: string;
          status: string;
          conclusion: string | null;
          expires_at: string;
        } | undefined;
        if (
          !qualityRun
          || qualityRun.version_id !== input.targetVersionId
          || qualityRun.status !== 'passed'
          || qualityRun.conclusion !== 'passed'
          || (input.operationType === 'publish' && qualityRun.expires_at <= timestamp)
        ) {
          throw new RegistryError('QUALITY_BLOCK', '发布操作没有可用的目标质量结论。');
        }

        const targetBinding = this.getUniqueHealthyBinding(
          input.targetVersionId,
          input.operationType === 'publish' ? 'pending' : 'superseded',
        );
        let currentBinding: BindingRow | null = null;
        let currentVersion: VersionIdentityRow | null = null;
        if (currentVersionId) {
          currentVersion = this.getVersionIdentity(currentVersionId);
          if (
            currentVersion.canonical_id !== input.canonicalId
            || currentVersion.publication_branch_key !== input.publicationBranchKey
            || currentVersion.workflow_status !== 'published'
            || currentVersion.processing_health !== 'healthy'
            || currentVersion.index_publication_status !== 'active'
          ) {
            throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '当前版本分支或三维状态不符合发布操作要求。');
          }
          currentBinding = this.getUniqueHealthyBinding(currentVersionId, 'active');
        }

        if (input.operationType === 'publish') {
          const active = this.getActivePublication(input.canonicalId, input.publicationBranchKey);
          if ((active?.publication_id ?? null) !== currentPublicationId) {
            throw new RegistryError('PUBLICATION_CONFLICT', '当前有效发布关系已发生变化。');
          }
          if ((active?.version_id ?? null) !== currentVersionId) {
            throw new RegistryError('PUBLICATION_CONFLICT', '当前有效版本已发生变化。');
          }
          if (
            currentVersionId
              ? targetVersion.previous_version_id !== currentVersionId
              : targetVersion.previous_version_id !== null
          ) {
            throw new RegistryError('PUBLICATION_CONFLICT', '待发布版本不是当前有效版本的直接下一版。');
          }
          if (this.getPublication(input.targetPublicationId)) {
            throw new RegistryError('PUBLICATION_CONFLICT', '目标发布编号已经存在。');
          }
        } else {
          if (!currentVersionId || !currentPublicationId) {
            throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '回滚必须指定当前有效版本和发布关系。');
          }
          if (!currentVersion || currentVersion.previous_version_id !== targetVersion.version_id) {
            throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '回滚目标不是当前版本的直接上一版。');
          }
          const hasNewerVersion = Boolean(this.database.prepare(`
            SELECT 1
            FROM material_versions
            WHERE canonical_id = ?
              AND publication_branch_key = ?
              AND version_no > ?
            LIMIT 1
          `).get(input.canonicalId, input.publicationBranchKey, currentVersion.version_no));
          if (hasNewerVersion) {
            throw new RegistryError('PUBLICATION_CONFLICT', '该资料分支已接收更高版本，不能创建回滚操作。');
          }
          const active = this.getPublicationOrThrow(currentPublicationId);
          const target = this.getPublicationOrThrow(input.targetPublicationId);
          if (
            active.publication_status !== 'active'
            || active.version_id !== currentVersionId
            || target.publication_status !== 'superseded'
            || target.version_id !== input.targetVersionId
            || active.canonical_id !== input.canonicalId
            || target.canonical_id !== input.canonicalId
            || active.publication_branch_key !== input.publicationBranchKey
            || target.publication_branch_key !== input.publicationBranchKey
            || active.effective_from !== target.effective_from
            || active.effective_to !== target.effective_to
          ) {
            throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '回滚目标不是同分支上一份可恢复发布关系。');
          }
        }

        this.database.prepare(`
          INSERT INTO processing_jobs (
            job_id, version_id, stage, status, input_hash, profile_version,
            attempt_count, max_attempts, created_at, updated_at
          ) VALUES (?, ?, 'publication_compensation', 'queued', ?, ?, 0, ?, ?, ?)
        `).run(
          jobId,
          input.targetVersionId,
          input.inputHash,
          input.profileVersion ?? 'publication-operation-v1',
          input.maxAttempts ?? 5,
          timestamp,
          timestamp,
        );
        this.database.prepare(`
          INSERT INTO publication_operations (
            operation_id, job_id, operation_type, canonical_id, publication_branch_key,
            target_version_id, current_version_id, quality_run_id, release_id,
            target_publication_id, current_publication_id, target_binding_id,
            current_binding_id, phase, input_snapshot_json, config_snapshot_json,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?)
        `).run(
          operationId,
          jobId,
          input.operationType,
          input.canonicalId,
          input.publicationBranchKey,
          input.targetVersionId,
          currentVersionId,
          input.qualityRunId,
          input.releaseId,
          input.targetPublicationId,
          currentPublicationId,
          targetBinding.binding_id,
          currentBinding?.binding_id ?? null,
          JSON.stringify(inputSnapshot),
          JSON.stringify(configSnapshot),
          timestamp,
          timestamp,
        );
        const job = this.getJobOrThrow(jobId);
        const operation = this.getOperation(operationId);
        this.appendAudit('processing_job', jobId, 'processing_job.enqueued', null, job, input.audit, timestamp);
        this.appendAudit(
          'publication_operation',
          operationId,
          'publication_operation.created',
          null,
          operation,
          input.audit,
          timestamp,
        );
        return { operation, job };
      })();
    } catch (error) {
      if (error instanceof RegistryError) throw error;
      if (
        error instanceof Error
        && (
          error.message.includes('publication_operations_one_open_per_branch')
          || error.message.includes('publication_operations.canonical_id, publication_operations.publication_branch_key')
        )
      ) {
        throw new RegistryError('PUBLICATION_CONFLICT', '该资料分支已有未完成的发布或回滚操作。', { cause: error });
      }
      throw error;
    }
  }

  getOperation(operationId: string): PublicationOperationRecord {
    const row = this.database.prepare('SELECT * FROM publication_operations WHERE operation_id = ?')
      .get(operationId) as OperationRow | undefined;
    if (!row) throw new RegistryError('RECORD_NOT_FOUND', `未找到发布操作 ${operationId}。`);
    return mapOperation(row);
  }

  getOperationForJob(jobId: string): PublicationOperationRecord | null {
    const row = this.database.prepare('SELECT * FROM publication_operations WHERE job_id = ?')
      .get(jobId) as OperationRow | undefined;
    return row ? mapOperation(row) : null;
  }

  getLatestOperationForVersion(versionId: string): PublicationOperationRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM publication_operations
      WHERE target_version_id = ? OR current_version_id = ?
      ORDER BY created_at DESC, operation_id DESC
      LIMIT 1
    `).get(versionId, versionId) as OperationRow | undefined;
    return row ? mapOperation(row) : null;
  }

  listOpenOperations(): PublicationOperationRecord[] {
    return (this.database.prepare(`
      SELECT * FROM publication_operations
      WHERE phase NOT IN ('completed', 'failed')
      ORDER BY created_at, operation_id
    `).all() as OperationRow[]).map(mapOperation);
  }

  advancePhase(input: {
    operationId: string;
    workerId: string;
    nextPhase: PublicationOperationPhase;
    audit: AuditContext;
  }): PublicationOperationRecord {
    const timestamp = this.now().toISOString();
    return this.database.transaction(() => {
      const current = this.getOperation(input.operationId);
      this.assertWorkerOwnsActiveJob(current.jobId, input.workerId, timestamp);
      if (!PHASE_TRANSITIONS[current.phase].includes(input.nextPhase)) {
        throw new RegistryError(
          'PUBLICATION_PRECONDITION_FAILED',
          `发布操作不能从 ${current.phase} 转为 ${input.nextPhase}。`,
        );
      }
      this.database.prepare(`
        UPDATE publication_operations
        SET phase = ?, error_code = NULL, error_message = NULL, updated_at = ?
        WHERE operation_id = ?
      `).run(input.nextPhase, timestamp, current.operationId);
      const updated = this.getOperation(current.operationId);
      this.appendAudit(
        'publication_operation',
        current.operationId,
        `publication_operation.${input.nextPhase}`,
        current,
        updated,
        input.audit,
        timestamp,
      );
      return updated;
    })();
  }

  completeOperation(input: {
    operationId: string;
    workerId: string;
    audit: AuditContext;
  }): { operation: PublicationOperationRecord; job: ProcessingJobRecord } {
    const timestamp = this.now().toISOString();
    return this.database.transaction(() => {
      const current = this.getOperation(input.operationId);
      const job = this.assertWorkerOwnsActiveJob(current.jobId, input.workerId, timestamp);
      if (current.phase !== 'cleanup_verified') {
        throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '只有清理核验完成的发布操作可以成功收口。');
      }
      this.database.prepare(`
        UPDATE publication_operations
        SET phase = 'completed', error_code = NULL, error_message = NULL,
            completed_at = ?, updated_at = ?
        WHERE operation_id = ?
      `).run(timestamp, timestamp, current.operationId);
      this.finishJob(job, 'succeeded', timestamp);
      const operation = this.getOperation(current.operationId);
      const finishedJob = this.getJobOrThrow(job.jobId);
      this.appendAudit(
        'publication_operation',
        current.operationId,
        'publication_operation.completed',
        current,
        operation,
        input.audit,
        timestamp,
      );
      this.appendAudit('processing_job', job.jobId, 'processing_job.succeeded', job, finishedJob, input.audit, timestamp);
      return { operation, job: finishedJob };
    })();
  }

  beginCompensation(input: {
    operationId: string;
    workerId: string;
    restorePhase: 'restore_target_pending' | 'restore_target_superseded';
    errorCode: string;
    errorMessage: string;
    audit: AuditContext;
  }): PublicationOperationRecord {
    const timestamp = this.now().toISOString();
    return this.database.transaction(() => {
      const current = this.getOperation(input.operationId);
      this.assertWorkerOwnsActiveJob(current.jobId, input.workerId, timestamp);
      if (!PHASE_TRANSITIONS[current.phase].includes(input.restorePhase)) {
        throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '当前发布阶段不能进入目标恢复补偿。');
      }
      this.database.prepare(`
        UPDATE publication_operations
        SET phase = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE operation_id = ?
      `).run(
        input.restorePhase,
        input.errorCode,
        input.errorMessage,
        timestamp,
        current.operationId,
      );
      const updated = this.getOperation(current.operationId);
      this.appendAudit(
        'publication_operation',
        current.operationId,
        `publication_operation.${input.restorePhase}`,
        current,
        updated,
        input.audit,
        timestamp,
      );
      return updated;
    })();
  }

  closeFailedWithoutRemoteMutation(input: {
    operationId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    audit: AuditContext;
  }): { operation: PublicationOperationRecord; job: ProcessingJobRecord } {
    const timestamp = this.now().toISOString();
    return this.database.transaction(() => {
      const current = this.getOperation(input.operationId);
      const job = this.assertWorkerOwnsActiveJob(current.jobId, input.workerId, timestamp);
      if (current.phase !== 'prepared') {
        throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '只有尚未修改远端的发布操作可以直接失败收口。');
      }
      this.database.prepare(`
        UPDATE publication_operations
        SET phase = 'failed', error_code = ?, error_message = ?, completed_at = ?, updated_at = ?
        WHERE operation_id = ?
      `).run(input.errorCode, input.errorMessage, timestamp, timestamp, current.operationId);
      this.finishJob(job, 'succeeded', timestamp);
      const operation = this.getOperation(current.operationId);
      const finishedJob = this.getJobOrThrow(job.jobId);
      this.appendAudit(
        'publication_operation',
        current.operationId,
        'publication_operation.failed_before_remote_mutation',
        current,
        operation,
        input.audit,
        timestamp,
      );
      this.appendAudit('processing_job', job.jobId, 'processing_job.succeeded', job, finishedJob, input.audit, timestamp);
      return { operation, job: finishedJob };
    })();
  }

  compensateAndCloseFailed(input: {
    operationId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    audit: AuditContext;
  }): { operation: PublicationOperationRecord; job: ProcessingJobRecord } {
    const timestamp = this.now().toISOString();
    return this.database.transaction(() => {
      const current = this.getOperation(input.operationId);
      const job = this.assertWorkerOwnsActiveJob(current.jobId, input.workerId, timestamp);
      if (!['restore_target_pending', 'restore_target_superseded'].includes(current.phase)) {
        throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '只有目标状态恢复完成后才能关闭失败操作。');
      }
      this.database.prepare(`
        UPDATE publication_operations
        SET phase = 'failed', error_code = ?, error_message = ?, completed_at = ?, updated_at = ?
        WHERE operation_id = ?
      `).run(input.errorCode, input.errorMessage, timestamp, timestamp, current.operationId);
      // 补偿已经完成，所以任务本身成功；业务失败原因保存在 publication operation。
      this.finishJob(job, 'succeeded', timestamp);
      const operation = this.getOperation(current.operationId);
      const finishedJob = this.getJobOrThrow(job.jobId);
      this.appendAudit(
        'publication_operation',
        current.operationId,
        'publication_operation.failed_compensated',
        current,
        operation,
        input.audit,
        timestamp,
      );
      this.appendAudit('processing_job', job.jobId, 'processing_job.succeeded', job, finishedJob, input.audit, timestamp);
      return { operation, job: finishedJob };
    })();
  }

  failAttempt(input: {
    operationId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryAt?: string | null;
    audit: AuditContext;
  }): { operation: PublicationOperationRecord; job: ProcessingJobRecord } {
    const timestamp = this.now().toISOString();
    return this.database.transaction(() => {
      const current = this.getOperation(input.operationId);
      const job = this.assertWorkerOwnsActiveJob(current.jobId, input.workerId, timestamp);
      this.database.prepare(`
        UPDATE publication_operations
        SET error_code = ?, error_message = ?, updated_at = ?
        WHERE operation_id = ?
      `).run(input.errorCode, input.errorMessage, timestamp, current.operationId);
      this.database.prepare(`
        UPDATE processing_jobs
        SET status = 'failed', next_retry_at = ?, lease_owner = NULL,
            lease_expires_at = NULL, heartbeat_at = NULL,
            error_code = ?, error_message = ?, updated_at = ?
        WHERE job_id = ?
      `).run(
        input.retryAt ?? null,
        input.errorCode,
        input.errorMessage,
        timestamp,
        job.jobId,
      );
      const operation = this.getOperation(current.operationId);
      const failedJob = this.getJobOrThrow(job.jobId);
      this.appendAudit(
        'publication_operation',
        current.operationId,
        input.retryAt ? 'publication_operation.retry_scheduled' : 'publication_operation.requires_attention',
        current,
        operation,
        input.audit,
        timestamp,
      );
      this.appendAudit('processing_job', job.jobId, 'processing_job.failed', job, failedJob, input.audit, timestamp);
      return { operation, job: failedJob };
    })();
  }

  retryOperation(operationId: string, audit: AuditContext): {
    operation: PublicationOperationRecord;
    job: ProcessingJobRecord;
  } {
    const timestamp = this.now().toISOString();
    return this.database.transaction(() => {
      const current = this.getOperation(operationId);
      if (['completed', 'failed'].includes(current.phase)) {
        throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '已经结束的发布操作不能重试。');
      }
      const job = this.getJobOrThrow(current.jobId);
      if (job.status !== 'failed' || job.nextRetryAt !== null) {
        throw new RegistryError('JOB_STATE_CONFLICT', '只有等待人工处理的发布任务可以重试。');
      }
      this.database.prepare(`
        UPDATE processing_jobs
        SET status = 'queued', attempt_count = 0, next_retry_at = NULL, lease_owner = NULL,
            lease_expires_at = NULL, heartbeat_at = NULL,
            error_code = NULL, error_message = NULL, updated_at = ?
        WHERE job_id = ?
      `).run(timestamp, job.jobId);
      this.database.prepare(`
        UPDATE publication_operations
        SET error_code = NULL, error_message = NULL, updated_at = ?
        WHERE operation_id = ?
      `).run(timestamp, current.operationId);
      const operation = this.getOperation(current.operationId);
      const queuedJob = this.getJobOrThrow(job.jobId);
      this.appendAudit(
        'publication_operation',
        current.operationId,
        'publication_operation.manual_retry',
        current,
        operation,
        audit,
        timestamp,
      );
      this.appendAudit('processing_job', job.jobId, 'processing_job.retried', job, queuedJob, audit, timestamp);
      return { operation, job: queuedJob };
    })();
  }

  private getVersionIdentity(versionId: string): VersionIdentityRow {
    const row = this.database.prepare(`
      SELECT version_id, canonical_id, publication_branch_key, version_no,
             previous_version_id, workflow_status, processing_health,
             index_publication_status
      FROM material_versions WHERE version_id = ?
    `).get(versionId) as VersionIdentityRow | undefined;
    if (!row) throw new RegistryError('RECORD_NOT_FOUND', `未找到资料版本 ${versionId}。`);
    return row;
  }

  private getUniqueHealthyBinding(versionId: string, remoteStatus: BindingRow['remote_status']): BindingRow {
    const rows = this.database.prepare(`
      SELECT binding_id, version_id, index_generation, dataset_id, document_id,
             remote_status, is_healthy, remote_run_status, chunk_count, last_verified_at
      FROM ragflow_bindings
      WHERE version_id = ? AND remote_status = ?
      ORDER BY created_at, binding_id
    `).all(versionId, remoteStatus) as BindingRow[];
    if (
      rows.length !== 1
      || rows[0].is_healthy !== 1
      || rows[0].remote_run_status !== 'DONE'
      || !Number.isInteger(rows[0].chunk_count)
      || (rows[0].chunk_count ?? 0) <= 0
      || !rows[0].last_verified_at
    ) {
      throw new RegistryError(
        'INCOMPLETE_RAGFLOW_MAPPING',
        `版本 ${versionId} 必须且只能有一份健康 ${remoteStatus} 绑定。`,
      );
    }
    return rows[0];
  }

  private getActivePublication(canonicalId: string, branchKey: string): PublicationRow | null {
    const rows = this.database.prepare(`
      SELECT publication_id, canonical_id, publication_branch_key, version_id,
             publication_status, effective_from, effective_to
      FROM material_publications
      WHERE canonical_id = ? AND publication_branch_key = ? AND publication_status = 'active'
      ORDER BY created_at, publication_id
    `).all(canonicalId, branchKey) as PublicationRow[];
    if (rows.length > 1) {
      throw new RegistryError('PUBLICATION_CONFLICT', '当前资料分支存在多个有效发布关系。');
    }
    return rows[0] ?? null;
  }

  private getPublication(publicationId: string): PublicationRow | null {
    return (this.database.prepare(`
      SELECT publication_id, canonical_id, publication_branch_key, version_id,
             publication_status, effective_from, effective_to
      FROM material_publications WHERE publication_id = ?
    `).get(publicationId) as PublicationRow | undefined) ?? null;
  }

  private getPublicationOrThrow(publicationId: string): PublicationRow {
    const publication = this.getPublication(publicationId);
    if (!publication) throw new RegistryError('RECORD_NOT_FOUND', `未找到发布关系 ${publicationId}。`);
    return publication;
  }

  private assertWorkerOwnsActiveJob(jobId: string, workerId: string, timestamp: string): ProcessingJobRecord {
    const job = this.getJobOrThrow(jobId);
    if (
      job.status !== 'running'
      || job.leaseOwner !== workerId
      || !job.leaseExpiresAt
      || job.leaseExpiresAt <= timestamp
    ) {
      throw new RegistryError('JOB_STATE_CONFLICT', '只有持有当前有效租约的发布 worker 可以更新操作。');
    }
    return job;
  }

  private finishJob(job: ProcessingJobRecord, status: 'succeeded', timestamp: string): void {
    this.database.prepare(`
      UPDATE processing_jobs
      SET status = ?, next_retry_at = NULL, lease_owner = NULL,
          lease_expires_at = NULL, heartbeat_at = NULL,
          error_code = NULL, error_message = NULL, updated_at = ?
      WHERE job_id = ?
    `).run(status, timestamp, job.jobId);
  }

  private getJobOrThrow(jobId: string): ProcessingJobRecord {
    const row = this.database.prepare('SELECT * FROM processing_jobs WHERE job_id = ?')
      .get(jobId) as JobRow | undefined;
    if (!row) throw new RegistryError('RECORD_NOT_FOUND', `未找到处理任务 ${jobId}。`);
    return mapJob(row);
  }

  private appendAudit(
    entityType: string,
    entityId: string,
    action: string,
    before: unknown,
    after: unknown,
    audit: AuditContext,
    timestamp: string,
  ): void {
    this.database.prepare(`
      INSERT INTO audit_events (
        event_id, entity_type, entity_id, action, actor_id, reason,
        before_json, after_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.createId('audit'),
      entityType,
      entityId,
      action,
      audit.actorId,
      audit.reason,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      timestamp,
    );
  }
}
