import { defaultStyleSettings } from '@/engine/style/presets';
import { cloneStyleSettings, normalizeStyleSettings } from '@/engine/style/styleSettings';
import type { BoxInsets, MarginSide } from '@/engine/style/types';
import type { StoreSlice, StyleSlice } from '@/store/types';

const MIN_MARGIN_MM = 5;
const MAX_MARGIN_MM = 80;

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
});
