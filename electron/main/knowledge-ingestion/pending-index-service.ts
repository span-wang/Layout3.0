import { createRagflowContractError } from './ragflow/errors';
import type {
  RagflowDocument,
  RagflowDocumentReconciliation,
  RagflowMetadata,
} from './ragflow/types';

type Awaitable<T> = T | Promise<T>;

export interface PendingIndexBinding {
  versionId: string;
  indexGeneration: string;
  datasetId: string;
  documentId: string;
  remoteStatus: 'pending';
  isHealthy: boolean;
}

export interface PendingIndexRepositoryCallbacks {
  findBinding(input: {
    versionId: string;
    indexGeneration: string;
  }): Awaitable<PendingIndexBinding | null>;
  ensureUnhealthyPendingBinding(input: {
    versionId: string;
    indexGeneration: string;
    datasetId: string;
    documentId: string;
  }): Awaitable<void>;
  markPendingBindingHealthy(input: {
    versionId: string;
    indexGeneration: string;
    datasetId: string;
    documentId: string;
    chunkCount: number;
    lastVerifiedAt: string;
  }): Awaitable<void>;
}

export interface PendingIndexRemote {
  reconcileDocumentByExactName(
    datasetId: string,
    remoteFileName: string,
    signal?: AbortSignal,
  ): Promise<RagflowDocumentReconciliation>;
  uploadDocument(input: {
    datasetId: string;
    filePath: string;
    remoteFileName: string;
    mediaType: string;
    signal?: AbortSignal;
  }): Promise<RagflowDocument>;
  patchDocumentMetadataAndVerify(input: {
    datasetId: string;
    documentId: string;
    metadata: RagflowMetadata;
    signal?: AbortSignal;
  }): Promise<RagflowDocument>;
  verifyDocumentMetadata(input: {
    datasetId: string;
    documentId: string;
    metadata: RagflowMetadata;
    signal?: AbortSignal;
  }): Promise<RagflowDocument>;
  triggerParse(datasetId: string, documentIds: string[], signal?: AbortSignal): Promise<void>;
  waitForDocumentReady(input: {
    datasetId: string;
    documentId: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
  }): Promise<RagflowDocument>;
}

export interface PendingIndexDatasetPolicy {
  assertStagingDataset(datasetId: string): Awaitable<void>;
}

export interface PendingIndexWaitRequest {
  versionId: string;
  sourceHash: string;
  indexGeneration: string;
  datasetId: string;
  artifactExtension?: string;
  metadata: RagflowMetadata;
  parseTimeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export interface PendingIndexRequest extends PendingIndexWaitRequest {
  artifactPath: string;
  artifactMediaType: string;
}

export interface PendingIndexPreparedResult {
  versionId: string;
  indexGeneration: string;
  datasetId: string;
  documentId: string;
  remoteFileName: string;
  reusedRemoteDocument: boolean;
  parseTriggered: boolean;
}

export interface PendingIndexHealthyResult {
  versionId: string;
  indexGeneration: string;
  datasetId: string;
  documentId: string;
  remoteFileName: string;
  chunkCount: number;
  lastVerifiedAt: string;
}

export interface PendingIndexResult extends PendingIndexHealthyResult {
  reusedRemoteDocument: boolean;
}

export interface PendingIndexServiceOptions {
  remote: PendingIndexRemote;
  repository: PendingIndexRepositoryCallbacks;
  datasetPolicy?: PendingIndexDatasetPolicy;
  now?: () => Date;
}

function normalizeSourceHash(sourceHash: string): string {
  const normalized = sourceHash.trim().toLowerCase().replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw createRagflowContractError('INVALID_RESPONSE', 'sourceHash 必须是 64 位 SHA-256 十六进制值。');
  }
  return normalized;
}

export function buildPendingRemoteFileName(input: {
  versionId: string;
  sourceHash: string;
  extension?: string;
}): string {
  const versionId = input.versionId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(versionId)) {
    throw createRagflowContractError(
      'INVALID_RESPONSE',
      'versionId 必须使用 1 至 128 位 ASCII 字母、数字、点、下划线或连字符。',
    );
  }
  const sourceHash = normalizeSourceHash(input.sourceHash);
  const extension = (input.extension ?? 'md').trim().replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(extension)) {
    throw createRagflowContractError('INVALID_RESPONSE', '远端工件扩展名必须是 1 至 10 位小写字母或数字。');
  }
  return `layout3_${versionId}_${sourceHash}.${extension}`;
}

