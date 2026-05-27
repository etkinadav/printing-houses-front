import {
  Component,
  OnInit,
  OnDestroy,
  Inject,
  Renderer2,
  ChangeDetectorRef,
  HostListener,
  ElementRef,
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { DOCUMENT } from '@angular/common';
import { DirectionService } from '../direction.service';
import { AuthService } from '../auth/auth.service';
import { Router, NavigationEnd } from '@angular/router';
import { DialogService } from '../dialog/dialog.service';

import { UsersService } from '../user/users.service';

import { filter } from 'rxjs/operators';

import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-main-nav',
  templateUrl: './main-nav.component.html',
  styleUrls: ['./main-nav.component.scss'],
  host: {
    class: 'fill-screen',
  },
})
export class MainNavComponent implements OnInit, OnDestroy {
  isDarkMode: boolean = false;
  userIsAuthenticated = false;
  private authListenerSubs: Subscription;
  isDrawerOpen: boolean = false;
  isProManuOpen: boolean = false;
  isRTL: boolean = true;
  selectedLanguage: string = 'he';
  public selectedTheme: string = 'light';
  public isDarkTheme: boolean = false;
  private directionSubscription: Subscription;
  tooltipContentMode: string = '';
  tooltipContentLanguage: string = '';
  roles: string[] = [];
  private rolesSubscription: Subscription;
  userId: string;
  userName = '';
  private userNameSubscription: Subscription;
  greeting = '';
  user: any = {};
  private defaultProfileUrl = '../../assets/images/profile-default.svg';
  isLoggedOutLoading: boolean = false;
  isRootScreen = false;

