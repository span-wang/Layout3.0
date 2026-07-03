import { useEffect } from 'react';
import { getLayoutBlockPlainText, type LayoutBlock } from '@/engine/document-model';
import type { PageLayout } from '@/engine/typesetting';
import { useAppStore } from '@/store';
import {
  PAGINATION_PROBLEM_SEVERITY_LABELS,
  PAGINATION_PROBLEM_TAG_LABELS,
  PAGINATION_BATCH_READY_DOCUMENT_COUNT,
  PAGINATION_ROOT_CAUSE_LABELS,
} from '@/types/ai';
import type {
  PaginationProblemSeverity,
  PaginationProblemTag,
  PaginationRootCause,
  PaginationReviewItem,
  PaginationReviewVerdict,
  PaginationTrainingSample,
} from '@/types/ai';

function getBlockTypeLabel(block: LayoutBlock): string {
  switch (block.type) {
    case 'paragraph':
      return '段落';
    case 'heading':
      return '标题';
    case 'toc':
      return '目录';
    case 'list':
      return '列表';
    case 'table':
      return '表格';
    case 'image':
      return '图片';
    case 'equation':
      return '公式';
    case 'blockquote':
      return '引用';
    case 'code':
      return '代码块';
    case 'horizontalRule':
      return '分隔线';
    case 'columnBreak':
      return '分栏断点';
    case 'pageBreak':
      return '分页符';
    default:
      return block.type;
  }
}

function getBlockPreviewText(block: LayoutBlock): string {
  const text = getLayoutBlockPlainText(block).replace(/\s+/g, ' ').trim();
  if (text) {
    return text.length > 36 ? `${text.slice(0, 36)}…` : text;
  }

  switch (block.type) {
    case 'image':
      return '图片块';
    case 'table':
      return '表格块';
    case 'equation':
      return '公式块';
    case 'pageBreak':
      return '手动分页符';
    case 'columnBreak':
      return '分栏断点';
    default:
      return '无文本摘要';
  }
}

function buildPaginationReviewItems(
  pageLayouts: PageLayout[],
  previousVerdicts: Map<string, PaginationReviewVerdict | null>,
): PaginationReviewItem[] {
  if (pageLayouts.length <= 1) {
    return [];
  }

  const items: PaginationReviewItem[] = [];

  for (let index = 0; index < pageLayouts.length - 1; index += 1) {
    const currentPage = pageLayouts[index];
    const nextPage = pageLayouts[index + 1];
    const beforeBlock = currentPage.blocks.at(-1);
    const afterBlock = nextPage.blocks[0];

    if (!beforeBlock || !afterBlock) {
      continue;
    }

    const remainingHeightPx = Math.max(
      0,
      currentPage.contract.contentHeightPx - estimatePageUsagePx(currentPage),
    );
    const fillRatio = currentPage.contract.contentHeightPx > 0
      ? Math.max(0, Math.min(1, 1 - remainingHeightPx / currentPage.contract.contentHeightPx))
      : 0;
    const breakId = `page-break-${currentPage.pageNumber}-${beforeBlock.id}-${afterBlock.id}`;

    items.push({
      breakId,
      pageNumber: currentPage.pageNumber,
      breakIndex: index + 1,
      pageRemainingHeightPx: Math.round(remainingHeightPx),
      pageFillRatio: Number(fillRatio.toFixed(3)),
      before: {
        blockId: beforeBlock.id,
        blockType: getBlockTypeLabel(beforeBlock),
        textPreview: getBlockPreviewText(beforeBlock),
      },
      after: {
        blockId: afterBlock.id,
        blockType: getBlockTypeLabel(afterBlock),
        textPreview: getBlockPreviewText(afterBlock),
      },
      verdict: previousVerdicts.get(breakId) ?? null,
      problemTags: [],
      severity: null,
    });
  }

  return items;
}

function estimatePageUsagePx(page: PageLayout): number {
  if (page.blocks.length === 0) {
    return 0;
  }

  const averageBlockHeight = page.contract.contentHeightPx / Math.max(1, page.blocks.length + 1);
  return Math.min(page.contract.contentHeightPx, averageBlockHeight * page.blocks.length);
}

const VERDICT_OPTIONS: Array<{
  value: PaginationReviewVerdict;
  label: string;
}> = [
  { value: 'correct', label: '正确' },
  { value: 'incorrect', label: '不正确' },
  { value: 'unsure', label: '不确定' },
];

