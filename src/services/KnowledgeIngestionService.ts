import type {
  KnowledgeIngestionConfirmMetadataInput,
  KnowledgeIngestionItem,
  KnowledgeIngestionItemActionInput,
  KnowledgeIngestionListRagflowDatasetsInput,
  KnowledgeIngestionRagflowDatasetOption,
  KnowledgeIngestionRagflowConfigStatus,
  KnowledgeIngestionRuntimeStatus,
  KnowledgeIngestionSaveRagflowConfigInput,
  KnowledgeIngestionSelectResult,
  KnowledgeIngestionStartQualityCheckInput,
} from '@/types/knowledgeIngestion';

function normalizeIpcError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error('资料入库操作失败，请稍后重试。');
  }
  const match = error.message.match(/\[[A-Z_]+\]\s*(.+)$/);
  return new Error(match?.[1] ?? '资料入库操作失败，请稍后重试。');
}

async function invoke<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw normalizeIpcError(error);
  }
}

export function getKnowledgeIngestionStatus(): Promise<KnowledgeIngestionRuntimeStatus> {
  return invoke(() => window.layoutAPI.getKnowledgeIngestionStatus());
}

export function getKnowledgeIngestionRagflowConfigStatus(): Promise<KnowledgeIngestionRagflowConfigStatus> {
  return invoke(() => window.layoutAPI.getKnowledgeIngestionRagflowConfigStatus());
}

export function listKnowledgeIngestionRagflowDatasetOptions(
  input: KnowledgeIngestionListRagflowDatasetsInput,
): Promise<KnowledgeIngestionRagflowDatasetOption[]> {
  return invoke(() => window.layoutAPI.listKnowledgeIngestionRagflowDatasetOptions(input));
}

export function saveKnowledgeIngestionRagflowConfig(
  input: KnowledgeIngestionSaveRagflowConfigInput,
): Promise<KnowledgeIngestionRagflowConfigStatus> {
  return invoke(() => window.layoutAPI.saveKnowledgeIngestionRagflowConfig(input));
}

export function listKnowledgeIngestionItems(): Promise<KnowledgeIngestionItem[]> {
  return invoke(() => window.layoutAPI.listKnowledgeIngestionItems());
}

export function selectKnowledgeIngestionFile(): Promise<KnowledgeIngestionSelectResult> {
  return invoke(() => window.layoutAPI.selectKnowledgeIngestionFile());
}

export function confirmKnowledgeIngestionMetadata(
  input: KnowledgeIngestionConfirmMetadataInput,
): Promise<KnowledgeIngestionItem> {
  return invoke(() => window.layoutAPI.confirmKnowledgeIngestionMetadata(input));
}

export function cancelKnowledgeIngestionProcessing(
  input: KnowledgeIngestionItemActionInput,
): Promise<KnowledgeIngestionItem> {
  return invoke(() => window.layoutAPI.cancelKnowledgeIngestionProcessing(input));
}

export function retryKnowledgeIngestionProcessing(
  input: KnowledgeIngestionItemActionInput,
): Promise<KnowledgeIngestionItem> {
  return invoke(() => window.layoutAPI.retryKnowledgeIngestionProcessing(input));
}

export function startKnowledgeIngestionQualityCheck(
  input: KnowledgeIngestionStartQualityCheckInput,
): Promise<KnowledgeIngestionItem> {
  return invoke(() => window.layoutAPI.startKnowledgeIngestionQualityCheck(input));
}
