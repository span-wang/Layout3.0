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
  CHOICE_OPTION_COLUMN_GAP_PX,
  CHOICE_OPTION_LABEL_GAP_PX,
  CHOICE_OPTION_LABEL_WIDTH_PX,
  chunkCompactChoiceItems,
  getHeadingText,
  getLayoutBlockPlainText,
  getLayoutListItemLevel,
  parseChoiceOptionPrefix,
  resolveCompactChoiceListLayoutWithOptions,
  buildTocItemsFromBlocks,
  getTableCellColSpan,
  isCoveredTableCell,
  resolveTableColumnWidths,
  resolveTableRowHeightPx,
  type BlockquoteBlockMetadata,
  type ColumnSectionBlockMetadata,
  type LayoutBlock,
  type LayoutListItem,
  type LayoutStyleSheet,
  type LayoutTableCell,
  type LayoutTableRow,
  type ListBlockMetadata,
  type RuntimeRowMeasurement,
  type RuntimeTextMeasurement,
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
import { resolveColumnSectionContract, shouldLayoutBlockSpanAllColumns } from '@/engine/style/columnLayout';
import {
  getEffectiveListItemMaxFontSize,
  getEffectiveListItemFontFamily,
  getEffectiveTableCellMaxFontSize,
  getEffectiveTableCellFontFamily,
  getEffectiveTextRunsMaxFontSize,
  getEffectiveTextRunsFontFamily,
  resolveEffectiveTextLineHeight,
} from '@/engine/style/quickTextStyle';
import { estimateTextLines, computeTextSplitOffsetForLineCount } from '../textMetrics';
import { buildTocFragment, estimateTocBlockHeight } from '../tocLayout';
import type { TocFragmentBuildResult } from '../tocLayout';
import type {
  LayoutWarning,
  MeasuredTableRowHeights,
  MeasuredTextFragmentHeights,
  MeasuredTextLineBreaks,
  PageLayout,
  PaginationAlgorithmContext,
  TableRowMeasurementJob,
  TextFragmentMeasurementJob,
} from '../types';
import {
  createTableRowMeasurementId,
  createTextFragmentMeasurementId,
  enqueueTableRowMeasurementJob,
  enqueueTextFragmentMeasurementJob,
  getMeasuredTableRowHeight,
  getMeasuredTextFragmentHeight,
} from './domMeasure/measurementCache';

// ============== 类型定义 ==============

type TableLayoutBlock = LayoutBlock & {
  type: 'table';
  metadata: TableBlockMetadata;
};

type ListLayoutBlock = LayoutBlock & {
  type: 'list';
  metadata: ListBlockMetadata;
};

type BlockquoteLayoutBlock = LayoutBlock & {
  type: 'blockquote';
  metadata: BlockquoteBlockMetadata;
};

type ColumnSectionLayoutBlock = LayoutBlock & {
  type: 'columnSection';
  metadata: ColumnSectionBlockMetadata;
};

interface RuntimeTextMeasurable {
  id: string;
  textRuns: TextRun[];
  runtimeMeasurement?: RuntimeTextMeasurement | null;
}

interface RuntimeRowMeasurable {
  id: string;
  runtimeMeasurement?: RuntimeRowMeasurement | null;
}

interface PlacedBlockEntry {
  block: LayoutBlock;
  height: number;
  marginTop: number;
  marginBottom: number;
}

interface ColumnFlowState {
  pageHeight: number;
  columnCount: number;
  completedOffset: number;
  currentColumnIndex: number;
  columnHeights: number[];
}

interface ColumnPlacementCandidate {
  fits: boolean;
  availableHeight: number;
  columnIndex: number;
  isSpanAll: boolean;
}

