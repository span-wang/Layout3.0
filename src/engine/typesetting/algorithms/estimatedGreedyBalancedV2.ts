import { ESTIMATED_GREEDY_BALANCED_V2_PAGINATION_ALGORITHM_ID } from '../algorithmIds';
import type { PaginationAlgorithmDefinition } from '../types';
import { paginateEstimatedBlocks } from './estimatedCommon';

export const estimatedGreedyBalancedV2PaginationAlgorithm: PaginationAlgorithmDefinition = {
  id: ESTIMATED_GREEDY_BALANCED_V2_PAGINATION_ALGORITHM_ID,
  label: '估算平衡 V2',
  description: '在保留估算分页速度的前提下，更保守地回收页尾尾块，减少“当前页刚满、下一页偏空”的情况。',
  paginate: (context) =>
    paginateEstimatedBlocks(context, {
      rebalanceTrailingBlock: true,
      rebalanceStrategy: 'v2',
    }),
};
