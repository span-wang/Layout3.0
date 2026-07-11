import type { RagflowChunk, RagflowConfig, RagflowDatasetSummary } from '@/types/knowledge';

export interface KnowledgeRetrievalQueryOptions {
  topic: string;
  grade: string;
  subject: string;
  requirementDescription: string;
}

export interface RagflowChunkRefinementResult {
  chunks: RagflowChunk[];
  rejectedByScore: number;
  rejectedAsDuplicate: number;
  rejectedByDocumentLimit: number;
  rejectedByResultLimit: number;
}

/**
 * 检索词只保留用户明确提供的主题约束。
 * 生成类型会在后续元数据路由阶段表达，不能再用“例题、易错点”等通用词污染查询。
 */
export function buildKnowledgeRetrievalQuery(options: KnowledgeRetrievalQueryOptions): string {
  const parts = [options.subject, options.grade, options.topic, options.requirementDescription]
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return Array.from(new Set(parts)).join(' ');
}

/**
 * 第一阶段先按结构化学科做保守的数据集路由。
 * 有明确学科却没有匹配知识库时返回空数组，避免静默跨学科扩大检索范围。
 */
export function routeRagflowDatasetIds(options: {
  datasets: RagflowDatasetSummary[];
  selectedDatasetIds: string[];
  subject: string;
}): string[] {
  const selectedIdSet = new Set(options.selectedDatasetIds);
  const selectedDatasets = options.datasets.filter((dataset) => selectedIdSet.has(dataset.id));
  const normalizedSubject = normalizeRoutingText(options.subject);

  if (!normalizedSubject) {
    return selectedDatasets.map((dataset) => dataset.id);
  }

  return selectedDatasets
    .filter((dataset) => {
      const normalizedDatasetName = normalizeRoutingText(dataset.name);
      return normalizedDatasetName.includes(normalizedSubject) || normalizedSubject.includes(normalizedDatasetName);
    })
    .map((dataset) => dataset.id);
}

/**
 * RAGFlow 返回候选后再做一次本地精度门禁。
 * 这一层不能省略，因为当前 RAGFlow 版本在元数据过滤后会绕过服务端相似度阈值。
 */
export function refineRagflowChunks(
  chunks: readonly RagflowChunk[],
  config: Pick<RagflowConfig, 'resultLimit' | 'similarityThreshold'>,
): RagflowChunkRefinementResult {
  const sortedChunks = chunks
    .map((chunk, index) => ({ chunk, index }))
    .sort((left, right) => {
      const scoreDifference = getChunkScore(right.chunk) - getChunkScore(left.chunk);
      return scoreDifference === 0 ? left.index - right.index : scoreDifference;
    })
    .map((item) => item.chunk);

  const acceptedChunks: RagflowChunk[] = [];
  const documentCounts = new Map<string, number>();
  let rejectedByScore = 0;
  let rejectedAsDuplicate = 0;
  let rejectedByDocumentLimit = 0;
  let rejectedByResultLimit = 0;

  for (const chunk of sortedChunks) {
    if (typeof chunk.similarity !== 'number' || chunk.similarity < config.similarityThreshold) {
      rejectedByScore += 1;
      continue;
    }

    const documentKey = `${chunk.datasetId}:${chunk.documentId}`;
    if ((documentCounts.get(documentKey) ?? 0) >= 2) {
      rejectedByDocumentLimit += 1;
      continue;
    }

    if (acceptedChunks.some((acceptedChunk) => areChunksNearDuplicate(acceptedChunk.content, chunk.content))) {
      rejectedAsDuplicate += 1;
      continue;
    }

    if (acceptedChunks.length >= config.resultLimit) {
      rejectedByResultLimit += 1;
      continue;
    }

    acceptedChunks.push(chunk);
    documentCounts.set(documentKey, (documentCounts.get(documentKey) ?? 0) + 1);
  }

  return {
    chunks: acceptedChunks,
    rejectedByScore,
    rejectedAsDuplicate,
    rejectedByDocumentLimit,
    rejectedByResultLimit,
  };
}

export function areChunksNearDuplicate(leftContent: string, rightContent: string): boolean {
  const left = normalizeDuplicateText(leftContent);
  const right = normalizeDuplicateText(rightContent);
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (shorter.length >= 24 && shorter.length / longer.length >= 0.8 && longer.includes(shorter)) {
    return true;
  }

  const leftGrams = buildCharacterGrams(left, 3);
  const rightGrams = buildCharacterGrams(right, 3);
  if (leftGrams.size === 0 || rightGrams.size === 0) {
    return false;
  }

  let intersectionSize = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) {
      intersectionSize += 1;
    }
  }
  const unionSize = leftGrams.size + rightGrams.size - intersectionSize;
  return unionSize > 0 && intersectionSize / unionSize >= 0.88;
}

function getChunkScore(chunk: RagflowChunk): number {
  return typeof chunk.similarity === 'number' ? chunk.similarity : Number.NEGATIVE_INFINITY;
}

function normalizeRoutingText(value: string): string {
  return value.toLowerCase().replace(/[\s（）()【】\[\]·_\-]+/g, '');
}

function normalizeDuplicateText(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function buildCharacterGrams(value: string, size: number): Set<string> {
  if (value.length < size) {
    return new Set(value ? [value] : []);
  }

  const grams = new Set<string>();
  for (let index = 0; index <= value.length - size; index += 1) {
    grams.add(value.slice(index, index + size));
  }
  return grams;
}
