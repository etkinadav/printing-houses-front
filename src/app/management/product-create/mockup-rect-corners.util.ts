import { CornerType } from '../../ph-products/ph-product.model';

export type MockupRectCornerId = 'nw' | 'ne' | 'sw' | 'se';

export type MockupRectCornerHandleId =
  | `${MockupRectCornerId}-h`
  | `${MockupRectCornerId}-v`
  | `${MockupRectCornerId}-bulge`;

export interface MockupPoint2 {
  x: number;
  y: number;
}

export interface MockupQuadPoints {
  nw: MockupPoint2;
  ne: MockupPoint2;
  se: MockupPoint2;
  sw: MockupPoint2;
}

export interface MockupRectCornerParams {
  h: number;
  v: number;
  bulgeH: number;
  bulgeV: number;
}

export type MockupRectCornersParams = Record<MockupRectCornerId, MockupRectCornerParams>;

export interface MockupRectCornerHandleView {
  id: MockupRectCornerHandleId;
  x: number;
  y: number;
  kind: 'edge' | 'bulge';
}

export const DEFAULT_MOCKUP_RECT_CORNER: MockupRectCornerParams = {
  h: 0.1,
  v: 0.1,
  bulgeH: 0.1,
  bulgeV: 0.1,
};

export function createDefaultMockupRectCorners(): MockupRectCornersParams {
  return {
    nw: { ...DEFAULT_MOCKUP_RECT_CORNER },
    ne: { ...DEFAULT_MOCKUP_RECT_CORNER },
    sw: { ...DEFAULT_MOCKUP_RECT_CORNER },
    se: { ...DEFAULT_MOCKUP_RECT_CORNER },
  };
}

export function cloneMockupRectCorners(
  corners: MockupRectCornersParams,
): MockupRectCornersParams {
  return {
    nw: { ...corners.nw },
    ne: { ...corners.ne },
    sw: { ...corners.sw },
    se: { ...corners.se },
  };
}

function lerpPoint(from: MockupPoint2, to: MockupPoint2, t: number): MockupPoint2 {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}

function pointStr(point: MockupPoint2): string {
  return `${point.x} ${point.y}`;
}

function prevCorner(corner: MockupRectCornerId): MockupRectCornerId {
  switch (corner) {
    case 'nw':
      return 'sw';
    case 'ne':
      return 'nw';
    case 'se':
      return 'ne';
    case 'sw':
      return 'se';
  }
}

function nextCorner(corner: MockupRectCornerId): MockupRectCornerId {
  switch (corner) {
    case 'nw':
      return 'ne';
    case 'ne':
      return 'se';
    case 'se':
      return 'sw';
    case 'sw':
      return 'nw';
  }
}

function cornerPoint(quad: MockupQuadPoints, corner: MockupRectCornerId): MockupPoint2 {
  return quad[corner];
}

function quadCentroid(quad: MockupQuadPoints): MockupPoint2 {
  return {
    x: (quad.nw.x + quad.ne.x + quad.se.x + quad.sw.x) / 4,
    y: (quad.nw.y + quad.ne.y + quad.se.y + quad.sw.y) / 4,
  };
}

function bulgeControlPoint(
  _quad: MockupQuadPoints,
  _corner: MockupRectCornerId,
  params: MockupRectCornerParams,
): MockupPoint2 {
  return { x: params.bulgeH, y: params.bulgeV };
}

/** Quad bulge handles use absolute image-normalized coordinates. */
export function syncQuadBulgeControlPoints(
  quad: MockupQuadPoints,
  corners: MockupRectCornersParams,
): void {
  for (const corner of ['nw', 'ne', 'sw', 'se'] as MockupRectCornerId[]) {
    const params = corners[corner];
    const current = cornerPoint(quad, corner);
    const prev = cornerPoint(quad, prevCorner(corner));
    const next = cornerPoint(quad, nextCorner(corner));
    const cutStart = lerpPoint(prev, current, 1 - params.v);
    const cutEnd = lerpPoint(current, next, params.h);
    const mid = lerpPoint(cutStart, cutEnd, 0.5);
    const centroid = quadCentroid(quad);
    const bulge =
      (DEFAULT_MOCKUP_RECT_CORNER.bulgeH + DEFAULT_MOCKUP_RECT_CORNER.bulgeV) / 2;
    const control = lerpPoint(mid, centroid, bulge * 1.6);
    params.bulgeH = control.x;
    params.bulgeV = control.y;
  }
}

