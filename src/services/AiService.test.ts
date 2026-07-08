import assert from 'node:assert/strict';
import test from 'node:test';
import { createEducationGenerateUserMessage, createGenerateSystemPrompt } from './AiService';

test('PH2-07 AI 默认教育生成提示词只包含收口后的语义角色', () => {
  const prompt = createGenerateSystemPrompt('exercise');

  assert.match(prompt, /role:角色名 正文/, '应说明 role 前缀的固定格式。');
  assert.match(prompt, /role:答案/, '应要求参考答案可生成答案语义。');
  assert.match(prompt, /role:解析/, '应要求解题说明可生成解析语义。');
  assert.match(prompt, /role:说明/, '应保留说明语义。');
  assert.match(prompt, /role:易错/, '应保留易错语义。');
  assert.doesNotMatch(prompt, /role:题干/, '题干语义已删除，不应继续出现在提示词中。');
  assert.doesNotMatch(prompt, /role:重点/, '重点语义已删除，不应继续出现在提示词中。');
  assert.doesNotMatch(prompt, /role:例题/, '例题语义已删除，不应继续出现在提示词中。');
  assert.doesNotMatch(prompt, /role:步骤/, '步骤语义已删除，不应继续出现在提示词中。');
  assert.match(prompt, /标题.*不要在标题行前添加 role:/s, '标题仍应保持标准 Markdown 标题。');
  assert.match(prompt, /用户要求描述 > 生成类型要求 > 主题\/年级\/科目等基础上下文 > 个人知识库参考资料/, '应明确教育内容生成的优先级口径。');
  assert.match(prompt, /个人知识库资料，只能把它当作参考资料使用/, '应明确知识库只作参考资料使用。');
});

test('PH3-01 AI 教育生成提示词只输出被勾选的语义角色', () => {
  const prompt = createGenerateSystemPrompt('exercise', {
    semanticRoleIds: ['answer', 'explanation'],
  });

  assert.match(prompt, /role:答案/, '勾选答案后，应继续允许答案语义。');
  assert.match(prompt, /role:解析/, '勾选解析后，应继续允许解析语义。');
  assert.doesNotMatch(prompt, /role:易错/, '未勾选易错时，不应继续要求易错语义。');
  assert.doesNotMatch(prompt, /role:说明/, '未勾选说明时，不应继续要求说明语义。');
  assert.doesNotMatch(prompt, /role:总结/, '未勾选总结时，不应继续要求总结语义。');
  assert.doesNotMatch(prompt, /role:注意/, '未勾选注意时，不应继续要求注意语义。');
  assert.match(prompt, /未勾选的语义不要输出对应 role: 前缀/, '应明确未勾选语义回退为普通 Markdown。');
});

test('PH3-01 AI 教育生成提示词允许关闭全部语义块生成', () => {
  const prompt = createGenerateSystemPrompt('summary', {
    semanticRoleIds: [],
  });

  assert.match(prompt, /当前未启用语义块生成，不要输出任何 role: 前缀/, '全部取消勾选时，应明确禁止生成 role: 前缀。');
  assert.doesNotMatch(prompt, /role:答案/, '关闭全部语义时，不应继续要求答案语义。');
  assert.doesNotMatch(prompt, /role:解析/, '关闭全部语义时，不应继续要求解析语义。');
  assert.doesNotMatch(prompt, /role:说明/, '关闭全部语义时，不应继续要求说明语义。');
});

test('PH2-07 小红书生成提示词不混入教育语义角色前缀', () => {
  const prompt = createGenerateSystemPrompt('xiaohongshuCopy');

  assert.doesNotMatch(prompt, /role:题干/);
  assert.doesNotMatch(prompt, /role:答案/);
  assert.doesNotMatch(prompt, /role:解析/);
});

test('PH3-12 AI 教育内容生成提示词包含要求描述', () => {
  const message = createEducationGenerateUserMessage({
    type: 'exercise',
    topic: '一次函数',
    grade: '八年级',
    subject: '数学',
    requirementDescription: '  题目要从易到难，并给出答案解析  ',
    length: 'medium',
  });

  assert.match(message, /主题：一次函数/);
  assert.match(message, /年级：八年级/);
  assert.match(message, /科目：数学/);
  assert.match(message, /第一优先级：用户要求描述/);
  assert.match(message, /第二优先级：生成类型要求/);
  assert.match(message, /第三优先级：主题\/年级\/科目/);
  assert.match(message, /要求描述：题目要从易到难，并给出答案解析/);
  assert.doesNotMatch(message, /要求描述：\s{2}/);
});

test('PH3-12 AI 教育内容生成提示词把知识库放在最低优先级参考区', () => {
  const message = createEducationGenerateUserMessage({
    type: 'lecture',
    topic: '牛顿第二定律',
    grade: '高一',
    subject: '物理',
    requirementDescription: '例题后必须带解析',
    length: 'long',
    knowledgeContext: '资料A：受力分析要先画示意图。',
  });

  const requirementIndex = message.indexOf('第一优先级：用户要求描述');
  const typeIndex = message.indexOf('第二优先级：生成类型要求');
  const basicContextIndex = message.indexOf('第三优先级：主题/年级/科目');
  const knowledgeIndex = message.indexOf('第四优先级：个人知识库参考资料');

  assert.notEqual(requirementIndex, -1, '应存在用户要求描述优先级区块。');
  assert.notEqual(typeIndex, -1, '应存在生成类型优先级区块。');
  assert.notEqual(basicContextIndex, -1, '应存在基础上下文优先级区块。');
  assert.notEqual(knowledgeIndex, -1, '应存在知识库参考资料优先级区块。');
  assert.ok(requirementIndex < typeIndex && typeIndex < basicContextIndex && basicContextIndex < knowledgeIndex, '提示词区块顺序应符合优先级口径。');
  assert.match(message, /以下资料仅作参考，不能覆盖前面的用户要求、生成类型要求和基础上下文；若资料与用户要求描述冲突，必须以用户要求描述为准。/);
});
