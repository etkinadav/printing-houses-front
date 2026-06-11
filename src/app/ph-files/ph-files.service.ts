import { HttpClient, HttpEvent } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from 'src/environments/environment';

const BACKEND_URL = environment.apiUrl + '/ph-files';

export const PH_FILE_TYPE_PRINTING_HOUSE_LOGO = 'printing-house-logo';
export const PH_FILE_TYPE_TEXTURE = 'texture';
export const PH_FILE_TYPE_MOCKUP = 'mockup';
export const PH_FILE_TYPE_PRINTING_FILE = 'printing-file';

export interface PhFileUploadMeta {
  printingHouseId?: string;
  productId?: string;
}

export interface PhUploadedFileRef {
  url: string;
  key: string;
}

export interface PhFileUploadResponse {
  message: string;
  type: string;
  original: PhUploadedFileRef | null;
  thumbnail: PhUploadedFileRef | null;
}

@Injectable({ providedIn: 'root' })
export class PhFilesService {
  constructor(private http: HttpClient) {}

  upload(
    type: string,
    file: File,
    meta?: PhFileUploadMeta,
  ): Observable<HttpEvent<PhFileUploadResponse>> {
    const form = new FormData();
    form.append('type', type);
    form.append('file', file, file.name);
    if (meta?.printingHouseId?.trim()) {
      form.append('printingHouseId', meta.printingHouseId.trim());
    }
    if (meta?.productId?.trim()) {
      form.append('productId', meta.productId.trim());
    }

    return this.http.post<PhFileUploadResponse>(`${BACKEND_URL}/upload`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  /** Same-origin proxy for S3 thumbnails/textures (WebGL cannot load cross-origin S3 directly). */
  fetchPreviewTexture(url: string): Observable<Blob | null> {
    return this.http.get(`${BACKEND_URL}/preview-texture`, {
      params: { url },
      responseType: 'blob',
    }).pipe(catchError(() => of(null)));
  }

  fetchPreviewTextureBlob(url: string): Promise<Blob | null> {
    return firstValueFrom(this.fetchPreviewTexture(url));
  }
}
