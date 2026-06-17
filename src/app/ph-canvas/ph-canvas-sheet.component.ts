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

const PERSIST_DEBOUNCE_MS = 600;

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

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.initCanvas();
    this.observeResize();
    this.model = this.clonePlacements(this.placements);
    this.rebuildObjects();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) {
      return;
    }
    if (changes['placements']) {
      // External update (load / server echo) — replace and rebuild without emitting.
      this.model = this.clonePlacements(this.placements);
      this.rebuildObjects();
    }
    if (changes['interactive'] && this.canvas) {
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
    this.applyInteractivity();
  }

  private applyInteractivity(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.selection = false;
    this.canvas.skipTargetFind = !this.interactive;
    for (const obj of this.canvas.getObjects()) {
      this.applyObjectControls(obj);
    }
    this.canvas.requestRenderAll();
  }

  private applyObjectControls(obj: FabricObject): void {
    obj.selectable = this.interactive;
    obj.evented = this.interactive;
    obj.hasControls = this.interactive;
    obj.hasBorders = this.interactive;
    obj.lockScalingFlip = true;
    obj.setControlsVisibility({
      mt: false,
      mb: false,
      ml: false,
      mr: false,
      tl: true,
      tr: true,
      bl: true,
      br: true,
      mtr: this.interactive,
    });
  }

  private measureHost(): { width: number; height: number } {
    const host = this.hostRef.nativeElement;
    return {
      width: host.clientWidth || 1,
      height: host.clientHeight || 1,
    };
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
    // Re-place objects to keep normalized geometry stable across resizes.
    this.rebuildObjects();
  }

  /** Rebuild all Fabric objects from the normalized model (no emit). */
  private async rebuildObjects(): Promise<void> {
    if (!this.canvas) {
      return;
    }
    this.suppressEmit = true;
    this.canvas.remove(...this.canvas.getObjects());

    const { width: W, height: H } = this.measureHost();
    const ordered = [...this.model].sort((a, b) => a.zIndex - b.zIndex);
    for (const placement of ordered) {
      const url = this.resolveUrl(placement);
      if (!url) {
        continue;
      }
      try {
        const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
        this.applyPlacementToImage(img, placement, W, H);
        this.applyObjectControls(img);
        (img as FabricObject & { phPlacement?: PhCanvasPlacement }).phPlacement = placement;
        this.canvas.add(img);
      } catch {
        // Ignore images that fail to load.
      }
    }
    this.canvas.requestRenderAll();
    this.suppressEmit = false;
  }

  private applyPlacementToImage(
    img: FabricImage,
    placement: PhCanvasPlacement,
    W: number,
    H: number,
  ): void {
    const nW = img.width || 1;
    const nH = img.height || 1;
    const targetW = Math.max(1, placement.width * W);
    const targetH = Math.max(1, placement.height * H);
    img.set({
      originX: 'left',
      originY: 'top',
      left: placement.x * W,
      top: placement.y * H,
      scaleX: targetW / nW,
      scaleY: targetH / nH,
      angle: placement.rotation || 0,
    });
    img.setCoords();
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

  /** Add a new placement covering the whole sheet, then persist. */
  private async addPlacement(payload: PhCanvasDragPayload): Promise<void> {
    const nextZ = this.model.reduce((max, p) => Math.max(max, p.zIndex), -1) + 1;
    const placement: PhCanvasPlacement = {
      fileId: payload.fileId,
      imageId: payload.imageId,
      page: payload.page ?? 1,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      zIndex: nextZ,
    };
    this.model = [...this.model, placement];
    await this.rebuildObjects();
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
    this.canvas.discardActiveObject();
    this.rebuildObjects();
    this.emitChange();
  }

  // --- Change capture --------------------------------------------------------

  private onObjectsChanged(): void {
    if (this.suppressEmit || !this.canvas) {
      return;
    }
    const { width: W, height: H } = this.measureHost();
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
        x: (obj.left ?? 0) / W,
        y: (obj.top ?? 0) / H,
        width: scaledW / W,
        height: scaledH / H,
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
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.placementsChange.emit(this.clonePlacements(this.model));
    }, PERSIST_DEBOUNCE_MS);
  }

  private clonePlacements(list: PhCanvasPlacement[]): PhCanvasPlacement[] {
    return (list ?? []).map((p) => ({ ...p }));
  }
}
