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
import { PhPrintingFilesService } from '../ph-printing-files/ph-printing-files.service';
import {
  PhDynamicMaterial,
  PhProduct,
  PhSize,
} from '../ph-products/ph-product.model';
import { PhProductsService } from '../ph-products/ph-products.service';
import { EXPRESS_FILE_ACCEPT } from '../utils/ph-express-upload';
import { PhUploadValidationService } from '../utils/ph-upload-validation.service';

const POLL_MS = 4000;
/** Same threshold as mean-corse-01 printing-table additional controls at list end. */
const FILES_END_CONTROLS_THRESHOLD = 6;
const SIZE_TOGGLE_PER_ROW = 4;

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

  files: PhPrintingFile[] = [];
  processingFiles: PhPrintingFile[] = [];
  selectedFile: PhPrintingFile | null = null;
  /** Stable preview URL — only changes when the selected file or its thumbnail changes. */
  previewThumbnailUrl: string | null = null;

  /** Fixed sizes: selected index in properties.fixed.sizes. */
  currentSizeIndex: number | null = null;
  /** Dynamic: selected material index. */
  currentMaterialIndex = 0;
  printingLengthCm = 0;
  printingWidthCm = 0;

  uploading = false;
  uploadProgress = 0;
  uploadingCount = 0;
  readonly expressFileAccept = EXPRESS_FILE_ACCEPT;
  readonly sizeTogglePerRow = SIZE_TOGGLE_PER_ROW;

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private pollSub?: Subscription;
  private activeUploads = 0;
  private isUpdatingFileSettings = false;
  private settingsSaveInFlightForFileId: string | null = null;
  private pendingDefaultSettingsFileIds = new Set<string>();

  constructor(
    private route: ActivatedRoute,
    private directionService: DirectionService,
    private authService: AuthService,
    private phFilesService: PhFilesService,
    private phPrintingFilesService: PhPrintingFilesService,
    private phProductsService: PhProductsService,
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

  get hasSettingsReadyFile(): boolean {
    return !!this.selectedFile && !this.isFileProcessing(this.selectedFile);
  }

  ngOnInit(): void {
    this.directionSub = this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
    });
    this.darkModeSub = this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });

    this.route.queryParamMap.subscribe((params) => {
      this.printingHouseId = params.get('printingHouseId')?.trim() || '';
      this.productId = params.get('productId')?.trim() || '';
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

  isSelected(file: PhPrintingFile): boolean {
    return this.selectedFile?._id === file._id;
  }

  getDisplayFileName(file: PhPrintingFile): string {
    return file.originalFileName?.trim() || this.translateService.instant('printing-table.file');
  }

  getSizeLabel(size: PhSize): string {
    const label = size.label?.he?.trim();
    if (label) {
      return label;
    }
    return `${size.length}×${size.width}`;
  }

  getMaterialLabel(material: PhDynamicMaterial): string {
    return material.label?.he?.trim() || String(material.weight);
  }

  groupSizesForPreview(rowIndex: number): PhSize[] {
    const start = rowIndex * SIZE_TOGGLE_PER_ROW;
    return this.fixedSizes.slice(start, start + SIZE_TOGGLE_PER_ROW);
  }

  groupSizesRowIndexes(): number[] {
    const rowNum = Math.ceil(this.fixedSizes.length / SIZE_TOGGLE_PER_ROW);
    return Array.from({ length: rowNum }, (_, i) => i);
  }

  groupMaterialsForPreview(rowIndex: number): PhDynamicMaterial[] {
    const start = rowIndex * SIZE_TOGGLE_PER_ROW;
    return this.dynamicMaterials.slice(start, start + SIZE_TOGGLE_PER_ROW);
  }

  groupMaterialsRowIndexes(): number[] {
    const rowNum = Math.ceil(this.dynamicMaterials.length / SIZE_TOGGLE_PER_ROW);
    return Array.from({ length: rowNum }, (_, i) => i);
  }

  onFixedSizeChange(sizeIndex: number): void {
    const size = this.fixedSizes[sizeIndex];
    if (!size || !this.selectedFile) {
      return;
    }
    this.currentSizeIndex = sizeIndex;
    this.printingLengthCm = Number(size.length);
    this.printingWidthCm = Number(size.width);
    this.persistCurrentFileSettings();
  }

  onDynamicMaterialChange(materialIndex: number): void {
    const material = this.dynamicMaterials[materialIndex];
    if (!material || !this.selectedFile) {
      return;
    }
    this.currentMaterialIndex = materialIndex;
    this.printingLengthCm = Number(material.defaultLength);
    this.printingWidthCm = Number(material.defaultHeight);
    this.persistCurrentFileSettings();
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
      .deleteAll(this.printingHouseId, this.productId)
      .subscribe({
        next: () => {
          this.files = [];
          this.processingFiles = [];
          this.selectedFile = null;
          this.previewThumbnailUrl = null;
          this.pendingDefaultSettingsFileIds.clear();
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

  private loadProduct(): void {
    this.product = null;
    this.productName = '';
    if (!this.printingHouseId || !this.productId) {
      return;
    }

    this.phProductsService.getProductsByPrintingHousePublic(this.printingHouseId).subscribe({
      next: (res) => {
        const product =
          (res.products ?? []).find((p: PhProduct) => p._id === this.productId) ?? null;
        this.product = product;
        this.productName = product?.name_he?.trim() || '';
        this.afterProductLoaded();
      },
    });
  }

  private afterProductLoaded(): void {
    if (!this.product) {
      return;
    }
    this.ensureAllReadyFilesHaveSettings();
    if (this.selectedFile && !this.isFileProcessing(this.selectedFile)) {
      this.syncSettingsUiFromFile(this.selectedFile);
    }
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
      const defaults = this.buildDefaultPrintSettings();
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
      const idx = Number(ps.sizeIndex);
      return Number.isInteger(idx) && idx >= 0 && idx < this.fixedSizes.length;
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
      return this.areDynamicDimensionsValid(
        this.dynamicMaterials[materialIndex],
        lengthCm,
        widthCm,
      );
    }
    return false;
  }

  private buildDefaultPrintSettings(): PhPrintingFilePrintSettings | null {
    if (!this.product) {
      return null;
    }
    if (this.isFixedProduct) {
      const size = this.fixedSizes[0];
      if (!size) {
        return null;
      }
      return {
        paperType: this.getSizeLabel(size),
        sizeIndex: 0,
        lengthCm: Number(size.length),
        widthCm: Number(size.width),
      };
    }
    if (this.isDynamicProduct) {
      const material = this.dynamicMaterials[0];
      if (!material) {
        return null;
      }
      return {
        paperType: this.getMaterialLabel(material),
        materialIndex: 0,
        lengthCm: Number(material.defaultLength),
        widthCm: Number(material.defaultHeight),
      };
    }
    return null;
  }

  private syncSettingsUiFromFile(file: PhPrintingFile): void {
    if (!this.product || this.isFileProcessing(file)) {
      return;
    }

    const ps = file.printSettings;
    if (this.isFixedProduct) {
      const idx =
        ps?.sizeIndex != null && Number.isFinite(Number(ps.sizeIndex))
          ? Number(ps.sizeIndex)
          : 0;
      const size = this.fixedSizes[idx] ?? this.fixedSizes[0];
      this.currentSizeIndex = size ? idx : null;
      this.printingLengthCm = Number(ps?.lengthCm ?? size?.length ?? 0);
      this.printingWidthCm = Number(ps?.widthCm ?? size?.width ?? 0);
      return;
    }

    if (this.isDynamicProduct) {
      const materialIndex =
        ps?.materialIndex != null && Number.isFinite(Number(ps.materialIndex))
          ? Number(ps.materialIndex)
          : 0;
      const material = this.dynamicMaterials[materialIndex] ?? this.dynamicMaterials[0];
      this.currentMaterialIndex = material ? materialIndex : 0;
      this.printingLengthCm = Number(
        ps?.lengthCm ?? material?.defaultLength ?? 0,
      );
      this.printingWidthCm = Number(
        ps?.widthCm ?? material?.defaultHeight ?? 0,
      );
    }
  }

  private buildSettingsFromUi(): PhPrintingFilePrintSettings | null {
    if (!this.product) {
      return null;
    }
    if (this.isFixedProduct) {
      const idx = this.currentSizeIndex ?? 0;
      const size = this.fixedSizes[idx];
      if (!size) {
        return null;
      }
      return {
        paperType: this.getSizeLabel(size),
        sizeIndex: idx,
        lengthCm: Number(size.length),
        widthCm: Number(size.width),
      };
    }
    if (this.isDynamicProduct) {
      const material = this.selectedDynamicMaterial;
      if (!material) {
        return null;
      }
      return {
        paperType: this.getMaterialLabel(material),
        materialIndex: this.currentMaterialIndex,
        lengthCm: this.roundCm(this.printingLengthCm) ?? this.printingLengthCm,
        widthCm: this.roundCm(this.printingWidthCm) ?? this.printingWidthCm,
      };
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
