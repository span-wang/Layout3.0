import { ESTIMATED_GREEDY_BALANCED_PAGINATION_ALGORITHM_ID } from '../algorithmIds';
import type { PaginationAlgorithmDefinition } from '../types';
import { paginateEstimatedBlocks } from './estimatedCommon';

export const estimatedGreedyBalancedPaginationAlgorithm: PaginationAlgorithmDefinition = {
  id: ESTIMATED_GREEDY_BALANCED_PAGINATION_ALGORITHM_ID,
  label: '估算平衡 V1',
  description: '在页尾溢出临界点尝试回收最后一块到下一页，减少下一页过空的情况。',
  paginate: (context) =>
    paginateEstimatedBlocks(context, {
      rebalanceTrailingBlock: true,
    }),
};
