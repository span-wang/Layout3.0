import { promises as fs } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { RegistryError } from '../types';
import { PDF_EXTRACTOR_TOOL } from './extractor-contract';
import {
  LOCATOR_SCHEMA_VERSION,
  type ExtractedDocument,
  type PdfPageLocator,
  type PdfTextItemLocator,
} from './types';

export { PDF_EXTRACTOR_TOOL } from './extractor-contract';

interface PreviousTextPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  hasEol: boolean;
}

interface PdfTextItem {
  str: string;
  transform: Array<unknown>;
  width: number;
  height: number;
  hasEOL: boolean;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RegistryError('CANCELLED', '资料处理已取消。');
  }
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function chooseTextSeparator(previous: PreviousTextPosition | null, item: PdfTextItem): string {
  if (!previous) return '';
  if (previous.hasEol) return '\n';

  const x = finiteNumber(item.transform[4]);
  const y = finiteNumber(item.transform[5]);
  const height = Math.max(1, finiteNumber(item.height));
  const lineTolerance = Math.max(previous.height, height) * 0.55;
  if (Math.abs(y - previous.y) > lineTolerance) return '\n';

  const horizontalGap = x - (previous.x + previous.width);
  const wordGap = Math.max(1, Math.min(previous.height, height) * 0.16);
  return horizontalGap > wordGap ? ' ' : '';
}

export async function extractPdfDocument(input: {
  filePath: string;
  sourceHash: string;
  signal?: AbortSignal;
}): Promise<ExtractedDocument> {
  throwIfCancelled(input.signal);
  const data = new Uint8Array(await fs.readFile(input.filePath));
  throwIfCancelled(input.signal);
  const loadingTask = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  });

  let pdfDocument: Awaited<typeof loadingTask.promise> | null = null;
  try {
    pdfDocument = await loadingTask.promise;
    let bodyText = '';
    const pages: PdfPageLocator[] = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      throwIfCancelled(input.signal);
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent({ disableNormalization: false });
      const pageHasText = textContent.items.some(
        (item) => 'str' in item && item.str.trim().length > 0,
      );
      if (bodyText && pageHasText) bodyText += '\n\n';
      const pageStartOffset = bodyText.length;
      const items: PdfTextItemLocator[] = [];
      let previous: PreviousTextPosition | null = null;
      let itemNumber = 0;

      for (const contentItem of textContent.items) {
        if (!('str' in contentItem) || contentItem.str.length === 0) continue;
        itemNumber += 1;
        const separator = chooseTextSeparator(previous, contentItem);
        bodyText += separator;
        const startOffset = bodyText.length;
        bodyText += contentItem.str;
        const endOffset = bodyText.length;
        const x = finiteNumber(contentItem.transform[4]);
        const y = finiteNumber(contentItem.transform[5]);
        const width = Math.max(0, finiteNumber(contentItem.width));
        const height = Math.max(0, finiteNumber(contentItem.height));
        items.push({
          itemNumber,
          startOffset,
          endOffset,
          x,
          y,
          width,
          height,
        });
        previous = { x, y, width, height: Math.max(1, height), hasEol: contentItem.hasEOL };
      }

      pages.push({
        pageNumber,
        startOffset: pageStartOffset,
        endOffset: bodyText.length,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        items,
      });
      page.cleanup();
    }

    if (!bodyText.trim()) {
      throw new RegistryError(
        'FILE_PROCESSING',
        'PDF 未发现可提取正文，可能是扫描件；本步暂不提供 OCR。',
      );
    }

    return {
      bodyText: `${bodyText}\n`,
      locatorMap: {
        schemaVersion: LOCATOR_SCHEMA_VERSION,
        sourceFormat: 'pdf',
        sourceHash: input.sourceHash,
        offsetEncoding: 'utf16-code-unit',
        pageCount: pdfDocument.numPages,
        pages,
      },
      toolName: PDF_EXTRACTOR_TOOL.name,
      toolVersion: PDF_EXTRACTOR_TOOL.version,
    };
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    throwIfCancelled(input.signal);
    throw new RegistryError(
      'FILE_PROCESSING',
      'PDF 文本层解析失败；文件可能已损坏、加密或使用了暂不支持的编码。',
      { cause: error },
    );
  } finally {
    if (pdfDocument) await pdfDocument.destroy();
    else await loadingTask.destroy();
  }
}
