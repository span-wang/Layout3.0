/**
 * 兼容旧导入路径的文字测量壳。
 *
 * 真正的字体测量只保留在 `engine/font-metrics`，分页算法不要在这里重新实现估算规则。
 */

import {
  measureTextLines,
  measureTextSplitOffsetForLineCount,
  measureTextWidth,
  type FontMeasurementStyle,
} from '@/engine/font-metrics';

export const DEFAULT_CODE_CHAR_WIDTH_FACTOR = 0.62;

export interface EstimateTextLinesOptions {
  firstLineWidthPx?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  letterSpacing?: number;
  // 旧调用方仍可能传入该字段；统一字体测量后不再消费字符宽度系数。
  charWidthFactor?: number;
}

function toFontMeasurementStyle(
  fontSize: number,
  options: EstimateTextLinesOptions = {},
): FontMeasurementStyle {
  return {
    fontSize,
    fontFamily: options.fontFamily,
    fontWeight: options.fontWeight,
    fontStyle: options.fontStyle,
    letterSpacing: options.letterSpacing,
  };
}

export function resolveEstimatedTextCharWidthFactor(text: string): number {
  const characters = Array.from(text).filter((char) => char !== '\n' && char !== '\r');
  if (characters.length === 0) {
    return 0;
  }

  // 该函数仅服务表格自动适应等旧宽度估计调用，实际宽度仍来自唯一字体测量接口。
  const width = measureTextWidth(characters.join(''), { fontSize: 1 });
  return Math.max(0.01, width / characters.length);
}

export function estimateTextLines(
  text: string,
  widthPx: number,
  fontSize: number,
  options: EstimateTextLinesOptions = {},
): number {
  return measureTextLines(text, widthPx, toFontMeasurementStyle(fontSize, options), {
    firstLineWidthPx: options.firstLineWidthPx,
  });
}

export function computeTextSplitOffsetForLineCount(
  text: string,
  widthPx: number,
  fontSize: number,
  maxLines: number,
  optionsOrFontFamily?: EstimateTextLinesOptions | string,
): number {
  const options =
    typeof optionsOrFontFamily === 'string'
      ? { fontFamily: optionsOrFontFamily }
      : optionsOrFontFamily ?? {};

  return measureTextSplitOffsetForLineCount(
    text,
    widthPx,
    toFontMeasurementStyle(fontSize, options),
    maxLines,
    {
      firstLineWidthPx: options.firstLineWidthPx,
    },
  );
}
