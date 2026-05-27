import {
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  Directive,
  HostListener,
  ViewChild,
} from '@angular/core';

import { Subscription } from 'rxjs';
import { DirectionService } from '../direction.service';

import { AuthService } from 'src/app/auth/auth.service';
import { UsersService } from 'src/app/user/users.service';

import { Router, ActivatedRoute } from '@angular/router';
import { DialogService } from 'src/app/dialog/dialog.service';

import { FormGroup, FormControl, Validators } from '@angular/forms';
import { AbstractControl } from '@angular/forms';

import { DateAdapter } from '@angular/material/core';
import { Direction } from '@angular/cdk/bidi';
import { MatTooltip } from '@angular/material/tooltip';

import { CreditFormService } from './credit-form-service';

import lottie from 'lottie-web';

import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { normalizeCardExpiryTwoDigits } from './card-expiry-two-digits';

@Directive({
  selector: '[appPhoneFormat]',
})
export class PhoneFormatDirective {
  constructor(private el: ElementRef) { }

  @HostListener('input', ['$event']) onInputChange(event) {
    const initialValue = this.el.nativeElement.value;

    this.el.nativeElement.value = initialValue
      .replace(/[^0-9]/g, '')
      .replace(/(\d{2})(\d{4})(\d{3})/, '0$1-$2-$3');

    if (initialValue !== this.el.nativeElement.value) {
      event.stopPropagation();
    }
  }
}

@Component({
  selector: 'app-order-list',
  templateUrl: './my-profile.component.html',
  styleUrls: ['./my-profile.component.css'],
  host: {
    class: 'fill-screen',
  },
})
export class MyProfileComponent implements OnInit, OnDestroy {
  isRTL: boolean = true;
  private directionSubscription: Subscription;
  isDarkMode: boolean = false;
  isLoading = false;
  isLoadingUpdates = false;

  userId: string;
  userIsAuthenticated = false;
  private authStatusSub: Subscription;

  user: any = {};
  form: FormGroup;
  creditForm = this.creditFormService.createForm(null);
  /** Always 0 – the original app shows pending orders here; this build doesn't track orders. */
  numOfPendingOrders: number = 0;
  private authListenerSubs: Subscription;
  private defaultProfileUrl = '../../assets/images/profile-default.svg';

  isCreditEditMode: boolean = false;
  isCompanyID: boolean = false;
  tooltipDirection: Direction = 'ltr';
  @ViewChild(MatTooltip) tooltip: MatTooltip;

  @ViewChild('monthInput') monthInput;
  @ViewChild('yearInput') yearInput;

  animation: any;

  isLottieStart: boolean = false;
  isLottieMiddle: boolean = false;
  isLottieEnd: boolean = false;

  isCreditCardFieldsEmphasized: boolean = false;

  phoneFieldShouldShowError: boolean = false;

  constructor(
    private authService: AuthService,
    private directionService: DirectionService,
    private usersService: UsersService,
    private router: Router,
    private dialogService: DialogService,
    private route: ActivatedRoute,
    private dateAdapter: DateAdapter<Date>,
    private creditFormService: CreditFormService,
    private _snackBar: MatSnackBar,
    private translate: TranslateService,
  ) { }

