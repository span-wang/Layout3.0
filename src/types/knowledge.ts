/**
 * 个人知识库相关类型
 */

/**
 * AI 生成时使用的知识来源
 */
export type KnowledgeGenerateSource = 'none' | 'ragflow';

/**
 * AI 结果区 / 生成记录里展示的知识来源条目
 */
export interface KnowledgeSourceReference {
  /** 稳定来源 ID，用于结果区和记录面板渲染 */
  id: string;
  /** 来源类型 */
  sourceType: Exclude<KnowledgeGenerateSource, 'none'>;
  /** 来源主标题，例如文档名或知识条目标题 */
  title: string;
  /** 来源位置，例如数据集名或知识库名 */
  location?: string;
  /** 命中说明或补充说明 */
  detail?: string;
  /** 结果区展示的预览片段 */
  preview?: string;
}

/**
 * RAGFlow 连接配置
 */
export interface RagflowConfig {
  /** 服务地址，例如 http://127.0.0.1:9380 */
  baseUrl: string;
  /** RAGFlow API Key */
  apiKey: string;
  /** 最终返回给用户和 AI 的片段数 */
  resultLimit: number;
  /** 向量召回池大小 */
  recallTopK: number;
  /** 混合检索最低相似度阈值 */
  similarityThreshold: number;
  /** 向量分数权重，剩余权重由关键词分数承担 */
  vectorSimilarityWeight: number;
  /** 是否启用关键词召回 */
  enableKeyword: boolean;
  /** 是否让 RAGFlow 返回高亮摘要 */
  enableHighlight: boolean;
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
  /** 文档关键词或文档别名 */
  documentKeyword?: string;
  /** 综合相似度 */
  similarity?: number;
  /** 关键词相似度 */
  termSimilarity?: number;
  /** 向量相似度 */
  vectorSimilarity?: number;
  /** 高亮摘要 */
  highlight?: string;
  /** 重要关键词 */
  importantKeywords?: string[];
  /** 命中位置信息 */
  positions?: string[];
}

/**
 * RAGFlow 文档聚合信息
 */
export interface RagflowDocumentAggregate {
  /** 文档 ID */
  documentId: string;
  /** 文档名称 */
  documentName: string;
  /** 命中次数 */
  count: number;
}

/**
 * RAGFlow 检索结果
 */
export interface RagflowRetrievalResult {
  /** 检索片段 */
  chunks: RagflowChunk[];
  /** 文档聚合信息 */
  documentAggregates: RagflowDocumentAggregate[];
  /** 原始返回总条数 */
  total: number;
}

export const DEFAULT_RAGFLOW_CONFIG: RagflowConfig = {
  baseUrl: 'http://127.0.0.1:9380',
  apiKey: '',
  resultLimit: 6,
  recallTopK: 64,
  similarityThreshold: 0.2,
  vectorSimilarityWeight: 0.3,
  enableKeyword: true,
  enableHighlight: true,
};

export const DEFAULT_OPEN_NOTEBOOK_CONFIG: OpenNotebookConfig = {
  uiUrl: 'http://127.0.0.1:8502',
  apiUrl: 'http://127.0.0.1:5055',
};
