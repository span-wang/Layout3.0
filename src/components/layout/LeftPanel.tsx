import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronRight,
  ChevronsDownUp,
  Clock,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Images,
  ListTree,
  Search,
  X,
} from 'lucide-react';
import { ContextMenu, type ContextMenuEntry } from '@/components/common/ContextMenu';
import { emptyFolderHints, outlineTips, resourceHints, searchHints } from '@/constants/workspace';
import type { TocItem } from '@/engine/parser/types';
import type {
  LeftPanelTab,
  RecentFileEntry,
  WorkspaceDirectoryEntry,
} from '@/types/workspace';

type SortDirection = 'asc' | 'desc';

const leftPanelRailItems: Array<{
  tab: LeftPanelTab;
  icon: typeof FolderOpen;
  description: string;
}> = [
  { tab: '文件', icon: FolderOpen, description: '文件管理' },
  { tab: '大纲', icon: ListTree, description: '文档大纲' },
  { tab: '搜索', icon: Search, description: '内容搜索' },
  { tab: '资源', icon: Images, description: '资源素材' },
];

interface LeftPanelProps {
  activeTab: LeftPanelTab;
  onTabChange: (tab: LeftPanelTab) => void;
  tocItems: TocItem[];
  currentFilePath: string | null;
  currentDirectoryName: string;
  directoryEntries: WorkspaceDirectoryEntry[];
  recentFiles: RecentFileEntry[];
  onOpenFolder: () => void;
  onCreateFolder: (parentPath?: string | null) => void;
  onCreateMarkdownFile: (parentPath?: string | null) => void;
  onOpenEntry: (entry: WorkspaceDirectoryEntry) => void;
  onOpenRecentFile: (entry: RecentFileEntry) => void;
  onRemoveRecentFile: (filePath: string) => void;
  onClearRecentFiles: () => void;
  onRenameEntry: (entry: WorkspaceDirectoryEntry, nextName: string) => void;
  onDeleteEntry: (entry: WorkspaceDirectoryEntry) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  dragSource: string | null;
  onDragStart: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void;
  onDrop: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void;
}

interface DirectoryTreeRowProps {
  entry: WorkspaceDirectoryEntry;
  activeFilePath: string | null;
  depth: number;
  expandedFolderPath: string | null;
  onToggleFolder: (entry: WorkspaceDirectoryEntry) => void;
  renamingPath: string | null;
  onRenameHandled: () => void;
  onOpenEntry: (entry: WorkspaceDirectoryEntry) => void;
  onRenameEntry: (entry: WorkspaceDirectoryEntry, nextName: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: WorkspaceDirectoryEntry) => void;
  dragSource: string | null;
  onDragStart: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void;
  onDrop: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void;
}

function entryContainsPath(entry: WorkspaceDirectoryEntry, targetPath: string | null): boolean {
  if (!targetPath || entry.kind !== 'directory' || !entry.children) {
    return false;
  }

  return entry.children.some((child) => child.path === targetPath || entryContainsPath(child, targetPath));
}

function entryListContainsPath(entries: WorkspaceDirectoryEntry[], targetPath: string | null): boolean {
  if (!targetPath) {
    return false;
  }

  return entries.some((entry) => entry.path === targetPath || entryContainsPath(entry, targetPath));
}

function sortDirectoryEntries(
  entries: WorkspaceDirectoryEntry[],
  direction: SortDirection,
): WorkspaceDirectoryEntry[] {
  return entries
    .map((entry) => ({
      ...entry,
      children: entry.children ? sortDirectoryEntries(entry.children, direction) : undefined,
    }))
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1;
      }

      const result = left.name.localeCompare(right.name, 'zh-CN');
      return direction === 'asc' ? result : -result;
    });
}

