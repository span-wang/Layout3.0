import { defaultBlockSpacingParameters, defaultStyleSettings } from './presets';
import type {
  BlockSpacingParameterKey,
  BlockSpacingParameters,
  BlockSpacingPreset,
  BoxInsets,
  HeaderFooterPresetId,
  MarginMode,
  MarginPresetId,
  PageOrientation,
  PageSizeId,
  PaginationBehavior,
  StyleSettings,
  TemplateId,
  ThemeId,
} from './types';

export const blockSpacingParameterKeys: BlockSpacingParameterKey[] = [
  'heading1SpaceBefore',
  'heading1SpaceAfter',
  'heading2SpaceBefore',
  'heading2SpaceAfter',
  'heading3SpaceBefore',
  'heading3SpaceAfter',
  'paragraphSpaceBefore',
  'paragraphSpaceAfter',
  'listSpaceBefore',
  'listSpaceAfter',
  'listItemGap',
  'blockquoteSpaceBefore',
  'blockquoteSpaceAfter',
  'codeSpaceBefore',
  'codeSpaceAfter',
  'codePaddingX',
  'codePaddingY',
  'tableSpaceBefore',
  'tableSpaceAfter',
  'tableCellPaddingX',
  'tableCellPaddingY',
  'imageSpaceBefore',
  'imageSpaceAfter',
  'ruleSpaceBefore',
  'ruleSpaceAfter',
  'textInsetLeft',
  'textInsetRight',
];

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

export function cloneBlockSpacingParameters(parameters: BlockSpacingParameters): BlockSpacingParameters {
  return {
    heading1SpaceBefore: parameters.heading1SpaceBefore,
    heading1SpaceAfter: parameters.heading1SpaceAfter,
    heading2SpaceBefore: parameters.heading2SpaceBefore,
    heading2SpaceAfter: parameters.heading2SpaceAfter,
    heading3SpaceBefore: parameters.heading3SpaceBefore,
    heading3SpaceAfter: parameters.heading3SpaceAfter,
    paragraphSpaceBefore: parameters.paragraphSpaceBefore,
    paragraphSpaceAfter: parameters.paragraphSpaceAfter,
    listSpaceBefore: parameters.listSpaceBefore,
    listSpaceAfter: parameters.listSpaceAfter,
    listItemGap: parameters.listItemGap,
    blockquoteSpaceBefore: parameters.blockquoteSpaceBefore,
    blockquoteSpaceAfter: parameters.blockquoteSpaceAfter,
    codeSpaceBefore: parameters.codeSpaceBefore,
    codeSpaceAfter: parameters.codeSpaceAfter,
    codePaddingX: parameters.codePaddingX,
    codePaddingY: parameters.codePaddingY,
    tableSpaceBefore: parameters.tableSpaceBefore,
    tableSpaceAfter: parameters.tableSpaceAfter,
    tableCellPaddingX: parameters.tableCellPaddingX,
    tableCellPaddingY: parameters.tableCellPaddingY,
    imageSpaceBefore: parameters.imageSpaceBefore,
    imageSpaceAfter: parameters.imageSpaceAfter,
    ruleSpaceBefore: parameters.ruleSpaceBefore,
    ruleSpaceAfter: parameters.ruleSpaceAfter,
    textInsetLeft: parameters.textInsetLeft,
    textInsetRight: parameters.textInsetRight,
  };
}

function cloneBlockSpacingPreset(preset: BlockSpacingPreset): BlockSpacingPreset {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    builtIn: preset.builtIn,
    parameters: cloneBlockSpacingParameters(preset.parameters),
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

function isThemeId(value: unknown): value is ThemeId {
  return value === 'default' || value === 'snowMountain';
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
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

function normalizeSpacingNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(240, Math.round(value)));
}

export function normalizeBlockSpacingParameters(
  value: unknown,
  fallback: BlockSpacingParameters = defaultBlockSpacingParameters,
): BlockSpacingParameters {
  if (!isRecord(value)) {
    return cloneBlockSpacingParameters(fallback);
  }

  return blockSpacingParameterKeys.reduce((parameters, key) => {
    parameters[key] = normalizeSpacingNumber(value[key], fallback[key]);
    return parameters;
  }, {} as BlockSpacingParameters);
}

function normalizeBlockSpacingPresets(value: unknown): BlockSpacingPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item, index) => ({
      id: normalizeString(item.id, `custom-block-spacing-${index + 1}`),
      name: normalizeString(item.name, `自定义预设 ${index + 1}`),
      description: typeof item.description === 'string' ? item.description : '',
      builtIn: false,
      parameters: normalizeBlockSpacingParameters(item.parameters),
    }));
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
    blockSpacing: cloneBlockSpacingParameters(styleSettings.blockSpacing),
    customBlockSpacingPresets: styleSettings.customBlockSpacingPresets.map(cloneBlockSpacingPreset),
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
    themeId: isThemeId(value.themeId) ? value.themeId : defaultStyleSettings.themeId,
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
    blockSpacingPresetId: normalizeString(
      value.blockSpacingPresetId,
      defaultStyleSettings.blockSpacingPresetId,
    ),
    blockSpacing: normalizeBlockSpacingParameters(
      value.blockSpacing,
      defaultStyleSettings.blockSpacing,
    ),
    customBlockSpacingPresets: normalizeBlockSpacingPresets(value.customBlockSpacingPresets),
  };
}
