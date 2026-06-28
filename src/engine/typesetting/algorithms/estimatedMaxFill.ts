/**
 * 分页测试算法1：页面利用最大化
 *
 * 核心策略：
 * 1. 文本块按行分割，在最优分割点截断（优先在段落/句子边界分割）
 * 2. 表格优先按行分割，普通长行可继续按单元格文本拆分
 * 3. 列表优先按项分割，超长列表项可继续按文本片段拆分
 * 4. 图片超过可用高度直接翻页
 * 5. 支持单栏/双栏/三栏布局
 * 6. 不处理孤儿行和寡妇行
 * 7. 使用块高度缓存避免重复计算
 */

import {
  getHeadingText,
  getLayoutBlockPlainText,
  getLayoutListItemLevel,
  buildTocItemsFromBlocks,
  getTableCellColSpan,
  isCoveredTableCell,
  resolveTableColumnWidths,
  resolveTableRowHeightPx,
  type LayoutBlock,
  type LayoutListItem,
  type LayoutStyleSheet,
  type LayoutTableCell,
  type LayoutTableRow,
  type ListBlockMetadata,
  type TableBlockMetadata,
  type TextRun,
  type TocItem,
} from '@/engine/document-model';
import {
  estimateImageVisibleHeightPx,
  isImageTextWrapMode,
  resolveHangingIndentLineWidths,
  resolveImageLayout,
} from '@/engine/document-model';
import type {
  ResolvedStyleContract,
  TextBlockStyleRule,
} from '@/engine/style/types';
import {
  getEffectiveListItemMaxFontSize,
  getEffectiveTableCellMaxFontSize,
  getEffectiveTextRunsMaxFontSize,
  resolveEffectiveTextLineHeight,
} from '@/engine/style/quickTextStyle';
import { estimateTextLines, computeTextSplitOffsetForLineCount } from '../textMetrics';
import { buildTocFragment, estimateTocBlockHeight } from '../tocLayout';
import type {
  LayoutWarning,
  MeasuredTextLineBreaks,
  PageLayout,
  PaginationAlgorithmContext,
} from '../types';

// ============== 类型定义 ==============

type TableLayoutBlock = LayoutBlock & {
  type: 'table';
  metadata: TableBlockMetadata;
};

type ListLayoutBlock = LayoutBlock & {
  type: 'list';
  metadata: ListBlockMetadata;
};

interface PlacedBlockEntry {
  block: LayoutBlock;
  height: number;
  marginTop: number;
  marginBottom: number;
}

interface TextFragmentInfo {
  /** 当前页放的文本 */
  currentPageText: string;
  /** 剩余文本（需要放到下一页） */
  remainingText: string;
  /** 当前页使用的高度 */
  height: number;
}

interface TableFragmentRow {
  row: LayoutTableRow;
  originalRowIndex: number;
  isRepeatedHeader: boolean;
}

interface TableFragmentBuildResult {
  block: LayoutBlock;
  height: number;
  nextRowIndex: number;
  remainingRow?: LayoutTableRow;
}

interface ListFragmentBuildResult {
  block: LayoutBlock;
  height: number;
  nextItemIndex: number;
  remainingItem?: LayoutListItem;
}

interface TableRowSplitResult {
  currentRow: LayoutTableRow;
  remainingRow: LayoutTableRow;
  currentHeight: number;
}

interface ListItemSplitResult {
  currentItem: LayoutListItem;
  remainingItem: LayoutListItem;
  currentHeight: number;
}

