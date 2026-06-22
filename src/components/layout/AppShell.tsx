import { useCallback, useEffect, useRef, useState } from 'react';
import { exportCurrentDocumentAsPdf } from '@/services/ExportService';
import { clearDraft, loadDraft, saveDraft } from '@/services/DraftService';
import {
  createBlankDocument,
  createFolderInDirectory,
  createMarkdownFileInDirectory,
  deleteEntryFromDirectory,
  getDirectoryDisplayName,
  moveEntryToDirectory,
  openDefaultWorkspace,
  openLocalDocument,
  openLocalDocumentAtPath,
  openLocalFolder,
  refreshDirectory,
  renameEntryInDirectory,
  saveDocumentAs,
  saveLocalDocument,
} from '@/services/FileService';
import {
  addRecentFile,
  clearRecentFiles,
  removeRecentFile,
  removeRecentFilesUnderPath,
  updateRecentFilePath,
  updateRecentFilePathPrefix,
} from '@/services/RecentFilesService';
import { useMarkdownParser } from '@/hooks/useMarkdownParser';
import { usePagination } from '@/hooks/usePagination';
import { starterMarkdown } from '@/constants/workspace';
import { useAppStore } from '@/store';
import type { WorkspaceDirectoryEntry } from '@/types/workspace';
import { getBaseNameFromPath, isPathWithin, replacePathPrefix } from '@/utils/filePath';
import { CanvasPane } from './CanvasPane';
import { EditorPane } from './EditorPane';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';

const DRAFT_AUTO_SAVE_DELAY = 3000;

