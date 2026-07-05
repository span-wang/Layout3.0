/**
 * 表格单元格级分割逻辑
 *
 * 支持：
 * - 按行边界分割（不切割单元格内容）
 * - 单元格内容跨页分割（单格内容跨两页）
 * - 合并单元格识别与保持
 */

import type { LayoutBlock, LayoutTableCell, LayoutTableRow, TableBlockMetadata } from '@/engine/document-model';
import { measureTextLines } from '@/engine/font-metrics';
import { splitTextRuns } from '../offscreenMeasure/preciseTextSplit';

export interface CellSliceResult {
  currentCells: LayoutTableCell[];
  remainingCells: LayoutTableCell[];
}

export interface CellFragmentResult {
  currentCell: LayoutTableCell;
  remainingCell: LayoutTableCell | null;
}

/**
 * 单元格内容分割结果
 */
export interface CellTextSliceResult {
  /** 当前页保留的单元格（带截断的文本） */
  currentCell: LayoutTableCell;
  /** 下一页的单元格（带剩余的文本） */
  remainingCell: LayoutTableCell | null;
  /** 分割点（字符偏移） */
  splitOffset: number;
}

/**
 * 在指定字符偏移量处分割单元格内容
 */
export function splitCellAtOffset(
  cell: LayoutTableCell,
  offset: number,
  suffix: string = 'cell-split'
): CellTextSliceResult | null {
  const cellTextLength = getCellTextLength(cell);
  if (offset <= 0 || offset >= cellTextLength) {
    return null;
  }

  const { currentRuns, remainingRuns } = splitCellTextRuns(cell.textRuns, offset);

  // 构建当前页单元格（带截断文本）
  const currentCell: LayoutTableCell = {
    ...cell,
    id: `${cell.id}-${suffix}-current`,
    textRuns: currentRuns,
    sourceRange: null,
  };

  // 构建下一页单元格（带剩余文本）
  let remainingCell: LayoutTableCell | null = null;
  if (remainingRuns.length > 0) {
    remainingCell = {
      ...cell,
      id: `${cell.id}-${suffix}-remaining`,
      textRuns: remainingRuns,
      sourceRange: null,
      // 合并单元格属性需要保持一致
      rowSpan: cell.rowSpan,
      colSpan: cell.colSpan,
    };
  }

  return {
    currentCell,
    remainingCell,
    splitOffset: offset,
  };
}

/**
 * 根据字符偏移量分割 TextRun 数组
 */
function splitCellTextRuns(
  textRuns: LayoutTableCell['textRuns'],
  offset: number
): { currentRuns: LayoutTableCell['textRuns']; remainingRuns: LayoutTableCell['textRuns'] } {
  const currentRuns: LayoutTableCell['textRuns'] = [];
  const remainingRuns: LayoutTableCell['textRuns'] = [];
  let cursor = 0;

  for (const run of textRuns) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;

    if (runEnd <= offset) {
      currentRuns.push({ ...run });
    } else if (runStart >= offset) {
      remainingRuns.push({ ...run });
    } else {
      // runStart < offset < runEnd
      const localOffset = offset - runStart;
      if (localOffset > 0) {
        currentRuns.push({
          ...run,
          id: `${run.id}-frag`,
          text: run.text.slice(0, localOffset),
          sourceRange: null,
        });
      }
      if (localOffset < run.text.length) {
        remainingRuns.push({
          ...run,
          id: `${run.id}-rest`,
          text: run.text.slice(localOffset),
          sourceRange: null,
        });
      }
    }

    cursor = runEnd;
  }

  return { currentRuns, remainingRuns };
}

/**
 * 获取单元格文本长度
 */
function getCellTextLength(cell: LayoutTableCell): number {
  return cell.textRuns.reduce((len, run) => len + run.text.length, 0);
}

/**
 * 检查单元格是否是合并单元格
 */
export function isMergedCell(cell: LayoutTableCell): boolean {
  return (cell.rowSpan ?? 1) > 1 || (cell.colSpan ?? 1) > 1;
}

/**
 * 获取单元格起始行索引
 */
export function getCellStartRow(cell: LayoutTableCell): number {
  return 0; // 默认从第0行开始
}

/**
 * 获取单元格结束行索引（独占）
 */
export function getCellEndRow(cell: LayoutTableCell): number {
  return (cell.rowSpan ?? 1);
}

/**
 * 创建运行时表格行
 */
