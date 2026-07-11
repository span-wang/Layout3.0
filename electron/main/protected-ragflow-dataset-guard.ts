export const PROTECTED_RAGFLOW_DATASET_ERROR_CODE = 'protected_ragflow_dataset' as const;
export const INVALID_RAGFLOW_RETRIEVAL_BODY_ERROR_CODE = 'invalid_ragflow_retrieval_body' as const;

export type ProtectedRagflowDatasetGuardDecision =
  | { allow: true }
  | {
      allow: false;
      code:
        | typeof PROTECTED_RAGFLOW_DATASET_ERROR_CODE
        | typeof INVALID_RAGFLOW_RETRIEVAL_BODY_ERROR_CODE;
      message: string;
    };

export interface ProtectedRagflowDatasetGuardRequest {
  url: string;
  body?: unknown;
}

const ALLOW: ProtectedRagflowDatasetGuardDecision = { allow: true };
const RAGFLOW_RETRIEVAL_PATH = '/api/v1/retrieval';

export function isRagflowRetrievalRequestUrl(rawUrl: string): boolean {
  try {
    const pathname = decodeURIComponent(new URL(rawUrl).pathname)
      .replace(/\/{2,}/g, '/')
      .replace(/\/+$/, '');
    return pathname.endsWith(RAGFLOW_RETRIEVAL_PATH);
  } catch {
    return false;
  }
}

function parseDatasetIds(body: unknown): string[] | null {
  let value: unknown = body;

  if (typeof body === 'string') {
    try {
      value = JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  // 缺失或格式错误的 dataset_ids 可能被远端解释为扩大检索范围，因此必须失败关闭。
  if (!Object.prototype.hasOwnProperty.call(value, 'dataset_ids')) {
    return null;
  }

  const datasetIds = (value as Record<string, unknown>).dataset_ids;
  if (!Array.isArray(datasetIds) || datasetIds.length === 0) {
    return null;
  }
  if (datasetIds.some((datasetId) => typeof datasetId !== 'string' || !datasetId.trim())) {
    return null;
  }

  return datasetIds;
}

/**
 * 在 Main 发出请求前阻止正式检索访问尚未发布的 RAGFlow 暂存数据集。
 */
export function guardProtectedRagflowDatasetRequest(
  request: ProtectedRagflowDatasetGuardRequest,
  protectedDatasetIds: Iterable<string>,
): ProtectedRagflowDatasetGuardDecision {
  const protectedIds = new Set(
    Array.from(protectedDatasetIds, (datasetId) => datasetId.trim()).filter(Boolean),
  );

  if (protectedIds.size === 0 || !isRagflowRetrievalRequestUrl(request.url)) {
    return ALLOW;
  }

  const datasetIds = parseDatasetIds(request.body);
  if (datasetIds === null) {
    return {
      allow: false,
      code: INVALID_RAGFLOW_RETRIEVAL_BODY_ERROR_CODE,
      message: '已阻止本次 RAGFlow 检索：请求体中的 dataset_ids 无法安全校验。',
    };
  }

  if (datasetIds.some((datasetId) => protectedIds.has(datasetId.trim()))) {
    return {
      allow: false,
      code: PROTECTED_RAGFLOW_DATASET_ERROR_CODE,
      message: '已阻止访问知识入库暂存数据集：该数据集尚未发布，不能用于正式检索。',
    };
  }

  return ALLOW;
}
