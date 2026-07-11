import type {
  AnswerBlockPlacementMode,
  AnswerDisplayMode,
  BlockStyleOverrides,
  BlockquoteStructureAction,
  ColumnSectionColumnCount,
  DocumentFormat,
  ImageBlockMetadata,
  ImageWrapSide,
  InsertListBlockKind,
  LayoutBlock,
  LayoutBlockSemantic,
  LayoutSemanticRoleConfig,
  ListBatchCheckedAction,
  ListBatchCheckedScope,
  ListIndentAction,
  ListReorderAction,
  ListTaskConversionAction,
  ListStructureAction,
  LayoutDocument,
  LayoutFontResource,
  ParseState,
  SemanticBlockPresetId,
  SemanticKeywordScanResult,
  SyntaxMappingConfig,
  TableColumnAlign,
  TableCellRangeSelection,
  TableStructureAction,
  TextMarkType,
  TextRangeSelection,
  TextRun,
  TextStyleOverrides,
} from '@/engine/document-model';
import type {
  HeaderFooterArea,
  HeaderFooterPresetId,
  HeaderFooterSlot,
  BlockSpacingParameterKey,
  BlockSpacingParameters,
  MarginMode,
  MarginPresetId,
  MarginSide,
  PageBackgroundSettings,
  PageColumnCount,
  PageOrientation,
  PageSizeId,
  PdfWatermarkSettings,
  PaginationAlgorithmId,
  PaginationBehaviorOption,
  StyleSettings,
  TemplateId,
  ThemeId,
} from '@/engine/style/types';
import type { QuickBlockStyleScope } from '@/engine/style/quickBlockStyle';
import type { QuickTextStylePatch, QuickTextStyleScope } from '@/engine/style/quickTextStyle';
import type { PageLayout } from '@/engine/typesetting/types';
import type { StateCreator } from 'zustand';
import type {
  LeftPanelTab,
  PageSettingsTab,
  RecentFileEntry,
  WorkspaceDirectoryEntry,
  WorkspaceViewMode,
} from '@/types/workspace';
import type { AiSlice } from '@/store/slices/aiSlice';
import type { KnowledgeBaseSlice } from '@/store/slices/knowledgeBaseSlice';
import type { KnowledgeIngestionSlice } from '@/store/slices/knowledgeIngestionSlice';

export type AppStore = DocumentSlice & UISlice & StyleSlice & KnowledgeBaseSlice & KnowledgeIngestionSlice & AiSlice;

