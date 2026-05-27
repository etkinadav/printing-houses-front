import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { TranslateService } from '@ngx-translate/core'; // Import TranslateService

@Injectable({
    providedIn: 'root',
})
export class DirectionService {
    private directionSubject = new BehaviorSubject<'ltr' | 'rtl'>('rtl');
    direction$ = this.directionSubject.asObservable();
    private currentLanguageSubject = new BehaviorSubject<string>('he');
    currentLanguage$ = this.currentLanguageSubject.asObservable();
    private RTLLanguages = ['he', 'ar'];

    private isDarkModeSubject = new BehaviorSubject<boolean>(false);
    isDarkMode$: Observable<boolean> = this.isDarkModeSubject.asObservable();

    // Material Icons loading state
    private materialIconsReadySubject = new BehaviorSubject<boolean>(false);
    materialIconsReady$: Observable<boolean> = this.materialIconsReadySubject.asObservable();

    constructor(
        private translateService: TranslateService,
    ) {
        if (localStorage.getItem('language')) {
            this.currentLanguageSubject.next(localStorage.getItem('language'));
        }
        this.currentLanguage$.subscribe((lang) => {
            if (this.RTLLanguages.includes(lang)) {
                this.setDirection('rtl');
            } else {
                this.setDirection('ltr');
            }
        });
    }

    setDirection(dir: 'ltr' | 'rtl') {
        document.documentElement.setAttribute('dir', dir);
        this.directionSubject.next(dir);
        // עדכון כיוון לכל דיאלוגים פתוחים (mat-dialog-container) כדי שלא יתהפכו בצורה לא תקינה בהחלפת שפה
        document.querySelectorAll('.mat-dialog-container').forEach((el: Element) => el.setAttribute('dir', dir));
    }

    toLanguageDirection(lang: string) {
        this.currentLanguageSubject.next(lang);
        this.translateService.use(lang);
        localStorage.setItem('language', lang);
        localStorage.setItem('hideLangModel', lang);
        document.documentElement.setAttribute('lang', lang);
    }

    setDarkMode(isDarkMode: boolean) {
        this.isDarkModeSubject.next(isDarkMode);
    }

    // Check and wait for Material Icons font to load
    async checkMaterialIconsLoaded(): Promise<void> {
        // Add loading class to body initially
        document.body.classList.add('material-icons-loading');
        
        // Fallback timeout - after 5 seconds, force icons to be ready
        const fallbackTimeout = setTimeout(() => {
            if (!this.materialIconsReadySubject.getValue()) {
                this.setMaterialIconsReady();
            }
        }, 5000);
        
        try {
            // Wait for all fonts to be ready
            await (document as any).fonts.ready;
            
            // Check specifically for Material Icons font
            const materialIconsLoaded = (document as any).fonts.check('24px "Material Icons"');
            
            if (materialIconsLoaded) {
                clearTimeout(fallbackTimeout);
                this.setMaterialIconsReady();
            } else {
                // Font API ready but Material Icons not yet loaded, wait a bit more
                setTimeout(() => {
                    if (!this.materialIconsReadySubject.getValue()) {
                        clearTimeout(fallbackTimeout);
                        this.setMaterialIconsReady();
                    }
                }, 500);
            }
        } catch (error) {
            // Fallback - set ready after short timeout
            setTimeout(() => {
                if (!this.materialIconsReadySubject.getValue()) {
                    clearTimeout(fallbackTimeout);
                    this.setMaterialIconsReady();
                }
            }, 500);
        }
    }

    private setMaterialIconsReady(): void {
        document.body.classList.remove('material-icons-loading');
        this.materialIconsReadySubject.next(true);
    }

    isMaterialIconsReady(): boolean {
        return this.materialIconsReadySubject.getValue();
    }
}