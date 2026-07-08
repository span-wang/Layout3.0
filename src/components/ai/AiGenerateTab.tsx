/**
 * AI 生成 Tab
 * 支持生成讲义、知识点总结、练习题、试卷初稿和小红书内容
 */

import { useRef, useState } from 'react';
import { useAppStore } from '@/store';
import { aiService } from '@/services/AiService';
import { addAiGenerationRecord } from '@/services/AiGenerationRecordService';
import { knowledgeBaseService } from '@/services/KnowledgeBaseService';
import { layoutDocumentToMarkdown } from '@/services/layoutDocumentMarkdown';
import type { GenerateOptions, GenerateType } from '@/types/ai';
import { GENERATE_TYPE_LABELS, LENGTH_LABELS } from '@/types/ai';

function isXiaohongshuGenerateType(type: GenerateType): boolean {
  return type === 'xiaohongshuTitle' || type === 'xiaohongshuCopy' || type === 'xiaohongshuCover';
}

function getFirstUsefulLine(content: string): string {
  const categoryNames = ['痛点型', '共鸣型', '反常识型', '对比型', '氛围感型', '合集清单型', '优先推荐', '推荐理由'];
  const line = content
    .split(/\r?\n/)
    .map((item) => item.replace(/^#+\s*/, '').replace(/^[-*\d.、\s]+/, '').replace(/^["“”]+|["“”]+$/g, '').trim())
    .find((item) => {
      if (!item) {
        return false;
      }

      // 小红书标题推荐会按类型分组，自动带入时跳过分组名，只取真正的标题候选。
      return !categoryNames.some((name) => item.startsWith(name));
    });

  return line ?? '';
}

function buildKnowledgeRetrievalQuery(options: {
  generateType: GenerateType;
  topic: string;
  grade: string;
  subject: string;
  requirementDescription: string;
}): string {
  // 按生成任务补一组检索意图词，避免只搜主题名时把 RAGFlow 召回范围卡得过窄。
  const generateHint =
    options.generateType === 'lecture'
      ? '课堂讲义 核心概念 例题 易错点'
      : options.generateType === 'summary'
        ? '知识清单 知识点梳理 定义 公式 易错点'
        : options.generateType === 'exercise'
          ? '同步练习 题型 变式训练 答案解析'
          : options.generateType === 'exam'
            ? '单元试卷 考点 题型 难度 答案解析'
            : GENERATE_TYPE_LABELS[options.generateType];

  return [
    options.subject.trim(),
    options.grade.trim(),
    options.topic.trim(),
    options.requirementDescription.trim(),
    GENERATE_TYPE_LABELS[options.generateType],
    generateHint,
  ]
    .filter(Boolean)
    .join(' ');
}

export function AiGenerateTab(): JSX.Element {
  const isGenerating = useAppStore((state) => state.isGenerating);
  const generatedContent = useAppStore((state) => state.generatedContent);
  const generateError = useAppStore((state) => state.generateError);
  const startGenerating = useAppStore((state) => state.startGenerating);
  const updateGeneratedContent = useAppStore((state) => state.updateGeneratedContent);
  const setGenerateError = useAppStore((state) => state.setGenerateError);
  const finishGenerating = useAppStore((state) => state.finishGenerating);
  const clearGeneratedContent = useAppStore((state) => state.clearGeneratedContent);
  const insertLayoutMarkdownBlocks = useAppStore((state) => state.insertLayoutMarkdownBlocks);
  const workspaceRootPath = useAppStore((state) => state.workspaceRootPath);
  const currentDirectoryPath = useAppStore((state) => state.currentDirectoryPath);
  const setAiGenerationRecordDirectory = useAppStore((state) => state.setAiGenerationRecordDirectory);
  const setAiGenerationRecordsError = useAppStore((state) => state.setAiGenerationRecordsError);
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const ragflowConfig = useAppStore((state) => state.ragflowConfig);
  const imaConfig = useAppStore((state) => state.imaConfig);
  const ragflowDatasets = useAppStore((state) => state.ragflowDatasets);
  const imaKnowledgeBases = useAppStore((state) => state.imaKnowledgeBases);
  const selectedRagflowDatasetIds = useAppStore((state) => state.selectedRagflowDatasetIds);
  const selectedImaKnowledgeBaseId = useAppStore((state) => state.selectedImaKnowledgeBaseId);
  const knowledgeSourceForGenerate = useAppStore((state) => state.knowledgeSourceForGenerate);

  const [generateType, setGenerateType] = useState<GenerateType>('lecture');
  const [topic, setTopic] = useState('');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [requirementDescription, setRequirementDescription] = useState('');
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [selectedXiaohongshuTitle, setSelectedXiaohongshuTitle] = useState('');
  const [selectedXiaohongshuCopy, setSelectedXiaohongshuCopy] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleGenerate = async () => {
    const config = useAppStore.getState().getAiConfigForTask('generate');
    if (!config) {
      setGenerateError('请先在「设置」中为「内容生成」分配可用 AI 配置');
      return;
    }

    const isXiaohongshuMode = isXiaohongshuGenerateType(generateType);
    const articleTitle = layoutDocument?.title?.trim() || '';
    const articleContent = layoutDocument ? layoutDocumentToMarkdown(layoutDocument) : '';
    const normalizedTopic = topic.trim() || articleTitle || selectedXiaohongshuTitle.trim();
    const shouldUseKnowledgeContext = !isXiaohongshuMode && knowledgeSourceForGenerate !== 'none';

    if (!normalizedTopic && !articleContent.trim()) {
      setGenerateError('请输入主题');
      return;
    }

    if ((generateType === 'xiaohongshuCopy' || generateType === 'xiaohongshuCover') && !selectedXiaohongshuTitle.trim()) {
      setGenerateError('请先填写已选小红书标题');
      return;
    }

    if (generateType === 'xiaohongshuCover' && !selectedXiaohongshuCopy.trim()) {
      setGenerateError('请先填写小红书文案，主图方案需要结合文案生成');
      return;
    }

    try {
      // 每次生成前按任务分配加载配置，避免多个 AI 功能互相抢同一套配置。
      aiService.configure(config);

      startGenerating();
      setAiGenerationRecordsError(null);
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      let knowledgeContext: string | undefined;
      if (shouldUseKnowledgeContext) {
        const knowledgeQuery = buildKnowledgeRetrievalQuery({
          generateType,
          topic: normalizedTopic,
          grade,
          subject,
          requirementDescription,
        });

        let retrievalResult: { context: string };
        if (knowledgeSourceForGenerate === 'ragflow') {
          if (selectedRagflowDatasetIds.length === 0) {
            setGenerateError('请先在「个人知识库」里至少选择一个 RAGFlow 数据集');
            finishGenerating();
            return;
          }

          const datasetNameMap = new Map(ragflowDatasets.map((dataset) => [dataset.id, dataset.name]));
          // 先从知识库拿到与主题最相关的资料片段，再交给 AI 生成完整教辅内容。
          retrievalResult = await knowledgeBaseService.buildRagflowKnowledgeContext({
            config: ragflowConfig,
            datasetIds: selectedRagflowDatasetIds,
            query: knowledgeQuery,
            datasetNameMap,
            signal: abortController.signal,
          });
        } else {
          const selectedImaKnowledgeBase = imaKnowledgeBases.find(
            (knowledgeBase) => knowledgeBase.id === selectedImaKnowledgeBaseId,
          );
          if (!selectedImaKnowledgeBase) {
            setGenerateError('请先在「个人知识库」里选择一个 ima 知识库');
            finishGenerating();
            return;
          }

          retrievalResult = await knowledgeBaseService.buildImaKnowledgeContext({
            config: imaConfig,
            knowledgeBaseId: selectedImaKnowledgeBase.id,
            knowledgeBaseName: selectedImaKnowledgeBase.name,
            query: knowledgeQuery,
            signal: abortController.signal,
          });
        }

        if (!retrievalResult.context.trim()) {
          setGenerateError('当前主题没有检索到可用知识片段，请先在「个人知识库」里调整知识源或检索词');
          finishGenerating();
          return;
        }

        knowledgeContext = retrievalResult.context;
      }

      const options: GenerateOptions = {
        type: generateType,
        topic: normalizedTopic,
        grade: isXiaohongshuMode ? undefined : grade.trim() || undefined,
        subject: isXiaohongshuMode ? undefined : subject.trim() || undefined,
        requirementDescription: isXiaohongshuMode ? undefined : requirementDescription.trim() || undefined,
        length: isXiaohongshuMode ? undefined : length,
        articleTitle: isXiaohongshuMode ? articleTitle || normalizedTopic : undefined,
        articleContent: isXiaohongshuMode ? articleContent : undefined,
        selectedTitle: isXiaohongshuMode ? selectedXiaohongshuTitle.trim() || undefined : undefined,
        selectedCopy: isXiaohongshuMode ? selectedXiaohongshuCopy.trim() || undefined : undefined,
        knowledgeContext,
      };

      const finalContent = await aiService.generate(options, (content) => {
        updateGeneratedContent(content);
      }, abortController.signal);

      if (finalContent.trim()) {
        try {
          // 生成完成后把结果写入用户工作区文件夹，前端只刷新展示列表。
          const recordDirectory = await addAiGenerationRecord({
            workspaceRootPath: workspaceRootPath ?? currentDirectoryPath,
            record: {
              type: options.type,
              typeLabel: GENERATE_TYPE_LABELS[options.type],
              topic: options.topic,
              grade: options.grade,
              subject: options.subject,
              requirementDescription: options.requirementDescription,
              length: options.length,
              lengthLabel: options.length ? LENGTH_LABELS[options.length] : undefined,
              provider: config?.provider,
              model: config?.model,
              content: finalContent,
            },
          });
          setAiGenerationRecordDirectory(recordDirectory);
        } catch (recordError) {
          setAiGenerationRecordsError(
            recordError instanceof Error ? recordError.message : 'AI 生成记录保存失败',
          );
        }
      }

      finishGenerating();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setGenerateError('生成已取消');
      } else if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
        setGenerateError('网络错误：主进程无法连接到 AI 服务。\n\n请检查 Base URL、API Key、模型名称和本机网络连接。');
      } else {
        setGenerateError(error instanceof Error ? error.message : '生成失败');
      }
      finishGenerating();
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleStopGenerate = () => {
    abortControllerRef.current?.abort();
  };

  const handleInsertToDocument = async () => {
    if (!generatedContent.trim()) return;

    try {
      const insertedBlockId = await insertLayoutMarkdownBlocks({ markdown: generatedContent });
      if (!insertedBlockId) {
        setGenerateError('插入失败：AI 内容没有解析出可插入的文档结构');
        return;
      }

      clearGeneratedContent();
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : '插入失败：无法解析 AI 生成内容');
    }
  };

  const handleClear = () => {
    clearGeneratedContent();
  };

  const handleFillTitleFromResult = () => {
    const title = getFirstUsefulLine(generatedContent);
    if (title) {
      setSelectedXiaohongshuTitle(title);
    }
  };

  const handleFillCopyFromResult = () => {
    if (generatedContent.trim()) {
      setSelectedXiaohongshuCopy(generatedContent.trim());
    }
  };

  const isXiaohongshuMode = isXiaohongshuGenerateType(generateType);
  const currentArticleTitle = layoutDocument?.title?.trim() || '当前文档暂无标题';
  const currentArticleContent = layoutDocument ? layoutDocumentToMarkdown(layoutDocument) : '';
  const currentArticleSummary = currentArticleContent.trim()
    ? `已读取当前文档内容，约 ${currentArticleContent.trim().length} 字。`
    : '当前文档内容为空，将主要根据你填写的选题生成。';
  const selectedKnowledgeDatasetCount = selectedRagflowDatasetIds.length;
  const selectedImaKnowledgeBase = imaKnowledgeBases.find((knowledgeBase) => knowledgeBase.id === selectedImaKnowledgeBaseId) ?? null;
  const knowledgeSourceLabel =
    knowledgeSourceForGenerate === 'ragflow'
      ? 'RAGFlow'
      : knowledgeSourceForGenerate === 'ima'
        ? 'ima'
        : '未启用';
  const knowledgeSourceSummary =
    knowledgeSourceForGenerate === 'ragflow'
      ? `已选 ${selectedKnowledgeDatasetCount} 个数据集`
      : knowledgeSourceForGenerate === 'ima'
        ? selectedImaKnowledgeBase?.name || '请先在左侧个人知识库选择一个 ima 知识库'
        : '可在左侧个人知识库开启';

  return (
    <div className="ai-generate-tab">
      <div className="ai-section">
        <h3 className="ai-section-title">快速生成</h3>
        <div className="ai-quick-cards">
          {(Object.keys(GENERATE_TYPE_LABELS) as GenerateType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={`ai-quick-card ${generateType === type ? 'active' : ''}`}
              onClick={() => setGenerateType(type)}
            >
              {GENERATE_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      <div className="ai-section">
        <h3 className="ai-section-title">生成设置</h3>
        <div className="ai-form">
          <div className="ai-form-group">
            <label htmlFor="ai-topic">{isXiaohongshuMode ? '选题 / 补充要求' : '主题'}</label>
            <input
              id="ai-topic"
              type="text"
              className="ai-input"
              placeholder={isXiaohongshuMode ? '例如：适合新手的排版技巧' : '例如：高中数学函数章节'}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={isGenerating}
            />
          </div>

          {isXiaohongshuMode ? (
            <>
              <div className="ai-form-group">
                <label>当前文章</label>
                <div className="ai-context-box">
                  <strong>{currentArticleTitle}</strong>
                  <span>{currentArticleSummary}</span>
                </div>
              </div>

              {(generateType === 'xiaohongshuCopy' || generateType === 'xiaohongshuCover') && (
                <div className="ai-form-group">
                  <label htmlFor="ai-xiaohongshu-title">已选小红书标题</label>
                  <input
                    id="ai-xiaohongshu-title"
                    type="text"
                    className="ai-input"
                    placeholder="从标题推荐结果里选一个标题填到这里"
                    value={selectedXiaohongshuTitle}
                    onChange={(e) => setSelectedXiaohongshuTitle(e.target.value)}
                    disabled={isGenerating}
                  />
                  {generatedContent && generateType === 'xiaohongshuCopy' ? (
                    <button
                      type="button"
                      className="ai-button ai-button-small"
                      onClick={handleFillTitleFromResult}
                      disabled={isGenerating}
                    >
                      从当前结果带入标题
                    </button>
                  ) : null}
                </div>
              )}

              {generateType === 'xiaohongshuCover' && (
                <div className="ai-form-group">
                  <label htmlFor="ai-xiaohongshu-copy">小红书文案</label>
                  <textarea
                    id="ai-xiaohongshu-copy"
                    className="ai-textarea"
                    placeholder="填写或粘贴已生成的小红书文案"
                    value={selectedXiaohongshuCopy}
                    onChange={(e) => setSelectedXiaohongshuCopy(e.target.value)}
                    disabled={isGenerating}
                    rows={5}
                  />
                  {generatedContent ? (
                    <button
                      type="button"
                      className="ai-button ai-button-small"
                      onClick={handleFillCopyFromResult}
                      disabled={isGenerating}
                    >
                      用当前结果作为文案
                    </button>
                  ) : null}
                </div>
              )}

              <p className="ai-hint">
                主图 V1 会生成设计方案和图片生成提示词，不会直接生成图片文件。
              </p>
            </>
          ) : (
            <>
              <div className="ai-form-row">
                <div className="ai-form-group">
                  <label htmlFor="ai-grade">年级（可选）</label>
                  <input
                    id="ai-grade"
                    type="text"
                    className="ai-input"
                    placeholder="例如：高一"
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                    disabled={isGenerating}
                  />
                </div>

                <div className="ai-form-group">
                  <label htmlFor="ai-subject">科目（可选）</label>
                  <input
                    id="ai-subject"
                    type="text"
                    className="ai-input"
                    placeholder="例如：数学"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    disabled={isGenerating}
                  />
                </div>
              </div>

              <div className="ai-form-group">
                <label htmlFor="ai-requirement-description">要求描述（可选）</label>
                <textarea
                  id="ai-requirement-description"
                  className="ai-textarea"
                  placeholder="例如：适合期中复习，内容要带例题，语气更简洁"
                  value={requirementDescription}
                  onChange={(e) => setRequirementDescription(e.target.value)}
                  disabled={isGenerating}
                  rows={3}
                />
              </div>

              <div className="ai-form-group">
                <label htmlFor="ai-length">内容长度</label>
                <select
                  id="ai-length"
                  className="ai-select"
                  value={length}
                  onChange={(e) => setLength(e.target.value as 'short' | 'medium' | 'long')}
                  disabled={isGenerating}
                >
                  {(Object.keys(LENGTH_LABELS) as Array<'short' | 'medium' | 'long'>).map((len) => (
                    <option key={len} value={len}>
                      {LENGTH_LABELS[len]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ai-form-group">
                <label>个人知识库</label>
                <div className="ai-context-box">
                  <strong>{knowledgeSourceLabel}</strong>
                  <span>{knowledgeSourceSummary}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {generateError && (
        <div className="ai-error">
          <span>{generateError}</span>
        </div>
      )}

      <div className="ai-section">
        {isGenerating ? (
          <button type="button" className="ai-button ai-button-stop" onClick={handleStopGenerate}>
            停止生成
          </button>
        ) : (
          <button type="button" className="ai-button ai-button-primary" onClick={handleGenerate}>
            开始生成
          </button>
        )}
      </div>

      {generatedContent && (
        <div className="ai-section ai-result-section">
          <h3 className="ai-section-title">生成结果</h3>
          <div className="ai-result">
            <pre className="ai-result-content">{generatedContent}</pre>
          </div>
          <div className="ai-result-actions">
            <button type="button" className="ai-button ai-button-primary" onClick={handleInsertToDocument}>
              插入当前文档
            </button>
            <button type="button" className="ai-button" onClick={handleClear}>
              清空
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
