import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  FileText,
  FileUp,
  GitBranch,
  LoaderCircle,
  Play,
  Save,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Send,
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
  KnowledgeIngestionPublicationOperationStatus,
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

const publicationStatusLabels: Record<KnowledgeIngestionPublicationOperationStatus, string> = {
  not_started: '尚未发起',
  queued: '已排队',
  running: '核验中',
  compensating: '补偿中',
  retry_scheduled: '等待重试',
  attention_required: '需要处理',
  completed: '已完成',
  failed: '操作失败并已安全终止',
};

interface PublicationConfirmationDialog {
  kind: 'publish' | 'rollback';
  itemId: string;
  reason: string;
}

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

function canPrepareQualityCheck(item: KnowledgeIngestionItem): boolean {
  return !item.isDuplicate
    && (
      item.lifecycle.workflowStatus === 'quality_check'
      || (
        item.lifecycle.workflowStatus === 'pending_publication'
        && item.lifecycle.qualitySummary.status === 'expired'
        && (
          item.publication.operationStatus === 'not_started'
          || item.publication.operationStatus === 'failed'
        )
      )
    )
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

function getQualityConclusionText(item: KnowledgeIngestionItem): string {
  const summary = item.lifecycle.qualitySummary;
  if (summary.status === 'passed' && item.lifecycle.workflowStatus !== 'pending_publication') {
    return `历史质量结论：已通过。当前状态：${workflowStatusLabels[item.lifecycle.workflowStatus]}。`;
  }
  return summary.conclusion ?? getQualityOutcomeMessage(item);
}

function getPrimaryStatus(item: KnowledgeIngestionItem): string {
  return item.isDuplicate
    ? statusLabels.duplicate
    : workflowStatusLabels[item.lifecycle.workflowStatus];
}

function getCurrentStageText(item: KnowledgeIngestionItem): string {
  if (item.isDuplicate) return '完全重复，已跳过处理';
  const publicationStatus = item.publication.operationStatus;
  if (
    publicationStatus !== 'not_started'
    && publicationStatus !== 'completed'
  ) {
    return `发布与回滚 · ${publicationStatusLabels[publicationStatus]}`;
  }
  if (
    item.lifecycle.workflowStatus === 'published'
    || item.lifecycle.workflowStatus === 'superseded'
    || item.lifecycle.workflowStatus === 'archived'
  ) {
    return workflowStatusLabels[item.lifecycle.workflowStatus];
  }
  const { qualitySummary } = item.lifecycle;
  if (
    item.lifecycle.workflowStatus === 'quarantined'
    && item.publication.operationType === 'rollback'
    && item.publication.operationStatus === 'completed'
  ) return workflowStatusLabels.quarantined;
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

interface KnowledgeIngestionPublicationPanelProps {
  item: KnowledgeIngestionItem;
  actionItemId: string | null;
  onReceiveNextVersion: (itemId: string) => void;
  onOpenPublish: (itemId: string) => void;
  onOpenRollback: (itemId: string) => void;
  onRetry: (itemId: string) => void;
}

export function KnowledgeIngestionPublicationPanel({
  item,
  actionItemId,
  onReceiveNextVersion,
  onOpenPublish,
  onOpenRollback,
  onRetry,
}: KnowledgeIngestionPublicationPanelProps): JSX.Element {
  const needsAttention = item.publication.operationStatus === 'attention_required'
    || item.publication.operationStatus === 'failed';
  const isRecoveryPending = item.publication.operationStatus === 'compensating'
    || item.publication.operationStatus === 'retry_scheduled';
  const isActionRunning = actionItemId === item.itemId;
  return (
    <section
      className={`knowledge-ingestion-publication-panel publication-status-${item.publication.operationStatus}`}
      aria-label="发布与版本"
    >
      <div className="knowledge-ingestion-section-title">
        <div>
          <h3>发布与版本</h3>
          <span>正式可见性由 SQLite 当前发布关系控制</span>
        </div>
        <span className="knowledge-ingestion-publication-status" aria-live="polite">
          {publicationStatusLabels[item.publication.operationStatus]}
        </span>
      </div>
      <div className="knowledge-ingestion-publication-version-grid">
        <div>
          <span>当前版本</span>
          <strong>{item.publication.versionLabel}</strong>
        </div>
        <div>
          <span>上一版本</span>
          <strong>{item.publication.previousVersionLabel ?? '无'}</strong>
        </div>
        <div>
          <span>正式状态</span>
          <strong>{item.publication.isCurrentVersion ? '当前正式版本' : '非当前正式版本'}</strong>
        </div>
      </div>
      <div
        className={needsAttention || isRecoveryPending
          ? 'knowledge-ingestion-publication-message is-warning'
          : 'knowledge-ingestion-publication-message'}
        role={needsAttention ? 'alert' : undefined}
        aria-live="polite"
      >
        {needsAttention
          ? <AlertCircle size={17} />
          : isRecoveryPending
            ? <RefreshCw size={17} className={item.publication.operationStatus === 'compensating' ? 'is-spinning' : ''} />
            : <ShieldCheck size={17} />}
        <span>{item.publication.operationMessage}</span>
      </div>
      <div className="knowledge-ingestion-publication-actions">
        {item.publication.canReceiveNextVersion ? (
          <button
            type="button"
            className="knowledge-ingestion-secondary-button"
            disabled={isActionRunning}
            onClick={() => onReceiveNextVersion(item.itemId)}
          >
            {isActionRunning
              ? <LoaderCircle size={16} className="is-spinning" />
              : <GitBranch size={16} />}
            <span>接收新版本</span>
          </button>
        ) : null}
        {item.publication.canPublish ? (
          <button
            type="button"
            className="knowledge-ingestion-primary-button"
            disabled={isActionRunning}
            onClick={() => onOpenPublish(item.itemId)}
          >
            <Send size={16} />
            <span>发布</span>
          </button>
        ) : null}
        {item.publication.canRollback ? (
          <button
            type="button"
            className="knowledge-ingestion-danger-button"
            disabled={isActionRunning}
            onClick={() => onOpenRollback(item.itemId)}
          >
            <RotateCcw size={16} />
            <span>回滚</span>
          </button>
        ) : null}
        {item.publication.canRetry ? (
          <button
            type="button"
            className="knowledge-ingestion-secondary-button"
            disabled={isActionRunning}
            onClick={() => onRetry(item.itemId)}
          >
            <RefreshCw size={16} className={isActionRunning ? 'is-spinning' : ''} />
            <span>重试发布操作</span>
          </button>
        ) : null}
      </div>
    </section>
  );
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
  const receiveNextVersion = useAppStore((state) => state.receiveKnowledgeIngestionNextVersion);
  const startPublication = useAppStore((state) => state.startKnowledgeIngestionItemPublication);
  const startRollback = useAppStore((state) => state.startKnowledgeIngestionItemRollback);
  const retryPublication = useAppStore((state) => state.retryKnowledgeIngestionItemPublication);
  const [metadataDraft, setMetadataDraft] = useState<KnowledgeIngestionMetadata>(emptyMetadata);
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
  const [publicationDialog, setPublicationDialog] = useState<PublicationConfirmationDialog | null>(null);
  const publicationDialogCancelRef = useRef<HTMLButtonElement>(null);
  const publicationDialogRef = useRef<HTMLDivElement>(null);
  const detailHeaderRef = useRef<HTMLDivElement>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.itemId === selectedItemId) ?? null,
    [items, selectedItemId],
  );
  const publicationDialogItem = useMemo(
    () => items.find((item) => item.itemId === publicationDialog?.itemId) ?? null,
    [items, publicationDialog?.itemId],
  );
  const selectedQualitySummary = selectedItem?.lifecycle.qualitySummary ?? null;
  const selectedPublicationSummary = selectedItem?.publication ?? null;
  const canPrepareSelectedQualityCheck = selectedItem ? canPrepareQualityCheck(selectedItem) : false;
  const isSelectedQualityCheckActive = selectedQualitySummary?.status === 'queued'
    || selectedQualitySummary?.status === 'running';
  const selectedQualityHasProblem = selectedQualitySummary?.status === 'blocked'
    || selectedQualitySummary?.status === 'failed'
    || selectedQualitySummary?.status === 'expired';
  const selectedPublicationHasProblem = selectedPublicationSummary?.operationStatus === 'attention_required'
    || selectedPublicationSummary?.operationStatus === 'failed';
  const selectedWorkflowIsQuarantined = selectedItem?.lifecycle.workflowStatus === 'quarantined';
  const isSelectedPublicationBusy = selectedPublicationSummary?.operationStatus === 'queued'
    || selectedPublicationSummary?.operationStatus === 'running'
    || selectedPublicationSummary?.operationStatus === 'compensating'
    || selectedPublicationSummary?.operationStatus === 'retry_scheduled';
  const selectedHasActiveJob = Boolean(selectedItem && (
    isSelectedQualityCheckActive
    || isSelectedPublicationBusy
    || (selectedItem.lifecycle.currentJobStatus
      && ['queued', 'running', 'cancel_requested'].includes(selectedItem.lifecycle.currentJobStatus))
  ));
  const canStartSelectedQualityCheck = canPrepareSelectedQualityCheck
    && !isSelectedQualityCheckActive
    && actionItemId !== selectedItem?.itemId;
  const shouldShowQualityPanel = Boolean(selectedItem && !selectedItem.isDuplicate && (
    canPrepareSelectedQualityCheck
    || selectedQualitySummary?.status !== 'not_started'
    || selectedItem.lifecycle.workflowStatus === 'pending_publication'
  ));
  const shouldShowPublicationPanel = Boolean(selectedItem && !selectedItem.isDuplicate && (
    selectedItem.lifecycle.workflowStatus === 'pending_publication'
    || selectedItem.lifecycle.workflowStatus === 'published'
    || selectedItem.lifecycle.workflowStatus === 'superseded'
    || (
      selectedItem.lifecycle.workflowStatus === 'quarantined'
      && selectedPublicationSummary?.operationStatus !== 'not_started'
    )
    || selectedPublicationSummary?.operationStatus !== 'not_started'
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
  const hasActivePublicationOperation = items.some((item) => (
    item.publication.operationStatus === 'queued'
    || item.publication.operationStatus === 'running'
    || item.publication.operationStatus === 'compensating'
    || item.publication.operationStatus === 'retry_scheduled'
  ));

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasActiveC2Job && !hasActiveQualityCheck && !hasActivePublicationOperation) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    // 前一次静默刷新结束后再安排下一次，避免慢磁盘下叠加并发列表请求。
    const poll = async () => {
      await refreshItems();
      if (!cancelled) timer = window.setTimeout(poll, 2_000);
    };
    timer = window.setTimeout(poll, 2_000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [hasActiveC2Job, hasActivePublicationOperation, hasActiveQualityCheck, refreshItems]);

  useEffect(() => {
    const expiresAt = selectedQualitySummary?.expiresAt;
    if (
      !selectedItem
      || selectedItem.lifecycle.workflowStatus !== 'pending_publication'
      || selectedQualitySummary?.status !== 'passed'
      || !expiresAt
    ) return undefined;
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) return undefined;
    // 到达失效点后持续单飞刷新，直到 Main 返回 expired，短暂 IPC 失败不能留下旧发布按钮。
    let cancelled = false;
    let timer: number | undefined;
    const refreshUntilExpiredSnapshotArrives = async () => {
      await refreshItems();
      if (!cancelled) timer = window.setTimeout(refreshUntilExpiredSnapshotArrives, 2_000);
    };
    timer = window.setTimeout(
      refreshUntilExpiredSnapshotArrives,
      Math.max(0, expiresAtMs - Date.now() + 25),
    );
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refreshItems, selectedItem, selectedQualitySummary]);

  useEffect(() => {
    if (publicationDialog?.itemId && !publicationDialogItem) {
      setPublicationDialog(null);
    }
  }, [publicationDialog?.itemId, publicationDialogItem]);

  useEffect(() => {
    if (!publicationDialog) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    publicationDialogCancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPublicationDialog(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = publicationDialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute('hidden'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (!focusable.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.requestAnimationFrame(() => {
        if (document.querySelector('.knowledge-ingestion-publication-dialog')) return;
        if (previouslyFocused?.isConnected) {
          previouslyFocused.focus();
        } else {
          detailHeaderRef.current?.focus();
        }
      });
    };
  }, [publicationDialog?.itemId, publicationDialog?.kind]);

  useEffect(() => {
    // 静默轮询会替换列表对象，但不能覆盖用户正在填写的待确认元数据。
    setMetadataDraft(selectedItem ? { ...selectedItem.metadata } : { ...emptyMetadata });
  }, [selectedItem?.itemId]);

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

  const confirmPublicationAction = () => {
    if (!publicationDialog || !publicationDialogItem) return;
    const itemId = publicationDialogItem.itemId;
    if (publicationDialog.kind === 'rollback') {
      const reason = publicationDialog.reason.trim();
      if (!reason || !publicationDialogItem.publication.canRollback) return;
      setPublicationDialog(null);
      void startRollback({ itemId, reason });
      return;
    }
    if (!publicationDialogItem.publication.canPublish) return;
    setPublicationDialog(null);
    void startPublication({ itemId });
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
              <div className="knowledge-ingestion-detail-header" ref={detailHeaderRef} tabIndex={-1}>
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
                {selectedItem.lifecycle.errorMessage
                  || selectedQualityHasProblem
                  || selectedPublicationHasProblem
                  || selectedWorkflowIsQuarantined
                  ? <AlertCircle size={24} className="knowledge-ingestion-error-icon" />
                  : null}
                {!selectedItem.isDuplicate
                  && !selectedItem.lifecycle.errorMessage
                  && !selectedQualityHasProblem
                  && !selectedPublicationHasProblem
                  && !selectedWorkflowIsQuarantined
                  && selectedHasActiveJob
                  ? <LoaderCircle size={24} className="is-spinning" />
                  : null}
                {!selectedItem.isDuplicate
                  && !selectedItem.lifecycle.errorMessage
                  && !selectedQualityHasProblem
                  && !selectedPublicationHasProblem
                  && !selectedWorkflowIsQuarantined
                  && !selectedHasActiveJob
                  && (
                    selectedItem.lifecycle.workflowStatus === 'pending_publication'
                    || (
                      selectedItem.lifecycle.workflowStatus === 'published'
                      && selectedPublicationSummary?.isCurrentVersion
                    )
                  )
                  ? <CheckCircle2 size={24} />
                  : null}
                {!selectedItem.isDuplicate
                  && !selectedItem.lifecycle.errorMessage
                  && !selectedQualityHasProblem
                  && !selectedPublicationHasProblem
                  && !selectedWorkflowIsQuarantined
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
                          <strong>
                            {selectedQualitySummary.status === 'expired'
                              ? '质量结论已过期，请重新执行索引健康检查'
                              : '系统将自动检查索引健康'}
                          </strong>
                          <span>系统会按资料结构抽取 1 至 3 段原文，验证索引可检回且不会串入其他资料。</span>
                        </div>
                      </div>
                      <div className="knowledge-ingestion-quality-form-footer">
                        <p className="knowledge-ingestion-quality-suggest-hint">
                          此检查证明当前索引的抽样可检索性和范围安全；资料是否符合用途以接收时确认的元数据和内容为准。
                        </p>
                        <button
                          type="button"
                          className="knowledge-ingestion-primary-button"
                          disabled={!canStartSelectedQualityCheck}
                          onClick={() => {
                            if (!canStartSelectedQualityCheck || !selectedItem) return;
                            void startQualityCheck({ itemId: selectedItem.itemId });
                          }}
                        >
                          {isSelectedQualityCheckActive || actionItemId === selectedItem.itemId
                            ? <LoaderCircle size={16} className="is-spinning" />
                            : <Play size={16} />}
                          <span>
                            {isSelectedQualityCheckActive
                              ? '质量检查进行中'
                              : selectedQualitySummary.status === 'expired'
                                ? '重新质量检查'
                                : '开始质量检查'}
                          </span>
                        </button>
                      </div>
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
                        <p>{getQualityConclusionText(selectedItem)}</p>
                      </div>

                      {selectedQualitySummary.status === 'passed'
                        && selectedItem.lifecycle.workflowStatus === 'pending_publication' ? (
                        <div className="knowledge-ingestion-quality-outcome outcome-passed">
                          <CheckCircle2 size={17} />
                          <span>当前状态：待发布。请在下方“发布与版本”区域确认影响后发布。</span>
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

              {shouldShowPublicationPanel ? (
                <KnowledgeIngestionPublicationPanel
                  item={selectedItem}
                  actionItemId={actionItemId}
                  onReceiveNextVersion={(itemId) => void receiveNextVersion({ itemId })}
                  onOpenPublish={(itemId) => setPublicationDialog({ kind: 'publish', itemId, reason: '' })}
                  onOpenRollback={(itemId) => setPublicationDialog({ kind: 'rollback', itemId, reason: '' })}
                  onRetry={(itemId) => void retryPublication({ itemId })}
                />
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
      {publicationDialog && publicationDialogItem ? (
        <div
          className="knowledge-ingestion-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPublicationDialog(null);
          }}
        >
          <div
            ref={publicationDialogRef}
            className="knowledge-ingestion-publication-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="knowledge-ingestion-publication-dialog-title"
          >
            <div className="knowledge-ingestion-publication-dialog-header">
              <div>
                <span>二次确认</span>
                <h3 id="knowledge-ingestion-publication-dialog-title">
                  {publicationDialog.kind === 'publish'
                    ? `确认发布${publicationDialogItem.publication.versionLabel}`
                    : `确认回滚${publicationDialogItem.publication.previousVersionLabel ?? '上一版本'}`}
                </h3>
              </div>
              <button
                type="button"
                className="knowledge-ingestion-icon-button"
                title="关闭确认窗口"
                aria-label="关闭确认窗口"
                onClick={() => setPublicationDialog(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="knowledge-ingestion-publication-dialog-impact">
              <AlertCircle size={20} />
              <div>
                <strong>影响说明</strong>
                <p>
                  {publicationDialog.kind === 'publish'
                    ? publicationDialogItem.publication.previousVersionLabel
                      ? `发布“${publicationDialogItem.fileName}”后，${publicationDialogItem.publication.versionLabel}将替代${publicationDialogItem.publication.previousVersionLabel}成为正式版本。系统会先完成远端核验，再切换正式可见性。`
                      : `发布“${publicationDialogItem.fileName}”后，${publicationDialogItem.publication.versionLabel}将成为该资料分支的首个正式版本。系统会先完成远端核验，再切换正式可见性。`
                    : `回滚“${publicationDialogItem.fileName}”会恢复${publicationDialogItem.publication.previousVersionLabel ?? '上一版本'}为正式版本，并隔离当前问题版本。回滚不重新上传，但会重新核验受管索引。`}
                </p>
              </div>
            </div>
            {publicationDialog.kind === 'rollback' ? (
              <label className="knowledge-ingestion-publication-reason">
                <span>回滚原因 *</span>
                <textarea
                  value={publicationDialog.reason}
                  maxLength={500}
                  placeholder="请说明问题表现、影响范围或恢复依据。"
                  onChange={(event) => setPublicationDialog((current) => (
                    current ? { ...current, reason: event.target.value } : current
                  ))}
                />
                <small>{publicationDialog.reason.trim().length} / 500</small>
              </label>
            ) : null}
            <div className="knowledge-ingestion-publication-dialog-footer">
              <button
                ref={publicationDialogCancelRef}
                type="button"
                className="knowledge-ingestion-secondary-button"
                onClick={() => setPublicationDialog(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={publicationDialog.kind === 'rollback'
                  ? 'knowledge-ingestion-danger-button'
                  : 'knowledge-ingestion-primary-button'}
                disabled={actionItemId === publicationDialogItem.itemId
                  || (publicationDialog.kind === 'publish'
                    ? !publicationDialogItem.publication.canPublish
                    : !publicationDialogItem.publication.canRollback || !publicationDialog.reason.trim())}
                onClick={confirmPublicationAction}
              >
                {publicationDialog.kind === 'rollback' ? <RotateCcw size={16} /> : <Send size={16} />}
                <span>{publicationDialog.kind === 'publish' ? '确认发布' : '确认回滚'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
