import type { LayoutBlock, LayoutStyleSheet } from '@/engine/document-model';
import type { PaginationAlgorithmId, ResolvedStyleContract } from '@/engine/style/types';
import type { PaginationOptimizationSettings } from '@/types/ai';

export type LayoutWarningType = 'oversizedBlock' | 'forcedOverflow';

export interface LayoutWarning {
  pageNumber: number;
  type: LayoutWarningType;
  blockType: LayoutBlock['type'];
  blockLabel: string;
  message: string;
  suggestion: string;
}

export interface PageLayout {
  pageNumber: number;
  blocks: LayoutBlock[];
  contract: ResolvedStyleContract;
  warnings: LayoutWarning[];
}

export type MeasuredTextLineBreaks = Record<string, number[]>;
export type MeasuredTextFragmentHeights = Record<string, number>;
export type MeasuredTableRowHeights = Record<string, number>;
/** 单元格级测量高度缓存 */
export type MeasuredCellHeights = Record<string, number>;
/** 单元格文本片段测量高度缓存 */
export type MeasuredCellFragmentHeights = Record<string, number>;

export interface TextFragmentMeasurementJob {
  id: string;
  block: LayoutBlock;
  sourceBlockId: string;
  startOffset: number;
  endOffset: number;
}

export interface TableRowMeasurementJob {
  id: string;
  block: LayoutBlock;
  sourceBlockId: string;
  rowIds: string[];
}

/** 单元格级测量任务 */
export interface CellMeasurementJob {
  id: string;
  block: LayoutBlock;
  cellId: string;
  cellIndex: number;
  width: number;
  charOffset?: number;
}

export interface PaginationAlgorithmContext {
  blocks: LayoutBlock[];
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredBlockHeights?: Record<string, number>;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights;
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[];
  measuredTableRowHeights?: MeasuredTableRowHeights;
  tableRowMeasurementJobs?: TableRowMeasurementJob[];
  /** 单元格级测量高度缓存 */
  measuredCellHeights?: MeasuredCellHeights;
  /** 单元格文本片段测量高度缓存 */
  measuredCellFragmentHeights?: MeasuredCellFragmentHeights;
  /** 单元格测量任务队列 */
  cellMeasurementJobs?: CellMeasurementJob[];
  optimizationSettings?: PaginationOptimizationSettings | null;
}

export type RebalanceTrailingBlockStrategy = 'v1' | 'v2';

export interface PaginationAlgorithmDefinition {
  id: PaginationAlgorithmId;
  label: string;
  description: string;
  paginate: (context: PaginationAlgorithmContext) => PageLayout[];
}

export interface PaginateBlocksOptions {
  algorithmId?: PaginationAlgorithmId;
  styles?: LayoutStyleSheet;
  measuredBlockHeights?: Record<string, number>;
  measuredTextLineBreaks?: MeasuredTextLineBreaks;
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights;
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[];
  measuredTableRowHeights?: MeasuredTableRowHeights;
  tableRowMeasurementJobs?: TableRowMeasurementJob[];
  /** 单元格级测量高度缓存 */
  measuredCellHeights?: MeasuredCellHeights;
  /** 单元格文本片段测量高度缓存 */
  measuredCellFragmentHeights?: MeasuredCellFragmentHeights;
  /** 单元格测量任务队列 */
  cellMeasurementJobs?: CellMeasurementJob[];
  optimizationSettings?: PaginationOptimizationSettings | null;
}
