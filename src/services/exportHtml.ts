import {
  applyPageNumbersToTocItems,
  buildHeadingPageNumberMap,
  buildTocItems,
  getHeadingText,
  getImageWrapClassName,
  getTocBlockDisplayTitle,
  getVisibleTocItemsForBlock,
  resolveImageLayout,
  resolveImageRenderMetrics,
  resolveHangingIndentStyle,
  isImageTextWrapMode,
  buildLayoutListTree,
  getLayoutListItemLevel,
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
import { resolveAssetSrc } from '@/utils/filePath';

export interface PdfExportPayload {
  pages: PageLayout[];
  title: string;
  resources?: LayoutResource[];
  styles?: LayoutStyleSheet;
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

function buildBlockStyle(block: LayoutBlock): string {
  const supportsBlockIndent = block.type === 'heading' || block.type === 'paragraph';
  const indentStyle = supportsBlockIndent ? resolveHangingIndentStyle(block.blockStyleOverrides) : null;
  const textIndent = indentStyle ? indentStyle.textIndent : block.blockStyleOverrides.firstLineIndent;
  const declarations = [
    block.blockStyleOverrides.textAlign ? `text-align:${block.blockStyleOverrides.textAlign}` : '',
    block.blockStyleOverrides.lineHeight ? `line-height:${block.blockStyleOverrides.lineHeight}px` : '',
    block.blockStyleOverrides.spaceBefore !== undefined ? `margin-top:${block.blockStyleOverrides.spaceBefore}px` : '',
    block.blockStyleOverrides.spaceAfter !== undefined ? `margin-bottom:${block.blockStyleOverrides.spaceAfter}px` : '',
    indentStyle && indentStyle.paddingLeft > 0 ? `padding-left:${indentStyle.paddingLeft}px` : '',
    indentStyle && indentStyle.paddingRight > 0 ? `padding-right:${indentStyle.paddingRight}px` : '',
    textIndent && textIndent !== 0 ? `text-indent:${textIndent}px` : '',
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

function renderListItemContent(item: LayoutListItem, inheritedStyle = {}): string {
  const listItemClass = item.checked === null ? '' : ' class="task-list-item"';
  const checkedMark =
    item.checked === null
      ? ''
      : `<span class="task-list-checkbox">${item.checked ? '☑' : '☐'}</span>`;
  return `<li${listItemClass} data-list-level="${getLayoutListItemLevel(item)}">${checkedMark}${renderTextRuns(item.textRuns, inheritedStyle)}`;
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

function renderBlock(block: LayoutBlock, styles?: LayoutStyleSheet): string {
  const inheritedStyle = resolveQuickTextStyleForBlock(block, styles);
  switch (block.type) {
    case 'pageBreak':
      return '';
    case 'heading': {
      const tagName =
        block.metadata.kind === 'heading' && block.metadata.depth === 1
          ? 'h1'
          : block.metadata.kind === 'heading' && block.metadata.depth === 2
            ? 'h2'
            : block.metadata.kind === 'heading' && block.metadata.depth === 3
              ? 'h3'
              : 'h4';
      return `<${tagName}${buildBlockStyle(block)}>${renderTextRuns(block.textRuns, inheritedStyle)}</${tagName}>`;
    }
    case 'toc':
      return '';
    case 'paragraph':
      return `<p${buildBlockStyle(block)}>${renderTextRuns(block.textRuns, inheritedStyle)}</p>`;
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
      return rootListHtml.replace(/^<(ol|ul)([^>]*)>/, `<$1$2${buildBlockStyle(block)}>`);
    }
    case 'blockquote':
      return block.metadata.kind === 'blockquote'
        ? `<blockquote>${block.metadata.blocks.map((nestedBlock) => renderBlock(nestedBlock, styles)).join('')}</blockquote>`
        : '';
    case 'code':
      return `<pre${buildBlockStyle(block)}><code>${renderTextRuns(block.textRuns, inheritedStyle)}</code></pre>`;
    case 'equation':
      return block.metadata.kind === 'equation'
        ? `<div class="equation-shell"${buildBlockStyle(block)}>${renderEquationToHtml(block.metadata.value).html}</div>`
        : '';
    case 'table':
      if (block.metadata.kind !== 'table') {
        return '';
      }
      const tableMeta = block.metadata as TableBlockMetadata;
      const columnCount = tableMeta.rows[0]?.cells.length ?? 0;
      const columnWidths = resolveTableColumnWidths(tableMeta.columnWidthsPx, columnCount, 520);
      return `<table${buildBlockStyle(block)}><tbody>${tableMeta.rows
          .map((row) =>
            `<tr>${row.cells
              .filter((cell) => !cell.coveredByCellId)
              .map((cell, cellIndex) => {
                const tagName = cell.isHeader ? 'th' : 'td';
                const colSpan = cell.colSpan && cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '';
                const rowSpan = cell.rowSpan && cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '';
                const widthPx = columnWidths[cellIndex];
                return `<${tagName}${buildTableCellStyle(tableMeta.align[cellIndex] ?? null, widthPx, row.heightPx ?? undefined)}${colSpan}${rowSpan}>${renderTextRuns(cell.textRuns, inheritedStyle)}</${tagName}>`;
              })
              .join('')}</tr>`,
          )
          .join('')}</tbody></table>`;
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

function renderPages(pages: PageLayout[], styles?: LayoutStyleSheet): string {
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
      const pageTitle = titleBlock ? getHeadingText(titleBlock) || '未命名文档' : '未命名文档';
      const metrics = getPageMetrics(page);
      const bodyParts: string[] = [];

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

          bodyParts.push(`<section class="toc-block-export"${buildBlockStyle(block)}><div class="toc-block-export-title">${escapeHtml(getTocBlockDisplayTitle(block))}</div>${entries}</section>`);
          continue;
        }

        bodyParts.push(renderBlock(block, styles));
      }

      return `<section class="page" style="width:${metrics.pageWidthPx}px;min-height:${metrics.pageHeightPx}px;grid-template-rows:${metrics.headerHeight}px 1fr ${metrics.footerHeight}px;">
        <header class="page-header">${escapeHtml(pageTitle)}<span>${escapeHtml(page.contract.pageLabel)}</span></header>
        <article class="page-body">${bodyParts.join('')}</article>
        <footer class="page-footer"><span>${escapeHtml(page.contract.templateLabel)}</span><span>${page.pageNumber}</span></footer>
      </section>`;
    })
    .join('');
}

export function buildExportHtml({ pages, title, resources, styles }: PdfExportPayload): string {
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
        margin: 0 auto 24px;
        color: #1f2937;
        background: #ffffff;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.10);
        border: 1px solid #d8e1e8;
      }

      .page:last-child {
        margin-bottom: 0;
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
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #6b7280;
        font-size: 12px;
      }

      .page-header {
        padding: 0 24px;
        border-bottom: 1px solid #edf1f5;
      }

      .page-footer {
        padding: 0 24px;
        border-top: 1px solid #edf1f5;
      }

      .page-body {
        padding-top: 0;
        padding-bottom: 0;
        padding-left: ${firstPage ? `${firstPage.contract.marginsPx.left}px` : '56px'};
        padding-right: ${firstPage ? `${firstPage.contract.marginsPx.right}px` : '56px'};
      }

      h1 {
        margin: 0 0 28px;
        color: #102a43;
        font-size: 34px;
        line-height: 1.2;
      }

      h2 {
        margin: 28px 0 16px;
        color: #12314e;
        font-size: 24px;
      }

      h3, h4, h5, h6 {
        margin: 24px 0 12px;
        color: #12314e;
        font-size: 18px;
      }

      p, li {
        margin: 0 0 14px;
        color: #344054;
        font-size: 16px;
        line-height: 1.72;
      }

      ul, ol {
        margin: 0 0 16px;
        padding-left: 24px;
      }

      li.task-list-item {
        list-style: none;
      }

      .task-list-checkbox {
        display: inline-block;
        width: 18px;
        min-width: 18px;
        color: #0d5663;
        font-weight: 700;
      }

      blockquote {
        margin: 20px 0;
        padding: 4px 0 4px 16px;
        border-left: 4px solid #b8d8dc;
      }

      pre {
        margin: 20px 0;
        padding: 14px 16px;
        color: #d7e3f4;
        background: #173047;
        border-radius: 12px;
        white-space: pre-wrap;
      }

      table {
        width: 100%;
        margin: 20px 0;
        border-collapse: collapse;
      }

      td, th {
        padding: 10px 12px;
        border: 1px solid #d5dde6;
      }

      th {
        color: #213547;
        font-weight: 700;
        background: #f3f7fb;
      }

      hr {
        border: 0;
        border-top: 1px solid #d5dde6;
        margin: 24px 0;
      }

      .image-shell {
        display: grid;
        gap: 8px;
        margin: 20px 0;
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
        color: #667788;
        font-size: 13px;
        text-align: center;
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
    <div class="export-shell">${renderPages(pages, styles)}</div>
  </body>
</html>`;
}
