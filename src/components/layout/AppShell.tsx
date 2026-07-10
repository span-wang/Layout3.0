import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  clearAiGenerationRecords,
  deleteAiGenerationRecord,
  listAiGenerationRecords,
} from '@/services/AiGenerationRecordService';
import {
  createDocumentSearchReplacementDrafts,
  searchLayoutDocument,
  type DocumentSearchResult,
} from '@/services/DocumentSearchService';
import { runExportChecks } from '@/services/ExportCheckService';
import {
  applyPageNumbersToTocItems,
  buildHeadingPageNumberMap,
  buildTocItems,
  getRenderableLayoutBlocksForView,
  type LayoutBlock,
  type LayoutImageResource,
  type TextRun,
} from '@/engine/document-model';
import { applyQuickBlockStyleRulesToBlocks } from '@/engine/style/quickBlockStyle';
import { getDirectoryDisplayName, selectLocalImageFile } from '@/services/FileService';
import { usePagination } from '@/hooks/usePagination';
import { useResolvedStyleContract } from '@/hooks/useResolvedStyleContract';
import { useAppStore } from '@/store';
import { getBaseNameFromPath } from '@/utils/filePath';
import type { AiGenerationRecord } from '@/types/ai';
import type { CanvasTextSelectionState, WorkspaceDirectoryEntry } from '@/types/workspace';
import type {
  MeasuredTableRowHeights,
  MeasuredTextFragmentHeights,
  MeasuredTextLineBreaks,
  TableRowMeasurementJob,
  TextFragmentMeasurementJob,
} from '@/engine/typesetting';
import { CanvasPane } from './CanvasPane';
import { CommandPalette, type CommandPaletteCommand } from './CommandPalette';
import { EditorPane } from './EditorPane';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import { useCanvasInsertCommands } from './useCanvasInsertCommands';
import { useWorkspaceFileCommands } from './useWorkspaceFileCommands';

function areMeasuredTextLineBreaksEqual(
  currentBreaks: MeasuredTextLineBreaks,
  nextBreaks: MeasuredTextLineBreaks,
): boolean {
  const currentKeys = Object.keys(currentBreaks);
  const nextKeys = Object.keys(nextBreaks);
  if (currentKeys.length !== nextKeys.length) {
    return false;
  }

  return nextKeys.every((key) => {
    const currentOffsets = currentBreaks[key] ?? [];
    const nextOffsets = nextBreaks[key] ?? [];
    return (
      currentOffsets.length === nextOffsets.length &&
      nextOffsets.every((offset, index) => currentOffsets[index] === offset)
    );
  });
}

function areMeasuredTextFragmentHeightsEqual(
  currentHeights: MeasuredTextFragmentHeights,
  nextHeights: MeasuredTextFragmentHeights,
): boolean {
  const currentKeys = Object.keys(currentHeights);
  const nextKeys = Object.keys(nextHeights);
  return (
    currentKeys.length === nextKeys.length &&
    nextKeys.every((key) => currentHeights[key] === nextHeights[key])
  );
}

function areMeasuredTableRowHeightsEqual(
  currentHeights: MeasuredTableRowHeights,
  nextHeights: MeasuredTableRowHeights,
): boolean {
  const currentKeys = Object.keys(currentHeights);
  const nextKeys = Object.keys(nextHeights);
  return (
    currentKeys.length === nextKeys.length &&
    nextKeys.every((key) => currentHeights[key] === nextHeights[key])
  );
}

function findImageBlockById(blocks: LayoutBlock[], blockId: string): LayoutBlock | null {
  for (const block of blocks) {
    if (block.id === blockId && block.type === 'image' && block.metadata.kind === 'image') {
      return block;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedBlock = findImageBlockById(block.metadata.blocks, blockId);
      if (nestedBlock) {
        return nestedBlock;
      }
    }

    if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
      const nestedBlock = findImageBlockById(block.metadata.blocks, blockId);
      if (nestedBlock) {
        return nestedBlock;
      }
    }
  }

  return null;
}

const topLevelBlockDeleteLabels: Partial<Record<LayoutBlock['type'], string>> = {
  paragraph: '空文本块',
  heading: '标题',
  toc: '目录',
  list: '列表',
  table: '表格',
  image: '图片',
  equation: '公式',
  blockquote: '引用',
  columnSection: '局部分栏区段',
  code: '代码块',
  columnBreak: '分栏断点',
  pageBreak: '分页符',
};

function getTopLevelBlockDeleteMessage(blockType: LayoutBlock['type'] | null): string {
  if (!blockType) {
    return '已删除当前块';
  }

  return `已删除${topLevelBlockDeleteLabels[blockType] ?? '当前块'}`;
}

type CommandPaletteUsageCounts = Record<string, number>;

const COMMAND_PALETTE_USAGE_STORAGE_KEY = 'layout3.commandPaletteUsage';

function loadCommandPaletteUsageCounts(): CommandPaletteUsageCounts {
  try {
    const rawValue = window.localStorage.getItem(COMMAND_PALETTE_USAGE_STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue) as unknown;
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return {};
    }

    const normalizedCounts: CommandPaletteUsageCounts = {};
    for (const [commandId, count] of Object.entries(parsedValue)) {
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
        normalizedCounts[commandId] = Math.round(count);
      }
    }

    return normalizedCounts;
  } catch {
    return {};
  }
}

function saveCommandPaletteUsageCounts(usageCounts: CommandPaletteUsageCounts): void {
  try {
    window.localStorage.setItem(COMMAND_PALETTE_USAGE_STORAGE_KEY, JSON.stringify(usageCounts));
  } catch {
    // 本机排序记忆只是体验增强，写失败时保持命令面板主链路可用即可。
  }
}

