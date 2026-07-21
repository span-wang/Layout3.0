import { openAsBlob } from 'node:fs';
import {
  createRagflowContractError,
  createRagflowHttpError,
  normalizeRagflowError,
  RagflowError,
} from './errors';
import type {
  RagflowApiEnvelope,
  RagflowDocument,
  RagflowDocumentListPayload,
  RagflowDatasetOption,
  RagflowDocumentReconciliation,
  RagflowMetadata,
  RagflowMetadataValue,
  RagflowParseWaitInput,
  RagflowRetrievalCandidate,
  RagflowRetrievalInput,
  RagflowUploadInput,
} from './types';

export type RagflowFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type RagflowFileBlobFactory = (filePath: string, mediaType: string) => Promise<Blob>;
export type RagflowSleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface RagflowClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: RagflowFetch;
  fileBlobFactory?: RagflowFileBlobFactory;
  sleep?: RagflowSleep;
  now?: () => number;
  requestTimeoutMs?: number;
  defaultParseTimeoutMs?: number;
  defaultPollIntervalMs?: number;
  pageSize?: number;
}

interface RequestOptions extends RequestInit {
  signal?: AbortSignal;
}

const FAILED_PARSE_STATES = new Set(['FAIL', 'FAILED', 'CANCEL', 'CANCELLED']);
const PENDING_PARSE_STATES = new Set(['UNSTART', 'RUNNING']);
const RETRIEVAL_PAGE_SIZE = 10;
const RETRIEVAL_TOP_K = 64;

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw createRagflowContractError('INVALID_RESPONSE', `${field} 必须是正整数。`);
  }
  return value;
}

function requireRemoteIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw createRagflowContractError('INVALID_RESPONSE', `${field} 必须是字符串。`);
  }
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f/\\]/.test(trimmed)) {
    throw createRagflowContractError('INVALID_RESPONSE', `${field} 为空或包含非法路径字符。`);
  }
  return trimmed;
}

function requireQuestion(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw createRagflowContractError('INVALID_RESPONSE', 'RAGFlow 检索问题不能为空。');
  }
  return value.trim();
}

function requireUniqueRemoteIdentifiers(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw createRagflowContractError('INVALID_RESPONSE', `${field} 必须是非空数组。`);
  }
  const identifiers = value.map((item) => requireRemoteIdentifier(item, field));
  if (new Set(identifiers).size !== identifiers.length) {
    throw createRagflowContractError('INVALID_RESPONSE', `${field} 不能包含重复值。`);
  }
  return identifiers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseMetadataValue(value: unknown, fieldPath: string): RagflowMetadataValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    if (!value.every((item) => (
      item === null
      || typeof item === 'string'
      || typeof item === 'boolean'
      || (typeof item === 'number' && Number.isFinite(item))
    ))) {
      throw createRagflowContractError('INVALID_RESPONSE', `RAGFlow metadata 字段 ${fieldPath} 包含不支持的数组值。`);
    }
    return value as RagflowMetadataValue;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, parseMetadataValue(child, `${fieldPath}.${key}`)]),
    );
  }
  throw createRagflowContractError('INVALID_RESPONSE', `RAGFlow metadata 字段 ${fieldPath} 包含不支持的值。`);
}

function parseMetadata(value: unknown, fieldName = 'meta_fields'): RagflowMetadata {
  if (!isRecord(value)) {
    throw createRagflowContractError('INVALID_RESPONSE', `RAGFlow ${fieldName} 不是对象。`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, parseMetadataValue(child, `${fieldName}.${key}`)]),
  );
}

