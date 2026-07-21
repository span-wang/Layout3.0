import assert from 'node:assert/strict';
import test from 'node:test';
import { produce } from 'immer';
import {
  createKnowledgeIngestionSlice,
  type KnowledgeIngestionSlice,
} from '@/store/slices/knowledgeIngestionSlice';
import type { KnowledgeIngestionItem } from '@/types/knowledgeIngestion';

function createItem(
  itemId: string,
  publication: Partial<KnowledgeIngestionItem['publication']> = {},
): KnowledgeIngestionItem {
  return {
    itemId,
    versionId: `version-${itemId}`,
    fileName: `${itemId}.pdf`,
    extension: '.pdf',
    sizeBytes: 1024,
    contentHash: `hash-${itemId}`,
    status: 'processing',
    isDuplicate: false,
    metadata: {
      stableTitle: '测试资料',
      domain: '教育',
      subject: '语文',
      materialType: '教材',
      language: '中文',
      educationStage: '小学',
      grade: '三年级',
      semester: '上册',
      edition: '测试版',
      unit: '第一单元',
      parserProfile: 'default',
    },
    lifecycle: {
      workflowStatus: 'published',
      processingHealth: 'healthy',
      indexPublicationStatus: 'active',
      currentStage: null,
      currentJobStatus: null,
      errorMessage: null,
      chunkCount: 10,
      autoRetryScheduled: false,
      canCancel: false,
      canRetry: false,
      qualitySummary: {
        status: 'passed',
        conclusion: '质量检查通过。',
        startedAt: '2026-07-11T00:00:00.000Z',
        completedAt: '2026-07-11T00:01:00.000Z',
        expiresAt: '2026-07-11T00:31:00.000Z',
        questionCount: 1,
        results: [],
      },
    },
    publication: {
      versionLabel: '第 1 版',
      previousVersionLabel: null,
      isCurrentVersion: true,
      canReceiveNextVersion: true,
      canPublish: false,
      canRollback: true,
      canRetry: false,
      operationType: null,
      operationStatus: 'not_started',
      operationMessage: '当前正式版本。',
      operationUpdatedAt: null,
      ...publication,
    },
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
  };
}

function createSliceHarness(items: KnowledgeIngestionItem[]): {
  getState: () => KnowledgeIngestionSlice;
} {
  let state: KnowledgeIngestionSlice;
  type SliceParameters = Parameters<typeof createKnowledgeIngestionSlice>;
  const setState = ((update: unknown) => {
    state = produce(state, (draft) => {
      if (typeof update === 'function') {
        (update as (value: KnowledgeIngestionSlice) => void)(
          draft as unknown as KnowledgeIngestionSlice,
        );
        return;
      }
      Object.assign(draft, update);
    });
  }) as SliceParameters[0];

  state = createKnowledgeIngestionSlice(
    setState,
    (() => state) as unknown as SliceParameters[1],
    {} as SliceParameters[2],
  );
  state = produce(state, (draft) => {
    draft.knowledgeIngestionItems = items;
    draft.selectedKnowledgeIngestionItemId = items[0]?.itemId ?? null;
  });
  return { getState: () => state };
}

function installLayoutApi(overrides: Partial<Window['layoutAPI']>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { layoutAPI: overrides },
    writable: true,
  });
}

test('发布、回滚和人工重试成功后，即使全量刷新失败也保留 Main 返回的新状态', async (t) => {
  const cases = [
    {
      name: '发布',
      installAction: (updated: KnowledgeIngestionItem) => ({
        startKnowledgeIngestionPublication: async () => updated,
      }),
      runAction: (slice: KnowledgeIngestionSlice) =>
        slice.startKnowledgeIngestionItemPublication({ itemId: 'item-1' }),
    },
    {
      name: '回滚',
      installAction: (updated: KnowledgeIngestionItem) => ({
        startKnowledgeIngestionRollback: async () => updated,
      }),
      runAction: (slice: KnowledgeIngestionSlice) =>
        slice.startKnowledgeIngestionItemRollback({ itemId: 'item-1', reason: '测试回滚' }),
    },
    {
      name: '人工重试',
      installAction: (updated: KnowledgeIngestionItem) => ({
        retryKnowledgeIngestionPublication: async () => updated,
      }),
      runAction: (slice: KnowledgeIngestionSlice) =>
        slice.retryKnowledgeIngestionItemPublication({ itemId: 'item-1' }),
    },
  ];

  for (const currentCase of cases) {
    await t.test(currentCase.name, async () => {
      const original = createItem('item-1', {
        canPublish: true,
        canRollback: true,
        canRetry: true,
      });
      const updated = createItem('item-1', {
        canReceiveNextVersion: false,
        canPublish: false,
        canRollback: false,
        canRetry: false,
        operationStatus: 'queued',
        operationMessage: `${currentCase.name}任务已排队。`,
      });
      let listCallCount = 0;
      installLayoutApi({
        ...currentCase.installAction(updated),
        listKnowledgeIngestionItems: async () => {
          listCallCount += 1;
          throw new Error('模拟刷新失败');
        },
      });
      const harness = createSliceHarness([original]);

      await assert.doesNotReject(() => currentCase.runAction(harness.getState()));

      const state = harness.getState();
      assert.equal(listCallCount, 1);
      assert.deepEqual(state.knowledgeIngestionItems, [updated]);
      assert.equal(state.selectedKnowledgeIngestionItemId, updated.itemId);
      assert.equal(state.knowledgeIngestionActionItemId, null);
      assert.equal(state.knowledgeIngestionError, null);
    });
  }
});

test('接收非重复新版成功后，刷新失败时仍立即加入新版并关闭旧版的接收入口', async () => {
  const original = createItem('item-1', { canReceiveNextVersion: true });
  const updated = createItem('item-2', {
    versionLabel: '第 2 版',
    previousVersionLabel: '第 1 版',
    isCurrentVersion: false,
    canReceiveNextVersion: false,
    canRollback: false,
  });
  updated.lifecycle.workflowStatus = 'pending_confirmation';
  updated.lifecycle.processingHealth = 'pending';
  updated.lifecycle.indexPublicationStatus = 'pending';
  installLayoutApi({
    selectKnowledgeIngestionNextVersionFile: async () => ({ canceled: false, item: updated }),
    listKnowledgeIngestionItems: async () => {
      throw new Error('模拟刷新失败');
    },
  });
  const harness = createSliceHarness([original]);

  await assert.doesNotReject(() =>
    harness.getState().receiveKnowledgeIngestionNextVersion({ itemId: original.itemId }),
  );

  const state = harness.getState();
  assert.equal(state.knowledgeIngestionItems[0]?.itemId, updated.itemId);
  assert.equal(
    state.knowledgeIngestionItems.find((item) => item.itemId === original.itemId)
      ?.publication.canReceiveNextVersion,
    false,
  );
  assert.equal(state.selectedKnowledgeIngestionItemId, updated.itemId);
  assert.equal(state.knowledgeIngestionActionItemId, null);
  assert.equal(state.knowledgeIngestionError, null);
});
