import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  buildLayout3ActiveMetadata,
  buildLayout3PendingMetadata,
  buildLayout3SupersededMetadata,
} from './ingestion-metadata';
import { PublicationOperationRepository } from './publication-operation-repository';
import { QualityGateRepository } from './quality-gate-repository';
import type {
  RagflowIngestionPrivateConfig,
  RagflowIngestionConfigStore,
} from './ragflow-config-store';
import { RagflowClient } from './ragflow/client';
import { RagflowError } from './ragflow/errors';
import type {
  RagflowDocument,
  RagflowMetadata,
  RagflowRetrievalCandidate,
  RagflowRetrievalInput,
} from './ragflow/types';
import type { RegistryDatabase } from './registry-database';
import { RegistryStore } from './registry-store';
import {
  RegistryError,
  type MaterialVersionRecord,
  type ProcessingJobRecord,
  type PublicationOperationRecord,
  type QualityRunRecord,
} from './types';

interface PublicationServiceOptions {
  now?: () => Date;
  remoteFactory?: (config: RagflowIngestionPrivateConfig) => PublicationRemote;
  createId?: (prefix: string) => string;
}

interface PublicationRemote {
  patchDocumentMetadataAndVerify(input: {
    datasetId: string;
    documentId: string;
    metadata: RagflowMetadata;
    signal?: AbortSignal;
  }): Promise<RagflowDocument>;
  retrieveCandidates(input: RagflowRetrievalInput): Promise<RagflowRetrievalCandidate[]>;
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
  updated_at: string;
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

interface AuditContext {
  actorId: string;
  reason: string;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function normalizeEvidence(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function getStableErrorCode(error: unknown): string {
  if (error instanceof RagflowError) return `${error.code}:${error.reason}`;
  if (error instanceof RegistryError) return error.code;
  return 'RUNTIME_UNAVAILABLE';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发布操作发生未知错误。';
}

function isLeaseConflict(error: unknown): boolean {
  return error instanceof RegistryError
    && (error.code === 'JOB_STATE_CONFLICT' || error.code === 'CANCELLED');
}

function validateReason(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) {
    throw new RegistryError('INPUT_VALIDATION', `${label}必须为 1～500 个字符。`);
  }
  return normalized;
}

export class PublicationService {
  private readonly database: Database.Database;
  private readonly now: () => Date;
  private readonly remoteFactory: (config: RagflowIngestionPrivateConfig) => PublicationRemote;
  private readonly createId: (prefix: string) => string;

  constructor(
    registryDatabase: RegistryDatabase,
    private readonly operations: PublicationOperationRepository,
    private readonly registryStore: RegistryStore,
    private readonly qualityRepository: QualityGateRepository,
    private readonly configStore: RagflowIngestionConfigStore,
    options: PublicationServiceOptions = {},
  ) {
    this.database = registryDatabase.connection;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.remoteFactory = options.remoteFactory ?? ((config) => new RagflowClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    }));
  }

  async createPublishOperation(input: {
    versionId: string;
    reason?: string;
  }): Promise<PublicationOperationRecord> {
    const reason = validateReason(input.reason ?? '用户确认发布当前待发布资料。', '发布原因');
    const version = this.registryStore.getMaterialVersion(input.versionId);
    const qualityRun = this.qualityRepository.assertPublishablePassedRun(version.versionId);
    const config = await this.configStore.getPrivateConfig();
    this.assertQualityConfig(qualityRun, config);
    const currentPublication = this.getActivePublication(version.canonicalId, version.publicationBranchKey);
    if (currentPublication && version.previousVersionId !== currentPublication.version_id) {
      throw new RegistryError('PUBLICATION_CONFLICT', '待发布版本不是当前有效版本的直接下一版。');
    }
    const targetBinding = this.getUniqueBinding(version.versionId, 'pending');
    this.assertBindingConfig(targetBinding, config);

    const releaseId = this.createId('release');
    const targetPublicationId = this.createId('publication');
    return this.operations.createOperation({
      operationType: 'publish',
      canonicalId: version.canonicalId,
      publicationBranchKey: version.publicationBranchKey,
      targetVersionId: version.versionId,
      currentVersionId: currentPublication?.version_id ?? null,
      qualityRunId: qualityRun.qualityRunId,
      releaseId,
      targetPublicationId,
      currentPublicationId: currentPublication?.publication_id ?? null,
      inputSnapshot: {
        schemaVersion: 'layout3_publication_operation_v1',
        reason,
        targetOriginalStatus: 'pending',
      },
      configSnapshot: this.toConfigSnapshot(config),
      inputHash: hashJson({
        operationType: 'publish',
        versionId: version.versionId,
        qualityRunId: qualityRun.qualityRunId,
        releaseId,
        targetPublicationId,
        config: this.toConfigSnapshot(config),
      }),
      audit: { actorId: 'user:local', reason },
    }).operation;
  }

