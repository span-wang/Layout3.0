import { starterMarkdown, starterMarkdownPlaceholder, starterTitle } from '@/constants/workspace';
import type { WorkspaceDirectoryEntry } from '@/types/workspace';
import {
  getBaseNameFromPath,
  getDirectoryNameFromPath,
} from '@/utils/filePath';

export interface LoadedDocument {
  title: string;
  filePath: string | null;
  source: string;
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
  | 'openFolder'
  | 'readDirectory'
  | 'createFolder'
  | 'createMarkdownFile'
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

function getDefaultFileName(title: string): string {
  return `${title || starterTitle}.md`;
}

export function createBlankDocument(): LoadedDocument {
  return {
    title: starterTitle,
    filePath: null,
    source: starterMarkdown,
  };
}

export function getBlankDocumentPlaceholder(): string {
  return starterMarkdownPlaceholder;
}

export async function openLocalDocument(): Promise<LoadedDocument> {
  const openFile = requireLayoutApiMethod('openFile');
  const result = await openFile();

  return {
    title: getBaseNameFromPath(result.filePath),
    filePath: result.filePath,
    source: result.content,
  };
}

export async function openLocalDocumentAtPath(filePath: string): Promise<LoadedDocument> {
  const openFileAtPath = requireLayoutApiMethod('openFileAtPath');
  const result = await openFileAtPath(filePath);

  return {
    title: getBaseNameFromPath(result.filePath),
    filePath: result.filePath,
    source: result.content,
  };
}

export async function saveLocalDocument(payload: {
  title: string;
  filePath: string | null;
  source: string;
}): Promise<{ title: string; filePath: string }> {
  const saveFile = requireLayoutApiMethod('saveFile');
  const result = await saveFile({
    filePath: payload.filePath,
    content: payload.source,
    defaultName: payload.filePath ? getBaseNameFromPath(payload.filePath) : getDefaultFileName(payload.title),
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

export async function createMarkdownFileInDirectory(
  directoryPath: string,
  fileName?: string,
): Promise<LoadedDocument> {
  const baseName = fileName?.trim() ? fileName.trim() : `新建文档-${Date.now()}.md`;
  const createMarkdownFile = requireLayoutApiMethod('createMarkdownFile');
  const result = await createMarkdownFile({
    directoryPath,
    fileName: baseName,
    content: starterMarkdown,
  });

  return {
    title: getBaseName(result.filePath),
    filePath: result.filePath,
    source: result.content,
  };
}

export function getDirectoryDisplayName(directoryPath: string | null): string {
  return directoryPath ? getDirectoryNameFromPath(directoryPath) : '未打开文件夹';
}

export async function saveDocumentAs(payload: {
  title: string;
  source: string;
}): Promise<{ title: string; filePath: string }> {
  const saveFile = requireLayoutApiMethod('saveFile');
  const result = await saveFile({
    filePath: null,
    content: payload.source,
    defaultName: getDefaultFileName(payload.title),
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
