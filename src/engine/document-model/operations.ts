import type {
  BlockStyleOverrides,
  BlockRangeSelection,
  ColumnSectionColumnCount,
  LayoutBlock,
  LayoutDocument,
  LayoutResource,
  LayoutListItem,
  LayoutTableCell,
  TableColumnAlign,
  LayoutTableRow,
  TextAnnotation,
  TextMark,
  TextMarkType,
  TextRangeSelection,
  TextRun,
  TextRunPatch,
  TextStyleOverrides,
  ImageBlockMetadata,
  ImageWrapSide,
  LayoutBlockSemantic,
  LayoutSemanticRoleConfig,
  SemanticBlockPresetId,
} from './types';
import { normalizeImageWrapMode, resolveImageWrapSide } from './imageLayout';
import { resolveCompactChoicePatternFromTexts } from './choiceLayout';
import { applySemanticPresetToBlock, applySemanticToBlock, findSemanticKeywordPrefixMatch } from './semanticRole';
import {
  createTextFragment,
  getLayoutListItemLevel,
  normalizeLayoutListLevel,
  normalizeTableColumnWidths,
  normalizeTableColumnWidthPx,
  normalizeTableRowHeightPx,
} from './utils';
import {
  buildTableCellRangeSelection,
  findTableCellPosition,
  getTableCellColSpan,
  getTableCellRowSpan,
  isCoveredTableCell,
  resolveTableAutoFitSize,
  type ResolveTableAutoFitSizeOptions,
} from './tableLayout';
import { defaultStyleSettings } from '@/engine/style/presets';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import {
  getEffectiveTableCellMaxFontSize,
  resolveEffectiveTextLineHeight,
} from '@/engine/style/quickTextStyle';
import type { StyleSettings } from '@/engine/style/types';

export type EditableLayoutTextBlockType = 'heading' | 'paragraph' | 'code' | 'image' | 'equation';

export interface InsertImageBlockPayload {
  src: string;
  alt: string;
  title?: string | null;
  widthPx?: number | null;
  heightPx?: number | null;
  lockAspectRatio?: boolean;
  objectFit?: 'contain' | 'cover';
  cropTopPx?: number | null;
  cropRightPx?: number | null;
  cropBottomPx?: number | null;
  cropLeftPx?: number | null;
  wrapMode?: ImageBlockMetadata['wrapMode'];
  wrapSide?: ImageWrapSide;
  insertAfterNodeId?: string | null;
}

export interface InsertImageBlockResult {
  blocks: LayoutBlock[];
  resources: LayoutResource[];
  insertedBlockId: string;
}

export interface InsertEquationBlockPayload {
  value?: string;
  insertAfterNodeId?: string | null;
}

export interface InsertEquationBlockResult {
  blocks: LayoutBlock[];
  insertedBlockId: string;
}

export interface InsertTableBlockPayload {
  rowCount?: number;
  columnCount?: number;
  insertAfterNodeId?: string | null;
}

export interface InsertTableBlockResult {
  blocks: LayoutBlock[];
  insertedBlockId: string;
  selectedNodeId: string;
}

export type InsertListBlockKind = 'unordered' | 'ordered' | 'task';

export interface InsertListBlockPayload {
  kind: InsertListBlockKind;
  insertAfterNodeId?: string | null;
}

export interface InsertListBlockResult {
  blocks: LayoutBlock[];
  insertedBlockId: string;
  selectedNodeId: string;
}

export interface InsertTocBlockPayload {
  insertAfterNodeId?: string | null;
}

export interface InsertTocBlockResult {
  blocks: LayoutBlock[];
  insertedBlockId: string;
}

function normalizeColumnSectionGapMm(value: number): number {
  return Math.max(4, Math.min(30, Math.round(value)));
}

export interface InsertParagraphBlockPayload {
  insertAfterNodeId?: string | null;
  text?: string;
}

export interface InsertParagraphBlockResult {
  blocks: LayoutBlock[];
  insertedBlockId: string;
}

export interface InsertPageBreakBlockPayload {
  insertAfterNodeId?: string | null;
}

export interface InsertPageBreakBlockResult {
  blocks: LayoutBlock[];
  insertedBlockId: string;
}

export interface DeleteTopLevelBlockResult {
  blocks: LayoutBlock[];
  selectedNodeId: string | null;
  didUpdate: boolean;
}

export type BlockMergeReason =
  | 'merged'
  | 'invalidSelection'
  | 'notEnoughBlocks'
  | 'nonContiguous'
  | 'unsupportedBlockType'
  | 'mixedBlockTypes';

export interface BlockMergeResult {
  blocks: LayoutBlock[];
  selectedNodeId: string | null;
  didUpdate: boolean;
  reason: BlockMergeReason;
  mergedCount: number;
}

export type ColumnSectionWrapReason =
  | 'wrapped'
  | 'invalidSelection'
  | 'notEnoughBlocks'
  | 'nonContiguous'
  | 'unsupportedBlockType';

export interface ColumnSectionWrapResult {
  blocks: LayoutBlock[];
  selectedNodeId: string | null;
  didUpdate: boolean;
  reason: ColumnSectionWrapReason;
  wrappedCount: number;
}

export type ListStructureAction =
  | 'insertItemAbove'
  | 'insertItemBelow'
  | 'deleteItem';

export type ListReorderAction = 'moveUp' | 'moveDown';

export type ListIndentAction = 'indent' | 'outdent';

export type ListTaskConversionAction = 'convertToTask' | 'convertToPlain';

export type ListBatchCheckedScope = 'all' | 'currentLevel';

export type ListBatchCheckedAction = 'check' | 'uncheck';

export interface ListStructureEditResult {
  block: LayoutBlock;
  selectedNodeId: string | null;
  didUpdate: boolean;
}

export interface ListPropertyEditResult {
  block: LayoutBlock;
  selectedNodeId: string | null;
  didUpdate: boolean;
}

export interface ListBatchEditResult {
  block: LayoutBlock;
  selectedNodeId: string | null;
  didUpdate: boolean;
  changedCount: number;
}

export type TableStructureAction =
  | 'insertRowAbove'
  | 'insertRowBelow'
  | 'insertColumnLeft'
  | 'insertColumnRight'
  | 'deleteRow'
  | 'deleteColumn';

export interface TableStructureEditResult {
  block: LayoutBlock;
  selectedNodeId: string | null;
  didUpdate: boolean;
}

export interface TablePropertyEditResult {
  block: LayoutBlock;
  selectedNodeId: string | null;
  didUpdate: boolean;
}

export interface TableMergeEditResult {
  block: LayoutBlock;
  selectedNodeId: string | null;
  didUpdate: boolean;
  reason: 'merged' | 'invalidSelection' | 'singleCell' | 'containsMergedCell';
}

export type BlockquoteStructureAction =
  | 'insertParagraphAbove'
  | 'insertParagraphBelow'
  | 'deleteBlock';

export interface BlockquoteStructureEditResult {
  block: LayoutBlock;
  selectedNodeId: string | null;
  didUpdate: boolean;
}

export interface SemanticKeywordScanItem {
  blockId: string;
  roleId: string;
  roleName: string;
  ruleId: string;
  keyword: string;
  originalText: string;
  previewText: string;
  stripKeyword: boolean;
  status: 'applicable' | 'skippedExisting';
}

export interface SemanticKeywordScanResult {
  items: SemanticKeywordScanItem[];
  applicableCount: number;
  skippedExistingCount: number;
}

export interface SemanticKeywordApplyResult extends SemanticKeywordScanResult {
  blocks: LayoutBlock[];
  didUpdate: boolean;
}

export interface SemanticKeywordApplyOptions {
  overwriteExisting?: boolean;
}

// 清除文字格式只处理当前已接入的“视觉样式”，不碰链接、代码语义和答案标记。
const clearableVisualTextMarkTypes: TextMarkType[] = ['bold', 'italic', 'underline', 'strike'];
const clearableVisualTextStyleKeys: Array<keyof TextStyleOverrides> = [
  'fontFamily',
  'fontSize',
  'color',
  'highlightColor',
];

function areTextMarkEqual(left: TextMark, right: TextMark): boolean {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === 'link' && right.type === 'link') {
    return left.href === right.href && left.title === right.title;
  }

  return true;
}

