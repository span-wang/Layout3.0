import { contextBridge, ipcRenderer } from 'electron';

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
}

interface AiGenerationRecord {
  id: string;
  type: 'lecture' | 'summary' | 'exercise' | 'exam';
  typeLabel: string;
  topic: string;
  grade?: string;
  subject?: string;
  length?: 'short' | 'medium' | 'long';
  lengthLabel?: string;
  provider?: 'openai' | 'anthropic' | 'custom';
  model?: string;
  content: string;
  createdAt: string;
}

interface AiGenerationRecordFileResult {
  recordFilePath: string;
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
  requestAi: (payload: AiRequestPayload): Promise<AiRequestResult> =>
    ipcRenderer.invoke('ai:request', payload),
  cancelAiRequest: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke('ai:cancelRequest', requestId),
  listAiGenerationRecords: (payload: {
    workspaceRootPath: string | null;
  }): Promise<AiGenerationRecordFileResult> => ipcRenderer.invoke('aiRecords:list', payload),
  addAiGenerationRecord: (payload: {
    workspaceRootPath: string | null;
    record: Omit<AiGenerationRecord, 'id' | 'createdAt'> & Partial<Pick<AiGenerationRecord, 'id' | 'createdAt'>>;
  }): Promise<AiGenerationRecordFileResult> => ipcRenderer.invoke('aiRecords:add', payload),
  deleteAiGenerationRecord: (payload: {
    workspaceRootPath: string | null;
    recordId: string;
  }): Promise<AiGenerationRecordFileResult> => ipcRenderer.invoke('aiRecords:delete', payload),
  clearAiGenerationRecords: (payload: {
    workspaceRootPath: string | null;
  }): Promise<AiGenerationRecordFileResult> => ipcRenderer.invoke('aiRecords:clear', payload),
};

contextBridge.exposeInMainWorld('layoutAPI', layoutAPI);

export type LayoutAPI = typeof layoutAPI;
