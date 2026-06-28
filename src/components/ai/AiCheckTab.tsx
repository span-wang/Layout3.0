/**
 * AI 检查 Tab
 * 支持检查文档排版问题：标题层级、段落长度、图片说明、表格宽度、分页美观
 */

import { useRef } from 'react';
import { useAppStore } from '@/store';
import type { LayoutBlock, LayoutListItem, LayoutTableCell } from '@/engine/document-model';
import { aiService } from '@/services/AiService';
import { SEVERITY_LABELS } from '@/types/ai';
import type { AiCheckResultItem } from '@/types/ai';

/**
 * 将 LayoutDocument 转换为 Markdown 文本
 */
function layoutDocumentToMarkdown(doc: NonNullable<ReturnType<typeof useAppStore.getState>['layoutDocument']>): string {
  const lines: string[] = [];

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading': {
        const level = block.metadata.kind === 'heading' ? block.metadata.depth : 1;
        const prefix = '#'.repeat(level);
        const headingText = extractTextFromBlock(block);
        lines.push(`${prefix} ${headingText}`);
        break;
      }

      case 'paragraph': {
        const paragraphText = extractTextFromBlock(block);
        if (paragraphText.trim()) {
          lines.push(paragraphText);
        }
        break;
      }

      case 'code': {
        const codeText = block.metadata.kind === 'code' ? block.metadata.value : '';
        const lang = block.metadata.kind === 'code' ? block.metadata.language ?? '' : '';
        lines.push(`\`\`\`${lang}\n${codeText}\n\`\`\``);
        break;
      }

      case 'table': {
        if (block.metadata.kind === 'table') {
          lines.push(tableBlockToMarkdown(block));
        }
        break;
      }

      case 'image': {
        if (block.metadata.kind === 'image') {
          const title = block.metadata.title ? ` "${block.metadata.title}"` : '';
          lines.push(`![${block.metadata.alt}](${block.metadata.src}${title})`);
        }
        break;
      }

      case 'equation': {
        const equationValue = block.metadata.kind === 'equation' ? block.metadata.value : '';
        lines.push('$$\n' + equationValue + '\n$$');
        break;
      }

      case 'list': {
        if (block.metadata.kind === 'list') {
          lines.push(listItemsToMarkdown(block.metadata.items, block.metadata.ordered));
        }
        break;
      }

      case 'blockquote': {
        if (block.metadata.kind === 'blockquote') {
          const quoteText = block.metadata.blocks
            .map((childBlock) => extractTextFromBlock(childBlock))
            .filter(Boolean)
            .join('\n\n');
          lines.push(quoteText.split('\n').map((line) => `> ${line}`).join('\n'));
        }
        break;
      }

      default:
        break;
    }
  }

  return lines.join('\n\n');
}

/**
 * 从块中提取纯文本
 */
function extractTextFromBlock(block: { textRuns?: Array<{ text: string }> }): string {
  if (!block.textRuns) return '';
  return block.textRuns.map((run) => run.text).join('');
}