function areMarksEqual(left: TextMark[], right: TextMark[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((mark, index) => areTextMarkEqual(mark, right[index]));
}

function areAnnotationsEqual(left: TextAnnotation[], right: TextAnnotation[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areStyleOverridesEqual(left: TextStyleOverrides, right: TextStyleOverrides): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function dedupeMarks(marks: TextMark[]): TextMark[] {
  const deduped: TextMark[] = [];

  for (const mark of marks) {
    if (deduped.some((item) => areTextMarkEqual(item, mark))) {
      continue;
    }

    deduped.push(mark);
  }

  return deduped;
}

function dedupeAnnotations(annotations: TextAnnotation[]): TextAnnotation[] {
  const seen = new Set<string>();

  return annotations.filter((annotation) => {
    const key = JSON.stringify(annotation);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function rebuildRunIds(blockId: string, runs: TextRun[]): TextRun[] {
  return runs.map((run, index) => ({
    ...run,
    id: `${blockId}-run-${index + 1}-${createTextFragment(run.text, 'text')}`,
  }));
}

function createReplacementTextRuns(nodeId: string, text: string, baseRuns: TextRun[]): TextRun[] {
  if (!text) {
    return [];
  }

  const baseRun = baseRuns[0];

  return [
    {
      id: `${nodeId}-run-1-${createTextFragment(text, 'text')}`,
      text,
      // 画布直接编辑后不再保证能精确对应原 Markdown 源码范围。
      sourceRange: null,
      marks: baseRun?.marks ?? [],
      charStyleRef: baseRun?.charStyleRef ?? null,
      styleOverrides: baseRun?.styleOverrides ? { ...baseRun.styleOverrides } : {},
      // 整块替换文字时先清空语义标记，避免旧答案标记挂到新文字上。
      annotations: [],
    },
  ];
}

function createInsertedBlockId(
  blocks: LayoutBlock[],
  type: LayoutBlock['type'],
  text: string,
): string {
  const existingIds = new Set(blocks.map((block) => block.id));
  const fragment = createTextFragment(text, type);
  let index = blocks.length + 1;
  let candidate = `${type}-${index}-${fragment}`;

  // 手动插入的块可能来自同一张图片，使用递增序号保证本轮文档内 ID 不撞车。
  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${type}-${index}-${fragment}`;
  }

  return candidate;
}

function createInsertedImageBlock(
  blocks: LayoutBlock[],
  payload: InsertImageBlockPayload,
): LayoutBlock {
  const normalizedSrc = payload.src.trim();
  const normalizedAlt = payload.alt.trim();
  const blockId = createInsertedBlockId(blocks, 'image', `${normalizedSrc} ${normalizedAlt}`.trim());

  return {
    id: blockId,
    type: 'image',
    sourceRange: null,
    blockStyleRef: 'image',
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'image',
      src: normalizedSrc,
      alt: normalizedAlt,
      title: payload.title?.trim() || null,
      widthPx: normalizeOptionalNumber(payload.widthPx),
      heightPx: normalizeOptionalNumber(payload.heightPx),
      lockAspectRatio: payload.lockAspectRatio ?? true,
      objectFit: payload.objectFit ?? 'contain',
      cropTopPx: normalizeOptionalNumber(payload.cropTopPx) ?? 0,
      cropRightPx: normalizeOptionalNumber(payload.cropRightPx) ?? 0,
      cropBottomPx: normalizeOptionalNumber(payload.cropBottomPx) ?? 0,
      cropLeftPx: normalizeOptionalNumber(payload.cropLeftPx) ?? 0,
      wrapMode: normalizeImageWrapMode(payload.wrapMode),
      wrapSide: payload.wrapSide ?? resolveImageWrapSide({ wrapMode: payload.wrapMode }),
    },
  };
}

function createInsertedEquationBlock(blocks: LayoutBlock[], payload: InsertEquationBlockPayload): LayoutBlock {
  const normalizedValue = payload.value?.trim() ?? '';
  const blockId = createInsertedBlockId(blocks, 'equation', normalizedValue || 'equation');

  return {
    id: blockId,
    type: 'equation',
    sourceRange: null,
    blockStyleRef: 'equation',
    blockStyleOverrides: {},
    textRuns: normalizedValue
      ? createReplacementTextRuns(blockId, normalizedValue, [])
      : [],
    pagination: { keepLinesTogether: true },
    metadata: {
      kind: 'equation',
      value: normalizedValue,
    },
  };
}

function createInsertedImageResource(block: LayoutBlock): LayoutResource | null {
  if (block.type !== 'image' || block.metadata.kind !== 'image') {
    return null;
  }

  return {
    id: `resource-${block.id}`,
    type: 'image',
    src: block.metadata.src,
    alt: block.metadata.alt,
    title: block.metadata.title,
    blockId: block.id,
  };
}

function createEmptyInsertedTableCell(blockId: string, rowIndex: number, cellIndex: number): LayoutTableCell {
  return {
    id: `${blockId}-cell-${rowIndex + 1}-${cellIndex + 1}`,
    sourceRange: null,
    // 空单元格先不制造假文字，后续双击编辑时再写入真实 TextRun。
    textRuns: [],
    isHeader: false,
  };
}

function createInsertedTableRow(blockId: string, rowIndex: number, columnCount: number): LayoutTableRow {
  return {
    id: `${blockId}-row-${rowIndex + 1}`,
    sourceRange: null,
    heightPx: null,
    cells: Array.from({ length: columnCount }, (_, cellIndex) =>
      createEmptyInsertedTableCell(blockId, rowIndex, cellIndex),
    ),
  };
}

function createInsertedTableBlock(blocks: LayoutBlock[], payload: InsertTableBlockPayload): LayoutBlock {
  const rowCount = Math.max(1, Math.floor(payload.rowCount ?? 3));
  const columnCount = Math.max(1, Math.floor(payload.columnCount ?? 3));
  const blockId = createInsertedBlockId(blocks, 'table', `${rowCount}x${columnCount}`);

  return {
    id: blockId,
    type: 'table',
    sourceRange: null,
    blockStyleRef: 'table',
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'table',
      align: Array.from({ length: columnCount }, () => null),
      columnWidthsPx: Array.from({ length: columnCount }, () => null),
      rows: Array.from({ length: rowCount }, (_, rowIndex) =>
        createInsertedTableRow(blockId, rowIndex, columnCount),
      ),
    },
  };
}

function createInsertedListBlock(blocks: LayoutBlock[], payload: InsertListBlockPayload): LayoutBlock {
  const blockId = createInsertedBlockId(blocks, 'list', payload.kind);
  const firstItemId = `${blockId}-item-1`;
  const isOrdered = payload.kind === 'ordered';
  const isTaskList = payload.kind === 'task';

  return {
    id: blockId,
    type: 'list',
    sourceRange: null,
    blockStyleRef: 'list',
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'list',
      ordered: isOrdered,
      start: isOrdered ? 1 : null,
      spread: false,
      items: [
        {
          id: firstItemId,
          sourceRange: null,
          // 新增列表项保持为空，后续由用户在画布原位编辑中输入真实内容。
          textRuns: [],
          level: 1,
          checked: isTaskList ? false : null,
        },
      ],
    },
  };
}

function createInsertedTocBlock(blocks: LayoutBlock[]): LayoutBlock {
  const blockId = createInsertedBlockId(blocks, 'toc', '目录');

  return {
    id: blockId,
    type: 'toc',
    sourceRange: null,
    blockStyleRef: 'toc',
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'toc',
      title: '目录',
      maxDepth: 3,
    },
  };
}

function createInsertedParagraphBlock(blocks: LayoutBlock[], text = ''): LayoutBlock {
  const normalizedText = text.replace(/\r\n?/g, '\n');
  const blockId = createInsertedBlockId(blocks, 'paragraph', normalizedText || '空文本块');

  return {
    id: blockId,
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: 'paragraph',
    blockStyleOverrides: {},
    // 空文本块先不制造假文字；AI 插入等有初始内容的场景则生成完整 TextRun。
    textRuns: createReplacementTextRuns(blockId, normalizedText, []),
    pagination: {},
    metadata: {
      kind: 'paragraph',
      text: normalizedText,
    },
  };
}

function createInsertedPageBreakBlock(blocks: LayoutBlock[]): LayoutBlock {
  const blockId = createInsertedBlockId(blocks, 'pageBreak', '/pagebreak');

  return {
    id: blockId,
    type: 'pageBreak',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {
      pageBreakAfter: true,
    },
    metadata: {
      kind: 'pageBreak',
      command: '/pagebreak',
    },
  };
}

function createInsertedColumnBreakBlock(blocks: LayoutBlock[]): LayoutBlock {
  const blockId = createInsertedBlockId(blocks, 'columnBreak', '/columnbreak');

  return {
    id: blockId,
    type: 'columnBreak',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {
      columnBreakAfter: true,
    },
    metadata: {
      kind: 'columnBreak',
      command: '/columnbreak',
    },
  };
}

function isColumnSectionSupportedChild(block: LayoutBlock): boolean {
  // 局部分栏 V1 只包装真实内容块；分页符/分栏断点属于页面结构控制，
  // 已有局部分栏也不允许再次嵌套，避免当前小步扩成完整分节系统。
  return block.type !== 'pageBreak' &&
    block.type !== 'columnBreak' &&
    block.type !== 'horizontalRule' &&
    block.type !== 'columnSection';
}

function createColumnSectionBlock(blocks: LayoutBlock[], childBlocks: LayoutBlock[]): LayoutBlock {
  const blockId = createInsertedBlockId(blocks, 'columnSection', '局部分栏');

  return {
    id: blockId,
    type: 'columnSection',
    sourceRange: null,
    blockStyleRef: null,
    blockStyleOverrides: {},
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'columnSection',
      columnCount: 2,
      columnGapMm: defaultStyleSettings.columns.gapMm,
      divider: defaultStyleSettings.columns.divider,
      headingsSpanAll: defaultStyleSettings.columns.headingsSpanAll,
      blocks: childBlocks.map((block) => ({
        ...block,
        sourceRange: null,
      })),
    },
  };
}

function collectTableNodeIds(block: LayoutBlock): Set<string> {
  const ids = new Set<string>();
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return ids;
  }

  ids.add(block.id);
  block.metadata.rows.forEach((row) => {
    ids.add(row.id);
    row.cells.forEach((cell) => ids.add(cell.id));
  });
  return ids;
}

function collectListItemIds(block: LayoutBlock): Set<string> {
  const ids = new Set<string>();
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return ids;
  }

  ids.add(block.id);
  block.metadata.items.forEach((item) => ids.add(item.id));
  return ids;
}

function collectNestedNodeIds(blocks: LayoutBlock[]): Set<string> {
  const ids = new Set<string>();

  const visitBlocks = (items: LayoutBlock[]) => {
    items.forEach((block) => {
      ids.add(block.id);

      if (block.type === 'list' && block.metadata.kind === 'list') {
        block.metadata.items.forEach((item) => ids.add(item.id));
      }

      if (block.type === 'table' && block.metadata.kind === 'table') {
        block.metadata.rows.forEach((row) => {
          ids.add(row.id);
          row.cells.forEach((cell) => ids.add(cell.id));
        });
      }

      if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
        visitBlocks(block.metadata.blocks);
      }

      if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
        visitBlocks(block.metadata.blocks);
      }
    });
  };

  visitBlocks(blocks);
  return ids;
}

function createUniqueTableNodeId(existingIds: Set<string>, baseId: string): string {
  let index = 1;
  let candidate = baseId;

  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${baseId}-${index}`;
  }

  existingIds.add(candidate);
  return candidate;
}

function createUniqueListItemId(existingIds: Set<string>, baseId: string): string {
  let index = 1;
  let candidate = baseId;

  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${baseId}-${index}`;
  }

  existingIds.add(candidate);
  return candidate;
}

function createUniqueBlockId(existingIds: Set<string>, baseId: string): string {
  let index = 1;
  let candidate = baseId;

  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${baseId}-${index}`;
  }

  existingIds.add(candidate);
  return candidate;
}

function createEmptyListItemWithId(itemId: string): LayoutListItem {
  return {
    id: itemId,
    sourceRange: null,
    textRuns: [],
    level: 1,
    checked: null,
  };
}

function createEmptyTableCellWithId(cellId: string, isHeader: boolean): LayoutTableCell {
  return {
    id: cellId,
    sourceRange: null,
    textRuns: [],
    isHeader,
  };
}

function findListItemIndex(block: LayoutBlock, itemId: string): number {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return -1;
  }

  return block.metadata.items.findIndex((item) => item.id === itemId);
}

function getListItemSubtreeRange(items: LayoutListItem[], itemIndex: number): { start: number; end: number } {
  const currentLevel = getLayoutListItemLevel(items[itemIndex]);
  let end = itemIndex + 1;

  while (end < items.length && getLayoutListItemLevel(items[end]) > currentLevel) {
    end += 1;
  }

  return {
    start: itemIndex,
    end,
  };
}

function moveListItemSlice(
  items: LayoutListItem[],
  sourceRange: { start: number; end: number },
  targetIndex: number,
): LayoutListItem[] {
  const movingItems = items.slice(sourceRange.start, sourceRange.end);
  const remainingItems = [...items.slice(0, sourceRange.start), ...items.slice(sourceRange.end)];
  const normalizedTargetIndex = Math.max(0, Math.min(targetIndex, remainingItems.length));

  return [
    ...remainingItems.slice(0, normalizedTargetIndex),
    ...movingItems,
    ...remainingItems.slice(normalizedTargetIndex),
  ];
}

function createEmptyTableRowForStructureEdit(
  block: LayoutBlock,
  existingIds: Set<string>,
  insertIndex: number,
  columnCount: number,
): LayoutTableRow {
  const rowId = createUniqueTableNodeId(existingIds, `${block.id}-row-manual-${insertIndex + 1}`);

  return {
    id: rowId,
    sourceRange: null,
    heightPx: null,
    cells: Array.from({ length: columnCount }, (_, columnIndex) =>
      createEmptyTableCellWithId(
        createUniqueTableNodeId(existingIds, `${rowId}-cell-${columnIndex + 1}`),
        false,
      ),
    ),
  };
}

function createEmptyListItemForStructureEdit(
  block: LayoutBlock,
  existingIds: Set<string>,
  insertIndex: number,
): LayoutListItem {
  const itemId = createUniqueListItemId(existingIds, `${block.id}-item-manual-${insertIndex + 1}`);
  return createEmptyListItemWithId(itemId);
}

function createEmptyTableCellForStructureEdit(
  block: LayoutBlock,
  row: LayoutTableRow,
  existingIds: Set<string>,
  insertIndex: number,
): LayoutTableCell {
  const rowHasHeaderCells = row.cells.some((cell) => cell.isHeader);

  return createEmptyTableCellWithId(
    createUniqueTableNodeId(existingIds, `${row.id}-cell-manual-${insertIndex + 1}`),
    rowHasHeaderCells,
  );
}

function createEmptyParagraphBlockForStructureEdit(
  blockquoteBlock: LayoutBlock,
  existingIds: Set<string>,
  insertIndex: number,
): LayoutBlock {
  const blockId = createUniqueBlockId(existingIds, `${blockquoteBlock.id}-paragraph-manual-${insertIndex + 1}`);

  return {
    id: blockId,
    type: 'paragraph',
    sourceRange: null,
    blockStyleRef: 'paragraph',
    blockStyleOverrides: {},
    // 空段落先不制造假文字，后续由用户直接在画布中输入真实内容。
    textRuns: [],
    pagination: {},
    metadata: {
      kind: 'paragraph',
      text: '',
    },
  };
}

function buildMergedTableCellTextRuns(mainCell: LayoutTableCell, mergedCells: LayoutTableCell[]): TextRun[] {
  const collectedRuns: TextRun[] = [];

  mergedCells.forEach((cell) => {
    if (cell.textRuns.length === 0 || getTextContentFromRuns(cell.textRuns).length === 0) {
      return;
    }

    if (collectedRuns.length > 0) {
      collectedRuns.push({
        id: `${mainCell.id}-merge-break-${collectedRuns.length + 1}`,
        text: '\n',
        sourceRange: null,
        marks: [],
        charStyleRef: null,
        styleOverrides: {},
        annotations: [],
      });
    }

    cell.textRuns.forEach((run) => {
      collectedRuns.push({
        ...run,
        sourceRange: null,
      });
    });
  });

  // 合并后的内容统一挂回主单元格，所以 TextRun ID 也重新归到主单元格名下。
  return rebuildRunIds(mainCell.id, mergeAdjacentTextRuns(collectedRuns));
}

function findDirectBlockIndexForNodeId(
  blocks: LayoutBlock[],
  nodeId: string,
): number {
  return blocks.findIndex((block) => {
    if (block.id === nodeId) {
      return true;
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      return block.metadata.items.some((item) => item.id === nodeId);
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      return block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === nodeId));
    }

    return false;
  });
}

function getBlockIndexForNodeId(blocks: LayoutBlock[], nodeId: string | null | undefined): number {
  if (!nodeId) {
    return -1;
  }

  return blocks.findIndex((block) => {
    if (block.id === nodeId) {
      return true;
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      return block.metadata.items.some((item) => item.id === nodeId);
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      return block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === nodeId));
    }

    return false;
  });
}

