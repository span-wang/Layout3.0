import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAiRequestTransportError } from './ai-request-errors';

test('PH3-01 连接拒绝错误会归一化为中文提示', () => {
  const error = new TypeError('fetch failed', {
    cause: {
      code: 'ECONNREFUSED',
    },
  });

  const result = normalizeAiRequestTransportError('http://127.0.0.1:3000/v1/chat/completions', error, false);

  assert.equal(result.code, 'connectionRefused');
  assert.match(result.message, /无法连接到目标服务/);
  assert.match(result.message, /127\.0\.0\.1:3000/);
});

test('PH3-01 取消请求会归一化为取消结果', () => {
  const result = normalizeAiRequestTransportError('https://example.com/v1', new Error('This operation was aborted'), true);

  assert.equal(result.code, 'aborted');
  assert.equal(result.message, '请求已取消');
});
