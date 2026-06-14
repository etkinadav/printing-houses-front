import { computeRectToQuadMatrix3d } from './ph-print-mockup-perspective.util';

export interface MockupCoverCropModel {
  cropVertical: boolean;
  cropHorizontal: boolean;
  /** Extension size / visible size along the cropped axis (matches preview object-fit: cover). */
  topExtensionRatio: number;
  bottomExtensionRatio: number;
  leftExtensionRatio: number;
  rightExtensionRatio: number;
}

export interface MockupCropGuideRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MockupQuadCornersPx {
  nw: { x: number; y: number };
  ne: { x: number; y: number };
  se: { x: number; y: number };
  sw: { x: number; y: number };
}

export interface MockupCropGuideSvgModel {
  viewBox: string;
  /** Wrapper expands outside the print slot; negative = pull wrapper up/left. */
  offsetLeftPx: number;
  offsetTopPx: number;
  widthPx: number;
  heightPx: number;
  slotRect: MockupCropGuideRect;
  topRect: MockupCropGuideRect | null;
  bottomRect: MockupCropGuideRect | null;
  leftRect: MockupCropGuideRect | null;
  rightRect: MockupCropGuideRect | null;
  topPolygonPoints: string | null;
  bottomPolygonPoints: string | null;
  leftPolygonPoints: string | null;
  rightPolygonPoints: string | null;
  /** Quad slot outline in canvas coordinates (includes padding offset). */
  slotPolygonPoints: string | null;
  /** 1px outline wrapping slot + both crop extensions together. */
  outerPolygonPoints: string | null;
  outerRect: MockupCropGuideRect | null;
  /** Four corners of the full cover image for perspective warp. */
  outerWarpQuad: MockupOuterWarpQuad | null;
}

export interface MockupOuterWarpQuad {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

/** Same object-fit:cover crop as the preview sheet image layer. */
export function computeMockupCoverCrop(
  imageWidthPx: number,
  imageHeightPx: number,
  sheetWidthPx: number,
  sheetHeightPx: number,
): MockupCoverCropModel | null {
  if (
    imageWidthPx <= 0 ||
    imageHeightPx <= 0 ||
    sheetWidthPx <= 0 ||
    sheetHeightPx <= 0
  ) {
    return null;
  }

  const coverScale = Math.max(
    sheetWidthPx / imageWidthPx,
    sheetHeightPx / imageHeightPx,
  );
  const scaledWidthPx = imageWidthPx * coverScale;
  const scaledHeightPx = imageHeightPx * coverScale;

  const widthLimited =
    sheetWidthPx / imageWidthPx >= sheetHeightPx / imageHeightPx;

  const cropVertical =
    widthLimited && scaledHeightPx > sheetHeightPx + 0.5;
  const cropHorizontal =
    !widthLimited && scaledWidthPx > sheetWidthPx + 0.5;

  let topExtensionRatio = 0;
  let bottomExtensionRatio = 0;
  let leftExtensionRatio = 0;
  let rightExtensionRatio = 0;

  if (cropVertical) {
    const cropTotalPx = scaledHeightPx - sheetHeightPx;
    const sidePx = cropTotalPx / 2;
    topExtensionRatio = sidePx / sheetHeightPx;
    bottomExtensionRatio = topExtensionRatio;
  }

  if (cropHorizontal) {
    const cropTotalPx = scaledWidthPx - sheetWidthPx;
    const sidePx = cropTotalPx / 2;
    leftExtensionRatio = sidePx / sheetWidthPx;
    rightExtensionRatio = leftExtensionRatio;
  }

  return {
    cropVertical,
    cropHorizontal,
    topExtensionRatio,
    bottomExtensionRatio,
    leftExtensionRatio,
    rightExtensionRatio,
  };
}

export function mockupCoverCropHasExtensions(crop: MockupCoverCropModel): boolean {
  return (
    (crop.cropVertical &&
      (crop.topExtensionRatio > 0 || crop.bottomExtensionRatio > 0)) ||
    (crop.cropHorizontal &&
      (crop.leftExtensionRatio > 0 || crop.rightExtensionRatio > 0))
  );
}

/** CSS clip-path for the red outer frame (HTML layer). */
export function buildMockupOuterClipPathCss(
  guide: Pick<
    MockupCropGuideSvgModel,
    'outerPolygonPoints' | 'outerRect'
  >,
): string | null {
  if (guide.outerPolygonPoints) {
    const cssPoints = guide.outerPolygonPoints
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [x, y] = pair.split(',');
        return `${x}px ${y}px`;
      })
      .join(', ');
    return `polygon(${cssPoints})`;
  }

  if (guide.outerRect) {
    const r = guide.outerRect;
    const x2 = r.x + r.width;
    const y2 = r.y + r.height;
    return `polygon(${r.x}px ${r.y}px, ${x2}px ${r.y}px, ${x2}px ${y2}px, ${r.x}px ${y2}px)`;
  }

  return null;
}

