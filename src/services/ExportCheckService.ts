import {
  getVisibleTocItemsForBlock,
  splitInlineEquations,
  type AnswerBlockPlacementMode,
  type AnswerDisplayMode,
  type ImageBlockMetadata,
  type LayoutBlock,
  type LayoutDocument,
  type LayoutImageResource,
  type LayoutResource,
  type TocItem,
} from '@/engine/document-model';
import type { StyleSettings } from '@/engine/style/types';
import type { LayoutWarning, LayoutWarningType, PageLayout } from '@/engine/typesetting/types';

export type ExportCheckSeverity = 'error' | 'warning' | 'notice';
export type ExportCheckTarget = 'all' | 'pdf' | 'docx';
export type ExportCheckCategory = '分页' | '图片' | '目录' | '答案视图' | 'DOCX 兼容' | '页面背景' | '水印';

export interface ExportCheckItem {
  id: string;
  severity: ExportCheckSeverity;
  target: ExportCheckTarget;
  category: ExportCheckCategory;
  title: string;
  message: string;
  suggestion: string;
  blockId?: string | null;
  pageNumber?: number | null;
}

export interface ExportCheckSummary {
  totalCount: number;
  errorCount: number;
  warningCount: number;
  noticeCount: number;
}

export interface ExportCheckResult {
  items: ExportCheckItem[];
  summary: ExportCheckSummary;
}

export interface RunExportChecksPayload {
  layoutDocument: LayoutDocument | null;
  renderableBlocks: LayoutBlock[];
  pages: PageLayout[];
  styleSettings: StyleSettings;
  tocItems: TocItem[];
  documentFilePath?: string | null;
  workspaceRootPath?: string | null;
}

const unsupportedDocxEquationPatterns: Array<{
  pattern: RegExp;
  label: string;
}> = [
  {
    pattern: /\\begin\{(?:matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix)\}|\\(?:matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix)\b/u,
    label: '矩阵或行列式',
  },
  {
    pattern: /\\(?:binom|dbinom|tbinom)\b/u,
    label: '组合数结构',
  },
  {
    pattern: /\\begin\{(?:align\*?|alignedat\*?|flalign\*?)\}|\\end\{(?:align\*?|alignedat\*?|flalign\*?)\}/u,
    label: '多对齐方程环境',
  },
  {
    pattern: /\\text\{/u,
    label: '复杂文本模式',
  },
];

const severityRank: Record<ExportCheckSeverity, number> = {
  error: 0,
  warning: 1,
  notice: 2,
};

function createEmptySummary(): ExportCheckSummary {
  return {
    totalCount: 0,
    errorCount: 0,
    warningCount: 0,
    noticeCount: 0,
  };
}

function buildSummary(items: ExportCheckItem[]): ExportCheckSummary {
  return items.reduce<ExportCheckSummary>((summary, item) => {
    summary.totalCount += 1;
    if (item.severity === 'error') {
      summary.errorCount += 1;
      return summary;
    }
    if (item.severity === 'warning') {
      summary.warningCount += 1;
      return summary;
    }
    summary.noticeCount += 1;
    return summary;
  }, createEmptySummary());
}

function sortExportCheckItems(items: ExportCheckItem[]): ExportCheckItem[] {
  return [...items].sort((left, right) => {
    const severityDiff = severityRank[left.severity] - severityRank[right.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }

    const targetWeight = left.target.localeCompare(right.target, 'zh-CN');
    if (targetWeight !== 0) {
      return targetWeight;
    }

    return left.title.localeCompare(right.title, 'zh-CN');
  });
}

function pushItem(targetItems: ExportCheckItem[], item: ExportCheckItem): void {
  targetItems.push(item);
}

function walkBlocks(blocks: LayoutBlock[], visitor: (block: LayoutBlock) => void): void {
  for (const block of blocks) {
    visitor(block);

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      walkBlocks(block.metadata.blocks, visitor);
      continue;
    }

    if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
      walkBlocks(block.metadata.blocks, visitor);
    }
  }
}

function findMatchingImageResource(resources: LayoutResource[], blockId: string): LayoutImageResource | null {
  const matchedResource = resources.find((resource) => resource.type === 'image' && resource.blockId === blockId);
  return matchedResource?.type === 'image' ? matchedResource : null;
}

function isAbsoluteLikePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/u.test(value) || value.startsWith('\\\\') || value.startsWith('/');
}

function isResolvableAssetPath(
  value: string,
  documentFilePath?: string | null,
  workspaceRootPath?: string | null,
): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/^(https?:|data:|blob:|file:|layout-asset:)/iu.test(trimmed)) {
    return true;
  }

  if (isAbsoluteLikePath(trimmed)) {
    return true;
  }

  return !!(documentFilePath || workspaceRootPath);
}

function getWarningSeverity(type: LayoutWarningType): ExportCheckSeverity {
  return type === 'forcedOverflow' ? 'error' : 'warning';
}

function collectLayoutWarningChecks(pages: PageLayout[], targetItems: ExportCheckItem[]): void {
  for (const page of pages) {
    for (const warning of page.warnings) {
      pushItem(targetItems, {
        id: `layout-warning-${page.pageNumber}-${warning.type}-${warning.blockType}-${targetItems.length}`,
        severity: getWarningSeverity(warning.type),
        target: 'all',
        category: '分页',
        title: `第 ${warning.pageNumber} 页 · ${warning.blockLabel}`,
        message: warning.message,
        suggestion: warning.suggestion,
        pageNumber: warning.pageNumber,
      });
    }
  }
}

function collectImageChecks(
  blocks: LayoutBlock[],
  resources: LayoutResource[],
  documentFilePath: string | null | undefined,
  workspaceRootPath: string | null | undefined,
  targetItems: ExportCheckItem[],
): void {
  walkBlocks(blocks, (block) => {
    if (block.type !== 'image' || block.metadata.kind !== 'image') {
      return;
    }

    const metadata = block.metadata;
    const blockTitle = metadata.title?.trim() || metadata.alt?.trim() || '图片块';
    const matchingResource = findMatchingImageResource(resources, block.id);

    if (!metadata.src.trim()) {
      pushItem(targetItems, {
        id: `image-empty-src-${block.id}`,
        severity: 'error',
        target: 'all',
        category: '图片',
        title: `${blockTitle} 缺少图片路径`,
        message: '当前图片块没有可导出的图片路径，PDF 和 DOCX 都无法带出真实图片内容。',
        suggestion: '请先重新选择图片文件，再继续导出。',
        blockId: block.id,
      });
      return;
    }

    if (!isResolvableAssetPath(metadata.src, documentFilePath, workspaceRootPath)) {
      pushItem(targetItems, {
        id: `image-relative-src-${block.id}`,
        severity: 'warning',
        target: 'all',
        category: '图片',
        title: `${blockTitle} 依赖相对路径`,
        message: '当前图片使用相对路径，但文档文件路径或工作区根路径还不明确，导出时可能找不到资源。',
        suggestion: '建议先保存文档到工作区，或把图片重新选择为可解析路径。',
        blockId: block.id,
      });
    }

    if (!matchingResource) {
      pushItem(targetItems, {
        id: `image-missing-resource-${block.id}`,
        severity: 'warning',
        target: 'all',
        category: '图片',
        title: `${blockTitle} 资源记录缺失`,
        message: '当前图片块没有匹配的资源记录，导出虽然可能成功，但资源库和正文状态已经不同步。',
        suggestion: '建议重新替换一次图片，确保资源记录和正文保持一致。',
        blockId: block.id,
      });
      return;
    }

    if (matchingResource.src !== metadata.src) {
      pushItem(targetItems, {
        id: `image-resource-mismatch-${block.id}`,
        severity: 'warning',
        target: 'all',
        category: '图片',
        title: `${blockTitle} 资源路径与正文不一致`,
        message: '图片块路径和资源库记录不一致，后续替换、定位或导出排查会更难判断真实来源。',
        suggestion: '建议重新替换图片，让资源记录与正文路径重新对齐。',
        blockId: block.id,
      });
    }

    collectDocxImageChecks(block.id, blockTitle, metadata, targetItems);
  });
}

