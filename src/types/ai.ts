/**
 * AI 功能类型定义
 * 支持 OpenAI / Anthropic / 自定义 Provider
 */

// AI Provider 类型
export type AiProvider = 'openai' | 'anthropic' | 'custom';

/**
 * AI 配置接口
 */
export interface AiConfig {
  /** AI 服务提供商 */
  provider: AiProvider;
  /** API Key */
  apiKey: string;
  /** API 端点（Base URL） */
  baseUrl: string;
  /** 模型名称 */
  model: string;
  /** 生成温度（0-2），控制创造性 */
  temperature?: number;
}

/**
 * AI 配置档案
 * 在本机保存多套配置时使用，API 调用仍只需要 AiConfig 字段。
 */
export interface AiConfigProfile extends AiConfig {
  /** 配置唯一 ID，用于任务功能分配 */
  id: string;
  /** 用户可读的配置名称 */
  name: string;
  /** 创建时间 ISO 字符串 */
  createdAt: string;
  /** 更新时间 ISO 字符串 */
  updatedAt: string;
}

/**
 * 可分配 AI 配置的任务功能
 */
export type AiTaskType = 'generate' | 'optimize' | 'check' | 'regexRecognition';

/**
 * AI 任务功能到配置 ID 的映射
 */
export type AiTaskConfigAssignments = Record<AiTaskType, string | null>;

/**
 * 生成内容类型
 */
export type GenerateType =
  | 'lecture'
  | 'summary'
  | 'exercise'
  | 'exam'
  | 'xiaohongshuTitle'
  | 'xiaohongshuCopy'
  | 'xiaohongshuCover';

/**
 * 生成选项
 */
export interface GenerateOptions {
  /** 生成类型 */
  type: GenerateType;
  /** 主题 */
  topic: string;
  /** 年级（可选） */
  grade?: string;
  /** 科目（可选） */
  subject?: string;
  /** 内容长度 */
  length?: 'short' | 'medium' | 'long';
  /** 小红书使用：文章原始标题 */
  articleTitle?: string;
  /** 小红书使用：当前文章正文内容 */
  articleContent?: string;
  /** 小红书使用：用户选定或填写的推荐标题 */
  selectedTitle?: string;
  /** 小红书使用：用户选定或生成的小红书文案 */
  selectedCopy?: string;
  /** 个人知识库提供的检索上下文 */
  knowledgeContext?: string;
}

/**
 * AI 生成记录
 * 记录正文落在工作区文件中，前端 store 只保存当前展示所需的列表。
 */
export interface AiGenerationRecord {
  /** 记录 ID */
  id: string;
  /** 生成类型 */
  type: GenerateType;
  /** 生成类型中文名 */
  typeLabel: string;
  /** 生成主题 */
  topic: string;
  /** 年级（可选） */
  grade?: string;
  /** 科目（可选） */
  subject?: string;
  /** 内容长度 */
  length?: 'short' | 'medium' | 'long';
  /** 内容长度中文名 */
  lengthLabel?: string;
  /** 本次使用的 Provider，仅记录名称，不记录密钥 */
  provider?: AiProvider;
  /** 本次使用的模型名称 */
  model?: string;
  /** 完整生成内容 */
  content: string;
  /** 创建时间 ISO 字符串 */
  createdAt: string;
}

/**
 * AI 生成记录文件夹读取结果
 */
export interface AiGenerationRecordDirectoryResult {
  /** 记录文件夹完整路径 */
  recordDirectoryPath: string;
  /** 生成记录列表 */
  records: AiGenerationRecord[];
}

/**
 * 优化类型
 */
export type OptimizeMode = 'polish' | 'rewrite' | 'summary' | 'expand' | 'simplify' | 'formalize';

/**
 * 优化选项
 */
export interface OptimizeOptions {
  /** 要优化的文本 */
  text: string;
  /** 优化模式 */
  mode: OptimizeMode;
  /** 风格（可选） */
  style?: 'lecture' | 'notes';
}

/**
 * AI 检查结果严重程度
 */
export type AiCheckSeverity = 'error' | 'warning' | 'suggestion';

/**
 * 单个检查结果项
 */
export interface AiCheckResultItem {
  /** 结果 ID */
  id: string;
  /** 所属页面 */
  page: number;
  /** 严重程度 */
  severity: AiCheckSeverity;
  /** 关联元素 ID（可选） */
  elementId?: string;
  /** 问题描述 */
  message: string;
  /** 修复建议 */
  suggestion: string;
  /** 是否可自动修复 */
  autoFixable: boolean;
}

