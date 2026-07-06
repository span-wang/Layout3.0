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

export type LayoutListKind = 'ordered' | 'unordered';

export type BuiltInSemanticRoleId =
  | 'title'
  | 'section'
  | 'question'
  | 'answer'
  | 'explanation'
  | 'key-point'
  | 'pitfall'
  | 'caption'
  | 'example'
  | 'step'
  | 'summary'
  | 'warning';

export type SemanticRoleId = BuiltInSemanticRoleId | (string & {});

export type SemanticRoleCategory = 'general' | 'note' | 'exam' | 'reading' | 'custom';

export type SemanticBlockPresetId =
  | 'defaultSemanticFrame'
  | 'sideAccent'
  | 'softCard'
  | 'warningFrame';

export interface SemanticRole {
  id: SemanticRoleId;
  name: string;
  category: SemanticRoleCategory;
  description?: string;
  color?: string;
  enabled?: boolean;
  builtIn?: boolean;
  // 语义角色只负责“默认推荐哪种块模板”；块自身仍可手动覆盖。
  defaultBlockPresetId?: SemanticBlockPresetId | null;
}

export interface SemanticBlockPresetDefinition {
  id: SemanticBlockPresetId;
  name: string;
  description?: string;
  // 普通块手动套模板时，没有语义颜色可跟随，回退到模板自己的中性色。
  neutralColor?: string;
}

export interface LayoutBlockSemantic {
  roleId: SemanticRoleId;
  alias?: string;
  source: 'manual' | 'markdown-prefix' | 'keyword' | 'ai';
  confidence?: number;
}

export interface LayoutSemanticRoleDefinition {
  id: SemanticRoleId;
  name: string;
  description?: string;
  color?: string;
  enabled: boolean;
  // 只给自定义语义角色使用：允许用户指定该角色默认跟随哪一种块模板。
  defaultBlockPresetId?: SemanticBlockPresetId | null;
}

export interface LayoutSemanticKeywordRule {
  id: string;
  roleId: SemanticRoleId;
  keyword: string;
  matchMode: 'prefix';
  stripKeyword: boolean;
  enabled: boolean;
}

export interface LayoutSemanticRoleConfig {
  version: '1.0.0';
  customRoles: LayoutSemanticRoleDefinition[];
  keywordRules: LayoutSemanticKeywordRule[];
}

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
  // 记录该列表项所在列表层的标记类型；旧文档缺字段时由列表块根层 ordered 兼容推断。
  listKind?: LayoutListKind;
  checked: boolean | null;
  // 只给运行时分页片段使用：记录该片段对应原始文本节点与字符区间，方便隐藏测量结果跨页续用。
  runtimeMeasurement?: RuntimeTextMeasurement | null;
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
  // 只给运行时分页片段使用：记录该片段对应原始文本节点与字符区间，方便隐藏测量结果跨页续用。
  runtimeMeasurement?: RuntimeTextMeasurement | null;
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
  // 只给运行时分页片段使用：让拆出的行或续页表头仍能命中原始行的真实测量结果。
  runtimeMeasurement?: RuntimeRowMeasurement | null;
  // 表格行高是可选的最小高度；旧文档缺字段时继续按模板默认高度自动排版。
  heightPx?: number | null;
}

export interface RuntimeTextMeasurement {
  sourceNodeId: string;
  startOffset: number;
  endOffset: number;
}

export interface RuntimeRowMeasurement {
  sourceRowId: string;
}

export type TableColumnAlign = 'left' | 'center' | 'right' | null;

export interface LayoutBlockSemanticPresetState {
  // 当前块手动指定的块模板；有语义时表示“手动覆盖语义默认模板”，无语义时表示普通块的手动模板。
  manualPresetId?: SemanticBlockPresetId;
  // 只在块进入语义默认接管后存在；null 表示进入语义前原本没有块模板。
  preSemanticPresetId?: SemanticBlockPresetId | null;
}

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

// PH2-20-block-split-text-rendering-adaptation-v1：文本块（heading / paragraph）运行时切片元数据。
// 与 table / list / toc 同口径，把"续排位置"从隐式 id 后缀转为结构化字段。
// 字符偏移量与 LayoutBlock.runtimeMeasurement 字段同步：sourceNodeId 指原始块 id；
// characterRange 表示本片段在原始文本中的字符区间（闭区间，含端点）。
export interface TextBlockRuntimeSlice {
  // true = 续排片段（-rest-）；false = 当前页片段（-frag-）或原始块整放。
  isContinuation: boolean;
  // true = 原始块整放（即 preserveOriginalIdentity=true），没有跨页切分；与 isContinuation 互斥。
  isOriginal: boolean;
  // 原始块 id，用于把当前片段映射回原始来源。
  sourceNodeId: string;
  // 字符区间（含端点）；在原文本中的 start / end 偏移。
  characterRange: {
    start: number;
    end: number;
  };
  // 调试用：保留当前 fragment 后缀（-frag-PAGE-BLOCK / -rest-PAGE-BLOCK）。
  fragmentIdSuffix: string;
}

export interface ParagraphBlockMetadata {
  kind: 'paragraph';
  text: string;
  runtimeSlice?: TextBlockRuntimeSlice;
}

export interface HeadingBlockMetadata {
  kind: 'heading';
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  runtimeSlice?: TextBlockRuntimeSlice;
}

export interface ListBlockMetadata {
  kind: 'list';
  ordered: boolean;
  start: number | null;
  spread: boolean;
  items: LayoutListItem[];
  // 运行时列表片段只存在于分页结果，用来表示当前页显示过滤后列表项的哪一段；不会写回 .layout 原文档。
  runtimeSlice?: {
    startIndex: number;
    endIndex: number;
    fragmentIndex: number;
    totalItems: number;
    isContinuation: boolean;
  };
}

export interface TableBlockMetadata {
  kind: 'table';
  align: TableColumnAlign[];
  // 每列宽度以排版像素保存；缺省列按自动宽度兼容旧文档。
  columnWidthsPx?: Array<number | null>;
  rows: LayoutTableRow[];
  // 运行时表格片段只存在于分页结果，用来表示当前页显示过滤后表格行的哪一段；不会写回 .layout 原文档。
  runtimeSlice?: {
    startRowIndex: number;
    endRowIndex: number;
    fragmentIndex: number;
    totalFragments: number;
    isContinuation: boolean;
  };
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
  // 语义块基础层：不改变块类型，只记录当前块承担的内容角色。
  semantic?: LayoutBlockSemantic;
  // 块模板状态放在块顶层，避免“普通块也能独立套模板”时被 semantic 壳结构绑死。
  semanticPreset?: LayoutBlockSemanticPresetState;
  blockStyleRef: string | null;
  blockStyleOverrides: BlockStyleOverrides;
  textRuns: TextRun[];
  pagination: BlockPagination;
  // 只给运行时分页片段使用：让跨页后的标题/段落片段继续命中原始隐藏测量结果。
  runtimeMeasurement?: RuntimeTextMeasurement | null;
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
  /** 自定义语义块与关键词规则配置（可选，不存在时使用空配置） */
  semanticRoleConfig?: LayoutSemanticRoleConfig;
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