export function insertImageBlockAfterNode(
  blocks: LayoutBlock[],
  resources: LayoutResource[],
  payload: InsertImageBlockPayload,
): InsertImageBlockResult {
  const imageBlock = createInsertedImageBlock(blocks, payload);
  const imageResource = createInsertedImageResource(imageBlock);
  const insertAfterIndex = getBlockIndexForNodeId(blocks, payload.insertAfterNodeId);
  const insertIndex = insertAfterIndex >= 0 ? insertAfterIndex + 1 : blocks.length;
  const nextBlocks = [
    ...blocks.slice(0, insertIndex),
    imageBlock,
    ...blocks.slice(insertIndex),
  ];

  return {
    blocks: nextBlocks,
    resources: imageResource ? [...resources, imageResource] : resources,
    insertedBlockId: imageBlock.id,
  };
}

export function insertTableBlockAfterNode(
  blocks: LayoutBlock[],
  payload: InsertTableBlockPayload,
): InsertTableBlockResult {
  const tableBlock = createInsertedTableBlock(blocks, payload);
  const insertAfterIndex = getBlockIndexForNodeId(blocks, payload.insertAfterNodeId);
  const insertIndex = insertAfterIndex >= 0 ? insertAfterIndex + 1 : blocks.length;
  const nextBlocks = [
    ...blocks.slice(0, insertIndex),
    tableBlock,
    ...blocks.slice(insertIndex),
  ];
  const firstCellId =
    tableBlock.metadata.kind === 'table'
      ? tableBlock.metadata.rows[0]?.cells[0]?.id
      : null;

  return {
    blocks: nextBlocks,
    insertedBlockId: tableBlock.id,
    selectedNodeId: firstCellId ?? tableBlock.id,
  };
}

export function insertEquationBlockAfterNode(
  blocks: LayoutBlock[],
  payload: InsertEquationBlockPayload,
): InsertEquationBlockResult {
  const equationBlock = createInsertedEquationBlock(blocks, payload);
  const insertAfterIndex = getBlockIndexForNodeId(blocks, payload.insertAfterNodeId);
  const insertIndex = insertAfterIndex >= 0 ? insertAfterIndex + 1 : blocks.length;
  const nextBlocks = [...blocks.slice(0, insertIndex), equationBlock, ...blocks.slice(insertIndex)];

  return {
    blocks: nextBlocks,
    insertedBlockId: equationBlock.id,
  };
}

export function insertListBlockAfterNode(
  blocks: LayoutBlock[],
  payload: InsertListBlockPayload,
): InsertListBlockResult {
  const listBlock = createInsertedListBlock(blocks, payload);
  const insertAfterIndex = getBlockIndexForNodeId(blocks, payload.insertAfterNodeId);
  const insertIndex = insertAfterIndex >= 0 ? insertAfterIndex + 1 : blocks.length;
  const nextBlocks = [
    ...blocks.slice(0, insertIndex),
    listBlock,
    ...blocks.slice(insertIndex),
  ];
  const firstItemId =
    listBlock.metadata.kind === 'list'
      ? listBlock.metadata.items[0]?.id
      : null;

  return {
    blocks: nextBlocks,
    insertedBlockId: listBlock.id,
    selectedNodeId: firstItemId ?? listBlock.id,
  };
}

export function insertTocBlockAfterNode(
  blocks: LayoutBlock[],
  payload: InsertTocBlockPayload,
): InsertTocBlockResult {
  const remainingBlocks =
    blocks[0]?.type === 'toc' &&
    blocks[0].metadata.kind === 'toc' &&
    blocks[1]?.type === 'pageBreak' &&
    blocks[1].metadata.kind === 'pageBreak'
      ? blocks.slice(2)
      : blocks;
  const tocBlock = createInsertedTocBlock(blocks);
  const pageBreakBlock = createInsertedPageBreakBlock([...remainingBlocks, tocBlock]);
  const nextBlocks = [
    tocBlock,
    pageBreakBlock,
    ...remainingBlocks,
  ];

  return {
    blocks: nextBlocks,
    insertedBlockId: tocBlock.id,
  };
}

export function insertParagraphBlockAfterNode(
  blocks: LayoutBlock[],
  payload: InsertParagraphBlockPayload,
): InsertParagraphBlockResult {
  const paragraphBlock = createInsertedParagraphBlock(blocks, payload.text);
  const insertAfterIndex = getBlockIndexForNodeId(blocks, payload.insertAfterNodeId);
  const insertIndex = insertAfterIndex >= 0 ? insertAfterIndex + 1 : blocks.length;
  const nextBlocks = [
    ...blocks.slice(0, insertIndex),
    paragraphBlock,
    ...blocks.slice(insertIndex),
  ];

  return {
    blocks: nextBlocks,
    insertedBlockId: paragraphBlock.id,
  };
}

export function insertPageBreakBlockAfterNode(
  blocks: LayoutBlock[],
  payload: InsertPageBreakBlockPayload,
): InsertPageBreakBlockResult {
  const pageBreakBlock = createInsertedPageBreakBlock(blocks);
  const insertAfterIndex = getBlockIndexForNodeId(blocks, payload.insertAfterNodeId);
  const insertIndex = insertAfterIndex >= 0 ? insertAfterIndex + 1 : blocks.length;
  const nextBlocks = [
    ...blocks.slice(0, insertIndex),
    pageBreakBlock,
    ...blocks.slice(insertIndex),
  ];

  return {
    blocks: nextBlocks,
    insertedBlockId: pageBreakBlock.id,
  };
}

export function insertColumnBreakBlockAfterNode(
  blocks: LayoutBlock[],
  payload: InsertPageBreakBlockPayload,
): InsertPageBreakBlockResult {
  const columnBreakBlock = createInsertedColumnBreakBlock(blocks);
  const insertAfterIndex = getBlockIndexForNodeId(blocks, payload.insertAfterNodeId);
  const insertIndex = insertAfterIndex >= 0 ? insertAfterIndex + 1 : blocks.length;
  const nextBlocks = [
    ...blocks.slice(0, insertIndex),
    columnBreakBlock,
    ...blocks.slice(insertIndex),
  ];

  return {
    blocks: nextBlocks,
    insertedBlockId: columnBreakBlock.id,
  };
}

export function deleteTopLevelBlockById(
  blocks: LayoutBlock[],
  blockId: string,
): DeleteTopLevelBlockResult {
  const blockIndex = blocks.findIndex((block) => block.id === blockId);
  if (blockIndex < 0) {
    return {
      blocks,
      selectedNodeId: null,
      didUpdate: false,
    };
  }

  const nextBlocks = blocks.filter((_, index) => index !== blockIndex);
  const nextSelectedBlock = nextBlocks[blockIndex] ?? nextBlocks[blockIndex - 1] ?? null;

  return {
    blocks: nextBlocks,
    // 删除后优先选中后一个相邻块，没有后项时回退到前一个相邻块。
    selectedNodeId: nextSelectedBlock?.id ?? null,
    didUpdate: true,
  };
}

export function buildBlockRangeSelection(
  blocks: LayoutBlock[],
  anchorBlockId: string,
  focusBlockId: string,
): BlockRangeSelection | null {
  const anchorIndex = blocks.findIndex((block) => block.id === anchorBlockId);
  const focusIndex = blocks.findIndex((block) => block.id === focusBlockId);
  if (anchorIndex < 0 || focusIndex < 0) {
    return null;
  }

  const startIndex = Math.min(anchorIndex, focusIndex);
  const endIndex = Math.max(anchorIndex, focusIndex);

  return {
    anchorBlockId,
    focusBlockId,
    blockIds: blocks.slice(startIndex, endIndex + 1).map((block) => block.id),
  };
}

function isMergeableTextBlock(block: LayoutBlock): boolean {
  return block.type === 'paragraph' || block.type === 'heading' || block.type === 'code';
}

function createBlockMergeSeparatorRun(blockId: string, index: number): TextRun {
  return {
    id: `${blockId}-merge-break-${index + 1}`,
    text: '\n',
    sourceRange: null,
    marks: [],
    charStyleRef: null,
    styleOverrides: {},
    annotations: [],
  };
}

function buildMergedBlockTextRuns(targetBlockId: string, blocksToMerge: LayoutBlock[]): TextRun[] {
  const mergedRuns: TextRun[] = [];

  blocksToMerge.forEach((block, blockIndex) => {
    if (blockIndex > 0) {
      mergedRuns.push(createBlockMergeSeparatorRun(targetBlockId, mergedRuns.length));
    }

    block.textRuns.forEach((run) => {
      mergedRuns.push({
        ...run,
        sourceRange: null,
      });
    });
  });

  return rebuildRunIds(targetBlockId, mergeAdjacentTextRuns(mergedRuns));
}

function updateMergedTextBlockMetadata(block: LayoutBlock, textRuns: TextRun[]): LayoutBlock {
  const text = getTextContentFromRuns(textRuns);

  if (block.type === 'paragraph' && block.metadata.kind === 'paragraph') {
    return {
      ...block,
      sourceRange: null,
      textRuns,
      metadata: {
        ...block.metadata,
        text,
      },
    };
  }

  if (block.type === 'heading' && block.metadata.kind === 'heading') {
    return {
      ...block,
      sourceRange: null,
      textRuns,
      metadata: {
        ...block.metadata,
        text,
      },
    };
  }

  if (block.type === 'code' && block.metadata.kind === 'code') {
    return {
      ...block,
      sourceRange: null,
      textRuns,
      metadata: {
        ...block.metadata,
        value: text,
      },
    };
  }

  return block;
}

function isSingleChoiceListBlock(block: LayoutBlock): block is LayoutBlock & {
  metadata: LayoutBlock['metadata'] & { kind: 'list'; items: [LayoutListItem] };
} {
  return (
    block.type === 'list' &&
    block.metadata.kind === 'list' &&
    block.metadata.items.length === 1 &&
    getLayoutListItemLevel(block.metadata.items[0]) === 1 &&
    block.metadata.items[0].checked === null
  );
}

function getCompactChoiceCandidateBlockText(block: LayoutBlock): string {
  if (block.type === 'paragraph' && block.metadata.kind === 'paragraph') {
    return block.metadata.text;
  }

  if (isSingleChoiceListBlock(block)) {
    return getTextContentFromRuns(block.metadata.items[0].textRuns);
  }

  return '';
}

function canMergeBlocksIntoCompactChoiceList(blocksToMerge: LayoutBlock[]): boolean {
  if (
    blocksToMerge.length < 2 ||
    !blocksToMerge.every((block) => block.type === 'paragraph' || isSingleChoiceListBlock(block))
  ) {
    return false;
  }

  return !!resolveCompactChoicePatternFromTexts(
    blocksToMerge.map((block) => getCompactChoiceCandidateBlockText(block).trim()),
  );
}

function createCompactChoiceListItemFromBlock(
  targetBlockId: string,
  block: LayoutBlock,
  itemIndex: number,
): LayoutListItem {
  const plainText = getCompactChoiceCandidateBlockText(block);
  const itemId = `${targetBlockId}-choice-item-${itemIndex + 1}-${createTextFragment(plainText, 'item')}`;

  if (block.type === 'paragraph' && block.metadata.kind === 'paragraph') {
    return {
      id: itemId,
      sourceRange: null,
      textRuns: block.textRuns.map((run) => ({
        ...run,
        id: `${itemId}-${run.id}`,
        sourceRange: null,
      })),
      level: 1,
      listKind: 'unordered',
      checked: null,
    };
  }

  if (isSingleChoiceListBlock(block)) {
    const [item] = block.metadata.items;
    return {
      ...item,
      id: itemId,
      sourceRange: null,
      textRuns: item.textRuns.map((run) => ({
        ...run,
        id: `${itemId}-${run.id}`,
        sourceRange: null,
      })),
      level: 1,
      listKind: 'unordered',
      checked: null,
    };
  }

  return {
    id: itemId,
    sourceRange: null,
    textRuns: [],
    level: 1,
    listKind: 'unordered',
    checked: null,
  };
}

