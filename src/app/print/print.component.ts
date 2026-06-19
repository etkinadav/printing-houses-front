import { HttpEventType } from '@angular/common/http';
import { Component, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { isEqual } from 'lodash';
import { Subscription, interval } from 'rxjs';
import { startWith, switchMap } from 'rxjs/operators';

import { AuthService } from '../auth/auth.service';
import { DirectionService } from '../direction.service';
import {
  PH_FILE_TYPE_PRINTING_FILE,
  PhFilesService,
} from '../ph-files/ph-files.service';
import {
  PhPrintingFile,
  PhPrintingFileImage,
  PhPrintingFilePrintSettings,
} from '../ph-printing-files/ph-printing-file.model';
import {
  ExtraSettingsUiStateMap,
  PrintExtraSettingRow,
  appendExtraSelectionsToPrintSettings,
  buildDefaultExtraUiStateMap,
  buildExtraSettingsContext,
  buildVisibleExtraSettingRows,
  EXTRA_OPTION_NONE_INDEX,
  productHasDoubleSidedRequired,
  reconcileExtraUiStateOnTreeChange,
  resolveSelectedDuplex,
  resolveSelectedCorner,
  resolveSelectedFolding,
  syncExtraUiStateFromSaved,
} from '../ph-printing-files/ph-print-extra-settings.util';
import { resolveMockupForPrint } from '../ph-printing-files/ph-print-mockup.util';
import { isColorTextureUrl } from '../ph-products/ph-color-texture.util';
import {
  PhColor,
  PhDynamicMaterial,
  ExtraSettingKey,
  PhMaterial,
  PhMockup,
  PhProduct,
  PhSize,
  CornerType,
} from '../ph-products/ph-product.model';
import { PhProductsService } from '../ph-products/ph-products.service';
import { PhPrintingHouse } from '../ph-printing-house/ph-printing-house.model';
import { PhPrintingHouseService } from '../ph-printing-house/ph-printing-house.service';
import { PhPrintingFilesService } from '../ph-printing-files/ph-printing-files.service';
import { PhCanvasService } from '../ph-canvas/ph-canvas.service';
import {
  PhCanvas,
  PhCanvasDragPayload,
  PhCanvasPlacement,
  PhCanvasSide,
  PhCanvasSideName,
  PH_CANVAS_DRAG_MIME,
  phCanvasNormalizeCanvasPlacements,
  phCanvasPlacementInstanceId,
  phCanvasProxiedImageUrl,
} from '../ph-canvas/ph-canvas.model';
import { renderCanvasSideComposite } from '../ph-canvas/ph-canvas-composite.util';
import { PhPrintPreviewComponent } from '../ph-print-preview/ph-print-preview.component';

interface FixedDimensionOption {
  optionIndex: number;
  sizeIndex: number;
  materialIndex: number;
  label: string;
}
import { EXPRESS_FILE_ACCEPT } from '../utils/ph-express-upload';
import { PhUploadValidationService } from '../utils/ph-upload-validation.service';

const POLL_MS = 4000;
/** Same threshold as mean-corse-01 printing-table additional controls at list end. */
/** Settings toggle groups wrap when label score exceeds this threshold. */
const SETTINGS_BUTTONS_WRAP_SCORE_THRESHOLD = 30;
/** Debounce for persisting canvas print settings to the API. */
const CANVAS_SETTINGS_PERSIST_DEBOUNCE_MS = 300;
/** Placements save immediately — object:modified already fires once per edit. */
const CANVAS_PLACEMENT_PERSIST_DEBOUNCE_MS = 0;

export interface FileListDisplayEntry {
  file: PhPrintingFile;
  images: PhPrintingFileImage[];
}

export interface PhCanvasLayerRow {
  instanceId: string;
  placement: PhCanvasPlacement;
  label: string;
  thumbnailUrl: string;
}

export type SidebarDisplayItem =
  | { kind: 'processing'; file: PhPrintingFile }
  | { kind: 'file-entry'; entry: FileListDisplayEntry };

@Component({
  selector: 'app-print',
  templateUrl: './print.component.html',
  styleUrls: ['./print.component.scss'],
  host: { class: 'fill-screen' },
})
export class PrintComponent implements OnInit, OnDestroy {
  isRTL = true;
  isDarkMode = false;

  printingHouseId = '';
  productId = '';
  productName = '';
  product: PhProduct | null = null;
  printingHouse: PhPrintingHouse | null = null;

  /** Files are only a source of draggable page-images now. */
  files: PhPrintingFile[] = [];
  processingFiles: PhPrintingFile[] = [];

  /** The single editing canvas — print settings + placements live here. */
  canvas: PhCanvas | null = null;

  /** When true, the preview pane shows the composite mockup instead of the editable sheet. */
  mockupViewActive = false;
  /** Duplex preview / mockup: visible side in the preview pane. */
  previewDuplexSide: PhCanvasSideName = 'front';
  /** Composite raster of each side's placements, fed to the mockup. */
  frontCompositeUrl: string | null = null;
  backCompositeUrl: string | null = null;

  previewSheetBackgroundStylesCache: Record<string, string> = { backgroundColor: '#ffffff' };

  /** Fixed: selected index in fixedDimensionOptions. */
  currentFixedOptionIndex: number | null = null;
  /** Dynamic/fixed: selected material index. */
  currentMaterialIndex: number | null = null;
  currentColorIndex: number | null = null;
  printingLengthCm = 0;
  printingWidthCm = 0;
  extraSettingsUi: ExtraSettingsUiStateMap = {};
  extraSettingRows: PrintExtraSettingRow[] = [];

  fixedDimensionOptions: FixedDimensionOption[] = [];

  uploading = false;
  uploadProgress = 0;
  uploadingCount = 0;
  readonly expressFileAccept = EXPRESS_FILE_ACCEPT;
  readonly singleOptionToggleValue = 0;
  readonly productNameToggle = 0;
  printSettingsExpanded = true;
  layersPanelExpanded = true;
  selectedLayerInstanceId: string | null = null;

  @ViewChild(PhPrintPreviewComponent) private printPreview?: PhPrintPreviewComponent;

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private pollSub?: Subscription;
  private activeUploads = 0;
  private uploadGeneration = 0;
  private activeUploadSubscriptions = new Set<Subscription>();
  private suppressSettingsPersist = false;
  private settingsPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private placementPersistTimers = new Map<PhCanvasSideName, ReturnType<typeof setTimeout>>();
  private placementPersistPending = new Map<PhCanvasSideName, PhCanvasPlacement[]>();
  private placementPersistSeq = new Map<PhCanvasSideName, number>();
  private compositeToken = 0;

  constructor(
    private route: ActivatedRoute,
    private directionService: DirectionService,
    private authService: AuthService,
    private phFilesService: PhFilesService,
    private phPrintingFilesService: PhPrintingFilesService,
    private phProductsService: PhProductsService,
    private phPrintingHouseService: PhPrintingHouseService,
    private phCanvasService: PhCanvasService,
    private translateService: TranslateService,
    private snackBar: MatSnackBar,
    private phUploadValidation: PhUploadValidationService,
  ) {}

  get finishedCount(): number {
    return this.files.length - this.processingFiles.length;
  }

  get hasFiles(): boolean {
    return this.files.length > 0;
  }

  get isFixedProduct(): boolean {
    return this.product?.properties?.dimensionsFlexability === 'fixed';
  }

  get isDynamicProduct(): boolean {
    return this.product?.properties?.dimensionsFlexability === 'dynamic';
  }

  get fixedSizes(): PhSize[] {
    return this.product?.properties?.fixed?.sizes ?? [];
  }

  get dynamicMaterials(): PhDynamicMaterial[] {
    return this.product?.properties?.dynamic?.materials ?? [];
  }

  get selectedDynamicMaterial(): PhDynamicMaterial | null {
    if (this.currentMaterialIndex == null) {
      return null;
    }
    const materials = this.dynamicMaterials;
    if (!materials.length) {
      return null;
    }
    const idx = Math.min(Math.max(0, this.currentMaterialIndex), materials.length - 1);
    return materials[idx] ?? null;
  }

  get settingsPanelFixedSize(): PhSize | null {
    if (this.selectedFixedSize) {
      return this.selectedFixedSize;
    }
    if (this.isFixedProduct && this.fixedSizes.length > 0) {
      const firstOption = this.fixedDimensionOptions[0];
      if (firstOption != null) {
        return this.fixedSizes[firstOption.sizeIndex] ?? this.fixedSizes[0] ?? null;
      }
      return this.fixedSizes[0] ?? null;
    }
    return null;
  }

  get settingsPanelMaterial(): PhMaterial | PhDynamicMaterial | null {
    if (this.selectedMaterial) {
      return this.selectedMaterial;
    }
    if (this.isDynamicProduct) {
      return this.dynamicMaterials[0] ?? null;
    }
    const materials = this.settingsPanelFixedSize?.materials ?? [];
    return materials[0] ?? null;
  }

  get dynamicMaterialForDimensionsPanel(): PhDynamicMaterial | null {
    return this.selectedDynamicMaterial ?? this.dynamicMaterials[0] ?? null;
  }

  get selectedFixedSize(): PhSize | null {
    const option = this.getSelectedFixedOption();
    if (!option) {
      return null;
    }
    return this.fixedSizes[option.sizeIndex] ?? null;
  }

  get fixedMaterialsForSelectedSize(): PhMaterial[] {
    return this.settingsPanelFixedSize?.materials ?? [];
  }

  get selectedFixedMaterial(): PhMaterial | null {
    if (this.currentMaterialIndex == null) {
      return null;
    }
    const materials = this.fixedMaterialsForSelectedSize;
    if (!materials.length) {
      return null;
    }
    const idx = Math.min(Math.max(0, this.currentMaterialIndex), materials.length - 1);
    return materials[idx] ?? null;
  }

  get selectedMaterial(): PhMaterial | null {
    if (this.isFixedProduct) {
      return this.selectedFixedMaterial;
    }
    if (this.isDynamicProduct) {
      return this.selectedDynamicMaterial;
    }
    return null;
  }

  get colorsForSelectedMaterial(): PhColor[] {
    return this.settingsPanelMaterial?.colors ?? [];
  }

  get selectedColor(): PhColor | null {
    if (this.currentColorIndex == null) {
      return null;
    }
    const colors = this.colorsForSelectedMaterial;
    if (!colors.length) {
      return null;
    }
    const idx = Math.min(Math.max(0, this.currentColorIndex), colors.length - 1);
    return colors[idx] ?? null;
  }

  get showPrintSettingsPanel(): boolean {
    return !!this.product;
  }

  /** Settings act on the canvas; enabled as soon as the canvas exists. */
  get settingsControlsDisabled(): boolean {
    return !this.canvas;
  }

  get materialToggleModel(): number | null {
    return this.settingsControlsDisabled ? null : this.currentMaterialIndex;
  }

  get colorToggleModel(): number | null {
    return this.settingsControlsDisabled ? null : this.currentColorIndex;
  }

  get fixedOptionToggleModel(): number | null {
    return this.settingsControlsDisabled ? null : this.currentFixedOptionIndex;
  }

  get singleOptionToggleModel(): number | null {
    return this.settingsControlsDisabled ? null : this.singleOptionToggleValue;
  }

  // --- Canvas sides / placements --------------------------------------------

  get isDoubleSided(): boolean {
    if (this.product && productHasDoubleSidedRequired(this.product)) {
      return true;
    }
    return this.canvas?.printSettings?.doubleSidedEnabled === true;
  }

  get canvasSides(): PhCanvasSideName[] {
    return this.isDoubleSided ? ['front', 'back'] : ['front'];
  }

  private getSide(side: PhCanvasSideName): PhCanvasSide | null {
    return this.canvas?.sides?.find((s) => s.side === side) ?? null;
  }

  get frontPlacements(): PhCanvasPlacement[] {
    return this.getSide('front')?.placements ?? [];
  }

  get backPlacements(): PhCanvasPlacement[] {
    return this.getSide('back')?.placements ?? [];
  }

  get showLayersPanel(): boolean {
    return !!this.canvas;
  }

  get layerRows(): PhCanvasLayerRow[] {
    const placements =
      this.previewDuplexSide === 'back' ? this.backPlacements : this.frontPlacements;
    return [...placements]
      .sort((left, right) => right.zIndex - left.zIndex)
      .map((placement) => this.buildLayerRow(placement));
  }

  // --- Preview dimensions / extras ------------------------------------------

  get previewBaseWidthCm(): number {
    if (this.isFixedProduct) {
      const size = this.selectedFixedSize ?? this.settingsPanelFixedSize;
      return Number(size?.width ?? 0);
    }
    if (this.isDynamicProduct) {
      return Number(this.printingWidthCm ?? 0);
    }
    return 0;
  }

  get previewBaseHeightCm(): number {
    if (this.isFixedProduct) {
      const size = this.selectedFixedSize ?? this.settingsPanelFixedSize;
      return Number(size?.length ?? 0);
    }
    if (this.isDynamicProduct) {
      return Number(this.printingLengthCm ?? 0);
    }
    return 0;
  }

  get resolvedPrintMockup(): PhMockup | null {
    return resolveMockupForPrint(
      this.getCurrentExtraSettingsContext(),
      this.extraSettingsUi,
      this.product?.properties?.dynamic?.mockup,
    );
  }

  get showMockupPreview(): boolean {
    return this.mockupViewActive && !!this.resolvedPrintMockup;
  }

  get previewMockupCompositeUrl(): string | null {
    return this.previewDuplexSide === 'back' ? this.backCompositeUrl : this.frontCompositeUrl;
  }

  onPreviewDuplexSideChange(side: PhCanvasSideName): void {
    this.previewDuplexSide = side;
    this.selectedLayerInstanceId = null;
  }

  get previewMarginCm(): number {
    return resolveSelectedDuplex(this.getCurrentExtraSettingsContext(), this.extraSettingsUi)?.size ?? 0;
  }

  get previewCornerType(): CornerType | 'none' {
    return resolveSelectedCorner(this.getCurrentExtraSettingsContext(), this.extraSettingsUi)?.type ?? 'none';
  }

  get previewCornerRadiusCm(): number {
    const radius = resolveSelectedCorner(
      this.getCurrentExtraSettingsContext(),
      this.extraSettingsUi,
    )?.radius;
    return Number.isFinite(Number(radius)) ? Number(radius) : 0;
  }

  get previewFoldingCount(): number {
    const count = resolveSelectedFolding(
      this.getCurrentExtraSettingsContext(),
      this.extraSettingsUi,
    )?.count;
    return Number.isFinite(Number(count)) ? Math.floor(Number(count)) : 0;
  }

  get previewFoldingOffsetCm(): number {
    const offset = resolveSelectedFolding(
      this.getCurrentExtraSettingsContext(),
      this.extraSettingsUi,
    )?.offset;
    return Number.isFinite(Number(offset)) ? Number(offset) : 0;
  }

  get previewSheetBackgroundStyles(): Record<string, string> {
    const color = this.selectedColor;
    const next = color
      ? this.getColorSwatchStyles(color)
      : { backgroundColor: '#ffffff' };
    if (isEqual(next, this.previewSheetBackgroundStylesCache)) {
      return this.previewSheetBackgroundStylesCache;
    }
    this.previewSheetBackgroundStylesCache = next;
    return this.previewSheetBackgroundStylesCache;
  }

  /** Representative thumbnail for the mobile mockup row. */
  get canvasPreviewThumbnailUrl(): string | null {
    const first = this.frontPlacements[0];
    if (first) {
      const file = this.files.find((f) => f._id === first.fileId);
      const image = file?.images?.find((im) => im._id === first.imageId);
      const url = image?.thumbnailUrl?.trim();
      if (url) {
        return url;
      }
    }
    return null;
  }

  get printingHouseLogoUrl(): string {
    const ph = this.printingHouse;
    return (ph?.logo?.url || ph?.logoUrl || '').trim();
  }

  get printingHouseAddressLine(): string {
    const addr = this.printingHouse?.address;
    if (!addr) {
      return '';
    }

    const parts: string[] = [];
    const streetLine = [addr.street, addr.houseNumber].filter((v) => !!v?.trim()).join(' ');
    if (streetLine) {
      parts.push(streetLine);
    }
    if (addr.city?.trim()) {
      parts.push(addr.city.trim());
    }

    const apartment = addr.apartment?.trim();
    if (apartment) {
      parts.push(`${this.translateService.instant('printing-house-join.apartment')} ${apartment}`);
    }

    const floor = addr.floor?.trim();
    if (floor) {
      parts.push(`${this.translateService.instant('printing-house-join.floor')} ${floor}`);
    }

    const notes = addr.notes?.trim();
    if (notes) {
      parts.push(notes);
    }

    return parts.join(', ');
  }

  ngOnInit(): void {
    this.directionSub = this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
    });
    this.darkModeSub = this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });

    this.route.queryParamMap.subscribe((params) => {
      const nextPrintingHouseId = params.get('printingHouseId')?.trim() || '';
      const nextProductId = params.get('productId')?.trim() || '';
      const productChanged = nextProductId !== this.productId;

      this.printingHouseId = nextPrintingHouseId;
      this.productId = nextProductId;

      if (productChanged) {
        this.resetSettingsUiState();
        this.canvas = null;
      }

      this.loadPrintingHouse();
      this.loadProduct();
      this.startPolling();
    });
  }

  ngOnDestroy(): void {
    this.directionSub?.unsubscribe();
    this.darkModeSub?.unsubscribe();
    this.pollSub?.unsubscribe();
    this.stopUploading();
    if (this.settingsPersistTimer) {
      clearTimeout(this.settingsPersistTimer);
    }
    this.flushPendingPlacements();
  }

  @HostListener('window:beforeunload')
  onBeforeUnload(): void {
    this.flushPendingPlacements();
  }

  isFileProcessing(file: PhPrintingFile): boolean {
    return file.processing || !(file.images && file.images.length > 0);
  }

  getFileImages(file: PhPrintingFile | null | undefined): PhPrintingFileImage[] {
    return file?.images ?? [];
  }

  isFileListEntryGroupedMultiPage(entry: FileListDisplayEntry): boolean {
    return entry.images.length > 1;
  }

  getSidebarDisplayItems(): SidebarDisplayItem[] {
    const items: SidebarDisplayItem[] = [];
    for (const file of this.files) {
      if (this.isFileProcessing(file)) {
        items.push({ kind: 'processing', file });
        continue;
      }
      items.push({
        kind: 'file-entry',
        entry: { file, images: this.getFileImages(file) },
      });
    }
    return items;
  }

  trackSidebarItem = (_index: number, item: SidebarDisplayItem): string => {
    if (item.kind === 'processing') {
      return `processing:${item.file._id}`;
    }
    return item.entry.file._id;
  };

  trackFileById(_index: number, file: PhPrintingFile): string {
    return file._id;
  }

  trackImageById(_index: number, image: PhPrintingFileImage): string {
    return image._id;
  }

  trackExtraSettingRow(_index: number, row: PrintExtraSettingRow): string {
    return row.key;
  }

  getDisplayFileName(file: PhPrintingFile): string {
    return file.originalFileName?.trim() || this.translateService.instant('printing-table.file');
  }

  // --- Drag source -----------------------------------------------------------

  onPageDragStart(
    event: DragEvent,
    file: PhPrintingFile,
    image: PhPrintingFileImage,
  ): void {
    if (!event.dataTransfer) {
      return;
    }
    const payload: PhCanvasDragPayload = {
      fileId: file._id,
      imageId: image._id,
      page: image.page ?? 1,
      thumbnailUrl: image.thumbnailUrl?.trim() || '',
      imageWidth: image.imageWidth ?? null,
      imageHeight: image.imageHeight ?? null,
      origImageDPI: image.origImageDPI ?? null,
    };
    const json = JSON.stringify(payload);
    event.dataTransfer.setData(PH_CANVAS_DRAG_MIME, json);
    event.dataTransfer.setData('text/plain', json);
    event.dataTransfer.effectAllowed = 'copy';
  }

  canDeletePageFromFile(file: PhPrintingFile): boolean {
    return this.getFileImages(file).length > 1;
  }

  getMaterialLabel(material: PhDynamicMaterial | PhMaterial): string {
    const base = material.label?.he?.trim() || '';
    const weight = material.weight;
    const hasWeight = weight != null && Number.isFinite(Number(weight));

    if (!base && !hasWeight) {
      return '';
    }
    if (!base && hasWeight) {
      return this.translateService.instant('printing-table.material-weight-only', {
        g: weight,
      });
    }
    if (base && !hasWeight) {
      return base;
    }
    return this.translateService.instant('printing-table.material-with-weight', {
      name: base,
      g: weight,
    });
  }

  settingsButtonsShouldWrap(labels: string[], extraPerButton = 0): boolean {
    const count = labels.length;
    if (count === 0) {
      return false;
    }
    const letterSum = labels.reduce(
      (sum, label) => sum + (label?.trim().length ?? 0) + extraPerButton,
      0,
    );
    const score = letterSum + (count - 1) * 5;
    return score > SETTINGS_BUTTONS_WRAP_SCORE_THRESHOLD;
  }

  get productSettingsWrap(): boolean {
    return this.settingsButtonsShouldWrap([this.productName]);
  }

  get fixedTypeSettingsWrap(): boolean {
    return this.settingsButtonsShouldWrap(
      this.fixedDimensionOptions.map((option) => option.label),
    );
  }

  get fixedMaterialSettingsWrap(): boolean {
    return this.settingsButtonsShouldWrap(
      this.fixedMaterialsForSelectedSize.map((material) => this.getMaterialLabel(material)),
    );
  }

  get dynamicMaterialSettingsWrap(): boolean {
    return this.settingsButtonsShouldWrap(
      this.dynamicMaterials.map((material) => this.getMaterialLabel(material)),
    );
  }

  get colorSettingsWrap(): boolean {
    return this.settingsButtonsShouldWrap(
      this.colorsForSelectedMaterial.map((color) => this.getColorLabel(color)),
      3,
    );
  }

  getColorLabel(color: PhColor): string {
    return color.label?.he?.trim() || '—';
  }

  getColorSwatchStyles(color: PhColor): Record<string, string> {
    const raw = color.color?.trim() || '#cccccc';
    if (isColorTextureUrl(raw)) {
      return {
        backgroundColor: '#e8e8e8',
        backgroundImage: `url("${raw}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      };
    }
    return { backgroundColor: raw };
  }

  getFixedSizeDisplayLabel(size: PhSize): string {
    const sizeLabel = size.label?.he?.trim();
    if (sizeLabel) {
      return sizeLabel;
    }
    return `${size.length}×${size.width}`;
  }

  onFixedOptionChange(optionIndex: number): void {
    if (this.suppressSettingsPersist || !Number.isInteger(optionIndex)) {
      return;
    }
    const option = this.fixedDimensionOptions[optionIndex];
    const size = option ? this.fixedSizes[option.sizeIndex] : null;
    if (!option || !size) {
      return;
    }

    const previousOption = this.getSelectedFixedOption();
    const previousSize = previousOption ? this.fixedSizes[previousOption.sizeIndex] : null;
    const previousMaterials = previousSize?.materials ?? [];
    const previousMaterial = this.getMaterialAtIndex(previousMaterials, this.currentMaterialIndex);
    const previousColor = this.getColorAtIndex(previousMaterial, this.currentColorIndex);
    const previousExtraCtx = buildExtraSettingsContext(previousSize, previousMaterial, previousColor);
    const previousExtraUi = { ...this.extraSettingsUi };

    const previousMaterialLabel = previousMaterial ? this.getMaterialLabel(previousMaterial) : '';
    const previousColorLabel = this.getColorLabelAtIndex(previousMaterial, this.currentColorIndex);

    this.currentFixedOptionIndex = optionIndex;
    const newMaterials = size.materials ?? [];
    this.currentMaterialIndex = this.findMatchingMaterialIndex(newMaterials, previousMaterialLabel);
    const newMaterial = newMaterials[this.currentMaterialIndex] ?? null;
    this.currentColorIndex = this.findMatchingColorIndex(
      newMaterial?.colors ?? [],
      previousColorLabel,
    );
    this.extraSettingsUi = reconcileExtraUiStateOnTreeChange(
      buildExtraSettingsContext(
        size,
        newMaterial,
        this.getColorAtIndex(newMaterial, this.currentColorIndex),
      ),
      previousExtraCtx,
      previousExtraUi,
    );
    this.rebuildExtraSettingRows();
    this.printingLengthCm = Number(size.length);
    this.printingWidthCm = Number(size.width);
    this.persistCanvasSettings();
  }

  onMaterialChange(materialIndex: number): void {
    if (this.suppressSettingsPersist || !Number.isInteger(materialIndex)) {
      return;
    }

    if (this.isDynamicProduct) {
      const materials = this.dynamicMaterials;
      if (!materials.length || materialIndex < 0 || materialIndex >= materials.length) {
        return;
      }
      const previousMaterial = materials[this.currentMaterialIndex ?? 0] ?? null;
      const previousColor = this.getColorAtIndex(previousMaterial, this.currentColorIndex);
      const previousExtraCtx = buildExtraSettingsContext(null, previousMaterial, previousColor);
      const previousExtraUi = { ...this.extraSettingsUi };
      const previousColorLabel = this.getColorLabelAtIndex(previousMaterial, this.currentColorIndex);
      this.currentMaterialIndex = materialIndex;
      const material = materials[materialIndex];
      this.currentColorIndex = this.findMatchingColorIndex(
        material?.colors ?? [],
        previousColorLabel,
      );
      this.extraSettingsUi = reconcileExtraUiStateOnTreeChange(
        buildExtraSettingsContext(
          null,
          material,
          this.getColorAtIndex(material, this.currentColorIndex),
        ),
        previousExtraCtx,
        previousExtraUi,
      );
      this.rebuildExtraSettingRows();
      if (
        !this.areDynamicDimensionsValid(material, this.printingLengthCm, this.printingWidthCm)
      ) {
        this.printingLengthCm = Number(material.defaultLength);
        this.printingWidthCm = Number(material.defaultHeight);
      }
      this.persistCanvasSettings();
      return;
    }

    if (this.isFixedProduct) {
      const materials = this.fixedMaterialsForSelectedSize;
      if (!materials.length || materialIndex < 0 || materialIndex >= materials.length) {
        return;
      }
      const previousMaterial = materials[this.currentMaterialIndex ?? 0] ?? null;
      const previousColor = this.getColorAtIndex(previousMaterial, this.currentColorIndex);
      const previousExtraCtx = buildExtraSettingsContext(
        this.selectedFixedSize,
        previousMaterial,
        previousColor,
      );
      const previousExtraUi = { ...this.extraSettingsUi };
      const previousColorLabel = this.getColorLabelAtIndex(previousMaterial, this.currentColorIndex);
      this.currentMaterialIndex = materialIndex;
      const material = materials[materialIndex];
      this.currentColorIndex = this.findMatchingColorIndex(
        material?.colors ?? [],
        previousColorLabel,
      );
      this.extraSettingsUi = reconcileExtraUiStateOnTreeChange(
        buildExtraSettingsContext(
          this.selectedFixedSize,
          material,
          this.getColorAtIndex(material, this.currentColorIndex),
        ),
        previousExtraCtx,
        previousExtraUi,
      );
      this.rebuildExtraSettingRows();
      this.persistCanvasSettings();
    }
  }

  onColorChange(colorIndex: number): void {
    if (this.suppressSettingsPersist) {
      return;
    }
    const colors = this.colorsForSelectedMaterial;
    if (!colors.length || colorIndex < 0 || colorIndex >= colors.length) {
      return;
    }
    const previousExtraCtx = this.getCurrentExtraSettingsContext();
    const previousExtraUi = { ...this.extraSettingsUi };
    this.currentColorIndex = colorIndex;
    this.extraSettingsUi = reconcileExtraUiStateOnTreeChange(
      this.getCurrentExtraSettingsContext(),
      previousExtraCtx,
      previousExtraUi,
    );
    this.rebuildExtraSettingRows();
    this.persistCanvasSettings();
  }

  onExtraSettingEnabledChange(key: ExtraSettingKey, enabled: boolean): void {
    if (this.suppressSettingsPersist || this.settingsControlsDisabled) {
      return;
    }
    const current = this.extraSettingsUi[key] ?? { selectedIndex: 0, enabled: false };
    this.extraSettingsUi = {
      ...this.extraSettingsUi,
      [key]: { ...current, enabled },
    };
    this.rebuildExtraSettingRows();
    this.persistCanvasSettings();
  }

  onExtraSettingIndexChange(key: ExtraSettingKey, index: number): void {
    if (this.suppressSettingsPersist || this.settingsControlsDisabled || !Number.isInteger(index)) {
      return;
    }
    const current = this.extraSettingsUi[key] ?? { selectedIndex: 0, enabled: true };
    this.extraSettingsUi = {
      ...this.extraSettingsUi,
      [key]: { ...current, selectedIndex: index, enabled: true },
    };
    this.rebuildExtraSettingRows();
    this.persistCanvasSettings();
  }

  getExtraOptionToggleValue(key: ExtraSettingKey): number | null {
    if (this.settingsControlsDisabled) {
      return null;
    }
    const state = this.extraSettingsUi[key];
    if (!state?.enabled) {
      return EXTRA_OPTION_NONE_INDEX;
    }
    return state.selectedIndex ?? 0;
  }

  getExtraBooleanToggleValue(key: ExtraSettingKey): boolean | null {
    if (this.settingsControlsDisabled) {
      return null;
    }
    const enabled = this.extraSettingsUi[key]?.enabled;
    return enabled == null ? null : enabled;
  }

  onExtraOptionToggleChange(key: ExtraSettingKey, value: number): void {
    if (this.suppressSettingsPersist || !Number.isInteger(value)) {
      return;
    }
    if (value === EXTRA_OPTION_NONE_INDEX) {
      this.onExtraSettingEnabledChange(key, false);
      return;
    }
    this.onExtraSettingIndexChange(key, value);
  }

  private getSelectedFixedOption(): FixedDimensionOption | null {
    if (this.currentFixedOptionIndex == null) {
      return null;
    }
    return this.fixedDimensionOptions[this.currentFixedOptionIndex] ?? null;
  }

  private findFixedOptionIndex(sizeIndex: number): number {
    const idx = this.fixedDimensionOptions.findIndex((option) => option.sizeIndex === sizeIndex);
    return idx >= 0 ? idx : 0;
  }

  onPrintingLengthBlur(): void {
    this.onDimensionBlur('L');
  }

  onPrintingWidthBlur(): void {
    this.onDimensionBlur('W');
  }

  swapWidthHeight(): void {
    const temp = this.printingWidthCm;
    this.printingWidthCm = this.roundCm(this.printingLengthCm) ?? this.printingLengthCm;
    this.printingLengthCm = this.roundCm(temp) ?? temp;
    this.persistCanvasSettings();
  }

  triggerFilePicker(input: HTMLInputElement): void {
    if (this.uploading) {
      return;
    }
    input.click();
  }

  stopUploading(): void {
    this.uploadGeneration += 1;
    for (const sub of this.activeUploadSubscriptions) {
      sub.unsubscribe();
    }
    this.activeUploadSubscriptions.clear();
    this.activeUploads = 0;
    this.uploadingCount = 0;
    this.uploading = false;
    this.uploadProgress = 0;
  }

  stopUploadEvent(event: Event): void {
    event.stopPropagation();
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files || []);
    input.value = '';

    if (!picked.length) {
      return;
    }

    if (!this.authService.getIsAuth()) {
      this.snackBar.open(
        this.translateService.instant('ph-print.login-required'),
        undefined,
        { duration: 4000 },
      );
      return;
    }

    for (const file of picked) {
      this.uploadFile(file);
    }
  }

  togglePrintSettingsExpanded(): void {
    this.printSettingsExpanded = !this.printSettingsExpanded;
  }

  toggleLayersPanelExpanded(): void {
    this.layersPanelExpanded = !this.layersPanelExpanded;
  }

  trackLayerRow(_index: number, row: PhCanvasLayerRow): string {
    return row.instanceId;
  }

  onLayerSelectionChange(payload: { side: PhCanvasSideName; instanceId: string | null }): void {
    if (payload.side !== this.previewDuplexSide) {
      return;
    }
    this.selectedLayerInstanceId = payload.instanceId;
  }

  onLayerEdit(row: PhCanvasLayerRow): void {
    this.selectedLayerInstanceId = row.instanceId;
    this.printPreview?.focusPlacementInstance(this.previewDuplexSide, row.instanceId);
  }

  onLayerRowClick(event: MouseEvent, row: PhCanvasLayerRow): void {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    this.onLayerEdit(row);
  }

  onLayerDelete(row: PhCanvasLayerRow): void {
    this.printPreview?.removePlacementInstance(this.previewDuplexSide, row.instanceId);
    if (this.selectedLayerInstanceId === row.instanceId) {
      this.selectedLayerInstanceId = null;
    }
  }

  onLayerDrop(event: CdkDragDrop<PhCanvasLayerRow[]>): void {
    const rows = [...this.layerRows];
    moveItemInArray(rows, event.previousIndex, event.currentIndex);
    const count = rows.length;
    const nextPlacements = rows.map((row, displayIndex) => ({
      ...row.placement,
      zIndex: count - 1 - displayIndex,
    }));
    this.onSheetPlacementsChange({
      side: this.previewDuplexSide,
      placements: nextPlacements,
    });
  }

  private buildLayerRow(placement: PhCanvasPlacement): PhCanvasLayerRow {
    const file = this.files.find((entry) => entry._id === placement.fileId);
    const image = file?.images?.find((entry) => entry._id === placement.imageId);
    const name = file
      ? this.getDisplayFileName(file)
      : this.translateService.instant('printing-table.file');
    const page = placement.page ?? image?.page ?? 1;
    return {
      instanceId: phCanvasPlacementInstanceId(placement),
      placement,
      label: this.translateService.instant('ph-print.file-page-label', { name, page }),
      thumbnailUrl:
        phCanvasProxiedImageUrl(image?.thumbnailUrl?.trim() || '') ||
        'assets/images/no-img.svg',
    };
  }

  onMockupClick(event?: Event): void {
    event?.stopPropagation();
    const mockup = this.resolvedPrintMockup;
    if (!mockup) {
      this.snackBar.open(
        this.translateService.instant('printing-table.mockup-not-available'),
        undefined,
        { duration: 4000 },
      );
      return;
    }
    this.mockupViewActive = !this.mockupViewActive;
    if (this.mockupViewActive) {
      this.rebuildComposites();
    }
  }

  onContinue(): void {
    // Placeholder — next checkout step will be wired later.
  }

  onDeleteFile(file: PhPrintingFile, event?: Event): void {
    event?.stopPropagation();

    if (this.uploading || !file?._id) {
      return;
    }

    this.phPrintingFilesService.deleteFile(file._id).subscribe({
      next: () => {
        this.removeFileFromLocalState(file._id);
        this.pruneCanvasPlacementsForFile(file._id);
      },
      error: () => {
        this.snackBar.open(
          this.translateService.instant('ph-print.delete-failed'),
          undefined,
          { duration: 4000 },
        );
      },
    });
  }

  onDeleteFileOrImage(
    file: PhPrintingFile,
    image: PhPrintingFileImage,
    forceDeleteFile = false,
    event?: Event,
  ): void {
    event?.stopPropagation();

    if (this.uploading || !file?._id || !image?._id) {
      return;
    }

    const deleteWholeFile =
      forceDeleteFile ||
      this.isFileProcessing(file) ||
      this.getFileImages(file).length <= 1;

    if (deleteWholeFile) {
      this.onDeleteFile(file);
      return;
    }

    this.phPrintingFilesService
      .deleteImage(file._id, image._id, this.productId, this.printingHouseId)
      .subscribe({
        next: (response) => {
          if (response.deletedFileId) {
            this.removeFileFromLocalState(file._id);
          } else if (response.file) {
            const fileIndex = this.files.findIndex((f) => f._id === file._id);
            if (fileIndex >= 0) {
              this.files[fileIndex] = response.file;
            }
          } else {
            const fileIndex = this.files.findIndex((f) => f._id === file._id);
            if (fileIndex >= 0) {
              this.files[fileIndex] = {
                ...this.files[fileIndex],
                images: this.getFileImages(this.files[fileIndex]).filter(
                  (img) => img._id !== image._id,
                ),
              };
            }
          }
          this.pruneCanvasPlacementsForImage(file._id, image._id);
        },
        error: () => {
          this.snackBar.open(
            this.translateService.instant('ph-print.delete-failed'),
            undefined,
            { duration: 4000 },
          );
        },
      });
  }

  private removeFileFromLocalState(fileId: string): void {
    this.files = this.files.filter((f) => f._id !== fileId);
    this.processingFiles = this.processingFiles.filter((f) => f._id !== fileId);
  }

  onDeleteAllFiles(): void {
    if (this.uploading || !this.hasFiles) {
      return;
    }

    this.phPrintingFilesService.deleteAll(this.printingHouseId).subscribe({
      next: () => {
        this.files = [];
        this.processingFiles = [];
        this.clearAllCanvasPlacements();
      },
      error: () => {
        this.snackBar.open(
          this.translateService.instant('ph-print.delete-all-failed'),
          undefined,
          { duration: 4000 },
        );
      },
    });
  }

  // --- Canvas placements -----------------------------------------------------

  onSheetPlacementsChange(payload: { side: PhCanvasSideName; placements: PhCanvasPlacement[] }): void {
    if (!this.canvas) {
      return;
    }
    const side = this.getSide(payload.side);
    if (side) {
      // Mutate in place so the canvas sheet @Input reference stays stable (no re-sync flicker).
      side.placements.splice(0, side.placements.length, ...payload.placements);
    } else {
      this.canvas.sides = [
        ...this.canvas.sides,
        { side: payload.side, placements: [...payload.placements] },
      ];
    }
    this.printPreview?.syncPlacementsFromParent(payload.side, payload.placements);
    this.persistSidePlacements(payload.side, payload.placements);
    if (this.mockupViewActive) {
      this.rebuildComposites();
    }
  }

  private persistSidePlacements(side: PhCanvasSideName, placements: PhCanvasPlacement[]): void {
    if (!this.canvas?._id) {
      return;
    }
    this.placementPersistPending.set(side, placements.map((p) => ({ ...p })));
    const existing = this.placementPersistTimers.get(side);
    if (existing) {
      clearTimeout(existing);
    }
    const canvasId = this.canvas._id;
    const seq = (this.placementPersistSeq.get(side) ?? 0) + 1;
    this.placementPersistSeq.set(side, seq);
    const snapshot = placements.map((p) => ({ ...p }));
    const timer = setTimeout(() => {
      this.placementPersistTimers.delete(side);
      this.placementPersistPending.delete(side);
      this.phCanvasService
        .updateSidePlacements(canvasId, side, snapshot)
        .subscribe({
          next: () => {
            if (this.placementPersistSeq.get(side) === seq) {
              this.placementPersistSeq.delete(side);
            }
          },
          error: () => {
            // Restore pending so a flush / next edit can retry.
            this.placementPersistPending.set(side, snapshot);
          },
        });
    }, CANVAS_PLACEMENT_PERSIST_DEBOUNCE_MS);
    this.placementPersistTimers.set(side, timer);
  }

  /** Push any debounced placement writes before navigation / refresh. */
  private flushPendingPlacements(): void {
    if (!this.canvas?._id) {
      return;
    }
    const canvasId = this.canvas._id;
    for (const timer of this.placementPersistTimers.values()) {
      clearTimeout(timer);
    }
    this.placementPersistTimers.clear();
    for (const [side, placements] of this.placementPersistPending.entries()) {
      this.placementPersistPending.delete(side);
      this.phCanvasService.updateSidePlacements(canvasId, side, placements).subscribe({
        error: () => {},
      });
    }
  }

  private pruneCanvasPlacementsForFile(fileId: string): void {
    if (!this.canvas) {
      return;
    }
    for (const side of this.canvas.sides) {
      const next = side.placements.filter((p) => p.fileId !== fileId);
      if (next.length !== side.placements.length) {
        side.placements = next;
        this.persistSidePlacements(side.side, next);
      }
    }
  }

  private pruneCanvasPlacementsForImage(fileId: string, imageId: string): void {
    if (!this.canvas) {
      return;
    }
    for (const side of this.canvas.sides) {
      const next = side.placements.filter(
        (p) => !(p.fileId === fileId && p.imageId === imageId),
      );
      if (next.length !== side.placements.length) {
        side.placements = next;
        this.persistSidePlacements(side.side, next);
      }
    }
  }

  private clearAllCanvasPlacements(): void {
    if (!this.canvas) {
      return;
    }
    for (const side of this.canvas.sides) {
      if (side.placements.length) {
        side.placements = [];
        this.persistSidePlacements(side.side, []);
      }
    }
  }

  // --- Composite mockup ------------------------------------------------------

  private rebuildComposites(): void {
    const token = ++this.compositeToken;
    const widthCm = this.previewBaseWidthCm;
    const heightCm = this.previewBaseHeightCm;

    renderCanvasSideComposite(this.frontPlacements, this.files, widthCm, heightCm).then((url) => {
      if (token === this.compositeToken) {
        this.frontCompositeUrl = url;
      }
    });

    if (this.isDoubleSided) {
      renderCanvasSideComposite(this.backPlacements, this.files, widthCm, heightCm).then((url) => {
        if (token === this.compositeToken) {
          this.backCompositeUrl = url;
        }
      });
    } else {
      this.backCompositeUrl = null;
    }
  }

  // --- Data loading ----------------------------------------------------------

  private loadPrintingHouse(): void {
    this.printingHouse = null;
    if (!this.printingHouseId) {
      return;
    }

    this.phPrintingHouseService.getPrintingHousePublic(this.printingHouseId).subscribe({
      next: (res) => {
        this.printingHouse = res.printingHouse ?? null;
      },
      error: () => {
        this.printingHouse = null;
      },
    });
  }

  private loadProduct(): void {
    this.product = null;
    this.productName = '';
    this.rebuildProductOptionCaches();
    if (!this.printingHouseId || !this.productId) {
      return;
    }

    this.phProductsService.getProductsByPrintingHousePublic(this.printingHouseId).subscribe({
      next: (res) => {
        const product =
          (res.products ?? []).find((p: PhProduct) => p._id === this.productId) ?? null;
        this.product = product;
        this.productName = product?.name_he?.trim() || '';
        this.rebuildProductOptionCaches();
        this.loadCanvas();
      },
    });
  }

  private loadCanvas(): void {
    if (!this.productId) {
      return;
    }
    this.phCanvasService.getCurrent(this.productId, this.printingHouseId).subscribe({
      next: (res) => this.applyCanvasFromServer(res.canvas, true),
      error: () => {},
    });
  }

  private applyCanvasFromServer(canvas: PhCanvas, syncUi = false): void {
    this.canvas = phCanvasNormalizeCanvasPlacements(canvas);
    if (syncUi) {
      this.syncSettingsUiFromSettings(canvas.printSettings ?? {});
    }
    if (this.mockupViewActive) {
      this.rebuildComposites();
    }
  }

  private rebuildProductOptionCaches(): void {
    const options: FixedDimensionOption[] = [];
    const sizes = this.fixedSizes;

    for (let sizeIndex = 0; sizeIndex < sizes.length; sizeIndex += 1) {
      const size = sizes[sizeIndex];
      options.push({
        optionIndex: sizeIndex,
        sizeIndex,
        materialIndex: 0,
        label: this.getFixedSizeDisplayLabel(size),
      });
    }

    this.fixedDimensionOptions = options;
  }

  private resetSettingsUiState(): void {
    this.currentFixedOptionIndex = null;
    this.currentMaterialIndex = null;
    this.currentColorIndex = null;
    this.extraSettingsUi = {};
    this.extraSettingRows = [];
    this.printingLengthCm = 0;
    this.printingWidthCm = 0;
    this.mockupViewActive = false;
    this.frontCompositeUrl = null;
    this.backCompositeUrl = null;
  }

  private rebuildExtraSettingRows(): void {
    if (!this.product) {
      this.extraSettingRows = [];
      return;
    }
    this.extraSettingRows = buildVisibleExtraSettingRows(
      this.getCurrentExtraSettingsContext(),
      this.extraSettingsUi,
      (key, params) => this.translateService.instant(key, params),
    );
  }

  private getCurrentExtraSettingsContext() {
    const size = this.settingsPanelFixedSize;
    const material = this.settingsPanelMaterial;
    const color = this.selectedColor ?? this.getColorAtIndex(material, 0);
    return buildExtraSettingsContext(size, material, color);
  }

  private getColorAtIndex(
    material: PhMaterial | PhDynamicMaterial | null | undefined,
    colorIndex: number | null,
  ): PhColor | null {
    if (colorIndex == null) {
      return null;
    }
    const colors = material?.colors ?? [];
    if (!colors.length) {
      return null;
    }
    const idx = Math.min(Math.max(0, colorIndex), colors.length - 1);
    return colors[idx] ?? null;
  }

  private appendExtrasToSettings(
    settings: PhPrintingFilePrintSettings,
  ): PhPrintingFilePrintSettings {
    return appendExtraSelectionsToPrintSettings(
      settings,
      this.getCurrentExtraSettingsContext(),
      this.extraSettingsUi,
    );
  }

  private getMaterialAtIndex(
    materials: PhMaterial[],
    materialIndex: number | null,
  ): PhMaterial | null {
    if (materialIndex == null || !materials.length) {
      return null;
    }
    const idx = Math.min(Math.max(0, materialIndex), materials.length - 1);
    return materials[idx] ?? null;
  }

  private getColorLabelAtIndex(
    material: PhMaterial | PhDynamicMaterial | null | undefined,
    colorIndex: number | null,
  ): string {
    const colors = material?.colors ?? [];
    if (!colors.length || colorIndex == null) {
      return '';
    }
    const idx = Math.min(Math.max(0, colorIndex), colors.length - 1);
    const color = colors[idx];
    return color ? this.getColorLabel(color) : '';
  }

  private findMatchingMaterialIndex(materials: PhMaterial[], label: string): number {
    const target = label.trim();
    if (!target || !materials.length) {
      return 0;
    }
    const idx = materials.findIndex((material) => this.getMaterialLabel(material) === target);
    if (idx >= 0) {
      return idx;
    }
    const legacyIdx = materials.findIndex(
      (material) => (material.label?.he?.trim() || '') === target,
    );
    return legacyIdx >= 0 ? legacyIdx : 0;
  }

  private findMatchingColorIndex(colors: PhColor[], label: string): number {
    const target = label.trim();
    if (!target || !colors.length) {
      return 0;
    }
    const idx = colors.findIndex((color) => this.getColorLabel(color) === target);
    return idx >= 0 ? idx : 0;
  }

  private resolveColorIndexForMaterial(
    material: PhMaterial | PhDynamicMaterial | null | undefined,
    colorIndex: number,
  ): number {
    const colors = material?.colors ?? [];
    if (!colors.length) {
      return 0;
    }
    if (Number.isInteger(colorIndex) && colorIndex >= 0 && colorIndex < colors.length) {
      return colorIndex;
    }
    return 0;
  }

  private appendColorIndexToSettings(
    settings: PhPrintingFilePrintSettings,
    material: PhMaterial | PhDynamicMaterial | null | undefined,
  ): PhPrintingFilePrintSettings {
    const colors = material?.colors ?? [];
    if (!colors.length || this.currentColorIndex == null) {
      return settings;
    }
    return {
      ...settings,
      colorIndex: Math.min(Math.max(0, this.currentColorIndex), colors.length - 1),
    };
  }

  private startPolling(): void {
    this.pollSub?.unsubscribe();
    if (!this.authService.getIsAuth()) {
      return;
    }

    this.pollSub = interval(POLL_MS)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.phPrintingFilesService.getMyFiles(this.printingHouseId, this.productId),
        ),
      )
      .subscribe({
        next: (res) => this.applyFilesFromServer(res.files ?? []),
        error: () => {},
      });
  }

  private applyFilesFromServer(nextFiles: PhPrintingFile[]): void {
    if (this.isSameFileListPollState(nextFiles, this.files)) {
      return;
    }
    this.files = nextFiles;
    this.processingFiles = nextFiles.filter((file) => this.isFileProcessing(file));
  }

  private isSameFileListPollState(
    incoming: PhPrintingFile[],
    current: PhPrintingFile[],
  ): boolean {
    if (incoming.length !== current.length) {
      return false;
    }
    const currentById = new Map(current.map((file) => [file._id, file]));
    for (const next of incoming) {
      const prev = currentById.get(next._id);
      if (!prev || !this.isSameFilePollState(prev, next)) {
        return false;
      }
    }
    return true;
  }

  private isSameFilePollState(prev: PhPrintingFile, next: PhPrintingFile): boolean {
    return (
      prev.processing === next.processing &&
      this.imagesStructureEqual(prev.images, next.images)
    );
  }

  private imagesStructureEqual(
    a: PhPrintingFileImage[] | undefined,
    b: PhPrintingFileImage[] | undefined,
  ): boolean {
    const aa = a ?? [];
    const bb = b ?? [];
    if (aa.length !== bb.length) {
      return false;
    }
    for (let i = 0; i < aa.length; i += 1) {
      if (aa[i]._id !== bb[i]._id) {
        return false;
      }
      if ((aa[i].thumbnailUrl ?? '') !== (bb[i].thumbnailUrl ?? '')) {
        return false;
      }
    }
    return true;
  }

  private syncSettingsUiFromSettings(ps: PhPrintingFilePrintSettings): void {
    if (!this.product) {
      return;
    }

    this.suppressSettingsPersist = true;
    try {
      if (this.isFixedProduct) {
        const sizeIndex =
          ps?.sizeIndex != null && Number.isFinite(Number(ps.sizeIndex))
            ? Number(ps.sizeIndex)
            : 0;
        const materialIndex =
          ps?.materialIndex != null && Number.isFinite(Number(ps.materialIndex))
            ? Number(ps.materialIndex)
            : 0;
        const size = this.fixedSizes[sizeIndex] ?? this.fixedSizes[0];
        const materials = size?.materials ?? [];
        this.currentFixedOptionIndex = this.findFixedOptionIndex(sizeIndex);
        const resolvedMaterialIndex =
          materials.length && materialIndex >= 0 && materialIndex < materials.length
            ? materialIndex
            : 0;
        this.currentMaterialIndex = resolvedMaterialIndex;
        this.currentColorIndex = this.resolveColorIndexForMaterial(
          materials[resolvedMaterialIndex],
          ps?.colorIndex != null && Number.isFinite(Number(ps.colorIndex))
            ? Number(ps.colorIndex)
            : 0,
        );
        this.printingLengthCm = Number(ps?.lengthCm ?? size?.length ?? 0);
        this.printingWidthCm = Number(ps?.widthCm ?? size?.width ?? 0);
        this.extraSettingsUi = syncExtraUiStateFromSaved(
          buildExtraSettingsContext(
            size,
            materials[resolvedMaterialIndex] ?? null,
            this.getColorAtIndex(materials[resolvedMaterialIndex], this.currentColorIndex),
          ),
          ps,
        );
        return;
      }

      if (this.isDynamicProduct) {
        const materialIndex =
          ps?.materialIndex != null && Number.isFinite(Number(ps.materialIndex))
            ? Number(ps.materialIndex)
            : 0;
        const material = this.dynamicMaterials[materialIndex] ?? this.dynamicMaterials[0];
        this.currentMaterialIndex = material ? materialIndex : 0;
        this.currentColorIndex = this.resolveColorIndexForMaterial(
          material,
          ps?.colorIndex != null && Number.isFinite(Number(ps.colorIndex))
            ? Number(ps.colorIndex)
            : 0,
        );
        this.printingLengthCm = Number(ps?.lengthCm ?? material?.defaultLength ?? 0);
        this.printingWidthCm = Number(ps?.widthCm ?? material?.defaultHeight ?? 0);
        this.extraSettingsUi = syncExtraUiStateFromSaved(
          buildExtraSettingsContext(
            null,
            material,
            this.getColorAtIndex(material, this.currentColorIndex),
          ),
          ps,
        );
      }
    } finally {
      this.rebuildExtraSettingRows();
      setTimeout(() => {
        this.suppressSettingsPersist = false;
      });
    }
  }

  private buildSettingsFromUi(): PhPrintingFilePrintSettings | null {
    if (!this.product) {
      return null;
    }
    if (this.isFixedProduct) {
      const option = this.getSelectedFixedOption();
      const size = option ? this.fixedSizes[option.sizeIndex] : null;
      if (!option || !size || this.currentMaterialIndex == null) {
        return null;
      }
      const materials = size.materials ?? [];
      const materialIndex = Math.min(
        Math.max(0, this.currentMaterialIndex),
        Math.max(0, materials.length - 1),
      );
      const material = materials[materialIndex] ?? null;
      return this.appendExtrasToSettings(
        this.appendColorIndexToSettings(
          {
            paperType: material ? this.getMaterialLabel(material) : option.label,
            sizeIndex: option.sizeIndex,
            materialIndex,
            lengthCm: Number(size.length),
            widthCm: Number(size.width),
          },
          material,
        ),
      );
    }
    if (this.isDynamicProduct) {
      const material = this.selectedDynamicMaterial;
      if (!material || this.currentMaterialIndex == null) {
        return null;
      }
      return this.appendExtrasToSettings(
        this.appendColorIndexToSettings(
          {
            paperType: this.getMaterialLabel(material),
            materialIndex: this.currentMaterialIndex,
            lengthCm: this.roundCm(this.printingLengthCm) ?? this.printingLengthCm,
            widthCm: this.roundCm(this.printingWidthCm) ?? this.printingWidthCm,
          },
          material,
        ),
      );
    }
    return null;
  }

  private persistCanvasSettings(): void {
    if (!this.canvas?._id) {
      return;
    }
    const settings = this.buildSettingsFromUi();
    if (!settings) {
      return;
    }
    // Optimistic local update so sides/preview react immediately.
    this.canvas = { ...this.canvas, printSettings: settings };
    if (this.mockupViewActive) {
      this.rebuildComposites();
    }

    if (this.settingsPersistTimer) {
      clearTimeout(this.settingsPersistTimer);
    }
    const canvasId = this.canvas._id;
    this.settingsPersistTimer = setTimeout(() => {
      this.settingsPersistTimer = null;
      this.phCanvasService.updateSettings(canvasId, settings).subscribe({
        next: (res) => this.applyCanvasFromServer(res.canvas),
        error: () => {},
      });
    }, CANVAS_SETTINGS_PERSIST_DEBOUNCE_MS);
  }

  private onDimensionBlur(axis: 'W' | 'L' = 'W'): void {
    const material = this.selectedDynamicMaterial;
    if (!material) {
      return;
    }

    let width = this.printingWidthCm;
    let height = this.printingLengthCm;

    const minW = Number(material.minHeight);
    const maxW = Number(material.maxHeight);
    const minH = Number(material.minLength);
    const maxH = Number(material.maxLength);

    const originalWidth = Number(this.canvas?.printSettings?.widthCm ?? width);
    const originalHeight = Number(this.canvas?.printSettings?.lengthCm ?? height);

    const bigMax = Math.max(maxW, maxH);
    const smallMax = Math.min(maxW, maxH);
    const blurAxis = axis === 'L' ? 'H' : 'W';

    if (width < minW) {
      width = minW;
    }
    if (height < minH) {
      height = minH;
    }

    let isMainDimValid: boolean;
    let isMainDimValidCross: boolean;
    let isCrossDimValid: boolean;
    let isCrossDimValidCross: boolean;

    if (blurAxis === 'W') {
      isMainDimValid = width <= maxW;
      isMainDimValidCross = width <= maxH;
      isCrossDimValid = height <= maxH;
      isCrossDimValidCross = height <= maxW;
    } else {
      isMainDimValid = height <= maxH;
      isMainDimValidCross = height <= maxW;
      isCrossDimValid = width <= maxW;
      isCrossDimValidCross = width <= maxH;
    }

    if (isMainDimValid) {
      if (!isCrossDimValid) {
        if (isMainDimValidCross) {
          if (!isCrossDimValidCross) {
            if (blurAxis === 'W') {
              height = smallMax;
            } else {
              width = smallMax;
            }
          }
        } else if (blurAxis === 'W') {
          height = smallMax;
        } else {
          width = smallMax;
        }
      }
    } else if (isMainDimValidCross) {
      if (!isCrossDimValidCross) {
        if (blurAxis === 'W') {
          height = bigMax;
        } else {
          width = bigMax;
        }
      }
    } else {
      if (blurAxis === 'W') {
        width = bigMax;
      } else {
        height = bigMax;
      }
      if (!(isCrossDimValid && isCrossDimValidCross)) {
        if (blurAxis === 'W') {
          height = smallMax;
        } else {
          width = smallMax;
        }
      }
    }

    width = this.roundCm(width) ?? width;
    height = this.roundCm(height) ?? height;

    if (
      !Number.isFinite(originalWidth) ||
      !Number.isFinite(originalHeight) ||
      width !== originalWidth ||
      height !== originalHeight
    ) {
      this.printingWidthCm = width;
      this.printingLengthCm = height;
      this.persistCanvasSettings();
    } else {
      this.printingWidthCm = this.roundCm(originalWidth) ?? originalWidth;
      this.printingLengthCm = this.roundCm(originalHeight) ?? originalHeight;
    }
  }

  private areDynamicDimensionsValid(
    material: PhDynamicMaterial,
    lengthCm: number,
    widthCm: number,
  ): boolean {
    const minL = Number(material.minLength);
    const maxL = Number(material.maxLength);
    const minW = Number(material.minHeight);
    const maxW = Number(material.maxHeight);
    const normalValid =
      lengthCm >= minL && lengthCm <= maxL && widthCm >= minW && widthCm <= maxW;
    const swappedValid =
      lengthCm >= minW && lengthCm <= maxW && widthCm >= minL && widthCm <= maxL;
    return normalValid || swappedValid;
  }

  private roundCm(value: number): number | null {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Math.round(value * 10) / 10;
  }

  private uploadFile(file: File): void {
    if (!this.phUploadValidation.validateExpressUpload(file)) {
      return;
    }

    this.activeUploads += 1;
    this.uploadingCount = this.activeUploads;
    this.uploading = true;
    this.uploadProgress = 0;

    const generation = this.uploadGeneration;
    const sub = this.phFilesService
      .upload(PH_FILE_TYPE_PRINTING_FILE, file, {
        printingHouseId: this.printingHouseId,
        productId: this.productId,
      })
      .subscribe({
        next: (httpEvent) => {
          if (generation !== this.uploadGeneration) {
            return;
          }
          if (httpEvent.type === HttpEventType.UploadProgress) {
            const total = httpEvent.total ?? 0;
            this.uploadProgress = total ? Math.round((100 * httpEvent.loaded) / total) : 0;
            return;
          }

          if (httpEvent.type !== HttpEventType.Response) {
            return;
          }

          this.finishOneUpload(generation);
          this.phPrintingFilesService
            .getMyFiles(this.printingHouseId, this.productId)
            .subscribe({
              next: (res) => this.applyFilesFromServer(res.files ?? []),
            });
        },
        error: () => {
          if (generation !== this.uploadGeneration) {
            return;
          }
          this.finishOneUpload(generation);
          this.snackBar.open(
            this.translateService.instant('ph-print.upload-failed'),
            undefined,
            { duration: 4000 },
          );
        },
      });
    this.activeUploadSubscriptions.add(sub);
    sub.add(() => this.activeUploadSubscriptions.delete(sub));
  }

  private finishOneUpload(generation: number): void {
    if (generation !== this.uploadGeneration) {
      return;
    }
    this.activeUploads = Math.max(0, this.activeUploads - 1);
    this.uploadingCount = this.activeUploads;
    this.uploading = this.activeUploads > 0;
    if (!this.uploading) {
      this.uploadProgress = 0;
    }
  }
}
