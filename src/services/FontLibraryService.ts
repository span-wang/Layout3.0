/**
 * 工作区字体库服务
 *
 * 职责：
 * 1. 将导入的字体文件复制到工作区内的 `.fonts/` 目录
 * 2. 在 localStorage 中维护每个工作区的字体元数据
 * 3. 提供字体库的增删查接口
 *
 * 设计原则：
 * - 字体文件存储在工作区目录中，随工作区移动时可完整迁移
 * - 字体元数据（名称、格式等）存储在 localStorage，不占用 .layout 文件空间
 * - 字体库按工作区路径隔离，不同工作区的字体互不影响
 */

import { mergeFontResources } from '@/engine/document-model/fontResources';
import type { LayoutFontFormat, LayoutFontResource, LayoutResource } from '@/engine/document-model/types';

const FONT_LIBRARY_STORAGE_PREFIX = 'layout3.fontLibrary.v1:';

/** 存储在 localStorage 中的字体条目 */
interface StoredFontEntry {
  id: string;
  /** 字体文件的相对路径，相对于工作区根目录 */
  relativePath: string;
  displayName: string;
  fontFamily: string;
  format: LayoutFontFormat;
  originalFileName: string;
  importedAt: string;
}

interface FontLibraryPayload {
  workspacePath: string;
  fonts: StoredFontEntry[];
}

function getStorageKey(workspacePath: string): string {
  return `${FONT_LIBRARY_STORAGE_PREFIX}${workspacePath}`;
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 加载指定工作区的字体库 */
export function loadWorkspaceFontLibrary(workspacePath: string): LayoutFontResource[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const key = getStorageKey(workspacePath);
    const rawValue = storage.getItem(key);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue) as FontLibraryPayload;
    if (!parsed || !Array.isArray(parsed.fonts)) {
      return [];
    }

    return parsed.fonts.map((entry) => ({
      id: entry.id,
      type: 'font' as const,
      /** 存储时用相对路径，加载时由调用方拼装完整路径 */
      src: entry.relativePath,
      displayName: entry.displayName,
      fontFamily: entry.fontFamily,
      format: entry.format,
      originalFileName: entry.originalFileName,
      importedAt: entry.importedAt,
    }));
  } catch {
    return [];
  }
}

/** 保存指定工作区的字体库 */
export function saveWorkspaceFontLibrary(workspacePath: string, fonts: LayoutFontResource[]): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    const payload: FontLibraryPayload = {
      workspacePath,
      fonts: fonts.map((font) => ({
        id: font.id,
        /** 保存时转为相对路径 */
        relativePath: font.src,
        displayName: font.displayName,
        fontFamily: font.fontFamily,
        format: font.format,
        originalFileName: font.originalFileName,
        importedAt: font.importedAt,
      })),
    };

    const key = getStorageKey(workspacePath);
    storage.setItem(key, JSON.stringify(payload));
  } catch {
    // localStorage 写失败不阻断主流程
  }
}

/** 向指定工作区字体库添加字体 */
export function addFontToWorkspaceLibrary(
  workspacePath: string,
  font: LayoutFontResource,
): LayoutFontResource[] {
  const existingFonts = loadWorkspaceFontLibrary(workspacePath);
  const existingIndex = existingFonts.findIndex((f) => f.id === font.id || f.src === font.src);

  let nextFonts: LayoutFontResource[];
  if (existingIndex < 0) {
    nextFonts = [...existingFonts, font];
  } else {
    nextFonts = existingFonts.map((f, i) => (i === existingIndex ? font : f));
  }

  saveWorkspaceFontLibrary(workspacePath, nextFonts);
  return nextFonts;
}

/** 将指定工作区字体库合并到当前文档资源 */
export function mergeWorkspaceFontLibraryIntoResources(
  resources: LayoutResource[],
  workspacePath: string | null | undefined,
): LayoutResource[] {
  if (!workspacePath) {
    return resources;
  }

  const workspaceFonts = loadWorkspaceFontLibrary(workspacePath);
  if (workspaceFonts.length === 0) {
    return resources;
  }

  // 打开或新建文档时，把工作区字体补回当前文档资源，顶端工具栏才能跨文档持续显示。
  return mergeFontResources(resources, workspaceFonts);
}

/** 从指定工作区字体库移除字体 */
export function removeFontFromWorkspaceLibrary(
  workspacePath: string,
  fontId: string,
): LayoutFontResource[] {
  const existingFonts = loadWorkspaceFontLibrary(workspacePath);
  const nextFonts = existingFonts.filter((f) => f.id !== fontId);
  saveWorkspaceFontLibrary(workspacePath, nextFonts);
  return nextFonts;
}

/** 清除指定工作区的字体库 */
export function clearWorkspaceFontLibrary(workspacePath: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    const key = getStorageKey(workspacePath);
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

/** 获取工作区字体库的字体数量 */
export function getWorkspaceFontCount(workspacePath: string): number {
  const storage = getStorage();
  if (!storage) {
    return 0;
  }

  try {
    const key = getStorageKey(workspacePath);
    const rawValue = storage.getItem(key);
    if (!rawValue) {
      return 0;
    }

    const parsed = JSON.parse(rawValue) as FontLibraryPayload;
    return Array.isArray(parsed.fonts) ? parsed.fonts.length : 0;
  } catch {
    return 0;
  }
}
