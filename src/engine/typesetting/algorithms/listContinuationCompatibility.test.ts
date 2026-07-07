import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveCompactChoiceListLayoutWithOptions,
  type LayoutBlock,
  type LayoutListItem,
  type TextRun,
} from '@/engine/document-model';
import {
  createDeterministicFontMetricsProvider,
  resetFontMetricsProvider,
  setFontMetricsProvider,
} from '@/engine/font-metrics';
import { defaultStyleSettings } from '@/engine/style/presets';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import {
  CELL_MEASURE_PAGINATION_ALGORITHM_ID,
  DOM_MEASURE_PAGINATION_ALGORITHM_ID,
  MAX_FILL_PAGINATION_ALGORITHM_ID,
  OFFSCREEN_MEASURE_PAGINATION_ALGORITHM_ID,
  paginateBlocks,
} from '@/engine/typesetting';

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

function createChoiceListBlock(id: string): LayoutBlock {
  const items: LayoutListItem[] = [
    'A. Option A',
    'B. Option B',
    "C. What's your phone number",
    'D. Option D',
  ].map((text, index) => ({
    id: `${id}-item-${index + 1}`,
    sourceRange: null,
    textRuns: [createTextRun(`${id}-item-${index + 1}-run`, text)],
    level: 1,
    listKind: 'unordered',
    checked: null,
  }));

  return {
    id,
    type: 'list',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'list',
      ordered: false,
      start: null,
      spread: false,
      items,
    },
  };
}

function withTinyPageHeight() {
  const contract = resolveStyleContract(defaultStyleSettings);
  return {
    ...contract,
    contentHeightPx: 80,
    columnPageCapacityPx: 80 * contract.columnCount,
  };
}

function getListFragments(pages: ReturnType<typeof paginateBlocks>) {
  return pages
    .flatMap((page) => page.blocks)
    .filter(
      (block): block is LayoutBlock & {
        type: 'list';
        metadata: {
          kind: 'list';
          items: LayoutListItem[];
          runtimeSlice?: {
            startIndex: number;
            endIndex: number;
            fragmentIndex: number;
            totalItems: number;
            isContinuation: boolean;
          };
        };
      } => block.type === 'list' && block.metadata.kind === 'list',
    );
}

function assertChoiceContinuationFragments(
  algorithmId: string,
  pages: ReturnType<typeof paginateBlocks>,
): void {
  const fragments = getListFragments(pages);
  assert(fragments.length >= 2, `${algorithmId} 应至少拆成 2 个列表片段。`);

  const continuationFragment = fragments.find(
    (fragment) => fragment.metadata.runtimeSlice?.startIndex === 2,
  );
  assert(continuationFragment, `${algorithmId} 的续页片段应从第 3 个选项开始。`);
  assert.equal(
    continuationFragment.metadata.runtimeSlice?.isContinuation,
    true,
    `${algorithmId} 的续页片段应标记 isContinuation=true。`,
  );
  assert.deepEqual(
    continuationFragment.metadata.items.map((item) => item.textRuns.map((run) => run.text).join('')),
    ["C. What's your phone number", 'D. Option D'],
    `${algorithmId} 的续页片段应保留 C/D 两个选项。`,
  );
  const continuationChoiceLayout = resolveCompactChoiceListLayoutWithOptions(
    continuationFragment.metadata.items,
    {
      allowSequenceFromAnyLabel: (continuationFragment.metadata.runtimeSlice?.startIndex ?? 0) > 0,
    },
  );
  assert(continuationChoiceLayout, `${algorithmId} 的续页 C/D 片段应继续识别为选项组。`);
  assert.equal(
    continuationChoiceLayout.columns,
    1,
    `${algorithmId} 的较长续页选项可以降级为 1 列选项组，但不能退回普通列表。`,
  );
}

test('PH2-22C dom-measure 列表续页片段保留 runtimeSlice.startIndex', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  try {
    const pages = paginateBlocks(
      [createChoiceListBlock('dom-choice-list')],
      withTinyPageHeight(),
      { algorithmId: DOM_MEASURE_PAGINATION_ALGORITHM_ID },
    );
    assertChoiceContinuationFragments(DOM_MEASURE_PAGINATION_ALGORITHM_ID, pages);
  } finally {
    resetFontMetricsProvider();
  }
});

test('PH2-22C offscreen-measure 列表续页片段保留 runtimeSlice.startIndex', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  try {
    const pages = paginateBlocks(
      [createChoiceListBlock('offscreen-choice-list')],
      withTinyPageHeight(),
      { algorithmId: OFFSCREEN_MEASURE_PAGINATION_ALGORITHM_ID },
    );
    assertChoiceContinuationFragments(OFFSCREEN_MEASURE_PAGINATION_ALGORITHM_ID, pages);
  } finally {
    resetFontMetricsProvider();
  }
});

test('PH2-22C cell-measure 列表续页片段保留 runtimeSlice.startIndex', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  try {
    const pages = paginateBlocks(
      [createChoiceListBlock('cell-choice-list')],
      withTinyPageHeight(),
      { algorithmId: CELL_MEASURE_PAGINATION_ALGORITHM_ID },
    );
    assertChoiceContinuationFragments(CELL_MEASURE_PAGINATION_ALGORITHM_ID, pages);
  } finally {
    resetFontMetricsProvider();
  }
});

test('PH2-22C max-fill 列表续页片段保留选项组身份', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  try {
    const pages = paginateBlocks(
      [createChoiceListBlock('max-fill-choice-list')],
      withTinyPageHeight(),
      { algorithmId: MAX_FILL_PAGINATION_ALGORITHM_ID },
    );
    assertChoiceContinuationFragments(MAX_FILL_PAGINATION_ALGORITHM_ID, pages);
  } finally {
    resetFontMetricsProvider();
  }
});
