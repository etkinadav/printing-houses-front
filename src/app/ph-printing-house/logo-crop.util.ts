/** Crop box size on the join form before normalized offsets (px). */
export const LOGO_CROP_LEGACY_VIEWPORT_PX = 220;

export interface LogoCropSettings {
  offsetX?: number;
  offsetY?: number;
  zoom?: number;
  offsetsNormalized?: boolean;
}

export function offsetRatioToPx(ratio: number, viewportSize: number): number {
  return ratio * viewportSize;
}

export function offsetPxToRatio(px: number, viewportSize: number): number {
  if (!viewportSize) return 0;
  return px / viewportSize;
}

/** Converts stored offset to pixels for the current square viewport. */
export function resolveLogoOffsetPx(
  stored: number | undefined,
  viewportSize: number,
  logo?: LogoCropSettings | null,
): number {
  const v = typeof stored === 'number' && Number.isFinite(stored) ? stored : 0;
  if (!viewportSize) return 0;
  if (logo?.offsetsNormalized) {
    return offsetRatioToPx(v, viewportSize);
  }
  return (v / LOGO_CROP_LEGACY_VIEWPORT_PX) * viewportSize;
}

export function computeLogoCoverScale(
  naturalW: number,
  naturalH: number,
  viewportW: number,
  viewportH: number,
): number {
  if (!naturalW || !naturalH || !viewportW || !viewportH) return 1;
  return Math.max(viewportW / naturalW, viewportH / naturalH);
}

export function buildLogoCropTransform(
  logo: LogoCropSettings | null | undefined,
  viewportW: number,
  viewportH: number,
  naturalW: number,
  naturalH: number,
): string {
  const zoom = typeof logo?.zoom === 'number' && Number.isFinite(logo.zoom) ? logo.zoom : 1;
  const coverScale = computeLogoCoverScale(naturalW, naturalH, viewportW, viewportH);
  const offsetX = resolveLogoOffsetPx(logo?.offsetX, viewportW, logo);
  const offsetY = resolveLogoOffsetPx(logo?.offsetY, viewportH, logo);
  const scale = coverScale * zoom;
  return `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}
