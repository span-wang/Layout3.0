import type { LayoutBlock, LayoutTableCell, LayoutTableRow, TableCellRangeSelection } from './types';
import { normalizeTableColumnWidthPx, normalizeTableRowHeightPx } from './utils';
import { measureTextWidth } from '@/engine/font-metrics';
import { estimateTextLines } from '../typesetting/textMetrics';

export interface TableAutoFitCellMetrics {
  fontSizePx: number;
  lineHeightPx: number;
}

export interface ResolveTableAutoFitSizeOptions {
  contentWidthPx: number;
  rowHeightPx: number;
  headerRowHeightPx: number;
  cellPaddingX: number;
  cellPaddingY: number;
  getCellMetrics?: (payload: {
    block: LayoutBlock;
    row: LayoutTableRow;
    cell: LayoutTableCell;
    rowIndex: number;
    columnIndex: number;
  }) => Partial<TableAutoFitCellMetrics>;
}

export interface ResolvedTableAutoFitSize {
  columnWidthsPx: number[];
  rowHeightsPx: number[];
}

function fitResolvedColumnWidthsToContentWidth(
  widths: number[],
  contentWidthPx: number,
  minColumnWidthPx: number,
): number[] {
  if (widths.length === 0) {
    return [];
  }

  const safeMinColumnWidthPx = Math.max(1, Math.floor(minColumnWidthPx));
  const safeContentWidthPx = Math.max(
    safeMinColumnWidthPx * widths.length,
    Math.round(contentWidthPx),
  );
  const currentTotalWidthPx = widths.reduce((total, width) => total + width, 0);
  if (currentTotalWidthPx <= safeContentWidthPx) {
    return widths.map((width) => Math.max(safeMinColumnWidthPx, Math.round(width)));
  }

  const flexibleWidths = widths.map((width) => Math.max(0, width - safeMinColumnWidthPx));
  const flexibleTotalWidthPx = flexibleWidths.reduce((total, width) => total + width, 0);
  const availableFlexibleWidthPx = Math.max(
    0,
    safeContentWidthPx - safeMinColumnWidthPx * widths.length,
  );

  // 显式列宽超出当前正文/栏宽时，也必须重新压回可用宽度；
  // 否则单栏里自动适应过的表格切到双栏后会继续保留旧总宽，把相邻栏内容顶开。
  if (flexibleTotalWidthPx <= 0) {
    const averageWidthPx = safeContentWidthPx / widths.length;
    return widths.map(() => Math.max(safeMinColumnWidthPx, Math.floor(averageWidthPx)));
  }

  const scaledWidths = widths.map((width) => {
    const flexibleWidthPx = Math.max(0, width - safeMinColumnWidthPx);
    return safeMinColumnWidthPx + (flexibleWidthPx / flexibleTotalWidthPx) * availableFlexibleWidthPx;
  });

  const roundedWidths = scaledWidths.map((width) => Math.max(safeMinColumnWidthPx, Math.floor(width)));
  let remainingWidthPx = safeContentWidthPx - roundedWidths.reduce((total, width) => total + width, 0);
  let cursor = 0;
  while (remainingWidthPx > 0) {
    roundedWidths[cursor % roundedWidths.length] += 1;
    remainingWidthPx -= 1;
    cursor += 1;
  }

  return roundedWidths;
}

