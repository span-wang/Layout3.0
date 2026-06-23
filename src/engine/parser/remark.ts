import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export function createRemarkProcessor() {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath);
}
