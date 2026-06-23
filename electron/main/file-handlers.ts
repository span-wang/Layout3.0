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

export interface CreateLayoutFilePayload {
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

function getOpenFileFilters() {
  return [
    { name: 'Layout 工程与 Markdown', extensions: ['layout', 'json', 'md'] },
    { name: 'Layout 工程文件', extensions: ['layout', 'json'] },
    { name: 'Markdown 文档', extensions: ['md'] },
  ];
}

function getOpenImageFilters() {
  return [
    { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] },
    { name: '所有文件', extensions: ['*'] },
  ];
}

function getSaveFileFilters() {
  return [
    { name: 'Layout 工程文件', extensions: ['layout', 'json'] },
  ];
}

function sanitizeDefaultName(fileName: string): string {
  const sanitized = fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').trim();
  return sanitized || '未命名文档.layout';
}

function sanitizeSegmentName(name: string, fallback: string): string {
  const sanitized = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').trim();
  return sanitized || fallback;
}

function ensureDocumentExtension(targetPath: string, defaultName: string): string {
  const currentExtension = path.extname(targetPath).toLowerCase();
  if (currentExtension === '.layout' || currentExtension === '.json') {
    return targetPath;
  }

  const fallbackExtension = path.extname(defaultName);
  if (currentExtension) {
    return `${targetPath.slice(0, -currentExtension.length)}${fallbackExtension || '.layout'}`;
  }

  return fallbackExtension ? `${targetPath}${fallbackExtension}` : `${targetPath}.layout`;
}

const fsErrorMessages: Record<string, string> = {
  EACCES: '没有权限访问该路径',
  EBUSY: '文件正在被占用',
  EEXIST: '目标已存在',
  EISDIR: '目标是文件夹，不能按文件处理',
  ENOENT: '路径不存在或已被删除',
  ENOTDIR: '目标不是文件夹',
  ENOTEMPTY: '文件夹非空，无法删除',
  EPERM: '没有权限执行该操作',
  EXDEV: '无法跨磁盘移动文件',
};

function mapFsError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error('文件操作失败');
  }

  if (error.message.startsWith('已取消') || error.message === '不能将项目移动到自身或子级目录') {
    return error;
  }

  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === 'string' && fsErrorMessages[code]) {
    return new Error(fsErrorMessages[code]);
  }

  return error;
}

async function withFsError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapFsError(error);
  }
}

function buildUniqueEntryName(preferredName: string, index: number): string {
  const extension = path.extname(preferredName);
  const baseName = extension ? preferredName.slice(0, -extension.length) : preferredName;
  return index === 0
    ? preferredName
    : extension
      ? `${baseName} ${index}${extension}`
      : `${baseName} ${index}`;
}

function isEntryCollision(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

async function createUniqueDirectoryPath(parentPath: string, preferredName: string): Promise<string> {
  let index = 0;

  while (true) {
    const candidatePath = path.join(parentPath, buildUniqueEntryName(preferredName, index));

    try {
      await mkdir(candidatePath, { recursive: false });
      return candidatePath;
    } catch (error) {
      if (isEntryCollision(error)) {
        index += 1;
        continue;
      }

      throw error;
    }
  }
}

async function createUniqueFilePath(
  directoryPath: string,
  preferredName: string,
  content: string,
): Promise<string> {
  let index = 0;

  while (true) {
    const candidatePath = path.join(directoryPath, buildUniqueEntryName(preferredName, index));

    try {
      await writeFile(candidatePath, content, { encoding: 'utf8', flag: 'wx' });
      return candidatePath;
    } catch (error) {
      if (isEntryCollision(error)) {
        index += 1;
        continue;
      }

      throw error;
    }
  }
}

function getDefaultWorkspacePath(): string {
  return path.join(app.getPath('documents'), 'LAYOUT3.0', '默认工作区');
}

async function listDirectoryEntries(directoryPath: string, allowFailure = false): Promise<DirectoryEntryResult[]> {
  let dirents;
  try {
    dirents = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (allowFailure) {
      return [];
    }

    throw error;
  }

  const entries = await Promise.all(
    dirents.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);

      try {
        if (entry.isSymbolicLink()) {
          return null;
        }

        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: entryPath,
            kind: 'directory' as const,
            children: await listDirectoryEntries(entryPath, true),
          };
        }

        if (!entry.isFile() || !isVisibleWorkspaceFilePath(entryPath)) {
          return null;
        }

        return {
          name: entry.name,
          path: entryPath,
          kind: 'file' as const,
        };
      } catch {
        return null;
      }
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
  return withFsError(async () => {
    const ownerWindow = getOwnerWindow();
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, {
          title: '打开文档',
          properties: ['openFile'],
          filters: getOpenFileFilters(),
        })
      : await dialog.showOpenDialog({
          title: '打开文档',
          properties: ['openFile'],
          filters: getOpenFileFilters(),
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
  });
}

