import { useEffect, useMemo } from 'react';
import { getRenderableLayoutBlocksForView } from '@/engine/document-model';
import {
  DOM_MEASURE_PAGINATION_ALGORITHM_ID,
  MAX_FILL_PAGINATION_ALGORITHM_ID,
  paginateBlocks,
} from '@/engine/typesetting';
import type { ResolvedStyleContract } from '@/engine/style/types';
import { applyQuickBlockStyleRulesToBlocks } from '@/engine/style/quickBlockStyle';
import type {
  MeasuredTableRowHeights,
  MeasuredTextFragmentHeights,
  MeasuredTextLineBreaks,
  TableRowMeasurementJob,
  TextFragmentMeasurementJob,
} from '@/engine/typesetting';
import { useAppStore } from '@/store';

export function usePagination(
  resolvedStyleContract: ResolvedStyleContract,
  measuredBlockHeights: Record<string, number> = {},
  measuredTextLineBreaks: MeasuredTextLineBreaks = {},
  measuredTextFragmentHeights: MeasuredTextFragmentHeights = {},
  measuredTableRowHeights: MeasuredTableRowHeights = {},
  onTextFragmentMeasurementJobsChange?: (jobs: TextFragmentMeasurementJob[]) => void,
  onTableRowMeasurementJobsChange?: (jobs: TableRowMeasurementJob[]) => void,
): void {
  const parseState = useAppStore((state) => state.parseState);
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const layoutStyles = useAppStore((state) => state.layoutDocument?.styles ?? null);
  const paginationAlgorithmId = useAppStore((state) => state.styleSettings.paginationAlgorithmId);
  const paginationOptimizationSettings = useAppStore((state) => state.paginationOptimizationSettings);
  const setPageLayouts = useAppStore((state) => state.setPageLayouts);
  // 答案隐藏/文末统一会派生新的视图块数组；缓存到文档变化时再更新，避免分页写回后立刻再次触发分页。
  const layoutBlocks = useMemo(
    () => applyQuickBlockStyleRulesToBlocks(getRenderableLayoutBlocksForView(layoutDocument), layoutStyles),
    [layoutDocument, layoutStyles],
  );

  useEffect(() => {
    if (parseState !== 'ready' || !layoutDocument) {
      if (parseState === 'error') {
        setPageLayouts([]);
      }
      return;
    }

    const shouldUseMeasuredHeights =
      paginationAlgorithmId === MAX_FILL_PAGINATION_ALGORITHM_ID ||
      paginationAlgorithmId === DOM_MEASURE_PAGINATION_ALGORITHM_ID;
    const shouldUseFragmentMeasurements =
      paginationAlgorithmId === MAX_FILL_PAGINATION_ALGORITHM_ID ||
      paginationAlgorithmId === DOM_MEASURE_PAGINATION_ALGORITHM_ID;
    const nextTextFragmentMeasurementJobs: TextFragmentMeasurementJob[] = [];
    const nextTableRowMeasurementJobs: TableRowMeasurementJob[] = [];
    const nextPages = paginateBlocks(layoutBlocks, resolvedStyleContract, {
      algorithmId: paginationAlgorithmId,
      styles: layoutStyles ?? undefined,
      measuredBlockHeights: shouldUseMeasuredHeights ? measuredBlockHeights : undefined,
      measuredTextLineBreaks: shouldUseMeasuredHeights ? measuredTextLineBreaks : undefined,
      measuredTextFragmentHeights:
        shouldUseFragmentMeasurements
          ? measuredTextFragmentHeights
          : undefined,
      textFragmentMeasurementJobs:
        shouldUseFragmentMeasurements
          ? nextTextFragmentMeasurementJobs
          : undefined,
      measuredTableRowHeights:
        shouldUseFragmentMeasurements
          ? measuredTableRowHeights
          : undefined,
      tableRowMeasurementJobs:
        shouldUseFragmentMeasurements
          ? nextTableRowMeasurementJobs
          : undefined,
      optimizationSettings: paginationOptimizationSettings,
    });
    onTextFragmentMeasurementJobsChange?.(
      shouldUseFragmentMeasurements
        ? nextTextFragmentMeasurementJobs
        : [],
    );
    onTableRowMeasurementJobsChange?.(
      shouldUseFragmentMeasurements
        ? nextTableRowMeasurementJobs
        : [],
    );
    setPageLayouts(nextPages);
  }, [layoutBlocks, layoutDocument, layoutStyles, measuredBlockHeights, measuredTableRowHeights, measuredTextFragmentHeights, measuredTextLineBreaks, onTableRowMeasurementJobsChange, onTextFragmentMeasurementJobsChange, paginationAlgorithmId, paginationOptimizationSettings, parseState, resolvedStyleContract, setPageLayouts]);
}