/**
 * 检查结果
 */
export interface AiCheckResult {
  /** 检查结果列表 */
  items: AiCheckResultItem[];
  /** 检查时间 */
  checkedAt: number;
}

/**
 * AI 操作状态
 */
export type AiOperationStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * AI 面板 Tab 类型
 */
export type AiPanelTab = 'generate' | 'optimize' | 'check' | 'pagination' | 'settings';

/**
 * 分页审核判断结果
 */
export type PaginationReviewVerdict = 'correct' | 'incorrect' | 'unsure';

/**
 * 分页问题标签
 */
export type PaginationProblemTag =
  | 'blankSpaceTooLarge'
  | 'headingOrphan'
  | 'paragraphShortTail'
  | 'nextPageShortHead'
  | 'tableJumpedWhole'
  | 'tableCrossPageHardToRead'
  | 'imagePositionBad'
  | 'equationPositionBad'
  | 'columnUnbalanced'
  | 'pageJumpTooLarge'
  | 'bottomContentClipped';

/**
 * 分页问题严重度
 */
export type PaginationProblemSeverity = 'low' | 'medium' | 'high';

/**
 * 分页根因分类
 */
export type PaginationRootCause =
  | 'heightEstimationError'
  | 'lineBreakMismatch'
  | 'bottomSafeAreaTooSmall'
  | 'headingBindingTooWeak'
  | 'tailSplitPenaltyTooWeak'
  | 'tableSplitStrategyTooConservative'
  | 'columnBalanceStrategyWeak';

/**
 * 单侧分页摘要
 */
export interface PaginationReviewSide {
  blockId: string;
  blockType: string;
  textPreview: string;
}

/**
 * 分页点审核项
 */
export interface PaginationReviewItem {
  breakId: string;
  pageNumber: number;
  breakIndex: number;
  pageRemainingHeightPx: number;
  pageFillRatio: number;
  before: PaginationReviewSide;
  after: PaginationReviewSide;
  verdict: PaginationReviewVerdict | null;
  problemTags: PaginationProblemTag[];
  severity: PaginationProblemSeverity | null;
}

/**
 * 分页训练样本
 */
export interface PaginationTrainingSample {
  sampleId: string;
  breakId: string;
  documentId: string;
  documentTitle: string;
  pageNumber: number;
  breakIndex: number;
  verdict: PaginationReviewVerdict;
  problemTags: PaginationProblemTag[];
  severity: PaginationProblemSeverity | null;
  pageRemainingHeightPx: number;
  pageFillRatio: number;
  before: PaginationReviewSide;
  after: PaginationReviewSide;
  rootCauses: PaginationRootCause[];
}

/**
 * 分页批次中的文章记录
 */
export interface PaginationBatchDocumentEntry {
  documentId: string;
  documentTitle: string;
  addedAt: string;
  samples: PaginationTrainingSample[];
}

/**
 * 分页批次根因统计项
 */
export interface PaginationBatchRootCauseStat {
  cause: PaginationRootCause;
  sampleCount: number;
  severityScore: number;
  affectedBreakCount: number;
}

/**
 * 分页批次分析结果
 */
export const PAGINATION_BATCH_READY_DOCUMENT_COUNT = 1;

export interface PaginationBatchAnalysis {
  batchId: string;
  documentCount: number;
  isReady: boolean;
  documents: PaginationBatchDocumentEntry[];
  rootCauseStats: PaginationBatchRootCauseStat[];
}

/**
 * 分页运行时优化参数
 */
export interface PaginationOptimizationSettings {
  bottomSafeAreaPx: number;
  heightReserveFactor: number;
  measuredLineBreakPriorityBoost: number;
  headingKeepWithNextBoost: number;
  shortTailPenaltyBoost: number;
  tableRowSplitPriorityBoost: number;
  columnBalancePenaltyBoost: number;
}

/**
 * AI 操作类型（用于日志记录）
 */
export type AiActionType = 'generate' | 'optimize' | 'check';

/**
 * 流式回调函数类型
 */
export type StreamCallback = (content: string) => void;

/**
 * 默认 AI 配置
 */
export const DEFAULT_AI_CONFIG: Partial<AiConfig> = {
  temperature: 0.7,
};

