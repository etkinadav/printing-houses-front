/** Same list as mean-corse-01 printing-table `allowedExtensionsExpress`. */
export const ALLOWED_EXTENSIONS_EXPRESS = [
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'heic',
  'heif',
  'pub',
  'tif',
  'docx',
  'csv',
  'odp',
  'djvu',
  'bmp',
  'tiff',
] as const;

/** Same threshold as mean-corse-01 express upload (`fileSize > 500` MB). */
export const EXPRESS_MAX_FILE_SIZE_MB = 500;

export const EXPRESS_FILE_ACCEPT = ALLOWED_EXTENSIONS_EXPRESS.map((ext) => `.${ext}`).join(',');

const ALLOWED_SET = new Set<string>(ALLOWED_EXTENSIONS_EXPRESS);

export function getFileExtension(fileName: string): string {
  return (fileName.split('.').pop() || '').toLowerCase();
}

export function isExpressFileTypeAllowed(fileName: string): boolean {
  const ext = getFileExtension(fileName);
  return !!ext && ALLOWED_SET.has(ext);
}

export function getExpressFileSizeMb(file: File): number {
  return file.size ? Math.ceil(file.size / 1048576) : 0;
}

export function isExpressFileTooLarge(file: File): boolean {
  return getExpressFileSizeMb(file) > EXPRESS_MAX_FILE_SIZE_MB;
}