// 表格列宽和行高的运行时口径统一放在这里，画布、导出和分页都复用同一套结果。
export function resolveTableColumnWidths(
  columnWidthsPx: Array<number | null> | null | undefined,
  columnCount: number,
  contentWidthPx: number,
  fallbackMinWidthPx = 48,
): number[] {
  const safeColumnCount = Math.max(0, Math.floor(columnCount));
  if (safeColumnCount === 0) {
    return [];
  }

  // 当列数很多且没有显式列宽时，最小列宽按正文可用区动态压缩，避免默认表格直接越界。
  const runtimeMinWidthPx = Math.max(1, Math.min(fallbackMinWidthPx, Math.floor(contentWidthPx / safeColumnCount)));

  const normalizedWidths = Array.from({ length: safeColumnCount }, (_, index) =>
    normalizeTableColumnWidthPx(columnWidthsPx?.[index]),
  );
  const explicitWidthTotal = normalizedWidths.reduce<number>((total, width) => total + (width ?? 0), 0);
  const unresolvedIndexes = normalizedWidths
    .map((width, index) => (width === null ? index : -1))
    .filter((index) => index >= 0);

  if (unresolvedIndexes.length === 0) {
    return fitResolvedColumnWidthsToContentWidth(
      normalizedWidths.map((width) => width ?? runtimeMinWidthPx),
      contentWidthPx,
      runtimeMinWidthPx,
    );
  }

  const remainingWidth = contentWidthPx - explicitWidthTotal;
  const minTotalWidth = unresolvedIndexes.length * runtimeMinWidthPx;
  const fillWidth = remainingWidth >= minTotalWidth
    ? remainingWidth / unresolvedIndexes.length
    : runtimeMinWidthPx;
  const floorFillWidth = Math.max(runtimeMinWidthPx, Math.floor(fillWidth));
  let remainingRemainder = Math.max(0, Math.round(remainingWidth - floorFillWidth * unresolvedIndexes.length));

  return fitResolvedColumnWidthsToContentWidth(normalizedWidths.map((width) => {
    if (width !== null) {
      return width;
    }

    const nextWidth = floorFillWidth + (remainingRemainder > 0 ? 1 : 0);
    if (remainingRemainder > 0) {
      remainingRemainder -= 1;
    }
    return nextWidth;
  }), contentWidthPx, runtimeMinWidthPx);
}

export function resolveTableRowHeightPx(
  row: Pick<LayoutTableRow, 'heightPx'>,
  fallbackHeightPx: number,
): number {
  return normalizeTableRowHeightPx(row.heightPx) ?? Math.max(1, Math.round(fallbackHeightPx));
}

