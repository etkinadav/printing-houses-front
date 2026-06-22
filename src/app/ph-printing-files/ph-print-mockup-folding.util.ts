import {
  createDefaultMockupFoldingPairs,
  MockupFoldingPair,
  resizeMockupFoldingPairs,
  resolveMockupFoldingFromProduct,
} from '../management/product-create/mockup-folding.util';
import { PhMockup, PhMockupPrintArea } from '../ph-products/ph-product.model';
import { computePreviewFoldPanelBoundariesPx } from './ph-print-preview-layout.util';
import { buildRectToQuadBilinearWarpSlices, RectToQuadBilinearSlice } from './ph-print-mockup-perspective.util';
import { MockupPrintOverlay, MockupPrintOverlayRect } from './ph-print-mockup.util';

export interface PhPrintMockupFoldingGuideModel {
  topPathD: string;
  bottomPathD: string;
  pairLines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  fillPathD: string;
  /** Slot-local clip path (for reference). */
  fillClipPathCss: string | null;
  /** Canvas-local clip path for the folded print layer. */
  fillClipPathCanvasCss: string | null;
}

export interface PhPrintMockupFoldingImageLayout {
  canvasWidthPx: number;
  canvasHeightPx: number;
  slotOffsetLeftPx: number;
  slotOffsetTopPx: number;
  slotWidthPx: number;
  slotHeightPx: number;
}

export interface PhPrintMockupFoldPanelView {
  index: number;
  /** Panel boundary in slot-local px (matches dashed fold guides). */
  clipPath: string;
  /** Bilinear warp slices: full canvas → this panel quad. */
  slices: RectToQuadBilinearSlice[];
}

export interface PhPrintMockupFoldingModel {
  count: number;
  pairs: MockupFoldingPair[];
  panels: PhPrintMockupFoldPanelView[];
  guide: PhPrintMockupFoldingGuideModel;
  slotWidthPx: number;
  slotHeightPx: number;
  canvasWidthPx: number;
  canvasHeightPx: number;
}

interface MockupPoint2 {
  x: number;
  y: number;
}

