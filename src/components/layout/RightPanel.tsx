import { useEffect, useState } from 'react';
import { Columns2, FileText, Image as ImageIcon, Layers3, PanelBottom, PanelTop, SlidersHorizontal } from 'lucide-react';
import { fontFamilyPlaceholderValue, textFontFamilyGroups } from '@/constants/fontFamilies';
import { highlightColorOptions, standardColorOptions } from '@/constants/styleColors';
import {
  getSelectedBlockquoteContext,
  getSelectedLayoutNodeInfo,
  findTopLevelBlockForSelectedNode,
  createCustomSemanticRoleId,
  getEnabledSemanticRoles,
  getLayoutBlockPlainText,
  getLayoutListItemLevel,
  getManualSemanticBlockPresetId,
  getPreSemanticBlockPresetId,
  getSemanticBlockPresetById,
  getSemanticBlockPresetDefinitions,
  getSemanticBlockPresetPresentation,
  getSemanticBlockPresetSource,
  getSemanticRoleDefaultBlockPresetId,
  getSemanticRolePresentation,
  getSemanticRoleById,
  normalizeSemanticRoleConfig,
  supportsSemanticBlockPreset,
  type AnswerBlockPlacementMode,
  type AnswerDisplayMode,
  type BlockStyleOverrides,
  type BlockquoteStructureAction,
  type ColumnSectionColumnCount,
  type ListStructureAction,
  type LayoutBlock,
  type LayoutResource,
  type LayoutStyleSheet,
  type LayoutSemanticRoleConfig,
  type SourceRange,
  type SelectedBlockquoteContext,
  type SelectedLayoutNodeInfo,
  type SemanticKeywordScanResult,
  type TableCellRangeSelection,
  type TableColumnAlign,
  type TableStructureAction,
  type ListBatchCheckedAction,
  type ListBatchCheckedScope,
  type ListIndentAction,
  type ListReorderAction,
  type ListTaskConversionAction,
  type TextMarkType,
  type TextRangeSelection,
  type TextRun,
  type ImageBlockMetadata,
  type ImageWrapMode,
  type ImageWrapSide,
  type LayoutBlockSemantic,
  type SemanticBlockPresetId,
} from '@/engine/document-model';
import { buildFontFamilyGroupsWithImportedFonts } from '@/engine/document-model/fontResources';
import { isImageTextWrapMode, resolveImageLayout } from '@/engine/document-model/imageLayout';
import { renderEquationToHtml } from '@/engine/document-model/equation';
import {
  blockSpacingPresetDefinitions,
  headerFooterPresetDefinitions,
  marginPresetDefinitions,
  pageSizeDefinitions,
  templateDefinitions,
  themeDefinitions,
} from '@/engine/style/presets';
import { selectLocalImageFile } from '@/services/FileService';
import {
  getExportCheckSeverityLabel,
  getExportCheckTargetLabel,
  type ExportCheckResult,
} from '@/services/ExportCheckService';
import { headerFooterVariableLabels } from '@/engine/style/headerFooterContent';
import {
  getBlockStyleSourceSummary,
  resolveBlockDefaultTextMetrics,
  resolveBlockEffectiveTextMetrics,
} from '@/engine/style/blockStyleResolution';
import {
  getQuickBlockStyleScopeForBlock,
  resolveQuickBlockStyleForBlock,
  type QuickBlockStyleScope,
} from '@/engine/style/quickBlockStyle';
import { listPaginationAlgorithms } from '@/engine/typesetting';
import type { LayoutWarning } from '@/engine/typesetting/types';
import type {
  BlockSpacingParameterKey,
  BlockSpacingParameters,
  BlockSpacingPreset,
  HeaderFooterArea,
  HeaderFooterPresetId,
  HeaderFooterSlot,
  MarginPresetId,
  MarginSide,
  PageBackgroundImageFit,
  PageBackgroundMode,
  PageBackgroundSettings,
  PageColumnCount,
  PageOrientation,
  PageSizeId,
  PdfWatermarkSettings,
  PaginationAlgorithmId,
  PaginationBehaviorOption,
  StyleSettings,
  TemplateId,
  ThemeId,
} from '@/engine/style/types';
import { useResolvedStyleContract } from '@/hooks/useResolvedStyleContract';
import { useAppStore } from '@/store';
import type { CanvasTextSelectionState, PageSettingsTab, WorkspaceViewMode } from '@/types/workspace';
import { getBlockStyleControlSupportByBlockType } from './objectStyleSupport';
import { SyntaxMappingPanel } from '@/components/settings/SyntaxMappingPanel';
import { AiPanel } from '@/components/ai/AiPanel';

interface RightPanelProps {
  currentPageCount: number;
  headingCount: number;
  characterCount: number;
  workspaceViewMode: WorkspaceViewMode;
  layoutWarnings: LayoutWarning[];
  canvasTextSelection: CanvasTextSelectionState;
  exportCheckResult: ExportCheckResult;
}

type RightMainTab = '对象属性' | '页面设置' | '导出检查' | '语法映射' | '语义规则' | 'AI助手';

const rightMainTabs: Array<{
  id: RightMainTab;
  label: string;
  description: string;
}> = [
  {
    id: '对象属性',
    label: '对象属性',
    description: '查看当前画布对象',
  },
  {
    id: '页面设置',
    label: '页面设置',
    description: '控制页面规格、边距与模板',
  },
  {
    id: '导出检查',
    label: '导出检查',
    description: '导出前查看 PDF / DOCX 风险',
  },
  {
    id: '语法映射',
    label: '语法映射',
    description: '配置文本标记与块级指令映射',
  },
  {
    id: '语义规则',
    label: '语义规则',
    description: '配置语义块和关键词识别',
  },
  {
    id: 'AI助手',
    label: 'AI助手',
    description: 'AI 生成、优化与检查',
  },
];

const pageSettingsTabs: Array<{
  id: PageSettingsTab;
  label: string;
  description: string;
  icon: typeof FileText;
}> = [
  { id: '页面规格', label: '页面规格', description: '纸张与方向', icon: FileText },
  { id: '页边距', label: '页边距', description: '预设与自定义边距', icon: PanelTop },
  { id: '页眉页脚预留', label: '页眉页脚预留', description: '控制预留区域高度', icon: PanelBottom },
  { id: '分栏', label: '分栏', description: '正文栏数与栏间距', icon: Columns2 },
  { id: '块排版', label: '块排版', description: '块间距与预设', icon: SlidersHorizontal },
  { id: '页面背景', label: '页面背景', description: '纯色与图片背景', icon: ImageIcon },
  { id: 'PDF 水印', label: 'PDF 水印', description: '仅对 PDF 导出加水印', icon: SlidersHorizontal },
  { id: '模板起点', label: '模板起点', description: '结构模板与风格主题', icon: Layers3 },
  { id: '分页策略', label: '分页策略', description: '标题、代码块与图片保护', icon: SlidersHorizontal },
];

const blockTypeLabels: Record<LayoutBlock['type'], string> = {
  paragraph: '段落',
  heading: '标题',
  toc: '目录',
  list: '列表',
  table: '表格',
  image: '图片',
  equation: '公式',
  blockquote: '引用',
  code: '代码块',
  horizontalRule: '分隔线',
  columnSection: '局部分栏区段',
  columnBreak: '分栏断点',
  pageBreak: '分页符',
};

const topLevelBlockDeleteLabels: Partial<Record<LayoutBlock['type'], string>> = {
  paragraph: '空文本块',
  heading: '标题',
  toc: '目录',
  list: '列表',
  table: '表格',
  image: '图片',
  equation: '公式',
  blockquote: '引用',
  columnSection: '局部分栏区段',
  code: '代码块',
  columnBreak: '分栏断点',
  pageBreak: '分页符',
};

const blockStyleLabels: Record<string, string> = {
  textAlign: '对齐',
  lineHeight: '行高',
  spaceBefore: '段前',
  spaceAfter: '段后',
  indentLeft: '左缩进',
  indentRight: '右缩进',
  firstLineIndent: '首行缩进',
  hangingIndent: '悬挂缩进',
  backgroundColor: '背景色',
};

type BlockStyleApplyMode = 'current' | 'sameType';

const quickBlockStyleScopeLabels: Record<QuickBlockStyleScope, string> = {
  heading1: 'H1',
  heading2: 'H2',
  heading3: 'H3',
  heading4: 'H4',
  paragraph: '段落',
  list: '列表',
  table: '表格',
  code: '代码块',
};

const lineSpacingPresetOptions = [
  { id: 'single', label: '单倍', multiple: 1 },
  { id: 'onePointTwoFive', label: '1.25 倍', multiple: 1.25 },
  { id: 'onePointFive', label: '1.5 倍', multiple: 1.5 },
  { id: 'double', label: '2 倍', multiple: 2 },
] as const;

function resolveLineSpacingMultiple(lineHeight: number, fontSize: number): number {
  const safeFontSize = Number.isFinite(fontSize) ? Math.max(1, fontSize) : 1;
  const safeLineHeight = Number.isFinite(lineHeight) ? Math.max(1, lineHeight) : safeFontSize;
  return Number((safeLineHeight / safeFontSize).toFixed(2));
}

function resolveLineHeightFromMultiple(multiple: number, fontSize: number): number {
  const safeMultiple = Number.isFinite(multiple) ? Math.max(0.5, Math.min(4, multiple)) : 1;
  const safeFontSize = Number.isFinite(fontSize) ? Math.max(1, fontSize) : 16;
  return Math.max(16, Math.min(200, Math.round(safeFontSize * safeMultiple)));
}

function resolveActiveLineSpacingPresetId(
  multiple: number,
): (typeof lineSpacingPresetOptions)[number]['id'] | null {
  const activePreset = lineSpacingPresetOptions.find((option) => Math.abs(option.multiple - multiple) < 0.03);
  return activePreset?.id ?? null;
}

function formatLineSpacingMultiple(multiple: number): string {
  return Number.isInteger(multiple) ? String(multiple) : multiple.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function normalizeLineSpacingMultipleInput(value: string): number | null {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return null;
  }

  return Math.max(0.5, Math.min(4, Number(nextValue.toFixed(2))));
}

const semanticSourceLabels: Record<LayoutBlockSemantic['source'], string> = {
  manual: '手动设置',
  'markdown-prefix': 'Markdown 前缀',
  keyword: '关键词识别',
  ai: 'AI 识别',
};

const orientationOptions: Array<{ id: PageOrientation; label: string; description: string }> = [
  { id: 'portrait', label: '纵向', description: '适合标准阅读与打印' },
  { id: 'landscape', label: '横向', description: '适合宽表格与大纲展示' },
];

const marginSideLabels: Record<MarginSide, string> = {
  top: '上',
  right: '右',
  bottom: '下',
  left: '左',
};

const pageColumnOptions: Array<{ id: PageColumnCount; label: string; description: string }> = [
  { id: 1, label: '单栏', description: '适合常规阅读与打印' },
  { id: 2, label: '双栏', description: '适合讲义、试卷和高信息密度排版' },
  { id: 3, label: '三栏', description: '适合摘要、索引和更紧凑的信息布局' },
];

const pageBackgroundModeOptions: Array<{ id: PageBackgroundMode; label: string; description: string }> = [
  { id: 'theme', label: '跟随主题', description: '使用当前风格主题自带背景' },
  { id: 'color', label: '纯色背景', description: '用单一颜色覆盖页面背景' },
  { id: 'image', label: '图片背景', description: '使用本地图片作为页面背景' },
];

const pageBackgroundFitOptions: Array<{ id: PageBackgroundImageFit; label: string; description: string }> = [
  { id: 'cover', label: '铺满页面', description: '图片裁切铺满整页' },
  { id: 'contain', label: '居中包含', description: '完整显示图片并居中' },
  { id: 'repeat', label: '平铺', description: '按原图尺寸重复铺开' },
];

const pdfWatermarkModeOptions: Array<{
  id: PdfWatermarkSettings['kind'];
  label: string;
  description: string;
}> = [
  { id: 'text', label: '文字水印', description: '使用自定义文字重复铺设整页水印' },
  { id: 'image', label: '图片水印', description: '使用本地图片重复铺设整页水印' },
];

const paginationBehaviorOptions: Array<{
  id: PaginationBehaviorOption;
  label: string;
  description: string;
}> = [
  { id: 'keepHeadingWithNext', label: '标题与下段同页', description: '避免标题出现在页尾孤行' },
  { id: 'avoidBreakInsideCodeBlocks', label: '代码块整块保护', description: '优先保持代码块不被拆开' },
  { id: 'avoidBreakInsideTables', label: '表格整块保护', description: '表格跨页能力完成前尽量整体显示' },
  { id: 'avoidBreakInsideImages', label: '图片整块保护', description: '图片与说明尽量保持在同一页' },
];

const answerDisplayOptions: Array<{
  id: AnswerDisplayMode;
  label: string;
  description: string;
}> = [
  { id: 'show', label: '显示答案', description: '显示下划线内容与答案解析' },
  { id: 'hide', label: '隐藏答案解析', description: '隐藏语义答案与解析，保留正文' },
  { id: 'underline', label: '默写挖空', description: '隐藏下划线文字但保留下划线，同时隐藏答案解析' },
];

const answerBlockPlacementOptions: Array<{
  id: AnswerBlockPlacementMode;
  label: string;
  description: string;
}> = [
  { id: 'inline', label: '题后显示', description: '保持答案解析在原位，跟着题目后面显示' },
  { id: 'document-end', label: '文末统一', description: '把顶层答案解析统一汇总到文档最后' },
];

const blockSpacingParameterGroups: Array<{
  title: string;
  hint: string;
  items: Array<{
    id: BlockSpacingParameterKey;
    label: string;
    max?: number;
    step?: number;
  }>;
}> = [
  {
    title: '标题外边距',
    hint: '控制标题块上下留白',
    items: [
      { id: 'heading1SpaceBefore', label: 'H1 段前' },
      { id: 'heading1SpaceAfter', label: 'H1 段后' },
      { id: 'heading2SpaceBefore', label: 'H2 段前' },
      { id: 'heading2SpaceAfter', label: 'H2 段后' },
      { id: 'heading3SpaceBefore', label: 'H3 段前' },
      { id: 'heading3SpaceAfter', label: 'H3 段后' },
    ],
  },
  {
    title: '正文块间距',
    hint: '控制正文、列表和引用之间的距离',
    items: [
      { id: 'paragraphSpaceBefore', label: '段落段前' },
      { id: 'paragraphSpaceAfter', label: '段落段后' },
      { id: 'listSpaceBefore', label: '列表段前' },
      { id: 'listSpaceAfter', label: '列表段后' },
      { id: 'listItemGap', label: '列表项间距' },
      { id: 'blockquoteSpaceBefore', label: '引用段前' },
      { id: 'blockquoteSpaceAfter', label: '引用段后' },
    ],
  },
  {
    title: '块内边距',
    hint: '控制文字块、代码块和表格内部留白',
    items: [
      { id: 'textInsetLeft', label: '文字块左内缩', max: 200, step: 2 },
      { id: 'textInsetRight', label: '文字块右内缩', max: 200, step: 2 },
      { id: 'codePaddingX', label: '代码左右内边距' },
      { id: 'codePaddingY', label: '代码上下内边距' },
      { id: 'tableCellPaddingX', label: '单元格左右内边距' },
      { id: 'tableCellPaddingY', label: '单元格上下内边距' },
    ],
  },
  {
    title: '其他块外边距',
    hint: '控制代码、表格、图片和分隔线之间的距离',
    items: [
      { id: 'codeSpaceBefore', label: '代码段前' },
      { id: 'codeSpaceAfter', label: '代码段后' },
      { id: 'tableSpaceBefore', label: '表格段前' },
      { id: 'tableSpaceAfter', label: '表格段后' },
      { id: 'imageSpaceBefore', label: '图片段前' },
      { id: 'imageSpaceAfter', label: '图片段后' },
      { id: 'ruleSpaceBefore', label: '分隔线段前' },
      { id: 'ruleSpaceAfter', label: '分隔线段后' },
    ],
  },
];

const textMarkOptions: Array<{ id: TextMarkType; label: string }> = [
  { id: 'bold', label: '加粗' },
  { id: 'italic', label: '斜体' },
  { id: 'underline', label: '下划线' },
  { id: 'strike', label: '删除线' },
];

const textEditableBlockTypes: LayoutBlock['type'][] = ['heading', 'paragraph', 'code'];
const defaultTextColor = '#344054';
const defaultHighlightColor = '#FEF08A';

const tableStructureActions: Array<{
  id: TableStructureAction;
  label: string;
  disabledWhen?: 'singleRow' | 'singleColumn';
}> = [
  { id: 'insertRowAbove', label: '上方插入行' },
  { id: 'insertRowBelow', label: '下方插入行' },
  { id: 'insertColumnLeft', label: '左侧插入列' },
  { id: 'insertColumnRight', label: '右侧插入列' },
  { id: 'deleteRow', label: '删除当前行', disabledWhen: 'singleRow' },
  { id: 'deleteColumn', label: '删除当前列', disabledWhen: 'singleColumn' },
];

const tableColumnAlignOptions: Array<{
  id: TableColumnAlign;
  label: string;
}> = [
  { id: null, label: '默认' },
  { id: 'left', label: '左对齐' },
  { id: 'center', label: '居中' },
  { id: 'right', label: '右对齐' },
];

const listStructureActions: Array<{
  id: ListStructureAction;
  label: string;
  disabledWhen?: 'singleItem';
}> = [
  { id: 'insertItemAbove', label: '上方插入项' },
  { id: 'insertItemBelow', label: '下方插入项' },
  { id: 'deleteItem', label: '删除当前项', disabledWhen: 'singleItem' },
];

const blockquoteStructureActions: Array<{
  id: BlockquoteStructureAction;
  label: string;
  disabledWhen?: 'singleBlock';
}> = [
  { id: 'insertParagraphAbove', label: '上方插入段落' },
  { id: 'insertParagraphBelow', label: '下方插入段落' },
  { id: 'deleteBlock', label: '删除当前子块', disabledWhen: 'singleBlock' },
];

function getViewModeLabel(workspaceViewMode: WorkspaceViewMode): string {
  return workspaceViewMode === 'preview' ? '预览视图' : '分屏视图';
}

