import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { RegistryDatabase } from './registry-database';
import { assertVersionStatePatch } from './state-machine';
import type {
  JobStage,
  MaterialVersionRecord,
  ProcessingArtifactType,
  ProcessingJobRecord,
  QualityArtifactSnapshot,
  QualityBindingSnapshot,
  QualityBlockingLevel,
  QualityInputSnapshot,
  QualityProfileSnapshot,
  QualityQuestionSnapshot,
  QualityResultRecord,
  QualityRetrievalScope,
  QualityRunRecord,
  QualityRunStatus,
} from './types';
import { RegistryError } from './types';

export interface QualityGateAuditContext {
  actorId: string;
  reason: string;
}

export interface CreateQualityRunResult {
  run: QualityRunRecord;
  job: ProcessingJobRecord;
}

export interface FinalizeQualityRunResult extends CreateQualityRunResult {
  version: MaterialVersionRecord;
  results: QualityResultRecord[];
}

export interface QualityGateRepositoryOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
}

function buildQualityJobInputHash(inputHash: string, qualityRunId: string): string {
  // processing_jobs 的唯一键需要区分用户再次提交的全新运行；语义输入身份仍保留在 run 快照中。
  return createHash('sha256')
    .update(`${inputHash}\u0000${qualityRunId}`, 'utf8')
    .digest('hex');
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

interface BindingRow {
  binding_id: string;
  version_id: string;
  index_generation: string;
  dataset_id: string;
  document_id: string;
  remote_status: MaterialVersionRecord['indexPublicationStatus'];
  is_healthy: number;
  remote_run_status: string | null;
  chunk_count: number | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ArtifactRow {
  artifact_id: string;
  version_id: string;
  artifact_type: ProcessingArtifactType;
  sha256: string;
  source_hash: string;
  processing_profile: string;
  tool_name: string;
  tool_version: string;
  updated_at: string;
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

interface QualityRunRow {
  quality_run_id: string;
  version_id: string;
  job_id: string;
  binding_id: string;
  status: QualityRunStatus;
  conclusion: QualityRunRecord['conclusion'];
  binding_snapshot_json: string;
  questions_snapshot_json: string;
  input_snapshot_json: string;
  profile_snapshot_json: string;
  config_snapshot_json: string;
  expires_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface QualityResultRow {
  quality_result_id: string;
  quality_run_id: string;
  check_key: string;
  result_key: string;
  blocking_level: QualityBlockingLevel;
  passed: number;
  threshold_json: string;
  actual_json: string;
  evidence_json: string;
  created_at: string;
  updated_at: string;
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

function mapQualityRun(row: QualityRunRow): QualityRunRecord {
  return {
    qualityRunId: row.quality_run_id,
    versionId: row.version_id,
    jobId: row.job_id,
    bindingId: row.binding_id,
    status: row.status,
    conclusion: row.conclusion,
    bindingSnapshot: JSON.parse(row.binding_snapshot_json) as QualityBindingSnapshot,
    questionsSnapshot: JSON.parse(row.questions_snapshot_json) as QualityQuestionSnapshot[],
    inputSnapshot: JSON.parse(row.input_snapshot_json) as QualityInputSnapshot,
    profileSnapshot: JSON.parse(row.profile_snapshot_json) as QualityProfileSnapshot,
    configSnapshot: JSON.parse(row.config_snapshot_json) as Record<string, unknown>,
    expiresAt: row.expires_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapQualityResult(row: QualityResultRow): QualityResultRecord {
  return {
    qualityResultId: row.quality_result_id,
    qualityRunId: row.quality_run_id,
    checkKey: row.check_key,
    resultKey: row.result_key,
    blockingLevel: row.blocking_level,
    passed: row.passed === 1,
    threshold: JSON.parse(row.threshold_json) as unknown,
    actual: JSON.parse(row.actual_json) as unknown,
    evidence: JSON.parse(row.evidence_json) as unknown,
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

function normalizeIsoDate(value: string, fieldName: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new RegistryError('INPUT_VALIDATION', `${fieldName} 必须是有效时间。`);
  }
  return new Date(timestamp).toISOString();
}

function serializeJson(value: unknown, fieldName: string): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error('JSON_UNDEFINED');
    }
    return serialized;
  } catch (error) {
    throw new RegistryError('INPUT_VALIDATION', `${fieldName} 必须是可持久化的 JSON。`, { cause: error });
  }
}

function normalizeHash(value: string): string {
  return value.trim().toLowerCase().replace(/^sha256:/, '');
}

function isSqliteMessage(error: unknown, marker: string): boolean {
  return error instanceof Error && error.message.includes(marker);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeUniqueKeys(values: string[], fieldName: string): string[] {
  const normalized = values.map((value, index) => assertNonEmpty(value, `${fieldName}[${index}]`));
  if (normalized.length === 0 || new Set(normalized).size !== normalized.length) {
    throw new RegistryError('INPUT_VALIDATION', `${fieldName} 必须非空且不能重复。`);
  }
  return normalized;
}

function normalizeQuestions(questions: QualityQuestionSnapshot[]): QualityQuestionSnapshot[] {
  if (questions.length < 3 || questions.length > 5) {
    throw new RegistryError('INPUT_VALIDATION', '质量运行必须固定保存 3～5 条冒烟问题。');
  }

  const keys = new Set<string>();
  return questions.map((question, index) => {
    const questionKey = assertNonEmpty(question.questionKey, `questions[${index}].questionKey`);
    const normalizedQuestion = assertNonEmpty(question.question, `questions[${index}].question`);
    const evidenceExcerpt = assertNonEmpty(
      question.evidenceExcerpt,
      `questions[${index}].evidenceExcerpt`,
    );
    const evidenceSha256 = normalizeHash(question.evidenceSha256);
    const locatorLabel = assertNonEmpty(question.locatorLabel, `questions[${index}].locatorLabel`);
    if (keys.has(questionKey)) {
      throw new RegistryError('INPUT_VALIDATION', `冒烟问题键 ${questionKey} 重复。`);
    }
    keys.add(questionKey);
    if (!/^[a-f0-9]{64}$/.test(evidenceSha256)) {
      throw new RegistryError('INPUT_VALIDATION', `第 ${index + 1} 条正文证据哈希无效。`);
    }
    if (
      !Number.isInteger(question.startOffset)
      || !Number.isInteger(question.endOffset)
      || question.startOffset < 0
      || question.endOffset <= question.startOffset
      || question.endOffset - question.startOffset !== evidenceExcerpt.length
    ) {
      throw new RegistryError('INPUT_VALIDATION', `第 ${index + 1} 条正文证据偏移无效。`);
    }
    return {
      questionKey,
      question: normalizedQuestion,
      evidenceExcerpt,
      evidenceSha256,
      startOffset: question.startOffset,
      endOffset: question.endOffset,
      locatorLabel,
    };
  });
}

export class QualityGateRepository {
  private readonly database: Database.Database;
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;

  constructor(registryDatabase: RegistryDatabase, options: QualityGateRepositoryOptions = {}) {
    this.database = registryDatabase.connection;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  createRun(input: {
    qualityRunId?: string;
    jobId?: string;
    versionId: string;
    questions: QualityQuestionSnapshot[];
    requiredBlockingResultKeys: string[];
    inputHash: string;
    profileVersion: string;
    inputSnapshot: Record<string, unknown>;
    profileSnapshot: Record<string, unknown>;
    configSnapshot: Record<string, unknown>;
    expiresAt: string;
    maxAttempts?: number;
    audit: QualityGateAuditContext;
  }): CreateQualityRunResult {
    const timestamp = this.now().toISOString();
    const versionId = assertNonEmpty(input.versionId, 'versionId');
    const inputHash = assertNonEmpty(input.inputHash, 'inputHash');
    const profileVersion = assertNonEmpty(input.profileVersion, 'profileVersion');
    const expiresAt = normalizeIsoDate(input.expiresAt, 'expiresAt');
    const questions = normalizeQuestions(input.questions);
    const requiredBlockingResultKeys = normalizeUniqueKeys(
      input.requiredBlockingResultKeys,
      'requiredBlockingResultKeys',
    );
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new RegistryError('INPUT_VALIDATION', 'maxAttempts 必须是正整数。');
    }
    if (expiresAt <= timestamp) {
      throw new RegistryError('INPUT_VALIDATION', '质量运行过期时间必须晚于创建时间。');
    }

    const qualityRunId = input.qualityRunId ?? this.createId('quality_run');
    const jobId = input.jobId ?? this.createId('job');
    const jobInputHash = buildQualityJobInputHash(inputHash, qualityRunId);

    try {
      return this.database.transaction(() => {
        const version = this.getVersionOrThrow(versionId);
        this.assertVersionEligible(version);
        if (version.parserProfile !== profileVersion) {
          throw new RegistryError('QUALITY_BLOCK', '质量任务 profile 与当前资料处理 profile 不一致。');
        }
        const openRun = this.database
          .prepare(`
            SELECT quality_run_id FROM quality_runs
            WHERE version_id = ? AND status IN ('queued', 'running')
            LIMIT 1
          `)
          .pluck()
          .get(versionId);
        if (openRun) {
          throw new RegistryError('QUALITY_BLOCK', `资料版本 ${versionId} 已存在未结束的质量运行。`);
        }

        const binding = this.getUniqueHealthyPendingBinding(versionId);
        const artifacts = this.resolveCurrentArtifactSnapshot(version);
        const bindingSnapshot = this.toBindingSnapshot(binding);
        const requestSnapshot = JSON.parse(
          serializeJson(input.inputSnapshot, 'inputSnapshot'),
        ) as Record<string, unknown>;
        const inputSnapshot: QualityInputSnapshot = {
          // processing_jobs 使用 run 身份盐保证可重跑；原始确定性输入哈希仍固定留在 run 快照中，便于审计和对账。
          request: { ...requestSnapshot, semanticInputHash: inputHash },
          requiredBlockingResultKeys,
          artifacts,
        };
        const profileSnapshot: QualityProfileSnapshot = {
          parserProfile: version.parserProfile,
          embeddingProfile: version.embeddingProfile,
          profileBundleHash: version.profileBundleHash,
          request: JSON.parse(serializeJson(input.profileSnapshot, 'profileSnapshot')) as Record<string, unknown>,
        };
        const configSnapshot = JSON.parse(
          serializeJson(input.configSnapshot, 'configSnapshot'),
        ) as Record<string, unknown>;

        this.database
          .prepare(`
            INSERT INTO processing_jobs (
              job_id, version_id, stage, status, input_hash, profile_version,
              attempt_count, max_attempts, created_at, updated_at
            ) VALUES (?, ?, 'quality', 'queued', ?, ?, 0, ?, ?, ?)
          `)
          .run(jobId, versionId, jobInputHash, profileVersion, maxAttempts, timestamp, timestamp);
        this.database
          .prepare(`
            INSERT INTO quality_runs (
              quality_run_id, version_id, job_id, binding_id, status, conclusion,
              binding_snapshot_json, questions_snapshot_json, input_snapshot_json,
              profile_snapshot_json, config_snapshot_json, expires_at,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'queued', NULL, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            qualityRunId,
            versionId,
            jobId,
            binding.binding_id,
            serializeJson(bindingSnapshot, 'bindingSnapshot'),
            serializeJson(questions, 'questionsSnapshot'),
            serializeJson(inputSnapshot, 'inputSnapshot'),
            serializeJson(profileSnapshot, 'profileSnapshot'),
            serializeJson(configSnapshot, 'configSnapshot'),
            expiresAt,
            timestamp,
            timestamp,
          );

        const job = this.getJobOrThrow(jobId);
        const run = this.getRunOrThrow(qualityRunId);
        this.appendAudit(
          'processing_job',
          jobId,
          'processing_job.quality_enqueued',
          null,
          job,
          input.audit,
          timestamp,
        );
        this.appendAudit(
          'quality_run',
          qualityRunId,
          'quality_run.created',
          null,
          run,
          input.audit,
          timestamp,
        );
        return { run, job };
      })();
    } catch (error) {
      if (
        isSqliteMessage(error, 'quality_runs_one_open_per_version')
        || isSqliteMessage(error, 'processing_jobs.version_id, processing_jobs.stage')
      ) {
        throw new RegistryError('QUALITY_BLOCK', '当前输入已经存在质量任务或未结束运行。', { cause: error });
      }
      throw error;
    }
  }

  startRun(input: {
    qualityRunId: string;
    workerId: string;
    audit: QualityGateAuditContext;
  }): QualityRunRecord {
    const timestamp = this.now().toISOString();
    return this.database.transaction(() => {
      const current = this.getRunOrThrow(input.qualityRunId);
      const job = this.getJobOrThrow(current.jobId);
      this.assertQualityJob(job, current);
      this.assertWorkerOwnsActiveLease(job, input.workerId, ['running'], timestamp);
      this.assertRunNotExpired(current, timestamp);
      this.assertRunCurrent(current);
      if (current.status === 'running') {
        return current;
      }
      if (current.status !== 'queued') {
        throw new RegistryError('QUALITY_BLOCK', '只有已排队的质量运行可以开始。');
      }

      this.database
        .prepare(`
          UPDATE quality_runs
          SET status = 'running', started_at = COALESCE(started_at, ?),
              error_code = NULL, error_message = NULL, updated_at = ?
          WHERE quality_run_id = ?
        `)
        .run(timestamp, timestamp, current.qualityRunId);
      const started = this.getRunOrThrow(current.qualityRunId);
      this.appendAudit(
        'quality_run',
        current.qualityRunId,
        current.startedAt ? 'quality_run.resumed' : 'quality_run.started',
        current,
        started,
        input.audit,
        timestamp,
      );
      return started;
    })();
  }

  resolveValidScope(qualityRunId: string, workerId: string): QualityRetrievalScope {
    const run = this.getRunOrThrow(assertNonEmpty(qualityRunId, 'qualityRunId'));
    const timestamp = this.now().toISOString();
    this.assertRunNotExpired(run, timestamp);
    if (run.status !== 'running' || run.conclusion !== null) {
      throw new RegistryError('QUALITY_BLOCK', '质量运行未处于可检索的运行中状态。');
    }
    this.assertRunCurrent(run);
    const job = this.getJobOrThrow(run.jobId);
    this.assertQualityJob(job, run);
    this.assertWorkerOwnsActiveLease(job, workerId, ['running'], timestamp);
    return {
      qualityRunId: run.qualityRunId,
      versionId: run.versionId,
      bindingId: run.bindingId,
      datasetIds: [run.bindingSnapshot.datasetId],
      documentIds: [run.bindingSnapshot.documentId],
      expiresAt: run.expiresAt,
    };
  }

  recordResult(input: {
    qualityRunId: string;
    workerId: string;
    checkKey: string;
    resultKey: string;
    blockingLevel: QualityBlockingLevel;
    passed: boolean;
    threshold: unknown;
    actual: unknown;
    evidence: unknown;
    audit: QualityGateAuditContext;
  }): QualityResultRecord {
    const timestamp = this.now().toISOString();
    const checkKey = assertNonEmpty(input.checkKey, 'checkKey');
    const resultKey = assertNonEmpty(input.resultKey, 'resultKey');
    const thresholdJson = serializeJson(input.threshold, 'threshold');
    const actualJson = serializeJson(input.actual, 'actual');
    const evidenceJson = serializeJson(input.evidence, 'evidence');

    return this.database.transaction(() => {
      const run = this.getRunningCurrentRun(input.qualityRunId, timestamp);
      const job = this.getJobOrThrow(run.jobId);
      this.assertQualityJob(job, run);
      this.assertWorkerOwnsActiveLease(job, input.workerId, ['running'], timestamp);
      if (
        run.inputSnapshot.requiredBlockingResultKeys.includes(resultKey)
        && input.blockingLevel !== 'blocking'
      ) {
        throw new RegistryError('QUALITY_BLOCK', `必需结果 ${resultKey} 必须是阻断级别。`);
      }
      const existing = this.database
        .prepare('SELECT * FROM quality_results WHERE quality_run_id = ? AND result_key = ?')
        .get(run.qualityRunId, resultKey) as QualityResultRow | undefined;
      if (existing) {
        const before = mapQualityResult(existing);
        // 同一 run 的技术重试必须以当前 attempt 结果为准；旧证据通过不可变审计保留。
        this.database
          .prepare(`
            UPDATE quality_results
            SET check_key = ?, blocking_level = ?, passed = ?, threshold_json = ?,
                actual_json = ?, evidence_json = ?, updated_at = ?
            WHERE quality_result_id = ?
          `)
          .run(
            checkKey,
            input.blockingLevel,
            input.passed ? 1 : 0,
            thresholdJson,
            actualJson,
            evidenceJson,
            timestamp,
            existing.quality_result_id,
          );
        const updated = this.getResultOrThrow(existing.quality_result_id);
        this.appendAudit(
          'quality_result',
          existing.quality_result_id,
          'quality_result.rechecked',
          before,
          updated,
          input.audit,
          timestamp,
        );
        return updated;
      }

      const qualityResultId = this.createId('quality_result');
      this.database
        .prepare(`
          INSERT INTO quality_results (
            quality_result_id, quality_run_id, check_key, result_key, blocking_level,
            passed, threshold_json, actual_json, evidence_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          qualityResultId,
          run.qualityRunId,
          checkKey,
          resultKey,
          input.blockingLevel,
          input.passed ? 1 : 0,
          thresholdJson,
          actualJson,
          evidenceJson,
          timestamp,
          timestamp,
        );
      const result = this.getResultOrThrow(qualityResultId);
      this.appendAudit(
        'quality_result',
        qualityResultId,
        'quality_result.recorded',
        null,
        result,
        input.audit,
        timestamp,
      );
      return result;
    })();
  }

  recordRemoteContractViolation(input: {
    qualityRunId: string;
    workerId: string;
    returnedDocumentIds: string[];
    allowedDocumentIds: string[];
    audit?: {
      actorId?: string;
      reason?: string;
      returnedDatasetIds?: string[];
      allowedDatasetIds?: string[];
      outOfScopeDocumentIds?: string[];
      outOfScopeDatasetIds?: string[];
    };
  }): void {
    const returnedDocumentIds = [...new Set(input.returnedDocumentIds.map((id) => assertNonEmpty(id, 'returnedDocumentId')))];
    const allowedDocumentIds = [...new Set(input.allowedDocumentIds.map((id) => assertNonEmpty(id, 'allowedDocumentId')))];
    const allowed = new Set(allowedDocumentIds);
    const outOfScopeDocumentIds = returnedDocumentIds.filter((id) => !allowed.has(id));
    const outOfScopeDatasetIds = input.audit?.outOfScopeDatasetIds ?? [];
    if (outOfScopeDocumentIds.length === 0 && outOfScopeDatasetIds.length === 0) {
      throw new RegistryError('INPUT_VALIDATION', '未发现 scope 外返回，不能登记远端合同异常。');
    }
    const audit: QualityGateAuditContext = {
      actorId: input.audit?.actorId ?? 'system:quality-retrieval',
      reason: input.audit?.reason ?? 'RAGFlow 返回了质量运行精确 pending scope 之外的候选',
    };

    this.database.transaction(() => {
      const result = this.recordResult({
        qualityRunId: input.qualityRunId,
        workerId: input.workerId,
        checkKey: 'candidate_scope_contract',
        resultKey: `remote_contract_violation:${this.createId('violation')}`,
        blockingLevel: 'blocking',
        passed: false,
        threshold: { outOfScopeDocumentCount: 0, outOfScopeDatasetCount: 0 },
        actual: {
          outOfScopeDocumentCount: outOfScopeDocumentIds.length,
          outOfScopeDatasetCount: outOfScopeDatasetIds.length,
        },
        evidence: {
          returnedDocumentIds,
          allowedDocumentIds,
          outOfScopeDocumentIds,
          returnedDatasetIds: input.audit?.returnedDatasetIds ?? [],
          allowedDatasetIds: input.audit?.allowedDatasetIds ?? [],
          outOfScopeDatasetIds,
        },
        audit,
      });
      const run = this.getRunOrThrow(input.qualityRunId);
      this.appendAudit(
        'quality_run',
        run.qualityRunId,
        'quality_run.remote_contract_violation',
        run,
        { qualityResultId: result.qualityResultId, outOfScopeDocumentIds, outOfScopeDatasetIds },
        audit,
        this.now().toISOString(),
      );
    })();
  }

  finalizePassed(input: {
    qualityRunId: string;
    workerId: string;
    audit: QualityGateAuditContext;
  }): FinalizeQualityRunResult {
    const timestamp = this.now().toISOString();
    return this.database.transaction(() => {
      const currentRun = this.getRunningCurrentRun(input.qualityRunId, timestamp);
      const currentJob = this.getJobOrThrow(currentRun.jobId);
      this.assertQualityJob(currentJob, currentRun);
      this.assertWorkerOwnsActiveLease(currentJob, input.workerId, ['running'], timestamp);
      const results = this.listResults(currentRun.qualityRunId);
      const byResultKey = new Map(results.map((result) => [result.resultKey, result]));
      const missing = currentRun.inputSnapshot.requiredBlockingResultKeys.filter((key) => {
        const result = byResultKey.get(key);
        return !result || result.blockingLevel !== 'blocking' || !result.passed;
      });
      const failedBlocking = results.filter((result) => result.blockingLevel === 'blocking' && !result.passed);
      if (missing.length > 0 || failedBlocking.length > 0) {
        throw new RegistryError(
          'QUALITY_BLOCK',
          `质量运行尚未满足全部阻断项：${[...new Set([...missing, ...failedBlocking.map((item) => item.resultKey)])].join('、')}。`,
        );
      }

      this.database
        .prepare(`
          UPDATE quality_runs
          SET status = 'passed', conclusion = 'passed', completed_at = ?,
              error_code = NULL, error_message = NULL, updated_at = ?
          WHERE quality_run_id = ?
        `)
        .run(timestamp, timestamp, currentRun.qualityRunId);
      const completedJob = this.finishQualityJob(currentJob, 'succeeded', timestamp);
      const version = this.getVersionOrThrow(currentRun.versionId);
      const nextVersion = this.updateVersionForQualityConclusion(
        version,
        { workflowStatus: 'pending_publication', errorMessage: null },
        'material_version.quality_passed_pending_publication',
        input.audit,
        timestamp,
      );
      const completedRun = this.getRunOrThrow(currentRun.qualityRunId);
      this.appendAudit(
        'quality_run',
        currentRun.qualityRunId,
        'quality_run.passed',
        currentRun,
        completedRun,
        input.audit,
        timestamp,
      );
      this.appendAudit(
        'processing_job',
        currentJob.jobId,
        'processing_job.succeeded',
        currentJob,
        completedJob,
        input.audit,
        timestamp,
      );
      return { run: completedRun, job: completedJob, version: nextVersion, results };
    })();
  }

  finalizeBlocked(input: {
    qualityRunId: string;
    workerId: string;
    reason: string;
    audit: QualityGateAuditContext;
  }): FinalizeQualityRunResult {
    const timestamp = this.now().toISOString();
    const reason = assertNonEmpty(input.reason, 'reason');
    return this.database.transaction(() => {
      const currentRun = this.getRunningCurrentRun(input.qualityRunId, timestamp);
      const currentJob = this.getJobOrThrow(currentRun.jobId);
      this.assertQualityJob(currentJob, currentRun);
      this.assertWorkerOwnsActiveLease(currentJob, input.workerId, ['running'], timestamp);
      const results = this.listResults(currentRun.qualityRunId);
      if (!results.some((result) => result.blockingLevel === 'blocking' && !result.passed)) {
        throw new RegistryError('QUALITY_BLOCK', '没有失败的阻断结果，不能把质量运行收口为已阻断。');
      }

      this.database
        .prepare(`
          UPDATE quality_runs
          SET status = 'blocked', conclusion = 'blocked', completed_at = ?,
              error_code = 'QUALITY_BLOCK', error_message = ?, updated_at = ?
          WHERE quality_run_id = ?
        `)
        .run(timestamp, reason, timestamp, currentRun.qualityRunId);
      const completedJob = this.finishQualityJob(currentJob, 'succeeded', timestamp);
      const version = this.getVersionOrThrow(currentRun.versionId);
      const nextVersion = this.updateVersionForQualityConclusion(
        version,
        { workflowStatus: 'quarantined', errorMessage: reason },
        'material_version.quality_blocked_quarantined',
        input.audit,
        timestamp,
      );
      const completedRun = this.getRunOrThrow(currentRun.qualityRunId);
      this.appendAudit(
        'quality_run',
        currentRun.qualityRunId,
        'quality_run.blocked',
        currentRun,
        completedRun,
        input.audit,
        timestamp,
      );
      this.appendAudit(
        'processing_job',
        currentJob.jobId,
        'processing_job.succeeded_with_quality_block',
        currentJob,
        completedJob,
        input.audit,
        timestamp,
      );
      return { run: completedRun, job: completedJob, version: nextVersion, results };
    })();
  }

  failRun(input: {
    qualityRunId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryAt?: string | null;
    /** 仅供启动恢复已确认过期的旧租约；普通 runner 不得绕过有效租约检查。 */
    recoverExpiredLease?: boolean;
    audit: QualityGateAuditContext;
  }): CreateQualityRunResult {
    const timestamp = this.now().toISOString();
    const errorCode = assertNonEmpty(input.errorCode, 'errorCode');
    const errorMessage = assertNonEmpty(input.errorMessage, 'errorMessage');
    const requestedRetryAt = input.retryAt ? normalizeIsoDate(input.retryAt, 'retryAt') : null;

    return this.database.transaction(() => {
      const currentRun = this.getRunOrThrow(input.qualityRunId);
      if (currentRun.status !== 'queued' && currentRun.status !== 'running') {
        throw new RegistryError('QUALITY_BLOCK', '已结束的质量运行不能登记技术失败。');
      }
      const currentJob = this.getJobOrThrow(currentRun.jobId);
      this.assertQualityJob(currentJob, currentRun);
      if (input.recoverExpiredLease) {
        this.assertWorkerOwnsJob(currentJob, input.workerId, ['running']);
      } else {
        this.assertWorkerOwnsActiveLease(currentJob, input.workerId, ['running'], timestamp);
      }
      const expired = currentRun.expiresAt <= timestamp;
      const retryAllowed = !expired
        && requestedRetryAt !== null
        && requestedRetryAt > timestamp
        && requestedRetryAt < currentRun.expiresAt
        && currentJob.attemptCount < currentJob.maxAttempts;
      const nextRunStatus: QualityRunStatus = expired ? 'expired' : retryAllowed ? 'queued' : 'failed';
      const nextConclusion = expired ? 'expired' : retryAllowed ? null : 'technical_failure';
      const persistedErrorCode = expired ? 'QUALITY_RUN_EXPIRED' : errorCode;
      const persistedErrorMessage = expired ? '质量运行已超过短期有效期。' : errorMessage;

      this.database
        .prepare(`
          UPDATE processing_jobs
          SET status = 'failed', next_retry_at = ?, lease_owner = NULL,
              lease_expires_at = NULL, heartbeat_at = NULL,
              error_code = ?, error_message = ?, updated_at = ?
          WHERE job_id = ?
        `)
        .run(
          retryAllowed ? requestedRetryAt : null,
          persistedErrorCode,
          persistedErrorMessage,
          timestamp,
          currentJob.jobId,
        );
      this.database
        .prepare(`
          UPDATE quality_runs
          SET status = ?, conclusion = ?, completed_at = ?,
              error_code = ?, error_message = ?, updated_at = ?
          WHERE quality_run_id = ?
        `)
        .run(
          nextRunStatus,
          nextConclusion,
          retryAllowed ? null : timestamp,
          persistedErrorCode,
          persistedErrorMessage,
          timestamp,
          currentRun.qualityRunId,
        );
      const run = this.getRunOrThrow(currentRun.qualityRunId);
      const job = this.getJobOrThrow(currentJob.jobId);
      this.appendAudit(
        'processing_job',
        job.jobId,
        retryAllowed ? 'processing_job.quality_retry_scheduled' : 'processing_job.failed',
        currentJob,
        job,
        input.audit,
        timestamp,
      );
      this.appendAudit(
        'quality_run',
        run.qualityRunId,
        expired
          ? 'quality_run.expired'
          : retryAllowed
            ? 'quality_run.retry_scheduled'
            : 'quality_run.technical_failed',
        currentRun,
        run,
        input.audit,
        timestamp,
      );
      return { run, job };
    })();
  }

  recordTechnicalFailure(input: Parameters<QualityGateRepository['failRun']>[0]): CreateQualityRunResult {
    return this.failRun(input);
  }

  cancelRun(input: {
    qualityRunId: string;
    workerId?: string;
    /** 仅供启动恢复已确认过期的 cancel_requested 租约。 */
    recoverExpiredLease?: boolean;
    audit: QualityGateAuditContext;
  }): CreateQualityRunResult {
    const timestamp = this.now().toISOString();
    return this.database.transaction(() => {
      const currentRun = this.getRunOrThrow(input.qualityRunId);
      if (currentRun.status === 'cancelled') {
        return { run: currentRun, job: this.getJobOrThrow(currentRun.jobId) };
      }
      if (['passed', 'blocked', 'failed', 'expired'].includes(currentRun.status)) {
        throw new RegistryError('QUALITY_BLOCK', '已结束的质量运行不能取消。');
      }
      const currentJob = this.getJobOrThrow(currentRun.jobId);
      this.assertQualityJob(currentJob, currentRun);
      if (currentJob.status === 'running' || currentJob.status === 'cancel_requested') {
        if (!input.workerId) {
          throw new RegistryError('JOB_STATE_CONFLICT', '运行中质量任务必须由持有租约的 worker 确认取消。');
        }
        if (input.recoverExpiredLease) {
          this.assertWorkerOwnsJob(currentJob, input.workerId, ['running', 'cancel_requested']);
        } else {
          this.assertWorkerOwnsActiveLease(
            currentJob,
            input.workerId,
            ['running', 'cancel_requested'],
            timestamp,
          );
        }
      } else if (!['queued', 'failed', 'cancelled'].includes(currentJob.status)) {
        throw new RegistryError('JOB_STATE_CONFLICT', '当前质量任务状态不能取消。');
      }

      this.database
        .prepare(`
          UPDATE processing_jobs
          SET status = 'cancelled', cancel_requested_at = COALESCE(cancel_requested_at, ?),
              next_retry_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
              heartbeat_at = NULL, error_code = 'CANCELLED', error_message = '质量运行已取消。',
              updated_at = ?
          WHERE job_id = ?
        `)
        .run(timestamp, timestamp, currentJob.jobId);
      this.database
        .prepare(`
          UPDATE quality_runs
          SET status = 'cancelled', conclusion = 'cancelled', completed_at = ?,
              error_code = 'CANCELLED', error_message = '质量运行已取消。', updated_at = ?
          WHERE quality_run_id = ?
        `)
        .run(timestamp, timestamp, currentRun.qualityRunId);
      const run = this.getRunOrThrow(currentRun.qualityRunId);
      const job = this.getJobOrThrow(currentJob.jobId);
      this.appendAudit(
        'processing_job',
        job.jobId,
        'processing_job.cancelled',
        currentJob,
        job,
        input.audit,
        timestamp,
      );
      this.appendAudit(
        'quality_run',
        run.qualityRunId,
        'quality_run.cancelled',
        currentRun,
        run,
        input.audit,
        timestamp,
      );
      return { run, job };
    })();
  }

  /**
   * 普通状态接口只能把“已通过且仍绑定当前资料证据”的结论当作放行依据。
   * 正常路径仍由 finalizePassed 在同一事务里完成状态切换；这里专门防止其他调用绕过质量证据。
   */
  assertCurrentPassedRun(versionId: string): QualityRunRecord {
    const row = this.database
      .prepare(`
        SELECT * FROM quality_runs
        WHERE version_id = ? AND status = 'passed' AND conclusion = 'passed'
        ORDER BY completed_at DESC, quality_run_id DESC
        LIMIT 1
      `)
      .get(assertNonEmpty(versionId, 'versionId')) as QualityRunRow | undefined;
    if (!row) {
      throw new RegistryError('QUALITY_BLOCK', '当前资料版本没有已通过的质量运行，不能进入待发布。');
    }
    const run = mapQualityRun(row);
    this.assertRunCurrent(run);
    const results = this.listResults(run.qualityRunId);
    const byResultKey = new Map(results.map((result) => [result.resultKey, result]));
    const valid = run.inputSnapshot.requiredBlockingResultKeys.every((resultKey) => {
      const result = byResultKey.get(resultKey);
      return result?.blockingLevel === 'blocking' && result.passed;
    });
    if (!valid || results.some((result) => result.blockingLevel === 'blocking' && !result.passed)) {
      throw new RegistryError('QUALITY_BLOCK', '已通过质量运行的阻断结果不完整或已经失效。');
    }
    return run;
  }

  getRun(qualityRunId: string): QualityRunRecord {
    return this.getRunOrThrow(qualityRunId);
  }

  getRunForJob(jobId: string): QualityRunRecord | null {
    const row = this.database
      .prepare('SELECT * FROM quality_runs WHERE job_id = ?')
      .get(assertNonEmpty(jobId, 'jobId')) as QualityRunRow | undefined;
    return row ? mapQualityRun(row) : null;
  }

  getLatestRunForVersion(versionId: string): QualityRunRecord | null {
    this.getVersionOrThrow(versionId);
    const row = this.database
      .prepare('SELECT * FROM quality_runs WHERE version_id = ? ORDER BY created_at DESC, quality_run_id DESC LIMIT 1')
      .get(versionId) as QualityRunRow | undefined;
    return row ? mapQualityRun(row) : null;
  }

  listResults(qualityRunId: string): QualityResultRecord[] {
    this.getRunOrThrow(qualityRunId);
    return (this.database
      .prepare('SELECT * FROM quality_results WHERE quality_run_id = ? ORDER BY created_at, quality_result_id')
      .all(qualityRunId) as QualityResultRow[]).map(mapQualityResult);
  }

  private getRunningCurrentRun(qualityRunId: string, timestamp: string): QualityRunRecord {
    const run = this.getRunOrThrow(qualityRunId);
    this.assertRunNotExpired(run, timestamp);
    if (run.status !== 'running' || run.conclusion !== null) {
      throw new RegistryError('QUALITY_BLOCK', '只有运行中的质量运行可以记录或收口结果。');
    }
    this.assertRunCurrent(run);
    return run;
  }

  private assertRunNotExpired(run: QualityRunRecord, timestamp: string): void {
    if (run.expiresAt <= timestamp) {
      throw new RegistryError('QUALITY_BLOCK', `质量运行 ${run.qualityRunId} 已过期，pending 检索已失败关闭。`);
    }
  }

  private assertRunCurrent(run: QualityRunRecord): void {
    const version = this.getVersionOrThrow(run.versionId);
    this.assertVersionEligible(version);
    const binding = this.getUniqueHealthyPendingBinding(run.versionId);
    const bindingSnapshot = this.toBindingSnapshot(binding);
    if (binding.binding_id !== run.bindingId || !sameJson(bindingSnapshot, run.bindingSnapshot)) {
      throw new RegistryError('INCOMPLETE_RAGFLOW_MAPPING', '质量运行绑定的 pending scope 已发生漂移。');
    }
    const artifacts = this.resolveCurrentArtifactSnapshot(version);
    if (!sameJson(artifacts, run.inputSnapshot.artifacts)) {
      throw new RegistryError('QUALITY_BLOCK', '质量运行固定的三工件快照已发生漂移。');
    }
    if (
      version.parserProfile !== run.profileSnapshot.parserProfile
      || version.embeddingProfile !== run.profileSnapshot.embeddingProfile
      || version.profileBundleHash !== run.profileSnapshot.profileBundleHash
    ) {
      throw new RegistryError('QUALITY_BLOCK', '质量运行固定的 profile 已发生漂移。');
    }
  }

  private assertVersionEligible(version: MaterialVersionRecord): void {
    if (
      version.workflowStatus !== 'quality_check'
      || version.processingHealth !== 'healthy'
      || version.indexPublicationStatus !== 'pending'
    ) {
      throw new RegistryError(
        'QUALITY_BLOCK',
        '只有 quality_check / healthy / pending 的资料版本可以执行质量门禁。',
      );
    }
    const publicationCount = Number(
      this.database
        .prepare('SELECT COUNT(*) FROM material_publications WHERE version_id = ?')
        .pluck()
        .get(version.versionId),
    );
    if (publicationCount !== 0) {
      throw new RegistryError('QUALITY_BLOCK', '已存在发布关系的资料版本不能执行 pending 质量门禁。');
    }
  }

  private getUniqueHealthyPendingBinding(versionId: string): BindingRow {
    const rows = this.database
      .prepare(`
        SELECT * FROM ragflow_bindings
        WHERE version_id = ? AND remote_status = 'pending'
        ORDER BY created_at, binding_id
      `)
      .all(versionId) as BindingRow[];
    if (rows.length !== 1) {
      throw new RegistryError(
        'INCOMPLETE_RAGFLOW_MAPPING',
        `资料版本 ${versionId} 必须且只能有一份 pending 绑定。`,
      );
    }
    const binding = rows[0];
    if (
      binding.is_healthy !== 1
      || binding.remote_run_status !== 'DONE'
      || !Number.isInteger(binding.chunk_count)
      || (binding.chunk_count ?? 0) <= 0
      || !binding.last_verified_at
    ) {
      throw new RegistryError(
        'INCOMPLETE_RAGFLOW_MAPPING',
        `资料版本 ${versionId} 的唯一 pending 绑定没有完整健康证据。`,
      );
    }
    return binding;
  }

  private toBindingSnapshot(binding: BindingRow): QualityBindingSnapshot {
    return {
      bindingId: binding.binding_id,
      indexGeneration: binding.index_generation,
      datasetId: binding.dataset_id,
      documentId: binding.document_id,
      remoteRunStatus: binding.remote_run_status!,
      chunkCount: binding.chunk_count!,
      lastVerifiedAt: binding.last_verified_at!,
    };
  }

  private resolveCurrentArtifactSnapshot(version: MaterialVersionRecord): QualityArtifactSnapshot[] {
    const sourceHash = normalizeHash(version.contentHash);
    const rows = this.database
      .prepare(`
        SELECT artifact_id, version_id, artifact_type, sha256, source_hash,
               processing_profile, tool_name, tool_version, updated_at
        FROM processing_artifacts
        WHERE version_id = ? AND source_hash = ?
        ORDER BY updated_at DESC, artifact_id
      `)
      .all(version.versionId, sourceHash) as ArtifactRow[];
    const groups = new Map<string, ArtifactRow[]>();
    for (const row of rows) {
      const key = [row.source_hash, row.processing_profile, row.tool_name, row.tool_version].join('\u0000');
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    const requiredTypes = new Set<ProcessingArtifactType>(['extracted_text', 'locator_map', 'manifest']);
    const complete = [...groups.values()].find((group) => (
      group.length === 3
      && group[0]?.processing_profile === version.parserProfile
      && new Set(group.map((row) => row.artifact_type)).size === 3
      && group.every((row) => requiredTypes.has(row.artifact_type))
    ));
    if (!complete) {
      throw new RegistryError('QUALITY_BLOCK', '资料版本缺少同一处理链路下完整的正文、定位和 manifest 三工件。');
    }
    return complete
      .map((row) => ({
        artifactId: row.artifact_id,
        artifactType: row.artifact_type,
        sha256: row.sha256,
        sourceHash: row.source_hash,
        processingProfile: row.processing_profile,
        toolName: row.tool_name,
        toolVersion: row.tool_version,
      }))
      .sort((left, right) => left.artifactType.localeCompare(right.artifactType));
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

  private getRunOrThrow(qualityRunId: string): QualityRunRecord {
    const row = this.database
      .prepare('SELECT * FROM quality_runs WHERE quality_run_id = ?')
      .get(qualityRunId) as QualityRunRow | undefined;
    if (!row) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到质量运行 ${qualityRunId}。`);
    }
    return mapQualityRun(row);
  }

  private getResultOrThrow(qualityResultId: string): QualityResultRecord {
    const row = this.database
      .prepare('SELECT * FROM quality_results WHERE quality_result_id = ?')
      .get(qualityResultId) as QualityResultRow | undefined;
    if (!row) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到质量结果 ${qualityResultId}。`);
    }
    return mapQualityResult(row);
  }

  private assertQualityJob(job: ProcessingJobRecord, run: QualityRunRecord): void {
    if (job.stage !== 'quality' || job.versionId !== run.versionId || job.jobId !== run.jobId) {
      throw new RegistryError('JOB_STATE_CONFLICT', '质量运行与持久任务的身份不一致。');
    }
  }

  private assertWorkerOwnsJob(
    job: ProcessingJobRecord,
    workerId: string,
    allowedStatuses: ProcessingJobRecord['status'][],
  ): void {
    if (!allowedStatuses.includes(job.status) || job.leaseOwner !== workerId) {
      throw new RegistryError('JOB_STATE_CONFLICT', '只有持有当前质量任务租约的 worker 可以执行此操作。');
    }
  }

  private assertWorkerOwnsActiveLease(
    job: ProcessingJobRecord,
    workerId: string,
    allowedStatuses: ProcessingJobRecord['status'][],
    timestamp: string,
  ): void {
    this.assertWorkerOwnsJob(job, workerId, allowedStatuses);
    if (!job.leaseExpiresAt || job.leaseExpiresAt <= timestamp) {
      throw new RegistryError('JOB_STATE_CONFLICT', '当前 worker 的质量任务租约已过期，不能继续写入或收口。');
    }
  }

  private finishQualityJob(
    current: ProcessingJobRecord,
    status: 'succeeded',
    timestamp: string,
  ): ProcessingJobRecord {
    this.database
      .prepare(`
        UPDATE processing_jobs
        SET status = ?, next_retry_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
            heartbeat_at = NULL, error_code = NULL, error_message = NULL, updated_at = ?
        WHERE job_id = ?
      `)
      .run(status, timestamp, current.jobId);
    return this.getJobOrThrow(current.jobId);
  }

  private updateVersionForQualityConclusion(
    current: MaterialVersionRecord,
    patch: { workflowStatus: 'pending_publication' | 'quarantined'; errorMessage: string | null },
    action: string,
    audit: QualityGateAuditContext,
    timestamp: string,
  ): MaterialVersionRecord {
    assertVersionStatePatch(current, patch);
    this.database
      .prepare(`
        UPDATE material_versions
        SET workflow_status = ?, error_message = ?, updated_at = ?
        WHERE version_id = ?
      `)
      .run(patch.workflowStatus, patch.errorMessage, timestamp, current.versionId);
    const updated = this.getVersionOrThrow(current.versionId);
    this.appendAudit(
      'material_version',
      current.versionId,
      action,
      current,
      updated,
      audit,
      timestamp,
    );
    return updated;
  }

  private appendAudit(
    entityType: string,
    entityId: string,
    action: string,
    before: unknown,
    after: unknown,
    context: QualityGateAuditContext,
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
        before === null ? null : serializeJson(before, 'audit.before'),
        after === null ? null : serializeJson(after, 'audit.after'),
        createdAt,
      );
  }
}
