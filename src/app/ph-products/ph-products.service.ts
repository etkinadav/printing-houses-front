import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from 'src/environments/environment';
import { CreatePhProductPayload, PhProduct, UpdatePhProductPayload } from './ph-product.model';

const BACKEND_URL = environment.apiUrl + '/ph-products';

@Injectable({
  providedIn: 'root',
})
export class PhProductsService {
  constructor(private http: HttpClient) {}

  getAllProducts(): Observable<{ message: string; products: PhProduct[] }> {
    return this.http.get<{ message: string; products: PhProduct[] }>(BACKEND_URL);
  }

  getProductsByPrintingHouse(
    printingHouseId: string,
  ): Observable<{ message: string; products: PhProduct[] }> {
    return this.http.get<{ message: string; products: PhProduct[] }>(
      `${BACKEND_URL}/by-printing-house/${printingHouseId}`,
    );
  }

  getProductsByPrintingHousePublic(
    printingHouseId: string,
  ): Observable<{ message: string; products: PhProduct[] }> {
    return this.http.get<{ message: string; products: PhProduct[] }>(
      `${BACKEND_URL}/public/by-printing-house/${printingHouseId}`,
    );
  }

  getProductById(id: string): Observable<{ message: string; product: PhProduct }> {
    return this.http.get<{ message: string; product: PhProduct }>(`${BACKEND_URL}/${id}`);
  }

  createProduct(payload: CreatePhProductPayload): Observable<{ message: string; product: PhProduct }> {
    return this.http.post<{ message: string; product: PhProduct }>(BACKEND_URL, payload);
  }

  updateProduct(
    id: string,
    payload: UpdatePhProductPayload,
  ): Observable<{ message: string; product: PhProduct }> {
    return this.http.put<{ message: string; product: PhProduct }>(`${BACKEND_URL}/${id}`, payload);
  }

  deleteProduct(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${BACKEND_URL}/${id}`);
  }
}
