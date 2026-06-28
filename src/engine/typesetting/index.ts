import type { LayoutBlock } from '@/engine/document-model';
import type { ResolvedStyleContract } from '@/engine/style/types';
import { resolvePaginationAlgorithm } from './registry';
import type { PageLayout, PaginateBlocksOptions } from './types';

export * from './algorithmIds';
export * from './registry';
export * from './types';
export * from './textMetrics';

export function paginateBlocks(
  blocks: LayoutBlock[],
  contract: ResolvedStyleContract,
  options: PaginateBlocksOptions = {},
): PageLayout[] {
  const algorithm = resolvePaginationAlgorithm(options.algorithmId);
  return algorithm.paginate({
    blocks,
    contract,
    styles: options.styles,
    measuredBlockHeights: options.measuredBlockHeights,
    measuredTextLineBreaks: options.measuredTextLineBreaks,
  });
}
