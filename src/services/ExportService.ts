import { buildDocxArrayBuffer, type DocxExportPayload } from '@/services/exportDocx';
import { buildExportHtml } from '@/services/exportHtml';
import type { PdfExportPayload } from '@/services/exportHtml';

export async function exportCurrentDocumentAsPdf(payload: PdfExportPayload): Promise<string> {
  const result = await window.layoutAPI.exportPdf({
    html: buildExportHtml(payload),
    title: payload.title,
  });

  return result.filePath;
}

export async function exportCurrentDocumentAsDocx(payload: DocxExportPayload): Promise<string> {
  const docxArrayBuffer = await buildDocxArrayBuffer(payload);
  const result = await window.layoutAPI.exportDocx({
    data: new Uint8Array(docxArrayBuffer),
    title: payload.title,
  });

  return result.filePath;
}
