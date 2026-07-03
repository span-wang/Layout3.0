/**
 * 单元格级测量缓存
 *
 * 管理单元格级测量结果的存取，避免重复测量。
 */

import type { MeasuredCellHeights } from '../../types';

/**
 * 生成单元格测量任务 ID
 */
export function createCellMeasurementId(params: {
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

/**
 * 获取已测量的单元格高度
 */
export function getMeasuredCellHeight(
  cellId: string,
  measuredCellHeights?: MeasuredCellHeights
): number | null {
  if (!measuredCellHeights) {
    return null;
  }
  const measuredHeight = measuredCellHeights[cellId];
  return typeof measuredHeight === 'number' && Number.isFinite(measuredHeight) ? measuredHeight : null;
}

/**
 * 获取单元格文本片段的测量高度
 */
export function getMeasuredCellFragmentHeight(
  fragmentId: string,
  measuredCellFragmentHeights?: Record<string, number>
): number | null {
  if (!measuredCellFragmentHeights) {
    return null;
  }
  const measuredHeight = measuredCellFragmentHeights[fragmentId];
  return typeof measuredHeight === 'number' && Number.isFinite(measuredHeight) ? measuredHeight : null;
}

/**
 * 测量缓存键的解析（用于调试和验证）
 */
export function parseCellMeasurementId(measurementId: string): {
  blockId: string;
  cellId: string;
  width: number;
  charOffset?: number;
} | null {
  const match = measurementId.match(/^cell:([^:]+):([^:]+):w(\d+)(?::o(\d+))?$/);
  if (!match) {
    return null;
  }
  return {
    blockId: match[1],
    cellId: match[2],
    width: parseInt(match[3], 10),
    charOffset: match[4] !== undefined ? parseInt(match[4], 10) : undefined,
  };
}
