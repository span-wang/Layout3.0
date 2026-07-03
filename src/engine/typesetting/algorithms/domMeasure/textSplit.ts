import { computeTextSplitOffsetForLineCount, estimateTextLines } from '../../textMetrics';

export interface TextSplitResult {
  currentPageText: string;
  remainingText: string;
  splitOffset: number;
}

// 第一版先按真实换行索引切分；如果没有测量结果，再回退到现有估算行数切分。
export function splitTextForAvailableLines(params: {
  text: string;
  widthPx: number;
  fontSize: number;
  availableLineCount: number;
  measuredLineBreaks?: number[];
  firstLineWidthPx?: number;
}): TextSplitResult | null {
  const { text, widthPx, fontSize, availableLineCount, measuredLineBreaks, firstLineWidthPx } = params;
  if (!text.trim() || availableLineCount <= 0) {
    return null;
  }

  let splitOffset = 0;

  if (measuredLineBreaks && measuredLineBreaks.length > availableLineCount) {
    splitOffset = measuredLineBreaks[availableLineCount - 1] ?? 0;
  } else if (measuredLineBreaks && measuredLineBreaks.length > 0) {
    splitOffset = measuredLineBreaks[measuredLineBreaks.length - 1] ?? 0;
  } else {
    const estimatedLineCount = estimateTextLines(text, widthPx, fontSize, { firstLineWidthPx });
    if (estimatedLineCount <= availableLineCount) {
      return {
        currentPageText: text,
        remainingText: '',
        splitOffset: text.length,
      };
    }

    splitOffset = computeTextSplitOffsetForLineCount(text, widthPx, fontSize, availableLineCount);
  }

  if (splitOffset <= 0 || splitOffset >= text.length) {
    return null;
  }

  const currentPageText = text.slice(0, splitOffset);
  const remainingText = text.slice(splitOffset);

  if (!currentPageText || !remainingText) {
    return null;
  }

  return {
    currentPageText,
    remainingText,
    splitOffset,
  };
}