export async function openDocumentAtPath(filePath: string): Promise<OpenDocumentResult> {
  return withFsError(async () => {
    const content = await readFile(filePath, 'utf8');

    return {
      filePath,
      content,
    };
  });
}

export async function selectImageFile(): Promise<{ filePath: string }> {
  return withFsError(async () => {
    const ownerWindow = getOwnerWindow();
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, {
          title: '选择图片',
          properties: ['openFile'],
          filters: getOpenImageFilters(),
        })
      : await dialog.showOpenDialog({
          title: '选择图片',
          properties: ['openFile'],
          filters: getOpenImageFilters(),
        });

    if (result.canceled || result.filePaths.length === 0) {
      throw new Error('已取消选择图片');
    }

    return {
      filePath: result.filePaths[0],
    };
  });
}

export async function openFolder(): Promise<OpenFolderResult> {
  return withFsError(async () => {
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
  });
}

export async function getDefaultWorkspace(): Promise<OpenFolderResult> {
  return withFsError(async () => {
    const directoryPath = getDefaultWorkspacePath();
    await mkdir(directoryPath, { recursive: true });

    return {
      directoryPath,
      entries: await listDirectoryEntries(directoryPath),
    };
  });
}

export async function saveDocument({
  filePath,
  content,
  defaultName,
}: SaveDocumentPayload): Promise<{ filePath: string }> {
  return withFsError(async () => {
    let targetPath = filePath;

    if (!targetPath) {
      const ownerWindow = getOwnerWindow();
      const result = ownerWindow
        ? await dialog.showSaveDialog(ownerWindow, {
            title: '保存文档',
            defaultPath: sanitizeDefaultName(defaultName),
            filters: getSaveFileFilters(),
          })
        : await dialog.showSaveDialog({
            title: '保存文档',
            defaultPath: sanitizeDefaultName(defaultName),
            filters: getSaveFileFilters(),
          });

      if (result.canceled || !result.filePath) {
        throw new Error('已取消保存文件');
      }

      targetPath = ensureDocumentExtension(result.filePath, defaultName);
    }

    await writeFile(targetPath, content, 'utf8');

    return { filePath: targetPath };
  });
}

export async function createFolder({
  parentPath,
  folderName,
}: CreateFolderPayload): Promise<CreateFolderResult> {
  return withFsError(async () => {
    const targetFolderName = sanitizeSegmentName(folderName, '新建文件夹');
    const targetPath = await createUniqueDirectoryPath(parentPath, targetFolderName);

    return {
      directoryPath: parentPath,
      entries: await listDirectoryEntries(parentPath),
      targetPath,
    };
  });
}

export async function createLayoutFile({
  directoryPath,
  fileName,
  content,
}: CreateLayoutFilePayload): Promise<{ filePath: string; content: string }> {
  return withFsError(async () => {
    const normalizedName = sanitizeSegmentName(fileName, '未命名文档');
    const finalName =
      normalizedName.toLowerCase().endsWith('.layout') || normalizedName.toLowerCase().endsWith('.json')
        ? normalizedName
        : `${normalizedName}.layout`;
    const filePath = await createUniqueFilePath(directoryPath, finalName, content);

    return {
      filePath,
      content,
    };
  });
}

export async function readDirectory(directoryPath: string): Promise<OpenFolderResult> {
  return withFsError(async () => ({
    directoryPath,
    entries: await listDirectoryEntries(directoryPath),
  }));
}

export async function renameEntry({
  targetPath,
  nextName,
}: RenameEntryPayload): Promise<{ directoryPath: string; entries: DirectoryEntryResult[]; targetPath: string }> {
  return withFsError(async () => {
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
  });
}

export async function moveEntry({
  sourcePath,
  destinationDirectoryPath,
}: MoveEntryPayload): Promise<{
  directoryPath: string;
  entries: DirectoryEntryResult[];
  movedPath: string;
}> {
  return withFsError(async () => {
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
  });
}

export async function deleteEntry({
  targetPath,
}: DeleteEntryPayload): Promise<{ directoryPath: string; entries: DirectoryEntryResult[] }> {
  return withFsError(async () => {
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
  });
}
