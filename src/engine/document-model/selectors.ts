import { getTextContentFromRuns } from './operations';
import { getSemanticRoleById } from './semanticRole';
import type {
  AnswerDisplayMode,
  LayoutBlock,
  LayoutDocument,
  LayoutListItem,
  LayoutTableCell,
  SourceRange,
  TextRun,
  TocItem,
} from './types';
import { getLayoutListItemLevel } from './utils';
import type { PageLayout } from '@/engine/typesetting/types';

const solutionSemanticRoleIds = new Set(['answer', 'explanation']);
const questionIndexLikePatterns = [
  /^\d+$/u,
  /^\d+[\.．、]$/u,
  /^[（(]\d+[）)]$/u,
  /^第[\d一二三四五六七八九十百千]+题$/u,
  /^[一二三四五六七八九十百千]+[\.．、]$/u,
];

export type SelectedLayoutNodeKind = 'block' | 'listItem' | 'tableCell';

export interface SelectedLayoutNodeInfo {
  nodeId: string;
  kind: SelectedLayoutNodeKind;
  ownerBlock: LayoutBlock;
  textRuns: TextRun[];
  plainText: string;
  sourceRange: SourceRange | null;
}

export interface SelectedBlockquoteContext {
  blockquoteBlock: LayoutBlock;
  directChildBlock: LayoutBlock | null;
  directChildIndex: number;
  childCount: number;
}

function isAnswerExplanationRoleId(roleId: string | null | undefined, document: LayoutDocument): boolean {
  if (!roleId) {
    return false;
  }

  if (solutionSemanticRoleIds.has(roleId)) {
    return true;
  }

  const role = getSemanticRoleById(roleId, document.meta.semanticRoleConfig);
  return !!role?.name && /(答案|解析)/u.test(role.name);
}

export function isAnswerExplanationSemanticBlock(
  block: LayoutBlock,
  document: LayoutDocument,
): boolean {
  return isAnswerExplanationRoleId(block.semantic?.roleId, document);
}

function isQuestionIndexLikeUnderlineText(text: string): boolean {
  const normalizedText = text.replace(/\s+/gu, '').trim();
  if (!normalizedText) {
    return false;
  }

  return questionIndexLikePatterns.some((pattern) => pattern.test(normalizedText));
}

function getNestedContainerBlocks(block: LayoutBlock): LayoutBlock[] | null {
  if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
    return block.metadata.blocks;
  }

  if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
    return block.metadata.blocks;
  }

  return null;
}

function replaceNestedContainerBlocks(block: LayoutBlock, nestedBlocks: LayoutBlock[]): LayoutBlock {
  if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
    return {
      ...block,
      metadata: {
        ...block.metadata,
        blocks: nestedBlocks,
      },
    };
  }

  if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
    return {
      ...block,
      metadata: {
        ...block.metadata,
        blocks: nestedBlocks,
      },
    };
  }

  return block;
}

export function shouldRenderTextRunAsDictationBlank(
  run: TextRun,
  answerDisplayMode: AnswerDisplayMode,
): boolean {
  if (answerDisplayMode !== 'underline') {
    return false;
  }

  if (!run.marks.some((mark) => mark.type === 'underline')) {
    return false;
  }

  // 试卷里常见的下划线题号（如 1. / （1））不应进入默写挖空。
  if (isQuestionIndexLikeUnderlineText(run.text)) {
    return false;
  }

  return run.text.trim().length > 0;
}

export function getRenderableLayoutBlocksForView(document: LayoutDocument | null): LayoutBlock[] {
  if (!document) {
    return [];
  }

  const answerDisplayMode = document.viewState.answerDisplayMode;
  const answerBlockPlacementMode = document.viewState.answerBlockPlacementMode;

  const partitionBlocksForAnswerDisplay = (
    blocks: LayoutBlock[],
  ): {
    contentBlocks: LayoutBlock[];
    solutionBlocks: LayoutBlock[];
  } => {
    const contentBlocks: LayoutBlock[] = [];
    const solutionBlocks: LayoutBlock[] = [];

    for (const block of blocks) {
      if (isAnswerExplanationSemanticBlock(block, document)) {
        solutionBlocks.push(block);
        continue;
      }

      const nestedBlocks = getNestedContainerBlocks(block);
      if (nestedBlocks) {
        // 容器里的答案解析需要单独抽出来，但剩余正文仍要保留在原容器里继续分页和导出。
        const nestedPartition = partitionBlocksForAnswerDisplay(nestedBlocks);
        if (nestedPartition.contentBlocks.length > 0) {
          contentBlocks.push(replaceNestedContainerBlocks(block, nestedPartition.contentBlocks));
        }
        solutionBlocks.push(...nestedPartition.solutionBlocks);
        continue;
      }

      contentBlocks.push(block);
    }

    return { contentBlocks, solutionBlocks };
  };

  if (answerDisplayMode === 'show' && answerBlockPlacementMode === 'inline') {
    return document.blocks;
  }

  const partition = partitionBlocksForAnswerDisplay(document.blocks);
  if (answerDisplayMode !== 'show') {
    return partition.contentBlocks;
  }

  return partition.solutionBlocks.length > 0
    ? [...partition.contentBlocks, ...partition.solutionBlocks]
    : partition.contentBlocks;
}

