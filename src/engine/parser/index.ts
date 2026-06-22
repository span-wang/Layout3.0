import type { Root as HastRoot, Content, Element, Text } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import { createHtmlStringifyProcessor, createRemarkToRehypeProcessor } from './rehype';
import { createRemarkProcessor } from './remark';
import type { ParseResult, ParsedBlock, TocItem } from './types';

function isElement(node: Content): node is Element {
  return node.type === 'element';
}

function isText(node: Content): node is Text {
  return node.type === 'text';
}

function getElementChildren(node: Element): Content[] {
  return node.children as Content[];
}

function extractText(nodes: Content[]): string {
  return nodes
    .map((node) => {
      if (isText(node)) {
        return node.value;
      }

      if (isElement(node)) {
        if (node.tagName === 'br') {
          return '\n';
        }

        return extractText(getElementChildren(node));
      }

      return '';
    })
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createHeadingId(text: string, index: number): string {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');

  if (!normalized) {
    return `heading-${index + 1}`;
  }

  return `${normalized}-${index + 1}`;
}

function parseTable(node: Element): ParsedBlock {
  const rows: string[][] = [];

  for (const section of getElementChildren(node)) {
    if (!isElement(section)) {
      continue;
    }

    for (const row of getElementChildren(section)) {
      if (!isElement(row) || row.tagName !== 'tr') {
        continue;
      }

      const cells = getElementChildren(row)
        .filter((cell): cell is Element => isElement(cell) && ['th', 'td'].includes(cell.tagName))
        .map((cell) => extractText(getElementChildren(cell)));

      rows.push(cells);
    }
  }

  return {
    type: 'table',
    rows,
  };
}

function parseCodeBlock(node: Element): ParsedBlock {
  const codeElement = getElementChildren(node).find(
    (child): child is Element => isElement(child) && child.tagName === 'code',
  );

  const className = codeElement?.properties.className;
  const languageClass =
    Array.isArray(className) && className.length > 0 ? String(className[0]) : null;
  const language = languageClass?.startsWith('language-')
    ? languageClass.replace('language-', '')
    : null;

  return {
    type: 'code',
    language,
    value: codeElement ? extractText(getElementChildren(codeElement)) : extractText(getElementChildren(node)),
  };
}

function parseBlock(node: Content, index: number): ParsedBlock | null {
  if (!isElement(node)) {
    return null;
  }

  switch (node.tagName) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = extractText(getElementChildren(node));
      const depth = Number(node.tagName.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
      return {
        type: 'heading',
        depth,
        text,
        id: createHeadingId(text, index),
      };
    }
    case 'p':
      return {
        type: 'paragraph',
        text: extractText(getElementChildren(node)),
      };
    case 'ul':
    case 'ol':
      return {
        type: 'list',
        ordered: node.tagName === 'ol',
        items: getElementChildren(node)
          .filter((child): child is Element => isElement(child) && child.tagName === 'li')
          .map((item) => extractText(getElementChildren(item))),
      };
    case 'blockquote':
      return {
        type: 'blockquote',
        blocks: getElementChildren(node)
          .map((child, childIndex) => parseBlock(child, childIndex))
          .filter((block): block is ParsedBlock => block !== null),
      };
    case 'pre':
      return parseCodeBlock(node);
    case 'table':
      return parseTable(node);
    case 'hr':
      return {
        type: 'horizontalRule',
      };
    default:
      return null;
  }
}

function buildToc(blocks: ParsedBlock[]): TocItem[] {
  return blocks.flatMap((block) => {
    if (block.type === 'heading') {
      return [
        {
          id: block.id,
          depth: block.depth,
          text: block.text,
        },
      ];
    }

    if (block.type === 'blockquote') {
      return buildToc(block.blocks);
    }

    return [];
  });
}

function buildBlocks(tree: HastRoot): ParsedBlock[] {
  return (tree.children as Content[])
    .map((node, index) => parseBlock(node, index))
    .filter((block): block is ParsedBlock => block !== null);
}

export async function parseMarkdown(source: string): Promise<ParseResult> {
  const remarkProcessor = createRemarkProcessor();
  const mdastTree = (await remarkProcessor.run(remarkProcessor.parse(source))) as MdastRoot;
  const rehypeProcessor = createRemarkToRehypeProcessor();
  const hastTree = (await rehypeProcessor.run(mdastTree as never)) as HastRoot;
  const html = String(createHtmlStringifyProcessor().stringify(hastTree));
  const blocks = buildBlocks(hastTree);

  return {
    blocks,
    toc: buildToc(blocks),
    html,
    errors: [],
  };
}
