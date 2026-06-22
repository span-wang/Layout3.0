import type { ParsedBlock } from '@/engine/parser/types';

export interface PageLayout {
  pageNumber: number;
  blocks: ParsedBlock[];
}

export interface PaginationConfig {
  pageCapacity: number;
}
