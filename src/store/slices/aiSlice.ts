/**
 * AI Slice - 管理 AI 面板状态
 */

import type { AiConfig, AiPanelTab, AiCheckResult, AiGenerationRecord } from '@/types/ai';

export interface AiSlice {
  // 配置状态
  aiConfig: AiConfig | null;
  isAiConfigured: boolean;

  // 面板状态
  isAiPanelOpen: boolean;
  activeAiTab: AiPanelTab;

  // 生成状态
  isGenerating: boolean;
  generatedContent: string;
  generateError: string | null;
  aiGenerationRecords: AiGenerationRecord[];
  aiGenerationRecordFilePath: string | null;
  aiGenerationRecordsError: string | null;

  // 优化状态
  isOptimizing: boolean;
  optimizedContent: string;
  optimizeError: string | null;

  // 检查状态
  isChecking: boolean;
  checkResult: AiCheckResult | null;
  checkError: string | null;
  ignoredCheckItems: string[];

  // 配置 actions
  setAiConfig: (config: AiConfig | null) => void;

  // 面板 actions
  openAiPanel: () => void;
  closeAiPanel: () => void;
  setActiveAiTab: (tab: AiPanelTab) => void;

  // 生成 actions
  startGenerating: () => void;
  updateGeneratedContent: (content: string) => void;
  setGenerateError: (error: string | null) => void;
  finishGenerating: () => void;
  clearGeneratedContent: () => void;
  setAiGenerationRecordFile: (payload: {
    recordFilePath: string;
    records: AiGenerationRecord[];
  }) => void;
  setAiGenerationRecordsError: (error: string | null) => void;

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
}

// localStorage 键名
const AI_CONFIG_KEY = 'layout3-ai-config';

/**
 * 从 localStorage 加载 AI 配置
 */
function loadAiConfig(): AiConfig | null {
  try {
    const stored = localStorage.getItem(AI_CONFIG_KEY);
    if (stored) {
      return JSON.parse(stored) as AiConfig;
    }
  } catch {
    // 忽略解析错误
  }
  return null;
}

/**
 * 保存 AI 配置到 localStorage
 */
function saveAiConfig(config: AiConfig | null): void {
  try {
    if (config) {
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
    } else {
      localStorage.removeItem(AI_CONFIG_KEY);
    }
  } catch {
    // 忽略保存错误
  }
}

export const createAiSlice = (
  set: (partial: Partial<AiSlice> | ((state: AiSlice) => Partial<AiSlice>)) => void
): AiSlice => {
  // 从 localStorage 恢复配置
  const initialConfig = loadAiConfig();

  return {
    // 配置状态
    aiConfig: initialConfig,
    isAiConfigured: !!initialConfig?.apiKey && !!initialConfig?.model,

    // 面板状态
    isAiPanelOpen: false,
    activeAiTab: 'generate',

    // 生成状态
    isGenerating: false,
    generatedContent: '',
    generateError: null,
    aiGenerationRecords: [],
    aiGenerationRecordFilePath: null,
    aiGenerationRecordsError: null,

    // 优化状态
    isOptimizing: false,
    optimizedContent: '',
    optimizeError: null,

    // 检查状态
    isChecking: false,
    checkResult: null,
    checkError: null,
    ignoredCheckItems: [],

    // 配置 actions
    setAiConfig: (config: AiConfig | null) => {
      saveAiConfig(config);
      set({
        aiConfig: config,
        isAiConfigured: !!config?.apiKey && !!config?.model,
      });
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
        generateError: null,
      }),

    updateGeneratedContent: (content: string) => set({ generatedContent: content }),

    setGenerateError: (error: string | null) =>
      set({ generateError: error, isGenerating: false }),

    finishGenerating: () => set({ isGenerating: false }),

    clearGeneratedContent: () => set({ generatedContent: '', generateError: null }),

    setAiGenerationRecordFile: (payload) =>
      set({
        aiGenerationRecordFilePath: payload.recordFilePath,
        aiGenerationRecords: payload.records,
        aiGenerationRecordsError: null,
      }),

    setAiGenerationRecordsError: (error: string | null) =>
      set({ aiGenerationRecordsError: error }),

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
  };
};
