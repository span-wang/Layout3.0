import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPendingRemoteFileName,
  PendingIndexService,
  type PendingIndexBinding,
  type PendingIndexRemote,
} from './pending-index-service';
import { RagflowError } from './ragflow/errors';
import type { RagflowDocument, RagflowMetadata } from './ragflow/types';

const sourceHash = 'a'.repeat(64);
const metadata: RagflowMetadata = {
  metadata_schema: 'layout3_ingestion_v1',
  status: 'pending',
  version_id: 'ver-1',
  source_hash: sourceHash,
  canonical_id: 'mat-1',
};
const request = {
  versionId: 'ver-1',
  sourceHash,
  indexGeneration: 'generation-1',
  datasetId: 'dataset-stage',
  artifactPath: 'C:\\managed\\artifact.md',
  artifactMediaType: 'text/markdown;charset=utf-8',
  metadata,
};

class FakeRemote implements PendingIndexRemote {
  readonly calls: string[] = [];
  document: RagflowDocument = {
    id: 'doc-1',
    name: buildPendingRemoteFileName({ versionId: request.versionId, sourceHash }),
    run: 'UNSTART',
    chunk_count: 0,
    meta_fields: metadata,
  };
  reconciliation: 'missing' | 'existing' = 'missing';
  failOnMetadata = false;
  failAfterUpload = false;

  async reconcileDocumentByExactName() {
    this.calls.push('reconcile');
    return this.reconciliation === 'existing'
      ? { kind: 'existing' as const, remoteFileName: this.document.name, document: this.document }
      : { kind: 'missing' as const, remoteFileName: this.document.name };
  }

  async uploadDocument() {
    this.calls.push('upload');
    this.reconciliation = 'existing';
    if (this.failAfterUpload) {
      this.failAfterUpload = false;
      throw new RagflowError({
        code: 'REMOTE_TRANSIENT',
        reason: 'NETWORK',
        message: 'fake 上传结果不明',
        retryable: true,
      });
    }
    return this.document;
  }

  async patchDocumentMetadataAndVerify() {
    this.calls.push('metadata');
    if (this.failOnMetadata) {
      throw new RagflowError({
        code: 'REMOTE_CONTRACT',
        reason: 'METADATA_MISMATCH',
        message: 'fake metadata 不一致',
        retryable: false,
      });
    }
    return this.document;
  }

  async verifyDocumentMetadata() {
    this.calls.push('metadata-final');
    return this.document;
  }

  async triggerParse() {
    this.calls.push('parse');
  }

  async waitForDocumentReady() {
    this.calls.push('wait');
    return { ...this.document, run: 'DONE', chunk_count: 5 };
  }
}

function createHarness(remote = new FakeRemote(), existingBinding: PendingIndexBinding | null = null) {
  const repositoryCalls: string[] = [];
  const policyCalls: string[] = [];
  let storedBinding = existingBinding;
  const repository = {
    findBinding: () => storedBinding,
    ensureUnhealthyPendingBinding: (input: {
      versionId: string;
      indexGeneration: string;
      datasetId: string;
      documentId: string;
    }) => {
      repositoryCalls.push('binding-unhealthy');
      storedBinding = { ...input, remoteStatus: 'pending', isHealthy: false };
    },
    markPendingBindingHealthy: () => {
      repositoryCalls.push('binding-healthy');
      if (storedBinding) storedBinding = { ...storedBinding, isHealthy: true };
    },
  };
  const datasetPolicy = {
    assertStagingDataset: (datasetId: string) => { policyCalls.push(datasetId); },
  };
  const now = () => new Date('2026-07-11T08:00:00.000Z');
  const service = new PendingIndexService({
    remote,
    repository,
    datasetPolicy,
    now,
  });
  return {
    service,
    remote,
    repository,
    datasetPolicy,
    now,
    repositoryCalls,
    policyCalls,
    getBinding: () => storedBinding,
  };
}

test('PH3-13C2 pending 索引使用 version_id/source_hash 确定性文件名', () => {
  assert.equal(
    buildPendingRemoteFileName({ versionId: 'ver-1', sourceHash: `sha256:${sourceHash}`, extension: '.md' }),
    `layout3_ver-1_${sourceHash}.md`,
  );
});

test('PH3-13C2 pending 索引上传后重新对账，先登记不健康绑定，最终才标健康', async () => {
  const { service, remote, repositoryCalls, policyCalls } = createHarness();
  const result = await service.index(request);

  assert.deepEqual(remote.calls, ['reconcile', 'upload', 'reconcile', 'metadata', 'parse', 'wait', 'metadata-final']);
  assert.deepEqual(repositoryCalls, ['binding-unhealthy', 'binding-healthy']);
  assert.deepEqual(policyCalls, ['dataset-stage', 'dataset-stage']);
  assert.equal(result.documentId, 'doc-1');
  assert.equal(result.chunkCount, 5);
  assert.equal(result.reusedRemoteDocument, false);
  assert.equal(result.lastVerifiedAt, '2026-07-11T08:00:00.000Z');
});

