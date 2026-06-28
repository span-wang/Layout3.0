/**
 * 语法映射配置模块
 *
 * 本模块负责定义和管理语法映射配置的数据模型、默认值和序列化逻辑。
 * 支持文本标记语法映射和块级指令映射两种类型。
 */

import type { LayoutDocument, TextMarkType } from './types';

/**
 * 文本标记语法映射配置
 *
 * 用于将各种文本标记语法（如 LaTeX 命令）映射为标准 TextMark
 *
 * @example
 * // 将 \textbf{text} 映射为 bold
 * {
 *   id: 'latex-bold',
 *   name: 'LaTeX 粗体',
 *   enabled: true,
 *   pattern: '\\\\textbf\\{(.+?)\\}',
 *   markType: 'bold'
 * }
 */
export interface TextMarkMapping {
  /** 唯一标识符 */
  id: string;
  /** 映射名称，用于显示和调试 */
  name: string;
  /** 是否启用该映射 */
  enabled: boolean;
  /** 正则表达式模式，必须包含一个捕获组用于匹配被标记的文本内容 */
  pattern: string;
  /** 映射后的 mark 类型 */
  markType: TextMarkType;
  /** 可选：描述信息 */
  description?: string;
  /** 可选：优先级，数字越小优先级越高 */
  priority?: number;
}

/**
 * 块级指令映射配置
 *
 * 用于将自定义块级指令（如 Obsidian callout :::note）映射为标准块类型
 *
 * @example
 * // 将 :::note 映射为 blockquote
 * {
 *   id: 'obsidian-note',
 *   name: 'Obsidian Note Callout',
 *   enabled: true,
 *   command: ':::note',
 *   targetBlockType: 'blockquote',
 *   metadata: { className: 'callout-note' }
 * }
 */
export interface BlockCommandMapping {
  /** 唯一标识符 */
  id: string;
  /** 映射名称，用于显示和调试 */
  name: string;
  /** 是否启用该映射 */
  enabled: boolean;
  /** 指令前缀（如 ":::" 表示 Obsidian callout） */
  command: string;
  /** 映射后的块类型 */
  targetBlockType: 'blockquote' | 'code' | 'paragraph';
  /** 可选：额外元数据 */
  metadata?: {
    /** 自定义 CSS 类名 */
    className?: string;
    /** 是否为 callout 类型 */
    isCallout?: boolean;
    /** 解析类型 */
    parseType?: 'obsidian' | 'custom';
  };
  /** 可选：描述信息 */
  description?: string;
  /** 可选：优先级 */
  priority?: number;
}

/**
 * 完整语法映射配置
 */
export interface SyntaxMappingConfig {
  /** 配置版本 */
  version: '1.0.0';
  /** 文本标记映射列表 */
  textMarkMappings: TextMarkMapping[];
  /** 块级指令映射列表 */
  blockCommandMappings: BlockCommandMapping[];
}

const validTextMarkTypes: TextMarkType[] = ['bold', 'italic', 'underline', 'strike', 'code', 'link'];
const validTargetBlockTypes: BlockCommandMapping['targetBlockType'][] = ['blockquote', 'code', 'paragraph'];

// ===================== 默认预置映射 =====================

/**
 * 默认文本标记映射列表
 *
 * 预置了常用的 Markdown 和 LaTeX 语法映射
 */
