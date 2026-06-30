import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  clearAiGenerationRecords,
  deleteAiGenerationRecord,
  listAiGenerationRecords,
} from '@/services/AiGenerationRecordService';
import {
  applyPageNumbersToTocItems,
  buildHeadingPageNumberMap,
  buildTocItems,
  type TextRun,
} from '@/engine/document-model';
import { getDirectoryDisplayName } from '@/services/FileService';
import { usePagination } from '@/hooks/usePagination';
import { useResolvedStyleContract } from '@/hooks/useResolvedStyleContract';
import { useAppStore } from '@/store';
import type { AiGenerationRecord } from '@/types/ai';
import type { CanvasTextSelectionState, WorkspaceDirectoryEntry } from '@/types/workspace';
import type { MeasuredTextLineBreaks } from '@/engine/typesetting';
import { CanvasPane } from './CanvasPane';
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

export function AppShell(): JSX.Element {
  const resolvedStyleContract = useResolvedStyleContract();
  const [measuredBlockHeights, setMeasuredBlockHeights] = useState<Record<string, number>>({});
  const [measuredTextLineBreaks, setMeasuredTextLineBreaks] = useState<MeasuredTextLineBreaks>({});
  usePagination(resolvedStyleContract, measuredBlockHeights, measuredTextLineBreaks);

  const [searchQuery, setSearchQuery] = useState('');
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
  const insertLayoutMarkdownBlocks = useAppStore((state) => state.insertLayoutMarkdownBlocks);
  const mergeLayoutSelectedBlocks = useAppStore((state) => state.mergeLayoutSelectedBlocks);
  const undoLayoutDocument = useAppStore((state) => state.undoLayoutDocument);
  const redoLayoutDocument = useAppStore((state) => state.redoLayoutDocument);
  const canUndoLayoutDocument = useAppStore((state) => state.documentHistoryPast.length > 0);
  const canRedoLayoutDocument = useAppStore((state) => state.documentHistoryFuture.length > 0);
  const shouldShowEditor = workspaceViewMode !== 'preview';
  const shouldShowCanvas = workspaceViewMode !== 'source';
  const displayedPageLayouts =
    parseState === 'error'
      ? pageLayouts
      : pageLayouts.length > 0
        ? pageLayouts
        : [{ pageNumber: 1, blocks: [], contract: resolvedStyleContract, warnings: [] }];
  const rawTocItems = useMemo(() => buildTocItems(layoutDocument), [layoutDocument]);
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
  const characterCount = layoutDocument?.meta.characterCount ?? 0;
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
  } = useWorkspaceFileCommands({ displayedPageLayouts, tocItems });
  const {
    handleInsertImage,
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
    shouldShowEditor && shouldShowCanvas ? 'workspace-split-mode' : 'workspace-single-mode',
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingTarget =
        !!target &&
        (target.isContentEditable ||
          !!target.closest('input, textarea, select, [contenteditable="true"]'));
      if (isEditingTarget || !(event.ctrlKey || event.metaKey)) {
        return;
      }

      const key = event.key.toLowerCase();
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
  }, [handleRedoLayoutDocument, handleUndoLayoutDocument]);

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
        onUndo={handleUndoLayoutDocument}
        onRedo={handleRedoLayoutDocument}
        onImportFont={handleImportFont}
        onInsertImage={handleInsertImage}
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
        onOpenAiPanel={() => {
          // 确保右侧面板打开，然后切换到 AI 助手 Tab
          if (!isRightPanelOpen) {
            toggleRightPanel();
          }
          setActiveRightPanelTab('AI助手');
          openAiPanel();
        }}
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
            onOpenRecentFile={handleOpenRecentFile}
            onRemoveRecentFile={handleRemoveRecentFile}
            onClearRecentFiles={handleClearRecentFiles}
            onRenameEntry={handleRenameEntry}
            onDeleteEntry={handleDeleteEntry}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
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
                {workspaceViewMode === 'source'
                  ? '聚焦导入源码快照'
                  : workspaceViewMode === 'preview'
                    ? '聚焦分页预览'
                    : '同时查看源码快照与分页'}
              </span>
            </div>
            {workspaceMessage ? <span className="workspace-message">{workspaceMessage}</span> : null}
          </div>

          <div
            className={
              shouldShowEditor && shouldShowCanvas ? 'center-panels center-panels-split' : 'center-panels'
            }
          >
            {shouldShowEditor ? (
              <EditorPane
                parseState={parseState}
                source={source}
                isCondensed={shouldShowCanvas}
              />
            ) : null}

            {shouldShowCanvas ? (
              <CanvasPane
                documentTitle={layoutDocument?.title ?? '未命名文档'}
                documentBlockCount={layoutDocument?.blocks.length ?? 0}
                documentBlocks={layoutDocument?.blocks ?? []}
                documentResources={layoutDocument?.resources ?? []}
                documentStyles={layoutDocument?.styles ?? { blockStyles: {}, textStyles: {} }}
                pageLayouts={displayedPageLayouts}
                parseError={parseError}
                parseState={parseState}
                resolvedStyleContract={resolvedStyleContract}
                headerFooterContent={styleSettings.headerFooterContent}
                selectedNodeId={selectedNodeId}
                selectedBlockIds={selectedBlockIds}
                workspaceRootPath={workspaceRootPath}
                onSelectNode={handleSelectLayoutNode}
                onSelectBlock={handleSelectLayoutBlock}
                onSelectTableCell={handleSelectLayoutTableCell}
                onClearSelection={handleClearLayoutSelection}
                onMergeSelectedBlocks={handleMergeSelectedBlocks}
                onCommitNodeText={handleCommitLayoutNodeText}
                onCommitNodeRichText={handleCommitLayoutNodeRichText}
                onTextSelectionChange={setCanvasTextSelection}
                tocItems={tocItems}
                onNavigateToNode={handleNavigateToNode}
                requestedStartEditingNodeId={requestedEditNodeId}
                onConsumeRequestedStartEditingNode={handleConsumeRequestedEditNode}
                requestedScrollToNodeId={requestedScrollToNodeId}
                onConsumeRequestedScrollToNode={handleConsumeRequestedScrollNode}
                isCondensed={shouldShowEditor}
                onMeasuredBlockHeightsChange={handleMeasuredBlockHeightsChange}
                onMeasuredTextLineBreaksChange={handleMeasuredTextLineBreaksChange}
              />
            ) : null}
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
    </div>
  );
}
