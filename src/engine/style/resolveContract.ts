import {
  defaultBlockStyles,
  headerFooterPresetDefinitions,
  marginPresetDefinitions,
  pageSizeDefinitions,
  templateDefinitions,
} from './presets';
import type { BlockStyleContract, BoxInsets, ResolvedStyleContract, StyleSettings } from './types';

const MM_TO_PX = 96 / 25.4;

function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_PX * 100) / 100;
}

function cloneInsets(insets: BoxInsets): BoxInsets {
  return {
    top: insets.top,
    right: insets.right,
    bottom: insets.bottom,
    left: insets.left,
  };
}

function cloneBlockStyles(styles: BlockStyleContract): BlockStyleContract {
  return {
    heading1: { ...styles.heading1 },
    heading2: { ...styles.heading2 },
    heading3: { ...styles.heading3 },
    paragraph: { ...styles.paragraph },
    list: { ...styles.list },
    blockquote: { ...styles.blockquote },
    code: { ...styles.code },
    table: { ...styles.table },
    horizontalRule: { ...styles.horizontalRule },
    image: { ...styles.image },
  };
}

function getPageSize(settings: StyleSettings) {
  const definition =
    pageSizeDefinitions.find((item) => item.id === settings.pageSize) ?? pageSizeDefinitions[1];

  if (settings.orientation === 'landscape') {
    return {
      definition,
      widthMm: definition.heightMm,
      heightMm: definition.widthMm,
    };
  }

  return {
    definition,
    widthMm: definition.widthMm,
    heightMm: definition.heightMm,
  };
}

function getMarginsMm(settings: StyleSettings): BoxInsets {
  if (settings.marginMode === 'custom') {
    return cloneInsets(settings.customMarginsMm);
  }

  const preset =
    marginPresetDefinitions.find((item) => item.id === settings.marginPreset) ??
    marginPresetDefinitions[0];
  return cloneInsets(preset.valueMm);
}

function clampReservedHeight(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(80, Math.max(0, Math.round(value)));
}

function applyTemplate(blockStyles: BlockStyleContract, templateId: StyleSettings['templateId']): void {
  if (templateId === 'lecture') {
    blockStyles.heading1.fontSize = 34;
    blockStyles.heading1.lineHeight = 42;
    blockStyles.heading1.marginBottom = 28;
    blockStyles.heading2.fontSize = 26;
    blockStyles.heading2.lineHeight = 34;
    blockStyles.heading2.marginTop = 26;
    blockStyles.heading2.marginBottom = 16;
    blockStyles.heading3.marginTop = 20;
    blockStyles.heading3.marginBottom = 14;
    blockStyles.paragraph.lineHeight = 30;
    blockStyles.paragraph.marginBottom = 18;
    blockStyles.list.lineHeight = 30;
    blockStyles.list.marginBottom = 18;
    blockStyles.blockquote.marginBottom = 20;
    blockStyles.code.marginBottom = 20;
    blockStyles.table.marginBottom = 20;
    return;
  }

  if (templateId === 'notes') {
    blockStyles.heading1.fontSize = 28;
    blockStyles.heading1.lineHeight = 34;
    blockStyles.heading1.marginBottom = 20;
    blockStyles.heading2.fontSize = 22;
    blockStyles.heading2.lineHeight = 28;
    blockStyles.heading2.marginTop = 18;
    blockStyles.heading2.marginBottom = 12;
    blockStyles.heading3.fontSize = 18;
    blockStyles.heading3.lineHeight = 24;
    blockStyles.heading3.marginTop = 14;
    blockStyles.heading3.marginBottom = 10;
    blockStyles.paragraph.lineHeight = 26;
    blockStyles.paragraph.marginBottom = 12;
    blockStyles.list.lineHeight = 26;
    blockStyles.list.marginBottom = 12;
    blockStyles.list.itemGap = 6;
    blockStyles.blockquote.lineHeight = 26;
    blockStyles.blockquote.marginBottom = 14;
    blockStyles.code.lineHeight = 22;
    blockStyles.code.marginBottom = 14;
    blockStyles.table.rowHeight = 38;
    blockStyles.table.headerRowHeight = 42;
    blockStyles.table.marginBottom = 14;
  }
}

function applyPaginationBehavior(contract: ResolvedStyleContract): void {
  const { blockStyles, paginationBehavior } = contract;

  blockStyles.heading1.keepWithNext = paginationBehavior.keepHeadingWithNext;
  blockStyles.heading2.keepWithNext = paginationBehavior.keepHeadingWithNext;
  blockStyles.heading3.keepWithNext = paginationBehavior.keepHeadingWithNext;
  blockStyles.code.avoidBreakInside = paginationBehavior.avoidBreakInsideCodeBlocks;
  blockStyles.table.avoidBreakInside = paginationBehavior.avoidBreakInsideTables;
  blockStyles.image.avoidBreakInside = paginationBehavior.avoidBreakInsideImages;
}

export function resolveStyleContract(settings: StyleSettings): ResolvedStyleContract {
  const { definition, widthMm, heightMm } = getPageSize(settings);
  const marginsMm = getMarginsMm(settings);
  const headerReservedMm =
    settings.headerFooterMode === 'custom'
      ? clampReservedHeight(settings.customHeaderReservedMm)
      : headerFooterPresetDefinitions.find((item) => item.id === settings.headerPreset)?.reservedHeightMm ?? 0;
  const footerReservedMm =
    settings.headerFooterMode === 'custom'
      ? clampReservedHeight(settings.customFooterReservedMm)
      : headerFooterPresetDefinitions.find((item) => item.id === settings.footerPreset)?.reservedHeightMm ?? 0;
  const templateLabel =
    templateDefinitions.find((item) => item.id === settings.templateId)?.name ?? '默认（无模板）';
  const marginLabel =
    settings.marginMode === 'custom'
      ? `自定义 ${marginsMm.top}/${marginsMm.right}/${marginsMm.bottom}/${marginsMm.left} mm`
      : (marginPresetDefinitions.find((item) => item.id === settings.marginPreset)?.label ?? '普通');

  const contentWidthMm = Math.max(60, widthMm - marginsMm.left - marginsMm.right);
  const contentHeightMm = Math.max(
    80,
    heightMm - marginsMm.top - marginsMm.bottom - headerReservedMm - footerReservedMm,
  );

  const contract: ResolvedStyleContract = {
    pageSize: settings.pageSize,
    orientation: settings.orientation,
    templateId: settings.templateId,
    pageLabel: `${definition.label} / ${settings.orientation === 'portrait' ? '纵向' : '横向'}`,
    templateLabel,
    marginLabel,
    pageWidthMm: widthMm,
    pageHeightMm: heightMm,
    pageWidthPx: mmToPx(widthMm),
    pageHeightPx: mmToPx(heightMm),
    marginsMm,
    marginsPx: {
      top: mmToPx(marginsMm.top),
      right: mmToPx(marginsMm.right),
      bottom: mmToPx(marginsMm.bottom),
      left: mmToPx(marginsMm.left),
    },
    headerReservedMm,
    footerReservedMm,
    headerReservedPx: mmToPx(headerReservedMm),
    footerReservedPx: mmToPx(footerReservedMm),
    contentWidthMm,
    contentHeightMm,
    contentWidthPx: mmToPx(contentWidthMm),
    contentHeightPx: mmToPx(contentHeightMm),
    blockStyles: cloneBlockStyles(defaultBlockStyles),
    paginationBehavior: { ...settings.paginationBehavior },
  };

  applyTemplate(contract.blockStyles, settings.templateId);
  applyPaginationBehavior(contract);

  return contract;
}
