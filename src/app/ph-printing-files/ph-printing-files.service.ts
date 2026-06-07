import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from 'src/environments/environment';
import { PhPrintingFile } from './ph-printing-file.model';

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

@Injectable({ providedIn: 'root' })
export class PhPrintingFilesService {
  constructor(private http: HttpClient) {}

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

  deleteFile(fileId: string): Observable<PhPrintingFileDeleteResponse> {
    return this.http.delete<PhPrintingFileDeleteResponse>(`${BACKEND_URL}/${fileId}`);
  }

  deleteAll(
    printingHouseId?: string,
    productId?: string,
  ): Observable<PhPrintingFilesDeleteAllResponse> {
    const params: Record<string, string> = {};
    if (printingHouseId?.trim()) {
      params['printingHouseId'] = printingHouseId.trim();
    }
    if (productId?.trim()) {
      params['productId'] = productId.trim();
    }
    return this.http.delete<PhPrintingFilesDeleteAllResponse>(`${BACKEND_URL}/mine`, { params });
  }
}
