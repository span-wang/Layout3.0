import { AppShell } from '@/components/layout/AppShell';
import { KnowledgeIngestionWorkspace } from '@/components/knowledge-ingestion/KnowledgeIngestionWorkspace';
import { useAppStore } from '@/store';

export function App(): JSX.Element {
  const activeLeftPanelTab = useAppStore((state) => state.activeLeftPanelTab);
  const setActiveLeftPanelTab = useAppStore((state) => state.setActiveLeftPanelTab);
  if (activeLeftPanelTab === '资料入库') {
    return <KnowledgeIngestionWorkspace onClose={() => setActiveLeftPanelTab('文件')} />;
  }
  return <AppShell />;
}
