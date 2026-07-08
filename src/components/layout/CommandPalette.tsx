import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export interface CommandPaletteCommand {
  id: string;
  title: string;
  description: string;
  group: string;
  keywords: string[];
  shortcutHint?: string;
  run: () => void | Promise<void>;
}

interface CommandPaletteProps {
  isOpen: boolean;
  commands: CommandPaletteCommand[];
  usageCounts: Record<string, number>;
  onClose: () => void;
  onExecute: (command: CommandPaletteCommand) => void;
}

function normalizeCommandText(value: string): string {
  return value.trim().toLowerCase();
}

function compactCommandText(value: string): string {
  return normalizeCommandText(value).replace(/\s+/g, '');
}

function getSubsequenceScore(text: string, query: string): number | null {
  let lastMatchIndex = -1;
  let gapCount = 0;

  for (const char of query) {
    const nextIndex = text.indexOf(char, lastMatchIndex + 1);
    if (nextIndex === -1) {
      return null;
    }

    gapCount += nextIndex - lastMatchIndex - 1;
    lastMatchIndex = nextIndex;
  }

  return Math.max(1, 220 - gapCount);
}

function getCommandMatchScore(command: CommandPaletteCommand, query: string): number | null {
  const normalizedQuery = normalizeCommandText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const compactQuery = compactCommandText(normalizedQuery);
  const title = normalizeCommandText(command.title);
  const compactTitle = compactCommandText(command.title);
  const searchableText = normalizeCommandText(
    [command.title, command.description, command.group, ...command.keywords].join(' '),
  );
  const compactSearchableText = compactCommandText(searchableText);

  if (title.startsWith(normalizedQuery) || compactTitle.startsWith(compactQuery)) {
    return 1400;
  }

  if (title.includes(normalizedQuery) || compactTitle.includes(compactQuery)) {
    return 1200;
  }

  if (searchableText.includes(normalizedQuery) || compactSearchableText.includes(compactQuery)) {
    return 950;
  }

  const subsequenceScore = getSubsequenceScore(compactSearchableText, compactQuery);
  if (subsequenceScore === null) {
    return null;
  }

  return 600 + subsequenceScore;
}

export function CommandPalette({
  isOpen,
  commands,
  usageCounts,
  onClose,
  onExecute,
}: CommandPaletteProps): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleCommands = useMemo(() => {
    const normalizedQuery = normalizeCommandText(query);

    return commands
      .map((command, index) => {
        const recentCount = usageCounts[command.id] ?? 0;
        const matchScore = getCommandMatchScore(command, normalizedQuery);
        return {
          command,
          index,
          recentCount,
          matchScore,
        };
      })
      .filter((item) => normalizedQuery.length === 0 || item.matchScore !== null)
      .sort((left, right) => {
        if (normalizedQuery.length === 0) {
          return right.recentCount - left.recentCount || left.index - right.index;
        }

        return (
          (right.matchScore ?? 0) - (left.matchScore ?? 0) ||
          right.recentCount - left.recentCount ||
          left.index - right.index
        );
      });
  }, [commands, query, usageCounts]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setActiveIndex(0);
      return;
    }

    setQuery('');
    setActiveIndex(0);

    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (visibleCommands.length === 0) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex((currentIndex) => Math.min(currentIndex, visibleCommands.length - 1));
  }, [visibleCommands.length]);

  if (!isOpen) {
    return null;
  }

  const handleMoveActiveIndex = (offset: number) => {
    if (visibleCommands.length === 0) {
      return;
    }

    setActiveIndex((currentIndex) => {
      const nextIndex = currentIndex + offset;
      if (nextIndex < 0) {
        return visibleCommands.length - 1;
      }
      if (nextIndex >= visibleCommands.length) {
        return 0;
      }
      return nextIndex;
    });
  };

  const handleExecuteActiveCommand = () => {
    const target = visibleCommands[activeIndex]?.command;
    if (!target) {
      return;
    }

    onExecute(target);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      handleMoveActiveIndex(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      handleMoveActiveIndex(-1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      handleExecuteActiveCommand();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="command-palette-backdrop"
      onClick={onClose}
    >
      <section
        className="command-palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="command-palette-head">
          <div className="command-palette-title">
            <strong>命令面板</strong>
            <span>用一个入口快速找到常用操作，最近使用的命令会优先排在前面。</span>
          </div>
          <button
            type="button"
            className="command-palette-close"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="command-palette-search">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="搜索命令，例如：导出 PDF、插入表格、AI 助手"
            aria-label="搜索命令"
          />
          <span>快捷键：Ctrl/Cmd + /</span>
        </div>

        {visibleCommands.length > 0 ? (
          <div
            className="command-palette-list"
            role="listbox"
            aria-label="命令列表"
          >
            {visibleCommands.map(({ command, recentCount }, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={isActive ? 'command-palette-item active' : 'command-palette-item'}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onExecute(command)}
                >
                  <span className="command-palette-item-group">{command.group}</span>
                  <span className="command-palette-item-body">
                    <strong>{command.title}</strong>
                    <span>{command.description}</span>
                  </span>
                  <span className="command-palette-item-meta">
                    {recentCount > 0 ? <small>最近使用 {recentCount} 次</small> : null}
                    {command.shortcutHint ? <kbd>{command.shortcutHint}</kbd> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="command-palette-empty">
            <strong>没有找到匹配命令</strong>
            <span>可以试试“保存”“导出”“表格”“AI”等关键词。</span>
          </div>
        )}
      </section>
    </div>
  );
}