function appendQuadCornerSegment(
  parts: string[],
  quad: MockupQuadPoints,
  cornerType: CornerType,
  params: MockupRectCornerParams,
  corner: MockupRectCornerId,
): void {
  const current = cornerPoint(quad, corner);
  const next = cornerPoint(quad, nextCorner(corner));
  const end = lerpPoint(current, next, params.h);

  if (cornerType === 'chamfer') {
    parts.push(`L ${pointStr(end)}`);
    return;
  }

  const control = bulgeControlPoint(quad, corner, params);
  parts.push(`Q ${pointStr(control)} ${pointStr(end)}`);
}

/** SVG path in image-normalized coordinates (0–1). */
export function buildMockupQuadCornerOutlinePathD(
  quad: MockupQuadPoints,
  corners: MockupRectCornersParams,
  cornerType: CornerType,
): string {
  const { nw, ne, se, sw } = corners;
  const parts: string[] = [
    `M ${pointStr(lerpPoint(quad.nw, quad.ne, nw.h))}`,
    `L ${pointStr(lerpPoint(quad.nw, quad.ne, 1 - ne.v))}`,
  ];

  appendQuadCornerSegment(parts, quad, cornerType, ne, 'ne');
  parts.push(`L ${pointStr(lerpPoint(quad.ne, quad.se, 1 - se.v))}`);
  appendQuadCornerSegment(parts, quad, cornerType, se, 'se');
  parts.push(`L ${pointStr(lerpPoint(quad.sw, quad.se, sw.h))}`);
  appendQuadCornerSegment(parts, quad, cornerType, sw, 'sw');
  parts.push(`L ${pointStr(lerpPoint(quad.sw, quad.nw, 1 - nw.v))}`);
  appendQuadCornerSegment(parts, quad, cornerType, nw, 'nw');
  parts.push('Z');

  return parts.join(' ');
}

/** SVG path in rect-local coordinates (0–1). */
export function buildMockupRectCornerOutlinePathD(
  corners: MockupRectCornersParams,
  cornerType: CornerType,
): string {
  const { nw, ne, se, sw } = corners;
  const parts: string[] = [`M ${nw.h} 0`, `L ${1 - ne.v} 0`];

  appendRectCornerSegment(parts, cornerType, ne, 'ne');
  parts.push(`L 1 ${1 - se.v}`);
  appendRectCornerSegment(parts, cornerType, se, 'se');
  parts.push(`L ${sw.h} 1`);
  appendRectCornerSegment(parts, cornerType, sw, 'sw');
  parts.push(`L 0 ${1 - nw.v}`);
  appendRectCornerSegment(parts, cornerType, nw, 'nw');
  parts.push('Z');

  return parts.join(' ');
}

function appendRectCornerSegment(
  parts: string[],
  cornerType: CornerType,
  params: MockupRectCornerParams,
  corner: MockupRectCornerId,
): void {
  const { h, v, bulgeH, bulgeV } = params;
  if (cornerType === 'chamfer') {
    switch (corner) {
      case 'ne':
        parts.push(`L 1 ${h}`);
        break;
      case 'se':
        parts.push(`L ${1 - h} 1`);
        break;
      case 'sw':
        parts.push(`L 0 ${1 - h}`);
        break;
      case 'nw':
        parts.push(`L ${h} 0`);
        break;
    }
    return;
  }

  switch (corner) {
    case 'ne':
      parts.push(`Q ${1 - bulgeH} ${bulgeV} 1 ${h}`);
      break;
    case 'se':
      parts.push(`Q ${1 - bulgeH} ${1 - bulgeV} ${1 - h} 1`);
      break;
    case 'sw':
      parts.push(`Q ${bulgeH} ${1 - bulgeV} 0 ${1 - h}`);
      break;
    case 'nw':
      parts.push(`Q ${bulgeH} ${bulgeV} ${h} 0`);
      break;
  }
}

