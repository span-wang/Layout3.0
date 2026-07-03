/**
 * 单元格级精确测量类型定义
 *
 * 本模块定义 cell-measure-v2 专用的类型，与 domMeasure、offscreenMeasure 隔离。
 */

import type { LayoutBlock } from '@/engine/document-model';
import type { PageLayout, PaginationAlgorithmContext } from '../../types';

/**
 * 单元格级测量上下文
 */
export interface CellMeasurePaginationContext extends PaginationAlgorithmContext {
  /** 离屏测量容器引用（由前端注入） */
  offscreenContainer?: HTMLElement | null;
}

/**
 * 单元格级测量结果
 */
export interface CellMeasurementResult {
  measurementId: string;
  cellId: string;
  height: number;
  /** 行级分割点（字符索引数组） */
  lineBreaks?: number[];
}

/**
 * 单元格级测量任务
 */
export interface CellMeasurementJob {
  id: string;
  block: LayoutBlock;
  cellId: string;
  cellIndex: number;
  width: number;
  /** 0 表示测量完整单元格高度，正数表示测量到指定字符偏移的高度 */
  charOffset?: number;
}

/**
 * 单元格级测量分页结果
 */
export interface CellMeasurePaginationResult {
  pages: PageLayout[];
  measurementJobs: CellMeasurementJob[];
  measuredCellHeights: Record<string, number>;
}
