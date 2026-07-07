import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import type { LayoutBlock, TextRun } from '@/engine/document-model';
import { defaultStyleSettings } from '@/engine/style/presets';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import { buildDocxArrayBuffer } from './exportDocx';

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

function createHorizontalRuleBlock(id: string): LayoutBlock {
  return {
    id,
    type: 'horizontalRule',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'horizontalRule',
    },
  };
}

function createChoiceItem(id: string, text: string) {
  return {
    id,
    sourceRange: null,
    textRuns: [createTextRun(`${id}-run`, text)],
    level: 1,
    listKind: 'ordered' as const,
    checked: null,
  };
}

async function readDocumentXmlFromDocx(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  assert(documentXml, '应生成 Word 主文档 XML。');
  return documentXml;
}

function createSingleParagraphPageSettings(
  overrides: Partial<typeof defaultStyleSettings>,
): { settings: typeof defaultStyleSettings; block: LayoutBlock } {
  const settings = {
    ...defaultStyleSettings,
    ...overrides,
  };
  const block = createParagraphBlock('page-size-paragraph', '页面规格测试');
  return { settings, block };
}

test('PH2-22F DOCX 选项组：使用 run 内制表符导出而不是无边框表格', async () => {
  const choiceBlock: LayoutBlock = {
    id: 'choice-list',
    type: 'list',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'list',
      ordered: true,
      start: 1,
      spread: false,
      items: [
        createChoiceItem('choice-a', 'A. 一个人'),
        createChoiceItem('choice-b', 'B. 两个人'),
        createChoiceItem('choice-c', 'C. 三个人'),
        createChoiceItem('choice-d', 'D. 四个人'),
      ],
    },
  };
  const contract = resolveStyleContract(defaultStyleSettings);
  const docxBuffer = await buildDocxArrayBuffer({
    title: 'DOCX 选项组制表位烟测',
    blocks: [choiceBlock],
    pages: [
      {
        pageNumber: 1,
        blocks: [choiceBlock],
        contract,
        warnings: [],
      },
    ],
    styleSettings: defaultStyleSettings,
  });
  const zip = await JSZip.loadAsync(docxBuffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');

  assert(documentXml, '应生成 Word 主文档 XML。');
  assert.match(documentXml, /<w:tabs>/u, '紧凑选项组段落应声明制表位。');
  assert.match(documentXml, /<w:tab w:val="left"/u, '紧凑选项组应使用左对齐制表位。');
  assert.match(documentXml, /<w:r><w:tab\/><\/w:r>/u, '同一行多个选项之间应写入 Word/WPS 更稳定识别的 run 内 Tab。');
  assert.doesNotMatch(documentXml, /<w:tbl>/u, '紧凑选项组不应再导出为 Word 表格。');
});

test('PH2-23 DOCX 分割线移除：horizontalRule 块不再导出 thematic break', async () => {
  const beforeBlock = createParagraphBlock('before-paragraph', '上文');
  const ruleBlock = createHorizontalRuleBlock('legacy-rule');
  const afterBlock = createParagraphBlock('after-paragraph', '下文');
  const contract = resolveStyleContract(defaultStyleSettings);
  const docxBuffer = await buildDocxArrayBuffer({
    title: 'DOCX 分割线移除验证',
    blocks: [beforeBlock, ruleBlock, afterBlock],
    pages: [
      {
        pageNumber: 1,
        blocks: [beforeBlock, ruleBlock, afterBlock],
        contract,
        warnings: [],
      },
    ],
    styleSettings: defaultStyleSettings,
  });
  const zip = await JSZip.loadAsync(docxBuffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');

  assert(documentXml, '应生成 Word 主文档 XML。');
  assert.match(documentXml, /上文/u, 'DOCX 中应继续保留分割线前的段落。');
  assert.match(documentXml, /下文/u, 'DOCX 中应继续保留分割线后的段落。');
  assert.doesNotMatch(documentXml, /<w:pBdr>/u, 'DOCX 中不应再为 horizontalRule 输出 thematic break 边框。');
});

test('PH2-21B DOCX A3 纵向页面规格：输出标准纵向宽高', async () => {
  const { settings, block } = createSingleParagraphPageSettings({
    pageSize: 'A3',
    orientation: 'portrait',
  });
  const contract = resolveStyleContract(settings);
  const docxBuffer = await buildDocxArrayBuffer({
    title: 'A3 纵向页面规格验证',
    blocks: [block],
    pages: [
      {
        pageNumber: 1,
        blocks: [block],
        contract,
        warnings: [],
      },
    ],
    styleSettings: settings,
  });
  const documentXml = await readDocumentXmlFromDocx(docxBuffer);

  assert.match(
    documentXml,
    /<w:pgSz[^>]*w:w="16838"[^>]*w:h="23811"[^>]*w:orient="portrait"/u,
    'A3 纵向应输出 297mm x 420mm 的页面宽高。',
  );
});

test('PH2-21B DOCX A3 横向页面规格：输出标准横向宽高', async () => {
  const { settings, block } = createSingleParagraphPageSettings({
    pageSize: 'A3',
    orientation: 'landscape',
  });
  const contract = resolveStyleContract(settings);
  const docxBuffer = await buildDocxArrayBuffer({
    title: 'A3 横向页面规格验证',
    blocks: [block],
    pages: [
      {
        pageNumber: 1,
        blocks: [block],
        contract,
        warnings: [],
      },
    ],
    styleSettings: settings,
  });
  const documentXml = await readDocumentXmlFromDocx(docxBuffer);

  assert.match(
    documentXml,
    /<w:pgSz[^>]*w:w="23811"[^>]*w:h="16838"[^>]*w:orient="landscape"/u,
    'A3 横向应输出 420mm x 297mm 的页面宽高，避免 Word/WPS 把横向页当成纵向尺寸。',
  );
});
