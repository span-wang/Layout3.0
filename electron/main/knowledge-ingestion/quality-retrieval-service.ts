import { createRagflowContractError } from './ragflow/errors';

type Awaitable<T> = T | Promise<T>;

export interface QualityRetrievalScope {
  qualityRunId: string;
  versionId?: string;
  bindingId?: string;
  datasetIds: string[];
  documentIds: string[];
  expiresAt?: string;
}

export interface QualityRetrievalScopeStore {
  /** 空集合、过期、运行状态或 pending 绑定漂移必须由实现方在这里失败关闭。 */
  resolveValidScope(qualityRunId: string): Awaitable<QualityRetrievalScope>;
  recordRemoteContractViolation(input: {
    qualityRunId: string;
    returnedDocumentIds: string[];
    allowedDocumentIds: string[];
    audit?: {
      returnedDatasetIds: string[];
      allowedDatasetIds: string[];
      outOfScopeDocumentIds: string[];
      outOfScopeDatasetIds: string[];
    };
  }): Awaitable<void>;
}

export interface QualityRetrievalRemoteCandidate {
  chunkId: string;
  content: string;
  datasetId: string;
  documentId: string;
  documentName?: string;
  similarity?: number;
}

export interface QualityRetrievalRemote {
  retrieveCandidates(input: {
    question: string;
    datasetIds: string[];
    documentIds: string[];
    signal?: AbortSignal;
  }): Promise<QualityRetrievalRemoteCandidate[]>;
}

/** 只向质量运行层返回必要字段，RAGFlow 的原始响应不会越过 Main 边界。 */
export interface QualityRetrievalCandidate {
  chunkId: string;
  content: string;
  datasetId: string;
  documentId: string;
  documentName?: string;
  similarity?: number;
}

export interface QualityRetrievalServiceOptions {
  scopeStore: QualityRetrievalScopeStore;
  remote: QualityRetrievalRemote;
}

function requireNonEmpty(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw createRagflowContractError('INVALID_RESPONSE', `${fieldName} 不能为空。`);
  }
  return value.trim();
}

function normalizeScopeIdentifiers(values: unknown, fieldName: string): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw createRagflowContractError('BINDING_DRIFT', `质量运行的 ${fieldName} 为空，已在远端请求前失败关闭。`);
  }
  const normalized = values.map((value) => {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f/\\]/.test(value.trim())) {
      throw createRagflowContractError('BINDING_DRIFT', `质量运行的 ${fieldName} 包含非法 ID。`);
    }
    return value.trim();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw createRagflowContractError('BINDING_DRIFT', `质量运行的 ${fieldName} 包含重复 ID。`);
  }
  return normalized;
}

function normalizeScope(scope: QualityRetrievalScope, expectedRunId: string): QualityRetrievalScope {
  if (requireNonEmpty(scope.qualityRunId, 'scope.qualityRunId') !== expectedRunId) {
    throw createRagflowContractError('BINDING_DRIFT', '质量运行 ID 与本次检索请求不一致。');
  }
  return {
    ...scope,
    qualityRunId: expectedRunId,
    datasetIds: normalizeScopeIdentifiers(scope.datasetIds, 'datasetIds'),
    documentIds: normalizeScopeIdentifiers(scope.documentIds, 'documentIds'),
  };
}

function sameIdentity(left: QualityRetrievalScope, right: QualityRetrievalScope): boolean {
  const sameSet = (first: string[], second: string[]) => (
    first.length === second.length && first.every((value) => second.includes(value))
  );
  return left.qualityRunId === right.qualityRunId
    && left.versionId === right.versionId
    && left.bindingId === right.bindingId
    && sameSet(left.datasetIds, right.datasetIds)
    && sameSet(left.documentIds, right.documentIds);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export class QualityRetrievalService {
  private readonly scopeStore: QualityRetrievalScopeStore;
  private readonly remote: QualityRetrievalRemote;

  constructor(options: QualityRetrievalServiceOptions) {
    this.scopeStore = options.scopeStore;
    this.remote = options.remote;
  }

  async retrieve(input: {
    qualityRunId: string;
    question: string;
    signal?: AbortSignal;
  }): Promise<QualityRetrievalCandidate[]> {
    const qualityRunId = requireNonEmpty(input.qualityRunId, 'qualityRunId');
    const question = requireNonEmpty(input.question, 'question');
    const requestedScope = normalizeScope(
      await this.scopeStore.resolveValidScope(qualityRunId),
      qualityRunId,
    );

    const remoteCandidates = await this.remote.retrieveCandidates({
      question,
      datasetIds: [...requestedScope.datasetIds],
      documentIds: [...requestedScope.documentIds],
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    // 网络返回后必须重新解析当前短期 scope，不能复用请求前的 SQLite 快照。
    const currentScope = normalizeScope(
      await this.scopeStore.resolveValidScope(qualityRunId),
      qualityRunId,
    );
    const allowedDatasetIds = new Set(currentScope.datasetIds);
    const allowedDocumentIds = new Set(currentScope.documentIds);
    const outOfScopeDatasetIds = unique(
      remoteCandidates
        .filter((candidate) => !allowedDatasetIds.has(candidate.datasetId))
        .map((candidate) => candidate.datasetId),
    );
    const outOfScopeDocumentIds = unique(
      remoteCandidates
        .filter((candidate) => !allowedDocumentIds.has(candidate.documentId))
        .map((candidate) => candidate.documentId),
    );

    if (outOfScopeDatasetIds.length > 0 || outOfScopeDocumentIds.length > 0) {
      const returnedDocumentIds = unique(remoteCandidates.map((candidate) => candidate.documentId));
      const returnedDatasetIds = unique(remoteCandidates.map((candidate) => candidate.datasetId));
      await this.scopeStore.recordRemoteContractViolation({
        qualityRunId,
        returnedDocumentIds,
        allowedDocumentIds: [...currentScope.documentIds],
        audit: {
          returnedDatasetIds,
          allowedDatasetIds: [...currentScope.datasetIds],
          outOfScopeDocumentIds,
          outOfScopeDatasetIds,
        },
      });
      throw createRagflowContractError(
        'BINDING_DRIFT',
        'RAGFlow 返回了当前质量运行精确 pending scope 之外的候选，已记录合同异常并阻断。',
      );
    }

    if (!sameIdentity(requestedScope, currentScope)) {
      throw createRagflowContractError(
        'BINDING_DRIFT',
        '质量运行的精确 pending scope 在检索期间发生漂移，已拒绝使用本次候选。',
      );
    }

    return remoteCandidates.map((candidate) => ({
      chunkId: candidate.chunkId,
      content: candidate.content,
      datasetId: candidate.datasetId,
      documentId: candidate.documentId,
      ...(candidate.documentName === undefined ? {} : { documentName: candidate.documentName }),
      ...(candidate.similarity === undefined ? {} : { similarity: candidate.similarity }),
    }));
  }
}
