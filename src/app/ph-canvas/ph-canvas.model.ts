import { environment } from 'src/environments/environment';
import { PhPrintingFilePrintSettings } from '../ph-printing-files/ph-printing-file.model';

export type PhCanvasSideName = 'front' | 'back';

/**
 * Route a remote (S3) image through the backend CORS proxy so it can be drawn
 * into a <canvas> and exported via toDataURL without tainting. Local/data URLs
 * and already-proxied URLs are returned unchanged.
 */
export function phCanvasProxiedImageUrl(url: string | null | undefined): string {
  const trimmed = (url ?? '').trim();
  if (!trimmed) {
    return '';
  }
  if (!/^https?:\/\//i.test(trimmed) || trimmed.startsWith(`${environment.apiUrl}/ph-canvas/image-proxy`)) {
    return trimmed;
  }
  return `${environment.apiUrl}/ph-canvas/image-proxy?url=${encodeURIComponent(trimmed)}`;
}

/** A single page-image placed on a canvas side; geometry is normalized 0..1. */
export interface PhCanvasPlacement {
  _id?: string;
  fileId: string;
  imageId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
}

export interface PhCanvasSide {
  _id?: string;
  side: PhCanvasSideName;
  placements: PhCanvasPlacement[];
}

export interface PhCanvas {
  _id: string;
  userID: string;
  printingHouseId?: string | null;
  productId: string;
  status: 'editing' | 'submitted';
  printSettings: PhPrintingFilePrintSettings;
  sides: PhCanvasSide[];
}

/** Drag payload set on a sidebar page tile and read on drop into a Fabric sheet. */
export interface PhCanvasDragPayload {
  fileId: string;
  imageId: string;
  page: number;
  thumbnailUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  origImageDPI: number | null;
}

export const PH_CANVAS_DRAG_MIME = 'application/x-ph-canvas-page';

/** Stable instance key for a placement (supports duplicate file pages on one side). */
export function phCanvasPlacementInstanceId(placement: PhCanvasPlacement): string {
  const id = placement._id?.trim();
  if (id) {
    return id;
  }
  return `${placement.fileId}:${placement.imageId}:${placement.zIndex}`;
}

/** New Mongo-compatible ObjectId string for a freshly created placement instance. */
export function phCanvasCreatePlacementId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function phCanvasEnsurePlacementIds(
  placements: PhCanvasPlacement[],
): PhCanvasPlacement[] {
  return (placements ?? []).map((placement) => ({
    ...placement,
    _id: placement._id?.trim() || phCanvasCreatePlacementId(),
  }));
}

export function phCanvasNormalizeCanvasPlacements(canvas: PhCanvas): PhCanvas {
  for (const side of canvas.sides ?? []) {
    side.placements = phCanvasEnsurePlacementIds(side.placements ?? []);
  }
  return canvas;
}
