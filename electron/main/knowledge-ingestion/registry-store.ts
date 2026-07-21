import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { assertVersionStatePatch } from './state-machine';
import type {
  ActiveRetrievalScope,
  IndexPublicationStatus,
  JobStage,
  MaterialRecord,
  MaterialVersionRecord,
  ProcessingJobRecord,
  PublicationBranchRecord,
  PublicationBranchType,
  RetrievalDocumentValidation,
  VersionStatePatch,
  WorkflowStatus,
} from './types';
import { RegistryError } from './types';
import type { RegistryDatabase } from './registry-database';
import {
  PendingIndexRepository,
  type PendingIndexBindingRecord,
} from './pending-index-repository';
import { QualityGateRepository } from './quality-gate-repository';

interface RegistryStoreOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
}

interface AuditContext {
  actorId: string;
  reason: string;
}

interface MaterialRow {
  canonical_id: string;
  stable_title: string;
  domain: string;
  created_at: string;
  updated_at: string;
}

interface BranchRow {
  canonical_id: string;
  branch_key: string;
  branch_type: PublicationBranchType;
  display_name: string;
  is_default: number;
  default_strategy: string | null;
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

interface PublicationRow {
  publication_id: string;
  release_id: string;
  canonical_id: string;
  publication_branch_key: string;
  version_id: string;
  publication_status: 'active' | 'superseded' | 'archived';
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
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

function mapMaterial(row: MaterialRow): MaterialRecord {
  return {
    canonicalId: row.canonical_id,
    stableTitle: row.stable_title,
    domain: row.domain,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBranch(row: BranchRow): PublicationBranchRecord {
  return {
    canonicalId: row.canonical_id,
    branchKey: row.branch_key,
    branchType: row.branch_type,
    displayName: row.display_name,
    isDefault: row.is_default === 1,
    defaultStrategy: row.default_strategy,
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

function isSqliteMessage(error: unknown, marker: string): boolean {
  return error instanceof Error && error.message.includes(marker);
}

function sanitizeProcessingErrorMessage(errorCode: string, _errorMessage: string): string {
  // 版本表只保存按稳定错误码映射的中文摘要，远端响应、文档 ID 和本地路径只留在 job/audit。
  const summaries: Record<string, string> = {
    REMOTE_AUTH_CONFIG: 'RAGFlow 配置不可用，请检查地址、密钥和暂存数据集设置。',
    REMOTE_TRANSIENT: 'RAGFlow 暂时不可用，系统将按任务策略重试。',
    REMOTE_CONTRACT: 'RAGFlow 返回结果不符合入库合同，已停止继续处理。',
    FILE_PROCESSING: '源文件基础处理失败，请检查文件内容后重试。',
    CANCELLED: '资料处理已取消。',
    PROCESSING_RETRY_EXHAUSTED: '处理任务已达到最大尝试次数，请人工检查后重试。',
  };
  return `${errorCode}：${summaries[errorCode] ?? '资料处理失败，请重试或查看任务诊断。'}`;
}

export class RegistryStore {
  private readonly database: Database.Database;
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;
  private readonly pendingIndexRepository: PendingIndexRepository;
  private readonly qualityGateRepository: QualityGateRepository;

  constructor(registryDatabase: RegistryDatabase, options: RegistryStoreOptions = {}) {
    this.database = registryDatabase.connection;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.pendingIndexRepository = new PendingIndexRepository(registryDatabase, {
      now: this.now,
      createId: this.createId,
    });
    this.qualityGateRepository = new QualityGateRepository(registryDatabase, {
      now: this.now,
      createId: this.createId,
    });
  }

  createMaterial(input: {
    canonicalId?: string;
    stableTitle: string;
    domain: string;
    audit: AuditContext;
  }): MaterialRecord {
    const timestamp = this.now().toISOString();
    const canonicalId = input.canonicalId ?? this.createId('mat');

    return this.database.transaction(() => {
      this.database
        .prepare(`
          INSERT INTO materials (canonical_id, stable_title, domain, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(canonicalId, input.stableTitle, input.domain, timestamp, timestamp);
      const material = this.getMaterialOrThrow(canonicalId);
      this.appendAudit('material', canonicalId, 'material.created', null, material, input.audit, timestamp);
      return material;
    })();
  }

  createPublicationBranch(input: {
    canonicalId: string;
    branchKey: string;
    branchType: PublicationBranchType;
    displayName: string;
    isDefault?: boolean;
    defaultStrategy?: string | null;
    audit: AuditContext;
  }): PublicationBranchRecord {
    const timestamp = this.now().toISOString();

    return this.database.transaction(() => {
      this.database
        .prepare(`
          INSERT INTO publication_branches (
            canonical_id, branch_key, branch_type, display_name, is_default, default_strategy,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          input.canonicalId,
          input.branchKey,
          input.branchType,
          input.displayName,
          input.isDefault ? 1 : 0,
          input.defaultStrategy ?? null,
          timestamp,
          timestamp,
        );
      const branch = this.getBranchOrThrow(input.canonicalId, input.branchKey);
      this.appendAudit(
        'publication_branch',
        `${input.canonicalId}:${input.branchKey}`,
        'publication_branch.created',
        null,
        branch,
        input.audit,
        timestamp,
      );
      return branch;
    })();
  }

  createMaterialVersion(input: {
    versionId?: string;
    canonicalId: string;
    publicationBranchKey: string;
    contentHash: string;
    metadata?: Record<string, unknown>;
    metadataSchemaVersion?: string;
    sourcePath?: string | null;
    managedSourcePath?: string | null;
    parserProfile?: string | null;
    embeddingProfile?: string | null;
    profileBundleHash?: string | null;
    audit: AuditContext;
  }): MaterialVersionRecord {
    const timestamp = this.now().toISOString();
    const versionId = input.versionId ?? this.createId('ver');

    try {
      return this.database.transaction(() => {
        this.getBranchOrThrow(input.canonicalId, input.publicationBranchKey);
        const previous = this.database
          .prepare(`
            SELECT version_id, version_no
            FROM material_versions
            WHERE canonical_id = ? AND publication_branch_key = ?
            ORDER BY version_no DESC
            LIMIT 1
          `)
          .get(input.canonicalId, input.publicationBranchKey) as
          | { version_id: string; version_no: number }
          | undefined;
        const versionNo = (previous?.version_no ?? 0) + 1;

        this.database
          .prepare(`
            INSERT INTO material_versions (
              version_id, canonical_id, publication_branch_key, version_no, content_hash,
              workflow_status, processing_health, index_publication_status,
              metadata_json, metadata_schema_version, source_path, managed_source_path,
              parser_profile, embedding_profile, profile_bundle_hash, previous_version_id,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'pending_identification', 'pending', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            versionId,
            input.canonicalId,
            input.publicationBranchKey,
            versionNo,
            input.contentHash,
            JSON.stringify(input.metadata ?? {}),
            input.metadataSchemaVersion ?? '1.0.0',
            input.sourcePath ?? null,
            input.managedSourcePath ?? null,
            input.parserProfile ?? null,
            input.embeddingProfile ?? null,
            input.profileBundleHash ?? null,
            previous?.version_id ?? null,
            timestamp,
            timestamp,
          );

        const version = this.getVersionOrThrow(versionId);
        this.appendAudit('material_version', versionId, 'material_version.created', null, version, input.audit, timestamp);
        return version;
      })();
    } catch (error) {
      if (isSqliteMessage(error, 'material_versions.content_hash')) {
        throw new RegistryError(
          'DUPLICATE_CONTENT_HASH',
          '相同 content_hash 已登记，不能创建第二份内容版本。',
          { cause: error },
        );
      }
      throw error;
    }
  }

  getMaterialVersion(versionId: string): MaterialVersionRecord {
    return this.getVersionOrThrow(versionId);
  }

  transitionVersionState(
    versionId: string,
    patch: VersionStatePatch,
    audit: AuditContext,
  ): MaterialVersionRecord {
    const timestamp = this.now().toISOString();

    return this.database.transaction(() => {
      const current = this.getVersionOrThrow(versionId);

      if (
        patch.workflowStatus === 'published'
        || patch.workflowStatus === 'superseded'
        || patch.workflowStatus === 'archived'
        || patch.indexPublicationStatus === 'active'
      ) {
        throw new RegistryError(
          'PUBLICATION_PRECONDITION_FAILED',
          '发布、替代、回滚和归档必须通过对应的发布事务执行。',
        );
      }

      if (patch.workflowStatus === 'pending_publication') {
        // 待发布不是普通状态跳转：必须先存在仍绑定当前版本、工件和 pending scope 的完整通过结论。
        this.qualityGateRepository.assertCurrentPassedRun(versionId);
      }

      if (current.workflowStatus === 'published' && patch.workflowStatus === 'quarantined') {
        // 普通调用自身不能证明“替代关系与隔离同事务”；法规分支中不重叠的未来版本也不能冒充当前替代。
        throw new RegistryError(
          'LAST_ACTIVE_PUBLICATION',
          '已发布版本只能通过同一发布替代事务进入隔离，不能单独改变状态。',
        );
      }

      return this.applyVersionStateChange(current, patch, audit, timestamp, false);
    })();
  }

  publishVersion(input: {
    versionId: string;
    releaseId?: string;
    publicationId?: string;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    replacePublicationId?: string;
    replacedVersionDisposition?: 'superseded' | 'quarantined';
    requireCurrentQualityRun?: boolean;
    audit: AuditContext;
  }): MaterialVersionRecord {
    const timestamp = this.now().toISOString();

    try {
      return this.database.transaction(() => {
        const version = this.getVersionOrThrow(input.versionId);
        const branch = this.getBranchOrThrow(version.canonicalId, version.publicationBranchKey);
        if (version.workflowStatus !== 'pending_publication' || version.processingHealth !== 'healthy') {
          throw new RegistryError(
            'PUBLICATION_PRECONDITION_FAILED',
            '只有处理健康且处于待发布状态的版本可以建立正式发布关系。',
          );
        }
        if (input.requireCurrentQualityRun) {
          // C4 的真实发布必须重验未过期质量结论；PH3-13B 的纯状态机夹具可继续显式跳过。
          this.qualityGateRepository.assertPublishablePassedRun(version.versionId);
        }

        let replacedPublication: PublicationRow | undefined;
        if (branch.branchType === 'legal') {
          if (!input.effectiveFrom) {
            throw new RegistryError(
              'PUBLICATION_PRECONDITION_FAILED',
              '法规分支必须提供 effectiveFrom。',
            );
          }
          if (input.replacePublicationId) {
            replacedPublication = this.getPublicationOrThrow(input.replacePublicationId);
            if (
              replacedPublication.effective_from !== input.effectiveFrom
              || replacedPublication.effective_to !== (input.effectiveTo ?? null)
            ) {
              throw new RegistryError(
                'PUBLICATION_PRECONDITION_FAILED',
                '法规版本替代必须覆盖被替代关系的同一有效区间，不能在事务中留下日期空档。',
              );
            }
          }
        } else {
          replacedPublication = this.database
            .prepare(`
              SELECT * FROM material_publications
              WHERE canonical_id = ? AND publication_branch_key = ? AND publication_status = 'active'
              LIMIT 1
            `)
            .get(version.canonicalId, version.publicationBranchKey) as PublicationRow | undefined;
        }

        if (replacedPublication) {
          this.assertPublicationBelongsToBranch(replacedPublication, version);
          this.updatePublicationStatus(replacedPublication, 'superseded', input.audit, timestamp);
        }

        const publishedVersion = this.applyVersionStateChange(
          version,
          { workflowStatus: 'published', indexPublicationStatus: 'active', errorMessage: null },
          input.audit,
          timestamp,
          true,
        );

        const publicationId = input.publicationId ?? this.createId('pub');
        const publication: PublicationRow = {
          publication_id: publicationId,
          release_id: input.releaseId ?? this.createId('rel'),
          canonical_id: version.canonicalId,
          publication_branch_key: version.publicationBranchKey,
          version_id: version.versionId,
          publication_status: 'active',
          effective_from: input.effectiveFrom ?? null,
          effective_to: input.effectiveTo ?? null,
          created_at: timestamp,
          updated_at: timestamp,
          closed_at: null,
        };
        this.database
          .prepare(`
            INSERT INTO material_publications (
              publication_id, release_id, canonical_id, publication_branch_key, version_id,
              publication_status, effective_from, effective_to, created_at, updated_at, closed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(...Object.values(publication));
        this.appendAudit(
          'material_publication',
          publicationId,
          'material_publication.activated',
          null,
          publication,
          input.audit,
          timestamp,
        );

        if (replacedPublication && replacedPublication.version_id !== version.versionId) {
          const replacedVersion = this.getVersionOrThrow(replacedPublication.version_id);
          const stillActive = this.hasActivePublication(replacedVersion.versionId);
          if (!stillActive) {
            this.applyVersionStateChange(
              replacedVersion,
              {
                workflowStatus: input.replacedVersionDisposition ?? 'superseded',
                indexPublicationStatus: 'superseded',
              },
              input.audit,
              timestamp,
              true,
            );
          }
        }

        return publishedVersion;
      })();
    } catch (error) {
      if (
        isSqliteMessage(error, 'PUBLICATION_ACTIVE_RANGE_CONFLICT')
        || isSqliteMessage(error, 'PUBLICATION_EFFECTIVE_RANGE_INVALID')
      ) {
        throw new RegistryError(
          'PUBLICATION_CONFLICT',
          '发布分支已存在冲突的有效关系，法规有效区间也不能重叠。',
          { cause: error },
        );
      }
      throw error;
    }
  }

  rollbackPublication(input: {
    currentPublicationId: string;
    targetPublicationId: string;
    quarantineCurrent?: boolean;
    audit: AuditContext;
  }): MaterialVersionRecord {
    const timestamp = this.now().toISOString();

    return this.database.transaction(() => {
      const currentPublication = this.getPublicationOrThrow(input.currentPublicationId);
      const targetPublication = this.getPublicationOrThrow(input.targetPublicationId);
      if (
        currentPublication.publication_status !== 'active'
        || targetPublication.publication_status !== 'superseded'
        || currentPublication.canonical_id !== targetPublication.canonical_id
        || currentPublication.publication_branch_key !== targetPublication.publication_branch_key
        || currentPublication.version_id === targetPublication.version_id
        || currentPublication.effective_from !== targetPublication.effective_from
        || currentPublication.effective_to !== targetPublication.effective_to
      ) {
        throw new RegistryError(
          'PUBLICATION_PRECONDITION_FAILED',
          '回滚必须在同一分支内把当前有效发布与一个已替代版本成对切换。',
        );
      }

      const currentVersion = this.getVersionOrThrow(currentPublication.version_id);
      const targetVersion = this.getVersionOrThrow(targetPublication.version_id);
      const hasNewerVersion = Boolean(this.database.prepare(`
        SELECT 1
        FROM material_versions
        WHERE canonical_id = ?
          AND publication_branch_key = ?
          AND version_no > ?
        LIMIT 1
      `).get(
        currentVersion.canonicalId,
        currentVersion.publicationBranchKey,
        currentVersion.versionNo,
      ));
      if (
        currentVersion.workflowStatus !== 'published'
        || currentVersion.processingHealth !== 'healthy'
        || currentVersion.indexPublicationStatus !== 'active'
        || currentVersion.previousVersionId !== targetVersion.versionId
        || targetVersion.workflowStatus !== 'superseded'
        || targetVersion.processingHealth !== 'healthy'
        || targetVersion.indexPublicationStatus !== 'superseded'
        || hasNewerVersion
      ) {
        throw new RegistryError(
          'PUBLICATION_PRECONDITION_FAILED',
          '当前版本拓扑或上一版本健康状态已变化，不能执行回滚。',
        );
      }

      this.updatePublicationStatus(currentPublication, 'superseded', input.audit, timestamp);
      this.updatePublicationStatus(targetPublication, 'active', input.audit, timestamp);

      const restoredVersion = this.applyVersionStateChange(
        targetVersion,
        { workflowStatus: 'published', indexPublicationStatus: 'active', errorMessage: null },
        input.audit,
        timestamp,
        true,
      );

      if (!this.hasActivePublication(currentVersion.versionId)) {
        this.applyVersionStateChange(
          currentVersion,
          {
            workflowStatus: input.quarantineCurrent ? 'quarantined' : 'superseded',
            indexPublicationStatus: 'superseded',
          },
          input.audit,
          timestamp,
          true,
        );
      }

      return restoredVersion;
    })();
  }

  bindRagflowDocument(input: {
    bindingId?: string;
    versionId: string;
    indexGeneration: string;
    datasetId: string;
    documentId: string;
    remoteStatus: IndexPublicationStatus;
    isHealthy?: boolean;
    lastVerifiedAt?: string | null;
    audit: AuditContext;
  }): string {
    const timestamp = this.now().toISOString();
    const bindingId = input.bindingId ?? this.createId('binding');

    return this.database.transaction(() => {
      this.getVersionOrThrow(input.versionId);
      const record = {
        bindingId,
        versionId: input.versionId,
        indexGeneration: input.indexGeneration,
        datasetId: input.datasetId,
        documentId: input.documentId,
        remoteStatus: input.remoteStatus,
        isHealthy: input.isHealthy ?? true,
        lastVerifiedAt: input.lastVerifiedAt ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.database
        .prepare(`
          INSERT INTO ragflow_bindings (
            binding_id, version_id, index_generation, dataset_id, document_id, remote_status,
            is_healthy, last_verified_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          bindingId,
          input.versionId,
          input.indexGeneration,
          input.datasetId,
          input.documentId,
          input.remoteStatus,
          record.isHealthy ? 1 : 0,
          record.lastVerifiedAt,
          timestamp,
          timestamp,
        );
      this.appendAudit('ragflow_binding', bindingId, 'ragflow_binding.created', null, record, input.audit, timestamp);
      return bindingId;
    })();
  }

  findPendingBinding(input: {
    versionId: string;
    indexGeneration: string;
  }): PendingIndexBindingRecord | null {
    return this.pendingIndexRepository.findPendingBinding(input);
  }

  findUniquePendingBindingForVersion(versionId: string): PendingIndexBindingRecord | null {
    return this.pendingIndexRepository.findUniquePendingBindingForVersion(versionId);
  }

  ensureUnhealthyPendingBinding(input: {
    bindingId?: string;
    versionId: string;
    indexGeneration: string;
    datasetId: string;
    documentId: string;
    audit: AuditContext;
  }): PendingIndexBindingRecord {
    return this.pendingIndexRepository.ensureUnhealthyPendingBinding(input);
  }

  markPendingBindingHealthy(input: {
    versionId: string;
    indexGeneration: string;
    datasetId: string;
    documentId: string;
    chunkCount: number;
    lastVerifiedAt: string;
    audit: AuditContext;
  }): PendingIndexBindingRecord {
    return this.pendingIndexRepository.markPendingBindingHealthy(input);
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
    audit: AuditContext;
  }): ProcessingJobRecord {
    return this.pendingIndexRepository.completeParseWaitJob(input).job;
  }

  resolveActiveRetrievalScope(options: {
    branchKeys?: string[];
    effectiveAt?: string;
  } = {}): ActiveRetrievalScope {
    const resolvedAt = options.effectiveAt ?? this.now().toISOString();
    const requestedBranches = options.branchKeys ? new Set(options.branchKeys) : null;
    const publications = this.database
      .prepare(`
        SELECT publication.*, branch.branch_type
        FROM material_publications publication
        JOIN publication_branches branch
          ON branch.canonical_id = publication.canonical_id
         AND branch.branch_key = publication.publication_branch_key
        WHERE publication.publication_status = 'active'
        ORDER BY publication.canonical_id, publication.publication_branch_key, publication.created_at
      `)
      .all() as Array<PublicationRow & { branch_type: PublicationBranchType }>;

    const eligiblePublications = publications.filter((publication) => {
      if (requestedBranches && !requestedBranches.has(publication.publication_branch_key)) {
        return false;
      }
      if (publication.branch_type !== 'legal') {
        return true;
      }
      return Boolean(
        publication.effective_from
        && publication.effective_from <= resolvedAt
        && (!publication.effective_to || resolvedAt < publication.effective_to),
      );
    });

    if (eligiblePublications.length === 0) {
      throw new RegistryError(
        'EMPTY_ACTIVE_DOCUMENT_SET',
        '当前条件没有 SQLite 有效发布关系，正式检索已在本地失败关闭。',
      );
    }

    const datasetIds = new Set<string>();
    const documentIds = new Set<string>();
    for (const publication of eligiblePublications) {
      const version = this.getVersionOrThrow(publication.version_id);
      if (version.workflowStatus !== 'published' || version.indexPublicationStatus !== 'active') {
        throw new RegistryError(
          'INCOMPLETE_RAGFLOW_MAPPING',
          `有效发布 ${publication.publication_id} 的版本状态不完整，正式检索已失败关闭。`,
        );
      }

      const bindings = this.database
        .prepare(`
          SELECT dataset_id, document_id
          FROM ragflow_bindings
          WHERE version_id = ? AND remote_status = 'active' AND is_healthy = 1
          ORDER BY dataset_id, document_id
        `)
        .all(publication.version_id) as Array<{ dataset_id: string; document_id: string }>;
      if (bindings.length === 0) {
        throw new RegistryError(
          'INCOMPLETE_RAGFLOW_MAPPING',
          `有效发布 ${publication.publication_id} 没有已核验的 active RAGFlow 映射。`,
        );
      }
      for (const binding of bindings) {
        datasetIds.add(binding.dataset_id);
        documentIds.add(binding.document_id);
      }
    }

    if (documentIds.size === 0) {
      throw new RegistryError(
        'EMPTY_ACTIVE_DOCUMENT_SET',
        '精确 document_ids 为空，正式检索已在本地失败关闭。',
      );
    }

    return {
      datasetIds: [...datasetIds].sort(),
      documentIds: [...documentIds].sort(),
      resolvedAt,
    };
  }

  validateReturnedDocumentIds(
    returnedDocumentIds: string[],
    options: { branchKeys?: string[]; effectiveAt?: string } = {},
  ): RetrievalDocumentValidation {
    // 返回后重新查询，而不是复用请求前的数组，避免发布切换期间接受已经失效的文档。
    const currentScope = this.resolveActiveRetrievalScope(options);
    const allowed = new Set(currentScope.documentIds);
    const acceptedDocumentIds: string[] = [];
    const rejectedDocumentIds: string[] = [];

    for (const documentId of new Set(returnedDocumentIds)) {
      (allowed.has(documentId) ? acceptedDocumentIds : rejectedDocumentIds).push(documentId);
    }

    if (rejectedDocumentIds.length > 0) {
      const timestamp = this.now().toISOString();
      this.database.transaction(() => {
        this.appendAudit(
          'retrieval_scope',
          this.createId('scope'),
          'retrieval_scope.out_of_scope_result',
          null,
          { rejectedDocumentIds, resolvedAt: currentScope.resolvedAt },
          { actorId: 'system:route-a', reason: 'RAGFlow 返回了 SQLite 当前允许集合外的文档 ID。' },
          timestamp,
        );
      })();
    }

    return { acceptedDocumentIds, rejectedDocumentIds };
  }

  /**
   * C4 的单资料 smoke 必须同时限定 canonical 与 branch。仅按 branch_key 查询会把所有
   * C1 默认分支（都叫 default）混在一起，不能证明本次发布只暴露目标版本。
   */
  resolveActivePublicationScope(input: {
    canonicalId: string;
    publicationBranchKey: string;
    effectiveAt?: string;
  }): ActiveRetrievalScope {
    const resolvedAt = input.effectiveAt ?? this.now().toISOString();
    const rows = this.database
      .prepare(`
        SELECT publication.*, branch.branch_type
        FROM material_publications publication
        JOIN publication_branches branch
          ON branch.canonical_id = publication.canonical_id
         AND branch.branch_key = publication.publication_branch_key
        WHERE publication.canonical_id = ?
          AND publication.publication_branch_key = ?
          AND publication.publication_status = 'active'
        ORDER BY publication.created_at, publication.publication_id
      `)
      .all(input.canonicalId, input.publicationBranchKey) as Array<PublicationRow & {
        branch_type: PublicationBranchType;
      }>;
    const eligible = rows.filter((publication) => (
      publication.branch_type !== 'legal'
      || Boolean(
        publication.effective_from
        && publication.effective_from <= resolvedAt
        && (!publication.effective_to || resolvedAt < publication.effective_to)
      )
    ));
    if (eligible.length === 0) {
      throw new RegistryError(
        'EMPTY_ACTIVE_DOCUMENT_SET',
        '当前资料分支没有 SQLite 有效发布关系，发布验收已在本地失败关闭。',
      );
    }
    if (eligible.length !== 1) {
      throw new RegistryError(
        'PUBLICATION_CONFLICT',
        '当前资料分支存在多个同时有效的发布关系，发布验收已失败关闭。',
      );
    }

    const publication = eligible[0];
    const version = this.getVersionOrThrow(publication.version_id);
    if (
      version.workflowStatus !== 'published'
      || version.processingHealth !== 'healthy'
      || version.indexPublicationStatus !== 'active'
    ) {
      throw new RegistryError('INCOMPLETE_RAGFLOW_MAPPING', '当前发布版本的三维状态不完整。');
    }
    const bindings = this.database
      .prepare(`
        SELECT dataset_id, document_id
        FROM ragflow_bindings
        WHERE version_id = ? AND remote_status = 'active' AND is_healthy = 1
        ORDER BY dataset_id, document_id
      `)
      .all(version.versionId) as Array<{ dataset_id: string; document_id: string }>;
    if (bindings.length !== 1) {
      throw new RegistryError(
        'INCOMPLETE_RAGFLOW_MAPPING',
        'C4 单资料发布必须且只能对应一份已核验的 active RAGFlow 映射。',
      );
    }
    return {
      datasetIds: [bindings[0].dataset_id],
      documentIds: [bindings[0].document_id],
      resolvedAt,
    };
  }

  validateReturnedPublicationDocumentIds(
    returnedDocumentIds: string[],
    input: { canonicalId: string; publicationBranchKey: string; effectiveAt?: string },
  ): RetrievalDocumentValidation {
    // 返回后重新解析精确单资料 scope，避免发布或回滚切换期间接受刚失效的文档。
    const scope = this.resolveActivePublicationScope(input);
    const allowed = new Set(scope.documentIds);
    const acceptedDocumentIds: string[] = [];
    const rejectedDocumentIds: string[] = [];
    for (const documentId of new Set(returnedDocumentIds)) {
      (allowed.has(documentId) ? acceptedDocumentIds : rejectedDocumentIds).push(documentId);
    }
    if (rejectedDocumentIds.length > 0) {
      const timestamp = this.now().toISOString();
      this.database.transaction(() => {
        this.appendAudit(
          'retrieval_scope',
          this.createId('scope'),
          'retrieval_scope.publication_out_of_scope_result',
          null,
          {
            canonicalId: input.canonicalId,
            publicationBranchKey: input.publicationBranchKey,
            rejectedDocumentIds,
            resolvedAt: scope.resolvedAt,
          },
          { actorId: 'system:publication-smoke', reason: '发布验收返回了目标资料当前 scope 外的文档。' },
          timestamp,
        );
      })();
    }
    return { acceptedDocumentIds, rejectedDocumentIds };
  }

  enqueueJob(input: {
    jobId?: string;
    versionId: string;
    stage: JobStage;
    inputHash: string;
    profileVersion: string;
    maxAttempts?: number;
    audit: AuditContext;
  }): ProcessingJobRecord {
    const timestamp = this.now().toISOString();
    const jobId = input.jobId ?? this.createId('job');

    return this.database.transaction(() => {
      this.getVersionOrThrow(input.versionId);
      this.database
        .prepare(`
          INSERT INTO processing_jobs (
            job_id, version_id, stage, status, input_hash, profile_version,
            attempt_count, max_attempts, created_at, updated_at
          ) VALUES (?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?)
        `)
        .run(
          jobId,
          input.versionId,
          input.stage,
          input.inputHash,
          input.profileVersion,
          input.maxAttempts ?? 3,
          timestamp,
          timestamp,
        );
      const job = this.getJobOrThrow(jobId);
      this.appendAudit('processing_job', jobId, 'processing_job.enqueued', null, job, input.audit, timestamp);
      return job;
    })();
  }

  claimNextJob(input: {
    workerId: string;
    leaseDurationMs: number;
    stages?: JobStage[];
    audit: AuditContext;
  }): ProcessingJobRecord | null {
    const now = this.now();
    const timestamp = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs).toISOString();
    const stages = input.stages ? [...new Set(input.stages)] : null;

    if (stages?.length === 0) {
      return null;
    }

    return this.database.transaction(() => {
      const stageClause = stages
        ? `AND stage IN (${stages.map(() => '?').join(', ')})`
        : '';
      const row = this.database
        .prepare(`
          SELECT * FROM processing_jobs
          WHERE (
            status = 'queued'
            OR (status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= ?)
          )
            AND cancel_requested_at IS NULL
            AND attempt_count < max_attempts
            ${stageClause}
          ORDER BY created_at, job_id
          LIMIT 1
        `)
        .get(timestamp, ...(stages ?? [])) as JobRow | undefined;
      if (!row) {
        return null;
      }

      this.database
        .prepare(`
          UPDATE processing_jobs
          SET status = 'running', attempt_count = attempt_count + 1,
              lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?,
              next_retry_at = NULL, error_code = NULL, error_message = NULL, updated_at = ?
          WHERE job_id = ?
        `)
        .run(input.workerId, leaseExpiresAt, timestamp, timestamp, row.job_id);
      const claimed = this.getJobOrThrow(row.job_id);
      this.appendAudit('processing_job', row.job_id, 'processing_job.claimed', mapJob(row), claimed, input.audit, timestamp);
      return claimed;
    })();
  }

  heartbeatJob(input: {
    jobId: string;
    workerId: string;
    leaseDurationMs: number;
  }): ProcessingJobRecord {
    const now = this.now();
    const timestamp = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs).toISOString();

    return this.database.transaction(() => {
      const current = this.getJobOrThrow(input.jobId);
      if (
        current.status !== 'running'
        || current.leaseOwner !== input.workerId
        || !current.leaseExpiresAt
        || current.leaseExpiresAt <= timestamp
      ) {
        throw new RegistryError('JOB_STATE_CONFLICT', '只有持有当前租约的 worker 可以续租任务。');
      }
      this.database
        .prepare(`
          UPDATE processing_jobs
          SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
          WHERE job_id = ?
        `)
        .run(timestamp, leaseExpiresAt, timestamp, input.jobId);
      return this.getJobOrThrow(input.jobId);
    })();
  }

  completeJob(input: { jobId: string; workerId: string; audit: AuditContext }): ProcessingJobRecord {
    return this.finishRunningJob(input, 'succeeded');
  }

  completeJobAndEnqueue(input: {
    jobId: string;
    workerId: string;
    nextStage: JobStage;
    nextInputHash: string;
    nextProfileVersion: string;
    nextMaxAttempts?: number;
    audit: AuditContext;
  }): { completed: ProcessingJobRecord; next: ProcessingJobRecord } {
    return this.database.transaction(() => {
      const current = this.getJobOrThrow(input.jobId);
      this.assertWorkerOwnsRunningJob(current, input.workerId);
      const existing = this.database
        .prepare(`
          SELECT * FROM processing_jobs
          WHERE version_id = ? AND stage = ? AND input_hash = ? AND profile_version = ?
        `)
        .get(
          current.versionId,
          input.nextStage,
          input.nextInputHash,
          input.nextProfileVersion,
        ) as JobRow | undefined;

      // 当前阶段完成和下一阶段排队必须原子提交，避免进程退出后留下无法续跑的断链任务。
      const completed = this.finishRunningJob(
        { jobId: input.jobId, workerId: input.workerId, audit: input.audit },
        'succeeded',
      );
      const next = existing
        ? mapJob(existing)
        : this.enqueueJob({
            versionId: current.versionId,
            stage: input.nextStage,
            inputHash: input.nextInputHash,
            profileVersion: input.nextProfileVersion,
            maxAttempts: input.nextMaxAttempts,
            audit: input.audit,
          });
      return { completed, next };
    })();
  }

  failJob(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryAt?: string | null;
    audit: AuditContext;
  }): ProcessingJobRecord {
    const timestamp = this.now().toISOString();

    return this.database.transaction(() => {
      const current = this.getJobOrThrow(input.jobId);
      this.assertWorkerOwnsRunningJob(current, input.workerId);
      const retryAt = current.attemptCount < current.maxAttempts ? input.retryAt ?? null : null;
      this.database
        .prepare(`
          UPDATE processing_jobs
          SET status = 'failed', next_retry_at = ?, lease_owner = NULL, lease_expires_at = NULL,
              heartbeat_at = NULL, error_code = ?, error_message = ?, updated_at = ?
          WHERE job_id = ?
        `)
        .run(retryAt, input.errorCode, input.errorMessage, timestamp, input.jobId);
      const failed = this.getJobOrThrow(input.jobId);
      this.appendAudit('processing_job', input.jobId, 'processing_job.failed', current, failed, input.audit, timestamp);
      return failed;
    })();
  }

  failJobAndUpdateVersion(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryAt?: string | null;
    audit: AuditContext;
  }): ProcessingJobRecord {
    return this.database.transaction(() => {
      const currentJob = this.getJobOrThrow(input.jobId);
      const currentVersion = this.getVersionOrThrow(currentJob.versionId);
      const failedJob = this.failJob(input);
      this.applyVersionStateChange(
        currentVersion,
        {
          processingHealth: failedJob.nextRetryAt ? 'processing' : 'failed',
          errorMessage: sanitizeProcessingErrorMessage(input.errorCode, input.errorMessage),
        },
        input.audit,
        this.now().toISOString(),
        false,
      );
      return failedJob;
    })();
  }

  releaseJobForShutdown(input: {
    jobId: string;
    workerId: string;
    audit: AuditContext;
  }): ProcessingJobRecord {
    const timestamp = this.now().toISOString();

    return this.database.transaction(() => {
      const current = this.getJobOrThrow(input.jobId);
      this.assertWorkerOwnsRunningJob(current, input.workerId);

      // 主动停机不消耗一次业务重试机会，否则最后一次租约会被重排成永远无法领取的 queued。
      this.database
        .prepare(`
          UPDATE processing_jobs
          SET status = 'queued', attempt_count = MAX(attempt_count - 1, 0),
              next_retry_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
              heartbeat_at = NULL, error_code = NULL, error_message = NULL, updated_at = ?
          WHERE job_id = ?
        `)
        .run(timestamp, input.jobId);
      const released = this.getJobOrThrow(input.jobId);
      this.appendAudit(
        'processing_job',
        input.jobId,
        'processing_job.released_for_shutdown',
        current,
        released,
        input.audit,
        timestamp,
      );
      return released;
    })();
  }

  requestJobCancellation(jobId: string, audit: AuditContext): ProcessingJobRecord {
    const timestamp = this.now().toISOString();

    return this.database.transaction(() => {
      const current = this.getJobOrThrow(jobId);
      if (current.status === 'succeeded' || current.status === 'cancelled') {
        throw new RegistryError('JOB_STATE_CONFLICT', '已结束任务不能再次请求取消。');
      }
      if (current.status === 'cancel_requested') {
        return current;
      }
      const nextStatus = current.status === 'running' ? 'cancel_requested' : 'cancelled';
      this.database
        .prepare(`
          UPDATE processing_jobs
          SET status = ?, cancel_requested_at = ?,
              lease_owner = CASE WHEN ? = 'cancelled' THEN NULL ELSE lease_owner END,
              lease_expires_at = CASE WHEN ? = 'cancelled' THEN NULL ELSE lease_expires_at END,
              updated_at = ?
          WHERE job_id = ?
        `)
        .run(nextStatus, timestamp, nextStatus, nextStatus, timestamp, jobId);
      const cancelled = this.getJobOrThrow(jobId);
      this.appendAudit(
        'processing_job',
        jobId,
        nextStatus === 'cancelled' ? 'processing_job.cancelled' : 'processing_job.cancel_requested',
        current,
        cancelled,
        audit,
        timestamp,
      );
      return cancelled;
    })();
  }

  retryJob(jobId: string, audit: AuditContext): ProcessingJobRecord {
    const timestamp = this.now().toISOString();
    return this.database.transaction(() => {
      const current = this.getJobOrThrow(jobId);
      if (current.status !== 'failed' && current.status !== 'cancelled') {
        throw new RegistryError('JOB_STATE_CONFLICT', '只有失败或已取消的任务可以重新排队。');
      }
      this.database
        .prepare(`
          UPDATE processing_jobs
          SET status = 'queued', attempt_count = 0, next_retry_at = NULL,
              lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
              cancel_requested_at = NULL, error_code = NULL, error_message = NULL,
              updated_at = ?
          WHERE job_id = ?
        `)
        .run(timestamp, jobId);
      const retried = this.getJobOrThrow(jobId);
      this.appendAudit(
        'processing_job',
        jobId,
        'processing_job.retried_by_user',
        current,
        retried,
        audit,
        timestamp,
      );
      return retried;
    })();
  }

  getProcessingJob(jobId: string): ProcessingJobRecord {
    return this.getJobOrThrow(jobId);
  }

  listProcessingJobs(versionId: string): ProcessingJobRecord[] {
    this.getVersionOrThrow(versionId);
    return (this.database
      .prepare('SELECT * FROM processing_jobs WHERE version_id = ? ORDER BY created_at, job_id')
      .all(versionId) as JobRow[]).map(mapJob);
  }

  acknowledgeJobCancellation(input: {
    jobId: string;
    workerId: string;
    audit: AuditContext;
  }): ProcessingJobRecord {
    return this.finishRunningJob(input, 'cancelled', 'cancel_requested');
  }

  acknowledgeJobCancellationAndUpdateVersion(input: {
    jobId: string;
    workerId: string;
    errorMessage: string;
    audit: AuditContext;
  }): ProcessingJobRecord {
    return this.database.transaction(() => {
      const currentJob = this.getJobOrThrow(input.jobId);
      const currentVersion = this.getVersionOrThrow(currentJob.versionId);
      const cancelledJob = this.acknowledgeJobCancellation({
        jobId: input.jobId,
        workerId: input.workerId,
        audit: input.audit,
      });
      this.applyVersionStateChange(
        currentVersion,
        {
          processingHealth: 'failed',
          errorMessage: sanitizeProcessingErrorMessage('CANCELLED', input.errorMessage),
        },
        input.audit,
        this.now().toISOString(),
        false,
      );
      return cancelledJob;
    })();
  }

  recoverExpiredJobs(audit: AuditContext): ProcessingJobRecord[] {
    const timestamp = this.now().toISOString();

    return this.database.transaction(() => {
      const expiredRows = this.database
        .prepare(`
          SELECT * FROM processing_jobs
          WHERE status IN ('running', 'cancel_requested')
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at <= ?
          ORDER BY created_at, job_id
        `)
        .all(timestamp) as JobRow[];

      const recovered: ProcessingJobRecord[] = [];
      for (const row of expiredRows) {
        const qualityRun = row.stage === 'quality'
          ? this.qualityGateRepository.getRunForJob(row.job_id)
          : null;
        if (qualityRun && row.status === 'cancel_requested') {
          // quality 必须由质量仓储同时收口 run/job，不能沿用基础处理的版本失败路径。
          const cancelled = this.qualityGateRepository.cancelRun({
            qualityRunId: qualityRun.qualityRunId,
            workerId: row.lease_owner ?? undefined,
            recoverExpiredLease: true,
            audit,
          });
          recovered.push(cancelled.job);
          continue;
        }
        if (
          qualityRun
          && row.status === 'running'
          && (row.attempt_count >= row.max_attempts || qualityRun.expiresAt <= timestamp)
        ) {
          const failed = this.qualityGateRepository.failRun({
            qualityRunId: qualityRun.qualityRunId,
            workerId: row.lease_owner!,
            errorCode: 'PROCESSING_RETRY_EXHAUSTED',
            errorMessage: '质量任务租约过期且已达到最大尝试次数。',
            recoverExpiredLease: true,
            audit,
          });
          recovered.push(failed.job);
          continue;
        }

        const nextStatus = row.status === 'cancel_requested'
          ? 'cancelled'
          : row.attempt_count >= row.max_attempts
            ? 'failed'
            : 'queued';
        const exhausted = nextStatus === 'failed';
        const terminalErrorCode = exhausted
          ? 'PROCESSING_RETRY_EXHAUSTED'
          : nextStatus === 'cancelled'
            ? 'CANCELLED'
            : null;
        const terminalErrorMessage = exhausted
          ? '任务租约过期且已达到最大尝试次数。'
          : nextStatus === 'cancelled'
            ? '任务在取消请求后租约过期，启动恢复已确认取消。'
            : null;
        this.database
          .prepare(`
            UPDATE processing_jobs
            SET status = ?, lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
                next_retry_at = NULL,
                error_code = COALESCE(?, error_code),
                error_message = COALESCE(?, error_message),
                updated_at = ?
            WHERE job_id = ?
          `)
          .run(nextStatus, terminalErrorCode, terminalErrorMessage, timestamp, row.job_id);
        const updated = this.getJobOrThrow(row.job_id);
        this.appendAudit(
          'processing_job',
          row.job_id,
          nextStatus === 'cancelled'
            ? 'processing_job.recovered_as_cancelled'
            : nextStatus === 'failed'
              ? 'processing_job.recovered_as_failed_after_max_attempts'
              : 'processing_job.requeued_after_restart',
          mapJob(row),
          updated,
          audit,
          timestamp,
        );
        if (
          row.stage !== 'quality'
          && row.stage !== 'publication_compensation'
          && (nextStatus === 'failed' || nextStatus === 'cancelled')
        ) {
          const version = this.getVersionOrThrow(row.version_id);
          this.applyVersionStateChange(
            version,
            {
              processingHealth: 'failed',
              errorMessage: sanitizeProcessingErrorMessage(
                terminalErrorCode ?? 'FILE_PROCESSING',
                terminalErrorMessage ?? '',
              ),
            },
            audit,
            timestamp,
            false,
          );
        }
        recovered.push(updated);
      }
      return recovered;
    })();
  }

  listAuditEvents(entityType?: string, entityId?: string): Array<Record<string, unknown>> {
    const clauses: string[] = [];
    const parameters: string[] = [];
    if (entityType) {
      clauses.push('entity_type = ?');
      parameters.push(entityType);
    }
    if (entityId) {
      clauses.push('entity_id = ?');
      parameters.push(entityId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.database
      .prepare(`SELECT * FROM audit_events ${where} ORDER BY created_at, event_id`)
      .all(...parameters) as Array<Record<string, unknown>>;
  }

  private getMaterialOrThrow(canonicalId: string): MaterialRecord {
    const row = this.database.prepare('SELECT * FROM materials WHERE canonical_id = ?').get(canonicalId) as
      | MaterialRow
      | undefined;
    if (!row) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到资料 ${canonicalId}。`);
    }
    return mapMaterial(row);
  }

  private getBranchOrThrow(canonicalId: string, branchKey: string): PublicationBranchRecord {
    const row = this.database
      .prepare('SELECT * FROM publication_branches WHERE canonical_id = ? AND branch_key = ?')
      .get(canonicalId, branchKey) as BranchRow | undefined;
    if (!row) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到发布分支 ${canonicalId}:${branchKey}。`);
    }
    return mapBranch(row);
  }

  private getVersionOrThrow(versionId: string): MaterialVersionRecord {
    const row = this.database.prepare('SELECT * FROM material_versions WHERE version_id = ?').get(versionId) as
      | VersionRow
      | undefined;
    if (!row) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到资料版本 ${versionId}。`);
    }
    return mapVersion(row);
  }

  private getPublicationOrThrow(publicationId: string): PublicationRow {
    const row = this.database
      .prepare('SELECT * FROM material_publications WHERE publication_id = ?')
      .get(publicationId) as PublicationRow | undefined;
    if (!row) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到发布关系 ${publicationId}。`);
    }
    return row;
  }

  private getJobOrThrow(jobId: string): ProcessingJobRecord {
    const row = this.database.prepare('SELECT * FROM processing_jobs WHERE job_id = ?').get(jobId) as
      | JobRow
      | undefined;
    if (!row) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到处理任务 ${jobId}。`);
    }
    return mapJob(row);
  }

  private applyVersionStateChange(
    current: MaterialVersionRecord,
    patch: VersionStatePatch,
    audit: AuditContext,
    timestamp: string,
    allowPublicationTransition: boolean,
  ): MaterialVersionRecord {
    assertVersionStatePatch(current, patch);

    if (
      !allowPublicationTransition
      && (patch.workflowStatus === 'published'
        || patch.workflowStatus === 'superseded'
        || patch.workflowStatus === 'archived'
        || patch.indexPublicationStatus === 'active')
    ) {
      throw new RegistryError(
        'PUBLICATION_PRECONDITION_FAILED',
        '发布相关状态只能由发布事务改变。',
      );
    }

    const nextWorkflow = patch.workflowStatus ?? current.workflowStatus;
    const nextProcessing = patch.processingHealth ?? current.processingHealth;
    const nextIndex = patch.indexPublicationStatus ?? current.indexPublicationStatus;
    const publishedAt = nextWorkflow === 'published' ? timestamp : current.publishedAt;
    const supersededAt = nextWorkflow === 'superseded' ? timestamp : current.supersededAt;
    const archivedAt = nextWorkflow === 'archived' ? timestamp : current.archivedAt;

    this.database
      .prepare(`
        UPDATE material_versions
        SET workflow_status = ?, processing_health = ?, index_publication_status = ?,
            error_message = ?, updated_at = ?, published_at = ?, superseded_at = ?, archived_at = ?
        WHERE version_id = ?
      `)
      .run(
        nextWorkflow,
        nextProcessing,
        nextIndex,
        patch.errorMessage === undefined ? current.errorMessage : patch.errorMessage,
        timestamp,
        publishedAt,
        supersededAt,
        archivedAt,
        current.versionId,
      );
    const updated = this.getVersionOrThrow(current.versionId);
    this.appendAudit(
      'material_version',
      current.versionId,
      'material_version.state_changed',
      current,
      updated,
      audit,
      timestamp,
    );
    return updated;
  }

  private updatePublicationStatus(
    current: PublicationRow,
    status: PublicationRow['publication_status'],
    audit: AuditContext,
    timestamp: string,
  ): PublicationRow {
    this.database
      .prepare(`
        UPDATE material_publications
        SET publication_status = ?, updated_at = ?, closed_at = ?
        WHERE publication_id = ?
      `)
      .run(status, timestamp, status === 'active' ? null : timestamp, current.publication_id);
    const updated = this.getPublicationOrThrow(current.publication_id);
    this.appendAudit(
      'material_publication',
      current.publication_id,
      `material_publication.${status}`,
      current,
      updated,
      audit,
      timestamp,
    );
    return updated;
  }

  private assertPublicationBelongsToBranch(
    publication: PublicationRow,
    version: MaterialVersionRecord,
  ): void {
    if (
      publication.publication_status !== 'active'
      || publication.canonical_id !== version.canonicalId
      || publication.publication_branch_key !== version.publicationBranchKey
    ) {
      throw new RegistryError(
        'PUBLICATION_PRECONDITION_FAILED',
        '被替代发布关系必须是同一资料、同一分支内的当前有效关系。',
      );
    }
  }

  private hasActivePublication(versionId: string): boolean {
    return Number(
      this.database
        .prepare("SELECT COUNT(*) FROM material_publications WHERE version_id = ? AND publication_status = 'active'")
        .pluck()
        .get(versionId),
    ) > 0;
  }

  private finishRunningJob(
    input: { jobId: string; workerId: string; audit: AuditContext },
    nextStatus: 'succeeded' | 'cancelled',
    expectedStatus: ProcessingJobRecord['status'] = 'running',
  ): ProcessingJobRecord {
    const timestamp = this.now().toISOString();

    return this.database.transaction(() => {
      const current = this.getJobOrThrow(input.jobId);
      if (current.status !== expectedStatus || current.leaseOwner !== input.workerId) {
        throw new RegistryError('JOB_STATE_CONFLICT', '只有持有当前租约的 worker 可以结束任务。');
      }
      this.database
        .prepare(`
          UPDATE processing_jobs
          SET status = ?, lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
              next_retry_at = NULL, updated_at = ?
          WHERE job_id = ?
        `)
        .run(nextStatus, timestamp, input.jobId);
      const finished = this.getJobOrThrow(input.jobId);
      this.appendAudit(
        'processing_job',
        input.jobId,
        `processing_job.${nextStatus}`,
        current,
        finished,
        input.audit,
        timestamp,
      );
      return finished;
    })();
  }

  private assertWorkerOwnsRunningJob(job: ProcessingJobRecord, workerId: string): void {
    if (job.status !== 'running' || job.leaseOwner !== workerId) {
      throw new RegistryError('JOB_STATE_CONFLICT', '只有持有当前租约的 worker 可以更新任务结果。');
    }
  }

  private appendAudit(
    entityType: string,
    entityId: string,
    action: string,
    before: unknown,
    after: unknown,
    context: AuditContext,
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