function mergeBlocksIntoCompactChoiceList(
  blocks: LayoutBlock[],
  blocksToMerge: LayoutBlock[],
): BlockMergeResult {
  const targetBlock = blocksToMerge[0];
  const mergedBlock: LayoutBlock = {
    id: targetBlock.id,
    type: 'list',
    sourceRange: null,
    blockStyleRef: 'list',
    blockStyleOverrides: {},
    textRuns: [],
    pagination: { ...targetBlock.pagination },
    metadata: {
      kind: 'list',
      ordered: false,
      start: null,
      spread: false,
      items: blocksToMerge.map((block, index) => createCompactChoiceListItemFromBlock(targetBlock.id, block, index)),
    },
  };
  const removedBlockIds = new Set(blocksToMerge.slice(1).map((block) => block.id));
  const nextBlocks = blocks
    .map((block) => (block.id === targetBlock.id ? mergedBlock : block))
    .filter((block) => !removedBlockIds.has(block.id));

  return {
    blocks: nextBlocks,
    selectedNodeId: mergedBlock.metadata.kind === 'list' ? mergedBlock.metadata.items[0]?.id ?? mergedBlock.id : mergedBlock.id,
    didUpdate: true,
    reason: 'merged',
    mergedCount: blocksToMerge.length,
  };
}

export function mergeTopLevelTextBlocksByIds(
  blocks: LayoutBlock[],
  blockIds: string[],
): BlockMergeResult {
  const uniqueBlockIds = Array.from(new Set(blockIds));
  if (uniqueBlockIds.length < 2) {
    return { blocks, selectedNodeId: null, didUpdate: false, reason: 'notEnoughBlocks', mergedCount: 0 };
  }

  const selectedEntries = uniqueBlockIds
    .map((blockId) => {
      const index = blocks.findIndex((block) => block.id === blockId);
      return index >= 0 ? { index, block: blocks[index] } : null;
    })
    .filter((entry): entry is { index: number; block: LayoutBlock } => !!entry)
    .sort((left, right) => left.index - right.index);

  if (selectedEntries.length !== uniqueBlockIds.length) {
    return { blocks, selectedNodeId: null, didUpdate: false, reason: 'invalidSelection', mergedCount: 0 };
  }

  const firstIndex = selectedEntries[0].index;
  const isContiguous = selectedEntries.every((entry, index) => entry.index === firstIndex + index);
  if (!isContiguous) {
    return { blocks, selectedNodeId: null, didUpdate: false, reason: 'nonContiguous', mergedCount: 0 };
  }

  const selectedBlocks = selectedEntries.map((entry) => entry.block);
  if (canMergeBlocksIntoCompactChoiceList(selectedBlocks)) {
    return mergeBlocksIntoCompactChoiceList(blocks, selectedBlocks);
  }

  if (!selectedEntries.every((entry) => isMergeableTextBlock(entry.block))) {
    return { blocks, selectedNodeId: null, didUpdate: false, reason: 'unsupportedBlockType', mergedCount: 0 };
  }

  const targetBlock = selectedEntries[0].block;
  if (!selectedEntries.every((entry) => entry.block.type === targetBlock.type)) {
    return { blocks, selectedNodeId: null, didUpdate: false, reason: 'mixedBlockTypes', mergedCount: 0 };
  }

  const mergedRuns = buildMergedBlockTextRuns(targetBlock.id, selectedEntries.map((entry) => entry.block));
  const mergedBlock = updateMergedTextBlockMetadata(targetBlock, mergedRuns);
  const removedBlockIds = new Set(selectedEntries.slice(1).map((entry) => entry.block.id));
  const nextBlocks = blocks
    .map((block) => (block.id === targetBlock.id ? mergedBlock : block))
    .filter((block) => !removedBlockIds.has(block.id));

  return {
    blocks: nextBlocks,
    selectedNodeId: mergedBlock.id,
    didUpdate: true,
    reason: 'merged',
    mergedCount: selectedEntries.length,
  };
}

export function wrapTopLevelBlocksInColumnSectionByIds(
  blocks: LayoutBlock[],
  blockIds: string[],
): ColumnSectionWrapResult {
  const uniqueBlockIds = Array.from(new Set(blockIds));
  if (uniqueBlockIds.length < 2) {
    return { blocks, selectedNodeId: null, didUpdate: false, reason: 'notEnoughBlocks', wrappedCount: 0 };
  }

  const selectedEntries = uniqueBlockIds
    .map((blockId) => {
      const index = blocks.findIndex((block) => block.id === blockId);
      return index >= 0 ? { index, block: blocks[index] } : null;
    })
    .filter((entry): entry is { index: number; block: LayoutBlock } => !!entry)
    .sort((left, right) => left.index - right.index);

  if (selectedEntries.length !== uniqueBlockIds.length) {
    return { blocks, selectedNodeId: null, didUpdate: false, reason: 'invalidSelection', wrappedCount: 0 };
  }

  const firstIndex = selectedEntries[0].index;
  const isContiguous = selectedEntries.every((entry, index) => entry.index === firstIndex + index);
  if (!isContiguous) {
    return { blocks, selectedNodeId: null, didUpdate: false, reason: 'nonContiguous', wrappedCount: 0 };
  }

  if (!selectedEntries.every((entry) => isColumnSectionSupportedChild(entry.block))) {
    return { blocks, selectedNodeId: null, didUpdate: false, reason: 'unsupportedBlockType', wrappedCount: 0 };
  }

  const selectedBlocks = selectedEntries.map((entry) => entry.block);
  const columnSectionBlock = createColumnSectionBlock(blocks, selectedBlocks);
  const selectedBlockIds = new Set(selectedBlocks.map((block) => block.id));
  const nextBlocks = [
    ...blocks.slice(0, firstIndex),
    columnSectionBlock,
    ...blocks.slice(firstIndex).filter((block) => !selectedBlockIds.has(block.id)),
  ];

  return {
    blocks: nextBlocks,
    selectedNodeId: columnSectionBlock.id,
    didUpdate: true,
    reason: 'wrapped',
    wrappedCount: selectedBlocks.length,
  };
}

export function updateTableStructureByCell(
  block: LayoutBlock,
  cellId: string,
  action: TableStructureAction,
): TableStructureEditResult {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const position = findTableCellPosition(block, cellId);
  if (!position) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const rowCount = block.metadata.rows.length;
  const columnCount = block.metadata.rows[0]?.cells.length ?? 0;
  const existingIds = collectTableNodeIds(block);
  const currentColumnWidths = normalizeTableColumnWidths(block.metadata.columnWidthsPx, columnCount);

  if (action === 'insertRowAbove' || action === 'insertRowBelow') {
    const insertIndex = action === 'insertRowAbove' ? position.rowIndex : position.rowIndex + 1;
    const newRow = createEmptyTableRowForStructureEdit(block, existingIds, insertIndex, columnCount);
    const nextRows = [
      ...block.metadata.rows.slice(0, insertIndex),
      newRow,
      ...block.metadata.rows.slice(insertIndex),
    ];

    return {
      block: {
        ...block,
        sourceRange: null,
        metadata: {
          ...block.metadata,
          rows: nextRows,
        },
      },
      selectedNodeId: newRow.cells[Math.min(position.columnIndex, newRow.cells.length - 1)]?.id ?? newRow.id,
      didUpdate: true,
    };
  }

  if (action === 'insertColumnLeft' || action === 'insertColumnRight') {
    const insertIndex = action === 'insertColumnLeft' ? position.columnIndex : position.columnIndex + 1;
    const nextRows = block.metadata.rows.map((row) => {
      const newCell = createEmptyTableCellForStructureEdit(block, row, existingIds, insertIndex);
      return {
        ...row,
        sourceRange: null,
        cells: [
          ...row.cells.slice(0, insertIndex),
          newCell,
          ...row.cells.slice(insertIndex),
        ],
      };
    });
    const selectedRow = nextRows[position.rowIndex];
    const nextColumnWidths = [
      ...currentColumnWidths.slice(0, insertIndex),
      null,
      ...currentColumnWidths.slice(insertIndex),
    ];

    return {
      block: {
        ...block,
        sourceRange: null,
        metadata: {
          ...block.metadata,
          align: [
            ...block.metadata.align.slice(0, insertIndex),
            null,
            ...block.metadata.align.slice(insertIndex),
          ],
          columnWidthsPx: nextColumnWidths,
          rows: nextRows,
        },
      },
      selectedNodeId: selectedRow?.cells[insertIndex]?.id ?? null,
      didUpdate: true,
    };
  }

  if (action === 'deleteRow') {
    if (rowCount <= 1) {
      return { block, selectedNodeId: cellId, didUpdate: false };
    }

    const nextRows = block.metadata.rows.filter((_, rowIndex) => rowIndex !== position.rowIndex);
    const nextRowIndex = Math.min(position.rowIndex, nextRows.length - 1);
    const nextColumnIndex = Math.min(position.columnIndex, nextRows[nextRowIndex].cells.length - 1);

    return {
      block: {
        ...block,
        sourceRange: null,
        metadata: {
          ...block.metadata,
          rows: nextRows,
        },
      },
      selectedNodeId: nextRows[nextRowIndex].cells[nextColumnIndex]?.id ?? null,
      didUpdate: true,
    };
  }

  if (action === 'deleteColumn') {
    if (columnCount <= 1) {
      return { block, selectedNodeId: cellId, didUpdate: false };
    }

    const nextRows = block.metadata.rows.map((row) => ({
      ...row,
      sourceRange: null,
      cells: row.cells.filter((_, columnIndex) => columnIndex !== position.columnIndex),
    }));
    const nextColumnIndex = Math.min(position.columnIndex, nextRows[position.rowIndex].cells.length - 1);
    const nextColumnWidths = currentColumnWidths.filter((_, columnIndex) => columnIndex !== position.columnIndex);

    return {
      block: {
        ...block,
        sourceRange: null,
        metadata: {
          ...block.metadata,
          align: block.metadata.align.filter((_, columnIndex) => columnIndex !== position.columnIndex),
          columnWidthsPx: nextColumnWidths,
          rows: nextRows,
        },
      },
      selectedNodeId: nextRows[position.rowIndex].cells[nextColumnIndex]?.id ?? null,
      didUpdate: true,
    };
  }

  return { block, selectedNodeId: null, didUpdate: false };
}

export function mergeTableCellsByRange(
  block: LayoutBlock,
  anchorCellId: string,
  focusCellId: string,
): TableMergeEditResult {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return { block, selectedNodeId: null, didUpdate: false, reason: 'invalidSelection' };
  }

  const selection = buildTableCellRangeSelection(block, anchorCellId, focusCellId);
  if (!selection) {
    return { block, selectedNodeId: null, didUpdate: false, reason: 'invalidSelection' };
  }

  const rowSpan = selection.endRowIndex - selection.startRowIndex + 1;
  const colSpan = selection.endColumnIndex - selection.startColumnIndex + 1;
  if (rowSpan <= 1 && colSpan <= 1) {
    return { block, selectedNodeId: anchorCellId, didUpdate: false, reason: 'singleCell' };
  }

  const tableRows = block.metadata.rows;
  const selectedCells = selection.cellIds
    .map((cellId) => {
      const position = findTableCellPosition(block, cellId);
      return position ? tableRows[position.rowIndex]?.cells[position.columnIndex] ?? null : null;
    })
    .filter((cell): cell is LayoutTableCell => !!cell);

  const hasExistingMerge = selectedCells.some(
    (cell) => isCoveredTableCell(cell) || getTableCellRowSpan(cell) > 1 || getTableCellColSpan(cell) > 1,
  );
  if (hasExistingMerge) {
    return { block, selectedNodeId: anchorCellId, didUpdate: false, reason: 'containsMergedCell' };
  }

  const mainCell = tableRows[selection.startRowIndex]?.cells[selection.startColumnIndex];
  if (!mainCell) {
    return { block, selectedNodeId: anchorCellId, didUpdate: false, reason: 'invalidSelection' };
  }

  const selectedCellIds = new Set(selection.cellIds);
  const mergedTextRuns = buildMergedTableCellTextRuns(mainCell, selectedCells);
  const nextRows = tableRows.map((row) => ({
    ...row,
    sourceRange: null,
    cells: row.cells.map((cell, columnIndex) => {
      if (!selectedCellIds.has(cell.id)) {
        return cell;
      }

      if (cell.id === mainCell.id) {
        return {
          ...cell,
          sourceRange: null,
          textRuns: mergedTextRuns,
          rowSpan,
          colSpan,
          coveredByCellId: null,
        };
      }

      return {
        ...cell,
        sourceRange: null,
        textRuns: [],
        rowSpan: null,
        colSpan: null,
        coveredByCellId: mainCell.id,
      };
    }),
  }));

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        rows: nextRows,
      },
    },
    selectedNodeId: mainCell.id,
    didUpdate: true,
    reason: 'merged',
  };
}

