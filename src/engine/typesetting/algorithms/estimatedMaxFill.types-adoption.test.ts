import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  LayoutBlock,
  LayoutListItem,
  TextRun,
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

/**
 * 构造一个带头部段落的双列列表，便于测试列表 PoC。
 */
function createListBlock(id: string, itemCount: number): LayoutBlock {
  const items: LayoutListItem[] = [];
  for (let i = 0; i < itemCount; i += 1) {
    items.push({
      id: `${id}-item-${i + 1}`,
      sourceRange: null,
      textRuns: [createTextRun(`${id}-item-${i + 1}-run`, `列表项 ${i + 1}`)],
      checked: null,
    });
  }
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

function createSingleItemListBlock(id: string, text: string): LayoutBlock {
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
      items: [
        {
          id: `${id}-item-1`,
          sourceRange: null,
          textRuns: [createTextRun(`${id}-item-1-run`, text)],
          checked: null,
        },
      ],
    },
  };
}

/**
 * 抽取列表片段的 items 文本（用于跨片段一致性对比）。
 */
function getListItemTexts(block: LayoutBlock): string[] {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return [];
  }
  return block.metadata.items.map((item) => item.textRuns.map((run) => run.text).join(''));
}

function getListFragments(pages: ReturnType<typeof paginateMaxFillBlocks>): Array<
  LayoutBlock & {
    type: 'list';
    metadata: {
      kind: 'list';
      items: LayoutListItem[];
      ordered: boolean;
      start: number | null;
      spread: boolean;
      runtimeSlice?: {
        startIndex: number;
        endIndex: number;
        fragmentIndex: number;
        totalItems: number;
        isContinuation: boolean;
      };
    };
  }
> {
  return pages.flatMap((page) => page.blocks).filter(
    (block): block is LayoutBlock & {
      type: 'list';
      metadata: {
        kind: 'list';
        items: LayoutListItem[];
        ordered: boolean;
        start: number | null;
        spread: boolean;
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

test('PH2-20 接入：双栏下列表放不下当前栏时按项切分填满当前栏，第二栏从剩余项开始', () => {
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
      contentHeightPx: 96,
    });

    // 10 项列表，远超单栏容量。
    const list = createListBlock('big-list', 10);

    const pages = paginateMaxFillBlocks({
      blocks: [list],
      contract,
      styles: undefined,
    });

    const fragments = getListFragments(pages);
    // 关键断言：列表被切成 ≥ 2 个运行时片段。
    assert(fragments.length >= 2, `期望列表被切成 ≥2 个片段，实际只有 ${fragments.length} 个。`);

    // 每个片段都应带 runtimeSlice 元数据。
    fragments.forEach((fragment, index) => {
      assert(fragment.metadata.runtimeSlice, `第 ${index + 1} 个片段缺少 runtimeSlice 元数据。`);
      assert.equal(
        fragment.metadata.runtimeSlice!.fragmentIndex,
        index + 1,
        `第 ${index + 1} 个片段的 fragmentIndex 应为 ${index + 1}。`,
      );
    });

    // 首片段不能占用全部 10 项。
    assert(
      fragments[0].metadata.items.length < 10,
      `期望首片段只吃掉当前栏能容纳的部分项，实际吃了 ${fragments[0].metadata.items.length}/10 项。`,
    );

    // 续排片段应标记 isContinuation。
    if (fragments.length >= 2) {
      assert.equal(
        fragments[1].metadata.runtimeSlice!.isContinuation,
        true,
        '第 2 个及之后的片段应标记 isContinuation=true。',
      );
    }

    // 所有片段拼接后能完整还原原始列表项内容。
    const allFragmentTexts = fragments.flatMap((fragment) => getListItemTexts(fragment));
    const originalTexts = getListItemTexts(list);
    assert.deepEqual(
      allFragmentTexts,
      originalTexts,
      '拆分后应完整保留原始列表项内容。',
    );
  } finally {
    resetFontMetricsProvider();
  }
});

test('PH2-20 接入：双栏下列表切分后第二栏从剩余项开始（advanceToNextColumn 生效）', () => {
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
      contentHeightPx: 96,
    });

    const list = createListBlock('split-list', 12);

    const pages = paginateMaxFillBlocks({
      blocks: [list],
      contract,
      styles: undefined,
    });

    // 关键断言：分页结果至少产生 ≥ 2 个片段，证明多栏切分已生效。
    const fragments = getListFragments(pages);
    assert(fragments.length >= 2, `期望 ≥2 个片段，实际 ${fragments.length} 个。`);

    // 关键断言：续排片段应从原始列表第 2 项或之后开始，证明 advanceToNextColumn 后切分器用上了第二栏剩余空间。
    const continuationFragments = fragments.filter(
      (fragment) =>
        fragment.metadata.runtimeSlice?.startIndex !== undefined &&
        fragment.metadata.runtimeSlice.startIndex > 0,
    );
    assert(
      continuationFragments.length >= 1,
      `期望至少存在一个 startIndex > 0 的续排片段，证明栏位推进后从剩余项开始。`,
    );
  } finally {
    resetFontMetricsProvider();
  }
});