export function AppShell(): JSX.Element {
  const resolvedStyleContract = useResolvedStyleContract();
  const [measuredBlockHeights, setMeasuredBlockHeights] = useState<Record<string, number>>({});
  const [measuredTextLineBreaks, setMeasuredTextLineBreaks] = useState<MeasuredTextLineBreaks>({});
  const [measuredTextFragmentHeights, setMeasuredTextFragmentHeights] =
    useState<MeasuredTextFragmentHeights>({});
  const [measuredTableRowHeights, setMeasuredTableRowHeights] =
    useState<MeasuredTableRowHeights>({});
  const [textFragmentMeasurementJobs, setTextFragmentMeasurementJobs] = useState<TextFragmentMeasurementJob[]>([]);
  const [tableRowMeasurementJobs, setTableRowMeasurementJobs] = useState<TableRowMeasurementJob[]>([]);
  usePagination(
    resolvedStyleContract,
    measuredBlockHeights,
    measuredTextLineBreaks,
    measuredTextFragmentHeights,
    measuredTableRowHeights,
    setTextFragmentMeasurementJobs,
    setTableRowMeasurementJobs,
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchReplacementText, setSearchReplacementText] = useState('');
  const [selectedSearchResultId, setSelectedSearchResultId] = useState<string | null>(null);
  const [searchFocusRequestKey, setSearchFocusRequestKey] = useState(0);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteUsageCounts, setCommandPaletteUsageCounts] = useState<CommandPaletteUsageCounts>({});
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [requestedEditNodeId, setRequestedEditNodeId] = useState<string | null>(null);
  const [requestedScrollToNodeId, setRequestedScrollToNodeId] = useState<string | null>(null);
  const [canvasTextSelection, setCanvasTextSelection] = useState<CanvasTextSelectionState>({
    nodeId: null,
    text: '',
    selection: null,
    isEditing: false,
    draftTextRuns: null,
  });

  const documentEpoch = useAppStore((state) => state.documentEpoch);
  const filePath = useAppStore((state) => state.filePath);
  const workspaceRootPath = useAppStore((state) => state.workspaceRootPath);
  const currentDirectoryPath = useAppStore((state) => state.currentDirectoryPath);
  const directoryEntries = useAppStore((state) => state.directoryEntries);
  const recentFiles = useAppStore((state) => state.recentlyOpenedFiles);
  const isDirty = useAppStore((state) => state.isDirty);
  const source = useAppStore((state) => state.source);
  const styleSettings = useAppStore((state) => state.styleSettings);
  const activeTab = useAppStore((state) => state.activeLeftPanelTab);
  const setActiveTab = useAppStore((state) => state.setActiveLeftPanelTab);
  const isLeftPanelOpen = useAppStore((state) => state.isLeftPanelOpen);
  const isRightPanelOpen = useAppStore((state) => state.isRightPanelOpen);
  const workspaceViewMode = useAppStore((state) => state.workspaceViewMode);
  const toggleLeftPanel = useAppStore((state) => state.toggleLeftPanel);
  const toggleRightPanel = useAppStore((state) => state.toggleRightPanel);
  const setWorkspaceViewMode = useAppStore((state) => state.setWorkspaceViewMode);
  const setActiveRightPanelTab = useAppStore((state) => state.setActiveRightPanelTab);
  const setActiveAiTab = useAppStore((state) => state.setActiveAiTab);
  const openAiPanel = useAppStore((state) => state.openAiPanel);
  const updateGeneratedContent = useAppStore((state) => state.updateGeneratedContent);
  const setGeneratedKnowledgeSources = useAppStore((state) => state.setGeneratedKnowledgeSources);
  const setGenerateError = useAppStore((state) => state.setGenerateError);
  const aiGenerationRecords = useAppStore((state) => state.aiGenerationRecords);
  const aiGenerationRecordDirectoryPath = useAppStore((state) => state.aiGenerationRecordDirectoryPath);
  const aiGenerationRecordsError = useAppStore((state) => state.aiGenerationRecordsError);
  const setAiGenerationRecordDirectory = useAppStore((state) => state.setAiGenerationRecordDirectory);
  const setAiGenerationRecordsError = useAppStore((state) => state.setAiGenerationRecordsError);
  const parseState = useAppStore((state) => state.parseState);
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const parseError = useAppStore((state) => state.parseError);
  const pageLayouts = useAppStore((state) => state.pageLayouts);
  const selectLayoutNode = useAppStore((state) => state.selectLayoutNode);
  const selectLayoutBlock = useAppStore((state) => state.selectLayoutBlock);
  const selectLayoutTableCell = useAppStore((state) => state.selectLayoutTableCell);
  const clearLayoutSelection = useAppStore((state) => state.clearLayoutSelection);
  const updateLayoutNodeText = useAppStore((state) => state.updateLayoutNodeText);
  const replaceLayoutNodeRichText = useAppStore((state) => state.replaceLayoutNodeRichText);
  const replaceMultipleLayoutNodeTexts = useAppStore((state) => state.replaceMultipleLayoutNodeTexts);
  const updateLayoutImageAttributes = useAppStore((state) => state.updateLayoutImageAttributes);
  const insertLayoutMarkdownBlocks = useAppStore((state) => state.insertLayoutMarkdownBlocks);
  const deleteLayoutTopLevelBlock = useAppStore((state) => state.deleteLayoutTopLevelBlock);
  const mergeLayoutSelectedBlocks = useAppStore((state) => state.mergeLayoutSelectedBlocks);
  const wrapLayoutSelectedBlocksInColumns = useAppStore((state) => state.wrapLayoutSelectedBlocksInColumns);
  const undoLayoutDocument = useAppStore((state) => state.undoLayoutDocument);
  const redoLayoutDocument = useAppStore((state) => state.redoLayoutDocument);
  const canUndoLayoutDocument = useAppStore((state) => state.documentHistoryPast.length > 0);
  const canRedoLayoutDocument = useAppStore((state) => state.documentHistoryFuture.length > 0);
  const isSplitView = workspaceViewMode === 'split';
  const displayedPageLayouts =
    parseState === 'error'
      ? pageLayouts
      : pageLayouts.length > 0
        ? pageLayouts
        : [{ pageNumber: 1, blocks: [], contract: resolvedStyleContract, warnings: [] }];
  const rawTocItems = useMemo(() => buildTocItems(layoutDocument), [layoutDocument]);
  const searchResults = useMemo(
    () =>
      searchLayoutDocument(layoutDocument, searchQuery, {
        caseSensitive: searchCaseSensitive,
        wholeWord: searchWholeWord,
      }),
    [layoutDocument, searchCaseSensitive, searchQuery, searchWholeWord],
  );
  const headingPageNumberMap = useMemo(() => buildHeadingPageNumberMap(displayedPageLayouts), [displayedPageLayouts]);
  const tocItems = useMemo(
    () => applyPageNumbersToTocItems(rawTocItems, headingPageNumberMap),
    [headingPageNumberMap, rawTocItems],
  );
  const displayedPageCount = parseState === 'error' ? 0 : displayedPageLayouts.length;
  const layoutWarnings = displayedPageLayouts.flatMap((page) => page.warnings);
  const currentDirectoryName = getDirectoryDisplayName(currentDirectoryPath);
  const selectedNodeId = layoutDocument?.viewState.selectedNodeId ?? null;
  const selectedBlockIds = layoutDocument?.viewState.blockSelection?.blockIds ?? [];
  const answerDisplayMode = layoutDocument?.viewState.answerDisplayMode ?? 'show';
  // 答案隐藏会重排语义块，画布只需要在文档真实变化时重新拿派生块，避免分页写回造成测量层反复刷新。
  const renderableDocumentBlocks = useMemo(
    () => applyQuickBlockStyleRulesToBlocks(getRenderableLayoutBlocksForView(layoutDocument), layoutDocument?.styles),
    [layoutDocument],
  );
  const characterCount = layoutDocument?.meta.characterCount ?? 0;
  const exportCheckResult = useMemo(
    () =>
      runExportChecks({
        layoutDocument,
        renderableBlocks: renderableDocumentBlocks,
        pages: displayedPageLayouts,
        styleSettings,
        tocItems,
        documentFilePath: filePath,
        workspaceRootPath,
      }),
    [displayedPageLayouts, filePath, layoutDocument, renderableDocumentBlocks, styleSettings, tocItems, workspaceRootPath],
  );

  useEffect(() => {
    setCommandPaletteUsageCounts(loadCommandPaletteUsageCounts());
  }, []);

  useEffect(() => {
    // 文档切换后，旧画布的临时编辑/滚动请求不应继续影响新文档界面。
    setDragSource(null);
    setRequestedEditNodeId(null);
    setRequestedScrollToNodeId(null);
    setCanvasTextSelection({
      nodeId: null,
      text: '',
      selection: null,
      isEditing: false,
      draftTextRuns: null,
    });
  }, [documentEpoch]);

  const {
    isSaving,
    isExporting,
    workspaceMessage,
    showMessage,
    handleCreateDocument,
    handleOpenDocument,
    handleSaveDocument,
    handleSaveDocumentAs,
    handleOpenFolder,
    handleCreateFolder,
    handleCreateLayoutFile,
    handleOpenEntry,
    handleOpenRecentFile,
    handleRemoveRecentFile,
    handleClearRecentFiles,
    handleRenameEntry,
    handleDeleteEntry,
    handleMoveEntry,
    handleImportFont,
    handleExportPdf,
    handleExportDocx,
  } = useWorkspaceFileCommands({
    displayedPageLayouts,
    tocItems,
    exportCheckResult,
    onOpenExportCheckPanel: () => {
      if (!isRightPanelOpen) {
        toggleRightPanel();
      }
      setActiveRightPanelTab('导出检查');
    },
  });
  const {
    handleInsertImage,
    handleInsertChemistryApparatus,
    handleInsertChemistryComposition,
    handleInsertEquation,
    handleInsertTable,
    handleInsertList,
    handleInsertParagraph,
    handleInsertColumnBreak,
    handleInsertPageBreak,
    handleInsertToc,
  } = useCanvasInsertCommands({
    showMessage,
    setCanvasTextSelection,
    setRequestedEditNodeId,
  });

  const workspaceClassName = [
    'workspace',
    isLeftPanelOpen ? 'workspace-left-open' : 'workspace-left-closed',
    isRightPanelOpen ? 'workspace-right-open' : 'workspace-right-closed',
    isSplitView ? 'workspace-split-mode' : 'workspace-single-mode',
  ].join(' ');

  const saveStatusLabel = isSaving ? '保存中' : isDirty ? '未保存' : '已保存';

  const handleMeasuredBlockHeightsChange = useCallback((nextHeights: Record<string, number>) => {
    setMeasuredBlockHeights((currentHeights) => {
      const currentKeys = Object.keys(currentHeights);
      const nextKeys = Object.keys(nextHeights);
      if (
        currentKeys.length === nextKeys.length &&
        nextKeys.every((key) => currentHeights[key] === nextHeights[key])
      ) {
        return currentHeights;
      }

      return nextHeights;
    });
  }, []);

  const handleMeasuredTextLineBreaksChange = useCallback((nextBreaks: MeasuredTextLineBreaks) => {
    setMeasuredTextLineBreaks((currentBreaks) =>
      areMeasuredTextLineBreaksEqual(currentBreaks, nextBreaks) ? currentBreaks : nextBreaks,
    );
  }, []);

  const handleMeasuredTextFragmentHeightsChange = useCallback((nextHeights: MeasuredTextFragmentHeights) => {
    setMeasuredTextFragmentHeights((currentHeights) => {
      const mergedHeights = { ...currentHeights, ...nextHeights };
      return areMeasuredTextFragmentHeightsEqual(currentHeights, mergedHeights) ? currentHeights : mergedHeights;
    });
  }, []);

  const handleMeasuredTableRowHeightsChange = useCallback((nextHeights: MeasuredTableRowHeights) => {
    setMeasuredTableRowHeights((currentHeights) => {
      const mergedHeights = { ...currentHeights, ...nextHeights };
      return areMeasuredTableRowHeightsEqual(currentHeights, mergedHeights) ? currentHeights : mergedHeights;
    });
  }, []);

  const handleSelectLayoutNode = useCallback(
    (nodeId: string) => {
      selectLayoutNode(nodeId);
      setActiveRightPanelTab('对象属性');
      setCanvasTextSelection({
        nodeId,
        text: '',
        selection: null,
        isEditing: false,
        draftTextRuns: null,
      });
    },
    [selectLayoutNode, setActiveRightPanelTab],
  );

  const handleSelectLayoutBlock = useCallback(
    (blockId: string, extendRange: boolean) => {
      selectLayoutBlock({ blockId, extendRange });
      setActiveRightPanelTab('对象属性');
      setCanvasTextSelection({
        nodeId: blockId,
        text: '',
        selection: null,
        isEditing: false,
        draftTextRuns: null,
      });
    },
    [selectLayoutBlock, setActiveRightPanelTab],
  );

  const handleSelectLayoutTableCell = useCallback(
    (cellId: string, extendRange: boolean) => {
      selectLayoutTableCell({ cellId, extendRange });
      setActiveRightPanelTab('对象属性');
      setCanvasTextSelection({
        nodeId: cellId,
        text: '',
        selection: null,
        isEditing: false,
        draftTextRuns: null,
      });
    },
    [selectLayoutTableCell, setActiveRightPanelTab],
  );

  const handleClearLayoutSelection = useCallback(() => {
    clearLayoutSelection();
    setRequestedScrollToNodeId(null);
    setCanvasTextSelection({
      nodeId: null,
      text: '',
      selection: null,
      isEditing: false,
      draftTextRuns: null,
    });
  }, [clearLayoutSelection]);

  const handleSelectOutlineItem = useCallback(
    (nodeId: string) => {
      selectLayoutNode(nodeId);
      setActiveRightPanelTab('对象属性');
      setActiveTab('大纲');
      setRequestedScrollToNodeId(nodeId);
      setCanvasTextSelection({
        nodeId,
        text: '',
        selection: null,
        isEditing: false,
        draftTextRuns: null,
      });
    },
    [selectLayoutNode, setActiveRightPanelTab, setActiveTab],
  );

  const handleSelectResourceBlock = useCallback(
    (blockId: string) => {
      selectLayoutNode(blockId);
      setActiveRightPanelTab('对象属性');
      setActiveTab('资源');
      setRequestedScrollToNodeId(blockId);
      setCanvasTextSelection({
        nodeId: blockId,
        text: '',
        selection: null,
        isEditing: false,
        draftTextRuns: null,
      });
    },
    [selectLayoutNode, setActiveRightPanelTab, setActiveTab],
  );

  const handleReplaceImageResource = useCallback(
    async (resource: LayoutImageResource): Promise<void> => {
      if (!layoutDocument) {
        showMessage('当前没有可替换图片的文档');
        return;
      }

      const imageBlock = findImageBlockById(layoutDocument.blocks, resource.blockId);
      if (!imageBlock || imageBlock.metadata.kind !== 'image') {
        showMessage('替换失败：没有找到关联的图片块');
        return;
      }

      try {
        const imagePath = await selectLocalImageFile();
        const imageName = getBaseNameFromPath(imagePath);
        const metadata = imageBlock.metadata;

        // 资源面板替换图片只更换文件路径，保留原有尺寸、裁剪和环绕设置，避免意外改变排版结果。
        updateLayoutImageAttributes({
          nodeId: imageBlock.id,
          src: imagePath,
          alt: metadata.alt || imageName,
          title: metadata.title ?? null,
          widthPx: metadata.widthPx ?? null,
          heightPx: metadata.heightPx ?? null,
          lockAspectRatio: metadata.lockAspectRatio ?? true,
          objectFit: metadata.objectFit ?? 'contain',
          cropTopPx: metadata.cropTopPx ?? 0,
          cropRightPx: metadata.cropRightPx ?? 0,
          cropBottomPx: metadata.cropBottomPx ?? 0,
          cropLeftPx: metadata.cropLeftPx ?? 0,
          wrapMode: metadata.wrapMode ?? 'inline',
          wrapSide: metadata.wrapSide ?? 'right',
          showCaption: metadata.showCaption ?? false,
          offsetX: metadata.offsetX ?? 0,
          offsetY: metadata.offsetY ?? 0,
        });
        handleSelectResourceBlock(imageBlock.id);
        showMessage(`已替换图片：${imageName}`);
      } catch (error) {
        if (error instanceof Error && error.message === '已取消选择图片') {
          showMessage('已取消替换图片');
          return;
        }

        const message = error instanceof Error ? error.message : '替换图片失败';
        showMessage(`替换图片失败：${message}`);
      }
    },
    [handleSelectResourceBlock, layoutDocument, showMessage, updateLayoutImageAttributes],
  );

  const handleNavigateToNode = useCallback(
    (nodeId: string) => {
      selectLayoutNode(nodeId);
      setActiveRightPanelTab('对象属性');
      setRequestedScrollToNodeId(nodeId);
      setCanvasTextSelection({
        nodeId,
        text: '',
        selection: null,
        isEditing: false,
        draftTextRuns: null,
      });
    },
    [selectLayoutNode, setActiveRightPanelTab],
  );

  const handleOpenSearchPanel = useCallback(() => {
    if (!isLeftPanelOpen) {
      toggleLeftPanel();
    }
    setActiveTab('搜索');
    setSearchFocusRequestKey((currentKey) => currentKey + 1);
  }, [isLeftPanelOpen, setActiveTab, toggleLeftPanel]);

  const handleOpenExportCheckPanel = useCallback(() => {
    if (!isRightPanelOpen) {
      toggleRightPanel();
    }
    setActiveRightPanelTab('导出检查');
  }, [isRightPanelOpen, setActiveRightPanelTab, toggleRightPanel]);

  const handleOpenAiPanel = useCallback(() => {
    if (!isRightPanelOpen) {
      toggleRightPanel();
    }
    setActiveRightPanelTab('AI助手');
    openAiPanel();
  }, [isRightPanelOpen, openAiPanel, setActiveRightPanelTab, toggleRightPanel]);

  const commandPaletteCommands = useMemo<CommandPaletteCommand[]>(
    () => [
      {
        id: 'file-create-document',
        title: '新建空白文档',
        description: '创建一个新的空白 `.layout` 文档',
        group: '文件',
        keywords: ['新建', '空白', 'layout', 'document', 'create'],
        run: handleCreateDocument,
      },
      {
        id: 'file-open-document',
        title: '打开文档',
        description: '打开本地 Markdown 或 `.layout` 文档',
        group: '文件',
        keywords: ['打开', '文档', 'markdown', 'layout', 'open'],
        run: handleOpenDocument,
      },
      {
        id: 'file-save-document',
        title: '保存文档',
        description: '保存当前文档到现有路径',
        group: '文件',
        keywords: ['保存', 'save', '写入'],
        shortcutHint: 'Ctrl/Cmd + S',
        run: handleSaveDocument,
      },
      {
        id: 'file-save-document-as',
        title: '文档另存为',
        description: '把当前文档保存到新的位置',
        group: '文件',
        keywords: ['另存为', '保存到', 'save as'],
        run: handleSaveDocumentAs,
      },
      {
        id: 'export-pdf',
        title: '导出 PDF',
        description: '按当前分页结果导出 PDF',
        group: '导出',
        keywords: ['导出', 'pdf', 'print'],
        run: handleExportPdf,
      },
      {
        id: 'export-docx',
        title: '导出 DOCX',
        description: '按当前文档结果导出 DOCX',
        group: '导出',
        keywords: ['导出', 'docx', 'word'],
        run: handleExportDocx,
      },
      {
        id: 'open-export-check',
        title: '打开导出检查',
        description: '查看分页、资源和 DOCX 兼容性提示',
        group: '检查',
        keywords: ['导出检查', '检查', 'warning', 'risk'],
        run: handleOpenExportCheckPanel,
      },
      {
        id: 'open-search-panel',
        title: '打开搜索与替换',
        description: '切到左侧搜索面板并聚焦搜索框',
        group: '面板',
        keywords: ['搜索', '替换', 'find', 'replace'],
        shortcutHint: 'Ctrl/Cmd + F',
        run: handleOpenSearchPanel,
      },
      {
        id: 'open-ai-panel',
        title: '打开 AI 助手',
        description: '切到右侧 AI 面板',
        group: '面板',
        keywords: ['ai', '生成', '优化', '检查', 'assistant'],
        run: handleOpenAiPanel,
      },
      {
        id: 'view-preview',
        title: '切换到预览视图',
        description: '只显示分页预览画布',
        group: '视图',
        keywords: ['预览', 'view', 'preview'],
        run: () => setWorkspaceViewMode('preview'),
      },
      {
        id: 'view-split',
        title: '切换到分屏视图',
        description: '同时查看源码快照和分页预览',
        group: '视图',
        keywords: ['分屏', 'split', '源码'],
        run: () => setWorkspaceViewMode('split'),
      },
      {
        id: 'insert-image',
        title: '插入图片',
        description: '选择本地图片并插入当前文档',
        group: '插入',
        keywords: ['图片', 'image', '插入'],
        run: handleInsertImage,
      },
      {
        id: 'insert-table',
        title: '插入表格',
        description: '插入默认 3 x 3 表格',
        group: '插入',
        keywords: ['表格', 'table', '插入'],
        run: handleInsertTable,
      },
      {
        id: 'insert-equation',
        title: '插入公式',
        description: '插入一个新的公式块',
        group: '插入',
        keywords: ['公式', 'equation', 'latex'],
        run: handleInsertEquation,
      },
      {
        id: 'insert-unordered-list',
        title: '插入无序列表',
        description: '插入一个新的无序列表',
        group: '插入',
        keywords: ['列表', 'list', '无序'],
        run: () => handleInsertList('unordered'),
      },
      {
        id: 'insert-page-break',
        title: '插入分页符',
        description: '在当前位置插入一个分页符',
        group: '插入',
        keywords: ['分页符', 'page break', '分页'],
        run: handleInsertPageBreak,
      },
      {
        id: 'insert-toc',
        title: '插入目录',
        description: '插入一个目录块',
        group: '插入',
        keywords: ['目录', 'toc', 'table of contents'],
        run: handleInsertToc,
      },
    ],
    [
      handleCreateDocument,
      handleExportDocx,
      handleExportPdf,
      handleInsertEquation,
      handleInsertImage,
      handleInsertList,
      handleInsertPageBreak,
      handleInsertTable,
      handleInsertToc,
      handleOpenAiPanel,
      handleOpenDocument,
      handleOpenExportCheckPanel,
      handleOpenSearchPanel,
      handleSaveDocument,
      handleSaveDocumentAs,
      setWorkspaceViewMode,
    ],
  );

  const handleExecuteCommandPaletteCommand = useCallback(
    (command: CommandPaletteCommand) => {
      setIsCommandPaletteOpen(false);
      setCommandPaletteUsageCounts((currentCounts) => {
        const nextCounts = {
          ...currentCounts,
          [command.id]: (currentCounts[command.id] ?? 0) + 1,
        };
        saveCommandPaletteUsageCounts(nextCounts);
        return nextCounts;
      });

      void Promise.resolve(command.run()).catch((error) => {
        const message = error instanceof Error ? error.message : '命令执行失败';
        showMessage(`命令执行失败：${message}`);
      });
    },
    [showMessage],
  );

  const handleSelectSearchResult = useCallback(
    (result: DocumentSearchResult) => {
      setSelectedSearchResultId(result.id);
      selectLayoutNode(result.nodeId);
      setActiveRightPanelTab('对象属性');
      setRequestedScrollToNodeId(result.nodeId);
      setCanvasTextSelection({
        nodeId: result.nodeId,
        text: '',
        selection: null,
        isEditing: false,
        draftTextRuns: null,
      });
    },
    [selectLayoutNode, setActiveRightPanelTab],
  );

  const handleReplaceSearchResults = useCallback(
    (resultsToReplace: DocumentSearchResult[], successMessage: (matchCount: number, nodeCount: number) => string) => {
      if (resultsToReplace.length === 0) {
        showMessage('当前没有可替换的搜索结果');
        return;
      }

      const drafts = createDocumentSearchReplacementDrafts(resultsToReplace, searchReplacementText);
      const replaceResult = replaceMultipleLayoutNodeTexts({
        replacements: drafts,
        selectedNodeId: resultsToReplace[0]?.nodeId ?? null,
      });

      if (!replaceResult.didUpdate) {
        showMessage('没有内容需要替换');
        return;
      }

      if (replaceResult.selectedNodeId) {
        setRequestedScrollToNodeId(replaceResult.selectedNodeId);
      }
      setSelectedSearchResultId(null);
      showMessage(successMessage(resultsToReplace.length, replaceResult.updatedCount));
    },
    [replaceMultipleLayoutNodeTexts, searchReplacementText, showMessage],
  );

  const handleReplaceSelectedSearchResult = useCallback(() => {
    const selectedResult = selectedSearchResultId
      ? searchResults.find((result) => result.id === selectedSearchResultId) ?? null
      : searchResults[0] ?? null;

    if (!selectedResult) {
      showMessage('请先选择一个搜索结果');
      return;
    }

    handleReplaceSearchResults([selectedResult], () => '已替换当前命中');
  }, [handleReplaceSearchResults, searchResults, selectedSearchResultId, showMessage]);

  const handleReplaceAllSearchResults = useCallback(() => {
    handleReplaceSearchResults(
      searchResults,
      (matchCount, nodeCount) => `已替换 ${matchCount} 处命中，影响 ${nodeCount} 个节点`,
    );
  }, [handleReplaceSearchResults, searchResults]);

  useEffect(() => {
    if (!selectedSearchResultId) {
      return;
    }

    if (!searchResults.some((result) => result.id === selectedSearchResultId)) {
      setSelectedSearchResultId(null);
    }
  }, [searchResults, selectedSearchResultId]);

  const handleRefreshAiGenerationRecords = useCallback(async () => {
    try {
      const recordDirectory = await listAiGenerationRecords(workspaceRootPath ?? currentDirectoryPath);
      setAiGenerationRecordDirectory(recordDirectory);
    } catch (error) {
      setAiGenerationRecordsError(error instanceof Error ? error.message : 'AI 生成记录读取失败');
    }
  }, [currentDirectoryPath, setAiGenerationRecordDirectory, setAiGenerationRecordsError, workspaceRootPath]);

  useEffect(() => {
    void handleRefreshAiGenerationRecords();
  }, [handleRefreshAiGenerationRecords]);

  const handleRestoreAiGenerationRecord = useCallback(
    (record: AiGenerationRecord) => {
      updateGeneratedContent(record.content);
      setGeneratedKnowledgeSources(record.knowledgeSources ?? []);
      setGenerateError(null);
      if (!isRightPanelOpen) {
        toggleRightPanel();
      }
      setActiveRightPanelTab('AI助手');
      setActiveAiTab('generate');
      openAiPanel();
      showMessage('已将 AI 生成记录恢复到结果区');
    },
    [
      isRightPanelOpen,
      openAiPanel,
      setActiveAiTab,
      setActiveRightPanelTab,
      setGenerateError,
      setGeneratedKnowledgeSources,
      showMessage,
      toggleRightPanel,
      updateGeneratedContent,
    ],
  );

  const handleInsertAiGenerationRecord = useCallback(
    async (record: AiGenerationRecord) => {
      try {
        const insertedBlockId = await insertLayoutMarkdownBlocks({ markdown: record.content });
        if (!insertedBlockId) {
          showMessage('插入失败：AI 生成记录没有解析出可插入的文档结构');
          return;
        }

        showMessage('已插入 AI 生成记录内容');
      } catch (error) {
        const message = error instanceof Error ? error.message : '插入 AI 生成记录失败';
        showMessage(`插入失败：${message}`);
      }
    },
    [insertLayoutMarkdownBlocks, showMessage],
  );

  const handleDeleteAiGenerationRecord = useCallback(
    async (recordId: string) => {
      try {
        const recordDirectory = await deleteAiGenerationRecord(workspaceRootPath ?? currentDirectoryPath, recordId);
        setAiGenerationRecordDirectory(recordDirectory);
        showMessage('已删除 AI 生成记录');
      } catch (error) {
        const message = error instanceof Error ? error.message : '删除 AI 生成记录失败';
        setAiGenerationRecordsError(message);
        showMessage(`删除失败：${message}`);
      }
    },
    [
      currentDirectoryPath,
      setAiGenerationRecordDirectory,
      setAiGenerationRecordsError,
      showMessage,
      workspaceRootPath,
    ],
  );

  const handleClearAiGenerationRecords = useCallback(async () => {
    try {
      const recordDirectory = await clearAiGenerationRecords(workspaceRootPath ?? currentDirectoryPath);
      setAiGenerationRecordDirectory(recordDirectory);
      showMessage('已清空 AI 生成记录');
    } catch (error) {
      const message = error instanceof Error ? error.message : '清空 AI 生成记录失败';
      setAiGenerationRecordsError(message);
      showMessage(`清空失败：${message}`);
    }
  }, [
    currentDirectoryPath,
    setAiGenerationRecordDirectory,
    setAiGenerationRecordsError,
    showMessage,
    workspaceRootPath,
  ]);

  const handleCommitLayoutNodeText = useCallback(
    (nodeId: string, text: string) => {
      updateLayoutNodeText({ nodeId, text });
      showMessage('已更新画布文字');
    },
    [updateLayoutNodeText],
  );

  const handleCommitLayoutNodeRichText = useCallback(
    (nodeId: string, textRuns: TextRun[]) => {
      replaceLayoutNodeRichText({ nodeId, textRuns });
      showMessage('已更新画布富文本');
    },
    [replaceLayoutNodeRichText],
  );

  const handleMergeSelectedBlocks = useCallback(() => {
    const result = mergeLayoutSelectedBlocks();
    if (result.didUpdate) {
      setCanvasTextSelection({
        nodeId: result.selectedNodeId,
        text: '',
        selection: null,
        isEditing: false,
        draftTextRuns: null,
      });
      showMessage(`已合并 ${result.mergedCount} 个块`);
      return;
    }

    const failureMessage: Record<typeof result.reason, string> = {
      merged: '已合并选中块',
      invalidSelection: '请选择连续的顶层块',
      notEnoughBlocks: '至少需要选择 2 个块',
      nonContiguous: '只能合并连续块',
      unsupportedBlockType: '当前选区包含暂不支持合并的块',
      mixedBlockTypes: '只能合并同类型文本块',
    };
    showMessage(failureMessage[result.reason]);
  }, [mergeLayoutSelectedBlocks, showMessage]);

  const handleWrapSelectedBlocksInColumns = useCallback((columnCount: 2 | 3) => {
    const result = wrapLayoutSelectedBlocksInColumns({ columnCount });
    if (result.didUpdate) {
      setCanvasTextSelection({
        nodeId: result.selectedNodeId,
        text: '',
        selection: null,
        isEditing: false,
        draftTextRuns: null,
      });
      showMessage(`已将 ${result.wrappedCount} 个块设为局部${result.columnCount}栏`);
      return;
    }

    const failureMessage: Record<typeof result.reason, string> = {
      wrapped: `已设为局部${result.columnCount}栏`,
      invalidSelection: '请选择连续的顶层块',
      notEnoughBlocks: '至少需要选择 2 个块',
      nonContiguous: '只能选择连续块',
      unsupportedBlockType: '当前选区包含暂不支持局部分栏的块',
    };
    showMessage(failureMessage[result.reason]);
  }, [showMessage, wrapLayoutSelectedBlocksInColumns]);

  const handleUndoLayoutDocument = useCallback(() => {
    const didUndo = undoLayoutDocument();
    if (!didUndo) {
      showMessage('当前没有可撤销的操作');
      return;
    }

    setCanvasTextSelection({
      nodeId: null,
      text: '',
      selection: null,
      isEditing: false,
      draftTextRuns: null,
    });
    showMessage('已撤销');
  }, [showMessage, undoLayoutDocument]);

  const handleRedoLayoutDocument = useCallback(() => {
    const didRedo = redoLayoutDocument();
    if (!didRedo) {
      showMessage('当前没有可重做的操作');
      return;
    }

    setCanvasTextSelection({
      nodeId: null,
      text: '',
      selection: null,
      isEditing: false,
      draftTextRuns: null,
    });
    showMessage('已重做');
  }, [redoLayoutDocument, showMessage]);

  const handleDeleteSelectedTopLevelBlock = useCallback(() => {
    if (!selectedNodeId || selectedBlockIds.length > 1) {
      return;
    }

    const result = deleteLayoutTopLevelBlock({
      nodeId: selectedNodeId,
    });
    if (!result.didDelete) {
      showMessage('当前块删除失败');
      return;
    }

    setRequestedScrollToNodeId(null);
    setCanvasTextSelection({
      nodeId: result.selectedNodeId,
      text: '',
      selection: null,
      isEditing: false,
      draftTextRuns: null,
    });
    showMessage(getTopLevelBlockDeleteMessage(result.deletedBlockType));
  }, [deleteLayoutTopLevelBlock, selectedBlockIds.length, selectedNodeId, showMessage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return;
      }

      const key = event.key.toLowerCase();
      const isCommandPaletteShortcut = (event.ctrlKey || event.metaKey) && event.code === 'Slash';
      if (isCommandPaletteShortcut) {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      if (isCommandPaletteOpen && key === 'escape') {
        event.preventDefault();
        setIsCommandPaletteOpen(false);
        return;
      }

      if (isCommandPaletteOpen) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && key === 'f') {
        event.preventDefault();
        handleOpenSearchPanel();
        return;
      }

      const target = event.target as HTMLElement | null;
      const isEditingTarget =
        !!target &&
        (target.isContentEditable ||
          !!target.closest('input, textarea, select, [contenteditable="true"]'));
      const isCanvasShortcutTarget =
        !target || target === document.body || !!target.closest('.canvas-pane-scroll');
      const isDeleteShortcut = event.key === 'Delete';
      if (
        isDeleteShortcut &&
        isCanvasShortcutTarget &&
        !isEditingTarget &&
        !canvasTextSelection.isEditing &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        handleDeleteSelectedTopLevelBlock();
        if (selectedNodeId && selectedBlockIds.length <= 1) {
          event.preventDefault();
        }
        return;
      }

      if (isEditingTarget || !(event.ctrlKey || event.metaKey)) {
        return;
      }
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        handleRedoLayoutDocument();
        return;
      }

      if (key === 'z') {
        event.preventDefault();
        handleUndoLayoutDocument();
        return;
      }

      if (key === 'y') {
        event.preventDefault();
        handleRedoLayoutDocument();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    canvasTextSelection.isEditing,
    handleDeleteSelectedTopLevelBlock,
    handleOpenSearchPanel,
    handleRedoLayoutDocument,
    handleUndoLayoutDocument,
    isCommandPaletteOpen,
    selectedBlockIds.length,
    selectedNodeId,
  ]);

  const handleDragStart = (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => {
    setDragSource(entry.path);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', entry.path);
  };

  const handleDragEnd = () => {
    setDragSource(null);
  };

  const handleDragOver = (e: React.DragEvent, _entry: WorkspaceDirectoryEntry) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => {
    e.preventDefault();
    if (!dragSource || entry.kind !== 'directory') return;
    if (dragSource === entry.path) return;
    handleMoveEntry(dragSource, entry.path);
    setDragSource(null);
  };

  const handleConsumeRequestedEditNode = (nodeId: string) => {
    setRequestedEditNodeId((current) => (current === nodeId ? null : current));
  };

  const handleConsumeRequestedScrollNode = (nodeId: string) => {
    setRequestedScrollToNodeId((current) => (current === nodeId ? null : current));
  };

  return (
    <div className="app-shell">
      <Toolbar
        isLeftPanelOpen={isLeftPanelOpen}
        isRightPanelOpen={isRightPanelOpen}
        workspaceViewMode={workspaceViewMode}
        isSaving={isSaving}
        isExporting={isExporting}
        canUndo={canUndoLayoutDocument}
        canRedo={canRedoLayoutDocument}
        canvasTextSelection={canvasTextSelection}
        onCreateDocument={handleCreateDocument}
        onOpenDocument={handleOpenDocument}
        onOpenFolder={handleOpenFolder}
        onSaveDocument={handleSaveDocument}
        onSaveDocumentAs={handleSaveDocumentAs}
        onExportPdf={handleExportPdf}
        onExportDocx={handleExportDocx}
        onUndo={handleUndoLayoutDocument}
        onRedo={handleRedoLayoutDocument}
        onImportFont={handleImportFont}
        onInsertImage={handleInsertImage}
        onInsertChemistryApparatus={handleInsertChemistryApparatus}
        onInsertChemistryComposition={handleInsertChemistryComposition}
        onInsertEquation={handleInsertEquation}
        onInsertTable={handleInsertTable}
        onInsertList={handleInsertList}
        onInsertParagraph={handleInsertParagraph}
        onInsertColumnBreak={handleInsertColumnBreak}
        onInsertPageBreak={handleInsertPageBreak}
        onInsertToc={handleInsertToc}
        onToggleLeftPanel={toggleLeftPanel}
        onToggleRightPanel={toggleRightPanel}
        onChangeViewMode={setWorkspaceViewMode}
        onOpenSearchPanel={handleOpenSearchPanel}
        onOpenExportCheckPanel={handleOpenExportCheckPanel}
        onOpenAiPanel={handleOpenAiPanel}
      />

      <main className={workspaceClassName}>
        {isLeftPanelOpen ? (
          <LeftPanel
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tocItems={tocItems}
            selectedOutlineNodeId={selectedNodeId}
            currentFilePath={filePath}
            currentDirectoryName={currentDirectoryName}
            directoryEntries={directoryEntries}
            recentFiles={recentFiles}
            onOpenFolder={handleOpenFolder}
            onCreateFolder={handleCreateFolder}
            onCreateLayoutFile={handleCreateLayoutFile}
            onOpenEntry={handleOpenEntry}
            onSelectOutlineItem={handleSelectOutlineItem}
            documentResources={layoutDocument?.resources ?? []}
            selectedResourceNodeId={selectedNodeId}
            onSelectResourceBlock={handleSelectResourceBlock}
            onReplaceImageResource={handleReplaceImageResource}
            onOpenRecentFile={handleOpenRecentFile}
            onRemoveRecentFile={handleRemoveRecentFile}
            onClearRecentFiles={handleClearRecentFiles}
            onRenameEntry={handleRenameEntry}
            onDeleteEntry={handleDeleteEntry}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searchResults={searchResults}
            selectedSearchResultId={selectedSearchResultId}
            searchCaseSensitive={searchCaseSensitive}
            onSearchCaseSensitiveChange={setSearchCaseSensitive}
            searchWholeWord={searchWholeWord}
            onSearchWholeWordChange={setSearchWholeWord}
            searchReplacementText={searchReplacementText}
            onSearchReplacementTextChange={setSearchReplacementText}
            searchFocusRequestKey={searchFocusRequestKey}
            onSelectSearchResult={handleSelectSearchResult}
            onReplaceSelectedSearchResult={handleReplaceSelectedSearchResult}
            onReplaceAllSearchResults={handleReplaceAllSearchResults}
            aiGenerationRecords={aiGenerationRecords}
            aiGenerationRecordDirectoryPath={aiGenerationRecordDirectoryPath}
            aiGenerationRecordsError={aiGenerationRecordsError}
            onRefreshAiGenerationRecords={handleRefreshAiGenerationRecords}
            onRestoreAiGenerationRecord={handleRestoreAiGenerationRecord}
            onInsertAiGenerationRecord={handleInsertAiGenerationRecord}
            onDeleteAiGenerationRecord={handleDeleteAiGenerationRecord}
            onClearAiGenerationRecords={handleClearAiGenerationRecords}
            dragSource={dragSource}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        ) : null}

        <section className="workspace-center" aria-label="中间工作区">
          <div className="workspace-center-header">
            <div>
              <strong>当前工作台</strong>
              <span>
                {workspaceViewMode === 'preview' ? '聚焦分页预览' : '同时查看源码快照与分页'}
              </span>
            </div>
            {workspaceMessage ? <span className="workspace-message">{workspaceMessage}</span> : null}
          </div>

          <div className={isSplitView ? 'center-panels center-panels-split' : 'center-panels'}>
            {isSplitView ? (
              <EditorPane
                parseState={parseState}
                source={source}
                isCondensed
              />
            ) : null}

            <CanvasPane
              documentTitle={layoutDocument?.title ?? '未命名文档'}
              documentBlockCount={renderableDocumentBlocks.length}
              documentBlocks={renderableDocumentBlocks}
              documentResources={layoutDocument?.resources ?? []}
              documentStyles={layoutDocument?.styles ?? { blockStyles: {}, textStyles: {} }}
              semanticRoleConfig={layoutDocument?.meta.semanticRoleConfig}
              answerDisplayMode={answerDisplayMode}
              pageLayouts={displayedPageLayouts}
              parseError={parseError}
              parseState={parseState}
              resolvedStyleContract={resolvedStyleContract}
              headerFooterContent={styleSettings.headerFooterContent}
              pdfWatermarkSettings={styleSettings.pdfWatermark}
              selectedNodeId={selectedNodeId}
              selectedBlockIds={selectedBlockIds}
              workspaceRootPath={workspaceRootPath}
              onSelectNode={handleSelectLayoutNode}
              onSelectBlock={handleSelectLayoutBlock}
              onSelectTableCell={handleSelectLayoutTableCell}
              onClearSelection={handleClearLayoutSelection}
              onMergeSelectedBlocks={handleMergeSelectedBlocks}
              onWrapSelectedBlocksInColumns={handleWrapSelectedBlocksInColumns}
              onCommitNodeText={handleCommitLayoutNodeText}
              onCommitNodeRichText={handleCommitLayoutNodeRichText}
              onTextSelectionChange={setCanvasTextSelection}
              tocItems={tocItems}
              onNavigateToNode={handleNavigateToNode}
              requestedStartEditingNodeId={requestedEditNodeId}
              onConsumeRequestedStartEditingNode={handleConsumeRequestedEditNode}
              requestedScrollToNodeId={requestedScrollToNodeId}
              onConsumeRequestedScrollToNode={handleConsumeRequestedScrollNode}
              isCondensed={isSplitView}
              onMeasuredBlockHeightsChange={handleMeasuredBlockHeightsChange}
              onMeasuredTextLineBreaksChange={handleMeasuredTextLineBreaksChange}
              textFragmentMeasurementJobs={textFragmentMeasurementJobs}
              onMeasuredTextFragmentHeightsChange={handleMeasuredTextFragmentHeightsChange}
              tableRowMeasurementJobs={tableRowMeasurementJobs}
              onMeasuredTableRowHeightsChange={handleMeasuredTableRowHeightsChange}
            />
          </div>
        </section>

        {isRightPanelOpen ? (
          <RightPanel
            currentPageCount={displayedPageCount}
            headingCount={tocItems.length}
            characterCount={characterCount}
            workspaceViewMode={workspaceViewMode}
            layoutWarnings={layoutWarnings}
            canvasTextSelection={canvasTextSelection}
            exportCheckResult={exportCheckResult}
          />
        ) : null}
      </main>

      <StatusBar
        parseState={parseState}
        characterCount={characterCount}
        pageCount={displayedPageCount}
        workspaceViewMode={workspaceViewMode}
        saveStatusLabel={saveStatusLabel}
        pageLabel={resolvedStyleContract.pageLabel}
        templateThemeLabel={resolvedStyleContract.templateThemeLabel}
        layoutWarningCount={layoutWarnings.length}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        commands={commandPaletteCommands}
        usageCounts={commandPaletteUsageCounts}
        onClose={() => setIsCommandPaletteOpen(false)}
        onExecute={handleExecuteCommandPaletteCommand}
      />
    </div>
  );
}
