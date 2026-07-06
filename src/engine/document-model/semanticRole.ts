import type {
  BuiltInSemanticRoleId,
  LayoutBlock,
  LayoutBlockSemantic,
  LayoutBlockSemanticPresetState,
  LayoutSemanticKeywordRule,
  LayoutSemanticRoleConfig,
  LayoutSemanticRoleDefinition,
  SemanticRole,
  SemanticBlockPresetDefinition,
  SemanticBlockPresetId,
  SemanticRoleId,
} from './types';

export const BUILT_IN_SEMANTIC_ROLES: SemanticRole[] = [
  { id: 'title', name: '标题', category: 'general', builtIn: true, enabled: true },
  { id: 'section', name: '章节', category: 'general', builtIn: true, enabled: true },
  { id: 'question', name: '题干', category: 'exam', builtIn: true, enabled: true, defaultBlockPresetId: 'defaultSemanticFrame' },
  { id: 'answer', name: '答案', category: 'exam', builtIn: true, enabled: true, defaultBlockPresetId: 'defaultSemanticFrame' },
  { id: 'explanation', name: '解析', category: 'exam', builtIn: true, enabled: true, defaultBlockPresetId: 'defaultSemanticFrame' },
  { id: 'key-point', name: '重点', category: 'note', builtIn: true, enabled: true, defaultBlockPresetId: 'sideAccent' },
  { id: 'pitfall', name: '易错', category: 'note', builtIn: true, enabled: true, defaultBlockPresetId: 'warningFrame' },
  { id: 'caption', name: '说明', category: 'reading', builtIn: true, enabled: true, defaultBlockPresetId: 'defaultSemanticFrame' },
  { id: 'example', name: '例题', category: 'exam', builtIn: true, enabled: true, defaultBlockPresetId: 'defaultSemanticFrame' },
  { id: 'step', name: '步骤', category: 'general', builtIn: true, enabled: true, defaultBlockPresetId: 'defaultSemanticFrame' },
  { id: 'summary', name: '总结', category: 'general', builtIn: true, enabled: true, defaultBlockPresetId: 'sideAccent' },
  { id: 'warning', name: '注意', category: 'note', builtIn: true, enabled: true, defaultBlockPresetId: 'warningFrame' },
];

export const BUILT_IN_SEMANTIC_ROLE_ALIASES: Record<string, BuiltInSemanticRoleId> = {
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

export const BUILT_IN_SEMANTIC_BLOCK_PRESETS: SemanticBlockPresetDefinition[] = [
  {
    id: 'defaultSemanticFrame',
    name: '默认语义框',
    description: '沿用当前语义块默认样式：标签、左侧色条与浅色背景。',
    neutralColor: '#64748b',
  },
  {
    id: 'sideAccent',
    name: '侧边强调',
    description: '更轻的外壳，重点依靠左侧强调线和浅背景。',
    neutralColor: '#475569',
  },
  {
    id: 'softCard',
    name: '浅色卡片',
    description: '以轻边框和柔和底色构成卡片感，不改变块高度。',
    neutralColor: '#64748b',
  },
  {
    id: 'warningFrame',
    name: '警示框',
    description: '边框更明确，适合注意、易错和警示语义。',
    neutralColor: '#9a6700',
  },
];

const roleIds = new Set<string>(BUILT_IN_SEMANTIC_ROLES.map((role) => role.id));
const presetIds = new Set<string>(BUILT_IN_SEMANTIC_BLOCK_PRESETS.map((preset) => preset.id));
const validSemanticSources = new Set<LayoutBlockSemantic['source']>(['manual', 'markdown-prefix', 'keyword', 'ai']);
const customRoleIdPrefix = 'custom-';
const semanticPresetSupportedBlockTypes = new Set<LayoutBlock['type']>(['paragraph', 'heading', 'list', 'blockquote']);

function sanitizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeColor(value: unknown): string | undefined {
  const color = sanitizeString(value);
  return color && /^#[0-9a-f]{6}$/iu.test(color) ? color : undefined;
}

function normalizeSemanticRoleId(value: unknown): SemanticRoleId | undefined {
  const roleId = sanitizeString(value);
  return roleId ? roleId : undefined;
}

export function isSemanticBlockPresetId(value: unknown): value is SemanticBlockPresetId {
  return typeof value === 'string' && presetIds.has(value);
}

function normalizeSemanticBlockPresetId(value: unknown): SemanticBlockPresetId | undefined {
  return isSemanticBlockPresetId(value) ? value : undefined;
}

function normalizeCustomRole(value: unknown): LayoutSemanticRoleDefinition | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeSemanticRoleId(value.id);
  const name = sanitizeString(value.name);
  if (!id || !name || roleIds.has(id)) {
    return null;
  }

  const description = sanitizeString(value.description);
  const color = normalizeColor(value.color);
  const defaultBlockPresetId =
    value.defaultBlockPresetId === null
      ? null
      : normalizeSemanticBlockPresetId(value.defaultBlockPresetId);

  return {
    id,
    name,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    ...(description ? { description } : {}),
    ...(color ? { color } : {}),
    ...(defaultBlockPresetId !== undefined ? { defaultBlockPresetId } : {}),
  };
}

