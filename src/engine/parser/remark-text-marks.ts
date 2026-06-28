import type { Plugin } from 'unified';
import type { Root, Text, PhrasingContent } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';
import { SYNTAX_MAPPINGS, type SyntaxMapping } from './syntax-mappings';

/**
 * 自定义 underline 节点类型
 * 用于在 mdast 树中表示下划线文本
 */
export interface UnderlineNode {
  type: 'underline';
  children: PhrasingContent[];
}

/**
 * 自定义颜色节点类型
 * 用于在 mdast 树中表示带颜色的文本
 * 颜色信息通过此节点传递到转换层，写入 TextRun.styleOverrides.color
 */
export interface ColorSpanNode {
  type: 'colorSpan';
  color: string;
  children: PhrasingContent[];
}

/**
 * remark-math 扩展出的行内公式节点。
 * 本插件只在公式内容命中文本标记映射时才替换它，普通公式仍按原公式节点保留。
 */
interface InlineMathNode {
  type: 'inlineMath';
  value: string;
  position?: Text['position'];
}

/**
 * 手动解析 LaTeX 命令的大括号平衡
 * 用于从匹配位置向前找到第一个 {，然后提取从该 { 到匹配的 } 之间的内容
 * @param text 输入文本
 * @param matchStart 正则匹配的开始位置
 * @param matchEnd 正则匹配的结束位置
 * @returns 大括号内的内容（不含大括号），如果平衡失败返回 null
 */
