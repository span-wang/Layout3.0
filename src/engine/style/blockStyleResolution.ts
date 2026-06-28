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
import type { ResolvedStyleContract } from './types';

export interface BlockDefaultTextMetrics {
  fontSize: number;
  lineHeight: number;
  spaceBefore: number;
  spaceAfter: number;
}

function hasBlockStyleOverrides(block: LayoutBlock): boolean {
  return Object.values(block.blockStyleOverrides).some((value) => value !== undefined);
}

// 预览、导出和右侧说明都统一从这一份模板基线变量取值，避免三处各写一套默认值。
export function buildPageStyleVariables(contract: ResolvedStyleContract): Record<string, string> {
  const { blockStyles } = contract;

  return {
    '--page-heading1-font-size': `${blockStyles.heading1.fontSize}px`,
    '--page-heading1-line-height': `${blockStyles.heading1.lineHeight}px`,
    '--page-heading1-margin-top': `${blockStyles.heading1.marginTop}px`,
    '--page-heading1-margin-bottom': `${blockStyles.heading1.marginBottom}px`,
    '--page-heading1-inset-left': `${blockStyles.heading1.insetLeft}px`,
    '--page-heading1-inset-right': `${blockStyles.heading1.insetRight}px`,
    '--page-heading2-font-size': `${blockStyles.heading2.fontSize}px`,
    '--page-heading2-line-height': `${blockStyles.heading2.lineHeight}px`,
    '--page-heading2-margin-top': `${blockStyles.heading2.marginTop}px`,
    '--page-heading2-margin-bottom': `${blockStyles.heading2.marginBottom}px`,
    '--page-heading2-inset-left': `${blockStyles.heading2.insetLeft}px`,
    '--page-heading2-inset-right': `${blockStyles.heading2.insetRight}px`,
    '--page-heading3-font-size': `${blockStyles.heading3.fontSize}px`,
    '--page-heading3-line-height': `${blockStyles.heading3.lineHeight}px`,
    '--page-heading3-margin-top': `${blockStyles.heading3.marginTop}px`,
    '--page-heading3-margin-bottom': `${blockStyles.heading3.marginBottom}px`,
    '--page-heading3-inset-left': `${blockStyles.heading3.insetLeft}px`,
    '--page-heading3-inset-right': `${blockStyles.heading3.insetRight}px`,
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
      baseLineHeight: block.blockStyleOverrides.lineHeight ?? defaultMetrics.lineHeight,
    }),
  };
}

export function getBlockStyleSourceSummary(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
): string {
  const baseLabel =
    contract.templateId === 'default'
      ? '默认基线'
      : `模板基线（${contract.templateLabel}）`;

  return hasBlockStyleOverrides(block)
    ? `${baseLabel} + 当前块局部覆盖`
    : `${baseLabel}（当前无局部覆盖）`;
}
