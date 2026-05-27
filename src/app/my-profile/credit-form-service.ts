import { Injectable } from '@angular/core';
import { FormGroup, FormControl, Validators } from '@angular/forms';

@Injectable({
    providedIn: 'root'
})
export class CreditFormService {
    createForm(user: any): FormGroup {
        return new FormGroup({
            cardNum: new FormControl(null, [Validators.required, this.creditCardValidator]),
            month: new FormControl(null, [Validators.required]),
            year: new FormControl(null, [Validators.required]),
            cardCvv: new FormControl(null, [Validators.required, Validators.minLength(3), Validators.maxLength(4)]),
            cardHolderName: new FormControl(null, [Validators.required, Validators.minLength(3), Validators.maxLength(40)]),
            cardHolderID: new FormControl(null, [Validators.required, Validators.minLength(7), Validators.maxLength(20)]),
            billingEmail: new FormControl(user && user.zCreditInfo && user.zCreditInfo.customerEmail ? user.zCreditInfo.customerEmail : user && user.email, [Validators.minLength(3), Validators.maxLength(40)]),
            cardCustomerName: new FormControl(user && user.zCreditInfo && user.zCreditInfo.customerName ? user.zCreditInfo.customerName : user && user.displayName, [Validators.minLength(3), Validators.maxLength(40)]),
            cardCompanyID: new FormControl(user && user.zCreditInfo && user.zCreditInfo.customerBusinessID ? user.zCreditInfo.customerBusinessID : null, [Validators.minLength(3), Validators.maxLength(12)]),
        });
    }

    creditCardValidator(control: FormControl): { [s: string]: boolean } | null {
        if (!control.value) {
            return null;
        }

        // הסר מקפים ורווחים
        const cleanValue = control.value.replace(/[-\s]/g, '');

        // בדוק אורך (13-19 ספרות)
        if (!/^\d{13,19}$/.test(cleanValue)) {
            return { 'invalidCreditCard': true };
        }

        // American Express: 15 ספרות, מתחיל ב-34 או 37
        const amexPattern = /^3[47]\d{13}$/;

        // Visa: 16 ספרות, מתחיל ב-4
        const visaPattern = /^4\d{15}$/;

        // MasterCard: 16 ספרות, מתחיל ב-5
        const mastercardPattern = /^5[1-5]\d{14}$/;

        if (amexPattern.test(cleanValue) || visaPattern.test(cleanValue) || mastercardPattern.test(cleanValue)) {
            return null;
        }

        return { 'invalidCreditCard': true };
    }
}
