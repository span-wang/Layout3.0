import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';
import type {
  KnowledgeIngestionSelectResult,
} from '../../src/types/knowledgeIngestion';
import type { KnowledgeIngestionRuntime } from './knowledge-ingestion';
import {
  parseKnowledgeIngestionConfirmPayload,
  parseKnowledgeIngestionItemActionPayload,
  parseKnowledgeIngestionListRagflowDatasetsPayload,
  parseKnowledgeIngestionRagflowConfigPayload,
  parseKnowledgeIngestionRollbackPayload,
  parseKnowledgeIngestionStartQualityPayload,
} from './knowledge-ingestion/contract';
import { toSafeKnowledgeIngestionIpcError } from './knowledge-ingestion/ipc-errors';

async function selectKnowledgeIngestionFilePath(
  event: IpcMainInvokeEvent,
  title: string,
): Promise<string | null> {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    title,
    properties: ['openFile'],
    filters: [
      { name: '支持的资料', extensions: ['docx', 'pdf'] },
      { name: 'DOCX 文档', extensions: ['docx'] },
      { name: 'PDF 文档', extensions: ['pdf'] },
    ],
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

export function registerKnowledgeIngestionHandlers(runtime: KnowledgeIngestionRuntime): void {
  ipcMain.handle('knowledgeIngestion:getStatus', () => runtime.getStatus());
  ipcMain.handle('knowledgeIngestion:getRagflowConfigStatus', async () => {
    try {
      return await runtime.getRagflowConfigStatus();
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:listRagflowDatasetOptions', async (_event, payload: unknown) => {
    try {
      return await runtime.listRagflowDatasetOptions(parseKnowledgeIngestionListRagflowDatasetsPayload(payload));
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:saveRagflowConfig', async (_event, payload: unknown) => {
    try {
      return await runtime.saveRagflowConfig(parseKnowledgeIngestionRagflowConfigPayload(payload));
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:listItems', async () => {
    try {
      return (await runtime.getService()).listItems();
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:selectFile', async (event): Promise<KnowledgeIngestionSelectResult> => {
    try {
      const filePath = await selectKnowledgeIngestionFilePath(event, '选择要接收的资料');
      if (!filePath) {
        return { canceled: true, item: null };
      }
      const item = await (await runtime.getService()).intakeFile(filePath);
      return { canceled: false, item };
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:selectNextVersionFile', async (
    event,
    payload: unknown,
  ): Promise<KnowledgeIngestionSelectResult> => {
    try {
      const input = parseKnowledgeIngestionItemActionPayload(payload);
      // 文件路径只在 Main 的系统对话框中产生，Renderer 永远不能注入本机路径。
      const filePath = await selectKnowledgeIngestionFilePath(event, '选择该资料的新版本');
      if (!filePath) return { canceled: true, item: null };
      const item = await (await runtime.getService()).intakeFileAsNextVersion(input.itemId, filePath);
      return { canceled: false, item };
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:confirmMetadata', async (_event, payload: unknown) => {
    try {
      const input = parseKnowledgeIngestionConfirmPayload(payload);
      return (await runtime.getService()).confirmMetadata(input);
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:cancelProcessing', async (_event, payload: unknown) => {
    try {
      const input = parseKnowledgeIngestionItemActionPayload(payload);
      return (await runtime.getService()).cancelProcessing(input.itemId);
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:retryProcessing', async (_event, payload: unknown) => {
    try {
      const input = parseKnowledgeIngestionItemActionPayload(payload);
      return (await runtime.getService()).retryProcessing(input.itemId);
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:startQualityCheck', async (_event, payload: unknown) => {
    try {
      return await runtime.startQualityCheck(parseKnowledgeIngestionStartQualityPayload(payload));
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:startPublication', async (_event, payload: unknown) => {
    try {
      const input = parseKnowledgeIngestionItemActionPayload(payload);
      return await runtime.startPublication(input.itemId);
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:startRollback', async (_event, payload: unknown) => {
    try {
      const input = parseKnowledgeIngestionRollbackPayload(payload);
      return await runtime.startRollback(input.itemId, input.reason);
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
  ipcMain.handle('knowledgeIngestion:retryPublication', async (_event, payload: unknown) => {
    try {
      const input = parseKnowledgeIngestionItemActionPayload(payload);
      return await runtime.retryPublication(input.itemId);
    } catch (error) {
      throw toSafeKnowledgeIngestionIpcError(error);
    }
  });
}
