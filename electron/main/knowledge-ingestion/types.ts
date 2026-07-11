export const WORKFLOW_STATUSES = [
  'pending_identification',
  'pending_confirmation',
  'processing',
  'quality_check',
  'pending_publication',
  'published',
  'superseded',
  'quarantined',
  'archived',
] as const;

export const PROCESSING_HEALTH_STATUSES = [
  'pending',
  'processing',
  'healthy',
  'degraded',
  'failed',
] as const;

export const INDEX_PUBLICATION_STATUSES = [
  'pending',
  'active',
  'superseded',
  'archived',
] as const;

export const PUBLICATION_BRANCH_TYPES = ['default', 'edition', 'curriculum', 'legal'] as const;

export const JOB_STAGES = [
  'intake',
  'fingerprint',
  'identification',
  'conversion',
  'extraction',
  'splitting',
  'upload',
  'parse_wait',
  'quality',
  'publication_compensation',
] as const;

export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancel_requested',
  'cancelled',
] as const;

export const PROCESSING_ARTIFACT_TYPES = [
  'extracted_text',
  'locator_map',
  'manifest',
] as const;

export const QUALITY_RUN_STATUSES = [
  'queued',
  'running',
  'passed',
  'blocked',
  'failed',
  'cancelled',
  'expired',
] as const;

export const QUALITY_RUN_CONCLUSIONS = [
  'passed',
  'blocked',
  'technical_failure',
  'cancelled',
  'expired',
] as const;

export const QUALITY_BLOCKING_LEVELS = ['blocking', 'warning', 'info'] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export type ProcessingHealth = (typeof PROCESSING_HEALTH_STATUSES)[number];
export type IndexPublicationStatus = (typeof INDEX_PUBLICATION_STATUSES)[number];
export type PublicationBranchType = (typeof PUBLICATION_BRANCH_TYPES)[number];
export type JobStage = (typeof JOB_STAGES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type ProcessingArtifactType = (typeof PROCESSING_ARTIFACT_TYPES)[number];
export type QualityRunStatus = (typeof QUALITY_RUN_STATUSES)[number];
export type QualityRunConclusion = (typeof QUALITY_RUN_CONCLUSIONS)[number];
export type QualityBlockingLevel = (typeof QUALITY_BLOCKING_LEVELS)[number];

export interface MaterialRecord {
  canonicalId: string;
  stableTitle: string;
  domain: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationBranchRecord {
  canonicalId: string;
  branchKey: string;
  branchType: PublicationBranchType;
  displayName: string;
  isDefault: boolean;
  defaultStrategy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialVersionRecord {
  versionId: string;
  canonicalId: string;
  publicationBranchKey: string;
  versionNo: number;
  contentHash: string;
  workflowStatus: WorkflowStatus;
  processingHealth: ProcessingHealth;
  indexPublicationStatus: IndexPublicationStatus;
  metadata: Record<string, unknown>;
  metadataSchemaVersion: string;
  sourcePath: string | null;
  managedSourcePath: string | null;
  parserProfile: string | null;
  embeddingProfile: string | null;
  profileBundleHash: string | null;
  previousVersionId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  supersededAt: string | null;
  archivedAt: string | null;
  lastVerifiedAt: string | null;
}

export interface VersionStatePatch {
  workflowStatus?: WorkflowStatus;
  processingHealth?: ProcessingHealth;
  indexPublicationStatus?: IndexPublicationStatus;
  errorMessage?: string | null;
}

export interface ProcessingJobRecord {
  jobId: string;
  versionId: string;
  stage: JobStage;
  status: JobStatus;
  inputHash: string;
  profileVersion: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  cancelRequestedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingArtifactRecord {
  artifactId: string;
  versionId: string;
  artifactType: ProcessingArtifactType;
  relativePath: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  sourceHash: string;
  processingProfile: string;
  toolName: string;
  toolVersion: string;
  lineage: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface QualityQuestionSnapshot {
  questionKey: string;
  question: string;
  evidenceExcerpt: string;
  evidenceSha256: string;
  startOffset: number;
  endOffset: number;
  locatorLabel: string;
}

export interface QualityBindingSnapshot {
  bindingId: string;
  indexGeneration: string;
  datasetId: string;
  documentId: string;
  remoteRunStatus: string;
  chunkCount: number;
  lastVerifiedAt: string;
}

export interface QualityArtifactSnapshot {
  artifactId: string;
  artifactType: ProcessingArtifactType;
  sha256: string;
  sourceHash: string;
  processingProfile: string;
  toolName: string;
  toolVersion: string;
}

export interface QualityInputSnapshot {
  request: Record<string, unknown>;
  requiredBlockingResultKeys: string[];
  artifacts: QualityArtifactSnapshot[];
}

export interface QualityProfileSnapshot {
  parserProfile: string | null;
  embeddingProfile: string | null;
  profileBundleHash: string | null;
  request: Record<string, unknown>;
}

export interface QualityRunRecord {
  qualityRunId: string;
  versionId: string;
  jobId: string;
  bindingId: string;
  status: QualityRunStatus;
  conclusion: QualityRunConclusion | null;
  bindingSnapshot: QualityBindingSnapshot;
  questionsSnapshot: QualityQuestionSnapshot[];
  inputSnapshot: QualityInputSnapshot;
  profileSnapshot: QualityProfileSnapshot;
  configSnapshot: Record<string, unknown>;
  expiresAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualityResultRecord {
  qualityResultId: string;
  qualityRunId: string;
  checkKey: string;
  resultKey: string;
  blockingLevel: QualityBlockingLevel;
  passed: boolean;
  threshold: unknown;
  actual: unknown;
  evidence: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface QualityRetrievalScope {
  qualityRunId: string;
  versionId: string;
  bindingId: string;
  datasetIds: string[];
  documentIds: string[];
  expiresAt: string;
}

export interface ActiveRetrievalScope {
  datasetIds: string[];
  documentIds: string[];
  resolvedAt: string;
}

export interface RetrievalDocumentValidation {
  acceptedDocumentIds: string[];
  rejectedDocumentIds: string[];
}

export type RegistryErrorCode =
  | 'DATABASE_OWNER_VIOLATION'
  | 'DATABASE_INTEGRITY_FAILED'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'INPUT_VALIDATION'
  | 'METADATA_VALIDATION'
  | 'INTAKE_STATE_CONFLICT'
  | 'RUNTIME_UNAVAILABLE'
  | 'DUPLICATE_CONTENT_HASH'
  | 'INVALID_STATE_TRANSITION'
  | 'PUBLICATION_CONFLICT'
  | 'PUBLICATION_PRECONDITION_FAILED'
  | 'LAST_ACTIVE_PUBLICATION'
  | 'JOB_STATE_CONFLICT'
  | 'EMPTY_ACTIVE_DOCUMENT_SET'
  | 'INCOMPLETE_RAGFLOW_MAPPING'
  | 'REMOTE_AUTH_CONFIG'
  | 'REMOTE_TRANSIENT'
  | 'REMOTE_CONTRACT'
  | 'QUALITY_BLOCK'
  | 'FILE_PROCESSING'
  | 'CANCELLED'
  | 'RECORD_NOT_FOUND';

export class RegistryError extends Error {
  constructor(
    readonly code: RegistryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RegistryError';
  }
}
