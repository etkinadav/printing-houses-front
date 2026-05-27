import { Component, OnInit, OnDestroy, ElementRef, Directive, HostListener } from '@angular/core';
import { Subscription } from 'rxjs';

import { DirectionService } from '../../direction.service';
import { AuthService } from 'src/app/auth/auth.service';
import { DialogService } from 'src/app/dialog/dialog.service';

import { FormGroup, FormControl, Validators, AbstractControl } from "@angular/forms";
import { UsersService } from 'src/app/user/users.service';

@Directive({
  selector: '[appPhoneFormatDialog]'
})

export class PhoneFormatDialogDirective {
  constructor(private el: ElementRef) { }

  @HostListener('input', ['$event']) onInputChange(event) {
    const initialValue = this.el.nativeElement.value;

    this.el.nativeElement.value = initialValue.replace(/[^0-9]/g, '')
      .replace(/(\d{2})(\d{4})(\d{3})/, '0$1-$2-$3');

    if (initialValue !== this.el.nativeElement.value) {
      event.stopPropagation();
    }
  }
}

@Component({
  selector: 'app-phone',
  templateUrl: './phone.component.html',
  styleUrls: ['./phone.component.css'],
  host: {
    class: 'fill-screen-modal-phone'
  }
})
export class PhoneComponent implements OnInit, OnDestroy {
  isRTL: boolean = true;
  private directionSubscription: Subscription;
  isDarkMode: boolean = false;
  isLoading: boolean = false;
  isLoadingUpdates = false;

  userId: string;
  userIsAuthenticated = false;
  private authStatusSub: Subscription;
  form: FormGroup;

  phone: number = null;
  isPhoneSet: boolean = false;

  constructor(
    private directionService: DirectionService,
    private authService: AuthService,
    private dialogService: DialogService,
    private usersService: UsersService,
  ) { }

  async ngOnInit() {
    this.isLoading = true;
    this.directionSubscription = this.directionService.direction$.subscribe(direction => {
      this.isRTL = direction === 'rtl';
    });

    this.directionService.isDarkMode$.subscribe(isDarkMode => {
      this.isDarkMode = isDarkMode;
    });

    this.userId = this.authService.getUserId();
    this.userIsAuthenticated = this.authService.getIsAuth();
    this.authStatusSub = this.authService
      .getAuthStatusListener()
      .subscribe(isAuthenticated => {
        this.userIsAuthenticated = isAuthenticated;
        this.userId = this.authService.getUserId();
      });

    this.form = new FormGroup({
      phone: new FormControl(null, {
        validators: [Validators.required, this.phoneValidator]
      })
    });

    this.form.get('phone').markAsPristine();
    this.form.get('phone').markAsUntouched();

    this.isLoading = false;
  }

  closePhoneDialog() {
    this.dialogService.onClosePhoneDialog();
  }

  // PHONE
  // format phone
  formatPhoneNumber(phoneNumber: number): string {
    if (!phoneNumber) {
      return '';
    }
    const str = '0' + phoneNumber.toString();
    return str.slice(0, 3) + '-' + str.slice(3, 7) + '-' + str.slice(7);
  }
  // validate phone
  phoneValidator(control: AbstractControl): { [key: string]: any } | null {
    const valid = control.value && typeof control.value === 'string' && control.value.replace(/\D/g, '').length === 10;
    return valid ? null : { invalidPhone: { valid: false, value: control.value } };
  }

  // compere phone
  comperePhoneNumbers(usersPhone: any, editedPhone: any) {
    if (typeof editedPhone !== 'string' || !usersPhone || !editedPhone) {
      return true;
    }
    const normalizedUsersPhone = usersPhone.toString();
    const normalizedEditedPhone = editedPhone.replace(/-/g, '').replace(/^0+/, '');
    if (normalizedUsersPhone === normalizedEditedPhone) {
      return false;
    }
    return true;
  }

  ngOnDestroy() {
    if (this.directionSubscription) {
      this.directionSubscription.unsubscribe();
    }
    if (this.authStatusSub) {
      this.authStatusSub.unsubscribe();
    }
  }

  // save user profile fields
  onSaveUserPhone() {
    if (this.form.invalid) {
      return;
    }
    this.isLoadingUpdates = true;
    this.usersService.updateUserPhone(
      this.userId,
      this.form.value.phone,
    ).subscribe((response: any) => {
      if (response.message === 'Update User Phone successful!') {
        // Update the user and form data here
        this.phone = response.user.phone;
        // console.log('user from update User Phone!!!', this.phone);
        this.form.patchValue({
          phone: this.formatPhoneNumber(this.phone)
        });
        this.isLoadingUpdates = false;
        this.isPhoneSet = true;
        setTimeout(() => {
          this.dialogService.onClosePhoneDialog();
        }, 850);
        this.usersService.updatePhone(this.phone);
      }
    });
  }

  clearPhoneField() {
    this.form.patchValue({
      phone: ''
    });
  }
  // ===============
}
