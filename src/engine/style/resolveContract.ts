import {
  defaultBlockStyles,
  headerFooterPresetDefinitions,
  marginPresetDefinitions,
  pageSizeDefinitions,
  templateDefinitions,
  themeDefinitions,
} from './presets';
import type {
  BlockStyleContract,
  BoxInsets,
  ResolvedStyleContract,
  StyleSettings,
  ThemeLayoutMetrics,
  ThemeVisualTokens,
} from './types';

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

function cloneThemeTokens(tokens: ThemeVisualTokens): ThemeVisualTokens {
  return {
    pageBackground: tokens.pageBackground,
    pageBorderColor: tokens.pageBorderColor,
    pageShadow: tokens.pageShadow,
    pageTopBandColor: tokens.pageTopBandColor,
    pagePattern: tokens.pagePattern,
    pagePatternSize: tokens.pagePatternSize,
    headingFontFamily: tokens.headingFontFamily,
    bodyFontFamily: tokens.bodyFontFamily,
    headerBackground: tokens.headerBackground,
    footerBackground: tokens.footerBackground,
    headerFooterText: tokens.headerFooterText,
    headerBorderColor: tokens.headerBorderColor,
    footerBorderColor: tokens.footerBorderColor,
    bodyOutlineColor: tokens.bodyOutlineColor,
    heading1Color: tokens.heading1Color,
    heading1RuleColor: tokens.heading1RuleColor,
    heading2Color: tokens.heading2Color,
    heading2MarkerColor: tokens.heading2MarkerColor,
    heading3Color: tokens.heading3Color,
    paragraphColor: tokens.paragraphColor,
    mutedTextColor: tokens.mutedTextColor,
    listMarkerColor: tokens.listMarkerColor,
    taskCheckboxColor: tokens.taskCheckboxColor,
    blockquoteBackground: tokens.blockquoteBackground,
    blockquoteBorderColor: tokens.blockquoteBorderColor,
    blockquoteTextColor: tokens.blockquoteTextColor,
    codeBackground: tokens.codeBackground,
    codeBorderColor: tokens.codeBorderColor,
    codeTextColor: tokens.codeTextColor,
    tableBorderColor: tokens.tableBorderColor,
    tableHeaderBackground: tokens.tableHeaderBackground,
    tableHeaderTextColor: tokens.tableHeaderTextColor,
    ruleColor: tokens.ruleColor,
    pageBreakLineColor: tokens.pageBreakLineColor,
    pageBreakBackground: tokens.pageBreakBackground,
    pageBreakBorderColor: tokens.pageBreakBorderColor,
    pageBreakTextColor: tokens.pageBreakTextColor,
    imageCaptionColor: tokens.imageCaptionColor,
  };
}

