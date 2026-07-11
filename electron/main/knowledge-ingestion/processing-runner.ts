import { randomUUID } from 'node:crypto';
import type { MaterialVersionRecord, ProcessingJobRecord } from './types';
import { RegistryError } from './types';
import type { ProcessingArtifactSet } from './processing';
import type { RagflowIngestionPrivateConfig } from './ragflow-config-store';
import { PendingIndexService, type PendingIndexRemote } from './pending-index-service';
import { RagflowClient } from './ragflow/client';
import { RagflowError } from './ragflow/errors';
import { buildLayout3PendingMetadata } from './ingestion-metadata';

const C2_JOB_STAGES = ['extraction', 'upload', 'parse_wait'] as const;
const QUALITY_JOB_STAGE = 'quality' as const;
type RunnerJobStage = (typeof C2_JOB_STAGES)[number] | typeof QUALITY_JOB_STAGE;

interface RunnerAuditContext {
  actorId: string;
  reason: string;
}

interface RunnerPendingBinding {
  versionId: string;
  indexGeneration: string;
  datasetId: string;
  documentId: string;
  remoteStatus: 'pending';
  isHealthy: boolean;
}

interface ProcessingRunnerStore {
  claimNextJob(input: {
    workerId: string;
    leaseDurationMs: number;
    stages: RunnerJobStage[];
    audit: RunnerAuditContext;
  }): ProcessingJobRecord | null;
  heartbeatJob(input: {
    jobId: string;
    workerId: string;
    leaseDurationMs: number;
  }): ProcessingJobRecord;
  getProcessingJob(jobId: string): ProcessingJobRecord;
  getMaterialVersion(versionId: string): MaterialVersionRecord;
  recoverExpiredJobs(audit: RunnerAuditContext): ProcessingJobRecord[];
  completeJobAndEnqueue(input: {
    jobId: string;
    workerId: string;
    nextStage: 'upload' | 'parse_wait';
    nextInputHash: string;
    nextProfileVersion: string;
    nextMaxAttempts?: number;
    audit: RunnerAuditContext;
  }): { completed: ProcessingJobRecord; next: ProcessingJobRecord };
  failJobAndUpdateVersion(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryAt?: string | null;
    audit: RunnerAuditContext;
  }): ProcessingJobRecord;
  acknowledgeJobCancellationAndUpdateVersion(input: {
    jobId: string;
    workerId: string;
    errorMessage: string;
    audit: RunnerAuditContext;
  }): ProcessingJobRecord;
  releaseJobForShutdown(input: {
    jobId: string;
    workerId: string;
    audit: RunnerAuditContext;
  }): ProcessingJobRecord;
  findPendingBinding(input: {
    versionId: string;
    indexGeneration: string;
  }): RunnerPendingBinding | null;
  findUniquePendingBindingForVersion(versionId: string): RunnerPendingBinding | null;
  ensureUnhealthyPendingBinding(input: {
    versionId: string;
    indexGeneration: string;
    datasetId: string;
    documentId: string;
    audit: RunnerAuditContext;
  }): void;
  markPendingBindingHealthy(input: {
    versionId: string;
    indexGeneration: string;
    datasetId: string;
    documentId: string;
    chunkCount: number;
    lastVerifiedAt: string;
    audit: RunnerAuditContext;
  }): void;
  completeParseWaitJob(input: {
    jobId: string;
    workerId: string;
    versionId: string;
    indexGeneration: string;
    datasetId: string;
    documentId: string;
    chunkCount: number;
    lastVerifiedAt: string;
    audit: RunnerAuditContext;
  }): ProcessingJobRecord;
}

interface ProcessingArtifactServiceLike {
  processVersion(input: {
    versionId: string;
    processingProfile?: string;
    signal?: AbortSignal;
  }): Promise<ProcessingArtifactSet>;
}

interface ProcessingRunnerConfigStore {
  getPrivateConfig(): Promise<RagflowIngestionPrivateConfig>;
  assertStagingDataset(datasetId: string): Promise<void>;
}

type RagflowRemoteFactory = (config: RagflowIngestionPrivateConfig) => PendingIndexRemote;

