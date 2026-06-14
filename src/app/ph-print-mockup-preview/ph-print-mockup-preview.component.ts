import {
  AfterViewInit,
  ChangeDetectorRef,
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
import { CornerType, PhMockup } from '../ph-products/ph-product.model';
import {
  buildMockupPrintOverlay,
  isMockupPrintOverlayQuad,
  MockupPrintOverlay,
  MockupPrintOverlayQuad,
  MockupPrintOverlayRect,
} from '../ph-printing-files/ph-print-mockup.util';

@Component({
  selector: 'app-ph-print-mockup-preview',
  templateUrl: './ph-print-mockup-preview.component.html',
  styleUrls: ['./ph-print-mockup-preview.component.scss'],
})
export class PhPrintMockupPreviewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() mockup: PhMockup | null = null;
  @Input() printImageUrl: string | null = null;
  @Input() baseWidthCm = 0;
  @Input() baseHeightCm = 0;
  @Input() marginCm = 0;
  @Input() cornerType: CornerType | 'none' = 'none';
  @Input() cornerRadiusCm = 0;
  @Input() foldingCount = 0;
  @Input() foldingOffsetCm = 0;
  @Input() sheetBackgroundStyles: Record<string, string> = { backgroundColor: '#ffffff' };
  @Input() isRTL = false;
  @Input() isDarkMode = false;

  @ViewChildren('printSlot') printSlots?: QueryList<ElementRef<HTMLElement>>;
  @ViewChild('mockupFrame') mockupFrame?: ElementRef<HTMLElement>;

  mockupUrl = '';
  printOverlay: MockupPrintOverlay | null = null;
  rectOverlay: (MockupPrintOverlayRect & { kind: 'rect' }) | null = null;
  quadOverlay: (MockupPrintOverlayQuad & { kind: 'quad' }) | null = null;
  mockupLoading = true;

  layoutContainerWidthPx = 0;
  layoutContainerHeightPx = 0;
  printSlotWidthPx = 0;
  printSlotHeightPx = 0;

  private resizeObserver?: ResizeObserver;
  private measureRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private measureRetryCount = 0;

  constructor(
    private hostRef: ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
  ) {}

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') {
      this.scheduleMeasureRefresh();
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleMeasureRefresh();
    });
    this.resizeObserver.observe(this.hostRef.nativeElement);
    this.observePrintSlots();
    this.observeMockupFrame();
    this.printSlots?.changes.subscribe(() => {
      this.observePrintSlots();
      this.scheduleMeasureRefresh();
    });
    this.scheduleMeasureRefresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mockup']) {
      this.mockupUrl = this.mockup?.url?.trim() ?? '';
      this.printOverlay = this.mockup?.printArea
        ? buildMockupPrintOverlay(this.mockup.printArea)
        : null;
      this.rectOverlay =
        this.printOverlay && !isMockupPrintOverlayQuad(this.printOverlay)
          ? this.printOverlay
          : null;
      this.quadOverlay =
        this.printOverlay && isMockupPrintOverlayQuad(this.printOverlay)
          ? this.printOverlay
          : null;
      this.mockupLoading = !!this.mockupUrl;
      this.scheduleMeasureRefresh();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.measureRetryTimer) {
      clearTimeout(this.measureRetryTimer);
    }
  }

  onMockupImageLoad(): void {
    this.mockupLoading = false;
    this.observeMockupFrame();
    this.scheduleMeasureRefresh();
  }

  quadSlotGuidePoints(quad: MockupPrintOverlayQuad): string {
    const box = quad.box;
    const toLocal = (point: { x: number; y: number }): string => {
      const x = box.width > 0 ? ((point.x - box.x) / box.width) * 100 : 0;
      const y = box.height > 0 ? ((point.y - box.y) / box.height) * 100 : 0;
      return `${x},${y}`;
    };
    return [quad.nw, quad.ne, quad.se, quad.sw].map(toLocal).join(' ');
  }

  private observeMockupFrame(): void {
    const frame = this.mockupFrame?.nativeElement;
    if (frame) {
      this.resizeObserver?.observe(frame);
    }
  }

  private observePrintSlots(): void {
    const slots = this.printSlots?.toArray() ?? [];
    for (const slot of slots) {
      this.resizeObserver?.observe(slot.nativeElement);
    }
  }

  private scheduleMeasureRefresh(): void {
    if (this.measureRetryTimer) {
      clearTimeout(this.measureRetryTimer);
    }
    this.measureRetryTimer = setTimeout(() => {
      this.measureRetryTimer = null;
      this.refreshMeasurements();
    }, 0);
  }

  private refreshMeasurements(): void {
    const host = this.hostRef.nativeElement;
    const printSlot = this.printSlots?.first?.nativeElement;
    const mockupImg = this.mockupFrame?.nativeElement?.querySelector(
      '.ph-print-mockup-bg',
    ) as HTMLImageElement | null;

    const overlayBox = this.rectOverlay ?? this.quadOverlay?.box ?? null;

    let nextSlotW = printSlot?.clientWidth ?? 0;
    let nextSlotH = printSlot?.clientHeight ?? 0;

    if (mockupImg && mockupImg.clientWidth > 0 && mockupImg.clientHeight > 0 && overlayBox) {
      const derivedW = overlayBox.width * mockupImg.clientWidth;
      const derivedH = overlayBox.height * mockupImg.clientHeight;
      if (derivedW > 0) {
        nextSlotW = Math.max(nextSlotW, derivedW);
      }
      if (derivedH > 0) {
        nextSlotH = Math.max(nextSlotH, derivedH);
      }
    }

    const nextLayoutW = host.clientWidth;
    const nextLayoutH = host.clientHeight;

    if (
      (nextLayoutW <= 0 || nextLayoutH <= 0 || nextSlotW <= 0 || nextSlotH <= 0) &&
      this.mockupUrl &&
      this.measureRetryCount < 12
    ) {
      this.measureRetryCount += 1;
      this.measureRetryTimer = setTimeout(() => {
        this.measureRetryTimer = null;
        this.refreshMeasurements();
      }, 100 * this.measureRetryCount);
    } else {
      this.measureRetryCount = 0;
    }

    this.layoutContainerWidthPx = nextLayoutW;
    this.layoutContainerHeightPx = nextLayoutH;
    this.printSlotWidthPx = Math.round(nextSlotW);
    this.printSlotHeightPx = Math.round(nextSlotH);
    this.cdr.detectChanges();
  }
}
