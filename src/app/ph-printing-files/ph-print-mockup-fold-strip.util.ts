/** Crop a strip from a composite image using the same canvas layout as the mockup preview. */
export function cropCompositeStripToDataUrl(
  image: HTMLImageElement,
  canvasWidthPx: number,
  canvasHeightPx: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): string | null {
  const stripWidth = Math.max(0, Math.round(sw));
  const stripHeight = Math.max(0, Math.round(sh));
  const srcX = Math.round(sx);
  const srcY = Math.round(sy);
  if (
    stripWidth <= 0 ||
    stripHeight <= 0 ||
    canvasWidthPx <= 0 ||
    canvasHeightPx <= 0 ||
    !image.naturalWidth ||
    !image.naturalHeight
  ) {
    return null;
  }

  const scaled = document.createElement('canvas');
  scaled.width = Math.round(canvasWidthPx);
  scaled.height = Math.round(canvasHeightPx);
  const scaledContext = scaled.getContext('2d');
  if (!scaledContext) {
    return null;
  }
  scaledContext.drawImage(image, 0, 0, scaled.width, scaled.height);

  const strip = document.createElement('canvas');
  strip.width = stripWidth;
  strip.height = stripHeight;
  const stripContext = strip.getContext('2d');
  if (!stripContext) {
    return null;
  }
  stripContext.drawImage(
    scaled,
    srcX,
    srcY,
    stripWidth,
    stripHeight,
    0,
    0,
    stripWidth,
    stripHeight,
  );

  try {
    return strip.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** @deprecated Alias kept for older imports — use {@link cropCompositeStripToDataUrl}. */
export const cropImageRegionToDataUrl = cropCompositeStripToDataUrl;
