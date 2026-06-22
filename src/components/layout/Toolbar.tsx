import {
  FileDown,
  FilePlus2,
  Files,
  FolderOpen,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  RectangleHorizontal,
  Redo2,
  Save,
  Search,
  SquareSplitHorizontal,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ToolButton } from '@/components/common/ToolButton';
import { workspaceViewModes } from '@/constants/workspace';
import type { WorkspaceViewMode } from '@/types/workspace';

interface ToolbarProps {
  isLeftPanelOpen: boolean;
  isRightPanelOpen: boolean;
  workspaceViewMode: WorkspaceViewMode;
  isSaving: boolean;
  isExporting: boolean;
  onCreateDocument: () => void;
  onOpenDocument: () => void;
  onOpenFolder: () => void;
  onSaveDocument: () => void;
  onSaveDocumentAs: () => void;
  onExportPdf: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
}

const viewModeIcons: Record<WorkspaceViewMode, typeof PanelsTopLeft> = {
  source: PanelsTopLeft,
  split: SquareSplitHorizontal,
  preview: RectangleHorizontal,
};

export function Toolbar({
  isLeftPanelOpen,
  isRightPanelOpen,
  workspaceViewMode,
  isSaving,
  isExporting,
  onCreateDocument,
  onOpenDocument,
  onOpenFolder,
  onSaveDocument,
  onSaveDocumentAs,
  onExportPdf,
  onToggleLeftPanel,
  onToggleRightPanel,
  onChangeViewMode,
}: ToolbarProps): JSX.Element {
  return (
    <header className="topbar">
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
    </header>
  );
}
