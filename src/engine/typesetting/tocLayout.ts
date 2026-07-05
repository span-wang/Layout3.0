import {
  getDepthFilteredTocItemsForBlock,
  getVisibleTocItemsForBlock,
  type LayoutBlock,
  type TocBlockMetadata,
  type TocItem,
} from '@/engine/document-model';
import type { ResolvedStyleContract } from '@/engine/style/types';
import { estimateTextLines } from './textMetrics';

export interface TocFragmentBuildResult {
  block: LayoutBlock;
  height: number;
  nextItemIndex: number;
}

type TocLayoutBlock = LayoutBlock & {
  type: 'toc';
  metadata: TocBlockMetadata;
};

const TOC_MARGIN_TOP = 16;
const TOC_MARGIN_BOTTOM = 24;
const TOC_PADDING_X = 20;
const TOC_PADDING_Y = 18;
const TOC_TITLE_HEIGHT = 22;
const TOC_TITLE_GAP = 10;
const TOC_ENTRY_GAP = 8;
const TOC_ENTRY_MIN_HEIGHT = 28;
const TOC_ENTRY_FONT_SIZE = 14;
const TOC_ENTRY_LINE_HEIGHT = 20;
const TOC_ENTRY_DOTS_MIN_WIDTH = 12;
const TOC_ENTRY_PAGE_WIDTH = 28;
const TOC_ENTRY_DEPTH_INDENT = 16;
const TOC_EMPTY_HEIGHT = 18;
const TOC_ENTRY_FONT_FAMILY = '"Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

function getTocMarginTop(block: LayoutBlock): number {
  return block.blockStyleOverrides.spaceBefore ?? TOC_MARGIN_TOP;
}

function getTocMarginBottom(block: LayoutBlock): number {
  return block.blockStyleOverrides.spaceAfter ?? TOC_MARGIN_BOTTOM;
}

function isTocLayoutBlock(block: LayoutBlock): block is TocLayoutBlock {
  return block.type === 'toc' && block.metadata.kind === 'toc';
}

function getTocBaseHeight(block: LayoutBlock): number {
  return (
    getTocMarginTop(block) +
    getTocMarginBottom(block) +
    TOC_PADDING_Y * 2 +
    TOC_TITLE_HEIGHT +
    TOC_TITLE_GAP
  );
}

function estimateTocEntryHeight(item: TocItem, itemIndexInFragment: number, contract: ResolvedStyleContract): number {
  const innerWidth = Math.max(120, contract.singleColumnContentWidthPx - TOC_PADDING_X * 2);
  const depthIndent = Math.max(0, item.depth - 1) * TOC_ENTRY_DEPTH_INDENT;
  const textWidth = Math.max(
    80,
    innerWidth - depthIndent - TOC_ENTRY_DOTS_MIN_WIDTH - TOC_ENTRY_PAGE_WIDTH - TOC_ENTRY_GAP * 2,
  );
  const lineCount = estimateTextLines(item.text, textWidth, TOC_ENTRY_FONT_SIZE, {
    fontFamily: TOC_ENTRY_FONT_FAMILY,
  });

  return (
    (itemIndexInFragment > 0 ? TOC_ENTRY_GAP : 0) +
    Math.max(TOC_ENTRY_MIN_HEIGHT, lineCount * TOC_ENTRY_LINE_HEIGHT)
  );
}

export function estimateTocBlockHeight(
  block: LayoutBlock,
  allTocItems: TocItem[],
  contract: ResolvedStyleContract,
): number {
  if (block.type !== 'toc' || block.metadata.kind !== 'toc') {
    return 0;
  }

  const visibleItems = getVisibleTocItemsForBlock(block, allTocItems);
  if (visibleItems.length === 0) {
    return getTocBaseHeight(block) + TOC_EMPTY_HEIGHT;
  }

  return visibleItems.reduce(
    (total, item, index) => total + estimateTocEntryHeight(item, index, contract),
    getTocBaseHeight(block),
  );
}

function createTocFragmentBlock(
  block: TocLayoutBlock,
  startIndex: number,
  endIndex: number,
  fragmentIndex: number,
  totalItems: number,
): LayoutBlock {
  return {
    ...block,
    sourceRange: fragmentIndex === 1 ? block.sourceRange : null,
    metadata: {
      ...block.metadata,
      runtimeSlice: {
        startIndex,
        endIndex,
        fragmentIndex,
        totalItems,
      },
    },
  };
}

export function buildTocFragment(payload: {
  block: LayoutBlock;
  allTocItems: TocItem[];
  startItemIndex: number;
  availableHeight: number;
  fragmentIndex: number;
  isCurrentPageEmpty: boolean;
  contract: ResolvedStyleContract;
}): TocFragmentBuildResult | null {
  const { block, allTocItems, startItemIndex, availableHeight, fragmentIndex, isCurrentPageEmpty, contract } = payload;
  if (!isTocLayoutBlock(block)) {
    return null;
  }

  const tocBlock = block;
  const filteredItems = getDepthFilteredTocItemsForBlock(tocBlock, allTocItems);
  if (filteredItems.length === 0) {
    const emptyHeight = estimateTocBlockHeight(tocBlock, allTocItems, contract);
    if (emptyHeight <= availableHeight || isCurrentPageEmpty) {
      return {
        block: createTocFragmentBlock(tocBlock, 0, 0, fragmentIndex, 0),
        height: emptyHeight,
        nextItemIndex: 1,
      };
    }

    return null;
  }

  let nextItemIndex = startItemIndex;
  let fragmentHeight = getTocBaseHeight(block);

  while (nextItemIndex < filteredItems.length) {
    const itemHeight = estimateTocEntryHeight(
      filteredItems[nextItemIndex],
      nextItemIndex - startItemIndex,
      contract,
    );
    const candidateHeight = fragmentHeight + itemHeight;
    const mustForceFirstItem = isCurrentPageEmpty && nextItemIndex === startItemIndex;

    if (candidateHeight > availableHeight && !mustForceFirstItem) {
      break;
    }

    fragmentHeight = candidateHeight;
    nextItemIndex += 1;
  }

  if (nextItemIndex === startItemIndex) {
    return null;
  }

  return {
    block: createTocFragmentBlock(tocBlock, startItemIndex, nextItemIndex, fragmentIndex, filteredItems.length),
    height: fragmentHeight,
    nextItemIndex,
  };
}
