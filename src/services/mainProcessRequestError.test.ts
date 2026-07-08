import assert from 'node:assert/strict';
import test from 'node:test';
import {
  throwIfMainProcessTransportError,
  throwNormalizedMainProcessInvokeError,
} from './mainProcessRequestError';

test('PH3-01 结构化主进程传输错误会转成中文提示', () => {
  assert.throws(
    () =>
      throwIfMainProcessTransportError({
        url: 'http://127.0.0.1:3000/v1/chat/completions',
        transportError: {
          code: 'connectionRefused',
          message: '无法连接到目标服务，请确认服务已启动且地址端口填写正确。\n请求地址：http://127.0.0.1:3000/v1/chat/completions',
        },
      }),
    /无法连接到目标服务/,
  );
});

test('PH3-01 旧式 IPC 原始报错会转成中文提示', () => {
  assert.throws(
    () =>
      throwNormalizedMainProcessInvokeError(
        'http://127.0.0.1:3000/v1/chat/completions',
        new Error("Error invoking remote method 'ai:request': TypeError: fetch failed"),
      ),
    /网络请求失败/,
  );
});
