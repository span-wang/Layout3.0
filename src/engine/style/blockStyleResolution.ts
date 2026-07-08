import {
  isCoveredTableCell,
  type LayoutBlock,
  type LayoutStyleSheet,
} from '@/engine/document-model';
import {
  getEffectiveListItemMaxFontSize,
  getEffectiveTableCellMaxFontSize,
  getEffectiveTextRunsMaxFontSize,
  resolveEffectiveTextLineHeight,
} from './quickTextStyle';
import {
  resolveEffectiveBlockStyleOverrides,
  resolveQuickBlockStyleForBlock,
} from './quickBlockStyle';
import type { ResolvedStyleContract } from './types';
import { resolveAssetSrc } from '@/utils/filePath';

export interface BlockDefaultTextMetrics {
  fontSize: number;
  lineHeight: number;
  spaceBefore: number;
  spaceAfter: number;
}

function hasBlockStyleOverrides(block: LayoutBlock): boolean {
  return Object.values(block.blockStyleOverrides).some((value) => value !== undefined);
}

function escapeCssUrl(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function resolveUserPageBackgroundVariables(contract: ResolvedStyleContract): Record<string, string> {
  const background = contract.pageBackground;

  if (background.mode === 'color') {
    return {
      '--page-user-background-color': background.color,
      '--page-user-background-image': 'none',
      '--page-user-background-size': 'auto',
      '--page-user-background-repeat': 'repeat',
      '--page-user-background-position': 'center',
    };
  }

  if (background.mode === 'image' && background.imageSrc.trim()) {
    const resolvedSrc = resolveAssetSrc(background.imageSrc);
    const backgroundSize = background.imageFit === 'cover'
      ? 'cover'
      : background.imageFit === 'contain'
        ? 'contain'
        : 'auto';

    return {
      // 用户背景是主题背景之上的显式覆盖层，预览和导出都通过这些变量压过主题纹理。
      '--page-user-background-color': background.color,
      '--page-user-background-image': `url("${escapeCssUrl(resolvedSrc)}")`,
      '--page-user-background-size': backgroundSize,
      '--page-user-background-repeat': background.imageFit === 'repeat' ? 'repeat' : 'no-repeat',
      '--page-user-background-position': 'center',
    };
  }

  return {
    '--page-user-background-color': themeSafeBackground(contract),
    '--page-user-background-image': 'var(--page-surface-pattern, none)',
    '--page-user-background-size': 'var(--page-surface-pattern-size, 24px 24px)',
    '--page-user-background-repeat': 'repeat',
    '--page-user-background-position': 'left top',
  };
}

function themeSafeBackground(contract: ResolvedStyleContract): string {
  return contract.themeTokens.pageBackground;
}

export function resolvePageBackgroundOverride(contract: ResolvedStyleContract): {
  color: string;
  image: string;
  size: string;
  repeat: string;
  position: string;
} | null {
  const background = contract.pageBackground;
  if (background.mode === 'theme' || (background.mode === 'image' && !background.imageSrc.trim())) {
    return null;
  }

  return {
    color: 'var(--page-user-background-color)',
    image: 'var(--page-user-background-image)',
    size: 'var(--page-user-background-size)',
    repeat: 'var(--page-user-background-repeat)',
    position: 'var(--page-user-background-position)',
  };
}

// 预览、导出和右侧说明都统一从这一份模板/主题基线变量取值，避免三处各写一套默认值。
export function buildPageStyleVariables(contract: ResolvedStyleContract): Record<string, string> {
  const { blockStyles, themeTokens, themeLayoutMetrics } = contract;

  return {
    '--page-surface-bg': themeTokens.pageBackground,
    '--page-surface-border': themeTokens.pageBorderColor,
    '--page-surface-shadow': themeTokens.pageShadow,
    '--page-surface-top-band': themeTokens.pageTopBandColor,
    '--page-surface-pattern': themeTokens.pagePattern,
    '--page-surface-pattern-size': themeTokens.pagePatternSize,
    ...resolveUserPageBackgroundVariables(contract),
    '--page-heading-font-family': themeTokens.headingFontFamily,
    '--page-body-font-family': themeTokens.bodyFontFamily,
    '--page-header-bg': themeTokens.headerBackground,
    '--page-footer-bg': themeTokens.footerBackground,
    '--page-header-footer-text': themeTokens.headerFooterText,
    '--page-header-border': themeTokens.headerBorderColor,
    '--page-footer-border': themeTokens.footerBorderColor,
    '--page-body-outline': themeTokens.bodyOutlineColor,
    '--page-column-count': String(contract.columnCount),
    '--page-column-gap': `${contract.columnGapPx}px`,
    '--page-column-rule-width': contract.columnDivider && contract.columnCount > 1 ? '1px' : '0px',
    '--page-column-rule-color': themeTokens.bodyOutlineColor,
    '--page-column-single-width': `${contract.singleColumnContentWidthPx}px`,
    '--page-content-height': `${contract.contentHeightPx}px`,
    '--page-heading1-color': themeTokens.heading1Color,
    '--page-heading1-rule': themeTokens.heading1RuleColor,
    '--page-heading2-color': themeTokens.heading2Color,
    '--page-heading2-marker': themeTokens.heading2MarkerColor,
    '--page-heading3-color': themeTokens.heading3Color,
    '--page-paragraph-color': themeTokens.paragraphColor,
    '--page-muted-text': themeTokens.mutedTextColor,
    '--page-list-marker': themeTokens.listMarkerColor,
    '--page-task-checkbox': themeTokens.taskCheckboxColor,
    '--page-blockquote-bg': themeTokens.blockquoteBackground,
    '--page-blockquote-border': themeTokens.blockquoteBorderColor,
    '--page-blockquote-text': themeTokens.blockquoteTextColor,
    '--page-code-bg': themeTokens.codeBackground,
    '--page-code-border': themeTokens.codeBorderColor,
    '--page-code-text': themeTokens.codeTextColor,
    '--page-table-border': themeTokens.tableBorderColor,
    '--page-table-header-bg': themeTokens.tableHeaderBackground,
    '--page-table-header-text': themeTokens.tableHeaderTextColor,
    '--page-rule-color': themeTokens.ruleColor,
    '--page-break-line': themeTokens.pageBreakLineColor,
    '--page-break-bg': themeTokens.pageBreakBackground,
    '--page-break-border': themeTokens.pageBreakBorderColor,
    '--page-break-text': themeTokens.pageBreakTextColor,
    '--page-image-caption-color': themeTokens.imageCaptionColor,
    '--page-heading1-font-size': `${blockStyles.heading1.fontSize}px`,
    '--page-heading1-line-height': `${blockStyles.heading1.lineHeight}px`,
    '--page-heading1-margin-top': `${blockStyles.heading1.marginTop}px`,
    '--page-heading1-margin-bottom': `${blockStyles.heading1.marginBottom}px`,
    '--page-heading1-inset-left': `${blockStyles.heading1.insetLeft}px`,
    '--page-heading1-inset-right': `${blockStyles.heading1.insetRight}px`,
    '--page-heading1-decoration-padding-bottom': `${themeLayoutMetrics.heading1.paddingBottom}px`,
    '--page-heading1-decoration-underline-height': `${themeLayoutMetrics.heading1.underlineHeight}px`,
    '--page-heading1-decoration-underline-gap': `${themeLayoutMetrics.heading1.underlineGap}px`,
    '--page-heading1-decoration-marker-inset-left': `${themeLayoutMetrics.heading1.markerInsetLeft}px`,
    '--page-heading1-decoration-underline-flow': themeLayoutMetrics.heading1.underlineOccupiesFlow ? '1' : '0',
    '--page-heading2-font-size': `${blockStyles.heading2.fontSize}px`,
    '--page-heading2-line-height': `${blockStyles.heading2.lineHeight}px`,
    '--page-heading2-margin-top': `${blockStyles.heading2.marginTop}px`,
    '--page-heading2-margin-bottom': `${blockStyles.heading2.marginBottom}px`,
    '--page-heading2-inset-left': `${blockStyles.heading2.insetLeft}px`,
    '--page-heading2-inset-right': `${blockStyles.heading2.insetRight}px`,
    '--page-heading2-decoration-padding-bottom': `${themeLayoutMetrics.heading2.paddingBottom}px`,
    '--page-heading2-decoration-underline-height': `${themeLayoutMetrics.heading2.underlineHeight}px`,
    '--page-heading2-decoration-underline-gap': `${themeLayoutMetrics.heading2.underlineGap}px`,
    '--page-heading2-decoration-marker-inset-left': `${themeLayoutMetrics.heading2.markerInsetLeft}px`,
    '--page-heading2-decoration-underline-flow': themeLayoutMetrics.heading2.underlineOccupiesFlow ? '1' : '0',
    '--page-heading3-font-size': `${blockStyles.heading3.fontSize}px`,
    '--page-heading3-line-height': `${blockStyles.heading3.lineHeight}px`,
    '--page-heading3-margin-top': `${blockStyles.heading3.marginTop}px`,
    '--page-heading3-margin-bottom': `${blockStyles.heading3.marginBottom}px`,
    '--page-heading3-inset-left': `${blockStyles.heading3.insetLeft}px`,
    '--page-heading3-inset-right': `${blockStyles.heading3.insetRight}px`,
    '--page-heading3-decoration-padding-bottom': `${themeLayoutMetrics.heading3.paddingBottom}px`,
    '--page-heading3-decoration-underline-height': `${themeLayoutMetrics.heading3.underlineHeight}px`,
    '--page-heading3-decoration-underline-gap': `${themeLayoutMetrics.heading3.underlineGap}px`,
    '--page-heading3-decoration-marker-inset-left': `${themeLayoutMetrics.heading3.markerInsetLeft}px`,
    '--page-heading3-decoration-underline-flow': themeLayoutMetrics.heading3.underlineOccupiesFlow ? '1' : '0',
    '--page-paragraph-font-size': `${blockStyles.paragraph.fontSize}px`,
    '--page-paragraph-line-height': `${blockStyles.paragraph.lineHeight}px`,
    '--page-paragraph-margin-top': `${blockStyles.paragraph.marginTop}px`,
    '--page-paragraph-margin-bottom': `${blockStyles.paragraph.marginBottom}px`,
    '--page-paragraph-inset-left': `${blockStyles.paragraph.insetLeft}px`,
    '--page-paragraph-inset-right': `${blockStyles.paragraph.insetRight}px`,
    '--page-list-font-size': `${blockStyles.list.fontSize}px`,
    '--page-list-line-height': `${blockStyles.list.lineHeight}px`,
    '--page-list-margin-top': `${blockStyles.list.marginTop}px`,
    '--page-list-margin-bottom': `${blockStyles.list.marginBottom}px`,
    '--page-list-indent': `${blockStyles.list.indent}px`,
    '--page-list-item-gap': `${blockStyles.list.itemGap}px`,
    '--page-blockquote-margin-top': `${blockStyles.blockquote.marginTop}px`,
    '--page-blockquote-margin-bottom': `${blockStyles.blockquote.marginBottom}px`,
    '--page-code-font-size': `${blockStyles.code.fontSize}px`,
    '--page-code-line-height': `${blockStyles.code.lineHeight}px`,
    '--page-code-margin-top': `${blockStyles.code.marginTop}px`,
    '--page-code-margin-bottom': `${blockStyles.code.marginBottom}px`,
    '--page-code-padding-x': `${blockStyles.code.paddingX}px`,
    '--page-code-padding-y': `${blockStyles.code.paddingY}px`,
    '--page-table-margin-top': `${blockStyles.table.marginTop}px`,
    '--page-table-margin-bottom': `${blockStyles.table.marginBottom}px`,
    '--page-table-row-height': `${blockStyles.table.rowHeight}px`,
    '--page-table-header-row-height': `${blockStyles.table.headerRowHeight}px`,
    '--page-table-cell-padding-x': `${blockStyles.table.cellPaddingX}px`,
    '--page-table-cell-padding-y': `${blockStyles.table.cellPaddingY}px`,
    '--page-rule-margin-top': `${blockStyles.horizontalRule.marginTop}px`,
    '--page-rule-margin-bottom': `${blockStyles.horizontalRule.marginBottom}px`,
    '--page-rule-stroke-width': `${blockStyles.horizontalRule.strokeWidth}px`,
    '--page-image-margin-top': `${blockStyles.image.marginTop}px`,
    '--page-image-margin-bottom': `${blockStyles.image.marginBottom}px`,
    '--page-image-caption-gap': `${blockStyles.image.captionGap}px`,
  };
}

export function resolveBlockDefaultTextMetrics(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
): BlockDefaultTextMetrics {
  if (block.type === 'heading' && block.metadata.kind === 'heading') {
    const blockStyle =
      block.metadata.depth === 1
        ? contract.blockStyles.heading1
        : block.metadata.depth === 2
          ? contract.blockStyles.heading2
          : contract.blockStyles.heading3;

    return {
      fontSize: blockStyle.fontSize,
      lineHeight: blockStyle.lineHeight,
      spaceBefore: blockStyle.marginTop,
      spaceAfter: blockStyle.marginBottom,
    };
  }

  if (block.type === 'code') {
    return {
      fontSize: contract.blockStyles.code.fontSize,
      lineHeight: contract.blockStyles.code.lineHeight,
      spaceBefore: contract.blockStyles.code.marginTop,
      spaceAfter: contract.blockStyles.code.marginBottom,
    };
  }

  if (block.type === 'list') {
    return {
      fontSize: contract.blockStyles.list.fontSize,
      lineHeight: contract.blockStyles.list.lineHeight,
      spaceBefore: contract.blockStyles.list.marginTop,
      spaceAfter: contract.blockStyles.list.marginBottom,
    };
  }

  if (block.type === 'table') {
    return {
      fontSize: contract.blockStyles.paragraph.fontSize,
      lineHeight: contract.blockStyles.paragraph.lineHeight,
      spaceBefore: contract.blockStyles.table.marginTop,
      spaceAfter: contract.blockStyles.table.marginBottom,
    };
  }

  return {
    fontSize: contract.blockStyles.paragraph.fontSize,
    lineHeight: contract.blockStyles.paragraph.lineHeight,
    spaceBefore: contract.blockStyles.paragraph.marginTop,
    spaceAfter: contract.blockStyles.paragraph.marginBottom,
  };
}

export function resolveBlockEffectiveTextMetrics(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet | null,
): BlockDefaultTextMetrics {
  const defaultMetrics = resolveBlockDefaultTextMetrics(block, contract);
  const effectiveBlockStyleOverrides = resolveEffectiveBlockStyleOverrides(block, styles);
  let effectiveFontSize = defaultMetrics.fontSize;

  if (
    (block.type === 'heading' ||
      block.type === 'paragraph' ||
      block.type === 'code') &&
    block.textRuns.length > 0
  ) {
    effectiveFontSize = getEffectiveTextRunsMaxFontSize({
      textRuns: block.textRuns,
      block,
      styles,
      fallback: defaultMetrics.fontSize,
    });
  }

  if (block.type === 'list' && block.metadata.kind === 'list') {
    effectiveFontSize = block.metadata.items.reduce(
      (maxFontSize, item) =>
        Math.max(
          maxFontSize,
          getEffectiveListItemMaxFontSize({
            item,
            block,
            styles,
            fallback: defaultMetrics.fontSize,
          }),
        ),
      defaultMetrics.fontSize,
    );
  }

  if (block.type === 'table' && block.metadata.kind === 'table') {
    effectiveFontSize = block.metadata.rows.reduce(
      (maxRowFontSize, row) =>
        Math.max(
          maxRowFontSize,
          row.cells.reduce((maxCellFontSize, cell) => {
            if (isCoveredTableCell(cell)) {
              return maxCellFontSize;
            }

            return Math.max(
              maxCellFontSize,
              getEffectiveTableCellMaxFontSize({
                cell,
                block,
                styles,
                fallback: defaultMetrics.fontSize,
              }),
            );
          }, defaultMetrics.fontSize),
        ),
      defaultMetrics.fontSize,
    );
  }

  return {
    ...defaultMetrics,
    lineHeight: resolveEffectiveTextLineHeight({
      fontSize: effectiveFontSize,
      baseFontSize: defaultMetrics.fontSize,
      baseLineHeight: effectiveBlockStyleOverrides.lineHeight ?? defaultMetrics.lineHeight,
    }),
  };
}

export function getBlockStyleSourceSummary(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
  styles?: LayoutStyleSheet | null,
): string {
  const baseLabel =
    contract.templateId === 'default' && contract.themeId === 'default'
      ? '默认基线'
      : `模板基线（${contract.templateThemeLabel}）`;
  const hasQuickRule = Object.values(resolveQuickBlockStyleForBlock(block, styles)).some((value) => value !== undefined);

  if (hasBlockStyleOverrides(block)) {
    return hasQuickRule
      ? `${baseLabel} + 同类块规则 + 当前块局部覆盖`
      : `${baseLabel} + 当前块局部覆盖`;
  }

  return hasQuickRule
    ? `${baseLabel} + 同类块规则`
    : `${baseLabel}（当前无局部覆盖）`;
}
