import { starterMarkdown, starterTitle } from '@/constants/workspace';
import {
  applyTextRunPatchToTextRuns,
  applyBlockStyleOverridesToBlock,
  applySemanticToLayoutBlock,
  autoFitTablesInLayoutDocument,
  buildBlockRangeSelection,
  convertListItemTaskStateByItem,
  updateBlockquoteStructureByNode,
  clearTextFormattingInTextRuns,
  createEmptyLayoutDocument,
  createLayoutDocumentFromMarkdown,
  createStableHash,
  deleteTopLevelBlockById,
  getLayoutBlockPlainText,
  insertEquationBlockAfterNode,
  insertImageBlockAfterNode,
  insertListBlockAfterNode,
  insertColumnBreakBlockAfterNode,
  insertPageBreakBlockAfterNode,
  insertParagraphBlockAfterNode,
  insertTableBlockAfterNode,
  insertTocBlockAfterNode,
  toggleTextMarkInTextRuns,
  reorderListItemByItem,
  updateListItemCheckedByItem,
  updateListBatchCheckedByItem,
  updateListItemLevelByItem,
  updateListOrderedByItem,
  updateListTaskModeByItem,
  updateListStartByItem,
  updateListStructureByItem,
  updateTableColumnAlignByCell,
  updateTableAutoFitSize,
  updateTableAutoFitSizeByCell,
  updateTableColumnWidthsByCell,
  updateTableHeaderRowByCell,
  updateTableRowHeightByCell,
  updateTableStructureByCell,
  mergeTableCellsByRange,
  mergeTopLevelTextBlocksByIds,
  normalizeLayoutDocumentSyntaxMappingConfig,
  normalizeSyntaxMappingConfig,
  updateLayoutBlockText as updateLayoutBlockTextModel,
  updateLayoutImageAttributes as updateLayoutImageAttributesModel,
  updateLayoutListItemText,
  updateLayoutTableCellText,
} from '@/engine/document-model';
import { mergeFontResource } from '@/engine/document-model/fontResources';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import {
  applyQuickTextStyleToStyleSheet,
  getEffectiveTableCellMaxFontSize,
  resolveEffectiveTextLineHeight,
} from '@/engine/style/quickTextStyle';
import type { StyleSettings } from '@/engine/style/types';
import type {
  BlockStyleOverrides,
  BlockquoteStructureAction,
  BlockMergeReason,
  LayoutBlock,
  LayoutDocument,
  LayoutFontResource,
  LayoutResource,
  ListBatchCheckedAction,
  ListBatchCheckedScope,
  ListIndentAction,
  ListPropertyEditResult,
  ListReorderAction,
  ListStructureAction,
  ListTaskConversionAction,
  SyntaxMappingConfig,
  TableColumnAlign,
  TablePropertyEditResult,
  TableStructureAction,
  TextRun,
  TextMarkType,
  TextRangeSelection,
  TextStyleOverrides,
} from '@/engine/document-model';
import { buildTableCellRangeSelection } from '@/engine/document-model/tableLayout';
import { loadRecentFiles } from '@/services/RecentFilesService';
import type { DocumentSlice, StoreSlice } from '@/store/types';
import { getDocumentFormatFromPath } from '@/utils/filePath';

type DocumentSliceWithStyleSettings = DocumentSlice & { styleSettings: StyleSettings };

function replaceNodeText(
  blocks: LayoutBlock[],
  nodeId: string,
  text: string,
): { blocks: LayoutBlock[]; didUpdate: boolean } {
  let didUpdate = false;

  const nextBlocks = blocks.map((block) => {
    if (block.id === nodeId) {
      const nextBlock = updateLayoutBlockTextModel(block, text);
      didUpdate = nextBlock !== block;
      return nextBlock;
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      let didUpdateListItem = false;
      const nextItems = block.metadata.items.map((item) => {
        if (item.id !== nodeId) {
          return item;
        }

        const nextItem = updateLayoutListItemText(item, text);
        didUpdateListItem = nextItem !== item;
        return nextItem;
      });

      if (didUpdateListItem) {
        didUpdate = true;
        return {
          ...block,
          sourceRange: null,
          metadata: {
            ...block.metadata,
            items: nextItems,
          },
        };
      }
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      let didUpdateTableCell = false;
      const nextRows = block.metadata.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => {
          if (cell.id !== nodeId) {
            return cell;
          }

          const nextCell = updateLayoutTableCellText(cell, text);
          didUpdateTableCell = nextCell !== cell;
          return nextCell;
        }),
      }));

      if (didUpdateTableCell) {
        didUpdate = true;
        return {
          ...block,
          sourceRange: null,
          metadata: {
            ...block.metadata,
            rows: nextRows,
          },
        };
      }
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedResult = replaceNodeText(block.metadata.blocks, nodeId, text);
      if (nestedResult.didUpdate) {
        didUpdate = true;
        return {
          ...block,
          metadata: {
            ...block.metadata,
            blocks: nestedResult.blocks,
          },
        };
      }
    }

    return block;
  });

  return { blocks: nextBlocks, didUpdate };
}

