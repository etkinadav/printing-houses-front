import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  QueryList,
  SimpleChanges,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { CornerType } from '../ph-products/ph-product.model';
import {
  computePhPrintPreviewLayout,
  PH_PREVIEW_DUPLEX_STACK_GAP_PX,
  PhPrintPreviewLayout,
} from '../ph-printing-files/ph-print-preview-layout.util';

@Component({
  selector: 'app-ph-print-preview',
  templateUrl: './ph-print-preview.component.html',
  styleUrls: ['./ph-print-preview.component.scss'],
})
export class PhPrintPreviewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() imageUrl: string | null = null;
  /** Second page thumbnail when double-sided pairing preview is active. */
  @Input() secondImageUrl: string | null = null;
  @Input() baseWidthCm = 0;
  @Input() baseHeightCm = 0;
  /** Margin addition (duplex / תוספת שוליים) — not professional bleed. */
  @Input() marginCm = 0;
  @Input() cornerType: CornerType | 'none' = 'none';
  @Input() cornerRadiusCm = 0;
  @Input() foldingCount = 0;
  @Input() foldingOffsetCm = 0;
  @Input() isRTL = false;
  @Input() isDarkMode = false;

  @ViewChild('measureHost') measureHost?: ElementRef<HTMLElement>;
  @ViewChildren('preloadImage') preloadImages?: QueryList<ElementRef<HTMLImageElement>>;

  layout: PhPrintPreviewLayout | null = null;
  imageLoading = false;
  activeImageUrls: string[] = [];

  private resizeObserver?: ResizeObserver;
  private measureRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private measureRetryCount = 0;
  private imageLoadRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedImageUrls = new Set<string>();
  private trackedImageUrlsKey = '';

  get isDuplexStack(): boolean {
    return this.activeImageUrls.length > 1;
  }

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
    this.finishImageLoadIfCached();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['imageUrl'] || changes['secondImageUrl']) {
      this.beginImagesLoad();
    }
    this.scheduleLayoutRefresh();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.measureRetryTimer) {
      clearTimeout(this.measureRetryTimer);
    }
    if (this.imageLoadRetryTimer) {
      clearTimeout(this.imageLoadRetryTimer);
    }
  }

  trackImageUrl(_index: number, url: string): string {
    return url;
  }

  trackDimSegment(_index: number, seg: { labelCm: number; sizePx: number }): string {
    return `${seg.labelCm}:${seg.sizePx}`;
  }

  trackFoldLine(_index: number, line: { leftPx: number }): string {
    return String(line.leftPx);
  }

  onPreviewImageLoaded(url: string): void {
    this.loadedImageUrls.add(url);
    this.syncImageLoadingState();
  }

  private buildActiveImageUrls(): string[] {
    const front = this.imageUrl?.trim() || '';
    const back = this.secondImageUrl?.trim() || '';
    if (front && back) {
      return [front, back];
    }
    return front ? [front] : [];
  }

  private beginImagesLoad(): void {
    if (this.imageLoadRetryTimer) {
      clearTimeout(this.imageLoadRetryTimer);
      this.imageLoadRetryTimer = null;
    }

    const nextUrls = this.buildActiveImageUrls();
    const nextKey = nextUrls.join('\0');
    this.activeImageUrls = nextUrls;

    if (!nextUrls.length) {
      this.imageLoading = false;
      this.loadedImageUrls.clear();
      this.trackedImageUrlsKey = '';
      return;
    }

    if (nextKey !== this.trackedImageUrlsKey) {
      this.trackedImageUrlsKey = nextKey;
      this.imageLoading = true;
      this.loadedImageUrls.clear();
    }

    this.imageLoadRetryTimer = setTimeout(() => {
      this.imageLoadRetryTimer = null;
      this.finishImageLoadIfCached();
    }, 0);
  }

  private finishImageLoadIfCached(): void {
    const expected = this.activeImageUrls;
    if (!expected.length) {
      return;
    }

    const refs = this.preloadImages?.toArray() ?? [];
    for (let index = 0; index < refs.length && index < expected.length; index += 1) {
      const img = refs[index].nativeElement;
      if (img.complete && img.naturalWidth > 0) {
        this.loadedImageUrls.add(expected[index]);
      }
    }

    this.syncImageLoadingState();
  }

  private syncImageLoadingState(): void {
    const expected = this.activeImageUrls;
    if (!expected.length) {
      this.imageLoading = false;
      return;
    }
    this.imageLoading = !expected.every((url) => this.loadedImageUrls.has(url));
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

    const isDuplex = this.buildActiveImageUrls().length > 1;
    const layoutHeightPx = isDuplex
      ? Math.max(40, (containerHeightPx - PH_PREVIEW_DUPLEX_STACK_GAP_PX) / 2)
      : containerHeightPx;

    this.layout = computePhPrintPreviewLayout({
      containerWidthPx,
      containerHeightPx: layoutHeightPx,
      baseWidthCm: this.baseWidthCm,
      baseHeightCm: this.baseHeightCm,
      marginCm: this.marginCm,
      cornerType: this.cornerType,
      cornerRadiusCm: this.cornerRadiusCm,
      foldingCount: this.foldingCount,
      foldingOffsetCm: this.foldingOffsetCm,
    });
  }
}
