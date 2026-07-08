import type { KnowledgeSourceReference } from '@/types/knowledge';

function truncatePreview(content: string): string | undefined {
  const normalized = content.replace(/\r/g, '').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 180)}...`;
}

function parseSourceLabel(sourceLabel: string): { location?: string; title: string } {
  const separatorIndex = sourceLabel.lastIndexOf(' / ');
  if (separatorIndex < 0) {
    return { title: sourceLabel.trim() };
  }

  return {
    location: sourceLabel.slice(0, separatorIndex).trim() || undefined,
    title: sourceLabel.slice(separatorIndex + 3).trim(),
  };
}

/**
 * 第二轮来源标注尽量复用已经生成好的知识库上下文文本，避免继续扩大到检索主链路。
 */
export function parseKnowledgeSourcesFromContext(params: {
  sourceType: KnowledgeSourceReference['sourceType'];
  context: string;
}): KnowledgeSourceReference[] {
  const normalizedContext = params.context.replace(/\r/g, '').trim();
  if (!normalizedContext) {
    return [];
  }

  const blockPattern = /(?:^|\n\n)(### 资料片段 \d+\n[\s\S]*?)(?=\n\n### 资料片段 \d+\n|$)/g;
  const sourceMap = new Map<string, KnowledgeSourceReference>();

  for (const match of normalizedContext.matchAll(blockPattern)) {
    const blockText = match[1]?.trim();
    if (!blockText) {
      continue;
    }

    const lines = blockText.split('\n');
    const sourceLine = lines.find((line) => line.startsWith('来源：'));
    if (!sourceLine) {
      continue;
    }

    const sourceLabel = sourceLine.replace(/^来源：/, '').trim();
    if (!sourceLabel) {
      continue;
    }

    const { location, title } = parseSourceLabel(sourceLabel);
    const detailLine = lines.find(
      (line) => line.startsWith('命中说明：') || line.startsWith('命中类型：') || line.startsWith('关键词：'),
    );
    const contentIndex = lines.findIndex((line) => line === '内容：');
    const preview = contentIndex >= 0 ? truncatePreview(lines.slice(contentIndex + 1).join('\n')) : undefined;
    const detail = detailLine?.replace(/^[^：]+：/, '').trim() || undefined;
    const sourceKey = `${params.sourceType}:${sourceLabel}`;

    if (!sourceMap.has(sourceKey)) {
      sourceMap.set(sourceKey, {
        id: sourceKey,
        sourceType: params.sourceType,
        title,
        location,
        detail,
        preview,
      });
    }
  }

  return Array.from(sourceMap.values());
}
