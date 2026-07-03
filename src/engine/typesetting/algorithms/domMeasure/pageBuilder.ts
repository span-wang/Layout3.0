import type { LayoutBlock } from '@/engine/document-model';
import type { ResolvedStyleContract } from '@/engine/style/types';
import type { PageLayout } from '../../types';

export function createDomMeasurePage(pageNumber: number, contract: ResolvedStyleContract): PageLayout {
  return {
    pageNumber,
    blocks: [],
    contract,
    warnings: [],
  };
}

export function cloneRuntimeBlock(
  block: LayoutBlock,
  overrides: Partial<LayoutBlock>,
): LayoutBlock {
  return {
    ...block,
    ...overrides,
  };
}
