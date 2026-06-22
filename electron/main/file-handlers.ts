import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, app, dialog } from 'electron';
import { isPathWithin, isVisibleWorkspaceFilePath } from '../../src/utils/filePath';

export interface OpenDocumentResult {
  filePath: string;
  content: string;
}

export interface SaveDocumentPayload {
  filePath: string | null;
  content: string;
  defaultName: string;
}

export interface DirectoryEntryResult {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: DirectoryEntryResult[];
}

export interface OpenFolderResult {
  directoryPath: string;
  entries: DirectoryEntryResult[];
}

export interface CreateFolderResult extends OpenFolderResult {
  targetPath: string;
}

export interface CreateFolderPayload {
  parentPath: string;
  folderName: string;
}

export interface CreateMarkdownFilePayload {
  directoryPath: string;
  fileName: string;
  content: string;
}

export interface RenameEntryPayload {
  targetPath: string;
  nextName: string;
}

export interface MoveEntryPayload {
  sourcePath: string;
  destinationDirectoryPath: string;
}

export interface DeleteEntryPayload {
  targetPath: string;
}

function getOwnerWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined;
}

function getFileFilters() {
  return [
    { name: 'Layout 工程与 Markdown', extensions: ['layout', 'md'] },
    { name: 'Layout 工程文件', extensions: ['layout'] },
    { name: 'Markdown 文档', extensions: ['md'] },
  ];
}

function sanitizeDefaultName(fileName: string): string {
  const sanitized = fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').trim();
  return sanitized || '未命名文档.md';
}

function sanitizeSegmentName(name: string, fallback: string): string {
  const sanitized = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').trim();
  return sanitized || fallback;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getUniqueEntryPath(parentPath: string, preferredName: string): Promise<string> {
  const extension = path.extname(preferredName);
  const baseName = extension ? preferredName.slice(0, -extension.length) : preferredName;
  let candidatePath = path.join(parentPath, preferredName);
  let index = 1;

  while (await pathExists(candidatePath)) {
    const candidateName = extension ? `${baseName} ${index}${extension}` : `${baseName} ${index}`;
    candidatePath = path.join(parentPath, candidateName);
    index += 1;
  }

  return candidatePath;
}

function getDefaultWorkspacePath(): string {
  return path.join(app.getPath('documents'), 'LAYOUT3.0', '默认工作区');
}

async function listDirectoryEntries(directoryPath: string): Promise<DirectoryEntryResult[]> {
  const names = await readdir(directoryPath);
  const entries = await Promise.all(
    names.map(async (name) => {
      const entryPath = path.join(directoryPath, name);
      const entryStat = await stat(entryPath);

      if (entryStat.isDirectory()) {
        return {
          name,
          path: entryPath,
          kind: 'directory' as const,
          children: await listDirectoryEntries(entryPath),
        };
      }

      if (!isVisibleWorkspaceFilePath(entryPath)) {
        return null;
      }

      return {
        name,
        path: entryPath,
        kind: 'file' as const,
      };
    }),
  );

  const visibleEntries: DirectoryEntryResult[] = [];
  for (const entry of entries) {
    if (entry !== null) {
      visibleEntries.push(entry as DirectoryEntryResult);
    }
  }

  return visibleEntries.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'zh-CN');
  });
}

export async function openDocument(): Promise<OpenDocumentResult> {
  const ownerWindow = getOwnerWindow();
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, {
        title: '打开文档',
        properties: ['openFile'],
        filters: getFileFilters(),
      })
    : await dialog.showOpenDialog({
        title: '打开文档',
        properties: ['openFile'],
        filters: getFileFilters(),
      });

  if (result.canceled || result.filePaths.length === 0) {
    throw new Error('已取消打开文件');
  }

  const [filePath] = result.filePaths;
  const content = await readFile(filePath, 'utf8');

  return {
    filePath,
    content,
  };
}

export async function openDocumentAtPath(filePath: string): Promise<OpenDocumentResult> {
  const content = await readFile(filePath, 'utf8');

  return {
    filePath,
    content,
  };
}

export async function openFolder(): Promise<OpenFolderResult> {
  const ownerWindow = getOwnerWindow();
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, {
        title: '打开文件夹',
        properties: ['openDirectory'],
      })
    : await dialog.showOpenDialog({
        title: '打开文件夹',
        properties: ['openDirectory'],
      });

  if (result.canceled || result.filePaths.length === 0) {
    throw new Error('已取消打开文件夹');
  }

  const [directoryPath] = result.filePaths;
  const entries = await listDirectoryEntries(directoryPath);

  return {
    directoryPath,
    entries,
  };
}