/**
 * 质量任务拥有独立的运行、结果和版本收口事务；runner 只负责租约、心跳和错误调度，
 * 不能复用 C2 的“失败即修改 processing_health”逻辑。
 */
export interface QualityJobExecutor {
  execute(input: {
    job: ProcessingJobRecord;
    workerId: string;
    signal: AbortSignal;
  }): Promise<void>;
  acknowledgeCancellation(input: {
    job: ProcessingJobRecord;
    workerId: string;
    message: string;
  }): void;
  fail(input: {
    job: ProcessingJobRecord;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryAt: string | null;
  }): void;
}

export interface ProcessingRunnerOptions {
  workerId?: string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  idlePollMs?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  parseTimeoutMs?: number;
  parsePollIntervalMs?: number;
  now?: () => Date;
  remoteFactory?: RagflowRemoteFactory;
  qualityExecutor?: QualityJobExecutor;
}

interface CapturedHealthyBinding {
  versionId: string;
  indexGeneration: string;
  datasetId: string;
  documentId: string;
  chunkCount: number;
  lastVerifiedAt: string;
}

function isCancellationError(error: unknown): boolean {
  return (error instanceof RegistryError && error.code === 'CANCELLED')
    || (error instanceof RagflowError && error.code === 'CANCELLED');
}

function isJobStateConflict(error: unknown): boolean {
  return error instanceof RegistryError && error.code === 'JOB_STATE_CONFLICT';
}

function getStableErrorCode(error: unknown): string {
  if (error instanceof RagflowError) {
    return `${error.code}:${error.reason}`;
  }
  if (error instanceof RegistryError) {
    return error.code;
  }
  return 'RUNTIME_UNAVAILABLE';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '资料处理发生未知错误。';
}

function isRetryableError(error: unknown): boolean {
  return error instanceof RagflowError
    ? error.retryable
    : error instanceof RegistryError && error.code === 'REMOTE_TRANSIENT';
}

export class ProcessingRunner {
  private readonly workerId: string;
  private readonly leaseDurationMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly idlePollMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly parseTimeoutMs?: number;
  private readonly parsePollIntervalMs?: number;
  private readonly now: () => Date;
  private readonly remoteFactory: RagflowRemoteFactory;
  private readonly qualityExecutor: QualityJobExecutor | null;
  private stopping = false;
  private loopPromise: Promise<void> | null = null;
  private activeJobPromise: Promise<void> | null = null;
  private activeAbortController: AbortController | null = null;
  private wakeResolver: (() => void) | null = null;

