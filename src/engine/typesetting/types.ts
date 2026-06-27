import type { LayoutBlock, LayoutStyleSheet } from '@/engine/document-model';
import type { PaginationAlgorithmId, ResolvedStyleContract } from '@/engine/style/types';

export type LayoutWarningType = 'oversizedBlock' | 'forcedOverflow';

export interface LayoutWarning {
  pageNumber: number;
  type: LayoutWarningType;
  blockType: LayoutBlock['type'];
  blockLabel: string;
  message: string;
  suggestion: string;
}

export interface PageLayout {
  pageNumber: number;
  blocks: LayoutBlock[];
  contract: ResolvedStyleContract;
  warnings: LayoutWarning[];
}

export interface PaginationAlgorithmContext {
  blocks: LayoutBlock[];
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  measuredBlockHeights?: Record<string, number>;
}

export type RebalanceTrailingBlockStrategy = 'v1' | 'v2';

export interface PaginationAlgorithmDefinition {
  id: PaginationAlgorithmId;
  label: string;
  description: string;
  paginate: (context: PaginationAlgorithmContext) => PageLayout[];
}

export interface PaginateBlocksOptions {
  algorithmId?: PaginationAlgorithmId;
  styles?: LayoutStyleSheet;
  measuredBlockHeights?: Record<string, number>;
}
