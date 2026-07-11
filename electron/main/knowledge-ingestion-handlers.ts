import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import type {
  KnowledgeIngestionSelectResult,
} from '../../src/types/knowledgeIngestion';
import type { KnowledgeIngestionRuntime } from './knowledge-ingestion';
import {
  parseKnowledgeIngestionConfirmPayload,
  parseKnowledgeIngestionItemActionPayload,
  parseKnowledgeIngestionListRagflowDatasetsPayload,
  parseKnowledgeIngestionRagflowConfigPayload,
  parseKnowledgeIngestionStartQualityPayload,
} from './knowledge-ingestion/contract';
import { toSafeKnowledgeIngestionIpcError } from './knowledge-ingestion/ipc-errors';

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
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const options: OpenDialogOptions = {
        title: '选择要接收的资料',
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
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, item: null };
      }
      const item = await (await runtime.getService()).intakeFile(result.filePaths[0]);
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
}
