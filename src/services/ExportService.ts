import { buildExportHtml } from '@/services/exportHtml';
import type { PdfExportPayload } from '@/services/exportHtml';

export async function exportCurrentDocumentAsPdf(payload: PdfExportPayload): Promise<string> {
  const result = await window.layoutAPI.exportPdf({
    html: buildExportHtml(payload),
    title: payload.title,
  });

  return result.filePath;
}
