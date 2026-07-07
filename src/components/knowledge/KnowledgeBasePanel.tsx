import { useMemo, useState } from 'react';
import { BookOpenText, Database, Link2 } from 'lucide-react';
import { knowledgeBaseService } from '@/services/KnowledgeBaseService';
import { useAppStore } from '@/store';
import type { RagflowChunk } from '@/types/knowledge';

type FeedbackTone = 'success' | 'error';

interface FeedbackState {
  tone: FeedbackTone;
  message: string;
}

function renderFeedback(feedback: FeedbackState | null): JSX.Element | null {
  if (!feedback) {
    return null;
  }

  return (
    <div className={feedback.tone === 'success' ? 'knowledge-feedback success' : 'knowledge-feedback error'}>
      {feedback.message}
    </div>
  );
}

function buildChunkPreview(chunk: RagflowChunk): string {
  if (chunk.content.length <= 180) {
    return chunk.content;
  }

  return `${chunk.content.slice(0, 180)}...`;
}

export function KnowledgeBasePanel(): JSX.Element {
  const ragflowConfig = useAppStore((state) => state.ragflowConfig);
  const openNotebookConfig = useAppStore((state) => state.openNotebookConfig);
  const ragflowDatasets = useAppStore((state) => state.ragflowDatasets);
  const selectedRagflowDatasetIds = useAppStore((state) => state.selectedRagflowDatasetIds);
  const useRagflowKnowledgeForGenerate = useAppStore((state) => state.useRagflowKnowledgeForGenerate);
  const setRagflowConfigPatch = useAppStore((state) => state.setRagflowConfigPatch);
  const setOpenNotebookConfigPatch = useAppStore((state) => state.setOpenNotebookConfigPatch);
  const setRagflowDatasets = useAppStore((state) => state.setRagflowDatasets);
  const setSelectedRagflowDatasetIds = useAppStore((state) => state.setSelectedRagflowDatasetIds);
  const toggleSelectedRagflowDataset = useAppStore((state) => state.toggleSelectedRagflowDataset);
  const setUseRagflowKnowledgeForGenerate = useAppStore((state) => state.setUseRagflowKnowledgeForGenerate);

  const [isTestingRagflow, setIsTestingRagflow] = useState(false);
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(false);
  const [isTestingRetrieval, setIsTestingRetrieval] = useState(false);
  const [isTestingOpenNotebook, setIsTestingOpenNotebook] = useState(false);
  const [ragflowFeedback, setRagflowFeedback] = useState<FeedbackState | null>(null);
  const [openNotebookFeedback, setOpenNotebookFeedback] = useState<FeedbackState | null>(null);
  const [retrievalFeedback, setRetrievalFeedback] = useState<FeedbackState | null>(null);
  const [retrievalQuery, setRetrievalQuery] = useState('');
  const [retrievalResults, setRetrievalResults] = useState<RagflowChunk[]>([]);

  const datasetNameMap = useMemo(
    () => new Map(ragflowDatasets.map((dataset) => [dataset.id, dataset.name])),
    [ragflowDatasets],
  );
  const selectedDatasetCount = selectedRagflowDatasetIds.length;

  const handleTestRagflow = async () => {
    setIsTestingRagflow(true);
    setRagflowFeedback(null);

    try {
      const result = await knowledgeBaseService.testRagflowConnection(ragflowConfig);
      setRagflowFeedback({
        tone: 'success',
        message: `RAGFlow 连接成功，当前可读取 ${result.datasetCount} 个数据集。`,
      });
    } catch (error) {
      setRagflowFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'RAGFlow 连接失败',
      });
    } finally {
      setIsTestingRagflow(false);
    }
  };

  const handleLoadDatasets = async () => {
    setIsLoadingDatasets(true);
    setRagflowFeedback(null);

    try {
      const datasets = await knowledgeBaseService.listRagflowDatasets(ragflowConfig);
      setRagflowDatasets(datasets);
      setRagflowFeedback({
        tone: 'success',
        message: datasets.length > 0 ? `已读取 ${datasets.length} 个数据集。` : '当前没有可用数据集。',
      });
    } catch (error) {
      setRagflowFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '读取 RAGFlow 数据集失败',
      });
    } finally {
      setIsLoadingDatasets(false);
    }
  };

  const handleTestRetrieval = async () => {
    setIsTestingRetrieval(true);
    setRetrievalFeedback(null);
    setRetrievalResults([]);

    try {
      const results = await knowledgeBaseService.retrieveRagflowChunks({
        config: ragflowConfig,
        datasetIds: selectedRagflowDatasetIds,
        query: retrievalQuery,
      });
      setRetrievalResults(results);
      setRetrievalFeedback({
        tone: 'success',
        message: results.length > 0 ? `已检索到 ${results.length} 条知识片段。` : '没有检索到匹配片段。',
      });
    } catch (error) {
      setRetrievalFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'RAGFlow 检索失败',
      });
    } finally {
      setIsTestingRetrieval(false);
    }
  };

  const handleTestOpenNotebook = async () => {
    setIsTestingOpenNotebook(true);
    setOpenNotebookFeedback(null);

    try {
      const result = await knowledgeBaseService.testOpenNotebookConnection(openNotebookConfig);
      setOpenNotebookFeedback({
        tone: 'success',
        message: `Open Notebook 可访问：${result.reachableUrl}`,
      });
    } catch (error) {
      setOpenNotebookFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Open Notebook 连接失败',
      });
    } finally {
      setIsTestingOpenNotebook(false);
    }
  };

  return (
    <div className="panel-section-list knowledge-panel">
      <section className="panel-section">
        <div className="panel-section-header">
          <h2>个人知识库</h2>
        </div>
      </section>

      <section className="panel-section knowledge-service-card">
        <div className="knowledge-service-header">
          <div className="knowledge-service-title">
            <Database size={16} />
            <strong>RAGFlow</strong>
          </div>
        </div>

        <div className="knowledge-form">
          <label className="knowledge-field">
            <span>服务地址</span>
            <input
              className="knowledge-input"
              type="text"
              value={ragflowConfig.baseUrl}
              onChange={(event) => setRagflowConfigPatch({ baseUrl: event.target.value })}
              placeholder="http://127.0.0.1:9380"
            />
          </label>

          <label className="knowledge-field">
            <span>API Key</span>
            <input
              className="knowledge-input"
              type="password"
              value={ragflowConfig.apiKey}
              onChange={(event) => setRagflowConfigPatch({ apiKey: event.target.value })}
              placeholder="请输入 RAGFlow API Key"
            />
          </label>

          <label className="knowledge-field knowledge-field-compact">
            <span>片段数</span>
            <input
              className="knowledge-input"
              type="number"
              min={1}
              max={20}
              value={ragflowConfig.topK}
              onChange={(event) =>
                setRagflowConfigPatch({
                  topK: Number(event.target.value),
                })
              }
            />
          </label>

          <label className="knowledge-checkbox-row">
            <input
              type="checkbox"
              checked={useRagflowKnowledgeForGenerate}
              onChange={(event) => setUseRagflowKnowledgeForGenerate(event.target.checked)}
            />
            <span>生成时带入 RAGFlow</span>
          </label>
        </div>

        <div className="knowledge-actions">
          <button
            type="button"
            className="knowledge-button"
            onClick={() => void handleTestRagflow()}
            disabled={isTestingRagflow || isLoadingDatasets}
          >
            {isTestingRagflow ? '测试中...' : '测试连接'}
          </button>
          <button
            type="button"
            className="knowledge-button knowledge-button-primary"
            onClick={() => void handleLoadDatasets()}
            disabled={isLoadingDatasets || isTestingRagflow}
          >
            {isLoadingDatasets ? '读取中...' : '数据集'}
          </button>
        </div>

        {renderFeedback(ragflowFeedback)}

        <div className="knowledge-dataset-header">
          <strong>已选数据集</strong>
          <span>{selectedDatasetCount} 个</span>
        </div>

        {ragflowDatasets.length > 0 ? (
          <>
            <div className="knowledge-dataset-toolbar">
              <button
                type="button"
                className="knowledge-link-button"
                onClick={() => setSelectedRagflowDatasetIds(ragflowDatasets.map((dataset) => dataset.id))}
              >
                全选
              </button>
              <button
                type="button"
                className="knowledge-link-button"
                onClick={() => setSelectedRagflowDatasetIds([])}
              >
                清空
              </button>
            </div>
            <div className="knowledge-dataset-list" aria-label="RAGFlow 数据集列表">
              {ragflowDatasets.map((dataset) => {
                const checked = selectedRagflowDatasetIds.includes(dataset.id);
                return (
                  <label
                    key={dataset.id}
                    className={checked ? 'knowledge-dataset-item active' : 'knowledge-dataset-item'}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelectedRagflowDataset(dataset.id)}
                    />
                    <div className="knowledge-dataset-main">
                      <strong>{dataset.name}</strong>
                      <span>{dataset.description?.trim() || '暂无描述'}</span>
                      <small>
                        {dataset.chunkMethod ? `分块：${dataset.chunkMethod}` : '分块方式未提供'}
                        {typeof dataset.documentCount === 'number' ? ` · 文档 ${dataset.documentCount} 份` : ''}
                      </small>
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        ) : (
          <div className="empty-panel-state">
            <p>先读取数据集。</p>
          </div>
        )}

        <div className="knowledge-test-box">
          <label className="knowledge-field">
            <span>检索词</span>
            <input
              className="knowledge-input"
              type="text"
              value={retrievalQuery}
              onChange={(event) => setRetrievalQuery(event.target.value)}
              placeholder="例如：七年级数学 有理数 知识清单"
            />
          </label>
          <button
            type="button"
            className="knowledge-button"
            onClick={() => void handleTestRetrieval()}
            disabled={isTestingRetrieval}
          >
            {isTestingRetrieval ? '检索中...' : '检索测试'}
          </button>

          {renderFeedback(retrievalFeedback)}

          {retrievalResults.length > 0 ? (
            <div className="knowledge-result-list" aria-label="检索结果">
              {retrievalResults.map((chunk) => (
                <article key={chunk.id} className="knowledge-result-card">
                  <strong>{datasetNameMap.get(chunk.datasetId) || chunk.datasetId}</strong>
                  <span>{chunk.documentName?.trim() || chunk.documentId}</span>
                  <p>{buildChunkPreview(chunk)}</p>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel-section knowledge-service-card">
        <div className="knowledge-service-header">
          <div className="knowledge-service-title">
            <BookOpenText size={16} />
            <strong>Open Notebook</strong>
          </div>
        </div>

        <div className="knowledge-form">
          <label className="knowledge-field">
            <span>Web 地址</span>
            <input
              className="knowledge-input"
              type="text"
              value={openNotebookConfig.uiUrl}
              onChange={(event) => setOpenNotebookConfigPatch({ uiUrl: event.target.value })}
              placeholder="http://127.0.0.1:8502"
            />
          </label>

          <label className="knowledge-field">
            <span>API 地址</span>
            <input
              className="knowledge-input"
              type="text"
              value={openNotebookConfig.apiUrl}
              onChange={(event) => setOpenNotebookConfigPatch({ apiUrl: event.target.value })}
              placeholder="http://127.0.0.1:5055"
            />
          </label>
        </div>

        <div className="knowledge-actions">
          <button
            type="button"
            className="knowledge-button"
            onClick={() => void handleTestOpenNotebook()}
            disabled={isTestingOpenNotebook}
          >
            {isTestingOpenNotebook ? '测试中...' : '测试服务'}
          </button>
          <a
            className="knowledge-link-anchor"
            href={openNotebookConfig.uiUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Link2 size={14} />
            <span>打开</span>
          </a>
        </div>

        {renderFeedback(openNotebookFeedback)}
      </section>
    </div>
  );
}
