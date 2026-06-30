export type PageSizeId = 'A3' | 'A4' | 'B5';

export type PageOrientation = 'portrait' | 'landscape';

export type MarginMode = 'preset' | 'custom';

export type MarginPresetId = 'normal' | 'narrow' | 'wide';

export type HeaderFooterPresetId = 'none' | 'compact' | 'standard';

export type TemplateId = 'default' | 'lecture' | 'notes';

export type ThemeId = 'default' | 'snowMountain' | 'handDrawn';

export type ImageAlign = 'left' | 'center' | 'right';

export type PageBackgroundMode = 'theme' | 'color' | 'image';

export type PageBackgroundImageFit = 'cover' | 'contain' | 'repeat';

export interface PageBackgroundSettings {
  mode: PageBackgroundMode;
  color: string;
  imageSrc: string;
  imageFit: PageBackgroundImageFit;
}

export type HeaderFooterArea = 'header' | 'footer';

export type HeaderFooterSlot = 'left' | 'center' | 'right';

export type PageColumnCount = 1 | 2 | 3;

export interface ColumnSettings {
  count: PageColumnCount;
  gapMm: number;
  divider: boolean;
  headingsSpanAll: boolean;
}

export interface BoxInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type MarginSide = keyof BoxInsets;

export interface PaginationBehavior {
  keepHeadingWithNext: boolean;
  avoidBreakInsideCodeBlocks: boolean;
  avoidBreakInsideTables: boolean;
  avoidBreakInsideImages: boolean;
}

export type PaginationBehaviorOption = keyof PaginationBehavior;
export type PaginationAlgorithmId = string;

export interface HeaderFooterLineContent {
  left: string;
  center: string;
  right: string;
}

export interface HeaderFooterContent {
  header: HeaderFooterLineContent;
  footer: HeaderFooterLineContent;
}

export interface BaseBlockStyleRule {
  marginTop: number;
  marginBottom: number;
  keepWithNext: boolean;
  avoidBreakInside: boolean;
}

export interface TextBlockStyleRule extends BaseBlockStyleRule {
  fontSize: number;
  lineHeight: number;
  insetLeft: number;
  insetRight: number;
}

export interface ListBlockStyleRule extends TextBlockStyleRule {
  indent: number;
  itemGap: number;
}

export interface CodeBlockStyleRule extends BaseBlockStyleRule {
  fontSize: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  charWidth: number;
}

export interface TableBlockStyleRule extends BaseBlockStyleRule {
  rowHeight: number;
  headerRowHeight: number;
  cellPaddingX: number;
  cellPaddingY: number;
}

export interface HorizontalRuleStyleRule extends BaseBlockStyleRule {
  strokeWidth: number;
}

export interface ImageBlockStyleRule extends BaseBlockStyleRule {
  placeholderHeight: number;
  maxWidthPercent: number;
  align: ImageAlign;
  captionGap: number;
}

export interface BlockStyleContract {
  heading1: TextBlockStyleRule;
  heading2: TextBlockStyleRule;
  heading3: TextBlockStyleRule;
  paragraph: TextBlockStyleRule;
  list: ListBlockStyleRule;
  blockquote: TextBlockStyleRule;
  code: CodeBlockStyleRule;
  table: TableBlockStyleRule;
  horizontalRule: HorizontalRuleStyleRule;
  image: ImageBlockStyleRule;
}

export interface ThemeVisualTokens {
  pageBackground: string;
  pageBorderColor: string;
  pageShadow: string;
  pageTopBandColor: string;
  pagePattern: string;
  pagePatternSize: string;
  headingFontFamily: string;
  bodyFontFamily: string;
  headerBackground: string;
  footerBackground: string;
  headerFooterText: string;
  headerBorderColor: string;
  footerBorderColor: string;
  bodyOutlineColor: string;
  heading1Color: string;
  heading1RuleColor: string;
  heading2Color: string;
  heading2MarkerColor: string;
  heading3Color: string;
  paragraphColor: string;
  mutedTextColor: string;
  listMarkerColor: string;
  taskCheckboxColor: string;
  blockquoteBackground: string;
  blockquoteBorderColor: string;
  blockquoteTextColor: string;
  codeBackground: string;
  codeBorderColor: string;
  codeTextColor: string;
  tableBorderColor: string;
  tableHeaderBackground: string;
  tableHeaderTextColor: string;
  ruleColor: string;
  pageBreakLineColor: string;
  pageBreakBackground: string;
  pageBreakBorderColor: string;
  pageBreakTextColor: string;
  imageCaptionColor: string;
}

