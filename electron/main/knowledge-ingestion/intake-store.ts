import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  KnowledgeIngestionCurrentStage,
  KnowledgeIngestionIndexPublicationStatus,
  KnowledgeIngestionItem,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionMetadata,
  KnowledgeIngestionProcessingHealth,
  KnowledgeIngestionQualityResult,
  KnowledgeIngestionQualityStatus,
  KnowledgeIngestionQualitySummary,
  KnowledgeIngestionWorkflowStatus,
} from '../../../src/types/knowledgeIngestion';
import type { RegistryDatabase } from './registry-database';
import { QualityGateRepository } from './quality-gate-repository';
import { RegistryStore } from './registry-store';
import { RegistryError, type ProcessingJobRecord } from './types';

interface IntakeStoreOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
}

interface RecordManagedFileInput {
  sourcePath: string;
  managedSourcePath: string;
  fileName: string;
  extension: '.docx' | '.pdf';
  sizeBytes: number;
  contentHash: string;
}

interface IntakeItemRow {
  item_id: string;
  version_id: string;
  original_file_name: string;
  file_extension: '.docx' | '.pdf';
  file_size_bytes: number;
  content_hash: string;
  intake_status: KnowledgeIngestionItem['status'];
  duplicate_of_version_id: string | null;
  metadata_json: string;
  workflow_status: KnowledgeIngestionWorkflowStatus;
  processing_health: KnowledgeIngestionProcessingHealth;
  index_publication_status: KnowledgeIngestionIndexPublicationStatus;
  version_error_message: string | null;
  current_job_stage: IngestionJobStage | null;
  current_job_status: KnowledgeIngestionJobStatus | null;
  current_job_error_code: string | null;
  current_job_next_retry_at: string | null;
  chunk_count: number | null;
  quality_status: Exclude<KnowledgeIngestionQualityStatus, 'not_started'> | null;
  quality_started_at: string | null;
  quality_completed_at: string | null;
  quality_questions_json: string | null;
  quality_results_json: string;
  created_at: string;
  updated_at: string;
}

type C2JobStage = Exclude<KnowledgeIngestionCurrentStage, 'quality_check'>;
type IngestionJobStage = C2JobStage | 'quality';

const C2_JOB_STAGES: readonly C2JobStage[] = ['extraction', 'upload', 'parse_wait'];

const jobStatusPriority: Record<KnowledgeIngestionJobStatus, number> = {
  cancel_requested: 0,
  running: 1,
  queued: 2,
  failed: 3,
  cancelled: 3,
  succeeded: 3,
};

const jobStagePriority: Record<IngestionJobStage, number> = {
  quality: 0,
  parse_wait: 1,
  upload: 2,
  extraction: 3,
};

const INTAKE_ITEM_SELECT_SQL = `
  SELECT
    item.*,
    version.metadata_json,
    version.workflow_status,
    version.processing_health,
    version.index_publication_status,
    version.error_message AS version_error_message,
    current_job.stage AS current_job_stage,
    current_job.status AS current_job_status,
    current_job.error_code AS current_job_error_code,
    current_job.next_retry_at AS current_job_next_retry_at,
    current_binding.chunk_count,
    current_quality.status AS quality_status,
    current_quality.started_at AS quality_started_at,
    current_quality.completed_at AS quality_completed_at,
    current_quality.questions_snapshot_json AS quality_questions_json,
    COALESCE((
      SELECT json_group_array(json_object(
        'checkKind', result.check_key,
        'resultKey', result.result_key,
        'blockingLevel', result.blocking_level,
        'passed', result.passed
      ))
      FROM quality_results result
      WHERE result.quality_run_id = current_quality.quality_run_id
    ), '[]') AS quality_results_json
  FROM intake_items item
  JOIN material_versions version ON version.version_id = item.version_id
  LEFT JOIN processing_jobs current_job
    ON current_job.job_id = (
      SELECT candidate.job_id
      FROM processing_jobs candidate
      WHERE candidate.version_id = item.version_id
        AND candidate.stage IN ('extraction', 'upload', 'parse_wait', 'quality')
      ORDER BY
        CASE candidate.status
          WHEN 'cancel_requested' THEN 0
          WHEN 'running' THEN 1
          WHEN 'queued' THEN 2
          ELSE 3
        END,
        CASE candidate.stage
          WHEN 'quality' THEN 0
          WHEN 'parse_wait' THEN 1
          WHEN 'upload' THEN 2
          ELSE 3
        END,
        candidate.updated_at DESC,
        candidate.job_id DESC
      LIMIT 1
    )
  LEFT JOIN ragflow_bindings current_binding
    ON current_binding.binding_id = (
      SELECT binding.binding_id
      FROM ragflow_bindings binding
      WHERE binding.version_id = item.version_id
        AND binding.remote_status = 'pending'
        AND binding.is_healthy = 1
        AND binding.chunk_count > 0
      ORDER BY binding.updated_at DESC, binding.binding_id DESC
      LIMIT 1
    )
  LEFT JOIN quality_runs current_quality
    ON current_quality.quality_run_id = (
      SELECT quality.quality_run_id
      FROM quality_runs quality
      WHERE quality.version_id = item.version_id
      ORDER BY quality.created_at DESC, quality.quality_run_id DESC
      LIMIT 1
    )
`;

