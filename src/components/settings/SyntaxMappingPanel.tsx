/**
 * 语法映射配置面板
 *
 * 提供前端配置界面，允许用户：
 * - 查看和修改文本标记映射
 * - 查看和修改块级指令映射
 * - 启用/禁用映射规则
 * - 添加自定义映射
 */

import { useState, useCallback, useEffect } from 'react';
import type {
  TextMarkMapping,
  BlockCommandMapping,
  SyntaxMappingConfig,
  TextMarkType,
} from '@/engine/document-model';
import {
  getDefaultSyntaxMappingConfig,
  generateMappingId,
  hasRegexCaptureGroup,
  normalizeSyntaxMappingConfig,
} from '@/engine/document-model';
import { aiService, type AiRegexRecognitionResult } from '@/services/AiService';
import { useAppStore } from '@/store';

const textMarkTypeLabels: Record<TextMarkType, string> = {
  bold: '粗体',
  italic: '斜体',
  underline: '下划线',
  strike: '删除线',
  code: '行内代码',
  link: '链接',
  color: '文字颜色',
};

const textMarkTypeOptions: Array<{ value: TextMarkType; label: string }> = [
  { value: 'bold', label: '粗体 (Bold)' },
  { value: 'italic', label: '斜体 (Italic)' },
  { value: 'underline', label: '下划线 (Underline)' },
  { value: 'strike', label: '删除线 (Strike)' },
  { value: 'code', label: '行内代码 (Code)' },
  { value: 'link', label: '链接 (Link)' },
];

/**
 * 映射项属性
 */
interface MappingItemProps<T> {
  mapping: T;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}

/**
 * 文本标记映射项组件
 */
function TextMarkMappingItem({ mapping, onToggle, onDelete }: MappingItemProps<TextMarkMapping>) {
  return (
    <div className="mapping-item">
      <label className="mapping-item-header">
        <input
          type="checkbox"
          checked={mapping.enabled}
          onChange={(e) => onToggle(mapping.id, e.target.checked)}
          className="mapping-item-toggle"
        />
        <span className="mapping-item-name">{mapping.name}</span>
        <span className={`mapping-item-badge mapping-item-badge-${mapping.markType}`}>
          {mapping.markType}
        </span>
      </label>
      <div className="mapping-item-details">
        <code className="mapping-item-pattern">{mapping.pattern}</code>
      </div>
      {mapping.description && (
        <div className="mapping-item-description">{mapping.description}</div>
      )}
      <button
        type="button"
        className="mapping-item-delete"
        onClick={() => onDelete(mapping.id)}
        title="删除此映射"
      >
        删除
      </button>
    </div>
  );
}

/**
 * 块级指令映射项组件
 */
function BlockCommandMappingItem({ mapping, onToggle, onDelete }: MappingItemProps<BlockCommandMapping>) {
  return (
    <div className="mapping-item">
      <label className="mapping-item-header">
        <input
          type="checkbox"
          checked={mapping.enabled}
          onChange={(e) => onToggle(mapping.id, e.target.checked)}
          className="mapping-item-toggle"
        />
        <span className="mapping-item-name">{mapping.name}</span>
        <span className="mapping-item-badge mapping-item-badge-block">
          {mapping.targetBlockType}
        </span>
      </label>
      <div className="mapping-item-details">
        <code className="mapping-item-pattern">{mapping.command}</code>
      </div>
      {mapping.description && (
        <div className="mapping-item-description">{mapping.description}</div>
      )}
      <button
        type="button"
        className="mapping-item-delete"
        onClick={() => onDelete(mapping.id)}
        title="删除此映射"
      >
        删除
      </button>
    </div>
  );
}

/**
 * 文本标记映射表单（用于添加新映射）
 */
function TextMarkMappingForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (mapping: Omit<TextMarkMapping, 'id'>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');
  const [markType, setMarkType] = useState<TextMarkType>('bold');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('请输入映射名称');
      return;
    }
    if (!pattern.trim()) {
      setError('请输入正则表达式');
      return;
    }

    try {
      new RegExp(pattern);
    } catch {
      setError('正则表达式无效');
      return;
    }

    if (!hasRegexCaptureGroup(pattern.trim())) {
      setError('正则表达式必须包含至少一个捕获组，用来提取被标记的文本');
      return;
    }

    onSubmit({
      name: name.trim(),
      pattern: pattern.trim(),
      markType,
      enabled: true,
      description: description.trim() || undefined,
    });
  };

  return (
    <form className="mapping-form" onSubmit={handleSubmit}>
      <div className="mapping-form-title">添加文本标记映射</div>

      <div className="mapping-form-field">
        <label className="mapping-form-label">映射名称 *</label>
        <input
          type="text"
          className="mapping-form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：我的自定义粗体"
        />
      </div>

      <div className="mapping-form-field">
        <label className="mapping-form-label">正则表达式 *</label>
        <input
          type="text"
          className="mapping-form-input"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="例如：\*\*\*(.+?)\*\*\*"
        />
        <span className="mapping-form-hint">必须包含一个捕获组 `(.+?)` 来匹配文本内容</span>
      </div>

      <div className="mapping-form-field">
        <label className="mapping-form-label">映射类型 *</label>
        <select
          className="mapping-form-select"
          value={markType}
          onChange={(e) => setMarkType(e.target.value as TextMarkType)}
        >
          {textMarkTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mapping-form-field">
        <label className="mapping-form-label">描述</label>
        <input
          type="text"
          className="mapping-form-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="可选的描述信息"
        />
      </div>

      {error && <div className="mapping-form-error">{error}</div>}

      <div className="mapping-form-actions">
        <button type="button" className="mapping-form-btn mapping-form-btn-cancel" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="mapping-form-btn mapping-form-btn-submit">
          添加
        </button>
      </div>
    </form>
  );
}

/**
 * 块级指令映射表单（用于添加新映射）
 */
function BlockCommandMappingForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (mapping: Omit<BlockCommandMapping, 'id'>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [targetBlockType, setTargetBlockType] = useState<BlockCommandMapping['targetBlockType']>('blockquote');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('请输入映射名称');
      return;
    }
    if (!command.trim()) {
      setError('请输入块级指令');
      return;
    }

    onSubmit({
      name: name.trim(),
      command: command.trim(),
      targetBlockType,
      enabled: true,
      description: description.trim() || undefined,
    });
  };

  return (
    <form className="mapping-form" onSubmit={handleSubmit}>
      <div className="mapping-form-title">添加块级指令映射</div>

      <div className="mapping-form-field">
        <label className="mapping-form-label">映射名称 *</label>
        <input
          type="text"
          className="mapping-form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：我的自定义块"
        />
      </div>

      <div className="mapping-form-field">
        <label className="mapping-form-label">块级指令 *</label>
        <input
          type="text"
          className="mapping-form-input"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="例如：:::myblock"
        />
        <span className="mapping-form-hint">输入块级指令的前缀，如 `:::note`</span>
      </div>

      <div className="mapping-form-field">
        <label className="mapping-form-label">目标块类型 *</label>
        <select
          className="mapping-form-select"
          value={targetBlockType}
          onChange={(e) => setTargetBlockType(e.target.value as BlockCommandMapping['targetBlockType'])}
        >
          <option value="blockquote">引用块 (Blockquote)</option>
          <option value="code">代码块 (Code Block)</option>
          <option value="paragraph">段落 (Paragraph)</option>
        </select>
      </div>

      <div className="mapping-form-field">
        <label className="mapping-form-label">描述</label>
        <input
          type="text"
          className="mapping-form-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="可选的描述信息"
        />
      </div>

      {error && <div className="mapping-form-error">{error}</div>}

      <div className="mapping-form-actions">
        <button type="button" className="mapping-form-btn mapping-form-btn-cancel" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="mapping-form-btn mapping-form-btn-submit">
          添加
        </button>
      </div>
    </form>
  );
}

/**
 * AI 正则识别表单
 *
 * 用户只需要给出一段示例语法，AI 返回的规则会先显示为候选，
 * 点击“采用此规则”后才会真正写入语法映射配置。
 */
