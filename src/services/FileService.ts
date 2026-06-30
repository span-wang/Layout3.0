import { starterMarkdown, starterMarkdownPlaceholder, starterTitle } from '@/constants/workspace';
import {
  createEmptyLayoutDocument,
  createLayoutDocumentFromMarkdown,
  autoFitTablesInLayoutDocument,
  parseLayoutProjectFile,
  serializeLayoutProjectFile,
  createFontResourceFromImportedFile,
  type DocumentFormat,
  type LayoutFontResource,
  type LayoutDocument,
} from '@/engine/document-model';
import { createFontResourceFromImportedFile as createFontResourceFromImportedFileOrigin } from '@/engine/document-model/fontResources';

// 重新导出，保持 FileService 导出接口的完整性
export { createFontResourceFromImportedFileOrigin as createFontResourceFromImportedFile };
import { defaultStyleSettings } from '@/engine/style/presets';
import { cloneStyleSettings } from '@/engine/style/styleSettings';
import type { StyleSettings } from '@/engine/style/types';
import type { WorkspaceDirectoryEntry } from '@/types/workspace';
import {
  getBaseNameFromPath,
  getDirectoryNameFromPath,
  getDocumentFormatFromPath,
} from '@/utils/filePath';

export interface LoadedDocument {
  title: string;
  filePath: string | null;
  source: string;
  documentFormat: DocumentFormat;
  layoutDocument: LayoutDocument;
  styleSettings?: StyleSettings;
}

interface DirectoryResult {
  directoryPath: string;
  directoryEntries: WorkspaceDirectoryEntry[];
}

interface LayoutDirectoryEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: LayoutDirectoryEntry[];
}

type LayoutApiMethodName =
  | 'getDefaultWorkspace'
  | 'openFile'
  | 'openFileAtPath'
  | 'selectImageFile'
  | 'importFontFile'
  | 'importFontToWorkspace'
  | 'openFolder'
  | 'readDirectory'
  | 'createFolder'
  | 'createLayoutFile'
  | 'saveFile'
  | 'renameEntry'
  | 'moveEntry'
  | 'deleteEntry';

function requireLayoutApiMethod<T extends LayoutApiMethodName>(methodName: T) {
  const method = window.layoutAPI?.[methodName];

  if (typeof method !== 'function') {
    throw new Error('当前窗口尚未加载最新桌面接口，请重启应用后重试');
  }

  return method;
}

function mapDirectoryEntries(entries: LayoutDirectoryEntry[], activeFilePath?: string | null): WorkspaceDirectoryEntry[] {
  return entries.map((entry) => ({
    id: entry.path,
    name: entry.name,
    path: entry.path,
    kind: entry.kind,
    isActive: entry.path === activeFilePath,
    children: entry.children ? mapDirectoryEntries(entry.children, activeFilePath) : undefined,
  }));
}

function getDefaultFileName(title: string, format: DocumentFormat): string {
  return `${title || starterTitle}${format === 'layout' ? '.layout' : '.md'}`;
}

export function createBlankDocument(): LoadedDocument {
  const layoutDocument = createEmptyLayoutDocument({
    title: starterTitle,
    source: starterMarkdown,
  });

  return {
    title: starterTitle,
    filePath: null,
    source: starterMarkdown,
    documentFormat: 'layout',
    layoutDocument,
    styleSettings: cloneStyleSettings(defaultStyleSettings),
  };
}

export function getBlankDocumentPlaceholder(): string {
  return starterMarkdownPlaceholder;
}

async function mapOpenedDocument(result: { filePath: string; content: string }): Promise<LoadedDocument> {
  const documentFormat = getDocumentFormatFromPath(result.filePath);

  if (documentFormat === 'layout') {
    const parsed = parseLayoutProjectFile(result.content);
    return {
      title: getBaseNameFromPath(result.filePath),
      filePath: result.filePath,
      source: parsed.document.source,
      documentFormat,
      layoutDocument: parsed.document,
      styleSettings: parsed.styleSettings,
    };
  }

  const parsedDocument = await createLayoutDocumentFromMarkdown(result.content);
  const autoFitResult = autoFitTablesInLayoutDocument(parsedDocument, defaultStyleSettings, {
    preserveSavedSize: true,
  });
  const layoutDocument = autoFitResult.document;

  return {
    title: getBaseNameFromPath(result.filePath),
    filePath: result.filePath,
    source: result.content,
    documentFormat,
    layoutDocument,
  };
}

