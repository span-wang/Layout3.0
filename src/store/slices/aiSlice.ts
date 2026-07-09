/**
 * AI Slice - 管理 AI 面板状态
 */

import type {
  AiConfig,
  AiConfigProfile,
  AiGenerateSemanticRoleId,
  AiPanelTab,
  AiCheckResult,
  AiGenerationRecord,
  PaginationBatchAnalysis,
  PaginationBatchDocumentEntry,
  PaginationBatchRootCauseStat,
  PaginationOptimizationSettings,
  PaginationProblemSeverity,
  PaginationProblemTag,
  PaginationRootCause,
  PaginationReviewItem,
  PaginationReviewVerdict,
  PaginationTrainingSample,
  AiTaskConfigAssignments,
  AiTaskType,
  AiProvider,
  AiStructureTemplate,
  AiStructureTemplateScope,
} from '@/types/ai';
import {
  DEFAULT_AI_GENERATE_SEMANTIC_ROLE_IDS,
  DEFAULT_AI_TASK_ASSIGNMENTS,
  PAGINATION_BATCH_READY_DOCUMENT_COUNT,
  normalizeAiGenerateSemanticRoleIds,
} from '@/types/ai';
import type { KnowledgeSourceReference } from '@/types/knowledge';

export interface AiSlice {
  // 兼容旧调用的当前配置状态，默认指向“内容生成”分配的配置
  aiConfig: AiConfig | null;
  isAiConfigured: boolean;
  aiConfigs: AiConfigProfile[];
  aiTaskAssignments: AiTaskConfigAssignments;

  // 面板状态
  isAiPanelOpen: boolean;
  activeAiTab: AiPanelTab;

  // 生成状态
  isGenerating: boolean;
  generatedContent: string;
  generatedKnowledgeSources: KnowledgeSourceReference[];
  generateSemanticRoleIds: AiGenerateSemanticRoleId[];
  generateError: string | null;
  aiGenerationRecords: AiGenerationRecord[];
  aiGenerationRecordDirectoryPath: string | null;
  aiGenerationRecordsError: string | null;
  aiStructureTemplates: AiStructureTemplate[];
  selectedAiStructureTemplateId: string | null;

  // 优化状态
  isOptimizing: boolean;
  optimizedContent: string;
  optimizeError: string | null;

  // 检查状态
  isChecking: boolean;
  checkResult: AiCheckResult | null;
  checkError: string | null;
  ignoredCheckItems: string[];

  // 分页审核状态
  paginationReviewItems: PaginationReviewItem[];
  paginationTrainingSamples: PaginationTrainingSample[];
  paginationBatchAnalysis: PaginationBatchAnalysis;
  paginationOptimizationSettings: PaginationOptimizationSettings | null;
  hasAppliedPaginationBatchOptimization: boolean;

  // 配置 actions
  setAiConfig: (config: AiConfig | null) => void;
  upsertAiConfigProfile: (config: AiConfigProfile) => void;
  deleteAiConfigProfile: (configId: string) => void;
  setAiTaskConfigAssignment: (taskType: AiTaskType, configId: string | null) => void;
  getAiConfigForTask: (taskType: AiTaskType) => AiConfigProfile | null;
  isAiTaskConfigured: (taskType: AiTaskType) => boolean;

  // 面板 actions
  openAiPanel: () => void;
  closeAiPanel: () => void;
  setActiveAiTab: (tab: AiPanelTab) => void;

  // 生成 actions
  startGenerating: () => void;
  updateGeneratedContent: (content: string) => void;
  setGeneratedKnowledgeSources: (sources: KnowledgeSourceReference[]) => void;
  setGenerateSemanticRoleIds: (roleIds: AiGenerateSemanticRoleId[]) => void;
  setGenerateError: (error: string | null) => void;
  finishGenerating: () => void;
  clearGeneratedContent: () => void;
  setAiGenerationRecordDirectory: (payload: {
    recordDirectoryPath: string;
    records: AiGenerationRecord[];
  }) => void;
  setAiGenerationRecordsError: (error: string | null) => void;
  upsertAiStructureTemplate: (template: AiStructureTemplate) => void;
  deleteAiStructureTemplate: (templateId: string) => void;
  setSelectedAiStructureTemplateId: (templateId: string | null) => void;

