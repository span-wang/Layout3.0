import {
  getLayoutBlockPlainText,
  type TextRun,
  type LayoutBlock,
  type LayoutListItem,
  type LayoutStyleSheet,
} from '@/engine/document-model';
import type { ResolvedStyleContract, TextBlockStyleRule } from '@/engine/style/types';
import {
  getEffectiveListItemMaxFontSize,
  getEffectiveListItemFontFamily,
  getEffectiveTableCellMaxFontSize,
  getEffectiveTableCellFontFamily,
  getEffectiveTextRunsMaxFontSize,
  getEffectiveTextRunsFontFamily,
  resolveEffectiveTextLineHeight,
} from '@/engine/style/quickTextStyle';
import { estimateTextLines } from '../../textMetrics';
import { DOM_MEASURE_PAGINATION_ALGORITHM_ID } from '../../algorithmIds';
import type {
  PageLayout,
  PaginationAlgorithmContext,
  PaginationAlgorithmDefinition,
} from '../../types';
import {
  createTableRowMeasurementId,
  createTextFragmentMeasurementId,
  enqueueTableRowMeasurementJob,
  enqueueTextFragmentMeasurementJob,
  getMeasuredBlockHeight,
  getMeasuredTableRowHeight,
  getMeasuredTextFragmentHeight,
} from './measurementCache';
import { createDomMeasurePage, cloneRuntimeBlock } from './pageBuilder';
import {
  createListFragmentBlock,
  splitListItemTextAtOffset,
} from './listSplit';
import { splitTableRowsAtIndex } from './tableSplit';
import { splitTextForAvailableLines } from './textSplit';

function getTextBlockStyle(block: LayoutBlock, contract: ResolvedStyleContract): TextBlockStyleRule {
  if (block.type === 'heading' && block.metadata.kind === 'heading') {
    if (block.metadata.depth === 1) {
      return contract.blockStyles.heading1;
    }
    if (block.metadata.depth === 2) {
      return contract.blockStyles.heading2;
    }
    return contract.blockStyles.heading3;
  }

  return contract.blockStyles.paragraph;
}

