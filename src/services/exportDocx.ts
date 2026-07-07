import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation as DocxPageOrientation,
  Paragraph,
  SectionType,
  ShadingType,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun as DocxTextRun,
  UnderlineType,
  VerticalMergeType,
  WidthType,
  type FileChild,
} from 'docx';
import {
  applyPageNumbersToTocItems,
  buildHeadingPageNumberMap,
  buildLayoutListTree,
  buildTocItems,
  chunkCompactChoiceItems,
  getHeadingText,
  getLayoutListItemKind,
  getLayoutListItemLevel,
  getTocBlockDisplayTitle,
  getVisibleTocItemsForBlock,
  isCoveredTableCell,
  resolveCompactChoiceListLayoutWithOptions,
  resolveTableColumnWidths,
  shouldRenderTextRunAsDictationBlank,
  shouldHideLayoutListItemMarker,
  type AnswerDisplayMode,
  type LayoutBlock,
  type LayoutDocument,
  type LayoutListItem,
  type LayoutListTreeNode,
  type LayoutResource,
  type LayoutStyleSheet,
  type LayoutTableCell,
  type LayoutTableRow,
  type TextRun,
} from '@/engine/document-model';
import { renderHeaderFooterContent } from '@/engine/style/headerFooterContent';
import { defaultStyleSettings } from '@/engine/style/presets';
import {
  getQuickTextStyleRule,
  resolveQuickTextStyleForBlock,
  resolveQuickTextStyleForRun,
  type QuickTextStyleScope,
} from '@/engine/style/quickTextStyle';
import type { HeaderFooterLineContent, ResolvedStyleContract, StyleSettings } from '@/engine/style/types';
import type { PageLayout } from '@/engine/typesetting/types';
import {
  getBaseNameFromPath,
  getParentPath,
  resolveAssetSrc,
  toLayoutAssetUrl,
} from '@/utils/filePath';
import { pageSizeDefinitions } from '@/engine/style/presets';

export interface DocxExportPayload {
  pages: PageLayout[];
  title: string;
  blocks?: LayoutBlock[];
  resources?: LayoutResource[];
  styles?: LayoutStyleSheet;
  styleSettings?: StyleSettings;
  documentFilePath?: string | null;
  workspaceRootPath?: string | null;
  answerDisplayMode?: AnswerDisplayMode;
}

type SupportedDocxImageType = 'png' | 'jpg' | 'gif' | 'bmp';

interface DocxImageAsset {
  data: Uint8Array;
  type: SupportedDocxImageType;
  widthPx: number;
  heightPx: number;
}

interface BlockRenderContext {
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  documentTitle: string;
  tocItems: ReturnType<typeof buildRuntimeTocItems>;
  documentFilePath?: string | null;
  workspaceRootPath?: string | null;
  blockquoteDepth: number;
  answerDisplayMode: AnswerDisplayMode;
}

const PX_TO_TWIP = 15;
const PX_TO_HALF_POINT = 1.5;
const MM_TO_TWIP = 56.6929133858;
const MAX_DOCX_IMAGE_WIDTH_PX = 640;
const MIN_DOCX_IMAGE_SIZE_PX = 24;
const headerFooterPlaceholderPattern =
  /(\{文档标题\}|\{本页标题\}|\{页码\}|\{总页数\}|\{页面规格\}|\{模板主题\})/g;

function mmToTwip(value: number): number {
  return Math.max(0, Math.round(value * MM_TO_TWIP));
}

function pxToTwip(value: number | null | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.round((value as number) * PX_TO_TWIP));
}

function pxToHalfPoint(value: number | null | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.round((value as number) * PX_TO_HALF_POINT));
}

function normalizeHexColor(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.slice(1).toUpperCase();
  }

  if (/^[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return trimmed
      .slice(1)
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
      .toUpperCase();
  }

  return undefined;
}

function mapTextAlignment(value: LayoutBlock['blockStyleOverrides']['textAlign']) {
  switch (value) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'justify':
      return AlignmentType.JUSTIFIED;
    default:
      return AlignmentType.LEFT;
  }
}

function mapHeadingLevel(depth: number) {
  switch (depth) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    default:
      return HeadingLevel.HEADING_4;
  }
}

function resolveTextScope(block: LayoutBlock): QuickTextStyleScope {
  if (block.type === 'heading' && block.metadata.kind === 'heading') {
    if (block.metadata.depth === 1) return 'heading1';
    if (block.metadata.depth === 2) return 'heading2';
    if (block.metadata.depth === 3) return 'heading3';
    return 'heading4';
  }

  if (block.type === 'list') {
    return 'list';
  }

  if (block.type === 'table') {
    return 'table';
  }

  return 'paragraph';
}

