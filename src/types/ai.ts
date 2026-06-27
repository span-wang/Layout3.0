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
  /** 自定义端点（如代理服务器地址） */
  baseUrl: string;
  /** 模型名称 */
  model: string;
  /** 生成温度（0-2），控制创造性 */
  temperature?: number;
}

/**
 * 生成内容类型
 */
export type GenerateType = 'lecture' | 'summary' | 'exercise' | 'exam';

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
export type AiPanelTab = 'generate' | 'optimize' | 'check' | 'settings';

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
