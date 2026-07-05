/**
 * 行级精确文本切分
 *
 * 基于离屏测量结果，对文本进行精确到像素级别的分割。
 * 使用二分查找找到刚好能放入可用高度的字符偏移点。
 */

import type { LayoutBlock, TextRun } from '@/engine/document-model';
import { measureTextLines } from '@/engine/font-metrics';
import type { OffscreenMeasurementJob } from './types';

/**
 * 测量回调函数类型
 */
export type MeasurementCallback = (jobId: string, height: number) => void;

/**
 * 文本片段测量请求
 */
export interface TextFragmentMeasureRequest {
  id: string;
  text: string;
  width: number;
  fontSize: number;
  lineHeight: number;
  /** 可选：指定字符偏移处的高度 */
  charOffset?: number;
}

/**
 * 精确分割结果
 */
export interface PreciseSplitResult {
  splitOffset: number;      // 分割字符偏移
  measuredHeight: number;   // 实测高度
  lineBreaks: number[];    // 所有行尾索引
}

/**
 * 测量状态管理
 */
export class MeasurementState {
  private measuredHeights: Map<string, number> = new Map();
  private pendingJobs: Map<string, TextFragmentMeasureRequest> = new Map();
  private measurementCallback: MeasurementCallback | null = null;

  /**
   * 设置测量回调
   */
  setCallback(callback: MeasurementCallback | null): void {
    this.measurementCallback = callback;
  }

  /**
   * 记录测量结果
   */
  recordMeasurement(id: string, height: number): void {
    this.measuredHeights.set(id, height);
  }

  /**
   * 获取已测量的高度
   */
  getMeasuredHeight(id: string): number | null {
    return this.measuredHeights.get(id) ?? null;
  }

  /**
   * 添加待测量任务
   */
  addPendingJob(job: TextFragmentMeasureRequest): void {
    this.pendingJobs.set(job.id, job);
  }

  /**
   * 获取待测量任务
   */
  getPendingJob(id: string): TextFragmentMeasureRequest | undefined {
    return this.pendingJobs.get(id);
  }

  /**
   * 清除所有测量状态
   */
  clear(): void {
    this.measuredHeights.clear();
    this.pendingJobs.clear();
  }
}

/**
 * 通过唯一字体测量接口计算文本行数。
 */
export function estimateTextLineCount(
  text: string,
  width: number,
  fontSize: number,
  fontFamily?: string,
): number {
  return measureTextLines(text, width, { fontSize, fontFamily });
}

/**
 * 使用二分查找找到最优分割点
 */
export function binarySearchSplitOffset(
  text: string,
  maxHeight: number,
  measureFn: (offset: number) => number
): { splitOffset: number; measuredHeight: number } {
  let left = 0;
  let right = text.length;
  let bestOffset = 0;
  let bestHeight = Infinity;

  // 二分查找
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const height = measureFn(mid);

    if (height <= maxHeight) {
      // 这个偏移可以放入，记录并尝试更多字符
      bestOffset = mid;
      bestHeight = height;
      left = mid + 1;
    } else {
      // 超出高度，减少字符
      right = mid - 1;
    }
  }

  // 微调：尝试附近几个偏移点找最优
  for (let delta = -5; delta <= 5; delta++) {
    const testOffset = Math.max(0, Math.min(text.length, bestOffset + delta));
    if (testOffset === bestOffset) continue;

    const height = measureFn(testOffset);
    if (height <= maxHeight && height > bestHeight) {
      bestOffset = testOffset;
      bestHeight = height;
    }
  }

  return { splitOffset: bestOffset, measuredHeight: bestHeight };
}

/**
 * 收集候选分割点
 * 包括：行尾、标点、单词边界
 */
