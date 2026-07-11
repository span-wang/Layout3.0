import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  FileText,
  FileUp,
  LoaderCircle,
  Play,
  Plus,
  Save,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { listKnowledgeIngestionRagflowDatasetOptions } from '@/services/KnowledgeIngestionService';
import { useAppStore } from '@/store';
import type {
  KnowledgeIngestionCurrentStage,
  KnowledgeIngestionIndexPublicationStatus,
  KnowledgeIngestionItem,
  KnowledgeIngestionItemStatus,
  KnowledgeIngestionJobStatus,
  KnowledgeIngestionMetadata,
  KnowledgeIngestionRagflowDatasetOption,
  KnowledgeIngestionProcessingHealth,
  KnowledgeIngestionQualityQuestionInput,
  KnowledgeIngestionQualityStatus,
  KnowledgeIngestionWorkflowStatus,
} from '@/types/knowledgeIngestion';

interface KnowledgeIngestionWorkspaceProps {
  onClose: () => void;
}

const statusLabels: Record<KnowledgeIngestionItemStatus, string> = {
  pending_confirmation: '待确认',
  processing: '处理中',
  duplicate: '完全重复',
};

const workflowStatusLabels: Record<KnowledgeIngestionWorkflowStatus, string> = {
  pending_identification: '待识别',
  pending_confirmation: '待确认',
  processing: '处理中',
  quality_check: '质量检查',
  pending_publication: '待发布',
  published: '已发布',
  superseded: '已替代',
  quarantined: '已隔离',
  archived: '已归档',
};

const processingHealthLabels: Record<KnowledgeIngestionProcessingHealth, string> = {
  pending: '待处理',
  processing: '处理中',
  healthy: '健康',
  degraded: '降级',
  failed: '失败',
};

const indexPublicationStatusLabels: Record<KnowledgeIngestionIndexPublicationStatus, string> = {
  pending: '暂存待发布',
  active: '已生效',
  superseded: '已替代',
  archived: '已归档',
};

const currentStageLabels: Record<KnowledgeIngestionCurrentStage, string> = {
  extraction: '正文抽取',
  upload: '上传暂存索引',
  parse_wait: '等待 RAGFlow 解析',
  quality_check: '等待质量检查',
};

const jobStatusLabels: Record<KnowledgeIngestionJobStatus, string> = {
  queued: '排队中',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  cancel_requested: '正在取消',
  cancelled: '已取消',
};

const qualityStatusLabels: Record<KnowledgeIngestionQualityStatus, string> = {
  not_started: '尚未开始',
  queued: '排队中',
  running: '检查中',
  passed: '已通过',
  blocked: '已阻断',
  failed: '运行失败',
  cancelled: '已取消',
  expired: '已过期',
};

const emptyMetadata: KnowledgeIngestionMetadata = {
  stableTitle: '',
  domain: '教育',
  subject: '',
  materialType: '讲义',
  language: '中文',
  educationStage: '',
  grade: '',
  semester: '',
  edition: '',
  unit: '',
  parserProfile: 'education-textbook-v1',
};

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function createDefaultQualityQuestions(
  item: KnowledgeIngestionItem,
): KnowledgeIngestionQualityQuestionInput[] {
  const title = item.metadata.stableTitle.trim() || item.fileName;
  const scope = item.metadata.unit.trim()
    || item.metadata.subject.trim()
    || item.metadata.materialType.trim()
    || '主要内容';
  return [
    { question: `《${title}》的核心主题是什么？`, evidence: '' },
    { question: `《${title}》中关于“${scope}”的关键知识点有哪些？`, evidence: '' },
    { question: `根据《${title}》，理解“${scope}”时需要注意什么？`, evidence: '' },
  ];
}

function getQualityQuestionsValidation(
  questions: KnowledgeIngestionQualityQuestionInput[],
): string | null {
  if (questions.length < 3 || questions.length > 5) {
    return '冒烟问题必须保持 3 至 5 条。';
  }
  const emptyQuestionIndex = questions.findIndex((item) => !item.question.trim());
  if (emptyQuestionIndex >= 0) {
    return `第 ${emptyQuestionIndex + 1} 条问题不能为空。`;
  }
  const emptyEvidenceIndex = questions.findIndex((item) => !item.evidence.trim());
  if (emptyEvidenceIndex >= 0) {
    return `第 ${emptyEvidenceIndex + 1} 条来源证据不能为空。`;
  }
  return null;
}

function canPrepareQualityCheck(item: KnowledgeIngestionItem): boolean {
  return !item.isDuplicate
    && item.lifecycle.workflowStatus === 'quality_check'
    && item.lifecycle.processingHealth === 'healthy'
    && item.lifecycle.indexPublicationStatus === 'pending';
}

