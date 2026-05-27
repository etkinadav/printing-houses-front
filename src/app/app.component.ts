import { Component, OnInit, Inject, ElementRef, Renderer2, AfterViewInit, OnDestroy, NgZone } from '@angular/core';
import { AuthService } from './auth/auth.service';
import { DOCUMENT } from '@angular/common';
import { applyShellVhCssVariable } from './shell-viewport';
import { DirectionService } from './direction.service';
import { TranslateService } from '@ngx-translate/core';

import { DialogService } from './dialog/dialog.service';

import { Meta } from '@angular/platform-browser';
import { Router, NavigationEnd } from '@angular/router';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {

  isRTL: boolean = true;
  language: string = 'he';
  screenHeight = 1;
  private resizeListener = () => this.updateVhConsideringTranslateBar();
  private readonly visualViewportResizeListener = () =>
    this.updateVhConsideringTranslateBar();
  supportedLanguages = ['he', 'en', 'ar'];

  // Pull-to-refresh
  isPulling: boolean = false;
  isRefreshing: boolean = false;
  pullDistance: number = 0;
  private touchStartY: number = 0;
  private touchCurrentY: number = 0;
  private readonly PULL_THRESHOLD: number = 70;
  private readonly MAX_PULL_DISTANCE: number = 100;
  private refreshTimeout: any;
  private touchStartPassiveHandler = (e: TouchEvent) => this.onTouchStart(e);
  private touchMoveHandler = (e: TouchEvent) => this.onTouchMoveInner(e);
  private touchEndHandler = () => this.onTouchEndInner();
  private pullListenersAttached = false;
  private readonly appLoadTime = Date.now();

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    private translate: TranslateService,
    private directionService: DirectionService,
    private authService: AuthService,
    private dialogService: DialogService,
    @Inject(DOCUMENT) private document: Document,
    private render: Renderer2,
    private meta: Meta,
    private router: Router,
    private ngZone: NgZone,
  ) {
    if (localStorage.getItem('language')) {
      this.language = localStorage.getItem('language');
    }

    setTimeout(() => {
      if (!localStorage.getItem('hideLangModel') &&
        (!localStorage.getItem('language') ||
          localStorage.getItem('language') !== 'he')) {
        this.directionService.currentLanguage$.subscribe(lang => {
          let userLang = navigator.language ? navigator.language : null;
          const isSupported = this.supportedLanguages.includes(lang);
          if (!isSupported) {
            userLang = 'en';
          }
          if (userLang && this.language && !userLang.startsWith(this.language)) {
            this.dialogService.onOpenLanguageChangeDialog(
              this.language,
              userLang,
            );
          }
        });
      }
    }, 2000);

    translate.setDefaultLang(this.language);
    translate.use(this.language);

    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        setTimeout(() => {
          this.focusMain();
        }, 0);
      }
    });
  }

  focusMain() {
    for (let i = 1; i <= 6; i++) {
      const heading = document.querySelector(`h${i}`);
      if (heading && typeof (heading as HTMLElement).focus === 'function') {
        (heading as HTMLElement).setAttribute('tabindex', '-1');
        (heading as HTMLElement).focus();
        (heading as HTMLElement).classList.add('no-mobile-outline');
        break;
      }
    }
  }

  ngOnInit() {
    this.authService.autoAuthUser();
    this.render.addClass(this.document.body, 'lightTheme');
    this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
      this.document.documentElement.dir = this.isRTL ? 'rtl' : 'ltr';
    });
    this.translate.onLangChange.subscribe(event => {
      this.language = event.lang;
      this.document.documentElement.lang = this.language;
    });
    this.document.documentElement.lang = this.language;

    this.setMetaDescription(this.language);
    this.translate.onLangChange.subscribe(event => {
      this.setMetaDescription(event.lang);
    });

    this.directionService.checkMaterialIconsLoaded();
  }

  ngAfterViewInit(): void {
    this.updateVhConsideringTranslateBar();
    const host = this.elementRef.nativeElement;
    host.addEventListener('touchstart', this.touchStartPassiveHandler, { passive: true });
    window.addEventListener('resize', this.resizeListener);
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.visualViewportResizeListener);
    }
    let tries = 0;
    const intervalId = setInterval(() => {
      this.updateVhConsideringTranslateBar();
      tries++;
      if (tries >= 4) {
        clearInterval(intervalId);
      }
    }, 8000);
  }

  ngOnDestroy(): void {
    this.elementRef.nativeElement.removeEventListener('touchstart', this.touchStartPassiveHandler);
    this.detachPullListeners();
    window.removeEventListener('resize', this.resizeListener);
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.visualViewportResizeListener);
    }
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
  }

  updateVhConsideringTranslateBar(): void {
    const translateHeight = this.getTranslateBannerHeight();
    const placeholder = this.document.getElementById('translate-placeholder');
    if (placeholder) {
      placeholder.style.height = translateHeight ? `${translateHeight}px` : '0';
    }
    applyShellVhCssVariable(this.document, window, translateHeight);
  }

  getTranslateBannerHeight(): number {
    const iframe =
      document.getElementById('gt-nvframe') as HTMLElement ||
      document.querySelector('iframe[title="Google Translate"]') as HTMLElement ||
      document.querySelector('iframe.goog-te-banner-frame') as HTMLElement ||
      document.querySelector('.goog-te-banner-frame') as HTMLElement;

    let iframeHeight = 0;
    if (iframe) {
      iframeHeight = iframe.getBoundingClientRect().height;
    }

    const bodyMargin = parseFloat(window.getComputedStyle(document.body).marginTop || '0');
    return Math.max(iframeHeight, bodyMargin);
  }

  setMetaDescription(lang: string) {
    let desc = this.translate.instant('meta-description');
    if (!desc || desc === 'meta-description') {
      desc = 'Printing Houses platform.';
    }
    this.meta.updateTag({ name: 'description', content: desc });
  }

  onTouchStart(event: TouchEvent) {
    if (window.scrollY === 0 && this.isMobileDevice() && this.isTouchOnToolbar(event)) {
      this.touchStartY = event.touches[0].clientY;
      this.touchCurrentY = this.touchStartY;
      this.attachPullListeners();
    } else {
      this.touchStartY = 0;
      this.touchCurrentY = 0;
    }
  }

  private isTouchOnToolbar(event: TouchEvent): boolean {
    const target = event.target as HTMLElement;
    if (!target) return false;
    const toolbar = target.closest('mat-toolbar');
    return toolbar !== null;
  }

  private attachPullListeners(): void {
    if (this.pullListenersAttached) return;
    this.pullListenersAttached = true;
    this.document.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
    this.document.addEventListener('touchend', this.touchEndHandler, { passive: true });
    this.document.addEventListener('touchcancel', this.touchEndHandler, { passive: true });
  }

  private detachPullListeners(): void {
    if (!this.pullListenersAttached) return;
    this.pullListenersAttached = false;
    this.document.removeEventListener('touchmove', this.touchMoveHandler);
    this.document.removeEventListener('touchend', this.touchEndHandler);
    this.document.removeEventListener('touchcancel', this.touchEndHandler);
  }

  private onTouchMoveInner(event: TouchEvent) {
    if (window.scrollY === 0 && this.isMobileDevice() && this.touchStartY > 0) {
      this.touchCurrentY = event.touches[0].clientY;
      const deltaY = this.touchCurrentY - this.touchStartY;
      if (deltaY > 0) {
        event.preventDefault();
        this.ngZone.run(() => {
          this.isPulling = true;
          this.pullDistance = Math.min(deltaY * 0.5, this.MAX_PULL_DISTANCE);
        });
      } else {
        this.removePullAndReset();
      }
    } else if (this.touchStartY > 0) {
      this.removePullAndReset();
    }
  }

  private onTouchEndInner() {
    if (this.isPulling && this.pullDistance >= this.PULL_THRESHOLD) {
      this.ngZone.run(() => this.triggerRefresh());
    } else {
      this.removePullAndReset();
    }
    this.detachPullListeners();
  }

  private removePullAndReset(): void {
    this.ngZone.run(() => this.resetPull());
  }

  private isMobileDevice(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  private resetPull() {
    this.isPulling = false;
    this.pullDistance = 0;
    this.touchStartY = 0;
    this.touchCurrentY = 0;
  }

  private triggerRefresh() {
    this.isPulling = false;
    this.isRefreshing = true;
    this.pullDistance = this.PULL_THRESHOLD;

    const minAgeMs = 2500;
    if (Date.now() - this.appLoadTime < minAgeMs) {
      this.isRefreshing = false;
      this.resetPull();
      return;
    }

    setTimeout(() => {
      this.isRefreshing = false;
      this.refreshTimeout = setTimeout(() => {
        window.location.reload();
      }, 20);
    }, 1000);
  }
}
