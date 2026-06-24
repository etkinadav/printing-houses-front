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
  buildMockupPrintCornersSlotClipPathCss,
  buildMockupPrintCornersSlotOutlinePathD,
  buildMockupPrintCornersSimpleSlotOutlinePathD,
  computeMockupSlotCornerRadiusPx,
  buildMockupPrintImageWarp,
  buildMockupQuadCropGuideSvgModel,
  computeMockupCoverCrop,
  resolveMockupOuterWarpQuad,
  MockupCropGuideSvgModel,
  MockupPrintImageWarpModel,
  MockupQuadCornersPx,
} from '../ph-printing-files/ph-print-mockup-crop.util';
import { computePhPrintPreviewLayout } from '../ph-printing-files/ph-print-preview-layout.util';
import {
  buildPrintMockupFoldingModel,
  PhPrintMockupFoldingModel,
} from '../ph-printing-files/ph-print-mockup-folding.util';
import { cropCompositeStripToDataUrl } from '../ph-printing-files/ph-print-mockup-fold-strip.util';
import {
  computeDynamicMockupAspectSplit,
  DynamicMockupAspectSplit,
} from '../ph-printing-files/ph-print-mockup-dynamic-aspect.util';

/** Canvas-composite print opacity in mockup (0.8 = 20% transparent). */
export const MOCKUP_CANVAS_PRINT_OPACITY = 0.8;

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
  /** Free-form product dimensions — apply mockup/print aspect correction. */
  @Input() dynamicDimensionsActive = false;

  readonly mockupCanvasPrintOpacity = MOCKUP_CANVAS_PRINT_OPACITY;

  dynamicAspectSplit: DynamicMockupAspectSplit | null = null;

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
  mockupImageWidthPx = 0;
  mockupImageHeightPx = 0;
  cropGuideSvg: MockupCropGuideSvgModel | null = null;
  printImageWarp: MockupPrintImageWarpModel | null = null;
  printSlotClipPathCss: string | null = null;
  mockupSlotShapedOutlinePathD: string | null = null;
  mockupSimpleSlotShapedOutlinePathD: string | null = null;
  foldingModel: PhPrintMockupFoldingModel | null = null;
  /** Pre-cropped preview strip per fold panel (canvas px → PNG data URL). */
  foldPanelStripUrls: ReadonlyArray<string | null> = [];

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
      this.refreshMockupSimpleSlotOutline();
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
      changes['foldingOffsetCm'] ||
      changes['dynamicDimensionsActive']
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
      this.refreshFoldPanelStripUrls();
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
    this.refreshMockupSimpleSlotOutline();
    this.scheduleMeasureRefresh();
  }

  private refreshMockupSimpleSlotOutline(): void {
    if (!this.hasMockupPrintCorners || this.cropGuideSvg) {
      this.mockupSimpleSlotShapedOutlinePathD = null;
      return;
    }

    this.mockupSimpleSlotShapedOutlinePathD = buildMockupPrintCornersSimpleSlotOutlinePathD(
      this.mockup!.printCorners!,
      this.quadOverlay,
    );
  }

  get showPrintImageLayer(): boolean {
    return !!(
      this.cropGuideSvg &&
      this.printImageUrl?.trim() &&
      this.printSlotClipPathCss
    );
  }

  get showFoldedPrintLayers(): boolean {
    return !!(this.foldingModel?.panels.length && this.cropGuideSvg);
  }

  get showSinglePrintImageLayer(): boolean {
    return this.showPrintImageLayer && !this.showFoldedPrintLayers;
  }

  get showSingleAxisAlignedPrintImageLayer(): boolean {
    return this.showAxisAlignedPrintImageLayer && !this.showFoldedPrintLayers;
  }

  get showSinglePerspectivePrintImageLayer(): boolean {
    return this.showPerspectivePrintImageLayer && !this.showFoldedPrintLayers;
  }

  get foldingStageStyle(): Record<string, string> {
    const slot = this.cropGuideSvg?.slotRect;
    if (slot) {
      return {
        left: `${slot.x}px`,
        top: `${slot.y}px`,
        width: `${slot.width}px`,
        height: `${slot.height}px`,
      };
    }
    return {
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
    };
  }

  get foldingOverlayViewBox(): string {
    return `0 0 ${this.printSlotWidthPx} ${this.printSlotHeightPx}`;
  }

  /** Top/left piece — bottom/right clipped at the near band line. */
  get aspectSplitTopClipPath(): string | null {
    const split = this.dynamicAspectSplit;
    if (!split) {
      return null;
    }
    if (split.lineOrientation === 'horizontal') {
      const clipBottomPct = (1 - split.bandLineNearNorm) * 100;
      return `inset(0 0 ${clipBottomPct}% 0)`;
    }
    const clipRightPct = (1 - split.bandLineNearNorm) * 100;
    return `inset(0 ${clipRightPct}% 0 0)`;
  }

  /** Bottom/right piece — top/left clipped at the far band line. */
  get aspectSplitBottomClipPath(): string | null {
    const split = this.dynamicAspectSplit;
    if (!split) {
      return null;
    }
    if (split.lineOrientation === 'horizontal') {
      const clipTopPct = split.bandLineFarNorm * 100;
      return `inset(${clipTopPct}% 0 0 0)`;
    }
    const clipLeftPct = split.bandLineFarNorm * 100;
    return `inset(0 0 0 ${clipLeftPct}%)`;
  }

  get hasMockupPrintCorners(): boolean {
    const corners = this.mockup?.printCorners;
    return !!(
      corners?.enabled &&
      (corners.type === 'rounded' || corners.type === 'chamfer')
    );
  }

  get showSheetFillLayer(): boolean {
    return !!(this.cropGuideSvg && this.printSlotClipPathCss);
  }

  get showAxisAlignedSheetFillLayer(): boolean {
    return this.showSheetFillLayer && !this.hasPerspectiveImageWarp;
  }

  /** Solid paper color — no texture warp needed (clip-path only). */
  get isSolidSheetFill(): boolean {
    const bgImage = this.sheetBackgroundStyles['backgroundImage'];
    return !bgImage || bgImage === 'none';
  }

  get showPerspectiveSolidSheetFillLayer(): boolean {
    return !!(
      this.showSheetFillLayer &&
      !this.showFoldedPrintLayers &&
      this.hasPerspectiveImageWarp &&
      this.isSolidSheetFill
    );
  }

  get showPerspectiveWarpedSheetFillLayer(): boolean {
    return !!(
      this.showSheetFillLayer &&
      !this.showFoldedPrintLayers &&
      this.hasPerspectiveImageWarp &&
      !this.isSolidSheetFill
    );
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
    return this.showPrintImageLayer && !this.hasPerspectiveImageWarp;
  }

  get showPerspectivePrintImageLayer(): boolean {
    return !!(this.showPrintImageLayer && this.hasPerspectiveImageWarp);
  }

  get hasPerspectiveImageWarp(): boolean {
    return !!(this.printImageWarp?.slices?.length);
  }

  trackFoldPanel = (_index: number, panel: { index: number }): number => panel.index;

  trackFoldSlice = (
    index: number,
    slice: { srcTopPx: number; zIndex: number },
  ): number => slice.zIndex * 100000 + Math.round(slice.srcTopPx * 100) + index;

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

    if (mockupImg && mockupImg.clientWidth > 0 && mockupImg.clientHeight > 0) {
      this.mockupImageWidthPx = mockupImg.clientWidth;
      this.mockupImageHeightPx = mockupImg.clientHeight;
      if (overlayBox) {
        nextSlotW = overlayBox.width * mockupImg.clientWidth;
        nextSlotH = overlayBox.height * mockupImg.clientHeight;
      }
    } else if (this.mockupImageWidthPx <= 0 || this.mockupImageHeightPx <= 0) {
      this.mockupImageWidthPx = 0;
      this.mockupImageHeightPx = 0;
      nextSlotW = printSlot?.clientWidth ?? 0;
      nextSlotH = printSlot?.clientHeight ?? 0;
    } else if (overlayBox) {
      nextSlotW = overlayBox.width * this.mockupImageWidthPx;
      nextSlotH = overlayBox.height * this.mockupImageHeightPx;
    } else {
      nextSlotW = printSlot?.clientWidth ?? 0;
      nextSlotH = printSlot?.clientHeight ?? 0;
    }

    const nextLayoutW = host.clientWidth;
    const nextLayoutH = host.clientHeight;

    if (
      (nextLayoutW <= 0 ||
        nextLayoutH <= 0 ||
        nextSlotW <= 0 ||
        nextSlotH <= 0 ||
        this.mockupImageWidthPx <= 0 ||
        this.mockupImageHeightPx <= 0) &&
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
    this.refreshDynamicAspectSplit();

    this.printSlotWidthPx = Math.round(nextSlotW);
    this.printSlotHeightPx = Math.round(nextSlotH);
    this.refreshCropGuides();
    this.cdr.detectChanges();
  }

  private refreshDynamicAspectSplit(): void {
    const printRect = this.dynamicPrintRectNorm;
    if (!this.dynamicDimensionsActive || !printRect) {
      this.dynamicAspectSplit = null;
      return;
    }
    if (this.mockupImageWidthPx <= 0 || this.mockupImageHeightPx <= 0) {
      return;
    }
    this.dynamicAspectSplit = computeDynamicMockupAspectSplit(
      printRect,
      this.baseWidthCm,
      this.baseHeightCm,
      this.mockupImageWidthPx,
      this.mockupImageHeightPx,
    );
  }

  /** Axis-aligned print rect used for dynamic aspect guide (rect or quad bounding box). */
  private get dynamicPrintRectNorm(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    if (this.rectOverlay) {
      return {
        x: this.rectOverlay.x,
        y: this.rectOverlay.y,
        width: this.rectOverlay.width,
        height: this.rectOverlay.height,
      };
    }
    const box = this.quadOverlay?.box;
    if (!box?.width || !box?.height) {
      return null;
    }
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
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
      this.mockupSlotShapedOutlinePathD = null;
      this.foldingModel = null;
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
      this.mockupSlotShapedOutlinePathD = null;
      this.foldingModel = null;
      return;
    }

    const imageDims = this.getImageDimensionsForCrop();
    if (!imageDims) {
      this.cropGuideSvg = null;
      this.printImageWarp = null;
      this.printSlotClipPathCss = null;
      this.mockupSlotShapedOutlinePathD = null;
      this.foldingModel = null;
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
      this.mockupSlotShapedOutlinePathD = null;
      this.foldingModel = null;
      return;
    }

    // Always build the crop-guide model even when the image exactly fills the slot
    // (no extensions). This ensures printSlotClipPathCss is set, the print image
    // layer renders, and for perspective (quad) mockups the 3-D warp is still applied.
    this.cropGuideSvg = this.quadOverlay
      ? buildMockupQuadCropGuideSvgModel(
          this.quadCornersPx(this.quadOverlay),
          crop,
          slotW,
          slotH,
        )
      : buildMockupCropGuideSvgModel(crop, slotW, slotH);

    const mockupPrintCorners = this.hasMockupPrintCorners
      ? this.mockup!.printCorners!
      : null;

    if (mockupPrintCorners && this.cropGuideSvg) {
      this.printSlotClipPathCss = buildMockupPrintCornersSlotClipPathCss(
        this.cropGuideSvg,
        mockupPrintCorners,
        this.quadOverlay,
      );
      this.mockupSlotShapedOutlinePathD = buildMockupPrintCornersSlotOutlinePathD(
        this.cropGuideSvg,
        mockupPrintCorners,
        this.quadOverlay,
      );
    } else {
      this.mockupSlotShapedOutlinePathD = null;
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
    }

    this.refreshPrintImageWarp(
      layout.sheetWidthPx,
      layout.sheetHeightPx,
      slotW,
      slotH,
      imageDims,
    );
    this.refreshFoldingModel(layout.baseWidthPx);
    this.refreshFoldPanelStripUrls();
    this.refreshMockupSimpleSlotOutline();
  }

  private refreshFoldPanelStripUrls(): void {
    const folding = this.foldingModel;
    const imageUrl = this.printImageUrl?.trim() ?? '';
    if (!folding?.panels.length || !imageUrl) {
      this.foldPanelStripUrls = [];
      return;
    }

    const probe = this.printImageProbe;
    if (
      !probe?.complete ||
      probe.naturalWidth <= 0 ||
      probe.naturalHeight <= 0 ||
      probe.src !== imageUrl
    ) {
      this.foldPanelStripUrls = folding.panels.map(() => null);
      return;
    }

    this.foldPanelStripUrls = folding.panels.map((panel) =>
      cropCompositeStripToDataUrl(
        probe,
        folding.canvasWidthPx,
        folding.canvasHeightPx,
        folding.slotOffsetLeftPx + panel.stripLeftPx,
        folding.slotOffsetTopPx,
        panel.stripWidthPx,
        panel.stripHeightPx,
      ),
    );
  }

  private refreshFoldingModel(baseWidthPx: number): void {
    if (
      !this.mockup?.printArea ||
      !this.printOverlay ||
      this.printSlotWidthPx <= 0 ||
      this.printSlotHeightPx <= 0 ||
      this.foldingCount <= 0 ||
      this.baseWidthCm <= 0
    ) {
      this.foldingModel = null;
      this.foldPanelStripUrls = [];
      return;
    }

    this.foldingModel = buildPrintMockupFoldingModel(
      this.mockup,
      this.printOverlay,
      this.printSlotWidthPx,
      this.printSlotHeightPx,
      this.foldingCount,
      this.foldingOffsetCm,
      baseWidthPx,
      this.baseWidthCm,
      {
        canvasWidthPx: this.cropGuideSvg?.widthPx ?? this.printSlotWidthPx,
        canvasHeightPx: this.cropGuideSvg?.heightPx ?? this.printSlotHeightPx,
        slotOffsetLeftPx: this.cropGuideSvg?.slotRect.x ?? 0,
        slotOffsetTopPx: this.cropGuideSvg?.slotRect.y ?? 0,
        slotWidthPx: this.cropGuideSvg?.slotRect.width ?? this.printSlotWidthPx,
        slotHeightPx: this.cropGuideSvg?.slotRect.height ?? this.printSlotHeightPx,
      },
    );
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
      return;
    }

    this.printImageWarp = buildMockupPrintImageWarp(
      guide.widthPx,
      guide.heightPx,
      outerWarpQuad,
    );
  }
}
