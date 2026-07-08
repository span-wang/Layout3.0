import { useCallback, useEffect, useRef, useState } from 'react';
import { exportCurrentDocumentAsDocx, exportCurrentDocumentAsPdf } from '@/services/ExportService';
import {
  buildExportCheckConfirmMessage,
  getExportCheckItemsForTarget,
  type ExportCheckResult,
} from '@/services/ExportCheckService';
import { clearDraft, loadDraft, saveDraft } from '@/services/DraftService';
import {
  createBlankDocument,
  createFolderInDirectory,
  createLayoutFileInDirectory,
  createFontResourceFromImportedFile,
  deleteEntryFromDirectory,
  getDirectoryDisplayName,
  importFontToWorkspace,
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
  addFontToWorkspaceLibrary,
  mergeWorkspaceFontLibraryIntoResources,
} from '@/services/FontLibraryService';
import {
  addRecentFile,
  clearRecentFiles,
  removeRecentFile,
  removeRecentFilesUnderPath,
  updateRecentFilePath,
  updateRecentFilePathPrefix,
} from '@/services/RecentFilesService';
import { useAppStore } from '@/store';
import { getRenderableLayoutBlocksForView, type LayoutDocument, type TocItem } from '@/engine/document-model';
import type { PageLayout } from '@/engine/typesetting/types';
import type { RecentFileEntry, WorkspaceDirectoryEntry } from '@/types/workspace';
import { getBaseNameFromPath, isOpenableDocumentPath, isPathWithin, replacePathPrefix } from '@/utils/filePath';

const DRAFT_AUTO_SAVE_DELAY = 3000;

interface UseWorkspaceFileCommandsPayload {
  displayedPageLayouts: PageLayout[];
  tocItems: TocItem[];
  exportCheckResult: ExportCheckResult;
  onOpenExportCheckPanel: () => void;
}

interface WorkspaceFileCommands {
  isSaving: boolean;
  isExporting: boolean;
  workspaceMessage: string | null;
  showMessage: (msg: string) => void;
  handleCreateDocument: () => Promise<void>;
  handleOpenDocument: () => Promise<void>;
  handleSaveDocument: () => Promise<void>;
  handleSaveDocumentAs: () => Promise<void>;
  handleOpenFolder: () => Promise<void>;
  handleCreateFolder: (parentPath?: string | null) => Promise<void>;
  handleCreateLayoutFile: (parentPath?: string | null) => Promise<void>;
  handleOpenEntry: (entry: WorkspaceDirectoryEntry) => Promise<void>;
  handleOpenRecentFile: (entry: RecentFileEntry) => Promise<void>;
  handleRemoveRecentFile: (filePath: string) => void;
  handleClearRecentFiles: () => void;
  handleRenameEntry: (entry: WorkspaceDirectoryEntry, nextName: string) => Promise<void>;
  handleDeleteEntry: (entry: WorkspaceDirectoryEntry) => Promise<void>;
  handleMoveEntry: (sourcePath: string, destinationPath: string) => Promise<void>;
  handleImportFont: () => Promise<void>;
  handleExportPdf: () => Promise<void>;
  handleExportDocx: () => Promise<void>;
}

