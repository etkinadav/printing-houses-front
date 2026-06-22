import {
  MockupPrintOverlayQuad,
  MockupPrintOverlayRect,
} from './ph-print-mockup.util';

export interface PhMockupPoint {
  x: number;
  y: number;
}

/** Map rectangle [0,w]×[0,h] to a quad (TL, TR, BR, BL) — CSS matrix3d column-major. */
export function computeRectToQuadMatrix3d(
  width: number,
  height: number,
  topLeft: PhMockupPoint,
  topRight: PhMockupPoint,
  bottomRight: PhMockupPoint,
  bottomLeft: PhMockupPoint,
): string {
  const matrix = solveRectToQuadMatrix3d(
    width,
    height,
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
  );
  return `matrix3d(${matrix.join(', ')})`;
}

export function quadCornersInSlotPx(
  quad: MockupPrintOverlayQuad,
  box: MockupPrintOverlayRect,
  slotWidthPx: number,
  slotHeightPx: number,
): {
  nw: PhMockupPoint;
  ne: PhMockupPoint;
  se: PhMockupPoint;
  sw: PhMockupPoint;
} {
  const map = (point: PhMockupPoint): PhMockupPoint => ({
    x: box.width > 0 ? ((point.x - box.x) / box.width) * slotWidthPx : 0,
    y: box.height > 0 ? ((point.y - box.y) / box.height) * slotHeightPx : 0,
  });

  return {
    nw: map(quad.nw),
    ne: map(quad.ne),
    se: map(quad.se),
    sw: map(quad.sw),
  };
}

export function buildMockupQuadSheetTransform(
  sheetWidthPx: number,
  sheetHeightPx: number,
  slotWidthPx: number,
  slotHeightPx: number,
  quad: MockupPrintOverlayQuad,
  box: MockupPrintOverlayRect,
): {
  transform: string;
  warpTransform: string;
  sheetWidthPx: number;
  sheetHeightPx: number;
  scaledWidthPx: number;
  scaledHeightPx: number;
  coverScale: number;
  offsetLeftPx: number;
  offsetTopPx: number;
} | null {
  if (
    sheetWidthPx <= 0 ||
    sheetHeightPx <= 0 ||
    slotWidthPx <= 0 ||
    slotHeightPx <= 0
  ) {
    return null;
  }
  const coverScale =
    sheetWidthPx > 0 && sheetHeightPx > 0
      ? Math.max(slotWidthPx / sheetWidthPx, slotHeightPx / sheetHeightPx)
      : 1;

  const scaledWidthPx = sheetWidthPx * coverScale;
  const scaledHeightPx = sheetHeightPx * coverScale;
  const offsetLeftPx = (slotWidthPx - scaledWidthPx) / 2;
  const offsetTopPx = (slotHeightPx - scaledHeightPx) / 2;

  const corners = quadCornersInSlotPx(quad, box, slotWidthPx, slotHeightPx);
  const rel = (point: PhMockupPoint): PhMockupPoint => ({
    x: point.x - offsetLeftPx,
    y: point.y - offsetTopPx,
  });

  const matrix = solveRectToQuadMatrix3d(
    scaledWidthPx,
    scaledHeightPx,
    rel(corners.nw),
    rel(corners.ne),
    rel(corners.se),
    rel(corners.sw),
  );

  if (
    !isUsableWarpMatrix(
      matrix,
      scaledWidthPx,
      scaledHeightPx,
      slotWidthPx,
      slotHeightPx,
      offsetLeftPx,
      offsetTopPx,
    )
  ) {
    return null;
  }

  const warp = `matrix3d(${matrix.join(', ')})`;

  return {
    warpTransform: warp,
    transform: warp,
    sheetWidthPx,
    sheetHeightPx,
    scaledWidthPx,
    scaledHeightPx,
    coverScale,
    offsetLeftPx,
    offsetTopPx,
  };
}

function solveRectToQuadMatrix3d(
  width: number,
  height: number,
  topLeft: PhMockupPoint,
  topRight: PhMockupPoint,
  bottomRight: PhMockupPoint,
  bottomLeft: PhMockupPoint,
): number[] {
  const w = width;
  const h = height;

  const src = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const dst = [topLeft, topRight, bottomRight, bottomLeft];

  const hMatrix = solveHomography3x3(src, dst);
  if (!hMatrix.length) {
    return new Array<number>(16).fill(Number.NaN);
  }
  return homography3x3ToMatrix3d(hMatrix);
}