function resolveBlockSpacing(block: LayoutBlock, contract: ResolvedStyleContract): { before?: number; after?: number } {
  switch (block.type) {
    case 'heading':
      if (block.metadata.kind === 'heading') {
        if (block.metadata.depth === 1) {
          return {
            before: pxToTwip(contract.blockStyles.heading1.marginTop),
            after: pxToTwip(contract.blockStyles.heading1.marginBottom),
          };
        }

        if (block.metadata.depth === 2) {
          return {
            before: pxToTwip(contract.blockStyles.heading2.marginTop),
            after: pxToTwip(contract.blockStyles.heading2.marginBottom),
          };
        }

        return {
          before: pxToTwip(contract.blockStyles.heading3.marginTop),
          after: pxToTwip(contract.blockStyles.heading3.marginBottom),
        };
      }
      break;
    case 'paragraph':
      return {
        before: pxToTwip(contract.blockStyles.paragraph.marginTop),
        after: pxToTwip(contract.blockStyles.paragraph.marginBottom),
      };
    case 'list':
      return {
        before: pxToTwip(contract.blockStyles.list.marginTop),
        after: pxToTwip(contract.blockStyles.list.marginBottom),
      };
    case 'blockquote':
      return {
        before: pxToTwip(contract.blockStyles.blockquote.marginTop),
        after: pxToTwip(contract.blockStyles.blockquote.marginBottom),
      };
    case 'code':
      return {
        before: pxToTwip(contract.blockStyles.code.marginTop),
        after: pxToTwip(contract.blockStyles.code.marginBottom),
      };
    case 'table':
      return {
        before: pxToTwip(contract.blockStyles.table.marginTop),
        after: pxToTwip(contract.blockStyles.table.marginBottom),
      };
    case 'image':
      return {
        before: pxToTwip(contract.blockStyles.image.marginTop),
        after: pxToTwip(contract.blockStyles.image.marginBottom),
      };
    case 'horizontalRule':
      return {
        before: pxToTwip(contract.blockStyles.horizontalRule.marginTop),
        after: pxToTwip(contract.blockStyles.horizontalRule.marginBottom),
      };
    default:
      break;
  }

  return {};
}

function splitRunTextByLineBreak(text: string): string[] {
  return text.split(/\r?\n/);
}

function buildDocxTextRuns(
  textRuns: TextRun[],
  inheritedStyle = {},
  answerDisplayMode: AnswerDisplayMode = 'show',
): DocxTextRun[] {
  const children: DocxTextRun[] = [];

  for (const run of textRuns) {
    const resolvedStyle = resolveQuickTextStyleForRun(run, inheritedStyle);
    const isDictationBlank = shouldRenderTextRunAsDictationBlank(run, answerDisplayMode);
    const color = isDictationBlank ? 'FFFFFF' : normalizeHexColor(resolvedStyle.color);
    const fillColor = isDictationBlank
      ? undefined
      : normalizeHexColor(resolvedStyle.highlightColor ?? resolvedStyle.backgroundColor);
    const fontSize = pxToHalfPoint(resolvedStyle.fontSize);
    const segments = splitRunTextByLineBreak(run.text);

    segments.forEach((segment, index) => {
      children.push(
        new DocxTextRun({
          text: segment || (index === 0 ? '' : ' '),
          break: index === 0 ? undefined : 1,
          bold: run.marks.some((mark) => mark.type === 'bold'),
          italics: run.marks.some((mark) => mark.type === 'italic'),
          underline: run.marks.some((mark) => mark.type === 'underline')
            ? { type: UnderlineType.SINGLE }
            : undefined,
          strike: run.marks.some((mark) => mark.type === 'strike'),
          color,
          font: resolvedStyle.fontFamily,
          size: fontSize,
          characterSpacing: resolvedStyle.letterSpacing,
          shading: fillColor
            ? {
                fill: fillColor,
                color: fillColor,
                type: ShadingType.CLEAR,
              }
            : undefined,
        }),
      );
    });
  }

  return children.length > 0 ? children : [new DocxTextRun(' ')];
}

function buildParagraphFromTextRuns(payload: {
  block: LayoutBlock;
  textRuns: TextRun[];
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  answerDisplayMode: AnswerDisplayMode;
  prefixText?: string;
  overrideAlignment?: ReturnType<typeof mapTextAlignment>;
  blockquoteDepth?: number;
  extraIndentTwip?: number;
}): Paragraph {
  const inheritedStyle = resolveQuickTextStyleForBlock(payload.block, payload.styles);
  const spacing = resolveBlockSpacing(payload.block, payload.contract);
  const quoteDepth = payload.blockquoteDepth ?? 0;
  const leftIndent = quoteDepth > 0 ? quoteDepth * 420 + (payload.extraIndentTwip ?? 0) : payload.extraIndentTwip;
  const children = payload.prefixText
    ? [new DocxTextRun(payload.prefixText), ...buildDocxTextRuns(payload.textRuns, inheritedStyle, payload.answerDisplayMode)]
    : buildDocxTextRuns(payload.textRuns, inheritedStyle, payload.answerDisplayMode);

  return new Paragraph({
    children,
    heading:
      payload.block.type === 'heading' && payload.block.metadata.kind === 'heading'
        ? mapHeadingLevel(payload.block.metadata.depth)
        : undefined,
    alignment: payload.overrideAlignment ?? mapTextAlignment(payload.block.blockStyleOverrides.textAlign),
    spacing,
    indent: leftIndent
      ? {
          left: leftIndent,
          hanging: payload.prefixText ? 240 : undefined,
        }
      : undefined,
    border:
      quoteDepth > 0
        ? {
            left: {
              style: BorderStyle.SINGLE,
              color: '8B93A1',
              size: 6,
              space: 8,
            },
          }
        : undefined,
  });
}

