/**
 * 离屏渲染器
 *
 * 使用隐藏 div 容器进行真实测量：
 * - visibility: hidden 保持布局计算
 * - position: absolute 脱离文档流
 * - pointer-events: none 防止事件干扰
 */

import type { LayoutBlock } from '@/engine/document-model';
import type { OffscreenMeasurementJob } from './types';

// 离屏容器样式常量
const OFFSCREEN_STYLES: Record<string, string> = {
  visibility: 'hidden',
  position: 'absolute',
  pointerEvents: 'none',
  overflow: 'hidden',
  top: '-9999px',
  left: '-9999px',
  width: 'auto',
  minWidth: '0',
  maxWidth: 'none',
  whiteSpace: 'pre-wrap',
  wordWrap: 'break-word',
};

/**
 * 创建离屏测量容器
 */
export function createOffscreenContainer(): HTMLDivElement {
  const container = document.createElement('div');

  // 应用离屏样式
  const style = container.style;
  style.visibility = 'hidden';
  style.position = 'absolute';
  style.pointerEvents = 'none';
  style.overflow = 'hidden';
  style.top = '-9999px';
  style.left = '-9999px';
  style.width = 'auto';
  style.minWidth = '0';
  style.maxWidth = 'none';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';

  return container;
}

/**
 * 挂载容器到 DOM
 */
export function mountOffscreenContainer(container: HTMLDivElement): void {
  if (!container.parentNode) {
    document.body.appendChild(container);
  }
}

/**
 * 卸载容器从 DOM
 */
export function unmountOffscreenContainer(container: HTMLDivElement): void {
  if (container.parentNode) {
    container.parentNode.removeChild(container);
  }
  container.innerHTML = '';
}

/**
 * 渲染 LayoutBlock 到离屏容器
 * 返回渲染后的实际高度
 */
export function renderBlockToOffscreen(
  container: HTMLDivElement,
  block: LayoutBlock,
  width: number
): { height: number; element: HTMLDivElement } {
  // 设置宽度
  container.style.width = `${width}px`;

  // 清空容器
  container.innerHTML = '';

  // 创建块元素
  const blockElement = createBlockElement(block, width);
  container.appendChild(blockElement);

  // 强制重绘以获取准确尺寸
  void container.offsetHeight;

  // 获取高度
  const height = container.scrollHeight;

  return { height, element: blockElement };
}

/**
 * 创建块的 DOM 元素
 */
function createBlockElement(block: LayoutBlock, width: number): HTMLDivElement {
  const element = document.createElement('div');

  // 设置块基本样式
  element.style.width = `${width}px`;
  element.style.boxSizing = 'border-box';

  // 根据块类型设置内容
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      element.innerHTML = renderTextRuns(block.textRuns);
      break;

    case 'list':
      element.innerHTML = renderListItems(block);
      break;

    case 'table':
      element.innerHTML = renderTable(block);
      break;

    case 'blockquote':
      element.innerHTML = `<blockquote style="border-left: 3px solid #ccc; padding-left: 1em; margin: 0.5em 0;">${renderTextRuns(block.textRuns)}</blockquote>`;
      break;

    case 'code':
      element.innerHTML = `<pre style="background: #f5f5f5; padding: 0.5em; margin: 0; overflow-x: auto;"><code>${escapeHtml(block.metadata.kind === 'code' ? block.metadata.value : '')}</code></pre>`;
      break;

    case 'image':
      element.innerHTML = `<img src="${block.metadata.kind === 'image' ? block.metadata.src : ''}" alt="${block.metadata.kind === 'image' ? block.metadata.alt : ''}" style="max-width: 100%;" />`;
      break;

    case 'horizontalRule':
      element.innerHTML = '<hr style="margin: 0.5em 0; border: none; border-top: 1px solid #ccc;" />';
      break;

    default:
      element.innerHTML = renderTextRuns(block.textRuns);
  }

  return element;
}

/**
 * 渲染 TextRun 数组为 HTML
 */
