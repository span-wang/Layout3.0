import {
  cancelKnowledgeIngestionProcessing,
  confirmKnowledgeIngestionMetadata,
  getKnowledgeIngestionRagflowConfigStatus,
  getKnowledgeIngestionStatus,
  listKnowledgeIngestionItems,
  retryKnowledgeIngestionProcessing,
  saveKnowledgeIngestionRagflowConfig,
  selectKnowledgeIngestionFile,
  startKnowledgeIngestionQualityCheck,
} from '@/services/KnowledgeIngestionService';
import type {
  KnowledgeIngestionConfirmMetadataInput,
  KnowledgeIngestionItem,
  KnowledgeIngestionItemActionInput,
  KnowledgeIngestionRagflowConfigStatus,
  KnowledgeIngestionRuntimeStatus,
  KnowledgeIngestionSaveRagflowConfigInput,
  KnowledgeIngestionStartQualityCheckInput,
} from '@/types/knowledgeIngestion';
import type { StoreSlice } from '@/store/types';

export interface KnowledgeIngestionSlice {
  knowledgeIngestionRuntime: KnowledgeIngestionRuntimeStatus | null;
  knowledgeIngestionRagflowConfig: KnowledgeIngestionRagflowConfigStatus | null;
  knowledgeIngestionItems: KnowledgeIngestionItem[];
  selectedKnowledgeIngestionItemId: string | null;
  isKnowledgeIngestionLoading: boolean;
  knowledgeIngestionActionItemId: string | null;
  knowledgeIngestionError: string | null;
  loadKnowledgeIngestion: () => Promise<void>;
  refreshKnowledgeIngestionItems: () => Promise<void>;
  selectKnowledgeIngestionItem: (itemId: string | null) => void;
  receiveKnowledgeIngestionFile: () => Promise<void>;
  confirmKnowledgeIngestionItemMetadata: (
    input: KnowledgeIngestionConfirmMetadataInput,
  ) => Promise<void>;
  saveKnowledgeIngestionRagflowConfig: (
    input: KnowledgeIngestionSaveRagflowConfigInput,
  ) => Promise<void>;
  cancelKnowledgeIngestionItemProcessing: (
    input: KnowledgeIngestionItemActionInput,
  ) => Promise<void>;
  retryKnowledgeIngestionItemProcessing: (
    input: KnowledgeIngestionItemActionInput,
  ) => Promise<void>;
  startKnowledgeIngestionItemQualityCheck: (
    input: KnowledgeIngestionStartQualityCheckInput,
  ) => Promise<void>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '资料入库操作失败，请稍后重试。';
}