export function updateListStructureByItem(
  block: LayoutBlock,
  itemId: string,
  action: ListStructureAction,
): ListStructureEditResult {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const itemIndex = findListItemIndex(block, itemId);
  if (itemIndex < 0) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const itemCount = block.metadata.items.length;

  if (action === 'insertItemAbove' || action === 'insertItemBelow') {
    const insertIndex = action === 'insertItemAbove' ? itemIndex : itemIndex + 1;
    const existingIds = collectListItemIds(block);
    const newItem = createEmptyListItemForStructureEdit(block, existingIds, insertIndex);
    newItem.level = getLayoutListItemLevel(block.metadata.items[itemIndex]);
    const nextItems = [
      ...block.metadata.items.slice(0, insertIndex),
      newItem,
      ...block.metadata.items.slice(insertIndex),
    ];

    return {
      block: {
        ...block,
        sourceRange: null,
        metadata: {
          ...block.metadata,
          items: nextItems,
        },
      },
      selectedNodeId: newItem.id,
      didUpdate: true,
    };
  }

  if (action === 'deleteItem') {
    if (itemCount <= 1) {
      return { block, selectedNodeId: itemId, didUpdate: false };
    }

    const subtreeRange = getListItemSubtreeRange(block.metadata.items, itemIndex);
    const nextItems = block.metadata.items.filter((_, index) => index < subtreeRange.start || index >= subtreeRange.end);
    if (nextItems.length === 0) {
      return { block, selectedNodeId: itemId, didUpdate: false };
    }
    const nextItemIndex = Math.min(subtreeRange.start, nextItems.length - 1);

    return {
      block: {
        ...block,
        sourceRange: null,
        metadata: {
          ...block.metadata,
          items: nextItems,
        },
      },
      selectedNodeId: nextItems[nextItemIndex]?.id ?? null,
      didUpdate: true,
    };
  }

  return { block, selectedNodeId: null, didUpdate: false };
}

export function updateListOrderedByItem(
  block: LayoutBlock,
  itemId: string,
  ordered: boolean,
): ListPropertyEditResult {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  if (findListItemIndex(block, itemId) < 0) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const nextStart = ordered && block.metadata.start === null ? 1 : block.metadata.start;
  if (block.metadata.ordered === ordered && block.metadata.start === nextStart) {
    return { block, selectedNodeId: itemId, didUpdate: false };
  }

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        ordered,
        start: nextStart,
        items: ordered
          ? block.metadata.items.map((item) => ({
              ...item,
              checked: null,
            }))
          : block.metadata.items,
      },
    },
    selectedNodeId: itemId,
    didUpdate: true,
  };
}

export function updateListStartByItem(
  block: LayoutBlock,
  itemId: string,
  start: number,
): ListPropertyEditResult {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  if (findListItemIndex(block, itemId) < 0) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const normalizedStart = Math.max(1, Math.floor(start));
  if (block.metadata.start === normalizedStart) {
    return { block, selectedNodeId: itemId, didUpdate: false };
  }

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        // 起始编号只在有序列表里真正显示；无序列表保留该值，便于用户切回有序列表。
        start: normalizedStart,
      },
    },
    selectedNodeId: itemId,
    didUpdate: true,
  };
}

export function updateListItemCheckedByItem(
  block: LayoutBlock,
  itemId: string,
  checked: boolean,
): ListPropertyEditResult {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const itemIndex = findListItemIndex(block, itemId);
  if (itemIndex < 0) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const currentItem = block.metadata.items[itemIndex];
  // 只有 Markdown 导入识别出的任务项才允许切换勾选状态，普通列表项不自动变成任务项。
  if (!currentItem || currentItem.checked === null || currentItem.checked === checked) {
    return { block, selectedNodeId: itemId, didUpdate: false };
  }

  const nextItems = block.metadata.items.map((item, index) =>
    index === itemIndex
      ? {
          ...item,
          sourceRange: null,
          checked,
        }
      : item,
  );

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        items: nextItems,
      },
    },
    selectedNodeId: itemId,
    didUpdate: true,
  };
}

export function updateListItemLevelByItem(
  block: LayoutBlock,
  itemId: string,
  action: ListIndentAction,
): ListPropertyEditResult {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const itemIndex = findListItemIndex(block, itemId);
  if (itemIndex < 0) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const currentItem = block.metadata.items[itemIndex];
  const currentLevel = getLayoutListItemLevel(currentItem);
  const previousLevel = itemIndex > 0 ? getLayoutListItemLevel(block.metadata.items[itemIndex - 1]) : 1;
  const nextLevel =
    action === 'indent'
      ? normalizeLayoutListLevel(Math.min(3, Math.max(currentLevel + 1, Math.min(previousLevel + 1, 3))))
      : normalizeLayoutListLevel(Math.max(1, currentLevel - 1));

  if (nextLevel === currentLevel || (action === 'indent' && itemIndex === 0)) {
    return { block, selectedNodeId: itemId, didUpdate: false };
  }

  const subtreeRange = getListItemSubtreeRange(block.metadata.items, itemIndex);
  const levelDelta = nextLevel - currentLevel;

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        items: block.metadata.items.map((item, index) =>
          index >= subtreeRange.start && index < subtreeRange.end
            ? {
                ...item,
                sourceRange: null,
                level: normalizeLayoutListLevel(getLayoutListItemLevel(item) + levelDelta),
              }
            : item,
        ),
      },
    },
    selectedNodeId: itemId,
    didUpdate: true,
  };
}

export function reorderListItemByItem(
  block: LayoutBlock,
  itemId: string,
  action: ListReorderAction,
): ListPropertyEditResult {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const itemIndex = findListItemIndex(block, itemId);
  if (itemIndex < 0) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const subtreeRange = getListItemSubtreeRange(block.metadata.items, itemIndex);
  const siblingLevel = getLayoutListItemLevel(block.metadata.items[itemIndex]);
  let targetIndex = -1;

  if (action === 'moveUp') {
    for (let index = subtreeRange.start - 1; index >= 0; index -= 1) {
      if (getLayoutListItemLevel(block.metadata.items[index]) === siblingLevel) {
        targetIndex = index;
        break;
      }
    }
    if (targetIndex < 0) {
      return { block, selectedNodeId: itemId, didUpdate: false };
    }

    const targetRange = getListItemSubtreeRange(block.metadata.items, targetIndex);
    return {
      block: {
        ...block,
        sourceRange: null,
        metadata: {
          ...block.metadata,
          items: moveListItemSlice(block.metadata.items, subtreeRange, targetRange.start),
        },
      },
      selectedNodeId: itemId,
      didUpdate: true,
    };
  }

  for (let index = subtreeRange.end; index < block.metadata.items.length; index += 1) {
    if (getLayoutListItemLevel(block.metadata.items[index]) === siblingLevel) {
      targetIndex = index;
      break;
    }
  }

  if (targetIndex < 0) {
    return { block, selectedNodeId: itemId, didUpdate: false };
  }

  const targetRange = getListItemSubtreeRange(block.metadata.items, targetIndex);
  const nextItems = moveListItemSlice(block.metadata.items, subtreeRange, targetRange.end - (subtreeRange.end - subtreeRange.start));

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        items: nextItems,
      },
    },
    selectedNodeId: itemId,
    didUpdate: true,
  };
}

export function convertListItemTaskStateByItem(
  block: LayoutBlock,
  itemId: string,
  action: ListTaskConversionAction,
): ListPropertyEditResult {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const itemIndex = findListItemIndex(block, itemId);
  if (itemIndex < 0) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const currentItem = block.metadata.items[itemIndex];
  const nextChecked = action === 'convertToTask' ? (currentItem.checked ?? false) : null;
  if (currentItem.checked === nextChecked) {
    return { block, selectedNodeId: itemId, didUpdate: false };
  }

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        items: block.metadata.items.map((item, index) =>
          index === itemIndex
            ? {
                ...item,
                sourceRange: null,
                checked: nextChecked,
              }
            : item,
        ),
      },
    },
    selectedNodeId: itemId,
    didUpdate: true,
  };
}

export function updateListTaskModeByItem(
  block: LayoutBlock,
  itemId: string,
  taskMode: boolean,
): ListPropertyEditResult {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const metadata = block.metadata;

  if (findListItemIndex(block, itemId) < 0) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const nextItems = metadata.items.map((item) => ({
    ...item,
    checked: taskMode ? (item.checked ?? false) : null,
  }));
  const didUpdate = nextItems.some((item, index) => item.checked !== metadata.items[index].checked);
  if (!didUpdate) {
    return { block, selectedNodeId: itemId, didUpdate: false };
  }

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...metadata,
        ordered: taskMode ? false : metadata.ordered,
        items: nextItems,
      },
    },
    selectedNodeId: itemId,
    didUpdate: true,
  };
}

export function updateListBatchCheckedByItem(
  block: LayoutBlock,
  itemId: string,
  scope: ListBatchCheckedScope,
  action: ListBatchCheckedAction,
): ListBatchEditResult {
  if (block.type !== 'list' || block.metadata.kind !== 'list') {
    return { block, selectedNodeId: null, didUpdate: false, changedCount: 0 };
  }

  const itemIndex = findListItemIndex(block, itemId);
  if (itemIndex < 0) {
    return { block, selectedNodeId: null, didUpdate: false, changedCount: 0 };
  }

  const targetLevel = getLayoutListItemLevel(block.metadata.items[itemIndex]);
  let changedCount = 0;
  const nextChecked = action === 'check';
  const nextItems = block.metadata.items.map((item) => {
    const shouldApply = item.checked !== null && (scope === 'all' || getLayoutListItemLevel(item) === targetLevel);
    if (!shouldApply || item.checked === nextChecked) {
      return item;
    }

    changedCount += 1;
    return {
      ...item,
      sourceRange: null,
      checked: nextChecked,
    };
  });

  if (changedCount === 0) {
    return { block, selectedNodeId: itemId, didUpdate: false, changedCount: 0 };
  }

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        items: nextItems,
      },
    },
    selectedNodeId: itemId,
    didUpdate: true,
    changedCount,
  };
}

export function updateTableHeaderRowByCell(
  block: LayoutBlock,
  cellId: string,
  enabled: boolean,
): TablePropertyEditResult {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const position = findTableCellPosition(block, cellId);
  if (!position) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const headerRow = block.metadata.rows[0];
  if (!headerRow || headerRow.cells.every((cell) => cell.isHeader === enabled)) {
    return { block, selectedNodeId: cellId, didUpdate: false };
  }

  // 表头开关只作用于第一行，避免误改用户后续可能手工维护的其他行语义。
  const nextRows = block.metadata.rows.map((row, rowIndex) =>
    rowIndex === 0
      ? {
          ...row,
          sourceRange: null,
          cells: row.cells.map((cell) => ({
            ...cell,
            sourceRange: null,
            isHeader: enabled,
          })),
        }
      : row,
  );

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        rows: nextRows,
      },
    },
    selectedNodeId: cellId,
    didUpdate: true,
  };
}

export function updateTableColumnAlignByCell(
  block: LayoutBlock,
  cellId: string,
  align: TableColumnAlign,
): TablePropertyEditResult {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const position = findTableCellPosition(block, cellId);
  if (!position) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const nextAlign = [...block.metadata.align];
  while (nextAlign.length <= position.columnIndex) {
    nextAlign.push(null);
  }

  if (nextAlign[position.columnIndex] === align) {
    return { block, selectedNodeId: cellId, didUpdate: false };
  }

  nextAlign[position.columnIndex] = align;

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        align: nextAlign,
      },
    },
    selectedNodeId: cellId,
    didUpdate: true,
  };
}

export function updateTableColumnWidthsByCell(
  block: LayoutBlock,
  cellId: string,
  columnWidthsPx: Array<number | null>,
): TablePropertyEditResult {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const position = findTableCellPosition(block, cellId);
  if (!position) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const columnCount = block.metadata.rows[0]?.cells.length ?? 0;
  if (columnCount <= 0) {
    return { block, selectedNodeId: cellId, didUpdate: false };
  }

  const nextColumnWidths = normalizeTableColumnWidths(columnWidthsPx, columnCount);
  const currentColumnWidths = normalizeTableColumnWidths(block.metadata.columnWidthsPx, columnCount);
  const didChange = nextColumnWidths.some((width, index) => width !== currentColumnWidths[index]);
  if (!didChange) {
    return { block, selectedNodeId: cellId, didUpdate: false };
  }

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        columnWidthsPx: nextColumnWidths,
      },
    },
    selectedNodeId: cellId,
    didUpdate: true,
  };
}

export function updateTableAutoFitSizeByCell(
  block: LayoutBlock,
  cellId: string,
  options: ResolveTableAutoFitSizeOptions,
): TablePropertyEditResult {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const position = findTableCellPosition(block, cellId);
  if (!position) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  return updateTableAutoFitSize(block, cellId, options);
}

