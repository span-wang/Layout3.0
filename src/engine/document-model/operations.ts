import type {
  BlockStyleOverrides,
  LayoutBlock,
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
} from './types';
import { createTextFragment } from './utils';

export type EditableLayoutTextBlockType = 'heading' | 'paragraph' | 'code' | 'image' | 'equation';

export interface InsertImageBlockPayload {
  src: string;
  alt: string;
  title?: string | null;
  insertAfterNodeId?: string | null;
}

export interface InsertImageBlockResult {
  blocks: LayoutBlock[];
  resources: LayoutResource[];
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
      rows: Array.from({ length: rowCount }, (_, rowIndex) =>
        createInsertedTableRow(blockId, rowIndex, columnCount),
      ),
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

function createEmptyTableCellWithId(cellId: string, isHeader: boolean): LayoutTableCell {
  return {
    id: cellId,
    sourceRange: null,
    textRuns: [],
    isHeader,
  };
}

function findTableCellPosition(
  block: LayoutBlock,
  cellId: string,
): { rowIndex: number; columnIndex: number } | null {
  if (block.type !== 'table' || block.metadata.kind !== 'table') {
    return null;
  }

  for (let rowIndex = 0; rowIndex < block.metadata.rows.length; rowIndex += 1) {
    const columnIndex = block.metadata.rows[rowIndex].cells.findIndex((cell) => cell.id === cellId);
    if (columnIndex >= 0) {
      return { rowIndex, columnIndex };
    }
  }

  return null;
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
    cells: Array.from({ length: columnCount }, (_, columnIndex) =>
      createEmptyTableCellWithId(
        createUniqueTableNodeId(existingIds, `${rowId}-cell-${columnIndex + 1}`),
        false,
      ),
    ),
  };
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

    return {
      block: {
        ...block,
        sourceRange: null,
        metadata: {
          ...block.metadata,
          align: block.metadata.align.filter((_, columnIndex) => columnIndex !== position.columnIndex),
          rows: nextRows,
        },
      },
      selectedNodeId: nextRows[position.rowIndex].cells[nextColumnIndex]?.id ?? null,
      didUpdate: true,
    };
  }

  return { block, selectedNodeId: null, didUpdate: false };
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

export function getTextContentFromRuns(textRuns: TextRun[]): string {
  return textRuns.map((run) => run.text).join('');
}

export function getLayoutBlockTextContent(block: LayoutBlock): string {
  return getTextContentFromRuns(block.textRuns);
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
  attributes: { src: string; alt: string; title: string | null },
): LayoutBlock {
  if (block.type !== 'image' || block.metadata.kind !== 'image') {
    return block;
  }

  if (
    block.metadata.src === attributes.src &&
    block.metadata.alt === attributes.alt &&
    block.metadata.title === attributes.title
  ) {
    return block;
  }

  return {
    ...block,
    sourceRange: null,
    metadata: {
      ...block.metadata,
      src: attributes.src,
      alt: attributes.alt,
      title: attributes.title,
    },
  };
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
