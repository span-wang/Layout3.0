/**
 * AI 服务核心
 * 支持 OpenAI / Anthropic / 自定义 Provider 的流式生成、优化和检查功能
 */

import type {
  AiConfig,
  AiGenerateSemanticRoleId,
  AiProvider,
  GenerateOptions,
  GenerateType,
  OptimizeOptions,
  AiCheckResult,
  StreamCallback,
} from '@/types/ai';
import {
  AI_GENERATE_SEMANTIC_ROLE_OPTIONS,
  DEFAULT_AI_GENERATE_SEMANTIC_ROLE_IDS,
  normalizeAiGenerateSemanticRoleIds,
} from '@/types/ai';
import type { TextMarkMapping, TextMarkType } from '@/engine/document-model';
import { hasRegexCaptureGroup } from '@/engine/document-model';
import {
  throwIfMainProcessTransportError,
  throwNormalizedMainProcessInvokeError,
} from './mainProcessRequestError';

/**
 * 模型信息
 */
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
}

/**
 * AI 正则识别入参
 */
export interface AiRegexRecognitionOptions {
  /** 用户提供的示例语法，例如 \mybold{文字} 或 ==文字== */
  sample: string;
  /** 希望映射成的文本样式 */
  markType: TextMarkType;
}

/**
 * AI 正则识别结果，暂不包含 id，采用时由语法映射面板生成。
 */
export type AiRegexRecognitionResult = Omit<TextMarkMapping, 'id'>;

interface AiMainProcessRequestResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  transportError?: {
    code: string;
    message: string;
  };
}

/**
 * API 响应格式（兼容 OpenAI 和 Anthropic 流式格式）
 */
interface MessageContent {
  type: string;
  text?: string;
}

interface StreamChunk {
  type?: string;
  choices?: Array<{
    delta?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  delta?: {
    type?: string;
    text?: string;
  };
  content?: Array<MessageContent>;
  completion?: string;
}

const ARTICLE_CONTEXT_MAX_CHARS = 8000;

function getResponseContentType(response: AiMainProcessRequestResult): string {
  return response.headers['content-type'] ?? response.headers['Content-Type'] ?? '';
}

function isXiaohongshuGenerateType(type: GenerateType): boolean {
  return type === 'xiaohongshuTitle' || type === 'xiaohongshuCopy' || type === 'xiaohongshuCover';
}

function formatOptionalField(label: string, value?: string): string {
  const trimmed = value?.trim();
  return trimmed ? `${label}：${trimmed}` : `${label}：未填写`;
}

function truncateArticleContent(content?: string): string {
  const trimmed = content?.trim() ?? '';
  if (trimmed.length <= ARTICLE_CONTEXT_MAX_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, ARTICLE_CONTEXT_MAX_CHARS)}\n\n（以上为当前文章内容前 ${ARTICLE_CONTEXT_MAX_CHARS} 字，后续内容已省略）`;
}

function createUnexpectedResponseError(endpoint: string, response: AiMainProcessRequestResult): Error {
  const bodyPreview = response.body.trim().slice(0, 160);
  const contentType = getResponseContentType(response) || '未知类型';

  if (bodyPreview.toLowerCase().startsWith('<!doctype') || bodyPreview.toLowerCase().startsWith('<html')) {
    return new Error(
      `AI 服务返回的是网页内容，不是 API 响应。\n\n实际请求地址：${endpoint}\n响应类型：${contentType}\n\n请检查 Base URL 是否填成了官网、控制台地址或服务首页。OpenAI 通常应为 https://api.openai.com/v1；OpenAI 兼容服务通常应以 /v1 结尾。`
    );
  }

  return new Error(
    `AI 服务返回了无法解析的响应。\n\n实际请求地址：${endpoint}\n响应类型：${contentType}\n响应片段：${bodyPreview || '空响应'}`
  );
}

function parseJsonResponse<T>(endpoint: string, response: AiMainProcessRequestResult): T {
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw createUnexpectedResponseError(endpoint, response);
  }
}

function extractJsonObject(raw: string): string {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return raw.slice(start, end + 1).trim();
  }

  return raw.trim();
}

function normalizeRegexPattern(rawPattern: string): string {
  const trimmedPattern = rawPattern.trim();
  const regexLiteralMatch = trimmedPattern.match(/^\/([\s\S]*)\/[a-z]*$/);
  return regexLiteralMatch ? regexLiteralMatch[1] : trimmedPattern;
}

