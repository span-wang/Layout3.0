import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { RegistryDatabase } from './registry-database';
import { assertVersionStatePatch } from './state-machine';
import type {
  IndexPublicationStatus,
  JobStage,
  MaterialVersionRecord,
  ProcessingJobRecord,
} from './types';
import { RegistryError } from './types';

export interface PendingIndexAuditContext {
  actorId: string;
  reason: string;
}

export interface PendingIndexBindingRecord {
  bindingId: string;
  versionId: string;
  indexGeneration: string;
  datasetId: string;
  documentId: string;
  remoteStatus: 'pending';
  isHealthy: boolean;
  remoteRunStatus: string | null;
  chunkCount: number | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompleteParseWaitResult {
  binding: PendingIndexBindingRecord;
  version: MaterialVersionRecord;
  job: ProcessingJobRecord;
}

interface PendingIndexRepositoryOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
}

interface BindingRow {
  binding_id: string;
  version_id: string;
  index_generation: string;
  dataset_id: string;
  document_id: string;
  remote_status: IndexPublicationStatus;
  is_healthy: number;
  remote_run_status: string | null;
  chunk_count: number | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  version_id: string;
  canonical_id: string;
  publication_branch_key: string;
  version_no: number;
  content_hash: string;
  workflow_status: MaterialVersionRecord['workflowStatus'];
  processing_health: MaterialVersionRecord['processingHealth'];
  index_publication_status: MaterialVersionRecord['indexPublicationStatus'];
  metadata_json: string;
  metadata_schema_version: string;
  source_path: string | null;
  managed_source_path: string | null;
  parser_profile: string | null;
  embedding_profile: string | null;
  profile_bundle_hash: string | null;
  previous_version_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  superseded_at: string | null;
  archived_at: string | null;
  last_verified_at: string | null;
}

