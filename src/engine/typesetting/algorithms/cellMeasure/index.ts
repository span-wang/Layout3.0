/**
 * 单元格级精确测量分页算法 (cell-measure-v2)
 *
 * 核心策略：
 * 1. 逐单元格离屏测量：每个单元格独立放入离屏容器测量真实高度
 * 2. 按列宽分配行高：取该行所有单元格最大高度
 * 3. 支持单元格内容跨页分割：单格内容可跨两页（行内分割）
 * 4. 支持跨列/跨行合并单元格的识别与保持
 * 5. 复用现有离屏测量架构
 */

import {
  getLayoutBlockPlainText,
  type LayoutBlock,
  type LayoutListItem,
  type LayoutStyleSheet,
  type LayoutTableRow,
} from '@/engine/document-model';
import type { ResolvedStyleContract, TextBlockStyleRule } from '@/engine/style/types';
import { measureTextSplitOffsetForLineCount } from '@/engine/font-metrics';
import {
  getEffectiveListItemMaxFontSize,
  getEffectiveListItemFontFamily,
  getEffectiveTableCellMaxFontSize,
  getEffectiveTextRunsMaxFontSize,
  getEffectiveTextRunsFontFamily,
  resolveEffectiveTextLineHeight,
} from '@/engine/style/quickTextStyle';
import { estimateTextLines } from '../../textMetrics';
import { CELL_MEASURE_PAGINATION_ALGORITHM_ID } from '../../algorithmIds';
import type {
  PageLayout,
  PaginationAlgorithmContext,
  PaginationAlgorithmDefinition,
  MeasuredCellHeights,
  MeasuredCellFragmentHeights,
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
import {
  createCellMeasurementId,
  getMeasuredCellHeight,
  getMeasuredCellFragmentHeight,
} from './measurementCache';
import {
  splitTableRowsAtCellIndex,
  splitCellAtOffset,
  isMergedCell,
  estimateCellHeight,
} from './cellSplit';

// ============== 类型定义 ==============

type TableLayoutBlock = LayoutBlock & {
  type: 'table';
  metadata: { kind: 'table'; rows: LayoutTableRow[]; [key: string]: unknown };
};

/**
 * 类型守卫：检查是否是表格块
 */
function isTableBlock(block: LayoutBlock): block is TableLayoutBlock {
  return block.type === 'table' && block.metadata.kind === 'table';
}

interface CellMeasurePaginationState {
  pages: PageLayout[];
  currentPage: PageLayout;
  remainingHeight: number;
  queue: LayoutBlock[];
  measuredHeights: Record<string, number>;
  measuredCellHeights: MeasuredCellHeights;
  measuredCellFragmentHeights: MeasuredCellFragmentHeights;
  cellMeasurementJobs: CellMeasurementJob[];
}

interface CellMeasurementJob {
  id: string;
  block: LayoutBlock;
  cellId: string;
  width: number;
  charOffset?: number;
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
 * 获取列宽数组（均匀分配）
 */
function getColumnWidths(block: LayoutBlock, contentWidth: number): number[] {
  if (!isTableBlock(block)) {
    return [];
  }

  const columnCount = block.metadata.rows[0]?.cells.length ?? 1;
  const baseWidth = contentWidth / columnCount;
  return Array.from({ length: columnCount }, () => baseWidth);
}

/**
 * 获取行高（基于单元格测量）
 */
function getRowHeight(
  row: LayoutTableRow,
  columnWidths: number[],
  measuredCellHeights: MeasuredCellHeights,
  tableStyle: ResolvedStyleContract['blockStyles']['table'],
  contract: ResolvedStyleContract,
  block: LayoutBlock
): number {
  let maxHeight = 0;

  for (const cell of row.cells) {
    // 优先使用真实测量高度
    const measuredHeight = getMeasuredCellHeight(cell.id, measuredCellHeights);
    if (measuredHeight !== null) {
      maxHeight = Math.max(maxHeight, measuredHeight);
      continue;
    }

    // 尝试估算
    const colIndex = row.cells.indexOf(cell); // 使用单元格在行中的索引
    const cellWidth = colIndex >= 0 && colIndex < columnWidths.length ? columnWidths[colIndex] : 100;
    const fontSize = getEffectiveTableCellMaxFontSize({
      cell,
      block,
      styles: undefined,
      fallback: contract.blockStyles.paragraph.fontSize,
    });
    const lineHeight = resolveEffectiveTextLineHeight({
      fontSize,
      baseFontSize: contract.blockStyles.paragraph.fontSize,
      baseLineHeight: contract.blockStyles.paragraph.lineHeight,
    });
    const estimatedHeight = estimateCellHeight(cell, cellWidth, fontSize, lineHeight);
    const minimumHeight = cell.isHeader ? tableStyle.headerRowHeight : tableStyle.rowHeight;
    maxHeight = Math.max(maxHeight, Math.max(minimumHeight, estimatedHeight));
  }

  return maxHeight;
}

/**
 * 获取表格总高度
 */
function getTableHeight(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  measuredCellHeights: MeasuredCellHeights,
  cellMeasurementJobs: CellMeasurementJob[]
): number {
  if (!isTableBlock(block)) {
    return 0;
  }

  const tableStyle = contract.blockStyles.table;
  const columnWidths = getColumnWidths(block, contract.contentWidthPx);

  const rowsHeight = block.metadata.rows.reduce((totalHeight, row) => {
    const rowHeight = getRowHeight(row, columnWidths, measuredCellHeights, tableStyle, contract, block);
    return totalHeight + rowHeight;
  }, 0);

  return (
    (block.blockStyleOverrides.spaceBefore ?? tableStyle.marginTop) +
    rowsHeight +
    (block.blockStyleOverrides.spaceAfter ?? tableStyle.marginBottom)
  );
}

/**
 * 估算块高度（用于没有测量结果时的回退）
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
    return getTableHeight(block, contract, {}, []);
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
    id: `${block.id}-cell-fragment`,
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
    id: `${block.id}-cell-remaining`,
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
 * 分割 TextRun 数组
 */
function splitTextRuns(textRuns: LayoutBlock['textRuns'], splitOffset: number): {
  currentRuns: LayoutBlock['textRuns'];
  remainingRuns: LayoutBlock['textRuns'];
} {
  const currentRuns: LayoutBlock['textRuns'] = [];
  const remainingRuns: LayoutBlock['textRuns'] = [];
  let cursor = 0;

  textRuns.forEach((run, runIndex) => {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;

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
        id: `${run.id}-frag-${runIndex}`,
        text: currentText,
        sourceRange: null,
      });
    }

    if (remainingText) {
      remainingRuns.push({
        ...run,
        id: `${run.id}-rest-${runIndex}`,
        text: remainingText,
        sourceRange: null,
      });
    }
  });

  return { currentRuns, remainingRuns };
}

