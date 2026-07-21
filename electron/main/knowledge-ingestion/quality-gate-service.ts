import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { guardProtectedRagflowDatasetRequest } from '../protected-ragflow-dataset-guard';
import type {
  DocumentLocatorMap,
  ProcessingArtifactReference,
  ProcessingArtifactSet,
} from './processing';
import type { QualityJobExecutor } from './processing-runner';
import { prepareAutomaticQualityQuestions } from './quality-evidence';
import { QualityGateRepository, type CreateQualityRunResult } from './quality-gate-repository';
import {
  QualityRetrievalService,
  type QualityRetrievalRemote,
} from './quality-retrieval-service';
import type { RagflowIngestionPrivateConfig } from './ragflow-config-store';
import { RagflowClient } from './ragflow/client';
import type { RegistryStore } from './registry-store';
import { RegistryError, type ProcessingJobRecord, type QualityRunRecord } from './types';

const QUALITY_PROFILE_VERSION = 'quality-gate-v1';
const QUALITY_RUN_TTL_MS = 30 * 60 * 1_000;

const LOCAL_RESULT_KEYS = {
  metadata: 'metadata_complete',
  artifacts: 'artifacts_complete',
  pendingScope: 'pending_scope',
  formalZeroLeak: 'formal_zero_leak',
  locator: 'locator_available',
} as const;

type QualityRemoteFactory = (config: RagflowIngestionPrivateConfig) => QualityRetrievalRemote;

export interface QualityGateServiceOptions {
  now?: () => Date;
  remoteFactory?: QualityRemoteFactory;
  runTtlMs?: number;
}

interface QualityArtifactService {
  processVersion(input: {
    versionId: string;
    processingProfile?: string;
    signal?: AbortSignal;
  }): Promise<ProcessingArtifactSet>;
  listArtifacts(versionId: string): ProcessingArtifactReference[];
}

interface QualityConfigStore {
  getPrivateConfig(): Promise<RagflowIngestionPrivateConfig>;
  getProtectedDatasetIds(): Promise<string[]>;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function normalizeEvidenceText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function hasRequiredMetadata(metadata: Record<string, unknown>): boolean {
  return ['stableTitle', 'domain', 'subject', 'materialType', 'language', 'parserProfile']
    .every((field) => typeof metadata[field] === 'string' && metadata[field].trim().length > 0);
}

function buildRequiredResultKeys(questions: Array<{ questionKey: string }>): string[] {
  return [
    LOCAL_RESULT_KEYS.metadata,
    LOCAL_RESULT_KEYS.artifacts,
    LOCAL_RESULT_KEYS.pendingScope,
    LOCAL_RESULT_KEYS.formalZeroLeak,
    LOCAL_RESULT_KEYS.locator,
    ...questions.flatMap((question) => [
      `${question.questionKey}:candidate_top10`,
      `${question.questionKey}:expected_evidence_hit`,
    ]),
  ];
}

export class QualityGateService implements QualityJobExecutor {
  private readonly now: () => Date;
  private readonly remoteFactory: QualityRemoteFactory;
  private readonly runTtlMs: number;