interface GuideCanvasLayout {
  paddingLeftPx: number;
  paddingTopPx: number;
  paddingRightPx: number;
  paddingBottomPx: number;
  totalWidthPx: number;
  totalHeightPx: number;
}

function computeGuideCanvasLayout(
  crop: MockupCoverCropModel,
  slotWidthPx: number,
  slotHeightPx: number,
): GuideCanvasLayout {
  const paddingTopPx = crop.cropVertical
    ? crop.topExtensionRatio * slotHeightPx
    : 0;
  const paddingBottomPx = crop.cropVertical
    ? crop.bottomExtensionRatio * slotHeightPx
    : 0;
  const paddingLeftPx = crop.cropHorizontal
    ? crop.leftExtensionRatio * slotWidthPx
    : 0;
  const paddingRightPx = crop.cropHorizontal
    ? crop.rightExtensionRatio * slotWidthPx
    : 0;

  return {
    paddingLeftPx,
    paddingTopPx,
    paddingRightPx,
    paddingBottomPx,
    totalWidthPx: paddingLeftPx + slotWidthPx + paddingRightPx,
    totalHeightPx: paddingTopPx + slotHeightPx + paddingBottomPx,
  };
}

function buildGuideCanvas(
  crop: MockupCoverCropModel,
  slotWidthPx: number,
  slotHeightPx: number,
): Pick<
  MockupCropGuideSvgModel,
  'viewBox' | 'offsetLeftPx' | 'offsetTopPx' | 'widthPx' | 'heightPx'
> {
  const canvas = computeGuideCanvasLayout(crop, slotWidthPx, slotHeightPx);
  return {
    viewBox: `0 0 ${canvas.totalWidthPx} ${canvas.totalHeightPx}`,
    offsetLeftPx: -canvas.paddingLeftPx,
    offsetTopPx: -canvas.paddingTopPx,
    widthPx: canvas.totalWidthPx,
    heightPx: canvas.totalHeightPx,
  };
}

function shiftPoint(
  point: { x: number; y: number },
  dx: number,
  dy: number,
): { x: number; y: number } {
  return { x: point.x + dx, y: point.y + dy };
}

