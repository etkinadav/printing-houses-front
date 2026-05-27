import { HttpHandler, HttpInterceptor, HttpRequest } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { AuthService } from "./auth.service";

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
    constructor(private authService: AuthService) { }

    intercept(req: HttpRequest<any>, next: HttpHandler) {
        const authToken = this.authService.getToken();
        const printingService = localStorage.getItem('printingService');
        const branch = localStorage.getItem('branch');
        
        // Never add Authorization for same-origin assets (e.g. i18n) – avoids "Bearer undefined" on early load
        const isAssetRequest = /\/assets\//.test(req.url) || /assets\/i18n\//.test(req.url);
        const hasValidToken = authToken != null && authToken !== '' && authToken !== 'undefined' && authToken !== 'null';
        let headers = req.headers;
        if (!isAssetRequest && hasValidToken) {
            headers = headers.set('Authorization', "Bearer " + authToken);
        }

        let body = req.body;

        // For POST/PUT/PATCH/DELETE, add printingservice and branch to body
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
            body = {
                ...body,
                printingservice: printingService,
                branch: branch
            };
        }

        const authRequest = req.clone({ headers, body });

        return next.handle(authRequest);
    }
}

// OLD - before adding printingService and branch to the headers
// @Injectable()
// export class AuthInterceptor implements HttpInterceptor {
//     constructor(private authService: AuthService) { }

//     intercept(req: HttpRequest<any>, next: HttpHandler) {
//         const authToken = this.authService.getToken();
//         const authRequest = req.clone({
//             headers: req.headers.set('Authorization', "Bearer " + authToken)
//         });
//         return next.handle(authRequest);
//     }
// }