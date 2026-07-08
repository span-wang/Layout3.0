import assert from 'node:assert/strict';
import test from 'node:test';
import type { LayoutBlock, LayoutStyleSheet, TextRun } from '@/engine/document-model';
import { buildExportHtml } from '@/services/exportHtml';
import { defaultStyleSettings } from './presets';
import { resolveStyleContract } from './resolveContract';
import {
  applyQuickBlockStyleRulesToBlocks,
  applyQuickBlockStyleToStyleSheet,
  resolveEffectiveBlockStyleOverrides,
} from './quickBlockStyle';

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

function createParagraphBlock(
  id: string,
  text: string,
  blockStyleOverrides: LayoutBlock['blockStyleOverrides'] = {},
): LayoutBlock {
  return {
    id,
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides,
    textRuns: [createTextRun(`${id}-run`, text)],
    pagination: {},
    metadata: {
      kind: 'paragraph',
      text,
    },
  };
}

function createHeadingBlock(id: string, depth: 1 | 2 | 3 | 4, text: string): LayoutBlock {
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

function createBlockquoteBlock(id: string, blocks: LayoutBlock[]): LayoutBlock {
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
      blocks,
    },
  };
}

function createEmptyStyleSheet(): LayoutStyleSheet {
  return {
    blockStyles: {},
    textStyles: {},
  };
}

test('PH2-14 同类块段落样式规则写入 styles.blockStyles，不污染当前块覆盖', () => {
  const styleSheet = createEmptyStyleSheet();
  const nextStyleSheet = applyQuickBlockStyleToStyleSheet(styleSheet, 'paragraph', {
    textAlign: 'center',
    lineHeight: 31.6,
    spaceBefore: 12,
    spaceAfter: 8,
  });

  assert.deepEqual(styleSheet.blockStyles, {}, '原始样式表不应被原地修改。');
  assert.deepEqual(
    nextStyleSheet.blockStyles['quickBlockStyle.paragraph'],
    {
      textAlign: 'center',
      lineHeight: 32,
      spaceBefore: 12,
      spaceAfter: 8,
    },
    '段落同类块规则应写入 quickBlockStyle.paragraph。',
  );
});

test('PH2-14 同类块规则按块类型合并，当前块局部覆盖优先', () => {
  const paragraph = createParagraphBlock('paragraph-a', '正文');
  const localParagraph = createParagraphBlock('paragraph-b', '局部正文', { lineHeight: 44 });
  const heading = createHeadingBlock('heading-a', 1, '一级标题');
  const styles: LayoutStyleSheet = {
    blockStyles: {
      'quickBlockStyle.paragraph': {
        lineHeight: 30,
        spaceAfter: 8,
      },
      'quickBlockStyle.heading1': {
        textAlign: 'center',
      },
    },
    textStyles: {},
  };

  const [nextParagraph, nextLocalParagraph, nextHeading] = applyQuickBlockStyleRulesToBlocks(
    [paragraph, localParagraph, heading],
    styles,
  );

  assert.deepEqual(
    nextParagraph.blockStyleOverrides,
    { lineHeight: 30, spaceAfter: 8 },
    '普通段落应继承段落同类块规则。',
  );
  assert.deepEqual(
    nextLocalParagraph.blockStyleOverrides,
    { lineHeight: 44, spaceAfter: 8 },
    '局部行高覆盖应压过同类块行高，同时继续继承其他字段。',
  );
  assert.deepEqual(
    nextHeading.blockStyleOverrides,
    { textAlign: 'center' },
    '一级标题应命中 heading1 同类块规则。',
  );
  assert.deepEqual(
    resolveEffectiveBlockStyleOverrides(localParagraph, styles),
    { lineHeight: 44, spaceAfter: 8 },
    '直接解析有效块样式时也应保持局部覆盖优先。',
  );
});

test('PH2-14 同类块规则会递归作用到引用和局部分栏内部块', () => {
  const nestedParagraph = createParagraphBlock('nested-paragraph', '引用内正文');
  const blockquote = createBlockquoteBlock('quote-a', [nestedParagraph]);
  const styles: LayoutStyleSheet = {
    blockStyles: {
      'quickBlockStyle.paragraph': {
        textAlign: 'justify',
        lineHeight: 34,
      },
    },
    textStyles: {},
  };

  const [nextBlockquote] = applyQuickBlockStyleRulesToBlocks([blockquote], styles);

  assert.equal(nextBlockquote.metadata.kind, 'blockquote', '测试块应保持为引用块。');
  if (nextBlockquote.metadata.kind !== 'blockquote') {
    return;
  }

  assert.deepEqual(
    nextBlockquote.metadata.blocks[0]?.blockStyleOverrides,
    { textAlign: 'justify', lineHeight: 34 },
    '引用内部段落也应继承段落同类块规则。',
  );
});

test('PH2-14 HTML/PDF 导出入口直接消费同类块规则', () => {
  const paragraph = createParagraphBlock('paragraph-export', '导出正文');
  const styles: LayoutStyleSheet = {
    blockStyles: {
      'quickBlockStyle.paragraph': {
        textAlign: 'center',
        lineHeight: 32,
        spaceBefore: 12,
        spaceAfter: 8,
      },
    },
    textStyles: {},
  };
  const contract = resolveStyleContract(defaultStyleSettings);

  const html = buildExportHtml({
    title: '同类块规则导出验证',
    pages: [
      {
        pageNumber: 1,
        blocks: [paragraph],
        contract,
        warnings: [],
      },
    ],
    styles,
    styleSettings: defaultStyleSettings,
  });

  assert.match(html, /text-align:center/u, 'HTML/PDF 导出应输出同类块对齐。');
  assert.match(html, /line-height:32px/u, 'HTML/PDF 导出应输出同类块行高。');
  assert.match(html, /margin-top:12px/u, 'HTML/PDF 导出应输出同类块段前距。');
  assert.match(html, /margin-bottom:8px/u, 'HTML/PDF 导出应输出同类块段后距。');
});