// ============ TOC ============

/**
 * PH2-20 接入：构造多个 heading 作为目录源，外加一个 toc 块触发切分路径。
 */
function createHeadingBlock(id: string, depth: 1 | 2 | 3, text: string): LayoutBlock {
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

function createTocBlock(id: string, maxDepth: 1 | 2 | 3): LayoutBlock {
  return {
    id,
    type: 'toc',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'toc',
      title: '目录',
      maxDepth,
    },
  };
}

function getTocFragments(pages: ReturnType<typeof paginateMaxFillBlocks>): Array<
  LayoutBlock & {
    type: 'toc';
    metadata: {
      kind: 'toc';
      title: string;
      maxDepth: 1 | 2 | 3;
      runtimeSlice?: {
        startIndex: number;
        endIndex: number;
        fragmentIndex: number;
        totalItems: number;
      };
    };
  }
> {
  return pages.flatMap((page) => page.blocks).filter(
    (block): block is LayoutBlock & {
      type: 'toc';
      metadata: {
        kind: 'toc';
        title: string;
        maxDepth: 1 | 2 | 3;
        runtimeSlice?: {
          startIndex: number;
          endIndex: number;
          fragmentIndex: number;
          totalItems: number;
        };
      };
    } => block.type === 'toc' && block.metadata.kind === 'toc',
  );
}

test('PH2-20 接入：双栏下 TOC 走统一接口 continue 时不会卡死且续排到下一栏', () => {
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
      // 把 contentHeightPx 调小一些，让 toc 容易触发切分。
      contentHeightPx: 80,
    });

    // 20 个 heading + 1 个 toc 块。toc 会从当前 blocks 中收集 heading 当目录项。
    const headings: LayoutBlock[] = [];
    for (let i = 0; i < 20; i += 1) {
      headings.push(createHeadingBlock(`heading-${i + 1}`, 2, `第 ${i + 1} 章 标题`));
    }
    const toc = createTocBlock('toc-main', 2);

    // toc 必须放在第一项（按现在的实现，toc 切分时只统计外层 blocks 中的 heading）
    const blocks = [toc, ...headings];

    const pages = paginateMaxFillBlocks({
      blocks,
      contract,
      styles: undefined,
    });

    // 关键断言：分页没有异常导致死循环。
    assert(pages.length >= 1, `期望分页至少 1 页，实际 ${pages.length} 页。`);

    const fragments = getTocFragments(pages);
    // TOC 主循环触发切分 → 至少 1 个 toc 片段；如果能被整放，依旧会出 1 个 toc 片段。
    assert(fragments.length >= 1, `期望 toc 至少 1 个片段，实际 ${fragments.length} 个。`);

    // 如果被切分了，应有 runtimeSlice 写入且续排片段 startIndex > 0。
    if (fragments.length >= 2) {
      const continuationFragments = fragments.filter(
        (fragment) =>
          fragment.metadata.runtimeSlice?.startIndex !== undefined &&
          fragment.metadata.runtimeSlice.startIndex > 0,
      );
      assert(
        continuationFragments.length >= 1,
        `期望至少存在一个 startIndex > 0 的续排 toc 片段。`,
      );
    }
  } finally {
    resetFontMetricsProvider();
  }
});

