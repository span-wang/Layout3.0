import { ESTIMATED_COST_PAGINATION_ALGORITHM_ID } from '../algorithmIds';
import type { PaginationAlgorithmDefinition } from '../types';
import { paginateEstimatedBlocks } from './estimatedCommon';

export const estimatedCostPaginationAlgorithm: PaginationAlgorithmDefinition = {
  id: ESTIMATED_COST_PAGINATION_ALGORITHM_ID,
  label: '估算代价 V1',
  description: '在现有估算分页基础上比较候选断点代价，优先减少标题挂页尾和下一页过空的情况。',
  paginate: (context) =>
    paginateEstimatedBlocks(context, {
      costBasedBreak: true,
    }),
};