const PROBLEM_TAG_OPTIONS = Object.entries(PAGINATION_PROBLEM_TAG_LABELS) as Array<
  [PaginationProblemTag, string]
>;

const PROBLEM_SEVERITY_OPTIONS = Object.entries(PAGINATION_PROBLEM_SEVERITY_LABELS) as Array<
  [PaginationProblemSeverity, string]
>;

function inferRootCausesFromReviewItem(item: PaginationReviewItem): PaginationRootCause[] {
  const rootCauses = new Set<PaginationRootCause>();

  if (item.problemTags.includes('bottomContentClipped')) {
    rootCauses.add('bottomSafeAreaTooSmall');
    rootCauses.add('heightEstimationError');
  }

  if (item.problemTags.includes('headingOrphan')) {
    rootCauses.add('headingBindingTooWeak');
  }

  if (item.problemTags.includes('paragraphShortTail') || item.problemTags.includes('nextPageShortHead')) {
    rootCauses.add('tailSplitPenaltyTooWeak');
    rootCauses.add('lineBreakMismatch');
  }

  if (item.problemTags.includes('tableJumpedWhole') || item.problemTags.includes('tableCrossPageHardToRead')) {
    rootCauses.add('tableSplitStrategyTooConservative');
  }

  if (item.problemTags.includes('columnUnbalanced')) {
    rootCauses.add('columnBalanceStrategyWeak');
  }

  if (item.problemTags.includes('blankSpaceTooLarge') || item.problemTags.includes('pageJumpTooLarge')) {
    rootCauses.add('heightEstimationError');
  }

  if (item.problemTags.includes('imagePositionBad') || item.problemTags.includes('equationPositionBad')) {
    rootCauses.add('heightEstimationError');
  }

  return Array.from(rootCauses);
}

function buildPaginationTrainingSamples(items: PaginationReviewItem[]): PaginationTrainingSample[] {
  const state = useAppStore.getState();
  const layoutDocument = state.layoutDocument;
  const documentId = layoutDocument?.id ?? 'unknown-document';
  const documentTitle = layoutDocument?.title?.trim() || '未命名文档';

  return items
    .filter((item) => item.verdict !== null)
    .filter((item) => item.verdict !== 'incorrect' || item.problemTags.length > 0 || item.severity !== null)
    .map((item) => ({
      sampleId: `training-sample-${item.breakId}`,
      breakId: item.breakId,
      documentId,
      documentTitle,
      pageNumber: item.pageNumber,
      breakIndex: item.breakIndex,
      verdict: item.verdict as PaginationReviewVerdict,
      problemTags: item.problemTags,
      severity: item.severity,
      pageRemainingHeightPx: item.pageRemainingHeightPx,
      pageFillRatio: item.pageFillRatio,
      before: item.before,
      after: item.after,
      rootCauses: inferRootCausesFromReviewItem(item),
    }));
}