export async function openLocalDocument(): Promise<LoadedDocument> {
  const openFile = requireLayoutApiMethod('openFile');
  const result = await openFile();
  return await mapOpenedDocument(result);
}

export async function openLocalDocumentAtPath(filePath: string): Promise<LoadedDocument> {
  const openFileAtPath = requireLayoutApiMethod('openFileAtPath');
  const result = await openFileAtPath(filePath);
  return await mapOpenedDocument(result);
}

export async function selectLocalImageFile(): Promise<string> {
  const selectImageFile = requireLayoutApiMethod('selectImageFile');
  const result = await selectImageFile();
  return result.filePath;
}

export async function importLocalFontFile(): Promise<LayoutFontResource> {
  const importFontFile = requireLayoutApiMethod('importFontFile');
  const result = await importFontFile();
  return createFontResourceFromImportedFile(result);
}

export interface WorkspaceFontImportResult {
  relativePath: string;
  fileName: string;
}

export async function importFontToWorkspace(
  workspaceRootPath: string,
): Promise<WorkspaceFontImportResult> {
  const importFontToWorkspaceApi = requireLayoutApiMethod('importFontToWorkspace');
  const result = await importFontToWorkspaceApi({ workspaceRootPath, relativeFontPath: '.fonts' });
  return {
    relativePath: result.filePath,
    fileName: result.fileName,
  };
}

async function resolveLayoutDocumentForSave(payload: {
  source: string;
  layoutDocument: LayoutDocument;
}): Promise<LayoutDocument> {
  return {
    ...payload.layoutDocument,
    source: payload.source,
    meta: {
      ...payload.layoutDocument.meta,
      updatedAt: new Date().toISOString(),
    },
  };
}

async function buildSaveContent(payload: {
  source: string;
  layoutDocument: LayoutDocument;
  styleSettings: StyleSettings;
}): Promise<string> {
  const layoutDocument = await resolveLayoutDocumentForSave(payload);
  return serializeLayoutProjectFile({
    document: layoutDocument,
    styleSettings: payload.styleSettings,
  });
}

export async function saveLocalDocument(payload: {
  title: string;
  filePath: string | null;
  source: string;
  layoutDocument: LayoutDocument;
  styleSettings: StyleSettings;
}): Promise<{ title: string; filePath: string }> {
  const saveFile = requireLayoutApiMethod('saveFile');
  const content = await buildSaveContent({
    source: payload.source,
    layoutDocument: payload.layoutDocument,
    styleSettings: payload.styleSettings,
  });
  const shouldOverwriteCurrentFile =
    payload.filePath !== null && getDocumentFormatFromPath(payload.filePath) === 'layout';
  const targetFilePath = shouldOverwriteCurrentFile ? payload.filePath : null;
  const result = await saveFile({
    filePath: targetFilePath,
    content,
    defaultName: getDefaultFileName(payload.title, 'layout'),
  });

  return {
    title: getBaseNameFromPath(result.filePath),
    filePath: result.filePath,
  };
}

export async function openLocalFolder(activeFilePath?: string | null): Promise<DirectoryResult> {
  const openFolder = requireLayoutApiMethod('openFolder');
  const result = await openFolder();

  return {
    directoryPath: result.directoryPath,
    directoryEntries: mapDirectoryEntries(result.entries, activeFilePath),
  };
}

export async function openDefaultWorkspace(activeFilePath?: string | null): Promise<DirectoryResult> {
  const getDefaultWorkspace = requireLayoutApiMethod('getDefaultWorkspace');
  const result = await getDefaultWorkspace();

  return {
    directoryPath: result.directoryPath,
    directoryEntries: mapDirectoryEntries(result.entries, activeFilePath),
  };
}

