import { useMemo } from 'react';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import { useAppStore } from '@/store';

export function useResolvedStyleContract() {
  const styleSettings = useAppStore((state) => state.styleSettings);

  return useMemo(() => resolveStyleContract(styleSettings), [styleSettings]);
}
