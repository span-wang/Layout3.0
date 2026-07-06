import { writeFile } from 'node:fs/promises';
import { BrowserWindow, dialog } from 'electron';

export interface DocxExportRequest {
  data: Uint8Array;
  title: string;
}

export interface DocxExportResult {
  filePath: string;
}

function sanitizeDocxFileName(title: string): string {
  const sanitized = title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').trim();
  return sanitized || '未命名文档';
}

export async function exportDocx({ data, title }: DocxExportRequest): Promise<DocxExportResult> {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;

  const { canceled, filePath } = await dialog.showSaveDialog(targetWindow ?? undefined, {
    title: '导出 DOCX',
    defaultPath: `${sanitizeDocxFileName(title)}.docx`,
    filters: [{ name: 'Word 文档', extensions: ['docx'] }],
  });

  if (canceled || !filePath) {
    throw new Error('已取消导出 DOCX');
  }

  await writeFile(filePath, Buffer.from(data));
  return { filePath };
}
