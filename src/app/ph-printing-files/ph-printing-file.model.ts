export interface PhPrintingFileExtraSelections {
  cornersIndex?: number;
  bleedIndex?: number;
  foldingIndex?: number;
  duplexIndex?: number;
  cornersEnabled?: boolean;
  bleedEnabled?: boolean;
  foldingEnabled?: boolean;
  duplexEnabled?: boolean;
  doubleSidedEnabled?: boolean;
}

export interface PhPrintingFilePrintSettings extends PhPrintingFileExtraSelections {
  paperType?: string;
  sizeIndex?: number;
  materialIndex?: number;
  colorIndex?: number;
  lengthCm?: number;
  widthCm?: number;
}

/**
 * A single page of a printing file. Multi-page files (PDF and other formats) are
 * split into one image per page; thumbnail, dimensions, DPI and (per-product,
 * resolved) print settings live here. Mirrors the mean-corse-01 plotter model.
 */
export interface PhPrintingFileImage {
  _id: string;
  /** 1-based page number within the source file. */
  page: number;
  thumbnailUrl?: string | null;
  thumbnailKey?: string | null;
  /** Original page pixel dimensions (at origImageDPI). */
  imageWidth?: number | null;
  imageHeight?: number | null;
  origImageDPI?: number | null;
  /** Resolved settings for the currently selected product. */
  printSettings?: PhPrintingFilePrintSettings;
  /** Duplex pair metadata for the currently selected product. */
  duplexPairing?: PhDuplexPairingMeta;
}

export interface PhDuplexPairingMeta {
  pairIndex: number;
  side: 'front' | 'back';
  partnerFileId: string | null;
  partnerImageId: string | null;
  globalOrderIndex: number;
  isPlaceholderPartner: boolean;
}

export interface PhPrintingFile {
  _id: string;
  created: string;
  userID: string;
  printingHouseId?: string | null;
  productId?: string | null;
  originalFileName?: string;
  fileSize?: number;
  fileType?: string;
  originalUrl: string;
  processing: boolean;
  processingError?: boolean;
  /** Per-page data: thumbnail, dimensions, DPI and resolved print settings. */
  images: PhPrintingFileImage[];
}
