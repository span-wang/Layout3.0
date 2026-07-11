import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKnowledgeIngestionStartQualityPayload } from './knowledge-ingestion/contract';
import { toSafeKnowledgeIngestionIpcError } from './knowledge-ingestion/ipc-errors';
import { RagflowError } from './knowledge-ingestion/ragflow/errors';

test('PH3-13C2A 数据集候选读取保留安全的 RAGFlow 中文错误说明', () => {
  const authentication = toSafeKnowledgeIngestionIpcError(new RagflowError({
    code: 'REMOTE_AUTH_CONFIG',
    reason: 'AUTHENTICATION',
    message: 'RAGFlow 身份认证失败（HTTP 401），请检查入库地址、API Key 和数据集权限。',
    retryable: false,
  }));
  assert.match(authentication.message, /^\[REMOTE_AUTH_CONFIG\]/);
  assert.match(authentication.message, /身份认证失败/);

  const network = toSafeKnowledgeIngestionIpcError(new RagflowError({
    code: 'REMOTE_TRANSIENT',
    reason: 'NETWORK',
    message: '读取 RAGFlow 数据集候选时无法连接 RAGFlow，可按退避策略重试。',
    retryable: true,
  }));
  assert.match(network.message, /^\[REMOTE_TRANSIENT\]/);
  assert.match(network.message, /无法连接/);
});

test('PH3-13C2A 未分类异常仍使用通用安全提示', () => {
  const error = toSafeKnowledgeIngestionIpcError(new Error('包含内部地址和调用栈的异常'));
  assert.equal(error.message, '[RUNTIME_UNAVAILABLE] 资料入库操作失败，请稍后重试。');
});

test('PH3-13C3 质量检查 IPC 只接受 itemId 与 3～5 条问题证据', () => {
  const payload = parseKnowledgeIngestionStartQualityPayload({
    itemId: 'intake-1',
    questions: [
      { question: '第一个问题是什么？', evidence: '第一段唯一正文证据。' },
      { question: '第二个问题是什么？', evidence: '第二段唯一正文证据。' },
      { question: '第三个问题是什么？', evidence: '第三段唯一正文证据。' },
    ],
  });
  assert.equal(payload.itemId, 'intake-1');
  assert.equal(payload.questions.length, 3);

  assert.throws(() => parseKnowledgeIngestionStartQualityPayload({
    itemId: 'intake-1',
    questions: payload.questions,
    documentIds: ['remote-doc'],
  }));
  assert.throws(() => parseKnowledgeIngestionStartQualityPayload({
    itemId: 'intake-1',
    questions: payload.questions.slice(0, 2),
  }));
  assert.throws(() => parseKnowledgeIngestionStartQualityPayload({
    itemId: 'intake-1',
    questions: [
      ...payload.questions,
      { question: '第四个问题是什么？', evidence: '第四段唯一正文证据。' },
      { question: '第五个问题是什么？', evidence: '第五段唯一正文证据。' },
      { question: '第六个问题是什么？', evidence: '第六段唯一正文证据。' },
    ],
  }));
});