export const DEFAULT_TEXT_MARK_MAPPINGS: TextMarkMapping[] = [
  {
    id: 'md-underline',
    name: 'Markdown 下划线 (++)',
    enabled: true,
    pattern: '\\+\\+(.+?)\\+\\+',
    markType: 'underline',
    description: '将 ++text++ 映射为下划线文本',
    priority: 10,
  },
  {
    id: 'latex-underline',
    name: 'LaTeX 下划线 \\underline{}',
    enabled: true,
    pattern: '\\\\underline\\{',
    markType: 'underline',
    description: '将 \\underline{text} 映射为下划线文本',
    priority: 11,
  },
  {
    id: 'latex-bold',
    name: 'LaTeX 粗体 \\textbf{}',
    enabled: true,
    pattern: '\\\\textbf\\{(.+?)\\}',
    markType: 'bold',
    description: '将 \\textbf{text} 映射为粗体文本',
    priority: 20,
  },
  {
    id: 'latex-italic',
    name: 'LaTeX 斜体 \\textit{}',
    enabled: true,
    pattern: '\\\\textit\\{(.+?)\\}',
    markType: 'italic',
    description: '将 \\textit{text} 映射为斜体文本',
    priority: 21,
  },
  {
    id: 'latex-strike',
    name: 'LaTeX 删除线 \\sout{}',
    enabled: true,
    pattern: '\\\\sout\\{(.+?)\\}',
    markType: 'strike',
    description: '将 \\sout{text} 映射为删除线文本',
    priority: 22,
  },
];

/**
 * 默认块级指令映射列表
 *
 * 预置了常用的块级指令映射
 */
export const DEFAULT_BLOCK_COMMAND_MAPPINGS: BlockCommandMapping[] = [
  {
    id: 'obsidian-callout-note',
    name: 'Obsidian Note Callout',
    enabled: true,
    command: ':::note',
    targetBlockType: 'blockquote',
    metadata: {
      className: 'callout callout-note',
      isCallout: true,
      parseType: 'obsidian',
    },
    description: '将 :::note 解析为引用块',
    priority: 10,
  },
  {
    id: 'obsidian-callout-warning',
    name: 'Obsidian Warning Callout',
    enabled: true,
    command: ':::warning',
    targetBlockType: 'blockquote',
    metadata: {
      className: 'callout callout-warning',
      isCallout: true,
      parseType: 'obsidian',
    },
    description: '将 :::warning 解析为引用块',
    priority: 11,
  },
  {
    id: 'obsidian-callout-tip',
    name: 'Obsidian Tip Callout',
    enabled: true,
    command: ':::tip',
    targetBlockType: 'blockquote',
    metadata: {
      className: 'callout callout-tip',
      isCallout: true,
      parseType: 'obsidian',
    },
    description: '将 :::tip 解析为引用块',
    priority: 12,
  },
  {
    id: 'obsidian-callout-info',
    name: 'Obsidian Info Callout',
    enabled: true,
    command: ':::info',
    targetBlockType: 'blockquote',
    metadata: {
      className: 'callout callout-info',
      isCallout: true,
      parseType: 'obsidian',
    },
    description: '将 :::info 解析为引用块',
    priority: 13,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cloneTextMarkMapping(mapping: TextMarkMapping): TextMarkMapping {
  return { ...mapping };
}

function cloneBlockCommandMapping(mapping: BlockCommandMapping): BlockCommandMapping {
  return {
    ...mapping,
    metadata: mapping.metadata ? { ...mapping.metadata } : undefined,
  };
}

/**
 * 获取默认语法映射配置
 */
export function getDefaultSyntaxMappingConfig(): SyntaxMappingConfig {
  return {
    version: '1.0.0',
    textMarkMappings: DEFAULT_TEXT_MARK_MAPPINGS.map(cloneTextMarkMapping),
    blockCommandMappings: DEFAULT_BLOCK_COMMAND_MAPPINGS.map(cloneBlockCommandMapping),
  };
}

function hasValidRegexPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function isValidTextMarkType(value: unknown): value is TextMarkType {
  return typeof value === 'string' && validTextMarkTypes.includes(value as TextMarkType);
}

function normalizeTextMarkMapping(value: unknown): TextMarkMapping | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.pattern !== 'string' ||
    !isValidTextMarkType(value.markType) ||
    !hasValidRegexPattern(value.pattern)
  ) {
    return null;
  }

  const mapping: TextMarkMapping = {
    id: value.id,
    name: value.name,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    pattern: value.pattern,
    markType: value.markType,
  };

  if (typeof value.description === 'string') {
    mapping.description = value.description;
  }

  if (typeof value.priority === 'number') {
    mapping.priority = value.priority;
  }

  return mapping;
}

