import { HttpClient, HttpEvent } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from 'src/environments/environment';

const BACKEND_URL = environment.apiUrl + '/ph-files';

export const PH_FILE_TYPE_PRINTING_HOUSE_LOGO = 'printing-house-logo';

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

  upload(type: string, file: File): Observable<HttpEvent<PhFileUploadResponse>> {
    const form = new FormData();
    form.append('type', type);
    form.append('file', file, file.name);

    return this.http.post<PhFileUploadResponse>(`${BACKEND_URL}/upload`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }
}