function normalizeKeywordRule(
  value: unknown,
  validRoleIds: Set<string>,
): LayoutSemanticKeywordRule | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = sanitizeString(value.id);
  const roleId = normalizeSemanticRoleId(value.roleId);
  const keyword = sanitizeString(value.keyword);
  if (!id || !roleId || !keyword || !validRoleIds.has(roleId)) {
    return null;
  }

  return {
    id,
    roleId,
    keyword,
    matchMode: 'prefix',
    stripKeyword: typeof value.stripKeyword === 'boolean' ? value.stripKeyword : true,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
  };
}

export function getDefaultSemanticRoleConfig(): LayoutSemanticRoleConfig {
  return {
    version: '1.0.0',
    customRoles: [],
    keywordRules: [],
  };
}

export function normalizeSemanticRoleConfig(config?: unknown): LayoutSemanticRoleConfig {
  if (!isRecord(config)) {
    return getDefaultSemanticRoleConfig();
  }

  const customRoles: LayoutSemanticRoleDefinition[] = [];
  const customRoleIds = new Set<string>();
  const rawCustomRoles = Array.isArray(config.customRoles) ? config.customRoles : [];

  for (const rawRole of rawCustomRoles) {
    const role = normalizeCustomRole(rawRole);
    if (!role || customRoleIds.has(role.id)) {
      continue;
    }

    customRoleIds.add(role.id);
    customRoles.push(role);
  }

  const validRoleIds = new Set<string>([...roleIds, ...customRoleIds]);
  const keywordRules: LayoutSemanticKeywordRule[] = [];
  const keywordRuleIds = new Set<string>();
  const rawKeywordRules = Array.isArray(config.keywordRules) ? config.keywordRules : [];

  for (const rawRule of rawKeywordRules) {
    const rule = normalizeKeywordRule(rawRule, validRoleIds);
    if (!rule || keywordRuleIds.has(rule.id)) {
      continue;
    }

    keywordRuleIds.add(rule.id);
    keywordRules.push(rule);
  }

  return {
    version: '1.0.0',
    customRoles,
    keywordRules,
  };
}

export function getSemanticBlockPresetDefinitions(): SemanticBlockPresetDefinition[] {
  return BUILT_IN_SEMANTIC_BLOCK_PRESETS.map((preset) => ({ ...preset }));
}

export function getSemanticBlockPresetById(
  presetId: string | null | undefined,
): SemanticBlockPresetDefinition | null {
  const normalizedPresetId = sanitizeString(presetId);
  return BUILT_IN_SEMANTIC_BLOCK_PRESETS.find((preset) => preset.id === normalizedPresetId) ?? null;
}

export function supportsSemanticBlockPreset(block: LayoutBlock): boolean {
  return semanticPresetSupportedBlockTypes.has(block.type);
}

export function getAllSemanticRoles(config?: LayoutSemanticRoleConfig): SemanticRole[] {
  const customRoles = normalizeSemanticRoleConfig(config).customRoles.map((role): SemanticRole => ({
    id: role.id,
    name: role.name,
    category: 'custom',
    description: role.description,
    color: role.color,
    enabled: role.enabled,
    builtIn: false,
    defaultBlockPresetId: role.defaultBlockPresetId,
  }));

  return [...BUILT_IN_SEMANTIC_ROLES, ...customRoles];
}

export function getEnabledSemanticRoles(config?: LayoutSemanticRoleConfig): SemanticRole[] {
  return getAllSemanticRoles(config).filter((role) => role.enabled !== false);
}

export function getSemanticRoleById(
  roleId: string | null | undefined,
  config?: LayoutSemanticRoleConfig,
): SemanticRole | null {
  const normalizedRoleId = sanitizeString(roleId);
  return getAllSemanticRoles(config).find((role) => role.id === normalizedRoleId) ?? null;
}

