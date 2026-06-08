export interface PhPrintingFilePrintSettings {
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
  processing: boolean;
  printSettings?: PhPrintingFilePrintSettings;
}
