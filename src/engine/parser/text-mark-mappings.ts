/**
 * 动态文本标记映射器
 *
 * 基于配置文件的文本标记语法映射，支持：
 * - 从 SyntaxMappingConfig 动态加载映射规则
 * - 运行时启用/禁用映射
 * - 自定义正则表达式模式
 *
 * 这个模块是对现有 remark-text-marks.ts 的扩展，
 * 用于支持前端可配置的语法映射功能。
 */

import type { Plugin } from 'unified';
import type { Root, Text, PhrasingContent } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';
import type { TextMarkMapping } from '@/engine/document-model';

/**
 * 自定义 underline 节点类型
 * 用于在 mdast 树中表示下划线文本
 */
export interface UnderlineNode {
  type: 'underline';
  children: PhrasingContent[];
}

/**
 * 解析文本内容，处理所有已注册的语法映射
 * 返回 PhrasingContent 节点数组（可能包含 UnderlineNode）
 */
function parseTextWithMappings(
  text: string,
  mappings: TextMarkMapping[],
  position?: { start: { line: number; column: number; offset?: number | null }; end: { line: number; column: number; offset?: number | null } } | null,
): (PhrasingContent | UnderlineNode)[] {
  if (!text || mappings.length === 0) {
    return [createTextNode(text, position)];
  }

  // 按优先级排序映射
  const sortedMappings = [...mappings].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  const intervals: MatchInterval[] = [];

  // 对每个映射应用正则表达式
  for (const mapping of sortedMappings) {
    if (!mapping.enabled) {
      continue;
    }

    try {
      const regex = new RegExp(mapping.pattern, 'gs');
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        let content: string;
        let endPos: number;

        if (match[1] !== undefined) {
          // 正则有捕获组，使用捕获组内容
          content = match[1];
          endPos = match.index + match[0].length;
        } else {
          // 手动处理 LaTeX 风格的大括号
          const extracted = extractBalancedBraces(text, match.index, match.index + match[0].length);
          if (extracted === null) {
            continue;
          }
          content = extracted;
          const braceInMatch = match[0].indexOf('{');
          const contentStart = match.index + braceInMatch + 1;
          endPos = contentStart + content.length + 1;
        }

        intervals.push({
          start: match.index,
          end: endPos,
          mapping,
          content,
        });
      }
    } catch {
      // 跳过无效的正则表达式
      console.warn(`[remark-text-marks] 无效的正则表达式: ${mapping.pattern}`);
    }
  }

  // 如果没有匹配，直接返回原始文本节点
  if (intervals.length === 0) {
    return [createTextNode(text, position)];
  }

  // 按起始位置排序
  intervals.sort((a, b) => a.start - b.start);

  // 合并重叠区间（只保留第一个匹配）
  const mergedIntervals: MatchInterval[] = [];
  for (const interval of intervals) {
    const last = mergedIntervals[mergedIntervals.length - 1];
    if (last && interval.start < last.end) {
      continue;
    }
    mergedIntervals.push(interval);
  }

  // 根据区间切分文本
  const result: PhrasingContent[] = [];
  let currentIndex = 0;

  for (const interval of mergedIntervals) {
    // 添加区间之前的普通文本
    if (interval.start > currentIndex) {
      const textBefore = text.slice(currentIndex, interval.start);
      if (textBefore) {
        result.push(createTextNode(textBefore, position));
      }
    }

    // 创建标记节点（递归处理嵌套）
    const remainingMappings = sortedMappings.filter((m) => m !== interval.mapping);
    const innerNodes = parseTextWithMappings(interval.content, remainingMappings, position);
    result.push(createMarkNode(interval.mapping.markType, innerNodes as PhrasingContent[]) as PhrasingContent);

    currentIndex = interval.end;
  }

  // 添加剩余文本
  if (currentIndex < text.length) {
    const textAfter = text.slice(currentIndex);
    if (textAfter) {
      result.push(createTextNode(textAfter, position));
    }
  }

  return result;
}

/**
 * 匹配区间接口
 */
interface MatchInterval {
  start: number;
  end: number;
  mapping: TextMarkMapping;
  content: string;
}

/**
 * 手动解析 LaTeX 命令的大括号平衡
 */
