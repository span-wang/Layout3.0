import {
  getHeadingText,
  getLayoutListItemLevel,
  getLayoutBlockPlainText,
  type LayoutBlock,
  type LayoutTableRow,
  type TableBlockMetadata,
} from '@/engine/document-model';
import { estimateImageVisibleHeightPx, resolveHangingIndentLineWidths } from '@/engine/document-model';
import type { ResolvedStyleContract, TextBlockStyleRule } from '@/engine/style/types';
import { estimateTextLines } from '../textMetrics';
import type {
  LayoutWarning,
  PageLayout,
  PaginationAlgorithmContext,
  RebalanceTrailingBlockStrategy,
} from '../types';

interface EstimatedPaginationOptions {
  rebalanceTrailingBlock?: boolean;
  rebalanceStrategy?: RebalanceTrailingBlockStrategy;
}

interface PlacedBlockEntry {
  block: LayoutBlock;
  height: number;
}

type TableLayoutBlock = LayoutBlock & {
  type: 'table';
  metadata: TableBlockMetadata;
};

interface TableFragmentRow {
  row: LayoutTableRow;
  originalRowIndex: number;
  isRepeatedHeader: boolean;
}

interface TableFragmentBuildResult {
  block: LayoutBlock;
  height: number;
  nextRowIndex: number;
}

// 这一段是分页估算的基础常量，命名后更容易在后续校准时统一调整。
const BLOCKQUOTE_NESTED_BLOCK_HEIGHT_RATIO = 0.92;

function getMaxFontSize(textRuns: Array<{ styleOverrides: { fontSize?: number } }>, fallback: number): number {
  return textRuns.reduce((max, run) => Math.max(max, run.styleOverrides.fontSize ?? fallback), fallback);
}

function resolveTextBlockStyle(
  block: LayoutBlock,
  baseStyle: TextBlockStyleRule,
): TextBlockStyleRule {
  return {
    ...baseStyle,
    fontSize: getMaxFontSize(block.textRuns, baseStyle.fontSize),
    lineHeight: block.blockStyleOverrides.lineHeight ?? baseStyle.lineHeight,
    marginTop: block.blockStyleOverrides.spaceBefore ?? baseStyle.marginTop,
    marginBottom: block.blockStyleOverrides.spaceAfter ?? baseStyle.marginBottom,
  };
}

function estimateTextBlockHeight(
  text: string,
  widthPx: number,
  style: TextBlockStyleRule,
  firstLineWidthPx = widthPx,
): number {
  const lines = estimateTextLines(text, widthPx, style.fontSize, {
    firstLineWidthPx,
  });
  return style.marginTop + lines * style.lineHeight + style.marginBottom;
}

function isTableBlock(block: LayoutBlock): block is TableLayoutBlock {
  return block.type === 'table' && block.metadata.kind === 'table';
}

function getTableMarginTop(block: TableLayoutBlock, contract: ResolvedStyleContract): number {
  return block.blockStyleOverrides.spaceBefore ?? contract.blockStyles.table.marginTop;
}

function getTableMarginBottom(block: TableLayoutBlock, contract: ResolvedStyleContract): number {
  return block.blockStyleOverrides.spaceAfter ?? contract.blockStyles.table.marginBottom;
}

function estimateTableRowHeight(
  block: TableLayoutBlock,
  row: LayoutTableRow,
  rowIndex: number,
  contract: ResolvedStyleContract,
): number {
  const contentWidthPx = contract.contentWidthPx;
  const estimatedRowHeight = row.cells.reduce((maxHeight, cell) => {
    const cellWidthPx = Math.max(
      80,
      contentWidthPx / Math.max(1, row.cells.length) - contract.blockStyles.table.cellPaddingX * 2,
    );
    const lines = estimateTextLines(
      cell.textRuns.map((run) => run.text).join(''),
      cellWidthPx,
      getMaxFontSize(cell.textRuns, contract.blockStyles.paragraph.fontSize),
    );
    const lineHeight =
      block.blockStyleOverrides.lineHeight ?? contract.blockStyles.paragraph.lineHeight;

    return Math.max(
      maxHeight,
      lines * lineHeight + contract.blockStyles.table.cellPaddingY * 2,
    );
  }, 0);
  const isHeaderLikeRow = rowIndex === 0 || row.cells.some((cell) => cell.isHeader);
  const fallbackHeight =
    isHeaderLikeRow ? contract.blockStyles.table.headerRowHeight : contract.blockStyles.table.rowHeight;

  return Math.max(fallbackHeight, estimatedRowHeight);
}