  // 优化 actions
  startOptimizing: () => void;
  updateOptimizedContent: (content: string) => void;
  setOptimizeError: (error: string | null) => void;
  finishOptimizing: () => void;
  clearOptimizedContent: () => void;

  // 检查 actions
  startChecking: () => void;
  setCheckResult: (result: AiCheckResult) => void;
  setCheckError: (error: string | null) => void;
  finishChecking: () => void;

  // 忽略检查项
  ignoreCheckItem: (itemId: string) => void;
  unignoreCheckItem: (itemId: string) => void;
  clearIgnoredCheckItems: () => void;
  clearCheckResult: () => void;

  // 分页审核 actions
  setPaginationReviewItems: (items: PaginationReviewItem[]) => void;
  setPaginationReviewVerdict: (breakId: string, verdict: PaginationReviewVerdict | null) => void;
  togglePaginationReviewProblemTag: (breakId: string, tag: PaginationProblemTag) => void;
  setPaginationReviewSeverity: (breakId: string, severity: PaginationProblemSeverity | null) => void;
  setPaginationTrainingSamples: (samples: PaginationTrainingSample[]) => void;
  addPaginationTrainingSamplesToBatch: (payload: {
    documentId: string;
    documentTitle: string;
    samples: PaginationTrainingSample[];
  }) => void;
  applyPaginationBatchOptimization: () => void;
  clearPaginationBatchOptimization: () => void;
  clearPaginationReviewItems: () => void;
}

// localStorage 键名
const LEGACY_AI_CONFIG_KEY = 'layout3-ai-config';
const AI_CONFIGS_KEY = 'layout3-ai-configs-v1';
const AI_TASK_ASSIGNMENTS_KEY = 'layout3-ai-task-assignments-v1';
const AI_STRUCTURE_TEMPLATES_KEY = 'layout3-ai-structure-templates-v1';
const AI_SELECTED_STRUCTURE_TEMPLATE_KEY = 'layout3-ai-selected-structure-template-id-v1';
const PAGINATION_BATCH_ANALYSIS_KEY = 'layout3-pagination-batch-analysis-v1';

const aiTaskTypes: AiTaskType[] = ['generate', 'optimize', 'check', 'regexRecognition'];
const aiStructureTemplateScopes: AiStructureTemplateScope[] = ['all', 'lecture', 'summary', 'exercise', 'exam'];

function isKnownProvider(value: unknown): value is AiProvider {
  return value === 'openai' || value === 'anthropic' || value === 'custom';
}

function createAiConfigId(): string {
  return `ai-config-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createAiStructureTemplateId(): string {
  return `ai-structure-template-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isUsableAiConfig(config: AiConfig | null | undefined): boolean {
  return !!config?.apiKey?.trim() && !!config?.model?.trim();
}

function normalizeAiConfigProfile(raw: unknown, index: number): AiConfigProfile | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<AiConfigProfile>;
  if (!isKnownProvider(value.provider)) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : createAiConfigId(),
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : `AI 配置 ${index + 1}`,
    provider: value.provider,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
    model: typeof value.model === 'string' ? value.model : '',
    temperature: typeof value.temperature === 'number' ? value.temperature : 0.7,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  };
}

function isAiStructureTemplateScope(value: unknown): value is AiStructureTemplateScope {
  return typeof value === 'string' && aiStructureTemplateScopes.includes(value as AiStructureTemplateScope);
}

function normalizeAiStructureTemplate(raw: unknown, index: number): AiStructureTemplate | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Partial<AiStructureTemplate>;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const structure = typeof value.structure === 'string' ? value.structure.trim() : '';
  if (!name || !structure) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: typeof value.id === 'string' && value.id.trim()
      ? value.id
      : `${createAiStructureTemplateId()}-${index}`,
    name,
    scope: isAiStructureTemplateScope(value.scope) ? value.scope : 'all',
    structure,
    outputRules: typeof value.outputRules === 'string' ? value.outputRules.trim() : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  };
}