function extractBalancedBraces(text: string, matchStart: number, matchEnd: number): string | null {
  // 从 matchEnd 向前找到第一个 {
  let openBraceIndex = -1;
  for (let i = matchEnd - 1; i >= matchStart; i--) {
    if (text[i] === '{') {
      openBraceIndex = i;
      break;
    }
    // 如果遇到非反斜杠字符，说明前面不是命令的一部分
    if (text[i] !== '\\') {
      break;
    }
  }

  if (openBraceIndex === -1) return null;

  // 从 { 之后开始，向后找到平衡的 }
  let balance = 0;
  let i = openBraceIndex;

  while (i < text.length) {
    const char = text[i];
    if (char === '{') {
      balance++;
    } else if (char === '}') {
      balance--;
      if (balance === 0) {
        return text.slice(openBraceIndex + 1, i);
      }
    } else if (char === '\\' && i + 1 < text.length) {
      // 跳过转义的下一个字符
      i += 2;
      continue;
    }
    i++;
  }

  return null;
}

/**
 * 创建文本节点
 */
function createTextNode(
  value: string,
  position?: { start: { line: number; column: number; offset?: number | null }; end: { line: number; column: number; offset?: number | null } } | null,
): Text {
  return {
    type: 'text',
    value,
    position: position
      ? {
          start: {
            line: position.start.line,
            column: position.start.column,
            offset: position.start.offset ?? undefined,
          },
          end: {
            line: position.end.line,
            column: position.end.column,
            offset: position.end.offset ?? undefined,
          },
        }
      : undefined,
  };
}

/**
 * 创建 underline 节点
 */
function createUnderlineNode(children: PhrasingContent[]): UnderlineNode {
  return {
    type: 'underline',
    children,
  };
}

/**
 * 根据语法映射创建标记节点
 */
function createMarkNode(
  markType: string,
  children: PhrasingContent[],
): PhrasingContent | UnderlineNode {
  switch (markType) {
    case 'underline':
      return createUnderlineNode(children);
    case 'bold':
      return { type: 'strong', children };
    case 'italic':
      return { type: 'emphasis', children };
    case 'strike':
      return { type: 'delete', children };
    case 'code': {
      // code 类型是 inlineCode，它的 children 应该是纯文本
      const textContent = children
        .map((c) => ('value' in c ? c.value : ''))
        .join('');
      return { type: 'inlineCode', value: textContent };
    }
    default: {
      // 回退到纯文本
      const textContent = children
        .map((c) => ('value' in c ? c.value : ''))
        .join('');
      return { type: 'text', value: textContent };
    }
  }
}

/**
 * 处理一个文本节点，返回解析后的节点数组
 */
function processTextNode(
  node: Text,
  mappings: TextMarkMapping[],
): PhrasingContent[] {
  if (!node.value) {
    return [node];
  }

  // 检查是否有任何启用的映射匹配
  let hasMatch = false;
  for (const mapping of mappings) {
    if (!mapping.enabled) continue;
    try {
      const regex = new RegExp(mapping.pattern);
      if (regex.test(node.value)) {
        hasMatch = true;
        break;
      }
    } catch {
      // 跳过无效正则
    }
  }

  if (!hasMatch) {
    return [node];
  }

  return parseTextWithMappings(node.value, mappings, node.position ?? null) as PhrasingContent[];
}

/**
 * 创建动态文本标记 remark 插件
 *
 * @param mappings 文本标记映射配置列表
 * @returns remark 插件
 */
export function createRemarkTextMarksPlugin(mappings: TextMarkMapping[]): Plugin<void[], Root> {
  return () => {
    return (tree: Root) => {
      interface TextNodeReplacement {
        parent: PhrasingContent;
        index: number;
        newNodes: PhrasingContent[];
      }

      const replacements: TextNodeReplacement[] = [];

      visit(tree, 'text', (node: Text, index, parent) => {
        if (index === null || !parent) {
          return;
        }

        const parentNode = parent as unknown as { children?: PhrasingContent[]; type?: string };

        if (node.type !== 'text') {
          return;
        }

        // 获取当前启用的映射
        const enabledMappings = mappings.filter((m) => m.enabled);
        if (enabledMappings.length === 0) {
          return;
        }

        const newNodes = processTextNode(node, enabledMappings);

        // 如果没有变化，跳过
        if (
          newNodes.length === 1 &&
          (newNodes[0] as Text).type === 'text' &&
          (newNodes[0] as Text).value === node.value
        ) {
          return;
        }

        if ('children' in parentNode && Array.isArray(parentNode.children)) {
          replacements.push({
            parent: parentNode as PhrasingContent,
            index: index as number,
            newNodes,
          });
          return SKIP;
        }
      });

      // 执行替换
      replacements.sort((a, b) => b.index - a.index);

      for (const replacement of replacements) {
        const parentNode = replacement.parent;
        if ('children' in parentNode && Array.isArray(parentNode.children)) {
          parentNode.children.splice(replacement.index, 1, ...replacement.newNodes);
        }
      }
    };
  };
}

/**
 * 导出 UnderlineNode 类型供外部使用
 */
export type { UnderlineNode as CustomUnderlineNode };
