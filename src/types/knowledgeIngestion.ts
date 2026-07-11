export type KnowledgeIngestionRuntimeState = 'ready' | 'unavailable';

export type KnowledgeIngestionItemStatus =
  | 'pending_confirmation'
  | 'processing'
  | 'duplicate';

export type KnowledgeIngestionWorkflowStatus =
  | 'pending_identification'
  | 'pending_confirmation'
  | 'processing'
  | 'quality_check'
  | 'pending_publication'
  | 'published'
  | 'superseded'
  | 'quarantined'
  | 'archived';

export type KnowledgeIngestionProcessingHealth =
  | 'pending'
  | 'processing'
  | 'healthy'
  | 'degraded'
  | 'failed';

export type KnowledgeIngestionIndexPublicationStatus =
  | 'pending'
  | 'active'
  | 'superseded'
  | 'archived';

export type KnowledgeIngestionCurrentStage =
  | 'extraction'
  | 'upload'
  | 'parse_wait'
  | 'quality_check';

export type KnowledgeIngestionJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled';

export type KnowledgeIngestionQualityStatus =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'passed'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type KnowledgeIngestionQualitySeverity = 'blocking' | 'warning';

export interface KnowledgeIngestionQualityResult {
  checkKey: string;
  label: string;
  severity: KnowledgeIngestionQualitySeverity;
  passed: boolean;
  message: string;
  /** Main 生成的安全来源定位，不包含本机路径或远端 ID。 */
  locatorLabel: string | null;
}

/** Renderer 只消费质量结论摘要，质量运行 ID 与远端身份始终留在 Main。 */
export interface KnowledgeIngestionQualitySummary {
  status: KnowledgeIngestionQualityStatus;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  questionCount: number;
  results: KnowledgeIngestionQualityResult[];
}

export interface KnowledgeIngestionRuntimeStatus {
  state: KnowledgeIngestionRuntimeState;
  message: string;
  recoveredJobCount: number;
  schemaVersion: number | null;
}

export interface KnowledgeIngestionMetadata {
  stableTitle: string;
  domain: string;
  subject: string;
  materialType: string;
  language: string;
  educationStage: string;
  grade: string;
  semester: string;
  edition: string;
  unit: string;
  parserProfile: string;
}

export interface KnowledgeIngestionLifecycle {
  workflowStatus: KnowledgeIngestionWorkflowStatus;
  processingHealth: KnowledgeIngestionProcessingHealth;
  indexPublicationStatus: KnowledgeIngestionIndexPublicationStatus;
  currentStage: KnowledgeIngestionCurrentStage | null;
  currentJobStatus: KnowledgeIngestionJobStatus | null;
  /** Main 生成的稳定中文提示，不包含远端 ID、受管路径或底层异常详情。 */
  errorMessage: string | null;
  chunkCount: number | null;
  autoRetryScheduled: boolean;
  canCancel: boolean;
  canRetry: boolean;
  qualitySummary: KnowledgeIngestionQualitySummary;
}

export interface KnowledgeIngestionItem {
  itemId: string;
  versionId: string;
  fileName: string;
  extension: '.docx' | '.pdf';
  sizeBytes: number;
  contentHash: string;
  status: KnowledgeIngestionItemStatus;
  isDuplicate: boolean;
  metadata: KnowledgeIngestionMetadata;
  lifecycle: KnowledgeIngestionLifecycle;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeIngestionSelectResult {
  canceled: boolean;
  item: KnowledgeIngestionItem | null;
}

export interface KnowledgeIngestionConfirmMetadataInput {
  itemId: string;
  metadata: KnowledgeIngestionMetadata;
}

export interface KnowledgeIngestionItemActionInput {
  itemId: string;
}

export interface KnowledgeIngestionQualityQuestionInput {
  question: string;
  evidence: string;
}

export interface KnowledgeIngestionStartQualityCheckInput {
  itemId: string;
  questions: KnowledgeIngestionQualityQuestionInput[];
}

export interface KnowledgeIngestionRagflowConfigStatus {
  configured: boolean;
  baseUrl: string;
  stagingDatasetId: string;
  indexGeneration: string;
  hasApiKey: boolean;
}

export interface KnowledgeIngestionSaveRagflowConfigInput {
  baseUrl: string;
  /** 留空表示继续使用 Main 安全存储中的已有密钥，明文密钥不会从 Main 回传。 */
  apiKey?: string;
  stagingDatasetId: string;
  indexGeneration: string;
}

/** 设置页可见的受控数据集候选，名称用于展示，ID 仅用于保存所选项。 */
export interface KnowledgeIngestionRagflowDatasetOption {
  id: string;
  name: string;
}

export interface KnowledgeIngestionListRagflowDatasetsInput {
  baseUrl: string;
  /** 留空时仅使用 Main 安全存储中的已有密钥。 */
  apiKey?: string;
}
