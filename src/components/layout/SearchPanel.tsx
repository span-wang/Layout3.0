import { useEffect, useRef } from 'react';
import { Clock, Search, X } from 'lucide-react';
import type { DocumentSearchResult } from '@/services/DocumentSearchService';
import type { RecentFileEntry } from '@/types/workspace';

export interface SearchPanelProps {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  caseSensitive: boolean;
  onCaseSensitiveChange: (enabled: boolean) => void;
  wholeWord: boolean;
  onWholeWordChange: (enabled: boolean) => void;
  replacementText: string;
  onReplacementTextChange: (text: string) => void;
  results: DocumentSearchResult[];
  selectedResultId: string | null;
  focusRequestKey: number;
  onSelectResult: (result: DocumentSearchResult) => void;
  onReplaceSelected: () => void;
  onReplaceAll: () => void;
  recentFiles: RecentFileEntry[];
  onOpenRecentFile: (entry: RecentFileEntry) => void;
  onRemoveRecentFile: (filePath: string) => void;
  onClearRecentFiles: () => void;
}

function renderSearchResultPreview(result: DocumentSearchResult): JSX.Element {
  return (
    <>
      {result.previewBefore}
      <mark className="search-highlight">{result.matchText}</mark>
      {result.previewAfter}
    </>
  );
}

export function SearchPanel({
  searchQuery,
  onSearchQueryChange,
  caseSensitive,
  onCaseSensitiveChange,
  wholeWord,
  onWholeWordChange,
  replacementText,
  onReplacementTextChange,
  results,
  selectedResultId,
  focusRequestKey,
  onSelectResult,
  onReplaceSelected,
  onReplaceAll,
  recentFiles,
  onOpenRecentFile,
  onRemoveRecentFile,
  onClearRecentFiles,
}: SearchPanelProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasQuery = searchQuery.trim().length > 0;
  const selectedResult = selectedResultId
    ? results.find((result) => result.id === selectedResultId) ?? null
    : results[0] ?? null;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequestKey]);

  return (
    <div className="panel-section-list search-panel">
      <section className="panel-section">
        <div className="panel-section-header">
          <h2>搜索与替换</h2>
          {hasQuery ? <span>{results.length} 个命中</span> : null}
        </div>

        <div className="search-box">
          <Search size={15} className="search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="搜索当前文档内容..."
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
          {searchQuery ? (
            <button
              type="button"
              className="search-clear-btn"
              title="清空搜索"
              aria-label="清空搜索"
              onClick={() => onSearchQueryChange('')}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        <div className="search-options" aria-label="搜索匹配选项">
          <button
            type="button"
            className={caseSensitive ? 'search-option-chip active' : 'search-option-chip'}
            aria-pressed={caseSensitive}
            onClick={() => onCaseSensitiveChange(!caseSensitive)}
          >
            区分大小写
          </button>
          <button
            type="button"
            className={wholeWord ? 'search-option-chip active' : 'search-option-chip'}
            aria-pressed={wholeWord}
            onClick={() => onWholeWordChange(!wholeWord)}
          >
            全字匹配
          </button>
        </div>

        <div className="replace-box">
          <input
            type="text"
            className="search-replace-input"
            placeholder="替换为..."
            value={replacementText}
            onChange={(event) => onReplacementTextChange(event.target.value)}
          />
          <div className="search-replace-actions">
            <button
              type="button"
              className="search-action-btn"
              disabled={!selectedResult}
              onClick={onReplaceSelected}
            >
              替换当前
            </button>
            <button
              type="button"
              className="search-action-btn primary"
              disabled={results.length === 0}
              onClick={onReplaceAll}
            >
              全部替换
            </button>
          </div>
        </div>

        {!hasQuery ? (
          <div className="empty-panel-state">
            <p>输入关键词后，会搜索当前文档的标题、段落、列表、表格、代码、公式和图片说明。</p>
            <p>点击结果可跳转到画布中的对应位置；替换操作可通过撤销恢复。</p>
          </div>
        ) : null}

        {hasQuery && results.length === 0 ? (
          <div className="empty-panel-state">
            <p>当前文档中没有找到「{searchQuery}」。</p>
          </div>
        ) : null}

        {results.length > 0 ? (
          <div className="search-results">
            {results.map((result) => (
              <button
                key={result.id}
                type="button"
                className={result.id === selectedResultId ? 'search-result-row active' : 'search-result-row'}
                onClick={() => onSelectResult(result)}
              >
                <span className="search-result-content">
                  <span className="search-result-meta">
                    <span className="search-result-kind">{result.kindLabel}</span>
                    <span className="search-result-range">
                      第 {result.matchStart + 1}-{result.matchEnd} 字
                    </span>
                  </span>
                  <span className="search-result-preview">{renderSearchResultPreview(result)}</span>
                </span>
              </button>
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