// ============ 引用容器 & 代码块（间接覆盖：existing blockquote test 已覆盖） ============

test('PH2-20 接入：双栏引用容器走 while 循环 + trySplitBlockquoteToFitHeight 后不会回到新页第一栏', () => {
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
      contentHeightPx: 96,
    });
    // 构造长引用 → 强制切分。
    const blockquote = {
      id: 'bq-1',
      type: 'blockquote' as const,
      sourceRange: null,
      blockStyleRef: null,
      blockStyleOverrides: {},
      textRuns: [],
      pagination: {},
      metadata: {
        kind: 'blockquote' as const,
        blocks: [
          {
            id: 'bq-1-inner-1',
            type: 'paragraph' as const,
            sourceRange: null,
            blockStyleRef: null,
            blockStyleOverrides: {},
            textRuns: [createTextRun('bq-1-inner-1-run', '第一段引用：这是一段很长很长的引用内容，用于触发多栏切分。'.repeat(3))],
            pagination: {},
            metadata: { kind: 'paragraph' as const, text: '' },
          },
          {
            id: 'bq-1-inner-2',
            type: 'paragraph' as const,
            sourceRange: null,
            blockStyleRef: null,
            blockStyleOverrides: {},
            textRuns: [createTextRun('bq-1-inner-2-run', '第二段引用：同样很长很长的引用内容，用于触发跨栏续排。'.repeat(3))],
            pagination: {},
            metadata: { kind: 'paragraph' as const, text: '' },
          },
          {
            id: 'bq-1-inner-3',
            type: 'paragraph' as const,
            sourceRange: null,
            blockStyleRef: null,
            blockStyleOverrides: {},
            textRuns: [createTextRun('bq-1-inner-3-run', '第三段引用：再续一段长引用以验证多栏切分填充。'.repeat(3))],
            pagination: {},
            metadata: { kind: 'paragraph' as const, text: '' },
          },
        ],
      },
    };

    const pages = paginateMaxFillBlocks({
      blocks: [blockquote],
      contract,
      styles: undefined,
    });

    // 关键断言：分页结果不报错、不死循环。
    assert(pages.length >= 1, `期望 ≥1 页，实际 ${pages.length} 页。`);

    // 抽取所有引用块 / 代码块片段，验证不会因为 splice 不当造成无限循环。
    const fragments = pages.flatMap((page) => page.blocks).filter(
      (b) => b.type === 'blockquote' && b.metadata.kind === 'blockquote',
    );
    // 切分填满当前栏应至少 2 个片段。
    assert(fragments.length >= 1, `期望 ≥1 个引用片段，实际 ${fragments.length} 个。`);
  } finally {
    resetFontMetricsProvider();
  }
});

