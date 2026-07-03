import type { LayoutBlock, LayoutTableRow, TableBlockMetadata } from '@/engine/document-model';

export interface TableRowSliceResult {
  currentRows: TableBlockMetadata['rows'];
  remainingRows: TableBlockMetadata['rows'];
}

function createRuntimeTableRow(row: LayoutTableRow, fragmentIndex: number, isRepeatedHeader: boolean): LayoutTableRow {
  const runtimeRowSuffix = isRepeatedHeader
    ? `dom-fragment-${fragmentIndex}-repeat-header`
    : `dom-fragment-${fragmentIndex}`;
  const baseRowId = row.id.replace(/-dom-fragment-\d+(?:-repeat-header)?$/, '');

  return {
    ...row,
    id: `${baseRowId}-${runtimeRowSuffix}`,
    sourceRange: isRepeatedHeader ? null : row.sourceRange,
    cells: row.cells.map((cell) => ({
      ...cell,
      sourceRange: isRepeatedHeader ? null : cell.sourceRange,
    })),
  };
}

function isRuntimeFragmentRow(row: LayoutTableRow): boolean {
  return row.id.includes('dom-fragment-');
}

// 第二版真实测量表格分页开始补齐续页重复表头，但仍不处理单元格内部跨页。
export function splitTableRowsAtIndex(
  block: LayoutBlock,
  rowEndExclusive: number,
  fragmentIndex = 0,
  repeatHeader = true,
  originalHeaderRow?: LayoutTableRow | null,
): TableRowSliceResult | null {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return null;
  }

  if (rowEndExclusive <= 0 || rowEndExclusive >= block.metadata.rows.length) {
    return null;
  }

  const sourceRows = block.metadata.rows;
  const currentRows = sourceRows
    .slice(0, rowEndExclusive)
    .map((row) => (isRuntimeFragmentRow(row) ? row : createRuntimeTableRow(row, fragmentIndex, false)));
  const remainingSourceRows = sourceRows.slice(rowEndExclusive);

  if (!repeatHeader || remainingSourceRows.length === 0) {
    return {
      currentRows,
      remainingRows: remainingSourceRows,
    };
  }

  const headerRow = originalHeaderRow ?? sourceRows[0];
  const hasHeaderRow = headerRow?.cells.some((cell) => cell.isHeader) ?? false;
  if (!hasHeaderRow || !headerRow) {
    return {
      currentRows,
      remainingRows: remainingSourceRows,
    };
  }

  return {
    currentRows,
    remainingRows: [
      createRuntimeTableRow(headerRow, fragmentIndex + 1, true),
      ...remainingSourceRows,
    ],
  };
}