export function useWorkspaceFileCommands({
  displayedPageLayouts,
  tocItems,
  exportCheckResult,
  onOpenExportCheckPanel,
}: UseWorkspaceFileCommandsPayload): WorkspaceFileCommands {
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = useAppStore((state) => state.title);
  const filePath = useAppStore((state) => state.filePath);
  const workspaceRootPath = useAppStore((state) => state.workspaceRootPath);
  const currentDirectoryPath = useAppStore((state) => state.currentDirectoryPath);
  const isDirty = useAppStore((state) => state.isDirty);
  const source = useAppStore((state) => state.source);
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const styleSettings = useAppStore((state) => state.styleSettings);
  const loadDocument = useAppStore((state) => state.loadDocument);
  const restoreDraft = useAppStore((state) => state.restoreDraft);
  const markDocumentSaved = useAppStore((state) => state.markDocumentSaved);
  const updateDocumentLocation = useAppStore((state) => state.updateDocumentLocation);
  const setCurrentDirectory = useAppStore((state) => state.setCurrentDirectory);
  const setRecentlyOpenedFiles = useAppStore((state) => state.setRecentlyOpenedFiles);
  const setActiveTab = useAppStore((state) => state.setActiveLeftPanelTab);
  const resetStyleSettings = useAppStore((state) => state.resetStyleSettings);
  const replaceStyleSettings = useAppStore((state) => state.replaceStyleSettings);
  const importLayoutFontResource = useAppStore((state) => state.importLayoutFontResource);

  const showMessage = useCallback((msg: string) => {
    setWorkspaceMessage(msg);
  }, []);

  const mergeWorkspaceFontsIntoDocument = useCallback(
    (document: LayoutDocument): LayoutDocument => {
      const targetWorkspace = workspaceRootPath ?? currentDirectoryPath;
      const nextResources = mergeWorkspaceFontLibraryIntoResources(document.resources, targetWorkspace);

      if (nextResources === document.resources) {
        return document;
      }

      // 工作区字体是跨文档可用资产；载入文档时补进 resources，顶端工具栏和 @font-face 才能一起拿到。
      return {
        ...document,
        resources: nextResources,
      };
    },
    [currentDirectoryPath, workspaceRootPath],
  );

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
    async (document: Awaited<ReturnType<typeof openLocalDocument>>) => {
      clearDraft();
      if (document.styleSettings) {
        replaceStyleSettings(document.styleSettings);
      } else {
        resetStyleSettings();
      }

      const nextDocument = {
        ...document,
        layoutDocument: mergeWorkspaceFontsIntoDocument(document.layoutDocument),
      };

      loadDocument(nextDocument);
      const openedFilePath = nextDocument.filePath;
      if (openedFilePath) {
        const nextRecent = addRecentFile(openedFilePath, nextDocument.title);
        setRecentlyOpenedFiles(nextRecent);
        await syncWorkspaceRoot(openedFilePath);
      }
    },
    [loadDocument, mergeWorkspaceFontsIntoDocument, replaceStyleSettings, resetStyleSettings, setRecentlyOpenedFiles, syncWorkspaceRoot],
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
  }, [currentDirectoryPath, filePath, setCurrentDirectory, showMessage]);

  // 文件流 hook 统一负责草稿写入，AppShell 只关心是否显示“未保存”。
  useEffect(() => {
    if (!isDirty || !layoutDocument) return;

    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }

    draftTimerRef.current = setTimeout(() => {
      saveDraft({
        title,
        source,
        layoutDocument,
        styleSettings,
        filePath,
        lastModified: Date.now(),
      });
    }, DRAFT_AUTO_SAVE_DELAY);

    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [filePath, isDirty, layoutDocument, source, styleSettings, title]);

  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;

    const restored = window.confirm(
      `检测到未保存的草稿（${new Date(draft.lastModified).toLocaleString('zh-CN')}）。是否恢复草稿内容？`,
    );
    if (restored) {
      // 恢复草稿时同时恢复结构化模型与页面设置，避免只恢复旧源码快照。
      replaceStyleSettings(draft.styleSettings);
      restoreDraft({
        title: draft.title || '草稿恢复',
        source: draft.source,
        filePath: draft.filePath,
        layoutDocument: draft.layoutDocument,
      });
      showMessage('已恢复上次未保存的草稿');
      return;
    }

    clearDraft();
  }, [replaceStyleSettings, restoreDraft, showMessage]);

  const handleCreateDocument = async (): Promise<void> => {
    if (!shouldProceedWithDirtyDocument()) return;

    clearDraft();
    const blankDocument = createBlankDocument();
    resetStyleSettings();
    loadDocument({
      ...blankDocument,
      layoutDocument: mergeWorkspaceFontsIntoDocument(blankDocument.layoutDocument),
    });

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
      const result = await saveLocalDocument({
        title,
        filePath,
        source,
        layoutDocument: layoutDocument ?? createBlankDocument().layoutDocument,
        styleSettings,
      });
      markDocumentSaved(result);
      clearDraft();

      if (result.filePath) {
        const nextRecent = addRecentFile(result.filePath, result.title);
        setRecentlyOpenedFiles(nextRecent);
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
      const result = await saveDocumentAs({
        title,
        source,
        filePath,
        layoutDocument: layoutDocument ?? createBlankDocument().layoutDocument,
        styleSettings,
      });
      updateDocumentLocation({ title: result.title, filePath: result.filePath });
      markDocumentSaved(result);
      clearDraft();

      const nextRecent = addRecentFile(result.filePath, result.title);
      setRecentlyOpenedFiles(nextRecent);
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

  const handleCreateLayoutFile = async (parentPath?: string | null): Promise<void> => {
    const targetDirectoryPath = parentPath || (await ensureWritableDirectory());
    if (!targetDirectoryPath) {
      return;
    }

    try {
      const nextDocument = await createLayoutFileInDirectory(targetDirectoryPath, '新建文档.layout');
      await openDocumentFromService(nextDocument);
      showMessage(`已创建并打开：${nextDocument.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '新建 layout 文档失败';
      showMessage(`新建 layout 文档失败：${message}`);
    }
  };

  const handleOpenEntry = async (entry: WorkspaceDirectoryEntry): Promise<void> => {
    if (entry.kind === 'directory') {
      return;
    }

    if (!isOpenableDocumentPath(entry.path)) {
      showMessage('该资源文件暂不能作为文档打开');
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

  const handleOpenRecentFile = async (entry: RecentFileEntry): Promise<void> => {
    if (!shouldProceedWithDirtyDocument()) return;

    try {
      const nextDocument = await openLocalDocumentAtPath(entry.filePath);
      await openDocumentFromService(nextDocument);
      showMessage(`已打开：${nextDocument.title}`);
    } catch {
      const nextRecent = removeRecentFile(entry.filePath);
      setRecentlyOpenedFiles(nextRecent);
      showMessage('文件已不存在，已从历史中移除');
    }
  };

  const handleRemoveRecentFile = (nextFilePath: string): void => {
    const nextRecent = removeRecentFile(nextFilePath);
    setRecentlyOpenedFiles(nextRecent);
    showMessage('已从历史中移除');
  };

  const handleClearRecentFiles = (): void => {
    if (!window.confirm('确定要清除所有最近打开文件的历史记录吗？')) return;
    const nextRecent = clearRecentFiles();
    setRecentlyOpenedFiles(nextRecent);
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
      setRecentlyOpenedFiles(nextRecent);

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
        setRecentlyOpenedFiles(removeRecentFilesUnderPath(entry.path));
      } else {
        setRecentlyOpenedFiles(removeRecentFile(entry.path));
      }

      if (deletesActiveDocument) {
        clearDraft();
        resetStyleSettings();
        const blankDocument = createBlankDocument();
        loadDocument({
          ...blankDocument,
          layoutDocument: mergeWorkspaceFontsIntoDocument(blankDocument.layoutDocument),
        });
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

      setRecentlyOpenedFiles(updateRecentFilePathPrefix(sourcePath, result.movedPath));

      if (nextActiveFilePath && nextActiveFilePath !== filePath) {
        const nextTitle = getBaseNameFromPath(nextActiveFilePath);
        updateDocumentLocation({ title: nextTitle, filePath: nextActiveFilePath });
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

  const handleImportFont = async (): Promise<void> => {
    if (!layoutDocument) {
      showMessage('当前没有可写入字体资源的文档');
      return;
    }

    try {
      const targetWorkspace = workspaceRootPath ?? currentDirectoryPath;
      if (!targetWorkspace) {
        showMessage('请先打开或创建文档');
        return;
      }

      // 使用新的工作区字体导入流程
      const { relativePath, fileName } = await importFontToWorkspace(targetWorkspace);

      // 基于返回的相对路径创建字体资源元数据
      const fontResource = createFontResourceFromImportedFile({
        filePath: relativePath,
        fileName,
      });

      // 写入工作区字体库（localStorage），持久化
      const workspaceFonts = addFontToWorkspaceLibrary(targetWorkspace, fontResource);

      // 写入当前文档的 resources
      importLayoutFontResource(fontResource);

      await syncWorkspaceRoot(filePath);

      const fontCount = workspaceFonts.length;
      showMessage(
        fontCount > 1
          ? `已导入字体：${fontResource.displayName}（工作区共有 ${fontCount} 个字体）`
          : `已导入字体：${fontResource.displayName}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message === '已取消导入字体') {
        showMessage('已取消导入字体');
        return;
      }
      const message = error instanceof Error ? error.message : '导入字体失败';
      showMessage(`导入字体失败：${message}`);
    }
  };

  const handleExportPdf = async (): Promise<void> => {
    if (!layoutDocument || isExporting || displayedPageLayouts.length === 0) return;

    const documentTitle = layoutDocument.title || tocItems[0]?.text || '未命名文档';
    const pdfCheckItems = getExportCheckItemsForTarget(exportCheckResult, 'pdf');
    const pdfConfirmMessage = buildExportCheckConfirmMessage(exportCheckResult, 'pdf');
    if (pdfConfirmMessage) {
      onOpenExportCheckPanel();
      const shouldContinue = window.confirm(pdfConfirmMessage);
      if (!shouldContinue) {
        showMessage(
          pdfCheckItems.length > 0 ? '已取消导出 PDF，请先处理右侧“导出检查”中的提示' : '已取消导出 PDF',
        );
        return;
      }
    }

    setIsExporting(true);
    showMessage('正在导出 PDF…');

    try {
      const exportedPath = await exportCurrentDocumentAsPdf({
        pages: displayedPageLayouts,
        title: documentTitle,
        resources: layoutDocument.resources,
        styles: layoutDocument.styles,
        styleSettings,
        semanticRoleConfig: layoutDocument.meta.semanticRoleConfig,
        answerDisplayMode: layoutDocument.viewState.answerDisplayMode,
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

  const handleExportDocx = async (): Promise<void> => {
    if (!layoutDocument || isExporting || displayedPageLayouts.length === 0) return;

    const documentTitle = layoutDocument.title || tocItems[0]?.text || '未命名文档';
    const docxCheckItems = getExportCheckItemsForTarget(exportCheckResult, 'docx');
    const docxConfirmMessage = buildExportCheckConfirmMessage(exportCheckResult, 'docx');
    if (docxConfirmMessage) {
      onOpenExportCheckPanel();
      const shouldContinue = window.confirm(docxConfirmMessage);
      if (!shouldContinue) {
        showMessage(
          docxCheckItems.length > 0 ? '已取消导出 DOCX，请先处理右侧“导出检查”中的提示' : '已取消导出 DOCX',
        );
        return;
      }
    }

    setIsExporting(true);
    showMessage('正在导出 DOCX…');

    try {
      const exportedPath = await exportCurrentDocumentAsDocx({
        pages: displayedPageLayouts,
        blocks: getRenderableLayoutBlocksForView(layoutDocument),
        title: documentTitle,
        resources: layoutDocument.resources,
        styles: layoutDocument.styles,
        styleSettings,
        documentFilePath: filePath,
        workspaceRootPath,
        answerDisplayMode: layoutDocument.viewState.answerDisplayMode,
      });
      showMessage(`DOCX 已导出到：${exportedPath}`);
    } catch (error) {
      if (error instanceof Error && error.message === '已取消导出 DOCX') {
        showMessage('已取消导出 DOCX');
        return;
      }
      const message = error instanceof Error ? error.message : '导出 DOCX 失败';
      showMessage(`导出失败：${message}`);
    } finally {
      setIsExporting(false);
    }
  };

  return {
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
  };
}
