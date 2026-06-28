import {
  applyPageNumbersToTocItems,
  buildHeadingPageNumberMap,
  buildTocItems,
  getHeadingText,
  getImageWrapClassName,
  getTocBlockDisplayTitle,
  getVisibleTocItemsForBlock,
  isCoveredTableCell,
  resolveImageLayout,
  resolveImageRenderMetrics,
  resolveHangingIndentStyle,
  isImageTextWrapMode,
  buildLayoutListTree,
  getLayoutListItemLevel,
  shouldHideLayoutListItemMarker,
  resolveTableColumnWidths,
  type LayoutBlock,
  type LayoutStyleSheet,
  type LayoutResource,
  type LayoutListTreeNode,
  type LayoutListItem,
  type TextRun,
  type TableBlockMetadata,
} from '@/engine/document-model';
import { renderEquationToHtml, splitInlineEquations, renderInlineEquationToHtml } from '@/engine/document-model/equation';
import type { PageLayout } from '@/engine/typesetting/types';
import { buildFontFaceCss } from '@/engine/document-model/fontResources';
import {
  resolveQuickTextStyleForBlock,
  resolveQuickTextStyleForRun,
} from '@/engine/style/quickTextStyle';
import {
  buildPageStyleVariables,
  resolveBlockDefaultTextMetrics,
  resolveBlockEffectiveTextMetrics,
} from '@/engine/style/blockStyleResolution';
import { shouldLayoutBlockSpanAllColumns } from '@/engine/style/columnLayout';
import { renderHeaderFooterContent } from '@/engine/style/headerFooterContent';
import { defaultStyleSettings } from '@/engine/style/presets';
import type { HeaderFooterContent, ResolvedStyleContract, StyleSettings } from '@/engine/style/types';
import { resolveAssetSrc } from '@/utils/filePath';

