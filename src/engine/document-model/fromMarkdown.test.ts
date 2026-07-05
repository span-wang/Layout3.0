import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExportHtml } from '@/services/exportHtml';
import { defaultStyleSettings } from '@/engine/style/presets';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import { createLayoutDocumentFromMarkdown } from './fromMarkdown';

function getTextFromRuns(textRuns: Array<{ text: string }>): string {
  return textRuns.map((run) => run.text).join('');
}

test('PH2-04 嵌套列表导入去重：父级列表项不重复吞入子列表文字', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    '1. 领用原材料',
    '   借：生产成本',
    '   贷：原材料',
    '   1. 借：生产成本',
    '   2. 贷：原材料',
  ].join('\n'));

  const listBlock = document.blocks.find((block) => block.type === 'list' && block.metadata.kind === 'list');
  assert(listBlock && listBlock.metadata.kind === 'list', '应导入一个列表块。');

  const [parentItem, firstChildItem, secondChildItem] = listBlock.metadata.items;
  assert(parentItem, '应保留父级列表项。');
  assert(firstChildItem, '应保留第一个子列表项。');
  assert(secondChildItem, '应保留第二个子列表项。');

  assert.equal(listBlock.metadata.items.length, 3, '父项和两个子项应各自作为独立列表项存在。');
  assert.equal(parentItem.level, 1, '父项应保持 1 级列表。');
  assert.equal(firstChildItem.level, 2, '子项应保持 2 级列表。');
  assert.equal(secondChildItem.level, 2, '子项应保持 2 级列表。');

  const parentText = getTextFromRuns(parentItem.textRuns);
  assert.equal(parentText, '领用原材料\n借：生产成本\n贷：原材料', '父项只应包含自身文字。');
  assert.equal(getTextFromRuns(firstChildItem.textRuns), '借：生产成本', '第一个子项文字应独立保留。');
  assert.equal(getTextFromRuns(secondChildItem.textRuns), '贷：原材料', '第二个子项文字应独立保留。');
});

test('PH2-04 混合嵌套列表导入保真：外层有序、内层无序不应被统一成有序', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    '1. 领用原材料',
    '   - 借：生产成本',
    '   - 贷：原材料',
    '2. 发生直接人工费',
  ].join('\n'));

  const listBlock = document.blocks.find((block) => block.type === 'list' && block.metadata.kind === 'list');
  assert(listBlock && listBlock.metadata.kind === 'list', '应导入一个列表块。');

  const [firstParentItem, firstChildItem, secondChildItem, secondParentItem] = listBlock.metadata.items;
  assert(firstParentItem, '应保留第一个父级列表项。');
  assert(firstChildItem, '应保留第一个子列表项。');
  assert(secondChildItem, '应保留第二个子列表项。');
  assert(secondParentItem, '应保留第二个父级列表项。');

  assert.equal(listBlock.metadata.ordered, true, '根列表应保持有序。');
  assert.equal(firstParentItem.listKind, 'ordered', '父项所在层应记录为有序列表。');
  assert.equal(secondParentItem.listKind, 'ordered', '第二个父项所在层应记录为有序列表。');
  assert.equal(firstChildItem.listKind, 'unordered', '子项所在层应记录为无序列表。');
  assert.equal(secondChildItem.listKind, 'unordered', '子项所在层应记录为无序列表。');
  assert.equal(getTextFromRuns(firstParentItem.textRuns), '领用原材料', '父项不应重复包含子项文字。');
  assert.equal(getTextFromRuns(firstChildItem.textRuns), '借：生产成本', '第一个子项文字应独立保留。');
  assert.equal(getTextFromRuns(secondChildItem.textRuns), '贷：原材料', '第二个子项文字应独立保留。');

  const html = buildExportHtml({
    title: '混合列表导出验证',
    pages: [
      {
        pageNumber: 1,
        blocks: document.blocks,
        contract: resolveStyleContract(defaultStyleSettings),
        warnings: [],
      },
    ],
  });
  assert(html.includes('<ol'), '导出 HTML 应保留根层有序列表。');
  assert(html.includes('<ul'), '导出 HTML 应保留内层无序列表。');
});

test('PH2-07 语义块导入：role 前缀写入语义字段并保留正文格式', async () => {
  const document = await createLayoutDocumentFromMarkdown('role:答案 **选 A**，因为条件成立。');
  const paragraph = document.blocks[0];

  assert(paragraph, '应导入一个段落块。');
  assert.equal(paragraph.type, 'paragraph');
  assert.equal(paragraph.semantic?.roleId, 'answer');
  assert.equal(paragraph.semantic?.alias, '答案');
  assert.equal(paragraph.semantic?.source, 'markdown-prefix');
  assert.equal(getTextFromRuns(paragraph.textRuns), '选 A，因为条件成立。');
  assert(paragraph.textRuns.some((run) => run.text === '选 A' && run.marks.some((mark) => mark.type === 'bold')));

  const html = buildExportHtml({
    title: '语义块导出验证',
    pages: [
      {
        pageNumber: 1,
        blocks: document.blocks,
        contract: resolveStyleContract(defaultStyleSettings),
        warnings: [],
      },
    ],
  });
  assert(html.includes('data-semantic-role="answer"'), '导出 HTML 应保留语义角色标记。');
  assert(html.includes('semantic-role-answer'), '导出 HTML 应保留语义角色 class。');
});
