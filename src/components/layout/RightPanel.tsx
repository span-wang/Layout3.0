import { useEffect, useState } from 'react';
import { FileText, Layers3, PanelBottom, PanelTop, SlidersHorizontal } from 'lucide-react';
import { fontFamilyPlaceholderValue, textFontFamilyGroups } from '@/constants/fontFamilies';
import { highlightColorOptions, standardColorOptions } from '@/constants/styleColors';
import {
  getSelectedLayoutNodeInfo,
  getLayoutBlockPlainText,
  type LayoutBlock,
  type SourceRange,
  type SelectedLayoutNodeInfo,
  type TableColumnAlign,
  type TableStructureAction,
  type TextMarkType,
  type TextRangeSelection,
  type TextRun,
} from '@/engine/document-model';
import {
  headerFooterPresetDefinitions,
  marginPresetDefinitions,
  pageSizeDefinitions,
  templateDefinitions,
} from '@/engine/style/presets';
import { listPaginationAlgorithms } from '@/engine/typesetting';
import type { LayoutWarning } from '@/engine/typesetting/types';
import type {
  HeaderFooterPresetId,
  MarginPresetId,
  MarginSide,
  PageOrientation,
  PageSizeId,
  PaginationAlgorithmId,
  PaginationBehaviorOption,
  StyleSettings,
  TemplateId,
} from '@/engine/style/types';
import { useResolvedStyleContract } from '@/hooks/useResolvedStyleContract';
import { useAppStore } from '@/store';
import type { CanvasTextSelectionState, PageSettingsTab, WorkspaceViewMode } from '@/types/workspace';

interface RightPanelProps {
  currentPageCount: number;
  headingCount: number;
  characterCount: number;
  workspaceViewMode: WorkspaceViewMode;
  layoutWarnings: LayoutWarning[];
  canvasTextSelection: CanvasTextSelectionState;
}

type RightMainTab = '对象属性' | '页面设置';

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
  { id: '模板起点', label: '模板起点', description: '默认或模板套用', icon: Layers3 },
  { id: '分页策略', label: '分页策略', description: '标题、代码块与图片保护', icon: SlidersHorizontal },
];

