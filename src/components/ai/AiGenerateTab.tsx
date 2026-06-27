/**
 * AI 生成 Tab
 * 支持生成讲义、知识点总结、练习题、试卷初稿
 */

import { useState } from 'react';
import { useAppStore } from '@/store';
import { aiService } from '@/services/AiService';
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
  const setLayoutDocument = useAppStore((state) => state.setLayoutDocument);
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const isAiConfigured = useAppStore((state) => state.isAiConfigured);

  const [generateType, setGenerateType] = useState<GenerateType>('lecture');
  const [topic, setTopic] = useState('');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');

  const handleGenerate = async () => {
    if (!isAiConfigured) {
      setGenerateError('请先在「设置」中配置 AI 服务');
      return;
    }

    if (!topic.trim()) {
      setGenerateError('请输入主题');
      return;
    }

    try {
      // 配置 AI 服务
      const config = useAppStore.getState().aiConfig;
      if (config) {
        aiService.configure(config);
      }

      startGenerating();

      const options: GenerateOptions = {
        type: generateType,
        topic: topic.trim(),
        grade: grade.trim() || undefined,
        subject: subject.trim() || undefined,
        length,
      };

      await aiService.generate(options, (content) => {
        updateGeneratedContent(content);
      });

      finishGenerating();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setGenerateError('生成已取消');
      } else if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
        setGenerateError('网络错误：无法连接到 AI 服务。\n\n可能原因：\n1. CORS 跨域限制\n2. API 地址不可达\n3. 网络连接问题\n\n提示：对于 OpenAI API，可能需要配置代理或使用第三方转发服务。');
      } else {
        setGenerateError(error instanceof Error ? error.message : '生成失败');
      }
      finishGenerating();
    }
  };

  const handleInsertToDocument = () => {
    if (!layoutDocument || !generatedContent.trim()) return;

    // 将生成的内容追加到文档末尾作为新段落
    const newBlockId = `ai-gen-${Date.now()}`;

    // 创建新块，使用 any 避免复杂的类型问题
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newBlock: any = {
      id: newBlockId,
      type: 'paragraph',
      metadata: {},
      textRuns: [
        {
          text: generatedContent,
          marks: [],
          styleOverrides: {},
        },
      ],
    };

    setLayoutDocument({
      ...layoutDocument,
      blocks: [...layoutDocument.blocks, newBlock],
    });

    clearGeneratedContent();
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
          <button type="button" className="ai-button ai-button-stop" onClick={() => finishGenerating()}>
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
