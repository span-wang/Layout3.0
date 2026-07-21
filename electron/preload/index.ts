import { contextBridge, ipcRenderer } from 'electron';
import type {
  KnowledgeIngestionConfirmMetadataInput,
  KnowledgeIngestionItem,
  KnowledgeIngestionItemActionInput,
  KnowledgeIngestionListRagflowDatasetsInput,
  KnowledgeIngestionRagflowDatasetOption,
  KnowledgeIngestionRagflowConfigStatus,
  KnowledgeIngestionRollbackInput,
  KnowledgeIngestionRuntimeStatus,
  KnowledgeIngestionSaveRagflowConfigInput,
  KnowledgeIngestionSelectResult,
  KnowledgeIngestionStartQualityCheckInput,
} from '../../src/types/knowledgeIngestion';

interface LayoutDirectoryEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: LayoutDirectoryEntry[];
}

interface AiRequestPayload {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface AiRequestResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  transportError?: {
    code: string;
    message: string;
  };
}

interface KnowledgeSourceReference {
  id: string;
  sourceType: 'ragflow';
  title: string;
  location?: string;
  detail?: string;
  preview?: string;
}

interface AiGenerationRecord {
  id: string;
  type:
    | 'lecture'
    | 'summary'
    | 'exercise'
    | 'exam'
    | 'xiaohongshuTitle'
    | 'xiaohongshuCopy'
    | 'xiaohongshuCover';
  typeLabel: string;
  topic: string;
  grade?: string;
  subject?: string;
  requirementDescription?: string;
  length?: 'short' | 'medium' | 'long';
  lengthLabel?: string;
  provider?: 'openai' | 'anthropic' | 'custom';
  model?: string;
  knowledgeSources?: KnowledgeSourceReference[];
  content: string;
  createdAt: string;
}

interface AiGenerationRecordDirectoryResult {
  recordDirectoryPath: string;
  records: AiGenerationRecord[];
}