export function getMockupQuadCornerHandleViews(
  quad: MockupQuadPoints,
  corners: MockupRectCornersParams,
  cornerType: CornerType,
): MockupRectCornerHandleView[] {
  const { nw, ne, se, sw } = corners;
  const views: MockupRectCornerHandleView[] = [
    { id: 'nw-h', ...lerpPoint(quad.nw, quad.ne, nw.h), kind: 'edge' },
    { id: 'nw-v', ...lerpPoint(quad.nw, quad.sw, nw.v), kind: 'edge' },
    { id: 'ne-h', ...lerpPoint(quad.nw, quad.ne, 1 - ne.v), kind: 'edge' },
    { id: 'ne-v', ...lerpPoint(quad.ne, quad.se, ne.h), kind: 'edge' },
    { id: 'se-h', ...lerpPoint(quad.se, quad.sw, se.h), kind: 'edge' },
    { id: 'se-v', ...lerpPoint(quad.ne, quad.se, 1 - se.v), kind: 'edge' },
    { id: 'sw-h', ...lerpPoint(quad.sw, quad.se, sw.h), kind: 'edge' },
    { id: 'sw-v', ...lerpPoint(quad.sw, quad.nw, sw.v), kind: 'edge' },
  ];

  if (cornerType === 'rounded') {
    views.push(
      { id: 'nw-bulge', ...bulgeControlPoint(quad, 'nw', nw), kind: 'bulge' },
      { id: 'ne-bulge', ...bulgeControlPoint(quad, 'ne', ne), kind: 'bulge' },
      { id: 'se-bulge', ...bulgeControlPoint(quad, 'se', se), kind: 'bulge' },
      { id: 'sw-bulge', ...bulgeControlPoint(quad, 'sw', sw), kind: 'bulge' },
    );
  }

  return views;
}

export function getMockupRectCornerHandleViews(
  corners: MockupRectCornersParams,
  cornerType: CornerType,
): MockupRectCornerHandleView[] {
  const { nw, ne, se, sw } = corners;
  const views: MockupRectCornerHandleView[] = [
    { id: 'nw-h', x: nw.h, y: 0, kind: 'edge' },
    { id: 'nw-v', x: 0, y: nw.v, kind: 'edge' },
    { id: 'ne-h', x: 1 - ne.v, y: 0, kind: 'edge' },
    { id: 'ne-v', x: 1, y: ne.h, kind: 'edge' },
    { id: 'se-h', x: 1 - se.h, y: 1, kind: 'edge' },
    { id: 'se-v', x: 1, y: 1 - se.v, kind: 'edge' },
    { id: 'sw-h', x: sw.h, y: 1, kind: 'edge' },
    { id: 'sw-v', x: 0, y: 1 - sw.v, kind: 'edge' },
  ];

  if (cornerType === 'rounded') {
    views.push(
      { id: 'nw-bulge', x: nw.bulgeH, y: nw.bulgeV, kind: 'bulge' },
      { id: 'ne-bulge', x: 1 - ne.bulgeH, y: ne.bulgeV, kind: 'bulge' },
      { id: 'se-bulge', x: 1 - se.bulgeH, y: 1 - se.bulgeV, kind: 'bulge' },
      { id: 'sw-bulge', x: sw.bulgeH, y: 1 - sw.bulgeV, kind: 'bulge' },
    );
  }

  return views;
}

function clampEdge(value: number): number {
  return Math.min(0.48, Math.max(0.02, value));
}

function clampBulge(value: number): number {
  return Math.min(0.49, Math.max(0.01, value));
}

function projectPointOnSegment(
  point: MockupPoint2,
  from: MockupPoint2,
  to: MockupPoint2,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    return 0;
  }
  return Math.min(1, Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lenSq));
}

function clampCoord(value: number): number {
  return Math.min(0.99, Math.max(0.01, value));
}

function applyBulgeHandleDrag(
  imagePoint: MockupPoint2,
  corners: MockupRectCornersParams,
  corner: MockupRectCornerId,
): void {
  const params = corners[corner];
  params.bulgeH = clampCoord(imagePoint.x);
  params.bulgeV = clampCoord(imagePoint.y);
}