const TINY_TRAILING_TEXT_MAX_CHARS = 8;
const TINY_TRAILING_TEXT_MIN_MEANINGFUL_CHARS = 4;
const TINY_TRAILING_TEXT_LOOKBACK_CHARS = 6;
const MEANINGFUL_TEXT_IGNORE_PATTERN =
  /[\s，。！？、；：,.!?;:"'“”‘’《》（）()【】\[\]{}<>]/gu;

// ============== 块高度缓存 ==============

// 块高度不仅取决于块内容，也取决于当前页面宽度、模板字号、行高等样式契约。
// 因此缓存需要按“块对象 + 样式契约签名”共同命中，避免切换页面尺寸后复用旧高度。
let blockHeightCache: WeakMap<LayoutBlock, Map<string, number>> = new WeakMap();

/**
 * 清除指定块的缓存（编辑后调用）
 */
export function clearBlockHeightCache(block: LayoutBlock): void {
  blockHeightCache.delete(block);
}

/**
 * 清除所有块的高度缓存
 */
export function clearAllBlockHeightCache(): void {
  blockHeightCache = new WeakMap();
}

// ============== 辅助函数 ==============

function buildBlockHeightCacheKey(
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
): string {
  const { blockStyles } = contract;
  return JSON.stringify({
    pageSize: contract.pageSize,
    orientation: contract.orientation,
    templateId: contract.templateId,
    pageWidthPx: contract.pageWidthPx,
    pageHeightPx: contract.pageHeightPx,
    contentWidthPx: contract.contentWidthPx,
    contentHeightPx: contract.contentHeightPx,
    heading1: blockStyles.heading1,
    heading2: blockStyles.heading2,
    heading3: blockStyles.heading3,
    paragraph: blockStyles.paragraph,
    list: blockStyles.list,
    blockquote: blockStyles.blockquote,
    code: blockStyles.code,
    table: blockStyles.table,
    horizontalRule: blockStyles.horizontalRule,
    image: blockStyles.image,
    quickTextStyles: styles?.textStyles ?? {},
  });
}

function isTableBlock(block: LayoutBlock): block is TableLayoutBlock {
  return block.type === 'table' && block.metadata.kind === 'table';
}

function isListBlock(block: LayoutBlock): block is ListLayoutBlock {
  return block.type === 'list' && block.metadata.kind === 'list';
}

function resolveTextBlockStyle(
  block: LayoutBlock,
  baseStyle: TextBlockStyleRule,
  styles?: LayoutStyleSheet,
): TextBlockStyleRule {
  const fontSize = getEffectiveTextRunsMaxFontSize({
    textRuns: block.textRuns,
    block,
    styles,
    fallback: baseStyle.fontSize,
  });
  const baseLineHeight = block.blockStyleOverrides.lineHeight ?? baseStyle.lineHeight;

  return {
    ...baseStyle,
    fontSize,
    lineHeight: resolveEffectiveTextLineHeight({
      fontSize,
      baseFontSize: baseStyle.fontSize,
      baseLineHeight,
    }),
    marginTop: block.blockStyleOverrides.spaceBefore ?? baseStyle.marginTop,
    marginBottom: block.blockStyleOverrides.spaceAfter ?? baseStyle.marginBottom,
  };
}

/**
 * 计算文本块的总高度（不分割）
 */
function estimateTextBlockHeight(
  text: string,
  widthPx: number,
  style: TextBlockStyleRule,
  firstLineWidthPx: number,
): number {
  const lines = estimateTextLines(text, widthPx, style.fontSize, {
    firstLineWidthPx,
  });
  return style.marginTop + lines * style.lineHeight + style.marginBottom;
}

function resolveTextBlockLineWidths(
  contentWidthPx: number,
  block: LayoutBlock,
  baseStyle: TextBlockStyleRule,
) {
  // 块排版预设给文字块提供默认左右内缩，单块局部缩进继续作为最高优先级。
  return resolveHangingIndentLineWidths(contentWidthPx, {
    indentLeft: block.blockStyleOverrides.indentLeft ?? baseStyle.insetLeft,
    indentRight: block.blockStyleOverrides.indentRight ?? baseStyle.insetRight,
    firstLineIndent: block.blockStyleOverrides.firstLineIndent,
    hangingIndent: block.blockStyleOverrides.hangingIndent,
  });
}

/**
 * 获取文本块可用的行高信息
 */
function getTextBlockUsableLineCount(
  text: string,
  widthPx: number,
  style: TextBlockStyleRule,
  availableHeight: number,
  firstLineWidthPx = widthPx,
): { fullLineCount: number; remainingHeight: number } {
  const lines = estimateTextLines(text, widthPx, style.fontSize, {
    firstLineWidthPx,
  });
  const totalHeight = style.marginTop + lines * style.lineHeight + style.marginBottom;
  const usableHeight = availableHeight - style.marginTop - style.marginBottom;

  if (usableHeight <= 0) {
    return { fullLineCount: 0, remainingHeight: 0 };
  }

  const lineHeight = style.lineHeight;
  const fullLineCount = Math.floor(usableHeight / lineHeight);
  const remainingHeight = usableHeight - fullLineCount * lineHeight;

  return { fullLineCount, remainingHeight };
}

function createSplitRunId(run: TextRun, suffix: string): string {
  return `${run.id}-${suffix}`;
}

function createRunSlice(
  run: TextRun,
  text: string,
  runIndex: number,
  suffix: string,
  isFullSlice: boolean,
): TextRun {
  return {
    ...run,
    id: isFullSlice ? run.id : createSplitRunId(run, `${suffix}-${runIndex}`),
    text,
    // 文本被分页算法切成运行时片段后，源码范围已不再精确，避免继续带出旧范围误导后续链路。
    sourceRange: isFullSlice ? run.sourceRange : null,
  };
}

function pushRunSlice(
  target: TextRun[],
  run: TextRun,
  text: string,
  runIndex: number,
  suffix: string,
  isFullSlice: boolean,
): void {
  if (text.length === 0) {
    return;
  }

  target.push(createRunSlice(run, text, runIndex, suffix, isFullSlice));
}

function splitTextRunsByPlainTextLength(
  textRuns: TextRun[],
  firstPartLength: number,
): { currentPageRuns: TextRun[]; remainingRuns: TextRun[] } {
  const currentPageRuns: TextRun[] = [];
  const remainingRuns: TextRun[] = [];
  let consumedLength = 0;

  for (let runIndex = 0; runIndex < textRuns.length; runIndex += 1) {
    const run = textRuns[runIndex];
    const runStart = consumedLength;
    const runEnd = runStart + run.text.length;
    consumedLength = runEnd;

    if (runEnd <= firstPartLength) {
      pushRunSlice(currentPageRuns, run, run.text, runIndex, 'frag', true);
      continue;
    }

    if (runStart >= firstPartLength) {
      pushRunSlice(remainingRuns, run, run.text, runIndex, 'rest', true);
      continue;
    }

    const splitOffset = Math.max(0, firstPartLength - runStart);
    pushRunSlice(
      currentPageRuns,
      run,
      run.text.slice(0, splitOffset),
      runIndex,
      'frag',
      splitOffset === run.text.length,
    );
    pushRunSlice(
      remainingRuns,
      run,
      run.text.slice(splitOffset),
      runIndex,
      'rest',
      splitOffset === 0,
    );
  }

  return { currentPageRuns, remainingRuns };
}

function createTextFragmentBlock(
  block: LayoutBlock,
  textRuns: TextRun[],
  text: string,
  idSuffix: string,
): LayoutBlock {
  const fragmentBlock = {
    ...block,
    id: `${block.id}-${idSuffix}`,
    sourceRange: null,
    textRuns,
  };

  if (fragmentBlock.type === 'heading' && fragmentBlock.metadata.kind === 'heading') {
    return {
      ...fragmentBlock,
      metadata: {
        ...fragmentBlock.metadata,
        text,
      },
    };
  }

  if (fragmentBlock.type === 'paragraph' && fragmentBlock.metadata.kind === 'paragraph') {
    return {
      ...fragmentBlock,
      metadata: {
        ...fragmentBlock.metadata,
        text,
      },
    };
  }

  return fragmentBlock;
}

function resolveListBlockStyle(
  block: ListLayoutBlock,
  contract: ResolvedStyleContract,
) {
  return {
    ...contract.blockStyles.list,
    lineHeight:
      block.blockStyleOverrides.lineHeight ?? contract.blockStyles.list.lineHeight,
    marginTop:
      block.blockStyleOverrides.spaceBefore ?? contract.blockStyles.list.marginTop,
    marginBottom:
      block.blockStyleOverrides.spaceAfter ?? contract.blockStyles.list.marginBottom,
  };
}

function estimateListItemHeight(
  item: LayoutListItem,
  fragmentItemIndex: number,
  block: ListLayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
  measuredTextLineBreaks?: MeasuredTextLineBreaks,
): number {
  const listStyle = resolveListBlockStyle(block, contract);
  const itemText = item.textRuns.map((run) => run.text).join('');
  const fontSize = getEffectiveListItemMaxFontSize({
    item,
    block,
    styles,
    fallback: listStyle.fontSize,
  });
  const lineHeight = resolveEffectiveTextLineHeight({
    fontSize,
    baseFontSize: contract.blockStyles.list.fontSize,
    baseLineHeight: listStyle.lineHeight,
  });
  const measuredLineBreaks = resolveMeasuredLineBreakOffsets(
    item.id,
    itemText,
    measuredTextLineBreaks,
  );
  const lines = measuredLineBreaks?.length ?? estimateTextLines(
    itemText,
    getListItemTextWidthPx(item, block, contract),
    fontSize,
  );
  const gap = fragmentItemIndex === 0 ? 0 : listStyle.itemGap;

  return gap + lines * lineHeight;
}

function getListItemTextWidthPx(
  item: LayoutListItem,
  block: ListLayoutBlock,
  contract: ResolvedStyleContract,
): number {
  const listStyle = resolveListBlockStyle(block, contract);
  const widthPx = Math.max(120, contract.contentWidthPx - listStyle.indent);
  const levelIndentPx =
    Math.max(0, getLayoutListItemLevel(item) - 1) *
    Math.max(16, listStyle.indent * 0.72);

  return Math.max(80, widthPx - levelIndentPx);
}

function estimateListItemsHeight(
  block: ListLayoutBlock,
  items: LayoutListItem[],
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
): number {
  return items.reduce(
    (total, item, itemIndex) =>
      total + estimateListItemHeight(item, itemIndex, block, contract, styles),
    0,
  );
}

function estimateListBlockHeight(
  block: ListLayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
): number {
  const listStyle = resolveListBlockStyle(block, contract);
  return (
    listStyle.marginTop +
    estimateListItemsHeight(block, block.metadata.items, contract, styles) +
    listStyle.marginBottom
  );
}

function createListFragmentBlock(
  block: ListLayoutBlock,
  items: LayoutListItem[],
  startItemIndex: number,
  fragmentIndex: number,
): LayoutBlock {
  const baseStart = block.metadata.start ?? 1;

  return {
    ...block,
    id: `${block.id}-list-fragment-${fragmentIndex}`,
    sourceRange: null,
    metadata: {
      ...block.metadata,
      // 有序列表跨页后要显式写入起始编号，避免第二页又从 1 开始。
      start: block.metadata.ordered ? baseStart + startItemIndex : block.metadata.start,
      items,
    },
  };
}

function createListItemTextSlice(
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

function splitListItemToFit(payload: {
  block: ListLayoutBlock;
  item: LayoutListItem;
  fragmentItemIndex: number;
  availableHeight: number;
  fragmentIndex: number;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
}): ListItemSplitResult | null {
  const {
    block,
    item,
    fragmentItemIndex,
    availableHeight,
    fragmentIndex,
    contract,
    styles,
    measuredTextLineBreaks,
  } = payload;
  const listStyle = resolveListBlockStyle(block, contract);
  const gap = fragmentItemIndex === 0 ? 0 : listStyle.itemGap;
  const usableHeight = availableHeight - gap;
  const itemText = item.textRuns.map((run) => run.text).join('');
  const fontSize = getEffectiveListItemMaxFontSize({
    item,
    block,
    styles,
    fallback: listStyle.fontSize,
  });
  const lineHeight = resolveEffectiveTextLineHeight({
    fontSize,
    baseFontSize: contract.blockStyles.list.fontSize,
    baseLineHeight: listStyle.lineHeight,
  });
  const maxLines = Math.floor(usableHeight / lineHeight);

  if (maxLines <= 0 || itemText.length === 0) {
    return null;
  }

  const measuredSplitInfo = resolveMeasuredTextSplitInfo(
    item.id,
    itemText,
    maxLines,
    measuredTextLineBreaks,
  );
  const splitOffset = measuredSplitInfo
    ? measuredSplitInfo.splitOffset
    : adjustSplitOffsetForReadableTrailingText(
        itemText,
        computeTextSplitOffsetForLineCount(
          itemText,
          getListItemTextWidthPx(item, block, contract),
          fontSize,
          maxLines,
        ),
      );

  if (splitOffset <= 0 || splitOffset >= itemText.length) {
    return null;
  }

  const { currentPageRuns, remainingRuns } = splitTextRunsByPlainTextLength(
    item.textRuns,
    splitOffset,
  );

  if (currentPageRuns.length === 0 || remainingRuns.length === 0) {
    return null;
  }

  const currentItem = createListItemTextSlice(
    item,
    currentPageRuns,
    `split-${fragmentIndex}-current`,
  );
  const remainingItem = createListItemTextSlice(
    item,
    remainingRuns,
    `split-${fragmentIndex}-rest`,
    true,
  );
  const currentHeight = measuredSplitInfo
    ? gap + measuredSplitInfo.usedLineCount * lineHeight
    : estimateListItemHeight(currentItem, fragmentItemIndex, block, contract, styles);

  if (currentHeight > availableHeight) {
    return null;
  }

  return {
    currentItem,
    remainingItem,
    currentHeight,
  };
}

function buildListFragment(payload: {
  block: ListLayoutBlock;
  startItemIndex: number;
  availableHeight: number;
  fragmentIndex: number;
  isCurrentPageEmpty: boolean;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
}): ListFragmentBuildResult | null {
  const {
    block,
    startItemIndex,
    availableHeight,
    fragmentIndex,
    isCurrentPageEmpty,
    contract,
    styles,
    measuredTextLineBreaks,
  } = payload;
  const listStyle = resolveListBlockStyle(block, contract);
  const fragmentItems: LayoutListItem[] = [];
  let nextItemIndex = startItemIndex;
  let fragmentHeight = listStyle.marginTop + listStyle.marginBottom;

  while (nextItemIndex < block.metadata.items.length) {
    const itemHeight = estimateListItemHeight(
      block.metadata.items[nextItemIndex],
      fragmentItems.length,
      block,
      contract,
      styles,
      measuredTextLineBreaks,
    );
    const candidateHeight = fragmentHeight + itemHeight;
    const canFit = candidateHeight <= availableHeight;
    const mustForceFirstItem = isCurrentPageEmpty && fragmentItems.length === 0;

    if (!canFit) {
      const splitResult = splitListItemToFit({
        block,
        item: block.metadata.items[nextItemIndex],
        fragmentItemIndex: fragmentItems.length,
        availableHeight: availableHeight - fragmentHeight,
        fragmentIndex,
        contract,
        styles,
        measuredTextLineBreaks,
      });

      if (splitResult && fragmentHeight + splitResult.currentHeight <= availableHeight) {
        fragmentItems.push(splitResult.currentItem);
        return {
          block: createListFragmentBlock(block, fragmentItems, startItemIndex, fragmentIndex),
          height: fragmentHeight + splitResult.currentHeight,
          nextItemIndex,
          remainingItem: splitResult.remainingItem,
        };
      }

      if (!mustForceFirstItem) {
        break;
      }
    }

    fragmentItems.push(block.metadata.items[nextItemIndex]);
    fragmentHeight = candidateHeight;
    nextItemIndex += 1;
  }

  if (fragmentItems.length === 0) {
    return null;
  }

  return {
    block: createListFragmentBlock(block, fragmentItems, startItemIndex, fragmentIndex),
    height: fragmentHeight,
    nextItemIndex,
  };
}

// ============== 表格相关函数 ==============

function getTableMarginTop(block: TableLayoutBlock, contract: ResolvedStyleContract): number {
  return block.blockStyleOverrides.spaceBefore ?? contract.blockStyles.table.marginTop;
}

function getTableMarginBottom(block: TableLayoutBlock, contract: ResolvedStyleContract): number {
  return block.blockStyleOverrides.spaceAfter ?? contract.blockStyles.table.marginBottom;
}

function getTableLineHeight(block: TableLayoutBlock, contract: ResolvedStyleContract): number {
  return block.blockStyleOverrides.lineHeight ?? contract.blockStyles.paragraph.lineHeight;
}

function getTableCellEffectiveFontSize(
  cell: LayoutTableCell,
  block: TableLayoutBlock,
  styles: LayoutStyleSheet | undefined,
  contract: ResolvedStyleContract,
): number {
  return getEffectiveTableCellMaxFontSize({
    cell,
    block,
    styles,
    fallback: contract.blockStyles.paragraph.fontSize,
  });
}

function getTableCellEffectiveLineHeight(
  cell: LayoutTableCell,
  block: TableLayoutBlock,
  styles: LayoutStyleSheet | undefined,
  contract: ResolvedStyleContract,
): number {
  const fontSize = getTableCellEffectiveFontSize(cell, block, styles, contract);
  return resolveEffectiveTextLineHeight({
    fontSize,
    baseFontSize: contract.blockStyles.paragraph.fontSize,
    baseLineHeight: getTableLineHeight(block, contract),
  });
}

function getTableRowEffectiveLineHeight(
  row: LayoutTableRow,
  block: TableLayoutBlock,
  styles: LayoutStyleSheet | undefined,
  contract: ResolvedStyleContract,
): number {
  return row.cells.reduce((maxLineHeight, cell) => {
    if (isCoveredTableCell(cell)) {
      return maxLineHeight;
    }

    return Math.max(
      maxLineHeight,
      getTableCellEffectiveLineHeight(cell, block, styles, contract),
    );
  }, getTableLineHeight(block, contract));
}

function getTableCellTextWidthPx(
  block: TableLayoutBlock,
  row: LayoutTableRow,
  cellIndex: number,
  contract: ResolvedStyleContract,
): number {
  const contentWidthPx = contract.contentWidthPx;
  const columnWidths = resolveTableColumnWidths(
    block.metadata.columnWidthsPx,
    row.cells.length,
    contentWidthPx,
  );
  const cell = row.cells[cellIndex];
  const colSpan = getTableCellColSpan(cell);
  const mergedWidthPx = columnWidths
    .slice(cellIndex, cellIndex + colSpan)
    .reduce((total, width) => total + width, 0);

  return Math.max(
    80,
    (mergedWidthPx || columnWidths[cellIndex] || (contentWidthPx / Math.max(1, row.cells.length))) -
      contract.blockStyles.table.cellPaddingX * 2,
  );
}

function estimateTableRowHeight(
  block: TableLayoutBlock,
  row: LayoutTableRow,
  rowIndex: number,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
): number {
  const estimatedRowHeight = row.cells.reduce((maxHeight, cell) => {
    if (isCoveredTableCell(cell)) {
      return maxHeight;
    }

    const cellIndex = row.cells.indexOf(cell);
    const cellWidthPx = getTableCellTextWidthPx(block, row, cellIndex, contract);
    const fontSize = getTableCellEffectiveFontSize(cell, block, styles, contract);
    const lines = estimateTextLines(
      cell.textRuns.map((run) => run.text).join(''),
      cellWidthPx,
      fontSize,
    );
    const lineHeight = getTableCellEffectiveLineHeight(cell, block, styles, contract);

    return Math.max(
      maxHeight,
      lines * lineHeight + contract.blockStyles.table.cellPaddingY * 2,
    );
  }, 0);
  const isHeaderLikeRow = rowIndex === 0 || row.cells.some((cell) => cell.isHeader);
  const fallbackHeight =
    isHeaderLikeRow ? contract.blockStyles.table.headerRowHeight : contract.blockStyles.table.rowHeight;

  return Math.max(resolveTableRowHeightPx(row, fallbackHeight), estimatedRowHeight);
}

function isSimpleSplittableTableRow(row: LayoutTableRow): boolean {
  return row.cells.every(
    (cell) =>
      !cell.isHeader &&
      !isCoveredTableCell(cell) &&
      getTableCellColSpan(cell) === 1 &&
      (cell.rowSpan === null || cell.rowSpan === undefined || cell.rowSpan <= 1),
  );
}



function createTableCellTextSlice(
  cell: LayoutTableCell,
  textRuns: TextRun[],
  suffix: string,
): LayoutTableCell {
  return {
    ...cell,
    id: `${cell.id}-${suffix}`,
    sourceRange: null,
    textRuns,
    // 拆分片段只处理普通单元格文本，运行时片段不继续携带跨行跨列语义。
    rowSpan: null,
    colSpan: null,
  };
}

function splitTableRowToFit(payload: {
  block: TableLayoutBlock;
  row: LayoutTableRow;
  rowIndex: number;
  availableHeight: number;
  fragmentIndex: number;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
}): TableRowSplitResult | null {
  const { block, row, rowIndex, availableHeight, fragmentIndex, contract, styles, measuredTextLineBreaks } = payload;
  if (!isSimpleSplittableTableRow(row)) {
    return null;
  }

  const lineHeight = getTableRowEffectiveLineHeight(row, block, styles, contract);
  const maxLines = Math.floor(
    (availableHeight - contract.blockStyles.table.cellPaddingY * 2) / lineHeight,
  );
  if (maxLines <= 0) {
    return null;
  }

  let hasCurrentText = false;
  let hasRemainingText = false;
  const currentCells: LayoutTableCell[] = [];
  const remainingCells: LayoutTableCell[] = [];

  row.cells.forEach((cell, cellIndex) => {
    const cellText = cell.textRuns.map((run) => run.text).join('');
    const measuredSplitInfo = resolveMeasuredTextSplitInfo(
      cell.id,
      cellText,
      maxLines,
      measuredTextLineBreaks,
    );
    const splitOffset = measuredSplitInfo
      ? measuredSplitInfo.splitOffset
      : adjustSplitOffsetForReadableTrailingText(
          cellText,
          computeTextSplitOffsetForLineCount(
            cellText,
            getTableCellTextWidthPx(block, row, cellIndex, contract),
            getTableCellEffectiveFontSize(cell, block, styles, contract),
            maxLines,
          ),
        );
    const { currentPageRuns, remainingRuns } = splitTextRunsByPlainTextLength(cell.textRuns, splitOffset);

    if (currentPageRuns.length > 0) {
      hasCurrentText = true;
    }
    if (remainingRuns.length > 0) {
      hasRemainingText = true;
    }

    currentCells.push(createTableCellTextSlice(cell, currentPageRuns, `split-${fragmentIndex}-current`));
    remainingCells.push(createTableCellTextSlice(cell, remainingRuns, `split-${fragmentIndex}-rest`));
  });

  if (!hasCurrentText || !hasRemainingText) {
    return null;
  }

  const currentRow: LayoutTableRow = {
    ...row,
    id: `${row.id}-split-${fragmentIndex}-current`,
    sourceRange: null,
    heightPx: null,
    cells: currentCells,
  };
  const remainingRow: LayoutTableRow = {
    ...row,
    id: `${row.id}-split-${fragmentIndex}-rest`,
    sourceRange: null,
    heightPx: null,
    cells: remainingCells,
  };

  return {
    currentRow,
    remainingRow,
    currentHeight: estimateTableRowHeight(block, currentRow, rowIndex, contract, styles),
  };
}

function getRepeatedTableHeaderRow(block: TableLayoutBlock): LayoutTableRow | null {
  const headerRow = block.metadata.rows[0];
  if (!headerRow || headerRow.cells.length === 0) {
    return null;
  }

  // 右侧面板的"首行作为表头"会把第一行所有单元格都标为表头，这里用同一语义判断是否续表头。
  return headerRow.cells.every((cell) => cell.isHeader) ? headerRow : null;
}

/**
 * 估算表格块总高度
 */
function estimateTableBlockHeight(
  block: TableLayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
): number {
  const marginTop = getTableMarginTop(block, contract);
  const marginBottom = getTableMarginBottom(block, contract);

  const rowsHeight = block.metadata.rows.reduce((total, row, rowIndex) => {
    return total + estimateTableRowHeight(block, row, rowIndex, contract, styles);
  }, 0);

  return marginTop + rowsHeight + marginBottom;
}

function createRuntimeTableRow(fragmentRow: TableFragmentRow, fragmentIndex: number): LayoutTableRow {
  const runtimeRowSuffix = fragmentRow.isRepeatedHeader
    ? `fragment-${fragmentIndex}-repeat-header`
    : `fragment-${fragmentIndex}`;

  return {
    ...fragmentRow.row,
    id: `${fragmentRow.row.id}-${runtimeRowSuffix}`,
    sourceRange: fragmentRow.isRepeatedHeader ? null : fragmentRow.row.sourceRange,
    cells: fragmentRow.row.cells.map((cell) => ({
      ...cell,
      sourceRange: fragmentRow.isRepeatedHeader ? null : cell.sourceRange,
    })),
  };
}

function createTableFragmentBlock(
  block: TableLayoutBlock,
  fragmentRows: TableFragmentRow[],
  fragmentIndex: number,
): LayoutBlock {
  return {
    ...block,
    id: `${block.id}-page-fragment-${fragmentIndex}`,
    sourceRange: null,
    metadata: {
      ...block.metadata,
      rows: fragmentRows.map((fragmentRow) => createRuntimeTableRow(fragmentRow, fragmentIndex)),
    },
  };
}

function buildTableFragment(payload: {
  block: TableLayoutBlock;
  startRowIndex: number;
  availableHeight: number;
  fragmentIndex: number;
  isCurrentPageEmpty: boolean;
  rowHeights: number[];
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
}): TableFragmentBuildResult | null {
  const {
    block,
    startRowIndex,
    availableHeight,
    fragmentIndex,
    isCurrentPageEmpty,
    rowHeights,
    contract,
    styles,
    measuredTextLineBreaks,
  } = payload;
  const rows = block.metadata.rows;
  const repeatedHeaderRow = getRepeatedTableHeaderRow(block);
  const fragmentRows: TableFragmentRow[] = [];
  const marginHeight = getTableMarginTop(block, contract) + getTableMarginBottom(block, contract);
  let fragmentHeight = marginHeight;
  let nextRowIndex = startRowIndex;
  let realRowCount = 0;

  if (repeatedHeaderRow && startRowIndex > 0) {
    fragmentRows.push({
      row: repeatedHeaderRow,
      originalRowIndex: 0,
      isRepeatedHeader: true,
    });
    fragmentHeight += rowHeights[0] ?? estimateTableRowHeight(block, repeatedHeaderRow, 0, contract, styles);
  }

  while (nextRowIndex < rows.length) {
    const rowHeight =
      rowHeights[nextRowIndex] ?? estimateTableRowHeight(block, rows[nextRowIndex], nextRowIndex, contract, styles);
    const candidateHeight = fragmentHeight + rowHeight;
    const canFit = candidateHeight <= availableHeight;
    const mustForceFirstRealRow = isCurrentPageEmpty && realRowCount === 0;

    if (!canFit) {
      const splitResult = splitTableRowToFit({
        block,
        row: rows[nextRowIndex],
        rowIndex: nextRowIndex,
        availableHeight: availableHeight - fragmentHeight,
        fragmentIndex,
        contract,
        styles,
        measuredTextLineBreaks,
      });

      if (splitResult && fragmentHeight + splitResult.currentHeight <= availableHeight) {
        fragmentRows.push({
          row: splitResult.currentRow,
          originalRowIndex: nextRowIndex,
          isRepeatedHeader: false,
        });

        return {
          block: createTableFragmentBlock(block, fragmentRows, fragmentIndex),
          height: fragmentHeight + splitResult.currentHeight,
          nextRowIndex,
          remainingRow: splitResult.remainingRow,
        };
      }

      if (!mustForceFirstRealRow) {
        break;
      }
    }

    fragmentRows.push({
      row: rows[nextRowIndex],
      originalRowIndex: nextRowIndex,
      isRepeatedHeader: false,
    });
    fragmentHeight = candidateHeight;
    nextRowIndex += 1;
    realRowCount += 1;
  }

  const isOnlyOriginalHeaderOnNonLastFragment =
    repeatedHeaderRow &&
    startRowIndex === 0 &&
    realRowCount === 1 &&
    fragmentRows[0]?.originalRowIndex === 0 &&
    nextRowIndex < rows.length;

  if (isOnlyOriginalHeaderOnNonLastFragment) {
    if (!isCurrentPageEmpty) {
      return null;
    }

    const nextBodyRow = rows[nextRowIndex];
    const nextBodyRowHeight =
      rowHeights[nextRowIndex] ?? estimateTableRowHeight(block, nextBodyRow, nextRowIndex, contract, styles);
    fragmentRows.push({
      row: nextBodyRow,
      originalRowIndex: nextRowIndex,
      isRepeatedHeader: false,
    });
    fragmentHeight += nextBodyRowHeight;
    nextRowIndex += 1;
    realRowCount += 1;
  }

  if (realRowCount === 0) {
    return null;
  }

  return {
    block: createTableFragmentBlock(block, fragmentRows, fragmentIndex),
    height: fragmentHeight,
    nextRowIndex,
  };
}

/**
 * 估算图片块高度
 */
function estimateImageBlockHeight(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
): number {
  if (block.type !== 'image' || block.metadata.kind !== 'image') {
    return (
      contract.blockStyles.image.marginTop +
      contract.blockStyles.image.placeholderHeight +
      contract.blockStyles.image.marginBottom
    );
  }

  const layout = resolveImageLayout(block.metadata);
  // 四周型/紧密型是正文流里的浮动障碍，不再像普通图片块一样单独撑开整段高度
  if (isImageTextWrapMode(layout.wrapMode)) {
    return 0;
  }

  const imageHeightPx = estimateImageVisibleHeightPx(
    block.metadata,
    contract.blockStyles.image.placeholderHeight,
  );

  // 只有 showCaption 为 true 时才计入标题高度
  const captionHeight = block.metadata.showCaption
    ? contract.blockStyles.image.captionGap + contract.blockStyles.paragraph.lineHeight
    : 0;

  return (
    contract.blockStyles.image.marginTop +
    Math.max(1, imageHeightPx) +
    captionHeight +
    contract.blockStyles.image.marginBottom
  );
}

/**
 * 估算浮动图片占位高度
 */
function estimateFloatingImageFootprintHeight(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
): number {
  if (block.type !== 'image' || block.metadata.kind !== 'image') {
    return 0;
  }

  const layout = resolveImageLayout(block.metadata);
  if (!isImageTextWrapMode(layout.wrapMode)) {
    return 0;
  }

  const captionHeight = layout.showCaption
    ? contract.blockStyles.image.captionGap + contract.blockStyles.paragraph.lineHeight
    : 0;

  return (
    contract.blockStyles.image.marginTop +
    estimateImageVisibleHeightPx(block.metadata, contract.blockStyles.image.placeholderHeight) +
    captionHeight +
    contract.blockStyles.image.marginBottom
  );
}

/**
 * 获取块高度（带缓存）
 */
function getCachedBlockHeight(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  tocItems: TocItem[] = [],
  styles?: LayoutStyleSheet,
): number {
  const cacheKey = buildBlockHeightCacheKey(contract, styles);
  const contractCache = blockHeightCache.get(block);
  if (contractCache?.has(cacheKey)) {
    return contractCache.get(cacheKey)!;
  }

  const height = estimateBlockHeight(block, contract, tocItems, styles);
  if (contractCache) {
    contractCache.set(cacheKey, height);
  } else {
    blockHeightCache.set(block, new Map([[cacheKey, height]]));
  }
  return height;
}

function getMeasuredTopLevelBlockHeight(
  block: LayoutBlock,
  measuredBlockHeights: Record<string, number> | undefined,
): number | null {
  const measuredHeight = measuredBlockHeights?.[block.id];
  if (
    measuredHeight === undefined ||
    !Number.isFinite(measuredHeight) ||
    measuredHeight <= 0
  ) {
    return null;
  }

  return measuredHeight;
}

interface MeasuredTextSplitInfo {
  splitOffset: number;
  usedLineCount: number;
  totalLineCount: number;
}

function resolveMeasuredLineBreakOffsets(
  nodeId: string,
  text: string,
  measuredTextLineBreaks: MeasuredTextLineBreaks | undefined,
): number[] | null {
  const rawOffsets = measuredTextLineBreaks?.[nodeId];
  if (!rawOffsets || rawOffsets.length === 0) {
    return null;
  }

  const normalizedOffsets = rawOffsets
    .map((offset) => Math.round(offset))
    .filter((offset, index, offsets) =>
      Number.isFinite(offset) &&
      offset > 0 &&
      offset <= text.length &&
      (index === 0 || offset > offsets[index - 1]),
    );

  if (
    normalizedOffsets.length === 0 ||
    normalizedOffsets[normalizedOffsets.length - 1] !== text.length
  ) {
    return null;
  }

  return normalizedOffsets;
}

function resolveMeasuredTextSplitInfo(
  nodeId: string,
  text: string,
  maxLines: number,
  measuredTextLineBreaks: MeasuredTextLineBreaks | undefined,
): MeasuredTextSplitInfo | null {
  if (maxLines <= 0 || text.length === 0) {
    return null;
  }

  const measuredLineBreaks = resolveMeasuredLineBreakOffsets(
    nodeId,
    text,
    measuredTextLineBreaks,
  );
  if (!measuredLineBreaks) {
    return null;
  }

  const usedLineCount = Math.min(maxLines, measuredLineBreaks.length);
  return {
    splitOffset:
      measuredLineBreaks.length <= maxLines
        ? text.length
        : measuredLineBreaks[Math.max(0, maxLines - 1)],
    usedLineCount,
    totalLineCount: measuredLineBreaks.length,
  };
}

function countMeaningfulTextCharacters(text: string): number {
  return Array.from(text.replace(MEANINGFUL_TEXT_IGNORE_PATTERN, '')).length;
}

function isTinyTrailingText(text: string): boolean {
  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return false;
  }

  const totalChars = Array.from(trimmedText).length;
  const meaningfulChars = countMeaningfulTextCharacters(trimmedText);

  return (
    meaningfulChars > 0 &&
    meaningfulChars < TINY_TRAILING_TEXT_MIN_MEANINGFUL_CHARS &&
    totalChars <= TINY_TRAILING_TEXT_MAX_CHARS
  );
}

function resolveBlockVerticalMargins(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
): { marginTop: number; marginBottom: number } {
  switch (block.type) {
    case 'heading': {
      const style = resolveTextBlockStyle(
        block,
        block.metadata.kind === 'heading' && block.metadata.depth === 1
          ? contract.blockStyles.heading1
          : block.metadata.kind === 'heading' && block.metadata.depth === 2
            ? contract.blockStyles.heading2
            : contract.blockStyles.heading3,
        styles,
      );
      return { marginTop: style.marginTop, marginBottom: style.marginBottom };
    }
    case 'paragraph': {
      const style = resolveTextBlockStyle(block, contract.blockStyles.paragraph, styles);
      return { marginTop: style.marginTop, marginBottom: style.marginBottom };
    }
    case 'list': {
      if (!isListBlock(block)) {
        return { marginTop: 0, marginBottom: 0 };
      }
      const style = resolveListBlockStyle(block, contract);
      return { marginTop: style.marginTop, marginBottom: style.marginBottom };
    }
    case 'table':
      return isTableBlock(block)
        ? {
            marginTop: getTableMarginTop(block, contract),
            marginBottom: getTableMarginBottom(block, contract),
          }
        : { marginTop: 0, marginBottom: 0 };
    case 'blockquote':
      return {
        marginTop: block.blockStyleOverrides.spaceBefore ?? contract.blockStyles.blockquote.marginTop,
        marginBottom: block.blockStyleOverrides.spaceAfter ?? contract.blockStyles.blockquote.marginBottom,
      };
    case 'code':
      return {
        marginTop: block.blockStyleOverrides.spaceBefore ?? contract.blockStyles.code.marginTop,
        marginBottom: block.blockStyleOverrides.spaceAfter ?? contract.blockStyles.code.marginBottom,
      };
    case 'horizontalRule':
      return {
        marginTop: contract.blockStyles.horizontalRule.marginTop,
        marginBottom: contract.blockStyles.horizontalRule.marginBottom,
      };
    case 'image':
      return {
        marginTop: contract.blockStyles.image.marginTop,
        marginBottom: contract.blockStyles.image.marginBottom,
      };
    case 'toc':
      return {
        marginTop: block.blockStyleOverrides.spaceBefore ?? 16,
        marginBottom: block.blockStyleOverrides.spaceAfter ?? 24,
      };
    default:
      return { marginTop: 0, marginBottom: 0 };
  }
}

function adjustSplitOffsetForReadableTrailingText(text: string, splitOffset: number): number {
  if (splitOffset <= 0 || splitOffset >= text.length || !isTinyTrailingText(text.slice(splitOffset))) {
    return splitOffset;
  }

  const prefixChars = Array.from(text.slice(0, splitOffset));
  let movedChars = 0;

  while (
    prefixChars.length - movedChars > 0 &&
    movedChars < TINY_TRAILING_TEXT_LOOKBACK_CHARS &&
    countMeaningfulTextCharacters(prefixChars.slice(prefixChars.length - movedChars).join('') + text.slice(splitOffset)) <
      TINY_TRAILING_TEXT_MIN_MEANINGFUL_CHARS
  ) {
    movedChars += 1;
  }

  if (movedChars === 0) {
    return splitOffset;
  }

  const adjustedPrefix = prefixChars.slice(0, prefixChars.length - movedChars).join('');
  return adjustedPrefix.trim().length > 0 ? adjustedPrefix.length : splitOffset;
}

function getMeasurementTolerancePx(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
): number {
  if (isListBlock(block)) {
    return resolveListBlockStyle(block, contract).lineHeight;
  }

  if (block.type === 'paragraph') {
    return resolveTextBlockStyle(block, contract.blockStyles.paragraph, styles).lineHeight;
  }

  if (block.type === 'heading') {
    return resolveTextBlockStyle(
      block,
      block.metadata.kind === 'heading' && block.metadata.depth === 1
        ? contract.blockStyles.heading1
        : block.metadata.kind === 'heading' && block.metadata.depth === 2
          ? contract.blockStyles.heading2
          : contract.blockStyles.heading3,
      styles,
    ).lineHeight;
  }

  return 0;
}

function resolvePlacementBlockHeight(payload: {
  block: LayoutBlock;
  estimatedHeight: number;
  measuredHeight: number | null;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
}): number {
  const { block, estimatedHeight, measuredHeight, contract, styles } = payload;
  if (measuredHeight === null) {
    return estimatedHeight;
  }

  const tolerancePx = getMeasurementTolerancePx(block, contract, styles);
  // 隐藏测量层按“单块包裹”测量，正文页按自然流排版；二者在 margin 折叠或运行时片段估算上可能差不到一行。
  // 对这种轻微向上偏差继续使用估算高度，避免算法1过早进入页尾拆分，造成页面明明有空白却把短句尾巴推到下一页。
  if (
    tolerancePx > 0 &&
    measuredHeight > estimatedHeight &&
    measuredHeight - estimatedHeight <= tolerancePx
  ) {
    return estimatedHeight;
  }

  return measuredHeight;
}

/**
 * 估算块高度（主函数）
 */
function estimateBlockHeight(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  tocItems: TocItem[] = [],
  styles?: LayoutStyleSheet,
): number {
  const contentWidthPx = contract.contentWidthPx;

  switch (block.type) {
    case 'pageBreak':
      return 0;
    case 'toc':
      return estimateTocBlockHeight(block, tocItems, contract);
    case 'heading': {
      const baseStyle =
        block.metadata.kind === 'heading' && block.metadata.depth === 1
          ? contract.blockStyles.heading1
          : block.metadata.kind === 'heading' && block.metadata.depth === 2
            ? contract.blockStyles.heading2
            : contract.blockStyles.heading3;
      const lineWidths = resolveTextBlockLineWidths(contentWidthPx, block, baseStyle);
      return estimateTextBlockHeight(
        getLayoutBlockPlainText(block),
        lineWidths.followingLineWidthPx,
        resolveTextBlockStyle(block, baseStyle, styles),
        lineWidths.firstLineWidthPx,
      );
    }
    case 'paragraph': {
      const lineWidths = resolveTextBlockLineWidths(contentWidthPx, block, contract.blockStyles.paragraph);
      return estimateTextBlockHeight(
        getLayoutBlockPlainText(block),
        lineWidths.followingLineWidthPx,
        resolveTextBlockStyle(block, contract.blockStyles.paragraph, styles),
        lineWidths.firstLineWidthPx,
      );
    }
    case 'list': {
      return isListBlock(block) ? estimateListBlockHeight(block, contract, styles) : 0;
    }
    case 'blockquote':
      return (
        contract.blockStyles.blockquote.marginTop +
        16 +
        (block.metadata.kind === 'blockquote'
          ? block.metadata.blocks.reduce(
              (total, nestedBlock) =>
                total + estimateBlockHeight(nestedBlock, contract, tocItems, styles),
              0,
            )
          : 0) +
        contract.blockStyles.blockquote.marginBottom
      );
    case 'code': {
      const codeFontSize = getEffectiveTextRunsMaxFontSize({
        textRuns: block.textRuns,
        block,
        styles,
        fallback: contract.blockStyles.code.fontSize,
      });
      const codeStyle = {
        ...contract.blockStyles.code,
        fontSize: codeFontSize,
        lineHeight: resolveEffectiveTextLineHeight({
          fontSize: codeFontSize,
          baseFontSize: contract.blockStyles.code.fontSize,
          baseLineHeight:
            block.blockStyleOverrides.lineHeight ?? contract.blockStyles.code.lineHeight,
        }),
        marginTop:
          block.blockStyleOverrides.spaceBefore ?? contract.blockStyles.code.marginTop,
        marginBottom:
          block.blockStyleOverrides.spaceAfter ?? contract.blockStyles.code.marginBottom,
      };
      const widthPx = Math.max(
        120,
        contentWidthPx - contract.blockStyles.code.paddingX * 2,
      );
      const lines = estimateTextLines(
        block.metadata.kind === 'code'
          ? block.metadata.value
          : getLayoutBlockPlainText(block),
        widthPx,
        codeStyle.fontSize,
        {
          charWidthFactor: contract.blockStyles.code.charWidth,
        },
      );
      return (
        codeStyle.marginTop +
        contract.blockStyles.code.paddingY * 2 +
        lines * codeStyle.lineHeight +
        codeStyle.marginBottom
      );
    }
    case 'table':
      if (!isTableBlock(block)) {
        return 0;
      }
      return estimateTableBlockHeight(block, contract, styles);
    case 'image':
      return estimateImageBlockHeight(block, contract);
    case 'horizontalRule':
      return (
        contract.blockStyles.horizontalRule.marginTop +
        contract.blockStyles.horizontalRule.strokeWidth +
        contract.blockStyles.horizontalRule.marginBottom
      );
    default:
      return 48;
  }
}

/**
 * 获取文本块在指定可用高度下的最优分割信息
 * 使用与 estimateTextLines 一致的行数计算逻辑
 */
function computeOptimalTextSplit(
  block: LayoutBlock,
  availableHeight: number,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
  measuredTextLineBreaks?: MeasuredTextLineBreaks,
): TextFragmentInfo | null {
  const contentWidthPx = contract.contentWidthPx;

  let style: TextBlockStyleRule;
  let baseStyle: TextBlockStyleRule;
  let plainText: string;

  if (block.type === 'heading') {
    baseStyle =
      block.metadata.kind === 'heading' && block.metadata.depth === 1
        ? contract.blockStyles.heading1
        : block.metadata.kind === 'heading' && block.metadata.depth === 2
          ? contract.blockStyles.heading2
          : contract.blockStyles.heading3;
    style = resolveTextBlockStyle(
      block,
      baseStyle,
      styles,
    );
    plainText = getLayoutBlockPlainText(block);
  } else if (block.type === 'paragraph') {
    baseStyle = contract.blockStyles.paragraph;
    style = resolveTextBlockStyle(block, baseStyle, styles);
    plainText = getLayoutBlockPlainText(block);
  } else {
    return null;
  }

  const lineWidths = resolveTextBlockLineWidths(contentWidthPx, block, baseStyle);

  // 计算可用行数（排除 margin）
  const usableHeight = availableHeight - style.marginTop - style.marginBottom;
  const lineHeight = style.lineHeight;
  if (usableHeight <= 0 || lineHeight <= 0) {
    return null;
  }

  const maxLines = Math.floor(usableHeight / lineHeight);
  if (maxLines <= 0) {
    return null;
  }

  const measuredSplitInfo = resolveMeasuredTextSplitInfo(
    block.id,
    plainText,
    maxLines,
    measuredTextLineBreaks,
  );

  if (measuredSplitInfo) {
    if (measuredSplitInfo.totalLineCount <= maxLines) {
      return {
        currentPageText: plainText,
        remainingText: '',
        height: style.marginTop + measuredSplitInfo.totalLineCount * lineHeight + style.marginBottom,
      };
    }

    const currentPageText = plainText.slice(0, measuredSplitInfo.splitOffset);
    const remainingText = plainText.slice(measuredSplitInfo.splitOffset);
    if (currentPageText.trim().length === 0) {
      return null;
    }

    return {
      currentPageText,
      remainingText,
      height: style.marginTop + measuredSplitInfo.usedLineCount * lineHeight + style.marginBottom,
    };
  }

  // 使用 estimateTextLines 计算总行数（保持与分页一致）
  const totalLines = estimateTextLines(
    plainText,
    lineWidths.followingLineWidthPx,
    style.fontSize,
    { firstLineWidthPx: lineWidths.firstLineWidthPx },
  );

  if (totalLines <= maxLines) {
    // 全部内容可以放下
    return {
      currentPageText: plainText,
      remainingText: '',
      height: style.marginTop + totalLines * lineHeight + style.marginBottom,
    };
  }

  // 需要分割文本：先尊重源码中的显式换行；如果单个源码行自身跨越多条视觉行，
  // 再按估算视觉行边界切开，避免在用户看到的同一行中间提前换页。
  const lines = plainText.split('\n');

  let accumulatedLines = 0;
  let lastSafeSplitOffset = 0;
  let lastSafeLineCount = 0;
  let lineStartOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const isLastLine = i === lines.length - 1;
    const lineEndOffset = lineStartOffset + lineText.length;
    const splitOffsetAfterLine = isLastLine ? lineEndOffset : lineEndOffset + 1;
    const lineFirstWidthPx =
      i === 0 ? lineWidths.firstLineWidthPx : lineWidths.followingLineWidthPx;

    // 使用 estimateTextLines 计算这一行的行数（与分页逻辑一致）
    const currentLineBreaks = estimateTextLines(
      lineText,
      lineWidths.followingLineWidthPx,
      style.fontSize,
      { firstLineWidthPx: lineFirstWidthPx },
    );

    // 确保行数是有效的正数
    const validLineBreaks = Math.max(1, currentLineBreaks);

    // 检查加入这一行后是否会超出
    if (accumulatedLines + validLineBreaks > maxLines) {
      const remainingLineCount = maxLines - accumulatedLines;
      const splitOffsetInLine = computeTextSplitOffsetForLineCount(
        lineText,
        lineFirstWidthPx,
        style.fontSize,
        remainingLineCount,
      );
      const shouldSplitInsideCurrentLine = splitOffsetInLine > 0;
      const splitOffset = shouldSplitInsideCurrentLine
        ? adjustSplitOffsetForReadableTrailingText(
            plainText,
            lineStartOffset + splitOffsetInLine,
          )
        : lastSafeSplitOffset;
      const currentPageText = plainText.slice(0, splitOffset);
      const remainingText = plainText.slice(splitOffset);
      const usedLineCount = shouldSplitInsideCurrentLine
        ? estimateTextLines(
            currentPageText,
            lineWidths.followingLineWidthPx,
            style.fontSize,
            { firstLineWidthPx: lineWidths.firstLineWidthPx },
          )
        : lastSafeLineCount;

      // 如果当前页文本为空，返回 null 让整个块翻页
      if (currentPageText.trim().length === 0) {
        return null;
      }

      return {
        currentPageText,
        remainingText,
        height: style.marginTop + usedLineCount * lineHeight + style.marginBottom,
      };
    }

    // 这一行可以放入，更新累计行数和最后安全分割点
    accumulatedLines += validLineBreaks;
    lastSafeSplitOffset = splitOffsetAfterLine;
    lastSafeLineCount = accumulatedLines;
    lineStartOffset = splitOffsetAfterLine;
  }

  // 所有行都能放入
  return {
    currentPageText: plainText,
    remainingText: '',
    height: style.marginTop + totalLines * lineHeight + style.marginBottom,
  };
}

