import type { ImageBlockMetadata } from './types';

export interface ResolvedImageLayout {
  widthPx: number | null;
  heightPx: number | null;
  objectFit: 'contain' | 'cover';
  cropTopPx: number;
  cropRightPx: number;
  cropBottomPx: number;
  cropLeftPx: number;
  wrapMode: 'block' | 'center' | 'left' | 'right';
}

export interface ImageMeasuredVisibleSize {
  widthPx: number | null;
  heightPx: number | null;
}

export interface ResolvedImageRenderMetrics {
  fullWidthPx: number | null;
  fullHeightPx: number | null;
  visibleWidthPx: number | null;
  visibleHeightPx: number | null;
  cropTopPx: number;
  cropRightPx: number;
  cropBottomPx: number;
  cropLeftPx: number;
  wrapMode: 'block' | 'center' | 'left' | 'right';
}

function normalizeOptionalPositiveNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.round(value));
}

// 图片布局只收口成一份可复用结果，避免预览、导出和分页估算各算各的。
export function resolveImageLayout(metadata: ImageBlockMetadata): ResolvedImageLayout {
  const cropTopPx = normalizeOptionalPositiveNumber(metadata.cropTopPx) ?? 0;
  const cropRightPx = normalizeOptionalPositiveNumber(metadata.cropRightPx) ?? 0;
  const cropBottomPx = normalizeOptionalPositiveNumber(metadata.cropBottomPx) ?? 0;
  const cropLeftPx = normalizeOptionalPositiveNumber(metadata.cropLeftPx) ?? 0;
  const hasCrop = cropTopPx + cropRightPx + cropBottomPx + cropLeftPx > 0;

  return {
    widthPx: normalizeOptionalPositiveNumber(metadata.widthPx),
    heightPx: normalizeOptionalPositiveNumber(metadata.heightPx),
    objectFit: hasCrop ? 'cover' : metadata.objectFit ?? 'contain',
    cropTopPx,
    cropRightPx,
    cropBottomPx,
    cropLeftPx,
    wrapMode: metadata.wrapMode ?? 'block',
  };
}

// 预览和导出都以“完整图片尺寸 + 裁剪后的可见尺寸”两层口径渲染，避免再把图片表现成带边框的外框卡片。
export function resolveImageRenderMetrics(
  layout: ResolvedImageLayout,
  measuredVisibleSize?: ImageMeasuredVisibleSize | null,
): ResolvedImageRenderMetrics {
  const measuredVisibleWidthPx = normalizeOptionalPositiveNumber(measuredVisibleSize?.widthPx);
  const measuredVisibleHeightPx = normalizeOptionalPositiveNumber(measuredVisibleSize?.heightPx);
  const fullWidthPx =
    layout.widthPx ?? (measuredVisibleWidthPx !== null ? measuredVisibleWidthPx + layout.cropLeftPx + layout.cropRightPx : null);
  const fullHeightPx =
    layout.heightPx ?? (measuredVisibleHeightPx !== null ? measuredVisibleHeightPx + layout.cropTopPx + layout.cropBottomPx : null);

  return {
    fullWidthPx,
    fullHeightPx,
    visibleWidthPx:
      fullWidthPx !== null
        ? Math.max(1, fullWidthPx - layout.cropLeftPx - layout.cropRightPx)
        : measuredVisibleWidthPx,
    visibleHeightPx:
      fullHeightPx !== null
        ? Math.max(1, fullHeightPx - layout.cropTopPx - layout.cropBottomPx)
        : measuredVisibleHeightPx,
    cropTopPx: layout.cropTopPx,
    cropRightPx: layout.cropRightPx,
    cropBottomPx: layout.cropBottomPx,
    cropLeftPx: layout.cropLeftPx,
    wrapMode: layout.wrapMode,
  };
}

export function estimateImageVisibleHeightPx(metadata: ImageBlockMetadata, fallbackHeightPx: number): number {
  const layout = resolveImageLayout(metadata);
  const fullHeightPx = layout.heightPx ?? Math.max(1, Math.round(fallbackHeightPx));
  return Math.max(1, fullHeightPx - layout.cropTopPx - layout.cropBottomPx);
}
