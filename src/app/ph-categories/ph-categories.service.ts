import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from 'src/environments/environment';
import { PhCategory, SyncCategoriesRequest } from './ph-category.model';

const BACKEND_URL = environment.apiUrl + '/ph-categories';

@Injectable({
  providedIn: 'root',
})
export class PhCategoriesService {
  constructor(private http: HttpClient) {}

  getAllCategories(): Observable<{ message: string; categories: PhCategory[] }> {
    return this.http.get<{ message: string; categories: PhCategory[] }>(BACKEND_URL);
  }

  syncCategories(
    payload: SyncCategoriesRequest,
  ): Observable<{ message: string; categories: PhCategory[] }> {
    return this.http.put<{ message: string; categories: PhCategory[] }>(
      `${BACKEND_URL}/sync`,
      payload,
    );
  }
}
