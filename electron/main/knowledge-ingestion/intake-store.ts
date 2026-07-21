import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  KnowledgeIngestionCurrentStage,
  KnowledgeIngestionIndexPublicationStatus,
  KnowledgeIngestionItem,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionMetadata,
  KnowledgeIngestionProcessingHealth,
  KnowledgeIngestionPublicationOperationStatus,
  KnowledgeIngestionPublicationSummary,
  KnowledgeIngestionQualityResult,
  KnowledgeIngestionQualityStatus,
  KnowledgeIngestionQualitySummary,
  KnowledgeIngestionWorkflowStatus,
} from '../../../src/types/knowledgeIngestion';
import type { RegistryDatabase } from './registry-database';
import { QualityGateRepository } from './quality-gate-repository';
import { RegistryStore } from './registry-store';
import {
  RegistryError,
  type ProcessingJobRecord,
  type PublicationOperationPhase,
  type PublicationOperationType,
} from './types';

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
  version_no: number;
  previous_version_id: string | null;
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
  quality_expires_at: string | null;
  quality_questions_json: string | null;
  quality_results_json: string;
  publication_operation_type: PublicationOperationType | null;
  publication_operation_phase: PublicationOperationPhase | null;
  publication_job_status: KnowledgeIngestionJobStatus | null;
  publication_job_next_retry_at: string | null;
  publication_operation_updated_at: string | null;
  is_current_publication: number;
  has_newer_version: number;
  open_publication_operation_count: number;
  publishable_binding_count: number;
  active_binding_count: number;
  rollback_binding_count: number;
  rollback_publication_pair_count: number;
  rollback_quality_count: number;
  rollback_target_healthy: number;
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
    version.version_no,
    version.previous_version_id,
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
    current_quality.expires_at AS quality_expires_at,
    current_quality.questions_snapshot_json AS quality_questions_json,
    latest_publication_operation.operation_type AS publication_operation_type,
    latest_publication_operation.phase AS publication_operation_phase,
    publication_job.status AS publication_job_status,
    publication_job.next_retry_at AS publication_job_next_retry_at,
    latest_publication_operation.updated_at AS publication_operation_updated_at,
    EXISTS (
      SELECT 1
      FROM material_publications active_publication
      WHERE active_publication.version_id = item.version_id
        AND active_publication.canonical_id = version.canonical_id
        AND active_publication.publication_branch_key = version.publication_branch_key
        AND active_publication.publication_status = 'active'
    ) AS is_current_publication,
    EXISTS (
      SELECT 1
      FROM material_versions newer_version
      WHERE newer_version.canonical_id = version.canonical_id
        AND newer_version.publication_branch_key = version.publication_branch_key
        AND newer_version.version_no > version.version_no
    ) AS has_newer_version,
    (
      SELECT COUNT(*)
      FROM publication_operations open_operation
      WHERE open_operation.canonical_id = version.canonical_id
        AND open_operation.publication_branch_key = version.publication_branch_key
        AND open_operation.phase NOT IN ('completed', 'failed')
    ) AS open_publication_operation_count,
    (
      SELECT COUNT(*)
      FROM ragflow_bindings binding
      WHERE binding.version_id = item.version_id
        AND binding.remote_status = 'pending'
        AND binding.is_healthy = 1
        AND binding.remote_run_status = 'DONE'
        AND binding.chunk_count > 0
        AND binding.last_verified_at IS NOT NULL
    ) AS publishable_binding_count,
    (
      SELECT COUNT(*)
      FROM ragflow_bindings binding
      WHERE binding.version_id = item.version_id
        AND binding.remote_status = 'active'
        AND binding.is_healthy = 1
        AND binding.remote_run_status = 'DONE'
        AND binding.chunk_count > 0
        AND binding.last_verified_at IS NOT NULL
    ) AS active_binding_count,
    (
      SELECT COUNT(*)
      FROM ragflow_bindings binding
      WHERE binding.version_id = version.previous_version_id
        AND binding.remote_status = 'superseded'
        AND binding.is_healthy = 1
        AND binding.remote_run_status = 'DONE'
        AND binding.chunk_count > 0
        AND binding.last_verified_at IS NOT NULL
    ) AS rollback_binding_count,
    (
      SELECT COUNT(*)
      FROM material_publications active_publication
      JOIN material_publications previous_publication
        ON previous_publication.canonical_id = active_publication.canonical_id
        AND previous_publication.publication_branch_key = active_publication.publication_branch_key
        AND previous_publication.version_id = version.previous_version_id
        AND previous_publication.publication_status = 'superseded'
        AND previous_publication.effective_from IS active_publication.effective_from
        AND previous_publication.effective_to IS active_publication.effective_to
      WHERE active_publication.version_id = item.version_id
        AND active_publication.canonical_id = version.canonical_id
        AND active_publication.publication_branch_key = version.publication_branch_key
        AND active_publication.publication_status = 'active'
    ) AS rollback_publication_pair_count,
    (
      SELECT COUNT(*)
      FROM quality_runs rollback_quality
      WHERE rollback_quality.version_id = version.previous_version_id
        AND rollback_quality.status = 'passed'
        AND rollback_quality.conclusion = 'passed'
    ) AS rollback_quality_count,
    EXISTS (
      SELECT 1
      FROM material_versions rollback_version
      WHERE rollback_version.version_id = version.previous_version_id
        AND rollback_version.canonical_id = version.canonical_id
        AND rollback_version.publication_branch_key = version.publication_branch_key
        AND rollback_version.workflow_status = 'superseded'
        AND rollback_version.processing_health = 'healthy'
        AND rollback_version.index_publication_status = 'superseded'
    ) AS rollback_target_healthy,
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
  LEFT JOIN publication_operations latest_publication_operation
    ON latest_publication_operation.operation_id = (
      SELECT operation.operation_id
      FROM publication_operations operation
      WHERE (
        operation.operation_type = 'publish'
        AND operation.target_version_id = item.version_id
      ) OR (
        operation.operation_type = 'rollback'
        AND operation.current_version_id = item.version_id
      )
      ORDER BY operation.created_at DESC, operation.operation_id DESC
      LIMIT 1
    )
  LEFT JOIN processing_jobs publication_job
    ON publication_job.job_id = latest_publication_operation.job_id
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
        message: input.passed ? '全部自动抽样证据均可回到资料来源定位。' : '存在无法追溯的自动抽样正文证据。',
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
        message: input.passed ? '候选 Top 10 已命中自动抽取的正文证据。' : '候选 Top 10 未命中自动抽取的正文证据。',
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

