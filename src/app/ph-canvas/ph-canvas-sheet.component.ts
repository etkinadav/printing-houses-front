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
  PhSheetClipSpec,
  resolveSheetClipSpec,
  sheetClipSpecKey,
} from './ph-canvas-sheet-clip.util';
import {
  PhCanvasDragPayload,
  PhCanvasPlacement,
  PhCanvasSideName,
  PH_CANVAS_DRAG_MIME,
  phCanvasCreatePlacementId,
  phCanvasPlacementInstanceId,
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
/** Opacity outside the trim-bleed safe zone when no image is selected (95% transparent). */
const TRIM_BLEED_OUTSIDE_OPACITY = 0.05;
/** Opacity outside the trim-bleed safe zone when an image is selected (90% transparent). */
const TRIM_BLEED_OUTSIDE_OPACITY_FOCUSED = 0.1;
/** Minimum overlap (px) between image and sheet when dragging/scaling. */
const SHEET_MIN_OVERLAP_PX = 1;
/** Small tolerance for selecting near anti-aliased / transformed image edges. */
const SELECTION_HIT_TOLERANCE_PX = 24;

type PhFabricImage = FabricObject & {
  phPlacement?: PhCanvasPlacement;
  _phOrigRender?: (ctx: CanvasRenderingContext2D) => void;
  _phOverflowRender?: boolean;
  _phTrimBleedRender?: boolean;
  _phSheetClip?: FabricObject;
  _phSheetClipKey?: string;
  _phOrigContainsPoint?: (point: { x: number; y: number }) => boolean;
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
  /** Clip spec for the trim-bleed safe zone (sheet coords) — dims overflow outside bleed. */
  @Input() trimBleedInteriorClipSpec: PhSheetClipSpec | null = null;
  /** Border-radius when corners are rounded without clip-path — from preview layout. */
  @Input() imageBorderRadiusPx = 0;
  /** Disable interaction (e.g. when the canvas is read-only). */
  @Input() interactive = true;
  /** Layer panel / external focus — select this placement instance on the sheet. */
  @Input() selectedPlacementInstanceId: string | null = null;

  @Output() placementsChange = new EventEmitter<PhCanvasPlacement[]>();
  @Output() selectionChange = new EventEmitter<string | null>();

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
  /** Side key used in PhCanvasInteractionService (updated when @Input side changes). */
  private registeredSide: PhCanvasSideName | null = null;

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
    this.interactionSub.add(
      this.interactionService.hoverSide$.subscribe((hoverSide) => {
        this.applyDuplexPointerPassThrough(hoverSide);
      }),
    );
    this.syncInteractionRegistration();
    this.observeResize();
    this.model = this.clonePlacements(this.placements);
    void this.syncObjectsFromModel().then(() => {
      requestAnimationFrame(() => this.syncCanvasPointerLayout());
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) {
      return;
    }
    if (changes['side'] && !changes['side'].firstChange) {
      this.syncInteractionRegistration();
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
    if (changes['selectedPlacementInstanceId'] && this.selectedPlacementInstanceId) {
      void this.selectByInstanceId(this.selectedPlacementInstanceId);
    }
    if (
      (changes['imageClipPath'] ||
        changes['imageBorderRadiusPx'] ||
        changes['trimBleedInteriorClipSpec']) &&
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
    if (this.registeredSide) {
      this.interactionService.unregisterSheet(this.registeredSide);
      this.interactionService.release(this.registeredSide);
      this.registeredSide = null;
    }
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
      perPixelTargetFind: false,
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
    this.syncCanvasPointerLayout();
  }

  private bindFocusHandlers(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.on('mouse:down', (opt) => {
      if (!this.interactive) {
        return;
      }
      const event = opt.e as PointerEvent;
      if (!this.isPointerActiveForThisSheet(event)) {
        this.logSelection('mouse:down → ignored (other duplex sheet)', {
          hoverSide: this.interactionService.getHoverSide(),
        });
        return;
      }
      const fabricTarget = opt.target as FabricObject | undefined;
      const resolved = this.resolveImageTarget(event);
      this.logSelection('mouse:down', {
        fabricTargetKey: this.placementKeyForObject(fabricTarget),
        resolvedTargetKey: this.placementKeyForObject(resolved),
        activeBefore: this.activePlacementKey(),
        scenePoint: this.describeScenePoint(event),
        zOrder: this.describeZOrder(),
      });
      const target = resolved ?? (fabricTarget instanceof FabricImage ? fabricTarget : null);
      if (target) {
        const active = this.canvas!.getActiveObject();
        if (target === active) {
          this.captureGestureStartPlacement(target);
          this.logSelection('mouse:down → keep active (drag ready)', {
            key: this.placementKeyForObject(target),
          });
        } else {
          this.selectPlacementObject(target);
        }
        return;
      }
      this.logPointerMiss(event, fabricTarget);
      const active = this.canvas!.getActiveObject();
      if (active && this.pointerHitsObject(event, active)) {
        this.captureGestureStartPlacement(active);
        this.logSelection('mouse:down → keep active (full-bbox hit, no fabric target)', {
          key: this.placementKeyForObject(active),
        });
        return;
      }
      this.clearActiveSelection();
      this.syncFocusChrome();
    });
    this.canvas.on('mouse:move', (opt) => {
      if (!this.interactive || !this.canvas) {
        return;
      }
      const event = opt.e as PointerEvent;
      if (!this.isPointerActiveForThisSheet(event)) {
        this.canvas.hoverCursor = 'default';
        return;
      }
      const hoverTarget = this.resolveImageTarget(event);
      this.canvas.hoverCursor = hoverTarget ? 'move' : 'default';
    });
    this.canvas.on('selection:created', () => this.syncFocusChrome());
    this.canvas.on('selection:updated', () => this.syncFocusChrome());
    this.canvas.on('selection:cleared', () => this.syncFocusChrome());
    this.canvas.on('after:render', (opt) => {
      this.drawImageInteriorPasses(opt.ctx);
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
    this.clearSelectionFromInteraction('releaseFocusFromOtherSheet');
  }

  private clearActiveSelection(): void {
    if (!this.canvas?.getActiveObject()) {
      return;
    }
    this.logSelection('clear', { prev: this.activePlacementKey(), side: this.side });
    this.interactionService.release(this.side);
    this.clearSelectionFromInteraction('clearActiveSelection');
  }

  /** Drop Fabric focus chrome without touching interaction service state. */
  private clearSelectionFromInteraction(reason: string): void {
    if (!this.canvas) {
      return;
    }
    if (!this.canvas.getActiveObject()) {
      return;
    }
    this.logSelection(reason, { prev: this.activePlacementKey(), side: this.side });
    this.canvas.discardActiveObject();
    this.gestureStartPlacement = null;
    this.restoreStackOrderFromModel();
    this.syncFocusChrome();
    this.emitSelectionChange(null);
  }

  /** Re-align Fabric stack order with persisted placement zIndex values. */
  private restoreStackOrderFromModel(): void {
    if (!this.canvas) {
      return;
    }
    const objects = this.canvas.getObjects() as PhFabricImage[];
    const ordered = objects
      .filter((obj) => obj.phPlacement)
      .sort((left, right) => left.phPlacement!.zIndex - right.phPlacement!.zIndex);
    if (ordered.length < 2) {
      return;
    }
    const desiredKeys = ordered.map((obj) => this.placementKeyForObject(obj)).join('|');
    const currentKeys = objects
      .filter((obj) => obj.phPlacement)
      .map((obj) => this.placementKeyForObject(obj))
      .join('|');
    if (desiredKeys === currentKeys) {
      return;
    }
    ordered.forEach((obj, index) => {
      this.canvas!.moveObjectTo(obj, index);
    });
    this.logSelection('restoreStackOrder', { zOrder: this.describeZOrder() });
    this.canvas.requestRenderAll();
  }

  /** Dismiss focus when the user clicks anywhere except the currently active image. */
  private dismissSelectionIfOutside(event: PointerEvent): void {
    if (!this.interactive || !this.canvas) {
      return;
    }

    // Pointer on another stacked-duplex sheet — clear this sheet's selection immediately.
    if (
      this.interactionService.isDuplex &&
      !this.isPointerActiveForThisSheet(event) &&
      this.canvas.getActiveObject()
    ) {
      this.logSelection('pointerdown:capture → clear (other duplex sheet)', {
        side: this.side,
        hoverSide: this.interactionService.getHoverSide(),
      });
      this.interactionService.release(this.side);
      this.clearSelectionFromInteraction('dismissOtherSheet');
      return;
    }

    if (!this.isPointerActiveForThisSheet(event)) {
      return;
    }
    const active = this.canvas.getActiveObject();
    if (!active) {
      return;
    }

    const activeKey = this.placementKeyForObject(active);
    const onSheetHost = this.rootRef.nativeElement.contains(event.target as Node);
    const onUpperCanvas = this.canvas.upperCanvasEl.contains(event.target as Node);
    const pointerTarget = onUpperCanvas ? this.resolveImageTarget(event) : null;
    const pointerKey = this.placementKeyForObject(pointerTarget ?? undefined);

    this.logSelection('pointerdown:capture', {
      activeKey,
      onSheetHost,
      onUpperCanvas,
      pointerKey,
      scenePoint: onUpperCanvas ? this.describeScenePoint(event) : null,
      zOrder: this.describeZOrder(),
    });

    if (!onSheetHost) {
      this.logSelection('pointerdown:capture → clear (outside sheet host)');
      this.clearActiveSelection();
      this.deferSyncFocusChrome();
      return;
    }

    if (!onUpperCanvas) {
      this.logSelection('pointerdown:capture → clear (on host, not canvas)');
      this.clearActiveSelection();
      this.deferSyncFocusChrome();
      return;
    }

    if (pointerTarget === active || this.pointerHitsObject(event, active)) {
      this.logSelection('pointerdown:capture → keep (same object)', {
        viaFindTarget: pointerTarget === active,
        viaFullBbox: pointerTarget !== active,
      });
      return;
    }

    if (pointerTarget instanceof FabricImage) {
      this.logSelection('pointerdown:capture → switch', {
        from: activeKey,
        to: pointerKey,
      });
      this.selectPlacementObject(pointerTarget);
      return;
    }

    this.logSelection('pointerdown:capture → clear (empty canvas hit)');
    this.clearActiveSelection();
    this.deferSyncFocusChrome();
  }

  /** Select a placement object and refresh focus chrome (stack order unchanged). */
  private selectPlacementObject(obj: FabricObject): void {
    if (!this.canvas) {
      return;
    }
    // Claim first so the other duplex sheet clears before this side shows focus chrome.
    this.interactionService.claim(this.side);
    const key = this.placementKeyForObject(obj);
    const prev = this.activePlacementKey();
    this.canvas.setActiveObject(obj);
    this.captureGestureStartPlacement(obj);
    this.syncFocusChrome();
    this.emitSelectionChange(key);
    this.logSelection('select', {
      key,
      prev,
      zOrderAfter: this.describeZOrder(),
    });
  }

  /** Parent-driven updates when the placements @Input array is mutated in place (e.g. layers z-order). */
  applyExternalPlacements(placements: PhCanvasPlacement[]): void {
    const incoming = placements ?? [];
    if (!this.viewReady || !this.canvas) {
      this.model = this.clonePlacements(incoming);
      return;
    }
    if (this.placementsEquivalent(incoming, this.model)) {
      return;
    }
    this.model = this.clonePlacements(incoming);
    void this.syncObjectsFromModel();
  }

  /** Focus a placement from the layers panel (public API). */
  async selectByInstanceId(instanceId: string): Promise<void> {
    if (!this.canvas || !instanceId) {
      return;
    }
    const key = instanceId.trim();
    if (!key || this.activePlacementKey() === key) {
      return;
    }
    let match = (this.canvas.getObjects() as PhFabricImage[]).find(
      (obj) => obj.phPlacement && this.placementKey(obj.phPlacement) === key,
    );
    if (!match) {
      await this.syncObjectsFromModel();
      match = (this.canvas.getObjects() as PhFabricImage[]).find(
        (obj) => obj.phPlacement && this.placementKey(obj.phPlacement) === key,
      );
    }
    if (match) {
      this.selectPlacementObject(match);
    }
  }

  /** Remove one placement instance from the canvas (public API). */
  removeByInstanceId(instanceId: string): void {
    const key = instanceId?.trim();
    if (!key) {
      return;
    }
    const target = this.model.find((p) => this.placementKey(p) === key);
    if (!target) {
      return;
    }
    this.model = this.model.filter((p) => p !== target);
    if (this.canvas) {
      const obj = (this.canvas.getObjects() as PhFabricImage[]).find(
        (candidate) =>
          candidate.phPlacement && this.placementKey(candidate.phPlacement) === key,
      );
      if (obj) {
        this.canvas.remove(obj);
      }
      this.canvas.discardActiveObject();
      this.syncFocusChrome();
    }
    this.emitSelectionChange(null);
    this.emitChange();
  }

  private deferSyncFocusChrome(): void {
    queueMicrotask(() => this.syncFocusChrome());
  }

  /** Resolve the topmost image under the pointer. */
  private resolveImageTarget(event: PointerEvent): FabricImage | null {
    if (!this.canvas?.upperCanvasEl.contains(event.target as Node)) {
      return null;
    }
    if (!this.isPointerActiveForThisSheet(event)) {
      return null;
    }
    if (!this.containsImageLayerPoint(event.clientX, event.clientY)) {
      return null;
    }
    this.syncAllObjectCoords();

    // Primary: hit-test via printable image-layer + normalized placements (matches what the user sees).
    const placementHit = this.findTopImageByPlacement(event);
    if (placementHit) {
      this.logSelection('resolveImageTarget → placement hit', {
        key: this.placementKeyForObject(placementHit),
        norm: this.roundPoint(this.getSheetNormalizedPointer(event)),
      });
      return placementHit;
    }

    // Secondary: Fabric's own findTarget.
    const fabricTarget = this.canvas.findTarget(event).target;
    if (fabricTarget instanceof FabricImage) {
      return fabricTarget;
    }

    // Fallback: manual scene-point hit-test.
    for (const candidate of this.getPointerCandidates(event)) {
      const match = this.findTopImageAtScenePoint(candidate.point, candidate.tolerance);
      if (match) {
        this.logSelection('resolveImageTarget → scene hit', {
          candidate: candidate.kind,
          point: this.roundPoint(candidate.point),
          key: this.placementKeyForObject(match),
        });
        return match;
      }
    }
    return null;
  }

  /** Map pointer to 0..1 coordinates within the printable image layer. */
  private getSheetNormalizedPointer(event: PointerEvent): { x: number; y: number } | null {
    const layer = this.getImageLayerEl();
    if (!layer) {
      return null;
    }
    const rect = layer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  private isNormalizedPointInPlacement(
    point: { x: number; y: number },
    placement: PhCanvasPlacement,
    sheetW: number,
    sheetH: number,
    tolerancePx = SELECTION_HIT_TOLERANCE_PX,
  ): boolean {
    const tolX = tolerancePx / sheetW;
    const tolY = tolerancePx / sheetH;
    return (
      point.x >= placement.x - tolX &&
      point.x <= placement.x + placement.width + tolX &&
      point.y >= placement.y - tolY &&
      point.y <= placement.y + placement.height + tolY
    );
  }

  /** Topmost image whose normalized placement box contains the pointer. */
  private findTopImageByPlacement(event: PointerEvent): FabricImage | null {
    if (!this.canvas) {
      return null;
    }
    const norm = this.getSheetNormalizedPointer(event);
    if (!norm) {
      return null;
    }
    const { sheetW, sheetH } = this.getSheetMetrics();
    const objects = this.canvas.getObjects() as PhFabricImage[];
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const obj = objects[index];
      const placement = obj.phPlacement;
      if (!(obj instanceof FabricImage) || !placement || !obj.evented || !obj.visible) {
        continue;
      }
      if (this.isNormalizedPointInPlacement(norm, placement, sheetW, sheetH)) {
        return obj;
      }
    }
    return null;
  }

  private findTopImageAtScenePoint(
    pointer: { x: number; y: number },
    tolerance = 0,
  ): FabricImage | null {
    if (!this.canvas) {
      return null;
    }
    const objects = this.canvas.getObjects();
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const obj = objects[index];
      if (!(obj instanceof FabricImage) || !obj.evented || !obj.visible) {
        continue;
      }
      obj.setCoords();
      if (
        this.isPointInObjectSelectionArea(obj, pointer) ||
        (tolerance > 0 && this.isPointNearObjectBounds(obj, pointer, tolerance))
      ) {
        return obj;
      }
    }
    return null;
  }

  private isPointNearObjectBounds(
    obj: FabricObject,
    pointer: { x: number; y: number },
    tolerance: number,
  ): boolean {
    const rect = obj.getBoundingRect();
    return (
      pointer.x >= rect.left - tolerance &&
      pointer.x <= rect.left + rect.width + tolerance &&
      pointer.y >= rect.top - tolerance &&
      pointer.y <= rect.top + rect.height + tolerance
    );
  }

  private isPointInObjectSelectionArea(
    obj: FabricObject,
    pointer: { x: number; y: number },
  ): boolean {
    const canvas = this.canvas as unknown as {
      _pointIsInObjectSelectionArea: (target: FabricObject, point: { x: number; y: number }) => boolean;
    };
    return canvas._pointIsInObjectSelectionArea(obj, pointer);
  }

  private syncAllObjectCoords(): void {
    if (!this.canvas) {
      return;
    }
    for (const obj of this.canvas.getObjects()) {
      obj.setCoords();
    }
  }

  /** Keep Fabric pointer mapping aligned after host/canvas geometry changes. */
  private syncCanvasPointerLayout(): void {
    if (!this.canvas) {
      return;
    }
    const { canvasW, canvasH } = this.getSheetMetrics();
    if (canvasW < 1 || canvasH < 1) {
      return;
    }
    this.canvas.setDimensions({ width: canvasW, height: canvasH });
    this.canvas.calcOffset();
  }

  /**
   * Fabric scene point from upper-canvas DOM (same formula as Fabric's _getPointerImpl).
   */
  private getDirectScenePoint(event: PointerEvent): { x: number; y: number } | null {
    const upperCanvas = this.canvas?.upperCanvasEl;
    if (!upperCanvas || !this.canvas) {
      return null;
    }
    const bounds = upperCanvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }
    this.canvas.calcOffset();
    const offset = (this.canvas as unknown as { _offset: { left: number; top: number } })._offset;
    let x = event.clientX - offset.left;
    let y = event.clientY - offset.top;
    const retinaScaling = this.canvas.getRetinaScaling();
    if (retinaScaling !== 1) {
      x /= retinaScaling;
      y /= retinaScaling;
    }
    const cssScaleX = upperCanvas.width / bounds.width;
    const cssScaleY = upperCanvas.height / bounds.height;
    return { x: x * cssScaleX, y: y * cssScaleY };
  }

  private getPointerCandidates(event: PointerEvent): Array<{
    kind: string;
    point: { x: number; y: number };
    tolerance: number;
  }> {
    if (!this.canvas) {
      return [];
    }
    const candidates: Array<{
      kind: string;
      point: { x: number; y: number };
      tolerance: number;
    }> = [];

    // Primary: direct DOM measurement of the upper-canvas (no stale calcOffset cache).
    const direct = this.getDirectScenePoint(event);
    if (direct) {
      candidates.push({ kind: 'direct', point: direct, tolerance: 0 });
      candidates.push({ kind: 'direct+tol', point: direct, tolerance: SELECTION_HIT_TOLERANCE_PX });
    }

    // Fallback: Fabric's own calcOffset-based scene point.
    const fabric = this.canvas.getScenePoint(event);
    candidates.push({ kind: 'fabric', point: fabric, tolerance: 0 });
    candidates.push({ kind: 'fabric+tol', point: fabric, tolerance: SELECTION_HIT_TOLERANCE_PX });

    return candidates;
  }

  private roundPoint(point: { x: number; y: number } | null): { x: number; y: number } | null {
    return point
      ? { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 }
      : null;
  }

  private describeScenePoint(event: PointerEvent): {
    norm: { x: number; y: number } | null;
    direct: { x: number; y: number } | null;
    fabric: { x: number; y: number } | null;
  } | null {
    if (!this.canvas) {
      return null;
    }
    return {
      norm: this.roundPoint(this.getSheetNormalizedPointer(event)),
      direct: this.roundPoint(this.getDirectScenePoint(event)),
      fabric: this.roundPoint(this.canvas.getScenePoint(event)),
    };
  }

  private logPointerMiss(event: PointerEvent, fabricTarget: FabricObject | undefined): void {
    if (!this.canvas) {
      return;
    }
    this.syncCanvasPointerLayout();
    const norm = this.getSheetNormalizedPointer(event);
    const { sheetW, sheetH } = this.getSheetMetrics();
    const candidates = this.getPointerCandidates(event);
    const objectBounds = (this.canvas.getObjects() as PhFabricImage[]).map((obj) => {
      obj.setCoords();
      const rect = obj.getBoundingRect();
      const placement = obj.phPlacement;
      return {
        key: this.placementKeyForObject(obj),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        placement: placement
          ? {
              x: Math.round(placement.x * 1000) / 1000,
              y: Math.round(placement.y * 1000) / 1000,
              w: Math.round(placement.width * 1000) / 1000,
              h: Math.round(placement.height * 1000) / 1000,
            }
          : null,
        hitPlacement:
          norm && placement
            ? this.isNormalizedPointInPlacement(norm, placement, sheetW, sheetH)
            : false,
        hits: candidates.map((candidate) => ({
          kind: candidate.kind,
          point: this.roundPoint(candidate.point),
          hit:
            this.isPointInObjectSelectionArea(obj, candidate.point) ||
            (candidate.tolerance > 0 &&
              this.isPointNearObjectBounds(obj, candidate.point, candidate.tolerance)),
        })),
      };
    });
    this.logSelection('pointer miss', {
      scenePoint: this.describeScenePoint(event),
      fabricTargetKey: this.placementKeyForObject(fabricTarget),
      objectBounds,
    });
  }

  private placementKeyForObject(obj: FabricObject | null | undefined): string | null {
    const placement = (obj as PhFabricImage | undefined)?.phPlacement;
    return placement ? this.placementKey(placement) : null;
  }

  private describeZOrder(): Array<{ key: string; zIndex: number; canvasIndex: number }> {
    if (!this.canvas) {
      return [];
    }
    const objects = this.canvas.getObjects() as PhFabricImage[];
    return objects.map((obj, canvasIndex) => ({
      key: this.placementKeyForObject(obj) ?? '?',
      zIndex: obj.phPlacement?.zIndex ?? -1,
      canvasIndex,
    }));
  }

  /** Full bounding-box hit test (ignores sheet-only restriction). */
  private pointerHitsObject(event: PointerEvent, obj: FabricObject): boolean {
    if (!this.canvas) {
      return false;
    }
    const placement = (obj as PhFabricImage).phPlacement;
    const norm = this.getSheetNormalizedPointer(event);
    if (norm && placement) {
      const { sheetW, sheetH } = this.getSheetMetrics();
      if (this.isNormalizedPointInPlacement(norm, placement, sheetW, sheetH)) {
        return true;
      }
    }
    this.ensureOriginalContainsPoint(obj as PhFabricImage);
    const extended = obj as PhFabricImage;
    return this.getPointerCandidates(event).some(
      (candidate) =>
        extended._phOrigContainsPoint!(candidate.point) ||
        (candidate.tolerance > 0 &&
          this.isPointNearObjectBounds(obj, candidate.point, candidate.tolerance)),
    );
  }

  private ensureOriginalContainsPoint(img: PhFabricImage): void {
    if (!img._phOrigContainsPoint) {
      img._phOrigContainsPoint = img.containsPoint.bind(img);
    }
  }

  private logSelection(_message: string, _detail?: Record<string, unknown>): void {}

  /** Controls + per-image visual state (clip vs dimmed overflow). */
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

  /** Dimmed overflow outside sheet (focus) or trim-bleed zone; interior redrawn in after:render. */
  private applyImageVisualState(img: FabricImage, focused: boolean): void {
    const extended = img as PhFabricImage;
    img.objectCaching = false;
    img.perPixelTargetFind = false;

    if (extended._phOrigRender) {
      img._render = extended._phOrigRender;
    }

    const trimBleedActive = this.hasTrimBleedDimming();
    const { pad, sheetW, sheetH } = this.getSheetMetrics();
    const shapeClip = this.ensureSheetFabricClip(extended, pad, sheetW, sheetH);

    if (trimBleedActive) {
      img.opacity = focused
        ? TRIM_BLEED_OUTSIDE_OPACITY_FOCUSED
        : TRIM_BLEED_OUTSIDE_OPACITY;
      // Unselected: clip to print area so overflow past the sheet is fully hidden.
      img.clipPath = focused ? undefined : shapeClip;
      extended._phTrimBleedRender = true;
      extended._phOverflowRender = focused;
    } else if (focused) {
      img.opacity = FOCUS_OUTSIDE_OPACITY;
      img.clipPath = undefined;
      extended._phTrimBleedRender = false;
      extended._phOverflowRender = true;
    } else {
      img.opacity = 1;
      img.clipPath = shapeClip;
      extended._phTrimBleedRender = false;
      extended._phOverflowRender = false;
    }
    this.restoreFullHitTesting(extended);
  }

  private hasTrimBleedDimming(): boolean {
    return !!this.trimBleedInteriorClipSpec;
  }

  /** Re-draw image interiors at full opacity inside trim-bleed or sheet bounds. */
  private drawImageInteriorPasses(ctx: CanvasRenderingContext2D): void {
    if (!this.canvas) {
      return;
    }
    const vpt = this.canvas.viewportTransform;
    if (!vpt) {
      return;
    }

    const { pad, sheetW, sheetH } = this.getSheetMetrics();
    const sheetSpec = resolveSheetClipSpec(this.imageClipPath, this.imageBorderRadiusPx);
    const trimSpec = this.hasTrimBleedDimming()
      ? this.trimBleedInteriorClipSpec
      : null;

    for (const obj of this.canvas.getObjects()) {
      if (!(obj instanceof FabricImage)) {
        continue;
      }
      const extended = obj as PhFabricImage;
      if (!extended._phTrimBleedRender && !extended._phOverflowRender) {
        continue;
      }

      const spec = extended._phTrimBleedRender && trimSpec
        ? trimSpec
        : sheetSpec;

      ctx.save();
      ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
      applySheetClipToContext(ctx, spec, pad, sheetW, sheetH);

      const prevOpacity = obj.opacity;
      obj.opacity = 1;
      obj.render(ctx);
      obj.opacity = prevOpacity;
      ctx.restore();
    }
  }

  /** Restore Fabric's default containsPoint (never sheet-restrict the active object). */
  private restoreFullHitTesting(img: PhFabricImage): void {
    this.ensureOriginalContainsPoint(img);
    img.containsPoint = img._phOrigContainsPoint!;
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

  /** The printable image layer (parent of this component) — not the expanded host. */
  private getImageLayerEl(): HTMLElement | null {
    return this.rootRef.nativeElement.parentElement;
  }

  private syncInteractionRegistration(): void {
    if (this.registeredSide) {
      this.interactionService.unregisterSheet(this.registeredSide);
    }
    this.registeredSide = this.side;
    this.interactionService.registerSheet({
      side: this.side,
      containsImageLayerPoint: (clientX, clientY) =>
        this.containsImageLayerPoint(clientX, clientY),
      getImageLayerRect: () => this.getImageLayerEl()?.getBoundingClientRect() ?? null,
      clearSelection: () => this.clearSelectionFromInteraction('serviceClear'),
    });
  }

  private containsImageLayerPoint(clientX: number, clientY: number): boolean {
    const layer = this.getImageLayerEl();
    if (!layer) {
      return false;
    }
    const rect = layer.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  private isPointerActiveForThisSheet(event: PointerEvent): boolean {
    return this.interactionService.isPointerOnSide(event.clientX, event.clientY, this.side);
  }

  /** In duplex, only the hovered sheet receives pointer events. */
  private applyDuplexPointerPassThrough(hoverSide: PhCanvasSideName | null): void {
    if (!this.interactionService.isDuplex) {
      this.hostRef.nativeElement.style.pointerEvents = '';
      return;
    }
    const active = hoverSide === null || hoverSide === this.side;
    this.hostRef.nativeElement.style.pointerEvents = active ? 'auto' : 'none';
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
    this.syncCanvasPointerLayout();
  }

  private getSheetMetrics(): {
    pad: number;
    sheetW: number;
    sheetH: number;
    canvasW: number;
    canvasH: number;
  } {
    const layer = this.getImageLayerEl();
    const sheetW = Math.max(1, layer?.clientWidth || 1);
    const sheetH = Math.max(1, layer?.clientHeight || 1);
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
    this.syncCanvasPointerLayout();
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
        img.set({ perPixelTargetFind: false, objectCaching: false });
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
    return phCanvasPlacementInstanceId(placement);
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
    const sortedA = [...a].sort(
      (left, right) => this.placementKey(left).localeCompare(this.placementKey(right)),
    );
    const sortedB = [...b].sort(
      (left, right) => this.placementKey(left).localeCompare(this.placementKey(right)),
    );
    for (let index = 0; index < sortedA.length; index += 1) {
      const left = sortedA[index];
      const right = sortedB[index];
      if (this.placementKey(left) !== this.placementKey(right)) {
        return false;
      }
      if (left.zIndex !== right.zIndex) {
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

  /** Add a sidebar page to this sheet (same as drop). */
  async addFromPayload(payload: PhCanvasDragPayload): Promise<void> {
    await this.addPlacement(payload);
  }

  /** Add a new placement, sized to cover the sheet or at native px size, then persist. */
  private async addPlacement(payload: PhCanvasDragPayload): Promise<void> {
    const nextZ = this.model.reduce((max, p) => Math.max(max, p.zIndex), -1) + 1;
    const { sheetW, sheetH } = this.getSheetMetrics();
    const { nW, nH } = await this.resolveImagePixelSize(payload);
    const geometry = this.computeInitialPlacementGeometry(nW, nH, sheetW, sheetH);
    const placement: PhCanvasPlacement = {
      _id: phCanvasCreatePlacementId(),
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
      this.selectPlacementObject(added);
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
    this.restoreStackOrderFromModel();
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
        zIndex: base.zIndex,
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

  private emitSelectionChange(instanceId: string | null): void {
    this.selectionChange.emit(instanceId);
  }
}
