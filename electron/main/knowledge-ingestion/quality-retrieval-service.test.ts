import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QualityRetrievalService,
  type QualityRetrievalRemote,
  type QualityRetrievalScope,
  type QualityRetrievalScopeStore,
} from './quality-retrieval-service';
import { RagflowError } from './ragflow/errors';

function createScope(overrides: Partial<QualityRetrievalScope> = {}): QualityRetrievalScope {
  return {
    qualityRunId: 'quality-run-1',
    versionId: 'version-1',
    bindingId: 'binding-1',
    datasetIds: ['dataset-stage'],
    documentIds: ['doc-1'],
    expiresAt: '2026-07-11T12:00:00.000Z',
    ...overrides,
  };
}

function assertRagflowError(error: unknown, reason: RagflowError['reason']): boolean {
  return error instanceof RagflowError
    && error.code === 'REMOTE_CONTRACT'
    && error.reason === reason
    && error.retryable === false;
}

test('PH3-13C3 质量检索只用运行 ID 解析精确 scope，成功后返回内部候选 DTO', async () => {
  let resolveCount = 0;
  let remoteInput: Parameters<QualityRetrievalRemote['retrieveCandidates']>[0] | undefined;
  const store: QualityRetrievalScopeStore = {
    resolveValidScope(qualityRunId) {
      resolveCount += 1;
      assert.equal(qualityRunId, 'quality-run-1');
      return createScope();
    },
    recordRemoteContractViolation() {
      assert.fail('合法候选不应记录合同异常');
    },
  };
  const remoteCandidate = {
    chunkId: 'chunk-1',
    content: '正文证据',
    datasetId: 'dataset-stage',
    documentId: 'doc-1',
    documentName: '资料.pdf',
    similarity: 0.92,
    remoteOnly: '不得越过内部 DTO',
  };
  const remote: QualityRetrievalRemote = {
    async retrieveCandidates(input) {
      remoteInput = input;
      return [remoteCandidate];
    },
  };

  const result = await new QualityRetrievalService({ scopeStore: store, remote }).retrieve({
    qualityRunId: ' quality-run-1 ',
    question: '  验收要求是什么？ ',
  });

  assert.equal(resolveCount, 2);
  assert.deepEqual(remoteInput, {
    question: '验收要求是什么？',
    datasetIds: ['dataset-stage'],
    documentIds: ['doc-1'],
  });
  assert.deepEqual(result, [{
    chunkId: 'chunk-1',
    content: '正文证据',
    datasetId: 'dataset-stage',
    documentId: 'doc-1',
    documentName: '资料.pdf',
    similarity: 0.92,
  }]);
  assert.equal(Object.prototype.hasOwnProperty.call(result[0], 'remoteOnly'), false);
});

test('PH3-13C3 质量检索允许稳定 scope 下的零结果', async () => {
  let resolveCount = 0;
  const service = new QualityRetrievalService({
    scopeStore: {
      resolveValidScope() {
        resolveCount += 1;
        return createScope();
      },
      recordRemoteContractViolation() {
        assert.fail('零结果不应记录合同异常');
      },
    },
    remote: { async retrieveCandidates() { return []; } },
  });

  assert.deepEqual(await service.retrieve({ qualityRunId: 'quality-run-1', question: '问题' }), []);
  assert.equal(resolveCount, 2);
});

