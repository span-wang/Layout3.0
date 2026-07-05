import type {
  BlockContent,
  Blockquote,
  Code,
  Content,
  Heading,
  Image,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
  ThematicBreak,
} from 'mdast';
import type { Position } from 'unist';
import { createRemarkProcessor } from '@/engine/parser/remark';
import { PAGE_BREAK_COMMAND } from '@/engine/parser/pageBreak';
import { mergeAdjacentTextRuns } from './operations';
import { parseSemanticRolePrefix } from './semanticRole';
import { normalizeSyntaxMappingConfig } from './syntaxMappingConfig';
import type {
  BlockPagination,
  BlockStyleOverrides,
  LayoutBlock,
  LayoutDocument,
  LayoutListItem,
  LayoutResource,
  LayoutTableCell,
  LayoutTableRow,
  SourceRange,
  TextMark,
  TextRun,
  TextStyleOverrides,
} from './types';
import { createStableHash, createTextFragment } from './utils';

interface BuilderState {
  blockCounter: number;
  resourceCounter: number;
}

interface MathBlockNode {
  type: 'math';
  value: string;
  position?: Position;
}

/**
 * 自定义下划线节点类型
 * 由 remark-text-marks 插件从 ++text++ 或 \underline{} 语法转换而来
 */
interface UnderlineNode {
  type: 'underline';
  children: PhrasingContent[];
}

/**
 * 自定义颜色节点类型
 * 由 remark-text-marks 插件从 \color{red}{text} 语法转换而来
 * 颜色信息通过此节点传递到转换层，写入 TextRun.styleOverrides.color
 */
interface ColorSpanNode {
  type: 'colorSpan';
  color: string;
  children: PhrasingContent[];
}

type LayoutBlockContentNode = BlockContent | MathBlockNode;

function createSourceRange(position?: Position | null): SourceRange | null {
  if (!position) {
    return null;
  }

  return {
    start: {
      line: position.start.line,
      column: position.start.column,
      offset: position.start.offset ?? null,
    },
    end: {
      line: position.end.line,
      column: position.end.column,
      offset: position.end.offset ?? null,
    },
  };
}

function isLayoutBlockContentType(type: string): boolean {
  return [
    'paragraph',
    'heading',
    'list',
    'table',
    'blockquote',
    'code',
    'thematicBreak',
    'math',
  ].includes(type);
}

function createBlockId(state: BuilderState, type: LayoutBlock['type'], text: string): string {
  state.blockCounter += 1;
  return `${type}-${state.blockCounter}-${createTextFragment(text, type)}`;
}

function createRunId(blockId: string, index: number, text: string): string {
  return `${blockId}-run-${index + 1}-${createTextFragment(text, 'text')}`;
}

function createBlockStyleOverrides(): BlockStyleOverrides {
  return {};
}

function createBlockPagination(overrides: BlockPagination = {}): BlockPagination {
  return overrides;
}

function createTextRun(
  blockId: string,
  index: number,
  text: string,
  sourceRange: SourceRange | null,
  marks: TextMark[],
  styleOverrides: TextStyleOverrides = {},
): TextRun {
  return {
    id: createRunId(blockId, index, text),
    text,
    sourceRange,
    marks,
    charStyleRef: null,
    styleOverrides,
    annotations: [],
  };
}

