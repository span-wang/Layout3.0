import assert from 'node:assert/strict';
import test from 'node:test';
import type { LayoutBlock, TextRun } from './types';
import {
  unwrapTopLevelColumnSectionById,
  updateColumnSectionAttributes,
  wrapTopLevelBlocksInColumnSectionByIds,
} from './operations';

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

test('局部分栏属性更新会只改 columnSection 元数据', () => {
  const wrapped = wrapTopLevelBlocksInColumnSectionByIds(
    [
      createParagraphBlock('p-1', '第一段'),
      createParagraphBlock('p-2', '第二段'),
    ],
    ['p-1', 'p-2'],
  );
  const columnSection = wrapped.blocks[0];

  assert(columnSection && columnSection.type === 'columnSection' && columnSection.metadata.kind === 'columnSection');

  const updated = updateColumnSectionAttributes(columnSection, {
    columnCount: 3,
    columnGapMm: 12,
    divider: true,
    headingsSpanAll: false,
  });

  assert(updated.type === 'columnSection' && updated.metadata.kind === 'columnSection');
  assert.equal(updated.metadata.columnCount, 3);
  assert.equal(updated.metadata.columnGapMm, 12);
  assert.equal(updated.metadata.divider, true);
  assert.equal(updated.metadata.headingsSpanAll, false);
  assert.deepEqual(
    updated.metadata.blocks.map((block) => block.id),
    ['p-1', 'p-2'],
  );
});

test('解除局部分栏会恢复原始顶层块顺序', () => {
  const wrapped = wrapTopLevelBlocksInColumnSectionByIds(
    [
      createParagraphBlock('p-1', '第一段'),
      createParagraphBlock('p-2', '第二段'),
      createParagraphBlock('p-3', '第三段'),
    ],
    ['p-1', 'p-2'],
  );
  const columnSection = wrapped.blocks[0];

  assert(columnSection && columnSection.type === 'columnSection');

  const result = unwrapTopLevelColumnSectionById(wrapped.blocks, columnSection.id);

  assert.equal(result.didUpdate, true);
  assert.equal(result.unwrappedCount, 2);
  assert.equal(result.selectedNodeId, 'p-1');
  assert.deepEqual(
    result.blocks.map((block) => block.id),
    ['p-1', 'p-2', 'p-3'],
  );
});
