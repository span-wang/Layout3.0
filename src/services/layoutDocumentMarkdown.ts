import type { LayoutBlock, LayoutDocument, LayoutListItem, LayoutTableCell } from '@/engine/document-model';

/**
 * 将结构化文档转换为 AI 能读懂的 Markdown 上下文。
 * 这里只做内容近似还原，不反写源码快照，避免破坏 `.layout` 作为编辑真相源的规则。
 */
export function layoutDocumentToMarkdown(doc: LayoutDocument): string {
  const lines: string[] = [];

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading': {
        const level = block.metadata.kind === 'heading' ? block.metadata.depth : 1;
        const prefix = '#'.repeat(level);
        const headingText = extractTextFromTextRuns(block);
        lines.push(`${prefix} ${headingText}`);
        break;
      }

      case 'paragraph': {
        const paragraphText = extractTextFromTextRuns(block);
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
            .map((childBlock) => extractBlockPlainText(childBlock))
            .filter(Boolean)
            .join('\n\n');
          lines.push(quoteText.split('\n').map((line) => `> ${line}`).join('\n'));
        }
        break;
      }

      case 'columnSection': {
        if (block.metadata.kind === 'columnSection') {
          const columnSectionText = block.metadata.blocks
            .map((childBlock) => extractBlockPlainText(childBlock))
            .filter(Boolean)
            .join('\n\n');
          if (columnSectionText.trim()) {
            lines.push(columnSectionText);
          }
        }
        break;
      }

      default:
        break;
    }
  }

  return lines.filter((line) => line.trim()).join('\n\n');
}

function extractTextFromTextRuns(block: { textRuns?: Array<{ text: string }> }): string {
  return block.textRuns?.map((run) => run.text).join('') ?? '';
}

function extractBlockPlainText(block: LayoutBlock): string {
  if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
    return block.metadata.blocks.map((childBlock) => extractBlockPlainText(childBlock)).join('\n');
  }

  if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
    return block.metadata.blocks.map((childBlock) => extractBlockPlainText(childBlock)).join('\n');
  }

  if (block.type === 'table' && block.metadata.kind === 'table') {
    return block.metadata.rows
      .map((row) => row.cells.map((cell) => extractTextFromTextRuns(cell)).join(' | '))
      .join('\n');
  }

  if (block.type === 'list' && block.metadata.kind === 'list') {
    return block.metadata.items.map((item) => extractTextFromTextRuns(item)).join('\n');
  }

  if (block.type === 'image' && block.metadata.kind === 'image') {
    return block.metadata.alt;
  }

  if (block.type === 'equation' && block.metadata.kind === 'equation') {
    return block.metadata.value;
  }

  return extractTextFromTextRuns(block);
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
      escapeTableCellText(extractTextFromTextRuns(cells[index] ?? {}))
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
      return `${indent}${marker} ${extractTextFromTextRuns(item)}`;
    })
    .join('\n');
}
