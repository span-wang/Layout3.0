import {
  getBaseNameFromPath,
  isOpenableDocumentPath,
  isPathWithin,
  replacePathPrefix,
} from '@/utils/filePath';

const RECENT_FILES_STORAGE_KEY = 'layout3.recentFiles';
const MAX_RECENT_FILES = 10;

export interface RecentFileEntry {
  filePath: string;
  title: string;
  lastOpenedAt: number;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readRecentFiles(): RecentFileEntry[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(RECENT_FILES_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue) as RecentFileEntry[];
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter(
      (entry): entry is RecentFileEntry =>
        typeof entry?.filePath === 'string' &&
        typeof entry?.title === 'string' &&
        typeof entry?.lastOpenedAt === 'number' &&
        isOpenableDocumentPath(entry.filePath),
    );
  } catch {
    return [];
  }
}

function writeRecentFiles(entries: RecentFileEntry[]): RecentFileEntry[] {
  const nextEntries = entries.slice(0, MAX_RECENT_FILES);

  if (canUseStorage()) {
    window.localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(nextEntries));
  }

  return nextEntries;
}

function sortRecentFiles(entries: RecentFileEntry[]): RecentFileEntry[] {
  return entries.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
}

export function loadRecentFiles(): RecentFileEntry[] {
  return sortRecentFiles(readRecentFiles());
}

export function addRecentFile(filePath: string, title?: string): RecentFileEntry[] {
  if (!isOpenableDocumentPath(filePath)) {
    return loadRecentFiles();
  }

  const nextTitle = title?.trim() ? title.trim() : getBaseNameFromPath(filePath);
  const nextEntry: RecentFileEntry = {
    filePath,
    title: nextTitle,
    lastOpenedAt: Date.now(),
  };
  const entries = readRecentFiles().filter((entry) => entry.filePath !== filePath);

  return writeRecentFiles(sortRecentFiles([nextEntry, ...entries]));
}

export function removeRecentFile(filePath: string): RecentFileEntry[] {
  const entries = readRecentFiles().filter((entry) => entry.filePath !== filePath);
  return writeRecentFiles(sortRecentFiles(entries));
}

export function removeRecentFilesUnderPath(rootPath: string): RecentFileEntry[] {
  const entries = readRecentFiles().filter((entry) => !isPathWithin(entry.filePath, rootPath));
  return writeRecentFiles(sortRecentFiles(entries));
}

export function updateRecentFilePath(oldPath: string, newPath: string): RecentFileEntry[] {
  const entries = readRecentFiles().map((entry) =>
    entry.filePath === oldPath
      ? {
          ...entry,
          filePath: newPath,
          title: getBaseNameFromPath(newPath),
        }
      : entry,
  );

  return writeRecentFiles(sortRecentFiles(entries));
}

export function updateRecentFilePathPrefix(oldPrefix: string, newPrefix: string): RecentFileEntry[] {
  const entries = readRecentFiles().map((entry) => {
    if (!isPathWithin(entry.filePath, oldPrefix)) {
      return entry;
    }

    const nextPath = replacePathPrefix(entry.filePath, oldPrefix, newPrefix);

    return {
      ...entry,
      filePath: nextPath,
      title: getBaseNameFromPath(nextPath),
    };
  });

  return writeRecentFiles(sortRecentFiles(entries));
}

export function clearRecentFiles(): RecentFileEntry[] {
  return writeRecentFiles([]);
}
