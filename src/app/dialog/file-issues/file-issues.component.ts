import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

import { DirectionService } from '../../direction.service';
import { copyTextToClipboard } from '../../utils/clipboard-copy';

@Component({
  selector: 'app-file-issues',
  templateUrl: './file-issues.component.html',
  styleUrls: ['./file-issues.component.css'],
  host: {
    class: 'fill-screen-modal-phone',
  },
})
export class FileIssuesComponent implements OnInit, OnDestroy {
  isRTL = true;
  isDarkMode = false;

  fileName: string;
  allowedFormats: string[];
  state: string;
  serverAddress: string;
  fileSizeMb: number | null;
  branchName: string;
  printingService: string;
  fileFormat: string;
  internetSpeed: string;
  internetSpeedValue: number | null;
  dpi: number | null;

  readonly editGuideSoftwareKeys = [
    'q-and-a.2.software.illustrator',
    'q-and-a.2.software.photoshop',
    'q-and-a.2.software.indesign',
    'q-and-a.2.software.autocad',
    'q-and-a.2.software.canva',
    'q-and-a.2.software.powerpoint',
    'q-and-a.2.software.revit',
    'q-and-a.2.software.word',
  ];

  private directionSubscription?: Subscription;

  constructor(
    private directionService: DirectionService,
    public dialogRef: MatDialogRef<FileIssuesComponent>,
    private translateService: TranslateService,
    private snackBar: MatSnackBar,
    @Inject(MAT_DIALOG_DATA) public data: Record<string, unknown>,
  ) {
    this.fileName = String(data['fileName'] ?? '');
    this.allowedFormats = (data['allowedFormats'] as string[]) || [];
    this.state = String(data['state'] ?? 'file-format-not-supported');
    this.serverAddress = String(data['serverAddress'] ?? '');
    this.branchName = String(data['branchName'] ?? '');
    this.printingService = String(data['printingService'] ?? '');
    this.fileFormat = String(data['fileFormat'] ?? '');
    this.internetSpeed = String(data['internetSpeed'] ?? '');
    this.internetSpeedValue = (data['internetSpeedValue'] as number | null) ?? null;
    this.dpi = (data['dpi'] as number | null) ?? null;
    this.fileSizeMb = (data['fileSizeMb'] as number | null) ?? null;
  }

  ngOnInit(): void {
    this.directionSubscription = this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
    });

    this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });
  }

  closeDialog(): void {
    this.dialogRef.close();
  }

  goToEditInstructions(): void {
    this.openWhatsAppHelp('File-Editing-Help-At-Eazix');
  }

  openWhatsAppInstructions(): void {
    if (
      this.state === 'file-too-large' ||
      this.state === 'file-format-not-supported' ||
      this.state === 'weird-dpi' ||
      this.state === 'plotter-processing-failed'
    ) {
      this.goToEditInstructions();
      return;
    }

    if (this.state === 'file-not-received-in-server') {
      this.openWhatsAppHelp('Uploading-Error-At-Eazix');
    }
  }

  isPhSystemFileFormatIssue(): boolean {
    return this.state === 'file-format-not-supported' && this.printingService === 'ph';
  }

  getSpeedCategory(): string {
    if (this.internetSpeedValue === null) {
      return 'unknown';
    }
    const speed = this.internetSpeedValue;
    if (speed < 1) {
      return 'very-low';
    }
    if (speed < 2) {
      return 'low';
    }
    if (speed < 4) {
      return 'reasonable';
    }
    if (speed < 8) {
      return 'good';
    }
    return 'very-good';
  }

  getRoundedSpeed(): string {
    if (this.internetSpeedValue === null) {
      return '0';
    }
    return this.internetSpeedValue.toFixed(1);
  }

  getSpeedMessage(): string {
    return this.translateService.instant(`file-issues.speed-message.${this.getSpeedCategory()}`);
  }

  getSpeedLabel(): string {
    return this.translateService.instant(`file-issues.speed-label.${this.getSpeedCategory()}`);
  }

  copyErrorDetails(): void {
    const fileFormatDisplay =
      this.fileFormat && this.fileFormat !== 'N/A' && this.fileFormat !== 'ידוע'
        ? this.fileFormat.toUpperCase()
        : 'N/A';
    const errorDetails = [
      `שם קובץ: ${this.fileName}`,
      `סיומת קובץ: ${fileFormatDisplay}`,
      `Endpoint: ${this.serverAddress}`,
      `שם סניף: ${this.branchName}`,
      `שירות הדפסה: ${this.printingService}`,
      `מהירות גלישה: ${this.internetSpeed}`,
      `State: ${this.state}`,
      `פורמטים נתמכים: ${
        this.allowedFormats.length > 0 ? this.allowedFormats.join(', ').toUpperCase() : 'N/A'
      }`,
      ...(this.state === 'weird-dpi' && this.dpi ? [`DPI: ${this.dpi}`] : []),
    ].join(' | ');

    void copyTextToClipboard(errorDetails)
      .then(() => {
        this.snackBar.open(this.translateService.instant('file-issues.copy-success'), '', {
          duration: 1000,
          panelClass: ['auto-width', 'center-text'].filter(Boolean),
        });
      })
      .catch((err) => console.error('Could not copy text: ', err));
  }

  private openWhatsAppHelp(messageKey: string): void {
    const phoneNumber = String(this.data['phoneNumber'] ?? '97233746962');
    const message = encodeURIComponent(messageKey);
    this.dialogRef.close();
    window.open(`https://wa.me/${phoneNumber}?text=${message}`, '_blank');
  }

  ngOnDestroy(): void {
    this.directionSubscription?.unsubscribe();
  }
}
