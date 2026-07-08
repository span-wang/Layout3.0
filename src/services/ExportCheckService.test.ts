import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ImageBlockMetadata,
  type LayoutBlock,
  type LayoutDocument,
  type LayoutImageResource,
  type TextRun,
} from '@/engine/document-model';
import { defaultStyleSettings } from '@/engine/style/presets';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import type { PageLayout } from '@/engine/typesetting/types';
import {
  getExportCheckItemsForTarget,
  runExportChecks,
} from './ExportCheckService';

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

function createImageBlock(id: string, overrides?: Partial<ImageBlockMetadata>): LayoutBlock {
  return {
    id,
    type: 'image',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'image',
      src: '',
      alt: '',
      title: null,
      wrapMode: 'inline',
      wrapSide: 'right',
      showCaption: false,
      offsetX: 0,
      offsetY: 0,
      ...overrides,
    },
  };
}

function createColumnSectionBlock(id: string, nestedBlocks: LayoutBlock[]): LayoutBlock {
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
      columnGapMm: 5,
      divider: false,
      headingsSpanAll: true,
      blocks: nestedBlocks,
    },
  };
}

function createDocument(blocks: LayoutBlock[], resources: Array<LayoutImageResource> = []): LayoutDocument {
  return {
    version: '1.0.0',
    id: 'test-document',
    title: '测试文档',
    source: '',
    blocks,
    resources,
    styles: {
      blockStyles: {},
      textStyles: {},
    },
    template: {
      templateId: null,
      templateOverrides: {},
    },
    viewState: {
      answerDisplayMode: 'show',
      answerBlockPlacementMode: 'inline',
      zoom: 1,
      selectedNodeId: null,
    },
    meta: {
      sourceFormat: 'markdown',
      wordCount: 0,
      characterCount: 0,
      blockCount: blocks.length,
      updatedAt: new Date(0).toISOString(),
    },
  };
}

function createPageLayouts(blocks: LayoutBlock[]): PageLayout[] {
  return [
    {
      pageNumber: 1,
      blocks,
      contract: resolveStyleContract(defaultStyleSettings),
      warnings: [],
    },
  ];
}

test('PH4-02 导出检查：局部分栏会提示 DOCX 内容风险', () => {
  const nestedParagraph = createParagraphBlock('column-nested-paragraph', '局部分栏内容');
  const columnSection = createColumnSectionBlock('column-section-1', [nestedParagraph]);
  const document = createDocument([columnSection]);

  const result = runExportChecks({
    layoutDocument: document,
    renderableBlocks: document.blocks,
    pages: createPageLayouts(document.blocks),
    styleSettings: defaultStyleSettings,
    tocItems: [],
    documentFilePath: 'C:\\workspace\\demo.layout',
    workspaceRootPath: 'C:\\workspace',
  });

  const docxItems = getExportCheckItemsForTarget(result, 'docx');
  assert(docxItems.some((item) => item.severity === 'error' && item.title.includes('局部分栏')), '局部分栏应提示 DOCX 内容风险。');
});

test('PH4-02 导出检查：图片空路径和复杂绕排都会被识别', () => {
  const emptyImage = createImageBlock('image-empty');
  const floatingImage = createImageBlock('image-floating', {
    src: 'assets/demo.png',
    alt: '示例图',
    title: '示例图',
    wrapMode: 'square',
    offsetX: 18,
  });
  const document = createDocument([emptyImage, floatingImage], [
    {
      id: 'resource-floating',
      type: 'image',
      src: 'assets/demo.png',
      alt: '示例图',
      title: '示例图',
      blockId: 'image-floating',
    },
  ]);

  const result = runExportChecks({
    layoutDocument: document,
    renderableBlocks: document.blocks,
    pages: createPageLayouts(document.blocks),
    styleSettings: defaultStyleSettings,
    tocItems: [],
    documentFilePath: null,
    workspaceRootPath: null,
  });

  assert(result.items.some((item) => item.severity === 'error' && item.title.includes('缺少图片路径')), '空图片路径应被标记为错误。');

  const docxItems = getExportCheckItemsForTarget(result, 'docx');
  assert(docxItems.some((item) => item.title.includes('复杂文字绕排')), '复杂图片绕排应提示 DOCX 不保真。');
  assert(docxItems.some((item) => item.title.includes('自由拖动偏移')), '图片自由拖动偏移应提示 DOCX 不保真。');
});

test('PH4-02 导出检查：答案模式与复杂公式会给出导出提醒', () => {
  const paragraph = createParagraphBlock(
    'equation-paragraph',
    '行内公式 $\\begin{matrix}a&b\\\\c&d\\end{matrix}$',
  );
  const document = createDocument([paragraph]);
  document.viewState.answerDisplayMode = 'hide';

  const result = runExportChecks({
    layoutDocument: document,
    renderableBlocks: document.blocks,
    pages: createPageLayouts(document.blocks),
    styleSettings: defaultStyleSettings,
    tocItems: [],
    documentFilePath: 'C:\\workspace\\demo.layout',
    workspaceRootPath: 'C:\\workspace',
  });

  assert(result.items.some((item) => item.category === '答案视图' && item.severity === 'notice'), '答案显示模式应给出导出提醒。');

  const docxItems = getExportCheckItemsForTarget(result, 'docx');
  assert(docxItems.some((item) => item.title.includes('行内公式包含 矩阵或行列式')), '复杂公式应提示 DOCX 兼容风险。');
});

test('PH4-07 导出检查：图片水印缺少路径时会提示 PDF 风险', () => {
  const document = createDocument([createParagraphBlock('paragraph-1', '水印测试')]);
  const styleSettings = {
    ...defaultStyleSettings,
    pdfWatermark: {
      ...defaultStyleSettings.pdfWatermark,
      enabled: true,
      kind: 'image' as const,
      image: {
        ...defaultStyleSettings.pdfWatermark.image,
        imageSrc: '',
      },
    },
  };

  const result = runExportChecks({
    layoutDocument: document,
    renderableBlocks: document.blocks,
    pages: createPageLayouts(document.blocks),
    styleSettings,
    tocItems: [],
    documentFilePath: 'C:\\workspace\\demo.layout',
    workspaceRootPath: 'C:\\workspace',
  });

  const pdfItems = getExportCheckItemsForTarget(result, 'pdf');
  assert(
    pdfItems.some((item) => item.category === '水印' && item.severity === 'error' && item.title.includes('缺少图片路径')),
    '图片水印缺少路径时应提示 PDF 导出风险。',
  );
});
