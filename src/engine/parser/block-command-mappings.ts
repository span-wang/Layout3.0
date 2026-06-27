/**
 * 块级指令预处理器
 *
 * 在 Remark 解析之前处理自定义块级指令，将它们转换为标准 Markdown 块。
 * 支持 Obsidian callout 语法（如 :::note、:::warning 等）。
 *
 * 处理流程：
 * 1. 识别自定义指令开始标记（如 :::note）
 * 2. 收集指令内容
 * 3. 将内容转换为对应的标准块类型（如 blockquote）
 */

import type { BlockCommandMapping } from '@/engine/document-model';

/**
 * 块级指令块信息
 */
export interface CommandBlock {
  /** 原始文本 */
  original: string;
  /** 指令名称 */
  command: string;
  /** 指令类型（如 'note', 'warning'） */
  type: string;
  /** 指令内容 */
  content: string;
  /** 指令开始位置 */
  startLine: number;
  /** 指令结束位置 */
  endLine: number;
  /** 目标块类型（由 findBlockCommands 填充） */
  targetBlockType?: 'blockquote' | 'code' | 'paragraph';
  /** 自定义元数据（由 findBlockCommands 填充） */
  metadata?: Record<string, unknown>;
}

/**
 * 块级指令匹配结果
 */
export interface BlockCommandMatch {
  /** 匹配到的块 */
  block: CommandBlock;
  /** 在原文中的起始位置 */
  startOffset: number;
  /** 在原文中的结束位置 */
  endOffset: number;
}

/**
 * 解析 Obsidian 风格的 callout 块
 * 格式：
 * :::note 可选标题
 * 内容
 * :::
 */
function parseObsidianCallout(
  text: string,
  startPos: number,
  command: string,
): CommandBlock | null {
  // 找到命令开始标记的结束位置
  const commandMatch = text.slice(startPos).match(new RegExp(`^${escapeRegExp(command)}(\\s+(.*))?$`, 'm'));
  if (!commandMatch || commandMatch.index === undefined) {
    return null;
  }

  const commandLineEnd = startPos + commandMatch[0].length;
  const restOfContent = text.slice(commandLineEnd);

  // 找到结束标记 :::
  const closingPattern = /^:::/m;
  const closingMatch = restOfContent.match(closingPattern);

  if (!closingMatch || closingMatch.index === undefined) {
    return null;
  }

  const contentStart = commandLineEnd;
  const contentEnd = startPos + commandMatch.index + commandMatch[0].length + closingMatch.index;
  const content = text.slice(contentStart, contentEnd).trim();

  // 计算行号
  const beforeText = text.slice(0, startPos);
  const lineBreaks = beforeText.match(/\n/g);
  const startLine = (lineBreaks?.length ?? 0) + 1;
  const contentLines = content.split('\n').length;
  const endLine = startLine + contentLines + 1; // +1 是结束标记行

  // 提取 callout 类型
  const typeMatch = command.match(/^:::(.+?)(?:\s|$)/);
  const calloutType = typeMatch ? typeMatch[1] : 'note';

  return {
    original: text.slice(startPos, contentEnd + 3), // 包含结束标记
    command: command,
    type: calloutType,
    content: content,
    startLine,
    endLine,
  };
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 在文本中查找所有块级指令
 */
export function findBlockCommands(
  text: string,
  mappings: BlockCommandMapping[],
): BlockCommandMatch[] {
  const matches: BlockCommandMatch[] = [];

  // 按优先级排序映射
  const sortedMappings = [...mappings]
    .filter((m) => m.enabled)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const mapping of sortedMappings) {
    if (!mapping.enabled) continue;

    const pattern = new RegExp(`^${escapeRegExp(mapping.command)}(?:\\s+.*)?$`, 'gm');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      // 解析 callout 块
      const block = parseObsidianCallout(text, match.index, match[0]);
      if (block) {
        // 添加映射信息到块对象
        block.targetBlockType = mapping.targetBlockType;
        block.metadata = mapping.metadata;
        matches.push({
          block,
          startOffset: match.index,
          endOffset: match.index + block.original.length,
        });
      }
    }
  }

  // 按起始位置排序
  matches.sort((a, b) => a.startOffset - b.startOffset);

  // 移除重叠匹配（只保留第一个）
  const filtered: BlockCommandMatch[] = [];
  let lastEnd = 0;

  for (const m of matches) {
    if (m.startOffset >= lastEnd) {
      filtered.push(m);
      lastEnd = m.endOffset;
    }
  }

  return filtered;
}

/**
 * 将 Obsidian callout 转换为 Markdown blockquote
 *
 * 示例输入：
 * :::note
 * 这是内容
 * :::
 *
 * 示例输出：
 * > 这是内容
 */
function convertCalloutToBlockquote(block: CommandBlock): string {
  const lines = block.content.split('\n');
  return lines.map((line) => `> ${line}`).join('\n');
}

/**
 * 将块级指令转换为标准 Markdown
 *
 * @param text 原始文本
 * @param mappings 块级指令映射配置
 * @returns 转换后的文本
 */
export function preprocessBlockCommands(
  text: string,
  mappings: BlockCommandMapping[],
): string {
  const matches = findBlockCommands(text, mappings);

  if (matches.length === 0) {
    return text;
  }

  // 从后往前替换，避免位置偏移问题
  const parts: string[] = [];
  let lastPos = text.length;

  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];

    // 添加从当前位置到上一个匹配结束之间的文本
    parts.push(text.slice(match.endOffset, lastPos));

    // 根据目标块类型转换
    let replacement = '';
    const targetType = match.block.targetBlockType ?? 'paragraph';
    switch (targetType) {
      case 'blockquote':
        replacement = convertCalloutToBlockquote(match.block);
        break;
      case 'code':
        // 转换为 fenced code block
        replacement = `\`\`\`${match.block.type}\n${match.block.content}\n\`\`\``;
        break;
      case 'paragraph':
        // 保持原样
        replacement = match.block.content;
        break;
      default:
        // 保持原样
        replacement = match.block.original;
    }

    parts.push(replacement);
    lastPos = match.startOffset;
  }

  // 添加文本开头部分
  parts.push(text.slice(0, lastPos));

  // 反转并连接
  return parts.reverse().join('');
}

/**
 * 创建块级指令预处理器
 *
 * @param mappings 块级指令映射配置
 * @returns 预处理函数
 */
export function createBlockCommandPreprocessor(
  mappings: BlockCommandMapping[],
): (text: string) => string {
  return (text: string) => preprocessBlockCommands(text, mappings);
}

/**
 * 验证块级指令映射是否有效
 */
export function validateBlockCommandMappings(mappings: BlockCommandMapping[]): string[] {
  const errors: string[] = [];

  for (const mapping of mappings) {
    if (!mapping.id) {
      errors.push('缺少 id');
      continue;
    }

    if (!mapping.command) {
      errors.push(`[${mapping.id}] 缺少 command`);
      continue;
    }

    // 验证正则表达式
    try {
      new RegExp(`^${escapeRegExp(mapping.command)}(?:\\s+.*)?$`);
    } catch {
      errors.push(`[${mapping.id}] command "${mapping.command}" 可能导致正则表达式错误`);
    }

    // 验证目标块类型
    const validTargets = ['blockquote', 'code', 'paragraph'];
    if (!validTargets.includes(mapping.targetBlockType)) {
      errors.push(`[${mapping.id}] 无效的 targetBlockType: ${mapping.targetBlockType}`);
    }
  }

  return errors;
}
