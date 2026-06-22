import type { ParsedBlock } from '@/engine/parser/types';
import type { PageLayout } from '@/engine/typesetting/types';

export interface PdfExportPayload {
  pages: PageLayout[];
  title: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderBlock(block: ParsedBlock): string {
  switch (block.type) {
    case 'heading': {
      const tagName =
        block.depth === 1 ? 'h1' : block.depth === 2 ? 'h2' : block.depth === 3 ? 'h3' : 'h4';
      return `<${tagName}>${escapeHtml(block.text)}</${tagName}>`;
    }
    case 'paragraph':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'list': {
      const tagName = block.ordered ? 'ol' : 'ul';
      const items = block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
      return `<${tagName}>${items}</${tagName}>`;
    }
    case 'blockquote':
      return `<blockquote>${block.blocks.map((nestedBlock) => renderBlock(nestedBlock)).join('')}</blockquote>`;
    case 'code':
      return `<pre><code>${escapeHtml(block.value)}</code></pre>`;
    case 'table':
      return `<table><tbody>${block.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody></table>`;
    case 'horizontalRule':
      return '<hr />';
    default:
      return '';
  }
}

function renderPages(pages: PageLayout[]): string {
  return pages
    .map((page) => {
      const titleBlock = page.blocks.find((block) => block.type === 'heading');
      const pageTitle = titleBlock?.type === 'heading' ? titleBlock.text : '未命名文档';

      return `<section class="page">
        <header class="page-header">${escapeHtml(pageTitle)}</header>
        <article class="page-body">${page.blocks.map((block) => renderBlock(block)).join('')}</article>
        <footer class="page-footer">${page.pageNumber}</footer>
      </section>`;
    })
    .join('');
}

export function buildExportHtml({ pages, title }: PdfExportPayload): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color: #1f2937;
        font-family: "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
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
        grid-template-rows: 52px 1fr 42px;
        width: 794px;
        min-height: 1123px;
        margin: 0 auto 24px;
        color: #1f2937;
        background: #ffffff;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.10);
      }

      .page:last-child {
        margin-bottom: 0;
      }

      .page-header,
      .page-footer {
        display: flex;
        align-items: center;
        color: #6b7280;
        font-size: 12px;
      }

      .page-header {
        padding: 0 56px;
        border-bottom: 1px solid #edf1f5;
      }

      .page-footer {
        justify-content: center;
        border-top: 1px solid #edf1f5;
      }

      .page-body {
        padding: 42px 56px;
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

      hr {
        border: 0;
        border-top: 1px solid #d5dde6;
        margin: 24px 0;
      }

      @page {
        size: A4;
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
    <div class="export-shell">${renderPages(pages)}</div>
  </body>
</html>`;
}
