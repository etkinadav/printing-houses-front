/** Normalized axis-aligned print rect on the mockup image (0–1). */
export interface DynamicMockupPrintRectNorm {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Orientation of the split guide lines on the full mockup image.
 * - horizontal: lines across the image width (remove a horizontal band)
 * - vertical: lines across the image height (remove a vertical band)
 */
export type DynamicMockupAspectSplitLineOrientation = 'horizontal' | 'vertical';

/**
 * Guide lines marking the band to remove so print-area aspect matches preview.
 * Center line is at print-rect midline; near/far lines are shifted equally each way.
 */
export interface DynamicMockupAspectSplit {
  lineOrientation: DynamicMockupAspectSplitLineOrientation;
  /** Original center line (0–1 on full mockup image). */
  lineCenterNorm: number;
  /** Shifted line toward top/left (0–1). */
  bandLineNearNorm: number;
  /** Shifted line toward bottom/right (0–1). */
  bandLineFarNorm: number;
  /** Distance from center to each shifted line (display px). */
  bandHalfPx: number;
  /** Print-area size after the band is removed (display px). */
  targetPrintWidthPx: number;
  targetPrintHeightPx: number;
  mockAspect: number;
  previewAspect: number;
}

/** Axis-aligned print slot after band removal (px on mockup image). */
export interface DynamicMockupWarpedPrintSlotPx {
  left: number;
  top: number;
  width: number;
  height: number;
}

const ASPECT_EPS = 0.004;

/**
 * Rp > Rm: horizontal band — remove height, lines shift up/down from center.
 * Rp < Rm: vertical band — remove width, lines shift left/right from center.
 */
export function computeDynamicMockupAspectSplit(
  printRect: DynamicMockupPrintRectNorm,
  previewWidthCm: number,
  previewHeightCm: number,
  mockupImageWidthPx: number,
  mockupImageHeightPx: number,
): DynamicMockupAspectSplit | null {
  const { width: rw, height: rh } = printRect;
  if (
    rw <= 0 ||
    rh <= 0 ||
    previewWidthCm <= 0 ||
    previewHeightCm <= 0 ||
    mockupImageWidthPx <= 0 ||
    mockupImageHeightPx <= 0
  ) {
    return null;
  }

  const mockAspect = rw / rh;
  const previewAspect = previewWidthCm / previewHeightCm;
  if (
    !Number.isFinite(mockAspect) ||
    !Number.isFinite(previewAspect) ||
    Math.abs(mockAspect - previewAspect) / Math.max(mockAspect, previewAspect) <
      ASPECT_EPS
  ) {
    return null;
  }

  const printWidthPx = rw * mockupImageWidthPx;
  const printHeightPx = rh * mockupImageHeightPx;

  if (previewAspect > mockAspect) {
    const targetPrintHeightPx = printWidthPx / previewAspect;
    const bandHeightPx = Math.max(0, printHeightPx - targetPrintHeightPx);
    const bandHalfPx = bandHeightPx / 2;
    const bandHalfNorm = bandHalfPx / mockupImageHeightPx;
    const lineCenterNorm = printRect.y + rh / 2;
    return {
      lineOrientation: 'horizontal',
      lineCenterNorm,
      bandLineNearNorm: lineCenterNorm - bandHalfNorm,
      bandLineFarNorm: lineCenterNorm + bandHalfNorm,
      bandHalfPx,
      targetPrintWidthPx: printWidthPx,
      targetPrintHeightPx,
      mockAspect,
      previewAspect,
    };
  }

  const targetPrintWidthPx = printHeightPx * previewAspect;
  const bandWidthPx = Math.max(0, printWidthPx - targetPrintWidthPx);
  const bandHalfPx = bandWidthPx / 2;
  const bandHalfNorm = bandHalfPx / mockupImageWidthPx;
  const lineCenterNorm = printRect.x + rw / 2;
  return {
    lineOrientation: 'vertical',
    lineCenterNorm,
    bandLineNearNorm: lineCenterNorm - bandHalfNorm,
    bandLineFarNorm: lineCenterNorm + bandHalfNorm,
    bandHalfPx,
    targetPrintWidthPx,
    targetPrintHeightPx: printHeightPx,
    mockAspect,
    previewAspect,
  };
}

/** Warped print slot — bottom edge fixed (horizontal) or left edge fixed (vertical). */
export function buildDynamicMockupWarpedPrintSlotPx(
  split: DynamicMockupAspectSplit,
  printRect: DynamicMockupPrintRectNorm,
  imageWidthPx: number,
  imageHeightPx: number,
): DynamicMockupWarpedPrintSlotPx {
  const left = printRect.x * imageWidthPx;
  const top = printRect.y * imageHeightPx;
  const width = printRect.width * imageWidthPx;
  const height = printRect.height * imageHeightPx;

  if (split.lineOrientation === 'horizontal') {
    const targetHeight = split.targetPrintHeightPx;
    return {
      left,
      top: top + height - targetHeight,
      width,
      height: targetHeight,
    };
  }

  const targetWidth = split.targetPrintWidthPx;
  return {
    left,
    top,
    width: targetWidth,
    height,
  };
}