/** Direct linear transform — 8 unknowns, h33 = 1. */
function solveHomography3x3(
  src: PhMockupPoint[],
  dst: PhMockupPoint[],
): number[][] {
  const rows: number[][] = [];

  for (let index = 0; index < 4; index += 1) {
    const { x, y } = src[index];
    const { x: u, y: v } = dst[index];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  const solution = solveLinearSystem8x9(rows);
  if (solution.length !== 8) {
    return [];
  }
  return [
    [solution[0], solution[1], solution[2]],
    [solution[3], solution[4], solution[5]],
    [solution[6], solution[7], 1],
  ];
}

function formatMatrix3dCss(matrix: number[]): string {
  return `matrix3d(${matrix.map((value) => Number(value.toFixed(6))).join(', ')})`;
}

function solveLinearSystem8x9(rows: number[][]): number[] {
  const matrix = rows.map((row) => row.slice());

  const size = 8;
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivotRow][column])) {
        pivotRow = row;
      }
    }

    if (Math.abs(matrix[pivotRow][column]) < 1e-12) {
      return [];
    }

    if (pivotRow !== column) {
      [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];
    }

    const pivot = matrix[column][column];
    for (let col = column; col < 9; col += 1) {
      matrix[column][col] /= pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }
      const factor = matrix[row][column];
      for (let col = column; col < 9; col += 1) {
        matrix[row][col] -= factor * matrix[column][col];
      }
    }
  }

  return matrix.map((row) => row[8]);
}

function homography3x3ToMatrix3d(h: number[][]): number[] {
  return [
    h[0][0],
    h[1][0],
    0,
    h[2][0],
    h[0][1],
    h[1][1],
    0,
    h[2][1],
    0,
    0,
    1,
    0,
    h[0][2],
    h[1][2],
    0,
    h[2][2],
  ];
}

function transformPoint(x: number, y: number, matrix: number[]): PhMockupPoint {
  const xn =
    matrix[0] * x + matrix[4] * y + matrix[12];
  const yn =
    matrix[1] * x + matrix[5] * y + matrix[13];
  const wn =
    matrix[3] * x + matrix[7] * y + matrix[15];
  if (Math.abs(wn) < 1e-8) {
    return { x: 0, y: 0 };
  }
  return { x: xn / wn, y: yn / wn };
}

