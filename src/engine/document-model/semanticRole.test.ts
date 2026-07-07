import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExportHtml } from '@/services/exportHtml';
import { defaultStyleSettings } from '@/engine/style/presets';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import {
  createDeterministicFontMetricsProvider,
  resetFontMetricsProvider,
  setFontMetricsProvider,
} from '@/engine/font-metrics';
import { paginateBlocks } from '@/engine/typesetting';
import {
  applySemanticPresetToLayoutBlock,
  applySemanticToLayoutBlock,
  applySemanticKeywordRulesToBlocks,
  createLayoutDocumentFromMarkdown,
  getRenderableLayoutBlocksForView,
  getManualSemanticBlockPresetId,
  getPreSemanticBlockPresetId,
  getResolvedSemanticBlockPresetId,
  normalizeLayoutDocumentSyntaxMappingConfig,
  normalizeSemanticRoleConfig,
  scanSemanticKeywordRulesInBlocks,
  shouldRenderTextRunAsDictationBlank,
} from './index';
import type { LayoutBlock, TextRun } from './types';

function getTextFromRuns(textRuns: Array<{ text: string }>): string {
  return textRuns.map((run) => run.text).join('');
}

test('PH2-07 自定义语义块规则：关键词前缀可批量写入语义并保留正文格式', async () => {
  const semanticRoleConfig = normalizeSemanticRoleConfig({
    customRoles: [
      {
        id: 'custom-answer-analysis',
        name: '答案解析',
        enabled: true,
        color: '#3b82f6',
        defaultBlockPresetId: 'softCard',
      },
    ],
    keywordRules: [
      {
        id: 'rule-answer-analysis',
        roleId: 'custom-answer-analysis',
        keyword: '【答案解析】',
        matchMode: 'prefix',
        stripKeyword: true,
        enabled: true,
      },
    ],
  });
  const document = await createLayoutDocumentFromMarkdown('【答案解析】**先看定义域**，再判断单调性。');

  const scanResult = scanSemanticKeywordRulesInBlocks(document.blocks, semanticRoleConfig);
  assert.equal(scanResult.applicableCount, 1);
  assert.equal(scanResult.items[0]?.roleName, '答案解析');

  const applyResult = applySemanticKeywordRulesToBlocks(document.blocks, semanticRoleConfig);
  assert.equal(applyResult.didUpdate, true);
  assert.equal(applyResult.applicableCount, 1);

  const paragraph = applyResult.blocks[0];
  assert(paragraph, '应保留原段落块。');
  assert.equal(paragraph.semantic?.roleId, 'custom-answer-analysis');
  assert.equal(paragraph.semantic?.alias, '答案解析');
  assert.equal(paragraph.semantic?.source, 'keyword');
  assert.equal(getTextFromRuns(paragraph.textRuns), '先看定义域，再判断单调性。');
  assert(paragraph.textRuns.some((run) => run.text === '先看定义域' && run.marks.some((mark) => mark.type === 'bold')));
});

test('PH2-07 自定义语义块规则：旧文档缺少语义配置时回退为空配置', async () => {
  const document = await createLayoutDocumentFromMarkdown('普通段落');
  const normalizedDocument = normalizeLayoutDocumentSyntaxMappingConfig({
    ...document,
    meta: {
      ...document.meta,
      semanticRoleConfig: undefined,
    },
  });

  assert.deepEqual(normalizedDocument.meta.semanticRoleConfig, {
    version: '1.0.0',
    customRoles: [],
    keywordRules: [],
  });
  assert.equal(normalizedDocument.viewState.answerBlockPlacementMode, 'inline');
});

test('PH2-24 默写下划线保护：纯题号式下划线不应进入挖空', () => {
  const createUnderlineRun = (text: string): TextRun => ({
    id: `run-${text}`,
    text,
    sourceRange: null,
    marks: [{ type: 'underline' }],
    charStyleRef: null,
    styleOverrides: {},
    annotations: [],
  });

  assert.equal(shouldRenderTextRunAsDictationBlank(createUnderlineRun('二氧化碳'), 'underline'), true);
  assert.equal(shouldRenderTextRunAsDictationBlank(createUnderlineRun('1.'), 'underline'), false);
  assert.equal(shouldRenderTextRunAsDictationBlank(createUnderlineRun('（1）'), 'underline'), false);
});