/**
 * 类型守卫：检查是否是列表块
 */
function isListBlock(block: LayoutBlock): block is LayoutBlock & {
  metadata: { kind: 'list'; items: LayoutListItem[]; ordered?: boolean; start?: number };
} {
  return block.type === 'list' && block.metadata.kind === 'list';
}

// ============== 核心分页算法 ==============

/**
 * 处理表格块的单元格级分割
 */
function handleTableCellSplit(
  state: CellMeasurePaginationState,
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  measuredTextLineBreaks: Record<string, number[]> | undefined
): void {
  if (!isTableBlock(block)) {
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(block, contract));
    return;
  }

  const tableStyle = contract.blockStyles.table;
  const columnWidths = getColumnWidths(block, contract.contentWidthPx);

  // 计算每行高度
  const rowHeights: number[] = [];
  for (const row of block.metadata.rows) {
    const rowHeight = getRowHeight(row, columnWidths, state.measuredCellHeights, tableStyle, contract, block);
    rowHeights.push(rowHeight);
  }

  // 计算能放入当前页的行数
  let consumedHeight = 0;
  let fitRowCount = 0;
  for (let i = 0; i < rowHeights.length; i++) {
    if (consumedHeight + rowHeights[i] > state.remainingHeight) {
      // 检查最后一行是否完全放不下
      if (fitRowCount === 0 && rowHeights[i] > state.remainingHeight) {
        // 尝试在该行内寻找分割点
        const cellSplitResult = tryFindCellSplitPoint(
          block.metadata.rows[i],
          columnWidths,
          state.remainingHeight,
          contract,
          block,
          tableStyle,
          i
        );

        if (cellSplitResult) {
          // 可以在单元格内分割
          // 处理跨页单元格分割
          handleCellContentSplit(
            state,
            block,
            i,
            cellSplitResult.splitRowIndex,
            cellSplitResult.splitCellIndex,
            cellSplitResult.splitOffset,
            cellSplitResult.updatedCurrentRows,
            cellSplitResult.remainingRows,
            contract
          );
          return;
        }
      }
      break;
    }
    consumedHeight += rowHeights[i];
    fitRowCount++;
  }

  // 如果 fitRowCount <= 0 且当前页有内容，换页
  if (fitRowCount <= 0 && state.currentPage.blocks.length > 0) {
    state.pages.push(state.currentPage);
    state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
    state.remainingHeight = contract.contentHeightPx;
    state.queue.unshift(block);
    return;
  }

  // 正常分割：当前页放前 fitRowCount 行
  const sliceResult = splitTableRowsAtCellIndex(block, fitRowCount, state.pages.length, true);
  if (!sliceResult) {
    // 分割失败，直接放整表
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - getTableHeight(block, contract, state.measuredCellHeights, state.cellMeasurementJobs));
    return;
  }

  // 构建当前页的表格片段
  const currentBlock = cloneRuntimeBlock(block, {
    id: `${block.id}-cell-table-fragment`,
    sourceRange: null,
    blockStyleOverrides: { ...block.blockStyleOverrides, spaceAfter: 0 },
    metadata: { ...block.metadata, rows: sliceResult.currentRows },
  });

  state.currentPage.blocks.push(currentBlock);
  state.remainingHeight = 0;
  state.pages.push(state.currentPage);

  // 创建新页放剩余内容
  state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
  state.remainingHeight = contract.contentHeightPx;

  // 构建剩余块的表格片段（带重复表头）
  const remainingBlock = cloneRuntimeBlock(block, {
    id: `${block.id}-cell-table-remaining`,
    sourceRange: null,
    blockStyleOverrides: { ...block.blockStyleOverrides, spaceBefore: 0 },
    metadata: { ...block.metadata, rows: sliceResult.remainingRows },
  });

  state.queue.unshift(remainingBlock);
}

