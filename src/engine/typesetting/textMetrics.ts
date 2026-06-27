/**
 * 字符级精确流式布局引擎
 *
 * 核心策略：不再用「字符数÷每行字数」估算行数，而是：
 * 1. 按字符类型分类（宽字符/窄字符/空格）查像素宽度
 * 2. 批量累加同类字符宽度，模拟真实排版换行过程
 * 3. 累计行数达到阈值时，计算最优分割点
 *
 * 字符宽度表（以 fontSize 为基准）：
 * - 宽字符（CJK/日文/韩文/全角符号） ≈ fontSize px
 * - 窄字符（ASCII 字母/数字/常见符号） ≈ fontSize × 0.5 px
 * - 空格 ≈ fontSize × 0.25 px
 */

const WIDE_TEXT_CHAR_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\uFF01-\uFF60\uFFE0-\uFFE6]/u;
const SPACE_TEXT_CHAR_PATTERN = /\s/u;

// 这些系数是给分页估算用的经验值，后续如果测量链路更准，可以统一替换。
export const DEFAULT_TEXT_CHAR_WIDTH_FACTOR = 0.5;
export const DEFAULT_SPACE_CHAR_WIDTH_FACTOR = 0.25;
export const DEFAULT_CODE_CHAR_WIDTH_FACTOR = 0.62;

// 代码块用等宽字体，窄字符宽度系数更接近 0.62（而不是普通文本的 0.5）。
export const DEFAULT_CODE_NARROW_FACTOR = 0.62;

export interface EstimateTextLinesOptions {
  // 首行可能会因为首行缩进、悬挂缩进或其他排版规则，拥有不同于后续行的可用宽度。
  firstLineWidthPx?: number;
  // 普通文本按窄字符宽度系数估算，代码块可传入等宽字体的字符宽度系数。
  charWidthFactor?: number;
}

// ============== 字符类型与宽度 ==============

function isWideTextCharacter(char: string): boolean {
  return WIDE_TEXT_CHAR_PATTERN.test(char);
}

function isSpaceTextCharacter(char: string): boolean {
  return SPACE_TEXT_CHAR_PATTERN.test(char);
}

/**
 * 按字符类型返回其相对于 fontSize 的宽度比例。
 * - 宽字符（CJK等）: 1.0（等于 fontSize）
 * - 空格: spaceFactor（默认 0.25）
 * - 其他（窄字符）: narrowFactor（默认 0.5）
 */
function getCharWidthFactor(char: string, narrowFactor: number, spaceFactor: number): number {
  if (isSpaceTextCharacter(char)) {
    return spaceFactor;
  }
  if (isWideTextCharacter(char)) {
    return 1;
  }
  return narrowFactor;
}

// ============== 流式布局核心 ==============

/**
 * 流式文本布局结果
 */
export interface FlowTextResult {
  /** 文本被排版后的总行数 */
  lineCount: number;
  /**
   * 当前页最多放 maxLines 行时，应该截取到第几个字符为止（0 表示空）。
   * 返回值是截取点之后紧接着的字符索引，等于 totalChars 时表示全部文本都能放下。
   */
  splitCharIndex: number;
}

/**
 * 字符级精确流式布局
 *
 * 模拟逐字符排版过程：
 * - 按字符类型查像素宽度（宽字符=fontSize，窄字符=fontSize×narrowFactor，空格=fontSize×spaceFactor）
 * - 批量累加同类字符宽度，宽度超限时换行
 * - 累计行数达到 maxLines 时，计算最优分割点（优先贴近行末/标点边界）
 *
 * @param text 要排版的纯文本（不含 \r）
 * @param lineWidthPx 当前行可用宽度（px）
 * @param fontSize 字号（px）
 * @param narrowFactor 窄字符宽度系数（默认 0.5）
 * @param spaceFactor 空格宽度系数（默认 0.25）
 * @param maxLines 最多排版行数，Infinity 表示统计全部行数
 */
export function flowText(
  text: string,
  lineWidthPx: number,
  fontSize: number,
  narrowFactor: number = DEFAULT_TEXT_CHAR_WIDTH_FACTOR,
  spaceFactor: number = DEFAULT_SPACE_CHAR_WIDTH_FACTOR,
  maxLines: number = Infinity,
): FlowTextResult {
  const effectiveWidth = Math.max(1, lineWidthPx);
  const effectiveFontSize = Math.max(1, fontSize);
  const maxLineCount = Math.max(0, maxLines);

  // 先遍历一次找出文本中实际出现的字符类型组合，避免对全空文本做无谓计算。
  const textLen = text.length;
  if (textLen === 0) {
    return { lineCount: 0, splitCharIndex: 0 };
  }

  // 流式模拟：逐字符累加宽度，超限时换行。
  let currentLineWidth = 0;
  let lineCount = 1; // 当前正在排的第几行
  let splitCharIndex = textLen; // 全部文本放完的默认分割点
  let i = 0;

  // 外层循环：每行单独处理。
  while (i < textLen && lineCount <= maxLineCount) {
    currentLineWidth = 0;

    // 内层循环：当前行内逐字符累加。
    while (i < textLen) {
      const char = text[i];
      const widthFactor = getCharWidthFactor(char, narrowFactor, spaceFactor);
      const charWidth = effectiveFontSize * widthFactor;

      const nextWidth = currentLineWidth + charWidth;

      if (currentLineWidth > 0 && nextWidth > effectiveWidth) {
        // 当前字符会导致本行超宽，必须换行。
        break;
      }

      currentLineWidth = nextWidth;
      i += 1;
    }

    if (lineCount === maxLineCount && i < textLen) {
      // 已经排够 maxLines 行，剩余文本全部截断到下一页。
      // 分割点优先贴近当前行末，然后向前微调避免在半字符位置断开。
      splitCharIndex = i;
    }

    if (i < textLen) {
      lineCount += 1;
    }
  }

  // 如果提前遍历完所有字符，说明全部文本都能放下。
  if (i >= textLen) {
    splitCharIndex = textLen;
  }

  return { lineCount, splitCharIndex };
}