interface JobRow {
  job_id: string;
  version_id: string;
  stage: JobStage;
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

function mapBinding(row: BindingRow): PendingIndexBindingRecord {
  if (row.remote_status !== 'pending') {
    throw new RegistryError(
      'INCOMPLETE_RAGFLOW_MAPPING',
      `RAGFlow 绑定 ${row.binding_id} 不是 pending，已失败关闭。`,
    );
  }
  return {
    bindingId: row.binding_id,
    versionId: row.version_id,
    indexGeneration: row.index_generation,
    datasetId: row.dataset_id,
    documentId: row.document_id,
    remoteStatus: 'pending',
    isHealthy: row.is_healthy === 1,
    remoteRunStatus: row.remote_run_status,
    chunkCount: row.chunk_count,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersion(row: VersionRow): MaterialVersionRecord {
  return {
    versionId: row.version_id,
    canonicalId: row.canonical_id,
    publicationBranchKey: row.publication_branch_key,
    versionNo: row.version_no,
    contentHash: row.content_hash,
    workflowStatus: row.workflow_status,
    processingHealth: row.processing_health,
    indexPublicationStatus: row.index_publication_status,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    metadataSchemaVersion: row.metadata_schema_version,
    sourcePath: row.source_path,
    managedSourcePath: row.managed_source_path,
    parserProfile: row.parser_profile,
    embeddingProfile: row.embedding_profile,
    profileBundleHash: row.profile_bundle_hash,
    previousVersionId: row.previous_version_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    supersededAt: row.superseded_at,
    archivedAt: row.archived_at,
    lastVerifiedAt: row.last_verified_at,
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

function assertNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new RegistryError('INPUT_VALIDATION', `${fieldName} 不能为空。`);
  }
  return normalized;
}

function assertPositiveChunkCount(chunkCount: number): void {
  if (!Number.isInteger(chunkCount) || chunkCount <= 0) {
    throw new RegistryError('REMOTE_CONTRACT', '健康 pending 绑定的 chunk_count 必须是正整数。');
  }
}

export class PendingIndexRepository {
  private readonly database: Database.Database;
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;

  constructor(registryDatabase: RegistryDatabase, options: PendingIndexRepositoryOptions = {}) {
    this.database = registryDatabase.connection;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  findPendingBinding(input: {
    versionId: string;
    indexGeneration: string;
  }): PendingIndexBindingRecord | null {
    const rows = this.database
      .prepare(`
        SELECT * FROM ragflow_bindings
        WHERE version_id = ? AND index_generation = ?
        ORDER BY created_at, binding_id
      `)
      .all(
        assertNonEmpty(input.versionId, 'versionId'),
        assertNonEmpty(input.indexGeneration, 'indexGeneration'),
      ) as BindingRow[];
    return this.requireSinglePendingBinding(rows, input.versionId, input.indexGeneration);
  }

  /** 与 PendingIndexService 当前回调命名兼容。 */
  findBinding(input: {
    versionId: string;
    indexGeneration: string;
  }): PendingIndexBindingRecord | null {
    return this.findPendingBinding(input);
  }

  findUniquePendingBindingForVersion(versionId: string): PendingIndexBindingRecord | null {
    const normalizedVersionId = assertNonEmpty(versionId, 'versionId');
    const rows = this.database
      .prepare(`
        SELECT * FROM ragflow_bindings
        WHERE version_id = ? AND remote_status = 'pending'
        ORDER BY created_at, binding_id
      `)
      .all(normalizedVersionId) as BindingRow[];
    if (rows.length > 1) {
      throw new RegistryError(
        'INCOMPLETE_RAGFLOW_MAPPING',
        `版本 ${normalizedVersionId} 存在多份 pending 绑定，重启恢复已失败关闭。`,
      );
    }
    return rows[0] ? mapBinding(rows[0]) : null;
  }

  ensureUnhealthyPendingBinding(input: {
    bindingId?: string;
    versionId: string;
    indexGeneration: string;
    datasetId: string;
    documentId: string;
    audit: PendingIndexAuditContext;
  }): PendingIndexBindingRecord {
    const timestamp = this.now().toISOString();

    return this.database.transaction(() => {
      this.getVersionOrThrow(input.versionId);
      const existing = this.findPendingBinding(input);
      if (existing) {
        if (
          existing.datasetId !== input.datasetId
          || existing.documentId !== input.documentId
          || existing.remoteStatus !== 'pending'
          || existing.isHealthy
        ) {
          throw new RegistryError(
            'INCOMPLETE_RAGFLOW_MAPPING',
            `版本 ${input.versionId} 的 pending 绑定身份或健康状态发生漂移。`,
          );
        }
        return existing;
      }

      const remoteOwner = this.database
        .prepare(`
          SELECT * FROM ragflow_bindings
          WHERE index_generation = ? AND dataset_id = ? AND document_id = ?
        `)
        .get(input.indexGeneration, input.datasetId, input.documentId) as BindingRow | undefined;
      if (remoteOwner) {
        throw new RegistryError(
          'INCOMPLETE_RAGFLOW_MAPPING',
          `RAGFlow 文档 ${input.documentId} 已绑定到其他资料版本，不能接管。`,
        );
      }

      const bindingId = input.bindingId ?? this.createId('binding');
      this.database
        .prepare(`
          INSERT INTO ragflow_bindings (
            binding_id, version_id, index_generation, dataset_id, document_id,
            remote_status, is_healthy, remote_run_status, chunk_count,
            last_verified_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, ?, ?)
        `)
        .run(
          bindingId,
          input.versionId,
          input.indexGeneration,
          input.datasetId,
          input.documentId,
          timestamp,
          timestamp,
        );
      const created = this.getBindingById(bindingId);
      this.appendAudit(
        'ragflow_binding',
        bindingId,
        'ragflow_binding.pending_unhealthy_created',
        null,
        created,
        input.audit,
        timestamp,
      );
      return created;
    })();
  }

  markPendingBindingHealthy(input: {
    versionId: string;
    indexGeneration: string;
    datasetId: string;
    documentId: string;
    chunkCount: number;
    lastVerifiedAt: string;
    audit: PendingIndexAuditContext;
  }): PendingIndexBindingRecord {
    assertPositiveChunkCount(input.chunkCount);
    assertNonEmpty(input.lastVerifiedAt, 'lastVerifiedAt');
    const timestamp = this.now().toISOString();

    return this.database.transaction(() => {
      const version = this.getVersionOrThrow(input.versionId);
      this.assertNoPublication(input.versionId);
      const binding = this.findPendingBinding(input);
      if (!binding) {
        throw new RegistryError(
          'INCOMPLETE_RAGFLOW_MAPPING',
          `版本 ${input.versionId} 没有可核验的 pending 绑定。`,
        );
      }
      this.assertBindingIdentity(binding, input);

      if (binding.isHealthy) {
        if (
          binding.remoteRunStatus !== 'DONE'
          || binding.chunkCount !== input.chunkCount
          || version.workflowStatus !== 'quality_check'
          || version.processingHealth !== 'healthy'
          || version.indexPublicationStatus !== 'pending'
          || version.errorMessage !== null
        ) {
          throw new RegistryError(
            'INCOMPLETE_RAGFLOW_MAPPING',
            `版本 ${input.versionId} 的健康 pending 证据与本次回读不一致。`,
          );
        }
        return binding;
      }

      assertVersionStatePatch(version, {
        workflowStatus: 'quality_check',
        processingHealth: 'healthy',
        indexPublicationStatus: 'pending',
        errorMessage: null,
      });
      this.database
        .prepare(`
          UPDATE ragflow_bindings
          SET is_healthy = 1, remote_run_status = 'DONE', chunk_count = ?,
              last_verified_at = ?, updated_at = ?
          WHERE binding_id = ?
        `)
        .run(input.chunkCount, input.lastVerifiedAt, timestamp, binding.bindingId);
      this.database
        .prepare(`
          UPDATE material_versions
          SET workflow_status = 'quality_check', processing_health = 'healthy',
              index_publication_status = 'pending', error_message = NULL,
              last_verified_at = ?, updated_at = ?
          WHERE version_id = ?
        `)
        .run(input.lastVerifiedAt, timestamp, input.versionId);

      const healthyBinding = this.getBindingById(binding.bindingId);
      const healthyVersion = this.getVersionOrThrow(input.versionId);
      this.appendAudit(
        'ragflow_binding',
        binding.bindingId,
        'ragflow_binding.pending_marked_healthy',
        binding,
        healthyBinding,
        input.audit,
        timestamp,
      );
      this.appendAudit(
        'material_version',
        input.versionId,
        'material_version.pending_index_ready_for_quality',
        version,
        healthyVersion,
        input.audit,
        timestamp,
      );
      return healthyBinding;
    })();
  }

  completeParseWaitJob(input: {
    jobId: string;
    workerId: string;
    versionId: string;
    indexGeneration: string;
    datasetId: string;
    documentId: string;
    chunkCount: number;
    lastVerifiedAt: string;
    audit: PendingIndexAuditContext;
  }): CompleteParseWaitResult {
    return this.database.transaction(() => {
      const currentJob = this.getJobOrThrow(input.jobId);
      if (currentJob.stage !== 'parse_wait' || currentJob.versionId !== input.versionId) {
        throw new RegistryError('JOB_STATE_CONFLICT', '只有当前版本的 parse_wait 任务可以执行索引健康收口。');
      }

      const binding = this.markPendingBindingHealthy(input);
      if (currentJob.status === 'succeeded') {
        return {
          binding,
          version: this.getVersionOrThrow(input.versionId),
          job: currentJob,
        };
      }
      if (currentJob.status !== 'running' || currentJob.leaseOwner !== input.workerId) {
        throw new RegistryError('JOB_STATE_CONFLICT', '只有持有当前租约的 worker 可以完成 parse_wait 任务。');
      }

      const timestamp = this.now().toISOString();
      this.database
        .prepare(`
          UPDATE processing_jobs
          SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
              heartbeat_at = NULL, next_retry_at = NULL, updated_at = ?
          WHERE job_id = ?
        `)
        .run(timestamp, input.jobId);
      const completedJob = this.getJobOrThrow(input.jobId);
      this.appendAudit(
        'processing_job',
        input.jobId,
        'processing_job.succeeded',
        currentJob,
        completedJob,
        input.audit,
        timestamp,
      );
      return {
        binding,
        version: this.getVersionOrThrow(input.versionId),
        job: completedJob,
      };
    })();
  }

  private requireSinglePendingBinding(
    rows: BindingRow[],
    versionId: string,
    indexGeneration: string,
  ): PendingIndexBindingRecord | null {
    if (rows.length > 1) {
      throw new RegistryError(
        'INCOMPLETE_RAGFLOW_MAPPING',
        `版本 ${versionId} 在索引代次 ${indexGeneration} 存在多份绑定，已失败关闭。`,
      );
    }
    if (!rows[0]) {
      return null;
    }
    if (rows[0].remote_status !== 'pending') {
      throw new RegistryError(
        'INCOMPLETE_RAGFLOW_MAPPING',
        `版本 ${versionId} 在索引代次 ${indexGeneration} 的绑定不是 pending。`,
      );
    }
    return mapBinding(rows[0]);
  }

  private assertBindingIdentity(
    binding: PendingIndexBindingRecord,
    input: { datasetId: string; documentId: string },
  ): void {
    if (
      binding.remoteStatus !== 'pending'
      || binding.datasetId !== input.datasetId
      || binding.documentId !== input.documentId
    ) {
      throw new RegistryError(
        'INCOMPLETE_RAGFLOW_MAPPING',
        `版本 ${binding.versionId} 的 pending dataset/document 身份发生漂移。`,
      );
    }
  }

  private assertNoPublication(versionId: string): void {
    const publicationCount = Number(
      this.database
        .prepare('SELECT COUNT(*) FROM material_publications WHERE version_id = ?')
        .pluck()
        .get(versionId),
    );
    if (publicationCount !== 0) {
      throw new RegistryError(
        'PUBLICATION_PRECONDITION_FAILED',
        `版本 ${versionId} 已存在 material_publications，不能作为 pending 索引完成处理。`,
      );
    }
  }

  private getBindingById(bindingId: string): PendingIndexBindingRecord {
    const row = this.database
      .prepare('SELECT * FROM ragflow_bindings WHERE binding_id = ?')
      .get(bindingId) as BindingRow | undefined;
    if (!row) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到 RAGFlow 绑定 ${bindingId}。`);
    }
    return mapBinding(row);
  }

  private getVersionOrThrow(versionId: string): MaterialVersionRecord {
    const row = this.database
      .prepare('SELECT * FROM material_versions WHERE version_id = ?')
      .get(versionId) as VersionRow | undefined;
    if (!row) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到资料版本 ${versionId}。`);
    }
    return mapVersion(row);
  }

  private getJobOrThrow(jobId: string): ProcessingJobRecord {
    const row = this.database
      .prepare('SELECT * FROM processing_jobs WHERE job_id = ?')
      .get(jobId) as JobRow | undefined;
    if (!row) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到处理任务 ${jobId}。`);
    }
    return mapJob(row);
  }

  private appendAudit(
    entityType: string,
    entityId: string,
    action: string,
    before: unknown,
    after: unknown,
    context: PendingIndexAuditContext,
    createdAt: string,
  ): void {
    this.database
      .prepare(`
        INSERT INTO audit_events (
          event_id, entity_type, entity_id, action, actor_id, reason,
          before_json, after_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        this.createId('audit'),
        entityType,
        entityId,
        action,
        context.actorId,
        context.reason,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        createdAt,
      );
  }
}