/**
 * 生成类型中文映射
 */
export const GENERATE_TYPE_LABELS: Record<GenerateType, string> = {
  lecture: '讲义',
  summary: '知识点总结',
  exercise: '练习题',
  exam: '试卷初稿',
  xiaohongshuTitle: '小红书标题',
  xiaohongshuCopy: '小红书文案',
  xiaohongshuCover: '小红书主图方案',
};

/**
 * 优化模式中文映射
 */
export const OPTIMIZE_MODE_LABELS: Record<OptimizeMode, string> = {
  polish: '润色',
  rewrite: '改写',
  summary: '总结',
  expand: '扩写',
  simplify: '降低难度',
  formalize: '提高正式度',
};

/**
 * 内容长度中文映射
 */
export const LENGTH_LABELS: Record<string, string> = {
  short: '简短',
  medium: '中等',
  long: '详细',
};

/**
 * 检查严重程度中文映射
 */
export const SEVERITY_LABELS: Record<AiCheckSeverity, string> = {
  error: '错误',
  warning: '警告',
  suggestion: '建议',
};

/**
 * Provider 中文名称映射
 */
export const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  custom: '自定义',
};

/**
 * AI 任务功能中文映射
 */
export const AI_TASK_LABELS: Record<AiTaskType, string> = {
  generate: '内容生成',
  optimize: '文本优化',
  check: '文档检查',
  regexRecognition: 'AI 正则识别',
};

/**
 * 分页问题标签中文映射
 */
export const PAGINATION_PROBLEM_TAG_LABELS: Record<PaginationProblemTag, string> = {
  blankSpaceTooLarge: '页尾留白过大',
  headingOrphan: '标题孤立',
  paragraphShortTail: '段落短尾',
  nextPageShortHead: '下一页开头过短',
  tableJumpedWhole: '表格整块跳页',
  tableCrossPageHardToRead: '表格跨页难读',
  imagePositionBad: '图片位置不合理',
  equationPositionBad: '公式位置不合理',
  columnUnbalanced: '多栏不均衡',
  pageJumpTooLarge: '页码跳动过大',
  bottomContentClipped: '页底内容被裁切',
};

/**
 * 分页问题严重度中文映射
 */
export const PAGINATION_PROBLEM_SEVERITY_LABELS: Record<PaginationProblemSeverity, string> = {
  low: '轻微',
  medium: '中等',
  high: '严重',
};

/**
 * 分页根因中文映射
 */
export const PAGINATION_ROOT_CAUSE_LABELS: Record<PaginationRootCause, string> = {
  heightEstimationError: '高度计算不正确',
  lineBreakMismatch: '真实换行与估算换行不一致',
  bottomSafeAreaTooSmall: '页底安全边界不足',
  headingBindingTooWeak: '标题与下文绑定过弱',
  tailSplitPenaltyTooWeak: '短尾惩罚不足',
  tableSplitStrategyTooConservative: '表格拆分策略过保守',
  columnBalanceStrategyWeak: '多栏平衡策略不足',
};

/**
 * 默认任务功能分配，具体配置 ID 会在加载配置时补齐。
 */
export const DEFAULT_AI_TASK_ASSIGNMENTS: AiTaskConfigAssignments = {
  generate: null,
  optimize: null,
  check: null,
  regexRecognition: null,
};

/**
 * Provider 默认模型映射
 */
export const PROVIDER_DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  custom: '',
};

/**
 * 检查提示模板（用于发送给 AI）
 */
export const CHECK_PROMPT_TEMPLATE = `你是一个专业的教育内容排版检查助手。请检查以下 Markdown 文档，关注以下方面：

1. **标题层级**：检查 H1-H6 标题层级是否合理，避免跳级或混乱
2. **段落长度**：检查是否有过长段落（建议超过 500 字应拆分）
3. **图片说明**：检查图片是否配有 alt 文字说明
4. **表格宽度**：检查表格是否过宽可能超出页面
5. **分页美观**：检查分页点是否合理，标题是否出现在页尾

请用 JSON 格式返回检查结果：
{
  "items": [
    {
      "page": 1,
      "severity": "warning",
      "message": "问题描述",
      "suggestion": "修复建议",
      "autoFixable": true
    }
  ]
}

文档内容：
{{content}}

请只返回 JSON，不要有其他文字。`;