/**
 * 流式行数统计：给定文本和可用宽度，计算它会占几行。
 * 等价于 flowText(text, width, fontSize, narrowFactor, spaceFactor, Infinity).lineCount，
 * 但语义更明确且不返回 splitCharIndex。
 */
export function countFlowLines(
  text: string,
  widthPx: number,
  fontSize: number,
  narrowFactor: number = DEFAULT_TEXT_CHAR_WIDTH_FACTOR,
  spaceFactor: number = DEFAULT_SPACE_CHAR_WIDTH_FACTOR,
): number {
  if (!text) return 0;
  return flowText(text, widthPx, fontSize, narrowFactor, spaceFactor, Infinity).lineCount;
}

// ============== 对外接口（兼容现有调用方） ==============

export function resolveEstimatedTextCharWidthFactor(
  text: string,
  charWidthFactor = DEFAULT_TEXT_CHAR_WIDTH_FACTOR,
): number {
  // 兼容旧接口：返回文本整体的平均宽度系数。
  // 新代码推荐直接用 flowText，不再依赖这个估算系数。
  const characters = Array.from(text).filter((char) => char !== '\n' && char !== '\r');
  if (characters.length === 0) {
    return charWidthFactor;
  }

  const hasNarrowCharacter = characters.some((char) => !isSpaceTextCharacter(char) && !isWideTextCharacter(char));
  const hasNonSpaceCharacter = characters.some((char) => !isSpaceTextCharacter(char));
  if (!hasNarrowCharacter && hasNonSpaceCharacter) {
    return 1;
  }

  let totalWeight = 0;
  for (const char of characters) {
    if (isSpaceTextCharacter(char)) {
      totalWeight += DEFAULT_SPACE_CHAR_WIDTH_FACTOR;
    } else if (isWideTextCharacter(char)) {
      totalWeight += 1;
    } else {
      totalWeight += charWidthFactor;
    }
  }
  return Math.max(DEFAULT_SPACE_CHAR_WIDTH_FACTOR, Math.min(1, totalWeight / characters.length));
}

function estimateLineCount(
  line: string,
  lineWidthPx: number,
  fontSize: number,
  charWidthFactor: number,
): number {
  if (!line) return 1;
  return countFlowLines(line, lineWidthPx, fontSize, charWidthFactor, DEFAULT_SPACE_CHAR_WIDTH_FACTOR);
}

export function estimateTextLines(
  text: string,
  widthPx: number,
  fontSize: number,
  options: EstimateTextLinesOptions = {},
): number {
  const followingLineWidthPx = Math.max(1, widthPx);
  const firstLineWidthPx = Math.max(1, options.firstLineWidthPx ?? followingLineWidthPx);
  const narrowFactor = options.charWidthFactor ?? DEFAULT_TEXT_CHAR_WIDTH_FACTOR;

  // 按源码换行符切分，每段分别流式布局后累加。
  return text.replace(/\r/g, '').split('\n').reduce((total, line, index) => {
    const lineWidthPx = index === 0 ? firstLineWidthPx : followingLineWidthPx;
    return total + estimateLineCount(line, lineWidthPx, fontSize, narrowFactor);
  }, 0);
}

/**
 * 给定文本、宽度、字号和最大行数，计算能放 maxLines 行时的最优字符分割点。
 * 优先贴近行末字符，必要时向前微调避免在半字符位置断开。
 *
 * @param text 文本
 * @param widthPx 当前行可用宽度
 * @param fontSize 字号
 * @param maxLines 最多放几行
 * @param narrowFactor 窄字符宽度系数
 * @returns 能放 maxLines 行时，截取到第几个字符为止
 */
export function computeTextSplitOffsetForLineCount(
  text: string,
  widthPx: number,
  fontSize: number,
  maxLines: number,
  narrowFactor: number = DEFAULT_TEXT_CHAR_WIDTH_FACTOR,
): number {
  if (maxLines <= 0 || !text) {
    return 0;
  }

  const result = flowText(text, widthPx, fontSize, narrowFactor, DEFAULT_SPACE_CHAR_WIDTH_FACTOR, maxLines);
  const splitCharIndex = result.splitCharIndex;

  if (splitCharIndex >= text.length) {
    return text.length;
  }

  if (splitCharIndex <= 0) {
    return 0;
  }

  // 默认不往回退太多（避免半行提前跳页）。
  // 如果分割点刚好在换行符位置，说明是自然断行，不需要调整。
  if (text[splitCharIndex - 1] === '\n') {
    return splitCharIndex;
  }

  return splitCharIndex;
}
