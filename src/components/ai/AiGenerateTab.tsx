/**
 * AI 生成 Tab
 * 支持生成讲义、知识点总结、练习题、试卷初稿和小红书内容
 */

import { useCallback, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { useAppStore } from '@/store';
import { aiService } from '@/services/AiService';
import { addAiGenerationRecord } from '@/services/AiGenerationRecordService';
import { knowledgeBaseService } from '@/services/KnowledgeBaseService';
import {
  buildKnowledgeRetrievalQuery,
  routeRagflowDatasetIds,
} from '@/services/knowledgeRetrieval';
import { parseKnowledgeSourcesFromContext } from '@/services/knowledgeSourceAnnotation';
import { layoutDocumentToMarkdown } from '@/services/layoutDocumentMarkdown';
import type {
  AiConfigProfile,
  AiGenerateSemanticRoleId,
  AiStructureTemplate,
  AiStructureTemplateScope,
  EducationGenerateType,
  GenerateOptions,
  GenerateType,
} from '@/types/ai';
import {
  AI_GENERATE_SEMANTIC_ROLE_OPTIONS,
  GENERATE_TYPE_LABELS,
  LENGTH_LABELS,
} from '@/types/ai';
import type { KnowledgeSourceReference } from '@/types/knowledge';
import {
  AiGenerationDialog,
  type AiGenerationDialogView,
} from './AiGenerationDialog';

function isXiaohongshuGenerateType(type: GenerateType): boolean {
  return type === 'xiaohongshuTitle' || type === 'xiaohongshuCopy' || type === 'xiaohongshuCover';
}

function isEducationGenerateType(type: GenerateType): type is EducationGenerateType {
  return type === 'lecture' || type === 'summary' || type === 'exercise' || type === 'exam';
}

function createAiStructureTemplateId(): string {
  return `ai-structure-template-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getStructureTemplateScopeLabel(scope: AiStructureTemplateScope): string {
  return scope === 'all' ? '全部类型' : GENERATE_TYPE_LABELS[scope];
}

function getFirstUsefulLine(content: string): string {
  const categoryNames = ['痛点型', '共鸣型', '反常识型', '对比型', '氛围感型', '合集清单型', '优先推荐', '推荐理由'];
  const line = content
    .split(/\r?\n/)
    .map((item) => item.replace(/^#+\s*/, '').replace(/^[-*\d.、\s]+/, '').replace(/^["“”]+|["“”]+$/g, '').trim())
    .find((item) => {
      if (!item) {
        return false;
      }

      // 小红书标题推荐会按类型分组，自动带入时跳过分组名，只取真正的标题候选。
      return !categoryNames.some((name) => item.startsWith(name));
    });

  return line ?? '';
}

interface GenerateContext {
  isXiaohongshuMode: boolean;
  articleTitle: string;
  articleContent: string;
  normalizedTopic: string;
  shouldUseKnowledgeContext: boolean;
}

interface GenerateKnowledgeContext {
  knowledgeContext?: string;
  knowledgeSources: KnowledgeSourceReference[];
}

type ActiveGenerateStep = 'outline' | 'content' | null;

export function AiGenerateTab(): JSX.Element {
  const isGenerating = useAppStore((state) => state.isGenerating);
  const generatedContent = useAppStore((state) => state.generatedContent);
  const generatedKnowledgeSources = useAppStore((state) => state.generatedKnowledgeSources);
  const generateSemanticRoleIds = useAppStore((state) => state.generateSemanticRoleIds);
  const generateError = useAppStore((state) => state.generateError);
  const startGenerating = useAppStore((state) => state.startGenerating);
  const updateGeneratedContent = useAppStore((state) => state.updateGeneratedContent);
  const setGeneratedKnowledgeSources = useAppStore((state) => state.setGeneratedKnowledgeSources);
  const setGenerateSemanticRoleIds = useAppStore((state) => state.setGenerateSemanticRoleIds);
  const setGenerateError = useAppStore((state) => state.setGenerateError);
  const finishGenerating = useAppStore((state) => state.finishGenerating);
  const clearGeneratedContent = useAppStore((state) => state.clearGeneratedContent);
  const insertLayoutMarkdownBlocks = useAppStore((state) => state.insertLayoutMarkdownBlocks);
  const workspaceRootPath = useAppStore((state) => state.workspaceRootPath);
  const currentDirectoryPath = useAppStore((state) => state.currentDirectoryPath);
  const setAiGenerationRecordDirectory = useAppStore((state) => state.setAiGenerationRecordDirectory);
  const setAiGenerationRecordsError = useAppStore((state) => state.setAiGenerationRecordsError);
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const ragflowConfig = useAppStore((state) => state.ragflowConfig);
  const ragflowDatasets = useAppStore((state) => state.ragflowDatasets);
  const selectedRagflowDatasetIds = useAppStore((state) => state.selectedRagflowDatasetIds);
  const knowledgeSourceForGenerate = useAppStore((state) => state.knowledgeSourceForGenerate);
  const aiStructureTemplates = useAppStore((state) => state.aiStructureTemplates);
  const selectedAiStructureTemplateId = useAppStore((state) => state.selectedAiStructureTemplateId);
  const upsertAiStructureTemplate = useAppStore((state) => state.upsertAiStructureTemplate);
  const deleteAiStructureTemplate = useAppStore((state) => state.deleteAiStructureTemplate);
  const setSelectedAiStructureTemplateId = useAppStore((state) => state.setSelectedAiStructureTemplateId);

  const [generateType, setGenerateType] = useState<GenerateType>('lecture');
  const [topic, setTopic] = useState('');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [requirementDescription, setRequirementDescription] = useState('');
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [shouldGenerateOutline, setShouldGenerateOutline] = useState(false);
  const [selectedXiaohongshuTitle, setSelectedXiaohongshuTitle] = useState('');
  const [selectedXiaohongshuCopy, setSelectedXiaohongshuCopy] = useState('');
  const [outlineDraft, setOutlineDraft] = useState('');
  const [outlineKnowledgeContext, setOutlineKnowledgeContext] = useState<string | undefined>();
  const [outlineKnowledgeSources, setOutlineKnowledgeSources] = useState<KnowledgeSourceReference[]>([]);
  const [activeGenerateStep, setActiveGenerateStep] = useState<ActiveGenerateStep>(null);
  const [generationDialogView, setGenerationDialogView] = useState<AiGenerationDialogView | null>(null);
  const [isStructureTemplateEditorOpen, setIsStructureTemplateEditorOpen] = useState(false);
  const [editingStructureTemplateId, setEditingStructureTemplateId] = useState<string | null>(null);
  const [structureTemplateName, setStructureTemplateName] = useState('');
  const [structureTemplateScope, setStructureTemplateScope] = useState<AiStructureTemplateScope>('all');
  const [structureTemplateStructure, setStructureTemplateStructure] = useState('');
  const [structureTemplateOutputRules, setStructureTemplateOutputRules] = useState('');
  const [structureTemplateError, setStructureTemplateError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCloseGenerationDialog = useCallback(() => {
    setGenerationDialogView(null);
  }, []);

  const handleToggleSemanticRole = (roleId: AiGenerateSemanticRoleId, checked: boolean) => {
    // 勾选顺序统一按预设顺序归一化，避免提示词和界面顺序来回跳动。
    const nextRoleIds = checked
      ? [...generateSemanticRoleIds, roleId]
      : generateSemanticRoleIds.filter((currentRoleId) => currentRoleId !== roleId);
    setGenerateSemanticRoleIds(nextRoleIds);
  };

  const getSelectedStructureTemplate = (): AiStructureTemplate | undefined => {
    if (!isEducationGenerateType(generateType)) {
      return undefined;
    }

    const selectedTemplate = aiStructureTemplates.find((template) => template.id === selectedAiStructureTemplateId);
    if (!selectedTemplate) {
      return undefined;
    }

    return selectedTemplate.scope === 'all' || selectedTemplate.scope === generateType
      ? selectedTemplate
      : undefined;
  };

  const resetStructureTemplateEditor = () => {
    setEditingStructureTemplateId(null);
    setStructureTemplateName('');
    setStructureTemplateScope(isEducationGenerateType(generateType) ? generateType : 'all');
    setStructureTemplateStructure('');
    setStructureTemplateOutputRules('');
    setStructureTemplateError(null);
  };

  const handleCreateStructureTemplate = () => {
    resetStructureTemplateEditor();
    setIsStructureTemplateEditorOpen(true);
  };

  const handleEditStructureTemplate = () => {
    const selectedTemplate = getSelectedStructureTemplate();
    if (!selectedTemplate) {
      setStructureTemplateError('请先选择要编辑的模板');
      return;
    }

    setEditingStructureTemplateId(selectedTemplate.id);
    setStructureTemplateName(selectedTemplate.name);
    setStructureTemplateScope(selectedTemplate.scope);
    setStructureTemplateStructure(selectedTemplate.structure);
    setStructureTemplateOutputRules(selectedTemplate.outputRules ?? '');
    setStructureTemplateError(null);
    setIsStructureTemplateEditorOpen(true);
  };

  const handleSaveStructureTemplate = () => {
    const name = structureTemplateName.trim();
    const structure = structureTemplateStructure.trim();
    const outputRules = structureTemplateOutputRules.trim();

    if (!name) {
      setStructureTemplateError('请填写模板名称');
      return;
    }
    if (!structure) {
      setStructureTemplateError('请填写文章结构');
      return;
    }

    const existingTemplate = editingStructureTemplateId
      ? aiStructureTemplates.find((template) => template.id === editingStructureTemplateId)
      : null;
    const now = new Date().toISOString();
    upsertAiStructureTemplate({
      id: existingTemplate?.id ?? createAiStructureTemplateId(),
      name,
      scope: structureTemplateScope,
      structure,
      outputRules: outputRules || undefined,
      createdAt: existingTemplate?.createdAt ?? now,
      updatedAt: now,
    });
    resetStructureTemplateEditor();
    setIsStructureTemplateEditorOpen(false);
  };

  const handleDeleteStructureTemplate = () => {
    const selectedTemplate = getSelectedStructureTemplate();
    if (!selectedTemplate) {
      setStructureTemplateError('请先选择要删除的模板');
      return;
    }

    if (!window.confirm(`确定要删除「${selectedTemplate.name}」这个文章结构模板吗？`)) {
      return;
    }

    deleteAiStructureTemplate(selectedTemplate.id);
    if (editingStructureTemplateId === selectedTemplate.id) {
      resetStructureTemplateEditor();
      setIsStructureTemplateEditorOpen(false);
    }
  };

  const resetOutlineReview = () => {
    setOutlineDraft('');
    setOutlineKnowledgeContext(undefined);
    setOutlineKnowledgeSources([]);
  };

  const resolveGenerateContext = (): GenerateContext => {
    const isXiaohongshuMode = isXiaohongshuGenerateType(generateType);
    const articleTitle = layoutDocument?.title?.trim() || '';
    const articleContent = layoutDocument ? layoutDocumentToMarkdown(layoutDocument) : '';
    const normalizedTopic = topic.trim() || articleTitle || selectedXiaohongshuTitle.trim();
    const shouldUseKnowledgeContext = !isXiaohongshuMode && knowledgeSourceForGenerate !== 'none';

    return {
      isXiaohongshuMode,
      articleTitle,
      articleContent,
      normalizedTopic,
      shouldUseKnowledgeContext,
    };
  };

  const validateGenerateContext = (context: GenerateContext): boolean => {
    if (!context.normalizedTopic && !context.articleContent.trim()) {
      setGenerateError('请输入主题');
      return false;
    }

    if ((generateType === 'xiaohongshuCopy' || generateType === 'xiaohongshuCover') && !selectedXiaohongshuTitle.trim()) {
      setGenerateError('请先填写已选小红书标题');
      return false;
    }

    if (generateType === 'xiaohongshuCover' && !selectedXiaohongshuCopy.trim()) {
      setGenerateError('请先填写小红书文案，主图方案需要结合文案生成');
      return false;
    }

    return true;
  };

  const buildGenerateOptions = (
    context: GenerateContext,
    extra?: {
      knowledgeContext?: string;
      reviewedOutline?: string;
    }
  ): GenerateOptions => ({
    type: generateType,
    topic: context.normalizedTopic,
    grade: context.isXiaohongshuMode ? undefined : grade.trim() || undefined,
    subject: context.isXiaohongshuMode ? undefined : subject.trim() || undefined,
    requirementDescription: context.isXiaohongshuMode ? undefined : requirementDescription.trim() || undefined,
    length: context.isXiaohongshuMode ? undefined : length,
    semanticRoleIds: context.isXiaohongshuMode ? undefined : generateSemanticRoleIds,
    articleTitle: context.isXiaohongshuMode ? context.articleTitle || context.normalizedTopic : undefined,
    articleContent: context.isXiaohongshuMode ? context.articleContent : undefined,
    selectedTitle: context.isXiaohongshuMode ? selectedXiaohongshuTitle.trim() || undefined : undefined,
    selectedCopy: context.isXiaohongshuMode ? selectedXiaohongshuCopy.trim() || undefined : undefined,
    knowledgeContext: extra?.knowledgeContext,
    reviewedOutline: extra?.reviewedOutline,
    structureTemplate: context.isXiaohongshuMode
      ? undefined
      : (() => {
          const selectedTemplate = getSelectedStructureTemplate();
          return selectedTemplate
            ? {
                name: selectedTemplate.name,
                structure: selectedTemplate.structure,
                outputRules: selectedTemplate.outputRules,
              }
            : undefined;
        })(),
  });

  const loadKnowledgeContext = async (
    context: GenerateContext,
    signal: AbortSignal
  ): Promise<GenerateKnowledgeContext> => {
    if (!context.shouldUseKnowledgeContext) {
      return { knowledgeSources: [] };
    }

    const knowledgeQuery = buildKnowledgeRetrievalQuery({
      topic: context.normalizedTopic,
      grade,
      subject,
      requirementDescription,
    });

    if (selectedRagflowDatasetIds.length === 0) {
      throw new Error('请先在「个人知识库」里至少选择一个 RAGFlow 数据集');
    }
    if (ragflowDatasets.length === 0) {
      throw new Error('请先在「个人知识库」里读取数据集，再进行精准知识库检索');
    }

    const retrievalDatasetIds = routeRagflowDatasetIds({
      datasets: ragflowDatasets,
      selectedDatasetIds: selectedRagflowDatasetIds,
      subject,
    });
    if (retrievalDatasetIds.length === 0) {
      throw new Error(`已选知识库中没有与科目“${subject.trim()}”匹配的数据集，请先调整知识源`);
    }

    const datasetNameMap = new Map(ragflowDatasets.map((dataset) => [dataset.id, dataset.name]));
    // 大纲阶段先锁定一批知识库资料，正文阶段复用它，避免两次检索口径不一致。
    const retrievalResult = await knowledgeBaseService.buildRagflowKnowledgeContext({
      config: ragflowConfig,
      datasetIds: retrievalDatasetIds,
      query: knowledgeQuery,
      datasetNameMap,
      signal,
    });

    if (!retrievalResult.context.trim()) {
      throw new Error('当前主题没有检索到可用知识片段，请先在「个人知识库」里调整知识源或检索词');
    }

    return {
      knowledgeContext: retrievalResult.context,
      knowledgeSources: parseKnowledgeSourcesFromContext({
        sourceType: 'ragflow',
        context: retrievalResult.context,
      }),
    };
  };

  const saveGenerationRecord = async (
    finalContent: string,
    options: GenerateOptions,
    knowledgeSources: KnowledgeSourceReference[],
    config: AiConfigProfile
  ) => {
    if (!finalContent.trim()) {
      return;
    }

    try {
      // 只在最终正文生成完成后保存记录；中间大纲不落盘，避免历史记录混入半成品。
      const recordDirectory = await addAiGenerationRecord({
        workspaceRootPath: workspaceRootPath ?? currentDirectoryPath,
        record: {
          type: options.type,
          typeLabel: GENERATE_TYPE_LABELS[options.type],
          topic: options.topic,
          grade: options.grade,
          subject: options.subject,
          requirementDescription: options.requirementDescription,
          length: options.length,
          lengthLabel: options.length ? LENGTH_LABELS[options.length] : undefined,
          provider: config.provider,
          model: config.model,
          knowledgeSources: knowledgeSources.length > 0 ? knowledgeSources : undefined,
          content: finalContent,
        },
      });
      setAiGenerationRecordDirectory(recordDirectory);
    } catch (recordError) {
      setAiGenerationRecordsError(
        recordError instanceof Error ? recordError.message : 'AI 生成记录保存失败',
      );
    }
  };

  const handleGenerateError = (error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError') {
      setGenerateError('生成已取消');
    } else if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
      setGenerateError('网络错误：主进程无法连接到 AI 服务。\n\n请检查 Base URL、API Key、模型名称和本机网络连接。');
    } else {
      setGenerateError(error instanceof Error ? error.message : '生成失败');
    }
  };

  const beginGenerateRequest = (step: Exclude<ActiveGenerateStep, null>): AbortController => {
    startGenerating();
    setActiveGenerateStep(step);
    setAiGenerationRecordsError(null);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    return abortController;
  };

  const endGenerateRequest = () => {
    finishGenerating();
    abortControllerRef.current = null;
    setActiveGenerateStep(null);
  };

  const runXiaohongshuGenerate = async (context: GenerateContext, config: AiConfigProfile) => {
    setGenerationDialogView('content');
    const abortController = beginGenerateRequest('content');
    try {
      // 小红书链路保持原有“一次生成结果、用户再插入”的交互，不进入大纲审核流。
      aiService.configure(config);
      resetOutlineReview();
      const options = buildGenerateOptions(context);
      const finalContent = await aiService.generate(options, (content) => {
        updateGeneratedContent(content);
      }, abortController.signal);
      await saveGenerationRecord(finalContent, options, [], config);
    } catch (error) {
      handleGenerateError(error);
    } finally {
      endGenerateRequest();
    }
  };

  const runEducationOutlineGenerate = async (context: GenerateContext, config: AiConfigProfile) => {
    setGenerationDialogView('outline');
    const abortController = beginGenerateRequest('outline');
    try {
      aiService.configure(config);
      setOutlineDraft('');
      setOutlineKnowledgeContext(undefined);
      setOutlineKnowledgeSources([]);

      const { knowledgeContext, knowledgeSources } = await loadKnowledgeContext(context, abortController.signal);
      setOutlineKnowledgeContext(knowledgeContext);
      setOutlineKnowledgeSources(knowledgeSources);
      setGeneratedKnowledgeSources(knowledgeSources);

      const options = buildGenerateOptions(context, { knowledgeContext });
      const outline = await aiService.generateOutline(options, (content) => {
        setOutlineDraft(content);
      }, abortController.signal);
      setOutlineDraft(outline);
    } catch (error) {
      handleGenerateError(error);
    } finally {
      endGenerateRequest();
    }
  };

  const runEducationDirectGenerate = async (context: GenerateContext, config: AiConfigProfile) => {
    setGenerationDialogView('content');
    const abortController = beginGenerateRequest('content');
    try {
      aiService.configure(config);
      resetOutlineReview();

      // 跳过大纲时仍只检索一次知识库，并把同一批来源交给结果区和生成记录。
      const { knowledgeContext, knowledgeSources } = await loadKnowledgeContext(context, abortController.signal);
      setGeneratedKnowledgeSources(knowledgeSources);

      const options = buildGenerateOptions(context, { knowledgeContext });
      const finalContent = await aiService.generate(options, (content) => {
        updateGeneratedContent(content);
      }, abortController.signal);
      await saveGenerationRecord(finalContent, options, knowledgeSources, config);
    } catch (error) {
      handleGenerateError(error);
    } finally {
      endGenerateRequest();
    }
  };

  const handleGenerateContentFromOutline = async () => {
    const config = useAppStore.getState().getAiConfigForTask('generate');
    if (!config) {
      setGenerateError('请先在「设置」中为「内容生成」分配可用 AI 配置');
      return;
    }

    const context = resolveGenerateContext();
    if (!validateGenerateContext(context)) {
      return;
    }

    const reviewedOutline = outlineDraft.trim();
    if (!reviewedOutline) {
      setGenerateError('请先生成并确认大纲');
      return;
    }

    if (context.shouldUseKnowledgeContext && !outlineKnowledgeContext?.trim()) {
      setGenerateError('请先重新生成大纲，让大纲和正文使用同一批知识库资料');
      return;
    }

    setGenerationDialogView('content');
    const abortController = beginGenerateRequest('content');
    try {
      aiService.configure(config);
      setGeneratedKnowledgeSources(outlineKnowledgeSources);
      const options = buildGenerateOptions(context, {
        knowledgeContext: outlineKnowledgeContext,
        reviewedOutline,
      });
      const finalContent = await aiService.generateFromOutline(options, (content) => {
        updateGeneratedContent(content);
      }, abortController.signal);
      await saveGenerationRecord(finalContent, options, outlineKnowledgeSources, config);
    } catch (error) {
      handleGenerateError(error);
    } finally {
      endGenerateRequest();
    }
  };

  const handleGenerate = async () => {
    const config = useAppStore.getState().getAiConfigForTask('generate');
    if (!config) {
      setGenerateError('请先在「设置」中为「内容生成」分配可用 AI 配置');
      return;
    }

    const context = resolveGenerateContext();
    if (!validateGenerateContext(context)) {
      return;
    }

    if (context.isXiaohongshuMode) {
      await runXiaohongshuGenerate(context, config);
      return;
    }

    if (!shouldGenerateOutline) {
      await runEducationDirectGenerate(context, config);
      return;
    }

    await runEducationOutlineGenerate(context, config);
  };

  const handleStopGenerate = () => {
    abortControllerRef.current?.abort();
  };

  const handleInsertToDocument = async () => {
    if (!generatedContent.trim()) return;

    try {
      const insertedBlockId = await insertLayoutMarkdownBlocks({ markdown: generatedContent });
      if (!insertedBlockId) {
        setGenerateError('插入失败：AI 内容没有解析出可插入的文档结构');
        return;
      }

      clearGeneratedContent();
      resetOutlineReview();
      setGenerationDialogView(null);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : '插入失败：无法解析 AI 生成内容');
    }
  };

  const handleClear = () => {
    clearGeneratedContent();
    resetOutlineReview();
    setGenerationDialogView(null);
  };

  const handleFillTitleFromResult = () => {
    const title = getFirstUsefulLine(generatedContent);
    if (title) {
      setSelectedXiaohongshuTitle(title);
    }
  };

  const handleFillCopyFromResult = () => {
    if (generatedContent.trim()) {
      setSelectedXiaohongshuCopy(generatedContent.trim());
    }
  };

  const isXiaohongshuMode = isXiaohongshuGenerateType(generateType);
  const currentArticleTitle = layoutDocument?.title?.trim() || '当前文档暂无标题';
  const currentArticleContent = layoutDocument ? layoutDocumentToMarkdown(layoutDocument) : '';
  const currentArticleSummary = currentArticleContent.trim()
    ? `已读取当前文档内容，约 ${currentArticleContent.trim().length} 字。`
    : '当前文档内容为空，将主要根据你填写的选题生成。';
  const selectedKnowledgeDatasetCount = selectedRagflowDatasetIds.length;
  const knowledgeSourceLabel =
    knowledgeSourceForGenerate === 'ragflow'
      ? 'RAGFlow'
      : '未启用';
  const knowledgeSourceSummary =
    knowledgeSourceForGenerate === 'ragflow'
      ? `已选 ${selectedKnowledgeDatasetCount} 个数据集`
      : '可在左侧个人知识库开启';
  const availableStructureTemplates = isEducationGenerateType(generateType)
    ? aiStructureTemplates.filter((template) => template.scope === 'all' || template.scope === generateType)
    : [];
  const selectedStructureTemplate = getSelectedStructureTemplate();
  const selectedStructureTemplateValue = selectedStructureTemplate?.id ?? '';
  const stopGenerateLabel =
    activeGenerateStep === 'outline'
      ? '停止生成大纲'
      : activeGenerateStep === 'content'
        ? '停止生成正文'
        : '停止生成';
  const startGenerateLabel = isXiaohongshuMode || !shouldGenerateOutline
    ? '开始生成'
    : outlineDraft.trim()
      ? '重新生成大纲'
      : '生成大纲';

  return (
    <div className="ai-generate-tab">
      <div className="ai-section">
        <h3 className="ai-section-title">快速生成</h3>
        <div className="ai-quick-cards">
          {(Object.keys(GENERATE_TYPE_LABELS) as GenerateType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={`ai-quick-card ${generateType === type ? 'active' : ''}`}
              onClick={() => setGenerateType(type)}
            >
              {GENERATE_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      <div className="ai-section">
        <h3 className="ai-section-title">生成设置</h3>
        <div className="ai-form">
          <div className="ai-form-group">
            <label htmlFor="ai-topic">{isXiaohongshuMode ? '选题 / 补充要求' : '主题'}</label>
            <input
              id="ai-topic"
              type="text"
              className="ai-input"
              placeholder={isXiaohongshuMode ? '例如：适合新手的排版技巧' : '例如：高中数学函数章节'}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={isGenerating}
            />
          </div>

          {isXiaohongshuMode ? (
            <>
              <div className="ai-form-group">
                <label>当前文章</label>
                <div className="ai-context-box">
                  <strong>{currentArticleTitle}</strong>
                  <span>{currentArticleSummary}</span>
                </div>
              </div>

              {(generateType === 'xiaohongshuCopy' || generateType === 'xiaohongshuCover') && (
                <div className="ai-form-group">
                  <label htmlFor="ai-xiaohongshu-title">已选小红书标题</label>
                  <input
                    id="ai-xiaohongshu-title"
                    type="text"
                    className="ai-input"
                    placeholder="从标题推荐结果里选一个标题填到这里"
                    value={selectedXiaohongshuTitle}
                    onChange={(e) => setSelectedXiaohongshuTitle(e.target.value)}
                    disabled={isGenerating}
                  />
                  {generatedContent && generateType === 'xiaohongshuCopy' ? (
                    <button
                      type="button"
                      className="ai-button ai-button-small"
                      onClick={handleFillTitleFromResult}
                      disabled={isGenerating}
                    >
                      从当前结果带入标题
                    </button>
                  ) : null}
                </div>
              )}

              {generateType === 'xiaohongshuCover' && (
                <div className="ai-form-group">
                  <label htmlFor="ai-xiaohongshu-copy">小红书文案</label>
                  <textarea
                    id="ai-xiaohongshu-copy"
                    className="ai-textarea"
                    placeholder="填写或粘贴已生成的小红书文案"
                    value={selectedXiaohongshuCopy}
                    onChange={(e) => setSelectedXiaohongshuCopy(e.target.value)}
                    disabled={isGenerating}
                    rows={5}
                  />
                  {generatedContent ? (
                    <button
                      type="button"
                      className="ai-button ai-button-small"
                      onClick={handleFillCopyFromResult}
                      disabled={isGenerating}
                    >
                      用当前结果作为文案
                    </button>
                  ) : null}
                </div>
              )}

              <p className="ai-hint">
                主图 V1 会生成设计方案和图片生成提示词，不会直接生成图片文件。
              </p>
            </>
          ) : (
            <>
              <div className="ai-form-row">
                <div className="ai-form-group">
                  <label htmlFor="ai-grade">年级（可选）</label>
                  <input
                    id="ai-grade"
                    type="text"
                    className="ai-input"
                    placeholder="例如：高一"
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                    disabled={isGenerating}
                  />
                </div>

                <div className="ai-form-group">
                  <label htmlFor="ai-subject">科目（可选）</label>
                  <input
                    id="ai-subject"
                    type="text"
                    className="ai-input"
                    placeholder="例如：数学"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    disabled={isGenerating}
                  />
                </div>
              </div>

              <div className="ai-form-group">
                <label htmlFor="ai-requirement-description">要求描述（可选）</label>
                <textarea
                  id="ai-requirement-description"
                  className="ai-textarea"
                  placeholder="例如：适合期中复习，内容要带例题，语气更简洁"
                  value={requirementDescription}
                  onChange={(e) => setRequirementDescription(e.target.value)}
                  disabled={isGenerating}
                  rows={3}
                />
              </div>

              <div className="ai-form-group">
                <label htmlFor="ai-length">内容长度</label>
                <select
                  id="ai-length"
                  className="ai-select"
                  value={length}
                  onChange={(e) => setLength(e.target.value as 'short' | 'medium' | 'long')}
                  disabled={isGenerating}
                >
                  {(Object.keys(LENGTH_LABELS) as Array<'short' | 'medium' | 'long'>).map((len) => (
                    <option key={len} value={len}>
                      {LENGTH_LABELS[len]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ai-form-group">
                <label
                  htmlFor="ai-generate-outline"
                  className={shouldGenerateOutline ? 'ai-outline-mode-option checked' : 'ai-outline-mode-option'}
                >
                  <input
                    id="ai-generate-outline"
                    type="checkbox"
                    checked={shouldGenerateOutline}
                    onChange={(event) => setShouldGenerateOutline(event.target.checked)}
                    disabled={isGenerating}
                  />
                  <span>生成大纲</span>
                </label>
              </div>

              <div className="ai-form-group">
                <label htmlFor="ai-structure-template">文章结构模板</label>
                <select
                  id="ai-structure-template"
                  className="ai-select"
                  value={selectedStructureTemplateValue}
                  onChange={(event) => setSelectedAiStructureTemplateId(event.target.value || null)}
                  disabled={isGenerating || availableStructureTemplates.length === 0}
                >
                  <option value="">
                    {availableStructureTemplates.length > 0 ? '不使用模板' : '暂无模板，请先新增'}
                  </option>
                  {availableStructureTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}（{getStructureTemplateScopeLabel(template.scope)}）
                    </option>
                  ))}
                </select>
                <div className="ai-template-actions">
                  <button
                    type="button"
                    className="ai-button ai-button-small"
                    onClick={handleCreateStructureTemplate}
                    disabled={isGenerating}
                  >
                    新增模板
                  </button>
                  <button
                    type="button"
                    className="ai-button ai-button-small"
                    onClick={handleEditStructureTemplate}
                    disabled={isGenerating || !selectedStructureTemplate}
                  >
                    编辑模板
                  </button>
                  <button
                    type="button"
                    className="ai-button ai-button-small ai-button-danger"
                    onClick={handleDeleteStructureTemplate}
                    disabled={isGenerating || !selectedStructureTemplate}
                  >
                    删除模板
                  </button>
                </div>
                {structureTemplateError && (
                  <div className="ai-error ai-template-error">
                    <span>{structureTemplateError}</span>
                  </div>
                )}
                {isStructureTemplateEditorOpen && (
                  <div className="ai-template-editor">
                    <div className="ai-form-group">
                      <label htmlFor="ai-template-name">模板名称</label>
                      <input
                        id="ai-template-name"
                        type="text"
                        className="ai-input"
                        value={structureTemplateName}
                        onChange={(event) => setStructureTemplateName(event.target.value)}
                        disabled={isGenerating}
                      />
                    </div>
                    <div className="ai-form-group">
                      <label htmlFor="ai-template-scope">适用类型</label>
                      <select
                        id="ai-template-scope"
                        className="ai-select"
                        value={structureTemplateScope}
                        onChange={(event) => setStructureTemplateScope(event.target.value as AiStructureTemplateScope)}
                        disabled={isGenerating}
                      >
                        <option value="all">全部类型</option>
                        <option value="lecture">讲义</option>
                        <option value="summary">知识点总结</option>
                        <option value="exercise">练习题</option>
                        <option value="exam">试卷初稿</option>
                      </select>
                    </div>
                    <div className="ai-form-group">
                      <label htmlFor="ai-template-structure">文章结构</label>
                      <textarea
                        id="ai-template-structure"
                        className="ai-textarea ai-template-structure-textarea"
                        value={structureTemplateStructure}
                        onChange={(event) => setStructureTemplateStructure(event.target.value)}
                        disabled={isGenerating}
                        rows={8}
                      />
                    </div>
                    <div className="ai-form-group">
                      <label htmlFor="ai-template-output-rules">输出要求（可选）</label>
                      <textarea
                        id="ai-template-output-rules"
                        className="ai-textarea"
                        value={structureTemplateOutputRules}
                        onChange={(event) => setStructureTemplateOutputRules(event.target.value)}
                        disabled={isGenerating}
                        rows={3}
                      />
                    </div>
                    <div className="ai-template-actions">
                      <button
                        type="button"
                        className="ai-button ai-button-small ai-button-primary"
                        onClick={handleSaveStructureTemplate}
                        disabled={isGenerating}
                      >
                        保存模板
                      </button>
                      <button
                        type="button"
                        className="ai-button ai-button-small"
                        onClick={() => {
                          resetStructureTemplateEditor();
                          setIsStructureTemplateEditorOpen(false);
                        }}
                        disabled={isGenerating}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="ai-form-group">
                <label>语义块生成</label>
                <div className="ai-semantic-role-grid">
                  {AI_GENERATE_SEMANTIC_ROLE_OPTIONS.map((option) => {
                    const checked = generateSemanticRoleIds.includes(option.id);
                    return (
                      <label
                        key={option.id}
                        className={checked ? 'ai-semantic-role-option checked' : 'ai-semantic-role-option'}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => handleToggleSemanticRole(option.id, event.target.checked)}
                          disabled={isGenerating}
                        />
                        <span className="ai-semantic-role-label">{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="ai-form-group">
                <label>个人知识库</label>
                <div className="ai-context-box">
                  <strong>{knowledgeSourceLabel}</strong>
                  <span>{knowledgeSourceSummary}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {generateError && (
        <div className="ai-error">
          <span>{generateError}</span>
        </div>
      )}

      <div className="ai-section">
        {isGenerating ? (
          <button type="button" className="ai-button ai-button-stop" onClick={handleStopGenerate}>
            {stopGenerateLabel}
          </button>
        ) : (
          <button type="button" className="ai-button ai-button-primary" onClick={handleGenerate}>
            {startGenerateLabel}
          </button>
        )}
      </div>

      {!isXiaohongshuMode && shouldGenerateOutline && outlineDraft && (
        <div className="ai-section ai-result-section">
          <div className="ai-result-entry-header">
            <div>
              <h3 className="ai-section-title">大纲审核</h3>
              <span>{outlineDraft.trim().split(/\r?\n/).filter(Boolean).length} 行 · {outlineDraft.trim().length} 字</span>
            </div>
            <button
              type="button"
              className="ai-button ai-button-small ai-result-open-button"
              onClick={() => setGenerationDialogView('outline')}
            >
              <Maximize2 size={14} />
              打开大纲
            </button>
          </div>
        </div>
      )}

      {generatedContent && (
        <div className="ai-section ai-result-section">
          <div className="ai-result-entry-header">
            <div>
              <h3 className="ai-section-title">生成结果</h3>
              <span>{generatedContent.trim().split(/\r?\n/).filter(Boolean).length} 行 · {generatedContent.trim().length} 字</span>
            </div>
            <button
              type="button"
              className="ai-button ai-button-small ai-result-open-button"
              onClick={() => setGenerationDialogView('content')}
            >
              <Maximize2 size={14} />
              查看结果
            </button>
          </div>
        </div>
      )}

      <AiGenerationDialog
        isOpen={generationDialogView !== null}
        view={generationDialogView ?? 'outline'}
        activeStep={activeGenerateStep}
        isGenerating={isGenerating}
        error={generateError}
        outlineDraft={outlineDraft}
        generatedContent={generatedContent}
        knowledgeSources={generatedKnowledgeSources}
        onOutlineChange={setOutlineDraft}
        onClose={handleCloseGenerationDialog}
        onStop={handleStopGenerate}
        onRegenerateOutline={handleGenerate}
        onGenerateContent={handleGenerateContentFromOutline}
        onInsertToDocument={handleInsertToDocument}
        onClear={handleClear}
      />
    </div>
  );
}
