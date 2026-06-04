import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from 'src/environments/environment';
import {
  CreatePhPrintingHousePayload,
  PhPrintingHouse,
  PhPrintingHouseMapMarker,
} from './ph-printing-house.model';

const BACKEND_URL = environment.apiUrl + '/ph-printing-house';

@Injectable({ providedIn: 'root' })
export class PhPrintingHouseService {
  constructor(private http: HttpClient) {}

  listForMap(): Observable<{ message: string; printingHouses: PhPrintingHouseMapMarker[] }> {
    return this.http.get<{ message: string; printingHouses: PhPrintingHouseMapMarker[] }>(
      BACKEND_URL,
    );
  }

  createPrintingHouse(payload: CreatePhPrintingHousePayload): Observable<{ message: string; printingHouse: PhPrintingHouse }> {
    return this.http.post<{ message: string; printingHouse: PhPrintingHouse }>(BACKEND_URL, payload);
  }

  getMyPrintingHouse(): Observable<{ message: string; printingHouse: PhPrintingHouse }> {
    return this.http.get<{ message: string; printingHouse: PhPrintingHouse }>(BACKEND_URL + '/me');
  }

  getPrintingHouseById(id: string): Observable<{ message: string; printingHouse: PhPrintingHouse }> {
    return this.http.get<{ message: string; printingHouse: PhPrintingHouse }>(BACKEND_URL + '/' + id);
  }
}