function renderTextRuns(textRuns: LayoutBlock['textRuns']): string {
  return textRuns
    .map((run) => {
      const styles: string[] = [];

      // 检查 marks 获取样式
      const hasBold = run.marks.some((mark) => mark.type === 'bold');
      const hasItalic = run.marks.some((mark) => mark.type === 'italic');
      const hasUnderline = run.marks.some((mark) => mark.type === 'underline');
      const hasStrike = run.marks.some((mark) => mark.type === 'strike');
      const hasCode = run.marks.some((mark) => mark.type === 'code');

      if (hasBold) styles.push('font-weight: bold');
      if (hasItalic) styles.push('font-style: italic');
      if (hasUnderline) styles.push('text-decoration: underline');
      if (hasStrike) styles.push('text-decoration: line-through');
      if (run.styleOverrides.color) {
        styles.push(`color: ${run.styleOverrides.color}`);
      }
      if (run.styleOverrides.backgroundColor) {
        styles.push(`background-color: ${run.styleOverrides.backgroundColor}`);
      }

      const styleAttr = styles.length > 0 ? ` style="${styles.join(';')}"` : '';
      const classAttr = hasCode ? ' style="font-family: monospace; background: #f5f5f5; padding: 0 2px;"' : '';

      return `<span${styleAttr}${classAttr}>${escapeHtml(run.text)}</span>`;
    })
    .join('');
}

/**
 * 渲染列表项
 */
function renderListItems(block: LayoutBlock): string {
  if (block.metadata.kind !== 'list') return '';

  const items = block.metadata.items;
  const ordered = block.metadata.ordered;
  const start = block.metadata.start ?? 1;

  return items
    .map((item, index) => {
      const marker = ordered
        ? `<span class="list-marker">${start + index}. </span>`
        : `<span class="list-marker">• </span>`;

      return `<div style="margin-left: 1.5em; text-indent: -1.5em;">${marker}${renderTextRuns(item.textRuns)}</div>`;
    })
    .join('');
}

/**
 * 渲染表格（简化版，用于高度测量）
 */
function renderTable(block: LayoutBlock): string {
  if (block.metadata.kind !== 'table') return '';

  const { rows } = block.metadata;

  const headerCells = rows[0]?.cells
    .map((cell) => `<th style="border: 1px solid #ccc; padding: 4px 8px; background: #f5f5f5;">${renderTextRuns(cell.textRuns)}</th>`)
    .join('') ?? '';

  const bodyRows = rows
    .slice(1)
    .map((row) => {
      const cells = row.cells
        .map((cell) => `<td style="border: 1px solid #ccc; padding: 4px 8px;">${renderTextRuns(cell.textRuns)}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<table style="border-collapse: collapse; width: 100%;"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 测量文本片段高度（用于行级精确测量）
 * 返回所有行尾字符索引
 */
export function measureTextLineBreaks(
  container: HTMLDivElement,
  text: string,
  width: number,
  fontSize: number,
  lineHeight: number
): { height: number; lineBreaks: number[] } {
  container.style.width = `${width}px`;
  container.style.fontSize = `${fontSize}px`;
  container.style.lineHeight = `${lineHeight}`;
  container.innerHTML = escapeHtml(text);

  // 强制重绘
  void container.offsetHeight;

  const totalHeight = container.scrollHeight;
  const lineCount = Math.ceil(totalHeight / lineHeight);
  const lineBreaks: number[] = [];

  // 逐字符递增找到每行结尾
  let currentLineHeight = 0;
  for (let i = 1; i <= text.length; i++) {
    container.innerHTML = escapeHtml(text.slice(0, i));
    const currentHeight = container.scrollHeight;

    if (currentHeight > currentLineHeight + lineHeight / 2) {
      lineBreaks.push(i - 1);
      currentLineHeight = currentHeight;
    }
  }

  return { height: totalHeight, lineBreaks };
}

/**
 * 生成测量任务 ID
 */
export function createMeasurementId(params: {
  blockId: string;
  width: number;
  charOffset?: number;
}): string {
  const { blockId, width, charOffset } = params;
  const offsetPart = charOffset !== undefined ? `:o${charOffset}` : '';
  return `offscreen:${blockId}:w${Math.round(width)}${offsetPart}`;
}