/** Reject warps that collapse or fling content outside the print slot. */
function isUsableWarpMatrix(
  matrix: number[],
  width: number,
  height: number,
  slotWidthPx: number,
  slotHeightPx: number,
  offsetLeftPx: number,
  offsetTopPx: number,
): boolean {
  if (matrix.length !== 16 || !matrix.every((value) => Number.isFinite(value))) {
    return false;
  }

  const src: PhMockupPoint[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const marginX = slotWidthPx;
  const marginY = slotHeightPx;

  for (const point of src) {
    const mapped = transformPoint(point.x, point.y, matrix);
    const parentX = mapped.x + offsetLeftPx;
    const parentY = mapped.y + offsetTopPx;
    if (
      parentX < -marginX ||
      parentX > slotWidthPx + marginX ||
      parentY < -marginY ||
      parentY > slotHeightPx + marginY
    ) {
      return false;
    }
  }

  return true;
}

function lerpPoint(a: PhMockupPoint, b: PhMockupPoint, t: number): PhMockupPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export interface RectToQuadBilinearSlice {
  srcTopPx: number;
  srcHeightPx: number;
  transform: string;
  zIndex: number;
}

/** ~2px per slice, capped for performance. */
export function resolveBilinearWarpSliceCount(heightPx: number): number {
  if (heightPx <= 0) {
    return 64;
  }
  return Math.min(128, Math.max(64, Math.ceil(heightPx / 2)));
}

/**
 * Bilinear rect→quad via horizontal slices: fraction v on the source height
 * lands at fraction v along the left and right destination edges.
 * Adjacent slices overlap by 1px in source space to hide seam lines.
 */
export function buildRectToQuadBilinearWarpSlices(
  width: number,
  height: number,
  topLeft: PhMockupPoint,
  topRight: PhMockupPoint,
  bottomRight: PhMockupPoint,
  bottomLeft: PhMockupPoint,
  sliceCount = resolveBilinearWarpSliceCount(height),
): RectToQuadBilinearSlice[] {
  if (width <= 0 || height <= 0 || sliceCount < 1) {
    return [];
  }

  const overlapPx = Math.min(4, Math.max(2, Math.round(height / 64)));
  const overlapNorm = height > 0 ? overlapPx / height : 0;
  const slices: RectToQuadBilinearSlice[] = [];
  for (let index = 0; index < sliceCount; index += 1) {
    const v0Base = index / sliceCount;
    const v1Base = (index + 1) / sliceCount;
    const v0 = index > 0 ? Math.max(0, v0Base - overlapNorm) : v0Base;
    const v1 =
      index < sliceCount - 1 ? Math.min(1, v1Base + overlapNorm) : v1Base;
    const srcTopPx = v0 * height;
    const srcHeightPx = (v1 - v0) * height;
    const dstTL = lerpPoint(topLeft, bottomLeft, v0);
    const dstTR = lerpPoint(topRight, bottomRight, v0);
    const dstBR = lerpPoint(topRight, bottomRight, v1);
    const dstBL = lerpPoint(topLeft, bottomLeft, v1);
    const relY = (point: PhMockupPoint): PhMockupPoint => ({
      x: point.x,
      y: point.y - srcTopPx,
    });
    const transform = buildRectToQuadWarpTransformLenient(
      width,
      srcHeightPx,
      relY(dstTL),
      relY(dstTR),
      relY(dstBR),
      relY(dstBL),
    );
    slices.push({ srcTopPx, srcHeightPx, transform, zIndex: index + 1 });
  }
  return slices;
}

/** Map axis-aligned rect to a quad; always returns matrix when inputs are finite. */
export function buildRectToQuadWarpTransformLenient(
  width: number,
  height: number,
  topLeft: PhMockupPoint,
  topRight: PhMockupPoint,
  bottomRight: PhMockupPoint,
  bottomLeft: PhMockupPoint,
): string {
  const matrix = solveRectToQuadMatrix3d(
    width,
    height,
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
  );
  if (!matrix.every((value) => Number.isFinite(value))) {
    return 'none';
  }
  return formatMatrix3dCss(matrix);
}

/** Map axis-aligned rect to a quad; null when the warp would be unusable. */
export function buildRectToQuadWarpTransform(
  width: number,
  height: number,
  topLeft: PhMockupPoint,
  topRight: PhMockupPoint,
  bottomRight: PhMockupPoint,
  bottomLeft: PhMockupPoint,
  boundsWidthPx: number,
  boundsHeightPx: number,
): string | null {
  const matrix = solveRectToQuadMatrix3d(
    width,
    height,
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
  );
  if (
    !isUsableWarpMatrix(
      matrix,
      width,
      height,
      boundsWidthPx,
      boundsHeightPx,
      0,
      0,
    )
  ) {
    return null;
  }
  return formatMatrix3dCss(matrix);
}

function det3x3(
  a: number, b: number, c: number,
  d: number, e: number, f: number,
  g: number, h: number, i: number,
): number {
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/**
 * Build a 2-D affine transform (CSS `matrix()`) mapping a source triangle to a
 * destination triangle. Affine maps are linear along every edge, so two
 * triangles that share an edge (with matching endpoints) stay perfectly
 * continuous across it — giving seam-free, proportional warping. Returns
 * `'none'` when the source triangle is degenerate.
 */
export function buildAffineTriangleTransform(
  src: [PhMockupPoint, PhMockupPoint, PhMockupPoint],
  dst: [PhMockupPoint, PhMockupPoint, PhMockupPoint],
): string {
  const [p0, p1, p2] = src;
  const denom = det3x3(
    p0.x, p0.y, 1,
    p1.x, p1.y, 1,
    p2.x, p2.y, 1,
  );
  if (Math.abs(denom) < 1e-9) {
    return 'none';
  }
  const [x0, x1, x2] = [dst[0].x, dst[1].x, dst[2].x];
  const [y0, y1, y2] = [dst[0].y, dst[1].y, dst[2].y];

  const a = det3x3(x0, p0.y, 1, x1, p1.y, 1, x2, p2.y, 1) / denom;
  const c = det3x3(p0.x, x0, 1, p1.x, x1, 1, p2.x, x2, 1) / denom;
  const e = det3x3(p0.x, p0.y, x0, p1.x, p1.y, x1, p2.x, p2.y, x2) / denom;
  const b = det3x3(y0, p0.y, 1, y1, p1.y, 1, y2, p2.y, 1) / denom;
  const d = det3x3(p0.x, y0, 1, p1.x, y1, 1, p2.x, y2, 1) / denom;
  const f = det3x3(p0.x, p0.y, y0, p1.x, p1.y, y1, p2.x, p2.y, y2) / denom;

  const values = [a, b, c, d, e, f].map((value) => Number(value.toFixed(6)));
  if (!values.every((value) => Number.isFinite(value))) {
    return 'none';
  }
  return `matrix(${values.join(', ')})`;
}

/**
 * Build a perspective projector that maps points from a source quad's coordinate
 * space to a destination quad's coordinate space using a full homography.
 * Returns null when the source quad is degenerate.
 */
export function createPerspectiveProjector(
  src: [PhMockupPoint, PhMockupPoint, PhMockupPoint, PhMockupPoint],
  dst: [PhMockupPoint, PhMockupPoint, PhMockupPoint, PhMockupPoint],
): ((point: PhMockupPoint) => PhMockupPoint) | null {
  const h = solveHomography3x3(src, dst);
  if (!h.length) {
    return null;
  }
  return (point: PhMockupPoint): PhMockupPoint => {
    const denom = h[2][0] * point.x + h[2][1] * point.y + h[2][2];
    if (Math.abs(denom) < 1e-9) {
      return { x: 0, y: 0 };
    }
    const x = (h[0][0] * point.x + h[0][1] * point.y + h[0][2]) / denom;
    const y = (h[1][0] * point.x + h[1][1] * point.y + h[1][2]) / denom;
    return { x, y };
  };
}

export function buildQuadToQuadWarpTransformLenient(
  srcTopLeft: PhMockupPoint,
  srcTopRight: PhMockupPoint,
  srcBottomRight: PhMockupPoint,
  srcBottomLeft: PhMockupPoint,
  dstTopLeft: PhMockupPoint,
  dstTopRight: PhMockupPoint,
  dstBottomRight: PhMockupPoint,
  dstBottomLeft: PhMockupPoint,
): string {
  const src = [srcTopLeft, srcTopRight, srcBottomRight, srcBottomLeft];
  const dst = [dstTopLeft, dstTopRight, dstBottomRight, dstBottomLeft];
  const hMatrix = solveHomography3x3(src, dst);
  if (!hMatrix.length) {
    return 'none';
  }
  const matrix = homography3x3ToMatrix3d(hMatrix);
  if (!matrix.every((value) => Number.isFinite(value))) {
    return 'none';
  }
  return formatMatrix3dCss(matrix);
}

/**
 * Map an arbitrary quadrilateral (src) to another arbitrary quadrilateral (dst)
 * using a full homography (8 degrees of freedom).
 *
 * The transform is intended to be applied to an element with `transform-origin: 0 0`.
 * Source and destination points are in the element's own coordinate space.
 * Returns null when the resulting matrix would be degenerate or unusable.
 */
export function buildQuadToQuadWarpTransform(
  srcTopLeft: PhMockupPoint,
  srcTopRight: PhMockupPoint,
  srcBottomRight: PhMockupPoint,
  srcBottomLeft: PhMockupPoint,
  dstTopLeft: PhMockupPoint,
  dstTopRight: PhMockupPoint,
  dstBottomRight: PhMockupPoint,
  dstBottomLeft: PhMockupPoint,
  boundsWidthPx: number,
  boundsHeightPx: number,
): string | null {
  const src = [srcTopLeft, srcTopRight, srcBottomRight, srcBottomLeft];
  const dst = [dstTopLeft, dstTopRight, dstBottomRight, dstBottomLeft];
  const hMatrix = solveHomography3x3(src, dst);
  const matrix = homography3x3ToMatrix3d(hMatrix);
  if (
    !isUsableQuadToQuadWarpMatrix(matrix, src, dst, boundsWidthPx, boundsHeightPx)
  ) {
    return null;
  }
  return `matrix3d(${matrix.join(', ')})`;
}

function isUsableQuadToQuadWarpMatrix(
  matrix: number[],
  srcCorners: PhMockupPoint[],
  dstCorners: PhMockupPoint[],
  boundsWidthPx: number,
  boundsHeightPx: number,
): boolean {
  if (matrix.length !== 16 || !matrix.every((value) => Number.isFinite(value))) {
    return false;
  }

  const margin = Math.max(boundsWidthPx, boundsHeightPx);
  for (let index = 0; index < 4; index += 1) {
    const mapped = transformPoint(srcCorners[index].x, srcCorners[index].y, matrix);
    const dx = Math.abs(mapped.x - dstCorners[index].x);
    const dy = Math.abs(mapped.y - dstCorners[index].y);
    if (dx > 1.5 || dy > 1.5) {
      return false;
    }
    if (
      mapped.x < -margin ||
      mapped.x > boundsWidthPx + margin ||
      mapped.y < -margin ||
      mapped.y > boundsHeightPx + margin
    ) {
      return false;
    }
  }

  return true;
}
