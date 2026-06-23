import type { ParseState } from '@/engine/document-model';
import type { WorkspaceViewMode } from '@/types/workspace';

interface StatusBarProps {
  parseState: ParseState;
  characterCount: number;
  pageCount: number;
  workspaceViewMode: WorkspaceViewMode;
  saveStatusLabel: string;
  pageLabel: string;
  templateLabel: string;
  layoutWarningCount: number;
}

function getStatusLabel(parseState: ParseState): string {
  switch (parseState) {
    case 'parsing':
      return '导入中';
    case 'ready':
      return '模型就绪';
    case 'error':
      return '导入异常';
    default:
      return '待命';
  }
}

function getViewModeLabel(workspaceViewMode: WorkspaceViewMode): string {
  switch (workspaceViewMode) {
    case 'source':
      return '源码视图';
    case 'preview':
      return '预览视图';
    default:
      return '分屏视图';
  }
}

export function StatusBar({
  parseState,
  characterCount,
  pageCount,
  workspaceViewMode,
  saveStatusLabel,
  pageLabel,
  templateLabel,
  layoutWarningCount,
}: StatusBarProps): JSX.Element {
  return (
    <footer className="statusbar">
      <div className="statusbar-group">
        <span>{characterCount} 字符</span>
        <span>{pageCount} 页</span>
        <span>{pageLabel}</span>
      </div>
      <div className="statusbar-group">
        <span>{saveStatusLabel}</span>
        <span>{templateLabel}</span>
        <span>{getViewModeLabel(workspaceViewMode)}</span>
        <span className={layoutWarningCount > 0 ? 'statusbar-warning is-alert' : 'statusbar-warning'}>
          {layoutWarningCount > 0 ? `排版异常 ${layoutWarningCount} 条` : '排版正常'}
        </span>
        <span>{getStatusLabel(parseState)}</span>
      </div>
    </footer>
  );
}
