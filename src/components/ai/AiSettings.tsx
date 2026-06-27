/**
 * AI 设置组件
 * 配置 AI 服务：Provider、API Key、Base URL、Model
 */

import { useState, useEffect } from 'react';
import { useAppStore } from '@/store';
import type { AiConfig, AiProvider } from '@/types/ai';
import { PROVIDER_LABELS, PROVIDER_DEFAULT_MODELS } from '@/types/ai';
import { aiService } from '@/services/AiService';
import type { ModelInfo } from '@/services/AiService';

export function AiSettings(): JSX.Element {
  const aiConfig = useAppStore((state) => state.aiConfig);
  const isAiConfigured = useAppStore((state) => state.isAiConfigured);
  const setAiConfig = useAppStore((state) => state.setAiConfig);

  const [provider, setProvider] = useState<AiProvider>(aiConfig?.provider ?? 'openai');
  const [apiKey, setApiKey] = useState(aiConfig?.apiKey ?? '');
  const [baseUrl, setBaseUrl] = useState(aiConfig?.baseUrl ?? '');
  const [model, setModel] = useState(aiConfig?.model ?? PROVIDER_DEFAULT_MODELS.openai);
  const [temperature, setTemperature] = useState(aiConfig?.temperature ?? 0.7);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // 模型列表相关状态
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // 当 provider 变化时，更新默认 baseUrl 和 model
  useEffect(() => {
    if (provider === 'openai') {
      if (!baseUrl || baseUrl === 'https://api.anthropic.com' || baseUrl === 'https://自定义') {
        setBaseUrl('https://api.openai.com/v1');
      }
      if (!model || model.startsWith('claude')) {
        setModel(PROVIDER_DEFAULT_MODELS.openai);
      }
    } else if (provider === 'anthropic') {
      if (!baseUrl || baseUrl === 'https://api.openai.com/v1' || baseUrl === 'https://自定义') {
        setBaseUrl('https://api.anthropic.com');
      }
      if (!model || model.startsWith('gpt')) {
        setModel(PROVIDER_DEFAULT_MODELS.anthropic);
      }
    }
  }, [provider]);

  // 拉取模型列表
  const handleFetchModels = async () => {
    if (!apiKey.trim()) {
      setModelsError('请先填写 API Key');
      return;
    }

    setIsLoadingModels(true);
    setModelsError(null);

    try {
      // 临时配置 AI 服务（使用当前表单的值）
      const tempConfig: AiConfig = {
        provider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || getDefaultBaseUrl(provider),
        model: model.trim() || 'gpt-4o',
        temperature,
      };

      aiService.configure(tempConfig);
      const modelList = await aiService.listModels();
      setModels(modelList);

      if (modelList.length > 0 && !modelList.find((m) => m.id === model)) {
        setModel(modelList[0].id);
      }
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : '获取模型列表失败');
      setModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSave = () => {
    if (!apiKey.trim()) {
      setSaveStatus('error');
      return;
    }

    if (!model.trim()) {
      setSaveStatus('error');
      return;
    }

    const config: AiConfig = {
      provider,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || getDefaultBaseUrl(provider),
      model: model.trim(),
      temperature,
    };

    setAiConfig(config);
    setSaveStatus('success');

    setTimeout(() => {
      setSaveStatus('idle');
    }, 3000);
  };

  const handleClear = () => {
    setAiConfig(null);
    setApiKey('');
    setBaseUrl('');
    setModel('');
    setTemperature(0.7);
    setModels([]);
    setSaveStatus('idle');
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      alert('请先填写 API Key');
      return;
    }

    try {
      const tempConfig: AiConfig = {
        provider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || getDefaultBaseUrl(provider),
        model: model.trim() || PROVIDER_DEFAULT_MODELS[provider] || 'gpt-4o',
        temperature,
      };

      aiService.configure(tempConfig);
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
        <h3 className="ai-section-title">AI 服务配置</h3>

        <div className="ai-form">
          <div className="ai-form-group">
            <label htmlFor="ai-provider">Provider</label>
            <select
              id="ai-provider"
              className="ai-select"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as AiProvider);
                setModels([]);
              }}
            >
              {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
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
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="ai-hint">API Key 会保存在本机 localStorage 中，不会写入 .layout 文件</p>
          </div>

          <div className="ai-form-group">
            <label htmlFor="ai-base-url">Base URL</label>
            <input
              id="ai-base-url"
              type="text"
              className="ai-input"
              placeholder={getDefaultBaseUrlPlaceholder(provider)}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
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
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={models.length === 0}
              >
                {models.length === 0 ? (
                  <option value="">手动输入模型</option>
                ) : (
                  models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                className="ai-button ai-button-small"
                onClick={handleFetchModels}
                disabled={isLoadingModels || !apiKey.trim()}
                title="从 API 获取可用模型列表"
              >
                {isLoadingModels ? '加载中...' : '拉取模型'}
              </button>
            </div>
            {models.length === 0 ? (
              <input
                type="text"
                className="ai-input ai-model-input"
                placeholder={getModelPlaceholder(provider)}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            ) : null}
            {modelsError && <p className="ai-hint ai-error-hint">{modelsError}</p>}
            {models.length > 0 && (
              <p className="ai-hint">已加载 {models.length} 个模型，可从下拉选择</p>
            )}
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
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
            />
            <div className="ai-range-labels">
              <span>精确</span>
              <span className="ai-range-value">{temperature.toFixed(1)}</span>
              <span>创造</span>
            </div>
          </div>
        </div>
      </div>

      {saveStatus === 'success' && (
        <div className="ai-success">
          <span>配置已保存</span>
        </div>
      )}

      {saveStatus === 'error' && (
        <div className="ai-error">
          <span>请填写必填字段（API Key 和模型名称）</span>
        </div>
      )}

      <div className="ai-section">
        <div className="ai-settings-actions">
          <button type="button" className="ai-button ai-button-primary" onClick={handleSave}>
            保存配置
          </button>
          <button type="button" className="ai-button" onClick={handleTestConnection}>
            测试连接
          </button>
          {isAiConfigured && (
            <button type="button" className="ai-button ai-button-danger" onClick={handleClear}>
              清除配置
            </button>
          )}
        </div>
      </div>

      {isAiConfigured && (
        <div className="ai-section">
          <div className="ai-config-status">
            <span className="ai-config-status-indicator" />
            <span>已配置 {PROVIDER_LABELS[aiConfig!.provider]} - {aiConfig!.model}</span>
          </div>
        </div>
      )}

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
