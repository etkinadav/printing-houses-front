import { FabricObject, Path, Rect } from 'fabric';

/** Align Fabric clip with the printable edge. */
export const SHEET_FRAME_INSET_PX = 0;

export type PhSheetClipRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PhSheetClipSpec =
  | { type: 'rect'; bounds?: PhSheetClipRect }
  | { type: 'rounded'; radiusPx: number; bounds?: PhSheetClipRect }
  | { type: 'polygon'; points: Array<{ x: number; y: number }> }
  | { type: 'path'; pathD: string };

/** Resolve preview image clip (CSS clip-path / border-radius) into a drawable spec. */
export function resolveSheetClipSpec(
  imageClipPath: string | null | undefined,
  imageBorderRadiusPx: number,
): PhSheetClipSpec {
  const clip = imageClipPath?.trim();
  if (clip) {
    const polygonMatch = clip.match(/^polygon\((.+)\)$/i);
    if (polygonMatch) {
      return { type: 'polygon', points: parsePolygonPairs(polygonMatch[1]) };
    }
    const pathMatch = clip.match(/^path\(\s*['"](.+)['"]\s*\)$/is);
    if (pathMatch) {
      return { type: 'path', pathD: pathMatch[1] };
    }
  }
  if (imageBorderRadiusPx > 0) {
    return { type: 'rounded', radiusPx: imageBorderRadiusPx };
  }
  return { type: 'rect' };
}

function parsePolygonPairs(raw: string): Array<{ x: number; y: number }> {
  return raw.split(',').map((pair) => {
    const [xRaw, yRaw] = pair.trim().split(/\s+/);
    return { x: parseFloat(xRaw), y: parseFloat(yRaw) };
  });
}

/** Printable area — matches the image layer box (green stroke is drawn outside via CSS). */
export function getSheetClipRect(
  pad: number,
  sheetW: number,
  sheetH: number,
  inset = SHEET_FRAME_INSET_PX,
): { left: number; top: number; width: number; height: number } {
  const clampedInset = Math.min(inset, Math.floor(sheetW / 2) - 1, Math.floor(sheetH / 2) - 1);
  const safeInset = Math.max(0, clampedInset);
  return {
    left: pad + safeInset,
    top: pad + safeInset,
    width: Math.max(1, sheetW - 2 * safeInset),
    height: Math.max(1, sheetH - 2 * safeInset),
  };
}

function resolveClipBounds(
  spec: PhSheetClipSpec,
  pad: number,
  sheetW: number,
  sheetH: number,
  inset = SHEET_FRAME_INSET_PX,
): { left: number; top: number; width: number; height: number } {
  const bounds =
    spec.type === 'rect' || spec.type === 'rounded' ? spec.bounds : undefined;
  if (bounds) {
    return {
      left: pad + bounds.left,
      top: pad + bounds.top,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    };
  }
  return getSheetClipRect(pad, sheetW, sheetH, inset);
}

function resolveRoundedClipRadiusPx(
  spec: Extract<PhSheetClipSpec, { type: 'rounded' }>,
  clip: { width: number; height: number },
  inset: number,
): number {
  const rawRadius = spec.bounds ? spec.radiusPx : spec.radiusPx - inset;
  return Math.min(Math.max(0, rawRadius), clip.width / 2, clip.height / 2);
}

/** Shrink a convex polygon slightly inward (chamfer / bleed outlines). */
function insetPolygonPoints(
  points: Array<{ x: number; y: number }>,
  inset: number,
): Array<{ x: number; y: number }> {
  if (inset <= 0 || points.length < 3) {
    return points;
  }
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return points.map((point) => {
    const dx = cx - point.x;
    const dy = cy - point.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: point.x + (dx / len) * inset,
      y: point.y + (dy / len) * inset,
    };
  });
}

function polygonToPathD(points: Array<{ x: number; y: number }>, pad: number): string {
  if (!points.length) {
    return '';
  }
  const [first, ...rest] = points;
  const start = `M ${first.x + pad} ${first.y + pad}`;
  const lines = rest.map((point) => `L ${point.x + pad} ${point.y + pad}`).join(' ');
  return `${start} ${lines} Z`;
}

/** Fabric clip object in canvas coordinates (matches ph-print-preview image layer clip). */
export function createFabricSheetClip(
  spec: PhSheetClipSpec,
  pad: number,
  sheetW: number,
  sheetH: number,
  inset = SHEET_FRAME_INSET_PX,
): FabricObject {
  const clip = resolveClipBounds(spec, pad, sheetW, sheetH, inset);
  switch (spec.type) {
    case 'rounded': {
      const radius = resolveRoundedClipRadiusPx(spec, clip, inset);
      return new Rect({
        left: clip.left,
        top: clip.top,
        width: clip.width,
        height: clip.height,
        rx: radius,
        ry: radius,
        originX: 'left',
        originY: 'top',
        absolutePositioned: true,
      });
    }
    case 'polygon':
      return new Path(
        polygonToPathD(insetPolygonPoints(spec.points, inset), pad),
        {
          originX: 'left',
          originY: 'top',
          absolutePositioned: true,
        },
      );
    case 'path':
      return new Path(spec.pathD, {
        left: pad,
        top: pad,
        originX: 'left',
        originY: 'top',
        absolutePositioned: true,
      });
    default:
      return new Rect({
        left: clip.left,
        top: clip.top,
        width: clip.width,
        height: clip.height,
        originX: 'left',
        originY: 'top',
        absolutePositioned: true,
      });
  }
}

/** Apply the same sheet clip on a raw canvas context (after:render interior pass). */
export function applySheetClipToContext(
  ctx: CanvasRenderingContext2D,
  spec: PhSheetClipSpec,
  pad: number,
  sheetW: number,
  sheetH: number,
  inset = SHEET_FRAME_INSET_PX,
): void {
  const clip = resolveClipBounds(spec, pad, sheetW, sheetH, inset);
  switch (spec.type) {
    case 'rounded': {
      const x = clip.left;
      const y = clip.top;
      const w = clip.width;
      const h = clip.height;
      const r = resolveRoundedClipRadiusPx(spec, clip, inset);
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, r);
      } else {
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      }
      ctx.clip();
      break;
    }
    case 'polygon': {
      ctx.beginPath();
      const points = insetPolygonPoints(spec.points, inset);
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const px = point.x + pad;
        const py = point.y + pad;
        if (index === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.clip();
      break;
    }
    case 'path': {
      ctx.save();
      ctx.translate(pad, pad);
      const path = new Path2D(spec.pathD);
      ctx.clip(path);
      ctx.restore();
      break;
    }
    default:
      ctx.beginPath();
      ctx.rect(clip.left, clip.top, clip.width, clip.height);
      ctx.clip();
  }
}

export function sheetClipSpecKey(
  imageClipPath: string | null | undefined,
  imageBorderRadiusPx: number,
): string {
  return `${imageClipPath ?? ''}|${imageBorderRadiusPx}`;
}

export function trimBleedClipSpecKey(spec: PhSheetClipSpec | null | undefined): string {
  if (!spec) {
    return '';
  }
  return JSON.stringify(spec);
}