const metadataFields: Array<keyof KnowledgeIngestionMetadata> = [
  'stableTitle',
  'domain',
  'subject',
  'materialType',
  'language',
  'educationStage',
  'grade',
  'semester',
  'edition',
  'unit',
  'parserProfile',
];

function buildInitialMetadata(fileName: string): KnowledgeIngestionMetadata {
  const title = fileName.replace(/\.(docx|pdf)$/i, '');
  return {
    stableTitle: title,
    domain: '教育',
    subject: '',
    materialType: '讲义',
    language: '中文',
    educationStage: '',
    grade: '',
    semester: '',
    edition: '',
    unit: '',
    parserProfile: 'education-textbook-v1',
  };
}

function normalizeStoredMetadata(value: unknown, fileName: string): KnowledgeIngestionMetadata {
  const fallback = buildInitialMetadata(fileName);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    metadataFields.map((field) => [
      field,
      typeof source[field] === 'string' ? source[field] : fallback[field],
    ]),
  ) as unknown as KnowledgeIngestionMetadata;
}

function isIngestionJobStage(stage: ProcessingJobRecord['stage']): stage is IngestionJobStage {
  return stage === 'quality' || C2_JOB_STAGES.includes(stage as C2JobStage);
}

function selectCurrentIngestionJob(jobs: ProcessingJobRecord[]): ProcessingJobRecord | null {
  const candidates = jobs.filter(
    (job): job is ProcessingJobRecord & { stage: IngestionJobStage } => isIngestionJobStage(job.stage),
  );
  candidates.sort((left, right) => {
    const statusDifference = jobStatusPriority[left.status] - jobStatusPriority[right.status];
    if (statusDifference !== 0) return statusDifference;
    const stageDifference = jobStagePriority[left.stage] - jobStagePriority[right.stage];
    if (stageDifference !== 0) return stageDifference;
    const updatedDifference = right.updatedAt.localeCompare(left.updatedAt);
    return updatedDifference !== 0 ? updatedDifference : right.jobId.localeCompare(left.jobId);
  });
  return candidates[0] ?? null;
}

