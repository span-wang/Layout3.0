import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RagflowClient, type RagflowFetch } from './client';
import { RagflowError } from './errors';
import type { RagflowDocument, RagflowMetadata } from './types';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function assertRagflowError(
  error: unknown,
  code: RagflowError['code'],
  reason: RagflowError['reason'],
  retryable: boolean,
): boolean {
  return error instanceof RagflowError
    && error.code === code
    && error.reason === reason
    && error.retryable === retryable;
}

function createClient(fetch: RagflowFetch, options: {
  pageSize?: number;
  now?: () => number;
  sleep?: () => Promise<void>;
  requestTimeoutMs?: number;
} = {}): RagflowClient {
  return new RagflowClient({
    baseUrl: 'http://127.0.0.1:9380',
    apiKey: 'test-secret',
    fetch,
    pageSize: options.pageSize ?? 2,
    now: options.now,
    sleep: options.sleep,
    requestTimeoutMs: options.requestTimeoutMs,
  });
}

test('PH3-13C2 RAGFlow 文档列表全分页读取，且不发送 status 联合过滤', async () => {
  const requestedUrls: string[] = [];
  const fetch: RagflowFetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    const docs = page === 1
      ? [{ id: 'doc-1', name: 'a.md' }, { id: 'doc-2', name: 'b.md' }]
      : [{ id: 'doc-3', name: 'target.md' }];
    return jsonResponse({ code: 0, data: { total: 3, docs } });
  };

  const reconciliation = await createClient(fetch).reconcileDocumentByExactName('dataset-stage', 'target.md');
  assert.equal(reconciliation.kind, 'existing');
  assert.equal(reconciliation.kind === 'existing' ? reconciliation.document.id : null, 'doc-3');
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls.every((url) => !new URL(url).searchParams.has('status')), true);
  assert.equal(requestedUrls.every((url) => !new URL(url).searchParams.has('metadata_condition')), true);
});

test('PH3-13C2A RAGFlow 数据集候选全分页读取，重复 ID 时失败关闭', async () => {
  const requestedUrls: string[] = [];
  const fetch: RagflowFetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    const data = page === 1
      ? [{ id: 'dataset-2', name: '乙资料库' }, { id: 'dataset-1', name: '甲资料库' }]
      : [{ id: 'dataset-3', name: '丙资料库' }];
    return jsonResponse({ code: 0, data });
  };
  const datasets = await createClient(fetch, { pageSize: 2 }).listAllDatasets();
  assert.deepEqual(datasets, [
    { id: 'dataset-2', name: '乙资料库' },
    { id: 'dataset-1', name: '甲资料库' },
    { id: 'dataset-3', name: '丙资料库' },
  ]);
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls.every((url) => new URL(url).pathname.endsWith('/api/v1/datasets')), true);
  assert.equal(requestedUrls.every((url) => new URL(url).searchParams.get('orderby') === 'create_time'), true);

  const duplicateFetch: RagflowFetch = async () => jsonResponse({
    code: 0,
    data: [{ id: 'dataset-1', name: '重复资料库' }, { id: 'dataset-1', name: '重复资料库副本' }],
  });
  await assert.rejects(
    createClient(duplicateFetch, { pageSize: 2 }).listAllDatasets(),
    (error) => assertRagflowError(error, 'REMOTE_CONTRACT', 'PAGINATION_INCOMPLETE', false),
  );
});

test('PH3-13C2 RAGFlow 对账在同名多份和分页不完整时失败关闭', async () => {
  const duplicateFetch: RagflowFetch = async () => jsonResponse({
    code: 0,
    data: {
      total: 2,
      docs: [
        { id: 'doc-1', name: 'same.md' },
        { id: 'doc-2', name: 'same.md' },
      ],
    },
  });
  await assert.rejects(
    createClient(duplicateFetch).reconcileDocumentByExactName('dataset-stage', 'same.md'),
    (error) => assertRagflowError(error, 'REMOTE_CONTRACT', 'DUPLICATE_REMOTE_NAME', false),
  );

  const incompleteFetch: RagflowFetch = async () => jsonResponse({
    code: 0,
    data: { total: 2, docs: [] },
  });
  await assert.rejects(
    createClient(incompleteFetch).listAllDocuments('dataset-stage'),
    (error) => assertRagflowError(error, 'REMOTE_CONTRACT', 'PAGINATION_INCOMPLETE', false),
  );
});

