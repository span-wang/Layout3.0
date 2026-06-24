import katex from 'katex';

export interface RenderEquationResult {
  html: string;
  error: string | null;
}

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

function escapeEquationHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