export interface DocumentHistorySnapshot {
  layoutDocument: LayoutDocument;
  styleSettings: StyleSettings;
}

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
  documentHistoryPast: DocumentHistorySnapshot[];
  documentHistoryFuture: DocumentHistorySnapshot[];
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
  updateSyntaxMappingConfig: (config: SyntaxMappingConfig) => void;
  updateSemanticRoleConfig: (config: LayoutSemanticRoleConfig) => void;
  setAnswerDisplayMode: (mode: AnswerDisplayMode) => void;
  setAnswerBlockPlacementMode: (mode: AnswerBlockPlacementMode) => void;
  scanSemanticKeywordRules: (payload?: {
    overwriteExisting?: boolean;
  }) => SemanticKeywordScanResult;
  applySemanticKeywordRules: (payload?: {
    overwriteExisting?: boolean;
  }) => SemanticKeywordScanResult;
  appendLayoutParagraphBlock: (payload: { text: string }) => string | null;
  insertLayoutMarkdownBlocks: (payload: {
    markdown: string;
    insertAfterNodeId?: string | null;
  }) => Promise<string | null>;
  setParseError: (message: string) => void;
  setPageLayouts: (pages: PageLayout[]) => void;
  selectLayoutNode: (nodeId: string) => void;
  selectLayoutBlock: (payload: { blockId: string; extendRange?: boolean }) => void;
  selectLayoutTableCell: (payload: { cellId: string; extendRange?: boolean }) => void;
  clearLayoutSelection: () => void;
  undoLayoutDocument: () => boolean;
  redoLayoutDocument: () => boolean;
  updateLayoutNodeText: (payload: { nodeId: string; text: string }) => void;
  replaceLayoutNodeRichText: (payload: { nodeId: string; textRuns: TextRun[] }) => void;
  replaceMultipleLayoutNodeTexts: (payload: {
    replacements: Array<{
      nodeId: string;
      text?: string;
      textRuns?: TextRun[];
    }>;
    selectedNodeId?: string | null;
  }) => { didUpdate: boolean; updatedCount: number; selectedNodeId: string | null };
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
  importLayoutFontResource: (fontResource: LayoutFontResource) => void;
  insertLayoutImageBlock: (payload: {
    src: string;
    alt: string;
    title?: string | null;
    widthPx?: number | null;
    heightPx?: number | null;
    lockAspectRatio?: boolean;
    objectFit?: 'contain' | 'cover';
    cropTopPx?: number | null;
    cropRightPx?: number | null;
    cropBottomPx?: number | null;
    cropLeftPx?: number | null;
    wrapMode?: ImageBlockMetadata['wrapMode'];
    wrapSide?: ImageWrapSide;
    insertAfterNodeId?: string | null;
  }) => string | null;
  insertLayoutTableBlock: (payload: {
    rowCount?: number;
    columnCount?: number;
    insertAfterNodeId?: string | null;
  }) => string | null;
  insertLayoutEquationBlock: (payload: {
    value?: string;
    insertAfterNodeId?: string | null;
  }) => string | null;
  insertLayoutListBlock: (payload: {
    kind: InsertListBlockKind;
    insertAfterNodeId?: string | null;
  }) => string | null;
  insertLayoutParagraphBlock: (payload: {
    insertAfterNodeId?: string | null;
  }) => string | null;
  insertLayoutPageBreakBlock: (payload: {
    insertAfterNodeId?: string | null;
  }) => string | null;
  insertLayoutColumnBreakBlock: (payload: {
    insertAfterNodeId?: string | null;
  }) => string | null;
  insertLayoutTocBlock: (payload: {
    insertAfterNodeId?: string | null;
  }) => string | null;
  deleteLayoutTopLevelBlock: (payload: {
    nodeId: string;
  }) => { didDelete: boolean; selectedNodeId: string | null; deletedBlockType: LayoutBlock['type'] | null };
  updateLayoutTocMaxDepth: (payload: {
    nodeId: string;
    maxDepth: 1 | 2 | 3;
  }) => void;
  refreshLayoutTocBlock: (payload: {
    nodeId: string;
  }) => boolean;
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
  autoFitLayoutTableSize: (payload: {
    cellId: string;
    contentWidthPx: number;
    rowHeightPx: number;
    headerRowHeightPx: number;
    cellPaddingX: number;
    cellPaddingY: number;
    baseFontSizePx: number;
    baseLineHeightPx: number;
  }) => string | null;
  updateLayoutTableColumnWidths: (payload: {
    cellId: string;
    columnWidthsPx: Array<number | null>;
  }) => string | null;
  updateLayoutTableRowHeight: (payload: {
    cellId: string;
    heightPx: number | null;
  }) => string | null;
  mergeLayoutSelectedTableCells: () => {
    selectedNodeId: string | null;
    didUpdate: boolean;
    reason: 'merged' | 'invalidSelection' | 'singleCell' | 'containsMergedCell';
  };
  mergeLayoutSelectedBlocks: () => {
    selectedNodeId: string | null;
    didUpdate: boolean;
    reason: 'merged' | 'invalidSelection' | 'notEnoughBlocks' | 'nonContiguous' | 'unsupportedBlockType' | 'mixedBlockTypes';
    mergedCount: number;
  };
  wrapLayoutSelectedBlocksInColumns: (payload?: { columnCount?: ColumnSectionColumnCount }) => {
    selectedNodeId: string | null;
    didUpdate: boolean;
    reason: 'wrapped' | 'invalidSelection' | 'notEnoughBlocks' | 'nonContiguous' | 'unsupportedBlockType';
    wrappedCount: number;
    columnCount: ColumnSectionColumnCount;
  };
  updateLayoutColumnSectionAttributes: (payload: {
    nodeId: string;
    columnCount?: 2 | 3;
    columnGapMm?: number;
    divider?: boolean;
    headingsSpanAll?: boolean;
  }) => void;
  unwrapLayoutColumnSection: (payload: {
    nodeId: string;
  }) => {
    didUpdate: boolean;
    selectedNodeId: string | null;
    unwrappedCount: number;
  };
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
  updateLayoutListItemChecked: (payload: {
    itemId: string;
    checked: boolean;
  }) => string | null;
  updateLayoutListItemLevel: (payload: {
    itemId: string;
    action: ListIndentAction;
  }) => string | null;
  reorderLayoutListItem: (payload: {
    itemId: string;
    action: ListReorderAction;
  }) => string | null;
  updateLayoutListTaskMode: (payload: {
    itemId: string;
    taskMode: boolean;
  }) => string | null;
  convertLayoutListItemTaskState: (payload: {
    itemId: string;
    action: ListTaskConversionAction;
  }) => string | null;
  updateLayoutListBatchChecked: (payload: {
    itemId: string;
    scope: ListBatchCheckedScope;
    action: ListBatchCheckedAction;
  }) => { selectedNodeId: string | null; changedCount: number };
  updateLayoutBlockquoteStructure: (payload: {
    blockquoteId: string;
    targetNodeId: string;
    action: BlockquoteStructureAction;
  }) => string | null;
  updateLayoutImageAttributes: (payload: {
    nodeId: string;
    src: string;
    alt: string;
    title: string | null;
    widthPx?: number | null;
    heightPx?: number | null;
    lockAspectRatio?: boolean;
    objectFit?: 'contain' | 'cover';
    cropTopPx?: number | null;
    cropRightPx?: number | null;
    cropBottomPx?: number | null;
    cropLeftPx?: number | null;
    wrapMode?: ImageBlockMetadata['wrapMode'];
    wrapSide?: ImageWrapSide;
    showCaption?: boolean;
    offsetX?: number | null;
    offsetY?: number | null;
  }) => void;
  moveLayoutImageBlockAfterAnchor: (payload: {
    nodeId: string;
    anchorBlockId: string | null;
  }) => { didUpdate: boolean; selectedNodeId: string | null };
  applyLayoutNodeBlockStyle: (payload: {
    nodeId: string;
    blockStyleOverrides: BlockStyleOverrides;
  }) => void;
  updateLayoutBlockSemantic: (payload: {
    nodeId: string;
    semantic: LayoutBlockSemantic | null;
  }) => void;
  updateLayoutBlockSemanticPreset: (payload: {
    nodeId: string;
    presetId: SemanticBlockPresetId | null;
  }) => void;
  applyLayoutQuickBlockStyle: (payload: {
    scope: QuickBlockStyleScope;
    styleOverrides: BlockStyleOverrides;
  }) => void;
  applyLayoutQuickTextStyle: (payload: {
    scope: QuickTextStyleScope;
    styleOverrides: QuickTextStylePatch;
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
  setThemeId: (themeId: ThemeId) => void;
  setPageBackground: (background: PageBackgroundSettings) => void;
  setPdfWatermark: (watermark: PdfWatermarkSettings) => void;
  setHeaderPreset: (headerPreset: HeaderFooterPresetId) => void;
  setFooterPreset: (footerPreset: HeaderFooterPresetId) => void;
  setCustomHeaderReservedMm: (value: number) => void;
  setCustomFooterReservedMm: (value: number) => void;
  setHeaderFooterContentSlot: (payload: {
    area: HeaderFooterArea;
    slot: HeaderFooterSlot;
    value: string;
  }) => void;
  setHeaderFooterLinked: (linked: boolean) => void;
  setPageColumnCount: (count: PageColumnCount) => void;
  setPageColumnGapMm: (value: number) => void;
  setPageColumnDivider: (value: boolean) => void;
  setPageColumnHeadingsSpanAll: (value: boolean) => void;
  setPaginationAlgorithmId: (algorithmId: PaginationAlgorithmId) => void;
  setPaginationBehaviorOption: (option: PaginationBehaviorOption, value: boolean) => void;
  setBlockSpacingParameter: (parameter: BlockSpacingParameterKey, value: number) => void;
  applyBlockSpacingPreset: (presetId: string) => void;
  addBlockSpacingPreset: (payload: { name: string; description: string }) => string;
  updateBlockSpacingPreset: (payload: {
    presetId: string;
    name?: string;
    description?: string;
    parameters?: BlockSpacingParameters;
  }) => void;
}

export type StoreSlice<T> = StateCreator<AppStore, [['zustand/immer', never]], [], T>;
