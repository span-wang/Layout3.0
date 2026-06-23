import type { ParseState } from '@/engine/document-model';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { starterMarkdownPlaceholder } from '@/constants/workspace';

interface EditorPaneProps {
  parseState: ParseState;
  source: string;
  isCondensed?: boolean;
}

function getParseStateLabel(parseState: ParseState): string {
  switch (parseState) {
    case 'parsing':
      return '导入中';
    case 'ready':
      return '只读快照';
    case 'error':
      return '导入失败';
    default:
      return '待导入';
  }
}

export function EditorPane({
  parseState,
  source,
  isCondensed = false,
}: EditorPaneProps): JSX.Element {
  return (
    <section
      className={isCondensed ? 'editor-pane editor-pane-condensed' : 'editor-pane'}
      aria-label="导入源码快照"
    >
      <div className="pane-title">
        <span>{isCondensed ? '导入源码快照' : '导入源码只读快照'}</span>
        <span className="parse-state">{getParseStateLabel(parseState)}</span>
      </div>
      <MarkdownEditor
        value={source}
        placeholderText={starterMarkdownPlaceholder}
        readOnly
      />
    </section>
  );
}