function formatPolygonPoints(points: { x: number; y: number }[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function edgeLength(
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function extendFromToward(
  point: { x: number; y: number },
  toward: { x: number; y: number },
  distance: number,
): { x: number; y: number } {
  const dx = point.x - toward.x;
  const dy = point.y - toward.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    return { ...point };
  }
  const scale = distance / length;
  return {
    x: point.x + dx * scale,
    y: point.y + dy * scale,
  };
}

/** Rect slot crop guides — coordinates live in an expanded positive canvas. */
export function buildMockupCropGuideSvgModel(
  crop: MockupCoverCropModel,
  slotWidthPx: number,
  slotHeightPx: number,
): MockupCropGuideSvgModel | null {
  if (slotWidthPx <= 0 || slotHeightPx <= 0) {
    return null;
  }

  const canvas = computeGuideCanvasLayout(crop, slotWidthPx, slotHeightPx);
  const slotX = canvas.paddingLeftPx;
  const slotY = canvas.paddingTopPx;

  const slotRect: MockupCropGuideRect = {
    x: slotX,
    y: slotY,
    width: slotWidthPx,
    height: slotHeightPx,
  };

  let topRect: MockupCropGuideRect | null = null;
  let bottomRect: MockupCropGuideRect | null = null;
  let leftRect: MockupCropGuideRect | null = null;
  let rightRect: MockupCropGuideRect | null = null;

  if (crop.cropVertical && canvas.paddingTopPx > 0) {
    topRect = {
      x: slotX,
      y: 0,
      width: slotWidthPx,
      height: canvas.paddingTopPx,
    };
  }

  if (crop.cropVertical && canvas.paddingBottomPx > 0) {
    bottomRect = {
      x: slotX,
      y: slotY + slotHeightPx,
      width: slotWidthPx,
      height: canvas.paddingBottomPx,
    };
  }

  if (crop.cropHorizontal && canvas.paddingLeftPx > 0) {
    leftRect = {
      x: 0,
      y: slotY,
      width: canvas.paddingLeftPx,
      height: slotHeightPx,
    };
  }

  if (crop.cropHorizontal && canvas.paddingRightPx > 0) {
    rightRect = {
      x: slotX + slotWidthPx,
      y: slotY,
      width: canvas.paddingRightPx,
      height: slotHeightPx,
    };
  }

  return {
    ...buildGuideCanvas(crop, slotWidthPx, slotHeightPx),
    slotRect,
    topRect,
    bottomRect,
    leftRect,
    rightRect,
    topPolygonPoints: null,
    bottomPolygonPoints: null,
    leftPolygonPoints: null,
    rightPolygonPoints: null,
    slotPolygonPoints: null,
    outerPolygonPoints: null,
    outerRect: {
      x: 0,
      y: 0,
      width: canvas.totalWidthPx,
      height: canvas.totalHeightPx,
    },
    outerWarpQuad: outerWarpQuadFromRect({
      x: 0,
      y: 0,
      width: canvas.totalWidthPx,
      height: canvas.totalHeightPx,
    }),
  };
}

function computePointsBoundingBox(points: { x: number; y: number }[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  widthPx: number;
  heightPx: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, widthPx: 0, heightPx: 0 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    widthPx: maxX - minX,
    heightPx: maxY - minY,
  };
}

function shiftPolygonPoints(
  points: { x: number; y: number }[],
  dx: number,
  dy: number,
): string {
  return formatPolygonPoints(points.map((point) => shiftPoint(point, dx, dy)));
}

interface QuadExtensionCorners {
  topLeft: { x: number; y: number } | null;
  topRight: { x: number; y: number } | null;
  bottomLeft: { x: number; y: number } | null;
  bottomRight: { x: number; y: number } | null;
  leftTop: { x: number; y: number } | null;
  leftBottom: { x: number; y: number } | null;
  rightTop: { x: number; y: number } | null;
  rightBottom: { x: number; y: number } | null;
}

function buildQuadOuterPerimeter(
  nw: { x: number; y: number },
  ne: { x: number; y: number },
  se: { x: number; y: number },
  sw: { x: number; y: number },
  crop: MockupCoverCropModel,
  ext: QuadExtensionCorners,
): { x: number; y: number }[] | null {
  if (
    crop.cropVertical &&
    crop.cropHorizontal &&
    ext.topLeft &&
    ext.topRight &&
    ext.bottomLeft &&
    ext.bottomRight &&
    ext.leftTop &&
    ext.leftBottom &&
    ext.rightTop &&
    ext.rightBottom
  ) {
    return [
      ext.topLeft,
      ext.topRight,
      ext.rightTop,
      ext.rightBottom,
      ext.bottomRight,
      ext.bottomLeft,
      ext.leftBottom,
      ext.leftTop,
    ];
  }

  if (
    crop.cropVertical &&
    ext.topLeft &&
    ext.topRight &&
    ext.bottomLeft &&
    ext.bottomRight
  ) {
    return [
      ext.topLeft,
      ext.topRight,
      ne,
      se,
      ext.bottomRight,
      ext.bottomLeft,
      sw,
      nw,
    ];
  }

  if (
    crop.cropHorizontal &&
    ext.leftTop &&
    ext.leftBottom &&
    ext.rightTop &&
    ext.rightBottom
  ) {
    return [
      ext.leftTop,
      nw,
      ne,
      ext.rightTop,
      ext.rightBottom,
      se,
      sw,
      ext.leftBottom,
    ];
  }

  return null;
}

function buildOuterWarpQuad(
  crop: MockupCoverCropModel,
  ext: QuadExtensionCorners,
  shiftX: number,
  shiftY: number,
): MockupOuterWarpQuad | null {
  const shift = (point: { x: number; y: number }): { x: number; y: number } =>
    shiftPoint(point, shiftX, shiftY);

  if (
    crop.cropVertical &&
    crop.cropHorizontal &&
    ext.topLeft &&
    ext.topRight &&
    ext.bottomLeft &&
    ext.bottomRight
  ) {
    return {
      topLeft: shift(ext.topLeft),
      topRight: shift(ext.topRight),
      bottomRight: shift(ext.bottomRight),
      bottomLeft: shift(ext.bottomLeft),
    };
  }

  if (
    crop.cropVertical &&
    ext.topLeft &&
    ext.topRight &&
    ext.bottomLeft &&
    ext.bottomRight
  ) {
    return {
      topLeft: shift(ext.topLeft),
      topRight: shift(ext.topRight),
      bottomRight: shift(ext.bottomRight),
      bottomLeft: shift(ext.bottomLeft),
    };
  }

  if (
    crop.cropHorizontal &&
    ext.leftTop &&
    ext.rightTop &&
    ext.rightBottom &&
    ext.leftBottom
  ) {
    return {
      topLeft: shift(ext.leftTop),
      topRight: shift(ext.rightTop),
      bottomRight: shift(ext.rightBottom),
      bottomLeft: shift(ext.leftBottom),
    };
  }

  return null;
}

function outerWarpQuadFromRect(rect: MockupCropGuideRect): MockupOuterWarpQuad {
  return {
    topLeft: { x: rect.x, y: rect.y },
    topRight: { x: rect.x + rect.width, y: rect.y },
    bottomRight: { x: rect.x + rect.width, y: rect.y + rect.height },
    bottomLeft: { x: rect.x, y: rect.y + rect.height },
  };
}

export function resolveMockupOuterWarpQuad(
  guide: Pick<
    MockupCropGuideSvgModel,
    'outerWarpQuad' | 'outerRect' | 'outerPolygonPoints'
  >,
): MockupOuterWarpQuad | null {
  if (guide.outerWarpQuad) {
    return guide.outerWarpQuad;
  }
  if (guide.outerRect) {
    return outerWarpQuadFromRect(guide.outerRect);
  }
  if (guide.outerPolygonPoints) {
    const points = guide.outerPolygonPoints
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      })
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length >= 3) {
      const bbox = computePointsBoundingBox(points);
      if (bbox.widthPx > 0 && bbox.heightPx > 0) {
        return outerWarpQuadFromRect({
          x: bbox.minX,
          y: bbox.minY,
          width: bbox.widthPx,
          height: bbox.heightPx,
        });
      }
    }
  }
  return null;
}

