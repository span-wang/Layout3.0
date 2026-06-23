import type {
  BlockStyleOverrides,
  DocumentFormat,
  ListStructureAction,
  LayoutDocument,
  ParseState,
  TableColumnAlign,
  TableStructureAction,
  TextMarkType,
  TextRangeSelection,
  TextRun,
  TextStyleOverrides,
} from '@/engine/document-model';
import type {
  HeaderFooterPresetId,
  MarginMode,
  MarginPresetId,
  MarginSide,
  PageOrientation,
  PageSizeId,
  PaginationAlgorithmId,
  PaginationBehaviorOption,
  StyleSettings,
  TemplateId,
} from '@/engine/style/types';
import type { PageLayout } from '@/engine/typesetting/types';
import type { StateCreator } from 'zustand';
import type {
  LeftPanelTab,
  PageSettingsTab,
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
  documentFormat: DocumentFormat;
  source: string;
  recentlyOpenedFiles: RecentFileEntry[];
  parseState: ParseState;
  layoutDocument: LayoutDocument | null;
  parseError: string | null;
  pageLayouts: PageLayout[];
  resetDocument: () => void;
  loadDocument: (payload: {
    title: string;
    filePath: string | null;
    source: string;
    documentFormat: DocumentFormat;
    layoutDocument: LayoutDocument;
  }) => void;
  restoreDraft: (payload: {
    title: string;
    source: string;
    filePath?: string | null;
    documentFormat?: DocumentFormat;
    layoutDocument: LayoutDocument;
  }) => void;
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
  setLayoutDocument: (document: LayoutDocument) => void;
  setParseError: (message: string) => void;
  setPageLayouts: (pages: PageLayout[]) => void;
  selectLayoutNode: (nodeId: string) => void;
  clearLayoutSelection: () => void;
  updateLayoutNodeText: (payload: { nodeId: string; text: string }) => void;
  replaceLayoutNodeRichText: (payload: { nodeId: string; textRuns: TextRun[] }) => void;
  toggleLayoutNodeTextMark: (payload: {
    nodeId: string;
    selection: TextRangeSelection | null;
    markType: TextMarkType;
  }) => void;
  applyLayoutNodeTextStyle: (payload: {
    nodeId: string;
    selection: TextRangeSelection | null;
    styleOverrides: TextStyleOverrides;
  }) => void;
  clearLayoutNodeTextFormatting: (payload: {
    nodeId: string;
    selection: TextRangeSelection | null;
  }) => void;
  insertLayoutImageBlock: (payload: {
    src: string;
    alt: string;
    title?: string | null;
    insertAfterNodeId?: string | null;
  }) => string | null;
  insertLayoutTableBlock: (payload: {
    rowCount?: number;
    columnCount?: number;
    insertAfterNodeId?: string | null;
  }) => string | null;
  updateLayoutTableStructure: (payload: {
    cellId: string;
    action: TableStructureAction;
  }) => string | null;
  updateLayoutTableHeaderRow: (payload: {
    cellId: string;
    enabled: boolean;
  }) => string | null;
  updateLayoutTableColumnAlign: (payload: {
    cellId: string;
    align: TableColumnAlign;
  }) => string | null;
  updateLayoutListStructure: (payload: {
    itemId: string;
    action: ListStructureAction;
  }) => string | null;
  updateLayoutListOrdered: (payload: {
    itemId: string;
    ordered: boolean;
  }) => string | null;
  updateLayoutListStart: (payload: {
    itemId: string;
    start: number;
  }) => string | null;
  updateLayoutImageAttributes: (payload: {
    nodeId: string;
    src: string;
    alt: string;
    title: string | null;
  }) => void;
  applyLayoutNodeBlockStyle: (payload: {
    nodeId: string;
    blockStyleOverrides: BlockStyleOverrides;
  }) => void;
}

export interface UISlice {
  activeLeftPanelTab: LeftPanelTab;
  isLeftPanelOpen: boolean;
  isRightPanelOpen: boolean;
  workspaceViewMode: WorkspaceViewMode;
  activeRightPanelTab: string;
  activePageSettingsTab: PageSettingsTab;
  setActiveLeftPanelTab: (tab: LeftPanelTab) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setWorkspaceViewMode: (mode: WorkspaceViewMode) => void;
  setActiveRightPanelTab: (tab: string) => void;
  setActivePageSettingsTab: (tab: PageSettingsTab) => void;
}

export interface StyleSlice {
  styleSettings: StyleSettings;
  resetStyleSettings: () => void;
  replaceStyleSettings: (styleSettings: StyleSettings) => void;
  setPageSize: (pageSize: PageSizeId) => void;
  setOrientation: (orientation: PageOrientation) => void;
  setMarginMode: (marginMode: MarginMode) => void;
  setMarginPreset: (marginPreset: MarginPresetId) => void;
  setCustomMargin: (side: MarginSide, value: number) => void;
  setMarginLinked: (linked: boolean) => void;
  setHeaderFooterMode: (mode: MarginMode) => void;
  setTemplateId: (templateId: TemplateId) => void;
  setHeaderPreset: (headerPreset: HeaderFooterPresetId) => void;
  setFooterPreset: (footerPreset: HeaderFooterPresetId) => void;
  setCustomHeaderReservedMm: (value: number) => void;
  setCustomFooterReservedMm: (value: number) => void;
  setHeaderFooterLinked: (linked: boolean) => void;
  setPaginationAlgorithmId: (algorithmId: PaginationAlgorithmId) => void;
  setPaginationBehaviorOption: (option: PaginationBehaviorOption, value: boolean) => void;
}

export type AppStore = DocumentSlice & UISlice & StyleSlice;

export type StoreSlice<T> = StateCreator<AppStore, [['zustand/immer', never]], [], T>;
