export type LayoutDocumentVersion = '1.0.0';
export type ParseState = 'idle' | 'parsing' | 'ready' | 'error';
export type DocumentFormat = 'markdown' | 'layout';

export interface TocItem {
  id: string;
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  pageNumber?: number;
}

export type LayoutBlockType =
  | 'paragraph'
  | 'heading'
  | 'toc'
  | 'list'
  | 'table'
  | 'image'
  | 'equation'
  | 'blockquote'
  | 'code'
  | 'horizontalRule'
  | 'columnBreak'
  | 'pageBreak';

export interface SourcePoint {
  line: number;
  column: number;
  offset: number | null;
}

export interface SourceRange {
  start: SourcePoint;
  end: SourcePoint;
}

export type TextMarkType = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link' | 'color';

export interface TextMark {
  type: TextMarkType;
  href?: string;
  title?: string | null;
}

export interface TextStyleOverrides {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  highlightColor?: string;
  backgroundColor?: string;
  letterSpacing?: number;
}

export interface AnswerAnnotation {
  type: 'answer';
  id: string;
  blankMode: 'underline' | 'hidden';
}

export type TextAnnotation = AnswerAnnotation;

export interface TextRun {
  id: string;
  text: string;
  sourceRange: SourceRange | null;
  marks: TextMark[];
  charStyleRef: string | null;
  styleOverrides: TextStyleOverrides;
  annotations: TextAnnotation[];
}

export interface BlockStyleOverrides {
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  // 预留给后续更完整的段落盒模型控制，当前分页估算与导出链路暂未消费。
  indentLeft?: number;
  // 预留给后续更完整的段落盒模型控制，当前分页估算与导出链路暂未消费。
  indentRight?: number;
  firstLineIndent?: number;
  // 当前只在标题/段落样式链路中消费，用来表达“后续行整体右移”的悬挂缩进。
  hangingIndent?: number;
  backgroundColor?: string;
}

export interface BlockPagination {
  pageBreakBefore?: boolean;
  pageBreakAfter?: boolean;
  columnBreakAfter?: boolean;
  keepWithNext?: boolean;
  keepLinesTogether?: boolean;
}

export interface LayoutListItem {
  id: string;
  sourceRange: SourceRange | null;
  textRuns: TextRun[];
  // 多级列表先固定支持 1-3 级；旧文档缺字段时按 1 级兼容。
  level?: number;
  checked: boolean | null;
  // 只给分页运行时片段使用：同一个列表项续到下一页时隐藏重复的编号、符号或任务勾选框。
  runtimePagination?: {
    hideMarker?: boolean;
  };
}

export interface LayoutTableCell {
  id: string;
  sourceRange: SourceRange | null;
  textRuns: TextRun[];
  isHeader: boolean;
  // 合并单元格 V1：主单元格保存跨度；旧文档缺字段时按 1 x 1 普通单元格兼容。
  rowSpan?: number | null;
  colSpan?: number | null;
  // 被主单元格覆盖的格子不渲染内容，但仍保留在模型网格中，方便后续拆分能力继续找回结构。
  coveredByCellId?: string | null;
}

export interface LayoutTableRow {
  id: string;
  sourceRange: SourceRange | null;
  cells: LayoutTableCell[];
  // 表格行高是可选的最小高度；旧文档缺字段时继续按模板默认高度自动排版。
  heightPx?: number | null;
}

export type TableColumnAlign = 'left' | 'center' | 'right' | null;

export interface ParagraphBlockMetadata {
  kind: 'paragraph';
  text: string;
}

