import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  FileDown,
  FilePlus2,
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
  RectangleHorizontal,
  Redo2,
  Save,
  Search,
  Sigma,
  SquareSplitHorizontal,
  StickyNote,
  Strikethrough,
  Table2,
  TextCursorInput,
  Type,
  Underline,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { ToolButton } from '@/components/common/ToolButton';
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
import { useAppStore } from '@/store';
import type { CanvasTextSelectionState, WorkspaceViewMode } from '@/types/workspace';

interface ToolbarProps {
  isLeftPanelOpen: boolean;
  isRightPanelOpen: boolean;
  workspaceViewMode: WorkspaceViewMode;
  isSaving: boolean;
  isExporting: boolean;
  canvasTextSelection: CanvasTextSelectionState;
  onCreateDocument: () => void;
  onOpenDocument: () => void;
  onOpenFolder: () => void;
  onSaveDocument: () => void;
  onSaveDocumentAs: () => void;
  onExportPdf: () => void;
  onInsertImage: () => void;
  onInsertEquation: () => void;
  onInsertTable: () => void;
  onInsertList: (kind: InsertListBlockKind) => void;
  onInsertToc: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
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

const insertPlaceholderMessage = '该插入入口已预留，后续小步接入真实逻辑。';
const insertPlaceholderOptions: Array<{
  id: 'stickyNote' | 'emptyText';
  label: string;
  icon: typeof StickyNote;
}> = [
  { id: 'stickyNote', label: '便利贴', icon: StickyNote },
  { id: 'emptyText', label: '空文本块', icon: TextCursorInput },
];

const quickTextEditableBlockTypes: LayoutBlock['type'][] = ['heading', 'paragraph', 'code'];
const quickBlockStyleEditableBlockTypes: LayoutBlock['type'][] = ['heading', 'paragraph', 'code', 'list', 'table'];
const defaultQuickTextColor = '#344054';
const defaultQuickHighlightColor = '#FEF08A';

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
  key: 'color' | 'highlightColor' | 'fontFamily',
): string | undefined {
  const selectedRuns = collectQuickSelectedRuns(textRuns, selection);
  if (selectedRuns.length === 0) {
    return undefined;
  }

  const firstValue = selectedRuns[0].styleOverrides[key];
  const isShared = selectedRuns.every((run) => run.styleOverrides[key] === firstValue);
  return isShared ? firstValue : undefined;
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
  canvasTextSelection,
  onCreateDocument,
  onOpenDocument,
  onOpenFolder,
  onSaveDocument,
  onSaveDocumentAs,
  onExportPdf,
  onInsertImage,
  onInsertEquation,
  onInsertTable,
  onInsertList,
  onInsertToc,
  onToggleLeftPanel,
  onToggleRightPanel,
  onChangeViewMode,
}: ToolbarProps): JSX.Element {
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const replaceLayoutNodeRichText = useAppStore((state) => state.replaceLayoutNodeRichText);
  const updateLayoutNodeText = useAppStore((state) => state.updateLayoutNodeText);
  const toggleLayoutNodeTextMark = useAppStore((state) => state.toggleLayoutNodeTextMark);
  const applyLayoutNodeTextStyle = useAppStore((state) => state.applyLayoutNodeTextStyle);
  const clearLayoutNodeTextFormatting = useAppStore((state) => state.clearLayoutNodeTextFormatting);
  const applyLayoutNodeBlockStyle = useAppStore((state) => state.applyLayoutNodeBlockStyle);
  const selectedNodeInfo = getSelectedLayoutNodeInfo(layoutDocument);
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
  const currentFontFamily =
    selectedNodeInfo
      ? getQuickSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'fontFamily') ??
        fontFamilyPlaceholderValue
      : fontFamilyPlaceholderValue;
  const currentTextAlign = selectedNodeInfo?.ownerBlock.blockStyleOverrides.textAlign ?? 'left';

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

  const handleInsertPlaceholder = (label: string) => {
    window.alert(`${label}：${insertPlaceholderMessage}`);
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
          <span className="toolbar-divider" />
          <ToolButton label="撤销">
            <Undo2 size={18} />
          </ToolButton>
          <ToolButton label="重做">
            <Redo2 size={18} />
          </ToolButton>
          <ToolButton label="搜索">
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
        </div>
      </div>

      <nav className="format-toolbar" aria-label="顶端快捷格式工具栏">
        <section className="format-toolbar-group" aria-label="字体">
          <span className="format-toolbar-title">字体</span>
          <div className="format-toolbar-controls">
            <label className={canEditTextStyle ? 'format-select-shell' : 'format-select-shell disabled'}>
              <Type size={15} />
              <select
                className="format-select-input"
                aria-label="字体家族"
                disabled={!canEditTextStyle}
                value={currentFontFamily}
                onChange={(event) => applyQuickFontFamily(event.target.value)}
              >
                <option value={fontFamilyPlaceholderValue} disabled>
                  字体
                </option>
                {textFontFamilyGroups.map((group) => (
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
    </header>
  );
}