export function findLayoutBlockById(blocks: LayoutBlock[], blockId: string): LayoutBlock | null {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block;
    }

    const nestedBlocks = getNestedContainerBlocks(block);
    if (nestedBlocks) {
      const nestedBlock = findLayoutBlockById(nestedBlocks, blockId);
      if (nestedBlock) {
        return nestedBlock;
      }
    }
  }

  return null;
}

export function getSelectedLayoutBlock(document: LayoutDocument | null): LayoutBlock | null {
  const selectedNodeId = document?.viewState.selectedNodeId;
  if (!document || !selectedNodeId) {
    return null;
  }

  return findLayoutBlockById(document.blocks, selectedNodeId);
}

function createSelectedNodeInfoForItem(
  item: LayoutListItem,
  ownerBlock: LayoutBlock,
): SelectedLayoutNodeInfo {
  return {
    nodeId: item.id,
    kind: 'listItem',
    ownerBlock,
    textRuns: item.textRuns,
    plainText: getTextContentFromRuns(item.textRuns),
    sourceRange: item.sourceRange,
  };
}

function createSelectedNodeInfoForCell(
  cell: LayoutTableCell,
  ownerBlock: LayoutBlock,
): SelectedLayoutNodeInfo {
  return {
    nodeId: cell.id,
    kind: 'tableCell',
    ownerBlock,
    textRuns: cell.textRuns,
    plainText: getTextContentFromRuns(cell.textRuns),
    sourceRange: cell.sourceRange,
  };
}

function createSelectedNodeInfoForBlock(block: LayoutBlock): SelectedLayoutNodeInfo | null {
  return {
    nodeId: block.id,
    kind: 'block',
    ownerBlock: block,
    textRuns: block.textRuns,
    plainText: getLayoutBlockPlainText(block),
    sourceRange: block.sourceRange,
  };
}

function findDirectChildBlockIndexForSelectedNode(
  blocks: LayoutBlock[],
  selectedNodeId: string,
): number {
  return blocks.findIndex((block) => {
    if (block.id === selectedNodeId) {
      return true;
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      return block.metadata.items.some((item) => item.id === selectedNodeId);
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      return block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === selectedNodeId));
    }

    return false;
  });
}

export function findTopLevelBlockForSelectedNode(
  blocks: LayoutBlock[],
  selectedNodeId: string,
): LayoutBlock | null {
  for (const block of blocks) {
    if (block.id === selectedNodeId) {
      return block;
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      if (block.metadata.items.some((item) => item.id === selectedNodeId)) {
        return block;
      }
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      if (block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === selectedNodeId))) {
        return block;
      }
    }
  }

  return null;
}

export function findSelectedLayoutNodeInfo(
  blocks: LayoutBlock[],
  selectedNodeId: string,
): SelectedLayoutNodeInfo | null {
  for (const block of blocks) {
    if (block.id === selectedNodeId) {
      return createSelectedNodeInfoForBlock(block);
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      const matchedItem = block.metadata.items.find((item) => item.id === selectedNodeId);
      if (matchedItem) {
        return createSelectedNodeInfoForItem(matchedItem, block);
      }
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      for (const row of block.metadata.rows) {
        const matchedCell = row.cells.find((cell) => cell.id === selectedNodeId);
        if (matchedCell) {
          return createSelectedNodeInfoForCell(matchedCell, block);
        }
      }
    }

    const nestedBlocks = getNestedContainerBlocks(block);
    if (nestedBlocks) {
      const nestedNode = findSelectedLayoutNodeInfo(nestedBlocks, selectedNodeId);
      if (nestedNode) {
        return nestedNode;
      }
    }
  }

  return null;
}

export function getSelectedLayoutNodeInfo(document: LayoutDocument | null): SelectedLayoutNodeInfo | null {
  const selectedNodeId = document?.viewState.selectedNodeId;
  if (!document || !selectedNodeId) {
    return null;
  }

  return findSelectedLayoutNodeInfo(document.blocks, selectedNodeId);
}

export function findSelectedBlockquoteContext(
  blocks: LayoutBlock[],
  selectedNodeId: string,
): SelectedBlockquoteContext | null {
  for (const block of blocks) {
    if (block.type !== 'blockquote' || block.metadata.kind !== 'blockquote') {
      continue;
    }

    if (block.id === selectedNodeId) {
      return {
        blockquoteBlock: block,
        directChildBlock: null,
        directChildIndex: -1,
        childCount: block.metadata.blocks.length,
      };
    }

    const directChildIndex = findDirectChildBlockIndexForSelectedNode(block.metadata.blocks, selectedNodeId);
    if (directChildIndex >= 0) {
      return {
        blockquoteBlock: block,
        directChildBlock: block.metadata.blocks[directChildIndex] ?? null,
        directChildIndex,
        childCount: block.metadata.blocks.length,
      };
    }

    const nestedContext = findSelectedBlockquoteContext(block.metadata.blocks, selectedNodeId);
    if (nestedContext) {
      return nestedContext;
    }
  }

  return null;
}

