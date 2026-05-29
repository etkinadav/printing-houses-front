import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { DirectionService } from '../../direction.service';
import { PhCategoriesService } from '../../ph-categories/ph-categories.service';
import { PhCategory, PhSubCategory } from '../../ph-categories/ph-category.model';
import { PhProductsService } from '../../ph-products/ph-products.service';

@Component({
  selector: 'app-product-create',
  templateUrl: './product-create.component.html',
  styleUrls: ['./product-create.component.css'],
  host: {
    class: 'fill-screen',
  },
})
export class ProductCreateComponent implements OnInit, OnDestroy {
  isRTL = true;
  isDarkMode = false;
  isLoading = true;
  isSaving = false;
  categories: PhCategory[] = [];
  subCategories: PhSubCategory[] = [];

  form = new FormGroup({
    name_he: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(1), Validators.maxLength(120)],
    }),
    name_en: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(1), Validators.maxLength(120)],
    }),
    category: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    subCategory: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private categorySub?: Subscription;

  constructor(
    private phCategoriesService: PhCategoriesService,
    private phProductsService: PhProductsService,
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

    this.categorySub = this.form.controls.category.valueChanges.subscribe((categoryId) => {
      this.onCategoryChange(categoryId);
    });

    this.phCategoriesService.getAllCategories().subscribe({
      next: (response) => {
        this.categories = response.categories ?? [];
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      },
    });
  }

  ngOnDestroy(): void {
    this.directionSub?.unsubscribe();
    this.darkModeSub?.unsubscribe();
    this.categorySub?.unsubscribe();
  }

  getCategoryLabel(category: PhCategory): string {
    const lang = this.translateService.currentLang || 'he';
    return lang === 'en' ? category.label_en : category.label_he;
  }

  getSubCategoryLabel(sub: PhSubCategory): string {
    const lang = this.translateService.currentLang || 'he';
    return lang === 'en' ? sub.label.en : sub.label.he;
  }

  onSave(): void {
    if (this.form.invalid || this.isSaving) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSaving = true;
    const value = this.form.getRawValue();

    this.phProductsService
      .createProduct({
        name_he: value.name_he.trim(),
        name_en: value.name_en.trim(),
        category: value.category,
        subCategory: value.subCategory,
      })
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.form.reset({
            name_he: '',
            name_en: '',
            category: '',
            subCategory: '',
          });
          this.subCategories = [];
          this.snackBar.open(
            this.translateService.instant('management.product-create.saved'),
            undefined,
            { duration: 3000 },
          );
        },
        error: () => {
          this.isSaving = false;
        },
      });
  }

  private onCategoryChange(categoryId: string): void {
    this.form.controls.subCategory.setValue('');
    this.subCategories = [];

    if (!categoryId) {
      return;
    }

    const category = this.categories.find((c) => c._id === categoryId);
    this.subCategories = category?.subCategories ?? [];
  }
}