function escapeRegExpSource(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripSimpleRegexAnchors(pattern: string): string {
  let nextPattern = pattern;
  if (nextPattern.startsWith('^')) {
    nextPattern = nextPattern.slice(1);
  }
  if (nextPattern.endsWith('$') && !nextPattern.endsWith('\\$')) {
    nextPattern = nextPattern.slice(0, -1);
  }
  return nextPattern;
}

function getDollarWrappedInnerSample(sample: string): string | null {
  const trimmedSample = sample.trim();
  if (trimmedSample.startsWith('$$') || trimmedSample.endsWith('$$')) {
    return null;
  }

  const match = trimmedSample.match(/^\$\s*([\s\S]*?)\s*\$$/);
  return match ? match[1].trim() : null;
}

function getRegexRecognitionCoreSample(sample: string): string {
  return getDollarWrappedInnerSample(sample) ?? sample.trim();
}

function wrapPatternForDollarSample(pattern: string): string {
  return `\\$?\\s*(?:${stripSimpleRegexAnchors(pattern)})\\s*\\$?`;
}

function decodeLooseRegexField(value: string): string {
  return value
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

function extractLooseField(raw: string, key: string): string | undefined {
  const quotedField = new RegExp(`["']?${key}["']?\\s*:\\s*(["'\`])([\\s\\S]*?)\\1`, 'i').exec(raw);
  if (quotedField?.[2]) {
    return decodeLooseRegexField(quotedField[2]);
  }

  const lineField = new RegExp(`["']?${key}["']?\\s*:\\s*([^,\\n\\r}]+)`, 'i').exec(raw);
  if (lineField?.[1]) {
    return decodeLooseRegexField(lineField[1]);
  }

  return undefined;
}

function parseRegexRecognitionPayload(raw: string): { name?: unknown; pattern?: unknown; description?: unknown } {
  const extracted = extractJsonObject(raw);
  try {
    return JSON.parse(extracted) as { name?: unknown; pattern?: unknown; description?: unknown };
  } catch {
    const loosePayload = {
      name: extractLooseField(extracted, 'name'),
      pattern: extractLooseField(extracted, 'pattern'),
      description: extractLooseField(extracted, 'description'),
    };

    if (loosePayload.name || loosePayload.pattern || loosePayload.description) {
      return loosePayload;
    }

    throw new Error('AI 返回内容无法提取规则字段，请重试一次或换一个更短的示例');
  }
}

function collapseJsonStyleBackslashes(pattern: string): string {
  return pattern.replace(/\\\\/g, '\\');
}

function repairBareLatexCommands(pattern: string): string {
  // AI 有时会把用于匹配 LaTeX 命令的 `\\underline` 写成 `\underline`，
  // 这会被 RegExp 当成非法或特殊转义；这里只修复常见文本标记命令。
  return pattern.replace(
    /(^|[^\\])\\(underline|text|textbf|textit|sout)\b/g,
    (_match, prefix: string, command: string) => `${prefix}\\\\${command}`,
  );
}

function createLatexCommandFallbackPattern(sample: string): string | null {
  const coreSample = getRegexRecognitionCoreSample(sample);
  const textCommandMatch = coreSample.match(/^\\([A-Za-z]+)\s*\{\s*\\text\s*\{[\s\S]+}\s*}$/);
  if (textCommandMatch) {
    const command = escapeRegExpSource(textCommandMatch[1]);
    return `\\$?\\s*\\\\${command}\\s*\\{\\s*\\\\text\\s*\\{(.+?)\\}\\s*\\}\\s*\\$?`;
  }

  const commandMatch = coreSample.match(/^\\([A-Za-z]+)\s*\{[\s\S]+}$/);
  if (commandMatch) {
    const command = escapeRegExpSource(commandMatch[1]);
    return `\\$?\\s*\\\\${command}\\s*\\{(.+?)\\}\\s*\\$?`;
  }

  return null;
}

function dedupePatterns(patterns: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return patterns.filter((pattern): pattern is string => {
    if (!pattern || seen.has(pattern)) {
      return false;
    }
    seen.add(pattern);
    return true;
  });
}

function getRegexMatch(pattern: string, sample: string): RegExpExecArray | null {
  try {
    const regex = new RegExp(pattern, 's');
    return regex.exec(sample);
  } catch {
    return null;
  }
}

function findUsableRegexPattern(rawPattern: string, sample: string): string {
  const normalizedPattern = normalizeRegexPattern(rawPattern);
  const coreSample = getRegexRecognitionCoreSample(sample);
  const collapsedPattern = collapseJsonStyleBackslashes(normalizedPattern);
  const fallbackPattern = createLatexCommandFallbackPattern(sample);
  const baseCandidates = dedupePatterns([
    normalizedPattern,
    collapsedPattern,
    repairBareLatexCommands(normalizedPattern),
    repairBareLatexCommands(collapsedPattern),
    fallbackPattern,
  ]);
  const candidates = dedupePatterns([
    ...baseCandidates,
    ...baseCandidates.map((pattern) => (coreSample !== sample.trim() ? wrapPatternForDollarSample(pattern) : null)),
  ]);

  for (const candidate of candidates) {
    if (!hasRegexCaptureGroup(candidate)) {
      continue;
    }

    const originalMatch = getRegexMatch(candidate, sample);
    if (originalMatch?.[1]) {
      return candidate;
    }

    if (coreSample !== sample.trim()) {
      const coreMatch = getRegexMatch(candidate, coreSample);
      if (coreMatch?.[1]) {
        return coreSample === sample.trim() ? candidate : wrapPatternForDollarSample(candidate);
      }
    }
  }

  throw new Error('AI 返回的正则表达式无法匹配示例语法，请补充更明确的示例');
}

function getTextMarkTypeLabel(markType: TextMarkType): string {
  const labels: Record<TextMarkType, string> = {
    bold: '加粗',
    italic: '斜体',
    underline: '下划线',
    strike: '删除线',
    code: '行内代码',
    link: '链接',
    color: '文字颜色',
  };

  return labels[markType];
}

function resolveEducationSemanticRoleIds(
  roleIds?: readonly AiGenerateSemanticRoleId[],
): AiGenerateSemanticRoleId[] {
  return roleIds === undefined
    ? [...DEFAULT_AI_GENERATE_SEMANTIC_ROLE_IDS]
    : normalizeAiGenerateSemanticRoleIds(roleIds);
}

function buildNumberedPromptRules(rules: string[]): string {
  return rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n');
}

function buildEducationSemanticExampleLines(roleIds: readonly AiGenerateSemanticRoleId[]): string[] {
  const exampleLineMap: Record<AiGenerateSemanticRoleId, string> = {
    answer: 'role:答案 y = 7。',
    explanation: 'role:解析 将 x = 3 代入 y = 2x + 1，得到 y = 7。',
    pitfall: 'role:易错 不要把斜率变化误判成截距变化。',
    caption: 'role:说明 一次函数图像经过平移后，斜率保持不变。',
    summary: 'role:总结 本节先掌握斜率与截距，再做图像题。',
    warning: 'role:注意 代入数据前先确认自变量与函数值对应关系。',
  };

  return roleIds.map((roleId) => exampleLineMap[roleId]).filter(Boolean);
}

function buildEducationSemanticRules(roleIds?: readonly AiGenerateSemanticRoleId[]): string[] {
  const enabledRoleIds = resolveEducationSemanticRoleIds(roleIds);
  const enabledRoles = AI_GENERATE_SEMANTIC_ROLE_OPTIONS.filter((option) =>
    enabledRoleIds.includes(option.id),
  );

  if (enabledRoles.length === 0) {
    return [
      '当前未启用语义块生成，不要输出任何 role: 前缀。',
      '需要区分答案、解析、说明等内容时，请改用普通 Markdown 标题、列表或段落表达，不要使用 role:。',
      '练习题和试卷初稿中的题目、答案和解析都保持普通 Markdown 结构，不要自行补语义前缀。',
      '讲义和知识点总结中的说明、易错、总结和注意内容也保持普通 Markdown 结构，不要自行补语义前缀。',
      '不要为每一行都机械添加额外标记。',
    ];
  }

  const enabledRoleLabels = enabledRoles.map((role) => `role:${role.label}`).join('、');
  const disabledRoleCount = AI_GENERATE_SEMANTIC_ROLE_OPTIONS.length - enabledRoles.length;

  return [
    '对需要被排版系统识别的正文块，在该段开头添加语义角色前缀，格式必须是 role:角色名 正文。',
    `当前启用的语义角色只使用：${enabledRoleLabels}。`,
    disabledRoleCount > 0
      ? '未勾选的语义不要输出对应 role: 前缀；相关内容请改用普通 Markdown 表达。'
      : '当前内置语义都已启用，但仍只在承担明确语义的正文块前添加 role: 前缀。',
    '练习题和试卷初稿中，题目正文保持普通 Markdown 段落或列表，不再添加题干语义；答案和解析只有在对应语义被启用时才添加前缀。',
    '讲义和知识点总结中，说明、易错、总结和注意内容只有在对应语义被启用时才添加前缀，其余保持普通 Markdown 结构。',
    '不要为每一行都机械添加 role:；只有承担明确语义的正文块才添加。',
  ];
}

export function createGenerateSystemPrompt(
  type: GenerateType,
  options?: {
    semanticRoleIds?: AiGenerateSemanticRoleId[];
  },
): string {
  if (isXiaohongshuGenerateType(type)) {
    return `你是一个专业的小红书内容策划助手，擅长把文章内容转成适合小红书传播的标题、正文和封面主图方案。

统一规则：
1. 使用中文输出，语气自然、有画面感，但不要夸张到失真。
2. 必须围绕用户给定的文章标题、选中标题、文案和文章内容展开，不能编造文章中没有的关键事实。
3. 输出结构清晰，使用 Markdown 标题和列表。
4. 不要输出额外解释，不要声明“我是 AI”。
5. 主图能力只输出设计方案和图片生成提示词，不要声称已经生成真实图片文件。`;
  }

  const promptRules = [
    '使用标准 Markdown 语法。',
    '标题层级清晰（H1-H3），标题仍优先使用 #、##、###，不要在标题行前添加 role:。',
    '内容结构化，便于排版。',
    '适当使用列表、表格等元素。',
    '数学公式使用 $...$（行内）和 $$...$$（独立公式）。',
    '当不同信息来源存在冲突时，必须按以下优先级执行：用户要求描述 > 生成类型要求 > 主题/年级/科目等基础上下文 > 个人知识库参考资料。',
    ...buildEducationSemanticRules(options?.semanticRoleIds),
    '如果用户提供了要求描述，请优先满足其中的范围、格式、语气和内容约束。',
    '如果用户提供了个人知识库资料，只能把它当作参考资料使用；若与用户要求描述冲突，必须以用户要求描述为准，同时不要编造资料里没有的具体事实。',
  ];
  const exampleLines = buildEducationSemanticExampleLines(
    resolveEducationSemanticRoleIds(options?.semanticRoleIds),
  );

  return `你是一个专业的教育内容生成助手，擅长生成 Markdown 格式的教育文档。

生成规则：
${buildNumberedPromptRules(promptRules)}${
    exampleLines.length > 0 ? `\n\n示例：\n${exampleLines.join('\n')}` : ''
  }

请直接生成内容，不要有额外的解释说明。`;
}

export function createEducationOutlineSystemPrompt(type: GenerateType): string {
  const typeLabels: Record<string, string> = {
    lecture: '讲义',
    summary: '知识点总结',
    exercise: '练习题',
    exam: '试卷初稿',
  };

  return `你是一个专业的教育内容策划助手，擅长先把教学内容拆成可审核的大纲。

大纲任务：${typeLabels[type] || type}

大纲规则：
1. 只生成大纲草稿，不要生成完整正文。
2. 使用中文 Markdown 输出，优先使用 #、##、### 和列表。
3. 大纲要具体到可直接展开正文的层级，标出每一部分应包含的要点、题型、答案或解析位置。
4. 不要输出完整讲解段落、完整题目正文、完整答案解析或大段例题展开。
5. 不要输出 role: 前缀；语义块只在最终正文生成阶段使用。
6. 如果有个人知识库参考资料，只把它用于确定大纲范围和要点，不要把资料原文整段复制进大纲。

请直接输出大纲草稿，不要解释你将如何生成。`;
}

export function createEducationGenerateUserMessage(options: GenerateOptions): string {
  const typeLabels: Record<string, string> = {
    lecture: '讲义',
    summary: '知识点总结',
    exercise: '练习题',
    exam: '试卷初稿',
  };

  const lengthLabels: Record<string, string> = {
    short: '简短',
    medium: '中等长度',
    long: '详细完整',
  };

  const sections = [`请生成一份${typeLabels[options.type] || options.type}。`];
  const trimmedRequirementDescription = options.requirementDescription?.trim();
  const basicContextLines = [`主题：${options.topic}`];

  if (options.grade) {
    basicContextLines.push(`年级：${options.grade}`);
  }
  if (options.subject) {
    basicContextLines.push(`科目：${options.subject}`);
  }

  if (trimmedRequirementDescription) {
    sections.push([
      '第一优先级：用户要求描述',
      `要求描述：${trimmedRequirementDescription}`,
      '后续如果与其他信息冲突，必须优先满足这里的要求。',
    ].join('\n'));
  }

  sections.push([
    '第二优先级：生成类型要求',
    `生成类型：${typeLabels[options.type] || options.type}`,
    `长度要求：${lengthLabels[options.length || 'medium'] || '中等长度'}`,
  ].join('\n'));

  sections.push(['第三优先级：主题/年级/科目', ...basicContextLines].join('\n'));

  if (options.knowledgeContext?.trim()) {
    sections.push([
      '第四优先级：个人知识库参考资料',
      '以下资料仅作参考，不能覆盖前面的用户要求、生成类型要求和基础上下文；若资料与用户要求描述冲突，必须以用户要求描述为准。',
      '资料不足时可以做合理补全，但不要编造资料里没有的具体事实。',
      options.knowledgeContext.trim(),
    ].join('\n\n'));
  }

  return sections.join('\n\n');
}

function createStructureTemplatePromptSection(options: GenerateOptions): string | null {
  const template = options.structureTemplate;
  if (!template?.structure.trim()) {
    return null;
  }

  return [
    '用户自定义文章结构模板',
    `模板名称：${template.name.trim() || '未命名模板'}`,
    '文章结构：',
    template.structure.trim(),
    template.outputRules?.trim()
      ? `输出要求：\n${template.outputRules.trim()}`
      : '输出要求：未填写',
  ].join('\n');
}

export function createEducationOutlineUserMessage(options: GenerateOptions): string {
  const typeLabels: Record<string, string> = {
    lecture: '讲义',
    summary: '知识点总结',
    exercise: '练习题',
    exam: '试卷初稿',
  };
  const templateSection = createStructureTemplatePromptSection(options);

  return `${createEducationGenerateUserMessage(options)}
${templateSection ? `\n\n${templateSection}` : ''}

当前只需要先生成一份“${typeLabels[options.type] || options.type}”的大纲草稿。

大纲输出要求：
1. 不要生成完整正文，只输出可供用户审核和修改的大纲。
2. 大纲要覆盖最终正文的章节、知识点、题目区、答案区、解析区或总结区。
3. 每个大纲项可以写简短说明，但不要展开成完整段落。
4. 如果提供了用户自定义文章结构模板，必须按该模板组织大纲，不要擅自新增、删除或改名模板主结构；可以在模板章节下补充二级或三级内容。
5. 如果信息不足，请在大纲中用“待补充”标出，不要编造具体事实。`;
}

export function createEducationContentFromOutlineUserMessage(options: GenerateOptions): string {
  const reviewedOutline = options.reviewedOutline?.trim();
  if (!reviewedOutline) {
    throw new Error('请先确认大纲后再生成正文');
  }
  const templateSection = createStructureTemplatePromptSection(options);

  return `${createEducationGenerateUserMessage(options)}
${templateSection ? `\n\n${templateSection}` : ''}

已审核大纲：
${reviewedOutline}

正文生成要求：
1. 必须严格依据以上“已审核大纲”展开最终正文，不要擅自改写大纲结构。
2. 可以把大纲中的简短要点扩写为完整 Markdown 内容。
3. 如果大纲里标有答案、解析、易错、说明、总结或注意，请结合当前启用的语义块规则输出。
4. 如果提供了用户自定义文章结构模板，最终正文必须保持模板主结构和审核后大纲一致，不要擅自新增、删除或改名模板主结构。
5. 不要再次输出“大纲草稿”或审核说明，直接输出最终正文。`;
}

/**
 * AI 服务类
 */
export class AiService {
  private config: AiConfig | null = null;

  /**
   * 配置 AI 服务
   */
  configure(config: AiConfig): void {
    if (!config.apiKey) {
      throw new Error('API Key 不能为空');
    }
    if (!config.model) {
      throw new Error('模型名称不能为空');
    }
    this.config = config;
  }

  /**
   * 检查是否已配置
   */
  isConfigured(): boolean {
    return this.config !== null && !!this.config.apiKey && !!this.config.model;
  }

  /**
   * 获取当前配置
   */
  getConfig(): AiConfig | null {
    return this.config;
  }

  /**
   * 清除配置
   */
  clearConfig(): void {
    this.config = null;
  }

  /**
   * 获取可用模型列表
   * @param signal abort 信号
   */
  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    if (!this.config) {
      throw new Error('请先配置 AI 服务');
    }

    const baseUrl = this.config.baseUrl.replace(/\/$/, '');

    switch (this.config.provider) {
      case 'openai': {
        // OpenAI 使用 /models 端点
        const endpoint = `${baseUrl}/models`;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.config.apiKey}`,
        };

        const response = await this.requestApi(endpoint, {
          method: 'GET',
          headers,
          signal,
        });

        if (!response.ok) {
          throw new Error(`获取模型列表失败: ${response.status} ${response.statusText}`);
        }

        const data = parseJsonResponse<{ data?: Array<{ id: string }> }>(endpoint, response);
        return (data.data || []).map((m) => ({
          id: m.id,
          name: m.id,
        }));
      }

      case 'anthropic': {
        // Anthropic 的模型列表是固定的
        return [
          { id: 'claude-opus-4-5-20251120', name: 'Claude Opus 4' },
          { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
          { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
          { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
          { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
        ];
      }

      case 'custom': {
        // 自定义 Provider 尝试获取模型列表，如果失败则返回空
        try {
          const endpoint = `${baseUrl}/models`;
          const headers: Record<string, string> = {
            Authorization: `Bearer ${this.config.apiKey}`,
          };

          const response = await this.requestApi(endpoint, {
            method: 'GET',
            headers,
            signal,
          });

          if (response.ok) {
            const data = parseJsonResponse<{ data?: Array<{ id: string }> }>(endpoint, response);
            return (data.data || []).map((m) => ({
              id: m.id,
              name: m.id,
            }));
          }
        } catch {
          // 忽略错误
        }

        // 如果获取失败，返回提示
        throw new Error('此 API 不支持自动获取模型列表，请手动输入模型名称');
      }
    }
  }

  /**
   * 构建请求头
   */
  private buildHeaders(): Record<string, string> {
    if (!this.config) {
      throw new Error('请先配置 AI 服务');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    switch (this.config.provider) {
      case 'openai':
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        break;
      case 'anthropic':
        headers['x-api-key'] = this.config.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        break;
      case 'custom':
        // 自定义 provider 使用 Bearer 认证，可根据需要调整
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        break;
    }

    return headers;
  }

  /**
   * 构建请求体（根据 provider 不同）
   */
  private buildRequestBody(
    systemPrompt: string,
    userMessage: string
  ): Record<string, unknown> {
    if (!this.config) {
      throw new Error('请先配置 AI 服务');
    }

    const baseParams = {
      temperature: this.config.temperature ?? 0.7,
      stream: true,
    };

    switch (this.config.provider) {
      case 'openai':
        return {
          ...baseParams,
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        };
      case 'anthropic':
        return {
          ...baseParams,
          model: this.config.model,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
          max_tokens: 4096,
        };
      case 'custom':
        // 自定义 provider 尽量兼容 OpenAI 格式
        return {
          ...baseParams,
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        };
    }
  }

  /**
   * 获取 API 端点
   */
  private getEndpoint(): string {
    if (!this.config) {
      throw new Error('请先配置 AI 服务');
    }

    const baseUrl = this.config.baseUrl.replace(/\/$/, '');

    switch (this.config.provider) {
      case 'openai':
        return `${baseUrl}/chat/completions`;
      case 'anthropic':
        return `${baseUrl}/v1/messages`;
      case 'custom':
        return `${baseUrl}/chat/completions`;
    }
  }

  /**
   * 所有 AI 请求统一从主进程发出，避免 renderer 的浏览器 CORS 限制。
   */
  private async requestApi(
    endpoint: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    }
  ): Promise<AiMainProcessRequestResult> {
    if (!window.layoutAPI?.requestAi) {
      throw new Error('AI 请求通道不可用，请重启应用后再试');
    }

    const requestId = `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const cancelMainRequest = () => {
      void window.layoutAPI.cancelAiRequest?.(requestId);
    };

    if (options.signal?.aborted) {
      throw new DOMException('请求已取消', 'AbortError');
    }

    options.signal?.addEventListener('abort', cancelMainRequest, { once: true });
    try {
      const result = await window.layoutAPI.requestAi({
        requestId,
        url: endpoint,
        method: options.method,
        headers: options.headers,
        body: options.body,
      });
      throwIfMainProcessTransportError({
        url: endpoint,
        transportError: result.transportError,
      });
      return result;
    } catch (error) {
      if (options.signal?.aborted) {
        throw new DOMException('请求已取消', 'AbortError');
      }
      return throwNormalizedMainProcessInvokeError(endpoint, error);
    } finally {
      options.signal?.removeEventListener('abort', cancelMainRequest);
    }
  }

  /**
   * 解析流式响应（兼容 OpenAI 和 Anthropic）
   */
  private parseStreamChunk(line: string): string | null {
    // OpenAI 格式: data: {"choices":[{"delta":{"content":"..."}}]}
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        return null;
      }
      try {
        const parsed = JSON.parse(data) as StreamChunk;
        return (
          parsed.choices?.[0]?.delta?.content ??
          parsed.delta?.text ??
          parsed.content?.find((item) => item.type === 'text_delta' || item.type === 'text')?.text ??
          parsed.completion ??
          null
        );
      } catch {
        // 忽略解析错误
      }
    }
    return null;
  }

  /**
   * 生成内容（流式）
   * @param options 生成选项
   * @param onChunk 流式回调，每次收到内容块时调用
   * @param signal abort 信号
   */
  async generate(
    options: GenerateOptions,
    onChunk: StreamCallback,
    signal?: AbortSignal
  ): Promise<string> {
    const systemPrompt = this.getGenerateSystemPrompt(options);
    const userMessage = this.getGenerateUserMessage(options);

    return this.streamGenerate(systemPrompt, userMessage, onChunk, signal);
  }

  /**
   * 生成教育内容大纲（流式）
   * @param options 生成选项
   * @param onChunk 流式回调
   * @param signal abort 信号
   */
  async generateOutline(
    options: GenerateOptions,
    onChunk: StreamCallback,
    signal?: AbortSignal
  ): Promise<string> {
    const systemPrompt = createEducationOutlineSystemPrompt(options.type);
    const userMessage = createEducationOutlineUserMessage(options);

    return this.streamGenerate(systemPrompt, userMessage, onChunk, signal);
  }

  /**
   * 按用户审核后的大纲生成教育内容正文（流式）
   * @param options 生成选项，必须包含 reviewedOutline
   * @param onChunk 流式回调
   * @param signal abort 信号
   */
  async generateFromOutline(
    options: GenerateOptions,
    onChunk: StreamCallback,
    signal?: AbortSignal
  ): Promise<string> {
    const systemPrompt = this.getGenerateSystemPrompt(options);
    const userMessage = createEducationContentFromOutlineUserMessage(options);

    return this.streamGenerate(systemPrompt, userMessage, onChunk, signal);
  }

  /**
   * 优化内容（流式）
   * @param options 优化选项
   * @param onChunk 流式回调
   * @param signal abort 信号
   */
  async optimize(
    options: OptimizeOptions,
    onChunk: StreamCallback,
    signal?: AbortSignal
  ): Promise<string> {
    const systemPrompt = this.getOptimizeSystemPrompt(options.mode);
    const userMessage = this.getOptimizeUserMessage(options);

    return this.streamGenerate(systemPrompt, userMessage, onChunk, signal);
  }

  /**
   * 检查文档
   * @param content 文档内容（Markdown 格式）
   * @param signal abort 信号
   */
  async checkDocument(
    content: string,
    signal?: AbortSignal
  ): Promise<AiCheckResult> {
    const systemPrompt = `你是一个专业的教育内容排版检查助手。请检查 Markdown 文档的排版问题。

检查范围：
1. **标题层级**：H1-H6 层级是否合理，避免跳级
2. **段落长度**：超过 500 字应拆分
3. **图片说明**：图片是否配有 alt 说明
4. **表格宽度**：是否过宽可能超出页面
5. **分页美观**：标题是否出现在页尾

请用 JSON 格式返回检查结果，格式如下：
{
  "items": [
    {
      "page": 1,
      "severity": "warning",
      "message": "问题描述",
      "suggestion": "修复建议",
      "autoFixable": true
    }
  ]
}

注意：
- page 从 1 开始
- severity 可选值：error, warning, suggestion
- autoFixable 表示是否可以直接修复
- 如果没有发现问题，返回空数组 items`;

    const userMessage = `请检查以下文档内容：

${content}`;

    const result = await this.generateNonStream(systemPrompt, userMessage, signal);
    return this.parseCheckResult(result);
  }

  /**
   * 根据用户给出的示例语法，让 AI 生成可用于文本标记映射的 JavaScript 正则表达式。
   */
  async recognizeTextMarkRegex(
    options: AiRegexRecognitionOptions,
    signal?: AbortSignal,
  ): Promise<AiRegexRecognitionResult> {
    const sample = options.sample.trim();
    if (!sample) {
      throw new Error('请先输入需要识别的示例语法');
    }
    const coreSample = getRegexRecognitionCoreSample(sample);

    const systemPrompt = `你是一个严谨的 JavaScript 正则表达式助手，专门为 Markdown 文本标记映射生成正则。

要求：
1. 只返回 JSON，不要返回 Markdown 代码块或解释。
2. pattern 必须是 JavaScript RegExp 的 source 字符串，不要包含开头和结尾的 /。
3. pattern 必须包含至少一个捕获组，用第一个捕获组提取被标记的正文。
4. pattern 应尽量只匹配用户给出的语法边界，不要贪婪匹配整段文本。
5. 不要使用会改变正文内容的替换写法。
6. 如果示例有外层 $...$，pattern 应能匹配外层美元符号和空格，但第一个捕获组只捕获正文。

返回格式：
{
  "name": "规则名称",
  "pattern": "正则表达式 source 字符串",
  "description": "一句中文说明"
}`;

    const userMessage = `原始示例语法：${sample}
核心示例语法：${coreSample}
目标文本样式：${getTextMarkTypeLabel(options.markType)}

请生成一条可用于识别该语法的 JavaScript 正则表达式。`;

    const rawResult = await this.generateNonStream(systemPrompt, userMessage, signal);
    return this.parseRegexRecognitionResult(rawResult, options.markType, sample);
  }

  /**
   * 发送最小请求验证当前配置是否可用。
   */
  async testConnection(signal?: AbortSignal): Promise<void> {
    await this.generateNonStream('你只需要返回 OK。', '请回复 OK', signal);
  }

  /**
   * 非流式生成（用于检查等功能）
   */
  private async generateNonStream(
    systemPrompt: string,
    userMessage: string,
    signal?: AbortSignal
  ): Promise<string> {
    const endpoint = this.getEndpoint();
    const headers = this.buildHeaders();
    const body = this.buildRequestBody(systemPrompt, userMessage);
    const requestBody = JSON.stringify({ ...body, stream: false });

    const response = await this.requestApi(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      signal,
    });

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status} ${response.statusText}\n${response.body}`);
    }

    const data = parseJsonResponse<{
      choices?: Array<{ message?: { content?: string } }>;
      content?: Array<{ text?: string }>;
    }>(endpoint, response);

    // 解析响应（兼容 OpenAI 和 Anthropic）
    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    if (data.content?.[0]?.text) {
      return data.content[0].text;
    }

    return '';
  }

  /**
   * 流式生成
   */
  private async streamGenerate(
    systemPrompt: string,
    userMessage: string,
    onChunk: StreamCallback,
    signal?: AbortSignal
  ): Promise<string> {
    const endpoint = this.getEndpoint();
    const headers = this.buildHeaders();
    const body = this.buildRequestBody(systemPrompt, userMessage);
    const requestBody = JSON.stringify(body);

    const response = await this.requestApi(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      signal,
    });

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status} ${response.statusText}\n${response.body}`);
    }
    const trimmedBody = response.body.trim();
    if (trimmedBody.toLowerCase().startsWith('<!doctype') || trimmedBody.toLowerCase().startsWith('<html')) {
      throw createUnexpectedResponseError(endpoint, response);
    }
    let fullContent = '';
    let bufferedText = response.body;
    const lines = bufferedText.split(/\r?\n/);
    bufferedText = lines.pop() ?? '';

    // 主进程 IPC 当前返回完整响应文本；这里按 SSE 行格式解析，并模拟分批写回 UI。
    for (const line of lines) {
      const content = this.parseStreamChunk(line);
      if (content) {
        fullContent += content;
        onChunk(fullContent);
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (signal?.aborted) {
          throw new DOMException('请求已取消', 'AbortError');
        }
      }
    }

    const tailContent = this.parseStreamChunk(bufferedText);
    if (tailContent) {
      fullContent += tailContent;
      onChunk(fullContent);
    }

    return fullContent;
  }

  /**
   * 获取生成系统提示词
   */
  private getGenerateSystemPrompt(options: GenerateOptions): string {
    return createGenerateSystemPrompt(options.type, {
      semanticRoleIds: options.semanticRoleIds,
    });
  }

  /**
   * 获取生成用户消息
   */
  private getGenerateUserMessage(options: GenerateOptions): string {
    if (options.type === 'xiaohongshuTitle') {
      return this.getXiaohongshuTitleUserMessage(options);
    }

    if (options.type === 'xiaohongshuCopy') {
      return this.getXiaohongshuCopyUserMessage(options);
    }

    if (options.type === 'xiaohongshuCover') {
      return this.getXiaohongshuCoverUserMessage(options);
    }

    return createEducationGenerateUserMessage(options);
  }

  private getXiaohongshuTitleUserMessage(options: GenerateOptions): string {
    const articleContent = truncateArticleContent(options.articleContent);

    return `请根据以下信息推荐小红书标题。

${formatOptionalField('选题/主题', options.topic)}
${formatOptionalField('文章标题', options.articleTitle)}

文章内容：
${articleContent || '当前没有提供文章正文，请主要根据选题/主题和文章标题生成。'}

输出要求：
1. 按以下 6 类分别输出，每类 5 个标题：痛点型（直接解决问题）、共鸣型（让人一秒带入）、反常识型（颠覆认知）、对比型（变化越明显越容易火）、氛围感型（买感觉）、合集清单型（一篇顶十篇）。
2. 每个标题尽量短、有记忆点，适合小红书信息流。
3. 标题不要使用虚假承诺，不要承诺绝对效果。
4. 最后补充“优先推荐”的 3 个标题，并说明推荐理由。`;
  }

  private getXiaohongshuCopyUserMessage(options: GenerateOptions): string {
    const articleContent = truncateArticleContent(options.articleContent);

    return `请根据用户选定的小红书标题和文章内容，生成一篇小红书文案。

${formatOptionalField('文章标题', options.articleTitle)}
选定小红书标题：${options.selectedTitle?.trim() || options.topic}

文章内容：
${articleContent || '当前没有提供文章正文，请主要根据标题生成，并避免编造具体数据或事实。'}

输出要求：
1. 先输出最终标题，再输出正文。
2. 正文需要结合文章内容，不要只写泛泛而谈的营销话术。
3. 结构包含：开头钩子、正文分点、结尾互动、话题标签。
4. 语言像真实小红书笔记，亲切、具体、有节奏，但不要堆砌感叹号。
5. 标签 6-10 个，和内容强相关。`;
  }

  private getXiaohongshuCoverUserMessage(options: GenerateOptions): string {
    const articleContent = truncateArticleContent(options.articleContent);

    return `请根据文章标题、小红书文案和文章内容，生成小红书主图方案和图片生成提示词。

${formatOptionalField('文章标题', options.articleTitle)}
选定小红书标题：${options.selectedTitle?.trim() || options.topic}

小红书文案：
${options.selectedCopy?.trim() || '用户没有单独提供文案，请结合文章内容和选定标题推导主图重点。'}

文章内容：
${articleContent || '当前没有提供文章正文，请主要根据标题和文案生成主图方案。'}

输出要求：
1. 输出“封面主文案”“封面副文案”“画面构图”“颜色与氛围”“元素清单”“图片生成提示词”“负面提示词”。
2. 封面文字要短，适合竖版小红书封面，不要超过 2 行主视觉文字。
3. 图片生成提示词要能直接复制给图片生成模型使用，描述清楚主体、构图、风格、色彩、光线、文字区域和画幅。
4. 明确这是主图生成方案，不要声称已经生成图片文件。`;
  }

  /**
   * 获取优化系统提示词
   */
  private getOptimizeSystemPrompt(mode: string): string {
    const modePrompts: Record<string, string> = {
      polish: '你是一个专业的中文写作润色助手，擅长优化文章表达，使其更流畅、专业。保持原文结构和格式不变。',
      rewrite: '你是一个专业的内容改写助手，擅长用不同方式表达相同内容。保持核心信息不变，改变表达方式。',
      summary: '你是一个专业的文本摘要助手，擅长提炼核心内容，生成简洁准确的摘要。',
      expand: '你是一个专业的教育内容扩展助手，擅长丰富和完善现有内容，增加细节和例子。',
      simplify: '你是一个专业的教育内容简化助手，擅长将复杂内容简化成易懂的语言，适合学生理解。',
      formalize: '你是一个专业的正式文档写作助手，擅长将口语化内容改写成正式、规范的书面语。',
    };

    return modePrompts[mode] || modePrompts.polish;
  }

  /**
   * 获取优化用户消息
   */
  private getOptimizeUserMessage(options: OptimizeOptions): string {
    return `请对以下内容进行优化（${options.mode}模式）：

---
${options.text}
---

请直接返回优化后的内容，不要有额外说明。`;
  }

  /**
   * 解析检查结果
   */
  private parseCheckResult(raw: string): AiCheckResult {
    try {
      // 尝试从 JSON 中提取内容（可能有 markdown 代码块包裹）
      let jsonStr = raw;
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr) as { items?: unknown[] };

      if (Array.isArray(parsed.items)) {
        return {
          items: parsed.items.map((item, index) => {
            const safeItem = item as Record<string, unknown>;
            return {
              id: `check-${Date.now()}-${index}`,
              page: typeof safeItem.page === 'number' ? safeItem.page : 1,
              severity: (safeItem.severity as 'error' | 'warning' | 'suggestion') || 'suggestion',
              message: String(safeItem.message || ''),
              suggestion: String(safeItem.suggestion || ''),
              autoFixable: Boolean(safeItem.autoFixable),
              elementId: safeItem.elementId as string | undefined,
            };
          }),
          checkedAt: Date.now(),
        };
      }
    } catch (e) {
      console.error('解析检查结果失败:', e);
    }

    return {
      items: [],
      checkedAt: Date.now(),
    };
  }

  /**
   * 解析并校验 AI 返回的正则识别结果。
   */
  private parseRegexRecognitionResult(
    raw: string,
    markType: TextMarkType,
    sample: string,
  ): AiRegexRecognitionResult {
    let parsed: { name?: unknown; pattern?: unknown; description?: unknown };
    try {
      parsed = parseRegexRecognitionPayload(raw);
    } catch (error) {
      const fallbackPattern = createLatexCommandFallbackPattern(sample);
      if (!fallbackPattern) {
        throw error;
      }
      parsed = {
        pattern: fallbackPattern,
        description: 'AI 返回结构不完整，已根据 LaTeX 示例自动生成候选正则',
      };
    }

    const pattern = typeof parsed.pattern === 'string' ? findUsableRegexPattern(parsed.pattern, sample) : createLatexCommandFallbackPattern(sample) ?? '';
    if (!pattern) {
      throw new Error('AI 没有返回可用的正则表达式');
    }

    if (!hasRegexCaptureGroup(pattern)) {
      throw new Error('AI 返回的正则表达式缺少捕获组，无法提取被标记文本');
    }

    if (!getRegexMatch(pattern, sample)?.[1] && !getRegexMatch(pattern, getRegexRecognitionCoreSample(sample))?.[1]) {
      throw new Error('AI 返回的正则表达式无法匹配示例语法，请补充更明确的示例');
    }

    const fallbackName = `AI 识别${getTextMarkTypeLabel(markType)}语法`;
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : fallbackName,
      pattern,
      markType,
      enabled: true,
      description:
        typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : `由 AI 根据示例「${sample}」识别生成`,
    };
  }
}

/**
 * AI 服务单例
 */
export const aiService = new AiService();
