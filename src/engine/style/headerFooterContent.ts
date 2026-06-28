import type { HeaderFooterContent, HeaderFooterLineContent, ResolvedStyleContract } from './types';

export interface HeaderFooterRenderContext {
  documentTitle: string;
  pageTitle: string;
  pageNumber: number;
  totalPages: number;
  contract: ResolvedStyleContract;
}

export interface RenderedHeaderFooterContent {
  header: HeaderFooterLineContent;
  footer: HeaderFooterLineContent;
}

const variableLabels = ['{文档标题}', '{本页标题}', '{页码}', '{总页数}', '{页面规格}', '{模板主题}'] as const;

export const headerFooterVariableLabels: string[] = [...variableLabels];

function normalizeTitle(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function renderTemplateText(template: string, context: HeaderFooterRenderContext): string {
  const values: Record<(typeof variableLabels)[number], string> = {
    '{文档标题}': normalizeTitle(context.documentTitle, '未命名文档'),
    '{本页标题}': normalizeTitle(context.pageTitle, normalizeTitle(context.documentTitle, '未命名文档')),
    '{页码}': String(context.pageNumber),
    '{总页数}': String(Math.max(1, context.totalPages)),
    '{页面规格}': context.contract.pageLabel,
    '{模板主题}': context.contract.templateThemeLabel,
  };

  // 页眉页脚变量保持中文占位符，用户直接能看懂；未识别内容按普通文字保留。
  return variableLabels.reduce((text, label) => text.replaceAll(label, values[label]), template);
}

function renderLineContent(
  line: HeaderFooterLineContent,
  context: HeaderFooterRenderContext,
): HeaderFooterLineContent {
  return {
    left: renderTemplateText(line.left, context),
    center: renderTemplateText(line.center, context),
    right: renderTemplateText(line.right, context),
  };
}

export function renderHeaderFooterContent(
  content: HeaderFooterContent,
  context: HeaderFooterRenderContext,
): RenderedHeaderFooterContent {
  return {
    header: renderLineContent(content.header, context),
    footer: renderLineContent(content.footer, context),
  };
}
