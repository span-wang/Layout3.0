export type RagflowMetadataPrimitive = string | number | boolean | null;

export type RagflowMetadataValue =
  | RagflowMetadataPrimitive
  | RagflowMetadataPrimitive[]
  | { [key: string]: RagflowMetadataValue };

export type RagflowMetadata = Record<string, RagflowMetadataValue>;

export interface RagflowDocument {
  id: string;
  name: string;
  run?: string;
  progress?: number;
  progress_msg?: string;
  chunk_count?: number;
  meta_fields?: RagflowMetadata;
}

export interface RagflowDocumentListPayload {
  total: number;
  docs: RagflowDocument[];
}

/** 用于资料入库设置中的受控候选选择，不承载数据集配置的其他远端字段。 */
export interface RagflowDatasetOption {
  id: string;
  name: string;
}

export interface RagflowApiEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

export type RagflowDocumentReconciliation =
  | { kind: 'missing'; remoteFileName: string }
  | { kind: 'existing'; remoteFileName: string; document: RagflowDocument };

export interface RagflowUploadInput {
  datasetId: string;
  filePath: string;
  remoteFileName: string;
  mediaType: string;
  signal?: AbortSignal;
}

export interface RagflowParseWaitInput {
  datasetId: string;
  documentId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

/**
 * 质量门禁只能使用 SQLite 已解析出的精确数据集与文档集合，不能把远端 metadata 当作授权条件。
 */
export interface RagflowRetrievalInput {
  question: string;
  datasetIds: string[];
  documentIds: string[];
  signal?: AbortSignal;
}

/** RAGFlow 检索响应经严格解析后的最小候选，不透传远端附加字段。 */
export interface RagflowRetrievalCandidate {
  chunkId: string;
  content: string;
  datasetId: string;
  documentId: string;
  documentName?: string;
  similarity?: number;
}