interface TextFragmentInfo {
  /** 当前页放的文本 */
  currentPageText: string;
  /** 剩余文本（需要放到下一页） */
  remainingText: string;
  /** 当前页使用的高度 */
  height: number;
  /** 当前页片段是否需要去掉整段段后距，避免跨页时重复占用页尾空间 */
  omitTrailingSpaceAfter?: boolean;
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

// PH2-20 多栏块切分通用机制 V1：统一接口上下文。
// 表达当前栏位与是否允许强制放入首项的最小必要信息，供各块类型的切分函数共享。
interface BlockSplitContext {
  availableHeight: number;
  columnIndex: number;
  isCurrentColumnEmpty: boolean;
  fragmentIndex: number;
}

// PH2-20 多栏块切分通用机制 V1：表格统一切分入口。
// 入参只保留切分所需的最小依赖，避免与外部循环强耦合；
// 返回值与现有 TableFragmentBuildResult 保持一致，方便后续直接接入统一调度。
interface TrySplitTableToFitHeightPayload {
  block: TableLayoutBlock;
  startRowIndex: number;
  rowHeights: number[];
  context: BlockSplitContext;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
  measuredTableRowHeights?: MeasuredTableRowHeights;
  tableRowMeasurementJobs?: TableRowMeasurementJob[];
}

interface ListFragmentBuildResult {
  block: LayoutBlock;
  height: number;
  nextItemIndex: number;
  remainingItem?: LayoutListItem;
}

interface BlockquoteFragmentBuildResult {
  block: LayoutBlock;
  height: number;
  remainingBlock?: LayoutBlock;
}

const MM_TO_PX = 96 / 25.4;

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
const DEFAULT_BOTTOM_SAFE_AREA_RATIO = 0.0125;
const DEFAULT_BOTTOM_SAFE_AREA_MIN_PX = 2;
const DEFAULT_BOTTOM_SAFE_AREA_MAX_PX = 12;
const BLOCKQUOTE_CONTAINER_EXTRA_HEIGHT_PX = 16;
const MEASURED_HEIGHT_ESTIMATE_TOLERANCE_PX = 4;

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

function getPaginationContentWidthPx(contract: ResolvedStyleContract): number {
  if (contract.columnCount <= 1) {
    return contract.contentWidthPx;
  }

  return Math.max(
    40,
    (contract.contentWidthPx - Math.max(0, contract.columnCount - 1) * contract.columnGapPx) /
      contract.columnCount,
  );
}

function getPaginationPageCapacityPx(contract: ResolvedStyleContract): number {
  return contract.contentHeightPx * contract.columnCount;
}

function getBlockMeasurementWidthPx(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
): number {
  if (contract.columnCount > 1 && isColumnSpanAllBlock(block, contract)) {
    return contract.contentWidthPx;
  }

  return getPaginationContentWidthPx(contract);
}

function getRuntimeTextTotalLength(textRuns: TextRun[]): number {
  return textRuns.reduce((total, run) => total + run.text.length, 0);
}

function resolveRuntimeTextMeasurement(
  item: RuntimeTextMeasurable,
): RuntimeTextMeasurement {
  const fallbackLength = getRuntimeTextTotalLength(item.textRuns);
  return item.runtimeMeasurement ?? {
    sourceNodeId: item.id,
    startOffset: 0,
    endOffset: fallbackLength,
  };
}

function createRuntimeTextMeasurementSlice(
  source: RuntimeTextMeasurement,
  startOffset: number,
  endOffset: number,
): RuntimeTextMeasurement {
  return {
    sourceNodeId: source.sourceNodeId,
    startOffset: source.startOffset + startOffset,
    endOffset: source.startOffset + endOffset,
  };
}

function resolveRuntimeRowMeasurement(
  row: RuntimeRowMeasurable,
): RuntimeRowMeasurement {
  return row.runtimeMeasurement ?? {
    sourceRowId: row.id,
  };
}

function resolveDefaultBottomSafeAreaPx(contract: ResolvedStyleContract): number {
  // 分页测试算法1追求最大填充，但页面底部必须保留少量保险距离，避免真实渲染误差把最后一行压进页脚。
  return Math.min(
    DEFAULT_BOTTOM_SAFE_AREA_MAX_PX,
    Math.max(
      DEFAULT_BOTTOM_SAFE_AREA_MIN_PX,
      Math.round(contract.contentHeightPx * DEFAULT_BOTTOM_SAFE_AREA_RATIO),
    ),
  );
}

function createColumnFlowState(contract: ResolvedStyleContract): ColumnFlowState {
  return {
    pageHeight: contract.contentHeightPx,
    columnCount: Math.max(1, contract.columnCount),
    completedOffset: 0,
    currentColumnIndex: 0,
    columnHeights: Array.from({ length: Math.max(1, contract.columnCount) }, () => 0),
  };
}

function resetColumnFlowState(state: ColumnFlowState): void {
  state.completedOffset = 0;
  state.currentColumnIndex = 0;
  state.columnHeights = Array.from({ length: state.columnCount }, () => 0);
}

// 多栏分页新增：尝试把当前栏推进到下一栏，仅在还有未填满的栏位时使用，
// 不重置 columnHeights，避免切分剩余内容直接跳回新页第一栏。
// 返回 true 表示成功推进到下一栏；false 表示所有栏都已填满，调用方应当真正换页。
function advanceToNextColumn(state: ColumnFlowState): boolean {
  if (state.columnCount <= 1) {
    return false;
  }
  if (state.currentColumnIndex >= state.columnCount - 1) {
    return false;
  }
  state.currentColumnIndex += 1;
  state.completedOffset = 0;
  return true;
}

// PH2-20：抽取“当前栏剩余高度”计算，被 5 种块类型入口判断共享。
// 单栏时按 currentHeight + bottomSafeAreaPx 给出正页可用剩余；
// 多栏时按当前栏 columnHeights[currentColumnIndex] + bottomSafeAreaPx 计算当前栏剩余。
function resolveCurrentColumnRemainingHeight(
  state: ColumnFlowState,
  isMultiColumn: boolean,
  currentHeight: number,
  bottomSafeAreaPx: number,
): number {
  if (isMultiColumn) {
    return Math.max(
      0,
      state.pageHeight - state.columnHeights[state.currentColumnIndex] - bottomSafeAreaPx,
    );
  }
  return Math.max(0, state.pageHeight - currentHeight - bottomSafeAreaPx);
}

function getCurrentBandHeight(state: ColumnFlowState): number {
  return state.columnHeights.reduce((maxHeight, height) => Math.max(maxHeight, height), 0);
}

function isColumnSpanAllBlock(block: LayoutBlock, contract: ResolvedStyleContract): boolean {
  return shouldLayoutBlockSpanAllColumns(block, contract);
}

function isHeadingBlock(block: LayoutBlock): boolean {
  return block.type === 'heading' && block.metadata.kind === 'heading';
}

function resolveHeadingBlockStyle(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
): TextBlockStyleRule {
  if (block.metadata.kind !== 'heading') {
    return contract.blockStyles.heading3;
  }

  if (block.metadata.depth === 1) {
    return contract.blockStyles.heading1;
  }

  if (block.metadata.depth === 2) {
    return contract.blockStyles.heading2;
  }

  return contract.blockStyles.heading3;
}

function shouldKeepBlockWithNext(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
): boolean {
  if (block.pagination.keepWithNext === true) {
    return true;
  }

  if (!isHeadingBlock(block)) {
    return false;
  }

  return resolveHeadingBlockStyle(block, contract).keepWithNext;
}

function resolveColumnPlacementCandidate(
  state: ColumnFlowState,
  block: LayoutBlock,
  blockHeight: number,
  contract: ResolvedStyleContract,
): ColumnPlacementCandidate {
  if (contract.columnCount <= 1) {
    return {
      fits: blockHeight <= state.pageHeight - state.completedOffset - state.columnHeights[0],
      availableHeight: Math.max(0, state.pageHeight - state.completedOffset - state.columnHeights[0]),
      columnIndex: 0,
      isSpanAll: false,
    };
  }

  if (isColumnSpanAllBlock(block, contract)) {
    const availableHeight = Math.max(0, state.pageHeight - state.completedOffset - getCurrentBandHeight(state));
    return {
      fits: blockHeight <= availableHeight,
      availableHeight,
      columnIndex: 0,
      isSpanAll: true,
    };
  }

  let bestColumnIndex = state.currentColumnIndex;
  let bestAvailableHeight = -1;

  for (let columnIndex = state.currentColumnIndex; columnIndex < state.columnCount; columnIndex += 1) {
    const availableHeight = Math.max(
      0,
      state.pageHeight - state.completedOffset - state.columnHeights[columnIndex],
    );

    if (availableHeight > bestAvailableHeight) {
      bestAvailableHeight = availableHeight;
      bestColumnIndex = columnIndex;
    }

    if (blockHeight <= availableHeight) {
      return {
        fits: true,
        availableHeight,
        columnIndex,
        isSpanAll: false,
      };
    }
  }

  return {
    fits: false,
    availableHeight: Math.max(0, bestAvailableHeight),
    columnIndex: bestColumnIndex,
    isSpanAll: false,
  };
}

function applyColumnPlacement(
  state: ColumnFlowState,
  placement: ColumnPlacementCandidate,
  blockHeight: number,
): void {
  if (placement.isSpanAll) {
    state.completedOffset += getCurrentBandHeight(state) + blockHeight;
    state.currentColumnIndex = 0;
    state.columnHeights = Array.from({ length: state.columnCount }, () => 0);
    return;
  }

  state.columnHeights[placement.columnIndex] += blockHeight;
  state.currentColumnIndex = placement.columnIndex;
}

function rebuildColumnFlowState(
  state: ColumnFlowState,
  placedBlocks: PlacedBlockEntry[],
  contract: ResolvedStyleContract,
): void {
  resetColumnFlowState(state);
  placedBlocks.forEach((entry) => {
    applyColumnPlacement(
      state,
      resolveColumnPlacementCandidate(state, entry.block, entry.height, contract),
      entry.height,
    );
  });
}

function getColumnAvailableHeightForBlock(
  state: ColumnFlowState,
  block: LayoutBlock,
  blockHeight: number,
  contract: ResolvedStyleContract,
): number {
  return resolveColumnPlacementCandidate(state, block, blockHeight, contract).availableHeight;
}

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
    contentWidthPx: getPaginationContentWidthPx(contract),
    contentHeightPx: getPaginationPageCapacityPx(contract),
    columnCount: contract.columnCount,
    columnGapPx: contract.columnGapPx,
    themeLayoutMetrics: contract.themeLayoutMetrics,
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

function isBlockquoteBlock(block: LayoutBlock): block is BlockquoteLayoutBlock {
  return block.type === 'blockquote' && block.metadata.kind === 'blockquote';
}

function isColumnSectionBlock(block: LayoutBlock): block is ColumnSectionLayoutBlock {
  return block.type === 'columnSection' && block.metadata.kind === 'columnSection';
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
  decorationHeight = 0,
  fontFamily?: string,
): number {
  const lines = estimateTextLines(text, widthPx, style.fontSize, {
    firstLineWidthPx,
    fontFamily,
  });
  return style.marginTop + lines * style.lineHeight + decorationHeight + style.marginBottom;
}

function resolveHeadingDecorationHeight(contract: ResolvedStyleContract, depth: number): number {
  const metrics =
    depth === 1
      ? contract.themeLayoutMetrics.heading1
      : depth === 2
        ? contract.themeLayoutMetrics.heading2
        : contract.themeLayoutMetrics.heading3;

  // 主题装饰如果参与正文流，分页测试算法1的首次估算和页尾分割都要计入，避免实测回填后再跳页。
  return (
    metrics.paddingBottom +
    (metrics.underlineOccupiesFlow ? metrics.underlineGap + metrics.underlineHeight : 0)
  );
}

function resolveHeadingMarkerInset(contract: ResolvedStyleContract, depth: number): number {
  if (depth === 1) {
    return contract.themeLayoutMetrics.heading1.markerInsetLeft;
  }

  if (depth === 2) {
    return contract.themeLayoutMetrics.heading2.markerInsetLeft;
  }

  return contract.themeLayoutMetrics.heading3.markerInsetLeft;
}

function resolveTextBlockLineWidths(
  contentWidthPx: number,
  block: LayoutBlock,
  baseStyle: TextBlockStyleRule,
  extraInsetLeft = 0,
) {
  // 块排版预设给文字块提供默认左右内缩，单块局部缩进继续作为最高优先级。
  return resolveHangingIndentLineWidths(contentWidthPx, {
    indentLeft: (block.blockStyleOverrides.indentLeft ?? baseStyle.insetLeft) + extraInsetLeft,
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

function isEscapedDollar(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isDoubleDollarBoundary(text: string, index: number): boolean {
  return text[index - 1] === '$' || text[index + 1] === '$';
}

function collectInlineEquationRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let start: number | null = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '\n') {
      // 现有行内公式解析只接受单行 `$...$`，跨行内容不当作可保护的行内公式。
      start = null;
      continue;
    }

    if (char !== '$' || isEscapedDollar(text, index) || isDoubleDollarBoundary(text, index)) {
      continue;
    }

    if (start === null) {
      start = index;
      continue;
    }

    if (index > start + 1) {
      ranges.push({ start, end: index + 1 });
    }
    start = null;
  }

  return ranges;
}

function protectInlineEquationSplitOffset(text: string, splitOffset: number): number {
  if (splitOffset <= 0 || splitOffset >= text.length) {
    return splitOffset;
  }

  const equationRange = collectInlineEquationRanges(text).find(
    (range) => splitOffset > range.start && splitOffset < range.end,
  );
  if (!equationRange) {
    return splitOffset;
  }

  // PH2-20-inline-equation-split-guard-v1：
  // 切分点落在 `$...$` 内部时，优先把整个公式留给下一页；
  // 如果公式本来就在片段开头，则允许把完整公式放到当前页，避免留下孤立 `$`。
  if (text.slice(0, equationRange.start).trim().length > 0) {
    return equationRange.start;
  }

  return equationRange.end < text.length ? equationRange.end : 0;
}

function protectInlineEquationMeasuredSplitInfo(
  text: string,
  splitInfo: MeasuredTextSplitInfo | null,
): MeasuredTextSplitInfo | null {
  if (!splitInfo || splitInfo.splitOffset <= 0 || splitInfo.splitOffset >= text.length) {
    return splitInfo;
  }

  const splitOffset = protectInlineEquationSplitOffset(text, splitInfo.splitOffset);
  return {
    ...splitInfo,
    splitOffset,
  };
}

// PH2-20-block-split-text-rendering-adaptation-v1：文本块（heading / paragraph）的运行时切片元数据。
// 与 table / list / toc 同口径，把续排位置从隐式 id 后缀转为结构化字段。
interface TextFragmentContext {
  isContinuation: boolean;
  isOriginal: boolean;
  sourceNodeId: string;
  characterRange: { start: number; end: number };
  fragmentIdSuffix: string;
}

// 从 LayoutBlock 取出已有的文本块 runtimeSlice（如果有）。
// 注意：LayoutBlockMetadata 是联合类型，runtimeSlice 是 heading / paragraph 上的可选字段；
// 这里用结构化类型 + 必填字段守卫，避免误把 list / toc 的 runtimeSlice 当成 text 的。
function isTextBlockExistingSlice(
  block: LayoutBlock,
): { sourceNodeId: string; characterRange: { start: number; end: number } } | undefined {
  if (block.type !== 'heading' && block.type !== 'paragraph') return undefined;
  const meta = block.metadata as { runtimeSlice?: unknown };
  if (!meta.runtimeSlice || typeof meta.runtimeSlice !== 'object') return undefined;
  const slice = meta.runtimeSlice as {
    isContinuation?: unknown;
    isOriginal?: unknown;
    sourceNodeId?: unknown;
    characterRange?: unknown;
    fragmentIdSuffix?: unknown;
  };
  // 文本块 runtimeSlice 必有 isContinuation / isOriginal / characterRange；其它块类型不会有这些字段。
  if (typeof slice.isContinuation !== 'boolean') return undefined;
  if (typeof slice.isOriginal !== 'boolean') return undefined;
  if (typeof slice.sourceNodeId !== 'string') return undefined;
  if (
    !slice.characterRange ||
    typeof slice.characterRange !== 'object' ||
    typeof (slice.characterRange as { start?: unknown }).start !== 'number' ||
    typeof (slice.characterRange as { end?: unknown }).end !== 'number'
  ) {
    return undefined;
  }
  return {
    sourceNodeId: slice.sourceNodeId,
    characterRange: {
      start: (slice.characterRange as { start: number }).start,
      end: (slice.characterRange as { end: number }).end,
    },
  };
}

function createTextFragmentBlock(
  block: LayoutBlock,
  textRuns: TextRun[],
  text: string,
  idSuffix: string,
  options: {
    omitLeadingSpaceBefore?: boolean;
    omitTrailingSpaceAfter?: boolean;
    preserveOriginalIdentity?: boolean;
    runtimeMeasurement?: RuntimeTextMeasurement | null;
    // PH2-20-block-split-text-rendering-adaptation-v1：文本块运行时切片上下文，
    // 传入后函数内部会对 heading / paragraph 的 metadata 一次性写入完整 runtimeSlice。
    fragmentContext?: TextFragmentContext;
  } = {},
): LayoutBlock {
  const nextBlockStyleOverrides = {
    ...block.blockStyleOverrides,
  };
  // 同一段落或标题被拆成多页时，只有原始整块需要保留完整段前/段后距。
  // 运行时片段如果继续继承整段留白，会把本可容纳的最后一行提前挤到下一页。
  if (options.omitLeadingSpaceBefore) {
    nextBlockStyleOverrides.spaceBefore = 0;
  }
  if (options.omitTrailingSpaceAfter) {
    nextBlockStyleOverrides.spaceAfter = 0;
  }

  const fragmentBlock = {
    ...block,
    id: options.preserveOriginalIdentity ? block.id : `${block.id}-${idSuffix}`,
    sourceRange: options.preserveOriginalIdentity ? block.sourceRange : null,
    blockStyleOverrides: nextBlockStyleOverrides,
    textRuns,
    runtimeMeasurement: options.runtimeMeasurement ?? block.runtimeMeasurement ?? null,
  };

  // PH2-20-block-split-text-rendering-adaptation-v1：heading / paragraph 一次性写入完整 runtimeSlice。
  // 其它块类型（code / blockquote）不需要本字段；保留 metadata 原状。
  if (options.fragmentContext && fragmentBlock.type === 'heading' && fragmentBlock.metadata.kind === 'heading') {
    return {
      ...fragmentBlock,
      metadata: {
        ...fragmentBlock.metadata,
        text,
        runtimeSlice: {
          isContinuation: options.fragmentContext.isContinuation,
          isOriginal: options.fragmentContext.isOriginal,
          sourceNodeId: options.fragmentContext.sourceNodeId,
          characterRange: options.fragmentContext.characterRange,
          fragmentIdSuffix: options.fragmentContext.fragmentIdSuffix,
        },
      },
    };
  }

  if (options.fragmentContext && fragmentBlock.type === 'paragraph' && fragmentBlock.metadata.kind === 'paragraph') {
    return {
      ...fragmentBlock,
      metadata: {
        ...fragmentBlock.metadata,
        text,
        runtimeSlice: {
          isContinuation: options.fragmentContext.isContinuation,
          isOriginal: options.fragmentContext.isOriginal,
          sourceNodeId: options.fragmentContext.sourceNodeId,
          characterRange: options.fragmentContext.characterRange,
          fragmentIdSuffix: options.fragmentContext.fragmentIdSuffix,
        },
      },
    };
  }

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

function createBlockquoteFragmentBlock(
  block: BlockquoteLayoutBlock,
  blocks: LayoutBlock[],
  idSuffix: string,
  options: { preserveOriginalIdentity?: boolean } = {},
): LayoutBlock {
  return {
    ...block,
    id: options.preserveOriginalIdentity ? block.id : `${block.id}-${idSuffix}`,
    sourceRange: options.preserveOriginalIdentity ? block.sourceRange : null,
    metadata: {
      ...block.metadata,
      blocks,
    },
  };
}

function createCodeFragmentBlock(
  block: LayoutBlock,
  textRuns: TextRun[],
  text: string,
  idSuffix: string,
  options: {
    omitLeadingSpaceBefore?: boolean;
    omitTrailingSpaceAfter?: boolean;
    preserveOriginalIdentity?: boolean;
    runtimeMeasurement?: RuntimeTextMeasurement | null;
  } = {},
): LayoutBlock {
  const nextBlockStyleOverrides = {
    ...block.blockStyleOverrides,
  };
  if (options.omitLeadingSpaceBefore) {
    nextBlockStyleOverrides.spaceBefore = 0;
  }
  if (options.omitTrailingSpaceAfter) {
    nextBlockStyleOverrides.spaceAfter = 0;
  }

  return {
    ...block,
    id: options.preserveOriginalIdentity ? block.id : `${block.id}-${idSuffix}`,
    sourceRange: options.preserveOriginalIdentity ? block.sourceRange : null,
    blockStyleOverrides: nextBlockStyleOverrides,
    textRuns,
    runtimeMeasurement: options.runtimeMeasurement ?? block.runtimeMeasurement ?? null,
    metadata:
      block.type === 'code' && block.metadata.kind === 'code'
        ? {
            ...block.metadata,
            value: text,
          }
        : block.metadata,
  };
}

function buildTextBlockFragment(payload: {
  block: LayoutBlock;
  availableHeight: number;
  fragmentIdSuffix: string;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights;
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[];
}): BlockquoteFragmentBuildResult | null {
  const {
    block,
    availableHeight,
    fragmentIdSuffix,
    contract,
    styles,
    measuredTextLineBreaks,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
  } = payload;
  const splitInfo = computeOptimalTextSplit(
    block,
    availableHeight,
    contract,
    styles,
    measuredTextLineBreaks,
  );
  if (!splitInfo || splitInfo.currentPageText.length === 0) {
    return null;
  }

  const sourceRuntimeMeasurement = resolveRuntimeTextMeasurement({
    id: block.id,
    textRuns: block.textRuns,
    runtimeMeasurement: block.runtimeMeasurement,
  });
  const currentRuntimeMeasurement = createRuntimeTextMeasurementSlice(
    sourceRuntimeMeasurement,
    0,
    splitInfo.currentPageText.length,
  );
  const { currentPageRuns, remainingRuns } = splitTextRunsByPlainTextLength(
    block.textRuns,
    splitInfo.currentPageText.length,
  );
  if (currentPageRuns.length === 0) {
    return null;
  }

  const fragmentBlock = createTextFragmentBlock(
    block,
    currentPageRuns,
    splitInfo.currentPageText,
    `${fragmentIdSuffix}-current`,
    {
      omitTrailingSpaceAfter: splitInfo.omitTrailingSpaceAfter,
      preserveOriginalIdentity: splitInfo.remainingText.length === 0,
      runtimeMeasurement: currentRuntimeMeasurement,
    },
  );
  const measuredFragmentHeight = getMeasuredBlockHeightForPagination({
    block: fragmentBlock,
    contract,
    measuredBlockHeights: undefined,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
  });
  const fragmentHeight = resolvePlacementBlockHeight({
    block: fragmentBlock,
    estimatedHeight: splitInfo.height,
    measuredHeight: measuredFragmentHeight,
    contract,
    styles,
  });
  if (fragmentHeight > availableHeight) {
    return null;
  }

  const remainingBlock =
    splitInfo.remainingText.length > 0
      ? createTextFragmentBlock(
          block,
          remainingRuns,
          splitInfo.remainingText,
          `${fragmentIdSuffix}-rest`,
          {
            omitLeadingSpaceBefore: true,
            runtimeMeasurement: createRuntimeTextMeasurementSlice(
              sourceRuntimeMeasurement,
              splitInfo.currentPageText.length,
              splitInfo.currentPageText.length + splitInfo.remainingText.length,
            ),
          },
        )
      : undefined;

  return {
    block: fragmentBlock,
    height: fragmentHeight,
    remainingBlock,
  };
}

interface CodeFragmentInfo {
  currentPageText: string;
  remainingText: string;
  height: number;
  omitTrailingSpaceAfter?: boolean;
}

function computeOptimalCodeBlockSplit(payload: {
  block: LayoutBlock;
  availableHeight: number;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
}): CodeFragmentInfo | null {
  const { block, availableHeight, contract, styles, measuredTextLineBreaks } = payload;
  if (block.type !== 'code' || block.metadata.kind !== 'code') {
    return null;
  }

  const codeStyle = {
    ...contract.blockStyles.code,
    lineHeight: block.blockStyleOverrides.lineHeight ?? contract.blockStyles.code.lineHeight,
    marginTop: block.blockStyleOverrides.spaceBefore ?? contract.blockStyles.code.marginTop,
    marginBottom: block.blockStyleOverrides.spaceAfter ?? contract.blockStyles.code.marginBottom,
  };
  const codeText = block.metadata.value;
  const widthPx = Math.max(
    120,
    getPaginationContentWidthPx(contract) - contract.blockStyles.code.paddingX * 2,
  );
  const usableHeightWithTrailingSpace =
    availableHeight - codeStyle.marginTop - codeStyle.marginBottom - contract.blockStyles.code.paddingY * 2;
  const usableHeightWithoutTrailingSpace =
    availableHeight - codeStyle.marginTop - contract.blockStyles.code.paddingY * 2;
  if (usableHeightWithoutTrailingSpace <= 0 || codeStyle.lineHeight <= 0 || codeText.length === 0) {
    return null;
  }

  const maxLinesWithTrailingSpace = Math.max(0, Math.floor(usableHeightWithTrailingSpace / codeStyle.lineHeight));
  const maxLinesWithoutTrailingSpace = Math.floor(usableHeightWithoutTrailingSpace / codeStyle.lineHeight);
  if (maxLinesWithoutTrailingSpace <= 0) {
    return null;
  }

  const measuredSplitInfo = resolveMeasuredTextSplitInfo(
    block.id,
    codeText,
    maxLinesWithoutTrailingSpace,
    measuredTextLineBreaks,
    block.runtimeMeasurement,
  );
  if (measuredSplitInfo) {
    if (measuredSplitInfo.totalLineCount <= maxLinesWithTrailingSpace) {
      return {
        currentPageText: codeText,
        remainingText: '',
        height:
          codeStyle.marginTop +
          contract.blockStyles.code.paddingY * 2 +
          measuredSplitInfo.totalLineCount * codeStyle.lineHeight +
          codeStyle.marginBottom,
      };
    }

    return {
      currentPageText: codeText.slice(0, measuredSplitInfo.splitOffset),
      remainingText: codeText.slice(measuredSplitInfo.splitOffset),
      height:
        codeStyle.marginTop +
        contract.blockStyles.code.paddingY * 2 +
        measuredSplitInfo.usedLineCount * codeStyle.lineHeight,
      omitTrailingSpaceAfter: true,
    };
  }

  const totalLines = estimateTextLines(
    codeText,
    widthPx,
    codeStyle.fontSize,
    {
      fontFamily: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',
    },
  );
  if (totalLines <= maxLinesWithTrailingSpace) {
    return {
      currentPageText: codeText,
      remainingText: '',
      height:
        codeStyle.marginTop +
        contract.blockStyles.code.paddingY * 2 +
        totalLines * codeStyle.lineHeight +
        codeStyle.marginBottom,
    };
  }

  const lines = codeText.split('\n');
  let accumulatedLines = 0;
  let lastSafeSplitOffset = 0;
  let lastSafeLineCount = 0;
  let lineStartOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index];
    const isLastLine = index === lines.length - 1;
    const lineEndOffset = lineStartOffset + lineText.length;
    const splitOffsetAfterLine = isLastLine ? lineEndOffset : lineEndOffset + 1;
    const currentLineBreaks = Math.max(
      1,
      estimateTextLines(
        lineText,
        widthPx,
        codeStyle.fontSize,
        {
          fontFamily: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',
        },
      ),
    );

    if (accumulatedLines + currentLineBreaks > maxLinesWithoutTrailingSpace) {
      const remainingLineCount = maxLinesWithoutTrailingSpace - accumulatedLines;
      const splitOffsetInLine =
        remainingLineCount > 0
          ? computeTextSplitOffsetForLineCount(
              lineText,
              widthPx,
              codeStyle.fontSize,
              remainingLineCount,
              {
                fontFamily: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',
              },
            )
          : 0;
      const splitOffset = splitOffsetInLine > 0
        ? lineStartOffset + splitOffsetInLine
        : lastSafeSplitOffset;
      if (splitOffset <= 0 || splitOffset >= codeText.length) {
        return null;
      }

      const currentPageText = codeText.slice(0, splitOffset);
      const remainingText = codeText.slice(splitOffset);
      const usedLineCount =
        splitOffsetInLine > 0
          ? estimateTextLines(
              currentPageText,
              widthPx,
              codeStyle.fontSize,
              {
                fontFamily: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',
              },
            )
          : lastSafeLineCount;
      return {
        currentPageText,
        remainingText,
        height:
          codeStyle.marginTop +
          contract.blockStyles.code.paddingY * 2 +
          usedLineCount * codeStyle.lineHeight,
        omitTrailingSpaceAfter: true,
      };
    }

    accumulatedLines += currentLineBreaks;
    lastSafeSplitOffset = splitOffsetAfterLine;
    lastSafeLineCount = accumulatedLines;
    lineStartOffset = splitOffsetAfterLine;
  }

  return {
    currentPageText: codeText,
    remainingText: '',
    height:
      codeStyle.marginTop +
      contract.blockStyles.code.paddingY * 2 +
      totalLines * codeStyle.lineHeight,
    omitTrailingSpaceAfter: true,
  };
}

function buildCodeBlockFragment(payload: {
  block: LayoutBlock;
  availableHeight: number;
  fragmentIdSuffix: string;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights;
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[];
}): BlockquoteFragmentBuildResult | null {
  const {
    block,
    availableHeight,
    fragmentIdSuffix,
    contract,
    styles,
    measuredTextLineBreaks,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
  } = payload;
  const splitInfo = computeOptimalCodeBlockSplit({
    block,
    availableHeight,
    contract,
    styles,
    measuredTextLineBreaks,
  });
  if (!splitInfo || splitInfo.currentPageText.length === 0) {
    return null;
  }

  const sourceRuntimeMeasurement = resolveRuntimeTextMeasurement({
    id: block.id,
    textRuns: block.textRuns,
    runtimeMeasurement: block.runtimeMeasurement,
  });
  const currentRuntimeMeasurement = createRuntimeTextMeasurementSlice(
    sourceRuntimeMeasurement,
    0,
    splitInfo.currentPageText.length,
  );
  const { currentPageRuns, remainingRuns } = splitTextRunsByPlainTextLength(
    block.textRuns,
    splitInfo.currentPageText.length,
  );
  if (currentPageRuns.length === 0) {
    return null;
  }

  const fragmentBlock = createCodeFragmentBlock(
    block,
    currentPageRuns,
    splitInfo.currentPageText,
    `${fragmentIdSuffix}-current`,
    {
      omitTrailingSpaceAfter: splitInfo.omitTrailingSpaceAfter,
      preserveOriginalIdentity: splitInfo.remainingText.length === 0,
      runtimeMeasurement: currentRuntimeMeasurement,
    },
  );
  const measuredFragmentHeight = getMeasuredBlockHeightForPagination({
    block: fragmentBlock,
    contract,
    measuredBlockHeights: undefined,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
  });
  const fragmentHeight = resolvePlacementBlockHeight({
    block: fragmentBlock,
    estimatedHeight: splitInfo.height,
    measuredHeight: measuredFragmentHeight,
    contract,
    styles,
  });
  if (fragmentHeight > availableHeight) {
    return null;
  }

  const remainingBlock =
    splitInfo.remainingText.length > 0
      ? createCodeFragmentBlock(
          block,
          remainingRuns,
          splitInfo.remainingText,
          `${fragmentIdSuffix}-rest`,
          {
            omitLeadingSpaceBefore: true,
            runtimeMeasurement: createRuntimeTextMeasurementSlice(
              sourceRuntimeMeasurement,
              splitInfo.currentPageText.length,
              splitInfo.currentPageText.length + splitInfo.remainingText.length,
            ),
          },
        )
      : undefined;

  return {
    block: fragmentBlock,
    height: fragmentHeight,
    remainingBlock,
  };
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

function createColumnSectionFragmentBlock(
  block: ColumnSectionLayoutBlock,
  blocks: LayoutBlock[],
  idSuffix: string,
  options: {
    preserveOriginalIdentity?: boolean;
    runtimeSlice?: NonNullable<ColumnSectionBlockMetadata['runtimeSlice']>;
  } = {},
): LayoutBlock {
  return {
    ...block,
    id: options.preserveOriginalIdentity ? block.id : `${block.id}-${idSuffix}`,
    sourceRange: options.preserveOriginalIdentity ? block.sourceRange : null,
    metadata: {
      ...block.metadata,
      blocks,
      ...(options.runtimeSlice ? { runtimeSlice: options.runtimeSlice } : {}),
    },
  };
}

function resolveCompactChoiceLayoutForBlock(block: ListLayoutBlock) {
  return resolveCompactChoiceListLayoutWithOptions(block.metadata.items, {
    allowSequenceFromAnyLabel: (block.metadata.runtimeSlice?.startIndex ?? 0) > 0,
  });
}

function getCompactChoiceListItemTextWidthPx(
  contract: ResolvedStyleContract,
  columnCount: number,
): number {
  const columnWidth =
    (getPaginationContentWidthPx(contract) - Math.max(0, columnCount - 1) * CHOICE_OPTION_COLUMN_GAP_PX) /
    Math.max(1, columnCount);

  return Math.max(
    60,
    Math.floor(columnWidth - CHOICE_OPTION_LABEL_WIDTH_PX - CHOICE_OPTION_LABEL_GAP_PX),
  );
}

function estimateCompactChoiceListItemContentHeight(
  item: LayoutListItem,
  block: ListLayoutBlock,
  contract: ResolvedStyleContract,
  columnCount: number,
  styles?: LayoutStyleSheet,
  measuredTextLineBreaks?: MeasuredTextLineBreaks,
): number {
  const listStyle = resolveListBlockStyle(block, contract);
  const itemText = item.textRuns.map((run) => run.text).join('');
  const contentText = parseChoiceOptionPrefix(itemText)?.contentText ?? itemText;
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
  const measuredLineCount = measuredTextLineBreaks?.[item.id]?.length;
  const lineCount = measuredLineCount ?? estimateTextLines(
    contentText,
    getCompactChoiceListItemTextWidthPx(contract, columnCount),
    fontSize,
    {
      fontFamily: getEffectiveListItemFontFamily({
        item,
        block,
        styles,
      }),
    },
  );

  return lineCount * lineHeight;
}

function estimateCompactChoiceListHeight(
  block: ListLayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
  measuredTextLineBreaks?: MeasuredTextLineBreaks,
): number | null {
  const compactChoiceLayout = resolveCompactChoiceLayoutForBlock(block);
  if (!compactChoiceLayout) {
    return null;
  }

  const listStyle = resolveListBlockStyle(block, contract);
  const rows = chunkCompactChoiceItems(block.metadata.items, compactChoiceLayout.columns);

  return rows.reduce((totalHeight, row, rowIndex) => {
    const rowHeight = Math.max(
      ...row.map((item) =>
        estimateCompactChoiceListItemContentHeight(
          item,
          block,
          contract,
          compactChoiceLayout.columns,
          styles,
          measuredTextLineBreaks,
        ),
      ),
    );

    return totalHeight + (rowIndex === 0 ? 0 : listStyle.itemGap) + rowHeight;
  }, listStyle.marginTop + listStyle.marginBottom);
}

function estimateListItemHeight(
  item: LayoutListItem,
  fragmentItemIndex: number,
  block: ListLayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
  measuredTextLineBreaks?: MeasuredTextLineBreaks,
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights,
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[],
): number {
  const listStyle = resolveListBlockStyle(block, contract);
  const itemText = item.textRuns.map((run) => run.text).join('');
  const gap = fragmentItemIndex === 0 ? 0 : listStyle.itemGap;
  const runtimeMeasurement = item.runtimeMeasurement;
  if (runtimeMeasurement) {
    const measurementId = createTextFragmentMeasurementId({
      blockId: runtimeMeasurement.sourceNodeId,
      startOffset: runtimeMeasurement.startOffset,
      endOffset: runtimeMeasurement.endOffset,
      widthPx: getListItemTextWidthPx(item, block, contract),
    });
    const measuredHeight = getMeasuredTextFragmentHeight(measurementId, measuredTextFragmentHeights);
    if (measuredHeight !== null) {
      return gap + measuredHeight;
    }

    enqueueTextFragmentMeasurementJob(textFragmentMeasurementJobs, {
      id: measurementId,
      block: createListFragmentBlock(
        {
          ...block,
          blockStyleOverrides: {
            ...block.blockStyleOverrides,
            spaceBefore: 0,
            spaceAfter: 0,
          },
        },
        [
          {
            ...item,
            runtimeMeasurement,
          },
        ],
        0,
        0,
      ),
      sourceBlockId: block.id,
      startOffset: runtimeMeasurement.startOffset,
      endOffset: runtimeMeasurement.endOffset,
    });
  }

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
    runtimeMeasurement,
  );
  const lines = measuredLineBreaks?.length ?? estimateTextLines(
    itemText,
    getListItemTextWidthPx(item, block, contract),
    fontSize,
    {
      fontFamily: getEffectiveListItemFontFamily({
        item,
        block,
        styles,
      }),
    },
  );

  return gap + lines * lineHeight;
}

function getListItemTextWidthPx(
  item: LayoutListItem,
  block: ListLayoutBlock,
  contract: ResolvedStyleContract,
): number {
  const listStyle = resolveListBlockStyle(block, contract);
  const widthPx = Math.max(120, getPaginationContentWidthPx(contract) - listStyle.indent);
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
  measuredTextLineBreaks?: MeasuredTextLineBreaks,
): number {
  const compactChoiceLayout =
    block.metadata.items === items
      ? resolveCompactChoiceLayoutForBlock(block)
      : resolveCompactChoiceListLayoutWithOptions(items, {
          allowSequenceFromAnyLabel: (block.metadata.runtimeSlice?.startIndex ?? 0) > 0,
        });
  if (compactChoiceLayout) {
    const listStyle = resolveListBlockStyle(block, contract);
    const rows = chunkCompactChoiceItems(items, compactChoiceLayout.columns);

    return rows.reduce((totalHeight, row, rowIndex) => {
      const rowHeight = Math.max(
        ...row.map((item) =>
          estimateCompactChoiceListItemContentHeight(
            item,
            block,
            contract,
            compactChoiceLayout.columns,
            styles,
            measuredTextLineBreaks,
          ),
        ),
      );

      return totalHeight + (rowIndex === 0 ? 0 : listStyle.itemGap) + rowHeight;
    }, 0);
  }

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
  const compactChoiceHeight = estimateCompactChoiceListHeight(block, contract, styles);
  if (compactChoiceHeight !== null) {
    return compactChoiceHeight;
  }

  return (
    listStyle.marginTop +
    estimateListItemsHeight(block, block.metadata.items, contract, styles) +
    listStyle.marginBottom
  );
}

function buildCompactChoiceListFragment(payload: {
  block: ListLayoutBlock;
  startItemIndex: number;
  availableHeight: number;
  fragmentIndex: number;
  isCurrentPageEmpty: boolean;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
}): ListFragmentBuildResult | null {
  const { block, startItemIndex, availableHeight, fragmentIndex, isCurrentPageEmpty, contract, styles, measuredTextLineBreaks } = payload;
  const compactChoiceLayout = resolveCompactChoiceLayoutForBlock(block);
  if (!compactChoiceLayout) {
    return null;
  }

  const listStyle = resolveListBlockStyle(block, contract);
  const remainingItems = block.metadata.items.slice(startItemIndex);
  const rows = chunkCompactChoiceItems(remainingItems, compactChoiceLayout.columns);
  const fragmentItems: LayoutListItem[] = [];
  let fragmentHeight = listStyle.marginTop + listStyle.marginBottom;
  let nextItemIndex = startItemIndex;

  for (const row of rows) {
    const rowHeight = Math.max(
      ...row.map((item) =>
        estimateCompactChoiceListItemContentHeight(
          item,
          block,
          contract,
          compactChoiceLayout.columns,
          styles,
          measuredTextLineBreaks,
        ),
      ),
    );
    const candidateHeight = fragmentHeight + (fragmentItems.length === 0 ? 0 : listStyle.itemGap) + rowHeight;
    if (candidateHeight > availableHeight && !(isCurrentPageEmpty && fragmentItems.length === 0)) {
      break;
    }

    fragmentItems.push(...row);
    fragmentHeight = candidateHeight;
    nextItemIndex += row.length;
  }

  if (fragmentItems.length === 0) {
    return null;
  }

  return {
    block: createListFragmentBlock(
      block,
      fragmentItems,
      startItemIndex,
      fragmentIndex,
      block.metadata.items.length,
    ),
    height: fragmentHeight,
    nextItemIndex,
  };
}

// PH2-20-block-split-rendering-adaptation-v1：列表片段构造器，一次性产出含完整 metadata.runtimeSlice 的片段。
// 保留 id 后缀 `-list-fragment-N` 便于 React key 与 debug 追踪；运行时切片位置由 metadata.runtimeSlice 统一表达。
// totalItems 表示原始列表的总项数；当分页进行中 totalItems < 0 表示尚未计算（V1 PoC 不预先回填，由后续子步接入）。
function createListFragmentBlock(
  block: ListLayoutBlock,
  items: LayoutListItem[],
  startItemIndex: number,
  fragmentIndex: number,
  totalItems = -1,
): LayoutBlock {
  const baseStart = block.metadata.start ?? 1;
  // 片段的 items 子集下标范围 = [startItemIndex, startItemIndex + items.length - 1]。
  const endItemIndex = items.length > 0 ? startItemIndex + items.length - 1 : startItemIndex;

  return {
    ...block,
    id: `${block.id}-list-fragment-${fragmentIndex}`,
    sourceRange: null,
    metadata: {
      ...block.metadata,
      // 有序列表跨页后要显式写入起始编号，避免第二页又从 1 开始。
      start: block.metadata.ordered ? baseStart + startItemIndex : block.metadata.start,
      items,
      // PH2-20-block-split-rendering-adaptation-v1：runtimeSlice 由本构造器一次性写入，
      // 主循环不再重复覆盖。endIndex 与 items.length 保持一一对应。
      runtimeSlice: {
        startIndex: startItemIndex,
        endIndex: endItemIndex,
        fragmentIndex,
        totalItems,
        isContinuation: fragmentIndex > 1,
      },
    },
  };
}

function createListItemTextSlice(
  item: LayoutListItem,
  textRuns: TextRun[],
  suffix: string,
  runtimeMeasurement: RuntimeTextMeasurement | null,
  shouldHideMarker = false,
): LayoutListItem {
  return {
    ...item,
    id: `${item.id}-${suffix}`,
    sourceRange: null,
    textRuns,
    runtimeMeasurement,
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
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights;
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[];
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
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
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

  const measuredSplitInfo = protectInlineEquationMeasuredSplitInfo(
    itemText,
    resolveMeasuredTextSplitInfo(
      item.id,
      itemText,
      maxLines,
      measuredTextLineBreaks,
      item.runtimeMeasurement,
    ),
  );
  const splitOffset = measuredSplitInfo
    ? measuredSplitInfo.splitOffset
    : protectInlineEquationSplitOffset(
        itemText,
        adjustSplitOffsetForReadableTrailingText(
          itemText,
          computeTextSplitOffsetForLineCount(
            itemText,
            getListItemTextWidthPx(item, block, contract),
            fontSize,
            maxLines,
            {
              fontFamily: getEffectiveListItemFontFamily({
                item,
                block,
                styles,
              }),
            },
          ),
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

  const baseRuntimeMeasurement = resolveRuntimeTextMeasurement(item);
  const currentRuntimeMeasurement = createRuntimeTextMeasurementSlice(
    baseRuntimeMeasurement,
    0,
    splitOffset,
  );
  const remainingRuntimeMeasurement = createRuntimeTextMeasurementSlice(
    baseRuntimeMeasurement,
    splitOffset,
    itemText.length,
  );
  const currentItem = createListItemTextSlice(
    item,
    currentPageRuns,
    `split-${fragmentIndex}-current`,
    currentRuntimeMeasurement,
  );
  const remainingItem = createListItemTextSlice(
    item,
    remainingRuns,
    `split-${fragmentIndex}-rest`,
    remainingRuntimeMeasurement,
    true,
  );
  const currentHeight = estimateListItemHeight(
    currentItem,
    fragmentItemIndex,
    block,
    contract,
    styles,
    measuredTextLineBreaks,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
  );

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
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights;
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[];
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
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
  } = payload;
  const compactChoiceLayout = resolveCompactChoiceLayoutForBlock(block);
  if (compactChoiceLayout) {
    return buildCompactChoiceListFragment({
      block,
      startItemIndex,
      availableHeight,
      fragmentIndex,
      isCurrentPageEmpty,
      contract,
      styles,
      measuredTextLineBreaks,
    });
  }

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
      measuredTextFragmentHeights,
      textFragmentMeasurementJobs,
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
        measuredTextFragmentHeights,
        textFragmentMeasurementJobs,
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

function buildBlockquoteFragment(payload: {
  block: BlockquoteLayoutBlock;
  availableHeight: number;
  fragmentIndex: number;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  tocItems?: TocItem[];
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights;
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[];
  measuredTableRowHeights?: MeasuredTableRowHeights;
  tableRowMeasurementJobs?: TableRowMeasurementJob[];
}): BlockquoteFragmentBuildResult | null {
  const {
    block,
    availableHeight,
    fragmentIndex,
    contract,
    styles,
    tocItems = [],
    measuredTextLineBreaks,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
    measuredTableRowHeights,
    tableRowMeasurementJobs,
  } = payload;
  const blockquoteMarginTop =
    block.blockStyleOverrides.spaceBefore ?? contract.blockStyles.blockquote.marginTop;
  const blockquoteMarginBottom =
    block.blockStyleOverrides.spaceAfter ?? contract.blockStyles.blockquote.marginBottom;
  const shellHeight =
    blockquoteMarginTop + BLOCKQUOTE_CONTAINER_EXTRA_HEIGHT_PX + blockquoteMarginBottom;
  const fragmentBlocks: LayoutBlock[] = [];
  let fragmentHeight = shellHeight;

  for (let childIndex = 0; childIndex < block.metadata.blocks.length; childIndex += 1) {
    const childBlock = block.metadata.blocks[childIndex];
    const childHeight = estimateBlockHeight(childBlock, contract, tocItems, styles);
    const candidateHeight = fragmentHeight + childHeight;
    if (candidateHeight <= availableHeight) {
      fragmentBlocks.push(childBlock);
      fragmentHeight = candidateHeight;
      continue;
    }

    const remainingChildHeight = Math.max(0, availableHeight - fragmentHeight);
    let partialChild: BlockquoteFragmentBuildResult | null = null;

    if (
      (childBlock.type === 'heading' && childBlock.metadata.kind === 'heading') ||
      (childBlock.type === 'paragraph' && childBlock.metadata.kind === 'paragraph')
    ) {
      partialChild = buildTextBlockFragment({
        block: childBlock,
        availableHeight: remainingChildHeight,
        fragmentIdSuffix: `blockquote-${fragmentIndex}-${childIndex}`,
        contract,
        styles,
        measuredTextLineBreaks,
        measuredTextFragmentHeights,
        textFragmentMeasurementJobs,
      });
    } else if (isListBlock(childBlock) && childBlock.metadata.items.length > 0) {
      const listFragment = buildListFragment({
        block: childBlock,
        startItemIndex: 0,
        availableHeight: remainingChildHeight,
        fragmentIndex,
        isCurrentPageEmpty: fragmentBlocks.length === 0,
        contract,
        styles,
        measuredTextLineBreaks,
        measuredTextFragmentHeights,
        textFragmentMeasurementJobs,
      });
      if (listFragment) {
        const remainingItems = childBlock.metadata.items.slice(listFragment.nextItemIndex);
        if (listFragment.remainingItem) {
          remainingItems[0] = listFragment.remainingItem;
        }
        partialChild = {
          block: listFragment.block,
          height: listFragment.height,
          remainingBlock:
            remainingItems.length > 0
              ? createListFragmentBlock(
                  childBlock,
                  remainingItems,
                  listFragment.nextItemIndex,
                  fragmentIndex,
                )
              : undefined,
        };
      }
    } else if (isTableBlock(childBlock) && childBlock.metadata.rows.length > 0) {
      const rowHeights = childBlock.metadata.rows.map((row, rowIndex) =>
        estimateTableRowHeight(
          childBlock,
          row,
          rowIndex,
          contract,
          styles,
          measuredTextLineBreaks,
          measuredTableRowHeights,
          tableRowMeasurementJobs,
        ),
      );
      const tableFragment = buildTableFragment({
        block: childBlock,
        startRowIndex: 0,
        availableHeight: remainingChildHeight,
        fragmentIndex,
        isCurrentPageEmpty: fragmentBlocks.length === 0,
        rowHeights,
        contract,
        styles,
        measuredTextLineBreaks,
        measuredTableRowHeights,
        tableRowMeasurementJobs,
      });
      if (tableFragment) {
        const remainingRows = childBlock.metadata.rows.slice(tableFragment.nextRowIndex);
        if (tableFragment.remainingRow) {
          remainingRows[0] = tableFragment.remainingRow;
        }
        partialChild = {
          block: tableFragment.block,
          height: tableFragment.height,
          remainingBlock:
            remainingRows.length > 0
              ? {
                  ...childBlock,
                  id: `${childBlock.id}-rest-${fragmentIndex}`,
                  sourceRange: null,
                  metadata: {
                    ...childBlock.metadata,
                    rows: remainingRows,
                  },
                }
              : undefined,
        };
      }
    } else if (isBlockquoteBlock(childBlock) && childBlock.metadata.blocks.length > 0) {
      partialChild = buildBlockquoteFragment({
        block: childBlock,
        availableHeight: remainingChildHeight,
        fragmentIndex,
        contract,
        styles,
        tocItems,
        measuredTextLineBreaks,
        measuredTextFragmentHeights,
        textFragmentMeasurementJobs,
        measuredTableRowHeights,
        tableRowMeasurementJobs,
      });
    }

    if (partialChild && fragmentHeight + partialChild.height <= availableHeight) {
      fragmentBlocks.push(partialChild.block);
      const remainingNestedBlocks = partialChild.remainingBlock
        ? [partialChild.remainingBlock, ...block.metadata.blocks.slice(childIndex + 1)]
        : block.metadata.blocks.slice(childIndex + 1);
      return {
        block: createBlockquoteFragmentBlock(block, fragmentBlocks, `fragment-${fragmentIndex}`),
        height: fragmentHeight + partialChild.height,
        remainingBlock:
          remainingNestedBlocks.length > 0
            ? createBlockquoteFragmentBlock(block, remainingNestedBlocks, `rest-${fragmentIndex}`)
            : undefined,
      };
    }

    break;
  }

  if (fragmentBlocks.length === 0) {
    return null;
  }

  const remainingNestedBlocks = block.metadata.blocks.slice(fragmentBlocks.length);
  return {
    block: createBlockquoteFragmentBlock(
      block,
      fragmentBlocks,
      `fragment-${fragmentIndex}`,
      { preserveOriginalIdentity: remainingNestedBlocks.length === 0 },
    ),
    height: fragmentHeight,
    remainingBlock:
      remainingNestedBlocks.length > 0
        ? createBlockquoteFragmentBlock(block, remainingNestedBlocks, `rest-${fragmentIndex}`)
        : undefined,
  };
}

function buildColumnSectionFragment(payload: {
  block: ColumnSectionLayoutBlock;
  availableHeight: number;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
}): BlockquoteFragmentBuildResult | null {
  const { block, availableHeight, contract, styles } = payload;
  if (availableHeight <= 0) {
    return null;
  }

  // 局部分栏复用同一套分页算法：先按“当前剩余高度”取第一页片段，
  // 再把后续页的块扁平化回 remainingBlock，交给外层 while 循环继续排下一栏/下一页。
  const localContract = resolveColumnSectionContract(contract, block.metadata);
  const fragmentContentHeightPx = Math.max(1, availableHeight);
  const fragmentContract: ResolvedStyleContract = {
    ...localContract,
    contentHeightPx: fragmentContentHeightPx,
    contentHeightMm: Math.round((fragmentContentHeightPx / MM_TO_PX) * 100) / 100,
    columnPageCapacityPx: fragmentContentHeightPx * localContract.columnCount,
  };

  const localPages = paginateMaxFillBlocks({
    blocks: block.metadata.blocks,
    contract: fragmentContract,
    styles,
  }).filter((page) => page.blocks.length > 0);
  const firstPage = localPages[0];
  if (!firstPage) {
    return null;
  }

  const sectionTocItems = buildTocItemsFromBlocks(block.metadata.blocks);
  const currentRuntimeSlice = {
    sourceNodeId: block.metadata.runtimeSlice?.sourceNodeId ?? block.id,
    fragmentIndex: block.metadata.runtimeSlice?.fragmentIndex ?? 1,
    isContinuation: block.metadata.runtimeSlice?.isContinuation ?? false,
  };
  const remainingBlocks = localPages.slice(1).flatMap((page) => page.blocks);

  return {
    block: createColumnSectionFragmentBlock(
      block,
      firstPage.blocks,
      `fragment-${currentRuntimeSlice.fragmentIndex}`,
      {
        preserveOriginalIdentity: remainingBlocks.length === 0,
        runtimeSlice: currentRuntimeSlice,
      },
    ),
    height:
      (block.blockStyleOverrides.spaceBefore ?? 0) +
      estimatePaginatedPageHeight(firstPage.blocks, localContract, styles, sectionTocItems) +
      (block.blockStyleOverrides.spaceAfter ?? 0),
    remainingBlock: remainingBlocks.length > 0
      ? createColumnSectionFragmentBlock(
          block,
          remainingBlocks,
          `rest-${currentRuntimeSlice.fragmentIndex}`,
          {
            runtimeSlice: {
              sourceNodeId: currentRuntimeSlice.sourceNodeId,
              fragmentIndex: currentRuntimeSlice.fragmentIndex + 1,
              isContinuation: true,
            },
          },
        )
      : undefined,
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
  const contentWidthPx = getPaginationContentWidthPx(contract);
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

function createSingleRowMeasurementTableBlock(
  block: TableLayoutBlock,
  row: LayoutTableRow,
): TableLayoutBlock {
  return {
    ...block,
    id: `${block.id}-measure-${row.id}`,
    sourceRange: null,
    blockStyleOverrides: {
      ...block.blockStyleOverrides,
      spaceBefore: 0,
      spaceAfter: 0,
    },
    metadata: {
      ...block.metadata,
      rows: [row],
    },
  };
}

function estimateTableRowHeight(
  block: TableLayoutBlock,
  row: LayoutTableRow,
  rowIndex: number,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
  measuredTextLineBreaks?: MeasuredTextLineBreaks,
  measuredTableRowHeights?: MeasuredTableRowHeights,
  tableRowMeasurementJobs?: TableRowMeasurementJob[],
): number {
  const measuredRowHeight = resolveMeasuredTableRowHeightForRow(row, measuredTableRowHeights);
  if (measuredRowHeight !== null) {
    return measuredRowHeight;
  }

  if (row.runtimeMeasurement) {
    enqueueTableRowMeasurementJob(tableRowMeasurementJobs, {
      id: createTableRowMeasurementId({
        blockId: row.runtimeMeasurement.sourceRowId,
        rowIds: [row.id],
        widthPx: getBlockMeasurementWidthPx(block, contract),
      }),
      block: createSingleRowMeasurementTableBlock(block, row),
      sourceBlockId: block.id,
      rowIds: [row.id],
    });
  }

  const estimatedRowHeight = row.cells.reduce((maxHeight, cell) => {
    if (isCoveredTableCell(cell)) {
      return maxHeight;
    }

    const cellIndex = row.cells.indexOf(cell);
    const cellWidthPx = getTableCellTextWidthPx(block, row, cellIndex, contract);
    const fontSize = getTableCellEffectiveFontSize(cell, block, styles, contract);
    const cellText = cell.textRuns.map((run) => run.text).join('');
    const measuredLineBreaks = resolveMeasuredLineBreakOffsets(
      cell.id,
      cellText,
      measuredTextLineBreaks,
      cell.runtimeMeasurement,
    );
    const lines = measuredLineBreaks?.length ?? estimateTextLines(
      cellText,
      cellWidthPx,
      fontSize,
      {
        fontFamily: getEffectiveTableCellFontFamily({
          cell,
          block,
          styles,
        }),
      },
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
  runtimeMeasurement: RuntimeTextMeasurement | null,
): LayoutTableCell {
  return {
    ...cell,
    id: `${cell.id}-${suffix}`,
    sourceRange: null,
    textRuns,
    runtimeMeasurement,
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
  measuredTableRowHeights?: MeasuredTableRowHeights;
  tableRowMeasurementJobs?: TableRowMeasurementJob[];
}): TableRowSplitResult | null {
  const {
    block,
    row,
    rowIndex,
    availableHeight,
    fragmentIndex,
    contract,
    styles,
    measuredTextLineBreaks,
    measuredTableRowHeights,
    tableRowMeasurementJobs,
  } = payload;
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
    const measuredSplitInfo = protectInlineEquationMeasuredSplitInfo(
      cellText,
      resolveMeasuredTextSplitInfo(
        cell.id,
        cellText,
        maxLines,
        measuredTextLineBreaks,
        cell.runtimeMeasurement,
      ),
    );
    const splitOffset = measuredSplitInfo
      ? measuredSplitInfo.splitOffset
      : protectInlineEquationSplitOffset(
          cellText,
          adjustSplitOffsetForReadableTrailingText(
            cellText,
            computeTextSplitOffsetForLineCount(
              cellText,
              getTableCellTextWidthPx(block, row, cellIndex, contract),
              getTableCellEffectiveFontSize(cell, block, styles, contract),
              maxLines,
              {
                fontFamily: getEffectiveTableCellFontFamily({
                  cell,
                  block,
                  styles,
                }),
              },
            ),
          ),
        );
    const { currentPageRuns, remainingRuns } = splitTextRunsByPlainTextLength(cell.textRuns, splitOffset);

    if (currentPageRuns.length > 0) {
      hasCurrentText = true;
    }
    if (remainingRuns.length > 0) {
      hasRemainingText = true;
    }

    const baseRuntimeMeasurement = resolveRuntimeTextMeasurement(cell);
    currentCells.push(
      createTableCellTextSlice(
        cell,
        currentPageRuns,
        `split-${fragmentIndex}-current`,
        createRuntimeTextMeasurementSlice(baseRuntimeMeasurement, 0, splitOffset),
      ),
    );
    remainingCells.push(
      createTableCellTextSlice(
        cell,
        remainingRuns,
        `split-${fragmentIndex}-rest`,
        createRuntimeTextMeasurementSlice(baseRuntimeMeasurement, splitOffset, cellText.length),
      ),
    );
  });

  if (!hasCurrentText || !hasRemainingText) {
    return null;
  }

  const currentRow: LayoutTableRow = {
    ...row,
    id: `${row.id}-split-${fragmentIndex}-current`,
    sourceRange: null,
    runtimeMeasurement: resolveRuntimeRowMeasurement(row),
    heightPx: null,
    cells: currentCells,
  };
  const remainingRow: LayoutTableRow = {
    ...row,
    id: `${row.id}-split-${fragmentIndex}-rest`,
    sourceRange: null,
    runtimeMeasurement: resolveRuntimeRowMeasurement(row),
    heightPx: null,
    cells: remainingCells,
  };

  return {
    currentRow,
    remainingRow,
    currentHeight: estimateTableRowHeight(
      block,
      currentRow,
      rowIndex,
      contract,
      styles,
      measuredTextLineBreaks,
      measuredTableRowHeights,
      tableRowMeasurementJobs,
    ),
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
  measuredTextLineBreaks?: MeasuredTextLineBreaks,
  measuredTableRowHeights?: MeasuredTableRowHeights,
  tableRowMeasurementJobs?: TableRowMeasurementJob[],
): number {
  const marginTop = getTableMarginTop(block, contract);
  const marginBottom = getTableMarginBottom(block, contract);

  const rowsHeight = block.metadata.rows.reduce((total, row, rowIndex) => {
    return total + estimateTableRowHeight(
      block,
      row,
      rowIndex,
      contract,
      styles,
      measuredTextLineBreaks,
      measuredTableRowHeights,
      tableRowMeasurementJobs,
    );
  }, 0);

  return marginTop + rowsHeight + marginBottom;
}

function createRuntimeTableRow(fragmentRow: TableFragmentRow, fragmentIndex: number): LayoutTableRow {
  const runtimeRowSuffix = fragmentRow.isRepeatedHeader
    ? `fragment-${fragmentIndex}-repeat-header`
    : `fragment-${fragmentIndex}`;
  const runtimeMeasurement = resolveRuntimeRowMeasurement(fragmentRow.row);

  return {
    ...fragmentRow.row,
    id: `${fragmentRow.row.id}-${runtimeRowSuffix}`,
    sourceRange: fragmentRow.isRepeatedHeader ? null : fragmentRow.row.sourceRange,
    runtimeMeasurement,
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
  runtimeSlice?: NonNullable<TableBlockMetadata['runtimeSlice']>,
): LayoutBlock {
  return {
    ...block,
    id: `${block.id}-page-fragment-${fragmentIndex}`,
    sourceRange: null,
    metadata: {
      ...block.metadata,
      rows: fragmentRows.map((fragmentRow) => createRuntimeTableRow(fragmentRow, fragmentIndex)),
      // 运行时表格片段只存在于分页结果，用来表达切片在原表格中的位置；不会写回 .layout。
      ...(runtimeSlice ? { runtimeSlice } : {}),
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
  measuredTableRowHeights?: MeasuredTableRowHeights;
  tableRowMeasurementJobs?: TableRowMeasurementJob[];
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
    measuredTableRowHeights,
    tableRowMeasurementJobs,
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
    fragmentHeight +=
      rowHeights[0] ??
      estimateTableRowHeight(
        block,
        repeatedHeaderRow,
        0,
        contract,
        styles,
        measuredTextLineBreaks,
        measuredTableRowHeights,
        tableRowMeasurementJobs,
      );
  }

  while (nextRowIndex < rows.length) {
    const rowHeight =
      rowHeights[nextRowIndex] ??
      estimateTableRowHeight(
        block,
        rows[nextRowIndex],
        nextRowIndex,
        contract,
        styles,
        measuredTextLineBreaks,
        measuredTableRowHeights,
        tableRowMeasurementJobs,
      );
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
        measuredTableRowHeights,
        tableRowMeasurementJobs,
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
      rowHeights[nextRowIndex] ??
      estimateTableRowHeight(
        block,
        nextBodyRow,
        nextRowIndex,
        contract,
        styles,
        measuredTextLineBreaks,
        measuredTableRowHeights,
        tableRowMeasurementJobs,
      );
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
 * PH2-20 多栏块切分通用机制 V1：表格统一切分入口（PoC）。
 * 这是 `buildTableFragment` 的统一接口封装，目的是：
 *   1) 让其他块类型在未来可以按同一签名接入；
 *   2) 把“调用方补偿（如 boost）”与“切分逻辑”解耦；
 *   3) 在多栏下，调用方通过 BlockSplitContext 把当前栏可用高度和当前栏是否为空告知切分器。
 *
 * 注意：本函数不会修改 columnFlowState；切分器内部不能假设已完成整块能否放入当前栏的判断，
 * 那一段由 placeBlockInColumns 三段式调度在调用本函数前完成。
 */
function trySplitTableToFitHeight(payload: TrySplitTableToFitHeightPayload): TableFragmentBuildResult | null {
  // availableHeight 已由调用方按当前栏剩余高度 + 可能的 boost 计算好，直接转发。
  // 这里不重复 boost，避免后续多块接入时出现重复补偿。
  return buildTableFragment({
    block: payload.block,
    startRowIndex: payload.startRowIndex,
    availableHeight: payload.context.availableHeight,
    fragmentIndex: payload.context.fragmentIndex,
    isCurrentPageEmpty: payload.context.isCurrentColumnEmpty,
    rowHeights: payload.rowHeights,
    contract: payload.contract,
    styles: payload.styles,
    measuredTextLineBreaks: payload.measuredTextLineBreaks,
    measuredTableRowHeights: payload.measuredTableRowHeights,
    tableRowMeasurementJobs: payload.tableRowMeasurementJobs,
  });
}

// PH2-20 多栏块切分通用机制 V1：列表切分统一入口（PoC）。
interface TrySplitListToFitHeightPayload {
  block: ListLayoutBlock;
  startItemIndex: number;
  context: BlockSplitContext;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights;
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[];
}

function trySplitListToFitHeight(payload: TrySplitListToFitHeightPayload): ListFragmentBuildResult | null {
  return buildListFragment({
    block: payload.block,
    startItemIndex: payload.startItemIndex,
    availableHeight: payload.context.availableHeight,
    fragmentIndex: payload.context.fragmentIndex,
    isCurrentPageEmpty: payload.context.isCurrentColumnEmpty,
    contract: payload.contract,
    styles: payload.styles,
    measuredTextLineBreaks: payload.measuredTextLineBreaks,
    measuredTextFragmentHeights: payload.measuredTextFragmentHeights,
    textFragmentMeasurementJobs: payload.textFragmentMeasurementJobs,
  });
}

// PH2-20 多栏块切分通用机制 V1：TOC 切分统一入口。
interface TrySplitTocToFitHeightPayload {
  block: LayoutBlock;
  allTocItems: TocItem[];
  startItemIndex: number;
  context: BlockSplitContext;
  contract: ResolvedStyleContract;
}

function trySplitTocToFitHeight(payload: TrySplitTocToFitHeightPayload): TocFragmentBuildResult | null {
  return buildTocFragment({
    block: payload.block,
    allTocItems: payload.allTocItems,
    startItemIndex: payload.startItemIndex,
    availableHeight: payload.context.availableHeight,
    fragmentIndex: payload.context.fragmentIndex,
    isCurrentPageEmpty: payload.context.isCurrentColumnEmpty,
    contract: payload.contract,
  });
}

// PH2-20 多栏块切分通用机制 V1：引用容器切分统一入口。
interface TrySplitBlockquoteToFitHeightPayload {
  block: BlockquoteLayoutBlock;
  context: BlockSplitContext;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  tocItems?: TocItem[];
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights;
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[];
  measuredTableRowHeights?: MeasuredTableRowHeights;
  tableRowMeasurementJobs?: TableRowMeasurementJob[];
}

function trySplitBlockquoteToFitHeight(
  payload: TrySplitBlockquoteToFitHeightPayload,
): BlockquoteFragmentBuildResult | null {
  return buildBlockquoteFragment({
    block: payload.block,
    availableHeight: payload.context.availableHeight,
    fragmentIndex: payload.context.fragmentIndex,
    contract: payload.contract,
    styles: payload.styles,
    tocItems: payload.tocItems,
    measuredTextLineBreaks: payload.measuredTextLineBreaks,
    measuredTextFragmentHeights: payload.measuredTextFragmentHeights,
    textFragmentMeasurementJobs: payload.textFragmentMeasurementJobs,
    measuredTableRowHeights: payload.measuredTableRowHeights,
    tableRowMeasurementJobs: payload.tableRowMeasurementJobs,
  });
}

interface TrySplitColumnSectionToFitHeightPayload {
  block: ColumnSectionLayoutBlock;
  context: BlockSplitContext;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
}

function trySplitColumnSectionToFitHeight(
  payload: TrySplitColumnSectionToFitHeightPayload,
): BlockquoteFragmentBuildResult | null {
  return buildColumnSectionFragment({
    block: payload.block,
    availableHeight: payload.context.availableHeight,
    contract: payload.contract,
    styles: payload.styles,
  });
}

// PH2-20 多栏块切分通用机制 V1：代码块切分统一入口。
interface TrySplitCodeToFitHeightPayload {
  block: LayoutBlock;
  context: BlockSplitContext;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights;
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[];
}

function trySplitCodeToFitHeight(payload: TrySplitCodeToFitHeightPayload): BlockquoteFragmentBuildResult | null {
  return buildCodeBlockFragment({
    block: payload.block,
    availableHeight: payload.context.availableHeight,
    fragmentIdSuffix: `code-${payload.context.fragmentIndex}`,
    contract: payload.contract,
    styles: payload.styles,
    measuredTextLineBreaks: payload.measuredTextLineBreaks,
    measuredTextFragmentHeights: payload.measuredTextFragmentHeights,
    textFragmentMeasurementJobs: payload.textFragmentMeasurementJobs,
  });
}

// PH2-20 多栏块切分通用机制 V1：文本块切分统一入口。
// 文本块没有独立的 build*Fragment，因此 trySplitTextToFitHeight 把 computeOptimalTextSplit 与
// fragmentBlock / remainingTextRuns 拼装放在内部，保持外层 while 循环只与统一形状交互。
interface TrySplitTextToFitHeightPayload {
  block: LayoutBlock;
  context: BlockSplitContext;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
}

interface TextFragmentBuildResult {
  block: LayoutBlock;
  height: number;
  remainingBlock?: LayoutBlock;
  remainingTextRuns?: TextRun[];
}

function trySplitTextToFitHeight(payload: TrySplitTextToFitHeightPayload): TextFragmentBuildResult | null {
  const splitInfo = computeOptimalTextSplit(
    payload.block,
    payload.context.availableHeight,
    payload.contract,
    payload.styles,
    payload.measuredTextLineBreaks,
  );
  if (!splitInfo) {
    return null;
  }
  const fragmentIdSuffix = `page-fragment-${payload.context.fragmentIndex}`;
  const fragmentResult = buildTextBlockFragment({
    block: payload.block,
    availableHeight: payload.context.availableHeight,
    fragmentIdSuffix,
    contract: payload.contract,
    styles: payload.styles,
    measuredTextLineBreaks: payload.measuredTextLineBreaks,
  });
  if (!fragmentResult) {
    return null;
  }
  return {
    block: fragmentResult.block,
    height: splitInfo.height,
    remainingBlock: fragmentResult.remainingBlock,
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
  runtimeMeasurement?: RuntimeTextMeasurement | null,
): number[] | null {
  const directOffsets = measuredTextLineBreaks?.[nodeId];
  const normalizeOffsets = (rawOffsets: number[]) => rawOffsets
    .map((offset) => Math.round(offset))
    .filter((offset, index, offsets) =>
      Number.isFinite(offset) &&
      offset > 0 &&
      offset <= text.length &&
      (index === 0 || offset > offsets[index - 1]),
    );

  if (directOffsets && directOffsets.length > 0) {
    const normalizedDirectOffsets = normalizeOffsets(directOffsets);
    if (
      normalizedDirectOffsets.length > 0 &&
      normalizedDirectOffsets[normalizedDirectOffsets.length - 1] === text.length
    ) {
      return normalizedDirectOffsets;
    }
  }

  const measurementSourceId = runtimeMeasurement?.sourceNodeId ?? nodeId;
  const rawOffsets = measuredTextLineBreaks?.[measurementSourceId];
  if (!rawOffsets || rawOffsets.length === 0) {
    return null;
  }

  const sliceStartOffset = runtimeMeasurement?.startOffset ?? 0;
  const sliceEndOffset = runtimeMeasurement?.endOffset ?? text.length;
  const isRuntimeSlice =
    runtimeMeasurement !== undefined &&
    runtimeMeasurement !== null &&
    (sliceStartOffset > 0 || sliceEndOffset < Math.max(sliceStartOffset, rawOffsets[rawOffsets.length - 1] ?? sliceEndOffset));

  const normalizedOffsets = normalizeOffsets(
    isRuntimeSlice
      ? rawOffsets
          .filter((offset) => offset > sliceStartOffset && offset < sliceEndOffset)
          .map((offset) => offset - sliceStartOffset)
          .concat(text.length > 0 ? [text.length] : [])
      : rawOffsets,
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
  runtimeMeasurement?: RuntimeTextMeasurement | null,
): MeasuredTextSplitInfo | null {
  if (maxLines <= 0 || text.length === 0) {
    return null;
  }

  const measuredLineBreaks = resolveMeasuredLineBreakOffsets(
    nodeId,
    text,
    measuredTextLineBreaks,
    runtimeMeasurement,
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

function resolveMeasuredTextFragmentHeightForBlock(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  measuredTextFragmentHeights: MeasuredTextFragmentHeights | undefined,
): number | null {
  if (
    (block.type !== 'heading' || block.metadata.kind !== 'heading') &&
    (block.type !== 'paragraph' || block.metadata.kind !== 'paragraph') &&
    (block.type !== 'code' || block.metadata.kind !== 'code')
  ) {
    return null;
  }

  const runtimeMeasurement = block.runtimeMeasurement;
  if (!runtimeMeasurement) {
    return null;
  }

  const fragmentId = createTextFragmentMeasurementId({
    blockId: runtimeMeasurement.sourceNodeId,
    startOffset: runtimeMeasurement.startOffset,
    endOffset: runtimeMeasurement.endOffset,
    widthPx: getBlockMeasurementWidthPx(block, contract),
  });

  return getMeasuredTextFragmentHeight(fragmentId, measuredTextFragmentHeights);
}

function getMeasuredBlockHeightForPagination(payload: {
  block: LayoutBlock;
  contract: ResolvedStyleContract;
  measuredBlockHeights: Record<string, number> | undefined;
  measuredTextFragmentHeights: MeasuredTextFragmentHeights | undefined;
  textFragmentMeasurementJobs: TextFragmentMeasurementJob[] | undefined;
}): number | null {
  const {
    block,
    contract,
    measuredBlockHeights,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
  } = payload;
  const measuredTopLevelHeight = getMeasuredTopLevelBlockHeight(block, measuredBlockHeights);
  if (measuredTopLevelHeight !== null) {
    return measuredTopLevelHeight;
  }

  const measuredFragmentHeight = resolveMeasuredTextFragmentHeightForBlock(
    block,
    contract,
    measuredTextFragmentHeights,
  );
  if (measuredFragmentHeight !== null) {
    return measuredFragmentHeight;
  }

  if (
    block.runtimeMeasurement &&
    ((block.type === 'heading' && block.metadata.kind === 'heading') ||
      (block.type === 'paragraph' && block.metadata.kind === 'paragraph') ||
      (block.type === 'code' && block.metadata.kind === 'code'))
  ) {
    enqueueTextFragmentMeasurementJob(textFragmentMeasurementJobs, {
      id: createTextFragmentMeasurementId({
        blockId: block.runtimeMeasurement.sourceNodeId,
        startOffset: block.runtimeMeasurement.startOffset,
        endOffset: block.runtimeMeasurement.endOffset,
        widthPx: getBlockMeasurementWidthPx(block, contract),
      }),
      block,
      sourceBlockId: block.runtimeMeasurement.sourceNodeId,
      startOffset: block.runtimeMeasurement.startOffset,
      endOffset: block.runtimeMeasurement.endOffset,
    });
  }

  return null;
}

function resolveMeasuredTableRowHeightForRow(
  row: LayoutTableRow,
  measuredTableRowHeights: MeasuredTableRowHeights | undefined,
): number | null {
  const directHeight = getMeasuredTableRowHeight(row.id, measuredTableRowHeights);
  if (directHeight !== null) {
    return directHeight;
  }

  const sourceRowId = row.runtimeMeasurement?.sourceRowId;
  if (!sourceRowId) {
    return null;
  }

  return getMeasuredTableRowHeight(sourceRowId, measuredTableRowHeights);
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
    case 'columnSection':
      return {
        marginTop: block.blockStyleOverrides.spaceBefore ?? 0,
        marginBottom: block.blockStyleOverrides.spaceAfter ?? 0,
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

  const tolerancePx = Math.min(
    getMeasurementTolerancePx(block, contract, styles),
    MEASURED_HEIGHT_ESTIMATE_TOLERANCE_PX,
  );
  // 隐藏测量层按“单块包裹”测量，正文页按自然流排版；只允许几像素级测量抖动继续使用估算值。
  // 如果放宽到一整行，算法1会在页底把真实更高的内容塞进页边距或页脚区域。
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
  const contentWidthPx = getPaginationContentWidthPx(contract);

  switch (block.type) {
    case 'columnBreak':
    case 'pageBreak':
      return 0;
    case 'toc':
      return estimateTocBlockHeight(block, tocItems, contract);
    case 'heading': {
      const depth = block.metadata.kind === 'heading' ? block.metadata.depth : 3;
      const baseStyle =
        depth === 1
          ? contract.blockStyles.heading1
          : depth === 2
            ? contract.blockStyles.heading2
            : contract.blockStyles.heading3;
      const lineWidths = resolveTextBlockLineWidths(
        contentWidthPx,
        block,
        baseStyle,
        resolveHeadingMarkerInset(contract, depth),
      );
      return estimateTextBlockHeight(
        getLayoutBlockPlainText(block),
        lineWidths.followingLineWidthPx,
        resolveTextBlockStyle(block, baseStyle, styles),
        lineWidths.firstLineWidthPx,
        resolveHeadingDecorationHeight(contract, depth),
        getEffectiveTextRunsFontFamily({
          textRuns: block.textRuns,
          block,
          styles,
        }),
      );
    }
    case 'paragraph': {
      const lineWidths = resolveTextBlockLineWidths(contentWidthPx, block, contract.blockStyles.paragraph);
      return estimateTextBlockHeight(
        getLayoutBlockPlainText(block),
        lineWidths.followingLineWidthPx,
        resolveTextBlockStyle(block, contract.blockStyles.paragraph, styles),
        lineWidths.firstLineWidthPx,
        0,
        getEffectiveTextRunsFontFamily({
          textRuns: block.textRuns,
          block,
          styles,
        }),
      );
    }
    case 'list': {
      return isListBlock(block) ? estimateListBlockHeight(block, contract, styles) : 0;
    }
    case 'blockquote':
      return (
        contract.blockStyles.blockquote.marginTop +
        BLOCKQUOTE_CONTAINER_EXTRA_HEIGHT_PX +
        (block.metadata.kind === 'blockquote'
          ? block.metadata.blocks.reduce(
              (total, nestedBlock) =>
                total + estimateBlockHeight(nestedBlock, contract, tocItems, styles),
              0,
            )
          : 0) +
        contract.blockStyles.blockquote.marginBottom
      );
    case 'columnSection':
      if (!isColumnSectionBlock(block)) {
        return 0;
      }

      {
        const sectionContract = resolveColumnSectionContract(contract, block.metadata);
        const sectionTocItems = buildTocItemsFromBlocks(block.metadata.blocks);
        const sectionPages = paginateMaxFillBlocks({
          blocks: block.metadata.blocks,
          contract: sectionContract,
          styles,
        });
        const contentHeight = sectionPages.reduce(
          (total, page) => total + estimatePaginatedPageHeight(page.blocks, sectionContract, styles, sectionTocItems),
          0,
        );
        return (
          (block.blockStyleOverrides.spaceBefore ?? 0) +
          contentHeight +
          (block.blockStyleOverrides.spaceAfter ?? 0)
        );
      }
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
          fontFamily: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',
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
  const contentWidthPx = getPaginationContentWidthPx(contract);

  let style: TextBlockStyleRule;
  let baseStyle: TextBlockStyleRule;
  let plainText: string;
  let headingDecorationHeight = 0;
  let headingMarkerInset = 0;

  if (block.type === 'heading') {
    const depth = block.metadata.kind === 'heading' ? block.metadata.depth : 3;
    baseStyle =
      depth === 1
        ? contract.blockStyles.heading1
        : depth === 2
          ? contract.blockStyles.heading2
          : contract.blockStyles.heading3;
    headingDecorationHeight = resolveHeadingDecorationHeight(contract, depth);
    headingMarkerInset = resolveHeadingMarkerInset(contract, depth);
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

  const textFontFamily = getEffectiveTextRunsFontFamily({
    textRuns: block.textRuns,
    block,
    styles,
  });
  const lineWidths = resolveTextBlockLineWidths(contentWidthPx, block, baseStyle, headingMarkerInset);

  const lineHeight = style.lineHeight;
  // 完整块放入当前页时继续保留整段段后距；
  // 真正跨页时，当前页片段不应重复吃掉整段段后距，否则页尾会被留白提前“吞掉”。
  const usableHeightWithTrailingSpace =
    availableHeight - style.marginTop - style.marginBottom - headingDecorationHeight;
  const usableHeightWithoutTrailingSpace =
    availableHeight - style.marginTop - headingDecorationHeight;
  if (usableHeightWithoutTrailingSpace <= 0 || lineHeight <= 0) {
    return null;
  }

  const maxLinesWithTrailingSpace = Math.max(0, Math.floor(usableHeightWithTrailingSpace / lineHeight));
  const maxLinesWithoutTrailingSpace = Math.floor(usableHeightWithoutTrailingSpace / lineHeight);
  if (maxLinesWithoutTrailingSpace <= 0) {
    return null;
  }

  const measuredSplitInfo = protectInlineEquationMeasuredSplitInfo(
    plainText,
    resolveMeasuredTextSplitInfo(
      block.id,
      plainText,
      maxLinesWithoutTrailingSpace,
      measuredTextLineBreaks,
      block.runtimeMeasurement,
    ),
  );

  if (measuredSplitInfo) {
    if (measuredSplitInfo.totalLineCount <= maxLinesWithTrailingSpace) {
      return {
        currentPageText: plainText,
        remainingText: '',
        height: style.marginTop + measuredSplitInfo.totalLineCount * lineHeight + headingDecorationHeight + style.marginBottom,
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
      height: style.marginTop + measuredSplitInfo.usedLineCount * lineHeight + headingDecorationHeight,
      omitTrailingSpaceAfter: true,
    };
  }

  // 使用 estimateTextLines 计算总行数（保持与分页一致）
  const totalLines = estimateTextLines(
    plainText,
    lineWidths.followingLineWidthPx,
    style.fontSize,
    {
      firstLineWidthPx: lineWidths.firstLineWidthPx,
      fontFamily: textFontFamily,
    },
  );

  if (totalLines <= maxLinesWithTrailingSpace) {
    // 全部内容可以放下
    return {
      currentPageText: plainText,
      remainingText: '',
      height: style.marginTop + totalLines * lineHeight + headingDecorationHeight + style.marginBottom,
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
      {
        firstLineWidthPx: lineFirstWidthPx,
        fontFamily: textFontFamily,
      },
    );

    // 确保行数是有效的正数
    const validLineBreaks = Math.max(1, currentLineBreaks);

    // 检查加入这一行后是否会超出
    if (accumulatedLines + validLineBreaks > maxLinesWithoutTrailingSpace) {
      const remainingLineCount = maxLinesWithoutTrailingSpace - accumulatedLines;
      const splitOffsetInLine = computeTextSplitOffsetForLineCount(
        lineText,
        lineFirstWidthPx,
        style.fontSize,
        remainingLineCount,
        {
          fontFamily: textFontFamily,
        },
      );
      const shouldSplitInsideCurrentLine = splitOffsetInLine > 0;
      const splitOffset = shouldSplitInsideCurrentLine
        ? protectInlineEquationSplitOffset(
            plainText,
            adjustSplitOffsetForReadableTrailingText(
              plainText,
              lineStartOffset + splitOffsetInLine,
            ),
          )
        : lastSafeSplitOffset;
      const currentPageText = plainText.slice(0, splitOffset);
      const remainingText = plainText.slice(splitOffset);
      const usedLineCount = shouldSplitInsideCurrentLine
        ? estimateTextLines(
            currentPageText,
            lineWidths.followingLineWidthPx,
            style.fontSize,
            {
              firstLineWidthPx: lineWidths.firstLineWidthPx,
              fontFamily: textFontFamily,
            },
          )
        : lastSafeLineCount;

      // 如果当前页文本为空，返回 null 让整个块翻页
      if (currentPageText.trim().length === 0) {
        return null;
      }

      return {
        currentPageText,
        remainingText,
        height: style.marginTop + usedLineCount * lineHeight + headingDecorationHeight,
        omitTrailingSpaceAfter: true,
      };
    }

    // 这一行可以放入，更新累计行数和最后安全分割点
    accumulatedLines += validLineBreaks;
    lastSafeSplitOffset = splitOffsetAfterLine;
    lastSafeLineCount = accumulatedLines;
    lineStartOffset = splitOffsetAfterLine;
  }

  // 能放下所有正文行但需要借用段后距时，当前页片段继续去掉段后距，
  // 避免它再次把页尾最后一行挤到下一页。
  return {
    currentPageText: plainText,
    remainingText: '',
    height: style.marginTop + totalLines * lineHeight + headingDecorationHeight,
    omitTrailingSpaceAfter: true,
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
    case 'columnSection':
      return '局部分栏区段';
    case 'code':
      return `代码块${block.metadata.kind === 'code' && block.metadata.language ? `（${block.metadata.language}）` : ''}`;
    case 'table':
      return `表格（${block.metadata.kind === 'table' ? block.metadata.rows.length : 0} 行）`;
    case 'image':
      return `图片${block.metadata.kind === 'image' && block.metadata.alt ? `"${block.metadata.alt}"` : ''}`;
    case 'horizontalRule':
      return '分隔线';
    case 'columnBreak':
      return '分栏断点';
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

function estimatePaginatedPageHeight(
  blocks: LayoutBlock[],
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet,
  tocItems: TocItem[] = [],
): number {
  let currentHeight = 0;
  const placedBlocks: PlacedBlockEntry[] = [];

  for (const block of blocks) {
    currentHeight = appendPlacedBlock(
      placedBlocks,
      currentHeight,
      block,
      estimateBlockHeight(block, contract, tocItems, styles),
      contract,
      styles,
    );
  }

  return currentHeight;
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

function getFragmentAvailableHeightForBlock(payload: {
  isMultiColumn: boolean;
  columnFlowState: ColumnFlowState;
  placedBlocks: PlacedBlockEntry[];
  currentHeight: number;
  pageCapacity: number;
  block: LayoutBlock;
  blockHeight: number;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
}): number {
  const {
    isMultiColumn,
    columnFlowState,
    placedBlocks,
    currentHeight,
    pageCapacity,
    block,
    blockHeight,
    contract,
    styles,
  } = payload;

  if (isMultiColumn) {
    return getColumnAvailableHeightForBlock(columnFlowState, block, blockHeight, contract);
  }

  // 列表、表格、目录会在同一个 while 中多次换页继续拆分。
  // 每次换页后都必须重新按当前页剩余空间计算，否则会把第一页页尾的小剩余高度带到后续页面。
  return getAvailableHeightForBlock(placedBlocks, currentHeight, pageCapacity, block, contract, styles);
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
    if (blocks[index].type !== 'pageBreak' && blocks[index].type !== 'columnBreak') {
      return true;
    }
  }
  return false;
}

function findNextContentBlock(
  blocks: LayoutBlock[],
  startIndex: number,
): LayoutBlock | null {
  for (let index = startIndex; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type !== 'pageBreak' && block.type !== 'columnBreak') {
      return block;
    }
  }

  return null;
}

function resolveSameColumnRemainingHeightAfterPlacement(
  state: ColumnFlowState,
  placement: ColumnPlacementCandidate,
): number {
  if (placement.isSpanAll) {
    return 0;
  }

  return Math.max(
    0,
    state.pageHeight - state.completedOffset - state.columnHeights[placement.columnIndex],
  );
}

function canStartTableInAvailableColumnHeight(payload: {
  tableBlock: TableLayoutBlock;
  availableHeight: number;
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
  measuredTableRowHeights?: MeasuredTableRowHeights;
  tableRowMeasurementJobs?: TableRowMeasurementJob[];
}): boolean {
  const {
    tableBlock,
    availableHeight,
    contract,
    styles,
    measuredTextLineBreaks,
    measuredTableRowHeights,
    tableRowMeasurementJobs,
  } = payload;
  if (availableHeight <= 0 || tableBlock.metadata.rows.length === 0) {
    return false;
  }

  const rowHeights = tableBlock.metadata.rows.map((row, rowIndex) =>
    estimateTableRowHeight(
      tableBlock,
      row,
      rowIndex,
      contract,
      styles,
      measuredTextLineBreaks,
      measuredTableRowHeights,
      tableRowMeasurementJobs,
    ),
  );

  const firstFragment = buildTableFragment({
    block: tableBlock,
    startRowIndex: 0,
    availableHeight,
    fragmentIndex: 1,
    // 标题已经先落到当前栏时，这里不能再按“空栏强塞第一行”处理；
    // 我们要判断的正是“标题下方还能不能正常开始表格”。
    isCurrentPageEmpty: false,
    rowHeights,
    contract,
    styles,
    measuredTextLineBreaks,
    measuredTableRowHeights,
    tableRowMeasurementJobs,
  });

  return firstFragment !== null;
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
  const {
    blocks: originalBlocks,
    contract,
    styles,
    measuredBlockHeights,
    measuredTextLineBreaks,
    measuredTextFragmentHeights,
    textFragmentMeasurementJobs,
    measuredTableRowHeights,
    tableRowMeasurementJobs,
    optimizationSettings,
  } = context;
  const isMultiColumn = contract.columnCount > 1;
  const bottomSafeAreaPx =
    resolveDefaultBottomSafeAreaPx(contract) +
    Math.max(0, optimizationSettings?.bottomSafeAreaPx ?? 0);
  const heightReserveFactor = optimizationSettings?.heightReserveFactor ?? 1;
  const shortTailPenaltyBoost = optimizationSettings?.shortTailPenaltyBoost ?? 0;
  const tableRowSplitPriorityBoost = optimizationSettings?.tableRowSplitPriorityBoost ?? 0;

  if (originalBlocks.length === 0) {
    return [createEmptyPage(1, contract)];
  }

  const pageCapacity = getPaginationPageCapacityPx(contract);
  const tocItems = buildTocItemsFromBlocks(originalBlocks);
  const pages: PageLayout[] = [];
  let currentPage = createEmptyPage(1, contract);
  let currentHeight = 0;
  let placedBlocks: PlacedBlockEntry[] = [];
  let columnFlowState = createColumnFlowState(contract);
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
      resetColumnFlowState(columnFlowState);
      shouldPushCurrentPage = nextHasContent;
      continue;
    }

    if (block.type === 'columnBreak') {
      if (!isMultiColumn) {
        continue;
      }

      const nextIndex = index + 1;
      const nextHasContent = hasRemainingContent(blocks, nextIndex);
      if (!nextHasContent) {
        continue;
      }

      if (columnFlowState.currentColumnIndex < columnFlowState.columnCount - 1) {
        columnFlowState.currentColumnIndex += 1;
        shouldPushCurrentPage = true;
        continue;
      }

      syncPlacedBlocksToPage(currentPage, placedBlocks);
      if (placedBlocks.length > 0 || (pages.length > 0 && nextHasContent)) {
        pages.push(currentPage);
      }
      currentPage = createEmptyPage(pages.length + 1, contract);
      currentHeight = 0;
      placedBlocks = [];
      resetColumnFlowState(columnFlowState);
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
      resetColumnFlowState(columnFlowState);
    }

    // 计算当前块高度
    // 目录高度取决于整篇文档标题数量，不能只按块对象缓存，否则标题变化后会复用旧高度。
    const measuredBlockHeight = block.type === 'toc'
      ? null
      : getMeasuredBlockHeightForPagination({
          block,
          contract,
          measuredBlockHeights,
          measuredTextFragmentHeights,
          textFragmentMeasurementJobs,
        });
    const estimatedBlockHeight = block.type === 'toc'
      ? estimateBlockHeight(block, contract, tocItems, styles)
      : getCachedBlockHeight(block, contract, tocItems, styles);
    const blockHeight = resolvePlacementBlockHeight({
      block,
      estimatedHeight: estimatedBlockHeight,
      measuredHeight: measuredBlockHeight,
      contract,
      styles,
    }) * heightReserveFactor;
    const availableHeightForBlock = getAvailableHeightForBlock(
      placedBlocks,
      currentHeight,
      pageCapacity,
      block,
      contract,
      styles,
    ) - bottomSafeAreaPx;
    const columnPlacementCandidate = isMultiColumn
      ? resolveColumnPlacementCandidate(columnFlowState, block, blockHeight, contract)
      : { fits: true, availableHeight: availableHeightForBlock, columnIndex: 0, isSpanAll: false };
    const columnAvailableHeightForBlock = isMultiColumn
      ? getColumnAvailableHeightForBlock(columnFlowState, block, blockHeight, contract)
      : availableHeightForBlock;
    const nextContentBlock = findNextContentBlock(blocks, index + 1);

    if (
      isMultiColumn &&
      isHeadingBlock(block) &&
      shouldKeepBlockWithNext(block, contract) &&
      nextContentBlock &&
      isTableBlock(nextContentBlock) &&
      columnPlacementCandidate.fits &&
      !columnPlacementCandidate.isSpanAll
    ) {
      const currentColumnOccupiedHeight =
        columnFlowState.columnHeights[columnPlacementCandidate.columnIndex] ?? 0;
      if (currentColumnOccupiedHeight > 0) {
        const simulatedColumnFlowState: ColumnFlowState = {
          pageHeight: columnFlowState.pageHeight,
          columnCount: columnFlowState.columnCount,
          completedOffset: columnFlowState.completedOffset,
          currentColumnIndex: columnFlowState.currentColumnIndex,
          columnHeights: [...columnFlowState.columnHeights],
        };
        applyColumnPlacement(simulatedColumnFlowState, columnPlacementCandidate, blockHeight);
        const tableStartAvailableHeight = Math.max(
          0,
          resolveSameColumnRemainingHeightAfterPlacement(
            simulatedColumnFlowState,
            columnPlacementCandidate,
          ) - bottomSafeAreaPx,
        );
        const canStartNextTableInSameColumn = canStartTableInAvailableColumnHeight({
          tableBlock: nextContentBlock,
          availableHeight: tableStartAvailableHeight,
          contract,
          styles,
          measuredTextLineBreaks,
          measuredTableRowHeights,
          tableRowMeasurementJobs,
        });

        if (!canStartNextTableInSameColumn) {
          if (columnPlacementCandidate.columnIndex < columnFlowState.columnCount - 1) {
            columnFlowState.currentColumnIndex = columnPlacementCandidate.columnIndex + 1;
            index -= 1;
            continue;
          }

          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          resetColumnFlowState(columnFlowState);
          index -= 1;
          continue;
        }
      }
    }

    if (
      isMultiColumn &&
      columnPlacementCandidate.isSpanAll &&
      !columnPlacementCandidate.fits &&
      placedBlocks.length > 0
    ) {
      // 跨栏块会占用整行栏带；当前页剩余栏带放不下时应整块换页，不能按普通文本拆成页尾片段。
      syncPlacedBlocksToPage(currentPage, placedBlocks);
      pages.push(currentPage);
      currentPage = createEmptyPage(pages.length + 1, contract);
      currentHeight = 0;
      placedBlocks = [];
      resetColumnFlowState(columnFlowState);
      index -= 1;
      continue;
    }

    // PH2-20 多栏块切分通用机制 V1：TOC 也按"当前栏能否放下整块"判断。
    // 之前仅以 blockHeight > columnAvailableHeightForBlock 进入切分路径，
    // 现在改为"当前栏不能放但其他栏能放 → 切分填满当前栏 → 续排到下一栏"。
    // 但根据最新要求（PH2-20 实施完整版），TOC 不整块直接放入，按"整块放不下就切分"处理，
    // 保留原触发逻辑不变，仅把内层换页改为先 advanceToNextColumn。
    if (block.type === 'toc' && block.metadata.kind === 'toc' && blockHeight > columnAvailableHeightForBlock) {
      const maxDepth = block.metadata.maxDepth;
      const totalFilteredTocItems = tocItems.filter((item) => item.depth <= maxDepth).length;
      let startItemIndex = 0;
      let fragmentIndex = 1;

      while (startItemIndex < Math.max(1, totalFilteredTocItems)) {
        const availableHeight = getFragmentAvailableHeightForBlock({
          isMultiColumn,
          columnFlowState,
          placedBlocks,
          currentHeight,
          pageCapacity,
          block,
          blockHeight,
          contract,
          styles,
        });
        // PH2-20：通过统一接口 trySplitTocToFitHeight 调度。
        const fragment = trySplitTocToFitHeight({
          block,
          allTocItems: tocItems,
          startItemIndex,
          context: {
            availableHeight,
            columnIndex: columnFlowState.currentColumnIndex,
            isCurrentColumnEmpty: placedBlocks.length === 0,
            fragmentIndex,
          },
          contract,
        });

        if (!fragment) {
          if (placedBlocks.length === 0) {
            currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
            currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
            shouldPushCurrentPage = true;
            break;
          }

          // PH2-20：切分失败时优先 advanceToNextColumn 推进栏位，栏满才真正换页。
          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
          continue;
        }

        if (fragment.height > pageCapacity) {
          currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
        }

        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, fragment.block, fragment.height, contract, styles);
        if (isMultiColumn) {
          rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        }
        startItemIndex = fragment.nextItemIndex;
        fragmentIndex += 1;
        shouldPushCurrentPage = true;

        const totalTocItems = fragment.block.metadata.kind === 'toc'
          ? fragment.block.metadata.runtimeSlice?.totalItems ?? 0
          : 0;
        if (startItemIndex < totalTocItems) {
          // PH2-20：还有剩余 TOC 项时优先 advanceToNextColumn，栏满才换页。
          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
        }
      }

      continue;
    }

    // 处理表格块：整表放不下当前栏时，优先把能容纳的表格行留在当前栏，再把剩余续到下一栏/下一页。
    // PH2-20 多栏块切分通用机制 V1：表格作为首个 PoC，核心修复两点：
    //   1) 入口判断必须基于“当前栏能否放整表”，不能依赖 resolveColumnPlacementCandidate 的向后找栏（否则会指向下一栏误判 fits=true）；
    //   2) 切分失败/还有剩余行时，优先推进 currentColumnIndex 而不是 resetColumnFlowState，
    //      避免剩余行落到新页第一栏、上一栏底部出现大块留白。
    if (isTableBlock(block) && block.metadata.rows.length > 0) {
      // 当前栏剩余高度：单栏按 currentHeight，多栏按当前栏 columnHeights。
      const currentColumnIndex = columnFlowState.currentColumnIndex;
      const currentColumnRemainingHeight = resolveCurrentColumnRemainingHeight(
        columnFlowState,
        isMultiColumn,
        currentHeight,
        bottomSafeAreaPx,
      );
      // 当前栏能直接放下整表：走整放（保留原始块结构，不生成运行时片段）。
      if (
        columnPlacementCandidate.columnIndex === currentColumnIndex &&
        blockHeight <= currentColumnRemainingHeight
      ) {
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        shouldPushCurrentPage = true;
        continue;
      }

      let tableBlock = block;
      let rowHeights = tableBlock.metadata.rows.map((row, rowIndex) =>
        estimateTableRowHeight(
          tableBlock,
          row,
          rowIndex,
          contract,
          styles,
          measuredTextLineBreaks,
          measuredTableRowHeights,
          tableRowMeasurementJobs,
        ),
      );
      let startRowIndex = 0;
      let fragmentIndex = 1;

      while (startRowIndex < tableBlock.metadata.rows.length) {
        const availableHeight = getFragmentAvailableHeightForBlock({
          isMultiColumn,
          columnFlowState,
          placedBlocks,
          currentHeight,
          pageCapacity,
          block: tableBlock,
          blockHeight,
          contract,
          styles,
        });
        // PH2-20：通过统一接口 trySplitTableToFitHeight 调度，不再直接调用 buildTableFragment。
        const fragment = trySplitTableToFitHeight({
          block: tableBlock,
          startRowIndex,
          rowHeights,
          context: {
            availableHeight: availableHeight + tableRowSplitPriorityBoost * 12,
            columnIndex: columnFlowState.currentColumnIndex,
            isCurrentColumnEmpty: placedBlocks.length === 0,
            fragmentIndex,
          },
          contract,
          styles,
          measuredTextLineBreaks,
          measuredTableRowHeights,
          tableRowMeasurementJobs,
        });

        if (!fragment) {
          if (placedBlocks.length === 0) {
            // 极端数据兜底：空页仍无法生成片段时，强制放入并给出超高内容提示，避免分页死循环。
            currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
            const fallbackHeight = estimateTableBlockHeight(
              tableBlock,
              contract,
              styles,
              measuredTextLineBreaks,
              measuredTableRowHeights,
              tableRowMeasurementJobs,
            );
            currentHeight = appendPlacedBlock(placedBlocks, currentHeight, tableBlock, fallbackHeight, contract, styles);
            startRowIndex = tableBlock.metadata.rows.length;
            shouldPushCurrentPage = true;
            break;
          }

          // PH2-20：当前页剩余空间连表头/首行都放不下时，先尝试推进到下一栏继续切分，
          // 而不是直接换页。栏位都填满才真正换页。
          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            // 推进栏位后清掉当前页已累计的 completedOffset，让下一栏从 0 开始重新累计。
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
          continue;
        }

        if (fragment.height > pageCapacity) {
          currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
        }

        // PH2-20：把 runtimeSlice 写入片段 metadata，方便渲染层和导出层识别多栏表格切片。
        const startRowIndexInFragment = startRowIndex;
        const endRowIndexInFragment = fragment.nextRowIndex - 1;
        const totalFragments = -1; // 本步 PoC 不预先计算总分片数；后续子步接入后再回填。
        // fragment.block 来自 buildTableFragment，必定是表格；这里用断言写到 runtimeSlice。
        const blockWithSlice: LayoutBlock = {
          ...fragment.block,
          metadata: {
            ...fragment.block.metadata,
            runtimeSlice: {
              startRowIndex: startRowIndexInFragment,
              endRowIndex: endRowIndexInFragment,
              fragmentIndex,
              totalFragments,
              isContinuation: fragmentIndex > 1,
            },
          } as TableBlockMetadata,
        };

        currentHeight = appendPlacedBlock(
          placedBlocks,
          currentHeight,
          blockWithSlice,
          fragment.height,
          contract,
          styles,
        );
        if (isMultiColumn) {
          rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        }
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
            estimateTableRowHeight(
              tableBlock,
              row,
              rowIndex,
              contract,
              styles,
              measuredTextLineBreaks,
              measuredTableRowHeights,
              tableRowMeasurementJobs,
            ),
          );
        }
        startRowIndex = fragment.nextRowIndex;
        fragmentIndex += 1;
        shouldPushCurrentPage = true;

        if (startRowIndex < tableBlock.metadata.rows.length) {
          // PH2-20：剩余行优先续到下一栏，而不是直接换页清空栏状态。
          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            // 当前页已就绪的内容先落盘；下一栏继续切表格。
            // 注意：这里不重置 placedBlocks，因为栏位推进不意味着整页结束。
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
        }
      }
      continue;
    }

    // 处理列表块（按列表项分割，避免标题后整组列表翻页造成大空白）
    // PH2-20：入口判断从 columnPlacementCandidate.fits 改为"当前栏能否放下整块"；
    // 切分失败 / 还有剩余项时优先 advanceToNextColumn 推进栏位；
    // 切分调用改为 trySplitListToFitHeight 统一接口；
    // 切分成功后写入 metadata.runtimeSlice。
    if (isListBlock(block) && block.metadata.items.length > 0) {
      const currentColumnIndex = columnFlowState.currentColumnIndex;
      const currentColumnRemainingHeight = resolveCurrentColumnRemainingHeight(
        columnFlowState,
        isMultiColumn,
        currentHeight,
        bottomSafeAreaPx,
      );
      // 整块放入条件：当前栏（而非向后找到的栏）能放下整列表。
      if (
        columnPlacementCandidate.columnIndex === currentColumnIndex &&
        blockHeight <= currentColumnRemainingHeight
      ) {
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        shouldPushCurrentPage = true;
        continue;
      }

      let listBlock = block;
      let startItemIndex = 0;
      let fragmentIndex = 1;

      while (startItemIndex < listBlock.metadata.items.length) {
        const availableHeight = getFragmentAvailableHeightForBlock({
          isMultiColumn,
          columnFlowState,
          placedBlocks,
          currentHeight,
          pageCapacity,
          block: listBlock,
          blockHeight,
          contract,
          styles,
        });
        // PH2-20：通过统一接口 trySplitListToFitHeight 调度。
        const fragment = trySplitListToFitHeight({
          block: listBlock,
          startItemIndex,
          context: {
            availableHeight,
            columnIndex: columnFlowState.currentColumnIndex,
            isCurrentColumnEmpty: placedBlocks.length === 0,
            fragmentIndex,
          },
          contract,
          styles,
          measuredTextLineBreaks,
          measuredTextFragmentHeights,
          textFragmentMeasurementJobs,
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

          // PH2-20：切分失败时优先 advanceToNextColumn 推进栏位，栏满才真正换页。
          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
          continue;
        }

        if (fragment.height > pageCapacity) {
          currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
        }

        // PH2-20-block-split-rendering-adaptation-v1：
        // 原 PH2-20-block-split-types-adaptation-v1 期间在此处用 blockWithSlice 重复覆盖了一次 runtimeSlice；
        // 现在 createListFragmentBlock 内部已经一次性写入完整 metadata（含 runtimeSlice），
        // 这里只需要取 fragment.block 直接放入分页即可，避免重复覆盖与字段漂移风险。
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, fragment.block, fragment.height, contract, styles);
        if (isMultiColumn) {
          rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        }
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
          // PH2-20：还有剩余项时优先 advanceToNextColumn 推进栏位，栏满才换页。
          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
        }
      }

      continue;
    }

    // 局部分栏区段作为独立容器分页：当前页只取一个局部分栏片段，剩余片段继续排到后续栏或后续页。
    if (isColumnSectionBlock(block) && block.metadata.blocks.length > 0) {
      const currentColumnIndex = columnFlowState.currentColumnIndex;
      const currentColumnRemainingHeight = resolveCurrentColumnRemainingHeight(
        columnFlowState,
        isMultiColumn,
        currentHeight,
        bottomSafeAreaPx,
      );
      if (
        columnPlacementCandidate.columnIndex === currentColumnIndex &&
        blockHeight <= currentColumnRemainingHeight
      ) {
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        shouldPushCurrentPage = true;
        continue;
      }

      let columnSectionBlock: LayoutBlock = block;
      let hasMore = true;

      while (hasMore) {
        const sectionAvailableHeight = getFragmentAvailableHeightForBlock({
          isMultiColumn,
          columnFlowState,
          placedBlocks,
          currentHeight,
          pageCapacity,
          block: columnSectionBlock,
          blockHeight,
          contract,
          styles,
        });
        const fragment = trySplitColumnSectionToFitHeight({
          block: columnSectionBlock as ColumnSectionLayoutBlock,
          context: {
            availableHeight: sectionAvailableHeight,
            columnIndex: columnFlowState.currentColumnIndex,
            isCurrentColumnEmpty: placedBlocks.length === 0,
            fragmentIndex: 1,
          },
          contract,
          styles,
        });

        if (!fragment) {
          if (placedBlocks.length === 0) {
            currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
            currentHeight = appendPlacedBlock(
              placedBlocks,
              currentHeight,
              columnSectionBlock,
              blockHeight,
              contract,
              styles,
            );
            shouldPushCurrentPage = true;
            break;
          }

          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }

          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
          continue;
        }

        currentHeight = appendPlacedBlock(
          placedBlocks,
          currentHeight,
          fragment.block,
          fragment.height,
          contract,
          styles,
        );
        if (isMultiColumn) {
          rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        }
        shouldPushCurrentPage = true;

        if (fragment.remainingBlock) {
          columnSectionBlock = fragment.remainingBlock;
          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
        } else {
          hasMore = false;
        }
      }

      continue;
    }

    // 处理引用块：多栏下不能继续整块避让，否则当前栏明明还有空间也会直接留白。
    // PH2-20：与列表 / 表格对齐，入口判断改为"当前栏能否放下整块"；
    // 切分失败 / 还有剩余块时优先 advanceToNextColumn 推进栏位；
    // 切分调用换为 trySplitBlockquoteToFitHeight 统一接口；
    // 剩余块 splice 入 blocks 数组，下一轮 while 循环继续处理。
    if (isBlockquoteBlock(block) && block.metadata.blocks.length > 0) {
      const currentColumnIndex = columnFlowState.currentColumnIndex;
      const currentColumnRemainingHeight = resolveCurrentColumnRemainingHeight(
        columnFlowState,
        isMultiColumn,
        currentHeight,
        bottomSafeAreaPx,
      );
      // 整块放入条件：当前栏（而非向后找到的栏）能放下整引用块。
      if (
        columnPlacementCandidate.columnIndex === currentColumnIndex &&
        blockHeight <= currentColumnRemainingHeight
      ) {
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        shouldPushCurrentPage = true;
        continue;
      }

      let blockquoteBlock: LayoutBlock = block;
      let fragmentIndex = 1;
      let hasMore = true;

      while (hasMore) {
        const blockquoteAvailableHeight = getFragmentAvailableHeightForBlock({
          isMultiColumn,
          columnFlowState,
          placedBlocks,
          currentHeight,
          pageCapacity,
          block: blockquoteBlock,
          blockHeight,
          contract,
          styles,
        });
        // PH2-20：blockquoteBlock 来自上一个 while 轮次的 fragment.remainingBlock，
        // 运行时一定是引用类型。这里把 LayoutBlock cast 为 BlockquoteLayoutBlock。
        const fragment = trySplitBlockquoteToFitHeight({
          block: blockquoteBlock as BlockquoteLayoutBlock,
          context: {
            availableHeight: blockquoteAvailableHeight,
            columnIndex: columnFlowState.currentColumnIndex,
            isCurrentColumnEmpty: placedBlocks.length === 0,
            fragmentIndex,
          },
          contract,
          styles,
          tocItems,
          measuredTextLineBreaks,
          measuredTextFragmentHeights,
          textFragmentMeasurementJobs,
          measuredTableRowHeights,
          tableRowMeasurementJobs,
        });

        if (!fragment) {
          if (placedBlocks.length === 0) {
            // 空页仍无法切分时强制整块放入并告警，避免死循环。
            currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
            currentHeight = appendPlacedBlock(placedBlocks, currentHeight, blockquoteBlock, blockHeight, contract, styles);
            shouldPushCurrentPage = true;
            break;
          }

          // PH2-20：切分失败时优先 advanceToNextColumn，栏满才真正换页。
          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
          continue;
        }

        if (fragment.height > pageCapacity) {
          currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
        }

        currentHeight = appendPlacedBlock(
          placedBlocks,
          currentHeight,
          fragment.block,
          fragment.height,
          contract,
          styles,
        );
        if (isMultiColumn) {
          rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        }
        shouldPushCurrentPage = true;

        if (fragment.remainingBlock) {
          blockquoteBlock = fragment.remainingBlock;
          fragmentIndex += 1;
          // PH2-20：还有剩余引用块内容时优先 advanceToNextColumn，栏满才换页。
          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
        } else {
          hasMore = false;
        }
      }

      continue;
    }

    // 处理代码块：多栏时也要优先吃满当前栏，而不是整块跳到下一栏。
    // PH2-20：与列表 / 表格对齐，入口判断改为"当前栏能否放下整块"；
    // 切分失败 / 还有剩余块时优先 advanceToNextColumn 推进栏位；
    // 切分调用换为 trySplitCodeToFitHeight 统一接口。
    if (block.type === 'code' && block.metadata.kind === 'code') {
      const currentColumnIndex = columnFlowState.currentColumnIndex;
      const currentColumnRemainingHeight = resolveCurrentColumnRemainingHeight(
        columnFlowState,
        isMultiColumn,
        currentHeight,
        bottomSafeAreaPx,
      );
      // 整块放入条件：当前栏能放下整代码块。
      if (
        columnPlacementCandidate.columnIndex === currentColumnIndex &&
        blockHeight <= currentColumnRemainingHeight
      ) {
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        shouldPushCurrentPage = true;
        continue;
      }

      let codeBlock = block;
      let fragmentIndex = 1;
      let hasMore = true;

      while (hasMore) {
        const codeAvailableHeight = getFragmentAvailableHeightForBlock({
          isMultiColumn,
          columnFlowState,
          placedBlocks,
          currentHeight,
          pageCapacity,
          block: codeBlock,
          blockHeight,
          contract,
          styles,
        });
        const fragment = trySplitCodeToFitHeight({
          block: codeBlock,
          context: {
            availableHeight: codeAvailableHeight,
            columnIndex: columnFlowState.currentColumnIndex,
            isCurrentColumnEmpty: placedBlocks.length === 0,
            fragmentIndex,
          },
          contract,
          styles,
          measuredTextLineBreaks,
          measuredTextFragmentHeights,
          textFragmentMeasurementJobs,
        });

        if (!fragment) {
          if (placedBlocks.length === 0) {
            currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
            currentHeight = appendPlacedBlock(placedBlocks, currentHeight, codeBlock, blockHeight, contract, styles);
            shouldPushCurrentPage = true;
            break;
          }
          // PH2-20：切分失败时优先 advanceToNextColumn，栏满才真正换页。
          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
          continue;
        }

        if (fragment.height > pageCapacity) {
          currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
        }

        currentHeight = appendPlacedBlock(
          placedBlocks,
          currentHeight,
          fragment.block,
          fragment.height,
          contract,
          styles,
        );
        if (isMultiColumn) {
          rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        }
        shouldPushCurrentPage = true;

        if (fragment.remainingBlock) {
          codeBlock = fragment.remainingBlock;
          fragmentIndex += 1;
          // PH2-20：还有剩余代码块内容时优先 advanceToNextColumn，栏满才换页。
          if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
            currentHeight = sumPlacedBlockHeights(placedBlocks);
            continue;
          }
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
          if (isMultiColumn) {
            resetColumnFlowState(columnFlowState);
          }
        } else {
          hasMore = false;
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
      if ((imageHeight > imageAvailableHeight || (isMultiColumn && !columnPlacementCandidate.fits)) && placedBlocks.length > 0) {
        syncPlacedBlocksToPage(currentPage, placedBlocks);
        pages.push(currentPage);
        currentPage = createEmptyPage(pages.length + 1, contract);
        currentHeight = 0;
        placedBlocks = [];
        if (isMultiColumn) {
          resetColumnFlowState(columnFlowState);
        }
      }

      // 再次检查图片是否超过整页
      if (imageHeight > pageCapacity) {
        currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
      }

      currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, imageHeight, contract, styles);
      if (isMultiColumn) {
        rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
      }
      shouldPushCurrentPage = true;
      continue;
    }

    // 处理文本块（标题、段落）
    // PH2-20：入口判断改为"当前栏能否放下整块"；
    // splitInfo===null 整页翻页路径改为先 advanceToNextColumn，栏满才换页；
    // trySplitTextToFitHeight 与 splice 续排天然冲突，本步暂不替换调用，留待后续子步。
    if (block.type === 'heading' || block.type === 'paragraph') {
      // 多栏时文本拆分必须看"当前可用栏高度"，不能继续用整页总剩余高度；
      // 否则算法会生成超过当前两栏可显示范围的片段，浏览器只能横向续出第三栏。
      const availableHeight = isMultiColumn ? columnAvailableHeightForBlock : availableHeightForBlock;
      const currentColumnIndex = columnFlowState.currentColumnIndex;
      const currentColumnRemainingHeight = resolveCurrentColumnRemainingHeight(
        columnFlowState,
        isMultiColumn,
        currentHeight,
        bottomSafeAreaPx,
      );

      // PH2-20：整块放入条件改为"当前栏能放"，避免 columnPlacementCandidate 向后找栏误判。
      if (
        columnPlacementCandidate.columnIndex === currentColumnIndex &&
        blockHeight <= currentColumnRemainingHeight
      ) {
        // 可以完整放入。
        // PH2-20-block-split-text-rendering-adaptation-v1：整放 path 也要给 heading / paragraph
        // 写入 metadata.runtimeSlice = { isOriginal: true, isContinuation: false, ... }，
        // 但如果当前 block 是上一次 while 循环 splice 进来的"续排 fragment"，它已经带 metadata.runtimeSlice
        // （isContinuation=true 或 isOriginal=true），这里就必须保留其原值，避免覆盖续排标记。
        const existingSlice = isTextBlockExistingSlice(block);
        const placedTextLength =
          block.textRuns.reduce((sum, run) => sum + run.text.length, 0);
        const placedBlock =
          (block.type === 'heading' || block.type === 'paragraph') && !existingSlice
            ? ({
                ...block,
                metadata: {
                  ...block.metadata,
                  runtimeSlice: {
                    isContinuation: false,
                    isOriginal: true,
                    sourceNodeId: block.id,
                    characterRange: { start: 0, end: Math.max(0, placedTextLength - 1) },
                    fragmentIdSuffix: '',
                  },
                },
              } as LayoutBlock)
            : block;
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, placedBlock, blockHeight, contract, styles);
        if (isMultiColumn) {
          rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        }
        shouldPushCurrentPage = true;
      } else {
        // 不能完整放入，尝试按行分割
        const splitInfo = computeOptimalTextSplit(
          block,
          availableHeight + shortTailPenaltyBoost * 8,
          contract,
          styles,
          measuredTextLineBreaks,
        );

        if (splitInfo) {
          // splitInfo 返回当前页文本和剩余文本两部分
          // 当前页文本放入当前页，剩余文本创建新块放入下一页

          // 将当前页文本放入当前页（只有非空文本才放入）
          if (splitInfo.currentPageText.length > 0) {
            // PH2-20-block-split-text-rendering-adaptation-v1：
            // sourceNodeId / characterRange 必须始终指向"最初原始块"。
            // remaining fragment 在 splice 进来后本身可能又有 metadata.runtimeSlice；
            // 这里读它的 sourceNodeId 与 characterRange 起点，没有就降级为 block.id / 0。
            const existingRuntimeSlice = isTextBlockExistingSlice(block);
            const canonicalSourceNodeId = existingRuntimeSlice?.sourceNodeId ?? block.id;
            const baseCharacterStart = existingRuntimeSlice?.characterRange.start ?? 0;

            const sourceRuntimeMeasurement = resolveRuntimeTextMeasurement({
              id: canonicalSourceNodeId,
              textRuns: block.textRuns,
              runtimeMeasurement: block.runtimeMeasurement,
            });
            const currentRuntimeMeasurement = createRuntimeTextMeasurementSlice(
              sourceRuntimeMeasurement,
              0,
              splitInfo.currentPageText.length,
            );
            const { currentPageRuns, remainingRuns } = splitTextRunsByPlainTextLength(
              block.textRuns,
              splitInfo.currentPageText.length,
            );
            // PH2-20-block-split-text-rendering-adaptation-v1：
            // 为 current / remaining fragment 各自构造 fragmentContext，让 createTextFragmentBlock
            // 一次性把 runtimeSlice 写入 heading / paragraph 的 metadata。
            const currentFragmentSuffix = `frag-${pages.length}-${placedBlocks.length}`;
            const currentFragmentBlock = createTextFragmentBlock(
              block,
              currentPageRuns,
              splitInfo.currentPageText,
              currentFragmentSuffix,
              {
                omitTrailingSpaceAfter: splitInfo.omitTrailingSpaceAfter,
                preserveOriginalIdentity: splitInfo.remainingText.length === 0,
                runtimeMeasurement: currentRuntimeMeasurement,
                fragmentContext: {
                  isContinuation: false,
                  isOriginal: splitInfo.remainingText.length === 0,
                  sourceNodeId: canonicalSourceNodeId,
                  characterRange: {
                    start: baseCharacterStart,
                    end: baseCharacterStart + splitInfo.currentPageText.length - 1,
                  },
                  fragmentIdSuffix: currentFragmentSuffix,
                },
              },
            );
            const measuredFragmentHeight = getMeasuredBlockHeightForPagination({
              block: currentFragmentBlock,
              contract,
              measuredBlockHeights: undefined,
              measuredTextFragmentHeights,
              textFragmentMeasurementJobs,
            });
            const fragmentHeight = resolvePlacementBlockHeight({
              block: currentFragmentBlock,
              estimatedHeight: splitInfo.height,
              measuredHeight: measuredFragmentHeight,
              contract,
              styles,
            });

            currentHeight = appendPlacedBlock(
              placedBlocks,
              currentHeight,
              currentFragmentBlock,
              fragmentHeight,
              contract,
              styles,
            );
            if (isMultiColumn) {
              rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
            }
            shouldPushCurrentPage = true;

            // 创建剩余文本块，并插到当前块之后，确保它紧跟原块继续分页。
            if (splitInfo.remainingText.length > 0) {
              const remainingRuntimeMeasurement = createRuntimeTextMeasurementSlice(
                sourceRuntimeMeasurement,
                splitInfo.currentPageText.length,
                splitInfo.currentPageText.length + splitInfo.remainingText.length,
              );
              const remainingFragmentSuffix = `rest-${pages.length}-${placedBlocks.length}`;
              const remainingBlock = createTextFragmentBlock(
                block,
                remainingRuns,
                splitInfo.remainingText,
                remainingFragmentSuffix,
                {
                  omitLeadingSpaceBefore: true,
                  runtimeMeasurement: remainingRuntimeMeasurement,
                  fragmentContext: {
                    isContinuation: true,
                    isOriginal: false,
                    sourceNodeId: canonicalSourceNodeId,
                    characterRange: {
                      start: baseCharacterStart + splitInfo.currentPageText.length,
                      end: baseCharacterStart + splitInfo.currentPageText.length + splitInfo.remainingText.length - 1,
                    },
                    fragmentIdSuffix: remainingFragmentSuffix,
                  },
                },
              );

              blocks.splice(index + 1, 0, remainingBlock);
            }
          }
        } else {
          // splitInfo 为 null（usableHeight<=0）→ 整个块翻页
          // 当前页剩余空间不足时，先换页，再让同一个文本块重新走完整分割流程。
          if (placedBlocks.length > 0) {
            // PH2-20：先尝试 advanceToNextColumn 推进栏位，栏满才真正换页。
            if (isMultiColumn && advanceToNextColumn(columnFlowState)) {
              currentHeight = sumPlacedBlockHeights(placedBlocks);
              index -= 1;
              continue;
            }
            syncPlacedBlocksToPage(currentPage, placedBlocks);
            pages.push(currentPage);
            currentPage = createEmptyPage(pages.length + 1, contract);
            currentHeight = 0;
            placedBlocks = [];
            if (isMultiColumn) {
              resetColumnFlowState(columnFlowState);
            }
            index -= 1;
            continue;
          }

          if (blockHeight > pageCapacity) {
            currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
          }

          currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
          if (isMultiColumn) {
            rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
          }
          shouldPushCurrentPage = true;
        }
      }
      continue;
    }

    // 处理其他类型块（列表、引用、代码块、分隔线等）
    if (blockHeight > availableHeightForBlock || !columnPlacementCandidate.fits) {
      if (placedBlocks.length === 0) {
        // 超大块警告
        currentPage.warnings.push(createOversizedWarning(block, currentPage.pageNumber));
        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        if (isMultiColumn) {
          rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        }
        shouldPushCurrentPage = true;
      } else {
        // 开启新页面
        syncPlacedBlocksToPage(currentPage, placedBlocks);
        pages.push(currentPage);
        currentPage = createEmptyPage(pages.length + 1, contract);
        currentHeight = 0;
        placedBlocks = [];
        if (isMultiColumn) {
          resetColumnFlowState(columnFlowState);
        }

        currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
        if (isMultiColumn) {
          rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
        }
        shouldPushCurrentPage = true;
      }
    } else {
      currentHeight = appendPlacedBlock(placedBlocks, currentHeight, block, blockHeight, contract, styles);
      if (isMultiColumn) {
        rebuildColumnFlowState(columnFlowState, placedBlocks, contract);
      }
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