export async function refreshDirectory(
  directoryPath: string,
  activeFilePath?: string | null,
): Promise<DirectoryResult> {
  const readDirectory = requireLayoutApiMethod('readDirectory');
  const result = await readDirectory(directoryPath);

  return {
    directoryPath: result.directoryPath,
    directoryEntries: mapDirectoryEntries(result.entries, activeFilePath),
  };
}

export async function createFolderInDirectory(
  parentPath: string,
  folderName?: string,
  activeFilePath?: string | null,
): Promise<DirectoryResult & { targetPath: string }> {
  const baseName = folderName?.trim() ? folderName.trim() : `新建文件夹-${Date.now()}`;
  const createFolder = requireLayoutApiMethod('createFolder');
  const result = await createFolder({
    parentPath,
    folderName: baseName,
  });

  return {
    directoryPath: result.directoryPath,
    directoryEntries: mapDirectoryEntries(result.entries, activeFilePath),
    targetPath: result.targetPath,
  };
}

export async function createLayoutFileInDirectory(
  directoryPath: string,
  fileName?: string,
): Promise<LoadedDocument> {
  const baseName = fileName?.trim() ? fileName.trim() : `新建文档-${Date.now()}.layout`;
  const createLayoutFile = requireLayoutApiMethod('createLayoutFile');
  const blankDocument = createBlankDocument();
  const content = serializeLayoutProjectFile({
    document: blankDocument.layoutDocument,
    styleSettings: blankDocument.styleSettings ?? cloneStyleSettings(defaultStyleSettings),
  });
  const result = await createLayoutFile({
    directoryPath,
    fileName: baseName,
    content,
  });

  return await mapOpenedDocument(result);
}

export function getDirectoryDisplayName(directoryPath: string | null): string {
  return directoryPath ? getDirectoryNameFromPath(directoryPath) : '未打开文件夹';
}

export async function saveDocumentAs(payload: {
  title: string;
  source: string;
  filePath?: string | null;
  layoutDocument: LayoutDocument;
  styleSettings: StyleSettings;
}): Promise<{ title: string; filePath: string }> {
  const saveFile = requireLayoutApiMethod('saveFile');
  const content = await buildSaveContent({
    source: payload.source,
    layoutDocument: payload.layoutDocument,
    styleSettings: payload.styleSettings,
  });
  const result = await saveFile({
    filePath: null,
    content,
    defaultName: getDefaultFileName(payload.title, 'layout'),
  });

  return {
    title: getBaseNameFromPath(result.filePath),
    filePath: result.filePath,
  };
}

export async function renameEntryInDirectory(
  targetPath: string,
  nextName: string,
  activeFilePath?: string | null,
): Promise<{
  directoryPath: string;
  directoryEntries: WorkspaceDirectoryEntry[];
  targetPath: string;
}> {
  const renameEntry = requireLayoutApiMethod('renameEntry');
  const result = await renameEntry({ targetPath, nextName });

  return {
    directoryPath: result.directoryPath,
    directoryEntries: mapDirectoryEntries(result.entries, activeFilePath),
    targetPath: result.targetPath,
  };
}

export async function moveEntryToDirectory(
  sourcePath: string,
  destinationDirectoryPath: string,
  activeFilePath?: string | null,
): Promise<{
  directoryPath: string;
  directoryEntries: WorkspaceDirectoryEntry[];
  movedPath: string;
}> {
  const moveEntry = requireLayoutApiMethod('moveEntry');
  const result = await moveEntry({ sourcePath, destinationDirectoryPath });

  return {
    directoryPath: result.directoryPath,
    directoryEntries: mapDirectoryEntries(result.entries, activeFilePath),
    movedPath: result.movedPath,
  };
}

export async function deleteEntryFromDirectory(
  targetPath: string,
  activeFilePath?: string | null,
): Promise<{
  directoryPath: string;
  directoryEntries: WorkspaceDirectoryEntry[];
}> {
  const deleteEntry = requireLayoutApiMethod('deleteEntry');
  const result = await deleteEntry({ targetPath });

  return {
    directoryPath: result.directoryPath,
    directoryEntries: mapDirectoryEntries(result.entries, activeFilePath),
  };
}
