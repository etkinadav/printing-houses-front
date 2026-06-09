import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from 'src/environments/environment';
import { PhPrintingFile, PhPrintingFilePrintSettings } from './ph-printing-file.model';

const BACKEND_URL = environment.apiUrl + '/ph-printing-files';

export interface PhPrintingFilesListResponse {
  message: string;
  files: PhPrintingFile[];
}

export interface PhPrintingFilesDeleteAllResponse {
  message: string;
  deletedCount: number;
}

export interface PhPrintingFileDeleteResponse {
  message: string;
  deletedFileId: string;
}

export interface PhPrintingFileImageDeleteResponse {
  message: string;
  deletedImageId: string;
  deletedFileId?: string;
  file?: PhPrintingFile;
}

export interface PhPrintingFileSettingsResponse {
  message: string;
  file: PhPrintingFile;
  fileId: string;
}

export interface PhPrintingFilesBulkSettingsResponse {
  message: string;
  files: PhPrintingFile[];
  updatedFileCount: number;
  updatedImageCount: number;
}

@Injectable({ providedIn: 'root' })
export class PhPrintingFilesService {
  constructor(private http: HttpClient) {}

  /**
   * List files for user + printing house. `productId` only selects which per-product
   * print settings are hydrated on each file — it does not filter the file list.
   */
  getMyFiles(printingHouseId?: string, productId?: string): Observable<PhPrintingFilesListResponse> {
    const params: Record<string, string> = {};
    if (printingHouseId?.trim()) {
      params['printingHouseId'] = printingHouseId.trim();
    }
    if (productId?.trim()) {
      params['productId'] = productId.trim();
    }
    return this.http.get<PhPrintingFilesListResponse>(`${BACKEND_URL}/mine`, { params });
  }

  updateFileSettings(
    fileId: string,
    imageId: string,
    printSettings: PhPrintingFilePrintSettings,
    productId: string,
  ): Observable<PhPrintingFileSettingsResponse> {
    return this.http.put<PhPrintingFileSettingsResponse>(`${BACKEND_URL}/${fileId}/settings`, {
      imageId,
      printSettings,
      productId,
    });
  }

  updateAllFileSettings(
    printSettings: PhPrintingFilePrintSettings,
    productId: string,
    printingHouseId?: string,
  ): Observable<PhPrintingFilesBulkSettingsResponse> {
    return this.http.put<PhPrintingFilesBulkSettingsResponse>(
      `${BACKEND_URL}/mine/settings-all`,
      {
        printSettings,
        productId,
        printingHouseId: printingHouseId?.trim() || undefined,
      },
    );
  }

  deleteFile(fileId: string): Observable<PhPrintingFileDeleteResponse> {
    return this.http.delete<PhPrintingFileDeleteResponse>(`${BACKEND_URL}/${fileId}`);
  }

  deleteImage(
    fileId: string,
    imageId: string,
    productId?: string,
    printingHouseId?: string,
  ): Observable<PhPrintingFileImageDeleteResponse> {
    const params: Record<string, string> = {};
    if (productId?.trim()) {
      params['productId'] = productId.trim();
    }
    if (printingHouseId?.trim()) {
      params['printingHouseId'] = printingHouseId.trim();
    }
    return this.http.delete<PhPrintingFileImageDeleteResponse>(
      `${BACKEND_URL}/${fileId}/images/${imageId}`,
      { params },
    );
  }

  deleteAll(printingHouseId?: string): Observable<PhPrintingFilesDeleteAllResponse> {
    const params: Record<string, string> = {};
    if (printingHouseId?.trim()) {
      params['printingHouseId'] = printingHouseId.trim();
    }
    return this.http.delete<PhPrintingFilesDeleteAllResponse>(`${BACKEND_URL}/mine`, { params });
  }
}
