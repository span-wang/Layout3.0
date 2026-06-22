import type { PageLayout } from '@/engine/typesetting/types';
import type { ParseResult, ParseState } from '@/engine/parser/types';
import type { StateCreator } from 'zustand';
import type {
  LeftPanelTab,
  RecentFileEntry,
  WorkspaceDirectoryEntry,
  WorkspaceViewMode,
} from '@/types/workspace';

export interface DocumentSlice {
  documentEpoch: number;
  title: string;
  filePath: string | null;
  workspaceRootPath: string | null;
  currentDirectoryPath: string | null;
  directoryEntries: WorkspaceDirectoryEntry[];
  isDirty: boolean;
  source: string;
  recentlyOpenedFiles: RecentFileEntry[];
  parseState: ParseState;
  parseResult: ParseResult | null;
  parseError: string | null;
  pageLayouts: PageLayout[];
  resetDocument: () => void;
  loadDocument: (payload: { title: string; filePath: string | null; source: string }) => void;
  restoreDraft: (payload: { title: string; source: string; filePath?: string | null }) => void;
  markDocumentSaved: (payload: { title: string; filePath: string | null }) => void;
  updateDocumentLocation: (payload: { title: string; filePath: string | null }) => void;
  detachDocumentFile: () => void;
  setCurrentDirectory: (payload: {
    directoryPath: string | null;
    directoryEntries: WorkspaceDirectoryEntry[];
    workspaceRootPath?: string | null;
  }) => void;
  setRecentlyOpenedFiles: (files: RecentFileEntry[]) => void;
  setSource: (nextSource: string) => void;
  setParseState: (nextState: ParseState) => void;
  setParseResult: (result: ParseResult) => void;
  setParseError: (message: string) => void;
  setPageLayouts: (pages: PageLayout[]) => void;
}

export interface UISlice {
  activeLeftPanelTab: LeftPanelTab;
  isLeftPanelOpen: boolean;
  isRightPanelOpen: boolean;
  workspaceViewMode: WorkspaceViewMode;
  setActiveLeftPanelTab: (tab: LeftPanelTab) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setWorkspaceViewMode: (mode: WorkspaceViewMode) => void;
}

export type AppStore = DocumentSlice & UISlice;

export type StoreSlice<T> = StateCreator<AppStore, [['zustand/immer', never]], [], T>;