export interface HeadingBlockMetadata {
  kind: 'heading';
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export interface TocBlockMetadata {
  kind: 'toc';
  title: string;
  maxDepth: 1 | 2 | 3;
  // 运行时目录片段只存在于分页结果，用来表示当前页显示过滤后目录项的哪一段；不会写回 .layout 原文档。
  runtimeSlice?: {
    startIndex: number;
    endIndex: number;
    fragmentIndex: number;
    totalItems: number;
  };
}

export interface ListBlockMetadata {
  kind: 'list';
  ordered: boolean;
  start: number | null;
  spread: boolean;
  items: LayoutListItem[];
}

export interface TableBlockMetadata {
  kind: 'table';
  align: TableColumnAlign[];
  // 每列宽度以排版像素保存；缺省列按自动宽度兼容旧文档。
  columnWidthsPx?: Array<number | null>;
  rows: LayoutTableRow[];
}

export type ImageWrapMode = 'inline' | 'square' | 'topBottom' | 'tight';
export type LegacyImageWrapMode = 'block' | 'center' | 'left' | 'right';
export type ImageWrapSide = 'left' | 'right';

export interface ImageBlockMetadata {
  kind: 'image';
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
  // 新环绕模式对齐 Word 常用名称；旧文档里的 block/center/left/right 由解析层兼容。
  wrapMode?: ImageWrapMode | LegacyImageWrapMode;
  // 四周型/紧密型需要保存图片靠左或靠右，旧 left/right 会自动映射到这里。
  wrapSide?: ImageWrapSide;
  // 新增：标题显示开关，默认 false（不显示标题）
  showCaption?: boolean;
  // 新增：位置偏移量（单位px，相对于原始位置的偏移）
  offsetX?: number | null;
  offsetY?: number | null;
}

export interface EquationBlockMetadata {
  kind: 'equation';
  value: string;
}

export interface BlockquoteBlockMetadata {
  kind: 'blockquote';
  blocks: LayoutBlock[];
}

export interface CodeBlockMetadata {
  kind: 'code';
  language: string | null;
  value: string;
}

export interface HorizontalRuleBlockMetadata {
  kind: 'horizontalRule';
}

export interface PageBreakBlockMetadata {
  kind: 'pageBreak';
  command: string;
}

export interface ColumnBreakBlockMetadata {
  kind: 'columnBreak';
  command: string;
}

export type LayoutBlockMetadata =
  | ParagraphBlockMetadata
  | HeadingBlockMetadata
  | TocBlockMetadata
  | ListBlockMetadata
  | TableBlockMetadata
  | ImageBlockMetadata
  | EquationBlockMetadata
  | BlockquoteBlockMetadata
  | CodeBlockMetadata
  | HorizontalRuleBlockMetadata
  | ColumnBreakBlockMetadata
  | PageBreakBlockMetadata;

export interface LayoutBlock {
  id: string;
  type: LayoutBlockType;
  sourceRange: SourceRange | null;
  blockStyleRef: string | null;
  blockStyleOverrides: BlockStyleOverrides;
  textRuns: TextRun[];
  pagination: BlockPagination;
  metadata: LayoutBlockMetadata;
}

export interface LayoutImageResource {
  id: string;
  type: 'image';
  src: string;
  alt: string;
  title: string | null;
  blockId: string;
}

export type LayoutFontFormat = 'truetype' | 'opentype' | 'woff' | 'woff2';

export interface LayoutFontResource {
  id: string;
  type: 'font';
  src: string;
  displayName: string;
  fontFamily: string;
  format: LayoutFontFormat;
  originalFileName: string;
  importedAt: string;
}

export type LayoutResource = LayoutImageResource | LayoutFontResource;

export interface LayoutStyleSheet {
  blockStyles: Record<string, BlockStyleOverrides>;
  textStyles: Record<string, TextStyleOverrides>;
}

export interface LayoutTemplateState {
  templateId: string | null;
  templateOverrides: Record<string, unknown>;
}

export type AnswerDisplayMode = 'show' | 'hide' | 'underline';

export interface LayoutViewState {
  answerDisplayMode: AnswerDisplayMode;
  zoom: number;
  selectedNodeId: string | null;
  tableSelection?: TableCellRangeSelection | null;
  blockSelection?: BlockRangeSelection | null;
}

export interface BlockRangeSelection {
  anchorBlockId: string;
  focusBlockId: string;
  blockIds: string[];
}

export interface TableCellRangeSelection {
  tableBlockId: string;
  anchorCellId: string;
  focusCellId: string;
  cellIds: string[];
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
}

export interface LayoutDocumentMeta {
  sourceFormat: 'markdown';
  wordCount: number;
  characterCount: number;
  blockCount: number;
  updatedAt: string;
  /** 语法映射配置（可选，不存在时使用默认配置） */
  syntaxMappingConfig?: {
    version: '1.0.0';
    textMarkMappings: Array<{
      id: string;
      name: string;
      enabled: boolean;
      pattern: string;
      markType: TextMarkType;
      description?: string;
      priority?: number;
    }>;
    blockCommandMappings: Array<{
      id: string;
      name: string;
      enabled: boolean;
      command: string;
      targetBlockType: 'blockquote' | 'code' | 'paragraph';
      metadata?: Record<string, unknown>;
      description?: string;
      priority?: number;
    }>;
  };
}

export interface LayoutDocument {
  version: LayoutDocumentVersion;
  id: string;
  title: string;
  source: string;
  blocks: LayoutBlock[];
  resources: LayoutResource[];
  styles: LayoutStyleSheet;
  template: LayoutTemplateState;
  viewState: LayoutViewState;
  meta: LayoutDocumentMeta;
}

export interface TextRangeSelection {
  start: number;
  end: number;
}

export interface TextRunPatch {
  marks?: TextMark[];
  charStyleRef?: string | null;
  styleOverrides?: TextStyleOverrides;
  annotations?: TextAnnotation[];
}
