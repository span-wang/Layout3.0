import { resolveAssetSrc } from '@/utils/filePath';
import type { PdfWatermarkSettings } from './types';

const defaultPdfWatermarkTextColor = '#94a3b8';

export interface PdfWatermarkTile {
  id: string;
  centerXPx: number;
  centerYPx: number;
  widthPx: number;
  heightPx: number;
}

export interface PdfWatermarkRenderModel {
  kind: 'text' | 'image';
  angleDeg: number;
  opacity: number;
  textColor: string;
  textContent: string;
  textFontSizePx: number;
  imageSrc: string;
  tiles: PdfWatermarkTile[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function estimateTextVisualLength(text: string): number {
  return [...text].reduce((total, char) => {
    if (/\s/u.test(char)) {
      return total + 0.35;
    }

    return total + (/[\u0000-\u00ff]/u.test(char) ? 0.7 : 1);
  }, 0);
}

function resolveTileSize(settings: PdfWatermarkSettings, pageWidthPx: number): { widthPx: number; heightPx: number } {
  if (settings.kind === 'text') {
    const fontSizePx = settings.text.fontSizePx;
    const weightedLength = Math.max(estimateTextVisualLength(settings.text.content.trim()), 4);
    return {
      widthPx: Math.round(clamp(weightedLength * fontSizePx * 1.08, fontSizePx * 4, pageWidthPx * 0.82)),
      heightPx: Math.round(fontSizePx * 2.4),
    };
  }

  const widthPx = Math.round(clamp(pageWidthPx * (settings.image.widthPercent / 100), pageWidthPx * 0.1, pageWidthPx * 0.72));
  return {
    widthPx,
    heightPx: Math.round(widthPx * 0.72),
  };
}

export function resolvePdfWatermarkRenderModel(payload: {
  settings: PdfWatermarkSettings;
  pageWidthPx: number;
  pageHeightPx: number;
}): PdfWatermarkRenderModel | null {
  const { settings, pageWidthPx, pageHeightPx } = payload;
  if (!settings.enabled) {
    return null;
  }

  const textContent = settings.text.content.trim();
  const imageSrc = resolveAssetSrc(settings.image.imageSrc);

  if (settings.kind === 'text' && !textContent) {
    return null;
  }

  if (settings.kind === 'image' && !imageSrc) {
    return null;
  }

  const { widthPx, heightPx } = resolveTileSize(settings, pageWidthPx);
  const longSide = Math.max(pageWidthPx, pageHeightPx);
  const stepXPx = Math.max(Math.round(widthPx * 1.45), Math.round(longSide * 0.16));
  const stepYPx = Math.max(Math.round(heightPx * 1.9), Math.round(longSide * 0.14));
  const bleedPx = Math.round(Math.max(widthPx, heightPx) * 0.85);
  const tiles: PdfWatermarkTile[] = [];

  // 水印只是视觉覆盖层，这里固定用交错网格平铺，既保持可读性，也避免一步做成复杂定位系统。
  let rowIndex = 0;
  for (let centerYPx = -bleedPx; centerYPx <= pageHeightPx + bleedPx; centerYPx += stepYPx) {
    const rowOffsetPx = rowIndex % 2 === 0 ? 0 : Math.round(stepXPx / 2);
    for (let centerXPx = -bleedPx - rowOffsetPx; centerXPx <= pageWidthPx + bleedPx; centerXPx += stepXPx) {
      tiles.push({
        id: `tile-${rowIndex}-${tiles.length}`,
        centerXPx,
        centerYPx,
        widthPx,
        heightPx,
      });
    }
    rowIndex += 1;
  }

  return {
    kind: settings.kind,
    angleDeg: settings.angleDeg,
    opacity: settings.opacityPercent / 100,
    textColor: defaultPdfWatermarkTextColor,
    textContent,
    textFontSizePx: settings.text.fontSizePx,
    imageSrc,
    tiles,
  };
}