export function updateTableAutoFitSize(
  block: LayoutBlock,
  selectedNodeId: string,
  options: ResolveTableAutoFitSizeOptions,
): TablePropertyEditResult {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const autoFitSize = resolveTableAutoFitSize(block, options);
  if (!autoFitSize) {
    return { block, selectedNodeId, didUpdate: false };
  }

  const tableMetadata = block.metadata;
  const columnCount = tableMetadata.rows[0]?.cells.length ?? 0;
  const nextColumnWidths = normalizeTableColumnWidths(autoFitSize.columnWidthsPx, columnCount);
  const currentColumnWidths = normalizeTableColumnWidths(tableMetadata.columnWidthsPx, columnCount);
  const nextRows = tableMetadata.rows.map((row, rowIndex) => ({
    ...row,
    sourceRange: null,
    heightPx: normalizeTableRowHeightPx(autoFitSize.rowHeightsPx[rowIndex]),
  }));
  const didColumnChange = nextColumnWidths.some((width, index) => width !== currentColumnWidths[index]);
  const didRowChange = nextRows.some((row, rowIndex) => row.heightPx !== (tableMetadata.rows[rowIndex]?.heightPx ?? null));

  if (!didColumnChange && !didRowChange) {
    return { block, selectedNodeId, didUpdate: false };
  }

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        columnWidthsPx: nextColumnWidths,
        rows: nextRows,
      },
    },
    selectedNodeId,
    didUpdate: true,
  };
}

function hasSavedTableSize(block: LayoutBlock): boolean {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return false;
  }

  const hasColumnWidth = block.metadata.columnWidthsPx?.some((width) => normalizeTableColumnWidthPx(width) !== null) ?? false;
  const hasRowHeight = block.metadata.rows.some((row) => normalizeTableRowHeightPx(row.heightPx) !== null);
  return hasColumnWidth || hasRowHeight;
}

function getFirstTableCellId(block: LayoutBlock): string | null {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return null;
  }

  return block.metadata.rows[0]?.cells[0]?.id ?? block.id;
}

export function autoFitTablesInLayoutDocument(
  document: LayoutDocument,
  styleSettings: StyleSettings = defaultStyleSettings,
  options: { preserveSavedSize?: boolean } = {},
): { document: LayoutDocument; didUpdate: boolean } {
  const preserveSavedSize = options.preserveSavedSize ?? true;
  const contract = resolveStyleContract(styleSettings);
  const tableStyle = contract.blockStyles.table;
  const baseFontSizePx = contract.blockStyles.paragraph.fontSize;
  const baseLineHeightPx = contract.blockStyles.paragraph.lineHeight;
  let didUpdate = false;

  const visitBlocks = (blocks: LayoutBlock[]): { blocks: LayoutBlock[]; didUpdate: boolean } => {
    let didUpdateBlocks = false;
    const nextBlocks = blocks.map((block) => {
      if (block.type === 'table' && block.metadata.kind === 'table') {
        if (preserveSavedSize && hasSavedTableSize(block)) {
          return block;
        }

        const selectedNodeId = getFirstTableCellId(block);
        if (!selectedNodeId) {
          return block;
        }

        const result = updateTableAutoFitSize(block, selectedNodeId, {
          // 导入阶段只做一次预适应，宽度口径跟分栏分页和手动按钮保持一致。
          contentWidthPx: contract.singleColumnContentWidthPx,
          rowHeightPx: tableStyle.rowHeight,
          headerRowHeightPx: tableStyle.headerRowHeight,
          cellPaddingX: tableStyle.cellPaddingX,
          cellPaddingY: tableStyle.cellPaddingY,
          getCellMetrics: ({ cell }) => {
            const fontSizePx = getEffectiveTableCellMaxFontSize({
              cell,
              block,
              styles: document.styles,
              fallback: baseFontSizePx,
            });

            return {
              fontSizePx,
              lineHeightPx: resolveEffectiveTextLineHeight({
                fontSize: fontSizePx,
                baseFontSize: baseFontSizePx,
                baseLineHeight: block.blockStyleOverrides.lineHeight ?? baseLineHeightPx,
              }),
            };
          },
        });

        if (result.didUpdate) {
          didUpdateBlocks = true;
          return result.block;
        }

        return block;
      }

      if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
        const nestedResult = visitBlocks(block.metadata.blocks);
        if (nestedResult.didUpdate) {
          didUpdateBlocks = true;
          return {
            ...block,
            sourceRange: null,
            metadata: {
              ...block.metadata,
              blocks: nestedResult.blocks,
            },
          };
        }
      }

      if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
        const nestedResult = visitBlocks(block.metadata.blocks);
        if (nestedResult.didUpdate) {
          didUpdateBlocks = true;
          return {
            ...block,
            sourceRange: null,
            metadata: {
              ...block.metadata,
              blocks: nestedResult.blocks,
            },
          };
        }
      }

      return block;
    });

    return { blocks: nextBlocks, didUpdate: didUpdateBlocks };
  };

  const blockResult = visitBlocks(document.blocks);
  didUpdate = blockResult.didUpdate;
  if (!didUpdate) {
    return { document, didUpdate: false };
  }

  return {
    document: {
      ...document,
      blocks: blockResult.blocks,
      meta: {
        ...document.meta,
        updatedAt: new Date().toISOString(),
      },
    },
    didUpdate: true,
  };
}

export function updateTableRowHeightByCell(
  block: LayoutBlock,
  cellId: string,
  heightPx: number | null,
): TablePropertyEditResult {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const position = findTableCellPosition(block, cellId);
  if (!position) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const row = block.metadata.rows[position.rowIndex];
  if (!row) {
    return { block, selectedNodeId: cellId, didUpdate: false };
  }

  const nextHeightPx = normalizeTableRowHeightPx(heightPx);
  if ((row.heightPx ?? null) === nextHeightPx) {
    return { block, selectedNodeId: cellId, didUpdate: false };
  }

  const nextRows = block.metadata.rows.map((currentRow, rowIndex) =>
    rowIndex === position.rowIndex
      ? {
          ...currentRow,
          sourceRange: null,
          heightPx: nextHeightPx,
        }
      : currentRow,
  );

  return {
    block: {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        rows: nextRows,
      },
    },
    selectedNodeId: cellId,
    didUpdate: true,
  };
}