/**
 * 尝试在该行内寻找单元格内容分割点
 */
function tryFindCellSplitPoint(
  row: LayoutTableRow,
  columnWidths: number[],
  availableHeight: number,
  contract: ResolvedStyleContract,
  block: LayoutBlock,
  tableStyle: ResolvedStyleContract['blockStyles']['table'],
  rowIndex: number
): {
  splitRowIndex: number;
  splitCellIndex: number;
  splitOffset: number;
  updatedCurrentRows: LayoutTableRow[];
  remainingRows: LayoutTableRow[];
} | null {
  // 遍历行内每个单元格
  for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex++) {
    const cell = row.cells[cellIndex];

    // 跳过合并单元格（合并单元格通常不适合行内分割）
    if (isMergedCell(cell)) {
      continue;
    }

    const colIndex = cellIndex; // 使用单元格在行中的索引
    const cellWidth = colIndex < columnWidths.length ? columnWidths[colIndex] : 100;
    const cellText = cell.textRuns.map((run) => run.text).join('');
    const fontSize = getEffectiveTableCellMaxFontSize({
      cell,
      block,
      styles: undefined,
      fallback: contract.blockStyles.paragraph.fontSize,
    });
    const lineHeight = resolveEffectiveTextLineHeight({
      fontSize,
      baseFontSize: contract.blockStyles.paragraph.fontSize,
      baseLineHeight: contract.blockStyles.paragraph.lineHeight,
    });

    // 估算单元格完整高度
    const estimatedCellHeight = estimateCellHeight(cell, cellWidth, fontSize, lineHeight);
    if (estimatedCellHeight <= availableHeight) {
      // 整个单元格可以放下
      continue;
    }

    // 需要在这个单元格内找分割点
    // 计算可用行数
    const availableLines = Math.floor(availableHeight / lineHeight);
    const estimatedSplitOffset = measureTextSplitOffsetForLineCount(cellText, cellWidth, { fontSize }, availableLines);

    // 生成候选分割点
    const candidates = findCellSplitCandidates(cell, estimatedSplitOffset);

    // 找到最优分割点
    for (const offset of candidates) {
      if (offset > 0 && offset < cellText.length) {
        // 找到分割点，构建分割后的行
        const currentRows: LayoutTableRow[] = [];
        const remainingRows: LayoutTableRow[] = [];

        // 当前行：单元格内容截断
        const splitResult = splitCellAtOffset(cell, offset, `cell-split-${rowIndex}`);
        if (!splitResult) continue;

        const currentRow: LayoutTableRow = {
          ...row,
          id: `${row.id}-cell-split`,
          cells: row.cells.map((c, idx) =>
            idx === cellIndex ? splitResult.currentCell : c
          ),
        };

        const remainingRow: LayoutTableRow = {
          ...row,
          id: `${row.id}-cell-remaining`,
          cells: row.cells.map((c, idx) =>
            idx === cellIndex ? (splitResult.remainingCell ?? c) : c
          ),
        };

        currentRows.push(currentRow);
        remainingRows.push(remainingRow);

        return {
          splitRowIndex: rowIndex,
          splitCellIndex: cellIndex,
          splitOffset: offset,
          updatedCurrentRows: currentRows,
          remainingRows: remainingRows,
        };
      }
    }
  }

  return null;
}

