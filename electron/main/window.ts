import { BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    title: 'LAYOUT3.0',
    backgroundColor: '#f5f7f9',
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(currentDir, '../renderer/index.html'));
  }

  return mainWindow;
}
