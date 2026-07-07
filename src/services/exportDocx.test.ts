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

function createEquationBlock(id: string, value: string): LayoutBlock {
  return {
    id,
    type: 'equation',
    sourceRange: null,
    blockStyleRef: 'equation',
    blockStyleOverrides: {},
    textRuns: [createTextRun(`${id}-run`, value)],
    pagination: {},
    metadata: {
      kind: 'equation',
      value,
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

test('PH2-21C DOCX 公式：块级公式与行内公式导出为 Word 原生 Office Math', async () => {
  const paragraphBlock = createParagraphBlock('inline-equation-paragraph', '行内公式 $x^2 + \\frac{a}{b}$ 结束');
  const equationBlock = createEquationBlock('native-equation', '\\sqrt[n]{x}+\\sum_{i=1}^{n} x_i');
  const contract = resolveStyleContract(defaultStyleSettings);
  const docxBuffer = await buildDocxArrayBuffer({
    title: 'DOCX 原生公式验证',
    blocks: [paragraphBlock, equationBlock],
    pages: [
      {
        pageNumber: 1,
        blocks: [paragraphBlock, equationBlock],
        contract,
        warnings: [],
      },
    ],
    styleSettings: defaultStyleSettings,
  });
  const documentXml = await readDocumentXmlFromDocx(docxBuffer);

  assert.match(documentXml, /<m:oMath>/u, 'DOCX 中应生成 Word 原生公式根节点。');
  assert.match(documentXml, /<m:f>/u, '行内分式应导出为 Office Math 分式。');
  assert.match(documentXml, /<m:sSup>/u, '行内上标应导出为 Office Math 上标。');
  assert.match(documentXml, /<m:rad>/u, '块级根号应导出为 Office Math 根号。');
  assert.match(documentXml, /<m:nary>/u, '块级求和应导出为 Office Math n 元运算结构。');
  assert.doesNotMatch(documentXml, /\$x\^2 \+ \\frac\{a\}\{b\}\$/u, '行内公式不应继续以 `$...$` 源码直出。');
  assert.doesNotMatch(documentXml, /\\sqrt\[n\]\{x\}/u, '块级公式不应继续以 LaTeX 根号源码直出。');
});

test('PH2-21D DOCX 公式：转义字面量导出时不保留多余反斜杠', async () => {
  const paragraphBlock = createParagraphBlock('escaped-literal-equation-paragraph', '行内百分比 $30\\%$ 结束');
  const equationBlock = createEquationBlock(
    'escaped-literal-equation',
    '30\\% + A\\&B + \\#1 + x\\_1 + \\$100 + \\{a\\} + a\\backslash b',
  );
  const contract = resolveStyleContract(defaultStyleSettings);
  const docxBuffer = await buildDocxArrayBuffer({
    title: 'DOCX 公式转义字符验证',
    blocks: [paragraphBlock, equationBlock],
    pages: [
      {
        pageNumber: 1,
        blocks: [paragraphBlock, equationBlock],
        contract,
        warnings: [],
      },
    ],
    styleSettings: defaultStyleSettings,
  });
  const documentXml = await readDocumentXmlFromDocx(docxBuffer);

  assert.match(documentXml, /<m:t>%<\/m:t>/u, '`\\%` 应导出为 `%`。');
  assert.match(documentXml, /<m:t>&amp;<\/m:t>/u, '`\\&` 应导出为 `&`，XML 中会转义为 `&amp;`。');
  assert.match(documentXml, /<m:t>#<\/m:t>/u, '`\\#` 应导出为 `#`。');
  assert.match(documentXml, /<m:t>_<\/m:t>/u, '`\\_` 应导出为 `_`。');
  assert.match(documentXml, /<m:t>\$<\/m:t>/u, '`\\$` 应导出为 `$`。');
  assert.match(documentXml, /<m:t>\{<\/m:t>/u, '`\\{` 应导出为 `{`。');
  assert.match(documentXml, /<m:t>\}<\/m:t>/u, '`\\}` 应导出为 `}`。');
  assert.match(documentXml, /<m:t>\\<\/m:t>/u, '`\\backslash` 应导出为反斜杠字符。');
  assert.doesNotMatch(
    documentXml,
    /\\%|\\&|\\#|\\_|\\\$|\\\{|\\\}|\\backslash/u,
    'DOCX 公式 XML 中不应继续保留 LaTeX 转义源码。',
  );
});

test('PH2-21E DOCX 公式：常见单行公式兼容增强后不再整条退回源码', async () => {
  const paragraphBlock = createParagraphBlock(
    'compat-inline-equation-paragraph',
    '行内兼容 $\\mathrm{H_2O} \\neq 0 \\land P\\Rightarrow Q$ 结束',
  );
  const equationBlock = createEquationBlock(
    'compat-block-equation',
    '\\mathbf{x}+\\mathit{y}+\\bar{z}+\\hat{w}+\\vec{v}+\\overline{AB}+\\left\\{x\\mid x\\in A\\right\\}+a\\lt b\\lor b\\gt c',
  );
  const contract = resolveStyleContract(defaultStyleSettings);
  const docxBuffer = await buildDocxArrayBuffer({
    title: 'DOCX 公式兼容增强验证',
    blocks: [paragraphBlock, equationBlock],
    pages: [
      {
        pageNumber: 1,
        blocks: [paragraphBlock, equationBlock],
        contract,
        warnings: [],
      },
    ],
    styleSettings: defaultStyleSettings,
  });
  const documentXml = await readDocumentXmlFromDocx(docxBuffer);

  assert.match(documentXml, /<m:acc>/u, 'accent / overline 应导出为 Office Math accent 结构。');
  assert.match(documentXml, /<m:sSub>/u, '`\\mathrm{H_2O}` 中的下标应继续导出为 Office Math 下标。');
  assert.match(documentXml, /<m:t>≠<\/m:t>/u, '`\\neq` 应导出为 `≠`。');
  assert.match(documentXml, /<m:t>∧<\/m:t>/u, '`\\land` 应导出为 `∧`。');
  assert.match(documentXml, /<m:t>⇒<\/m:t>/u, '`\\Rightarrow` 应导出为 `⇒`。');
  assert.match(documentXml, /<m:t>∨<\/m:t>/u, '`\\lor` 应导出为 `∨`。');
  assert.match(documentXml, /<m:t>∣<\/m:t>/u, '`\\mid` 应导出为 `∣`。');
  assert.match(documentXml, /<m:t>&lt;<\/m:t>/u, '`\\lt` 应导出为 `<`，XML 中会转义为 `&lt;`。');
  assert.match(documentXml, /<m:t>(?:>|&gt;)<\/m:t>/u, '`\\gt` 应导出为 `>`。');
  assert.doesNotMatch(
    documentXml,
    /\\mathrm|\\mathbf|\\mathit|\\bar|\\hat|\\vec|\\overline|\\neq|\\land|\\Rightarrow|\\mid|\\lt|\\gt|\\lor/u,
    '这些高频单行公式节点不应再让整条公式以 LaTeX 源码写入 DOCX。',
  );
});

test('PH2-21F DOCX 公式：方程组与分段函数的大括号多行结构不再整条退回源码', async () => {
  const paragraphBlock = createParagraphBlock(
    'system-inline-equation-paragraph',
    '行内方程组 $\\left\\{\\begin{array}{l}x+y=1\\\\2x-y=3\\end{array}\\right.$ 结束',
  );
  const equationBlock = createEquationBlock(
    'system-block-equation',
    '\\begin{cases}x+y=1\\\\2x-y=3\\end{cases}+\\left\\{\\begin{aligned}x+y&=1\\\\2x-y&=3\\end{aligned}\\right.',
  );
  const contract = resolveStyleContract(defaultStyleSettings);
  const docxBuffer = await buildDocxArrayBuffer({
    title: 'DOCX 方程组大括号验证',
    blocks: [paragraphBlock, equationBlock],
    pages: [
      {
        pageNumber: 1,
        blocks: [paragraphBlock, equationBlock],
        contract,
        warnings: [],
      },
    ],
    styleSettings: defaultStyleSettings,
  });
  const documentXml = await readDocumentXmlFromDocx(docxBuffer);

  assert.match(documentXml, /<m:eqArr>/u, '方程组 / 分段函数应导出为 Office Math 多行方程数组。');
  assert.match(documentXml, /<m:d>/u, '方程组 / 分段函数应导出为 Office Math 定界符结构。');
  assert.match(documentXml, /<m:begChr m:val="\{"/u, '应输出左大括号起始定界符。');
  assert.match(documentXml, /<m:endChr m:val="\."/u, '应输出右侧省略定界符。');
  assert.doesNotMatch(
    documentXml,
    /\\begin\{cases\}|\\begin\{aligned\}|\\begin\{array\}|\\end\{cases\}|\\end\{aligned\}|\\end\{array\}/u,
    '方程组 / 分段函数不应继续整条以 LaTeX 环境源码写入 DOCX。',
  );
});

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
