import type {
  ImaConfig,
  ImaKnowledgeBaseSummary,
  KnowledgeGenerateSource,
  OpenNotebookConfig,
  RagflowConfig,
  RagflowDatasetSummary,
} from '@/types/knowledge';
import { DEFAULT_IMA_CONFIG, DEFAULT_OPEN_NOTEBOOK_CONFIG, DEFAULT_RAGFLOW_CONFIG } from '@/types/knowledge';

export interface KnowledgeBaseSlice {
  ragflowConfig: RagflowConfig;
  imaConfig: ImaConfig;
  openNotebookConfig: OpenNotebookConfig;
  ragflowDatasets: RagflowDatasetSummary[];
  imaKnowledgeBases: ImaKnowledgeBaseSummary[];
  selectedRagflowDatasetIds: string[];
  selectedImaKnowledgeBaseId: string | null;
  knowledgeSourceForGenerate: KnowledgeGenerateSource;
  setRagflowConfigPatch: (patch: Partial<RagflowConfig>) => void;
  setImaConfigPatch: (patch: Partial<ImaConfig>) => void;
  setOpenNotebookConfigPatch: (patch: Partial<OpenNotebookConfig>) => void;
  setRagflowDatasets: (datasets: RagflowDatasetSummary[]) => void;
  setImaKnowledgeBases: (knowledgeBases: ImaKnowledgeBaseSummary[]) => void;
  setSelectedRagflowDatasetIds: (datasetIds: string[]) => void;
  setSelectedImaKnowledgeBaseId: (knowledgeBaseId: string | null) => void;
  toggleSelectedRagflowDataset: (datasetId: string) => void;
  setKnowledgeSourceForGenerate: (source: KnowledgeGenerateSource) => void;
}

const RAGFLOW_CONFIG_KEY = 'layout3-ragflow-config-v1';
const IMA_CONFIG_KEY = 'layout3-ima-config-v1';
const OPEN_NOTEBOOK_CONFIG_KEY = 'layout3-open-notebook-config-v1';
const SELECTED_RAGFLOW_DATASET_IDS_KEY = 'layout3-ragflow-selected-datasets-v1';
const SELECTED_IMA_KNOWLEDGE_BASE_ID_KEY = 'layout3-ima-selected-knowledge-base-v1';
const RAGFLOW_GENERATE_ENABLED_KEY = 'layout3-ragflow-generate-enabled-v1';
const KNOWLEDGE_SOURCE_FOR_GENERATE_KEY = 'layout3-knowledge-source-for-generate-v1';

function normalizePositiveInteger(value: unknown, fallbackValue: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallbackValue;
  }

  return Math.max(1, Math.min(20, Math.round(value)));
}

function normalizePositiveIntegerWithMax(value: unknown, fallbackValue: number, maxValue: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallbackValue;
  }

  return Math.max(1, Math.min(maxValue, Math.round(value)));
}

function normalizeDecimalInRange(
  value: unknown,
  fallbackValue: number,
  minValue: number,
  maxValue: number,
): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallbackValue;
  }

  const clampedValue = Math.max(minValue, Math.min(maxValue, value));
  return Number(clampedValue.toFixed(2));
}

function normalizeBoolean(value: unknown, fallbackValue: boolean): boolean {
  return typeof value === 'boolean' ? value : fallbackValue;
}

function normalizeRagflowConfig(config: Partial<RagflowConfig> & { topK?: number }): RagflowConfig {
  // 兼容旧版本只保存 topK 的配置，并保证召回池不会小于最终返回片段数。
  const legacyResultLimit = normalizePositiveInteger(
    config.resultLimit ?? config.topK,
    DEFAULT_RAGFLOW_CONFIG.resultLimit,
  );
  const recallTopK = Math.max(
    legacyResultLimit,
    normalizePositiveIntegerWithMax(config.recallTopK, DEFAULT_RAGFLOW_CONFIG.recallTopK, 200),
  );

  return {
    baseUrl:
      typeof config.baseUrl === 'string' && config.baseUrl.trim()
        ? config.baseUrl
        : DEFAULT_RAGFLOW_CONFIG.baseUrl,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    resultLimit: legacyResultLimit,
    recallTopK,
    similarityThreshold: normalizeDecimalInRange(
      config.similarityThreshold,
      DEFAULT_RAGFLOW_CONFIG.similarityThreshold,
      0,
      1,
    ),
    vectorSimilarityWeight: normalizeDecimalInRange(
      config.vectorSimilarityWeight,
      DEFAULT_RAGFLOW_CONFIG.vectorSimilarityWeight,
      0,
      1,
    ),
    enableKeyword: normalizeBoolean(config.enableKeyword, DEFAULT_RAGFLOW_CONFIG.enableKeyword),
    enableHighlight: normalizeBoolean(config.enableHighlight, DEFAULT_RAGFLOW_CONFIG.enableHighlight),
  };
}

function loadRagflowConfig(): RagflowConfig {
  try {
    const stored = localStorage.getItem(RAGFLOW_CONFIG_KEY);
    if (!stored) {
      return { ...DEFAULT_RAGFLOW_CONFIG };
    }

    const parsed = JSON.parse(stored) as Partial<RagflowConfig> & { topK?: number };
    return normalizeRagflowConfig(parsed);
  } catch {
    return { ...DEFAULT_RAGFLOW_CONFIG };
  }
}