  constructor(
    private readonly repository: QualityGateRepository,
    private readonly registryStore: RegistryStore,
    private readonly artifactService: QualityArtifactService,
    private readonly configStore: QualityConfigStore,
    options: QualityGateServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.remoteFactory = options.remoteFactory ?? ((config) => new RagflowClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    }));
    this.runTtlMs = options.runTtlMs ?? QUALITY_RUN_TTL_MS;
  }

  async createRun(input: {
    versionId: string;
  }): Promise<CreateQualityRunResult> {
    const version = this.registryStore.getMaterialVersion(input.versionId);
    if (!version.parserProfile) {
      throw new RegistryError('QUALITY_BLOCK', '资料缺少已冻结的解析 profile，不能开始质量检查。');
    }
    const artifacts = await this.artifactService.processVersion({
      versionId: version.versionId,
      processingProfile: version.parserProfile,
    });
    const [bodyText, locatorSource, config] = await Promise.all([
      readFile(artifacts.body.absolutePath, 'utf8'),
      readFile(artifacts.locatorMap.absolutePath, 'utf8'),
      this.configStore.getPrivateConfig(),
    ]);
    let locatorMap: DocumentLocatorMap;
    try {
      locatorMap = JSON.parse(locatorSource) as DocumentLocatorMap;
    } catch (error) {
      throw new RegistryError('QUALITY_BLOCK', '来源定位工件不是有效 JSON。', { cause: error });
    }
    const preparedQuestions = prepareAutomaticQualityQuestions({
      bodyText,
      locatorMap,
      expectedSourceHash: version.contentHash,
      title: typeof version.metadata.stableTitle === 'string'
        ? version.metadata.stableTitle
        : '本资料',
    });
    const binding = this.registryStore.findUniquePendingBindingForVersion(version.versionId);
    if (!binding || !binding.isHealthy || binding.chunkCount === null || binding.chunkCount <= 0) {
      throw new RegistryError('QUALITY_BLOCK', '资料没有唯一、健康且非零切片的 pending 绑定。');
    }
    if (
      binding.datasetId !== config.stagingDatasetId
      || binding.indexGeneration !== config.indexGeneration
    ) {
      throw new RegistryError('REMOTE_AUTH_CONFIG', '当前 RAGFlow 配置与资料的 pending 绑定身份不一致。');
    }

    const requiredBlockingResultKeys = buildRequiredResultKeys(preparedQuestions);
    const inputIdentity = {
      schemaVersion: 'layout3_quality_input_v1',
      versionId: version.versionId,
      bindingId: binding.bindingId,
      questions: preparedQuestions.map((question) => ({
        questionKey: question.questionKey,
        question: question.question,
        evidenceSha256: question.evidenceSha256,
        locatorLabel: question.locatorLabel,
      })),
      artifacts: [artifacts.body, artifacts.locatorMap, artifacts.manifest].map((artifact) => ({
        artifactType: artifact.artifactType,
        sha256: artifact.sha256,
      })),
      config: {
        baseUrl: config.baseUrl,
        stagingDatasetId: config.stagingDatasetId,
        indexGeneration: config.indexGeneration,
      },
    };
    const expiresAt = new Date(this.now().getTime() + this.runTtlMs).toISOString();
    return this.repository.createRun({
      versionId: version.versionId,
      questions: preparedQuestions,
      requiredBlockingResultKeys,
      inputHash: hashJson(inputIdentity),
      profileVersion: version.parserProfile,
      inputSnapshot: {
        schemaVersion: 'layout3_quality_request_v1',
        questionCount: preparedQuestions.length,
      },
      profileSnapshot: {
        qualityProfileVersion: QUALITY_PROFILE_VERSION,
        bodySha256: artifacts.body.sha256,
        locatorSha256: artifacts.locatorMap.sha256,
        manifestSha256: artifacts.manifest.sha256,
      },
      configSnapshot: {
        baseUrl: config.baseUrl,
        stagingDatasetId: config.stagingDatasetId,
        indexGeneration: config.indexGeneration,
        candidateLimit: 10,
      },
      expiresAt,
      audit: {
        actorId: 'user:local',
        reason: '用户在资料入库中心启动了自动索引健康检查。',
      },
    });
  }

  async execute(input: {
    job: ProcessingJobRecord;
    workerId: string;
    signal: AbortSignal;
  }): Promise<void> {
    const run = this.getRunForJob(input.job);
    const started = this.repository.startRun({
      qualityRunId: run.qualityRunId,
      workerId: input.workerId,
      audit: {
        actorId: 'system:processing-runner',
        reason: '质量 runner 已持有任务租约，开始或恢复短期质量运行。',
      },
    });
    this.throwIfAborted(input.signal);

    const config = await this.configStore.getPrivateConfig();
    this.assertConfigSnapshot(started, config);
    const record = (
      result: Omit<Parameters<QualityGateRepository['recordResult']>[0], 'workerId'>,
    ): void => {
      this.repository.recordResult({ ...result, workerId: input.workerId });
    };
    const audit = {
      actorId: 'system:quality-gate',
      reason: 'PH3-13C3 快速质量门禁记录当前 attempt 的检查证据。',
    };

    const version = this.registryStore.getMaterialVersion(started.versionId);
    const metadataPassed = hasRequiredMetadata(version.metadata);
    record({
      qualityRunId: started.qualityRunId,
      checkKey: 'metadata',
      resultKey: LOCAL_RESULT_KEYS.metadata,
      blockingLevel: 'blocking',
      passed: metadataPassed,
      threshold: { requiredFieldsComplete: true },
      actual: { requiredFieldsComplete: metadataPassed },
      evidence: {
        label: '必填元数据完整',
        message: metadataPassed ? '关键元数据已人工确认且完整。' : '关键元数据不完整，不能进入待发布。',
        locatorLabel: null,
      },
      audit,
    });

    const artifactVerification = await this.verifyArtifactSnapshot(started, input.signal);
    const artifactsPassed = artifactVerification.passed;
    record({
      qualityRunId: started.qualityRunId,
      checkKey: 'artifacts',
      resultKey: LOCAL_RESULT_KEYS.artifacts,
      blockingLevel: 'blocking',
      passed: artifactsPassed,
      threshold: { requiredArtifactCount: 3 },
      actual: artifactVerification.actual,
      evidence: {
        label: '处理工件完整',
        message: artifactsPassed
          ? '正文、来源定位和 manifest 已重新读取，身份与 SHA-256 均和运行快照一致。'
          : '处理工件缺失、被篡改，或类型、来源、profile、工具版本已发生漂移。',
        locatorLabel: null,
      },
      audit,
    });

    const scope = this.repository.resolveValidScope(started.qualityRunId, input.workerId);
    const pendingScopePassed = scope.documentIds.length > 0
      && started.bindingSnapshot.chunkCount > 0
      && started.bindingSnapshot.remoteRunStatus.toUpperCase() === 'DONE';
    record({
      qualityRunId: started.qualityRunId,
      checkKey: 'pending_scope',
      resultKey: LOCAL_RESULT_KEYS.pendingScope,
      blockingLevel: 'blocking',
      passed: pendingScopePassed,
      threshold: { documentCountAtLeast: 1, chunkCountAtLeast: 1, remoteRunStatus: 'DONE' },
      actual: {
        documentCount: scope.documentIds.length,
        chunkCount: started.bindingSnapshot.chunkCount,
        remoteRunStatus: started.bindingSnapshot.remoteRunStatus,
      },
      evidence: {
        label: '暂存索引健康',
        message: pendingScopePassed ? '唯一 pending 文档已完成解析且切片数大于 0。' : '暂存索引健康证据不完整。',
        locatorLabel: null,
      },
      audit,
    });

    const formalProof = await this.buildFormalZeroLeakProof(started, config);
    record({
      qualityRunId: started.qualityRunId,
      checkKey: 'formal_zero_leak',
      resultKey: LOCAL_RESULT_KEYS.formalZeroLeak,
      blockingLevel: 'blocking',
      passed: formalProof.passed,
      threshold: { pendingHitCount: 0, stagingRequestBlockedBeforeFetch: true },
      actual: formalProof.actual,
      evidence: {
        label: '正式通道 pending 零泄漏',
        message: formalProof.message,
        locatorLabel: null,
      },
      audit,
    });

    const locatorPassed = started.questionsSnapshot.every((question) => question.locatorLabel.trim());
    record({
      qualityRunId: started.qualityRunId,
      checkKey: 'locator',
      resultKey: LOCAL_RESULT_KEYS.locator,
      blockingLevel: 'blocking',
      passed: locatorPassed,
      threshold: { locatableQuestionCount: started.questionsSnapshot.length },
      actual: {
        locatableQuestionCount: started.questionsSnapshot.filter((question) => question.locatorLabel.trim()).length,
      },
      evidence: {
        label: '来源定位可追溯',
        message: locatorPassed ? '全部自动抽样证据均可回到资料来源定位。' : '存在无法追溯的自动抽样正文证据。',
        locatorLabel: started.questionsSnapshot[0]?.locatorLabel ?? null,
      },
      audit,
    });

    if ([metadataPassed, artifactsPassed, pendingScopePassed, formalProof.passed, locatorPassed].includes(false)) {
      this.repository.finalizeBlocked({
        qualityRunId: started.qualityRunId,
        workerId: input.workerId,
        reason: '资料未通过快速质量门禁的本地阻断检查。',
        audit,
      });
      return;
    }

    const retrieval = new QualityRetrievalService({
      // 检索前后解析与 scope 外异常登记都绑定当前 worker 的有效租约，旧 worker 不能迟到写回。
      scopeStore: {
        resolveValidScope: (qualityRunId) => (
          this.repository.resolveValidScope(qualityRunId, input.workerId)
        ),
        recordRemoteContractViolation: (violation) => (
          this.repository.recordRemoteContractViolation({
            ...violation,
            workerId: input.workerId,
          })
        ),
      },
      remote: this.remoteFactory(config),
    });
    for (const question of started.questionsSnapshot) {
      this.throwIfAborted(input.signal);
      let candidates;
      try {
        candidates = await retrieval.retrieve({
          qualityRunId: started.qualityRunId,
          question: question.question,
          signal: input.signal,
        });
      } catch (error) {
        // scope 外候选已经由检索服务先写入不可覆盖的失败阻断结果，此时应收口为质量阻断，
        // 而不是让 runner 把它误记成普通技术失败。
        const hasRecordedBlockingFailure = this.repository.listResults(started.qualityRunId)
          .some((result) => result.blockingLevel === 'blocking' && !result.passed);
        if (hasRecordedBlockingFailure) {
          this.repository.finalizeBlocked({
            qualityRunId: started.qualityRunId,
            workerId: input.workerId,
            reason: 'RAGFlow 返回了质量运行精确 pending scope 之外的候选。',
            audit,
          });
          return;
        }
        throw error;
      }
      const targetRank = candidates.length > 0 ? 1 : null;
      const candidatePassed = targetRank !== null && targetRank <= 10;
      record({
        qualityRunId: started.qualityRunId,
        checkKey: 'candidate_top10',
        resultKey: `${question.questionKey}:candidate_top10`,
        blockingLevel: 'blocking',
        passed: candidatePassed,
        threshold: { targetRankAtMost: 10 },
        actual: { targetRank, candidateCount: candidates.length },
        evidence: {
          label: `${question.questionKey}：目标资料进入 Top 10`,
          message: candidatePassed ? `目标资料首次命中排名为 ${targetRank}。` : '目标资料没有进入候选 Top 10。',
          locatorLabel: question.locatorLabel,
        },
        audit,
      });

      const normalizedEvidence = normalizeEvidenceText(question.evidenceExcerpt);
      const evidenceRank = candidates.findIndex((candidate) => (
        normalizeEvidenceText(candidate.content).includes(normalizedEvidence)
      ));
      const evidencePassed = evidenceRank >= 0 && evidenceRank < 10;
      record({
        qualityRunId: started.qualityRunId,
        checkKey: 'expected_evidence_hit',
        resultKey: `${question.questionKey}:expected_evidence_hit`,
        blockingLevel: 'blocking',
        passed: evidencePassed,
        threshold: { expectedEvidenceRankAtMost: 10 },
        actual: { expectedEvidenceRank: evidencePassed ? evidenceRank + 1 : null },
        evidence: {
          label: `${question.questionKey}：预期证据命中`,
          message: evidencePassed
            ? `预期正文证据在候选第 ${evidenceRank + 1} 位命中。`
            : '候选 Top 10 中未找到自动抽取的预期正文证据。',
          locatorLabel: question.locatorLabel,
        },
        audit,
      });
    }

    const failedBlocking = this.repository.listResults(started.qualityRunId)
      .filter((result) => result.blockingLevel === 'blocking' && !result.passed);
    if (failedBlocking.length > 0) {
      this.repository.finalizeBlocked({
        qualityRunId: started.qualityRunId,
        workerId: input.workerId,
        reason: `资料存在 ${failedBlocking.length} 项快速质量阻断结果。`,
        audit,
      });
      return;
    }
    this.repository.finalizePassed({
      qualityRunId: started.qualityRunId,
      workerId: input.workerId,
      audit,
    });
  }

  acknowledgeCancellation(input: {
    job: ProcessingJobRecord;
    workerId: string;
    message: string;
  }): void {
    const run = this.getRunForJob(input.job);
    this.repository.cancelRun({
      qualityRunId: run.qualityRunId,
      workerId: input.workerId,
      audit: {
        actorId: 'system:processing-runner',
        reason: input.message,
      },
    });
  }

  fail(input: {
    job: ProcessingJobRecord;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryAt: string | null;
  }): void {
    const run = this.getRunForJob(input.job);
    this.repository.failRun({
      qualityRunId: run.qualityRunId,
      workerId: input.workerId,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      retryAt: input.retryAt,
      audit: {
        actorId: 'system:processing-runner',
        reason: input.retryAt
          ? '质量任务发生可重试运行错误，已安排短期退避。'
          : '质量任务发生不可自动重试的运行错误，未进入待发布。',
      },
    });
  }

  private getRunForJob(job: ProcessingJobRecord): QualityRunRecord {
    const run = this.repository.getRunForJob(job.jobId);
    if (!run || run.versionId !== job.versionId) {
      throw new RegistryError('JOB_STATE_CONFLICT', '质量任务没有匹配的持久质量运行。');
    }
    return run;
  }

  private assertConfigSnapshot(run: QualityRunRecord, config: RagflowIngestionPrivateConfig): void {
    if (
      run.configSnapshot.baseUrl !== config.baseUrl
      || run.configSnapshot.stagingDatasetId !== config.stagingDatasetId
      || run.configSnapshot.indexGeneration !== config.indexGeneration
      || run.bindingSnapshot.datasetId !== config.stagingDatasetId
      || run.bindingSnapshot.indexGeneration !== config.indexGeneration
    ) {
      throw new RegistryError('REMOTE_AUTH_CONFIG', '质量运行期间 RAGFlow 地址、数据集或索引代次发生漂移。');
    }
  }

  private async verifyArtifactSnapshot(
    run: QualityRunRecord,
    signal: AbortSignal,
  ): Promise<{
    passed: boolean;
    actual: Record<string, unknown>;
  }> {
    this.throwIfAborted(signal);
    const expectedArtifacts = run.inputSnapshot.artifacts;
    const currentArtifacts = this.artifactService.listArtifacts(run.versionId);
    const requiredTypes = new Set(['extracted_text', 'locator_map', 'manifest']);
    const snapshotTypes = new Set(expectedArtifacts.map((artifact) => artifact.artifactType));
    const snapshotTypesMatch = expectedArtifacts.length === 3
      && snapshotTypes.size === 3
      && [...snapshotTypes].every((artifactType) => requiredTypes.has(artifactType));
    const byArtifactId = new Map(currentArtifacts.map((artifact) => [artifact.artifactId, artifact]));
    const matched = expectedArtifacts.map((expected) => ({
      expected,
      current: byArtifactId.get(expected.artifactId),
    }));
    const metadataMatches = snapshotTypesMatch && matched.every(({ expected, current }) => (
      current !== undefined
      && current.artifactType === expected.artifactType
      && current.sha256 === expected.sha256
      && current.sourceHash === expected.sourceHash
      && current.processingProfile === expected.processingProfile
      && current.toolName === expected.toolName
      && current.toolVersion === expected.toolVersion
    ));
    if (!metadataMatches) {
      return {
        passed: false,
        actual: {
          expectedArtifactCount: 3,
          matchedArtifactCount: matched.filter((item) => item.current !== undefined).length,
          verifiedFileCount: 0,
          snapshotTypesMatch,
          metadataMatches: false,
          diskSha256Matches: false,
        },
      };
    }

    let verifiedFileCount = 0;
    try {
      for (const { expected, current } of matched) {
        this.throwIfAborted(signal);
        const bytes = await readFile(current!.absolutePath, { signal });
        const actualSha256 = createHash('sha256').update(bytes).digest('hex');
        if (actualSha256 !== expected.sha256) {
          return {
            passed: false,
            actual: {
              expectedArtifactCount: 3,
              matchedArtifactCount: matched.length,
              verifiedFileCount,
              snapshotTypesMatch: true,
              metadataMatches: true,
              diskSha256Matches: false,
            },
          };
        }
        verifiedFileCount += 1;
      }
    } catch (error) {
      if (signal.aborted) this.throwIfAborted(signal);
      return {
        passed: false,
        actual: {
          expectedArtifactCount: 3,
          matchedArtifactCount: matched.length,
          verifiedFileCount,
          snapshotTypesMatch: true,
          metadataMatches: true,
          diskSha256Matches: false,
          unreadableArtifact: true,
        },
      };
    }
    return {
      passed: verifiedFileCount === 3,
      actual: {
        expectedArtifactCount: 3,
        matchedArtifactCount: matched.length,
        verifiedFileCount,
        snapshotTypesMatch: true,
        metadataMatches: true,
        diskSha256Matches: verifiedFileCount === 3,
      },
    };
  }

  private async buildFormalZeroLeakProof(
    run: QualityRunRecord,
    config: RagflowIngestionPrivateConfig,
  ): Promise<{
    passed: boolean;
    actual: Record<string, unknown>;
    message: string;
  }> {
    let activeDocumentIds: string[] = [];
    try {
      activeDocumentIds = this.registryStore.resolveActiveRetrievalScope().documentIds;
    } catch (error) {
      if (!(error instanceof RegistryError) || error.code !== 'EMPTY_ACTIVE_DOCUMENT_SET') {
        throw error;
      }
    }
    const pendingInActiveScope = activeDocumentIds.includes(run.bindingSnapshot.documentId);
    const protectedDatasetIds = await this.configStore.getProtectedDatasetIds();
    const guardDecision = guardProtectedRagflowDatasetRequest(
      {
        url: `${config.baseUrl}/api/v1/retrieval`,
        body: {
          dataset_ids: [config.stagingDatasetId],
          question: run.questionsSnapshot[0]?.question ?? '质量门禁正式通道证明',
        },
      },
      protectedDatasetIds,
    );
    const stagingBlocked = !guardDecision.allow;
    const passed = !pendingInActiveScope && stagingBlocked;
    return {
      passed,
      actual: {
        pendingHitCount: pendingInActiveScope ? 1 : 0,
        activeDocumentCount: activeDocumentIds.length,
        stagingRequestBlockedBeforeFetch: stagingBlocked,
        networkIssued: false,
        proofKind: 'local_formal_gate_v1',
      },
      message: passed
        ? 'SQLite active scope 不包含目标 pending 文档，且正式请求访问暂存数据集会在 fetch 前被阻断；本项是本地正式门禁证明，不代表生产 active 网关已完成。'
        : '目标 pending 文档进入了 active scope，或暂存数据集正式请求保护失效。',
    };
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new RegistryError('CANCELLED', '质量检查已停止。');
    }
  }
}
