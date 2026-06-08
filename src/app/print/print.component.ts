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
  reconcileExtraUiStateOnTreeChange,
  syncExtraUiStateFromSaved,
  validateExtraSelections,
} from '../ph-printing-files/ph-print-extra-settings.util';
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
  /** Stable preview URL — only changes when the selected file or its thumbnail changes. */
  previewThumbnailUrl: string | null = null;

  /** Fixed: selected index in fixedDimensionOptions. */
  currentFixedOptionIndex: number | null = null;
  /** Dynamic: selected material index. */
  currentMaterialIndex = 0;
  currentColorIndex = 0;
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
  /** Keeps the product-name display toggle visually selected (read-only). */
  readonly productNameToggle = 0;
  readonly extraDisplayToggleValue = 0;

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private pollSub?: Subscription;
  private activeUploads = 0;
  private isUpdatingFileSettings = false;
  private settingsSaveInFlightForFileId: string | null = null;
  private pendingDefaultSettingsFileIds = new Set<string>();
  private suppressSettingsPersist = false;

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
    const materials = this.dynamicMaterials;
    if (!materials.length) {
      return null;
    }
    const idx = Math.min(Math.max(0, this.currentMaterialIndex), materials.length - 1);
    return materials[idx] ?? null;
  }

  get selectedFixedSize(): PhSize | null {
    const option = this.getSelectedFixedOption();
    if (!option) {
      return null;
    }
    return this.fixedSizes[option.sizeIndex] ?? null;
  }

  get fixedMaterialsForSelectedSize(): PhMaterial[] {
    return this.selectedFixedSize?.materials ?? [];
  }

  get selectedFixedMaterial(): PhMaterial | null {
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
    return this.selectedMaterial?.colors ?? [];
  }

  get selectedColor(): PhColor | null {
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

  get settingsPanelDisabled(): boolean {
    return !this.hasSettingsReadyFile;
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
  }

  isFileProcessing(file: PhPrintingFile): boolean {
    return file.processing || !file.thumbnailUrl?.trim();
  }

  selectFile(file: PhPrintingFile): void {
    if (this.isFileProcessing(file)) {
      return;
    }
    this.selectedFile = file;
    this.previewThumbnailUrl = file.thumbnailUrl?.trim() || null;
    this.syncSettingsUiFromFile(file);
  }

  trackFileById(_index: number, file: PhPrintingFile): string {
    return file._id;
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
    return material.label?.he?.trim() || String(material.weight);
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
    if (this.suppressSettingsPersist || this.settingsPanelDisabled) {
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
    if (this.suppressSettingsPersist || this.settingsPanelDisabled || !Number.isInteger(index)) {
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

  getExtraOptionToggleValue(key: ExtraSettingKey): number {
    const state = this.extraSettingsUi[key];
    if (!state?.enabled) {
      return EXTRA_OPTION_NONE_INDEX;
    }
    return state.selectedIndex ?? 0;
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
      return this.fixedDimensionOptions[0] ?? null;
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
        this.files = this.files.filter((f) => f._id !== file._id);
        this.processingFiles = this.processingFiles.filter((f) => f._id !== file._id);
        this.pendingDefaultSettingsFileIds.delete(file._id);
        if (this.selectedFile?._id === file._id) {
          this.selectedFile = this.files.find((f) => !this.isFileProcessing(f)) ?? null;
          this.previewThumbnailUrl = this.selectedFile?.thumbnailUrl?.trim() || null;
          if (this.selectedFile) {
            this.syncSettingsUiFromFile(this.selectedFile);
          } else if (this.product) {
            this.syncSettingsUiToProductDefaults();
          }
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
          this.previewThumbnailUrl = null;
          this.pendingDefaultSettingsFileIds.clear();
          if (this.product) {
            this.syncSettingsUiToProductDefaults();
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
    this.currentMaterialIndex = 0;
    this.currentColorIndex = 0;
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

  private getExtraSettingsContextForFile(file: PhPrintingFile) {
    const ps = file.printSettings;
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

  private fileExtraSettingsAreValid(file: PhPrintingFile): boolean {
    const ps = file.printSettings;
    if (!ps) {
      return false;
    }
    const ctx = this.getExtraSettingsContextForFile(file);
    return validateExtraSelections(ctx, {
      ...buildPersistedExtraSelections(ctx, buildDefaultExtraUiStateMap(ctx)),
      ...ps,
    });
  }

  private getCurrentExtraSettingsContext() {
    return buildExtraSettingsContext(
      this.selectedFixedSize,
      this.selectedMaterial,
      this.selectedColor,
    );
  }

  private getColorAtIndex(
    material: PhMaterial | PhDynamicMaterial | null | undefined,
    colorIndex: number,
  ): PhColor | null {
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
    materialIndex: number,
  ): PhMaterial | null {
    if (!materials.length) {
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
    return idx >= 0 ? idx : 0;
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
    if (!colors.length) {
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
    const merged = this.mergePolledFilesWithExisting(nextFiles);
    if (isEqual(merged, this.files)) {
      return;
    }

    const prevSelectedId = this.selectedFile?._id;
    this.files = merged;
    this.processingFiles = merged.filter((file) => this.isFileProcessing(file));

    if (this.selectedFile) {
      const still = merged.find((f) => f._id === this.selectedFile!._id);
      if (!still || this.isFileProcessing(still)) {
        this.selectedFile = null;
        this.previewThumbnailUrl = null;
      } else {
        this.selectedFile = still;
        this.updatePreviewThumbnailIfChanged(still);
      }
    }

    if (!this.selectedFile) {
      const firstReady = merged.find((f) => !this.isFileProcessing(f));
      if (firstReady) {
        this.selectedFile = firstReady;
        this.previewThumbnailUrl = firstReady.thumbnailUrl?.trim() || null;
      }
    }

    this.ensureAllReadyFilesHaveSettings();

    if (this.selectedFile && this.selectedFile._id !== prevSelectedId) {
      this.syncSettingsUiFromFile(this.selectedFile);
    } else if (!this.selectedFile && this.product) {
      this.syncSettingsUiToProductDefaults();
    }
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
      if (
        this.settingsSaveInFlightForFileId === next._id &&
        prev.printSettings
      ) {
        incoming = { ...next, printSettings: prev.printSettings };
      }

      const thumbnailUnchanged = prev.thumbnailUrl === incoming.thumbnailUrl;
      const processingUnchanged = prev.processing === incoming.processing;

      if (thumbnailUnchanged && processingUnchanged) {
        if (!isEqual(prev.printSettings, incoming.printSettings)) {
          prev.printSettings = incoming.printSettings
            ? { ...incoming.printSettings }
            : undefined;
        }
        return prev;
      }

      Object.assign(prev, incoming);
      return prev;
    });
  }

  private updatePreviewThumbnailIfChanged(file: PhPrintingFile): void {
    const nextUrl = file.thumbnailUrl?.trim() || null;
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
      if (this.fileHasValidPrintSettings(file)) {
        continue;
      }
      if (this.pendingDefaultSettingsFileIds.has(file._id)) {
        continue;
      }
      const defaults = this.buildDefaultPrintSettingsForFile(file);
      if (!defaults) {
        continue;
      }
      this.pendingDefaultSettingsFileIds.add(file._id);
      this.saveFileSettings(file._id, defaults, () => {
        this.pendingDefaultSettingsFileIds.delete(file._id);
        if (this.selectedFile?._id === file._id) {
          this.syncSettingsUiFromFile(this.selectedFile);
        }
      });
    }
  }

  private fileHasValidPrintSettings(file: PhPrintingFile): boolean {
    const ps = file.printSettings;
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
      ) && this.fileExtraSettingsAreValid(file);
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
      ) && this.fileExtraSettingsAreValid(file);
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

  private buildDefaultPrintSettingsForFile(file: PhPrintingFile): PhPrintingFilePrintSettings | null {
    if (!this.product) {
      return null;
    }
    const ps = file.printSettings;
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
    if (this.hasSettingsReadyFile && this.selectedFile) {
      this.syncSettingsUiFromFile(this.selectedFile);
    } else {
      this.syncSettingsUiToProductDefaults();
    }
  }

  private syncSettingsUiToProductDefaults(): void {
    if (!this.product) {
      return;
    }

    this.suppressSettingsPersist = true;
    try {
      if (this.isFixedProduct) {
        const option = this.fixedDimensionOptions[0];
        const size = option ? this.fixedSizes[option.sizeIndex] : null;
        if (!option || !size) {
          return;
        }
        const material = size.materials?.[0] ?? null;
        const color = material?.colors?.[0] ?? null;
        this.currentFixedOptionIndex = option.optionIndex;
        this.currentMaterialIndex = 0;
        this.currentColorIndex = 0;
        this.printingLengthCm = Number(size.length);
        this.printingWidthCm = Number(size.width);
        this.extraSettingsUi = buildDefaultExtraUiStateMap(
          buildExtraSettingsContext(size, material, color),
        );
        return;
      }

      if (this.isDynamicProduct) {
        const material = this.dynamicMaterials[0];
        if (!material) {
          return;
        }
        const color = material.colors?.[0] ?? null;
        this.currentMaterialIndex = 0;
        this.currentColorIndex = 0;
        this.printingLengthCm = Number(material.defaultLength);
        this.printingWidthCm = Number(material.defaultHeight);
        this.extraSettingsUi = buildDefaultExtraUiStateMap(
          buildExtraSettingsContext(null, material, color),
        );
      }
    } finally {
      this.rebuildExtraSettingRows();
      setTimeout(() => {
        this.suppressSettingsPersist = false;
      });
    }
  }

  private syncSettingsUiFromFile(file: PhPrintingFile): void {
    if (!this.product || this.isFileProcessing(file)) {
      return;
    }

    this.suppressSettingsPersist = true;
    try {
      const ps = file.printSettings;
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
      if (!option || !size) {
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
      if (!material) {
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
    if (!this.selectedFile?._id) {
      return;
    }
    const settings = this.buildSettingsFromUi();
    if (!settings) {
      return;
    }
    this.saveFileSettings(this.selectedFile._id, settings);
  }

  private saveFileSettings(
    fileId: string,
    printSettings: PhPrintingFilePrintSettings,
    onDone?: () => void,
  ): void {
    if (!this.productId) {
      onDone?.();
      return;
    }

    this.isUpdatingFileSettings = true;
    this.settingsSaveInFlightForFileId = fileId;
    this.patchFilePrintSettings(fileId, printSettings);

    this.phPrintingFilesService
      .updateFileSettings(fileId, printSettings, this.productId)
      .subscribe({
        next: (res) => {
          this.isUpdatingFileSettings = false;
          this.settingsSaveInFlightForFileId = null;
          if (res.file?.printSettings) {
            this.patchFilePrintSettings(fileId, res.file.printSettings);
          }
          if (this.selectedFile?._id === fileId) {
            this.syncSettingsUiFromFile(this.selectedFile);
          }
          onDone?.();
        },
        error: () => {
          this.isUpdatingFileSettings = false;
          this.settingsSaveInFlightForFileId = null;
          onDone?.();
        },
      });
  }

  private patchFilePrintSettings(
    fileId: string,
    printSettings: PhPrintingFilePrintSettings,
  ): void {
    const nextSettings = { ...printSettings };
    for (const file of this.files) {
      if (file._id === fileId) {
        file.printSettings = nextSettings;
        break;
      }
    }
    if (this.selectedFile?._id === fileId) {
      this.selectedFile.printSettings = nextSettings;
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

    const originalWidth = Number(this.selectedFile.printSettings?.widthCm ?? width);
    const originalHeight = Number(this.selectedFile.printSettings?.lengthCm ?? height);

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

    this.phFilesService
      .upload(PH_FILE_TYPE_PRINTING_FILE, file, {
        printingHouseId: this.printingHouseId,
        productId: this.productId,
      })
      .subscribe({
        next: (httpEvent) => {
          if (httpEvent.type === HttpEventType.UploadProgress) {
            const total = httpEvent.total ?? 0;
            this.uploadProgress = total ? Math.round((100 * httpEvent.loaded) / total) : 0;
            return;
          }

          if (httpEvent.type !== HttpEventType.Response) {
            return;
          }

          this.finishOneUpload();
          this.phPrintingFilesService
            .getMyFiles(this.printingHouseId, this.productId)
            .subscribe({
              next: (res) => this.applyFilesFromServer(res.files ?? []),
            });
        },
        error: () => {
          this.finishOneUpload();
          this.snackBar.open(
            this.translateService.instant('ph-print.upload-failed'),
            undefined,
            { duration: 4000 },
          );
        },
      });
  }

  private finishOneUpload(): void {
    this.activeUploads = Math.max(0, this.activeUploads - 1);
    this.uploadingCount = this.activeUploads;
    this.uploading = this.activeUploads > 0;
    if (!this.uploading) {
      this.uploadProgress = 0;
    }
  }
}
