import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDeterministicFontMetricsProvider,
  resetFontMetricsProvider,
  setFontMetricsProvider,
} from '../font-metrics';
import type { LayoutBlock, LayoutTableCell, LayoutTableRow, TextRun } from './types';
import { resolveTableAutoFitSize } from './tableLayout';

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

function createHeaderOnlyTableBlock(id: string, headers: string[]): LayoutBlock {
  const cells: LayoutTableCell[] = headers.map((header, index) => ({
    id: `${id}-cell-${index}`,
    sourceRange: null,
    textRuns: [createTextRun(`${id}-run-${index}`, header)],
    isHeader: true,
  }));
  const rows: LayoutTableRow[] = [
    {
      id: `${id}-row-0`,
      sourceRange: null,
      cells,
    },
  ];

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
      align: headers.map(() => null),
      rows,
    },
  };
}

test('PH2-10 表格自适应列宽均衡分配 V1：多列短英文表头不应继续卡在最小列宽', () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  try {
    const table = createHeaderOnlyTableBlock('english-short-header-table', [
      'am',
      'is',
      'are',
      'his',
      'her',
      'my',
      'your',
      'he',
      'she',
      'it',
    ]);

    const autoFitSize = resolveTableAutoFitSize(table, {
      contentWidthPx: 768,
      rowHeightPx: 44,
      headerRowHeightPx: 44,
      cellPaddingX: 12,
      cellPaddingY: 10,
      getCellMetrics: () => ({
        fontSizePx: 18,
        lineHeightPx: 28,
      }),
    });

    assert(autoFitSize, '应能计算表格自动适应尺寸。');
    assert.equal(
      autoFitSize.columnWidthsPx.reduce((total, width) => total + width, 0),
      768,
      '自动适应后的列宽总和应填满正文宽度。',
    );
    assert(
      autoFitSize.columnWidthsPx.every((width) => width >= 70),
      `短英文表头列不应继续停在 48px 附近，实际列宽为 ${autoFitSize.columnWidthsPx.join(',')}`,
    );
    assert(
      Math.max(...autoFitSize.columnWidthsPx) - Math.min(...autoFitSize.columnWidthsPx) <= 24,
      `短内容表头的剩余宽度应均衡分配，实际列宽为 ${autoFitSize.columnWidthsPx.join(',')}`,
    );
  } finally {
    resetFontMetricsProvider();
  }
});
