// 把算法 ID 单独收口，避免样式设置、分页引擎和冒烟脚本各自硬编码一份字符串。
export const MAX_FILL_PAGINATION_ALGORITHM_ID = 'max-fill-v1';
export const DOM_MEASURE_PAGINATION_ALGORITHM_ID = 'dom-measure-v1';
export const OFFSCREEN_MEASURE_PAGINATION_ALGORITHM_ID = 'offscreen-measure-v1';
export const CELL_MEASURE_PAGINATION_ALGORITHM_ID = 'cell-measure-v2';

export const DEFAULT_PAGINATION_ALGORITHM_ID = MAX_FILL_PAGINATION_ALGORITHM_ID;
