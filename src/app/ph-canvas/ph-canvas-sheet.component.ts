import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { Canvas, FabricImage, FabricObject } from 'fabric';

import { PhPrintingFile } from '../ph-printing-files/ph-printing-file.model';
import {
  PhCanvasDragPayload,
  PhCanvasPlacement,
  PhCanvasSideName,
  PH_CANVAS_DRAG_MIME,
  phCanvasProxiedImageUrl,
} from './ph-canvas.model';

const PERSIST_DEBOUNCE_MS = 0;
/** Length (px) of each green L-bracket arm at the image corners. */
const FOCUS_CORNER_ARM_PX = 10;
const FOCUS_CORNER_STROKE_PX = 2;
const PLACEMENT_EPS = 0.0001;
/** Extra canvas margin so selected images and corner brackets can draw outside the sheet. */
const OVERFLOW_PAD_PX = 120;
/** Opacity for the focused image outside the printable sheet bounds. */
const FOCUS_OUTSIDE_OPACITY = 0.7;

type PhFabricImage = FabricObject & {
  phPlacement?: PhCanvasPlacement;
  _phOrigRender?: (ctx: CanvasRenderingContext2D) => void;
};

/**
 * Interactive Fabric.js sheet for one canvas side. Renders placed page-images,
 * accepts dropped pages, supports corner-only proportional resize/rotate, and
 * emits normalized placements. Sits between the background and chrome layers.
 */