export function collectCandidateSplitOffsets(
  text: string,
  measuredLineBreaks?: number[]
): number[] {
  const candidates = new Set<number>();

  // 1. 加入已测量的行尾索引
  if (measuredLineBreaks && measuredLineBreaks.length > 0) {
    measuredLineBreaks.forEach((offset) => {
      if (offset > 0 && offset < text.length) {
        candidates.add(offset);
      }
    });
  }

  // 2. 加入自然断点：段落、句子、换行
  const naturalBreaks = [
    '\n\n',   // 段落分隔
    '。', '！', '？', '；', '：',  // 中文句子结束
    '. ', '! ', '? ', '; ', ': ',  // 英文句子结束
    '\n',     // 换行
  ];

  let searchIndex = 0;
  while (searchIndex < text.length) {
    let earliestBreak = text.length;

    for (const breakChar of naturalBreaks) {
      const idx = text.indexOf(breakChar, searchIndex);
      if (idx !== -1 && idx < earliestBreak) {
        earliestBreak = idx + breakChar.length;
      }
    }

    if (earliestBreak < text.length) {
      candidates.add(earliestBreak);
      searchIndex = earliestBreak;
    } else {
      break;
    }
  }

  // 3. 加入空格（单词边界）
  let lastSpace = -1;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (i - lastSpace > 10) {  // 避免过于密集
        candidates.add(i);
      }
      lastSpace = i;
    }
  }

  return Array.from(candidates)
    .filter((offset) => offset > 0 && offset < text.length)
    .sort((a, b) => a - b);
}

/**
 * 找到刚好放入可用高度的分割点
 */
export function findOptimalSplitOffset(
  text: string,
  availableHeight: number,
  lineHeight: number,
  candidates: number[],
  measureFn: (offset: number) => number
): { splitOffset: number; measuredHeight: number } {
  if (candidates.length === 0) {
    // 没有候选，使用估算
    const estimatedLineCount = Math.floor(availableHeight / lineHeight);
    const estimatedOffset = Math.floor((text.length * estimatedLineCount) / (estimateTextLineCount(text, availableHeight / lineHeight * 12, 12)));
    return { splitOffset: Math.min(estimatedOffset, text.length), measuredHeight: measureFn(Math.min(estimatedOffset, text.length)) };
  }

  // 筛选出高度在可用范围内的候选
  const validCandidates: { offset: number; height: number }[] = [];

  for (const offset of candidates) {
    const height = measureFn(offset);
    if (height <= availableHeight) {
      validCandidates.push({ offset, height });
    }
  }

  if (validCandidates.length === 0) {
    // 没有候选能放入，返回最短的（安全选择）
    const firstCandidate = candidates[0];
    return { splitOffset: firstCandidate, measuredHeight: measureFn(firstCandidate) };
  }

  // 选择高度最大的（最优利用空间）
  validCandidates.sort((a, b) => b.height - a.height);
  return { splitOffset: validCandidates[0].offset, measuredHeight: validCandidates[0].height };
}

/**
 * 切分 TextRun 数组到指定偏移
 */
export function splitTextRuns(
  runs: TextRun[],
  splitOffset: number
): { currentRuns: TextRun[]; remainingRuns: TextRun[] } {
  const currentRuns: TextRun[] = [];
  const remainingRuns: TextRun[] = [];
  let cursor = 0;

  for (const run of runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;

    if (runEnd <= splitOffset) {
      // 整个 run 都在当前页
      currentRuns.push({ ...run });
    } else if (runStart >= splitOffset) {
      // 整个 run 都在剩余部分
      remainingRuns.push({ ...run });
    } else {
      // run 被分割
      const localOffset = splitOffset - runStart;
      const currentText = run.text.slice(0, localOffset);
      const remainingText = run.text.slice(localOffset);

      if (currentText) {
        currentRuns.push({
          ...run,
          id: `${run.id}-frag`,
          text: currentText,
          sourceRange: null,
        });
      }

      if (remainingText) {
        remainingRuns.push({
          ...run,
          id: `${run.id}-rest`,
          text: remainingText,
          sourceRange: null,
        });
      }
    }

    cursor = runEnd;
  }

  return { currentRuns, remainingRuns };
}