export function getSemanticRoleLabel(
  roleId: string | null | undefined,
  config?: LayoutSemanticRoleConfig,
): string {
  return getSemanticRoleById(roleId, config)?.name ?? roleId ?? '未设置';
}

export function resolveSemanticRoleAlias(
  alias: string | null | undefined,
  config?: LayoutSemanticRoleConfig,
): SemanticRoleId | null {
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

  if (matchedEntry?.[1]) {
    return matchedEntry[1];
  }

  const customRole = normalizeSemanticRoleConfig(config).customRoles.find(
    (role) => role.id.toLowerCase() === lowerAlias || role.name.toLowerCase() === lowerAlias,
  );

  return customRole?.id ?? null;
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

export function normalizeLayoutBlockSemantic(
  value: unknown,
  config?: LayoutSemanticRoleConfig,
): LayoutBlockSemantic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const rawRoleId = sanitizeString(record.roleId);
  const roleId = resolveSemanticRoleAlias(rawRoleId, config) ?? normalizeSemanticRoleId(rawRoleId);
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

export function normalizeLayoutBlockSemanticPresetState(
  value: unknown,
): LayoutBlockSemanticPresetState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const manualPresetId = normalizeSemanticBlockPresetId(value.manualPresetId);
  const hasPreSemanticPresetId = Object.prototype.hasOwnProperty.call(value, 'preSemanticPresetId');
  const preSemanticPresetId = hasPreSemanticPresetId
    ? value.preSemanticPresetId === null
      ? null
      : normalizeSemanticBlockPresetId(value.preSemanticPresetId)
    : undefined;

  if (!manualPresetId && preSemanticPresetId === undefined) {
    return undefined;
  }

  return {
    ...(manualPresetId ? { manualPresetId } : {}),
    ...(preSemanticPresetId !== undefined ? { preSemanticPresetId } : {}),
  };
}

function hasPreSemanticPresetBackup(state: LayoutBlockSemanticPresetState | undefined): boolean {
  return Boolean(state && Object.prototype.hasOwnProperty.call(state, 'preSemanticPresetId'));
}

function normalizeBlockSemanticPresetState(block: LayoutBlock): LayoutBlockSemanticPresetState | undefined {
  return normalizeLayoutBlockSemanticPresetState(block.semanticPreset);
}

function finalizeSemanticPresetState(
  state: LayoutBlockSemanticPresetState | undefined,
): LayoutBlockSemanticPresetState | undefined {
  const normalizedState = normalizeLayoutBlockSemanticPresetState(state);
  return normalizedState;
}

export function getSemanticRoleDefaultBlockPresetId(
  roleId: string | null | undefined,
  config?: LayoutSemanticRoleConfig,
): SemanticBlockPresetId | null {
  return getSemanticRoleById(roleId, config)?.defaultBlockPresetId ?? null;
}

export function applySemanticToBlock(
  block: LayoutBlock,
  semantic: LayoutBlockSemantic | null,
  config?: LayoutSemanticRoleConfig,
): LayoutBlock {
  const normalizedSemantic = normalizeLayoutBlockSemantic(semantic, config);
  const currentPresetState = normalizeBlockSemanticPresetState(block);

  if (!normalizedSemantic) {
    if (!block.semantic) {
      return block;
    }

    const restoredPresetId = currentPresetState?.preSemanticPresetId;
    const nextPresetState = finalizeSemanticPresetState(
      restoredPresetId === undefined
        ? currentPresetState?.manualPresetId
          ? { manualPresetId: currentPresetState.manualPresetId }
          : undefined
        : restoredPresetId === null
          ? undefined
          : { manualPresetId: restoredPresetId },
    );
    const { semantic: _semantic, semanticPreset: _semanticPreset, ...restBlock } = block;
    return nextPresetState
      ? {
          ...restBlock,
          semanticPreset: nextPresetState,
        }
      : restBlock;
  }

  const isEnteringSemantic = !block.semantic;
  const nextPresetState = (() => {
    if (!supportsSemanticBlockPreset(block)) {
      return currentPresetState;
    }

    if (!isEnteringSemantic) {
      return currentPresetState;
    }

    const nextState: LayoutBlockSemanticPresetState = {
      ...(currentPresetState?.manualPresetId ? { manualPresetId: currentPresetState.manualPresetId } : {}),
      ...(hasPreSemanticPresetBackup(currentPresetState)
        ? { preSemanticPresetId: currentPresetState?.preSemanticPresetId ?? null }
        : { preSemanticPresetId: currentPresetState?.manualPresetId ?? null }),
    };

    // 进入语义默认接管后，原普通块手动模板先让位给语义默认模板，必要时可在清除语义时恢复。
    delete nextState.manualPresetId;
    return nextState;
  })();

  const finalizedPresetState = finalizeSemanticPresetState(nextPresetState);
  const { semanticPreset: _legacySemanticPreset, ...restBlock } = block;
  return {
    ...restBlock,
    semantic: normalizedSemantic,
    ...(finalizedPresetState ? { semanticPreset: finalizedPresetState } : {}),
  };
}

