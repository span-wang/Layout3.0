import {
  getTextContentFromRuns,
  mergeAdjacentTextRuns,
  type LayoutBlock,
  type LayoutDocument,
  type TextRun,
} from '@/engine/document-model';
import { createTextFragment } from '@/engine/document-model/utils';

export interface DocumentSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export type DocumentSearchReplacementMode = 'richText' | 'plainText';

export interface DocumentSearchResult {
  id: string;
  nodeId: string;
  ownerBlockId: string;
  kindLabel: string;
  text: string;
  matchText: string;
  matchStart: number;
  matchEnd: number;
  previewBefore: string;
  previewAfter: string;
  replacementMode: DocumentSearchReplacementMode;
  textRuns: TextRun[] | null;
}

export interface DocumentSearchReplacementDraft {
  nodeId: string;
  matchCount: number;
  text?: string;
  textRuns?: TextRun[];
}

interface SearchableDocumentNode {
  nodeId: string;
  ownerBlockId: string;
  kindLabel: string;
  text: string;
  replacementMode: DocumentSearchReplacementMode;
  textRuns: TextRun[] | null;
}

interface MatchRange {
  start: number;
  end: number;
}

const previewRadius = 28;

function normalizeSearchValue(value: string, options: DocumentSearchOptions): string {
  return options.caseSensitive ? value : value.toLocaleLowerCase();
}

function isWordCharacter(char: string | undefined): boolean {
  return !!char && /^[\p{L}\p{N}_]$/u.test(char);
}

function isWholeWordMatch(text: string, start: number, end: number): boolean {
  return !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end]);
}

function findMatchRanges(text: string, query: string, options: DocumentSearchOptions): MatchRange[] {
  const normalizedText = normalizeSearchValue(text, options);
  const normalizedQuery = normalizeSearchValue(query, options);
  const ranges: MatchRange[] = [];
  let searchIndex = 0;

  while (searchIndex <= normalizedText.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, searchIndex);
    if (matchIndex < 0) {
      break;
    }

    const matchEnd = matchIndex + normalizedQuery.length;
    if (!options.wholeWord || isWholeWordMatch(text, matchIndex, matchEnd)) {
      ranges.push({ start: matchIndex, end: matchEnd });
    }

    searchIndex = matchIndex + Math.max(1, normalizedQuery.length);
  }

  return ranges;
}

function buildSearchPreview(text: string, start: number, end: number): {
  previewBefore: string;
  previewAfter: string;
} {
  const beforeStart = Math.max(0, start - previewRadius);
  const afterEnd = Math.min(text.length, end + previewRadius);
  const prefix = beforeStart > 0 ? '…' : '';
  const suffix = afterEnd < text.length ? '…' : '';

  return {
    previewBefore: `${prefix}${text.slice(beforeStart, start)}`,
    previewAfter: `${text.slice(end, afterEnd)}${suffix}`,
  };
}

function collectSearchableNodes(
  blocks: LayoutBlock[],
  containerLabels: string[] = [],
): SearchableDocumentNode[] {
  const nodes: SearchableDocumentNode[] = [];

  for (const block of blocks) {
    const nestedLabel = containerLabels.length > 0 ? `${containerLabels.join(' / ')} / ` : '';

    if (block.type === 'heading' && block.metadata.kind === 'heading') {
      nodes.push({
        nodeId: block.id,
        ownerBlockId: block.id,
        kindLabel: `${nestedLabel}标题`,
        text: getTextContentFromRuns(block.textRuns),
        replacementMode: 'richText',
        textRuns: block.textRuns,
      });
      continue;
    }

    if (block.type === 'paragraph' && block.metadata.kind === 'paragraph') {
      nodes.push({
        nodeId: block.id,
        ownerBlockId: block.id,
        kindLabel: `${nestedLabel}段落`,
        text: getTextContentFromRuns(block.textRuns),
        replacementMode: 'richText',
        textRuns: block.textRuns,
      });
      continue;
    }

    if (block.type === 'code' && block.metadata.kind === 'code') {
      nodes.push({
        nodeId: block.id,
        ownerBlockId: block.id,
        kindLabel: `${nestedLabel}代码`,
        text: getTextContentFromRuns(block.textRuns),
        replacementMode: 'richText',
        textRuns: block.textRuns,
      });
      continue;
    }

    if (block.type === 'equation' && block.metadata.kind === 'equation') {
      nodes.push({
        nodeId: block.id,
        ownerBlockId: block.id,
        kindLabel: `${nestedLabel}公式`,
        text: block.metadata.value,
        replacementMode: 'plainText',
        textRuns: null,
      });
      continue;
    }

    if (block.type === 'image' && block.metadata.kind === 'image') {
      nodes.push({
        nodeId: block.id,
        ownerBlockId: block.id,
        kindLabel: `${nestedLabel}图片说明`,
        text: block.metadata.alt,
        replacementMode: 'plainText',
        textRuns: null,
      });
      continue;
    }

    if (block.type === 'list' && block.metadata.kind === 'list') {
      block.metadata.items.forEach((item, itemIndex) => {
        nodes.push({
          nodeId: item.id,
          ownerBlockId: block.id,
          kindLabel: `${nestedLabel}列表项 ${itemIndex + 1}`,
          text: getTextContentFromRuns(item.textRuns),
          replacementMode: 'richText',
          textRuns: item.textRuns,
        });
      });
      continue;
    }

    if (block.type === 'table' && block.metadata.kind === 'table') {
      block.metadata.rows.forEach((row, rowIndex) => {
        row.cells.forEach((cell, columnIndex) => {
          nodes.push({
            nodeId: cell.id,
            ownerBlockId: block.id,
            kindLabel: `${nestedLabel}表格 R${rowIndex + 1}C${columnIndex + 1}`,
            text: getTextContentFromRuns(cell.textRuns),
            replacementMode: 'richText',
            textRuns: cell.textRuns,
          });
        });
      });
      continue;
    }

    if (block.type === 'blockquote' && block.metadata.kind === 'blockquote') {
      nodes.push(...collectSearchableNodes(block.metadata.blocks, [...containerLabels, '引用']));
      continue;
    }

    if (block.type === 'columnSection' && block.metadata.kind === 'columnSection') {
      nodes.push(...collectSearchableNodes(block.metadata.blocks, [...containerLabels, '局部分栏']));
    }
  }

  return nodes;
}