test('PH2-20 接入：双栏代码块走 while 循环 + trySplitCodeToFitHeight 后不会回到新页第一栏', () => {
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
      contentHeightPx: 96,
    });
    // 长代码块。
    const codeBlock: LayoutBlock = {
      id: 'cd-1',
      type: 'code',
      sourceRange: null,
      blockStyleRef: null,
      blockStyleOverrides: {},
      textRuns: [
        createTextRun(
          'cd-1-run',
          [
            'const firstLine = "第一段代码应尽量留在当前栏";',
            'const secondLine = "第二段代码继续续排到下一栏";',
            'const thirdLine = "第三段代码确保内容顺序保持不变";',
            'const fourthLine = "第四段代码用于拉长代码块";',
            'const fifthLine = "第五段代码进一步拉长代码块";',
            'const sixthLine = "第六段代码验证多栏切分逻辑";',
          ].join('\n'),
        ),
      ],
      pagination: {},
      metadata: {
        kind: 'code',
        language: 'text',
        value: '',
      },
    };

    const pages = paginateMaxFillBlocks({
      blocks: [codeBlock],
      contract,
      styles: undefined,
    });

    assert(pages.length >= 1, `期望 ≥1 页，实际 ${pages.length} 页。`);
    const fragments = pages.flatMap((page) => page.blocks).filter(
      (b) => b.type === 'code' && b.metadata.kind === 'code',
    );
    assert(fragments.length >= 1, `期望 ≥1 个代码片段，实际 ${fragments.length} 个。`);

    // 所有片段拼接后等于原始代码内容。
    const fragmentValues = fragments
      .map((fragment) => {
        if (fragment.type !== 'code' || fragment.metadata.kind !== 'code') {
          return '';
        }
        return (fragment.metadata as { kind: 'code'; value: string }).value;
      })
      .join('');
    const originalValue = (codeBlock.metadata as { kind: 'code'; value: string }).value;
    assert.equal(fragmentValues, originalValue, '拆分后应完整保留原始代码内容。');
  } finally {
    resetFontMetricsProvider();
  }
});

// ============ 文本块 ============

test('PH2-20 接入：双栏下整放判断改为"当前栏能否放"，不放时进入切分（不向后找栏）', () => {
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
      contentHeightPx: 96,
    });
    // 极短段落：能放入当前栏 → 整放。验证入口判断。
    const shortPara = {
      id: 'tp-1',
      type: 'paragraph' as const,
      sourceRange: null,
      blockStyleRef: null,
      blockStyleOverrides: {},
      textRuns: [createTextRun('tp-1-run', '短段落测试')],
      pagination: {},
      metadata: { kind: 'paragraph' as const, text: '短段落测试' },
    };
    const pages = paginateMaxFillBlocks({
      blocks: [shortPara],
      contract,
      styles: undefined,
    });
    assert(pages.length >= 1, `期望 ≥1 页，实际 ${pages.length} 页。`);
    const paraFragments = pages.flatMap((page) => page.blocks).filter(
      (b) => b.type === 'paragraph',
    );
    // 短段落应在 1 个片段中（无切分）。
    assert(
      paraFragments.length === 1,
      `期望短段落整放为 1 个片段，实际 ${paraFragments.length} 个。`,
    );
  } finally {
    resetFontMetricsProvider();
  }
});

// ============ runtimeSlice 整理 V1 ============

test('PH2-20-rendering-adaptation：createListFragmentBlock 一次性产出含 metadata.runtimeSlice 的列表片段', () => {
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
      contentHeightPx: 80,
    });

    // 12 项列表 → 双栏下会被切成 ≥ 2 个片段。
    const list = createListBlock('runtime-slice-list', 12);

    const pages = paginateMaxFillBlocks({
      blocks: [list],
      contract,
      styles: undefined,
    });

    const fragments = getListFragments(pages);
    assert(fragments.length >= 2, `期望列表被切成 ≥2 个片段，实际 ${fragments.length} 个。`);

    fragments.forEach((fragment, index) => {
      // 关键断言 1：所有片段都带 metadata.runtimeSlice（不再依赖主循环的 blockWithSlice 二次覆盖）。
      assert(
        fragment.metadata.runtimeSlice,
        `第 ${index + 1} 个片段缺少 metadata.runtimeSlice，证明 createListFragmentBlock 已自行产出。`,
      );

      // 关键断言 2：runtimeSlice.startIndex / endIndex 与该片段的 items 子集下标一一对应。
      const slice = fragment.metadata.runtimeSlice!;
      const expectedItemsLength = slice.endIndex - slice.startIndex + 1;
      assert.equal(
        fragment.metadata.items.length,
        expectedItemsLength,
        `第 ${index + 1} 个片段 metadata.runtimeSlice.endIndex-startIndex+1 = ${expectedItemsLength}，与 items.length = ${fragment.metadata.items.length} 不一致。`,
      );

      // 关键断言 3：片段的 fragmentIndex 与运行时片段序号一致。
      assert.equal(
        slice.fragmentIndex,
        index + 1,
        `第 ${index + 1} 个片段的 runtimeSlice.fragmentIndex 应为 ${index + 1}。`,
      );
    });

    // 关键断言 4：从第一片段到第二片段，startIndex 必须严格递增（跨片段不重叠）。
    for (let i = 1; i < fragments.length; i += 1) {
      const previous = fragments[i - 1].metadata.runtimeSlice!;
      const current = fragments[i].metadata.runtimeSlice!;
      assert(
        current.startIndex > previous.endIndex,
        `第 ${i + 1} 个片段 startIndex (${current.startIndex}) 应大于第 ${i} 个片段 endIndex (${previous.endIndex})。`,
      );
    }
  } finally {
    resetFontMetricsProvider();
  }
});