test('PH3-13C2 RAGFlow 上传使用注入式 Blob 工厂并校验唯一回执', async () => {
  let openedPath = '';
  let openedMediaType = '';
  let receivedName = '';
  const fetch: RagflowFetch = async (_input, init) => {
    assert.ok(init?.body instanceof FormData);
    const file = init.body.get('file');
    assert.ok(file instanceof File);
    receivedName = file.name;
    return jsonResponse({ code: 0, data: [{ id: 'doc-uploaded', name: file.name }] });
  };
  const client = new RagflowClient({
    baseUrl: 'http://127.0.0.1:9380',
    apiKey: 'test-secret',
    fetch,
    fileBlobFactory: async (filePath, mediaType) => {
      openedPath = filePath;
      openedMediaType = mediaType;
      return new Blob(['正文'], { type: mediaType });
    },
  });

  const result = await client.uploadDocument({
    datasetId: 'dataset-stage',
    filePath: 'C:\\managed\\artifact.md',
    remoteFileName: 'layout3_ver_a_hash.md',
    mediaType: 'text/markdown;charset=utf-8',
  });
  assert.equal(openedPath, 'C:\\managed\\artifact.md');
  assert.equal(openedMediaType, 'text/markdown;charset=utf-8');
  assert.equal(receivedName, 'layout3_ver_a_hash.md');
  assert.equal(result.id, 'doc-uploaded');
});

test('PH3-13C2 RAGFlow 默认上传适配器从文件 Blob 读取，不要求调用方加载完整 Buffer', async () => {
  const filePath = join(tmpdir(), `layout3-ragflow-upload-test-${randomUUID()}.md`);
  writeFileSync(filePath, '# 受管正文\n');
  try {
    const fetch: RagflowFetch = async (_input, init) => {
      assert.ok(init?.body instanceof FormData);
      const file = init.body.get('file');
      assert.ok(file instanceof File);
      assert.equal(await file.text(), '# 受管正文\n');
      return jsonResponse({ code: 0, data: [{ id: 'doc-file', name: file.name }] });
    };
    const result = await createClient(fetch).uploadDocument({
      datasetId: 'dataset-stage',
      filePath,
      remoteFileName: 'artifact.md',
      mediaType: 'text/markdown;charset=utf-8',
    });
    assert.equal(result.id, 'doc-file');
  } finally {
    // Windows 上 openAsBlob 的文件观察句柄由运行时稍后释放；先删文件即可避免残留测试数据。
    rmSync(filePath, { force: true });
  }
});

test('PH3-13C2 RAGFlow 单文件上传返回零份或多份文档时失败关闭', async () => {
  for (const documents of [[], [{ id: 'doc-1', name: 'a.md' }, { id: 'doc-2', name: 'a.md' }]]) {
    const fetch: RagflowFetch = async () => jsonResponse({ code: 0, data: documents });
    const client = new RagflowClient({
      baseUrl: 'http://127.0.0.1:9380',
      apiKey: 'test-secret',
      fetch,
      fileBlobFactory: async () => new Blob(['正文']),
    });
    await assert.rejects(
      client.uploadDocument({
        datasetId: 'dataset-stage',
        filePath: 'artifact.md',
        remoteFileName: 'a.md',
        mediaType: 'text/markdown',
      }),
      (error) => assertRagflowError(error, 'REMOTE_CONTRACT', 'INVALID_RESPONSE', false),
    );
  }
});

