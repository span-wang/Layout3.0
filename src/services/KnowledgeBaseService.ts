import type {
  OpenNotebookConfig,
  RagflowChunk,
  RagflowConfig,
  RagflowDatasetSummary,
  RagflowDocumentAggregate,
  RagflowRetrievalResult,
} from '@/types/knowledge';
import {
  throwIfMainProcessTransportError,
  throwNormalizedMainProcessInvokeError,
} from './mainProcessRequestError';
import { refineRagflowChunks } from './knowledgeRetrieval';

interface MainProcessRequestResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  transportError?: {
    code: string;
    message: string;
  };
}

interface RagflowApiResponse<T> {
  code: number;
  data?: T;
  message?: string;
  total_datasets?: number;
}

interface RagflowApiErrorNormalizationParams {
  endpoint: string;
  status?: number;
  payloadCode?: number;
  message?: string;
  bodyPreview?: string;
}

interface RagflowDatasetListItem {
  id?: string;
  name?: string;
  description?: string;
  parser_id?: string;
  parserId?: string;
  chunk_method?: string;
  chunkMethod?: string;
  doc_num?: number;
  docNum?: number;
  document_count?: number;
  documentCount?: number;
}

interface RagflowRetrievalChunkItem {
  id?: string;
  content?: string;
  dataset_id?: string;
  datasetId?: string;
  kb_id?: string;
  kbId?: string;
  document_id?: string;
  documentId?: string;
  doc_id?: string;
  docId?: string;
  document_name?: string;
  documentName?: string;
  docnm_kwd?: string;
  docnmKwd?: string;
  docnm?: string;
  document_keyword?: string;
  documentKeyword?: string;
  similarity?: number;
  term_similarity?: number;
  termSimilarity?: number;
  vector_similarity?: number;
  vectorSimilarity?: number;
  highlight?: string;
  important_keywords?: string[];
  importantKeywords?: string[];
  positions?: string[];
}

interface RagflowRetrievalPayload {
  chunks?: RagflowRetrievalChunkItem[];
  total?: number;
}

export interface RagflowRetrievalRequestBody {
  dataset_ids: string[];
  question: string;
  page: number;
  page_size: number;
  top_k: number;
  similarity_threshold: number;
  vector_similarity_weight: number;
  keyword: boolean;
  highlight: boolean;
  use_kg: false;
  toc_enhance: false;
  rerank_id?: string;
}

export function buildRagflowRetrievalRequestBody(params: {
  config: RagflowConfig;
  datasetIds: string[];
  query: string;
}): RagflowRetrievalRequestBody {
  const rerankId = params.config.rerankId.trim();
  return {
    dataset_ids: params.datasetIds,
    question: params.query.trim(),
    page: 1,
    page_size: params.config.candidateLimit,
    top_k: Math.max(params.config.candidateLimit, params.config.recallTopK),
    similarity_threshold: params.config.similarityThreshold,
    vector_similarity_weight: params.config.vectorSimilarityWeight,
    keyword: params.config.enableKeyword,
    highlight: params.config.enableHighlight,
    use_kg: false,
    toc_enhance: false,
    ...(rerankId ? { rerank_id: rerankId } : {}),
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '');
}

function buildRequestErrorMessage(endpoint: string, response: MainProcessRequestResult): string {
  const preview = response.body.trim().slice(0, 200);
  return `请求失败：${response.status} ${response.statusText}\n接口地址：${endpoint}\n返回片段：${preview || '空响应'}`;
}

/**
 * 真实联调里最常见的问题不是接口挂掉，而是 RAGFlow 的 API Key 已失效。
 * 这里先把 401 / invalid key 这类返回统一翻成中文可诊断提示，避免前台直接露出原始 JSON。
 */
export function normalizeRagflowApiErrorMessage(
  params: RagflowApiErrorNormalizationParams,
): string | null {
  const lowerMessage = `${params.message ?? ''}\n${params.bodyPreview ?? ''}`.toLowerCase();
  const isAuthError =
    params.status === 401 ||
    params.status === 403 ||
    params.payloadCode === 109 ||
    params.payloadCode === 401 ||
    lowerMessage.includes('api key is invalid') ||
    lowerMessage.includes('authentication error') ||
    lowerMessage.includes('unauthorized');

  if (!isAuthError) {
    return null;
  }

  return `RAGFlow 认证失败，请检查 API Key 是否正确，或在 RAGFlow 后台重新生成可用密钥。\n接口地址：${params.endpoint}`;
}

