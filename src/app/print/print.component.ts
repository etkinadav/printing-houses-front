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
import { PhPrintingFile } from '../ph-printing-files/ph-printing-file.model';
import { PhPrintingFilesService } from '../ph-printing-files/ph-printing-files.service';
import { PhProduct } from '../ph-products/ph-product.model';
import { PhProductsService } from '../ph-products/ph-products.service';

const POLL_MS = 4000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'tif',
  'tiff',
  'heic',
  'heif',
]);

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

  files: PhPrintingFile[] = [];
  processingFiles: PhPrintingFile[] = [];
  selectedFile: PhPrintingFile | null = null;

  uploading = false;
  uploadProgress = 0;
  uploadingCount = 0;

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private pollSub?: Subscription;
  private activeUploads = 0;

  constructor(
    private route: ActivatedRoute,
    private directionService: DirectionService,
    private authService: AuthService,
    private phFilesService: PhFilesService,
    private phPrintingFilesService: PhPrintingFilesService,
    private phProductsService: PhProductsService,
    private translateService: TranslateService,
    private snackBar: MatSnackBar,
  ) {}

  get finishedCount(): number {
    return this.files.length - this.processingFiles.length;
  }

  get hasFiles(): boolean {
    return this.files.length > 0;
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
      this.loadProductName();
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
  }

  isSelected(file: PhPrintingFile): boolean {
    return this.selectedFile?._id === file._id;
  }

  getDisplayFileName(file: PhPrintingFile): string {
    return file.originalFileName?.trim() || this.translateService.instant('printing-table.file');
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

  private loadProductName(): void {
    this.productName = '';
    if (!this.printingHouseId || !this.productId) {
      return;
    }

    this.phProductsService.getProductsByPrintingHousePublic(this.printingHouseId).subscribe({
      next: (res) => {
        const product = (res.products ?? []).find((p: PhProduct) => p._id === this.productId);
        this.productName = product?.name_he?.trim() || '';
      },
    });
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
    if (isEqual(nextFiles, this.files)) {
      return;
    }

    this.files = nextFiles;
    this.processingFiles = nextFiles.filter((file) => this.isFileProcessing(file));

    if (this.selectedFile) {
      const still = nextFiles.find((f) => f._id === this.selectedFile!._id);
      if (!still || this.isFileProcessing(still)) {
        this.selectedFile = null;
      } else {
        this.selectedFile = still;
      }
    }

    if (!this.selectedFile) {
      const firstReady = nextFiles.find((f) => !this.isFileProcessing(f));
      if (firstReady) {
        this.selectedFile = firstReady;
      }
    }
  }

  private uploadFile(file: File): void {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      this.snackBar.open(
        this.translateService.instant('ph-print.invalid-file-type'),
        undefined,
        { duration: 4000 },
      );
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      this.snackBar.open(
        this.translateService.instant('ph-print.file-too-large'),
        undefined,
        { duration: 4000 },
      );
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
