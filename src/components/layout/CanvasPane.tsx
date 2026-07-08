import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import { formulaTemplateGroups } from '@/constants/formulaTemplates';
import {
  fontFamilyPlaceholderValue,
  textFontFamilyGroups,
  type FontFamilyGroup,
} from '@/constants/fontFamilies';
import { Bold, Columns2, Combine, Eraser, Highlighter, Italic, Strikethrough, Underline, X } from 'lucide-react';
import { highlightColorOptions, standardColorOptions } from '@/constants/styleColors';
import {
  shouldRenderTextRunAsDictationBlank,
  type AnswerDisplayMode,
  applyTextRunPatchToTextRuns,
  buildLayoutListTree,
  clearTextFormattingInTextRuns,
  getLayoutBlockPlainText,
  buildSemanticClassName,
  buildSemanticPresetClassName,
  getSemanticBlockPresetPresentation,
  buildSemanticRoleStyleVariables,
  getSemanticRolePresentation,
  getLayoutListItemKind,
  getLayoutListItemLevel,
  resolveCompactChoiceListLayoutWithOptions,
  getTocBlockDisplayTitle,
  getTextContentFromRuns,
  getVisibleTocItemsForBlock,
  isEditableLayoutTextBlock,
  shouldHideLayoutListItemMarker,
  toggleTextMarkInTextRuns,
  type LayoutBlock,
  type LayoutSemanticRoleConfig,
  type LayoutStyleSheet,
  type LayoutResource,
  type LayoutListTreeNode,
  type LayoutListItem,
  type LayoutTableCell,
  type LayoutTableRow,
  type ParseState,
  type TableCellRangeSelection,
  type ImageBlockMetadata,
  type ImageWrapSide,
  type TextMark,
  type TextMarkType,
  type TextRangeSelection,
  type TextRun,
  type TocItem,
  type TextStyleOverrides,
} from '@/engine/document-model';
import { buildFontFaceCss, buildFontFamilyGroupsWithImportedFonts } from '@/engine/document-model/fontResources';
import { renderEquationToHtml, splitInlineEquations, renderInlineEquationToHtml } from '@/engine/document-model/equation';
import {
  resolveImageLayout,
  resolveImageRenderMetrics,
  getImageWrapClassName,
  isImageTextWrapMode,
  type ImageMeasuredVisibleSize,
  type ResolvedImageLayout,
} from '@/engine/document-model/imageLayout';
import {
  getTableCellColSpan,
  getTableCellRowSpan,
  isCoveredTableCell,
  isTableCellInRangeSelection,
  resolveTableColumnWidths,
} from '@/engine/document-model/tableLayout';
import {
  buildPageStyleVariables,
  resolvePageBackgroundOverride,
  resolveBlockDefaultTextMetrics,
  resolveBlockEffectiveTextMetrics,
} from '@/engine/style/blockStyleResolution';
import { resolveColumnSectionContract, shouldLayoutBlockSpanAllColumns } from '@/engine/style/columnLayout';
import { resolvePdfWatermarkRenderModel } from '@/engine/style/pdfWatermark';
import {
  resolveQuickTextStyleForBlock,
  resolveQuickTextStyleForRun,
} from '@/engine/style/quickTextStyle';
import { buildHeaderFooterPageTitles, renderHeaderFooterContent } from '@/engine/style/headerFooterContent';
import type { HeaderFooterContent, PdfWatermarkSettings, ResolvedStyleContract } from '@/engine/style/types';
import type {
  MeasuredTableRowHeights,
  MeasuredTextFragmentHeights,
  MeasuredTextLineBreaks,
  PageLayout,
  TableRowMeasurementJob,
  TextFragmentMeasurementJob,
} from '@/engine/typesetting/types';
import { useAppStore } from '@/store';
import type { CanvasTextSelectionState } from '@/types/workspace';
import { createTextFragment, resolveHangingIndentStyle } from '@/engine/document-model/utils';
import { mergeAdjacentTextRuns } from '@/engine/document-model';
import { resolveAssetSrc } from '@/utils/filePath';
import { ContextMenu, type ContextMenuEntry } from '@/components/common/ContextMenu';

interface CanvasPaneProps {
  documentTitle: string;
  documentBlockCount: number;
  documentBlocks: LayoutBlock[];
  documentResources: LayoutResource[];
  documentStyles: LayoutStyleSheet;
  semanticRoleConfig?: LayoutSemanticRoleConfig;
  answerDisplayMode: AnswerDisplayMode;
  pageLayouts: PageLayout[];
  parseError: string | null;
  parseState: ParseState;
  resolvedStyleContract: ResolvedStyleContract;
  headerFooterContent: HeaderFooterContent;
  pdfWatermarkSettings: PdfWatermarkSettings;
  selectedNodeId: string | null;
  selectedBlockIds: string[];
  workspaceRootPath?: string | null;
  onSelectNode: (nodeId: string) => void;
  onSelectBlock: (blockId: string, extendRange: boolean) => void;
  onSelectTableCell: (cellId: string, extendRange: boolean) => void;
  onClearSelection: () => void;
  onMergeSelectedBlocks: () => void;
  onWrapSelectedBlocksInColumns: () => void;
  onCommitNodeText: (nodeId: string, text: string) => void;
  onCommitNodeRichText: (nodeId: string, textRuns: TextRun[]) => void;
  onTextSelectionChange: (state: CanvasTextSelectionState) => void;
  tocItems?: TocItem[];
  onNavigateToNode?: (nodeId: string) => void;
  requestedStartEditingNodeId?: string | null;
  onConsumeRequestedStartEditingNode?: (nodeId: string) => void;
  requestedScrollToNodeId?: string | null;
  onConsumeRequestedScrollToNode?: (nodeId: string) => void;
  isCondensed?: boolean;
  onMeasuredBlockHeightsChange?: (heights: Record<string, number>) => void;
  onMeasuredTextLineBreaksChange?: (lineBreaks: MeasuredTextLineBreaks) => void;
  textFragmentMeasurementJobs?: TextFragmentMeasurementJob[];
  onMeasuredTextFragmentHeightsChange?: (heights: MeasuredTextFragmentHeights) => void;
  tableRowMeasurementJobs?: TableRowMeasurementJob[];
  onMeasuredTableRowHeightsChange?: (heights: MeasuredTableRowHeights) => void;
}

interface BlockMeasurementCacheEntry {
  signature: string;
  heightPx: number;
  textLineBreaks: MeasuredTextLineBreaks;
}

interface RenderListTreeOptions {
  block: LayoutBlock;
  answerDisplayMode: AnswerDisplayMode;
  documentStyles: LayoutStyleSheet | null | undefined;
  nodes: LayoutListTreeNode[];
  selectedNodeId: string | null;
  editingNodeId: string | null;
  editingKind: CanvasEditorKind | null;
  editingDraftTextRuns: TextRun[] | null;
  editingText: string;
  activeSelection: TextRangeSelection | null;
  richEditorRef: MutableRefObject<HTMLDivElement | null>;
  editorRef: RefObject<HTMLTextAreaElement>;
  onSelectNode: (nodeId: string) => void;
  onPrepareSelectNode: (nodeId: string) => void;
  onStartEditing: (node: EditableCanvasNode) => void;
  onSelectionChange: (selection: TextRangeSelection | null) => void;
  onEditDraftTextRunsChange: (textRuns: TextRun[]) => void;
  onEditTextChange: (text: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onListItemContextMenu: (event: MouseEvent<HTMLElement>, itemId: string) => void;
  fallbackOrdered: boolean;
}

type CanvasEditorKind =
  | 'heading'
  | 'paragraph'
  | 'code'
  | 'listItem'
  | 'tableCell'
  | 'imageAlt'
  | 'equation';

interface EditableCanvasNode {
  id: string;
  text: string;
  kind: CanvasEditorKind;
  textRuns: TextRun[];
}

interface CanvasScrollSnapshot {
  top: number;
  left: number;
}

interface PageDisplayStyles {
  frameStyle: CSSProperties;
  pageStyle: CSSProperties;
}

const defaultQuickTextColor = '#344054';

interface FloatingToolbarPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
}

type FloatingToolbarMenu = 'fontFamily' | 'fontSize';

interface ActiveEquationEditor {
  nodeId: string;
  initialText: string;
}

interface ActiveImageResize {
  nodeId: string;
  startClientX: number;
  startClientY: number;
  startWidthPx: number;
  startHeightPx: number;
  lockAspectRatio: boolean;
  aspectRatio: number | null;
  pageScale: number;
}

type ImageCropEdge = 'top' | 'right' | 'bottom' | 'left';

interface ImageDraftCrop {
  cropTopPx: number;
  cropRightPx: number;
  cropBottomPx: number;
  cropLeftPx: number;
}

interface ImageDraftOffset {
  offsetX: number;
  offsetY: number;
  wrapSide?: ImageWrapSide;
}

interface ActiveImageCrop {
  nodeId: string;
  edge: ImageCropEdge;
  startClientX: number;
  startClientY: number;
  startCrop: ImageDraftCrop;
  fullWidthPx: number;
  fullHeightPx: number;
  pageScale: number;
}

// 图片拖动状态接口
interface ActiveImageDrag {
  nodeId: string;
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
  startRenderedLeftPx: number;
  startRenderedTopPx: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
  pageContentWidthPx: number;
  isTextWrapped: boolean;
  pageScale: number;
}

function getLayoutBlockSourceNodeId(block: LayoutBlock): string {
  if (block.type === 'heading' && block.metadata.kind === 'heading' && block.metadata.runtimeSlice?.sourceNodeId) {
    return block.metadata.runtimeSlice.sourceNodeId;
  }

  if (block.type === 'paragraph' && block.metadata.kind === 'paragraph' && block.metadata.runtimeSlice?.sourceNodeId) {
    return block.metadata.runtimeSlice.sourceNodeId;
  }

  if (block.type === 'list' && block.metadata.kind === 'list' && block.metadata.runtimeSlice?.fragmentIndex) {
    return block.id.replace(/-list-fragment-\d+$/, '');
  }

  if (block.type === 'table' && block.metadata.kind === 'table' && block.metadata.runtimeSlice?.fragmentIndex) {
    return block.id.replace(/-page-fragment-\d+$/, '');
  }

  if (block.type === 'columnSection' && block.metadata.kind === 'columnSection' && block.metadata.runtimeSlice?.sourceNodeId) {
    return block.metadata.runtimeSlice.sourceNodeId;
  }

  return block.id;
}

interface ActiveTableColumnResize {
  blockId: string;
  cellId: string;
  columnIndex: number;
  nextCellId: string;
  startClientX: number;
  startWidthPx: number;
  startNextWidthPx: number;
  pageScale: number;
}

interface ActiveTableRowResize {
  rowId: string;
  cellId: string;
  startClientY: number;
  startHeightPx: number;
  pageScale: number;
}

interface TableResizeRenderState {
  pageContract?: ResolvedStyleContract;
  draftTableColumnWidths?: Record<string, number[]>;
  draftTableRowHeights?: Record<string, number>;
  onStartTableColumnResize?: (
    event: MouseEvent<HTMLButtonElement>,
    block: LayoutBlock,
    cellId: string,
    columnIndex: number,
    rowIndex: number,
    pageScale: number,
  ) => void;
  onStartTableRowResize?: (
    event: MouseEvent<HTMLButtonElement>,
    block: LayoutBlock,
    cellId: string,
    rowId: string,
    rowIndex: number,
    pageScale: number,
  ) => void;
}

interface ListItemContextMenuState {
  x: number;
  y: number;
  itemId: string;
}

const equationEditorAnimationDurationMs = 170;

const floatingTextMarkOptions: Array<{
  id: TextMarkType;
  label: string;
  icon: typeof Bold;
}> = [
  { id: 'bold', label: '加粗', icon: Bold },
  { id: 'italic', label: '斜体', icon: Italic },
  { id: 'underline', label: '下划线', icon: Underline },
  { id: 'strike', label: '删除线', icon: Strikethrough },
];

const floatingFontSizePresetOptions = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

function hasNonCollapsedSelection(selection: TextRangeSelection | null): selection is TextRangeSelection {
  return !!selection && selection.start < selection.end;
}

function isSameTextSelection(left: TextRangeSelection | null, right: TextRangeSelection | null): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.start === right.start && left.end === right.end;
}

function normalizeFloatingSelection(text: string, selection: TextRangeSelection | null): TextRangeSelection | null {
  if (!text || !selection || !hasNonCollapsedSelection(selection)) {
    return null;
  }

  if (selection.start < 0 || selection.end > text.length || selection.start >= selection.end) {
    return null;
  }

  return selection;
}

function collectFloatingSelectedRuns(textRuns: TextRun[], selection: TextRangeSelection | null): TextRun[] {
  const text = textRuns.map((run) => run.text).join('');
  const normalizedSelection = normalizeFloatingSelection(text, selection);
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

function isFloatingTextMarkActive(
  textRuns: TextRun[],
  selection: TextRangeSelection | null,
  markType: TextMarkType,
): boolean {
  const selectedRuns = collectFloatingSelectedRuns(textRuns, selection);
  return selectedRuns.length > 0 && selectedRuns.every((run) => run.marks.some((mark) => mark.type === markType));
}

function getSharedFloatingTextStyleValue(
  textRuns: TextRun[],
  selection: TextRangeSelection | null,
  key: 'fontSize',
): number | undefined;
function getSharedFloatingTextStyleValue(
  textRuns: TextRun[],
  selection: TextRangeSelection | null,
  key: 'color' | 'highlightColor' | 'fontFamily',
): string | undefined;
function getSharedFloatingTextStyleValue(
  textRuns: TextRun[],
  selection: TextRangeSelection | null,
  key: 'color' | 'highlightColor' | 'fontFamily' | 'fontSize',
): string | number | undefined {
  const selectedRuns = collectFloatingSelectedRuns(textRuns, selection);
  if (selectedRuns.length === 0) {
    return undefined;
  }

  const firstValue = selectedRuns[0].styleOverrides[key];
  const isShared = selectedRuns.every((run) => run.styleOverrides[key] === firstValue);
  return isShared ? firstValue : undefined;
}

function normalizeFloatingFontSizeValue(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(10, Math.min(72, Math.round(value)));
}

function getFloatingFontFamilyLabel(fontFamilyGroups: FontFamilyGroup[], fontFamily: string | undefined): string {
  if (!fontFamily || fontFamily === fontFamilyPlaceholderValue) {
    return '字体';
  }

  for (const group of fontFamilyGroups) {
    const option = group.options.find((item) => item.value === fontFamily);
    if (option) {
      return option.label;
    }
  }

  return fontFamily;
}

function buildTextRunStyle(
  run: TextRun,
  inheritedStyle: TextStyleOverrides = {},
  answerDisplayMode: AnswerDisplayMode = 'show',
): CSSProperties {
  const resolvedStyle = resolveQuickTextStyleForRun(run, inheritedStyle);
  const isDictationBlank = shouldRenderTextRunAsDictationBlank(run, answerDisplayMode);
  return {
    color: isDictationBlank ? 'transparent' : resolvedStyle.color,
    backgroundColor: isDictationBlank ? undefined : resolvedStyle.highlightColor ?? resolvedStyle.backgroundColor,
    fontStyle: run.marks.some((mark) => mark.type === 'italic') ? 'italic' : undefined,
    fontFamily: resolvedStyle.fontFamily,
    fontSize: resolvedStyle.fontSize ? `${resolvedStyle.fontSize}px` : undefined,
    letterSpacing: resolvedStyle.letterSpacing ? `${resolvedStyle.letterSpacing}px` : undefined,
    WebkitTextFillColor: isDictationBlank ? 'transparent' : undefined,
  };
}

function buildMeasurementStyleSignature(
  contract: ResolvedStyleContract,
  styles: LayoutStyleSheet,
  floatingImageSignature: string,
): string {
  return JSON.stringify({
    contentWidthPx: contract.contentWidthPx,
    singleColumnContentWidthPx: contract.singleColumnContentWidthPx,
    columnCount: contract.columnCount,
    columnGapPx: contract.columnGapPx,
    headingsSpanAll: contract.headingsSpanAll,
    blockStyles: contract.blockStyles,
    themeLayoutMetrics: contract.themeLayoutMetrics,
    templateId: contract.templateId,
    themeId: contract.themeId,
    textStyles: styles.textStyles,
    floatingImageSignature,
  });
}

function buildFloatingImageMeasurementSignature(blocks: LayoutBlock[]): string {
  return JSON.stringify(
    blocks
      .filter(
        (block): block is LayoutBlock & { metadata: ImageBlockMetadata } =>
          block.type === 'image' && block.metadata.kind === 'image',
      )
      .map((block) => {
        const layout = resolveImageLayout(block.metadata);
        return {
          id: block.id,
          wrapMode: layout.wrapMode,
          wrapSide: layout.wrapSide,
          widthPx: layout.widthPx,
          heightPx: layout.heightPx,
          cropTopPx: layout.cropTopPx,
          cropRightPx: layout.cropRightPx,
          cropBottomPx: layout.cropBottomPx,
          cropLeftPx: layout.cropLeftPx,
          offsetX: layout.offsetX,
          offsetY: layout.offsetY,
          showCaption: layout.showCaption,
        };
      }),
  );
}

function buildBlockMeasurementSignature(block: LayoutBlock, styleSignature: string): string {
  return `${styleSignature}:${JSON.stringify({
    id: block.id,
    type: block.type,
    textRuns: block.textRuns,
    metadata: block.metadata,
    blockStyleOverrides: block.blockStyleOverrides,
    pagination: block.pagination,
  })}`;
}

function getMeasurementBlockWidthPx(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
): number {
  if (contract.columnCount <= 1 || shouldLayoutBlockSpanAllColumns(block, contract)) {
    return contract.contentWidthPx;
  }

  return contract.singleColumnContentWidthPx;
}

function buildMeasurementBlockStyle(
  block: LayoutBlock,
  contract: ResolvedStyleContract,
): CSSProperties {
  return {
    width: `${Math.max(40, getMeasurementBlockWidthPx(block, contract))}px`,
  };
}

const TEXT_LINE_TOP_TOLERANCE_PX = 1;

function normalizeMeasuredLineBreakOffsets(offsets: number[], textLength: number): number[] {
  const normalizedOffsets: number[] = [];

  offsets.forEach((offset) => {
    const normalizedOffset = Math.max(0, Math.min(textLength, Math.round(offset)));
    const previousOffset = normalizedOffsets[normalizedOffsets.length - 1] ?? 0;
    if (normalizedOffset > previousOffset) {
      normalizedOffsets.push(normalizedOffset);
    }
  });

  if (textLength > 0 && normalizedOffsets[normalizedOffsets.length - 1] !== textLength) {
    normalizedOffsets.push(textLength);
  }

  return normalizedOffsets;
}

function measureTextLineBreakOffsets(root: HTMLElement): number[] {
  const lineBreakOffsets: number[] = [];
  const range = document.createRange();
  let textOffset = 0;
  let currentLineTop: number | null = null;
  let currentLineEndOffset = 0;

  const pushLineBreak = (offset: number) => {
    const previousOffset = lineBreakOffsets[lineBreakOffsets.length - 1] ?? 0;
    if (offset > previousOffset) {
      lineBreakOffsets.push(offset);
    }
  };

  const visitNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const nodeText = node.textContent?.replace(/\u00A0/g, ' ') ?? '';

      for (let index = 0; index < nodeText.length; index += 1) {
        range.setStart(node, index);
        range.setEnd(node, index + 1);

        const rect = Array.from(range.getClientRects()).find(
          (item) => item.width > 0 || item.height > 0,
        );
        const nextOffset = textOffset + index + 1;

        // 真实换行以浏览器返回的字符 rect.top 为准；top 变化说明进入了下一条视觉行。
        if (rect) {
          if (currentLineTop === null) {
            currentLineTop = rect.top;
          } else if (Math.abs(rect.top - currentLineTop) > TEXT_LINE_TOP_TOLERANCE_PX) {
            pushLineBreak(currentLineEndOffset);
            currentLineTop = rect.top;
          }
        }

        currentLineEndOffset = nextOffset;
      }

      textOffset += nodeText.length;
      return;
    }

    if (!(node instanceof HTMLElement)) {
      return;
    }

    if (node.tagName.toLowerCase() === 'br') {
      textOffset += 1;
      currentLineEndOffset = textOffset;
      pushLineBreak(currentLineEndOffset);
      currentLineTop = null;
      return;
    }

    Array.from(node.childNodes).forEach((childNode) => visitNode(childNode));
  };

  try {
    Array.from(root.childNodes).forEach((childNode) => visitNode(childNode));
  } finally {
    range.detach();
  }

  if (currentLineEndOffset > 0) {
    pushLineBreak(currentLineEndOffset);
  }

  return normalizeMeasuredLineBreakOffsets(lineBreakOffsets, textOffset);
}

function measureTextLineBreaksInBlock(blockElement: HTMLElement): MeasuredTextLineBreaks {
  const nextLineBreaks: MeasuredTextLineBreaks = {};
  const textElements = blockElement.querySelectorAll<HTMLElement>('[data-measure-text-node-id]');

  textElements.forEach((element) => {
    const nodeId = element.dataset.measureTextNodeId;
    if (!nodeId) {
      return;
    }

    const lineBreakOffsets = measureTextLineBreakOffsets(element);
    if (lineBreakOffsets.length > 0) {
      nextLineBreaks[nodeId] = lineBreakOffsets;
    }
  });

  return nextLineBreaks;
}

function resolveHeadingDecorationMarkerInset(
  block: LayoutBlock,
  contract?: ResolvedStyleContract,
): number {
  if (!contract || block.type !== 'heading' || block.metadata.kind !== 'heading') {
    return 0;
  }

  if (block.metadata.depth === 1) {
    return contract.themeLayoutMetrics.heading1.markerInsetLeft;
  }

  if (block.metadata.depth === 2) {
    return contract.themeLayoutMetrics.heading2.markerInsetLeft;
  }

  return contract.themeLayoutMetrics.heading3.markerInsetLeft;
}

function buildBlockStyle(
  block: LayoutBlock,
  effectiveLineHeight?: number,
  contract?: ResolvedStyleContract,
  semanticRoleConfig?: LayoutSemanticRoleConfig,
): CSSProperties {
  const supportsBlockIndent = block.type === 'heading' || block.type === 'paragraph';
  const indentStyle = supportsBlockIndent ? resolveHangingIndentStyle(block.blockStyleOverrides) : null;
  const textIndent = indentStyle ? indentStyle.textIndent : block.blockStyleOverrides.firstLineIndent;
  const decorationMarkerInset = resolveHeadingDecorationMarkerInset(block, contract);
  const hasLeftIndentOverride =
    block.blockStyleOverrides.indentLeft !== undefined || block.blockStyleOverrides.hangingIndent !== undefined;
  const hasRightIndentOverride = block.blockStyleOverrides.indentRight !== undefined;
  const hasTextIndentOverride =
    block.blockStyleOverrides.firstLineIndent !== undefined || block.blockStyleOverrides.hangingIndent !== undefined;

  const semanticStyleVariables = buildSemanticRoleStyleVariables(block, semanticRoleConfig) as CSSProperties;

  return {
    ...semanticStyleVariables,
    textAlign: block.blockStyleOverrides.textAlign,
    lineHeight: effectiveLineHeight !== undefined
      ? `${effectiveLineHeight}px`
      : block.blockStyleOverrides.lineHeight !== undefined
        ? `${block.blockStyleOverrides.lineHeight}px`
        : undefined,
    marginTop: block.blockStyleOverrides.spaceBefore !== undefined
      ? `${block.blockStyleOverrides.spaceBefore}px`
      : undefined,
    marginBottom: block.blockStyleOverrides.spaceAfter !== undefined
      ? `${block.blockStyleOverrides.spaceAfter}px`
      : undefined,
    paddingLeft: indentStyle && hasLeftIndentOverride ? `${indentStyle.paddingLeft + decorationMarkerInset}px` : undefined,
    paddingRight: indentStyle && hasRightIndentOverride ? `${indentStyle.paddingRight}px` : undefined,
    textIndent: hasTextIndentOverride && textIndent !== undefined
      ? `${textIndent}px`
      : undefined,
    backgroundColor: block.blockStyleOverrides.backgroundColor,
  };
}

