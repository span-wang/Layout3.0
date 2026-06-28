/**
 * AI 设置组件
 * 支持保存多套 AI 配置，并把不同任务功能分配给指定配置。
 */

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/store';
import type { AiConfig, AiConfigProfile, AiProvider, AiTaskType } from '@/types/ai';
import { AI_TASK_LABELS, PROVIDER_LABELS, PROVIDER_DEFAULT_MODELS } from '@/types/ai';
import { aiService } from '@/services/AiService';
import type { ModelInfo } from '@/services/AiService';

const NEW_CONFIG_ID = '__new_ai_config__';
const aiTaskTypes = Object.keys(AI_TASK_LABELS) as AiTaskType[];

interface AiConfigDraft {
  name: string;
  provider: AiProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
}

export function AiSettings(): JSX.Element {
  const aiConfigs = useAppStore((state) => state.aiConfigs);
  const aiTaskAssignments = useAppStore((state) => state.aiTaskAssignments);
  const upsertAiConfigProfile = useAppStore((state) => state.upsertAiConfigProfile);
  const deleteAiConfigProfile = useAppStore((state) => state.deleteAiConfigProfile);
  const setAiTaskConfigAssignment = useAppStore((state) => state.setAiTaskConfigAssignment);

  const initialConfig = aiConfigs[0] ?? null;
  const [selectedConfigId, setSelectedConfigId] = useState(initialConfig?.id ?? NEW_CONFIG_ID);
  const [draft, setDraft] = useState<AiConfigDraft>(() =>
    initialConfig ? buildDraftFromConfig(initialConfig) : createEmptyDraft(1),
  );
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // 模型列表相关状态
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const selectedConfig = useMemo(
    () => aiConfigs.find((config) => config.id === selectedConfigId) ?? null,
    [aiConfigs, selectedConfigId],
  );
  const isCreatingConfig = selectedConfigId === NEW_CONFIG_ID;

  useEffect(() => {
    if (selectedConfigId === NEW_CONFIG_ID) {
      return;
    }

    if (!selectedConfig && aiConfigs[0]) {
      setSelectedConfigId(aiConfigs[0].id);
      setDraft(buildDraftFromConfig(aiConfigs[0]));
      setModels([]);
      setModelsError(null);
      return;
    }

    if (!selectedConfig && aiConfigs.length === 0) {
      setSelectedConfigId(NEW_CONFIG_ID);
      setDraft(createEmptyDraft(1));
      setModels([]);
      setModelsError(null);
    }
  }, [aiConfigs, selectedConfig, selectedConfigId]);

  const updateDraft = (patch: Partial<AiConfigDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveStatus('idle');
    setSaveError(null);
  };

  const handleSelectConfig = (config: AiConfigProfile) => {
    setSelectedConfigId(config.id);
    setDraft(buildDraftFromConfig(config));
    setSaveStatus('idle');
    setSaveError(null);
    setModels([]);
    setModelsError(null);
  };

  const handleCreateConfig = () => {
    setSelectedConfigId(NEW_CONFIG_ID);
    setDraft(createEmptyDraft(aiConfigs.length + 1));
    setSaveStatus('idle');
    setSaveError(null);
    setModels([]);
    setModelsError(null);
  };

  const handleProviderChange = (provider: AiProvider) => {
    setDraft((current) => ({
      ...current,
      provider,
      baseUrl: shouldReplaceBaseUrl(current.baseUrl) ? getDefaultBaseUrl(provider) : current.baseUrl,
      model: shouldReplaceModel(current.provider, provider, current.model)
        ? PROVIDER_DEFAULT_MODELS[provider]
        : current.model,
    }));
    setModels([]);
    setModelsError(null);
    setSaveStatus('idle');
    setSaveError(null);
  };

  const handleFetchModels = async () => {
    if (!draft.apiKey.trim()) {
      setModelsError('请先填写 API Key');
      return;
    }

    setIsLoadingModels(true);
    setModelsError(null);

    try {
      const tempConfig = buildConfigFromDraft(draft);
      aiService.configure(tempConfig);
      const modelList = await aiService.listModels();
      setModels(modelList);

      if (modelList.length > 0 && !modelList.find((modelInfo) => modelInfo.id === draft.model)) {
        updateDraft({ model: modelList[0].id });
      }
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : '获取模型列表失败');
      setModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSave = () => {
    const validationError = validateDraft(draft);
    if (validationError) {
      setSaveStatus('error');
      setSaveError(validationError);
      return;
    }

    const now = new Date().toISOString();
    const nextConfig: AiConfigProfile = {
      ...buildConfigFromDraft(draft),
      id: selectedConfig?.id ?? createAiConfigId(),
      name: draft.name.trim(),
      createdAt: selectedConfig?.createdAt ?? now,
      updatedAt: now,
    };

    upsertAiConfigProfile(nextConfig);
    setSelectedConfigId(nextConfig.id);
    setDraft(buildDraftFromConfig(nextConfig));
    setSaveStatus('success');
    setSaveError(null);

    setTimeout(() => {
      setSaveStatus('idle');
    }, 3000);
  };

  const handleDelete = () => {
    if (!selectedConfig) {
      handleCreateConfig();
      return;
    }

    if (!window.confirm(`确定要删除「${selectedConfig.name}」这套 AI 配置吗？相关任务会自动切换到其他可用配置。`)) {
      return;
    }

    deleteAiConfigProfile(selectedConfig.id);
    const nextConfig = aiConfigs.find((config) => config.id !== selectedConfig.id) ?? null;
    if (nextConfig) {
      setSelectedConfigId(nextConfig.id);
      setDraft(buildDraftFromConfig(nextConfig));
    } else {
      setSelectedConfigId(NEW_CONFIG_ID);
      setDraft(createEmptyDraft(1));
    }
    setSaveStatus('idle');
    setSaveError(null);
    setModels([]);
    setModelsError(null);
  };

  const handleTestConnection = async () => {
    const validationError = validateDraft(draft);
    if (validationError) {
      alert(validationError);
      return;
    }

    try {
      aiService.configure(buildConfigFromDraft(draft));
      await aiService.testConnection();
      alert('连接成功！AI 服务配置正确。');
    } catch (error) {
      if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
        alert('连接失败：主进程无法访问 AI 服务。\n\n请检查 Base URL、网络连接、API Key 和模型名称是否正确。');
      } else {
        alert(`连接失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
  };

  return (
    <div className="ai-settings">
      <div className="ai-section">
        <h3 className="ai-section-title">AI 配置管理</h3>
        <div className="ai-config-manager">
          <div className="ai-config-list" aria-label="AI 配置列表">
            {aiConfigs.map((config) => (
              <button
                key={config.id}
                type="button"
                className={config.id === selectedConfigId ? 'ai-config-row active' : 'ai-config-row'}
                onClick={() => handleSelectConfig(config)}
              >
                <span className="ai-config-row-main">
                  <strong>{config.name}</strong>
                  <span>{PROVIDER_LABELS[config.provider]} / {config.model || '未填写模型'}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              className={isCreatingConfig ? 'ai-config-row ai-config-row-new active' : 'ai-config-row ai-config-row-new'}
              onClick={handleCreateConfig}
            >
              + 新增配置
            </button>
          </div>

          <div className="ai-config-editor">
            <div className="ai-form">
              <div className="ai-form-group">
                <label htmlFor="ai-config-name">
                  配置名称
                  <span className="ai-required">*</span>
                </label>
                <input
                  id="ai-config-name"
                  type="text"
                  className="ai-input"
                  placeholder="例如：写作模型、检查模型、本地模型"
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                />
              </div>

              <div className="ai-form-group">
                <label htmlFor="ai-provider">Provider</label>
                <select
                  id="ai-provider"
                  className="ai-select"
                  value={draft.provider}
                  onChange={(event) => handleProviderChange(event.target.value as AiProvider)}
                >
                  {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ai-form-group">
                <label htmlFor="ai-api-key">
                  API Key
                  <span className="ai-required">*</span>
                </label>
                <input
                  id="ai-api-key"
                  type="password"
                  className="ai-input"
                  placeholder="输入您的 API Key"
                  value={draft.apiKey}
                  onChange={(event) => updateDraft({ apiKey: event.target.value })}
                />
                <p className="ai-hint">API Key 会保存在本机 localStorage 中，不会写入 .layout 文件</p>
              </div>

              <div className="ai-form-group">
                <label htmlFor="ai-base-url">Base URL</label>
                <input
                  id="ai-base-url"
                  type="text"
                  className="ai-input"
                  placeholder={getDefaultBaseUrlPlaceholder(draft.provider)}
                  value={draft.baseUrl}
                  onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                />
                <p className="ai-hint">用于 API 请求的端点地址</p>
              </div>

              <div className="ai-form-group">
                <label htmlFor="ai-model">
                  模型
                  <span className="ai-required">*</span>
                </label>
                <div className="ai-model-select-row">
                  <select
                    id="ai-model"
                    className="ai-select ai-model-select"
                    value={draft.model}
                    onChange={(event) => updateDraft({ model: event.target.value })}
                    disabled={models.length === 0}
                  >
                    {models.length === 0 ? (
                      <option value="">手动输入模型</option>
                    ) : (
                      models.map((modelInfo) => (
                        <option key={modelInfo.id} value={modelInfo.id}>
                          {modelInfo.name}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    className="ai-button ai-button-small"
                    onClick={handleFetchModels}
                    disabled={isLoadingModels || !draft.apiKey.trim()}
                    title="从 API 获取可用模型列表"
                  >
                    {isLoadingModels ? '加载中...' : '拉取模型'}
                  </button>
                </div>
                {models.length === 0 ? (
                  <input
                    type="text"
                    className="ai-input ai-model-input"
                    placeholder={getModelPlaceholder(draft.provider)}
                    value={draft.model}
                    onChange={(event) => updateDraft({ model: event.target.value })}
                  />
                ) : null}
                {modelsError ? <p className="ai-hint ai-error-hint">{modelsError}</p> : null}
                {models.length > 0 ? <p className="ai-hint">已加载 {models.length} 个模型，可从下拉选择</p> : null}
              </div>

              <div className="ai-form-group">
                <label htmlFor="ai-temperature">
                  Temperature（创造性）
                  <span className="ai-hint-inline"> 值越大越有创造性，值越小越确定</span>
                </label>
                <input
                  id="ai-temperature"
                  type="range"
                  className="ai-range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={draft.temperature}
                  onChange={(event) => updateDraft({ temperature: Number(event.target.value) })}
                />
                <div className="ai-range-labels">
                  <span>精确</span>
                  <span className="ai-range-value">{draft.temperature.toFixed(1)}</span>
                  <span>创造</span>
                </div>
              </div>
            </div>

            {saveStatus === 'success' ? (
              <div className="ai-success">
                <span>配置已保存</span>
              </div>
            ) : null}

            {saveStatus === 'error' ? (
              <div className="ai-error">
                <span>{saveError ?? '请填写必填字段'}</span>
              </div>
            ) : null}

            <div className="ai-settings-actions">
              <button type="button" className="ai-button ai-button-primary" onClick={handleSave}>
                保存配置
              </button>
              <button type="button" className="ai-button" onClick={handleTestConnection}>
                测试连接
              </button>
              <button type="button" className="ai-button ai-button-danger" onClick={handleDelete}>
                {selectedConfig ? '删除配置' : '清空表单'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="ai-section">
        <h3 className="ai-section-title">任务功能分配</h3>
        {aiConfigs.length === 0 ? (
          <div className="ai-config-empty">请先保存至少一套 AI 配置，再分配给具体功能。</div>
        ) : (
          <div className="ai-task-assignment-list">
            {aiTaskTypes.map((taskType) => (
              <label key={taskType} className="ai-task-assignment-row">
                <span>{AI_TASK_LABELS[taskType]}</span>
                <select
                  className="ai-select"
                  value={aiTaskAssignments[taskType] ?? ''}
                  onChange={(event) => setAiTaskConfigAssignment(taskType, event.target.value)}
                >
                  {aiConfigs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.name} / {config.model}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>

      {aiConfigs.length > 0 ? (
        <div className="ai-section">
          <div className="ai-config-status">
            <span className="ai-config-status-indicator" />
            <span>已保存 {aiConfigs.length} 套 AI 配置，任务功能会按上方分配调用。</span>
          </div>
        </div>
      ) : null}

      <div className="ai-section">
        <h4 className="ai-section-subtitle">Provider 说明</h4>
        <div className="ai-provider-info">
          <div className="ai-provider-card">
            <h5>OpenAI</h5>
            <p>使用 OpenAI 的 GPT 系列模型。支持 GPT-4o、GPT-4 Turbo 等。</p>
            <p>Base URL: https://api.openai.com/v1</p>
          </div>
          <div className="ai-provider-card">
            <h5>Anthropic</h5>
            <p>使用 Anthropic 的 Claude 系列模型。支持 Claude 3.5 Sonnet 等。</p>
            <p>Base URL: https://api.anthropic.com</p>
          </div>
          <div className="ai-provider-card">
            <h5>自定义</h5>
            <p>使用支持 OpenAI 兼容 API 的第三方服务或本地模型。</p>
            <p>可以配置第三方转发服务或本地部署模型的 Base URL。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function createAiConfigId(): string {
  return `ai-config-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEmptyDraft(index: number): AiConfigDraft {
  return {
    name: `AI 配置 ${index}`,
    provider: 'openai',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: PROVIDER_DEFAULT_MODELS.openai,
    temperature: 0.7,
  };
}

function buildDraftFromConfig(config: AiConfigProfile): AiConfigDraft {
  return {
    name: config.name,
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature ?? 0.7,
  };
}

function buildConfigFromDraft(draft: AiConfigDraft): AiConfig {
  return {
    provider: draft.provider,
    apiKey: draft.apiKey.trim(),
    baseUrl: draft.baseUrl.trim() || getDefaultBaseUrl(draft.provider),
    model: draft.model.trim() || PROVIDER_DEFAULT_MODELS[draft.provider],
    temperature: draft.temperature,
  };
}

function validateDraft(draft: AiConfigDraft): string | null {
  if (!draft.name.trim()) {
    return '请填写配置名称';
  }
  if (!draft.apiKey.trim()) {
    return '请填写 API Key';
  }
  if (!draft.model.trim()) {
    return '请填写模型名称';
  }
  return null;
}

function shouldReplaceBaseUrl(baseUrl: string): boolean {
  return !baseUrl || baseUrl === 'https://api.openai.com/v1' || baseUrl === 'https://api.anthropic.com';
}

function shouldReplaceModel(previousProvider: AiProvider, nextProvider: AiProvider, model: string): boolean {
  if (!model.trim()) {
    return true;
  }

  return model === PROVIDER_DEFAULT_MODELS[previousProvider] || (nextProvider === 'openai' && model.startsWith('claude')) || (nextProvider === 'anthropic' && model.startsWith('gpt'));
}

function getDefaultBaseUrl(provider: AiProvider): string {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'custom':
      return '';
  }
}

function getDefaultBaseUrlPlaceholder(provider: AiProvider): string {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'custom':
      return 'https://your-api-server.com/v1';
  }
}

function getModelPlaceholder(provider: AiProvider): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o';
    case 'anthropic':
      return 'claude-sonnet-4-20250514';
    case 'custom':
      return 'your-model-name';
  }
}
