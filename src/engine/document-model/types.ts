export type LayoutDocumentVersion = '1.0.0';
export type ParseState = 'idle' | 'parsing' | 'ready' | 'error';
export type DocumentFormat = 'markdown' | 'layout';

export interface TocItem {
  id: string;
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export type LayoutBlockType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'table'
  | 'image'
  | 'equation'
  | 'blockquote'
  | 'code'
  | 'horizontalRule'
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

export type TextMarkType = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link';

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
  keepWithNext?: boolean;
  keepLinesTogether?: boolean;
}

export interface LayoutListItem {
  id: string;
  sourceRange: SourceRange | null;
  textRuns: TextRun[];
  checked: boolean | null;
}

export interface LayoutTableCell {
  id: string;
  sourceRange: SourceRange | null;
  textRuns: TextRun[];
  isHeader: boolean;
}

export interface LayoutTableRow {
  id: string;
  sourceRange: SourceRange | null;
  cells: LayoutTableCell[];
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
  rows: LayoutTableRow[];
}

export interface ImageBlockMetadata {
  kind: 'image';
  src: string;
  alt: string;
  title: string | null;
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

export type LayoutBlockMetadata =
  | ParagraphBlockMetadata
  | HeadingBlockMetadata
  | ListBlockMetadata
  | TableBlockMetadata
  | ImageBlockMetadata
  | EquationBlockMetadata
  | BlockquoteBlockMetadata
  | CodeBlockMetadata
  | HorizontalRuleBlockMetadata
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

export interface LayoutResource {
  id: string;
  type: 'image';
  src: string;
  alt: string;
  title: string | null;
  blockId: string;
}

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
}

export interface LayoutDocumentMeta {
  sourceFormat: 'markdown';
  wordCount: number;
  characterCount: number;
  blockCount: number;
  updatedAt: string;
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
