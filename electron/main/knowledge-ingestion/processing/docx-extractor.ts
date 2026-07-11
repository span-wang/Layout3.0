import { createRequire } from 'node:module';
import { DOMParser, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom';
import { RegistryError } from '../types';
import { DOCX_EXTRACTOR_TOOL } from './extractor-contract';
import {
  LOCATOR_SCHEMA_VERSION,
  type DocxBlockLocator,
  type ExplicitPageBreakLocator,
  type ExtractedDocument,
} from './types';

// yauzl 已在接收阶段用于 DOCX 结构校验；这里继续按流读取目标 XML，避免解压整个压缩包。
const yauzl = createRequire(import.meta.url)('yauzl') as typeof import('yauzl');

const WORD_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
const MAX_XML_ENTRY_BYTES = 64 * 1024 * 1024;
export { DOCX_EXTRACTOR_TOOL } from './extractor-contract';

interface DocxXmlEntries {
  documentXml: string;
  stylesXml: string | null;
}

interface StyleDefinition {
  styleId: string;
  name: string | null;
  basedOn: string | null;
  outlineLevel: number | null;
}

interface ParagraphText {
  text: string;
  explicitPageBreaks: ExplicitPageBreakLocator[];
}

interface TableText extends ParagraphText {
  rowCount: number;
  columnCount: number;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RegistryError('CANCELLED', '资料处理已取消。');
  }
}

function decodeXml(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer);
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer);
  }
  return new TextDecoder('utf-8').decode(buffer);
}

async function readDocxXmlEntries(filePath: string, signal?: AbortSignal): Promise<DocxXmlEntries> {
  throwIfCancelled(signal);
  const buffers = new Map<string, Buffer>();
  const targets = new Set(['word/document.xml', 'word/styles.xml']);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        finish(new RegistryError('FILE_PROCESSING', 'DOCX 文件无法打开或压缩结构已损坏。'));
        return;
      }

      zipFile.on('error', (error) => {
        finish(new RegistryError('FILE_PROCESSING', 'DOCX 文件读取失败。', { cause: error }));
      });
      zipFile.on('entry', (entry) => {
        try {
          throwIfCancelled(signal);
        } catch (error) {
          zipFile.close();
          finish(error);
          return;
        }

        const entryName = entry.fileName.replace(/\\/g, '/').toLowerCase();
        if (!targets.has(entryName)) {
          zipFile.readEntry();
          return;
        }
        if (entry.uncompressedSize > MAX_XML_ENTRY_BYTES) {
          zipFile.close();
          finish(new RegistryError('FILE_PROCESSING', 'DOCX 正文 XML 超过基础处理上限。'));
          return;
        }

        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            finish(new RegistryError('FILE_PROCESSING', `DOCX 内部文件 ${entryName} 无法读取。`));
            return;
          }
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          stream.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_XML_ENTRY_BYTES) {
              stream.destroy(new Error('DOCX_XML_ENTRY_TOO_LARGE'));
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          stream.on('error', (error) => {
            finish(new RegistryError('FILE_PROCESSING', `DOCX 内部文件 ${entryName} 读取失败。`, { cause: error }));
          });
          stream.on('end', () => {
            buffers.set(entryName, Buffer.concat(chunks));
            zipFile.readEntry();
          });
        });
      });
      zipFile.on('end', () => finish());
      zipFile.readEntry();
    });
  });

  const documentXml = buffers.get('word/document.xml');
  if (!documentXml) {
    throw new RegistryError('FILE_PROCESSING', 'DOCX 缺少 word/document.xml，无法提取正文。');
  }
  return {
    documentXml: decodeXml(documentXml),
    stylesXml: buffers.has('word/styles.xml') ? decodeXml(buffers.get('word/styles.xml')!) : null,
  };
}

function parseXml(xml: string, label: string): XMLDocument {
  try {
    return new DOMParser({
      locator: false,
      onError(level, message) {
        if (level !== 'warning') throw new Error(message);
      },
    }).parseFromString(xml, 'application/xml') as unknown as XMLDocument;
  } catch (error) {
    throw new RegistryError('FILE_PROCESSING', `DOCX 的 ${label} XML 已损坏。`, { cause: error });
  }
}