function collectDocxImageChecks(
  blockId: string,
  blockTitle: string,
  metadata: ImageBlockMetadata,
  targetItems: ExportCheckItem[],
): void {
  const wrapMode = metadata.wrapMode ?? 'inline';
  const hasFreeOffset = Math.abs(metadata.offsetX ?? 0) > 0 || Math.abs(metadata.offsetY ?? 0) > 0;

  if (wrapMode === 'square' || wrapMode === 'tight') {
    pushItem(targetItems, {
      id: `docx-image-wrap-${blockId}`,
      severity: 'warning',
      target: 'docx',
      category: 'DOCX 兼容',
      title: `${blockTitle} 使用复杂文字绕排`,
      message: 'DOCX 当前不会保留四周型 / 紧密型图片绕排效果，导出后通常会退回更简单的图片排布。',
      suggestion: '如果 DOCX 是最终交付格式，建议改用嵌入型或上下型图片排布后再导出。',
      blockId,
    });
  }

  if (hasFreeOffset) {
    pushItem(targetItems, {
      id: `docx-image-offset-${blockId}`,
      severity: 'warning',
      target: 'docx',
      category: 'DOCX 兼容',
      title: `${blockTitle} 使用了自由拖动偏移`,
      message: 'DOCX 当前不会保留图片在页面中的自由拖动偏移，导出后图片位置会回到更基础的对齐方式。',
      suggestion: '如果需要 DOCX 稳定复现位置，建议在导出前把图片恢复到常规对齐状态。',
      blockId,
    });
  }
}

function collectTocChecks(blocks: LayoutBlock[], tocItems: TocItem[], targetItems: ExportCheckItem[]): void {
  walkBlocks(blocks, (block) => {
    if (block.type !== 'toc' || block.metadata.kind !== 'toc') {
      return;
    }

    const visibleItems = getVisibleTocItemsForBlock(block, tocItems);
    if (visibleItems.length === 0) {
      pushItem(targetItems, {
        id: `toc-empty-${block.id}`,
        severity: 'notice',
        target: 'all',
        category: '目录',
        title: '目录块当前没有可显示的标题',
        message: '当前目录块在所选层级下没有可见标题项，导出后目录区会保持空状态提示。',
        suggestion: '请检查标题层级是否存在，或调整目录块的层级范围后再导出。',
        blockId: block.id,
      });
      return;
    }

    if (visibleItems.some((item) => item.pageNumber === undefined)) {
      pushItem(targetItems, {
        id: `toc-missing-page-${block.id}`,
        severity: 'warning',
        target: 'all',
        category: '目录',
        title: '目录页码仍有缺失',
        message: '当前目录中仍有标题页码没有成功回填，导出后对应条目会显示占位页码。',
        suggestion: '请先检查分页结果是否稳定，再重新查看目录页码是否完整。',
        blockId: block.id,
      });
    }
  });
}

function collectAnswerModeChecks(
  answerDisplayMode: AnswerDisplayMode,
  answerBlockPlacementMode: AnswerBlockPlacementMode,
  targetItems: ExportCheckItem[],
): void {
  if (answerDisplayMode !== 'show') {
    pushItem(targetItems, {
      id: `answer-mode-${answerDisplayMode}`,
      severity: 'notice',
      target: 'all',
      category: '答案视图',
      title: '当前导出会沿用答案显示模式',
      message:
        answerDisplayMode === 'underline'
          ? '当前处于默写挖空模式，导出结果会隐藏下划线文字并保留下划线，同时隐藏答案与解析。'
          : '当前处于隐藏答案模式，导出结果不会显示答案与解析正文。',
      suggestion: '如果这次导出需要教师版内容，请先切回“显示答案”再导出。',
    });
  }

  if (answerDisplayMode === 'show' && answerBlockPlacementMode === 'document-end') {
    pushItem(targetItems, {
      id: 'answer-placement-document-end',
      severity: 'notice',
      target: 'all',
      category: '答案视图',
      title: '答案与解析会统一移动到文末',
      message: '当前视图已切到“文末统一显示”，导出结果会按文末汇总后的顺序输出答案与解析。',
      suggestion: '如果希望答案和题目保持原位，请先切回“题后原位显示”再导出。',
    });
  }
}

