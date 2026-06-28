/**
 * AI 生成 Tab
 * 支持生成讲义、知识点总结、练习题、试卷初稿
 */

import { useRef, useState } from 'react';
import { useAppStore } from '@/store';
import { aiService } from '@/services/AiService';
import { addAiGenerationRecord } from '@/services/AiGenerationRecordService';
import type { GenerateOptions, GenerateType } from '@/types/ai';
import { GENERATE_TYPE_LABELS, LENGTH_LABELS } from '@/types/ai';

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

  const [generateType, setGenerateType] = useState<GenerateType>('lecture');
  const [topic, setTopic] = useState('');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleGenerate = async () => {
    const config = useAppStore.getState().getAiConfigForTask('generate');
    if (!config) {
      setGenerateError('请先在「设置」中为「内容生成」分配可用 AI 配置');
      return;
    }

    if (!topic.trim()) {
      setGenerateError('请输入主题');
      return;
    }

    try {
      // 每次生成前按任务分配加载配置，避免多个 AI 功能互相抢同一套配置。
      aiService.configure(config);

      startGenerating();
      setAiGenerationRecordsError(null);

      const options: GenerateOptions = {
        type: generateType,
        topic: topic.trim(),
        grade: grade.trim() || undefined,
        subject: subject.trim() || undefined,
        length,
      };

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

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
              length: options.length,
              lengthLabel: LENGTH_LABELS[options.length || 'medium'],
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
            <label htmlFor="ai-topic">主题</label>
            <input
              id="ai-topic"
              type="text"
              className="ai-input"
              placeholder="例如：高中数学函数章节"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={isGenerating}
            />
          </div>

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
