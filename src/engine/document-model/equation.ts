import katex from 'katex';

export interface RenderEquationResult {
  html: string;
  error: string | null;
}

/**
 * 渲染块级公式（displayMode: true）
 * 用于画布预览和 HTML 导出的独立公式块
 */
export function renderEquationToHtml(value: string): RenderEquationResult {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return {
      html: '<span class="empty-text-placeholder">空公式</span>',
      error: null,
    };
  }

  try {
    return {
      html: katex.renderToString(normalizedValue, {
        displayMode: true,
        throwOnError: true,
        output: 'mathml',
      }),
      error: null,
    };
  } catch (error) {
    return {
      html: `<span class="equation-render-error">公式解析失败：${escapeEquationHtml(
        error instanceof Error ? error.message : String(error),
      )}</span>`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 行内公式的正则表达式匹配模式
 * 匹配 $...$ 格式，排除空内容和转义的 $
 */
const INLINE_EQUATION_REGEX = /\$([^$\n]+?)\$/g;

/**
 * 渲染行内公式（displayMode: false）
 * 用于 TextRun 中的 $...$ 格式文本渲染
 * 行内公式纯行内渲染，无特殊容器，字体大小与当前文字保持一致
 * @param formulaContent 公式内容（不含 $ 符号）
 */
export function renderInlineEquationToHtml(formulaContent: string): string {
  const normalizedContent = formulaContent.trim();
  if (!normalizedContent) {
    return '';
  }

  try {
    // 行内模式：displayMode: false，throwOnError: false
    return katex.renderToString(normalizedContent, {
      displayMode: false,
      throwOnError: false,
      output: 'mathml',
    });
  } catch {
    // 渲染失败时返回原始内容
    return `$${normalizedContent}$`;
  }
}

/**
 * 将包含行内公式的文本分割为普通文本片段和公式片段
 * @param text 包含 $...$ 格式的文本
 * @returns 片段数组，每个片段包含 type（'text' | 'equation'）和 content
 */
export interface TextFragment {
  type: 'text' | 'equation';
  content: string;
}

export function splitInlineEquations(text: string): TextFragment[] {
  const fragments: TextFragment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // 重置正则状态
  INLINE_EQUATION_REGEX.lastIndex = 0;

  while ((match = INLINE_EQUATION_REGEX.exec(text)) !== null) {
    // 如果当前匹配位置在 lastIndex 之后，先添加前面的普通文本
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore) {
        fragments.push({ type: 'text', content: textBefore });
      }
    }

    // 添加公式片段
    // match[1] 是捕获组中的公式内容（不含 $ 符号）
    if (match[1]) {
      fragments.push({ type: 'equation', content: match[1] });
    }

    lastIndex = match.index + match[0].length;
  }

  // 添加剩余的普通文本
  if (lastIndex < text.length) {
    const textAfter = text.slice(lastIndex);
    if (textAfter) {
      fragments.push({ type: 'text', content: textAfter });
    }
  }

  return fragments;
}

function escapeEquationHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
