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
  };
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

  const canvas = computeGuideCanvasLayout(crop, slotWidthPx, slotHeightPx);
  const shiftX = canvas.paddingLeftPx;
  const shiftY = canvas.paddingTopPx;

  const nw = shiftPoint(corners.nw, shiftX, shiftY);
  const ne = shiftPoint(corners.ne, shiftX, shiftY);
  const se = shiftPoint(corners.se, shiftX, shiftY);
  const sw = shiftPoint(corners.sw, shiftX, shiftY);

  const slotRect: MockupCropGuideRect = {
    x: shiftX,
    y: shiftY,
    width: slotWidthPx,
    height: slotHeightPx,
  };

  let topPolygonPoints: string | null = null;
  let bottomPolygonPoints: string | null = null;
  let leftPolygonPoints: string | null = null;
  let rightPolygonPoints: string | null = null;

  if (crop.cropVertical) {
    const visibleHeightPx = (edgeLength(nw, sw) + edgeLength(ne, se)) / 2;
    const topExtensionPx = crop.topExtensionRatio * visibleHeightPx;
    const bottomExtensionPx = crop.bottomExtensionRatio * visibleHeightPx;

    if (topExtensionPx > 0) {
      const topLeft = extendFromToward(nw, sw, topExtensionPx);
      const topRight = extendFromToward(ne, se, topExtensionPx);
      topPolygonPoints = formatPolygonPoints([topLeft, topRight, ne, nw]);
    }

    if (bottomExtensionPx > 0) {
      const bottomLeft = extendFromToward(sw, nw, bottomExtensionPx);
      const bottomRight = extendFromToward(se, ne, bottomExtensionPx);
      bottomPolygonPoints = formatPolygonPoints([sw, se, bottomRight, bottomLeft]);
    }
  }

  if (crop.cropHorizontal) {
    const visibleWidthPx = (edgeLength(nw, ne) + edgeLength(sw, se)) / 2;
    const leftExtensionPx = crop.leftExtensionRatio * visibleWidthPx;
    const rightExtensionPx = crop.rightExtensionRatio * visibleWidthPx;

    if (leftExtensionPx > 0) {
      const leftTop = extendFromToward(nw, ne, leftExtensionPx);
      const leftBottom = extendFromToward(sw, se, leftExtensionPx);
      leftPolygonPoints = formatPolygonPoints([leftTop, leftBottom, sw, nw]);
    }

    if (rightExtensionPx > 0) {
      const rightTop = extendFromToward(ne, nw, rightExtensionPx);
      const rightBottom = extendFromToward(se, sw, rightExtensionPx);
      rightPolygonPoints = formatPolygonPoints([ne, se, rightBottom, rightTop]);
    }
  }

  return {
    ...buildGuideCanvas(crop, slotWidthPx, slotHeightPx),
    slotRect,
    topRect: null,
    bottomRect: null,
    leftRect: null,
    rightRect: null,
    topPolygonPoints,
    bottomPolygonPoints,
    leftPolygonPoints,
    rightPolygonPoints,
    slotPolygonPoints: formatPolygonPoints([nw, ne, se, sw]),
  };
}