function replaceNodeRichText(
  blocks: LayoutBlock[],
  nodeId: string,
  textRuns: TextRun[],
): { blocks: LayoutBlock[]; didUpdate: boolean } {
  let didUpdate = false;
  const nextText = textRuns.map((run) => run.text).join('');

  const nextBlocks = blocks.map((block) => {
    if (block.id === nodeId) {
      if (block.type === 'heading' && block.metadata.kind === 'heading') {
        didUpdate = true;
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
        didUpdate = true;
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

      if (block.type === 'code' && block.metadata.kind === 'code') {
        didUpdate = true;
        return {
          ...block,
          sourceRange: null,
          textRuns,
          metadata: {
            ...block.metadata,
            value: nextText,
          },
        };
      }
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      let didUpdateListItem = false;
      const nextItems = block.metadata.items.map((item) => {
        if (item.id !== nodeId) {
          return item;
        }

        didUpdateListItem = true;
        return {
          ...item,
          sourceRange: null,
          textRuns,
        };
      });

      if (didUpdateListItem) {
        didUpdate = true;
        return {
          ...block,
          sourceRange: null,
          metadata: {
            ...block.metadata,
            items: nextItems,
          },
        };
      }
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      let didUpdateTableCell = false;
      const nextRows = block.metadata.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => {
          if (cell.id !== nodeId) {
            return cell;
          }

          didUpdateTableCell = true;
          return {
            ...cell,
            sourceRange: null,
            textRuns,
          };
        }),
      }));

      if (didUpdateTableCell) {
        didUpdate = true;
        return {
          ...block,
          sourceRange: null,
          metadata: {
            ...block.metadata,
            rows: nextRows,
          },
        };
      }
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedResult = replaceNodeRichText(block.metadata.blocks, nodeId, textRuns);
      if (nestedResult.didUpdate) {
        didUpdate = true;
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

  return { blocks: nextBlocks, didUpdate };
}

function replaceNodeTextRuns(
  blocks: LayoutBlock[],
  nodeId: string,
  updater: (payload: {
    textRuns: TextRun[];
    nodeId: string;
    ownerBlock: LayoutBlock;
  }) => TextRun[],
): { blocks: LayoutBlock[]; didUpdate: boolean } {
  let didUpdate = false;

  const nextBlocks = blocks.map((block) => {
    if (block.id === nodeId) {
      const nextRuns = updater({
        textRuns: block.textRuns,
        nodeId: block.id,
        ownerBlock: block,
      });
      if (nextRuns !== block.textRuns) {
        didUpdate = true;
        return {
          ...block,
          sourceRange: null,
          textRuns: nextRuns,
        };
      }
      return block;
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      let didUpdateListItem = false;
      const nextItems = block.metadata.items.map((item) => {
        if (item.id !== nodeId) {
          return item;
        }

        const nextRuns = updater({
          textRuns: item.textRuns,
          nodeId: item.id,
          ownerBlock: block,
        });
        if (nextRuns !== item.textRuns) {
          didUpdateListItem = true;
          return {
            ...item,
            sourceRange: null,
            textRuns: nextRuns,
          };
        }

        return item;
      });

      if (didUpdateListItem) {
        didUpdate = true;
        return {
          ...block,
          sourceRange: null,
          metadata: {
            ...block.metadata,
            items: nextItems,
          },
        };
      }
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      let didUpdateTableCell = false;
      const nextRows = block.metadata.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => {
          if (cell.id !== nodeId) {
            return cell;
          }

          const nextRuns = updater({
            textRuns: cell.textRuns,
            nodeId: cell.id,
            ownerBlock: block,
          });
          if (nextRuns !== cell.textRuns) {
            didUpdateTableCell = true;
            return {
              ...cell,
              sourceRange: null,
              textRuns: nextRuns,
            };
          }

          return cell;
        }),
      }));

      if (didUpdateTableCell) {
        didUpdate = true;
        return {
          ...block,
          sourceRange: null,
          metadata: {
            ...block.metadata,
            rows: nextRows,
          },
        };
      }
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedResult = replaceNodeTextRuns(block.metadata.blocks, nodeId, updater);
      if (nestedResult.didUpdate) {
        didUpdate = true;
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

  return { blocks: nextBlocks, didUpdate };
}

function replaceOwnerBlock(
  blocks: LayoutBlock[],
  nodeId: string,
  updater: (block: LayoutBlock) => LayoutBlock,
): { blocks: LayoutBlock[]; didUpdate: boolean } {
  let didUpdate = false;

  const nextBlocks = blocks.map((block) => {
    const isDirectTarget = block.id === nodeId;
    const ownsListItem =
      block.type === 'list' &&
      block.metadata.kind === 'list' &&
      block.metadata.items.some((item) => item.id === nodeId);
    const ownsTableCell =
      block.type === 'table' &&
      block.metadata.kind === 'table' &&
      block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === nodeId));

    if (isDirectTarget || ownsListItem || ownsTableCell) {
      const nextBlock = updater(block);
      if (nextBlock !== block) {
        didUpdate = true;
        return {
          ...nextBlock,
          sourceRange: null,
        };
      }

      return block;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedResult = replaceOwnerBlock(block.metadata.blocks, nodeId, updater);
      if (nestedResult.didUpdate) {
        didUpdate = true;
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

  return { blocks: nextBlocks, didUpdate };
}

function replaceListStructureByItem(
  blocks: LayoutBlock[],
  itemId: string,
  action: ListStructureAction,
): { blocks: LayoutBlock[]; didUpdate: boolean; selectedNodeId: string | null } {
  let didUpdate = false;
  let selectedNodeId: string | null = null;

  const nextBlocks = blocks.map((block) => {
    if (
      block.type === 'list' &&
      block.metadata.kind === 'list' &&
      block.metadata.items.some((item) => item.id === itemId)
    ) {
      const result = updateListStructureByItem(block, itemId, action);
      if (!result.didUpdate) {
        return block;
      }

      didUpdate = true;
      selectedNodeId = result.selectedNodeId;
      return result.block;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedResult = replaceListStructureByItem(block.metadata.blocks, itemId, action);
      if (nestedResult.didUpdate) {
        didUpdate = true;
        selectedNodeId = nestedResult.selectedNodeId;
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

  return { blocks: nextBlocks, didUpdate, selectedNodeId };
}

function replaceListPropertyByItem(
  blocks: LayoutBlock[],
  itemId: string,
  updater: (block: LayoutBlock, itemId: string) => ListPropertyEditResult,
): { blocks: LayoutBlock[]; didUpdate: boolean; selectedNodeId: string | null } {
  let didUpdate = false;
  let selectedNodeId: string | null = null;

  const nextBlocks = blocks.map((block) => {
    if (
      block.type === 'list' &&
      block.metadata.kind === 'list' &&
      block.metadata.items.some((item) => item.id === itemId)
    ) {
      const result = updater(block, itemId);
      if (!result.didUpdate) {
        return block;
      }

      didUpdate = true;
      selectedNodeId = result.selectedNodeId;
      return result.block;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedResult = replaceListPropertyByItem(block.metadata.blocks, itemId, updater);
      if (nestedResult.didUpdate) {
        didUpdate = true;
        selectedNodeId = nestedResult.selectedNodeId;
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

  return { blocks: nextBlocks, didUpdate, selectedNodeId };
}

function replaceTableStructureByCell(
  blocks: LayoutBlock[],
  cellId: string,
  action: TableStructureAction,
): { blocks: LayoutBlock[]; didUpdate: boolean; selectedNodeId: string | null } {
  let didUpdate = false;
  let selectedNodeId: string | null = null;

  const nextBlocks = blocks.map((block) => {
    if (
      block.type === 'table' &&
      block.metadata.kind === 'table' &&
      block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === cellId))
    ) {
      const result = updateTableStructureByCell(block, cellId, action);
      if (!result.didUpdate) {
        return block;
      }

      didUpdate = true;
      selectedNodeId = result.selectedNodeId;
      return result.block;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedResult = replaceTableStructureByCell(block.metadata.blocks, cellId, action);
      if (nestedResult.didUpdate) {
        didUpdate = true;
        selectedNodeId = nestedResult.selectedNodeId;
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

  return { blocks: nextBlocks, didUpdate, selectedNodeId };
}

function replaceTablePropertyByCell(
  blocks: LayoutBlock[],
  cellId: string,
  updater: (block: LayoutBlock, cellId: string) => TablePropertyEditResult,
): { blocks: LayoutBlock[]; didUpdate: boolean; selectedNodeId: string | null } {
  let didUpdate = false;
  let selectedNodeId: string | null = null;

  const nextBlocks = blocks.map((block) => {
    if (
      block.type === 'table' &&
      block.metadata.kind === 'table' &&
      block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === cellId))
    ) {
      const result = updater(block, cellId);
      if (!result.didUpdate) {
        return block;
      }

      didUpdate = true;
      selectedNodeId = result.selectedNodeId;
      return result.block;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedResult = replaceTablePropertyByCell(block.metadata.blocks, cellId, updater);
      if (nestedResult.didUpdate) {
        didUpdate = true;
        selectedNodeId = nestedResult.selectedNodeId;
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

  return { blocks: nextBlocks, didUpdate, selectedNodeId };
}

function findTableBlockByCellId(blocks: LayoutBlock[], cellId: string): LayoutBlock | null {
  for (const block of blocks) {
    if (
      block.type === 'table' &&
      block.metadata.kind === 'table' &&
      block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === cellId))
    ) {
      return block;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedBlock = findTableBlockByCellId(block.metadata.blocks, cellId);
      if (nestedBlock) {
        return nestedBlock;
      }
    }
  }

  return null;
}

function findTableBlockById(blocks: LayoutBlock[], tableBlockId: string): LayoutBlock | null {
  for (const block of blocks) {
    if (block.id === tableBlockId && block.type === 'table' && block.metadata.kind === 'table') {
      return block;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedBlock = findTableBlockById(block.metadata.blocks, tableBlockId);
      if (nestedBlock) {
        return nestedBlock;
      }
    }
  }

  return null;
}

function replaceTableBlockById(
  blocks: LayoutBlock[],
  tableBlockId: string,
  nextTableBlock: LayoutBlock,
): { blocks: LayoutBlock[]; didUpdate: boolean } {
  let didUpdate = false;

  const nextBlocks = blocks.map((block) => {
    if (block.id === tableBlockId) {
      didUpdate = true;
      return nextTableBlock;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedResult = replaceTableBlockById(block.metadata.blocks, tableBlockId, nextTableBlock);
      if (nestedResult.didUpdate) {
        didUpdate = true;
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

  return { blocks: nextBlocks, didUpdate };
}

function createTableAutoFitOptions(state: DocumentSliceWithStyleSettings) {
  if (!state.layoutDocument) {
    return null;
  }

  const contract = resolveStyleContract(state.styleSettings);
  const tableStyle = contract.blockStyles.table;
  const baseFontSizePx = contract.blockStyles.paragraph.fontSize;
  const baseLineHeightPx = contract.blockStyles.paragraph.lineHeight;

  return {
    // 分栏页面中表格按单栏正文区排版，默认自适应也使用同一口径，避免新尺寸撑出当前栏。
    contentWidthPx: contract.singleColumnContentWidthPx,
    rowHeightPx: tableStyle.rowHeight,
    headerRowHeightPx: tableStyle.headerRowHeight,
    cellPaddingX: tableStyle.cellPaddingX,
    cellPaddingY: tableStyle.cellPaddingY,
    baseFontSizePx,
    baseLineHeightPx,
  };
}

function autoFitTableBlockForDefaultSize(
  state: DocumentSliceWithStyleSettings,
  block: LayoutBlock,
  selectedNodeId: string,
): LayoutBlock {
  const options = createTableAutoFitOptions(state);
  if (!options) {
    return block;
  }

  const result = updateTableAutoFitSize(block, selectedNodeId, {
    contentWidthPx: options.contentWidthPx,
    rowHeightPx: options.rowHeightPx,
    headerRowHeightPx: options.headerRowHeightPx,
    cellPaddingX: options.cellPaddingX,
    cellPaddingY: options.cellPaddingY,
    getCellMetrics: ({ cell }) => {
      const fontSizePx = getEffectiveTableCellMaxFontSize({
        cell,
        block,
        styles: state.layoutDocument?.styles,
        fallback: options.baseFontSizePx,
      });

      return {
        fontSizePx,
        // 默认自适应挂在真实写回节点上，让字号变化后的行高也能同步更新。
        lineHeightPx: resolveEffectiveTextLineHeight({
          fontSize: fontSizePx,
          baseFontSize: options.baseFontSizePx,
          baseLineHeight: block.blockStyleOverrides.lineHeight ?? options.baseLineHeightPx,
        }),
      };
    },
  });

  return result.didUpdate ? result.block : block;
}

function autoFitTableBlocksByEditedNode(
  state: DocumentSliceWithStyleSettings,
  blocks: LayoutBlock[],
  nodeId: string,
): { blocks: LayoutBlock[]; didUpdate: boolean } {
  let didUpdate = false;

  const nextBlocks = blocks.map((block) => {
    if (
      block.type === 'table' &&
      block.metadata.kind === 'table' &&
      block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === nodeId))
    ) {
      const nextBlock = autoFitTableBlockForDefaultSize(state, block, nodeId);
      if (nextBlock !== block) {
        didUpdate = true;
      }
      return nextBlock;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedResult = autoFitTableBlocksByEditedNode(state, block.metadata.blocks, nodeId);
      if (nestedResult.didUpdate) {
        didUpdate = true;
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

  return { blocks: nextBlocks, didUpdate };
}

function replaceBlockquoteStructureByNode(
  blocks: LayoutBlock[],
  blockquoteId: string,
  targetNodeId: string,
  action: BlockquoteStructureAction,
): { blocks: LayoutBlock[]; didUpdate: boolean; selectedNodeId: string | null } {
  let didUpdate = false;
  let selectedNodeId: string | null = null;

  const nextBlocks = blocks.map((block) => {
    if (block.id === blockquoteId && block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const result = updateBlockquoteStructureByNode(block, targetNodeId, action);
      if (!result.didUpdate) {
        return block;
      }

      didUpdate = true;
      selectedNodeId = result.selectedNodeId;
      return result.block;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedResult = replaceBlockquoteStructureByNode(block.metadata.blocks, blockquoteId, targetNodeId, action);
      if (nestedResult.didUpdate) {
        didUpdate = true;
        selectedNodeId = nestedResult.selectedNodeId;
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

  return { blocks: nextBlocks, didUpdate, selectedNodeId };
}

function findDirectInsertIndexForNodeId(blocks: LayoutBlock[], nodeId: string | null | undefined): number {
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

function collectBlockIds(blocks: LayoutBlock[], ids = new Set<string>()): Set<string> {
  for (const block of blocks) {
    ids.add(block.id);

    block.textRuns.forEach((run) => ids.add(run.id));

    if (block.type === 'list' && block.metadata.kind === 'list') {
      block.metadata.items.forEach((item) => {
        ids.add(item.id);
        item.textRuns.forEach((run) => ids.add(run.id));
      });
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      block.metadata.rows.forEach((row) => {
        ids.add(row.id);
        row.cells.forEach((cell) => {
          ids.add(cell.id);
          cell.textRuns.forEach((run) => ids.add(run.id));
        });
      });
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      collectBlockIds(block.metadata.blocks, ids);
    }
  }

  return ids;
}

function createUniqueInsertedId(originalId: string, prefix: string, usedIds: Set<string>): string {
  let candidate = `${prefix}-${originalId}`;
  let index = 2;

  while (usedIds.has(candidate)) {
    candidate = `${prefix}-${index}-${originalId}`;
    index += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function remapTextRunsForInsertedMarkdown(
  textRuns: TextRun[],
  prefix: string,
  usedIds: Set<string>,
): TextRun[] {
  return textRuns.map((run) => ({
    ...run,
    id: createUniqueInsertedId(run.id, prefix, usedIds),
    // AI 插入片段来自临时 Markdown，不再保留相对源码范围，避免误导后续编辑定位。
    sourceRange: null,
  }));
}

function remapInsertedMarkdownBlock(
  block: LayoutBlock,
  prefix: string,
  usedIds: Set<string>,
  idMap: Map<string, string>,
): LayoutBlock {
  const nextBlockId = createUniqueInsertedId(block.id, prefix, usedIds);
  idMap.set(block.id, nextBlockId);
  const nextTextRuns = remapTextRunsForInsertedMarkdown(block.textRuns, prefix, usedIds);

  if (block.type === 'list' && block.metadata.kind === 'list') {
    return {
      ...block,
      id: nextBlockId,
      sourceRange: null,
      textRuns: nextTextRuns,
      metadata: {
        ...block.metadata,
        items: block.metadata.items.map((item) => {
          const nextItemId = createUniqueInsertedId(item.id, prefix, usedIds);
          idMap.set(item.id, nextItemId);

          return {
            ...item,
            id: nextItemId,
            sourceRange: null,
            textRuns: remapTextRunsForInsertedMarkdown(item.textRuns, prefix, usedIds),
          };
        }),
      },
    };
  }

  if (block.type === 'table' && block.metadata.kind === 'table') {
    const nextRows = block.metadata.rows.map((row) => {
      const nextRowId = createUniqueInsertedId(row.id, prefix, usedIds);
      idMap.set(row.id, nextRowId);

      return {
        ...row,
        id: nextRowId,
        sourceRange: null,
        cells: row.cells.map((cell) => {
          const nextCellId = createUniqueInsertedId(cell.id, prefix, usedIds);
          idMap.set(cell.id, nextCellId);

          return {
            ...cell,
            id: nextCellId,
            sourceRange: null,
            textRuns: remapTextRunsForInsertedMarkdown(cell.textRuns, prefix, usedIds),
          };
        }),
      };
    });

    return {
      ...block,
      id: nextBlockId,
      sourceRange: null,
      textRuns: nextTextRuns,
      metadata: {
        ...block.metadata,
        rows: nextRows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            coveredByCellId: cell.coveredByCellId
              ? idMap.get(cell.coveredByCellId) ?? cell.coveredByCellId
              : cell.coveredByCellId,
          })),
        })),
      },
    };
  }

  if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
    return {
      ...block,
      id: nextBlockId,
      sourceRange: null,
      textRuns: nextTextRuns,
      metadata: {
        ...block.metadata,
        blocks: block.metadata.blocks.map((nestedBlock) =>
          remapInsertedMarkdownBlock(nestedBlock, prefix, usedIds, idMap),
        ),
      },
    };
  }

  return {
    ...block,
    id: nextBlockId,
    sourceRange: null,
    textRuns: nextTextRuns,
  };
}

function remapInsertedMarkdownResources(
  resources: LayoutResource[],
  prefix: string,
  usedIds: Set<string>,
  idMap: Map<string, string>,
): LayoutResource[] {
  return resources.map((resource) => {
    const nextResourceId = createUniqueInsertedId(resource.id, prefix, usedIds);

    if (resource.type === 'image') {
      return {
        ...resource,
        id: nextResourceId,
        blockId: idMap.get(resource.blockId) ?? resource.blockId,
      };
    }

    return {
      ...resource,
      id: nextResourceId,
    };
  });
}

function remapInsertedMarkdownFragment(
  blocks: LayoutBlock[],
  resources: LayoutResource[],
  existingBlocks: LayoutBlock[],
  existingResources: LayoutResource[],
  markdown: string,
): { blocks: LayoutBlock[]; resources: LayoutResource[] } {
  const prefix = `ai-${createStableHash(`${Date.now()}-${markdown}`).slice(0, 8)}`;
  const usedIds = collectBlockIds(existingBlocks);
  existingResources.forEach((resource) => usedIds.add(resource.id));
  const idMap = new Map<string, string>();
  const nextBlocks = blocks.map((block) => remapInsertedMarkdownBlock(block, prefix, usedIds, idMap));
  const nextResources = remapInsertedMarkdownResources(resources, prefix, usedIds, idMap);

  return {
    blocks: nextBlocks,
    resources: nextResources,
  };
}

function getFirstHeadingTitle(blocks: LayoutBlock[]): string | null {
  for (const block of blocks) {
    if (block.type === 'heading' && block.metadata.kind === 'heading') {
      return block.metadata.text || null;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedTitle = getFirstHeadingTitle(block.metadata.blocks);
      if (nestedTitle) {
        return nestedTitle;
      }
    }
  }

  return null;
}

function countWords(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}]+/gu);
  return matches ? matches.length : 0;
}

function countCharacters(text: string): number {
  return text.replace(/\s+/gu, '').length;
}

function buildDocumentText(blocks: LayoutBlock[]): string {
  return blocks
    .map((block) => getLayoutBlockPlainText(block).trim())
    .filter(Boolean)
    .join('\n');
}

interface ImageResourceSnapshot {
  src: string;
  alt: string;
  title: string | null;
}

function getImageResourceSnapshotForNodeId(
  blocks: LayoutBlock[],
  nodeId: string,
): ImageResourceSnapshot | null {
  for (const block of blocks) {
    if (block.id === nodeId) {
      return block.type === 'image' && block.metadata.kind === 'image'
        ? {
            src: block.metadata.src,
            alt: block.metadata.alt,
            title: block.metadata.title,
          }
        : null;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedSnapshot = getImageResourceSnapshotForNodeId(block.metadata.blocks, nodeId);
      if (nestedSnapshot !== null) {
        return nestedSnapshot;
      }
    }
  }

  return null;
}

function syncImageResource(
  resources: LayoutResource[],
  nodeId: string,
  snapshot: ImageResourceSnapshot,
): LayoutResource[] {
  let hasMatchedResource = false;
  const nextResources = resources.map((resource) => {
    if (resource.type !== 'image' || resource.blockId !== nodeId) {
      return resource;
    }

    hasMatchedResource = true;
    return {
      ...resource,
      src: snapshot.src,
      alt: snapshot.alt,
      title: snapshot.title,
    };
  });

  if (hasMatchedResource) {
    return nextResources;
  }

  // 兼容旧草稿或手工修改过的 .layout：图片块存在但资源条目缺失时，补一个最小资源记录。
  return [
    ...nextResources,
    {
      id: `resource-${nodeId}`,
      type: 'image',
      src: snapshot.src,
      alt: snapshot.alt,
      title: snapshot.title,
      blockId: nodeId,
    },
  ];
}

function removeImageResourcesByBlockId(
  resources: LayoutResource[],
  blockId: string,
): LayoutResource[] {
  return resources.filter((resource) => resource.type !== 'image' || resource.blockId !== blockId);
}

const documentHistoryLimit = 50;

function cloneLayoutDocumentSnapshot(document: LayoutDocument): LayoutDocument {
  // LayoutDocument 目前是纯 JSON 结构，用 JSON 克隆可以避免历史快照被后续 immer 修改串联污染。
  return JSON.parse(JSON.stringify(document)) as LayoutDocument;
}

function pushDocumentHistory(state: DocumentSlice): void {
  if (!state.layoutDocument) {
    return;
  }

  state.documentHistoryPast.push(cloneLayoutDocumentSnapshot(state.layoutDocument));
  if (state.documentHistoryPast.length > documentHistoryLimit) {
    state.documentHistoryPast.shift();
  }
  // 新操作发生后，旧的重做链路不再成立。
  state.documentHistoryFuture = [];
}

function restoreLayoutDocumentSnapshot(state: DocumentSlice, document: LayoutDocument): void {
  state.layoutDocument = normalizeLayoutDocumentSyntaxMappingConfig(cloneLayoutDocumentSnapshot(document));
  state.title = state.layoutDocument.title;
  state.source = state.layoutDocument.source;
  state.parseState = 'ready';
  state.parseError = null;
  state.pageLayouts = [];
  state.isDirty = true;
}

function refreshDocumentMeta(state: DocumentSlice, blocks: LayoutBlock[]): void {
  const text = buildDocumentText(blocks);
  state.layoutDocument!.meta.wordCount = countWords(text);
  state.layoutDocument!.meta.characterCount = countCharacters(text);
  state.layoutDocument!.meta.blockCount = blocks.length;
  state.layoutDocument!.meta.updatedAt = new Date().toISOString();
}

function applyDocumentMutation(
  state: DocumentSliceWithStyleSettings,
  nodeId: string,
  result: { blocks: LayoutBlock[]; didUpdate: boolean },
): void {
  if (!state.layoutDocument || !result.didUpdate) {
    return;
  }

  const autoFitResult = autoFitTableBlocksByEditedNode(state, result.blocks, nodeId);
  const nextBlocks = autoFitResult.didUpdate ? autoFitResult.blocks : result.blocks;

  pushDocumentHistory(state);
  state.layoutDocument.blocks = nextBlocks;
  const imageResourceSnapshot = getImageResourceSnapshotForNodeId(nextBlocks, nodeId);
  if (imageResourceSnapshot !== null) {
    state.layoutDocument.resources = syncImageResource(
      state.layoutDocument.resources,
      nodeId,
      imageResourceSnapshot,
    );
  }
  state.layoutDocument.title = getFirstHeadingTitle(nextBlocks) ?? state.layoutDocument.title;
  refreshDocumentMeta(state, nextBlocks);
  state.layoutDocument.viewState.selectedNodeId = nodeId;
  state.layoutDocument.viewState.tableSelection = null;
  state.layoutDocument.viewState.blockSelection = null;
  state.isDirty = true;
  state.parseState = 'ready';
  state.parseError = null;
}

const initialLayoutDocument = createEmptyLayoutDocument({ title: starterTitle, source: starterMarkdown });

export const createDocumentSlice: StoreSlice<DocumentSlice> = (set, get) => ({
  documentEpoch: 0,
  title: starterTitle,
  filePath: null,
  workspaceRootPath: null,
  currentDirectoryPath: null,
  directoryEntries: [],
  recentlyOpenedFiles: loadRecentFiles(),
  isDirty: false,
  documentFormat: 'layout',
  source: starterMarkdown,
  parseState: 'ready',
  layoutDocument: initialLayoutDocument,
  documentHistoryPast: [],
  documentHistoryFuture: [],
  parseError: null,
  pageLayouts: [],
  resetDocument: () =>
    set((state) => {
      state.documentEpoch += 1;
      state.title = starterTitle;
      state.filePath = null;
      state.workspaceRootPath = null;
      state.currentDirectoryPath = null;
      state.directoryEntries = [];
      state.isDirty = false;
      state.documentFormat = 'layout';
      state.source = starterMarkdown;
      state.parseState = 'ready';
      state.layoutDocument = createEmptyLayoutDocument({ title: starterTitle, source: starterMarkdown });
      state.documentHistoryPast = [];
      state.documentHistoryFuture = [];
      state.parseError = null;
      state.pageLayouts = [];
    }),
  loadDocument: ({ title, filePath, source, documentFormat, layoutDocument }) =>
    set((state) => {
      state.documentEpoch += 1;
      state.title = title;
      state.filePath = filePath;
      state.isDirty = false;
      state.documentFormat = documentFormat;
      state.source = source;
      state.parseState = 'ready';
      state.layoutDocument = normalizeLayoutDocumentSyntaxMappingConfig(layoutDocument);
      state.documentHistoryPast = [];
      state.documentHistoryFuture = [];
      state.parseError = null;
      state.pageLayouts = [];
    }),
  restoreDraft: ({ title, source, filePath, documentFormat, layoutDocument }) =>
    set((state) => {
      state.documentEpoch += 1;
      state.title = title;
      state.filePath = filePath ?? null;
      state.isDirty = true;
      state.documentFormat = documentFormat ?? getDocumentFormatFromPath(filePath ?? null);
      state.source = source;
      state.parseState = 'ready';
      state.layoutDocument = normalizeLayoutDocumentSyntaxMappingConfig(layoutDocument);
      state.documentHistoryPast = [];
      state.documentHistoryFuture = [];
      state.parseError = null;
      state.pageLayouts = [];
    }),
  markDocumentSaved: ({ title, filePath }) =>
    set((state) => {
      state.title = title;
      state.filePath = filePath;
      state.documentFormat = getDocumentFormatFromPath(filePath);
      state.isDirty = false;
    }),
  updateDocumentLocation: ({ title, filePath }) =>
    set((state) => {
      state.documentEpoch += 1;
      state.title = title;
      state.filePath = filePath;
      state.documentFormat = getDocumentFormatFromPath(filePath);
    }),
  detachDocumentFile: () =>
    set((state) => {
      state.filePath = null;
      state.isDirty = true;
    }),
  setCurrentDirectory: ({ directoryPath, directoryEntries, workspaceRootPath }) =>
    set((state) => {
      if (workspaceRootPath !== undefined) {
        state.workspaceRootPath = workspaceRootPath;
      } else if (!state.workspaceRootPath) {
        state.workspaceRootPath = directoryPath;
      }
      state.currentDirectoryPath = directoryPath;
      state.directoryEntries = directoryEntries;
    }),
  setRecentlyOpenedFiles: (files) =>
    set((state) => {
      state.recentlyOpenedFiles = files;
    }),
  setSource: (nextSource) =>
    set((state) => {
      state.source = nextSource;
    }),
  setParseState: (nextState) =>
    set((state) => {
      state.parseState = nextState;
      if (nextState !== 'error') {
        state.parseError = null;
      }
    }),
  setLayoutDocument: (document) =>
    set((state) => {
      state.parseState = 'ready';
      state.layoutDocument = normalizeLayoutDocumentSyntaxMappingConfig(document);
      state.documentHistoryPast = [];
      state.documentHistoryFuture = [];
      state.parseError = null;
    }),
  updateSyntaxMappingConfig: (config: SyntaxMappingConfig) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      pushDocumentHistory(state);
      // 语法映射配置属于文档级设置，写入 meta 后会随 .layout 文件一起保存。
      state.layoutDocument.meta.syntaxMappingConfig = normalizeSyntaxMappingConfig(config);
      refreshDocumentMeta(state, state.layoutDocument.blocks);
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    }),
  appendLayoutParagraphBlock: ({ text }) => {
    let insertedBlockId: string | null = null;

    set((state) => {
      if (!state.layoutDocument || !text.trim()) {
        return;
      }

      const result = insertParagraphBlockAfterNode(state.layoutDocument.blocks, {
        insertAfterNodeId: null,
        text,
      });

      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.insertedBlockId;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
      insertedBlockId = result.insertedBlockId;
    });

    return insertedBlockId;
  },
  insertLayoutMarkdownBlocks: async ({ markdown, insertAfterNodeId }) => {
    const normalizedMarkdown = markdown.trim();
    if (!normalizedMarkdown) {
      return null;
    }

    const syntaxMappingConfig = get().layoutDocument?.meta.syntaxMappingConfig;
    const parsedDocument = await createLayoutDocumentFromMarkdown(normalizedMarkdown, syntaxMappingConfig);
    if (parsedDocument.blocks.length === 0) {
      return null;
    }

    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const insertTargetNodeId =
        insertAfterNodeId !== undefined
          ? insertAfterNodeId
          : state.layoutDocument.viewState.selectedNodeId;
      const autoFitParsedDocument = autoFitTablesInLayoutDocument(parsedDocument, state.styleSettings, {
        preserveSavedSize: true,
      }).document;
      const remappedFragment = remapInsertedMarkdownFragment(
        autoFitParsedDocument.blocks,
        autoFitParsedDocument.resources,
        state.layoutDocument.blocks,
        state.layoutDocument.resources,
        normalizedMarkdown,
      );

      if (remappedFragment.blocks.length === 0) {
        return;
      }

      const insertAfterIndex = findDirectInsertIndexForNodeId(
        state.layoutDocument.blocks,
        insertTargetNodeId,
      );
      const insertIndex =
        insertAfterIndex >= 0 ? insertAfterIndex + 1 : state.layoutDocument.blocks.length;
      const nextBlocks = [
        ...state.layoutDocument.blocks.slice(0, insertIndex),
        ...remappedFragment.blocks,
        ...state.layoutDocument.blocks.slice(insertIndex),
      ];

      selectedNodeId = remappedFragment.blocks[0]?.id ?? null;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = nextBlocks;
      state.layoutDocument.resources = [
        ...state.layoutDocument.resources,
        ...remappedFragment.resources,
      ];
      state.layoutDocument.title = getFirstHeadingTitle(nextBlocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, nextBlocks);
      state.layoutDocument.viewState.selectedNodeId = selectedNodeId;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  setParseError: (message) =>
    set((state) => {
      state.parseState = 'error';
      state.layoutDocument = null;
      state.parseError = message;
      state.pageLayouts = [];
    }),
  setPageLayouts: (pages) =>
    set((state) => {
      state.pageLayouts = pages;
    }),
  selectLayoutNode: (nodeId) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      state.layoutDocument.viewState.selectedNodeId = nodeId;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection = null;
    }),
  selectLayoutBlock: ({ blockId, extendRange }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const currentBlockSelection = state.layoutDocument.viewState.blockSelection ?? null;
      const anchorBlockId = extendRange
        ? currentBlockSelection?.anchorBlockId ?? state.layoutDocument.viewState.selectedNodeId ?? blockId
        : blockId;
      const nextBlockSelection = extendRange
        ? buildBlockRangeSelection(state.layoutDocument.blocks, anchorBlockId, blockId)
        : null;

      state.layoutDocument.viewState.selectedNodeId = blockId;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection =
        nextBlockSelection && nextBlockSelection.blockIds.length > 1 ? nextBlockSelection : null;
    }),
  selectLayoutTableCell: ({ cellId, extendRange }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const tableBlock = findTableBlockByCellId(state.layoutDocument.blocks, cellId);
      if (!tableBlock) {
        state.layoutDocument.viewState.selectedNodeId = cellId;
        state.layoutDocument.viewState.tableSelection = null;
        state.layoutDocument.viewState.blockSelection = null;
        return;
      }

      const currentSelection = state.layoutDocument.viewState.tableSelection ?? null;
      const anchorCellId =
        extendRange && currentSelection?.tableBlockId === tableBlock.id
          ? currentSelection.anchorCellId
          : cellId;
      const nextSelection = buildTableCellRangeSelection(tableBlock, anchorCellId, cellId);

      state.layoutDocument.viewState.selectedNodeId = cellId;
      state.layoutDocument.viewState.tableSelection = nextSelection;
      state.layoutDocument.viewState.blockSelection = null;
    }),
  clearLayoutSelection: () =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      state.layoutDocument.viewState.selectedNodeId = null;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection = null;
    }),
  undoLayoutDocument: () => {
    let didUndo = false;

    set((state) => {
      if (!state.layoutDocument || state.documentHistoryPast.length === 0) {
        return;
      }

      const previousDocument = state.documentHistoryPast.pop();
      if (!previousDocument) {
        return;
      }

      state.documentHistoryFuture.push(cloneLayoutDocumentSnapshot(state.layoutDocument));
      restoreLayoutDocumentSnapshot(state, previousDocument);
      didUndo = true;
    });

    return didUndo;
  },
  redoLayoutDocument: () => {
    let didRedo = false;

    set((state) => {
      if (!state.layoutDocument || state.documentHistoryFuture.length === 0) {
        return;
      }

      const nextDocument = state.documentHistoryFuture.pop();
      if (!nextDocument) {
        return;
      }

      state.documentHistoryPast.push(cloneLayoutDocumentSnapshot(state.layoutDocument));
      restoreLayoutDocumentSnapshot(state, nextDocument);
      didRedo = true;
    });

    return didRedo;
  },
  updateLayoutNodeText: ({ nodeId, text }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceNodeText(state.layoutDocument.blocks, nodeId, text);
      applyDocumentMutation(state, nodeId, result);
    }),
  replaceLayoutNodeRichText: ({ nodeId, textRuns }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceNodeRichText(state.layoutDocument.blocks, nodeId, textRuns);
      applyDocumentMutation(state, nodeId, result);
    }),
  toggleLayoutNodeTextMark: ({ nodeId, selection, markType }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceNodeTextRuns(state.layoutDocument.blocks, nodeId, ({ textRuns }) =>
        toggleTextMarkInTextRuns(textRuns, nodeId, selection, markType),
      );
      applyDocumentMutation(state, nodeId, result);
    }),
  applyLayoutNodeTextStyle: ({ nodeId, selection, styleOverrides }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceNodeTextRuns(state.layoutDocument.blocks, nodeId, ({ textRuns }) =>
        applyTextRunPatchToTextRuns(textRuns, nodeId, selection, {
          styleOverrides,
        }),
      );
      applyDocumentMutation(state, nodeId, result);
    }),
  clearLayoutNodeTextFormatting: ({ nodeId, selection }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceNodeTextRuns(state.layoutDocument.blocks, nodeId, ({ textRuns }) =>
        clearTextFormattingInTextRuns(textRuns, nodeId, selection),
      );
      applyDocumentMutation(state, nodeId, result);
    }),
  importLayoutFontResource: (fontResource: LayoutFontResource) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      // 字体导入只改变文档资源，不改正文块；仍然进入历史栈，便于用户撤销刚导入的字体。
      pushDocumentHistory(state);
      state.layoutDocument.resources = mergeFontResource(state.layoutDocument.resources, fontResource);
      state.layoutDocument.meta.updatedAt = new Date().toISOString();
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    }),
  insertLayoutImageBlock: ({
    src,
    alt,
    title,
    widthPx,
    heightPx,
    lockAspectRatio,
    objectFit,
    cropTopPx,
    cropRightPx,
    cropBottomPx,
    cropLeftPx,
    wrapMode,
    wrapSide,
    insertAfterNodeId,
  }) => {
    let insertedBlockId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = insertImageBlockAfterNode(
        state.layoutDocument.blocks,
        state.layoutDocument.resources,
        {
          src,
          alt,
          title,
          widthPx,
          heightPx,
          lockAspectRatio,
          objectFit,
          cropTopPx,
          cropRightPx,
          cropBottomPx,
          cropLeftPx,
          wrapMode,
          wrapSide,
          insertAfterNodeId,
        },
      );

      insertedBlockId = result.insertedBlockId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.resources = result.resources;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.insertedBlockId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return insertedBlockId;
  },
  insertLayoutTableBlock: ({ rowCount, columnCount, insertAfterNodeId }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = insertTableBlockAfterNode(state.layoutDocument.blocks, {
        rowCount,
        columnCount,
        insertAfterNodeId,
      });
      const insertedTableBlock = result.blocks.find((block) => block.id === result.insertedBlockId);
      const nextTableBlock =
        insertedTableBlock && insertedTableBlock.type === 'table' && insertedTableBlock.metadata.kind === 'table'
          ? autoFitTableBlockForDefaultSize(state, insertedTableBlock, result.selectedNodeId ?? result.insertedBlockId)
          : insertedTableBlock;
      const nextBlocks =
        nextTableBlock && nextTableBlock !== insertedTableBlock
          ? result.blocks.map((block) => (block.id === result.insertedBlockId ? nextTableBlock : block))
          : result.blocks;

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = nextBlocks;
      state.layoutDocument.title = getFirstHeadingTitle(nextBlocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, nextBlocks);
      // 默认选中新表格的第一个单元格，让用户插入后能顺手进入单元格编辑。
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  insertLayoutEquationBlock: ({ value, insertAfterNodeId }) => {
    let insertedBlockId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = insertEquationBlockAfterNode(state.layoutDocument.blocks, {
        value,
        insertAfterNodeId,
      });

      insertedBlockId = result.insertedBlockId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      // 默认选中新公式块，方便用户直接进入公式编辑。
      state.layoutDocument.viewState.selectedNodeId = result.insertedBlockId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return insertedBlockId;
  },
  insertLayoutListBlock: ({ kind, insertAfterNodeId }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = insertListBlockAfterNode(state.layoutDocument.blocks, {
        kind,
        insertAfterNodeId,
      });

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      // 默认选中新列表的第一个列表项，让用户插入后能直接进入列表项编辑。
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  insertLayoutParagraphBlock: ({ insertAfterNodeId }) => {
    let insertedBlockId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = insertParagraphBlockAfterNode(state.layoutDocument.blocks, {
        insertAfterNodeId,
      });

      insertedBlockId = result.insertedBlockId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      // 新空文本块插入后直接选中，方便上层立即请求进入原位编辑。
      state.layoutDocument.viewState.selectedNodeId = result.insertedBlockId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return insertedBlockId;
  },
  insertLayoutPageBreakBlock: ({ insertAfterNodeId }) => {
    let insertedBlockId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = insertPageBreakBlockAfterNode(state.layoutDocument.blocks, {
        insertAfterNodeId,
      });

      insertedBlockId = result.insertedBlockId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      // 分页符不进入编辑态，但插入后仍保持选中，方便用户确认位置。
      state.layoutDocument.viewState.selectedNodeId = result.insertedBlockId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return insertedBlockId;
  },
  insertLayoutColumnBreakBlock: ({ insertAfterNodeId }) => {
    let insertedBlockId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = insertColumnBreakBlockAfterNode(state.layoutDocument.blocks, {
        insertAfterNodeId,
      });

      insertedBlockId = result.insertedBlockId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      // 分栏断点和分页符一样不进入编辑态，但插入后保持选中，方便用户确认位置。
      state.layoutDocument.viewState.selectedNodeId = result.insertedBlockId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return insertedBlockId;
  },
  insertLayoutTocBlock: ({ insertAfterNodeId }) => {
    let insertedBlockId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = insertTocBlockAfterNode(state.layoutDocument.blocks, {
        insertAfterNodeId,
      });

      insertedBlockId = result.insertedBlockId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.insertedBlockId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return insertedBlockId;
  },
  deleteLayoutTopLevelBlock: ({ nodeId }) => {
    let didDelete = false;
    let selectedNodeId: string | null = null;
    let deletedBlockType: LayoutBlock['type'] | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const blockIndex = state.layoutDocument.blocks.findIndex((block) => {
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

      if (blockIndex < 0) {
        return;
      }

      const targetBlock = state.layoutDocument.blocks[blockIndex];
      const result = deleteTopLevelBlockById(state.layoutDocument.blocks, targetBlock.id);
      if (!result.didUpdate) {
        return;
      }

      didDelete = true;
      selectedNodeId = result.selectedNodeId;
      deletedBlockType = targetBlock.type;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      if (targetBlock.type === 'image') {
        state.layoutDocument.resources = removeImageResourcesByBlockId(
          state.layoutDocument.resources,
          targetBlock.id,
        );
      }
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return {
      didDelete,
      selectedNodeId,
      deletedBlockType,
    };
  },
  updateLayoutTocMaxDepth: ({ nodeId, maxDepth }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceOwnerBlock(state.layoutDocument.blocks, nodeId, (block) => {
        if (block.type !== 'toc' || block.metadata.kind !== 'toc' || block.metadata.maxDepth === maxDepth) {
          return block;
        }

        return {
          ...block,
          sourceRange: null,
          metadata: {
            ...block.metadata,
            maxDepth,
          },
        };
      });
      applyDocumentMutation(state, nodeId, result);
    }),
  refreshLayoutTocBlock: ({ nodeId }) => {
    let didRefresh = false;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceOwnerBlock(state.layoutDocument.blocks, nodeId, (block) => {
        if (block.type !== 'toc' || block.metadata.kind !== 'toc') {
          return block;
        }

        return {
          ...block,
          metadata: {
            ...block.metadata,
          },
        };
      });

      if (!result.didUpdate) {
        return;
      }

      didRefresh = true;
      state.documentEpoch += 1;
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.viewState.selectedNodeId = nodeId;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return didRefresh;
  },
  updateLayoutTableStructure: ({ cellId, action }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceTableStructureByCell(state.layoutDocument.blocks, cellId, action);
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      const autoFitResult = autoFitTableBlocksByEditedNode(state, result.blocks, result.selectedNodeId);
      const nextBlocks = autoFitResult.didUpdate ? autoFitResult.blocks : result.blocks;

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = nextBlocks;
      state.layoutDocument.title = getFirstHeadingTitle(nextBlocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, nextBlocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutTableHeaderRow: ({ cellId, enabled }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceTablePropertyByCell(state.layoutDocument.blocks, cellId, (block, targetCellId) =>
        updateTableHeaderRowByCell(block, targetCellId, enabled),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutTableColumnAlign: ({ cellId, align }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceTablePropertyByCell(state.layoutDocument.blocks, cellId, (block, targetCellId) =>
        updateTableColumnAlignByCell(block, targetCellId, align),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  autoFitLayoutTableSize: ({
    cellId,
    contentWidthPx,
    rowHeightPx,
    headerRowHeightPx,
    cellPaddingX,
    cellPaddingY,
    baseFontSizePx,
    baseLineHeightPx,
  }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceTablePropertyByCell(state.layoutDocument.blocks, cellId, (block, targetCellId) =>
        updateTableAutoFitSizeByCell(block, targetCellId, {
          contentWidthPx,
          rowHeightPx,
          headerRowHeightPx,
          cellPaddingX,
          cellPaddingY,
          getCellMetrics: ({ cell }) => {
            const fontSizePx = getEffectiveTableCellMaxFontSize({
              cell,
              block,
              styles: state.layoutDocument?.styles,
              fallback: baseFontSizePx,
            });

            return {
              fontSizePx,
              // 行高跟随字体字号安全口径，避免自动适应后大字仍被行盒挤住。
              lineHeightPx: resolveEffectiveTextLineHeight({
                fontSize: fontSizePx,
                baseFontSize: baseFontSizePx,
                baseLineHeight: block.blockStyleOverrides.lineHeight ?? baseLineHeightPx,
              }),
            };
          },
        }),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutTableColumnWidths: ({ cellId, columnWidthsPx }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceTablePropertyByCell(state.layoutDocument.blocks, cellId, (block, targetCellId) =>
        updateTableColumnWidthsByCell(block, targetCellId, columnWidthsPx),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutTableRowHeight: ({ cellId, heightPx }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceTablePropertyByCell(state.layoutDocument.blocks, cellId, (block, targetCellId) =>
        updateTableRowHeightByCell(block, targetCellId, heightPx),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  mergeLayoutSelectedTableCells: () => {
    let selectedNodeId: string | null = null;
    let didUpdate = false;
    let reason: 'merged' | 'invalidSelection' | 'singleCell' | 'containsMergedCell' = 'invalidSelection';

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const selection = state.layoutDocument.viewState.tableSelection;
      if (!selection) {
        reason = 'invalidSelection';
        return;
      }

      const tableBlock = findTableBlockById(state.layoutDocument.blocks, selection.tableBlockId);
      if (!tableBlock) {
        reason = 'invalidSelection';
        state.layoutDocument.viewState.tableSelection = null;
        return;
      }

      const result = mergeTableCellsByRange(tableBlock, selection.anchorCellId, selection.focusCellId);
      reason = result.reason;
      if (!result.didUpdate || !result.selectedNodeId) {
        state.layoutDocument.viewState.tableSelection = null;
        return;
      }

      const nextTableBlock = autoFitTableBlockForDefaultSize(state, result.block, result.selectedNodeId);
      const replaced = replaceTableBlockById(state.layoutDocument.blocks, tableBlock.id, nextTableBlock);
      if (!replaced.didUpdate) {
        state.layoutDocument.viewState.tableSelection = null;
        reason = 'invalidSelection';
        return;
      }

      didUpdate = true;
      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = replaced.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(replaced.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, replaced.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return {
      selectedNodeId,
      didUpdate,
      reason,
    };
  },
  mergeLayoutSelectedBlocks: () => {
    let selectedNodeId: string | null = null;
    let didUpdate = false;
    let mergedCount = 0;
    let reason: BlockMergeReason = 'invalidSelection';

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const selection = state.layoutDocument.viewState.blockSelection;
      if (!selection || selection.blockIds.length < 2) {
        reason = 'notEnoughBlocks';
        return;
      }

      const result = mergeTopLevelTextBlocksByIds(state.layoutDocument.blocks, selection.blockIds);
      reason = result.reason;
      mergedCount = result.mergedCount;
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      didUpdate = true;
      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.tableSelection = null;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return {
      selectedNodeId,
      didUpdate,
      reason,
      mergedCount,
    };
  },
  updateLayoutListStructure: ({ itemId, action }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceListStructureByItem(state.layoutDocument.blocks, itemId, action);
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutListOrdered: ({ itemId, ordered }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceListPropertyByItem(state.layoutDocument.blocks, itemId, (block, targetItemId) =>
        updateListOrderedByItem(block, targetItemId, ordered),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutListStart: ({ itemId, start }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceListPropertyByItem(state.layoutDocument.blocks, itemId, (block, targetItemId) =>
        updateListStartByItem(block, targetItemId, start),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutListItemChecked: ({ itemId, checked }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceListPropertyByItem(state.layoutDocument.blocks, itemId, (block, targetItemId) =>
        updateListItemCheckedByItem(block, targetItemId, checked),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutListItemLevel: ({ itemId, action }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceListPropertyByItem(state.layoutDocument.blocks, itemId, (block, targetItemId) =>
        updateListItemLevelByItem(block, targetItemId, action),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  reorderLayoutListItem: ({ itemId, action }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceListPropertyByItem(state.layoutDocument.blocks, itemId, (block, targetItemId) =>
        reorderListItemByItem(block, targetItemId, action),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutListTaskMode: ({ itemId, taskMode }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceListPropertyByItem(state.layoutDocument.blocks, itemId, (block, targetItemId) =>
        updateListTaskModeByItem(block, targetItemId, taskMode),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  convertLayoutListItemTaskState: ({ itemId, action }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceListPropertyByItem(state.layoutDocument.blocks, itemId, (block, targetItemId) =>
        convertListItemTaskStateByItem(block, targetItemId, action),
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutListBatchChecked: ({ itemId, scope, action }) => {
    let selectedNodeId: string | null = null;
    let changedCount = 0;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceListPropertyByItem(state.layoutDocument.blocks, itemId, (block, targetItemId) => {
        const batchResult = updateListBatchCheckedByItem(block, targetItemId, scope, action);
        changedCount = batchResult.changedCount;
        return {
          block: batchResult.block,
          selectedNodeId: batchResult.selectedNodeId,
          didUpdate: batchResult.didUpdate,
        };
      });
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return {
      selectedNodeId,
      changedCount,
    };
  },
  updateLayoutBlockquoteStructure: ({ blockquoteId, targetNodeId, action }) => {
    let selectedNodeId: string | null = null;

    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceBlockquoteStructureByNode(
        state.layoutDocument.blocks,
        blockquoteId,
        targetNodeId,
        action,
      );
      if (!result.didUpdate || !result.selectedNodeId) {
        return;
      }

      selectedNodeId = result.selectedNodeId;
      pushDocumentHistory(state);
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.layoutDocument.viewState.blockSelection = null;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutImageAttributes: ({
    nodeId,
    src,
    alt,
    title,
    widthPx,
    heightPx,
    lockAspectRatio,
    objectFit,
    cropTopPx,
    cropRightPx,
    cropBottomPx,
    cropLeftPx,
    wrapMode,
    wrapSide,
    showCaption,
    offsetX,
    offsetY,
  }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceOwnerBlock(state.layoutDocument.blocks, nodeId, (block) =>
        updateLayoutImageAttributesModel(block, {
          src,
          alt,
          title,
          widthPx,
          heightPx,
          lockAspectRatio,
          objectFit,
          cropTopPx,
          cropRightPx,
          cropBottomPx,
          cropLeftPx,
          wrapMode,
          wrapSide,
          showCaption,
          offsetX,
          offsetY,
        }),
      );
      applyDocumentMutation(state, nodeId, result);
    }),
  applyLayoutNodeBlockStyle: ({ nodeId, blockStyleOverrides }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceOwnerBlock(state.layoutDocument.blocks, nodeId, (block) =>
        applyBlockStyleOverridesToBlock(block, blockStyleOverrides),
      );
      applyDocumentMutation(state, nodeId, result);
    }),
  updateLayoutBlockSemantic: ({ nodeId, semantic }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceOwnerBlock(state.layoutDocument.blocks, nodeId, (block) =>
        applySemanticToLayoutBlock(block, semantic),
      );
      applyDocumentMutation(state, nodeId, result);
    }),
  applyLayoutQuickTextStyle: ({ scope, styleOverrides }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const nextStyles = applyQuickTextStyleToStyleSheet(
        state.layoutDocument.styles,
        scope,
        styleOverrides,
      );
      if (nextStyles === state.layoutDocument.styles) {
        return;
      }

      pushDocumentHistory(state);
      state.layoutDocument.styles = nextStyles;
      state.layoutDocument.meta.updatedAt = new Date().toISOString();
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    }),
});
