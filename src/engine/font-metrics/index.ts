/**
 * 唯一字体测量入口。
 *
 * 分页算法只允许调用本模块的接口，不直接碰 canvas、DOM Range 或字符宽度经验表。
 * 浏览器环境默认使用 CanvasRenderingContext2D.measureText()，从最终渲染字体得到宽度。
 */

export interface FontMeasurementStyle {
  fontSize: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  letterSpacing?: number;
}

export interface MeasureTextLinesOptions {
  firstLineWidthPx?: number;
}

export interface FontMeasuredTextFlow {
  lineCount: number;
  splitCharIndex: number;
}

export interface FontMetricsProvider {
  measureTextWidth(text: string, style: FontMeasurementStyle): number;
}

const DEFAULT_FONT_FAMILY = '"Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

let activeProvider: FontMetricsProvider | null = null;
let browserCanvasProvider: FontMetricsProvider | null = null;
const widthCache = new Map<string, number>();

function getSafeFontSize(fontSize: number): number {
  return Number.isFinite(fontSize) ? Math.max(1, fontSize) : 16;
}

function getSafeLineWidth(widthPx: number): number {
  return Number.isFinite(widthPx) ? Math.max(1, widthPx) : 1;
}

function getSafeLetterSpacing(style: FontMeasurementStyle): number {
  return Number.isFinite(style.letterSpacing) ? style.letterSpacing ?? 0 : 0;
}

function countTextCharacters(text: string): number {
  return Array.from(text).length;
}

function quoteFontFamilyIfNeeded(fontFamily: string): string {
  const trimmed = fontFamily.trim();
  if (!trimmed) {
    return DEFAULT_FONT_FAMILY;
  }

  if (
    trimmed.includes(',') ||
    trimmed.startsWith('"') ||
    trimmed.startsWith("'") ||
    /^[a-z-]+$/i.test(trimmed)
  ) {
    return trimmed;
  }

  return `"${trimmed.replaceAll('"', '\\"')}"`;
}