export const createKnowledgeIngestionSlice: StoreSlice<KnowledgeIngestionSlice> = (set) => ({
  knowledgeIngestionRuntime: null,
  knowledgeIngestionRagflowConfig: null,
  knowledgeIngestionItems: [],
  selectedKnowledgeIngestionItemId: null,
  isKnowledgeIngestionLoading: false,
  knowledgeIngestionActionItemId: null,
  knowledgeIngestionError: null,

  loadKnowledgeIngestion: async () => {
    set((state) => {
      state.isKnowledgeIngestionLoading = true;
      state.knowledgeIngestionError = null;
    });
    try {
      const [runtime, ragflowConfig] = await Promise.all([
        getKnowledgeIngestionStatus(),
        getKnowledgeIngestionRagflowConfigStatus(),
      ]);
      if (runtime.state === 'unavailable') {
        set((state) => {
          state.knowledgeIngestionRuntime = runtime;
          state.knowledgeIngestionRagflowConfig = ragflowConfig;
          state.knowledgeIngestionItems = [];
          state.selectedKnowledgeIngestionItemId = null;
          state.knowledgeIngestionError = runtime.message;
          state.isKnowledgeIngestionLoading = false;
        });
        return;
      }
      const items = await listKnowledgeIngestionItems();
      set((state) => {
        state.knowledgeIngestionRuntime = runtime;
        state.knowledgeIngestionRagflowConfig = ragflowConfig;
        state.knowledgeIngestionItems = items;
        state.selectedKnowledgeIngestionItemId =
          state.selectedKnowledgeIngestionItemId
          && items.some((item) => item.itemId === state.selectedKnowledgeIngestionItemId)
            ? state.selectedKnowledgeIngestionItemId
            : items[0]?.itemId ?? null;
        state.isKnowledgeIngestionLoading = false;
      });
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
        state.isKnowledgeIngestionLoading = false;
      });
    }
  },

  refreshKnowledgeIngestionItems: async () => {
    try {
      const items = await listKnowledgeIngestionItems();
      set((state) => {
        state.knowledgeIngestionItems = items;
        state.selectedKnowledgeIngestionItemId =
          state.selectedKnowledgeIngestionItemId
          && items.some((item) => item.itemId === state.selectedKnowledgeIngestionItemId)
            ? state.selectedKnowledgeIngestionItemId
            : items[0]?.itemId ?? null;
      });
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
      });
    }
  },

  selectKnowledgeIngestionItem: (itemId) => {
    set((state) => {
      state.selectedKnowledgeIngestionItemId = itemId;
    });
  },

  receiveKnowledgeIngestionFile: async () => {
    set((state) => {
      state.isKnowledgeIngestionLoading = true;
      state.knowledgeIngestionError = null;
    });
    try {
      const result = await selectKnowledgeIngestionFile();
      if (result.canceled || !result.item) {
        set((state) => {
          state.isKnowledgeIngestionLoading = false;
        });
        return;
      }
      const items = await listKnowledgeIngestionItems();
      set((state) => {
        state.knowledgeIngestionItems = items;
        state.selectedKnowledgeIngestionItemId = result.item?.itemId ?? null;
        state.isKnowledgeIngestionLoading = false;
      });
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
        state.isKnowledgeIngestionLoading = false;
      });
    }
  },

  confirmKnowledgeIngestionItemMetadata: async (input) => {
    set((state) => {
      state.isKnowledgeIngestionLoading = true;
      state.knowledgeIngestionError = null;
    });
    try {
      const updated = await confirmKnowledgeIngestionMetadata(input);
      set((state) => {
        state.knowledgeIngestionItems = state.knowledgeIngestionItems.map((item) =>
          item.itemId === updated.itemId ? updated : item,
        );
        state.selectedKnowledgeIngestionItemId = updated.itemId;
        state.isKnowledgeIngestionLoading = false;
      });
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
        state.isKnowledgeIngestionLoading = false;
      });
    }
  },

  saveKnowledgeIngestionRagflowConfig: async (input) => {
    set((state) => {
      state.isKnowledgeIngestionLoading = true;
      state.knowledgeIngestionError = null;
    });
    try {
      const config = await saveKnowledgeIngestionRagflowConfig(input);
      set((state) => {
        state.knowledgeIngestionRagflowConfig = config;
        state.isKnowledgeIngestionLoading = false;
      });
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
        state.isKnowledgeIngestionLoading = false;
      });
    }
  },

  cancelKnowledgeIngestionItemProcessing: async (input) => {
    set((state) => {
      state.knowledgeIngestionActionItemId = input.itemId;
      state.knowledgeIngestionError = null;
    });
    try {
      const updated = await cancelKnowledgeIngestionProcessing(input);
      set((state) => {
        state.knowledgeIngestionItems = state.knowledgeIngestionItems.map((item) =>
          item.itemId === updated.itemId ? updated : item,
        );
        state.selectedKnowledgeIngestionItemId = updated.itemId;
        state.knowledgeIngestionActionItemId = null;
      });
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
        state.knowledgeIngestionActionItemId = null;
      });
    }
  },

  retryKnowledgeIngestionItemProcessing: async (input) => {
    set((state) => {
      state.knowledgeIngestionActionItemId = input.itemId;
      state.knowledgeIngestionError = null;
    });
    try {
      const updated = await retryKnowledgeIngestionProcessing(input);
      set((state) => {
        state.knowledgeIngestionItems = state.knowledgeIngestionItems.map((item) =>
          item.itemId === updated.itemId ? updated : item,
        );
        state.selectedKnowledgeIngestionItemId = updated.itemId;
        state.knowledgeIngestionActionItemId = null;
      });
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
        state.knowledgeIngestionActionItemId = null;
      });
    }
  },

  startKnowledgeIngestionItemQualityCheck: async (input) => {
    set((state) => {
      state.knowledgeIngestionActionItemId = input.itemId;
      state.knowledgeIngestionError = null;
    });
    try {
      const updated = await startKnowledgeIngestionQualityCheck(input);
      set((state) => {
        state.knowledgeIngestionItems = state.knowledgeIngestionItems.map((item) =>
          item.itemId === updated.itemId ? updated : item,
        );
        state.selectedKnowledgeIngestionItemId = updated.itemId;
        state.knowledgeIngestionActionItemId = null;
      });
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
        state.knowledgeIngestionActionItemId = null;
      });
    }
  },
});
