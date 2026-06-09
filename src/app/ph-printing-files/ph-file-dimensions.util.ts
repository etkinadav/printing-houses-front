import { PhPrintingFile } from './ph-printing-file.model';

/** Same formula as mean-corse-01 `getOriginalWidth` / `getOriginalHeight`. */
export function pixelsToOriginalCmString(pixels: number, dpi: number): string {
  const safeDpi = dpi > 0 ? dpi : 300;
  return (Math.ceil((pixels / safeDpi) * 2.54 * 100) / 100).toFixed(2);
}

export function resolveFileOriginalDpi(file: PhPrintingFile | null | undefined): number {
  const dpi = Number(file?.origImageDPI);
  return dpi > 0 ? dpi : 300;
}

export function getFileOriginalWidthCm(file: PhPrintingFile | null | undefined): string {
  const widthPx = Number(file?.imageWidth);
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    return '-';
  }
  return pixelsToOriginalCmString(widthPx, resolveFileOriginalDpi(file));
}

export function getFileOriginalHeightCm(file: PhPrintingFile | null | undefined): string {
  const heightPx = Number(file?.imageHeight);
  if (!Number.isFinite(heightPx) || heightPx <= 0) {
    return '-';
  }
  return pixelsToOriginalCmString(heightPx, resolveFileOriginalDpi(file));
}

export function formatFileOriginalDimensionsLine(
  file: PhPrintingFile | null | undefined,
  cmLabel: string,
  fallback = '—',
): string {
  const widthCm = getFileOriginalWidthCm(file);
  const heightCm = getFileOriginalHeightCm(file);
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
