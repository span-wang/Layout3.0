import type { LayoutBlock } from '@/engine/document-model';
import type {
  MeasuredTableRowHeights,
  MeasuredTextFragmentHeights,
  TableRowMeasurementJob,
  TextFragmentMeasurementJob,
} from '../../types';

// 真实测量引擎先复用现有顶层块测量结果；后续片段级测量会继续沿这个缓存接口扩展。
export function getMeasuredBlockHeight(
  block: LayoutBlock,
  measuredBlockHeights?: Record<string, number>,
): number | null {
  if (!measuredBlockHeights) {
    return null;
  }

  const measuredHeight = measuredBlockHeights[block.id];
  return typeof measuredHeight === 'number' && Number.isFinite(measuredHeight) ? measuredHeight : null;
}

export function createTextFragmentMeasurementId(params: {
  blockId: string;
  startOffset: number;
  endOffset: number;
  widthPx: number;
}): string {
  const widthKey = Math.round(params.widthPx);
  return `${params.blockId}:text:${params.startOffset}-${params.endOffset}:w${widthKey}`;
}

export function getMeasuredTextFragmentHeight(
  fragmentId: string,
  measuredTextFragmentHeights?: MeasuredTextFragmentHeights,
): number | null {
  const measuredHeight = measuredTextFragmentHeights?.[fragmentId];
  return typeof measuredHeight === 'number' && Number.isFinite(measuredHeight) ? measuredHeight : null;
}

export function enqueueTextFragmentMeasurementJob(
  jobs: TextFragmentMeasurementJob[] | undefined,
  job: TextFragmentMeasurementJob,
): void {
  if (!jobs || jobs.some((item) => item.id === job.id)) {
    return;
  }

  jobs.push(job);
}

export function createTableRowMeasurementId(params: {
  blockId: string;
  rowIds: string[];
  widthPx: number;
}): string {
  const widthKey = Math.round(params.widthPx);
  return `${params.blockId}:rows:${params.rowIds.join('|')}:w${widthKey}`;
}

export function getMeasuredTableRowHeight(
  rowId: string,
  measuredTableRowHeights?: MeasuredTableRowHeights,
): number | null {
  const measuredHeight = measuredTableRowHeights?.[rowId];
  return typeof measuredHeight === 'number' && Number.isFinite(measuredHeight) ? measuredHeight : null;
}

export function enqueueTableRowMeasurementJob(
  jobs: TableRowMeasurementJob[] | undefined,
  job: TableRowMeasurementJob,
): void {
  if (!jobs || jobs.some((item) => item.id === job.id)) {
    return;
  }

  jobs.push(job);
}
