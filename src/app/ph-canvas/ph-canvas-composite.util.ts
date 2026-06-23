import { PhPrintingFile } from '../ph-printing-files/ph-printing-file.model';
import { PhCanvasPlacement, phCanvasProxiedImageUrl } from './ph-canvas.model';

/** Longest edge (px) of the rendered composite raster fed to the mockup. */
const COMPOSITE_MAX_EDGE_PX = 1400;

export interface RenderCanvasSideCompositeOptions {
  /** Duplex / bleed margin cm added on each side of the base sheet. */
  marginCm?: number;
}

function resolveUrl(
  placement: PhCanvasPlacement,
  files: PhPrintingFile[],
): string | null {
  const file = files.find((f) => f._id === placement.fileId);
  const image = file?.images?.find((im) => im._id === placement.imageId);
  const url = image?.thumbnailUrl?.trim();
  return url ? phCanvasProxiedImageUrl(url) : null;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Render a canvas side's placements to a transparent-background PNG data URL at
 * the sheet aspect ratio. Returns null when there is nothing to draw or export
 * fails (e.g. a CORS-tainted canvas).
 */
export async function renderCanvasSideComposite(
  placements: PhCanvasPlacement[],
  files: PhPrintingFile[],
  baseWidthCm: number,
  baseHeightCm: number,
  options: RenderCanvasSideCompositeOptions = {},
): Promise<string | null> {
  const list = (placements ?? []).filter((p) => resolveUrl(p, files));
  if (!list.length) {
    return null;
  }

  const marginCm = Math.max(0, Number(options.marginCm) || 0);
  const sheetWidthCm = baseWidthCm + marginCm * 2;
  const sheetHeightCm = baseHeightCm + marginCm * 2;

  const aspect =
    Number.isFinite(sheetWidthCm) &&
    Number.isFinite(sheetHeightCm) &&
    sheetWidthCm > 0 &&
    sheetHeightCm > 0
      ? sheetWidthCm / sheetHeightCm
      : 1;

  let W: number;
  let H: number;
  if (aspect >= 1) {
    W = COMPOSITE_MAX_EDGE_PX;
    H = Math.max(1, Math.round(COMPOSITE_MAX_EDGE_PX / aspect));
  } else {
    H = COMPOSITE_MAX_EDGE_PX;
    W = Math.max(1, Math.round(COMPOSITE_MAX_EDGE_PX * aspect));
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  const ordered = [...list].sort((a, b) => a.zIndex - b.zIndex);
  for (const placement of ordered) {
    const url = resolveUrl(placement, files);
    if (!url) {
      continue;
    }
    const img = await loadImage(url);
    if (!img) {
      continue;
    }
    const dw = Math.max(1, placement.width * W);
    const dh = Math.max(1, placement.height * H);
    const cx = placement.x * W + dw / 2;
    const cy = placement.y * H + dh / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((placement.rotation || 0) * Math.PI) / 180);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
