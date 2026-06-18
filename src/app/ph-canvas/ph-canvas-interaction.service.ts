import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { PhCanvasSideName } from './ph-canvas.model';

/** Ensures only one canvas side has a selected / moving image at a time (duplex). */
@Injectable({ providedIn: 'root' })
export class PhCanvasInteractionService {
  private activeSide: PhCanvasSideName | null = null;
  private readonly releaseOthersSubject = new Subject<PhCanvasSideName>();
  private readonly pointerDownCaptureSubject = new Subject<PointerEvent>();

  /** Emits the side that claimed focus; all other sheets should clear selection. */
  readonly releaseOthers$ = this.releaseOthersSubject.asObservable();

  /** Capture-phase pointerdown on document — sheets dismiss selection when outside the active image. */
  readonly pointerDownCapture$ = this.pointerDownCaptureSubject.asObservable();

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    }
  }

  private onDocumentPointerDown = (event: PointerEvent): void => {
    this.pointerDownCaptureSubject.next(event);
  };

  claim(side: PhCanvasSideName): void {
    if (this.activeSide === side) {
      return;
    }
    this.activeSide = side;
    this.releaseOthersSubject.next(side);
  }

  release(side: PhCanvasSideName): void {
    if (this.activeSide === side) {
      this.activeSide = null;
    }
  }
}