function isValidTargetBlockType(value: unknown): value is BlockCommandMapping['targetBlockType'] {
  return typeof value === 'string' && validTargetBlockTypes.includes(value as BlockCommandMapping['targetBlockType']);
}

function normalizeBlockCommandMapping(value: unknown): BlockCommandMapping | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.command !== 'string' ||
    !isValidTargetBlockType(value.targetBlockType)
  ) {
    return null;
  }

  const mapping: BlockCommandMapping = {
    id: value.id,
    name: value.name,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    command: value.command,
    targetBlockType: value.targetBlockType,
  };

  if (isRecord(value.metadata)) {
    mapping.metadata = {
      className: typeof value.metadata.className === 'string' ? value.metadata.className : undefined,
      isCallout: typeof value.metadata.isCallout === 'boolean' ? value.metadata.isCallout : undefined,
      parseType:
        value.metadata.parseType === 'obsidian' || value.metadata.parseType === 'custom'
          ? value.metadata.parseType
          : undefined,
    };
  }

  if (typeof value.description === 'string') {
    mapping.description = value.description;
  }

  if (typeof value.priority === 'number') {
    mapping.priority = value.priority;
  }

  return mapping;
}

function mergeMappingsById<T extends { id: string }>(defaults: T[], savedValues: unknown[], normalize: (value: unknown) => T | null): T[] {
  const result = [...defaults];
  const indexById = new Map(result.map((mapping, index) => [mapping.id, index]));

  for (const rawMapping of savedValues) {
    const mapping = normalize(rawMapping);
    if (!mapping) {
      continue;
    }

    const existingIndex = indexById.get(mapping.id);
    if (existingIndex === undefined) {
      indexById.set(mapping.id, result.length);
      result.push(mapping);
      continue;
    }

    // 默认规则允许被文档配置覆盖启用状态、正则和说明；缺失默认规则时会自动补回。
    result[existingIndex] = { ...result[existingIndex], ...mapping };
  }

  return result;
}

/**
 * 规范化语法映射配置。
 *
 * 旧文件或异常草稿可能缺少默认规则，或只保存了自定义规则；这里统一补齐默认规则并保留自定义规则。
 */
export function normalizeSyntaxMappingConfig(config?: unknown): SyntaxMappingConfig {
  const defaultConfig = getDefaultSyntaxMappingConfig();
  const rawTextMarkMappings =
    isRecord(config) && Array.isArray(config.textMarkMappings) ? config.textMarkMappings : [];
  const rawBlockCommandMappings =
    isRecord(config) && Array.isArray(config.blockCommandMappings) ? config.blockCommandMappings : [];

  return {
    version: '1.0.0',
    textMarkMappings: mergeMappingsById(
      defaultConfig.textMarkMappings,
      rawTextMarkMappings,
      normalizeTextMarkMapping,
    ),
    blockCommandMappings: mergeMappingsById(
      defaultConfig.blockCommandMappings,
      rawBlockCommandMappings,
      normalizeBlockCommandMapping,
    ),
  };
}

/**
 * 规范化文档中的语法映射配置，并兼容曾经误写到 metadata 的旧字段。
 */
export function normalizeLayoutDocumentSyntaxMappingConfig(document: LayoutDocument): LayoutDocument {
  const legacyDocument = document as LayoutDocument & { metadata?: unknown };
  const legacyConfig = isRecord(legacyDocument.metadata)
    ? legacyDocument.metadata.syntaxMappingConfig
    : undefined;
  const { metadata: _legacyMetadata, ...documentWithoutLegacy } = legacyDocument;

  return {
    ...documentWithoutLegacy,
    meta: {
      ...document.meta,
      syntaxMappingConfig: normalizeSyntaxMappingConfig(document.meta.syntaxMappingConfig ?? legacyConfig),
    },
  };
}