function getBlockHeight(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
  measuredBlockHeights?: Record<string, number>,
): number {
  const measuredHeight = getMeasuredBlockHeight(block, measuredBlockHeights);
  if (measuredHeight !== null) {
    return measuredHeight;
  }

  if ((block.type === 'heading' && block.metadata.kind === 'heading') || (block.type === 'paragraph' && block.metadata.kind === 'paragraph')) {
    const blockStyle = getTextBlockStyle(block, contract);
    const text = getLayoutBlockPlainText(block);
    const fontSize = getEffectiveTextRunsMaxFontSize({
      textRuns: block.textRuns,
      block,
      styles,
      fallback: blockStyle.fontSize,
    });
    const lineHeight = resolveEffectiveTextLineHeight({
      fontSize,
      baseFontSize: blockStyle.fontSize,
      baseLineHeight: block.blockStyleOverrides.lineHeight ?? blockStyle.lineHeight,
    });
    const lineCount = estimateTextLines(text, contract.contentWidthPx, fontSize, {
      fontFamily: getEffectiveTextRunsFontFamily({
        textRuns: block.textRuns,
        block,
        styles,
      }),
    });
    return (
      (block.blockStyleOverrides.spaceBefore ?? blockStyle.marginTop) +
      lineCount * lineHeight +
      (block.blockStyleOverrides.spaceAfter ?? blockStyle.marginBottom)
    );
  }

  if (block.type === 'list' && block.metadata.kind === 'list') {
    const listStyle = contract.blockStyles.list;
    const listHeight = block.metadata.items.reduce((totalHeight, item, itemIndex) => {
      const itemText = item.textRuns.map((run) => run.text).join('');
      const fontSize = getEffectiveListItemMaxFontSize({
        item,
        block,
        styles,
        fallback: listStyle.fontSize,
      });
      const lineHeight = resolveEffectiveTextLineHeight({
        fontSize,
        baseFontSize: listStyle.fontSize,
        baseLineHeight: block.blockStyleOverrides.lineHeight ?? listStyle.lineHeight,
      });
      const lineCount = estimateTextLines(
        itemText,
        Math.max(120, contract.contentWidthPx - listStyle.indent),
        fontSize,
        {
          fontFamily: getEffectiveListItemFontFamily({
            item,
            block,
            styles,
          }),
        },
      );
      return totalHeight + (itemIndex === 0 ? 0 : listStyle.itemGap) + lineCount * lineHeight;
    }, 0);

    return (
      (block.blockStyleOverrides.spaceBefore ?? listStyle.marginTop) +
      listHeight +
      (block.blockStyleOverrides.spaceAfter ?? listStyle.marginBottom)
    );
  }

  if (block.type === 'table' && block.metadata.kind === 'table') {
    const tableStyle = contract.blockStyles.table;
    const rowsHeight = block.metadata.rows.reduce((totalHeight, row, rowIndex) => {
      const rowHeight = row.cells.reduce((maxHeight, cell) => {
        const cellText = cell.textRuns.map((run) => run.text).join('');
        const fontSize = getEffectiveTableCellMaxFontSize({
          cell,
          block,
          styles,
          fallback: contract.blockStyles.paragraph.fontSize,
        });
        const lineHeight = resolveEffectiveTextLineHeight({
          fontSize,
          baseFontSize: contract.blockStyles.paragraph.fontSize,
          baseLineHeight: contract.blockStyles.paragraph.lineHeight,
        });
        const lineCount = estimateTextLines(
          cellText,
          Math.max(80, contract.contentWidthPx / Math.max(1, row.cells.length)),
          fontSize,
          {
            fontFamily: getEffectiveTableCellFontFamily({
              cell,
              block,
              styles,
            }),
          },
        );
        const minimumRowHeight = cell.isHeader ? tableStyle.headerRowHeight : tableStyle.rowHeight;
        return Math.max(
          maxHeight,
          minimumRowHeight,
          lineCount * lineHeight + tableStyle.cellPaddingY * 2,
        );
      }, 0);

      return totalHeight + (rowIndex === 0 ? 0 : 0) + rowHeight;
    }, 0);

    return (
      (block.blockStyleOverrides.spaceBefore ?? tableStyle.marginTop) +
      rowsHeight +
      (block.blockStyleOverrides.spaceAfter ?? tableStyle.marginBottom)
    );
  }

  if (block.type === 'image' && block.metadata.kind === 'image') {
    const imageStyle = contract.blockStyles.image;
    const imageHeight = block.metadata.heightPx ?? imageStyle.placeholderHeight;
    const captionHeight = block.metadata.showCaption ? imageStyle.captionGap + contract.blockStyles.paragraph.lineHeight : 0;
    return (
      (block.blockStyleOverrides.spaceBefore ?? imageStyle.marginTop) +
      imageHeight +
      captionHeight +
      (block.blockStyleOverrides.spaceAfter ?? imageStyle.marginBottom)
    );
  }

  return Math.max(24, contract.blockStyles.paragraph.lineHeight + 8);
}

function createTextFragmentBlock(
  block: LayoutBlock,
  splitOffset: number,
  currentPageText: string,
  remainingText: string,
): { currentBlock: LayoutBlock; remainingBlock: LayoutBlock | null } {
  const { currentRuns, remainingRuns } = splitTextRuns(block.textRuns, splitOffset);

  const currentBlock = cloneRuntimeBlock(block, {
    id: `${block.id}-dom-fragment`,
    sourceRange: null,
    blockStyleOverrides: {
      ...block.blockStyleOverrides,
      spaceAfter: 0,
    },
    textRuns: currentRuns,
    metadata:
      block.type === 'heading' && block.metadata.kind === 'heading'
        ? { ...block.metadata, text: currentPageText }
        : block.type === 'paragraph' && block.metadata.kind === 'paragraph'
          ? { ...block.metadata, text: currentPageText }
          : block.metadata,
  });

  if (!remainingText) {
    return {
      currentBlock,
      remainingBlock: null,
    };
  }

  const remainingBlock = cloneRuntimeBlock(block, {
    id: `${block.id}-dom-remaining`,
    sourceRange: null,
    blockStyleOverrides: {
      ...block.blockStyleOverrides,
      spaceBefore: 0,
    },
    textRuns: remainingRuns,
    metadata:
      block.type === 'heading' && block.metadata.kind === 'heading'
        ? { ...block.metadata, text: remainingText }
        : block.type === 'paragraph' && block.metadata.kind === 'paragraph'
          ? { ...block.metadata, text: remainingText }
          : block.metadata,
  });

  return {
    currentBlock,
    remainingBlock,
  };
}

