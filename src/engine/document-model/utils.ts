import type { BlockStyleOverrides, LayoutListItem } from './types';

// 统一使用稳定哈希，确保同一输入在重复导入时生成一致的模型 ID。
export function createStableHash(value: string): string {
  let hash = 2166136261;

  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function createTextFragment(text: string, fallback: string): string {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 24);

  if (normalized) {
    return normalized;
  }

  return `${fallback}-${createStableHash(text).slice(0, 6)}`;
}

export interface ResolvedHangingIndentStyle {
  indentLeft: number;
  indentRight: number;
  firstLineIndent: number;
  hangingIndent: number;
  paddingLeft: number;
  paddingRight: number;
  textIndent: number;
}

// 统一把“左右缩进 + 首行缩进 + 悬挂缩进”收口成同一套计算规则，避免预览、导出和分页各算各的。
export function resolveHangingIndentStyle(
  blockStyleOverrides: Pick<BlockStyleOverrides, 'indentLeft' | 'indentRight' | 'firstLineIndent' | 'hangingIndent'>,
): ResolvedHangingIndentStyle {
  const indentLeft = Math.max(0, blockStyleOverrides.indentLeft ?? 0);
  const indentRight = Math.max(0, blockStyleOverrides.indentRight ?? 0);
  const firstLineIndent = Math.max(0, blockStyleOverrides.firstLineIndent ?? 0);
  const hangingIndent = Math.max(0, blockStyleOverrides.hangingIndent ?? 0);

  return {
    indentLeft,
    indentRight,
    firstLineIndent,
    hangingIndent,
    paddingLeft: indentLeft + hangingIndent,
    paddingRight: indentRight,
    textIndent: firstLineIndent - hangingIndent,
  };
}

export interface ResolvedHangingIndentLineWidths {
  firstLineWidthPx: number;
  followingLineWidthPx: number;
}

export function resolveHangingIndentLineWidths(
  contentWidthPx: number,
  blockStyleOverrides: Pick<BlockStyleOverrides, 'indentLeft' | 'indentRight' | 'firstLineIndent' | 'hangingIndent'>,
): ResolvedHangingIndentLineWidths {
  const indentStyle = resolveHangingIndentStyle(blockStyleOverrides);

  return {
    firstLineWidthPx: Math.max(1, contentWidthPx - indentStyle.indentLeft - indentStyle.firstLineIndent),
    followingLineWidthPx: Math.max(1, contentWidthPx - indentStyle.indentLeft - indentStyle.indentRight),
  };
}

export type LayoutListLevel = 1 | 2 | 3;

export interface LayoutListTreeNode {
  item: LayoutListItem;
  children: LayoutListTreeNode[];
}

// 多级列表 V1 先固定在 1-3 级，旧文档缺字段时一律按 1 级兼容。
export function normalizeLayoutListLevel(level: number | null | undefined): LayoutListLevel {
  if (typeof level !== 'number' || !Number.isFinite(level)) {
    return 1;
  }

  return Math.max(1, Math.min(3, Math.floor(level))) as LayoutListLevel;
}

export function getLayoutListItemLevel(item: LayoutListItem): LayoutListLevel {
  return normalizeLayoutListLevel(item.level);
}

export function buildLayoutListTree(items: LayoutListItem[]): LayoutListTreeNode[] {
  const roots: LayoutListTreeNode[] = [];
  const stack: Array<{ level: LayoutListLevel; node: LayoutListTreeNode }> = [];

  for (const item of items) {
    const nextNode: LayoutListTreeNode = {
      item: {
        ...item,
        level: getLayoutListItemLevel(item),
      },
      children: [],
    };
    const itemLevel = getLayoutListItemLevel(item);

    while (stack.length > 0 && stack[stack.length - 1].level >= itemLevel) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(nextNode);
    } else {
      stack[stack.length - 1].node.children.push(nextNode);
    }

    stack.push({ level: itemLevel, node: nextNode });
  }

  return roots;
}

// 表格列宽先限制在一个可读的像素范围内，避免拖拽写入 0 或离谱大值导致整页布局崩掉。
export function normalizeTableColumnWidthPx(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(48, Math.min(1200, Math.round(value)));
}

// 表格行高只作为最小高度，内容更多时仍会自然撑开。
export function normalizeTableRowHeightPx(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(28, Math.min(1200, Math.round(value)));
}

export function normalizeTableColumnWidths(
  columnWidthsPx: Array<number | null> | null | undefined,
  columnCount: number,
): Array<number | null> {
  return Array.from({ length: Math.max(0, columnCount) }, (_, index) =>
    normalizeTableColumnWidthPx(columnWidthsPx?.[index]),
  );
}
