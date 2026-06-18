import { FabricObject, Path, Rect } from 'fabric';

export type PhSheetClipSpec =
  | { type: 'rect' }
  | { type: 'rounded'; radiusPx: number }
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
    const pathMatch = clip.match(/^path\(\s*['"]?(.+?)['"]?\s*\)$/i);
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
): FabricObject {
  switch (spec.type) {
    case 'rounded':
      return new Rect({
        left: pad,
        top: pad,
        width: sheetW,
        height: sheetH,
        rx: spec.radiusPx,
        ry: spec.radiusPx,
        originX: 'left',
        originY: 'top',
        absolutePositioned: true,
      });
    case 'polygon':
      return new Path(polygonToPathD(spec.points, pad), {
        originX: 'left',
        originY: 'top',
        absolutePositioned: true,
      });
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
        left: pad,
        top: pad,
        width: sheetW,
        height: sheetH,
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
): void {
  switch (spec.type) {
    case 'rounded': {
      const x = pad;
      const y = pad;
      const w = sheetW;
      const h = sheetH;
      const r = Math.min(spec.radiusPx, w / 2, h / 2);
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
      for (let index = 0; index < spec.points.length; index += 1) {
        const point = spec.points[index];
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
      ctx.rect(pad, pad, sheetW, sheetH);
      ctx.clip();
  }
}

export function sheetClipSpecKey(
  imageClipPath: string | null | undefined,
  imageBorderRadiusPx: number,
): string {
  return `${imageClipPath ?? ''}|${imageBorderRadiusPx}`;
}
