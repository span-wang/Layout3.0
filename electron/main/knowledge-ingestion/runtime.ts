import { join } from 'node:path';
import type {
  KnowledgeIngestionRagflowConfigStatus,
  KnowledgeIngestionListRagflowDatasetsInput,
  KnowledgeIngestionRagflowDatasetOption,
  KnowledgeIngestionRuntimeStatus,
  KnowledgeIngestionSaveRagflowConfigInput,
  KnowledgeIngestionItem,
  KnowledgeIngestionStartQualityCheckInput,
} from '../../../src/types/knowledgeIngestion';
import { IntakeService } from './intake-service';
import { IntakeStore } from './intake-store';
import { ProcessingArtifactService } from './processing';
import { ProcessingRunner, type ProcessingRunnerOptions } from './processing-runner';
import { PublicationOperationRepository } from './publication-operation-repository';
import { PublicationService } from './publication-service';
import { QualityGateRepository } from './quality-gate-repository';
import { QualityGateService } from './quality-gate-service';
import {
  RagflowIngestionConfigStore,
  normalizeRagflowBaseUrl,
  type CredentialCipher,
} from './ragflow-config-store';
import { openRegistryDatabase, type RegistryDatabase } from './registry-database';
import { RegistryStore } from './registry-store';
import { REGISTRY_SCHEMA_VERSION } from './schema';
import { RegistryError } from './types';
import { RagflowClient } from './ragflow/client';

interface KnowledgeIngestionRuntimeOptions {
  allowTestProcess?: boolean;
  now?: () => Date;
  credentialCipher?: CredentialCipher;
  startProcessingRunner?: boolean;
  processingRunnerOptions?: ProcessingRunnerOptions;
}

const unavailableCredentialCipher: CredentialCipher = {
  isAvailable: () => false,
  encryptString: () => {
    throw new Error('安全存储不可用');
  },
  decryptString: () => {
    throw new Error('安全存储不可用');
  },
};

