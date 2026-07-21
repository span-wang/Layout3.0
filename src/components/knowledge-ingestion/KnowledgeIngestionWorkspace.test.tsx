import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  KnowledgeIngestionItem,
  KnowledgeIngestionPublicationSummary,
  KnowledgeIngestionWorkflowStatus,
} from '@/types/knowledgeIngestion';
import { KnowledgeIngestionPublicationPanel } from './KnowledgeIngestionWorkspace';

function createItem(
  workflowStatus: KnowledgeIngestionWorkflowStatus,
  publication: KnowledgeIngestionPublicationSummary,
): KnowledgeIngestionItem {
  return {
    itemId: 'intake-ui-c4',
    versionId: 'version-renderer-existing-contract',
    fileName: '中文发布工作台测试.docx',
    extension: '.docx',
    sizeBytes: 2_048,
    contentHash: 'a'.repeat(64),
    status: 'processing',
    isDuplicate: false,
    metadata: {
      stableTitle: '中文发布工作台测试',
      domain: '教育',
      subject: '语文',
      materialType: '讲义',
      language: '中文',
      educationStage: '初中',
      grade: '七年级',
      semester: '上册',
      edition: '测试版',
      unit: '第一单元',
      parserProfile: 'education-textbook-v1',
    },
    lifecycle: {
      workflowStatus,
      processingHealth: 'healthy',
      indexPublicationStatus: workflowStatus === 'published' ? 'active' : 'pending',
      currentStage: null,
      currentJobStatus: null,
      errorMessage: null,
      chunkCount: 6,
      autoRetryScheduled: false,
      canCancel: false,
      canRetry: false,
      qualitySummary: {
        status: 'passed',
        conclusion: '所有快速质量阻断项已通过，资料等待发布。',
        startedAt: '2026-07-11T00:00:00.000Z',
        completedAt: '2026-07-11T00:01:00.000Z',
        expiresAt: '2026-07-11T00:31:00.000Z',
        questionCount: 3,
        results: [],
      },
    },
    publication,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:01:00.000Z',
  };
}

function renderItem(item: KnowledgeIngestionItem, actionItemId: string | null = null): string {
  return renderToStaticMarkup(
    <KnowledgeIngestionPublicationPanel
      item={item}
      actionItemId={actionItemId}
      onReceiveNextVersion={() => undefined}
      onOpenPublish={() => undefined}
      onOpenRollback={() => undefined}
      onRetry={() => undefined}
    />,
  );
}

test('PH3-13C4 中文工作台只按安全摘要展示发布、回滚、接收新版与人工重试入口', () => {
  const publishHtml = renderItem(createItem('pending_publication', {
      versionLabel: '第 2 版',
      previousVersionLabel: '第 1 版',
      isCurrentVersion: false,
      canReceiveNextVersion: false,
      canPublish: true,
      canRollback: false,
      canRetry: false,
      operationType: null,
      operationStatus: 'not_started',
      operationMessage: '质量门禁已通过，当前版本可以进入发布确认。',
      operationUpdatedAt: null,
  }));
  assert.match(publishHtml, /发布与版本/);
  assert.match(publishHtml, /<span>发布<\/span>/);
  assert.match(publishHtml, /正式可见性由 SQLite 当前发布关系控制/);

  const rollbackHtml = renderItem(createItem('published', {
      versionLabel: '第 2 版',
      previousVersionLabel: '第 1 版',
      isCurrentVersion: true,
      canReceiveNextVersion: true,
      canPublish: false,
      canRollback: true,
      canRetry: false,
      operationType: 'publish',
      operationStatus: 'completed',
      operationMessage: '发布已完成，当前版本已成为该资料分支的正式版本。',
      operationUpdatedAt: '2026-07-11T00:01:00.000Z',
  }));
  assert.match(rollbackHtml, /接收新版本/);
  assert.match(rollbackHtml, /<span>回滚<\/span>/);
  assert.match(rollbackHtml, /当前正式版本/);

  const retryHtml = renderItem(createItem('pending_publication', {
      versionLabel: '第 2 版',
      previousVersionLabel: '第 1 版',
      isCurrentVersion: false,
      canReceiveNextVersion: false,
      canPublish: false,
      canRollback: false,
      canRetry: true,
      operationType: 'publish',
      operationStatus: 'attention_required',
      operationMessage: '发布需要人工处理，请确认连接与资料状态后重试。',
      operationUpdatedAt: '2026-07-11T00:02:00.000Z',
  }));
  assert.match(retryHtml, /重试发布操作/);
  assert.match(retryHtml, /需要人工处理/);
  assert.doesNotMatch(retryHtml, /operation-secret|binding-secret|dataset-secret|document-secret|private\.example/);
});

test('PH3-13C4 发布面板按 Main 权限隐藏入口，并在操作中禁用当前按钮', () => {
  const lockedHtml = renderItem(createItem('pending_publication', {
    versionLabel: '第 2 版',
    previousVersionLabel: '第 1 版',
    isCurrentVersion: false,
    canReceiveNextVersion: false,
    canPublish: false,
    canRollback: false,
    canRetry: false,
    operationType: null,
    operationStatus: 'not_started',
    operationMessage: '当前状态不允许发布操作。',
    operationUpdatedAt: null,
  }));
  assert.doesNotMatch(lockedHtml, /<span>发布<\/span>|<span>回滚<\/span>|接收新版本|重试发布操作/);

  const busyItem = createItem('pending_publication', {
    versionLabel: '第 1 版',
    previousVersionLabel: null,
    isCurrentVersion: false,
    canReceiveNextVersion: false,
    canPublish: true,
    canRollback: false,
    canRetry: false,
    operationType: null,
    operationStatus: 'not_started',
    operationMessage: '质量门禁已通过，当前版本可以进入发布确认。',
    operationUpdatedAt: null,
  });
  const busyHtml = renderItem(busyItem, busyItem.itemId);
  assert.match(busyHtml, /<button[^>]*disabled=""[^>]*>.*?<span>发布<\/span>/);
});