export function updateBlockquoteStructureByNode(
  block: LayoutBlock,
  nodeId: string,
  action: BlockquoteStructureAction,
): BlockquoteStructureEditResult {
  if (block.type !== 'blockquote' || block.metadata.kind !== 'blockquote') {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const childIndex = findDirectBlockIndexForNodeId(block.metadata.blocks, nodeId);
  if (childIndex < 0) {
    return { block, selectedNodeId: null, didUpdate: false };
  }

  const childCount = block.metadata.blocks.length;

  if (action === 'insertParagraphAbove' || action === 'insertParagraphBelow') {
    const insertIndex = action === 'insertParagraphAbove' ? childIndex : childIndex + 1;
    const existingIds = collectNestedNodeIds(block.metadata.blocks);
    const newParagraphBlock = createEmptyParagraphBlockForStructureEdit(block, existingIds, insertIndex);
    const nextBlocks = [
      ...block.metadata.blocks.slice(0, insertIndex),
      newParagraphBlock,
      ...block.metadata.blocks.slice(insertIndex),
    ];

    return {
      block: {
        ...block,
        sourceRange: null,
        metadata: {
          ...block.metadata,
          blocks: nextBlocks,
        },
      },
      selectedNodeId: newParagraphBlock.id,
      didUpdate: true,
    };
  }

  if (action === 'deleteBlock') {
    if (childCount <= 1) {
      return { block, selectedNodeId: nodeId, didUpdate: false };
    }

    const nextBlocks = block.metadata.blocks.filter((_, index) => index !== childIndex);
    const nextChildIndex = Math.min(childIndex, nextBlocks.length - 1);

    return {
      block: {
        ...block,
        sourceRange: null,
        metadata: {
          ...block.metadata,
          blocks: nextBlocks,
        },
      },
      selectedNodeId: nextBlocks[nextChildIndex]?.id ?? null,
      didUpdate: true,
    };
  }

  return { block, selectedNodeId: null, didUpdate: false };
}

export function getTextContentFromRuns(textRuns: TextRun[]): string {
  return textRuns.map((run) => run.text).join('');
}

export function getLayoutBlockTextContent(block: LayoutBlock): string {
  return getTextContentFromRuns(block.textRuns);
}

function isSemanticKeywordTargetBlock(block: LayoutBlock): boolean {
  return (
    (block.type === 'heading' && block.metadata.kind === 'heading') ||
    (block.type === 'paragraph' && block.metadata.kind === 'paragraph')
  );
}

function stripTextPrefixFromTextRuns(
  textRuns: TextRun[],
  nodeId: string,
  prefixLength: number,
): TextRun[] {
  if (prefixLength <= 0) {
    return textRuns;
  }

  let remainingPrefixLength = prefixLength;
  const nextRuns: TextRun[] = [];

  for (const run of textRuns) {
    if (remainingPrefixLength >= run.text.length) {
      remainingPrefixLength -= run.text.length;
      continue;
    }

    if (remainingPrefixLength > 0) {
      nextRuns.push({
        ...run,
        text: run.text.slice(remainingPrefixLength),
        sourceRange: null,
      });
      remainingPrefixLength = 0;
      continue;
    }

    nextRuns.push({ ...run });
  }

  return rebuildRunIds(nodeId, mergeAdjacentTextRuns(nextRuns));
}

function updateSemanticKeywordTargetTextRuns(
  block: LayoutBlock,
  textRuns: TextRun[],
): LayoutBlock {
  const nextText = getTextContentFromRuns(textRuns);

  if (block.type === 'heading' && block.metadata.kind === 'heading') {
    return {
      ...block,
      sourceRange: null,
      textRuns,
      metadata: {
        ...block.metadata,
        text: nextText,
      },
    };
  }

  if (block.type === 'paragraph' && block.metadata.kind === 'paragraph') {
    return {
      ...block,
      sourceRange: null,
      textRuns,
      metadata: {
        ...block.metadata,
        text: nextText,
      },
    };
  }

  return block;
}

export function isEditableLayoutTextBlock(block: LayoutBlock): boolean {
  return (
    block.type === 'heading' ||
    block.type === 'paragraph' ||
    block.type === 'code' ||
    block.type === 'image' ||
    block.type === 'equation'
  );
}

export function updateLayoutBlockText(block: LayoutBlock, nextText: string): LayoutBlock {
  if (!isEditableLayoutTextBlock(block)) {
    return block;
  }

  const normalizedText = nextText.replace(/\r\n?/g, '\n');
  const currentText =
    block.type === 'image' && block.metadata.kind === 'image'
      ? block.metadata.alt
      : block.type === 'equation' && block.metadata.kind === 'equation'
        ? block.metadata.value
        : getLayoutBlockTextContent(block);

  if (currentText === normalizedText) {
    return block;
  }

  const textRuns = createReplacementTextRuns(block.id, normalizedText, block.textRuns);

  if (block.type === 'heading' && block.metadata.kind === 'heading') {
    return {
      ...block,
      sourceRange: null,
      textRuns,
      metadata: {
        ...block.metadata,
        text: normalizedText,
      },
    };
  }

  if (block.type === 'paragraph' && block.metadata.kind === 'paragraph') {
    return {
      ...block,
      sourceRange: null,
      textRuns,
      metadata: {
        ...block.metadata,
        text: normalizedText,
      },
    };
  }

  if (block.type === 'code' && block.metadata.kind === 'code') {
    return {
      ...block,
      sourceRange: null,
      textRuns,
      metadata: {
        ...block.metadata,
        value: normalizedText,
      },
    };
  }

  if (block.type === 'image' && block.metadata.kind === 'image') {
    return {
      ...block,
      sourceRange: null,
      metadata: {
        ...block.metadata,
        alt: normalizedText,
      },
    };
  }

  if (block.type === 'equation' && block.metadata.kind === 'equation') {
    return {
      ...block,
      sourceRange: null,
      textRuns,
      metadata: {
        ...block.metadata,
        value: normalizedText,
      },
    };
  }

  return block;
}

export function updateLayoutImageAttributes(
  block: LayoutBlock,
  attributes: {
    src: string;
    alt: string;
    title: string | null;
    widthPx?: number | null;
    heightPx?: number | null;
    lockAspectRatio?: boolean;
    objectFit?: 'contain' | 'cover';
    cropTopPx?: number | null;
    cropRightPx?: number | null;
    cropBottomPx?: number | null;
    cropLeftPx?: number | null;
    wrapMode?: ImageBlockMetadata['wrapMode'];
    wrapSide?: ImageWrapSide;
    showCaption?: boolean;
    offsetX?: number | null;
    offsetY?: number | null;
  },
): LayoutBlock {
  if (block.type !== 'image' || block.metadata.kind !== 'image') {
    return block;
  }

  if (
    block.metadata.src === attributes.src &&
    block.metadata.alt === attributes.alt &&
    block.metadata.title === attributes.title &&
    (attributes.widthPx === undefined || block.metadata.widthPx === attributes.widthPx) &&
    (attributes.heightPx === undefined || block.metadata.heightPx === attributes.heightPx) &&
    (attributes.lockAspectRatio === undefined || (block.metadata.lockAspectRatio ?? true) === attributes.lockAspectRatio) &&
    (attributes.objectFit === undefined || (block.metadata.objectFit ?? 'contain') === attributes.objectFit) &&
    (attributes.cropTopPx === undefined || (block.metadata.cropTopPx ?? 0) === normalizeOptionalNumber(attributes.cropTopPx)) &&
    (attributes.cropRightPx === undefined || (block.metadata.cropRightPx ?? 0) === normalizeOptionalNumber(attributes.cropRightPx)) &&
    (attributes.cropBottomPx === undefined || (block.metadata.cropBottomPx ?? 0) === normalizeOptionalNumber(attributes.cropBottomPx)) &&
    (attributes.cropLeftPx === undefined || (block.metadata.cropLeftPx ?? 0) === normalizeOptionalNumber(attributes.cropLeftPx)) &&
    (attributes.wrapMode === undefined || normalizeImageWrapMode(block.metadata.wrapMode) === normalizeImageWrapMode(attributes.wrapMode)) &&
    (attributes.wrapSide === undefined || resolveImageWrapSide(block.metadata) === attributes.wrapSide) &&
    (attributes.showCaption === undefined || (block.metadata.showCaption ?? false) === attributes.showCaption) &&
    // 偏移量判断使用 normalizeOffsetValue 进行取整比较
    (attributes.offsetX === undefined || normalizeOffsetValue(block.metadata.offsetX ?? 0) === normalizeOffsetValue(attributes.offsetX)) &&
    (attributes.offsetY === undefined || normalizeOffsetValue(block.metadata.offsetY ?? 0) === normalizeOffsetValue(attributes.offsetY))
  ) {
    return block;
  }

  const currentWidthPx = block.metadata.widthPx ?? null;
  const currentHeightPx = block.metadata.heightPx ?? null;
  const currentCropTopPx = block.metadata.cropTopPx ?? 0;
  const currentCropRightPx = block.metadata.cropRightPx ?? 0;
  const currentCropBottomPx = block.metadata.cropBottomPx ?? 0;
  const currentCropLeftPx = block.metadata.cropLeftPx ?? 0;
  const currentWrapSide = resolveImageWrapSide(block.metadata);
  const nextWrapMode = normalizeImageWrapMode(attributes.wrapMode ?? block.metadata.wrapMode);
  const nextWrapSide = attributes.wrapSide ?? (
    attributes.wrapMode === 'left' || attributes.wrapMode === 'right'
      ? resolveImageWrapSide({ wrapMode: attributes.wrapMode })
      : currentWrapSide
  );

  return {
    ...block,
    sourceRange: null,
    metadata: {
      ...block.metadata,
      src: attributes.src,
      alt: attributes.alt,
      title: attributes.title,
      widthPx:
        attributes.widthPx === undefined ? currentWidthPx : normalizeOptionalNumber(attributes.widthPx),
      heightPx:
        attributes.heightPx === undefined ? currentHeightPx : normalizeOptionalNumber(attributes.heightPx),
      lockAspectRatio: attributes.lockAspectRatio ?? block.metadata.lockAspectRatio ?? true,
      objectFit: attributes.objectFit ?? block.metadata.objectFit ?? 'contain',
      cropTopPx:
        attributes.cropTopPx === undefined ? currentCropTopPx : normalizeOptionalNumber(attributes.cropTopPx) ?? 0,
      cropRightPx:
        attributes.cropRightPx === undefined ? currentCropRightPx : normalizeOptionalNumber(attributes.cropRightPx) ?? 0,
      cropBottomPx:
        attributes.cropBottomPx === undefined ? currentCropBottomPx : normalizeOptionalNumber(attributes.cropBottomPx) ?? 0,
      cropLeftPx:
        attributes.cropLeftPx === undefined ? currentCropLeftPx : normalizeOptionalNumber(attributes.cropLeftPx) ?? 0,
      wrapMode: nextWrapMode,
      wrapSide: nextWrapSide,
      showCaption: attributes.showCaption ?? block.metadata.showCaption ?? false,
      // 偏移量可以允许负数，所以使用 normalizeOffsetValue 而不是 normalizeOptionalNumber
      offsetX: attributes.offsetX === undefined ? (block.metadata.offsetX ?? 0) : normalizeOffsetValue(attributes.offsetX),
      offsetY: attributes.offsetY === undefined ? (block.metadata.offsetY ?? 0) : normalizeOffsetValue(attributes.offsetY),
    },
  };
}

export function updateColumnSectionAttributes(
  block: LayoutBlock,
  attributes: {
    columnCount?: ColumnSectionColumnCount;
    columnGapMm?: number;
    divider?: boolean;
    headingsSpanAll?: boolean;
  },
): LayoutBlock {
  if (block.type !== 'columnSection' || block.metadata.kind !== 'columnSection') {
    return block;
  }

  const nextColumnCount = attributes.columnCount ?? block.metadata.columnCount;
  const nextColumnGapMm = attributes.columnGapMm === undefined
    ? block.metadata.columnGapMm
    : normalizeColumnSectionGapMm(attributes.columnGapMm);
  const nextDivider = attributes.divider ?? block.metadata.divider;
  const nextHeadingsSpanAll = attributes.headingsSpanAll ?? block.metadata.headingsSpanAll;

  if (
    nextColumnCount === block.metadata.columnCount &&
    nextColumnGapMm === block.metadata.columnGapMm &&
    nextDivider === block.metadata.divider &&
    nextHeadingsSpanAll === block.metadata.headingsSpanAll
  ) {
    return block;
  }

  return {
    ...block,
    sourceRange: null,
    metadata: {
      ...block.metadata,
      columnCount: nextColumnCount,
      columnGapMm: nextColumnGapMm,
      divider: nextDivider,
      headingsSpanAll: nextHeadingsSpanAll,
    },
  };
}

export function unwrapTopLevelColumnSectionById(
  blocks: LayoutBlock[],
  columnSectionId: string,
): {
  blocks: LayoutBlock[];
  selectedNodeId: string | null;
  didUpdate: boolean;
  unwrappedCount: number;
} {
  const blockIndex = blocks.findIndex((block) =>
    block.id === columnSectionId &&
    block.type === 'columnSection' &&
    block.metadata.kind === 'columnSection',
  );

  if (blockIndex < 0) {
    return {
      blocks,
      selectedNodeId: null,
      didUpdate: false,
      unwrappedCount: 0,
    };
  }

  const targetBlock = blocks[blockIndex];
  if (targetBlock.type !== 'columnSection' || targetBlock.metadata.kind !== 'columnSection') {
    return {
      blocks,
      selectedNodeId: null,
      didUpdate: false,
      unwrappedCount: 0,
    };
  }

  // 解除局部分栏后直接恢复内部块顺序，不再保留容器壳。
  const restoredBlocks = targetBlock.metadata.blocks.map((block) => ({
    ...block,
    sourceRange: null,
  }));
  const nextBlocks = [
    ...blocks.slice(0, blockIndex),
    ...restoredBlocks,
    ...blocks.slice(blockIndex + 1),
  ];

  return {
    blocks: nextBlocks,
    selectedNodeId: restoredBlocks[0]?.id ?? blocks[blockIndex + 1]?.id ?? blocks[blockIndex - 1]?.id ?? null,
    didUpdate: true,
    unwrappedCount: restoredBlocks.length,
  };
}

function normalizeOptionalNumber(value: number | null | undefined): number | null | undefined {
  if (value === null || value === undefined) {
    return value;
  }

  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

// 偏移量可以允许负数，只需要取整
function normalizeOffsetValue(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number.isFinite(value) ? Math.round(value) : 0;
}

export function updateLayoutListItemText(item: LayoutListItem, nextText: string): LayoutListItem {
  const normalizedText = nextText.replace(/\r\n?/g, '\n');
  if (getTextContentFromRuns(item.textRuns) === normalizedText) {
    return item;
  }

  return {
    ...item,
    sourceRange: null,
    textRuns: createReplacementTextRuns(item.id, normalizedText, item.textRuns),
  };
}

export function updateLayoutTableCellText(cell: LayoutTableCell, nextText: string): LayoutTableCell {
  const normalizedText = nextText.replace(/\r\n?/g, '\n');
  if (getTextContentFromRuns(cell.textRuns) === normalizedText) {
    return cell;
  }

  return {
    ...cell,
    sourceRange: null,
    textRuns: createReplacementTextRuns(cell.id, normalizedText, cell.textRuns),
  };
}

export function mergeAdjacentTextRuns(textRuns: TextRun[]): TextRun[] {
  const merged: TextRun[] = [];

  for (const run of textRuns) {
    if (!run.text) {
      continue;
    }

    const previousRun = merged[merged.length - 1];
    if (
      previousRun &&
      previousRun.charStyleRef === run.charStyleRef &&
      areMarksEqual(previousRun.marks, run.marks) &&
      areAnnotationsEqual(previousRun.annotations, run.annotations) &&
      areStyleOverridesEqual(previousRun.styleOverrides, run.styleOverrides)
    ) {
      previousRun.text += run.text;
      previousRun.sourceRange =
        previousRun.sourceRange && run.sourceRange
          ? {
              start: previousRun.sourceRange.start,
              end: run.sourceRange.end,
            }
          : null;
      continue;
    }

    merged.push({ ...run });
  }

  return merged;
}

function createRunSegment(run: TextRun, text: string, isFullSlice: boolean): TextRun {
  return {
    ...run,
    text,
    // 片段拆分后的源码定位先保守置空，避免写出错误的精确范围。
    sourceRange: isFullSlice ? run.sourceRange : null,
  };
}

function validateSelection(selection: TextRangeSelection, textLength: number): void {
  if (selection.start < 0 || selection.end < 0) {
    throw new Error('TextRangeSelection 不能使用负数');
  }

  if (selection.start >= selection.end) {
    throw new Error('TextRangeSelection 的结束位置必须大于开始位置');
  }

  if (selection.end > textLength) {
    throw new Error(`TextRangeSelection 超出文本长度：${selection.end} > ${textLength}`);
  }
}

function normalizeSelection(
  selection: TextRangeSelection | null,
  textLength: number,
): TextRangeSelection | null {
  if (textLength <= 0) {
    return null;
  }

  // 没有有效选区时，默认把样式作用到整个节点文字。
  if (!selection || selection.start === selection.end) {
    return { start: 0, end: textLength };
  }

  validateSelection(selection, textLength);
  return selection;
}

function hasMarkType(run: TextRun, markType: TextMarkType): boolean {
  return run.marks.some((mark) => mark.type === markType);
}

function hasClearableVisualTextFormatting(run: TextRun): boolean {
  return (
    run.marks.some((mark) => clearableVisualTextMarkTypes.includes(mark.type)) ||
    clearableVisualTextStyleKeys.some((key) => run.styleOverrides[key] !== undefined)
  );
}

function clearVisualTextFormattingFromRun(run: TextRun): TextRun {
  const nextStyleOverrides = { ...run.styleOverrides };

  for (const key of clearableVisualTextStyleKeys) {
    delete nextStyleOverrides[key];
  }

  return {
    ...run,
    marks: run.marks.filter((mark) => !clearableVisualTextMarkTypes.includes(mark.type)),
    styleOverrides: nextStyleOverrides,
  };
}

function applyPatchToRun(run: TextRun, patch: TextRunPatch): TextRun {
  return {
    ...run,
    marks: patch.marks ? dedupeMarks([...run.marks, ...patch.marks]) : run.marks,
    charStyleRef: patch.charStyleRef !== undefined ? patch.charStyleRef : run.charStyleRef,
    styleOverrides: patch.styleOverrides
      ? { ...run.styleOverrides, ...patch.styleOverrides }
      : run.styleOverrides,
    annotations: patch.annotations
      ? dedupeAnnotations([...run.annotations, ...patch.annotations])
      : run.annotations,
  };
}

export function applyTextRunPatchToTextRuns(
  textRuns: TextRun[],
  nodeId: string,
  selection: TextRangeSelection | null,
  patch: TextRunPatch,
): TextRun[] {
  const textContent = getTextContentFromRuns(textRuns);
  const normalizedSelection = normalizeSelection(selection, textContent.length);
  if (!normalizedSelection) {
    return textRuns;
  }

  const nextRuns: TextRun[] = [];
  let cursor = 0;

  for (const run of textRuns) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;

    if (normalizedSelection.end <= runStart || normalizedSelection.start >= runEnd) {
      nextRuns.push({ ...run });
      continue;
    }

    const localStart = Math.max(normalizedSelection.start - runStart, 0);
    const localEnd = Math.min(normalizedSelection.end - runStart, run.text.length);
    const beforeText = run.text.slice(0, localStart);
    const selectedText = run.text.slice(localStart, localEnd);
    const afterText = run.text.slice(localEnd);

    if (beforeText) {
      nextRuns.push(createRunSegment(run, beforeText, beforeText.length === run.text.length));
    }

    if (selectedText) {
      nextRuns.push(
        applyPatchToRun(
          createRunSegment(run, selectedText, selectedText.length === run.text.length),
          patch,
        ),
      );
    }

    if (afterText) {
      nextRuns.push(createRunSegment(run, afterText, afterText.length === run.text.length));
    }
  }

  return rebuildRunIds(nodeId, mergeAdjacentTextRuns(nextRuns));
}

export function applyTextRunPatchToBlock(
  block: LayoutBlock,
  selection: TextRangeSelection | null,
  patch: TextRunPatch,
): LayoutBlock {
  const nextRuns = applyTextRunPatchToTextRuns(block.textRuns, block.id, selection, patch);
  if (nextRuns === block.textRuns) {
    return block;
  }

  return {
    ...block,
    textRuns: nextRuns,
  };
}

function isMarkFullyApplied(
  textRuns: TextRun[],
  selection: TextRangeSelection | null,
  markType: TextMarkType,
): boolean {
  const textContent = getTextContentFromRuns(textRuns);
  const normalizedSelection = normalizeSelection(selection, textContent.length);
  if (!normalizedSelection) {
    return false;
  }

  let cursor = 0;
  let hasSelectedText = false;

  for (const run of textRuns) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;

    if (normalizedSelection.end <= runStart || normalizedSelection.start >= runEnd) {
      continue;
    }

    const localStart = Math.max(normalizedSelection.start - runStart, 0);
    const localEnd = Math.min(normalizedSelection.end - runStart, run.text.length);
    if (localStart === localEnd) {
      continue;
    }

    hasSelectedText = true;
    if (!hasMarkType(run, markType)) {
      return false;
    }
  }

  return hasSelectedText;
}

