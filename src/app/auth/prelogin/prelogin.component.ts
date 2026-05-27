import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { DirectionService } from '../../direction.service';
import { Subscription } from 'rxjs';
import { DialogService } from 'src/app/dialog/dialog.service';
import { Router } from '@angular/router';

import { NgForm } from "@angular/forms";
// import { FacebookLoginProvider, GoogleLoginProvider } from "@abacritt/angularx-social-login";

import { AuthService } from "../auth.service";
// import { set } from 'lodash';

@Component({
  selector: 'app-prelogin',
  templateUrl: './prelogin.component.html',
  styleUrls: ['./prelogin.component.css'],
  host: {
    class: 'fill-screen-modal'
  }
})

export class PreloginComponent implements OnInit, OnDestroy {
  isLoading: boolean = false;
  isLoadingFB: boolean = false;
  isLoadingGG: boolean = false;
  isLoadingMail: boolean = false;
  isDarkMode: boolean = false;
  isRTL: boolean = true;
  selectedLanguage: string = 'he';
  private directionSubscription: Subscription;
  loginStage: number = 0;
  private authStatusSub: Subscription;
  private emailCheckSubscription: Subscription;
  isEmailExists: string = '';
  email: string = '';

  signupHidePassword: boolean = true;
  loginHidePassword: boolean = true;
  passResetCodeHidePassword: boolean = true;
  passResetNewCode1HidePassword: boolean = true;
  passResetNewCode2HidePassword: boolean = true;

  passResetCode: string;
  isPassResetCodeSentToCheck: boolean = false;
  isPassResetCodeCorrect: boolean = false;
  newPass1: string;
  newPass2: string;
  isPassResetCodeAproved: boolean = false;
  resetToken: string = '';

  provider: string = '';
  hasPassword: boolean = false;

  /** מובייל (<992px): מקלדת פתוחה — ריווח מתחת ל"המשך"; מקלדת סגורה — ריווח מעל הכפתור */
  isMobileLoginViewport = false;
  isMobileKeyboardOpen = false;
  private maxViewportHeightPx = 0;
  private readonly keyboardShrinkThresholdPx = 120;
  /** Delay before moving spacers for "keyboard open" — avoids layout thrash that dismisses iOS keyboard */
  private readonly keyboardOpenDebounceMs = 350;
  private keyboardOpenDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly loginStageFocusDelayMs = 200;
  private loginStageFocusTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisualViewportChange = (): void => this.syncMobileKeyboardState();

  constructor(
    private directionService: DirectionService,
    private dialogService: DialogService,
    private router: Router,
    public authService: AuthService,
    private cdr: ChangeDetectorRef,
    private elementRef: ElementRef<HTMLElement>,
  ) {
    this.directionService.currentLanguage$.subscribe(lang => {
      this.selectedLanguage = lang;
    });
  };

  ngOnInit() {
    this.directionSubscription = this.directionService.direction$.subscribe(direction => {
      this.isRTL = direction === 'rtl';
    });

    this.directionService.isDarkMode$.subscribe(isDarkMode => {
      this.isDarkMode = isDarkMode;
    });

    this.authStatusSub = this.authService.getAuthStatusListener().subscribe(
      authStatus => {
        this.isLoading = false;
      }
    );

    this.updateMobileLoginViewport();
    this.initMobileKeyboardTracking();
  }

  ngOnDestroy() {
    this.clearLoginStageFocusTimer();
    this.clearKeyboardOpenDebounce();
    this.teardownMobileKeyboardTracking();
    if (this.directionSubscription) {
      this.directionSubscription.unsubscribe();
    }
    if (this.authStatusSub) {
      this.authStatusSub.unsubscribe();
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateMobileLoginViewport();
    this.syncMobileKeyboardState();
    this.cdr.markForCheck();
  }

  @HostListener('focusin', ['$event'])
  onLoginFocusIn(event: FocusEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.matches('input, textarea')) {
      return;
    }
    this.scheduleMobileKeyboardSync();
  }

