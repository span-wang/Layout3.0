import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_RAGFLOW_CONFIG } from '@/types/knowledge';
import {
  buildRagflowRetrievalRequestBody,
  normalizeRagflowApiErrorMessage,
} from './KnowledgeBaseService';

test('PH3-12 RAGFlow 401 返回会翻译成中文认证失败提示', () => {
  const message = normalizeRagflowApiErrorMessage({
    endpoint: 'http://127.0.0.1:9380/api/v1/datasets?page=1&page_size=20',
    status: 401,
    bodyPreview: '{"code":401,"data":null,"message":"<Unauthorized 401: Unauthorized>"}',
  });

  assert.match(message ?? '', /RAGFlow 认证失败/);
  assert.match(message ?? '', /API Key/);
  assert.match(message ?? '', /api\/v1\/datasets/);
});

test('PH3-12 RAGFlow invalid key 业务错误会翻译成中文认证失败提示', () => {
  const message = normalizeRagflowApiErrorMessage({
    endpoint: 'http://127.0.0.1:9380/api/v1/retrieval',
    payloadCode: 109,
    message: 'Authentication error: API key is invalid!',
  });

  assert.match(message ?? '', /RAGFlow 认证失败/);
  assert.match(message ?? '', /重新生成可用密钥/);
  assert.match(message ?? '', /api\/v1\/retrieval/);
});

test('PH3-12 非认证类 RAGFlow 错误保持走原有兜底提示', () => {
  const message = normalizeRagflowApiErrorMessage({
    endpoint: 'http://127.0.0.1:9380/api/v1/retrieval',
    status: 500,
    message: 'internal server error',
  });

  assert.equal(message, null);
});

test('PH3-12 精准检索请求会显式启用 Reranker 并分离候选数', () => {
  const body = buildRagflowRetrievalRequestBody({
    config: DEFAULT_RAGFLOW_CONFIG,
    datasetIds: ['english'],
    query: '  Unit 5 Fun Clubs can 语法  ',
  });

  assert.equal(body.question, 'Unit 5 Fun Clubs can 语法');
  assert.equal(body.page_size, 24);
  assert.equal(body.top_k, 64);
  assert.equal(body.similarity_threshold, 0.3);
  assert.equal(body.vector_similarity_weight, 0.75);
  assert.equal(body.rerank_id, 'Pro/BAAI/bge-reranker-v2-m3___OpenAI-API@OpenAI-API-Compatible');
  assert.equal(body.keyword, false);
  assert.equal(body.use_kg, false);
  assert.equal(body.toc_enhance, false);
});

test('PH3-12 重排模型留空时不会发送无效 rerank_id', () => {
  const body = buildRagflowRetrievalRequestBody({
    config: {
      ...DEFAULT_RAGFLOW_CONFIG,
      rerankId: '   ',
    },
    datasetIds: ['english'],
    query: 'Unit 5',
  });

  assert.equal('rerank_id' in body, false);
});
