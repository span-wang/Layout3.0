import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertContractReportSanitized,
  assertExactDatasetDeleteIds,
  assertIsolatedDatasetName,
  assertOwnedDatasetId,
  assertOwnedDocumentIds,
  buildRagflowRetrievalBody,
  buildRouteARetrievalBody,
  CONTRACT_TASK_ID,
  createIsolatedDatasetName,
  isFailClosedDocumentZeroMatch,
  resolveRagflowContractConfig,
  sanitizeContractReport,
  type RagflowContractConfig,
  type RagflowRetrievalBody,
} from './lib/ragflowContractProbe';

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

interface RagflowDataset {
  id?: string;
  name?: string;
}

interface RagflowDocument {
  id?: string;
  name?: string;
  run?: string;
  progress?: number;
  progress_msg?: string;
  chunk_count?: number;
  meta_fields?: Record<string, unknown>;
}

interface DocumentListPayload {
  total?: number;
  docs?: RagflowDocument[];
}

interface RetrievalPayload {
  total?: number;
  chunks?: Array<{
    id?: string;
    document_id?: string;
    dataset_id?: string;
  }>;
}

interface RetrievalObservation {
  apiCode: number;
  message: string;
  chunkCount: number;
  documentIds: string[];
}

interface ContractCheck {
  id: string;
  passed: boolean;
  evidence: Record<string, unknown>;
}