function createTextSliceBlock(
  block: LayoutBlock,
  startOffset: number,
  endOffset: number,
  options: {
    idSuffix: string;
    omitLeadingSpaceBefore?: boolean;
    omitTrailingSpaceAfter?: boolean;
  },
): LayoutBlock | null {
  const text = getLayoutBlockPlainText(block);
  const safeStartOffset = Math.max(0, Math.min(text.length, startOffset));
  const safeEndOffset = Math.max(safeStartOffset, Math.min(text.length, endOffset));
  const slicedText = text.slice(safeStartOffset, safeEndOffset);
  if (!slicedText) {
    return null;
  }

  const { remainingRuns: afterStartRuns } = splitTextRuns(block.textRuns, safeStartOffset);
  const { currentRuns } = splitTextRuns(afterStartRuns, safeEndOffset - safeStartOffset);
  if (currentRuns.length === 0) {
    return null;
  }

  const nextBlockStyleOverrides = {
    ...block.blockStyleOverrides,
  };
  if (options.omitLeadingSpaceBefore) {
    nextBlockStyleOverrides.spaceBefore = 0;
  }
  if (options.omitTrailingSpaceAfter) {
    nextBlockStyleOverrides.spaceAfter = 0;
  }

  return cloneRuntimeBlock(block, {
    id: `${block.id}-${options.idSuffix}`,
    sourceRange: null,
    blockStyleOverrides: nextBlockStyleOverrides,
    textRuns: currentRuns,
    metadata:
      block.type === 'heading' && block.metadata.kind === 'heading'
        ? { ...block.metadata, text: slicedText }
        : block.type === 'paragraph' && block.metadata.kind === 'paragraph'
          ? { ...block.metadata, text: slicedText }
          : block.metadata,
  });
}

function splitTextRuns(textRuns: TextRun[], splitOffset: number): {
  currentRuns: TextRun[];
  remainingRuns: TextRun[];
} {
  const currentRuns: TextRun[] = [];
  const remainingRuns: TextRun[] = [];
  let cursor = 0;

  textRuns.forEach((run, runIndex) => {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;

    if (runEnd <= splitOffset) {
      currentRuns.push({ ...run });
      return;
    }

    if (runStart >= splitOffset) {
      remainingRuns.push({ ...run });
      return;
    }

    const localOffset = Math.max(0, splitOffset - runStart);
    const currentText = run.text.slice(0, localOffset);
    const remainingText = run.text.slice(localOffset);

    if (currentText) {
      currentRuns.push({
        ...run,
        id: `${run.id}-dom-frag-${runIndex}`,
        text: currentText,
        sourceRange: null,
      });
    }

    if (remainingText) {
      remainingRuns.push({
        ...run,
        id: `${run.id}-dom-rest-${runIndex}`,
        text: remainingText,
        sourceRange: null,
      });
    }
  });

  return {
    currentRuns,
    remainingRuns,
  };
}

function collectCandidateSplitOffsets(params: {
  text: string;
  availableLineCount: number;
  measuredLineBreaks?: number[];
  estimatedSplitOffset: number;
}): number[] {
  const { text, availableLineCount, measuredLineBreaks, estimatedSplitOffset } = params;
  const candidates = new Set<number>();

  if (measuredLineBreaks && measuredLineBreaks.length > 0) {
    measuredLineBreaks
      .filter((offset) => offset > 0 && offset < text.length)
      .slice(0, Math.max(1, availableLineCount))
      .forEach((offset) => candidates.add(offset));
  }

  if (estimatedSplitOffset > 0 && estimatedSplitOffset < text.length) {
    candidates.add(estimatedSplitOffset);
  }

  return Array.from(candidates).sort((left, right) => left - right);
}

