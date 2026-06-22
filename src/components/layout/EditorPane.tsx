import type { ParseState } from '@/engine/parser/types';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { starterMarkdownPlaceholder } from '@/constants/workspace';

interface EditorPaneProps {
  parseState: ParseState;
  source: string;
  onSourceChange: (nextSource: string) => void;
  isCondensed?: boolean;
}

function getParseStateLabel(parseState: ParseState): string {
  switch (parseState) {
    case 'parsing':
      return '解析中';
    case 'ready':
      return '已同步';
    case 'error':
      return '解析失败';
    default:
      return '待解析';
  }
}

export function EditorPane({
  parseState,
  source,
  onSourceChange,
  isCondensed = false,
}: EditorPaneProps): JSX.Element {
  return (
    <section
      className={isCondensed ? 'editor-pane editor-pane-condensed' : 'editor-pane'}
      aria-label="Markdown 编辑区"
    >
      <div className="pane-title">
        <span>{isCondensed ? 'Markdown 源码' : 'Markdown 编辑区'}</span>
        <span className="parse-state">{getParseStateLabel(parseState)}</span>
      </div>
      <MarkdownEditor
        value={source}
        onChange={onSourceChange}
        placeholderText={starterMarkdownPlaceholder}
      />
    </section>
  );
}