  @HostListener('focusout')
  onLoginFocusOut(): void {
    this.scheduleMobileKeyboardSync(150);
  }

  /** ריווח בין שדה לכפתור "המשך" — דסקטופ תמיד; מובייל כשהמקלדת סגורה */
  get showSpacerAboveContinue(): boolean {
    return !this.isMobileLoginViewport || !this.isMobileKeyboardOpen;
  }

  /** ריווח מתחת ל"המשך" — מובייל + מקלדת פתוחה (לפי גובה viewport, לא רק פוקוס) */
  get showSpacerBelowContinue(): boolean {
    return this.isMobileLoginViewport && this.isMobileKeyboardOpen;
  }

  private updateMobileLoginViewport(): void {
    if (typeof window === 'undefined') {
      return;
    }
    this.isMobileLoginViewport = window.innerWidth < 992;
    if (!this.isMobileLoginViewport) {
      this.isMobileKeyboardOpen = false;
    }
  }

  private initMobileKeyboardTracking(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', this.onVisualViewportChange);
    }
    this.syncMobileKeyboardState();
  }

  private teardownMobileKeyboardTracking(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const vv = window.visualViewport;
    if (vv) {
      vv.removeEventListener('resize', this.onVisualViewportChange);
    }
  }

  /** iOS: מעבר שלב / סגירת מקלדת — סנכרון מחדש אחרי שה-DOM מתעדכן */
  private resetLoginKeyboardUiState(): void {
    this.clearKeyboardOpenDebounce();
    this.isMobileKeyboardOpen = false;
    this.cdr.markForCheck();
    this.scheduleMobileKeyboardSync();
    this.scheduleMobileKeyboardSync(150);
    this.scheduleMobileKeyboardSync(400);
  }

  private clearKeyboardOpenDebounce(): void {
    if (this.keyboardOpenDebounceTimer) {
      clearTimeout(this.keyboardOpenDebounceTimer);
      this.keyboardOpenDebounceTimer = null;
    }
  }

  private scheduleMobileKeyboardSync(delayMs = 0): void {
    if (delayMs <= 0) {
      queueMicrotask(() => this.syncMobileKeyboardState());
      return;
    }
    setTimeout(() => this.syncMobileKeyboardState(), delayMs);
  }

  /** זיהוי מקלדת לפי כיווץ visualViewport (אותה לוגיקה כמו shell-viewport) */
  private syncMobileKeyboardState(): void {
    if (typeof window === 'undefined' || !this.isMobileLoginViewport) {
      if (this.isMobileKeyboardOpen) {
        this.isMobileKeyboardOpen = false;
        this.cdr.markForCheck();
      }
      return;
    }

    const innerHeightPx = window.innerHeight;
    const vvHeightPx = window.visualViewport?.height ?? innerHeightPx;
    this.maxViewportHeightPx = Math.max(
      this.maxViewportHeightPx,
      innerHeightPx,
      vvHeightPx,
    );

    const threshold = this.keyboardShrinkThresholdPx;
    const innerShrunk = innerHeightPx < this.maxViewportHeightPx - threshold;
    const vvShrunk = vvHeightPx < this.maxViewportHeightPx - threshold;
    const keyboardOpen = innerShrunk || vvShrunk;
    this.applyMobileKeyboardOpenState(keyboardOpen);
  }

  /**
   * Keyboard close: apply immediately. Keyboard open: debounce so spacer flex change
   * does not run during keyboard animation (iOS/Android dismiss keyboard on reflow).
   */
  private applyMobileKeyboardOpenState(keyboardOpen: boolean): void {
    if (!keyboardOpen) {
      this.clearKeyboardOpenDebounce();
      if (this.isMobileKeyboardOpen) {
        this.isMobileKeyboardOpen = false;
        this.cdr.markForCheck();
      }
      return;
    }

    if (this.isMobileKeyboardOpen || this.keyboardOpenDebounceTimer) {
      return;
    }

    this.keyboardOpenDebounceTimer = setTimeout(() => {
      this.keyboardOpenDebounceTimer = null;
      if (!this.isMobileLoginViewport) {
        return;
      }
      const innerHeightPx = window.innerHeight;
      const vvHeightPx = window.visualViewport?.height ?? innerHeightPx;
      const threshold = this.keyboardShrinkThresholdPx;
      const innerShrunk = innerHeightPx < this.maxViewportHeightPx - threshold;
      const vvShrunk = vvHeightPx < this.maxViewportHeightPx - threshold;
      if (!innerShrunk && !vvShrunk) {
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (!active?.matches('input, textarea')) {
        return;
      }
      this.isMobileKeyboardOpen = true;
      this.cdr.markForCheck();
    }, this.keyboardOpenDebounceMs);
  }

  closeLoginDialog() {
    this.dialogService.onCloseLoginDialog();
  }

  goToTandC() {
    this.router.navigate(["/tandc"]);
    this.closeLoginDialog();
  }
  goToPP() {
    this.router.navigate(["/pp"]);
    this.closeLoginDialog();
  }

  onEnterMail(form: NgForm) {
    if (form.invalid || this.isLoading) {
      return;
    }
    this.isLoading = true;
    this.resetLoginKeyboardUiState();
    this.email = form.value.email;
    this.emailCheckSubscription = this.authService.checkEmail(form.value.email)
      .subscribe(
        (response: any) => {
          this.isEmailExists = response.exists;
          this.isLoading = false;
          if (this.isEmailExists) {
            this.provider = response.provider;
            // console.log("PROVIDER", this.provider);
            this.hasPassword = response.hasPassword;
            if (this.provider === 'local' || this.hasPassword) {
              // console.log("Local login");
              this.loginStage = 2;
              this.resetLoginKeyboardUiState();
              this.scheduleLoginStageFocus(2);
            } else if (this.provider === 'facebook') {
              // console.log("Facebook login");
              this.signInWithFB();
              this.closeLoginDialog();
            } else if (this.provider === 'google') {
              // console.log("Google login");
              this.signInWithGoogle();
              this.closeLoginDialog();
            } else {
              // console.log("Other login");
              this.closeLoginDialog();
            }
          } else {
            this.loginStage = 3;
            this.resetLoginKeyboardUiState();
            this.scheduleLoginStageFocus(3);
          }
        },
        (error) => {
          console.log("Error checking email:", error);
        }
      );
  }

  signInWithFB(): void {
    // this.authService.socialService.signIn(FacebookLoginProvider.PROVIDER_ID);
    this.isLoading = true;
    this.isLoadingFB = true;
    this.authService.facebookLogin()
  }

  signInWithGoogle(): void {
    this.isLoading = true;
    this.isLoadingGG = true;
    this.authService.googleLogin()
  }

  onLoginMail(form: NgForm) {
    if (form.invalid || this.isLoading) {
      return;
    }
    this.isLoading = true;
    this.isLoadingMail = true;
    this.authService.login(this.email, form.value.password, 'local');
    // isLoading will be set to false by authStatusSub subscription in ngOnInit
  }

  onSignupMail(form: NgForm) {
    if (form.invalid || this.isLoading) {
      return;
    }
    this.isLoading = true;
    this.authService.createUser(this.email, form.value.password, 'local');
    // isLoading will be set to false by authStatusSub subscription in ngOnInit
  }

  async toLoginStage(stage: number) {
    if (this.loginStage !== stage) {
      this.loginStage = stage;
      this.resetLoginKeyboardUiState();
      if (stage === 1 || stage === 2 || stage === 3) {
        this.scheduleLoginStageFocus(stage);
      }
      if (stage === 4) {
        await this.sendForgotPasswordEmail(this.email);
      }
    }
  }

  /** פוקוס אוטומטי על שדה מייל/סיסמה אחרי שהשלב נטען (200ms). */
  private scheduleLoginStageFocus(stage: number): void {
    this.clearLoginStageFocusTimer();
    this.loginStageFocusTimer = setTimeout(() => {
      this.loginStageFocusTimer = null;
      this.cdr.detectChanges();
      this.focusLoginStageInput(stage);
    }, this.loginStageFocusDelayMs);
  }

  private clearLoginStageFocusTimer(): void {
    if (this.loginStageFocusTimer) {
      clearTimeout(this.loginStageFocusTimer);
      this.loginStageFocusTimer = null;
    }
  }

  private focusLoginStageInput(stage: number): void {
    const root = this.elementRef.nativeElement;
    const selector = stage === 1 ? 'input[name="email"]' : 'input[name="password"]';
    const input = root.querySelector<HTMLInputElement>(selector);
    if (!input) {
      return;
    }
    input.focus({ preventScroll: false });
  }

  // toggle password view (EYE ICON)
  // login
  toggleLoginPasswordVisibility() {
    this.loginHidePassword = !this.loginHidePassword;
  }
  // Signup
  toggleSignupPasswordVisibility() {
    this.signupHidePassword = !this.signupHidePassword;
  }
  // PassResetCode
  togglePassResetCodeVisibility() {
    this.passResetCodeHidePassword = !this.passResetCodeHidePassword;
  }
  // pass01
  togglePassResetNewCode1Visibility() {
    this.passResetNewCode1HidePassword = !this.passResetNewCode1HidePassword;
  }
  // pass02
  togglePassResetNewCode2Visibility() {
    this.passResetNewCode2HidePassword = !this.passResetNewCode2HidePassword;
  }

  isIphone(): boolean {
    return /iPhone/.test(navigator.userAgent);
  }

  // password reset
  async sendForgotPasswordEmail(email: string) {
    this.isLoading = true;
    try {
      const response = await this.authService.onSendForgotPasswordEmail(email);
      if (response.message === 'WE_HAVE_SENT_YOU_INSTRUCTIONS_EMAIL') {
        this.isPassResetCodeSentToCheck = true;
      } else {
        this.isPassResetCodeSentToCheck = false;
        this.toLoginStage(1);
      }
      this.isLoading = false;
    } catch (error) {
      console.log("error: ", error);
      this.isPassResetCodeSentToCheck = false;
      this.toLoginStage(1);
      this.isLoading = false;
    }
  }

  async submitPassResetCode(passResetCode: string) {
    if (this.isLoading) {
      return;
    }
    this.isLoading = true;
    try {
      const response = await this.authService.onSubmitPassResetCode(this.email, passResetCode);
      if (response.message === 'RESET_PASSWORD_CODE_MATCH' && response.token) {
        this.isPassResetCodeSentToCheck = false;
        this.isPassResetCodeCorrect = true;
        this.resetToken = response.token;
      } else {
        this.isPassResetCodeSentToCheck = false;
        this.isPassResetCodeCorrect = false;
        this.toLoginStage(1);
      }
      this.isLoading = false;
    } catch (error) {
      console.log("error: ", error);
      this.isPassResetCodeSentToCheck = false;
      this.isPassResetCodeCorrect = false;
      this.toLoginStage(1);
      this.isLoading = false;
    }
  }

  async resetPassword(newPass1: string, newPass2: string) {
    if (this.isLoading) {
      return;
    }
    this.isLoading = true;
    try {
      if (newPass1 !== newPass2) {
        this.isLoading = false;
        return;
      }
      const response = await this.authService.onResetPassword(this.email, this.resetToken, newPass1);
      if (response.message === 'PASSWORD_RESET_SUCCESS') {
        this.isPassResetCodeCorrect = true;
        this.isPassResetCodeAproved = true;
        this.resetToken = '';
        this.isLoading = false;
        setTimeout(() => {
          this.isPassResetCodeAproved = false;
          this.isPassResetCodeSentToCheck = false;
          this.loginStage = 2;
        }, 2000);
      } else {
        this.isPassResetCodeCorrect = true;
      }
      this.isLoading = false;
    } catch (error) {
      console.log("error: ", error);
      this.isPassResetCodeCorrect = true;
      this.isLoading = false;
    }
  }

  // ==============
}