  async createRollbackOperation(input: {
    currentVersionId: string;
    reason: string;
  }): Promise<PublicationOperationRecord> {
    const reason = validateReason(input.reason, '回滚原因');
    const currentVersion = this.registryStore.getMaterialVersion(input.currentVersionId);
    if (
      currentVersion.workflowStatus !== 'published'
      || currentVersion.processingHealth !== 'healthy'
      || currentVersion.indexPublicationStatus !== 'active'
      || !currentVersion.previousVersionId
    ) {
      throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '当前版本没有可回滚的同分支上一版本。');
    }
    const currentPublication = this.getActivePublication(
      currentVersion.canonicalId,
      currentVersion.publicationBranchKey,
    );
    if (!currentPublication || currentPublication.version_id !== currentVersion.versionId) {
      throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '当前版本不是该分支唯一有效发布。');
    }
    const targetVersion = this.registryStore.getMaterialVersion(currentVersion.previousVersionId);
    if (
      targetVersion.workflowStatus !== 'superseded'
      || targetVersion.processingHealth !== 'healthy'
      || targetVersion.indexPublicationStatus !== 'superseded'
    ) {
      throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '上一版本当前不具备健康、已替代且可恢复的完整状态。');
    }
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
    if (hasNewerVersion) {
      throw new RegistryError('PUBLICATION_CONFLICT', '该资料分支已接收更高版本，不能回滚当前版本。');
    }
    const targetPublication = this.getSupersededPublicationForRollback(currentPublication, targetVersion.versionId);
    const qualityRun = this.qualityRepository.getLatestPassedRunForVersion(targetVersion.versionId);
    const config = await this.configStore.getPrivateConfig();
    const targetBinding = this.getUniqueBinding(targetVersion.versionId, 'superseded');
    const currentBinding = this.getUniqueBinding(currentVersion.versionId, 'active');
    this.assertBindingConfig(targetBinding, config);
    this.assertBindingConfig(currentBinding, config);

    const releaseId = this.createId('release');
    return this.operations.createOperation({
      operationType: 'rollback',
      canonicalId: currentVersion.canonicalId,
      publicationBranchKey: currentVersion.publicationBranchKey,
      targetVersionId: targetVersion.versionId,
      currentVersionId: currentVersion.versionId,
      qualityRunId: qualityRun.qualityRunId,
      releaseId,
      targetPublicationId: targetPublication.publication_id,
      currentPublicationId: currentPublication.publication_id,
      inputSnapshot: {
        schemaVersion: 'layout3_publication_operation_v1',
        reason,
        targetOriginalStatus: 'superseded',
      },
      configSnapshot: this.toConfigSnapshot(config),
      inputHash: hashJson({
        operationType: 'rollback',
        currentVersionId: currentVersion.versionId,
        targetVersionId: targetVersion.versionId,
        qualityRunId: qualityRun.qualityRunId,
        releaseId,
        config: this.toConfigSnapshot(config),
      }),
      audit: { actorId: 'user:local', reason },
    }).operation;
  }

  retryOperationForVersion(versionId: string): PublicationOperationRecord {
    const operation = this.operations.getLatestOperationForVersion(versionId);
    if (!operation) throw new RegistryError('RECORD_NOT_FOUND', '当前资料没有可重试的发布操作。');
    return this.operations.retryOperation(operation.operationId, {
      actorId: 'user:local',
      reason: '用户在资料入库中心人工重试发布或回滚操作。',
    }).operation;
  }

  async execute(input: {
    job: ProcessingJobRecord;
    workerId: string;
    signal: AbortSignal;
  }): Promise<void> {
    let operation = this.getOperationForJob(input.job);
    for (let step = 0; step < 8; step += 1) {
      this.throwIfAborted(input.signal);
      switch (operation.phase) {
        case 'prepared':
          operation = await this.prepareRemoteTarget(operation, input.workerId, input.signal);
          break;
        case 'target_active_verified':
          operation = await this.commitSqliteSwitch(operation, input.workerId);
          break;
        case 'sqlite_switched':
          operation = await this.verifyAndCleanup(operation, input.workerId, input.signal);
          break;
        case 'cleanup_verified':
          this.operations.completeOperation({
            operationId: operation.operationId,
            workerId: input.workerId,
            audit: {
              actorId: 'system:publication-runner',
              reason: '发布或回滚的正式 scope 与远端清理均已核验。',
            },
          });
          return;
        case 'restore_target_pending':
        case 'restore_target_superseded':
          await this.restoreTargetAndClose(operation, input.workerId, input.signal);
          return;
        case 'completed':
        case 'failed':
          return;
        default:
          throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '发布操作阶段无法识别。');
      }
    }
    throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '发布操作在单次执行中超过允许的阶段数量。');
  }

  fail(input: {
    job: ProcessingJobRecord;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryAt: string | null;
  }): void {
    const operation = this.getOperationForJob(input.job);
    this.operations.failAttempt({
      operationId: operation.operationId,
      workerId: input.workerId,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      retryAt: input.retryAt,
      audit: {
        actorId: 'system:publication-runner',
        reason: input.retryAt
          ? '发布操作发生可重试错误，已安排持久退避。'
          : '发布操作需要人工处理后重试。',
      },
    });
  }

  private async prepareRemoteTarget(
    operation: PublicationOperationRecord,
    workerId: string,
    signal: AbortSignal,
  ): Promise<PublicationOperationRecord> {
    let prepared: {
      config: RagflowIngestionPrivateConfig;
      version: MaterialVersionRecord;
      binding: BindingRow;
      qualityRun: QualityRunRecord;
      remote: PublicationRemote;
    };
    try {
      prepared = await this.resolvePreparedContext(operation);
    } catch (error) {
      if (isLeaseConflict(error)) throw error;
      this.operations.closeFailedWithoutRemoteMutation({
        operationId: operation.operationId,
        workerId,
        errorCode: getStableErrorCode(error),
        errorMessage: getErrorMessage(error),
        audit: {
          actorId: 'system:publication-runner',
          reason: '发布前置条件在远端写入前失效，已安全终止操作。',
        },
      });
      return this.operations.getOperation(operation.operationId);
    }

    try {
      const metadata = buildLayout3ActiveMetadata(prepared.version, prepared.binding.index_generation);
      const document = await prepared.remote.patchDocumentMetadataAndVerify({
        datasetId: prepared.binding.dataset_id,
        documentId: prepared.binding.document_id,
        metadata,
        signal,
      });
      this.assertRemoteDocumentHealthy(document, prepared.binding.document_id);
      await this.runExactSmoke({
        operation,
        qualityRun: prepared.qualityRun,
        binding: prepared.binding,
        remote: prepared.remote,
        signal,
        validatePublishedScope: false,
      });
      return this.operations.advancePhase({
        operationId: operation.operationId,
        workerId,
        nextPhase: 'target_active_verified',
        audit: {
          actorId: 'system:publication-runner',
          reason: '目标远端文档 active metadata 与预发布精确 smoke 已核验。',
        },
      });
    } catch (error) {
      if (isLeaseConflict(error)) throw error;
      return this.operations.beginCompensation({
        operationId: operation.operationId,
        workerId,
        restorePhase: operation.operationType === 'publish'
          ? 'restore_target_pending'
          : 'restore_target_superseded',
        errorCode: getStableErrorCode(error),
        errorMessage: getErrorMessage(error),
        audit: {
          actorId: 'system:publication-runner',
          reason: '目标远端可能已 active，但 SQLite 尚未切换，开始恢复目标原状态。',
        },
      });
    }
  }

  private async commitSqliteSwitch(
    operation: PublicationOperationRecord,
    workerId: string,
  ): Promise<PublicationOperationRecord> {
    try {
      const config = await this.configStore.getPrivateConfig();
      const targetBinding = this.getBinding(operation.targetBindingId);
      this.assertOperationConfig(operation, config);
      this.assertBindingConfig(targetBinding, config);
      if (operation.operationType === 'publish') {
        const qualityRun = this.qualityRepository.assertPublishablePassedRun(operation.targetVersionId);
        if (qualityRun.qualityRunId !== operation.qualityRunId) {
          throw new RegistryError('QUALITY_BLOCK', '待发布版本的当前质量结论已经变化。');
        }
      }

      return this.database.transaction(() => {
        if (operation.operationType === 'publish') {
          this.registryStore.publishVersion({
            versionId: operation.targetVersionId,
            releaseId: operation.releaseId,
            publicationId: operation.targetPublicationId,
            replacePublicationId: operation.currentPublicationId ?? undefined,
            replacedVersionDisposition: 'superseded',
            requireCurrentQualityRun: true,
            audit: {
              actorId: 'system:publication-runner',
              reason: '目标远端 active 已核验，SQLite 原子切换当前有效发布关系。',
            },
          });
          this.updateBindingStatus(
            targetBinding.binding_id,
            'pending',
            'active',
            { actorId: 'system:publication-runner', reason: '发布事务将目标 binding 切换为 active。' },
          );
        } else {
          const currentVersion = this.registryStore.getMaterialVersion(operation.currentVersionId!);
          const targetVersion = this.registryStore.getMaterialVersion(operation.targetVersionId);
          if (
            currentVersion.previousVersionId !== targetVersion.versionId
            || targetVersion.workflowStatus !== 'superseded'
            || targetVersion.processingHealth !== 'healthy'
            || targetVersion.indexPublicationStatus !== 'superseded'
          ) {
            throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '回滚目标版本状态已漂移，SQLite 正式关系保持不变。');
          }
          this.registryStore.rollbackPublication({
            currentPublicationId: operation.currentPublicationId!,
            targetPublicationId: operation.targetPublicationId,
            quarantineCurrent: true,
            audit: {
              actorId: 'system:publication-runner',
              reason: String(operation.inputSnapshot.reason ?? '用户确认回滚当前问题版本。'),
            },
          });
          this.updateBindingStatus(
            targetBinding.binding_id,
            'superseded',
            'active',
            { actorId: 'system:publication-runner', reason: '回滚事务将目标旧版 binding 恢复为 active。' },
          );
        }
        return this.operations.advancePhase({
          operationId: operation.operationId,
          workerId,
          nextPhase: 'sqlite_switched',
          audit: {
            actorId: 'system:publication-runner',
            reason: 'SQLite publication、版本、binding 与 operation 已在同一事务切换。',
          },
        });
      })();
    } catch (error) {
      if (isLeaseConflict(error)) throw error;
      return this.operations.beginCompensation({
        operationId: operation.operationId,
        workerId,
        restorePhase: operation.operationType === 'publish'
          ? 'restore_target_pending'
          : 'restore_target_superseded',
        errorCode: getStableErrorCode(error),
        errorMessage: getErrorMessage(error),
        audit: {
          actorId: 'system:publication-runner',
          reason: 'SQLite 切换未提交，目标远端 active 开始恢复原状态。',
        },
      });
    }
  }

  private async verifyAndCleanup(
    operation: PublicationOperationRecord,
    workerId: string,
    signal: AbortSignal,
  ): Promise<PublicationOperationRecord> {
    const config = await this.configStore.getPrivateConfig();
    this.assertOperationConfig(operation, config);
    const targetBinding = this.getBinding(operation.targetBindingId);
    if (targetBinding.remote_status !== 'active') {
      throw new RegistryError('INCOMPLETE_RAGFLOW_MAPPING', 'SQLite 切换后目标 binding 不是 active。');
    }
    const qualityRun = this.qualityRepository.getRun(operation.qualityRunId);
    const remote = this.remoteFactory(config);
    await this.runExactSmoke({
      operation,
      qualityRun,
      binding: targetBinding,
      remote,
      signal,
      validatePublishedScope: true,
    });

    if (!operation.currentBindingId || !operation.currentVersionId) {
      return this.operations.advancePhase({
        operationId: operation.operationId,
        workerId,
        nextPhase: 'cleanup_verified',
        audit: { actorId: 'system:publication-runner', reason: '首次发布没有旧远端文档需要降级。' },
      });
    }

    const sourceBinding = this.getBinding(operation.currentBindingId);
    const sourceVersion = this.registryStore.getMaterialVersion(operation.currentVersionId);
    this.assertBindingConfig(sourceBinding, config);
    const document = await remote.patchDocumentMetadataAndVerify({
      datasetId: sourceBinding.dataset_id,
      documentId: sourceBinding.document_id,
      metadata: buildLayout3SupersededMetadata(sourceVersion, sourceBinding.index_generation),
      signal,
    });
    this.assertRemoteDocumentHealthy(document, sourceBinding.document_id);

    return this.database.transaction(() => {
      this.updateBindingStatus(
        sourceBinding.binding_id,
        'active',
        'superseded',
        { actorId: 'system:publication-runner', reason: '旧版远端 superseded 已回读，收口本地 binding。' },
      );
      return this.operations.advancePhase({
        operationId: operation.operationId,
        workerId,
        nextPhase: 'cleanup_verified',
        audit: {
          actorId: 'system:publication-runner',
          reason: '被替代或问题版本的远端 superseded 状态已核验。',
        },
      });
    })();
  }

  private async restoreTargetAndClose(
    operation: PublicationOperationRecord,
    workerId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const config = await this.configStore.getPrivateConfig();
    this.assertOperationConfig(operation, config);
    const binding = this.getBinding(operation.targetBindingId);
    const version = this.registryStore.getMaterialVersion(operation.targetVersionId);
    this.assertBindingConfig(binding, config);
    const metadata = operation.phase === 'restore_target_pending'
      ? buildLayout3PendingMetadata(version, binding.index_generation)
      : buildLayout3SupersededMetadata(version, binding.index_generation);
    const document = await this.remoteFactory(config).patchDocumentMetadataAndVerify({
      datasetId: binding.dataset_id,
      documentId: binding.document_id,
      metadata,
      signal,
    });
    this.assertRemoteDocumentHealthy(document, binding.document_id);
    this.operations.compensateAndCloseFailed({
      operationId: operation.operationId,
      workerId,
      errorCode: operation.errorCode ?? 'PUBLICATION_PRECONDITION_FAILED',
      errorMessage: operation.errorMessage ?? '发布操作失败，目标远端状态已恢复。',
      audit: {
        actorId: 'system:publication-runner',
        reason: 'SQLite 未切换，目标远端已恢复原状态并安全关闭失败操作。',
      },
    });
  }

  private async resolvePreparedContext(operation: PublicationOperationRecord): Promise<{
    config: RagflowIngestionPrivateConfig;
    version: MaterialVersionRecord;
    binding: BindingRow;
    qualityRun: QualityRunRecord;
    remote: PublicationRemote;
  }> {
    const config = await this.configStore.getPrivateConfig();
    this.assertOperationConfig(operation, config);
    const version = this.registryStore.getMaterialVersion(operation.targetVersionId);
    const binding = this.getBinding(operation.targetBindingId);
    this.assertBindingConfig(binding, config);
    const expectedStatus = operation.operationType === 'publish' ? 'pending' : 'superseded';
    if (
      binding.version_id !== operation.targetVersionId
      || binding.remote_status !== expectedStatus
      || binding.is_healthy !== 1
      || binding.remote_run_status !== 'DONE'
      || !Number.isInteger(binding.chunk_count)
      || (binding.chunk_count ?? 0) <= 0
      || !binding.last_verified_at
    ) {
      throw new RegistryError('INCOMPLETE_RAGFLOW_MAPPING', '目标远端 binding 的健康或状态证据已漂移。');
    }
    this.assertTopologyBeforeRemoteMutation(operation, version, binding, config);
    const qualityRun = operation.operationType === 'publish'
      ? this.qualityRepository.assertPublishablePassedRun(operation.targetVersionId)
      : this.qualityRepository.getLatestPassedRunForVersion(operation.targetVersionId);
    if (
      qualityRun.qualityRunId !== operation.qualityRunId
      || qualityRun.bindingId !== binding.binding_id
    ) {
      throw new RegistryError('QUALITY_BLOCK', '发布操作固定的质量运行或 binding 已发生漂移。');
    }
    this.assertQualityConfig(qualityRun, config);
    return { config, version, binding, qualityRun, remote: this.remoteFactory(config) };
  }

  private assertTopologyBeforeRemoteMutation(
    operation: PublicationOperationRecord,
    targetVersion: MaterialVersionRecord,
    targetBinding: BindingRow,
    config: RagflowIngestionPrivateConfig,
  ): void {
    if (
      targetVersion.canonicalId !== operation.canonicalId
      || targetVersion.publicationBranchKey !== operation.publicationBranchKey
    ) {
      throw new RegistryError('PUBLICATION_CONFLICT', '发布操作固定的目标版本分支已漂移。');
    }
    const uniqueTargetBinding = this.getUniqueBinding(
      targetVersion.versionId,
      operation.operationType === 'publish' ? 'pending' : 'superseded',
    );
    if (uniqueTargetBinding.binding_id !== targetBinding.binding_id) {
      throw new RegistryError('INCOMPLETE_RAGFLOW_MAPPING', '发布操作固定的目标 binding 已漂移。');
    }
    const activePublication = this.getActivePublication(
      operation.canonicalId,
      operation.publicationBranchKey,
    );

    if (operation.operationType === 'publish') {
      if (
        targetVersion.workflowStatus !== 'pending_publication'
        || targetVersion.processingHealth !== 'healthy'
        || targetVersion.indexPublicationStatus !== 'pending'
        || (activePublication?.publication_id ?? null) !== operation.currentPublicationId
        || (activePublication?.version_id ?? null) !== operation.currentVersionId
        || (activePublication && targetVersion.previousVersionId !== activePublication.version_id)
      ) {
        throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '发布前的版本或当前正式关系已漂移。');
      }
      if (operation.currentVersionId || operation.currentPublicationId || operation.currentBindingId) {
        if (!operation.currentVersionId || !operation.currentPublicationId || !operation.currentBindingId) {
          throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '替代发布缺少固定的当前版本关系。');
        }
        const currentBinding = this.getUniqueBinding(operation.currentVersionId, 'active');
        const currentVersion = this.registryStore.getMaterialVersion(operation.currentVersionId);
        this.assertBindingConfig(currentBinding, config);
        if (
          currentBinding.binding_id !== operation.currentBindingId
          || currentVersion.workflowStatus !== 'published'
          || currentVersion.processingHealth !== 'healthy'
          || currentVersion.indexPublicationStatus !== 'active'
          || currentVersion.canonicalId !== operation.canonicalId
          || currentVersion.publicationBranchKey !== operation.publicationBranchKey
        ) {
          throw new RegistryError('INCOMPLETE_RAGFLOW_MAPPING', '替代发布固定的当前 binding 已漂移。');
        }
      }
      return;
    }

    if (!operation.currentVersionId || !operation.currentPublicationId || !operation.currentBindingId) {
      throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '回滚操作缺少固定的当前版本关系。');
    }
    const currentVersion = this.registryStore.getMaterialVersion(operation.currentVersionId);
    const currentBinding = this.getUniqueBinding(currentVersion.versionId, 'active');
    this.assertBindingConfig(currentBinding, config);
    const targetPublication = activePublication
      ? this.getSupersededPublicationForRollback(activePublication, targetVersion.versionId)
      : null;
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
      currentVersion.canonicalId !== operation.canonicalId
      || currentVersion.publicationBranchKey !== operation.publicationBranchKey
      || currentVersion.workflowStatus !== 'published'
      || currentVersion.processingHealth !== 'healthy'
      || currentVersion.indexPublicationStatus !== 'active'
      || currentVersion.previousVersionId !== targetVersion.versionId
      || targetVersion.workflowStatus !== 'superseded'
      || targetVersion.processingHealth !== 'healthy'
      || targetVersion.indexPublicationStatus !== 'superseded'
      || activePublication?.publication_id !== operation.currentPublicationId
      || activePublication?.version_id !== currentVersion.versionId
      || targetPublication?.publication_id !== operation.targetPublicationId
      || currentBinding.binding_id !== operation.currentBindingId
      || hasNewerVersion
    ) {
      throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '回滚前的版本拓扑、健康状态或固定关系已漂移。');
    }
  }

  private async runExactSmoke(input: {
    operation: PublicationOperationRecord;
    qualityRun: QualityRunRecord;
    binding: BindingRow;
    remote: PublicationRemote;
    signal: AbortSignal;
    validatePublishedScope: boolean;
  }): Promise<void> {
    if (input.qualityRun.questionsSnapshot.length < 1 || input.qualityRun.questionsSnapshot.length > 3) {
      throw new RegistryError('QUALITY_BLOCK', '发布 smoke 缺少有效的自动索引健康检查样本。');
    }
    for (const question of input.qualityRun.questionsSnapshot) {
      this.throwIfAborted(input.signal);
      const candidates = await input.remote.retrieveCandidates({
        question: question.question,
        datasetIds: [input.binding.dataset_id],
        documentIds: [input.binding.document_id],
        signal: input.signal,
      });
      if (candidates.length === 0) {
        throw new RegistryError('QUALITY_BLOCK', '发布 smoke 未命中目标资料。');
      }
      const outside = candidates.filter((candidate) => (
        candidate.datasetId !== input.binding.dataset_id
        || candidate.documentId !== input.binding.document_id
      ));
      if (outside.length > 0) {
        throw new RegistryError('REMOTE_CONTRACT', '发布 smoke 返回了目标精确 scope 外的候选。');
      }
      const evidence = normalizeEvidence(question.evidenceExcerpt);
      if (!candidates.some((candidate) => normalizeEvidence(candidate.content).includes(evidence))) {
        throw new RegistryError('QUALITY_BLOCK', '发布 smoke 未命中质量运行固定的正文证据。');
      }
      if (input.validatePublishedScope) {
        const validation = this.registryStore.validateReturnedPublicationDocumentIds(
          candidates.map((candidate) => candidate.documentId),
          {
            canonicalId: input.operation.canonicalId,
            publicationBranchKey: input.operation.publicationBranchKey,
          },
        );
        if (validation.rejectedDocumentIds.length > 0 || validation.acceptedDocumentIds.length !== 1) {
          throw new RegistryError('REMOTE_CONTRACT', '发布后候选不属于 SQLite 当前单资料 active scope。');
        }
      }
    }
  }

  private assertRemoteDocumentHealthy(document: RagflowDocument, expectedDocumentId: string): void {
    if (
      document.id !== expectedDocumentId
      || String(document.run ?? '').toUpperCase() !== 'DONE'
      || !Number.isInteger(document.chunk_count)
      || (document.chunk_count ?? 0) <= 0
    ) {
      throw new RegistryError('INCOMPLETE_RAGFLOW_MAPPING', '远端文档 active/superseded 回读缺少健康 DONE 与非零切片证据。');
    }
  }

  private assertQualityConfig(run: QualityRunRecord, config: RagflowIngestionPrivateConfig): void {
    const snapshot = run.configSnapshot;
    if (
      snapshot.baseUrl !== config.baseUrl
      || snapshot.stagingDatasetId !== config.stagingDatasetId
      || snapshot.indexGeneration !== config.indexGeneration
    ) {
      throw new RegistryError('REMOTE_AUTH_CONFIG', '质量运行与当前发布 RAGFlow 身份不一致。');
    }
  }

  private assertOperationConfig(
    operation: PublicationOperationRecord,
    config: RagflowIngestionPrivateConfig,
  ): void {
    if (
      operation.configSnapshot.baseUrl !== config.baseUrl
      || operation.configSnapshot.stagingDatasetId !== config.stagingDatasetId
      || operation.configSnapshot.indexGeneration !== config.indexGeneration
    ) {
      throw new RegistryError('REMOTE_AUTH_CONFIG', '发布操作持久配置身份与当前安全配置不一致。');
    }
  }

  private assertBindingConfig(binding: BindingRow, config: RagflowIngestionPrivateConfig): void {
    if (
      binding.dataset_id !== config.stagingDatasetId
      || binding.index_generation !== config.indexGeneration
    ) {
      throw new RegistryError('REMOTE_AUTH_CONFIG', '发布 binding 与当前数据集或索引代次不一致。');
    }
  }

  private toConfigSnapshot(config: RagflowIngestionPrivateConfig): Record<string, unknown> {
    return {
      baseUrl: config.baseUrl,
      stagingDatasetId: config.stagingDatasetId,
      indexGeneration: config.indexGeneration,
    };
  }

  private getOperationForJob(job: ProcessingJobRecord): PublicationOperationRecord {
    const operation = this.operations.getOperationForJob(job.jobId);
    if (!operation || operation.targetVersionId !== job.versionId) {
      throw new RegistryError('JOB_STATE_CONFLICT', '发布任务没有匹配的持久发布操作。');
    }
    return operation;
  }

  private getBinding(bindingId: string): BindingRow {
    const row = this.database.prepare(`
      SELECT binding_id, version_id, index_generation, dataset_id, document_id,
             remote_status, is_healthy, remote_run_status, chunk_count,
             last_verified_at, updated_at
      FROM ragflow_bindings WHERE binding_id = ?
    `).get(bindingId) as BindingRow | undefined;
    if (!row) throw new RegistryError('INCOMPLETE_RAGFLOW_MAPPING', '发布操作固定的远端 binding 不存在。');
    return row;
  }

  private getUniqueBinding(versionId: string, remoteStatus: BindingRow['remote_status']): BindingRow {
    const rows = this.database.prepare(`
      SELECT binding_id, version_id, index_generation, dataset_id, document_id,
             remote_status, is_healthy, remote_run_status, chunk_count,
             last_verified_at, updated_at
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
    ) {
      throw new RegistryError('INCOMPLETE_RAGFLOW_MAPPING', `资料版本没有唯一健康 ${remoteStatus} binding。`);
    }
    return rows[0];
  }

  private getActivePublication(canonicalId: string, branchKey: string): PublicationRow | null {
    const rows = this.database.prepare(`
      SELECT * FROM material_publications
      WHERE canonical_id = ? AND publication_branch_key = ? AND publication_status = 'active'
      ORDER BY created_at, publication_id
    `).all(canonicalId, branchKey) as PublicationRow[];
    if (rows.length > 1) throw new RegistryError('PUBLICATION_CONFLICT', '当前分支存在多个有效发布关系。');
    return rows[0] ?? null;
  }

  private getSupersededPublicationForRollback(
    current: PublicationRow,
    targetVersionId: string,
  ): PublicationRow {
    const rows = this.database.prepare(`
      SELECT * FROM material_publications
      WHERE canonical_id = ? AND publication_branch_key = ?
        AND version_id = ? AND publication_status = 'superseded'
        AND effective_from IS ? AND effective_to IS ?
      ORDER BY closed_at DESC, updated_at DESC, publication_id DESC
    `).all(
      current.canonical_id,
      current.publication_branch_key,
      targetVersionId,
      current.effective_from,
      current.effective_to,
    ) as PublicationRow[];
    if (rows.length !== 1) {
      throw new RegistryError('PUBLICATION_PRECONDITION_FAILED', '没有唯一、同有效区间的上一发布关系可回滚。');
    }
    return rows[0];
  }

  private updateBindingStatus(
    bindingId: string,
    expectedStatus: BindingRow['remote_status'],
    nextStatus: BindingRow['remote_status'],
    audit: AuditContext,
  ): void {
    const before = this.getBinding(bindingId);
    if (before.remote_status !== expectedStatus || before.is_healthy !== 1) {
      throw new RegistryError('INCOMPLETE_RAGFLOW_MAPPING', '发布 binding 状态已发生漂移。');
    }
    const timestamp = this.now().toISOString();
    this.database.prepare(`
      UPDATE ragflow_bindings
      SET remote_status = ?, last_verified_at = ?, updated_at = ?
      WHERE binding_id = ?
    `).run(nextStatus, timestamp, timestamp, bindingId);
    const after = this.getBinding(bindingId);
    this.appendAudit(
      'ragflow_binding',
      bindingId,
      `ragflow_binding.${nextStatus}`,
      before,
      after,
      audit,
      timestamp,
    );
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
      JSON.stringify(before),
      JSON.stringify(after),
      timestamp,
    );
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new RegistryError('CANCELLED', '发布操作已停止。');
  }
}
