import {
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
import { Bold, Eraser, Highlighter, Italic, Strikethrough, Underline } from 'lucide-react';
import { highlightColorOptions, standardColorOptions } from '@/constants/styleColors';
import {
  applyTextRunPatchToTextRuns,
  clearTextFormattingInTextRuns,
  getHeadingText,
  getLayoutBlockPlainText,
  getTextContentFromRuns,
  isEditableLayoutTextBlock,
  toggleTextMarkInTextRuns,
  type LayoutBlock,
  type LayoutListItem,
  type LayoutTableCell,
  type ParseState,
  type TextMark,
  type TextMarkType,
  type TextRangeSelection,
  type TextRun,
  type TextStyleOverrides,
} from '@/engine/document-model';
import type { ResolvedStyleContract } from '@/engine/style/types';
import type { PageLayout } from '@/engine/typesetting/types';
import type { CanvasTextSelectionState } from '@/types/workspace';
import { createTextFragment, resolveHangingIndentStyle } from '@/engine/document-model/utils';
import { mergeAdjacentTextRuns } from '@/engine/document-model';
import { resolveAssetSrc } from '@/utils/filePath';

interface CanvasPaneProps {
  documentTitle: string;
  documentBlockCount: number;
  documentBlocks: LayoutBlock[];
  pageLayouts: PageLayout[];
  parseError: string | null;
  parseState: ParseState;
  resolvedStyleContract: ResolvedStyleContract;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
  onCommitNodeText: (nodeId: string, text: string) => void;
  onCommitNodeRichText: (nodeId: string, textRuns: TextRun[]) => void;
  onTextSelectionChange: (state: CanvasTextSelectionState) => void;
  isCondensed?: boolean;
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

interface FloatingToolbarPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
}

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
  key: 'color' | 'highlightColor',
): string | undefined {
  const selectedRuns = collectFloatingSelectedRuns(textRuns, selection);
  if (selectedRuns.length === 0) {
    return undefined;
  }

  const firstValue = selectedRuns[0].styleOverrides[key];
  const isShared = selectedRuns.every((run) => run.styleOverrides[key] === firstValue);
  return isShared ? firstValue : undefined;
}

function buildTextRunStyle(run: TextRun): CSSProperties {
  return {
    color: run.styleOverrides.color,
    backgroundColor: run.styleOverrides.highlightColor ?? run.styleOverrides.backgroundColor,
    fontStyle: run.marks.some((mark) => mark.type === 'italic') ? 'italic' : undefined,
    fontFamily: run.styleOverrides.fontFamily,
    fontSize: run.styleOverrides.fontSize ? `${run.styleOverrides.fontSize}px` : undefined,
    letterSpacing: run.styleOverrides.letterSpacing ? `${run.styleOverrides.letterSpacing}px` : undefined,
  };
}

function buildBlockStyle(block: LayoutBlock): CSSProperties {
  const supportsBlockIndent = block.type === 'heading' || block.type === 'paragraph';
  const indentStyle = supportsBlockIndent ? resolveHangingIndentStyle(block.blockStyleOverrides) : null;
  const textIndent = indentStyle ? indentStyle.textIndent : block.blockStyleOverrides.firstLineIndent;

  return {
    textAlign: block.blockStyleOverrides.textAlign,
    lineHeight: block.blockStyleOverrides.lineHeight
      ? `${block.blockStyleOverrides.lineHeight}px`
      : undefined,
    marginTop: block.blockStyleOverrides.spaceBefore
      ? `${block.blockStyleOverrides.spaceBefore}px`
      : undefined,
    marginBottom: block.blockStyleOverrides.spaceAfter
      ? `${block.blockStyleOverrides.spaceAfter}px`
      : undefined,
    paddingLeft: indentStyle && indentStyle.paddingLeft > 0 ? `${indentStyle.paddingLeft}px` : undefined,
    paddingRight: indentStyle && indentStyle.paddingRight > 0 ? `${indentStyle.paddingRight}px` : undefined,
    textIndent: textIndent && textIndent !== 0
      ? `${textIndent}px`
      : undefined,
    backgroundColor: block.blockStyleOverrides.backgroundColor,
  };
}

function renderInlineText(text: string, keyPrefix: string): ReactNode {
  return text.split('\n').flatMap((part, index) => {
    if (index === 0) {
      return [part];
    }

    return [<br key={`${keyPrefix}-br-${index}`} />, part];
  });
}

