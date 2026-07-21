import assert from 'node:assert/strict';
import test from 'node:test';
import type { DocxLocatorMap, PdfLocatorMap } from './processing';
import { prepareAutomaticQualityQuestions, prepareQualityQuestions } from './quality-evidence';
import { RegistryError } from './types';

const sourceHash = 'a'.repeat(64);

test('PH3-13C3 自动样本证据必须唯一命中并映射 DOCX 结构定位', () => {
  const bodyText = '第一章 入门\n这是唯一证据甲。\n这是唯一证据乙。\n这是唯一证据丙。\n';
  const locatorMap: DocxLocatorMap = {
    schemaVersion: 'layout3_locator_v1',
    sourceFormat: 'docx',
    sourceHash,
    offsetEncoding: 'utf16-code-unit',
    physicalPageNumbersAvailable: false,
    blocks: [
      {
        blockId: 'paragraph-1',
        blockType: 'paragraph',
        startOffset: 0,
        endOffset: bodyText.length,
        headingPath: ['第一章 入门'],
        headingLevel: null,
        paragraphNumber: 1,
        tableNumber: null,
        rowCount: null,
        columnCount: null,
        explicitPageBreaks: [],
      },
    ],
  };

  const prepared = prepareQualityQuestions({
    bodyText,
    locatorMap,
    expectedSourceHash: sourceHash,
    questions: [
      { question: '问题一是什么？', evidence: '这是唯一证据甲。' },
      { question: '问题二是什么？', evidence: '这是唯一证据乙。' },
      { question: '问题三是什么？', evidence: '这是唯一证据丙。' },
    ],
  });

  assert.equal(prepared.length, 3);
  assert.match(prepared[0].locatorLabel, /第一章 入门/);
  assert.equal(prepared[0].evidenceSha256.length, 64);
});

test('PH3-13C3 PDF 证据保留 1-based 原始页码', () => {
  const bodyText = '第一页唯一证据。\n第二页唯一证据甲。\n第二页唯一证据乙。\n第二页唯一证据丙。\n';
  const splitOffset = bodyText.indexOf('第二页');
  const locatorMap: PdfLocatorMap = {
    schemaVersion: 'layout3_locator_v1',
    sourceFormat: 'pdf',
    sourceHash,
    offsetEncoding: 'utf16-code-unit',
    pageCount: 2,
    pages: [
      { pageNumber: 1, startOffset: 0, endOffset: splitOffset, pageWidth: 100, pageHeight: 100, items: [] },
      { pageNumber: 2, startOffset: splitOffset, endOffset: bodyText.length, pageWidth: 100, pageHeight: 100, items: [] },
    ],
  };

  const prepared = prepareQualityQuestions({
    bodyText,
    locatorMap,
    expectedSourceHash: sourceHash,
    questions: [
      { question: '第二页问题一？', evidence: '第二页唯一证据甲。' },
      { question: '第二页问题二？', evidence: '第二页唯一证据乙。' },
      { question: '第二页问题三？', evidence: '第二页唯一证据丙。' },
    ],
  });

  assert.equal(prepared.every((item) => item.locatorLabel === 'PDF 第 2 页'), true);
});

test('PH3-13C3 重复或不存在的正文证据失败关闭', () => {
  const bodyText = '重复证据文本。重复证据文本。其他唯一证据甲。其他唯一证据乙。';
  const locatorMap: DocxLocatorMap = {
    schemaVersion: 'layout3_locator_v1',
    sourceFormat: 'docx',
    sourceHash,
    offsetEncoding: 'utf16-code-unit',
    physicalPageNumbersAvailable: false,
    blocks: [{
      blockId: 'paragraph-1',
      blockType: 'paragraph',
      startOffset: 0,
      endOffset: bodyText.length,
      headingPath: [],
      headingLevel: null,
      paragraphNumber: 1,
      tableNumber: null,
      rowCount: null,
      columnCount: null,
      explicitPageBreaks: [],
    }],
  };

  assert.throws(
    () => prepareQualityQuestions({
      bodyText,
      locatorMap,
      expectedSourceHash: sourceHash,
      questions: [
        { question: '第一个问题？', evidence: '重复证据文本。' },
        { question: '第二个问题？', evidence: '其他唯一证据甲。' },
        { question: '第三个问题？', evidence: '其他唯一证据乙。' },
      ],
    }),
    (error: unknown) => error instanceof RegistryError && error.code === 'QUALITY_BLOCK',
  );
});