function getQualityOutcomeMessage(item: KnowledgeIngestionItem): string {
  switch (item.lifecycle.qualitySummary.status) {
    case 'queued':
      return '质量检查已排队，正在等待安全候选检索。';
    case 'running':
      return '正在执行阻断项、候选命中和正式通道零泄漏检查。';
    case 'passed':
      return '质量门禁已通过，资料当前为待发布。';
    case 'blocked':
      return '存在阻断项，资料没有进入待发布。';
    case 'failed':
      return '质量检查运行失败，尚未形成通过结论。';
    case 'cancelled':
      return '本次质量检查已取消，资料没有进入待发布。';
    case 'expired':
      return '本次质量运行已过期，需要重新发起检查。';
    default:
      return '尚未开始质量检查。';
  }
}

function getPrimaryStatus(item: KnowledgeIngestionItem): string {
  return item.isDuplicate
    ? statusLabels.duplicate
    : workflowStatusLabels[item.lifecycle.workflowStatus];
}

function getCurrentStageText(item: KnowledgeIngestionItem): string {
  if (item.isDuplicate) return '完全重复，已跳过处理';
  const { qualitySummary } = item.lifecycle;
  if (qualitySummary.status !== 'not_started') {
    return `质量门禁 · ${qualityStatusLabels[qualitySummary.status]}`;
  }
  const { currentStage, currentJobStatus, workflowStatus } = item.lifecycle;
  if (!currentStage) {
    return workflowStatus === 'pending_confirmation'
      ? '等待人工确认元数据'
      : workflowStatusLabels[workflowStatus];
  }
  const stageLabel = currentStageLabels[currentStage];
  if (currentJobStatus === 'failed' && item.lifecycle.autoRetryScheduled) {
    return `${stageLabel} · 等待自动重试`;
  }
  return currentJobStatus ? `${stageLabel} · ${jobStatusLabels[currentJobStatus]}` : stageLabel;
}

function getPrimaryStatusClass(item: KnowledgeIngestionItem): string {
  return item.isDuplicate ? 'duplicate' : item.lifecycle.workflowStatus;
}

