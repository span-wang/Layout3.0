import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INVALID_RAGFLOW_RETRIEVAL_BODY_ERROR_CODE,
  PROTECTED_RAGFLOW_DATASET_ERROR_CODE,
  guardProtectedRagflowDatasetRequest,
} from './protected-ragflow-dataset-guard';

const PROTECTED_DATASET_ID = 'pending-dataset-id';
const RETRIEVAL_URL = 'http://127.0.0.1:9380/api/v1/retrieval';

test('PH3-13C2 普通 RAGFlow 检索请求保持放行', () => {
  const decision = guardProtectedRagflowDatasetRequest(
    {
      url: RETRIEVAL_URL,
      body: JSON.stringify({ dataset_ids: ['published-dataset-id'], question: '测试问题' }),
    },
    [PROTECTED_DATASET_ID],
  );

  assert.deepEqual(decision, { allow: true });
});

test('PH3-13C2 命中受保护暂存数据集时以中文失败关闭', () => {
  const decision = guardProtectedRagflowDatasetRequest(
    {
      url: RETRIEVAL_URL,
      body: JSON.stringify({
        dataset_ids: ['published-dataset-id', PROTECTED_DATASET_ID],
        question: '测试问题',
      }),
    },
    [PROTECTED_DATASET_ID],
  );

  assert.equal(decision.allow, false);
  if (decision.allow) {
    assert.fail('命中受保护暂存数据集时不应放行');
  }
  assert.equal(decision.code, PROTECTED_RAGFLOW_DATASET_ERROR_CODE);
  assert.match(decision.message, /暂存数据集/);
  assert.match(decision.message, /不能用于正式检索/);
});

test('PH3-13C2 对象请求体同样执行受保护数据集门禁', () => {
  const decision = guardProtectedRagflowDatasetRequest(
    {
      url: `${RETRIEVAL_URL}/?page=1`,
      body: { dataset_ids: [` ${PROTECTED_DATASET_ID} `] },
    },
    [` ${PROTECTED_DATASET_ID} `],
  );

  assert.equal(decision.allow, false);
  if (!decision.allow) {
    assert.equal(decision.code, PROTECTED_RAGFLOW_DATASET_ERROR_CODE);
  }
});

test('PH3-13C2 非法 JSON、缺失字段和错误字段类型都不能绕过门禁', () => {
  const invalidBodies: unknown[] = [
    '{"dataset_ids":',
    JSON.stringify({ question: '未提供数据集' }),
    JSON.stringify({ dataset_ids: PROTECTED_DATASET_ID }),
    JSON.stringify({ dataset_ids: [PROTECTED_DATASET_ID, 42] }),
    JSON.stringify({ dataset_ids: [] }),
    JSON.stringify({ dataset_ids: ['   '] }),
    null,
  ];

  for (const body of invalidBodies) {
    const decision = guardProtectedRagflowDatasetRequest(
      { url: RETRIEVAL_URL, body },
      [PROTECTED_DATASET_ID],
    );

    assert.equal(decision.allow, false);
    if (!decision.allow) {
      assert.equal(decision.code, INVALID_RAGFLOW_RETRIEVAL_BODY_ERROR_CODE);
      assert.match(decision.message, /无法安全校验/);
    }
  }
});

test('PH3-13C2 编码后的标准检索路径不能绕过门禁', () => {
  const urls = [
    'http://127.0.0.1:9380/api/v1/%72etrieval',
    'https://example.com/ragflow/api//v1/retrieval/',
  ];

  for (const url of urls) {
    const decision = guardProtectedRagflowDatasetRequest(
      {
        url,
        body: JSON.stringify({ dataset_ids: [PROTECTED_DATASET_ID] }),
      },
      [PROTECTED_DATASET_ID],
    );

    assert.equal(decision.allow, false);
  }
});

test('PH3-13C2 其他 AI Provider 与 RAGFlow 非检索接口不受影响', () => {
  const requests = [
    { url: 'https://api.openai.com/v1/chat/completions', body: '{not-json' },
    { url: 'https://api.anthropic.com/v1/messages', body: undefined },
    { url: 'http://127.0.0.1:9380/api/v1/datasets', body: '{not-json' },
  ];

  for (const request of requests) {
    assert.deepEqual(
      guardProtectedRagflowDatasetRequest(request, [PROTECTED_DATASET_ID]),
      { allow: true },
    );
  }
});

test('PH3-13C2 未配置受保护数据集时门禁完全旁路', () => {
  assert.deepEqual(
    guardProtectedRagflowDatasetRequest({ url: RETRIEVAL_URL, body: '{not-json' }, []),
    { allow: true },
  );
});