  ngOnInit() {
    this.isLoading = true;

    this.directionSubscription = this.directionService.direction$.subscribe(
      (direction) => {
        this.isRTL = direction === 'rtl';
        this.tooltipDirection = this.isRTL ? 'rtl' : 'ltr';
      }
    );

    this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });

    this.route.url.subscribe((urlSegments) => {
      this.isCreditEditMode = urlSegments.some(
        (segment) => segment.path === 'credit'
      );
    });

    this.userIsAuthenticated = this.authService.getIsAuth();
    this.authListenerSubs = this.authService
      .getAuthStatusListener()
      .subscribe((isAuthenticated) => {
        this.userIsAuthenticated = isAuthenticated;
        this.userId = this.authService.getUserId();
      });

    this.authService.getAuthCompletedListener().subscribe(() => {
      // hook for any post-auth-complete refresh
    });

    this.userIsAuthenticated = this.authService.getIsAuth();
    this.authStatusSub = this.authService
      .getAuthStatusListener()
      .subscribe((isAuthenticated) => {
        this.userIsAuthenticated = isAuthenticated;
        this.userId = this.authService.getUserId();
      });

    this.form = new FormGroup({
      displayName: new FormControl(null, [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(40),
      ]),
      email: new FormControl(null, [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(40),
      ]),
      phone: new FormControl(this.formatPhoneNumber(this.user.phone), {
        validators: [Validators.required, Validators.pattern(/^0\d{2}-\d{7}$/)],
      }),
    });

    this.usersService
      .getUser(localStorage.getItem('userId'))
      .subscribe((user) => {
        if (user) {
          this.user = user;
          this.form = new FormGroup({
            displayName: new FormControl(this.user.displayName, [
              Validators.required,
              Validators.minLength(3),
              Validators.maxLength(40),
            ]),
            email: new FormControl(this.user.email, [
              Validators.required,
              Validators.minLength(3),
              Validators.maxLength(40),
            ]),
            phone: new FormControl(this.formatPhoneNumber(this.user.phone), {
              validators: [Validators.required, this.phoneValidator],
            }),
          });
          this.form.get('phone').markAsPristine();
          this.form.get('phone').markAsUntouched();
          this.creditForm = this.creditFormService.createForm(this.user);
          if (this.user.zCreditInfo && this.user.zCreditInfo.customerID) {
            this.isCompanyID = true;
          }
        } else {
          this.user = {};
          this.form = new FormGroup({
            displayName: new FormControl(null, [
              Validators.required,
              Validators.minLength(3),
            ]),
            email: new FormControl(null, [
              Validators.required,
              Validators.minLength(3),
            ]),
            phone: new FormControl(null, {
              validators: [Validators.required, this.phoneValidator],
            }),
          });
          this.creditForm = this.creditFormService.createForm(null);
        }
        this.isLoading = false;
      });

    this.usersService.phoneUpdated.subscribe((phone: number) => {
      this.user.phone = Number(phone);
      this.form.get('phone').setValue(this.formatPhoneNumber(this.user.phone));
    });
  }

  onPhoneBlur() {
    if (this.form.get('phone').invalid) {
      this.phoneFieldShouldShowError = true;
    }
  }

  formatPhoneNumber(phoneNumber: number): string {
    if (!phoneNumber) {
      return '';
    }
    const str = '0' + phoneNumber.toString();
    return str.slice(0, 3) + '-' + str.slice(3, 7) + '-' + str.slice(7);
  }

  phoneValidator(control: AbstractControl): { [key: string]: any } | null {
    const valid =
      control.value &&
      typeof control.value === 'string' &&
      control.value.replace(/\D/g, '').length === 10;
    return valid
      ? null
      : { invalidPhone: { valid: false, value: control.value } };
  }

  comperePhoneNumbers(usersPhone: any, editedPhone: any) {
    if (typeof editedPhone !== 'string' || !usersPhone || !editedPhone) {
      return true;
    }
    const normalizedUsersPhone = usersPhone.toString();
    const normalizedEditedPhone = editedPhone
      .replace(/-/g, '')
      .replace(/^0+/, '');
    if (normalizedUsersPhone === normalizedEditedPhone) {
      return false;
    }
    return true;
  }

  ngOnDestroy() {
    this.authStatusSub?.unsubscribe();
    this.directionSubscription?.unsubscribe();
    this.authListenerSubs?.unsubscribe();
  }

  getUserName() {
    return localStorage.getItem('userName');
  }

  getUserId() {
    return localStorage.getItem('userId');
  }

  openWhatsApp() {
    const phoneNumber = '97233746962';
    const message = encodeURIComponent('Hi, I need some help.');
    const url = `https://wa.me/${phoneNumber}?text=${message}`;
    window.open(url, '_blank');
  }

  /** No printing flow in this build – navigate to home. */
  goToNewOrder() {
    this.router.navigate(['/']);
  }

  /** No orders page in this build – navigate to home. */
  goToMyOrders() {
    this.router.navigate(['/']);
  }

  /** No Q&A page in this build – navigate to home. */
  goToQAndA() {
    this.router.navigate(['/']);
  }

  getDisplayName() {
    if (this.user?.displayName && this.user?.displayName.length > 0) {
      return this.user.displayName;
    } else if (this.user?.email && this.user?.email.length > 0) {
      return this.user.email;
    } else {
      return null;
    }
  }

  getUserProfileImg() {
    if (
      this.user &&
      this.user.profileImageURL &&
      this.isValidImageUrl(this.user.profileImageURL)
    ) {
      return this.user.profileImageURL;
    } else {
      if (this.user && this.user.provider) {
        if (this.user.provider === 'facebook') {
          return this.user.providerData?.id
            ? 'https://graph.facebook.com/' +
              this.user.providerData.id +
              '/picture?type=large'
            : this.defaultProfileUrl;
        } else if (this.user.provider === 'google') {
          return this.user.providerData?.picture
            ? this.user.providerData.picture
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

  onScrollContainerScroll(event: Event) {
    const target = event.target as HTMLElement;
    const scrollPosition = target.scrollTop;

    const upperElement = document.getElementById('upperElement');
    if (!upperElement) return;
    if (scrollPosition <= 40) {
      upperElement.style.opacity = '100%';
    } else if (scrollPosition > 40 && scrollPosition <= 53) {
      upperElement.style.opacity =
        100 - (scrollPosition / 53) * 100 + '%';
    } else {
      upperElement.style.opacity = '0%';
    }
  }

  logOut() {
    this.authService.logout();
  }

  toggleField(field: string, isClose: boolean = false) {
    const fieldElement = document.getElementsByClassName(
      'profileField-' + field
    )[0] as HTMLElement;
    const itemElement = document.getElementsByClassName(
      'profileItem-' + field
    )[0] as HTMLElement;

    if (!fieldElement || !itemElement) {
      console.warn(`Elements not found for field: ${field}`);
      return;
    }

    if (isClose) {
      fieldElement.classList.add('d-none');
      fieldElement.classList.remove('d-flex');
      itemElement.classList.remove('d-none');
      itemElement.classList.add('d-flex');
      return;
    }
    fieldElement.classList.toggle('d-none');
    fieldElement.classList.toggle('d-flex');
    itemElement.classList.toggle('d-none');
    itemElement.classList.toggle('d-flex');

    if (this.user && this.user[field]) {
      if (field === 'phone') {
        this.form.get(field).setValue(this.formatPhoneNumber(this.user[field]));
        this.phoneFieldShouldShowError = false;
      } else {
        this.form.get(field).setValue(this.user[field]);
      }
    } else {
      this.form.get(field).reset();
      if (field === 'phone') {
        this.phoneFieldShouldShowError = false;
      }
    }
  }

  onSaveUser() {
    if (this.form.get('phone').invalid) {
      this.phoneFieldShouldShowError = true;
    }
    if (
      (!this.user.phone || this.user.phone === '0-') &&
      !this.form.value.phone
    ) {
      this.dialogService.onOpenPhoneDialog();
    }
    if (this.form.invalid) {
      return;
    }
    this.isLoadingUpdates = true;
    this.usersService
      .updateUserProfile(
        this.getUserId(),
        this.form.value.displayName,
        this.form.value.email,
        this.form.value.phone
      )
      .subscribe({
        next: (response: any) => {
          if (response.message === 'Update successful!') {
            this.user = response.user;
            this.form.patchValue({
              displayName: this.user.displayName,
              email: this.user.email,
              phone: this.formatPhoneNumber(this.user.phone),
            });
            setTimeout(() => {
              this.toggleField('displayName', true);
              this.toggleField('email', true);
              this.toggleField('phone', true);
            }, 0);
            this.isLoadingUpdates = false;
          }
        },
        error: (error) => {
          console.error('Error updating user profile:', error);
          this.isLoadingUpdates = false;
        },
      });
  }

  toCreditEditMode() {
    this.isCreditEditMode = true;
    this.router.navigate([
      `/myprofile/${localStorage.getItem('userId')}/credit`,
    ]);
  }

  toProfileMode() {
    this.isCreditEditMode = false;
    this.router.navigate([`/myprofile/${localStorage.getItem('userId')}`]);
  }

  onLogout() {
    this.authService.logout();
  }

  getCCLastDigits(cc: string): string {
    if (!cc) {
      return '';
    }
    const ccStr = cc.toString();
    if (ccStr.length >= 4) {
      return ccStr;
    } else {
      return ccStr.padStart(4, '0');
    }
  }

  clearCreditField(field: string) {
    this.creditForm.get(field).setValue(this.user[field]);
  }

  onSaveCreditCard() {
    if (
      this.creditForm.get('cardNum').invalid ||
      this.creditForm.get('month').invalid ||
      this.creditForm.get('year').invalid ||
      this.creditForm.get('cardCvv').invalid ||
      this.creditForm.get('cardHolderName').invalid ||
      this.creditForm.get('cardHolderID').invalid
    ) {
      return;
    }
    let cc = {
      exp_m: normalizeCardExpiryTwoDigits(this.creditForm.value.month),
      exp_y: normalizeCardExpiryTwoDigits(this.creditForm.value.year),
      num: this.creditForm.value.cardNum.replace(/-/g, ''),
      cvv: this.creditForm.value.cardCvv,
      id: this.creditForm.value.cardHolderID,
      name: this.creditForm.value.cardHolderName,
      customerName:
        this.creditForm.value.cardCustomerName &&
          this.creditForm.value.cardCustomerName !== ''
          ? this.creditForm.value.cardCustomerName
          : this.user.username,
      customerEmail:
        this.creditForm.value.billingEmail &&
          this.creditForm.value.billingEmail !== ''
          ? this.creditForm.value.billingEmail
          : this.user.email,
      customerBusinessID:
        this.isCompanyID &&
          this.creditForm.value.cardCompanyID &&
          this.creditForm.value.cardCompanyID !== ''
          ? this.creditForm.value.cardCompanyID
          : null,
    };

    this.usersService
      .updateUserCC(localStorage.getItem('userId'), cc)
      .subscribe((response: any) => {
        if (
          response.user?.zCreditInfo?.token &&
          response.user.zCreditInfo.token !== '' &&
          response.user?.zCreditInfo?.cardNum &&
          response.user.zCreditInfo.cardNum !== '' &&
          response.user?.zCreditInfo?.cardExp &&
          response.user.zCreditInfo.cardExp !== '' &&
          response.user?.zCreditInfo?.cvv &&
          response.user.zCreditInfo.cvv !== ''
        ) {
          this.user.zCreditInfo = response.user.zCreditInfo;
          this.creditForm = this.creditFormService.createForm(this.user);
          this.scrollToTop();
          setTimeout(() => {
            this.playAnimation();
            setTimeout(() => {
              this.isLoading = false;
            }, 1600);
          }, 100);
        }
      });
  }

  scrollToTop() {
    const dialogElement = document.querySelector('.zx-credit-con');
    if (dialogElement) {
      dialogElement.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  ngAfterViewInit() {
    this.animation = lottie.loadAnimation({
      container: document.getElementById('animationContainer'),
      renderer: 'svg',
      loop: false,
      autoplay: false,
      path: 'assets/videos/successfully.json',
    });

    this.animation.setSpeed(2.6);
  }

  playAnimation() {
    if (this.animation) {
      this.animation.play();
    }
    this.isLottieStart = false;
    this.isLottieEnd = false;
    this.isLottieMiddle = false;
    setTimeout(() => {
      this.isLottieStart = true;
      setTimeout(() => {
        this.isLottieMiddle = true;
        setTimeout(() => {
          this.isLottieEnd = true;
          this.animation.stop();
          this.isLottieStart = false;
          this.isLottieMiddle = false;
        }, 400);
      }, 1500);
    }, 0);
  }

  numberOnly(event): boolean {
    const charCode = event.which ? event.which : event.keyCode;
    if (charCode > 31 && (charCode < 48 || charCode > 57)) {
      return false;
    }
    return true;
  }

  formatCardNumInput(event): void {
    let input = event.target.value.replace(/\D/g, '');
    if (input.length > 16) {
      input = input.slice(0, 16);
    }
    input = input.replace(/(.{4})/g, '$1-');
    if (input.endsWith('-')) {
      input = input.slice(0, -1);
    }
    this.creditForm.get('cardNum').setValue(input, { emitEvent: false });
  }

  focusMonthIfEmpty() {
    if (
      !this.creditForm.get('month').value ||
      this.creditForm.get('month').value === ''
    ) {
      this.creditForm.get('month').setValue(null);
      this.monthInput.nativeElement.focus();
    }
  }

  creditCardValidator(control: FormControl): { [s: string]: boolean } | null {
    if (!control.value) {
      return null;
    }
    const pattern = /^\d{4}-\d{4}-\d{4}-\d{4}$/;
    if (!control.value.match(pattern)) {
      return { invalidCreditCard: true };
    }
    return null;
  }

  toggleCompanyID() {
    this.isCompanyID = !this.isCompanyID;
  }

  onDeleteCreditCard() {
    this.usersService
      .deleteUserCC(localStorage.getItem('userId'), this.user.zCreditInfo)
      .subscribe((response: any) => {
        if (
          response.message === 'Credit card information deleted successfully'
        ) {
          this.user.zCreditInfo = null;
          this.creditForm = this.creditFormService.createForm(this.user);
          this.scrollToTop();
          setTimeout(() => {
            this.playAnimation();
            setTimeout(() => {
              this.isLoading = false;
            }, 1600);
          }, 100);
        }
      });
  }

  toggleTooltip() {
    if (this.tooltip._isTooltipVisible()) {
      this.tooltip.hide();
    } else {
      this.tooltip.show();
    }
  }

  emphasizeCreditCardFields() {
    if (
      this.creditForm.get('cardNum').valid &&
      this.creditForm.get('month').valid &&
      this.creditForm.get('year').valid &&
      this.creditForm.get('cardCvv').valid &&
      this.creditForm.get('cardHolderName').valid &&
      this.creditForm.get('cardHolderID').valid
    ) {
      this.isCreditCardFieldsEmphasized = false;
      return;
    }
    this.isCreditCardFieldsEmphasized = true;
  }

  /** No delete-user dialog in this build; safe stub. */
  deleteUser() {
    this.dialogService.onOpenDeleteUserDialog(this.user, false);
  }

  emailCannotBeEdited() {
    const text = this.translate.instant('my-profile.email-cannot-be-edited');
    this._snackBar.open(text, 'X', {
      duration: 3000,
    });
  }
}
