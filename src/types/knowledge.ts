/**
 * 个人知识库相关类型
 */

/**
 * AI 生成时使用的知识来源
 */
export type KnowledgeGenerateSource = 'none' | 'ragflow' | 'ima';

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
 * ima OpenAPI 连接配置
 */
export interface ImaConfig {
  /** ima 官方 API 地址 */
  baseUrl: string;
  /** ima Client ID */
  clientId: string;
  /** ima API Key */
  apiKey: string;
  /** 默认读取多少条结果拼接成上下文 */
  topK: number;
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

/**
 * ima 知识库摘要
 */
export interface ImaKnowledgeBaseSummary {
  /** 知识库 ID */
  id: string;
  /** 知识库名称 */
  name: string;
  /** 知识库描述 */
  description?: string;
  /** 推荐问题 */
  recommendedQuestions?: string[];
}

/**
 * ima 检索到的可用知识片段
 */
export interface ImaKnowledgeChunk {
  /** 媒体 ID */
  mediaId: string;
  /** 条目标题 */
  title: string;
  /** 所属知识库 ID */
  knowledgeBaseId: string;
  /** 所属知识库名称 */
  knowledgeBaseName?: string;
  /** 所属文件夹 ID */
  parentFolderId?: string;
  /** 搜索高亮摘要 */
  highlightContent?: string;
  /** 面板里展示的预览文字 */
  preview: string;
  /** 供 AI 使用的正文 */
  content: string;
}

/**
 * ima 搜索面板命中项
 * 面板优先展示“原始命中”，避免正文读取失败时整条结果被过滤掉。
 */
export interface ImaKnowledgeSearchHit {
  /** 面板列表主键 */
  key: string;
  /** 命中类型 */
  kind: 'knowledge' | 'folder';
  /** 条目或文件夹标题 */
  title: string;
  /** 预览文字 */
  preview: string;
  /** 媒体 ID，仅知识条目有 */
  mediaId?: string;
  /** 文件夹 ID，仅文件夹命中有 */
  folderId?: string;
  /** 父文件夹 ID */
  parentFolderId?: string;
  /** 正文读取失败时的错误说明 */
  contentReadError?: string;
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

export const DEFAULT_IMA_CONFIG: ImaConfig = {
  baseUrl: 'https://ima.qq.com',
  clientId: '',
  apiKey: '',
  topK: 4,
};
