import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKnowledgeSourcesFromContext } from './knowledgeSourceAnnotation';

test('PH3-12 从 RAGFlow 上下文解析来源列表', () => {
  const sources = parseKnowledgeSourcesFromContext({
    sourceType: 'ragflow',
    context: `### 资料片段 1
来源：高中物理资料库 / 牛顿第二定律讲义
命中说明：综合 0.912 / 向量 0.833
内容：
牛顿第二定律强调合力与加速度成正比。`,
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourceType, 'ragflow');
  assert.equal(sources[0].location, '高中物理资料库');
  assert.equal(sources[0].title, '牛顿第二定律讲义');
  assert.match(sources[0].detail ?? '', /综合 0\.912/);
  assert.match(sources[0].preview ?? '', /牛顿第二定律/);
});
