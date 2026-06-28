import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { remarkTextMarks } from './remark-text-marks';
import type { LayoutDocument } from '@/engine/document-model';
import { normalizeSyntaxMappingConfig } from '@/engine/document-model';

/**
 * 创建默认的 Remark 处理器
 *
 * 使用预定义的默认语法映射配置（包括 ++text++ 和 \underline{} 等）
 */
export function createRemarkProcessor(config?: LayoutDocument['meta']['syntaxMappingConfig']) {
  return createConfiguredRemarkProcessor(config);
}

function createGlobalTextMarkPattern(pattern: string): RegExp {
  const parsedPattern = new RegExp(pattern);
  const flags = parsedPattern.flags;
  const globalFlags = `${flags.includes('g') ? flags : `${flags}g`}${flags.includes('s') ? '' : 's'}`;

  // 配置面板保存的是正则 source 字符串；解析文本时必须全局查找，否则 while(exec) 会反复命中同一处。
  return new RegExp(parsedPattern.source, globalFlags);
}

/**
 * 创建配置化的 Remark 处理器
 *
 * 使用自定义的语法映射配置
 *
 * @param config 语法映射配置（可选，不提供时使用默认配置）
 */
export function createConfiguredRemarkProcessor(config?: LayoutDocument['meta']['syntaxMappingConfig']) {
  // 解析入口统一规范化配置，避免旧文件缺少默认规则或自定义规则时造成面板和解析口径分叉。
  const syntaxConfig = normalizeSyntaxMappingConfig(config);

  // 将 TextMarkMapping 转换为 SyntaxMapping（兼容现有 remark-text-marks）
  const enabledMappings = syntaxConfig.textMarkMappings
    .filter((m) => m.enabled)
    .map((m) => ({
      name: m.name,
      pattern: createGlobalTextMarkPattern(m.pattern),
      markType: m.markType,
      colorGroupIndex: m.colorGroupIndex,
    }));

  // 创建文本标记插件实例
  const textMarksPlugin = remarkTextMarks(enabledMappings);

  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    // remarkTextMarks 必须在所有解析插件之后运行，
    // 确保文本标记不会被其他插件提前拆分
    .use(textMarksPlugin);
}

/**
 * 导出原始的 remarkTextMarks 供向后兼容
 * @deprecated 使用 createRemarkProcessor 或 createConfiguredRemarkProcessor
 */
export { remarkTextMarks as rawRemarkTextMarks } from './remark-text-marks';
