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

export interface DynamicMockupNormPoint {
  x: number;
  y: number;
}

export interface DynamicMockupAdjustedQuadCorners {
  nw: DynamicMockupNormPoint;
  ne: DynamicMockupNormPoint;
  sw: DynamicMockupNormPoint;
  se: DynamicMockupNormPoint;
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

/** Print rect after corners shift toward the split center (symmetric band removal). */
export function buildDynamicMockupAdjustedPrintRectNorm(
  split: DynamicMockupAspectSplit,
  printRect: DynamicMockupPrintRectNorm,
): DynamicMockupPrintRectNorm {
  const bandHalfNorm = split.lineCenterNorm - split.bandLineNearNorm;
  if (split.lineOrientation === 'horizontal') {
    return {
      x: printRect.x,
      y: printRect.y + bandHalfNorm,
      width: printRect.width,
      height: printRect.height - 2 * bandHalfNorm,
    };
  }
  return {
    x: printRect.x + bandHalfNorm,
    y: printRect.y,
    width: printRect.width - 2 * bandHalfNorm,
    height: printRect.height,
  };
}

function shiftPointForDynamicAspectSplit(
  split: DynamicMockupAspectSplit,
  point: DynamicMockupNormPoint,
): DynamicMockupNormPoint {
  const bandHalfNorm = split.lineCenterNorm - split.bandLineNearNorm;
  if (split.lineOrientation === 'horizontal') {
    if (point.y < split.lineCenterNorm) {
      return { x: point.x, y: point.y + bandHalfNorm };
    }
    if (point.y > split.lineCenterNorm) {
      return { x: point.x, y: point.y - bandHalfNorm };
    }
    return point;
  }
  if (point.x < split.lineCenterNorm) {
    return { x: point.x + bandHalfNorm, y: point.y };
  }
  if (point.x > split.lineCenterNorm) {
    return { x: point.x - bandHalfNorm, y: point.y };
  }
  return point;
}

/** Quad corners after each point shifts like the split image pieces. */
export function buildDynamicMockupAdjustedQuadCorners(
  split: DynamicMockupAspectSplit,
  quad: DynamicMockupAdjustedQuadCorners,
): DynamicMockupAdjustedQuadCorners {
  return {
    nw: shiftPointForDynamicAspectSplit(split, quad.nw),
    ne: shiftPointForDynamicAspectSplit(split, quad.ne),
    sw: shiftPointForDynamicAspectSplit(split, quad.sw),
    se: shiftPointForDynamicAspectSplit(split, quad.se),
  };
}

function buildQuadClipPathFromCorners(
  corners: DynamicMockupAdjustedQuadCorners,
  box: DynamicMockupPrintRectNorm,
): string {
  const toLocal = (point: DynamicMockupNormPoint) => {
    const x = box.width > 0 ? ((point.x - box.x) / box.width) * 100 : 0;
    const y = box.height > 0 ? ((point.y - box.y) / box.height) * 100 : 0;
    return `${x}% ${y}%`;
  };
  return `polygon(${[corners.nw, corners.ne, corners.se, corners.sw]
    .map(toLocal)
    .join(', ')})`;
}

export interface DynamicMockupAdjustedQuadOverlay extends DynamicMockupAdjustedQuadCorners {
  box: DynamicMockupPrintRectNorm;
  clipPath: string;
}

/** Adjusted quad overlay with bounding box and slot-local clip path. */
export function buildDynamicMockupAdjustedQuadOverlay(
  split: DynamicMockupAspectSplit,
  quad: DynamicMockupAdjustedQuadCorners,
): DynamicMockupAdjustedQuadOverlay {
  const corners = buildDynamicMockupAdjustedQuadCorners(split, quad);
  const xs = [corners.nw.x, corners.ne.x, corners.sw.x, corners.se.x];
  const ys = [corners.nw.y, corners.ne.y, corners.sw.y, corners.se.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const box = {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
  return {
    ...corners,
    box,
    clipPath: buildQuadClipPathFromCorners(corners, box),
  };
}
