/**
 * 语法映射配置模块
 *
 * 本模块负责定义和管理语法映射配置的数据模型、默认值和序列化逻辑。
 * 支持文本标记语法映射和块级指令映射两种类型。
 */

import type { TextMarkType } from './types';

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

/**
 * 获取默认语法映射配置
 */
export function getDefaultSyntaxMappingConfig(): SyntaxMappingConfig {
  return {
    version: '1.0.0',
    textMarkMappings: [...DEFAULT_TEXT_MARK_MAPPINGS],
    blockCommandMappings: [...DEFAULT_BLOCK_COMMAND_MAPPINGS],
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

  const validMarkTypes: TextMarkType[] = ['bold', 'italic', 'underline', 'strike', 'code', 'link'];
  if (!mapping.markType || !validMarkTypes.includes(mapping.markType)) {
    errors.push(`markType 无效，有效值为: ${validMarkTypes.join(', ')}`);
  }

  return errors;
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

  const validTargetTypes = ['blockquote', 'code', 'paragraph'];
  if (!mapping.targetBlockType || !validTargetTypes.includes(mapping.targetBlockType)) {
    errors.push(`targetBlockType 无效，有效值为: ${validTargetTypes.join(', ')}`);
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

    return {
      version: '1.0.0',
      textMarkMappings: Array.isArray(parsed.textMarkMappings) ? parsed.textMarkMappings : [],
      blockCommandMappings: Array.isArray(parsed.blockCommandMappings)
        ? parsed.blockCommandMappings
        : [],
    };
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
