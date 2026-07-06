import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  FileDown,
  FilePlus2,
  FileUp,
  FlaskConical,
  Files,
  FolderOpen,
  Highlighter,
  ImagePlus,
  Italic,
  ListOrdered,
  ListPlus,
  ListTodo,
  ListTree,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  Pilcrow,
  RectangleHorizontal,
  Redo2,
  Save,
  Search,
  Sigma,
  Sparkles,
  SquareSplitHorizontal,
  StickyNote,
  Columns2,
  Strikethrough,
  Table2,
  TextCursorInput,
  Type,
  Underline,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { ToolButton } from '@/components/common/ToolButton';
import {
  ChemistryComposerDialog,
  type ChemistryCompositionInsertPayload,
} from '@/components/layout/ChemistryComposerDialog';
import {
  chemistryApparatusCategories,
  chemistryApparatusItems,
  type ChemistryApparatusCategory,
  type ChemistryApparatusId,
} from '@/constants/chemistryApparatus';
import { fontFamilyPlaceholderValue, textFontFamilyGroups } from '@/constants/fontFamilies';
import { highlightColorOptions, standardColorOptions } from '@/constants/styleColors';
import { workspaceViewModes } from '@/constants/workspace';
import {
  getSelectedLayoutNodeInfo,
  type InsertListBlockKind,
  type LayoutBlock,
  type SelectedLayoutNodeInfo,
  type TextMarkType,
  type TextRangeSelection,
  type TextRun,
} from '@/engine/document-model';
import { buildFontFamilyGroupsWithImportedFonts } from '@/engine/document-model/fontResources';
import {
  getBlockBaseFontSize,
  getQuickTextStyleRule,
  resolveQuickTextStyleForBlock,
  type QuickTextStyleScope,
} from '@/engine/style/quickTextStyle';
import { resolveStyleContract } from '@/engine/style/resolveContract';
import type { ResolvedStyleContract } from '@/engine/style/types';
import { useAppStore } from '@/store';
import type { CanvasTextSelectionState, WorkspaceViewMode } from '@/types/workspace';

interface ToolbarProps {
  isLeftPanelOpen: boolean;
  isRightPanelOpen: boolean;
  workspaceViewMode: WorkspaceViewMode;
  isSaving: boolean;
  isExporting: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canvasTextSelection: CanvasTextSelectionState;
  onCreateDocument: () => void;
  onOpenDocument: () => void;
  onOpenFolder: () => void;
  onSaveDocument: () => void;
  onSaveDocumentAs: () => void;
  onExportPdf: () => void;
  onExportDocx: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onImportFont: () => void;
  onInsertImage: () => void;
  onInsertChemistryApparatus: (apparatusId: ChemistryApparatusId) => void;
  onInsertChemistryComposition: (payload: ChemistryCompositionInsertPayload) => void;
  onInsertEquation: () => void;
  onInsertTable: () => void;
  onInsertList: (kind: InsertListBlockKind) => void;
  onInsertParagraph: () => void;
  onInsertColumnBreak: () => void;
  onInsertPageBreak: () => void;
  onInsertToc: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
  onOpenSearchPanel: () => void;
  onOpenAiPanel: () => void;
}

const viewModeIcons: Record<WorkspaceViewMode, typeof PanelsTopLeft> = {
  source: PanelsTopLeft,
  split: SquareSplitHorizontal,
  preview: RectangleHorizontal,
};

// 顶部快捷按钮都写入 TextRun.marks，删除线复用已有的 strike 标记。
const quickTextMarkOptions: Array<{
  id: TextMarkType;
  label: string;
  icon: typeof Bold;
}> = [
  { id: 'bold', label: '加粗', icon: Bold },
  { id: 'italic', label: '斜体', icon: Italic },
  { id: 'underline', label: '下划线', icon: Underline },
  { id: 'strike', label: '删除线', icon: Strikethrough },
];

const quickParagraphAlignOptions: Array<{
  id: 'left' | 'center' | 'right' | 'justify';
  label: string;
  icon: typeof AlignLeft;
}> = [
  { id: 'left', label: '左对齐', icon: AlignLeft },
  { id: 'center', label: '居中对齐', icon: AlignCenter },
  { id: 'right', label: '右对齐', icon: AlignRight },
  { id: 'justify', label: '两端对齐', icon: AlignJustify },
];

const quickListInsertOptions: Array<{
  id: InsertListBlockKind;
  label: string;
  icon: typeof ListPlus;
}> = [
  { id: 'unordered', label: '新增无序列表', icon: ListPlus },
  { id: 'ordered', label: '新增有序列表', icon: ListOrdered },
  { id: 'task', label: '新增任务列表', icon: ListTodo },
];