function collectDocxStructureChecks(
  styleSettings: StyleSettings,
  blocks: LayoutBlock[],
  targetItems: ExportCheckItem[],
): void {
  if (styleSettings.columns.count > 1) {
    pushItem(targetItems, {
      id: 'docx-page-columns',
      severity: 'warning',
      target: 'docx',
      category: 'DOCX 兼容',
      title: '整页分栏不会完整保留到 DOCX',
      message: 'DOCX 当前按连续正文流导出，不会完整保留整页单栏 / 双栏 / 三栏的分页阅读效果。',
      suggestion: '如果 DOCX 是最终交付格式，建议重点复核导出后的段落顺序和页面观感。',
    });
  }

  const columnSectionBlocks: LayoutBlock[] = [];
  walkBlocks(blocks, (block) => {
    if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
      columnSectionBlocks.push(block);
    }
  });

  if (columnSectionBlocks.length > 0) {
    pushItem(targetItems, {
      id: 'docx-column-section-unsupported',
      severity: 'error',
      target: 'docx',
      category: 'DOCX 兼容',
      title: '局部分栏区段当前不会正确导出到 DOCX',
      message: `当前文档包含 ${columnSectionBlocks.length} 个局部分栏区段；DOCX 导出链路还没有为这类容器建立等价结构，存在内容缺失或顺序异常风险。`,
      suggestion: '如果这次必须导出 DOCX，请先取消局部分栏，或改走 PDF 作为最终交付格式。',
      blockId: columnSectionBlocks[0]?.id ?? null,
    });
  }
}

function collectPageBackgroundChecks(styleSettings: StyleSettings, targetItems: ExportCheckItem[]): void {
  if (styleSettings.pageBackground.mode === 'image' && !styleSettings.pageBackground.imageSrc.trim()) {
    pushItem(targetItems, {
      id: 'background-image-empty',
      severity: 'error',
      target: 'all',
      category: '页面背景',
      title: '页面背景已切到图片模式，但缺少图片路径',
      message: '当前页面背景启用了图片模式，但还没有实际背景图路径，导出结果会回退到空背景。',
      suggestion: '请先补齐背景图，或切回纯色 / 跟随主题后再导出。',
    });
  }

  if (styleSettings.pageBackground.mode === 'image' && styleSettings.pageBackground.imageSrc.trim()) {
    pushItem(targetItems, {
      id: 'docx-background-image',
      severity: 'notice',
      target: 'docx',
      category: '页面背景',
      title: 'DOCX 不会保留整页背景图效果',
      message: '当前文档使用了页面背景图，但 DOCX 导出不会完整复现整页背景图片的视觉效果。',
      suggestion: '如果背景图是最终成品的一部分，建议优先导出 PDF。',
    });
  }
}

function collectPdfWatermarkChecks(styleSettings: StyleSettings, targetItems: ExportCheckItem[]): void {
  const watermark = styleSettings.pdfWatermark;
  if (!watermark.enabled) {
    return;
  }

  if (watermark.kind === 'image' && !watermark.image.imageSrc.trim()) {
    pushItem(targetItems, {
      id: 'pdf-watermark-image-empty',
      severity: 'error',
      target: 'pdf',
      category: '水印',
      title: '图片水印已启用，但缺少图片路径',
      message: '当前 PDF 图片水印已经开启，但还没有实际图片路径，导出时不会带出图片水印。',
      suggestion: '请先选择一张本地图片，或改回文字水印后再导出 PDF。',
    });
  }
}

function collectDocxEquationChecks(blocks: LayoutBlock[], targetItems: ExportCheckItem[]): void {
  walkBlocks(blocks, (block) => {
    const equationSamples: Array<{
      id: string;
      source: string;
      label: string;
    }> = [];

    if (block.type === 'equation' && block.metadata.kind === 'equation') {
      equationSamples.push({
        id: `${block.id}-equation`,
        source: block.metadata.value,
        label: '块级公式',
      });
    }

    if (block.textRuns.length > 0) {
      block.textRuns.forEach((run, runIndex) => {
        const fragments = splitInlineEquations(run.text);
        fragments.forEach((fragment, fragmentIndex) => {
          if (fragment.type !== 'equation') {
            return;
          }

          equationSamples.push({
            id: `${block.id}-inline-${runIndex}-${fragmentIndex}`,
            source: fragment.content,
            label: '行内公式',
          });
        });
      });
    }

    for (const sample of equationSamples) {
      const matchedPattern = unsupportedDocxEquationPatterns.find((candidate) => candidate.pattern.test(sample.source));
      if (!matchedPattern) {
        continue;
      }

      pushItem(targetItems, {
        id: `docx-equation-${sample.id}`,
        severity: 'warning',
        target: 'docx',
        category: 'DOCX 兼容',
        title: `${sample.label}包含 ${matchedPattern.label}`,
        message: 'DOCX 当前只覆盖常见公式子集；这类公式结构导出时仍可能退回源码或变成低保真结果。',
        suggestion: '建议先导出 DOCX 实测一遍该公式；如果需要高保真交付，优先改走 PDF。',
        blockId: block.id,
      });
    }
  });
}