test('PH3-13C2 RAGFlow metadata PATCH 后逐字段回读且允许保留额外远端字段', async () => {
  const metadata: RagflowMetadata = {
    metadata_schema: 'layout3_ingestion_v1',
    status: 'pending',
    version_id: 'ver-1',
    source_hash: 'a'.repeat(64),
    unit: ['Unit 5'],
  };
  let patchBody: unknown;
  let listCount = 0;
  const fetch: RagflowFetch = async (input, init) => {
    if (init?.method === 'PATCH') {
      patchBody = JSON.parse(String(init.body));
      return jsonResponse({ code: 0 });
    }
    listCount += 1;
    return jsonResponse({
      code: 0,
      data: {
        total: 1,
        docs: [{ id: 'doc-1', name: 'a.md', meta_fields: { ...metadata, remote_only: true } }],
      },
    });
  };

  const document = await createClient(fetch).patchDocumentMetadataAndVerify({
    datasetId: 'dataset-stage',
    documentId: 'doc-1',
    metadata,
  });
  assert.deepEqual(patchBody, { meta_fields: metadata });
  assert.equal(listCount, 1);
  assert.equal(document.id, 'doc-1');

  const mismatchFetch: RagflowFetch = async (_input, init) => init?.method === 'PATCH'
    ? jsonResponse({ code: 0 })
    : jsonResponse({
        code: 0,
        data: { total: 1, docs: [{ id: 'doc-1', name: 'a.md', meta_fields: { ...metadata, status: 'active' } }] },
      });
  await assert.rejects(
    createClient(mismatchFetch).patchDocumentMetadataAndVerify({
      datasetId: 'dataset-stage', documentId: 'doc-1', metadata,
    }),
    (error) => assertRagflowError(error, 'REMOTE_CONTRACT', 'METADATA_MISMATCH', false),
  );
});

test('PH3-13C2 RAGFlow metadata PATCH 在网络请求前拒绝 null 字段', async () => {
  let fetchCalled = false;
  const fetch: RagflowFetch = async () => {
    fetchCalled = true;
    return jsonResponse({ code: 0 });
  };

  await assert.rejects(
    createClient(fetch).patchDocumentMetadataAndVerify({
      datasetId: 'dataset-stage',
      documentId: 'doc-1',
      metadata: {
        metadata_schema: 'layout3_ingestion_v1',
        version_id: 'ver-1',
        chapter: null,
      },
    }),
    (error) => assertRagflowError(error, 'REMOTE_CONTRACT', 'INVALID_RESPONSE', false),
  );
  assert.equal(fetchCalled, false);
});

test('PH3-13C3 RAGFlow 质量检索只发送精确 ID 与稳定 Top 10 请求体', async () => {
  let requestedUrl = '';
  let requestedBody: unknown;
  const fetch: RagflowFetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body));
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
    return jsonResponse({
      code: 0,
      data: {
        total: 1,
        chunks: [{
          id: 'chunk-1',
          content: '正文证据',
          dataset_id: 'dataset-stage',
          document_id: 'doc-1',
          document_name: '受控资料.pdf',
          similarity: 0.91,
          remote_only: '不得透传',
        }],
      },
    });
  };

  const candidates = await createClient(fetch).retrieveCandidates({
    question: '  资料中的验收要求是什么？  ',
    datasetIds: ['dataset-stage', ' dataset-secondary '],
    documentIds: ['doc-1', ' doc-2 '],
  });

  assert.equal(new URL(requestedUrl).pathname, '/api/v1/retrieval');
  assert.deepEqual(requestedBody, {
    question: '资料中的验收要求是什么？',
    dataset_ids: ['dataset-stage', 'dataset-secondary'],
    document_ids: ['doc-1', 'doc-2'],
    page: 1,
    page_size: 10,
    top_k: 64,
    similarity_threshold: 0,
    vector_similarity_weight: 0.3,
    keyword: false,
    highlight: false,
    use_kg: false,
    toc_enhance: false,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(requestedBody, 'status'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(requestedBody, 'metadata_condition'), false);
  assert.deepEqual(candidates, [{
    chunkId: 'chunk-1',
    content: '正文证据',
    datasetId: 'dataset-stage',
    documentId: 'doc-1',
    documentName: '受控资料.pdf',
    similarity: 0.91,
  }]);
});