const blockTypeLabels: Record<LayoutBlock['type'], string> = {
  paragraph: '段落',
  heading: '标题',
  list: '列表',
  table: '表格',
  image: '图片',
  equation: '公式',
  blockquote: '引用',
  code: '代码块',
  horizontalRule: '分隔线',
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

const textMarkOptions: Array<{ id: TextMarkType; label: string }> = [
  { id: 'bold', label: '加粗' },
  { id: 'italic', label: '斜体' },
  { id: 'underline', label: '下划线' },
  { id: 'strike', label: '删除线' },
];

const textEditableBlockTypes: LayoutBlock['type'][] = ['heading', 'paragraph', 'code'];
const blockStyleEditableBlockTypes: LayoutBlock['type'][] = ['heading', 'paragraph', 'code', 'list', 'table'];
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

function getViewModeLabel(workspaceViewMode: WorkspaceViewMode): string {
  switch (workspaceViewMode) {
    case 'source':
      return '源码视图';
    case 'preview':
      return '预览视图';
    default:
      return '分屏视图';
  }
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

function renderObjectPropertyRow(label: string, value: string): JSX.Element {
  return (
    <div className="object-property-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
  if (nodeInfo.ownerBlock.type === 'heading' && nodeInfo.ownerBlock.metadata.kind === 'heading') {
    const blockStyle =
      nodeInfo.ownerBlock.metadata.depth === 1
        ? resolvedStyleContract.blockStyles.heading1
        : nodeInfo.ownerBlock.metadata.depth === 2
          ? resolvedStyleContract.blockStyles.heading2
          : resolvedStyleContract.blockStyles.heading3;
    return {
      fontSize: blockStyle.fontSize,
      lineHeight: blockStyle.lineHeight,
      spaceBefore: blockStyle.marginTop,
      spaceAfter: blockStyle.marginBottom,
    };
  }

  if (nodeInfo.ownerBlock.type === 'code') {
    return {
      fontSize: resolvedStyleContract.blockStyles.code.fontSize,
      lineHeight: resolvedStyleContract.blockStyles.code.lineHeight,
      spaceBefore: resolvedStyleContract.blockStyles.code.marginTop,
      spaceAfter: resolvedStyleContract.blockStyles.code.marginBottom,
    };
  }

  if (nodeInfo.ownerBlock.type === 'list') {
    return {
      fontSize: resolvedStyleContract.blockStyles.list.fontSize,
      lineHeight: resolvedStyleContract.blockStyles.list.lineHeight,
      spaceBefore: resolvedStyleContract.blockStyles.list.marginTop,
      spaceAfter: resolvedStyleContract.blockStyles.list.marginBottom,
    };
  }

  return {
    fontSize: resolvedStyleContract.blockStyles.paragraph.fontSize,
    lineHeight: resolvedStyleContract.blockStyles.paragraph.lineHeight,
    spaceBefore: resolvedStyleContract.blockStyles.paragraph.marginTop,
    spaceAfter: resolvedStyleContract.blockStyles.paragraph.marginBottom,
  };
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
  return !!nodeInfo && blockStyleEditableBlockTypes.includes(nodeInfo.ownerBlock.type);
}

function isHangingIndentEditable(nodeInfo: SelectedLayoutNodeInfo | null): boolean {
  return !!nodeInfo && nodeInfo.kind === 'block' && (nodeInfo.ownerBlock.type === 'heading' || nodeInfo.ownerBlock.type === 'paragraph');
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

function renderObjectPropertiesPanel(
  selectedNodeInfo: SelectedLayoutNodeInfo | null,
  selectedNodeId: string | null,
  canvasTextSelection: CanvasTextSelectionState,
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
  clearLayoutNodeTextFormatting: (payload: {
    nodeId: string;
    selection: TextRangeSelection | null;
  }) => void,
  updateLayoutImageAttributes: (payload: {
    nodeId: string;
    src: string;
    alt: string;
    title: string | null;
  }) => void,
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
  applyLayoutNodeBlockStyle: (payload: {
    nodeId: string;
    blockStyleOverrides: {
      textAlign?: 'left' | 'center' | 'right' | 'justify';
      lineHeight?: number;
      indentLeft?: number;
      indentRight?: number;
      firstLineIndent?: number;
      hangingIndent?: number;
      spaceBefore?: number;
      spaceAfter?: number;
    };
  }) => void,
  tableStructureFeedback: string | null,
  onTableStructureFeedback: (message: string) => void,
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
  const currentFontSize =
    getSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'fontSize') ?? defaultMetrics.fontSize;
  const currentFontFamily =
    (getSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'fontFamily') as string | undefined) ??
    fontFamilyPlaceholderValue;
  const currentColor =
    (getSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'color') as string | undefined) ??
    defaultTextColor;
  const currentHighlightColor =
    (getSharedTextStyleValue(selectedNodeInfo.textRuns, activeSelection, 'highlightColor') as string | undefined) ??
    defaultHighlightColor;
  const currentTextAlign = selectedNodeInfo.ownerBlock.blockStyleOverrides.textAlign ?? 'left';
  const currentLineHeight = selectedNodeInfo.ownerBlock.blockStyleOverrides.lineHeight ?? defaultMetrics.lineHeight;
  const currentIndentLeft = selectedNodeInfo.ownerBlock.blockStyleOverrides.indentLeft ?? 0;
  const currentIndentRight = selectedNodeInfo.ownerBlock.blockStyleOverrides.indentRight ?? 0;
  const currentFirstLineIndent = selectedNodeInfo.ownerBlock.blockStyleOverrides.firstLineIndent ?? 0;
  const currentHangingIndent = selectedNodeInfo.ownerBlock.blockStyleOverrides.hangingIndent ?? 0;
  const currentSpaceBefore = selectedNodeInfo.ownerBlock.blockStyleOverrides.spaceBefore ?? defaultMetrics.spaceBefore;
  const currentSpaceAfter = selectedNodeInfo.ownerBlock.blockStyleOverrides.spaceAfter ?? defaultMetrics.spaceAfter;
  const selectedImageMetadata =
    selectedNodeInfo.kind === 'block' &&
    selectedNodeInfo.ownerBlock.type === 'image' &&
    selectedNodeInfo.ownerBlock.metadata.kind === 'image'
      ? selectedNodeInfo.ownerBlock.metadata
      : null;
  const selectedTableCellPosition = getSelectedTableCellPosition(selectedNodeInfo);
  const selectedTableBlockWithoutCell =
    selectedNodeInfo.kind === 'block' && selectedNodeInfo.ownerBlock.type === 'table';
  const selectedTableMetadata =
    selectedNodeInfo.ownerBlock.type === 'table' && selectedNodeInfo.ownerBlock.metadata.kind === 'table'
      ? selectedNodeInfo.ownerBlock.metadata
      : null;
  const isHeaderRowEnabled = selectedTableMetadata?.rows[0]?.cells.every((cell) => cell.isHeader) ?? false;
  const currentTableColumnAlign =
    selectedTableCellPosition && selectedTableMetadata
      ? selectedTableMetadata.align[selectedTableCellPosition.columnIndex] ?? null
      : null;

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
          {renderObjectPropertyRow('样式覆盖', getBlockStyleSummary(selectedNodeInfo.ownerBlock))}
        </div>
      </section>

      {selectedImageMetadata ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>图片属性</h3>
            <span>只保存路径和说明，不处理上传或资源复制</span>
          </div>
          <div className="property-stack">
            <label>
              图片路径
              <input
                className="style-text-input"
                type="text"
                value={selectedImageMetadata.src}
                onChange={(event) =>
                  updateLayoutImageAttributes({
                    nodeId: selectedNodeInfo.nodeId,
                    src: event.target.value,
                    alt: selectedImageMetadata.alt,
                    title: selectedImageMetadata.title,
                  })
                }
              />
            </label>
            <label>
              替代文本
              <input
                className="style-text-input"
                type="text"
                value={selectedImageMetadata.alt}
                onChange={(event) =>
                  updateLayoutImageAttributes({
                    nodeId: selectedNodeInfo.nodeId,
                    src: selectedImageMetadata.src,
                    alt: event.target.value,
                    title: selectedImageMetadata.title,
                  })
                }
              />
            </label>
            <label>
              标题
              <input
                className="style-text-input"
                type="text"
                value={selectedImageMetadata.title ?? ''}
                onChange={(event) =>
                  updateLayoutImageAttributes({
                    nodeId: selectedNodeInfo.nodeId,
                    src: selectedImageMetadata.src,
                    alt: selectedImageMetadata.alt,
                    title: event.target.value === '' ? null : event.target.value,
                  })
                }
              />
            </label>
          </div>
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

      {isBlockStyleEditable(selectedNodeInfo) ? (
        <section className="detail-panel object-detail-panel">
          <div className="detail-panel-head">
            <h3>段落样式</h3>
            <span>始终作用到所属块，不跟文字选区绑定</span>
          </div>
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
                onClick={() =>
                  applyLayoutNodeBlockStyle({
                    nodeId: selectedNodeInfo.nodeId,
                    blockStyleOverrides: { textAlign: option.id },
                  })
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="margin-grid">
            <label>
              行高
              <div className="number-input-shell">
                <input
                  key={`line-height-${selectedNodeInfo.nodeId}-${currentLineHeight}`}
                  type="number"
                  min={16}
                  max={72}
                  step={1}
                  defaultValue={currentLineHeight}
                  onMouseDown={() => syncEditingTextBeforeStyleAction(selectedNodeInfo.nodeId)}
                  onBlur={(event) => {
                    const nextValue = Number(event.currentTarget.value);
                    if (!Number.isFinite(nextValue)) {
                      event.currentTarget.value = String(currentLineHeight);
                      return;
                    }

                    applyLayoutNodeBlockStyle({
                      nodeId: selectedNodeInfo.nodeId,
                      blockStyleOverrides: { lineHeight: Math.max(16, Math.min(72, Math.round(nextValue))) },
                    });
                  }}
                />
                <span>px</span>
              </div>
            </label>
            <label>
              左缩进
              <div className="number-input-shell">
                <input
                  key={`indent-left-${selectedNodeInfo.nodeId}-${currentIndentLeft}`}
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

                    applyLayoutNodeBlockStyle({
                      nodeId: selectedNodeInfo.nodeId,
                      blockStyleOverrides: { indentLeft: Math.max(0, Math.min(200, Math.round(nextValue))) },
                    });
                  }}
                />
                <span>px</span>
              </div>
            </label>
            <label>
              右缩进
              <div className="number-input-shell">
                <input
                  key={`indent-right-${selectedNodeInfo.nodeId}-${currentIndentRight}`}
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

                    applyLayoutNodeBlockStyle({
                      nodeId: selectedNodeInfo.nodeId,
                      blockStyleOverrides: { indentRight: Math.max(0, Math.min(200, Math.round(nextValue))) },
                    });
                  }}
                />
                <span>px</span>
              </div>
            </label>
            <label>
              首行缩进
              <div className="number-input-shell">
                <input
                  key={`first-line-indent-${selectedNodeInfo.nodeId}-${currentFirstLineIndent}`}
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

                    applyLayoutNodeBlockStyle({
                      nodeId: selectedNodeInfo.nodeId,
                      blockStyleOverrides: { firstLineIndent: Math.max(0, Math.min(120, Math.round(nextValue))) },
                    });
                  }}
                />
                <span>px</span>
              </div>
            </label>
            {isHangingIndentEditable(selectedNodeInfo) ? (
              <label>
                悬挂缩进
                <div className="number-input-shell">
                  <input
                    key={`hanging-indent-${selectedNodeInfo.nodeId}-${currentHangingIndent}`}
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

                      applyLayoutNodeBlockStyle({
                        nodeId: selectedNodeInfo.nodeId,
                        blockStyleOverrides: { hangingIndent: Math.max(0, Math.min(120, Math.round(nextValue))) },
                      });
                    }}
                  />
                  <span>px</span>
                </div>
              </label>
            ) : null}
            <label>
              段前距
              <div className="number-input-shell">
                <input
                  key={`space-before-${selectedNodeInfo.nodeId}-${currentSpaceBefore}`}
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

                    applyLayoutNodeBlockStyle({
                      nodeId: selectedNodeInfo.nodeId,
                      blockStyleOverrides: { spaceBefore: Math.max(0, Math.min(120, Math.round(nextValue))) },
                    });
                  }}
                />
                <span>px</span>
              </div>
            </label>
            <label>
              段后距
              <div className="number-input-shell">
                <input
                  key={`space-after-${selectedNodeInfo.nodeId}-${currentSpaceAfter}`}
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

                    applyLayoutNodeBlockStyle({
                      nodeId: selectedNodeInfo.nodeId,
                      blockStyleOverrides: { spaceAfter: Math.max(0, Math.min(120, Math.round(nextValue))) },
                    });
                  }}
                />
                <span>px</span>
              </div>
            </label>
          </div>
        </section>
      ) : null}

      {!selectedImageMetadata && !isTextStyleEditable(selectedNodeInfo) && !isBlockStyleEditable(selectedNodeInfo) ? (
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
  setHeaderFooterLinked,
  handleHeaderFooterDraftChange,
  commitHeaderFooterDraft,
}: {
  styleSettings: StyleSettings;
  headerFooterDrafts: { header: string; footer: string };
  setHeaderFooterMode: (mode: 'preset' | 'custom') => void;
  setHeaderPreset: (preset: HeaderFooterPresetId) => void;
  setFooterPreset: (preset: HeaderFooterPresetId) => void;
  setHeaderFooterLinked: (linked: boolean) => void;
  handleHeaderFooterDraftChange: (side: 'header' | 'footer', value: string) => void;
  commitHeaderFooterDraft: (side: 'header' | 'footer') => void;
}): JSX.Element {
  return (
    <section className="detail-panel">
      <div className="detail-panel-head">
        <h3>页眉页脚预留</h3>
        <span>只控制高度</span>
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
      <div className="panel-note-list">
        <p>当前先控制预留区域高度，后续再接入页眉页脚内容编辑。</p>
      </div>
    </section>
  );
}

