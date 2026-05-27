import { Component, Inject, OnInit, OnDestroy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DirectionService } from '../direction.service';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { copyTextToClipboard } from '../utils/clipboard-copy';

@Component({
    templateUrl: './error.component.html',
    styleUrls: ['./error.component.scss'],
    host: {
        class: 'fill-screen-modal',
    },
})
export class ErrorComponent implements OnInit, OnDestroy {
    isRTL: boolean = true;
    isDarkMode: boolean = false;
    private directionSubscription: Subscription;

    constructor(
        @Inject(MAT_DIALOG_DATA) public data: { message: string; branchName?: string | null; details?: string },
        private directionService: DirectionService,
        private dialogRef: MatDialogRef<ErrorComponent>,
        private router: Router,
        private authService: AuthService,
        private translateService: TranslateService,
        private snackBar: MatSnackBar,
    ) { }

    ngOnInit() {
        this.directionSubscription = this.directionService.direction$.subscribe(direction => {
            this.isRTL = direction === 'rtl';
        });

        this.directionService.isDarkMode$.subscribe(isDarkMode => {
            this.isDarkMode = isDarkMode;
        });
    }

    ngOnDestroy() {
        if (this.directionSubscription) {
            this.directionSubscription.unsubscribe();
        }
    }

    openWhatsApp() {
        const phoneNumber = '97233746962';
        const message = encodeURIComponent('I-Have-an-Error');
        const url = `https://wa.me/${phoneNumber}?text=${message}`;
        window.open(url, '_blank');
    }

    hasErrorDetails(): boolean {
        const d = this.data.details;
        return typeof d === 'string' && d.trim().length > 0;
    }

    closeErrorDialog(): void {
        this.dialogRef.close();
    }

    copyErrorDetails(): void {
        const errorId = this.data.message || 'UNKNOWN_ERROR';
        const userEmail = this.authService.getEmail() || '';
        const currentRoute = this.router.url || '';

        const parts: string[] = [];

        const title = this.translateService.instant('error.copy-error-title');
        parts.push(title + errorId);

        if (userEmail && userEmail !== '') {
            const emailLabel = this.translateService.instant('log-in-dialog-withmail-email');
            parts.push(`${emailLabel}: ${userEmail}`);
        }

        if (currentRoute && currentRoute !== '' && currentRoute !== '/') {
            parts.push(`rout: ${currentRoute}`);
        }

        if (this.hasErrorDetails()) {
            parts.push(`${this.translateService.instant('error-details-heading')} ${this.data.details}`);
        }

        const errorDetails = parts.join(' | ');

        void copyTextToClipboard(errorDetails)
            .then(() => {
                this.snackBar.open(this.translateService.instant('file-issues.copy-success'), '', {
                    duration: 1000,
                    panelClass: ['auto-width', 'center-text'].filter(Boolean),
                });
            })
            .catch((err) => console.error('Could not copy text: ', err));
    }
}