function resolveMeasuredTextSplit(params: {
  block: LayoutBlock;
  text: string;
  widthPx: number;
  remainingHeight: number;
  splitOffset: number;
  availableLineCount: number;
  measuredLineBreaks?: number[];
  measuredTextFragmentHeights?: Record<string, number>;
  textFragmentMeasurementJobs?: PaginationAlgorithmContext['textFragmentMeasurementJobs'];
}): { splitOffset: number; measuredHeight: number | null } {
  const {
    block,
    text,
    widthPx,
    remainingHeight,
    splitOffset,
    availableLineCount,
    measuredLineBreaks,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
  } = params;
  const candidateOffsets = collectCandidateSplitOffsets({
    text,
    availableLineCount,
    measuredLineBreaks,
    estimatedSplitOffset: splitOffset,
  });
  let bestMeasuredFit: { splitOffset: number; height: number } | null = null;
  let requestedCandidate: { splitOffset: number; height: number | null } | null = null;

  for (const candidateOffset of candidateOffsets) {
    const fragmentId = createTextFragmentMeasurementId({
      blockId: block.id,
      startOffset: 0,
      endOffset: candidateOffset,
      widthPx,
    });
    const fragmentBlock = createTextSliceBlock(block, 0, candidateOffset, {
      idSuffix: `dom-measure-job-${candidateOffset}`,
      omitTrailingSpaceAfter: true,
    });
    if (fragmentBlock) {
      enqueueTextFragmentMeasurementJob(textFragmentMeasurementJobs, {
        id: fragmentId,
        block: fragmentBlock,
        sourceBlockId: block.id,
        startOffset: 0,
        endOffset: candidateOffset,
      });
    }

    const measuredHeight = getMeasuredTextFragmentHeight(fragmentId, measuredTextFragmentHeights);
    if (measuredHeight === null) {
      if (candidateOffset === splitOffset) {
        requestedCandidate = { splitOffset: candidateOffset, height: null };
      }
      continue;
    }

    if (candidateOffset === splitOffset) {
      requestedCandidate = { splitOffset: candidateOffset, height: measuredHeight };
    }

    if (measuredHeight <= remainingHeight) {
      bestMeasuredFit = { splitOffset: candidateOffset, height: measuredHeight };
    }
  }

  if (requestedCandidate?.height !== null && requestedCandidate?.height !== undefined && requestedCandidate.height <= remainingHeight) {
    return {
      splitOffset,
      measuredHeight: requestedCandidate.height,
    };
  }

  if (bestMeasuredFit) {
    return {
      splitOffset: bestMeasuredFit.splitOffset,
      measuredHeight: bestMeasuredFit.height,
    };
  }

  return {
    splitOffset,
    measuredHeight: requestedCandidate?.height ?? null,
  };
}

function getListTextWidthPx(block: LayoutBlock, contract: ResolvedStyleContract): number {
  return Math.max(120, contract.contentWidthPx - contract.blockStyles.list.indent);
}

function estimateListItemHeight(params: {
  block: LayoutBlock;
  item: LayoutListItem;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  fragmentItemIndex: number;
  measuredTextLineBreaks?: Record<string, number[]>;
}): number {
  const { block, item, contract, styles, fragmentItemIndex, measuredTextLineBreaks } = params;
  const listStyle = contract.blockStyles.list;
  const itemText = item.textRuns.map((run) => run.text).join('');
  const fontSize = getEffectiveListItemMaxFontSize({
    item,
    block,
    styles,
    fallback: listStyle.fontSize,
  });
  const lineHeight = resolveEffectiveTextLineHeight({
    fontSize,
    baseFontSize: listStyle.fontSize,
    baseLineHeight: block.blockStyleOverrides.lineHeight ?? listStyle.lineHeight,
  });
  const measuredLineCount = measuredTextLineBreaks?.[item.id]?.length;
  const lineCount = measuredLineCount ?? estimateTextLines(itemText, getListTextWidthPx(block, contract), fontSize, {
    fontFamily: getEffectiveListItemFontFamily({
      item,
      block,
      styles,
    }),
  });
  return (fragmentItemIndex === 0 ? 0 : listStyle.itemGap) + lineCount * lineHeight;
}

