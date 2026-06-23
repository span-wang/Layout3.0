import { contextBridge, ipcRenderer } from 'electron';

interface LayoutDirectoryEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: LayoutDirectoryEntry[];
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
};

contextBridge.exposeInMainWorld('layoutAPI', layoutAPI);

export type LayoutAPI = typeof layoutAPI;
