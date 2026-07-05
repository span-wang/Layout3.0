import type { LayoutBlock, LayoutBlockSemantic, SemanticRole, SemanticRoleId } from './types';

export const BUILT_IN_SEMANTIC_ROLES: SemanticRole[] = [
  { id: 'title', name: '标题', category: 'general' },
  { id: 'section', name: '章节', category: 'general' },
  { id: 'question', name: '题干', category: 'exam' },
  { id: 'answer', name: '答案', category: 'exam' },
  { id: 'explanation', name: '解析', category: 'exam' },
  { id: 'key-point', name: '重点', category: 'note' },
  { id: 'pitfall', name: '易错', category: 'note' },
  { id: 'caption', name: '说明', category: 'reading' },
  { id: 'example', name: '例题', category: 'exam' },
  { id: 'step', name: '步骤', category: 'general' },
  { id: 'summary', name: '总结', category: 'general' },
  { id: 'warning', name: '注意', category: 'note' },
];

export const BUILT_IN_SEMANTIC_ROLE_ALIASES: Record<string, SemanticRoleId> = {
  标题: 'title',
  章节: 'section',
  节: 'section',
  题干: 'question',
  问题: 'question',
  答案: 'answer',
  标准答案: 'answer',
  参考答案: 'answer',
  解析: 'explanation',
  解答: 'explanation',
  重点: 'key-point',
  考点: 'key-point',
  易错: 'pitfall',
  易错点: 'pitfall',
  说明: 'caption',
  注释: 'caption',
  例题: 'example',
  示例: 'example',
  步骤: 'step',
  总结: 'summary',
  小结: 'summary',
  注意: 'warning',
  警示: 'warning',
};

const roleIds = new Set<string>(BUILT_IN_SEMANTIC_ROLES.map((role) => role.id));
const validSemanticSources = new Set<LayoutBlockSemantic['source']>(['manual', 'markdown-prefix', 'keyword', 'ai']);

function sanitizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function getSemanticRoleById(roleId: string | null | undefined): SemanticRole | null {
  const normalizedRoleId = sanitizeString(roleId);
  return BUILT_IN_SEMANTIC_ROLES.find((role) => role.id === normalizedRoleId) ?? null;
}

export function getSemanticRoleLabel(roleId: string | null | undefined): string {
  return getSemanticRoleById(roleId)?.name ?? roleId ?? '未设置';
}

export function resolveSemanticRoleAlias(alias: string | null | undefined): SemanticRoleId | null {
  const normalizedAlias = sanitizeString(alias);
  if (!normalizedAlias) {
    return null;
  }

  if (roleIds.has(normalizedAlias)) {
    return normalizedAlias as SemanticRoleId;
  }

  const lowerAlias = normalizedAlias.toLowerCase();
  const matchedEntry = Object.entries(BUILT_IN_SEMANTIC_ROLE_ALIASES).find(
    ([aliasKey]) => aliasKey.toLowerCase() === lowerAlias,
  );

  return matchedEntry?.[1] ?? null;
}

export function parseSemanticRolePrefix(text: string): {
  semantic: LayoutBlockSemantic;
  content: string;
  prefixLength: number;
} | null {
  const match = text.match(/^\s*role:([^\s]+)\s*(.*)$/su);
  if (!match?.[1]) {
    return null;
  }

  const alias = match[1].trim();
  const roleId = resolveSemanticRoleAlias(alias);
  if (!roleId) {
    return null;
  }

  return {
    semantic: {
      roleId,
      alias,
      source: 'markdown-prefix',
    },
    content: match[2] ?? '',
    prefixLength: text.length - (match[2] ?? '').length,
  };
}

export function normalizeLayoutBlockSemantic(value: unknown): LayoutBlockSemantic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const roleId = resolveSemanticRoleAlias(sanitizeString(record.roleId));
  if (!roleId) {
    return undefined;
  }

  const alias = sanitizeString(record.alias);
  const source = validSemanticSources.has(record.source as LayoutBlockSemantic['source'])
    ? (record.source as LayoutBlockSemantic['source'])
    : 'manual';
  const confidence =
    typeof record.confidence === 'number' && Number.isFinite(record.confidence)
      ? Math.max(0, Math.min(1, record.confidence))
      : undefined;

  return {
    roleId,
    ...(alias ? { alias } : {}),
    source,
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

export function applySemanticToBlock(
  block: LayoutBlock,
  semantic: LayoutBlockSemantic | null,
): LayoutBlock {
  const normalizedSemantic = normalizeLayoutBlockSemantic(semantic);
  if (!normalizedSemantic) {
    if (!block.semantic) {
      return block;
    }

    const { semantic: _semantic, ...restBlock } = block;
    return restBlock;
  }

  return {
    ...block,
    semantic: normalizedSemantic,
  };
}

export function buildSemanticClassName(block: LayoutBlock): string {
  return block.semantic?.roleId ? `semantic-role semantic-role-${block.semantic.roleId}` : '';
}
