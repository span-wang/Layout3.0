import type { ParsedBlock } from '@/engine/parser/types';
import type { PageLayout, PaginationConfig } from './types';

const defaultPaginationConfig: PaginationConfig = {
  pageCapacity: 700,
};

function estimateBlockHeight(block: ParsedBlock): number {
  switch (block.type) {
    case 'heading':
      return block.depth === 1 ? 120 : block.depth === 2 ? 88 : 76;
    case 'paragraph': {
      const lines = Math.max(1, Math.ceil(block.text.length / 34));
      return 32 + lines * 28;
    }
    case 'list': {
      const itemHeights = block.items.reduce((total, item) => {
        const lines = Math.max(1, Math.ceil(item.length / 32));
        return total + lines * 28;
      }, 0);
      return 28 + itemHeights;
    }
    case 'blockquote':
      return (
        36 +
        block.blocks.reduce((total, nestedBlock) => total + estimateBlockHeight(nestedBlock), 0)
      );
    case 'code': {
      const lines = Math.max(1, block.value.split('\n').length);
      return 52 + lines * 24;
    }
    case 'table':
      return 40 + block.rows.length * 44;
    case 'horizontalRule':
      return 36;
    default:
      return 48;
  }
}

export function paginateBlocks(
  blocks: ParsedBlock[],
  config: PaginationConfig = defaultPaginationConfig,
): PageLayout[] {
  if (blocks.length === 0) {
    return [
      {
        pageNumber: 1,
        blocks: [],
      },
    ];
  }

  const pages: PageLayout[] = [];
  let currentPage: PageLayout = {
    pageNumber: 1,
    blocks: [],
  };
  let currentHeight = 0;

  for (const block of blocks) {
    const blockHeight = estimateBlockHeight(block);
    const wouldOverflow =
      currentPage.blocks.length > 0 && currentHeight + blockHeight > config.pageCapacity;

    if (wouldOverflow) {
      pages.push(currentPage);
      currentPage = {
        pageNumber: pages.length + 1,
        blocks: [],
      };
      currentHeight = 0;
    }

    currentPage.blocks.push(block);
    currentHeight += blockHeight;
  }

  pages.push(currentPage);
  return pages;
}
