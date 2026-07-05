import assert from 'node:assert/strict';
import test from 'node:test';
import type { LayoutBlock, TextRun } from '@/engine/document-model';
import {
  createDeterministicFontMetricsProvider,
  resetFontMetricsProvider,
  setFontMetricsProvider,
} from '@/engine/font-metrics';
import { defaultStyleSettings } from '@/engine/style/presets';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import { clearAllBlockHeightCache, paginateMaxFillBlocks } from './estimatedMaxFill';

type CodeTestBlock = LayoutBlock & { type: 'code'; metadata: { kind: 'code'; language: string | null; value: string } };

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

function createBlockquoteBlock(id: string, nestedTexts: string[]): LayoutBlock {
  return {
    id,
    type: 'blockquote',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'blockquote',
      blocks: nestedTexts.map((text, index) => createParagraphBlock(`${id}-child-${index + 1}`, text)),
    },
  };
}

function createCodeBlock(id: string, text: string): CodeTestBlock {
  return {
    id,
    type: 'code',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [createTextRun(`${id}-run`, text)],
    pagination: {},
    metadata: {
      kind: 'code',
      language: 'text',
      value: text,
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

function getBlockquoteNestedTexts(block: LayoutBlock): string[] {
  if (block.type !== 'blockquote' || block.metadata.kind !== 'blockquote') {
    return [];
  }

  return block.metadata.blocks.flatMap((nestedBlock) =>
    nestedBlock.type === 'paragraph' && nestedBlock.metadata.kind === 'paragraph'
      ? [nestedBlock.metadata.text]
      : [],
  );
}

test('多栏引用块会优先拆成片段填满当前栏，而不是整块后移', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  clearAllBlockHeightCache();
  try {
    const contract = withTestPageMetrics({
      ...resolveStyleContract({
        ...defaultStyleSettings,
        columns: {
          ...defaultStyleSettings.columns,
          count: 2,
        },
      }),
      contentHeightPx: 132,
    });
    const leadingParagraph = createParagraphBlock(
      'lead',
      '这是一个用于占用首栏高度的前置段落。'.repeat(4),
    );
    const blockquote = createBlockquoteBlock('quote', [
      '引用第一段会优先尝试留在当前栏，避免整块后移。'.repeat(2),
      '引用第二段继续作为剩余内容续排到后续栏或下一页。'.repeat(2),
    ]);

    const pages = paginateMaxFillBlocks({
      blocks: [leadingParagraph, blockquote],
      contract,
      styles: undefined,
    });

    const blockquoteFragments = pages
      .flatMap((page) => page.blocks)
      .filter(
        (block): block is LayoutBlock & { type: 'blockquote'; metadata: { kind: 'blockquote'; blocks: LayoutBlock[] } } =>
          block.type === 'blockquote' && block.metadata.kind === 'blockquote',
      );

    assert(blockquoteFragments.length >= 2, `期望引用块被拆成至少 2 个片段，实际只有 ${blockquoteFragments.length} 个。`);
    assert(blockquoteFragments[0].metadata.blocks.length === 1, '期望首个引用片段只吃掉当前栏能容纳的内部子块。');
    assert.deepEqual(
      blockquoteFragments.flatMap((fragment) => getBlockquoteNestedTexts(fragment)),
      getBlockquoteNestedTexts(blockquote),
      '引用块拆分后应完整保留原始内部段落顺序与文字内容。',
    );
  } finally {
    resetFontMetricsProvider();
  }
});

test('多栏代码块会优先拆成片段填满当前栏，而不是整块后移', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  clearAllBlockHeightCache();
  try {
    const contract = withTestPageMetrics({
      ...resolveStyleContract({
        ...defaultStyleSettings,
        columns: {
          ...defaultStyleSettings.columns,
          count: 2,
        },
      }),
      contentHeightPx: 136,
    });
    const leadingParagraph = createParagraphBlock(
      'lead-code',
      '这是一个用于占用首栏高度的前置段落。'.repeat(4),
    );
    const codeBlock = createCodeBlock(
      'code-block',
      [
        'const firstLine = "第一段代码应尽量留在当前栏";',
        'const secondLine = "第二段代码继续续排到下一栏";',
        'const thirdLine = "第三段代码确保内容顺序保持不变";',
        'const fourthLine = "第四段代码用于拉长代码块";',
      ].join('\n'),
    );

    const pages = paginateMaxFillBlocks({
      blocks: [leadingParagraph, codeBlock],
      contract,
      styles: undefined,
    });

    const codeFragments = pages
      .flatMap((page) => page.blocks)
      .filter(
        (block): block is LayoutBlock & { type: 'code'; metadata: { kind: 'code'; value: string } } =>
          block.type === 'code' && block.metadata.kind === 'code',
      );

    assert(codeFragments.length >= 2, `期望代码块被拆成至少 2 个片段，实际只有 ${codeFragments.length} 个。`);
    assert(
      codeFragments[0].metadata.value.length < codeBlock.metadata.value.length,
      '期望首个代码片段只吃掉当前栏能容纳的部分内容。',
    );
    assert.equal(
      codeFragments.map((fragment) => fragment.metadata.value).join(''),
      codeBlock.metadata.value,
      '代码块拆分后应完整保留原始代码文字内容。',
    );
  } finally {
    resetFontMetricsProvider();
  }
});
