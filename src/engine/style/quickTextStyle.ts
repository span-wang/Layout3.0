import type {
  LayoutBlock,
  LayoutListItem,
  LayoutStyleSheet,
  LayoutTableCell,
  TextRun,
  TextStyleOverrides,
} from '@/engine/document-model';
import type { ResolvedStyleContract } from './types';

export type QuickTextStyleScope =
  | 'allText'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'paragraph'
  | 'list'
  | 'table';

export const quickTextStyleScopeKeys: Record<QuickTextStyleScope, string> = {
  allText: 'quickTextStyle.allText',
  heading1: 'quickTextStyle.heading1',
  heading2: 'quickTextStyle.heading2',
  heading3: 'quickTextStyle.heading3',
  heading4: 'quickTextStyle.heading4',
  paragraph: 'quickTextStyle.paragraph',
  list: 'quickTextStyle.list',
  table: 'quickTextStyle.table',
};

export interface QuickTextStylePatch {
  fontFamily?: string;
  fontSize?: number;
}

// 当局部或批量字号超过模板基线时，固定行高会让字形挤出行盒，页尾最容易被裁掉。
// 这里统一给预览、导出和分页估算一个最低安全比例，避免各处各自猜行高。
export const MIN_EFFECTIVE_TEXT_LINE_HEIGHT_RATIO = 1.35;

export function resolveEffectiveTextLineHeight(payload: {
  fontSize: number;
  baseFontSize: number;
  baseLineHeight: number;
}): number {
  const safeBaseLineHeight = Number.isFinite(payload.baseLineHeight)
    ? Math.max(1, payload.baseLineHeight)
    : 1;
  const safeBaseFontSize = Number.isFinite(payload.baseFontSize)
    ? Math.max(1, payload.baseFontSize)
    : 1;
  const safeFontSize = Number.isFinite(payload.fontSize)
    ? Math.max(1, payload.fontSize)
    : safeBaseFontSize;

  if (safeFontSize <= safeBaseFontSize) {
    return safeBaseLineHeight;
  }

  return Math.max(
    safeBaseLineHeight,
    Math.ceil(safeFontSize * MIN_EFFECTIVE_TEXT_LINE_HEIGHT_RATIO),
  );
}

function isQuickTextStylePatchEmpty(patch: QuickTextStylePatch): boolean {
  return patch.fontFamily === undefined && patch.fontSize === undefined;
}

function normalizeQuickTextStylePatch(patch: QuickTextStylePatch): QuickTextStylePatch {
  const nextPatch: QuickTextStylePatch = {};

  if (patch.fontFamily !== undefined) {
    const trimmedFontFamily = patch.fontFamily.trim();
    if (trimmedFontFamily) {
      nextPatch.fontFamily = trimmedFontFamily;
    }
  }

  if (patch.fontSize !== undefined && Number.isFinite(patch.fontSize)) {
    nextPatch.fontSize = Math.max(10, Math.min(72, Math.round(patch.fontSize)));
  }

  return nextPatch;
}

export function applyQuickTextStyleToStyleSheet(
  styleSheet: LayoutStyleSheet,
  scope: QuickTextStyleScope,
  patch: QuickTextStylePatch,
): LayoutStyleSheet {
  const normalizedPatch = normalizeQuickTextStylePatch(patch);
  if (isQuickTextStylePatchEmpty(normalizedPatch)) {
    return styleSheet;
  }

  const styleKey = quickTextStyleScopeKeys[scope];
  const currentStyle = styleSheet.textStyles[styleKey] ?? {};

  return {
    ...styleSheet,
    textStyles: {
      ...styleSheet.textStyles,
      // 全文字体字号和块类型字体字号都存为样式规则，不直接污染 TextRun 局部覆盖。
      [styleKey]: {
        ...currentStyle,
        ...normalizedPatch,
      },
    },
  };
}

export function getQuickTextStyleRule(
  styles: LayoutStyleSheet | null | undefined,
  scope: QuickTextStyleScope,
): TextStyleOverrides {
  return styles?.textStyles[quickTextStyleScopeKeys[scope]] ?? {};
}

function getHeadingScope(block: LayoutBlock): QuickTextStyleScope | null {
  if (block.type !== 'heading' || block.metadata.kind !== 'heading') {
    return null;
  }

  if (block.metadata.depth === 1) {
    return 'heading1';
  }

  if (block.metadata.depth === 2) {
    return 'heading2';
  }

  if (block.metadata.depth === 3) {
    return 'heading3';
  }

  return 'heading4';
}

export function getQuickTextStyleScopeForBlock(block: LayoutBlock): QuickTextStyleScope | null {
  const headingScope = getHeadingScope(block);
  if (headingScope) {
    return headingScope;
  }

  if (block.type === 'paragraph') {
    return 'paragraph';
  }

  if (block.type === 'list') {
    return 'list';
  }

  if (block.type === 'table') {
    return 'table';
  }

  return null;
}

