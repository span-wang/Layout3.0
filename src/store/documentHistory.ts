import type { LayoutDocument } from '@/engine/document-model';
import { cloneStyleSettings } from '@/engine/style/styleSettings';
import type { StyleSettings } from '@/engine/style/types';
import type { DocumentHistorySnapshot } from '@/store/types';

const documentHistoryLimit = 50;

function cloneLayoutDocumentSnapshot(document: LayoutDocument): LayoutDocument {
  // LayoutDocument 目前是纯 JSON 结构，用 JSON 克隆可以避免历史快照被后续 immer 修改串联污染。
  return JSON.parse(JSON.stringify(document)) as LayoutDocument;
}

export function createDocumentHistorySnapshot(
  document: LayoutDocument,
  styleSettings: StyleSettings,
): DocumentHistorySnapshot {
  return {
    layoutDocument: cloneLayoutDocumentSnapshot(document),
    styleSettings: cloneStyleSettings(styleSettings),
  };
}

type DocumentHistoryCarrier = {
  layoutDocument: LayoutDocument | null;
  styleSettings: StyleSettings;
  documentHistoryPast: DocumentHistorySnapshot[];
  documentHistoryFuture: DocumentHistorySnapshot[];
};

export function pushDocumentHistoryEntry(
  state: DocumentHistoryCarrier,
  snapshot: DocumentHistorySnapshot,
): void {
  state.documentHistoryPast.push(snapshot);
  if (state.documentHistoryPast.length > documentHistoryLimit) {
    state.documentHistoryPast.shift();
  }
  // 新操作发生后，旧的重做链路不再成立。
  state.documentHistoryFuture = [];
}

export function pushDocumentHistorySnapshot(state: DocumentHistoryCarrier): void {
  if (!state.layoutDocument) {
    return;
  }

  pushDocumentHistoryEntry(
    state,
    createDocumentHistorySnapshot(state.layoutDocument, state.styleSettings),
  );
}
