import { blockSpacingPresetDefinitions, defaultStyleSettings } from '@/engine/style/presets';
import {
  cloneBlockSpacingParameters,
  clonePdfWatermarkSettings,
  cloneStyleSettings,
  normalizeBlockSpacingParameters,
  normalizeStyleSettings,
} from '@/engine/style/styleSettings';
import {
  DOM_MEASURE_PAGINATION_ALGORITHM_ID,
  MAX_FILL_PAGINATION_ALGORITHM_ID,
  OFFSCREEN_MEASURE_PAGINATION_ALGORITHM_ID,
} from '@/engine/typesetting/algorithmIds';
import {
  mergeBlockSpacingPresetLibraryIntoStyleSettings,
  saveBlockSpacingPresetLibrary,
} from '@/services/BlockSpacingPresetLibraryService';
import { createDocumentHistorySnapshot, pushDocumentHistoryEntry } from '@/store/documentHistory';
import type {
  BlockSpacingParameters,
  BlockSpacingParameterKey,
  BoxInsets,
  MarginSide,
} from '@/engine/style/types';
import type { AppStore, StoreSlice, StyleSlice } from '@/store/types';

const MIN_MARGIN_MM = 5;
const MAX_MARGIN_MM = 80;
const MIN_BLOCK_SPACING_PX = 0;
const MAX_BLOCK_SPACING_PX = 240;
const MIN_COLUMN_GAP_MM = 4;
const MAX_COLUMN_GAP_MM = 30;

function clampMarginValue(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_MARGIN_MM;
  }

  return Math.min(MAX_MARGIN_MM, Math.max(MIN_MARGIN_MM, Math.round(value)));
}

function clampColumnGapMm(value: number): number {
  if (!Number.isFinite(value)) {
    return defaultStyleSettings.columns.gapMm;
  }

  return Math.min(MAX_COLUMN_GAP_MM, Math.max(MIN_COLUMN_GAP_MM, Math.round(value)));
}

function cloneInsets(insets: BoxInsets): BoxInsets {
  return {
    top: insets.top,
    right: insets.right,
    bottom: insets.bottom,
    left: insets.left,
  };
}

function setAllMargins(target: BoxInsets, value: number): void {
  target.top = value;
  target.right = value;
  target.bottom = value;
  target.left = value;
}

function clampBlockSpacingValue(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_BLOCK_SPACING_PX;
  }

  return Math.min(MAX_BLOCK_SPACING_PX, Math.max(MIN_BLOCK_SPACING_PX, Math.round(value)));
}