export function getSelectedBlockquoteContext(document: LayoutDocument | null): SelectedBlockquoteContext | null {
  const selectedNodeId = document?.viewState.selectedNodeId;
  if (!document || !selectedNodeId) {
    return null;
  }

  return findSelectedBlockquoteContext(document.blocks, selectedNodeId);
}

export function getHeadingText(block: LayoutBlock): string | null {
  if (block.type !== 'heading' || block.metadata.kind !== 'heading') {
    return null;
  }

  return block.metadata.text || getTextContentFromRuns(block.textRuns) || null;
}

export function getLayoutBlockPlainText(block: LayoutBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'toc':
    case 'code':
      return getTextContentFromRuns(block.textRuns);
    case 'list':
      return block.metadata.kind === 'list'
        ? block.metadata.items
            .map((item) => `${'  '.repeat(getLayoutListItemLevel(item) - 1)}${getTextContentFromRuns(item.textRuns)}`)
            .join('\n')
        : '';
    case 'table':
      return block.metadata.kind === 'table'
        ? block.metadata.rows
            .map((row) => row.cells.map((cell) => getTextContentFromRuns(cell.textRuns)).join(' | '))
            .join('\n')
        : '';
    case 'image':
      return block.metadata.kind === 'image' ? block.metadata.alt : '';
    case 'equation':
      return block.metadata.kind === 'equation' ? block.metadata.value : '';
    case 'blockquote':
      return block.metadata.kind === 'blockquote'
        ? block.metadata.blocks.map((nestedBlock) => getLayoutBlockPlainText(nestedBlock)).join('\n')
        : '';
    case 'columnSection':
      return block.metadata.kind === 'columnSection'
        ? block.metadata.blocks.map((nestedBlock) => getLayoutBlockPlainText(nestedBlock)).join('\n')
        : '';
    default:
      return '';
  }
}

function collectTocItems(blocks: LayoutBlock[]): TocItem[] {
  return blocks.flatMap((block) => {
    if (block.type === 'heading' && block.metadata.kind === 'heading') {
      return [
        {
          id: block.id,
          depth: block.metadata.depth,
          text: block.metadata.text,
        },
      ];
    }

    const nestedBlocks = getNestedContainerBlocks(block);
    if (nestedBlocks) {
      return collectTocItems(nestedBlocks);
    }

    return [];
  });
}

export function buildTocItemsFromBlocks(blocks: LayoutBlock[]): TocItem[] {
  return collectTocItems(blocks);
}

export function buildTocItems(document: LayoutDocument | null): TocItem[] {
  if (!document) {
    return [];
  }

  return buildTocItemsFromBlocks(document.blocks);
}

export function getDepthFilteredTocItemsForBlock(block: LayoutBlock, tocItems: TocItem[]): TocItem[] {
  if (block.type !== 'toc' || block.metadata.kind !== 'toc') {
    return [];
  }

  const maxDepth = block.metadata.maxDepth;
  return tocItems.filter((item) => item.depth <= maxDepth);
}

export function getVisibleTocItemsForBlock(block: LayoutBlock, tocItems: TocItem[]): TocItem[] {
  const filteredItems = getDepthFilteredTocItemsForBlock(block, tocItems);
  if (block.type !== 'toc' || block.metadata.kind !== 'toc') {
    return filteredItems;
  }

  const runtimeSlice = block.metadata.runtimeSlice;
  if (!runtimeSlice) {
    return filteredItems;
  }

  return filteredItems.slice(runtimeSlice.startIndex, runtimeSlice.endIndex);
}

export function getTocBlockDisplayTitle(block: LayoutBlock): string {
  if (block.type !== 'toc' || block.metadata.kind !== 'toc') {
    return '目录';
  }

  const baseTitle = block.metadata.title || '目录';
  return block.metadata.runtimeSlice && block.metadata.runtimeSlice.fragmentIndex > 1
    ? `${baseTitle}（续）`
    : baseTitle;
}

export function buildHeadingPageNumberMap(pageLayouts: PageLayout[]): Record<string, number> {
  const pageNumberMap: Record<string, number> = {};

  const collectFromBlocks = (blocks: LayoutBlock[], pageNumber: number) => {
    for (const block of blocks) {
      if (block.type === 'heading' && block.metadata.kind === 'heading' && pageNumberMap[block.id] === undefined) {
        pageNumberMap[block.id] = pageNumber;
      }

      const nestedBlocks = getNestedContainerBlocks(block);
      if (nestedBlocks) {
        collectFromBlocks(nestedBlocks, pageNumber);
      }
    }
  };

  for (const page of pageLayouts) {
    collectFromBlocks(page.blocks, page.pageNumber);
  }

  return pageNumberMap;
}

export function applyPageNumbersToTocItems(
  tocItems: TocItem[],
  headingPageNumberMap: Record<string, number>,
): TocItem[] {
  return tocItems.map((item) => ({
    ...item,
    pageNumber: headingPageNumberMap[item.id],
  }));
}