function saveAiStructureTemplateSettings(templates: AiStructureTemplate[], selectedTemplateId: string | null): void {
  try {
    localStorage.setItem(AI_STRUCTURE_TEMPLATES_KEY, JSON.stringify(templates));
    if (selectedTemplateId) {
      localStorage.setItem(AI_SELECTED_STRUCTURE_TEMPLATE_KEY, selectedTemplateId);
    } else {
      localStorage.removeItem(AI_SELECTED_STRUCTURE_TEMPLATE_KEY);
    }
  } catch {
    // 忽略本机存储异常，避免影响当前 AI 生成流程。
  }
}

function loadAiStructureTemplateSettings(): Pick<AiSlice, 'aiStructureTemplates' | 'selectedAiStructureTemplateId'> {
  try {
    const storedTemplates = localStorage.getItem(AI_STRUCTURE_TEMPLATES_KEY);
    const parsedTemplates = storedTemplates ? (JSON.parse(storedTemplates) as unknown) : [];
    const templates = Array.isArray(parsedTemplates)
      ? parsedTemplates
          .map((template, index) => normalizeAiStructureTemplate(template, index))
          .filter((template): template is AiStructureTemplate => template !== null)
      : [];
    const storedSelectedId = localStorage.getItem(AI_SELECTED_STRUCTURE_TEMPLATE_KEY);
    const selectedAiStructureTemplateId =
      storedSelectedId && templates.some((template) => template.id === storedSelectedId)
        ? storedSelectedId
        : null;

    return {
      aiStructureTemplates: templates,
      selectedAiStructureTemplateId,
    };
  } catch {
    return {
      aiStructureTemplates: [],
      selectedAiStructureTemplateId: null,
    };
  }
}

