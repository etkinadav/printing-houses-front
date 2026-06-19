import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  QueryList,
  SimpleChanges,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { CornerType } from '../ph-products/ph-product.model';
import {
  computePhPrintPreviewLayout,
  PH_PREVIEW_MAX_SHEET_HEIGHT_PX,
  PhPrintPreviewLayout,
} from '../ph-printing-files/ph-print-preview-layout.util';
import {
  MockupPrintOverlayQuad,
  MockupPrintOverlayRect,
} from '../ph-printing-files/ph-print-mockup.util';
import {
  PhCanvasDragPayload,
  PhCanvasPlacement,
  PhCanvasSideName,
} from '../ph-canvas/ph-canvas.model';
import { PhCanvasSheetComponent } from '../ph-canvas/ph-canvas-sheet.component';
import { PhCanvasInteractionService } from '../ph-canvas/ph-canvas-interaction.service';
import { PhPrintingFile } from '../ph-printing-files/ph-printing-file.model';

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
  /** Product color / texture — visible through transparent image areas. */
  @Input() sheetBackgroundStyles: Record<string, string> = { backgroundColor: '#ffffff' };
  @Input() isRTL = false;
  @Input() isDarkMode = false;
  /** Sheet only — no dim labels; fills parent (mockup print slot). */
  @Input() compactSheetOnly = false;
  /** When set (mockup embed), layout matches full preview pane — not the print slot. */
  @Input() layoutContainerWidthPx: number | null = null;
  @Input() layoutContainerHeightPx: number | null = null;
  /** Print-slot size on mockup — sheet is cover-scaled to fill this area. */
  @Input() printSlotWidthPx: number | null = null;
  @Input() printSlotHeightPx: number | null = null;
  /** Quad print area — perspective warp onto mockup surface. */
  @Input() mockupQuadOverlay: (MockupPrintOverlayQuad & { kind: 'quad' }) | null = null;
  @Input() mockupQuadBox: MockupPrintOverlayRect | null = null;

  /** Canvas mode: render interactive Fabric sheet(s) instead of a static image. */
  @Input() canvasMode = false;
  /** Sides to render ('front' or 'front'+'back' when double-sided). */
  @Input() canvasSides: PhCanvasSideName[] = ['front'];
  @Input() frontPlacements: PhCanvasPlacement[] = [];
  @Input() backPlacements: PhCanvasPlacement[] = [];
  @Input() canvasFiles: PhPrintingFile[] = [];
  @Input() canvasInteractive = true;
  /** Duplex pager: which side is visible (front / back). */
  @Input() activeDuplexSide: PhCanvasSideName = 'front';
  /** Layer panel selection — forwarded to the active canvas sheet. */
  @Input() selectedPlacementInstanceId: string | null = null;

  @Output() placementsChange = new EventEmitter<{
    side: PhCanvasSideName;
    placements: PhCanvasPlacement[];
  }>();
  @Output() placementSelectionChange = new EventEmitter<{
    side: PhCanvasSideName;
    instanceId: string | null;
  }>();

  @ViewChild('measureHost') measureHost?: ElementRef<HTMLElement>;
  @ViewChildren('preloadImage') preloadImages?: QueryList<ElementRef<HTMLImageElement>>;
  @ViewChildren(PhCanvasSheetComponent) canvasSheets?: QueryList<PhCanvasSheetComponent>;

  layout: PhPrintPreviewLayout | null = null;
  imageLoading = false;
  activeImageUrls: string[] = [];

  private resizeObserver?: ResizeObserver;
  private measureRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private measureRetryCount = 0;
  private imageLoadRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedImageUrls = new Set<string>();
  private trackedImageUrlsKey = '';
  constructor(
    private cdr: ChangeDetectorRef,
    private interactionService: PhCanvasInteractionService,
  ) {}

  get isDuplexStack(): boolean {
    return this.activeImageUrls.length > 1;
  }

  get visiblePreviewSide(): PhCanvasSideName {
    return this.isDuplexStack ? this.activeDuplexSide : 'front';
  }

  get visibleSheetImageUrl(): string {
    if (!this.activeImageUrls.length) {
      return '';
    }
    if (this.visiblePreviewSide === 'back' && this.activeImageUrls.length > 1) {
      return this.activeImageUrls[1];
    }
    return this.activeImageUrls[0];
  }

  get visibleIsDuplexFront(): boolean {
    return this.visiblePreviewSide === 'front';
  }

  get shouldShowPreviewBundle(): boolean {
    if (!this.layout || !this.activeImageUrls.length) {
      return false;
    }
    if (this.compactSheetOnly) {
      return true;
    }
    return !this.imageLoading;
  }

  /** Canvas sheet shadow follows rounded radius or chamfer/bleed clip-path. */
  get canvasShadowBorderRadiusPx(): number {
    const layout = this.layout;
    if (!layout) {
      return 8;
    }
    if (layout.imageBorderRadiusPx > 0) {
      return layout.imageBorderRadiusPx;
    }
    if (!layout.hasCornerShape) {
      return 8;
    }
    return 0;
  }

  ngAfterViewInit(): void {
    const host = this.measureHost?.nativeElement;
    if (!host || typeof ResizeObserver === 'undefined') {
      this.scheduleLayoutRefresh();
      this.scheduleImageLoadSync();
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleLayoutRefresh();
    });
    this.resizeObserver.observe(host);
    this.scheduleLayoutRefresh();
    if (this.canvasMode) {
      this.syncCanvasActiveSurfaces();
    } else {
      this.syncInteractionPagedSide();
      this.scheduleImageLoadSync();
      if (this.compactSheetOnly && this.imageUrl?.trim()) {
        this.beginImagesLoad();
      }
    }
  }

  /** Canvas mode: drive the duplex-stack layout from the number of sides. */
  private syncCanvasActiveSurfaces(): void {
    this.imageLoading = false;
    const sides = this.canvasSides?.length ? this.canvasSides : ['front'];
    // Reuse activeImageUrls length so the stacked layout renders one row per side.
    this.activeImageUrls = sides.map((side) => `canvas:${side}`);
    this.syncInteractionPagedSide();
    this.scheduleLayoutRefresh();
    this.cdr.markForCheck();
  }

  /** Pager duplex (front/back toggle): one visible sheet — not stacked hover routing. */
  private syncInteractionPagedSide(): void {
    if (!this.canvasMode) {
      this.interactionService.setPagedSide(null);
      return;
    }
    this.interactionService.setPagedSide(this.isDuplexStack ? this.activeDuplexSide : null);
  }

  placementsForSide(side: PhCanvasSideName): PhCanvasPlacement[] {
    return side === 'back' ? this.backPlacements : this.frontPlacements;
  }

  onSheetPlacementsChange(side: PhCanvasSideName, placements: PhCanvasPlacement[]): void {
    this.placementsChange.emit({ side, placements });
  }

  onCanvasSelectionChange(side: PhCanvasSideName, instanceId: string | null): void {
    this.placementSelectionChange.emit({ side, instanceId });
  }

  focusPlacementInstance(side: PhCanvasSideName, instanceId: string): void {
    const sheet = this.canvasSheets?.find((entry) => entry.side === side);
    void sheet?.selectByInstanceId(instanceId);
  }

  removePlacementInstance(side: PhCanvasSideName, instanceId: string): void {
    const sheet = this.canvasSheets?.find((entry) => entry.side === side);
    sheet?.removeByInstanceId(instanceId);
  }

  syncPlacementsFromParent(side: PhCanvasSideName, placements: PhCanvasPlacement[]): void {
    const sheet = this.canvasSheets?.find((entry) => entry.side === side);
    sheet?.applyExternalPlacements(placements);
  }

  addPageFromPayload(side: PhCanvasSideName, payload: PhCanvasDragPayload): void {
    const sheet = this.canvasSheets?.find((entry) => entry.side === side);
    void sheet?.addFromPayload(payload);
  }

  selectedInstanceIdForSide(side: PhCanvasSideName): string | null {
    return side === this.activeDuplexSide ? this.selectedPlacementInstanceId : null;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.canvasMode) {
      if (
        changes['canvasMode'] ||
        changes['canvasSides'] ||
        changes['frontPlacements'] ||
        changes['backPlacements'] ||
        changes['activeDuplexSide']
      ) {
        this.syncCanvasActiveSurfaces();
      }
    } else if (changes['imageUrl'] || changes['secondImageUrl'] || changes['activeDuplexSide']) {
      this.beginImagesLoad();
    }
    if (changes['canvasMode'] && this.canvasMode) {
      this.syncCanvasActiveSurfaces();
    }
    if (
      changes['baseWidthCm'] ||
      changes['baseHeightCm'] ||
      changes['marginCm'] ||
      changes['cornerType'] ||
      changes['cornerRadiusCm'] ||
      changes['foldingCount'] ||
      changes['foldingOffsetCm'] ||
      changes['compactSheetOnly'] ||
      changes['layoutContainerWidthPx'] ||
      changes['layoutContainerHeightPx'] ||
      changes['printSlotWidthPx'] ||
      changes['printSlotHeightPx'] ||
      changes['mockupQuadOverlay'] ||
      changes['mockupQuadBox']
    ) {
      this.scheduleLayoutRefresh();
    }
  }

  ngOnDestroy(): void {
    this.interactionService.setPagedSide(null);
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
      this.cdr.markForCheck();
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

  private scheduleImageLoadSync(): void {
    if (this.imageLoadRetryTimer) {
      clearTimeout(this.imageLoadRetryTimer);
    }
    this.imageLoadRetryTimer = setTimeout(() => {
      this.imageLoadRetryTimer = null;
      this.finishImageLoadIfCached();
    }, 0);
  }

  private syncImageLoadingState(): void {
    const expected = this.activeImageUrls;
    const nextLoading = expected.length
      ? !expected.every((url) => this.loadedImageUrls.has(url))
      : false;
    if (this.imageLoading === nextLoading) {
      return;
    }
    this.imageLoading = nextLoading;
    this.cdr.markForCheck();
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

    const useLayoutOverride =
      this.compactSheetOnly &&
      Number(this.layoutContainerWidthPx) > 0 &&
      Number(this.layoutContainerHeightPx) > 0;

    const slotWidthPx = Number(this.printSlotWidthPx) || host.clientWidth;
    const slotHeightPx = Number(this.printSlotHeightPx) || host.clientHeight;
    const slotReady = slotWidthPx >= 1 && slotHeightPx >= 1;

    let containerWidthPx: number;
    let containerHeightPx: number;
    let skipDimGutters = false;

    if (this.compactSheetOnly && useLayoutOverride) {
      // Same sheet layout as the normal preview pane (identical crop).
      containerWidthPx = Number(this.layoutContainerWidthPx);
      containerHeightPx = Number(this.layoutContainerHeightPx);
      skipDimGutters = false;
    } else if (this.compactSheetOnly && slotReady) {
      containerWidthPx = slotWidthPx;
      containerHeightPx = slotHeightPx;
      skipDimGutters = true;
    } else if (useLayoutOverride) {
      containerWidthPx = Number(this.layoutContainerWidthPx);
      containerHeightPx = Number(this.layoutContainerHeightPx);
      skipDimGutters = false;
    } else {
      containerWidthPx = host.clientWidth;
      containerHeightPx = host.clientHeight;
      skipDimGutters = this.compactSheetOnly;
    }

    const sizeToValidate = this.compactSheetOnly
      ? {
          w: useLayoutOverride ? containerWidthPx : slotReady ? slotWidthPx : containerWidthPx,
          h: useLayoutOverride ? containerHeightPx : slotReady ? slotHeightPx : containerHeightPx,
        }
      : { w: containerWidthPx, h: containerHeightPx };

    if (
      (sizeToValidate.w <= 0 || sizeToValidate.h <= 0) &&
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

    const nextLayout = computePhPrintPreviewLayout({
      containerWidthPx,
      containerHeightPx,
      baseWidthCm: this.baseWidthCm,
      baseHeightCm: this.baseHeightCm,
      marginCm: this.marginCm,
      cornerType: this.cornerType,
      cornerRadiusCm: this.cornerRadiusCm,
      foldingCount: this.foldingCount,
      foldingOffsetCm: this.foldingOffsetCm,
      skipDimGutters,
      minContainerPx: this.compactSheetOnly ? 1 : undefined,
      maxSheetHeightPx:
        this.canvasMode && !this.compactSheetOnly ? PH_PREVIEW_MAX_SHEET_HEIGHT_PX : undefined,
    });

    this.layout = nextLayout;
    this.cdr.markForCheck();
  }
}