function buildCanvasFont(style: FontMeasurementStyle): string {
  const fontStyle = style.fontStyle ?? 'normal';
  const fontWeight = style.fontWeight ?? '400';
  const fontSize = getSafeFontSize(style.fontSize);
  const fontFamily = quoteFontFamilyIfNeeded(style.fontFamily ?? DEFAULT_FONT_FAMILY);

  return `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
}

function createBrowserCanvasFontMetricsProvider(): FontMetricsProvider | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  return {
    measureTextWidth(text, style) {
      context.font = buildCanvasFont(style);
      return context.measureText(text).width;
    },
  };
}

function resolveFontMetricsProvider(): FontMetricsProvider {
  if (activeProvider) {
    return activeProvider;
  }

  if (!browserCanvasProvider) {
    browserCanvasProvider = createBrowserCanvasFontMetricsProvider();
  }

  if (browserCanvasProvider) {
    return browserCanvasProvider;
  }

  throw new Error('当前运行环境没有可用的字体测量 provider。请在非浏览器验证环境中注入 FontMetricsProvider。');
}

function getMeasurementCacheKey(text: string, style: FontMeasurementStyle): string {
  return JSON.stringify({
    text,
    fontSize: getSafeFontSize(style.fontSize),
    fontFamily: style.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontWeight: style.fontWeight ?? '400',
    fontStyle: style.fontStyle ?? 'normal',
    letterSpacing: getSafeLetterSpacing(style),
  });
}

function measureSingleLineTextWidth(text: string, style: FontMeasurementStyle): number {
  if (!text) {
    return 0;
  }

  const cacheKey = getMeasurementCacheKey(text, style);
  const cachedWidth = widthCache.get(cacheKey);
  if (cachedWidth !== undefined) {
    return cachedWidth;
  }

  const provider = resolveFontMetricsProvider();
  const rawWidth = provider.measureTextWidth(text, {
    ...style,
    fontSize: getSafeFontSize(style.fontSize),
  });
  const letterSpacingWidth = Math.max(0, countTextCharacters(text) - 1) * getSafeLetterSpacing(style);
  const width = Math.max(0, rawWidth + letterSpacingWidth);

  widthCache.set(cacheKey, width);
  return width;
}

export function setFontMetricsProvider(provider: FontMetricsProvider | null): void {
  activeProvider = provider;
  widthCache.clear();
}

export function resetFontMetricsProvider(): void {
  activeProvider = null;
  widthCache.clear();
}

export function clearFontMetricsCache(): void {
  widthCache.clear();
}

export function measureTextWidth(text: string, style: FontMeasurementStyle): number {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .reduce((maxWidth, line) => Math.max(maxWidth, measureSingleLineTextWidth(line, style)), 0);
}

function measureCharacterWidth(char: string, style: FontMeasurementStyle, hasPreviousCharInLine: boolean): number {
  const spacingWidth = hasPreviousCharInLine ? getSafeLetterSpacing(style) : 0;
  return measureSingleLineTextWidth(char, style) + spacingWidth;
}

function flowSingleSourceLine(
  text: string,
  widthPx: number,
  style: FontMeasurementStyle,
  maxLines = Infinity,
): FontMeasuredTextFlow {
  const effectiveWidth = getSafeLineWidth(widthPx);
  const maxLineCount = Number.isFinite(maxLines) ? Math.max(0, Math.floor(maxLines)) : Infinity;

  if (maxLineCount <= 0) {
    return { lineCount: 0, splitCharIndex: 0 };
  }

  if (text.length === 0) {
    return { lineCount: 1, splitCharIndex: 0 };
  }

  let lineCount = 1;
  let currentLineWidth = 0;
  let splitCharIndex = text.length;
  let offset = 0;

  while (offset < text.length) {
    const char = Array.from(text.slice(offset))[0] ?? '';
    const nextOffset = offset + char.length;
    const charWidth = measureCharacterWidth(char, style, currentLineWidth > 0);
    const nextWidth = currentLineWidth + charWidth;

    if (currentLineWidth > 0 && nextWidth > effectiveWidth) {
      if (lineCount >= maxLineCount) {
        splitCharIndex = offset;
        break;
      }

      lineCount += 1;
      currentLineWidth = 0;
      continue;
    }

    currentLineWidth = nextWidth;
    offset = nextOffset;
  }

  if (offset >= text.length) {
    splitCharIndex = text.length;
  }

  return {
    lineCount,
    splitCharIndex,
  };
}

export function measureTextLines(
  text: string,
  widthPx: number,
  style: FontMeasurementStyle,
  options: MeasureTextLinesOptions = {},
): number {
  const followingLineWidthPx = getSafeLineWidth(widthPx);
  const firstLineWidthPx = getSafeLineWidth(options.firstLineWidthPx ?? followingLineWidthPx);

  return text
    .replace(/\r/g, '')
    .split('\n')
    .reduce((total, line, index) => {
      const lineWidthPx = index === 0 ? firstLineWidthPx : followingLineWidthPx;
      return total + flowSingleSourceLine(line, lineWidthPx, style).lineCount;
    }, 0);
}

export function measureTextSplitOffsetForLineCount(
  text: string,
  widthPx: number,
  style: FontMeasurementStyle,
  maxLines: number,
  options: MeasureTextLinesOptions = {},
): number {
  const maxLineCount = Math.max(0, Math.floor(maxLines));
  if (maxLineCount <= 0 || !text) {
    return 0;
  }

  const normalizedText = text.replace(/\r/g, '');
  const followingLineWidthPx = getSafeLineWidth(widthPx);
  const firstLineWidthPx = getSafeLineWidth(options.firstLineWidthPx ?? followingLineWidthPx);
  const sourceLines = normalizedText.split('\n');
  let usedLineCount = 0;
  let sourceOffset = 0;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    const isLastLine = index === sourceLines.length - 1;
    const lineWidthPx = index === 0 ? firstLineWidthPx : followingLineWidthPx;
    const lineFlow = flowSingleSourceLine(line, lineWidthPx, style);

    if (usedLineCount + lineFlow.lineCount <= maxLineCount) {
      usedLineCount += lineFlow.lineCount;
      sourceOffset += line.length + (isLastLine ? 0 : 1);
      continue;
    }

    const remainingLines = maxLineCount - usedLineCount;
    const splitInLine = flowSingleSourceLine(line, lineWidthPx, style, remainingLines).splitCharIndex;
    return Math.max(0, Math.min(normalizedText.length, sourceOffset + splitInLine));
  }

  return normalizedText.length;
}

export function createDeterministicFontMetricsProvider(): FontMetricsProvider {
  return {
    measureTextWidth(text, style) {
      const fontSize = getSafeFontSize(style.fontSize);
      return Array.from(text).reduce((total, char) => {
        if (/\s/u.test(char)) {
          return total + fontSize * 0.25;
        }

        if (
          /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\uFF01-\uFF60\uFFE0-\uFFE6]/u.test(char)
        ) {
          return total + fontSize;
        }

        return total + fontSize * 0.5;
      }, 0);
    },
  };
}