function resolveMeasuredListItemSplit(params: {
  block: LayoutBlock;
  item: LayoutListItem;
  widthPx: number;
  remainingHeight: number;
  splitOffset: number;
  availableLineCount: number;
  measuredLineBreaks?: number[];
  measuredTextFragmentHeights?: Record<string, number>;
  textFragmentMeasurementJobs?: PaginationAlgorithmContext['textFragmentMeasurementJobs'];
  fragmentSuffix: string;
}): { splitOffset: number; measuredHeight: number | null } {
  const {
    block,
    item,
    widthPx,
    remainingHeight,
    splitOffset,
    availableLineCount,
    measuredLineBreaks,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
    fragmentSuffix,
  } = params;
  const itemText = item.textRuns.map((run) => run.text).join('');
  const candidateOffsets = collectCandidateSplitOffsets({
    text: itemText,
    availableLineCount,
    measuredLineBreaks,
    estimatedSplitOffset: splitOffset,
  });
  let bestMeasuredFit: { splitOffset: number; height: number } | null = null;
  let requestedCandidateHeight: number | null = null;

  for (const candidateOffset of candidateOffsets) {
    const splitItems = splitListItemTextAtOffset(item, candidateOffset, `${fragmentSuffix}-${candidateOffset}`);
    if (!splitItems) {
      continue;
    }

    const fragmentBlock = createListFragmentBlock(block, [splitItems.currentItem], 0, candidateOffset);
    if (!fragmentBlock) {
      continue;
    }

    const fragmentId = createTextFragmentMeasurementId({
      blockId: item.id,
      startOffset: 0,
      endOffset: candidateOffset,
      widthPx,
    });
    enqueueTextFragmentMeasurementJob(textFragmentMeasurementJobs, {
      id: fragmentId,
      block: fragmentBlock,
      sourceBlockId: block.id,
      startOffset: 0,
      endOffset: candidateOffset,
    });

    const measuredHeight = getMeasuredTextFragmentHeight(fragmentId, measuredTextFragmentHeights);
    if (candidateOffset === splitOffset) {
      requestedCandidateHeight = measuredHeight;
    }
    if (measuredHeight !== null && measuredHeight <= remainingHeight) {
      bestMeasuredFit = { splitOffset: candidateOffset, height: measuredHeight };
    }
  }

  if (requestedCandidateHeight !== null && requestedCandidateHeight <= remainingHeight) {
    return {
      splitOffset,
      measuredHeight: requestedCandidateHeight,
    };
  }

  if (bestMeasuredFit) {
    return {
      splitOffset: bestMeasuredFit.splitOffset,
      measuredHeight: bestMeasuredFit.height,
    };
  }

  return {
    splitOffset,
    measuredHeight: requestedCandidateHeight,
  };
}

function resolveTableRowHeights(params: {
  block: LayoutBlock;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTableRowHeights?: Record<string, number>;
  tableRowMeasurementJobs?: PaginationAlgorithmContext['tableRowMeasurementJobs'];
}): number[] {
  const {
    block,
    contract,
    styles,
    measuredTableRowHeights,
    tableRowMeasurementJobs,
  } = params;
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return [];
  }

  const unresolvedRows = block.metadata.rows.filter(
    (row) => getMeasuredTableRowHeight(row.id, measuredTableRowHeights) === null,
  );
  if (unresolvedRows.length > 0) {
    enqueueTableRowMeasurementJob(tableRowMeasurementJobs, {
      id: createTableRowMeasurementId({
        blockId: block.id,
        rowIds: unresolvedRows.map((row) => row.id),
        widthPx: contract.contentWidthPx,
      }),
      block,
      sourceBlockId: block.id,
      rowIds: unresolvedRows.map((row) => row.id),
    });
  }

  return block.metadata.rows.map((row) => {
    const measuredRowHeight = getMeasuredTableRowHeight(row.id, measuredTableRowHeights);
    if (measuredRowHeight !== null) {
      return measuredRowHeight;
    }

    return getBlockHeight(
      {
        ...block,
        metadata: { ...block.metadata, rows: [row] },
      } as LayoutBlock,
      contract,
      styles,
      undefined,
    );
  });
}