export function buildMockupQuadCropGuideSvgModel(
  corners: MockupQuadCornersPx,
  crop: MockupCoverCropModel,
  slotWidthPx: number,
  slotHeightPx: number,
): MockupCropGuideSvgModel | null {
  if (slotWidthPx <= 0 || slotHeightPx <= 0) {
    return null;
  }

  const { nw, ne, se, sw } = corners;
  const leftEdgeLen = edgeLength(nw, sw);
  const rightEdgeLen = edgeLength(ne, se);
  const topEdgeLen = edgeLength(nw, ne);
  const bottomEdgeLen = edgeLength(sw, se);

  const canvasPoints: { x: number; y: number }[] = [nw, ne, se, sw];
  let topCorners: { x: number; y: number }[] | null = null;
  let bottomCorners: { x: number; y: number }[] | null = null;
  let leftCorners: { x: number; y: number }[] | null = null;
  let rightCorners: { x: number; y: number }[] | null = null;
  const extCorners: QuadExtensionCorners = {
    topLeft: null,
    topRight: null,
    bottomLeft: null,
    bottomRight: null,
    leftTop: null,
    leftBottom: null,
    rightTop: null,
    rightBottom: null,
  };

  if (crop.cropVertical && crop.topExtensionRatio > 0) {
    const topLeftExtPx = crop.topExtensionRatio * leftEdgeLen;
    const topRightExtPx = crop.topExtensionRatio * rightEdgeLen;
    if (topLeftExtPx > 0 || topRightExtPx > 0) {
      const topLeft = extendFromToward(nw, sw, topLeftExtPx);
      const topRight = extendFromToward(ne, se, topRightExtPx);
      extCorners.topLeft = topLeft;
      extCorners.topRight = topRight;
      topCorners = [topLeft, topRight, ne, nw];
      canvasPoints.push(topLeft, topRight);
    }
  }

  if (crop.cropVertical && crop.bottomExtensionRatio > 0) {
    const bottomLeftExtPx = crop.bottomExtensionRatio * leftEdgeLen;
    const bottomRightExtPx = crop.bottomExtensionRatio * rightEdgeLen;
    if (bottomLeftExtPx > 0 || bottomRightExtPx > 0) {
      const bottomLeft = extendFromToward(sw, nw, bottomLeftExtPx);
      const bottomRight = extendFromToward(se, ne, bottomRightExtPx);
      extCorners.bottomLeft = bottomLeft;
      extCorners.bottomRight = bottomRight;
      bottomCorners = [sw, se, bottomRight, bottomLeft];
      canvasPoints.push(bottomLeft, bottomRight);
    }
  }

  if (crop.cropHorizontal && crop.leftExtensionRatio > 0) {
    const leftTopExtPx = crop.leftExtensionRatio * topEdgeLen;
    const leftBottomExtPx = crop.leftExtensionRatio * bottomEdgeLen;
    if (leftTopExtPx > 0 || leftBottomExtPx > 0) {
      const leftTop = extendFromToward(nw, ne, leftTopExtPx);
      const leftBottom = extendFromToward(sw, se, leftBottomExtPx);
      extCorners.leftTop = leftTop;
      extCorners.leftBottom = leftBottom;
      leftCorners = [leftTop, leftBottom, sw, nw];
      canvasPoints.push(leftTop, leftBottom);
    }
  }

  if (crop.cropHorizontal && crop.rightExtensionRatio > 0) {
    const rightTopExtPx = crop.rightExtensionRatio * topEdgeLen;
    const rightBottomExtPx = crop.rightExtensionRatio * bottomEdgeLen;
    if (rightTopExtPx > 0 || rightBottomExtPx > 0) {
      const rightTop = extendFromToward(ne, nw, rightTopExtPx);
      const rightBottom = extendFromToward(se, sw, rightBottomExtPx);
      extCorners.rightTop = rightTop;
      extCorners.rightBottom = rightBottom;
      rightCorners = [ne, se, rightBottom, rightTop];
      canvasPoints.push(rightTop, rightBottom);
    }
  }

  const outerPerimeter = buildQuadOuterPerimeter(nw, ne, se, sw, crop, extCorners);

  const bbox = computePointsBoundingBox(canvasPoints);
  const shiftX = -bbox.minX;
  const shiftY = -bbox.minY;
  const shiftedOuterWarpQuad = buildOuterWarpQuad(crop, extCorners, shiftX, shiftY);

  const slotRect: MockupCropGuideRect = {
    x: shiftX,
    y: shiftY,
    width: slotWidthPx,
    height: slotHeightPx,
  };

  return {
    viewBox: `0 0 ${bbox.widthPx} ${bbox.heightPx}`,
    offsetLeftPx: bbox.minX,
    offsetTopPx: bbox.minY,
    widthPx: bbox.widthPx,
    heightPx: bbox.heightPx,
    slotRect,
    topRect: null,
    bottomRect: null,
    leftRect: null,
    rightRect: null,
    topPolygonPoints: topCorners
      ? shiftPolygonPoints(topCorners, shiftX, shiftY)
      : null,
    bottomPolygonPoints: bottomCorners
      ? shiftPolygonPoints(bottomCorners, shiftX, shiftY)
      : null,
    leftPolygonPoints: leftCorners
      ? shiftPolygonPoints(leftCorners, shiftX, shiftY)
      : null,
    rightPolygonPoints: rightCorners
      ? shiftPolygonPoints(rightCorners, shiftX, shiftY)
      : null,
    slotPolygonPoints: shiftPolygonPoints([nw, ne, se, sw], shiftX, shiftY),
    outerPolygonPoints: outerPerimeter
      ? shiftPolygonPoints(outerPerimeter, shiftX, shiftY)
      : null,
    outerRect: null,
    outerWarpQuad: shiftedOuterWarpQuad,
  };
}

