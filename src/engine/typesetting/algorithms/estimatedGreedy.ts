import { ESTIMATED_GREEDY_PAGINATION_ALGORITHM_ID } from '../algorithmIds';
import type { PaginationAlgorithmDefinition } from '../types';
import { paginateEstimatedBlocks } from './estimatedCommon';

export const estimatedGreedyPaginationAlgorithm: PaginationAlgorithmDefinition = {
  id: ESTIMATED_GREEDY_PAGINATION_ALGORITHM_ID,
  label: '估算紧凑 V1',
  description: '沿用当前逐块估算分页策略，优先把当前页尽量排满。',
  paginate: (context) => paginateEstimatedBlocks(context),
};
