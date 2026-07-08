import type {
  ImaConfig,
  ImaKnowledgeBaseSummary,
  ImaKnowledgeChunk,
  ImaKnowledgeSearchHit,
  OpenNotebookConfig,
  RagflowChunk,
  RagflowConfig,
  RagflowDatasetSummary,
  RagflowDocumentAggregate,
  RagflowRetrievalResult,
} from '@/types/knowledge';

interface MainProcessRequestResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

interface RagflowApiResponse<T> {
  code: number;
  data?: T;
  message?: string;
  total_datasets?: number;
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

interface RagflowRetrievalDocumentAggregateItem {
  document_id?: string;
  documentId?: string;
  doc_id?: string;
  docId?: string;
  document_name?: string;
  documentName?: string;
  doc_name?: string;
  docName?: string;
  count?: number;
}

interface RagflowRetrievalPayload {
  chunks?: RagflowRetrievalChunkItem[];
  doc_aggs?: RagflowRetrievalDocumentAggregateItem[];
  docAggs?: RagflowRetrievalDocumentAggregateItem[];
  total?: number;
}

interface ImaApiResponse<T> {
  code: number;
  data?: T;
  msg?: string;
}

interface ImaAddableKnowledgeBaseListItem {
  id?: string;
  name?: string;
}

interface ImaAddableKnowledgeBasePayload {
  addable_knowledge_base_list?: ImaAddableKnowledgeBaseListItem[];
}

interface ImaKnowledgeBaseInfoItem {
  id?: string;
  name?: string;
  description?: string;
  recommended_questions?: string[];
  recommendedQuestions?: string[];
}

interface ImaKnowledgeBaseInfoPayload {
  infos?: Record<string, ImaKnowledgeBaseInfoItem>;
}

interface ImaSearchKnowledgeItem {
  media_id?: string;
  title?: string;
  folder_id?: string;
  name?: string;
  parent_folder_id?: string;
  highlight_content?: string;
}

interface ImaSearchKnowledgePayload {
  info_list?: ImaSearchKnowledgeItem[];
}

interface ImaUrlInfoPayload {
  url?: string;
  headers?: Record<string, string>;
}

interface ImaNotebookExtInfoPayload {
  notebook_id?: string;
  notebookId?: string;
}

interface ImaMediaInfoPayload {
  media_type?: number;
  url_info?: ImaUrlInfoPayload;
  notebook_ext_info?: ImaNotebookExtInfoPayload;
}

interface ImaNoteContentPayload {
  content?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '');
}