function isWordElement(node: XmlNode, localName?: string): node is XmlElement {
  return node.nodeType === 1
    && WORD_NAMESPACES.has(node.namespaceURI ?? '')
    && (localName === undefined || node.localName === localName);
}

function directWordChildren(node: XmlNode, localName?: string): XmlElement[] {
  const children: XmlElement[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes.item(index);
    if (child && isWordElement(child, localName)) children.push(child);
  }
  return children;
}

function descendantWordElements(node: XmlNode, localName: string): XmlElement[] {
  const matches: XmlElement[] = [];
  const visit = (current: XmlNode): void => {
    for (let index = 0; index < current.childNodes.length; index += 1) {
      const child = current.childNodes.item(index);
      if (!child) continue;
      if (isWordElement(child, localName)) matches.push(child);
      visit(child);
    }
  };
  visit(node);
  return matches;
}

function firstDirectWordChild(node: XmlNode, localName: string): XmlElement | null {
  return directWordChildren(node, localName)[0] ?? null;
}

function firstDescendantWordElement(node: XmlNode, localName: string): XmlElement | null {
  return descendantWordElements(node, localName)[0] ?? null;
}

function getWordAttribute(element: XmlElement, localName: string): string | null {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (
      attribute
      && attribute.localName === localName
      && (attribute.namespaceURI === null || WORD_NAMESPACES.has(attribute.namespaceURI))
    ) {
      return attribute.value;
    }
  }
  return null;
}

function parseOutlineLevel(value: string | null): number | null {
  if (value === null) return null;
  const outlineLevel = Number.parseInt(value, 10);
  return Number.isInteger(outlineLevel) && outlineLevel >= 0 && outlineLevel <= 8
    ? outlineLevel + 1
    : null;
}

function headingLevelFromLabel(label: string | null): number | null {
  if (!label) return null;
  const normalized = label.trim().toLowerCase().replaceAll(' ', '');
  const prefixes = ['heading', '标题'];
  for (const prefix of prefixes) {
    if (!normalized.startsWith(prefix)) continue;
    const level = Number.parseInt(normalized.slice(prefix.length), 10);
    if (Number.isInteger(level) && level >= 1 && level <= 9) return level;
  }
  return null;
}

function parseStyleDefinitions(stylesXml: string | null): Map<string, StyleDefinition> {
  const definitions = new Map<string, StyleDefinition>();
  if (!stylesXml) return definitions;

  const document = parseXml(stylesXml, '样式');
  for (const style of descendantWordElements(document as unknown as XmlNode, 'style')) {
    const styleId = getWordAttribute(style, 'styleId');
    if (!styleId) continue;
    const styleType = getWordAttribute(style, 'type');
    if (styleType && styleType !== 'paragraph') continue;
    const nameElement = firstDirectWordChild(style, 'name');
    const basedOnElement = firstDirectWordChild(style, 'basedOn');
    const paragraphProperties = firstDirectWordChild(style, 'pPr');
    const outlineElement = paragraphProperties
      ? firstDescendantWordElement(paragraphProperties, 'outlineLvl')
      : null;
    definitions.set(styleId, {
      styleId,
      name: nameElement ? getWordAttribute(nameElement, 'val') : null,
      basedOn: basedOnElement ? getWordAttribute(basedOnElement, 'val') : null,
      outlineLevel: parseOutlineLevel(outlineElement ? getWordAttribute(outlineElement, 'val') : null),
    });
  }
  return definitions;
}

function resolveStyleHeadingLevel(
  styleId: string,
  definitions: Map<string, StyleDefinition>,
  visited = new Set<string>(),
): number | null {
  if (visited.has(styleId)) return null;
  visited.add(styleId);
  const style = definitions.get(styleId);
  if (!style) return headingLevelFromLabel(styleId);
  const direct = style.outlineLevel
    ?? headingLevelFromLabel(style.name)
    ?? headingLevelFromLabel(style.styleId);
  if (direct !== null) return direct;
  return style.basedOn
    ? resolveStyleHeadingLevel(style.basedOn, definitions, visited)
    : null;
}

