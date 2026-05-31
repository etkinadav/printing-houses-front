import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit } from '@angular/core';
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
  CornerType,
  DimensionsFlexability,
  ExtraSettingKey,
  PhProductLabel,
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
export class ProductCreateComponent implements OnInit, OnDestroy, AfterViewInit {
  isRTL = true;
  isDarkMode = false;
  isLoading = true;
  isSaving = false;
  categories: PhCategory[] = [];
  subCategories: PhSubCategory[] = [];
  readonly extraSettingOptions: ExtraSettingKey[] = ['corners', 'bleed', 'folding'];

  form = new FormGroup({
    name_he: new FormControl<string>('', {
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
  private railResizeObserver?: ResizeObserver;

  constructor(
    private phCategoriesService: PhCategoriesService,
    private phProductsService: PhProductsService,
    private directionService: DirectionService,
    private translateService: TranslateService,
    private snackBar: MatSnackBar,
    private elementRef: ElementRef<HTMLElement>,
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
    this.syncMaterialHeaderLabelValidators();

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
    this.railResizeObserver?.disconnect();
  }

  ngAfterViewInit(): void {
    this.railResizeObserver = new ResizeObserver(() => this.syncTreeRailHeights());
    this.observeTreeRailFooters();
    this.scheduleRailSync();
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
    const last = this.sizes.at(this.sizes.length - 1);
    this.sizes.push(this.cloneSizeGroup(last));
    this.syncSizeLabelValidators();
    this.syncMaterialHeaderLabelValidators();
    this.scheduleRailSync();
  }

  private copyProductNameToSizeLabel(sizeGroup: AbstractControl): void {
    const name = this.getProductNameForSize();
    const labelGroup = sizeGroup.get('label') as FormGroup;
    labelGroup.patchValue({ he: name }, { emitEvent: false });
  }

  removeSize(index: number): void {
    if (this.sizes.length > 1) {
      this.sizes.removeAt(index);
      this.syncSizeLabelValidators();
      this.syncMaterialHeaderLabelValidators();
      this.scheduleRailSync();
    }
  }

  addMaterial(materials: FormArray, withDimensions = false): void {
    const last = materials.at(materials.length - 1);
    materials.push(this.cloneMaterialGroup(last, withDimensions));
    this.syncMaterialHeaderLabelValidators();
    this.scheduleRailSync();
  }

  removeMaterial(materials: FormArray, index: number, withDimensions = false): void {
    if (materials.length > 1) {
      materials.removeAt(index);
      this.syncMaterialHeaderLabelValidators();
      this.scheduleRailSync();
    }
  }

  addColor(colors: FormArray): void {
    const last = colors.at(colors.length - 1);
    colors.push(this.cloneColorGroup(last));
    this.scheduleRailSync();
  }

  removeColor(colors: FormArray, index: number): void {
    if (colors.length > 1) {
      colors.removeAt(index);
      this.scheduleRailSync();
    }
  }

  getCategoryLabel(category: PhCategory): string {
    return this.resolveLabel(category.label);
  }

  getSubCategoryLabel(sub: PhSubCategory): string {
    return this.resolveLabel(sub.label);
  }

  isExtraSettingSelected(group: AbstractControl, key: ExtraSettingKey): boolean {
    const settings = group.get('extraSettings')?.value as ExtraSettingKey[] | undefined;
    return settings?.includes(key) ?? false;
  }

  toggleExtraSetting(group: AbstractControl, key: ExtraSettingKey, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const control = group.get('extraSettings') as FormControl<ExtraSettingKey[]>;
    const current = [...control.value];
    const index = current.indexOf(key);
    if (index >= 0) {
      current.splice(index, 1);
      if (key === 'corners') {
        this.getCorners(group).clear();
      }
    } else {
      current.push(key);
      if (key === 'corners' && this.getCorners(group).length === 0) {
        this.getCorners(group).push(this.createCornerGroup());
      }
    }
    control.setValue(current);
    if (key === 'corners') {
      this.scheduleRailSync();
    }
  }

  getCorners(group: AbstractControl): FormArray {
    return group.get('corners') as FormArray;
  }

  addCorner(group: AbstractControl): void {
    const last = this.getCorners(group).at(this.getCorners(group).length - 1);
    this.getCorners(group).push(this.cloneCornerGroup(last));
    this.scheduleRailSync();
  }

  removeCorner(group: AbstractControl, index: number): void {
    const corners = this.getCorners(group);
    if (corners.length <= 1) {
      corners.clear();
      this.uncheckExtraSetting(group, 'corners');
      this.scheduleRailSync();
      return;
    }
    corners.removeAt(index);
    this.scheduleRailSync();
  }

  private uncheckExtraSetting(group: AbstractControl, key: ExtraSettingKey): void {
    const control = group.get('extraSettings') as FormControl<ExtraSettingKey[]>;
    control.setValue(control.value.filter((setting) => setting !== key));
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
            label: this.readSizeLabelForSave(sizeGroup.get('label')!),
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
      label: this.readMaterialLabelForSave(materialGroup, materials),
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

  private readLabel(labelGroup: AbstractControl): PhProductLabel {
    const he = String(labelGroup.get('he')!.value ?? '').trim();
    return { he };
  }

  getProductNameForSize(): string {
    return String(this.form.controls.name_he.value ?? '').trim();
  }

  private productNameLabel(): PhProductLabel {
    const name = this.getProductNameForSize();
    return { he: name };
  }

  /** Fixed sizes: single size has no name input — persist product name as size label. */
  private readSizeLabelForSave(labelGroup: AbstractControl): PhProductLabel {
    if (this.sizes.length === 1) {
      return this.productNameLabel();
    }
    return this.readLabel(labelGroup);
  }

  /** Dynamic: single material has no name input — persist product name as material label. */
  private readMaterialLabelForSave(materialGroup: AbstractControl, materials: FormArray): PhProductLabel {
    if (this.flexability === 'dynamic' && materials.length === 1) {
      return this.productNameLabel();
    }
    return this.readLabel(materialGroup.get('label')!);
  }

  private syncMaterialHeaderLabelValidators(): void {
    if (this.flexability === 'fixed') {
      for (const sizeGroup of this.sizes.controls) {
        this.applySingleMaterialLabelValidators(this.getMaterials(sizeGroup), true);
      }
      return;
    }

    this.applySingleMaterialLabelValidators(this.dynamicMaterials, false);
  }

  /** @param requireSingleMaterialLabel fixed mode shows material name even with one material */
  private applySingleMaterialLabelValidators(
    materials: FormArray,
    requireSingleMaterialLabel = false
  ): void {
    const hideLabel = materials.length === 1 && !requireSingleMaterialLabel;

    for (const materialGroup of materials.controls) {
      const heControl = (materialGroup.get('label') as FormGroup).get('he') as FormControl<string>;

      if (hideLabel) {
        heControl.clearValidators();
      } else {
        heControl.setValidators([Validators.required]);
      }

      heControl.updateValueAndValidity({ emitEvent: false });
    }
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
        labelGroup.patchValue({ he: '' }, { emitEvent: false });
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
    this.syncMaterialHeaderLabelValidators();

    this.form.reset({
      name_he: '',
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
      this.scheduleRailSync();
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

    this.syncMaterialHeaderLabelValidators();
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

  private createExtraSettingsControl(values?: ExtraSettingKey[]): FormControl<ExtraSettingKey[]> {
    return new FormControl<ExtraSettingKey[]>(values ?? [], { nonNullable: true });
  }

  private createCornersArray(
    corners?: Array<{ type: CornerType; radius: number | null }>,
  ): FormArray<FormGroup> {
    if (!corners?.length) {
      return new FormArray<FormGroup>([]);
    }
    return new FormArray<FormGroup>(corners.map((corner) => this.createCornerGroup(corner)));
  }

  private createCornerGroup(
    corner?: Partial<{ type: CornerType; radius: number | null }>,
  ): FormGroup {
    return new FormGroup({
      type: new FormControl<CornerType>(corner?.type ?? 'rounded', { nonNullable: true }),
      radius: new FormControl<number | null>(corner?.radius ?? null),
    });
  }

  private cloneCornerGroup(source: AbstractControl): FormGroup {
    return this.createCornerGroup(source.getRawValue());
  }

  private createLabelGroup(label?: Partial<PhProductLabel>): FormGroup {
    return new FormGroup({
      he: new FormControl<string>(label?.he ?? '', {
        nonNullable: true,
        validators: [Validators.required],
      }),
    });
  }

  private createColorGroup(
    color?: Partial<{
      color: string;
      label: Partial<PhProductLabel>;
      extraSettings?: ExtraSettingKey[];
      corners?: Array<{ type: CornerType; radius: number | null }>;
    }>,
  ): FormGroup {
    return new FormGroup({
      color: new FormControl<string>(color?.color ?? '#ffffff', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      label: this.createLabelGroup(color?.label),
      extraSettings: this.createExtraSettingsControl(color?.extraSettings),
      corners: this.createCornersArray(color?.corners),
    });
  }

  private cloneColorGroup(source: AbstractControl): FormGroup {
    const raw = source.getRawValue() as {
      color: string;
      label: Partial<PhProductLabel>;
      extraSettings?: ExtraSettingKey[];
      corners?: Array<{ type: CornerType; radius: number | null }>;
    };
    return this.createColorGroup(raw);
  }

  private createMaterialGroup(
    material?: Partial<{
      weight: number | null;
      label: Partial<PhProductLabel>;
      extraSettings?: ExtraSettingKey[];
      corners?: Array<{ type: CornerType; radius: number | null }>;
      colors: Array<{
        color: string;
        label: Partial<PhProductLabel>;
        extraSettings?: ExtraSettingKey[];
        corners?: Array<{ type: CornerType; radius: number | null }>;
      }>;
    }>,
  ): FormGroup {
    const colors = material?.colors?.length
      ? new FormArray<FormGroup>(material.colors.map((color) => this.createColorGroup(color)))
      : new FormArray<FormGroup>([this.createColorGroup()]);

    return new FormGroup({
      weight: new FormControl<number | null>(material?.weight ?? null, [
        Validators.required,
        Validators.min(0),
      ]),
      label: this.createLabelGroup(material?.label),
      extraSettings: this.createExtraSettingsControl(material?.extraSettings),
      corners: this.createCornersArray(material?.corners),
      colors,
    });
  }

  private createDynamicMaterialGroup(
    material?: Partial<{
      weight: number | null;
      label: Partial<PhProductLabel>;
      extraSettings?: ExtraSettingKey[];
      corners?: Array<{ type: CornerType; radius: number | null }>;
      minLength: number | null;
      maxLength: number | null;
      minHeight: number | null;
      maxHeight: number | null;
      colors: Array<{
        color: string;
        label: Partial<PhProductLabel>;
        extraSettings?: ExtraSettingKey[];
        corners?: Array<{ type: CornerType; radius: number | null }>;
      }>;
    }>,
  ): FormGroup {
    const dimValidators = [Validators.required, Validators.min(0)];
    const colors = material?.colors?.length
      ? new FormArray<FormGroup>(material.colors.map((color) => this.createColorGroup(color)))
      : new FormArray<FormGroup>([this.createColorGroup()]);

    return new FormGroup({
      weight: new FormControl<number | null>(material?.weight ?? null, [
        Validators.required,
        Validators.min(0),
      ]),
      label: this.createLabelGroup(material?.label),
      extraSettings: this.createExtraSettingsControl(material?.extraSettings),
      corners: this.createCornersArray(material?.corners),
      minLength: new FormControl<number | null>(material?.minLength ?? null, dimValidators),
      maxLength: new FormControl<number | null>(material?.maxLength ?? null, dimValidators),
      minHeight: new FormControl<number | null>(material?.minHeight ?? null, dimValidators),
      maxHeight: new FormControl<number | null>(material?.maxHeight ?? null, dimValidators),
      colors,
    });
  }

  private cloneMaterialGroup(source: AbstractControl, withDimensions: boolean): FormGroup {
    const raw = source.getRawValue();
    return withDimensions
      ? this.createDynamicMaterialGroup(raw)
      : this.createMaterialGroup(raw);
  }

  private createSizeGroup(
    size?: Partial<{
      length: number | null;
      width: number | null;
      label: Partial<PhProductLabel>;
      extraSettings?: ExtraSettingKey[];
      corners?: Array<{ type: CornerType; radius: number | null }>;
      materials: Array<{
        weight: number | null;
        label: Partial<PhProductLabel>;
        extraSettings?: ExtraSettingKey[];
        corners?: Array<{ type: CornerType; radius: number | null }>;
        colors: Array<{
          color: string;
          label: Partial<PhProductLabel>;
          extraSettings?: ExtraSettingKey[];
          corners?: Array<{ type: CornerType; radius: number | null }>;
        }>;
      }>;
    }>,
  ): FormGroup {
    const materials = size?.materials?.length
      ? new FormArray<FormGroup>(size.materials.map((material) => this.createMaterialGroup(material)))
      : new FormArray<FormGroup>([this.createMaterialGroup()]);

    return new FormGroup({
      length: new FormControl<number | null>(size?.length ?? null, [
        Validators.required,
        Validators.min(0),
      ]),
      width: new FormControl<number | null>(size?.width ?? null, [
        Validators.required,
        Validators.min(0),
      ]),
      label: this.createLabelGroup(size?.label),
      extraSettings: this.createExtraSettingsControl(size?.extraSettings),
      corners: this.createCornersArray(size?.corners),
      materials,
    });
  }

  private cloneSizeGroup(source: AbstractControl): FormGroup {
    const raw = source.getRawValue();
    return this.createSizeGroup(raw);
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

  private scheduleRailSync(): void {
    queueMicrotask(() => {
      this.observeTreeRailFooters();
      this.syncTreeRailHeights();
      requestAnimationFrame(() => this.syncTreeRailHeights());
    });
  }

  private observeTreeRailFooters(): void {
    if (!this.railResizeObserver) {
      return;
    }

    this.railResizeObserver.disconnect();
    const root = this.elementRef.nativeElement;
    root.querySelectorAll('.tree-branch__footer, .corners-branch__footer').forEach((footer) => {
      this.railResizeObserver?.observe(footer);
    });
  }

  private syncTreeRailHeights(): void {
    const root = this.elementRef.nativeElement;
    root.querySelectorAll<HTMLElement>('.tree-branch').forEach((branch) => {
      const footer = branch.querySelector<HTMLElement>('.tree-branch__footer');
      if (!footer) {
        return;
      }

      branch.style.setProperty('--tree-add-btn-height', `${footer.offsetHeight}px`);
    });

    root.querySelectorAll<HTMLElement>('.corners-branch').forEach((branch) => {
      const footer = branch.querySelector<HTMLElement>('.corners-branch__footer');
      const railEnd = branch.querySelector<HTMLElement>('.corners-branch__rail-end');
      if (!footer) {
        return;
      }

      branch.style.setProperty('--tree-add-btn-height', `${footer.offsetHeight}px`);

      if (railEnd) {
        const branchRect = branch.getBoundingClientRect();
        const railEndRect = railEnd.getBoundingClientRect();
        const bottomOffset = Math.max(0, branchRect.bottom - railEndRect.top);
        branch.style.setProperty('--corners-rail-bottom', `${bottomOffset}px`);
      }
    });
  }
}
