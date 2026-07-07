import type { LayoutListItem, TextRun } from './types';
import { getLayoutListItemLevel } from './utils';

export const CHOICE_OPTION_LABEL_WIDTH_PX = 22;
export const CHOICE_OPTION_LABEL_GAP_PX = 4;
export const CHOICE_OPTION_COLUMN_GAP_PX = 20;
const SHORT_CHOICE_TEXT_LENGTH = 8;
const MEDIUM_CHOICE_TEXT_LENGTH = 18;
const SEQUENTIAL_CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

export interface ChoiceOptionPrefixMatch {
  label: string;
  normalizedLabel: string;
  prefixLength: number;
  contentText: string;
}

export interface CompactChoicePattern {
  columns: number;
  matches: ChoiceOptionPrefixMatch[];
}

export interface CompactChoiceListItem {
  item: LayoutListItem;
  label: string;
  contentText: string;
  contentTextRuns: TextRun[];
}

export interface CompactChoiceListLayout {
  columns: number;
  items: CompactChoiceListItem[];
}

function getTextContentFromRuns(textRuns: TextRun[]): string {
  return textRuns.map((run) => run.text).join('');
}

function stripChoiceLabelFromTextRuns(textRuns: TextRun[], prefixLength: number): TextRun[] {
  if (prefixLength <= 0) {
    return textRuns;
  }

  let remainingPrefixLength = prefixLength;
  const nextRuns: TextRun[] = [];

  for (const run of textRuns) {
    if (remainingPrefixLength >= run.text.length) {
      remainingPrefixLength -= run.text.length;
      continue;
    }

    if (remainingPrefixLength > 0) {
      nextRuns.push({
        ...run,
        id: `${run.id}-choice-content`,
        text: run.text.slice(remainingPrefixLength),
      });
      remainingPrefixLength = 0;
      continue;
    }

    nextRuns.push(run);
  }

  return nextRuns;
}

export function parseChoiceOptionPrefix(text: string): ChoiceOptionPrefixMatch | null {
  const trimmed = text.trimStart();
  if (!trimmed) {
    return null;
  }

  const letterMarkerMatch = trimmed.match(/^([A-Fa-f])([\.．、:：])\s*(.*)$/su);
  if (letterMarkerMatch) {
    const normalizedLabel = letterMarkerMatch[1].toUpperCase();
    if (!SEQUENTIAL_CHOICE_LABELS.includes(normalizedLabel)) {
      return null;
    }
    const matchedPrefix = trimmed.slice(0, letterMarkerMatch[0].length - (letterMarkerMatch[3]?.length ?? 0)).trimEnd();

    return {
      label: matchedPrefix,
      normalizedLabel,
      prefixLength: text.length - trimmed.length + letterMarkerMatch[0].length - (letterMarkerMatch[3]?.length ?? 0),
      contentText: letterMarkerMatch[3] ?? '',
    };
  }

  const bracketMarkerMatch = trimmed.match(/^[（(]([A-Fa-f])[）)]\s*(.*)$/su);
  if (bracketMarkerMatch) {
    const normalizedLabel = bracketMarkerMatch[1].toUpperCase();
    if (!SEQUENTIAL_CHOICE_LABELS.includes(normalizedLabel)) {
      return null;
    }
    const matchedPrefix = trimmed.slice(0, bracketMarkerMatch[0].length - (bracketMarkerMatch[2]?.length ?? 0)).trimEnd();

    return {
      label: matchedPrefix,
      normalizedLabel,
      prefixLength: text.length - trimmed.length + bracketMarkerMatch[0].length - (bracketMarkerMatch[2]?.length ?? 0),
      contentText: bracketMarkerMatch[2] ?? '',
    };
  }

  return null;
}

function resolveCompactChoiceColumnCount(contentTexts: string[], itemCount: number): number {
  const maxContentLength = Math.max(
    0,
    ...contentTexts.map((text) => text.replace(/\s+/gu, '').length),
  );

  if (maxContentLength <= SHORT_CHOICE_TEXT_LENGTH) {
    return Math.min(4, itemCount);
  }

  if (maxContentLength <= MEDIUM_CHOICE_TEXT_LENGTH) {
    return Math.min(2, itemCount);
  }

  return 1;
}

export function resolveCompactChoicePatternFromTexts(texts: string[]): CompactChoicePattern | null {
  return resolveCompactChoicePatternFromTextsWithOptions(texts);
}

export function resolveCompactChoicePatternFromTextsWithOptions(
  texts: string[],
  options: {
    allowSequenceFromAnyLabel?: boolean;
  } = {},
): CompactChoicePattern | null {
  if (texts.length === 0) {
    return null;
  }

  const matches = texts.map((text) => parseChoiceOptionPrefix(text));
  if (matches.some((match) => !match)) {
    return null;
  }

  const resolvedMatches = matches as ChoiceOptionPrefixMatch[];
  const startLabelIndex = SEQUENTIAL_CHOICE_LABELS.indexOf(resolvedMatches[0].normalizedLabel);
  if (startLabelIndex < 0 || (!options.allowSequenceFromAnyLabel && startLabelIndex !== 0)) {
    return null;
  }

  const isSequential = resolvedMatches.every(
    (match, index) => match.normalizedLabel === SEQUENTIAL_CHOICE_LABELS[startLabelIndex + index],
  );
  if (!isSequential) {
    return null;
  }

  const columns = texts.length === 1
    ? 1
    : resolveCompactChoiceColumnCount(
        resolvedMatches.map((match) => match.contentText),
        resolvedMatches.length,
      );
  // 续页片段可能只剩 C/D，且其中一个选项较长；这时仍要保留选项组身份，只降级为 1 列显示。
  if (columns <= 1 && !options.allowSequenceFromAnyLabel) {
    return null;
  }

  return {
    columns,
    matches: resolvedMatches,
  };
}

export function resolveCompactChoiceListLayout(items: LayoutListItem[]): CompactChoiceListLayout | null {
  return resolveCompactChoiceListLayoutWithOptions(items);
}

export function resolveCompactChoiceListLayoutWithOptions(
  items: LayoutListItem[],
  options: {
    allowSequenceFromAnyLabel?: boolean;
  } = {},
): CompactChoiceListLayout | null {
  if (
    items.length === 0 ||
    items.some((item) => getLayoutListItemLevel(item) !== 1 || item.checked !== null)
  ) {
    return null;
  }

  const texts = items.map((item) => getTextContentFromRuns(item.textRuns));
  const pattern = resolveCompactChoicePatternFromTextsWithOptions(texts, options);
  if (!pattern) {
    return null;
  }

  return {
    columns: pattern.columns,
    items: items.map((item, index) => ({
      item,
      label: pattern.matches[index]?.label ?? '',
      contentText: pattern.matches[index]?.contentText ?? '',
      contentTextRuns: stripChoiceLabelFromTextRuns(item.textRuns, pattern.matches[index]?.prefixLength ?? 0),
    })),
  };
}

export function chunkCompactChoiceItems<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];

  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }

  return rows;
}