function buildRuntimeTocItems(pages: PageLayout[]) {
  const allBlocks = pages.flatMap((page) => page.blocks);
  const runtimeDocument: LayoutDocument = {
    version: '1.0.0',
    id: 'docx-export-runtime-document',
    title: '',
    source: '',
    blocks: allBlocks,
    resources: [],
    styles: { blockStyles: {}, textStyles: {} },
    template: { templateId: null, templateOverrides: {} },
      viewState: { answerDisplayMode: 'show', answerBlockPlacementMode: 'inline', zoom: 1, selectedNodeId: null },
    meta: {
      sourceFormat: 'markdown',
      wordCount: 0,
      characterCount: 0,
      blockCount: allBlocks.length,
      updatedAt: new Date(0).toISOString(),
    },
  };

  return applyPageNumbersToTocItems(buildTocItems(runtimeDocument), buildHeadingPageNumberMap(pages));
}

function buildHeaderFooterParagraph(
  line: HeaderFooterLineContent,
  contract: ResolvedStyleContract,
): Paragraph {
  const contentWidthTwip = mmToTwip(contract.contentWidthMm);

  return new Paragraph({
    tabStops: [
      { type: TabStopType.CENTER, position: Math.round(contentWidthTwip / 2) },
      { type: TabStopType.RIGHT, position: contentWidthTwip },
    ],
    spacing: {
      before: 0,
      after: 0,
    },
    children: [
      new DocxTextRun(line.left || ' '),
      new Tab(),
      new DocxTextRun(line.center || ' '),
      new Tab(),
      new DocxTextRun(line.right || ' '),
    ],
  });
}

function buildHeaderFooterRunsFromTemplate(payload: {
  template: string;
  documentTitle: string;
  pageTitle: string;
  contract: ResolvedStyleContract;
}): DocxTextRun[] {
  const normalizedTemplate = payload.template || ' ';
  const parts = normalizedTemplate.split(headerFooterPlaceholderPattern).filter((part) => part.length > 0);
  const runs: DocxTextRun[] = [];

  for (const part of parts) {
    switch (part) {
      case '{文档标题}':
        runs.push(new DocxTextRun(payload.documentTitle || '未命名文档'));
        break;
      case '{本页标题}':
        // DOCX 连续流导出不再按预览每页硬切 section，这里先回退到文档级标题，避免再次为了页眉标题强制分页。
        runs.push(new DocxTextRun(payload.pageTitle || payload.documentTitle || '未命名文档'));
        break;
      case '{页码}':
        runs.push(new DocxTextRun({ children: [PageNumber.CURRENT] }));
        break;
      case '{总页数}':
        runs.push(new DocxTextRun({ children: [PageNumber.TOTAL_PAGES] }));
        break;
      case '{页面规格}':
        runs.push(new DocxTextRun(payload.contract.pageLabel));
        break;
      case '{模板主题}':
        runs.push(new DocxTextRun(payload.contract.templateThemeLabel));
        break;
      default:
        runs.push(new DocxTextRun(part));
        break;
    }
  }

  return runs.length > 0 ? runs : [new DocxTextRun(' ')];
}

function buildDynamicHeaderFooterParagraph(payload: {
  line: HeaderFooterLineContent;
  contract: ResolvedStyleContract;
  documentTitle: string;
  pageTitle: string;
}): Paragraph {
  const contentWidthTwip = mmToTwip(payload.contract.contentWidthMm);

  return new Paragraph({
    tabStops: [
      { type: TabStopType.CENTER, position: Math.round(contentWidthTwip / 2) },
      { type: TabStopType.RIGHT, position: contentWidthTwip },
    ],
    spacing: {
      before: 0,
      after: 0,
    },
    children: [
      ...buildHeaderFooterRunsFromTemplate({
        template: payload.line.left,
        documentTitle: payload.documentTitle,
        pageTitle: payload.pageTitle,
        contract: payload.contract,
      }),
      new Tab(),
      ...buildHeaderFooterRunsFromTemplate({
        template: payload.line.center,
        documentTitle: payload.documentTitle,
        pageTitle: payload.pageTitle,
        contract: payload.contract,
      }),
      new Tab(),
      ...buildHeaderFooterRunsFromTemplate({
        template: payload.line.right,
        documentTitle: payload.documentTitle,
        pageTitle: payload.pageTitle,
        contract: payload.contract,
      }),
    ],
  });
}