export interface ThemeHeadingDecorationMetrics {
  paddingBottom: number;
  underlineHeight: number;
  underlineGap: number;
  markerInsetLeft: number;
  underlineOccupiesFlow: boolean;
}

export interface ThemeLayoutMetrics {
  heading1: ThemeHeadingDecorationMetrics;
  heading2: ThemeHeadingDecorationMetrics;
  heading3: ThemeHeadingDecorationMetrics;
}

export interface StyleSettings {
  pageSize: PageSizeId;
  orientation: PageOrientation;
  marginMode: MarginMode;
  marginPreset: MarginPresetId;
  customMarginsMm: BoxInsets;
  isMarginLinked: boolean;
  headerFooterMode: MarginMode;
  templateId: TemplateId;
  themeId: ThemeId;
  pageBackground: PageBackgroundSettings;
  headerPreset: HeaderFooterPresetId;
  footerPreset: HeaderFooterPresetId;
  customHeaderReservedMm: number;
  customFooterReservedMm: number;
  headerFooterContent: HeaderFooterContent;
  isHeaderFooterLinked: boolean;
  columns: ColumnSettings;
  paginationAlgorithmId: PaginationAlgorithmId;
  paginationBehavior: PaginationBehavior;
  blockSpacingPresetId: string;
  blockSpacing: BlockSpacingParameters;
  customBlockSpacingPresets: BlockSpacingPreset[];
}

export interface BlockSpacingParameters {
  heading1SpaceBefore: number;
  heading1SpaceAfter: number;
  heading2SpaceBefore: number;
  heading2SpaceAfter: number;
  heading3SpaceBefore: number;
  heading3SpaceAfter: number;
  paragraphSpaceBefore: number;
  paragraphSpaceAfter: number;
  listSpaceBefore: number;
  listSpaceAfter: number;
  listItemGap: number;
  blockquoteSpaceBefore: number;
  blockquoteSpaceAfter: number;
  codeSpaceBefore: number;
  codeSpaceAfter: number;
  codePaddingX: number;
  codePaddingY: number;
  tableSpaceBefore: number;
  tableSpaceAfter: number;
  tableCellPaddingX: number;
  tableCellPaddingY: number;
  imageSpaceBefore: number;
  imageSpaceAfter: number;
  ruleSpaceBefore: number;
  ruleSpaceAfter: number;
  textInsetLeft: number;
  textInsetRight: number;
}

export type BlockSpacingParameterKey = keyof BlockSpacingParameters;

export interface BlockSpacingPreset {
  id: string;
  name: string;
  description: string;
  parameters: BlockSpacingParameters;
  builtIn?: boolean;
}

export interface PageSizeDefinition {
  id: PageSizeId;
  label: string;
  description: string;
  widthMm: number;
  heightMm: number;
}

export interface MarginPresetDefinition {
  id: MarginPresetId;
  label: string;
  description: string;
  valueMm: BoxInsets;
}

export interface HeaderFooterPresetDefinition {
  id: HeaderFooterPresetId;
  label: string;
  description: string;
  reservedHeightMm: number;
}

export interface TemplateDefinition {
  id: TemplateId;
  name: string;
  description: string;
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  palette: string[];
  tokens: ThemeVisualTokens;
  layoutMetrics: ThemeLayoutMetrics;
}

export interface ResolvedStyleContract {
  pageSize: PageSizeId;
  orientation: PageOrientation;
  templateId: TemplateId;
  themeId: ThemeId;
  pageLabel: string;
  templateLabel: string;
  themeLabel: string;
  templateThemeLabel: string;
  marginLabel: string;
  pageWidthMm: number;
  pageHeightMm: number;
  pageWidthPx: number;
  pageHeightPx: number;
  marginsMm: BoxInsets;
  marginsPx: BoxInsets;
  headerReservedMm: number;
  footerReservedMm: number;
  headerReservedPx: number;
  footerReservedPx: number;
  contentWidthMm: number;
  contentHeightMm: number;
  contentWidthPx: number;
  contentHeightPx: number;
  columnCount: PageColumnCount;
  columnGapMm: number;
  columnGapPx: number;
  columnDivider: boolean;
  headingsSpanAll: boolean;
  singleColumnContentWidthMm: number;
  singleColumnContentWidthPx: number;
  columnPageCapacityPx: number;
  blockStyles: BlockStyleContract;
  themeTokens: ThemeVisualTokens;
  themeLayoutMetrics: ThemeLayoutMetrics;
  pageBackground: PageBackgroundSettings;
  paginationBehavior: PaginationBehavior;
}
