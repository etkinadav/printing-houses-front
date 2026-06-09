import { HttpEventType } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
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
  buildPersistedExtraSelections,
  EXTRA_OPTION_NONE_INDEX,
  isDoubleSidedRequired,
  reconcileExtraUiStateOnTreeChange,
  syncExtraUiStateFromSaved,
  validateExtraSelections,
} from '../ph-printing-files/ph-print-extra-settings.util';
import {
  formatImageOriginalDimensionsLine,
  getImageOriginalHeightCm,
  getImageOriginalWidthCm,
  isRasterPrintingFile,
  pixelsToOriginalCmString,
  resolveImageOriginalDpi,
} from '../ph-printing-files/ph-file-dimensions.util';
import { PhPrintingFilesService } from '../ph-printing-files/ph-printing-files.service';
import { isColorTextureUrl } from '../ph-products/ph-color-texture.util';
import {
  PhColor,
  PhDynamicMaterial,
  ExtraSettingKey,
  PhMaterial,
  PhProduct,
  PhSize,
} from '../ph-products/ph-product.model';
import { PhProductsService } from '../ph-products/ph-products.service';
import { PhPrintingHouse } from '../ph-printing-house/ph-printing-house.model';
import { PhPrintingHouseService } from '../ph-printing-house/ph-printing-house.service';

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
const FILES_END_CONTROLS_THRESHOLD = 6;
/** Settings toggle groups wrap when label score exceeds this threshold. */
const SETTINGS_BUTTONS_WRAP_SCORE_THRESHOLD = 30;

