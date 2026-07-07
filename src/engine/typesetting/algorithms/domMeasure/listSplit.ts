import type { LayoutBlock, LayoutListItem, TextRun } from '@/engine/document-model';

function buildListRuntimeSlice(
  block: LayoutBlock,
  items: LayoutListItem[],
  startItemIndex: number,
  fragmentIndex: number,
):
  | {
      startIndex: number;
      endIndex: number;
      fragmentIndex: number;
      totalItems: number;
      isContinuation: boolean;
    }
  | null {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return null;
  }

  const existingRuntimeSlice = block.metadata.runtimeSlice;
  const baseStartIndex = existingRuntimeSlice?.startIndex ?? 0;
  const totalItems = existingRuntimeSlice?.totalItems ?? block.metadata.items.length;
  const sliceStartIndex = baseStartIndex + startItemIndex;
  const sliceEndIndex = items.length > 0 ? sliceStartIndex + items.length - 1 : sliceStartIndex;

  return {
    startIndex: sliceStartIndex,
    endIndex: sliceEndIndex,
    fragmentIndex,
    totalItems,
    isContinuation: existingRuntimeSlice?.isContinuation === true || sliceStartIndex > 0,
  };
}

function splitTextRunsByPlainTextLength(textRuns: TextRun[], firstPartLength: number): {
  currentPageRuns: TextRun[];
  remainingRuns: TextRun[];
} {
  const currentPageRuns: TextRun[] = [];
  const remainingRuns: TextRun[] = [];
  let consumedLength = 0;

  textRuns.forEach((run, runIndex) => {
    const runStart = consumedLength;
    const runEnd = runStart + run.text.length;
    consumedLength = runEnd;

    if (runEnd <= firstPartLength) {
      currentPageRuns.push({
        ...run,
        id: `${run.id}-dom-list-frag-${runIndex}`,
        sourceRange: null,
      });
      return;
    }

    if (runStart >= firstPartLength) {
      remainingRuns.push({
        ...run,
        id: `${run.id}-dom-list-rest-${runIndex}`,
        sourceRange: null,
      });
      return;
    }

    const localOffset = Math.max(0, firstPartLength - runStart);
    const currentText = run.text.slice(0, localOffset);
    const remainingText = run.text.slice(localOffset);

    if (currentText) {
      currentPageRuns.push({
        ...run,
        id: `${run.id}-dom-list-frag-${runIndex}`,
        text: currentText,
        sourceRange: null,
      });
    }

    if (remainingText) {
      remainingRuns.push({
        ...run,
        id: `${run.id}-dom-list-rest-${runIndex}`,
        text: remainingText,
        sourceRange: null,
      });
    }
  });

  return {
    currentPageRuns,
    remainingRuns,
  };
}

export function createListItemTextSlice(
  item: LayoutListItem,
  textRuns: TextRun[],
  suffix: string,
  shouldHideMarker = false,
): LayoutListItem {
  return {
    ...item,
    id: `${item.id}-${suffix}`,
    sourceRange: null,
    textRuns,
    runtimePagination: shouldHideMarker
      ? {
          ...item.runtimePagination,
          hideMarker: true,
        }
      : item.runtimePagination,
  };
}

export function splitListItemTextAtOffset(
  item: LayoutListItem,
  splitOffset: number,
  suffix: string,
): { currentItem: LayoutListItem; remainingItem: LayoutListItem } | null {
  const itemText = item.textRuns.map((run) => run.text).join('');
  if (splitOffset <= 0 || splitOffset >= itemText.length) {
    return null;
  }

  const { currentPageRuns, remainingRuns } = splitTextRunsByPlainTextLength(item.textRuns, splitOffset);
  if (currentPageRuns.length === 0 || remainingRuns.length === 0) {
    return null;
  }

  return {
    currentItem: createListItemTextSlice(item, currentPageRuns, `${suffix}-current`, false),
    remainingItem: createListItemTextSlice(item, remainingRuns, `${suffix}-rest`, true),
  };
}

export function createListFragmentBlock(
  block: LayoutBlock,
  items: LayoutListItem[],
  startItemIndex: number,
  fragmentIndex: number,
): LayoutBlock | null {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return null;
  }

  const runtimeSlice = buildListRuntimeSlice(block, items, startItemIndex, fragmentIndex);

  return {
    ...block,
    id: `${block.id}-dom-list-fragment-${fragmentIndex}`,
    sourceRange: null,
    metadata: {
      ...block.metadata,
      start: block.metadata.ordered
        ? (block.metadata.start ?? 1) + startItemIndex
        : block.metadata.start,
      items,
      ...(runtimeSlice ? { runtimeSlice } : {}),
    },
  };
}

export function createListContinuationBlock(
  block: LayoutBlock,
  items: LayoutListItem[],
  startItemIndex: number,
  fragmentIndex: number,
): LayoutBlock | null {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return null;
  }

  const runtimeSlice = buildListRuntimeSlice(block, items, startItemIndex, fragmentIndex);

  return {
    ...block,
    sourceRange: null,
    metadata: {
      ...block.metadata,
      start: block.metadata.ordered
        ? (block.metadata.start ?? 1) + startItemIndex
        : block.metadata.start,
      items,
      ...(runtimeSlice ? { runtimeSlice } : {}),
    },
  };
}
