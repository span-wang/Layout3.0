/**
 * 语法映射预处理器统一入口
 *
 * 本模块提供统一的语法映射处理流程：
 * 1. 块级指令预处理（自定义指令 → 标准块）
 * 2. 文本标记预处理（自定义文本语法 → 标准 marks）
 *
 * 在 Remark 解析之前执行这些预处理，确保：
 * - 自定义语法可以被正确解析
 * - 映射配置可以动态调整
 */

import type { SyntaxMappingConfig, TextMarkMapping, BlockCommandMapping } from '@/engine/document-model';
import { createRemarkTextMarksPlugin } from './text-mark-mappings';
import { createBlockCommandPreprocessor } from './block-command-mappings';

/**
 * 预处理器配置
 */
export interface PreprocessorConfig {
  /** 是否启用块级指令预处理 */
  enableBlockCommands: boolean;
  /** 是否启用文本标记预处理 */
  enableTextMarks: boolean;
}

/**
 * 默认预处理器配置
 */
export const DEFAULT_PREPROCESSOR_CONFIG: PreprocessorConfig = {
  enableBlockCommands: true,
  enableTextMarks: true,
};

/**
 * 获取启用的文本标记映射
 */
export function getEnabledTextMarkMappings(config: SyntaxMappingConfig): TextMarkMapping[] {
  return config.textMarkMappings.filter((m) => m.enabled);
}

/**
 * 获取启用的块级指令映射
 */
export function getEnabledBlockCommandMappings(config: SyntaxMappingConfig): BlockCommandMapping[] {
  return config.blockCommandMappings.filter((m) => m.enabled);
}

/**
 * 创建文本标记预处理插件
 */
export function createTextMarkPlugin(config: SyntaxMappingConfig) {
  const enabledMappings = getEnabledTextMarkMappings(config);
  return createRemarkTextMarksPlugin(enabledMappings);
}

/**
 * 创建块级指令预处理器
 */
export function createBlockCommandPreprocessorFn(config: SyntaxMappingConfig) {
  const enabledMappings = getEnabledBlockCommandMappings(config);
  return createBlockCommandPreprocessor(enabledMappings);
}

/**
 * 预处理文本
 *
 * @param text 原始 Markdown 文本
 * @param config 语法映射配置
 * @returns 预处理后的文本
 */
export function preprocessMarkdown(
  text: string,
  config: SyntaxMappingConfig,
): string {
  // 只执行块级指令预处理，因为文本标记预处理是在 remark 插件中进行的
  const enabledBlockMappings = getEnabledBlockCommandMappings(config);
  if (enabledBlockMappings.length === 0) {
    return text;
  }

  return preprocessBlockCommands(text, enabledBlockMappings);
}

/**
 * 执行块级指令预处理
 */
function preprocessBlockCommands(
  text: string,
  mappings: BlockCommandMapping[],
): string {
  return createBlockCommandPreprocessor(mappings)(text);
}

/**
 * 导出子模块供外部使用
 */
export { createRemarkTextMarksPlugin } from './text-mark-mappings';
export type { UnderlineNode } from './text-mark-mappings';
export {
  createBlockCommandPreprocessor,
  findBlockCommands,
  validateBlockCommandMappings,
} from './block-command-mappings';
