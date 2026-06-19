import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

import { PhCanvasSideName } from './ph-canvas.model';

const INTERACTION_DEBUG = true;

export interface PhCanvasSheetRegistration {
  side: PhCanvasSideName;
  containsImageLayerPoint(clientX: number, clientY: number): boolean;
  getImageLayerRect(): DOMRect | null;
  clearSelection(): void;
}

/** Ensures only one canvas side has a selected / moving image at a time (duplex). */
@Injectable({ providedIn: 'root' })
export class PhCanvasInteractionService {
  private activeSide: PhCanvasSideName | null = null;
  private hoverSide: PhCanvasSideName | null = null;
  /** When set, only this side is interactable (front/back pager — not stacked duplex). */
  private pagedSide: PhCanvasSideName | null = null;
  private readonly sheets = new Map<PhCanvasSideName, PhCanvasSheetRegistration>();
  private readonly releaseOthersSubject = new Subject<PhCanvasSideName>();
  private readonly pointerDownCaptureSubject = new Subject<PointerEvent>();
  private readonly hoverSideSubject = new Subject<PhCanvasSideName | null>();
  private readonly activeSideSubject = new BehaviorSubject<PhCanvasSideName | null>(null);

  /** Emits the side that claimed focus; all other sheets should clear selection. */
  readonly releaseOthers$ = this.releaseOthersSubject.asObservable();

  /** Side that currently has a selected image (duplex stacking). */
  readonly activeSide$ = this.activeSideSubject.asObservable();

  /** Emits the duplex side under the pointer (image-layer hit). */
  readonly hoverSide$ = this.hoverSideSubject.asObservable();

  /** Capture-phase pointerdown on document — sheets dismiss selection when outside the active image. */
  readonly pointerDownCapture$ = this.pointerDownCaptureSubject.asObservable();

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
      document.addEventListener('pointermove', this.onDocumentPointerMove, true);
    }
  }

  private onDocumentPointerDown = (event: PointerEvent): void => {
    this.updateHoverSide(event.clientX, event.clientY);

    const targetSide = this.resolveSideAtPointer(event.clientX, event.clientY);
    // Stacked duplex only — not front/back pager (single visible sheet).
    if (this.isDuplex && this.activeSide && targetSide && targetSide !== this.activeSide) {
      if (INTERACTION_DEBUG) {
        console.log(
          `[PhCanvasInteraction] cross-sheet pointerdown ${JSON.stringify({
            from: this.activeSide,
            to: targetSide,
          })}`,
        );
      }
      this.clearAllExcept(null);
      this.activeSide = null;
      this.activeSideSubject.next(null);
    }

    this.pointerDownCaptureSubject.next(event);
  };

  private onDocumentPointerMove = (event: PointerEvent): void => {
    this.updateHoverSide(event.clientX, event.clientY);
  };

  registerSheet(registration: PhCanvasSheetRegistration): void {
    this.sheets.set(registration.side, registration);
    if (INTERACTION_DEBUG) {
      console.log(
        `[PhCanvasInteraction] register ${JSON.stringify({ side: registration.side, count: this.sheets.size })}`,
      );
    }
  }

  unregisterSheet(side: PhCanvasSideName): void {
    this.sheets.delete(side);
    if (this.hoverSide === side) {
      this.hoverSide = null;
      this.hoverSideSubject.next(null);
    }
    if (this.activeSide === side) {
      this.activeSide = null;
      this.activeSideSubject.next(null);
    }
    if (INTERACTION_DEBUG) {
      console.log(
        `[PhCanvasInteraction] unregister ${JSON.stringify({ side, count: this.sheets.size })}`,
      );
    }
  }

  get isDuplex(): boolean {
    return this.pagedSide === null && this.sheets.size > 1;
  }

  /** Front/back pager: one visible canvas side; disables stacked-duplex hover routing. */
  setPagedSide(side: PhCanvasSideName | null): void {
    this.pagedSide = side;
    if (INTERACTION_DEBUG) {
      console.log(`[PhCanvasInteraction] pagedSide ${JSON.stringify({ side })}`);
    }
    if (side && this.activeSide && this.activeSide !== side) {
      this.clearAllExcept(null);
      this.activeSide = null;
      this.activeSideSubject.next(null);
    }
    if (side) {
      this.hoverSide = side;
      this.hoverSideSubject.next(side);
    } else if (this.hoverSide !== null) {
      this.hoverSide = null;
      this.hoverSideSubject.next(null);
    }
  }

  /** Side whose printable image layer contains the pointer (topmost when overlapping). */
  resolveSideAtPointer(clientX: number, clientY: number): PhCanvasSideName | null {
    const matches: PhCanvasSheetRegistration[] = [];
    for (const registration of this.sheets.values()) {
      if (registration.containsImageLayerPoint(clientX, clientY)) {
        matches.push(registration);
      }
    }
    if (!matches.length) {
      return null;
    }
    if (matches.length === 1) {
      return matches[0].side;
    }
    matches.sort((left, right) => {
      const leftTop = left.getImageLayerRect()?.top ?? 0;
      const rightTop = right.getImageLayerRect()?.top ?? 0;
      return rightTop - leftTop;
    });
    return matches[0].side;
  }

  isPointerOnSide(clientX: number, clientY: number, side: PhCanvasSideName): boolean {
    if (!this.isDuplex) {
      return true;
    }
    const resolved = this.resolveSideAtPointer(clientX, clientY);
    return resolved === side;
  }

  getHoverSide(): PhCanvasSideName | null {
    return this.hoverSide;
  }

  getActiveSide(): PhCanvasSideName | null {
    return this.activeSide;
  }

  private updateHoverSide(clientX: number, clientY: number): void {
    let next: PhCanvasSideName | null;
    if (this.pagedSide) {
      const hit = this.resolveSideAtPointer(clientX, clientY);
      next = hit === this.pagedSide ? this.pagedSide : null;
    } else if (this.isDuplex) {
      next = this.resolveSideAtPointer(clientX, clientY);
    } else {
      next = null;
    }
    if (next === this.hoverSide) {
      return;
    }
    this.hoverSide = next;
    if (INTERACTION_DEBUG) {
      console.log(`[PhCanvasInteraction] hoverSide ${JSON.stringify({ side: next })}`);
    }
    this.hoverSideSubject.next(next);
  }

  /** Synchronously clear selection on every sheet except `keepSide` (null = clear all). */
  private clearAllExcept(keepSide: PhCanvasSideName | null): void {
    for (const [side, registration] of this.sheets) {
      if (keepSide !== null && side === keepSide) {
        continue;
      }
      registration.clearSelection();
    }
  }

  claim(side: PhCanvasSideName): void {
    if (INTERACTION_DEBUG) {
      console.log(
        `[PhCanvasInteraction] claim ${JSON.stringify({ from: this.activeSide, to: side })}`,
      );
    }
    this.clearAllExcept(side);
    this.activeSide = side;
    this.activeSideSubject.next(side);
    this.releaseOthersSubject.next(side);
  }

  release(side: PhCanvasSideName): void {
    if (INTERACTION_DEBUG) {
      console.log(
        `[PhCanvasInteraction] release ${JSON.stringify({ side, activeSide: this.activeSide })}`,
      );
    }
    if (this.activeSide === side) {
      this.activeSide = null;
      this.activeSideSubject.next(null);
    }
  }
}
