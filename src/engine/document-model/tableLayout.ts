import type { LayoutBlock, LayoutTableCell, LayoutTableRow, TableCellRangeSelection } from './types';
import { normalizeTableColumnWidthPx, normalizeTableRowHeightPx } from './utils';

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
    return normalizedWidths.map((width) => width ?? runtimeMinWidthPx);
  }

  const remainingWidth = contentWidthPx - explicitWidthTotal;
  const minTotalWidth = unresolvedIndexes.length * runtimeMinWidthPx;
  const fillWidth = remainingWidth >= minTotalWidth
    ? remainingWidth / unresolvedIndexes.length
    : runtimeMinWidthPx;
  const floorFillWidth = Math.max(runtimeMinWidthPx, Math.floor(fillWidth));
  let remainingRemainder = Math.max(0, Math.round(remainingWidth - floorFillWidth * unresolvedIndexes.length));

  return normalizedWidths.map((width) => {
    if (width !== null) {
      return width;
    }

    const nextWidth = floorFillWidth + (remainingRemainder > 0 ? 1 : 0);
    if (remainingRemainder > 0) {
      remainingRemainder -= 1;
    }
    return nextWidth;
  });
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