test('PH3-13C3 RAGFlow 质量检索在问题或精确集合非法时不发远端请求', async () => {
  let fetchCount = 0;
  const fetch: RagflowFetch = async () => {
    fetchCount += 1;
    return jsonResponse({ code: 0, data: { chunks: [] } });
  };
  const client = createClient(fetch);
  const invalidInputs = [
    { question: '   ', datasetIds: ['dataset-stage'], documentIds: ['doc-1'] },
    { question: '问题', datasetIds: [], documentIds: ['doc-1'] },
    { question: '问题', datasetIds: ['dataset-stage'], documentIds: [] },
    { question: '问题', datasetIds: ['dataset-stage', ' dataset-stage '], documentIds: ['doc-1'] },
    { question: '问题', datasetIds: ['dataset-stage'], documentIds: ['doc-1', ' doc-1 '] },
  ];

  for (const input of invalidInputs) {
    await assert.rejects(
      client.retrieveCandidates(input),
      (error) => assertRagflowError(error, 'REMOTE_CONTRACT', 'INVALID_RESPONSE', false),
    );
  }
  assert.equal(fetchCount, 0);
});

test('PH3-13C3 RAGFlow 质量检索接受零结果，异常候选响应失败关闭', async () => {
  const empty = await createClient(async () => jsonResponse({ code: 0, data: { total: 0, chunks: [] } }))
    .retrieveCandidates({ question: '问题', datasetIds: ['dataset-stage'], documentIds: ['doc-1'] });
  assert.deepEqual(empty, []);

  const malformedChunks = [
    { id: 'chunk-1', dataset_id: 'dataset-stage', document_id: 'doc-1' },
    { id: 'chunk-1', content: '正文', dataset_id: 'dataset-stage' },
    { id: 'chunk-1', content: '正文', dataset_id: 'dataset-stage', document_id: 'doc-1', similarity: '0.9' },
  ];
  for (const chunk of malformedChunks) {
    await assert.rejects(
      createClient(async () => jsonResponse({ code: 0, data: { chunks: [chunk] } }))
        .retrieveCandidates({ question: '问题', datasetIds: ['dataset-stage'], documentIds: ['doc-1'] }),
      (error) => assertRagflowError(error, 'REMOTE_CONTRACT', 'INVALID_RESPONSE', false),
    );
  }
});

test('PH3-13C3 RAGFlow 质量检索复用 401、429、5xx 与超时错误分类', async (t) => {
  const input = { question: '问题', datasetIds: ['dataset-stage'], documentIds: ['doc-1'] };
  const cases: Array<{
    name: string;
    status: number;
    code: RagflowError['code'];
    reason: RagflowError['reason'];
    retryable: boolean;
  }> = [
    { name: 'HTTP 401', status: 401, code: 'REMOTE_AUTH_CONFIG', reason: 'AUTHENTICATION', retryable: false },
    { name: 'HTTP 429', status: 429, code: 'REMOTE_TRANSIENT', reason: 'RATE_LIMITED', retryable: true },
    { name: 'HTTP 503', status: 503, code: 'REMOTE_TRANSIENT', reason: 'SERVER_ERROR', retryable: true },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      await assert.rejects(
        createClient(async () => new Response('', { status: entry.status })).retrieveCandidates(input),
        (error) => assertRagflowError(error, entry.code, entry.reason, entry.retryable),
      );
    });
  }
  await t.test('请求超时', async () => {
    const fetch: RagflowFetch = async (_request, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
    await assert.rejects(
      createClient(fetch, { requestTimeoutMs: 1 }).retrieveCandidates(input),
      (error) => assertRagflowError(error, 'REMOTE_TRANSIENT', 'TIMEOUT', true),
    );
  });
});