const insertPlaceholderOptions: Array<{
  id: 'stickyNote';
  label: string;
  icon: typeof StickyNote;
}> = [
  { id: 'stickyNote', label: '便利贴', icon: StickyNote },
];

const quickTextEditableBlockTypes: LayoutBlock['type'][] = ['heading', 'paragraph', 'code'];
const quickBlockStyleEditableBlockTypes: LayoutBlock['type'][] = ['heading', 'paragraph', 'code', 'list', 'table'];
const defaultQuickTextColor = '#344054';
const defaultQuickHighlightColor = '#FEF08A';
const defaultQuickFontSize = 16;
const quickFontSizePresetOptions = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

const quickTextStyleScopeOptions: Array<{
  id: QuickTextStyleScope;
  label: string;
}> = [
  { id: 'allText', label: '全文字' },
  { id: 'heading1', label: 'H1' },
  { id: 'heading2', label: 'H2' },
  { id: 'heading3', label: 'H3' },
  { id: 'heading4', label: 'H4' },
  { id: 'paragraph', label: '段落' },
  { id: 'list', label: '列表' },
  { id: 'table', label: '表格' },
];

function normalizeQuickSelection(text: string, selection: TextRangeSelection | null): TextRangeSelection | null {
  if (!text) {
    return null;
  }

  if (!selection || selection.start === selection.end) {
    return { start: 0, end: text.length };
  }

  if (selection.start < 0 || selection.end > text.length || selection.start >= selection.end) {
    return { start: 0, end: text.length };
  }

  return selection;
}

function collectQuickSelectedRuns(textRuns: TextRun[], selection: TextRangeSelection | null): TextRun[] {
  const text = textRuns.map((run) => run.text).join('');
  const normalizedSelection = normalizeQuickSelection(text, selection);
  if (!normalizedSelection) {
    return [];
  }

  const selectedRuns: TextRun[] = [];
  let cursor = 0;

  for (const run of textRuns) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;

    if (normalizedSelection.end <= runStart || normalizedSelection.start >= runEnd) {
      continue;
    }

    selectedRuns.push(run);
  }

  return selectedRuns;
}

function isQuickTextMarkActive(
  textRuns: TextRun[],
  selection: TextRangeSelection | null,
  markType: TextMarkType,
): boolean {
  const selectedRuns = collectQuickSelectedRuns(textRuns, selection);
  return selectedRuns.length > 0 && selectedRuns.every((run) => run.marks.some((mark) => mark.type === markType));
}

function getQuickSharedTextStyleValue(
  textRuns: TextRun[],
  selection: TextRangeSelection | null,
  key: 'color' | 'highlightColor' | 'fontFamily' | 'fontSize',
): string | number | undefined {
  const selectedRuns = collectQuickSelectedRuns(textRuns, selection);
  if (selectedRuns.length === 0) {
    return undefined;
  }

  const firstValue = selectedRuns[0].styleOverrides[key];
  const isShared = selectedRuns.every((run) => run.styleOverrides[key] === firstValue);
  return isShared ? firstValue : undefined;
}

function normalizeQuickFontSizeValue(value: string | number): number | null {
  const parsedValue = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return Math.max(10, Math.min(72, Math.round(parsedValue)));
}

function resolveQuickCurrentFontSizeLabel(
  nodeInfo: SelectedLayoutNodeInfo | null,
  selection: TextRangeSelection | null,
  styles: Parameters<typeof resolveQuickTextStyleForBlock>[1],
  styleContract: ResolvedStyleContract,
): string {
  if (!nodeInfo) {
    return '';
  }

  const sharedFontSize = getQuickSharedTextStyleValue(nodeInfo.textRuns, selection, 'fontSize');
  if (sharedFontSize !== undefined) {
    return String(sharedFontSize);
  }

  const inheritedStyle = resolveQuickTextStyleForBlock(nodeInfo.ownerBlock, styles);
  const inheritedFontSize = inheritedStyle.fontSize ?? getBlockBaseFontSize(nodeInfo.ownerBlock, styleContract);
  return String(inheritedFontSize);
}

function isQuickTextStyleEditable(nodeInfo: SelectedLayoutNodeInfo | null): boolean {
  if (!nodeInfo) {
    return false;
  }

  return (
    nodeInfo.kind === 'listItem' ||
    nodeInfo.kind === 'tableCell' ||
    quickTextEditableBlockTypes.includes(nodeInfo.ownerBlock.type)
  );
}