function escapeTableCellText(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function tableBlockToMarkdown(block: LayoutBlock): string {
  if (block.metadata.kind !== 'table') {
    return '';
  }

  const rows = block.metadata.rows;
  if (rows.length === 0) {
    return '';
  }

  const columnCount = Math.max(...rows.map((row) => row.cells.length), 1);
  const renderRow = (cells: LayoutTableCell[]): string => {
    const values = Array.from({ length: columnCount }, (_, index) =>
      escapeTableCellText(extractTextFromBlock(cells[index] ?? {}))
    );
    return `| ${values.join(' | ')} |`;
  };

  const header = renderRow(rows[0].cells);
  const separator = `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`;
  const body = rows.slice(1).map((row) => renderRow(row.cells));
  return [header, separator, ...body].join('\n');
}

function listItemsToMarkdown(items: LayoutListItem[], ordered: boolean): string {
  return items
    .map((item, index) => {
      const indent = '  '.repeat(Math.max(0, (item.level ?? 1) - 1));
      const marker = ordered ? `${index + 1}.` : item.checked === null ? '-' : `- [${item.checked ? 'x' : ' '}]`;
      return `${indent}${marker} ${extractTextFromBlock(item)}`;
    })
    .join('\n');
}

export function AiCheckTab(): JSX.Element {
  const isChecking = useAppStore((state) => state.isChecking);
  const checkResult = useAppStore((state) => state.checkResult);
  const checkError = useAppStore((state) => state.checkError);
  const ignoredCheckItems = useAppStore((state) => state.ignoredCheckItems);
  const startChecking = useAppStore((state) => state.startChecking);
  const setCheckResult = useAppStore((state) => state.setCheckResult);
  const setCheckError = useAppStore((state) => state.setCheckError);
  const finishChecking = useAppStore((state) => state.finishChecking);
  const ignoreCheckItem = useAppStore((state) => state.ignoreCheckItem);
  const unignoreCheckItem = useAppStore((state) => state.unignoreCheckItem);
  const clearCheckResult = useAppStore((state) => state.clearCheckResult);
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCheck = async () => {
    const config = useAppStore.getState().getAiConfigForTask('check');
    if (!config) {
      setCheckError('请先在「设置」中为「文档检查」分配可用 AI 配置');
      return;
    }

    if (!layoutDocument) {
      setCheckError('请先打开一个文档');
      return;
    }

    try {
      // 文档检查可以使用更稳定或成本更低的独立模型配置。
      aiService.configure(config);

      startChecking();

      // 将文档内容转换为 Markdown 文本
      const content = layoutDocumentToMarkdown(layoutDocument);
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const result = await aiService.checkDocument(content, abortController.signal);

      setCheckResult(result);
      finishChecking();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setCheckError('检查已取消');
      } else {
        setCheckError(error instanceof Error ? error.message : '检查失败');
      }
      finishChecking();
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleStopCheck = () => {
    abortControllerRef.current?.abort();
  };

  const handleIgnore = (itemId: string) => {
    ignoreCheckItem(itemId);
  };

  const handleUnignore = (itemId: string) => {
    unignoreCheckItem(itemId);
  };

  const handleClear = () => {
    clearCheckResult();
  };

  // 过滤出未忽略的检查项
  const visibleItems = checkResult?.items.filter(
    (item) => !ignoredCheckItems.includes(item.id)
  ) ?? [];

  // 按严重程度分组
  const errorItems = visibleItems.filter((item) => item.severity === 'error');
  const warningItems = visibleItems.filter((item) => item.severity === 'warning');
  const suggestionItems = visibleItems.filter((item) => item.severity === 'suggestion');

  return (
    <div className="ai-check-tab">
      <div className="ai-section">
        <h3 className="ai-section-title">文档检查</h3>
        <p className="ai-description">
          检查文档的排版问题，包括标题层级、段落长度、图片说明、表格宽度和分页美观度。
        </p>
      </div>

      {checkError && (
        <div className="ai-error">
          <span>{checkError}</span>
        </div>
      )}

      <div className="ai-section">
        {isChecking ? (
          <button type="button" className="ai-button ai-button-stop" onClick={handleStopCheck}>
            停止检查
          </button>
        ) : (
          <button type="button" className="ai-button ai-button-primary" onClick={handleCheck}>
            一键检查文档
          </button>
        )}
      </div>

      {checkResult && (
        <div className="ai-section ai-result-section">
          <div className="ai-result-header">
            <h3 className="ai-section-title">检查结果</h3>
            <button type="button" className="ai-button ai-button-small" onClick={handleClear}>
              清空结果
            </button>
          </div>

          {visibleItems.length === 0 ? (
            <div className="ai-check-success">
              <span>检查完成，未发现问题</span>
            </div>
          ) : (
            <div className="ai-check-results">
              {errorItems.length > 0 && (
                <div className="ai-check-group">
                  <h4 className="ai-check-group-title ai-check-error">
                    {SEVERITY_LABELS.error} ({errorItems.length})
                  </h4>
                  {errorItems.map((item) => (
                    <CheckResultItemComponent
                      key={item.id}
                      item={item}
                      isIgnored={ignoredCheckItems.includes(item.id)}
                      onIgnore={handleIgnore}
                      onUnignore={handleUnignore}
                    />
                  ))}
                </div>
              )}

              {warningItems.length > 0 && (
                <div className="ai-check-group">
                  <h4 className="ai-check-group-title ai-check-warning">
                    {SEVERITY_LABELS.warning} ({warningItems.length})
                  </h4>
                  {warningItems.map((item) => (
                    <CheckResultItemComponent
                      key={item.id}
                      item={item}
                      isIgnored={ignoredCheckItems.includes(item.id)}
                      onIgnore={handleIgnore}
                      onUnignore={handleUnignore}
                    />
                  ))}
                </div>
              )}

              {suggestionItems.length > 0 && (
                <div className="ai-check-group">
                  <h4 className="ai-check-group-title ai-check-suggestion">
                    {SEVERITY_LABELS.suggestion} ({suggestionItems.length})
                  </h4>
                  {suggestionItems.map((item) => (
                    <CheckResultItemComponent
                      key={item.id}
                      item={item}
                      isIgnored={ignoredCheckItems.includes(item.id)}
                      onIgnore={handleIgnore}
                      onUnignore={handleUnignore}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 检查结果项组件
 */
interface CheckResultItemComponentProps {
  item: AiCheckResultItem;
  isIgnored: boolean;
  onIgnore: (id: string) => void;
  onUnignore: (id: string) => void;
}

function CheckResultItemComponent({
  item,
  isIgnored,
  onIgnore,
  onUnignore,
}: CheckResultItemComponentProps): JSX.Element {
  return (
    <div className={`ai-check-item ai-check-item-${item.severity} ${isIgnored ? 'ignored' : ''}`}>
      <div className="ai-check-item-header">
        <span className="ai-check-page">第 {item.page} 页</span>
        <span className="ai-check-severity">{SEVERITY_LABELS[item.severity]}</span>
      </div>
      <p className="ai-check-message">{item.message}</p>
      <p className="ai-check-suggestion">{item.suggestion}</p>
      <div className="ai-check-item-actions">
        {item.autoFixable && (
          <button type="button" className="ai-button ai-button-small ai-button-primary" disabled title="后续会接入自动修复写回">
            应用建议（待接入）
          </button>
        )}
        {isIgnored ? (
          <button type="button" className="ai-button ai-button-small" onClick={() => onUnignore(item.id)}>
            恢复
          </button>
        ) : (
          <button type="button" className="ai-button ai-button-small" onClick={() => onIgnore(item.id)}>
            忽略
          </button>
        )}
      </div>
    </div>
  );
}
