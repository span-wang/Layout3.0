import { starterMarkdown, starterTitle } from '@/constants/workspace';
import {
  applyTextRunPatchToTextRuns,
  applyBlockStyleOverridesToBlock,
  clearTextFormattingInTextRuns,
  createEmptyLayoutDocument,
  getLayoutBlockPlainText,
  insertImageBlockAfterNode,
  insertTableBlockAfterNode,
  toggleTextMarkInTextRuns,
  updateListOrderedByItem,
  updateListStartByItem,
  updateListStructureByItem,
  updateTableColumnAlignByCell,
  updateTableHeaderRowByCell,
  updateTableStructureByCell,
  updateLayoutBlockText as updateLayoutBlockTextModel,
  updateLayoutImageAttributes as updateLayoutImageAttributesModel,
  updateLayoutListItemText,
  updateLayoutTableCellText,
} from '@/engine/document-model';
import type {
  BlockStyleOverrides,
  LayoutBlock,
  LayoutResource,
  ListPropertyEditResult,
  ListStructureAction,
  TableColumnAlign,
  TablePropertyEditResult,
  TableStructureAction,
  TextRun,
  TextMarkType,
  TextRangeSelection,
  TextStyleOverrides,
} from '@/engine/document-model';
import { loadRecentFiles } from '@/services/RecentFilesService';
import type { DocumentSlice, StoreSlice } from '@/store/types';
import { getDocumentFormatFromPath } from '@/utils/filePath';

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
    if (resource.blockId !== nodeId) {
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

function refreshDocumentMeta(state: DocumentSlice, blocks: LayoutBlock[]): void {
  const text = buildDocumentText(blocks);
  state.layoutDocument!.meta.wordCount = countWords(text);
  state.layoutDocument!.meta.characterCount = countCharacters(text);
  state.layoutDocument!.meta.blockCount = blocks.length;
  state.layoutDocument!.meta.updatedAt = new Date().toISOString();
}

function applyDocumentMutation(
  state: DocumentSlice,
  nodeId: string,
  result: { blocks: LayoutBlock[]; didUpdate: boolean },
): void {
  if (!state.layoutDocument || !result.didUpdate) {
    return;
  }

  state.layoutDocument.blocks = result.blocks;
  const imageResourceSnapshot = getImageResourceSnapshotForNodeId(result.blocks, nodeId);
  if (imageResourceSnapshot !== null) {
    state.layoutDocument.resources = syncImageResource(
      state.layoutDocument.resources,
      nodeId,
      imageResourceSnapshot,
    );
  }
  state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
  refreshDocumentMeta(state, result.blocks);
  state.layoutDocument.viewState.selectedNodeId = nodeId;
  state.isDirty = true;
  state.parseState = 'ready';
  state.parseError = null;
}

const initialLayoutDocument = createEmptyLayoutDocument({ title: starterTitle, source: starterMarkdown });

export const createDocumentSlice: StoreSlice<DocumentSlice> = (set) => ({
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
      state.layoutDocument = layoutDocument;
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
      state.layoutDocument = layoutDocument;
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
      state.layoutDocument = document;
      state.parseError = null;
    }),
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
    }),
  clearLayoutSelection: () =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      state.layoutDocument.viewState.selectedNodeId = null;
    }),
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
  insertLayoutImageBlock: ({ src, alt, title, insertAfterNodeId }) => {
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
          insertAfterNodeId,
        },
      );

      insertedBlockId = result.insertedBlockId;
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.resources = result.resources;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.insertedBlockId;
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

      selectedNodeId = result.selectedNodeId;
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      // 默认选中新表格的第一个单元格，让用户插入后能顺手进入单元格编辑。
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
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

      selectedNodeId = result.selectedNodeId;
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
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
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
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
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
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
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
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
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
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
      state.layoutDocument.blocks = result.blocks;
      state.layoutDocument.title = getFirstHeadingTitle(result.blocks) ?? state.layoutDocument.title;
      refreshDocumentMeta(state, result.blocks);
      state.layoutDocument.viewState.selectedNodeId = result.selectedNodeId;
      state.isDirty = true;
      state.parseState = 'ready';
      state.parseError = null;
    });

    return selectedNodeId;
  },
  updateLayoutImageAttributes: ({ nodeId, src, alt, title }) =>
    set((state) => {
      if (!state.layoutDocument) {
        return;
      }

      const result = replaceOwnerBlock(state.layoutDocument.blocks, nodeId, (block) =>
        updateLayoutImageAttributesModel(block, { src, alt, title }),
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
});