function parseJsonResponse<T>(endpoint: string, response: MainProcessRequestResult): T {
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new Error(
      `接口返回了无法解析的内容。\n接口地址：${endpoint}\n返回片段：${response.body.trim().slice(0, 200) || '空响应'}`,
    );
  }
}

function extractErrorMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof Error ? error.message : fallbackMessage;
}

function buildRagflowHeaders(config: RagflowConfig): Record<string, string> {
  if (!config.apiKey.trim()) {
    throw new Error('请先填写 RAGFlow API Key');
  }

  return {
    Authorization: `Bearer ${config.apiKey.trim()}`,
    'Content-Type': 'application/json',
  };
}

/**
 * 统一走主进程 HTTP 请求，避免 renderer 端跨域限制。
 */
async function requestThroughMainProcess(
  endpoint: string,
  options: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<MainProcessRequestResult> {
  if (!window.layoutAPI?.requestAi) {
    throw new Error('主进程请求通道不可用，请重启应用后重试');
  }

  const requestId = `knowledge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const cancelMainRequest = () => {
    void window.layoutAPI.cancelAiRequest?.(requestId);
  };

  if (options.signal?.aborted) {
    throw new DOMException('请求已取消', 'AbortError');
  }

  options.signal?.addEventListener('abort', cancelMainRequest, { once: true });
  try {
    const result = await window.layoutAPI.requestAi({
      requestId,
      url: endpoint,
      method: options.method,
      headers: options.headers ?? {},
      body: options.body,
    });
    throwIfMainProcessTransportError({
      url: endpoint,
      transportError: result.transportError,
    });
    return result;
  } catch (error) {
    if (options.signal?.aborted) {
      throw new DOMException('请求已取消', 'AbortError');
    }
    return throwNormalizedMainProcessInvokeError(endpoint, error);
  } finally {
    options.signal?.removeEventListener('abort', cancelMainRequest);
  }
}

function parseRagflowApiPayload<T>(
  endpoint: string,
  response: MainProcessRequestResult,
): T {
  if (!response.ok) {
    const normalizedErrorMessage = normalizeRagflowApiErrorMessage({
      endpoint,
      status: response.status,
      bodyPreview: response.body.trim().slice(0, 200),
    });
    if (normalizedErrorMessage) {
      throw new Error(normalizedErrorMessage);
    }
    throw new Error(buildRequestErrorMessage(endpoint, response));
  }

  const payload = parseJsonResponse<RagflowApiResponse<T>>(endpoint, response);
  if (payload.code !== 0) {
    const normalizedErrorMessage = normalizeRagflowApiErrorMessage({
      endpoint,
      payloadCode: payload.code,
      message: payload.message,
      bodyPreview: response.body.trim().slice(0, 200),
    });
    if (normalizedErrorMessage) {
      throw new Error(normalizedErrorMessage);
    }
    throw new Error(payload.message?.trim() || `RAGFlow 接口返回错误码：${payload.code}`);
  }

  return payload.data as T;
}

function mapRagflowDataset(item: RagflowDatasetListItem): RagflowDatasetSummary | null {
  if (!item.id || !item.name) {
    return null;
  }

  return {
    id: item.id,
    name: item.name,
    description: item.description || '',
    chunkMethod: item.chunkMethod || item.chunk_method || item.parserId || item.parser_id || '',
    documentCount:
      typeof item.documentCount === 'number'
        ? item.documentCount
        : typeof item.document_count === 'number'
          ? item.document_count
          : typeof item.docNum === 'number'
            ? item.docNum
            : typeof item.doc_num === 'number'
              ? item.doc_num
              : undefined,
  };
}

function pickFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function pickFirstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalizedValues = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return normalizedValues.length > 0 ? normalizedValues : undefined;
}

function mapRagflowChunk(
  item: RagflowRetrievalChunkItem,
  options: {
    fallbackDatasetId?: string;
    fallbackDocumentId?: string;
  },
): RagflowChunk | null {
  // RAGFlow 不同版本的字段名并不完全一致，这里尽量宽容映射，避免有效命中被静默过滤掉。
  const id = item.id?.trim();
  const highlight = normalizeSearchPreviewText(item.highlight ?? '');
  const content = normalizeReadableText(item.content ?? '') || highlight;
  const datasetId =
    pickFirstString(item.datasetId, item.dataset_id, item.kbId, item.kb_id, options.fallbackDatasetId) || 'unknown-dataset';
  const documentId =
    pickFirstString(item.documentId, item.document_id, item.docId, item.doc_id, options.fallbackDocumentId, id) ||
    'unknown-document';

  if (!id || !content || !datasetId || !documentId) {
    return null;
  }

  return {
    id,
    content,
    datasetId,
    documentId,
    documentName: pickFirstString(
      item.documentName,
      item.document_name,
      item.docnmKwd,
      item.docnm_kwd,
      item.docnm,
      item.documentKeyword,
      item.document_keyword,
    ),
    documentKeyword: pickFirstString(item.documentKeyword, item.document_keyword),
    similarity: pickFirstNumber(item.similarity),
    termSimilarity: pickFirstNumber(item.termSimilarity, item.term_similarity),
    vectorSimilarity: pickFirstNumber(item.vectorSimilarity, item.vector_similarity),
    highlight: highlight || undefined,
    importantKeywords: normalizeStringArray(item.importantKeywords ?? item.important_keywords),
    positions: normalizeStringArray(item.positions),
  };
}

function buildFilteredDocumentAggregates(chunks: RagflowChunk[]): RagflowDocumentAggregate[] {
  const aggregates = new Map<string, RagflowDocumentAggregate>();
  for (const chunk of chunks) {
    const existingAggregate = aggregates.get(chunk.documentId);
    if (existingAggregate) {
      existingAggregate.count += 1;
      continue;
    }

    aggregates.set(chunk.documentId, {
      documentId: chunk.documentId,
      documentName: chunk.documentName?.trim() || chunk.documentId,
      count: 1,
    });
  }
  return Array.from(aggregates.values());
}

function buildChunkSourceLabel(chunk: RagflowChunk, datasetNameMap: Map<string, string>): string {
  const datasetName = datasetNameMap.get(chunk.datasetId) || chunk.datasetId;
  const documentName = chunk.documentName?.trim() || chunk.documentId;
  return `${datasetName} / ${documentName}`;
}

function buildRagflowChunkScoreSummary(chunk: RagflowChunk): string | undefined {
  const scoreParts = [
    typeof chunk.similarity === 'number' ? `综合 ${chunk.similarity.toFixed(3)}` : '',
    typeof chunk.termSimilarity === 'number' ? `关键词 ${chunk.termSimilarity.toFixed(3)}` : '',
    typeof chunk.vectorSimilarity === 'number' ? `向量 ${chunk.vectorSimilarity.toFixed(3)}` : '',
  ].filter(Boolean);

  return scoreParts.length > 0 ? scoreParts.join(' / ') : undefined;
}

function normalizeReadableText(content: string): string {
  return content.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeSearchPreviewText(content: string): string {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return '';
  }

  return /<[^>]+>/.test(trimmedContent)
    ? extractPlainTextFromHtml(trimmedContent)
    : normalizeReadableText(trimmedContent);
}

function extractPlainTextFromHtml(html: string): string {
  const cleanedHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  // 通过 DOMParser 去掉标签，比直接正则替换更稳，也更适合做正文回退提取。
  const parser = new DOMParser();
  const document = parser.parseFromString(cleanedHtml, 'text/html');
  return normalizeReadableText(document.body?.textContent ?? '');
}

export class KnowledgeBaseService {
  async testRagflowConnection(config: RagflowConfig): Promise<{ datasetCount: number }> {
    const datasets = await this.listRagflowDatasets(config);
    return { datasetCount: datasets.length };
  }

  async listRagflowDatasets(config: RagflowConfig): Promise<RagflowDatasetSummary[]> {
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
      throw new Error('请先填写 RAGFlow 服务地址');
    }

    const endpoint = `${baseUrl}/api/v1/datasets?page=1&page_size=100&orderby=create_time&desc=true`;
    const response = await requestThroughMainProcess(endpoint, {
      method: 'GET',
      headers: buildRagflowHeaders(config),
    });
    const data = parseRagflowApiPayload<RagflowDatasetListItem[]>(endpoint, response);
    return Array.isArray(data)
      ? data
          .map((item) => mapRagflowDataset(item))
          .filter((item): item is RagflowDatasetSummary => item !== null)
      : [];
  }

  async retrieveRagflowChunks(params: {
    config: RagflowConfig;
    datasetIds: string[];
    query: string;
    signal?: AbortSignal;
  }): Promise<RagflowRetrievalResult> {
    const baseUrl = normalizeBaseUrl(params.config.baseUrl);
    if (!baseUrl) {
      throw new Error('请先填写 RAGFlow 服务地址');
    }
    if (!params.datasetIds.length) {
      throw new Error('请至少选择一个 RAGFlow 数据集');
    }
    if (!params.query.trim()) {
      throw new Error('请先输入检索词');
    }

    const endpoint = `${baseUrl}/api/v1/retrieval`;
    const response = await requestThroughMainProcess(endpoint, {
      method: 'POST',
      headers: buildRagflowHeaders(params.config),
      body: JSON.stringify(buildRagflowRetrievalRequestBody(params)),
      signal: params.signal,
    });
    const data = parseRagflowApiPayload<RagflowRetrievalPayload>(endpoint, response);
    const rawChunks = Array.isArray(data?.chunks) ? data.chunks : [];
    const mappedChunks = rawChunks
      .map((item, index) =>
        mapRagflowChunk(item, {
          fallbackDatasetId: params.datasetIds.length === 1 ? params.datasetIds[0] : undefined,
          fallbackDocumentId: `chunk-${index + 1}`,
        }),
      )
      .filter((item): item is RagflowChunk => item !== null);
    const refinementResult = refineRagflowChunks(mappedChunks, params.config);
    const chunks = refinementResult.chunks;
    const documentAggregates = buildFilteredDocumentAggregates(chunks);

    return {
      chunks,
      documentAggregates,
      total: typeof data?.total === 'number' ? data.total : chunks.length,
      candidateCount: mappedChunks.length,
      rejectedCount: mappedChunks.length - chunks.length,
    };
  }

  async buildRagflowKnowledgeContext(params: {
    config: RagflowConfig;
    datasetIds: string[];
    query: string;
    datasetNameMap?: Map<string, string>;
    signal?: AbortSignal;
  }): Promise<{
    context: string;
    chunks: RagflowChunk[];
  }> {
    const retrievalResult = await this.retrieveRagflowChunks(params);
    const chunks = retrievalResult.chunks;
    if (chunks.length === 0) {
      return {
        context: '',
        chunks,
      };
    }

    const datasetNameMap = params.datasetNameMap ?? new Map<string, string>();
    const context = chunks
      .map((chunk, index) => {
        const sourceLabel = buildChunkSourceLabel(chunk, datasetNameMap);
        const scoreSummary = buildRagflowChunkScoreSummary(chunk);
        return [
          `### 资料片段 ${index + 1}`,
          `来源：${sourceLabel}`,
          scoreSummary ? `命中说明：${scoreSummary}` : '',
          chunk.importantKeywords?.length ? `关键词：${chunk.importantKeywords.join('、')}` : '',
          '内容：',
          chunk.content,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');

    return {
      context,
      chunks,
    };
  }

  async testOpenNotebookConnection(config: OpenNotebookConfig): Promise<{ reachableUrl: string }> {
    const candidates = [
      config.apiUrl.trim(),
      config.uiUrl.trim(),
    ].filter(Boolean);

    if (candidates.length === 0) {
      throw new Error('请先填写 Open Notebook 地址');
    }

    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        const endpoint = normalizeBaseUrl(candidate);
        const response = await requestThroughMainProcess(endpoint, {
          method: 'GET',
        });
        if (response.ok) {
          return { reachableUrl: endpoint };
        }
        errors.push(buildRequestErrorMessage(endpoint, response));
      } catch (error) {
        errors.push(extractErrorMessage(error, 'Open Notebook 服务连接失败'));
      }
    }

    throw new Error(errors[0] || 'Open Notebook 服务连接失败');
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
