import type { RagflowDatasetSummary, RagflowConfig, OpenNotebookConfig } from '@/types/knowledge';
import { DEFAULT_OPEN_NOTEBOOK_CONFIG, DEFAULT_RAGFLOW_CONFIG } from '@/types/knowledge';

export interface KnowledgeBaseSlice {
  ragflowConfig: RagflowConfig;
  openNotebookConfig: OpenNotebookConfig;
  ragflowDatasets: RagflowDatasetSummary[];
  selectedRagflowDatasetIds: string[];
  useRagflowKnowledgeForGenerate: boolean;
  setRagflowConfigPatch: (patch: Partial<RagflowConfig>) => void;
  setOpenNotebookConfigPatch: (patch: Partial<OpenNotebookConfig>) => void;
  setRagflowDatasets: (datasets: RagflowDatasetSummary[]) => void;
  setSelectedRagflowDatasetIds: (datasetIds: string[]) => void;
  toggleSelectedRagflowDataset: (datasetId: string) => void;
  setUseRagflowKnowledgeForGenerate: (enabled: boolean) => void;
}

const RAGFLOW_CONFIG_KEY = 'layout3-ragflow-config-v1';
const OPEN_NOTEBOOK_CONFIG_KEY = 'layout3-open-notebook-config-v1';
const SELECTED_RAGFLOW_DATASET_IDS_KEY = 'layout3-ragflow-selected-datasets-v1';
const RAGFLOW_GENERATE_ENABLED_KEY = 'layout3-ragflow-generate-enabled-v1';

function normalizePositiveInteger(value: unknown, fallbackValue: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallbackValue;
  }

  return Math.max(1, Math.min(20, Math.round(value)));
}

function loadRagflowConfig(): RagflowConfig {
  try {
    const stored = localStorage.getItem(RAGFLOW_CONFIG_KEY);
    if (!stored) {
      return { ...DEFAULT_RAGFLOW_CONFIG };
    }

    const parsed = JSON.parse(stored) as Partial<RagflowConfig>;
    return {
      baseUrl:
        typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim()
          ? parsed.baseUrl
          : DEFAULT_RAGFLOW_CONFIG.baseUrl,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      topK: normalizePositiveInteger(parsed.topK, DEFAULT_RAGFLOW_CONFIG.topK),
    };
  } catch {
    return { ...DEFAULT_RAGFLOW_CONFIG };
  }
}

function loadOpenNotebookConfig(): OpenNotebookConfig {
  try {
    const stored = localStorage.getItem(OPEN_NOTEBOOK_CONFIG_KEY);
    if (!stored) {
      return { ...DEFAULT_OPEN_NOTEBOOK_CONFIG };
    }

    const parsed = JSON.parse(stored) as Partial<OpenNotebookConfig>;
    return {
      uiUrl:
        typeof parsed.uiUrl === 'string' && parsed.uiUrl.trim()
          ? parsed.uiUrl
          : DEFAULT_OPEN_NOTEBOOK_CONFIG.uiUrl,
      apiUrl:
        typeof parsed.apiUrl === 'string' && parsed.apiUrl.trim()
          ? parsed.apiUrl
          : DEFAULT_OPEN_NOTEBOOK_CONFIG.apiUrl,
    };
  } catch {
    return { ...DEFAULT_OPEN_NOTEBOOK_CONFIG };
  }
}

function loadSelectedRagflowDatasetIds(): string[] {
  try {
    const stored = localStorage.getItem(SELECTED_RAGFLOW_DATASET_IDS_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function loadUseRagflowKnowledgeForGenerate(): boolean {
  try {
    const stored = localStorage.getItem(RAGFLOW_GENERATE_ENABLED_KEY);
    return stored === 'true';
  } catch {
    return false;
  }
}

function saveRagflowConfig(config: RagflowConfig): void {
  try {
    localStorage.setItem(RAGFLOW_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // 忽略本机持久化异常，避免打断用户当前操作。
  }
}

function saveOpenNotebookConfig(config: OpenNotebookConfig): void {
  try {
    localStorage.setItem(OPEN_NOTEBOOK_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // 忽略本机持久化异常，避免打断用户当前操作。
  }
}

function saveSelectedRagflowDatasetIds(datasetIds: string[]): void {
  try {
    localStorage.setItem(SELECTED_RAGFLOW_DATASET_IDS_KEY, JSON.stringify(datasetIds));
  } catch {
    // 忽略本机持久化异常，避免打断用户当前操作。
  }
}

function saveUseRagflowKnowledgeForGenerate(enabled: boolean): void {
  try {
    localStorage.setItem(RAGFLOW_GENERATE_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // 忽略本机持久化异常，避免打断用户当前操作。
  }
}

export const createKnowledgeBaseSlice = (
  set: (partial: Partial<KnowledgeBaseSlice> | ((state: KnowledgeBaseSlice) => Partial<KnowledgeBaseSlice>)) => void,
): KnowledgeBaseSlice => ({
  ragflowConfig: loadRagflowConfig(),
  openNotebookConfig: loadOpenNotebookConfig(),
  ragflowDatasets: [],
  selectedRagflowDatasetIds: loadSelectedRagflowDatasetIds(),
  useRagflowKnowledgeForGenerate: loadUseRagflowKnowledgeForGenerate(),

  setRagflowConfigPatch: (patch) =>
    set((state) => {
      const nextConfig: RagflowConfig = {
        ...state.ragflowConfig,
        ...patch,
        topK: normalizePositiveInteger(patch.topK ?? state.ragflowConfig.topK, state.ragflowConfig.topK),
      };
      saveRagflowConfig(nextConfig);
      return { ragflowConfig: nextConfig };
    }),

  setOpenNotebookConfigPatch: (patch) =>
    set((state) => {
      const nextConfig: OpenNotebookConfig = {
        ...state.openNotebookConfig,
        ...patch,
      };
      saveOpenNotebookConfig(nextConfig);
      return { openNotebookConfig: nextConfig };
    }),

  setRagflowDatasets: (datasets) =>
    set((state) => {
      const allowedIds = new Set(datasets.map((dataset) => dataset.id));
      const nextSelectedIds = state.selectedRagflowDatasetIds.filter((datasetId) => allowedIds.has(datasetId));
      saveSelectedRagflowDatasetIds(nextSelectedIds);
      return {
        ragflowDatasets: datasets,
        selectedRagflowDatasetIds: nextSelectedIds,
      };
    }),

  setSelectedRagflowDatasetIds: (datasetIds) =>
    set(() => {
      const dedupedDatasetIds = Array.from(new Set(datasetIds.filter((datasetId) => datasetId.trim())));
      saveSelectedRagflowDatasetIds(dedupedDatasetIds);
      return { selectedRagflowDatasetIds: dedupedDatasetIds };
    }),

  toggleSelectedRagflowDataset: (datasetId) =>
    set((state) => {
      const exists = state.selectedRagflowDatasetIds.includes(datasetId);
      const nextSelectedIds = exists
        ? state.selectedRagflowDatasetIds.filter((item) => item !== datasetId)
        : [...state.selectedRagflowDatasetIds, datasetId];
      saveSelectedRagflowDatasetIds(nextSelectedIds);
      return { selectedRagflowDatasetIds: nextSelectedIds };
    }),

  setUseRagflowKnowledgeForGenerate: (enabled) =>
    set(() => {
      saveUseRagflowKnowledgeForGenerate(enabled);
      return { useRagflowKnowledgeForGenerate: enabled };
    }),
});
