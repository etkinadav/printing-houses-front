import {
  PhMockupPrintArea,
  PhMockupPrintFolding,
  PhMockupPrintFoldingPair,
  PhMockupPoint,
} from '../../ph-products/ph-product.model';

export interface MockupPoint2 {
  x: number;
  y: number;
}

export interface MockupFoldingPair {
  top: MockupPoint2;
  bottom: MockupPoint2;
}

export type MockupFoldingHandleSide = 'top' | 'bottom';

export interface MockupFoldingHandleView {
  pairIndex: number;
  side: MockupFoldingHandleSide;
  x: number;
  y: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerpPoint(from: MockupPoint2, to: MockupPoint2, t: number): MockupPoint2 {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

function isQuadPrintArea(
  area: PhMockupPrintArea,
): area is { shape: 'quad'; nw: PhMockupPoint; ne: PhMockupPoint; sw: PhMockupPoint; se: PhMockupPoint } {
  return (area as { shape?: string }).shape === 'quad';
}

export function getMockupPrintAreaTopBottom(
  printArea: PhMockupPrintArea | MockupRectLike | MockupQuadLike,
): { topLeft: MockupPoint2; topRight: MockupPoint2; bottomLeft: MockupPoint2; bottomRight: MockupPoint2 } {
  if ('shape' in printArea && printArea.shape === 'quad') {
    return {
      topLeft: { ...printArea.nw },
      topRight: { ...printArea.ne },
      bottomLeft: { ...printArea.sw },
      bottomRight: { ...printArea.se },
    };
  }
  if ('nw' in printArea) {
    return {
      topLeft: { ...printArea.nw },
      topRight: { ...printArea.ne },
      bottomLeft: { ...printArea.sw },
      bottomRight: { ...printArea.se },
    };
  }
  const rect = printArea as MockupRectLike;
  return {
    topLeft: { x: rect.x, y: rect.y },
    topRight: { x: rect.x + rect.width, y: rect.y },
    bottomLeft: { x: rect.x, y: rect.y + rect.height },
    bottomRight: { x: rect.x + rect.width, y: rect.y + rect.height },
  };
}

interface MockupRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MockupQuadLike {
  nw: MockupPoint2;
  ne: MockupPoint2;
  sw: MockupPoint2;
  se: MockupPoint2;
}

export function createDefaultMockupFoldingPairs(
  count: number,
  printArea: PhMockupPrintArea | MockupRectLike | MockupQuadLike,
): MockupFoldingPair[] {
  const safeCount = Math.max(1, Math.floor(count));
  const { topLeft, topRight, bottomLeft, bottomRight } = getMockupPrintAreaTopBottom(printArea);
  const pairs: MockupFoldingPair[] = [];
  for (let index = 0; index < safeCount; index += 1) {
    const t = (index + 1) / (safeCount + 1);
    pairs.push({
      top: lerpPoint(topLeft, topRight, t),
      bottom: lerpPoint(bottomLeft, bottomRight, t),
    });
  }
  return pairs;
}

export function resizeMockupFoldingPairs(
  existing: MockupFoldingPair[] | null | undefined,
  nextCount: number,
  printArea: PhMockupPrintArea | MockupRectLike | MockupQuadLike,
): MockupFoldingPair[] {
  const safeCount = Math.max(1, Math.floor(nextCount));
  const defaults = createDefaultMockupFoldingPairs(safeCount, printArea);
  if (!existing?.length) {
    return defaults;
  }
  return defaults.map((fallback, index) => {
    const prev = existing[index];
    if (!prev) {
      return fallback;
    }
    return {
      top: { ...prev.top },
      bottom: { ...prev.bottom },
    };
  });
}

export function cloneMockupFoldingPairs(pairs: MockupFoldingPair[]): MockupFoldingPair[] {
  return pairs.map((pair) => ({
    top: { ...pair.top },
    bottom: { ...pair.bottom },
  }));
}

export function getMockupFoldingHandleViews(pairs: MockupFoldingPair[]): MockupFoldingHandleView[] {
  const views: MockupFoldingHandleView[] = [];
  pairs.forEach((pair, pairIndex) => {
    views.push(
      { pairIndex, side: 'top', x: pair.top.x, y: pair.top.y },
      { pairIndex, side: 'bottom', x: pair.bottom.x, y: pair.bottom.y },
    );
  });
  return views;
}

function sortedTopPoints(pairs: MockupFoldingPair[]): MockupPoint2[] {
  return [...pairs].map((pair) => pair.top).sort((left, right) => left.x - right.x);
}

function sortedBottomPoints(pairs: MockupFoldingPair[]): MockupPoint2[] {
  return [...pairs].map((pair) => pair.bottom).sort((left, right) => left.x - right.x);
}

function pointsToPath(points: MockupPoint2[]): string {
  if (!points.length) {
    return '';
  }
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(' ')}`;
}

export function buildMockupFoldingTopPath(
  pairs: MockupFoldingPair[],
  printArea: PhMockupPrintArea | MockupRectLike | MockupQuadLike,
): string {
  const { topLeft, topRight } = getMockupPrintAreaTopBottom(printArea);
  const mids = sortedTopPoints(pairs);
  return pointsToPath([topLeft, ...mids, topRight]);
}

export function buildMockupFoldingBottomPath(
  pairs: MockupFoldingPair[],
  printArea: PhMockupPrintArea | MockupRectLike | MockupQuadLike,
): string {
  const { bottomLeft, bottomRight } = getMockupPrintAreaTopBottom(printArea);
  const mids = sortedBottomPoints(pairs);
  return pointsToPath([bottomLeft, ...mids, bottomRight]);
}

/** Closed boundary for fill — follows zigzag top/bottom and straight side edges. */
export function buildMockupFoldingBoundaryPathD(
  pairs: MockupFoldingPair[],
  printArea: PhMockupPrintArea | MockupRectLike | MockupQuadLike,
): string {
  const { topLeft, topRight, bottomLeft, bottomRight } = getMockupPrintAreaTopBottom(printArea);
  const topMids = sortedTopPoints(pairs);
  const bottomMids = sortedBottomPoints(pairs);
  const boundary = [
    topLeft,
    ...topMids,
    topRight,
    bottomRight,
    ...bottomMids.slice().reverse(),
    bottomLeft,
  ];
  const openPath = pointsToPath(boundary);
  return openPath ? `${openPath} Z` : '';
}

export function mockupFoldingPairsToPhPrintFolding(
  count: number,
  pairs: MockupFoldingPair[],
): PhMockupPrintFolding {
  return {
    enabled: true,
    count: Math.max(1, Math.floor(count)),
    pairs: pairs.map((pair) => ({
      top: { x: clamp01(pair.top.x), y: clamp01(pair.top.y) },
      bottom: { x: clamp01(pair.bottom.x), y: clamp01(pair.bottom.y) },
    })),
  };
}

export function phPrintFoldingToMockupPairs(
  printFolding: PhMockupPrintFolding | null | undefined,
): { count: number; pairs: MockupFoldingPair[] } | null {
  if (!printFolding?.enabled) {
    return null;
  }
  const count = Math.max(1, Math.floor(Number(printFolding.count)));
  const pairs = (printFolding.pairs ?? []).slice(0, count).map((pair) => ({
    top: { x: clamp01(pair.top.x), y: clamp01(pair.top.y) },
    bottom: { x: clamp01(pair.bottom.x), y: clamp01(pair.bottom.y) },
  }));
  if (pairs.length < count) {
    return null;
  }
  return { count, pairs };
}

/** Legacy mockup field: count only → no stored positions. */
export function legacyPrintFoldingCountToState(
  count: unknown,
): number | null {
  if (count === null || count === undefined) {
    return null;
  }
  const parsed = Math.floor(Number(count));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

export function normalizeMockupFoldingPairPoint(point: MockupPoint2): MockupPoint2 {
  return { x: clamp01(point.x), y: clamp01(point.y) };
}

export function resolveMockupFoldingFromProduct(
  printFolding: PhMockupPrintFolding | null | undefined,
  legacyCount: number | null | undefined,
  printArea: PhMockupPrintArea | MockupRectLike | MockupQuadLike | null,
): { count: number; pairs: MockupFoldingPair[] } | null {
  const parsed = phPrintFoldingToMockupPairs(printFolding);
  if (parsed) {
    return parsed;
  }
  const count = legacyPrintFoldingCountToState(legacyCount);
  if (count == null || !printArea) {
    return null;
  }
  return {
    count,
    pairs: createDefaultMockupFoldingPairs(count, printArea),
  };
}

export function readPhMockupPrintFoldingForSave(
  count: number | null,
  pairs: MockupFoldingPair[] | null,
): PhMockupPrintFolding | undefined {
  if (count == null || count < 1 || !pairs?.length) {
    return undefined;
  }
  return mockupFoldingPairsToPhPrintFolding(count, pairs);
}

export function isValidPhMockupPrintArea(area: unknown): area is PhMockupPrintArea {
  if (!area || typeof area !== 'object') {
    return false;
  }
  return isQuadPrintArea(area as PhMockupPrintArea) || 'width' in (area as object);
}
