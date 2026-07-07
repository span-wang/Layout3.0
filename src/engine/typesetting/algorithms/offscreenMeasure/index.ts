/**
 * 离屏测量分页算法 (offscreen-measure-v1)
 *
 * 核心策略：
 * 1. 两层测量架构：块级快速测量 + 行级精确切分
 * 2. 使用离屏 div 容器进行真实测量
 * 3. 优先使用真实测量高度，缺失时回退到估算高度
 * 4. 文本分割优先在行尾、标点、单词边界
 */

import {
  getLayoutBlockPlainText,
  type LayoutBlock,
  type LayoutListItem,
  type LayoutStyleSheet,
  type LayoutTableRow,
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
import { OFFSCREEN_MEASURE_PAGINATION_ALGORITHM_ID } from '../../algorithmIds';
import type {
  PageLayout,
  PaginationAlgorithmContext,
  PaginationAlgorithmDefinition,
  TableRowMeasurementJob,
  TextFragmentMeasurementJob,
} from '../../types';
import {
  createTableRowMeasurementId,
  createTextFragmentMeasurementId,
  enqueueTableRowMeasurementJob,
  enqueueTextFragmentMeasurementJob,
  getMeasuredBlockHeight,
  getMeasuredTableRowHeight,
  getMeasuredTextFragmentHeight,
} from '../domMeasure/measurementCache';
import { createDomMeasurePage, cloneRuntimeBlock } from '../domMeasure/pageBuilder';
import { createListContinuationBlock, createListFragmentBlock, splitListItemTextAtOffset } from '../domMeasure/listSplit';
import { splitTableRowsAtIndex } from '../domMeasure/tableSplit';
import { splitTextForAvailableLines } from '../domMeasure/textSplit';
import { createMeasurementId } from './offscreenRenderer';
import {
  MeasurementState,
  collectCandidateSplitOffsets,
  findOptimalSplitOffset,
  splitTextRuns,
  estimateTextLineCount,
} from './preciseTextSplit';
import type { OffscreenMeasurementJob } from './types';

// ============== 类型定义 ==============

type TableLayoutBlock = LayoutBlock & {
  type: 'table';
  metadata: { kind: 'table'; rows: LayoutTableRow[]; [key: string]: unknown };
};

interface PlacedBlock {
  block: LayoutBlock;
  height: number;
}

/**
 * 类型守卫：检查是否是表格块
 */
function isTableBlock(block: LayoutBlock): block is TableLayoutBlock {
  return block.type === 'table' && block.metadata.kind === 'table';
}

interface PaginationState {
  pages: PageLayout[];
  currentPage: PageLayout;
  remainingHeight: number;
  queue: LayoutBlock[];
  measuredHeights: Record<string, number>;
  measurementJobs: OffscreenMeasurementJob[];
  measurementState: MeasurementState;
}

// ============== 辅助函数 ==============

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

/**
 * 计算块高度
 * 优先使用已测量的真实高度，否则使用估算
 */
function getBlockHeight(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  styles: LayoutStyleSheet | undefined,
  measuredBlockHeights: Record<string, number> | undefined,
  measurementState: MeasurementState
): number {
  // 1. 优先使用已有的真实测量高度
  const measuredHeight = getMeasuredBlockHeight(block, measuredBlockHeights);
  if (measuredHeight !== null) {
    return measuredHeight;
  }

  // 2. 尝试从离屏测量缓存获取
  const cacheKey = createMeasurementId({ blockId: block.id, width: contract.contentWidthPx });
  const cachedHeight = measurementState.getMeasuredHeight(cacheKey);
  if (cachedHeight !== null) {
    return cachedHeight;
  }

  // 3. 回退到估算高度
  return estimateBlockHeight(block, contract, styles);
}

/**
 * 估算块高度
 */
function estimateBlockHeight(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet
): number {
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
    const rowsHeight = block.metadata.rows.reduce((totalHeight, row) => {
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
        return Math.max(maxHeight, minimumRowHeight, lineCount * lineHeight + tableStyle.cellPaddingY * 2);
      }, 0);
      return totalHeight + rowHeight;
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

/**
 * 创建文本片段块
 */
function createTextFragmentBlock(
  block: LayoutBlock,
  splitOffset: number,
  currentPageText: string,
  remainingText: string
): { currentBlock: LayoutBlock; remainingBlock: LayoutBlock | null } {
  const { currentRuns, remainingRuns } = splitTextRuns(block.textRuns, splitOffset);

  const currentBlock = cloneRuntimeBlock(block, {
    id: `${block.id}-offscreen-fragment`,
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
    return { currentBlock, remainingBlock: null };
  }

  const remainingBlock = cloneRuntimeBlock(block, {
    id: `${block.id}-offscreen-remaining`,
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

  return { currentBlock, remainingBlock };
}

/**
 * 处理文本块的精确分割
 */
function handleTextBlockSplit(
  state: PaginationState,
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  styles: LayoutStyleSheet | undefined,
  measuredTextLineBreaks: Record<string, number[]> | undefined
): void {
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
  const fontFamily = getEffectiveTextRunsFontFamily({
    textRuns: block.textRuns,
    block,
    styles,
  });

  // 计算可用行数
  const safeAvailableHeight = Math.max(
    0,
    state.remainingHeight - (block.blockStyleOverrides.spaceBefore ?? blockStyle.marginTop) - (block.blockStyleOverrides.spaceAfter ?? blockStyle.marginBottom)
  );
  const availableLineCount = Math.floor(safeAvailableHeight / lineHeight);

  // 获取估算分割点
  const splitResult = splitTextForAvailableLines({
    text,
    widthPx: contract.contentWidthPx,
    fontSize,
    fontFamily,
    availableLineCount,
    measuredLineBreaks: measuredTextLineBreaks?.[block.id],
  });

  if (!splitResult) {
    // 无法分割，整个块翻页
    if (state.currentPage.blocks.length > 0) {
      state.pages.push(state.currentPage);
      state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
      state.remainingHeight = contract.contentHeightPx;
    }
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(block, contract, styles));
    return;
  }

  // 收集候选分割点
  const candidates = collectCandidateSplitOffsets(
    text,
    measuredTextLineBreaks?.[block.id]
  );

  // 找到最优分割点
  // 这里使用估算函数，实际测量在测量任务队列中处理
  const estimatedSplitOffset = splitResult.splitOffset;

  // 估算当前页片段高度
  const estimatedLines = estimateTextLineCount(
    text.slice(0, estimatedSplitOffset),
    contract.contentWidthPx,
    fontSize,
    fontFamily,
  );
  const estimatedFragmentHeight =
    (block.blockStyleOverrides.spaceBefore ?? blockStyle.marginTop) +
    estimatedLines * lineHeight;

  // 如果估算高度可以放入，直接放入
  if (estimatedFragmentHeight <= state.remainingHeight) {
    const { currentBlock, remainingBlock } = createTextFragmentBlock(
      block,
      estimatedSplitOffset,
      text.slice(0, estimatedSplitOffset),
      text.slice(estimatedSplitOffset)
    );

    state.currentPage.blocks.push(currentBlock);
    state.remainingHeight = Math.max(0, state.remainingHeight - estimatedFragmentHeight);

    // 开启新页放剩余部分
    state.pages.push(state.currentPage);
    state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
    state.remainingHeight = contract.contentHeightPx;

    if (remainingBlock) {
      state.queue.unshift(remainingBlock);
    }
    return;
  }

  // 估算高度放不下，添加测量任务
  const fragmentId = createMeasurementId({
    blockId: block.id,
    width: contract.contentWidthPx,
  });

  const measurementJob: OffscreenMeasurementJob = {
    id: fragmentId,
    block: cloneRuntimeBlock(block, {
      id: `${block.id}-offscreen-measure`,
      textRuns: block.textRuns,
    }),
    width: contract.contentWidthPx,
  };

  state.measurementJobs.push(measurementJob);

  // 暂时使用估算高度
  state.currentPage.blocks.push(block);
  state.remainingHeight = Math.max(0, state.remainingHeight - estimatedFragmentHeight);
}

/**
 * 处理表格块的分割
 */
function handleTableBlockSplit(
  state: PaginationState,
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  styles: LayoutStyleSheet | undefined,
  measuredTableRowHeights: Record<string, number> | undefined,
  tableRowMeasurementJobs: TableRowMeasurementJob[] | undefined
): void {
  // 使用类型守卫确保 block 是表格块
  if (!isTableBlock(block)) {
    // 不是表格块，直接放入
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(block, contract, styles));
    return;
  }

  // 获取行高
  const rowHeights: number[] = [];
  for (const row of block.metadata.rows) {
    const measuredRowHeight = getMeasuredTableRowHeight(row.id, measuredTableRowHeights);
    if (measuredRowHeight !== null) {
      rowHeights.push(measuredRowHeight);
    } else {
      // 添加测量任务
      const jobId = createTableRowMeasurementId({
        blockId: block.id,
        rowIds: [row.id],
        widthPx: contract.contentWidthPx,
      });
      enqueueTableRowMeasurementJob(tableRowMeasurementJobs, {
        id: jobId,
        block,
        sourceBlockId: block.id,
        rowIds: [row.id],
      });
      // 使用估算高度
      rowHeights.push(estimateBlockHeight(block, contract, styles) / block.metadata.rows.length);
    }
  }

  // 计算能放入的行数
  let consumedHeight = 0;
  let fitRowCount = 0;
  for (let i = 0; i < rowHeights.length; i++) {
    if (consumedHeight + rowHeights[i] > state.remainingHeight) {
      break;
    }
    consumedHeight += rowHeights[i];
    fitRowCount++;
  }

  if (fitRowCount <= 0 && state.currentPage.blocks.length > 0) {
    state.pages.push(state.currentPage);
    state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
    state.remainingHeight = contract.contentHeightPx;
    state.queue.unshift(block);
    return;
  }

  const sliceResult = splitTableRowsAtIndex(block, fitRowCount, state.pages.length);
  if (!sliceResult) {
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(block, contract, styles));
    return;
  }

  const currentBlock = cloneRuntimeBlock(block, {
    id: `${block.id}-offscreen-table-fragment`,
    sourceRange: null,
    blockStyleOverrides: { ...block.blockStyleOverrides, spaceAfter: 0 },
    metadata: { ...block.metadata, rows: sliceResult.currentRows },
  });

  state.currentPage.blocks.push(currentBlock);
  state.remainingHeight = 0;
  state.pages.push(state.currentPage);
  state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
  state.remainingHeight = contract.contentHeightPx;

  const remainingBlock = cloneRuntimeBlock(block, {
    id: `${block.id}-offscreen-table-remaining`,
    sourceRange: null,
    blockStyleOverrides: { ...block.blockStyleOverrides, spaceBefore: 0 },
    metadata: { ...block.metadata, rows: sliceResult.remainingRows },
  });

  state.queue.unshift(remainingBlock);
}

/**
 * 类型守卫：检查是否是列表块
 */
function isListBlock(block: LayoutBlock): block is LayoutBlock & {
  metadata: { kind: 'list'; items: LayoutListItem[]; ordered?: boolean; start?: number };
} {
  return block.type === 'list' && block.metadata.kind === 'list';
}

/**
 * 处理列表块的分割
 */
function handleListBlockSplit(
  state: PaginationState,
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  styles: LayoutStyleSheet | undefined,
  measuredTextLineBreaks: Record<string, number[]> | undefined
): void {
  // 使用类型守卫确保 block 是列表块
  if (!isListBlock(block)) {
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(block, contract, styles));
    return;
  }

  const listStyle = contract.blockStyles.list;
  const listMarginTop = block.blockStyleOverrides.spaceBefore ?? listStyle.marginTop;
  const listMarginBottom = block.blockStyleOverrides.spaceAfter ?? listStyle.marginBottom;
  const fragmentItems: LayoutListItem[] = [];
  let fragmentHeight = listMarginTop + listMarginBottom;
  let nextItemIndex = 0;
  let remainingItem: LayoutListItem | null = null;

  while (nextItemIndex < block.metadata.items.length || remainingItem) {
    const item = remainingItem ?? block.metadata.items[nextItemIndex];
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
    const itemWidth = Math.max(120, contract.contentWidthPx - listStyle.indent);
    const itemLineCount = estimateTextLines(itemText, itemWidth, fontSize, {
      fontFamily: getEffectiveListItemFontFamily({
        item,
        block,
        styles,
      }),
    });
    const itemHeight = (fragmentItems.length === 0 ? 0 : listStyle.itemGap) + itemLineCount * lineHeight;
    const candidateHeight = fragmentHeight + itemHeight;

    if (candidateHeight > state.remainingHeight) {
      if (fragmentItems.length === 0) {
        break;
      }
      break;
    }

    fragmentItems.push(item);
    fragmentHeight = candidateHeight;
    remainingItem = null;
    nextItemIndex++;
  }

  if (fragmentItems.length === 0) {
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(block, contract, styles));
    return;
  }

  const currentBlock = createListFragmentBlock(block, fragmentItems, 0, state.pages.length + 1);
  if (!currentBlock) {
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(block, contract, styles));
    return;
  }
  state.currentPage.blocks.push(currentBlock);
  state.remainingHeight = Math.max(0, state.remainingHeight - fragmentHeight);

  const remainingItems = [
    ...(remainingItem ? [remainingItem] : []),
    ...block.metadata.items.slice(nextItemIndex + (remainingItem ? 1 : 0)),
  ];

  if (remainingItems.length > 0) {
    const remainingBlockBase = cloneRuntimeBlock(block, {
      id: `${block.id}-offscreen-list-remaining-${state.pages.length + 1}`,
      sourceRange: null,
      blockStyleOverrides: { ...block.blockStyleOverrides, spaceBefore: 0 },
    });
    const remainingBlock =
      createListContinuationBlock(
        remainingBlockBase,
        remainingItems,
        nextItemIndex,
        state.pages.length + 2,
      ) ?? remainingBlockBase;
    state.pages.push(state.currentPage);
    state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
    state.remainingHeight = contract.contentHeightPx;
    state.queue.unshift(remainingBlock);
  }
}

