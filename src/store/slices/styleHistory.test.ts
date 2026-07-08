import assert from 'node:assert/strict';
import test from 'node:test';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { createDocumentSlice } from '@/store/slices/documentSlice';
import { createStyleSlice } from '@/store/slices/styleSlice';
import type { AppStore } from '@/store/types';

function createTestStore() {
  return create<AppStore>()(
    immer((set, get, store) => ({
      ...(createDocumentSlice as any)(set, get, store),
      ...(createStyleSlice as any)(set, get, store),
    })),
  );
}

test('PH3-06 页面设置进入统一历史栈：页面尺寸可撤销重做', () => {
  const store = createTestStore();
  const initialPageSize = store.getState().styleSettings.pageSize;

  assert.equal(store.getState().documentHistoryPast.length, 0, '初始时不应存在历史快照。');

  store.getState().setPageSize('A3');

  assert.equal(store.getState().styleSettings.pageSize, 'A3', '页面尺寸应更新为 A3。');
  assert.equal(store.getState().documentHistoryPast.length, 1, '页面设置改动后应写入一条历史快照。');

  assert.equal(store.getState().undoLayoutDocument(), true, '页面设置改动现在应支持撤销。');
  assert.equal(store.getState().styleSettings.pageSize, initialPageSize, '撤销后应恢复原页面尺寸。');
  assert.equal(store.getState().documentHistoryFuture.length, 1, '撤销后应保留一条可重做快照。');

  assert.equal(store.getState().redoLayoutDocument(), true, '页面设置改动现在应支持重做。');
  assert.equal(store.getState().styleSettings.pageSize, 'A3', '重做后应重新应用 A3 页面尺寸。');
});

test('PH3-06 页面设置进入统一历史栈：新页面设置操作会清空旧重做链路', () => {
  const store = createTestStore();

  store.getState().setPageSize('A3');
  assert.equal(store.getState().undoLayoutDocument(), true, '应先能撤销页面尺寸改动。');
  assert.equal(store.getState().documentHistoryFuture.length, 1, '撤销后应存在可重做快照。');

  store.getState().setOrientation('landscape');

  assert.equal(store.getState().styleSettings.orientation, 'landscape', '新页面设置改动应成功写入。');
  assert.equal(store.getState().documentHistoryFuture.length, 0, '新操作发生后旧重做链路应被清空。');
});
