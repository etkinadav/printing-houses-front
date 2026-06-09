import { PhPrintingFile, PhPrintingFileImage } from './ph-printing-file.model';

/** Same formula as mean-corse-01 `getOriginalWidth` / `getOriginalHeight`. */
export function pixelsToOriginalCmString(pixels: number, dpi: number): string {
  const safeDpi = dpi > 0 ? dpi : 300;
  return (Math.ceil((pixels / safeDpi) * 2.54 * 100) / 100).toFixed(2);
}

export function resolveImageOriginalDpi(image: PhPrintingFileImage | null | undefined): number {
  const dpi = Number(image?.origImageDPI);
  return dpi > 0 ? dpi : 300;
}

export function getImageOriginalWidthCm(image: PhPrintingFileImage | null | undefined): string {
  const widthPx = Number(image?.imageWidth);
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    return '-';
  }
  return pixelsToOriginalCmString(widthPx, resolveImageOriginalDpi(image));
}

export function getImageOriginalHeightCm(image: PhPrintingFileImage | null | undefined): string {
  const heightPx = Number(image?.imageHeight);
  if (!Number.isFinite(heightPx) || heightPx <= 0) {
    return '-';
  }
  return pixelsToOriginalCmString(heightPx, resolveImageOriginalDpi(image));
}

export function formatImageOriginalDimensionsLine(
  image: PhPrintingFileImage | null | undefined,
  cmLabel: string,
  fallback = '—',
): string {
  const widthCm = getImageOriginalWidthCm(image);
  const heightCm = getImageOriginalHeightCm(image);
  if (widthCm === '-' || heightCm === '-') {
    return fallback;
  }
  return `${widthCm} × ${heightCm} ${cmLabel}`.trim();
}

export function isRasterPrintingFile(file: PhPrintingFile | null | undefined): boolean {
  const name = file?.originalFileName?.trim().toLowerCase() || '';
  const ext = name.includes('.') ? name.split('.').pop() || '' : '';
  if (['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp', 'tif', 'tiff', 'heic', 'heif'].includes(ext)) {
    return true;
  }
  const type = file?.fileType?.trim().toLowerCase() || '';
  return type.startsWith('image/');
}
