import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from 'src/environments/environment';
import { PhPrintingFilePrintSettings } from '../ph-printing-files/ph-printing-file.model';
import { PhCanvas, PhCanvasPlacement, PhCanvasSideName } from './ph-canvas.model';

const BACKEND_URL = environment.apiUrl + '/ph-canvas';

export interface PhCanvasResponse {
  message: string;
  canvas: PhCanvas;
}

/** Placement payload sent to the server (geometry only; no _id needed). */
export type PhCanvasPlacementInput = Omit<PhCanvasPlacement, '_id'>;

@Injectable({ providedIn: 'root' })
export class PhCanvasService {
  constructor(private http: HttpClient) {}

  /** Find-or-create the single editing canvas for this user + product (+ house). */
  getCurrent(productId: string, printingHouseId?: string): Observable<PhCanvasResponse> {
    const params: Record<string, string> = { productId };
    if (printingHouseId?.trim()) {
      params['printingHouseId'] = printingHouseId.trim();
    }
    return this.http.get<PhCanvasResponse>(`${BACKEND_URL}/current`, { params });
  }

  updateSettings(
    id: string,
    printSettings: PhPrintingFilePrintSettings,
  ): Observable<PhCanvasResponse> {
    return this.http.put<PhCanvasResponse>(`${BACKEND_URL}/${id}/settings`, {
      printSettings,
    });
  }

  updateSidePlacements(
    id: string,
    side: PhCanvasSideName,
    placements: PhCanvasPlacementInput[],
  ): Observable<PhCanvasResponse> {
    return this.http.put<PhCanvasResponse>(
      `${BACKEND_URL}/${id}/sides/${side}/placements`,
      { placements },
    );
  }
}
