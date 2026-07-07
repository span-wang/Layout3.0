import assert from 'node:assert/strict';
import test from 'node:test';
import {
  wrapTopLevelBlocksInColumnSectionByIds,
  type LayoutBlock,
  type TextRun,
} from '@/engine/document-model';
import {
  createDeterministicFontMetricsProvider,
  resetFontMetricsProvider,
  setFontMetricsProvider,
} from '@/engine/font-metrics';
import { defaultStyleSettings } from '@/engine/style/presets';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import { clearAllBlockHeightCache, paginateMaxFillBlocks } from './estimatedMaxFill';

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

function createColumnSectionBlock(id: string, blocks: LayoutBlock[]): LayoutBlock {
  return {
    id,
    type: 'columnSection',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'columnSection',
      columnCount: 2,
      columnGapMm: 8,
      divider: false,
      headingsSpanAll: true,
      blocks,
    },
  };
}

function withTestPageMetrics<T extends { contentHeightPx: number; contentWidthPx: number }>(
  contract: T & { columnCount?: number; columnGapPx?: number },
): T & { columnPageCapacityPx: number; singleColumnContentWidthPx: number } {
  const columnCount = Math.max(1, contract.columnCount ?? 1);
  const columnGapPx = columnCount > 1 ? Math.max(0, contract.columnGapPx ?? 0) : 0;
  return {
    ...contract,
    singleColumnContentWidthPx:
      columnCount > 1
        ? (contract.contentWidthPx - (columnCount - 1) * columnGapPx) / columnCount
        : contract.contentWidthPx,
    columnPageCapacityPx: contract.contentHeightPx * columnCount,
  };
}

test('局部分栏包装会把连续顶层块收进 columnSection 容器', () => {
  const blocks = [
    createParagraphBlock('p-1', '第一段'),
    createParagraphBlock('p-2', '第二段'),
    createParagraphBlock('p-3', '第三段'),
  ];

  const result = wrapTopLevelBlocksInColumnSectionByIds(blocks, ['p-1', 'p-2']);

  assert.equal(result.didUpdate, true);
  assert.equal(result.reason, 'wrapped');
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0]?.type, 'columnSection');
  assert.equal(result.selectedNodeId, result.blocks[0]?.id ?? null);

  const columnSection = result.blocks[0];
  assert(columnSection && columnSection.type === 'columnSection' && columnSection.metadata.kind === 'columnSection');
  assert.equal(columnSection.metadata.columnCount, 2);
  assert.deepEqual(
    columnSection.metadata.blocks.map((block) => block.id),
    ['p-1', 'p-2'],
  );
  assert(columnSection.metadata.blocks.every((block) => block.sourceRange === null));
});

test('局部分栏在分页时会拆成连续的运行时片段', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  clearAllBlockHeightCache();

  try {
    const contract = withTestPageMetrics({
      ...resolveStyleContract(defaultStyleSettings),
      contentHeightPx: 180,
    });
    const section = createColumnSectionBlock(
      'section-1',
      Array.from({ length: 8 }, (_, index) =>
        createParagraphBlock(
          `section-p-${index + 1}`,
          `第 ${index + 1} 段局部分栏正文。` + '这是用于触发分页的测试文本。'.repeat(18),
        ),
      ),
    );

    const pages = paginateMaxFillBlocks({
      blocks: [section],
      contract,
    });
    const sectionFragments = pages.flatMap((page) =>
      page.blocks.filter(
        (block): block is LayoutBlock & {
          type: 'columnSection';
          metadata: {
            kind: 'columnSection';
            columnCount: 2 | 3;
            columnGapMm: number;
            divider: boolean;
            headingsSpanAll: boolean;
            blocks: LayoutBlock[];
            runtimeSlice?: {
              sourceNodeId: string;
              fragmentIndex: number;
              isContinuation: boolean;
            };
          };
        } => block.type === 'columnSection' && block.metadata.kind === 'columnSection',
      ),
    );

    assert(sectionFragments.length >= 2);
    sectionFragments.forEach((fragment, index) => {
      assert(fragment.metadata.runtimeSlice, '分页后的局部分栏片段应带 runtimeSlice。');
      assert.equal(fragment.metadata.runtimeSlice?.sourceNodeId, 'section-1');
      assert.equal(fragment.metadata.runtimeSlice?.fragmentIndex, index + 1);
      assert.equal(fragment.metadata.runtimeSlice?.isContinuation, index > 0);
      assert(fragment.metadata.blocks.length > 0);
    });
  } finally {
    resetFontMetricsProvider();
    clearAllBlockHeightCache();
  }
});