export function createRuntimeTableRow(
  row: LayoutTableRow,
  fragmentIndex: number,
  isRepeatedHeader: boolean
): LayoutTableRow {
  const runtimeRowSuffix = isRepeatedHeader
    ? `cell-fragment-${fragmentIndex}-repeat-header`
    : `cell-fragment-${fragmentIndex}`;
  const baseRowId = row.id.replace(/-cell-fragment-\d+(?:-repeat-header)?$/, '');

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

/**
 * 检查行是否是运行时片段行
 */
export function isRuntimeFragmentRow(row: LayoutTableRow): boolean {
  return row.id.includes('cell-fragment-') || row.id.includes('dom-fragment-');
}

/**
 * 单元格级表格行分割
 *
 * @param block 表格块
 * @param rowEndExclusive 分割点（独占）
 * @param fragmentIndex 片段索引
 * @param repeatHeader 是否重复表头
 * @param originalHeaderRow 原始表头行
 */
export function splitTableRowsAtCellIndex(
  block: LayoutBlock,
  rowEndExclusive: number,
  fragmentIndex = 0,
  repeatHeader = true,
  originalHeaderRow?: LayoutTableRow | null
): { currentRows: TableBlockMetadata['rows']; remainingRows: TableBlockMetadata['rows'] } | null {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return null;
  }

  if (rowEndExclusive <= 0 || rowEndExclusive >= block.metadata.rows.length) {
    return null;
  }

  const sourceRows = block.metadata.rows;

  // 当前页的行
  const currentRows = sourceRows
    .slice(0, rowEndExclusive)
    .map((row) => (isRuntimeFragmentRow(row) ? row : createRuntimeTableRow(row, fragmentIndex, false)));

  // 剩余的行
  const remainingSourceRows = sourceRows.slice(rowEndExclusive);

  if (!repeatHeader || remainingSourceRows.length === 0) {
    return {
      currentRows,
      remainingRows: remainingSourceRows,
    };
  }

  // 处理表头重复
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

/**
 * 单元格级表格分割（支持跨页单元格内容分割）
 *
 * @param block 表格块
 * @param currentRows 当前页保留的行
 * @param splitCellInfo 需要分割的单元格信息
 */
export function splitTableCellContent(
  block: LayoutBlock,
  currentRows: LayoutTableRow[],
  splitCellInfo: {
    rowIndex: number;
    cellIndex: number;
    splitOffset: number;
  },
  fragmentSuffix: string
): { updatedCurrentRows: LayoutTableRow[]; remainingRows: LayoutTableRow[] } | null {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return null;
  }

  const { rowIndex, cellIndex, splitOffset } = splitCellInfo;
  const sourceRows = block.metadata.rows;

  // 验证行和单元格索引
  if (rowIndex < 0 || rowIndex >= sourceRows.length) {
    return null;
  }

  const row = sourceRows[rowIndex];
  if (cellIndex < 0 || cellIndex >= row.cells.length) {
    return null;
  }

  const cell = row.cells[cellIndex];

  // 分割单元格内容
  const splitResult = splitCellAtOffset(cell, splitOffset, fragmentSuffix);
  if (!splitResult) {
    return null;
  }

  // 构建更新后的当前行（单元格内容已截断）
  const updatedCurrentRow: LayoutTableRow = {
    ...row,
    id: `${row.id}-cell-split`,
    cells: row.cells.map((c, idx) =>
      idx === cellIndex ? splitResult.currentCell : c
    ),
  };

  // 构建剩余行（第一个单元格内容为剩余文本）
  // 如果单元格有行跨度，需要在后续行中标记该单元格已在上页分割
  const remainingRow: LayoutTableRow = {
    ...row,
    id: `${row.id}-cell-remaining`,
    cells: row.cells.map((c, idx) =>
      idx === cellIndex ? (splitResult.remainingCell ?? c) : c
    ),
  };

  // 复制当前行到当前行数组（替换原行）
  const updatedCurrentRows = [...currentRows];
  updatedCurrentRows[rowIndex] = updatedCurrentRow;

  // 构建剩余行数组（从当前行开始，带分割后的单元格内容）
  const remainingRows: LayoutTableRow[] = [];

  // 如果分割发生在非首行，需要先补上分割前的行
  if (rowIndex > 0) {
    remainingRows.push(...sourceRows.slice(0, rowIndex));
  }

  // 添加带分割单元格内容的行
  remainingRows.push(remainingRow);

  // 添加分割后的剩余行
  remainingRows.push(...sourceRows.slice(rowIndex + 1));

  return {
    updatedCurrentRows,
    remainingRows,
  };
}

/**
 * 通过唯一字体测量接口估算单元格高度。
 */
export function estimateCellHeight(
  cell: LayoutTableCell,
  width: number,
  fontSize: number = 14,
  lineHeight: number = 1.5
): number {
  const text = cell.textRuns.map((run) => run.text).join('');
  const lineCount = measureTextLines(text, width, { fontSize });
  return lineCount * fontSize * lineHeight;
}
