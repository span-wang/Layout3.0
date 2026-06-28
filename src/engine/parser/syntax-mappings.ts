import type { Root, Text, PhrasingContent } from 'mdast';
import type { TextMarkType } from '@/engine/document-model';

/**
 * 语法映射类型定义
 * 支持将各种文本标记语法映射为标准 marks
 */
export interface SyntaxMapping {
  /** 语法名称，用于调试和扩展 */
  name: string;
  /** 正则表达式，用于匹配文本中的语法模式 */
  pattern: RegExp;
  /** 映射后的 mark 类型 */
  markType: TextMarkType;
  /**
   * 可选：颜色值提取的捕获组索引
   * 用于 \color{red}{text} 这类语法，第一个捕获组是颜色值，第二个是文本内容
   */
  colorGroupIndex?: number;
}

/**
 * 可扩展的语法映射注册表
 *
 * 格式说明：
 * - pattern 必须包含一个捕获组 () 用于匹配被标记的文本内容
 * - match[1] 即为捕获的文本内容
 *
 * 当前支持的语法：
 * - ++text++   → underline（Markdown 原生语法）
 * - \\underline{text} → underline（LaTeX 语法）
 *
 * 后续扩展方式：
 * 在 MAPPINGS 数组中新增 SyntaxMapping 对象即可，
 * remark 插件会自动按注册顺序应用所有映射规则。
 */
export const SYNTAX_MAPPINGS: SyntaxMapping[] = [
  // 下划线语法
  {
    name: 'Markdown 下划线语法 (++)',
    pattern: /\+\+(.+?)\+\+/gs,
    markType: 'underline',
  },
  {
    name: 'LaTeX 下划线语法',
    // 只匹配 \underline{ 前缀，后续内容由 extractBalancedBraces 精确提取
    pattern: /\\underline\{/g,
    markType: 'underline',
  },
  // 后续可扩展更多语法：
  // {
  //   name: 'LaTeX 粗体语法',
  //   pattern: /\\textbf\{(.+?)\}/gs,
  //   markType: 'bold',
  // },
  // {
  //   name: 'LaTeX 斜体语法',
  //   pattern: /\\textit\{(.+?)\}/gs,
  //   markType: 'italic',
  // },
];

/**
 * 获取所有已注册的下划线语法映射
 */
export function getUnderlineMappings(): SyntaxMapping[] {
  return SYNTAX_MAPPINGS.filter((m) => m.markType === 'underline');
}

/**
 * 获取所有已注册的语法映射
 */
export function getAllMappings(): SyntaxMapping[] {
  return [...SYNTAX_MAPPINGS];
}

/**
 * 根据 mark 类型获取对应的所有映射
 */
export function getMappingsByMarkType(markType: SyntaxMapping['markType']): SyntaxMapping[] {
  return SYNTAX_MAPPINGS.filter((m) => m.markType === markType);
}