export function applySemanticPresetToBlock(
  block: LayoutBlock,
  presetId: SemanticBlockPresetId | null,
): LayoutBlock {
  if (!supportsSemanticBlockPreset(block)) {
    return block;
  }

  const normalizedPresetId = presetId ? getSemanticBlockPresetById(presetId)?.id : null;
  const currentPresetState = normalizeBlockSemanticPresetState(block);
  const hasBackup = hasPreSemanticPresetBackup(currentPresetState);
  const nextPresetState = (() => {
    if (!normalizedPresetId) {
      if (!block.semantic) {
        return undefined;
      }

      return currentPresetState?.preSemanticPresetId !== undefined
        ? { preSemanticPresetId: currentPresetState.preSemanticPresetId }
        : undefined;
    }

    return finalizeSemanticPresetState({
      ...(block.semantic && !hasBackup ? { preSemanticPresetId: currentPresetState?.manualPresetId ?? null } : {}),
      ...(hasBackup ? { preSemanticPresetId: currentPresetState?.preSemanticPresetId ?? null } : {}),
      manualPresetId: normalizedPresetId,
    });
  })();

  const { semanticPreset: _legacySemanticPreset, ...restBlock } = block;
  return nextPresetState
    ? {
        ...restBlock,
        semanticPreset: nextPresetState,
      }
    : restBlock;
}

export function getManualSemanticBlockPresetId(
  block: LayoutBlock,
): SemanticBlockPresetId | null {
  return normalizeBlockSemanticPresetState(block)?.manualPresetId ?? null;
}

export function getPreSemanticBlockPresetId(
  block: LayoutBlock,
): SemanticBlockPresetId | null | undefined {
  return normalizeBlockSemanticPresetState(block)?.preSemanticPresetId;
}

export function getSemanticBlockPresetSource(
  block: LayoutBlock,
  config?: LayoutSemanticRoleConfig,
): 'manual' | 'semantic-default' | null {
  if (!supportsSemanticBlockPreset(block)) {
    return null;
  }

  if (getManualSemanticBlockPresetId(block)) {
    return 'manual';
  }

  return getSemanticRoleDefaultBlockPresetId(block.semantic?.roleId, config) ? 'semantic-default' : null;
}

export function getResolvedSemanticBlockPresetId(
  block: LayoutBlock,
  config?: LayoutSemanticRoleConfig,
): SemanticBlockPresetId | null {
  if (!supportsSemanticBlockPreset(block)) {
    return null;
  }

  return getManualSemanticBlockPresetId(block) ?? getSemanticRoleDefaultBlockPresetId(block.semantic?.roleId, config);
}

export function buildSemanticClassName(block: LayoutBlock): string {
  if (!block.semantic?.roleId) {
    return '';
  }

  const classSuffix = String(block.semantic.roleId).replace(/[^a-z0-9_-]+/giu, '-');
  return `semantic-role semantic-role-${classSuffix}`;
}

export function buildSemanticPresetClassName(
  block: LayoutBlock,
  config?: LayoutSemanticRoleConfig,
): string {
  const presetId = getResolvedSemanticBlockPresetId(block, config);
  if (!presetId) {
    return '';
  }

  return `semantic-block-preset semantic-block-preset-${presetId}`;
}

const builtInSemanticRoleColors: Record<BuiltInSemanticRoleId, string> = {
  title: '#2563eb',
  section: '#0891b2',
  question: '#7c3aed',
  answer: '#16a34a',
  explanation: '#ea580c',
  'key-point': '#dc2626',
  pitfall: '#be123c',
  caption: '#475569',
  example: '#0d9488',
  step: '#4f46e5',
  summary: '#9333ea',
  warning: '#d97706',
};