function rebuildSearchRunIds(nodeId: string, textRuns: TextRun[]): TextRun[] {
  return textRuns.map((run, index) => ({
    ...run,
    id: `${nodeId}-run-${index + 1}-${createTextFragment(run.text, 'text')}`,
  }));
}

function appendTextRunRange(
  output: TextRun[],
  textRuns: TextRun[],
  rangeStart: number,
  rangeEnd: number,
): void {
  if (rangeStart >= rangeEnd) {
    return;
  }

  let offset = 0;
  for (const run of textRuns) {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    offset = runEnd;

    const sliceStart = Math.max(rangeStart, runStart);
    const sliceEnd = Math.min(rangeEnd, runEnd);
    if (sliceStart >= sliceEnd) {
      continue;
    }

    output.push({
      ...run,
      text: run.text.slice(sliceStart - runStart, sliceEnd - runStart),
      sourceRange: sliceStart === runStart && sliceEnd === runEnd ? run.sourceRange : null,
    });
  }
}

function findRunForOffset(textRuns: TextRun[], offset: number): TextRun | null {
  let cursor = 0;
  for (const run of textRuns) {
    const nextCursor = cursor + run.text.length;
    if (offset >= cursor && offset < nextCursor) {
      return run;
    }
    cursor = nextCursor;
  }

  return textRuns[textRuns.length - 1] ?? null;
}

function replaceTextByRanges(text: string, ranges: MatchRange[], replacementText: string): string {
  let nextText = '';
  let cursor = 0;

  for (const range of ranges) {
    nextText += text.slice(cursor, range.start);
    nextText += replacementText;
    cursor = range.end;
  }

  return `${nextText}${text.slice(cursor)}`;
}

function replaceTextRunsByRanges(
  nodeId: string,
  textRuns: TextRun[],
  ranges: MatchRange[],
  replacementText: string,
): TextRun[] {
  const nextRuns: TextRun[] = [];
  let cursor = 0;

  for (const range of ranges) {
    appendTextRunRange(nextRuns, textRuns, cursor, range.start);

    if (replacementText) {
      const baseRun = findRunForOffset(textRuns, range.start);
      nextRuns.push({
        id: `${nodeId}-run-replacement`,
        text: replacementText,
        sourceRange: null,
        marks: baseRun?.marks ? [...baseRun.marks] : [],
        charStyleRef: baseRun?.charStyleRef ?? null,
        styleOverrides: baseRun?.styleOverrides ? { ...baseRun.styleOverrides } : {},
        annotations: [],
      });
    }

    cursor = range.end;
  }

  appendTextRunRange(nextRuns, textRuns, cursor, getTextContentFromRuns(textRuns).length);
  return rebuildSearchRunIds(nodeId, mergeAdjacentTextRuns(nextRuns));
}

export function searchLayoutDocument(
  document: LayoutDocument | null,
  query: string,
  options: DocumentSearchOptions,
): DocumentSearchResult[] {
  const normalizedQuery = query.trim();
  if (!document || !normalizedQuery) {
    return [];
  }

  const nodes = collectSearchableNodes(document.blocks);
  const results: DocumentSearchResult[] = [];

  nodes.forEach((node) => {
    const ranges = findMatchRanges(node.text, normalizedQuery, options);
    ranges.forEach((range) => {
      const preview = buildSearchPreview(node.text, range.start, range.end);
      results.push({
        id: `${node.nodeId}-${range.start}-${range.end}-${results.length}`,
        nodeId: node.nodeId,
        ownerBlockId: node.ownerBlockId,
        kindLabel: node.kindLabel,
        text: node.text,
        matchText: node.text.slice(range.start, range.end),
        matchStart: range.start,
        matchEnd: range.end,
        previewBefore: preview.previewBefore,
        previewAfter: preview.previewAfter,
        replacementMode: node.replacementMode,
        textRuns: node.textRuns,
      });
    });
  });

  return results;
}

export function createDocumentSearchReplacementDrafts(
  results: DocumentSearchResult[],
  replacementText: string,
): DocumentSearchReplacementDraft[] {
  const groups = new Map<string, DocumentSearchResult[]>();

  for (const result of results) {
    const currentGroup = groups.get(result.nodeId) ?? [];
    currentGroup.push(result);
    groups.set(result.nodeId, currentGroup);
  }

  return [...groups.values()].map((group) => {
    const firstResult = group[0];
    const ranges = group
      .map((result) => ({ start: result.matchStart, end: result.matchEnd }))
      .sort((left, right) => left.start - right.start);

    if (firstResult.replacementMode === 'richText' && firstResult.textRuns) {
      return {
        nodeId: firstResult.nodeId,
        matchCount: ranges.length,
        textRuns: replaceTextRunsByRanges(firstResult.nodeId, firstResult.textRuns, ranges, replacementText),
      };
    }

    return {
      nodeId: firstResult.nodeId,
      matchCount: ranges.length,
      text: replaceTextByRanges(firstResult.text, ranges, replacementText),
    };
  });
}
