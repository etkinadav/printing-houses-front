import {
    HttpErrorResponse,
    HttpHandler,
    HttpInterceptor,
    HttpRequest,
} from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { throwError, of } from 'rxjs';
import { Injectable } from '@angular/core';
import { AuthService } from './auth/auth.service';
import { DialogService } from './dialog/dialog.service';

/** Minimum ms between logout() calls for auth failure – prevents burst of 401s from causing repeated logout/navigate. */
const AUTH_LOGOUT_COOLDOWN_MS = 3000;

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
    private lastAuthLogoutTime = 0;

    constructor(
        private authService: AuthService,
        private dialogService: DialogService,
    ) { }

    intercept(req: HttpRequest<any>, next: HttpHandler) {
        return next.handle(req).pipe(
            catchError((error: HttpErrorResponse) => {
                if (error.status === 0 && error.statusText === 'Unknown Error') {
                    return of(null);
                }

                const errorMessage: string = error.error?.message || 'unknown_error';

                if (errorMessage === 'AUTH_FAILED_TOKEN_INCORECT_LOGOUT') {
                    const cooldownPassed = (Date.now() - this.lastAuthLogoutTime) >= AUTH_LOGOUT_COOLDOWN_MS;
                    const shouldClearAuth = this.authService.getToken() != null || this.authService.getIsAuth();
                    if (cooldownPassed && shouldClearAuth) {
                        this.lastAuthLogoutTime = Date.now();
                        this.authService.logout();
                    }
                } else if (errorMessage === 'unknown_error') {
                    console.warn('Unknown error occurred:', error);
                } else {
                    const rawDetails = error.error?.details;
                    const details =
                        typeof rawDetails === 'string' && rawDetails.trim().length > 0
                            ? rawDetails
                            : undefined;
                    this.dialogService.onOpenErrorDialog({
                        message: errorMessage,
                        details,
                    });
                }
                return throwError(error);
            }),
        );
    }
}