function resolvePageTitle(page: PageLayout, documentTitle: string): string {
  const titleBlock = page.blocks.find((block) => block.type === 'heading');
  if (!titleBlock) {
    return documentTitle;
  }

  return getHeadingText(titleBlock) || documentTitle;
}

function buildListParagraphs(
  nodes: LayoutListTreeNode[],
  block: LayoutBlock,
  context: BlockRenderContext,
  startNumber = 1,
): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let orderedIndex = startNumber;

  for (const node of nodes) {
    const item = node.item;
    const listKind = getLayoutListItemKind(item, block.metadata.kind === 'list' ? block.metadata.ordered : false);
    const markerHidden = shouldHideLayoutListItemMarker(item);
    let prefixText = '';

    if (!markerHidden) {
      if (item.checked !== null) {
        prefixText = item.checked ? '☑ ' : '☐ ';
      } else if (listKind === 'ordered') {
        prefixText = `${orderedIndex}. `;
        orderedIndex += 1;
      } else {
        prefixText = '• ';
      }
    }

    paragraphs.push(
      buildParagraphFromTextRuns({
        block,
        textRuns: item.textRuns,
        contract: context.contract,
        styles: context.styles,
        answerDisplayMode: context.answerDisplayMode,
        prefixText,
        blockquoteDepth: context.blockquoteDepth,
        extraIndentTwip: Math.max(0, getLayoutListItemLevel(item) - 1) * 420,
      }),
    );

    if (node.children.length > 0) {
      paragraphs.push(...buildListParagraphs(node.children, block, context, 1));
    }
  }

  return paragraphs;
}

function buildCompactChoiceListParagraphs(
  block: LayoutBlock,
  context: BlockRenderContext,
  compactChoiceLayout: NonNullable<ReturnType<typeof resolveCompactChoiceListLayoutWithOptions>>,
): Paragraph[] {
  const contentWidthTwip = mmToTwip(context.contract.contentWidthMm);
  const columnWidthTwip = Math.max(1200, Math.floor(contentWidthTwip / compactChoiceLayout.columns));
  const tabStops = Array.from({ length: Math.max(0, compactChoiceLayout.columns - 1) }, (_, index) => ({
    type: TabStopType.LEFT,
    position: columnWidthTwip * (index + 1),
  }));
  const inheritedStyle = resolveQuickTextStyleForBlock(block, context.styles);
  const spacing = resolveBlockSpacing(block, context.contract);
  const rows = chunkCompactChoiceItems(compactChoiceLayout.items, compactChoiceLayout.columns);

  return rows.map((itemsInRow, rowIndex) => {
    const children = itemsInRow.flatMap((compactItem, columnIndex) => [
      ...(columnIndex > 0 ? [new DocxTextRun({ children: [new Tab()] })] : []),
      new DocxTextRun({ text: `${compactItem.label} `, bold: true }),
      ...buildDocxTextRuns(compactItem.contentTextRuns, inheritedStyle, context.answerDisplayMode),
    ]);

    return new Paragraph({
      // DOCX 选项组使用 Word 原生制表位，避免导出后在 Word 里变成可见表格结构。
      tabStops,
      children: children.length > 0 ? children : [new DocxTextRun(' ')],
      spacing: {
        before: rowIndex === 0 ? spacing.before : 0,
        after: rowIndex === rows.length - 1 ? spacing.after : 0,
      },
    });
  });
}

function buildTableCellParagraphs(
  cell: LayoutTableCell,
  block: LayoutBlock,
  context: BlockRenderContext,
): Paragraph[] {
  const children = buildDocxTextRuns(
    cell.textRuns,
    resolveQuickTextStyleForBlock(block, context.styles),
    context.answerDisplayMode,
  );

  return [
    new Paragraph({
      children,
      spacing: {
        before: 0,
        after: 0,
      },
    }),
  ];
}

function buildTableRows(
  rows: LayoutTableRow[],
  block: LayoutBlock,
  context: BlockRenderContext,
  columnWidthsTwip: number[],
): TableRow[] {
  return rows.map((row) => {
    const cells = row.cells
      .map((cell, columnIndex) => {
        if (isCoveredTableCell(cell)) {
          return null;
        }

        return new TableCell({
          children: buildTableCellParagraphs(cell, block, context),
          width: {
            size: columnWidthsTwip[columnIndex] ?? mmToTwip(context.contract.singleColumnContentWidthMm),
            type: WidthType.DXA,
          },
          columnSpan: cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined,
          rowSpan: cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined,
          verticalMerge: cell.rowSpan && cell.rowSpan > 1 ? VerticalMergeType.RESTART : undefined,
          shading: cell.isHeader
            ? {
                fill: 'E8EDF5',
                color: 'E8EDF5',
                type: ShadingType.CLEAR,
              }
            : undefined,
        });
      })
      .filter((cell): cell is TableCell => !!cell);

    return new TableRow({
      children: cells.length > 0 ? cells : [new TableCell({ children: [new Paragraph(' ')] })],
      tableHeader: row.cells.every((cell) => cell.isHeader),
    });
  });
}

function isAbsoluteLikePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
}

function tryDecodeFileUrl(value: string): string | null {
  if (!value.toLowerCase().startsWith('file:')) {
    return null;
  }

  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

function resolveDocxAssetUrl(payload: {
  src: string;
  documentFilePath?: string | null;
  workspaceRootPath?: string | null;
}): string {
  const trimmed = payload.src.trim();
  if (!trimmed) {
    return '';
  }

  const decodedFilePath = tryDecodeFileUrl(trimmed);
  if (decodedFilePath) {
    return toLayoutAssetUrl(decodedFilePath);
  }

  if (isAbsoluteLikePath(trimmed)) {
    return toLayoutAssetUrl(trimmed);
  }

  if (/^(https?:|data:|blob:|layout-asset:)/i.test(trimmed)) {
    return resolveAssetSrc(trimmed);
  }

  if (payload.documentFilePath) {
    return toLayoutAssetUrl(`${getParentPath(payload.documentFilePath)}\\${trimmed}`);
  }

  if (payload.workspaceRootPath) {
    return toLayoutAssetUrl(`${payload.workspaceRootPath}\\${trimmed}`);
  }

  return resolveAssetSrc(trimmed);
}

function detectDocxImageType(payload: { src: string; contentType: string }): SupportedDocxImageType | 'svg' | null {
  const lowerSource = payload.src.toLowerCase();
  const lowerType = payload.contentType.toLowerCase();

  if (lowerType.includes('image/svg') || lowerSource.endsWith('.svg') || lowerSource.startsWith('data:image/svg+xml')) {
    return 'svg';
  }

  if (lowerType.includes('image/png') || lowerSource.endsWith('.png') || lowerSource.startsWith('data:image/png')) {
    return 'png';
  }

  if (
    lowerType.includes('image/jpeg') ||
    lowerSource.endsWith('.jpg') ||
    lowerSource.endsWith('.jpeg') ||
    lowerSource.startsWith('data:image/jpeg')
  ) {
    return 'jpg';
  }

  if (lowerType.includes('image/gif') || lowerSource.endsWith('.gif') || lowerSource.startsWith('data:image/gif')) {
    return 'gif';
  }

  if (lowerType.includes('image/bmp') || lowerSource.endsWith('.bmp') || lowerSource.startsWith('data:image/bmp')) {
    return 'bmp';
  }

  return null;
}

function loadBrowserImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = url;
  });
}

async function rasterizeSvgToPng(payload: {
  svgBytes: Uint8Array;
  widthPx: number;
  heightPx: number;
}): Promise<DocxImageAsset> {
  const svgBuffer = new ArrayBuffer(payload.svgBytes.byteLength);
  new Uint8Array(svgBuffer).set(payload.svgBytes);
  const svgBlob = new Blob([svgBuffer], { type: 'image/svg+xml' });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadBrowserImage(objectUrl);
    const canvas = document.createElement('canvas');
    const widthPx = Math.max(MIN_DOCX_IMAGE_SIZE_PX, Math.round(payload.widthPx || image.naturalWidth || 320));
    const heightPx = Math.max(MIN_DOCX_IMAGE_SIZE_PX, Math.round(payload.heightPx || image.naturalHeight || 180));

    canvas.width = widthPx;
    canvas.height = heightPx;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法创建 SVG 转 PNG 画布');
    }

    context.drawImage(image, 0, 0, widthPx, heightPx);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error('SVG 转 PNG 失败'));
          return;
        }
        resolve(result);
      }, 'image/png');
    });

    return {
      data: new Uint8Array(await pngBlob.arrayBuffer()),
      type: 'png',
      widthPx,
      heightPx,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function resolveImageSize(payload: {
  widthPx?: number | null;
  heightPx?: number | null;
  maxWidthPx: number;
}): { widthPx: number; heightPx: number } {
  const inputWidth = payload.widthPx ?? 320;
  const inputHeight = payload.heightPx ?? Math.round(inputWidth * 0.75);
  const safeWidth = Math.max(MIN_DOCX_IMAGE_SIZE_PX, Math.round(inputWidth));
  const safeHeight = Math.max(MIN_DOCX_IMAGE_SIZE_PX, Math.round(inputHeight));
  const limitedWidth = Math.min(safeWidth, payload.maxWidthPx, MAX_DOCX_IMAGE_WIDTH_PX);

  if (limitedWidth === safeWidth) {
    return { widthPx: safeWidth, heightPx: safeHeight };
  }

  const scale = limitedWidth / safeWidth;
  return {
    widthPx: limitedWidth,
    heightPx: Math.max(MIN_DOCX_IMAGE_SIZE_PX, Math.round(safeHeight * scale)),
  };
}

async function loadImageForDocx(payload: {
  block: LayoutBlock;
  contract: ResolvedStyleContract;
  documentFilePath?: string | null;
  workspaceRootPath?: string | null;
  blockquoteDepth: number;
}): Promise<DocxImageAsset | null> {
  if (payload.block.type !== 'image' || payload.block.metadata.kind !== 'image' || !payload.block.metadata.src.trim()) {
    return null;
  }

  const maxWidthPx = Math.max(
    160,
    Math.round(payload.contract.singleColumnContentWidthPx - payload.blockquoteDepth * 28),
  );
  const expectedSize = resolveImageSize({
    widthPx: payload.block.metadata.widthPx,
    heightPx: payload.block.metadata.heightPx,
    maxWidthPx,
  });
  const assetUrl = resolveDocxAssetUrl({
    src: payload.block.metadata.src,
    documentFilePath: payload.documentFilePath,
    workspaceRootPath: payload.workspaceRootPath,
  });

  if (!assetUrl) {
    return null;
  }

  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`图片资源读取失败：${payload.block.metadata.src}`);
  }

  const imageBytes = new Uint8Array(await response.arrayBuffer());
  const imageType = detectDocxImageType({
    src: assetUrl,
    contentType: response.headers.get('content-type') ?? '',
  });

  if (imageType === 'svg') {
    // DOCX 对 SVG 支持不稳定，这里统一先转成 PNG，减少 Word / WPS 打不开图片的概率。
    return rasterizeSvgToPng({
      svgBytes: imageBytes,
      widthPx: expectedSize.widthPx,
      heightPx: expectedSize.heightPx,
    });
  }

  if (!imageType) {
    return null;
  }

  return {
    data: imageBytes,
    type: imageType,
    widthPx: expectedSize.widthPx,
    heightPx: expectedSize.heightPx,
  };
}

