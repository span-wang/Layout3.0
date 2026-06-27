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

export function getEffectiveListItemMaxFontSize(payload: {
  item: LayoutListItem;
  block: LayoutBlock;
  styles: LayoutStyleSheet | null | undefined;
  fallback: number;
}): number {
  const inheritedStyle = resolveQuickTextStyleForBlock(payload.block, payload.styles);
  return getMaxEffectiveFontSize(payload.item.textRuns, inheritedStyle, payload.fallback);
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
