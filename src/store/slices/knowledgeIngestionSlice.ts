import {
  cancelKnowledgeIngestionProcessing,
  confirmKnowledgeIngestionMetadata,
  getKnowledgeIngestionRagflowConfigStatus,
  getKnowledgeIngestionStatus,
  listKnowledgeIngestionItems,
  retryKnowledgeIngestionPublication,
  retryKnowledgeIngestionProcessing,
  saveKnowledgeIngestionRagflowConfig,
  selectKnowledgeIngestionFile,
  selectKnowledgeIngestionNextVersionFile,
  startKnowledgeIngestionPublication,
  startKnowledgeIngestionQualityCheck,
  startKnowledgeIngestionRollback,
} from '@/services/KnowledgeIngestionService';
import type {
  KnowledgeIngestionConfirmMetadataInput,
  KnowledgeIngestionItem,
  KnowledgeIngestionItemActionInput,
  KnowledgeIngestionRagflowConfigStatus,
  KnowledgeIngestionRollbackInput,
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
  receiveKnowledgeIngestionNextVersion: (
    input: KnowledgeIngestionItemActionInput,
  ) => Promise<void>;
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
  startKnowledgeIngestionItemPublication: (
    input: KnowledgeIngestionItemActionInput,
  ) => Promise<void>;
  startKnowledgeIngestionItemRollback: (
    input: KnowledgeIngestionRollbackInput,
  ) => Promise<void>;
  retryKnowledgeIngestionItemPublication: (
    input: KnowledgeIngestionItemActionInput,
  ) => Promise<void>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '资料入库操作失败，请稍后重试。';
}

function upsertKnowledgeIngestionItem(
  items: readonly KnowledgeIngestionItem[],
  updated: KnowledgeIngestionItem,
): KnowledgeIngestionItem[] {
  return items.some((item) => item.itemId === updated.itemId)
    ? items.map((item) => (item.itemId === updated.itemId ? updated : item))
    : [updated, ...items];
}

async function listKnowledgeIngestionItemsBestEffort(): Promise<KnowledgeIngestionItem[] | null> {
  try {
    return await listKnowledgeIngestionItems();
  } catch {
    // Main 动作已经成功时，全量刷新仅用于补齐关联状态，不能反向误报动作失败。
    return null;
  }
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

  receiveKnowledgeIngestionNextVersion: async (input) => {
    set((state) => {
      state.knowledgeIngestionActionItemId = input.itemId;
      state.knowledgeIngestionError = null;
    });
    try {
      const result = await selectKnowledgeIngestionNextVersionFile(input);
      if (result.canceled || !result.item) {
        set((state) => {
          state.knowledgeIngestionActionItemId = null;
        });
        return;
      }
      const updated = result.item;
      set((state) => {
        const nextItems = upsertKnowledgeIngestionItem(state.knowledgeIngestionItems, updated);
        state.knowledgeIngestionItems = updated.isDuplicate
          ? nextItems
          : nextItems.map((item) =>
            item.itemId === input.itemId
              ? {
                ...item,
                publication: {
                  ...item.publication,
                  canReceiveNextVersion: false,
                },
              }
              : item,
          );
        state.selectedKnowledgeIngestionItemId = updated.itemId;
        state.knowledgeIngestionActionItemId = null;
      });
      const items = await listKnowledgeIngestionItemsBestEffort();
      if (items) {
        set((state) => {
          state.knowledgeIngestionItems = items;
          state.selectedKnowledgeIngestionItemId = updated.itemId;
        });
      }
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
        state.knowledgeIngestionActionItemId = null;
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

  startKnowledgeIngestionItemPublication: async (input) => {
    set((state) => {
      state.knowledgeIngestionActionItemId = input.itemId;
      state.knowledgeIngestionError = null;
    });
    try {
      const updated = await startKnowledgeIngestionPublication(input);
      set((state) => {
        state.knowledgeIngestionItems = upsertKnowledgeIngestionItem(
          state.knowledgeIngestionItems,
          updated,
        );
        state.selectedKnowledgeIngestionItemId = updated.itemId;
        state.knowledgeIngestionActionItemId = null;
      });
      const items = await listKnowledgeIngestionItemsBestEffort();
      if (items) {
        set((state) => {
          state.knowledgeIngestionItems = items;
          state.selectedKnowledgeIngestionItemId = updated.itemId;
        });
      }
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
        state.knowledgeIngestionActionItemId = null;
      });
    }
  },

  startKnowledgeIngestionItemRollback: async (input) => {
    set((state) => {
      state.knowledgeIngestionActionItemId = input.itemId;
      state.knowledgeIngestionError = null;
    });
    try {
      const updated = await startKnowledgeIngestionRollback(input);
      set((state) => {
        state.knowledgeIngestionItems = upsertKnowledgeIngestionItem(
          state.knowledgeIngestionItems,
          updated,
        );
        state.selectedKnowledgeIngestionItemId = updated.itemId;
        state.knowledgeIngestionActionItemId = null;
      });
      const items = await listKnowledgeIngestionItemsBestEffort();
      if (items) {
        set((state) => {
          state.knowledgeIngestionItems = items;
          state.selectedKnowledgeIngestionItemId = updated.itemId;
        });
      }
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
        state.knowledgeIngestionActionItemId = null;
      });
    }
  },

  retryKnowledgeIngestionItemPublication: async (input) => {
    set((state) => {
      state.knowledgeIngestionActionItemId = input.itemId;
      state.knowledgeIngestionError = null;
    });
    try {
      const updated = await retryKnowledgeIngestionPublication(input);
      set((state) => {
        state.knowledgeIngestionItems = upsertKnowledgeIngestionItem(
          state.knowledgeIngestionItems,
          updated,
        );
        state.selectedKnowledgeIngestionItemId = updated.itemId;
        state.knowledgeIngestionActionItemId = null;
      });
      const items = await listKnowledgeIngestionItemsBestEffort();
      if (items) {
        set((state) => {
          state.knowledgeIngestionItems = items;
          state.selectedKnowledgeIngestionItemId = updated.itemId;
        });
      }
    } catch (error) {
      set((state) => {
        state.knowledgeIngestionError = getErrorMessage(error);
        state.knowledgeIngestionActionItemId = null;
      });
    }
  },
});
