import type { LayoutBlock } from '@/engine/document-model';
import type { PageLayout, PaginationAlgorithmContext } from '../../types';

export interface DomMeasurePaginationContext extends PaginationAlgorithmContext {
  blocks: LayoutBlock[];
}

export interface DomMeasurePaginationResult {
  pages: PageLayout[];
}
