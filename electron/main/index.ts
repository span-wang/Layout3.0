import { app, BrowserWindow } from 'electron';
import { registerAssetProtocol } from './asset-protocol';
import { registerIpcHandlers } from './ipc-handlers';
import { createMainWindow } from './window';
import { KnowledgeIngestionRuntime } from './knowledge-ingestion';
import { electronSafeStorageCipher } from './knowledge-ingestion/electron-safe-storage';

let mainWindow: BrowserWindow | null = null;
let knowledgeIngestionRuntime: KnowledgeIngestionRuntime | null = null;
let quitApproved = false;
let shutdownPromise: Promise<void> | null = null;

function openMainWindow(): void {
  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerAssetProtocol();
  knowledgeIngestionRuntime = new KnowledgeIngestionRuntime(app.getPath('userData'), {
    credentialCipher: electronSafeStorageCipher,
  });
  registerIpcHandlers({ knowledgeIngestionRuntime });
  // runner 主动启动；登记库故障仍由独立状态返回，不阻断排版工作台打开。
  void knowledgeIngestionRuntime.start().catch(() => undefined);
  openMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow();
    }
  });
});

app.on('before-quit', (event) => {
  if (quitApproved) return;
  event.preventDefault();
  if (shutdownPromise) return;

  const runtime = knowledgeIngestionRuntime;
  shutdownPromise = (async () => {
    try {
      // 必须先等待 runner 中止、心跳停止并释放租约，最后才允许 SQLite 关闭和应用退出。
      await runtime?.close();
    } catch {
      // close 自身会在 finally 关闭数据库；退出阶段不再把错误抛成未处理拒绝。
    } finally {
      if (knowledgeIngestionRuntime === runtime) knowledgeIngestionRuntime = null;
      quitApproved = true;
      app.quit();
    }
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