export function getTableCellRowSpan(cell: Pick<LayoutTableCell, 'rowSpan'>): number {
  const value = cell.rowSpan ?? 1;
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

export function getTableCellColSpan(cell: Pick<LayoutTableCell, 'colSpan'>): number {
  const value = cell.colSpan ?? 1;
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

export function isCoveredTableCell(cell: Pick<LayoutTableCell, 'coveredByCellId'>): boolean {
  return !!cell.coveredByCellId;
}

export function getRenderableTableCells(row: LayoutTableRow): LayoutTableCell[] {
  return row.cells.filter((cell) => !isCoveredTableCell(cell));
}

function getTablePlainText(cell: LayoutTableCell): string {
  return cell.textRuns.map((run) => run.text).join('');
}

function getCellMetrics(
  payload: {
    block: LayoutBlock;
    row: LayoutTableRow;
    cell: LayoutTableCell;
    rowIndex: number;
    columnIndex: number;
  },
  options: ResolveTableAutoFitSizeOptions,
): TableAutoFitCellMetrics {
  const customMetrics = options.getCellMetrics?.(payload) ?? {};
  const fallbackFontSizePx = Math.max(1, Math.round(options.rowHeightPx * 0.55));

  return {
    fontSizePx: Math.max(1, Math.round(customMetrics.fontSizePx ?? fallbackFontSizePx)),
    lineHeightPx: Math.max(1, Math.round(customMetrics.lineHeightPx ?? options.rowHeightPx)),
  };
}

function estimateSingleLineTextWidthPx(text: string, fontSizePx: number): number {
  const textLines = text.replace(/\r/g, '').split('\n');
  return textLines.reduce((maxWidth, line) => {
    if (!line) {
      return maxWidth;
    }

    return Math.max(maxWidth, Math.ceil(measureTextWidth(line, { fontSize: fontSizePx })));
  }, 0);
}

function roundWidthsToTarget(widths: number[], targetWidthPx: number): number[] {
  if (widths.length === 0) {
    return [];
  }

  const roundedWidths = widths.map((width) => Math.max(1, Math.floor(width)));
  let diff = Math.round(targetWidthPx - roundedWidths.reduce((total, width) => total + width, 0));
  let index = 0;

  while (diff > 0) {
    roundedWidths[index % roundedWidths.length] += 1;
    diff -= 1;
    index += 1;
  }

  return roundedWidths;
}

function fitColumnWidthsToContentWidth(desiredWidths: number[], contentWidthPx: number): number[] {
  const columnCount = desiredWidths.length;
  if (columnCount === 0) {
    return [];
  }

  const minColumnWidthPx = 48;
  const safeContentWidthPx = Math.max(minColumnWidthPx * columnCount, Math.round(contentWidthPx));
  const minWidths = Array.from({ length: columnCount }, () => minColumnWidthPx);
  const desiredTotal = desiredWidths.reduce((total, width) => total + width, 0);

  if (desiredTotal <= safeContentWidthPx) {
    const extraWidthPerColumn = (safeContentWidthPx - desiredTotal) / columnCount;

    // 内容没有撑满正文宽度时，剩余宽度要均衡补给所有列；
    // 否则短词列会卡在最小列宽，少数较宽列反而吃掉大部分页面宽度。
    return roundWidthsToTarget(
      desiredWidths.map((width) => Math.max(minColumnWidthPx, width + extraWidthPerColumn)),
      safeContentWidthPx,
    ).map((width) => normalizeTableColumnWidthPx(width) ?? minColumnWidthPx);
  }

  const flexibleWidths = desiredWidths.map((width) => Math.max(0, width - minColumnWidthPx));
  const flexibleTotal = flexibleWidths.reduce((total, width) => total + width, 0);
  const availableFlexibleWidth = Math.max(0, safeContentWidthPx - minColumnWidthPx * columnCount);

  if (flexibleTotal <= 0) {
    return roundWidthsToTarget(
      Array.from({ length: columnCount }, () => safeContentWidthPx / columnCount),
      safeContentWidthPx,
    ).map((width) => normalizeTableColumnWidthPx(width) ?? minColumnWidthPx);
  }

  // 自动适应始终把列宽压进正文宽度，避免预览、导出和分页估算各自再做二次伸缩。
  const fittedWidths = minWidths.map((minWidth, index) =>
    minWidth + (flexibleWidths[index] / flexibleTotal) * availableFlexibleWidth,
  );

  return roundWidthsToTarget(fittedWidths, safeContentWidthPx)
    .map((width) => normalizeTableColumnWidthPx(width) ?? minColumnWidthPx);
}

function getTableColumnCount(block: LayoutBlock): number {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return 0;
  }

  return block.metadata.rows.reduce(
    (maxColumnCount, row) => Math.max(maxColumnCount, row.cells.length),
    0,
  );
}

export function resolveTableAutoFitSize(
  block: LayoutBlock,
  options: ResolveTableAutoFitSizeOptions,
): ResolvedTableAutoFitSize | null {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return null;
  }

  const columnCount = getTableColumnCount(block);
  if (columnCount <= 0 || block.metadata.rows.length === 0) {
    return null;
  }

  const desiredWidths = Array.from({ length: columnCount }, () => 48);

  block.metadata.rows.forEach((row, rowIndex) => {
    row.cells.forEach((cell, columnIndex) => {
      if (isCoveredTableCell(cell)) {
        return;
      }

      const colSpan = getTableCellColSpan(cell);
      const metrics = getCellMetrics({ block, row, cell, rowIndex, columnIndex }, options);
      const textWidthPx = estimateSingleLineTextWidthPx(getTablePlainText(cell), metrics.fontSizePx);
      const desiredCellWidthPx = Math.max(48, textWidthPx + options.cellPaddingX * 2);
      const widthPerColumn = Math.ceil(desiredCellWidthPx / colSpan);

      for (let offset = 0; offset < colSpan && columnIndex + offset < columnCount; offset += 1) {
        desiredWidths[columnIndex + offset] = Math.max(desiredWidths[columnIndex + offset], widthPerColumn);
      }
    });
  });

  const columnWidthsPx = fitColumnWidthsToContentWidth(desiredWidths, options.contentWidthPx);
  const rowHeightsPx = block.metadata.rows.map((row, rowIndex) => {
    const isHeaderLikeRow = rowIndex === 0 || row.cells.some((cell) => cell.isHeader);
    const fallbackHeightPx = isHeaderLikeRow ? options.headerRowHeightPx : options.rowHeightPx;
    const estimatedContentHeightPx = row.cells.reduce((maxHeight, cell, columnIndex) => {
      if (isCoveredTableCell(cell)) {
        return maxHeight;
      }

      const colSpan = getTableCellColSpan(cell);
      const mergedWidthPx = columnWidthsPx
        .slice(columnIndex, columnIndex + colSpan)
        .reduce((total, width) => total + width, 0);
      const textWidthPx = Math.max(1, mergedWidthPx - options.cellPaddingX * 2);
      const metrics = getCellMetrics({ block, row, cell, rowIndex, columnIndex }, options);
      const text = getTablePlainText(cell);
      const lineCount = text ? estimateTextLines(text, textWidthPx, metrics.fontSizePx) : 1;

      return Math.max(
        maxHeight,
        lineCount * metrics.lineHeightPx + options.cellPaddingY * 2,
      );
    }, 0);

    return resolveTableRowHeightPx(
      { heightPx: Math.max(fallbackHeightPx, estimatedContentHeightPx) },
      fallbackHeightPx,
    );
  });

  return {
    columnWidthsPx,
    rowHeightsPx,
  };
}