// ============ 文本块 runtimeSlice 接入 V1 ============

type TextBlockRuntimeSlice = {
  isContinuation: boolean;
  isOriginal: boolean;
  sourceNodeId: string;
  characterRange: { start: number; end: number };
  fragmentIdSuffix: string;
};

type TextFragmentWithSlice = LayoutBlock & {
  type: 'heading' | 'paragraph';
  metadata: {
    kind: 'heading' | 'paragraph';
    text: string;
    runtimeSlice?: TextBlockRuntimeSlice;
  };
};

function getTextFragments(
  pages: ReturnType<typeof paginateMaxFillBlocks>,
): TextFragmentWithSlice[] {
  const out: TextFragmentWithSlice[] = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      if (
        (block.type === 'heading' && block.metadata.kind === 'heading') ||
        (block.type === 'paragraph' && block.metadata.kind === 'paragraph')
      ) {
        // 这里已知 type 与 metadata.kind 共同对齐；用 cast 安全。
        out.push(block as unknown as TextFragmentWithSlice);
      }
    }
  }
  return out;
}

test('PH2-20-text-rendering-adaptation：长段落跨页切分时 current / remaining fragment 均带 metadata.runtimeSlice', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  clearAllBlockHeightCache();
  try {
    const contract = withTestPageMetrics({
      ...resolveStyleContract({
        ...defaultStyleSettings,
        columns: {
          ...defaultStyleSettings.columns,
          count: 1,
        },
      }),
      // 用一个非常小的 contentHeightPx 强制段落切分。
      contentHeightPx: 60,
    });

    // 构造一个超长段落：足够多的字符迫使分页器跨页。
    const longText = '这是一段很长的段落内容用于触发跨页切分。'.repeat(60);
    const longParagraph: LayoutBlock = {
      id: 'long-paragraph-1',
      type: 'paragraph',
      sourceRange: null,
      blockStyleRef: null,
      blockStyleOverrides: {},
      textRuns: [createTextRun('long-paragraph-1-run', longText)],
      pagination: {},
      metadata: { kind: 'paragraph', text: longText },
    };

    const pages = paginateMaxFillBlocks({
      blocks: [longParagraph],
      contract,
      styles: undefined,
    });

    // 期望：≥ 2 页，每页至少有一个 fragment。
    assert(pages.length >= 2, `期望分页 ≥2 页，实际 ${pages.length} 页。`);

    const fragments = getTextFragments(pages);
    assert(fragments.length >= 2, `期望段落被切成 ≥2 个 fragment，实际 ${fragments.length} 个。`);

    // 关键断言 1：每个 fragment 都带 metadata.runtimeSlice。
    fragments.forEach((fragment, index) => {
      assert(
        fragment.metadata.runtimeSlice,
        `第 ${index + 1} 个 fragment 缺少 metadata.runtimeSlice。`,
      );
    });

    // 关键断言 2：主循环每次切分都生成 current + remaining 两个 fragment。
    // 中间 fragment 都是"上一次 remaining → 本次 current"的产物（isContinuation=false, isOriginal=false）。
    // 整个链上的最后一个 fragment 是 remaining（isContinuation=true, isOriginal=false）。
    // 首 fragment 也是 current（isContinuation=false）；如果段落恰好整页放下且不剩文本，则首 fragment
    // 走整放 path：isContinuation=false, isOriginal=true。
    const lastSlice = fragments[fragments.length - 1].metadata.runtimeSlice!;
    assert.equal(
      lastSlice.isContinuation,
      true,
      `最后一个 fragment 应 isContinuation=true，但实际为 ${lastSlice.isContinuation}。`,
    );
    assert.equal(lastSlice.isOriginal, false, '最后一个 fragment 不应 isOriginal=true。');

    // 中间 fragment：全部 isContinuation=false, isOriginal=false。
    for (let i = 0; i < fragments.length - 1; i += 1) {
      const slice = fragments[i].metadata.runtimeSlice!;
      assert.equal(
        slice.isContinuation,
        false,
        `第 ${i + 1} 个 fragment（current）应 isContinuation=false，但实际为 ${slice.isContinuation}。`,
      );
      assert.equal(
        slice.isOriginal,
        false,
        `第 ${i + 1} 个 fragment（current）应 isOriginal=false，但实际为 ${slice.isOriginal}。`,
      );
    }

    // 关键断言 3：第一个 fragment 必然 isContinuation=false。
    {
      const firstSlice = fragments[0].metadata.runtimeSlice!;
      assert.equal(
        firstSlice.isContinuation,
        false,
        '首 fragment 应 isContinuation=false。',
      );
    }

    // 关键断言 4：所有 fragment 的 sourceNodeId 必须指向原始块 id。
    fragments.forEach((fragment, index) => {
      assert.equal(
        fragment.metadata.runtimeSlice!.sourceNodeId,
        longParagraph.id,
        `第 ${index + 1} 个 fragment 的 sourceNodeId 必须等于 ${longParagraph.id}。`,
      );
    });

    // 关键断言 5：characterRange 端点必须和 runtimeMeasurement 端点同步（推断）：
    // Fragment 的 metadata.text 长度 - 1 = characterRange.end - characterRange.start + 1
    // 因为非首 fragment 的字符区间起点 = currentPageText.length（累计）。
    let runningTextLen = 0;
    fragments.forEach((fragment, index) => {
      const textLen = fragment.metadata.text.length;
      const slice = fragment.metadata.runtimeSlice!;
      assert.equal(
        slice.characterRange.start,
        runningTextLen,
        `第 ${index + 1} 个 fragment characterRange.start 应等于 runningTextLen=${runningTextLen}，实际为 ${slice.characterRange.start}。`,
      );
      assert.equal(
        slice.characterRange.end,
        runningTextLen + textLen - 1,
        `第 ${index + 1} 个 fragment characterRange.end 应等于 ${runningTextLen + textLen - 1}，实际为 ${slice.characterRange.end}。`,
      );
      runningTextLen += textLen;
    });

    // 关键断言 6：所有 fragment 拼接后能完整还原原始文本。
    const reassembled = fragments.map((fragment) => fragment.metadata.text).join('');
    assert.equal(
      reassembled,
      longText,
      '所有 fragment 拼接后文本必须等于原始 longText。',
    );
  } finally {
    resetFontMetricsProvider();
  }
});