function AiRegexRecognitionForm({
  onApply,
}: {
  onApply: (mapping: Omit<TextMarkMapping, 'id'>) => void;
}) {
  const regexAiConfig = useAppStore((state) => state.getAiConfigForTask('regexRecognition'));
  const isRegexAiConfigured = regexAiConfig !== null;
  const [sample, setSample] = useState('');
  const [markType, setMarkType] = useState<TextMarkType>('underline');
  const [candidate, setCandidate] = useState<AiRegexRecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecognizing, setIsRecognizing] = useState(false);

  const handleSampleChange = (value: string) => {
    setSample(value);
    setCandidate(null);
    setError(null);
  };

  const handleMarkTypeChange = (value: TextMarkType) => {
    setMarkType(value);
    setCandidate(null);
    setError(null);
  };

  const handleRecognize = async () => {
    if (!regexAiConfig) {
      setError('请先在「AI助手-设置」中为「AI 正则识别」分配可用 AI 配置');
      return;
    }

    if (!sample.trim()) {
      setError('请输入需要识别的示例语法');
      return;
    }

    try {
      setIsRecognizing(true);
      setError(null);
      setCandidate(null);
      // 语法识别单独读取任务分配，方便用户用更擅长规则生成的模型。
      aiService.configure(regexAiConfig);
      const result = await aiService.recognizeTextMarkRegex({
        sample: sample.trim(),
        markType,
      });
      setCandidate(result);
    } catch (recognizeError) {
      setError(recognizeError instanceof Error ? recognizeError.message : 'AI 识别失败');
    } finally {
      setIsRecognizing(false);
    }
  };

  const handleApply = () => {
    if (!candidate) {
      return;
    }

    onApply(candidate);
    setSample('');
    setCandidate(null);
    setError(null);
  };

  return (
    <div className="mapping-ai-recognizer">
      <div className="mapping-ai-header">
        <div>
          <strong>AI 识别正则</strong>
          <span>输入示例，生成文本标记映射规则</span>
        </div>
      </div>

      <div className="mapping-form-field">
        <label className="mapping-form-label">示例语法 *</label>
        <textarea
          className="mapping-form-input mapping-ai-textarea"
          value={sample}
          onChange={(event) => handleSampleChange(event.target.value)}
          placeholder="例如：==重点内容== 或 \\mybold{重点内容}"
          disabled={isRecognizing}
          rows={3}
        />
      </div>

      <div className="mapping-form-field">
        <label className="mapping-form-label">目标样式 *</label>
        <select
          className="mapping-form-select"
          value={markType}
          onChange={(event) => handleMarkTypeChange(event.target.value as TextMarkType)}
          disabled={isRecognizing}
        >
          {textMarkTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error ? <div className="mapping-form-error">{error}</div> : null}
      {!isRegexAiConfigured ? (
        <div className="mapping-form-hint">AI 正则识别未分配可用配置，暂不能使用自动识别。</div>
      ) : null}

      <div className="mapping-ai-actions">
        <button
          type="button"
          className="mapping-form-btn mapping-form-btn-submit"
          onClick={handleRecognize}
          disabled={isRecognizing || !isRegexAiConfigured}
          title={isRegexAiConfigured ? '让 AI 根据示例生成正则' : '请先分配 AI 正则识别配置'}
        >
          {isRecognizing ? '识别中...' : 'AI 识别正则'}
        </button>
      </div>

      {candidate ? (
        <div className="mapping-ai-candidate">
          <div className="mapping-ai-candidate-head">
            <strong>{candidate.name}</strong>
            <span>{textMarkTypeLabels[candidate.markType]}</span>
          </div>
          <code className="mapping-item-pattern">{candidate.pattern}</code>
          {candidate.description ? <p>{candidate.description}</p> : null}
          <button
            type="button"
            className="mapping-form-btn mapping-form-btn-submit"
            onClick={handleApply}
          >
            采用此规则
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 语法映射配置面板属性
 */
export interface SyntaxMappingPanelProps {
  /** 当前配置（可选，默认使用默认配置） */
  config?: SyntaxMappingConfig;
  /** 配置变更回调 */
  onChange?: (config: SyntaxMappingConfig) => void;
}

/**
 * 语法映射配置面板组件
 */
export function SyntaxMappingPanel({ config, onChange }: SyntaxMappingPanelProps) {
  const initialConfig = normalizeSyntaxMappingConfig(config);
  const [textMarkMappings, setTextMarkMappings] = useState<TextMarkMapping[]>(initialConfig.textMarkMappings);
  const [blockCommandMappings, setBlockCommandMappings] = useState<BlockCommandMapping[]>(
    initialConfig.blockCommandMappings,
  );

  // 添加表单展开状态
  const [showTextMarkForm, setShowTextMarkForm] = useState(false);
  const [showBlockCommandForm, setShowBlockCommandForm] = useState(false);

  useEffect(() => {
    const nextConfig = normalizeSyntaxMappingConfig(config);
    setTextMarkMappings(nextConfig.textMarkMappings);
    setBlockCommandMappings(nextConfig.blockCommandMappings);
  }, [config]);

  // 通知配置变更时必须传入“刚计算出的新数组”，避免 React 状态异步导致写回旧配置。
  const emitChange = useCallback((nextTextMarkMappings: TextMarkMapping[], nextBlockCommandMappings: BlockCommandMapping[]) => {
    if (onChange) {
      onChange({
        version: '1.0.0',
        textMarkMappings: nextTextMarkMappings,
        blockCommandMappings: nextBlockCommandMappings,
      });
    }
  }, [onChange]);

  // 处理文本标记映射启用/禁用切换
  const handleTextMarkToggle = useCallback(
    (id: string, enabled: boolean) => {
      const nextTextMarkMappings = textMarkMappings.map((m) => (m.id === id ? { ...m, enabled } : m));
      setTextMarkMappings(nextTextMarkMappings);
      emitChange(nextTextMarkMappings, blockCommandMappings);
    },
    [blockCommandMappings, emitChange, textMarkMappings],
  );

  // 处理块级指令映射启用/禁用切换
  const handleBlockCommandToggle = useCallback(
    (id: string, enabled: boolean) => {
      const nextBlockCommandMappings = blockCommandMappings.map((m) => (m.id === id ? { ...m, enabled } : m));
      setBlockCommandMappings(nextBlockCommandMappings);
      emitChange(textMarkMappings, nextBlockCommandMappings);
    },
    [blockCommandMappings, emitChange, textMarkMappings],
  );

  // 处理删除文本标记映射
  const handleDeleteTextMark = useCallback(
    (id: string) => {
      const nextTextMarkMappings = textMarkMappings.filter((m) => m.id !== id);
      setTextMarkMappings(nextTextMarkMappings);
      emitChange(nextTextMarkMappings, blockCommandMappings);
    },
    [blockCommandMappings, emitChange, textMarkMappings],
  );

  // 处理删除块级指令映射
  const handleDeleteBlockCommand = useCallback(
    (id: string) => {
      const nextBlockCommandMappings = blockCommandMappings.filter((m) => m.id !== id);
      setBlockCommandMappings(nextBlockCommandMappings);
      emitChange(textMarkMappings, nextBlockCommandMappings);
    },
    [blockCommandMappings, emitChange, textMarkMappings],
  );

  // 处理添加文本标记映射
  const handleAddTextMark = useCallback(
    (mapping: Omit<TextMarkMapping, 'id'>) => {
      const newMapping: TextMarkMapping = {
        ...mapping,
        id: generateMappingId('textmark'),
      };
      const nextTextMarkMappings = [...textMarkMappings, newMapping];
      setTextMarkMappings(nextTextMarkMappings);
      setShowTextMarkForm(false);
      emitChange(nextTextMarkMappings, blockCommandMappings);
    },
    [blockCommandMappings, emitChange, textMarkMappings],
  );

  // 处理添加块级指令映射
  const handleAddBlockCommand = useCallback(
    (mapping: Omit<BlockCommandMapping, 'id'>) => {
      const newMapping: BlockCommandMapping = {
        ...mapping,
        id: generateMappingId('blockcmd'),
      };
      const nextBlockCommandMappings = [...blockCommandMappings, newMapping];
      setBlockCommandMappings(nextBlockCommandMappings);
      setShowBlockCommandForm(false);
      emitChange(textMarkMappings, nextBlockCommandMappings);
    },
    [blockCommandMappings, emitChange, textMarkMappings],
  );

  // 重置为默认配置
  const handleReset = useCallback(() => {
    const defaultConfig = getDefaultSyntaxMappingConfig();
    setTextMarkMappings(defaultConfig.textMarkMappings);
    setBlockCommandMappings(defaultConfig.blockCommandMappings);
    setShowTextMarkForm(false);
    setShowBlockCommandForm(false);
    emitChange(defaultConfig.textMarkMappings, defaultConfig.blockCommandMappings);
  }, [emitChange]);

  // 获取启用的映射数量
  const enabledTextMarkCount = textMarkMappings.filter((m) => m.enabled).length;
  const enabledBlockCommandCount = blockCommandMappings.filter((m) => m.enabled).length;

  return (
    <div className="syntax-mapping-panel">
      <div className="syntax-mapping-header">
        <h3>语法映射配置</h3>
        <button type="button" className="syntax-mapping-reset" onClick={handleReset}>
          重置为默认
        </button>
      </div>

      <div className="syntax-mapping-description">
        <p>
          配置文本标记语法映射和块级指令映射。启用后，在导入 Markdown 时会自动将相应的语法转换为标准格式。
        </p>
      </div>

      {/* 文本标记映射 */}
      <section className="syntax-mapping-section">
        <h4>
          文本标记映射
          <span className="syntax-mapping-count">
            {enabledTextMarkCount}/{textMarkMappings.length} 已启用
          </span>
        </h4>
        <p className="syntax-mapping-section-description">
          将自定义文本语法（如 LaTeX 命令）映射为标准文本样式（加粗、斜体、下划线等）
        </p>

        <AiRegexRecognitionForm onApply={handleAddTextMark} />

        {/* 添加表单 */}
        {showTextMarkForm ? (
          <TextMarkMappingForm
            onSubmit={handleAddTextMark}
            onCancel={() => setShowTextMarkForm(false)}
          />
        ) : (
          <button
            type="button"
            className="syntax-mapping-add-btn"
            onClick={() => setShowTextMarkForm(true)}
          >
            + 添加文本标记映射
          </button>
        )}

        <div className="mapping-list">
          {textMarkMappings.map((mapping) => (
            <TextMarkMappingItem
              key={mapping.id}
              mapping={mapping}
              onToggle={handleTextMarkToggle}
              onDelete={handleDeleteTextMark}
            />
          ))}
        </div>
      </section>

      {/* 块级指令映射 */}
      <section className="syntax-mapping-section">
        <h4>
          块级指令映射
          <span className="syntax-mapping-count">
            {enabledBlockCommandCount}/{blockCommandMappings.length} 已启用
          </span>
        </h4>
        <p className="syntax-mapping-section-description">
          将自定义块级指令（如 Obsidian callout）映射为标准块类型（引用、代码块等）
        </p>

        {/* 添加表单 */}
        {showBlockCommandForm ? (
          <BlockCommandMappingForm
            onSubmit={handleAddBlockCommand}
            onCancel={() => setShowBlockCommandForm(false)}
          />
        ) : (
          <button
            type="button"
            className="syntax-mapping-add-btn"
            onClick={() => setShowBlockCommandForm(true)}
          >
            + 添加块级指令映射
          </button>
        )}

        <div className="mapping-list">
          {blockCommandMappings.map((mapping) => (
            <BlockCommandMappingItem
              key={mapping.id}
              mapping={mapping}
              onToggle={handleBlockCommandToggle}
              onDelete={handleDeleteBlockCommand}
            />
          ))}
        </div>
      </section>

      {/* 提示信息 */}
      <div className="syntax-mapping-tip">
        <strong>提示：</strong>
        配置变更后，下次导入 Markdown 时生效，不影响当前已打开的文档。
      </div>
    </div>
  );
}

export default SyntaxMappingPanel;
