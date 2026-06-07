import { Injectable } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';

import { PreloginComponent } from '../auth/prelogin/prelogin.component';
import { ErrorComponent } from '../error/error.component';
import { PhoneComponent } from './phone/phone.component';
import { LanguageChangeComponent } from './language-change/language-change.component';
import { FileIssuesComponent } from './file-issues/file-issues.component';

@Injectable({
  providedIn: 'root',
})
export class DialogService {
  private dialogLoginRef: MatDialogRef<PreloginComponent> | null = null;
  private dialogErrorRef: MatDialogRef<ErrorComponent> | null = null;
  private dialogPhoneRef: MatDialogRef<PhoneComponent> | null = null;
  private dialogLanguageChangeRef: MatDialogRef<LanguageChangeComponent> | null = null;
  private dialogFileIssuesRef: MatDialogRef<FileIssuesComponent> | null = null;

  public loginDialogClosed$ = new Subject<void>();

  constructor(
    private dialog: MatDialog,
  ) { }

  /** Current direction for opening dialogs – matches document.dir for correct RTL/LTR. */
  private getDialogDirection(): 'ltr' | 'rtl' {
    return (document.documentElement.getAttribute('dir') || 'ltr') as 'ltr' | 'rtl';
  }

  focusMain() {
    setTimeout(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.matches('input, textarea, select')) {
        return;
      }
      const dialogContainer = document.querySelector('mat-dialog-container');
      for (let i = 1; i <= 6; i++) {
        let heading = document.querySelector(`h${i}`);
        if (dialogContainer) {
          heading = dialogContainer.querySelector(`h${i}`);
        }
        if (heading && typeof (heading as HTMLElement).focus === 'function') {
          (heading as HTMLElement).setAttribute('tabindex', '-1');
          (heading as HTMLElement).focus();
          (heading as HTMLElement).classList.add('no-mobile-outline');
          break;
        }
      }
    }, 200);
  }

  // Login Dialog
  onOpenLoginDialog(): void {
    this.dialogLoginRef = this.dialog.open(PreloginComponent, {
      direction: this.getDialogDirection(),
      panelClass: 'zx-login-dialog',
    });
    this.dialogLoginRef.afterClosed().subscribe(() => {
      this.dialogLoginRef = null;
      this.loginDialogClosed$.next();
    });
    this.focusMain();
  }

  onCloseLoginDialog(): void {
    if (this.dialogLoginRef) {
      this.dialogLoginRef.close();
      this.dialogLoginRef = null;
    }
    this.focusMain();
  }

  /**
   * Single-instance Error dialog: prevents duplicate alerts stacking.
   * If already open, does nothing (but re-focuses for accessibility).
   */
  onOpenErrorDialog(
    data: { message: string; branchName?: string | null; details?: string },
    options?: { panelClass?: string | string[] },
  ): void {
    if (this.dialogErrorRef) {
      this.focusMain();
      return;
    }
    const panelClass = options?.panelClass ?? 'zx-login-dialog';
    this.dialogErrorRef = this.dialog.open(ErrorComponent, {
      direction: this.getDialogDirection(),
      panelClass,
      data,
    });
    this.dialogErrorRef.afterClosed().subscribe(() => {
      this.dialogErrorRef = null;
    });
    this.focusMain();
  }

  // Phone Dialog
  onOpenPhoneDialog(): void {
    this.dialogPhoneRef = this.dialog.open(PhoneComponent, {
      direction: this.getDialogDirection(),
      panelClass: 'zx-phone-dialog',
    });
    this.focusMain();
  }

  onClosePhoneDialog(): void {
    this.dialogPhoneRef?.close();
    this.focusMain();
  }

  // Language Change Dialog
  onOpenLanguageChangeDialog(
    usedLanguage: string,
    browserLanguage: string,
  ): void {
    if (!this.dialogLanguageChangeRef) {
      this.dialogLanguageChangeRef = this.dialog.open(LanguageChangeComponent, {
        direction: this.getDialogDirection(),
        panelClass: 'zx-language-chainge-dialog',
        hasBackdrop: false,
        data: {
          usedLanguage: usedLanguage,
          browserLanguage: browserLanguage,
        },
      });
    }
    this.focusMain();
  }

  onCloseLanguageChangeDialog(): void {
    this.dialogLanguageChangeRef?.close();
    this.dialogLanguageChangeRef = null;
    this.focusMain();
  }

  /** Stub kept for compatibility with my-profile.component (delete account button). */
  onOpenDeleteUserDialog(_user: any, _isSU: boolean = false): void {
    console.warn('DeleteUserDialog is not implemented in this app.');
  }

  onOpenFileIssuesDialog(
    fileName: string,
    allowedFormats: string[],
    phoneNumber: string,
    state: string = 'file-format-not-supported',
    additionalData?: Record<string, unknown>,
  ): void {
    this.dialogFileIssuesRef = this.dialog.open(FileIssuesComponent, {
      direction: this.getDialogDirection(),
      panelClass: 'zx-printer-number-dialog',
      data: {
        fileName,
        allowedFormats,
        phoneNumber,
        state,
        serverAddress: additionalData?.['serverAddress'] ?? '',
        branchName: additionalData?.['branchName'] ?? '',
        printingService: additionalData?.['printingService'] ?? '',
        fileFormat: additionalData?.['fileFormat'] ?? '',
        internetSpeed: additionalData?.['internetSpeed'] ?? '',
        internetSpeedValue: additionalData?.['internetSpeedValue'] ?? null,
        dpi: additionalData?.['dpi'] ?? null,
        fileSizeMb: additionalData?.['fileSizeMb'] ?? null,
      },
    });
    this.dialogFileIssuesRef.afterClosed().subscribe(() => {
      this.dialogFileIssuesRef = null;
    });
    this.focusMain();
  }

  onCloseFileIssuesDialog(): void {
    this.dialogFileIssuesRef?.close();
    this.dialogFileIssuesRef = null;
    this.focusMain();
  }
}