// ============== 页面构建 ==============

function createEmptyPage(
  pageNumber: number,
  contract: ResolvedStyleContract,
): PageLayout {
  return {
    pageNumber,
    blocks: [],
    contract,
    warnings: [],
  };
}

function getBlockLabel(block: LayoutBlock): string {
  switch (block.type) {
    case 'heading':
      return `标题"${getHeadingText(block) || '未命名标题'}"`;
    case 'toc':
      return '目录';
    case 'paragraph':
      return `段落"${getLayoutBlockPlainText(block).slice(0, 18) || '空段落'}${
        getLayoutBlockPlainText(block).length > 18 ? '…' : ''
      }"`;
    case 'list':
      return `列表（${block.metadata.kind === 'list' ? block.metadata.items.length : 0} 项）`;
    case 'blockquote':
      return '引用块';
    case 'code':
      return `代码块${block.metadata.kind === 'code' && block.metadata.language ? `（${block.metadata.language}）` : ''}`;
    case 'table':
      return `表格（${block.metadata.kind === 'table' ? block.metadata.rows.length : 0} 行）`;
    case 'image':
      return `图片${block.metadata.kind === 'image' && block.metadata.alt ? `"${block.metadata.alt}"` : ''}`;
    case 'horizontalRule':
      return '分隔线';
    case 'pageBreak':
      return '分页符';
    default:
      return '内容块';
  }
}