export interface FileListDisplayEntry {
  file: PhPrintingFile;
  images: PhPrintingFileImage[];
  imageIndex: number;
  splitMode: boolean;
}

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

  files: PhPrintingFile[] = [];
  processingFiles: PhPrintingFile[] = [];
  selectedFile: PhPrintingFile | null = null;
  /** Selected page (image) within the selected file. Settings are per page. */
  selectedImage: PhPrintingFileImage | null = null;
  /** 0-based index of the selected page within selectedFile.images. */
  currentImageIndex = 0;
  /** Stable preview URL — only changes when the selected page or its thumbnail changes. */
  previewThumbnailUrl: string | null = null;

  /** Fixed: selected index in fixedDimensionOptions. */
  currentFixedOptionIndex: number | null = null;
  /** Dynamic/fixed: selected material index — null when no file is ready. */
  currentMaterialIndex: number | null = null;
  currentColorIndex: number | null = null;
  printingLengthCm = 0;
  printingWidthCm = 0;
  extraSettingsUi: ExtraSettingsUiStateMap = {};
  /** Cached extra-setting rows — never compute in template (avoids infinite change detection). */
  extraSettingRows: PrintExtraSettingRow[] = [];

  /** Cached product options — never compute in template (avoids infinite change detection). */
  fixedDimensionOptions: FixedDimensionOption[] = [];

  uploading = false;
  uploadProgress = 0;
  uploadingCount = 0;
  readonly expressFileAccept = EXPRESS_FILE_ACCEPT;
  /** Value used for single-option display toggles when a file is ready. */
  readonly singleOptionToggleValue = 0;
  /** Keeps the product-name display toggle visually selected (read-only). */
  readonly productNameToggle = 0;

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private pollSub?: Subscription;
  private activeUploads = 0;
  /** Bumped on stopUploading() so in-flight upload callbacks are ignored. */
  private uploadGeneration = 0;
  private activeUploadSubscriptions = new Set<Subscription>();
  private isUpdatingFileSettings = false;
  private settingsSaveInFlightForFileId: string | null = null;
  private settingsSaveInFlightForImageId: string | null = null;
  private pendingDefaultSettingsFileIds = new Set<string>();
  private suppressSettingsPersist = false;
  private fileDimensionsResolveToken = 0;
  resolvedFileDimensions: { widthCm: string; heightCm: string } | null = null;

  constructor(
    private route: ActivatedRoute,
    private directionService: DirectionService,
    private authService: AuthService,
    private phFilesService: PhFilesService,
    private phPrintingFilesService: PhPrintingFilesService,
    private phProductsService: PhProductsService,
    private phPrintingHouseService: PhPrintingHouseService,
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

  /** Desktop preview: only processing files, no ready page selected yet (mean-corse ph-printing-table). */
  get showPreviewProcessingState(): boolean {
    return !this.selectedImage && this.processingFiles.length > 0;
  }

  get showEndDeleteAll(): boolean {
    return this.files.length > FILES_END_CONTROLS_THRESHOLD;
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

  /** Fixed size context for settings panel rows when no file is ready (first size). */
  get settingsPanelFixedSize(): PhSize | null {
    if (this.selectedFixedSize) {
      return this.selectedFixedSize;
    }
    if (this.settingsControlsDisabled && this.isFixedProduct && this.fixedSizes.length > 0) {
      const firstOption = this.fixedDimensionOptions[0];
      if (firstOption != null) {
        return this.fixedSizes[firstOption.sizeIndex] ?? this.fixedSizes[0] ?? null;
      }
      return this.fixedSizes[0] ?? null;
    }
    return null;
  }

  /** Material context for panel row visibility when toggles are disabled. */
  get settingsPanelMaterial(): PhMaterial | PhDynamicMaterial | null {
    if (this.selectedMaterial) {
      return this.selectedMaterial;
    }
    if (!this.settingsControlsDisabled) {
      return null;
    }
    if (this.isDynamicProduct) {
      return this.dynamicMaterials[0] ?? null;
    }
    const materials = this.settingsPanelFixedSize?.materials ?? [];
    return materials[0] ?? null;
  }

  /** Placeholder defaults for dynamic dimension inputs when no file is selected. */
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

  get hasSettingsReadyFile(): boolean {
    return !!this.selectedFile && !this.isFileProcessing(this.selectedFile);
  }

  get showPrintSettingsPanel(): boolean {
    return !!this.product;
  }

  /** Per-control disabled — like mean-corse `[disabled]="!currentImage || files.length === 0"`. */
  get settingsControlsDisabled(): boolean {
    return this.finishedCount === 0 || !this.selectedImage;
  }

  /** ngModel for toggles when disabled — no checked/gray background. */
  get materialToggleModel(): number | null {
    return this.settingsControlsDisabled ? null : this.currentMaterialIndex;
  }

  get colorToggleModel(): number | null {
    return this.settingsControlsDisabled ? null : this.currentColorIndex;
  }

  get fixedOptionToggleModel(): number | null {
    return this.settingsControlsDisabled ? null : this.currentFixedOptionIndex;
  }

  /** Single-option rows: display when ready, disabled+unchecked when empty (mean-corse). */
  get singleOptionToggleModel(): number | null {
    return this.settingsControlsDisabled ? null : this.singleOptionToggleValue;
  }

  get selectedFileDimensionsLine(): string {
    if (!this.showPrintSettingsPanel) {
      return '';
    }
    if (!this.hasSettingsReadyFile) {
      return '—';
    }

    const fromImage = formatImageOriginalDimensionsLine(
      this.selectedImage,
      this.translateService.instant('printing-table.dimensions-cm'),
    );
    if (fromImage !== '—') {
      return fromImage;
    }

    if (this.resolvedFileDimensions) {
      return `${this.resolvedFileDimensions.widthCm} × ${this.resolvedFileDimensions.heightCm} ${this.translateService.instant('printing-table.dimensions-cm')}`.trim();
    }

    return '—';
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
    this.fileDimensionsResolveToken += 1;
  }

  private refreshResolvedFileDimensions(): void {
    this.resolvedFileDimensions = null;
    this.fileDimensionsResolveToken += 1;

    const file = this.selectedFile;
    const image = this.selectedImage;
    if (!file || !image || this.isFileProcessing(file)) {
      return;
    }
    if (getImageOriginalWidthCm(image) !== '-' && getImageOriginalHeightCm(image) !== '-') {
      return;
    }
    // Browser fallback only makes sense for single-page raster files.
    if (!isRasterPrintingFile(file) || (file.images?.length ?? 0) > 1) {
      return;
    }

    const url = file.originalUrl?.trim();
    if (!url) {
      return;
    }

    const token = this.fileDimensionsResolveToken;
    const dpi = resolveImageOriginalDpi(image);
    const img = new Image();
    img.onload = () => {
      if (token !== this.fileDimensionsResolveToken) {
        return;
      }
      if (!img.naturalWidth || !img.naturalHeight) {
        return;
      }
      this.resolvedFileDimensions = {
        widthCm: pixelsToOriginalCmString(img.naturalWidth, dpi),
        heightCm: pixelsToOriginalCmString(img.naturalHeight, dpi),
      };
    };
    img.onerror = () => {};
    img.src = url;
  }

  isFileProcessing(file: PhPrintingFile): boolean {
    return file.processing || !(file.images && file.images.length > 0);
  }

  /** Pages of a file (always an array). */
  getFileImages(file: PhPrintingFile | null | undefined): PhPrintingFileImage[] {
    return file?.images ?? [];
  }

  isMultiPageFile(file: PhPrintingFile): boolean {
    return this.getFileImages(file).length > 1;
  }

  /** When double-sided is required, multi-page files render as separate single-page tiles. */
  shouldSplitFilePagesInList(file: PhPrintingFile): boolean {
    if (!this.isMultiPageFile(file)) {
      return false;
    }
    const firstImage = this.getFileImages(file)[0];
    if (!firstImage) {
      return false;
    }
    return isDoubleSidedRequired(this.getExtraSettingsContextForImage(firstImage));
  }

  getFileListEntries(): FileListDisplayEntry[] {
    const entries: FileListDisplayEntry[] = [];
    for (const file of this.files) {
      if (this.isFileProcessing(file)) {
        entries.push({ file, images: [], imageIndex: 0, splitMode: false });
        continue;
      }
      const images = this.getFileImages(file);
      if (images.length > 1 && this.shouldSplitFilePagesInList(file)) {
        images.forEach((image, imageIndex) => {
          entries.push({ file, images: [image], imageIndex, splitMode: true });
        });
      } else {
        entries.push({ file, images, imageIndex: 0, splitMode: false });
      }
    }
    return entries;
  }

  trackFileListEntry(_index: number, entry: FileListDisplayEntry): string {
    if (entry.splitMode && entry.images[0]) {
      return `${entry.file._id}:${entry.images[0]._id}`;
    }
    return entry.file._id;
  }

  getFileListImageIndex(entry: FileListDisplayEntry, loopIndex: number): number {
    return entry.splitMode ? entry.imageIndex : loopIndex;
  }

  isFileListEntryGroupedMultiPage(entry: FileListDisplayEntry): boolean {
    return !entry.splitMode && entry.images.length > 1;
  }

  /** Thumbnail used for sidebar/preview — the first page's thumbnail. */
  getFileThumbnailUrl(file: PhPrintingFile | null | undefined): string | null {
    return this.getFileImages(file)[0]?.thumbnailUrl?.trim() || null;
  }

  selectFile(file: PhPrintingFile): void {
    if (this.isFileProcessing(file)) {
      return;
    }
    this.selectImage(file, this.getFileImages(file)[0] ?? null, 0);
  }

  selectImage(file: PhPrintingFile, image: PhPrintingFileImage | null, index: number): void {
    if (this.isFileProcessing(file) || !image) {
      return;
    }
    this.selectedFile = file;
    this.selectedImage = image;
    this.currentImageIndex = index;
    this.previewThumbnailUrl = image.thumbnailUrl?.trim() || null;
    this.refreshResolvedFileDimensions();
    this.syncSettingsUiFromImage(image);
  }

  trackFileById(_index: number, file: PhPrintingFile): string {
    return file._id;
  }

  trackImageById(_index: number, image: PhPrintingFileImage): string {
    return image._id;
  }

  isSelectedImage(file: PhPrintingFile, index: number): boolean {
    return this.selectedFile?._id === file._id && this.currentImageIndex === index;
  }

  trackExtraSettingRow(_index: number, row: PrintExtraSettingRow): string {
    return row.key;
  }

  isSelected(file: PhPrintingFile): boolean {
    return this.selectedFile?._id === file._id;
  }

  getDisplayFileName(file: PhPrintingFile): string {
    return file.originalFileName?.trim() || this.translateService.instant('printing-table.file');
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

  /**
   * Sum of all label lengths + optional per-button extra + (buttonCount - 1) * 5.
   * When the score exceeds 30, settings toggles use a stacked centered layout.
   */
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
    if (!option || !size || !this.selectedFile) {
      return;
    }

    const previousOption = this.getSelectedFixedOption();
    const previousSize = previousOption
      ? this.fixedSizes[previousOption.sizeIndex]
      : null;
    const previousMaterials = previousSize?.materials ?? [];
    const previousMaterial = this.getMaterialAtIndex(
      previousMaterials,
      this.currentMaterialIndex,
    );
    const previousColor = this.getColorAtIndex(
      previousMaterial,
      this.currentColorIndex,
    );
    const previousExtraCtx = buildExtraSettingsContext(
      previousSize,
      previousMaterial,
      previousColor,
    );
    const previousExtraUi = { ...this.extraSettingsUi };

    const previousMaterialLabel = previousMaterial
      ? this.getMaterialLabel(previousMaterial)
      : '';
    const previousColorLabel = this.getColorLabelAtIndex(
      previousMaterial,
      this.currentColorIndex,
    );

    this.currentFixedOptionIndex = optionIndex;
    const newMaterials = size.materials ?? [];
    this.currentMaterialIndex = this.findMatchingMaterialIndex(
      newMaterials,
      previousMaterialLabel,
    );
    const newMaterial = newMaterials[this.currentMaterialIndex] ?? null;
    this.currentColorIndex = this.findMatchingColorIndex(
      newMaterial?.colors ?? [],
      previousColorLabel,
    );
    this.extraSettingsUi = reconcileExtraUiStateOnTreeChange(
      buildExtraSettingsContext(size, newMaterial, this.getColorAtIndex(newMaterial, this.currentColorIndex)),
      previousExtraCtx,
      previousExtraUi,
    );
    this.rebuildExtraSettingRows();
    this.printingLengthCm = Number(size.length);
    this.printingWidthCm = Number(size.width);
    this.persistCurrentFileSettings();
  }

  onMaterialChange(materialIndex: number): void {
    if (this.suppressSettingsPersist || !Number.isInteger(materialIndex)) {
      return;
    }
    if (!this.selectedFile) {
      return;
    }

    if (this.isDynamicProduct) {
      const materials = this.dynamicMaterials;
      if (
        !materials.length ||
        !Number.isInteger(materialIndex) ||
        materialIndex < 0 ||
        materialIndex >= materials.length
      ) {
        return;
      }
      const previousMaterial = materials[this.currentMaterialIndex] ?? null;
      const previousColor = this.getColorAtIndex(previousMaterial, this.currentColorIndex);
      const previousExtraCtx = buildExtraSettingsContext(null, previousMaterial, previousColor);
      const previousExtraUi = { ...this.extraSettingsUi };
      const previousColorLabel = this.getColorLabelAtIndex(
        previousMaterial,
        this.currentColorIndex,
      );
      this.currentMaterialIndex = materialIndex;
      const material = materials[materialIndex];
      this.currentColorIndex = this.findMatchingColorIndex(
        material?.colors ?? [],
        previousColorLabel,
      );
      this.extraSettingsUi = reconcileExtraUiStateOnTreeChange(
        buildExtraSettingsContext(null, material, this.getColorAtIndex(material, this.currentColorIndex)),
        previousExtraCtx,
        previousExtraUi,
      );
      this.rebuildExtraSettingRows();
      if (
        !this.areDynamicDimensionsValid(
          material,
          this.printingLengthCm,
          this.printingWidthCm,
        )
      ) {
        this.printingLengthCm = Number(material.defaultLength);
        this.printingWidthCm = Number(material.defaultHeight);
      }
      this.persistCurrentFileSettings();
      return;
    }

    if (this.isFixedProduct) {
      const materials = this.fixedMaterialsForSelectedSize;
      if (
        !materials.length ||
        !Number.isInteger(materialIndex) ||
        materialIndex < 0 ||
        materialIndex >= materials.length
      ) {
        return;
      }
      const previousMaterial = materials[this.currentMaterialIndex] ?? null;
      const previousColor = this.getColorAtIndex(previousMaterial, this.currentColorIndex);
      const previousExtraCtx = buildExtraSettingsContext(
        this.selectedFixedSize,
        previousMaterial,
        previousColor,
      );
      const previousExtraUi = { ...this.extraSettingsUi };
      const previousColorLabel = this.getColorLabelAtIndex(
        previousMaterial,
        this.currentColorIndex,
      );
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
      this.persistCurrentFileSettings();
    }
  }

  onColorChange(colorIndex: number): void {
    if (this.suppressSettingsPersist || !this.selectedFile) {
      return;
    }
    const colors = this.colorsForSelectedMaterial;
    if (
      !colors.length ||
      !Number.isInteger(colorIndex) ||
      colorIndex < 0 ||
      colorIndex >= colors.length
    ) {
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
    this.persistCurrentFileSettings();
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
    this.persistCurrentFileSettings();
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
    this.persistCurrentFileSettings();
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

  private findFixedOptionIndex(sizeIndex: number, _materialIndex: number): number {
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
    this.persistCurrentFileSettings();
  }

  triggerFilePicker(input: HTMLInputElement): void {
    if (this.uploading) {
      return;
    }
    input.click();
  }

  /** Mean-corse ph-printing-table: cancel all in-flight uploads. */
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
        this.removeFileFromLocalState(file._id, true);
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
    imageIndex: number,
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

    this.selectImage(file, image, imageIndex);

    this.phPrintingFilesService
      .deleteImage(file._id, image._id, this.productId)
      .subscribe({
        next: (response) => {
          if (response.deletedFileId) {
            this.removeFileFromLocalState(file._id, true);
            return;
          }

          const fileIndex = this.files.findIndex((f) => f._id === file._id);
          if (fileIndex === -1) {
            return;
          }

          const wasSelected =
            this.selectedFile?._id === file._id &&
            this.selectedImage?._id === image._id;
          const selectedIndexBefore = this.currentImageIndex;

          if (response.file) {
            this.files[fileIndex] = response.file;
          } else {
            this.files[fileIndex] = {
              ...this.files[fileIndex],
              images: this.getFileImages(this.files[fileIndex]).filter(
                (img) => img._id !== image._id,
              ),
            };
          }

          const updatedFile = this.files[fileIndex];
          const remaining = this.getFileImages(updatedFile);

          if (wasSelected) {
            const newIndex = Math.min(
              imageIndex,
              Math.max(0, remaining.length - 1),
            );
            this.selectImage(updatedFile, remaining[newIndex] ?? null, newIndex);
          } else if (
            this.selectedFile?._id === file._id &&
            selectedIndexBefore > imageIndex
          ) {
            const newIndex = selectedIndexBefore - 1;
            this.selectImage(updatedFile, remaining[newIndex] ?? null, newIndex);
          }
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

  canDeletePageFromFile(file: PhPrintingFile): boolean {
    return this.getFileImages(file).length > 1;
  }

  private removeFileFromLocalState(fileId: string, clearSelectionIfSelected: boolean): void {
    const wasSelected = clearSelectionIfSelected && this.selectedFile?._id === fileId;
    this.files = this.files.filter((f) => f._id !== fileId);
    this.processingFiles = this.processingFiles.filter((f) => f._id !== fileId);
    this.pendingDefaultSettingsFileIds.delete(fileId);

    if (!wasSelected) {
      return;
    }

    const nextFile = this.files.find((f) => !this.isFileProcessing(f)) ?? null;
    if (nextFile) {
      this.selectImage(nextFile, this.getFileImages(nextFile)[0] ?? null, 0);
      return;
    }

    this.selectedFile = null;
    this.selectedImage = null;
    this.currentImageIndex = 0;
    this.previewThumbnailUrl = null;
    this.refreshResolvedFileDimensions();
    if (this.product) {
      this.clearSettingsUiUnselected();
    }
  }

  onDeleteAllFiles(): void {
    if (this.uploading || !this.hasFiles) {
      return;
    }

    this.phPrintingFilesService
      .deleteAll(this.printingHouseId)
      .subscribe({
        next: () => {
          this.files = [];
          this.processingFiles = [];
          this.selectedFile = null;
          this.selectedImage = null;
          this.currentImageIndex = 0;
          this.previewThumbnailUrl = null;
          this.pendingDefaultSettingsFileIds.clear();
          this.refreshResolvedFileDimensions();
          if (this.product) {
            this.clearSettingsUiUnselected();
          }
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
        this.afterProductLoaded();
      },
    });
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

  private afterProductLoaded(): void {
    if (!this.product) {
      return;
    }
    this.ensureAllReadyFilesHaveSettings();
    this.applySettingsPanelState();
  }

  private resetSettingsUiState(): void {
    this.currentFixedOptionIndex = null;
    this.currentMaterialIndex = null;
    this.currentColorIndex = null;
    this.extraSettingsUi = {};
    this.extraSettingRows = [];
    this.printingLengthCm = 0;
    this.printingWidthCm = 0;
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

  private getExtraSettingsContextForImage(image: PhPrintingFileImage | null) {
    const ps = image?.printSettings;
    if (this.isFixedProduct) {
      const sizeIndex = Number(ps?.sizeIndex ?? 0);
      const size = this.fixedSizes[sizeIndex] ?? null;
      const materials = size?.materials ?? [];
      const materialIndex = Number(ps?.materialIndex ?? 0);
      const material = materials[materialIndex] ?? null;
      const colors = material?.colors ?? [];
      const colorIndex = colors.length
        ? Math.min(Math.max(0, Number(ps?.colorIndex ?? 0)), colors.length - 1)
        : 0;
      const color = colors[colorIndex] ?? null;
      return buildExtraSettingsContext(size, material, color);
    }
    if (this.isDynamicProduct) {
      const materialIndex = Number(ps?.materialIndex ?? 0);
      const material = this.dynamicMaterials[materialIndex] ?? null;
      const colors = material?.colors ?? [];
      const colorIndex = colors.length
        ? Math.min(Math.max(0, Number(ps?.colorIndex ?? 0)), colors.length - 1)
        : 0;
      const color = colors[colorIndex] ?? null;
      return buildExtraSettingsContext(null, material, color);
    }
    return buildExtraSettingsContext(null, null, null);
  }

  private imageExtraSettingsAreValid(image: PhPrintingFileImage | null): boolean {
    const ps = image?.printSettings;
    if (!ps) {
      return false;
    }
    const ctx = this.getExtraSettingsContextForImage(image);
    return validateExtraSelections(ctx, {
      ...buildPersistedExtraSelections(ctx, buildDefaultExtraUiStateMap(ctx)),
      ...ps,
    });
  }

  private getCurrentExtraSettingsContext() {
    const size = this.settingsPanelFixedSize;
    const material = this.settingsPanelMaterial;
    const color =
      this.selectedColor ??
      (this.settingsControlsDisabled
        ? this.getColorAtIndex(material, 0)
        : null);
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
    const idx = Math.min(
      Math.max(0, materialIndex),
      materials.length - 1,
    );
    return materials[idx] ?? null;
  }

  private getColorLabelAtIndex(
    material: PhMaterial | PhDynamicMaterial | null | undefined,
    colorIndex: number,
  ): string {
    const colors = material?.colors ?? [];
    if (!colors.length) {
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
    material: PhMaterial | null | undefined,
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

  private isColorIndexValidForMaterial(
    material: PhMaterial | null | undefined,
    colorIndex: number,
  ): boolean {
    const colors = material?.colors ?? [];
    if (!colors.length) {
      return true;
    }
    return (
      Number.isInteger(colorIndex) && colorIndex >= 0 && colorIndex < colors.length
    );
  }

  private appendColorIndexToSettings(
    settings: PhPrintingFilePrintSettings,
    material: PhMaterial | null | undefined,
  ): PhPrintingFilePrintSettings {
    const colors = material?.colors ?? [];
    if (!colors.length || this.currentColorIndex == null) {
      return settings;
    }
    return {
      ...settings,
      colorIndex: Math.min(
        Math.max(0, this.currentColorIndex),
        colors.length - 1,
      ),
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
    const prevSelectedFileId = this.selectedFile?._id;
    const prevSelectedImageId = this.selectedImage?._id;

    // Compare server payload before merge mutates this.files in place (isEqual(merged, this.files) is always true after soft merge).
    if (this.isSameFileListPollState(nextFiles, this.files)) {
      return;
    }

    const merged = this.mergePolledFilesWithExisting(nextFiles);
    this.files = merged;
    this.processingFiles = merged.filter((file) => this.isFileProcessing(file));

    if (this.selectedFile) {
      const still = merged.find((f) => f._id === this.selectedFile!._id);
      if (!still || this.isFileProcessing(still)) {
        this.clearSelection();
      } else {
        this.selectedFile = still;
        this.resolveSelectedImageWithin(still, prevSelectedImageId);
        this.updatePreviewThumbnailIfChanged();
      }
    }

    // Mean-corse ph-printing-table: !isChosen && not all processing → first ready file + preview.
    if (!this.selectedImage && this.processingFiles.length !== this.files.length) {
      const firstReady = merged.find((f) => !this.isFileProcessing(f));
      const firstImage = firstReady ? this.getFileImages(firstReady)[0] : null;
      if (firstReady && firstImage) {
        this.selectImage(firstReady, firstImage, 0);
      }
    }

    this.ensureAllReadyFilesHaveSettings();
    this.refreshResolvedFileDimensions();

    const selectionChanged =
      this.selectedFile?._id !== prevSelectedFileId ||
      this.selectedImage?._id !== prevSelectedImageId;

    if (this.selectedImage && selectionChanged) {
      this.syncSettingsUiFromImage(this.selectedImage);
    } else if (!this.selectedFile && this.product) {
      this.clearSettingsUiUnselected();
    }
  }

  /** True when poll payload matches local list — compare before in-place merge. */
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
      this.imagesStructureEqual(prev.images, next.images) &&
      this.getFileThumbnailUrl(prev) === this.getFileThumbnailUrl(next) &&
      isEqual(
        (prev.images ?? []).map((img) => img.printSettings),
        (next.images ?? []).map((img) => img.printSettings),
      )
    );
  }

  private clearSelection(): void {
    this.selectedFile = null;
    this.selectedImage = null;
    this.currentImageIndex = 0;
    this.previewThumbnailUrl = null;
  }

  /** Keep the selected page stable across polls by matching its id, else fall back to page 0. */
  private resolveSelectedImageWithin(
    file: PhPrintingFile,
    preferImageId: string | undefined,
  ): void {
    const images = this.getFileImages(file);
    let index = preferImageId
      ? images.findIndex((img) => img._id === preferImageId)
      : -1;
    if (index < 0) {
      index = 0;
    }
    this.selectedImage = images[index] ?? null;
    this.currentImageIndex = this.selectedImage ? index : 0;
  }

  /**
   * Merge poll results without replacing file objects when only printSettings changed,
   * so sidebar/preview thumbnails are not reloaded on settings updates.
   */
  private mergePolledFilesWithExisting(nextFiles: PhPrintingFile[]): PhPrintingFile[] {
    const existingById = new Map(this.files.map((file) => [file._id, file]));

    return nextFiles.map((next) => {
      const prev = existingById.get(next._id);
      if (!prev) {
        return next;
      }

      let incoming = next;
      // Preserve the optimistic per-page settings while a save is in flight.
      if (this.settingsSaveInFlightForFileId === next._id) {
        incoming = {
          ...next,
          images: this.overlayInFlightImageSettings(prev, next),
        };
      }

      const thumbnailUnchanged =
        this.getFileThumbnailUrl(prev) === this.getFileThumbnailUrl(incoming);
      const processingUnchanged = prev.processing === incoming.processing;
      const structureUnchanged = this.imagesStructureEqual(prev.images, incoming.images);

      if (thumbnailUnchanged && processingUnchanged && structureUnchanged) {
        // Only per-page settings may have changed — patch in place, keep object identity.
        this.applyIncomingImageSettings(prev.images, incoming.images);
        return prev;
      }

      Object.assign(prev, incoming);
      return prev;
    });
  }

  /** Overlay prev's in-flight page settings onto the incoming images by id. */
  private overlayInFlightImageSettings(
    prev: PhPrintingFile,
    next: PhPrintingFile,
  ): PhPrintingFileImage[] {
    const prevById = new Map((prev.images ?? []).map((img) => [img._id, img]));
    return (next.images ?? []).map((img) => {
      if (
        img._id === this.settingsSaveInFlightForImageId &&
        prevById.get(img._id)?.printSettings
      ) {
        return { ...img, printSettings: prevById.get(img._id)!.printSettings };
      }
      return img;
    });
  }

  /** True when both image arrays describe the same pages (same ids in order). */
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
    }
    return true;
  }

  /** Copy per-page settings from incoming into existing image objects (by index, ids match). */
  private applyIncomingImageSettings(
    target: PhPrintingFileImage[] | undefined,
    source: PhPrintingFileImage[] | undefined,
  ): void {
    const tt = target ?? [];
    const ss = source ?? [];
    for (let i = 0; i < tt.length; i += 1) {
      if (!isEqual(tt[i].printSettings, ss[i]?.printSettings)) {
        tt[i].printSettings = ss[i]?.printSettings
          ? { ...ss[i].printSettings }
          : undefined;
      }
    }
  }

  private updatePreviewThumbnailIfChanged(): void {
    const nextUrl = this.selectedImage?.thumbnailUrl?.trim() || null;
    if (nextUrl !== this.previewThumbnailUrl) {
      this.previewThumbnailUrl = nextUrl;
    }
  }

  private ensureAllReadyFilesHaveSettings(): void {
    if (!this.product) {
      return;
    }
    for (const file of this.files) {
      if (this.isFileProcessing(file)) {
        continue;
      }
      for (const image of this.getFileImages(file)) {
        if (this.imageHasValidPrintSettings(image)) {
          continue;
        }
        const pendingKey = `${file._id}:${image._id}`;
        if (this.pendingDefaultSettingsFileIds.has(pendingKey)) {
          continue;
        }
        const defaults = this.buildDefaultPrintSettingsForImage(image);
        if (!defaults) {
          continue;
        }
        this.pendingDefaultSettingsFileIds.add(pendingKey);
        this.saveFileSettings(file._id, image._id, defaults, () => {
          this.pendingDefaultSettingsFileIds.delete(pendingKey);
          if (this.selectedImage?._id === image._id) {
            this.syncSettingsUiFromImage(this.selectedImage);
          }
        });
      }
    }
  }

  private imageHasValidPrintSettings(image: PhPrintingFileImage | null): boolean {
    const ps = image?.printSettings;
    if (!ps || !this.product) {
      return false;
    }
    if (this.isFixedProduct) {
      const sizeIndex = Number(ps.sizeIndex);
      const materialIndex = Number(ps.materialIndex ?? 0);
      if (!Number.isInteger(sizeIndex) || sizeIndex < 0 || sizeIndex >= this.fixedSizes.length) {
        return false;
      }
      if (!this.fixedDimensionOptions.some((option) => option.sizeIndex === sizeIndex)) {
        return false;
      }
      const materials = this.fixedSizes[sizeIndex]?.materials ?? [];
      if (
        !Number.isInteger(materialIndex) ||
        materialIndex < 0 ||
        materialIndex >= materials.length
      ) {
        return false;
      }
      return this.isColorIndexValidForMaterial(
        materials[materialIndex],
        Number(ps.colorIndex ?? 0),
      ) && this.imageExtraSettingsAreValid(image);
    }
    if (this.isDynamicProduct) {
      const materialIndex = Number(ps.materialIndex ?? 0);
      const lengthCm = Number(ps.lengthCm);
      const widthCm = Number(ps.widthCm);
      if (
        !Number.isInteger(materialIndex) ||
        materialIndex < 0 ||
        materialIndex >= this.dynamicMaterials.length ||
        !Number.isFinite(lengthCm) ||
        !Number.isFinite(widthCm) ||
        lengthCm <= 0 ||
        widthCm <= 0
      ) {
        return false;
      }
      if (
        !this.areDynamicDimensionsValid(
          this.dynamicMaterials[materialIndex],
          lengthCm,
          widthCm,
        )
      ) {
        return false;
      }
      return this.isColorIndexValidForMaterial(
        this.dynamicMaterials[materialIndex],
        Number(ps.colorIndex ?? 0),
      ) && this.imageExtraSettingsAreValid(image);
    }
    return false;
  }

  private buildDefaultPrintSettings(): PhPrintingFilePrintSettings | null {
    if (!this.product) {
      return null;
    }
    if (this.isFixedProduct) {
      const option = this.fixedDimensionOptions[0];
      const size = option ? this.fixedSizes[option.sizeIndex] : null;
      if (!option || !size) {
        return null;
      }
      const material = size.materials?.[0] ?? null;
      const color = material?.colors?.[0] ?? null;
      const extraCtx = buildExtraSettingsContext(size, material, color);
      return appendExtraSelectionsToPrintSettings(
        this.appendColorIndexToSettings(
          {
            paperType: material ? this.getMaterialLabel(material) : option.label,
            sizeIndex: option.sizeIndex,
            materialIndex: 0,
            lengthCm: Number(size.length),
            widthCm: Number(size.width),
          },
          material,
        ),
        extraCtx,
        buildDefaultExtraUiStateMap(extraCtx),
      );
    }
    if (this.isDynamicProduct) {
      const material = this.dynamicMaterials[0];
      if (!material) {
        return null;
      }
      const color = material.colors?.[0] ?? null;
      const extraCtx = buildExtraSettingsContext(null, material, color);
      return appendExtraSelectionsToPrintSettings(
        this.appendColorIndexToSettings(
          {
            paperType: this.getMaterialLabel(material),
            materialIndex: 0,
            lengthCm: Number(material.defaultLength),
            widthCm: Number(material.defaultHeight),
          },
          material,
        ),
        extraCtx,
        buildDefaultExtraUiStateMap(extraCtx),
      );
    }
    return null;
  }

  private buildDefaultPrintSettingsForImage(
    image: PhPrintingFileImage | null,
  ): PhPrintingFilePrintSettings | null {
    if (!this.product) {
      return null;
    }
    const ps = image?.printSettings;
    if (this.isFixedProduct) {
      const sizeIndex = Number.isInteger(Number(ps?.sizeIndex)) && Number(ps?.sizeIndex) >= 0
        ? Number(ps?.sizeIndex)
        : 0;
      const size = this.fixedSizes[sizeIndex] ?? this.fixedSizes[0];
      if (!size) {
        return null;
      }
      const materials = size.materials ?? [];
      const materialIndex =
        Number.isInteger(Number(ps?.materialIndex)) &&
        Number(ps?.materialIndex) >= 0 &&
        Number(ps?.materialIndex) < materials.length
          ? Number(ps?.materialIndex)
          : 0;
      const material = materials[materialIndex] ?? materials[0] ?? null;
      const colors = material?.colors ?? [];
      const colorIndex = colors.length
        ? Math.min(Math.max(0, Number(ps?.colorIndex ?? 0)), colors.length - 1)
        : 0;
      const color = colors[colorIndex] ?? null;
      const extraCtx = buildExtraSettingsContext(size, material, color);
      return appendExtraSelectionsToPrintSettings(
        this.appendColorIndexToSettings(
          {
            paperType: material ? this.getMaterialLabel(material) : this.getFixedSizeDisplayLabel(size),
            sizeIndex,
            materialIndex,
            lengthCm: Number(size.length),
            widthCm: Number(size.width),
          },
          material,
        ),
        extraCtx,
        buildDefaultExtraUiStateMap(extraCtx),
      );
    }
    if (this.isDynamicProduct) {
      const materialIndex =
        Number.isInteger(Number(ps?.materialIndex)) &&
        Number(ps?.materialIndex) >= 0 &&
        Number(ps?.materialIndex) < this.dynamicMaterials.length
          ? Number(ps?.materialIndex)
          : 0;
      const material = this.dynamicMaterials[materialIndex] ?? this.dynamicMaterials[0];
      if (!material) {
        return null;
      }
      const colors = material.colors ?? [];
      const colorIndex = colors.length
        ? Math.min(Math.max(0, Number(ps?.colorIndex ?? 0)), colors.length - 1)
        : 0;
      const color = colors[colorIndex] ?? null;
      const extraCtx = buildExtraSettingsContext(null, material, color);
      return appendExtraSelectionsToPrintSettings(
        this.appendColorIndexToSettings(
          {
            paperType: this.getMaterialLabel(material),
            materialIndex,
            lengthCm: Number(ps?.lengthCm ?? material.defaultLength),
            widthCm: Number(ps?.widthCm ?? material.defaultHeight),
          },
          material,
        ),
        extraCtx,
        buildDefaultExtraUiStateMap(extraCtx),
      );
    }
    return null;
  }

  private applySettingsPanelState(): void {
    if (!this.product) {
      return;
    }
    if (this.hasSettingsReadyFile && this.selectedImage) {
      this.refreshResolvedFileDimensions();
      this.syncSettingsUiFromImage(this.selectedImage);
    } else {
      this.refreshResolvedFileDimensions();
      this.clearSettingsUiUnselected();
    }
  }

  /** Empty / processing-only table: all rows visible (first material/color context), controls disabled, no selection styling. */
  private clearSettingsUiUnselected(): void {
    if (!this.product) {
      return;
    }

    this.suppressSettingsPersist = true;
    try {
      this.currentFixedOptionIndex = null;
      this.currentMaterialIndex = null;
      this.currentColorIndex = null;
      this.printingLengthCm = 0;
      this.printingWidthCm = 0;
      this.extraSettingsUi = {};
    } finally {
      this.rebuildExtraSettingRows();
      setTimeout(() => {
        this.suppressSettingsPersist = false;
      });
    }
  }

  private syncSettingsUiFromImage(image: PhPrintingFileImage | null): void {
    if (!this.product || !image) {
      return;
    }

    this.suppressSettingsPersist = true;
    try {
      const ps = image.printSettings;
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
        this.currentFixedOptionIndex = this.findFixedOptionIndex(sizeIndex, materialIndex);
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
            (materials[resolvedMaterialIndex]?.colors ?? [])[
              Math.min(
                Math.max(0, Number(ps?.colorIndex ?? 0)),
                Math.max(0, (materials[resolvedMaterialIndex]?.colors ?? []).length - 1),
              )
            ] ?? null,
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
        this.printingLengthCm = Number(
          ps?.lengthCm ?? material?.defaultLength ?? 0,
        );
        this.printingWidthCm = Number(
          ps?.widthCm ?? material?.defaultHeight ?? 0,
        );
        this.extraSettingsUi = syncExtraUiStateFromSaved(
          buildExtraSettingsContext(
            null,
            material,
            (material?.colors ?? [])[
              Math.min(
                Math.max(0, Number(ps?.colorIndex ?? 0)),
                Math.max(0, (material?.colors ?? []).length - 1),
              )
            ] ?? null,
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

  private persistCurrentFileSettings(): void {
    if (!this.selectedFile?._id || !this.selectedImage?._id) {
      return;
    }
    const settings = this.buildSettingsFromUi();
    if (!settings) {
      return;
    }
    this.saveFileSettings(this.selectedFile._id, this.selectedImage._id, settings);
  }

  private saveFileSettings(
    fileId: string,
    imageId: string,
    printSettings: PhPrintingFilePrintSettings,
    onDone?: () => void,
  ): void {
    if (!this.productId) {
      onDone?.();
      return;
    }

    this.isUpdatingFileSettings = true;
    this.settingsSaveInFlightForFileId = fileId;
    this.settingsSaveInFlightForImageId = imageId;
    this.patchImagePrintSettings(fileId, imageId, printSettings);

    this.phPrintingFilesService
      .updateFileSettings(fileId, imageId, printSettings, this.productId)
      .subscribe({
        next: (res) => {
          this.isUpdatingFileSettings = false;
          this.settingsSaveInFlightForFileId = null;
          this.settingsSaveInFlightForImageId = null;
          const savedImage = (res.file?.images ?? []).find((img) => img._id === imageId);
          if (savedImage?.printSettings) {
            this.patchImagePrintSettings(fileId, imageId, savedImage.printSettings);
          }
          if (this.selectedImage?._id === imageId) {
            this.syncSettingsUiFromImage(this.selectedImage);
          }
          onDone?.();
        },
        error: () => {
          this.isUpdatingFileSettings = false;
          this.settingsSaveInFlightForFileId = null;
          this.settingsSaveInFlightForImageId = null;
          onDone?.();
        },
      });
  }

  private patchImagePrintSettings(
    fileId: string,
    imageId: string,
    printSettings: PhPrintingFilePrintSettings,
  ): void {
    const nextSettings = { ...printSettings };
    const patch = (file: PhPrintingFile | null) => {
      if (!file || file._id !== fileId) {
        return;
      }
      const image = this.getFileImages(file).find((img) => img._id === imageId);
      if (image) {
        image.printSettings = nextSettings;
      }
    };
    for (const file of this.files) {
      patch(file);
    }
    if (this.selectedImage?._id === imageId) {
      this.selectedImage.printSettings = nextSettings;
    }
  }

  /**
   * Dynamic dimension validation — ported from mean-corse ph-printing-table.
   * Maps אורך → height, רוחב → width in the algorithm.
   */
  private onDimensionBlur(axis: 'W' | 'L' = 'W'): void {
    const material = this.selectedDynamicMaterial;
    if (!material || !this.selectedFile) {
      return;
    }

    let width = this.printingWidthCm;
    let height = this.printingLengthCm;

    const minW = Number(material.minHeight);
    const maxW = Number(material.maxHeight);
    const minH = Number(material.minLength);
    const maxH = Number(material.maxLength);

    const originalWidth = Number(this.selectedImage?.printSettings?.widthCm ?? width);
    const originalHeight = Number(this.selectedImage?.printSettings?.lengthCm ?? height);

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
      this.persistCurrentFileSettings();
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