function isQuickBlockStyleEditable(nodeInfo: SelectedLayoutNodeInfo | null): boolean {
  return !!nodeInfo && quickBlockStyleEditableBlockTypes.includes(nodeInfo.ownerBlock.type);
}

export function Toolbar({
  isLeftPanelOpen,
  isRightPanelOpen,
  workspaceViewMode,
  isSaving,
  isExporting,
  canUndo,
  canRedo,
  canvasTextSelection,
  onCreateDocument,
  onOpenDocument,
  onOpenFolder,
  onSaveDocument,
  onSaveDocumentAs,
  onExportPdf,
  onExportDocx,
  onUndo,
  onRedo,
  onImportFont,
  onInsertImage,
  onInsertChemistryApparatus,
  onInsertChemistryComposition,
  onInsertEquation,
  onInsertTable,
  onInsertList,
  onInsertParagraph,
  onInsertColumnBreak,
  onInsertPageBreak,
  onInsertToc,
  onToggleLeftPanel,
  onToggleRightPanel,
  onChangeViewMode,
  onOpenSearchPanel,
  onOpenAiPanel,
}: ToolbarProps): JSX.Element {
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const styleSettings = useAppStore((state) => state.styleSettings);
  const replaceLayoutNodeRichText = useAppStore((state) => state.replaceLayoutNodeRichText);
  const updateLayoutNodeText = useAppStore((state) => state.updateLayoutNodeText);
  const toggleLayoutNodeTextMark = useAppStore((state) => state.toggleLayoutNodeTextMark);
  const applyLayoutNodeTextStyle = useAppStore((state) => state.applyLayoutNodeTextStyle);
  const clearLayoutNodeTextFormatting = useAppStore((state) => state.clearLayoutNodeTextFormatting);
  const applyLayoutNodeBlockStyle = useAppStore((state) => state.applyLayoutNodeBlockStyle);
  const applyLayoutQuickTextStyle = useAppStore((state) => state.applyLayoutQuickTextStyle);
  const styleContract = resolveStyleContract(styleSettings);
  const selectedNodeInfo = getSelectedLayoutNodeInfo(layoutDocument);
  const fontFamilyGroups = buildFontFamilyGroupsWithImportedFonts(
    textFontFamilyGroups,
    layoutDocument?.resources,
  );
  const activeSelection =
    canvasTextSelection.nodeId === selectedNodeInfo?.nodeId ? canvasTextSelection.selection : null;
  const canEditTextStyle = isQuickTextStyleEditable(selectedNodeInfo);
  const canEditBlockStyle = isQuickBlockStyleEditable(selectedNodeInfo);
  const currentTextColor =
    selectedNodeInfo
      ? getQuickSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'color') ?? defaultQuickTextColor
      : defaultQuickTextColor;
  const currentHighlightColor =
    selectedNodeInfo
      ? getQuickSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'highlightColor') ??
        defaultQuickHighlightColor
      : defaultQuickHighlightColor;
  const [quickFontFamily, setQuickFontFamily] = useState(fontFamilyPlaceholderValue);
  const [quickTextStyleScope, setQuickTextStyleScope] = useState<QuickTextStyleScope>('allText');
  const [quickFontSizeDraft, setQuickFontSizeDraft] = useState('');
  const [batchQuickFontFamily, setBatchQuickFontFamily] = useState(fontFamilyPlaceholderValue);
  const [batchQuickFontSize, setBatchQuickFontSize] = useState(String(defaultQuickFontSize));
  const [isChemistryPanelOpen, setIsChemistryPanelOpen] = useState(false);
  const [isChemistryComposerOpen, setIsChemistryComposerOpen] = useState(false);
  const [chemistryCategory, setChemistryCategory] = useState<ChemistryApparatusCategory>(
    chemistryApparatusCategories[0],
  );
  const inheritedTextStyle = selectedNodeInfo
    ? resolveQuickTextStyleForBlock(selectedNodeInfo.ownerBlock, layoutDocument?.styles)
    : {};
  const currentFontFamily =
    selectedNodeInfo
      ? (getQuickSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'fontFamily') as string | undefined) ??
        inheritedTextStyle.fontFamily ??
        quickFontFamily
      : quickFontFamily;
  const quickScopeStyle = getQuickTextStyleRule(layoutDocument?.styles, quickTextStyleScope);
  const currentFontSizeLabel = resolveQuickCurrentFontSizeLabel(
    selectedNodeInfo,
    activeSelection,
    layoutDocument?.styles,
    styleContract,
  );
  const currentTextAlign = selectedNodeInfo?.ownerBlock.blockStyleOverrides.textAlign ?? 'left';
  const canApplyBatchFontFamily = !!layoutDocument && batchQuickFontFamily !== fontFamilyPlaceholderValue;
  const canApplyBatchFontSize = !!layoutDocument && normalizeQuickFontSizeValue(batchQuickFontSize) !== null;
  const visibleChemistryApparatusItems = chemistryApparatusItems.filter(
    (item) => item.category === chemistryCategory,
  );

  const syncEditingTextBeforeStyleAction = (nodeId: string) => {
    if (!canvasTextSelection.isEditing || canvasTextSelection.nodeId !== nodeId) {
      return;
    }

    // 点击顶部快捷栏前先把正在编辑的草稿写回模型，避免样式作用到旧文本。
    if (canvasTextSelection.draftTextRuns) {
      replaceLayoutNodeRichText({
        nodeId,
        textRuns: canvasTextSelection.draftTextRuns,
      });
      return;
    }

    updateLayoutNodeText({
      nodeId,
      text: canvasTextSelection.text,
    });
  };

  const handleQuickButtonMouseDown = (event: MouseEvent<HTMLButtonElement>, nodeId?: string) => {
    event.preventDefault();
    if (nodeId) {
      syncEditingTextBeforeStyleAction(nodeId);
    }
  };

  const toggleQuickTextMark = (markType: TextMarkType) => {
    if (!selectedNodeInfo || !canEditTextStyle) {
      return;
    }

    toggleLayoutNodeTextMark({
      nodeId: selectedNodeInfo.nodeId,
      selection: activeSelection,
      markType,
    });
  };

  const applyQuickTextColor = (color: string) => {
    if (!selectedNodeInfo || !canEditTextStyle) {
      return;
    }

    applyLayoutNodeTextStyle({
      nodeId: selectedNodeInfo.nodeId,
      selection: activeSelection,
      styleOverrides: { color },
    });
  };

  const applyQuickHighlightColor = (highlightColor: string) => {
    if (!selectedNodeInfo || !canEditTextStyle) {
      return;
    }

    applyLayoutNodeTextStyle({
      nodeId: selectedNodeInfo.nodeId,
      selection: activeSelection,
      styleOverrides: { highlightColor },
    });
  };

  const applyQuickFontFamily = (fontFamily: string) => {
    if (!selectedNodeInfo || !canEditTextStyle || fontFamily === fontFamilyPlaceholderValue) {
      return;
    }

    // 字体切换前先收口编辑态草稿，避免把字体写到旧文本上。
    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    applyLayoutNodeTextStyle({
      nodeId: selectedNodeInfo.nodeId,
      selection: activeSelection,
      styleOverrides: { fontFamily },
    });
  };

  const handleQuickFontFamilyChange = (fontFamily: string) => {
    if (fontFamily === fontFamilyPlaceholderValue) {
      return;
    }

    setQuickFontFamily(fontFamily);
    applyQuickFontFamily(fontFamily);
  };

  const applyQuickFontSize = (fontSize: number) => {
    if (!selectedNodeInfo || !canEditTextStyle) {
      return;
    }

    const nextFontSize = normalizeQuickFontSizeValue(fontSize);
    if (!nextFontSize) {
      return;
    }

    // Word 式即时字号只写当前选区或当前节点，批量类型规则由后面的独立入口处理。
    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    setQuickFontSizeDraft('');
    applyLayoutNodeTextStyle({
      nodeId: selectedNodeInfo.nodeId,
      selection: activeSelection,
      styleOverrides: { fontSize: nextFontSize },
    });
  };

  const commitQuickFontSizeDraft = () => {
    if (!quickFontSizeDraft.trim()) {
      return;
    }

    const nextFontSize = normalizeQuickFontSizeValue(quickFontSizeDraft);
    if (!nextFontSize) {
      setQuickFontSizeDraft('');
      return;
    }

    applyQuickFontSize(nextFontSize);
  };

  const applyQuickTextAlign = (textAlign: 'left' | 'center' | 'right' | 'justify') => {
    if (!selectedNodeInfo || !canEditBlockStyle) {
      return;
    }

    applyLayoutNodeBlockStyle({
      nodeId: selectedNodeInfo.nodeId,
      blockStyleOverrides: { textAlign },
    });
  };

  const clearQuickTextFormatting = () => {
    if (!selectedNodeInfo || !canEditTextStyle) {
      return;
    }

    clearLayoutNodeTextFormatting({
      nodeId: selectedNodeInfo.nodeId,
      selection: activeSelection,
    });
  };

  const applyQuickTextStyleFontFamilyScope = () => {
    if (!layoutDocument || batchQuickFontFamily === fontFamilyPlaceholderValue) {
      return;
    }

    // 批量字体只写 fontFamily，避免把标题、正文等既有字号一起改成同一个值。
    applyLayoutQuickTextStyle({
      scope: quickTextStyleScope,
      styleOverrides: {
        fontFamily: batchQuickFontFamily,
      },
    });
  };

  const applyQuickTextStyleFontSizeScope = () => {
    if (!layoutDocument) {
      return;
    }

    const nextFontSize = normalizeQuickFontSizeValue(batchQuickFontSize) ?? defaultQuickFontSize;
    setBatchQuickFontSize(String(nextFontSize));
    // 批量字号只写 fontSize；字体规则由“应用字体”单独处理，避免两个动作互相牵连。
    applyLayoutQuickTextStyle({
      scope: quickTextStyleScope,
      styleOverrides: {
        fontSize: nextFontSize,
      },
    });
  };

  const handleInsertPlaceholder = (label: string) => {
    window.alert(`${label}：该插入入口已预留，后续小步接入真实逻辑。`);
  };

  const toggleChemistryPanel = () => {
    if (!layoutDocument) {
      return;
    }

    setIsChemistryPanelOpen((currentValue) => !currentValue);
  };

  const insertChemistryApparatusTemplate = (apparatusId: ChemistryApparatusId) => {
    setIsChemistryPanelOpen(false);
    onInsertChemistryApparatus(apparatusId);
  };

  const openChemistryComposer = () => {
    if (!layoutDocument) {
      return;
    }

    setIsChemistryPanelOpen(false);
    setIsChemistryComposerOpen(true);
  };

  return (
    <header className="topbar">
      <div className="topbar-main">
        <div className="brand">
          <span className="brand-mark">L3</span>
          <span className="brand-name">LAYOUT3.0</span>
        </div>

        <nav className="toolbar" aria-label="主操作区">
          <ToolButton label="新建文档" onClick={onCreateDocument}>
            <FilePlus2 size={18} />
          </ToolButton>
          <ToolButton label="打开文件" onClick={onOpenDocument}>
            <FolderOpen size={18} />
          </ToolButton>
          <ToolButton label="打开文件夹" onClick={onOpenFolder}>
            <FolderOpen size={18} />
          </ToolButton>
          <ToolButton label={isSaving ? '正在保存' : '保存'} disabled={isSaving} onClick={onSaveDocument}>
            <Save size={18} />
          </ToolButton>
          <ToolButton
            label={isSaving ? '正在另存为' : '另存为'}
            disabled={isSaving}
            onClick={onSaveDocumentAs}
            title="将文档另存为新文件"
          >
            <Files size={18} />
          </ToolButton>
          <ToolButton
            label={isExporting ? '正在导出 PDF' : '导出 PDF'}
            disabled={isExporting}
            onClick={onExportPdf}
          >
            <FileDown size={18} />
          </ToolButton>
          <ToolButton
            label={isExporting ? '正在导出 DOCX' : '导出 DOCX'}
            disabled={isExporting}
            onClick={onExportDocx}
          >
            <FileDown size={18} />
          </ToolButton>
          <span className="toolbar-divider" />
          <ToolButton label="撤销" disabled={!canUndo} onClick={onUndo}>
            <Undo2 size={18} />
          </ToolButton>
          <ToolButton label="重做" disabled={!canRedo} onClick={onRedo}>
            <Redo2 size={18} />
          </ToolButton>
          <ToolButton label="搜索" onClick={onOpenSearchPanel}>
            <Search size={18} />
          </ToolButton>
        </nav>

        <div className="toolbar-view-modes" aria-label="视图模式">
          {workspaceViewModes.map((mode) => {
            const Icon = viewModeIcons[mode.id];

            return (
              <button
                key={mode.id}
                className={mode.id === workspaceViewMode ? 'view-mode-chip active' : 'view-mode-chip'}
                type="button"
                aria-pressed={mode.id === workspaceViewMode}
                title={mode.description}
                onClick={() => onChangeViewMode(mode.id)}
              >
                <Icon size={16} />
                <span>{mode.label}</span>
              </button>
            );
          })}
        </div>

        <div className="view-tools" aria-label="视图控制区">
          <ToolButton
            label={isLeftPanelOpen ? '收起左侧面板' : '展开左侧面板'}
            isActive={isLeftPanelOpen}
            onClick={onToggleLeftPanel}
          >
            <PanelLeft size={18} />
          </ToolButton>
          <ToolButton label="缩小">
            <ZoomOut size={18} />
          </ToolButton>
          <span className="zoom-label">100%</span>
          <ToolButton label="放大">
            <ZoomIn size={18} />
          </ToolButton>
          <ToolButton
            label={isRightPanelOpen ? '收起右侧面板' : '展开右侧面板'}
            isActive={isRightPanelOpen}
            onClick={onToggleRightPanel}
          >
            <PanelRight size={18} />
          </ToolButton>
          <ToolButton
            label="AI 助手"
            isActive={false}
            onClick={onOpenAiPanel}
          >
            <Sparkles size={18} />
          </ToolButton>
        </div>
      </div>

      <nav className="format-toolbar" aria-label="顶端快捷格式工具栏">
        <section className="format-toolbar-group" aria-label="字体">
          <span className="format-toolbar-title">字体</span>
          <div className="format-toolbar-controls">
            <label className={layoutDocument ? 'format-select-shell' : 'format-select-shell disabled'}>
              <Type size={15} />
              <select
                className="format-select-input"
                aria-label="字体家族"
                disabled={!layoutDocument}
                value={currentFontFamily}
                onChange={(event) => handleQuickFontFamilyChange(event.target.value)}
              >
                <option value={fontFamilyPlaceholderValue} disabled>
                  字体
                </option>
                {fontFamilyGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="format-icon-button"
              title="导入字体"
              aria-label="导入字体"
              onClick={onImportFont}
            >
              <FileUp size={17} />
            </button>
            <label className={canEditTextStyle ? 'format-select-shell compact' : 'format-select-shell compact disabled'}>
              <select
                className="format-select-input"
                aria-label="当前文字字号预设"
                disabled={!canEditTextStyle}
                value={quickFontSizePresetOptions.includes(Number(currentFontSizeLabel)) ? currentFontSizeLabel : ''}
                onChange={(event) => {
                  if (!event.target.value) {
                    return;
                  }

                  applyQuickFontSize(Number(event.target.value));
                }}
              >
                <option value="">
                  {currentFontSizeLabel ? `${currentFontSizeLabel}px` : '字号'}
                </option>
                {quickFontSizePresetOptions.map((fontSize) => (
                  <option key={`quick-font-size-${fontSize}`} value={fontSize}>
                    {fontSize}px
                  </option>
                ))}
              </select>
            </label>
            <input
              className="format-number-input"
              type="number"
              min={10}
              max={72}
              step={1}
              aria-label="当前文字字号"
              disabled={!canEditTextStyle}
              value={quickFontSizeDraft}
              placeholder={currentFontSizeLabel || '字号'}
              onMouseDown={() => {
                if (selectedNodeInfo) {
                  syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
                }
              }}
              onChange={(event) => setQuickFontSizeDraft(event.target.value)}
              onBlur={commitQuickFontSizeDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
            />
            {quickTextMarkOptions.map((option) => {
              const Icon = option.icon;
              const isActive = selectedNodeInfo
                ? isQuickTextMarkActive(selectedNodeInfo.textRuns, activeSelection, option.id)
                : false;

              return (
                <button
                  key={option.id}
                  type="button"
                  className={isActive ? 'format-icon-button active' : 'format-icon-button'}
                  disabled={!canEditTextStyle}
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={isActive}
                  onMouseDown={(event) => handleQuickButtonMouseDown(event, selectedNodeInfo?.nodeId)}
                  onClick={() => toggleQuickTextMark(option.id)}
                >
                  <Icon size={17} />
                </button>
              );
            })}
            <span className="format-color-label text-color-mark" aria-hidden="true">A</span>
            <div className="format-swatch-list" aria-label="文字颜色">
              {standardColorOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={canEditTextStyle && currentTextColor === option.value ? 'format-swatch active' : 'format-swatch'}
                  disabled={!canEditTextStyle}
                  title={`文字颜色：${option.label}`}
                  aria-label={`文字颜色：${option.label}`}
                  onMouseDown={(event) => handleQuickButtonMouseDown(event, selectedNodeInfo?.nodeId)}
                  onClick={() => applyQuickTextColor(option.value)}
                >
                  <span style={{ backgroundColor: option.value }} />
                </button>
              ))}
            </div>
            <span className="format-color-label highlight-mark" aria-hidden="true">
              <Highlighter size={14} />
            </span>
            <div className="format-swatch-list" aria-label="高亮颜色">
              {highlightColorOptions.map((option) => (
                <button
                  key={`highlight-${option.value}`}
                  type="button"
                  className={
                    canEditTextStyle && currentHighlightColor === option.value ? 'format-swatch active' : 'format-swatch'
                  }
                  disabled={!canEditTextStyle}
                  title={`高亮颜色：${option.label}`}
                  aria-label={`高亮颜色：${option.label}`}
                  onMouseDown={(event) => handleQuickButtonMouseDown(event, selectedNodeInfo?.nodeId)}
                  onClick={() => applyQuickHighlightColor(option.value)}
                >
                  <span style={{ backgroundColor: option.value }} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className="format-clear-button"
              disabled={!canEditTextStyle}
              title="清除文字格式"
              aria-label="清除文字格式"
              onMouseDown={(event) => handleQuickButtonMouseDown(event, selectedNodeInfo?.nodeId)}
              onClick={clearQuickTextFormatting}
            >
              <Eraser size={15} />
              <span>清除</span>
            </button>
          </div>
        </section>

        <section className="format-toolbar-group batch-format-group" aria-label="批量字体字号">
          <span className="format-toolbar-title">批量</span>
          <div className="format-toolbar-controls">
            <label className={layoutDocument ? 'format-select-shell' : 'format-select-shell disabled'}>
              <Type size={15} />
              <select
                className="format-select-input"
                aria-label="批量规则字体"
                disabled={!layoutDocument}
                value={batchQuickFontFamily}
                onChange={(event) => {
                  if (event.target.value === fontFamilyPlaceholderValue) {
                    return;
                  }

                  setBatchQuickFontFamily(event.target.value);
                }}
              >
                <option value={fontFamilyPlaceholderValue} disabled>
                  字体
                </option>
                {fontFamilyGroups.map((group) => (
                  <optgroup key={`batch-${group.label}`} label={group.label}>
                    {group.options.map((option) => (
                      <option key={`batch-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className={layoutDocument ? 'format-select-shell compact' : 'format-select-shell compact disabled'}>
              <select
                className="format-select-input"
                aria-label="批量应用范围"
                disabled={!layoutDocument}
                value={quickTextStyleScope}
                onChange={(event) => setQuickTextStyleScope(event.target.value as QuickTextStyleScope)}
              >
                {quickTextStyleScopeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="format-number-input"
              type="number"
              min={10}
              max={72}
              step={1}
              aria-label="批量规则字号"
              disabled={!layoutDocument}
              value={batchQuickFontSize}
              placeholder={quickScopeStyle.fontSize ? String(quickScopeStyle.fontSize) : '字号'}
              onChange={(event) => setBatchQuickFontSize(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  applyQuickTextStyleFontSizeScope();
                }
              }}
            />
            <button
              type="button"
              className="format-select-button format-apply-button"
              disabled={!canApplyBatchFontFamily}
              title="按所选范围只应用字体规则"
              aria-label="应用批量字体规则"
              onClick={applyQuickTextStyleFontFamilyScope}
            >
              <Type size={15} />
              <span>应用字体</span>
            </button>
            <button
              type="button"
              className="format-select-button format-apply-button"
              disabled={!canApplyBatchFontSize}
              title="按所选范围只应用字号规则"
              aria-label="应用批量字号规则"
              onClick={applyQuickTextStyleFontSizeScope}
            >
              <Type size={15} />
              <span>应用字号</span>
            </button>
          </div>
        </section>

        <section className="format-toolbar-group paragraph-group" aria-label="段落">
          <span className="format-toolbar-title">段落</span>
          <div className="format-toolbar-controls">
            {quickParagraphAlignOptions.map((option) => {
              const Icon = option.icon;
              const isActive = canEditBlockStyle && currentTextAlign === option.id;

              return (
                <button
                  key={option.id}
                  type="button"
                  className={isActive ? 'format-icon-button active' : 'format-icon-button'}
                  disabled={!canEditBlockStyle}
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={isActive}
                  onMouseDown={(event) => handleQuickButtonMouseDown(event, selectedNodeInfo?.nodeId)}
                  onClick={() => applyQuickTextAlign(option.id)}
                >
                  <Icon size={17} />
                </button>
              );
            })}
          </div>
        </section>

        <section className="format-toolbar-group list-group" aria-label="列表">
          <span className="format-toolbar-title">列表</span>
          <div className="format-toolbar-controls">
            {quickListInsertOptions.map((option) => {
              const Icon = option.icon;

              return (
                <button
                  key={option.id}
                  type="button"
                  className="format-icon-button"
                  title={option.label}
                  aria-label={option.label}
                  onClick={() => onInsertList(option.id)}
                >
                  <Icon size={17} />
                </button>
              );
            })}
          </div>
        </section>

        <section className="format-toolbar-group insert-group" aria-label="插入">
          <span className="format-toolbar-title">插入</span>
          <div className="format-toolbar-controls">
            <button
              type="button"
              className="format-icon-button"
              title="插入图片"
              aria-label="插入图片"
              onClick={onInsertImage}
            >
              <ImagePlus size={17} />
            </button>
            <button
              type="button"
              className={
                isChemistryPanelOpen
                  ? 'format-select-button chemistry-apparatus-trigger active'
                  : 'format-select-button chemistry-apparatus-trigger'
              }
              title="插入化学图式"
              aria-label="插入化学图式"
              aria-expanded={isChemistryPanelOpen}
              disabled={!layoutDocument}
              onClick={toggleChemistryPanel}
            >
              <FlaskConical size={15} />
              <span>化学图式</span>
            </button>
            <button
              type="button"
              className="format-icon-button"
              title="插入公式"
              aria-label="插入公式"
              onClick={onInsertEquation}
            >
              <Sigma size={17} />
            </button>
            <button
              type="button"
              className="format-select-button format-insert-text-button"
              title="插入空文本块"
              aria-label="插入空文本块"
              onClick={onInsertParagraph}
            >
              <TextCursorInput size={17} />
              <span>空文本块</span>
            </button>
            <button
              type="button"
              className="format-select-button format-insert-text-button"
              title="插入目录"
              aria-label="插入目录"
              onClick={onInsertToc}
            >
              <ListTree size={17} />
              <span>目录</span>
            </button>
            <button
              type="button"
              className="format-icon-button"
              title="插入表格"
              aria-label="插入表格"
              onClick={onInsertTable}
            >
              <Table2 size={17} />
            </button>
            <button
              type="button"
              className="format-select-button format-insert-text-button"
              title="插入分栏断点"
              aria-label="插入分栏断点"
              onClick={onInsertColumnBreak}
            >
              <Columns2 size={17} />
              <span>分栏断点</span>
            </button>
            <button
              type="button"
              className="format-select-button format-insert-text-button"
              title="插入分页符"
              aria-label="插入分页符"
              onClick={onInsertPageBreak}
            >
              <Pilcrow size={17} />
              <span>分页符</span>
            </button>
            {insertPlaceholderOptions.map((option) => {
              const Icon = option.icon;

              return (
                <button
                  key={option.id}
                  type="button"
                  className="format-icon-button insert-placeholder-button"
                  title={`${option.label}：后续接入`}
                  aria-label={`${option.label}：后续接入`}
                  onClick={() => handleInsertPlaceholder(option.label)}
                >
                  <Icon size={17} />
                </button>
              );
            })}
          </div>
        </section>
      </nav>

      {isChemistryPanelOpen && layoutDocument ? (
        <div className="chemistry-apparatus-panel" role="dialog" aria-label="化学图式模板库">
          <div className="chemistry-apparatus-panel-head">
            <strong>化学图式</strong>
            <div className="chemistry-apparatus-panel-actions">
              <button
                type="button"
                className="chemistry-composer-open-button"
                title="打开化学图式组合设计器"
                aria-label="打开化学图式组合设计器"
                onClick={openChemistryComposer}
              >
                <PanelsTopLeft size={15} />
                <span>组合设计</span>
              </button>
              <button
                type="button"
                className="chemistry-apparatus-close"
                title="关闭化学图式面板"
                aria-label="关闭化学图式面板"
                onClick={() => setIsChemistryPanelOpen(false)}
              >
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="chemistry-apparatus-tabs" role="tablist" aria-label="化学图式分类">
            {chemistryApparatusCategories.map((category) => (
              <button
                key={category}
                type="button"
                className={category === chemistryCategory ? 'active' : ''}
                role="tab"
                aria-selected={category === chemistryCategory}
                onClick={() => setChemistryCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
          <div className="chemistry-apparatus-grid">
            {visibleChemistryApparatusItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="chemistry-apparatus-card"
                title={`${item.description}；${item.sourceLabel}，授权：${item.license}`}
                onClick={() => insertChemistryApparatusTemplate(item.id)}
              >
                <span className="chemistry-apparatus-thumb" aria-hidden="true">
                  <img src={item.src} alt="" />
                </span>
                <span className="chemistry-apparatus-name">{item.name}</span>
                <span className="chemistry-apparatus-source">{item.license}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ChemistryComposerDialog
        isOpen={isChemistryComposerOpen && !!layoutDocument}
        onClose={() => setIsChemistryComposerOpen(false)}
        onInsertComposition={onInsertChemistryComposition}
      />
    </header>
  );
}