function createProfileFromLegacyConfig(config: AiConfig): AiConfigProfile {
  const now = new Date().toISOString();
  return {
    id: 'ai-config-default',
    name: '默认配置',
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature ?? 0.7,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 标准化任务分配：缺失或指向已删除配置时，自动回落到第一条可用配置。
 */
function normalizeAssignments(
  configs: AiConfigProfile[],
  assignments?: Partial<AiTaskConfigAssignments> | null,
): AiTaskConfigAssignments {
  const existingIds = new Set(configs.map((config) => config.id));
  const fallbackConfigId = configs.find(isUsableAiConfig)?.id ?? configs[0]?.id ?? null;

  return aiTaskTypes.reduce<AiTaskConfigAssignments>((result, taskType) => {
    const assignedId = assignments?.[taskType] ?? null;
    result[taskType] = assignedId && existingIds.has(assignedId) ? assignedId : fallbackConfigId;
    return result;
  }, { ...DEFAULT_AI_TASK_ASSIGNMENTS });
}

function findConfigForTask(
  configs: AiConfigProfile[],
  assignments: AiTaskConfigAssignments,
  taskType: AiTaskType,
): AiConfigProfile | null {
  const config = configs.find((item) => item.id === assignments[taskType]) ?? null;
  return isUsableAiConfig(config) ? config : null;
}

function buildAiConfigState(
  configs: AiConfigProfile[],
  assignments: AiTaskConfigAssignments,
): Pick<AiSlice, 'aiConfig' | 'isAiConfigured' | 'aiConfigs' | 'aiTaskAssignments'> {
  const normalizedAssignments = normalizeAssignments(configs, assignments);
  return {
    aiConfig: findConfigForTask(configs, normalizedAssignments, 'generate'),
    isAiConfigured: configs.some(isUsableAiConfig),
    aiConfigs: configs,
    aiTaskAssignments: normalizedAssignments,
  };
}

function saveAiSettings(configs: AiConfigProfile[], assignments: AiTaskConfigAssignments): void {
  try {
    localStorage.setItem(AI_CONFIGS_KEY, JSON.stringify(configs));
    localStorage.setItem(AI_TASK_ASSIGNMENTS_KEY, JSON.stringify(assignments));
  } catch {
    // 忽略保存错误，避免本机存储异常打断用户当前操作。
  }
}

function createEmptyPaginationBatchAnalysis(): PaginationBatchAnalysis {
  return {
    batchId: 'pagination-batch-default',
    documentCount: 0,
    isReady: false,
    documents: [],
    rootCauseStats: [],
  };
}

function createDefaultPaginationOptimizationSettings(): PaginationOptimizationSettings {
  return {
    bottomSafeAreaPx: 0,
    heightReserveFactor: 1,
    measuredLineBreakPriorityBoost: 0,
    headingKeepWithNextBoost: 0,
    shortTailPenaltyBoost: 0,
    tableRowSplitPriorityBoost: 0,
    columnBalancePenaltyBoost: 0,
  };
}

function getSeverityScore(severity: PaginationProblemSeverity | null): number {
  switch (severity) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

function buildPaginationBatchRootCauseStats(
  documents: PaginationBatchDocumentEntry[],
): PaginationBatchRootCauseStat[] {
  const stats = new Map<PaginationRootCause, PaginationBatchRootCauseStat>();

  for (const document of documents) {
    for (const sample of document.samples) {
      for (const cause of sample.rootCauses) {
        const current = stats.get(cause) ?? {
          cause,
          sampleCount: 0,
          severityScore: 0,
          affectedBreakCount: 0,
        };
        current.sampleCount += 1;
        current.severityScore += getSeverityScore(sample.severity);
        current.affectedBreakCount += 1;
        stats.set(cause, current);
      }
    }
  }

  return Array.from(stats.values()).sort((left, right) => {
    if (right.severityScore !== left.severityScore) {
      return right.severityScore - left.severityScore;
    }
    return right.sampleCount - left.sampleCount;
  });
}

function buildOptimizationSettingsFromBatchAnalysis(
  analysis: PaginationBatchAnalysis,
): PaginationOptimizationSettings {
  const settings = createDefaultPaginationOptimizationSettings();

  for (const stat of analysis.rootCauseStats) {
    switch (stat.cause) {
      case 'bottomSafeAreaTooSmall':
        settings.bottomSafeAreaPx += Math.min(20, 4 + stat.severityScore);
        settings.heightReserveFactor += Math.min(0.12, stat.sampleCount * 0.01);
        break;
      case 'heightEstimationError':
        settings.heightReserveFactor += Math.min(0.2, stat.severityScore * 0.02);
        break;
      case 'lineBreakMismatch':
        settings.measuredLineBreakPriorityBoost += Math.min(1, stat.sampleCount * 0.15);
        break;
      case 'headingBindingTooWeak':
        settings.headingKeepWithNextBoost += Math.min(3, stat.severityScore * 0.3);
        break;
      case 'tailSplitPenaltyTooWeak':
        settings.shortTailPenaltyBoost += Math.min(3, stat.severityScore * 0.3);
        break;
      case 'tableSplitStrategyTooConservative':
        settings.tableRowSplitPriorityBoost += Math.min(3, stat.severityScore * 0.3);
        break;
      case 'columnBalanceStrategyWeak':
        settings.columnBalancePenaltyBoost += Math.min(3, stat.severityScore * 0.3);
        break;
      default:
        break;
    }
  }

  settings.heightReserveFactor = Number(settings.heightReserveFactor.toFixed(3));
  settings.measuredLineBreakPriorityBoost = Number(settings.measuredLineBreakPriorityBoost.toFixed(3));
  settings.headingKeepWithNextBoost = Number(settings.headingKeepWithNextBoost.toFixed(3));
  settings.shortTailPenaltyBoost = Number(settings.shortTailPenaltyBoost.toFixed(3));
  settings.tableRowSplitPriorityBoost = Number(settings.tableRowSplitPriorityBoost.toFixed(3));
  settings.columnBalancePenaltyBoost = Number(settings.columnBalancePenaltyBoost.toFixed(3));
  return settings;
}

function normalizePaginationBatchAnalysis(raw: unknown): PaginationBatchAnalysis {
  if (!raw || typeof raw !== 'object') {
    return createEmptyPaginationBatchAnalysis();
  }

  const value = raw as Partial<PaginationBatchAnalysis>;
  const documents = Array.isArray(value.documents)
    ? value.documents.filter((entry): entry is PaginationBatchDocumentEntry =>
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.documentId === 'string' &&
        typeof entry.documentTitle === 'string' &&
        typeof entry.addedAt === 'string' &&
        Array.isArray(entry.samples),
      )
    : [];
  const rootCauseStats = buildPaginationBatchRootCauseStats(documents);

  return {
    batchId: typeof value.batchId === 'string' && value.batchId.trim()
      ? value.batchId
      : 'pagination-batch-default',
    documentCount: documents.length,
    isReady: documents.length >= PAGINATION_BATCH_READY_DOCUMENT_COUNT,
    documents,
    rootCauseStats,
  };
}

function loadPaginationBatchAnalysis(): PaginationBatchAnalysis {
  try {
    const stored = localStorage.getItem(PAGINATION_BATCH_ANALYSIS_KEY);
    if (!stored) {
      return createEmptyPaginationBatchAnalysis();
    }
    return normalizePaginationBatchAnalysis(JSON.parse(stored) as unknown);
  } catch {
    return createEmptyPaginationBatchAnalysis();
  }
}

function savePaginationBatchAnalysis(analysis: PaginationBatchAnalysis): void {
  try {
    localStorage.setItem(PAGINATION_BATCH_ANALYSIS_KEY, JSON.stringify(analysis));
  } catch {
    // 忽略本机持久化错误，避免影响当前分页审核流程。
  }
}

/**
 * 从 localStorage 加载 AI 多配置；如果只存在旧单配置，则迁移为“默认配置”。
 */
function loadAiSettings(): Pick<AiSlice, 'aiConfig' | 'isAiConfigured' | 'aiConfigs' | 'aiTaskAssignments'> {
  try {
    const storedConfigs = localStorage.getItem(AI_CONFIGS_KEY);
    if (storedConfigs) {
      const parsedConfigs = JSON.parse(storedConfigs) as unknown;
      const configs = Array.isArray(parsedConfigs)
        ? parsedConfigs
            .map((config, index) => normalizeAiConfigProfile(config, index))
            .filter((config): config is AiConfigProfile => config !== null)
        : [];

      const storedAssignments = localStorage.getItem(AI_TASK_ASSIGNMENTS_KEY);
      const parsedAssignments = storedAssignments ? (JSON.parse(storedAssignments) as Partial<AiTaskConfigAssignments>) : null;
      const assignments = normalizeAssignments(configs, parsedAssignments);
      return buildAiConfigState(configs, assignments);
    }

    const legacyStored = localStorage.getItem(LEGACY_AI_CONFIG_KEY);
    if (legacyStored) {
      const legacyConfig = JSON.parse(legacyStored) as AiConfig;
      if (legacyConfig?.provider && legacyConfig?.apiKey && legacyConfig?.model) {
        const migratedConfig = createProfileFromLegacyConfig(legacyConfig);
        const assignments = normalizeAssignments([migratedConfig]);
        saveAiSettings([migratedConfig], assignments);
        return buildAiConfigState([migratedConfig], assignments);
      }
    }
  } catch {
    // 忽略解析错误，损坏的本地配置不应影响应用启动。
  }

  return buildAiConfigState([], { ...DEFAULT_AI_TASK_ASSIGNMENTS });
}

export const createAiSlice = (
  set: (partial: Partial<AiSlice> | ((state: AiSlice) => Partial<AiSlice>)) => void,
  get: () => AiSlice,
): AiSlice => {
  // 从 localStorage 恢复多配置；旧单配置会迁移为“默认配置”。
  const initialAiSettings = loadAiSettings();
  const initialAiStructureTemplateSettings = loadAiStructureTemplateSettings();
  const initialPaginationBatchAnalysis = loadPaginationBatchAnalysis();

  return {
    // 配置状态
    aiConfig: initialAiSettings.aiConfig,
    isAiConfigured: initialAiSettings.isAiConfigured,
    aiConfigs: initialAiSettings.aiConfigs,
    aiTaskAssignments: initialAiSettings.aiTaskAssignments,

    // 面板状态
    isAiPanelOpen: false,
    activeAiTab: 'generate',

    // 生成状态
    isGenerating: false,
    generatedContent: '',
    generatedKnowledgeSources: [],
    generateSemanticRoleIds: [...DEFAULT_AI_GENERATE_SEMANTIC_ROLE_IDS],
    generateError: null,
    aiGenerationRecords: [],
    aiGenerationRecordDirectoryPath: null,
    aiGenerationRecordsError: null,
    aiStructureTemplates: initialAiStructureTemplateSettings.aiStructureTemplates,
    selectedAiStructureTemplateId: initialAiStructureTemplateSettings.selectedAiStructureTemplateId,

    // 优化状态
    isOptimizing: false,
    optimizedContent: '',
    optimizeError: null,

    // 检查状态
    isChecking: false,
    checkResult: null,
    checkError: null,
    ignoredCheckItems: [],

    // 分页审核状态
    paginationReviewItems: [],
    paginationTrainingSamples: [],
    paginationBatchAnalysis: initialPaginationBatchAnalysis,
    paginationOptimizationSettings: null,
    hasAppliedPaginationBatchOptimization: false,

    // 配置 actions
    setAiConfig: (config: AiConfig | null) => {
      set((state) => {
        if (!config) {
          const emptyAssignments = normalizeAssignments([]);
          saveAiSettings([], emptyAssignments);
          return buildAiConfigState([], emptyAssignments);
        }

        const now = new Date().toISOString();
        const existingGenerateConfigId = state.aiTaskAssignments.generate ?? state.aiConfigs[0]?.id ?? 'ai-config-default';
        const existingConfig = state.aiConfigs.find((item) => item.id === existingGenerateConfigId);
        const nextConfig: AiConfigProfile = {
          ...config,
          id: existingGenerateConfigId,
          name: existingConfig?.name ?? '默认配置',
          createdAt: existingConfig?.createdAt ?? now,
          updatedAt: now,
        };
        const otherConfigs = state.aiConfigs.filter((item) => item.id !== existingGenerateConfigId);
        const nextConfigs = [nextConfig, ...otherConfigs];
        const nextAssignments = normalizeAssignments(nextConfigs, {
          ...state.aiTaskAssignments,
          generate: nextConfig.id,
        });
        saveAiSettings(nextConfigs, nextAssignments);
        return buildAiConfigState(nextConfigs, nextAssignments);
      });
    },

    upsertAiConfigProfile: (config: AiConfigProfile) =>
      set((state) => {
        const exists = state.aiConfigs.some((item) => item.id === config.id);
        const nextConfigs = exists
          ? state.aiConfigs.map((item) => (item.id === config.id ? config : item))
          : [...state.aiConfigs, config];
        const nextAssignments = normalizeAssignments(nextConfigs, state.aiTaskAssignments);
        saveAiSettings(nextConfigs, nextAssignments);
        return buildAiConfigState(nextConfigs, nextAssignments);
      }),

    deleteAiConfigProfile: (configId: string) =>
      set((state) => {
        const nextConfigs = state.aiConfigs.filter((config) => config.id !== configId);
        const nextAssignments = normalizeAssignments(nextConfigs, state.aiTaskAssignments);
        saveAiSettings(nextConfigs, nextAssignments);
        return buildAiConfigState(nextConfigs, nextAssignments);
      }),

    setAiTaskConfigAssignment: (taskType: AiTaskType, configId: string | null) =>
      set((state) => {
        const nextAssignments = normalizeAssignments(state.aiConfigs, {
          ...state.aiTaskAssignments,
          [taskType]: configId,
        });
        saveAiSettings(state.aiConfigs, nextAssignments);
        return buildAiConfigState(state.aiConfigs, nextAssignments);
      }),

    getAiConfigForTask: (taskType: AiTaskType) => {
      const state = get();
      return findConfigForTask(state.aiConfigs, state.aiTaskAssignments, taskType);
    },

    isAiTaskConfigured: (taskType: AiTaskType) => {
      const state = get();
      return findConfigForTask(state.aiConfigs, state.aiTaskAssignments, taskType) !== null;
    },

    // 面板 actions
    openAiPanel: () => set({ isAiPanelOpen: true }),

    closeAiPanel: () => set({ isAiPanelOpen: false }),

    setActiveAiTab: (tab: AiPanelTab) => set({ activeAiTab: tab }),

    // 生成 actions
    startGenerating: () =>
      set({
        isGenerating: true,
        generatedContent: '',
        generatedKnowledgeSources: [],
        generateError: null,
      }),

    updateGeneratedContent: (content: string) => set({ generatedContent: content }),

    setGeneratedKnowledgeSources: (sources: KnowledgeSourceReference[]) =>
      set({ generatedKnowledgeSources: sources }),

    setGenerateSemanticRoleIds: (roleIds: AiGenerateSemanticRoleId[]) =>
      set({
        generateSemanticRoleIds: normalizeAiGenerateSemanticRoleIds(roleIds),
      }),

    setGenerateError: (error: string | null) =>
      set({ generateError: error, isGenerating: false }),

    finishGenerating: () => set({ isGenerating: false }),

    clearGeneratedContent: () =>
      set({ generatedContent: '', generatedKnowledgeSources: [], generateError: null }),

    setAiGenerationRecordDirectory: (payload) =>
      set({
        aiGenerationRecordDirectoryPath: payload.recordDirectoryPath,
        aiGenerationRecords: payload.records,
        aiGenerationRecordsError: null,
      }),

    setAiGenerationRecordsError: (error: string | null) =>
      set({ aiGenerationRecordsError: error }),

    upsertAiStructureTemplate: (template: AiStructureTemplate) =>
      set((state) => {
        const exists = state.aiStructureTemplates.some((item) => item.id === template.id);
        const nextTemplates = exists
          ? state.aiStructureTemplates.map((item) => (item.id === template.id ? template : item))
          : [...state.aiStructureTemplates, template];
        const nextSelectedId = template.id;
        saveAiStructureTemplateSettings(nextTemplates, nextSelectedId);
        return {
          aiStructureTemplates: nextTemplates,
          selectedAiStructureTemplateId: nextSelectedId,
        };
      }),

    deleteAiStructureTemplate: (templateId: string) =>
      set((state) => {
        const nextTemplates = state.aiStructureTemplates.filter((template) => template.id !== templateId);
        const nextSelectedId =
          state.selectedAiStructureTemplateId === templateId
            ? null
            : state.selectedAiStructureTemplateId;
        saveAiStructureTemplateSettings(nextTemplates, nextSelectedId);
        return {
          aiStructureTemplates: nextTemplates,
          selectedAiStructureTemplateId: nextSelectedId,
        };
      }),

    setSelectedAiStructureTemplateId: (templateId: string | null) =>
      set((state) => {
        const nextSelectedId =
          templateId && state.aiStructureTemplates.some((template) => template.id === templateId)
            ? templateId
            : null;
        saveAiStructureTemplateSettings(state.aiStructureTemplates, nextSelectedId);
        return {
          selectedAiStructureTemplateId: nextSelectedId,
        };
      }),

    // 优化 actions
    startOptimizing: () =>
      set({
        isOptimizing: true,
        optimizedContent: '',
        optimizeError: null,
      }),

    updateOptimizedContent: (content: string) => set({ optimizedContent: content }),

    setOptimizeError: (error: string | null) =>
      set({ optimizeError: error, isOptimizing: false }),

    finishOptimizing: () => set({ isOptimizing: false }),

    clearOptimizedContent: () => set({ optimizedContent: '', optimizeError: null }),

    // 检查 actions
    startChecking: () =>
      set({
        isChecking: true,
        checkResult: null,
        checkError: null,
      }),

    setCheckResult: (result: AiCheckResult) => set({ checkResult: result, isChecking: false }),

    setCheckError: (error: string | null) => set({ checkError: error, isChecking: false }),

    finishChecking: () => set({ isChecking: false }),

    // 忽略检查项
    ignoreCheckItem: (itemId: string) =>
      set((state) => ({
        ignoredCheckItems: [...state.ignoredCheckItems, itemId],
      })),

    unignoreCheckItem: (itemId: string) =>
      set((state) => ({
        ignoredCheckItems: state.ignoredCheckItems.filter((id) => id !== itemId),
      })),

    clearIgnoredCheckItems: () => set({ ignoredCheckItems: [] }),

    clearCheckResult: () => set({ checkResult: null, checkError: null, ignoredCheckItems: [] }),

    setPaginationReviewItems: (items: PaginationReviewItem[]) =>
      set({
        paginationReviewItems: items,
      }),

    setPaginationReviewVerdict: (breakId: string, verdict: PaginationReviewVerdict | null) =>
      set((state) => ({
        paginationReviewItems: state.paginationReviewItems.map((item) =>
          item.breakId === breakId
            ? {
                ...item,
                verdict,
                problemTags: verdict === 'incorrect' ? item.problemTags : [],
                severity: verdict === 'incorrect' ? item.severity : null,
              }
            : item
        ),
      })),

    togglePaginationReviewProblemTag: (breakId: string, tag: PaginationProblemTag) =>
      set((state) => ({
        paginationReviewItems: state.paginationReviewItems.map((item) => {
          if (item.breakId !== breakId) {
            return item;
          }

          const hasTag = item.problemTags.includes(tag);
          return {
            ...item,
            problemTags: hasTag
              ? item.problemTags.filter((currentTag) => currentTag !== tag)
              : [...item.problemTags, tag],
          };
        }),
      })),

    setPaginationReviewSeverity: (breakId: string, severity: PaginationProblemSeverity | null) =>
      set((state) => ({
        paginationReviewItems: state.paginationReviewItems.map((item) =>
          item.breakId === breakId ? { ...item, severity } : item
        ),
      })),

    setPaginationTrainingSamples: (samples: PaginationTrainingSample[]) =>
      set({
        paginationTrainingSamples: samples,
      }),

    addPaginationTrainingSamplesToBatch: ({ documentId, documentTitle, samples }) =>
      set((state) => {
        const filteredSamples = samples.filter((sample) => sample.rootCauses.length > 0);
        if (filteredSamples.length === 0) {
          return {};
        }

        const nextDocuments = state.paginationBatchAnalysis.documents.filter(
          (entry) => entry.documentId !== documentId,
        );
        nextDocuments.push({
          documentId,
          documentTitle,
          addedAt: new Date().toISOString(),
          samples: filteredSamples,
        });

        const nextAnalysis: PaginationBatchAnalysis = {
          batchId: state.paginationBatchAnalysis.batchId,
          documentCount: nextDocuments.length,
          isReady: nextDocuments.length >= PAGINATION_BATCH_READY_DOCUMENT_COUNT,
          documents: nextDocuments,
          rootCauseStats: buildPaginationBatchRootCauseStats(nextDocuments),
        };

        savePaginationBatchAnalysis(nextAnalysis);
        return {
          paginationBatchAnalysis: nextAnalysis,
        };
      }),

    applyPaginationBatchOptimization: () =>
      set((state) => {
        if (!state.paginationBatchAnalysis.isReady) {
          return {};
        }

        return {
          paginationOptimizationSettings: buildOptimizationSettingsFromBatchAnalysis(
            state.paginationBatchAnalysis,
          ),
          hasAppliedPaginationBatchOptimization: true,
        };
      }),

    clearPaginationBatchOptimization: () =>
      set({
        paginationOptimizationSettings: null,
        hasAppliedPaginationBatchOptimization: false,
      }),

    clearPaginationReviewItems: () =>
      set({
        paginationReviewItems: [],
        paginationTrainingSamples: [],
      }),
  };
};