function buildSafeQualityResultCopy(input: {
  checkKind: string;
  resultKey: string;
  passed: boolean;
  questionLocators: Map<string, string>;
}): Pick<KnowledgeIngestionQualityResult, 'label' | 'message' | 'locatorLabel'> {
  const questionMatch = /^question-(\d+):/.exec(input.resultKey);
  const questionKey = questionMatch ? `question-${questionMatch[1]}` : null;
  const questionLabel = questionMatch ? `第 ${questionMatch[1]} 条问题` : '当前问题';
  const questionLocator = questionKey ? input.questionLocators.get(questionKey) ?? null : null;

  switch (input.checkKind) {
    case 'metadata':
      return {
        label: '必填元数据完整',
        message: input.passed ? '关键元数据已人工确认且完整。' : '关键元数据不完整，不能进入待发布。',
        locatorLabel: null,
      };
    case 'artifacts':
      return {
        label: '处理工件完整',
        message: input.passed ? '正文、来源定位和 manifest 工件均已核验。' : '处理工件缺失或已发生漂移。',
        locatorLabel: null,
      };
    case 'pending_scope':
      return {
        label: '暂存索引健康',
        message: input.passed ? '唯一 pending 文档已完成解析且存在切片。' : '暂存索引健康证据不完整。',
        locatorLabel: null,
      };
    case 'formal_zero_leak':
      return {
        label: '正式通道 pending 零泄漏',
        message: input.passed
          ? '本地正式通道未命中 pending 文档，且暂存数据集请求已在网络前阻断。'
          : '正式通道 pending 零泄漏证明未通过。',
        locatorLabel: null,
      };
    case 'locator':
      return {
        label: '来源定位可追溯',
        message: input.passed ? '全部问题证据均可回到资料来源定位。' : '存在无法追溯的正文证据。',
        locatorLabel: input.questionLocators.values().next().value ?? null,
      };
    case 'candidate_top10':
      return {
        label: `${questionLabel}：目标资料进入 Top 10`,
        message: input.passed ? '目标资料已进入候选 Top 10。' : '目标资料没有进入候选 Top 10。',
        locatorLabel: questionLocator,
      };
    case 'expected_evidence_hit':
      return {
        label: `${questionLabel}：预期证据命中`,
        message: input.passed ? '候选 Top 10 已命中人工绑定的正文证据。' : '候选 Top 10 未命中人工绑定的正文证据。',
        locatorLabel: questionLocator,
      };
    case 'candidate_scope_contract':
      return {
        label: '候选范围合同',
        message: '远端返回超出本次精确 pending 范围的候选，质量运行已阻断。',
        locatorLabel: null,
      };
    default:
      return {
        label: '质量检查项',
        message: input.passed ? '检查已通过。' : '检查未通过。',
        locatorLabel: null,
      };
  }
}

function parseQualitySummary(row: IntakeItemRow): KnowledgeIngestionQualitySummary {
  if (!row.quality_status) {
    return {
      status: 'not_started',
      conclusion: null,
      startedAt: null,
      completedAt: null,
      questionCount: 0,
      results: [],
    };
  }

  let questionCount = 0;
  const questionLocators = new Map<string, string>();
  try {
    const questions = JSON.parse(row.quality_questions_json ?? '[]') as unknown;
    if (Array.isArray(questions)) {
      questionCount = questions.length;
      for (const value of questions) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const question = value as Record<string, unknown>;
        if (typeof question.questionKey === 'string' && typeof question.locatorLabel === 'string') {
          questionLocators.set(question.questionKey, question.locatorLabel);
        }
      }
    }
  } catch {
    questionCount = 0;
  }

  let results: KnowledgeIngestionQualityResult[] = [];
  try {
    const source = JSON.parse(row.quality_results_json) as unknown;
    if (Array.isArray(source)) {
      results = source.flatMap((value, index): KnowledgeIngestionQualityResult[] => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const record = value as Record<string, unknown>;
        if (
          typeof record.checkKind !== 'string'
          || typeof record.resultKey !== 'string'
          || typeof record.passed !== 'number'
        ) return [];
        const passed = record.passed === 1;
        const safeCopy = buildSafeQualityResultCopy({
          checkKind: record.checkKind,
          resultKey: record.resultKey,
          passed,
          questionLocators,
        });
        return [{
          // Renderer 只获得无内部 ID 的稳定展示键；真实 result_key 保留在 Main/SQLite。
          checkKey: `quality-result-${index + 1}`,
          label: safeCopy.label,
          severity: record.blockingLevel === 'blocking' ? 'blocking' : 'warning',
          passed,
          message: safeCopy.message,
          locatorLabel: safeCopy.locatorLabel,
        }];
      });
    }
  } catch {
    results = [];
  }

  const defaultConclusion: Record<Exclude<KnowledgeIngestionQualityStatus, 'not_started'>, string> = {
    queued: '质量检查已排队。',
    running: '正在执行快速质量检查。',
    passed: '所有快速质量阻断项已通过，资料等待发布。',
    blocked: '资料存在质量阻断项，不能进入待发布。',
    failed: '质量检查运行失败，未进入待发布。',
    cancelled: '质量检查已取消，未进入待发布。',
    expired: '质量检查运行已过期，请重新开始。',
  };
  // 质量运行的底层错误详情只留在 Main/SQLite；Renderer 始终接收稳定中文结论。
  return {
    status: row.quality_status,
    conclusion: defaultConclusion[row.quality_status],
    startedAt: row.quality_started_at,
    completedAt: row.quality_completed_at,
    questionCount,
    results,
  };
}