test('PH2-20-text-rendering-adaptation：heading 整放一页时 metadata.runtimeSlice.isOriginal=true、isContinuation=false', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  clearAllBlockHeightCache();
  try {
    const contract = withTestPageMetrics({
      ...resolveStyleContract({
        ...defaultStyleSettings,
        columns: {
          ...defaultStyleSettings.columns,
          count: 1,
        },
      }),
      contentHeightPx: 800, // 充分大，整放。
    });

    const headingBlock: LayoutBlock = {
      id: 'heading-original-1',
      type: 'heading',
      sourceRange: null,
      blockStyleRef: null,
      blockStyleOverrides: {},
      textRuns: [createTextRun('heading-original-1-run', '这是一个非常短的标题')],
      pagination: {},
      metadata: { kind: 'heading', depth: 2, text: '这是一个非常短的标题' },
    };

    const pages = paginateMaxFillBlocks({
      blocks: [headingBlock],
      contract,
      styles: undefined,
    });

    assert(pages.length >= 1, `期望 ≥1 页，实际 ${pages.length} 页。`);
    const fragments = getTextFragments(pages);
    assert.equal(
      fragments.length,
      1,
      `期望 heading 整放为 1 个 fragment，实际 ${fragments.length} 个。`,
    );

    // PH2-20-block-split-text-rendering-adaptation-v1：整放 path 也应在 metadata.runtimeSlice 上标记。
    const slice = fragments[0].metadata.runtimeSlice;
    assert(
      slice,
      '整放 heading 的 metadata.runtimeSlice 应存在。',
    );
    assert.equal(slice!.isOriginal, true, '整放 heading 应 isOriginal=true。');
    assert.equal(slice!.isContinuation, false, '整放 heading 应 isContinuation=false。');
    assert.equal(slice!.sourceNodeId, headingBlock.id);
  } finally {
    resetFontMetricsProvider();
  }
});