const layoutAPI = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getDefaultWorkspace: (): Promise<{
    directoryPath: string;
    entries: LayoutDirectoryEntry[];
  }> => ipcRenderer.invoke('file:getDefaultWorkspace'),
  openFile: (): Promise<{ filePath: string; content: string }> => ipcRenderer.invoke('file:open'),
  openFileAtPath: (filePath: string): Promise<{ filePath: string; content: string }> =>
    ipcRenderer.invoke('file:openAtPath', filePath),
  selectImageFile: (): Promise<{ filePath: string }> => ipcRenderer.invoke('file:selectImage'),
  importFontFile: (): Promise<{ filePath: string; fileName: string }> => ipcRenderer.invoke('file:importFont'),
  importFontToWorkspace: (payload: {
    workspaceRootPath: string;
    relativeFontPath: string;
  }): Promise<{ filePath: string; fileName: string }> =>
    ipcRenderer.invoke('file:importFontToWorkspace', payload),
  openFolder: (): Promise<{
    directoryPath: string;
    entries: LayoutDirectoryEntry[];
  }> => ipcRenderer.invoke('file:openFolder'),
  readDirectory: (
    directoryPath: string,
  ): Promise<{
    directoryPath: string;
    entries: LayoutDirectoryEntry[];
  }> => ipcRenderer.invoke('file:readDirectory', directoryPath),
  createFolder: (payload: {
    parentPath: string;
    folderName: string;
  }): Promise<{
    directoryPath: string;
    entries: LayoutDirectoryEntry[];
    targetPath: string;
  }> => ipcRenderer.invoke('file:createFolder', payload),
  createLayoutFile: (payload: {
    directoryPath: string;
    fileName: string;
    content: string;
  }): Promise<{ filePath: string; content: string }> => ipcRenderer.invoke('file:createLayoutFile', payload),
  renameEntry: (payload: {
    targetPath: string;
    nextName: string;
  }): Promise<{
    directoryPath: string;
    entries: LayoutDirectoryEntry[];
    targetPath: string;
  }> => ipcRenderer.invoke('file:renameEntry', payload),
  moveEntry: (payload: {
    sourcePath: string;
    destinationDirectoryPath: string;
  }): Promise<{
    directoryPath: string;
    entries: LayoutDirectoryEntry[];
    movedPath: string;
  }> => ipcRenderer.invoke('file:moveEntry', payload),
  deleteEntry: (payload: { targetPath: string }): Promise<{
    directoryPath: string;
    entries: LayoutDirectoryEntry[];
  }> => ipcRenderer.invoke('file:deleteEntry', payload),
  saveFile: (payload: {
    filePath: string | null;
    content: string;
    defaultName: string;
  }): Promise<{ filePath: string }> => ipcRenderer.invoke('file:save', payload),
  exportPdf: (payload: { html: string; title: string }): Promise<{ filePath: string }> =>
    ipcRenderer.invoke('file:exportPdf', payload),
  exportDocx: (payload: { data: Uint8Array; title: string }): Promise<{ filePath: string }> =>
    ipcRenderer.invoke('file:exportDocx', payload),
  requestAi: (payload: AiRequestPayload): Promise<AiRequestResult> =>
    ipcRenderer.invoke('ai:request', payload),
  cancelAiRequest: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke('ai:cancelRequest', requestId),
  listAiGenerationRecords: (payload: {
    workspaceRootPath: string | null;
  }): Promise<AiGenerationRecordDirectoryResult> => ipcRenderer.invoke('aiRecords:list', payload),
  addAiGenerationRecord: (payload: {
    workspaceRootPath: string | null;
    record: Omit<AiGenerationRecord, 'id' | 'createdAt'> & Partial<Pick<AiGenerationRecord, 'id' | 'createdAt'>>;
  }): Promise<AiGenerationRecordDirectoryResult> => ipcRenderer.invoke('aiRecords:add', payload),
  deleteAiGenerationRecord: (payload: {
    workspaceRootPath: string | null;
    recordId: string;
  }): Promise<AiGenerationRecordDirectoryResult> => ipcRenderer.invoke('aiRecords:delete', payload),
  clearAiGenerationRecords: (payload: {
    workspaceRootPath: string | null;
  }): Promise<AiGenerationRecordDirectoryResult> => ipcRenderer.invoke('aiRecords:clear', payload),
  getKnowledgeIngestionStatus: (): Promise<KnowledgeIngestionRuntimeStatus> =>
    ipcRenderer.invoke('knowledgeIngestion:getStatus'),
  getKnowledgeIngestionRagflowConfigStatus: (): Promise<KnowledgeIngestionRagflowConfigStatus> =>
    ipcRenderer.invoke('knowledgeIngestion:getRagflowConfigStatus'),
  listKnowledgeIngestionRagflowDatasetOptions: (
    payload: KnowledgeIngestionListRagflowDatasetsInput,
  ): Promise<KnowledgeIngestionRagflowDatasetOption[]> =>
    ipcRenderer.invoke('knowledgeIngestion:listRagflowDatasetOptions', payload),
  saveKnowledgeIngestionRagflowConfig: (
    payload: KnowledgeIngestionSaveRagflowConfigInput,
  ): Promise<KnowledgeIngestionRagflowConfigStatus> =>
    ipcRenderer.invoke('knowledgeIngestion:saveRagflowConfig', payload),
  listKnowledgeIngestionItems: (): Promise<KnowledgeIngestionItem[]> =>
    ipcRenderer.invoke('knowledgeIngestion:listItems'),
  selectKnowledgeIngestionFile: (): Promise<KnowledgeIngestionSelectResult> =>
    ipcRenderer.invoke('knowledgeIngestion:selectFile'),
  selectKnowledgeIngestionNextVersionFile: (
    payload: KnowledgeIngestionItemActionInput,
  ): Promise<KnowledgeIngestionSelectResult> =>
    ipcRenderer.invoke('knowledgeIngestion:selectNextVersionFile', payload),
  confirmKnowledgeIngestionMetadata: (
    payload: KnowledgeIngestionConfirmMetadataInput,
  ): Promise<KnowledgeIngestionItem> =>
    ipcRenderer.invoke('knowledgeIngestion:confirmMetadata', payload),
  cancelKnowledgeIngestionProcessing: (
    payload: KnowledgeIngestionItemActionInput,
  ): Promise<KnowledgeIngestionItem> =>
    ipcRenderer.invoke('knowledgeIngestion:cancelProcessing', payload),
  retryKnowledgeIngestionProcessing: (
    payload: KnowledgeIngestionItemActionInput,
  ): Promise<KnowledgeIngestionItem> =>
    ipcRenderer.invoke('knowledgeIngestion:retryProcessing', payload),
  startKnowledgeIngestionQualityCheck: (
    payload: KnowledgeIngestionStartQualityCheckInput,
  ): Promise<KnowledgeIngestionItem> =>
    ipcRenderer.invoke('knowledgeIngestion:startQualityCheck', payload),
  startKnowledgeIngestionPublication: (
    payload: KnowledgeIngestionItemActionInput,
  ): Promise<KnowledgeIngestionItem> =>
    ipcRenderer.invoke('knowledgeIngestion:startPublication', payload),
  startKnowledgeIngestionRollback: (
    payload: KnowledgeIngestionRollbackInput,
  ): Promise<KnowledgeIngestionItem> =>
    ipcRenderer.invoke('knowledgeIngestion:startRollback', payload),
  retryKnowledgeIngestionPublication: (
    payload: KnowledgeIngestionItemActionInput,
  ): Promise<KnowledgeIngestionItem> =>
    ipcRenderer.invoke('knowledgeIngestion:retryPublication', payload),
};

contextBridge.exposeInMainWorld('layoutAPI', layoutAPI);

export type LayoutAPI = typeof layoutAPI;