  constructor(
    private readonly store: ProcessingRunnerStore,
    private readonly artifactService: ProcessingArtifactServiceLike,
    private readonly configStore: ProcessingRunnerConfigStore,
    options: ProcessingRunnerOptions = {},
  ) {
    this.workerId = options.workerId ?? `knowledge-ingestion-${process.pid}-${randomUUID()}`;
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs
      ?? Math.max(1_000, Math.floor(this.leaseDurationMs / 3));
    if (this.heartbeatIntervalMs >= this.leaseDurationMs) {
      throw new RegistryError('INPUT_VALIDATION', '任务心跳间隔必须短于租约时长。');
    }
    this.idlePollMs = options.idlePollMs ?? 1_000;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 2_000;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 60_000;
    this.parseTimeoutMs = options.parseTimeoutMs;
    this.parsePollIntervalMs = options.parsePollIntervalMs;
    this.now = options.now ?? (() => new Date());
    this.remoteFactory = options.remoteFactory ?? ((config) => new RagflowClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    }));
    this.qualityExecutor = options.qualityExecutor ?? null;
  }

  start(): void {
    if (this.loopPromise) return;
    this.stopping = false;
    this.loopPromise = this.runLoop()
      .catch((error: unknown) => {
        this.stopping = true;
        console.error('资料处理 runner 因登记库异常停止：', error);
      })
      .finally(() => {
        this.loopPromise = null;
      });
  }

  wake(): void {
    this.wakeResolver?.();
  }

  async stop(): Promise<void> {
    if (this.stopping && !this.loopPromise && !this.activeJobPromise) return;
    this.stopping = true;
    this.activeAbortController?.abort();
    this.wake();
    await Promise.all([
      this.loopPromise ?? Promise.resolve(),
      this.activeJobPromise ?? Promise.resolve(),
    ]);
  }

  /** 测试与运行循环共用同一入口，确保每次领取前都恢复已经过期的旧租约。 */
  async runNextJob(): Promise<boolean> {
    if (this.stopping || this.activeJobPromise) return false;
    this.store.recoverExpiredJobs({
      actorId: 'system:processing-runner',
      reason: 'C2 runner 在领取前恢复已经过期的处理任务租约。',
    });
    const job = this.store.claimNextJob({
      workerId: this.workerId,
      leaseDurationMs: this.leaseDurationMs,
      stages: this.qualityExecutor
        ? [...C2_JOB_STAGES, QUALITY_JOB_STAGE]
        : [...C2_JOB_STAGES],
      audit: {
        actorId: 'system:processing-runner',
        reason: 'C2 runner 领取允许阶段的下一项持久任务。',
      },
    });
    if (!job) return false;

    const task = this.executeClaimedJob(job);
    this.activeJobPromise = task;
    try {
      await task;
    } finally {
      if (this.activeJobPromise === task) this.activeJobPromise = null;
    }
    return true;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      const processed = await this.runNextJob();
      if (!processed && !this.stopping) {
        await this.waitForWake();
      }
    }
  }

  private waitForWake(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(finish, this.idlePollMs);
      const runner = this;
      function finish(): void {
        clearTimeout(timer);
        if (runner.wakeResolver === finish) runner.wakeResolver = null;
        resolve();
      }
      this.wakeResolver = finish;
    });
  }

  private async executeClaimedJob(job: ProcessingJobRecord): Promise<void> {
    const controller = new AbortController();
    this.activeAbortController = controller;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      try {
        const current = this.store.getProcessingJob(job.jobId);
        if (current.status === 'cancel_requested') {
          controller.abort();
          return;
        }
        if (current.status !== 'running' || current.leaseOwner !== this.workerId) {
          leaseLost = true;
          controller.abort();
          return;
        }
        this.store.heartbeatJob({
          jobId: job.jobId,
          workerId: this.workerId,
          leaseDurationMs: this.leaseDurationMs,
        });
      } catch {
        // 一旦无法证明仍持有租约，就立即停止当前工作，禁止继续提交结果。
        leaseLost = true;
        controller.abort();
      }
    }, this.heartbeatIntervalMs);

    try {
      if (job.stage === 'extraction') {
        await this.runExtraction(job, controller.signal);
      } else if (job.stage === 'upload') {
        await this.runUpload(job, controller.signal);
      } else if (job.stage === 'parse_wait') {
        await this.runParseWait(job, controller.signal);
      } else if (job.stage === QUALITY_JOB_STAGE && this.qualityExecutor) {
        await this.qualityExecutor.execute({
          job,
          workerId: this.workerId,
          signal: controller.signal,
        });
      } else {
        throw new RegistryError('JOB_STATE_CONFLICT', `资料处理 runner 不允许执行阶段 ${job.stage}。`);
      }
    } catch (error) {
      if (leaseLost) return;
      await this.handleJobError(job, error);
    } finally {
      clearInterval(heartbeat);
      if (this.activeAbortController === controller) this.activeAbortController = null;
    }
  }

  private async runExtraction(job: ProcessingJobRecord, signal: AbortSignal): Promise<void> {
    const artifacts = await this.artifactService.processVersion({
      versionId: job.versionId,
      processingProfile: job.profileVersion,
      signal,
    });
    this.throwIfAborted(signal);
    this.store.completeJobAndEnqueue({
      jobId: job.jobId,
      workerId: this.workerId,
      nextStage: 'upload',
      nextInputHash: artifacts.body.sha256,
      nextProfileVersion: job.profileVersion,
      nextMaxAttempts: job.maxAttempts,
      audit: {
        actorId: 'system:processing-runner',
        reason: '基础抽取工件已核验，原子排入暂存上传阶段。',
      },
    });
  }

  private async runUpload(job: ProcessingJobRecord, signal: AbortSignal): Promise<void> {
    const artifacts = await this.loadAndVerifyArtifacts(job, signal);
    const version = this.store.getMaterialVersion(job.versionId);
    const config = await this.resolveRemoteConfig(job.versionId);
    const service = this.createPendingIndexService(config, {
      markHealthy: (input) => {
        this.store.markPendingBindingHealthy({
          ...input,
          audit: {
            actorId: 'system:processing-runner',
            reason: 'RAGFlow pending 文档已完成解析与 metadata 复核。',
          },
        });
      },
    });
    await service.prepareUpload({
      versionId: version.versionId,
      sourceHash: version.contentHash,
      indexGeneration: config.indexGeneration,
      datasetId: config.stagingDatasetId,
      artifactPath: artifacts.body.absolutePath,
      artifactMediaType: artifacts.body.mediaType,
      artifactExtension: 'txt',
      metadata: buildLayout3PendingMetadata(version, config.indexGeneration),
      signal,
    });
    this.throwIfAborted(signal);
    this.store.completeJobAndEnqueue({
      jobId: job.jobId,
      workerId: this.workerId,
      nextStage: 'parse_wait',
      nextInputHash: artifacts.body.sha256,
      nextProfileVersion: job.profileVersion,
      nextMaxAttempts: job.maxAttempts,
      audit: {
        actorId: 'system:processing-runner',
        reason: '暂存文档已确定性对账、绑定并触发解析，原子排入解析等待阶段。',
      },
    });
  }

  private async runParseWait(job: ProcessingJobRecord, signal: AbortSignal): Promise<void> {
    await this.loadAndVerifyArtifacts(job, signal);
    const version = this.store.getMaterialVersion(job.versionId);
    const config = await this.resolveRemoteConfig(job.versionId);
    const capturedResults: CapturedHealthyBinding[] = [];
    const service = this.createPendingIndexService(config, {
      // 最终健康证据先留在本轮内存中，随后与任务和版本状态在一个 SQLite 事务收口。
      markHealthy: (input) => {
        capturedResults.push(input);
      },
    });
    const result = await service.waitUntilHealthy({
      versionId: version.versionId,
      sourceHash: version.contentHash,
      indexGeneration: config.indexGeneration,
      datasetId: config.stagingDatasetId,
      artifactExtension: 'txt',
      metadata: buildLayout3PendingMetadata(version, config.indexGeneration),
      parseTimeoutMs: this.parseTimeoutMs,
      pollIntervalMs: this.parsePollIntervalMs,
      signal,
    });
    this.throwIfAborted(signal);
    const captured = capturedResults[0];
    if (
      !captured
      || capturedResults.length !== 1
      || captured.documentId !== result.documentId
      || captured.chunkCount !== result.chunkCount
      || captured.lastVerifiedAt !== result.lastVerifiedAt
    ) {
      throw new RegistryError('REMOTE_CONTRACT', '解析健康证据没有通过本地原子收口校验。');
    }
    this.store.completeParseWaitJob({
      jobId: job.jobId,
      workerId: this.workerId,
      ...captured,
      audit: {
        actorId: 'system:processing-runner',
        reason: 'pending 文档已健康，原子完成 parse_wait 并进入质量检查待办。',
      },
    });
  }

  private async loadAndVerifyArtifacts(
    job: ProcessingJobRecord,
    signal: AbortSignal,
  ): Promise<ProcessingArtifactSet> {
    const artifacts = await this.artifactService.processVersion({
      versionId: job.versionId,
      processingProfile: job.profileVersion,
      signal,
    });
    if (artifacts.body.sha256 !== job.inputHash) {
      throw new RegistryError('FILE_PROCESSING', '任务输入指纹与当前正文工件不一致，已停止远端入库。');
    }
    return artifacts;
  }

  private async resolveRemoteConfig(versionId: string): Promise<RagflowIngestionPrivateConfig> {
    const config = await this.configStore.getPrivateConfig();
    const binding = this.store.findUniquePendingBindingForVersion(versionId);
    if (
      binding
      && (
        binding.datasetId !== config.stagingDatasetId
        || binding.indexGeneration !== config.indexGeneration
      )
    ) {
      throw new RegistryError(
        'REMOTE_AUTH_CONFIG',
        '当前 RAGFlow 配置与该资料已经持久化的暂存绑定不一致，请恢复原配置后重试。',
      );
    }
    return config;
  }

  private createPendingIndexService(
    config: RagflowIngestionPrivateConfig,
    callbacks: {
      markHealthy(input: CapturedHealthyBinding): void;
    },
  ): PendingIndexService {
    return new PendingIndexService({
      remote: this.remoteFactory(config),
      datasetPolicy: this.configStore,
      now: this.now,
      repository: {
        findBinding: (input) => this.store.findPendingBinding(input),
        ensureUnhealthyPendingBinding: (input) => {
          this.store.ensureUnhealthyPendingBinding({
            ...input,
            audit: {
              actorId: 'system:processing-runner',
              reason: '远端文档已精确对账，先登记为不健康 pending 绑定。',
            },
          });
        },
        markPendingBindingHealthy: (input) => callbacks.markHealthy(input),
      },
    });
  }

  private async handleJobError(job: ProcessingJobRecord, error: unknown): Promise<void> {
    const current = this.store.getProcessingJob(job.jobId);
    const leaseExpired = current.leaseExpiresAt === null
      || current.leaseExpiresAt <= this.now().toISOString();
    if (
      current.leaseOwner === this.workerId
      && (current.status === 'running' || current.status === 'cancel_requested')
      && leaseExpired
    ) {
      // 休眠或事件循环停顿后，业务回调可能早于 heartbeat 恢复；旧租约不能再写失败结果。
      // 当前执行返回后，runLoop 下一轮会先 recoverExpiredJobs，再重新领取或终态收口。
      this.wake();
      return;
    }
    if (this.stopping && current.status === 'running' && current.leaseOwner === this.workerId) {
      this.store.releaseJobForShutdown({
        jobId: job.jobId,
        workerId: this.workerId,
        audit: {
          actorId: 'system:processing-runner',
          reason: '应用计划停机，当前 C2 任务释放租约并重新排队。',
        },
      });
      return;
    }
    if (current.status === 'cancel_requested' && current.leaseOwner === this.workerId) {
      if (job.stage === QUALITY_JOB_STAGE && this.qualityExecutor) {
        try {
          this.qualityExecutor.acknowledgeCancellation({
            job,
            workerId: this.workerId,
            message: '用户已取消本次质量检查，可重新填写问题后再次运行。',
          });
        } catch (cancellationError) {
          if (!isJobStateConflict(cancellationError)) throw cancellationError;
          this.wake();
        }
        return;
      }
      this.store.acknowledgeJobCancellationAndUpdateVersion({
        jobId: job.jobId,
        workerId: this.workerId,
        errorMessage: '用户已取消本次资料处理，可在资料入库中心人工重试。',
        audit: {
          actorId: 'system:processing-runner',
          reason: 'C2 runner 已停止当前工作并确认用户取消请求。',
        },
      });
      return;
    }
    if (isCancellationError(error)) {
      // 非用户取消只可能来自租约丢失或计划停机；前两项均已在上方处理。
      return;
    }
    if (current.status !== 'running' || current.leaseOwner !== this.workerId) return;

    const retryAt = isRetryableError(error) && current.attemptCount < current.maxAttempts
      ? new Date(this.now().getTime() + this.getRetryDelay(current.attemptCount)).toISOString()
      : null;
    if (job.stage === QUALITY_JOB_STAGE && this.qualityExecutor) {
      try {
        this.qualityExecutor.fail({
          job,
          workerId: this.workerId,
          errorCode: getStableErrorCode(error),
          errorMessage: getErrorMessage(error),
          retryAt,
        });
      } catch (failureError) {
        if (!isJobStateConflict(failureError)) throw failureError;
        this.wake();
      }
      return;
    }
    this.store.failJobAndUpdateVersion({
      jobId: job.jobId,
      workerId: this.workerId,
      errorCode: getStableErrorCode(error),
      errorMessage: getErrorMessage(error),
      retryAt,
      audit: {
        actorId: 'system:processing-runner',
        reason: retryAt
          ? 'C2 任务失败，已按稳定指数退避安排自动重试。'
          : 'C2 任务失败且不能自动重试，等待用户处理或人工重试。',
      },
    });
  }

  private getRetryDelay(attemptCount: number): number {
    const exponent = Math.max(0, attemptCount - 1);
    return Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * (2 ** exponent));
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new RegistryError('CANCELLED', '资料处理已停止。');
    }
  }
}