export interface PdfExportPayload {
  pages: PageLayout[];
  title: string;
  resources?: LayoutResource[];
  styles?: LayoutStyleSheet;
  styleSettings?: StyleSettings;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildTextRunStyle(run: TextRun, inheritedStyle = {}): string {
  const resolvedStyle = resolveQuickTextStyleForRun(run, inheritedStyle);
  const declarations = [
    resolvedStyle.color ? `color:${resolvedStyle.color}` : '',
    resolvedStyle.highlightColor
      ? `background-color:${resolvedStyle.highlightColor}`
      : resolvedStyle.backgroundColor
        ? `background-color:${resolvedStyle.backgroundColor}`
        : '',
    run.marks.some((mark) => mark.type === 'italic') ? `font-style:italic` : '',
    resolvedStyle.fontFamily ? `font-family:${resolvedStyle.fontFamily}` : '',
    resolvedStyle.fontSize ? `font-size:${resolvedStyle.fontSize}px` : '',
    resolvedStyle.letterSpacing ? `letter-spacing:${resolvedStyle.letterSpacing}px` : '',
  ].filter(Boolean);

  return declarations.length > 0 ? ` style="${escapeHtml(declarations.join(';'))}"` : '';
}

function resolveBlockLineHeightStyle(
  block: LayoutBlock,
  contract: ResolvedStyleContract | undefined,
  styles?: LayoutStyleSheet,
): number | undefined {
  if (!contract) {
    return block.blockStyleOverrides.lineHeight;
  }

  const defaultMetrics = resolveBlockDefaultTextMetrics(block, contract);
  const effectiveMetrics = resolveBlockEffectiveTextMetrics(block, contract, styles);
  const renderedBaseLineHeight = block.blockStyleOverrides.lineHeight ?? defaultMetrics.lineHeight;

  // 导出和画布共用同一条安全线高规则，避免大字号在 PDF 页底被裁掉。
  if (effectiveMetrics.lineHeight > renderedBaseLineHeight) {
    return effectiveMetrics.lineHeight;
  }

  return block.blockStyleOverrides.lineHeight;
}

function buildBlockStyle(
  block: LayoutBlock,
  styles?: LayoutStyleSheet,
  contract?: ResolvedStyleContract,
): string {
  const supportsBlockIndent = block.type === 'heading' || block.type === 'paragraph';
  const indentStyle = supportsBlockIndent ? resolveHangingIndentStyle(block.blockStyleOverrides) : null;
  const textIndent = indentStyle ? indentStyle.textIndent : block.blockStyleOverrides.firstLineIndent;
  const lineHeight = resolveBlockLineHeightStyle(block, contract, styles);
  const hasLeftIndentOverride =
    block.blockStyleOverrides.indentLeft !== undefined || block.blockStyleOverrides.hangingIndent !== undefined;
  const hasRightIndentOverride = block.blockStyleOverrides.indentRight !== undefined;
  const hasTextIndentOverride =
    block.blockStyleOverrides.firstLineIndent !== undefined || block.blockStyleOverrides.hangingIndent !== undefined;
  const declarations = [
    block.blockStyleOverrides.textAlign ? `text-align:${block.blockStyleOverrides.textAlign}` : '',
    lineHeight ? `line-height:${lineHeight}px` : '',
    block.blockStyleOverrides.spaceBefore !== undefined ? `margin-top:${block.blockStyleOverrides.spaceBefore}px` : '',
    block.blockStyleOverrides.spaceAfter !== undefined ? `margin-bottom:${block.blockStyleOverrides.spaceAfter}px` : '',
    indentStyle && hasLeftIndentOverride ? `padding-left:${indentStyle.paddingLeft}px` : '',
    indentStyle && hasRightIndentOverride ? `padding-right:${indentStyle.paddingRight}px` : '',
    hasTextIndentOverride && textIndent !== undefined ? `text-indent:${textIndent}px` : '',
    block.blockStyleOverrides.backgroundColor ? `background-color:${block.blockStyleOverrides.backgroundColor}` : '',
  ].filter(Boolean);

  return declarations.length > 0 ? ` style="${escapeHtml(declarations.join(';'))}"` : '';
}

function renderInlineText(text: string): string {
  // 分割普通文本和行内公式
  const fragments = splitInlineEquations(text);

  return fragments
    .map((fragment) => {
      if (fragment.type === 'equation') {
        // 行内公式：不进行 HTML 转义，直接渲染
        return renderInlineEquationToHtml(fragment.content);
      }
      // 普通文本：HTML 转义 + 处理换行
      return escapeHtml(fragment.content).replaceAll('\n', '<br />');
    })
    .join('');
}

function applyMarks(content: string, run: TextRun): string {
  return run.marks.reduce((currentHtml, mark) => {
    switch (mark.type) {
      case 'bold':
        return `<strong>${currentHtml}</strong>`;
      case 'italic':
        return `<em>${currentHtml}</em>`;
      case 'underline':
        return `<u>${currentHtml}</u>`;
      case 'strike':
        return `<s>${currentHtml}</s>`;
      case 'code':
        return `<code>${currentHtml}</code>`;
      case 'link':
        return `<a href="${escapeHtml(mark.href ?? '#')}" target="_blank" rel="noreferrer">${currentHtml}</a>`;
      default:
        return currentHtml;
    }
  }, content);
}

function renderTextRuns(textRuns: TextRun[], inheritedStyle = {}): string {
  return textRuns
    .map((run) => {
      const fragments = splitInlineEquations(run.text);
      const content = fragments
        .map((fragment) => {
          if (fragment.type === 'equation') {
            // 行内公式：不应用 marks，保持数学格式
            return renderInlineEquationToHtml(fragment.content);
          }
          // 普通文本：HTML 转义 + 处理换行 + 应用 marks
          const escaped = escapeHtml(fragment.content).replaceAll('\n', '<br />');
          return applyMarks(escaped, run);
        })
        .join('');
      return `<span${buildTextRunStyle(run, inheritedStyle)}>${content}</span>`;
    })
    .join('');
}

function buildTableCellStyle(align: 'left' | 'center' | 'right' | null | undefined, widthPx?: number, minHeightPx?: number): string {
  const styles: string[] = [];
  if (align) {
    styles.push(`text-align:${align}`);
  }
  if (widthPx) {
    styles.push(`min-width:${widthPx}px`);
  }
  if (minHeightPx) {
    styles.push(`min-height:${minHeightPx}px`);
  }
  return styles.length > 0 ? ` style="${escapeHtml(styles.join(';'))}"` : '';
}

function isHeaderLikeTableRow(row: TableBlockMetadata['rows'][number], rowIndex: number): boolean {
  return rowIndex === 0 || row.cells.some((cell) => cell.isHeader);
}

function getTableRowBaseHeightPx(
  row: TableBlockMetadata['rows'][number],
  rowIndex: number,
  contract: ResolvedStyleContract | undefined,
): number {
  if (!contract) {
    return isHeaderLikeTableRow(row, rowIndex) ? 44 : 40;
  }

  return isHeaderLikeTableRow(row, rowIndex)
    ? contract.blockStyles.table.headerRowHeight
    : contract.blockStyles.table.rowHeight;
}

function renderListItemContent(item: LayoutListItem, inheritedStyle = {}): string {
  const shouldHideMarker = shouldHideLayoutListItemMarker(item);
  const listItemClasses = [
    item.checked === null ? '' : 'task-list-item',
    shouldHideMarker ? 'list-item-marker-hidden' : '',
  ].filter(Boolean);
  const listItemClass = listItemClasses.length > 0 ? ` class="${listItemClasses.join(' ')}"` : '';
  const markerHiddenAttribute = shouldHideMarker ? ' data-list-marker-hidden="true"' : '';
  const checkedMark =
    item.checked === null || shouldHideMarker
      ? ''
      : `<span class="task-list-checkbox">${item.checked ? '☑' : '☐'}</span>`;
  return `<li${listItemClass} data-list-level="${getLayoutListItemLevel(item)}"${markerHiddenAttribute}>${checkedMark}${renderTextRuns(item.textRuns, inheritedStyle)}`;
}

function renderListTreeNodes(
  nodes: LayoutListTreeNode[],
  ordered: boolean,
  start: number | null,
  inheritedStyle = {},
  isRoot = false,
): string {
  const tagName = ordered ? 'ol' : 'ul';
  const startAttribute = ordered && start !== null && isRoot ? ` start="${start}"` : '';
  const childrenHtml = nodes
    .map((node) => {
      const nestedListHtml = node.children.length > 0
        ? renderListTreeNodes(node.children, ordered, null, inheritedStyle)
        : '';
      return `${renderListItemContent(node.item, inheritedStyle)}${nestedListHtml}</li>`;
    })
    .join('');

  return `<${tagName}${startAttribute}>${childrenHtml}</${tagName}>`;
}

function renderBlock(
  block: LayoutBlock,
  styles?: LayoutStyleSheet,
  contract?: ResolvedStyleContract,
): string {
  const inheritedStyle = resolveQuickTextStyleForBlock(block, styles);
  switch (block.type) {
    case 'pageBreak':
      return '';
    case 'columnBreak':
      return '<div class="column-break-marker"><span class="column-break-marker-line" aria-hidden="true"></span><span class="column-break-marker-label">分栏断点</span><span class="column-break-marker-line" aria-hidden="true"></span></div>';
    case 'heading': {
      const tagName =
        block.metadata.kind === 'heading' && block.metadata.depth === 1
          ? 'h1'
          : block.metadata.kind === 'heading' && block.metadata.depth === 2
            ? 'h2'
            : block.metadata.kind === 'heading' && block.metadata.depth === 3
            ? 'h3'
            : 'h4';
      const className = shouldLayoutBlockSpanAllColumns(block, contract) ? ' class="column-span-all"' : '';
      return `<${tagName}${className}${buildBlockStyle(block, styles, contract)}>${renderTextRuns(block.textRuns, inheritedStyle)}</${tagName}>`;
    }
    case 'toc':
      return '';
    case 'paragraph':
      return `<p${buildBlockStyle(block, styles, contract)}>${renderTextRuns(block.textRuns, inheritedStyle)}</p>`;
    case 'list': {
      if (block.metadata.kind !== 'list') {
        return '';
      }
      const rootListHtml = renderListTreeNodes(
        buildLayoutListTree(block.metadata.items),
        block.metadata.ordered,
        block.metadata.start,
        inheritedStyle,
        true,
      );
      return rootListHtml.replace(/^<(ol|ul)([^>]*)>/, `<$1$2${buildBlockStyle(block, styles, contract)}>`);
    }
    case 'blockquote':
      return block.metadata.kind === 'blockquote'
        ? `<blockquote>${block.metadata.blocks.map((nestedBlock) => renderBlock(nestedBlock, styles, contract)).join('')}</blockquote>`
        : '';
    case 'code':
      return `<pre${buildBlockStyle(block, styles, contract)}><code>${renderTextRuns(block.textRuns, inheritedStyle)}</code></pre>`;
    case 'equation':
      return block.metadata.kind === 'equation'
        ? `<div class="equation-shell"${buildBlockStyle(block, styles, contract)}>${renderEquationToHtml(block.metadata.value).html}</div>`
        : '';
    case 'table':
      if (block.metadata.kind !== 'table') {
        return '';
      }
      const tableMeta = block.metadata as TableBlockMetadata;
      const columnCount = tableMeta.rows[0]?.cells.length ?? 0;
      const contentWidthPx = contract?.singleColumnContentWidthPx ?? contract?.contentWidthPx ?? 520;
      const columnWidths = resolveTableColumnWidths(tableMeta.columnWidthsPx, columnCount, contentWidthPx);
      // 导出表格必须保留原始列索引，不能用过滤后的可渲染单元格索引，否则合并单元格后的列宽会和预览分叉。
      const colgroupHtml = columnWidths
        .map((widthPx, columnIndex) => `<col style="width:${widthPx}px" data-column-index="${columnIndex}" />`)
        .join('');
      const tableRowsHtml = tableMeta.rows
        .map((row, rowIndex) => {
          const rowHeightPx = row.heightPx ?? getTableRowBaseHeightPx(row, rowIndex, contract);
          const rowCellsHtml = row.cells
            .map((cell, columnIndex) => {
              if (isCoveredTableCell(cell)) {
                return '';
              }

              const tagName = cell.isHeader ? 'th' : 'td';
              const colSpan = cell.colSpan && cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '';
              const rowSpan = cell.rowSpan && cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '';
              const widthPx = columnWidths[columnIndex];
              return `<${tagName}${buildTableCellStyle(tableMeta.align[columnIndex] ?? null, widthPx, rowHeightPx)}${colSpan}${rowSpan}><div class="table-cell-content">${renderTextRuns(cell.textRuns, inheritedStyle)}</div></${tagName}>`;
            })
            .join('');

          return `<tr style="height:${rowHeightPx}px">${rowCellsHtml}</tr>`;
        })
        .join('');
      return `<div class="table-shell"><table class="preview-table"${buildBlockStyle(block, styles, contract)}><colgroup>${colgroupHtml}</colgroup><tbody>${tableRowsHtml}</tbody></table></div>`;
    case 'image':
      if (block.metadata.kind !== 'image') {
        return '';
      }

      return renderImageBlock(block);
    case 'horizontalRule':
      return '<hr />';
    default:
      return '';
  }
}

function renderImageBlock(block: LayoutBlock): string {
  if (block.type !== 'image' || block.metadata.kind !== 'image') {
    return '';
  }

  const layout = resolveImageLayout(block.metadata);
  const offsetX = layout.offsetX ?? 0;
  const offsetY = layout.offsetY ?? 0;

  // 预览与导出统一使用同一套图片环绕语义，旧 block/center/left/right 只在解析层兼容。
  const wrapperStyleParts: string[] = [];
  if (layout.wrapMode === 'topBottom') {
    if (offsetX !== 0) {
      const widthPx = layout.widthPx ?? 320;
      wrapperStyleParts.push(`margin-left:calc(50% + ${offsetX}px - ${widthPx / 2}px)`);
    } else {
      wrapperStyleParts.push('margin-left:auto', 'margin-right:auto');
    }
  } else if (isImageTextWrapMode(layout.wrapMode)) {
    wrapperStyleParts.push(`float:${layout.wrapSide}`, 'clear:none');
    if (layout.wrapSide === 'left') {
      wrapperStyleParts.push('margin-right:16px');
    } else {
      wrapperStyleParts.push('margin-left:16px');
    }
  } else {
    // 嵌入型作为稳定图片块随文档流移动。
    if (offsetX > 0) {
      wrapperStyleParts.push(`margin-left:${offsetX}px`);
    } else if (offsetX < 0) {
      wrapperStyleParts.push(`margin-right:${Math.abs(offsetX)}px`);
    }
    if (offsetY > 0) {
      wrapperStyleParts.push(`margin-top:${offsetY}px`);
    }
  }

  const metrics = resolveImageRenderMetrics(layout);
  const viewportStyleParts = [
    metrics.visibleWidthPx ? `width:${metrics.visibleWidthPx}px` : '',
    metrics.visibleHeightPx ? `height:${metrics.visibleHeightPx}px` : '',
  ].filter(Boolean);
  const imageStyleParts = [
    metrics.fullWidthPx ? `width:${metrics.fullWidthPx}px` : '',
    metrics.fullHeightPx ? `height:${metrics.fullHeightPx}px` : '',
    metrics.fullWidthPx ? 'max-width:none' : '',
    metrics.fullHeightPx ? 'max-height:none' : '',
    metrics.cropLeftPx || metrics.cropTopPx
      ? `transform:translate(${-metrics.cropLeftPx}px, ${-metrics.cropTopPx}px)`
      : '',
  ].filter(Boolean);

  // 只有 showCaption 为 true 时才渲染标题区域
  const captionHtml = layout.showCaption
    ? `<figcaption>${escapeHtml(block.metadata.title || block.metadata.alt || '')}</figcaption>`
    : '';

  return `<figure class="image-shell ${escapeHtml(getImageWrapClassName(layout))}"${wrapperStyleParts.length > 0 ? ` style="${escapeHtml(wrapperStyleParts.join(';'))}"` : ''}>${
    block.metadata.src
      ? `<span class="image-viewport"${viewportStyleParts.length > 0 ? ` style="${escapeHtml(viewportStyleParts.join(';'))}"` : ''}><img class="preview-image preview-image-fit preview-image-cropped" src="${escapeHtml(resolveAssetSrc(block.metadata.src))}" alt="${escapeHtml(block.metadata.alt || '图片')}"${block.metadata.title ? ` title="${escapeHtml(block.metadata.title)}"` : ''}${imageStyleParts.length > 0 ? ` style="${escapeHtml(imageStyleParts.join(';'))}"` : ''} /></span>`
      : '<div class="preview-image placeholder">图片占位</div>'
  }${captionHtml}</figure>`;
}

function getPageMetrics(page: PageLayout) {
  const headerHeight = page.contract.marginsPx.top + page.contract.headerReservedPx;
  const footerHeight = page.contract.marginsPx.bottom + page.contract.footerReservedPx;

  return {
    pageWidthPx: page.contract.pageWidthPx,
    pageHeightPx: page.contract.pageHeightPx,
    headerHeight,
    footerHeight,
    paddingLeft: page.contract.marginsPx.left,
    paddingRight: page.contract.marginsPx.right,
  };
}

function renderPages(
  pages: PageLayout[],
  styles?: LayoutStyleSheet,
  headerFooterContent: HeaderFooterContent = defaultStyleSettings.headerFooterContent,
  documentTitle = '未命名文档',
): string {
  const allBlocks = pages.flatMap((page) => page.blocks);
  const tocItems = applyPageNumbersToTocItems(
    buildTocItems({
      version: '1.0.0',
      id: 'export-runtime-document',
      title: '',
      source: '',
      blocks: allBlocks,
      resources: [],
      styles: { blockStyles: {}, textStyles: {} },
      template: { templateId: null, templateOverrides: {} },
      viewState: { answerDisplayMode: 'show', zoom: 1, selectedNodeId: null },
      meta: {
        sourceFormat: 'markdown',
        wordCount: 0,
        characterCount: 0,
        blockCount: allBlocks.length,
        updatedAt: new Date(0).toISOString(),
      },
    }),
    buildHeadingPageNumberMap(pages),
  );

  return pages
    .map((page) => {
      const titleBlock = page.blocks.find((block) => block.type === 'heading');
      const pageTitle = titleBlock ? getHeadingText(titleBlock) || documentTitle : documentTitle;
      const metrics = getPageMetrics(page);
      const bodyParts: string[] = [];
      const renderedHeaderFooter = renderHeaderFooterContent(headerFooterContent, {
        documentTitle,
        pageTitle,
        pageNumber: page.pageNumber,
        totalPages: pages.length,
        contract: page.contract,
      });

      for (let index = 0; index < page.blocks.length; index += 1) {
      const block = page.blocks[index];
        if (block.type === 'toc' && block.metadata.kind === 'toc') {
          const visibleTocItems = getVisibleTocItemsForBlock(block, tocItems);
          const entries =
            visibleTocItems.length > 0
              ? visibleTocItems
                  .map(
                    (item) =>
                      `<div class="toc-entry-export" style="padding-left:${Math.max(0, item.depth - 1) * 16}px"><span class="toc-entry-export-text">${escapeHtml(item.text)}</span><span class="toc-entry-export-dots"></span><span class="toc-entry-export-page">${escapeHtml(String(item.pageNumber ?? '-'))}</span></div>`,
                  )
                  .join('')
              : '<div class="toc-empty-state-export">当前文档还没有符合当前目录层级的标题。</div>';

          bodyParts.push(`<section class="toc-block-export"${buildBlockStyle(block, styles, page.contract)}><div class="toc-block-export-title">${escapeHtml(getTocBlockDisplayTitle(block))}</div>${entries}</section>`);
          continue;
        }

        bodyParts.push(renderBlock(block, styles, page.contract));
      }

      const pageStyleDeclarations = [
        ...Object.entries(buildPageStyleVariables(page.contract)).map(([name, value]) => `${name}:${value}`),
        `--page-padding-left:${metrics.paddingLeft}px`,
        `--page-padding-right:${metrics.paddingRight}px`,
        `width:${metrics.pageWidthPx}px`,
        // 预览用固定页面高度配合正文裁切；导出这里也要显式锁住高度，避免打印自然回流把页脚继续往下顶。
        `height:${metrics.pageHeightPx}px`,
        `min-height:${metrics.pageHeightPx}px`,
        `grid-template-rows:${metrics.headerHeight}px 1fr ${metrics.footerHeight}px`,
      ].join(';');
      const pageBodyClassName = page.contract.columnCount > 1 ? 'page-body page-body-columns' : 'page-body';

      return `<section class="page" data-theme-id="${escapeHtml(page.contract.themeId)}" style="${escapeHtml(pageStyleDeclarations)}">
        <header class="page-header"><span>${escapeHtml(renderedHeaderFooter.header.left)}</span><span>${escapeHtml(renderedHeaderFooter.header.center)}</span><span>${escapeHtml(renderedHeaderFooter.header.right)}</span></header>
        <article class="${pageBodyClassName}">${bodyParts.join('')}</article>
        <footer class="page-footer"><span>${escapeHtml(renderedHeaderFooter.footer.left)}</span><span>${escapeHtml(renderedHeaderFooter.footer.center)}</span><span>${escapeHtml(renderedHeaderFooter.footer.right)}</span></footer>
      </section>`;
    })
    .join('');
}

export function buildExportHtml({ pages, title, resources, styles, styleSettings }: PdfExportPayload): string {
  const firstPage = pages[0];
  const pageSizeRule = firstPage
    ? `${firstPage.contract.pageWidthMm}mm ${firstPage.contract.pageHeightMm}mm`
    : '210mm 297mm';
  const fontFaceCss = buildFontFaceCss(resources);

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/katex.min.css" />
    <style>
      ${fontFaceCss}

      /* 行内公式样式：纯行内渲染，无特殊容器，字体大小与当前文字保持一致 */
      .inline-equation {
        display: inline;
        vertical-align: math;
        line-height: normal;
      }

      .inline-equation mrow {
        vertical-align: baseline;
      }

      .inline-equation .base {
        vertical-align: baseline;
      }

      .inline-equation .strut {
        display: inline-block;
      }

      :root {
        color: #1f2937;
        font-family: "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
        font-synthesis: weight style;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: #eef2f6;
      }

      .export-shell {
        padding: 24px 0;
      }

      .page {
        display: grid;
        position: relative;
        isolation: isolate;
        margin: 0 auto 24px;
        color: #1f2937;
        background-color: var(--page-surface-bg, #ffffff);
        background-image: var(--page-surface-pattern, none);
        background-size: var(--page-surface-pattern-size, 24px 24px);
        box-shadow: var(--page-surface-shadow, 0 12px 32px rgba(15, 23, 42, 0.10));
        border: 1px solid var(--page-surface-border, #d8e1e8);
        box-sizing: border-box;
      }

      .page:last-child {
        margin-bottom: 0;
      }

      .page::before {
        content: "";
        position: absolute;
        inset: 0 0 auto 0;
        height: 6px;
        background: var(--page-surface-top-band, transparent);
        z-index: 0;
      }

      .page-header,
      .page-body,
      .page-footer {
        position: relative;
        z-index: 1;
      }

      .toc-block-export {
        display: grid;
        gap: 10px;
        margin: 16px 0 24px;
        padding: 18px 20px;
        border: 1px solid #d8e1e8;
        border-radius: 12px;
        background: #fcfdff;
      }

      .toc-block-export-title {
        color: #1f2937;
        font-size: 18px;
        font-weight: 700;
      }

      .toc-entry-export {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 24px;
        color: #334155;
        font-size: 14px;
      }

      .toc-entry-export-text {
        flex: 0 1 auto;
      }

      .toc-entry-export-dots {
        flex: 1 1 auto;
        min-width: 12px;
        border-bottom: 1px dotted #c4ced8;
        transform: translateY(2px);
      }

      .toc-entry-export-page {
        flex: 0 0 auto;
        min-width: 20px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .toc-empty-state-export {
        color: #64748b;
        font-size: 13px;
      }

      .page-header,
      .page-footer {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
        gap: 12px;
        align-items: center;
        color: var(--page-header-footer-text, #6b7280);
        font-size: 12px;
      }

      .page-header span,
      .page-footer span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .page-header span:nth-child(2),
      .page-footer span:nth-child(2) {
        text-align: center;
      }

      .page-header span:nth-child(3),
      .page-footer span:nth-child(3) {
        text-align: right;
      }

      .page-header {
        padding: 0 24px;
        border-bottom: 1px solid var(--page-header-border, #edf1f5);
        background: var(--page-header-bg, linear-gradient(180deg, rgb(243 248 252 / 90%) 0%, rgb(255 255 255 / 65%) 100%));
      }

      .page-footer {
        padding: 0 24px;
        border-top: 1px solid var(--page-footer-border, #edf1f5);
        background: var(--page-footer-bg, linear-gradient(0deg, rgb(243 248 252 / 90%) 0%, rgb(255 255 255 / 65%) 100%));
      }

      .page-body {
        padding-top: 0;
        padding-bottom: 0;
        padding-left: var(--page-padding-left, ${firstPage ? `${firstPage.contract.marginsPx.left}px` : '56px'});
        padding-right: var(--page-padding-right, ${firstPage ? `${firstPage.contract.marginsPx.right}px` : '56px'});
        font-family: var(--page-body-font-family, inherit);
        outline: 1px dashed var(--page-body-outline, #e4ecf2);
        outline-offset: -1px;
        overflow: hidden;
      }

      .page-body.page-body-columns {
        column-count: var(--page-column-count, 1);
        column-gap: var(--page-column-gap, 0px);
        column-rule: var(--page-column-rule-width, 0px) solid var(--page-column-rule-color, #e4ecf2);
      }

      .page-body.page-body-columns > h1,
      .page-body.page-body-columns > h2,
      .page-body.page-body-columns > h3,
      .page-body.page-body-columns > h4,
      .page-body.page-body-columns > .toc-block-export,
      .page-body.page-body-columns > .table-shell,
      .page-body.page-body-columns > blockquote,
      .page-body.page-body-columns > pre,
      .page-body.page-body-columns > p,
      .page-body.page-body-columns > ul,
      .page-body.page-body-columns > ol,
      .page-body.page-body-columns > hr,
      .page-body.page-body-columns > .equation-shell {
        break-inside: avoid-column;
      }

      .page-body.page-body-columns > .column-span-all {
        column-span: all;
      }

      .page h1,
      .page h2,
      .page h3,
      .page h4,
      .page h5,
      .page h6 {
        font-family: var(--page-heading-font-family, inherit);
      }

      .page h1 {
        box-sizing: border-box;
        margin: var(--page-heading1-margin-top, 0px) 0 var(--page-heading1-margin-bottom, 28px);
        padding-left: var(--page-heading1-inset-left, 0px);
        padding-right: var(--page-heading1-inset-right, 0px);
        color: var(--page-heading1-color, #102a43);
        font-size: var(--page-heading1-font-size, 34px);
        line-height: var(--page-heading1-line-height, 40px);
        background-image: linear-gradient(var(--page-heading1-rule, transparent), var(--page-heading1-rule, transparent));
        background-repeat: no-repeat;
        background-position: left bottom;
        background-size: 100% 2px;
      }

      .page h2 {
        position: relative;
        box-sizing: border-box;
        margin: var(--page-heading2-margin-top, 28px) 0 var(--page-heading2-margin-bottom, 16px);
        padding-left: var(--page-heading2-inset-left, 0px);
        padding-right: var(--page-heading2-inset-right, 0px);
        color: var(--page-heading2-color, #12314e);
        font-size: var(--page-heading2-font-size, 24px);
        line-height: var(--page-heading2-line-height, 32px);
      }

      .page h2::before {
        content: "";
        position: absolute;
        left: -14px;
        top: 6px;
        bottom: 6px;
        width: 4px;
        border-radius: 999px;
        background: var(--page-heading2-marker, transparent);
      }

      .page h3 {
        box-sizing: border-box;
        margin: var(--page-heading3-margin-top, 24px) 0 var(--page-heading3-margin-bottom, 12px);
        padding-left: var(--page-heading3-inset-left, 0px);
        padding-right: var(--page-heading3-inset-right, 0px);
        color: var(--page-heading3-color, #12314e);
        font-size: var(--page-heading3-font-size, 20px);
        line-height: var(--page-heading3-line-height, 28px);
      }

      .page h4,
      .page h5,
      .page h6 {
        box-sizing: border-box;
        margin: var(--page-heading3-margin-top, 24px) 0 var(--page-heading3-margin-bottom, 12px);
        padding-left: var(--page-heading3-inset-left, 0px);
        padding-right: var(--page-heading3-inset-right, 0px);
        color: var(--page-heading3-color, #12314e);
        font-size: var(--page-paragraph-font-size, 16px);
        line-height: var(--page-paragraph-line-height, 28px);
      }

      p, li {
        color: var(--page-paragraph-color, #344054);
        font-size: var(--page-paragraph-font-size, 16px);
        line-height: var(--page-paragraph-line-height, 28px);
      }

      p {
        box-sizing: border-box;
        margin: var(--page-paragraph-margin-top, 0px) 0 var(--page-paragraph-margin-bottom, 16px);
        padding-left: var(--page-paragraph-inset-left, 0px);
        padding-right: var(--page-paragraph-inset-right, 0px);
      }

      ul, ol {
        margin: var(--page-list-margin-top, 0px) 0 var(--page-list-margin-bottom, 16px);
        padding-left: var(--page-list-indent, 24px);
        font-size: var(--page-list-font-size, 16px);
        line-height: var(--page-list-line-height, 28px);
      }

      ul > li + li,
      ol > li + li {
        margin-top: var(--page-list-item-gap, 8px);
      }

      ul li::marker,
      ol li::marker {
        color: var(--page-list-marker, currentColor);
      }

      li.task-list-item {
        list-style: none;
      }

      li.list-item-marker-hidden {
        list-style: none;
      }

      .task-list-checkbox {
        display: inline-block;
        width: 18px;
        min-width: 18px;
        color: var(--page-task-checkbox, #0d5663);
        font-weight: 700;
      }

      blockquote {
        margin: var(--page-blockquote-margin-top, 20px) 0 var(--page-blockquote-margin-bottom, 20px);
        padding: 4px 0 4px 16px;
        color: var(--page-blockquote-text, #344054);
        background: var(--page-blockquote-bg, transparent);
        border-left: 4px solid var(--page-blockquote-border, #b8d8dc);
        border-radius: 12px;
      }

      pre {
        margin: var(--page-code-margin-top, 20px) 0 var(--page-code-margin-bottom, 20px);
        padding: var(--page-code-padding-y, 14px) var(--page-code-padding-x, 16px);
        color: var(--page-code-text, #d7e3f4);
        font-size: var(--page-code-font-size, 14px);
        line-height: var(--page-code-line-height, 24px);
        background: var(--page-code-bg, #173047);
        border: 1px solid var(--page-code-border, transparent);
        border-radius: 12px;
        white-space: pre-wrap;
      }

      .table-shell {
        max-width: 100%;
        overflow: hidden;
        margin: var(--page-table-margin-top, 20px) 0 var(--page-table-margin-bottom, 20px);
        font-size: var(--page-paragraph-font-size, 16px);
        line-height: var(--page-paragraph-line-height, 28px);
        position: relative;
      }

      .preview-table {
        width: 100%;
        max-width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .preview-table td,
      .preview-table th {
        height: var(--page-table-row-height, auto);
        min-height: var(--page-table-row-height, auto);
        padding: var(--page-table-cell-padding-y, 10px) var(--page-table-cell-padding-x, 12px);
        border: 1px solid var(--page-table-border, #d5dde6);
        font-size: inherit;
        line-height: inherit;
        vertical-align: top;
        position: relative;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .preview-table th {
        height: var(--page-table-header-row-height, var(--page-table-row-height, auto));
        min-height: var(--page-table-header-row-height, var(--page-table-row-height, auto));
        color: var(--page-table-header-text, #213547);
        font-weight: 700;
        background: var(--page-table-header-bg, #f3f7fb);
      }

      .table-cell-content {
        min-height: 100%;
        min-width: 0;
        white-space: inherit;
        overflow-wrap: inherit;
        word-break: inherit;
      }

      hr {
        border: 0;
        border-top: var(--page-rule-stroke-width, 1px) solid var(--page-rule-color, #d5dde6);
        margin: var(--page-rule-margin-top, 24px) 0 var(--page-rule-margin-bottom, 24px);
      }

      .column-break-marker {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 12px 0 18px;
        padding: 4px 0;
        color: #5f7080;
      }

      .column-break-marker-line {
        flex: 1 1 auto;
        min-width: 18px;
        border-top: 1px dotted var(--page-break-line, #b9c7d4);
      }

      .column-break-marker-label {
        flex: 0 0 auto;
        padding: 3px 10px;
        color: var(--page-break-text, #506274);
        font-size: 12px;
        font-weight: 650;
        letter-spacing: 0.04em;
        background: color-mix(in srgb, var(--page-break-bg, #f4f8fb) 72%, white 28%);
        border: 1px dashed var(--page-break-border, #d8e1e8);
        border-radius: 999px;
      }

      .image-shell {
        display: grid;
        gap: var(--page-image-caption-gap, 8px);
        margin: var(--page-image-margin-top, 20px) 0 var(--page-image-margin-bottom, 20px);
        width: fit-content;
        max-width: 100%;
        position: relative;
        overflow: visible;
      }

      .image-shell.image-wrap-topBottom {
        margin-left: auto;
        margin-right: auto;
      }

      .image-shell.image-wrap-square,
      .image-shell.image-wrap-tight {
        max-width: min(100%, 72%);
      }

      .image-viewport {
        display: block;
        width: fit-content;
        max-width: 100%;
        overflow: hidden;
        line-height: 0;
      }

      .preview-image {
        display: block;
        max-width: 100%;
        width: auto;
        height: auto;
        border-radius: 0;
        border: 0;
      }

      .preview-image-fit {
        margin: 0;
      }

      .preview-image-cropped {
        transform-origin: top left;
      }

      .preview-image.placeholder {
        display: grid;
        place-items: center;
        min-height: 220px;
        color: #5f6f80;
        background: linear-gradient(180deg, #eef5fb 0%, #dde8f4 100%);
      }

      .image-shell figcaption {
        color: var(--page-image-caption-color, #667788);
        font-size: 13px;
        text-align: center;
      }

      /* 雪山主题导出同步画布里的非占位 SVG 装饰，避免 PDF 只保留基础配色。 */
      .page[data-theme-id='snowMountain'] {
        color: var(--page-paragraph-color, #24313a);
        background-image:
          var(--page-surface-pattern, none),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Cg fill='none' stroke='%238fb7c6' stroke-width='1' stroke-linecap='round' opacity='.22'%3E%3Cpath d='M24 16v12M18 22h12M19 17l10 10M29 17L19 27M72 58v10M67 63h10M68 59l8 8M76 59l-8 8'/%3E%3C/g%3E%3Ccircle cx='50' cy='34' r='1.2' fill='%23d8eef7' opacity='.7'/%3E%3Ccircle cx='18' cy='70' r='1' fill='%238fb7c6' opacity='.45'/%3E%3C/svg%3E");
        background-size: var(--page-surface-pattern-size, 24px 24px), 96px 96px;
      }

      .page[data-theme-id='snowMountain']::before {
        height: 52px;
        background:
          linear-gradient(180deg, rgb(216 238 247 / 80%) 0%, rgb(250 253 255 / 0%) 100%),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='72' viewBox='0 0 420 72'%3E%3Cpath d='M0 58L54 31l24 14 43-33 46 36 28-19 52 30 39-47 60 46 31-21 43 25v10H0z' fill='%23d8eef7' opacity='.82'/%3E%3Cpath d='M54 31l24 14 43-33 15 12-15-4-20 18-23-7-18 13zM286 12l60 46-28-10-15-20-17 10-20 20z' fill='%23ffffff' opacity='.92'/%3E%3Cpath d='M0 58C80 45 144 61 218 48s138-8 202 10' fill='none' stroke='%238fb7c6' stroke-width='2' opacity='.45'/%3E%3C/svg%3E")
          repeat-x left top / 420px 72px;
      }

      .page[data-theme-id='snowMountain']::after {
        content: "";
        position: absolute;
        inset: 14px;
        border: 1px solid rgb(143 183 198 / 28%);
        border-radius: 8px;
        pointer-events: none;
        z-index: 0;
      }

      .page[data-theme-id='snowMountain'] .page-header,
      .page[data-theme-id='snowMountain'] .page-footer {
        font-weight: 650;
        background-image:
          linear-gradient(var(--page-header-bg, rgb(240 247 250 / 92%)), var(--page-header-bg, rgb(240 247 250 / 92%))),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='12' viewBox='0 0 220 12'%3E%3Cpath d='M2 8c26-7 44 3 70-2s47-5 72-1 48 5 74-3' fill='none' stroke='%238fb7c6' stroke-width='2' stroke-linecap='round' opacity='.68'/%3E%3Cpath d='M38 7l6-5 6 5M146 6l5-4 5 4' fill='none' stroke='%23f2b84b' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round' opacity='.78'/%3E%3C/svg%3E");
        background-repeat: repeat, repeat-x;
        background-position: left top, left bottom;
        background-size: auto, 220px 12px;
      }

      .page[data-theme-id='snowMountain'] .page-footer {
        background-image:
          linear-gradient(var(--page-footer-bg, rgb(240 247 250 / 88%)), var(--page-footer-bg, rgb(240 247 250 / 88%))),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='12' viewBox='0 0 220 12'%3E%3Cpath d='M2 5c30 6 49-3 79 1s55 5 84 0 37-6 53-1' fill='none' stroke='%238fb7c6' stroke-width='2' stroke-linecap='round' opacity='.62'/%3E%3Cpath d='M72 6l5 4 5-4M168 6l5 4 5-4' fill='none' stroke='%23f2b84b' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round' opacity='.72'/%3E%3C/svg%3E");
        background-position: left top, left top;
      }

      .page[data-theme-id='snowMountain'] .page-body {
        outline: 1px dashed rgb(143 183 198 / 42%);
        outline-offset: -4px;
      }

      .page[data-theme-id='snowMountain'] h1 {
        position: relative;
        background-image:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='12' viewBox='0 0 260 12'%3E%3Cpath d='M2 9c30-7 52 3 82-3s57-5 87-1 55 6 87-3' fill='none' stroke='%23f2b84b' stroke-width='3' stroke-linecap='round' opacity='.9'/%3E%3Cpath d='M22 8l9-6 9 6M164 7l7-5 7 5' fill='none' stroke='%232f6f64' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' opacity='.85'/%3E%3C/svg%3E");
        background-size: 100% 12px;
      }

      .page[data-theme-id='snowMountain'] h1::before {
        content: "";
        position: absolute;
        right: 0;
        top: 2px;
        width: 42px;
        height: 26px;
        background:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='42' height='26' viewBox='0 0 42 26'%3E%3Cpath d='M2 22L13 7l7 8L27 2l13 20z' fill='%23d8eef7' stroke='%238fb7c6' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M13 7l7 8 7-13 4 7-7-3-5 11-6-6-5 8z' fill='%23ffffff' opacity='.9'/%3E%3C/svg%3E")
          no-repeat center / contain;
        opacity: .78;
        pointer-events: none;
      }

      .page[data-theme-id='snowMountain'] h2::before {
        left: -18px;
        top: 7px;
        bottom: auto;
        width: 14px;
        height: 14px;
        border-radius: 0;
        background:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Cpath d='M7 1v12M1 7h12M2.8 2.8l8.4 8.4M11.2 2.8l-8.4 8.4' fill='none' stroke='%232f6f64' stroke-width='1.4' stroke-linecap='round' opacity='.9'/%3E%3Ccircle cx='7' cy='7' r='2' fill='%23fafdff' stroke='%238fb7c6' stroke-width='1'/%3E%3C/svg%3E")
          no-repeat center / contain;
      }

      .page[data-theme-id='snowMountain'] h3 {
        background:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='7' viewBox='0 0 180 7'%3E%3Cpath d='M2 5c22-5 38 2 60-1s43-4 65-1 35 3 51-1' fill='none' stroke='%238fb7c6' stroke-width='1.6' stroke-linecap='round' opacity='.74'/%3E%3C/svg%3E")
          no-repeat left bottom / min(180px, 58%) 7px;
      }

      .page[data-theme-id='snowMountain'] blockquote {
        box-shadow: inset 0 0 0 1px rgb(143 183 198 / 24%);
        background-image:
          linear-gradient(var(--page-blockquote-bg, #eef7fb), var(--page-blockquote-bg, #eef7fb)),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='42' viewBox='0 0 96 42'%3E%3Cpath d='M3 34L20 16l10 9L44 6l23 25 11-9 15 12' fill='none' stroke='%238fb7c6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' opacity='.36'/%3E%3C/svg%3E");
        background-repeat: repeat, no-repeat;
        background-position: left top, right bottom;
        background-size: auto, 96px 42px;
      }

      .page[data-theme-id='snowMountain'] .preview-table th {
        background-image:
          linear-gradient(var(--page-table-header-bg, #e3f0f5), var(--page-table-header-bg, #e3f0f5)),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='16' viewBox='0 0 140 16'%3E%3Cpath d='M2 12c18-6 32 2 50-2s35-4 53-1 24 3 33-2' fill='none' stroke='%238fb7c6' stroke-width='2' stroke-linecap='round' opacity='.48'/%3E%3Cpath d='M24 11l6-6 6 6M96 10l5-5 5 5' fill='none' stroke='%23ffffff' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' opacity='.9'/%3E%3C/svg%3E");
        background-repeat: repeat, repeat-x;
        background-position: left top, left bottom;
        background-size: auto, 140px 16px;
      }

      .page[data-theme-id='snowMountain'] hr {
        height: var(--page-rule-stroke-width, 1px);
        border-top: 0;
        background:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='2' viewBox='0 0 180 2'%3E%3Cpath d='M1 1c22-1 37 1 59 0s40-1 62 0 36 1 57-1' fill='none' stroke='%238fb7c6' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")
          repeat-x left center / 180px 2px;
      }

      .page[data-theme-id='snowMountain'] .toc-block-export {
        border-color: var(--page-table-border, #c8dce7);
        background-image:
          linear-gradient(rgb(250 253 255 / 84%), rgb(250 253 255 / 84%)),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='44' viewBox='0 0 120 44'%3E%3Cpath d='M4 35L22 16l11 10L50 7l26 26 12-9 28 12' fill='none' stroke='%238fb7c6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' opacity='.32'/%3E%3C/svg%3E");
        background-repeat: repeat, no-repeat;
        background-position: left top, right bottom;
        background-size: auto, 120px 44px;
      }

      .page[data-theme-id='snowMountain'] .image-viewport {
        border-radius: 6px;
        outline: 1px solid rgb(143 183 198 / 56%);
        outline-offset: 3px;
        box-shadow: 0 10px 22px rgb(23 50 77 / 10%);
      }

      .page[data-theme-id='snowMountain'] .image-shell figcaption {
        font-weight: 650;
      }

      .page[data-theme-id='snowMountain'] .equation-shell {
        box-shadow: inset 0 0 0 1px rgb(47 111 100 / 22%);
      }

      /* 手绘主题导出必须和画布预览共用同一套视觉口径，避免 PDF 变成普通表格线。 */
      .page[data-theme-id='handDrawn'] {
        color: var(--page-paragraph-color, #2f2a24);
        border-width: 2px;
        border-radius: 10px 14px 12px 9px;
        background-image:
          var(--page-surface-pattern, none),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='%236b4f2a' stroke-width='1' stroke-linecap='round' opacity='.13'%3E%3Cpath d='M12 22c18-4 31 2 47-2s31-8 49-3'/%3E%3Cpath d='M8 83c20 5 37-3 56 1s29 7 48 2'/%3E%3Cpath d='M24 10c-3 18 2 31-1 47s-7 33-2 52'/%3E%3Cpath d='M91 7c4 20-3 33 0 50s7 34 2 54'/%3E%3C/g%3E%3C/svg%3E");
        background-size: var(--page-surface-pattern-size, 22px 22px), 120px 120px;
      }

      .page[data-theme-id='handDrawn']::before {
        height: 10px;
        background:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='10' viewBox='0 0 160 10'%3E%3Cpath d='M2 6c20-5 36 3 55-1s35-5 52-1 30 3 49-1' fill='none' stroke='%232f2a24' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E")
          repeat-x left center / 160px 10px;
      }

      .page[data-theme-id='handDrawn']::after {
        content: "";
        position: absolute;
        inset: 12px;
        border: 1px solid rgb(47 42 36 / 28%);
        border-radius: 13px 9px 15px 11px;
        pointer-events: none;
        z-index: 0;
      }

      .page[data-theme-id='handDrawn'] .page-header,
      .page[data-theme-id='handDrawn'] .page-footer {
        font-weight: 700;
        border-color: transparent;
        background-image:
          linear-gradient(var(--page-header-bg, rgb(255 249 226 / 88%)), var(--page-header-bg, rgb(255 249 226 / 88%))),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='12' viewBox='0 0 180 12'%3E%3Cpath d='M2 7c20-5 35 2 55-2s35-4 55 0 41 3 66-2' fill='none' stroke='%236b4f2a' stroke-width='2' stroke-linecap='round' opacity='.72'/%3E%3C/svg%3E");
        background-repeat: repeat, repeat-x;
        background-position: left top, left bottom;
        background-size: auto, 180px 12px;
      }

      .page[data-theme-id='handDrawn'] .page-footer {
        background-image:
          linear-gradient(var(--page-footer-bg, rgb(255 249 226 / 82%)), var(--page-footer-bg, rgb(255 249 226 / 82%))),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='12' viewBox='0 0 180 12'%3E%3Cpath d='M2 5c25 4 40-2 60 1s35 5 55 1 36-5 63 1' fill='none' stroke='%236b4f2a' stroke-width='2' stroke-linecap='round' opacity='.72'/%3E%3C/svg%3E");
        background-position: left top, left top;
      }

      .page[data-theme-id='handDrawn'] .page-body {
        outline: 1px dashed rgb(107 79 42 / 46%);
        outline-offset: -5px;
      }

      .page[data-theme-id='handDrawn'] h1 {
        position: relative;
        padding-bottom: var(--page-heading1-decoration-padding-bottom, 10px);
        letter-spacing: 0;
        background-image:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='14' viewBox='0 0 220 14'%3E%3Cpath d='M3 9c26-8 45 4 70-2s47-7 73-2 43 5 71-1' fill='none' stroke='%23d88c45' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E");
        background-size: 100% var(--page-heading1-decoration-underline-height, 14px);
      }

      .page[data-theme-id='handDrawn'] h1::before {
        content: "";
        position: absolute;
        right: 2px;
        top: 4px;
        width: 36px;
        height: 18px;
        border: 2px solid var(--page-heading2-marker, #3b7a57);
        border-left-color: transparent;
        border-radius: 48% 52% 44% 56%;
        transform: rotate(-8deg);
      }

      .page[data-theme-id='handDrawn'] h2 {
        padding-left: calc(var(--page-heading2-inset-left, 0px) + var(--page-heading2-decoration-marker-inset-left, 12px));
      }

      .page[data-theme-id='handDrawn'] h2::before {
        left: -4px;
        top: 4px;
        bottom: auto;
        width: 14px;
        height: 14px;
        border: 2px solid var(--page-heading2-marker, #3b7a57);
        border-radius: 44% 56% 52% 48%;
        background: transparent;
        transform: rotate(-12deg);
      }

      .page[data-theme-id='handDrawn'] h2::after,
      .page[data-theme-id='handDrawn'] h3::after {
        content: "";
        display: block;
        width: min(220px, 72%);
        height: var(--page-heading2-decoration-underline-height, 8px);
        margin-top: var(--page-heading2-decoration-underline-gap, 2px);
        background:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='8' viewBox='0 0 220 8'%3E%3Cpath d='M2 5c30-5 49 2 78-1s55-5 84 0 39 3 54-1' fill='none' stroke='%23b75f3c' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E")
          no-repeat left center / 100% var(--page-heading2-decoration-underline-height, 8px);
      }

      .page[data-theme-id='handDrawn'] h3::after {
        height: var(--page-heading3-decoration-underline-height, 8px);
        margin-top: var(--page-heading3-decoration-underline-gap, 2px);
        background-size: 100% var(--page-heading3-decoration-underline-height, 8px);
      }

      .page[data-theme-id='handDrawn'] p {
        text-underline-offset: 3px;
      }

      .page[data-theme-id='handDrawn'] ul li::marker {
        content: "> ";
        color: var(--page-list-marker, #3b7a57);
        font-weight: 800;
      }

      .page[data-theme-id='handDrawn'] ol li::marker {
        color: var(--page-list-marker, #3b7a57);
        font-weight: 800;
      }

      .page[data-theme-id='handDrawn'] .task-list-checkbox {
        color: var(--page-task-checkbox, #b75f3c);
        text-shadow: 0.6px 0.6px 0 rgb(107 79 42 / 22%);
        transform: rotate(-4deg);
      }

      .page[data-theme-id='handDrawn'] blockquote {
        padding: 12px 16px;
        border: 2px solid var(--page-blockquote-border, #b75f3c);
        border-left-width: 5px;
        border-radius: 15px 9px 13px 10px;
        box-shadow: 3px 3px 0 rgb(107 79 42 / 12%);
        transform: rotate(-0.2deg);
      }

      .page[data-theme-id='handDrawn'] pre {
        border: 2px solid var(--page-code-border, #d88c45);
        border-radius: 13px 10px 14px 9px;
        box-shadow: 4px 4px 0 rgb(216 140 69 / 22%);
      }

      .page[data-theme-id='handDrawn'] .table-shell {
        overflow: visible;
        padding: 3px;
        border: 2px solid var(--page-table-border, #3a2e25);
        border-radius: 12px 8px 14px 10px;
        transform: rotate(0.08deg);
      }

      .page[data-theme-id='handDrawn'] .preview-table {
        border-collapse: separate;
        border-spacing: 0;
      }

      .page[data-theme-id='handDrawn'] .preview-table td,
      .page[data-theme-id='handDrawn'] .preview-table th {
        border-color: var(--page-table-border, #3a2e25);
        border-width: 0 1.5px 1.5px 0;
        border-style: solid;
      }

      .page[data-theme-id='handDrawn'] .preview-table th {
        background-image:
          linear-gradient(var(--page-table-header-bg, #ffe8a8), var(--page-table-header-bg, #ffe8a8)),
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='16' viewBox='0 0 140 16'%3E%3Cpath d='M2 12c19-7 33 2 51-3s36-5 53-1 22 2 32-2' fill='none' stroke='%23d88c45' stroke-width='3' stroke-linecap='round' opacity='.5'/%3E%3C/svg%3E");
        background-repeat: repeat, repeat-x;
        background-position: left top, left bottom;
        background-size: auto, 140px 16px;
      }

      .page[data-theme-id='handDrawn'] hr {
        height: 14px;
        border: 0;
        background:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='14' viewBox='0 0 220 14'%3E%3Cpath d='M2 8c24-8 43 4 66-2s45-6 69-1 51 5 81-2' fill='none' stroke='%23b75f3c' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E")
          repeat-x left center / 220px 14px;
      }

      .page[data-theme-id='handDrawn'] .toc-block-export {
        border: 2px solid var(--page-table-border, #3a2e25);
        border-radius: 14px 9px 12px 11px;
        background: rgb(255 246 215 / 70%);
        box-shadow: 3px 3px 0 rgb(107 79 42 / 12%);
      }

      .page[data-theme-id='handDrawn'] .toc-entry-export-dots {
        border-bottom-color: var(--page-rule-color, #b75f3c);
        border-bottom-style: dashed;
      }

      .page[data-theme-id='handDrawn'] .image-viewport {
        padding: 4px;
        border: 2px solid var(--page-table-border, #3a2e25);
        border-radius: 13px 9px 14px 10px;
        background: #fffdf4;
        box-shadow: 4px 4px 0 rgb(47 42 36 / 12%);
        transform: rotate(-0.12deg);
      }

      .page[data-theme-id='handDrawn'] .image-shell figcaption {
        font-weight: 700;
        transform: rotate(-0.4deg);
      }

      .page[data-theme-id='handDrawn'] .equation-shell {
        border: 2px solid var(--page-heading2-marker, #3b7a57);
        border-radius: 50% 48% 49% 51% / 12% 16% 13% 15%;
        background: rgb(255 246 215 / 58%);
      }

      @page {
        size: ${pageSizeRule};
        margin: 0;
      }

      @media print {
        body {
          background: #ffffff;
        }

        .export-shell {
          padding: 0;
        }

        .page {
          margin: 0;
          box-shadow: none;
          break-after: page;
        }

        .page:last-child {
          break-after: auto;
        }
      }
    </style>
  </head>
  <body>
    <div class="export-shell">${renderPages(pages, styles, styleSettings?.headerFooterContent, title)}</div>
  </body>
</html>`;
}