function buildRootCauseSummary(samples: PaginationTrainingSample[]): Array<{
  cause: PaginationRootCause;
  count: number;
}> {
  const counts = new Map<PaginationRootCause, number>();

  for (const sample of samples) {
    for (const cause of sample.rootCauses) {
      counts.set(cause, (counts.get(cause) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([cause, count]) => ({ cause, count }))
    .sort((left, right) => right.count - left.count);
}

export function AiPaginationTab(): JSX.Element {
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const pageLayouts = useAppStore((state) => state.pageLayouts);
  const paginationReviewItems = useAppStore((state) => state.paginationReviewItems);
  const paginationTrainingSamples = useAppStore((state) => state.paginationTrainingSamples);
  const paginationBatchAnalysis = useAppStore((state) => state.paginationBatchAnalysis);
  const paginationOptimizationSettings = useAppStore((state) => state.paginationOptimizationSettings);
  const hasAppliedPaginationBatchOptimization = useAppStore((state) => state.hasAppliedPaginationBatchOptimization);
  const setPaginationReviewItems = useAppStore((state) => state.setPaginationReviewItems);
  const setPaginationReviewVerdict = useAppStore((state) => state.setPaginationReviewVerdict);
  const togglePaginationReviewProblemTag = useAppStore((state) => state.togglePaginationReviewProblemTag);
  const setPaginationReviewSeverity = useAppStore((state) => state.setPaginationReviewSeverity);
  const setPaginationTrainingSamples = useAppStore((state) => state.setPaginationTrainingSamples);
  const addPaginationTrainingSamplesToBatch = useAppStore((state) => state.addPaginationTrainingSamplesToBatch);
  const applyPaginationBatchOptimization = useAppStore((state) => state.applyPaginationBatchOptimization);
  const clearPaginationBatchOptimization = useAppStore((state) => state.clearPaginationBatchOptimization);

  useEffect(() => {
    const previousItems = new Map(
      useAppStore.getState().paginationReviewItems.map((item) => [item.breakId, item] as const)
    );
    const nextItems = buildPaginationReviewItems(
      pageLayouts,
      new Map(Array.from(previousItems.entries()).map(([breakId, item]) => [breakId, item.verdict] as const)),
    ).map((item) => {
      const previousItem = previousItems.get(item.breakId);
      return previousItem
        ? {
            ...item,
            problemTags: previousItem.problemTags,
            severity: previousItem.severity,
          }
        : item;
    });
    setPaginationReviewItems(nextItems);
  }, [pageLayouts, setPaginationReviewItems]);

  useEffect(() => {
    setPaginationTrainingSamples(buildPaginationTrainingSamples(paginationReviewItems));
  }, [paginationReviewItems, setPaginationTrainingSamples]);

  if (pageLayouts.length === 0) {
    return (
      <div className="ai-pagination-tab">
        <div className="ai-section">
          <h3 className="ai-section-title">分页审核</h3>
          <p className="ai-description">当前没有可审核的分页结果，请先打开文档。</p>
        </div>
      </div>
    );
  }

  if (pageLayouts.length === 1 || paginationReviewItems.length === 0) {
    return (
      <div className="ai-pagination-tab">
        <div className="ai-section">
          <h3 className="ai-section-title">分页审核</h3>
          <p className="ai-description">当前只有 1 页，暂时没有可审核的分页点。</p>
        </div>
      </div>
    );
  }

  const reviewedCount = paginationReviewItems.filter((item) => item.verdict !== null).length;
  const rootCauseSummary = buildRootCauseSummary(paginationTrainingSamples);
  const currentDocumentId = layoutDocument?.id ?? 'unknown-document';
  const currentDocumentBatchEntry = paginationBatchAnalysis.documents.find(
    (entry) => entry.documentId === currentDocumentId,
  );

  return (
    <div className="ai-pagination-tab">
      <div className="ai-section">
        <div className="ai-result-header">
          <h3 className="ai-section-title">分页审核</h3>
          <span className="ai-pagination-summary">
            已判断 {reviewedCount} / {paginationReviewItems.length}
          </span>
        </div>
        <p className="ai-description">
          请逐个判断当前分页点是否合理。本步先只记录“正确 / 不正确 / 不确定”，后续再接问题类型和自动优化。
        </p>
      </div>

      <div className="ai-pagination-review-list">
        {paginationReviewItems.map((item) => (
          <article key={item.breakId} className="ai-pagination-review-card">
            <div className="ai-pagination-review-meta">
              <strong>分页点 {item.breakIndex}</strong>
              <span>第 {item.pageNumber} 页末</span>
              <span>剩余 {item.pageRemainingHeightPx}px</span>
              <span>填充率 {(item.pageFillRatio * 100).toFixed(1)}%</span>
            </div>

            <div className="ai-pagination-review-context">
              <div className="ai-pagination-review-side">
                <span className="ai-pagination-review-label">分页前</span>
                <strong>{item.before.blockType}</strong>
                <p>{item.before.textPreview}</p>
              </div>
              <div className="ai-pagination-review-side">
                <span className="ai-pagination-review-label">分页后</span>
                <strong>{item.after.blockType}</strong>
                <p>{item.after.textPreview}</p>
              </div>
            </div>

            <div className="ai-pagination-review-actions" role="radiogroup" aria-label={`分页点 ${item.breakIndex} 判断`}>
              {VERDICT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`ai-pagination-verdict-button ${item.verdict === option.value ? 'active' : ''}`}
                  onClick={() =>
                    setPaginationReviewVerdict(
                      item.breakId,
                      item.verdict === option.value ? null : option.value
                    )
                  }
                  aria-pressed={item.verdict === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {item.verdict === 'incorrect' ? (
              <div className="ai-pagination-problem-panel">
                <div className="ai-pagination-problem-group">
                  <span className="ai-pagination-problem-title">问题标签</span>
                  <div className="ai-pagination-problem-tags">
                    {PROBLEM_TAG_OPTIONS.map(([tag, label]) => (
                      <button
                        key={tag}
                        type="button"
                        className={`ai-pagination-problem-tag ${item.problemTags.includes(tag) ? 'active' : ''}`}
                        onClick={() => togglePaginationReviewProblemTag(item.breakId, tag)}
                        aria-pressed={item.problemTags.includes(tag)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ai-pagination-problem-group">
                  <span className="ai-pagination-problem-title">严重度</span>
                  <div className="ai-pagination-problem-severity">
                    {PROBLEM_SEVERITY_OPTIONS.map(([severity, label]) => (
                      <button
                        key={severity}
                        type="button"
                        className={`ai-pagination-severity-button ${item.severity === severity ? 'active' : ''}`}
                        onClick={() =>
                          setPaginationReviewSeverity(
                            item.breakId,
                            item.severity === severity ? null : severity
                          )
                        }
                        aria-pressed={item.severity === severity}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {item.problemTags.length > 0 || item.severity ? (
              <div className="ai-pagination-problem-summary">
                <span className="ai-pagination-problem-title">已标注</span>
                <p>
                  {item.problemTags.map((tag) => PAGINATION_PROBLEM_TAG_LABELS[tag]).join('、') || '未选问题'}
                  {item.severity ? ` / ${PAGINATION_PROBLEM_SEVERITY_LABELS[item.severity]}` : ''}
                </p>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <div className="ai-section ai-result-section">
        <div className="ai-result-header">
          <h3 className="ai-section-title">训练样本预览</h3>
          <span className="ai-pagination-summary">
            已生成 {paginationTrainingSamples.length} 条
          </span>
        </div>

        <div className="ai-result-actions">
          <button
            type="button"
            className="ai-button ai-button-primary"
            disabled={paginationTrainingSamples.length === 0}
            onClick={() =>
              addPaginationTrainingSamplesToBatch({
                documentId: currentDocumentId,
                documentTitle: layoutDocument?.title?.trim() || '未命名文档',
                samples: paginationTrainingSamples,
              })
            }
          >
            加入当前批次
          </button>
        </div>

        {paginationTrainingSamples.length === 0 ? (
          <div className="ai-pagination-empty-samples">
            <span>当前还没有可用训练样本，请先判断分页点并补充问题标签。</span>
          </div>
        ) : (
          <div className="ai-pagination-sample-list">
            {paginationTrainingSamples.map((sample) => (
              <article key={sample.sampleId} className="ai-pagination-sample-card">
                <div className="ai-pagination-review-meta">
                  <strong>样本 {sample.breakIndex}</strong>
                  <span>{sample.documentTitle}</span>
                  <span>第 {sample.pageNumber} 页末</span>
                  <span>{sample.verdict === 'correct' ? '正确' : sample.verdict === 'incorrect' ? '不正确' : '不确定'}</span>
                  <span>剩余 {sample.pageRemainingHeightPx}px</span>
                  <span>填充率 {(sample.pageFillRatio * 100).toFixed(1)}%</span>
                </div>
                <p className="ai-pagination-sample-text">
                  前：{sample.before.blockType} / {sample.before.textPreview}
                </p>
                <p className="ai-pagination-sample-text">
                  后：{sample.after.blockType} / {sample.after.textPreview}
                </p>
                <p className="ai-pagination-sample-text">
                  标签：{sample.problemTags.length > 0
                    ? sample.problemTags.map((tag) => PAGINATION_PROBLEM_TAG_LABELS[tag]).join('、')
                    : '无'}
                  {sample.severity ? ` / ${PAGINATION_PROBLEM_SEVERITY_LABELS[sample.severity]}` : ''}
                </p>
                <p className="ai-pagination-sample-text">
                  根因：{sample.rootCauses.length > 0
                    ? sample.rootCauses.map((cause) => PAGINATION_ROOT_CAUSE_LABELS[cause]).join('、')
                    : '暂未识别'}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="ai-section ai-result-section">
        <div className="ai-result-header">
          <h3 className="ai-section-title">根因分析结果</h3>
          <span className="ai-pagination-summary">
            已识别 {rootCauseSummary.length} 类
          </span>
        </div>

        {rootCauseSummary.length === 0 ? (
          <div className="ai-pagination-empty-samples">
            <span>当前还没有可分析的根因，请先补充不正确分页点的标签与严重度。</span>
          </div>
        ) : (
          <div className="ai-pagination-sample-list">
            {rootCauseSummary.map((item) => (
              <article key={item.cause} className="ai-pagination-sample-card">
                <div className="ai-pagination-review-meta">
                  <strong>{PAGINATION_ROOT_CAUSE_LABELS[item.cause]}</strong>
                  <span>命中 {item.count} 条样本</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="ai-section ai-result-section">
        <div className="ai-result-header">
          <h3 className="ai-section-title">批次分析</h3>
          <span className="ai-pagination-summary">
            已收集 {paginationBatchAnalysis.documentCount} / {PAGINATION_BATCH_READY_DOCUMENT_COUNT} 篇
          </span>
        </div>

        <p className="ai-description">
          当前批次收集到 1 篇文章后，就可以基于已识别根因应用分页优化参数。
        </p>

        <div className="ai-pagination-sample-card">
          <div className="ai-pagination-review-meta">
            <strong>当前文档状态</strong>
            <span>{currentDocumentBatchEntry ? '已加入批次' : '未加入批次'}</span>
            <span>{paginationBatchAnalysis.isReady ? '批次已就绪' : '批次未就绪'}</span>
          </div>
        </div>

        {paginationBatchAnalysis.documents.length === 0 ? (
          <div className="ai-pagination-empty-samples">
            <span>当前批次还没有文章，请先为当前文档生成训练样本并加入批次。</span>
          </div>
        ) : (
          <div className="ai-pagination-sample-list">
            {paginationBatchAnalysis.documents.map((entry) => (
              <article key={entry.documentId} className="ai-pagination-sample-card">
                <div className="ai-pagination-review-meta">
                  <strong>{entry.documentTitle}</strong>
                  <span>样本 {entry.samples.length} 条</span>
                  <span>{new Date(entry.addedAt).toLocaleString('zh-CN')}</span>
                </div>
              </article>
            ))}
          </div>
        )}

        {paginationBatchAnalysis.rootCauseStats.length > 0 ? (
          <div className="ai-pagination-sample-list">
            {paginationBatchAnalysis.rootCauseStats.map((stat) => (
              <article key={stat.cause} className="ai-pagination-sample-card">
                <div className="ai-pagination-review-meta">
                  <strong>{PAGINATION_ROOT_CAUSE_LABELS[stat.cause]}</strong>
                  <span>样本数 {stat.sampleCount}</span>
                  <span>严重度总分 {stat.severityScore}</span>
                  <span>影响分页点 {stat.affectedBreakCount}</span>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className="ai-result-actions">
          <button
            type="button"
            className="ai-button ai-button-primary"
            disabled={!paginationBatchAnalysis.isReady}
            onClick={applyPaginationBatchOptimization}
          >
            应用批次优化
          </button>
          <button
            type="button"
            className="ai-button"
            disabled={!hasAppliedPaginationBatchOptimization}
            onClick={clearPaginationBatchOptimization}
          >
            清除本次优化
          </button>
        </div>

        {!paginationBatchAnalysis.isReady ? (
          <div className="ai-pagination-empty-samples">
            <span>当前批次还没有文章，请先加入至少 1 篇文章后再应用批次优化。</span>
          </div>
        ) : null}

        {paginationOptimizationSettings ? (
          <div className="ai-pagination-sample-list">
            <article className="ai-pagination-sample-card">
              <div className="ai-pagination-review-meta">
                <strong>当前运行时优化参数</strong>
                <span>{hasAppliedPaginationBatchOptimization ? '已应用' : '未应用'}</span>
              </div>
              <p className="ai-pagination-sample-text">页底安全边界：{paginationOptimizationSettings.bottomSafeAreaPx}px</p>
              <p className="ai-pagination-sample-text">高度保守系数：{paginationOptimizationSettings.heightReserveFactor}</p>
              <p className="ai-pagination-sample-text">真实换行优先级提升：{paginationOptimizationSettings.measuredLineBreakPriorityBoost}</p>
              <p className="ai-pagination-sample-text">标题同页保护提升：{paginationOptimizationSettings.headingKeepWithNextBoost}</p>
              <p className="ai-pagination-sample-text">短尾惩罚提升：{paginationOptimizationSettings.shortTailPenaltyBoost}</p>
              <p className="ai-pagination-sample-text">表格按行拆分优先级提升：{paginationOptimizationSettings.tableRowSplitPriorityBoost}</p>
              <p className="ai-pagination-sample-text">多栏均衡权重提升：{paginationOptimizationSettings.columnBalancePenaltyBoost}</p>
            </article>
          </div>
        ) : null}
      </div>
    </div>
  );
}
