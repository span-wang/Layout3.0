import { cloneStyleSettings, normalizeStyleSettings } from '@/engine/style/styleSettings';
import type { StyleSettings } from '@/engine/style/types';
import type { LayoutDocument } from './types';

export interface LayoutProjectFile {
  kind: 'layout-project';
  version: '1.0.0';
  savedAt: string;
  document: LayoutDocument;
  styleSettings: StyleSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLayoutDocumentCandidate(value: unknown): value is LayoutDocument {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.version === 'string' &&
    typeof value.title === 'string' &&
    typeof value.source === 'string' &&
    Array.isArray(value.blocks) &&
    Array.isArray(value.resources) &&
    isRecord(value.styles) &&
    isRecord(value.template) &&
    isRecord(value.viewState) &&
    isRecord(value.meta)
  );
}

export function serializeLayoutProjectFile(payload: {
  document: LayoutDocument;
  styleSettings: StyleSettings;
}): string {
  const projectFile: LayoutProjectFile = {
    kind: 'layout-project',
    version: '1.0.0',
    savedAt: new Date().toISOString(),
    document: payload.document,
    styleSettings: cloneStyleSettings(payload.styleSettings),
  };

  return JSON.stringify(projectFile, null, 2);
}

export function parseLayoutProjectFile(content: string): {
  document: LayoutDocument;
  styleSettings: StyleSettings;
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`layout 工程文件解析失败：${message}`);
  }

  if (!isRecord(parsed) || parsed.kind !== 'layout-project') {
    throw new Error('layout 工程文件格式无效：缺少正确的 kind 标记');
  }

  if (!isLayoutDocumentCandidate(parsed.document)) {
    throw new Error('layout 工程文件格式无效：document 字段缺失或结构不完整');
  }

  return {
    document: parsed.document,
    styleSettings: normalizeStyleSettings(parsed.styleSettings),
  };
}