/**
 * 找到单元格内容的候选分割点
 */
function findCellSplitCandidates(
  cell: LayoutTableRow['cells'][0],
  estimatedOffset: number,
): number[] {
  const text = cell.textRuns.map((run) => run.text).join('');
  const candidates: Set<number> = new Set();

  // 添加估算分割点
  if (estimatedOffset > 0 && estimatedOffset < text.length) {
    candidates.add(estimatedOffset);
  }

  // 添加真实测量断点附近的候选，给标点/短语边界留一点调整空间。
  for (let delta = -8; delta <= 8; delta += 1) {
    const offset = estimatedOffset + delta;
    if (offset > 0 && offset < text.length) {
      candidates.add(offset);
    }
  }

  // 添加标点符号边界
  const punctuations = /[，。、！？；：""''（）【】《》,.\?!;:'"()\[\]]/g;
  let match;
  while ((match = punctuations.exec(text)) !== null) {
    const offset = match.index + 1;
    if (offset > 0 && offset < text.length) {
      candidates.add(offset);
    }
  }

  return Array.from(candidates).sort((a, b) => Math.abs(a - estimatedOffset) - Math.abs(b - estimatedOffset));
}

/**
 * 处理单元格内容跨页分割
 */
function handleCellContentSplit(
  state: CellMeasurePaginationState,
  block: LayoutBlock,
  rowIndex: number,
  splitRowIndex: number,
  splitCellIndex: number,
  splitOffset: number,
  currentRows: LayoutTableRow[],
  remainingRows: LayoutTableRow[],
  contract: ResolvedStyleContract
): void {
  // 当前页放截断后的内容
  const currentBlock = cloneRuntimeBlock(block, {
    id: `${block.id}-cell-split-current`,
    sourceRange: null,
    blockStyleOverrides: { ...block.blockStyleOverrides, spaceAfter: 0 },
    metadata: { ...block.metadata, rows: currentRows } as LayoutBlock['metadata'],
  });

  state.currentPage.blocks.push(currentBlock);
  state.remainingHeight = 0;
  state.pages.push(state.currentPage);

  // 创建新页放剩余内容
  state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
  state.remainingHeight = contract.contentHeightPx;

  // 构建剩余块的表格片段（带重复表头）
  const remainingBlock = cloneRuntimeBlock(block, {
    id: `${block.id}-cell-split-remaining`,
    sourceRange: null,
    blockStyleOverrides: { ...block.blockStyleOverrides, spaceBefore: 0 },
    metadata: { ...block.metadata, rows: remainingRows } as LayoutBlock['metadata'],
  });

  state.queue.unshift(remainingBlock);
}

/**
 * 处理文本块的分割
 */
function handleTextBlockSplit(
  state: CellMeasurePaginationState,
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  measuredTextLineBreaks: Record<string, number[]> | undefined
): void {
  const blockStyle = getTextBlockStyle(block, contract);
  const text = getLayoutBlockPlainText(block);
  const fontSize = getEffectiveTextRunsMaxFontSize({
    textRuns: block.textRuns,
    block,
    styles: undefined,
    fallback: blockStyle.fontSize,
  });
  const lineHeight = resolveEffectiveTextLineHeight({
    fontSize,
    baseFontSize: blockStyle.fontSize,
    baseLineHeight: block.blockStyleOverrides.lineHeight ?? blockStyle.lineHeight,
  });

  const safeAvailableHeight = Math.max(
    0,
    state.remainingHeight - (block.blockStyleOverrides.spaceBefore ?? blockStyle.marginTop) - (block.blockStyleOverrides.spaceAfter ?? blockStyle.marginBottom)
  );
  const availableLineCount = Math.floor(safeAvailableHeight / lineHeight);

  const splitResult = splitTextForAvailableLines({
    text,
    widthPx: contract.contentWidthPx,
    fontSize,
    fontFamily: getEffectiveTextRunsFontFamily({
      textRuns: block.textRuns,
      block,
      styles: undefined,
    }),
    availableLineCount,
    measuredLineBreaks: measuredTextLineBreaks?.[block.id],
  });

  if (!splitResult) {
    if (state.currentPage.blocks.length > 0) {
      state.pages.push(state.currentPage);
      state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
      state.remainingHeight = contract.contentHeightPx;
    }
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(block, contract));
    return;
  }

  const { currentBlock, remainingBlock } = createTextFragmentBlock(
    block,
    splitResult.splitOffset,
    text.slice(0, splitResult.splitOffset),
    text.slice(splitResult.splitOffset)
  );

  state.currentPage.blocks.push(currentBlock);
  state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(currentBlock, contract));

  state.pages.push(state.currentPage);
  state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
  state.remainingHeight = contract.contentHeightPx;

  if (remainingBlock) {
    state.queue.unshift(remainingBlock);
  }
}

