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
}