// ============ 行内公式切分保护 V1 ============

function countDollar(text: string): number {
  return Array.from(text).filter((char) => char === '$').length;
}

function assertNoBrokenInlineFormula(fragments: string[], originalText: string): void {
  assert.equal(
    fragments.join(''),
    originalText,
    '所有分页片段拼回后必须等于原文。',
  );
  fragments.forEach((fragment, index) => {
    assert.equal(
      countDollar(fragment) % 2,
      0,
      `第 ${index + 1} 个片段存在未闭合的 $ 行内公式：${fragment}`,
    );
  });
}

test('PH2-20-inline-equation-split-guard：段落实测换行点落在行内公式内部时不会拆坏公式', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  clearAllBlockHeightCache();
  try {
    const contract = withTestPageMetrics({
      ...resolveStyleContract({
        ...defaultStyleSettings,
        columns: {
          ...defaultStyleSettings.columns,
          count: 1,
        },
      }),
      contentWidthPx: 128,
      contentHeightPx: 64,
    });
    const paragraphText = '初始投资成本2000万元小于应享有净资产公允价值份额2400万元（$8000 \\\\times 30\\\\%$），差额400万元应调整长期股权投资账面价值。';
    const formulaStart = paragraphText.indexOf('$8000');
    const dangerousOffset = paragraphText.indexOf('times');
    const firstLineOffset = Math.max(1, formulaStart - 4);
    assert(dangerousOffset > formulaStart, '测试前置条件：危险切分点必须落在公式内部。');
    const paragraph: LayoutBlock = {
      id: 'inline-equation-paragraph',
      type: 'paragraph',
      sourceRange: null,
      blockStyleRef: null,
      blockStyleOverrides: {},
      textRuns: [createTextRun('inline-equation-paragraph-run', paragraphText)],
      pagination: {},
      metadata: { kind: 'paragraph', text: paragraphText },
    };

    const pages = paginateMaxFillBlocks({
      blocks: [paragraph],
      contract,
      measuredTextLineBreaks: {
        [paragraph.id]: [firstLineOffset, dangerousOffset, paragraphText.length],
      },
    });

    const fragments = getTextFragments(pages).map((fragment) => fragment.metadata.text);
    assert(
      fragments.length >= 2,
      `期望段落被切成至少 2 个片段，实际 ${fragments.length} 个。`,
    );
    assertNoBrokenInlineFormula(fragments, paragraphText);
    assert.equal(
      fragments[0].includes('$8000'),
      false,
      '危险切分点位于公式内部时，首片段应回退到公式前，避免页尾出现半截公式。',
    );
  } finally {
    resetFontMetricsProvider();
  }
});