function setEdgeHandleFromSegment(
  corners: MockupRectCornersParams,
  corner: MockupRectCornerId,
  axis: 'h' | 'v',
  t: number,
): void {
  corners[corner][axis] = clampEdge(t);
}

export function applyMockupQuadCornerHandleDrag(
  handleId: MockupRectCornerHandleId,
  imagePoint: MockupPoint2,
  quad: MockupQuadPoints,
  corners: MockupRectCornersParams,
): void {
  switch (handleId) {
    case 'nw-h':
      setEdgeHandleFromSegment(
        corners,
        'nw',
        'h',
        projectPointOnSegment(imagePoint, quad.nw, quad.ne),
      );
      break;
    case 'nw-v':
      setEdgeHandleFromSegment(
        corners,
        'nw',
        'v',
        projectPointOnSegment(imagePoint, quad.nw, quad.sw),
      );
      break;
    case 'nw-bulge':
      applyBulgeHandleDrag(imagePoint, corners, 'nw');
      break;
    case 'ne-h':
      setEdgeHandleFromSegment(
        corners,
        'ne',
        'v',
        1 - projectPointOnSegment(imagePoint, quad.nw, quad.ne),
      );
      break;
    case 'ne-v':
      setEdgeHandleFromSegment(
        corners,
        'ne',
        'h',
        projectPointOnSegment(imagePoint, quad.ne, quad.se),
      );
      break;
    case 'ne-bulge':
      applyBulgeHandleDrag(imagePoint, corners, 'ne');
      break;
    case 'se-h':
      setEdgeHandleFromSegment(
        corners,
        'se',
        'h',
        projectPointOnSegment(imagePoint, quad.se, quad.sw),
      );
      break;
    case 'se-v':
      setEdgeHandleFromSegment(
        corners,
        'se',
        'v',
        1 - projectPointOnSegment(imagePoint, quad.ne, quad.se),
      );
      break;
    case 'se-bulge':
      applyBulgeHandleDrag(imagePoint, corners, 'se');
      break;
    case 'sw-h':
      setEdgeHandleFromSegment(
        corners,
        'sw',
        'h',
        projectPointOnSegment(imagePoint, quad.sw, quad.se),
      );
      break;
    case 'sw-v':
      setEdgeHandleFromSegment(
        corners,
        'sw',
        'v',
        projectPointOnSegment(imagePoint, quad.sw, quad.nw),
      );
      break;
    case 'sw-bulge':
      applyBulgeHandleDrag(imagePoint, corners, 'sw');
      break;
  }
}

export function applyMockupRectCornerHandleDrag(
  handleId: MockupRectCornerHandleId,
  localX: number,
  localY: number,
  corners: MockupRectCornersParams,
): void {
  switch (handleId) {
    case 'nw-h':
      corners.nw.h = clampEdge(localX);
      break;
    case 'nw-v':
      corners.nw.v = clampEdge(localY);
      break;
    case 'nw-bulge':
      corners.nw.bulgeH = clampCoord(localX);
      corners.nw.bulgeV = clampCoord(localY);
      break;
    case 'ne-h':
      corners.ne.v = clampEdge(1 - localX);
      break;
    case 'ne-v':
      corners.ne.h = clampEdge(localY);
      break;
    case 'ne-bulge':
      corners.ne.bulgeH = clampCoord(1 - localX);
      corners.ne.bulgeV = clampCoord(localY);
      break;
    case 'se-h':
      corners.se.v = clampEdge(1 - localX);
      break;
    case 'se-v':
      corners.se.h = clampEdge(1 - localY);
      break;
    case 'se-bulge':
      corners.se.bulgeH = clampCoord(1 - localX);
      corners.se.bulgeV = clampCoord(1 - localY);
      break;
    case 'sw-h':
      corners.sw.h = clampEdge(localX);
      break;
    case 'sw-v':
      corners.sw.v = clampEdge(1 - localY);
      break;
    case 'sw-bulge':
      corners.sw.bulgeH = clampCoord(localX);
      corners.sw.bulgeV = clampCoord(1 - localY);
      break;
  }
}
