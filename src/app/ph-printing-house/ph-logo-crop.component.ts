import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

import { buildLogoCropTransform } from './logo-crop.util';
import { PhPrintingHouseLogo } from './ph-printing-house.model';

@Component({
  selector: 'app-ph-logo-crop',
  templateUrl: './ph-logo-crop.component.html',
  styleUrls: ['./ph-logo-crop.component.css'],
})
export class PhLogoCropComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() imageUrl = '';
  @Input() logo: PhPrintingHouseLogo | null | undefined;
  /** Square viewport edge length (CSS length), e.g. `2.125rem`. */
  @Input() size = '2.125rem';

  @ViewChild('logoViewport') logoViewport?: ElementRef<HTMLDivElement>;
  @ViewChild('logoImg') logoImg?: ElementRef<HTMLImageElement>;

  logoImgTransform = '';

  private logoNaturalW = 0;
  private logoNaturalH = 0;
  private resizeObserver?: ResizeObserver;
  private transformUpdateScheduled = false;

  ngAfterViewInit(): void {
    this.setupLogoViewportObserver();
    this.scheduleLogoTransformUpdate();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['imageUrl'] || changes['logo']) {
      this.scheduleLogoTransformUpdate();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  onLogoImgLoad(): void {
    const img = this.logoImg?.nativeElement;
    if (!img) {
      return;
    }
    this.logoNaturalW = img.naturalWidth || 0;
    this.logoNaturalH = img.naturalHeight || 0;
    this.scheduleLogoTransformUpdate();
  }

  private setupLogoViewportObserver(): void {
    const el = this.logoViewport?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.scheduleLogoTransformUpdate());
    this.resizeObserver.observe(el);
  }

  /** Defer transform updates so ResizeObserver / image load do not trigger NG0100. */
  private scheduleLogoTransformUpdate(): void {
    if (this.transformUpdateScheduled) {
      return;
    }
    this.transformUpdateScheduled = true;
    queueMicrotask(() => {
      this.transformUpdateScheduled = false;
      this.updateLogoTransform();
    });
  }

  private updateLogoTransform(): void {
    const viewport = this.logoViewport?.nativeElement;
    if (!viewport) {
      return;
    }

    const img = this.logoImg?.nativeElement;
    if (img?.complete && img.naturalWidth) {
      this.logoNaturalW = img.naturalWidth;
      this.logoNaturalH = img.naturalHeight;
    }

    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (!vw || !vh) {
      return;
    }

    this.logoImgTransform = buildLogoCropTransform(
      this.logo,
      vw,
      vh,
      this.logoNaturalW,
      this.logoNaturalH,
    );
  }
}
