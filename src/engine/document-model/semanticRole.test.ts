import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExportHtml } from '@/services/exportHtml';
import { defaultStyleSettings } from '@/engine/style/presets';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import {
  applySemanticPresetToLayoutBlock,
  applySemanticToLayoutBlock,
  applySemanticKeywordRulesToBlocks,
  createLayoutDocumentFromMarkdown,
  getManualSemanticBlockPresetId,
  getPreSemanticBlockPresetId,
  getResolvedSemanticBlockPresetId,
  normalizeLayoutDocumentSyntaxMappingConfig,
  normalizeSemanticRoleConfig,
  scanSemanticKeywordRulesInBlocks,
} from './index';

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
