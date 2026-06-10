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
import { CornerType } from '../ph-products/ph-product.model';
import {
  computePhPrintPreviewLayout,
  PhPrintPreviewLayout,
} from '../ph-printing-files/ph-print-preview-layout.util';

@Component({
  selector: 'app-ph-print-preview',
  templateUrl: './ph-print-preview.component.html',
  styleUrls: ['./ph-print-preview.component.scss'],
})
export class PhPrintPreviewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() imageUrl: string | null = null;
  @Input() baseWidthCm = 0;
  @Input() baseHeightCm = 0;
  /** Margin addition (duplex / תוספת שוליים) — not professional bleed. */
  @Input() marginCm = 0;
  @Input() cornerType: CornerType | 'none' = 'none';
  @Input() cornerRadiusCm = 0;
  @Input() isRTL = false;
  @Input() isDarkMode = false;

  @ViewChild('measureHost') measureHost?: ElementRef<HTMLElement>;

  layout: PhPrintPreviewLayout | null = null;

  private resizeObserver?: ResizeObserver;
  private measureRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private measureRetryCount = 0;

  ngAfterViewInit(): void {
    const host = this.measureHost?.nativeElement;
    if (!host || typeof ResizeObserver === 'undefined') {
      this.scheduleLayoutRefresh();
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.refreshLayout();
    });
    this.resizeObserver.observe(host);
    this.refreshLayout();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.scheduleLayoutRefresh();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.measureRetryTimer) {
      clearTimeout(this.measureRetryTimer);
    }
  }

  trackDimSegment(_index: number, seg: { labelCm: number; sizePx: number }): string {
    return `${seg.labelCm}:${seg.sizePx}`;
  }

  private scheduleLayoutRefresh(): void {
    if (this.measureRetryTimer) {
      clearTimeout(this.measureRetryTimer);
    }
    this.measureRetryTimer = setTimeout(() => {
      this.measureRetryTimer = null;
      this.refreshLayout();
    }, 0);
  }

  private refreshLayout(): void {
    const host = this.measureHost?.nativeElement;
    if (!host) {
      return;
    }

    const containerWidthPx = host.clientWidth;
    const containerHeightPx = host.clientHeight;

    if (
      (containerWidthPx <= 0 || containerHeightPx <= 0) &&
      this.measureRetryCount < 8
    ) {
      this.measureRetryCount += 1;
      this.measureRetryTimer = setTimeout(() => {
        this.measureRetryTimer = null;
        this.refreshLayout();
      }, 120 * this.measureRetryCount);
      return;
    }

    this.measureRetryCount = 0;
    this.layout = computePhPrintPreviewLayout({
      containerWidthPx,
      containerHeightPx,
      baseWidthCm: this.baseWidthCm,
      baseHeightCm: this.baseHeightCm,
      marginCm: this.marginCm,
      cornerType: this.cornerType,
      cornerRadiusCm: this.cornerRadiusCm,
    });
  }
}
