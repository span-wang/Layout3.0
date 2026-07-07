import type {
  OpenNotebookConfig,
  RagflowChunk,
  RagflowConfig,
  RagflowDatasetSummary,
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
  document_id?: string;
  documentId?: string;
  document_name?: string;
  documentName?: string;
  document_keyword?: string;
  documentKeyword?: string;
  similarity?: number;
}

interface RagflowRetrievalPayload {
  chunks?: RagflowRetrievalChunkItem[];
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

function mapRagflowChunk(item: RagflowRetrievalChunkItem): RagflowChunk | null {
  const id = item.id?.trim();
  const content = item.content?.trim();
  const datasetId = item.datasetId?.trim() || item.dataset_id?.trim();
  const documentId = item.documentId?.trim() || item.document_id?.trim();

  if (!id || !content || !datasetId || !documentId) {
    return null;
  }

  return {
    id,
    content,
    datasetId,
    documentId,
    documentName:
      item.documentName?.trim() ||
      item.document_name?.trim() ||
      item.documentKeyword?.trim() ||
      item.document_keyword?.trim() ||
      undefined,
    similarity: typeof item.similarity === 'number' ? item.similarity : undefined,
  };
}

function buildChunkSourceLabel(chunk: RagflowChunk, datasetNameMap: Map<string, string>): string {
  const datasetName = datasetNameMap.get(chunk.datasetId) || chunk.datasetId;
  const documentName = chunk.documentName?.trim() || chunk.documentId;
  return `${datasetName} / ${documentName}`;
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
  }): Promise<RagflowChunk[]> {
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
        page_size: params.config.topK,
        top_k: params.config.topK,
        similarity_threshold: 0.2,
        vector_similarity_weight: 0.3,
        highlight: false,
      }),
      signal: params.signal,
    });
    const data = parseRagflowApiPayload<RagflowRetrievalPayload>(endpoint, response);
    return Array.isArray(data?.chunks)
      ? data.chunks
          .map((item) => mapRagflowChunk(item))
          .filter((item): item is RagflowChunk => item !== null)
      : [];
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
    const chunks = await this.retrieveRagflowChunks(params);
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
}

export const knowledgeBaseService = new KnowledgeBaseService();