function createOversizedWarning(
  block: LayoutBlock,
  pageNumber: number,
): LayoutWarning {
  const blockLabel = getBlockLabel(block);
  return {
    pageNumber,
    type: 'oversizedBlock',
    blockType: block.type,
    blockLabel,
    message: `${blockLabel}的估算高度已经超过单页正文可用高度。`,
    suggestion: '建议拆分内容，或调整字号、边距后再排版。',
  };
}

function syncPlacedBlocksToPage(
  page: PageLayout,
  placedBlocks: PlacedBlockEntry[],
): void {
  page.blocks = placedBlocks.map((entry) => entry.block);
}

function createPlacedBlockEntry(
  block: LayoutBlock,
  height: number,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
): PlacedBlockEntry {
  const margins = height > 0
    ? resolveBlockVerticalMargins(block, contract, styles)
    : { marginTop: 0, marginBottom: 0 };

  return {
    block,
    height,
    marginTop: margins.marginTop,
    marginBottom: margins.marginBottom,
  };
}

function getCollapsedAdjacentMarginReduction(
  previousEntry: PlacedBlockEntry | undefined,
  nextEntry: PlacedBlockEntry,
): number {
  if (!previousEntry) {
    return 0;
  }

  // 画布里的标题、段落、列表等是普通块级流，浏览器会把相邻块的上下 margin 折叠。
  // 分页算法的单块高度已经各自包含 margin，如果直接相加会把页尾剩余空间算得偏小。
  return Math.min(
    Math.max(0, previousEntry.marginBottom),
    Math.max(0, nextEntry.marginTop),
  );
}

