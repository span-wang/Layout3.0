export type LeftPanelTab = '文件' | '大纲' | '搜索' | '资源';

export type WorkspaceViewMode = 'source' | 'split' | 'preview';

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