function cloneThemeLayoutMetrics(metrics: ThemeLayoutMetrics): ThemeLayoutMetrics {
  return {
    heading1: { ...metrics.heading1 },
    heading2: { ...metrics.heading2 },
    heading3: { ...metrics.heading3 },
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

function resolveSingleColumnWidthMm(contentWidthMm: number, columnCount: number, columnGapMm: number): number {
  const safeColumnCount = Math.max(1, Math.floor(columnCount));
  if (safeColumnCount === 1) {
    return contentWidthMm;
  }

  const totalGapMm = Math.max(0, safeColumnCount - 1) * Math.max(0, columnGapMm);
  return Math.max(40, (contentWidthMm - totalGapMm) / safeColumnCount);
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

function applyTextInsets(blockStyles: BlockStyleContract, settings: StyleSettings): void {
  const { textInsetLeft, textInsetRight } = settings.blockSpacing;

  blockStyles.heading1.insetLeft = textInsetLeft;
  blockStyles.heading1.insetRight = textInsetRight;
  blockStyles.heading2.insetLeft = textInsetLeft;
  blockStyles.heading2.insetRight = textInsetRight;
  blockStyles.heading3.insetLeft = textInsetLeft;
  blockStyles.heading3.insetRight = textInsetRight;
  blockStyles.paragraph.insetLeft = textInsetLeft;
  blockStyles.paragraph.insetRight = textInsetRight;
}

function applyBlockSpacing(blockStyles: BlockStyleContract, settings: StyleSettings): void {
  const spacing = settings.blockSpacing;

  blockStyles.heading1.marginTop = spacing.heading1SpaceBefore;
  blockStyles.heading1.marginBottom = spacing.heading1SpaceAfter;
  blockStyles.heading2.marginTop = spacing.heading2SpaceBefore;
  blockStyles.heading2.marginBottom = spacing.heading2SpaceAfter;
  blockStyles.heading3.marginTop = spacing.heading3SpaceBefore;
  blockStyles.heading3.marginBottom = spacing.heading3SpaceAfter;
  blockStyles.paragraph.marginTop = spacing.paragraphSpaceBefore;
  blockStyles.paragraph.marginBottom = spacing.paragraphSpaceAfter;
  blockStyles.list.marginTop = spacing.listSpaceBefore;
  blockStyles.list.marginBottom = spacing.listSpaceAfter;
  blockStyles.list.itemGap = spacing.listItemGap;
  blockStyles.blockquote.marginTop = spacing.blockquoteSpaceBefore;
  blockStyles.blockquote.marginBottom = spacing.blockquoteSpaceAfter;
  blockStyles.code.marginTop = spacing.codeSpaceBefore;
  blockStyles.code.marginBottom = spacing.codeSpaceAfter;
  blockStyles.code.paddingX = spacing.codePaddingX;
  blockStyles.code.paddingY = spacing.codePaddingY;
  blockStyles.table.marginTop = spacing.tableSpaceBefore;
  blockStyles.table.marginBottom = spacing.tableSpaceAfter;
  blockStyles.table.cellPaddingX = spacing.tableCellPaddingX;
  blockStyles.table.cellPaddingY = spacing.tableCellPaddingY;
  blockStyles.image.marginTop = spacing.imageSpaceBefore;
  blockStyles.image.marginBottom = spacing.imageSpaceAfter;
  blockStyles.horizontalRule.marginTop = spacing.ruleSpaceBefore;
  blockStyles.horizontalRule.marginBottom = spacing.ruleSpaceAfter;
  applyTextInsets(blockStyles, settings);
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
  const themeDefinition = themeDefinitions.find((item) => item.id === settings.themeId) ?? themeDefinitions[0];
  const themeLabel = themeDefinition?.name ?? '默认主题';
  const templateThemeLabel = `${templateLabel} · ${themeLabel}`;
  const marginLabel =
    settings.marginMode === 'custom'
      ? `自定义 ${marginsMm.top}/${marginsMm.right}/${marginsMm.bottom}/${marginsMm.left} mm`
      : (marginPresetDefinitions.find((item) => item.id === settings.marginPreset)?.label ?? '普通');

  const contentWidthMm = Math.max(60, widthMm - marginsMm.left - marginsMm.right);
  const contentHeightMm = Math.max(
    80,
    heightMm - marginsMm.top - marginsMm.bottom - headerReservedMm - footerReservedMm,
  );
  const columnCount = settings.columns.count;
  const columnGapMm = columnCount > 1 ? settings.columns.gapMm : 0;
  const singleColumnContentWidthMm = resolveSingleColumnWidthMm(contentWidthMm, columnCount, columnGapMm);
  const singleColumnContentWidthPx = mmToPx(singleColumnContentWidthMm);
  const columnPageCapacityPx = mmToPx(contentHeightMm) * columnCount;

  const contract: ResolvedStyleContract = {
    pageSize: settings.pageSize,
    orientation: settings.orientation,
    templateId: settings.templateId,
    themeId: settings.themeId,
    pageLabel: `${definition.label} / ${settings.orientation === 'portrait' ? '纵向' : '横向'}`,
    templateLabel,
    themeLabel,
    templateThemeLabel,
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
    columnCount,
    columnGapMm,
    columnGapPx: mmToPx(columnGapMm),
    columnDivider: settings.columns.divider,
    headingsSpanAll: settings.columns.headingsSpanAll,
    singleColumnContentWidthMm,
    singleColumnContentWidthPx,
    columnPageCapacityPx,
    blockStyles: cloneBlockStyles(defaultBlockStyles),
    themeTokens: cloneThemeTokens(themeDefinition.tokens),
    themeLayoutMetrics: cloneThemeLayoutMetrics(themeDefinition.layoutMetrics),
    pageBackground: { ...settings.pageBackground },
    paginationBehavior: { ...settings.paginationBehavior },
  };

  applyTemplate(contract.blockStyles, settings.templateId);
  applyBlockSpacing(contract.blockStyles, settings);
  applyPaginationBehavior(contract);

  return contract;
}