function loadImaConfig(): ImaConfig {
  try {
    const stored = localStorage.getItem(IMA_CONFIG_KEY);
    if (!stored) {
      return { ...DEFAULT_IMA_CONFIG };
    }

    const parsed = JSON.parse(stored) as Partial<ImaConfig>;
    return {
      baseUrl:
        typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim()
          ? parsed.baseUrl
          : DEFAULT_IMA_CONFIG.baseUrl,
      clientId: typeof parsed.clientId === 'string' ? parsed.clientId : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      topK: normalizePositiveInteger(parsed.topK, DEFAULT_IMA_CONFIG.topK),
    };
  } catch {
    return { ...DEFAULT_IMA_CONFIG };
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

function loadSelectedImaKnowledgeBaseId(): string | null {
  try {
    const stored = localStorage.getItem(SELECTED_IMA_KNOWLEDGE_BASE_ID_KEY);
    return typeof stored === 'string' && stored.trim() ? stored : null;
  } catch {
    return null;
  }
}

function loadKnowledgeSourceForGenerate(): KnowledgeGenerateSource {
  try {
    const stored = localStorage.getItem(KNOWLEDGE_SOURCE_FOR_GENERATE_KEY);
    if (stored === 'ragflow' || stored === 'ima' || stored === 'none') {
      return stored;
    }

    // 兼容旧版本的 RAGFlow 布尔开关，避免升级后用户配置失效。
    const legacyStored = localStorage.getItem(RAGFLOW_GENERATE_ENABLED_KEY);
    return legacyStored === 'true' ? 'ragflow' : 'none';
  } catch {
    return 'none';
  }
}

function saveRagflowConfig(config: RagflowConfig): void {
  try {
    localStorage.setItem(RAGFLOW_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // 忽略本机持久化异常，避免打断用户当前操作。
  }
}

function saveImaConfig(config: ImaConfig): void {
  try {
    localStorage.setItem(IMA_CONFIG_KEY, JSON.stringify(config));
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

function saveSelectedImaKnowledgeBaseId(knowledgeBaseId: string | null): void {
  try {
    if (knowledgeBaseId?.trim()) {
      localStorage.setItem(SELECTED_IMA_KNOWLEDGE_BASE_ID_KEY, knowledgeBaseId);
      return;
    }

    localStorage.removeItem(SELECTED_IMA_KNOWLEDGE_BASE_ID_KEY);
  } catch {
    // 忽略本机持久化异常，避免打断用户当前操作。
  }
}

function saveKnowledgeSourceForGenerate(source: KnowledgeGenerateSource): void {
  try {
    localStorage.setItem(KNOWLEDGE_SOURCE_FOR_GENERATE_KEY, source);
  } catch {
    // 忽略本机持久化异常，避免打断用户当前操作。
  }
}

export const createKnowledgeBaseSlice = (
  set: (partial: Partial<KnowledgeBaseSlice> | ((state: KnowledgeBaseSlice) => Partial<KnowledgeBaseSlice>)) => void,
): KnowledgeBaseSlice => ({
  ragflowConfig: loadRagflowConfig(),
  imaConfig: loadImaConfig(),
  openNotebookConfig: loadOpenNotebookConfig(),
  ragflowDatasets: [],
  imaKnowledgeBases: [],
  selectedRagflowDatasetIds: loadSelectedRagflowDatasetIds(),
  selectedImaKnowledgeBaseId: loadSelectedImaKnowledgeBaseId(),
  knowledgeSourceForGenerate: loadKnowledgeSourceForGenerate(),

  setRagflowConfigPatch: (patch) =>
    set((state) => {
      const nextConfig = normalizeRagflowConfig({
        ...state.ragflowConfig,
        ...patch,
      });
      saveRagflowConfig(nextConfig);
      return { ragflowConfig: nextConfig };
    }),

  setImaConfigPatch: (patch) =>
    set((state) => {
      const nextConfig: ImaConfig = {
        ...state.imaConfig,
        ...patch,
        topK: normalizePositiveInteger(patch.topK ?? state.imaConfig.topK, state.imaConfig.topK),
      };
      saveImaConfig(nextConfig);
      return { imaConfig: nextConfig };
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

  setImaKnowledgeBases: (knowledgeBases) =>
    set((state) => {
      const allowedIds = new Set(knowledgeBases.map((knowledgeBase) => knowledgeBase.id));
      const nextSelectedId =
        state.selectedImaKnowledgeBaseId && allowedIds.has(state.selectedImaKnowledgeBaseId)
          ? state.selectedImaKnowledgeBaseId
          : knowledgeBases[0]?.id ?? null;
      saveSelectedImaKnowledgeBaseId(nextSelectedId);
      return {
        imaKnowledgeBases: knowledgeBases,
        selectedImaKnowledgeBaseId: nextSelectedId,
      };
    }),

  setSelectedRagflowDatasetIds: (datasetIds) =>
    set(() => {
      const dedupedDatasetIds = Array.from(new Set(datasetIds.filter((datasetId) => datasetId.trim())));
      saveSelectedRagflowDatasetIds(dedupedDatasetIds);
      return { selectedRagflowDatasetIds: dedupedDatasetIds };
    }),

  setSelectedImaKnowledgeBaseId: (knowledgeBaseId) =>
    set(() => {
      const nextKnowledgeBaseId = knowledgeBaseId?.trim() ? knowledgeBaseId : null;
      saveSelectedImaKnowledgeBaseId(nextKnowledgeBaseId);
      return { selectedImaKnowledgeBaseId: nextKnowledgeBaseId };
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

  setKnowledgeSourceForGenerate: (source) =>
    set(() => {
      saveKnowledgeSourceForGenerate(source);
      return { knowledgeSourceForGenerate: source };
    }),
});