function normalizePresetText(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function createCustomBlockSpacingPresetId(): string {
  return `block-spacing-${Date.now().toString(36)}`;
}

function findBlockSpacingPreset(
  styleSettings: { customBlockSpacingPresets: StyleSlice['styleSettings']['customBlockSpacingPresets'] },
  presetId: string,
) {
  return [...blockSpacingPresetDefinitions, ...styleSettings.customBlockSpacingPresets].find(
    (preset) => preset.id === presetId,
  );
}

function clampBlockSpacingParameters(parameters: BlockSpacingParameters): BlockSpacingParameters {
  return Object.entries(parameters).reduce((nextParameters, [key, value]) => {
    nextParameters[key as BlockSpacingParameterKey] = clampBlockSpacingValue(value);
    return nextParameters;
  }, {} as BlockSpacingParameters);
}

function applyStyleSettingsMutation(state: AppStore, mutate: () => void): void {
  const previousStyleSettings = cloneStyleSettings(state.styleSettings);
  const previousSnapshot = state.layoutDocument
    ? createDocumentHistorySnapshot(state.layoutDocument, previousStyleSettings)
    : null;

  mutate();

  const didUpdate = JSON.stringify(previousStyleSettings) !== JSON.stringify(state.styleSettings);
  if (!didUpdate) {
    return;
  }

  if (previousSnapshot) {
    pushDocumentHistoryEntry(state, previousSnapshot);
  }
  state.isDirty = true;
}

export const createStyleSlice: StoreSlice<StyleSlice> = (set) => ({
  styleSettings: mergeBlockSpacingPresetLibraryIntoStyleSettings(cloneStyleSettings(defaultStyleSettings)),
  resetStyleSettings: () =>
    set((state) => {
      state.styleSettings = mergeBlockSpacingPresetLibraryIntoStyleSettings(cloneStyleSettings(defaultStyleSettings));
    }),
  replaceStyleSettings: (styleSettings) =>
    set((state) => {
      // 读取旧草稿或旧 .layout 数据时也统一走归一化，避免新字段缺失把状态带坏。
      state.styleSettings = mergeBlockSpacingPresetLibraryIntoStyleSettings(normalizeStyleSettings(styleSettings));
    }),
  setPageSize: (pageSize) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.pageSize = pageSize;
      });
    }),
  setOrientation: (orientation) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.orientation = orientation;
      });
    }),
  setMarginMode: (marginMode) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.marginMode = marginMode;
      });
    }),
  setMarginPreset: (marginPreset) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.marginPreset = marginPreset;
      });
    }),
  setCustomMargin: (side: MarginSide, value: number) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        const nextValue = clampMarginValue(value);
        if (state.styleSettings.isMarginLinked) {
          setAllMargins(state.styleSettings.customMarginsMm, nextValue);
          return;
        }

        state.styleSettings.customMarginsMm[side] = nextValue;
      });
    }),
  setMarginLinked: (linked) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.isMarginLinked = linked;
        if (!linked) {
          return;
        }

        setAllMargins(state.styleSettings.customMarginsMm, state.styleSettings.customMarginsMm.top);
      });
    }),
  setHeaderFooterMode: (mode) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.headerFooterMode = mode;
      });
    }),
  setTemplateId: (templateId) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.templateId = templateId;
      });
    }),
  setThemeId: (themeId) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.themeId = themeId;
      });
    }),
  setPageBackground: (background) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.pageBackground = {
          mode: background.mode,
          color: background.color,
          imageSrc: background.imageSrc,
          imageFit: background.imageFit,
        };
      });
    }),
  setPdfWatermark: (watermark) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.pdfWatermark = clonePdfWatermarkSettings(watermark);
      });
    }),
  setHeaderPreset: (headerPreset) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.headerPreset = headerPreset;
      });
    }),
  setFooterPreset: (footerPreset) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.footerPreset = footerPreset;
      });
    }),
  setCustomHeaderReservedMm: (value) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        const nextValue = clampMarginValue(value);
        state.styleSettings.customHeaderReservedMm = nextValue;
        if (state.styleSettings.isHeaderFooterLinked) {
          state.styleSettings.customFooterReservedMm = nextValue;
        }
      });
    }),
  setCustomFooterReservedMm: (value) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        const nextValue = clampMarginValue(value);
        state.styleSettings.customFooterReservedMm = nextValue;
        if (state.styleSettings.isHeaderFooterLinked) {
          state.styleSettings.customHeaderReservedMm = nextValue;
        }
      });
    }),
  setHeaderFooterContentSlot: ({ area, slot, value }) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.headerFooterContent[area][slot] = value;
      });
    }),
  setHeaderFooterLinked: (linked) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.isHeaderFooterLinked = linked;
        if (!linked) {
          return;
        }

        state.styleSettings.customFooterReservedMm = state.styleSettings.customHeaderReservedMm;
      });
    }),
  setPageColumnCount: (count) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.columns.count = count;
        if (count === 1) {
          state.styleSettings.columns.divider = false;
          state.styleSettings.columns.headingsSpanAll = false;
        }
      });
    }),
  setPageColumnGapMm: (value) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.columns.gapMm = clampColumnGapMm(value);
      });
    }),
  setPageColumnDivider: (value) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.columns.divider = state.styleSettings.columns.count > 1 ? value : false;
      });
    }),
  setPageColumnHeadingsSpanAll: (value) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.columns.headingsSpanAll = state.styleSettings.columns.count > 1 ? value : false;
      });
    }),
  setPaginationAlgorithmId: (algorithmId) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        // 只允许写入当前已注册的三套分页引擎；更早的实验算法 ID 统一回退到默认算法。
        state.styleSettings.paginationAlgorithmId =
          algorithmId === MAX_FILL_PAGINATION_ALGORITHM_ID ||
          algorithmId === DOM_MEASURE_PAGINATION_ALGORITHM_ID ||
          algorithmId === OFFSCREEN_MEASURE_PAGINATION_ALGORITHM_ID
            ? algorithmId
            : defaultStyleSettings.paginationAlgorithmId;
      });
    }),
  setPaginationBehaviorOption: (option, value) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.paginationBehavior[option] = value;
      });
    }),
  setBlockSpacingParameter: (parameter, value) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        state.styleSettings.blockSpacing[parameter] = clampBlockSpacingValue(value);
        state.styleSettings.blockSpacingPresetId = 'custom';
      });
    }),
  applyBlockSpacingPreset: (presetId) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        const preset = findBlockSpacingPreset(state.styleSettings, presetId);
        if (!preset) {
          return;
        }

        state.styleSettings.blockSpacing = cloneBlockSpacingParameters(preset.parameters);
        state.styleSettings.blockSpacingPresetId = preset.id;
      });
    }),
  addBlockSpacingPreset: ({ name, description }) => {
    const presetId = createCustomBlockSpacingPresetId();

    set((state) => {
      applyStyleSettingsMutation(state, () => {
        const presetName = normalizePresetText(
          name,
          `自定义预设 ${state.styleSettings.customBlockSpacingPresets.length + 1}`,
        );
        state.styleSettings.customBlockSpacingPresets.push({
          id: presetId,
          name: presetName,
          description: description.trim(),
          parameters: cloneBlockSpacingParameters(state.styleSettings.blockSpacing),
        });
        state.styleSettings.customBlockSpacingPresets = saveBlockSpacingPresetLibrary(
          state.styleSettings.customBlockSpacingPresets,
        );
        state.styleSettings.blockSpacingPresetId = presetId;
      });
    });

    return presetId;
  },
  updateBlockSpacingPreset: ({ presetId, name, description, parameters }) =>
    set((state) => {
      applyStyleSettingsMutation(state, () => {
        const preset = state.styleSettings.customBlockSpacingPresets.find((item) => item.id === presetId);
        if (!preset) {
          return;
        }

        if (name !== undefined) {
          preset.name = normalizePresetText(name, preset.name);
        }
        if (description !== undefined) {
          preset.description = description.trim();
        }
        if (parameters) {
          const nextParameters = clampBlockSpacingParameters(normalizeBlockSpacingParameters(parameters));
          preset.parameters = nextParameters;
          if (state.styleSettings.blockSpacingPresetId === presetId) {
            state.styleSettings.blockSpacing = cloneBlockSpacingParameters(nextParameters);
          }
        }
        state.styleSettings.customBlockSpacingPresets = saveBlockSpacingPresetLibrary(
          state.styleSettings.customBlockSpacingPresets,
        );
      });
    }),
});