export function AppShell(): JSX.Element {
  useMarkdownParser();
  usePagination();

  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dragSource, setDragSource] = useState<string | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = useAppStore((state) => state.title);
  const filePath = useAppStore((state) => state.filePath);
  const workspaceRootPath = useAppStore((state) => state.workspaceRootPath);
  const currentDirectoryPath = useAppStore((state) => state.currentDirectoryPath);
  const directoryEntries = useAppStore((state) => state.directoryEntries);
  const recentFiles = useAppStore((state) => state.recentlyOpenedFiles);
  const isDirty = useAppStore((state) => state.isDirty);
  const source = useAppStore((state) => state.source);
  const loadDocument = useAppStore((state) => state.loadDocument);
  const restoreDraft = useAppStore((state) => state.restoreDraft);
  const markDocumentSaved = useAppStore((state) => state.markDocumentSaved);
  const updateDocumentLocation = useAppStore((state) => state.updateDocumentLocation);
  const setCurrentDirectory = useAppStore((state) => state.setCurrentDirectory);
  const setRecentlyOpenedFiles = useAppStore((state) => state.setRecentlyOpenedFiles);
  const setSource = useAppStore((state) => state.setSource);
  const activeTab = useAppStore((state) => state.activeLeftPanelTab);
  const setActiveTab = useAppStore((state) => state.setActiveLeftPanelTab);
  const isLeftPanelOpen = useAppStore((state) => state.isLeftPanelOpen);
  const isRightPanelOpen = useAppStore((state) => state.isRightPanelOpen);
  const workspaceViewMode = useAppStore((state) => state.workspaceViewMode);
  const toggleLeftPanel = useAppStore((state) => state.toggleLeftPanel);
  const toggleRightPanel = useAppStore((state) => state.toggleRightPanel);
  const setWorkspaceViewMode = useAppStore((state) => state.setWorkspaceViewMode);
  const parseState = useAppStore((state) => state.parseState);
  const parseResult = useAppStore((state) => state.parseResult);
  const parseError = useAppStore((state) => state.parseError);
  const pageLayouts = useAppStore((state) => state.pageLayouts);
  const tocItems = parseResult?.toc ?? [];

  const shouldShowEditor = workspaceViewMode !== 'preview';
  const shouldShowCanvas = workspaceViewMode !== 'source';
  const displayedPageLayouts =
    parseState === 'error'
      ? pageLayouts
      : pageLayouts.length > 0
        ? pageLayouts
        : [{ pageNumber: 1, blocks: [] }];
  const displayedPageCount = parseState === 'error' ? 0 : displayedPageLayouts.length;
  const currentDirectoryName = getDirectoryDisplayName(currentDirectoryPath);

  const workspaceClassName = [
    'workspace',
    isLeftPanelOpen ? 'workspace-left-open' : 'workspace-left-closed',
    isRightPanelOpen ? 'workspace-right-open' : 'workspace-right-closed',
    shouldShowEditor && shouldShowCanvas ? 'workspace-split-mode' : 'workspace-single-mode',
  ].join(' ');

  const saveStatusLabel = isSaving ? '保存中' : isDirty ? '未保存' : '已保存';

  const showMessage = (msg: string) => {
    setWorkspaceMessage(msg);
  };

  const syncWorkspaceRoot = useCallback(
    async (activeFilePath: string | null) => {
      const rootPath = workspaceRootPath ?? currentDirectoryPath;
      if (!rootPath) return;
      const nextDirectory = await refreshDirectory(rootPath, activeFilePath);
      setCurrentDirectory({ ...nextDirectory, workspaceRootPath: rootPath });
    },
    [currentDirectoryPath, setCurrentDirectory, workspaceRootPath],
  );

  const shouldProceedWithDirtyDocument = useCallback((): boolean => {
    if (!isDirty) {
      return true;
    }
    return window.confirm('当前文档有未保存修改，继续操作会丢失这些更改。是否继续？');
  }, [isDirty]);

  const openDocumentFromService = useCallback(
    async (document: { title: string; filePath: string | null; source: string }) => {
      clearDraft();
      loadDocument(document);
      if (document.filePath) {
        const nextRecent = addRecentFile(document.filePath, document.title);
        setRecentlyOpenedFiles(nextRecent);
        await syncWorkspaceRoot(document.filePath);
      }
    },
    [loadDocument, setRecentlyOpenedFiles, syncWorkspaceRoot],
  );

  useEffect(() => {
    if (currentDirectoryPath) return;

    let isMounted = true;

    openDefaultWorkspace(filePath)
      .then((workspace) => {
        if (!isMounted) return;
        setCurrentDirectory({ ...workspace, workspaceRootPath: workspace.directoryPath });
      })
      .catch((error) => {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : '默认工作区加载失败';
        showMessage(`默认工作区加载失败：${message}`);
      });

    return () => {
      isMounted = false;
    };
  }, [currentDirectoryPath, filePath, setCurrentDirectory]);

  // 自动保存草稿
  useEffect(() => {
    if (!isDirty) return;

    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
    }

    draftTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(
          'layout3.draft',
          JSON.stringify({
            title,
            source,
            filePath,
            lastModified: Date.now(),
          }),
        );
      } catch {
        /* ignore quota errors */
      }
    }, DRAFT_AUTO_SAVE_DELAY);

    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
      }
    };
  }, [isDirty, title, source, filePath]);

  // 检查草稿恢复
  useEffect(() => {
    try {
      const raw = localStorage.getItem('layout3.draft');
      if (!raw) return;

      const draft = JSON.parse(raw);
      if (!draft || typeof draft.source !== 'string') return;

      const draftSource = draft.source?.trim();
      const currentSource = source?.trim() ?? '';

      if (draftSource && draftSource !== currentSource && draftSource !== '# 未命名文档\n\n') {
        const restored = window.confirm(
          `检测到未保存的草稿（${new Date(draft.lastModified).toLocaleString('zh-CN')}）。是否恢复草稿内容？`,
        );
        if (restored) {
          loadDocument({
            title: draft.title || '草稿恢复',
            filePath: null,
            source: draft.source,
          });
          showMessage('已恢复上次未保存的草稿');
        } else {
          localStorage.removeItem('layout3.draft');
        }
      }
    } catch {
      /* ignore */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateDocument = async (): Promise<void> => {
    if (!shouldProceedWithDirtyDocument()) return;

    localStorage.removeItem('layout3.draft');
    const blankDocument = createBlankDocument();
    loadDocument(blankDocument);

    if (workspaceRootPath ?? currentDirectoryPath) {
      await syncWorkspaceRoot(null);
    }

    showMessage('已新建空白文档');
  };

  const handleOpenDocument = async (): Promise<void> => {
    if (!shouldProceedWithDirtyDocument()) return;

    try {
      const nextDocument = await openLocalDocument();
      await openDocumentFromService(nextDocument);
      showMessage(`已打开：${nextDocument.title}`);
    } catch (error) {
      if (error instanceof Error && error.message === '已取消打开文件') {
        showMessage('已取消打开文件');
        return;
      }
      const message = error instanceof Error ? error.message : '打开文件失败';
      showMessage(`打开失败：${message}`);
    }
  };

  const handleSaveDocument = async (): Promise<void> => {
    if (isSaving) return;

    setIsSaving(true);
    showMessage('正在保存文档…');

    try {
      const result = await saveLocalDocument({ title, filePath, source });
      markDocumentSaved(result);
      localStorage.removeItem('layout3.draft');

      if (result.filePath) {
        const nextRecent = addRecentFile(result.filePath, result.title);
        setRecentFiles(nextRecent);
        await syncWorkspaceRoot(result.filePath);
      }

      showMessage(`文档已保存到：${result.filePath}`);
    } catch (error) {
      if (error instanceof Error && error.message === '已取消保存文件') {
        showMessage('已取消保存文件');
        return;
      }
      const message = error instanceof Error ? error.message : '保存文件失败';
      showMessage(`保存失败：${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDocumentAs = async (): Promise<void> => {
    if (isSaving) return;

    setIsSaving(true);
    showMessage('正在另存为…');

    try {
      const result = await saveDocumentAs({ title, source });
      updateDocumentLocation({ title: result.title, filePath: result.filePath });
      markDocumentSaved(result);
      localStorage.removeItem('layout3.draft');

      const nextRecent = addRecentFile(result.filePath, result.title);
      setRecentFiles(nextRecent);
      await syncWorkspaceRoot(result.filePath);

      showMessage(`文档已另存为：${result.filePath}`);
    } catch (error) {
      if (error instanceof Error && error.message === '已取消保存文件') {
        showMessage('已取消另存为');
        return;
      }
      const message = error instanceof Error ? error.message : '另存为失败';
      showMessage(`另存为失败：${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenFolder = async (): Promise<void> => {
    try {
      const nextDirectory = await openLocalFolder(filePath);
      setCurrentDirectory({ ...nextDirectory, workspaceRootPath: nextDirectory.directoryPath });
      setActiveTab('文件');
      showMessage(`已打开文件夹：${getDirectoryDisplayName(nextDirectory.directoryPath)}`);
    } catch (error) {
      if (error instanceof Error && error.message === '已取消打开文件夹') {
        showMessage('已取消打开文件夹');
        return;
      }
      const message = error instanceof Error ? error.message : '打开文件夹失败';
      showMessage(`打开文件夹失败：${message}`);
    }
  };

  const ensureWritableDirectory = async (): Promise<string | null> => {
    if (currentDirectoryPath) {
      return currentDirectoryPath;
    }

    try {
      const nextDirectory = await openDefaultWorkspace(filePath);
      setCurrentDirectory({ ...nextDirectory, workspaceRootPath: nextDirectory.directoryPath });
      setActiveTab('文件');
      showMessage(`已进入默认工作区：${getDirectoryDisplayName(nextDirectory.directoryPath)}`);
      return nextDirectory.directoryPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : '默认工作区加载失败';
      showMessage(`默认工作区加载失败：${message}`);
      return null;
    }
  };

  const handleCreateFolder = async (parentPath?: string | null): Promise<void> => {
    const targetDirectoryPath = parentPath || (await ensureWritableDirectory());
    if (!targetDirectoryPath) {
      return;
    }

    try {
      await createFolderInDirectory(targetDirectoryPath, '新建文件夹', filePath);
      await syncWorkspaceRoot(filePath);
      showMessage('已创建文件夹');
    } catch (error) {
      const message = error instanceof Error ? error.message : '新建文件夹失败';
      showMessage(`新建文件夹失败：${message}`);
    }
  };

  const handleCreateMarkdownFile = async (parentPath?: string | null): Promise<void> => {
    const targetDirectoryPath = parentPath || (await ensureWritableDirectory());
    if (!targetDirectoryPath) {
      return;
    }

    try {
      const nextDocument = await createMarkdownFileInDirectory(targetDirectoryPath, '新建文档.md');
      await openDocumentFromService(nextDocument);
      showMessage(`已创建并打开：${nextDocument.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '新建 Markdown 文件失败';
      showMessage(`新建 Markdown 文件失败：${message}`);
    }
  };

  const handleOpenEntry = async (entry: WorkspaceDirectoryEntry): Promise<void> => {
    if (entry.kind === 'directory') {
      return;
    }

    if (!shouldProceedWithDirtyDocument()) return;

    try {
      const nextDocument = await openLocalDocumentAtPath(entry.path);
      await openDocumentFromService(nextDocument);
      showMessage(`已打开：${nextDocument.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '打开文件失败';
      showMessage(`打开失败：${message}`);
    }
  };

  const handleOpenRecentFile = async (entry: { filePath: string }): Promise<void> => {
    if (!shouldProceedWithDirtyDocument()) return;

    try {
      const nextDocument = await openLocalDocumentAtPath(entry.filePath);
      await openDocumentFromService(nextDocument);
      showMessage(`已打开：${nextDocument.title}`);
    } catch {
      const nextRecent = removeRecentFile(entry.filePath);
      setRecentFiles(nextRecent);
      showMessage('文件已不存在，已从历史中移除');
    }
  };

  const handleRemoveRecentFile = (filePath: string): void => {
    const nextRecent = removeRecentFile(filePath);
    setRecentFiles(nextRecent);
    showMessage('已从历史中移除');
  };

  const handleClearRecentFiles = (): void => {
    if (!window.confirm('确定要清除所有最近打开文件的历史记录吗？')) return;
    const nextRecent = clearRecentFiles();
    setRecentFiles(nextRecent);
    showMessage('已清除历史记录');
  };

  const handleRenameEntry = async (entry: WorkspaceDirectoryEntry, nextName: string): Promise<void> => {
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === entry.name) return;

    try {
      const result = await renameEntryInDirectory(entry.path, trimmed, filePath);
      const nextActiveFilePath =
        filePath && isPathWithin(filePath, entry.path)
          ? replacePathPrefix(filePath, entry.path, result.targetPath)
          : filePath;

      if (nextActiveFilePath && nextActiveFilePath !== filePath) {
        updateDocumentLocation({
          title: getBaseNameFromPath(nextActiveFilePath),
          filePath: nextActiveFilePath,
        });
      }

      const nextRecent =
        entry.kind === 'directory'
          ? updateRecentFilePathPrefix(entry.path, result.targetPath)
          : updateRecentFilePath(entry.path, result.targetPath);
      setRecentFiles(nextRecent);

      if (nextActiveFilePath && nextActiveFilePath !== filePath) {
        setRecentFiles(addRecentFile(nextActiveFilePath, getBaseNameFromPath(nextActiveFilePath)));
      }

      await syncWorkspaceRoot(nextActiveFilePath);
      showMessage(`已重命名为：${trimmed}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '重命名失败';
      showMessage(`重命名失败：${message}`);
    }
  };

  const handleDeleteEntry = async (entry: WorkspaceDirectoryEntry): Promise<void> => {
    const confirmed = window.confirm(
      `确定要删除「${entry.name}」吗？${entry.kind === 'directory' ? '文件夹及其所有内容将被永久删除。' : '文件将被永久删除。'}此操作不可撤销。`,
    );
    if (!confirmed) return;

    try {
      const deletesActiveDocument = filePath ? isPathWithin(filePath, entry.path) : false;
      await deleteEntryFromDirectory(entry.path, deletesActiveDocument ? null : filePath);

      if (entry.kind === 'directory') {
        setRecentFiles(removeRecentFilesUnderPath(entry.path));
      } else {
        setRecentFiles(removeRecentFile(entry.path));
      }

      if (deletesActiveDocument) {
        localStorage.removeItem('layout3.draft');
        loadDocument(createBlankDocument());
      }

      await syncWorkspaceRoot(deletesActiveDocument ? null : filePath);
      showMessage(`已删除：${entry.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除失败';
      showMessage(`删除失败：${message}`);
    }
  };

  const handleMoveEntry = async (sourcePath: string, destinationPath: string): Promise<void> => {
    if (sourcePath === destinationPath) return;

    try {
      const result = await moveEntryToDirectory(sourcePath, destinationPath, filePath);
      const nextActiveFilePath =
        filePath && isPathWithin(filePath, sourcePath)
          ? replacePathPrefix(filePath, sourcePath, result.movedPath)
          : filePath;

      setRecentFiles(updateRecentFilePathPrefix(sourcePath, result.movedPath));

      if (nextActiveFilePath && nextActiveFilePath !== filePath) {
        const nextTitle = getBaseNameFromPath(nextActiveFilePath);
        updateDocumentLocation({ title: nextTitle, filePath: nextActiveFilePath });
        setRecentFiles(addRecentFile(nextActiveFilePath, nextTitle));
      }

      await syncWorkspaceRoot(nextActiveFilePath);
      showMessage('文件已移动');
    } catch (error) {
      if (error instanceof Error && error.message.includes('不能将项目移动')) {
        showMessage('不能将项目移动到自身或子级目录');
        return;
      }
      const message = error instanceof Error ? error.message : '移动失败';
      showMessage(`移动失败：${message}`);
    }
  };

  const handleExportPdf = async (): Promise<void> => {
    if (!parseResult || isExporting || displayedPageLayouts.length === 0) return;

    const documentTitle = tocItems[0]?.text || '未命名文档';
    setIsExporting(true);
    showMessage('正在导出 PDF…');

    try {
      const exportedPath = await exportCurrentDocumentAsPdf({
        pages: displayedPageLayouts,
        title: documentTitle,
      });
      showMessage(`PDF 已导出到：${exportedPath}`);
    } catch (error) {
      if (error instanceof Error && error.message === '已取消导出 PDF') {
        showMessage('已取消导出 PDF');
        return;
      }
      const message = error instanceof Error ? error.message : '导出 PDF 失败';
      showMessage(`导出失败：${message}`);
    } finally {
      setIsExporting(false);
    }
  };

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

  return (
    <div className="app-shell">
      <Toolbar
        isLeftPanelOpen={isLeftPanelOpen}
        isRightPanelOpen={isRightPanelOpen}
        workspaceViewMode={workspaceViewMode}
        isSaving={isSaving}
        isExporting={isExporting}
        onCreateDocument={handleCreateDocument}
        onOpenDocument={handleOpenDocument}
        onOpenFolder={handleOpenFolder}
        onSaveDocument={handleSaveDocument}
        onSaveDocumentAs={handleSaveDocumentAs}
        onExportPdf={handleExportPdf}
        onToggleLeftPanel={toggleLeftPanel}
        onToggleRightPanel={toggleRightPanel}
        onChangeViewMode={setWorkspaceViewMode}
      />

      <main className={workspaceClassName}>
        {isLeftPanelOpen ? (
          <LeftPanel
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tocItems={tocItems}
            currentFilePath={filePath ?? currentDirectoryPath}
            currentDirectoryName={currentDirectoryName}
            directoryEntries={directoryEntries}
            recentFiles={recentFiles}
            onOpenFolder={handleOpenFolder}
            onCreateFolder={handleCreateFolder}
            onCreateMarkdownFile={handleCreateMarkdownFile}
            onOpenEntry={handleOpenEntry}
            onOpenRecentFile={handleOpenRecentFile}
            onRemoveRecentFile={handleRemoveRecentFile}
            onClearRecentFiles={handleClearRecentFiles}
            onRenameEntry={handleRenameEntry}
            onDeleteEntry={handleDeleteEntry}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
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
                  ? '聚焦源码输入'
                  : workspaceViewMode === 'preview'
                    ? '聚焦分页预览'
                    : '同时查看源码与分页'}
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
                onSourceChange={setSource}
                isCondensed={shouldShowCanvas}
              />
            ) : null}

            {shouldShowCanvas ? (
              <CanvasPane
                blocks={parseResult?.blocks ?? []}
                pageLayouts={displayedPageLayouts}
                parseError={parseError}
                parseState={parseState}
                isCondensed={shouldShowEditor}
              />
            ) : null}
          </div>
        </section>

        {isRightPanelOpen ? (
          <RightPanel
            currentPageCount={displayedPageCount}
            headingCount={tocItems.length}
            sourceLength={source.length}
            workspaceViewMode={workspaceViewMode}
          />
        ) : null}
      </main>

      <StatusBar
        parseState={parseState}
        sourceLength={source.length}
        pageCount={displayedPageCount}
        workspaceViewMode={workspaceViewMode}
        saveStatusLabel={saveStatusLabel}
      />
    </div>
  );
}
