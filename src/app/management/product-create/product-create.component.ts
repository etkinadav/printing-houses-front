import { Component, OnDestroy, OnInit } from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  Validators,
} from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { merge, Subscription } from 'rxjs';

import { DirectionService } from '../../direction.service';
import { PhCategoriesService } from '../../ph-categories/ph-categories.service';
import { PhCategory, PhLabel, PhSubCategory } from '../../ph-categories/ph-category.model';
import { PhProductsService } from '../../ph-products/ph-products.service';
import {
  DimensionsFlexability,
  PhProductProperties,
} from '../../ph-products/ph-product.model';

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
    name_en: new FormControl<string>('', { nonNullable: true }),
    name_ar: new FormControl<string>('', { nonNullable: true }),
    category: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    subCategory: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    properties: new FormGroup({
      dimensionsFlexability: new FormControl<DimensionsFlexability>('fixed', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      fixed: new FormGroup({
        sizes: new FormArray<FormGroup>([]),
      }),
      dynamic: new FormGroup({
        materials: new FormArray<FormGroup>([]),
      }),
    }),
  });

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private categorySub?: Subscription;
  private flexabilitySub?: Subscription;
  private propertyTreeGateSub?: Subscription;

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

    this.propertyTreeGateSub = merge(
      this.form.controls.name_he.valueChanges,
      this.form.controls.category.valueChanges,
      this.form.controls.subCategory.valueChanges,
    ).subscribe(() => this.syncPropertyTreeVisibility());
    this.syncPropertyTreeVisibility();

    this.sizes.push(this.createSizeGroup());
    this.dynamicMaterials.push(this.createDynamicMaterialGroup());
    this.syncSizeLabelValidators();

    this.flexabilitySub = this.flexabilityControl.valueChanges.subscribe((value) => {
      this.applyFlexabilityState(value);
    });
    this.applyFlexabilityState(this.flexabilityControl.value);

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
    this.flexabilitySub?.unsubscribe();
    this.propertyTreeGateSub?.unsubscribe();
  }

  get canShowPropertyTree(): boolean {
    const name = String(this.form.controls.name_he.value ?? '').trim();
    const category = String(this.form.controls.category.value ?? '').trim();
    const subCategory = String(this.form.controls.subCategory.value ?? '').trim();
    return !!name && !!category && !!subCategory;
  }

  get propertiesGroup(): FormGroup {
    return this.form.controls.properties;
  }

  get flexabilityControl(): FormControl<DimensionsFlexability> {
    return this.propertiesGroup.get('dimensionsFlexability') as FormControl<DimensionsFlexability>;
  }

  get flexability(): DimensionsFlexability {
    return this.flexabilityControl.value;
  }

  get sizes(): FormArray {
    return this.propertiesGroup.get('fixed.sizes') as FormArray;
  }

  get dynamicGroup(): FormGroup {
    return this.propertiesGroup.get('dynamic') as FormGroup;
  }

  get dynamicMaterials(): FormArray {
    return this.dynamicGroup.get('materials') as FormArray;
  }

  get productNameControl(): FormControl<string> {
    return this.form.controls.name_he;
  }

  asArray(control: AbstractControl | null): FormArray {
    return control as FormArray;
  }

  getMaterials(sizeGroup: AbstractControl): FormArray {
    return sizeGroup.get('materials') as FormArray;
  }

  getColors(materialGroup: AbstractControl): FormArray {
    return materialGroup.get('colors') as FormArray;
  }

  addSize(): void {
    if (this.sizes.length === 1) {
      this.copyProductNameToSizeLabel(this.sizes.at(0));
    }
    this.sizes.push(this.createSizeGroup());
    this.syncSizeLabelValidators();
  }

  private copyProductNameToSizeLabel(sizeGroup: AbstractControl): void {
    const name = this.getProductNameForSize();
    const labelGroup = sizeGroup.get('label') as FormGroup;
    labelGroup.patchValue({ he: name, en: name, ar: name }, { emitEvent: false });
  }

  removeSize(index: number): void {
    if (this.sizes.length > 1) {
      this.sizes.removeAt(index);
      this.syncSizeLabelValidators();
    }
  }

  addMaterial(materials: FormArray, withDimensions = false): void {
    materials.push(withDimensions ? this.createDynamicMaterialGroup() : this.createMaterialGroup());
  }

  removeMaterial(materials: FormArray, index: number): void {
    if (materials.length > 1) {
      materials.removeAt(index);
    }
  }

  addColor(colors: FormArray): void {
    colors.push(this.createColorGroup());
  }

  removeColor(colors: FormArray, index: number): void {
    if (colors.length > 1) {
      colors.removeAt(index);
    }
  }

  getCategoryLabel(category: PhCategory): string {
    return this.resolveLabel(category.label);
  }

  getSubCategoryLabel(sub: PhSubCategory): string {
    return this.resolveLabel(sub.label);
  }

  onSave(): void {
    if (this.form.invalid || this.isSaving) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSaving = true;
    const value = this.form.getRawValue();

    const name = value.name_he.trim();
    this.phProductsService
      .createProduct({
        name_he: name,
        name_en: name,
        name_ar: name,
        category: value.category,
        subCategory: value.subCategory,
        properties: this.buildProperties(),
      })
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.resetForm();
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

  private buildProperties(): PhProductProperties {
    const flexability = this.flexability;

    if (flexability === 'fixed') {
      return {
        dimensionsFlexability: 'fixed',
        fixed: {
          sizes: this.sizes.controls.map((sizeGroup) => ({
            length: Number(sizeGroup.get('length')!.value),
            width: Number(sizeGroup.get('width')!.value),
            label: this.readSizeLabel(sizeGroup.get('label')!),
            materials: this.readMaterials(this.getMaterials(sizeGroup)),
          })),
        },
      };
    }

    return {
      dimensionsFlexability: flexability,
      dynamic: {
        materials: this.readDynamicMaterials(this.dynamicMaterials),
      },
    };
  }

  private readDynamicMaterials(materials: FormArray) {
    return materials.controls.map((materialGroup) => ({
      weight: Number(materialGroup.get('weight')!.value),
      label: this.readLabel(materialGroup.get('label')!),
      minLength: Number(materialGroup.get('minLength')!.value),
      maxLength: Number(materialGroup.get('maxLength')!.value),
      minHeight: Number(materialGroup.get('minHeight')!.value),
      maxHeight: Number(materialGroup.get('maxHeight')!.value),
      colors: this.getColors(materialGroup).controls.map((colorGroup) => ({
        color: String(colorGroup.get('color')!.value),
        label: this.readLabel(colorGroup.get('label')!),
      })),
    }));
  }

  private readMaterials(materials: FormArray) {
    return materials.controls.map((materialGroup) => ({
      weight: Number(materialGroup.get('weight')!.value),
      label: this.readLabel(materialGroup.get('label')!),
      colors: this.getColors(materialGroup).controls.map((colorGroup) => ({
        color: String(colorGroup.get('color')!.value),
        label: this.readLabel(colorGroup.get('label')!),
      })),
    }));
  }

  private readLabel(labelGroup: AbstractControl): PhLabel {
    const he = String(labelGroup.get('he')!.value ?? '').trim();
    return { he, en: he, ar: he };
  }

  getProductNameForSize(): string {
    return String(this.form.controls.name_he.value ?? '').trim();
  }

  private productNameLabel(): PhLabel {
    const name = this.getProductNameForSize();
    return { he: name, en: name, ar: name };
  }

  private readSizeLabel(labelGroup: AbstractControl): PhLabel {
    if (this.sizes.length <= 1) {
      return this.productNameLabel();
    }
    return this.readLabel(labelGroup);
  }

  private syncSizeLabelValidators(): void {
    const requireName = this.sizes.length > 1;

    for (const sizeGroup of this.sizes.controls) {
      const labelGroup = sizeGroup.get('label') as FormGroup;
      const heControl = labelGroup.get('he') as FormControl<string>;

      if (requireName) {
        heControl.setValidators([Validators.required]);
      } else {
        heControl.clearValidators();
        labelGroup.patchValue({ he: '', en: '', ar: '' }, { emitEvent: false });
      }

      heControl.updateValueAndValidity({ emitEvent: false });
    }
  }

  private resetForm(): void {
    this.sizes.clear();
    this.dynamicMaterials.clear();
    this.sizes.push(this.createSizeGroup());
    this.dynamicMaterials.push(this.createDynamicMaterialGroup());
    this.syncSizeLabelValidators();

    this.form.reset({
      name_he: '',
      name_en: '',
      name_ar: '',
      category: '',
      subCategory: '',
      properties: {
        dimensionsFlexability: 'fixed',
      },
    });
    this.subCategories = [];
    this.syncPropertyTreeVisibility();
  }

  private syncPropertyTreeVisibility(): void {
    const fixed = this.propertiesGroup.get('fixed')!;
    const dynamic = this.propertiesGroup.get('dynamic')!;

    if (this.canShowPropertyTree) {
      this.applyFlexabilityState(this.flexabilityControl.value);
    } else {
      fixed.disable({ emitEvent: false });
      dynamic.disable({ emitEvent: false });
    }
  }

  private applyFlexabilityState(value: DimensionsFlexability): void {
    const fixed = this.propertiesGroup.get('fixed')!;
    const dynamic = this.propertiesGroup.get('dynamic')!;

    if (!this.canShowPropertyTree) {
      fixed.disable({ emitEvent: false });
      dynamic.disable({ emitEvent: false });
      return;
    }

    if (value === 'fixed') {
      fixed.enable({ emitEvent: false });
      dynamic.disable({ emitEvent: false });
    } else {
      dynamic.enable({ emitEvent: false });
      fixed.disable({ emitEvent: false });
    }
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

  private createLabelGroup(): FormGroup {
    return new FormGroup({
      he: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
      en: new FormControl<string>('', { nonNullable: true }),
      ar: new FormControl<string>('', { nonNullable: true }),
    });
  }

  private createColorGroup(): FormGroup {
    return new FormGroup({
      color: new FormControl<string>('#ffffff', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      label: this.createLabelGroup(),
    });
  }

  private createMaterialGroup(): FormGroup {
    return new FormGroup({
      weight: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
      label: this.createLabelGroup(),
      colors: new FormArray<FormGroup>([this.createColorGroup()]),
    });
  }

  private createDynamicMaterialGroup(): FormGroup {
    const dimValidators = [Validators.required, Validators.min(0)];
    return new FormGroup({
      weight: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
      label: this.createLabelGroup(),
      minLength: new FormControl<number | null>(null, dimValidators),
      maxLength: new FormControl<number | null>(null, dimValidators),
      minHeight: new FormControl<number | null>(null, dimValidators),
      maxHeight: new FormControl<number | null>(null, dimValidators),
      colors: new FormArray<FormGroup>([this.createColorGroup()]),
    });
  }

  private createSizeGroup(): FormGroup {
    return new FormGroup({
      length: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
      width: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
      label: this.createLabelGroup(),
      materials: new FormArray<FormGroup>([this.createMaterialGroup()]),
    });
  }

  private resolveLabel(label: PhLabel): string {
    const lang = this.translateService.currentLang || 'he';
    if (lang === 'en') {
      return label.en;
    }
    if (lang === 'ar') {
      return label.ar;
    }
    return label.he;
  }
}