export function runExportChecks(payload: RunExportChecksPayload): ExportCheckResult {
  if (!payload.layoutDocument) {
    return {
      items: [],
      summary: createEmptySummary(),
    };
  }

  const items: ExportCheckItem[] = [];

  collectLayoutWarningChecks(payload.pages, items);
  collectImageChecks(
    payload.renderableBlocks,
    payload.layoutDocument.resources,
    payload.documentFilePath,
    payload.workspaceRootPath,
    items,
  );
  collectTocChecks(payload.renderableBlocks, payload.tocItems, items);
  collectAnswerModeChecks(
    payload.layoutDocument.viewState.answerDisplayMode,
    payload.layoutDocument.viewState.answerBlockPlacementMode,
    items,
  );
  collectDocxStructureChecks(payload.styleSettings, payload.renderableBlocks, items);
  collectPageBackgroundChecks(payload.styleSettings, items);
  collectPdfWatermarkChecks(payload.styleSettings, items);
  collectDocxEquationChecks(payload.renderableBlocks, items);

  const sortedItems = sortExportCheckItems(items);
  return {
    items: sortedItems,
    summary: buildSummary(sortedItems),
  };
}

export function getExportCheckItemsForTarget(
  result: ExportCheckResult,
  target: Exclude<ExportCheckTarget, 'all'>,
): ExportCheckItem[] {
  return result.items.filter((item) => item.target === 'all' || item.target === target);
}

export function buildExportCheckSummary(items: ExportCheckItem[]): ExportCheckSummary {
  return buildSummary(items);
}

function getTargetLabel(target: Exclude<ExportCheckTarget, 'all'>): string {
  return target === 'pdf' ? 'PDF' : 'DOCX';
}

function getSeverityLabel(severity: ExportCheckSeverity): string {
  if (severity === 'error') {
    return '错误';
  }
  if (severity === 'warning') {
    return '警告';
  }
  return '提醒';
}

export function buildExportCheckConfirmMessage(
  result: ExportCheckResult,
  target: Exclude<ExportCheckTarget, 'all'>,
): string | null {
  const targetItems = getExportCheckItemsForTarget(result, target);
  const actionableItems = targetItems.filter((item) => item.severity !== 'notice');
  if (actionableItems.length === 0) {
    return null;
  }

  const summary = buildSummary(actionableItems);
  const previewLines = actionableItems
    .slice(0, 4)
    .map((item) => `- [${getSeverityLabel(item.severity)}] ${item.title}`)
    .join('\n');
  const moreCount =
    actionableItems.length > 4
      ? `\n- 其余 ${actionableItems.length - 4} 条请在右侧“导出检查”面板查看`
      : '';

  return [
    `导出 ${getTargetLabel(target)} 前发现 ${actionableItems.length} 条风险提示：`,
    `错误 ${summary.errorCount} 条，警告 ${summary.warningCount} 条，提醒 ${summary.noticeCount} 条。`,
    '',
    previewLines,
    moreCount,
    '',
    '是否继续导出？',
  ].join('\n');
}

export function getExportCheckSeverityLabel(severity: ExportCheckSeverity): string {
  return getSeverityLabel(severity);
}

export function getExportCheckTargetLabel(target: ExportCheckTarget): string {
  if (target === 'all') {
    return '通用';
  }

  return getTargetLabel(target);
}

export function hasExportCheckIssues(result: ExportCheckResult): boolean {
  return result.items.length > 0;
}

export function collectLayoutWarningsFromPages(pages: PageLayout[]): LayoutWarning[] {
  return pages.flatMap((page) => page.warnings);
}