test('PH3-13C2 RAGFlow 解析轮询只接受 DONE 且非零切片', async (t) => {
  const cases: Array<{
    name: string;
    document: RagflowDocument;
    expectedCode: RagflowError['code'];
    expectedReason: RagflowError['reason'];
  }> = [
    {
      name: '解析失败',
      document: { id: 'doc-1', name: 'a.md', run: 'FAIL', chunk_count: 0 },
      expectedCode: 'REMOTE_CONTRACT',
      expectedReason: 'PARSE_FAILED',
    },
    {
      name: '未知状态',
      document: { id: 'doc-1', name: 'a.md', run: 'MYSTERY', chunk_count: 0 },
      expectedCode: 'REMOTE_CONTRACT',
      expectedReason: 'UNKNOWN_PARSE_STATE',
    },
    {
      name: '完成但零切片',
      document: { id: 'doc-1', name: 'a.md', run: 'DONE', chunk_count: 0 },
      expectedCode: 'QUALITY_BLOCK',
      expectedReason: 'ZERO_CHUNKS',
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const fetch: RagflowFetch = async () => jsonResponse({
        code: 0,
        data: { total: 1, docs: [entry.document] },
      });
      await assert.rejects(
        createClient(fetch).waitForDocumentReady({ datasetId: 'dataset-stage', documentId: 'doc-1' }),
        (error) => assertRagflowError(error, entry.expectedCode, entry.expectedReason, false),
      );
    });
  }

  let requestCount = 0;
  const successFetch: RagflowFetch = async () => {
    requestCount += 1;
    return jsonResponse({
      code: 0,
      data: {
        total: 1,
        docs: [{
          id: 'doc-1',
          name: 'a.md',
          run: requestCount === 1 ? 'RUNNING' : 'DONE',
          chunk_count: requestCount === 1 ? 0 : 7,
        }],
      },
    });
  };
  const ready = await createClient(successFetch, { sleep: async () => undefined })
    .waitForDocumentReady({ datasetId: 'dataset-stage', documentId: 'doc-1' });
  assert.equal(ready.chunk_count, 7);
});

test('PH3-13C2 RAGFlow 对 401/403、429、5xx、网络和超时做稳定分类', async (t) => {
  for (const status of [401, 403]) {
    await t.test(`HTTP ${status}`, async () => {
      const fetch: RagflowFetch = async () => new Response('', { status });
      await assert.rejects(
        createClient(fetch).listAllDocuments('dataset-stage'),
        (error) => assertRagflowError(error, 'REMOTE_AUTH_CONFIG', 'AUTHENTICATION', false),
      );
    });
  }
  await t.test('HTTP 429', async () => {
    const fetch: RagflowFetch = async () => new Response('', { status: 429 });
    await assert.rejects(
      createClient(fetch).listAllDocuments('dataset-stage'),
      (error) => assertRagflowError(error, 'REMOTE_TRANSIENT', 'RATE_LIMITED', true),
    );
  });
  await t.test('HTTP 503', async () => {
    const fetch: RagflowFetch = async () => new Response('', { status: 503 });
    await assert.rejects(
      createClient(fetch).listAllDocuments('dataset-stage'),
      (error) => assertRagflowError(error, 'REMOTE_TRANSIENT', 'SERVER_ERROR', true),
    );
  });
  await t.test('网络错误', async () => {
    const fetch: RagflowFetch = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(
      createClient(fetch).listAllDocuments('dataset-stage'),
      (error) => assertRagflowError(error, 'REMOTE_TRANSIENT', 'NETWORK', true),
    );
  });
  await t.test('请求超时', async () => {
    const fetch: RagflowFetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
    await assert.rejects(
      createClient(fetch, { requestTimeoutMs: 1 }).listAllDocuments('dataset-stage'),
      (error) => assertRagflowError(error, 'REMOTE_TRANSIENT', 'TIMEOUT', true),
    );
  });
});