function assertMetadataIdentity(input: PendingIndexWaitRequest): void {
  const normalizedSourceHash = normalizeSourceHash(input.sourceHash);
  const expectedFields: Record<string, string> = {
    metadata_schema: 'layout3_ingestion_v1',
    status: 'pending',
    version_id: input.versionId,
    source_hash: normalizedSourceHash,
  };
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (input.metadata[field] !== expected) {
      throw createRagflowContractError(
        'METADATA_MISMATCH',
        `待写入 RAGFlow 的 metadata 字段 ${field} 必须精确等于“${expected}”。`,
      );
    }
  }
}

function assertBindingScope(
  binding: PendingIndexBinding,
  input: PendingIndexWaitRequest,
): void {
  if (
    binding.versionId !== input.versionId
    || binding.indexGeneration !== input.indexGeneration
    || binding.datasetId !== input.datasetId
    || binding.remoteStatus !== 'pending'
  ) {
    throw createRagflowContractError(
      'BINDING_DRIFT',
      `版本 ${input.versionId} 的本地 pending 绑定不属于当前数据集或索引代次。`,
    );
  }
}

function assertBindingMatches(
  binding: PendingIndexBinding,
  input: PendingIndexWaitRequest,
  document: RagflowDocument,
): void {
  assertBindingScope(binding, input);
  if (binding.documentId !== document.id) {
    throw createRagflowContractError(
      'BINDING_DRIFT',
      `版本 ${input.versionId} 的本地 pending document ID 与远端精确对账结果不一致。`,
    );
  }
}

export class PendingIndexService {
  private readonly remote: PendingIndexRemote;
  private readonly repository: PendingIndexRepositoryCallbacks;
  private readonly datasetPolicy?: PendingIndexDatasetPolicy;
  private readonly now: () => Date;

  constructor(options: PendingIndexServiceOptions) {
    this.remote = options.remote;
    this.repository = options.repository;
    this.datasetPolicy = options.datasetPolicy;
    this.now = options.now ?? (() => new Date());
  }

  async index(input: PendingIndexRequest): Promise<PendingIndexResult> {
    const prepared = await this.prepareUpload(input);
    const healthy = await this.waitUntilHealthy(input);
    return { ...healthy, reusedRemoteDocument: prepared.reusedRemoteDocument };
  }

  async prepareUpload(input: PendingIndexRequest): Promise<PendingIndexPreparedResult> {
    assertMetadataIdentity(input);
    // 配置层可注入专用暂存数据集门禁，避免编排调用方传入任意远端 ID。
    await this.datasetPolicy?.assertStagingDataset(input.datasetId);
    const remoteFileName = buildPendingRemoteFileName({
      versionId: input.versionId,
      sourceHash: input.sourceHash,
      extension: input.artifactExtension,
    });
    const existingBinding = await this.repository.findBinding({
      versionId: input.versionId,
      indexGeneration: input.indexGeneration,
    });
    const reconciliation = await this.remote.reconcileDocumentByExactName(
      input.datasetId,
      remoteFileName,
      input.signal,
    );

    let document: RagflowDocument;
    let reusedRemoteDocument: boolean;
    if (reconciliation.kind === 'existing') {
      document = reconciliation.document;
      reusedRemoteDocument = true;
    } else {
      if (existingBinding) {
        throw createRagflowContractError(
          'BINDING_DRIFT',
          `版本 ${input.versionId} 已有本地绑定，但远端确定性同名文档不存在。`,
        );
      }
      await this.remote.uploadDocument({
        datasetId: input.datasetId,
        filePath: input.artifactPath,
        remoteFileName,
        mediaType: input.artifactMediaType,
        signal: input.signal,
      });
      // 上传回执之后再次全分页对账，避免只信任一次网络响应或接管到错误 ID。
      const uploadedReconciliation = await this.remote.reconcileDocumentByExactName(
        input.datasetId,
        remoteFileName,
        input.signal,
      );
      if (uploadedReconciliation.kind !== 'existing') {
        throw createRagflowContractError(
          'DOCUMENT_NOT_FOUND',
          `上传后无法按确定性文件名“${remoteFileName}”回读 RAGFlow 文档。`,
        );
      }
      document = uploadedReconciliation.document;
      reusedRemoteDocument = false;
    }

    if (existingBinding) assertBindingMatches(existingBinding, input, document);

    // 先保存不健康 pending 绑定。后续任一步失败都不能留下看似可用的远端映射。
    await this.repository.ensureUnhealthyPendingBinding({
      versionId: input.versionId,
      indexGeneration: input.indexGeneration,
      datasetId: input.datasetId,
      documentId: document.id,
    });
    const metadataDocument = await this.remote.patchDocumentMetadataAndVerify({
      datasetId: input.datasetId,
      documentId: document.id,
      metadata: input.metadata,
      signal: input.signal,
    });

    if (metadataDocument.id !== document.id) {
      throw createRagflowContractError(
        'BINDING_DRIFT',
        `PATCH metadata 回读的 document ID 与不健康 pending 绑定不一致。`,
      );
    }
    const parseState = String(metadataDocument.run ?? '').trim().toUpperCase();
    const shouldTriggerParse = parseState === 'UNSTART'
      || parseState === 'FAIL'
      || parseState === 'FAILED'
      || parseState === 'CANCEL'
      || parseState === 'CANCELLED'
      || (parseState === 'DONE' && metadataDocument.chunk_count === 0);
    if (
      !shouldTriggerParse
      && parseState !== 'RUNNING'
      && parseState !== 'DONE'
    ) {
      throw createRagflowContractError(
        'UNKNOWN_PARSE_STATE',
        `RAGFlow 文档 ${document.id} 返回未知解析状态“${parseState || '空'}”。`,
      );
    }
    if (parseState === 'DONE' && metadataDocument.chunk_count === undefined) {
      throw createRagflowContractError(
        'INVALID_RESPONSE',
        `RAGFlow 文档 ${document.id} 已完成解析但缺少 chunk_count。`,
      );
    }
    if (shouldTriggerParse) {
      await this.remote.triggerParse(input.datasetId, [document.id], input.signal);
    }

    return {
      versionId: input.versionId,
      indexGeneration: input.indexGeneration,
      datasetId: input.datasetId,
      documentId: document.id,
      remoteFileName,
      reusedRemoteDocument,
      parseTriggered: shouldTriggerParse,
    };
  }

