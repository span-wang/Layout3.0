import type { PaginationAlgorithmId } from '@/engine/style/types';
import { DEFAULT_PAGINATION_ALGORITHM_ID, MAX_FILL_PAGINATION_ALGORITHM_ID } from './algorithmIds';
import { domMeasurePaginationAlgorithm } from './algorithms/domMeasure';
import { estimatedMaxFillPaginationAlgorithm, paginateMaxFillBlocks } from './algorithms/estimatedMaxFill';
import { offscreenMeasurePaginationAlgorithm } from './algorithms/offscreenMeasure';
import { cellMeasurePaginationAlgorithm } from './algorithms/cellMeasure';
import type { PaginationAlgorithmDefinition } from './types';

const paginationAlgorithms = new Map<PaginationAlgorithmId, PaginationAlgorithmDefinition>();

function seedBuiltinPaginationAlgorithms(): void {
  [
    estimatedMaxFillPaginationAlgorithm,
    domMeasurePaginationAlgorithm,
    offscreenMeasurePaginationAlgorithm,
    cellMeasurePaginationAlgorithm,
  ].forEach((algorithm) => {
    paginationAlgorithms.set(algorithm.id, algorithm);
  });
}

seedBuiltinPaginationAlgorithms();

export function registerPaginationAlgorithm(
  algorithm: PaginationAlgorithmDefinition,
  options: { overwrite?: boolean } = {},
): void {
  if (!options.overwrite && paginationAlgorithms.has(algorithm.id)) {
    throw new Error(`分页算法已存在：${algorithm.id}`);
  }

  paginationAlgorithms.set(algorithm.id, algorithm);
}

// 导出分页测试算法1的分页函数供外部使用
export { paginateMaxFillBlocks };

export function listPaginationAlgorithms(): PaginationAlgorithmDefinition[] {
  return Array.from(paginationAlgorithms.values());
}

export function resolvePaginationAlgorithm(
  algorithmId?: PaginationAlgorithmId,
): PaginationAlgorithmDefinition {
  const fallbackAlgorithm = paginationAlgorithms.get(DEFAULT_PAGINATION_ALGORITHM_ID);
  if (!fallbackAlgorithm) {
    throw new Error(`默认分页算法未注册：${DEFAULT_PAGINATION_ALGORITHM_ID}`);
  }

  if (!algorithmId) {
    return fallbackAlgorithm;
  }

  return paginationAlgorithms.get(algorithmId) ?? fallbackAlgorithm;
}
