import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc-handlers';
import { createMainWindow } from './window';

let mainWindow: BrowserWindow | null = null;

function openMainWindow(): void {
  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  openMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