function resolveBlockLineHeightStyle(
  block: LayoutBlock,
  contract: ResolvedStyleContract | undefined,
  styles?: LayoutStyleSheet,
): number | undefined {
  if (!contract) {
    return block.blockStyleOverrides.lineHeight;
  }

  const defaultMetrics = resolveBlockDefaultTextMetrics(block, contract);
  const effectiveMetrics = resolveBlockEffectiveTextMetrics(block, contract, styles);
  const renderedBaseLineHeight = block.blockStyleOverrides.lineHeight ?? defaultMetrics.lineHeight;

  // 只有字号导致行高必须变大时才写内联行高；普通块继续走 CSS 模板变量。
  if (effectiveMetrics.lineHeight > renderedBaseLineHeight) {
    return effectiveMetrics.lineHeight;
  }

  return block.blockStyleOverrides.lineHeight;
}

function buildImageStyle(
  block: LayoutBlock,
  semanticRoleConfig?: LayoutSemanticRoleConfig,
  layoutOverride?: ResolvedImageLayout | null,
): CSSProperties | undefined {
  if (block.type !== 'image' || block.metadata.kind !== 'image') {
    return undefined;
  }

  const layout = layoutOverride ?? resolveImageLayout(block.metadata);
  const styles = {
    ...buildSemanticRoleStyleVariables(block, semanticRoleConfig),
  } as CSSProperties;

  if (layout.wrapMode === 'topBottom') {
    styles.marginLeft = 'auto';
    styles.marginRight = 'auto';
    // 上下型不让正文进入图片左右侧，图片自身默认居中；仍允许横向偏移。
    if (layout.offsetX !== 0) {
      styles.marginLeft = `calc(50% + ${layout.offsetX}px - ${(layout.widthPx ?? 0) / 2}px)`;
      styles.marginRight = 'auto';
    }
    if (layout.offsetY !== 0) {
      styles.marginTop = `${layout.offsetY}px`;
    }
  } else if (isImageTextWrapMode(layout.wrapMode)) {
    styles.float = layout.wrapSide;
    styles.clear = 'none';
    styles.marginTop = `${layout.offsetY}px`;
    if (layout.wrapSide === 'left') {
      styles.marginLeft = `${Math.max(0, layout.offsetX)}px`;
      styles.marginRight = '16px';
    } else {
      styles.marginLeft = '16px';
      styles.marginRight = `${Math.max(0, layout.offsetX)}px`;
    }
    // 四周型 / 紧密型的横向偏移继续收口为“离所在侧边的内缩量”，
    // 这样拖动时既能在页内自由换侧，又不会把图片直接推出正文区。
  } else {
    // 嵌入型仍作为稳定图片块随文档流移动。
    if (layout.offsetX !== 0) {
      styles.marginLeft = layout.offsetX > 0 ? `${layout.offsetX}px` : 'auto';
      styles.marginRight = layout.offsetX < 0 ? `${Math.abs(layout.offsetX)}px` : 'auto';
    }
    if (layout.offsetY !== 0) {
      styles.marginTop = `${layout.offsetY}px`;
    }
  }

  return styles;
}

function buildImageShellClassName(
  block: LayoutBlock,
  selectedNodeId: string | null,
  layoutOverride?: ResolvedImageLayout | null,
): string {
  if (block.type !== 'image' || block.metadata.kind !== 'image') {
    return 'image-shell';
  }

  return `image-shell ${getImageWrapClassName(layoutOverride ?? resolveImageLayout(block.metadata))}`;
}

function resolveImageLayoutWithDraft(
  block: LayoutBlock,
  draftSize: { widthPx: number | null; heightPx: number | null } | null,
  draftCrop: ImageDraftCrop | null,
  draftOffset?: ImageDraftOffset | null,
): ResolvedImageLayout | null {
  if (block.type !== 'image' || block.metadata.kind !== 'image') {
    return null;
  }

  return resolveImageLayout({
    ...block.metadata,
    widthPx: draftSize?.widthPx ?? block.metadata.widthPx,
    heightPx: draftSize?.heightPx ?? block.metadata.heightPx,
    cropTopPx: draftCrop?.cropTopPx ?? block.metadata.cropTopPx,
    cropRightPx: draftCrop?.cropRightPx ?? block.metadata.cropRightPx,
    cropBottomPx: draftCrop?.cropBottomPx ?? block.metadata.cropBottomPx,
    cropLeftPx: draftCrop?.cropLeftPx ?? block.metadata.cropLeftPx,
    wrapSide: draftOffset?.wrapSide ?? block.metadata.wrapSide,
    offsetX: draftOffset?.offsetX ?? block.metadata.offsetX,
    offsetY: draftOffset?.offsetY ?? block.metadata.offsetY,
  });
}

function buildImageAttributePayload(
  block: LayoutBlock,
  overrides: {
    widthPx?: number | null;
    heightPx?: number | null;
    cropTopPx?: number | null;
    cropRightPx?: number | null;
    cropBottomPx?: number | null;
    cropLeftPx?: number | null;
    wrapSide?: ImageWrapSide;
    offsetX?: number | null;
    offsetY?: number | null;
  } = {},
) {
  if (block.type !== 'image' || block.metadata.kind !== 'image') {
    return null;
  }

  const layout = resolveImageLayout(block.metadata);

  return {
    src: block.metadata.src,
    alt: block.metadata.alt,
    title: block.metadata.title,
    widthPx: overrides.widthPx ?? block.metadata.widthPx ?? null,
    heightPx: overrides.heightPx ?? block.metadata.heightPx ?? null,
    lockAspectRatio: block.metadata.lockAspectRatio ?? true,
    objectFit: block.metadata.objectFit ?? 'contain',
    cropTopPx: overrides.cropTopPx ?? block.metadata.cropTopPx ?? 0,
    cropRightPx: overrides.cropRightPx ?? block.metadata.cropRightPx ?? 0,
    cropBottomPx: overrides.cropBottomPx ?? block.metadata.cropBottomPx ?? 0,
    cropLeftPx: overrides.cropLeftPx ?? block.metadata.cropLeftPx ?? 0,
    wrapMode: layout.wrapMode,
    wrapSide: overrides.wrapSide ?? layout.wrapSide,
    showCaption: block.metadata.showCaption ?? false,
    offsetX: overrides.offsetX ?? block.metadata.offsetX ?? 0,
    offsetY: overrides.offsetY ?? block.metadata.offsetY ?? 0,
  };
}

function buildImageViewportStyle(
  layout: ResolvedImageLayout | null,
  measuredVisibleSize: ImageMeasuredVisibleSize | null,
): CSSProperties | undefined {
  if (!layout) {
    return undefined;
  }

  const metrics = resolveImageRenderMetrics(layout, measuredVisibleSize);
  return {
    width: metrics.visibleWidthPx ? `${metrics.visibleWidthPx}px` : undefined,
    height: metrics.visibleHeightPx ? `${metrics.visibleHeightPx}px` : undefined,
  };
}

function buildImageContentStyle(
  layout: ResolvedImageLayout | null,
  measuredVisibleSize: ImageMeasuredVisibleSize | null,
): CSSProperties | undefined {
  if (!layout) {
    return undefined;
  }

  const metrics = resolveImageRenderMetrics(layout, measuredVisibleSize);

  return {
    width: metrics.fullWidthPx ? `${metrics.fullWidthPx}px` : undefined,
    height: metrics.fullHeightPx ? `${metrics.fullHeightPx}px` : undefined,
    maxWidth: metrics.fullWidthPx ? 'none' : undefined,
    maxHeight: metrics.fullHeightPx ? 'none' : undefined,
    transform:
      metrics.cropLeftPx || metrics.cropTopPx
        ? `translate(${-metrics.cropLeftPx}px, ${-metrics.cropTopPx}px)`
        : undefined,
  };
}

function buildImageCropOverlayStyle(
  layout: ResolvedImageLayout | null,
  measuredVisibleSize: ImageMeasuredVisibleSize | null,
): CSSProperties | undefined {
  if (!layout) {
    return undefined;
  }

  const metrics = resolveImageRenderMetrics(layout, measuredVisibleSize);
  if (!metrics.fullWidthPx || !metrics.fullHeightPx) {
    return undefined;
  }

  return {
    left: `${-metrics.cropLeftPx}px`,
    top: `${-metrics.cropTopPx}px`,
    width: `${metrics.fullWidthPx}px`,
    height: `${metrics.fullHeightPx}px`,
  };
}

function buildImageCropSelectionStyle(
  layout: ResolvedImageLayout | null,
  measuredVisibleSize: ImageMeasuredVisibleSize | null,
): CSSProperties | undefined {
  if (!layout) {
    return undefined;
  }

  const metrics = resolveImageRenderMetrics(layout, measuredVisibleSize);
  if (!metrics.visibleWidthPx || !metrics.visibleHeightPx) {
    return undefined;
  }

  return {
    left: `${metrics.cropLeftPx}px`,
    top: `${metrics.cropTopPx}px`,
    width: `${metrics.visibleWidthPx}px`,
    height: `${metrics.visibleHeightPx}px`,
  };
}

function buildImageCropHandleStyle(
  layout: ResolvedImageLayout | null,
  measuredVisibleSize: ImageMeasuredVisibleSize | null,
  edge: ImageCropEdge,
): CSSProperties | undefined {
  if (!layout) {
    return undefined;
  }

  const metrics = resolveImageRenderMetrics(layout, measuredVisibleSize);
  if (!metrics.visibleWidthPx || !metrics.visibleHeightPx) {
    return undefined;
  }

  const left = metrics.cropLeftPx;
  const top = metrics.cropTopPx;
  const right = metrics.cropLeftPx + metrics.visibleWidthPx;
  const bottom = metrics.cropTopPx + metrics.visibleHeightPx;

  switch (edge) {
    case 'top':
      return {
        left: `${left + metrics.visibleWidthPx / 2}px`,
        top: `${top}px`,
        transform: 'translate(-50%, -50%)',
      };
    case 'right':
      return {
        left: `${right}px`,
        top: `${top + metrics.visibleHeightPx / 2}px`,
        transform: 'translate(50%, -50%)',
      };
    case 'bottom':
      return {
        left: `${left + metrics.visibleWidthPx / 2}px`,
        top: `${bottom}px`,
        transform: 'translate(-50%, 50%)',
      };
    case 'left':
      return {
        left: `${left}px`,
        top: `${top + metrics.visibleHeightPx / 2}px`,
        transform: 'translate(-50%, -50%)',
      };
    default:
      return undefined;
  }
}

function buildImageCropMaskStyle(
  layout: ResolvedImageLayout | null,
  measuredVisibleSize: ImageMeasuredVisibleSize | null,
  edge: ImageCropEdge,
): CSSProperties | undefined {
  if (!layout) {
    return undefined;
  }

  const metrics = resolveImageRenderMetrics(layout, measuredVisibleSize);
  if (!metrics.fullWidthPx || !metrics.fullHeightPx || !metrics.visibleWidthPx || !metrics.visibleHeightPx) {
    return undefined;
  }

  const selectionLeft = metrics.cropLeftPx;
  const selectionTop = metrics.cropTopPx;
  const selectionRight = selectionLeft + metrics.visibleWidthPx;
  const selectionBottom = selectionTop + metrics.visibleHeightPx;

  switch (edge) {
    case 'top':
      return {
        left: 0,
        top: 0,
        width: `${metrics.fullWidthPx}px`,
        height: `${metrics.cropTopPx}px`,
      };
    case 'right':
      return {
        left: `${selectionRight}px`,
        top: `${selectionTop}px`,
        width: `${Math.max(0, metrics.fullWidthPx - selectionRight)}px`,
        height: `${metrics.visibleHeightPx}px`,
      };
    case 'bottom':
      return {
        left: 0,
        top: `${selectionBottom}px`,
        width: `${metrics.fullWidthPx}px`,
        height: `${Math.max(0, metrics.fullHeightPx - selectionBottom)}px`,
      };
    case 'left':
      return {
        left: 0,
        top: `${selectionTop}px`,
        width: `${metrics.cropLeftPx}px`,
        height: `${metrics.visibleHeightPx}px`,
      };
    default:
      return undefined;
  }
}

function isTableCellSelected(block: LayoutBlock, selectedNodeId: string | null): boolean {
  if (block.type !== 'table' || block.metadata.kind !== 'table' || !selectedNodeId) {
    return false;
  }

  return block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === selectedNodeId));
}

function findTableBlockByCellId(blocks: LayoutBlock[], cellId: string): LayoutBlock | null {
  for (const block of blocks) {
    if (block.type === 'table' && block.metadata.kind === 'table') {
      const hasCell = block.metadata.rows.some((row) => row.cells.some((cell) => cell.id === cellId));
      if (hasCell) {
        return block;
      }
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedBlock = findTableBlockByCellId(block.metadata.blocks, cellId);
      if (nestedBlock) {
        return nestedBlock;
      }
    }

    if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
      const nestedBlock = findTableBlockByCellId(block.metadata.blocks, cellId);
      if (nestedBlock) {
        return nestedBlock;
      }
    }
  }

  return null;
}

function isHeaderLikeTableRow(row: LayoutTableRow, rowIndex: number): boolean {
  return rowIndex === 0 || row.cells.some((cell) => cell.isHeader);
}

function getTableRowBaseHeightPx(
  row: LayoutTableRow,
  rowIndex: number,
  pageContract: ResolvedStyleContract | undefined,
): number {
  if (!pageContract) {
    return isHeaderLikeTableRow(row, rowIndex) ? 44 : 40;
  }

  return isHeaderLikeTableRow(row, rowIndex)
    ? pageContract.blockStyles.table.headerRowHeight
    : pageContract.blockStyles.table.rowHeight;
}

function renderInlineText(text: string, keyPrefix: string): ReactNode {
  // 分割普通文本和行内公式
  const fragments = splitInlineEquations(text);

  return fragments.flatMap((fragment, fragmentIndex) => {
    if (fragment.type === 'equation') {
      // 行内公式：使用 dangerouslySetInnerHTML 渲染，保持字体大小继承
      const equationHtml = renderInlineEquationToHtml(fragment.content);
      return [
        <span
          key={`${keyPrefix}-eq-${fragmentIndex}`}
          className="inline-equation"
          dangerouslySetInnerHTML={{ __html: equationHtml }}
        />,
      ];
    }

    // 普通文本：处理换行
    const textParts = fragment.content.split('\n');
    return textParts.flatMap((part, partIndex) => {
      if (partIndex === 0) {
        return [part];
      }
      return [<br key={`${keyPrefix}-br-${fragmentIndex}-${partIndex}`} />, part];
    });
  });
}

function applyMarks(
  content: ReactNode,
  run: TextRun,
  keyPrefix: string,
  answerDisplayMode: AnswerDisplayMode = 'show',
  inheritedStyle: TextStyleOverrides = {},
): ReactNode {
  const isDictationBlank = shouldRenderTextRunAsDictationBlank(run, answerDisplayMode);
  const blankUnderlineColor = resolveQuickTextStyleForRun(run, inheritedStyle).color ?? defaultQuickTextColor;
  return run.marks.reduce<ReactNode>((currentNode, mark, index) => {
    switch (mark.type) {
      case 'bold':
        return <strong key={`${keyPrefix}-bold-${index}`}>{currentNode}</strong>;
      case 'italic':
        return <em key={`${keyPrefix}-italic-${index}`}>{currentNode}</em>;
      case 'underline':
        return (
          <u
            key={`${keyPrefix}-underline-${index}`}
            style={isDictationBlank ? { textDecorationColor: blankUnderlineColor } : undefined}
          >
            {currentNode}
          </u>
        );
      case 'strike':
        return <s key={`${keyPrefix}-strike-${index}`}>{currentNode}</s>;
      case 'code':
        return <code key={`${keyPrefix}-code-${index}`}>{currentNode}</code>;
      case 'link':
        return (
          <a
            key={`${keyPrefix}-link-${index}`}
            href={mark.href}
            target="_blank"
            rel="noreferrer"
          >
            {currentNode}
          </a>
        );
      default:
        return currentNode;
    }
  }, content);
}

function renderTextRuns(
  textRuns: TextRun[],
  emptyLabel?: string,
  inheritedStyle: TextStyleOverrides = {},
  answerDisplayMode: AnswerDisplayMode = 'show',
): ReactNode[] {
  if (textRuns.length === 0 && emptyLabel) {
    return [
      <span className="empty-text-placeholder" key="empty-text-placeholder">
        {emptyLabel}
      </span>,
    ];
  }

  return textRuns.map((run) => (
    <span key={run.id} style={buildTextRunStyle(run, inheritedStyle, answerDisplayMode)}>
      {applyMarks(renderInlineText(run.text, run.id), run, run.id, answerDisplayMode, inheritedStyle)}
    </span>
  ));
}

function getEditableBlockNode(block: LayoutBlock): EditableCanvasNode | null {
  if (!isEditableLayoutTextBlock(block)) {
    return null;
  }

  if (block.type === 'image' && block.metadata.kind === 'image') {
    return {
      id: block.id,
      text: block.metadata.alt,
      kind: 'imageAlt',
      textRuns: [],
    };
  }

  if (block.type === 'equation' && block.metadata.kind === 'equation') {
    return {
      id: block.id,
      text: block.metadata.value,
      kind: 'equation',
      textRuns: block.textRuns,
    };
  }

  return {
    id: block.id,
    text: getLayoutBlockPlainText(block),
    kind: block.type === 'heading' ? 'heading' : block.type === 'code' ? 'code' : 'paragraph',
    textRuns: block.textRuns,
  };
}

function renderEquationPreview(value: string): { __html: string } {
  return {
    __html: renderEquationToHtml(value).html,
  };
}

function getEditableListItemNode(item: LayoutListItem): EditableCanvasNode {
  return {
    id: item.id,
    text: getTextContentFromRuns(item.textRuns),
    kind: 'listItem',
    textRuns: item.textRuns,
  };
}

function getEditableTableCellNode(cell: LayoutTableCell): EditableCanvasNode {
  return {
    id: cell.id,
    text: getTextContentFromRuns(cell.textRuns),
    kind: 'tableCell',
    textRuns: cell.textRuns,
  };
}

function buildListItemClassName(item: LayoutListItem): string {
  return [
    item.checked === null ? '' : 'task-list-item',
    shouldHideLayoutListItemMarker(item) ? 'list-item-marker-hidden' : '',
    `list-level-${getLayoutListItemLevel(item)}`,
  ]
    .filter(Boolean)
    .join(' ');
}

function renderListTreeNodes({
  block,
  answerDisplayMode,
  documentStyles,
  nodes,
  selectedNodeId,
  editingNodeId,
  editingKind,
  editingDraftTextRuns,
  editingText,
  activeSelection,
  richEditorRef,
  editorRef,
  onSelectNode,
  onPrepareSelectNode,
  onStartEditing,
  onSelectionChange,
  onEditDraftTextRunsChange,
  onEditTextChange,
  onCommitEdit,
  onCancelEdit,
  onListItemContextMenu,
  fallbackOrdered,
}: RenderListTreeOptions): ReactNode[] {
  const inheritedTextStyle = resolveQuickTextStyleForBlock(block, documentStyles);

  return nodes.map((node) => {
    const item = node.item;
    const itemNode = getEditableListItemNode(item);
    const shouldHideMarker = shouldHideLayoutListItemMarker(item);
    const childListKind = node.children[0]
      ? getLayoutListItemKind(node.children[0].item, fallbackOrdered)
      : fallbackOrdered ? 'ordered' : 'unordered';
    const ChildListTag = childListKind === 'ordered' ? 'ol' : 'ul';

    return (
      <li
        key={item.id}
        {...createSelectableTextNodeProps({
          node: itemNode,
          selectedNodeId,
          onSelectNode,
          onPrepareSelectNode,
          onStartEditing,
          className: buildListItemClassName(item),
        })}
        data-list-level={getLayoutListItemLevel(item)}
        data-list-marker-hidden={shouldHideMarker ? 'true' : undefined}
        onContextMenu={(event) => onListItemContextMenu(event, item.id)}
      >
        <span className={item.checked === null ? 'list-item-content' : 'task-list-item-content'}>
          {item.checked !== null && !shouldHideMarker ? (
            <span className="task-list-checkbox" aria-hidden="true">
              {item.checked ? '☑' : '☐'}
            </span>
          ) : null}
          <span className="list-item-text" data-measure-text-node-id={item.id}>
            {editingNodeId === item.id
              ? isRichTextCanvasEditorKind(editingKind ?? 'listItem')
                ? (
                  <RichTextCanvasEditor
                    nodeId={item.id}
                    kind={editingKind ?? 'listItem'}
                    textRuns={editingDraftTextRuns ?? item.textRuns}
                    activeSelection={activeSelection}
                    richEditorRef={richEditorRef}
                    onSelectionChange={onSelectionChange}
                    onDraftChange={onEditDraftTextRunsChange}
                    onCommit={onCommitEdit}
                    onCancel={onCancelEdit}
                  />
                )
                : renderBlockEditor({
                    kind: editingKind ?? 'listItem',
                    editorRef,
                    editingText,
                    onChange: onEditTextChange,
                    onSelectionChange,
                    onCommit: onCommitEdit,
                    onCancel: onCancelEdit,
                  })
              : renderTextRuns(item.textRuns, '空列表项', inheritedTextStyle, answerDisplayMode)}
          </span>
        </span>
        {node.children.length > 0 ? (
          <ChildListTag>{renderListTreeNodes({
            block,
            answerDisplayMode,
            documentStyles,
            nodes: node.children,
            selectedNodeId,
            editingNodeId,
            editingKind,
            editingDraftTextRuns,
            editingText,
            activeSelection,
            richEditorRef,
            editorRef,
            onSelectNode,
            onPrepareSelectNode,
            onStartEditing,
            onSelectionChange,
            onEditDraftTextRunsChange,
            onEditTextChange,
            onCommitEdit,
            onCancelEdit,
            onListItemContextMenu,
            fallbackOrdered,
          })}</ChildListTag>
        ) : null}
      </li>
    );
  });
}

function renderCompactChoiceListItems({
  block,
  answerDisplayMode,
  documentStyles,
  items,
  selectedNodeId,
  editingNodeId,
  editingKind,
  editingDraftTextRuns,
  editingText,
  activeSelection,
  richEditorRef,
  editorRef,
  onSelectNode,
  onPrepareSelectNode,
  onStartEditing,
  onSelectionChange,
  onEditDraftTextRunsChange,
  onEditTextChange,
  onCommitEdit,
  onCancelEdit,
  onListItemContextMenu,
}: Omit<RenderListTreeOptions, 'nodes' | 'fallbackOrdered'> & {
  items: NonNullable<ReturnType<typeof resolveCompactChoiceListLayoutWithOptions>>['items'];
}): ReactNode[] {
  const inheritedTextStyle = resolveQuickTextStyleForBlock(block, documentStyles);

  return items.map((compactItem) => {
    const item = compactItem.item;
    const itemNode = getEditableListItemNode(item);
    const isEditingItem = editingNodeId === item.id;

    return (
      <li
        key={item.id}
        {...createSelectableTextNodeProps({
          node: itemNode,
          selectedNodeId,
          onSelectNode,
          onPrepareSelectNode,
          onStartEditing,
          className: [
            buildListItemClassName(item),
            'choice-option-item',
            isEditingItem ? 'choice-option-item-editing' : '',
          ].filter(Boolean).join(' '),
        })}
        data-list-level={getLayoutListItemLevel(item)}
        onContextMenu={(event) => onListItemContextMenu(event, item.id)}
      >
        {isEditingItem ? (
          <span className="list-item-text choice-option-text choice-option-text-editing">
            {isRichTextCanvasEditorKind(editingKind ?? 'listItem')
              ? (
                <RichTextCanvasEditor
                  nodeId={item.id}
                  kind={editingKind ?? 'listItem'}
                  textRuns={editingDraftTextRuns ?? item.textRuns}
                  activeSelection={activeSelection}
                  richEditorRef={richEditorRef}
                  onSelectionChange={onSelectionChange}
                  onDraftChange={onEditDraftTextRunsChange}
                  onCommit={onCommitEdit}
                  onCancel={onCancelEdit}
                />
              )
              : renderBlockEditor({
                  kind: editingKind ?? 'listItem',
                  editorRef,
                  editingText,
                  onChange: onEditTextChange,
                  onSelectionChange,
                  onCommit: onCommitEdit,
                  onCancel: onCancelEdit,
                })}
          </span>
        ) : (
          <>
            <span className="choice-option-label" aria-hidden="true">
              {compactItem.label}
            </span>
            <span className="list-item-text choice-option-text" data-measure-text-node-id={item.id}>
              {renderTextRuns(compactItem.contentTextRuns, '空列表项', inheritedTextStyle, answerDisplayMode)}
            </span>
          </>
        )}
      </li>
    );
  });
}