interface ContractReport {
  schemaVersion: 1;
  taskId: string;
  runId: string;
  generatedAt: string;
  completedAt?: string;
  mode: 'isolated-write';
  passed: boolean;
  safeguards: {
    explicitBaseUrl: true;
    explicitApiKey: true;
    explicitWriteConfirmation: true;
    uniqueDatasetPrefix: true;
    productionDatasetIdsUsed: false;
    reportContainsEndpointOrCredential: false;
    reportContainsAbsolutePath: false;
  };
  dataset: {
    name: string;
    id?: string;
    created: boolean;
    cleanupAttempted: boolean;
    cleanupSucceeded: boolean;
  };
  checks: ContractCheck[];
  error?: string;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const reportDirectory = path.join(projectRoot, 'evaluation', 'ragflow', 'contracts');
const reportPath = path.join(reportDirectory, 'foundation-contract.v1.json');
const config = resolveRagflowContractConfig(process.env);
const runId = randomUUID();
const datasetName = createIsolatedDatasetName(new Date(), runId);
const report: ContractReport = {
  schemaVersion: 1,
  taskId: CONTRACT_TASK_ID,
  runId,
  generatedAt: new Date().toISOString(),
  mode: 'isolated-write',
  passed: false,
  safeguards: {
    explicitBaseUrl: true,
    explicitApiKey: true,
    explicitWriteConfirmation: true,
    uniqueDatasetPrefix: true,
    productionDatasetIdsUsed: false,
    reportContainsEndpointOrCredential: false,
    reportContainsAbsolutePath: false,
  },
  dataset: {
    name: datasetName,
    created: false,
    cleanupAttempted: false,
    cleanupSucceeded: false,
  },
  checks: [],
};

let createdDatasetId: string | undefined;
let fatalError: unknown;

try {
  assertIsolatedDatasetName(datasetName);
  const createEnvelope = await requestApi<RagflowDataset>(config, '/api/v1/datasets', {
    method: 'POST',
    body: JSON.stringify({
      name: datasetName,
      description: 'PH3-13A 一次性隔离合同测试；运行结束自动删除。',
      chunk_method: 'naive',
    }),
  });
  const dataset = requireApiData(createEnvelope, '创建隔离数据集');
  if (!dataset.id) {
    throw new Error('创建数据集后未返回可清理的数据集 ID。');
  }
  createdDatasetId = dataset.id;
  report.dataset.id = dataset.id;
  report.dataset.created = true;
  if (dataset.name !== datasetName) {
    throw new Error('创建数据集的返回名称不符合本轮隔离约束。');
  }
  addCheck(report, 'dataset.create-isolated', true, {
    returnedNameMatches: true,
    uniquePrefixMatches: true,
  });

  const marker = '琥珀齿轮协议';
  const pendingFileName = `contract-${runId.slice(0, 8)}-pending.txt`;
  const activeFileName = `contract-${runId.slice(0, 8)}-active.txt`;
  const pendingContent = [
    '资料状态：待质量验收。',
    ...Array.from({ length: 24 }, () => `${marker}用于验证排序前文档过滤。`),
  ].join('\n');
  const activeContent = [
    '资料状态：已正式发布。',
    `${marker}用于验证正式检索通道。`,
    '本文件故意降低关键词密度，但仍必须能被精确 document_ids 前置选中。',
  ].join('\n');

  const uploadedDocuments = await uploadDocuments(config, createdDatasetId, createdDatasetId, [
    { name: pendingFileName, content: pendingContent },
    { name: activeFileName, content: activeContent },
  ]);
  const uploadedByName = new Map(uploadedDocuments.map((document) => [document.name, document]));
  const pendingDocumentId = uploadedByName.get(pendingFileName)?.id;
  const activeDocumentId = uploadedByName.get(activeFileName)?.id;
  if (!pendingDocumentId || !activeDocumentId || pendingDocumentId === activeDocumentId) {
    throw new Error('两份对抗文档上传后未得到两个不同的文档 ID。');
  }
  const createdDocumentIds = new Set([pendingDocumentId, activeDocumentId]);
  addCheck(report, 'document.upload-adversarial-pair', true, {
    uploadedCount: uploadedDocuments.length,
    distinctDocumentCount: createdDocumentIds.size,
  });

  const metadataByDocumentId = new Map<string, Record<string, unknown>>([
    [pendingDocumentId, {
      metadata_schema: 'layout3_ingestion_v1',
      status: 'pending',
      contract_run_id: runId,
      canonical_id: `contract:${runId}:pending`,
    }],
    [activeDocumentId, {
      metadata_schema: 'layout3_ingestion_v1',
      status: 'active',
      contract_run_id: runId,
      canonical_id: `contract:${runId}:active`,
    }],
  ]);

  for (const [documentId, metadata] of metadataByDocumentId) {
    await patchDocumentMetadata(
      config,
      createdDatasetId,
      createdDatasetId,
      documentId,
      createdDocumentIds,
      metadata,
    );
  }
  const metadataDocuments = await listIsolatedDocuments(config, createdDatasetId, createdDatasetId);
  const metadataRoundtripPassed = [...metadataByDocumentId].every(([documentId, expected]) => {
    const actual = metadataDocuments.find((document) => document.id === documentId)?.meta_fields;
    return actual && Object.entries(expected).every(([key, value]) => actual[key] === value);
  });
  addCheck(report, 'document.metadata-patch-roundtrip', Boolean(metadataRoundtripPassed), {
    patchedCount: metadataByDocumentId.size,
    verifiedCount: metadataRoundtripPassed ? metadataByDocumentId.size : 0,
  });

  await triggerParse(
    config,
    createdDatasetId,
    createdDatasetId,
    [...createdDocumentIds],
    createdDocumentIds,
  );
  const parsedDocuments = await waitForParsing(
    config,
    createdDatasetId,
    createdDatasetId,
    createdDocumentIds,
  );
  addCheck(report, 'document.parse-trigger-poll', true, {
    doneCount: parsedDocuments.length,
    chunkCount: parsedDocuments.reduce((sum, document) => sum + (document.chunk_count ?? 0), 0),
    zeroChunkCount: parsedDocuments.filter((document) => !(document.chunk_count ?? 0)).length,
  });

  const bothDocumentIds = [pendingDocumentId, activeDocumentId];
  const documentIdObservation = await observeRetrieval(config, buildRagflowRetrievalBody({
    datasetId: createdDatasetId,
    question: marker,
    documentIds: bothDocumentIds,
  }));
  const bothDocumentsRecalled = hasExactDocumentSet(documentIdObservation.documentIds, bothDocumentIds);
  addCheck(report, 'retrieval.document-ids-nonempty',
    documentIdObservation.apiCode === 0 && bothDocumentsRecalled,
    retrievalEvidence(documentIdObservation, { expectedDocumentCount: 2 }),
  );

  const forgedDocumentId = randomUUID().replaceAll('-', '');
  const forgedObservation = await observeRetrieval(config, buildRagflowRetrievalBody({
    datasetId: createdDatasetId,
    question: marker,
    documentIds: [forgedDocumentId],
  }));
  addCheck(report, 'retrieval.document-ids-forged-zero-match',
    isFailClosedDocumentZeroMatch(forgedObservation),
    retrievalEvidence(forgedObservation, {
      expectedChunkCount: 0,
      acceptedMode: forgedObservation.apiCode === 0 ? 'empty-result' : 'explicit-ownership-rejection',
    }),
  );

  const topObservation = await observeRetrieval(config, buildRagflowRetrievalBody({
    datasetId: createdDatasetId,
    question: marker,
    pageSize: 1,
  }));
  const topDocumentId = topObservation.documentIds[0];
  const lowerRankedDocumentId = topDocumentId === pendingDocumentId ? activeDocumentId : pendingDocumentId;
  const prefilterObservation = await observeRetrieval(config, buildRagflowRetrievalBody({
    datasetId: createdDatasetId,
    question: marker,
    pageSize: 1,
    documentIds: [lowerRankedDocumentId],
  }));
  const prefilterPassed = bothDocumentsRecalled
    && bothDocumentIds.includes(topDocumentId)
    && prefilterObservation.apiCode === 0
    && hasExactDocumentSet(prefilterObservation.documentIds, [lowerRankedDocumentId]);
  addCheck(report, 'retrieval.document-ids-before-ranking', prefilterPassed, {
    unrestrictedTopDocumentId: topDocumentId || null,
    restrictedDocumentId: lowerRankedDocumentId,
    restrictedChunkCount: prefilterObservation.chunkCount,
    restrictedReturnedDocumentIds: prefilterObservation.documentIds,
  });

  const pendingRouteABody = buildRouteARetrievalBody({
    datasetId: createdDatasetId,
    question: marker,
    documentIds: [pendingDocumentId],
  });
  const pendingRouteAObservation = await observeRetrieval(config, pendingRouteABody);
  addCheck(report, 'retrieval.route-a-pending-exact-ids',
    pendingRouteAObservation.apiCode === 0
      && !('metadata_condition' in pendingRouteABody)
      && hasExactDocumentSet(pendingRouteAObservation.documentIds, [pendingDocumentId]),
    retrievalEvidence(pendingRouteAObservation, {
      documentIdFilterCount: pendingRouteABody.document_ids.length,
      metadataConditionSent: 'metadata_condition' in pendingRouteABody,
    }),
  );

  const activeRouteABody = buildRouteARetrievalBody({
    datasetId: createdDatasetId,
    question: marker,
    documentIds: [activeDocumentId],
  });
  const activeRouteAObservation = await observeRetrieval(config, activeRouteABody);
  addCheck(report, 'retrieval.route-a-active-exact-ids',
    activeRouteAObservation.apiCode === 0
      && !('metadata_condition' in activeRouteABody)
      && hasExactDocumentSet(activeRouteAObservation.documentIds, [activeDocumentId]),
    retrievalEvidence(activeRouteAObservation, {
      documentIdFilterCount: activeRouteABody.document_ids.length,
      metadataConditionSent: 'metadata_condition' in activeRouteABody,
    }),
  );

  const pendingMetadataObservation = await observeRetrieval(config, buildRagflowRetrievalBody({
    datasetId: createdDatasetId,
    question: marker,
    status: 'pending',
  }));
  addCheck(report, 'retrieval.metadata-pending-only',
    pendingMetadataObservation.apiCode === 0
      && hasExactDocumentSet(pendingMetadataObservation.documentIds, [pendingDocumentId]),
    retrievalEvidence(pendingMetadataObservation, { expectedStatus: 'pending' }),
  );

  const activeMetadataObservation = await observeRetrieval(config, buildRagflowRetrievalBody({
    datasetId: createdDatasetId,
    question: marker,
    status: 'active',
  }));
  addCheck(report, 'retrieval.metadata-active-only',
    activeMetadataObservation.apiCode === 0
      && hasExactDocumentSet(activeMetadataObservation.documentIds, [activeDocumentId]),
    retrievalEvidence(activeMetadataObservation, { expectedStatus: 'active' }),
  );

  // 两个联合通道故意同时传入 pending 与 active ID，防止 metadata 被后端静默忽略却误判通过。
  const pendingChannelObservation = await observeRetrieval(config, buildRagflowRetrievalBody({
    datasetId: createdDatasetId,
    question: marker,
    documentIds: bothDocumentIds,
    status: 'pending',
  }));
  addCheck(report, 'retrieval.quality-pending-conjunction',
    bothDocumentsRecalled
      && pendingChannelObservation.apiCode === 0
      && hasExactDocumentSet(pendingChannelObservation.documentIds, [pendingDocumentId]),
    retrievalEvidence(pendingChannelObservation, { expectedStatus: 'pending', documentIdFilterCount: 2 }),
  );

  const activeChannelObservation = await observeRetrieval(config, buildRagflowRetrievalBody({
    datasetId: createdDatasetId,
    question: marker,
    documentIds: bothDocumentIds,
    status: 'active',
  }));
  addCheck(report, 'retrieval.formal-active-conjunction',
    bothDocumentsRecalled
      && activeChannelObservation.apiCode === 0
      && hasExactDocumentSet(activeChannelObservation.documentIds, [activeDocumentId]),
    retrievalEvidence(activeChannelObservation, { expectedStatus: 'active', documentIdFilterCount: 2 }),
  );

  const deleteEnvelope = await deleteDocuments(
    config,
    createdDatasetId,
    createdDatasetId,
    [activeDocumentId],
    createdDocumentIds,
  );
  const remainingDocuments = await listIsolatedDocuments(config, createdDatasetId, createdDatasetId);
  const deletePassed = deleteEnvelope.code === 0
    && remainingDocuments.length === 1
    && remainingDocuments[0]?.id === pendingDocumentId;
  addCheck(report, 'document.delete-exact-id', deletePassed, {
    apiCode: deleteEnvelope.code,
    remainingDocumentCount: remainingDocuments.length,
    expectedDocumentRemains: remainingDocuments[0]?.id === pendingDocumentId,
  });
} catch (error) {
  fatalError = error;
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (createdDatasetId) {
    report.dataset.cleanupAttempted = true;
    try {
      const ids = [createdDatasetId];
      assertExactDatasetDeleteIds(ids, createdDatasetId);
      const cleanupEnvelope = await requestApi<unknown>(config, '/api/v1/datasets', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      const datasetsAfterCleanup = cleanupEnvelope.code === 0
        ? requireApiData(
            await requestApi<RagflowDataset[]>(config, '/api/v1/datasets?page=1&page_size=100'),
            '回读隔离数据集清理结果',
          )
        : [];
      const absentOnReadback = !datasetsAfterCleanup.some((dataset) => dataset.id === createdDatasetId);
      report.dataset.cleanupSucceeded = cleanupEnvelope.code === 0 && absentOnReadback;
      addCheck(report, 'dataset.cleanup-finally', report.dataset.cleanupSucceeded, {
        apiCode: cleanupEnvelope.code,
        exactCreatedDatasetOnly: true,
        absentOnReadback,
      });
      if (!report.dataset.cleanupSucceeded && !fatalError) {
        const cleanupFailure = new Error(cleanupEnvelope.message || '隔离数据集删除后仍能回读，清理未完成。');
        fatalError = cleanupFailure;
        report.error = cleanupFailure.message;
      }
    } catch (cleanupError) {
      report.dataset.cleanupSucceeded = false;
      addCheck(report, 'dataset.cleanup-finally', false, {
        exactCreatedDatasetOnly: true,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
      if (!fatalError) {
        fatalError = cleanupError;
        report.error = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      }
    }
  }

  report.completedAt = new Date().toISOString();
  report.passed = !fatalError
    && report.dataset.cleanupSucceeded
    && report.checks.length > 0
    && report.checks.every((check) => check.passed);
  const secrets = [config.apiKey, config.baseUrl, projectRoot, process.cwd()];
  const sanitizedReport = sanitizeContractReport(report, secrets);
  assertContractReportSanitized(sanitizedReport, secrets);
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(sanitizedReport, null, 2)}\n`, 'utf8');
}

if (fatalError) {
  throw new Error(`RAGFlow 隔离合同探针执行失败；已写入脱敏报告。${report.dataset.cleanupSucceeded ? '' : ' 隔离数据集清理未确认成功。'}`);
}
if (!report.passed) {
  throw new Error('RAGFlow 隔离合同存在未通过项；已写入脱敏事实报告，请继续运行所选路线的机器决策。');
}
console.log('RAGFlow 隔离合同全部通过；脱敏报告已写入 evaluation/ragflow/contracts/foundation-contract.v1.json。');

function addCheck(
  targetReport: ContractReport,
  id: string,
  passed: boolean,
  evidence: Record<string, unknown>,
): void {
  targetReport.checks.push({ id, passed, evidence });
  console.log(`${passed ? '通过' : '失败'}\t${id}`);
}

async function requestApi<T>(
  requestConfig: RagflowContractConfig,
  endpoint: string,
  init: RequestInit = {},
): Promise<ApiEnvelope<T>> {
  if (!endpoint.startsWith('/api/v1/')) {
    throw new Error('拒绝请求合同范围外的 API 路径。');
  }
  const isFormData = init.body instanceof FormData;
  const response = await fetch(`${requestConfig.baseUrl}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requestConfig.apiKey}`,
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`RAGFlow HTTP 请求失败：${response.status} ${response.statusText}；返回片段：${body.slice(0, 200)}`);
  }
  try {
    return JSON.parse(body) as ApiEnvelope<T>;
  } catch {
    throw new Error(`RAGFlow 返回无法解析的 JSON；返回片段：${body.slice(0, 200)}`);
  }
}

function requireApiData<T>(envelope: ApiEnvelope<T>, action: string): T {
  if (envelope.code !== 0 || envelope.data === undefined) {
    throw new Error(`${action}失败：${envelope.message || `RAGFlow 错误码 ${envelope.code}`}`);
  }
  return envelope.data;
}

async function uploadDocuments(
  requestConfig: RagflowContractConfig,
  targetDatasetId: string,
  ownedDatasetId: string,
  files: Array<{ name: string; content: string }>,
): Promise<RagflowDocument[]> {
  assertOwnedDatasetId(targetDatasetId, ownedDatasetId);
  const form = new FormData();
  for (const file of files) {
    form.append('file', new Blob([file.content], { type: 'text/plain;charset=utf-8' }), file.name);
  }
  const envelope = await requestApi<RagflowDocument[]>(
    requestConfig,
    `/api/v1/datasets/${targetDatasetId}/documents`,
    { method: 'POST', body: form },
  );
  const documents = requireApiData(envelope, '上传对抗文档');
  if (documents.length !== files.length) {
    throw new Error(`上传文档返回数量不一致：期望 ${files.length}，实际 ${documents.length}。`);
  }
  return documents;
}

async function patchDocumentMetadata(
  requestConfig: RagflowContractConfig,
  targetDatasetId: string,
  ownedDatasetId: string,
  documentId: string,
  ownedDocumentIds: Iterable<string>,
  metadata: Record<string, unknown>,
): Promise<void> {
  assertOwnedDatasetId(targetDatasetId, ownedDatasetId);
  assertOwnedDocumentIds([documentId], ownedDocumentIds);
  const envelope = await requestApi<unknown>(
    requestConfig,
    `/api/v1/datasets/${targetDatasetId}/documents/${documentId}`,
    { method: 'PATCH', body: JSON.stringify({ meta_fields: metadata }) },
  );
  if (envelope.code !== 0) {
    throw new Error(`PATCH metadata 失败：${envelope.message || envelope.code}`);
  }
}

async function triggerParse(
  requestConfig: RagflowContractConfig,
  targetDatasetId: string,
  ownedDatasetId: string,
  documentIds: string[],
  ownedDocumentIds: Iterable<string>,
): Promise<void> {
  assertOwnedDatasetId(targetDatasetId, ownedDatasetId);
  assertOwnedDocumentIds(documentIds, ownedDocumentIds);
  const envelope = await requestApi<unknown>(requestConfig, `/api/v1/datasets/${targetDatasetId}/chunks`, {
    method: 'POST',
    body: JSON.stringify({ document_ids: documentIds }),
  });
  if (envelope.code !== 0) {
    throw new Error(`触发解析失败：${envelope.message || envelope.code}`);
  }
}

async function waitForParsing(
  requestConfig: RagflowContractConfig,
  targetDatasetId: string,
  ownedDatasetId: string,
  expectedDocumentIds: Set<string>,
): Promise<RagflowDocument[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= requestConfig.parseTimeoutMs) {
    const documents = await listIsolatedDocuments(requestConfig, targetDatasetId, ownedDatasetId);
    const expectedDocuments = documents.filter((document) => document.id && expectedDocumentIds.has(document.id));
    const failed = expectedDocuments.filter((document) => ['FAIL', 'FAILED', 'CANCEL'].includes(String(document.run).toUpperCase()));
    if (failed.length > 0) {
      throw new Error(`隔离文档解析失败：${failed.map((document) => document.name || document.id).join('、')}`);
    }
    if (expectedDocuments.length === expectedDocumentIds.size
      && expectedDocuments.every((document) => String(document.run).toUpperCase() === 'DONE' && (document.chunk_count ?? 0) > 0)) {
      return expectedDocuments;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`隔离文档解析等待超过 ${Math.round(requestConfig.parseTimeoutMs / 1000)} 秒。`);
}

async function listIsolatedDocuments(
  requestConfig: RagflowContractConfig,
  targetDatasetId: string,
  ownedDatasetId: string,
): Promise<RagflowDocument[]> {
  assertOwnedDatasetId(targetDatasetId, ownedDatasetId);
  const envelope = await requestApi<DocumentListPayload>(
    requestConfig,
    `/api/v1/datasets/${targetDatasetId}/documents?page=1&page_size=100&orderby=name&desc=false`,
  );
  return requireApiData(envelope, '读取隔离数据集文档').docs || [];
}

async function observeRetrieval(
  requestConfig: RagflowContractConfig,
  body: RagflowRetrievalBody,
): Promise<RetrievalObservation> {
  const envelope = await requestApi<RetrievalPayload>(requestConfig, '/api/v1/retrieval', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const chunks = envelope.data?.chunks || [];
  return {
    apiCode: envelope.code,
    message: envelope.message || '',
    chunkCount: chunks.length,
    documentIds: [...new Set(chunks.flatMap((chunk) => chunk.document_id ? [chunk.document_id] : []))],
  };
}

async function deleteDocuments(
  requestConfig: RagflowContractConfig,
  targetDatasetId: string,
  ownedDatasetId: string,
  documentIds: string[],
  ownedDocumentIds: Iterable<string>,
): Promise<ApiEnvelope<unknown>> {
  assertOwnedDatasetId(targetDatasetId, ownedDatasetId);
  assertOwnedDocumentIds(documentIds, ownedDocumentIds);
  return requestApi(requestConfig, `/api/v1/datasets/${targetDatasetId}/documents`, {
    method: 'DELETE',
    body: JSON.stringify({ ids: documentIds }),
  });
}

function hasExactDocumentSet(actualIds: string[], expectedIds: string[]): boolean {
  const actual = new Set(actualIds);
  const expected = new Set(expectedIds);
  return actual.size === expected.size && [...expected].every((documentId) => actual.has(documentId));
}

function retrievalEvidence(
  observation: RetrievalObservation,
  expected: Record<string, unknown>,
): Record<string, unknown> {
  return {
    apiCode: observation.apiCode,
    message: observation.message,
    chunkCount: observation.chunkCount,
    returnedDocumentIds: observation.documentIds,
    ...expected,
  };
}
