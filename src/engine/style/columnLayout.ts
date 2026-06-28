import type { LayoutBlock } from '@/engine/document-model';
import type { ResolvedStyleContract } from './types';

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
