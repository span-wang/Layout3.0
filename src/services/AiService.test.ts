import assert from 'node:assert/strict';
import test from 'node:test';
import { createGenerateSystemPrompt } from './AiService';

test('PH2-07 AI 默认教育生成提示词包含语义角色前缀规范', () => {
  const prompt = createGenerateSystemPrompt('exercise');

  assert.match(prompt, /role:角色名 正文/, '应说明 role 前缀的固定格式。');
  assert.match(prompt, /role:题干/, '应要求题目正文可生成题干语义。');
  assert.match(prompt, /role:答案/, '应要求参考答案可生成答案语义。');
  assert.match(prompt, /role:解析/, '应要求解题说明可生成解析语义。');
  assert.match(prompt, /role:重点/, '应要求讲义核心内容可生成重点语义。');
  assert.match(prompt, /标题.*不要在标题行前添加 role:/s, '标题仍应保持标准 Markdown 标题。');
});

test('PH2-07 小红书生成提示词不混入教育语义角色前缀', () => {
  const prompt = createGenerateSystemPrompt('xiaohongshuCopy');

  assert.doesNotMatch(prompt, /role:题干/);
  assert.doesNotMatch(prompt, /role:答案/);
  assert.doesNotMatch(prompt, /role:解析/);
});