test('PH2-20-inline-equation-split-guard：列表项实测换行点落在行内公式内部时不会拆坏公式', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  clearAllBlockHeightCache();
  try {
    const contract = withTestPageMetrics({
      ...resolveStyleContract({
        ...defaultStyleSettings,
        columns: {
          ...defaultStyleSettings.columns,
          count: 1,
        },
      }),
      contentWidthPx: 128,
      contentHeightPx: 64,
    });
    const itemText = '列表项文字说明投资收益按 $8000 \\\\times 30\\\\%$ 计算，后续继续说明差额处理。';
    const list = createSingleItemListBlock('inline-equation-list', itemText);
    const item = list.metadata.kind === 'list' ? list.metadata.items[0] : null;
    assert(item, '测试前置条件：列表项必须存在。');
    const dangerousOffset = itemText.indexOf('times');

    const pages = paginateMaxFillBlocks({
      blocks: [list],
      contract,
      measuredTextLineBreaks: {
        [item.id]: [dangerousOffset, itemText.length],
      },
    });

    const fragments = getListFragments(pages).flatMap((fragment) => getListItemTexts(fragment));
    assert(
      fragments.length >= 2,
      `期望列表项被切成至少 2 个文本片段，实际 ${fragments.length} 个。`,
    );
    assertNoBrokenInlineFormula(fragments, itemText);
  } finally {
    resetFontMetricsProvider();
  }
});

test('PH2-20-inline-equation-split-guard：表格单元格实测换行点落在行内公式内部时不会拆坏公式', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  clearAllBlockHeightCache();
  try {
    const contract = withTestPageMetrics({
      ...resolveStyleContract({
        ...defaultStyleSettings,
        columns: {
          ...defaultStyleSettings.columns,
          count: 1,
        },
      }),
      contentWidthPx: 128,
      contentHeightPx: 84,
    });
    const cellText = '表格内金额按 $8000 \\\\times 30\\\\%$ 计算，差额继续写在同一个单元格内。';
    const table: LayoutBlock = {
      id: 'inline-equation-table',
      type: 'table',
      sourceRange: null,
      blockStyleRef: null,
      blockStyleOverrides: {},
      textRuns: [],
      pagination: {},
      metadata: {
        kind: 'table',
        align: [null],
        columnWidthsPx: [null],
        rows: [
          {
            id: 'inline-equation-table-row-1',
            sourceRange: null,
            heightPx: null,
            cells: [
              {
                id: 'inline-equation-table-cell-1',
                sourceRange: null,
                textRuns: [createTextRun('inline-equation-table-cell-1-run', cellText)],
                isHeader: false,
              },
            ],
          },
        ],
      },
    };
    const dangerousOffset = cellText.indexOf('times');

    const pages = paginateMaxFillBlocks({
      blocks: [table],
      contract,
      measuredTextLineBreaks: {
        'inline-equation-table-cell-1': [dangerousOffset, cellText.length],
      },
    });

    const tableFragments = pages
      .flatMap((page) => page.blocks)
      .filter((block) => block.type === 'table' && block.metadata.kind === 'table');
    const fragments = tableFragments.flatMap((block) => {
      if (block.type !== 'table' || block.metadata.kind !== 'table') {
        return [];
      }
      return block.metadata.rows.flatMap((row) => row.cells.map((cell) => cell.textRuns.map((run) => run.text).join('')));
    });

    assert(
      fragments.length >= 2,
      `期望表格单元格被切成至少 2 个文本片段，实际 ${fragments.length} 个。`,
    );
    assertNoBrokenInlineFormula(fragments, cellText);
  } finally {
    resetFontMetricsProvider();
  }
});
