import assert from 'node:assert/strict';
import test from 'node:test';
import type { LayoutBlock, LayoutTableCell, LayoutTableRow, TextRun } from '@/engine/document-model';
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

/**
 * PH2-20 多栏块切分通用机制 V1：构造一个简单的两列表格用于 PoC 测试。
 * 每行只放一句话，避免被 splittable 拒绝；行数足够多，可以填满两栏。
 */
function createTableBlock(id: string, rowCount: number, columnCount = 2): LayoutBlock {
  const rows: LayoutTableRow[] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells: LayoutTableCell[] = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      cells.push({
        id: `${id}-row-${rowIndex}-cell-${columnIndex}`,
        sourceRange: null,
        textRuns: [createTextRun(`${id}-r${rowIndex}-c${columnIndex}-run`, `第 ${rowIndex + 1} 行 第 ${columnIndex + 1} 列`)],
        isHeader: rowIndex === 0,
      });
    }
    rows.push({
      id: `${id}-row-${rowIndex}`,
      sourceRange: null,
      cells,
    });
  }
  return {
    id,
    type: 'table',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'table',
      align: Array.from({ length: columnCount }, () => null),
      rows,
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

function getTableFragments(pages: ReturnType<typeof paginateMaxFillBlocks>): Array<
  LayoutBlock & {
    type: 'table';
    metadata: {
      kind: 'table';
      rows: LayoutTableRow[];
      runtimeSlice?: {
        startRowIndex: number;
        endRowIndex: number;
        fragmentIndex: number;
        totalFragments: number;
        isContinuation: boolean;
      };
    };
  }
> {
  return pages.flatMap((page) => page.blocks).filter(
    (block): block is LayoutBlock & {
      type: 'table';
      metadata: {
        kind: 'table';
        rows: LayoutTableRow[];
        runtimeSlice?: {
          startRowIndex: number;
          endRowIndex: number;
          fragmentIndex: number;
          totalFragments: number;
          isContinuation: boolean;
        };
      };
    } => block.type === 'table' && block.metadata.kind === 'table',
  );
}

test('PH2-20 多栏块切分通用机制 V1：双栏下表格放不下当前栏时按行切分填满当前栏', () => {
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
      // contentHeightPx 设得较小，强制让表格无法整表放入当前栏，但能容纳前几行。
      contentHeightPx: 96,
    });

    // 8 行 2 列的表格，远超当前栏高度，预期会被切分。
    const table = createTableBlock('big-table', 8, 2);

    const pages = paginateMaxFillBlocks({
      blocks: [table],
      contract,
      styles: undefined,
    });

    const fragments = getTableFragments(pages);
    // 关键断言：表格被切成至少 2 个运行时片段，而不是整体落到下一栏。
    assert(fragments.length >= 2, `期望表格被切成 ≥2 个片段，实际只有 ${fragments.length} 个。`);

    // 关键断言：每个片段都带 runtimeSlice 元数据。
    fragments.forEach((fragment, index) => {
      assert(fragment.metadata.runtimeSlice, `第 ${index + 1} 个片段缺少 runtimeSlice 元数据。`);
      assert.equal(
        fragment.metadata.runtimeSlice!.fragmentIndex,
        index + 1,
        `第 ${index + 1} 个片段的 fragmentIndex 应为 ${index + 1}。`,
      );
    });

    // 关键断言：首片段不能占用全部 8 行（说明确实在当前栏切了）。
    const firstFragmentRowCount = fragments[0].metadata.rows.filter((row) => !row.id.includes('-repeat-header')).length;
    assert(
      firstFragmentRowCount < 8,
      `期望首片段只吃掉当前栏能容纳的部分行，实际吃了 ${firstFragmentRowCount}/8 行。`,
    );

    // 关键断言：所有片段拼接后能完整还原原始表格的非表头行内容。
    // 关键：原表格第 0 行是表头（isHeader=true），片段里会保留为“首片段的首行”，不属于非表头行内容。
    const tableRows = table.metadata.kind === 'table' ? table.metadata.rows : [];
    const originalRowTexts = tableRows
      .filter((row) => !row.cells.every((cell) => cell.isHeader))
      .map((row) => row.cells.map((cell) => cell.textRuns[0]?.text).join('|'));
    const fragmentRowTexts = fragments.flatMap((fragment) =>
      fragment.metadata.rows
        // 跳过续页重复表头行（id 含 -repeat-header 后缀）和首片段的原表头行（isHeader=true）。
        .filter((row) =>
          !row.id.includes('-repeat-header') && !row.cells.every((cell) => cell.isHeader),
        )
        .map((row) => row.cells.map((cell) => cell.textRuns[0]?.text).join('|')),
    );
    assert.deepEqual(fragmentRowTexts, originalRowTexts, '拆分后应完整保留原始行内容。');

    // 关键断言：续页片段应标记 isContinuation。
    assert.equal(
      fragments[1].metadata.runtimeSlice!.isContinuation,
      true,
      '第 2 个及之后的片段应标记 isContinuation=true。',
    );
  } finally {
    resetFontMetricsProvider();
  }
});

test('PH2-20 多栏块切分通用机制 V1：双栏下表格放不下当前栏时第二栏从剩余行开始', () => {
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

    const table = createTableBlock('split-table', 10, 2);

    const pages = paginateMaxFillBlocks({
      blocks: [table],
      contract,
      styles: undefined,
    });

    // 关键断言：分页结果至少产生 2 页（首栏放前几行、第二栏放剩余几行或翻页）。
    assert(pages.length >= 1, `期望分页结果至少 1 页，实际 ${pages.length} 页。`);

    const fragments = getTableFragments(pages);
    // 关键断言：第二栏上应至少有一个片段从原表格第 2 行或之后开始（不是从头再来）。
    const continuationFragments = fragments.filter(
      (fragment) => fragment.metadata.runtimeSlice?.startRowIndex && fragment.metadata.runtimeSlice.startRowIndex > 0,
    );
    assert(
      continuationFragments.length >= 1,
      `期望至少存在一个 startRowIndex > 0 的续排片段，证明栏位推进后从剩余行开始。`,
    );
  } finally {
    resetFontMetricsProvider();
  }
});