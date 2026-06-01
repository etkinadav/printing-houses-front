import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { DirectionService } from '../direction.service';

@Component({
  selector: 'app-printing-house-join',
  templateUrl: './printing-house-join.component.html',
  styleUrls: ['./printing-house-join.component.css'],
  host: {
    class: 'fill-screen',
  },
})
export class PrintingHouseJoinComponent implements OnInit, OnDestroy {
  isRTL = true;
  isDarkMode = false;

  private readonly imageUrlPattern = /^https?:\/\/.+/i;

  form = new FormGroup({
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    logoUrl: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(500), Validators.pattern(this.imageUrlPattern)],
    }),
    city: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    street: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    houseNumber: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(20)],
    }),
    apartment: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(20)],
    }),
    floor: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(20)],
    }),
    postalCode: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(20)],
    }),
    notes: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
  });

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;

  constructor(
    private directionService: DirectionService,
    private translateService: TranslateService,
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.directionSub = this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
    });
    this.darkModeSub = this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });
  }

  ngOnDestroy(): void {
    this.directionSub?.unsubscribe();
    this.darkModeSub?.unsubscribe();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.snackBar.open(
      this.translateService.instant('printing-house-join.submitted'),
      undefined,
      { duration: 3000 },
    );
  }
}