function extractBalancedBraces(text: string, matchStart: number, matchEnd: number): string | null {
  // 从 matchEnd 向前找到第一个 {
  let openBraceIndex = -1;
  for (let i = matchEnd - 1; i >= matchStart; i--) {
    if (text[i] === '{') {
      openBraceIndex = i;
      break;
    }
    // 如果遇到非反斜杠字符，说明前面不是命令的一部分，停止搜索
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
        // 找到匹配的右大括号
        return text.slice(openBraceIndex + 1, i);
      }
    } else if (char === '\\' && i + 1 < text.length) {
      // 跳过转义的下一个字符（如 \{ 或 \}）
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
function createTextNode(value: string, position?: { start: { line: number; column: number; offset?: number | null }; end: { line: number; column: number; offset?: number | null } } | null): Text {
  return {
    type: 'text',
    value,
    position: position ? {
      start: { line: position.start.line, column: position.start.column, offset: position.start.offset ?? undefined },
      end: { line: position.end.line, column: position.end.column, offset: position.end.offset ?? undefined },
    } : undefined,
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
 * 根据语法映射类型获取对应的 mdast 节点类型
 */
function getMarkNodeType(markType: SyntaxMapping['markType']): string {
  switch (markType) {
    case 'underline':
      return 'underline';
    case 'bold':
      return 'strong';
    case 'italic':
      return 'emphasis';
    case 'strike':
      return 'delete';
    default:
      return 'text';
  }
}

/**
 * 根据语法映射创建标记节点
 */
function createMarkNode(markType: SyntaxMapping['markType'], children: PhrasingContent[]): PhrasingContent | UnderlineNode {
  if (markType === 'underline') {
    return createUnderlineNode(children);
  }
  return {
    type: getMarkNodeType(markType) as 'strong' | 'emphasis' | 'delete',
    children,
  };
}

/**
 * 匹配区间接口
 */
interface MatchInterval {
  start: number;
  end: number;
  mapping: SyntaxMapping;
  content: string;
  color?: string;
}

/**
 * 创建颜色节点
 */
function createColorSpanNode(color: string, children: PhrasingContent[]): ColorSpanNode {
  return {
    type: 'colorSpan',
    color,
    children,
  };
}

/**
 * 解析文本内容，处理所有已注册的语法映射
 * 返回 PhrasingContent 节点数组（可能包含 UnderlineNode 和 ColorSpanNode）
 */
function parseTextWithMappings(
  text: string,
  mappings: SyntaxMapping[],
  position?: { start: { line: number; column: number; offset?: number | null }; end: { line: number; column: number; offset?: number | null } } | null,
): (PhrasingContent | UnderlineNode | ColorSpanNode)[] {
  if (!text || mappings.length === 0) {
    return [createTextNode(text, position)];
  }

  const intervals: MatchInterval[] = [];

  // 对每个映射应用正则表达式
  for (const mapping of mappings) {
    mapping.pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = mapping.pattern.exec(text)) !== null) {
      // 如果映射配置了 colorGroupIndex，说明是颜色语法
      if (mapping.colorGroupIndex !== undefined) {
        const colorGroupIdx = mapping.colorGroupIndex;
        const color = match[colorGroupIdx];
        if (color) {
          // content 是文本内容组（通常是第 colorGroupIndex + 1 个捕获组，除非有嵌套）
          // 对于 \color{red}{text}，正则 \\color\{([\w#]+)\}\{(.+?)\}：
          // match[1] = red (颜色), match[2] = text (内容)
          const contentGroupIdx = colorGroupIdx === 1 ? 2 : (colorGroupIdx === 2 ? 1 : colorGroupIdx + 1);
          const content = match[contentGroupIdx];

          if (content !== undefined) {
            // 计算整个匹配的结束位置
            const endPos = match.index + match[0].length;

            intervals.push({
              start: match.index,
              end: endPos,
              mapping,
              content,
              color,
            });
          }
        }
      } else {
        // 普通语法处理（无 colorGroupIndex）
        let content: string;
        let endPos: number;

        if (match[1] !== undefined) {
          // 正则有捕获组，使用捕获组内容
          content = match[1];
          endPos = match.index + match[0].length;
        } else {
          // 正则没有捕获组（如只有前缀 \underline{），手动提取大括号内容
          const matchText = match[0];
          const braceInMatch = matchText.indexOf('{');

          if (braceInMatch !== -1) {
            const extracted = extractBalancedBraces(text, match.index, match.index + matchText.length);
            if (extracted !== null) {
              content = extracted;
              const contentStart = match.index + braceInMatch + 1;
              endPos = contentStart + content.length + 1;
            } else {
              continue;
            }
          } else {
            continue;
          }
        }

        intervals.push({
          start: match.index,
          end: endPos,
          mapping,
          content,
        });
      }
    }
  }

  // 如果没有匹配，直接返回原始文本节点
  if (intervals.length === 0) {
    return [createTextNode(text, position)];
  }

  // 按起始位置排序
  intervals.sort((a, b) => a.start - b.start);

  // 合并重叠区间
  const mergedIntervals: MatchInterval[] = [];
  for (const interval of intervals) {
    const last = mergedIntervals[mergedIntervals.length - 1];
    if (last && interval.start < last.end) {
      continue;
    }
    mergedIntervals.push(interval);
  }

  // 根据区间切分文本
  const result: (PhrasingContent | UnderlineNode | ColorSpanNode)[] = [];
  let currentIndex = 0;

  for (const interval of mergedIntervals) {
    // 添加区间之前的普通文本
    if (interval.start > currentIndex) {
      const textBefore = text.slice(currentIndex, interval.start);
      if (textBefore) {
        result.push(createTextNode(textBefore, position));
      }
    }

    // 创建标记节点
    const innerNodes = parseTextWithMappings(interval.content, mappings.filter((m) => m !== interval.mapping), position);

    // 如果是颜色语法，创建 ColorSpanNode
    if (interval.color !== undefined) {
      result.push(createColorSpanNode(interval.color, innerNodes as PhrasingContent[]));
    } else {
      // 普通标记节点
      result.push(createMarkNode(interval.mapping.markType, innerNodes as PhrasingContent[]) as PhrasingContent);
    }

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
 * 处理一个文本节点，返回解析后的节点数组
 */
function processTextNode(node: Text, mappings: SyntaxMapping[]): (PhrasingContent | UnderlineNode | ColorSpanNode)[] {
  if (!node.value) {
    return [node];
  }

  // 检查是否有任何映射匹配（包括颜色语法）
  let hasMatch = false;
  for (const mapping of mappings) {
    mapping.pattern.lastIndex = 0;
    if (mapping.pattern.test(node.value)) {
      hasMatch = true;
      break;
    }
  }

  if (!hasMatch) {
    return [node];
  }

  return parseTextWithMappings(node.value, mappings, node.position ?? null) as (PhrasingContent | UnderlineNode | ColorSpanNode)[];
}

/**
 * 处理行内公式节点中的 LaTeX 文本标记。
 *
 * 例如用户把 `$ \underline{\text{文字}} $` 当作“下划线文本语法”导入时，
 * remark-math 会先生成 inlineMath；这里仅在配置规则命中时把它转回 TextMark 节点。
 */
function processInlineMathNode(node: InlineMathNode, mappings: SyntaxMapping[]): (PhrasingContent | UnderlineNode | ColorSpanNode)[] {
  if (!node.value) {
    return [node as unknown as PhrasingContent];
  }

  const mathText = node.value.trim();
  const pseudoTextNode: Text = {
    type: 'text',
    value: mathText,
    position: node.position,
  };
  const newNodes = processTextNode(pseudoTextNode, mappings);

  if (newNodes.length === 1 && (newNodes[0] as Text).type === 'text' && (newNodes[0] as Text).value === mathText) {
    return [node as unknown as PhrasingContent];
  }

  return newNodes;
}

function collectReplacement(
  replacements: Array<{ parent: PhrasingContent; index: number; newNodes: (PhrasingContent | UnderlineNode | ColorSpanNode)[] }>,
  parent: unknown,
  index: number | undefined | null,
  newNodes: (PhrasingContent | UnderlineNode | ColorSpanNode)[],
): typeof SKIP | undefined {
  if (index === null || index === undefined || !parent) {
    return undefined;
  }

  const parentNode = parent as { children?: PhrasingContent[] };
  if ('children' in parentNode && Array.isArray(parentNode.children)) {
    replacements.push({
      parent: parentNode as PhrasingContent,
      index,
      newNodes,
    });
    return SKIP;
  }

  return undefined;
}

/**
 * remark 插件：处理文本中的特殊语法标记
 *
 * @param mappings 可选的语法映射列表，如果不提供则使用默认的 SYNTAX_MAPPINGS
 */
export function remarkTextMarks(mappings?: SyntaxMapping[]): () => (tree: Root) => void {
  const activeMappings = mappings ?? SYNTAX_MAPPINGS;

  return () => {
    return (tree: Root) => {
      interface TextNodeReplacement {
        parent: PhrasingContent;
        index: number;
        newNodes: (PhrasingContent | UnderlineNode | ColorSpanNode)[];
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

        const newNodes = processTextNode(node, activeMappings);

        // 如果没有变化，跳过
        if (newNodes.length === 1 && (newNodes[0] as Text).type === 'text' && (newNodes[0] as Text).value === node.value) {
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

      visit(tree, 'inlineMath', (node: InlineMathNode, index, parent) => {
        const newNodes = processInlineMathNode(node, activeMappings);

        if (newNodes.length === 1 && (newNodes[0] as InlineMathNode).type === 'inlineMath') {
          return;
        }

        return collectReplacement(replacements, parent, index as number | null | undefined, newNodes);
      });

      // 执行替换
      replacements.sort((a, b) => b.index - a.index);

      for (const replacement of replacements) {
        const parentNode = replacement.parent;
        if ('children' in parentNode && Array.isArray(parentNode.children)) {
          // 使用类型断言将自定义节点（underline、colorSpan）添加到父节点的 children 中
          (parentNode.children as unknown as (PhrasingContent | UnderlineNode | ColorSpanNode)[]).splice(
            replacement.index,
            1,
            ...replacement.newNodes,
          );
        }
      }
    };
  };
}