  async waitUntilHealthy(input: PendingIndexWaitRequest): Promise<PendingIndexHealthyResult> {
    assertMetadataIdentity(input);
    await this.datasetPolicy?.assertStagingDataset(input.datasetId);
    const remoteFileName = buildPendingRemoteFileName({
      versionId: input.versionId,
      sourceHash: input.sourceHash,
      extension: input.artifactExtension,
    });
    // parse_wait 只从持久绑定恢复精确 document ID，不再按文件名接管或重新上传。
    const binding = await this.repository.findBinding({
      versionId: input.versionId,
      indexGeneration: input.indexGeneration,
    });
    if (!binding) {
      throw createRagflowContractError(
        'BINDING_DRIFT',
        `版本 ${input.versionId} 尚无不健康 pending 绑定，不能进入 parse_wait。`,
      );
    }
    assertBindingScope(binding, input);
    const readyDocument = await this.remote.waitForDocumentReady({
      datasetId: input.datasetId,
      documentId: binding.documentId,
      timeoutMs: input.parseTimeoutMs,
      pollIntervalMs: input.pollIntervalMs,
      signal: input.signal,
    });
    if (
      readyDocument.id !== binding.documentId
      || readyDocument.chunk_count === undefined
      || readyDocument.chunk_count <= 0
    ) {
      throw createRagflowContractError(
        'INVALID_RESPONSE',
        `RAGFlow 文档 ${binding.documentId} 的健康解析结果缺少精确 ID 或非零切片数。`,
      );
    }

    // 解析完成后再次逐字段回读，最终健康标记不依赖解析前的旧快照。
    await this.remote.verifyDocumentMetadata({
      datasetId: input.datasetId,
      documentId: binding.documentId,
      metadata: input.metadata,
      signal: input.signal,
    });
    const lastVerifiedAt = this.now().toISOString();
    await this.repository.markPendingBindingHealthy({
      versionId: input.versionId,
      indexGeneration: input.indexGeneration,
      datasetId: input.datasetId,
      documentId: binding.documentId,
      chunkCount: readyDocument.chunk_count,
      lastVerifiedAt,
    });

    return {
      versionId: input.versionId,
      indexGeneration: input.indexGeneration,
      datasetId: input.datasetId,
      documentId: binding.documentId,
      remoteFileName,
      chunkCount: readyDocument.chunk_count,
      lastVerifiedAt,
    };
  }
}