export class KnowledgeIngestionRuntime {
  private database: RegistryDatabase | null = null;
  private service: IntakeService | null = null;
  private intakeStore: IntakeStore | null = null;
  private qualityGateService: QualityGateService | null = null;
  private publicationService: PublicationService | null = null;
  private runner: ProcessingRunner | null = null;
  private initializing: Promise<IntakeService> | null = null;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private recoveredJobCount = 0;
  private readonly ragflowConfigStore: RagflowIngestionConfigStore;
  private remoteIdentityOperationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly userDataPath: string,
    private readonly options: KnowledgeIngestionRuntimeOptions = {},
  ) {
    const root = join(this.userDataPath, 'knowledge-ingestion');
    this.ragflowConfigStore = new RagflowIngestionConfigStore(
      join(root, 'ragflow-ingestion.json'),
      options.credentialCipher ?? unavailableCredentialCipher,
      options.now,
    );
  }

  async getStatus(): Promise<KnowledgeIngestionRuntimeStatus> {
    try {
      await this.getService();
      return {
        state: 'ready',
        message: '资料登记库已就绪',
        recoveredJobCount: this.recoveredJobCount,
        schemaVersion: REGISTRY_SCHEMA_VERSION,
      };
    } catch (error) {
      return {
        state: 'unavailable',
        message: error instanceof Error ? error.message : '资料登记库暂不可用。',
        recoveredJobCount: 0,
        schemaVersion: null,
      };
    }
  }

  async getService(): Promise<IntakeService> {
    if (this.closing) {
      throw new RegistryError('RUNTIME_UNAVAILABLE', '资料入库运行时正在关闭，不能开始新的操作。');
    }
    if (this.service) {
      return this.service;
    }
    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = this.initialize();
    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  getRagflowConfigStatus(): Promise<KnowledgeIngestionRagflowConfigStatus> {
    return this.ragflowConfigStore.getStatus();
  }

  async listRagflowDatasetOptions(
    input: KnowledgeIngestionListRagflowDatasetsInput,
  ): Promise<KnowledgeIngestionRagflowDatasetOption[]> {
    const connection = await this.ragflowConfigStore.resolveDatasetReadConfig(input);
    // Renderer 只拿到候选名称和受控选择值，连接凭据始终停留在 Main。
    return new RagflowClient(connection).listAllDatasets();
  }

  async saveRagflowConfig(
    input: KnowledgeIngestionSaveRagflowConfigInput,
  ): Promise<KnowledgeIngestionRagflowConfigStatus> {
    // 先确保登记库已打开，配置身份切换才能核验磁盘中尚未完成的远端工作。
    await this.getService();
    return this.withRemoteIdentityLock(async () => {
      const current = await this.ragflowConfigStore.getStatus();
      const nextBaseUrl = normalizeRagflowBaseUrl(input.baseUrl);
      const nextDatasetId = input.stagingDatasetId.trim();
      const nextIndexGeneration = input.indexGeneration.trim();
      const hasPublishedRemoteHistory = this.hasPublishedRemoteHistory();
      const hasUnresolvedRemoteWork = this.hasUnresolvedRemoteWork();
      const currentIdentity = current.configured
        ? {
            baseUrl: normalizeRagflowBaseUrl(current.baseUrl),
            stagingDatasetId: current.stagingDatasetId,
            indexGeneration: current.indexGeneration,
          }
        : null;
      const persistedIdentity = this.resolvePersistedRemoteIdentity();
      const currentIdentityConflictsWithSnapshot = currentIdentity !== null
        && persistedIdentity !== null
        && (
          currentIdentity.baseUrl !== persistedIdentity.baseUrl
          || currentIdentity.stagingDatasetId !== persistedIdentity.stagingDatasetId
          || currentIdentity.indexGeneration !== persistedIdentity.indexGeneration
        );
      if (hasPublishedRemoteHistory && (!persistedIdentity || currentIdentityConflictsWithSnapshot)) {
        throw new RegistryError(
          'REMOTE_AUTH_CONFIG',
          '已有 active 或 superseded 发布历史，但本机配置身份无法与不可变快照唯一核对；不能保存新的远端身份。',
        );
      }
      if (hasUnresolvedRemoteWork && currentIdentityConflictsWithSnapshot) {
        throw new RegistryError(
          'REMOTE_AUTH_CONFIG',
          '本机配置身份与未完成远端工作的持久快照不一致，不能保存新的远端身份。',
        );
      }
      const lockedIdentity = hasPublishedRemoteHistory
        ? persistedIdentity
        : persistedIdentity ?? currentIdentity;
      if ((hasPublishedRemoteHistory || hasUnresolvedRemoteWork) && !lockedIdentity) {
        throw new RegistryError(
          'REMOTE_AUTH_CONFIG',
          hasPublishedRemoteHistory
            ? '已有 active 或 superseded 发布历史，但本机配置身份缺失且无法由不可变快照唯一证明；不能保存新的远端身份。'
            : '仍有未完成远端工作，但本机配置身份缺失且无法由持久快照唯一证明；不能保存新的远端身份。',
        );
      }
      const identityChanged = lockedIdentity !== null && (
        lockedIdentity.baseUrl !== nextBaseUrl
        || lockedIdentity.stagingDatasetId !== nextDatasetId
        || lockedIdentity.indexGeneration !== nextIndexGeneration
      );
      if (identityChanged && hasPublishedRemoteHistory) {
        throw new RegistryError(
          'REMOTE_AUTH_CONFIG',
          '已有 active 或 superseded 发布历史，不能切换 RAGFlow 地址、数据集或索引代次；只允许同身份轮换 API Key。',
        );
      }
      if (identityChanged && hasUnresolvedRemoteWork) {
        throw new RegistryError(
          'REMOTE_AUTH_CONFIG',
          '仍有抽取、上传、解析或不健康 pending 绑定，暂不能切换 RAGFlow 地址、数据集或索引代次。',
        );
      }
      const status = await this.ragflowConfigStore.save(input);
      this.runner?.wake();
      return status;
    });
  }

  async startQualityCheck(
    input: KnowledgeIngestionStartQualityCheckInput,
  ): Promise<KnowledgeIngestionItem> {
    await this.getService();
    return this.withRemoteIdentityLock(async () => {
      const intakeStore = this.intakeStore;
      const qualityGateService = this.qualityGateService;
      if (!intakeStore || !qualityGateService) {
        throw new RegistryError('RUNTIME_UNAVAILABLE', '资料质量运行时尚未就绪。');
      }
      const item = intakeStore.getItem(input.itemId);
      if (item.isDuplicate) {
        throw new RegistryError('INTAKE_STATE_CONFLICT', '完全重复的接收记录不能启动质量检查。');
      }
      await qualityGateService.createRun({
        versionId: item.versionId,
      });
      this.runner?.wake();
      return intakeStore.getItem(input.itemId);
    });
  }

  async startPublication(itemId: string): Promise<KnowledgeIngestionItem> {
    await this.getService();
    return this.withRemoteIdentityLock(async () => {
      const intakeStore = this.intakeStore;
      const publicationService = this.publicationService;
      if (!intakeStore || !publicationService) {
        throw new RegistryError('RUNTIME_UNAVAILABLE', '资料发布运行时尚未就绪。');
      }
      const item = intakeStore.getItem(itemId);
      if (item.isDuplicate) {
        throw new RegistryError('INTAKE_STATE_CONFLICT', '完全重复的接收记录不能发布。');
      }
      await publicationService.createPublishOperation({ versionId: item.versionId });
      this.runner?.wake();
      return intakeStore.getItem(itemId);
    });
  }

  async startRollback(itemId: string, reason: string): Promise<KnowledgeIngestionItem> {
    await this.getService();
    return this.withRemoteIdentityLock(async () => {
      const intakeStore = this.intakeStore;
      const publicationService = this.publicationService;
      if (!intakeStore || !publicationService) {
        throw new RegistryError('RUNTIME_UNAVAILABLE', '资料回滚运行时尚未就绪。');
      }
      const item = intakeStore.getItem(itemId);
      if (item.isDuplicate) {
        throw new RegistryError('INTAKE_STATE_CONFLICT', '完全重复的接收记录不能回滚。');
      }
      await publicationService.createRollbackOperation({
        currentVersionId: item.versionId,
        reason,
      });
      this.runner?.wake();
      return intakeStore.getItem(itemId);
    });
  }

  async retryPublication(itemId: string): Promise<KnowledgeIngestionItem> {
    await this.getService();
    return this.withRemoteIdentityLock(async () => {
      const intakeStore = this.intakeStore;
      const publicationService = this.publicationService;
      if (!intakeStore || !publicationService) {
        throw new RegistryError('RUNTIME_UNAVAILABLE', '资料发布运行时尚未就绪。');
      }
      const item = intakeStore.getItem(itemId);
      if (item.isDuplicate) {
        throw new RegistryError('INTAKE_STATE_CONFLICT', '完全重复的接收记录没有可重试的发布操作。');
      }
      publicationService.retryOperationForVersion(item.versionId);
      this.runner?.wake();
      return intakeStore.getItem(itemId);
    });
  }

  async getProtectedRagflowDatasetIds(): Promise<string[]> {
    // 正式检索保护集合必须覆盖全部历史绑定；发布或替代后也不能让旧数据集失去保护。
    await this.getService();
    const configuredDatasetIds = await this.ragflowConfigStore.getProtectedDatasetIds();
    const boundDatasetIds = this.database
      ? (this.database.connection.prepare(`
          SELECT DISTINCT dataset_id
          FROM ragflow_bindings
        `).all() as Array<{ dataset_id: string }>).map((row) => row.dataset_id)
      : [];
    return [...new Set([...configuredDatasetIds, ...boundDatasetIds])];
  }

  /** 主进程启动后主动初始化并启动 runner；失败仍由 getStatus 隔离为中文不可用状态。 */
  async start(): Promise<void> {
    await this.getService();
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.closeInternal();
    return this.closePromise;
  }

  private async initialize(): Promise<IntakeService> {
    const root = join(this.userDataPath, 'knowledge-ingestion');
    let openedDatabase: RegistryDatabase | null = null;
    try {
      openedDatabase = await openRegistryDatabase({
        databasePath: join(root, 'registry.sqlite'),
        backupDirectory: join(root, 'backups'),
        allowTestProcess: this.options.allowTestProcess,
        now: this.options.now,
      });
      const registryStore = new RegistryStore(openedDatabase, { now: this.options.now });
      // 惰性开库时恢复租约已过期任务，普通编辑启动不受登记库故障影响。
      const recoveredJobs = registryStore.recoverExpiredJobs({
        actorId: 'system:startup',
        reason: '资料入库中心启动时恢复租约已过期任务。',
      });
      const intakeStore = new IntakeStore(openedDatabase, { now: this.options.now });
      const artifactService = new ProcessingArtifactService(openedDatabase, root, { now: this.options.now });
      const qualityGateService = new QualityGateService(
        new QualityGateRepository(openedDatabase, { now: this.options.now }),
        registryStore,
        artifactService,
        this.ragflowConfigStore,
        { now: this.options.now },
      );
      const publicationOperations = new PublicationOperationRepository(openedDatabase, {
        now: this.options.now,
      });
      const publicationService = new PublicationService(
        openedDatabase,
        publicationOperations,
        registryStore,
        new QualityGateRepository(openedDatabase, { now: this.options.now }),
        this.ragflowConfigStore,
        { now: this.options.now },
      );
      const service = new IntakeService(intakeStore, root);
      const shouldStartRunner = this.options.startProcessingRunner
        ?? !this.options.allowTestProcess;
      const runner = shouldStartRunner
        ? new ProcessingRunner(
            registryStore,
            artifactService,
            this.ragflowConfigStore,
            {
              ...this.options.processingRunnerOptions,
              now: this.options.processingRunnerOptions?.now ?? this.options.now,
              qualityExecutor: qualityGateService,
              publicationExecutor: publicationService,
            },
          )
        : null;
      if (this.closing) {
        openedDatabase.close();
        throw new RegistryError('RUNTIME_UNAVAILABLE', '资料入库运行时已关闭。');
      }
      this.database = openedDatabase;
      this.service = service;
      this.intakeStore = intakeStore;
      this.qualityGateService = qualityGateService;
      this.publicationService = publicationService;
      this.runner = runner;
      this.recoveredJobCount = recoveredJobs.length;
      runner?.start();
      return service;
    } catch (error) {
      openedDatabase?.close();
      this.database = null;
      this.service = null;
      this.intakeStore = null;
      this.qualityGateService = null;
      this.publicationService = null;
      this.runner = null;
      const safeMessage = error instanceof RegistryError
        ? error.message
        : '资料登记库初始化失败，请检查本机数据目录权限后重试。';
      throw new RegistryError('RUNTIME_UNAVAILABLE', safeMessage, { cause: error });
    }
  }

  private async closeInternal(): Promise<void> {
    try {
      // 配置保存或质量建档若仍在临界区，先等待其完成，避免关闭 SQLite 后继续写入。
      await this.remoteIdentityOperationTail;
      // close 可能与首次惰性开库并发，必须先等初始化落定，避免随后漏关新打开的 SQLite。
      if (this.initializing) {
        await this.initializing.catch(() => undefined);
      }
      await this.runner?.stop();
    } finally {
      this.runner = null;
      this.service = null;
      this.intakeStore = null;
      this.qualityGateService = null;
      this.publicationService = null;
      this.database?.close();
      this.database = null;
      this.recoveredJobCount = 0;
    }
  }

  private hasUnresolvedRemoteWork(): boolean {
    if (!this.database) return false;
    const count = Number(this.database.connection.prepare(`
      SELECT (
        SELECT COUNT(*)
        FROM processing_jobs
        WHERE (
          -- 抽取完成后会立刻续接上传；在此期间也必须保留同一份远端身份。
          stage IN ('extraction', 'upload', 'parse_wait')
          AND status IN ('queued', 'running', 'cancel_requested', 'failed')
        ) OR (
          stage = 'quality'
          AND status IN ('queued', 'running', 'cancel_requested')
        )
      ) + (
        SELECT COUNT(*)
        FROM ragflow_bindings
        WHERE remote_status = 'pending' AND is_healthy = 0
      ) + (
        SELECT COUNT(*)
        FROM quality_runs
        WHERE status IN ('queued', 'running')
      ) + (
        SELECT COUNT(*)
        FROM publication_operations
        WHERE phase NOT IN ('completed', 'failed')
      )
    `).pluck().get());
    return count > 0;
  }

  private resolvePersistedRemoteIdentity(): {
    baseUrl: string;
    stagingDatasetId: string;
    indexGeneration: string;
  } | null {
    if (!this.database) return null;
    const snapshotRows = this.database.connection.prepare(`
      SELECT operation.config_snapshot_json
      FROM publication_operations operation
      WHERE operation.phase NOT IN ('completed', 'failed')
         OR EXISTS (
           SELECT 1
           FROM material_publications publication
           WHERE publication.publication_id IN (
             operation.target_publication_id,
             operation.current_publication_id
           )
             AND publication.publication_status IN ('active', 'superseded')
         )
      UNION ALL
      SELECT run.config_snapshot_json
      FROM quality_runs run
      WHERE run.status IN ('queued', 'running')
         OR EXISTS (
           SELECT 1
           FROM material_publications publication
           WHERE publication.version_id = run.version_id
             AND publication.publication_status IN ('active', 'superseded')
             AND run.status = 'passed'
             AND run.conclusion = 'passed'
             AND run.quality_run_id = (
               SELECT latest.quality_run_id
               FROM quality_runs latest
               WHERE latest.version_id = run.version_id
                 AND latest.status = 'passed'
                 AND latest.conclusion = 'passed'
               ORDER BY latest.completed_at DESC, latest.quality_run_id DESC
               LIMIT 1
             )
         )
    `).all() as Array<{ config_snapshot_json: string }>;
    const identities = new Map<string, {
      baseUrl: string;
      stagingDatasetId: string;
      indexGeneration: string;
    }>();
    let hasInvalidSnapshot = false;
    for (const row of snapshotRows) {
      try {
        const snapshot = JSON.parse(row.config_snapshot_json) as Record<string, unknown>;
        if (
          typeof snapshot.baseUrl !== 'string'
          || typeof snapshot.stagingDatasetId !== 'string'
          || typeof snapshot.indexGeneration !== 'string'
        ) {
          hasInvalidSnapshot = true;
          continue;
        }
        const identity = {
          baseUrl: normalizeRagflowBaseUrl(snapshot.baseUrl),
          stagingDatasetId: snapshot.stagingDatasetId.trim(),
          indexGeneration: snapshot.indexGeneration.trim(),
        };
        if (!identity.baseUrl || !identity.stagingDatasetId || !identity.indexGeneration) {
          hasInvalidSnapshot = true;
          continue;
        }
        identities.set(JSON.stringify(identity), identity);
      } catch {
        // 配置快照损坏时不能猜测远端身份；即使存在其他可读快照也必须失败关闭。
        hasInvalidSnapshot = true;
      }
    }
    if (hasInvalidSnapshot || identities.size !== 1) return null;
    const identity = [...identities.values()][0]!;
    const bindingIdentities = this.database.connection.prepare(`
      SELECT DISTINCT dataset_id, index_generation
      FROM ragflow_bindings
      WHERE remote_status IN ('active', 'superseded')
    `).all() as Array<{ dataset_id: string; index_generation: string }>;
    if (bindingIdentities.some((binding) => (
      binding.dataset_id !== identity.stagingDatasetId
      || binding.index_generation !== identity.indexGeneration
    ))) return null;
    return identity;
  }

  private hasPublishedRemoteHistory(): boolean {
    if (!this.database) return false;
    const count = Number(this.database.connection.prepare(`
      SELECT (
        SELECT COUNT(*)
        FROM ragflow_bindings
        WHERE remote_status IN ('active', 'superseded')
      ) + (
        SELECT COUNT(*)
        FROM material_publications
        WHERE publication_status IN ('active', 'superseded')
      )
    `).pluck().get());
    return count > 0;
  }

  /**
   * 配置身份保存与质量运行建档共享同一临界区，避免“检查通过后、落盘前”插入旧身份运行。
   */
  private async withRemoteIdentityLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.remoteIdentityOperationTail;
    let release: () => void = () => undefined;
    this.remoteIdentityOperationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (this.closing) {
        throw new RegistryError('RUNTIME_UNAVAILABLE', '资料入库运行时正在关闭，不能开始新的操作。');
      }
      return await operation();
    } finally {
      release();
    }
  }
}
