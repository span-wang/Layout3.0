import { defaultStyleSettings } from './presets';
import type {
  BoxInsets,
  HeaderFooterPresetId,
  MarginMode,
  MarginPresetId,
  PageOrientation,
  PageSizeId,
  PaginationBehavior,
  StyleSettings,
  TemplateId,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cloneBoxInsets(insets: BoxInsets): BoxInsets {
  return {
    top: insets.top,
    right: insets.right,
    bottom: insets.bottom,
    left: insets.left,
  };
}

function clonePaginationBehavior(behavior: PaginationBehavior): PaginationBehavior {
  return {
    keepHeadingWithNext: behavior.keepHeadingWithNext,
    avoidBreakInsideCodeBlocks: behavior.avoidBreakInsideCodeBlocks,
    avoidBreakInsideTables: behavior.avoidBreakInsideTables,
    avoidBreakInsideImages: behavior.avoidBreakInsideImages,
  };
}

function isPageSizeId(value: unknown): value is PageSizeId {
  return value === 'A3' || value === 'A4' || value === 'B5';
}

function isPageOrientation(value: unknown): value is PageOrientation {
  return value === 'portrait' || value === 'landscape';
}

function isMarginMode(value: unknown): value is MarginMode {
  return value === 'preset' || value === 'custom';
}

function isMarginPresetId(value: unknown): value is MarginPresetId {
  return value === 'normal' || value === 'narrow' || value === 'wide';
}

function isHeaderFooterPresetId(value: unknown): value is HeaderFooterPresetId {
  return value === 'none' || value === 'compact' || value === 'standard';
}

function isTemplateId(value: unknown): value is TemplateId {
  return value === 'default' || value === 'lecture' || value === 'notes';
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeBoxInsets(value: unknown, fallback: BoxInsets): BoxInsets {
  if (!isRecord(value)) {
    return cloneBoxInsets(fallback);
  }

  return {
    top: normalizeNumber(value.top, fallback.top),
    right: normalizeNumber(value.right, fallback.right),
    bottom: normalizeNumber(value.bottom, fallback.bottom),
    left: normalizeNumber(value.left, fallback.left),
  };
}

function normalizePaginationAlgorithmId(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function normalizePaginationBehavior(
  value: unknown,
  fallback: PaginationBehavior,
): PaginationBehavior {
  if (!isRecord(value)) {
    return clonePaginationBehavior(fallback);
  }

  return {
    keepHeadingWithNext: normalizeBoolean(value.keepHeadingWithNext, fallback.keepHeadingWithNext),
    avoidBreakInsideCodeBlocks: normalizeBoolean(
      value.avoidBreakInsideCodeBlocks,
      fallback.avoidBreakInsideCodeBlocks,
    ),
    avoidBreakInsideTables: normalizeBoolean(
      value.avoidBreakInsideTables,
      fallback.avoidBreakInsideTables,
    ),
    avoidBreakInsideImages: normalizeBoolean(
      value.avoidBreakInsideImages,
      fallback.avoidBreakInsideImages,
    ),
  };
}

export function cloneStyleSettings(styleSettings: StyleSettings): StyleSettings {
  return {
    ...styleSettings,
    customMarginsMm: cloneBoxInsets(styleSettings.customMarginsMm),
    paginationAlgorithmId: styleSettings.paginationAlgorithmId,
    paginationBehavior: clonePaginationBehavior(styleSettings.paginationBehavior),
  };
}

export function normalizeStyleSettings(value: unknown): StyleSettings {
  if (!isRecord(value)) {
    return cloneStyleSettings(defaultStyleSettings);
  }

  // 读取 .layout 时对样式设置做保守归一化，避免旧文件或坏数据直接把右侧面板打崩。
  return {
    pageSize: isPageSizeId(value.pageSize) ? value.pageSize : defaultStyleSettings.pageSize,
    orientation: isPageOrientation(value.orientation)
      ? value.orientation
      : defaultStyleSettings.orientation,
    marginMode: isMarginMode(value.marginMode) ? value.marginMode : defaultStyleSettings.marginMode,
    marginPreset: isMarginPresetId(value.marginPreset)
      ? value.marginPreset
      : defaultStyleSettings.marginPreset,
    customMarginsMm: normalizeBoxInsets(value.customMarginsMm, defaultStyleSettings.customMarginsMm),
    isMarginLinked: normalizeBoolean(value.isMarginLinked, defaultStyleSettings.isMarginLinked),
    headerFooterMode: isMarginMode(value.headerFooterMode)
      ? value.headerFooterMode
      : defaultStyleSettings.headerFooterMode,
    templateId: isTemplateId(value.templateId) ? value.templateId : defaultStyleSettings.templateId,
    headerPreset: isHeaderFooterPresetId(value.headerPreset)
      ? value.headerPreset
      : defaultStyleSettings.headerPreset,
    footerPreset: isHeaderFooterPresetId(value.footerPreset)
      ? value.footerPreset
      : defaultStyleSettings.footerPreset,
    customHeaderReservedMm: normalizeNumber(
      value.customHeaderReservedMm,
      defaultStyleSettings.customHeaderReservedMm,
    ),
    customFooterReservedMm: normalizeNumber(
      value.customFooterReservedMm,
      defaultStyleSettings.customFooterReservedMm,
    ),
    isHeaderFooterLinked: normalizeBoolean(
      value.isHeaderFooterLinked,
      defaultStyleSettings.isHeaderFooterLinked,
    ),
    paginationAlgorithmId: normalizePaginationAlgorithmId(
      value.paginationAlgorithmId,
      defaultStyleSettings.paginationAlgorithmId,
    ),
    paginationBehavior: normalizePaginationBehavior(
      value.paginationBehavior,
      defaultStyleSettings.paginationBehavior,
    ),
  };
}
