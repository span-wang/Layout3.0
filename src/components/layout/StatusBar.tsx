import type { ParseState } from '@/engine/parser/types';
import type { WorkspaceViewMode } from '@/types/workspace';

interface StatusBarProps {
  parseState: ParseState;
  sourceLength: number;
  pageCount: number;
  workspaceViewMode: WorkspaceViewMode;
  saveStatusLabel: string;
}

function getStatusLabel(parseState: ParseState): string {
  switch (parseState) {
    case 'parsing':
      return '解析中';
    case 'ready':
      return '解析完成';
    case 'error':
      return '解析异常';
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
  sourceLength,
  pageCount,
  workspaceViewMode,
  saveStatusLabel,
}: StatusBarProps): JSX.Element {
  return (
    <footer className="statusbar">
      <div className="statusbar-group">
        <span>{sourceLength} 字符</span>
        <span>{pageCount} 页</span>
      </div>
      <div className="statusbar-group">
        <span>{saveStatusLabel}</span>
        <span>{getViewModeLabel(workspaceViewMode)}</span>
        <span>{getStatusLabel(parseState)}</span>
      </div>
    </footer>
  );
}
