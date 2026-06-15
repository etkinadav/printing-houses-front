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
import {
  buildMockupCropGuideSvgModel,
  buildMockupSlotClipPathCss,
  computeMockupSlotCornerRadiusPx,
  buildMockupPrintImageWarp,
  buildMockupQuadCropGuideSvgModel,
  computeMockupCoverCrop,
  mockupCoverCropHasExtensions,
  resolveMockupOuterWarpQuad,
  MockupCropGuideSvgModel,
  MockupPrintImageWarpModel,
  MockupQuadCornersPx,
} from '../ph-printing-files/ph-print-mockup-crop.util';
import { computePhPrintPreviewLayout } from '../ph-printing-files/ph-print-preview-layout.util';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-ph-print-mockup-preview',
  templateUrl: './ph-print-mockup-preview.component.html',
  styleUrls: ['./ph-print-mockup-preview.component.scss'],
})
export class PhPrintMockupPreviewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() mockup: PhMockup | null = null;
  @Input() printImageUrl: string | null = null;
  @Input() printImageWidthPx: number | null = null;
  @Input() printImageHeightPx: number | null = null;
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
  cropGuideSvg: MockupCropGuideSvgModel | null = null;
  printImageWarp: MockupPrintImageWarpModel | null = null;
  printSlotClipPathCss: string | null = null;
  /** Last pipeline snapshot — inspect in DevTools via `ng.getComponent($0).mockupPrintDebug` */
  mockupPrintDebug: Record<string, unknown> = {};

  private readonly mockupDebugEnabled = !environment.production;

  private resizeObserver?: ResizeObserver;
  private measureRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private measureRetryCount = 0;
  private imageMeasureRetryCount = 0;
  private resolvedImageWidthPx = 0;
  private resolvedImageHeightPx = 0;
  private printImageProbe?: HTMLImageElement;

  constructor(
    private hostRef: ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
  ) {}

  ngAfterViewInit(): void {
    this.syncPrintImageDimensions();
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

    if (
      changes['printImageUrl'] ||
      changes['printImageWidthPx'] ||
      changes['printImageHeightPx']
    ) {
      this.syncPrintImageDimensions();
      this.scheduleMeasureRefresh();
    }

    if (
      changes['baseWidthCm'] ||
      changes['baseHeightCm'] ||
      changes['marginCm'] ||
      changes['cornerType'] ||
      changes['cornerRadiusCm'] ||
      changes['foldingCount'] ||
      changes['foldingOffsetCm']
    ) {
      this.scheduleMeasureRefresh();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.measureRetryTimer) {
      clearTimeout(this.measureRetryTimer);
    }
    this.printImageProbe = undefined;
  }

  private syncPrintImageDimensions(): void {
    const inputWidthPx = Number(this.printImageWidthPx) || 0;
    const inputHeightPx = Number(this.printImageHeightPx) || 0;
    if (inputWidthPx > 0 && inputHeightPx > 0) {
      this.resolvedImageWidthPx = inputWidthPx;
      this.resolvedImageHeightPx = inputHeightPx;
      this.scheduleMeasureRefresh();
      return;
    }

    const imageUrl = this.printImageUrl?.trim() ?? '';
    if (!imageUrl) {
      this.resolvedImageWidthPx = 0;
      this.resolvedImageHeightPx = 0;
      this.scheduleMeasureRefresh();
      return;
    }

    const probe = new Image();
    this.printImageProbe = probe;
    probe.onload = () => {
      if (this.printImageProbe !== probe) {
        return;
      }
      this.resolvedImageWidthPx = probe.naturalWidth;
      this.resolvedImageHeightPx = probe.naturalHeight;
      this.scheduleMeasureRefresh();
      this.cdr.markForCheck();
    };
    probe.onerror = () => {
      if (this.printImageProbe !== probe) {
        return;
      }
      this.resolvedImageWidthPx = 0;
      this.resolvedImageHeightPx = 0;
      this.scheduleMeasureRefresh();
      this.cdr.markForCheck();
    };
    probe.src = imageUrl;
  }

  private getImageDimensionsForCrop(): { widthPx: number; heightPx: number } | null {
    const widthPx =
      Number(this.printImageWidthPx) ||
      this.resolvedImageWidthPx ||
      0;
    const heightPx =
      Number(this.printImageHeightPx) ||
      this.resolvedImageHeightPx ||
      0;
    if (widthPx <= 0 || heightPx <= 0) {
      return null;
    }
    return { widthPx, heightPx };
  }

  onMockupImageLoad(): void {
    this.mockupLoading = false;
    this.observeMockupFrame();
    this.scheduleMeasureRefresh();
  }

  get showPrintImageLayer(): boolean {
    return !!(
      this.cropGuideSvg &&
      this.printImageUrl?.trim() &&
      this.printSlotClipPathCss
    );
  }

  get showSheetFillLayer(): boolean {
    return !!(this.cropGuideSvg && this.printSlotClipPathCss);
  }

  get showAxisAlignedSheetFillLayer(): boolean {
    return this.showSheetFillLayer && !this.printImageWarp?.transform;
  }

  get showPerspectiveSheetFillLayer(): boolean {
    return !!(this.showSheetFillLayer && this.printImageWarp?.transform);
  }

  /** Stretch texture to the warp canvas like the print image (object-fit: fill). */
  get sheetFillStyles(): Record<string, string> {
    const styles = { ...this.sheetBackgroundStyles };
    if (styles['backgroundImage']) {
      return {
        ...styles,
        backgroundSize: '100% 100%',
        backgroundPosition: '0 0',
      };
    }
    return styles;
  }

  get showAxisAlignedPrintImageLayer(): boolean {
    return this.showPrintImageLayer && !this.printImageWarp?.transform;
  }

  get showPerspectivePrintImageLayer(): boolean {
    return !!(this.showPrintImageLayer && this.printImageWarp?.transform);
  }

  onPrintImageLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    this.debugMockup('print-image-loaded', {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      clientWidth: img.clientWidth,
      clientHeight: img.clientHeight,
    });
  }

  onPrintImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    this.debugMockup('print-image-error', {
      src: img.currentSrc || img.src,
    });
  }

  quadSlotGuidePoints(quad: MockupPrintOverlayQuad): string {
    return this.quadSlotGuidePointsInViewBox(quad, 100, 100);
  }

  quadSlotGuidePointsPx(quad: MockupPrintOverlayQuad): string {
    return this.quadSlotGuidePointsInViewBox(
      quad,
      this.printSlotWidthPx,
      this.printSlotHeightPx,
    );
  }

  private quadSlotGuidePointsInViewBox(
    quad: MockupPrintOverlayQuad,
    viewWidth: number,
    viewHeight: number,
  ): string {
    const box = quad.box;
    const toLocal = (point: { x: number; y: number }): string => {
      const x = box.width > 0 ? ((point.x - box.x) / box.width) * viewWidth : 0;
      const y = box.height > 0 ? ((point.y - box.y) / box.height) * viewHeight : 0;
      return `${x},${y}`;
    };
    return [quad.nw, quad.ne, quad.se, quad.sw].map(toLocal).join(' ');
  }

  private quadCornersPx(quad: MockupPrintOverlayQuad): MockupQuadCornersPx {
    const box = quad.box;
    const toLocal = (point: { x: number; y: number }): { x: number; y: number } => ({
      x: box.width > 0 ? ((point.x - box.x) / box.width) * this.printSlotWidthPx : 0,
      y: box.height > 0 ? ((point.y - box.y) / box.height) * this.printSlotHeightPx : 0,
    });
    return {
      nw: toLocal(quad.nw),
      ne: toLocal(quad.ne),
      se: toLocal(quad.se),
      sw: toLocal(quad.sw),
    };
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

    let nextSlotW = 0;
    let nextSlotH = 0;

    if (mockupImg && mockupImg.clientWidth > 0 && mockupImg.clientHeight > 0 && overlayBox) {
      nextSlotW = overlayBox.width * mockupImg.clientWidth;
      nextSlotH = overlayBox.height * mockupImg.clientHeight;
    } else {
      nextSlotW = printSlot?.clientWidth ?? 0;
      nextSlotH = printSlot?.clientHeight ?? 0;
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
    this.refreshCropGuides();
    this.cdr.detectChanges();
  }

  private refreshCropGuides(): void {
    const slotW = this.printSlotWidthPx;
    const slotH = this.printSlotHeightPx;
    if (
      slotW <= 0 ||
      slotH <= 0 ||
      this.layoutContainerWidthPx <= 0 ||
      this.layoutContainerHeightPx <= 0
    ) {
      this.cropGuideSvg = null;
      this.printImageWarp = null;
      this.printSlotClipPathCss = null;
      this.debugMockup('skip:invalid-measurements', {
        slotW,
        slotH,
        layoutContainerWidthPx: this.layoutContainerWidthPx,
        layoutContainerHeightPx: this.layoutContainerHeightPx,
      });
      return;
    }

    const layout = computePhPrintPreviewLayout({
      containerWidthPx: this.layoutContainerWidthPx,
      containerHeightPx: this.layoutContainerHeightPx,
      baseWidthCm: this.baseWidthCm,
      baseHeightCm: this.baseHeightCm,
      marginCm: this.marginCm,
      cornerType: this.cornerType,
      cornerRadiusCm: this.cornerRadiusCm,
      foldingCount: this.foldingCount,
      foldingOffsetCm: this.foldingOffsetCm,
      skipDimGutters: false,
      minContainerPx: 1,
    });

    if (!layout) {
      this.cropGuideSvg = null;
      this.printImageWarp = null;
      this.printSlotClipPathCss = null;
      this.debugMockup('skip:no-layout', { slotW, slotH });
      return;
    }

    const imageDims = this.getImageDimensionsForCrop();
    if (!imageDims) {
      this.cropGuideSvg = null;
      this.printImageWarp = null;
      this.printSlotClipPathCss = null;
      this.debugMockup('skip:no-image-dimensions', {
        printImageUrl: this.printImageUrl?.trim() ?? '',
        printImageWidthPx: this.printImageWidthPx,
        printImageHeightPx: this.printImageHeightPx,
        resolvedImageWidthPx: this.resolvedImageWidthPx,
        resolvedImageHeightPx: this.resolvedImageHeightPx,
        imageMeasureRetryCount: this.imageMeasureRetryCount,
      });
      if (this.printImageUrl?.trim() && this.imageMeasureRetryCount < 12) {
        this.imageMeasureRetryCount += 1;
        this.measureRetryTimer = setTimeout(() => {
          this.measureRetryTimer = null;
          this.syncPrintImageDimensions();
          this.refreshCropGuides();
          this.cdr.detectChanges();
        }, 100 * this.imageMeasureRetryCount);
      }
      return;
    }

    this.imageMeasureRetryCount = 0;

    const crop = computeMockupCoverCrop(
      imageDims.widthPx,
      imageDims.heightPx,
      layout.sheetWidthPx,
      layout.sheetHeightPx,
    );
    if (!crop) {
      this.cropGuideSvg = null;
      this.printImageWarp = null;
      this.printSlotClipPathCss = null;
      this.debugMockup('skip:no-crop', { imageDims, sheet: layout });
      return;
    }

    if (!mockupCoverCropHasExtensions(crop)) {
      this.cropGuideSvg = null;
      this.printImageWarp = null;
      this.printSlotClipPathCss = null;
      this.debugMockup('skip:no-crop-extensions', { crop });
      return;
    }

    this.cropGuideSvg = this.quadOverlay
      ? buildMockupQuadCropGuideSvgModel(
          this.quadCornersPx(this.quadOverlay),
          crop,
          slotW,
          slotH,
        )
      : buildMockupCropGuideSvgModel(crop, slotW, slotH);

    this.printSlotClipPathCss = this.cropGuideSvg
      ? buildMockupSlotClipPathCss(
          this.cropGuideSvg,
          this.cornerType,
          computeMockupSlotCornerRadiusPx(
            slotW,
            layout.cornerRadiusPx,
            layout.baseWidthPx,
          ),
        )
      : null;

    this.refreshPrintImageWarp(
      layout.sheetWidthPx,
      layout.sheetHeightPx,
      slotW,
      slotH,
      imageDims,
    );

    this.debugMockup('ready', {
      overlayKind: this.quadOverlay ? 'quad' : 'rect',
      slotW,
      slotH,
      sheetWidthPx: layout.sheetWidthPx,
      sheetHeightPx: layout.sheetHeightPx,
      imageDims,
      crop,
      printImageUrl: this.printImageUrl?.trim() ?? '',
      cropGuideSvg: this.cropGuideSvg,
      printImageWarp: this.printImageWarp,
      printSlotClipPathCss: this.printSlotClipPathCss,
      showAxisAlignedPrintImageLayer: this.showAxisAlignedPrintImageLayer,
      showPerspectivePrintImageLayer: this.showPerspectivePrintImageLayer,
    });
  }

  private refreshPrintImageWarp(
    sheetWidthPx: number,
    sheetHeightPx: number,
    slotWidthPx: number,
    slotHeightPx: number,
    imageDims: { widthPx: number; heightPx: number },
  ): void {
    const imageUrl = this.printImageUrl?.trim() ?? '';
    const guide = this.cropGuideSvg;
    const outerWarpQuad = guide ? resolveMockupOuterWarpQuad(guide) : null;
    if (!imageUrl || !outerWarpQuad) {
      this.printImageWarp = null;
      this.debugMockup('skip:warp-missing-input', {
        imageUrl,
        outerWarpQuad,
        guideHasOuterRect: !!guide?.outerRect,
        guideHasOuterPolygon: !!guide?.outerPolygonPoints,
        guideHasOuterWarpQuad: !!guide?.outerWarpQuad,
      });
      return;
    }

    this.printImageWarp = buildMockupPrintImageWarp(
      guide.widthPx,
      guide.heightPx,
      outerWarpQuad,
    );

    this.debugMockup('warp-built', {
      printImageWarp: this.printImageWarp,
      outerWarpQuad,
    });
  }

  private debugMockup(event: string, payload: Record<string, unknown>): void {
    const entry = { t: Date.now(), event, ...payload };
    this.mockupPrintDebug = entry;
    if (this.mockupDebugEnabled) {
      console.info(`[ph-mockup-preview] ${JSON.stringify(entry)}`);
    }
  }
}
