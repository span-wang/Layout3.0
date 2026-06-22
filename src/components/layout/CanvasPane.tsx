import type { ParseState, ParsedBlock } from '@/engine/parser/types';
import type { PageLayout } from '@/engine/typesetting/types';

interface CanvasPaneProps {
  blocks: ParsedBlock[];
  pageLayouts: PageLayout[];
  parseError: string | null;
  parseState: ParseState;
  isCondensed?: boolean;
}

function getPageTitle(blocks: ParsedBlock[]): string {
  const headingBlock = blocks.find((block) => block.type === 'heading');
  return headingBlock?.type === 'heading' ? headingBlock.text : '未命名文档';
}

function renderBlock(block: ParsedBlock, index: number): JSX.Element {
  switch (block.type) {
    case 'heading': {
      if (block.depth === 1) {
        return <h1 key={`${block.id}-${index}`}>{block.text}</h1>;
      }

      if (block.depth === 2) {
        return <h2 key={`${block.id}-${index}`}>{block.text}</h2>;
      }

      return <h3 key={`${block.id}-${index}`}>{block.text}</h3>;
    }
    case 'paragraph':
      return <p key={`${block.text}-${index}`}>{block.text}</p>;
    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul';
      return (
        <ListTag key={`list-${index}`}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ListTag>
      );
    }
    case 'blockquote':
      return (
        <blockquote key={`blockquote-${index}`} className="quote-block">
          {block.blocks.map((item, childIndex) => renderBlock(item, childIndex))}
        </blockquote>
      );
    case 'code':
      return (
        <pre key={`code-${index}`} className="code-block">
          <code>{block.value}</code>
        </pre>
      );
    case 'table':
      return (
        <div key={`table-${index}`} className="table-shell">
          <table className="preview-table">
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`cell-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'horizontalRule':
      return <hr key={`rule-${index}`} className="preview-rule" />;
    default:
      return <></>;
  }
}

export function CanvasPane({
  blocks,
  pageLayouts,
  parseError,
  parseState,
  isCondensed = false,
}: CanvasPaneProps): JSX.Element {
  const fallbackTitle = getPageTitle(blocks);

  return (
    <section
      className={isCondensed ? 'canvas-pane canvas-pane-condensed' : 'canvas-pane'}
      aria-label="分页预览"
    >
      <div className="canvas-pane-head">
        <div>
          <strong>分页预览</strong>
          <span>{pageLayouts.length} 页</span>
        </div>
        <div className="canvas-pane-meta">
          <span>{blocks.length} 个结构块</span>
        </div>
      </div>
      {parseState === 'error' && parseError ? (
        <div className="canvas-state canvas-state-error">{parseError}</div>
      ) : null}
      {parseState === 'parsing' && blocks.length === 0 ? (
        <div className="canvas-state">正在解析 Markdown…</div>
      ) : null}
      <div className="page-stack">
        {pageLayouts.map((page) => {
          const pageTitle = getPageTitle(page.blocks) || fallbackTitle;

          return (
            <div className="page" key={page.pageNumber}>
              <div className="page-header">{pageTitle}</div>
              <article className="page-body">
                {page.blocks.map((block, index) =>
                  renderBlock(block, page.pageNumber * 1000 + index),
                )}
              </article>
              <div className="page-footer">{page.pageNumber}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
