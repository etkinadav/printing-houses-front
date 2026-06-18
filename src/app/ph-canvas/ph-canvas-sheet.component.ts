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
import { Subscription } from 'rxjs';
import { Canvas, FabricImage, FabricObject } from 'fabric';

import { PhPrintingFile } from '../ph-printing-files/ph-printing-file.model';
import { PhCanvasInteractionService } from './ph-canvas-interaction.service';
import {
  applySheetClipToContext,
  createFabricSheetClip,
  getSheetClipRect,
  resolveSheetClipSpec,
  sheetClipSpecKey,
} from './ph-canvas-sheet-clip.util';
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
const OVERFLOW_PAD_MAX_PX = 2400;
/** Opacity for the focused image outside the printable sheet bounds. */
const FOCUS_OUTSIDE_OPACITY = 0.2;
/** Minimum overlap (px) between image and sheet when dragging/scaling. */
const SHEET_MIN_OVERLAP_PX = 1;

type PhFabricImage = FabricObject & {
  phPlacement?: PhCanvasPlacement;
  _phOrigRender?: (ctx: CanvasRenderingContext2D) => void;
  _phOverflowRender?: boolean;
  _phSheetClip?: FabricObject;
  _phSheetClipKey?: string;
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
  /** CSS clip-path for the printable area (rounded/chamfer/bleed) — from preview layout. */
  @Input() imageClipPath: string | null = null;
  /** Border-radius when corners are rounded without clip-path — from preview layout. */
  @Input() imageBorderRadiusPx = 0;
  /** Disable interaction (e.g. when the canvas is read-only). */
  @Input() interactive = true;

  @Output() placementsChange = new EventEmitter<PhCanvasPlacement[]>();

  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;
  @ViewChild('canvasEl', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  constructor(
    private readonly rootRef: ElementRef<HTMLElement>,
    private readonly interactionService: PhCanvasInteractionService,
  ) {}

  /** Internal source of truth — normalized placements rendered onto the canvas. */
  private model: PhCanvasPlacement[] = [];
  private canvas: Canvas | null = null;
  private resizeObserver?: ResizeObserver;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressEmit = false;
  private viewReady = false;
  private accentGreen = '';
  private modelNeedsPersistAfterRepair = false;
  /** Dynamic margin around the sheet; grows while a selected image extends outside. */
  private overflowPad = OVERFLOW_PAD_PX;
  /** Placement snapshot at the start of a move/scale/rotate gesture. */
  private gestureStartPlacement: PhCanvasPlacement | null = null;
  private interactionSub?: Subscription;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.applyHostOverflowInset();
    this.initCanvas();
    this.interactionSub = new Subscription();
    this.interactionSub.add(
      this.interactionService.releaseOthers$.subscribe((activeSide) => {
        if (activeSide !== this.side) {
          this.releaseFocusFromOtherSheet();
        }
      }),
    );
    this.interactionSub.add(
      this.interactionService.pointerDownCapture$.subscribe((event) => {
        this.dismissSelectionIfOutside(event);
      }),
    );
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
    if (
      (changes['imageClipPath'] || changes['imageBorderRadiusPx']) &&
      this.canvas
    ) {
      this.syncFocusChrome();
    }
  }

  ngOnDestroy(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.resizeObserver?.disconnect();
    this.interactionSub?.unsubscribe();
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

    this.canvas.on('object:modified', (event) => this.onObjectModified(event.target as FabricObject));
    this.canvas.on('object:moving', (event) => {
      this.interactionService.claim(this.side);
      this.constrainActiveObjectToSheet(event.target as FabricObject);
      this.syncOverflowPadFromActive(true);
    });
    this.canvas.on('object:scaling', (event) => {
      this.interactionService.claim(this.side);
      this.constrainActiveObjectToSheet(event.target as FabricObject);
      this.syncOverflowPadFromActive(true);
    });
    this.canvas.on('object:rotating', (event) => {
      this.interactionService.claim(this.side);
      this.constrainActiveObjectToSheet(event.target as FabricObject);
      this.canvas?.requestRenderAll();
    });
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
        this.interactionService.claim(this.side);
        this.canvas!.setActiveObject(target);
        this.captureGestureStartPlacement(target);
      } else {
        this.clearActiveSelection();
      }
      this.syncFocusChrome();
    });
    this.canvas.on('selection:created', () => this.syncFocusChrome());
    this.canvas.on('selection:updated', () => this.syncFocusChrome());
    this.canvas.on('selection:cleared', () => this.syncFocusChrome());
    this.canvas.on('after:render', (opt) => {
      this.drawFocusedImageInterior(opt.ctx);
      this.drawFocusCornerBrackets(opt.ctx);
    });
  }

  private refreshAccentGreen(): void {
    this.accentGreen =
      getComputedStyle(this.hostRef.nativeElement).getPropertyValue('--zx-green').trim() ||
      '#26a69a';
  }

  /** Clear selection when the other duplex side claims interaction. */
  private releaseFocusFromOtherSheet(): void {
    if (!this.canvas?.getActiveObject()) {
      return;
    }
    this.clearActiveSelection();
    this.syncFocusChrome();
  }

  /** Dismiss focus when the user clicks anywhere except the currently active image. */
  private dismissSelectionIfOutside(event: PointerEvent): void {
    if (!this.interactive || !this.canvas) {
      return;
    }
    const active = this.canvas.getActiveObject();
    if (!active) {
      return;
    }
    if (this.isPointerOnActiveObject(event, active)) {
      return;
    }
    this.clearActiveSelection();
    this.syncFocusChrome();
  }

  private clearActiveSelection(): void {
    if (!this.canvas) {
      return;
    }
    this.interactionService.release(this.side);
    this.canvas.discardActiveObject();
    this.gestureStartPlacement = null;
  }

  /** True when the event hits the active Fabric object (body or corner controls). */
  private isPointerOnActiveObject(event: PointerEvent, active: FabricObject): boolean {
    const sheetHost = this.rootRef.nativeElement;
    if (!sheetHost.contains(event.target as Node)) {
      return false;
    }
    const upperCanvas = this.canvas!.upperCanvasEl;
    if (!upperCanvas.contains(event.target as Node)) {
      return false;
    }
    const { target } = this.canvas!.findTarget(event);
    return target === active;
  }

  /** Controls + per-image visual state (clip vs 20% overflow) for the active image. */
  private syncFocusChrome(): void {
    if (!this.canvas) {
      return;
    }
    const active = this.canvas.getActiveObject();
    for (const obj of this.canvas.getObjects()) {
      const focused = obj === active;
      this.applyObjectControls(obj, focused);
      if (obj instanceof FabricImage) {
        this.applyImageVisualState(obj as FabricImage, focused);
      }
    }
    this.syncOverflowPadFromActive();
    this.canvas.requestRenderAll();
  }

  /** Selected: 20% outside / 100% inside (interior pass in after:render). Others: sheet clip. */
  private applyImageVisualState(img: FabricImage, focused: boolean): void {
    const extended = img as PhFabricImage;
    img.objectCaching = false;

    if (extended._phOrigRender) {
      img._render = extended._phOrigRender;
    }

    const { pad, sheetW, sheetH } = this.getSheetMetrics();
    const shapeClip = this.ensureSheetFabricClip(extended, pad, sheetW, sheetH);

    if (focused) {
      img.opacity = FOCUS_OUTSIDE_OPACITY;
      // No clip on the dim pass — full image at 20%; interior shape clip runs in after:render.
      img.clipPath = undefined;
    } else {
      img.opacity = 1;
      img.clipPath = shapeClip;
    }
    extended._phOverflowRender = focused;
  }

  private ensureSheetFabricClip(
    extended: PhFabricImage,
    pad: number,
    sheetW: number,
    sheetH: number,
  ): FabricObject {
    const spec = resolveSheetClipSpec(this.imageClipPath, this.imageBorderRadiusPx);
    const fullKey = `${sheetClipSpecKey(this.imageClipPath, this.imageBorderRadiusPx)}|${pad}|${sheetW}|${sheetH}`;
    if (extended._phSheetClip && extended._phSheetClipKey === fullKey) {
      return extended._phSheetClip;
    }
    extended._phSheetClip = createFabricSheetClip(spec, pad, sheetW, sheetH);
    extended._phSheetClipKey = fullKey;
    return extended._phSheetClip;
  }

  /** Re-draw the focused image at full opacity inside the printable sheet bounds. */
  private drawFocusedImageInterior(ctx: CanvasRenderingContext2D): void {
    if (!this.canvas) {
      return;
    }
    const active = this.canvas.getActiveObject();
    if (!(active instanceof FabricImage) || !(active as PhFabricImage)._phOverflowRender) {
      return;
    }
    const vpt = this.canvas.viewportTransform;
    if (!vpt) {
      return;
    }
    const { pad, sheetW, sheetH } = this.getSheetMetrics();
    const spec = resolveSheetClipSpec(this.imageClipPath, this.imageBorderRadiusPx);

    ctx.save();
    ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
    applySheetClipToContext(ctx, spec, pad, sheetW, sheetH);

    const prevOpacity = active.opacity;
    active.opacity = 1;
    active.render(ctx);
    active.opacity = prevOpacity;
    ctx.restore();
  }

  /** The printable image layer (parent of this component) — not the expanded host. */
  private getImageLayerEl(): HTMLElement | null {
    return this.rootRef.nativeElement.parentElement;
  }

  private applyHostOverflowInset(): void {
    this.rootRef.nativeElement.style.setProperty(
      '--ph-canvas-overflow-pad',
      `${this.overflowPad}px`,
    );
  }

  /** Expand the Fabric canvas when the selected image extends beyond the sheet. */
  private syncOverflowPadFromActive(duringGesture = false): void {
    const active = this.canvas?.getActiveObject();
    if (!active) {
      if (this.overflowPad === OVERFLOW_PAD_PX) {
        return;
      }
      const oldPad = this.overflowPad;
      this.overflowPad = OVERFLOW_PAD_PX;
      this.applyOverflowPadChange(oldPad, null, false);
      return;
    }

    let needed = OVERFLOW_PAD_PX;
    if (active.aCoords) {
      const { pad, sheetW, sheetH } = this.getSheetMetrics();
      const sheetLeft = pad;
      const sheetTop = pad;
      const sheetRight = pad + sheetW;
      const sheetBottom = pad + sheetH;
      for (const pt of Object.values(active.aCoords)) {
        needed = Math.max(
          needed,
          sheetLeft - pt.x + FOCUS_CORNER_ARM_PX + 12,
          pt.x - sheetRight + FOCUS_CORNER_ARM_PX + 12,
          sheetTop - pt.y + FOCUS_CORNER_ARM_PX + 12,
          pt.y - sheetBottom + FOCUS_CORNER_ARM_PX + 12,
        );
      }
    }
    needed = Math.min(OVERFLOW_PAD_MAX_PX, Math.ceil(needed));
    if (needed === this.overflowPad) {
      return;
    }
    const oldPad = this.overflowPad;
    this.overflowPad = needed;
    this.applyOverflowPadChange(oldPad, active, duringGesture);
  }

  /** Keep objects visually fixed when the overflow margin grows or shrinks. */
  private applyOverflowPadChange(
    oldPad: number,
    active: FabricObject | null | undefined,
    duringGesture: boolean,
  ): void {
    this.applyHostOverflowInset();
    if (!this.canvas) {
      return;
    }

    const padDelta = this.overflowPad - oldPad;
    if (padDelta !== 0) {
      for (const obj of this.canvas.getObjects()) {
        obj.set({
          left: (obj.left ?? 0) + padDelta,
          top: (obj.top ?? 0) + padDelta,
        });
        obj.setCoords();
      }
    }

    const { canvasW, canvasH } = this.getSheetMetrics();
    this.canvas.setDimensions({ width: canvasW, height: canvasH });

    if (!duringGesture) {
      this.relayoutObjects();
    }

    for (const obj of this.canvas.getObjects()) {
      if (obj instanceof FabricImage) {
        this.applyImageVisualState(obj as FabricImage, obj === active);
      }
    }
  }

  private getSheetMetrics(): {
    pad: number;
    sheetW: number;
    sheetH: number;
    canvasW: number;
    canvasH: number;
  } {
    const layer = this.getImageLayerEl();
    const sheetW = Math.round(Math.max(1, layer?.clientWidth || 1));
    const sheetH = Math.round(Math.max(1, layer?.clientHeight || 1));
    const pad = this.overflowPad;
    return {
      pad,
      sheetW,
      sheetH,
      canvasW: sheetW + 2 * pad,
      canvasH: sheetH + 2 * pad,
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
    const layer = this.getImageLayerEl();
    if (layer) {
      this.resizeObserver.observe(layer);
    } else {
      this.resizeObserver.observe(this.hostRef.nativeElement);
    }
  }

  private onResize(): void {
    if (!this.canvas) {
      return;
    }
    const { canvasW, canvasH } = this.getSheetMetrics();
    if (canvasW < 1 || canvasH < 1) {
      return;
    }
    this.canvas.setDimensions({ width: canvasW, height: canvasH });
    this.relayoutObjects();
    this.syncFocusChrome();
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
      this.interactionService.claim(this.side);
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

  private captureGestureStartPlacement(obj: FabricObject): void {
    const placement = (obj as PhFabricImage).phPlacement;
    this.gestureStartPlacement = placement ? { ...placement } : null;
  }

  private getObjectAxisBounds(obj: FabricObject): {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null {
    obj.setCoords();
    const coords = obj.aCoords;
    if (!coords) {
      return null;
    }
    const xs = Object.values(coords).map((pt) => pt.x);
    const ys = Object.values(coords).map((pt) => pt.y);
    return {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    };
  }

  private intersectsSheet(
    obj: FabricObject,
    pad: number,
    sheetW: number,
    sheetH: number,
    minOverlap = SHEET_MIN_OVERLAP_PX,
  ): boolean {
    const bounds = this.getObjectAxisBounds(obj);
    if (!bounds) {
      return false;
    }
    const clip = getSheetClipRect(pad, sheetW, sheetH);
    const sheetLeft = clip.left;
    const sheetTop = clip.top;
    const sheetRight = clip.left + clip.width;
    const sheetBottom = clip.top + clip.height;
    const overlapW = Math.min(bounds.right, sheetRight) - Math.max(bounds.left, sheetLeft);
    const overlapH = Math.min(bounds.bottom, sheetBottom) - Math.max(bounds.top, sheetTop);
    return overlapW >= minOverlap && overlapH >= minOverlap;
  }

  /** Keep at least `SHEET_MIN_OVERLAP_PX` of the image inside the printable sheet. */
  private constrainObjectToSheet(obj: FabricObject): boolean {
    const { pad, sheetW, sheetH } = this.getSheetMetrics();
    const clip = getSheetClipRect(pad, sheetW, sheetH);
    const sheetLeft = clip.left;
    const sheetTop = clip.top;
    const sheetRight = clip.left + clip.width;
    const sheetBottom = clip.top + clip.height;
    let adjusted = false;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (this.intersectsSheet(obj, pad, sheetW, sheetH)) {
        return adjusted;
      }
      const bounds = this.getObjectAxisBounds(obj);
      if (!bounds) {
        return adjusted;
      }

      let dx = 0;
      let dy = 0;
      if (bounds.right <= sheetLeft) {
        dx = sheetLeft + SHEET_MIN_OVERLAP_PX - bounds.right;
      } else if (bounds.left >= sheetRight) {
        dx = sheetRight - SHEET_MIN_OVERLAP_PX - bounds.left;
      }
      if (bounds.bottom <= sheetTop) {
        dy = sheetTop + SHEET_MIN_OVERLAP_PX - bounds.bottom;
      } else if (bounds.top >= sheetBottom) {
        dy = sheetBottom - SHEET_MIN_OVERLAP_PX - bounds.top;
      }
      if (dx === 0 && dy === 0) {
        break;
      }
      obj.set({
        left: (obj.left ?? 0) + dx,
        top: (obj.top ?? 0) + dy,
      });
      adjusted = true;
    }

    obj.setCoords();
    return adjusted;
  }

  private constrainActiveObjectToSheet(obj: FabricObject | undefined): void {
    if (!obj) {
      return;
    }
    this.constrainObjectToSheet(obj);
  }

  private restoreGestureStartPlacement(obj: FabricObject): void {
    if (!this.gestureStartPlacement || !(obj instanceof FabricImage)) {
      return;
    }
    this.applyPlacementToImage(obj, this.gestureStartPlacement);
    (obj as PhFabricImage).phPlacement = { ...this.gestureStartPlacement };
    obj.setCoords();
  }

  private onObjectModified(obj: FabricObject | undefined): void {
    if (!this.canvas || !obj) {
      return;
    }
    const { pad, sheetW, sheetH } = this.getSheetMetrics();
    if (!this.intersectsSheet(obj, pad, sheetW, sheetH)) {
      this.restoreGestureStartPlacement(obj);
    }
    this.gestureStartPlacement = null;
    this.onObjectsChanged();
  }

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
