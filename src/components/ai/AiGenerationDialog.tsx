/**
 * AI 生成内容弹窗
 * 大纲审核与最终正文共用同一个宽屏阅读空间。
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { KnowledgeSourceReference } from '@/types/knowledge';
import { KnowledgeSourceList } from './KnowledgeSourceList';

export type AiGenerationDialogView = 'outline' | 'content';
export type AiGenerationStep = AiGenerationDialogView | null;

interface AiGenerationDialogProps {
  isOpen: boolean;
  view: AiGenerationDialogView;
  activeStep: AiGenerationStep;
  isGenerating: boolean;
  error: string | null;
  outlineDraft: string;
  generatedContent: string;
  knowledgeSources: KnowledgeSourceReference[];
  onOutlineChange: (value: string) => void;
  onClose: () => void;
  onStop: () => void;
  onRegenerateOutline: () => void;
  onGenerateContent: () => void;
  onInsertToDocument: () => void | Promise<void>;
  onClear: () => void;
}

export function AiGenerationDialog({
  isOpen,
  view,
  activeStep,
  isGenerating,
  error,
  outlineDraft,
  generatedContent,
  knowledgeSources,
  onOutlineChange,
  onClose,
  onStop,
  onRegenerateOutline,
  onGenerateContent,
  onInsertToDocument,
  onClear,
}: AiGenerationDialogProps): JSX.Element | null {
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousBodyOverflow = document.body.style.overflow;
    const frameId = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      previousActiveElement?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const isOutlineView = view === 'outline';
  const title = isOutlineView ? '大纲审核' : '生成结果';
  const statusLabel = isGenerating
    ? activeStep === 'outline'
      ? '正在生成大纲'
      : '正在生成正文'
    : isOutlineView
      ? '大纲可编辑'
      : '正文已生成';
  const stopLabel = activeStep === 'outline' ? '停止生成大纲' : '停止生成正文';

  return (
    <div className="ai-generation-dialog-backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="ai-generation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-generation-dialog-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ai-generation-dialog-header">
          <div className="ai-generation-dialog-title">
            <strong id="ai-generation-dialog-title">{title}</strong>
            <span>{statusLabel}</span>
          </div>
          <button
            type="button"
            className="ai-generation-dialog-close"
            aria-label="关闭生成内容弹窗"
            title="关闭"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <div
          className={
            isOutlineView
              ? 'ai-generation-dialog-body ai-generation-dialog-body-outline'
              : 'ai-generation-dialog-body ai-generation-dialog-body-content'
          }
        >
          {error ? <div className="ai-error ai-generation-dialog-error">{error}</div> : null}

          {isOutlineView ? (
            <textarea
              className="ai-generation-dialog-outline"
              value={outlineDraft}
              onChange={(event) => onOutlineChange(event.target.value)}
              disabled={isGenerating}
              aria-label="AI 生成大纲"
              placeholder={isGenerating ? '正在生成大纲，请稍候……' : '生成的大纲将在这里显示'}
            />
          ) : (
            <div className="ai-generation-dialog-result">
              {generatedContent ? (
                <pre className="ai-generation-dialog-result-content">{generatedContent}</pre>
              ) : (
                <div className="ai-generation-dialog-empty">
                  {isGenerating ? '正在生成正文，请稍候……' : '暂无生成内容'}
                </div>
              )}
              <KnowledgeSourceList sources={knowledgeSources} />
            </div>
          )}
        </div>

        <footer className="ai-generation-dialog-footer">
          <span className="ai-generation-dialog-status">{statusLabel}</span>
          <div className="ai-generation-dialog-actions">
            {isGenerating ? (
              <button type="button" className="ai-button ai-button-stop" onClick={onStop}>
                {stopLabel}
              </button>
            ) : isOutlineView ? (
              <>
                <button
                  type="button"
                  className="ai-button ai-button-primary"
                  onClick={onGenerateContent}
                  disabled={!outlineDraft.trim()}
                >
                  审核通过，生成正文
                </button>
                <button type="button" className="ai-button" onClick={onRegenerateOutline}>
                  重新生成大纲
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="ai-button ai-button-primary"
                  onClick={onInsertToDocument}
                  disabled={!generatedContent.trim()}
                >
                  插入当前文档
                </button>
                <button type="button" className="ai-button" onClick={onClear}>
                  清空
                </button>
              </>
            )}
            <button type="button" className="ai-button" onClick={onClose}>
              关闭
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
