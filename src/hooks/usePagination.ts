import { useEffect } from 'react';
import { paginateBlocks } from '@/engine/typesetting';
import { useAppStore } from '@/store';

export function usePagination(): void {
  const parseState = useAppStore((state) => state.parseState);
  const parseResult = useAppStore((state) => state.parseResult);
  const setPageLayouts = useAppStore((state) => state.setPageLayouts);

  useEffect(() => {
    if (parseState !== 'ready' || !parseResult) {
      if (parseState === 'error') {
        setPageLayouts([]);
      }
      return;
    }

    const nextPages = paginateBlocks(parseResult.blocks);
    setPageLayouts(nextPages);
  }, [parseResult, parseState, setPageLayouts]);
}