function DirectoryTreeRow({
  entry,
  activeFilePath,
  depth,
  expandedFolderPath,
  onToggleFolder,
  renamingPath,
  onRenameHandled,
  onOpenEntry,
  onRenameEntry,
  onContextMenu,
  dragSource,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: DirectoryTreeRowProps): JSX.Element {
  const isFolder = entry.kind === 'directory';
  const shouldRevealExpandedFolder = entryContainsPath(entry, expandedFolderPath);
  const expanded = isFolder && (entry.path === expandedFolderPath || shouldRevealExpandedFolder);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(entry.name);
  const [isDragOver, setIsDragOver] = useState(false);

  const isActive = entry.path === activeFilePath;
  const isDragging = dragSource === entry.path;
  const canDrop = isFolder && dragSource !== entry.path;

  useEffect(() => {
    if (renamingPath === entry.path) {
      setEditName(entry.name);
      setIsEditing(true);
      onRenameHandled();
    }
  }, [entry.name, entry.path, onRenameHandled, renamingPath]);

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== entry.name) {
      onRenameEntry(entry, trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitRename();
    } else if (e.key === 'Escape') {
      setEditName(entry.name);
      setIsEditing(false);
    }
  };

  const handleRowClick = () => {
    if (isEditing) return;

    if (isFolder) {
      onToggleFolder(entry);
      return;
    }

    onOpenEntry(entry);
  };

  const handleDragStartEvent = (e: React.DragEvent) => onDragStart(e, entry);

  const handleDragOverEvent = (e: React.DragEvent) => {
    if (!canDrop) return;
    e.preventDefault();
    setIsDragOver(true);
    onDragOver(e, entry);
  };

  const handleDropEvent = (e: React.DragEvent) => {
    setIsDragOver(false);
    onDrop(e, entry);
  };

  const rowClassName = [
    'directory-row',
    isActive ? 'active' : '',
    isDragging ? 'dragging' : '',
    isDragOver ? 'drag-over' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="tree-node">
      <div
        className={rowClassName}
        draggable={!isEditing}
        onClick={handleRowClick}
        onDragStart={handleDragStartEvent}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOverEvent}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDropEvent}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, entry);
        }}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        role="treeitem"
        aria-expanded={isFolder ? expanded : undefined}
        aria-selected={isActive}
      >
        {isFolder ? (
          <span className={expanded ? 'tree-chevron expanded' : 'tree-chevron'}>
            <ChevronRight size={16} />
          </span>
        ) : (
          <span className="tree-chevron-spacer" />
        )}

        {isFolder ? (
          expanded ? (
            <FolderOpen size={15} className="entry-icon folder-icon" />
          ) : (
            <Folder size={15} className="entry-icon folder-icon" />
          )
        ) : (
          <FileText size={15} className="entry-icon file-icon" />
        )}

        {isEditing ? (
          <input
            className="tree-rename-input"
            type="text"
            value={editName}
            autoFocus
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="directory-name">{entry.name}</span>
        )}
      </div>

      {isFolder && expanded && entry.children && entry.children.length > 0 ? (
        <div className="tree-children" role="group">
          {entry.children.map((child) => (
            <DirectoryTreeRow
              key={child.id}
              entry={child}
              activeFilePath={activeFilePath}
              depth={depth + 1}
              expandedFolderPath={expandedFolderPath}
              onToggleFolder={onToggleFolder}
              renamingPath={renamingPath}
              onRenameHandled={onRenameHandled}
              onOpenEntry={onOpenEntry}
              onRenameEntry={onRenameEntry}
              onContextMenu={onContextMenu}
              dragSource={dragSource}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDrop={onDrop}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderExplorerActions({
  currentDirectoryName,
  sortDirection,
  onOpenFolder,
  onCreateFolder,
  onCreateMarkdownFile,
  onToggleSort,
  onCollapseAll,
  onOpenSearch,
}: {
  currentDirectoryName: string;
  sortDirection: SortDirection;
  onOpenFolder: () => void;
  onCreateFolder: () => void;
  onCreateMarkdownFile: () => void;
  onToggleSort: () => void;
  onCollapseAll: () => void;
  onOpenSearch: () => void;
}): JSX.Element {
  const SortIcon = sortDirection === 'asc' ? ArrowDownAZ : ArrowUpAZ;
  const hasWorkspace = currentDirectoryName !== '未打开文件夹';

  return (
    <div className="explorer-actionbar" aria-label="文件管理操作">
      <button
        type="button"
        className="explorer-icon-button"
        title="新建 Markdown"
        aria-label="新建 Markdown"
        onClick={onCreateMarkdownFile}
      >
        <FilePlus2 size={19} />
      </button>
      <button
        type="button"
        className="explorer-icon-button"
        title="新建文件夹"
        aria-label="新建文件夹"
        onClick={onCreateFolder}
      >
        <FolderPlus size={19} />
      </button>
      <button
        type="button"
        className="explorer-icon-button"
        title={sortDirection === 'asc' ? '按名称倒序' : '按名称正序'}
        aria-label={sortDirection === 'asc' ? '按名称倒序' : '按名称正序'}
        disabled={!hasWorkspace}
        onClick={onToggleSort}
      >
        <SortIcon size={19} />
      </button>
      <button
        type="button"
        className="explorer-icon-button"
        title="折叠全部"
        aria-label="折叠全部"
        disabled={!hasWorkspace}
        onClick={onCollapseAll}
      >
        <ChevronsDownUp size={19} />
      </button>
      <button
        type="button"
        className="explorer-icon-button"
        title="搜索文件"
        aria-label="搜索文件"
        onClick={onOpenSearch}
      >
        <Search size={19} />
      </button>
      <button
        type="button"
        className="explorer-icon-button explorer-open-folder"
        title="打开文件夹"
        aria-label="打开文件夹"
        onClick={onOpenFolder}
      >
        <FolderOpen size={19} />
      </button>
    </div>
  );
}

function renderLeftPanelRail(
  activeTab: LeftPanelTab,
  onTabChange: (tab: LeftPanelTab) => void,
): JSX.Element {
  return (
    <nav className="left-sidebar-rail" aria-label="左侧板块切换">
      {leftPanelRailItems.map(({ tab, icon: Icon, description }) => {
        const isActive = tab === activeTab;

        return (
          <button
            key={tab}
            type="button"
            className={isActive ? 'left-sidebar-rail-button active' : 'left-sidebar-rail-button'}
            aria-pressed={isActive}
            aria-label={`${tab}面板`}
            title={description}
            onClick={() => onTabChange(tab)}
          >
            <span className="left-sidebar-rail-icon">
              <Icon size={20} />
            </span>
            <span className="left-sidebar-rail-label">{tab}</span>
          </button>
        );
      })}
    </nav>
  );
}

function renderFileExplorer({
  directoryEntries,
  currentFilePath,
  currentDirectoryName,
  expandedFolderPath,
  onToggleFolder,
  renamingPath,
  onRenameHandled,
  onOpenFolder,
  onOpenEntry,
  onRenameEntry,
  onContextMenu,
  dragSource,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  directoryEntries: WorkspaceDirectoryEntry[];
  currentFilePath: string | null;
  currentDirectoryName: string;
  expandedFolderPath: string | null;
  onToggleFolder: (entry: WorkspaceDirectoryEntry) => void;
  renamingPath: string | null;
  onRenameHandled: () => void;
  onOpenFolder: () => void;
  onOpenEntry: (entry: WorkspaceDirectoryEntry) => void;
  onRenameEntry: (entry: WorkspaceDirectoryEntry, nextName: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: WorkspaceDirectoryEntry) => void;
  dragSource: string | null;
  onDragStart: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void;
  onDrop: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void;
}): JSX.Element {
  if (currentDirectoryName === '未打开文件夹') {
    return (
      <div className="explorer-tree-shell">
        <div className="explorer-empty">
          <p>正在准备默认工作区...</p>
        </div>
      </div>
    );
  }

  if (directoryEntries.length === 0) {
    return (
      <div className="explorer-tree-shell">
        <div className="explorer-root-row" title={currentDirectoryName}>
          <FolderOpen size={15} className="entry-icon folder-icon" />
          <span>{currentDirectoryName}</span>
        </div>
        <div className="explorer-empty">
          {emptyFolderHints.map((hint) => (
            <p key={hint}>{hint}</p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="explorer-tree-shell">
      <div className="explorer-root-row" title={currentDirectoryName}>
        <FolderOpen size={15} className="entry-icon folder-icon" />
        <span>{currentDirectoryName}</span>
      </div>
      <div className="directory-tree obsidian-directory-tree" role="tree">
        {directoryEntries.map((entry) => (
          <DirectoryTreeRow
            key={entry.id}
            entry={entry}
            activeFilePath={currentFilePath}
            depth={0}
            expandedFolderPath={expandedFolderPath}
            onToggleFolder={onToggleFolder}
            renamingPath={renamingPath}
            onRenameHandled={onRenameHandled}
            onOpenEntry={onOpenEntry}
            onRenameEntry={onRenameEntry}
            onContextMenu={onContextMenu}
            dragSource={dragSource}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
          />
        ))}
      </div>
    </div>
  );
}

function renderPanelContent(
  activeTab: LeftPanelTab,
  tocItems: TocItem[],
  recentFiles: RecentFileEntry[],
  currentFilePath: string | null,
  currentDirectoryName: string,
  directoryEntries: WorkspaceDirectoryEntry[],
  expandedFolderPath: string | null,
  onToggleFolder: (entry: WorkspaceDirectoryEntry) => void,
  renamingPath: string | null,
  onRenameHandled: () => void,
  onOpenFolder: () => void,
  onOpenEntry: (entry: WorkspaceDirectoryEntry) => void,
  onOpenRecentFile: (entry: RecentFileEntry) => void,
  onRemoveRecentFile: (filePath: string) => void,
  onClearRecentFiles: () => void,
  onRenameEntry: (entry: WorkspaceDirectoryEntry, nextName: string) => void,
  onContextMenu: (e: React.MouseEvent, entry: WorkspaceDirectoryEntry) => void,
  searchQuery: string,
  onSearchQueryChange: (q: string) => void,
  dragSource: string | null,
  onDragStart: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void,
  onDragEnd: () => void,
  onDragOver: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void,
  onDrop: (e: React.DragEvent, entry: WorkspaceDirectoryEntry) => void,
): JSX.Element {
  switch (activeTab) {
    case '文件':
      return renderFileExplorer({
        directoryEntries,
        currentFilePath,
        currentDirectoryName,
        expandedFolderPath,
        onToggleFolder,
        renamingPath,
        onRenameHandled,
        onOpenFolder,
        onOpenEntry,
        onRenameEntry,
        onContextMenu,
        dragSource,
        onDragStart,
        onDragEnd,
        onDragOver,
        onDrop,
      });

    case '大纲':
      return (
        <div className="panel-section-list">
          <section className="panel-section">
            <div className="panel-section-header">
              <h2>文档大纲</h2>
              <span>{tocItems.length} 个标题</span>
            </div>
            {tocItems.length > 0 ? (
              <div className="outline-list">
                {tocItems.map((item) => (
                  <button
                    className="outline-row"
                    type="button"
                    key={item.id}
                    style={{ paddingLeft: `${12 + (item.depth - 1) * 14}px` }}
                  >
                    <span className="outline-badge">H{item.depth}</span>
                    <span>{item.text}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-panel-state">
                <p>当前文档还没有可展示的大纲标题。</p>
              </div>
            )}
          </section>
          <section className="panel-section panel-note-list">
            {outlineTips.map((tip) => (
              <p key={tip}>{tip}</p>
            ))}
          </section>
        </div>
      );

    case '搜索': {
      const allFiles = flattenEntries(directoryEntries);
      const filtered = searchQuery.trim()
        ? allFiles.filter((file) =>
            file.kind === 'file' && file.name.toLowerCase().includes(searchQuery.toLowerCase()),
          )
        : [];

      return (
        <div className="panel-section-list">
          <section className="panel-section">
            <div className="panel-section-header">
              <h2>文件搜索</h2>
              {searchQuery ? <span>{filtered.length} 个结果</span> : null}
            </div>
            <div className="search-box">
              <Search size={15} className="search-icon" />
              <input
                type="text"
                className="search-input"
                placeholder="输入文件名关键词搜索..."
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => onSearchQueryChange('')}
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            {searchQuery.trim() && filtered.length === 0 ? (
              <div className="empty-panel-state">
                <p>未找到包含「{searchQuery}」的文件</p>
              </div>
            ) : null}

            {filtered.length > 0 ? (
              <div className="search-results">
                {filtered.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    className="search-result-row"
                    onClick={() => onOpenEntry(file)}
                  >
                    <FileText size={15} className="entry-icon file-icon" />
                    <span className="search-result-name">{highlightMatch(file.name, searchQuery)}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {!searchQuery.trim() ? (
              <div className="empty-panel-state">
                {searchHints.map((hint) => (
                  <p key={hint}>{hint}</p>
                ))}
              </div>
            ) : null}
          </section>

          {recentFiles.length > 0 ? (
            <section className="panel-section">
              <div className="panel-section-header">
                <h2>最近打开</h2>
                <button
                  type="button"
                  className="text-btn danger-text"
                  onClick={onClearRecentFiles}
                  title="清除历史"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="recent-list">
                {recentFiles.map((entry) => (
                  <div key={entry.filePath} className="recent-row-wrap">
                    <button
                      type="button"
                      className="recent-row"
                      onClick={() => onOpenRecentFile(entry)}
                      title={entry.filePath}
                    >
                      <Clock size={14} className="entry-icon recent-icon" />
                      <span className="recent-name">{entry.title}</span>
                    </button>
                    <button
                      type="button"
                      className="recent-remove-btn"
                      title="从历史中移除"
                      onClick={() => onRemoveRecentFile(entry.filePath)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      );
    }

    case '资源':
      return (
        <div className="panel-section-list">
          <section className="panel-section">
            <div className="panel-section-header">
              <h2>资源库</h2>
              <span>0 项资源</span>
            </div>
            <div className="empty-panel-state">
              <p>拖入图片或从文档插入资源后，这里会集中管理素材。</p>
            </div>
          </section>
          <section className="panel-section panel-note-list">
            {resourceHints.map((hint) => (
              <p key={hint}>{hint}</p>
            ))}
          </section>
        </div>
      );

    default:
      return <></>;
  }
}

function flattenEntries(entries: WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  const result: WorkspaceDirectoryEntry[] = [];
  for (const entry of entries) {
    result.push(entry);
    if (entry.kind === 'directory' && entry.children) {
      result.push(...flattenEntries(entry.children));
    }
  }
  return result;
}

function highlightMatch(text: string, query: string): JSX.Element {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function LeftPanel({
  activeTab,
  onTabChange,
  tocItems,
  currentFilePath,
  currentDirectoryName,
  directoryEntries,
  recentFiles,
  onOpenFolder,
  onCreateFolder,
  onCreateMarkdownFile,
  onOpenEntry,
  onOpenRecentFile,
  onRemoveRecentFile,
  onClearRecentFiles,
  onRenameEntry,
  onDeleteEntry,
  searchQuery,
  onSearchQueryChange,
  dragSource,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: LeftPanelProps): JSX.Element {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: WorkspaceDirectoryEntry;
  } | null>(null);
  const [expandedFolderPath, setExpandedFolderPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const sortedDirectoryEntries = useMemo(
    () => sortDirectoryEntries(directoryEntries, sortDirection),
    [directoryEntries, sortDirection],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: WorkspaceDirectoryEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleToggleFolder = useCallback((entry: WorkspaceDirectoryEntry) => {
    setExpandedFolderPath((currentPath) => (currentPath === entry.path ? null : entry.path));
  }, []);

  useEffect(() => {
    if (expandedFolderPath && !entryListContainsPath(directoryEntries, expandedFolderPath)) {
      setExpandedFolderPath(null);
    }
  }, [directoryEntries, expandedFolderPath]);

  const buildContextMenuItems = useCallback(
    (entry: WorkspaceDirectoryEntry): ContextMenuEntry[] => [
      { id: 'rename', label: '重命名' },
      { id: 'separator-1', separator: true } as ContextMenuEntry,
      { id: 'delete', label: entry.kind === 'directory' ? '删除文件夹' : '删除文件', danger: true },
    ],
    [],
  );

  const handleContextMenuSelect = useCallback(
    (id: string, entry: WorkspaceDirectoryEntry) => {
      setContextMenu(null);
      if (id === 'rename') {
        setRenamingPath(entry.path);
      } else if (id === 'delete') {
        onDeleteEntry(entry);
      }
    },
    [onDeleteEntry],
  );

  return (
    <div className="left-sidebar-shell">
      {renderLeftPanelRail(activeTab, onTabChange)}

      <aside className="left-panel obsidian-left-panel left-sidebar-panel" aria-label="左侧面板内容">
        {activeTab === '文件' ? (
          renderExplorerActions({
            currentDirectoryName,
            sortDirection,
            onOpenFolder,
            onCreateFolder: () => onCreateFolder(expandedFolderPath),
            onCreateMarkdownFile: () => onCreateMarkdownFile(expandedFolderPath),
            onToggleSort: () => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc')),
            onCollapseAll: () => setExpandedFolderPath(null),
            onOpenSearch: () => onTabChange('搜索'),
          })
        ) : null}

        <div className={activeTab === '文件' ? 'panel-body explorer-body' : 'panel-body'}>
          {renderPanelContent(
            activeTab,
            tocItems,
            recentFiles,
            currentFilePath,
            currentDirectoryName,
            sortedDirectoryEntries,
            expandedFolderPath,
            handleToggleFolder,
            renamingPath,
            () => setRenamingPath(null),
            onOpenFolder,
            onOpenEntry,
            onOpenRecentFile,
            onRemoveRecentFile,
            onClearRecentFiles,
            onRenameEntry,
            handleContextMenu,
            searchQuery,
            onSearchQueryChange,
            dragSource,
            onDragStart,
            onDragEnd,
            onDragOver,
            onDrop,
          )}
        </div>

        {contextMenu ? (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={buildContextMenuItems(contextMenu.entry)}
            onSelect={(id) => handleContextMenuSelect(id, contextMenu.entry)}
            onClose={() => setContextMenu(null)}
          />
        ) : null}
      </aside>
    </div>
  );
}