function parseQualitySummary(row: IntakeItemRow, timestamp: string): KnowledgeIngestionQualitySummary {
  if (!row.quality_status) {
    return {
      status: 'not_started',
      conclusion: null,
      startedAt: null,
      completedAt: null,
      expiresAt: null,
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
  const status = row.workflow_status === 'pending_publication'
    && row.quality_status === 'passed'
    && row.quality_expires_at !== null
    && row.quality_expires_at <= timestamp
      ? 'expired'
      : row.quality_status;
  // 历史 passed 结论保持不可变；只有当前待发布快照在失效后映射为 expired，提示用户重新取证。
  return {
    status,
    conclusion: status === 'passed' && row.workflow_status !== 'pending_publication'
      ? '最近一次快速质量门禁已通过。'
      : defaultConclusion[status],
    startedAt: row.quality_started_at,
    completedAt: row.quality_completed_at,
    expiresAt: row.quality_expires_at,
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

function resolvePublicationOperationStatus(
  row: IntakeItemRow,
): KnowledgeIngestionPublicationOperationStatus {
  if (!row.publication_operation_type || !row.publication_operation_phase) return 'not_started';
  if (row.publication_operation_phase === 'completed') return 'completed';
  if (row.publication_operation_phase === 'failed') return 'failed';
  if (row.publication_job_status === 'failed') {
    return row.publication_job_next_retry_at ? 'retry_scheduled' : 'attention_required';
  }
  if (
    row.publication_operation_phase === 'sqlite_switched'
    || row.publication_operation_phase === 'restore_target_pending'
    || row.publication_operation_phase === 'restore_target_superseded'
  ) {
    return 'compensating';
  }
  if (row.publication_job_status === 'queued') return 'queued';
  return 'running';
}

function buildPublicationOperationMessage(
  row: IntakeItemRow,
  status: KnowledgeIngestionPublicationOperationStatus,
  summary: Pick<KnowledgeIngestionPublicationSummary, 'canPublish' | 'canRollback' | 'isCurrentVersion'>,
): string {
  const operationLabel = row.publication_operation_type === 'rollback' ? '回滚' : '发布';
  switch (status) {
    case 'queued':
      return `${operationLabel}操作已排队，系统将按安全顺序执行远端核验与本地切换。`;
    case 'running':
      return `正在执行${operationLabel}核验，SQLite 正式可见关系尚未被提前放行。`;
    case 'compensating':
      return row.publication_operation_phase === 'sqlite_switched'
        ? 'SQLite 正式版本已安全切换，正在同步旧版远端状态。当前正式版本不会因补偿重试而回退。'
        : '正在恢复目标文档的原远端状态，SQLite 正式版本没有被错误切换。';
    case 'retry_scheduled':
      if (row.publication_operation_phase === 'sqlite_switched') {
        return '正式版本已经切换，但旧版远端状态尚未收口；系统已安排持久退避重试，当前正式版本不会回退。';
      }
      if (
        row.publication_operation_phase === 'restore_target_pending'
        || row.publication_operation_phase === 'restore_target_superseded'
      ) {
        return '正式版本尚未切换，系统正在按持久任务恢复目标远端状态。';
      }
      return `${operationLabel}遇到临时问题，系统已安排持久退避重试。`;
    case 'attention_required':
      if (row.publication_operation_phase === 'sqlite_switched') {
        return '正式版本已经切换，但旧版远端状态仍需人工收口；确认连接恢复后可重试，当前正式版本不会回退。';
      }
      if (
        row.publication_operation_phase === 'restore_target_pending'
        || row.publication_operation_phase === 'restore_target_superseded'
      ) {
        return '正式版本尚未切换，目标远端状态恢复需要人工处理；确认连接后可重试。';
      }
      return `${operationLabel}需要人工处理，请确认连接与资料状态后重试。`;
    case 'completed':
      if (row.publication_operation_type === 'rollback') {
        return '回滚已完成，上一版本已恢复为当前正式版本；此问题版本已隔离。';
      }
      if (summary.isCurrentVersion) {
        return '发布已完成，当前版本已成为该资料分支的正式版本。';
      }
      return row.workflow_status === 'superseded'
        ? '最近一次发布操作已完成；此版本随后被同分支新版本替代。'
        : '最近一次发布或回滚操作已完成；此版本当前不是正式版本。';
    case 'failed':
      return `${operationLabel}已安全终止，系统没有留下半完成的正式可见关系。`;
    default:
      if (summary.canPublish) return '质量门禁已通过，当前版本可以进入发布确认。';
      if (summary.canRollback) return '当前正式版本具备可恢复的上一版本，可发起受控回滚。';
      if (summary.isCurrentVersion) return '当前版本是该资料分支的正式版本。';
      if (row.workflow_status === 'superseded') return '当前版本已被同分支新版本替代。';
      return '尚未创建发布或回滚操作。';
  }
}

function buildPublicationSummary(
  row: IntakeItemRow,
  isDuplicate: boolean,
  timestamp: string,
): KnowledgeIngestionPublicationSummary {
  const hasOpenOperation = row.open_publication_operation_count > 0;
  const canPublish = !isDuplicate
    && !hasOpenOperation
    && row.workflow_status === 'pending_publication'
    && row.processing_health === 'healthy'
    && row.index_publication_status === 'pending'
    && row.quality_status === 'passed'
    && row.quality_expires_at !== null
    && row.quality_expires_at > timestamp
    && row.publishable_binding_count === 1;
  const canRollback = !isDuplicate
    && !hasOpenOperation
    && row.workflow_status === 'published'
    && row.processing_health === 'healthy'
    && row.index_publication_status === 'active'
    && row.previous_version_id !== null
    && row.is_current_publication === 1
    && row.has_newer_version === 0
    && row.active_binding_count === 1
    && row.rollback_binding_count === 1
    && row.rollback_publication_pair_count === 1
    && row.rollback_quality_count > 0
    && row.rollback_target_healthy === 1;
  const canRetry = !isDuplicate
    && row.publication_operation_phase !== null
    && row.publication_operation_phase !== 'completed'
    && row.publication_operation_phase !== 'failed'
    && row.publication_job_status === 'failed'
    && row.publication_job_next_retry_at === null;
  const summaryBase = {
    canPublish,
    canRollback,
    isCurrentVersion: row.is_current_publication === 1,
  };
  const operationStatus = resolvePublicationOperationStatus(row);
  return {
    versionLabel: `第 ${row.version_no} 版`,
    previousVersionLabel: row.previous_version_id ? `第 ${Math.max(1, row.version_no - 1)} 版` : null,
    isCurrentVersion: summaryBase.isCurrentVersion,
    canReceiveNextVersion: !isDuplicate
      && !hasOpenOperation
      && row.workflow_status === 'published'
      && row.processing_health === 'healthy'
      && row.index_publication_status === 'active'
      && row.is_current_publication === 1
      && row.has_newer_version === 0,
    canPublish,
    canRollback,
    canRetry,
    operationType: row.publication_operation_type,
    operationStatus,
    operationMessage: buildPublicationOperationMessage(row, operationStatus, summaryBase),
    operationUpdatedAt: row.publication_operation_updated_at,
  };
}

function mapIntakeItem(row: IntakeItemRow, timestamp: string): KnowledgeIngestionItem {
  const isDuplicate = row.duplicate_of_version_id !== null;
  const mappedJobStage: KnowledgeIngestionCurrentStage | null = row.current_job_stage === 'quality'
    ? 'quality_check'
    : row.current_job_stage;
  const currentStage = !isDuplicate && row.workflow_status === 'quality_check'
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
      qualitySummary: parseQualitySummary(row, timestamp),
    },
    publication: buildPublicationSummary(row, isDuplicate, timestamp),
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

  recordManagedFileAsNextVersion(
    parentItemId: string,
    input: RecordManagedFileInput,
  ): KnowledgeIngestionItem {
    const timestamp = this.now().toISOString();
    const batchId = this.createId('batch');
    const itemId = this.createId('intake');
    const occurrenceId = this.createId('source');
    const audit = { actorId: 'user:local', reason: '用户从当前已发布资料接收同分支新版本。' };

    return this.database.transaction(() => {
      const parentItem = this.getItem(parentItemId);
      if (parentItem.isDuplicate) {
        throw new RegistryError('INTAKE_STATE_CONFLICT', '完全重复的接收记录不能作为新版本来源。');
      }
      const parentVersion = this.registryStore.getMaterialVersion(parentItem.versionId);
      const activePublication = this.database
        .prepare(`
          SELECT publication_id
          FROM material_publications
          WHERE version_id = ?
            AND canonical_id = ?
            AND publication_branch_key = ?
            AND publication_status = 'active'
          LIMIT 1
        `)
        .get(
          parentVersion.versionId,
          parentVersion.canonicalId,
          parentVersion.publicationBranchKey,
        ) as { publication_id: string } | undefined;
      if (
        parentVersion.workflowStatus !== 'published'
        || parentVersion.processingHealth !== 'healthy'
        || parentVersion.indexPublicationStatus !== 'active'
        || !activePublication
      ) {
        throw new RegistryError('INTAKE_STATE_CONFLICT', '只有当前已发布且索引健康的资料可以接收同分支新版本。');
      }
      const openPublicationOperation = this.database
        .prepare(`
          SELECT 1
          FROM publication_operations
          WHERE canonical_id = ?
            AND publication_branch_key = ?
            AND phase NOT IN ('completed', 'failed')
          LIMIT 1
        `)
        .get(parentVersion.canonicalId, parentVersion.publicationBranchKey);
      // 新版接收和发布/回滚共享同一分支串行边界，避免回滚执行中再长出新分叉。
      if (openPublicationOperation) {
        throw new RegistryError('INTAKE_STATE_CONFLICT', '当前资料分支正在执行发布或回滚，请完成后再接收新版本。');
      }

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
        const latestVersion = this.database
          .prepare(`
            SELECT version_id, version_no
            FROM material_versions
            WHERE canonical_id = ? AND publication_branch_key = ?
            ORDER BY version_no DESC
            LIMIT 1
          `)
          .get(parentVersion.canonicalId, parentVersion.publicationBranchKey) as
          | { version_id: string; version_no: number }
          | undefined;
        // V1 不建立分叉版本；完全重复仍可登记来源，但新内容必须接在当前发布版之后。
        if (!latestVersion || latestVersion.version_id !== parentVersion.versionId) {
          throw new RegistryError('INTAKE_STATE_CONFLICT', '当前发布版之后已有新版本，不能再次创建同分支分叉版本。');
        }
        const version = this.registryStore.createMaterialVersion({
          canonicalId: parentVersion.canonicalId,
          publicationBranchKey: parentVersion.publicationBranchKey,
          contentHash: input.contentHash,
          metadata: { ...parentVersion.metadata },
          metadataSchemaVersion: parentVersion.metadataSchemaVersion,
          sourcePath: input.sourcePath,
          managedSourcePath: input.managedSourcePath,
          parserProfile: parentVersion.parserProfile,
          embeddingProfile: parentVersion.embeddingProfile,
          profileBundleHash: parentVersion.profileBundleHash,
          audit,
        });
        if (
          version.versionNo !== parentVersion.versionNo + 1
          || version.previousVersionId !== parentVersion.versionId
        ) {
          throw new RegistryError('INTAKE_STATE_CONFLICT', '新版本序号或上一版本关系不符合当前发布分支。');
        }
        versionId = version.versionId;
        status = 'pending_confirmation';
        this.registryStore.transitionVersionState(
          versionId,
          { workflowStatus: 'pending_confirmation' },
          { actorId: 'system:intake', reason: '同分支新版本已登记，等待用户重新确认元数据。' },
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
        throw new RegistryError('JOB_STATE_CONFLICT', '质量检查失败或取消后，请在资料详情中重新启动自动索引健康检查。');
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
    const timestamp = this.now().toISOString();
    return rows.map((row) => mapIntakeItem(row, timestamp));
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
    return mapIntakeItem(row, this.now().toISOString());
  }
}