/** RAGFlow 0.25.0 不接受 metadata 中的 None，出站前必须在本地失败关闭。 */
function assertMetadataHasNoNull(value: RagflowMetadataValue, fieldPath: string): void {
  if (value === null) {
    throw createRagflowContractError(
      'INVALID_RESPONSE',
      `待写入 RAGFlow 的 metadata 字段 ${fieldPath} 不能为 null。`,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataHasNoNull(item, `${fieldPath}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, child]) => assertMetadataHasNoNull(child, `${fieldPath}.${key}`));
  }
}

function parseOutboundMetadata(value: unknown): RagflowMetadata {
  const metadata = parseMetadata(value, '待写入 metadata');
  Object.entries(metadata).forEach(([field, fieldValue]) => {
    assertMetadataHasNoNull(fieldValue, `meta_fields.${field}`);
  });
  return metadata;
}

function parseDocument(value: unknown): RagflowDocument {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw createRagflowContractError('INVALID_RESPONSE', 'RAGFlow 文档缺少有效的 id 或 name。');
  }
  if (value.chunk_count !== undefined && (
    typeof value.chunk_count !== 'number'
    || !Number.isInteger(value.chunk_count)
    || value.chunk_count < 0
  )) {
    throw createRagflowContractError('INVALID_RESPONSE', `RAGFlow 文档 ${value.id} 的 chunk_count 非法。`);
  }
  if (value.run !== undefined && typeof value.run !== 'string') {
    throw createRagflowContractError('INVALID_RESPONSE', `RAGFlow 文档 ${value.id} 的 run 状态非法。`);
  }
  return {
    id: value.id,
    name: value.name,
    ...(value.run === undefined ? {} : { run: value.run }),
    ...(typeof value.progress === 'number' ? { progress: value.progress } : {}),
    ...(typeof value.progress_msg === 'string' ? { progress_msg: value.progress_msg } : {}),
    ...(value.chunk_count === undefined ? {} : { chunk_count: value.chunk_count }),
    ...(value.meta_fields === undefined ? {} : { meta_fields: parseMetadata(value.meta_fields) }),
  };
}

function parseDocumentList(value: unknown): RagflowDocumentListPayload {
  if (!isRecord(value) || !Number.isInteger(value.total) || Number(value.total) < 0 || !Array.isArray(value.docs)) {
    throw createRagflowContractError('INVALID_RESPONSE', 'RAGFlow 文档列表缺少有效的 total 或 docs。');
  }
  return {
    total: Number(value.total),
    docs: value.docs.map(parseDocument),
  };
}

function parseDatasetOption(value: unknown): RagflowDatasetOption {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()
    || typeof value.name !== 'string' || !value.name.trim()) {
    throw createRagflowContractError('INVALID_RESPONSE', 'RAGFlow 数据集缺少有效的 id 或名称。');
  }
  return { id: requireRemoteIdentifier(value.id, 'datasetId'), name: value.name.trim() };
}

function parseRetrievalCandidate(value: unknown): RagflowRetrievalCandidate {
  if (!isRecord(value)) {
    throw createRagflowContractError('INVALID_RESPONSE', 'RAGFlow 检索候选不是对象。');
  }
  const chunkId = requireRemoteIdentifier(value.id, 'chunkId');
  const datasetId = requireRemoteIdentifier(value.dataset_id, 'datasetId');
  const documentId = requireRemoteIdentifier(value.document_id, 'documentId');
  if (typeof value.content !== 'string' || !value.content.trim()) {
    throw createRagflowContractError('INVALID_RESPONSE', `RAGFlow 检索候选 ${chunkId} 缺少有效正文。`);
  }
  if (value.document_name !== undefined && (
    typeof value.document_name !== 'string'
    || !value.document_name.trim()
  )) {
    throw createRagflowContractError('INVALID_RESPONSE', `RAGFlow 检索候选 ${chunkId} 的 document_name 非法。`);
  }
  if (value.similarity !== undefined && (
    typeof value.similarity !== 'number'
    || !Number.isFinite(value.similarity)
  )) {
    throw createRagflowContractError('INVALID_RESPONSE', `RAGFlow 检索候选 ${chunkId} 的 similarity 非法。`);
  }
  return {
    chunkId,
    content: value.content,
    datasetId,
    documentId,
    ...(value.document_name === undefined ? {} : { documentName: value.document_name.trim() }),
    ...(value.similarity === undefined ? {} : { similarity: value.similarity }),
  };
}

function parseRetrievalCandidates(value: unknown): RagflowRetrievalCandidate[] {
  if (!isRecord(value) || !Array.isArray(value.chunks)) {
    throw createRagflowContractError('INVALID_RESPONSE', 'RAGFlow 检索响应缺少 chunks 数组。');
  }
  if (value.chunks.length > RETRIEVAL_PAGE_SIZE) {
    throw createRagflowContractError(
      'INVALID_RESPONSE',
      `RAGFlow 检索返回 ${value.chunks.length} 条候选，超过本次 Top ${RETRIEVAL_PAGE_SIZE} 合同。`,
    );
  }
  const candidates = value.chunks.map(parseRetrievalCandidate);
  if (new Set(candidates.map((candidate) => candidate.chunkId)).size !== candidates.length) {
    throw createRagflowContractError('INVALID_RESPONSE', 'RAGFlow 检索响应包含重复 chunk ID。');
  }
  return candidates;
}

function metadataValueEquals(left: RagflowMetadataValue | undefined, right: RagflowMetadataValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => item === right[index]);
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const rightEntries = Object.entries(right);
    return Object.keys(left).length === rightEntries.length
      && rightEntries.every(([key, value]) => (
        Object.prototype.hasOwnProperty.call(left, key)
        && metadataValueEquals(left[key] as RagflowMetadataValue | undefined, value as RagflowMetadataValue)
      ));
  }
  return left === right;
}

function createCancellationError(): RagflowError {
  return new RagflowError({
    code: 'CANCELLED',
    reason: 'CANCELLED',
    message: 'RAGFlow 入库操作已取消。',
    retryable: false,
  });
}

async function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw createCancellationError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createCancellationError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class RagflowClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetch: RagflowFetch;
  private readonly fileBlobFactory: RagflowFileBlobFactory;
  private readonly sleep: RagflowSleep;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly defaultParseTimeoutMs: number;
  private readonly defaultPollIntervalMs: number;
  private readonly pageSize: number;

  constructor(options: RagflowClientOptions) {
    let url: URL;
    try {
      url = new URL(options.baseUrl);
    } catch {
      throw new RagflowError({
        code: 'REMOTE_AUTH_CONFIG',
        reason: 'AUTHENTICATION',
        message: 'RAGFlow 入库地址不是有效 URL。',
        retryable: false,
      });
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new RagflowError({
        code: 'REMOTE_AUTH_CONFIG',
        reason: 'AUTHENTICATION',
        message: 'RAGFlow 入库地址必须使用 HTTP/HTTPS，且不能在 URL 中携带凭据。',
        retryable: false,
      });
    }
    if (!options.apiKey.trim()) {
      throw new RagflowError({
        code: 'REMOTE_AUTH_CONFIG',
        reason: 'AUTHENTICATION',
        message: '尚未配置 RAGFlow 入库 API Key。',
        retryable: false,
      });
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey.trim();
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    // openAsBlob 由 Node 按需读取文件，不会先把大文件完整装入内存。
    this.fileBlobFactory = options.fileBlobFactory ?? ((filePath, mediaType) => openAsBlob(filePath, { type: mediaType }));
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = requirePositiveInteger(options.requestTimeoutMs ?? 30_000, 'requestTimeoutMs');
    this.defaultParseTimeoutMs = requirePositiveInteger(options.defaultParseTimeoutMs ?? 4 * 60 * 60 * 1_000, 'defaultParseTimeoutMs');
    this.defaultPollIntervalMs = requirePositiveInteger(options.defaultPollIntervalMs ?? 3_000, 'defaultPollIntervalMs');
    this.pageSize = requirePositiveInteger(options.pageSize ?? 100, 'pageSize');
  }

  async listAllDocuments(datasetId: string, signal?: AbortSignal): Promise<RagflowDocument[]> {
    const safeDatasetId = requireRemoteIdentifier(datasetId, 'datasetId');
    const documents: RagflowDocument[] = [];
    const documentIds = new Set<string>();
    let expectedTotal: number | null = null;

    // total 若异常巨大，也只允许请求有限页数；超限按分页合同失败，不能无限发请求。
    for (let page = 1; page <= 100_000; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        page_size: String(this.pageSize),
        orderby: 'name',
        desc: 'false',
      });
      // 已知版本的 status 联合过滤不可靠；这里始终全分页读取，再在本地精确核验。
      const payload = parseDocumentList(await this.requestData<unknown>(
        `/api/v1/datasets/${encodeURIComponent(safeDatasetId)}/documents?${query.toString()}`,
        `读取 RAGFlow 数据集 ${safeDatasetId} 的第 ${page} 页文档`,
        { signal },
      ));

      expectedTotal ??= payload.total;
      if (payload.total !== expectedTotal) {
        throw createRagflowContractError(
          'PAGINATION_INCOMPLETE',
          `RAGFlow 文档分页期间 total 从 ${expectedTotal} 变为 ${payload.total}，已停止不确定对账。`,
        );
      }
      for (const document of payload.docs) {
        if (documentIds.has(document.id)) {
          throw createRagflowContractError(
            'PAGINATION_INCOMPLETE',
            `RAGFlow 文档 ${document.id} 在多个分页重复出现，已停止不确定对账。`,
          );
        }
        documentIds.add(document.id);
        documents.push(document);
      }
      if (documents.length === expectedTotal) return documents;
      if (documents.length > expectedTotal || payload.docs.length === 0) {
        throw createRagflowContractError(
          'PAGINATION_INCOMPLETE',
          `RAGFlow 文档分页不完整：期望 ${expectedTotal} 份，实际读取 ${documents.length} 份。`,
        );
      }
    }
    throw createRagflowContractError('PAGINATION_INCOMPLETE', 'RAGFlow 文档分页超过 100000 页，已停止异常对账。');
  }

  /**
   * 数据集接口不返回总数，因此以短页作为结束标记；重复 ID 或异常空页会失败关闭，
   * 避免配置页只看到不完整候选集后误选暂存数据集。
   */
  async listAllDatasets(signal?: AbortSignal): Promise<RagflowDatasetOption[]> {
    const datasets: RagflowDatasetOption[] = [];
    const datasetIds = new Set<string>();
    for (let page = 1; page <= 100_000; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        page_size: String(this.pageSize),
        // RAGFlow 0.25 数据集接口只接受 create_time / update_time；创建时间不会因日常修改漂移。
        orderby: 'create_time',
        desc: 'false',
      });
      const result = await this.requestData<unknown>(
        `/api/v1/datasets?${query.toString()}`,
        `读取 RAGFlow 数据集候选第 ${page} 页`,
        { signal },
      );
      if (!Array.isArray(result)) {
        throw createRagflowContractError('INVALID_RESPONSE', 'RAGFlow 数据集列表不是数组。');
      }
      const pageItems = result.map(parseDatasetOption);
      for (const dataset of pageItems) {
        if (datasetIds.has(dataset.id)) {
          throw createRagflowContractError('PAGINATION_INCOMPLETE', `RAGFlow 数据集 ${dataset.name} 在多个分页重复出现。`);
        }
        datasetIds.add(dataset.id);
        datasets.push(dataset);
      }
      if (pageItems.length < this.pageSize) {
        // 保持服务端按创建时间返回的稳定顺序，避免不同系统的中文排序规则造成界面漂移。
        return datasets;
      }
    }
    throw createRagflowContractError('PAGINATION_INCOMPLETE', 'RAGFlow 数据集分页超过 100000 页，已停止异常读取。');
  }

  async reconcileDocumentByExactName(
    datasetId: string,
    remoteFileName: string,
    signal?: AbortSignal,
  ): Promise<RagflowDocumentReconciliation> {
    const expectedName = requireRemoteIdentifier(remoteFileName, 'remoteFileName');
    const matches = (await this.listAllDocuments(datasetId, signal))
      .filter((document) => document.name === expectedName);
    if (matches.length === 0) return { kind: 'missing', remoteFileName: expectedName };
    if (matches.length === 1) {
      return { kind: 'existing', remoteFileName: expectedName, document: matches[0] };
    }
    throw createRagflowContractError(
      'DUPLICATE_REMOTE_NAME',
      `RAGFlow 中存在 ${matches.length} 份同名文档“${expectedName}”，无法确定接管对象。`,
    );
  }

  async uploadDocument(input: RagflowUploadInput): Promise<RagflowDocument> {
    const safeDatasetId = requireRemoteIdentifier(input.datasetId, 'datasetId');
    const remoteFileName = requireRemoteIdentifier(input.remoteFileName, 'remoteFileName');
    const blob = await this.fileBlobFactory(input.filePath, input.mediaType);
    if (!blob || typeof blob.stream !== 'function') {
      throw createRagflowContractError('INVALID_RESPONSE', '文件读取适配器没有返回可流式读取的 Blob。');
    }
    const form = new FormData();
    form.append('file', blob, remoteFileName);
    const data = await this.requestData<unknown>(
      `/api/v1/datasets/${encodeURIComponent(safeDatasetId)}/documents`,
      `上传 RAGFlow 文档“${remoteFileName}”`,
      { method: 'POST', body: form, signal: input.signal },
    );
    if (!Array.isArray(data) || data.length !== 1) {
      throw createRagflowContractError('INVALID_RESPONSE', 'RAGFlow 单文件上传没有返回唯一文档。');
    }
    const document = parseDocument(data[0]);
    if (document.name !== remoteFileName) {
      throw createRagflowContractError(
        'INVALID_RESPONSE',
        `RAGFlow 上传回执文件名“${document.name}”与确定性文件名“${remoteFileName}”不一致。`,
      );
    }
    return document;
  }

  async patchDocumentMetadataAndVerify(input: {
    datasetId: string;
    documentId: string;
    metadata: RagflowMetadata;
    signal?: AbortSignal;
  }): Promise<RagflowDocument> {
    const safeDatasetId = requireRemoteIdentifier(input.datasetId, 'datasetId');
    const safeDocumentId = requireRemoteIdentifier(input.documentId, 'documentId');
    const metadata = parseOutboundMetadata(input.metadata);
    await this.requestMutation(
      `/api/v1/datasets/${encodeURIComponent(safeDatasetId)}/documents/${encodeURIComponent(safeDocumentId)}`,
      `写入 RAGFlow 文档 ${safeDocumentId} 的 metadata`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta_fields: metadata }),
        signal: input.signal,
      },
    );
    return this.verifyDocumentMetadata({ ...input, metadata });
  }

  async verifyDocumentMetadata(input: {
    datasetId: string;
    documentId: string;
    metadata: RagflowMetadata;
    signal?: AbortSignal;
  }): Promise<RagflowDocument> {
    const document = await this.getDocumentById(input.datasetId, input.documentId, input.signal);
    const actual = document.meta_fields ?? {};
    for (const [field, expectedValue] of Object.entries(input.metadata)) {
      if (
        !Object.prototype.hasOwnProperty.call(actual, field)
        || !metadataValueEquals(actual[field], expectedValue)
      ) {
        throw createRagflowContractError(
          'METADATA_MISMATCH',
          `RAGFlow 文档 ${document.id} 的 metadata 字段 ${field} 回读不一致。`,
        );
      }
    }
    return document;
  }

  async triggerParse(
    datasetId: string,
    documentIds: string[],
    signal?: AbortSignal,
  ): Promise<void> {
    const safeDatasetId = requireRemoteIdentifier(datasetId, 'datasetId');
    if (documentIds.length === 0) {
      throw createRagflowContractError('INVALID_RESPONSE', '触发解析时 documentIds 不能为空。');
    }
    const safeDocumentIds = documentIds.map((id) => requireRemoteIdentifier(id, 'documentId'));
    if (new Set(safeDocumentIds).size !== safeDocumentIds.length) {
      throw createRagflowContractError('INVALID_RESPONSE', '触发解析时 documentIds 不能重复。');
    }
    await this.requestMutation(
      `/api/v1/datasets/${encodeURIComponent(safeDatasetId)}/chunks`,
      `触发 ${safeDocumentIds.length} 份 RAGFlow 文档解析`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_ids: safeDocumentIds }),
        signal,
      },
    );
  }

  async retrieveCandidates(input: RagflowRetrievalInput): Promise<RagflowRetrievalCandidate[]> {
    const question = requireQuestion(input.question);
    const datasetIds = requireUniqueRemoteIdentifiers(input.datasetIds, 'datasetIds');
    const documentIds = requireUniqueRemoteIdentifiers(input.documentIds, 'documentIds');
    const data = await this.requestData<unknown>(
      '/api/v1/retrieval',
      '执行 RAGFlow 质量门禁候选检索',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 路线 A 只发送本地解析出的精确 ID；禁止追加 status 或 metadata 条件扩大授权解释面。
        body: JSON.stringify({
          question,
          dataset_ids: datasetIds,
          document_ids: documentIds,
          page: 1,
          page_size: RETRIEVAL_PAGE_SIZE,
          top_k: RETRIEVAL_TOP_K,
          similarity_threshold: 0,
          vector_similarity_weight: 0.3,
          keyword: false,
          highlight: false,
          use_kg: false,
          toc_enhance: false,
        }),
        signal: input.signal,
      },
    );
    return parseRetrievalCandidates(data);
  }

  async waitForDocumentReady(input: RagflowParseWaitInput): Promise<RagflowDocument> {
    const timeoutMs = input.timeoutMs ?? this.defaultParseTimeoutMs;
    const pollIntervalMs = input.pollIntervalMs ?? this.defaultPollIntervalMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
      throw createRagflowContractError('INVALID_RESPONSE', '解析等待 timeoutMs 不能为负数。');
    }
    requirePositiveInteger(pollIntervalMs, 'pollIntervalMs');
    const startedAt = this.now();
    let sawPendingState = false;

    for (;;) {
      if (input.signal?.aborted) throw createCancellationError();
      const document = await this.getDocumentById(input.datasetId, input.documentId, input.signal);
      const state = String(document.run ?? '').trim().toUpperCase();
      if (state === 'DONE') {
        if (document.chunk_count === 0) {
          throw new RagflowError({
            code: 'QUALITY_BLOCK',
            reason: 'ZERO_CHUNKS',
            message: `RAGFlow 文档 ${document.id} 已完成解析但切片数为 0，不能登记为健康 pending。`,
            retryable: false,
          });
        }
        if (document.chunk_count === undefined) {
          throw createRagflowContractError(
            'INVALID_RESPONSE',
            `RAGFlow 文档 ${document.id} 已完成解析但缺少 chunk_count。`,
          );
        }
        return document;
      }
      if (FAILED_PARSE_STATES.has(state)) {
        throw createRagflowContractError(
          'PARSE_FAILED',
          `RAGFlow 文档 ${document.id} 解析失败，远端状态为 ${state}。`,
        );
      }
      // 已观察到 RUNNING 后又退回 UNSTART 属于远端状态回退，不能继续无限等待。
      if (state === 'UNSTART' && sawPendingState) {
        throw createRagflowContractError(
          'UNKNOWN_PARSE_STATE',
          `RAGFlow 文档 ${document.id} 的解析状态从运行中回退为 UNSTART。`,
        );
      }
      if (!PENDING_PARSE_STATES.has(state)) {
        throw createRagflowContractError(
          'UNKNOWN_PARSE_STATE',
          `RAGFlow 文档 ${document.id} 返回未知解析状态“${state || '空'}”。`,
        );
      }
      sawPendingState ||= state === 'RUNNING';
      if (this.now() - startedAt >= timeoutMs) {
        throw new RagflowError({
          code: 'REMOTE_TRANSIENT',
          reason: 'TIMEOUT',
          message: `等待 RAGFlow 文档 ${document.id} 解析超时，可按退避策略继续轮询。`,
          retryable: true,
        });
      }
      await this.sleep(pollIntervalMs, input.signal);
    }
  }

  private async getDocumentById(
    datasetId: string,
    documentId: string,
    signal?: AbortSignal,
  ): Promise<RagflowDocument> {
    const safeDocumentId = requireRemoteIdentifier(documentId, 'documentId');
    const document = (await this.listAllDocuments(datasetId, signal))
      .find((candidate) => candidate.id === safeDocumentId);
    if (!document) {
      throw createRagflowContractError(
        'DOCUMENT_NOT_FOUND',
        `RAGFlow 数据集中未找到文档 ${safeDocumentId}。`,
      );
    }
    return document;
  }

  private async requestData<T>(endpoint: string, action: string, init: RequestOptions = {}): Promise<T> {
    const envelope = await this.requestEnvelope<T>(endpoint, action, init);
    if (envelope.data === undefined) {
      throw createRagflowContractError('INVALID_RESPONSE', `${action}成功但响应缺少 data。`);
    }
    return envelope.data;
  }

  private async requestMutation(endpoint: string, action: string, init: RequestOptions): Promise<void> {
    await this.requestEnvelope<unknown>(endpoint, action, init);
  }

  private async requestEnvelope<T>(
    endpoint: string,
    action: string,
    init: RequestOptions,
  ): Promise<RagflowApiEnvelope<T>> {
    if (!endpoint.startsWith('/api/v1/')) {
      throw createRagflowContractError('INVALID_RESPONSE', '拒绝调用 RAGFlow 入库合同以外的 API 路径。');
    }
    if (init.signal?.aborted) throw createCancellationError();

    const requestController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, this.requestTimeoutMs);
    const cancelRequest = () => requestController.abort();
    init.signal?.addEventListener('abort', cancelRequest, { once: true });

    try {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${this.apiKey}`);
      const response = await this.fetch(`${this.baseUrl}${endpoint}`, {
        ...init,
        headers,
        signal: requestController.signal,
      });
      const rawBody = await response.text();
      if (!response.ok) throw createRagflowHttpError(response.status, response.statusText);

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw createRagflowContractError('INVALID_RESPONSE', `${action}时 RAGFlow 返回了无法解析的 JSON。`);
      }
      if (!isRecord(parsed) || typeof parsed.code !== 'number') {
        throw createRagflowContractError('INVALID_RESPONSE', `${action}时 RAGFlow 响应缺少数字 code。`);
      }
      if (parsed.code !== 0) {
        throw new RagflowError({
          code: 'REMOTE_CONTRACT',
          reason: 'API_ERROR',
          message: `${action}失败：${typeof parsed.message === 'string' && parsed.message ? parsed.message : `RAGFlow 错误码 ${parsed.code}`}。`,
          retryable: false,
          apiCode: parsed.code,
        });
      }
      return parsed as unknown as RagflowApiEnvelope<T>;
    } catch (error) {
      if (error instanceof RagflowError) throw error;
      if (init.signal?.aborted) throw createCancellationError();
      if (timedOut) {
        throw new RagflowError({
          code: 'REMOTE_TRANSIENT',
          reason: 'TIMEOUT',
          message: `${action}超时，可按退避策略重试。`,
          retryable: true,
          cause: error,
        });
      }
      throw normalizeRagflowError(error, action);
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', cancelRequest);
    }
  }
}
