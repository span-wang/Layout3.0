import type { LayoutDocument } from '@/engine/document-model';
import type { StyleSettings } from '@/engine/style/types';

const DRAFT_STORAGE_KEY = 'layout3.draft';

export interface DraftEntry {
  title: string;
  source: string;
  layoutDocument: LayoutDocument;
  styleSettings: StyleSettings;
  filePath: string | null;
  lastModified: number;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadDraft(): DraftEntry | null {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as DraftEntry;
    if (
      typeof parsed?.title !== 'string' ||
      typeof parsed?.source !== 'string' ||
      typeof parsed?.layoutDocument !== 'object' ||
      parsed?.layoutDocument === null ||
      typeof parsed?.styleSettings !== 'object' ||
      parsed?.styleSettings === null ||
      typeof parsed?.lastModified !== 'number' ||
      (typeof parsed?.filePath !== 'string' && parsed?.filePath !== null)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(entry: DraftEntry): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* ignore quota errors */
  }
}

export function clearDraft(): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function isDraftForCurrentFile(
  draft: DraftEntry | null,
  currentFilePath: string | null,
): boolean {
  if (!draft) {
    return false;
  }

  if (draft.filePath === currentFilePath) {
    return true;
  }

  return draft.filePath === null && currentFilePath === null;
}