test('PH3-13C3 空 scope、过期或状态漂移均在远端调用前失败关闭', async (t) => {
  await t.test('空 document scope', async () => {
    let remoteCount = 0;
    const service = new QualityRetrievalService({
      scopeStore: {
        resolveValidScope: () => createScope({ documentIds: [] }),
        recordRemoteContractViolation: () => undefined,
      },
      remote: {
        async retrieveCandidates() {
          remoteCount += 1;
          return [];
        },
      },
    });
    await assert.rejects(
      service.retrieve({ qualityRunId: 'quality-run-1', question: '问题' }),
      (error) => assertRagflowError(error, 'BINDING_DRIFT'),
    );
    assert.equal(remoteCount, 0);
  });

  for (const message of ['质量运行已过期', '质量运行状态已漂移']) {
    await t.test(message, async () => {
      let remoteCount = 0;
      const expected = new Error(message);
      const service = new QualityRetrievalService({
        scopeStore: {
          resolveValidScope() { throw expected; },
          recordRemoteContractViolation: () => undefined,
        },
        remote: {
          async retrieveCandidates() {
            remoteCount += 1;
            return [];
          },
        },
      });
      await assert.rejects(
        service.retrieve({ qualityRunId: 'quality-run-1', question: '问题' }),
        (error) => error === expected,
      );
      assert.equal(remoteCount, 0);
    });
  }
});

test('PH3-13C3 集合外候选会先记录合同异常，再抛 REMOTE_CONTRACT', async () => {
  const violations: Parameters<QualityRetrievalScopeStore['recordRemoteContractViolation']>[0][] = [];
  const service = new QualityRetrievalService({
    scopeStore: {
      resolveValidScope: () => createScope(),
      recordRemoteContractViolation(input) { violations.push(input); },
    },
    remote: {
      async retrieveCandidates() {
        return [{
          chunkId: 'chunk-outside',
          content: '越界正文',
          datasetId: 'dataset-outside',
          documentId: 'doc-outside',
        }];
      },
    },
  });

  await assert.rejects(
    service.retrieve({ qualityRunId: 'quality-run-1', question: '问题' }),
    (error) => assertRagflowError(error, 'BINDING_DRIFT'),
  );
  assert.deepEqual(violations, [{
    qualityRunId: 'quality-run-1',
    returnedDocumentIds: ['doc-outside'],
    allowedDocumentIds: ['doc-1'],
    audit: {
      returnedDatasetIds: ['dataset-outside'],
      allowedDatasetIds: ['dataset-stage'],
      outOfScopeDocumentIds: ['doc-outside'],
      outOfScopeDatasetIds: ['dataset-outside'],
    },
  }]);
});

test('PH3-13C3 返回后重新解析 scope，二次漂移时不接受旧候选', async () => {
  let resolveCount = 0;
  const violations: Parameters<QualityRetrievalScopeStore['recordRemoteContractViolation']>[0][] = [];
  const service = new QualityRetrievalService({
    scopeStore: {
      resolveValidScope() {
        resolveCount += 1;
        return resolveCount === 1
          ? createScope()
          : createScope({ bindingId: 'binding-2', documentIds: ['doc-2'] });
      },
      recordRemoteContractViolation(input) { violations.push(input); },
    },
    remote: {
      async retrieveCandidates() {
        return [{
          chunkId: 'chunk-1',
          content: '请求时仍在 scope 内的正文',
          datasetId: 'dataset-stage',
          documentId: 'doc-1',
        }];
      },
    },
  });

  await assert.rejects(
    service.retrieve({ qualityRunId: 'quality-run-1', question: '问题' }),
    (error) => assertRagflowError(error, 'BINDING_DRIFT'),
  );
  assert.equal(resolveCount, 2);
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0].returnedDocumentIds, ['doc-1']);
  assert.deepEqual(violations[0].allowedDocumentIds, ['doc-2']);
});

test('PH3-13C3 即使远端零结果，检索期间的 scope 身份漂移也失败关闭', async () => {
  let resolveCount = 0;
  const service = new QualityRetrievalService({
    scopeStore: {
      resolveValidScope() {
        resolveCount += 1;
        return resolveCount === 1 ? createScope() : createScope({ bindingId: 'binding-2' });
      },
      recordRemoteContractViolation() {
        assert.fail('零结果没有远端集合外候选，不应记录远端合同异常');
      },
    },
    remote: { async retrieveCandidates() { return []; } },
  });

  await assert.rejects(
    service.retrieve({ qualityRunId: 'quality-run-1', question: '问题' }),
    (error) => assertRagflowError(error, 'BINDING_DRIFT'),
  );
});
