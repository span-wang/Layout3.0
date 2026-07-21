import type {
  KnowledgeIngestionConfirmMetadataInput,
  KnowledgeIngestionItemActionInput,
  KnowledgeIngestionMetadata,
  KnowledgeIngestionRollbackInput,
  KnowledgeIngestionListRagflowDatasetsInput,
  KnowledgeIngestionSaveRagflowConfigInput,
  KnowledgeIngestionStartQualityCheckInput,
} from '../../../src/types/knowledgeIngestion';
import { RegistryError } from './types';

const metadataFields: Array<keyof KnowledgeIngestionMetadata> = [
  'stableTitle',
  'domain',
  'subject',
  'materialType',
  'language',
  'educationStage',
  'grade',
  'semester',
  'edition',
  'unit',
  'parserProfile',
];

function parseItemId(record: Record<string, unknown>): string {
  if (typeof record.itemId !== 'string' || !record.itemId.trim() || record.itemId.length > 120) {
    throw new RegistryError('INPUT_VALIDATION', '接收项编号不正确。');
  }
  return record.itemId.trim();
}

export function parseKnowledgeIngestionConfirmPayload(
  payload: unknown,
): KnowledgeIngestionConfirmMetadataInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RegistryError('INPUT_VALIDATION', '元数据请求格式不正确。');
  }
  const record = payload as Record<string, unknown>;
  const itemId = parseItemId(record);
  if (!record.metadata || typeof record.metadata !== 'object' || Array.isArray(record.metadata)) {
    throw new RegistryError('INPUT_VALIDATION', '元数据内容不正确。');
  }

  const source = record.metadata as Record<string, unknown>;
  const metadata = Object.fromEntries(metadataFields.map((field) => {
    const value = source[field];
    if (typeof value !== 'string' || value.length > 300) {
      throw new RegistryError('INPUT_VALIDATION', `元数据字段 ${field} 格式不正确。`);
    }
    return [field, value];
  })) as unknown as KnowledgeIngestionMetadata;
  return { itemId, metadata };
}

export function parseKnowledgeIngestionItemActionPayload(
  payload: unknown,
): KnowledgeIngestionItemActionInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RegistryError('INPUT_VALIDATION', '资料处理操作格式不正确。');
  }
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).some((field) => field !== 'itemId')) {
    throw new RegistryError('INPUT_VALIDATION', '资料处理操作只能提交接收项编号。');
  }
  return { itemId: parseItemId(record) };
}

export function parseKnowledgeIngestionRollbackPayload(
  payload: unknown,
): KnowledgeIngestionRollbackInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RegistryError('INPUT_VALIDATION', '资料回滚请求格式不正确。');
  }
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).some((field) => field !== 'itemId' && field !== 'reason')) {
    throw new RegistryError('INPUT_VALIDATION', '资料回滚只能提交接收项编号和回滚原因。');
  }
  if (typeof record.reason !== 'string') {
    throw new RegistryError('INPUT_VALIDATION', '回滚原因必须为 1～500 个字符。');
  }
  const reason = record.reason.trim();
  if (!reason || reason.length > 500) {
    throw new RegistryError('INPUT_VALIDATION', '回滚原因必须为 1～500 个字符。');
  }
  return { itemId: parseItemId(record), reason };
}

export function parseKnowledgeIngestionStartQualityPayload(
  payload: unknown,
): KnowledgeIngestionStartQualityCheckInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RegistryError('INPUT_VALIDATION', '质量检查请求格式不正确。');
  }
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).some((field) => field !== 'itemId')) {
    throw new RegistryError('INPUT_VALIDATION', '质量检查请求包含不允许的字段。');
  }
  return { itemId: parseItemId(record) };
}

export function parseKnowledgeIngestionRagflowConfigPayload(
  payload: unknown,
): KnowledgeIngestionSaveRagflowConfigInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RegistryError('INPUT_VALIDATION', 'RAGFlow 入库配置格式不正确。');
  }
  const record = payload as Record<string, unknown>;
  const allowedFields = new Set(['baseUrl', 'apiKey', 'stagingDatasetId', 'indexGeneration']);
  if (Object.keys(record).some((field) => !allowedFields.has(field))) {
    throw new RegistryError('INPUT_VALIDATION', 'RAGFlow 入库配置包含不允许的字段。');
  }
  const baseUrl = record.baseUrl;
  const stagingDatasetId = record.stagingDatasetId;
  const indexGeneration = record.indexGeneration;
  if (typeof baseUrl !== 'string' || baseUrl.length > 500) {
    throw new RegistryError('INPUT_VALIDATION', 'RAGFlow 入库配置字段 baseUrl 格式不正确。');
  }
  if (typeof stagingDatasetId !== 'string' || stagingDatasetId.length > 500) {
    throw new RegistryError('INPUT_VALIDATION', 'RAGFlow 入库配置字段 stagingDatasetId 格式不正确。');
  }
  if (typeof indexGeneration !== 'string' || indexGeneration.length > 500) {
    throw new RegistryError('INPUT_VALIDATION', 'RAGFlow 入库配置字段 indexGeneration 格式不正确。');
  }
  if (record.apiKey !== undefined && (typeof record.apiKey !== 'string' || record.apiKey.length > 8_000)) {
    throw new RegistryError('INPUT_VALIDATION', 'RAGFlow API Key 格式不正确。');
  }
  return {
    baseUrl: baseUrl.trim(),
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : undefined,
    stagingDatasetId: stagingDatasetId.trim(),
    indexGeneration: indexGeneration.trim(),
  };
}

export function parseKnowledgeIngestionListRagflowDatasetsPayload(
  payload: unknown,
): KnowledgeIngestionListRagflowDatasetsInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RegistryError('INPUT_VALIDATION', '数据集读取请求格式不正确。');
  }
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).some((field) => field !== 'baseUrl' && field !== 'apiKey')) {
    throw new RegistryError('INPUT_VALIDATION', '数据集读取请求包含不允许的字段。');
  }
  if (typeof record.baseUrl !== 'string' || record.baseUrl.length > 500) {
    throw new RegistryError('INPUT_VALIDATION', '数据集读取地址格式不正确。');
  }
  if (record.apiKey !== undefined && (typeof record.apiKey !== 'string' || record.apiKey.length > 8_000)) {
    throw new RegistryError('INPUT_VALIDATION', '数据集读取 API Key 格式不正确。');
  }
  return { baseUrl: record.baseUrl.trim(), apiKey: typeof record.apiKey === 'string' ? record.apiKey : undefined };
}