function buildRequestErrorMessage(endpoint: string, response: MainProcessRequestResult): string {
  const preview = response.body.trim().slice(0, 200);
  return `请求失败：${response.status} ${response.statusText}\n接口地址：${endpoint}\n返回片段：${preview || '空响应'}`;
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

function buildImaHeaders(config: ImaConfig): Record<string, string> {
  if (!config.clientId.trim()) {
    throw new Error('请先填写 ima Client ID');
  }
  if (!config.apiKey.trim()) {
    throw new Error('请先填写 ima API Key');
  }

  return {
    'ima-openapi-clientid': config.clientId.trim(),
    'ima-openapi-apikey': config.apiKey.trim(),
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
    return await window.layoutAPI.requestAi({
      requestId,
      url: endpoint,
      method: options.method,
      headers: options.headers ?? {},
      body: options.body,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new DOMException('请求已取消', 'AbortError');
    }
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', cancelMainRequest);
  }
}

function parseRagflowApiPayload<T>(
  endpoint: string,
  response: MainProcessRequestResult,
): T {
  if (!response.ok) {
    throw new Error(buildRequestErrorMessage(endpoint, response));
  }

  const payload = parseJsonResponse<RagflowApiResponse<T>>(endpoint, response);
  if (payload.code !== 0) {
    throw new Error(payload.message?.trim() || `RAGFlow 接口返回错误码：${payload.code}`);
  }

  return payload.data as T;
}

function parseImaApiPayload<T>(
  endpoint: string,
  response: MainProcessRequestResult,
): T {
  if (!response.ok) {
    throw new Error(buildRequestErrorMessage(endpoint, response));
  }

  const payload = parseJsonResponse<ImaApiResponse<T>>(endpoint, response);
  if (payload.code !== 0) {
    throw new Error(payload.msg?.trim() || `ima 接口返回错误码：${payload.code}`);
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

function mapRagflowDocumentAggregate(item: RagflowRetrievalDocumentAggregateItem): RagflowDocumentAggregate | null {
  const documentId = pickFirstString(item.documentId, item.document_id, item.docId, item.doc_id);
  const documentName = pickFirstString(item.documentName, item.document_name, item.docName, item.doc_name);
  const count = pickFirstNumber(item.count);

  if (!documentId || !documentName || typeof count !== 'number') {
    return null;
  }

  return {
    documentId,
    documentName,
    count,
  };
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

function getResponseContentType(response: MainProcessRequestResult): string {
  return response.headers['content-type'] ?? response.headers['Content-Type'] ?? '';
}

function isTextLikeContentType(contentType: string): boolean {
  const normalizedContentType = contentType.toLowerCase();
  return (
    normalizedContentType.includes('text/') ||
    normalizedContentType.includes('json') ||
    normalizedContentType.includes('xml') ||
    normalizedContentType.includes('html') ||
    normalizedContentType.includes('markdown')
  );
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

function extractPlainTextFromHttpBody(response: MainProcessRequestResult): string {
  const contentType = getResponseContentType(response);
  if (contentType && !isTextLikeContentType(contentType)) {
    return '';
  }

  const rawBody = response.body.trim();
  if (!rawBody) {
    return '';
  }

  if (contentType.toLowerCase().includes('html') || /^<!doctype|^<html/i.test(rawBody)) {
    return extractPlainTextFromHtml(rawBody);
  }

  return normalizeReadableText(rawBody);
}

function buildImaChunkPreview(content: string): string {
  const normalizedContent = normalizeReadableText(content);
  if (normalizedContent.length <= 180) {
    return normalizedContent;
  }

  return `${normalizedContent.slice(0, 180)}...`;
}

function trimKnowledgeContextContent(content: string): string {
  const normalizedContent = normalizeReadableText(content);
  if (normalizedContent.length <= 1200) {
    return normalizedContent;
  }

  return `${normalizedContent.slice(0, 1200)}...`;
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
      body: JSON.stringify({
        dataset_ids: params.datasetIds,
        question: params.query.trim(),
        page: 1,
        page_size: params.config.resultLimit,
        top_k: Math.max(params.config.resultLimit, params.config.recallTopK),
        similarity_threshold: params.config.similarityThreshold,
        vector_similarity_weight: params.config.vectorSimilarityWeight,
        keyword: params.config.enableKeyword,
        highlight: params.config.enableHighlight,
      }),
      signal: params.signal,
    });
    const data = parseRagflowApiPayload<RagflowRetrievalPayload>(endpoint, response);
    const rawChunks = Array.isArray(data?.chunks) ? data.chunks : [];
    const chunks = rawChunks
      .map((item, index) =>
        mapRagflowChunk(item, {
          fallbackDatasetId: params.datasetIds.length === 1 ? params.datasetIds[0] : undefined,
          fallbackDocumentId: `chunk-${index + 1}`,
        }),
      )
      .filter((item): item is RagflowChunk => item !== null);
    const documentAggregateItems = Array.isArray(data?.docAggs)
      ? data.docAggs
      : Array.isArray(data?.doc_aggs)
        ? data.doc_aggs
        : [];
    const documentAggregates = documentAggregateItems
      .map((item) => mapRagflowDocumentAggregate(item))
      .filter((item): item is RagflowDocumentAggregate => item !== null);

    return {
      chunks,
      documentAggregates,
      total: typeof data?.total === 'number' ? data.total : chunks.length,
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

  async testImaConnection(config: ImaConfig): Promise<{ knowledgeBaseCount: number }> {
    const knowledgeBases = await this.listImaKnowledgeBases(config);
    return { knowledgeBaseCount: knowledgeBases.length };
  }

  async listImaKnowledgeBases(config: ImaConfig): Promise<ImaKnowledgeBaseSummary[]> {
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
      throw new Error('请先填写 ima 服务地址');
    }

    const endpoint = `${baseUrl}/openapi/wiki/v1/get_addable_knowledge_base_list`;
    const response = await requestThroughMainProcess(endpoint, {
      method: 'POST',
      headers: buildImaHeaders(config),
      body: JSON.stringify({
        cursor: '',
        limit: 50,
      }),
    });
    const data = parseImaApiPayload<ImaAddableKnowledgeBasePayload>(endpoint, response);
    const knowledgeBases = Array.isArray(data?.addable_knowledge_base_list)
      ? data.addable_knowledge_base_list
          .filter((item): item is Required<Pick<ImaAddableKnowledgeBaseListItem, 'id' | 'name'>> => Boolean(item.id && item.name))
          .map((item) => ({
            id: item.id,
            name: item.name,
          }))
      : [];

    if (knowledgeBases.length === 0) {
      return [];
    }

    const detailEndpoint = `${baseUrl}/openapi/wiki/v1/get_knowledge_base`;
    const detailResponse = await requestThroughMainProcess(detailEndpoint, {
      method: 'POST',
      headers: buildImaHeaders(config),
      body: JSON.stringify({
        ids: knowledgeBases.map((knowledgeBase) => knowledgeBase.id),
      }),
    });
    const detailData = parseImaApiPayload<ImaKnowledgeBaseInfoPayload>(detailEndpoint, detailResponse);

    return knowledgeBases.map((knowledgeBase) => {
      const detail = detailData?.infos?.[knowledgeBase.id];
      return {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        description: detail?.description?.trim() || '',
        recommendedQuestions: detail?.recommendedQuestions ?? detail?.recommended_questions ?? [],
      };
    });
  }

  async retrieveImaKnowledgeChunks(params: {
    config: ImaConfig;
    knowledgeBaseId: string;
    knowledgeBaseName?: string;
    query: string;
    signal?: AbortSignal;
  }): Promise<ImaKnowledgeChunk[]> {
    const baseUrl = normalizeBaseUrl(params.config.baseUrl);
    if (!baseUrl) {
      throw new Error('请先填写 ima 服务地址');
    }
    if (!params.knowledgeBaseId.trim()) {
      throw new Error('请先选择一个 ima 知识库');
    }
    if (!params.query.trim()) {
      throw new Error('请先输入检索词');
    }

    const endpoint = `${baseUrl}/openapi/wiki/v1/search_knowledge`;
    const response = await requestThroughMainProcess(endpoint, {
      method: 'POST',
      headers: buildImaHeaders(params.config),
      body: JSON.stringify({
        query: params.query.trim(),
        cursor: '',
        knowledge_base_id: params.knowledgeBaseId,
      }),
      signal: params.signal,
    });
    const data = parseImaApiPayload<ImaSearchKnowledgePayload>(endpoint, response);
    const matchedItems = Array.isArray(data?.info_list)
      ? data.info_list
          .filter((item): item is Required<Pick<ImaSearchKnowledgeItem, 'media_id' | 'title'>> & ImaSearchKnowledgeItem => Boolean(item.media_id && item.title))
          .slice(0, params.config.topK)
      : [];

    const chunks = await Promise.all(
      matchedItems.map(async (item) => {
        const content = await this.readImaKnowledgeContent({
          config: params.config,
          mediaId: item.media_id,
          signal: params.signal,
        }).catch(() => '');
        const fallbackContent =
          content.trim() ||
          normalizeSearchPreviewText(item.highlight_content ?? '') ||
          item.title;

        return {
          mediaId: item.media_id,
          title: item.title,
          knowledgeBaseId: params.knowledgeBaseId,
          knowledgeBaseName: params.knowledgeBaseName,
          parentFolderId: item.parent_folder_id?.trim() || undefined,
          highlightContent: item.highlight_content?.trim() || undefined,
          preview: buildImaChunkPreview(fallbackContent),
          content: trimKnowledgeContextContent(fallbackContent),
        } satisfies ImaKnowledgeChunk;
      }),
    );

    return chunks.filter((chunk) => chunk.content.trim().length > 0);
  }

  async searchImaKnowledgeHits(params: {
    config: ImaConfig;
    knowledgeBaseId: string;
    query: string;
    signal?: AbortSignal;
  }): Promise<ImaKnowledgeSearchHit[]> {
    const baseUrl = normalizeBaseUrl(params.config.baseUrl);
    if (!baseUrl) {
      throw new Error('请先填写 ima 服务地址');
    }
    if (!params.knowledgeBaseId.trim()) {
      throw new Error('请先选择一个 ima 知识库');
    }
    if (!params.query.trim()) {
      throw new Error('请先输入检索词');
    }

    const endpoint = `${baseUrl}/openapi/wiki/v1/search_knowledge`;
    const response = await requestThroughMainProcess(endpoint, {
      method: 'POST',
      headers: buildImaHeaders(params.config),
      body: JSON.stringify({
        query: params.query.trim(),
        cursor: '',
        knowledge_base_id: params.knowledgeBaseId,
      }),
      signal: params.signal,
    });
    const data = parseImaApiPayload<ImaSearchKnowledgePayload>(endpoint, response);
    const rawItems = Array.isArray(data?.info_list) ? data.info_list.slice(0, params.config.topK) : [];

    return Promise.all(
      rawItems.map(async (item, index) => {
        const highlightPreview = normalizeSearchPreviewText(item.highlight_content ?? '');
        const mediaId = item.media_id?.trim();
        const title = item.title?.trim() || item.name?.trim() || `未命名命中 ${index + 1}`;

        if (!mediaId) {
          return {
            key: item.folder_id?.trim() || `ima-folder-${index + 1}`,
            kind: 'folder',
            title,
            folderId: item.folder_id?.trim() || undefined,
            parentFolderId: item.parent_folder_id?.trim() || undefined,
            preview: highlightPreview || '命中了文件夹名称，当前版本暂不直接展开文件夹内容。',
          } satisfies ImaKnowledgeSearchHit;
        }

        try {
          const content = await this.readImaKnowledgeContent({
            config: params.config,
            mediaId,
            signal: params.signal,
          });

          return {
            key: mediaId,
            kind: 'knowledge',
            title,
            mediaId,
            parentFolderId: item.parent_folder_id?.trim() || undefined,
            preview: buildImaChunkPreview(content || highlightPreview || title),
          } satisfies ImaKnowledgeSearchHit;
        } catch (error) {
          return {
            key: mediaId,
            kind: 'knowledge',
            title,
            mediaId,
            parentFolderId: item.parent_folder_id?.trim() || undefined,
            preview: buildImaChunkPreview(highlightPreview || title),
            contentReadError: error instanceof Error ? error.message : '正文读取失败',
          } satisfies ImaKnowledgeSearchHit;
        }
      }),
    );
  }

  async buildImaKnowledgeContext(params: {
    config: ImaConfig;
    knowledgeBaseId: string;
    knowledgeBaseName?: string;
    query: string;
    signal?: AbortSignal;
  }): Promise<{
    context: string;
    chunks: ImaKnowledgeChunk[];
  }> {
    const chunks = await this.retrieveImaKnowledgeChunks(params);
    if (chunks.length === 0) {
      const fallbackHits = await this.searchImaKnowledgeHits({
        config: params.config,
        knowledgeBaseId: params.knowledgeBaseId,
        query: params.query,
        signal: params.signal,
      });

      if (fallbackHits.length === 0) {
        return {
          context: '',
          chunks,
        };
      }

      const fallbackContext = fallbackHits
        .map((hit, index) => {
          const sourceLabel = [params.knowledgeBaseName || params.knowledgeBaseId, hit.title].filter(Boolean).join(' / ');
          return [
            `### 资料片段 ${index + 1}`,
            `来源：${sourceLabel}`,
            `命中类型：${hit.kind === 'folder' ? '文件夹' : '知识条目'}`,
            '内容：',
            trimKnowledgeContextContent(hit.preview || hit.title),
          ].join('\n');
        })
        .join('\n\n');

      return {
        context: fallbackContext,
        chunks,
      };
    }

    const context = chunks
      .map((chunk, index) => {
        const sourceLabel = [chunk.knowledgeBaseName || chunk.knowledgeBaseId, chunk.title].filter(Boolean).join(' / ');
        return [
          `### 资料片段 ${index + 1}`,
          `来源：${sourceLabel}`,
          '内容：',
          chunk.content,
        ].join('\n');
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

  private async readImaKnowledgeContent(params: {
    config: ImaConfig;
    mediaId: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const baseUrl = normalizeBaseUrl(params.config.baseUrl);
    const mediaInfoEndpoint = `${baseUrl}/openapi/wiki/v1/get_media_info`;
    const mediaInfoResponse = await requestThroughMainProcess(mediaInfoEndpoint, {
      method: 'POST',
      headers: buildImaHeaders(params.config),
      body: JSON.stringify({
        media_id: params.mediaId,
      }),
      signal: params.signal,
    });
    const mediaInfo = parseImaApiPayload<ImaMediaInfoPayload>(mediaInfoEndpoint, mediaInfoResponse);

    // ima 的知识条目可能实际指向笔记；这类条目需要跳到笔记正文接口取纯文本。
    const notebookId = mediaInfo?.notebook_ext_info?.notebookId ?? mediaInfo?.notebook_ext_info?.notebook_id;
    if (mediaInfo?.media_type === 11 && notebookId) {
      return this.readImaNoteContent({
        config: params.config,
        noteId: notebookId,
        signal: params.signal,
      });
    }

    // 只对网页 / 微信文章 / Markdown / TXT 这类可直接转成纯文本的内容尝试读取原文；
    // 其他二进制媒体（PDF、图片、Office 文件等）本步先回退到搜索高亮摘要，避免把整份二进制拉回前端。
    if (typeof mediaInfo?.media_type === 'number' && ![2, 6, 7, 13].includes(mediaInfo.media_type)) {
      return '';
    }

    const url = mediaInfo?.url_info?.url?.trim();
    if (!url) {
      return '';
    }

    const rawContentResponse = await requestThroughMainProcess(url, {
      method: 'GET',
      headers: mediaInfo.url_info?.headers ?? {},
      signal: params.signal,
    });
    return extractPlainTextFromHttpBody(rawContentResponse);
  }

  private async readImaNoteContent(params: {
    config: ImaConfig;
    noteId: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const baseUrl = normalizeBaseUrl(params.config.baseUrl);
    const endpoint = `${baseUrl}/openapi/note/v1/get_doc_content`;
    const response = await requestThroughMainProcess(endpoint, {
      method: 'POST',
      headers: buildImaHeaders(params.config),
      body: JSON.stringify({
        note_id: params.noteId,
        target_content_format: 0,
      }),
      signal: params.signal,
    });
    const data = parseImaApiPayload<ImaNoteContentPayload>(endpoint, response);
    return normalizeReadableText(data?.content ?? '');
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
