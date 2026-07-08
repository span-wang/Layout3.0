import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRagflowApiErrorMessage } from './KnowledgeBaseService';

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