function getParagraphHeadingLevel(
  paragraph: XmlElement,
  definitions: Map<string, StyleDefinition>,
): number | null {
  const paragraphProperties = firstDirectWordChild(paragraph, 'pPr');
  if (!paragraphProperties) return null;
  const directOutline = firstDescendantWordElement(paragraphProperties, 'outlineLvl');
  const directLevel = parseOutlineLevel(
    directOutline ? getWordAttribute(directOutline, 'val') : null,
  );
  if (directLevel !== null) return directLevel;
  const styleElement = firstDescendantWordElement(paragraphProperties, 'pStyle');
  const styleId = styleElement ? getWordAttribute(styleElement, 'val') : null;
  return styleId ? resolveStyleHeadingLevel(styleId, definitions) : null;
}

function isEnabledProperty(element: XmlElement | null): boolean {
  if (!element) return false;
  const value = getWordAttribute(element, 'val');
  return value === null || !['0', 'false', 'off', 'none'].includes(value.toLowerCase());
}

function extractParagraphText(paragraph: XmlElement): ParagraphText {
  const chunks: string[] = [];
  const pageBreakOffsets: ExplicitPageBreakLocator[] = [];
  let length = 0;
  const append = (text: string): void => {
    if (!text) return;
    chunks.push(text);
    length += text.length;
  };

  const paragraphProperties = firstDirectWordChild(paragraph, 'pPr');
  if (isEnabledProperty(
    paragraphProperties ? firstDescendantWordElement(paragraphProperties, 'pageBreakBefore') : null,
  )) {
    pageBreakOffsets.push({ kind: 'page_break_before', characterOffset: 0 });
  }

  const visit = (node: XmlNode): void => {
    if (isWordElement(node)) {
      if (node.localName === 'del' || node.localName === 'moveFrom') return;
      if (node.localName === 't' || node.localName === 'instrText') {
        append(node.textContent ?? '');
        return;
      }
      if (node.localName === 'tab') {
        append('\t');
        return;
      }
      if (node.localName === 'br') {
        if ((getWordAttribute(node, 'type') ?? 'textWrapping') === 'page') {
          pageBreakOffsets.push({ kind: 'page_break', characterOffset: length });
        }
        append('\n');
        return;
      }
      if (node.localName === 'cr') {
        append('\n');
        return;
      }
      if (node.localName === 'noBreakHyphen') {
        append('‑');
        return;
      }
    }
    for (let index = 0; index < node.childNodes.length; index += 1) {
      const child = node.childNodes.item(index);
      if (child) visit(child);
    }
  };
  visit(paragraph);

  const rawText = chunks.join('').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const withoutLeading = rawText.trimStart();
  const leadingLength = rawText.length - withoutLeading.length;
  const text = withoutLeading.trimEnd();
  return {
    text,
    explicitPageBreaks: pageBreakOffsets.map((pageBreak) => ({
      ...pageBreak,
      characterOffset: Math.max(0, Math.min(text.length, pageBreak.characterOffset - leadingLength)),
    })),
  };
}

function closestAncestorTable(node: XmlNode): XmlElement | null {
  let current = node.parentNode;
  while (current) {
    if (isWordElement(current, 'tbl')) return current;
    current = current.parentNode;
  }
  return null;
}

function extractTableText(table: XmlElement): TableText {
  const rows = descendantWordElements(table, 'tr')
    .filter((row) => closestAncestorTable(row) === table);
  const rowTexts: string[] = [];
  const explicitPageBreaks: ExplicitPageBreakLocator[] = [];
  let tableLength = 0;
  let columnCount = 0;

  for (const row of rows) {
    const cells = directWordChildren(row, 'tc');
    columnCount = Math.max(columnCount, cells.length);
    const cellTexts: string[] = [];
    for (const cell of cells) {
      const paragraphTexts = descendantWordElements(cell, 'p')
        .filter((paragraph) => closestAncestorTable(paragraph) === table)
        .map(extractParagraphText);
      let cellText = '';
      for (const paragraph of paragraphTexts) {
        if (!paragraph.text) continue;
        if (cellText) cellText += '\n';
        const paragraphStart = cellText.length;
        cellText += paragraph.text;
        for (const pageBreak of paragraph.explicitPageBreaks) {
          explicitPageBreaks.push({
            ...pageBreak,
            characterOffset: tableLength + cellTexts.join('\t').length
              + (cellTexts.length > 0 ? 1 : 0)
              + paragraphStart
              + pageBreak.characterOffset,
          });
        }
      }
      cellTexts.push(cellText);
    }
    const rowText = cellTexts.join('\t').trimEnd();
    if (!rowText.trim()) continue;
    if (rowTexts.length > 0) tableLength += 1;
    rowTexts.push(rowText);
    tableLength += rowText.length;
  }

  return {
    text: rowTexts.join('\n').trim(),
    explicitPageBreaks,
    rowCount: rows.length,
    columnCount,
  };
}

