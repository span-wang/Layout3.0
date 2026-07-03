import type { LayoutBlock } from '@/engine/document-model';
import type { ResolvedStyleContract } from '@/engine/style/types';
import { DOM_MEASURE_PAGINATION_ALGORITHM_ID, MAX_FILL_PAGINATION_ALGORITHM_ID, OFFSCREEN_MEASURE_PAGINATION_ALGORITHM_ID } from './algorithmIds';
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
  // 多栏时强制使用 max-fill-v1，offscreen-measure-v1 暂不支持多栏
  const isMultiColumn = contract.columnCount > 1;
  const resolvedAlgorithmId =
    isMultiColumn && options.algorithmId === OFFSCREEN_MEASURE_PAGINATION_ALGORITHM_ID
      ? MAX_FILL_PAGINATION_ALGORITHM_ID
      : options.algorithmId === DOM_MEASURE_PAGINATION_ALGORITHM_ID && contract.columnCount > 1
        ? MAX_FILL_PAGINATION_ALGORITHM_ID
        : options.algorithmId;
  const algorithm = resolvePaginationAlgorithm(resolvedAlgorithmId);
  return algorithm.paginate({
    blocks,
    contract,
    styles: options.styles,
    measuredBlockHeights: options.measuredBlockHeights,
    measuredTextLineBreaks: options.measuredTextLineBreaks,
    measuredTextFragmentHeights: options.measuredTextFragmentHeights,
    textFragmentMeasurementJobs: options.textFragmentMeasurementJobs,
    measuredTableRowHeights: options.measuredTableRowHeights,
    tableRowMeasurementJobs: options.tableRowMeasurementJobs,
    optimizationSettings: options.optimizationSettings,
  });
}
