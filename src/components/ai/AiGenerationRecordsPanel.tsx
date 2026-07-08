import { useEffect, useMemo, useState } from 'react';
import type { AiGenerationRecord } from '@/types/ai';
import { KnowledgeSourceList } from './KnowledgeSourceList';

interface AiGenerationRecordsPanelProps {
  records: AiGenerationRecord[];
  recordDirectoryPath: string | null;
  error: string | null;
  onRefresh: () => Promise<void>;
  onRestore: (record: AiGenerationRecord) => void;
  onInsert: (record: AiGenerationRecord) => Promise<void>;
  onDelete: (recordId: string) => Promise<void>;
  onClear: () => Promise<void>;
}

function formatRecordTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return '时间未知';
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildRecordSubtitle(record: AiGenerationRecord): string {
  return [record.grade, record.subject, record.lengthLabel, record.requirementDescription ? '有要求描述' : null]
    .filter(Boolean)
    .join(' / ') || '未填写补充条件';
}

export function AiGenerationRecordsPanel({
  records,
  recordDirectoryPath,
  error,
  onRefresh,
  onRestore,
  onInsert,
  onDelete,
  onClear,
}: AiGenerationRecordsPanelProps): JSX.Element {
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(records[0]?.id ?? null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) ?? records[0] ?? null,
    [records, selectedRecordId],
  );

  useEffect(() => {
    if (!selectedRecord && records[0]) {
      setSelectedRecordId(records[0].id);
      return;
    }

    if (selectedRecord) {
      setSelectedRecordId(selectedRecord.id);
    }
  }, [records, selectedRecord]);

  const runBusyAction = async (id: string, action: () => Promise<void>) => {
    setBusyAction(id);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async (record: AiGenerationRecord) => {
    if (!window.confirm(`确定要删除「${record.topic}」这条 AI 生成记录吗？`)) {
      return;
    }

    await runBusyAction(`delete-${record.id}`, () => onDelete(record.id));
  };

  const handleClear = async () => {
    if (!window.confirm('确定要清空全部 AI 生成记录吗？本地记录文件夹中的记录文件也会被清空。')) {
      return;
    }

    await runBusyAction('clear', onClear);
  };

  return (
    <div className="ai-record-panel">
      <section className="panel-section">
        <div className="panel-section-header">
          <h2>AI生成记录</h2>
          <span>{records.length} 条</span>
        </div>
        <div className="ai-record-toolbar">
          <button
            type="button"
            className="ai-record-small-button"
            disabled={busyAction !== null}
            onClick={() => runBusyAction('refresh', onRefresh)}
          >
            刷新
          </button>
          <button
            type="button"
            className="ai-record-small-button danger"
            disabled={records.length === 0 || busyAction !== null}
            onClick={handleClear}
          >
            清空全部
          </button>
        </div>
        {recordDirectoryPath ? (
          <p className="ai-record-path" title={recordDirectoryPath}>
            存储文件夹：{recordDirectoryPath}
          </p>
        ) : null}
        {error ? <div className="ai-record-error">{error}</div> : null}
      </section>

      {records.length === 0 ? (
        <section className="panel-section">
          <div className="empty-panel-state">
            <p>完成一次 AI 生成后，记录会自动保存到本地工作区文件夹。</p>
          </div>
        </section>
      ) : (
        <section className="panel-section ai-record-list-section">
          <div className="ai-record-list">
            {records.map((record) => (
              <button
                key={record.id}
                type="button"
                className={record.id === selectedRecord?.id ? 'ai-record-row active' : 'ai-record-row'}
                onClick={() => setSelectedRecordId(record.id)}
              >
                <span className="ai-record-row-main">
                  <strong>{record.topic || '未命名主题'}</strong>
                  <span>{buildRecordSubtitle(record)}</span>
                </span>
                <span className="ai-record-row-meta">
                  <span>{record.typeLabel}</span>
                  <span>{formatRecordTime(record.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {selectedRecord ? (
        <section className="panel-section ai-record-detail-section">
          <div className="panel-section-header">
            <h2>记录内容</h2>
            <span>{selectedRecord.typeLabel}</span>
          </div>
          <div className="ai-record-detail-meta">
            <span>{formatRecordTime(selectedRecord.createdAt)}</span>
            {selectedRecord.grade ? <span>{selectedRecord.grade}</span> : null}
            {selectedRecord.subject ? <span>{selectedRecord.subject}</span> : null}
            {selectedRecord.lengthLabel ? <span>{selectedRecord.lengthLabel}</span> : null}
            {selectedRecord.model ? <span>{selectedRecord.model}</span> : null}
          </div>
          {selectedRecord.requirementDescription ? (
            <div className="ai-record-requirement">
              <strong>要求描述</strong>
              <p>{selectedRecord.requirementDescription}</p>
            </div>
          ) : null}
          <KnowledgeSourceList sources={selectedRecord.knowledgeSources ?? []} />
          <pre className="ai-record-content">{selectedRecord.content}</pre>
          <div className="ai-record-actions">
            <button type="button" className="ai-button ai-button-primary" onClick={() => onRestore(selectedRecord)}>
              恢复到结果区
            </button>
            <button
              type="button"
              className="ai-button"
              disabled={busyAction !== null}
              onClick={() => runBusyAction(`insert-${selectedRecord.id}`, () => onInsert(selectedRecord))}
            >
              插入当前文档
            </button>
            <button
              type="button"
              className="ai-button ai-button-danger"
              disabled={busyAction !== null}
              onClick={() => handleDelete(selectedRecord)}
            >
              删除记录
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
