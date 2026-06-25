import type { PaginationAlgorithmId } from '@/engine/style/types';
import { DEFAULT_PAGINATION_ALGORITHM_ID } from './algorithmIds';
import { estimatedCostPaginationAlgorithm } from './algorithms/estimatedCost';
import { estimatedGreedyBalancedPaginationAlgorithm } from './algorithms/estimatedGreedyBalanced';
import { estimatedGreedyBalancedV2PaginationAlgorithm } from './algorithms/estimatedGreedyBalancedV2';
import { estimatedGreedyPaginationAlgorithm } from './algorithms/estimatedGreedy';
import type { PaginationAlgorithmDefinition } from './types';

const paginationAlgorithms = new Map<PaginationAlgorithmId, PaginationAlgorithmDefinition>();

function seedBuiltinPaginationAlgorithms(): void {
  [
    estimatedGreedyPaginationAlgorithm,
    estimatedGreedyBalancedPaginationAlgorithm,
    estimatedGreedyBalancedV2PaginationAlgorithm,
    estimatedCostPaginationAlgorithm,
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