async function buildDocxChildrenForBlock(
  block: LayoutBlock,
  context: BlockRenderContext,
): Promise<FileChild[]> {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return [
        buildParagraphFromTextRuns({
          block,
          textRuns: block.textRuns,
          contract: context.contract,
          styles: context.styles,
          answerDisplayMode: context.answerDisplayMode,
          blockquoteDepth: context.blockquoteDepth,
        }),
      ];
    case 'list':
      if (block.metadata.kind !== 'list') {
        return [];
      }
      {
        const compactChoiceLayout = resolveCompactChoiceListLayoutWithOptions(block.metadata.items, {
          allowSequenceFromAnyLabel: (block.metadata.runtimeSlice?.startIndex ?? 0) > 0,
        });
        if (compactChoiceLayout) {
          return buildCompactChoiceListParagraphs(block, context, compactChoiceLayout);
        }
      }
      return buildListParagraphs(
        buildLayoutListTree(block.metadata.items),
        block,
        context,
        block.metadata.start ?? 1,
      );
    case 'blockquote':
      if (block.metadata.kind !== 'blockquote') {
        return [];
      }
      // 引用块里的子块继续按原块类型导出，但统一补左缩进和左边线，避免本步为了 quote 容器再造一套文档模型。
      return (
        await Promise.all(
          block.metadata.blocks.map((nestedBlock) =>
            buildDocxChildrenForBlock(nestedBlock, {
              ...context,
              blockquoteDepth: context.blockquoteDepth + 1,
            }),
          ),
        )
      ).flat();
    case 'code': {
      const codeText =
        block.metadata.kind === 'code'
          ? block.metadata.value
          : block.textRuns.map((textRun) => textRun.text).join('');
      const lines = codeText.split(/\r?\n/);

      return lines.map(
        (line) =>
          new Paragraph({
            children: [
              new DocxTextRun({
                text: line || ' ',
                font: 'Consolas',
              }),
            ],
            spacing: resolveBlockSpacing(block, context.contract),
            shading: {
              fill: 'F4F4F5',
              color: 'F4F4F5',
              type: ShadingType.CLEAR,
            },
            indent:
              context.blockquoteDepth > 0
                ? {
                    left: context.blockquoteDepth * 420,
                  }
                : undefined,
          }),
      );
    }
    case 'equation':
      return [
        new Paragraph({
          children: [
            new DocxTextRun({
              text: block.metadata.kind === 'equation' ? block.metadata.value || ' ' : ' ',
              italics: true,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: resolveBlockSpacing(block, context.contract),
        }),
      ];
    case 'table':
      if (block.metadata.kind !== 'table') {
        return [];
      }
      return [
        new Table({
          rows: buildTableRows(
            block.metadata.rows,
            block,
            context,
            resolveTableColumnWidths(
              block.metadata.columnWidthsPx,
              block.metadata.rows[0]?.cells.length ?? 0,
              context.contract.singleColumnContentWidthPx,
            ).map((widthPx) => pxToTwip(widthPx) ?? 1200),
          ),
          width: { size: 100, type: WidthType.PERCENTAGE },
          layout: TableLayoutType.FIXED,
        }),
      ];
    case 'image': {
      const imageAsset = await loadImageForDocx({
        block,
        contract: context.contract,
        documentFilePath: context.documentFilePath,
        workspaceRootPath: context.workspaceRootPath,
        blockquoteDepth: context.blockquoteDepth,
      });

      if (!imageAsset) {
        return [
          new Paragraph({
            children: [new DocxTextRun('图片资源不可用')],
            spacing: resolveBlockSpacing(block, context.contract),
          }),
        ];
      }

      const children: FileChild[] = [
        new Paragraph({
          children: [
            new ImageRun({
              data: imageAsset.data,
              type: imageAsset.type,
              transformation: {
                width: imageAsset.widthPx,
                height: imageAsset.heightPx,
              },
            }),
          ],
          alignment: mapTextAlignment(
            block.blockStyleOverrides.textAlign ??
              (block.metadata.kind === 'image' && block.metadata.wrapSide === 'left'
                ? 'left'
                : block.metadata.kind === 'image' && block.metadata.wrapSide === 'right'
                  ? 'right'
                  : 'center'),
          ),
          spacing: resolveBlockSpacing(block, context.contract),
        }),
      ];

      if (block.metadata.kind === 'image' && block.metadata.showCaption && block.metadata.title) {
        children.push(
          new Paragraph({
            children: [new DocxTextRun(block.metadata.title)],
            alignment: AlignmentType.CENTER,
          }),
        );
      }

      return children;
    }
    case 'horizontalRule':
      return [];
    case 'columnBreak':
      return [
        new Paragraph({
          children: [new DocxTextRun('分栏断点')],
          alignment: AlignmentType.CENTER,
        }),
      ];
    case 'toc':
      if (block.metadata.kind !== 'toc') {
        return [];
      }
      return [
        new Paragraph({
          children: [new DocxTextRun({ text: getTocBlockDisplayTitle(block), bold: true })],
          spacing: resolveBlockSpacing(block, context.contract),
        }),
        ...getVisibleTocItemsForBlock(block, context.tocItems).map(
          (item) =>
            new Paragraph({
              tabStops: [
                {
                  type: TabStopType.RIGHT,
                  position: mmToTwip(context.contract.contentWidthMm),
                },
              ],
              indent: {
                left: Math.max(0, item.depth - 1) * 360,
              },
              children: [
                new DocxTextRun(item.text),
                new Tab(),
                new DocxTextRun(String(item.pageNumber ?? '-')),
              ],
            }),
        ),
      ];
    case 'pageBreak':
      return [
        new Paragraph({
          children: [new PageBreak()],
        }),
      ];
    default:
      return [];
  }
}

async function buildBlockChildren(payload: {
  blocks: LayoutBlock[];
  contract: ResolvedStyleContract;
  styles?: LayoutStyleSheet;
  documentTitle: string;
  tocItems: ReturnType<typeof buildRuntimeTocItems>;
  documentFilePath?: string | null;
  workspaceRootPath?: string | null;
  answerDisplayMode?: AnswerDisplayMode;
}): Promise<FileChild[]> {
  const children: FileChild[] = [];

  for (const block of payload.blocks) {
    const nextChildren = await buildDocxChildrenForBlock(block, {
      contract: payload.contract,
      styles: payload.styles,
      documentTitle: payload.documentTitle,
      tocItems: payload.tocItems,
      documentFilePath: payload.documentFilePath,
      workspaceRootPath: payload.workspaceRootPath,
      blockquoteDepth: 0,
      answerDisplayMode: payload.answerDisplayMode ?? 'show',
    });
    children.push(...nextChildren);
  }

  return children.length > 0 ? children : [new Paragraph(' ')];
}

function buildSectionProperties(page: PageLayout, sectionType?: (typeof SectionType)[keyof typeof SectionType]) {
  const docxPageSize = resolveDocxPageSizeMm(page.contract);
  return {
    type: sectionType,
    page: {
      size: {
        // `docx` 库在 landscape 时会自动交换一次宽高，这里必须回到纸张原始尺寸，避免 A3 横向被双重交换。
        width: mmToTwip(docxPageSize.widthMm),
        height: mmToTwip(docxPageSize.heightMm),
        orientation:
          page.contract.orientation === 'landscape'
            ? DocxPageOrientation.LANDSCAPE
            : DocxPageOrientation.PORTRAIT,
      },
      margin: {
        top: mmToTwip(page.contract.marginsMm.top),
        right: mmToTwip(page.contract.marginsMm.right),
        bottom: mmToTwip(page.contract.marginsMm.bottom),
        left: mmToTwip(page.contract.marginsMm.left),
        header: mmToTwip(page.contract.headerReservedMm),
        footer: mmToTwip(page.contract.footerReservedMm),
      },
    },
  };
}

function resolveDocxPageSizeMm(contract: ResolvedStyleContract): { widthMm: number; heightMm: number } {
  const definition = pageSizeDefinitions.find((item) => item.id === contract.pageSize);
  if (definition) {
    return {
      widthMm: definition.widthMm,
      heightMm: definition.heightMm,
    };
  }

  // 正常不会走到这里；兜底时把横向契约恢复到未交换前的纸张宽高，避免继续输出冲突的页面尺寸。
  if (contract.orientation === 'landscape') {
    return {
      widthMm: contract.pageHeightMm,
      heightMm: contract.pageWidthMm,
    };
  }

  return {
    widthMm: contract.pageWidthMm,
    heightMm: contract.pageHeightMm,
  };
}

function buildSectionSignature(contract: ResolvedStyleContract): string {
  return JSON.stringify({
    pageWidthMm: contract.pageWidthMm,
    pageHeightMm: contract.pageHeightMm,
    orientation: contract.orientation,
    marginsMm: contract.marginsMm,
    headerReservedMm: contract.headerReservedMm,
    footerReservedMm: contract.footerReservedMm,
  });
}

function canUseContinuousDocxFlow(pages: PageLayout[]): boolean {
  if (pages.length <= 1) {
    return true;
  }

  const firstSignature = buildSectionSignature(pages[0].contract);
  return pages.every((page) => buildSectionSignature(page.contract) === firstSignature);
}

function resolveSourceBlocksForDocx(payload: DocxExportPayload): LayoutBlock[] {
  if (payload.blocks && payload.blocks.length > 0) {
    return payload.blocks;
  }

  return payload.pages.flatMap((page) => page.blocks);
}

export async function buildDocxArrayBuffer(payload: DocxExportPayload): Promise<ArrayBuffer> {
  const headerFooterContent = payload.styleSettings?.headerFooterContent ?? defaultStyleSettings.headerFooterContent;
  const tocItems = buildRuntimeTocItems(payload.pages);
  const sourceBlocks = resolveSourceBlocksForDocx(payload);

  if (payload.pages.length === 0) {
    const document = new Document({
      creator: 'LAYOUT3.0',
      title: payload.title || '未命名文档',
      description: '由 LAYOUT3.0 导出的 DOCX 文档',
      sections: [
        {
          children: [new Paragraph(' ')],
        },
      ],
    });

    return Packer.toArrayBuffer(document);
  }

  if (canUseContinuousDocxFlow(payload.pages)) {
    const firstPage = payload.pages[0];
    const pageTitle = resolvePageTitle(firstPage, payload.title);
    const section = {
      properties: buildSectionProperties(firstPage),
      headers: {
        default: new Header({
          children: [
            buildDynamicHeaderFooterParagraph({
              line: headerFooterContent.header,
              contract: firstPage.contract,
              documentTitle: payload.title,
              pageTitle,
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            buildDynamicHeaderFooterParagraph({
              line: headerFooterContent.footer,
              contract: firstPage.contract,
              documentTitle: payload.title,
              pageTitle,
            }),
          ],
        }),
      },
      children: await buildBlockChildren({
        blocks: sourceBlocks,
        contract: firstPage.contract,
        styles: payload.styles,
        documentTitle: payload.title,
        tocItems,
        documentFilePath: payload.documentFilePath,
        workspaceRootPath: payload.workspaceRootPath,
        answerDisplayMode: payload.answerDisplayMode,
      }),
    };

    const document = new Document({
      creator: 'LAYOUT3.0',
      title: payload.title || '未命名文档',
      description: '由 LAYOUT3.0 导出的 DOCX 文档',
      sections: [section],
    });

    return Packer.toArrayBuffer(document);
  }

  // 当后续真的出现跨页页面设置差异时，暂时回退到按页兜底，避免页尺寸/页边距被错误合并。
  const sections = await Promise.all(
    payload.pages.map(async (page, index) => {
      const pageTitle = resolvePageTitle(page, payload.title);
      const renderedHeaderFooter = renderHeaderFooterContent(headerFooterContent, {
        documentTitle: payload.title,
        pageTitle,
        pageNumber: page.pageNumber,
        totalPages: payload.pages.length,
        contract: page.contract,
      });

      return {
        properties: buildSectionProperties(page, index === 0 ? undefined : SectionType.NEXT_PAGE),
        headers: {
          default: new Header({
            children: [buildHeaderFooterParagraph(renderedHeaderFooter.header, page.contract)],
          }),
        },
        footers: {
          default: new Footer({
            children: [buildHeaderFooterParagraph(renderedHeaderFooter.footer, page.contract)],
          }),
        },
        children: await buildBlockChildren({
          blocks: page.blocks,
          contract: page.contract,
          styles: payload.styles,
          documentTitle: payload.title,
          tocItems,
          documentFilePath: payload.documentFilePath,
          workspaceRootPath: payload.workspaceRootPath,
          answerDisplayMode: payload.answerDisplayMode,
        }),
      };
    }),
  );

  const document = new Document({
    creator: 'LAYOUT3.0',
    title: payload.title || '未命名文档',
    description: '由 LAYOUT3.0 导出的 DOCX 文档',
    sections,
  });

  return Packer.toArrayBuffer(document);
}