function dedupeMarks(marks: TextMark[]): TextMark[] {
  const seen = new Set<string>();

  return marks.filter((mark) => {
    const key = JSON.stringify(mark);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function appendMark(marks: TextMark[], mark: TextMark): TextMark[] {
  return dedupeMarks([...marks, mark]);
}

function extractPlainTextFromPhrasing(nodes: PhrasingContent[] | (PhrasingContent | ColorSpanNode)[]): string {
  return nodes
    .map((node) => {
      // 处理自定义节点类型（TypeScript 无法推断这些节点类型，直接断言）
      const nodeAny = node as unknown as { type: string; children?: PhrasingContent[] };
      if (nodeAny.type === 'underline' || nodeAny.type === 'colorSpan') {
        return extractPlainTextFromPhrasing(nodeAny.children ?? []);
      }

      switch (node.type) {
        case 'text':
          return node.value;
        case 'inlineCode':
          return node.value;
        case 'break':
          return '\n';
        case 'inlineMath':
          return `$${(node as PhrasingContent & { value: string }).value}$`;
        case 'image':
          return node.alt ? `[图片：${node.alt}]` : '[图片]';
        case 'link':
        case 'strong':
        case 'emphasis':
        case 'delete':
          return extractPlainTextFromPhrasing(node.children);
        default:
          return '';
      }
    })
    .join('');
}

function buildTextRunsFromPhrasing(
  blockId: string,
  nodes: (PhrasingContent | UnderlineNode | ColorSpanNode)[],
  inheritedMarks: TextMark[] = [],
  inheritedStyleOverrides: TextStyleOverrides = {},
): TextRun[] {
  const runs: TextRun[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        runs.push(
          createTextRun(blockId, runs.length, node.value, createSourceRange(node.position), inheritedMarks, inheritedStyleOverrides),
        );
        break;
      case 'inlineCode':
        runs.push(
          createTextRun(
            blockId,
            runs.length,
            node.value,
            createSourceRange(node.position),
            appendMark(inheritedMarks, { type: 'code' }),
            inheritedStyleOverrides,
          ),
        );
        break;
      case 'break':
        runs.push(createTextRun(blockId, runs.length, '\n', createSourceRange(node.position), inheritedMarks, inheritedStyleOverrides));
        break;
      case 'inlineMath':
        runs.push(
          createTextRun(
            blockId,
            runs.length,
            `$${(node as PhrasingContent & { value: string }).value}$`,
            createSourceRange(node.position),
            inheritedMarks,
            inheritedStyleOverrides,
          ),
        );
        break;
      case 'strong':
        runs.push(
          ...buildTextRunsFromPhrasing(blockId, node.children, appendMark(inheritedMarks, { type: 'bold' }), inheritedStyleOverrides),
        );
        break;
      case 'emphasis':
        runs.push(
          ...buildTextRunsFromPhrasing(blockId, node.children, appendMark(inheritedMarks, { type: 'italic' }), inheritedStyleOverrides),
        );
        break;
      case 'delete':
        runs.push(
          ...buildTextRunsFromPhrasing(blockId, node.children, appendMark(inheritedMarks, { type: 'strike' }), inheritedStyleOverrides),
        );
        break;
      case 'underline':
        // 处理自定义 underline 节点（由 remark-text-marks 插件从 ++text++ 或 \underline{} 语法转换而来）
        runs.push(
          ...buildTextRunsFromPhrasing(
            blockId,
            (node as UnderlineNode).children,
            appendMark(inheritedMarks, { type: 'underline' }),
            inheritedStyleOverrides,
          ),
        );
        break;
      case 'colorSpan':
        // 处理自定义颜色节点（由 remark-text-marks 插件从 \color{red}{text} 语法转换而来）
        // 颜色作为 styleOverrides.color 传递
        const colorStyleOverrides: TextStyleOverrides = {
          ...inheritedStyleOverrides,
          color: (node as ColorSpanNode).color,
        };
        runs.push(
          ...buildTextRunsFromPhrasing(
            blockId,
            (node as ColorSpanNode).children,
            inheritedMarks,
            colorStyleOverrides,
          ),
        );
        break;
      case 'link':
        runs.push(
          ...buildTextRunsFromPhrasing(
            blockId,
            node.children,
            appendMark(inheritedMarks, { type: 'link', href: node.url, title: node.title ?? null }),
            inheritedStyleOverrides,
          ),
        );
        break;
      case 'image':
        runs.push(
          createTextRun(
            blockId,
            runs.length,
            node.alt ? `[图片：${node.alt}]` : '[图片]',
            createSourceRange(node.position),
            inheritedMarks,
            inheritedStyleOverrides,
          ),
        );
        break;
      default:
        break;
    }
  }

  const mergedRuns = mergeAdjacentTextRuns(runs);
  return mergedRuns.map((run, index) => ({
    ...run,
    id: createRunId(blockId, index, run.text),
  }));
}

function buildBlockTextRuns(blockId: string, text: string, sourceRange: SourceRange | null): TextRun[] {
  if (!text) {
    return [];
  }

  return [createTextRun(blockId, 0, text, sourceRange, [])];
}

function stripPrefixFromTextRuns(blockId: string, textRuns: TextRun[], prefixLength: number): TextRun[] {
  if (prefixLength <= 0) {
    return textRuns;
  }

  let remainingPrefixLength = prefixLength;
  const strippedRuns: TextRun[] = [];

  for (const run of textRuns) {
    if (remainingPrefixLength >= run.text.length) {
      remainingPrefixLength -= run.text.length;
      continue;
    }

    const nextText = remainingPrefixLength > 0 ? run.text.slice(remainingPrefixLength) : run.text;
    remainingPrefixLength = 0;

    if (!nextText) {
      continue;
    }

    strippedRuns.push({
      ...run,
      text: nextText,
    });
  }

  return mergeAdjacentTextRuns(strippedRuns).map((run, index) => ({
    ...run,
    id: createRunId(blockId, index, run.text),
  }));
}

function buildListItemTextRuns(itemId: string, node: ListItem): TextRun[] {
  const segments: TextRun[] = [];
  let hasInsertedContent = false;

  const appendSeparator = () => {
    if (!hasInsertedContent) {
      return;
    }

    segments.push(createTextRun(itemId, segments.length, '\n', null, []));
  };

  const appendTextRuns = (nextRuns: TextRun[]) => {
    if (nextRuns.length === 0) {
      return;
    }

    appendSeparator();
    segments.push(...nextRuns);
    hasInsertedContent = true;
  };

  for (const child of node.children) {
    if (child.type === 'paragraph') {
      appendTextRuns(buildTextRunsFromPhrasing(itemId, child.children));
      continue;
    }

    if (child.type === 'code') {
      appendTextRuns([
        createTextRun(itemId, segments.length, child.value, createSourceRange(child.position), [{ type: 'code' }]),
      ]);
      continue;
    }

    // 子列表会由 flattenListItems 展开成独立的 LayoutListItem。
    // 这里不再把子列表文字塞回父项，避免画布里出现“父项一遍 + 子项一遍”的重复内容。
  }

  const normalizedRuns = mergeAdjacentTextRuns(segments);
  return normalizedRuns.map((run, index) => ({
    ...run,
    id: createRunId(itemId, index, run.text),
  }));
}

function extractPlainTextFromListItem(node: ListItem): string {
  return node.children
    .map((child) => {
      if (child.type === 'paragraph') {
        return extractPlainTextFromPhrasing(child.children);
      }

      if (child.type === 'code') {
        return child.value;
      }

      if (child.type === 'list') {
        return child.children.map((listItem) => extractPlainTextFromListItem(listItem)).join('\n');
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildListItem(blockId: string, pathKey: string, node: ListItem, level = 1, listKind: LayoutListItem['listKind'] = 'unordered'): LayoutListItem {
  const itemId = `${blockId}-item-${pathKey}-${createTextFragment(extractPlainTextFromListItem(node), 'item')}`;

  return {
    id: itemId,
    sourceRange: createSourceRange(node.position),
    textRuns: buildListItemTextRuns(itemId, node),
    level: Math.max(1, Math.min(3, Math.floor(level))),
    listKind,
    checked: typeof node.checked === 'boolean' ? node.checked : null,
  };
}

function flattenListItems(blockId: string, node: List, level = 1, pathPrefix = 'root'): LayoutListItem[] {
  const listKind: LayoutListItem['listKind'] = node.ordered ? 'ordered' : 'unordered';

  return node.children.flatMap((item, index) => {
    const pathKey = `${pathPrefix}-${index + 1}`;
    const currentItem = buildListItem(blockId, pathKey, item, level, listKind);
    const nestedItems = item.children
      .filter((child): child is List => child.type === 'list')
      .flatMap((nestedList, nestedIndex) => flattenListItems(blockId, nestedList, level + 1, `${pathKey}-list-${nestedIndex + 1}`));

    return [currentItem, ...nestedItems];
  });
}

function buildTableCell(blockId: string, rowIndex: number, cellIndex: number, node: TableCell, isHeader: boolean): LayoutTableCell {
  const cellId = `${blockId}-cell-${rowIndex + 1}-${cellIndex + 1}`;
  const textRuns = buildTextRunsFromPhrasing(
    cellId,
    node.children.filter((child): child is PhrasingContent => child.type !== 'html'),
  );

  return {
    id: cellId,
    sourceRange: createSourceRange(node.position),
    textRuns,
    isHeader,
  };
}

function buildTableRow(blockId: string, rowIndex: number, node: TableRow): LayoutTableRow {
  return {
    id: `${blockId}-row-${rowIndex + 1}`,
    sourceRange: createSourceRange(node.position),
    heightPx: null,
    cells: node.children.map((cell, cellIndex) =>
      buildTableCell(blockId, rowIndex, cellIndex, cell, rowIndex === 0),
    ),
  };
}

function createBaseBlock(
  id: string,
  type: LayoutBlock['type'],
  sourceRange: SourceRange | null,
  blockStyleRef: string | null,
): Omit<LayoutBlock, 'metadata' | 'textRuns' | 'pagination'> {
  return {
    id,
    type,
    sourceRange,
    blockStyleRef,
    blockStyleOverrides: createBlockStyleOverrides(),
  };
}

function buildParagraphBlock(state: BuilderState, node: Paragraph): LayoutBlock {
  const plainText = extractPlainTextFromPhrasing(node.children);
  const sourceRange = createSourceRange(node.position);

  if (plainText.trim() === PAGE_BREAK_COMMAND) {
    const blockId = createBlockId(state, 'pageBreak', PAGE_BREAK_COMMAND);
    return {
      ...createBaseBlock(blockId, 'pageBreak', sourceRange, null),
      textRuns: [],
      pagination: createBlockPagination({ pageBreakAfter: true }),
      metadata: {
        kind: 'pageBreak',
        command: PAGE_BREAK_COMMAND,
      },
    };
  }

  if (node.children.length === 1 && node.children[0].type === 'image') {
    return buildImageBlock(state, node.children[0], sourceRange);
  }

  const semanticPrefix = parseSemanticRolePrefix(plainText);
  const blockText = semanticPrefix?.content ?? plainText;
  const blockId = createBlockId(state, 'paragraph', blockText);
  const rawTextRuns = buildTextRunsFromPhrasing(blockId, node.children);
  return {
    ...createBaseBlock(blockId, 'paragraph', sourceRange, 'paragraph'),
    ...(semanticPrefix ? { semantic: semanticPrefix.semantic } : {}),
    textRuns: semanticPrefix
      ? stripPrefixFromTextRuns(blockId, rawTextRuns, semanticPrefix.prefixLength)
      : rawTextRuns,
    pagination: createBlockPagination(),
    metadata: {
      kind: 'paragraph',
      text: blockText,
    },
  };
}

function buildHeadingBlock(state: BuilderState, node: Heading): LayoutBlock {
  const plainText = extractPlainTextFromPhrasing(node.children);
  const semanticPrefix = parseSemanticRolePrefix(plainText);
  const blockText = semanticPrefix?.content ?? plainText;
  const blockId = createBlockId(state, 'heading', blockText);
  const rawTextRuns = buildTextRunsFromPhrasing(blockId, node.children);

  return {
    ...createBaseBlock(blockId, 'heading', createSourceRange(node.position), `heading-${node.depth}`),
    ...(semanticPrefix ? { semantic: semanticPrefix.semantic } : {}),
    textRuns: semanticPrefix
      ? stripPrefixFromTextRuns(blockId, rawTextRuns, semanticPrefix.prefixLength)
      : rawTextRuns,
    pagination: createBlockPagination({ keepWithNext: true }),
    metadata: {
      kind: 'heading',
      depth: node.depth,
      text: blockText,
    },
  };
}

function buildListBlock(state: BuilderState, node: List): LayoutBlock {
  const plainText = node.children.map((item) => extractPlainTextFromListItem(item)).join('\n');
  const blockId = createBlockId(state, 'list', plainText);

  return {
    ...createBaseBlock(blockId, 'list', createSourceRange(node.position), 'list'),
    textRuns: [],
    pagination: createBlockPagination(),
    metadata: {
      kind: 'list',
      ordered: node.ordered ?? false,
      start: node.start ?? null,
      spread: node.spread ?? false,
      items: flattenListItems(blockId, node, 1),
    },
  };
}

function buildBlockquoteBlock(state: BuilderState, node: Blockquote): LayoutBlock {
  const nestedBlocks = buildBlocks(
    state,
    node.children.filter((child) => isLayoutBlockContentType(child.type)) as LayoutBlockContentNode[],
  );
  const blockId = createBlockId(
    state,
    'blockquote',
    nestedBlocks
      .flatMap((block) => block.textRuns.map((run) => run.text))
      .join(' '),
  );

  return {
    ...createBaseBlock(blockId, 'blockquote', createSourceRange(node.position), 'blockquote'),
    textRuns: [],
    pagination: createBlockPagination(),
    metadata: {
      kind: 'blockquote',
      blocks: nestedBlocks,
    },
  };
}

function buildCodeBlock(state: BuilderState, node: Code): LayoutBlock {
  const blockId = createBlockId(state, 'code', node.value);

  return {
    ...createBaseBlock(blockId, 'code', createSourceRange(node.position), 'code'),
    textRuns: buildBlockTextRuns(blockId, node.value, createSourceRange(node.position)),
    pagination: createBlockPagination({ keepLinesTogether: true }),
    metadata: {
      kind: 'code',
      language: node.lang ?? null,
      value: node.value,
    },
  };
}

function buildTableBlock(state: BuilderState, node: Table): LayoutBlock {
  const plainText = node.children
    .flatMap((row) => row.children.map((cell) => extractPlainTextFromPhrasing(cell.children)))
    .join(' ');
  const blockId = createBlockId(state, 'table', plainText);

  return {
    ...createBaseBlock(blockId, 'table', createSourceRange(node.position), 'table'),
    textRuns: [],
    pagination: createBlockPagination(),
    metadata: {
      kind: 'table',
      align: (node.align ?? []).map((align) => align ?? null),
      columnWidthsPx: (node.align ?? []).map(() => null),
      rows: node.children.map((row, rowIndex) => buildTableRow(blockId, rowIndex, row)),
    },
  };
}

function buildImageBlock(state: BuilderState, node: Image, sourceRange = createSourceRange(node.position)): LayoutBlock {
  const blockId = createBlockId(state, 'image', `${node.url} ${node.alt ?? ''}`.trim());

  return {
    ...createBaseBlock(blockId, 'image', sourceRange, 'image'),
    textRuns: [],
    pagination: createBlockPagination(),
    metadata: {
      kind: 'image',
      src: node.url,
      alt: node.alt ?? '',
      title: node.title ?? null,
    },
  };
}

function buildHorizontalRuleBlock(state: BuilderState, node: ThematicBreak): LayoutBlock {
  const blockId = createBlockId(state, 'horizontalRule', 'horizontal-rule');

  return {
    ...createBaseBlock(blockId, 'horizontalRule', createSourceRange(node.position), 'horizontal-rule'),
    textRuns: [],
    pagination: createBlockPagination(),
    metadata: {
      kind: 'horizontalRule',
    },
  };
}

function buildEquationBlock(state: BuilderState, node: MathBlockNode): LayoutBlock {
  const blockId = createBlockId(state, 'equation', node.value);
  const sourceRange = createSourceRange(node.position);

  return {
    ...createBaseBlock(blockId, 'equation', sourceRange, 'equation'),
    textRuns: buildBlockTextRuns(blockId, node.value, sourceRange),
    pagination: createBlockPagination({ keepLinesTogether: true }),
    metadata: {
      kind: 'equation',
      value: node.value,
    },
  };
}

function buildBlocks(state: BuilderState, nodes: LayoutBlockContentNode[]): LayoutBlock[] {
  return nodes.flatMap((node) => {
    switch (node.type) {
      case 'paragraph':
        return [buildParagraphBlock(state, node)];
      case 'heading':
        return [buildHeadingBlock(state, node)];
      case 'list':
        return [buildListBlock(state, node)];
      case 'blockquote':
        return [buildBlockquoteBlock(state, node)];
      case 'code':
        return [buildCodeBlock(state, node)];
      case 'table':
        return [buildTableBlock(state, node)];
      case 'thematicBreak':
        return [buildHorizontalRuleBlock(state, node)];
      case 'math':
        return [buildEquationBlock(state, node)];
      default:
        return [];
    }
  });
}

function collectImageResources(state: BuilderState, blocks: LayoutBlock[]): LayoutResource[] {
  const resources: LayoutResource[] = [];

  for (const block of blocks) {
    if (block.type === 'image' && block.metadata.kind === 'image') {
      state.resourceCounter += 1;
      resources.push({
        id: `resource-${state.resourceCounter}-${createTextFragment(block.metadata.src, 'image')}`,
        type: 'image',
        src: block.metadata.src,
        alt: block.metadata.alt,
        title: block.metadata.title,
        blockId: block.id,
      });
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      resources.push(...collectImageResources(state, block.metadata.blocks));
    }
  }

  return resources;
}

function countWords(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}]+/gu);
  return matches ? matches.length : 0;
}

function countCharacters(text: string): number {
  return text.replace(/\s+/gu, '').length;
}

function getDocumentTitle(blocks: LayoutBlock[]): string {
  const headingBlock = blocks.find(
    (block): block is LayoutBlock & { metadata: { kind: 'heading'; text: string } } =>
      block.type === 'heading' && block.metadata.kind === 'heading',
  );

  if (headingBlock) {
    return headingBlock.metadata.text || '未命名文档';
  }

  const paragraphBlock = blocks.find(
    (block): block is LayoutBlock & { metadata: { kind: 'paragraph'; text: string } } =>
      block.type === 'paragraph' && block.metadata.kind === 'paragraph' && block.metadata.text.trim().length > 0,
  );

  if (paragraphBlock) {
    return paragraphBlock.metadata.text.slice(0, 24);
  }

  return '未命名文档';
}

export function createEmptyLayoutDocument(payload: {
  title?: string;
  source?: string;
} = {}): LayoutDocument {
  const source = payload.source ?? '';
  const blocks: LayoutBlock[] = [];

  return {
    version: '1.0.0',
    id: `layout-document-${createStableHash(source)}`,
    title: payload.title ?? '未命名文档',
    source,
    blocks,
    resources: [],
    styles: {
      blockStyles: {},
      textStyles: {},
    },
    template: {
      templateId: null,
      templateOverrides: {},
    },
    viewState: {
      answerDisplayMode: 'show',
      zoom: 1,
      selectedNodeId: null,
      tableSelection: null,
    },
    meta: {
      sourceFormat: 'markdown',
      wordCount: countWords(source),
      characterCount: countCharacters(source),
      blockCount: 0,
      updatedAt: new Date().toISOString(),
      syntaxMappingConfig: normalizeSyntaxMappingConfig(),
    },
  };
}

export async function createLayoutDocumentFromMarkdown(
  source: string,
  syntaxMappingConfig?: LayoutDocument['meta']['syntaxMappingConfig'],
): Promise<LayoutDocument> {
  const normalizedSyntaxMappingConfig = normalizeSyntaxMappingConfig(syntaxMappingConfig);
  const processor = createRemarkProcessor(normalizedSyntaxMappingConfig);
  const tree = processor.parse(source) as Root;
  // 运行已注册的插件（如 remarkTextMarks 语法映射插件）
  await processor.run(tree, source);
  const state: BuilderState = {
    blockCounter: 0,
    resourceCounter: 0,
  };
  const blocks = buildBlocks(
    state,
    tree.children.filter((node) => isLayoutBlockContentType(node.type)) as LayoutBlockContentNode[],
  );
  const resources = collectImageResources(state, blocks);
  const title = getDocumentTitle(blocks);

  return {
    version: '1.0.0',
    id: `layout-document-${createStableHash(source)}`,
    title,
    source,
    blocks,
    resources,
    styles: {
      blockStyles: {},
      textStyles: {},
    },
    template: {
      templateId: null,
      templateOverrides: {},
    },
    viewState: {
      answerDisplayMode: 'show',
      zoom: 1,
      selectedNodeId: null,
      tableSelection: null,
    },
    meta: {
      sourceFormat: 'markdown',
      wordCount: countWords(source),
      characterCount: countCharacters(source),
      blockCount: blocks.length,
      updatedAt: new Date().toISOString(),
      syntaxMappingConfig: normalizedSyntaxMappingConfig,
    },
  };
}
