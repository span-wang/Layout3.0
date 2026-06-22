import rehypeStringify from 'rehype-stringify';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

export function createRemarkToRehypeProcessor() {
  return unified().use(remarkRehype);
}

export function createHtmlStringifyProcessor() {
  return unified().use(rehypeStringify);
}