function findEditableNodeByIdInBlocks(blocks: LayoutBlock[], nodeId: string): EditableCanvasNode | null {
  for (const block of blocks) {
    if (block.id === nodeId) {
      return getEditableBlockNode(block);
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      const matchedItem = block.metadata.items.find((item) => item.id === nodeId);
      if (matchedItem) {
        return getEditableListItemNode(matchedItem);
      }
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      for (const row of block.metadata.rows) {
        const matchedCell = row.cells.find((cell) => cell.id === nodeId);
        if (matchedCell) {
          return getEditableTableCellNode(matchedCell);
        }
      }
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedNode = findEditableNodeByIdInBlocks(block.metadata.blocks, nodeId);
      if (nestedNode) {
        return nestedNode;
      }
    }

    if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
      const nestedNode = findEditableNodeByIdInBlocks(block.metadata.blocks, nodeId);
      if (nestedNode) {
        return nestedNode;
      }
    }
  }

  return null;
}

function findEditableNodeTextRunsInBlocks(blocks: LayoutBlock[], nodeId: string): TextRun[] | null {
  for (const block of blocks) {
    if (block.id === nodeId) {
      return block.textRuns;
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      const matchedItem = block.metadata.items.find((item) => item.id === nodeId);
      if (matchedItem) {
        return matchedItem.textRuns;
      }
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      for (const row of block.metadata.rows) {
        const matchedCell = row.cells.find((cell) => cell.id === nodeId);
        if (matchedCell) {
          return matchedCell.textRuns;
        }
      }
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      const nestedRuns = findEditableNodeTextRunsInBlocks(block.metadata.blocks, nodeId);
      if (nestedRuns) {
        return nestedRuns;
      }
    }

    if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
      const nestedRuns = findEditableNodeTextRunsInBlocks(block.metadata.blocks, nodeId);
      if (nestedRuns) {
        return nestedRuns;
      }
    }
  }

  return null;
}

function createSelectableBlockProps(
  block: LayoutBlock,
  semanticRoleConfig: LayoutSemanticRoleConfig | undefined,
  selectedNodeId: string | null,
  onSelectNode: (nodeId: string) => void,
  onPrepareSelectNode: (nodeId: string) => void,
  onStartEditing: (node: EditableCanvasNode) => void,
  className = '',
  selectedBlockIds: string[] = [],
  onSelectBlock?: (blockId: string, extendRange: boolean) => void,
) {
  const semanticPresentation = getSemanticRolePresentation(block, semanticRoleConfig);
  const semanticPresetPresentation = getSemanticBlockPresetPresentation(block, semanticRoleConfig);
  const isBlockRangeSelected = selectedBlockIds.includes(block.id);
  const selectBlockOrNode = (extendRange: boolean) => {
    if (onSelectBlock) {
      onSelectBlock(block.id, extendRange);
      return;
    }

    onSelectNode(block.id);
  };
  const classNames = [
    'selectable-layout-block',
    className,
    buildSemanticPresetClassName(block, semanticRoleConfig),
    buildSemanticClassName(block),
    block.id === selectedNodeId ? 'selected' : '',
    isBlockRangeSelected ? 'block-range-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    className: classNames,
    'data-layout-node-id': block.id,
    'data-source-node-id': getLayoutBlockSourceNodeId(block),
    ...(semanticPresetPresentation ? { 'data-semantic-preset': semanticPresetPresentation.presetId } : {}),
    ...(block.semantic?.roleId ? { 'data-semantic-role': block.semantic.roleId } : {}),
    ...(semanticPresentation ? { 'data-semantic-label': semanticPresentation.label } : {}),
    onMouseDown: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onPrepareSelectNode(block.id);
      if (event.detail >= 2) {
        event.preventDefault();
        selectBlockOrNode(false);
        const editableNode = getEditableBlockNode(block);
        // 第二次按下鼠标时就进入编辑态，避免缩放画布中 dblclick 事件偶发漏触发。
        if (editableNode) {
          onStartEditing(editableNode);
        }
      }
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      if (event.detail >= 2) {
        return;
      }

      selectBlockOrNode(event.shiftKey);
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      selectBlockOrNode(false);
      const editableNode = getEditableBlockNode(block);
      if (editableNode) {
        onStartEditing(editableNode);
      }
    },
  };
}

function createSelectableEquationBlockProps({
  block,
  semanticRoleConfig,
  selectedNodeId,
  selectedBlockIds = [],
  editingNodeId,
  onSelectNode,
  onSelectBlock,
  onPrepareSelectNode,
  onStartEditing,
}: {
  block: LayoutBlock;
  semanticRoleConfig?: LayoutSemanticRoleConfig;
  selectedNodeId: string | null;
  selectedBlockIds?: string[];
  editingNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onSelectBlock?: (blockId: string, extendRange: boolean) => void;
  onPrepareSelectNode: (nodeId: string) => void;
  onStartEditing: (node: EditableCanvasNode) => void;
}) {
  const semanticPresentation = getSemanticRolePresentation(block, semanticRoleConfig);
  const semanticPresetPresentation = getSemanticBlockPresetPresentation(block, semanticRoleConfig);
  const isBlockRangeSelected = selectedBlockIds.includes(block.id);
  const selectBlockOrNode = (extendRange: boolean) => {
    if (onSelectBlock) {
      onSelectBlock(block.id, extendRange);
      return;
    }

    onSelectNode(block.id);
  };
  const classNames = [
    'selectable-layout-block',
    'equation-shell',
    buildSemanticPresetClassName(block, semanticRoleConfig),
    buildSemanticClassName(block),
    block.id === selectedNodeId ? 'selected' : '',
    isBlockRangeSelected ? 'block-range-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    className: classNames,
    'data-layout-node-id': block.id,
    ...(semanticPresetPresentation ? { 'data-semantic-preset': semanticPresetPresentation.presetId } : {}),
    ...(block.semantic?.roleId ? { 'data-semantic-role': block.semantic.roleId } : {}),
    ...(semanticPresentation ? { 'data-semantic-label': semanticPresentation.label } : {}),
    onMouseDown: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onPrepareSelectNode(block.id);
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      selectBlockOrNode(event.shiftKey);
      if (event.shiftKey || editingNodeId === block.id) {
        return;
      }

      const editableNode = getEditableBlockNode(block);
      if (editableNode) {
        onStartEditing(editableNode);
      }
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onSelectNode(block.id);
      const editableNode = getEditableBlockNode(block);
      if (editableNode) {
        onStartEditing(editableNode);
      }
    },
  };
}

type SemanticRoleLabelVariant = 'inline' | 'block';

function renderSemanticRoleLabel(
  block: LayoutBlock,
  semanticRoleConfig?: LayoutSemanticRoleConfig,
  variant: SemanticRoleLabelVariant = 'block',
): ReactNode {
  const semanticPresentation = getSemanticRolePresentation(block, semanticRoleConfig);
  if (!semanticPresentation) {
    return null;
  }

  const className = `semantic-role-label semantic-role-label-${variant}`;
  if (variant === 'inline') {
    return (
      <span
        className={className}
        data-semantic-label={semanticPresentation.label}
        data-measure-skip="true"
        aria-hidden="true"
      >
        {semanticPresentation.label}
      </span>
    );
  }

  return (
    <div
      className={className}
      data-semantic-label={semanticPresentation.label}
      data-measure-skip="true"
      aria-hidden="true"
    >
      {semanticPresentation.label}
    </div>
  );
}

function renderMeasuredTextBlockContent(
  nodeId: string,
  content: ReactNode,
  isEditing: boolean,
): ReactNode {
  if (isEditing) {
    return content;
  }

  return (
    <span
      className="semantic-text-content"
      data-measure-text-node-id={nodeId}
    >
      {content}
    </span>
  );
}

function renderSemanticListBlock(
  key: string,
  selectableProps: ReturnType<typeof createSelectableBlockProps>,
  blockStyle: CSSProperties,
  semanticRoleLabel: ReactNode,
  listContent: ReactNode,
): JSX.Element {
  return (
    <div
      key={key}
      {...selectableProps}
      className={`${selectableProps.className} semantic-list-shell`.trim()}
      style={blockStyle}
    >
      {semanticRoleLabel}
      {listContent}
    </div>
  );
}

function createSelectableTextNodeProps({
  node,
  selectedNodeId,
  onSelectNode,
  onPrepareSelectNode,
  onStartEditing,
  className = '',
}: {
  node: EditableCanvasNode;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onPrepareSelectNode: (nodeId: string) => void;
  onStartEditing: (node: EditableCanvasNode) => void;
  className?: string;
}) {
  const classNames = ['selectable-layout-node', className, node.id === selectedNodeId ? 'selected' : '']
    .filter(Boolean)
    .join(' ');

  return {
    className: classNames,
    'data-layout-node-id': node.id,
    onMouseDown: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onPrepareSelectNode(node.id);
      if (event.detail >= 2) {
        event.preventDefault();
        onSelectNode(node.id);
        // 列表项和表格单元格也使用同一套双击兜底，保证后续选区浮动条能稳定触发。
        onStartEditing(node);
      }
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onSelectNode(node.id);
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onSelectNode(node.id);
      onStartEditing(node);
    },
  };
}

function createSelectableTableCellProps({
  node,
  selectedNodeId,
  tableSelection,
  onSelectTableCell,
  onPrepareSelectNode,
  onStartEditing,
  className = '',
}: {
  node: EditableCanvasNode;
  selectedNodeId: string | null;
  tableSelection: TableCellRangeSelection | null | undefined;
  onSelectTableCell: (cellId: string, extendRange: boolean) => void;
  onPrepareSelectNode: (nodeId: string) => void;
  onStartEditing: (node: EditableCanvasNode) => void;
  className?: string;
}) {
  const isActiveRangeCell = isTableCellInRangeSelection(tableSelection, node.id);
  const classNames = [
    'selectable-layout-node',
    className,
    node.id === selectedNodeId ? 'selected' : '',
    isActiveRangeCell ? 'table-cell-range-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const selectCell = (event: MouseEvent<HTMLElement>) => {
    onSelectTableCell(node.id, event.shiftKey);
  };

  return {
    className: classNames,
    'data-layout-node-id': node.id,
    onMouseDown: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onPrepareSelectNode(node.id);
      if (event.detail >= 2) {
        event.preventDefault();
        selectCell(event);
        onStartEditing(node);
      }
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      selectCell(event);
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      selectCell(event);
      onStartEditing(node);
    },
  };
}

function getEditorClassName(kind: CanvasEditorKind): string {
  const classNames = ['canvas-block-editor', `canvas-block-editor-${kind}`];
  if (kind === 'code') {
    classNames.push('canvas-block-editor-code');
  }

  return classNames.join(' ');
}

function resizeCanvasEditor(editor: HTMLTextAreaElement): void {
  editor.style.height = 'auto';
  editor.style.height = `${editor.scrollHeight}px`;
}

function createCanvasScrollSnapshot(canvasPane: HTMLElement | null): CanvasScrollSnapshot | null {
  if (!canvasPane) {
    return null;
  }

  return {
    top: canvasPane.scrollTop,
    left: canvasPane.scrollLeft,
  };
}

function restoreCanvasScrollSnapshot(
  canvasPane: HTMLElement | null,
  snapshot: CanvasScrollSnapshot | null,
): void {
  if (!canvasPane || !snapshot) {
    return;
  }

  canvasPane.scrollTop = snapshot.top;
  canvasPane.scrollLeft = snapshot.left;
}

function restoreCanvasScrollSnapshotSoon(
  canvasPane: HTMLElement | null,
  snapshot: CanvasScrollSnapshot | null,
): void {
  restoreCanvasScrollSnapshot(canvasPane, snapshot);
  window.requestAnimationFrame(() => restoreCanvasScrollSnapshot(canvasPane, snapshot));
}

function focusCanvasEditorWithoutScroll(
  editor: HTMLElement,
  canvasPane: HTMLElement | null,
  snapshot: CanvasScrollSnapshot | null,
): void {
  try {
    editor.focus({ preventScroll: true });
  } catch {
    editor.focus();
  }

  // 双击进入编辑时，浏览器会尝试把新焦点滚到可见区；这里把画布滚动位置拉回用户双击前的位置。
  restoreCanvasScrollSnapshotSoon(canvasPane, snapshot);
}

function findCanvasScrollContainer(element: HTMLElement | null): HTMLElement | null {
  return element?.closest('.canvas-pane-scroll') as HTMLElement | null;
}

function isRichTextCanvasEditorKind(kind: CanvasEditorKind): boolean {
  return (
    kind === 'heading' ||
    kind === 'paragraph' ||
    kind === 'code' ||
    kind === 'listItem' ||
    kind === 'tableCell'
  );
}

function buildTextRunStyleString(run: TextRun): string {
  const declarations = [
    run.styleOverrides.color ? `color:${run.styleOverrides.color}` : '',
    run.styleOverrides.highlightColor
      ? `background-color:${run.styleOverrides.highlightColor}`
      : run.styleOverrides.backgroundColor
        ? `background-color:${run.styleOverrides.backgroundColor}`
        : '',
    run.marks.some((mark) => mark.type === 'italic') ? 'font-style:italic' : '',
    run.styleOverrides.fontFamily ? `font-family:${run.styleOverrides.fontFamily}` : '',
    run.styleOverrides.fontSize ? `font-size:${run.styleOverrides.fontSize}px` : '',
    run.styleOverrides.letterSpacing ? `letter-spacing:${run.styleOverrides.letterSpacing}px` : '',
  ].filter(Boolean);

  return declarations.length > 0 ? ` style="${declarations.join(';')}"` : '';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderTextRunsToHtml(textRuns: TextRun[]): string {
  const applyRunMarks = (content: string, marks: TextMark[]): string =>
    marks.reduce((currentHtml, mark) => {
      switch (mark.type) {
        case 'bold':
          return `<strong>${currentHtml}</strong>`;
        case 'italic':
          return `<em>${currentHtml}</em>`;
        case 'underline':
          return `<u>${currentHtml}</u>`;
        case 'strike':
          return `<s>${currentHtml}</s>`;
        case 'code':
          return `<code>${currentHtml}</code>`;
        case 'link':
          return `<a href="${escapeHtml(mark.href ?? '#')}" target="_blank" rel="noreferrer">${currentHtml}</a>`;
        default:
          return currentHtml;
      }
    }, content);

  const renderFragment = (fragment: { type: 'text' | 'equation'; content: string }, marks: TextMark[]): string => {
    if (fragment.type === 'equation') {
      // 行内公式：不应用 marks，直接渲染
      return renderInlineEquationToHtml(fragment.content);
    }
    // 普通文本：HTML 转义 + 处理换行 + 应用 marks
    const escaped = escapeHtml(fragment.content).replaceAll('\n', '<br data-layout-break="1" />');
    return applyRunMarks(escaped, marks);
  };

  return textRuns
    .map((run) => {
      const fragments = splitInlineEquations(run.text);
      const content = fragments.map((fragment) => renderFragment(fragment, run.marks)).join('');
      return `<span data-layout-run-id="${run.id}"${buildTextRunStyleString(run)}>${content}</span>`;
    })
    .join('');
}

function createDraftRun(nodeId: string, index: number, text: string, marks: TextMark[], styleOverrides: TextStyleOverrides): TextRun {
  return {
    id: `${nodeId}-draft-run-${index + 1}-${createTextFragment(text, 'text')}`,
    text,
    sourceRange: null,
    marks,
    charStyleRef: null,
    styleOverrides,
    annotations: [],
  };
}

function parseInlineStyles(element: HTMLElement, inheritedStyles: TextStyleOverrides): TextStyleOverrides {
  const nextStyles: TextStyleOverrides = { ...inheritedStyles };

  if (element.style.color) {
    nextStyles.color = element.style.color;
  }
  if (element.style.backgroundColor) {
    nextStyles.highlightColor = element.style.backgroundColor;
  }
  if (element.style.fontFamily) {
    nextStyles.fontFamily = element.style.fontFamily;
  }
  if (element.style.fontSize) {
    const fontSize = Number.parseFloat(element.style.fontSize);
    if (Number.isFinite(fontSize)) {
      nextStyles.fontSize = fontSize;
    }
  }
  if (element.style.letterSpacing) {
    const letterSpacing = Number.parseFloat(element.style.letterSpacing);
    if (Number.isFinite(letterSpacing)) {
      nextStyles.letterSpacing = letterSpacing;
    }
  }

  return nextStyles;
}

function ensureUniqueMarks(marks: TextMark[]): TextMark[] {
  const seen = new Set<string>();
  return marks.filter((mark) => {
    const key = JSON.stringify(mark);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function trimTrailingBreakRuns(textRuns: TextRun[]): TextRun[] {
  const nextRuns = [...textRuns];

  while (nextRuns.length > 0) {
    const lastRun = nextRuns[nextRuns.length - 1];
    if (!lastRun.text.endsWith('\n')) {
      break;
    }

    const trimmedText = lastRun.text.replace(/\n+$/g, '');
    if (trimmedText) {
      nextRuns[nextRuns.length - 1] = {
        ...lastRun,
        text: trimmedText,
      };
      break;
    }

    nextRuns.pop();
  }

  return nextRuns;
}

function extractTextRunsFromRichRoot(root: HTMLElement, nodeId: string): TextRun[] {
  const collectedRuns: TextRun[] = [];

  const walk = (
    node: Node,
    activeMarks: TextMark[],
    activeStyles: TextStyleOverrides,
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.replace(/\u00A0/g, ' ') ?? '';
      if (!text) {
        return;
      }

      collectedRuns.push(
        createDraftRun(
          nodeId,
          collectedRuns.length,
          text,
          ensureUniqueMarks(activeMarks),
          activeStyles,
        ),
      );
      return;
    }

    if (!(node instanceof HTMLElement)) {
      return;
    }

    const tagName = node.tagName.toLowerCase();
    if (tagName === 'br') {
      collectedRuns.push(
        createDraftRun(nodeId, collectedRuns.length, '\n', ensureUniqueMarks(activeMarks), activeStyles),
      );
      return;
    }

    const nextMarks = [...activeMarks];
    if (tagName === 'strong' || tagName === 'b') {
      nextMarks.push({ type: 'bold' });
    } else if (tagName === 'em' || tagName === 'i') {
      nextMarks.push({ type: 'italic' });
    } else if (tagName === 'u') {
      nextMarks.push({ type: 'underline' });
    } else if (tagName === 's' || tagName === 'strike' || tagName === 'del') {
      nextMarks.push({ type: 'strike' });
    } else if (tagName === 'code') {
      nextMarks.push({ type: 'code' });
    } else if (tagName === 'a') {
      nextMarks.push({ type: 'link', href: node.getAttribute('href') ?? '#' });
    }

    const nextStyles = parseInlineStyles(node, activeStyles);

    Array.from(node.childNodes).forEach((childNode) => walk(childNode, nextMarks, nextStyles));

    if ((tagName === 'div' || tagName === 'p') && node !== root) {
      collectedRuns.push(
        createDraftRun(nodeId, collectedRuns.length, '\n', ensureUniqueMarks(activeMarks), activeStyles),
      );
    }
  };

  Array.from(root.childNodes).forEach((childNode) => walk(childNode, [], {}));

  return trimTrailingBreakRuns(mergeAdjacentTextRuns(collectedRuns));
}

function getVisualTextRunSignature(textRuns: TextRun[]): string {
  return JSON.stringify(
    textRuns.map((run) => ({
      text: run.text,
      marks: run.marks,
      styleOverrides: run.styleOverrides,
    })),
  );
}

function areTextRunsVisuallyEqual(left: TextRun[], right: TextRun[]): boolean {
  return getVisualTextRunSignature(left) === getVisualTextRunSignature(right);
}

function isBlockBreakElement(element: HTMLElement, root: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();
  return (tagName === 'div' || tagName === 'p') && element !== root;
}

// 富文本编辑器把 TextRun 里的 \n 渲染成 <br>，选区换算时也必须把 <br> 当成 1 个字符。
function getRichNodeTextLength(node: Node, root: HTMLElement): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.replace(/\u00A0/g, ' ').length ?? 0;
  }

  if (!(node instanceof HTMLElement)) {
    return 0;
  }

  if (node.tagName.toLowerCase() === 'br') {
    return 1;
  }

  const childLength = Array.from(node.childNodes).reduce(
    (total, childNode) => total + getRichNodeTextLength(childNode, root),
    0,
  );
  return childLength + (isBlockBreakElement(node, root) ? 1 : 0);
}

function findSelectionPoint(root: HTMLElement, targetOffset: number): { node: Node; offset: number } {
  let traversed = 0;

  const walk = (parent: Node): { node: Node; offset: number } | null => {
    const childNodes = Array.from(parent.childNodes);

    for (let index = 0; index < childNodes.length; index += 1) {
      const childNode = childNodes[index];

      if (childNode.nodeType === Node.TEXT_NODE) {
        const nodeText = childNode.textContent?.replace(/\u00A0/g, ' ') ?? '';
        const nextTraversed = traversed + nodeText.length;
        if (targetOffset <= nextTraversed) {
          return {
            node: childNode,
            offset: Math.max(0, Math.min(nodeText.length, targetOffset - traversed)),
          };
        }

        traversed = nextTraversed;
        continue;
      }

      if (!(childNode instanceof HTMLElement)) {
        continue;
      }

      const tagName = childNode.tagName.toLowerCase();
      if (tagName === 'br') {
        if (targetOffset <= traversed) {
          return { node: parent, offset: index };
        }

        const nextTraversed = traversed + 1;
        if (targetOffset <= nextTraversed) {
          return { node: parent, offset: index + 1 };
        }

        traversed = nextTraversed;
        continue;
      }

      const nestedPoint = walk(childNode);
      if (nestedPoint) {
        return nestedPoint;
      }

      if (isBlockBreakElement(childNode, root)) {
        const nextTraversed = traversed + 1;
        if (targetOffset <= nextTraversed) {
          return { node: parent, offset: index + 1 };
        }

        traversed = nextTraversed;
      }
    }

    return null;
  };

  return walk(root) ?? {
    node: root,
    offset: root.childNodes.length,
  };
}

function restoreRichSelection(root: HTMLElement, selection: TextRangeSelection | null): void {
  if (!selection) {
    return;
  }

  const domSelection = window.getSelection();
  if (!domSelection) {
    return;
  }

  const range = document.createRange();
  const startPoint = findSelectionPoint(root, selection.start);
  const endPoint = findSelectionPoint(root, selection.end);
  const canvasPane = findCanvasScrollContainer(root);
  const scrollSnapshot = createCanvasScrollSnapshot(canvasPane);
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  domSelection.removeAllRanges();
  domSelection.addRange(range);
  restoreCanvasScrollSnapshotSoon(canvasPane, scrollSnapshot);
}

function measureSelectionOffset(root: HTMLElement, targetNode: Node, targetOffset: number): number {
  let traversed = 0;
  let isDone = false;

  const walk = (node: Node) => {
    if (isDone) {
      return;
    }

    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        const nodeText = node.textContent?.replace(/\u00A0/g, ' ') ?? '';
        traversed += Math.max(0, Math.min(nodeText.length, targetOffset));
        isDone = true;
        return;
      }

      if (node instanceof HTMLElement) {
        const childNodes = Array.from(node.childNodes).slice(0, targetOffset);
        traversed += childNodes.reduce((total, childNode) => total + getRichNodeTextLength(childNode, root), 0);
        isDone = true;
      }
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      traversed += node.textContent?.replace(/\u00A0/g, ' ').length ?? 0;
      return;
    }

    if (!(node instanceof HTMLElement)) {
      return;
    }

    if (node.tagName.toLowerCase() === 'br') {
      traversed += 1;
      return;
    }

    Array.from(node.childNodes).forEach((childNode) => walk(childNode));

    if (!isDone && isBlockBreakElement(node, root)) {
      traversed += 1;
    }
  };

  walk(root);
  return traversed;
}