test('PH2-24 试卷答案位置：文末统一时顶层答案解析块应移动到末尾，隐藏时不参与正文', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    'role:题干 第一题',
    '普通说明',
    'role:答案 A',
    'role:解析 因为条件成立',
  ].join('\n\n'));

  const endPlacementDocument = normalizeLayoutDocumentSyntaxMappingConfig({
    ...document,
    viewState: {
      ...document.viewState,
      answerDisplayMode: 'show',
      answerBlockPlacementMode: 'document-end',
    },
  });
  const endPlacementBlocks = getRenderableLayoutBlocksForView(endPlacementDocument);
  assert.deepEqual(
    endPlacementBlocks.map((block) => block.semantic?.roleId ?? 'content'),
    ['question', 'content', 'answer', 'explanation'],
    '文末统一时应把顶层答案、解析块移动到正文末尾。',
  );

  const hiddenDocument = normalizeLayoutDocumentSyntaxMappingConfig({
    ...document,
    viewState: {
      ...document.viewState,
      answerDisplayMode: 'hide',
      answerBlockPlacementMode: 'document-end',
    },
  });
  const hiddenBlocks = getRenderableLayoutBlocksForView(hiddenDocument);
  assert.deepEqual(
    hiddenBlocks.map((block) => block.semantic?.roleId ?? 'content'),
    ['question', 'content'],
    '隐藏答案解析时不应继续保留顶层答案、解析块。',
  );
});

