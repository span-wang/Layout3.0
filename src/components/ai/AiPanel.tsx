/**
 * AI 面板主容器
 * 管理生成、优化、检查、设置四个 Tab
 */

import { useAppStore } from '@/store';
import type { AiPanelTab } from '@/types/ai';
import { AiGenerateTab } from './AiGenerateTab';
import { AiOptimizeTab } from './AiOptimizeTab';
import { AiCheckTab } from './AiCheckTab';
import { AiPaginationTab } from './AiPaginationTab';
import { AiSettings } from './AiSettings';

const TAB_LABELS: Record<AiPanelTab, string> = {
  generate: '生成',
  optimize: '优化',
  check: '检查',
  pagination: '分页',
  settings: '设置',
};

export function AiPanel(): JSX.Element {
  const activeAiTab = useAppStore((state) => state.activeAiTab);
  const setActiveAiTab = useAppStore((state) => state.setActiveAiTab);

  const tabs: AiPanelTab[] = ['generate', 'optimize', 'check', 'pagination', 'settings'];

  return (
    <div className="ai-panel">
      <div className="ai-panel-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            className={`ai-tab-button ${activeAiTab === tab ? 'active' : ''}`}
            onClick={() => setActiveAiTab(tab)}
            aria-selected={activeAiTab === tab}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="ai-panel-content" role="tabpanel">
        {activeAiTab === 'generate' && <AiGenerateTab />}
        {activeAiTab === 'optimize' && <AiOptimizeTab />}
        {activeAiTab === 'check' && <AiCheckTab />}
        {activeAiTab === 'pagination' && <AiPaginationTab />}
        {activeAiTab === 'settings' && <AiSettings />}
      </div>
    </div>
  );
}