export function KnowledgeIngestionWorkspace({
  onClose,
}: KnowledgeIngestionWorkspaceProps): JSX.Element {
  const runtime = useAppStore((state) => state.knowledgeIngestionRuntime);
  const ragflowConfig = useAppStore((state) => state.knowledgeIngestionRagflowConfig);
  const items = useAppStore((state) => state.knowledgeIngestionItems);
  const selectedItemId = useAppStore((state) => state.selectedKnowledgeIngestionItemId);
  const isLoading = useAppStore((state) => state.isKnowledgeIngestionLoading);
  const actionItemId = useAppStore((state) => state.knowledgeIngestionActionItemId);
  const error = useAppStore((state) => state.knowledgeIngestionError);
  const load = useAppStore((state) => state.loadKnowledgeIngestion);
  const refreshItems = useAppStore((state) => state.refreshKnowledgeIngestionItems);
  const selectItem = useAppStore((state) => state.selectKnowledgeIngestionItem);
  const receiveFile = useAppStore((state) => state.receiveKnowledgeIngestionFile);
  const confirmMetadata = useAppStore((state) => state.confirmKnowledgeIngestionItemMetadata);
  const saveRagflowConfig = useAppStore((state) => state.saveKnowledgeIngestionRagflowConfig);
  const cancelProcessing = useAppStore((state) => state.cancelKnowledgeIngestionItemProcessing);
  const retryProcessing = useAppStore((state) => state.retryKnowledgeIngestionItemProcessing);
  const startQualityCheck = useAppStore((state) => state.startKnowledgeIngestionItemQualityCheck);
  const [metadataDraft, setMetadataDraft] = useState<KnowledgeIngestionMetadata>(emptyMetadata);
  const [qualityQuestions, setQualityQuestions] = useState<KnowledgeIngestionQualityQuestionInput[]>([]);
  const [showRagflowConfig, setShowRagflowConfig] = useState(false);
  const [ragflowConfigDraft, setRagflowConfigDraft] = useState({
    baseUrl: 'http://127.0.0.1:9380',
    apiKey: '',
    stagingDatasetId: '',
    indexGeneration: 'staging-v1',
  });
  const [datasetOptions, setDatasetOptions] = useState<KnowledgeIngestionRagflowDatasetOption[]>([]);
  const [isLoadingDatasetOptions, setIsLoadingDatasetOptions] = useState(false);
  const [datasetOptionsError, setDatasetOptionsError] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.itemId === selectedItemId) ?? null,
    [items, selectedItemId],
  );
  const selectedQualitySummary = selectedItem?.lifecycle.qualitySummary ?? null;
  const canPrepareSelectedQualityCheck = selectedItem ? canPrepareQualityCheck(selectedItem) : false;
  const isSelectedQualityCheckActive = selectedQualitySummary?.status === 'queued'
    || selectedQualitySummary?.status === 'running';
  const selectedQualityHasProblem = selectedQualitySummary?.status === 'blocked'
    || selectedQualitySummary?.status === 'failed'
    || selectedQualitySummary?.status === 'expired';
  const selectedHasActiveJob = Boolean(selectedItem && (
    isSelectedQualityCheckActive
    || (selectedItem.lifecycle.currentJobStatus
      && ['queued', 'running', 'cancel_requested'].includes(selectedItem.lifecycle.currentJobStatus))
  ));
  const qualityQuestionsValidation = getQualityQuestionsValidation(qualityQuestions);
  const canStartSelectedQualityCheck = canPrepareSelectedQualityCheck
    && !isSelectedQualityCheckActive
    && qualityQuestionsValidation === null
    && actionItemId !== selectedItem?.itemId;
  const shouldShowQualityPanel = Boolean(selectedItem && !selectedItem.isDuplicate && (
    canPrepareSelectedQualityCheck
    || selectedQualitySummary?.status !== 'not_started'
    || selectedItem.lifecycle.workflowStatus === 'pending_publication'
  ));
  const pendingCount = items.filter((item) => (
    !item.isDuplicate && item.lifecycle.workflowStatus === 'pending_confirmation'
  )).length;
  const processingCount = items.filter((item) => (
    !item.isDuplicate && item.lifecycle.workflowStatus === 'processing'
  )).length;
  const qualityCheckCount = items.filter((item) => (
    !item.isDuplicate && item.lifecycle.workflowStatus === 'quality_check'
  )).length;
  const hasActiveC2Job = items.some((item) => (
    item.lifecycle.currentStage !== null
    && item.lifecycle.currentStage !== 'quality_check'
    && (
      item.lifecycle.currentJobStatus === 'queued'
      || item.lifecycle.currentJobStatus === 'running'
      || item.lifecycle.currentJobStatus === 'cancel_requested'
      || item.lifecycle.autoRetryScheduled
    )
  ));
  const hasActiveQualityCheck = items.some((item) => (
    item.lifecycle.qualitySummary.status === 'queued'
    || item.lifecycle.qualitySummary.status === 'running'
  ));

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasActiveC2Job && !hasActiveQualityCheck) return undefined;
    // 只在后台处理仍活跃时静默刷新，避免全局 loading 导致按钮和表单每两秒闪烁。
    const timer = window.setInterval(() => {
      void refreshItems();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [hasActiveC2Job, hasActiveQualityCheck, refreshItems]);

  useEffect(() => {
    // 静默轮询会替换列表对象，但不能覆盖用户正在填写的待确认元数据。
    setMetadataDraft(selectedItem ? { ...selectedItem.metadata } : { ...emptyMetadata });
  }, [selectedItem?.itemId]);

  useEffect(() => {
    // 进入质量检查阶段时按已确认元数据生成三条可编辑问题，轮询不会覆盖正在填写的证据。
    setQualityQuestions(selectedItem ? createDefaultQualityQuestions(selectedItem) : []);
  }, [selectedItem?.itemId, selectedItem?.lifecycle.workflowStatus]);

  useEffect(() => {
    if (!ragflowConfig) return;
    setRagflowConfigDraft({
      baseUrl: ragflowConfig.baseUrl,
      apiKey: '',
      stagingDatasetId: ragflowConfig.stagingDatasetId,
      indexGeneration: ragflowConfig.indexGeneration,
    });
    if (!ragflowConfig.configured) setShowRagflowConfig(true);
    setDatasetOptions([]);
    setDatasetOptionsError(null);
  }, [ragflowConfig]);

  const updateMetadata = (field: keyof KnowledgeIngestionMetadata, value: string) => {
    setMetadataDraft((current) => ({ ...current, [field]: value }));
  };

  const updateQualityQuestion = (
    index: number,
    field: keyof KnowledgeIngestionQualityQuestionInput,
    value: string,
  ) => {
    setQualityQuestions((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };

  const canConfirm = selectedItem?.status === 'pending_confirmation'
    && metadataDraft.stableTitle.trim().length > 0
    && metadataDraft.domain.trim().length > 0
    && metadataDraft.subject.trim().length > 0
    && metadataDraft.materialType.trim().length > 0
    && metadataDraft.language.trim().length > 0
    && metadataDraft.parserProfile.trim().length > 0;
  const canSaveRagflowConfig = ragflowConfigDraft.baseUrl.trim().length > 0
    && ragflowConfigDraft.stagingDatasetId.trim().length > 0
    && ragflowConfigDraft.indexGeneration.trim().length > 0
    && (ragflowConfig?.hasApiKey || ragflowConfigDraft.apiKey.trim().length > 0);
  const loadDatasetOptions = async () => {
    setIsLoadingDatasetOptions(true);
    setDatasetOptionsError(null);
    try {
      const options = await listKnowledgeIngestionRagflowDatasetOptions({
        baseUrl: ragflowConfigDraft.baseUrl,
        apiKey: ragflowConfigDraft.apiKey.trim() || undefined,
      });
      setDatasetOptions(options);
      setRagflowConfigDraft((current) => ({
        ...current,
        stagingDatasetId: options.some((option) => option.id === current.stagingDatasetId)
          ? current.stagingDatasetId
          : '',
      }));
    } catch (loadError) {
      setDatasetOptions([]);
      setDatasetOptionsError(loadError instanceof Error ? loadError.message : '读取数据集失败，请稍后重试。');
    } finally {
      setIsLoadingDatasetOptions(false);
    }
  };

  return (
    <div className="knowledge-ingestion-workspace">
      <header className="knowledge-ingestion-header">
        <div className="knowledge-ingestion-title-group">
          <button
            type="button"
            className="knowledge-ingestion-icon-button"
            title="返回排版工作台"
            aria-label="返回排版工作台"
            onClick={onClose}
          >
            <ArrowLeft size={19} />
          </button>
          <div className="knowledge-ingestion-mark" aria-hidden="true">
            <Database size={18} />
          </div>
          <div>
            <h1>资料入库中心</h1>
            <p>{runtime?.message ?? '正在连接资料登记库'}</p>
          </div>
        </div>
        <div className="knowledge-ingestion-header-actions">
          <button
            type="button"
            className={showRagflowConfig
              ? 'knowledge-ingestion-icon-button active'
              : 'knowledge-ingestion-icon-button'}
            title="入库连接设置"
            aria-label="入库连接设置"
            onClick={() => setShowRagflowConfig((visible) => !visible)}
          >
            <Settings2 size={18} />
          </button>
          <button
            type="button"
            className="knowledge-ingestion-icon-button"
            title="刷新资料列表"
            aria-label="刷新资料列表"
            disabled={isLoading}
            onClick={() => void load()}
          >
            <RefreshCw size={18} className={isLoading ? 'is-spinning' : ''} />
          </button>
          <button
            type="button"
            className="knowledge-ingestion-primary-button"
            disabled={isLoading || runtime?.state === 'unavailable'}
            onClick={() => void receiveFile()}
          >
            {isLoading ? <LoaderCircle size={17} className="is-spinning" /> : <FileUp size={17} />}
            <span>接收单个文件</span>
          </button>
        </div>
      </header>

      {error ? (
        <div className="knowledge-ingestion-error" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
        </div>
      ) : null}

      {showRagflowConfig ? (
        <form
          className="knowledge-ingestion-config-bar"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSaveRagflowConfig) {
              void saveRagflowConfig({
                ...ragflowConfigDraft,
                apiKey: ragflowConfigDraft.apiKey.trim() || undefined,
              });
            }
          }}
        >
          <div className="knowledge-ingestion-config-state">
            <ShieldCheck size={18} />
            <span>{ragflowConfig?.configured ? 'Main 安全配置已保存' : '待配置暂存索引'}</span>
          </div>
          <label className="knowledge-ingestion-config-field config-url">
            <span>RAGFlow 地址</span>
            <input
              value={ragflowConfigDraft.baseUrl}
              onChange={(event) => setRagflowConfigDraft((current) => ({
                ...current,
                baseUrl: event.target.value,
              }))}
            />
          </label>
          <label className="knowledge-ingestion-config-field">
            <span>API Key</span>
            <input
              type="password"
              value={ragflowConfigDraft.apiKey}
              placeholder={ragflowConfig?.hasApiKey ? '留空保留现有密钥' : '请输入入库密钥'}
              onChange={(event) => setRagflowConfigDraft((current) => ({
                ...current,
                apiKey: event.target.value,
              }))}
            />
          </label>
          <label className="knowledge-ingestion-config-field">
            <span>暂存数据集</span>
            <select
              value={ragflowConfigDraft.stagingDatasetId}
              disabled={datasetOptions.length === 0 || isLoadingDatasetOptions}
              onChange={(event) => setRagflowConfigDraft((current) => ({
                ...current,
                stagingDatasetId: event.target.value,
              }))}
            >
              <option value="">{isLoadingDatasetOptions ? '正在获取数据集...' : '请先获取并选择数据集'}</option>
              {datasetOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="knowledge-ingestion-secondary-button"
            disabled={isLoadingDatasetOptions || !ragflowConfigDraft.baseUrl.trim()
              || (!ragflowConfig?.hasApiKey && !ragflowConfigDraft.apiKey.trim())}
            onClick={() => void loadDatasetOptions()}
          >
            {isLoadingDatasetOptions ? <LoaderCircle size={15} className="is-spinning" /> : <RefreshCw size={15} />}
            <span>获取数据集</span>
          </button>
          <label className="knowledge-ingestion-config-field config-generation">
            <span>索引代次</span>
            <input
              value={ragflowConfigDraft.indexGeneration}
              onChange={(event) => setRagflowConfigDraft((current) => ({
                ...current,
                indexGeneration: event.target.value,
              }))}
            />
          </label>
          <button
            type="submit"
            className="knowledge-ingestion-primary-button"
            disabled={!canSaveRagflowConfig || isLoading}
          >
            <Save size={16} />
            <span>保存配置</span>
          </button>
          {datasetOptionsError ? <span className="knowledge-ingestion-config-hint" role="alert">{datasetOptionsError}</span> : null}
        </form>
      ) : null}

      <main className="knowledge-ingestion-main">
        <aside className="knowledge-ingestion-list-pane" aria-label="资料接收列表">
          <div className="knowledge-ingestion-summary">
            <div><strong>{pendingCount}</strong><span>待确认</span></div>
            <div><strong>{processingCount}</strong><span>处理中</span></div>
            <div><strong>{qualityCheckCount}</strong><span>质量检查</span></div>
          </div>
          <div className="knowledge-ingestion-list-heading">
            <strong>最近接收</strong>
            <span>{items.length} 项</span>
          </div>
          <div className="knowledge-ingestion-list">
            {items.length === 0 ? (
              <div className="knowledge-ingestion-empty">
                <FileText size={24} />
                <span>暂无接收记录</span>
              </div>
            ) : items.map((item) => (
              <button
                type="button"
                key={item.itemId}
                className={item.itemId === selectedItemId
                  ? 'knowledge-ingestion-list-item active'
                  : 'knowledge-ingestion-list-item'}
                onClick={() => selectItem(item.itemId)}
              >
                <span className={`knowledge-ingestion-status-dot status-${getPrimaryStatusClass(item)}`} />
                <span className="knowledge-ingestion-list-item-main">
                  <strong title={item.fileName}>{item.fileName}</strong>
                  <small title={getCurrentStageText(item)}>
                    {formatFileSize(item.sizeBytes)} · {getCurrentStageText(item)} · {formatDate(item.createdAt)}
                  </small>
                </span>
                <span className={`knowledge-ingestion-status status-${getPrimaryStatusClass(item)}`}>
                  {getPrimaryStatus(item)}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="knowledge-ingestion-detail" aria-label="资料详情">
          {!selectedItem ? (
            <div className="knowledge-ingestion-detail-empty">
              <Database size={30} />
              <strong>等待接收资料</strong>
            </div>
          ) : (
            <>
              <div className="knowledge-ingestion-detail-header">
                <div>
                  <span className={`knowledge-ingestion-status status-${getPrimaryStatusClass(selectedItem)}`}>
                    {getPrimaryStatus(selectedItem)}
                  </span>
                  <h2>{selectedItem.fileName}</h2>
                  <p>
                    {selectedItem.extension.toUpperCase()} · {formatFileSize(selectedItem.sizeBytes)} ·
                    哈希 {selectedItem.contentHash.slice(0, 12)}
                  </p>
                </div>
                {selectedItem.lifecycle.errorMessage || selectedQualityHasProblem
                  ? <AlertCircle size={24} className="knowledge-ingestion-error-icon" />
                  : null}
                {!selectedItem.isDuplicate
                  && !selectedItem.lifecycle.errorMessage
                  && !selectedQualityHasProblem
                  && selectedHasActiveJob
                  ? <LoaderCircle size={24} className="is-spinning" />
                  : null}
                {!selectedItem.isDuplicate
                  && !selectedItem.lifecycle.errorMessage
                  && !selectedQualityHasProblem
                  && !selectedHasActiveJob
                  && (selectedQualitySummary?.status === 'passed'
                    || selectedItem.lifecycle.workflowStatus === 'pending_publication')
                  ? <CheckCircle2 size={24} />
                  : null}
                {!selectedItem.isDuplicate
                  && !selectedItem.lifecycle.errorMessage
                  && !selectedQualityHasProblem
                  && !selectedHasActiveJob
                  && selectedItem.lifecycle.workflowStatus === 'quality_check'
                  ? <ShieldCheck size={24} />
                  : null}
                {!selectedItem.isDuplicate
                  && !selectedItem.lifecycle.errorMessage
                  && selectedItem.lifecycle.workflowStatus === 'pending_confirmation'
                  ? <Clock3 size={24} />
                  : null}
                {selectedItem.isDuplicate ? <Copy size={24} /> : null}
              </div>

              {!selectedItem.isDuplicate ? (
                <section className="knowledge-ingestion-processing-panel" aria-label="处理状态">
                  <div className="knowledge-ingestion-section-title">
                    <div>
                      <h3>处理状态</h3>
                      <span aria-live="polite">{getCurrentStageText(selectedItem)}</span>
                    </div>
                  </div>
                  <div className="knowledge-ingestion-lifecycle-grid">
                    <div>
                      <span>当前阶段</span>
                      <strong>{getCurrentStageText(selectedItem)}</strong>
                    </div>
                    <div>
                      <span>工作流状态</span>
                      <strong>{workflowStatusLabels[selectedItem.lifecycle.workflowStatus]}</strong>
                    </div>
                    <div>
                      <span>处理健康</span>
                      <strong>{processingHealthLabels[selectedItem.lifecycle.processingHealth]}</strong>
                    </div>
                    <div>
                      <span>索引发布</span>
                      <strong>{indexPublicationStatusLabels[selectedItem.lifecycle.indexPublicationStatus]}</strong>
                    </div>
                    <div>
                      <span>切片数</span>
                      <strong>
                        {selectedItem.lifecycle.chunkCount === null
                          ? '尚未生成'
                          : `${selectedItem.lifecycle.chunkCount} 个`}
                      </strong>
                    </div>
                  </div>
                  {selectedItem.lifecycle.errorMessage ? (
                    <div className="knowledge-ingestion-processing-error" role="alert">
                      <AlertCircle size={17} />
                      <div>
                        <strong>处理未完成</strong>
                        <span>{selectedItem.lifecycle.errorMessage}</span>
                      </div>
                    </div>
                  ) : null}
                  {selectedItem.lifecycle.canCancel || selectedItem.lifecycle.canRetry ? (
                    <div className="knowledge-ingestion-processing-actions">
                      {selectedItem.lifecycle.canCancel ? (
                        <button
                          type="button"
                          className="knowledge-ingestion-danger-button"
                          disabled={actionItemId === selectedItem.itemId}
                          onClick={() => void cancelProcessing({ itemId: selectedItem.itemId })}
                        >
                          <X size={16} />
                          <span>{isSelectedQualityCheckActive ? '取消质量检查' : '取消处理'}</span>
                        </button>
                      ) : null}
                      {selectedItem.lifecycle.canRetry ? (
                        <button
                          type="button"
                          className="knowledge-ingestion-secondary-button"
                          disabled={actionItemId === selectedItem.itemId}
                          onClick={() => void retryProcessing({ itemId: selectedItem.itemId })}
                        >
                          <RefreshCw
                            size={16}
                            className={actionItemId === selectedItem.itemId ? 'is-spinning' : ''}
                          />
                          <span>人工重试</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {shouldShowQualityPanel && selectedQualitySummary ? (
                <section
                  className={`knowledge-ingestion-quality-panel quality-status-${selectedQualitySummary.status}`}
                  aria-label="质量门禁"
                >
                  <div className="knowledge-ingestion-section-title">
                    <div>
                      <h3>质量门禁</h3>
                      <span>候选检索与正式通道零泄漏双检</span>
                    </div>
                    <span className={`knowledge-ingestion-quality-status status-${selectedQualitySummary.status}`}>
                      {qualityStatusLabels[selectedQualitySummary.status]}
                    </span>
                  </div>

                  {canPrepareSelectedQualityCheck ? (
                    <>
                      <div className="knowledge-ingestion-quality-guidance">
                        <ShieldCheck size={18} />
                        <div>
                          <strong>问题与证据由你确认后再提交</strong>
                          <span>请保留 3 至 5 条资料内问题，并为每条问题填写可核对的标题、段落或表格证据。</span>
                        </div>
                      </div>
                      <form
                        className="knowledge-ingestion-quality-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!canStartSelectedQualityCheck || !selectedItem) return;
                          void startQualityCheck({
                            itemId: selectedItem.itemId,
                            questions: qualityQuestions.map((item) => ({
                              question: item.question.trim(),
                              evidence: item.evidence.trim(),
                            })),
                          });
                        }}
                      >
                      <div className="knowledge-ingestion-quality-question-toolbar">
                        <span>冒烟问题</span>
                        <strong>{qualityQuestions.length} / 5</strong>
                      </div>
                      <div className="knowledge-ingestion-quality-question-list">
                        {qualityQuestions.map((item, index) => (
                          <article className="knowledge-ingestion-quality-question" key={`quality-question-${index + 1}`}>
                            <div className="knowledge-ingestion-quality-question-header">
                              <strong>问题 {index + 1}</strong>
                              <button
                                type="button"
                                className="knowledge-ingestion-quality-remove-button"
                                title="删除这条问题"
                                aria-label={`删除第 ${index + 1} 条问题`}
                                disabled={qualityQuestions.length <= 3
                                  || isSelectedQualityCheckActive
                                  || actionItemId === selectedItem.itemId}
                                onClick={() => setQualityQuestions((current) => (
                                  current.filter((_, itemIndex) => itemIndex !== index)
                                ))}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                            <div className="knowledge-ingestion-quality-question-fields">
                              <label>
                                <span>资料内问题 *</span>
                                <textarea
                                  value={item.question}
                                  maxLength={500}
                                  disabled={isSelectedQualityCheckActive
                                    || actionItemId === selectedItem.itemId}
                                  onChange={(event) => updateQualityQuestion(index, 'question', event.target.value)}
                                />
                              </label>
                              <label>
                                <span>来源证据 *</span>
                                <textarea
                                  value={item.evidence}
                                  maxLength={1_000}
                                  placeholder="例如：第三章第二节标题下的第 2 段，说明了……"
                                  disabled={isSelectedQualityCheckActive
                                    || actionItemId === selectedItem.itemId}
                                  onChange={(event) => updateQualityQuestion(index, 'evidence', event.target.value)}
                                />
                              </label>
                            </div>
                          </article>
                        ))}
                      </div>
                      <div className="knowledge-ingestion-quality-form-footer">
                        <div>
                          <button
                            type="button"
                            className="knowledge-ingestion-secondary-button"
                            disabled={qualityQuestions.length >= 5
                              || isSelectedQualityCheckActive
                              || actionItemId === selectedItem.itemId}
                            onClick={() => setQualityQuestions((current) => [
                              ...current,
                              { question: '', evidence: '' },
                            ])}
                          >
                            <Plus size={15} />
                            <span>增加问题</span>
                          </button>
                          <span
                            className={qualityQuestionsValidation
                              ? 'knowledge-ingestion-quality-validation'
                              : 'knowledge-ingestion-quality-validation is-valid'}
                            aria-live="polite"
                          >
                            {qualityQuestionsValidation ?? '问题和来源证据已填写完整。'}
                          </span>
                        </div>
                        <button
                          type="submit"
                          className="knowledge-ingestion-primary-button"
                          disabled={!canStartSelectedQualityCheck}
                        >
                          {isSelectedQualityCheckActive || actionItemId === selectedItem.itemId
                            ? <LoaderCircle size={16} className="is-spinning" />
                            : <Play size={16} />}
                          <span>{isSelectedQualityCheckActive ? '质量检查进行中' : '开始质量检查'}</span>
                        </button>
                      </div>
                      </form>
                    </>
                  ) : null}

                  {selectedQualitySummary.status !== 'not_started' ? (
                    <div className="knowledge-ingestion-quality-report" aria-live="polite">
                      <div className="knowledge-ingestion-quality-report-summary">
                        <div>
                          <strong>运行结论</strong>
                          <span>
                            {selectedQualitySummary.questionCount} 条问题
                            {selectedQualitySummary.startedAt
                              ? ` · 开始于 ${formatDate(selectedQualitySummary.startedAt)}`
                              : ''}
                            {selectedQualitySummary.completedAt
                              ? ` · 完成于 ${formatDate(selectedQualitySummary.completedAt)}`
                              : ''}
                          </span>
                        </div>
                        <p>{selectedQualitySummary.conclusion ?? getQualityOutcomeMessage(selectedItem)}</p>
                      </div>

                      {selectedQualitySummary.status === 'passed' ? (
                        <div className="knowledge-ingestion-quality-outcome outcome-passed">
                          <CheckCircle2 size={17} />
                          <span>当前状态：待发布。本步骤不提供发布按钮。</span>
                        </div>
                      ) : null}
                      {selectedQualitySummary.status === 'blocked'
                        || selectedQualitySummary.status === 'failed'
                        || selectedQualitySummary.status === 'expired' ? (
                          <div className="knowledge-ingestion-quality-outcome outcome-blocked" role="alert">
                            <AlertCircle size={17} />
                            <span>{getQualityOutcomeMessage(selectedItem)}</span>
                          </div>
                        ) : null}

                      {selectedQualitySummary.results.length > 0 ? (
                        <div className="knowledge-ingestion-quality-results">
                          {selectedQualitySummary.results.map((result) => (
                            <div
                              className={result.passed
                                ? 'knowledge-ingestion-quality-result is-passed'
                                : `knowledge-ingestion-quality-result is-${result.severity}`}
                              key={result.checkKey}
                            >
                              {result.passed
                                ? <CheckCircle2 size={16} />
                                : <AlertCircle size={16} />}
                              <div>
                                <div className="knowledge-ingestion-quality-result-heading">
                                  <strong>{result.label}</strong>
                                  <span>{result.severity === 'blocking' ? '阻断项' : '警告'}</span>
                                </div>
                                <p>{result.message}</p>
                                {result.locatorLabel ? <small>来源定位：{result.locatorLabel}</small> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="knowledge-ingestion-quality-results-empty">
                          {isSelectedQualityCheckActive
                            ? '正在等待逐项检查结果，请保持应用运行。'
                            : '本次运行暂无逐项结果。'}
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {selectedItem.isDuplicate ? (
                <div className="knowledge-ingestion-duplicate-note">
                  <Copy size={18} />
                  <div>
                    <strong>内容已登记</strong>
                    <span>本次来源已记录，没有创建第二个资料版本。</span>
                  </div>
                </div>
              ) : (
                <form
                  className="knowledge-ingestion-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (canConfirm) {
                      void confirmMetadata({ itemId: selectedItem.itemId, metadata: metadataDraft });
                    }
                  }}
                >
                  <div className="knowledge-ingestion-section-title">
                    <div>
                      <h3>人工元数据</h3>
                      <span>{selectedItem.status === 'processing' ? '已确认' : '等待确认'}</span>
                    </div>
                  </div>
                  <div className="knowledge-ingestion-form-grid">
                    <label className="knowledge-ingestion-field field-wide">
                      <span>资料标题 *</span>
                      <input
                        value={metadataDraft.stableTitle}
                        maxLength={300}
                        disabled={selectedItem.status !== 'pending_confirmation'}
                        onChange={(event) => updateMetadata('stableTitle', event.target.value)}
                      />
                    </label>
                    <label className="knowledge-ingestion-field">
                      <span>资料域 *</span>
                      <input
                        value={metadataDraft.domain}
                        maxLength={100}
                        disabled={selectedItem.status !== 'pending_confirmation'}
                        onChange={(event) => updateMetadata('domain', event.target.value)}
                      />
                    </label>
                    <label className="knowledge-ingestion-field">
                      <span>学科 *</span>
                      <input
                        value={metadataDraft.subject}
                        maxLength={100}
                        disabled={selectedItem.status !== 'pending_confirmation'}
                        onChange={(event) => updateMetadata('subject', event.target.value)}
                      />
                    </label>
                    <label className="knowledge-ingestion-field">
                      <span>资料类型 *</span>
                      <select
                        value={metadataDraft.materialType}
                        disabled={selectedItem.status !== 'pending_confirmation'}
                        onChange={(event) => updateMetadata('materialType', event.target.value)}
                      >
                        <option value="教材">教材</option>
                        <option value="讲义">讲义</option>
                        <option value="知识点">知识点</option>
                        <option value="题目">题目</option>
                        <option value="试卷">试卷</option>
                        <option value="法规">法规</option>
                      </select>
                    </label>
                    <label className="knowledge-ingestion-field">
                      <span>语言 *</span>
                      <select
                        value={metadataDraft.language}
                        disabled={selectedItem.status !== 'pending_confirmation'}
                        onChange={(event) => updateMetadata('language', event.target.value)}
                      >
                        <option value="中文">中文</option>
                        <option value="英文">英文</option>
                        <option value="中英双语">中英双语</option>
                      </select>
                    </label>
                    <label className="knowledge-ingestion-field">
                      <span>教育阶段</span>
                      <input
                        value={metadataDraft.educationStage}
                        maxLength={100}
                        disabled={selectedItem.status !== 'pending_confirmation'}
                        onChange={(event) => updateMetadata('educationStage', event.target.value)}
                      />
                    </label>
                    <label className="knowledge-ingestion-field">
                      <span>年级</span>
                      <input
                        value={metadataDraft.grade}
                        maxLength={100}
                        disabled={selectedItem.status !== 'pending_confirmation'}
                        onChange={(event) => updateMetadata('grade', event.target.value)}
                      />
                    </label>
                    <label className="knowledge-ingestion-field">
                      <span>学期</span>
                      <input
                        value={metadataDraft.semester}
                        maxLength={100}
                        disabled={selectedItem.status !== 'pending_confirmation'}
                        onChange={(event) => updateMetadata('semester', event.target.value)}
                      />
                    </label>
                    <label className="knowledge-ingestion-field">
                      <span>教材版本</span>
                      <input
                        value={metadataDraft.edition}
                        maxLength={100}
                        disabled={selectedItem.status !== 'pending_confirmation'}
                        onChange={(event) => updateMetadata('edition', event.target.value)}
                      />
                    </label>
                    <label className="knowledge-ingestion-field">
                      <span>单元</span>
                      <input
                        value={metadataDraft.unit}
                        maxLength={100}
                        disabled={selectedItem.status !== 'pending_confirmation'}
                        onChange={(event) => updateMetadata('unit', event.target.value)}
                      />
                    </label>
                    <label className="knowledge-ingestion-field field-wide">
                      <span>处理模板 *</span>
                      <select
                        value={metadataDraft.parserProfile}
                        disabled={selectedItem.status !== 'pending_confirmation'}
                        onChange={(event) => updateMetadata('parserProfile', event.target.value)}
                      >
                        <option value="education-textbook-v1">教材 / 讲义</option>
                        <option value="education-knowledge-v1">知识点</option>
                        <option value="education-question-v1">题目</option>
                        <option value="education-exam-v1">试卷</option>
                        <option value="accounting-regulation-v1">法规 / 会计规则</option>
                      </select>
                    </label>
                  </div>
                  {selectedItem.status === 'pending_confirmation' ? (
                    <div className="knowledge-ingestion-form-actions">
                      <button
                        type="submit"
                        className="knowledge-ingestion-primary-button"
                        disabled={!canConfirm || isLoading}
                      >
                        <CheckCircle2 size={17} />
                        <span>确认并排入处理</span>
                      </button>
                    </div>
                  ) : null}
                </form>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
