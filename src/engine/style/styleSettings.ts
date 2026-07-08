import { defaultBlockSpacingParameters, defaultStyleSettings } from './presets';
import {
  DOM_MEASURE_PAGINATION_ALGORITHM_ID,
  MAX_FILL_PAGINATION_ALGORITHM_ID,
} from '@/engine/typesetting/algorithmIds';
import type {
  BlockSpacingParameterKey,
  BlockSpacingParameters,
  BlockSpacingPreset,
  BoxInsets,
  ColumnSettings,
  HeaderFooterContent,
  HeaderFooterLineContent,
  HeaderFooterPresetId,
  HeaderFooterSlot,
  MarginMode,
  MarginPresetId,
  PageBackgroundImageFit,
  PageBackgroundMode,
  PageBackgroundSettings,
  PageOrientation,
  PageSizeId,
  PdfImageWatermarkSettings,
  PdfTextWatermarkSettings,
  PdfWatermarkKind,
  PdfWatermarkSettings,
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

function cloneColumnSettings(columns: ColumnSettings): ColumnSettings {
  return {
    count: columns.count,
    gapMm: columns.gapMm,
    divider: columns.divider,
    headingsSpanAll: columns.headingsSpanAll,
  };
}

export function clonePageBackgroundSettings(background: PageBackgroundSettings): PageBackgroundSettings {
  return {
    mode: background.mode,
    color: background.color,
    imageSrc: background.imageSrc,
    imageFit: background.imageFit,
  };
}

function clonePdfTextWatermarkSettings(settings: PdfTextWatermarkSettings): PdfTextWatermarkSettings {
  return {
    content: settings.content,
    fontSizePx: settings.fontSizePx,
  };
}

function clonePdfImageWatermarkSettings(settings: PdfImageWatermarkSettings): PdfImageWatermarkSettings {
  return {
    imageSrc: settings.imageSrc,
    widthPercent: settings.widthPercent,
  };
}

export function clonePdfWatermarkSettings(settings: PdfWatermarkSettings): PdfWatermarkSettings {
  return {
    enabled: settings.enabled,
    kind: settings.kind,
    angleDeg: settings.angleDeg,
    opacityPercent: settings.opacityPercent,
    text: clonePdfTextWatermarkSettings(settings.text),
    image: clonePdfImageWatermarkSettings(settings.image),
  };
}

function cloneHeaderFooterLineContent(line: HeaderFooterLineContent): HeaderFooterLineContent {
  return {
    left: line.left,
    center: line.center,
    right: line.right,
  };
}

export function cloneHeaderFooterContent(content: HeaderFooterContent): HeaderFooterContent {
  return {
    header: cloneHeaderFooterLineContent(content.header),
    footer: cloneHeaderFooterLineContent(content.footer),
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

function isPageColumnCount(value: unknown): value is ColumnSettings['count'] {
  return value === 1 || value === 2 || value === 3;
}

function isTemplateId(value: unknown): value is TemplateId {
  return value === 'default' || value === 'lecture' || value === 'notes';
}

function isThemeId(value: unknown): value is ThemeId {
  // 读取旧工程或异常工程时，未知主题会被 normalizeStyleSettings 回退到默认主题。
  return value === 'default' || value === 'snowMountain' || value === 'handDrawn';
}

function isPageBackgroundMode(value: unknown): value is PageBackgroundMode {
  return value === 'theme' || value === 'color' || value === 'image';
}

function isPageBackgroundImageFit(value: unknown): value is PageBackgroundImageFit {
  return value === 'cover' || value === 'contain' || value === 'repeat';
}

function isPdfWatermarkKind(value: unknown): value is PdfWatermarkKind {
  return value === 'text' || value === 'image';
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

function normalizeContentString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeOptionalString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeColorString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback;
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

function normalizeHeaderFooterLineContent(
  value: unknown,
  fallback: HeaderFooterLineContent,
): HeaderFooterLineContent {
  if (!isRecord(value)) {
    return cloneHeaderFooterLineContent(fallback);
  }

  const slots: HeaderFooterSlot[] = ['left', 'center', 'right'];
  return slots.reduce((line, slot) => {
    line[slot] = normalizeContentString(value[slot], fallback[slot]);
    return line;
  }, {} as HeaderFooterLineContent);
}

function normalizeHeaderFooterContent(
  value: unknown,
  fallback: HeaderFooterContent = defaultStyleSettings.headerFooterContent,
): HeaderFooterContent {
  if (!isRecord(value)) {
    return cloneHeaderFooterContent(fallback);
  }

  return {
    header: normalizeHeaderFooterLineContent(value.header, fallback.header),
    footer: normalizeHeaderFooterLineContent(value.footer, fallback.footer),
  };
}

function normalizePageBackgroundSettings(
  value: unknown,
  fallback: PageBackgroundSettings = defaultStyleSettings.pageBackground,
): PageBackgroundSettings {
  if (!isRecord(value)) {
    return clonePageBackgroundSettings(fallback);
  }

  return {
    mode: isPageBackgroundMode(value.mode) ? value.mode : fallback.mode,
    color: normalizeColorString(value.color, fallback.color),
    imageSrc: normalizeOptionalString(value.imageSrc, fallback.imageSrc),
    imageFit: isPageBackgroundImageFit(value.imageFit) ? value.imageFit : fallback.imageFit,
  };
}

function normalizePdfWatermarkAngle(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(-180, Math.min(180, Math.round(value)));
}

function normalizePdfWatermarkOpacity(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizePdfWatermarkTextSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(16, Math.min(160, Math.round(value)));
}

function normalizePdfWatermarkImageWidth(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(10, Math.min(70, Math.round(value)));
}

function normalizePdfTextWatermarkSettings(
  value: unknown,
  fallback: PdfTextWatermarkSettings = defaultStyleSettings.pdfWatermark.text,
): PdfTextWatermarkSettings {
  if (!isRecord(value)) {
    return clonePdfTextWatermarkSettings(fallback);
  }

  return {
    content: normalizeContentString(value.content, fallback.content),
    fontSizePx: normalizePdfWatermarkTextSize(value.fontSizePx, fallback.fontSizePx),
  };
}

function normalizePdfImageWatermarkSettings(
  value: unknown,
  fallback: PdfImageWatermarkSettings = defaultStyleSettings.pdfWatermark.image,
): PdfImageWatermarkSettings {
  if (!isRecord(value)) {
    return clonePdfImageWatermarkSettings(fallback);
  }

  return {
    imageSrc: normalizeOptionalString(value.imageSrc, fallback.imageSrc),
    widthPercent: normalizePdfWatermarkImageWidth(value.widthPercent, fallback.widthPercent),
  };
}

function normalizePdfWatermarkSettings(
  value: unknown,
  fallback: PdfWatermarkSettings = defaultStyleSettings.pdfWatermark,
): PdfWatermarkSettings {
  if (!isRecord(value)) {
    return clonePdfWatermarkSettings(fallback);
  }

  return {
    enabled: normalizeBoolean(value.enabled, fallback.enabled),
    kind: isPdfWatermarkKind(value.kind) ? value.kind : fallback.kind,
    angleDeg: normalizePdfWatermarkAngle(value.angleDeg, fallback.angleDeg),
    opacityPercent: normalizePdfWatermarkOpacity(value.opacityPercent, fallback.opacityPercent),
    text: normalizePdfTextWatermarkSettings(value.text, fallback.text),
    image: normalizePdfImageWatermarkSettings(value.image, fallback.image),
  };
}

function normalizeSpacingNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(240, Math.round(value)));
}

function normalizeColumnGapMm(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(4, Math.min(30, Math.round(value)));
}

function normalizeColumnSettings(
  value: unknown,
  fallback: ColumnSettings = defaultStyleSettings.columns,
): ColumnSettings {
  if (!isRecord(value)) {
    return cloneColumnSettings(fallback);
  }

  return {
    count: isPageColumnCount(value.count) ? value.count : fallback.count,
    gapMm: normalizeColumnGapMm(value.gapMm, fallback.gapMm),
    divider: normalizeBoolean(value.divider, fallback.divider),
    headingsSpanAll: normalizeBoolean(value.headingsSpanAll, fallback.headingsSpanAll),
  };
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

export function normalizeBlockSpacingPresets(value: unknown): BlockSpacingPreset[] {
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
  // 真实测量分页引擎接入后，`.layout` 里允许保留两种已注册算法；
  // 更早期遗留的实验算法 ID 继续回退到默认算法，避免界面出现不可选残留值。
  return value === MAX_FILL_PAGINATION_ALGORITHM_ID || value === DOM_MEASURE_PAGINATION_ALGORITHM_ID
    ? value
    : fallback;
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
    pageBackground: clonePageBackgroundSettings(styleSettings.pageBackground),
    pdfWatermark: clonePdfWatermarkSettings(styleSettings.pdfWatermark),
    headerFooterContent: cloneHeaderFooterContent(styleSettings.headerFooterContent),
    columns: cloneColumnSettings(styleSettings.columns),
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
    // 页面背景是主题之上的用户覆盖层；旧 .layout 没有该字段时继续跟随主题。
    pageBackground: normalizePageBackgroundSettings(value.pageBackground),
    pdfWatermark: normalizePdfWatermarkSettings(value.pdfWatermark),
    // 旧 .layout 没有页眉页脚内容字段时，使用当前默认内容来保持原有视觉效果。
    headerFooterContent: normalizeHeaderFooterContent(value.headerFooterContent),
    isHeaderFooterLinked: normalizeBoolean(
      value.isHeaderFooterLinked,
      defaultStyleSettings.isHeaderFooterLinked,
    ),
    columns: normalizeColumnSettings(value.columns),
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
