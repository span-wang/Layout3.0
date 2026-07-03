/**
 * 单元格级离屏渲染器
 *
 * 使用隐藏 div 容器对表格单元格进行精确测量：
 * - 支持逐单元格独立测量高度
 * - 支持单元格内容跨页分割（测量到指定字符偏移的高度）
 * - 支持跨列/跨行合并单元格的识别
 */

import type { LayoutBlock } from '@/engine/document-model';
import type { CellMeasurementJob } from './types';
import type { LayoutTableCell, LayoutTableRow } from '@/engine/document-model';

// 离屏容器样式常量
const OFFSCREEN_STYLES: Record<string, string> = {
  visibility: 'hidden',
  position: 'absolute',
  pointerEvents: 'none',
  overflow: 'hidden',
  top: '-9999px',
  left: '-9999px',
  whiteSpace: 'pre-wrap',
  wordWrap: 'break-word',
};

/**
 * 创建单元格离屏测量容器
 */
export function createCellOffscreenContainer(): HTMLDivElement {
  const container = document.createElement('div');

  const style = container.style;
  style.visibility = 'hidden';
  style.position = 'absolute';
  style.pointerEvents = 'none';
  style.overflow = 'hidden';
  style.top = '-9999px';
  style.left = '-9999px';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';

  return container;
}

/**
 * 挂载容器到 DOM
 */
export function mountCellOffscreenContainer(container: HTMLDivElement): void {
  if (!container.parentNode) {
    document.body.appendChild(container);
  }
}

/**
 * 卸载容器从 DOM
 */
export function unmountCellOffscreenContainer(container: HTMLDivElement): void {
  if (container.parentNode) {
    container.parentNode.removeChild(container);
  }
  container.innerHTML = '';
}

/**
 * 检查单元格是否是合并单元格的一部分
 */
export function isMergedCell(cell: LayoutTableCell): boolean {
  return (cell.rowSpan ?? 1) > 1 || (cell.colSpan ?? 1) > 1;
}

/**
 * 获取单元格的列跨度（用于计算有效列宽）
 */
export function getCellColSpan(cell: LayoutTableCell, columnCount: number): number {
  return Math.min(cell.colSpan ?? 1, columnCount);
}

/**
 * 获取单元格的有效宽度（考虑列跨度）
 */
export function calculateCellWidth(
  cell: LayoutTableCell,
  columnWidths: number[]
): number {
  let totalWidth = 0;
  const startCol = 0; // 默认从第0列开始
  const span = getCellColSpan(cell, columnWidths.length);

  for (let i = 0; i < span; i++) {
    const colIndex = startCol + i;
    if (colIndex < columnWidths.length) {
      totalWidth += columnWidths[colIndex];
    }
  }

  return totalWidth;
}

/**
 * 获取单元格文本内容
 */
export function getCellText(cell: LayoutTableCell): string {
  return cell.textRuns.map((run) => run.text).join('');
}

/**
 * 获取单元格行跨度（用于计算行高）
 */
export function getCellRowSpan(cell: LayoutTableCell): number {
  return Math.max(1, cell.rowSpan ?? 1);
}

/**
 * 创建单元格内容片段（用于跨页分割测量）
 */
export function createCellFragment(
  cell: LayoutTableCell,
  endOffset: number
): LayoutTableCell {
  // 计算需要截取的 textRuns
  const { currentRuns } = splitTextRunsByOffset(cell.textRuns, endOffset);

  return {
    ...cell,
    id: `${cell.id}-fragment`,
    textRuns: currentRuns,
  };
}

/**
 * 根据字符偏移量分割 TextRun 数组
 */
