import type { ColumnSectionBlockMetadata, LayoutBlock } from '@/engine/document-model';
import type { ResolvedStyleContract } from './types';

const MM_TO_PX = 96 / 25.4;

function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_PX * 100) / 100;
}

function resolveContainerContentWidthPx(contract: ResolvedStyleContract): number {
  return contract.columnCount > 1 ? contract.singleColumnContentWidthPx : contract.contentWidthPx;
}

function resolveContainerContentWidthMm(contract: ResolvedStyleContract): number {
  return contract.columnCount > 1 ? contract.singleColumnContentWidthMm : contract.contentWidthMm;
}

export function shouldLayoutBlockSpanAllColumns(
  block: LayoutBlock,
  contract?: ResolvedStyleContract,
): boolean {
  if (!contract || contract.columnCount <= 1 || block.type !== 'heading' || block.metadata.kind !== 'heading') {
    return false;
  }

  // 一级标题承担章节分隔作用，始终跨栏；二级及以下标题由“标题不参与分栏”开关控制。
  return block.metadata.depth === 1 || contract.headingsSpanAll;
}

export function resolveColumnSectionContract(
  parentContract: ResolvedStyleContract,
  metadata: ColumnSectionBlockMetadata,
): ResolvedStyleContract {
  const containerContentWidthPx = resolveContainerContentWidthPx(parentContract);
  const containerContentWidthMm = resolveContainerContentWidthMm(parentContract);
  const columnCount = metadata.columnCount;
  const columnGapMm = columnCount > 1 ? Math.max(0, metadata.columnGapMm) : 0;
  const columnGapPx = mmToPx(columnGapMm);
  const totalGapPx = Math.max(0, columnCount - 1) * columnGapPx;
  const totalGapMm = Math.max(0, columnCount - 1) * columnGapMm;

  return {
    ...parentContract,
    contentWidthPx: containerContentWidthPx,
    contentWidthMm: containerContentWidthMm,
    columnCount,
    columnGapMm,
    columnGapPx,
    columnDivider: metadata.divider,
    headingsSpanAll: metadata.headingsSpanAll,
    singleColumnContentWidthPx: columnCount <= 1
      ? containerContentWidthPx
      : Math.max(40, (containerContentWidthPx - totalGapPx) / columnCount),
    singleColumnContentWidthMm: columnCount <= 1
      ? containerContentWidthMm
      : Math.max(40, (containerContentWidthMm - totalGapMm) / columnCount),
    columnPageCapacityPx: parentContract.contentHeightPx * columnCount,
  };
}
