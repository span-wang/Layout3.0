// 把算法 ID 单独收口，避免样式设置、分页引擎和冒烟脚本各自硬编码一份字符串。
export const ESTIMATED_GREEDY_PAGINATION_ALGORITHM_ID = 'estimated-greedy-v1';
export const ESTIMATED_GREEDY_BALANCED_PAGINATION_ALGORITHM_ID = 'estimated-greedy-balance-v1';
export const ESTIMATED_GREEDY_BALANCED_V2_PAGINATION_ALGORITHM_ID = 'estimated-greedy-balance-v2';
export const ESTIMATED_COST_PAGINATION_ALGORITHM_ID = 'estimated-cost-v1';
export const MAX_FILL_PAGINATION_ALGORITHM_ID = 'max-fill-v1';
export const MEASURED_BLOCK_CACHE_PAGINATION_ALGORITHM_ID = 'measured-block-cache-v1';

export const DEFAULT_PAGINATION_ALGORITHM_ID = ESTIMATED_GREEDY_PAGINATION_ALGORITHM_ID;