function splitTextRunsByOffset(
  textRuns: LayoutBlock['textRuns'],
  offset: number
): { currentRuns: LayoutBlock['textRuns']; remainingRuns: LayoutBlock['textRuns'] } {
  const currentRuns: LayoutBlock['textRuns'] = [];
  const remainingRuns: LayoutBlock['textRuns'] = [];
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
 * 渲染单元格到离屏容器
 * 返回渲染后的实际高度
 */
export function renderCellToOffscreen(
  container: HTMLDivElement,
  cell: LayoutTableCell,
  width: number,
  fontSize: number = 14,
  lineHeight: number = 1.5
): { height: number; element: HTMLDivElement } {
  // 设置容器宽度和字体样式
  const style = container.style;
  style.width = `${width}px`;
  style.fontSize = `${fontSize}px`;
  style.lineHeight = `${lineHeight}`;

  // 清空容器
  container.innerHTML = '';

  // 创建单元格元素
  const cellElement = document.createElement('div');
  cellElement.style.width = `${width}px`;
  cellElement.style.boxSizing = 'border-box';
  cellElement.style.padding = '4px 8px';

  // 渲染文本内容
  cellElement.innerHTML = renderCellTextRuns(cell.textRuns);

  // 设置表头样式
  if (cell.isHeader) {
    cellElement.style.fontWeight = 'bold';
    cellElement.style.backgroundColor = '#f5f5f5';
  }

  container.appendChild(cellElement);

  // 强制重绘以获取准确尺寸
  void container.offsetHeight;

  // 获取高度
  const height = container.scrollHeight;

  return { height, element: cellElement };
}

/**
 * 渲染单元格文本片段到离屏容器
 */
export function renderCellFragmentToOffscreen(
  container: HTMLDivElement,
  cell: LayoutTableCell,
  endOffset: number,
  width: number,
  fontSize: number = 14,
  lineHeight: number = 1.5
): { height: number; element: HTMLDivElement } {
  const fragment = createCellFragment(cell, endOffset);
  return renderCellToOffscreen(container, fragment, width, fontSize, lineHeight);
}

/**
 * 渲染 TextRun 数组为 HTML
 */
function renderCellTextRuns(textRuns: LayoutTableCell['textRuns']): string {
  return textRuns
    .map((run) => {
      const styles: string[] = [];

      // 检查 marks 获取样式
      const hasBold = run.marks.some((mark) => mark.type === 'bold');
      const hasItalic = run.marks.some((mark) => mark.type === 'italic');
      const hasUnderline = run.marks.some((mark) => mark.type === 'underline');
      const hasStrike = run.marks.some((mark) => mark.type === 'strike');
      const hasCode = run.marks.some((mark) => mark.type === 'code');

      if (hasBold) styles.push('font-weight: bold');
      if (hasItalic) styles.push('font-style: italic');
      if (hasUnderline) styles.push('text-decoration: underline');
      if (hasStrike) styles.push('text-decoration: line-through');
      if (run.styleOverrides.color) {
        styles.push(`color: ${run.styleOverrides.color}`);
      }
      if (run.styleOverrides.backgroundColor) {
        styles.push(`background-color: ${run.styleOverrides.backgroundColor}`);
      }

      const styleAttr = styles.length > 0 ? ` style="${styles.join(';')}"` : '';
      const classAttr = hasCode ? ' style="font-family: monospace; background: #f5f5f5; padding: 0 2px;"' : '';

      return `<span${styleAttr}${classAttr}>${escapeHtml(run.text)}</span>`;
    })
    .join('');
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 计算行的最大高度（考虑所有单元格）
 */
export function calculateRowHeight(
  row: LayoutTableRow,
  columnWidths: number[],
  measuredCellHeights: Record<string, number>
): number {
  let maxHeight = 0;

  for (const cell of row.cells) {
    const cellHeight = measuredCellHeights[cell.id] ?? 0;
    maxHeight = Math.max(maxHeight, cellHeight);
  }

  return maxHeight;
}

/**
 * 生成单元格测量任务 ID
 */
export function createCellMeasurementJobId(params: {
  blockId: string;
  cellId: string;
  width: number;
  charOffset?: number;
}): string {
  const { blockId, cellId, width, charOffset } = params;
  const widthKey = Math.round(width);
  const offsetPart = charOffset !== undefined ? `:o${charOffset}` : '';
  return `cell:${blockId}:${cellId}:w${widthKey}${offsetPart}`;
}
