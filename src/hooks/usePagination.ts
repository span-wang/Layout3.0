import { useEffect } from 'react';
import { paginateBlocks } from '@/engine/typesetting';
import type { ResolvedStyleContract } from '@/engine/style/types';
import { useAppStore } from '@/store';

export function usePagination(resolvedStyleContract: ResolvedStyleContract): void {
  const parseState = useAppStore((state) => state.parseState);
  const layoutBlocks = useAppStore((state) => state.layoutDocument?.blocks ?? null);
  const paginationAlgorithmId = useAppStore((state) => state.styleSettings.paginationAlgorithmId);
  const setPageLayouts = useAppStore((state) => state.setPageLayouts);

  useEffect(() => {
    if (parseState !== 'ready' || !layoutBlocks) {
      if (parseState === 'error') {
        setPageLayouts([]);
      }
      return;
    }

    const nextPages = paginateBlocks(layoutBlocks, resolvedStyleContract, {
      algorithmId: paginationAlgorithmId,
    });
    setPageLayouts(nextPages);
  }, [layoutBlocks, paginationAlgorithmId, parseState, resolvedStyleContract, setPageLayouts]);
}
