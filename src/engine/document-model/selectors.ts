import { getTextContentFromRuns } from './operations';
import type {
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

export function findLayoutBlockById(blocks: LayoutBlock[], blockId: string): LayoutBlock | null {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedBlock = findLayoutBlockById(block.metadata.blocks, blockId);
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

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedNode = findSelectedLayoutNodeInfo(block.metadata.blocks, selectedNodeId);
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

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      return collectTocItems(block.metadata.blocks);
    }

    return [];
  });
}

export function buildTocItems(document: LayoutDocument | null): TocItem[] {
  if (!document) {
    return [];
  }

  return collectTocItems(document.blocks);
}

export function buildHeadingPageNumberMap(pageLayouts: PageLayout[]): Record<string, number> {
  const pageNumberMap: Record<string, number> = {};

  const collectFromBlocks = (blocks: LayoutBlock[], pageNumber: number) => {
    for (const block of blocks) {
      if (block.type === 'heading' && block.metadata.kind === 'heading' && pageNumberMap[block.id] === undefined) {
        pageNumberMap[block.id] = pageNumber;
      }

      if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
        collectFromBlocks(block.metadata.blocks, pageNumber);
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
