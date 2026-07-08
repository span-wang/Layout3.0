import { useMemo, useState } from 'react';
import { BookOpenText, Database, Link2 } from 'lucide-react';
import { knowledgeBaseService } from '@/services/KnowledgeBaseService';
import { useAppStore } from '@/store';
import type { ImaKnowledgeChunk, ImaKnowledgeSearchHit, RagflowChunk, RagflowRetrievalResult } from '@/types/knowledge';

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

function buildChunkPreview(chunk: RagflowChunk | ImaKnowledgeChunk | ImaKnowledgeSearchHit): string {
  if ('highlight' in chunk && typeof chunk.highlight === 'string' && chunk.highlight.trim()) {
    return chunk.highlight;
  }

  const previewText = 'preview' in chunk ? chunk.preview : chunk.content;
  if (previewText.length <= 180) {
    return previewText;
  }

  return `${previewText.slice(0, 180)}...`;
}

function formatSimilarity(value: number | undefined): string | null {
  return typeof value === 'number' ? value.toFixed(3) : null;
}

export function KnowledgeBasePanel(): JSX.Element {
  const ragflowConfig = useAppStore((state) => state.ragflowConfig);
  const imaConfig = useAppStore((state) => state.imaConfig);
  const openNotebookConfig = useAppStore((state) => state.openNotebookConfig);
  const ragflowDatasets = useAppStore((state) => state.ragflowDatasets);
  const imaKnowledgeBases = useAppStore((state) => state.imaKnowledgeBases);
  const selectedRagflowDatasetIds = useAppStore((state) => state.selectedRagflowDatasetIds);
  const selectedImaKnowledgeBaseId = useAppStore((state) => state.selectedImaKnowledgeBaseId);
  const knowledgeSourceForGenerate = useAppStore((state) => state.knowledgeSourceForGenerate);
  const setRagflowConfigPatch = useAppStore((state) => state.setRagflowConfigPatch);
  const setImaConfigPatch = useAppStore((state) => state.setImaConfigPatch);
  const setOpenNotebookConfigPatch = useAppStore((state) => state.setOpenNotebookConfigPatch);
  const setRagflowDatasets = useAppStore((state) => state.setRagflowDatasets);
  const setImaKnowledgeBases = useAppStore((state) => state.setImaKnowledgeBases);
  const setSelectedRagflowDatasetIds = useAppStore((state) => state.setSelectedRagflowDatasetIds);
  const setSelectedImaKnowledgeBaseId = useAppStore((state) => state.setSelectedImaKnowledgeBaseId);
  const toggleSelectedRagflowDataset = useAppStore((state) => state.toggleSelectedRagflowDataset);
  const setKnowledgeSourceForGenerate = useAppStore((state) => state.setKnowledgeSourceForGenerate);

  const [isTestingRagflow, setIsTestingRagflow] = useState(false);
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(false);
  const [isTestingRetrieval, setIsTestingRetrieval] = useState(false);
  const [isTestingIma, setIsTestingIma] = useState(false);
  const [isLoadingImaKnowledgeBases, setIsLoadingImaKnowledgeBases] = useState(false);
  const [isTestingImaRetrieval, setIsTestingImaRetrieval] = useState(false);
  const [isTestingOpenNotebook, setIsTestingOpenNotebook] = useState(false);
  const [ragflowFeedback, setRagflowFeedback] = useState<FeedbackState | null>(null);
  const [imaFeedback, setImaFeedback] = useState<FeedbackState | null>(null);
  const [openNotebookFeedback, setOpenNotebookFeedback] = useState<FeedbackState | null>(null);
  const [retrievalFeedback, setRetrievalFeedback] = useState<FeedbackState | null>(null);
  const [imaRetrievalFeedback, setImaRetrievalFeedback] = useState<FeedbackState | null>(null);
  const [retrievalQuery, setRetrievalQuery] = useState('');
  const [imaRetrievalQuery, setImaRetrievalQuery] = useState('');
  const [retrievalResult, setRetrievalResult] = useState<RagflowRetrievalResult | null>(null);
  const [imaRetrievalResults, setImaRetrievalResults] = useState<ImaKnowledgeSearchHit[]>([]);

  const datasetNameMap = useMemo(
    () => new Map(ragflowDatasets.map((dataset) => [dataset.id, dataset.name])),
    [ragflowDatasets],
  );
  const selectedImaKnowledgeBase = useMemo(
    () => imaKnowledgeBases.find((knowledgeBase) => knowledgeBase.id === selectedImaKnowledgeBaseId) ?? null,
    [imaKnowledgeBases, selectedImaKnowledgeBaseId],
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
    setRetrievalResult(null);

    try {
      const result = await knowledgeBaseService.retrieveRagflowChunks({
        config: ragflowConfig,
        datasetIds: selectedRagflowDatasetIds,
        query: retrievalQuery,
      });
      setRetrievalResult(result);
      const documentCount = result.documentAggregates.length;
      setRetrievalFeedback({
        tone: 'success',
        message:
          result.chunks.length > 0
            ? documentCount > 0
              ? `已检索到 ${result.chunks.length} 条知识片段，涉及 ${documentCount} 篇文档。`
              : `已检索到 ${result.chunks.length} 条知识片段。`
            : '没有检索到匹配片段。',
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

  const handleTestIma = async () => {
    setIsTestingIma(true);
    setImaFeedback(null);

    try {
      const result = await knowledgeBaseService.testImaConnection(imaConfig);
      setImaFeedback({
        tone: 'success',
        message: `ima 连接成功，当前可读取 ${result.knowledgeBaseCount} 个知识库。`,
      });
    } catch (error) {
      setImaFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'ima 连接失败',
      });
    } finally {
      setIsTestingIma(false);
    }
  };

  const handleLoadImaKnowledgeBases = async () => {
    setIsLoadingImaKnowledgeBases(true);
    setImaFeedback(null);

    try {
      const knowledgeBases = await knowledgeBaseService.listImaKnowledgeBases(imaConfig);
      setImaKnowledgeBases(knowledgeBases);
      setImaFeedback({
        tone: 'success',
        message: knowledgeBases.length > 0 ? `已读取 ${knowledgeBases.length} 个知识库。` : '当前没有可用知识库。',
      });
    } catch (error) {
      setImaFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '读取 ima 知识库失败',
      });
    } finally {
      setIsLoadingImaKnowledgeBases(false);
    }
  };

  const handleTestImaRetrieval = async () => {
    setIsTestingImaRetrieval(true);
    setImaRetrievalFeedback(null);
    setImaRetrievalResults([]);

    try {
      const results = await knowledgeBaseService.searchImaKnowledgeHits({
        config: imaConfig,
        knowledgeBaseId: selectedImaKnowledgeBaseId ?? '',
        query: imaRetrievalQuery,
      });
      setImaRetrievalResults(results);
      setImaRetrievalFeedback({
        tone: 'success',
        message: results.length > 0 ? `已命中 ${results.length} 条 ima 结果。` : '没有检索到匹配资料。',
      });
    } catch (error) {
      setImaRetrievalFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'ima 检索失败',
      });
    } finally {
      setIsTestingImaRetrieval(false);
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
            <strong>生成来源</strong>
          </div>
        </div>

        <div className="knowledge-form">
          <label className="knowledge-field knowledge-field-compact">
            <span>当前来源</span>
            <select
              className="knowledge-input"
              value={knowledgeSourceForGenerate}
              onChange={(event) => setKnowledgeSourceForGenerate(event.target.value as 'none' | 'ragflow' | 'ima')}
            >
              <option value="none">关闭</option>
              <option value="ragflow">RAGFlow</option>
              <option value="ima">ima</option>
            </select>
          </label>
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
              value={ragflowConfig.resultLimit}
              onChange={(event) =>
                setRagflowConfigPatch({
                  resultLimit: Number(event.target.value),
                })
              }
            />
          </label>

          <label className="knowledge-field knowledge-field-compact">
            <span>召回池</span>
            <input
              className="knowledge-input"
              type="number"
              min={1}
              max={200}
              value={ragflowConfig.recallTopK}
              onChange={(event) =>
                setRagflowConfigPatch({
                  recallTopK: Number(event.target.value),
                })
              }
            />
          </label>

          <label className="knowledge-field knowledge-field-compact">
            <span>阈值</span>
            <input
              className="knowledge-input"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={ragflowConfig.similarityThreshold}
              onChange={(event) =>
                setRagflowConfigPatch({
                  similarityThreshold: Number(event.target.value),
                })
              }
            />
          </label>

          <label className="knowledge-field knowledge-field-compact">
            <span>向量权重</span>
            <input
              className="knowledge-input"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={ragflowConfig.vectorSimilarityWeight}
              onChange={(event) =>
                setRagflowConfigPatch({
                  vectorSimilarityWeight: Number(event.target.value),
                })
              }
            />
          </label>

          <label className="knowledge-checkbox-row">
            <input
              type="checkbox"
              checked={ragflowConfig.enableKeyword}
              onChange={(event) => setRagflowConfigPatch({ enableKeyword: event.target.checked })}
            />
            <span>关键词混合</span>
          </label>

          <label className="knowledge-checkbox-row">
            <input
              type="checkbox"
              checked={ragflowConfig.enableHighlight}
              onChange={(event) => setRagflowConfigPatch({ enableHighlight: event.target.checked })}
            />
            <span>返回高亮</span>
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

          {retrievalResult && retrievalResult.chunks.length > 0 ? (
            <div className="knowledge-result-list" aria-label="检索结果">
              {retrievalResult.chunks.map((chunk) => {
                const similarity = formatSimilarity(chunk.similarity);
                const termSimilarity = formatSimilarity(chunk.termSimilarity);
                const vectorSimilarity = formatSimilarity(chunk.vectorSimilarity);
                const scoreParts = [
                  similarity ? `综合 ${similarity}` : '',
                  termSimilarity ? `关键词 ${termSimilarity}` : '',
                  vectorSimilarity ? `向量 ${vectorSimilarity}` : '',
                ].filter(Boolean);

                return (
                  <article key={chunk.id} className="knowledge-result-card">
                    <strong>{datasetNameMap.get(chunk.datasetId) || chunk.datasetId}</strong>
                    <span>{chunk.documentName?.trim() || chunk.documentId}</span>
                    {scoreParts.length > 0 ? <span>{scoreParts.join(' · ')}</span> : null}
                    <p>{buildChunkPreview(chunk)}</p>
                    {chunk.importantKeywords?.length ? (
                      <span>关键词：{chunk.importantKeywords.slice(0, 6).join('、')}</span>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel-section knowledge-service-card">
        <div className="knowledge-service-header">
          <div className="knowledge-service-title">
            <BookOpenText size={16} />
            <strong>ima</strong>
          </div>
        </div>

        <div className="knowledge-form">
          <label className="knowledge-field">
            <span>服务地址</span>
            <input
              className="knowledge-input"
              type="text"
              value={imaConfig.baseUrl}
              onChange={(event) => setImaConfigPatch({ baseUrl: event.target.value })}
              placeholder="https://ima.qq.com"
            />
          </label>

          <label className="knowledge-field">
            <span>Client ID</span>
            <input
              className="knowledge-input"
              type="text"
              value={imaConfig.clientId}
              onChange={(event) => setImaConfigPatch({ clientId: event.target.value })}
              placeholder="请输入 ima Client ID"
            />
          </label>

          <label className="knowledge-field">
            <span>API Key</span>
            <input
              className="knowledge-input"
              type="password"
              value={imaConfig.apiKey}
              onChange={(event) => setImaConfigPatch({ apiKey: event.target.value })}
              placeholder="请输入 ima API Key"
            />
          </label>

          <label className="knowledge-field knowledge-field-compact">
            <span>片段数</span>
            <input
              className="knowledge-input"
              type="number"
              min={1}
              max={20}
              value={imaConfig.topK}
              onChange={(event) =>
                setImaConfigPatch({
                  topK: Number(event.target.value),
                })
              }
            />
          </label>
        </div>

        <div className="knowledge-actions">
          <button
            type="button"
            className="knowledge-button"
            onClick={() => void handleTestIma()}
            disabled={isTestingIma || isLoadingImaKnowledgeBases}
          >
            {isTestingIma ? '测试中...' : '测试连接'}
          </button>
          <button
            type="button"
            className="knowledge-button knowledge-button-primary"
            onClick={() => void handleLoadImaKnowledgeBases()}
            disabled={isLoadingImaKnowledgeBases || isTestingIma}
          >
            {isLoadingImaKnowledgeBases ? '读取中...' : '知识库'}
          </button>
        </div>

        {renderFeedback(imaFeedback)}

        <div className="knowledge-dataset-header">
          <strong>已选知识库</strong>
          <span>{selectedImaKnowledgeBase ? '1 个' : '0 个'}</span>
        </div>

        {imaKnowledgeBases.length > 0 ? (
          <div className="knowledge-dataset-list" aria-label="ima 知识库列表">
            {imaKnowledgeBases.map((knowledgeBase) => {
              const checked = knowledgeBase.id === selectedImaKnowledgeBaseId;
              return (
                <label
                  key={knowledgeBase.id}
                  className={checked ? 'knowledge-dataset-item active' : 'knowledge-dataset-item'}
                >
                  <input
                    type="radio"
                    name="ima-knowledge-base"
                    checked={checked}
                    onChange={() => setSelectedImaKnowledgeBaseId(knowledgeBase.id)}
                  />
                  <div className="knowledge-dataset-main">
                    <strong>{knowledgeBase.name}</strong>
                    <span>{knowledgeBase.description?.trim() || '暂无描述'}</span>
                    <small>
                      {knowledgeBase.recommendedQuestions?.length
                        ? `推荐问题 ${knowledgeBase.recommendedQuestions.length} 条`
                        : '暂无推荐问题'}
                    </small>
                  </div>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="empty-panel-state">
            <p>先读取知识库。</p>
          </div>
        )}

        <div className="knowledge-test-box">
          <label className="knowledge-field">
            <span>检索词</span>
            <input
              className="knowledge-input"
              type="text"
              value={imaRetrievalQuery}
              onChange={(event) => setImaRetrievalQuery(event.target.value)}
              placeholder="例如：函数 极值 解题思路"
            />
          </label>
          <button
            type="button"
            className="knowledge-button"
            onClick={() => void handleTestImaRetrieval()}
            disabled={isTestingImaRetrieval}
          >
            {isTestingImaRetrieval ? '检索中...' : '检索测试'}
          </button>

          {renderFeedback(imaRetrievalFeedback)}

          {imaRetrievalResults.length > 0 ? (
            <div className="knowledge-result-list" aria-label="ima 检索结果">
              {imaRetrievalResults.map((chunk) => (
                <article key={chunk.key} className="knowledge-result-card">
                  <strong>{selectedImaKnowledgeBase?.name || '当前知识库'}</strong>
                  <span>{chunk.title}</span>
                  <p>{buildChunkPreview(chunk)}</p>
                  {chunk.kind === 'folder' ? <span>命中文件夹</span> : null}
                  {chunk.contentReadError ? <span>正文回退：{chunk.contentReadError}</span> : null}
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
