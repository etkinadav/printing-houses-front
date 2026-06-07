import { HttpEventType } from '@angular/common/http';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  Validators,
} from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { DirectionService } from '../../direction.service';
import { PhCategoriesService } from '../../ph-categories/ph-categories.service';
import { PhCategory, PhLabel, PhSubCategory } from '../../ph-categories/ph-category.model';
import { PH_FILE_TYPE_TEXTURE, PhFilesService } from '../../ph-files/ph-files.service';
import { isColorTextureUrl } from '../../ph-products/ph-color-texture.util';
import { PhProductsService } from '../../ph-products/ph-products.service';
import {
  CornerType,
  ExtraSettingMode,
  DimensionsFlexability,
  ExtraSettingKey,
  PhBleed,
  PhColor,
  PhCorner,
  PhDuplex,
  PhExtraSettingMode,
  PhFolding,
  PhMaterial,
  PhDynamicMaterial,
  PhProduct,
  PhProductLabel,
  PhProductProperties,
  PhSize,
  PhTreeExtraSettings,
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
  printingHouseId = '';
  productId = '';
  isEditMode = false;
  categories: PhCategory[] = [];
  subCategories: PhSubCategory[] = [];
  readonly extraSettingOptions: ExtraSettingKey[] = ['corners', 'bleed', 'folding', 'duplex', 'double-sided'];

  private readonly positiveNumberValidators = [Validators.required, Validators.min(0)];
  private readonly colorTextureUploads = new Map<AbstractControl, Subscription>();
  colorTextureUploadProgress = new Map<AbstractControl, number>();

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
  private railResizeObserver?: ResizeObserver;

  constructor(
    private phCategoriesService: PhCategoriesService,
    private phProductsService: PhProductsService,
    private phFilesService: PhFilesService,
    private directionService: DirectionService,
    private translateService: TranslateService,
    private snackBar: MatSnackBar,
    private elementRef: ElementRef<HTMLElement>,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.printingHouseId = this.route.snapshot.paramMap.get('printingHouseId') ?? '';
    this.productId = this.route.snapshot.paramMap.get('productId') ?? '';
    this.isEditMode = !!this.productId;

    if (!this.printingHouseId) {
      void this.router.navigate(['/management/printing-house']);
      return;
    }

    this.directionSub = this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
    });
    this.darkModeSub = this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });

    this.categorySub = this.form.controls.category.valueChanges.subscribe((categoryId) => {
      this.onCategoryChange(categoryId);
    });

    this.sizes.push(this.createSizeGroup());
    this.dynamicMaterials.push(this.createDynamicMaterialGroup());
    this.syncSizeLabelValidators();
    this.syncMaterialHeaderLabelValidators();

    this.flexabilitySub = this.flexabilityControl.valueChanges.subscribe((value) => {
      this.applyFlexabilityState(value);
    });
    this.applyFlexabilityState(this.flexabilityControl.value);
    this.syncAllTreeExtraValidators();

    this.phCategoriesService.getAllCategories().subscribe({
      next: (response) => {
        this.categories = response.categories ?? [];
        if (this.isEditMode) {
          this.loadProductForEdit();
        } else {
          this.isLoading = false;
        }
      },
      error: () => {
        this.isLoading = false;
      },
    });
  }

  private loadProductForEdit(): void {
    this.phProductsService.getProductById(this.productId).subscribe({
      next: (res) => {
        this.populateFormFromProduct(res.product);
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        void this.router.navigate(['/management/printing-house', this.printingHouseId]);
      },
    });
  }

  private populateFormFromProduct(product: PhProduct): void {
    this.sizes.clear();
    this.dynamicMaterials.clear();

    const categoryId =
      typeof product.category === 'string'
        ? product.category
        : product.category?._id != null
          ? String(product.category._id)
          : '';
    const flex = product.properties.dimensionsFlexability;

    this.form.patchValue(
      {
        name_he: product.name_he,
        category: categoryId,
        properties: { dimensionsFlexability: flex },
      },
      { emitEvent: false },
    );

    this.onCategoryChange(categoryId, product.subCategory);

    if (flex === 'fixed' && product.properties.fixed?.sizes?.length) {
      for (const size of product.properties.fixed.sizes) {
        this.sizes.push(this.createSizeGroup(size));
      }
    } else if (product.properties.dynamic?.materials?.length) {
      for (const material of product.properties.dynamic.materials) {
        this.dynamicMaterials.push(this.createDynamicMaterialGroup(material));
      }
    }

    if (!this.sizes.length) {
      this.sizes.push(this.createSizeGroup());
    }
    if (!this.dynamicMaterials.length) {
      this.dynamicMaterials.push(this.createDynamicMaterialGroup());
    }

    this.applyFlexabilityState(flex);
    this.syncSizeLabelValidators();
    this.syncMaterialHeaderLabelValidators();
    this.syncAllTreeExtraValidators();
    this.scheduleRailSync();
  }

  ngOnDestroy(): void {
    this.directionSub?.unsubscribe();
    this.darkModeSub?.unsubscribe();
    this.categorySub?.unsubscribe();
    this.flexabilitySub?.unsubscribe();
    this.railResizeObserver?.disconnect();
    for (const sub of this.colorTextureUploads.values()) {
      sub.unsubscribe();
    }
    this.colorTextureUploads.clear();
    this.colorTextureUploadProgress.clear();
  }

  isColorTexture(value: unknown): boolean {
    return isColorTextureUrl(String(value ?? ''));
  }

  isColorTextureUploading(color: AbstractControl): boolean {
    return this.colorTextureUploads.has(color);
  }

  getColorTextureUploadProgress(color: AbstractControl): number {
    return this.colorTextureUploadProgress.get(color) ?? 0;
  }

  triggerColorTexturePicker(color: AbstractControl, input: HTMLInputElement): void {
    if (this.isColorTextureUploading(color)) {
      return;
    }
    input.click();
  }

  onColorTextureSelected(event: Event, color: AbstractControl): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.snackBar.open(
        this.translateService.instant('management.product-create.color-texture-invalid-type'),
        undefined,
        { duration: 4000 },
      );
      return;
    }

    this.colorTextureUploads.get(color)?.unsubscribe();
    this.colorTextureUploadProgress.set(color, 0);

    const sub = this.phFilesService.upload(PH_FILE_TYPE_TEXTURE, file).subscribe({
      next: (httpEvent) => {
        if (httpEvent.type === HttpEventType.UploadProgress) {
          const total = httpEvent.total ?? 0;
          this.colorTextureUploadProgress.set(
            color,
            total ? Math.round((100 * httpEvent.loaded) / total) : 0,
          );
          return;
        }

        if (httpEvent.type !== HttpEventType.Response || !httpEvent.body) {
          return;
        }

        const textureUrl =
          httpEvent.body.thumbnail?.url?.trim() || httpEvent.body.original?.url?.trim() || '';

        if (!textureUrl) {
          this.finishColorTextureUpload(color);
          this.snackBar.open(
            this.translateService.instant('management.product-create.color-texture-upload-failed'),
            undefined,
            { duration: 4000 },
          );
          return;
        }

        color.get('color')!.setValue(textureUrl);
        this.finishColorTextureUpload(color);
      },
      error: () => {
        this.finishColorTextureUpload(color);
        this.snackBar.open(
          this.translateService.instant('management.product-create.color-texture-upload-failed'),
          undefined,
          { duration: 4000 },
        );
      },
    });

    this.colorTextureUploads.set(color, sub);
  }

  clearColorTexture(color: AbstractControl, event?: Event): void {
    event?.stopPropagation();
    color.get('color')!.setValue('#ffffff');
  }

  cancelColorTextureUpload(color: AbstractControl, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.finishColorTextureUpload(color);
  }

  private finishColorTextureUpload(color: AbstractControl): void {
    this.colorTextureUploads.get(color)?.unsubscribe();
    this.colorTextureUploads.delete(color);
    this.colorTextureUploadProgress.delete(color);
  }

  ngAfterViewInit(): void {
    this.railResizeObserver = new ResizeObserver(() => this.syncTreeRailHeights());
    this.observeTreeRailFooters();
    this.scheduleRailSync();
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
    this.syncAllTreeExtraValidators();
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
      this.syncAllTreeExtraValidators();
      this.scheduleRailSync();
    }
  }

  addMaterial(materials: FormArray, withDimensions = false): void {
    const last = materials.at(materials.length - 1);
    materials.push(this.cloneMaterialGroup(last, withDimensions));
    this.syncMaterialHeaderLabelValidators();
    this.syncAllTreeExtraValidators();
    this.scheduleRailSync();
  }

  removeMaterial(materials: FormArray, index: number, withDimensions = false): void {
    if (materials.length > 1) {
      materials.removeAt(index);
      this.syncMaterialHeaderLabelValidators();
      this.syncAllTreeExtraValidators();
      this.scheduleRailSync();
    }
  }

  addColor(colors: FormArray): void {
    const last = colors.at(colors.length - 1);
    colors.push(this.cloneColorGroup(last));
    this.syncAllTreeExtraValidators();
    this.scheduleRailSync();
  }

  removeColor(colors: FormArray, index: number): void {
    if (colors.length > 1) {
      colors.removeAt(index);
      this.syncAllTreeExtraValidators();
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

  hasActiveExtraSettings(group: AbstractControl): boolean {
    const settings = group.get('extraSettings')?.value as ExtraSettingKey[] | undefined;
    return (settings?.length ?? 0) > 0;
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
        this.resetExtraSettingMode(group, 'corners');
      }
      if (key === 'bleed') {
        this.getBleeds(group).clear();
        this.resetExtraSettingMode(group, 'bleed');
      }
      if (key === 'folding') {
        this.getFoldings(group).clear();
        this.resetExtraSettingMode(group, 'folding');
      }
      if (key === 'duplex') {
        this.getDuplexes(group).clear();
        this.resetExtraSettingMode(group, 'duplex');
      }
      if (key === 'double-sided') {
        this.resetExtraSettingMode(group, 'double-sided');
      }
    } else {
      current.push(key);
      if (key === 'corners' && this.getCorners(group).length === 0) {
        this.getCorners(group).push(this.createCornerGroup());
      }
      if (key === 'bleed' && this.getBleeds(group).length === 0) {
        this.getBleeds(group).push(this.createBleedGroup());
      }
      if (key === 'folding' && this.getFoldings(group).length === 0) {
        this.getFoldings(group).push(this.createFoldingGroup());
      }
      if (key === 'duplex' && this.getDuplexes(group).length === 0) {
        this.getDuplexes(group).push(this.createDuplexGroup());
      }
    }
    control.setValue(current);
    this.syncTreeExtraValidators(group);
    if (key === 'corners' || key === 'bleed' || key === 'folding' || key === 'duplex' || key === 'double-sided') {
      this.scheduleRailSync();
    }
  }

  getCorners(group: AbstractControl): FormArray {
    return group.get('corners') as FormArray;
  }

  addCorner(group: AbstractControl): void {
    const last = this.getCorners(group).at(this.getCorners(group).length - 1);
    this.getCorners(group).push(this.cloneCornerGroup(last));
    this.syncTreeExtraValidators(group);
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
    this.syncTreeExtraValidators(group);
    this.scheduleRailSync();
  }

  getBleeds(group: AbstractControl): FormArray {
    return group.get('bleeds') as FormArray;
  }

  addBleed(group: AbstractControl): void {
    const bleeds = this.getBleeds(group);
    const last = bleeds.at(bleeds.length - 1);
    bleeds.push(this.cloneBleedGroup(last));
    this.syncTreeExtraValidators(group);
    this.scheduleRailSync();
  }

  removeBleed(group: AbstractControl, index: number): void {
    const bleeds = this.getBleeds(group);
    if (bleeds.length <= 1) {
      bleeds.clear();
      this.uncheckExtraSetting(group, 'bleed');
      this.scheduleRailSync();
      return;
    }
    bleeds.removeAt(index);
    this.syncTreeExtraValidators(group);
    this.scheduleRailSync();
  }

  getDuplexes(group: AbstractControl): FormArray {
    return group.get('duplexes') as FormArray;
  }

  addDuplex(group: AbstractControl): void {
    const duplexes = this.getDuplexes(group);
    const last = duplexes.at(duplexes.length - 1);
    duplexes.push(this.cloneDuplexGroup(last));
    this.syncTreeExtraValidators(group);
    this.scheduleRailSync();
  }

  removeDuplex(group: AbstractControl, index: number): void {
    const duplexes = this.getDuplexes(group);
    if (duplexes.length <= 1) {
      duplexes.clear();
      this.uncheckExtraSetting(group, 'duplex');
      this.scheduleRailSync();
      return;
    }
    duplexes.removeAt(index);
    this.syncTreeExtraValidators(group);
    this.scheduleRailSync();
  }

  getCornersSetting(group: AbstractControl): FormGroup {
    return group.get('cornersSetting') as FormGroup;
  }

  getBleedSetting(group: AbstractControl): FormGroup {
    return group.get('bleedSetting') as FormGroup;
  }

  getFoldingSetting(group: AbstractControl): FormGroup {
    return group.get('foldingSetting') as FormGroup;
  }

  getDuplexSetting(group: AbstractControl): FormGroup {
    return group.get('duplexSetting') as FormGroup;
  }

  getDoubleSided(group: AbstractControl): FormGroup {
    return group.get('doubleSided') as FormGroup;
  }

  removeDoubleSided(group: AbstractControl): void {
    this.uncheckExtraSetting(group, 'double-sided');
    this.scheduleRailSync();
  }

  getFoldings(group: AbstractControl): FormArray {
    return group.get('foldings') as FormArray;
  }

  addFolding(group: AbstractControl): void {
    const foldings = this.getFoldings(group);
    const last = foldings.at(foldings.length - 1);
    foldings.push(this.cloneFoldingGroup(last));
    this.syncTreeExtraValidators(group);
    this.scheduleRailSync();
  }

  removeFolding(group: AbstractControl, index: number): void {
    const foldings = this.getFoldings(group);
    if (foldings.length <= 1) {
      foldings.clear();
      this.uncheckExtraSetting(group, 'folding');
      this.scheduleRailSync();
      return;
    }
    foldings.removeAt(index);
    this.syncTreeExtraValidators(group);
    this.scheduleRailSync();
  }

  private uncheckExtraSetting(group: AbstractControl, key: ExtraSettingKey): void {
    const control = group.get('extraSettings') as FormControl<ExtraSettingKey[]>;
    control.setValue(control.value.filter((setting) => setting !== key));
    this.resetExtraSettingMode(group, key);
    this.syncTreeExtraValidators(group);
  }

  private resetExtraSettingMode(group: AbstractControl, key: ExtraSettingKey): void {
    switch (key) {
      case 'corners':
        this.getCornersSetting(group).reset({ mode: 'required' });
        break;
      case 'bleed':
        this.getBleedSetting(group).reset({ mode: 'required' });
        break;
      case 'folding':
        this.getFoldingSetting(group).reset({ mode: 'required' });
        break;
      case 'duplex':
        this.getDuplexSetting(group).reset({ mode: 'required' });
        break;
      case 'double-sided':
        this.getDoubleSided(group).reset({ mode: 'required' });
        break;
    }
  }

  onSave(): void {
    this.syncAllTreeExtraValidators();
    if (this.form.invalid || this.isSaving) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSaving = true;
    const value = this.form.getRawValue();

    const name = value.name_he.trim();
    const body = {
      name_he: name,
      category: value.category,
      subCategory: value.subCategory,
      properties: this.buildProperties(),
    };

    const request$ = this.isEditMode
      ? this.phProductsService.updateProduct(this.productId, body)
      : this.phProductsService.createProduct({
          printingHouseId: this.printingHouseId,
          ...body,
        });

    request$.subscribe({
      next: () => {
        this.isSaving = false;
        this.snackBar.open(
          this.translateService.instant('management.product-create.saved'),
          undefined,
          { duration: 3000 },
        );
        void this.router.navigate(['/management/printing-house', this.printingHouseId]);
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
          sizes: this.sizes.controls.map((sizeGroup) => this.readSize(sizeGroup)),
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

  private readSize(sizeGroup: AbstractControl): PhSize {
    return {
      length: Number(sizeGroup.get('length')!.value),
      width: Number(sizeGroup.get('width')!.value),
      label: this.readSizeLabelForSave(sizeGroup.get('label')!),
      materials: this.readMaterials(this.getMaterials(sizeGroup)),
      ...this.readTreeExtras(sizeGroup),
    };
  }

  private readDynamicMaterials(materials: FormArray): PhDynamicMaterial[] {
    return materials.controls.map((materialGroup) => ({
      weight: Number(materialGroup.get('weight')!.value),
      label: this.readMaterialLabelForSave(materialGroup, materials),
      minLength: Number(materialGroup.get('minLength')!.value),
      maxLength: Number(materialGroup.get('maxLength')!.value),
      minHeight: Number(materialGroup.get('minHeight')!.value),
      maxHeight: Number(materialGroup.get('maxHeight')!.value),
      colors: this.readColors(materialGroup),
      ...this.readTreeExtras(materialGroup),
    }));
  }

  private readMaterials(materials: FormArray): PhMaterial[] {
    return materials.controls.map((materialGroup) => ({
      weight: Number(materialGroup.get('weight')!.value),
      label: this.readLabel(materialGroup.get('label')!),
      colors: this.readColors(materialGroup),
      ...this.readTreeExtras(materialGroup),
    }));
  }

  private readColors(materialGroup: AbstractControl): PhColor[] {
    return this.getColors(materialGroup).controls.map((colorGroup) => ({
      color: String(colorGroup.get('color')!.value),
      label: this.readLabel(colorGroup.get('label')!),
      ...this.readTreeExtras(colorGroup),
    }));
  }

  private readNumericOrNull(control: AbstractControl | null): number | null {
    if (!control) {
      return null;
    }
    const value = control.value;
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return Number(value);
  }

  private readExtraSettingMode(group: AbstractControl, key: string): PhExtraSettingMode {
    const mode = group.get(key)?.get('mode')?.value as ExtraSettingMode | undefined;
    return { mode: mode ?? 'required' };
  }

  private readTreeExtras(group: AbstractControl): PhTreeExtraSettings {
    const selected = (group.get('extraSettings')?.value as ExtraSettingKey[]) ?? [];
    if (!selected.length) {
      return {};
    }

    const extras: PhTreeExtraSettings = {
      extraSettings: [...selected],
    };

    if (selected.includes('corners')) {
      extras.cornersSetting = this.readExtraSettingMode(group, 'cornersSetting');
      extras.corners = this.getCorners(group).controls.map((cornerGroup) => ({
        type: cornerGroup.get('type')!.value as CornerType,
        radius: this.readNumericOrNull(cornerGroup.get('radius')),
      })) as PhCorner[];
    }

    if (selected.includes('bleed')) {
      extras.bleedSetting = this.readExtraSettingMode(group, 'bleedSetting');
      extras.bleeds = this.getBleeds(group).controls.map((bleedGroup) => ({
        size: this.readNumericOrNull(bleedGroup.get('size')),
      })) as PhBleed[];
    }

    if (selected.includes('folding')) {
      extras.foldingSetting = this.readExtraSettingMode(group, 'foldingSetting');
      extras.foldings = this.getFoldings(group).controls.map((foldingGroup) => ({
        count: Number(foldingGroup.get('count')!.value),
        offset: this.readNumericOrNull(foldingGroup.get('offset')),
      })) as PhFolding[];
    }

    if (selected.includes('duplex')) {
      extras.duplexSetting = this.readExtraSettingMode(group, 'duplexSetting');
      extras.duplexes = this.getDuplexes(group).controls.map((duplexGroup) => ({
        size: this.readNumericOrNull(duplexGroup.get('size')),
      })) as PhDuplex[];
    }

    if (selected.includes('double-sided')) {
      extras.doubleSided = this.readExtraSettingMode(group, 'doubleSided');
    }

    return extras;
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
    this.applyFlexabilityState(this.flexabilityControl.value);
    this.scheduleRailSync();
  }

  private applyFlexabilityState(value: DimensionsFlexability): void {
    const fixed = this.propertiesGroup.get('fixed')!;
    const dynamic = this.propertiesGroup.get('dynamic')!;

    if (value === 'fixed') {
      fixed.enable({ emitEvent: false });
      dynamic.disable({ emitEvent: false });
    } else {
      dynamic.enable({ emitEvent: false });
      fixed.disable({ emitEvent: false });
    }

    this.syncMaterialHeaderLabelValidators();
  }

  private onCategoryChange(categoryId: string, restoreSubCategoryKey?: string): void {
    this.subCategories = [];

    if (!categoryId) {
      this.form.controls.subCategory.setValue('', { emitEvent: false });
      return;
    }

    const category = this.categories.find((c) => c._id === categoryId);
    this.subCategories = category?.subCategories ?? [];

    const key = restoreSubCategoryKey?.trim() ?? '';
    if (key && this.subCategories.some((sc) => sc.key === key)) {
      this.form.controls.subCategory.setValue(key, { emitEvent: false });
    } else {
      this.form.controls.subCategory.setValue('', { emitEvent: false });
    }
  }

  private syncAllTreeExtraValidators(): void {
    for (const sizeGroup of this.sizes.controls) {
      this.syncTreeExtraValidatorsDeep(sizeGroup);
    }
    for (const materialGroup of this.dynamicMaterials.controls) {
      this.syncTreeExtraValidatorsDeep(materialGroup);
    }
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  private syncTreeExtraValidatorsDeep(group: AbstractControl): void {
    if (group.get('extraSettings')) {
      this.syncTreeExtraValidators(group);
    }
    const colors = group.get('colors') as FormArray | null;
    if (colors) {
      for (const colorGroup of colors.controls) {
        this.syncTreeExtraValidatorsDeep(colorGroup);
      }
    }
    const materials = group.get('materials') as FormArray | null;
    if (materials) {
      for (const materialGroup of materials.controls) {
        this.syncTreeExtraValidatorsDeep(materialGroup);
      }
    }
  }

  private syncTreeExtraValidators(group: AbstractControl): void {
    const selected = (group.get('extraSettings')?.value as ExtraSettingKey[]) ?? [];

    this.applyExtraArrayValidators(this.getCorners(group), 'radius', selected.includes('corners'));
    this.applyExtraArrayValidators(this.getBleeds(group), 'size', selected.includes('bleed'));
    this.applyExtraArrayValidators(this.getDuplexes(group), 'size', selected.includes('duplex'));
    this.applyFoldingValidators(group, selected.includes('folding'));

    group.updateValueAndValidity({ emitEvent: false });
  }

  private applyExtraArrayValidators(
    array: FormArray,
    fieldName: string,
    active: boolean,
  ): void {
    if (active) {
      array.setValidators([Validators.required, Validators.minLength(1)]);
    } else {
      array.clearValidators();
    }
    array.updateValueAndValidity({ emitEvent: false });

    for (const item of array.controls) {
      const field = item.get(fieldName);
      if (!field) {
        continue;
      }
      if (active) {
        field.setValidators(this.positiveNumberValidators);
      } else {
        field.clearValidators();
      }
      field.updateValueAndValidity({ emitEvent: false });
    }
  }

  private applyFoldingValidators(group: AbstractControl, active: boolean): void {
    const foldings = this.getFoldings(group);
    if (active) {
      foldings.setValidators([Validators.required, Validators.minLength(1)]);
    } else {
      foldings.clearValidators();
    }
    foldings.updateValueAndValidity({ emitEvent: false });

    for (const item of foldings.controls) {
      const count = item.get('count');
      const offset = item.get('offset');
      if (count) {
        if (active) {
          count.setValidators([Validators.required, Validators.min(1)]);
        } else {
          count.clearValidators();
        }
        count.updateValueAndValidity({ emitEvent: false });
      }
      if (offset) {
        if (active) {
          offset.setValidators(this.positiveNumberValidators);
        } else {
          offset.clearValidators();
        }
        offset.updateValueAndValidity({ emitEvent: false });
      }
    }
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

  private createBleedsArray(
    bleeds?: Array<{ size: number | null }>,
  ): FormArray<FormGroup> {
    if (!bleeds?.length) {
      return new FormArray<FormGroup>([]);
    }
    return new FormArray<FormGroup>(bleeds.map((bleed) => this.createBleedGroup(bleed)));
  }

  private createBleedGroup(bleed?: Partial<{ size: number | null }>): FormGroup {
    return new FormGroup({
      size: new FormControl<number | null>(bleed?.size ?? null),
    });
  }

  private cloneBleedGroup(source: AbstractControl): FormGroup {
    return this.createBleedGroup(source.getRawValue());
  }

  private createDuplexesArray(
    duplexes?: Array<{ size: number | null }>,
  ): FormArray<FormGroup> {
    if (!duplexes?.length) {
      return new FormArray<FormGroup>([]);
    }
    return new FormArray<FormGroup>(duplexes.map((duplex) => this.createDuplexGroup(duplex)));
  }

  private createDuplexGroup(duplex?: Partial<{ size: number | null }>): FormGroup {
    return new FormGroup({
      size: new FormControl<number | null>(duplex?.size ?? null),
    });
  }

  private cloneDuplexGroup(source: AbstractControl): FormGroup {
    return this.createDuplexGroup(source.getRawValue());
  }

  private createExtraSettingModeGroup(
    data?: Partial<{ mode: ExtraSettingMode }>,
  ): FormGroup {
    return new FormGroup({
      mode: new FormControl<ExtraSettingMode>(data?.mode ?? 'required', {
        nonNullable: true,
      }),
    });
  }

  private createDoubleSidedGroup(
    doubleSided?: Partial<{ mode: ExtraSettingMode }>,
  ): FormGroup {
    return this.createExtraSettingModeGroup(doubleSided);
  }

  private createFoldingsArray(
    foldings?: Array<{ count: number; offset: number | null }>,
  ): FormArray<FormGroup> {
    if (!foldings?.length) {
      return new FormArray<FormGroup>([]);
    }
    return new FormArray<FormGroup>(foldings.map((folding) => this.createFoldingGroup(folding)));
  }

  private createFoldingGroup(
    folding?: Partial<{ count: number; offset: number | null }>,
  ): FormGroup {
    return new FormGroup({
      count: new FormControl<number>(folding?.count ?? 1, { nonNullable: true }),
      offset: new FormControl<number | null>(folding?.offset ?? null),
    });
  }

  private cloneFoldingGroup(source: AbstractControl): FormGroup {
    return this.createFoldingGroup(source.getRawValue());
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
      cornersSetting?: Partial<{ mode: ExtraSettingMode }>;
      bleedSetting?: Partial<{ mode: ExtraSettingMode }>;
      foldingSetting?: Partial<{ mode: ExtraSettingMode }>;
      duplexSetting?: Partial<{ mode: ExtraSettingMode }>;
      corners?: Array<{ type: CornerType; radius: number | null }>;
      bleeds?: Array<{ size: number | null }>;
      duplexes?: Array<{ size: number | null }>;
      foldings?: Array<{ count: number; offset: number | null }>;
      doubleSided?: Partial<{ mode: ExtraSettingMode }>;
    }>,
  ): FormGroup {
    return new FormGroup({
      color: new FormControl<string>(color?.color ?? '#ffffff', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      label: this.createLabelGroup(color?.label),
      extraSettings: this.createExtraSettingsControl(color?.extraSettings),
      cornersSetting: this.createExtraSettingModeGroup(color?.cornersSetting),
      bleedSetting: this.createExtraSettingModeGroup(color?.bleedSetting),
      foldingSetting: this.createExtraSettingModeGroup(color?.foldingSetting),
      duplexSetting: this.createExtraSettingModeGroup(color?.duplexSetting),
      corners: this.createCornersArray(color?.corners),
      bleeds: this.createBleedsArray(color?.bleeds),
      duplexes: this.createDuplexesArray(color?.duplexes),
      foldings: this.createFoldingsArray(color?.foldings),
      doubleSided: this.createDoubleSidedGroup(color?.doubleSided),
    });
  }

  private cloneColorGroup(source: AbstractControl): FormGroup {
    const raw = source.getRawValue() as {
      color: string;
      label: Partial<PhProductLabel>;
      extraSettings?: ExtraSettingKey[];
      cornersSetting?: Partial<{ mode: ExtraSettingMode }>;
      bleedSetting?: Partial<{ mode: ExtraSettingMode }>;
      foldingSetting?: Partial<{ mode: ExtraSettingMode }>;
      duplexSetting?: Partial<{ mode: ExtraSettingMode }>;
      corners?: Array<{ type: CornerType; radius: number | null }>;
      bleeds?: Array<{ size: number | null }>;
      duplexes?: Array<{ size: number | null }>;
      foldings?: Array<{ count: number; offset: number | null }>;
      doubleSided?: Partial<{ mode: ExtraSettingMode }>;
    };
    return this.createColorGroup(raw);
  }

  private createMaterialGroup(
    material?: Partial<{
      weight: number | null;
      label: Partial<PhProductLabel>;
      extraSettings?: ExtraSettingKey[];
      cornersSetting?: Partial<{ mode: ExtraSettingMode }>;
      bleedSetting?: Partial<{ mode: ExtraSettingMode }>;
      foldingSetting?: Partial<{ mode: ExtraSettingMode }>;
      duplexSetting?: Partial<{ mode: ExtraSettingMode }>;
      corners?: Array<{ type: CornerType; radius: number | null }>;
      bleeds?: Array<{ size: number | null }>;
      duplexes?: Array<{ size: number | null }>;
      foldings?: Array<{ count: number; offset: number | null }>;
      doubleSided?: Partial<{ mode: ExtraSettingMode }>;
      colors: Array<{
        color: string;
        label: Partial<PhProductLabel>;
        extraSettings?: ExtraSettingKey[];
        corners?: Array<{ type: CornerType; radius: number | null }>;
        bleeds?: Array<{ size: number | null }>;
      duplexes?: Array<{ size: number | null }>;
        foldings?: Array<{ count: number; offset: number | null }>;
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
      cornersSetting: this.createExtraSettingModeGroup(material?.cornersSetting),
      bleedSetting: this.createExtraSettingModeGroup(material?.bleedSetting),
      foldingSetting: this.createExtraSettingModeGroup(material?.foldingSetting),
      duplexSetting: this.createExtraSettingModeGroup(material?.duplexSetting),
      corners: this.createCornersArray(material?.corners),
      bleeds: this.createBleedsArray(material?.bleeds),
      duplexes: this.createDuplexesArray(material?.duplexes),
      foldings: this.createFoldingsArray(material?.foldings),
      doubleSided: this.createDoubleSidedGroup(material?.doubleSided),
      colors,
    });
  }

  private createDynamicMaterialGroup(
    material?: Partial<{
      weight: number | null;
      label: Partial<PhProductLabel>;
      extraSettings?: ExtraSettingKey[];
      cornersSetting?: Partial<{ mode: ExtraSettingMode }>;
      bleedSetting?: Partial<{ mode: ExtraSettingMode }>;
      foldingSetting?: Partial<{ mode: ExtraSettingMode }>;
      duplexSetting?: Partial<{ mode: ExtraSettingMode }>;
      corners?: Array<{ type: CornerType; radius: number | null }>;
      bleeds?: Array<{ size: number | null }>;
      duplexes?: Array<{ size: number | null }>;
      foldings?: Array<{ count: number; offset: number | null }>;
      doubleSided?: Partial<{ mode: ExtraSettingMode }>;
      minLength: number | null;
      maxLength: number | null;
      minHeight: number | null;
      maxHeight: number | null;
      colors: Array<{
        color: string;
        label: Partial<PhProductLabel>;
        extraSettings?: ExtraSettingKey[];
        corners?: Array<{ type: CornerType; radius: number | null }>;
        bleeds?: Array<{ size: number | null }>;
      duplexes?: Array<{ size: number | null }>;
        foldings?: Array<{ count: number; offset: number | null }>;
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
      cornersSetting: this.createExtraSettingModeGroup(material?.cornersSetting),
      bleedSetting: this.createExtraSettingModeGroup(material?.bleedSetting),
      foldingSetting: this.createExtraSettingModeGroup(material?.foldingSetting),
      duplexSetting: this.createExtraSettingModeGroup(material?.duplexSetting),
      corners: this.createCornersArray(material?.corners),
      bleeds: this.createBleedsArray(material?.bleeds),
      duplexes: this.createDuplexesArray(material?.duplexes),
      foldings: this.createFoldingsArray(material?.foldings),
      doubleSided: this.createDoubleSidedGroup(material?.doubleSided),
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
      cornersSetting?: Partial<{ mode: ExtraSettingMode }>;
      bleedSetting?: Partial<{ mode: ExtraSettingMode }>;
      foldingSetting?: Partial<{ mode: ExtraSettingMode }>;
      duplexSetting?: Partial<{ mode: ExtraSettingMode }>;
      corners?: Array<{ type: CornerType; radius: number | null }>;
      bleeds?: Array<{ size: number | null }>;
      duplexes?: Array<{ size: number | null }>;
      foldings?: Array<{ count: number; offset: number | null }>;
      doubleSided?: Partial<{ mode: ExtraSettingMode }>;
      materials: Array<{
        weight: number | null;
        label: Partial<PhProductLabel>;
        extraSettings?: ExtraSettingKey[];
        corners?: Array<{ type: CornerType; radius: number | null }>;
        bleeds?: Array<{ size: number | null }>;
      duplexes?: Array<{ size: number | null }>;
        foldings?: Array<{ count: number; offset: number | null }>;
        colors: Array<{
          color: string;
          label: Partial<PhProductLabel>;
          extraSettings?: ExtraSettingKey[];
          corners?: Array<{ type: CornerType; radius: number | null }>;
          bleeds?: Array<{ size: number | null }>;
      duplexes?: Array<{ size: number | null }>;
          foldings?: Array<{ count: number; offset: number | null }>;
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
      cornersSetting: this.createExtraSettingModeGroup(size?.cornersSetting),
      bleedSetting: this.createExtraSettingModeGroup(size?.bleedSetting),
      foldingSetting: this.createExtraSettingModeGroup(size?.foldingSetting),
      duplexSetting: this.createExtraSettingModeGroup(size?.duplexSetting),
      corners: this.createCornersArray(size?.corners),
      bleeds: this.createBleedsArray(size?.bleeds),
      duplexes: this.createDuplexesArray(size?.duplexes),
      foldings: this.createFoldingsArray(size?.foldings),
      doubleSided: this.createDoubleSidedGroup(size?.doubleSided),
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
    root.querySelectorAll('.tree-branch__footer, .corners-branch__footer, .bleed-branch__footer, .folding-branch__footer, .duplex-branch__footer, .double-sided-branch__footer').forEach((footer) => {
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

    root.querySelectorAll<HTMLElement>('.corners-branch, .bleed-branch, .folding-branch, .duplex-branch, .double-sided-branch').forEach((branch) => {
      const footer = branch.querySelector<HTMLElement>('.corners-branch__footer, .bleed-branch__footer, .folding-branch__footer, .duplex-branch__footer, .double-sided-branch__footer');
      const railEnd = branch.querySelector<HTMLElement>('.corners-branch__rail-end, .bleed-branch__rail-end, .folding-branch__rail-end, .duplex-branch__rail-end, .double-sided-branch__rail-end');
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
