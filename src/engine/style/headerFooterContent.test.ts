import assert from 'node:assert/strict';
import test from 'node:test';
import type { LayoutBlock, TextRun } from '@/engine/document-model';
import { buildHeaderFooterPageTitles } from './headerFooterContent';

function createTextRun(id: string, text: string): TextRun {
  return {
    id,
    text,
    sourceRange: null,
    marks: [],
    charStyleRef: null,
    styleOverrides: {},
    annotations: [],
  };
}

function createParagraphBlock(id: string, text: string): LayoutBlock {
  return {
    id,
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [createTextRun(`${id}-run`, text)],
    pagination: {},
    metadata: {
      kind: 'paragraph',
      text,
    },
  };
}

function createHeadingBlock(id: string, depth: 1 | 2 | 3 | 4 | 5 | 6, text: string): LayoutBlock {
  return {
    id,
    type: 'heading',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [createTextRun(`${id}-run`, text)],
    pagination: {},
    metadata: {
      kind: 'heading',
      depth,
      text,
    },
  };
}

test('PH2-18A 页眉页脚默认标题：只识别一级标题并向前继承最近 H1', () => {
  const pageTitles = buildHeaderFooterPageTitles(
    [
      { blocks: [createParagraphBlock('page-1-paragraph', '首页正文')] },
      { blocks: [createHeadingBlock('page-2-h2', 2, '二级标题不应进入默认页眉')] },
      { blocks: [createHeadingBlock('page-3-h1', 1, '第一章')] },
      { blocks: [createParagraphBlock('page-4-paragraph', '继续第一章正文')] },
      { blocks: [createHeadingBlock('page-5-h1', 1, '第二章')] },
    ],
    '文档标题',
  );

  assert.deepEqual(pageTitles, ['文档标题', '文档标题', '第一章', '第一章', '第二章']);
});

test('PH2-18A 页眉页脚默认标题：一级标题使用纯文字内容并忽略空白', () => {
  const pageTitles = buildHeaderFooterPageTitles(
    [
      { blocks: [createHeadingBlock('page-1-h1', 1, '  第一章总览  ')] },
      { blocks: [createHeadingBlock('page-2-h1', 1, '   '), createParagraphBlock('page-2-paragraph', '空标题不应覆盖上一章')] },
    ],
    '文档标题',
  );

  assert.deepEqual(pageTitles, ['第一章总览', '第一章总览']);
});