function getPlacedBlockHeightDelta(
  placedBlocks: PlacedBlockEntry[],
  nextEntry: PlacedBlockEntry,
): number {
  const previousEntry = placedBlocks[placedBlocks.length - 1];
  const reduction = getCollapsedAdjacentMarginReduction(previousEntry, nextEntry);

  return Math.max(0, nextEntry.height - reduction);
}

function appendPlacedBlock(
  placedBlocks: PlacedBlockEntry[],
  currentHeight: number,
  block: LayoutBlock,
  height: number,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
): number {
  const entry = createPlacedBlockEntry(block, height, contract, styles);
  const delta = getPlacedBlockHeightDelta(placedBlocks, entry);
  placedBlocks.push(entry);

  return currentHeight + delta;
}

function getAvailableHeightForBlock(
  placedBlocks: PlacedBlockEntry[],
  currentHeight: number,
  pageCapacity: number,
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
): number {
  const entry = createPlacedBlockEntry(block, 1, contract, styles);
  const previousEntry = placedBlocks[placedBlocks.length - 1];
  const reduction = getCollapsedAdjacentMarginReduction(previousEntry, entry);

  return pageCapacity - currentHeight + reduction;
}

function sumPlacedBlockHeights(placedBlocks: PlacedBlockEntry[]): number {
  return placedBlocks.reduce(
    (total, entry, index) =>
      total + getPlacedBlockHeightDelta(placedBlocks.slice(0, index), entry),
    0,
  );
}

