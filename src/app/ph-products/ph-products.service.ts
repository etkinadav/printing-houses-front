import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from 'src/environments/environment';
import { CreatePhProductPayload, PhProduct } from './ph-product.model';

const BACKEND_URL = environment.apiUrl + '/ph-products';

@Injectable({
  providedIn: 'root',
})
export class PhProductsService {
  constructor(private http: HttpClient) {}

  getAllProducts(): Observable<{ message: string; products: PhProduct[] }> {
    return this.http.get<{ message: string; products: PhProduct[] }>(BACKEND_URL);
  }

  createProduct(payload: CreatePhProductPayload): Observable<{ message: string; product: PhProduct }> {
    return this.http.post<{ message: string; product: PhProduct }>(BACKEND_URL, payload);
  }
}