function renderSummaryCard(label: string, value: string): JSX.Element {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getSourceRangeLabel(sourceRange: SourceRange | null): string {
  if (!sourceRange) {
    return '暂无源码定位';
  }

  return `第 ${sourceRange.start.line} 行 ${sourceRange.start.column} 列 到 第 ${sourceRange.end.line} 行 ${sourceRange.end.column} 列`;
}

function getSelectedBlockTextSummary(block: LayoutBlock): string {
  const text = getLayoutBlockPlainText(block).replace(/\s+/g, ' ').trim();

  if (text) {
    return text.length > 80 ? `${text.slice(0, 80)}...` : text;
  }

  if (block.type === 'image' && block.metadata.kind === 'image') {
    return block.metadata.src || '图片资源';
  }

  return '暂无文本内容';
}

function getBlockStyleSummary(block: LayoutBlock): string {
  const styleEntries = Object.entries(block.blockStyleOverrides).filter(([, value]) => value !== undefined);

  if (styleEntries.length === 0) {
    return '无局部覆盖';
  }

  return styleEntries
    .map(([key, value]) => `${blockStyleLabels[key] ?? key}：${String(value)}`)
    .join('；');
}

function getBlockStyleSourceText(
  block: LayoutBlock,
  resolvedStyleContract: ReturnType<typeof useResolvedStyleContract>,
  layoutStyles: LayoutStyleSheet | null | undefined,
): string {
  return getBlockStyleSourceSummary(block, resolvedStyleContract, layoutStyles);
}

function renderObjectPropertyRow(label: string, value: string): JSX.Element {
  return (
    <div className="object-property-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getSemanticRoleSummary(
  semantic: LayoutBlockSemantic | undefined,
  semanticRoleConfig: LayoutSemanticRoleConfig,
): string {
  if (!semantic) {
    return '未设置';
  }

  const role = getSemanticRoleById(semantic.roleId, semanticRoleConfig);
  return semantic.alias
    ? `${semantic.alias} -> ${role?.name ?? semantic.roleId}`
    : role?.name ?? semantic.roleId;
}

function getSemanticBlockPresetSummary(
  block: LayoutBlock,
  semanticRoleConfig: LayoutSemanticRoleConfig,
): string {
  const presentation = getSemanticBlockPresetPresentation(block, semanticRoleConfig);
  return presentation?.label ?? '未设置';
}

function getSemanticBlockPresetSourceSummary(
  block: LayoutBlock,
  semanticRoleConfig: LayoutSemanticRoleConfig,
): string {
  const source = getSemanticBlockPresetSource(block, semanticRoleConfig);
  if (source === 'semantic-default') {
    return '跟随语义默认';
  }

  if (source === 'manual') {
    return block.semantic?.roleId ? '手动覆盖' : '普通块手动';
  }

  return block.semantic?.roleId ? '当前语义未绑定默认块模板' : '未设置';
}

function getSemanticBlockPresetFallbackSummary(
  block: LayoutBlock,
): string {
  const fallbackPresetId = getPreSemanticBlockPresetId(block);
  if (fallbackPresetId === undefined) {
    return '未进入语义接管';
  }

  if (fallbackPresetId === null) {
    return '无块模板';
  }

  return getSemanticBlockPresetById(fallbackPresetId)?.name ?? fallbackPresetId;
}

function renderSemanticRolePanel({
  block,
  semanticRoleConfig,
  onChange,
}: {
  block: LayoutBlock;
  semanticRoleConfig: LayoutSemanticRoleConfig;
  onChange: (semantic: LayoutBlockSemantic | null) => void;
}): JSX.Element {
  const currentSemantic = block.semantic;
  const currentRoleId = currentSemantic?.roleId ?? '';
  const currentRole = getSemanticRoleById(currentRoleId, semanticRoleConfig);
  const currentPresentation = getSemanticRolePresentation(block, semanticRoleConfig);
  const semanticRoles = getEnabledSemanticRoles(semanticRoleConfig);

  return (
    <section className="detail-panel object-detail-panel">
      <div className="detail-panel-head">
        <h3>语义块</h3>
        <span>{currentRole ? currentRole.name : '为当前块标记内容角色'}</span>
      </div>
      <div className="object-property-list">
        {renderObjectPropertyRow('当前语义', getSemanticRoleSummary(currentSemantic, semanticRoleConfig))}
        {renderObjectPropertyRow('来源', currentSemantic ? semanticSourceLabels[currentSemantic.source] : '未设置')}
        {renderObjectPropertyRow('类型', currentPresentation ? (currentPresentation.isCustom ? '自定义语义' : '内置语义') : '未设置')}
        {renderObjectPropertyRow('颜色', currentPresentation?.color ?? '未设置')}
      </div>
      <div className="property-stack">
        <label>
          语义角色
          <select
            className="style-select"
            value={currentRoleId}
            onChange={(event) => {
              const nextRole = getSemanticRoleById(event.target.value, semanticRoleConfig);
              onChange(
                nextRole
                  ? {
                      roleId: nextRole.id,
                      alias: nextRole.name,
                      source: 'manual',
                    }
                  : null,
              );
            }}
          >
            <option value="">无</option>
            {semanticRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.builtIn === false ? `${role.name}（自定义）` : role.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="micro-button"
          disabled={!currentSemantic}
          onClick={() => onChange(null)}
        >
          清除语义
        </button>
      </div>
    </section>
  );
}

function renderSemanticBlockPresetPanel({
  block,
  semanticRoleConfig,
  onChange,
}: {
  block: LayoutBlock;
  semanticRoleConfig: LayoutSemanticRoleConfig;
  onChange: (presetId: SemanticBlockPresetId | null) => void;
}): JSX.Element | null {
  if (!supportsSemanticBlockPreset(block)) {
    return null;
  }

  const presetOptions = getSemanticBlockPresetDefinitions();
  const currentManualPresetId = getManualSemanticBlockPresetId(block);
  const currentPresetPresentation = getSemanticBlockPresetPresentation(block, semanticRoleConfig);
  const roleDefaultPresetId = getSemanticRoleDefaultBlockPresetId(block.semantic?.roleId, semanticRoleConfig);
  const roleDefaultPresetLabel = roleDefaultPresetId
    ? getSemanticBlockPresetById(roleDefaultPresetId)?.name ?? roleDefaultPresetId
    : '未设置';
  const selectValue = block.semantic?.roleId
    ? currentManualPresetId ?? '__follow__'
    : currentManualPresetId ?? '';
  const hasManualOverride = Boolean(currentManualPresetId);
  const hasSemanticRole = Boolean(block.semantic?.roleId);

  return (
    <section className="detail-panel object-detail-panel">
      <div className="detail-panel-head">
        <h3>块模板</h3>
        <span>{currentPresetPresentation?.label ?? '为当前块选择外壳表现'}</span>
      </div>
      <div className="object-property-list">
        {renderObjectPropertyRow('当前块模板', getSemanticBlockPresetSummary(block, semanticRoleConfig))}
        {renderObjectPropertyRow('来源', getSemanticBlockPresetSourceSummary(block, semanticRoleConfig))}
        {renderObjectPropertyRow('语义默认', roleDefaultPresetLabel)}
        {renderObjectPropertyRow('清除语义后恢复', getSemanticBlockPresetFallbackSummary(block))}
      </div>
      <div className="property-stack">
        <label>
          块模板
          <select
            className="style-select"
            value={selectValue}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (nextValue === '' || nextValue === '__follow__') {
                onChange(null);
                return;
              }

              onChange(nextValue as SemanticBlockPresetId);
            }}
          >
            {hasSemanticRole ? <option value="__follow__">跟随语义默认</option> : <option value="">无</option>}
            {presetOptions.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="micro-button"
          disabled={hasSemanticRole ? !hasManualOverride : !currentManualPresetId}
          onClick={() => onChange(null)}
        >
          {hasSemanticRole ? '恢复跟随语义默认' : '清除块模板'}
        </button>
      </div>
    </section>
  );
}

function renderSemanticRulesPanel({
  semanticRoleConfig,
  newRoleName,
  newRoleDescription,
  newRoleColor,
  newRoleDefaultPresetId,
  newKeyword,
  newKeywordRoleId,
  overwriteExisting,
  scanResult,
  onNewRoleNameChange,
  onNewRoleDescriptionChange,
  onNewRoleColorChange,
  onNewRoleDefaultPresetIdChange,
  onNewKeywordChange,
  onNewKeywordRoleIdChange,
  onOverwriteExistingChange,
  onAddRole,
  onToggleRole,
  onUpdateRoleDefaultPreset,
  onDeleteRole,
  onAddKeywordRule,
  onToggleKeywordRule,
  onDeleteKeywordRule,
  onScan,
  onApply,
}: {
  semanticRoleConfig: LayoutSemanticRoleConfig;
  newRoleName: string;
  newRoleDescription: string;
  newRoleColor: string;
  newRoleDefaultPresetId: string;
  newKeyword: string;
  newKeywordRoleId: string;
  overwriteExisting: boolean;
  scanResult: SemanticKeywordScanResult | null;
  onNewRoleNameChange: (value: string) => void;
  onNewRoleDescriptionChange: (value: string) => void;
  onNewRoleColorChange: (value: string) => void;
  onNewRoleDefaultPresetIdChange: (value: string) => void;
  onNewKeywordChange: (value: string) => void;
  onNewKeywordRoleIdChange: (value: string) => void;
  onOverwriteExistingChange: (value: boolean) => void;
  onAddRole: () => void;
  onToggleRole: (roleId: string) => void;
  onUpdateRoleDefaultPreset: (roleId: string, presetId: string) => void;
  onDeleteRole: (roleId: string) => void;
  onAddKeywordRule: () => void;
  onToggleKeywordRule: (ruleId: string) => void;
  onDeleteKeywordRule: (ruleId: string) => void;
  onScan: () => void;
  onApply: () => void;
}): JSX.Element {
  const semanticRoles = getEnabledSemanticRoles(semanticRoleConfig);
  const selectedRoleId = newKeywordRoleId || semanticRoles[0]?.id || '';
  const presetOptions = getSemanticBlockPresetDefinitions();

  return (
    <>
      <section className="detail-panel object-detail-panel">
        <div className="detail-panel-head">
          <h3>自定义语义块</h3>
          <span>创建后可手动设置，也可被关键词规则批量应用</span>
        </div>
        <div className="property-stack">
          <label>
            语义名称
            <input
              className="style-select-input"
              value={newRoleName}
              onChange={(event) => onNewRoleNameChange(event.target.value)}
              placeholder="例如：答案解析"
            />
          </label>
          <label>
            说明
            <input
              className="style-select-input"
              value={newRoleDescription}
              onChange={(event) => onNewRoleDescriptionChange(event.target.value)}
              placeholder="例如：用于标记题目解析说明"
            />
          </label>
          <label>
            标签颜色
            <input
              className="style-select-input"
              type="color"
              value={newRoleColor}
              onChange={(event) => onNewRoleColorChange(event.target.value)}
            />
          </label>
          <label>
            默认块模板
            <select
              className="style-select"
              value={newRoleDefaultPresetId}
              onChange={(event) => onNewRoleDefaultPresetIdChange(event.target.value)}
            >
              <option value="">无默认块模板</option>
              {presetOptions.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="micro-button" onClick={onAddRole} disabled={!newRoleName.trim()}>
            新增语义块
          </button>
        </div>
        <div className="object-property-list">
          {semanticRoleConfig.customRoles.length === 0 ? (
            <div className="object-empty-state">暂无自定义语义块</div>
          ) : (
            semanticRoleConfig.customRoles.map((role) => (
              <div key={role.id} className="property-stack">
                <div className="object-property-row">
                  <span>{role.name}</span>
                  <strong>{role.enabled ? '已启用' : '已停用'}</strong>
                  <button type="button" className="micro-button" onClick={() => onToggleRole(role.id)}>
                    {role.enabled ? '停用' : '启用'}
                  </button>
                  <button type="button" className="micro-button" onClick={() => onDeleteRole(role.id)}>
                    删除
                  </button>
                </div>
                <label>
                  默认块模板
                  <select
                    className="style-select"
                    value={role.defaultBlockPresetId ?? ''}
                    onChange={(event) => onUpdateRoleDefaultPreset(role.id, event.target.value)}
                  >
                    <option value="">无默认块模板</option>
                    {presetOptions.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="detail-panel object-detail-panel">
        <div className="detail-panel-head">
          <h3>关键词前缀规则</h3>
          <span>按块开头匹配，匹配后可移除前缀</span>
        </div>
        <div className="property-stack">
          <label>
            目标语义
            <select
              className="style-select"
              value={selectedRoleId}
              onChange={(event) => onNewKeywordRoleIdChange(event.target.value)}
            >
              {semanticRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.builtIn === false ? `${role.name}（自定义）` : role.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            关键词前缀
            <input
              className="style-select-input"
              value={newKeyword}
              onChange={(event) => onNewKeywordChange(event.target.value)}
              placeholder="例如：【答案解析】"
            />
          </label>
          <button
            type="button"
            className="micro-button"
            onClick={onAddKeywordRule}
            disabled={!selectedRoleId || !newKeyword.trim()}
          >
            新增关键词规则
          </button>
        </div>
        <div className="object-property-list">
          {semanticRoleConfig.keywordRules.length === 0 ? (
            <div className="object-empty-state">暂无关键词规则</div>
          ) : (
            semanticRoleConfig.keywordRules.map((rule) => {
              const role = getSemanticRoleById(rule.roleId, semanticRoleConfig);
              return (
                <div key={rule.id} className="object-property-row">
                  <span>{rule.keyword}</span>
                  <strong>{role?.name ?? rule.roleId}</strong>
                  <button type="button" className="micro-button" onClick={() => onToggleKeywordRule(rule.id)}>
                    {rule.enabled ? '停用' : '启用'}
                  </button>
                  <button type="button" className="micro-button" onClick={() => onDeleteKeywordRule(rule.id)}>
                    删除
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="detail-panel object-detail-panel">
        <div className="detail-panel-head">
          <h3>批量应用</h3>
          <span>扫描当前文档中的关键词前缀</span>
        </div>
        <div className="property-stack">
          <label>
            <input
              type="checkbox"
              checked={overwriteExisting}
              onChange={(event) => onOverwriteExistingChange(event.target.checked)}
            />
            覆盖已有语义
          </label>
          <button type="button" className="micro-button" onClick={onScan}>
            扫描全文
          </button>
          <button
            type="button"
            className="micro-button"
            onClick={onApply}
            disabled={!scanResult || scanResult.applicableCount === 0}
          >
            应用语义
          </button>
        </div>
        <div className="object-property-list">
          {renderObjectPropertyRow('可应用', String(scanResult?.applicableCount ?? 0))}
          {renderObjectPropertyRow('跳过已有语义', String(scanResult?.skippedExistingCount ?? 0))}
        </div>
        {scanResult && scanResult.items.length > 0 ? (
          <div className="object-property-list">
            {scanResult.items.slice(0, 8).map((item) => (
              <div key={`${item.blockId}-${item.ruleId}`} className="object-property-row">
                <span>{item.keyword}</span>
                <strong>{`${item.roleName} / ${item.status === 'applicable' ? '可应用' : '跳过'}`}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

function getSelectedNodeTypeLabel(nodeInfo: SelectedLayoutNodeInfo): string {
  if (nodeInfo.kind === 'listItem') {
    return '列表项';
  }

  if (nodeInfo.kind === 'tableCell') {
    return '表格单元格';
  }

  return blockTypeLabels[nodeInfo.ownerBlock.type];
}

function getSelectedNodeTextSummary(nodeInfo: SelectedLayoutNodeInfo): string {
  const text = nodeInfo.plainText.replace(/\s+/g, ' ').trim();
  return text ? (text.length > 80 ? `${text.slice(0, 80)}...` : text) : '暂无文本内容';
}

function normalizeSelection(text: string, selection: TextRangeSelection | null): TextRangeSelection | null {
  if (!text) {
    return null;
  }

  if (!selection || selection.start === selection.end) {
    return { start: 0, end: text.length };
  }

  if (selection.start < 0 || selection.end > text.length || selection.start >= selection.end) {
    return { start: 0, end: text.length };
  }

  return selection;
}

function collectSelectedRuns(textRuns: TextRun[], selection: TextRangeSelection | null): TextRun[] {
  const text = textRuns.map((run) => run.text).join('');
  const normalizedSelection = normalizeSelection(text, selection);
  if (!normalizedSelection) {
    return [];
  }

  const selectedRuns: TextRun[] = [];
  let cursor = 0;

  for (const run of textRuns) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;

    if (normalizedSelection.end <= runStart || normalizedSelection.start >= runEnd) {
      continue;
    }

    selectedRuns.push(run);
  }

  return selectedRuns;
}

function isTextMarkActive(
  textRuns: TextRun[],
  selection: TextRangeSelection | null,
  markType: TextMarkType,
): boolean {
  const selectedRuns = collectSelectedRuns(textRuns, selection);
  return selectedRuns.length > 0 && selectedRuns.every((run) => run.marks.some((mark) => mark.type === markType));
}

function getSharedTextStyleValue(
  textRuns: TextRun[],
  selection: TextRangeSelection | null,
  key: 'fontSize' | 'color' | 'highlightColor' | 'fontFamily',
): number | string | undefined {
  const selectedRuns = collectSelectedRuns(textRuns, selection);
  if (selectedRuns.length === 0) {
    return undefined;
  }

  const firstValue = selectedRuns[0].styleOverrides[key];
  const isShared = selectedRuns.every((run) => run.styleOverrides[key] === firstValue);
  return isShared ? firstValue : undefined;
}

function getDefaultTextMetrics(
  nodeInfo: SelectedLayoutNodeInfo,
  resolvedStyleContract: ReturnType<typeof useResolvedStyleContract>,
): {
  fontSize: number;
  lineHeight: number;
  spaceBefore: number;
  spaceAfter: number;
} {
  return resolveBlockDefaultTextMetrics(nodeInfo.ownerBlock, resolvedStyleContract);
}

function isTextStyleEditable(nodeInfo: SelectedLayoutNodeInfo | null): boolean {
  if (!nodeInfo) {
    return false;
  }

  return (
    nodeInfo.kind === 'listItem' ||
    nodeInfo.kind === 'tableCell' ||
    textEditableBlockTypes.includes(nodeInfo.ownerBlock.type)
  );
}

function isBlockStyleEditable(nodeInfo: SelectedLayoutNodeInfo | null): boolean {
  return !!nodeInfo && getBlockStyleControlSupportByBlockType(nodeInfo.ownerBlock.type) !== null;
}

function getSelectedTableCellPosition(
  nodeInfo: SelectedLayoutNodeInfo,
): { rowIndex: number; columnIndex: number; rowCount: number; columnCount: number } | null {
  if (nodeInfo.kind !== 'tableCell' || nodeInfo.ownerBlock.type !== 'table' || nodeInfo.ownerBlock.metadata.kind !== 'table') {
    return null;
  }

  const rows = nodeInfo.ownerBlock.metadata.rows;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const columnIndex = rows[rowIndex].cells.findIndex((cell) => cell.id === nodeInfo.nodeId);
    if (columnIndex >= 0) {
      return {
        rowIndex,
        columnIndex,
        rowCount: rows.length,
        columnCount: rows[rowIndex].cells.length,
      };
    }
  }

  return null;
}

function getSelectedListItemPosition(
  nodeInfo: SelectedLayoutNodeInfo,
): { itemIndex: number; itemCount: number } | null {
  if (nodeInfo.kind !== 'listItem' || nodeInfo.ownerBlock.type !== 'list' || nodeInfo.ownerBlock.metadata.kind !== 'list') {
    return null;
  }

  const itemIndex = nodeInfo.ownerBlock.metadata.items.findIndex((item) => item.id === nodeInfo.nodeId);
  if (itemIndex < 0) {
    return null;
  }

  return {
    itemIndex,
    itemCount: nodeInfo.ownerBlock.metadata.items.length,
  };
}

function getListStructureActionMessage(action: ListStructureAction): string {
  switch (action) {
    case 'insertItemAbove':
      return '已在上方插入列表项';
    case 'insertItemBelow':
      return '已在下方插入列表项';
    case 'deleteItem':
      return '已删除当前列表项';
    default:
      return '列表结构已更新';
  }
}

function getTableStructureActionMessage(action: TableStructureAction): string {
  switch (action) {
    case 'insertRowAbove':
      return '已在上方插入一行';
    case 'insertRowBelow':
      return '已在下方插入一行';
    case 'insertColumnLeft':
      return '已在左侧插入一列';
    case 'insertColumnRight':
      return '已在右侧插入一列';
    case 'deleteRow':
      return '已删除当前行';
    case 'deleteColumn':
      return '已删除当前列';
    default:
      return '表格结构已更新';
  }
}

function getBlockquoteStructureActionMessage(action: BlockquoteStructureAction): string {
  switch (action) {
    case 'insertParagraphAbove':
      return '已在上方插入段落';
    case 'insertParagraphBelow':
      return '已在下方插入段落';
    case 'deleteBlock':
      return '已删除当前子块';
    default:
      return '引用结构已更新';
  }
}

function getTopLevelBlockDeleteMessage(blockType: LayoutBlock['type'] | null): string {
  if (!blockType) {
    return '已删除当前块';
  }

  return `已删除${topLevelBlockDeleteLabels[blockType] ?? '当前块'}`;
}

function getBlockPreviewText(block: LayoutBlock): string {
  const text = getLayoutBlockPlainText(block).replace(/\s+/g, ' ').trim();
  if (text) {
    return text.length > 40 ? `${text.slice(0, 40)}...` : text;
  }

  if (block.type === 'image' && block.metadata.kind === 'image') {
    return block.metadata.src || '图片';
  }

  return '暂无文本内容';
}

function getEquationRenderSummary(value: string): { statusText: string; errorText: string | null } {
  const result = renderEquationToHtml(value);
  return {
    statusText: result.error ? '解析失败' : '解析成功',
    errorText: result.error,
  };
}

function renderObjectPropertiesPanel(
  selectedNodeInfo: SelectedLayoutNodeInfo | null,
  selectedBlockquoteContext: SelectedBlockquoteContext | null,
  selectedTopLevelBlock: LayoutBlock | null,
  selectedNodeId: string | null,
  canvasTextSelection: CanvasTextSelectionState,
  layoutStyles: LayoutStyleSheet | null | undefined,
  layoutResources: LayoutResource[],
  semanticRoleConfig: LayoutSemanticRoleConfig,
  resolvedStyleContract: ReturnType<typeof useResolvedStyleContract>,
  toggleLayoutNodeTextMark: (payload: {
    nodeId: string;
    selection: TextRangeSelection | null;
    markType: TextMarkType;
  }) => void,
  applyLayoutNodeTextStyle: (payload: {
    nodeId: string;
    selection: TextRangeSelection | null;
    styleOverrides: { fontFamily?: string; fontSize?: number; color?: string; highlightColor?: string };
  }) => void,
  updateLayoutNodeText: (payload: {
    nodeId: string;
    text: string;
  }) => void,
  clearLayoutNodeTextFormatting: (payload: {
    nodeId: string;
    selection: TextRangeSelection | null;
  }) => void,
  updateLayoutImageAttributes: (payload: {
    nodeId: string;
    src: string;
    alt: string;
    title: string | null;
    widthPx?: number | null;
    heightPx?: number | null;
    lockAspectRatio?: boolean;
    objectFit?: 'contain' | 'cover';
    cropTopPx?: number | null;
    cropRightPx?: number | null;
    cropBottomPx?: number | null;
    cropLeftPx?: number | null;
    wrapMode?: ImageBlockMetadata['wrapMode'];
    wrapSide?: ImageWrapSide;
    showCaption?: boolean;
    offsetX?: number | null;
    offsetY?: number | null;
  }) => void,
  updateLayoutTocMaxDepth: (payload: {
    nodeId: string;
    maxDepth: 1 | 2 | 3;
  }) => void,
  refreshLayoutTocBlock: (payload: {
    nodeId: string;
  }) => boolean,
  updateLayoutTableStructure: (payload: {
    cellId: string;
    action: TableStructureAction;
  }) => string | null,
  updateLayoutTableHeaderRow: (payload: {
    cellId: string;
    enabled: boolean;
  }) => string | null,
  updateLayoutTableColumnAlign: (payload: {
    cellId: string;
    align: TableColumnAlign;
  }) => string | null,
  autoFitLayoutTableSize: (payload: {
    cellId: string;
    contentWidthPx: number;
    rowHeightPx: number;
    headerRowHeightPx: number;
    cellPaddingX: number;
    cellPaddingY: number;
    baseFontSizePx: number;
    baseLineHeightPx: number;
  }) => string | null,
  mergeLayoutSelectedTableCells: () => {
    selectedNodeId: string | null;
    didUpdate: boolean;
    reason: 'merged' | 'invalidSelection' | 'singleCell' | 'containsMergedCell';
  },
  updateLayoutListStructure: (payload: {
    itemId: string;
    action: ListStructureAction;
  }) => string | null,
  updateLayoutListOrdered: (payload: {
    itemId: string;
    ordered: boolean;
  }) => string | null,
  updateLayoutListStart: (payload: {
    itemId: string;
    start: number;
  }) => string | null,
  updateLayoutListItemChecked: (payload: {
    itemId: string;
    checked: boolean;
  }) => string | null,
  updateLayoutListItemLevel: (payload: {
    itemId: string;
    action: ListIndentAction;
  }) => string | null,
  reorderLayoutListItem: (payload: {
    itemId: string;
    action: ListReorderAction;
  }) => string | null,
  updateLayoutListTaskMode: (payload: {
    itemId: string;
    taskMode: boolean;
  }) => string | null,
  convertLayoutListItemTaskState: (payload: {
    itemId: string;
    action: ListTaskConversionAction;
  }) => string | null,
  updateLayoutListBatchChecked: (payload: {
    itemId: string;
    scope: ListBatchCheckedScope;
    action: ListBatchCheckedAction;
  }) => { selectedNodeId: string | null; changedCount: number },
  updateLayoutBlockquoteStructure: (payload: {
    blockquoteId: string;
    targetNodeId: string;
    action: BlockquoteStructureAction;
  }) => string | null,
  updateLayoutColumnSectionAttributes: (payload: {
    nodeId: string;
    columnCount?: ColumnSectionColumnCount;
    columnGapMm?: number;
    divider?: boolean;
    headingsSpanAll?: boolean;
  }) => void,
  unwrapLayoutColumnSection: (payload: {
    nodeId: string;
  }) => { didUpdate: boolean; selectedNodeId: string | null; unwrappedCount: number },
  deleteLayoutTopLevelBlock: (payload: {
    nodeId: string;
  }) => { didDelete: boolean; selectedNodeId: string | null; deletedBlockType: LayoutBlock['type'] | null },
  applyLayoutNodeBlockStyle: (payload: {
    nodeId: string;
    blockStyleOverrides: BlockStyleOverrides;
  }) => void,
  applyLayoutQuickBlockStyle: (payload: {
    scope: QuickBlockStyleScope;
    styleOverrides: BlockStyleOverrides;
  }) => void,
  updateLayoutBlockSemantic: (payload: {
    nodeId: string;
    semantic: LayoutBlockSemantic | null;
  }) => void,
  updateLayoutBlockSemanticPreset: (payload: {
    nodeId: string;
    presetId: SemanticBlockPresetId | null;
  }) => void,
  tableSelection: TableCellRangeSelection | null,
  tableStructureFeedback: string | null,
  onTableStructureFeedback: (message: string) => void,
  listStructureFeedback: string | null,
  onListStructureFeedback: (message: string) => void,
  tocRefreshFeedback: string | null,
  onTocRefreshFeedback: (message: string | null) => void,
  blockquoteStructureFeedback: string | null,
  onBlockquoteStructureFeedback: (message: string) => void,
  columnSectionFeedback: string | null,
  onColumnSectionFeedback: (message: string | null) => void,
  topLevelBlockFeedback: string | null,
  onTopLevelBlockFeedback: (message: string) => void,
  blockStyleApplyMode: BlockStyleApplyMode,
  onBlockStyleApplyModeChange: (mode: BlockStyleApplyMode) => void,
  syncEditingTextBeforeStyleAction: (nodeId: string) => void,
): JSX.Element {
  if (!selectedNodeInfo) {
    return (
      <section className="detail-panel object-detail-panel">
        <div className="detail-panel-head">
          <h3>对象属性</h3>
          <span>{selectedNodeId ? '选中节点暂未匹配到对象信息' : '当前没有活动模型节点'}</span>
        </div>
        <div className="object-empty-state">未选择画布对象</div>
      </section>
    );
  }

  const activeSelection =
    canvasTextSelection.nodeId === selectedNodeInfo.nodeId ? canvasTextSelection.selection : null;
  const defaultMetrics = getDefaultTextMetrics(selectedNodeInfo, resolvedStyleContract);
  const effectiveTextMetrics = resolveBlockEffectiveTextMetrics(
    selectedNodeInfo.ownerBlock,
    resolvedStyleContract,
    layoutStyles ?? undefined,
  );
  const currentFontSize =
    getSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'fontSize') ?? defaultMetrics.fontSize;
  const currentFontFamily =
    (getSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'fontFamily') as string | undefined) ??
    fontFamilyPlaceholderValue;
  const fontFamilyGroups = buildFontFamilyGroupsWithImportedFonts(
    textFontFamilyGroups,
    layoutResources,
  );
  const currentColor =
    (getSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'color') as string | undefined) ??
    defaultTextColor;
  const currentHighlightColor =
    (getSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'highlightColor') as string | undefined) ??
    defaultHighlightColor;
  const blockStyleRuleScope = getQuickBlockStyleScopeForBlock(selectedNodeInfo.ownerBlock);
  const sameTypeRuleStyle = blockStyleRuleScope
    ? resolveQuickBlockStyleForBlock(selectedNodeInfo.ownerBlock, layoutStyles)
    : {};
  const effectiveBlockStyleOverrides: BlockStyleOverrides = {
    ...sameTypeRuleStyle,
    ...selectedNodeInfo.ownerBlock.blockStyleOverrides,
  };
  const isSameTypeRuleMode = blockStyleApplyMode === 'sameType' && !!blockStyleRuleScope;
  const currentTextAlign = isSameTypeRuleMode
    ? sameTypeRuleStyle.textAlign ?? 'left'
    : effectiveBlockStyleOverrides.textAlign ?? 'left';
  const currentLineHeight = isSameTypeRuleMode
    ? sameTypeRuleStyle.lineHeight ?? defaultMetrics.lineHeight
    : effectiveBlockStyleOverrides.lineHeight ?? defaultMetrics.lineHeight;
  const currentIndentLeft = isSameTypeRuleMode
    ? sameTypeRuleStyle.indentLeft ?? 0
    : effectiveBlockStyleOverrides.indentLeft ?? 0;
  const currentIndentRight = isSameTypeRuleMode
    ? sameTypeRuleStyle.indentRight ?? 0
    : effectiveBlockStyleOverrides.indentRight ?? 0;
  const currentFirstLineIndent = isSameTypeRuleMode
    ? sameTypeRuleStyle.firstLineIndent ?? 0
    : effectiveBlockStyleOverrides.firstLineIndent ?? 0;
  const currentHangingIndent = isSameTypeRuleMode
    ? sameTypeRuleStyle.hangingIndent ?? 0
    : effectiveBlockStyleOverrides.hangingIndent ?? 0;
  const currentSpaceBefore = isSameTypeRuleMode
    ? sameTypeRuleStyle.spaceBefore ?? defaultMetrics.spaceBefore
    : effectiveBlockStyleOverrides.spaceBefore ?? defaultMetrics.spaceBefore;
  const currentSpaceAfter = isSameTypeRuleMode
    ? sameTypeRuleStyle.spaceAfter ?? defaultMetrics.spaceAfter
    : effectiveBlockStyleOverrides.spaceAfter ?? defaultMetrics.spaceAfter;
  const lineSpacingReferenceFontSize = Math.max(1, effectiveTextMetrics.fontSize);
  const currentLineSpacingMultiple = resolveLineSpacingMultiple(currentLineHeight, lineSpacingReferenceFontSize);
  const activeLineSpacingPresetId = resolveActiveLineSpacingPresetId(currentLineSpacingMultiple);
  const currentBlockStyleScopeLabel = blockStyleRuleScope ? quickBlockStyleScopeLabels[blockStyleRuleScope] : null;
  const selectedImageMetadata =
    selectedNodeInfo.kind === 'block' &&
    selectedNodeInfo.ownerBlock.type === 'image' &&
    selectedNodeInfo.ownerBlock.metadata.kind === 'image'
      ? selectedNodeInfo.ownerBlock.metadata
      : null;
  const selectedImageLayout = selectedImageMetadata ? resolveImageLayout(selectedImageMetadata) : null;
  const selectedListItemPosition = getSelectedListItemPosition(selectedNodeInfo);
  const selectedListBlockWithoutItem =
    selectedNodeInfo.kind === 'block' && selectedNodeInfo.ownerBlock.type === 'list';
  const selectedListMetadata =
    selectedNodeInfo.ownerBlock.type === 'list' && selectedNodeInfo.ownerBlock.metadata.kind === 'list'
      ? selectedNodeInfo.ownerBlock.metadata
      : null;
  const selectedTableCellPosition = getSelectedTableCellPosition(selectedNodeInfo);
  const selectedTableBlockWithoutCell =
    selectedNodeInfo.kind === 'block' && selectedNodeInfo.ownerBlock.type === 'table';
  const selectedTableMetadata =
    selectedNodeInfo.ownerBlock.type === 'table' && selectedNodeInfo.ownerBlock.metadata.kind === 'table'
      ? selectedNodeInfo.ownerBlock.metadata
      : null;
  const selectedEquationMetadata =
    selectedNodeInfo.ownerBlock.type === 'equation' && selectedNodeInfo.ownerBlock.metadata.kind === 'equation'
      ? selectedNodeInfo.ownerBlock.metadata
      : null;
  const selectedColumnSectionMetadata =
    selectedNodeInfo.ownerBlock.type === 'columnSection' && selectedNodeInfo.ownerBlock.metadata.kind === 'columnSection'
      ? selectedNodeInfo.ownerBlock.metadata
      : null;
  const isHeaderRowEnabled = selectedTableMetadata?.rows[0]?.cells.every((cell) => cell.isHeader) ?? false;
  const currentTableColumnAlign =
    selectedTableCellPosition && selectedTableMetadata
      ? selectedTableMetadata.align[selectedTableCellPosition.columnIndex] ?? null
      : null;
  const selectedTableRangeCellCount = tableSelection?.cellIds.length ?? 0;
  const canMergeSelectedTableCells =
    !!selectedTableCellPosition &&
    !!tableSelection &&
    tableSelection.tableBlockId === selectedNodeInfo.ownerBlock.id &&
    selectedTableRangeCellCount > 1;
  const currentListStart = selectedListMetadata?.start ?? 1;
  const selectedListItem =
    selectedListMetadata && selectedListItemPosition
      ? selectedListMetadata.items[selectedListItemPosition.itemIndex] ?? null
      : null;
  const currentListLevel = selectedListItem ? getLayoutListItemLevel(selectedListItem) : 1;
  const isTaskList = !!selectedListMetadata?.items.some((item) => item.checked !== null);
  const selectedBlockquoteDirectChild = selectedBlockquoteContext?.directChildBlock ?? null;
  const selectedBlockquoteChildren =
    selectedBlockquoteContext?.blockquoteBlock.type === 'blockquote' &&
    selectedBlockquoteContext.blockquoteBlock.metadata.kind === 'blockquote'
      ? selectedBlockquoteContext.blockquoteBlock.metadata.blocks
      : [];
  const blockStyleControlSupport = getBlockStyleControlSupportByBlockType(selectedNodeInfo.ownerBlock.type);
  const selectedEquationRenderSummary = selectedEquationMetadata
    ? getEquationRenderSummary(selectedEquationMetadata.value)
    : null;
  const canDeleteTopLevelBlock =
    !!selectedTopLevelBlock &&
    Object.prototype.hasOwnProperty.call(topLevelBlockDeleteLabels, selectedTopLevelBlock.type);
  const applyBlockStyleByMode = (styleOverrides: BlockStyleOverrides): void => {
    // 切换块级样式前先收口编辑态草稿，避免“同类块规则”误吃到旧文本草稿对应的字号上下文。
    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);

    if (isSameTypeRuleMode && blockStyleRuleScope) {
      applyLayoutQuickBlockStyle({
        scope: blockStyleRuleScope,
        styleOverrides,
      });
      return;
    }

    applyLayoutNodeBlockStyle({
      nodeId: selectedNodeInfo.nodeId,
      blockStyleOverrides: styleOverrides,
    });
  };
  const commitImageMetadata = (patch: Partial<NonNullable<typeof selectedImageMetadata>>) => {
    if (!selectedImageMetadata) {
      return;
    }

    const hasOwn = <K extends keyof NonNullable<typeof selectedImageMetadata>>(key: K): boolean =>
      Object.prototype.hasOwnProperty.call(patch, key);

    updateLayoutImageAttributes({
      nodeId: selectedNodeInfo.nodeId,
      src: hasOwn('src') ? patch.src ?? '' : selectedImageMetadata.src,
      alt: hasOwn('alt') ? patch.alt ?? '' : selectedImageMetadata.alt,
      title: hasOwn('title') ? patch.title ?? null : selectedImageMetadata.title,
      widthPx: hasOwn('widthPx') ? patch.widthPx ?? null : selectedImageMetadata.widthPx ?? null,
      heightPx: hasOwn('heightPx') ? patch.heightPx ?? null : selectedImageMetadata.heightPx ?? null,
      lockAspectRatio: hasOwn('lockAspectRatio')
        ? patch.lockAspectRatio ?? true
        : selectedImageMetadata.lockAspectRatio ?? true,
      objectFit: hasOwn('objectFit') ? patch.objectFit ?? 'contain' : selectedImageMetadata.objectFit ?? 'contain',
      cropTopPx: hasOwn('cropTopPx') ? patch.cropTopPx ?? 0 : selectedImageMetadata.cropTopPx ?? 0,
      cropRightPx: hasOwn('cropRightPx') ? patch.cropRightPx ?? 0 : selectedImageMetadata.cropRightPx ?? 0,
      cropBottomPx: hasOwn('cropBottomPx') ? patch.cropBottomPx ?? 0 : selectedImageMetadata.cropBottomPx ?? 0,
      cropLeftPx: hasOwn('cropLeftPx') ? patch.cropLeftPx ?? 0 : selectedImageMetadata.cropLeftPx ?? 0,
      wrapMode: hasOwn('wrapMode') ? patch.wrapMode ?? 'inline' : selectedImageLayout?.wrapMode ?? 'inline',
      wrapSide: hasOwn('wrapSide') ? patch.wrapSide ?? 'right' : selectedImageLayout?.wrapSide ?? 'right',
      showCaption: hasOwn('showCaption') ? patch.showCaption ?? false : selectedImageMetadata.showCaption ?? false,
      offsetX: hasOwn('offsetX') ? patch.offsetX ?? 0 : selectedImageMetadata.offsetX ?? 0,
      offsetY: hasOwn('offsetY') ? patch.offsetY ?? 0 : selectedImageMetadata.offsetY ?? 0,
    });
  };

  const handleImageFieldChange = (
    field:
      | 'widthPx'
      | 'heightPx'
      | 'cropTopPx'
      | 'cropRightPx'
      | 'cropBottomPx'
      | 'cropLeftPx',
    value: string,
  ) => {
    if (!selectedImageMetadata) {
      return;
    }

    if (value.trim() === '') {
      commitImageMetadata({
        [field]: field === 'widthPx' || field === 'heightPx' ? null : 0,
      } as Partial<NonNullable<typeof selectedImageMetadata>>);
      return;
    }

    const nextValue = Number(value);
    const normalizedValue = Number.isFinite(nextValue) ? Math.max(0, Math.round(nextValue)) : 0;

    commitImageMetadata({
      [field]: normalizedValue,
    } as Partial<NonNullable<typeof selectedImageMetadata>>);
  };

  const handleImageDimensionChange = (field: 'widthPx' | 'heightPx', value: string) => {
    if (!selectedImageMetadata) {
      return;
    }

    if (value.trim() === '') {
      commitImageMetadata({
        [field]: null,
      } as Partial<NonNullable<typeof selectedImageMetadata>>);
      return;
    }

    const nextValue = Number(value);
    const normalizedValue = Number.isFinite(nextValue) ? Math.max(0, Math.round(nextValue)) : null;
    const currentWidth = selectedImageLayout?.widthPx ?? null;
    const currentHeight = selectedImageLayout?.heightPx ?? null;
    let nextWidth = selectedImageMetadata.widthPx ?? null;
    let nextHeight = selectedImageMetadata.heightPx ?? null;

    if (field === 'widthPx') {
      nextWidth = normalizedValue;
      if ((selectedImageMetadata.lockAspectRatio ?? true) && currentWidth && currentHeight && normalizedValue !== null) {
        nextHeight = Math.max(1, Math.round((normalizedValue * currentHeight) / currentWidth));
      }
    } else {
      nextHeight = normalizedValue;
      if ((selectedImageMetadata.lockAspectRatio ?? true) && currentWidth && currentHeight && normalizedValue !== null) {
        nextWidth = Math.max(1, Math.round((normalizedValue * currentWidth) / currentHeight));
      }
    }

    commitImageMetadata({
      widthPx: nextWidth,
      heightPx: nextHeight,
    });
  };

  const handleListOrderedChange = (ordered: boolean) => {
    if (!selectedListItemPosition) {
      onListStructureFeedback('请先选中一个列表项');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = updateLayoutListOrdered({
      itemId: selectedNodeInfo.nodeId,
      ordered,
    });

    onListStructureFeedback(
      nextSelectedNodeId
        ? ordered
          ? '已切换为有序列表'
          : '已切换为无序列表'
        : '列表类型没有变化',
    );
  };

  const handleListTaskModeChange = (taskMode: boolean) => {
    if (!selectedListItemPosition) {
      onListStructureFeedback('请先选中一个列表项');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = updateLayoutListTaskMode({
      itemId: selectedNodeInfo.nodeId,
      taskMode,
    });

    onListStructureFeedback(
      nextSelectedNodeId
        ? taskMode
          ? '已切换为任务列表'
          : '已切换为普通列表'
        : '列表类型没有变化',
    );
  };

  const handleListStartChange = (start: number) => {
    if (!selectedListItemPosition) {
      onListStructureFeedback('请先选中一个列表项');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = updateLayoutListStart({
      itemId: selectedNodeInfo.nodeId,
      start,
    });

    onListStructureFeedback(nextSelectedNodeId ? `已将起始编号设置为 ${Math.max(1, Math.floor(start))}` : '起始编号没有变化');
  };

  const handleListItemCheckedChange = (checked: boolean) => {
    if (!selectedListItemPosition || !selectedListItem || selectedListItem.checked === null) {
      onListStructureFeedback('当前不是任务列表项');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = updateLayoutListItemChecked({
      itemId: selectedNodeInfo.nodeId,
      checked,
    });

    onListStructureFeedback(
      nextSelectedNodeId
        ? checked
          ? '已勾选任务项'
          : '已取消勾选任务项'
        : '任务勾选没有变化',
    );
  };

  const handleListLevelChange = (action: ListIndentAction) => {
    if (!selectedListItemPosition) {
      onListStructureFeedback('请先选中一个列表项');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = updateLayoutListItemLevel({
      itemId: selectedNodeInfo.nodeId,
      action,
    });

    onListStructureFeedback(
      nextSelectedNodeId
        ? action === 'indent'
          ? '已降低一级'
          : '已提升一级'
        : action === 'indent'
          ? '当前项不能继续降低一级'
          : '当前项不能继续提升一级',
    );
  };

  const handleListReorderAction = (action: ListReorderAction) => {
    if (!selectedListItemPosition) {
      onListStructureFeedback('请先选中一个列表项');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = reorderLayoutListItem({
      itemId: selectedNodeInfo.nodeId,
      action,
    });

    onListStructureFeedback(
      nextSelectedNodeId
        ? action === 'moveUp'
          ? '已上移当前项'
          : '已下移当前项'
        : action === 'moveUp'
          ? '当前项已经在最上方'
          : '当前项已经在最下方',
    );
  };

  const handleListBatchCheckedAction = (scope: ListBatchCheckedScope, action: ListBatchCheckedAction) => {
    if (!selectedListItemPosition) {
      onListStructureFeedback('请先选中一个列表项');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const result = updateLayoutListBatchChecked({
      itemId: selectedNodeInfo.nodeId,
      scope,
      action,
    });

    onListStructureFeedback(
      result.changedCount > 0
        ? `${scope === 'all' ? '整列表' : '当前层级'}已${action === 'check' ? '全部勾选' : '全部取消'}（${result.changedCount} 项）`
        : '没有可更新的任务项',
    );
  };

  const handleListTaskConversionAction = (action: ListTaskConversionAction) => {
    if (!selectedListItemPosition) {
      onListStructureFeedback('请先选中一个列表项');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = convertLayoutListItemTaskState({
      itemId: selectedNodeInfo.nodeId,
      action,
    });

    onListStructureFeedback(
      nextSelectedNodeId
        ? action === 'convertToTask'
          ? '已转换为任务项'
          : '已取消任务项'
        : '任务项状态没有变化',
    );
  };

  const handleListStructureAction = (action: ListStructureAction) => {
    if (!selectedListItemPosition) {
      onListStructureFeedback('请先选中一个列表项');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = updateLayoutListStructure({
      itemId: selectedNodeInfo.nodeId,
      action,
    });

    if (!nextSelectedNodeId) {
      onListStructureFeedback('至少需要保留 1 个列表项');
      return;
    }

    onListStructureFeedback(getListStructureActionMessage(action));
  };

  const handleTableStructureAction = (action: TableStructureAction) => {
    if (!selectedTableCellPosition) {
      onTableStructureFeedback('请先选中一个表格单元格');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = updateLayoutTableStructure({
      cellId: selectedNodeInfo.nodeId,
      action,
    });

    if (!nextSelectedNodeId) {
      onTableStructureFeedback('至少需要保留 1 行 x 1 列');
      return;
    }

    onTableStructureFeedback(getTableStructureActionMessage(action));
  };

  const handleTableHeaderRowChange = (enabled: boolean) => {
    if (!selectedTableCellPosition) {
      onTableStructureFeedback('请先选中一个表格单元格');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = updateLayoutTableHeaderRow({
      cellId: selectedNodeInfo.nodeId,
      enabled,
    });

    onTableStructureFeedback(
      nextSelectedNodeId
        ? enabled
          ? '已将首行设为表头，跨页时会自动续表头'
          : '已取消首行表头'
        : '表头设置没有变化',
    );
  };

  const handleTableColumnAlignChange = (align: TableColumnAlign) => {
    if (!selectedTableCellPosition) {
      onTableStructureFeedback('请先选中一个表格单元格');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = updateLayoutTableColumnAlign({
      cellId: selectedNodeInfo.nodeId,
      align,
    });
    const alignLabel = tableColumnAlignOptions.find((option) => option.id === align)?.label ?? '默认';

    onTableStructureFeedback(
      nextSelectedNodeId ? `已将当前列设置为${alignLabel}` : '当前列对齐没有变化',
    );
  };

  const handleTableAutoFitSize = () => {
    if (!selectedTableCellPosition) {
      onTableStructureFeedback('请先选中一个表格单元格');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = autoFitLayoutTableSize({
      cellId: selectedNodeInfo.nodeId,
      contentWidthPx: resolvedStyleContract.singleColumnContentWidthPx,
      rowHeightPx: resolvedStyleContract.blockStyles.table.rowHeight,
      headerRowHeightPx: resolvedStyleContract.blockStyles.table.headerRowHeight,
      cellPaddingX: resolvedStyleContract.blockStyles.table.cellPaddingX,
      cellPaddingY: resolvedStyleContract.blockStyles.table.cellPaddingY,
      baseFontSizePx: resolvedStyleContract.blockStyles.paragraph.fontSize,
      baseLineHeightPx: resolvedStyleContract.blockStyles.paragraph.lineHeight,
    });

    onTableStructureFeedback(
      nextSelectedNodeId
        ? '已按内容适应最佳行高列宽'
        : '当前表格尺寸已经是最佳适应结果',
    );
  };

  const handleTableMergeCells = () => {
    if (!canMergeSelectedTableCells) {
      onTableStructureFeedback('请先按住 Shift 选择相邻单元格');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const result = mergeLayoutSelectedTableCells();

    if (result.didUpdate) {
      onTableStructureFeedback('已合并选中单元格');
      return;
    }

    const failureMessage: Record<typeof result.reason, string> = {
      merged: '已合并选中单元格',
      invalidSelection: '请选择同一表格内的相邻矩形单元格',
      singleCell: '至少需要选择 2 个单元格',
      containsMergedCell: '当前选区包含已合并单元格，后续再支持复杂合并',
    };

    onTableStructureFeedback(failureMessage[result.reason]);
  };

  const handleBlockquoteStructureAction = (action: BlockquoteStructureAction) => {
    if (!selectedBlockquoteContext || !selectedBlockquoteDirectChild) {
      onBlockquoteStructureFeedback('请先在引用中选中具体子块');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const nextSelectedNodeId = updateLayoutBlockquoteStructure({
      blockquoteId: selectedBlockquoteContext.blockquoteBlock.id,
      targetNodeId: selectedBlockquoteDirectChild.id,
      action,
    });

    if (!nextSelectedNodeId) {
      onBlockquoteStructureFeedback('至少需要保留 1 个引用子块');
      return;
    }

    onBlockquoteStructureFeedback(getBlockquoteStructureActionMessage(action));
  };

  const handleTocRefresh = () => {
    if (selectedNodeInfo.ownerBlock.type !== 'toc' || selectedNodeInfo.ownerBlock.metadata.kind !== 'toc') {
      onTocRefreshFeedback('当前不是目录块');
      return;
    }

    const didRefresh = refreshLayoutTocBlock({
      nodeId: selectedNodeInfo.nodeId,
    });

    onTocRefreshFeedback(didRefresh ? '目录已刷新' : '当前目录不可刷新');
  };

  const handleTopLevelBlockDelete = () => {
    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const result = deleteLayoutTopLevelBlock({
      nodeId: selectedNodeInfo.nodeId,
    });

    onTopLevelBlockFeedback(
      result.didDelete ? getTopLevelBlockDeleteMessage(result.deletedBlockType) : '当前块删除失败',
    );
  };

  const commitColumnSectionAttributePatch = (patch: {
    columnCount?: ColumnSectionColumnCount;
    columnGapMm?: number;
    divider?: boolean;
    headingsSpanAll?: boolean;
  }) => {
    if (!selectedColumnSectionMetadata) {
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    updateLayoutColumnSectionAttributes({
      nodeId: selectedNodeInfo.nodeId,
      ...patch,
    });
    onColumnSectionFeedback(null);
  };

  const handleColumnSectionGapChange = (rawValue: string) => {
    if (!selectedColumnSectionMetadata) {
      return;
    }

    const nextValue = Number(rawValue);
    if (!Number.isFinite(nextValue)) {
      onColumnSectionFeedback('栏间距需要填写数字');
      return;
    }

    commitColumnSectionAttributePatch({
      columnGapMm: Math.max(4, Math.min(30, Math.round(nextValue))),
    });
  };

  const handleUnwrapColumnSection = () => {
    if (!selectedColumnSectionMetadata) {
      onColumnSectionFeedback('当前不是局部分栏区段');
      return;
    }

    syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
    const result = unwrapLayoutColumnSection({
      nodeId: selectedNodeInfo.nodeId,
    });
    onColumnSectionFeedback(
      result.didUpdate
        ? `已解除双栏，恢复 ${result.unwrappedCount} 个顶层块`
        : '解除双栏失败',
    );
  };

  return (
    <>
      <section className="detail-panel object-detail-panel">
        <div className="detail-panel-head">
          <h3>对象属性</h3>
          <span>{getSelectedNodeTypeLabel(selectedNodeInfo)}</span>
        </div>
        <div className="object-property-list">
          {renderObjectPropertyRow('对象类型', getSelectedNodeTypeLabel(selectedNodeInfo))}
          {renderObjectPropertyRow('对象 ID', selectedNodeInfo.nodeId)}
          {renderObjectPropertyRow('所属块', blockTypeLabels[selectedNodeInfo.ownerBlock.type])}
          {renderObjectPropertyRow('文本摘要', getSelectedNodeTextSummary(selectedNodeInfo))}
          {renderObjectPropertyRow('源码范围', getSourceRangeLabel(selectedNodeInfo.sourceRange))}
          {renderObjectPropertyRow(
            '样式来源',
            getBlockStyleSourceText(selectedNodeInfo.ownerBlock, resolvedStyleContract, layoutStyles),
          )}
          {renderObjectPropertyRow('块级覆盖', getBlockStyleSummary(selectedNodeInfo.ownerBlock))}
        </div>
      </section>

      {renderSemanticRolePanel({
        block: selectedNodeInfo.ownerBlock,
        semanticRoleConfig,
        onChange: (semantic) => {
          syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
          updateLayoutBlockSemantic({
            nodeId: selectedNodeInfo.nodeId,
            semantic,
          });
        },
      })}

      {renderSemanticBlockPresetPanel({
        block: selectedNodeInfo.ownerBlock,
        semanticRoleConfig,
        onChange: (presetId) => {
          syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
          updateLayoutBlockSemanticPreset({
            nodeId: selectedNodeInfo.nodeId,
            presetId,
          });
        },
      })}

      {selectedColumnSectionMetadata ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>局部分栏</h3>
            <span>当前区段共 {selectedColumnSectionMetadata.blocks.length} 个子块</span>
          </div>
          <div className="object-property-list">
            {renderObjectPropertyRow('当前栏数', `${selectedColumnSectionMetadata.columnCount} 栏`)}
            {renderObjectPropertyRow('栏间距', `${selectedColumnSectionMetadata.columnGapMm} mm`)}
            {renderObjectPropertyRow('栏分割线', selectedColumnSectionMetadata.divider ? '显示' : '不显示')}
            {renderObjectPropertyRow('标题跨栏', selectedColumnSectionMetadata.headingsSpanAll ? '开启' : '关闭')}
          </div>
          <div className="property-stack">
            <label>
              栏数
              <div className="segmented-group">
                {([2, 3] as const).map((count) => (
                  <button
                    key={`column-section-count-${count}`}
                    type="button"
                    className={selectedColumnSectionMetadata.columnCount === count ? 'segment-chip active' : 'segment-chip'}
                    onClick={() => commitColumnSectionAttributePatch({ columnCount: count })}
                  >
                    {count} 栏
                  </button>
                ))}
              </div>
            </label>
            <label>
              栏间距
              <div className="number-input-shell">
                <input
                  key={`column-section-gap-${selectedNodeInfo.nodeId}-${selectedColumnSectionMetadata.columnGapMm}`}
                  type="number"
                  min={4}
                  max={30}
                  step={1}
                  defaultValue={selectedColumnSectionMetadata.columnGapMm}
                  onBlur={(event) => handleColumnSectionGapChange(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                  }}
                />
                <span>mm</span>
              </div>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={selectedColumnSectionMetadata.divider}
                onChange={(event) => commitColumnSectionAttributePatch({ divider: event.target.checked })}
              />
              <span>显示栏分割线</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={selectedColumnSectionMetadata.headingsSpanAll}
                onChange={(event) => commitColumnSectionAttributePatch({ headingsSpanAll: event.target.checked })}
              />
              <span>标题不参与分栏</span>
            </label>
          </div>
          <div className="table-structure-grid">
            <button
              type="button"
              className="segment-chip table-structure-button"
              onClick={handleUnwrapColumnSection}
            >
              解除双栏
            </button>
          </div>
          {columnSectionFeedback ? <p className="table-structure-feedback">{columnSectionFeedback}</p> : null}
        </section>
      ) : null}

      {selectedImageMetadata ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>图片属性</h3>
            <span>尺寸、裁剪与环绕会同步写回图片块</span>
          </div>
          <div className="property-stack">
            <label>
              图片路径
              <input
                key={`image-src-${selectedNodeInfo.nodeId}-${selectedImageMetadata.src}`}
                className="style-text-input"
                type="text"
                defaultValue={selectedImageMetadata.src}
                onBlur={(event) => {
                  if (event.currentTarget.value !== selectedImageMetadata.src) {
                    commitImageMetadata({ src: event.currentTarget.value });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <label>
              替代文本
              <input
                key={`image-alt-${selectedNodeInfo.nodeId}-${selectedImageMetadata.alt}`}
                className="style-text-input"
                type="text"
                defaultValue={selectedImageMetadata.alt}
                onBlur={(event) => {
                  if (event.currentTarget.value !== selectedImageMetadata.alt) {
                    commitImageMetadata({ alt: event.currentTarget.value });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <label>
              标题
              <input
                key={`image-title-${selectedNodeInfo.nodeId}-${selectedImageMetadata.title ?? ''}`}
                className="style-text-input"
                type="text"
                defaultValue={selectedImageMetadata.title ?? ''}
                onBlur={(event) => {
                  const nextTitle = event.currentTarget.value === '' ? null : event.currentTarget.value;
                  if (nextTitle !== selectedImageMetadata.title) {
                    commitImageMetadata({ title: nextTitle });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <div className="image-property-group">
              <div className="image-property-group-title">尺寸</div>
              <div className="margin-grid">
                <label>
                  宽度
                  <div className="number-input-shell">
                    <input
                      key={`image-width-${selectedNodeInfo.nodeId}-${selectedImageLayout?.widthPx ?? ''}`}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={selectedImageLayout?.widthPx ?? ''}
                      onBlur={(event) => handleImageDimensionChange('widthPx', event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <span>px</span>
                  </div>
                </label>
                <label>
                  高度
                  <div className="number-input-shell">
                    <input
                      key={`image-height-${selectedNodeInfo.nodeId}-${selectedImageLayout?.heightPx ?? ''}`}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={selectedImageLayout?.heightPx ?? ''}
                      onBlur={(event) => handleImageDimensionChange('heightPx', event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <span>px</span>
                  </div>
                </label>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selectedImageMetadata.lockAspectRatio ?? true}
                  onChange={(event) =>
                    commitImageMetadata({ lockAspectRatio: event.target.checked })
                  }
                />
                <span>锁定比例</span>
              </label>
            </div>
            <div className="image-property-group">
              <div className="image-property-group-title">裁剪</div>
              <div className="margin-grid">
                <label>
                  上
                  <div className="number-input-shell">
                    <input
                      key={`image-crop-top-${selectedNodeInfo.nodeId}-${selectedImageLayout?.cropTopPx ?? 0}`}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={selectedImageLayout?.cropTopPx ?? 0}
                      onBlur={(event) => handleImageFieldChange('cropTopPx', event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <span>px</span>
                  </div>
                </label>
                <label>
                  右
                  <div className="number-input-shell">
                    <input
                      key={`image-crop-right-${selectedNodeInfo.nodeId}-${selectedImageLayout?.cropRightPx ?? 0}`}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={selectedImageLayout?.cropRightPx ?? 0}
                      onBlur={(event) => handleImageFieldChange('cropRightPx', event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <span>px</span>
                  </div>
                </label>
                <label>
                  下
                  <div className="number-input-shell">
                    <input
                      key={`image-crop-bottom-${selectedNodeInfo.nodeId}-${selectedImageLayout?.cropBottomPx ?? 0}`}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={selectedImageLayout?.cropBottomPx ?? 0}
                      onBlur={(event) => handleImageFieldChange('cropBottomPx', event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <span>px</span>
                  </div>
                </label>
                <label>
                  左
                  <div className="number-input-shell">
                    <input
                      key={`image-crop-left-${selectedNodeInfo.nodeId}-${selectedImageLayout?.cropLeftPx ?? 0}`}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={selectedImageLayout?.cropLeftPx ?? 0}
                      onBlur={(event) => handleImageFieldChange('cropLeftPx', event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <span>px</span>
                  </div>
                </label>
              </div>
              <p className="panel-note">裁剪只影响可视区域，不会改原始图片文件。</p>
            </div>
            <div className="image-property-group">
              <div className="image-property-group-title">环绕</div>
              <div className="segmented-group">
                {([
                  { id: 'inline', label: '嵌入型' },
                  { id: 'square', label: '四周型环绕' },
                  { id: 'topBottom', label: '上下型环绕' },
                  { id: 'tight', label: '紧密型环绕' },
                ] as const).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={selectedImageLayout?.wrapMode === option.id ? 'segment-chip active' : 'segment-chip'}
                    onClick={() => {
                      const patch: { wrapMode: ImageWrapMode; wrapSide?: ImageWrapSide } = { wrapMode: option.id };
                      if (isImageTextWrapMode(option.id)) {
                        patch.wrapSide = selectedImageLayout?.wrapSide ?? 'right';
                      }
                      commitImageMetadata(patch);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {selectedImageLayout && isImageTextWrapMode(selectedImageLayout.wrapMode) ? (
                <div className="image-wrap-side-row">
                  <span>绕排方向</span>
                  <div className="segmented-group">
                    {([
                      { id: 'left', label: '左侧' },
                      { id: 'right', label: '右侧' },
                    ] as const).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={selectedImageLayout.wrapSide === option.id ? 'segment-chip active' : 'segment-chip'}
                        onClick={() => commitImageMetadata({ wrapSide: option.id })}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="panel-note">紧密型当前按裁剪后的可见区域绕排，后续再扩展透明轮廓分析。</p>
            </div>
            {/* 新增：显示标题勾选开关 */}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={selectedImageMetadata.showCaption ?? false}
                onChange={(event) =>
                  commitImageMetadata({ showCaption: event.target.checked })
                }
              />
              <span>显示标题</span>
            </label>
          </div>
        </section>
      ) : null}

      {selectedNodeInfo.ownerBlock.type === 'toc' && selectedNodeInfo.ownerBlock.metadata.kind === 'toc' ? (
        (() => {
          const tocMetadata = selectedNodeInfo.ownerBlock.metadata;

          return (
            <section className="detail-panel object-detail-panel">
              <div className="detail-panel-head">
                <h3>目录层级</h3>
                <span>控制正文目录显示到哪一级标题</span>
              </div>
              <div className="segmented-group">
                {([
                  { depth: 3 as const, label: '显示 H1-H3' },
                  { depth: 2 as const, label: '显示 H1-H2' },
                  { depth: 1 as const, label: '仅 H1' },
                ]).map((option) => (
                  <button
                    key={option.depth}
                    type="button"
                    className={tocMetadata.maxDepth === option.depth ? 'segment-chip active' : 'segment-chip'}
                    onClick={() =>
                      updateLayoutTocMaxDepth({
                        nodeId: selectedNodeInfo.nodeId,
                        maxDepth: option.depth,
                      })
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="table-structure-grid">
                <button
                  type="button"
                  className="segment-chip table-structure-button"
                  onClick={handleTocRefresh}
                >
                  刷新目录
                </button>
              </div>
              {tocRefreshFeedback ? <p className="table-structure-feedback">{tocRefreshFeedback}</p> : null}
            </section>
          );
        })()
      ) : null}

      {selectedBlockquoteContext ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>引用容器</h3>
            <span>
              共 {selectedBlockquoteContext.childCount} 个子块
              {selectedBlockquoteDirectChild
                ? ` · 当前第 ${selectedBlockquoteContext.directChildIndex + 1} 个`
                : ' · 当前选中整个引用容器'}
            </span>
          </div>
          <div className="blockquote-structure-list">
            {selectedBlockquoteChildren.map((childBlock, index) => {
              const isActive = childBlock.id === selectedBlockquoteDirectChild?.id;

              return (
                <div
                  key={childBlock.id}
                  className={isActive ? 'blockquote-structure-item active' : 'blockquote-structure-item'}
                >
                  <div className="blockquote-structure-item-head">
                    <strong>
                      第 {index + 1} 项 · {blockTypeLabels[childBlock.type]}
                    </strong>
                    {isActive ? <span>当前子块</span> : null}
                  </div>
                  <p>{getBlockPreviewText(childBlock)}</p>
                </div>
              );
            })}
          </div>
          {!selectedBlockquoteDirectChild ? (
            <div className="object-empty-state">请先选中引用中的具体子块，再执行结构操作</div>
          ) : null}
        </section>
      ) : null}

      {selectedBlockquoteContext ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>引用结构</h3>
            <span>
              {selectedBlockquoteDirectChild
                ? `${blockTypeLabels[selectedBlockquoteDirectChild.type]} · 围绕当前子块操作`
                : '当前未定位到具体子块'}
            </span>
          </div>
          <div className="table-structure-grid">
            {blockquoteStructureActions.map((option) => {
              const isDisabled =
                !selectedBlockquoteDirectChild ||
                (option.disabledWhen === 'singleBlock' && selectedBlockquoteContext.childCount <= 1);

              return (
                <button
                  key={option.id}
                  type="button"
                  className="segment-chip table-structure-button"
                  disabled={isDisabled}
                  title={
                    !selectedBlockquoteDirectChild
                      ? '请先选中引用中的具体子块'
                      : isDisabled
                        ? '至少需要保留 1 个引用子块'
                        : option.label
                  }
                  onClick={() => handleBlockquoteStructureAction(option.id)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {blockquoteStructureFeedback ? <p className="table-structure-feedback">{blockquoteStructureFeedback}</p> : null}
        </section>
      ) : null}

      {selectedListBlockWithoutItem ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>列表属性</h3>
            <span>请先选中具体列表项</span>
          </div>
          <div className="object-empty-state">选中列表项后可切换类型、设置起始编号和增删列表项</div>
        </section>
      ) : null}

      {selectedListItemPosition && selectedListMetadata ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>列表属性</h3>
            <span>
              {isTaskList ? '任务列表' : selectedListMetadata.ordered ? '有序列表' : '无序列表'} · 当前第 {selectedListItemPosition.itemIndex + 1} 项
            </span>
          </div>
          <div className="property-stack">
            <label>
              列表类型
              <div className="segmented-group">
                <button
                  type="button"
                  className={!selectedListMetadata.ordered && !isTaskList ? 'segment-chip active' : 'segment-chip'}
                  onClick={() => handleListOrderedChange(false)}
                >
                  无序列表
                </button>
                <button
                  type="button"
                  className={selectedListMetadata.ordered && !isTaskList ? 'segment-chip active' : 'segment-chip'}
                  onClick={() => handleListOrderedChange(true)}
                >
                  有序列表
                </button>
                <button
                  type="button"
                  className={isTaskList ? 'segment-chip active' : 'segment-chip'}
                  onClick={() => handleListTaskModeChange(true)}
                >
                  任务列表
                </button>
              </div>
            </label>
            <label>
              起始编号
              <div className="number-input-shell">
                <input
                  key={`list-start-${selectedNodeInfo.ownerBlock.id}-${currentListStart}`}
                  type="number"
                  min={1}
                  max={999}
                  step={1}
                  defaultValue={currentListStart}
                  disabled={!selectedListMetadata.ordered}
                  onBlur={(event) => {
                    const nextValue = Number(event.currentTarget.value);
                    if (!Number.isFinite(nextValue)) {
                      event.currentTarget.value = String(currentListStart);
                      return;
                    }

                    handleListStartChange(Math.max(1, Math.min(999, Math.round(nextValue))));
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') {
                      return;
                    }

                    (event.currentTarget as HTMLInputElement).blur();
                  }}
                />
                <span>号</span>
              </div>
            </label>
            <div className="object-property-list">
              {renderObjectPropertyRow('当前层级', `第 ${currentListLevel} 级`)}
            </div>
            <div className="table-structure-grid">
              <button type="button" className="segment-chip table-structure-button" onClick={() => handleListLevelChange('outdent')}>
                提升一级
              </button>
              <button type="button" className="segment-chip table-structure-button" onClick={() => handleListLevelChange('indent')}>
                降低一级
              </button>
              <button type="button" className="segment-chip table-structure-button" onClick={() => handleListReorderAction('moveUp')}>
                上移
              </button>
              <button type="button" className="segment-chip table-structure-button" onClick={() => handleListReorderAction('moveDown')}>
                下移
              </button>
            </div>
            {selectedListItem && selectedListItem.checked !== null ? (
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={selectedListItem?.checked ?? false}
                  onChange={(event) => handleListItemCheckedChange(event.target.checked)}
                />
                <span>任务项勾选</span>
              </label>
            ) : null}
            <div className="table-structure-grid">
              <button
                type="button"
                className="segment-chip table-structure-button"
                onClick={() => handleListTaskConversionAction('convertToTask')}
              >
                转任务项
              </button>
              <button
                type="button"
                className="segment-chip table-structure-button"
                onClick={() => handleListTaskConversionAction('convertToPlain')}
              >
                取消任务项
              </button>
              <button
                type="button"
                className="segment-chip table-structure-button"
                onClick={() => handleListTaskModeChange(false)}
              >
                整列表转普通
              </button>
            </div>
            {isTaskList ? (
              <div className="table-structure-grid">
                <button
                  type="button"
                  className="segment-chip table-structure-button"
                  onClick={() => handleListBatchCheckedAction('all', 'check')}
                >
                  全部勾选
                </button>
                <button
                  type="button"
                  className="segment-chip table-structure-button"
                  onClick={() => handleListBatchCheckedAction('all', 'uncheck')}
                >
                  全部取消
                </button>
                <button
                  type="button"
                  className="segment-chip table-structure-button"
                  onClick={() => handleListBatchCheckedAction('currentLevel', 'check')}
                >
                  当前层级全勾选
                </button>
                <button
                  type="button"
                  className="segment-chip table-structure-button"
                  onClick={() => handleListBatchCheckedAction('currentLevel', 'uncheck')}
                >
                  当前层级全取消
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {selectedListItemPosition ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>列表结构</h3>
            <span>
              共 {selectedListItemPosition.itemCount} 项 · 当前第 {selectedListItemPosition.itemIndex + 1} 项
            </span>
          </div>
          <div className="table-structure-grid">
            {listStructureActions.map((option) => {
              const isDisabled = option.disabledWhen === 'singleItem' && selectedListItemPosition.itemCount <= 1;

              return (
                <button
                  key={option.id}
                  type="button"
                  className="segment-chip table-structure-button"
                  disabled={isDisabled}
                  title={isDisabled ? '至少需要保留 1 个列表项' : option.label}
                  onClick={() => handleListStructureAction(option.id)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {listStructureFeedback ? <p className="table-structure-feedback">{listStructureFeedback}</p> : null}
        </section>
      ) : null}

      {selectedTableBlockWithoutCell ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>表格属性</h3>
            <span>请先选中具体单元格</span>
          </div>
          <div className="object-empty-state">选中单元格后可设置表头、列对齐和增删行列</div>
        </section>
      ) : null}

      {selectedTableCellPosition ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>表格属性</h3>
            <span>表头与当前列</span>
          </div>
          <div className="property-stack">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={isHeaderRowEnabled}
                onChange={(event) => handleTableHeaderRowChange(event.target.checked)}
              />
              <span>首行作为表头</span>
            </label>
            <label>
              当前列对齐
              <select
                className="style-select-input"
                value={currentTableColumnAlign ?? 'default'}
                onChange={(event) =>
                  handleTableColumnAlignChange(
                    event.target.value === 'default' ? null : (event.target.value as TableColumnAlign),
                  )
                }
              >
                {tableColumnAlignOptions.map((option) => (
                  <option key={option.id ?? 'default'} value={option.id ?? 'default'}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="table-structure-grid">
              <button
                type="button"
                className="segment-chip table-structure-button"
                onClick={handleTableAutoFitSize}
              >
                适应最佳行高列宽
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {selectedTableCellPosition ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>表格结构</h3>
            <span>
              {selectedTableCellPosition.rowCount} 行 x {selectedTableCellPosition.columnCount} 列 · 当前第{' '}
              {selectedTableCellPosition.rowIndex + 1} 行第 {selectedTableCellPosition.columnIndex + 1} 列
            </span>
          </div>
          <div className="object-property-list">
            {renderObjectPropertyRow(
              '当前选区',
              canMergeSelectedTableCells
                ? `${tableSelection!.endRowIndex - tableSelection!.startRowIndex + 1} 行 x ${tableSelection!.endColumnIndex - tableSelection!.startColumnIndex + 1} 列，共 ${selectedTableRangeCellCount} 个单元格`
                : '单个单元格',
            )}
          </div>
          <div className="table-structure-grid">
            <button
              type="button"
              className="segment-chip table-structure-button"
              disabled={!canMergeSelectedTableCells}
              title={canMergeSelectedTableCells ? '合并选中单元格' : '按住 Shift 点击相邻单元格后可合并'}
              onClick={handleTableMergeCells}
            >
              合并选中单元格
            </button>
          </div>
          <div className="table-structure-grid">
            {tableStructureActions.map((option) => {
              const isDisabled =
                option.disabledWhen === 'singleRow'
                  ? selectedTableCellPosition.rowCount <= 1
                  : option.disabledWhen === 'singleColumn'
                    ? selectedTableCellPosition.columnCount <= 1
                    : false;

              return (
                <button
                  key={option.id}
                  type="button"
                  className="segment-chip table-structure-button"
                  disabled={isDisabled}
                  title={isDisabled ? '至少需要保留 1 行 x 1 列' : option.label}
                  onClick={() => handleTableStructureAction(option.id)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {tableStructureFeedback ? <p className="table-structure-feedback">{tableStructureFeedback}</p> : null}
        </section>
      ) : null}

      {selectedEquationMetadata ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>公式属性</h3>
            <span>{selectedEquationRenderSummary?.statusText ?? '公式'}</span>
          </div>
          <div className="property-stack">
            <label>
              公式源码
              <textarea
                key={`equation-source-${selectedNodeInfo.nodeId}-${selectedEquationMetadata.value}`}
                className="style-text-input equation-source-input"
                defaultValue={selectedEquationMetadata.value}
                rows={4}
                onBlur={(event) => {
                  if (event.currentTarget.value !== selectedEquationMetadata.value) {
                    updateLayoutNodeText({
                      nodeId: selectedNodeInfo.nodeId,
                      text: event.currentTarget.value,
                    });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
          </div>
          <div className="panel-note-list">
            <p>当前公式会同步到画布预览和导出结果。</p>
            <p>{selectedEquationRenderSummary?.errorText ? `解析错误：${selectedEquationRenderSummary.errorText}` : '解析正常'}</p>
          </div>
        </section>
      ) : null}

      {isTextStyleEditable(selectedNodeInfo) ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>文字样式</h3>
            <span>
              {canvasTextSelection.nodeId === selectedNodeInfo.nodeId && canvasTextSelection.isEditing && activeSelection
                ? '当前有文字选区，样式只作用到选中字'
                : '当前没有选中文字，样式作用到整个节点'}
            </span>
          </div>
          <div className="segmented-group">
            {textMarkOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={isTextMarkActive(selectedNodeInfo.textRuns, activeSelection, option.id) ? 'segment-chip active' : 'segment-chip'}
                onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                onClick={() =>
                  toggleLayoutNodeTextMark({
                    nodeId: selectedNodeInfo.nodeId,
                    selection: activeSelection,
                    markType: option.id,
                  })
                }
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              className="segment-chip"
              onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
              onClick={() =>
                clearLayoutNodeTextFormatting({
                  nodeId: selectedNodeInfo.nodeId,
                  selection: activeSelection,
                })
              }
            >
              清除文字格式
            </button>
          </div>
          <div className="panel-note-list">
            <p>清除文字格式只回退文字级视觉覆盖，当前模板基线和块级样式会保留。</p>
          </div>
          <div className="margin-grid">
            <label>
              字体
              <select
                className="style-select-input"
                value={currentFontFamily}
                onChange={(event) => {
                  if (event.target.value === fontFamilyPlaceholderValue) {
                    return;
                  }

                  syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId);
                  applyLayoutNodeTextStyle({
                    nodeId: selectedNodeInfo.nodeId,
                    selection: activeSelection,
                    styleOverrides: { fontFamily: event.target.value },
                  });
                }}
              >
                <option value={fontFamilyPlaceholderValue} disabled>
                  字体
                </option>
                {textFontFamilyGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              字号
              <div className="number-input-shell">
                <input
                  key={`font-size-${selectedNodeInfo.nodeId}-${currentFontSize}`}
                  type="number"
                  min={10}
                  max={72}
                  step={1}
                  defaultValue={currentFontSize}
                  onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                  onBlur={(event) => {
                    const nextValue = Number(event.currentTarget.value);
                    if (!Number.isFinite(nextValue)) {
                      event.currentTarget.value = String(currentFontSize);
                      return;
                    }

                    applyLayoutNodeTextStyle({
                      nodeId: selectedNodeInfo.nodeId,
                      selection: activeSelection,
                      styleOverrides: { fontSize: Math.max(10, Math.min(72, Math.round(nextValue))) },
                    });
                  }}
                />
                <span>px</span>
              </div>
            </label>
            <label>
              文字颜色
              <div className="style-color-control">
                <input
                  className="style-color-input"
                  type="color"
                  value={currentColor}
                  onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                  onChange={(event) =>
                    applyLayoutNodeTextStyle({
                      nodeId: selectedNodeInfo.nodeId,
                      selection: activeSelection,
                      styleOverrides: { color: event.target.value },
                    })
                  }
                />
                <div className="style-standard-swatch-list" aria-label="文字颜色标准色">
                  {standardColorOptions.map((option) => (
                    <button
                      key={`text-${option.value}`}
                      type="button"
                      className={currentColor === option.value ? 'style-standard-swatch active' : 'style-standard-swatch'}
                      title={`文字颜色：${option.label}`}
                      aria-label={`文字颜色：${option.label}`}
                      onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                      onClick={() =>
                        applyLayoutNodeTextStyle({
                          nodeId: selectedNodeInfo.nodeId,
                          selection: activeSelection,
                          styleOverrides: { color: option.value },
                        })
                      }
                    >
                      <span style={{ backgroundColor: option.value }} />
                    </button>
                  ))}
                </div>
              </div>
            </label>
            <label>
              高亮颜色
              <div className="style-color-control">
                <div className="style-standard-swatch-list" aria-label="高亮颜色浅色">
                  {highlightColorOptions.map((option) => (
                    <button
                      key={`highlight-${option.value}`}
                      type="button"
                      className={
                        currentHighlightColor === option.value
                          ? 'style-standard-swatch active'
                          : 'style-standard-swatch'
                      }
                      title={`高亮颜色：${option.label}`}
                      aria-label={`高亮颜色：${option.label}`}
                      onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                      onClick={() =>
                        applyLayoutNodeTextStyle({
                          nodeId: selectedNodeInfo.nodeId,
                          selection: activeSelection,
                          styleOverrides: { highlightColor: option.value },
                        })
                      }
                    >
                      <span style={{ backgroundColor: option.value }} />
                    </button>
                  ))}
                </div>
              </div>
            </label>
          </div>
        </section>
      ) : null}

      {blockStyleControlSupport ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>{blockStyleControlSupport.sectionTitle}</h3>
            <span>
              {isSameTypeRuleMode && currentBlockStyleScopeLabel
                ? `当前正在编辑 ${currentBlockStyleScopeLabel} 同类块规则`
                : blockStyleControlSupport.sectionHint}
            </span>
          </div>
          {currentBlockStyleScopeLabel ? (
            <div className="block-style-scope-panel">
              <span className="block-style-scope-caption">应用范围</span>
              <div className="segmented-group">
                <button
                  type="button"
                  className={blockStyleApplyMode === 'current' ? 'segment-chip active' : 'segment-chip'}
                  onClick={() => onBlockStyleApplyModeChange('current')}
                >
                  当前块
                </button>
                <button
                  type="button"
                  className={blockStyleApplyMode === 'sameType' ? 'segment-chip active' : 'segment-chip'}
                  onClick={() => onBlockStyleApplyModeChange('sameType')}
                >
                  {currentBlockStyleScopeLabel}
                </button>
              </div>
            </div>
          ) : null}
          {blockStyleControlSupport.supportsTextAlign ? (
            <div className="segmented-group">
              {([
                { id: 'left', label: '左对齐' },
                { id: 'center', label: '居中' },
                { id: 'right', label: '右对齐' },
                { id: 'justify', label: '两端' },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={currentTextAlign === option.id ? 'segment-chip active' : 'segment-chip'}
                  onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                  onClick={() => applyBlockStyleByMode({ textAlign: option.id })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="margin-grid">
            {blockStyleControlSupport.supportsLineHeight ? (
              <label>
                行高
                <div className="number-input-shell">
                  <input
                    key={`line-height-${selectedNodeInfo.nodeId}-${blockStyleApplyMode}-${currentLineHeight}`}
                    type="number"
                    min={1}
                    max={200}
                    step={1}
                    defaultValue={currentLineHeight}
                    onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                    onBlur={(event) => {
                      const nextValue = Number(event.currentTarget.value);
                      if (!Number.isFinite(nextValue)) {
                        event.currentTarget.value = String(currentLineHeight);
                        return;
                      }

                      applyBlockStyleByMode({
                        lineHeight: Math.max(1, Math.min(200, Math.round(nextValue))),
                      });
                    }}
                  />
                  <span>px</span>
                </div>
                <div className="line-spacing-editor">
                  <span className="line-spacing-caption">Word 风格行距</span>
                  <div className="segmented-group line-spacing-chip-group">
                    {lineSpacingPresetOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={activeLineSpacingPresetId === option.id ? 'segment-chip active' : 'segment-chip'}
                        onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                        onClick={() =>
                          applyBlockStyleByMode({
                            lineHeight: resolveLineHeightFromMultiple(option.multiple, lineSpacingReferenceFontSize),
                          })
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="line-spacing-custom-row">
                    <span>多倍</span>
                    <div className="number-input-shell">
                      <input
                        key={`line-spacing-multiple-${selectedNodeInfo.nodeId}-${blockStyleApplyMode}-${formatLineSpacingMultiple(currentLineSpacingMultiple)}`}
                        type="number"
                        min={0.5}
                        max={4}
                        step={0.05}
                        defaultValue={formatLineSpacingMultiple(currentLineSpacingMultiple)}
                        onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                        onBlur={(event) => {
                          const nextMultiple = normalizeLineSpacingMultipleInput(event.currentTarget.value);
                          if (!nextMultiple) {
                            event.currentTarget.value = formatLineSpacingMultiple(currentLineSpacingMultiple);
                            return;
                          }

                          applyBlockStyleByMode({
                            lineHeight: resolveLineHeightFromMultiple(nextMultiple, lineSpacingReferenceFontSize),
                          });
                        }}
                      />
                      <span>倍</span>
                    </div>
                  </div>
                </div>
              </label>
            ) : null}
            {blockStyleControlSupport.supportsIndentLeft ? (
              <label>
                左缩进
                <div className="number-input-shell">
                  <input
                    key={`indent-left-${selectedNodeInfo.nodeId}-${blockStyleApplyMode}-${currentIndentLeft}`}
                    type="number"
                    min={0}
                    max={200}
                    step={2}
                    defaultValue={currentIndentLeft}
                    onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                    onBlur={(event) => {
                      const nextValue = Number(event.currentTarget.value);
                      if (!Number.isFinite(nextValue)) {
                        event.currentTarget.value = String(currentIndentLeft);
                        return;
                      }

                      applyBlockStyleByMode({
                        indentLeft: Math.max(0, Math.min(200, Math.round(nextValue))),
                      });
                    }}
                  />
                  <span>px</span>
                </div>
              </label>
            ) : null}
            {blockStyleControlSupport.supportsIndentRight ? (
              <label>
                右缩进
                <div className="number-input-shell">
                  <input
                    key={`indent-right-${selectedNodeInfo.nodeId}-${blockStyleApplyMode}-${currentIndentRight}`}
                    type="number"
                    min={0}
                    max={200}
                    step={2}
                    defaultValue={currentIndentRight}
                    onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                    onBlur={(event) => {
                      const nextValue = Number(event.currentTarget.value);
                      if (!Number.isFinite(nextValue)) {
                        event.currentTarget.value = String(currentIndentRight);
                        return;
                      }

                      applyBlockStyleByMode({
                        indentRight: Math.max(0, Math.min(200, Math.round(nextValue))),
                      });
                    }}
                  />
                  <span>px</span>
                </div>
              </label>
            ) : null}
            {blockStyleControlSupport.supportsFirstLineIndent ? (
              <label>
                首行缩进
                <div className="number-input-shell">
                  <input
                    key={`first-line-indent-${selectedNodeInfo.nodeId}-${blockStyleApplyMode}-${currentFirstLineIndent}`}
                    type="number"
                    min={0}
                    max={120}
                    step={2}
                    defaultValue={currentFirstLineIndent}
                    onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                    onBlur={(event) => {
                      const nextValue = Number(event.currentTarget.value);
                      if (!Number.isFinite(nextValue)) {
                        event.currentTarget.value = String(currentFirstLineIndent);
                        return;
                      }

                      applyBlockStyleByMode({
                        firstLineIndent: Math.max(0, Math.min(120, Math.round(nextValue))),
                      });
                    }}
                  />
                  <span>px</span>
                </div>
              </label>
            ) : null}
            {blockStyleControlSupport.supportsHangingIndent ? (
              <label>
                悬挂缩进
                <div className="number-input-shell">
                  <input
                    key={`hanging-indent-${selectedNodeInfo.nodeId}-${blockStyleApplyMode}-${currentHangingIndent}`}
                    type="number"
                    min={0}
                    max={120}
                    step={2}
                    defaultValue={currentHangingIndent}
                    onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                    onBlur={(event) => {
                      const nextValue = Number(event.currentTarget.value);
                      if (!Number.isFinite(nextValue)) {
                        event.currentTarget.value = String(currentHangingIndent);
                        return;
                      }

                      applyBlockStyleByMode({
                        hangingIndent: Math.max(0, Math.min(120, Math.round(nextValue))),
                      });
                    }}
                  />
                  <span>px</span>
                </div>
              </label>
            ) : null}
            {blockStyleControlSupport.supportsSpaceBefore ? (
              <label>
                段前距
                <div className="number-input-shell">
                  <input
                    key={`space-before-${selectedNodeInfo.nodeId}-${blockStyleApplyMode}-${currentSpaceBefore}`}
                    type="number"
                    min={0}
                    max={120}
                    step={1}
                    defaultValue={currentSpaceBefore}
                    onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                    onBlur={(event) => {
                      const nextValue = Number(event.currentTarget.value);
                      if (!Number.isFinite(nextValue)) {
                        event.currentTarget.value = String(currentSpaceBefore);
                        return;
                      }

                      applyBlockStyleByMode({
                        spaceBefore: Math.max(0, Math.min(120, Math.round(nextValue))),
                      });
                    }}
                  />
                  <span>px</span>
                </div>
              </label>
            ) : null}
            {blockStyleControlSupport.supportsSpaceAfter ? (
              <label>
                段后距
                <div className="number-input-shell">
                  <input
                    key={`space-after-${selectedNodeInfo.nodeId}-${blockStyleApplyMode}-${currentSpaceAfter}`}
                    type="number"
                    min={0}
                    max={120}
                    step={1}
                    defaultValue={currentSpaceAfter}
                    onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                    onBlur={(event) => {
                      const nextValue = Number(event.currentTarget.value);
                      if (!Number.isFinite(nextValue)) {
                        event.currentTarget.value = String(currentSpaceAfter);
                        return;
                      }

                      applyBlockStyleByMode({
                        spaceAfter: Math.max(0, Math.min(120, Math.round(nextValue))),
                      });
                    }}
                  />
                  <span>px</span>
                </div>
              </label>
            ) : null}
          </div>
          {blockStyleControlSupport.note || currentBlockStyleScopeLabel ? (
            <div className="panel-note-list">
              {currentBlockStyleScopeLabel ? (
                <p>同类块规则会先作用到当前类型所有块；如果某一个块单独再改，当前块局部样式仍会优先覆盖它。</p>
              ) : null}
              <p>{blockStyleControlSupport.note ?? '当前块局部样式会继续覆盖模板默认值。'}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {canDeleteTopLevelBlock ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>块操作</h3>
            <span>删除当前顶层块</span>
          </div>
          <div className="table-structure-grid">
            <button
              type="button"
              className="segment-chip table-structure-button danger-chip"
              onClick={handleTopLevelBlockDelete}
            >
              删除当前块
            </button>
          </div>
          {topLevelBlockFeedback ? <p className="table-structure-feedback">{topLevelBlockFeedback}</p> : null}
        </section>
      ) : null}

      {!selectedImageMetadata &&
      !selectedBlockquoteContext &&
      !selectedColumnSectionMetadata &&
      !isTextStyleEditable(selectedNodeInfo) &&
      !isBlockStyleEditable(selectedNodeInfo) ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>本步边界说明</h3>
            <span>当前对象暂未纳入 PH2-06 V1 的样式编辑范围</span>
          </div>
          <div className="object-empty-state">公式等对象样式编辑会在后续任务中补齐</div>
        </section>
      ) : null}
    </>
  );
}

function renderLayoutWarningsPanel(layoutWarnings: LayoutWarning[]): JSX.Element | null {
  if (layoutWarnings.length === 0) {
    return null;
  }

  return (
    <section className="detail-panel detail-panel-warning">
      <div className="detail-panel-head">
        <h3>排版提示</h3>
        <span>检测到 {layoutWarnings.length} 条需要处理的排版风险</span>
      </div>
      <div className="warning-list">
        {layoutWarnings.map((warning, index) => (
          <article key={`${warning.pageNumber}-${warning.type}-${warning.blockType}-${index}`} className="warning-card">
            <strong>
              第 {warning.pageNumber} 页 · {warning.blockLabel}
            </strong>
            <p>{warning.message}</p>
            <span>{warning.suggestion}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function renderExportCheckPanel(exportCheckResult: ExportCheckResult): JSX.Element {
  const { items, summary } = exportCheckResult;
  if (items.length === 0) {
    return (
      <section className="detail-panel export-check-panel">
        <div className="detail-panel-head">
          <h3>导出检查</h3>
          <span>当前没有发现需要额外提醒的导出风险</span>
        </div>
        <div className="object-empty-state">当前文档可以直接继续导出；后续新增规则后，这里会继续补齐更细的提示。</div>
      </section>
    );
  }

  return (
    <section className="detail-panel export-check-panel">
      <div className="detail-panel-head">
        <h3>导出检查</h3>
        <span>错误 {summary.errorCount} 条，警告 {summary.warningCount} 条，提醒 {summary.noticeCount} 条</span>
      </div>
      <div className="export-check-summary-grid">
        <div className="export-check-summary-card severity-error">
          <strong>{summary.errorCount}</strong>
          <span>错误</span>
        </div>
        <div className="export-check-summary-card severity-warning">
          <strong>{summary.warningCount}</strong>
          <span>警告</span>
        </div>
        <div className="export-check-summary-card severity-notice">
          <strong>{summary.noticeCount}</strong>
          <span>提醒</span>
        </div>
      </div>
      <div className="export-check-list">
        {items.map((item) => (
          <article key={item.id} className={`export-check-card severity-${item.severity}`}>
            <div className="export-check-card-head">
              <strong>{item.title}</strong>
              <div className="export-check-chip-group">
                <span className={`export-check-chip severity-${item.severity}`}>
                  {getExportCheckSeverityLabel(item.severity)}
                </span>
                <span className="export-check-chip target-chip">{getExportCheckTargetLabel(item.target)}</span>
                <span className="export-check-chip target-chip">{item.category}</span>
              </div>
            </div>
            <p>{item.message}</p>
            <span>{item.suggestion}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function renderPageSpecPanel({
  resolvedStyleContract,
  styleSettings,
  setPageSize,
  setOrientation,
}: {
  resolvedStyleContract: ReturnType<typeof useResolvedStyleContract>;
  styleSettings: StyleSettings;
  setPageSize: (pageSize: PageSizeId) => void;
  setOrientation: (orientation: PageOrientation) => void;
}): JSX.Element {
  const paginationAlgorithmOptions = listPaginationAlgorithms();
  return (
    <section className="detail-panel">
      <div className="detail-panel-head">
        <h3>页面规格</h3>
        <span>纸张和方向</span>
      </div>
      <div className="option-card-grid option-card-grid-3">
        {pageSizeDefinitions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === styleSettings.pageSize ? 'option-card active' : 'option-card'}
            onClick={() => setPageSize(option.id)}
          >
            <strong>{option.label}</strong>
            <span>
              {option.widthMm} × {option.heightMm} mm
            </span>
          </button>
        ))}
      </div>
      <div className="segmented-group">
        {orientationOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === styleSettings.orientation ? 'segment-chip active' : 'segment-chip'}
            onClick={() => setOrientation(option.id)}
            title={option.description}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="panel-note-list">
        <p>当前正文可用区：约 {Math.round(resolvedStyleContract.contentWidthMm)} × {Math.round(resolvedStyleContract.contentHeightMm)} mm</p>
      </div>
    </section>
  );
}

function renderMarginPanel({
  styleSettings,
  marginDrafts,
  setMarginMode,
  setMarginPreset,
  setMarginLinked,
  handleMarginDraftChange,
  commitMarginDraft,
}: {
  styleSettings: StyleSettings;
  marginDrafts: Record<MarginSide, string>;
  setMarginMode: (mode: 'preset' | 'custom') => void;
  setMarginPreset: (preset: MarginPresetId) => void;
  setMarginLinked: (linked: boolean) => void;
  handleMarginDraftChange: (side: MarginSide, value: string) => void;
  commitMarginDraft: (side: MarginSide) => void;
}): JSX.Element {
  return (
    <section className="detail-panel">
      <div className="detail-panel-head">
        <h3>页边距</h3>
        <span>预设和自定义</span>
      </div>
      <div className="segmented-group">
        <button
          type="button"
          className={styleSettings.marginMode === 'preset' ? 'segment-chip active' : 'segment-chip'}
          onClick={() => setMarginMode('preset')}
        >
          使用预设
        </button>
        <button
          type="button"
          className={styleSettings.marginMode === 'custom' ? 'segment-chip active' : 'segment-chip'}
          onClick={() => setMarginMode('custom')}
        >
          自定义
        </button>
      </div>
      <div className="option-card-grid">
        {marginPresetDefinitions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === styleSettings.marginPreset ? 'option-card active' : 'option-card'}
            onClick={() => {
              setMarginMode('preset');
              setMarginPreset(option.id);
            }}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={styleSettings.isMarginLinked}
          onChange={(event) => setMarginLinked(event.target.checked)}
        />
        <span>四边联动</span>
      </label>
      <div className="margin-grid">
        {(['top', 'right', 'bottom', 'left'] as MarginSide[]).map((side) => (
          <label key={side}>
            {marginSideLabels[side]}
            <div className="number-input-shell">
              <input
                type="number"
                min={5}
                max={80}
                step={1}
                value={marginDrafts[side]}
                onChange={(event) => handleMarginDraftChange(side, event.target.value)}
                onBlur={() => commitMarginDraft(side)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitMarginDraft(side);
                    (event.currentTarget as HTMLInputElement).blur();
                  }
                }}
                disabled={styleSettings.marginMode !== 'custom'}
              />
              <span>mm</span>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}

function renderHeaderFooterPanel({
  styleSettings,
  headerFooterDrafts,
  setHeaderFooterMode,
  setHeaderPreset,
  setFooterPreset,
  setHeaderFooterContentSlot,
  setHeaderFooterLinked,
  handleHeaderFooterDraftChange,
  commitHeaderFooterDraft,
}: {
  styleSettings: StyleSettings;
  headerFooterDrafts: { header: string; footer: string };
  setHeaderFooterMode: (mode: 'preset' | 'custom') => void;
  setHeaderPreset: (preset: HeaderFooterPresetId) => void;
  setFooterPreset: (preset: HeaderFooterPresetId) => void;
  setHeaderFooterContentSlot: (payload: {
    area: HeaderFooterArea;
    slot: HeaderFooterSlot;
    value: string;
  }) => void;
  setHeaderFooterLinked: (linked: boolean) => void;
  handleHeaderFooterDraftChange: (side: 'header' | 'footer', value: string) => void;
  commitHeaderFooterDraft: (side: 'header' | 'footer') => void;
}): JSX.Element {
  const slotLabels: Record<HeaderFooterSlot, string> = {
    left: '左侧',
    center: '中间',
    right: '右侧',
  };
  const contentAreas: Array<{ area: HeaderFooterArea; title: string }> = [
    { area: 'header', title: '页眉内容' },
    { area: 'footer', title: '页脚内容' },
  ];

  return (
    <section className="detail-panel">
      <div className="detail-panel-head">
        <h3>页眉页脚</h3>
        <span>设置高度与显示内容</span>
      </div>
      <div className="segmented-group">
        <button
          type="button"
          className={styleSettings.headerFooterMode === 'preset' ? 'segment-chip active' : 'segment-chip'}
          onClick={() => setHeaderFooterMode('preset')}
        >
          使用预设
        </button>
        <button
          type="button"
          className={styleSettings.headerFooterMode === 'custom' ? 'segment-chip active' : 'segment-chip'}
          onClick={() => setHeaderFooterMode('custom')}
        >
          自定义
        </button>
      </div>
      <div className="property-stack">
        <label>
          页眉
          <div className="segmented-group">
            {headerFooterPresetDefinitions.map((option) => (
              <button
                key={`header-${option.id}`}
                type="button"
                className={option.id === styleSettings.headerPreset ? 'segment-chip active' : 'segment-chip'}
                onClick={() => setHeaderPreset(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </label>
        <label>
          页脚
          <div className="segmented-group">
            {headerFooterPresetDefinitions.map((option) => (
              <button
                key={`footer-${option.id}`}
                type="button"
                className={option.id === styleSettings.footerPreset ? 'segment-chip active' : 'segment-chip'}
                onClick={() => setFooterPreset(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </label>
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={styleSettings.isHeaderFooterLinked}
          onChange={(event) => setHeaderFooterLinked(event.target.checked)}
        />
        <span>页眉页脚联动</span>
      </label>
      <div className="margin-grid">
        <label>
          页眉高度
          <div className="number-input-shell">
            <input
              type="number"
              min={0}
              max={80}
              step={1}
              value={headerFooterDrafts.header}
              onChange={(event) => handleHeaderFooterDraftChange('header', event.target.value)}
              onBlur={() => commitHeaderFooterDraft('header')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitHeaderFooterDraft('header');
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
              disabled={styleSettings.headerFooterMode !== 'custom'}
            />
            <span>mm</span>
          </div>
        </label>
        <label>
          页脚高度
          <div className="number-input-shell">
            <input
              type="number"
              min={0}
              max={80}
              step={1}
              value={headerFooterDrafts.footer}
              onChange={(event) => handleHeaderFooterDraftChange('footer', event.target.value)}
              onBlur={() => commitHeaderFooterDraft('footer')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitHeaderFooterDraft('footer');
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
              disabled={styleSettings.headerFooterMode !== 'custom'}
            />
            <span>mm</span>
          </div>
        </label>
      </div>
      <div className="header-footer-content-stack">
        {contentAreas.map((contentArea) => (
          <div key={contentArea.area} className="header-footer-content-group">
            <strong>{contentArea.title}</strong>
            {(['left', 'center', 'right'] as HeaderFooterSlot[]).map((slot) => (
              <label key={`${contentArea.area}-${slot}`}>
                {slotLabels[slot]}
                <input
                  type="text"
                  value={styleSettings.headerFooterContent[contentArea.area][slot]}
                  onChange={(event) =>
                    setHeaderFooterContentSlot({
                      area: contentArea.area,
                      slot,
                      value: event.target.value,
                    })
                  }
                  placeholder="可输入文字或变量"
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="panel-note-list">
        <p>可用变量：{headerFooterVariableLabels.join('、')}。</p>
        <p>内容编辑不会自动改变预留高度，如显示拥挤可在上方调整高度。</p>
      </div>
    </section>
  );
}

function renderColumnsPanel({
  styleSettings,
  resolvedStyleContract,
  columnGapDraft,
  setPageColumnCount,
  setPageColumnGapMm,
  setPageColumnDivider,
  setPageColumnHeadingsSpanAll,
  setColumnGapDraft,
}: {
  styleSettings: StyleSettings;
  resolvedStyleContract: ReturnType<typeof useResolvedStyleContract>;
  columnGapDraft: string;
  setPageColumnCount: (count: PageColumnCount) => void;
  setPageColumnGapMm: (value: number) => void;
  setPageColumnDivider: (value: boolean) => void;
  setPageColumnHeadingsSpanAll: (value: boolean) => void;
  setColumnGapDraft: (value: string) => void;
}): JSX.Element {
  const commitColumnGapDraft = () => {
    const nextValue = Number(columnGapDraft);
    if (Number.isNaN(nextValue)) {
      setColumnGapDraft(String(styleSettings.columns.gapMm));
      return;
    }

    setPageColumnGapMm(nextValue);
  };

  return (
    <section className="detail-panel">
      <div className="detail-panel-head">
        <h3>分栏</h3>
        <span>整篇页面级正文布局</span>
      </div>
      <div className="option-card-grid option-card-grid-3">
        {pageColumnOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === styleSettings.columns.count ? 'option-card active' : 'option-card'}
            onClick={() => setPageColumnCount(option.id)}
            title={option.description}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
      <div className="property-stack">
        <label>
          栏间距
          <div className="number-input-shell">
            <input
              type="number"
              min={4}
              max={30}
              step={1}
              value={columnGapDraft}
              onChange={(event) => setColumnGapDraft(event.target.value)}
              onBlur={commitColumnGapDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitColumnGapDraft();
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
              disabled={styleSettings.columns.count === 1}
            />
            <span>mm</span>
          </div>
        </label>
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={styleSettings.columns.count > 1 && styleSettings.columns.divider}
          onChange={(event) => setPageColumnDivider(event.target.checked)}
          disabled={styleSettings.columns.count === 1}
        />
        <span>显示栏分割线</span>
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={styleSettings.columns.count > 1 && styleSettings.columns.headingsSpanAll}
          onChange={(event) => setPageColumnHeadingsSpanAll(event.target.checked)}
          disabled={styleSettings.columns.count === 1}
        />
        <span>标题不参与分栏</span>
      </label>
      <div className="panel-note-list">
        <p>
          当前单栏正文宽度：约 {Math.round(resolvedStyleContract.singleColumnContentWidthMm)} mm
        </p>
        <p>默认二级及以下标题参与分栏，一级标题始终跨栏。</p>
      </div>
    </section>
  );
}

function getBlockSpacingPresetOptions(styleSettings: StyleSettings): BlockSpacingPreset[] {
  return [...blockSpacingPresetDefinitions, ...styleSettings.customBlockSpacingPresets];
}

function renderBlockSpacingPanel({
  styleSettings,
  setBlockSpacingParameter,
  applyBlockSpacingPreset,
  addBlockSpacingPreset,
  updateBlockSpacingPreset,
  newPresetName,
  setNewPresetName,
  newPresetDescription,
  setNewPresetDescription,
}: {
  styleSettings: StyleSettings;
  setBlockSpacingParameter: (parameter: BlockSpacingParameterKey, value: number) => void;
  applyBlockSpacingPreset: (presetId: string) => void;
  addBlockSpacingPreset: (payload: { name: string; description: string }) => string;
  updateBlockSpacingPreset: (payload: {
    presetId: string;
    name?: string;
    description?: string;
    parameters?: BlockSpacingParameters;
  }) => void;
  newPresetName: string;
  setNewPresetName: (value: string) => void;
  newPresetDescription: string;
  setNewPresetDescription: (value: string) => void;
}): JSX.Element {
  const allPresets = getBlockSpacingPresetOptions(styleSettings);
  const activePreset = allPresets.find((preset) => preset.id === styleSettings.blockSpacingPresetId);

  const handleAddPreset = () => {
    addBlockSpacingPreset({
      name: newPresetName,
      description: newPresetDescription,
    });
    setNewPresetName('');
    setNewPresetDescription('');
  };

  return (
    <>
      <section className="detail-panel">
        <div className="detail-panel-head">
          <h3>块排版预设</h3>
          <span>一键应用整篇文档的块间距和内边距</span>
        </div>
        <div className="option-card-grid">
          {allPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={preset.id === styleSettings.blockSpacingPresetId ? 'option-card active' : 'option-card'}
              onClick={() => applyBlockSpacingPreset(preset.id)}
            >
              <strong>{preset.name}</strong>
              <span>{preset.description || (preset.builtIn ? '内置预设' : '自定义预设')}</span>
            </button>
          ))}
        </div>
        <div className="panel-note-list">
          <p>
            当前：
            <strong>{activePreset?.name ?? '自定义参数'}</strong>
          </p>
          <p>单个块的局部段距、缩进和行高仍会优先覆盖这里的全局参数。</p>
        </div>
      </section>

      <section className="detail-panel">
        <div className="detail-panel-head">
          <h3>添加预设</h3>
          <span>把当前参数保存成一套可复用方案</span>
        </div>
        <div className="property-stack">
          <label>
            预设名称
            <input
              className="style-text-input"
              type="text"
              value={newPresetName}
              onChange={(event) => setNewPresetName(event.target.value)}
              placeholder="例如：讲义留白"
            />
          </label>
          <label>
            预设描述
            <input
              className="style-text-input"
              type="text"
              value={newPresetDescription}
              onChange={(event) => setNewPresetDescription(event.target.value)}
              placeholder="说明这套参数适合什么场景"
            />
          </label>
        </div>
        <button type="button" className="segment-chip table-structure-button" onClick={handleAddPreset}>
          添加为预设
        </button>
      </section>

      {styleSettings.customBlockSpacingPresets.length > 0 ? (
        <section className="detail-panel">
          <div className="detail-panel-head">
            <h3>自定义预设</h3>
            <span>可重命名、改描述或保存当前参数</span>
          </div>
          <div className="block-spacing-custom-list">
            {styleSettings.customBlockSpacingPresets.map((preset) => (
              <article key={preset.id} className="block-spacing-custom-item">
                <div className="property-stack">
                  <label>
                    名称
                    <input
                      key={`block-spacing-name-${preset.id}-${preset.name}`}
                      className="style-text-input"
                      type="text"
                      defaultValue={preset.name}
                      onBlur={(event) =>
                        updateBlockSpacingPreset({
                          presetId: preset.id,
                          name: event.currentTarget.value,
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </label>
                  <label>
                    描述
                    <input
                      key={`block-spacing-description-${preset.id}-${preset.description}`}
                      className="style-text-input"
                      type="text"
                      defaultValue={preset.description}
                      onBlur={(event) =>
                        updateBlockSpacingPreset({
                          presetId: preset.id,
                          description: event.currentTarget.value,
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="segmented-group">
                  <button type="button" className="segment-chip" onClick={() => applyBlockSpacingPreset(preset.id)}>
                    应用
                  </button>
                  <button
                    type="button"
                    className="segment-chip"
                    onClick={() =>
                      updateBlockSpacingPreset({
                        presetId: preset.id,
                        parameters: styleSettings.blockSpacing,
                      })
                    }
                  >
                    保存当前参数
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {blockSpacingParameterGroups.map((group) => (
        <section key={group.title} className="detail-panel">
          <div className="detail-panel-head">
            <h3>{group.title}</h3>
            <span>{group.hint}</span>
          </div>
          <div className="margin-grid">
            {group.items.map((item) => {
              const currentValue = styleSettings.blockSpacing[item.id];
              const maxValue = item.max ?? 160;
              const stepValue = item.step ?? 1;

              return (
                <label key={item.id}>
                  {item.label}
                  <div className="number-input-shell">
                    <input
                      key={`${item.id}-${currentValue}`}
                      type="number"
                      min={0}
                      max={maxValue}
                      step={stepValue}
                      defaultValue={currentValue}
                      onBlur={(event) => {
                        const nextValue = Number(event.currentTarget.value);
                        if (!Number.isFinite(nextValue)) {
                          event.currentTarget.value = String(currentValue);
                          return;
                        }

                        setBlockSpacingParameter(item.id, Math.max(0, Math.min(maxValue, Math.round(nextValue))));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                    />
                    <span>px</span>
                  </div>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

function renderPageBackgroundPanel({
  styleSettings,
  setPageBackground,
  backgroundFeedback,
  setBackgroundFeedback,
  backgroundColorDraft,
  setBackgroundColorDraft,
}: {
  styleSettings: StyleSettings;
  setPageBackground: (background: PageBackgroundSettings) => void;
  backgroundFeedback: string | null;
  setBackgroundFeedback: (message: string | null) => void;
  backgroundColorDraft: string;
  setBackgroundColorDraft: (value: string) => void;
}): JSX.Element {
  const currentBackground = styleSettings.pageBackground;
  const updateBackground = (patch: Partial<PageBackgroundSettings>): void => {
    setBackgroundFeedback(null);
    setPageBackground({
      ...currentBackground,
      ...patch,
    });
  };

  const handleSelectBackgroundImage = async (): Promise<void> => {
    try {
      const imagePath = await selectLocalImageFile();
      // 用户背景是主题之上的显式覆盖层；选择图片时自动切到图片模式。
      setPageBackground({
        ...currentBackground,
        mode: 'image',
        imageSrc: imagePath,
      });
      setBackgroundFeedback('已选择背景图片');
    } catch (error) {
      if (error instanceof Error && error.message === '已取消选择图片') {
        setBackgroundFeedback('已取消选择图片');
        return;
      }

      const message = error instanceof Error ? error.message : '选择背景图片失败';
      setBackgroundFeedback(message);
    }
  };

  const commitColorDraft = (): void => {
    if (!/^#[0-9a-fA-F]{6}$/.test(backgroundColorDraft.trim())) {
      setBackgroundColorDraft(currentBackground.color);
      setBackgroundFeedback('请输入 6 位十六进制颜色，例如 #ffffff');
      return;
    }

    updateBackground({ color: backgroundColorDraft.trim() });
  };

  return (
    <section className="detail-panel">
      <div className="detail-panel-head">
        <h3>页面背景</h3>
        <span>背景只改变页面视觉，不改变分页容量</span>
      </div>
      <div className="template-list">
        {pageBackgroundModeOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={currentBackground.mode === option.id ? 'template-swatch active' : 'template-swatch'}
            onClick={() => updateBackground({ mode: option.id })}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>

      <div className="property-stack">
        <label>
          背景颜色
          <div className="background-color-row">
            <input
              type="color"
              value={currentBackground.color}
              onChange={(event) => {
                setBackgroundColorDraft(event.target.value);
                updateBackground({ color: event.target.value });
              }}
              aria-label="选择页面背景颜色"
            />
            <input
              className="style-text-input"
              type="text"
              value={backgroundColorDraft}
              onChange={(event) => setBackgroundColorDraft(event.target.value)}
              onBlur={commitColorDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
        </label>
      </div>

      {currentBackground.mode === 'image' ? (
        <>
          <div className="property-stack">
            <label>
              背景图片
              <input
                className="style-text-input"
                type="text"
                value={currentBackground.imageSrc}
                onChange={(event) => updateBackground({ imageSrc: event.target.value })}
                placeholder="请选择本地图片"
              />
            </label>
          </div>
          <div className="segmented-group">
            <button type="button" className="segment-chip table-structure-button" onClick={handleSelectBackgroundImage}>
              选择图片
            </button>
            <button
              type="button"
              className="segment-chip"
              onClick={() => updateBackground({ imageSrc: '' })}
              disabled={!currentBackground.imageSrc}
            >
              清除图片
            </button>
          </div>
          <div className="template-list">
            {pageBackgroundFitOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={currentBackground.imageFit === option.id ? 'template-swatch active' : 'template-swatch'}
                onClick={() => updateBackground({ imageFit: option.id })}
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className="panel-note-list">
        <p>
          当前背景：
          <strong>{pageBackgroundModeOptions.find((option) => option.id === currentBackground.mode)?.label ?? '跟随主题'}</strong>
        </p>
        {currentBackground.mode === 'image' && currentBackground.imageSrc ? <p>{currentBackground.imageSrc}</p> : null}
      </div>
      {backgroundFeedback ? <p className="table-structure-feedback">{backgroundFeedback}</p> : null}
    </section>
  );
}

function renderPdfWatermarkPanel({
  styleSettings,
  setPdfWatermark,
  watermarkFeedback,
  setWatermarkFeedback,
}: {
  styleSettings: StyleSettings;
  setPdfWatermark: (watermark: PdfWatermarkSettings) => void;
  watermarkFeedback: string | null;
  setWatermarkFeedback: (message: string | null) => void;
}): JSX.Element {
  const currentWatermark = styleSettings.pdfWatermark;
  const updateWatermark = (
    patch: Omit<Partial<PdfWatermarkSettings>, 'text' | 'image'> & {
      text?: Partial<PdfWatermarkSettings['text']>;
      image?: Partial<PdfWatermarkSettings['image']>;
    },
  ): void => {
    setWatermarkFeedback(null);
    setPdfWatermark({
      ...currentWatermark,
      ...patch,
      text: {
        ...currentWatermark.text,
        ...patch.text,
      },
      image: {
        ...currentWatermark.image,
        ...patch.image,
      },
    });
  };

  const handleSelectWatermarkImage = async (): Promise<void> => {
    try {
      const imagePath = await selectLocalImageFile();
      setPdfWatermark({
        ...currentWatermark,
        enabled: true,
        kind: 'image',
        image: {
          ...currentWatermark.image,
          imageSrc: imagePath,
        },
      });
      setWatermarkFeedback('已选择水印图片');
    } catch (error) {
      if (error instanceof Error && error.message === '已取消选择图片') {
        setWatermarkFeedback('已取消选择图片');
        return;
      }

      const message = error instanceof Error ? error.message : '选择水印图片失败';
      setWatermarkFeedback(message);
    }
  };

  return (
    <section className="detail-panel">
      <div className="detail-panel-head">
        <h3>PDF 水印</h3>
        <span>预览可见，但只在导出 PDF 时生效</span>
      </div>

      <div className="segmented-group">
        <button
          type="button"
          className={currentWatermark.enabled ? 'segment-chip active' : 'segment-chip'}
          onClick={() => updateWatermark({ enabled: true })}
        >
          开启水印
        </button>
        <button
          type="button"
          className={currentWatermark.enabled ? 'segment-chip' : 'segment-chip active'}
          onClick={() => updateWatermark({ enabled: false })}
        >
          关闭水印
        </button>
      </div>

      <div className="template-list">
        {pdfWatermarkModeOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={currentWatermark.kind === option.id ? 'template-swatch active' : 'template-swatch'}
            onClick={() => updateWatermark({ kind: option.id })}
            disabled={!currentWatermark.enabled}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>

      {currentWatermark.kind === 'text' ? (
        <div className="property-stack">
          <label>
            水印文字
            <input
              className="style-text-input"
              type="text"
              value={currentWatermark.text.content}
              onChange={(event) => updateWatermark({ text: { content: event.target.value } })}
              placeholder="请输入水印文字"
              disabled={!currentWatermark.enabled}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="property-stack">
            <label>
              水印图片
              <input
                className="style-text-input"
                type="text"
                value={currentWatermark.image.imageSrc}
                onChange={(event) => updateWatermark({ image: { imageSrc: event.target.value } })}
                placeholder="请选择本地图片"
                disabled={!currentWatermark.enabled}
              />
            </label>
          </div>
          <div className="segmented-group">
            <button
              type="button"
              className="segment-chip table-structure-button"
              onClick={handleSelectWatermarkImage}
              disabled={!currentWatermark.enabled}
            >
              选择图片
            </button>
            <button
              type="button"
              className="segment-chip"
              onClick={() => updateWatermark({ image: { imageSrc: '' } })}
              disabled={!currentWatermark.enabled || !currentWatermark.image.imageSrc}
            >
              清除图片
            </button>
          </div>
        </>
      )}

      <div className="watermark-slider-group">
        <label className="watermark-slider-row">
          <span>角度</span>
          <input
            className="watermark-range"
            type="range"
            min={-180}
            max={180}
            step={1}
            value={currentWatermark.angleDeg}
            onChange={(event) => updateWatermark({ angleDeg: Number(event.target.value) })}
            disabled={!currentWatermark.enabled}
          />
          <strong>{currentWatermark.angleDeg}°</strong>
        </label>

        <label className="watermark-slider-row">
          <span>透明度</span>
          <input
            className="watermark-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={currentWatermark.opacityPercent}
            onChange={(event) => updateWatermark({ opacityPercent: Number(event.target.value) })}
            disabled={!currentWatermark.enabled}
          />
          <strong>{currentWatermark.opacityPercent}%</strong>
        </label>

        {currentWatermark.kind === 'text' ? (
          <label className="watermark-slider-row">
            <span>文字大小</span>
            <input
              className="watermark-range"
              type="range"
              min={16}
              max={160}
              step={1}
              value={currentWatermark.text.fontSizePx}
              onChange={(event) => updateWatermark({ text: { fontSizePx: Number(event.target.value) } })}
              disabled={!currentWatermark.enabled}
            />
            <strong>{currentWatermark.text.fontSizePx}px</strong>
          </label>
        ) : (
          <label className="watermark-slider-row">
            <span>图片宽度</span>
            <input
              className="watermark-range"
              type="range"
              min={10}
              max={70}
              step={1}
              value={currentWatermark.image.widthPercent}
              onChange={(event) => updateWatermark({ image: { widthPercent: Number(event.target.value) } })}
              disabled={!currentWatermark.enabled}
            />
            <strong>{currentWatermark.image.widthPercent}%</strong>
          </label>
        )}
      </div>

      <div className="panel-note-list">
        <p>当前预览会直接显示水印效果，但 DOCX 导出不会带出这层水印。</p>
        <p>本步默认按整页重复铺设水印，不支持自由拖拽定位。</p>
        {currentWatermark.kind === 'image' && currentWatermark.image.imageSrc ? <p>{currentWatermark.image.imageSrc}</p> : null}
      </div>

      {watermarkFeedback ? <p className="table-structure-feedback">{watermarkFeedback}</p> : null}
    </section>
  );
}

function renderTemplatePanel({
  styleSettings,
  setTemplateId,
  setThemeId,
}: {
  styleSettings: StyleSettings;
  setTemplateId: (templateId: TemplateId) => void;
  setThemeId: (themeId: ThemeId) => void;
}): JSX.Element {
  return (
    <section className="detail-panel">
      <div className="detail-panel-head">
        <h3>模板起点与风格主题</h3>
        <span>模板定结构，主题定视觉</span>
      </div>
      <div className="property-stack">
        <div className="section-subtitle">
          <strong>结构模板</strong>
          <span>控制标题层级、排版节奏和基础阅读密度</span>
        </div>
      </div>
      <div className="template-list template-list-single">
        {templateDefinitions.map((template) => (
          <button
            className={template.id === styleSettings.templateId ? 'template-swatch active' : 'template-swatch'}
            type="button"
            key={template.id}
            onClick={() => setTemplateId(template.id)}
          >
            <strong>{template.name}</strong>
            <span>{template.description}</span>
          </button>
        ))}
      </div>
      <div className="property-stack">
        <div className="section-subtitle">
          <strong>风格主题</strong>
          <span>在当前模板之上叠加统一视觉皮肤</span>
        </div>
      </div>
      <div className="template-list">
        {themeDefinitions.map((theme) => (
          <button
            className={theme.id === styleSettings.themeId ? 'template-swatch active theme-swatch' : 'template-swatch theme-swatch'}
            type="button"
            key={theme.id}
            onClick={() => setThemeId(theme.id)}
          >
            <div className="theme-swatch-head">
              <strong>{theme.name}</strong>
              <div className="theme-palette" aria-hidden="true">
                {theme.palette.map((color) => (
                  <span key={`${theme.id}-${color}`} className="theme-palette-swatch" style={{ backgroundColor: color }} />
                ))}
              </div>
            </div>
            <span>{theme.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function renderPaginationPanel({
  styleSettings,
  answerDisplayMode,
  answerBlockPlacementMode,
  setAnswerDisplayMode,
  setAnswerBlockPlacementMode,
  setPaginationAlgorithmId,
  setPaginationBehaviorOption,
}: {
  styleSettings: StyleSettings;
  answerDisplayMode: AnswerDisplayMode;
  answerBlockPlacementMode: AnswerBlockPlacementMode;
  setAnswerDisplayMode: (mode: AnswerDisplayMode) => void;
  setAnswerBlockPlacementMode: (mode: AnswerBlockPlacementMode) => void;
  setPaginationAlgorithmId: (algorithmId: PaginationAlgorithmId) => void;
  setPaginationBehaviorOption: (option: PaginationBehaviorOption, value: boolean) => void;
}): JSX.Element {
  const paginationAlgorithmOptions = listPaginationAlgorithms();

  return (
    <>
      <section className="detail-panel">
        <div className="detail-panel-head">
          <h3>答案显示</h3>
          <span>切换教师版、学生版和默写版</span>
        </div>
        <div className="option-card-grid option-card-grid-3">
          {answerDisplayOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={answerDisplayMode === option.id ? 'option-card active' : 'option-card'}
              onClick={() => setAnswerDisplayMode(option.id)}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
        <div className="detail-panel-head">
          <h3>答案解析位置</h3>
          <span>作用于内置答案/解析与名称含“答案/解析”的自定义语义</span>
        </div>
        <div className="option-card-grid">
          {answerBlockPlacementOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={answerBlockPlacementMode === option.id ? 'option-card active' : 'option-card'}
              onClick={() => setAnswerBlockPlacementMode(option.id)}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
        <div className="panel-note-list">
          <p>默写挖空当前只对真正的下划线内容生效，会跳过 `1.`、`（1）` 一类纯题号下划线。</p>
          <p>文末统一当前会并入名称含“答案/解析”的自定义语义，并递归处理 `blockquote / 引用容器` 内部子块。</p>
        </div>
      </section>

      <section className="detail-panel">
        <div className="detail-panel-head">
          <h3>分页策略</h3>
          <span>基础保护规则</span>
        </div>
        <div className="property-stack">
          <label>
            分页算法
            <select
              className="style-select"
              value={styleSettings.paginationAlgorithmId}
              onChange={(event) => setPaginationAlgorithmId(event.target.value)}
            >
              {paginationAlgorithmOptions.map((algorithm) => (
                <option key={algorithm.id} value={algorithm.id}>
                  {algorithm.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="panel-note-list">
          <p>
            当前算法：
            <strong>
              {paginationAlgorithmOptions.find((algorithm) => algorithm.id === styleSettings.paginationAlgorithmId)
                ?.label ?? '默认算法'}
            </strong>
          </p>
          <p>
            {
              paginationAlgorithmOptions.find((algorithm) => algorithm.id === styleSettings.paginationAlgorithmId)
                ?.description ?? '未找到算法说明，已自动回退到默认算法。'
            }
          </p>
        </div>
        <div className="toggle-list">
          {paginationBehaviorOptions.map((option) => (
            <label key={option.id} className="toggle-card">
              <input
                type="checkbox"
                checked={styleSettings.paginationBehavior[option.id]}
                onChange={(event) => setPaginationBehaviorOption(option.id, event.target.checked)}
              />
              <div>
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </div>
            </label>
          ))}
        </div>
      </section>
    </>
  );
}

export function RightPanel({
  currentPageCount,
  headingCount,
  characterCount,
  workspaceViewMode,
  layoutWarnings,
  canvasTextSelection,
  exportCheckResult,
}: RightPanelProps): JSX.Element {
  const resolvedStyleContract = useResolvedStyleContract();
  const styleSettings = useAppStore((state) => state.styleSettings);
  const layoutDocument = useAppStore((state) => state.layoutDocument);
  const tableSelection = useAppStore((state) => state.layoutDocument?.viewState.tableSelection ?? null);
  const activeRightPanelTab = useAppStore((state) => state.activeRightPanelTab);
  const activePageSettingsTab = useAppStore((state) => state.activePageSettingsTab);
  const setActiveRightPanelTab = useAppStore((state) => state.setActiveRightPanelTab);
  const setActivePageSettingsTab = useAppStore((state) => state.setActivePageSettingsTab);
  const setPageSize = useAppStore((state) => state.setPageSize);
  const setOrientation = useAppStore((state) => state.setOrientation);
  const setMarginMode = useAppStore((state) => state.setMarginMode);
  const setMarginPreset = useAppStore((state) => state.setMarginPreset);
  const setCustomMargin = useAppStore((state) => state.setCustomMargin);
  const setMarginLinked = useAppStore((state) => state.setMarginLinked);
  const setHeaderFooterMode = useAppStore((state) => state.setHeaderFooterMode);
  const setTemplateId = useAppStore((state) => state.setTemplateId);
  const setThemeId = useAppStore((state) => state.setThemeId);
  const setPageBackground = useAppStore((state) => state.setPageBackground);
  const setPdfWatermark = useAppStore((state) => state.setPdfWatermark);
  const setHeaderPreset = useAppStore((state) => state.setHeaderPreset);
  const setFooterPreset = useAppStore((state) => state.setFooterPreset);
  const setCustomHeaderReservedMm = useAppStore((state) => state.setCustomHeaderReservedMm);
  const setCustomFooterReservedMm = useAppStore((state) => state.setCustomFooterReservedMm);
  const setHeaderFooterContentSlot = useAppStore((state) => state.setHeaderFooterContentSlot);
  const setHeaderFooterLinked = useAppStore((state) => state.setHeaderFooterLinked);
  const setPageColumnCount = useAppStore((state) => state.setPageColumnCount);
  const setPageColumnGapMm = useAppStore((state) => state.setPageColumnGapMm);
  const setPageColumnDivider = useAppStore((state) => state.setPageColumnDivider);
  const setPageColumnHeadingsSpanAll = useAppStore((state) => state.setPageColumnHeadingsSpanAll);
  const setPaginationAlgorithmId = useAppStore((state) => state.setPaginationAlgorithmId);
  const setPaginationBehaviorOption = useAppStore((state) => state.setPaginationBehaviorOption);
  const setBlockSpacingParameter = useAppStore((state) => state.setBlockSpacingParameter);
  const applyBlockSpacingPreset = useAppStore((state) => state.applyBlockSpacingPreset);
  const addBlockSpacingPreset = useAppStore((state) => state.addBlockSpacingPreset);
  const updateBlockSpacingPreset = useAppStore((state) => state.updateBlockSpacingPreset);
  const updateSyntaxMappingConfig = useAppStore((state) => state.updateSyntaxMappingConfig);
  const updateSemanticRoleConfig = useAppStore((state) => state.updateSemanticRoleConfig);
  const setAnswerDisplayMode = useAppStore((state) => state.setAnswerDisplayMode);
  const setAnswerBlockPlacementMode = useAppStore((state) => state.setAnswerBlockPlacementMode);
  const scanSemanticKeywordRules = useAppStore((state) => state.scanSemanticKeywordRules);
  const applySemanticKeywordRules = useAppStore((state) => state.applySemanticKeywordRules);
  const replaceLayoutNodeRichText = useAppStore((state) => state.replaceLayoutNodeRichText);
  const updateLayoutNodeText = useAppStore((state) => state.updateLayoutNodeText);
  const toggleLayoutNodeTextMark = useAppStore((state) => state.toggleLayoutNodeTextMark);
  const applyLayoutNodeTextStyle = useAppStore((state) => state.applyLayoutNodeTextStyle);
  const clearLayoutNodeTextFormatting = useAppStore((state) => state.clearLayoutNodeTextFormatting);
  const updateLayoutImageAttributes = useAppStore((state) => state.updateLayoutImageAttributes);
  const updateLayoutTableStructure = useAppStore((state) => state.updateLayoutTableStructure);
  const updateLayoutTableHeaderRow = useAppStore((state) => state.updateLayoutTableHeaderRow);
  const updateLayoutTableColumnAlign = useAppStore((state) => state.updateLayoutTableColumnAlign);
  const autoFitLayoutTableSize = useAppStore((state) => state.autoFitLayoutTableSize);
  const mergeLayoutSelectedTableCells = useAppStore((state) => state.mergeLayoutSelectedTableCells);
  const updateLayoutListStructure = useAppStore((state) => state.updateLayoutListStructure);
  const updateLayoutListOrdered = useAppStore((state) => state.updateLayoutListOrdered);
  const updateLayoutListStart = useAppStore((state) => state.updateLayoutListStart);
  const updateLayoutListItemChecked = useAppStore((state) => state.updateLayoutListItemChecked);
  const updateLayoutListItemLevel = useAppStore((state) => state.updateLayoutListItemLevel);
  const reorderLayoutListItem = useAppStore((state) => state.reorderLayoutListItem);
  const updateLayoutListTaskMode = useAppStore((state) => state.updateLayoutListTaskMode);
  const convertLayoutListItemTaskState = useAppStore((state) => state.convertLayoutListItemTaskState);
  const updateLayoutListBatchChecked = useAppStore((state) => state.updateLayoutListBatchChecked);
  const updateLayoutBlockquoteStructure = useAppStore((state) => state.updateLayoutBlockquoteStructure);
  const updateLayoutColumnSectionAttributes = useAppStore((state) => state.updateLayoutColumnSectionAttributes);
  const unwrapLayoutColumnSection = useAppStore((state) => state.unwrapLayoutColumnSection);
  const applyLayoutNodeBlockStyle = useAppStore((state) => state.applyLayoutNodeBlockStyle);
  const applyLayoutQuickBlockStyle = useAppStore((state) => state.applyLayoutQuickBlockStyle);
  const updateLayoutBlockSemantic = useAppStore((state) => state.updateLayoutBlockSemantic);
  const updateLayoutBlockSemanticPreset = useAppStore((state) => state.updateLayoutBlockSemanticPreset);
  const updateLayoutTocMaxDepth = useAppStore((state) => state.updateLayoutTocMaxDepth);
  const refreshLayoutTocBlock = useAppStore((state) => state.refreshLayoutTocBlock);
  const deleteLayoutTopLevelBlock = useAppStore((state) => state.deleteLayoutTopLevelBlock);
  const [tableStructureFeedback, setTableStructureFeedback] = useState<string | null>(null);
  const [listStructureFeedback, setListStructureFeedback] = useState<string | null>(null);
  const [tocRefreshFeedback, setTocRefreshFeedback] = useState<string | null>(null);
  const [blockquoteStructureFeedback, setBlockquoteStructureFeedback] = useState<string | null>(null);
  const [columnSectionFeedback, setColumnSectionFeedback] = useState<string | null>(null);
  const [topLevelBlockFeedback, setTopLevelBlockFeedback] = useState<string | null>(null);
  const [blockStyleApplyMode, setBlockStyleApplyMode] = useState<BlockStyleApplyMode>('current');
  const [backgroundFeedback, setBackgroundFeedback] = useState<string | null>(null);
  const [watermarkFeedback, setWatermarkFeedback] = useState<string | null>(null);
  const [marginDrafts, setMarginDrafts] = useState<Record<MarginSide, string>>({
    top: String(styleSettings.customMarginsMm.top),
    right: String(styleSettings.customMarginsMm.right),
    bottom: String(styleSettings.customMarginsMm.bottom),
    left: String(styleSettings.customMarginsMm.left),
  });
  const [headerFooterDrafts, setHeaderFooterDrafts] = useState<{ header: string; footer: string }>({
    header: String(styleSettings.customHeaderReservedMm),
    footer: String(styleSettings.customFooterReservedMm),
  });
  const [columnGapDraft, setColumnGapDraft] = useState(String(styleSettings.columns.gapMm));
  const [backgroundColorDraft, setBackgroundColorDraft] = useState(styleSettings.pageBackground.color);
  const [newBlockSpacingPresetName, setNewBlockSpacingPresetName] = useState('');
  const [newBlockSpacingPresetDescription, setNewBlockSpacingPresetDescription] = useState('');
  const [newSemanticRoleName, setNewSemanticRoleName] = useState('');
  const [newSemanticRoleDescription, setNewSemanticRoleDescription] = useState('');
  const [newSemanticRoleColor, setNewSemanticRoleColor] = useState('#3b82f6');
  const [newSemanticRoleDefaultPresetId, setNewSemanticRoleDefaultPresetId] = useState<string>('defaultSemanticFrame');
  const [newSemanticKeyword, setNewSemanticKeyword] = useState('');
  const [newSemanticKeywordRoleId, setNewSemanticKeywordRoleId] = useState('');
  const [semanticOverwriteExisting, setSemanticOverwriteExisting] = useState(false);
  const [semanticScanResult, setSemanticScanResult] = useState<SemanticKeywordScanResult | null>(null);
  const selectedNodeId = layoutDocument?.viewState.selectedNodeId ?? null;
  const answerDisplayMode = layoutDocument?.viewState.answerDisplayMode ?? 'show';
  const answerBlockPlacementMode = layoutDocument?.viewState.answerBlockPlacementMode ?? 'inline';
  const semanticRoleConfig = normalizeSemanticRoleConfig(layoutDocument?.meta.semanticRoleConfig);
  const semanticRoleConfigKey = JSON.stringify(semanticRoleConfig);
  const selectedNodeInfo = getSelectedLayoutNodeInfo(layoutDocument);
  const selectedBlockquoteContext = getSelectedBlockquoteContext(layoutDocument);
  const selectedTopLevelBlock =
    layoutDocument && selectedNodeId
      ? findTopLevelBlockForSelectedNode(layoutDocument.blocks, selectedNodeId)
      : null;

  useEffect(() => {
    setTableStructureFeedback(null);
    setListStructureFeedback(null);
    setTocRefreshFeedback(null);
    setBlockquoteStructureFeedback(null);
    setColumnSectionFeedback(null);
    setTopLevelBlockFeedback(null);
    setBlockStyleApplyMode('current');
  }, [selectedNodeId]);

  useEffect(() => {
    setMarginDrafts({
      top: String(styleSettings.customMarginsMm.top),
      right: String(styleSettings.customMarginsMm.right),
      bottom: String(styleSettings.customMarginsMm.bottom),
      left: String(styleSettings.customMarginsMm.left),
    });
  }, [styleSettings.customMarginsMm]);

  useEffect(() => {
    setHeaderFooterDrafts({
      header: String(styleSettings.customHeaderReservedMm),
      footer: String(styleSettings.customFooterReservedMm),
    });
  }, [styleSettings.customFooterReservedMm, styleSettings.customHeaderReservedMm]);

  useEffect(() => {
    setColumnGapDraft(String(styleSettings.columns.gapMm));
  }, [styleSettings.columns.gapMm]);

  useEffect(() => {
    setBackgroundColorDraft(styleSettings.pageBackground.color);
  }, [styleSettings.pageBackground.color]);

  useEffect(() => {
    const roles = getEnabledSemanticRoles(semanticRoleConfig);
    if (!newSemanticKeywordRoleId || !roles.some((role) => role.id === newSemanticKeywordRoleId)) {
      setNewSemanticKeywordRoleId(roles[0]?.id ?? '');
    }
  }, [newSemanticKeywordRoleId, semanticRoleConfigKey]);

  useEffect(() => {
    setSemanticScanResult(null);
  }, [layoutDocument?.id, semanticRoleConfigKey, semanticOverwriteExisting]);

  const handleMarginDraftChange = (side: MarginSide, value: string) => {
    setMarginDrafts((current) => ({
      ...current,
      [side]: value,
    }));
  };

  const commitMarginDraft = (side: MarginSide) => {
    const nextValue = Number(marginDrafts[side]);
    if (Number.isNaN(nextValue)) {
      setMarginDrafts((current) => ({
        ...current,
        [side]: String(styleSettings.customMarginsMm[side]),
      }));
      return;
    }

    setCustomMargin(side, nextValue);
  };

  const handleHeaderFooterDraftChange = (side: 'header' | 'footer', value: string) => {
    setHeaderFooterDrafts((current) => ({
      ...current,
      [side]: value,
    }));
  };

  const commitHeaderFooterDraft = (side: 'header' | 'footer') => {
    const nextValue = Number(headerFooterDrafts[side]);
    if (Number.isNaN(nextValue)) {
      setHeaderFooterDrafts((current) => ({
        ...current,
        [side]: String(side === 'header' ? styleSettings.customHeaderReservedMm : styleSettings.customFooterReservedMm),
      }));
      return;
    }

    if (side === 'header') {
      setCustomHeaderReservedMm(nextValue);
      return;
    }

    setCustomFooterReservedMm(nextValue);
  };

  const syncEditingTextBeforeStyleAction = (nodeId: string) => {
    if (!canvasTextSelection.isEditing || canvasTextSelection.nodeId !== nodeId) {
      return;
    }

    if (canvasTextSelection.draftTextRuns) {
      replaceLayoutNodeRichText({
        nodeId,
        textRuns: canvasTextSelection.draftTextRuns,
      });
      return;
    }

    updateLayoutNodeText({
      nodeId,
      text: canvasTextSelection.text,
    });
  };

  const handleAddSemanticRole = () => {
    const name = newSemanticRoleName.trim();
    if (!name) {
      return;
    }

    const id = createCustomSemanticRoleId(name, [
      ...semanticRoleConfig.customRoles.map((role) => role.id),
      ...semanticRoleConfig.keywordRules.map((rule) => rule.roleId),
    ]);

    updateSemanticRoleConfig({
      ...semanticRoleConfig,
      customRoles: [
        ...semanticRoleConfig.customRoles,
        {
          id,
          name,
          description: newSemanticRoleDescription.trim() || undefined,
          color: newSemanticRoleColor,
          enabled: true,
          defaultBlockPresetId: newSemanticRoleDefaultPresetId
            ? (newSemanticRoleDefaultPresetId as SemanticBlockPresetId)
            : undefined,
        },
      ],
    });
    setNewSemanticRoleName('');
    setNewSemanticRoleDescription('');
    setNewSemanticRoleDefaultPresetId('defaultSemanticFrame');
    setNewSemanticKeywordRoleId(id);
  };

  const handleToggleSemanticRole = (roleId: string) => {
    updateSemanticRoleConfig({
      ...semanticRoleConfig,
      customRoles: semanticRoleConfig.customRoles.map((role) =>
        role.id === roleId ? { ...role, enabled: !role.enabled } : role,
      ),
    });
  };

  const handleDeleteSemanticRole = (roleId: string) => {
    updateSemanticRoleConfig({
      ...semanticRoleConfig,
      customRoles: semanticRoleConfig.customRoles.filter((role) => role.id !== roleId),
      keywordRules: semanticRoleConfig.keywordRules.filter((rule) => rule.roleId !== roleId),
    });
  };

  const handleUpdateSemanticRoleDefaultPreset = (roleId: string, presetId: string) => {
    updateSemanticRoleConfig({
      ...semanticRoleConfig,
      customRoles: semanticRoleConfig.customRoles.map((role) =>
        role.id === roleId
          ? {
              ...role,
              defaultBlockPresetId: presetId ? (presetId as SemanticBlockPresetId) : undefined,
            }
          : role,
      ),
    });
  };

  const handleAddSemanticKeywordRule = () => {
    const keyword = newSemanticKeyword.trim();
    const roleId = newSemanticKeywordRoleId || getEnabledSemanticRoles(semanticRoleConfig)[0]?.id;
    if (!keyword || !roleId) {
      return;
    }

    updateSemanticRoleConfig({
      ...semanticRoleConfig,
      keywordRules: [
        ...semanticRoleConfig.keywordRules,
        {
          id: `semantic-rule-${Date.now().toString(36)}`,
          roleId,
          keyword,
          matchMode: 'prefix',
          stripKeyword: true,
          enabled: true,
        },
      ],
    });
    setNewSemanticKeyword('');
  };

  const handleToggleSemanticKeywordRule = (ruleId: string) => {
    updateSemanticRoleConfig({
      ...semanticRoleConfig,
      keywordRules: semanticRoleConfig.keywordRules.map((rule) =>
        rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule,
      ),
    });
  };

  const handleDeleteSemanticKeywordRule = (ruleId: string) => {
    updateSemanticRoleConfig({
      ...semanticRoleConfig,
      keywordRules: semanticRoleConfig.keywordRules.filter((rule) => rule.id !== ruleId),
    });
  };

  const handleScanSemanticKeywords = () => {
    setSemanticScanResult(scanSemanticKeywordRules({ overwriteExisting: semanticOverwriteExisting }));
  };

  const handleApplySemanticKeywords = () => {
    const result = applySemanticKeywordRules({ overwriteExisting: semanticOverwriteExisting });
    setSemanticScanResult(result);
  };

  const renderActiveSettingsPanel = (): JSX.Element => {
    switch (activePageSettingsTab) {
      case '页面规格':
        return renderPageSpecPanel({
          resolvedStyleContract,
          styleSettings,
          setPageSize,
          setOrientation,
        });
      case '页边距':
        return renderMarginPanel({
          styleSettings,
          marginDrafts,
          setMarginMode,
          setMarginPreset,
          setMarginLinked,
          handleMarginDraftChange,
          commitMarginDraft,
        });
      case '页眉页脚预留':
        return renderHeaderFooterPanel({
          styleSettings,
          headerFooterDrafts,
          setHeaderFooterMode,
          setHeaderPreset,
          setFooterPreset,
          setHeaderFooterContentSlot,
          setHeaderFooterLinked,
          handleHeaderFooterDraftChange,
          commitHeaderFooterDraft,
        });
      case '分栏':
        return renderColumnsPanel({
          styleSettings,
          resolvedStyleContract,
          columnGapDraft,
          setPageColumnCount,
          setPageColumnGapMm,
          setPageColumnDivider,
          setPageColumnHeadingsSpanAll,
          setColumnGapDraft,
        });
      case '块排版':
        return renderBlockSpacingPanel({
          styleSettings,
          setBlockSpacingParameter,
          applyBlockSpacingPreset,
          addBlockSpacingPreset,
          updateBlockSpacingPreset,
          newPresetName: newBlockSpacingPresetName,
          setNewPresetName: setNewBlockSpacingPresetName,
          newPresetDescription: newBlockSpacingPresetDescription,
          setNewPresetDescription: setNewBlockSpacingPresetDescription,
        });
      case '页面背景':
        return renderPageBackgroundPanel({
          styleSettings,
          setPageBackground,
          backgroundFeedback,
          setBackgroundFeedback,
          backgroundColorDraft,
          setBackgroundColorDraft,
        });
      case 'PDF 水印':
        return renderPdfWatermarkPanel({
          styleSettings,
          setPdfWatermark,
          watermarkFeedback,
          setWatermarkFeedback,
        });
      case '模板起点':
        return renderTemplatePanel({
          styleSettings,
          setTemplateId,
          setThemeId,
        });
      case '分页策略':
        return renderPaginationPanel({
          styleSettings,
          answerDisplayMode,
          answerBlockPlacementMode,
          setAnswerDisplayMode,
          setAnswerBlockPlacementMode,
          setPaginationAlgorithmId,
          setPaginationBehaviorOption,
        });
      default:
        return renderPageSpecPanel({
          resolvedStyleContract,
          styleSettings,
          setPageSize,
          setOrientation,
        });
    }
  };

  const renderActiveMainPanel = (): JSX.Element => {
    if (activeRightPanelTab === '对象属性') {
      return (
        <div className="right-panel-detail">
          {renderObjectPropertiesPanel(
            selectedNodeInfo,
            selectedBlockquoteContext,
            selectedTopLevelBlock,
            selectedNodeId,
            canvasTextSelection,
            layoutDocument?.styles,
            layoutDocument?.resources ?? [],
            semanticRoleConfig,
            resolvedStyleContract,
            toggleLayoutNodeTextMark,
            applyLayoutNodeTextStyle,
            updateLayoutNodeText,
            clearLayoutNodeTextFormatting,
            updateLayoutImageAttributes,
            updateLayoutTocMaxDepth,
            refreshLayoutTocBlock,
            updateLayoutTableStructure,
            updateLayoutTableHeaderRow,
            updateLayoutTableColumnAlign,
            autoFitLayoutTableSize,
            mergeLayoutSelectedTableCells,
            updateLayoutListStructure,
            updateLayoutListOrdered,
            updateLayoutListStart,
            updateLayoutListItemChecked,
            updateLayoutListItemLevel,
            reorderLayoutListItem,
            updateLayoutListTaskMode,
            convertLayoutListItemTaskState,
            updateLayoutListBatchChecked,
            updateLayoutBlockquoteStructure,
            updateLayoutColumnSectionAttributes,
            unwrapLayoutColumnSection,
            deleteLayoutTopLevelBlock,
            applyLayoutNodeBlockStyle,
            applyLayoutQuickBlockStyle,
            updateLayoutBlockSemantic,
            updateLayoutBlockSemanticPreset,
            tableSelection,
            tableStructureFeedback,
            setTableStructureFeedback,
            listStructureFeedback,
            setListStructureFeedback,
            tocRefreshFeedback,
            setTocRefreshFeedback,
            blockquoteStructureFeedback,
            setBlockquoteStructureFeedback,
            columnSectionFeedback,
            setColumnSectionFeedback,
            topLevelBlockFeedback,
            setTopLevelBlockFeedback,
            blockStyleApplyMode,
            setBlockStyleApplyMode,
            syncEditingTextBeforeStyleAction,
          )}
        </div>
      );
    }

    if (activeRightPanelTab === '语法映射') {
      return (
        <div className="right-panel-detail">
          <SyntaxMappingPanel
            config={layoutDocument?.meta.syntaxMappingConfig}
            onChange={updateSyntaxMappingConfig}
          />
        </div>
      );
    }

    if (activeRightPanelTab === '语义规则') {
      return (
        <div className="right-panel-detail">
          {renderSemanticRulesPanel({
            semanticRoleConfig,
            newRoleName: newSemanticRoleName,
            newRoleDescription: newSemanticRoleDescription,
            newRoleColor: newSemanticRoleColor,
            newRoleDefaultPresetId: newSemanticRoleDefaultPresetId,
            newKeyword: newSemanticKeyword,
            newKeywordRoleId: newSemanticKeywordRoleId,
            overwriteExisting: semanticOverwriteExisting,
            scanResult: semanticScanResult,
            onNewRoleNameChange: setNewSemanticRoleName,
            onNewRoleDescriptionChange: setNewSemanticRoleDescription,
            onNewRoleColorChange: setNewSemanticRoleColor,
            onNewRoleDefaultPresetIdChange: setNewSemanticRoleDefaultPresetId,
            onNewKeywordChange: setNewSemanticKeyword,
            onNewKeywordRoleIdChange: setNewSemanticKeywordRoleId,
            onOverwriteExistingChange: setSemanticOverwriteExisting,
            onAddRole: handleAddSemanticRole,
            onToggleRole: handleToggleSemanticRole,
            onUpdateRoleDefaultPreset: handleUpdateSemanticRoleDefaultPreset,
            onDeleteRole: handleDeleteSemanticRole,
            onAddKeywordRule: handleAddSemanticKeywordRule,
            onToggleKeywordRule: handleToggleSemanticKeywordRule,
            onDeleteKeywordRule: handleDeleteSemanticKeywordRule,
            onScan: handleScanSemanticKeywords,
            onApply: handleApplySemanticKeywords,
          })}
        </div>
      );
    }

    if (activeRightPanelTab === 'AI助手') {
      return (
        <div className="right-panel-detail">
          <AiPanel />
        </div>
      );
    }

    if (activeRightPanelTab === '导出检查') {
      return <div className="right-panel-detail">{renderExportCheckPanel(exportCheckResult)}</div>;
    }

    return (
      <>
        {renderLayoutWarningsPanel(layoutWarnings)}

        <div className="page-settings-toolbar" aria-label="页面设置二级菜单">
          {pageSettingsTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activePageSettingsTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                className={isActive ? 'page-settings-icon-button active' : 'page-settings-icon-button'}
                onClick={() => setActivePageSettingsTab(tab.id)}
                title={tab.description}
                aria-label={tab.label}
              >
                <Icon size={17} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="right-panel-detail">{renderActiveSettingsPanel()}</div>
      </>
    );
  };

  return (
    <aside className="right-panel" aria-label="属性设置">
      <section className="property-group property-summary right-panel-summary">
        <h2>工作区摘要</h2>
        <div className="summary-grid">
          {renderSummaryCard('视图', getViewModeLabel(workspaceViewMode))}
          {renderSummaryCard('页数', `${currentPageCount} 页`)}
          {renderSummaryCard('标题数', `${headingCount} 个`)}
          {renderSummaryCard('字符数', `${characterCount} 字符`)}
          {renderSummaryCard('纸张', resolvedStyleContract.pageLabel)}
          {renderSummaryCard('模板', resolvedStyleContract.templateLabel)}
          {renderSummaryCard('主题', resolvedStyleContract.themeLabel)}
        </div>
      </section>

      <div className="right-panel-workbench">
        <nav className="right-panel-rail" aria-label="右侧一级菜单">
          {rightMainTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeRightPanelTab === tab.id ? 'right-rail-button active' : 'right-rail-button'}
              onClick={() => setActiveRightPanelTab(tab.id)}
              title={tab.description}
              aria-label={tab.label}
            >
              <span className="right-rail-button-label">{tab.label}</span>
            </button>
          ))}
        </nav>

        <section className="right-panel-content">{renderActiveMainPanel()}</section>
      </div>
    </aside>
  );
}
