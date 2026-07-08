import { getHeadingText, type LayoutBlock } from '@/engine/document-model';
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

interface HeaderFooterPageTitleSource {
  blocks: LayoutBlock[];
}

function normalizeTitle(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeOptionalTitle(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function resolvePageOwnHeading1Title(blocks: LayoutBlock[]): string | null {
  const headingBlock = blocks.find(
    (block) => block.type === 'heading' && block.metadata.kind === 'heading' && block.metadata.depth === 1,
  );
  return headingBlock ? normalizeOptionalTitle(getHeadingText(headingBlock)) : null;
}

// 页眉默认显示“当前页所属一级标题”，因此没有 H1 的页需要向前继承最近一级标题。
export function buildHeaderFooterPageTitles(
  pages: HeaderFooterPageTitleSource[],
  fallbackTitle: string,
): string[] {
  let currentTitle = normalizeTitle(fallbackTitle, '未命名文档');

  return pages.map((page) => {
    const heading1Title = resolvePageOwnHeading1Title(page.blocks);
    if (heading1Title) {
      currentTitle = heading1Title;
    }
    return currentTitle;
  });
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
