import type { ImageBlockMetadata, ImageWrapMode, ImageWrapSide } from './types';

export type ResolvedImageWrapMode = ImageWrapMode;

export interface ResolvedImageLayout {
  widthPx: number | null;
  heightPx: number | null;
  objectFit: 'contain' | 'cover';
  cropTopPx: number;
  cropRightPx: number;
  cropBottomPx: number;
  cropLeftPx: number;
  wrapMode: ResolvedImageWrapMode;
  wrapSide: ImageWrapSide;
  legacyWrapMode: ImageBlockMetadata['wrapMode'];
  // 新增：标题显示开关
  showCaption: boolean;
  // 新增：位置偏移量
  offsetX: number;
  offsetY: number;
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
  wrapMode: ResolvedImageWrapMode;
  wrapSide: ImageWrapSide;
  legacyWrapMode: ImageBlockMetadata['wrapMode'];
  showCaption: boolean;
  offsetX: number;
  offsetY: number;
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

// 偏移量可以允许负数，只需要取整
function normalizeOffsetValue(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number.isFinite(value) ? Math.round(value) : 0;
}

export function normalizeImageWrapSide(value: ImageWrapSide | null | undefined): ImageWrapSide {
  return value === 'left' ? 'left' : 'right';
}

// 旧文档只有 block/center/left/right 四种值；这里统一映射到最终四种 Word 风格环绕。
export function normalizeImageWrapMode(value: ImageBlockMetadata['wrapMode']): ResolvedImageWrapMode {
  switch (value) {
    case 'square':
    case 'tight':
    case 'topBottom':
    case 'inline':
      return value;
    case 'center':
      return 'topBottom';
    case 'left':
    case 'right':
      return 'square';
    case 'block':
    default:
      return 'inline';
  }
}

export function resolveImageWrapSide(metadata: Pick<ImageBlockMetadata, 'wrapMode' | 'wrapSide'>): ImageWrapSide {
  if (metadata.wrapMode === 'left') {
    return 'left';
  }

  if (metadata.wrapMode === 'right') {
    return 'right';
  }

  return normalizeImageWrapSide(metadata.wrapSide);
}

export function isImageTextWrapMode(wrapMode: ResolvedImageWrapMode): boolean {
  return wrapMode === 'square' || wrapMode === 'tight';
}

export function getImageWrapClassName(layout: Pick<ResolvedImageLayout, 'wrapMode' | 'wrapSide'>): string {
  const sideClass = isImageTextWrapMode(layout.wrapMode) ? ` image-wrap-side-${layout.wrapSide}` : '';
  return `image-wrap-${layout.wrapMode}${sideClass}`;
}

// 图片布局只收口成一份可复用结果，避免预览、导出和分页估算各算各的。
export function resolveImageLayout(metadata: ImageBlockMetadata): ResolvedImageLayout {
  const cropTopPx = normalizeOptionalPositiveNumber(metadata.cropTopPx) ?? 0;
  const cropRightPx = normalizeOptionalPositiveNumber(metadata.cropRightPx) ?? 0;
  const cropBottomPx = normalizeOptionalPositiveNumber(metadata.cropBottomPx) ?? 0;
  const cropLeftPx = normalizeOptionalPositiveNumber(metadata.cropLeftPx) ?? 0;
  const hasCrop = cropTopPx + cropRightPx + cropBottomPx + cropLeftPx > 0;
  const wrapMode = normalizeImageWrapMode(metadata.wrapMode);
  const wrapSide = resolveImageWrapSide(metadata);

  return {
    widthPx: normalizeOptionalPositiveNumber(metadata.widthPx),
    heightPx: normalizeOptionalPositiveNumber(metadata.heightPx),
    objectFit: hasCrop ? 'cover' : metadata.objectFit ?? 'contain',
    cropTopPx,
    cropRightPx,
    cropBottomPx,
    cropLeftPx,
    wrapMode,
    wrapSide,
    legacyWrapMode: metadata.wrapMode,
    // 新增字段：标题显示开关默认 false，偏移量默认 0（允许负数）
    showCaption: metadata.showCaption ?? false,
    offsetX: normalizeOffsetValue(metadata.offsetX),
    offsetY: normalizeOffsetValue(metadata.offsetY),
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
    wrapSide: layout.wrapSide,
    legacyWrapMode: layout.legacyWrapMode,
    showCaption: layout.showCaption,
    offsetX: layout.offsetX,
    offsetY: layout.offsetY,
  };
}

export function estimateImageVisibleHeightPx(metadata: ImageBlockMetadata, fallbackHeightPx: number): number {
  const layout = resolveImageLayout(metadata);
  const fullHeightPx = layout.heightPx ?? Math.max(1, Math.round(fallbackHeightPx));
  return Math.max(1, fullHeightPx - layout.cropTopPx - layout.cropBottomPx);
}

// 图片标题区域预估高度，只有在 showCaption 为 true 时才计入。
const IMAGE_CAPTION_HEIGHT_PX = 20;

export function estimateImageBlockHeightPx(metadata: ImageBlockMetadata, fallbackHeightPx: number): number {
  const layout = resolveImageLayout(metadata);
  const imageHeight = layout.heightPx ?? Math.max(1, Math.round(fallbackHeightPx));
  const visibleHeight = Math.max(1, imageHeight - layout.cropTopPx - layout.cropBottomPx);
  // 只有显示标题时才计入标题高度
  return layout.showCaption ? visibleHeight + IMAGE_CAPTION_HEIGHT_PX : visibleHeight;
}