@Component({
  selector: 'app-ph-canvas-sheet',
  templateUrl: './ph-canvas-sheet.component.html',
  styleUrls: ['./ph-canvas-sheet.component.scss'],
})
export class PhCanvasSheetComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() side: PhCanvasSideName = 'front';
  @Input() placements: PhCanvasPlacement[] = [];
  @Input() files: PhPrintingFile[] = [];
  /** Disable interaction (e.g. when the canvas is read-only). */
  @Input() interactive = true;

  @Output() placementsChange = new EventEmitter<PhCanvasPlacement[]>();

  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;
  @ViewChild('canvasEl', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  /** Internal source of truth — normalized placements rendered onto the canvas. */
  private model: PhCanvasPlacement[] = [];
  private canvas: Canvas | null = null;
  private resizeObserver?: ResizeObserver;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressEmit = false;
  private viewReady = false;
  private accentGreen = '';
  private modelNeedsPersistAfterRepair = false;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.initCanvas();
    this.observeResize();
    this.model = this.clonePlacements(this.placements);
    void this.syncObjectsFromModel();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) {
      return;
    }
    if (changes['placements']) {
      const incoming = this.placements ?? [];
      if (this.placementsEquivalent(incoming, this.model)) {
        return;
      }
      this.model = this.clonePlacements(incoming);
      void this.syncObjectsFromModel();
    }
    if (changes['interactive'] && this.canvas) {
      if (!this.interactive) {
        this.canvas.discardActiveObject();
      }
      this.applyInteractivity();
    }
  }

  ngOnDestroy(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.resizeObserver?.disconnect();
    this.canvas?.dispose();
    this.canvas = null;
  }

  private initCanvas(): void {
    const el = this.canvasRef.nativeElement;
    const { width, height } = this.measureHost();
    this.canvas = new Canvas(el, {
      width: Math.max(1, width),
      height: Math.max(1, height),
      selection: false,
      preserveObjectStacking: true,
      backgroundColor: 'transparent',
      // Always scale proportionally from the corners (no modifier override).
      uniformScaling: true,
    });
    // Prevent the uniform-scaling modifier key from toggling to free scaling.
    (this.canvas as unknown as { uniScaleKey: string | null }).uniScaleKey = null;

    this.canvas.on('object:modified', () => this.onObjectsChanged());
    this.canvas.on('object:moving', () => this.canvas?.requestRenderAll());
    this.canvas.on('object:scaling', () => this.canvas?.requestRenderAll());
    this.canvas.on('object:rotating', () => this.canvas?.requestRenderAll());
    this.bindFocusHandlers();
    this.refreshAccentGreen();
    this.applyInteractivity();
  }

  private bindFocusHandlers(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.on('mouse:down', (opt) => {
      if (!this.interactive) {
        return;
      }
      const target = opt.target as FabricObject | undefined;
      if (target) {
        this.canvas!.setActiveObject(target);
      } else {
        this.canvas!.discardActiveObject();
      }
      this.syncFocusChrome();
    });
    this.canvas.on('selection:created', () => this.syncFocusChrome());
    this.canvas.on('selection:updated', () => this.syncFocusChrome());
    this.canvas.on('selection:cleared', () => this.syncFocusChrome());
    this.canvas.on('after:render', (opt) => this.drawFocusCornerBrackets(opt.ctx));
  }

  private refreshAccentGreen(): void {
    this.accentGreen =
      getComputedStyle(this.hostRef.nativeElement).getPropertyValue('--zx-green').trim() ||
      '#26a69a';
  }

  /** Invisible Fabric controls only on the focused image; green L-brackets drawn in after:render. */
  private syncFocusChrome(): void {
    if (!this.canvas) {
      return;
    }
    const active = this.canvas.getActiveObject();
    for (const obj of this.canvas.getObjects()) {
      this.applyObjectControls(obj, obj === active);
    }
    this.canvas.requestRenderAll();
  }

  /**
   * Always draw the full image: 100% opacity inside the sheet, 70% outside.
   * Never clip — cover placements stay visible after refresh without selection.
   */
  private applySheetOverflowVisual(img: FabricImage): void {
    const extended = img as PhFabricImage;
    img.objectCaching = false;
    img.clipPath = undefined;

    if (extended._phOrigRender) {
      return;
    }
    extended._phOrigRender = img._render.bind(img);
    const orig = extended._phOrigRender;
    img._render = (ctx) => {
      const { pad, sheetW, sheetH } = this.getSheetMetrics();
      img.opacity = FOCUS_OUTSIDE_OPACITY;
      orig(ctx);
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad, pad, sheetW, sheetH);
      ctx.clip();
      img.opacity = 1;
      orig(ctx);
      ctx.restore();
    };
  }

  private getSheetMetrics(): {
    pad: number;
    sheetW: number;
    sheetH: number;
    canvasW: number;
    canvasH: number;
  } {
    const host = this.hostRef.nativeElement;
    const canvasW = host.clientWidth || 1;
    const canvasH = host.clientHeight || 1;
    return {
      pad: OVERFLOW_PAD_PX,
      sheetW: Math.max(1, canvasW - 2 * OVERFLOW_PAD_PX),
      sheetH: Math.max(1, canvasH - 2 * OVERFLOW_PAD_PX),
      canvasW,
      canvasH,
    };
  }

  private drawFocusCornerBrackets(ctx: CanvasRenderingContext2D): void {
    if (!this.canvas || !this.interactive) {
      return;
    }
    const active = this.canvas.getActiveObject();
    const coords = active?.aCoords;
    if (!active || !coords) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = this.accentGreen;
    ctx.lineWidth = FOCUS_CORNER_STROKE_PX;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    this.drawLCornerBracket(ctx, coords.tl, coords.tr, coords.bl);
    this.drawLCornerBracket(ctx, coords.tr, coords.tl, coords.br);
    this.drawLCornerBracket(ctx, coords.br, coords.bl, coords.tr);
    this.drawLCornerBracket(ctx, coords.bl, coords.br, coords.tl);

    ctx.restore();
  }

  /** L-shaped bracket at `corner`, arms extending `FOCUS_CORNER_ARM_PX` toward adjacent corners. */
  private drawLCornerBracket(
    ctx: CanvasRenderingContext2D,
    corner: { x: number; y: number },
    toward1: { x: number; y: number },
    toward2: { x: number; y: number },
  ): void {
    const v1 = this.unitVector(corner, toward1);
    const v2 = this.unitVector(corner, toward2);
    const arm = FOCUS_CORNER_ARM_PX;
    ctx.beginPath();
    ctx.moveTo(corner.x + v1.x * arm, corner.y + v1.y * arm);
    ctx.lineTo(corner.x, corner.y);
    ctx.lineTo(corner.x + v2.x * arm, corner.y + v2.y * arm);
    ctx.stroke();
  }

  private unitVector(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): { x: number; y: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  private applyInteractivity(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.selection = false;
    this.canvas.skipTargetFind = !this.interactive;
    this.syncFocusChrome();
  }

  private applyObjectControls(obj: FabricObject, focused = false): void {
    obj.selectable = this.interactive;
    obj.evented = this.interactive;
    obj.hasControls = this.interactive && focused;
    obj.hasBorders = false;
    obj.lockScalingFlip = true;
    obj.set({
      borderColor: 'transparent',
      cornerColor: 'transparent',
      cornerStrokeColor: 'transparent',
      transparentCorners: true,
    });
    obj.setControlsVisibility({
      mt: false,
      mb: false,
      ml: false,
      mr: false,
      tl: focused,
      tr: focused,
      bl: focused,
      br: focused,
      mtr: focused,
    });
  }

  private measureHost(): { width: number; height: number } {
    const { canvasW, canvasH } = this.getSheetMetrics();
    return { width: canvasW, height: canvasH };
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.hostRef.nativeElement);
  }

  private onResize(): void {
    if (!this.canvas) {
      return;
    }
    const { width, height } = this.measureHost();
    if (width < 1 || height < 1) {
      return;
    }
    this.canvas.setDimensions({ width, height });
    this.relayoutObjects();
  }

  /** Update geometry of existing Fabric objects from the normalized model (no image reload). */
  private relayoutObjects(): void {
    if (!this.canvas) {
      return;
    }
    const { width: W, height: H } = this.measureHost();
    for (const obj of this.canvas.getObjects() as PhFabricImage[]) {
      const placement = obj.phPlacement;
      if (!placement) {
        continue;
      }
      this.applyPlacementToImage(obj as FabricImage, placement);
    }
    this.canvas.requestRenderAll();
  }

  /**
   * Sync canvas objects with the model: update geometry in-place, load only new
   * images, remove deleted placements — never tear down the whole canvas.
   */
  private async syncObjectsFromModel(): Promise<void> {
    if (!this.canvas) {
      return;
    }
    this.suppressEmit = true;
    const activeKey = this.activePlacementKey();
    const ordered = [...this.model].sort((a, b) => a.zIndex - b.zIndex);
    const modelKeys = new Set(ordered.map((p) => this.placementKey(p)));

    const onCanvas = this.canvas.getObjects() as PhFabricImage[];
    const byKey = new Map<string, PhFabricImage>();
    for (const obj of onCanvas) {
      const p = obj.phPlacement;
      if (p) {
        byKey.set(this.placementKey(p), obj);
      }
    }

    for (const obj of [...onCanvas]) {
      const p = obj.phPlacement;
      if (p && !modelKeys.has(this.placementKey(p))) {
        this.canvas.remove(obj);
      }
    }

    for (const placement of ordered) {
      const key = this.placementKey(placement);
      const existing = byKey.get(key);
      if (existing && this.canvas.getObjects().includes(existing)) {
        const img = existing as FabricImage;
        const repaired = this.repairPlacementIfNeeded(
          placement,
          img.width || 1,
          img.height || 1,
        );
        this.applyPlacementToImage(img, repaired);
        this.applySheetOverflowVisual(img);
        existing.phPlacement = repaired;
        this.updateModelPlacement(placement, repaired);
        continue;
      }
      const url = this.resolveUrl(placement);
      if (!url) {
        continue;
      }
      try {
        const img = (await FabricImage.fromURL(url, {
          crossOrigin: 'anonymous',
        })) as PhFabricImage;
        const repaired = this.repairPlacementIfNeeded(
          placement,
          img.width || 1,
          img.height || 1,
        );
        this.applyPlacementToImage(img as FabricImage, repaired);
        this.applyObjectControls(img, false);
        this.applySheetOverflowVisual(img as FabricImage);
        img.phPlacement = repaired;
        this.updateModelPlacement(placement, repaired);
        this.canvas.add(img);
      } catch {
        // Ignore images that fail to load.
      }
    }

    const finalObjects = this.canvas.getObjects() as PhFabricImage[];
    ordered.forEach((placement, index) => {
      const obj = finalObjects.find(
        (candidate) =>
          candidate.phPlacement &&
          this.placementKey(candidate.phPlacement) === this.placementKey(placement),
      );
      if (obj) {
        this.canvas!.moveObjectTo(obj, index);
      }
    });

    if (activeKey) {
      const match = (this.canvas.getObjects() as PhFabricImage[]).find(
        (obj) => obj.phPlacement && this.placementKey(obj.phPlacement) === activeKey,
      );
      if (match) {
        this.canvas.setActiveObject(match);
      }
    }

    this.syncFocusChrome();
    this.suppressEmit = false;

    if (this.modelNeedsPersistAfterRepair) {
      this.modelNeedsPersistAfterRepair = false;
      this.emitChange();
    }
  }

  private placementKey(placement: PhCanvasPlacement): string {
    return `${placement.fileId}:${placement.imageId}`;
  }

  private activePlacementKey(): string | null {
    const active = this.canvas?.getActiveObject() as PhFabricImage | undefined;
    return active?.phPlacement ? this.placementKey(active.phPlacement) : null;
  }

  private placementsEquivalent(
    a: PhCanvasPlacement[],
    b: PhCanvasPlacement[],
  ): boolean {
    if (a.length !== b.length) {
      return false;
    }
    const sortedA = [...a].sort((left, right) => left.zIndex - right.zIndex);
    const sortedB = [...b].sort((left, right) => left.zIndex - right.zIndex);
    for (let index = 0; index < sortedA.length; index += 1) {
      const left = sortedA[index];
      const right = sortedB[index];
      if (
        left.fileId !== right.fileId ||
        left.imageId !== right.imageId ||
        left.page !== right.page ||
        left.zIndex !== right.zIndex
      ) {
        return false;
      }
      if (
        Math.abs(left.x - right.x) > PLACEMENT_EPS ||
        Math.abs(left.y - right.y) > PLACEMENT_EPS ||
        Math.abs(left.width - right.width) > PLACEMENT_EPS ||
        Math.abs(left.height - right.height) > PLACEMENT_EPS ||
        Math.abs((left.rotation || 0) - (right.rotation || 0)) > PLACEMENT_EPS
      ) {
        return false;
      }
    }
    return true;
  }

  private applyPlacementToImage(
    img: FabricImage,
    placement: PhCanvasPlacement,
  ): void {
    const { pad, sheetW, sheetH } = this.getSheetMetrics();
    const nW = img.width || 1;
    const nH = img.height || 1;
    const targetW = Math.max(1, placement.width * sheetW);
    const targetH = Math.max(1, placement.height * sheetH);
    const scaleW = targetW / nW;
    const scaleH = targetH / nH;
    const scale =
      Math.abs(scaleW - scaleH) < 0.01 ? scaleW : Math.max(scaleW, scaleH);
    img.set({
      originX: 'left',
      originY: 'top',
      left: placement.x * sheetW + pad,
      top: placement.y * sheetH + pad,
      scaleX: scale,
      scaleY: scale,
      angle: placement.rotation || 0,
    });
    img.setCoords();
  }

  /** Fix placements corrupted by legacy 0..1 clamping or old full-sheet squash. */
  private repairPlacementIfNeeded(
    placement: PhCanvasPlacement,
    imageWidthPx: number,
    imageHeightPx: number,
  ): PhCanvasPlacement {
    const { sheetW, sheetH } = this.getSheetMetrics();
    const nW = Math.max(1, imageWidthPx);
    const nH = Math.max(1, imageHeightPx);

    const isLegacySquash =
      Math.abs(placement.x) < PLACEMENT_EPS &&
      Math.abs(placement.y) < PLACEMENT_EPS &&
      Math.abs(placement.width - 1) < PLACEMENT_EPS &&
      Math.abs(placement.height - 1) < PLACEMENT_EPS;

    const boxAspect = (placement.width * sheetW) / (placement.height * sheetH);
    const imgAspect = nW / nH;
    const aspectMismatch =
      Number.isFinite(boxAspect) &&
      Number.isFinite(imgAspect) &&
      Math.abs(boxAspect - imgAspect) / imgAspect > 0.02;

    if (!isLegacySquash && !aspectMismatch) {
      return placement;
    }

    return {
      ...placement,
      ...this.computeInitialPlacementGeometry(nW, nH, sheetW, sheetH),
    };
  }

  private updateModelPlacement(
    previous: PhCanvasPlacement,
    next: PhCanvasPlacement,
  ): void {
    if (this.placementsEquivalent([previous], [next])) {
      return;
    }
    this.model = this.model.map((entry) => (entry === previous ? next : entry));
    this.modelNeedsPersistAfterRepair = true;
  }

  /**
   * Initial drop geometry: preserve aspect ratio; cover the sheet when the image is
   * larger than the sheet at 1:1 px, otherwise keep native pixel size (centered).
   */
  private computeInitialPlacementGeometry(
    imageWidthPx: number,
    imageHeightPx: number,
    sheetWidthPx: number,
    sheetHeightPx: number,
  ): Pick<PhCanvasPlacement, 'x' | 'y' | 'width' | 'height'> {
    const nW = Math.max(1, imageWidthPx);
    const nH = Math.max(1, imageHeightPx);
    const sheetW = Math.max(1, sheetWidthPx);
    const sheetH = Math.max(1, sheetHeightPx);

    const fitsAtNativeSize = nW <= sheetW && nH <= sheetH;
    if (fitsAtNativeSize) {
      const displayW = nW;
      const displayH = nH;
      return {
        x: (sheetW - displayW) / 2 / sheetW,
        y: (sheetH - displayH) / 2 / sheetH,
        width: displayW / sheetW,
        height: displayH / sheetH,
      };
    }

    const scale = Math.max(sheetW / nW, sheetH / nH);
    const displayW = nW * scale;
    const displayH = nH * scale;
    return {
      x: (sheetW - displayW) / 2 / sheetW,
      y: (sheetH - displayH) / 2 / sheetH,
      width: displayW / sheetW,
      height: displayH / sheetH,
    };
  }

  private async resolveImagePixelSize(
    payload: PhCanvasDragPayload,
  ): Promise<{ nW: number; nH: number }> {
    const probePlacement: PhCanvasPlacement = {
      fileId: payload.fileId,
      imageId: payload.imageId,
      page: payload.page ?? 1,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      zIndex: 0,
    };
    const url = this.resolveUrl(probePlacement);
    if (url) {
      try {
        const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
        return { nW: img.width || 1, nH: img.height || 1 };
      } catch {
        // Fall back to metadata from the drag payload.
      }
    }
    const metaW = Number(payload.imageWidth);
    const metaH = Number(payload.imageHeight);
    if (Number.isFinite(metaW) && metaW > 0 && Number.isFinite(metaH) && metaH > 0) {
      return { nW: metaW, nH: metaH };
    }
    return { nW: 1, nH: 1 };
  }

  private resolveUrl(placement: PhCanvasPlacement): string | null {
    const file = this.files.find((f) => f._id === placement.fileId);
    const image = file?.images?.find((im) => im._id === placement.imageId);
    const url = image?.thumbnailUrl?.trim();
    return url ? phCanvasProxiedImageUrl(url) : null;
  }

  // --- Drag & drop -----------------------------------------------------------

  onDragOver(event: DragEvent): void {
    if (!this.interactive) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  async onDrop(event: DragEvent): Promise<void> {
    if (!this.interactive) {
      return;
    }
    event.preventDefault();
    const payload = this.readDragPayload(event);
    if (!payload) {
      return;
    }
    await this.addPlacement(payload);
  }

  private readDragPayload(event: DragEvent): PhCanvasDragPayload | null {
    const raw =
      event.dataTransfer?.getData(PH_CANVAS_DRAG_MIME) ||
      event.dataTransfer?.getData('text/plain') ||
      '';
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as PhCanvasDragPayload;
      if (parsed?.fileId && parsed?.imageId) {
        return parsed;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /** Add a new placement, sized to cover the sheet or at native px size, then persist. */
  private async addPlacement(payload: PhCanvasDragPayload): Promise<void> {
    const nextZ = this.model.reduce((max, p) => Math.max(max, p.zIndex), -1) + 1;
    const { sheetW, sheetH } = this.getSheetMetrics();
    const { nW, nH } = await this.resolveImagePixelSize(payload);
    const geometry = this.computeInitialPlacementGeometry(nW, nH, sheetW, sheetH);
    const placement: PhCanvasPlacement = {
      fileId: payload.fileId,
      imageId: payload.imageId,
      page: payload.page ?? 1,
      ...geometry,
      rotation: 0,
      zIndex: nextZ,
    };
    this.model = [...this.model, placement];
    await this.syncObjectsFromModel();
    const added = (this.canvas?.getObjects() as PhFabricImage[]).find(
      (obj) => obj.phPlacement && this.placementKey(obj.phPlacement) === this.placementKey(placement),
    );
    if (added) {
      this.canvas!.setActiveObject(added);
      this.syncFocusChrome();
    }
    this.emitChange();
  }

  /** Remove the currently active object. */
  removeActive(): void {
    if (!this.canvas) {
      return;
    }
    const active = this.canvas.getActiveObject() as
      | (FabricObject & { phPlacement?: PhCanvasPlacement })
      | undefined;
    if (!active?.phPlacement) {
      return;
    }
    this.model = this.model.filter((p) => p !== active!.phPlacement);
    this.canvas.remove(active);
    this.canvas.discardActiveObject();
    this.syncFocusChrome();
    this.emitChange();
  }

  // --- Change capture --------------------------------------------------------

  private onObjectsChanged(): void {
    if (this.suppressEmit || !this.canvas) {
      return;
    }
    const { pad, sheetW, sheetH } = this.getSheetMetrics();
    const objects = this.canvas.getObjects() as Array<
      FabricObject & { phPlacement?: PhCanvasPlacement }
    >;
    const next: PhCanvasPlacement[] = [];
    objects.forEach((obj, index) => {
      const base = obj.phPlacement;
      if (!base) {
        return;
      }
      const scaledW = obj.getScaledWidth();
      const scaledH = obj.getScaledHeight();
      const updated: PhCanvasPlacement = {
        ...base,
        x: ((obj.left ?? 0) - pad) / sheetW,
        y: ((obj.top ?? 0) - pad) / sheetH,
        width: scaledW / sheetW,
        height: scaledH / sheetH,
        rotation: obj.angle ?? 0,
        zIndex: index,
      };
      obj.phPlacement = updated;
      next.push(updated);
    });
    this.model = next;
    this.emitChange();
  }

  private emitChange(): void {
    if (PERSIST_DEBOUNCE_MS > 0) {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
      }
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        this.placementsChange.emit(this.clonePlacements(this.model));
      }, PERSIST_DEBOUNCE_MS);
      return;
    }
    this.placementsChange.emit(this.clonePlacements(this.model));
  }

  private clonePlacements(list: PhCanvasPlacement[]): PhCanvasPlacement[] {
    return (list ?? []).map((p) => ({ ...p }));
  }
}
