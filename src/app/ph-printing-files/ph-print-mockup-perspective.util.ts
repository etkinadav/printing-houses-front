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
  return [
    [solution[0], solution[1], solution[2]],
    [solution[3], solution[4], solution[5]],
    [solution[6], solution[7], 1],
  ];
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
      return [1, 0, 0, 0, 1, 0, 0, 0];
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
  return `matrix3d(${matrix.join(', ')})`;
}