function updateHeadingPath(current: string[], level: number, title: string): string[] {
  const parentCount = Math.min(current.length, Math.max(0, level - 1));
  return [...current.slice(0, parentCount), title];
}

export async function extractDocxDocument(input: {
  filePath: string;
  sourceHash: string;
  signal?: AbortSignal;
}): Promise<ExtractedDocument> {
  const xmlEntries = await readDocxXmlEntries(input.filePath, input.signal);
  throwIfCancelled(input.signal);
  const document = parseXml(xmlEntries.documentXml, '正文');
  const styleDefinitions = parseStyleDefinitions(xmlEntries.stylesXml);
  const body = firstDescendantWordElement(document as unknown as XmlNode, 'body');
  if (!body) {
    throw new RegistryError('FILE_PROCESSING', 'DOCX 缺少正文区域，无法处理。');
  }

  let bodyText = '';
  let paragraphNumber = 0;
  let tableNumber = 0;
  let headingPath: string[] = [];
  const blocks: DocxBlockLocator[] = [];

  const appendBlock = (text: string): { startOffset: number; endOffset: number } => {
    if (bodyText) bodyText += '\n\n';
    const startOffset = bodyText.length;
    bodyText += text;
    return { startOffset, endOffset: bodyText.length };
  };

  for (const child of directWordChildren(body)) {
    throwIfCancelled(input.signal);
    if (child.localName === 'p') {
      paragraphNumber += 1;
      const paragraph = extractParagraphText(child);
      if (!paragraph.text) continue;
      const headingLevel = getParagraphHeadingLevel(child, styleDefinitions);
      if (headingLevel !== null) {
        headingPath = updateHeadingPath(headingPath, headingLevel, paragraph.text);
      }
      const offsets = appendBlock(paragraph.text);
      blocks.push({
        blockId: `docx-paragraph-${paragraphNumber}`,
        blockType: headingLevel === null ? 'paragraph' : 'heading',
        ...offsets,
        headingPath: [...headingPath],
        headingLevel,
        paragraphNumber,
        tableNumber: null,
        rowCount: null,
        columnCount: null,
        explicitPageBreaks: paragraph.explicitPageBreaks,
      });
      continue;
    }
    if (child.localName === 'tbl') {
      tableNumber += 1;
      const table = extractTableText(child);
      if (!table.text) continue;
      const offsets = appendBlock(table.text);
      blocks.push({
        blockId: `docx-table-${tableNumber}`,
        blockType: 'table',
        ...offsets,
        headingPath: [...headingPath],
        headingLevel: null,
        paragraphNumber: null,
        tableNumber,
        rowCount: table.rowCount,
        columnCount: table.columnCount,
        explicitPageBreaks: table.explicitPageBreaks,
      });
    }
  }

  if (!bodyText.trim()) {
    throw new RegistryError('FILE_PROCESSING', 'DOCX 未发现可提取正文，不能生成空处理工件。');
  }

  return {
    bodyText: `${bodyText}\n`,
    locatorMap: {
      schemaVersion: LOCATOR_SCHEMA_VERSION,
      sourceFormat: 'docx',
      sourceHash: input.sourceHash,
      offsetEncoding: 'utf16-code-unit',
      physicalPageNumbersAvailable: false,
      blocks,
    },
    toolName: DOCX_EXTRACTOR_TOOL.name,
    toolVersion: DOCX_EXTRACTOR_TOOL.version,
  };
}
