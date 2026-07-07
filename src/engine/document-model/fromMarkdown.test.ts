import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExportHtml } from '@/services/exportHtml';
import { resolveCompactChoiceListLayout } from '@/engine/document-model';
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

  const listBlocks = document.blocks.filter((block) => block.type === 'list' && block.metadata.kind === 'list');
  assert.equal(listBlocks.length, 2, '两个一级列表项应导入为两个独立列表块。');

  const [listBlock, secondListBlock] = listBlocks;
  assert(listBlock && listBlock.metadata.kind === 'list', '应保留第一个列表块。');
  assert(secondListBlock && secondListBlock.metadata.kind === 'list', '应保留第二个列表块。');

  const [firstParentItem, firstChildItem, secondChildItem] = listBlock.metadata.items;
  const [secondParentItem] = secondListBlock.metadata.items;
  assert(firstParentItem, '应保留第一个父级列表项。');
  assert(firstChildItem, '应保留第一个子列表项。');
  assert(secondChildItem, '应保留第二个子列表项。');
  assert(secondParentItem, '应保留第二个父级列表项。');

  assert.equal(listBlock.metadata.ordered, true, '根列表应保持有序。');
  assert.equal(listBlock.metadata.start, 1, '第一个独立列表块应从 1 开始。');
  assert.equal(secondListBlock.metadata.ordered, true, '第二个独立列表块也应保持有序。');
  assert.equal(secondListBlock.metadata.start, 2, '第二个独立列表块应从原有编号 2 开始。');
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

test('PH2-04 一级列表项独立块导入：连续一级列表不应被合并为一个块', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    '- 第一个一级列表',
    '- 第二个一级列表',
    '- 第三个一级列表',
  ].join('\n'));

  const listBlocks = document.blocks.filter((block) => block.type === 'list' && block.metadata.kind === 'list');
  assert.equal(listBlocks.length, 3, '三个一级列表项应分别成为三个独立列表块。');

  assert.deepEqual(
    listBlocks.map((block) => block.metadata.kind === 'list' ? block.metadata.items.length : 0),
    [1, 1, 1],
    '每个独立列表块都只包含一个一级列表项。',
  );
  assert.deepEqual(
    listBlocks.map((block) => block.metadata.kind === 'list' ? getTextFromRuns(block.metadata.items[0].textRuns) : ''),
    ['第一个一级列表', '第二个一级列表', '第三个一级列表'],
    '拆块后应保留每个一级列表项自身文字。',
  );
});

test('PH2-23 Markdown 分割线移除：--- 不再导入为分割线块，也不再导出 hr', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    '第一段',
    '',
    '---',
    '',
    '第二段',
  ].join('\n'));

  assert.equal(
    document.blocks.some((block) => block.type === 'horizontalRule'),
    false,
    'Markdown 分割线不应再导入为 horizontalRule 块。',
  );
  assert.equal(document.blocks.length, 2, '移除分割线后应只保留前后两个正文块。');

  const html = buildExportHtml({
    title: '分割线移除导出验证',
    pages: [
      {
        pageNumber: 1,
        blocks: document.blocks,
        contract: resolveStyleContract(defaultStyleSettings),
        warnings: [],
      },
    ],
  });
  assert.equal(html.includes('<hr'), false, '导出 HTML 不应再输出 hr 标签。');
});

test('PH2-22 试卷选项列表导入：连续 A-D 选项应保留为同一个紧凑列表块', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    '- A. 氮气',
    '- B. 氧气',
    '- C. 稀有气体',
    '- D. 二氧化碳',
  ].join('\n'));

  const listBlocks = document.blocks.filter((block) => block.type === 'list' && block.metadata.kind === 'list');
  assert.equal(listBlocks.length, 1, '试卷选项不应继续被拆成 4 个独立列表块。');

  const [choiceList] = listBlocks;
  assert(choiceList && choiceList.metadata.kind === 'list');
  assert.equal(choiceList.metadata.items.length, 4, '四个选项应落到同一个列表块里。');

  const compactChoiceLayout = resolveCompactChoiceListLayout(choiceList.metadata.items);
  assert(compactChoiceLayout, '应识别为紧凑选项组。');
  assert.equal(compactChoiceLayout.columns, 4, '短选项应默认按四列紧凑排版。');

  const html = buildExportHtml({
    title: '试卷选项导出验证',
    pages: [
      {
        pageNumber: 1,
        blocks: document.blocks,
        contract: resolveStyleContract(defaultStyleSettings),
        warnings: [],
      },
    ],
  });
  assert(html.includes('choice-option-list'), '导出 HTML 应保留紧凑选项组 class。');
  assert(html.includes('choice-option-label'), '导出 HTML 应拆出选项标签列。');
});

test('PH2-22 连续选项段落导入：A-D 段落应转换为同一个紧凑选项组', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    'A. 对数函数图像经过平移后仍过定点',
    '',
    'B. 指数函数图像关于原点中心对称',
    '',
    'C. 一次函数斜率固定且图像一定经过原点',
    '',
    'D. 反比例函数任意两点乘积都保持不变',
  ].join('\n'));

  assert.equal(document.blocks.length, 1, '连续选项段落应被收口为一个列表块。');
  const [choiceList] = document.blocks;
  assert(choiceList && choiceList.type === 'list' && choiceList.metadata.kind === 'list');
  assert.equal(choiceList.metadata.items.length, 4, '四个选项段落应转换为四个列表项。');

  const compactChoiceLayout = resolveCompactChoiceListLayout(choiceList.metadata.items);
  assert(compactChoiceLayout, '段落导入后的选项组也应支持紧凑排版。');
  assert.equal(compactChoiceLayout.columns, 2, '中等长度段落选项应默认按双列紧凑排版。');
});