function getPrintAreaShape(
  printArea: PhMockupPrintArea,
): MockupPrintOverlayRect | { nw: MockupPoint2; ne: MockupPoint2; sw: MockupPoint2; se: MockupPoint2 } {
  if ((printArea as { shape?: string }).shape === 'quad') {
    const quad = printArea as {
      nw: MockupPoint2;
      ne: MockupPoint2;
      sw: MockupPoint2;
      se: MockupPoint2;
    };
    return quad;
  }
  const rect = printArea as { x: number; y: number; width: number; height: number };
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Map mockup-image coordinates to slot-local px (same basis as dashed fold guides).
 */
function mockupImagePointToSlotLocal(
  point: MockupPoint2,
  overlay: MockupPrintOverlay,
  slotWidthPx: number,
  slotHeightPx: number,
): MockupPoint2 {
  const box =
    overlay.kind === 'quad'
      ? overlay.box
      : { x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height };
  if (box.width <= 0 || box.height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: ((point.x - box.x) / box.width) * slotWidthPx,
    y: ((point.y - box.y) / box.height) * slotHeightPx,
  };
}

function sortPairsByTopX(
  pairs: MockupFoldingPair[],
  overlay: MockupPrintOverlay,
  slotWidthPx: number,
  slotHeightPx: number,
): MockupFoldingPair[] {
  return [...pairs].sort(
    (left, right) =>
      mockupImagePointToSlotLocal(left.top, overlay, slotWidthPx, slotHeightPx).x -
      mockupImagePointToSlotLocal(right.top, overlay, slotWidthPx, slotHeightPx).x,
  );
}

function buildTopEdgePoints(
  sortedPairs: MockupFoldingPair[],
  printArea: PhMockupPrintArea,
  overlay: MockupPrintOverlay,
  slotWidthPx: number,
  slotHeightPx: number,
): MockupPoint2[] {
  const shape = getPrintAreaShape(printArea);
  let topLeft: MockupPoint2;
  let topRight: MockupPoint2;
  if ('nw' in shape) {
    topLeft = mockupImagePointToSlotLocal(shape.nw, overlay, slotWidthPx, slotHeightPx);
    topRight = mockupImagePointToSlotLocal(shape.ne, overlay, slotWidthPx, slotHeightPx);
  } else {
    topLeft = mockupImagePointToSlotLocal({ x: shape.x, y: shape.y }, overlay, slotWidthPx, slotHeightPx);
    topRight = mockupImagePointToSlotLocal(
      { x: shape.x + shape.width, y: shape.y },
      overlay,
      slotWidthPx,
      slotHeightPx,
    );
  }
  const mids = sortedPairs.map((pair) =>
    mockupImagePointToSlotLocal(pair.top, overlay, slotWidthPx, slotHeightPx),
  );
  return [topLeft, ...mids, topRight];
}

function buildBottomEdgePoints(
  sortedPairs: MockupFoldingPair[],
  printArea: PhMockupPrintArea,
  overlay: MockupPrintOverlay,
  slotWidthPx: number,
  slotHeightPx: number,
): MockupPoint2[] {
  const shape = getPrintAreaShape(printArea);
  let bottomLeft: MockupPoint2;
  let bottomRight: MockupPoint2;
  if ('nw' in shape) {
    bottomLeft = mockupImagePointToSlotLocal(shape.sw, overlay, slotWidthPx, slotHeightPx);
    bottomRight = mockupImagePointToSlotLocal(shape.se, overlay, slotWidthPx, slotHeightPx);
  } else {
    bottomLeft = mockupImagePointToSlotLocal(
      { x: shape.x, y: shape.y + shape.height },
      overlay,
      slotWidthPx,
      slotHeightPx,
    );
    bottomRight = mockupImagePointToSlotLocal(
      { x: shape.x + shape.width, y: shape.y + shape.height },
      overlay,
      slotWidthPx,
      slotHeightPx,
    );
  }
  const mids = sortedPairs.map((pair) =>
    mockupImagePointToSlotLocal(pair.bottom, overlay, slotWidthPx, slotHeightPx),
  );
  return [bottomLeft, ...mids, bottomRight];
}

function polygonToClipPath(points: MockupPoint2[]): string {
  if (!points.length) {
    return 'none';
  }
  const parts = points.map((point) => `${point.x}px ${point.y}px`);
  return `polygon(${parts.join(', ')})`;
}

function pointsToPathD(points: MockupPoint2[]): string {
  if (!points.length) {
    return '';
  }
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(' ')}`;
}

function offsetPoint(point: MockupPoint2, dx: number, dy: number): MockupPoint2 {
  return { x: point.x + dx, y: point.y + dy };
}

function buildFoldingGuideModel(
  sortedPairs: MockupFoldingPair[],
  printArea: PhMockupPrintArea,
  overlay: MockupPrintOverlay,
  slotWidthPx: number,
  slotHeightPx: number,
  canvasOffsetX = 0,
  canvasOffsetY = 0,
): PhPrintMockupFoldingGuideModel {
  const topEdge = buildTopEdgePoints(sortedPairs, printArea, overlay, slotWidthPx, slotHeightPx);
  const bottomEdge = buildBottomEdgePoints(sortedPairs, printArea, overlay, slotWidthPx, slotHeightPx);
  const fillPoints = [...topEdge, ...bottomEdge.slice().reverse()];
  const fillPathD = fillPoints.length ? `${pointsToPathD(fillPoints)} Z` : '';
  const canvasFillPoints = fillPoints.map((point) => offsetPoint(point, canvasOffsetX, canvasOffsetY));

  const pairLines = sortedPairs.map((pair) => {
    const top = mockupImagePointToSlotLocal(pair.top, overlay, slotWidthPx, slotHeightPx);
    const bottom = mockupImagePointToSlotLocal(pair.bottom, overlay, slotWidthPx, slotHeightPx);
    return { x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y };
  });

  return {
    topPathD: pointsToPathD(topEdge),
    bottomPathD: pointsToPathD(bottomEdge),
    pairLines,
    fillPathD,
    fillClipPathCss: fillPoints.length ? polygonToClipPath(fillPoints) : null,
    fillClipPathCanvasCss: canvasFillPoints.length ? polygonToClipPath(canvasFillPoints) : null,
  };
}

export function buildPrintMockupFoldingModel(
  mockup: PhMockup,
  overlay: MockupPrintOverlay,
  slotWidthPx: number,
  slotHeightPx: number,
  productFoldingCount: number,
  foldingOffsetCm: number,
  baseWidthPx: number,
  baseWidthCm: number,
  imageLayout: PhPrintMockupFoldingImageLayout,
): PhPrintMockupFoldingModel | null {
  const safeProductCount = Math.floor(Number(productFoldingCount));
  if (
    safeProductCount <= 0 ||
    slotWidthPx <= 0 ||
    slotHeightPx <= 0 ||
    baseWidthPx <= 0 ||
    imageLayout.canvasWidthPx <= 0 ||
    imageLayout.canvasHeightPx <= 0
  ) {
    return null;
  }

  const ox = imageLayout.slotOffsetLeftPx;
  const oy = imageLayout.slotOffsetTopPx;

  const resolved = resolveMockupFoldingFromProduct(
    mockup.printFolding,
    mockup.printFoldingCount,
    mockup.printArea,
  );

  const sourcePairs = resolved?.pairs.length
    ? resizeMockupFoldingPairs(resolved.pairs, safeProductCount, mockup.printArea)
    : createDefaultMockupFoldingPairs(safeProductCount, mockup.printArea);

  const sortedPairs = sortPairsByTopX(sourcePairs, overlay, slotWidthPx, slotHeightPx);

  const sheetPanelBounds = computePreviewFoldPanelBoundariesPx(
    safeProductCount,
    foldingOffsetCm,
    baseWidthPx,
    baseWidthCm,
  );
  const mockupPanelCount = safeProductCount + 1;
  if (sheetPanelBounds.length !== mockupPanelCount + 1) {
    return null;
  }

  // Panel corners in canvas px — same basis as the dashed fold guides.
  const topEdgeSlot = buildTopEdgePoints(
    sortedPairs,
    mockup.printArea,
    overlay,
    slotWidthPx,
    slotHeightPx,
  );
  const bottomEdgeSlot = buildBottomEdgePoints(
    sortedPairs,
    mockup.printArea,
    overlay,
    slotWidthPx,
    slotHeightPx,
  );

  if (
    topEdgeSlot.length !== mockupPanelCount + 1 ||
    bottomEdgeSlot.length !== mockupPanelCount + 1
  ) {
    return null;
  }

  const panels: PhPrintMockupFoldPanelView[] = [];
  for (let index = 0; index < mockupPanelCount; index += 1) {
    const dstTL = topEdgeSlot[index];
    const dstTR = topEdgeSlot[index + 1];
    const dstBR = bottomEdgeSlot[index + 1];
    const dstBL = bottomEdgeSlot[index];

    const slices = buildRectToQuadBilinearWarpSlices(
      imageLayout.canvasWidthPx,
      imageLayout.canvasHeightPx,
      dstTL,
      dstTR,
      dstBR,
      dstBL,
    );

    panels.push({
      index,
      clipPath: polygonToClipPath([dstTL, dstTR, dstBR, dstBL]),
      slices,
    });
  }

  const canvasFillPoints = [
    ...topEdgeSlot.map((point) => offsetPoint(point, ox, oy)),
    ...bottomEdgeSlot.slice().reverse().map((point) => offsetPoint(point, ox, oy)),
  ];

  const guide = buildFoldingGuideModel(
    sortedPairs,
    mockup.printArea,
    overlay,
    slotWidthPx,
    slotHeightPx,
    ox,
    oy,
  );
  guide.fillClipPathCanvasCss = polygonToClipPath(canvasFillPoints);

  return {
    count: safeProductCount,
    pairs: sortedPairs,
    panels,
    guide,
    slotWidthPx,
    slotHeightPx,
    canvasWidthPx: imageLayout.canvasWidthPx,
    canvasHeightPx: imageLayout.canvasHeightPx,
  };
}