function hasRemainingContent(blocks: LayoutBlock[], startIndex: number): boolean {
  for (let index = startIndex; index < blocks.length; index += 1) {
    if (blocks[index].type !== 'pageBreak') {
      return true;
    }
  }
  return false;
}

// ============== 核心分页算法 ==============

/**
 * 分页测试算法1：页面利用最大化
 *
 * 特点：
 * - 文本块按行分割，在最优分割点截断
 * - 表格优先按行分割，普通长行可继续按单元格文本拆分
 * - 列表优先按项分割，超长列表项可继续按文本片段拆分
 * - 图片超过可用高度直接翻页
 * - 不处理孤儿行和寡妇行
 * - 使用块高度缓存提升性能
 */
export function paginateMaxFillBlocks(
  context: PaginationAlgorithmContext,
): PageLayout[] {
  const { blocks: originalBlocks, contract, styles, measuredBlockHeights, measuredTextLineBreaks } = context;

  if (originalBlocks.length === 0) {
    return [createEmptyPage(1, contract)];
  }

  const pageCapacity = contract.contentHeightPx;
  const tocItems = buildTocItemsFromBlocks(originalBlocks);
  const pages: PageLayout[] = [];
  let currentPage = createEmptyPage(1, contract);
  let currentHeight = 0;
  let placedBlocks: PlacedBlockEntry[] = [];
  let shouldPushCurrentPage = true;

  // 创建可修改的工作数组（浅拷贝，避免修改原始冻结数组）
  let blocks = [...originalBlocks];

  // 使用索引遍历，让剩余块可以在后续迭代中处理
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    // 处理手动分页符
    if (block.type === 'pageBreak') {
      const nextIndex = index + 1;
      const nextHasContent = hasRemainingContent(blocks, nextIndex);

      syncPlacedBlocksToPage(currentPage, placedBlocks);
      if (placedBlocks.length > 0 || (pages.length > 0 && nextHasContent)) {
        pages.push(currentPage);
      }

      currentPage = createEmptyPage(pages.length + 1, contract);
      currentHeight = 0;
      placedBlocks = [];
      shouldPushCurrentPage = nextHasContent;
      continue;
    }

    // 处理浮动图片（文字环绕）
    const floatingImageHeight = estimateFloatingImageFootprintHeight(block, contract);
    if (
      floatingImageHeight > 0 &&
      placedBlocks.length > 0 &&
      currentHeight + floatingImageHeight > pageCapacity
    ) {
      syncPlacedBlocksToPage(currentPage, placedBlocks);
      pages.push(currentPage);
      currentPage = createEmptyPage(pages.length + 1, contract);
      currentHeight = 0;
      placedBlocks = [];
    }

    // 计算当前块高度
    // 目录高度取决于整篇文档标题数量，不能只按块对象缓存，否则标题变化后会复用旧高度。
    const measuredBlockHeight = block.type === 'toc'
      ? null
      : getMeasuredTopLevelBlockHeight(block, measuredBlockHeights);
    const estimatedBlockHeight = block.type === 'toc'
      ? estimateBlockHeight(block, contract, tocItems, styles)
      : getCachedBlockHeight(block, contract, tocItems, styles);
    const blockHeight = resolvePlacementBlockHeight({
      block,
      estimatedHeight: estimatedBlockHeight,
      measuredHeight: measuredBlockHeight,
      contract,
      styles,
    });
    const availableHeightForBlock = getAvailableHeightForBlock(
      placedBlocks,
      currentHeight,
      pageCapacity,
      block,
      contract,
      styles,
    );

    if (block.type === 'toc' && block.metadata.kind === 'toc' && blockHeight > availableHeightForBlock) {
      const maxDepth = block.metadata.maxDepth;
      const totalFilteredTocItems = tocItems.filter((item) => item.depth <= maxDepth).length;
      let startItemIndex = 0;
      let fragmentIndex = 1;

      while (startItemIndex < Math.max(1, totalFilteredTocItems)) {
        const availableHeight = getAvailableHeightForBlock(
          placedBlocks,
          currentHeight,
          pageCapacity,
          block,
          contract,
          styles,
        );
        const fragment = buildTocFragment({
          block,
          allTocItems: tocItems,
          startItemIndex,
          availableHeight,
          fragmentIndex,
          isCurrentPageEmpty: placedBlocks.length === 0,
          contract,
        });

        if (!fragment) {
          if (placedBlocks.length === 0) {
            currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
            currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
            shouldPushCurrentPage = true;
            break;
          }

          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          continue;
        }

        if (fragment.height > pageCapacity) {
          currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
        }

        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, fragment.block, fragment.height, contract, styles);
        startItemIndex = fragment.nextItemIndex;
        fragmentIndex += 1;
        shouldPushCurrentPage = true;

        const totalTocItems = fragment.block.metadata.kind === 'toc'
          ? fragment.block.metadata.runtimeSlice?.totalItems ?? 0
          : 0;
        if (startItemIndex < totalTocItems) {
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
        }
      }

      continue;
    }

    // 处理表格块：整表放不下当前页时，优先把能容纳的表格行留在当前页。
    if (isTableBlock(block) && block.metadata.rows.length > 0) {
      if (blockHeight <= availableHeightForBlock) {
        // 表格可以完整放入当前页时，不生成运行时片段，保留原始块结构。
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        shouldPushCurrentPage = true;
        continue;
      }

      let tableBlock = block;
      let rowHeights = tableBlock.metadata.rows.map((row, rowIndex) =>
        estimateTableRowHeight(tableBlock, row, rowIndex, contract, styles),
      );
      let startRowIndex = 0;
      let fragmentIndex = 1;

      while (startRowIndex < tableBlock.metadata.rows.length) {
        const availableHeight = getAvailableHeightForBlock(
          placedBlocks,
          currentHeight,
          pageCapacity,
          tableBlock,
          contract,
          styles,
        );
        const fragment = buildTableFragment({
          block: tableBlock,
          startRowIndex,
          availableHeight,
          fragmentIndex,
          isCurrentPageEmpty: placedBlocks.length === 0,
          rowHeights,
          contract,
          styles,
          measuredTextLineBreaks,
        });

        if (!fragment) {
          if (placedBlocks.length === 0) {
            // 极端数据兜底：空页仍无法生成片段时，强制放入并给出超高内容提示，避免分页死循环。
            currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
            const fallbackHeight = estimateTableBlockHeight(tableBlock, contract, styles);
            currentHeight = appendPlacedBlock(placedBlocks, currentHeight, tableBlock, fallbackHeight, contract, styles);
            startRowIndex = tableBlock.metadata.rows.length;
            shouldPushCurrentPage = true;
            break;
          }

          // 当前页剩余空间连表头/首行都放不下时，先结束当前页，再在新页继续拆表格。
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          continue;
        }

        if (fragment.height > pageCapacity) {
          currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
        }

        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, fragment.block, fragment.height, contract, styles);
        if (fragment.remainingRow) {
          tableBlock = {
            ...tableBlock,
            metadata: {
              ...tableBlock.metadata,
              rows: tableBlock.metadata.rows.map((row, rowIndex) =>
                rowIndex === fragment.nextRowIndex ? fragment.remainingRow! : row,
              ),
            },
          };
          rowHeights = tableBlock.metadata.rows.map((row, rowIndex) =>
            estimateTableRowHeight(tableBlock, row, rowIndex, contract, styles),
          );
        }
        startRowIndex = fragment.nextRowIndex;
        fragmentIndex += 1;
        shouldPushCurrentPage = true;

        if (startRowIndex < tableBlock.metadata.rows.length) {
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
        }
      }
      continue;
    }

    // 处理列表块（按列表项分割，避免标题后整组列表翻页造成大空白）
    if (isListBlock(block) && block.metadata.items.length > 0) {
      if (blockHeight <= availableHeightForBlock) {
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        shouldPushCurrentPage = true;
        continue;
      }

      let listBlock = block;
      let startItemIndex = 0;
      let fragmentIndex = 1;

      while (startItemIndex < listBlock.metadata.items.length) {
        const availableHeight = getAvailableHeightForBlock(
          placedBlocks,
          currentHeight,
          pageCapacity,
          listBlock,
          contract,
          styles,
        );
        const fragment = buildListFragment({
          block: listBlock,
          startItemIndex,
          availableHeight,
          fragmentIndex,
          isCurrentPageEmpty: placedBlocks.length === 0,
          contract,
          styles,
          measuredTextLineBreaks,
        });

        if (!fragment) {
          if (placedBlocks.length === 0) {
            // 理论上空页至少会强制容纳一个列表项；这里兜底避免异常数据卡住分页。
            currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
            currentHeight = appendPlacedBlock(placedBlocks, currentHeight, listBlock, blockHeight, contract, styles);
            startItemIndex = listBlock.metadata.items.length;
            shouldPushCurrentPage = true;
            break;
          }

          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          continue;
        }

        if (fragment.height > pageCapacity) {
          currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
        }

        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, fragment.block, fragment.height, contract, styles);
        if (fragment.remainingItem) {
          // 超长列表项拆分后，剩余文字替换回当前项位置，让下一页继续按同一列表顺序处理。
          listBlock = {
            ...listBlock,
            metadata: {
              ...listBlock.metadata,
              items: listBlock.metadata.items.map((item, itemIndex) =>
                itemIndex === fragment.nextItemIndex ? fragment.remainingItem! : item,
              ),
            },
          };
        }
        startItemIndex = fragment.nextItemIndex;
        fragmentIndex += 1;
        shouldPushCurrentPage = true;

        if (startItemIndex < listBlock.metadata.items.length) {
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
        }
      }

      continue;
    }

    // 处理图片块（超过可用高度直接翻页）
    if (block.type === 'image' && block.metadata.kind === 'image') {
      const imageHeight = estimateImageBlockHeight(block, contract);
      const imageAvailableHeight = getAvailableHeightForBlock(
        placedBlocks,
        currentHeight,
        pageCapacity,
        block,
        contract,
        styles,
      );

      // 图片超过当前可用高度，直接翻页
      if (imageHeight > imageAvailableHeight && placedBlocks.length > 0) {
        syncPlacedBlocksToPage(currentPage, placedBlocks);
        pages.push(currentPage);
        currentPage = createEmptyPage(pages.length + 1, contract);
        currentHeight = 0;
        placedBlocks = [];
      }

      // 再次检查图片是否超过整页
      if (imageHeight > pageCapacity) {
        currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
      }

      currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, imageHeight, contract, styles);
      shouldPushCurrentPage = true;
      continue;
    }

    // 处理文本块（标题、段落）
    if (block.type === 'heading' || block.type === 'paragraph') {
      const availableHeight = availableHeightForBlock;

      // 检查块是否能放入当前页
      if (blockHeight <= availableHeight) {
        // 可以完整放入
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        shouldPushCurrentPage = true;
      } else {
        // 不能完整放入，尝试按行分割
        const splitInfo = computeOptimalTextSplit(
          block,
          availableHeight,
          contract,
          styles,
          measuredTextLineBreaks,
        );

        if (splitInfo) {
          // splitInfo 返回当前页文本和剩余文本两部分
          // 当前页文本放入当前页，剩余文本创建新块放入下一页

          // 将当前页文本放入当前页（只有非空文本才放入）
          if (splitInfo.currentPageText.length > 0) {
            const { currentPageRuns, remainingRuns } = splitTextRunsByPlainTextLength(
              block.textRuns,
              splitInfo.currentPageText.length,
            );
            const fragmentBlock = createTextFragmentBlock(
              block,
              currentPageRuns,
              splitInfo.currentPageText,
              `frag-${pages.length}-${placedBlocks.length}`,
            );

            currentHeight = appendPlacedBlock(placedBlocks, currentHeight, fragmentBlock, splitInfo.height, contract, styles);
            shouldPushCurrentPage = true;

            // 创建剩余文本块，并插到当前块之后，确保它紧跟原块继续分页。
            const remainingBlock = createTextFragmentBlock(
              block,
              remainingRuns,
              splitInfo.remainingText,
              `rest-${pages.length}-${placedBlocks.length}`,
            );

            blocks.splice(index + 1, 0, remainingBlock);
          }
        } else {
          // splitInfo 为 null（usableHeight<=0）→ 整个块翻页
          // 当前页剩余空间不足时，先换页，再让同一个文本块重新走完整分割流程。
          if (placedBlocks.length > 0) {
            syncPlacedBlocksToPage(currentPage, placedBlocks);
            pages.push(currentPage);
            currentPage = createEmptyPage(pages.length + 1, contract);
            currentHeight = 0;
            placedBlocks = [];
            index -= 1;
            continue;
          }

          if (blockHeight > pageCapacity) {
            currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
          }

          currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
          shouldPushCurrentPage = true;
        }
      }
      continue;
    }

    // 处理其他类型块（列表、引用、代码块、分隔线等）
    if (blockHeight > availableHeightForBlock) {
      if (placedBlocks.length === 0) {
        // 超大块警告
        currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        shouldPushCurrentPage = true;
      } else {
        // 开启新页面
        syncPlacedBlocksToPage(currentPage, placedBlocks);
        pages.push(currentPage);
        currentPage = createEmptyPage(pages.length + 1, contract);
        currentHeight = 0;
        placedBlocks = [];

        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        shouldPushCurrentPage = true;
      }
    } else {
      currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
      shouldPushCurrentPage = true;
    }
  }

  // 处理最后一页
  syncPlacedBlocksToPage(currentPage, placedBlocks);
  if (placedBlocks.length > 0 || pages.length === 0 || shouldPushCurrentPage) {
    pages.push(currentPage);
  }

  return pages;
}

// ============== 算法定义导出 ==============

import { MAX_FILL_PAGINATION_ALGORITHM_ID } from '../algorithmIds';
import type { PaginationAlgorithmDefinition } from '../types';

/**
 * 分页测试算法1定义：页面利用最大化
 */
export const estimatedMaxFillPaginationAlgorithm: PaginationAlgorithmDefinition = {
  id: MAX_FILL_PAGINATION_ALGORITHM_ID,
  label: '分页测试算法1',
  description: '页面利用最大化：文本按行分割，表格优先按行分割，列表优先按项分割，普通长行和超长列表项可继续按文本片段拆分。支持单栏/双栏/三栏布局，不处理孤儿行和寡妇行。',
  paginate: (context) => paginateMaxFillBlocks(context),
};
