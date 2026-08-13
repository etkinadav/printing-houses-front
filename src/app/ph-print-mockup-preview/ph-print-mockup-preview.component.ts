import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
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
  buildDynamicMockupAdjustedPrintRectNorm,
  buildDynamicMockupAdjustedQuadCorners,
  buildDynamicMockupAdjustedQuadOverlay,
  collapsedAspectLayoutSpanNorm,
  computeDynamicMockupAspectSplit,
  DynamicMockupAspectSplit,
  DynamicMockupPrintRectNorm,
  mapNormPointToCollapsedAspectLayout,
  mapPrintRectToCollapsedAspectLayout,
} from '../ph-printing-files/ph-print-mockup-dynamic-aspect.util';
import { phCanvasProxiedImageUrl } from '../ph-canvas/ph-canvas.model';
import {
  mockupBodyTintKey,
  shouldTintMockupBody,
  tintMockupPng,
} from '../ph-printing-files/ph-print-mockup-body-tint.util';

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
  /**
   * Show crop/fold/print-area guide overlays (catalog mockup editing).
   * Hidden during normal order creation and on public catalog cards.
   */
  @Input() showLayoutGuides = false;

  readonly mockupCanvasPrintOpacity = MOCKUP_CANVAS_PRINT_OPACITY;

  dynamicAspectSplit: DynamicMockupAspectSplit | null = null;

  @ViewChildren('printSlot') printSlots?: QueryList<ElementRef<HTMLElement>>;
  @ViewChild('mockupFrame') mockupFrame?: ElementRef<HTMLElement>;

  mockupUrl = '';
  /** Mockup PNG after product color/texture recolor (opaque pixels only). */
  tintedMockupUrl = '';
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
  private tintToken = 0;
  private lastTintKey = '';
  private tintFailed = false;

  constructor(
    private hostRef: ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
  ) {}

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.dynamicDimensionsActive) {
      return;
    }
    this.scheduleMeasureRefresh();
  }

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
      const rawUrl = this.mockup?.url?.trim() ?? '';
      // Proxy remote mockup images so DOM→PNG capture is not CORS-tainted.
      this.mockupUrl = rawUrl ? phCanvasProxiedImageUrl(rawUrl) : '';
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
      this.tintedMockupUrl = '';
      this.lastTintKey = '';
      this.tintFailed = false;
      this.refreshMockupSimpleSlotOutline();
      this.scheduleMeasureRefresh();
      this.queueMockupBodyTint();
    }

    if (changes['sheetBackgroundStyles'] && !changes['mockup']) {
      this.queueMockupBodyTint();
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
    this.tintToken += 1;
    this.resizeObserver?.disconnect();
    if (this.measureRetryTimer) {
      clearTimeout(this.measureRetryTimer);
    }
    this.printImageProbe = undefined;
  }

  /** Displayed mockup: tinted PNG when a product color/texture is selected. */
  get displayMockupUrl(): string {
    if (this.tintedMockupUrl) {
      return this.tintedMockupUrl;
    }
    if (!this.needsMockupBodyTint || this.tintFailed) {
      return this.mockupUrl;
    }
    return '';
  }

  get needsMockupBodyTint(): boolean {
    return shouldTintMockupBody(this.sheetBackgroundStyles);
  }

  private queueMockupBodyTint(): void {
    const key = mockupBodyTintKey(this.mockupUrl, this.sheetBackgroundStyles);
    if (key === this.lastTintKey && (this.tintedMockupUrl || this.tintFailed || !this.needsMockupBodyTint)) {
      return;
    }
    this.lastTintKey = key;
    const token = ++this.tintToken;
    void this.rebuildMockupBodyTint(token);
  }

  private async rebuildMockupBodyTint(token: number): Promise<void> {
    if (!this.mockupUrl || !shouldTintMockupBody(this.sheetBackgroundStyles)) {
      this.tintedMockupUrl = '';
      this.tintFailed = false;
      return;
    }

    try {
      const url = await tintMockupPng(this.mockupUrl, this.sheetBackgroundStyles);
      if (token !== this.tintToken) {
        return;
      }
      this.tintedMockupUrl = url;
      this.tintFailed = false;
      this.cdr.detectChanges();
      this.scheduleMeasureRefresh();
    } catch {
      if (token !== this.tintToken) {
        return;
      }
      this.tintedMockupUrl = '';
      this.tintFailed = true;
      this.cdr.detectChanges();
    }
  }

  /**
   * Export the on-screen mockup simulation (product photo + warped composite)
   * as a PNG data URL — matches what the user sees in the print table.
   */
  async captureMockupFramePng(options?: { pixelRatio?: number }): Promise<string | null> {
    await this.waitUntilCaptureReady();
    const frame = this.mockupFrame?.nativeElement;
    if (!frame || frame.clientWidth < 2 || frame.clientHeight < 2) {
      return null;
    }

    const host = this.hostRef.nativeElement;
    host.classList.add('ph-print-mockup-host--capturing');
    this.cdr.detectChanges();

    try {
      // One paint after hiding guides.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const { toPng } = await import('html-to-image');
      return await toPng(frame, {
        pixelRatio: options?.pixelRatio ?? 2,
        cacheBust: true,
        // Prefer proxy-loaded assets; skip fonts that can hang capture.
        skipFonts: true,
      });
    } finally {
      host.classList.remove('ph-print-mockup-host--capturing');
      this.cdr.detectChanges();
    }
  }

  private async waitUntilCaptureReady(timeoutMs = 8000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const frame = this.mockupFrame?.nativeElement;
      const sized = !!frame && frame.clientWidth >= 2 && frame.clientHeight >= 2;
      if (!this.mockupLoading && sized && this.displayMockupUrl && this.printOverlay) {
        // Allow fold-strip / warp measure to settle after composite arrives.
        await new Promise<void>((resolve) => setTimeout(resolve, 120));
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
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
      this.activeQuadForPrintSlot,
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

  /** Shift top/left piece from near cut line to center line. */
  get aspectSplitTopTransform(): string | null {
    const split = this.dynamicAspectSplit;
    if (!split) {
      return null;
    }
    const shiftNorm = split.lineCenterNorm - split.bandLineNearNorm;
    if (split.lineOrientation === 'horizontal') {
      return `translateY(${shiftNorm * 100}%)`;
    }
    return `translateX(${shiftNorm * 100}%)`;
  }

  /** Shift bottom/right piece from far cut line to center line. */
  get aspectSplitBottomTransform(): string | null {
    const split = this.dynamicAspectSplit;
    if (!split) {
      return null;
    }
    const shiftNorm = split.bandLineFarNorm - split.lineCenterNorm;
    if (split.lineOrientation === 'horizontal') {
      return `translateY(-${shiftNorm * 100}%)`;
    }
    return `translateX(-${shiftNorm * 100}%)`;
  }

  /** Full mockup image size before collapsing empty aspect-split bands. */
  get aspectSplitBandHalfNorm(): number {
    const split = this.dynamicAspectSplit;
    if (!split) {
      return 0;
    }
    return split.lineCenterNorm - split.bandLineNearNorm;
  }

  get aspectSplitViewportWidthPx(): number {
    const split = this.dynamicAspectSplit;
    if (!split || this.mockupImageWidthPx <= 0) {
      return this.mockupImageWidthPx;
    }
    if (split.lineOrientation === 'horizontal') {
      return this.mockupImageWidthPx;
    }
    return this.mockupImageWidthPx * collapsedAspectLayoutSpanNorm(split);
  }

  get aspectSplitViewportHeightPx(): number {
    const split = this.dynamicAspectSplit;
    if (!split || this.mockupImageHeightPx <= 0) {
      return this.mockupImageHeightPx;
    }
    if (split.lineOrientation === 'vertical') {
      return this.mockupImageHeightPx;
    }
    return this.mockupImageHeightPx * collapsedAspectLayoutSpanNorm(split);
  }

  /** Shift full-size rejoined content so empty bands fall outside the viewport. */
  get aspectSplitContentOffsetTransform(): string | null {
    const split = this.dynamicAspectSplit;
    if (!split) {
      return null;
    }
    const band = this.aspectSplitBandHalfNorm;
    if (split.lineOrientation === 'horizontal') {
      return `translateY(${-band * this.mockupImageHeightPx}px)`;
    }
    return `translateX(${-band * this.mockupImageWidthPx}px)`;
  }

  /** Adjusted axis-aligned print area after dynamic aspect band removal. */
  get dynamicAspectAdjustedPrintRect(): DynamicMockupPrintRectNorm | null {
    const split = this.dynamicAspectSplit;
    const printRect = this.dynamicPrintRectNorm;
    if (!this.dynamicDimensionsActive || !split || !printRect || !this.rectOverlay) {
      return null;
    }
    const adjusted = buildDynamicMockupAdjustedPrintRectNorm(split, printRect);
    // Remap into collapsed viewport space (empty bands removed from layout).
    return mapPrintRectToCollapsedAspectLayout(split, adjusted);
  }

  /** Adjusted quad print outline (viewBox 0 0 100 100) in collapsed layout space. */
  get dynamicAspectAdjustedQuadPoints(): string | null {
    const split = this.dynamicAspectSplit;
    const quad = this.quadOverlay;
    if (!this.dynamicDimensionsActive || !split || !quad) {
      return null;
    }
    const corners = buildDynamicMockupAdjustedQuadCorners(split, quad);
    const collapsed = {
      nw: mapNormPointToCollapsedAspectLayout(split, corners.nw),
      ne: mapNormPointToCollapsedAspectLayout(split, corners.ne),
      sw: mapNormPointToCollapsedAspectLayout(split, corners.sw),
      se: mapNormPointToCollapsedAspectLayout(split, corners.se),
    };
    const fmt = (p: { x: number; y: number }) => `${p.x * 100},${p.y * 100}`;
    return `${fmt(collapsed.nw)} ${fmt(collapsed.ne)} ${fmt(collapsed.se)} ${fmt(collapsed.sw)}`;
  }

  /** Print slot rect — original or dynamically aspect-adjusted (collapsed layout). */
  get activePrintSlotRect(): DynamicMockupPrintRectNorm | null {
    if (this.dynamicAspectAdjustedPrintRect) {
      return this.dynamicAspectAdjustedPrintRect;
    }
    if (!this.rectOverlay) {
      return null;
    }
    return {
      x: this.rectOverlay.x,
      y: this.rectOverlay.y,
      width: this.rectOverlay.width,
      height: this.rectOverlay.height,
    };
  }

  /** Print slot quad — original or dynamically aspect-adjusted (collapsed layout). */
  get activeQuadForPrintSlot(): (MockupPrintOverlayQuad & { kind: 'quad' }) | null {
    const quad = this.quadOverlay;
    if (!quad) {
      return null;
    }
    const split = this.dynamicAspectSplit;
    if (this.dynamicDimensionsActive && split) {
      const adjusted = buildDynamicMockupAdjustedQuadOverlay(split, quad);
      const collapsedCorners = {
        nw: mapNormPointToCollapsedAspectLayout(split, adjusted.nw),
        ne: mapNormPointToCollapsedAspectLayout(split, adjusted.ne),
        sw: mapNormPointToCollapsedAspectLayout(split, adjusted.sw),
        se: mapNormPointToCollapsedAspectLayout(split, adjusted.se),
      };
      const xs = [
        collapsedCorners.nw.x,
        collapsedCorners.ne.x,
        collapsedCorners.sw.x,
        collapsedCorners.se.x,
      ];
      const ys = [
        collapsedCorners.nw.y,
        collapsedCorners.ne.y,
        collapsedCorners.sw.y,
        collapsedCorners.se.y,
      ];
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const box = {
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
      };
      const toLocal = (point: { x: number; y: number }) => {
        const lx = box.width > 0 ? ((point.x - box.x) / box.width) * 100 : 0;
        const ly = box.height > 0 ? ((point.y - box.y) / box.height) * 100 : 0;
        return `${lx}% ${ly}%`;
      };
      return {
        kind: 'quad',
        ...collapsedCorners,
        box,
        clipPath: `polygon(${[collapsedCorners.nw, collapsedCorners.ne, collapsedCorners.se, collapsedCorners.sw]
          .map(toLocal)
          .join(', ')})`,
      };
    }
    return quad;
  }

  get hasMockupPrintCorners(): boolean {
    const corners = this.mockup?.printCorners;
    return !!(
      corners?.enabled &&
      (corners.type === 'rounded' || corners.type === 'chamfer')
    );
  }

  get showSheetFillLayer(): boolean {
    // Product color/texture tints the mockup PNG itself — not a rectangle
    // behind the print slot.
    return false;
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

  /** Cover texture like the print image (object-fit: cover). */
  get sheetFillStyles(): Record<string, string> {
    const styles = { ...this.sheetBackgroundStyles };
    if (styles['backgroundImage']) {
      return {
        ...styles,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
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
      '.ph-print-mockup-bg:not(.ph-print-mockup-bg--aspect-split-overlay)',
    ) as HTMLImageElement | null;

    const previousSplit = this.dynamicAspectSplit;
    const naturalW = mockupImg?.naturalWidth || 0;
    const naturalH = mockupImg?.naturalHeight || 0;

    // Aspect-split math is aspect-ratio based — prefer intrinsic image size so
    // catalog card CSS constraints cannot skew the band relative to print-table.
    const aspectWidthPx = naturalW > 0 ? naturalW : this.mockupImageWidthPx;
    const aspectHeightPx = naturalH > 0 ? naturalH : this.mockupImageHeightPx;
    this.refreshDynamicAspectSplit(aspectWidthPx, aspectHeightPx);

    if (
      this.dynamicDimensionsActive &&
      this.dynamicAspectSplit &&
      naturalW > 0 &&
      naturalH > 0 &&
      host.clientWidth > 0 &&
      host.clientHeight > 0
    ) {
      // Aspect-split locks image size in px — refit to the host on every resize
      // so catalog cards re-render when the screen/grid width changes.
      this.fitMockupImageToHost(naturalW, naturalH, host.clientWidth, host.clientHeight);
    } else if (mockupImg && mockupImg.clientWidth > 0 && mockupImg.clientHeight > 0) {
      this.mockupImageWidthPx = mockupImg.clientWidth;
      this.mockupImageHeightPx = mockupImg.clientHeight;
    } else if (this.mockupImageWidthPx <= 0 || this.mockupImageHeightPx <= 0) {
      this.mockupImageWidthPx = 0;
      this.mockupImageHeightPx = 0;
    }

    const overlayBox = this.activePrintOverlayBox;
    let nextSlotW = 0;
    let nextSlotH = 0;

    // Slot % is relative to the visible frame. With aspect-split that frame is the
    // collapsed viewport (empty bands clipped out), not the full mockup image box.
    const layoutWidthPx = this.dynamicAspectSplit
      ? this.aspectSplitViewportWidthPx
      : this.mockupImageWidthPx;
    const layoutHeightPx = this.dynamicAspectSplit
      ? this.aspectSplitViewportHeightPx
      : this.mockupImageHeightPx;

    if (overlayBox && layoutWidthPx > 0 && layoutHeightPx > 0) {
      nextSlotW = overlayBox.width * layoutWidthPx;
      nextSlotH = overlayBox.height * layoutHeightPx;
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
    this.printSlotWidthPx = Math.round(nextSlotW);
    this.printSlotHeightPx = Math.round(nextSlotH);
    this.refreshCropGuides();
    this.cdr.detectChanges();

    // Switching into/out of aspect-split changes the DOM; remeasure next frame.
    const splitChanged = !!previousSplit !== !!this.dynamicAspectSplit;
    if (splitChanged && this.measureRetryCount === 0) {
      requestAnimationFrame(() => this.scheduleMeasureRefresh());
    }
  }

  /** Scale the full mockup image so the collapsed aspect-split viewport fits the host. */
  private fitMockupImageToHost(
    naturalW: number,
    naturalH: number,
    hostW: number,
    hostH: number,
  ): void {
    const split = this.dynamicAspectSplit;
    const span = split ? collapsedAspectLayoutSpanNorm(split) : 1;
    const layoutW = split?.lineOrientation === 'vertical' ? naturalW * span : naturalW;
    const layoutH = split?.lineOrientation === 'horizontal' ? naturalH * span : naturalH;
    if (layoutW <= 0 || layoutH <= 0) {
      return;
    }
    const scale = Math.min(hostW / layoutW, hostH / layoutH);
    this.mockupImageWidthPx = Math.max(1, naturalW * scale);
    this.mockupImageHeightPx = Math.max(1, naturalH * scale);
  }

  private refreshDynamicAspectSplit(aspectWidthPx?: number, aspectHeightPx?: number): void {
    const printRect = this.dynamicPrintRectNorm;
    if (!this.dynamicDimensionsActive || !printRect) {
      this.dynamicAspectSplit = null;
      return;
    }
    const widthPx = aspectWidthPx ?? this.mockupImageWidthPx;
    const heightPx = aspectHeightPx ?? this.mockupImageHeightPx;
    if (widthPx <= 0 || heightPx <= 0) {
      if (this.baseWidthCm <= 0 || this.baseHeightCm <= 0) {
        this.dynamicAspectSplit = null;
      }
      return;
    }
    this.dynamicAspectSplit = computeDynamicMockupAspectSplit(
      printRect,
      this.baseWidthCm,
      this.baseHeightCm,
      widthPx,
      heightPx,
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

  /** Print overlay box for slot sizing — uses adjusted geometry when active. */
  private get activePrintOverlayBox(): DynamicMockupPrintRectNorm | null {
    return this.activePrintSlotRect ?? this.activeQuadForPrintSlot?.box ?? null;
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

    // Cover the mockup *print slot* (not the abstract sheet layout). The composite
    // has the canvas/sheet aspect; the slot often differs — cropping against the
    // sheet made extensions zero and object-fit:fill then stretched the image.
    const crop = computeMockupCoverCrop(
      imageDims.widthPx,
      imageDims.heightPx,
      slotW,
      slotH,
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
    this.cropGuideSvg = this.activeQuadForPrintSlot
      ? buildMockupQuadCropGuideSvgModel(
          this.quadCornersPx(this.activeQuadForPrintSlot),
          crop,
          slotW,
          slotH,
        )
      : buildMockupCropGuideSvgModel(crop, slotW, slotH);

    const mockupPrintCorners = this.hasMockupPrintCorners
      ? this.mockup!.printCorners!
      : null;

    if (mockupPrintCorners && this.cropGuideSvg) {
      const activeQuad = this.activeQuadForPrintSlot;
      this.printSlotClipPathCss = buildMockupPrintCornersSlotClipPathCss(
        this.cropGuideSvg,
        mockupPrintCorners,
        activeQuad,
      );
      this.mockupSlotShapedOutlinePathD = buildMockupPrintCornersSlotOutlinePathD(
        this.cropGuideSvg,
        mockupPrintCorners,
        activeQuad,
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
      slotW,
      slotH,
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
        panel.stripCanvasLeftPx,
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