test('PH2-24A 自定义语义：名称包含答案/解析时应参与文末统一与隐藏', async () => {
  const semanticRoleConfig = normalizeSemanticRoleConfig({
    customRoles: [
      {
        id: 'custom-answer-analysis',
        name: '答案解析',
        enabled: true,
        color: '#2563eb',
      },
    ],
    keywordRules: [],
  });
  const document = await createLayoutDocumentFromMarkdown('普通正文');
  const customSolutionBlock: LayoutBlock = {
    id: 'custom-answer-analysis-block',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [
      {
        id: 'custom-answer-analysis-run',
        text: '先看定义域，再判断单调性。',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
    ],
    pagination: {},
    semantic: {
      roleId: 'custom-answer-analysis',
      alias: '答案解析',
      source: 'manual',
    },
    metadata: {
      kind: 'paragraph',
      text: '先看定义域，再判断单调性。',
    },
  };

  const endPlacementDocument = normalizeLayoutDocumentSyntaxMappingConfig({
    ...document,
    blocks: [...document.blocks, customSolutionBlock],
    viewState: {
      ...document.viewState,
      answerDisplayMode: 'show',
      answerBlockPlacementMode: 'document-end',
    },
    meta: {
      ...document.meta,
      semanticRoleConfig,
    },
  });
  const endPlacementBlocks = getRenderableLayoutBlocksForView(endPlacementDocument);
  assert.equal(
    endPlacementBlocks[endPlacementBlocks.length - 1]?.id,
    'custom-answer-analysis-block',
    '名称包含答案/解析的自定义语义块应参与文末统一。',
  );

  const hiddenDocument = normalizeLayoutDocumentSyntaxMappingConfig({
    ...endPlacementDocument,
    viewState: {
      ...endPlacementDocument.viewState,
      answerDisplayMode: 'hide',
    },
  });
  const hiddenBlocks = getRenderableLayoutBlocksForView(hiddenDocument);
  assert.equal(
    hiddenBlocks.some((block) => block.id === 'custom-answer-analysis-block'),
    false,
    '名称包含答案/解析的自定义语义块在隐藏模式下不应继续显示。',
  );
});

test('PH2-24A 引用容器：内部答案解析子块应参与文末统一与隐藏', async () => {
  const document = await createLayoutDocumentFromMarkdown('> role:答案 A\n>\n> 普通说明\n\n结尾正文');
  const endPlacementDocument = normalizeLayoutDocumentSyntaxMappingConfig({
    ...document,
    viewState: {
      ...document.viewState,
      answerDisplayMode: 'show',
      answerBlockPlacementMode: 'document-end',
    },
  });
  const endPlacementBlocks = getRenderableLayoutBlocksForView(endPlacementDocument);
  assert.equal(endPlacementBlocks.length, 3, '引用容器内答案抽出后应保留剩余正文壳和文末答案块。');
  assert.equal(endPlacementBlocks[0]?.type, 'blockquote');
  assert(endPlacementBlocks[0]?.metadata.kind === 'blockquote');
  assert.equal(endPlacementBlocks[0].metadata.blocks.length, 1, '引用容器内应只剩普通说明子块。');
  assert.equal(endPlacementBlocks[0].metadata.blocks[0]?.semantic?.roleId, undefined);
  assert.equal(endPlacementBlocks[2]?.semantic?.roleId, 'answer', '引用容器内答案块应被提到文末。');

  const hiddenDocument = normalizeLayoutDocumentSyntaxMappingConfig({
    ...document,
    viewState: {
      ...document.viewState,
      answerDisplayMode: 'hide',
      answerBlockPlacementMode: 'document-end',
    },
  });
  const hiddenBlocks = getRenderableLayoutBlocksForView(hiddenDocument);
  assert.equal(hiddenBlocks.length, 2, '隐藏模式下引用容器仍应保留普通说明与其他正文。');
  assert.equal(hiddenBlocks.some((block) => block.semantic?.roleId === 'answer'), false);
});

test('PH2-24B 答案隐藏：隐藏后的视图块应能稳定进入分页输入', async () => {
  setFontMetricsProvider(createDeterministicFontMetricsProvider());
  const document = await createLayoutDocumentFromMarkdown('> role:答案 A\n>\n> 普通说明\n\n结尾正文');
  try {
    const hiddenDocument = normalizeLayoutDocumentSyntaxMappingConfig({
      ...document,
      viewState: {
        ...document.viewState,
        answerDisplayMode: 'hide',
        answerBlockPlacementMode: 'document-end',
      },
    });
    const hiddenBlocks = getRenderableLayoutBlocksForView(hiddenDocument);
    const pages = paginateBlocks(hiddenBlocks, resolveStyleContract(defaultStyleSettings), {
      styles: hiddenDocument.styles,
    });

    assert(pages.length > 0, '隐藏答案后的正文仍应能生成分页结果。');
    assert.equal(
      pages.flatMap((page) => page.blocks).some((block) => block.semantic?.roleId === 'answer'),
      false,
      '分页输入和分页结果都不应残留被隐藏的答案块。',
    );
  } finally {
    resetFontMetricsProvider();
  }
});

test('PH2-23 旧文档恢复：规范化时应自动清掉 legacy horizontalRule 块', async () => {
  const document = await createLayoutDocumentFromMarkdown('普通段落');
  const paragraph = document.blocks[0];
  assert(paragraph, '应先保留一个普通段落。');

  const legacyRuleBlock: LayoutBlock = {
    id: 'legacy-horizontal-rule',
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

  const normalizedDocument = normalizeLayoutDocumentSyntaxMappingConfig({
    ...document,
    blocks: [paragraph, legacyRuleBlock],
  });

  assert.equal(
    normalizedDocument.blocks.some((block) => block.type === 'horizontalRule'),
    false,
    '旧 `.layout` 文档恢复时不应继续保留 horizontalRule 块。',
  );
  assert.equal(normalizedDocument.blocks.length, 1, '规范化后应只剩原有正文块。');
});

test('PH2-07 语义块样式绑定：导出 HTML 带语义标签和自定义颜色变量', async () => {
  const semanticRoleConfig = normalizeSemanticRoleConfig({
    customRoles: [
      {
        id: 'custom-answer-analysis',
        name: '答案解析',
        enabled: true,
        color: '#3b82f6',
        defaultBlockPresetId: 'softCard',
      },
    ],
    keywordRules: [
      {
        id: 'rule-answer-analysis',
        roleId: 'custom-answer-analysis',
        keyword: '【答案解析】',
        matchMode: 'prefix',
        stripKeyword: true,
        enabled: true,
      },
    ],
  });
  const document = await createLayoutDocumentFromMarkdown('【答案解析】先看定义域，再判断单调性。');
  const applyResult = applySemanticKeywordRulesToBlocks(document.blocks, semanticRoleConfig);

  const html = buildExportHtml({
    title: '语义块样式导出验证',
    semanticRoleConfig,
    pages: [
      {
        pageNumber: 1,
        blocks: applyResult.blocks,
        contract: resolveStyleContract(defaultStyleSettings),
        warnings: [],
      },
    ],
  });

  assert(html.includes('data-semantic-role="custom-answer-analysis"'), '导出 HTML 应保留自定义语义角色。');
  assert(html.includes('data-semantic-label="答案解析"'), '导出 HTML 应保留语义标签。');
  assert(html.includes('data-semantic-preset="softCard"'), '导出 HTML 应保留自定义语义角色默认块模板。');
  assert(html.includes('semantic-block-preset-softCard'), '导出 HTML 应带块模板 class。');
  assert(html.includes('semantic-role-custom-answer-analysis'), '导出 HTML 应保留语义 class。');
  assert(html.includes('--semantic-role-color:#3b82f6'), '导出 HTML 应写入自定义语义色值。');
});

test('PH2-24 默写导出：下划线题号应保持可见，真正的下划线内容才进入挖空样式', () => {
  const createUnderlineRun = (id: string, text: string): TextRun => ({
    id,
    text,
    sourceRange: null,
    marks: [{ type: 'underline' }],
    charStyleRef: null,
    styleOverrides: {},
    annotations: [],
  });

  const paragraphBlock: LayoutBlock = {
    id: 'dictation-paragraph',
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [
      createUnderlineRun('question-no', '1.'),
      {
        id: 'plain-gap',
        text: ' 水的化学式是 ',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      },
      createUnderlineRun('dictation-answer', 'H2O'),
    ],
    pagination: {},
    metadata: {
      kind: 'paragraph',
      text: '1. 水的化学式是 H2O',
    },
  };

  const html = buildExportHtml({
    title: '默写挖空导出验证',
    answerDisplayMode: 'underline',
    pages: [
      {
        pageNumber: 1,
        blocks: [paragraphBlock],
        contract: resolveStyleContract(defaultStyleSettings),
        warnings: [],
      },
    ],
  });

  const underlineStyleMatches = html.match(/<u style="text-decoration-color:[^"]+">/gu) ?? [];
  assert.equal(underlineStyleMatches.length, 1, '只有真正的默写内容下划线应进入挖空样式。');
  assert(html.includes('<u>1.</u>'), '纯题号式下划线应保持普通可见下划线。');
});

test('PH2-07 语义块模板：进入语义默认接管后清除语义可恢复原手动块模板', async () => {
  const document = await createLayoutDocumentFromMarkdown('普通段落');
  const paragraph = document.blocks[0];
  assert(paragraph, '应保留原段落块。');

  const manualBlock = applySemanticPresetToLayoutBlock(paragraph, 'softCard');
  assert.equal(getManualSemanticBlockPresetId(manualBlock), 'softCard');

  const semanticBlock = applySemanticToLayoutBlock(
    manualBlock,
    {
      roleId: 'answer',
      alias: '答案',
      source: 'manual',
    },
    normalizeSemanticRoleConfig(),
  );

  assert.equal(getResolvedSemanticBlockPresetId(semanticBlock, normalizeSemanticRoleConfig()), 'defaultSemanticFrame');
  assert.equal(getManualSemanticBlockPresetId(semanticBlock), null);
  assert.equal(getPreSemanticBlockPresetId(semanticBlock), 'softCard');

  const restoredBlock = applySemanticToLayoutBlock(semanticBlock, null, normalizeSemanticRoleConfig());
  assert.equal(restoredBlock.semantic, undefined);
  assert.equal(getManualSemanticBlockPresetId(restoredBlock), 'softCard');
  assert.equal(getPreSemanticBlockPresetId(restoredBlock), undefined);
});

test('PH2-07 语义块模板：语义态手动覆盖在清除语义后仍恢复语义前模板', async () => {
  const document = await createLayoutDocumentFromMarkdown('普通段落');
  const paragraph = document.blocks[0];
  assert(paragraph, '应保留原段落块。');

  const manualBlock = applySemanticPresetToLayoutBlock(paragraph, 'softCard');
  const semanticBlock = applySemanticToLayoutBlock(
    manualBlock,
    {
      roleId: 'explanation',
      alias: '解析',
      source: 'manual',
    },
    normalizeSemanticRoleConfig(),
  );
  const semanticManualOverride = applySemanticPresetToLayoutBlock(semanticBlock, 'warningFrame');

  assert.equal(getManualSemanticBlockPresetId(semanticManualOverride), 'warningFrame');
  assert.equal(getPreSemanticBlockPresetId(semanticManualOverride), 'softCard');

  const restoredBlock = applySemanticToLayoutBlock(semanticManualOverride, null, normalizeSemanticRoleConfig());
  assert.equal(restoredBlock.semantic, undefined);
  assert.equal(getManualSemanticBlockPresetId(restoredBlock), 'softCard');
  assert.equal(getResolvedSemanticBlockPresetId(restoredBlock, normalizeSemanticRoleConfig()), 'softCard');
});
