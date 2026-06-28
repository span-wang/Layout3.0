import { blockSpacingPresetDefinitions, defaultStyleSettings } from '@/engine/style/presets';
import {
  cloneBlockSpacingParameters,
  cloneStyleSettings,
  normalizeBlockSpacingParameters,
  normalizeStyleSettings,
} from '@/engine/style/styleSettings';
import type {
  BlockSpacingParameters,
  BlockSpacingParameterKey,
  BoxInsets,
  MarginSide,
} from '@/engine/style/types';
import type { StoreSlice, StyleSlice } from '@/store/types';

const MIN_MARGIN_MM = 5;
const MAX_MARGIN_MM = 80;
const MIN_BLOCK_SPACING_PX = 0;
const MAX_BLOCK_SPACING_PX = 240;

function clampMarginValue(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_MARGIN_MM;
  }

  return Math.min(MAX_MARGIN_MM, Math.max(MIN_MARGIN_MM, Math.round(value)));
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

export const createStyleSlice: StoreSlice<StyleSlice> = (set) => ({
  styleSettings: cloneStyleSettings(defaultStyleSettings),
  resetStyleSettings: () =>
    set((state) => {
      state.styleSettings = cloneStyleSettings(defaultStyleSettings);
    }),
  replaceStyleSettings: (styleSettings) =>
    set((state) => {
      // 读取旧草稿或旧 .layout 数据时也统一走归一化，避免新字段缺失把状态带坏。
      state.styleSettings = normalizeStyleSettings(styleSettings);
    }),
  setPageSize: (pageSize) =>
    set((state) => {
      state.styleSettings.pageSize = pageSize;
      state.isDirty = true;
    }),
  setOrientation: (orientation) =>
    set((state) => {
      state.styleSettings.orientation = orientation;
      state.isDirty = true;
    }),
  setMarginMode: (marginMode) =>
    set((state) => {
      state.styleSettings.marginMode = marginMode;
      state.isDirty = true;
    }),
  setMarginPreset: (marginPreset) =>
    set((state) => {
      state.styleSettings.marginPreset = marginPreset;
      state.isDirty = true;
    }),
  setCustomMargin: (side: MarginSide, value: number) =>
    set((state) => {
      const nextValue = clampMarginValue(value);
      if (state.styleSettings.isMarginLinked) {
        setAllMargins(state.styleSettings.customMarginsMm, nextValue);
        state.isDirty = true;
        return;
      }

      state.styleSettings.customMarginsMm[side] = nextValue;
      state.isDirty = true;
    }),
  setMarginLinked: (linked) =>
    set((state) => {
      state.styleSettings.isMarginLinked = linked;
      state.isDirty = true;
      if (!linked) {
        return;
      }

      setAllMargins(state.styleSettings.customMarginsMm, state.styleSettings.customMarginsMm.top);
    }),
  setHeaderFooterMode: (mode) =>
    set((state) => {
      state.styleSettings.headerFooterMode = mode;
      state.isDirty = true;
    }),
  setTemplateId: (templateId) =>
    set((state) => {
      state.styleSettings.templateId = templateId;
      state.isDirty = true;
    }),
  setThemeId: (themeId) =>
    set((state) => {
      state.styleSettings.themeId = themeId;
      state.isDirty = true;
    }),
  setHeaderPreset: (headerPreset) =>
    set((state) => {
      state.styleSettings.headerPreset = headerPreset;
      state.isDirty = true;
    }),
  setFooterPreset: (footerPreset) =>
    set((state) => {
      state.styleSettings.footerPreset = footerPreset;
      state.isDirty = true;
    }),
  setCustomHeaderReservedMm: (value) =>
    set((state) => {
      const nextValue = clampMarginValue(value);
      state.styleSettings.customHeaderReservedMm = nextValue;
      if (state.styleSettings.isHeaderFooterLinked) {
        state.styleSettings.customFooterReservedMm = nextValue;
      }
      state.isDirty = true;
    }),
  setCustomFooterReservedMm: (value) =>
    set((state) => {
      const nextValue = clampMarginValue(value);
      state.styleSettings.customFooterReservedMm = nextValue;
      if (state.styleSettings.isHeaderFooterLinked) {
        state.styleSettings.customHeaderReservedMm = nextValue;
      }
      state.isDirty = true;
    }),
  setHeaderFooterLinked: (linked) =>
    set((state) => {
      state.styleSettings.isHeaderFooterLinked = linked;
      state.isDirty = true;
      if (!linked) {
        return;
      }

      state.styleSettings.customFooterReservedMm = state.styleSettings.customHeaderReservedMm;
    }),
  setPaginationAlgorithmId: (algorithmId) =>
    set((state) => {
      state.styleSettings.paginationAlgorithmId = algorithmId;
      state.isDirty = true;
    }),
  setPaginationBehaviorOption: (option, value) =>
    set((state) => {
      state.styleSettings.paginationBehavior[option] = value;
      state.isDirty = true;
    }),
  setBlockSpacingParameter: (parameter, value) =>
    set((state) => {
      state.styleSettings.blockSpacing[parameter] = clampBlockSpacingValue(value);
      state.styleSettings.blockSpacingPresetId = 'custom';
      state.isDirty = true;
    }),
  applyBlockSpacingPreset: (presetId) =>
    set((state) => {
      const preset = findBlockSpacingPreset(state.styleSettings, presetId);
      if (!preset) {
        return;
      }

      state.styleSettings.blockSpacing = cloneBlockSpacingParameters(preset.parameters);
      state.styleSettings.blockSpacingPresetId = preset.id;
      state.isDirty = true;
    }),
  addBlockSpacingPreset: ({ name, description }) => {
    const presetId = createCustomBlockSpacingPresetId();

    set((state) => {
      const presetName = normalizePresetText(name, `自定义预设 ${state.styleSettings.customBlockSpacingPresets.length + 1}`);
      state.styleSettings.customBlockSpacingPresets.push({
        id: presetId,
        name: presetName,
        description: description.trim(),
        parameters: cloneBlockSpacingParameters(state.styleSettings.blockSpacing),
      });
      state.styleSettings.blockSpacingPresetId = presetId;
      state.isDirty = true;
    });

    return presetId;
  },
  updateBlockSpacingPreset: ({ presetId, name, description, parameters }) =>
    set((state) => {
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
      state.isDirty = true;
    }),
});
