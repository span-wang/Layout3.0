/**
 * 离屏测量分页算法类型定义
 *
 * 本模块定义 offscreen-measure-v1 专用的类型，与 domMeasure/types.ts 隔离。
 */

import type { LayoutBlock } from '@/engine/document-model';
import type { PageLayout, PaginationAlgorithmContext } from '../../types';

/**
 * 离屏测量分页上下文
 * 在通用分页上下文基础上扩展离屏测量专用字段
 */
export interface OffscreenMeasurePaginationContext extends PaginationAlgorithmContext {
  /** 离屏测量容器引用（由前端注入） */
  offscreenContainer?: HTMLElement | null;
  /** 测量回调（测量完成后通知分页引擎） */
  onMeasured?: (measurementId: string, height: number) => void;
}

/**
 * 离屏测量结果
 */
export interface OffscreenMeasurementResult {
  measurementId: string;
  height: number;
  lineBreaks?: number[];  // 文本行尾索引（用于精确分割）
}

/**
 * 离屏测量任务
 */
export interface OffscreenMeasurementJob {
  id: string;
  block: LayoutBlock;
  width: number;
  /** 0 表示整块高度测量，正数表示测量到指定字符偏移的高度 */
  charOffset?: number;
}

/**
 * 离屏测量分页结果
 */
export interface OffscreenMeasurePaginationResult {
  pages: PageLayout[];
  measurementJobs: OffscreenMeasurementJob[];
  measuredHeights: Record<string, number>;
}