function getRichSelection(root: HTMLElement): TextRangeSelection | null {
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) {
    return null;
  }

  const range = domSelection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }

  return {
    start: measureSelectionOffset(root, range.startContainer, range.startOffset),
    end: measureSelectionOffset(root, range.endContainer, range.endOffset),
  };
}

function getRichSelectionClientRect(root: HTMLElement): DOMRect | null {
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) {
    return null;
  }

  const range = domSelection.getRangeAt(0);
  if (
    range.collapsed ||
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return null;
  }

  const rangeRect = range.getBoundingClientRect();
  if (rangeRect.width > 0 || rangeRect.height > 0) {
    return rangeRect;
  }

  const clientRects = range.getClientRects();
  return clientRects.length > 0 ? clientRects[0] : null;
}

function escapeDataAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function RichTextCanvasEditor({
  nodeId,
  kind,
  textRuns,
  activeSelection,
  richEditorRef,
  onSelectionChange,
  onDraftChange,
  onCommit,
  onCancel,
}: {
  nodeId: string;
  kind: CanvasEditorKind;
  textRuns: TextRun[];
  activeSelection: TextRangeSelection | null;
  richEditorRef: MutableRefObject<HTMLDivElement | null>;
  onSelectionChange: (selection: TextRangeSelection | null) => void;
  onDraftChange: (textRuns: TextRun[]) => void;
  onCommit: () => void;
  onCancel: () => void;
}): JSX.Element {
  const lastRenderedHtmlRef = useRef('');

  useLayoutEffect(() => {
    const editor = richEditorRef.current;
    if (!editor) {
      return;
    }

    const nextHtml = renderTextRunsToHtml(textRuns);
    if (document.activeElement === editor) {
      const currentRuns = extractTextRunsFromRichRoot(editor, nodeId);
      if (areTextRunsVisuallyEqual(currentRuns, textRuns)) {
        lastRenderedHtmlRef.current = editor.innerHTML;
        return;
      }
    }

    if (lastRenderedHtmlRef.current === nextHtml && editor.innerHTML === nextHtml) {
      return;
    }

    const canvasPane = findCanvasScrollContainer(editor);
    const scrollSnapshot = createCanvasScrollSnapshot(canvasPane);
    editor.innerHTML = nextHtml;
    lastRenderedHtmlRef.current = nextHtml;
    restoreRichSelection(editor, activeSelection);
    restoreCanvasScrollSnapshotSoon(canvasPane, scrollSnapshot);
  }, [activeSelection, nodeId, richEditorRef, textRuns]);

  const syncSelectionFromEditor = (editor: HTMLElement) => {
    const nextSelection = getRichSelection(editor);
    if (!isSameTextSelection(activeSelection, nextSelection)) {
      onSelectionChange(nextSelection);
    }
  };

  useEffect(() => {
    const editor = richEditorRef.current;
    if (!editor) {
      return;
    }

    const syncSelectionFromDocument = () => {
      const nextSelection = getRichSelection(editor);
      const isEditorActive = document.activeElement === editor;
      // 浏览器拖选、Shift 选区和部分输入法场景不一定触发 mouseup/keyUp，这里兜底同步当前编辑器选区。
      if ((nextSelection || isEditorActive) && !isSameTextSelection(activeSelection, nextSelection)) {
        onSelectionChange(nextSelection);
      }
    };

    document.addEventListener('selectionchange', syncSelectionFromDocument);

    return () => {
      document.removeEventListener('selectionchange', syncSelectionFromDocument);
    };
  }, [activeSelection, onSelectionChange, richEditorRef]);

  const handleInput = (event: FormEvent<HTMLDivElement>) => {
    const nextRuns = extractTextRunsFromRichRoot(event.currentTarget, nodeId);
    lastRenderedHtmlRef.current = event.currentTarget.innerHTML;
    onDraftChange(nextRuns);
    syncSelectionFromEditor(event.currentTarget);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onCommit();
      return;
    }

    if (kind === 'listItem' && event.key === 'Tab') {
      event.preventDefault();
      onCommit();
    }
  };

  const editorClassName = [
    'canvas-rich-editor',
    `canvas-rich-editor-${kind}`,
    kind === 'code' ? 'canvas-rich-editor-code' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (kind === 'code') {
    return (
      <div
        ref={richEditorRef}
        className={editorClassName}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={onCommit}
        onKeyDown={handleKeyDown}
        onFocus={(event) => syncSelectionFromEditor(event.currentTarget)}
        onMouseDown={(event) => event.stopPropagation()}
        onMouseUp={(event) => syncSelectionFromEditor(event.currentTarget)}
        onKeyUp={(event) => syncSelectionFromEditor(event.currentTarget)}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      />
    );
  }

  return (
    <span
      ref={richEditorRef}
      className={editorClassName}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onBlur={onCommit}
      onKeyDown={handleKeyDown}
      onFocus={(event) => syncSelectionFromEditor(event.currentTarget)}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => syncSelectionFromEditor(event.currentTarget)}
      onKeyUp={(event) => syncSelectionFromEditor(event.currentTarget)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}

function renderBlockEditor({
  kind,
  editorRef,
  editingText,
  onChange,
  onSelectionChange,
  onCommit,
  onCancel,
}: {
  kind: CanvasEditorKind;
  editorRef: RefObject<HTMLTextAreaElement>;
  editingText: string;
  onChange: (text: string) => void;
  onSelectionChange: (selection: TextRangeSelection | null) => void;
  onCommit: () => void;
  onCancel: () => void;
}): JSX.Element {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onCommit();
    }
  };

  return (
    <textarea
      ref={editorRef}
      className={getEditorClassName(kind)}
      value={editingText}
      rows={1}
      aria-label="画布文字编辑"
      onChange={(event) => onChange(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onSelect={(event) =>
        onSelectionChange({
          start: event.currentTarget.selectionStart ?? 0,
          end: event.currentTarget.selectionEnd ?? 0,
        })
      }
      onMouseUp={(event) =>
        onSelectionChange({
          start: event.currentTarget.selectionStart ?? 0,
          end: event.currentTarget.selectionEnd ?? 0,
        })
      }
      onKeyUp={(event) =>
        onSelectionChange({
          start: event.currentTarget.selectionStart ?? 0,
          end: event.currentTarget.selectionEnd ?? 0,
        })
      }
      onKeyDown={handleKeyDown}
      onBlur={onCommit}
    />
  );
}

function EquationEditorOverlay({
  nodeId,
  initialText,
  scrollContainerRef,
  onCommitAndClose,
}: {
  nodeId: string;
  initialText: string;
  scrollContainerRef: RefObject<HTMLElement>;
  onCommitAndClose: (payload: { nodeId: string; text: string; didChange: boolean }) => void;
}): JSX.Element {
  const [draftText, setDraftText] = useState(initialText);
  const [draftSelection, setDraftSelection] = useState<TextRangeSelection | null>({
    start: initialText.length,
    end: initialText.length,
  });
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const openFrameRef = useRef<number | null>(null);
  const renderResult = renderEquationToHtml(draftText);

  useEffect(() => {
    openFrameRef.current = window.requestAnimationFrame(() => {
      setIsVisible(true);
    });

    return () => {
      if (openFrameRef.current !== null) {
        window.cancelAnimationFrame(openFrameRef.current);
      }
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const scrollSnapshot = createCanvasScrollSnapshot(scrollContainerRef.current);
    focusCanvasEditorWithoutScroll(editor, scrollContainerRef.current, scrollSnapshot);
    editor.setSelectionRange(initialText.length, initialText.length);
    restoreCanvasScrollSnapshot(scrollContainerRef.current, scrollSnapshot);
  }, [isVisible, initialText, scrollContainerRef]);

  const syncSelection = (editor: HTMLTextAreaElement) => {
    setDraftSelection({
      start: editor.selectionStart ?? 0,
      end: editor.selectionEnd ?? 0,
    });
  };

  const requestCloseWithCommit = () => {
    if (isClosing) {
      return;
    }

    setIsClosing(true);
    setIsVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      onCommitAndClose({
        nodeId,
        text: draftText,
        didChange: draftText !== initialText,
      });
    }, equationEditorAnimationDurationMs);
  };

  const insertTemplate = (templateValue: string) => {
    const editor = editorRef.current;
    const selectionStart = editor?.selectionStart ?? draftSelection?.start ?? draftText.length;
    const selectionEnd = editor?.selectionEnd ?? draftSelection?.end ?? draftText.length;
    const nextText = `${draftText.slice(0, selectionStart)}${templateValue}${draftText.slice(selectionEnd)}`;
    const nextCursor = selectionStart + templateValue.length;

    setDraftText(nextText);
    setDraftSelection({ start: nextCursor, end: nextCursor });

    window.requestAnimationFrame(() => {
      if (!editorRef.current) {
        return;
      }

      try {
        editorRef.current.focus({ preventScroll: true });
      } catch {
        editorRef.current.focus();
      }
      editorRef.current.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestCloseWithCommit();
      return;
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      requestCloseWithCommit();
    }
  };

  return (
    <div
      className={isVisible ? 'equation-editor-modal equation-editor-modal-visible' : 'equation-editor-modal'}
      role="dialog"
      aria-modal="true"
      aria-label="公式编辑"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        requestCloseWithCommit();
      }}
    >
      <div
        className="equation-editor-popover"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="equation-editor-modal-head">
          <div className="equation-editor-modal-title">
            <strong>公式编辑</strong>
            <span>{renderResult.error ? '当前公式解析失败' : '当前公式解析正常'}</span>
          </div>
          <button
            type="button"
            className="equation-editor-close"
            aria-label="关闭公式编辑弹窗"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={requestCloseWithCommit}
          >
            <X size={16} />
          </button>
        </div>
        <div className="equation-editor-main">
          <section className="equation-editor-section">
            <div className="equation-editor-head">
              <strong>LaTeX 语法</strong>
              <span>Esc 或 Ctrl + Enter 保存并关闭</span>
            </div>
            <textarea
              ref={editorRef}
              className="canvas-block-editor canvas-block-editor-equation equation-editor-source-input"
              value={draftText}
              rows={10}
              aria-label="公式源码编辑"
              onChange={(event) => {
                setDraftText(event.target.value);
                syncSelection(event.currentTarget);
              }}
              onFocus={(event) => syncSelection(event.currentTarget)}
              onMouseDown={(event) => event.stopPropagation()}
              onSelect={(event) => syncSelection(event.currentTarget)}
              onMouseUp={(event) => syncSelection(event.currentTarget)}
              onKeyUp={(event) => syncSelection(event.currentTarget)}
              onKeyDown={handleKeyDown}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            />
          </section>
          <section className="equation-editor-section">
            <div className="equation-editor-head">
              <strong>实时预览</strong>
              <span>{renderResult.error ? '解析失败' : '解析正常'}</span>
            </div>
            <div className="equation-editor-preview">
              <div className="equation-preview" dangerouslySetInnerHTML={{ __html: renderResult.html }} />
            </div>
          </section>
        </div>
        <section className="equation-editor-section">
          <div className="equation-editor-head">
            <strong>骨架内容</strong>
            <span>点击后直接插入当前公式源码</span>
          </div>
          <div className="equation-editor-template-list">
            {formulaTemplateGroups.map((group) => (
              <section key={group.id} className="equation-template-group">
                <strong>{group.label}</strong>
                <div className="equation-template-grid">
                  {group.templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className="equation-template-item"
                      title={`${template.label}：${template.preview}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={() => insertTemplate(template.value)}
                    >
                      <span>{template.label}</span>
                      <small>{template.preview}</small>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function renderBlock(
  block: LayoutBlock,
  index: number,
  selectedNodeId: string | null,
  selectedBlockIds: string[] = [],
  onSelectNode: (nodeId: string) => void,
  onSelectBlock: ((blockId: string, extendRange: boolean) => void) | undefined,
  onSelectTableCell: (cellId: string, extendRange: boolean) => void,
  onPrepareSelectNode: (nodeId: string) => void,
  editingNodeId: string | null,
  activeEquationEditorNodeId: string | null,
  editingKind: CanvasEditorKind | null,
  editingText: string,
  editingDraftTextRuns: TextRun[] | null,
  activeSelection: TextRangeSelection | null,
  onSelectionChange: (selection: TextRangeSelection | null) => void,
  editorRef: RefObject<HTMLTextAreaElement>,
  richEditorRef: MutableRefObject<HTMLDivElement | null>,
  onStartEditing: (node: EditableCanvasNode) => void,
  onEditTextChange: (text: string) => void,
  onEditDraftTextRunsChange: (textRuns: TextRun[]) => void,
  onCommitEdit: () => void,
  onCancelEdit: () => void,
  tocItems: TocItem[],
  onNavigateToNode?: (nodeId: string) => void,
  draftImageSizes?: Record<string, { widthPx: number | null; heightPx: number | null }>,
  draftImageCrops?: Record<string, ImageDraftCrop>,
  measuredImageVisibleSizes?: Record<string, ImageMeasuredVisibleSize>,
  onImageLoad?: () => void,
  onStartImageResize?: (
    event: MouseEvent<HTMLButtonElement>,
    block: LayoutBlock,
    pageScale: number,
  ) => void,
  onStartImageCrop?: (
    event: MouseEvent<HTMLButtonElement>,
    block: LayoutBlock,
    edge: ImageCropEdge,
    pageScale: number,
  ) => void,
  draftImageOffsets?: Record<string, ImageDraftOffset>,
  onStartImageDrag?: (
    event: MouseEvent<HTMLElement>,
    block: LayoutBlock,
    pageScale: number,
  ) => void,
  tableResizeState?: TableResizeRenderState,
  tableSelection?: TableCellRangeSelection | null,
  documentStyles?: LayoutStyleSheet,
  semanticRoleConfig?: LayoutSemanticRoleConfig,
  answerDisplayMode: AnswerDisplayMode = 'show',
  onListItemContextMenu?: (event: MouseEvent<HTMLElement>, itemId: string) => void,
  pageScale?: number,
  imageTextWrapBundle = false,
): JSX.Element | null {
  const inheritedTextStyle = resolveQuickTextStyleForBlock(block, documentStyles);
  const effectiveLineHeight = resolveBlockLineHeightStyle(
    block,
    tableResizeState?.pageContract,
    documentStyles,
  );
  const blockStyle = buildBlockStyle(block, effectiveLineHeight, tableResizeState?.pageContract, semanticRoleConfig);
  const semanticInlineRoleLabel = renderSemanticRoleLabel(block, semanticRoleConfig, 'inline');
  const semanticBlockRoleLabel = renderSemanticRoleLabel(block, semanticRoleConfig, 'block');
  const isEditing = editingNodeId === block.id;
  const getSelectableBlockProps = (className = '') =>
    createSelectableBlockProps(
      block,
      semanticRoleConfig,
      selectedNodeId,
      onSelectNode,
      onPrepareSelectNode,
      onStartEditing,
      className,
      selectedBlockIds,
      onSelectBlock,
    );
  const selectCurrentBlockOrNode = (extendRange: boolean) => {
    if (onSelectBlock) {
      onSelectBlock(block.id, extendRange);
      return;
    }

    onSelectNode(block.id);
  };

  switch (block.type) {
    case 'pageBreak':
      return (
        <div
          key={`page-break-${block.id}-${index}`}
          {...getSelectableBlockProps('page-break-marker')}
          aria-label="分页符"
        >
          <span className="page-break-marker-line" aria-hidden="true" />
          <span className="page-break-marker-label">分页符</span>
          <span className="page-break-marker-line" aria-hidden="true" />
        </div>
      );
    case 'columnBreak':
      return (
        <div
          key={`column-break-${block.id}-${index}`}
          {...getSelectableBlockProps('column-break-marker')}
          aria-label="分栏断点"
        >
          <span className="column-break-marker-line" aria-hidden="true" />
          <span className="column-break-marker-label">分栏断点</span>
          <span className="column-break-marker-line" aria-hidden="true" />
        </div>
      );
    case 'heading': {
      const depth = block.metadata.kind === 'heading' ? block.metadata.depth : 3;
      const headingClassName = shouldLayoutBlockSpanAllColumns(block, tableResizeState?.pageContract)
        ? 'column-span-all'
        : '';
      const content = isEditing
        ? isRichTextCanvasEditorKind(editingKind ?? 'heading')
          ? (
            <RichTextCanvasEditor
              nodeId={block.id}
              kind={editingKind ?? 'heading'}
              textRuns={editingDraftTextRuns ?? block.textRuns}
              activeSelection={activeSelection}
              richEditorRef={richEditorRef}
              onSelectionChange={onSelectionChange}
              onDraftChange={onEditDraftTextRunsChange}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
            />
          )
          : renderBlockEditor({
              editorRef,
              kind: editingKind ?? 'heading',
              editingText,
              onChange: onEditTextChange,
              onSelectionChange,
              onCommit: onCommitEdit,
              onCancel: onCancelEdit,
            })
        : renderTextRuns(block.textRuns, '空标题', inheritedTextStyle, answerDisplayMode);

      if (depth === 1) {
        return (
          <h1
            key={`${block.id}-${index}`}
            {...getSelectableBlockProps(headingClassName)}
            style={blockStyle}
          >
            {semanticInlineRoleLabel}
            {renderMeasuredTextBlockContent(block.id, content, isEditing)}
          </h1>
        );
      }

      if (depth === 2) {
        return (
          <h2
            key={`${block.id}-${index}`}
            {...getSelectableBlockProps(headingClassName)}
            style={blockStyle}
          >
            {semanticInlineRoleLabel}
            {renderMeasuredTextBlockContent(block.id, content, isEditing)}
          </h2>
        );
      }

      if (depth === 4) {
        return (
          <h4
            key={`${block.id}-${index}`}
            {...getSelectableBlockProps(headingClassName)}
            style={blockStyle}
          >
            {semanticInlineRoleLabel}
            {renderMeasuredTextBlockContent(block.id, content, isEditing)}
          </h4>
        );
      }

      return (
        <h3
          key={`${block.id}-${index}`}
          {...getSelectableBlockProps(headingClassName)}
          style={blockStyle}
        >
          {semanticInlineRoleLabel}
          {renderMeasuredTextBlockContent(block.id, content, isEditing)}
        </h3>
      );
    }
    case 'toc':
      if (block.metadata.kind !== 'toc') {
        return null;
      }

      {
        const visibleTocItems = getVisibleTocItemsForBlock(block, tocItems);

        return (
          <section
            key={`toc-${block.id}-${index}`}
            {...getSelectableBlockProps()}
            className="toc-block"
          >
            {semanticBlockRoleLabel}
            <div className="toc-block-title">{getTocBlockDisplayTitle(block)}</div>
            {visibleTocItems.length > 0 ? (
              <div className="toc-block-list">
                {visibleTocItems.map((item) => (
                  <button
                    key={`toc-entry-${block.id}-${item.id}`}
                    type="button"
                    className="toc-entry"
                    style={{ paddingLeft: `${item.depth > 1 ? (item.depth - 1) * 16 : 0}px` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onNavigateToNode?.(item.id);
                    }}
                  >
                    <span className="toc-entry-text">{item.text}</span>
                    <span className="toc-entry-dots" aria-hidden="true" />
                    <span className="toc-entry-page">{item.pageNumber ?? '-'}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="toc-empty-state">当前文档还没有符合当前目录层级的标题。</div>
            )}
          </section>
        );
      }
    case 'paragraph':
      return (
        <p
          key={`${block.id}-${index}`}
          {...getSelectableBlockProps()}
          style={blockStyle}
        >
          {semanticInlineRoleLabel}
          {renderMeasuredTextBlockContent(
            block.id,
            isEditing
              ? isRichTextCanvasEditorKind(editingKind ?? 'paragraph')
                ? (
                  <RichTextCanvasEditor
                    nodeId={block.id}
                    kind={editingKind ?? 'paragraph'}
                    textRuns={editingDraftTextRuns ?? block.textRuns}
                    activeSelection={activeSelection}
                    richEditorRef={richEditorRef}
                    onSelectionChange={onSelectionChange}
                    onDraftChange={onEditDraftTextRunsChange}
                    onCommit={onCommitEdit}
                    onCancel={onCancelEdit}
                  />
                )
                : renderBlockEditor({
                    editorRef,
                    kind: editingKind ?? 'paragraph',
                    editingText,
                    onChange: onEditTextChange,
                    onSelectionChange,
                    onCommit: onCommitEdit,
                    onCancel: onCancelEdit,
                  })
              : renderTextRuns(block.textRuns, '空文本块', inheritedTextStyle, answerDisplayMode),
            isEditing,
          )}
        </p>
      );
    case 'list': {
      if (block.metadata.kind !== 'list') {
        return null;
      }

      const ListTag = block.metadata.ordered ? 'ol' : 'ul';
      const compactChoiceLayout = resolveCompactChoiceListLayoutWithOptions(block.metadata.items, {
        allowSequenceFromAnyLabel: (block.metadata.runtimeSlice?.startIndex ?? 0) > 0,
      });
      const compactChoiceListStyle = compactChoiceLayout
        ? ({
            ['--choice-column-count' as string]: String(compactChoiceLayout.columns),
          } as CSSProperties)
        : undefined;

      if (compactChoiceLayout) {
        return renderSemanticListBlock(
          `list-${block.id}-${index}`,
          getSelectableBlockProps(),
          blockStyle,
          semanticBlockRoleLabel,
          (
            <ListTag
              className="choice-option-list"
              start={block.metadata.ordered ? block.metadata.start ?? 1 : undefined}
              style={compactChoiceListStyle}
            >
              {renderCompactChoiceListItems({
                block,
                answerDisplayMode,
                documentStyles,
                items: compactChoiceLayout.items,
                selectedNodeId,
                editingNodeId,
                editingKind,
                editingDraftTextRuns,
                editingText,
                activeSelection,
                richEditorRef,
                editorRef,
                onSelectNode,
                onPrepareSelectNode,
                onStartEditing,
                onSelectionChange,
                onEditDraftTextRunsChange,
                onEditTextChange,
                onCommitEdit,
                onCancelEdit,
                onListItemContextMenu: onListItemContextMenu ?? (() => undefined),
              })}
            </ListTag>
          ),
        );
      }

      const listTree = buildLayoutListTree(block.metadata.items);
      return renderSemanticListBlock(
        `list-${block.id}-${index}`,
        getSelectableBlockProps(),
        blockStyle,
        semanticBlockRoleLabel,
        (
          <ListTag
            start={block.metadata.ordered ? block.metadata.start ?? 1 : undefined}
          >
            {renderListTreeNodes({
              block,
              answerDisplayMode,
              documentStyles,
              nodes: listTree,
              selectedNodeId,
              editingNodeId,
              editingKind,
              editingDraftTextRuns,
              editingText,
              activeSelection,
              richEditorRef,
              editorRef,
              onSelectNode,
              onPrepareSelectNode,
              onStartEditing,
              onSelectionChange,
              onEditDraftTextRunsChange,
              onEditTextChange,
              onCommitEdit,
              onCancelEdit,
              onListItemContextMenu: onListItemContextMenu ?? (() => undefined),
              fallbackOrdered: block.metadata.ordered,
            })}
          </ListTag>
        ),
      );
    }
    case 'blockquote':
      return block.metadata.kind === 'blockquote' ? (
        <blockquote
          key={`blockquote-${block.id}-${index}`}
          {...getSelectableBlockProps('quote-block')}
          style={blockStyle}
        >
          {semanticBlockRoleLabel}
          {block.metadata.blocks.map((item, childIndex) =>
            renderBlock(
              item,
              childIndex,
              selectedNodeId,
              [],
              onSelectNode,
              undefined,
              onSelectTableCell,
              onPrepareSelectNode,
              editingNodeId,
              activeEquationEditorNodeId,
              editingKind,
              editingText,
              editingDraftTextRuns,
              activeSelection,
              onSelectionChange,
              editorRef,
              richEditorRef,
              onStartEditing,
              onEditTextChange,
              onEditDraftTextRunsChange,
              onCommitEdit,
              onCancelEdit,
              tocItems,
              onNavigateToNode,
              draftImageSizes,
              draftImageCrops,
              measuredImageVisibleSizes,
              onImageLoad,
              onStartImageResize,
              onStartImageCrop,
              draftImageOffsets,
              onStartImageDrag,
              tableResizeState,
              tableSelection,
              documentStyles,
              semanticRoleConfig,
              answerDisplayMode,
              onListItemContextMenu,
              pageScale,
            ),
          )}
        </blockquote>
      ) : null;
    case 'columnSection':
      if (block.metadata.kind !== 'columnSection') {
        return null;
      }

      {
        const sectionContract = tableResizeState?.pageContract
          ? resolveColumnSectionContract(tableResizeState.pageContract, block.metadata)
          : undefined;
        const sectionStyle = {
          ...blockStyle,
          ['--local-column-count' as string]: String(block.metadata.columnCount),
          ['--local-column-gap' as string]: `${sectionContract?.columnGapPx ?? block.metadata.columnGapMm * (96 / 25.4)}px`,
          ['--local-column-rule-width' as string]: block.metadata.divider ? '1px' : '0px',
          ['--local-column-rule-color' as string]: sectionContract?.themeTokens.bodyOutlineColor ?? '#e4ecf2',
        } as CSSProperties;

        return (
          <section
            key={`column-section-${block.id}-${index}`}
            {...getSelectableBlockProps('local-column-section')}
            style={sectionStyle}
          >
            {semanticBlockRoleLabel}
            <div className="local-column-flow">
              {block.metadata.blocks.map((item, childIndex) =>
                renderBlock(
                  item,
                  childIndex,
                  selectedNodeId,
                  [],
                  onSelectNode,
                  undefined,
                  onSelectTableCell,
                  onPrepareSelectNode,
                  editingNodeId,
                  activeEquationEditorNodeId,
                  editingKind,
                  editingText,
                  editingDraftTextRuns,
                  activeSelection,
                  onSelectionChange,
                  editorRef,
                  richEditorRef,
                  onStartEditing,
                  onEditTextChange,
                  onEditDraftTextRunsChange,
                  onCommitEdit,
                  onCancelEdit,
                  tocItems,
                  onNavigateToNode,
                  draftImageSizes,
                  draftImageCrops,
                  measuredImageVisibleSizes,
                  onImageLoad,
                  onStartImageResize,
                  onStartImageCrop,
                  draftImageOffsets,
                  onStartImageDrag,
                  sectionContract
                    ? tableResizeState
                      ? {
                          ...tableResizeState,
                          pageContract: sectionContract,
                        }
                      : { pageContract: sectionContract }
                    : tableResizeState,
                  tableSelection,
                  documentStyles,
                  semanticRoleConfig,
                  answerDisplayMode,
                  onListItemContextMenu,
                  pageScale,
                ),
              )}
            </div>
          </section>
        );
      }
    case 'code':
      return (
        <pre
          key={`code-${block.id}-${index}`}
          {...getSelectableBlockProps('code-block')}
          style={blockStyle}
        >
          {semanticBlockRoleLabel}
          <code>
            {isEditing
              ? isRichTextCanvasEditorKind(editingKind ?? 'code')
                ? (
                  <RichTextCanvasEditor
                    nodeId={block.id}
                    kind={editingKind ?? 'code'}
                    textRuns={editingDraftTextRuns ?? block.textRuns}
                    activeSelection={activeSelection}
                    richEditorRef={richEditorRef}
                    onSelectionChange={onSelectionChange}
                    onDraftChange={onEditDraftTextRunsChange}
                    onCommit={onCommitEdit}
                    onCancel={onCancelEdit}
                  />
                )
                : renderBlockEditor({
                    editorRef,
                    kind: editingKind ?? 'code',
                    editingText,
                    onChange: onEditTextChange,
                    onSelectionChange,
                    onCommit: onCommitEdit,
                    onCancel: onCancelEdit,
                  })
              : renderTextRuns(block.textRuns, '空代码块', inheritedTextStyle, answerDisplayMode)}
          </code>
        </pre>
      );
    case 'table':
      return (() => {
        if (block.metadata.kind !== 'table') {
          return null;
        }

        const tableRows = block.metadata.rows;
        const tableAlign = block.metadata.align;
        const columnCount = tableRows[0]?.cells.length ?? 0;
        const isRuntimeTableFragment = block.sourceRange === null && block.id.includes('-page-fragment-');
        const resolvedColumnWidths = resolveTableColumnWidths(
          tableResizeState?.draftTableColumnWidths?.[block.id] ?? block.metadata.columnWidthsPx,
          columnCount,
          tableResizeState?.pageContract?.singleColumnContentWidthPx ?? 640,
        );
        const shouldShowResizeHandles =
          block.id === selectedNodeId || isTableCellSelected(block, selectedNodeId);

        return (
          <div
            key={`table-${block.id}-${index}`}
            {...getSelectableBlockProps('table-shell')}
            style={blockStyle}
          >
            {semanticBlockRoleLabel}
            <table className="preview-table">
              <colgroup>
                {resolvedColumnWidths.map((width, columnIndex) => (
                  <col key={`${block.id}-col-${columnIndex + 1}`} style={{ width: `${width}px` }} />
                ))}
              </colgroup>
              <tbody>
                {tableRows.map((row, rowIndex) => {
                  const rowMinHeightPx =
                    tableResizeState?.draftTableRowHeights?.[row.id] ??
                    row.heightPx ??
                    getTableRowBaseHeightPx(row, rowIndex, tableResizeState?.pageContract);

                  return (
                    <tr
                      key={row.id}
                      data-measure-table-row-id={row.id}
                      style={{ height: `${rowMinHeightPx}px` }}
                    >
                      {row.cells.map((cell, cellIndex) => {
                        if (isCoveredTableCell(cell)) {
                          return null;
                        }

                        const cellNode = getEditableTableCellNode(cell);
                        const CellTag = cell.isHeader ? 'th' : 'td';
                        const columnAlign = tableAlign[cellIndex] ?? null;
                        const rowSpan = getTableCellRowSpan(cell);
                        const colSpan = getTableCellColSpan(cell);

                        return (
                          <CellTag
                            key={cell.id}
                            rowSpan={rowSpan > 1 ? rowSpan : undefined}
                            colSpan={colSpan > 1 ? colSpan : undefined}
                            style={{
                              ...(columnAlign ? { textAlign: columnAlign } : undefined),
                              width: `${resolvedColumnWidths[cellIndex] ?? 48}px`,
                              minWidth: `${resolvedColumnWidths[cellIndex] ?? 48}px`,
                              height: `${rowMinHeightPx}px`,
                            }}
                            {...createSelectableTableCellProps({
                              node: cellNode,
                              selectedNodeId,
                              tableSelection,
                              onSelectTableCell,
                              onPrepareSelectNode,
                              onStartEditing,
                            })}
                          >
                            <div className="table-cell-content" data-measure-text-node-id={cell.id}>
                              {editingNodeId === cell.id
                                ? isRichTextCanvasEditorKind(editingKind ?? 'tableCell')
                                  ? (
                                    <RichTextCanvasEditor
                                      nodeId={cell.id}
                                      kind={editingKind ?? 'tableCell'}
                                      textRuns={editingDraftTextRuns ?? cell.textRuns}
                                      activeSelection={activeSelection}
                                      richEditorRef={richEditorRef}
                                      onSelectionChange={onSelectionChange}
                                      onDraftChange={onEditDraftTextRunsChange}
                                      onCommit={onCommitEdit}
                                      onCancel={onCancelEdit}
                                    />
                                  )
                                  : renderBlockEditor({
                                      kind: editingKind ?? 'tableCell',
                                      editorRef,
                                      editingText,
                                      onChange: onEditTextChange,
                                      onSelectionChange,
                                      onCommit: onCommitEdit,
                                      onCancel: onCancelEdit,
                                    })
                                : renderTextRuns(
                                    cell.textRuns,
                                    isRuntimeTableFragment ? undefined : '空单元格',
                                    inheritedTextStyle,
                                    answerDisplayMode,
                                  )}
                            </div>
                            {shouldShowResizeHandles && cellIndex < row.cells.length - 1 && tableResizeState?.onStartTableColumnResize ? (
                              <button
                                type="button"
                                className="table-column-resize-handle"
                                aria-label="拖拽调整列宽"
                                title="拖拽调整列宽"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  tableResizeState.onStartTableColumnResize?.(
                                    event,
                                    block,
                                    cell.id,
                                    cellIndex,
                                    rowIndex,
                                    pageScale ?? 1,
                                  );
                                }}
                              />
                            ) : null}
                            {shouldShowResizeHandles && cellIndex === 0 && tableResizeState?.onStartTableRowResize ? (
                              <button
                                type="button"
                                className="table-row-resize-handle"
                                aria-label="拖拽调整行高"
                                title="拖拽调整行高"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  tableResizeState.onStartTableRowResize?.(
                                    event,
                                    block,
                                    cell.id,
                                    row.id,
                                    rowIndex,
                                    pageScale ?? 1,
                                  );
                                }}
                              />
                            ) : null}
                          </CellTag>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })();
    case 'image':
      if (block.metadata.kind !== 'image') {
        return null;
      }

      {
        const imageLayout = resolveImageLayoutWithDraft(
          block,
          draftImageSizes?.[block.id] ?? null,
          draftImageCrops?.[block.id] ?? null,
          draftImageOffsets?.[block.id] ?? null,
        );
        if (!imageLayout) {
          return null;
        }
        const measuredVisibleSize = measuredImageVisibleSizes?.[block.id] ?? null;
        const cropOverlayStyle = buildImageCropOverlayStyle(imageLayout, measuredVisibleSize);
        const cropSelectionStyle = buildImageCropSelectionStyle(imageLayout, measuredVisibleSize);

        // 判断是否为当前选中图片，用于显示交互状态
        const isSelected = selectedNodeId === block.id;

        return (
          <figure
            key={`image-${block.id}-${index}`}
            {...getSelectableBlockProps(buildImageShellClassName(block, selectedNodeId, imageLayout))}
            style={buildImageStyle(block, semanticRoleConfig, imageLayout)}
          >
            {semanticBlockRoleLabel}
            {block.metadata.src ? (
              <>
                <span
                  className="image-viewport"
                  data-layout-node-id={block.id}
                  data-page-scale={pageScale ?? 1}
                  style={buildImageViewportStyle(imageLayout, measuredVisibleSize)}
                  onMouseDown={(event) => {
                    if (event.shiftKey) {
                      return;
                    }

                    // 选中图片并开始拖动
                    if (onStartImageDrag) {
                      // 先选中图片
                      selectCurrentBlockOrNode(false);
                      // 开始拖动
                      onStartImageDrag(event, block, pageScale ?? 1);
                    }
                  }}
                >
                  <img
                    className="preview-image preview-image-fit preview-image-cropped"
                    src={resolveAssetSrc(block.metadata.src)}
                    alt={block.metadata.alt || '图片'}
                    title={block.metadata.title ?? undefined}
                    loading="lazy"
                    onLoad={onImageLoad}
                    style={buildImageContentStyle(imageLayout, measuredVisibleSize)}
                  />
                  {selectedNodeId === block.id && onStartImageResize ? (
                    <button
                      type="button"
                      className="image-resize-handle"
                      aria-label="拖拽缩放图片"
                      title="拖拽缩放图片"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onStartImageResize(event, block, pageScale ?? 1);
                      }}
                    />
                  ) : null}
                </span>
                {selectedNodeId === block.id && onStartImageCrop && cropOverlayStyle && cropSelectionStyle ? (
                  <div className="image-crop-overlay" style={cropOverlayStyle}>
                    <img
                      className="preview-image image-crop-overlay-image"
                      src={resolveAssetSrc(block.metadata.src)}
                      alt=""
                      aria-hidden="true"
                    />
                    {(['top', 'right', 'bottom', 'left'] as const).map((edge) => {
                      const maskStyle = buildImageCropMaskStyle(imageLayout, measuredVisibleSize, edge);
                      return maskStyle ? <div key={`mask-${block.id}-${edge}`} className="image-crop-mask" style={maskStyle} /> : null;
                    })}
                    <div className="image-crop-selection" style={cropSelectionStyle} />
                    {(['top', 'right', 'bottom', 'left'] as const).map((edge) => {
                      const handleStyle = buildImageCropHandleStyle(imageLayout, measuredVisibleSize, edge);
                      return handleStyle ? (
                        <button
                          key={`crop-${block.id}-${edge}`}
                          type="button"
                          className={`image-crop-handle image-crop-handle-${edge}`}
                          aria-label={`拖拽裁剪图片${edge === 'top' ? '上边' : edge === 'right' ? '右边' : edge === 'bottom' ? '下边' : '左边'}`}
                          title={`拖拽裁剪图片${edge === 'top' ? '上边' : edge === 'right' ? '右边' : edge === 'bottom' ? '下边' : '左边'}`}
                          style={handleStyle}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onStartImageCrop(event, block, edge, pageScale ?? 1);
                          }}
                        />
                      ) : null;
                    })}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="preview-image placeholder">图片占位</div>
            )}
            {/* 只有 showCaption 为 true 时才渲染标题区域 */}
            {imageLayout.showCaption ? (
              <figcaption>
                {isEditing
                  ? renderBlockEditor({
                      kind: editingKind ?? 'imageAlt',
                      editorRef,
                      editingText,
                      onChange: onEditTextChange,
                      onSelectionChange,
                      onCommit: onCommitEdit,
                      onCancel: onCancelEdit,
                    })
                  : block.metadata.title || block.metadata.alt || <span className="empty-text-placeholder">双击编辑图片说明</span>}
              </figcaption>
            ) : null}
          </figure>
        );
      }
    case 'equation':
      return block.metadata.kind === 'equation' ? (
        <div
          key={`equation-${block.id}-${index}`}
          {...createSelectableEquationBlockProps({
            block,
            semanticRoleConfig,
            selectedNodeId,
            selectedBlockIds,
            editingNodeId: activeEquationEditorNodeId,
            onSelectNode,
            onSelectBlock,
            onPrepareSelectNode,
            onStartEditing,
          })}
          style={blockStyle}
        >
          {semanticBlockRoleLabel}
          <div
            className="equation-preview"
            dangerouslySetInnerHTML={renderEquationPreview(block.metadata.value)}
          />
        </div>
      ) : null;
    case 'horizontalRule':
      return null;
    default:
      return null;
  }
}

function createPageDisplayStyles(
  page: PageLayout,
  isCondensed: boolean,
  availableWidth: number | null,
): PageDisplayStyles {
  const displayWidth = resolvePageDisplayWidth(page.contract.pageWidthPx, isCondensed, availableWidth);
  const displayScale = displayWidth / page.contract.pageWidthPx;
  const displayHeight = page.contract.pageHeightPx * displayScale;
  const headerHeight = page.contract.marginsPx.top + page.contract.headerReservedPx;
  const footerHeight = page.contract.marginsPx.bottom + page.contract.footerReservedPx;
  const backgroundOverride = resolvePageBackgroundOverride(page.contract);

  return {
    frameStyle: {
      '--page-frame-width': `${displayWidth}px`,
      '--page-frame-height': `${displayHeight}px`,
    } as CSSProperties,
    pageStyle: {
      ...buildPageStyleVariables(page.contract),
      '--page-source-width': `${page.contract.pageWidthPx}px`,
      '--page-source-height': `${page.contract.pageHeightPx}px`,
      '--page-scale': displayScale,
      '--page-header-height': `${headerHeight}px`,
      '--page-footer-height': `${footerHeight}px`,
      '--page-padding-left': `${page.contract.marginsPx.left}px`,
      '--page-padding-right': `${page.contract.marginsPx.right}px`,
      ...(backgroundOverride
        ? {
            backgroundColor: backgroundOverride.color,
            backgroundImage: backgroundOverride.image,
            backgroundSize: backgroundOverride.size,
            backgroundRepeat: backgroundOverride.repeat,
            backgroundPosition: backgroundOverride.position,
          }
        : {}),
    } as CSSProperties,
  };
}

// 分页预览要按当前容器宽度自适应，避免 A3 / A4 / B5 都被固定上限压成近似一样大。
function resolvePageDisplayWidth(
  pageWidthPx: number,
  isCondensed: boolean,
  availableWidth: number | null,
): number {
  const fallbackWidth = isCondensed ? 620 : 760;
  const measuredWidth = availableWidth && availableWidth > 0 ? availableWidth : fallbackWidth;
  const horizontalGutter = isCondensed ? 20 : 32;
  const viewportWidth = measuredWidth > horizontalGutter ? measuredWidth - horizontalGutter : measuredWidth;
  return Math.min(pageWidthPx, viewportWidth);
}

function renderPdfWatermarkLayer(
  page: PageLayout,
  pdfWatermarkSettings: PdfWatermarkSettings,
): JSX.Element | null {
  const watermark = resolvePdfWatermarkRenderModel({
    settings: pdfWatermarkSettings,
    pageWidthPx: page.contract.pageWidthPx,
    pageHeightPx: page.contract.pageHeightPx,
  });
  if (!watermark) {
    return null;
  }

  return (
    <div className="pdf-watermark-layer" aria-hidden="true">
      {watermark.tiles.map((tile) => {
        const tileStyle = {
          left: `${tile.centerXPx}px`,
          top: `${tile.centerYPx}px`,
          width: `${tile.widthPx}px`,
          height: `${tile.heightPx}px`,
          transform: 'translate(-50%, -50%)',
        } as CSSProperties;
        const contentStyle = {
          opacity: watermark.opacity,
          transform: `rotate(${watermark.angleDeg}deg)`,
        } as CSSProperties;

        return (
          <div key={tile.id} className="pdf-watermark-tile" style={tileStyle}>
            {watermark.kind === 'text' ? (
              <span
                className="pdf-watermark-text"
                style={{
                  ...contentStyle,
                  color: watermark.textColor,
                  fontSize: `${watermark.textFontSizePx}px`,
                }}
              >
                {watermark.textContent}
              </span>
            ) : (
              <img
                className="pdf-watermark-image"
                src={watermark.imageSrc}
                alt=""
                draggable={false}
                style={contentStyle}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CanvasPaneComponent({
  documentTitle,
  documentBlockCount,
  documentBlocks,
  documentResources,
  documentStyles,
  semanticRoleConfig,
  answerDisplayMode,
  pageLayouts,
  parseError,
  parseState,
  resolvedStyleContract,
  headerFooterContent,
  pdfWatermarkSettings,
  selectedNodeId,
  selectedBlockIds,
  onSelectNode,
  onSelectBlock,
  onSelectTableCell,
  onClearSelection,
  onMergeSelectedBlocks,
  onWrapSelectedBlocksInColumns,
  onCommitNodeText,
  onCommitNodeRichText,
  onTextSelectionChange,
  tocItems = [],
  onNavigateToNode,
  requestedStartEditingNodeId = null,
  onConsumeRequestedStartEditingNode,
  requestedScrollToNodeId = null,
  onConsumeRequestedScrollToNode,
  isCondensed = false,
  onMeasuredBlockHeightsChange,
  onMeasuredTextLineBreaksChange,
  textFragmentMeasurementJobs = [],
  onMeasuredTextFragmentHeightsChange,
  tableRowMeasurementJobs = [],
  onMeasuredTableRowHeightsChange,
  workspaceRootPath,
}: CanvasPaneProps): JSX.Element {
  const documentEpoch = useAppStore((state) => state.documentEpoch);
  const fontFaceCss = buildFontFaceCss(documentResources, workspaceRootPath);
  const updateLayoutImageAttributes = useAppStore((state) => state.updateLayoutImageAttributes);
  const moveLayoutImageBlockAfterAnchor = useAppStore((state) => state.moveLayoutImageBlockAfterAnchor);
  const tableSelection = useAppStore((state) => state.layoutDocument?.viewState.tableSelection ?? null);
  const updateLayoutTableColumnWidths = useAppStore((state) => state.updateLayoutTableColumnWidths);
  const updateLayoutTableRowHeight = useAppStore((state) => state.updateLayoutTableRowHeight);
  const updateLayoutListItemLevel = useAppStore((state) => state.updateLayoutListItemLevel);
  const reorderLayoutListItem = useAppStore((state) => state.reorderLayoutListItem);
  const convertLayoutListItemTaskState = useAppStore((state) => state.convertLayoutListItemTaskState);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingKind, setEditingKind] = useState<CanvasEditorKind | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingDraftTextRuns, setEditingDraftTextRuns] = useState<TextRun[] | null>(null);
  const [editingSelection, setEditingSelection] = useState<TextRangeSelection | null>(null);
  const [activeEquationEditor, setActiveEquationEditor] = useState<ActiveEquationEditor | null>(null);
  const [activeImageResize, setActiveImageResize] = useState<ActiveImageResize | null>(null);
  const [activeImageCrop, setActiveImageCrop] = useState<ActiveImageCrop | null>(null);
  const [activeTableColumnResize, setActiveTableColumnResize] = useState<ActiveTableColumnResize | null>(null);
  const [activeTableRowResize, setActiveTableRowResize] = useState<ActiveTableRowResize | null>(null);
  const [draftImageSizes, setDraftImageSizes] = useState<Record<string, { widthPx: number | null; heightPx: number | null }>>({});
  const [draftImageCrops, setDraftImageCrops] = useState<Record<string, ImageDraftCrop>>({});
  const [draftImageOffsets, setDraftImageOffsets] = useState<Record<string, ImageDraftOffset>>({});
  const [draftTableColumnWidths, setDraftTableColumnWidths] = useState<Record<string, number[]>>({});
  const [draftTableRowHeights, setDraftTableRowHeights] = useState<Record<string, number>>({});
  const [measuredImageVisibleSizes, setMeasuredImageVisibleSizes] = useState<Record<string, ImageMeasuredVisibleSize>>({});
  const [imageMeasureEpoch, setImageMeasureEpoch] = useState(0);
  const [floatingToolbarPosition, setFloatingToolbarPosition] = useState<FloatingToolbarPosition | null>(null);
  const [floatingToolbarMenu, setFloatingToolbarMenu] = useState<FloatingToolbarMenu | null>(null);
  const [blockToolbarPosition, setBlockToolbarPosition] = useState<FloatingToolbarPosition | null>(null);
  const [pageStackWidth, setPageStackWidth] = useState<number | null>(null);
  const [listItemContextMenu, setListItemContextMenu] = useState<ListItemContextMenuState | null>(null);
  const canvasPaneRef = useRef<HTMLDivElement>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const measurementLayerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const richEditorRef = useRef<HTMLDivElement | null>(null);
  const floatingToolbarRef = useRef<HTMLDivElement | null>(null);
  const blockToolbarRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollSnapshotRef = useRef<CanvasScrollSnapshot | null>(null);
  const blockMeasurementCacheRef = useRef<Record<string, BlockMeasurementCacheEntry>>({});
  const pendingSelectionAfterCommitRef = useRef<string | null>(null);
  const activeImageResizeRef = useRef<ActiveImageResize | null>(null);
  const activeImageCropRef = useRef<ActiveImageCrop | null>(null);
  const activeImageDragRef = useRef<ActiveImageDrag | null>(null);
  const [activeImageDrag, setActiveImageDrag] = useState<ActiveImageDrag | null>(null);
  const activeTableColumnResizeRef = useRef<ActiveTableColumnResize | null>(null);
  const activeTableRowResizeRef = useRef<ActiveTableRowResize | null>(null);
  const draftImageSizesRef = useRef<Record<string, { widthPx: number | null; heightPx: number | null }>>({});
  const draftImageCropsRef = useRef<Record<string, ImageDraftCrop>>({});
  const draftImageOffsetsRef = useRef<Record<string, ImageDraftOffset>>({});
  const draftTableColumnWidthsRef = useRef<Record<string, number[]>>({});
  const draftTableRowHeightsRef = useRef<Record<string, number>>({});
  const skipBlurCommitRef = useRef(false);
  const isEditingRichText = !!editingKind && isRichTextCanvasEditorKind(editingKind);
  const activeEquationEditorNodeId = activeEquationEditor?.nodeId ?? null;
  const floatingToolbarTextRuns =
    editingDraftTextRuns ?? (editingNodeId ? findEditableNodeTextRunsInBlocks(documentBlocks, editingNodeId) : null);
  const shouldShowFloatingToolbar =
    !!editingNodeId &&
    isEditingRichText &&
    !!floatingToolbarTextRuns &&
    hasNonCollapsedSelection(editingSelection);
  const shouldShowBlockSelectionToolbar = selectedBlockIds.length >= 2 && !shouldShowFloatingToolbar;
  const floatingFontFamilyGroups = buildFontFamilyGroupsWithImportedFonts(
    textFontFamilyGroups,
    documentResources,
  );
  const currentFloatingTextColor =
    floatingToolbarTextRuns && shouldShowFloatingToolbar
      ? getSharedFloatingTextStyleValue(floatingToolbarTextRuns, editingSelection, 'color')
      : undefined;
  const currentFloatingHighlightColor =
    floatingToolbarTextRuns && shouldShowFloatingToolbar
      ? getSharedFloatingTextStyleValue(floatingToolbarTextRuns, editingSelection, 'highlightColor')
      : undefined;
  const currentFloatingFontFamily =
    floatingToolbarTextRuns && shouldShowFloatingToolbar
      ? getSharedFloatingTextStyleValue(floatingToolbarTextRuns, editingSelection, 'fontFamily')
      : undefined;
  const currentFloatingFontSize =
    floatingToolbarTextRuns && shouldShowFloatingToolbar
      ? getSharedFloatingTextStyleValue(floatingToolbarTextRuns, editingSelection, 'fontSize')
      : undefined;
  const currentFloatingFontFamilyLabel = getFloatingFontFamilyLabel(
    floatingFontFamilyGroups,
    currentFloatingFontFamily,
  );
  const currentFloatingFontSizeLabel =
    typeof currentFloatingFontSize === 'number' ? `${currentFloatingFontSize}px` : '字号';
  const measurementPageStyle = {
    ...buildPageStyleVariables(resolvedStyleContract),
    '--page-padding-left': '0px',
    '--page-padding-right': '0px',
    width: `${resolvedStyleContract.contentWidthPx}px`,
  } as CSSProperties;
  const isMultiColumnPage = resolvedStyleContract.columnCount > 1;
  const pageBodyClassName = isMultiColumnPage ? 'page-body page-body-columns' : 'page-body';

  useLayoutEffect(() => {
    // 新文档加载后必须丢弃旧文档残留的弹层、拖拽态和编辑态，避免透明层继续吞掉点击。
    setEditingNodeId(null);
    setEditingKind(null);
    setEditingText('');
    setEditingDraftTextRuns(null);
    setEditingSelection(null);
    setActiveEquationEditor(null);
    setActiveImageResize(null);
    setActiveImageCrop(null);
    setActiveImageDrag(null);
    setActiveTableColumnResize(null);
    setActiveTableRowResize(null);
    setDraftImageSizes({});
    setDraftImageCrops({});
    setDraftImageOffsets({});
    setDraftTableColumnWidths({});
    setDraftTableRowHeights({});
    setMeasuredImageVisibleSizes({});
    setFloatingToolbarPosition(null);
    setFloatingToolbarMenu(null);
    setBlockToolbarPosition(null);
    setListItemContextMenu(null);
    pendingScrollSnapshotRef.current = null;
    blockMeasurementCacheRef.current = {};
    pendingSelectionAfterCommitRef.current = null;
    activeImageResizeRef.current = null;
    activeImageCropRef.current = null;
    activeImageDragRef.current = null;
    activeTableColumnResizeRef.current = null;
    activeTableRowResizeRef.current = null;
    draftImageSizesRef.current = {};
    draftImageCropsRef.current = {};
    draftImageOffsetsRef.current = {};
    draftTableColumnWidthsRef.current = {};
    draftTableRowHeightsRef.current = {};
    skipBlurCommitRef.current = false;
    onTextSelectionChange({
      nodeId: null,
      text: '',
      selection: null,
      isEditing: false,
      draftTextRuns: null,
    });
  }, [documentEpoch, onTextSelectionChange]);

  useLayoutEffect(() => {
    const pageStack = pageStackRef.current;
    if (!pageStack) {
      return;
    }

    const updatePageStackWidth = () => {
      setPageStackWidth(pageStack.clientWidth);
    };

    updatePageStackWidth();
    const resizeObserver = new ResizeObserver(updatePageStackWidth);
    resizeObserver.observe(pageStack);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    activeImageResizeRef.current = activeImageResize;
  }, [activeImageResize]);

  useEffect(() => {
    activeImageCropRef.current = activeImageCrop;
  }, [activeImageCrop]);

  useEffect(() => {
    activeImageDragRef.current = activeImageDrag;
  }, [activeImageDrag]);

  useEffect(() => {
    activeTableColumnResizeRef.current = activeTableColumnResize;
  }, [activeTableColumnResize]);

  useEffect(() => {
    activeTableRowResizeRef.current = activeTableRowResize;
  }, [activeTableRowResize]);

  useEffect(() => {
    draftImageSizesRef.current = draftImageSizes;
  }, [draftImageSizes]);

  useEffect(() => {
    draftImageCropsRef.current = draftImageCrops;
  }, [draftImageCrops]);

  useEffect(() => {
    draftTableColumnWidthsRef.current = draftTableColumnWidths;
  }, [draftTableColumnWidths]);

  useEffect(() => {
    draftTableRowHeightsRef.current = draftTableRowHeights;
  }, [draftTableRowHeights]);

  useEffect(() => {
    draftImageOffsetsRef.current = draftImageOffsets;
  }, [draftImageOffsets]);

  useEffect(() => {
    if (!shouldShowFloatingToolbar) {
      setFloatingToolbarMenu(null);
    }
  }, [shouldShowFloatingToolbar]);

  useLayoutEffect(() => {
    if (
      !onMeasuredBlockHeightsChange &&
      !onMeasuredTextLineBreaksChange &&
      !onMeasuredTextFragmentHeightsChange &&
      !onMeasuredTableRowHeightsChange
    ) {
      return;
    }

    const measurementLayer = measurementLayerRef.current;
    const styleSignature = buildMeasurementStyleSignature(
      resolvedStyleContract,
      documentStyles,
      buildFloatingImageMeasurementSignature(documentBlocks),
    );
    const nextCache: Record<string, BlockMeasurementCacheEntry> = {};
    const nextHeights: Record<string, number> = {};
    const nextTextLineBreaks: MeasuredTextLineBreaks = {};
    const nextTextFragmentHeights: MeasuredTextFragmentHeights = {};
    const nextTableRowHeights: MeasuredTableRowHeights = {};

    documentBlocks.forEach((block) => {
      const signature = buildBlockMeasurementSignature(block, styleSignature);
      const cachedEntry = blockMeasurementCacheRef.current[block.id];

      if (cachedEntry?.signature === signature) {
        nextCache[block.id] = cachedEntry;
        nextHeights[block.id] = cachedEntry.heightPx;
        Object.assign(nextTextLineBreaks, cachedEntry.textLineBreaks ?? {});
      }
    });

    if (measurementLayer) {
      const measuredElements = measurementLayer.querySelectorAll<HTMLElement>('[data-measure-block-id]');
      measuredElements.forEach((element) => {
        const blockId = element.dataset.measureBlockId;
        if (!blockId) {
          return;
        }

        const block = documentBlocks.find((item) => item.id === blockId);
        if (!block) {
          return;
        }

        const signature = buildBlockMeasurementSignature(block, styleSignature);
        const rect = element.getBoundingClientRect();
        const heightPx = Math.max(0, Math.ceil(rect.height));
        const textLineBreaks = measureTextLineBreaksInBlock(element);
        nextCache[blockId] = { signature, heightPx, textLineBreaks };
        nextHeights[blockId] = heightPx;
        Object.assign(nextTextLineBreaks, textLineBreaks);
      });

      const measuredTextFragmentElements = measurementLayer.querySelectorAll<HTMLElement>('[data-measure-text-fragment-id]');
      measuredTextFragmentElements.forEach((element) => {
        const fragmentId = element.dataset.measureTextFragmentId;
        if (!fragmentId) {
          return;
        }

        // 文本片段高度只给 dom-measure-v1 的运行时分页使用，不写回文档模型。
        nextTextFragmentHeights[fragmentId] = Math.max(0, Math.ceil(element.getBoundingClientRect().height));
      });

      const measuredTableRowElements = measurementLayer.querySelectorAll<HTMLTableRowElement>('[data-measure-table-row-id]');
      measuredTableRowElements.forEach((element) => {
        const rowId = element.dataset.measureTableRowId;
        if (!rowId) {
          return;
        }

        // 表格行真实高度只给 dom-measure-v1 的运行时分页使用，不写回文档模型。
        nextTableRowHeights[rowId] = Math.max(0, Math.ceil(element.getBoundingClientRect().height));
      });
    }

    blockMeasurementCacheRef.current = nextCache;
    onMeasuredBlockHeightsChange?.(nextHeights);
    onMeasuredTextLineBreaksChange?.(nextTextLineBreaks);
    onMeasuredTextFragmentHeightsChange?.(nextTextFragmentHeights);
    onMeasuredTableRowHeightsChange?.(nextTableRowHeights);
  }, [documentBlocks, documentStyles, onMeasuredBlockHeightsChange, onMeasuredTableRowHeightsChange, onMeasuredTextFragmentHeightsChange, onMeasuredTextLineBreaksChange, resolvedStyleContract, tableRowMeasurementJobs, textFragmentMeasurementJobs]);

  useLayoutEffect(() => {
    const canvasPane = canvasPaneRef.current;
    if (!canvasPane) {
      return;
    }

    const nextMeasuredSizes: Record<string, ImageMeasuredVisibleSize> = {};
    const currentImageNodeIds = new Set(
      documentBlocks.filter((block) => block.type === 'image' && block.metadata.kind === 'image').map((block) => block.id),
    );
    const viewportElements = canvasPane.querySelectorAll<HTMLElement>('.image-viewport[data-layout-node-id]');

    viewportElements.forEach((element) => {
      const nodeId = element.dataset.layoutNodeId;
      if (!nodeId) {
        return;
      }

      const ownerBlock = documentBlocks.find(
        (block) => block.id === nodeId && block.type === 'image' && block.metadata.kind === 'image',
      );
      if (!ownerBlock || ownerBlock.type !== 'image' || ownerBlock.metadata.kind !== 'image') {
        return;
      }

      const pageScale = Number(element.dataset.pageScale ?? '1');
      const safeScale = Number.isFinite(pageScale) && pageScale > 0 ? pageScale : 1;
      const rect = element.getBoundingClientRect();
      const imageElement = element.querySelector<HTMLImageElement>('.preview-image-cropped');
      const resolvedLayout = resolveImageLayoutWithDraft(
        ownerBlock,
        draftImageSizes[nodeId] ?? null,
        draftImageCrops[nodeId] ?? null,
        draftImageOffsets[nodeId] ?? null,
      );
      const hasExplicitSize = !!resolvedLayout && (resolvedLayout.widthPx !== null || resolvedLayout.heightPx !== null);
      const isImageReady =
        !!imageElement &&
        imageElement.complete &&
        imageElement.naturalWidth > 0 &&
        imageElement.naturalHeight > 0;

      // 没有显式宽高时，图片真正加载前不要把尚未稳定的临时盒子测量值收口成正式尺寸，否则会把图片提前压成 1 x 1。
      if (!hasExplicitSize && (!isImageReady || rect.width < 2 || rect.height < 2)) {
        return;
      }

      // 这里统一把当前页面缩放还原回排版像素，避免裁剪手柄按屏幕像素写回后越拖越偏。
      nextMeasuredSizes[nodeId] = {
        widthPx: Math.max(1, Math.round(rect.width / safeScale)),
        heightPx: Math.max(1, Math.round(rect.height / safeScale)),
      };
    });

    setMeasuredImageVisibleSizes((current) => {
      const nextState: Record<string, ImageMeasuredVisibleSize> = {};

      for (const nodeId of currentImageNodeIds) {
        const nextMeasuredSize = nextMeasuredSizes[nodeId];
        if (nextMeasuredSize) {
          nextState[nodeId] = nextMeasuredSize;
          continue;
        }

        if (current[nodeId]) {
          nextState[nodeId] = current[nodeId];
        }
      }

      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextState);
      if (currentKeys.length === nextKeys.length && nextKeys.every((key) => {
        const currentValue = current[key];
        const nextValue = nextState[key];
        return !!currentValue && !!nextValue && currentValue.widthPx === nextValue.widthPx && currentValue.heightPx === nextValue.heightPx;
      })) {
        return current;
      }

      return nextState;
    });
  }, [documentBlocks, draftImageCrops, draftImageSizes, imageMeasureEpoch, pageLayouts, pageStackWidth]);

  useEffect(() => {
    if (!activeImageResize) {
      return;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const deltaX = (event.clientX - activeImageResize.startClientX) / Math.max(0.0001, activeImageResize.pageScale);
      const deltaY = (event.clientY - activeImageResize.startClientY) / Math.max(0.0001, activeImageResize.pageScale);
      const nextWidth = Math.max(48, Math.round(activeImageResize.startWidthPx + deltaX));
      let nextHeight = Math.max(48, Math.round(activeImageResize.startHeightPx + deltaY));

      if (activeImageResize.lockAspectRatio && activeImageResize.aspectRatio) {
        nextHeight = Math.max(48, Math.round(nextWidth / activeImageResize.aspectRatio));
      }

      setDraftImageSizes((current) => ({
        ...current,
        [activeImageResize.nodeId]: {
          widthPx: nextWidth,
          heightPx: nextHeight,
        },
      }));
    };

    const handleMouseUp = () => {
      const resizeState = activeImageResizeRef.current;
      if (!resizeState) {
        return;
      }

      const draftSize = draftImageSizesRef.current[resizeState.nodeId];
      const targetBlock = documentBlocks.find((block) => block.id === resizeState.nodeId);
      if (draftSize && targetBlock?.type === 'image' && targetBlock.metadata.kind === 'image') {
        const imageAttributes = buildImageAttributePayload(targetBlock, {
          widthPx: draftSize.widthPx,
          heightPx: draftSize.heightPx,
        });
        if (imageAttributes) {
          updateLayoutImageAttributes({
            nodeId: resizeState.nodeId,
            ...imageAttributes,
          });
        }
      }

      setActiveImageResize(null);
      setDraftImageSizes((current) => {
        const next = { ...current };
        delete next[resizeState.nodeId];
        return next;
      });
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'nwse-resize';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeImageResize, documentBlocks, updateLayoutImageAttributes]);

  useEffect(() => {
    if (!activeImageCrop) {
      return;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const deltaX = (event.clientX - activeImageCrop.startClientX) / Math.max(0.0001, activeImageCrop.pageScale);
      const deltaY = (event.clientY - activeImageCrop.startClientY) / Math.max(0.0001, activeImageCrop.pageScale);
      const minVisibleWidthPx = 48;
      const minVisibleHeightPx = 48;

      setDraftImageCrops((current) => {
        const previous = current[activeImageCrop.nodeId] ?? activeImageCrop.startCrop;
        let nextCropTopPx = previous.cropTopPx;
        let nextCropRightPx = previous.cropRightPx;
        let nextCropBottomPx = previous.cropBottomPx;
        let nextCropLeftPx = previous.cropLeftPx;

        // 只让当前拖拽边改动对应裁剪值，另外三边沿用起始值，避免同一次拖拽把图片四边一起拉乱。
        switch (activeImageCrop.edge) {
          case 'top':
            nextCropTopPx = Math.max(
              0,
              Math.min(
                activeImageCrop.fullHeightPx - activeImageCrop.startCrop.cropBottomPx - minVisibleHeightPx,
                Math.round(activeImageCrop.startCrop.cropTopPx + deltaY),
              ),
            );
            nextCropRightPx = activeImageCrop.startCrop.cropRightPx;
            nextCropBottomPx = activeImageCrop.startCrop.cropBottomPx;
            nextCropLeftPx = activeImageCrop.startCrop.cropLeftPx;
            break;
          case 'right':
            nextCropRightPx = Math.max(
              0,
              Math.min(
                activeImageCrop.fullWidthPx - activeImageCrop.startCrop.cropLeftPx - minVisibleWidthPx,
                Math.round(activeImageCrop.startCrop.cropRightPx - deltaX),
              ),
            );
            nextCropTopPx = activeImageCrop.startCrop.cropTopPx;
            nextCropBottomPx = activeImageCrop.startCrop.cropBottomPx;
            nextCropLeftPx = activeImageCrop.startCrop.cropLeftPx;
            break;
          case 'bottom':
            nextCropBottomPx = Math.max(
              0,
              Math.min(
                activeImageCrop.fullHeightPx - activeImageCrop.startCrop.cropTopPx - minVisibleHeightPx,
                Math.round(activeImageCrop.startCrop.cropBottomPx - deltaY),
              ),
            );
            nextCropTopPx = activeImageCrop.startCrop.cropTopPx;
            nextCropRightPx = activeImageCrop.startCrop.cropRightPx;
            nextCropLeftPx = activeImageCrop.startCrop.cropLeftPx;
            break;
          case 'left':
            nextCropLeftPx = Math.max(
              0,
              Math.min(
                activeImageCrop.fullWidthPx - activeImageCrop.startCrop.cropRightPx - minVisibleWidthPx,
                Math.round(activeImageCrop.startCrop.cropLeftPx + deltaX),
              ),
            );
            nextCropTopPx = activeImageCrop.startCrop.cropTopPx;
            nextCropRightPx = activeImageCrop.startCrop.cropRightPx;
            nextCropBottomPx = activeImageCrop.startCrop.cropBottomPx;
            break;
          default:
            break;
        }

        return {
          ...current,
          [activeImageCrop.nodeId]: {
            cropTopPx: nextCropTopPx,
            cropRightPx: nextCropRightPx,
            cropBottomPx: nextCropBottomPx,
            cropLeftPx: nextCropLeftPx,
          },
        };
      });
    };

    const handleMouseUp = () => {
      const cropState = activeImageCropRef.current;
      if (!cropState) {
        return;
      }

      const draftCrop = draftImageCropsRef.current[cropState.nodeId] ?? cropState.startCrop;
      const targetBlock = documentBlocks.find((block) => block.id === cropState.nodeId);
      if (targetBlock?.type === 'image' && targetBlock.metadata.kind === 'image') {
        const imageAttributes = buildImageAttributePayload(targetBlock, {
          widthPx: targetBlock.metadata.widthPx ?? cropState.fullWidthPx,
          heightPx: targetBlock.metadata.heightPx ?? cropState.fullHeightPx,
          cropTopPx: draftCrop.cropTopPx,
          cropRightPx: draftCrop.cropRightPx,
          cropBottomPx: draftCrop.cropBottomPx,
          cropLeftPx: draftCrop.cropLeftPx,
        });
        if (imageAttributes) {
          updateLayoutImageAttributes({
            nodeId: cropState.nodeId,
            ...imageAttributes,
          });
        }
      }

      setActiveImageCrop(null);
      setDraftImageCrops((current) => {
        const next = { ...current };
        delete next[cropState.nodeId];
        return next;
      });
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = activeImageCrop.edge === 'left' || activeImageCrop.edge === 'right' ? 'ew-resize' : 'ns-resize';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeImageCrop, documentBlocks, updateLayoutImageAttributes]);

  // 图片拖动逻辑：按住图片区域并拖动可以调整图片偏移量
  useEffect(() => {
    if (!activeImageDrag) {
      return;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const deltaX = (event.clientX - activeImageDrag.startClientX) / Math.max(0.0001, activeImageDrag.pageScale);
      const deltaY = (event.clientY - activeImageDrag.startClientY) / Math.max(0.0001, activeImageDrag.pageScale);

      if (activeImageDrag.isTextWrapped) {
        const renderedLeftPx = activeImageDrag.startRenderedLeftPx + deltaX;
        const nextWrapSide: ImageWrapSide =
          renderedLeftPx + activeImageDrag.viewportWidthPx / 2 <= activeImageDrag.pageContentWidthPx / 2
            ? 'left'
            : 'right';
        const maxInsetPx = Math.max(0, activeImageDrag.pageContentWidthPx - activeImageDrag.viewportWidthPx);
        const nextOffsetX = nextWrapSide === 'left'
          ? Math.max(0, Math.min(maxInsetPx, Math.round(renderedLeftPx)))
          : Math.max(
              0,
              Math.min(
                maxInsetPx,
                Math.round(activeImageDrag.pageContentWidthPx - activeImageDrag.viewportWidthPx - renderedLeftPx),
              ),
            );

        setDraftImageOffsets((current) => ({
          ...current,
          [activeImageDrag.nodeId]: {
            offsetX: nextOffsetX,
            offsetY: Math.round(activeImageDrag.startOffsetY + deltaY),
            wrapSide: nextWrapSide,
          },
        }));
        return;
      }

      // 嵌入型 / 上下型仍按原始偏移量差值预览。
      setDraftImageOffsets((current) => ({
        ...current,
        [activeImageDrag.nodeId]: {
          offsetX: Math.round(activeImageDrag.startOffsetX + deltaX),
          offsetY: Math.round(activeImageDrag.startOffsetY + deltaY),
        },
      }));
    };

    const handleMouseUp = () => {
      const dragState = activeImageDragRef.current;
      if (!dragState) {
        return;
      }

      // 获取最终偏移量
      const draftOffsets = draftImageOffsetsRef.current;
      const currentOffset = draftOffsets[dragState.nodeId];
      const finalOffsetX = currentOffset?.offsetX ?? dragState.startOffsetX;
      const finalOffsetY = currentOffset?.offsetY ?? dragState.startOffsetY;
      const finalWrapSide = currentOffset?.wrapSide;

      // 只有偏移量真正改变时才写回模型
      const targetBlock = documentBlocks.find((block) => block.id === dragState.nodeId);
      if (targetBlock?.type === 'image' && targetBlock.metadata.kind === 'image') {
        const originalOffsetX = targetBlock.metadata.offsetX ?? 0;
        const originalOffsetY = targetBlock.metadata.offsetY ?? 0;
        const originalWrapSide = resolveImageLayout(targetBlock.metadata).wrapSide;

        // 只有偏移量变化了才写回
        if (
          finalOffsetX !== originalOffsetX ||
          finalOffsetY !== originalOffsetY ||
          (finalWrapSide && finalWrapSide !== originalWrapSide)
        ) {
          const imageAttributes = buildImageAttributePayload(targetBlock, {
            offsetX: finalOffsetX,
            offsetY: finalOffsetY,
            wrapSide: finalWrapSide,
          });
          if (imageAttributes) {
            updateLayoutImageAttributes({
              nodeId: dragState.nodeId,
              ...imageAttributes,
            });
          }
        }
      }

      if (dragState.isTextWrapped) {
        const canvasPane = canvasPaneRef.current;
        const imageElement = canvasPane?.querySelector<HTMLElement>(`.image-viewport[data-layout-node-id="${escapeDataAttributeValue(dragState.nodeId)}"]`);
        const pageBodyElement = imageElement?.closest<HTMLElement>('.page-body');
        const pageBodyRect = pageBodyElement?.getBoundingClientRect();
        const imageRect = imageElement?.getBoundingClientRect();

        if (canvasPane && pageBodyElement && pageBodyRect && imageRect) {
          const imageCenterY = imageRect.top + imageRect.height / 2;
          const candidateBlocks = Array.from(
            pageBodyElement.querySelectorAll<HTMLElement>('.selectable-layout-block[data-layout-node-id]'),
          )
            .filter((element) => {
              const nodeId = element.dataset.layoutNodeId;
              return !!nodeId && nodeId !== dragState.nodeId && !element.querySelector('.image-viewport[data-layout-node-id]');
            })
            .map((element) => {
              const nodeId = element.dataset.layoutNodeId!;
              const sourceNodeId = element.dataset.sourceNodeId ?? nodeId;
              const rect = element.getBoundingClientRect();
              return { nodeId, sourceNodeId, rect };
            })
            .filter((entry) => entry.rect.bottom <= imageCenterY + 4);

          const anchorBlockId = candidateBlocks.length > 0
            ? candidateBlocks[candidateBlocks.length - 1].sourceNodeId
            : null;

          moveLayoutImageBlockAfterAnchor({
            nodeId: dragState.nodeId,
            anchorBlockId,
          });
        }
      }

      setActiveImageDrag(null);
      // 清除临时偏移量
      setDraftImageOffsets((current) => {
        const next = { ...current };
        delete next[dragState.nodeId];
        return next;
      });
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'move';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeImageDrag, documentBlocks, updateLayoutImageAttributes]);

  useEffect(() => {
    if (!activeTableColumnResize) {
      return;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const deltaX =
        (event.clientX - activeTableColumnResize.startClientX) / Math.max(0.0001, activeTableColumnResize.pageScale);
      const minWidthPx = 48;
      const totalWidthPx = activeTableColumnResize.startWidthPx + activeTableColumnResize.startNextWidthPx;
      const nextWidth = Math.max(
        minWidthPx,
        Math.min(
          Math.round(activeTableColumnResize.startWidthPx + deltaX),
          Math.max(minWidthPx, totalWidthPx - minWidthPx),
        ),
      );
      const nextNeighborWidth = Math.max(minWidthPx, totalWidthPx - nextWidth);

      setDraftTableColumnWidths((current) => {
        const previousWidths = current[activeTableColumnResize.blockId] ?? [];
        const nextWidths = [...previousWidths];
        nextWidths[activeTableColumnResize.columnIndex] = nextWidth;
        nextWidths[activeTableColumnResize.columnIndex + 1] = nextNeighborWidth;

        return {
          ...current,
          [activeTableColumnResize.blockId]: nextWidths,
        };
      });
    };

    const handleMouseUp = () => {
      const resizeState = activeTableColumnResizeRef.current;
      if (!resizeState) {
        return;
      }

      const draftWidths = draftTableColumnWidthsRef.current[resizeState.blockId];
      if (draftWidths) {
        updateLayoutTableColumnWidths({
          cellId: resizeState.cellId,
          columnWidthsPx: draftWidths,
        });
      }

      setActiveTableColumnResize(null);
      setDraftTableColumnWidths((current) => {
        const next = { ...current };
        delete next[resizeState.blockId];
        return next;
      });
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeTableColumnResize, updateLayoutTableColumnWidths]);

  useEffect(() => {
    if (!activeTableRowResize) {
      return;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const deltaY =
        (event.clientY - activeTableRowResize.startClientY) / Math.max(0.0001, activeTableRowResize.pageScale);
      const minHeightPx = 28;
      // 行高拖拽只调整当前行，避免把相邻行反向压缩或撑高。
      const nextHeight = Math.max(minHeightPx, Math.round(activeTableRowResize.startHeightPx + deltaY));

      setDraftTableRowHeights((current) => ({
        ...current,
        [activeTableRowResize.rowId]: nextHeight,
      }));
    };

    const handleMouseUp = () => {
      const resizeState = activeTableRowResizeRef.current;
      if (!resizeState) {
        return;
      }

      const draftHeight = draftTableRowHeightsRef.current[resizeState.rowId];
      if (draftHeight !== undefined) {
        updateLayoutTableRowHeight({
          cellId: resizeState.cellId,
          heightPx: draftHeight,
        });
      }

      setActiveTableRowResize(null);
      setDraftTableRowHeights((current) => {
        const next = { ...current };
        delete next[resizeState.rowId];
        return next;
      });
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeTableRowResize, updateLayoutTableRowHeight]);

  useEffect(() => {
    if (!editingNodeId || isEditingRichText) {
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const scrollSnapshot = pendingScrollSnapshotRef.current;
    const canvasPane = canvasPaneRef.current;
    focusCanvasEditorWithoutScroll(editor, canvasPane, scrollSnapshot);
    editor.setSelectionRange(editor.value.length, editor.value.length);
    restoreCanvasScrollSnapshot(canvasPane, scrollSnapshot);
    pendingScrollSnapshotRef.current = null;
  }, [editingNodeId, isEditingRichText]);

  useEffect(() => {
    if (!editingNodeId || !isEditingRichText) {
      return;
    }

    const editor = richEditorRef.current;
    if (!editor) {
      return;
    }

    const scrollSnapshot = pendingScrollSnapshotRef.current;
    const canvasPane = canvasPaneRef.current;
    focusCanvasEditorWithoutScroll(editor, canvasPane, scrollSnapshot);
    // 进入编辑时只负责聚焦；拖选过程中不能跟随 editingSelection 反复恢复 DOM 选区。
    restoreCanvasScrollSnapshot(canvasPane, scrollSnapshot);
    pendingScrollSnapshotRef.current = null;
  }, [editingNodeId, isEditingRichText]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    resizeCanvasEditor(editor);
  }, [editingNodeId, editingText]);

  useEffect(() => {
    if (!requestedStartEditingNodeId || editingNodeId === requestedStartEditingNodeId) {
      return;
    }

    const requestedNode = findEditableNodeByIdInBlocks(documentBlocks, requestedStartEditingNodeId);
    if (!requestedNode) {
      return;
    }

    startEditingNode(requestedNode);
    onConsumeRequestedStartEditingNode?.(requestedStartEditingNodeId);
  }, [
    documentBlocks,
    editingNodeId,
    onConsumeRequestedStartEditingNode,
    requestedStartEditingNodeId,
  ]);

  useEffect(() => {
    if (!requestedScrollToNodeId) {
      return;
    }

    const canvasPane = canvasPaneRef.current;
    if (!canvasPane) {
      return;
    }

    const target = canvasPane.querySelector<HTMLElement>(`[data-layout-node-id="${requestedScrollToNodeId}"]`);
    if (!target) {
      return;
    }

    const containerRect = canvasPane.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = canvasPane.scrollTop + (targetRect.top - containerRect.top) - 32;
    canvasPane.scrollTo({
      top: Math.max(0, nextTop),
      behavior: 'smooth',
    });
    onConsumeRequestedScrollToNode?.(requestedScrollToNodeId);
  }, [onConsumeRequestedScrollToNode, requestedScrollToNodeId]);

  useEffect(() => {
    if (!editingNodeId) {
      return;
    }

    onTextSelectionChange({
      nodeId: editingNodeId,
      text: editingDraftTextRuns ? getTextContentFromRuns(editingDraftTextRuns) : editingText,
      selection: editingSelection,
      isEditing: true,
      draftTextRuns: editingDraftTextRuns,
    });
  }, [editingDraftTextRuns, editingNodeId, editingSelection, editingText, onTextSelectionChange]);

  useEffect(() => {
    if (!editingNodeId || !isEditingRichText) {
      return;
    }

    const currentRuns = findEditableNodeTextRunsInBlocks(documentBlocks, editingNodeId);
    if (!currentRuns || !editingDraftTextRuns || currentRuns === editingDraftTextRuns) {
      return;
    }

    const currentText = getTextContentFromRuns(currentRuns);
    const draftText = getTextContentFromRuns(editingDraftTextRuns);
    // 只在文本内容一致时同步样式类外部变更，避免分页刷新或其他晚到状态覆盖用户正在输入的草稿。
    if (currentText !== draftText) {
      return;
    }

    const currentSerialized = JSON.stringify(currentRuns);
    const draftSerialized = JSON.stringify(editingDraftTextRuns);
    if (currentSerialized !== draftSerialized) {
      setEditingDraftTextRuns(currentRuns);
    }
  }, [documentBlocks, editingNodeId, isEditingRichText]);

  useLayoutEffect(() => {
    if (!shouldShowFloatingToolbar) {
      setFloatingToolbarPosition(null);
      return;
    }

    const richEditor = richEditorRef.current;
    const toolbar = floatingToolbarRef.current;
    const canvasPane = canvasPaneRef.current;
    if (!richEditor || !toolbar || !canvasPane) {
      return;
    }

    let frameId = 0;

    const updateToolbarPosition = () => {
      const selectionRect = getRichSelectionClientRect(richEditor);
      const toolbarRect = toolbar.getBoundingClientRect();
      if (!selectionRect) {
        setFloatingToolbarPosition(null);
        return;
      }

      const margin = 12;
      const gap = 10;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const clampedLeft = Math.max(
        margin,
        Math.min(
          viewportWidth - toolbarRect.width - margin,
          selectionRect.left + selectionRect.width / 2 - toolbarRect.width / 2,
        ),
      );
      const topAbove = selectionRect.top - toolbarRect.height - gap;
      const shouldPlaceBelow = topAbove < margin;
      const nextTop = shouldPlaceBelow
        ? Math.min(viewportHeight - toolbarRect.height - margin, selectionRect.bottom + gap)
        : topAbove;

      setFloatingToolbarPosition({
        left: clampedLeft,
        top: nextTop,
        placement: shouldPlaceBelow ? 'below' : 'above',
      });
    };

    const scheduleToolbarPosition = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateToolbarPosition);
    };

    scheduleToolbarPosition();
    canvasPane.addEventListener('scroll', scheduleToolbarPosition, { passive: true });
    window.addEventListener('resize', scheduleToolbarPosition);
    document.addEventListener('selectionchange', scheduleToolbarPosition);

    return () => {
      window.cancelAnimationFrame(frameId);
      canvasPane.removeEventListener('scroll', scheduleToolbarPosition);
      window.removeEventListener('resize', scheduleToolbarPosition);
      document.removeEventListener('selectionchange', scheduleToolbarPosition);
    };
  }, [documentBlocks, editingDraftTextRuns, editingNodeId, editingSelection, isEditingRichText, shouldShowFloatingToolbar]);

  useLayoutEffect(() => {
    if (!shouldShowBlockSelectionToolbar) {
      setBlockToolbarPosition(null);
      return;
    }

    const toolbar = blockToolbarRef.current;
    const canvasPane = canvasPaneRef.current;
    if (!toolbar || !canvasPane) {
      return;
    }

    let frameId = 0;

    const updateToolbarPosition = () => {
      const selectedElements = selectedBlockIds
        .map((blockId) =>
          canvasPane.querySelector<HTMLElement>(`[data-layout-node-id="${escapeDataAttributeValue(blockId)}"]`),
        )
        .filter((element): element is HTMLElement => !!element && !element.closest('.page-measurement-layer'));

      if (selectedElements.length === 0) {
        setBlockToolbarPosition(null);
        return;
      }

      const selectedRects = selectedElements.map((element) => element.getBoundingClientRect());
      const rangeRect = selectedRects.reduce(
        (acc, rect) => ({
          left: Math.min(acc.left, rect.left),
          right: Math.max(acc.right, rect.right),
          top: Math.min(acc.top, rect.top),
          bottom: Math.max(acc.bottom, rect.bottom),
        }),
        {
          left: selectedRects[0].left,
          right: selectedRects[0].right,
          top: selectedRects[0].top,
          bottom: selectedRects[0].bottom,
        },
      );
      const toolbarRect = toolbar.getBoundingClientRect();
      const margin = 12;
      const gap = 10;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const clampedLeft = Math.max(
        margin,
        Math.min(
          viewportWidth - toolbarRect.width - margin,
          rangeRect.left + (rangeRect.right - rangeRect.left) / 2 - toolbarRect.width / 2,
        ),
      );
      const topAbove = rangeRect.top - toolbarRect.height - gap;
      const shouldPlaceBelow = topAbove < margin;
      const nextTop = shouldPlaceBelow
        ? Math.min(viewportHeight - toolbarRect.height - margin, rangeRect.bottom + gap)
        : topAbove;

      setBlockToolbarPosition({
        left: clampedLeft,
        top: nextTop,
        placement: shouldPlaceBelow ? 'below' : 'above',
      });
    };

    const scheduleToolbarPosition = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateToolbarPosition);
    };

    scheduleToolbarPosition();
    canvasPane.addEventListener('scroll', scheduleToolbarPosition, { passive: true });
    window.addEventListener('resize', scheduleToolbarPosition);

    return () => {
      window.cancelAnimationFrame(frameId);
      canvasPane.removeEventListener('scroll', scheduleToolbarPosition);
      window.removeEventListener('resize', scheduleToolbarPosition);
    };
  }, [pageLayouts, selectedBlockIds, shouldShowBlockSelectionToolbar]);

  const prepareSelectingNode = (nodeId: string) => {
    if (activeImageResize && nodeId !== activeImageResize.nodeId) {
      return;
    }
    if (activeImageCrop && nodeId !== activeImageCrop.nodeId) {
      return;
    }
    if (activeTableColumnResize && nodeId !== activeTableColumnResize.cellId) {
      return;
    }
    if (activeTableRowResize && nodeId !== activeTableRowResize.cellId) {
      return;
    }
    if (editingNodeId && nodeId !== editingNodeId) {
      pendingSelectionAfterCommitRef.current = nodeId;
    }
  };

  const consumePendingSelectionAfterCommit = (): string | null => {
    const pendingNodeId = pendingSelectionAfterCommitRef.current;
    pendingSelectionAfterCommitRef.current = null;
    return pendingNodeId;
  };

  const startEditingNode = (node: EditableCanvasNode) => {
    skipBlurCommitRef.current = false;
    if (node.kind === 'equation') {
      if (editingNodeId && editingNodeId !== node.id) {
        commitEditingNode();
      }
      pendingSelectionAfterCommitRef.current = null;
      setActiveEquationEditor({
        nodeId: node.id,
        initialText: node.text,
      });
      onTextSelectionChange({
        nodeId: null,
        text: '',
        selection: null,
        isEditing: false,
        draftTextRuns: null,
      });
      return;
    }

    pendingScrollSnapshotRef.current = createCanvasScrollSnapshot(canvasPaneRef.current);
    pendingSelectionAfterCommitRef.current = null;
    setActiveEquationEditor(null);
    setActiveImageCrop(null);
    setActiveTableColumnResize(null);
    setActiveTableRowResize(null);
    setEditingNodeId(node.id);
    setEditingKind(node.kind);
    setEditingText(node.text);
    setEditingDraftTextRuns(isRichTextCanvasEditorKind(node.kind) ? node.textRuns : null);
    setEditingSelection(null);
  };

  const handleStartImageResize = (
    event: MouseEvent<HTMLButtonElement>,
    block: LayoutBlock,
    pageScale: number,
  ) => {
    if (block.type !== 'image' || block.metadata.kind !== 'image') {
      return;
    }

    const draftCrop = draftImageCrops[block.id] ?? null;
    const measuredVisibleSize = measuredImageVisibleSizes[block.id] ?? null;
    const resolved = resolveImageLayoutWithDraft(block, draftImageSizes[block.id] ?? null, draftCrop, draftImageOffsets[block.id] ?? null);
    const metrics = resolved ? resolveImageRenderMetrics(resolved, measuredVisibleSize) : null;
    const startWidthPx = metrics?.fullWidthPx ?? resolved?.widthPx ?? 320;
    const startHeightPx = metrics?.fullHeightPx ?? resolved?.heightPx ?? Math.round(startWidthPx * 0.62);
    const aspectRatio = startWidthPx > 0 && startHeightPx > 0 ? startWidthPx / startHeightPx : null;

    onSelectNode(block.id);
    setActiveImageCrop(null);
    setActiveImageResize({
      nodeId: block.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidthPx,
      startHeightPx,
      lockAspectRatio: block.metadata.lockAspectRatio ?? true,
      aspectRatio,
      pageScale,
    });
    setDraftImageSizes((current) => ({
      ...current,
      [block.id]: {
        widthPx: startWidthPx,
        heightPx: startHeightPx,
      },
    }));
  };

  // 图片拖动开始处理函数
  const handleStartImageDrag = (
    event: MouseEvent<HTMLElement>,
    block: LayoutBlock,
    pageScale: number,
  ) => {
    if (block.type !== 'image' || block.metadata.kind !== 'image') {
      return;
    }

    // 阻止浏览器默认行为，防止文本选择等干扰
    event.preventDefault();
    event.stopPropagation();

    // 拖动时取消缩放和裁剪状态
    setActiveImageResize(null);
    setActiveImageCrop(null);

    // 获取当前偏移量
    const currentLayout = resolveImageLayoutWithDraft(
      block,
      draftImageSizes[block.id] ?? null,
      draftImageCrops[block.id] ?? null,
      draftImageOffsets[block.id] ?? null,
    );
    const currentOffset = draftImageOffsets[block.id] ?? {
      offsetX: block.metadata.offsetX ?? 0,
      offsetY: block.metadata.offsetY ?? 0,
      wrapSide: currentLayout?.wrapSide,
    };
    const viewportRect = event.currentTarget.getBoundingClientRect();
    const pageBodyElement = event.currentTarget.closest<HTMLElement>('.page-body');
    const pageBodyRect = pageBodyElement?.getBoundingClientRect();
    const safeScale = Math.max(0.0001, pageScale);
    const startRenderedLeftPx = pageBodyRect
      ? Math.round((viewportRect.left - pageBodyRect.left) / safeScale)
      : currentOffset.offsetX;
    const startRenderedTopPx = pageBodyRect
      ? Math.round((viewportRect.top - pageBodyRect.top) / safeScale)
      : currentOffset.offsetY;
    const viewportWidthPx = Math.max(1, Math.round(viewportRect.width / safeScale));
    const viewportHeightPx = Math.max(1, Math.round(viewportRect.height / safeScale));
    const pageContentWidthPx = pageBodyRect
      ? Math.max(viewportWidthPx, Math.round(pageBodyRect.width / safeScale))
      : resolvedStyleContract.contentWidthPx;
    const isTextWrapped = !!currentLayout && isImageTextWrapMode(currentLayout.wrapMode);

    // 开始拖动（选中操作已在 mousedown 时完成）
    setActiveImageDrag({
      nodeId: block.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX: currentOffset.offsetX,
      startOffsetY: currentOffset.offsetY,
      startRenderedLeftPx,
      startRenderedTopPx,
      viewportWidthPx,
      viewportHeightPx,
      pageContentWidthPx,
      isTextWrapped,
      pageScale,
    });

    // 初始化 draft offsets 以便预览
    setDraftImageOffsets((current) => ({
      ...current,
      [block.id]: currentOffset,
    }));
  };

  const handleStartImageCrop = (
    event: MouseEvent<HTMLButtonElement>,
    block: LayoutBlock,
    edge: ImageCropEdge,
    pageScale: number,
  ) => {
    if (block.type !== 'image' || block.metadata.kind !== 'image') {
      return;
    }

    const currentDraftCrop = draftImageCrops[block.id] ?? null;
    const currentLayout = resolveImageLayoutWithDraft(
      block,
      draftImageSizes[block.id] ?? null,
      currentDraftCrop,
      draftImageOffsets[block.id] ?? null,
    );
    const measuredVisibleSize = measuredImageVisibleSizes[block.id] ?? null;
    const metrics = currentLayout ? resolveImageRenderMetrics(currentLayout, measuredVisibleSize) : null;
    if (!metrics?.fullWidthPx || !metrics.fullHeightPx) {
      return;
    }

    const startCrop: ImageDraftCrop = {
      cropTopPx: metrics.cropTopPx,
      cropRightPx: metrics.cropRightPx,
      cropBottomPx: metrics.cropBottomPx,
      cropLeftPx: metrics.cropLeftPx,
    };

    onSelectNode(block.id);
    setActiveImageResize(null);
    setActiveImageCrop({
      nodeId: block.id,
      edge,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCrop,
      fullWidthPx: metrics.fullWidthPx,
      fullHeightPx: metrics.fullHeightPx,
      pageScale,
    });
    setDraftImageCrops((current) => ({
      ...current,
      [block.id]: startCrop,
    }));
  };

  const handleStartTableColumnResize = (
    event: MouseEvent<HTMLButtonElement>,
    block: LayoutBlock,
    cellId: string,
    columnIndex: number,
    rowIndex: number,
    pageScale: number,
  ) => {
    if (block.type !== 'table' || block.metadata.kind !== 'table') {
      return;
    }

    const cellElement = event.currentTarget.closest('th, td') as HTMLTableCellElement | null;
    if (!cellElement) {
      return;
    }

    const row = block.metadata.rows[rowIndex];
    const nextCell = row?.cells[columnIndex + 1] ?? null;
    if (!row || !nextCell) {
      return;
    }

    const measuredWidthPx = Math.max(48, Math.round(cellElement.getBoundingClientRect().width / Math.max(0.0001, pageScale)));
    const nextCellElement = cellElement.nextElementSibling as HTMLTableCellElement | null;
    const measuredNextWidthPx = nextCellElement
      ? Math.max(48, Math.round(nextCellElement.getBoundingClientRect().width / Math.max(0.0001, pageScale)))
      : measuredWidthPx;
    const existingWidths = resolveTableColumnWidths(
      draftTableColumnWidths[block.id] ?? block.metadata.columnWidthsPx,
      block.metadata.rows[0]?.cells.length ?? 0,
      resolvedStyleContract.singleColumnContentWidthPx,
    );
    const startWidthPx = existingWidths[columnIndex] ?? measuredWidthPx;
    const startNextWidthPx = existingWidths[columnIndex + 1] ?? measuredNextWidthPx;

    onSelectNode(cellId);
    setActiveImageResize(null);
    setActiveImageCrop(null);
    setActiveTableRowResize(null);
    setActiveTableColumnResize({
      blockId: block.id,
      cellId,
      columnIndex,
      nextCellId: nextCell.id,
      startClientX: event.clientX,
      startWidthPx,
      startNextWidthPx,
      pageScale,
    });
    setDraftTableColumnWidths((current) => ({
      ...current,
      [block.id]: existingWidths,
    }));
  };

  const handleStartTableRowResize = (
    event: MouseEvent<HTMLButtonElement>,
    block: LayoutBlock,
    cellId: string,
    rowId: string,
    rowIndex: number,
    pageScale: number,
  ) => {
    if (block.type !== 'table' || block.metadata.kind !== 'table') {
      return;
    }

    const rowElement = event.currentTarget.closest('tr') as HTMLTableRowElement | null;
    if (!rowElement) {
      return;
    }

    const row = block.metadata.rows[rowIndex];
    if (!row) {
      return;
    }

    const measuredHeightPx = Math.max(28, Math.round(rowElement.getBoundingClientRect().height / Math.max(0.0001, pageScale)));
    const startHeightPx = draftTableRowHeights[rowId] ?? row.heightPx ?? measuredHeightPx;

    onSelectNode(cellId);
    setActiveImageResize(null);
    setActiveImageCrop(null);
    setActiveTableColumnResize(null);
    setActiveTableRowResize({
      rowId,
      cellId,
      startClientY: event.clientY,
      startHeightPx,
      pageScale,
    });
    setDraftTableRowHeights((current) => ({
      ...current,
      [rowId]: startHeightPx,
    }));
  };

  const handleImageLoaded = () => {
    setImageMeasureEpoch((current) => current + 1);
  };

  const commitEditingNode = () => {
    if (!editingNodeId) {
      return;
    }

    const canvasPane = canvasPaneRef.current;
    const scrollSnapshot = createCanvasScrollSnapshot(canvasPane);
    const pendingSelectionNodeId = consumePendingSelectionAfterCommit();
    const nodeId = editingNodeId;
    const nextText = editingDraftTextRuns ? getTextContentFromRuns(editingDraftTextRuns) : editingText;
    const nextSelection = editingSelection;
    const nextDraftTextRuns = editingDraftTextRuns;
    setEditingNodeId(null);
    setEditingKind(null);
    setEditingText('');
    setEditingDraftTextRuns(null);
    setEditingSelection(null);
    pendingScrollSnapshotRef.current = null;
    // 失焦提交时保留最后一次选区，方便用户立刻点击右侧样式按钮。
    onTextSelectionChange({
      nodeId,
      text: nextText,
      selection: nextSelection,
      isEditing: false,
      draftTextRuns: nextDraftTextRuns,
    });

    if (nextDraftTextRuns && isRichTextCanvasEditorKind(editingKind ?? 'paragraph')) {
      const currentRuns = findEditableNodeTextRunsInBlocks(documentBlocks, nodeId);
      // 富文本输入先留在本地草稿，失焦时再一次性写回模型，避免每个字都触发分页和隐藏测量层。
      if (!currentRuns || !areTextRunsVisuallyEqual(currentRuns, nextDraftTextRuns)) {
        onCommitNodeRichText(nodeId, nextDraftTextRuns);
      }
    } else {
      onCommitNodeText(nodeId, nextText);
    }

    if (pendingSelectionNodeId) {
      onSelectNode(pendingSelectionNodeId);
    }
    restoreCanvasScrollSnapshotSoon(canvasPane, scrollSnapshot);
  };

  const handleDraftTextRunsChange = (textRuns: TextRun[]) => {
    const canvasPane = canvasPaneRef.current;
    const scrollSnapshot = createCanvasScrollSnapshot(canvasPane);
    setEditingDraftTextRuns(textRuns);
    restoreCanvasScrollSnapshotSoon(canvasPane, scrollSnapshot);
  };

  const applyFloatingToolbarRuns = (updater: (textRuns: TextRun[], nodeId: string) => TextRun[]) => {
    if (!editingNodeId || !floatingToolbarTextRuns || !hasNonCollapsedSelection(editingSelection)) {
      return;
    }

    const nextRuns = updater(floatingToolbarTextRuns, editingNodeId);
    if (nextRuns !== floatingToolbarTextRuns) {
      handleDraftTextRunsChange(nextRuns);
    }
  };

  const handleFloatingToolbarMouseDown = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleEquationEditorCommitAndClose = ({
    nodeId,
    text,
    didChange,
  }: {
    nodeId: string;
    text: string;
    didChange: boolean;
  }) => {
    setActiveEquationEditor(null);
    onTextSelectionChange({
      nodeId: null,
      text: '',
      selection: null,
      isEditing: false,
      draftTextRuns: null,
    });
    if (didChange) {
      onCommitNodeText(nodeId, text);
    }
  };

  const toggleFloatingTextMark = (markType: TextMarkType) => {
    applyFloatingToolbarRuns((textRuns, nodeId) =>
      toggleTextMarkInTextRuns(textRuns, nodeId, editingSelection, markType),
    );
  };

  const applyFloatingTextColor = (color: string) => {
    applyFloatingToolbarRuns((textRuns, nodeId) =>
      applyTextRunPatchToTextRuns(textRuns, nodeId, editingSelection, {
        styleOverrides: { color },
      }),
    );
  };

  const applyFloatingHighlightColor = (highlightColor: string) => {
    applyFloatingToolbarRuns((textRuns, nodeId) =>
      applyTextRunPatchToTextRuns(textRuns, nodeId, editingSelection, {
        styleOverrides: { highlightColor },
      }),
    );
  };

  const applyFloatingFontFamily = (fontFamily: string) => {
    if (fontFamily === fontFamilyPlaceholderValue) {
      return;
    }

    applyFloatingToolbarRuns((textRuns, nodeId) =>
      applyTextRunPatchToTextRuns(textRuns, nodeId, editingSelection, {
        styleOverrides: { fontFamily },
      }),
    );
    setFloatingToolbarMenu(null);
  };

  const applyFloatingFontSize = (fontSize: number) => {
    const nextFontSize = normalizeFloatingFontSizeValue(fontSize);
    if (!nextFontSize) {
      return;
    }

    // 浮动条字号只写当前选区的局部覆盖；批量字体字号规则仍由顶端工具栏负责。
    applyFloatingToolbarRuns((textRuns, nodeId) =>
      applyTextRunPatchToTextRuns(textRuns, nodeId, editingSelection, {
        styleOverrides: { fontSize: nextFontSize },
      }),
    );
    setFloatingToolbarMenu(null);
  };

  const clearFloatingTextFormatting = () => {
    applyFloatingToolbarRuns((textRuns, nodeId) =>
      clearTextFormattingInTextRuns(textRuns, nodeId, editingSelection),
    );
  };

  const handleListIndentAction = (itemId: string, action: 'indent' | 'outdent') => {
    const nextSelectedNodeId = updateLayoutListItemLevel({ itemId, action });
    if (nextSelectedNodeId) {
      pendingSelectionAfterCommitRef.current = nextSelectedNodeId;
      setListItemContextMenu(null);
    }
  };

  const handleListReorderAction = (itemId: string, action: 'moveUp' | 'moveDown') => {
    const nextSelectedNodeId = reorderLayoutListItem({ itemId, action });
    if (nextSelectedNodeId) {
      pendingSelectionAfterCommitRef.current = nextSelectedNodeId;
      setListItemContextMenu(null);
    }
  };

  const listItemContextMenuEntries: ContextMenuEntry[] = [
    { id: 'move-up', label: '上移' },
    { id: 'move-down', label: '下移' },
    { separator: true },
    { id: 'indent', label: '降低一级' },
    { id: 'outdent', label: '提升一级' },
    { separator: true },
    { id: 'convert-task', label: '转任务项' },
    { id: 'convert-plain', label: '取消任务项' },
  ];

  const handleListItemContextMenuSelect = (id: string) => {
    if (!listItemContextMenu) {
      return;
    }

    if (id === 'move-up') {
      handleListReorderAction(listItemContextMenu.itemId, 'moveUp');
      return;
    }

    if (id === 'move-down') {
      handleListReorderAction(listItemContextMenu.itemId, 'moveDown');
      return;
    }

    if (id === 'indent') {
      handleListIndentAction(listItemContextMenu.itemId, 'indent');
      return;
    }

    if (id === 'outdent') {
      handleListIndentAction(listItemContextMenu.itemId, 'outdent');
      return;
    }

    if (id === 'convert-task') {
      const nextSelectedNodeId = convertLayoutListItemTaskState({
        itemId: listItemContextMenu.itemId,
        action: 'convertToTask',
      });
      if (nextSelectedNodeId) {
        pendingSelectionAfterCommitRef.current = nextSelectedNodeId;
      }
      setListItemContextMenu(null);
      return;
    }

    if (id === 'convert-plain') {
      const nextSelectedNodeId = convertLayoutListItemTaskState({
        itemId: listItemContextMenu.itemId,
        action: 'convertToPlain',
      });
      if (nextSelectedNodeId) {
        pendingSelectionAfterCommitRef.current = nextSelectedNodeId;
      }
      setListItemContextMenu(null);
      return;
    }

    setListItemContextMenu(null);
  };

  const cancelEditingNode = () => {
    const canvasPane = canvasPaneRef.current;
    const scrollSnapshot = createCanvasScrollSnapshot(canvasPane);
    const pendingSelectionNodeId = consumePendingSelectionAfterCommit();
    skipBlurCommitRef.current = true;
    setEditingNodeId(null);
    setEditingKind(null);
    setEditingText('');
    setEditingDraftTextRuns(null);
    setEditingSelection(null);
    pendingScrollSnapshotRef.current = null;
    onTextSelectionChange({
      nodeId: null,
      text: '',
      selection: null,
      isEditing: false,
      draftTextRuns: null,
    });
    if (pendingSelectionNodeId) {
      onSelectNode(pendingSelectionNodeId);
    }
    restoreCanvasScrollSnapshotSoon(canvasPane, scrollSnapshot);
  };

  const commitEditingNodeOnBlur = () => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }

    commitEditingNode();
  };

  const pageTitles = buildHeaderFooterPageTitles(pageLayouts, documentTitle);

  return (
    <section
      className={isCondensed ? 'canvas-pane canvas-pane-condensed' : 'canvas-pane'}
      aria-label="分页预览"
    >
      <div className="canvas-pane-head">
        <div>
          <strong>分页预览</strong>
          <span>{pageLayouts.length} 页</span>
        </div>
        <div className="canvas-pane-meta">
          <span>
            {resolvedStyleContract.pageLabel} · {resolvedStyleContract.templateThemeLabel} · {documentBlockCount} 个结构块
          </span>
        </div>
      </div>
      <div className="canvas-pane-body">
        {fontFaceCss ? <style>{fontFaceCss}</style> : null}
        {activeEquationEditor ? (
          <EquationEditorOverlay
            nodeId={activeEquationEditor.nodeId}
            initialText={activeEquationEditor.initialText}
            scrollContainerRef={canvasPaneRef}
            onCommitAndClose={handleEquationEditorCommitAndClose}
          />
        ) : null}
        {listItemContextMenu ? (
          <ContextMenu
            x={listItemContextMenu.x}
            y={listItemContextMenu.y}
            items={listItemContextMenuEntries}
            onSelect={handleListItemContextMenuSelect}
            onClose={() => setListItemContextMenu(null)}
          />
        ) : null}
        {shouldShowFloatingToolbar ? (
          <div
            ref={floatingToolbarRef}
            className={
              floatingToolbarPosition?.placement === 'below'
                ? 'floating-format-toolbar floating-format-toolbar-below'
                : 'floating-format-toolbar'
            }
            style={
              floatingToolbarPosition
                ? {
                    left: `${floatingToolbarPosition.left}px`,
                    top: `${floatingToolbarPosition.top}px`,
                  }
                : {
                    left: '-9999px',
                    top: '-9999px',
                    visibility: 'hidden',
                  }
            }
            onMouseDown={handleFloatingToolbarMouseDown}
            onClick={(event) => event.stopPropagation()}
          >
            {floatingTextMarkOptions.map((option) => {
              const Icon = option.icon;
              const isActive =
                floatingToolbarTextRuns && isFloatingTextMarkActive(floatingToolbarTextRuns, editingSelection, option.id);

              return (
                <button
                  key={option.id}
                  type="button"
                  className={isActive ? 'format-icon-button active' : 'format-icon-button'}
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={isActive}
                  onMouseDown={handleFloatingToolbarMouseDown}
                  onClick={() => toggleFloatingTextMark(option.id)}
                >
                  <Icon size={16} />
                </button>
              );
            })}
            <span className="floating-toolbar-divider" aria-hidden="true" />
            <div className="floating-toolbar-menu-control">
              <button
                type="button"
                className="floating-toolbar-select-button"
                title="选择字体"
                aria-label="选择字体"
                aria-expanded={floatingToolbarMenu === 'fontFamily'}
                onMouseDown={handleFloatingToolbarMouseDown}
                onClick={() =>
                  setFloatingToolbarMenu((current) => (current === 'fontFamily' ? null : 'fontFamily'))
                }
              >
                <span>{currentFloatingFontFamilyLabel}</span>
              </button>
              {floatingToolbarMenu === 'fontFamily' ? (
                <div className="floating-toolbar-menu floating-toolbar-font-menu" role="menu" aria-label="浮动工具条字体">
                  {floatingFontFamilyGroups.map((group) => (
                    <div key={`floating-font-group-${group.label}`} className="floating-toolbar-menu-section">
                      <span className="floating-toolbar-menu-title">{group.label}</span>
                      {group.options.map((option) => (
                        <button
                          key={`floating-font-${option.value}`}
                          type="button"
                          className={
                            currentFloatingFontFamily === option.value
                              ? 'floating-toolbar-menu-item active'
                              : 'floating-toolbar-menu-item'
                          }
                          title={`字体：${option.label}`}
                          aria-label={`字体：${option.label}`}
                          onMouseDown={handleFloatingToolbarMouseDown}
                          onClick={() => applyFloatingFontFamily(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="floating-toolbar-menu-control">
              <button
                type="button"
                className="floating-toolbar-select-button compact"
                title="选择字号"
                aria-label="选择字号"
                aria-expanded={floatingToolbarMenu === 'fontSize'}
                onMouseDown={handleFloatingToolbarMouseDown}
                onClick={() =>
                  setFloatingToolbarMenu((current) => (current === 'fontSize' ? null : 'fontSize'))
                }
              >
                <span>{currentFloatingFontSizeLabel}</span>
              </button>
              {floatingToolbarMenu === 'fontSize' ? (
                <div className="floating-toolbar-menu floating-toolbar-size-menu" role="menu" aria-label="浮动工具条字号">
                  {floatingFontSizePresetOptions.map((fontSize) => (
                    <button
                      key={`floating-font-size-${fontSize}`}
                      type="button"
                      className={
                        currentFloatingFontSize === fontSize
                          ? 'floating-toolbar-menu-item active'
                          : 'floating-toolbar-menu-item'
                      }
                      title={`字号：${fontSize}px`}
                      aria-label={`字号：${fontSize}px`}
                      onMouseDown={handleFloatingToolbarMouseDown}
                      onClick={() => applyFloatingFontSize(fontSize)}
                    >
                      {fontSize}px
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="floating-toolbar-divider" aria-hidden="true" />
            <span className="format-color-label text-color-mark" aria-hidden="true">A</span>
            <div className="format-swatch-list" aria-label="浮动工具条文字颜色">
              {standardColorOptions.map((option) => (
                <button
                  key={`floating-text-${option.value}`}
                  type="button"
                  className={currentFloatingTextColor === option.value ? 'format-swatch active' : 'format-swatch'}
                  title={`文字颜色：${option.label}`}
                  aria-label={`文字颜色：${option.label}`}
                  onMouseDown={handleFloatingToolbarMouseDown}
                  onClick={() => applyFloatingTextColor(option.value)}
                >
                  <span style={{ backgroundColor: option.value }} />
                </button>
              ))}
            </div>
            <span className="format-color-label highlight-mark" aria-hidden="true">
              <Highlighter size={14} />
            </span>
            <div className="format-swatch-list" aria-label="浮动工具条高亮颜色">
              {highlightColorOptions.map((option) => (
                <button
                  key={`floating-highlight-${option.value}`}
                  type="button"
                  className={currentFloatingHighlightColor === option.value ? 'format-swatch active' : 'format-swatch'}
                  title={`高亮颜色：${option.label}`}
                  aria-label={`高亮颜色：${option.label}`}
                  onMouseDown={handleFloatingToolbarMouseDown}
                  onClick={() => applyFloatingHighlightColor(option.value)}
                >
                  <span style={{ backgroundColor: option.value }} />
                </button>
              ))}
            </div>
            <span className="floating-toolbar-divider" aria-hidden="true" />
            <button
              type="button"
              className="format-clear-button"
              title="清除文字格式"
              aria-label="清除文字格式"
              onMouseDown={handleFloatingToolbarMouseDown}
              onClick={clearFloatingTextFormatting}
            >
              <Eraser size={15} />
              <span>清除</span>
            </button>
          </div>
        ) : null}
        {shouldShowBlockSelectionToolbar ? (
          <div
            ref={blockToolbarRef}
            className={
              blockToolbarPosition?.placement === 'below'
                ? 'floating-format-toolbar floating-format-toolbar-below block-selection-toolbar'
                : 'floating-format-toolbar block-selection-toolbar'
            }
            style={
              blockToolbarPosition
                ? {
                    left: `${blockToolbarPosition.left}px`,
                    top: `${blockToolbarPosition.top}px`,
                  }
                : {
                    left: '-9999px',
                    top: '-9999px',
                    visibility: 'hidden',
                  }
            }
            onMouseDown={handleFloatingToolbarMouseDown}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="format-clear-button block-selection-merge-button"
              title="合并选中块"
              aria-label="合并选中块"
              onMouseDown={handleFloatingToolbarMouseDown}
              onClick={(event) => {
                event.stopPropagation();
                onMergeSelectedBlocks();
              }}
            >
              <Combine size={15} />
              <span>合并</span>
            </button>
            <button
              type="button"
              className="format-clear-button block-selection-merge-button"
              title="设为双栏"
              aria-label="设为双栏"
              onMouseDown={handleFloatingToolbarMouseDown}
              onClick={(event) => {
                event.stopPropagation();
                onWrapSelectedBlocksInColumns();
              }}
            >
              <Columns2 size={15} />
              <span>设为双栏</span>
            </button>
          </div>
        ) : null}
        <div ref={canvasPaneRef} className="canvas-pane-scroll">
          {parseState === 'error' && parseError ? (
            <div className="canvas-state canvas-state-error">{parseError}</div>
          ) : null}
          {parseState === 'parsing' && documentBlockCount === 0 ? (
            <div className="canvas-state">正在导入 Markdown…</div>
          ) : null}
          <div className="page-stack" ref={pageStackRef}>
            {pageLayouts.map((page, pageIndex) => {
              const pageTitle = pageTitles[pageIndex] ?? documentTitle;
              const { frameStyle, pageStyle } = createPageDisplayStyles(page, isCondensed, pageStackWidth);
              const displayWidth = resolvePageDisplayWidth(page.contract.pageWidthPx, isCondensed, pageStackWidth);
              const pageScale = displayWidth / page.contract.pageWidthPx;
              const renderedHeaderFooter = renderHeaderFooterContent(headerFooterContent, {
                documentTitle,
                pageTitle,
                pageNumber: page.pageNumber,
                totalPages: pageLayouts.length,
                contract: page.contract,
              });

              return (
                <div
                  className="page-frame"
                  key={page.pageNumber}
                  style={frameStyle}
                >
                  <div
                    className="page"
                    data-theme-id={page.contract.themeId}
                    style={pageStyle}
                    onClick={
                      activeImageResize || activeImageCrop || activeTableColumnResize || activeTableRowResize
                        ? undefined
                        : onClearSelection
                    }
                  >
                    {renderPdfWatermarkLayer(page, pdfWatermarkSettings)}
                    <div className="page-header">
                      <span>{renderedHeaderFooter.header.left}</span>
                      <span>{renderedHeaderFooter.header.center}</span>
                      <span>{renderedHeaderFooter.header.right}</span>
                    </div>
                    <article className={pageBodyClassName}>
                      {(() => {
                        const renderedBlocks: ReactNode[] = [];

                        for (let index = 0; index < page.blocks.length; index += 1) {
                          const block = page.blocks[index];


                          renderedBlocks.push(
                            renderBlock(
                              block,
                              page.pageNumber * 1000 + index,
                              selectedNodeId,
                              selectedBlockIds,
                              onSelectNode,
                              onSelectBlock,
                              onSelectTableCell,
                              prepareSelectingNode,
                              editingNodeId,
                              activeEquationEditorNodeId,
                              editingKind,
                              editingText,
                              editingDraftTextRuns,
                              editingSelection,
                              setEditingSelection,
                              editorRef,
                              richEditorRef,
                              startEditingNode,
                              setEditingText,
                              handleDraftTextRunsChange,
                              commitEditingNodeOnBlur,
                              cancelEditingNode,
                              tocItems,
                              onNavigateToNode,
                              draftImageSizes,
                              draftImageCrops,
                              measuredImageVisibleSizes,
                              handleImageLoaded,
                              handleStartImageResize,
                              handleStartImageCrop,
                              draftImageOffsets,
                              handleStartImageDrag,
                              {
                                pageContract: resolvedStyleContract,
                                draftTableColumnWidths,
                                draftTableRowHeights,
                                onStartTableColumnResize: handleStartTableColumnResize,
                                onStartTableRowResize: handleStartTableRowResize,
                              },
                              tableSelection,
                              documentStyles,
                              semanticRoleConfig,
                              answerDisplayMode,
                              (event, itemId) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onSelectNode(itemId);
                                setListItemContextMenu({
                                  x: event.clientX,
                                  y: event.clientY,
                                  itemId,
                                });
                              },
                              Number.isFinite(pageScale) ? pageScale : 1,
                            ),
                          );
                        }

                        // 多栏内容放进无内边距的真实分栏流里，让栏宽只按正文区计算；
                        // 放不下的文本必须由分页算法切到后续栏或下一页，不能靠隐藏溢出来解决。
                        return isMultiColumnPage
                          ? <div className="page-column-flow">{renderedBlocks}</div>
                          : renderedBlocks;
                      })()}
                    </article>
                    <div className="page-footer">
                      <span>{renderedHeaderFooter.footer.left}</span>
                      <span>{renderedHeaderFooter.footer.center}</span>
                      <span>{renderedHeaderFooter.footer.right}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div
            ref={measurementLayerRef}
            className="page-measurement-layer"
            data-theme-id={resolvedStyleContract.themeId}
            aria-hidden="true"
            style={measurementPageStyle}
          >
            <article className="page-body page-body-measurement">
              {documentBlocks.map((block, index) => (
                <div
                  key={`measure-${block.id}`}
                  data-measure-block-id={block.id}
                  className="measurement-block"
                  style={buildMeasurementBlockStyle(block, resolvedStyleContract)}
                >
                  {renderBlock(
                    block,
                    900000 + index,
                    null,
                    [],
                    () => undefined,
                    undefined,
                    () => undefined,
                    () => undefined,
                    null,
                    null,
                    null,
                    '',
                    null,
                    null,
                    () => undefined,
                    editorRef,
                    richEditorRef,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    tocItems,
                    undefined,
                    {},
                    {},
                    measuredImageVisibleSizes,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    {},
                    () => undefined,
                    {
                      pageContract: resolvedStyleContract,
                      draftTableColumnWidths: {},
                      draftTableRowHeights: {},
                    },
                    null,
                    documentStyles,
                    semanticRoleConfig,
                    answerDisplayMode,
                    () => undefined,
                    1,
                  )}
                </div>
              ))}
              {textFragmentMeasurementJobs.map((job, index) => (
                <div
                  key={`measure-fragment-${job.id}`}
                  data-measure-text-fragment-id={job.id}
                  className="measurement-block measurement-text-fragment"
                  style={buildMeasurementBlockStyle(job.block, resolvedStyleContract)}
                >
                  {renderBlock(
                    job.block,
                    910000 + index,
                    null,
                    [],
                    () => undefined,
                    undefined,
                    () => undefined,
                    () => undefined,
                    null,
                    null,
                    null,
                    '',
                    null,
                    null,
                    () => undefined,
                    editorRef,
                    richEditorRef,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    tocItems,
                    undefined,
                    {},
                    {},
                    measuredImageVisibleSizes,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    {},
                    () => undefined,
                    {
                      pageContract: resolvedStyleContract,
                      draftTableColumnWidths: {},
                      draftTableRowHeights: {},
                    },
                    null,
                    documentStyles,
                    semanticRoleConfig,
                    answerDisplayMode,
                    () => undefined,
                    1,
                  )}
                </div>
              ))}
              {tableRowMeasurementJobs.map((job, index) => (
                <div
                  key={`measure-table-row-${job.id}`}
                  data-measure-table-job-id={job.id}
                  className="measurement-block measurement-table-row"
                  style={buildMeasurementBlockStyle(job.block, resolvedStyleContract)}
                >
                  {renderBlock(
                    job.block,
                    920000 + index,
                    null,
                    [],
                    () => undefined,
                    undefined,
                    () => undefined,
                    () => undefined,
                    null,
                    null,
                    null,
                    '',
                    null,
                    null,
                    () => undefined,
                    editorRef,
                    richEditorRef,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    tocItems,
                    undefined,
                    {},
                    {},
                    measuredImageVisibleSizes,
                    () => undefined,
                    () => undefined,
                    () => undefined,
                    {},
                    () => undefined,
                    {
                      pageContract: resolvedStyleContract,
                      draftTableColumnWidths: {},
                      draftTableRowHeights: {},
                    },
                    null,
                    documentStyles,
                    semanticRoleConfig,
                    answerDisplayMode,
                    () => undefined,
                    1,
                  )}
                </div>
              ))}
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}

export const CanvasPane = memo(CanvasPaneComponent);
