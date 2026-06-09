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
  thumbnailUrl?: string | null;
  thumbnailKey?: string | null;
  processing: boolean;
  /** Original file pixel dimensions (at origImageDPI), same semantics as mean-corse express images. */
  imageWidth?: number | null;
  imageHeight?: number | null;
  origImageDPI?: number | null;
  printSettings?: PhPrintingFilePrintSettings;
}
