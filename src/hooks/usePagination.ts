import { useEffect } from 'react';
import {
  MAX_FILL_PAGINATION_ALGORITHM_ID,
  MEASURED_BLOCK_CACHE_PAGINATION_ALGORITHM_ID,
  paginateBlocks,
} from '@/engine/typesetting';
import type { ResolvedStyleContract } from '@/engine/style/types';
import type { MeasuredTextLineBreaks } from '@/engine/typesetting';
import { useAppStore } from '@/store';

export function usePagination(
  resolvedStyleContract: ResolvedStyleContract,
  measuredBlockHeights: Record<string, number> = {},
  measuredTextLineBreaks: MeasuredTextLineBreaks = {},
): void {
  const parseState = useAppStore((state) => state.parseState);
  const layoutBlocks = useAppStore((state) => state.layoutDocument?.blocks ?? null);
  const layoutStyles = useAppStore((state) => state.layoutDocument?.styles ?? null);
  const paginationAlgorithmId = useAppStore((state) => state.styleSettings.paginationAlgorithmId);
  const setPageLayouts = useAppStore((state) => state.setPageLayouts);

  useEffect(() => {
    if (parseState !== 'ready' || !layoutBlocks) {
      if (parseState === 'error') {
        setPageLayouts([]);
      }
      return;
    }

    const shouldUseMeasuredHeights =
      resolvedStyleContract.columnCount === 1 &&
      (paginationAlgorithmId === MEASURED_BLOCK_CACHE_PAGINATION_ALGORITHM_ID ||
        paginationAlgorithmId === MAX_FILL_PAGINATION_ALGORITHM_ID);
    const nextPages = paginateBlocks(layoutBlocks, resolvedStyleContract, {
      algorithmId: paginationAlgorithmId,
      styles: layoutStyles ?? undefined,
      measuredBlockHeights: shouldUseMeasuredHeights ? measuredBlockHeights : undefined,
      measuredTextLineBreaks: shouldUseMeasuredHeights ? measuredTextLineBreaks : undefined,
    });
    setPageLayouts(nextPages);
  }, [layoutBlocks, layoutStyles, measuredBlockHeights, measuredTextLineBreaks, paginationAlgorithmId, parseState, resolvedStyleContract, setPageLayouts]);
}
