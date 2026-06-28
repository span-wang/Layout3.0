import type { TextRangeSelection, TextRun } from '@/engine/document-model';

export type LeftPanelTab = '文件' | '大纲' | '搜索' | '资源' | 'AI生成记录';

export type WorkspaceViewMode = 'source' | 'split' | 'preview';

export type PageSettingsTab =
  | '页面规格'
  | '页边距'
  | '页眉页脚预留'
  | '分栏'
  | '块排版'
  | '模板起点'
  | '分页策略';

export type PreviewBlock =
  | {
      type: 'heading';
      text: string;
    }
  | {
      type: 'paragraph';
      text: string;
    }
  | {
      type: 'list';
      items: string[];
    };

export interface WorkspaceFileItem {
  id: string;
  name: string;
  path?: string | null;
  isActive?: boolean;
}

export interface RecentFileEntry {
  filePath: string;
  title: string;
  lastOpenedAt: number;
}

export type WorkspaceEntryKind = 'file' | 'directory';

export interface WorkspaceDirectoryEntry {
  id: string;
  name: string;
  path: string;
  kind: WorkspaceEntryKind;
  isActive?: boolean;
  children?: WorkspaceDirectoryEntry[];
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface TemplateOption {
  id: string;
  name: string;
}

export interface CanvasTextSelectionState {
  nodeId: string | null;
  text: string;
  selection: TextRangeSelection | null;
  isEditing: boolean;
  draftTextRuns: TextRun[] | null;
}
