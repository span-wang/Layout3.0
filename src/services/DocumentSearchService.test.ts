import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayoutDocumentFromMarkdown, getTextContentFromRuns, type TextRun } from '@/engine/document-model';
import {
  createDocumentSearchReplacementDrafts,
  searchLayoutDocument,
  type DocumentSearchResult,
} from './DocumentSearchService';

function createTextRun(id: string, text: string, color?: string): TextRun {
  return {
    id,
    text,
    sourceRange: null,
    marks: [],
    charStyleRef: null,
    styleOverrides: color ? { color } : {},
    annotations: [],
  };
}

test('PH3-04 当前文档搜索：支持大小写与全字匹配', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    '# Apple apple',
    '',
    'pineapple apple',
  ].join('\n'));

  const caseInsensitiveResults = searchLayoutDocument(document, 'apple', {
    caseSensitive: false,
    wholeWord: true,
  });
  assert.equal(caseInsensitiveResults.length, 3, '不区分大小写时应命中标题两个词和段落独立词。');

  const caseSensitiveResults = searchLayoutDocument(document, 'Apple', {
    caseSensitive: true,
    wholeWord: true,
  });
  assert.equal(caseSensitiveResults.length, 1, '区分大小写时只应命中首字母大写的 Apple。');
  assert.equal(caseSensitiveResults[0]?.kindLabel, '标题');
});

test('PH3-04 搜索替换：跨 TextRun 命中时保留未替换片段样式', () => {
  const textRuns = [
    createTextRun('run-1', '重点', '#dc2626'),
    createTextRun('run-2', '内容'),
  ];
  const result: DocumentSearchResult = {
    id: 'node-1-1-3-0',
    nodeId: 'node-1',
    ownerBlockId: 'node-1',
    kindLabel: '段落',
    text: '重点内容',
    matchText: '点内',
    matchStart: 1,
    matchEnd: 3,
    previewBefore: '重',
    previewAfter: '容',
    replacementMode: 'richText',
    textRuns,
  };

  const [draft] = createDocumentSearchReplacementDrafts([result], '新');
  assert(draft?.textRuns, '富文本节点应产出 TextRun 替换草稿。');
  assert.equal(getTextContentFromRuns(draft.textRuns), '重新容');
  assert.equal(draft.textRuns[0]?.styleOverrides.color, '#dc2626', '替换文字应继承命中起点样式。');
  assert.deepEqual(draft.textRuns[1]?.styleOverrides, {}, '未命中的后续文字应保留原有普通样式。');
});
