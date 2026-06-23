const WIDE_TEXT_CHAR_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\uFF01-\uFF60\uFFE0-\uFFE6]/u;
const SPACE_TEXT_CHAR_PATTERN = /\s/u;

// 这几个系数不是像素级真值，而是给分页估算用的经验值，后续如果测量链路更准，再统一替换。
export const DEFAULT_TEXT_CHAR_WIDTH_FACTOR = 0.56;
export const DEFAULT_SPACE_CHAR_WIDTH_FACTOR = 0.33;
export const DEFAULT_CODE_CHAR_WIDTH_FACTOR = 0.62;

export interface EstimateTextLinesOptions {
  // 首行可能会因为首行缩进、悬挂缩进或其他排版规则，拥有不同于后续行的可用宽度。
  firstLineWidthPx?: number;
  // 普通文本按窄字符宽度系数估算，代码块可传入等宽字体的字符宽度系数。
  charWidthFactor?: number;
}

function isWideTextCharacter(char: string): boolean {
  return WIDE_TEXT_CHAR_PATTERN.test(char);
}

function isSpaceTextCharacter(char: string): boolean {
  return SPACE_TEXT_CHAR_PATTERN.test(char);
}

function getTextCharWidthWeight(char: string, charWidthFactor: number): number {
  if (isSpaceTextCharacter(char)) {
    return DEFAULT_SPACE_CHAR_WIDTH_FACTOR;
  }

  if (isWideTextCharacter(char)) {
    return 1;
  }

  return charWidthFactor;
}

function countVisibleCharacters(text: string): number {
  let count = 0;
  for (const char of text) {
    if (char === '\n' || char === '\r') {
      continue;
    }

    count += 1;
  }

  return count;
}

export function resolveEstimatedTextCharWidthFactor(
  text: string,
  charWidthFactor = DEFAULT_TEXT_CHAR_WIDTH_FACTOR,
): number {
  const characters = Array.from(text).filter((char) => char !== '\n' && char !== '\r');
  if (characters.length === 0) {
    return charWidthFactor;
  }

  const hasNarrowCharacter = characters.some((char) => !isSpaceTextCharacter(char) && !isWideTextCharacter(char));
  const hasNonSpaceCharacter = characters.some((char) => !isSpaceTextCharacter(char));
  if (!hasNarrowCharacter && hasNonSpaceCharacter) {
    return 1;
  }

  const totalWeight = characters.reduce(
    (sum, char) => sum + getTextCharWidthWeight(char, charWidthFactor),
    0,
  );
  return Math.max(DEFAULT_SPACE_CHAR_WIDTH_FACTOR, Math.min(1, totalWeight / characters.length));
}

function estimateLineCount(
  line: string,
  lineWidthPx: number,
  fontSize: number,
  charWidthFactor: number,
): number {
  const visibleCharacterCount = Math.max(1, countVisibleCharacters(line));
  const charsPerLine = Math.max(1, Math.floor(lineWidthPx / Math.max(1, fontSize * charWidthFactor)));
  return Math.max(1, Math.ceil(visibleCharacterCount / charsPerLine));
}

export function estimateTextLines(
  text: string,
  widthPx: number,
  fontSize: number,
  options: EstimateTextLinesOptions = {},
): number {
  const followingLineWidthPx = Math.max(1, widthPx);
  const firstLineWidthPx = Math.max(1, options.firstLineWidthPx ?? followingLineWidthPx);
  const charWidthFactor = options.charWidthFactor ?? DEFAULT_TEXT_CHAR_WIDTH_FACTOR;

  return text.replace(/\r/g, '').split('\n').reduce((total, line, index) => {
    const lineWidthPx = index === 0 ? firstLineWidthPx : followingLineWidthPx;
    const lineCharWidthFactor = resolveEstimatedTextCharWidthFactor(line, charWidthFactor);
    return total + estimateLineCount(line, lineWidthPx, fontSize, lineCharWidthFactor);
  }, 0);
}