test('PH3-13C3 短资料自动抽取一个唯一正文样本', () => {
  const bodyText = '第一条唯一正文证据。\n第二条唯一正文证据。\n第三条唯一正文证据。\n';
  const locatorMap: DocxLocatorMap = {
    schemaVersion: 'layout3_locator_v1',
    sourceFormat: 'docx',
    sourceHash,
    offsetEncoding: 'utf16-code-unit',
    physicalPageNumbersAvailable: false,
    blocks: [{
      blockId: 'paragraph-1',
      blockType: 'paragraph',
      startOffset: 0,
      endOffset: bodyText.length,
      headingPath: ['第一章'],
      headingLevel: null,
      paragraphNumber: 1,
      tableNumber: null,
      rowCount: null,
      columnCount: null,
      explicitPageBreaks: [],
    }],
  };

  const samples = prepareAutomaticQualityQuestions({
    bodyText,
    locatorMap,
    expectedSourceHash: sourceHash,
    title: '自动建议测试资料',
  });

  assert.equal(samples.length, 1);
  assert.equal(samples[0]?.evidenceExcerpt, '第一条唯一正文证据。');
  assert.equal(samples[0]?.question.includes('自动建议测试资料'), true);
});

test('PH3-13C3 四个结构单元自动抽取两个覆盖样本', () => {
  const evidence = Array.from({ length: 4 }, (_, index) => `第 ${index + 1} 段唯一正文证据。`);
  const bodyText = `${evidence.join('\n')}\n`;
  let nextOffset = 0;
  const locatorMap: DocxLocatorMap = {
    schemaVersion: 'layout3_locator_v1',
    sourceFormat: 'docx',
    sourceHash,
    offsetEncoding: 'utf16-code-unit',
    physicalPageNumbersAvailable: false,
    blocks: evidence.map((item, index) => {
      const startOffset = nextOffset;
      const endOffset = startOffset + item.length;
      nextOffset = endOffset + 1;
      return {
        blockId: `paragraph-${index + 1}`,
        blockType: 'paragraph',
        startOffset,
        endOffset,
        headingPath: ['第一章'],
        headingLevel: null,
        paragraphNumber: index + 1,
        tableNumber: null,
        rowCount: null,
        columnCount: null,
        explicitPageBreaks: [],
      };
    }),
  };

  const samples = prepareAutomaticQualityQuestions({
    bodyText,
    locatorMap,
    expectedSourceHash: sourceHash,
    title: '双样本测试资料',
  });

  assert.deepEqual(samples.map((item) => item.evidenceExcerpt), [evidence[0], evidence[3]]);
});

test('PH3-13C3 七个结构单元自动覆盖开头、中部和末尾三个样本', () => {
  const evidence = Array.from({ length: 7 }, (_, index) => `第 ${index + 1} 段唯一正文证据。`);
  const bodyText = `${evidence.join('\n')}\n`;
  let nextOffset = 0;
  const locatorMap: DocxLocatorMap = {
    schemaVersion: 'layout3_locator_v1',
    sourceFormat: 'docx',
    sourceHash,
    offsetEncoding: 'utf16-code-unit',
    physicalPageNumbersAvailable: false,
    blocks: evidence.map((item, index) => {
      const startOffset = nextOffset;
      const endOffset = startOffset + item.length;
      nextOffset = endOffset + 1;
      return {
        blockId: `paragraph-${index + 1}`,
        blockType: 'paragraph',
        startOffset,
        endOffset,
        headingPath: ['第一章'],
        headingLevel: null,
        paragraphNumber: index + 1,
        tableNumber: null,
        rowCount: null,
        columnCount: null,
        explicitPageBreaks: [],
      };
    }),
  };

  const samples = prepareAutomaticQualityQuestions({
    bodyText,
    locatorMap,
    expectedSourceHash: sourceHash,
    title: '覆盖抽样测试资料',
  });

  assert.deepEqual(samples.map((item) => item.evidenceExcerpt), [evidence[0], evidence[3], evidence[6]]);
});
