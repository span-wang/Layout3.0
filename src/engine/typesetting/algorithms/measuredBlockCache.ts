import { MEASURED_BLOCK_CACHE_PAGINATION_ALGORITHM_ID } from '../algorithmIds';
import type { PaginationAlgorithmDefinition } from '../types';
import { paginateEstimatedBlocks } from './estimatedCommon';

export const measuredBlockCachePaginationAlgorithm: PaginationAlgorithmDefinition = {
  id: MEASURED_BLOCK_CACHE_PAGINATION_ALGORITHM_ID,
  label: '真实测量块缓存 V1',
  description: '优先使用隐藏 DOM 测得的顶层块高度；未测到的块回退估算高度，并复用块级测量缓存。',
  paginate: (context) => paginateEstimatedBlocks(context),
};