function paginateSingleColumnDomMeasure(context: PaginationAlgorithmContext): PageLayout[] {
  const {
    blocks,
    contract,
    styles,
    measuredBlockHeights,
    measuredTableRowHeights,
    measuredTextLineBreaks,
    measuredTextFragmentHeights,
    tableRowMeasurementJobs,
    textFragmentMeasurementJobs,
  } = context;
  const pages: PageLayout[] = [];
  let currentPage = createDomMeasurePage(1, contract);
  let remainingHeight = contract.contentHeightPx;
  const queue = [...blocks];

  while (queue.length > 0) {
    const block = queue.shift()!;

    if (block.pagination.pageBreakBefore || block.type === 'pageBreak') {
      if (currentPage.blocks.length > 0 || pages.length === 0) {
        pages.push(currentPage);
      }
      currentPage = createDomMeasurePage(pages.length + 1, contract);
      remainingHeight = contract.contentHeightPx;
      if (block.type === 'pageBreak') {
        continue;
      }
    }

    const blockHeight = getBlockHeight(block, contract, styles, measuredBlockHeights);
    if (blockHeight <= remainingHeight) {
      currentPage.blocks.push(block);
      remainingHeight -= blockHeight;
      if (block.pagination.pageBreakAfter) {
        pages.push(currentPage);
        currentPage = createDomMeasurePage(pages.length + 1, contract);
        remainingHeight = contract.contentHeightPx;
      }
      continue;
    }

    if (block.type === 'image' && block.metadata.kind === 'image') {
      if (currentPage.blocks.length > 0) {
        pages.push(currentPage);
        currentPage = createDomMeasurePage(pages.length + 1, contract);
        remainingHeight = contract.contentHeightPx;
      }
      currentPage.blocks.push(block);
      remainingHeight = Math.max(0, remainingHeight - blockHeight);
      continue;
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      const rowHeights = resolveTableRowHeights({
        block,
        contract,
        styles,
        measuredTableRowHeights,
        tableRowMeasurementJobs,
      });
      let consumedHeight = 0;
      let fitRowCount = 0;
      for (let index = 0; index < rowHeights.length; index += 1) {
        if (consumedHeight + rowHeights[index] > remainingHeight) {
          break;
        }
        consumedHeight += rowHeights[index];
        fitRowCount += 1;
      }

      if (fitRowCount <= 0 && currentPage.blocks.length > 0) {
        pages.push(currentPage);
        currentPage = createDomMeasurePage(pages.length + 1, contract);
        remainingHeight = contract.contentHeightPx;
        queue.unshift(block);
        continue;
      }

      const sliceResult = splitTableRowsAtIndex(block, fitRowCount, pages.length);
      if (!sliceResult) {
        currentPage.blocks.push(block);
        remainingHeight = Math.max(0, remainingHeight - blockHeight);
        continue;
      }

      const currentBlock = cloneRuntimeBlock(block, {
        id: `${block.id}-dom-table-fragment`,
        sourceRange: null,
        blockStyleOverrides: {
          ...block.blockStyleOverrides,
          spaceAfter: 0,
        },
        metadata: {
          ...block.metadata,
          rows: sliceResult.currentRows,
        },
      });
      const remainingBlock = cloneRuntimeBlock(block, {
        id: `${block.id}-dom-table-remaining`,
        sourceRange: null,
        blockStyleOverrides: {
          ...block.blockStyleOverrides,
          spaceBefore: 0,
        },
        metadata: {
          ...block.metadata,
          rows: sliceResult.remainingRows,
        },
      });

      currentPage.blocks.push(currentBlock);
      remainingHeight = 0;
      pages.push(currentPage);
      currentPage = createDomMeasurePage(pages.length + 1, contract);
      remainingHeight = contract.contentHeightPx;
      queue.unshift(remainingBlock);
      continue;
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      const listStyle = contract.blockStyles.list;
      const listMarginTop = block.blockStyleOverrides.spaceBefore ?? listStyle.marginTop;
      const listMarginBottom = block.blockStyleOverrides.spaceAfter ?? listStyle.marginBottom;
      const fragmentItems: LayoutListItem[] = [];
      let fragmentHeight = listMarginTop + listMarginBottom;
      let nextItemIndex = 0;
      let remainingItem: LayoutListItem | null = null;

      while (nextItemIndex < block.metadata.items.length || remainingItem) {
        const item = remainingItem ?? block.metadata.items[nextItemIndex];
        const itemHeight = estimateListItemHeight({
          block,
          item,
          contract,
          styles,
          fragmentItemIndex: fragmentItems.length,
          measuredTextLineBreaks,
        });
        const candidateHeight = fragmentHeight + itemHeight;
        const isCurrentPageEmpty = currentPage.blocks.length === 0 && fragmentItems.length === 0;

        if (candidateHeight > remainingHeight) {
          const itemText = item.textRuns.map((run) => run.text).join('');
          const fontSize = getEffectiveListItemMaxFontSize({
            item,
            block,
            styles,
            fallback: listStyle.fontSize,
          });
          const lineHeight = resolveEffectiveTextLineHeight({
            fontSize,
            baseFontSize: listStyle.fontSize,
            baseLineHeight: block.blockStyleOverrides.lineHeight ?? listStyle.lineHeight,
          });
          const itemGap = fragmentItems.length === 0 ? 0 : listStyle.itemGap;
          const usableHeight = Math.max(0, remainingHeight - fragmentHeight - itemGap);
          const availableLineCount = Math.floor(usableHeight / lineHeight);
          const splitResult = splitTextForAvailableLines({
            text: itemText,
            widthPx: getListTextWidthPx(block, contract),
            fontSize,
            fontFamily: getEffectiveListItemFontFamily({
              item,
              block,
              styles,
            }),
            availableLineCount,
            measuredLineBreaks: measuredTextLineBreaks?.[item.id],
          });

          if (splitResult) {
            const measuredSplit = resolveMeasuredListItemSplit({
              block,
              item,
              widthPx: getListTextWidthPx(block, contract),
              remainingHeight: Math.max(0, remainingHeight - fragmentHeight),
              splitOffset: splitResult.splitOffset,
              availableLineCount,
              measuredLineBreaks: measuredTextLineBreaks?.[item.id],
              measuredTextFragmentHeights,
              textFragmentMeasurementJobs,
              fragmentSuffix: `dom-list-${nextItemIndex}`,
            });
            const splitItems = splitListItemTextAtOffset(
              item,
              measuredSplit.splitOffset,
              `dom-list-${pages.length}-${nextItemIndex}`,
            );
            if (splitItems) {
              fragmentItems.push(splitItems.currentItem);
              fragmentHeight +=
                measuredSplit.measuredHeight ??
                estimateListItemHeight({
                  block,
                  item: splitItems.currentItem,
                  contract,
                  styles,
                  fragmentItemIndex: fragmentItems.length - 1,
                  measuredTextLineBreaks,
                });
              remainingItem = splitItems.remainingItem;
              break;
            }
          }

          if (!isCurrentPageEmpty) {
            break;
          }

          if (fragmentItems.length === 0) {
            break;
          }
        }

        fragmentItems.push(item);
        fragmentHeight = candidateHeight;
        remainingItem = null;
        nextItemIndex += 1;
      }

      if (fragmentItems.length === 0) {
        currentPage.blocks.push(block);
        remainingHeight = Math.max(0, remainingHeight - blockHeight);
        continue;
      }

      const currentBlock = createListFragmentBlock(block, fragmentItems, 0, pages.length + 1);
      if (!currentBlock) {
        currentPage.blocks.push(block);
        remainingHeight = Math.max(0, remainingHeight - blockHeight);
        continue;
      }

      currentPage.blocks.push(currentBlock);
      remainingHeight = Math.max(0, remainingHeight - fragmentHeight);

      const remainingItems = [
        ...(remainingItem ? [remainingItem] : []),
        // 当前项如果刚被拆成“当前页片段 + 剩余片段”，后续队列只需要保留剩余片段，
        // 不能再把原始整项从 nextItemIndex 重新切回去，否则分页不会前进。
        ...block.metadata.items.slice(nextItemIndex + 1),
      ];
      if (remainingItems.length > 0) {
        const remainingBlock = cloneRuntimeBlock(block, {
          id: `${block.id}-dom-list-remaining-${pages.length + 1}`,
          sourceRange: null,
          blockStyleOverrides: {
            ...block.blockStyleOverrides,
            spaceBefore: 0,
          },
          metadata: {
            ...block.metadata,
            start: block.metadata.ordered
              ? (block.metadata.start ?? 1) + nextItemIndex
              : block.metadata.start,
            items: remainingItems,
          },
        });
        pages.push(currentPage);
        currentPage = createDomMeasurePage(pages.length + 1, contract);
        remainingHeight = contract.contentHeightPx;
        queue.unshift(remainingBlock);
        continue;
      }

      if (block.pagination.pageBreakAfter) {
        pages.push(currentPage);
        currentPage = createDomMeasurePage(pages.length + 1, contract);
        remainingHeight = contract.contentHeightPx;
      }
      continue;
    }

    if (
      (block.type === 'heading' && block.metadata.kind === 'heading') ||
      (block.type === 'paragraph' && block.metadata.kind === 'paragraph')
    ) {
      const blockStyle = getTextBlockStyle(block, contract);
      const text = getLayoutBlockPlainText(block);
      const fontSize = getEffectiveTextRunsMaxFontSize({
        textRuns: block.textRuns,
        block,
        styles,
        fallback: blockStyle.fontSize,
      });
      const lineHeight = resolveEffectiveTextLineHeight({
        fontSize,
        baseFontSize: blockStyle.fontSize,
        baseLineHeight: block.blockStyleOverrides.lineHeight ?? blockStyle.lineHeight,
      });
      const safeAvailableHeight = Math.max(
        0,
        remainingHeight - (block.blockStyleOverrides.spaceBefore ?? blockStyle.marginTop) - (block.blockStyleOverrides.spaceAfter ?? blockStyle.marginBottom),
      );
      const availableLineCount = Math.floor(safeAvailableHeight / lineHeight);
      const splitResult = splitTextForAvailableLines({
        text,
        widthPx: contract.contentWidthPx,
        fontSize,
        fontFamily: getEffectiveTextRunsFontFamily({
          textRuns: block.textRuns,
          block,
          styles,
        }),
        availableLineCount,
        measuredLineBreaks: measuredTextLineBreaks?.[block.id],
      });

      if (!splitResult) {
        if (currentPage.blocks.length > 0) {
          pages.push(currentPage);
          currentPage = createDomMeasurePage(pages.length + 1, contract);
          remainingHeight = contract.contentHeightPx;
          queue.unshift(block);
          continue;
        }

        currentPage.blocks.push(block);
        remainingHeight = Math.max(0, remainingHeight - blockHeight);
        continue;
      }

      const measuredSplit = resolveMeasuredTextSplit({
        block,
        text,
        widthPx: contract.contentWidthPx,
        remainingHeight,
        splitOffset: splitResult.splitOffset,
        availableLineCount,
        measuredLineBreaks: measuredTextLineBreaks?.[block.id],
        measuredTextFragmentHeights,
        textFragmentMeasurementJobs,
      });
      const measuredCurrentPageText = text.slice(0, measuredSplit.splitOffset);
      const measuredRemainingText = text.slice(measuredSplit.splitOffset);
      const { currentBlock, remainingBlock } = createTextFragmentBlock(
        block,
        measuredSplit.splitOffset,
        measuredCurrentPageText,
        measuredRemainingText,
      );
      currentPage.blocks.push(currentBlock);
      remainingHeight =
        measuredSplit.measuredHeight === null
          ? 0
          : Math.max(0, remainingHeight - measuredSplit.measuredHeight);
      pages.push(currentPage);
      currentPage = createDomMeasurePage(pages.length + 1, contract);
      remainingHeight = contract.contentHeightPx;
      if (remainingBlock) {
        queue.unshift(remainingBlock);
      }
      continue;
    }

    if (currentPage.blocks.length > 0) {
      pages.push(currentPage);
      currentPage = createDomMeasurePage(pages.length + 1, contract);
      remainingHeight = contract.contentHeightPx;
      queue.unshift(block);
      continue;
    }

    currentPage.blocks.push(block);
    remainingHeight = Math.max(0, remainingHeight - blockHeight);
  }

  if (currentPage.blocks.length > 0 || pages.length === 0) {
    pages.push(currentPage);
  }

  return pages;
}

export function paginateDomMeasureBlocks(context: PaginationAlgorithmContext): PageLayout[] {
  return paginateSingleColumnDomMeasure(context);
}

export const domMeasurePaginationAlgorithm: PaginationAlgorithmDefinition = {
  id: DOM_MEASURE_PAGINATION_ALGORITHM_ID,
  label: '真实测量分页引擎',
  description: '单栏真实测量分页：优先使用隐藏测量层的真实块高与真实换行数据，按页面可用高度逐块放入，必要时对长文本和长表格做保守切分。',
  paginate: paginateDomMeasureBlocks,
};