  constructor(
    public translateService: TranslateService,
    private directionService: DirectionService,
    @Inject(DOCUMENT) private document: Document,
    private authService: AuthService,
    private router: Router,
    private render: Renderer2,
    private usersService: UsersService,
    private dialogService: DialogService,
    private cd: ChangeDetectorRef,
    private elementRef: ElementRef,
    private snackBar: MatSnackBar,
  ) {
    this.translateService.onLangChange.subscribe(() => {
      this.updateTranslation();
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const clickedInside = this.elementRef.nativeElement.contains(event.target);
    if (!clickedInside) {
      this.closeProfileManu();
    }
  }

  ngOnInit() {
    this.userIsAuthenticated = this.authService.getIsAuth();
    if (!this.userIsAuthenticated) {
      const now = new Date().getTime();
      const expiration = localStorage.getItem('expiration');
      if (expiration) {
        const expirationTime = new Date(expiration).getTime();
        if (now > expirationTime) {
          this.authService.logout();
          this.dialogService.onOpenLoginDialog();
        }
      }
    }

    this.authListenerSubs = this.authService
      .getAuthStatusListener()
      .subscribe((isAuthenticated) => {
        this.userIsAuthenticated = isAuthenticated;
        this.userId = this.authService.getUserId();
        this.updateUser();
      });

    this.authService.getAuthCompletedListener().subscribe(() => {
      // hook for post-auth-complete refresh
    });

    this.authService.userUpdated$.subscribe((user) => {
      this.user = user;
    });

    this.directionSubscription = this.directionService.direction$.subscribe(
      (direction) => {
        this.isRTL = direction === 'rtl';
      }
    );

    this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });

    this.directionService.currentLanguage$.subscribe((lang) => {
      if (lang !== this.selectedLanguage) {
        this.selectedLanguage = lang;
      }
    });

    this.rolesSubscription = this.authService.roles$.subscribe((roles) => {
      this.roles = roles ?? [];
      this.cd.detectChanges();
    });

    this.userNameSubscription = this.authService.userName$.subscribe(
      (userName) => {
        this.userName = userName;
        this.cd.detectChanges();
      }
    );

    this.updateGreeting();
    this.updateTranslation();
    setInterval(() => {
      this.updateGreeting();
    }, 60000);

    this.updateUser();

    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        // navigation hook left intentionally empty
      });

    this.checkInternetConnection();
  }

  updateUser() {
    if (localStorage.getItem('userId')) {
      this.usersService
        .getUser(localStorage.getItem('userId'))
        .subscribe((user) => {
          if (user) {
            this.user = user;
            if ((this.user as any).isDarkMode) {
              this.changeTheme('dark');
            } else {
              this.changeTheme('light');
            }
          }
        });
    }
  }

  onLogout() {
    this.isProManuOpen = false;
    this.isLoggedOutLoading = true;
    this.authService.logout().then(() => {
      this.isLoggedOutLoading = false;
      this.router.navigate(['/']);
    });
  }

  ngOnDestroy() {
    this.authListenerSubs?.unsubscribe();
    this.directionSubscription?.unsubscribe();
    this.rolesSubscription?.unsubscribe();
    this.userNameSubscription?.unsubscribe();
  }

  // Drawer
  onHamburgerClick(event: MouseEvent): void {
    this.toggleDrawer();
  }

  onHamburgerPressStart(_event: MouseEvent | TouchEvent): void {}

  onHamburgerPressEnd(_event: MouseEvent | TouchEvent): void {}

  toggleDrawer() {
    this.isDrawerOpen = !this.isDrawerOpen;
  }

  openDrawer() {
    this.isDrawerOpen = true;
  }

  closeDrawer() {
    this.isDrawerOpen = false;
  }

  // Profile Menu
  toggleProfileManu() {
    this.isProManuOpen = !this.isProManuOpen;
  }

  closeProfileManu() {
    this.isProManuOpen = false;
  }

  changeTheme(themeValue: string) {
    if (themeValue !== this.selectedTheme) {
      this.selectedTheme = themeValue;
      this.render.removeClass(this.document.body, 'lightTheme');
      this.render.removeClass(this.document.body, 'darkTheme');
      this.render.addClass(this.document.body, themeValue + 'Theme');
      if (this.isDarkTheme) {
        this.closeProfileManu();
        this.isDarkTheme = false;
        this.toggleDarkMode(false);
      } else {
        this.closeProfileManu();
        this.isDarkTheme = true;
        this.toggleDarkMode(true);
      }
    }
  }

  goToLanguage(lang: string) {
    if (lang !== this.selectedLanguage) {
      this.directionService.toLanguageDirection(lang);
      if (this.userIsAuthenticated) {
        this.usersService.updateUserLanguage(lang);
        this.closeProfileManu();
      }
    }
  }

  toggleDarkMode(isDarkMode: boolean) {
    this.directionService.setDarkMode(isDarkMode);
    this.closeProfileManu();
    if (this.userIsAuthenticated) {
      this.usersService.updateUserMode(isDarkMode);
    }
  }

  goToHome() {
    this.closeDrawer();
    this.closeProfileManu();
    const current = this.router.url.split('?')[0];
    if (current !== '/' && current !== '') {
      this.router.navigate(['/']);
    }
  }

  updateTranslation() {
    this.tooltipContentMode = this.translateService.instant('main-nav.tooltip-mode');
    this.tooltipContentLanguage = this.translateService.instant('main-nav.tooltip-language');
  }

  openLoginDialog() {
    this.closeDrawer();
    this.closeProfileManu();
    this.dialogService.onOpenLoginDialog();
  }

  goToTandC() {
    this.closeDrawer();
    this.closeProfileManu();
    this.router.navigate(['/tandc']);
  }

  goToPP() {
    this.closeDrawer();
    this.closeProfileManu();
    this.router.navigate(['/pp']);
  }

  openWhatsApp() {
    const phoneNumber = '97233746962';
    const message = encodeURIComponent('Hi, I need some help.');
    const url = `https://wa.me/${phoneNumber}?text=${message}`;
    window.open(url, '_blank');
    this.closeDrawer();
    this.closeProfileManu();
  }

  goToMyProfile() {
    this.closeDrawer();
    this.closeProfileManu();
    this.router.navigate([`/myprofile/${localStorage.getItem('userId')}`]);
  }

  goToMyProfileCreditMode() {
    this.closeDrawer();
    this.closeProfileManu();
    this.router.navigate([
      `/myprofile/${localStorage.getItem('userId')}/credit`,
    ]);
  }

  updateGreeting() {
    const currentHour = new Date().getHours();
    if (currentHour >= 6 && currentHour < 12) {
      this.greeting = 'morning';
    } else if (currentHour >= 12 && currentHour < 16) {
      this.greeting = 'noon';
    } else if (currentHour >= 16 && currentHour < 19) {
      this.greeting = 'afternoon';
    } else if (currentHour >= 19 && currentHour < 21) {
      this.greeting = 'evening';
    } else {
      this.greeting = 'night';
    }
  }

  getUserProfileImg(user: any) {
    if (
      user &&
      user.profileImageURL &&
      this.isValidImageUrl(user.profileImageURL)
    ) {
      return user.profileImageURL;
    } else {
      if (user && user.provider) {
        if (user.provider === 'facebook') {
          return user.providerData?.id
            ? 'https://graph.facebook.com/' +
            user.providerData.id +
            '/picture?type=large'
            : this.defaultProfileUrl;
        } else if (user.provider === 'google') {
          return user.providerData?.picture
            ? user.providerData.picture
            : this.defaultProfileUrl;
        } else {
          return this.defaultProfileUrl;
        }
      } else {
        return this.defaultProfileUrl;
      }
    }
  }

  isValidImageUrl(url: string): boolean {
    const img = new Image();
    if (img.src && url) {
      img.src = url;
      return img.complete && img.naturalWidth !== 0;
    } else {
      return false;
    }
  }

  isHomePage(): boolean {
    return this.router.url === '/home';
  }

  checkInternetConnection() {
    setTimeout(() => {
      if ('connection' in navigator) {
        const connection = (navigator as any).connection;
        const effectiveType = connection.effectiveType;

        if (
          effectiveType === '2g' ||
          effectiveType === 'slow-2g' ||
          effectiveType === '3g'
        ) {
          const LAST_WIFI_UPDATE_KEY = 'latWifiUpdateTime';
          const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

          const lastUpdateTimeStr = localStorage.getItem(LAST_WIFI_UPDATE_KEY);
          const now = Date.now();

          let shouldShowSnackbar = false;

          if (!lastUpdateTimeStr) {
            shouldShowSnackbar = true;
            localStorage.setItem(LAST_WIFI_UPDATE_KEY, now.toString());
          } else {
            const lastUpdateTime = parseInt(lastUpdateTimeStr, 10);
            const timeDifference = now - lastUpdateTime;
            if (timeDifference >= TWO_HOURS_MS) {
              shouldShowSnackbar = true;
              localStorage.setItem(LAST_WIFI_UPDATE_KEY, now.toString());
            }
          }

          if (shouldShowSnackbar) {
            setTimeout(() => {
              this.snackBar.open(
                this.translateService.instant(
                  'printing-table.low-internet-connection'
                ),
                '',
                {
                  duration: 2000,
                  verticalPosition: 'top',
                  panelClass: 'zx-top-snackbar',
                }
              );
            }, 100);
          }
        }
      }
    }, 4000);
  }

  isIphone(): boolean {
    return /iPhone/.test(navigator.userAgent);
  }

  // FONT SIZE
  fontSizes = [
    { label: 'גודל מינימלי', value: 'font-small' },
    { label: 'גודל בינוני', value: 'font-medium' },
    { label: 'גודל גדול', value: 'font-large' },
    { label: 'גודל ענק', value: 'font-xlarge' },
  ];

  selectedFontSize = 'font-small';

  setFontSize(size: string) {
    document.body.classList.remove('font-medium', 'font-large', 'font-xlarge');
    if (size !== 'font-small') {
      document.body.classList.add(size);
    }
    this.selectedFontSize = size;
  }
}