test('PH2-22A 题干内多行选项拆分：有序题号列表项应拆成题干段落和紧凑选项组', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    "51. Zhang Ming's first name is ________.",
    'A. Zhang',
    'B. Ming',
    'C. Zhang Ming',
    'D. Ming Zhang',
    '',
    '52. Zhang Ming is ________ years old.',
  ].join('\n'));

  assert.equal(document.blocks.length, 3, '应拆成题干段落、选项组和下一题题干。');

  const [questionBlock, choiceBlock, nextQuestionBlock] = document.blocks;
  assert(questionBlock && questionBlock.type === 'paragraph' && questionBlock.metadata.kind === 'paragraph');
  assert.equal(questionBlock.metadata.text, "51. Zhang Ming's first name is ________.");

  assert(choiceBlock && choiceBlock.type === 'list' && choiceBlock.metadata.kind === 'list');
  assert.equal(choiceBlock.metadata.items.length, 4, '四个选项应拆成一个紧凑选项块。');
  const compactChoiceLayout = resolveCompactChoiceListLayout(choiceBlock.metadata.items);
  assert(compactChoiceLayout, '拆分后的选项块应继续命中紧凑选项组识别。');
  assert.equal(compactChoiceLayout.columns, 2, '包含较长英文选项时应回落到双列紧凑排版。');

  assert(nextQuestionBlock && nextQuestionBlock.type === 'list' && nextQuestionBlock.metadata.kind === 'list');
  assert.equal(nextQuestionBlock.metadata.start, 52, '后续题号应继续保留原有编号。');
});

test('PH2-22A 普通多行段落不应误拆成题干和选项组', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    '这一段是普通多行说明。',
    '第二行继续补充说明，不是选项。',
    '第三行仍然只是正文换行。',
  ].join('\n'));

  assert.equal(document.blocks.length, 1, '普通多行段落不应被误拆。');
  const [paragraph] = document.blocks;
  assert(paragraph && paragraph.type === 'paragraph' && paragraph.metadata.kind === 'paragraph');
});

test('PH2-22B 多行题干拆分：两行题干后接选项应保留题干换行并拆出紧凑选项组', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    '34. ________',
    '—M-I-L-L-E-R.',
    "A. What's your last name?",
    'B. How do you spell your last name?',
    'C. Is Miller your last name?',
    'D. Can you say your last name?',
  ].join('\n'));

  assert.equal(document.blocks.length, 2, '应拆成一个题干段落块和一个选项块。');
  const [questionBlock, choiceBlock] = document.blocks;
  assert(questionBlock && questionBlock.type === 'paragraph' && questionBlock.metadata.kind === 'paragraph');
  assert.equal(questionBlock.metadata.text, '34.\n—M-I-L-L-E-R.');

  assert(choiceBlock && choiceBlock.type === 'list' && choiceBlock.metadata.kind === 'list');
  assert.equal(choiceBlock.metadata.items.length, 4);
  assert.equal(getTextFromRuns(choiceBlock.metadata.items[0]?.textRuns ?? []), "A. What's your last name?");
  assert.equal(getTextFromRuns(choiceBlock.metadata.items[3]?.textRuns ?? []), 'D. Can you say your last name?');
});

test('PH2-22B 同段内联选项拆分：6-A-B-C 一行题面应拆成题号块和紧凑选项组', async () => {
  const document = await createLayoutDocumentFromMarkdown([
    "6. A. I'm fine, thanks. B. I'm 12. C. I'm in Class 3.",
    "7. A. Yes, I am. B. No, it isn't. C. Yes, he is.",
  ].join('\n'));

  assert.equal(document.blocks.length, 4, '两个题号列表项都应各自拆成题号块和选项块。');

  const [firstQuestionBlock, firstChoiceBlock, secondQuestionBlock, secondChoiceBlock] = document.blocks;
  assert(firstQuestionBlock && firstQuestionBlock.type === 'paragraph' && firstQuestionBlock.metadata.kind === 'paragraph');
  assert.equal(firstQuestionBlock.metadata.text, '6.');
  assert(firstChoiceBlock && firstChoiceBlock.type === 'list' && firstChoiceBlock.metadata.kind === 'list');
  assert.equal(firstChoiceBlock.metadata.items.length, 3);
  assert(resolveCompactChoiceListLayout(firstChoiceBlock.metadata.items), '内联选项应被拆成紧凑选项组。');

  assert(secondQuestionBlock && secondQuestionBlock.type === 'paragraph' && secondQuestionBlock.metadata.kind === 'paragraph');
  assert.equal(secondQuestionBlock.metadata.text, '7.');
  assert(secondChoiceBlock && secondChoiceBlock.type === 'list' && secondChoiceBlock.metadata.kind === 'list');
  assert.equal(secondChoiceBlock.metadata.items.length, 3);
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