function renderTemplatePanel({
  styleSettings,
  setTemplateId,
}: {
  styleSettings: StyleSettings;
  setTemplateId: (templateId: TemplateId) => void;
}): JSX.Element {
  return (
    <section className="detail-panel">
      <div className="detail-panel-head">
        <h3>模板起点</h3>
        <span>默认或预设模板</span>
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
    </section>
  );
}

function renderPaginationPanel({
  styleSettings,
  setPaginationAlgorithmId,
  setPaginationBehaviorOption,
}: {
  styleSettings: StyleSettings;
  setPaginationAlgorithmId: (algorithmId: PaginationAlgorithmId) => void;
  setPaginationBehaviorOption: (option: PaginationBehaviorOption, value: boolean) => void;
}): JSX.Element {
  const paginationAlgorithmOptions = listPaginationAlgorithms();

  return (
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
  );
}

export function RightPanel({
  currentPageCount,
  headingCount,
  characterCount,
  workspaceViewMode,
  layoutWarnings,
  canvasTextSelection,
}: RightPanelProps): JSX.Element {
  const resolvedStyleContract = useResolvedStyleContract();
  const styleSettings = useAppStore((state) => state.styleSettings);
  const layoutDocument = useAppStore((state) => state.layoutDocument);
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
  const setHeaderPreset = useAppStore((state) => state.setHeaderPreset);
  const setFooterPreset = useAppStore((state) => state.setFooterPreset);
  const setCustomHeaderReservedMm = useAppStore((state) => state.setCustomHeaderReservedMm);
  const setCustomFooterReservedMm = useAppStore((state) => state.setCustomFooterReservedMm);
  const setHeaderFooterLinked = useAppStore((state) => state.setHeaderFooterLinked);
  const setPaginationAlgorithmId = useAppStore((state) => state.setPaginationAlgorithmId);
  const setPaginationBehaviorOption = useAppStore((state) => state.setPaginationBehaviorOption);
  const replaceLayoutNodeRichText = useAppStore((state) => state.replaceLayoutNodeRichText);
  const updateLayoutNodeText = useAppStore((state) => state.updateLayoutNodeText);
  const toggleLayoutNodeTextMark = useAppStore((state) => state.toggleLayoutNodeTextMark);
  const applyLayoutNodeTextStyle = useAppStore((state) => state.applyLayoutNodeTextStyle);
  const clearLayoutNodeTextFormatting = useAppStore((state) => state.clearLayoutNodeTextFormatting);
  const updateLayoutImageAttributes = useAppStore((state) => state.updateLayoutImageAttributes);
  const updateLayoutTableStructure = useAppStore((state) => state.updateLayoutTableStructure);
  const updateLayoutTableHeaderRow = useAppStore((state) => state.updateLayoutTableHeaderRow);
  const updateLayoutTableColumnAlign = useAppStore((state) => state.updateLayoutTableColumnAlign);
  const applyLayoutNodeBlockStyle = useAppStore((state) => state.applyLayoutNodeBlockStyle);
  const [tableStructureFeedback, setTableStructureFeedback] = useState<string | null>(null);
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
  const selectedNodeId = layoutDocument?.viewState.selectedNodeId ?? null;
  const selectedNodeInfo = getSelectedLayoutNodeInfo(layoutDocument);

  useEffect(() => {
    setTableStructureFeedback(null);
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
          setHeaderFooterLinked,
          handleHeaderFooterDraftChange,
          commitHeaderFooterDraft,
        });
      case '模板起点':
        return renderTemplatePanel({
          styleSettings,
          setTemplateId,
        });
      case '分页策略':
        return renderPaginationPanel({
          styleSettings,
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
            selectedNodeId,
            canvasTextSelection,
            resolvedStyleContract,
            toggleLayoutNodeTextMark,
            applyLayoutNodeTextStyle,
            clearLayoutNodeTextFormatting,
            updateLayoutImageAttributes,
            updateLayoutTableStructure,
            updateLayoutTableHeaderRow,
            updateLayoutTableColumnAlign,
            applyLayoutNodeBlockStyle,
            tableStructureFeedback,
            setTableStructureFeedback,
            syncEditingTextBeforeStyleAction,
          )}
        </div>
      );
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