function estimateTableBlockHeight(block: TableLayoutBlock, contract: ResolvedStyleContract): number {
  return (
    getTableMarginTop(block, contract) +
    block.metadata.rows.reduce(
      (total, row, rowIndex) => total + estimateTableRowHeight(block, row, rowIndex, contract),
      0,
    ) +
    getTableMarginBottom(block, contract)
  );
}

function getRepeatedTableHeaderRow(block: TableLayoutBlock): LayoutTableRow | null {
  const headerRow = block.metadata.rows[0];
  if (!headerRow || headerRow.cells.length === 0) {
    return null;
  }

  // 右侧面板的“首行作为表头”会把第一行所有单元格都标为表头，这里用同一语义判断是否续表头。
  return headerRow.cells.every((cell) => cell.isHeader) ? headerRow : null;
}

function createRuntimeTableRow(fragmentRow: TableFragmentRow, fragmentIndex: number): LayoutTableRow {
  const runtimeRowSuffix = fragmentRow.isRepeatedHeader
    ? `fragment-${fragmentIndex}-repeat-header`
    : `fragment-${fragmentIndex}`;

  return {
    ...fragmentRow.row,
    id: `${fragmentRow.row.id}-${runtimeRowSuffix}`,
    sourceRange: fragmentRow.isRepeatedHeader ? null : fragmentRow.row.sourceRange,
    // 单元格 ID 保持为原始 ID，用户点击分页续表头时仍能对应回原表头单元格。
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
}): TableFragmentBuildResult | null {
  const { block, startRowIndex, availableHeight, fragmentIndex, isCurrentPageEmpty, rowHeights, contract } = payload;
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
    fragmentHeight += rowHeights[0] ?? estimateTableRowHeight(block, repeatedHeaderRow, 0, contract);
  }

  while (nextRowIndex < rows.length) {
    const rowHeight = rowHeights[nextRowIndex] ?? estimateTableRowHeight(block, rows[nextRowIndex], nextRowIndex, contract);
    const candidateHeight = fragmentHeight + rowHeight;
    const canFit = candidateHeight <= availableHeight;
    const mustForceFirstRealRow = isCurrentPageEmpty && realRowCount === 0;

    if (!canFit && !mustForceFirstRealRow) {
      break;
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
    const nextBodyRowHeight = rowHeights[nextRowIndex] ?? estimateTableRowHeight(block, nextBodyRow, nextRowIndex, contract);
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

function getBlockKeepWithNext(block: LayoutBlock, contract: ResolvedStyleContract): boolean {
  if (block.type !== 'heading' || block.metadata.kind !== 'heading') {
    return false;
  }

  return (
    (block.metadata.depth === 1
      ? contract.blockStyles.heading1.keepWithNext
      : block.metadata.depth === 2
        ? contract.blockStyles.heading2.keepWithNext
        : contract.blockStyles.heading3.keepWithNext) ?? false
  );
}

function getBlockLabel(block: LayoutBlock): string {
  switch (block.type) {
    case 'heading':
      return `标题“${getHeadingText(block) || '未命名标题'}”`;
    case 'toc':
      return '目录';
    case 'paragraph':
      return `段落“${getLayoutBlockPlainText(block).slice(0, 18) || '空段落'}${
        getLayoutBlockPlainText(block).length > 18 ? '…' : ''
      }”`;
    case 'list':
      return `列表（${block.metadata.kind === 'list' ? block.metadata.items.length : 0} 项）`;
    case 'blockquote':
      return '引用块';
    case 'code':
      return `代码块${
        block.metadata.kind === 'code' && block.metadata.language ? `（${block.metadata.language}）` : ''
      }`;
    case 'table':
      return `表格（${block.metadata.kind === 'table' ? block.metadata.rows.length : 0} 行）`;
    case 'image':
      return `图片${
        block.metadata.kind === 'image' && block.metadata.alt ? `“${block.metadata.alt}”` : ''
      }`;
    case 'horizontalRule':
      return '分隔线';
    case 'pageBreak':
      return '分页符';
    default:
      return '内容块';
  }
}

function createOversizedWarnings(block: LayoutBlock, pageNumber: number): LayoutWarning[] {
  const blockLabel = getBlockLabel(block);

  return [
    {
      pageNumber,
      type: 'oversizedBlock',
      blockType: block.type,
      blockLabel,
      message: `${blockLabel}的估算高度已经超过单页正文可用高度。`,
      suggestion: '建议拆分内容，或调整字号、边距后再排版。',
    },
    {
      pageNumber,
      type: 'forcedOverflow',
      blockType: block.type,
      blockLabel,
      message: `${blockLabel}无法在单页内完整容纳，当前页会出现溢出风险。`,
      suggestion: '建议将该内容拆成多个更短的块，必要时手动插入分页。',
    },
  ];
}

function estimateBlockHeight(block: LayoutBlock, contract: ResolvedStyleContract): number {
  const contentWidthPx = contract.contentWidthPx;

  switch (block.type) {
    case 'pageBreak':
      return 0;
    case 'toc':
      return 220;
    case 'heading': {
      const lineWidths = resolveHangingIndentLineWidths(contentWidthPx, block.blockStyleOverrides);
      // 标题同时受左右缩进、首行缩进与悬挂缩进影响，宽度先统一收窄再估算。
      return estimateTextBlockHeight(
        getLayoutBlockPlainText(block),
        lineWidths.followingLineWidthPx,
        resolveTextBlockStyle(
          block,
          block.metadata.kind === 'heading' && block.metadata.depth === 1
            ? contract.blockStyles.heading1
            : block.metadata.kind === 'heading' && block.metadata.depth === 2
              ? contract.blockStyles.heading2
              : contract.blockStyles.heading3,
        ),
        lineWidths.firstLineWidthPx,
      );
    }
    case 'paragraph': {
      const lineWidths = resolveHangingIndentLineWidths(contentWidthPx, block.blockStyleOverrides);
      // 段落和标题共用同一套缩进宽度算法，避免预览和分页结果偏移。
      return estimateTextBlockHeight(
        getLayoutBlockPlainText(block),
        lineWidths.followingLineWidthPx,
        resolveTextBlockStyle(block, contract.blockStyles.paragraph),
        lineWidths.firstLineWidthPx,
      );
    }
    case 'list': {
      const listStyle = {
        ...contract.blockStyles.list,
        lineHeight: block.blockStyleOverrides.lineHeight ?? contract.blockStyles.list.lineHeight,
        marginTop: block.blockStyleOverrides.spaceBefore ?? contract.blockStyles.list.marginTop,
        marginBottom: block.blockStyleOverrides.spaceAfter ?? contract.blockStyles.list.marginBottom,
      };
      const widthPx = Math.max(120, contentWidthPx - contract.blockStyles.list.indent);
      const itemHeights =
        block.metadata.kind === 'list'
          ? block.metadata.items.reduce((total, item, index) => {
              const itemText = item.textRuns.map((run) => run.text).join('');
              const levelIndentPx = Math.max(0, getLayoutListItemLevel(item) - 1) * Math.max(16, contract.blockStyles.list.indent * 0.72);
              const lines = estimateTextLines(
                itemText,
                Math.max(80, widthPx - levelIndentPx),
                getMaxFontSize(item.textRuns, contract.blockStyles.list.fontSize),
              );
              const gap = index === 0 ? 0 : contract.blockStyles.list.itemGap;
              return total + gap + lines * listStyle.lineHeight;
            }, 0)
          : 0;
      return listStyle.marginTop + itemHeights + listStyle.marginBottom;
    }
    case 'blockquote':
      return (
        contract.blockStyles.blockquote.marginTop +
        16 +
        (block.metadata.kind === 'blockquote'
          ? block.metadata.blocks.reduce(
              (total, nestedBlock) => total + estimateBlockHeight(nestedBlock, contract) * BLOCKQUOTE_NESTED_BLOCK_HEIGHT_RATIO,
              0,
            )
          : 0) +
        contract.blockStyles.blockquote.marginBottom
      );
    case 'code': {
      const codeStyle = {
        ...contract.blockStyles.code,
        fontSize: getMaxFontSize(block.textRuns, contract.blockStyles.code.fontSize),
        lineHeight: block.blockStyleOverrides.lineHeight ?? contract.blockStyles.code.lineHeight,
        marginTop: block.blockStyleOverrides.spaceBefore ?? contract.blockStyles.code.marginTop,
        marginBottom: block.blockStyleOverrides.spaceAfter ?? contract.blockStyles.code.marginBottom,
      };
      const widthPx = Math.max(120, contentWidthPx - contract.blockStyles.code.paddingX * 2);
      const lines = estimateTextLines(
        block.metadata.kind === 'code' ? block.metadata.value : getLayoutBlockPlainText(block),
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

      return estimateTableBlockHeight(block, contract);
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

function estimateImageBlockHeight(block: LayoutBlock, contract: ResolvedStyleContract): number {
  if (block.type !== 'image' || block.metadata.kind !== 'image') {
    return contract.blockStyles.image.marginTop + contract.blockStyles.image.placeholderHeight + contract.blockStyles.image.marginBottom;
  }

  const imageHeightPx = estimateImageVisibleHeightPx(block.metadata, contract.blockStyles.image.placeholderHeight);
  const wrapMode = block.metadata.wrapMode ?? 'block';
  const wrapCompensation =
    wrapMode === 'left' || wrapMode === 'right'
      ? Math.max(0, Math.round(contract.contentWidthPx * 0.22))
      : 0;

  return (
    contract.blockStyles.image.marginTop +
    Math.max(1, imageHeightPx - wrapCompensation) +
    (block.metadata.alt ? contract.blockStyles.image.captionGap + contract.blockStyles.paragraph.lineHeight : 0) +
    contract.blockStyles.image.marginBottom
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

function createEmptyPage(pageNumber: number, contract: ResolvedStyleContract): PageLayout {
  return {
    pageNumber,
    blocks: [],
    contract,
    warnings: [],
  };
}

function syncPlacedBlocksToPage(page: PageLayout, placedBlocks: PlacedBlockEntry[]): void {
  page.blocks = placedBlocks.map((entry) => entry.block);
}

function addOversizedWarningsIfNeeded(
  page: PageLayout,
  placedBlocks: PlacedBlockEntry[],
  block: LayoutBlock,
  blockHeight: number,
  pageCapacity: number,
): void {
  if (placedBlocks.length === 0 && blockHeight > pageCapacity) {
    page.warnings.push(...createOversizedWarnings(block, page.pageNumber));
  }
}

function shouldRebalanceTrailingBlock(payload: {
  currentHeight: number;
  nextBlockHeight: number;
  pageCapacity: number;
  placedBlocks: PlacedBlockEntry[];
  strategy: RebalanceTrailingBlockStrategy;
  currentBlock: LayoutBlock;
  contract: ResolvedStyleContract;
}): boolean {
  const { currentHeight, nextBlockHeight, pageCapacity, placedBlocks, strategy, currentBlock, contract } = payload;
  if (placedBlocks.length < 2) {
    return false;
  }

  const previousPlacedBlock = placedBlocks[placedBlocks.length - 2];
  const lastPlacedBlock = placedBlocks[placedBlocks.length - 1];
  if (
    lastPlacedBlock.block.type === 'pageBreak' ||
    lastPlacedBlock.block.pagination.pageBreakAfter ||
    lastPlacedBlock.block.pagination.keepWithNext ||
    lastPlacedBlock.block.pagination.keepLinesTogether
  ) {
    return false;
  }

  if (
    currentBlock.pagination.pageBreakBefore ||
    currentBlock.pagination.keepWithNext ||
    currentBlock.pagination.keepLinesTogether
  ) {
    return false;
  }

  if (lastPlacedBlock.height + nextBlockHeight > pageCapacity) {
    return false;
  }

  const greedyCurrentFillRatio = currentHeight / pageCapacity;
  const greedyNextFillRatio = nextBlockHeight / pageCapacity;
  if (greedyNextFillRatio >= 0.42) {
    return false;
  }

  const balancedCurrentFillRatio = (currentHeight - lastPlacedBlock.height) / pageCapacity;
  const balancedNextFillRatio = (lastPlacedBlock.height + nextBlockHeight) / pageCapacity;
  if (balancedCurrentFillRatio < 0.34 || balancedNextFillRatio < 0.34) {
    return false;
  }

  const greedyGap = Math.abs(greedyCurrentFillRatio - greedyNextFillRatio);
  const balancedGap = Math.abs(balancedCurrentFillRatio - balancedNextFillRatio);
  if (balancedGap + 0.08 >= greedyGap) {
    return false;
  }

  if (strategy === 'v1') {
    return true;
  }

  // V2 先保护真正依赖“后继块”的页尾锚点，避免把标题这类块留在页尾孤立出来。
  if (previousPlacedBlock && getBlockKeepWithNext(previousPlacedBlock.block, contract)) {
    return false;
  }

  const gapImprovement = greedyGap - balancedGap;
  // 表格和代码块允许参与平衡，但只有在收益足够明显时才值得为了均衡去回收前一块。
  if (
    (currentBlock.type === 'table' || currentBlock.type === 'code') &&
    (balancedNextFillRatio < 0.4 || gapImprovement < 0.12)
  ) {
    return false;
  }

  return true;
}

export function paginateEstimatedBlocks(
  context: PaginationAlgorithmContext,
  options: EstimatedPaginationOptions = {},
): PageLayout[] {
  const { blocks, contract } = context;
  if (blocks.length === 0) {
    return [createEmptyPage(1, contract)];
  }

  const pageCapacity = contract.contentHeightPx;
  const pages: PageLayout[] = [];
  let currentPage = createEmptyPage(1, contract);
  let currentHeight = 0;
  let placedBlocks: PlacedBlockEntry[] = [];
  let shouldPushCurrentPage = true;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    if (block.type === 'pageBreak') {
      const nextIndex = index + 1;
      const nextHasContent = hasRemainingContent(blocks, nextIndex);

      // 手动分页符本身不渲染，只负责把后续内容强制推到下一页。
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

    const blockHeight = estimateBlockHeight(block, contract);
    const keepWithNext = getBlockKeepWithNext(block, contract);
    const nextBlock = keepWithNext ? blocks[index + 1] : null;
    const nextBlockHeight = nextBlock ? estimateBlockHeight(nextBlock, contract) : 0;
    const requiredHeight = keepWithNext ? blockHeight + nextBlockHeight : blockHeight;

    if (isTableBlock(block) && block.metadata.rows.length > 0 && blockHeight > pageCapacity) {
      const rowHeights = block.metadata.rows.map((row, rowIndex) =>
        estimateTableRowHeight(block, row, rowIndex, contract),
      );
      let startRowIndex = 0;
      let fragmentIndex = 1;

      while (startRowIndex < block.metadata.rows.length) {
        const fragment = buildTableFragment({
          block,
          startRowIndex,
          availableHeight: pageCapacity - currentHeight,
          fragmentIndex,
          isCurrentPageEmpty: placedBlocks.length === 0,
          rowHeights,
          contract,
        });

        if (!fragment) {
          if (placedBlocks.length === 0) {
            // 理论上空页至少会强制容纳一行；这里兜底避免异常数据导致分页循环卡住。
            addOversizedWarningsIfNeeded(currentPage, placedBlocks, block, blockHeight, pageCapacity);
            placedBlocks.push({ block, height: blockHeight });
            currentHeight += blockHeight;
            startRowIndex = block.metadata.rows.length;
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

        addOversizedWarningsIfNeeded(
          currentPage,
          placedBlocks,
          fragment.block,
          fragment.height,
          pageCapacity,
        );
        placedBlocks.push({ block: fragment.block, height: fragment.height });
        currentHeight += fragment.height;
        startRowIndex = fragment.nextRowIndex;
        fragmentIndex += 1;
        shouldPushCurrentPage = true;

        if (startRowIndex < block.metadata.rows.length) {
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);
          currentPage = createEmptyPage(pages.length + 1, contract);
          currentHeight = 0;
          placedBlocks = [];
        }
      }

      continue;
    }

    let hasTriedRebalance = false;
    while (placedBlocks.length > 0 && currentHeight + requiredHeight > pageCapacity) {
      const shouldRebalance =
        !!options.rebalanceTrailingBlock &&
        !hasTriedRebalance &&
        !keepWithNext &&
        shouldRebalanceTrailingBlock({
          currentHeight,
          nextBlockHeight: blockHeight,
          pageCapacity,
          placedBlocks,
          strategy: options.rebalanceStrategy ?? 'v1',
          currentBlock: block,
          contract,
        });

      if (shouldRebalance) {
        const movedBlock = placedBlocks.pop();
        hasTriedRebalance = true;

        if (movedBlock) {
          currentHeight -= movedBlock.height;
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          pages.push(currentPage);

          currentPage = createEmptyPage(pages.length + 1, contract);
          placedBlocks = [movedBlock];
          currentHeight = movedBlock.height;
          syncPlacedBlocksToPage(currentPage, placedBlocks);
          addOversizedWarningsIfNeeded(
            currentPage,
            [],
            movedBlock.block,
            movedBlock.height,
            pageCapacity,
          );
          shouldPushCurrentPage = true;
          continue;
        }
      }

      syncPlacedBlocksToPage(currentPage, placedBlocks);
      pages.push(currentPage);
      currentPage = createEmptyPage(pages.length + 1, contract);
      currentHeight = 0;
      placedBlocks = [];
    }

    addOversizedWarningsIfNeeded(currentPage, placedBlocks, block, blockHeight, pageCapacity);
    placedBlocks.push({ block, height: blockHeight });
    currentHeight += blockHeight;
    shouldPushCurrentPage = true;
  }

  syncPlacedBlocksToPage(currentPage, placedBlocks);
  if (placedBlocks.length > 0 || pages.length === 0 || shouldPushCurrentPage) {
    pages.push(currentPage);
  }

  return pages;
}