export function toggleTextMarkInTextRuns(
  textRuns: TextRun[],
  nodeId: string,
  selection: TextRangeSelection | null,
  markType: TextMarkType,
): TextRun[] {
  const textContent = getTextContentFromRuns(textRuns);
  const normalizedSelection = normalizeSelection(selection, textContent.length);
  if (!normalizedSelection) {
    return textRuns;
  }

  const shouldRemove = isMarkFullyApplied(textRuns, normalizedSelection, markType);
  const nextRuns: TextRun[] = [];
  let cursor = 0;

  for (const run of textRuns) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;

    if (normalizedSelection.end <= runStart || normalizedSelection.start >= runEnd) {
      nextRuns.push({ ...run });
      continue;
    }

    const localStart = Math.max(normalizedSelection.start - runStart, 0);
    const localEnd = Math.min(normalizedSelection.end - runStart, run.text.length);
    const beforeText = run.text.slice(0, localStart);
    const selectedText = run.text.slice(localStart, localEnd);
    const afterText = run.text.slice(localEnd);

    if (beforeText) {
      nextRuns.push(createRunSegment(run, beforeText, beforeText.length === run.text.length));
    }

    if (selectedText) {
      const selectedRun = createRunSegment(run, selectedText, selectedText.length === run.text.length);
      nextRuns.push({
        ...selectedRun,
        marks: shouldRemove
          ? selectedRun.marks.filter((mark) => mark.type !== markType)
          : dedupeMarks([...selectedRun.marks, { type: markType }]),
      });
    }

    if (afterText) {
      nextRuns.push(createRunSegment(run, afterText, afterText.length === run.text.length));
    }
  }

  return rebuildRunIds(nodeId, mergeAdjacentTextRuns(nextRuns));
}

export function clearTextFormattingInTextRuns(
  textRuns: TextRun[],
  nodeId: string,
  selection: TextRangeSelection | null,
): TextRun[] {
  const textContent = getTextContentFromRuns(textRuns);
  const normalizedSelection = normalizeSelection(selection, textContent.length);
  if (!normalizedSelection) {
    return textRuns;
  }

  let hasFormattingToClear = false;
  let cursor = 0;

  for (const run of textRuns) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;

    if (normalizedSelection.end <= runStart || normalizedSelection.start >= runEnd) {
      continue;
    }

    if (hasClearableVisualTextFormatting(run)) {
      hasFormattingToClear = true;
      break;
    }
  }

  if (!hasFormattingToClear) {
    return textRuns;
  }

  const nextRuns: TextRun[] = [];
  cursor = 0;

  for (const run of textRuns) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;

    if (normalizedSelection.end <= runStart || normalizedSelection.start >= runEnd) {
      nextRuns.push({ ...run });
      continue;
    }

    const localStart = Math.max(normalizedSelection.start - runStart, 0);
    const localEnd = Math.min(normalizedSelection.end - runStart, run.text.length);
    const beforeText = run.text.slice(0, localStart);
    const selectedText = run.text.slice(localStart, localEnd);
    const afterText = run.text.slice(localEnd);

    if (beforeText) {
      nextRuns.push(createRunSegment(run, beforeText, beforeText.length === run.text.length));
    }

    if (selectedText) {
      // 仅清空选中的那一段，保留未选中的前后文字及其原有格式。
      nextRuns.push(
        clearVisualTextFormattingFromRun(
          createRunSegment(run, selectedText, selectedText.length === run.text.length),
        ),
      );
    }

    if (afterText) {
      nextRuns.push(createRunSegment(run, afterText, afterText.length === run.text.length));
    }
  }

  return rebuildRunIds(nodeId, mergeAdjacentTextRuns(nextRuns));
}

export function toggleTextMarkOnBlock(
  block: LayoutBlock,
  selection: TextRangeSelection | null,
  markType: TextMarkType,
): LayoutBlock {
  return {
    ...block,
    textRuns: toggleTextMarkInTextRuns(block.textRuns, block.id, selection, markType),
  };
}

export function applyTextStyleToBlock(
  block: LayoutBlock,
  selection: TextRangeSelection | null,
  styleOverrides: TextStyleOverrides,
): LayoutBlock {
  return applyTextRunPatchToBlock(block, selection, { styleOverrides });
}

export function applyAnswerAnnotationToBlock(
  block: LayoutBlock,
  selection: TextRangeSelection | null,
  blankMode: 'underline' | 'hidden' = 'underline',
): LayoutBlock {
  const normalizedSelection = normalizeSelection(selection, getLayoutBlockTextContent(block).length);
  if (!normalizedSelection) {
    return block;
  }

  return applyTextRunPatchToBlock(block, selection, {
    annotations: [
      {
        type: 'answer',
        id: `answer-${block.id}-${normalizedSelection.start}-${normalizedSelection.end}`,
        blankMode,
      },
    ],
  });
}

export function applyBlockStyleOverridesToBlock(
  block: LayoutBlock,
  blockStyleOverrides: BlockStyleOverrides,
): LayoutBlock {
  return {
    ...block,
    blockStyleOverrides: {
      ...block.blockStyleOverrides,
      ...blockStyleOverrides,
    },
  };
}

export function applySemanticToLayoutBlock(
  block: LayoutBlock,
  semantic: LayoutBlockSemantic | null,
  config?: LayoutSemanticRoleConfig,
): LayoutBlock {
  return applySemanticToBlock(block, semantic, config);
}

export function applySemanticPresetToLayoutBlock(
  block: LayoutBlock,
  presetId: SemanticBlockPresetId | null,
): LayoutBlock {
  return applySemanticPresetToBlock(block, presetId);
}

function createSemanticKeywordScanItem(
  block: LayoutBlock,
  config: LayoutSemanticRoleConfig,
  options: SemanticKeywordApplyOptions,
): SemanticKeywordScanItem | null {
  if (!isSemanticKeywordTargetBlock(block)) {
    return null;
  }

  const originalText = getTextContentFromRuns(block.textRuns);
  const match = findSemanticKeywordPrefixMatch(originalText, config);
  if (!match) {
    return null;
  }

  return {
    blockId: block.id,
    roleId: match.role.id,
    roleName: match.role.name,
    ruleId: match.rule.id,
    keyword: match.rule.keyword,
    originalText,
    previewText: match.content,
    stripKeyword: match.rule.stripKeyword,
    status: block.semantic && !options.overwriteExisting ? 'skippedExisting' : 'applicable',
  };
}

function collectSemanticKeywordScanItems(
  blocks: LayoutBlock[],
  config: LayoutSemanticRoleConfig,
  options: SemanticKeywordApplyOptions,
): SemanticKeywordScanItem[] {
  const items: SemanticKeywordScanItem[] = [];

  for (const block of blocks) {
    const item = createSemanticKeywordScanItem(block, config, options);
    if (item) {
      items.push(item);
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      items.push(...collectSemanticKeywordScanItems(block.metadata.blocks, config, options));
      continue;
    }

    if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
      items.push(...collectSemanticKeywordScanItems(block.metadata.blocks, config, options));
    }
  }

  return items;
}

function summarizeSemanticKeywordScanItems(items: SemanticKeywordScanItem[]): SemanticKeywordScanResult {
  return {
    items,
    applicableCount: items.filter((item) => item.status === 'applicable').length,
    skippedExistingCount: items.filter((item) => item.status === 'skippedExisting').length,
  };
}

export function scanSemanticKeywordRulesInBlocks(
  blocks: LayoutBlock[],
  config: LayoutSemanticRoleConfig,
  options: SemanticKeywordApplyOptions = {},
): SemanticKeywordScanResult {
  return summarizeSemanticKeywordScanItems(collectSemanticKeywordScanItems(blocks, config, options));
}

function applySemanticKeywordRulesToBlock(
  block: LayoutBlock,
  config: LayoutSemanticRoleConfig,
  options: SemanticKeywordApplyOptions,
): { block: LayoutBlock; didUpdate: boolean } {
  if (!isSemanticKeywordTargetBlock(block)) {
    if (block.type !== 'blockquote' || block.metadata.kind !== 'blockquote') {
      return { block, didUpdate: false };
    }

    const nestedResult = applySemanticKeywordRulesToBlockList(block.metadata.blocks, config, options);
    if (!nestedResult.didUpdate) {
      return { block, didUpdate: false };
    }

    return {
      block: {
        ...block,
        sourceRange: null,
        metadata: {
          ...block.metadata,
          blocks: nestedResult.blocks,
        },
      },
      didUpdate: true,
    };
  }

  if (block.semantic && !options.overwriteExisting) {
    return { block, didUpdate: false };
  }

  const originalText = getTextContentFromRuns(block.textRuns);
  const match = findSemanticKeywordPrefixMatch(originalText, config);
  if (!match) {
    return { block, didUpdate: false };
  }

  const semanticBlock = applySemanticToBlock(
    block,
    {
      roleId: match.role.id,
      alias: match.role.name,
      source: 'keyword',
    },
    config,
  );
  const nextBlock =
    match.rule.stripKeyword && match.prefixLength > 0
      ? updateSemanticKeywordTargetTextRuns(
          semanticBlock,
          stripTextPrefixFromTextRuns(block.textRuns, block.id, match.prefixLength),
        )
      : semanticBlock;

  return {
    block: nextBlock,
    didUpdate: nextBlock !== block,
  };
}

function applySemanticKeywordRulesToBlockList(
  blocks: LayoutBlock[],
  config: LayoutSemanticRoleConfig,
  options: SemanticKeywordApplyOptions,
): { blocks: LayoutBlock[]; didUpdate: boolean } {
  let didUpdate = false;
  const nextBlocks = blocks.map((block) => {
    const result = applySemanticKeywordRulesToBlock(block, config, options);
    if (result.didUpdate) {
      didUpdate = true;
    }
    return result.block;
  });

  return { blocks: nextBlocks, didUpdate };
}

export function applySemanticKeywordRulesToBlocks(
  blocks: LayoutBlock[],
  config: LayoutSemanticRoleConfig,
  options: SemanticKeywordApplyOptions = {},
): SemanticKeywordApplyResult {
  const scanResult = scanSemanticKeywordRulesInBlocks(blocks, config, options);
  const applyResult = applySemanticKeywordRulesToBlockList(blocks, config, options);

  return {
    ...scanResult,
    blocks: applyResult.blocks,
    didUpdate: applyResult.didUpdate,
  };
}
