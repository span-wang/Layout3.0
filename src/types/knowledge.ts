/**
 * 个人知识库相关类型
 */

/**
 * RAGFlow 连接配置
 */
export interface RagflowConfig {
  /** 服务地址，例如 http://127.0.0.1:9380 */
  baseUrl: string;
  /** RAGFlow API Key */
  apiKey: string;
  /** 默认检索片段数 */
  topK: number;
}

/**
 * Open Notebook 连接配置
 */
export interface OpenNotebookConfig {
  /** Open Notebook Web 地址，例如 http://127.0.0.1:8502 */
  uiUrl: string;
  /** Open Notebook API 地址，例如 http://127.0.0.1:5055 */
  apiUrl: string;
}

/**
 * RAGFlow 数据集摘要
 */
export interface RagflowDatasetSummary {
  /** 数据集 ID */
  id: string;
  /** 数据集名称 */
  name: string;
  /** 数据集描述 */
  description?: string;
  /** 分块方式 */
  chunkMethod?: string;
  /** 文档数量 */
  documentCount?: number;
}

/**
 * RAGFlow 检索片段
 */
export interface RagflowChunk {
  /** 片段 ID */
  id: string;
  /** 片段正文 */
  content: string;
  /** 数据集 ID */
  datasetId: string;
  /** 文档 ID */
  documentId: string;
  /** 文档名称 */
  documentName?: string;
  /** 相似度 */
  similarity?: number;
}

export const DEFAULT_RAGFLOW_CONFIG: RagflowConfig = {
  baseUrl: 'http://127.0.0.1:9380',
  apiKey: '',
  topK: 6,
};

export const DEFAULT_OPEN_NOTEBOOK_CONFIG: OpenNotebookConfig = {
  uiUrl: 'http://127.0.0.1:8502',
  apiUrl: 'http://127.0.0.1:5055',
};