/**
 * 获取默认启用的文本标记映射
 */
export function getEnabledTextMarkMappings(): TextMarkMapping[] {
  return DEFAULT_TEXT_MARK_MAPPINGS.filter((m) => m.enabled);
}

/**
 * 获取默认启用的块级指令映射
 */
export function getEnabledBlockCommandMappings(): BlockCommandMapping[] {
  return DEFAULT_BLOCK_COMMAND_MAPPINGS.filter((m) => m.enabled);
}

/**
 * 验证文本标记映射配置是否有效
 */
export function validateTextMarkMapping(mapping: Partial<TextMarkMapping>): string[] {
  const errors: string[] = [];

  if (!mapping.id || typeof mapping.id !== 'string') {
    errors.push('缺少有效的 id');
  }

  if (!mapping.name || typeof mapping.name !== 'string') {
    errors.push('缺少有效的名称');
  }

  if (!mapping.pattern || typeof mapping.pattern !== 'string') {
    errors.push('缺少有效的正则表达式');
  } else {
    try {
      new RegExp(mapping.pattern);
    } catch {
      errors.push('正则表达式无效');
    }
  }

  if (!mapping.markType || !validTextMarkTypes.includes(mapping.markType)) {
    errors.push(`markType 无效，有效值为: ${validTextMarkTypes.join(', ')}`);
  }

  return errors;
}

/**
 * 判断正则表达式里是否存在可取出内容的捕获组。
 *
 * 这里会跳过 `(?:...)`、`(?=...)`、`(?!...)`、`(?<=...)`、`(?<!...)` 这类非捕获/断言写法；
 * AI 识别和手动新增规则都需要至少一个捕获组，解析器会用第一个捕获组作为被标记文本。
 */
export function hasRegexCaptureGroup(pattern: string): boolean {
  let isEscaped = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char !== '(') {
      continue;
    }

    const nextChar = pattern[index + 1];
    if (nextChar !== '?') {
      return true;
    }

    const prefix = pattern.slice(index, index + 4);
    if (prefix.startsWith('(?<') && prefix !== '(?<=' && prefix !== '(?<!') {
      return true;
    }
  }

  return false;
}

/**
 * 验证块级指令映射配置是否有效
 */
export function validateBlockCommandMapping(mapping: Partial<BlockCommandMapping>): string[] {
  const errors: string[] = [];

  if (!mapping.id || typeof mapping.id !== 'string') {
    errors.push('缺少有效的 id');
  }

  if (!mapping.name || typeof mapping.name !== 'string') {
    errors.push('缺少有效的名称');
  }

  if (!mapping.command || typeof mapping.command !== 'string') {
    errors.push('缺少有效的指令');
  }

  if (!mapping.targetBlockType || !validTargetBlockTypes.includes(mapping.targetBlockType)) {
    errors.push(`targetBlockType 无效，有效值为: ${validTargetBlockTypes.join(', ')}`);
  }

  return errors;
}

/**
 * 从 JSON 字符串解析语法映射配置
 */
export function parseSyntaxMappingConfig(json: string): SyntaxMappingConfig {
  try {
    const parsed = JSON.parse(json);

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('配置格式无效');
    }

    if (parsed.version !== '1.0.0') {
      throw new Error(`不支持的配置版本: ${parsed.version}`);
    }

    return normalizeSyntaxMappingConfig(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`语法映射配置解析失败：${message}`);
  }
}

/**
 * 将语法映射配置序列化为 JSON 字符串
 */
export function serializeSyntaxMappingConfig(config: SyntaxMappingConfig): string {
  return JSON.stringify(config, null, 2);
}

/**
 * 生成唯一映射 ID
 */
export function generateMappingId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}
