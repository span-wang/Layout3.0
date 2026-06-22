import type { PreviewBlock } from '@/types/workspace';

export function parsePreviewBlocks(source: string): PreviewBlock[] {
  return source
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map<PreviewBlock>((block) => {
      if (block.startsWith('# ')) {
        return {
          type: 'heading',
          text: block.replace(/^#\s+/, ''),
        };
      }

      const lines = block.split('\n');
      const isListBlock = lines.every((line) => line.startsWith('- '));

      if (isListBlock) {
        return {
          type: 'list',
          items: lines.map((line) => line.replace(/^-\s+/, '')),
        };
      }

      return {
        type: 'paragraph',
        text: block,
      };
    });
}
