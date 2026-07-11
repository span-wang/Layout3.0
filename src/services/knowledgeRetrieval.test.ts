import assert from 'node:assert/strict';
import test from 'node:test';
import type { RagflowChunk, RagflowDatasetSummary } from '@/types/knowledge';
import {
  buildKnowledgeRetrievalQuery,
  refineRagflowChunks,
  routeRagflowDatasetIds,
} from './knowledgeRetrieval';

function createChunk(options: {
  id: string;
  documentId: string;
  content: string;
  similarity?: number;
}): RagflowChunk {
  return {
    id: options.id,
    datasetId: 'english',
    documentId: options.documentId,
    content: options.content,
    similarity: options.similarity,
  };
}

test('PH3-12 精准检索词不会再拼入通用生成意图词', () => {
  const query = buildKnowledgeRetrievalQuery({
    subject: '英语',
    grade: '七年级上册',
    topic: 'Unit 5 Fun Clubs can 的用法',
    requirementDescription: '',
  });

  assert.equal(query, '英语 七年级上册 Unit 5 Fun Clubs can 的用法');
  assert.doesNotMatch(query, /例题|易错点|答案解析|题型/);
});

test('PH3-12 有明确学科时只路由到匹配的数据集', () => {
  const datasets: RagflowDatasetSummary[] = [
    { id: 'english', name: '七年级上册英语（人教版）' },
    { id: 'accounting', name: '中级会计' },
  ];

  assert.deepEqual(
    routeRagflowDatasetIds({
      datasets,
      selectedDatasetIds: ['english', 'accounting'],
      subject: '英语',
    }),
    ['english'],
  );
  assert.deepEqual(
    routeRagflowDatasetIds({
      datasets,
      selectedDatasetIds: ['english', 'accounting'],
      subject: '中级会计实务',
    }),
    ['accounting'],
  );
  assert.deepEqual(
    routeRagflowDatasetIds({
      datasets,
      selectedDatasetIds: ['english', 'accounting'],
      subject: '物理',
    }),
    [],
  );
});

test('PH3-12 候选会经过阈值、近重复和同文档配额过滤', () => {
  const repeatedContent = 'Unit 5 Fun Clubs 的核心语法是情态动词 can，后接动词原形。';
  const result = refineRagflowChunks(
    [
      createChunk({ id: 'low', documentId: 'doc-low', content: '低分无关内容', similarity: 0.2 }),
      createChunk({ id: 'a1', documentId: 'doc-a', content: repeatedContent, similarity: 0.91 }),
      createChunk({ id: 'a2', documentId: 'doc-a', content: `${repeatedContent} 这是补充说明。`, similarity: 0.9 }),
      createChunk({ id: 'a3', documentId: 'doc-a', content: '同文档第三条不同内容', similarity: 0.89 }),
      createChunk({ id: 'b1', documentId: 'doc-b', content: 'can 的一般疑问句需要把 can 提到主语前。', similarity: 0.88 }),
      createChunk({ id: 'c1', documentId: 'doc-c', content: 'can 的否定形式是 cannot 或 can not。', similarity: 0.87 }),
    ],
    { resultLimit: 3, similarityThreshold: 0.3 },
  );

  assert.deepEqual(result.chunks.map((chunk) => chunk.id), ['a1', 'a3', 'b1']);
  assert.equal(result.rejectedByScore, 1);
  assert.equal(result.rejectedAsDuplicate, 1);
  assert.equal(result.rejectedByResultLimit, 1);
});

test('PH3-12 没有综合分的片段不会进入 AI 上下文候选', () => {
  const result = refineRagflowChunks(
    [createChunk({ id: 'missing-score', documentId: 'doc-a', content: '没有分数的片段' })],
    { resultLimit: 6, similarityThreshold: 0.3 },
  );

  assert.equal(result.chunks.length, 0);
  assert.equal(result.rejectedByScore, 1);
});