function applyMarks(content: ReactNode, run: TextRun, keyPrefix: string): ReactNode {
  return run.marks.reduce<ReactNode>((currentNode, mark, index) => {
    switch (mark.type) {
      case 'bold':
        return <strong key={`${keyPrefix}-bold-${index}`}>{currentNode}</strong>;
      case 'italic':
        return <em key={`${keyPrefix}-italic-${index}`}>{currentNode}</em>;
      case 'underline':
        return <u key={`${keyPrefix}-underline-${index}`}>{currentNode}</u>;
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

function renderTextRuns(textRuns: TextRun[], emptyLabel?: string): ReactNode[] {
  if (textRuns.length === 0 && emptyLabel) {
    return [
      <span className="empty-text-placeholder" key="empty-text-placeholder">
        {emptyLabel}
      </span>,
    ];
  }

  return textRuns.map((run) => (
    <span key={run.id} style={buildTextRunStyle(run)}>
      {applyMarks(renderInlineText(run.text, run.id), run, run.id)}
    </span>
  ));
}

function getPageTitle(blocks: LayoutBlock[], fallbackTitle: string): string {
  const headingBlock = blocks.find((block) => block.type === 'heading');
  return (headingBlock ? getHeadingText(headingBlock) : null) || fallbackTitle;
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
  }

  return null;
}

function createSelectableBlockProps(
  block: LayoutBlock,
  selectedNodeId: string | null,
  onSelectNode: (nodeId: string) => void,
  onPrepareSelectNode: (nodeId: string) => void,
  onStartEditing: (node: EditableCanvasNode) => void,
  className = '',
) {
  const classNames = ['selectable-layout-block', className, block.id === selectedNodeId ? 'selected' : '']
    .filter(Boolean)
    .join(' ');

  return {
    className: classNames,
    'data-layout-node-id': block.id,
    onMouseDown: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onPrepareSelectNode(block.id);
      if (event.detail >= 2) {
        event.preventDefault();
        onSelectNode(block.id);
        const editableNode = getEditableBlockNode(block);
        // 第二次按下鼠标时就进入编辑态，避免缩放画布中 dblclick 事件偶发漏触发。
        if (editableNode) {
          onStartEditing(editableNode);
        }
      }
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onSelectNode(block.id);
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
  const renderRunText = (text: string) => escapeHtml(text).replaceAll('\n', '<br data-layout-break="1" />');

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

  return textRuns
    .map((run) => `<span data-layout-run-id="${run.id}"${buildTextRunStyleString(run)}>${applyRunMarks(renderRunText(run.text), run.marks)}</span>`)
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

function findSelectionPoint(root: HTMLElement, targetOffset: number): { node: Node; offset: number } {
  let traversed = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();

  while (currentNode) {
    const nodeText = currentNode.textContent ?? '';
    const nextTraversed = traversed + nodeText.length;
    if (targetOffset <= nextTraversed) {
      return {
        node: currentNode,
        offset: Math.max(0, Math.min(nodeText.length, targetOffset - traversed)),
      };
    }

    traversed = nextTraversed;
    currentNode = walker.nextNode();
  }

  return {
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
  const canvasPane = root.closest('.canvas-pane') as HTMLElement | null;
  const scrollSnapshot = createCanvasScrollSnapshot(canvasPane);
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  domSelection.removeAllRanges();
  domSelection.addRange(range);
  restoreCanvasScrollSnapshotSoon(canvasPane, scrollSnapshot);
}

function measureSelectionOffset(root: HTMLElement, targetNode: Node, targetOffset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(targetNode, targetOffset);
  const fragment = range.cloneContents();
  const container = document.createElement('div');
  container.appendChild(fragment);
  return container.innerText.replace(/\r\n/g, '\n').length;
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

    const canvasPane = editor.closest('.canvas-pane') as HTMLElement | null;
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

function renderBlock(
  block: LayoutBlock,
  index: number,
  selectedNodeId: string | null,
  onSelectNode: (nodeId: string) => void,
  onPrepareSelectNode: (nodeId: string) => void,
  editingNodeId: string | null,
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
): JSX.Element | null {
  const isEditing = editingNodeId === block.id;

  switch (block.type) {
    case 'pageBreak':
      return null;
    case 'heading': {
      const depth = block.metadata.kind === 'heading' ? block.metadata.depth : 3;
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
        : renderTextRuns(block.textRuns, '空标题');

      if (depth === 1) {
        return (
          <h1
            key={`${block.id}-${index}`}
            {...createSelectableBlockProps(block, selectedNodeId, onSelectNode, onPrepareSelectNode, onStartEditing)}
            style={buildBlockStyle(block)}
          >
            {content}
          </h1>
        );
      }

      if (depth === 2) {
        return (
          <h2
            key={`${block.id}-${index}`}
            {...createSelectableBlockProps(block, selectedNodeId, onSelectNode, onPrepareSelectNode, onStartEditing)}
            style={buildBlockStyle(block)}
          >
            {content}
          </h2>
        );
      }

      return (
        <h3
          key={`${block.id}-${index}`}
          {...createSelectableBlockProps(block, selectedNodeId, onSelectNode, onPrepareSelectNode, onStartEditing)}
          style={buildBlockStyle(block)}
        >
          {content}
        </h3>
      );
    }
    case 'paragraph':
      return (
        <p
          key={`${block.id}-${index}`}
          {...createSelectableBlockProps(block, selectedNodeId, onSelectNode, onPrepareSelectNode, onStartEditing)}
          style={buildBlockStyle(block)}
        >
          {isEditing
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
            : renderTextRuns(block.textRuns, '空文本块')}
        </p>
      );
    case 'list': {
      if (block.metadata.kind !== 'list') {
        return null;
      }

      const ListTag = block.metadata.ordered ? 'ol' : 'ul';
      return (
        <ListTag
          key={`list-${block.id}-${index}`}
          {...createSelectableBlockProps(block, selectedNodeId, onSelectNode, onPrepareSelectNode, onStartEditing)}
          style={buildBlockStyle(block)}
        >
          {block.metadata.items.map((item) => {
            const itemNode = getEditableListItemNode(item);

            return (
              <li
                key={item.id}
                {...createSelectableTextNodeProps({
                  node: itemNode,
                  selectedNodeId,
                  onSelectNode,
                  onPrepareSelectNode,
                  onStartEditing,
                })}
              >
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
                  : renderTextRuns(item.textRuns, '空列表项')}
              </li>
            );
          })}
        </ListTag>
      );
    }
    case 'blockquote':
      return block.metadata.kind === 'blockquote' ? (
        <blockquote
          key={`blockquote-${block.id}-${index}`}
          {...createSelectableBlockProps(block, selectedNodeId, onSelectNode, onPrepareSelectNode, onStartEditing, 'quote-block')}
        >
          {block.metadata.blocks.map((item, childIndex) =>
            renderBlock(
              item,
              childIndex,
              selectedNodeId,
              onSelectNode,
              onPrepareSelectNode,
              editingNodeId,
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
            ),
          )}
        </blockquote>
      ) : null;
    case 'code':
      return (
        <pre
          key={`code-${block.id}-${index}`}
          {...createSelectableBlockProps(block, selectedNodeId, onSelectNode, onPrepareSelectNode, onStartEditing, 'code-block')}
          style={buildBlockStyle(block)}
        >
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
              : renderTextRuns(block.textRuns, '空代码块')}
          </code>
        </pre>
      );
    case 'table':
      return block.metadata.kind === 'table' ? (
        <div
          key={`table-${block.id}-${index}`}
          {...createSelectableBlockProps(block, selectedNodeId, onSelectNode, onPrepareSelectNode, onStartEditing, 'table-shell')}
        >
          <table className="preview-table" style={buildBlockStyle(block)}>
            <tbody>
              {block.metadata.rows.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, cellIndex) => {
                    const cellNode = getEditableTableCellNode(cell);
                    const CellTag = cell.isHeader ? 'th' : 'td';
                    const columnAlign = block.metadata.kind === 'table' ? block.metadata.align[cellIndex] : null;

                    return (
                      <CellTag
                        key={cell.id}
                        style={columnAlign ? { textAlign: columnAlign } : undefined}
                        {...createSelectableTextNodeProps({
                          node: cellNode,
                          selectedNodeId,
                          onSelectNode,
                          onPrepareSelectNode,
                          onStartEditing,
                        })}
                      >
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
                          : renderTextRuns(cell.textRuns, '空单元格')}
                      </CellTag>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null;
    case 'image':
      return block.metadata.kind === 'image' ? (
        <figure
          key={`image-${block.id}-${index}`}
          {...createSelectableBlockProps(block, selectedNodeId, onSelectNode, onPrepareSelectNode, onStartEditing, 'image-shell')}
        >
          {block.metadata.src ? (
            <img
              className="preview-image"
              src={resolveAssetSrc(block.metadata.src)}
              alt={block.metadata.alt || '图片'}
              title={block.metadata.title ?? undefined}
              loading="lazy"
            />
          ) : (
            <div className="preview-image placeholder">图片占位</div>
          )}
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
              : block.metadata.alt || <span className="empty-text-placeholder">双击编辑图片说明</span>}
          </figcaption>
        </figure>
      ) : null;
    case 'equation':
      return block.metadata.kind === 'equation' ? (
        <div
          key={`equation-${block.id}-${index}`}
          {...createSelectableBlockProps(block, selectedNodeId, onSelectNode, onPrepareSelectNode, onStartEditing, 'equation-shell')}
        >
          {isEditing
            ? renderBlockEditor({
                kind: editingKind ?? 'equation',
                editorRef,
                editingText,
                onChange: onEditTextChange,
                onSelectionChange,
                onCommit: onCommitEdit,
                onCancel: onCancelEdit,
              })
            : block.metadata.value || <span className="empty-text-placeholder">空公式</span>}
        </div>
      ) : null;
    case 'horizontalRule':
      return (
        <hr
          key={`rule-${block.id}-${index}`}
          {...createSelectableBlockProps(block, selectedNodeId, onSelectNode, onPrepareSelectNode, onStartEditing, 'preview-rule')}
        />
      );
    default:
      return null;
  }
}

function createPageDisplayStyles(
  page: PageLayout,
  isCondensed: boolean,
  availableWidth: number | null,
): PageDisplayStyles {
  const maxWidth = isCondensed ? 620 : 760;
  const measuredWidth = availableWidth && availableWidth > 0 ? availableWidth : maxWidth;
  const displayWidth = Math.min(page.contract.pageWidthPx, maxWidth, measuredWidth);
  const displayScale = displayWidth / page.contract.pageWidthPx;
  const displayHeight = page.contract.pageHeightPx * displayScale;
  const headerHeight = page.contract.marginsPx.top + page.contract.headerReservedPx;
  const footerHeight = page.contract.marginsPx.bottom + page.contract.footerReservedPx;

  return {
    frameStyle: {
      '--page-frame-width': `${displayWidth}px`,
      '--page-frame-height': `${displayHeight}px`,
    } as CSSProperties,
    pageStyle: {
      '--page-source-width': `${page.contract.pageWidthPx}px`,
      '--page-source-height': `${page.contract.pageHeightPx}px`,
      '--page-scale': displayScale,
      '--page-header-height': `${headerHeight}px`,
      '--page-footer-height': `${footerHeight}px`,
      '--page-padding-left': `${page.contract.marginsPx.left}px`,
      '--page-padding-right': `${page.contract.marginsPx.right}px`,
    } as CSSProperties,
  };
}

export function CanvasPane({
  documentTitle,
  documentBlockCount,
  documentBlocks,
  pageLayouts,
  parseError,
  parseState,
  resolvedStyleContract,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
  onCommitNodeText,
  onCommitNodeRichText,
  onTextSelectionChange,
  isCondensed = false,
}: CanvasPaneProps): JSX.Element {
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingKind, setEditingKind] = useState<CanvasEditorKind | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingDraftTextRuns, setEditingDraftTextRuns] = useState<TextRun[] | null>(null);
  const [editingSelection, setEditingSelection] = useState<TextRangeSelection | null>(null);
  const [floatingToolbarPosition, setFloatingToolbarPosition] = useState<FloatingToolbarPosition | null>(null);
  const [pageStackWidth, setPageStackWidth] = useState<number | null>(null);
  const canvasPaneRef = useRef<HTMLElement>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const richEditorRef = useRef<HTMLDivElement | null>(null);
  const floatingToolbarRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollSnapshotRef = useRef<CanvasScrollSnapshot | null>(null);
  const pendingSelectionAfterCommitRef = useRef<string | null>(null);
  const skipBlurCommitRef = useRef(false);
  const isEditingRichText = !!editingKind && isRichTextCanvasEditorKind(editingKind);
  const floatingToolbarTextRuns =
    editingDraftTextRuns ?? (editingNodeId ? findEditableNodeTextRunsInBlocks(documentBlocks, editingNodeId) : null);
  const shouldShowFloatingToolbar =
    !!editingNodeId &&
    isEditingRichText &&
    !!floatingToolbarTextRuns &&
    hasNonCollapsedSelection(editingSelection);
  const currentFloatingTextColor =
    floatingToolbarTextRuns && shouldShowFloatingToolbar
      ? getSharedFloatingTextStyleValue(floatingToolbarTextRuns, editingSelection, 'color')
      : undefined;
  const currentFloatingHighlightColor =
    floatingToolbarTextRuns && shouldShowFloatingToolbar
      ? getSharedFloatingTextStyleValue(floatingToolbarTextRuns, editingSelection, 'highlightColor')
      : undefined;

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
    restoreRichSelection(editor, editingSelection);
    restoreCanvasScrollSnapshot(canvasPane, scrollSnapshot);
    pendingScrollSnapshotRef.current = null;
  }, [editingNodeId, editingSelection, isEditingRichText]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    resizeCanvasEditor(editor);
  }, [editingNodeId, editingText]);

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
  }, [documentBlocks, editingDraftTextRuns, editingNodeId, isEditingRichText]);

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

  const prepareSelectingNode = (nodeId: string) => {
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
    pendingScrollSnapshotRef.current = createCanvasScrollSnapshot(canvasPaneRef.current);
    pendingSelectionAfterCommitRef.current = null;
    setEditingNodeId(node.id);
    setEditingKind(node.kind);
    setEditingText(node.text);
    setEditingDraftTextRuns(isRichTextCanvasEditorKind(node.kind) ? node.textRuns : null);
    setEditingSelection(null);
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
      if (pendingSelectionNodeId) {
        onSelectNode(pendingSelectionNodeId);
      }
      restoreCanvasScrollSnapshotSoon(canvasPane, scrollSnapshot);
      return;
    }

    onCommitNodeText(nodeId, nextText);
    if (pendingSelectionNodeId) {
      onSelectNode(pendingSelectionNodeId);
    }
    restoreCanvasScrollSnapshotSoon(canvasPane, scrollSnapshot);
  };

  const handleDraftTextRunsChange = (textRuns: TextRun[]) => {
    const canvasPane = canvasPaneRef.current;
    const scrollSnapshot = createCanvasScrollSnapshot(canvasPane);
    setEditingDraftTextRuns(textRuns);
    if (editingNodeId) {
      onCommitNodeRichText(editingNodeId, textRuns);
    }
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

  const clearFloatingTextFormatting = () => {
    applyFloatingToolbarRuns((textRuns, nodeId) =>
      clearTextFormattingInTextRuns(textRuns, nodeId, editingSelection),
    );
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

  return (
    <section
      ref={canvasPaneRef}
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
            {resolvedStyleContract.pageLabel} · {resolvedStyleContract.templateLabel} · {documentBlockCount} 个结构块
          </span>
        </div>
      </div>
      {parseState === 'error' && parseError ? (
        <div className="canvas-state canvas-state-error">{parseError}</div>
      ) : null}
      {parseState === 'parsing' && documentBlockCount === 0 ? (
        <div className="canvas-state">正在导入 Markdown…</div>
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
      <div className="page-stack" ref={pageStackRef}>
        {pageLayouts.map((page) => {
          const pageTitle = getPageTitle(page.blocks, documentTitle);
          const { frameStyle, pageStyle } = createPageDisplayStyles(page, isCondensed, pageStackWidth);

          return (
            <div
              className="page-frame"
              key={page.pageNumber}
              style={frameStyle}
            >
              <div
                className="page"
                style={pageStyle}
                onClick={onClearSelection}
              >
                <div className="page-header">
                  <span>{pageTitle}</span>
                  <span>{page.contract.pageLabel}</span>
                </div>
                <article className="page-body">
                  {page.blocks.map((block, index) =>
                    renderBlock(
                      block,
                      page.pageNumber * 1000 + index,
                      selectedNodeId,
                      onSelectNode,
                      prepareSelectingNode,
                      editingNodeId,
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
                    ),
                  )}
                </article>
                <div className="page-footer">
                  <span>{page.contract.templateLabel}</span>
                  <span>{page.pageNumber}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
