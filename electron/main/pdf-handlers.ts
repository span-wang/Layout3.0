import { writeFile } from 'node:fs/promises';
import { BrowserWindow, dialog } from 'electron';
import type { PrintToPDFOptions } from 'electron';

export interface PdfExportRequest {
  html: string;
  title: string;
}

export interface PdfExportResult {
  filePath: string;
}

function sanitizePdfFileName(title: string): string {
  const sanitized = title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').trim();
  return sanitized || '未命名文档';
}

async function createExportWebContents(html: string): Promise<Electron.WebContents> {
  const exportWindow = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: false,
    },
  });

  await exportWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
  await exportWindow.webContents.executeJavaScript('document.fonts ? document.fonts.ready : Promise.resolve()');

  return exportWindow.webContents;
}

function getPdfOptions(): PrintToPDFOptions {
  return {
    printBackground: true,
    pageSize: 'A4',
    margins: {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    },
  };
}

export async function exportPdf({ html, title }: PdfExportRequest): Promise<PdfExportResult> {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;

  const { canceled, filePath } = await dialog.showSaveDialog(targetWindow ?? undefined, {
    title: '导出 PDF',
    defaultPath: `${sanitizePdfFileName(title)}.pdf`,
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
  });

  if (canceled || !filePath) {
    throw new Error('已取消导出 PDF');
  }

  const exportContents = await createExportWebContents(html);

  try {
    const pdfBuffer = await exportContents.printToPDF(getPdfOptions());
    await exportContents.session.flushStorageData();
    await writeFile(filePath, pdfBuffer);

    return { filePath };
  } finally {
    BrowserWindow.fromWebContents(exportContents)?.destroy();
  }
}