/**
 * 处理列表块的分割
 */
function handleListBlockSplit(
  state: CellMeasurePaginationState,
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  measuredTextLineBreaks: Record<string, number[]> | undefined
): void {
  if (!isListBlock(block)) {
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(block, contract));
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
      styles: undefined,
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
        styles: undefined,
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
    state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(block, contract));
    return;
  }

  const currentBlock = createListFragmentBlock(block, fragmentItems, 0, state.pages.length + 1);
  if (!currentBlock) {
    state.currentPage.blocks.push(block);
    state.remainingHeight = Math.max(0, state.remainingHeight - estimateBlockHeight(block, contract));
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
      id: `${block.id}-cell-list-remaining-${state.pages.length + 1}`,
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

/**
 * 单元格级精确测量分页算法
 */
export function paginateCellMeasureBlocks(context: PaginationAlgorithmContext): PageLayout[] {
  const {
    blocks,
    contract,
    measuredBlockHeights,
    measuredTextLineBreaks,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
    measuredTableRowHeights,
    tableRowMeasurementJobs,
    measuredCellHeights,
    measuredCellFragmentHeights,
    cellMeasurementJobs,
  } = context;

  // 初始化分页状态
  const state: CellMeasurePaginationState = {
    pages: [],
    currentPage: createDomMeasurePage(1, contract),
    remainingHeight: contract.contentHeightPx,
    queue: [...blocks],
    measuredHeights: measuredTextFragmentHeights ?? {},
    measuredCellHeights: measuredCellHeights ?? {},
    measuredCellFragmentHeights: measuredCellFragmentHeights ?? {},
    cellMeasurementJobs: cellMeasurementJobs ?? [],
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

    // 获取块高度（优先测量高度，否则估算）
    const measuredHeight = getMeasuredBlockHeight(block, measuredBlockHeights);
    const blockHeight = measuredHeight ?? estimateBlockHeight(block, contract);

    // 块可以直接放入当前页
    if (blockHeight <= state.remainingHeight) {
      state.currentPage.blocks.push(block);
      state.remainingHeight -= blockHeight;

      // 处理 pageBreakAfter
      if (block.pagination.pageBreakAfter) {
        state.pages.push(state.currentPage);
        state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
        state.remainingHeight = contract.contentHeightPx;
      }
      continue;
    }

    // 块无法放入，根据类型处理
    if (block.type === 'image' && block.metadata.kind === 'image') {
      if (state.currentPage.blocks.length > 0) {
        state.pages.push(state.currentPage);
        state.currentPage = createDomMeasurePage(state.pages.length + 1, contract);
        state.remainingHeight = contract.contentHeightPx;
      }
      state.currentPage.blocks.push(block);
      state.remainingHeight = Math.max(0, state.remainingHeight - blockHeight);
      continue;
    }

    // 表格：使用单元格级分割
    if (block.type === 'table' && block.metadata.kind === 'table') {
      handleTableCellSplit(state, block, contract, measuredTextLineBreaks);
      continue;
    }

    // 列表
    if (block.type === 'list' && block.metadata.kind === 'list') {
      handleListBlockSplit(state, block, contract, measuredTextLineBreaks);
      continue;
    }

    // 文本块
    if ((block.type === 'heading' || block.type === 'paragraph') && block.metadata.kind) {
      handleTextBlockSplit(state, block, contract, measuredTextLineBreaks);
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

export const cellMeasurePaginationAlgorithm: PaginationAlgorithmDefinition = {
  id: CELL_MEASURE_PAGINATION_ALGORITHM_ID,
  label: '单元格精确测量分页引擎',
  description: '单元格级精确测量：逐单元格离屏测量高度，按列宽分配行高，支持单元格内容跨页分割，支持跨列/跨行合并单元格的识别与保持。',
  paginate: paginateCellMeasureBlocks,
};
