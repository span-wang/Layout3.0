import type { KnowledgeSourceReference } from '@/types/knowledge';

interface KnowledgeSourceListProps {
  sources: KnowledgeSourceReference[];
  title?: string;
}

function getKnowledgeSourceTypeLabel(_sourceType: KnowledgeSourceReference['sourceType']): string {
  return 'RAGFlow';
}

export function KnowledgeSourceList({
  sources,
  title = '知识库来源',
}: KnowledgeSourceListProps): JSX.Element | null {
  if (sources.length === 0) {
    return null;
  }

  return (
    <section className="ai-knowledge-sources">
      <div className="ai-knowledge-sources-header">
        <strong>{title}</strong>
        <span>{sources.length} 条</span>
      </div>
      <div className="ai-knowledge-source-list">
        {sources.map((source) => (
          <article key={source.id} className="ai-knowledge-source-card">
            <div className="ai-knowledge-source-head">
              <strong title={source.title}>{source.title}</strong>
              <span>{getKnowledgeSourceTypeLabel(source.sourceType)}</span>
            </div>
            {source.location ? <p className="ai-knowledge-source-meta">{source.location}</p> : null}
            {source.detail ? <p className="ai-knowledge-source-meta">{source.detail}</p> : null}
            {source.preview ? <p className="ai-knowledge-source-preview">{source.preview}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
