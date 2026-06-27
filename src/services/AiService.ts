/**
 * AI 服务核心
 * 支持 OpenAI / Anthropic / 自定义 Provider 的流式生成、优化和检查功能
 */

import type {
  AiConfig,
  AiProvider,
  GenerateOptions,
  OptimizeOptions,
  AiCheckResult,
  StreamCallback,
} from '@/types/ai';

/**
 * API 响应格式（兼容 OpenAI 和 Anthropic 流式格式）
 */
interface MessageContent {
  type: string;
  text?: string;
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  content?: Array<MessageContent>;
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
        // 自定义 provider 默认使用 chat/completions 端点
        return `${baseUrl}/chat/completions`;
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
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          return content;
        }
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
    const systemPrompt = this.getGenerateSystemPrompt();
    const userMessage = this.getGenerateUserMessage(options);

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

    // 非流式请求
    const nonStreamBody = { ...body, stream: false };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(nonStreamBody),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      content?: Array<{ text?: string }>;
    };

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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status} ${response.statusText}\n${errorText}`);
    }

    if (!response.body) {
      throw new Error('响应体为空');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          const content = this.parseStreamChunk(line);
          if (content) {
            fullContent += content;
            onChunk(fullContent);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return fullContent;
  }

  /**
   * 获取生成系统提示词
   */
  private getGenerateSystemPrompt(): string {
    return `你是一个专业的教育内容生成助手，擅长生成 Markdown 格式的教育文档。

生成规则：
1. 使用标准 Markdown 语法
2. 标题层级清晰（H1-H3）
3. 内容结构化，便于排版
4. 适当使用列表、表格等元素
5. 数学公式使用 $...$（行内）和 $$...$$（独立公式）

请直接生成内容，不要有额外的解释说明。`;
  }

  /**
   * 获取生成用户消息
   */
  private getGenerateUserMessage(options: GenerateOptions): string {
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

    let message = `请生成一份${typeLabels[options.type] || options.type}。\n\n主题：${options.topic}`;

    if (options.grade) {
      message += `\n年级：${options.grade}`;
    }
    if (options.subject) {
      message += `\n科目：${options.subject}`;
    }
    message += `\n长度要求：${lengthLabels[options.length || 'medium'] || '中等长度'}`;

    return message;
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
}

/**
 * AI 服务单例
 */
export const aiService = new AiService();