function createAlphaColor(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/iu.exec(color);
  if (!match?.[1]) {
    return `rgb(59 130 246 / ${Math.round(alpha * 100)}%)`;
  }

  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${red} ${green} ${blue} / ${Math.round(alpha * 100)}%)`;
}

export interface SemanticRolePresentation {
  roleId: SemanticRoleId;
  label: string;
  color: string;
  backgroundColor: string;
  isCustom: boolean;
}

export function getSemanticRolePresentation(
  block: LayoutBlock,
  config?: LayoutSemanticRoleConfig,
): SemanticRolePresentation | null {
  if (!block.semantic?.roleId) {
    return null;
  }

  const role = getSemanticRoleById(block.semantic.roleId, config);
  const fallbackColor = roleIds.has(block.semantic.roleId)
    ? builtInSemanticRoleColors[block.semantic.roleId as BuiltInSemanticRoleId]
    : '#3b82f6';
  const color = role?.color ?? fallbackColor ?? '#3b82f6';
  const label = role?.name ?? block.semantic.alias ?? block.semantic.roleId;

  return {
    roleId: block.semantic.roleId,
    label,
    color,
    backgroundColor: createAlphaColor(color, 0.08),
    isCustom: role?.builtIn === false,
  };
}

export interface SemanticBlockPresetPresentation {
  presetId: SemanticBlockPresetId;
  label: string;
  description?: string;
  source: 'manual' | 'semantic-default';
  color: string;
  backgroundColor: string;
}

export function getSemanticBlockPresetPresentation(
  block: LayoutBlock,
  config?: LayoutSemanticRoleConfig,
): SemanticBlockPresetPresentation | null {
  const presetId = getResolvedSemanticBlockPresetId(block, config);
  const preset = getSemanticBlockPresetById(presetId);
  if (!preset || !supportsSemanticBlockPreset(block)) {
    return null;
  }

  const semanticPresentation = getSemanticRolePresentation(block, config);
  const color = semanticPresentation?.color ?? preset.neutralColor ?? '#64748b';

  return {
    presetId: preset.id,
    label: preset.name,
    description: preset.description,
    source: getSemanticBlockPresetSource(block, config) ?? 'manual',
    color,
    backgroundColor: createAlphaColor(color, preset.id === 'sideAccent' ? 0.06 : preset.id === 'warningFrame' ? 0.1 : 0.08),
  };
}

export function buildSemanticRoleStyleVariables(
  block: LayoutBlock,
  config?: LayoutSemanticRoleConfig,
): Record<string, string> {
  const semanticPresentation = getSemanticRolePresentation(block, config);
  const presetPresentation = getSemanticBlockPresetPresentation(block, config);
  const presentation = semanticPresentation ?? presetPresentation;

  if (!presentation) {
    return {};
  }

  return {
    '--semantic-role-color': presentation.color,
    '--semantic-role-bg': presetPresentation?.backgroundColor ?? presentation.backgroundColor,
  };
}

export function createCustomSemanticRoleId(name: string, existingIds: string[] = []): SemanticRoleId {
  const baseText = sanitizeString(name) ?? 'semantic';
  const baseId = `${customRoleIdPrefix}${baseText
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/giu, '-')
    .replace(/^-+|-+$/g, '') || 'role'}`;
  const usedIds = new Set([...roleIds, ...existingIds]);

  if (!usedIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (usedIds.has(`${baseId}-${index}`)) {
    index += 1;
  }

  return `${baseId}-${index}`;
}

export interface SemanticKeywordPrefixMatch {
  rule: LayoutSemanticKeywordRule;
  role: SemanticRole;
  prefixLength: number;
  content: string;
}

export function findSemanticKeywordPrefixMatch(
  text: string,
  config?: LayoutSemanticRoleConfig,
): SemanticKeywordPrefixMatch | null {
  const semanticConfig = normalizeSemanticRoleConfig(config);
  const roles = getEnabledSemanticRoles(semanticConfig);
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const sortedRules = semanticConfig.keywordRules
    .filter((rule) => rule.enabled && rule.matchMode === 'prefix' && roleById.has(rule.roleId))
    .sort((left, right) => right.keyword.length - left.keyword.length);

  for (const rule of sortedRules) {
    const leadingWhitespace = text.match(/^\s*/u)?.[0] ?? '';
    const textAfterLeading = text.slice(leadingWhitespace.length);
    if (!textAfterLeading.startsWith(rule.keyword)) {
      continue;
    }

    const role = roleById.get(rule.roleId);
    if (!role) {
      continue;
    }

    const prefixEnd = leadingWhitespace.length + rule.keyword.length;
    const trailingWhitespace = text.slice(prefixEnd).match(/^\s*/u)?.[0] ?? '';
    const prefixLength = rule.stripKeyword ? prefixEnd + trailingWhitespace.length : 0;

    return {
      rule,
      role,
      prefixLength,
      content: rule.stripKeyword ? text.slice(prefixLength) : text,
    };
  }

  return null;
}
