import { useEffect } from 'react';
import {
  DOM_MEASURE_PAGINATION_ALGORITHM_ID,
  MAX_FILL_PAGINATION_ALGORITHM_ID,
  paginateBlocks,
} from '@/engine/typesetting';
import type { ResolvedStyleContract } from '@/engine/style/types';
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
  const layoutBlocks = useAppStore((state) => state.layoutDocument?.blocks ?? null);
  const layoutStyles = useAppStore((state) => state.layoutDocument?.styles ?? null);
  const paginationAlgorithmId = useAppStore((state) => state.styleSettings.paginationAlgorithmId);
  const paginationOptimizationSettings = useAppStore((state) => state.paginationOptimizationSettings);
  const setPageLayouts = useAppStore((state) => state.setPageLayouts);

  useEffect(() => {
    if (parseState !== 'ready' || !layoutBlocks) {
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
  }, [layoutBlocks, layoutStyles, measuredBlockHeights, measuredTableRowHeights, measuredTextFragmentHeights, measuredTextLineBreaks, onTableRowMeasurementJobsChange, onTextFragmentMeasurementJobsChange, paginationAlgorithmId, paginationOptimizationSettings, parseState, resolvedStyleContract, setPageLayouts]);
}