export async function getDefaultWorkspace(): Promise<OpenFolderResult> {
  const directoryPath = getDefaultWorkspacePath();
  await mkdir(directoryPath, { recursive: true });

  return {
    directoryPath,
    entries: await listDirectoryEntries(directoryPath),
  };
}

export async function saveDocument({
  filePath,
  content,
  defaultName,
}: SaveDocumentPayload): Promise<{ filePath: string }> {
  let targetPath = filePath;

  if (!targetPath) {
    const ownerWindow = getOwnerWindow();
    const result = ownerWindow
      ? await dialog.showSaveDialog(ownerWindow, {
          title: '保存文档',
          defaultPath: sanitizeDefaultName(defaultName),
          filters: getFileFilters(),
        })
      : await dialog.showSaveDialog({
          title: '保存文档',
          defaultPath: sanitizeDefaultName(defaultName),
          filters: getFileFilters(),
        });

    if (result.canceled || !result.filePath) {
      throw new Error('已取消保存文件');
    }

    targetPath = result.filePath;
  }

  await writeFile(targetPath, content, 'utf8');

  return { filePath: targetPath };
}

export async function createFolder({
  parentPath,
  folderName,
}: CreateFolderPayload): Promise<CreateFolderResult> {
  const targetFolderName = sanitizeSegmentName(folderName, '新建文件夹');
  const targetPath = await getUniqueEntryPath(parentPath, targetFolderName);
  await mkdir(targetPath, { recursive: false });

  return {
    directoryPath: parentPath,
    entries: await listDirectoryEntries(parentPath),
    targetPath,
  };
}

export async function createMarkdownFile({
  directoryPath,
  fileName,
  content,
}: CreateMarkdownFilePayload): Promise<{ filePath: string; content: string }> {
  const normalizedName = sanitizeSegmentName(fileName, '未命名文档');
  const finalName = normalizedName.toLowerCase().endsWith('.md') ? normalizedName : `${normalizedName}.md`;
  const filePath = await getUniqueEntryPath(directoryPath, finalName);
  await writeFile(filePath, content, 'utf8');

  return {
    filePath,
    content,
  };
}

export async function readDirectory(directoryPath: string): Promise<OpenFolderResult> {
  return {
    directoryPath,
    entries: await listDirectoryEntries(directoryPath),
  };
}

export async function renameEntry({
  targetPath,
  nextName,
}: RenameEntryPayload): Promise<{ directoryPath: string; entries: DirectoryEntryResult[]; targetPath: string }> {
  const normalizedName = sanitizeSegmentName(nextName, path.basename(targetPath));
  const targetDirectoryPath = path.dirname(targetPath);
  const targetStat = await stat(targetPath);
  const extension = path.extname(targetPath);
  const finalName = targetStat.isDirectory()
    ? normalizedName
    : extension && !path.extname(normalizedName)
      ? `${normalizedName}${extension}`
      : normalizedName;
  const nextPath = path.join(targetDirectoryPath, finalName);

  if (nextPath === targetPath) {
    return {
      directoryPath: targetDirectoryPath,
      entries: await listDirectoryEntries(targetDirectoryPath),
      targetPath,
    };
  }

  await rename(targetPath, nextPath);

  return {
    directoryPath: targetDirectoryPath,
    entries: await listDirectoryEntries(targetDirectoryPath),
    targetPath: nextPath,
  };
}

export async function moveEntry({
  sourcePath,
  destinationDirectoryPath,
}: MoveEntryPayload): Promise<{
  directoryPath: string;
  entries: DirectoryEntryResult[];
  movedPath: string;
}> {
  if (sourcePath === destinationDirectoryPath || isPathWithin(destinationDirectoryPath, sourcePath)) {
    throw new Error('不能将项目移动到自身或子级目录');
  }

  const destinationPath = path.join(destinationDirectoryPath, path.basename(sourcePath));
  await rename(sourcePath, destinationPath);

  return {
    directoryPath: destinationDirectoryPath,
    entries: await listDirectoryEntries(destinationDirectoryPath),
    movedPath: destinationPath,
  };
}

export async function deleteEntry({
  targetPath,
}: DeleteEntryPayload): Promise<{ directoryPath: string; entries: DirectoryEntryResult[] }> {
  const targetDirectoryPath = path.dirname(targetPath);
  const targetStat = await stat(targetPath);

  if (targetStat.isDirectory()) {
    await rm(targetPath, { recursive: true, force: false });
  } else {
    await rm(targetPath, { force: false });
  }

  return {
    directoryPath: targetDirectoryPath,
    entries: await listDirectoryEntries(targetDirectoryPath),
  };
}