// ============== 核心分页算法 ==============

/**
 * 离屏测量分页算法
 */
export function paginateOffscreenMeasureBlocks(context: PaginationAlgorithmContext): PageLayout[] {
  const {
    blocks,
    contract,
    styles,
    measuredBlockHeights,
    measuredTextLineBreaks,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
    measuredTableRowHeights,
    tableRowMeasurementJobs,
  } = context;

  const measurementState = new MeasurementState();

  // 初始化分页状态
  const state: PaginationState = {
    pages: [],
    currentPage: createDomMeasurePage(1, contract),
    remainingHeight: contract.contentHeightPx,
    queue: [...blocks],
    measuredHeights: measuredTextFragmentHeights ?? {},
    measurementJobs: [],
    measurementState,
  };

  // 主循环
  while (state.queue.length > 0) {
    const block = state.queue.shift()!;

    // 处理手动分页符
    if (block.pagination.pageBreakBefore || block.type === 'pageBreak') {
      if (state.currentPage.blocks.length > 0 || state.pages.length === 0) {
        state.pages.push(state.currentPage);
      }
      state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
      state.remainingHeight = contract.contentHeightPx;
      if (block.type === 'pageBreak') {
        continue;
      }
    }

    // 获取块高度
    const blockHeight = getBlockHeight(block, contract, styles, measuredBlockHeights, measurementState);

    // 块可以直接放入当前页
    if (blockHeight <= state.remainingHeight) {
      state.currentPage.blocks.push(block);
      state.remainingHeight -= blockHeight;
      continue;
    }

    // 块无法放入，根据类型处理
    if (block.type === 'image' && block.metadata.kind === 'image') {
      // 图片：放不下就换页
      if (state.currentPage.blocks.length > 0) {
        state.pages.push(state.currentPage);
        state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
        state.remainingHeight = contract.contentHeightPx;
      }
      state.currentPage.blocks.push(block);
      state.remainingHeight = Math.max(0, state.remainingHeight - blockHeight);
      continue;
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      handleTableBlockSplit(state, block, contract, styles, measuredTableRowHeights, tableRowMeasurementJobs);
      continue;
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      handleListBlockSplit(state, block, contract, styles, measuredTextLineBreaks);
      continue;
    }

    if ((block.type === 'heading' || block.type === 'paragraph') && block.metadata.kind) {
      handleTextBlockSplit(state, block, contract, styles, measuredTextLineBreaks);
      continue;
    }

    // 其他类型：换页后重试
    if (state.currentPage.blocks.length > 0) {
      state.pages.push(state.currentPage);
      state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
      state.remainingHeight = contract.contentHeightPx;
      state.queue.unshift(block);
      continue;
    }

    // 空页仍无法放入，强制放入
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - blockHeight);
  }

  // 添加最后一页
  if (state.currentPage.blocks.length > 0 || state.pages.length === 0) {
    state.pages.push(state.currentPage);
  }

  return state.pages;
}

// ============== 算法定义 ==============

export const offscreenMeasurePaginationAlgorithm: PaginationAlgorithmDefinition = {
  id: OFFSCREEN_MEASURE_PAGINATION_ALGORITHM_ID,
  label: '离屏精确测量分页引擎',
  description: '离屏测量分页：使用离屏 div 容器进行真实测量，结合块级快速测量和行级精确切分的两层架构，优先使用真实测量高度，缺失时回退到估算高度。',
  paginate: paginateOffscreenMeasureBlocks,
};