test('PH3-13C2 upload 与 parse_wait 可跨 service 实例作为两个持久阶段独立恢复', async () => {
  const harness = createHarness();
  const { service, remote, repositoryCalls, getBinding } = harness;

  const prepared = await service.prepareUpload(request);
  assert.equal(prepared.documentId, 'doc-1');
  assert.equal(prepared.parseTriggered, true);
  assert.deepEqual(remote.calls, ['reconcile', 'upload', 'reconcile', 'metadata', 'parse']);
  assert.deepEqual(repositoryCalls, ['binding-unhealthy']);
  assert.equal(getBinding()?.isHealthy, false);

  const restartedService = new PendingIndexService({
    remote,
    repository: harness.repository,
    datasetPolicy: harness.datasetPolicy,
    now: harness.now,
  });
  const { artifactPath: _artifactPath, artifactMediaType: _artifactMediaType, ...waitRequest } = request;
  const healthy = await restartedService.waitUntilHealthy(waitRequest);
  assert.equal(healthy.documentId, prepared.documentId);
  assert.equal(healthy.chunkCount, 5);
  assert.deepEqual(remote.calls, [
    'reconcile', 'upload', 'reconcile', 'metadata', 'parse', 'wait', 'metadata-final',
  ]);
  assert.deepEqual(repositoryCalls, ['binding-unhealthy', 'binding-healthy']);
  assert.equal(getBinding()?.isHealthy, true);
});

test('PH3-13C2 parse_wait 缺少持久 pending 绑定时失败关闭且不访问远端', async () => {
  const { service, remote } = createHarness();
  await assert.rejects(
    service.waitUntilHealthy(request),
    (error) => error instanceof RagflowError && error.reason === 'BINDING_DRIFT',
  );
  assert.deepEqual(remote.calls, []);
});

test('PH3-13C2 pending 索引可接管唯一同名文档且不会重复上传', async () => {
  const remote = new FakeRemote();
  remote.reconciliation = 'existing';
  const binding: PendingIndexBinding = {
    versionId: request.versionId,
    indexGeneration: request.indexGeneration,
    datasetId: request.datasetId,
    documentId: remote.document.id,
    remoteStatus: 'pending',
    isHealthy: false,
  };
  const { service, repositoryCalls } = createHarness(remote, binding);

  const result = await service.index(request);
  assert.equal(remote.calls.includes('upload'), false);
  assert.equal(result.reusedRemoteDocument, true);
  assert.deepEqual(repositoryCalls, ['binding-unhealthy', 'binding-healthy']);
});

test('PH3-13C2 pending 索引在上传结果不明后先对账并接管，不盲目重复上传', async () => {
  const remote = new FakeRemote();
  remote.failAfterUpload = true;
  const firstAttempt = createHarness(remote);
  await assert.rejects(
    firstAttempt.service.index(request),
    (error) => error instanceof RagflowError && error.reason === 'NETWORK',
  );
  assert.deepEqual(firstAttempt.repositoryCalls, []);

  const secondAttempt = createHarness(remote);
  const result = await secondAttempt.service.index(request);
  assert.equal(result.reusedRemoteDocument, true);
  assert.equal(remote.calls.filter((call) => call === 'upload').length, 1);
  assert.deepEqual(secondAttempt.repositoryCalls, ['binding-unhealthy', 'binding-healthy']);
});

test('PH3-13C2 pending 索引重验健康绑定时仍先重置健康标记再完整核验', async () => {
  const remote = new FakeRemote();
  remote.reconciliation = 'existing';
  remote.document = { ...remote.document, run: 'DONE', chunk_count: 5 };
  const binding: PendingIndexBinding = {
    versionId: request.versionId,
    indexGeneration: request.indexGeneration,
    datasetId: request.datasetId,
    documentId: remote.document.id,
    remoteStatus: 'pending',
    isHealthy: true,
  };
  const { service, repositoryCalls } = createHarness(remote, binding);

  await service.index(request);
  assert.deepEqual(repositoryCalls, ['binding-unhealthy', 'binding-healthy']);
  assert.equal(remote.calls.includes('parse'), false);
});

test('PH3-13C2 pending metadata 失败后保留不健康绑定，不会错误标健康', async () => {
  const remote = new FakeRemote();
  remote.failOnMetadata = true;
  const { service, repositoryCalls } = createHarness(remote);

  await assert.rejects(service.index(request), (error) => (
    error instanceof RagflowError
    && error.reason === 'METADATA_MISMATCH'
  ));
  assert.deepEqual(repositoryCalls, ['binding-unhealthy']);
});

test('PH3-13C2 pending 索引拒绝错误 schema/status/version/source_hash metadata', async () => {
  const { service } = createHarness();
  await assert.rejects(
    service.index({ ...request, metadata: { ...metadata, status: 'active' } }),
    (error) => error instanceof RagflowError && error.reason === 'METADATA_MISMATCH',
  );
});