export function findTableCellPosition(
  block: LayoutBlock,
  cellId: string,
): { rowIndex: number; columnIndex: number } | null {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return null;
  }

  for (let rowIndex = 0; rowIndex < block.metadata.rows.length; rowIndex += 1) {
    const columnIndex = block.metadata.rows[rowIndex].cells.findIndex((cell) => cell.id === cellId);
    if (columnIndex >= 0) {
      return { rowIndex, columnIndex };
    }
  }

  return null;
}

export function buildTableCellRangeSelection(
  block: LayoutBlock,
  anchorCellId: string,
  focusCellId: string,
): TableCellRangeSelection | null {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return null;
  }

  const anchor = findTableCellPosition(block, anchorCellId);
  const focus = findTableCellPosition(block, focusCellId);
  if (!anchor || !focus) {
    return null;
  }

  const startRowIndex = Math.min(anchor.rowIndex, focus.rowIndex);
  const endRowIndex = Math.max(anchor.rowIndex, focus.rowIndex);
  const startColumnIndex = Math.min(anchor.columnIndex, focus.columnIndex);
  const endColumnIndex = Math.max(anchor.columnIndex, focus.columnIndex);
  const cellIds: string[] = [];

  for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex += 1) {
    const row = block.metadata.rows[rowIndex];
    if (!row) {
      return null;
    }

    for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex += 1) {
      const cell = row.cells[columnIndex];
      if (!cell) {
        return null;
      }

      cellIds.push(cell.id);
    }
  }

  return {
    tableBlockId: block.id,
    anchorCellId,
    focusCellId,
    cellIds,
    startRowIndex,
    endRowIndex,
    startColumnIndex,
    endColumnIndex,
  };
}

export function isSingleCellRangeSelection(selection: TableCellRangeSelection | null | undefined): boolean {
  if (!selection) {
    return true;
  }

  return selection.startRowIndex === selection.endRowIndex && selection.startColumnIndex === selection.endColumnIndex;
}

export function isTableCellInRangeSelection(
  selection: TableCellRangeSelection | null | undefined,
  cellId: string,
): boolean {
  return !!selection?.cellIds.includes(cellId);
}