export function resolveQuickTextStyleForBlock(
  block: LayoutBlock,
  styles: LayoutStyleSheet | null | undefined,
): TextStyleOverrides {
  const allTextStyle = getQuickTextStyleRule(styles, 'allText');
  const blockScope = getQuickTextStyleScopeForBlock(block);
  const blockStyle = blockScope ? getQuickTextStyleRule(styles, blockScope) : {};

  // 优先级：默认/模板基线 < 全文字体字号 < 块类型字体字号 < TextRun 局部覆盖。
  return {
    ...allTextStyle,
    ...blockStyle,
  };
}

export function resolveQuickTextStyleForRun(
  run: TextRun,
  inheritedStyle: TextStyleOverrides,
): TextStyleOverrides {
  return {
    ...inheritedStyle,
    ...run.styleOverrides,
  };
}

export function getEffectiveRunFontSize(
  run: TextRun,
  inheritedStyle: TextStyleOverrides,
  fallback: number,
): number {
  return resolveQuickTextStyleForRun(run, inheritedStyle).fontSize ?? fallback;
}

export function getEffectiveRunFontFamily(
  run: TextRun,
  inheritedStyle: TextStyleOverrides,
): string | undefined {
  return resolveQuickTextStyleForRun(run, inheritedStyle).fontFamily;
}

export function getMaxEffectiveFontSize(
  textRuns: TextRun[],
  inheritedStyle: TextStyleOverrides,
  fallback: number,
): number {
  return textRuns.reduce(
    (max, run) => Math.max(max, getEffectiveRunFontSize(run, inheritedStyle, fallback)),
    inheritedStyle.fontSize ?? fallback,
  );
}

export function getBlockBaseFontSize(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
): number {
  if (block.type === 'heading' && block.metadata.kind === 'heading') {
    if (block.metadata.depth === 1) {
      return contract.blockStyles.heading1.fontSize;
    }

    if (block.metadata.depth === 2) {
      return contract.blockStyles.heading2.fontSize;
    }

    return contract.blockStyles.heading3.fontSize;
  }

  if (block.type === 'list') {
    return contract.blockStyles.list.fontSize;
  }

  return contract.blockStyles.paragraph.fontSize;
}

export function getEffectiveTextRunsMaxFontSize(payload: {
  textRuns: TextRun[];
  block: LayoutBlock;
  styles: LayoutStyleSheet | null | undefined;
  fallback: number;
}): number {
  const inheritedStyle = resolveQuickTextStyleForBlock(payload.block, payload.styles);
  return getMaxEffectiveFontSize(payload.textRuns, inheritedStyle, payload.fallback);
}

export function getEffectiveTextRunsFontFamily(payload: {
  textRuns: TextRun[];
  block: LayoutBlock;
  styles: LayoutStyleSheet | null | undefined;
}): string | undefined {
  const inheritedStyle = resolveQuickTextStyleForBlock(payload.block, payload.styles);
  return payload.textRuns.find((run) => run.styleOverrides.fontFamily)?.styleOverrides.fontFamily ??
    inheritedStyle.fontFamily;
}

export function getEffectiveListItemMaxFontSize(payload: {
  item: LayoutListItem;
  block: LayoutBlock;
  styles: LayoutStyleSheet | null | undefined;
  fallback: number;
}): number {
  const inheritedStyle = resolveQuickTextStyleForBlock(payload.block, payload.styles);
  return getMaxEffectiveFontSize(payload.item.textRuns, inheritedStyle, payload.fallback);
}

export function getEffectiveListItemFontFamily(payload: {
  item: LayoutListItem;
  block: LayoutBlock;
  styles: LayoutStyleSheet | null | undefined;
}): string | undefined {
  const inheritedStyle = resolveQuickTextStyleForBlock(payload.block, payload.styles);
  return payload.item.textRuns.find((run) => run.styleOverrides.fontFamily)?.styleOverrides.fontFamily ??
    inheritedStyle.fontFamily;
}

export function getEffectiveTableCellMaxFontSize(payload: {
  cell: LayoutTableCell;
  block: LayoutBlock;
  styles: LayoutStyleSheet | null | undefined;
  fallback: number;
}): number {
  const inheritedStyle = resolveQuickTextStyleForBlock(payload.block, payload.styles);
  return getMaxEffectiveFontSize(payload.cell.textRuns, inheritedStyle, payload.fallback);
}

export function getEffectiveTableCellFontFamily(payload: {
  cell: LayoutTableCell;
  block: LayoutBlock;
  styles: LayoutStyleSheet | null | undefined;
}): string | undefined {
  const inheritedStyle = resolveQuickTextStyleForBlock(payload.block, payload.styles);
  return payload.cell.textRuns.find((run) => run.styleOverrides.fontFamily)?.styleOverrides.fontFamily ??
    inheritedStyle.fontFamily;
}
