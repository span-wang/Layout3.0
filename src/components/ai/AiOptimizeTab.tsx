/**
 * AI 优化 Tab
 * 支持润色、改写、总结、扩写、降低难度，提高正式度
 */

import { useState } from 'react';
import { useAppStore } from '@/store';
import { aiService } from '@/services/AiService';
import type { OptimizeOptions, OptimizeMode } from '@/types/ai';
import { OPTIMIZE_MODE_LABELS } from '@/types/ai';

export function AiOptimizeTab(): JSX.Element {
  const isOptimizing = useAppStore((state) => state.isOptimizing);
  const optimizedContent = useAppStore((state) => state.optimizedContent);
  const optimizeError = useAppStore((state) => state.optimizeError);
  const startOptimizing = useAppStore((state) => state.startOptimizing);
  const updateOptimizedContent = useAppStore((state) => state.updateOptimizedContent);
  const setOptimizeError = useAppStore((state) => state.setOptimizeError);
  const finishOptimizing = useAppStore((state) => state.finishOptimizing);
  const clearOptimizedContent = useAppStore((state) => state.clearOptimizedContent);
  const isAiConfigured = useAppStore((state) => state.isAiConfigured);

  const [selectedText, setSelectedText] = useState('');
  const [optimizeMode, setOptimizeMode] = useState<OptimizeMode>('polish');

  const handleOptimize = async () => {
    if (!isAiConfigured) {
      setOptimizeError('请先在「设置」中配置 AI 服务');
      return;
    }

    if (!selectedText.trim()) {
      setOptimizeError('请先选择要优化的文本');
      return;
    }

    try {
      const config = useAppStore.getState().aiConfig;
      if (config) {
        aiService.configure(config);
      }

      startOptimizing();

      const options: OptimizeOptions = {
        text: selectedText.trim(),
        mode: optimizeMode,
      };

      await aiService.optimize(options, (content) => {
        updateOptimizedContent(content);
      });

      finishOptimizing();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setOptimizeError('优化已取消');
      } else {
        setOptimizeError(error instanceof Error ? error.message : '优化失败');
      }
      finishOptimizing();
    }
  };

  const handleReplaceSelection = () => {
    if (!optimizedContent.trim()) return;
    // 将优化后的内容替换选中的文本
    console.log('替换选中文本:', optimizedContent);
  };

  const handleClear = () => {
    clearOptimizedContent();
  };

  return (
    <div className="ai-optimize-tab">
      <div className="ai-section">
        <h3 className="ai-section-title">优化方式</h3>
        <div className="ai-optimize-modes">
          {(Object.keys(OPTIMIZE_MODE_LABELS) as OptimizeMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`ai-optimize-mode-button ${optimizeMode === mode ? 'active' : ''}`}
              onClick={() => setOptimizeMode(mode)}
              disabled={isOptimizing}
            >
              {OPTIMIZE_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      <div className="ai-section">
        <h3 className="ai-section-title">原文</h3>
        <textarea
          className="ai-textarea"
          placeholder="请输入要优化的文本，或在编辑器中选中文本后点击「获取选中文本」..."
          value={selectedText}
          onChange={(e) => setSelectedText(e.target.value)}
          disabled={isOptimizing}
          rows={6}
        />
        <p className="ai-hint">提示：请在编辑器中选中要优化的文本，然后复制粘贴到此处</p>
      </div>

      {optimizeError && (
        <div className="ai-error">
          <span>{optimizeError}</span>
        </div>
      )}

      <div className="ai-section">
        {isOptimizing ? (
          <button type="button" className="ai-button ai-button-stop" onClick={() => finishOptimizing()}>
            停止优化
          </button>
        ) : (
          <button type="button" className="ai-button ai-button-primary" onClick={handleOptimize}>
            开始优化
          </button>
        )}
      </div>

      {optimizedContent && (
        <div className="ai-section ai-result-section">
          <h3 className="ai-section-title">优化结果</h3>
          <div className="ai-result">
            <pre className="ai-result-content">{optimizedContent}</pre>
          </div>
          <div className="ai-result-actions">
            <button type="button" className="ai-button ai-button-primary" onClick={handleReplaceSelection}>
              替换选中文本
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
