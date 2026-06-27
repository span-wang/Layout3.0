import { app, ipcMain } from 'electron';
import {
  deleteEntry,
  createFolder,
  createLayoutFile,
  getDefaultWorkspace,
  importFontFile,
  moveEntry,
  openDocument,
  openDocumentAtPath,
  openFolder,
  readDirectory,
  renameEntry,
  saveDocument,
  selectImageFile,
} from './file-handlers';
import { exportPdf } from './pdf-handlers';
import { registerAiHandlers } from './ai-handlers';
import { registerAiRecordHandlers } from './ai-record-handlers';

export function registerIpcHandlers(): void {
  registerAiHandlers();
  registerAiRecordHandlers();
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('file:getDefaultWorkspace', () => getDefaultWorkspace());
  ipcMain.handle('file:open', () => openDocument());
  ipcMain.handle('file:openAtPath', (_event, filePath: string) => openDocumentAtPath(filePath));
  ipcMain.handle('file:selectImage', () => selectImageFile());
  ipcMain.handle('file:importFont', () => importFontFile());
  ipcMain.handle('file:openFolder', () => openFolder());
  ipcMain.handle('file:readDirectory', (_event, directoryPath: string) => readDirectory(directoryPath));
  ipcMain.handle(
    'file:createFolder',
    (_event, payload: { parentPath: string; folderName: string }) => createFolder(payload),
  );
  ipcMain.handle(
    'file:createLayoutFile',
    (_event, payload: { directoryPath: string; fileName: string; content: string }) =>
      createLayoutFile(payload),
  );
  ipcMain.handle(
    'file:renameEntry',
    (_event, payload: { targetPath: string; nextName: string }) => renameEntry(payload),
  );
  ipcMain.handle(
    'file:moveEntry',
    (_event, payload: { sourcePath: string; destinationDirectoryPath: string }) =>
      moveEntry(payload),
  );
  ipcMain.handle(
    'file:deleteEntry',
    (_event, payload: { targetPath: string }) => deleteEntry(payload),
  );
  ipcMain.handle(
    'file:save',
    (_event, payload: { filePath: string | null; content: string; defaultName: string }) =>
      saveDocument(payload),
  );
  ipcMain.handle('file:exportPdf', (_event, payload: { html: string; title: string }) =>
    exportPdf(payload),
  );
}