export interface MockupPrintImageWarpModel {
  transform: string | null;
  scaledWidthPx: number;
  scaledHeightPx: number;
  axisAlignedFill: MockupCropGuideRect | null;
}

function isAxisAlignedOuterWarpQuad(quad: MockupOuterWarpQuad): boolean {
  const tol = 0.5;
  return (
    Math.abs(quad.topLeft.y - quad.topRight.y) < tol &&
    Math.abs(quad.bottomLeft.y - quad.bottomRight.y) < tol &&
    Math.abs(quad.topLeft.x - quad.bottomLeft.x) < tol &&
    Math.abs(quad.topRight.x - quad.bottomRight.x) < tol
  );
}

/** Stretch print image to fill the red outer frame on the mockup (no crop). */
export function buildMockupPrintImageWarp(
  canvasWidthPx: number,
  canvasHeightPx: number,
  outerWarpQuad: MockupOuterWarpQuad,
): MockupPrintImageWarpModel | null {
  if (canvasWidthPx <= 0 || canvasHeightPx <= 0) {
    return null;
  }

  const fill: MockupCropGuideRect = {
    x: 0,
    y: 0,
    width: canvasWidthPx,
    height: canvasHeightPx,
  };

  if (isAxisAlignedOuterWarpQuad(outerWarpQuad)) {
    return {
      transform: null,
      scaledWidthPx: canvasWidthPx,
      scaledHeightPx: canvasHeightPx,
      axisAlignedFill: fill,
    };
  }

  const transform = computeRectToQuadMatrix3d(
    canvasWidthPx,
    canvasHeightPx,
    outerWarpQuad.topLeft,
    outerWarpQuad.topRight,
    outerWarpQuad.bottomRight,
    outerWarpQuad.bottomLeft,
  );

  return {
    transform,
    scaledWidthPx: canvasWidthPx,
    scaledHeightPx: canvasHeightPx,
    axisAlignedFill: null,
  };
}
