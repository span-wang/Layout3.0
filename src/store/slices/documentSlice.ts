import { starterMarkdown, starterTitle } from '@/constants/workspace';
import { loadRecentFiles } from '@/services/RecentFilesService';
import type { DocumentSlice, StoreSlice } from '@/store/types';

export const createDocumentSlice: StoreSlice<DocumentSlice> = (set) => ({
  documentEpoch: 0,
  title: starterTitle,
  filePath: null,
  workspaceRootPath: null,
  currentDirectoryPath: null,
  directoryEntries: [],
  recentlyOpenedFiles: loadRecentFiles(),
  isDirty: false,
  source: starterMarkdown,
  parseState: 'idle',
  parseResult: null,
  parseError: null,
  pageLayouts: [],
  resetDocument: () =>
    set((state) => {
      state.documentEpoch += 1;
      state.title = starterTitle;
      state.filePath = null;
      state.workspaceRootPath = null;
      state.currentDirectoryPath = null;
      state.directoryEntries = [];
      state.isDirty = false;
      state.source = starterMarkdown;
      state.parseState = 'idle';
      state.parseResult = null;
      state.parseError = null;
      state.pageLayouts = [];
    }),
  loadDocument: ({ title, filePath, source }) =>
    set((state) => {
      state.documentEpoch += 1;
      state.title = title;
      state.filePath = filePath;
      state.isDirty = false;
      state.source = source;
      state.parseState = 'idle';
      state.parseResult = null;
      state.parseError = null;
      state.pageLayouts = [];
    }),
  restoreDraft: ({ title, source, filePath }) =>
    set((state) => {
      state.documentEpoch += 1;
      state.title = title;
      state.filePath = filePath ?? null;
      state.isDirty = true;
      state.source = source;
      state.parseState = 'idle';
      state.parseResult = null;
      state.parseError = null;
      state.pageLayouts = [];
    }),
  markDocumentSaved: ({ title, filePath }) =>
    set((state) => {
      state.title = title;
      state.filePath = filePath;
      state.isDirty = false;
    }),
  updateDocumentLocation: ({ title, filePath }) =>
    set((state) => {
      state.documentEpoch += 1;
      state.title = title;
      state.filePath = filePath;
    }),
  detachDocumentFile: () =>
    set((state) => {
      state.filePath = null;
      state.isDirty = true;
    }),
  setCurrentDirectory: ({ directoryPath, directoryEntries, workspaceRootPath }) =>
    set((state) => {
      if (workspaceRootPath !== undefined) {
        state.workspaceRootPath = workspaceRootPath;
      } else if (!state.workspaceRootPath) {
        state.workspaceRootPath = directoryPath;
      }
      state.currentDirectoryPath = directoryPath;
      state.directoryEntries = directoryEntries;
    }),
  setRecentlyOpenedFiles: (files) =>
    set((state) => {
      state.recentlyOpenedFiles = files;
    }),
  setSource: (nextSource) =>
    set((state) => {
      state.source = nextSource;
      state.isDirty = true;
    }),
  setParseState: (nextState) =>
    set((state) => {
      state.parseState = nextState;
      if (nextState !== 'error') {
        state.parseError = null;
      }
    }),
  setParseResult: (result) =>
    set((state) => {
      state.parseState = 'ready';
      state.parseResult = result;
      state.parseError = null;
    }),
  setParseError: (message) =>
    set((state) => {
      state.parseState = 'error';
      state.parseError = message;
      state.pageLayouts = [];
    }),
  setPageLayouts: (pages) =>
    set((state) => {
      state.pageLayouts = pages;
    }),
});