function normalizeProcessingError(errorCode: string | null): string {
  // runner 会把远端稳定类别与细分原因写成 CODE:REASON；Renderer 只接收主类别对应的中文摘要。
  const stableCode = errorCode?.split(':', 1)[0] ?? null;
  switch (stableCode) {
    case 'FILE_PROCESSING':
      return '正文抽取失败，请检查文件内容或格式后人工重试。';
    case 'REMOTE_AUTH_CONFIG':
      return 'RAGFlow 入库配置或权限无效，请检查连接设置后人工重试。';
    case 'REMOTE_TRANSIENT':
      return 'RAGFlow 服务暂时不可用，系统可能自动重试，也可稍后人工重试。';
    case 'REMOTE_CONTRACT':
      return 'RAGFlow 返回结果不符合入库安全合同，请检查服务状态后人工重试。';
    case 'QUALITY_BLOCK':
      return '暂存索引未通过基础健康检查，请处理后人工重试。';
    case 'CANCELLED':
      return '资料处理已取消，可在需要时人工重试。';
    default:
      return '资料处理失败，请检查文件与入库配置后人工重试。';
  }
}

function mapIntakeItem(row: IntakeItemRow): KnowledgeIngestionItem {
  const isDuplicate = row.duplicate_of_version_id !== null;
  const mappedJobStage: KnowledgeIngestionCurrentStage | null = row.current_job_stage === 'quality'
    ? 'quality_check'
    : row.current_job_stage;
  const currentStage = !isDuplicate && row.current_job_stage === 'quality'
    ? 'quality_check'
    : !isDuplicate && row.workflow_status === 'quality_check'
      ? 'quality_check'
      : !isDuplicate && (row.workflow_status === 'processing' || row.workflow_status === 'quarantined')
        ? mappedJobStage
        : null;
  const currentJobStatus = currentStage === 'quality_check'
    ? row.current_job_stage === 'quality' ? row.current_job_status : null
    : currentStage ? row.current_job_status : null;
  const hasProcessingError = currentJobStatus === 'failed'
    || row.processing_health === 'failed'
    || row.processing_health === 'degraded'
    || row.workflow_status === 'quarantined'
    || row.version_error_message !== null;
  const qualityRunCanCancel = row.current_job_stage !== 'quality'
    || row.quality_status === 'queued'
    || row.quality_status === 'running';
  return {
    itemId: row.item_id,
    versionId: row.version_id,
    fileName: row.original_file_name,
    extension: row.file_extension,
    sizeBytes: row.file_size_bytes,
    contentHash: row.content_hash,
    status: row.intake_status,
    isDuplicate,
    metadata: normalizeStoredMetadata(JSON.parse(row.metadata_json) as unknown, row.original_file_name),
    lifecycle: {
      workflowStatus: row.workflow_status,
      processingHealth: row.processing_health,
      indexPublicationStatus: row.index_publication_status,
      currentStage,
      currentJobStatus,
      errorMessage: !isDuplicate && hasProcessingError
        ? normalizeProcessingError(
            currentJobStatus === 'cancelled' ? 'CANCELLED' : row.current_job_error_code,
          )
        : null,
      chunkCount: !isDuplicate && row.chunk_count !== null ? row.chunk_count : null,
      autoRetryScheduled: !isDuplicate
        && currentJobStatus === 'failed'
        && row.current_job_next_retry_at !== null,
      canCancel: !isDuplicate && (
        qualityRunCanCancel && (
          currentJobStatus === 'queued'
          || currentJobStatus === 'running'
          || currentJobStatus === 'failed'
        )
      ),
      canRetry: !isDuplicate && (
        row.current_job_stage !== 'quality'
        && (currentJobStatus === 'failed' || currentJobStatus === 'cancelled')
      ),
      qualitySummary: parseQualitySummary(row),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateMetadata(metadata: KnowledgeIngestionMetadata): KnowledgeIngestionMetadata {
  const normalized = Object.fromEntries(
    metadataFields.map((field) => [field, metadata[field].trim()]),
  ) as unknown as KnowledgeIngestionMetadata;
  const requiredFields: Array<keyof KnowledgeIngestionMetadata> = [
    'stableTitle',
    'domain',
    'subject',
    'materialType',
    'language',
    'parserProfile',
  ];
  const missingField = requiredFields.find((field) => !normalized[field]);
  if (missingField) {
    throw new RegistryError('METADATA_VALIDATION', `必填元数据 ${missingField} 不能为空。`);
  }
  return normalized;
}

export class IntakeStore {
  private readonly database: Database.Database;
  private readonly registryStore: RegistryStore;
  private readonly qualityGateRepository: QualityGateRepository;
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;

  constructor(registryDatabase: RegistryDatabase, options: IntakeStoreOptions = {}) {
    this.database = registryDatabase.connection;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? ((prefix) => `${prefix}_${randomUUID()}`);
    this.registryStore = new RegistryStore(registryDatabase, {
      now: this.now,
      createId: this.createId,
    });
    this.qualityGateRepository = new QualityGateRepository(registryDatabase, {
      now: this.now,
      createId: this.createId,
    });
  }

  recordManagedFile(input: RecordManagedFileInput): KnowledgeIngestionItem {
    const timestamp = this.now().toISOString();
    const batchId = this.createId('batch');
    const itemId = this.createId('intake');
    const occurrenceId = this.createId('source');
    const audit = { actorId: 'user:local', reason: '用户通过资料入库中心接收单个文件。' };

    return this.database.transaction(() => {
      this.database
        .prepare(`
          INSERT INTO intake_batches (
            batch_id, source_type, status, item_count, created_at, updated_at
          ) VALUES (?, 'single_file', 'processing', 1, ?, ?)
        `)
        .run(batchId, timestamp, timestamp);

      const existing = this.database
        .prepare('SELECT version_id FROM material_versions WHERE content_hash = ?')
        .get(input.contentHash) as { version_id: string } | undefined;

      let versionId: string;
      let status: KnowledgeIngestionItem['status'];
      if (existing) {
        versionId = existing.version_id;
        status = 'duplicate';
      } else {
        const metadata = buildInitialMetadata(input.fileName);
        const material = this.registryStore.createMaterial({
          stableTitle: metadata.stableTitle,
          domain: metadata.domain,
          audit,
        });
        this.registryStore.createPublicationBranch({
          canonicalId: material.canonicalId,
          branchKey: 'default',
          branchType: 'default',
          displayName: '默认版本',
          isDefault: true,
          audit,
        });
        const version = this.registryStore.createMaterialVersion({
          canonicalId: material.canonicalId,
          publicationBranchKey: 'default',
          contentHash: input.contentHash,
          metadata: { ...metadata },
          metadataSchemaVersion: 'layout3_ingestion_v1',
          sourcePath: input.sourcePath,
          managedSourcePath: input.managedSourcePath,
          audit,
        });
        versionId = version.versionId;
        status = 'pending_confirmation';
        this.registryStore.transitionVersionState(
          versionId,
          { workflowStatus: 'pending_confirmation' },
          { actorId: 'system:intake', reason: '文件身份和完全重复检查已完成，等待人工确认元数据。' },
        );
      }

      this.database
        .prepare(`
          INSERT INTO source_occurrences (
            occurrence_id, version_id, source_path, file_name, content_hash, observed_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          occurrenceId,
          versionId,
          input.sourcePath,
          input.fileName,
          input.contentHash,
          timestamp,
        );
      this.database
        .prepare(`
          INSERT INTO intake_items (
            item_id, batch_id, version_id, occurrence_id, original_file_name,
            file_extension, file_size_bytes, content_hash, intake_status,
            duplicate_of_version_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          itemId,
          batchId,
          versionId,
          occurrenceId,
          input.fileName,
          input.extension,
          input.sizeBytes,
          input.contentHash,
          status,
          existing?.version_id ?? null,
          timestamp,
          timestamp,
        );
      this.database
        .prepare("UPDATE intake_batches SET status = 'completed', updated_at = ? WHERE batch_id = ?")
        .run(timestamp, batchId);

      return this.getItem(itemId);
    })();
  }

  confirmMetadata(
    itemId: string,
    metadataInput: KnowledgeIngestionMetadata,
  ): KnowledgeIngestionItem {
    const metadata = validateMetadata(metadataInput);
    const timestamp = this.now().toISOString();
    const audit = { actorId: 'user:local', reason: '用户在资料入库中心确认了必填元数据。' };

    return this.database.transaction(() => {
      const item = this.getItem(itemId);
      if (item.status !== 'pending_confirmation' || item.isDuplicate) {
        throw new RegistryError('INTAKE_STATE_CONFLICT', '只有等待确认的新资料可以提交元数据。');
      }

      const before = this.registryStore.getMaterialVersion(item.versionId);
      this.database
        .prepare(`
          UPDATE material_versions
          SET metadata_json = ?, metadata_schema_version = 'layout3_ingestion_v1',
              parser_profile = ?, updated_at = ?
          WHERE version_id = ?
        `)
        .run(JSON.stringify(metadata), metadata.parserProfile, timestamp, item.versionId);
      this.database
        .prepare(`
          UPDATE materials
          SET stable_title = ?, domain = ?, updated_at = ?
          WHERE canonical_id = ?
        `)
        .run(metadata.stableTitle, metadata.domain, timestamp, before.canonicalId);

      const evidenceStatement = this.database.prepare(`
        INSERT INTO metadata_evidence (
          evidence_id, version_id, field_name, value_json, source_type,
          source_reference, confidence, decision, decided_at, created_at
        ) VALUES (?, ?, ?, ?, 'manual', 'knowledge-ingestion-workbench', 1, 'confirmed', ?, ?)
      `);
      for (const field of metadataFields) {
        evidenceStatement.run(
          this.createId('evidence'),
          item.versionId,
          field,
          JSON.stringify(metadata[field]),
          timestamp,
          timestamp,
        );
      }

      const afterMetadata = this.registryStore.getMaterialVersion(item.versionId);
      this.database
        .prepare(`
          INSERT INTO audit_events (
            event_id, entity_type, entity_id, action, actor_id, reason,
            before_json, after_json, created_at
          ) VALUES (?, 'material_version', ?, 'material_version.metadata_confirmed', ?, ?, ?, ?, ?)
        `)
        .run(
          this.createId('audit'),
          item.versionId,
          audit.actorId,
          audit.reason,
          JSON.stringify(before),
          JSON.stringify(afterMetadata),
          timestamp,
        );
      this.registryStore.transitionVersionState(
        item.versionId,
        { workflowStatus: 'processing', processingHealth: 'processing' },
        audit,
      );
      this.registryStore.enqueueJob({
        versionId: item.versionId,
        stage: 'extraction',
        inputHash: item.contentHash,
        profileVersion: metadata.parserProfile,
        audit,
      });
      this.database
        .prepare("UPDATE intake_items SET intake_status = 'processing', updated_at = ? WHERE item_id = ?")
        .run(timestamp, itemId);

      return this.getItem(itemId);
    })();
  }

  cancelProcessing(itemId: string): KnowledgeIngestionItem {
    const audit = { actorId: 'user:local', reason: '用户在资料入库中心取消了当前处理任务。' };
    return this.database.transaction(() => {
      const item = this.getItem(itemId);
      if (item.isDuplicate) {
        throw new RegistryError('INTAKE_STATE_CONFLICT', '完全重复的接收记录没有可取消的处理任务。');
      }
      const currentJob = selectCurrentIngestionJob(this.registryStore.listProcessingJobs(item.versionId));
      if (
        !currentJob
        || !['queued', 'running', 'failed', 'cancel_requested'].includes(currentJob.status)
      ) {
        throw new RegistryError('JOB_STATE_CONFLICT', '当前资料没有可取消的处理任务。');
      }

      if (currentJob.stage === 'quality') {
        const currentRun = this.qualityGateRepository.getRunForJob(currentJob.jobId);
        if (!currentRun || currentRun.versionId !== item.versionId) {
          throw new RegistryError('JOB_STATE_CONFLICT', '当前质量任务没有对应的持久质量运行。');
        }
        if (currentJob.status === 'queued' || currentJob.status === 'failed') {
          // 排队或退避中的质量任务由质量仓储一次性收口任务、运行与两类审计。
          this.qualityGateRepository.cancelRun({
            qualityRunId: currentRun.qualityRunId,
            audit,
          });
        } else {
          // running 任务先进入 cancel_requested，再由持有租约的 runner 确认质量运行取消。
          this.registryStore.requestJobCancellation(currentJob.jobId, audit);
        }
        return this.getItem(itemId);
      }

      // 基础处理的 running 任务先进入 cancel_requested；排队或失败任务立即终止。
      const cancelled = this.registryStore.requestJobCancellation(currentJob.jobId, audit);
      if (cancelled.status === 'cancelled') {
        const version = this.registryStore.getMaterialVersion(item.versionId);
        this.registryStore.transitionVersionState(
          item.versionId,
          {
            processingHealth: 'failed',
            errorMessage: '资料处理已取消，可在需要时人工重试。',
          },
          audit,
        );
        if (version.workflowStatus !== 'processing' && version.workflowStatus !== 'quarantined') {
          throw new RegistryError('JOB_STATE_CONFLICT', '当前资料生命周期不允许取消基础处理。');
        }
      }
      return this.getItem(itemId);
    })();
  }

  retryProcessing(itemId: string): KnowledgeIngestionItem {
    const audit = { actorId: 'user:local', reason: '用户在资料入库中心人工重试了当前处理任务。' };
    return this.database.transaction(() => {
      const item = this.getItem(itemId);
      if (item.isDuplicate) {
        throw new RegistryError('INTAKE_STATE_CONFLICT', '完全重复的接收记录不能重新排入处理。');
      }
      const currentJob = selectCurrentIngestionJob(this.registryStore.listProcessingJobs(item.versionId));
      if (!currentJob || (currentJob.status !== 'failed' && currentJob.status !== 'cancelled')) {
        throw new RegistryError('JOB_STATE_CONFLICT', '只有失败或已取消的处理任务可以人工重试。');
      }
      const version = this.registryStore.getMaterialVersion(item.versionId);
      if (currentJob.stage === 'quality') {
        throw new RegistryError('JOB_STATE_CONFLICT', '质量检查失败或取消后请重新提交 3～5 条问题与证据。');
      }
      if (version.workflowStatus !== 'processing' && version.workflowStatus !== 'quarantined') {
        throw new RegistryError('JOB_STATE_CONFLICT', '当前资料生命周期不允许重新排入基础处理。');
      }

      // 任务、三维状态和版本错误必须在同一外层事务恢复，避免 UI 看到半完成重试。
      this.registryStore.transitionVersionState(
        item.versionId,
        {
          workflowStatus: version.workflowStatus === 'quarantined' ? 'processing' : undefined,
          processingHealth: 'processing',
          errorMessage: null,
        },
        audit,
      );
      this.registryStore.retryJob(currentJob.jobId, audit);
      return this.getItem(itemId);
    })();
  }

  listItems(limit = 100): KnowledgeIngestionItem[] {
    const safeLimit = Math.max(1, Math.min(200, Math.round(limit)));
    const rows = this.database
      .prepare(`${INTAKE_ITEM_SELECT_SQL}
        ORDER BY item.created_at DESC, item.item_id DESC
        LIMIT ?
      `)
      .all(safeLimit) as IntakeItemRow[];
    return rows.map(mapIntakeItem);
  }

  getItem(itemId: string): KnowledgeIngestionItem {
    const row = this.database
      .prepare(`${INTAKE_ITEM_SELECT_SQL}
        WHERE item.item_id = ?
      `)
      .get(itemId) as IntakeItemRow | undefined;
    if (!row) {
      throw new RegistryError('RECORD_NOT_FOUND', `未找到接收项 ${itemId}。`);
    }
    return mapIntakeItem(row);
  }
}
