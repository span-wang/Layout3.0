import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseKnowledgeIngestionItemActionPayload,
  parseKnowledgeIngestionRollbackPayload,
  parseKnowledgeIngestionStartQualityPayload,
} from './knowledge-ingestion/contract';
import { toSafeKnowledgeIngestionIpcError } from './knowledge-ingestion/ipc-errors';
import { RagflowError } from './knowledge-ingestion/ragflow/errors';
import { RegistryError } from './knowledge-ingestion/types';

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

test('PH3-13C3 自动索引健康检查 IPC 只接受 itemId', () => {
  assert.deepEqual(parseKnowledgeIngestionStartQualityPayload({ itemId: 'intake-1' }), {
    itemId: 'intake-1',
  });
  assert.throws(() => parseKnowledgeIngestionStartQualityPayload({
    itemId: 'intake-1',
    questions: [{ question: '不应由前端提交的问题', evidence: '不应由前端提交的证据。' }],
  }));
  assert.throws(() => parseKnowledgeIngestionStartQualityPayload({
    itemId: 'intake-1',
    documentIds: ['remote-doc'],
  }));
});

test('PH3-13C4 发布、接收新版和重试只接受 itemId，回滚额外要求受控原因', () => {
  assert.deepEqual(parseKnowledgeIngestionItemActionPayload({ itemId: 'intake-c4' }), {
    itemId: 'intake-c4',
  });
  assert.deepEqual(parseKnowledgeIngestionRollbackPayload({
    itemId: 'intake-c4',
    reason: '  新版存在关键内容错误，需要恢复上一版本。  ',
  }), {
    itemId: 'intake-c4',
    reason: '新版存在关键内容错误，需要恢复上一版本。',
  });

  for (const forbiddenField of [
    'versionId',
    'operationId',
    'jobId',
    'publicationId',
    'bindingId',
    'datasetId',
    'documentId',
    'path',
    'url',
  ]) {
    assert.throws(() => parseKnowledgeIngestionItemActionPayload({
      itemId: 'intake-c4',
      [forbiddenField]: 'renderer-injected-secret',
    }));
    assert.throws(() => parseKnowledgeIngestionRollbackPayload({
      itemId: 'intake-c4',
      reason: '需要回滚。',
      [forbiddenField]: 'renderer-injected-secret',
    }));
  }
  assert.throws(() => parseKnowledgeIngestionRollbackPayload({ itemId: 'intake-c4', reason: '   ' }));
  assert.throws(() => parseKnowledgeIngestionRollbackPayload({
    itemId: 'intake-c4',
    reason: '回'.repeat(501),
  }));
});

test('PH3-13C4 IPC 错误按稳定错误码生成中文，不透传远端 ID、路径或 URL', () => {
  const internalText = 'document-secret C:\\secret\\registry.sqlite http://internal.example/api';
  const publicationError = toSafeKnowledgeIngestionIpcError(new RegistryError(
    'PUBLICATION_PRECONDITION_FAILED',
    internalText,
  ));
  assert.match(publicationError.message, /^\[PUBLICATION_PRECONDITION_FAILED\]/);
  assert.doesNotMatch(publicationError.message, /document-secret|registry\.sqlite|internal\.example/);

  const remoteError = toSafeKnowledgeIngestionIpcError(new RagflowError({
    code: 'REMOTE_CONTRACT',
    reason: 'INVALID_RESPONSE',
    message: internalText,
    retryable: false,
  }));
  assert.match(remoteError.message, /^\[REMOTE_CONTRACT\]/);
  assert.doesNotMatch(remoteError.message, /document-secret|registry\.sqlite|internal\.example/);
});
