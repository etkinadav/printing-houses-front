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
import {
  PH_FILE_TYPE_MOCKUP,
  PH_FILE_TYPE_TEXTURE,
  PhFilesService,
} from '../../ph-files/ph-files.service';
import { isColorTextureUrl } from '../../ph-products/ph-color-texture.util';
import { PhProductsService } from '../../ph-products/ph-products.service';
import { EXPRESS_FILE_ACCEPT } from '../../utils/ph-express-upload';
import { PhUploadValidationService } from '../../utils/ph-upload-validation.service';
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
  PhMockup,
  PhMockupPoint,
  PhMockupPrintArea,
  PhMockupPrintAreaQuad,
  PhProduct,
  PhProductLabel,
  PhProductProperties,
  PhSize,
  PhTreeExtraSettings,
} from '../../ph-products/ph-product.model';

interface MockupRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MockupQuad {
  nw: PhMockupPoint;
  ne: PhMockupPoint;
  sw: PhMockupPoint;
  se: PhMockupPoint;
}

interface ProductMockupState {
  url: string;
  uploading: boolean;
  progress: number;
  penActive: boolean;
  rect: MockupRect | null;
  quad: MockupQuad | null;
}

type MockupCorner = 'nw' | 'ne' | 'sw' | 'se';

type MockupScope = ExtraSettingKey | 'node';

interface MockupPointerDrag {
  group: AbstractControl;
  scope: MockupScope;
  mode: 'draw' | 'move' | 'resize';
  corner?: MockupCorner;
  startX: number;
  startY: number;
  origRect: MockupRect | null;
  origQuad: MockupQuad | null;
}

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
  readonly expressFileAccept = EXPRESS_FILE_ACCEPT;

  private readonly positiveNumberValidators = [Validators.required, Validators.min(0)];
  private readonly colorTextureUploads = new Map<AbstractControl, Subscription>();
  colorTextureUploadProgress = new Map<AbstractControl, number>();

  /** In-memory mockup upload + print-area state keyed by form group + scope. */
  private readonly controlIds = new WeakMap<AbstractControl, number>();
  private nextControlId = 0;
  private readonly mockupStates = new Map<string, ProductMockupState>();
  private readonly mockupUploadSubs = new Map<string, Subscription>();
  /** Optional mockup slots: node-level or per extra-setting branch. */
  private readonly optionalMockupEnabled = new Set<string>();
  private mockupValidationActive = false;
  private mockupPointerDrag: MockupPointerDrag | null = null;
  private mockupPenOutsideTarget: { group: AbstractControl; scope: MockupScope } | null = null;
  private mockupPenOutsidePointerHandler: ((event: PointerEvent) => void) | null = null;
  private readonly mockupDefaultRectSize = 0.22;
  private readonly mockupMinRectSize = 0.04;
  readonly mockupQuadCorners: MockupCorner[] = ['nw', 'ne', 'sw', 'se'];

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
    private phUploadValidation: PhUploadValidationService,
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
    this.clearAllMockupStatesForGroup(this.dynamicGroup);

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
        const sizeGroup = this.createSizeGroup(size);
        this.sizes.push(sizeGroup);
        this.applyMockupFromProduct(sizeGroup, size.mockup);
      }
    } else if (product.properties.dynamic?.materials?.length) {
      this.applyMockupFromProduct(this.dynamicGroup, product.properties.dynamic.mockup);
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
    for (const sub of this.mockupUploadSubs.values()) {
      sub.unsubscribe();
    }
    this.mockupUploadSubs.clear();
    this.detachMockupPenOutsideListener();
  }

  private getControlId(group: AbstractControl): number {
    if (!group) {
      return -1;
    }
    let id = this.controlIds.get(group);
    if (id === undefined) {
      id = this.nextControlId++;
      this.controlIds.set(group, id);
    }
    return id;
  }

  private resolveMockupScope(settingKey?: ExtraSettingKey | null): MockupScope {
    return settingKey ?? 'node';
  }

  private mockupScopeKey(group: AbstractControl, scope: MockupScope = 'node'): string {
    return `${this.getControlId(group)}:${scope}`;
  }

  hasMockupUrl(group: AbstractControl, settingKey?: ExtraSettingKey | null): boolean {
    return !!this.getMockupState(group, settingKey).url.trim();
  }

  isMockupUploading(group: AbstractControl, settingKey?: ExtraSettingKey | null): boolean {
    return this.getMockupState(group, settingKey).uploading;
  }

  getMockupUploadProgress(group: AbstractControl, settingKey?: ExtraSettingKey | null): number {
    return this.getMockupState(group, settingKey).progress;
  }

  getMockupUrl(group: AbstractControl, settingKey?: ExtraSettingKey | null): string {
    return this.getMockupState(group, settingKey).url;
  }

  isRequiredMockupOwner(group: AbstractControl): boolean {
    return group === this.dynamicGroup || !!group.get('length');
  }

  usesMockupQuad(_group: AbstractControl): boolean {
    return this.flexability === 'fixed';
  }

  isOptionalMockupOwner(group: AbstractControl): boolean {
    return (
      !!group.get('color') ||
      (!!group.get('colors') && !group.get('length')) ||
      this.isExtraSettingItemGroup(group)
    );
  }

  isExtraSettingItemGroup(group: AbstractControl): boolean {
    if (group.get('type') && group.get('radius') !== undefined) {
      return true;
    }
    if (group.get('count') !== undefined && group.get('offset') !== undefined) {
      return true;
    }
    const controlKeys = Object.keys((group as FormGroup).controls ?? {});
    if (controlKeys.length === 1 && group.get('size') !== undefined) {
      return true;
    }
    if (controlKeys.length === 1 && group.get('mode') !== undefined) {
      return group.parent?.get('doubleSided') === group;
    }
    return false;
  }

  isOptionalMockupEnabled(group: AbstractControl, settingKey?: ExtraSettingKey | null): boolean {
    return this.optionalMockupEnabled.has(
      this.mockupScopeKey(group, this.resolveMockupScope(settingKey)),
    );
  }

  hasOptionalMockupConfigured(group: AbstractControl, settingKey?: ExtraSettingKey | null): boolean {
    return this.isOptionalMockupEnabled(group, settingKey) && this.hasMockupUrl(group, settingKey);
  }

  enableOptionalMockup(group: AbstractControl, settingKey: ExtraSettingKey | null, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.optionalMockupEnabled.add(this.mockupScopeKey(group, this.resolveMockupScope(settingKey)));
  }

  removeOptionalMockup(
    group: AbstractControl,
    settingKey: ExtraSettingKey | null,
    event?: Event,
  ): void {
    event?.preventDefault();
    event?.stopPropagation();
    const scope = this.resolveMockupScope(settingKey);
    this.optionalMockupEnabled.delete(this.mockupScopeKey(group, scope));
    this.clearMockupState(group, scope);
    this.refreshMockupValidationState();
  }

  triggerMockupFilePicker(
    group: AbstractControl,
    input: HTMLInputElement,
    settingKey?: ExtraSettingKey | null,
  ): void {
    if (this.isMockupUploading(group, settingKey)) {
      return;
    }
    input.click();
  }

  beginMockupReplace(
    group: AbstractControl,
    input: HTMLInputElement,
    settingKey: ExtraSettingKey | null,
    event?: Event,
  ): void {
    event?.stopPropagation();
    event?.preventDefault();
    if (this.isMockupUploading(group, settingKey)) {
      return;
    }

    this.deactivateMockupPen(group, settingKey);
    const state = this.getMockupState(group, settingKey);
    state.url = '';
    state.rect = null;
    this.refreshMockupValidationState();

    setTimeout(() => {
      if (!this.isMockupUploading(group, settingKey)) {
        input.click();
      }
    });
  }

  onMockupFileSelected(
    event: Event,
    group: AbstractControl,
    settingKey?: ExtraSettingKey | null,
  ): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) {
      return;
    }

    if (!this.phUploadValidation.validateExpressUpload(file)) {
      return;
    }

    this.cancelMockupUpload(group, settingKey);

    const state = this.getMockupState(group, settingKey);
    state.uploading = true;
    state.progress = 0;
    const scopeKey = this.mockupScopeKey(group, this.resolveMockupScope(settingKey));

    const sub = this.phFilesService.upload(PH_FILE_TYPE_MOCKUP, file).subscribe({
      next: (httpEvent) => {
        if (httpEvent.type === HttpEventType.UploadProgress) {
          const total = httpEvent.total ?? 0;
          state.progress = total ? Math.round((100 * httpEvent.loaded) / total) : 0;
          return;
        }

        if (httpEvent.type !== HttpEventType.Response || !httpEvent.body) {
          return;
        }

        const mockupUrl =
          httpEvent.body.thumbnail?.url?.trim() || httpEvent.body.original?.url?.trim() || '';

        if (!mockupUrl) {
          this.finishMockupUpload(scopeKey);
          this.snackBar.open(
            this.translateService.instant('management.product-create.mockup-upload-failed'),
            undefined,
            { duration: 4000 },
          );
          return;
        }

        this.deactivateMockupPen(group, settingKey);
        state.url = mockupUrl;
        state.rect = null;
        this.finishMockupUpload(scopeKey);
        this.refreshMockupValidationState();
      },
      error: () => {
        this.finishMockupUpload(scopeKey);
        this.snackBar.open(
          this.translateService.instant('management.product-create.mockup-upload-failed'),
          undefined,
          { duration: 4000 },
        );
      },
    });

    this.setMockupUploadSub(scopeKey, sub);
  }

  cancelMockupUpload(
    group: AbstractControl,
    settingKey?: ExtraSettingKey | null,
    event?: Event,
  ): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.finishMockupUpload(this.mockupScopeKey(group, this.resolveMockupScope(settingKey)));
  }

  isMockupPenActive(group: AbstractControl, settingKey?: ExtraSettingKey | null): boolean {
    return this.getMockupState(group, settingKey).penActive;
  }

  getMockupRect(group: AbstractControl, settingKey?: ExtraSettingKey | null): MockupRect | null {
    return this.getMockupState(group, settingKey).rect;
  }

  getMockupQuad(group: AbstractControl, settingKey?: ExtraSettingKey | null): MockupQuad | null {
    return this.getMockupState(group, settingKey).quad;
  }

  getMockupQuadSvgPoints(quad: MockupQuad): string {
    return `${quad.nw.x},${quad.nw.y} ${quad.ne.x},${quad.ne.y} ${quad.se.x},${quad.se.y} ${quad.sw.x},${quad.sw.y}`;
  }

  getMockupQuadCorner(quad: MockupQuad, corner: MockupCorner): PhMockupPoint {
    return quad[corner];
  }

  isMockupComplete(group: AbstractControl, settingKey?: ExtraSettingKey | null): boolean {
    const state = this.getMockupState(group, settingKey);
    if (!state.url.trim() || state.uploading) {
      return false;
    }
    if (this.usesMockupQuad(group)) {
      return !!state.quad && this.isMockupQuadComplete(state.quad);
    }
    const rect = state.rect;
    return !!rect && rect.width >= this.mockupMinRectSize && rect.height >= this.mockupMinRectSize;
  }

  hasMockupValidationError(
    group: AbstractControl,
    required?: boolean,
    settingKey?: ExtraSettingKey | null,
  ): boolean {
    const isRequired = required ?? this.isRequiredMockupOwner(group);
    if (!isRequired && !this.isOptionalMockupEnabled(group, settingKey)) {
      return false;
    }
    return this.mockupValidationActive && !this.isMockupComplete(group, settingKey);
  }

  enableMockupPen(group: AbstractControl, settingKey: ExtraSettingKey | null, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.getMockupState(group, settingKey).penActive = true;
    this.mockupPenOutsideTarget = {
      group,
      scope: this.resolveMockupScope(settingKey),
    };
    this.attachMockupPenOutsideListener();
  }

  deactivateMockupPen(group: AbstractControl, settingKey?: ExtraSettingKey | null): void {
    const state = this.getMockupState(group, settingKey);
    if (!state.penActive) {
      return;
    }
    state.penActive = false;
    this.mockupPointerDrag = null;
    const scope = this.resolveMockupScope(settingKey);
    if (
      this.mockupPenOutsideTarget?.group === group &&
      this.mockupPenOutsideTarget.scope === scope
    ) {
      this.mockupPenOutsideTarget = null;
      this.detachMockupPenOutsideListener();
    }
  }

  private attachMockupPenOutsideListener(): void {
    if (this.mockupPenOutsidePointerHandler) {
      return;
    }
    this.mockupPenOutsidePointerHandler = (event: PointerEvent) => {
      const target = this.mockupPenOutsideTarget;
      if (!target || !this.isMockupPenActive(target.group, target.scope === 'node' ? null : target.scope)) {
        this.detachMockupPenOutsideListener();
        return;
      }
      const el = event.target as HTMLElement;
      if (el.closest('.mockup-upload-preview__frame')) {
        return;
      }
      if (el.closest('.mockup-upload-preview__define-btn')) {
        return;
      }
      this.deactivateMockupPen(
        target.group,
        target.scope === 'node' ? null : target.scope,
      );
    };
    document.addEventListener('pointerdown', this.mockupPenOutsidePointerHandler, true);
  }

  private detachMockupPenOutsideListener(): void {
    if (!this.mockupPenOutsidePointerHandler) {
      return;
    }
    document.removeEventListener('pointerdown', this.mockupPenOutsidePointerHandler, true);
    this.mockupPenOutsidePointerHandler = null;
  }

  onMockupPointerDown(
    event: PointerEvent,
    group: AbstractControl,
    settingKey?: ExtraSettingKey | null,
  ): void {
    const scope = this.resolveMockupScope(settingKey);
    if (!this.isMockupPenActive(group, settingKey)) {
      return;
    }

    const frame = this.mockupFrameFromEvent(event);
    if (!frame) {
      return;
    }

    const point = this.mockupPointFromEvent(event, frame);
    if (!point) {
      return;
    }

    const state = this.getMockupState(group, settingKey);
    const usesQuad = this.usesMockupQuad(group);
    if (usesQuad && state.quad && this.isMockupPointInQuad(point.x, point.y, state.quad)) {
      return;
    }
    if (!usesQuad && state.rect && this.isMockupPointInRect(point.x, point.y, state.rect)) {
      return;
    }

    this.mockupPointerDrag = {
      group,
      scope,
      mode: 'draw',
      startX: point.x,
      startY: point.y,
      origRect: null,
      origQuad: null,
    };

    state.rect = { x: point.x, y: point.y, width: 0, height: 0 };
    if (usesQuad) {
      state.quad = null;
    }

    frame.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onMockupRectPointerDown(
    event: PointerEvent,
    group: AbstractControl,
    settingKey?: ExtraSettingKey | null,
  ): void {
    this.onMockupShapePointerDown(event, group, settingKey);
  }

  onMockupQuadPointerDown(
    event: PointerEvent,
    group: AbstractControl,
    settingKey?: ExtraSettingKey | null,
  ): void {
    this.onMockupShapePointerDown(event, group, settingKey);
  }

  private onMockupShapePointerDown(
    event: PointerEvent,
    group: AbstractControl,
    settingKey?: ExtraSettingKey | null,
  ): void {
    const scope = this.resolveMockupScope(settingKey);
    if (!this.isMockupPenActive(group, settingKey)) {
      return;
    }

    const frame = this.mockupFrameFromEvent(event);
    const state = this.getMockupState(group, settingKey);
    const usesQuad = this.usesMockupQuad(group);
    if (!frame || (usesQuad ? !state.quad : !state.rect)) {
      return;
    }

    const point = this.mockupPointFromEvent(event, frame);
    if (!point) {
      return;
    }

    this.mockupPointerDrag = {
      group,
      scope,
      mode: 'move',
      startX: point.x,
      startY: point.y,
      origRect: usesQuad ? null : state.rect ? { ...state.rect } : null,
      origQuad: usesQuad && state.quad ? this.cloneMockupQuad(state.quad) : null,
    };

    frame.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  }

  onMockupCornerPointerDown(
    event: PointerEvent,
    group: AbstractControl,
    corner: MockupCorner,
    settingKey?: ExtraSettingKey | null,
  ): void {
    const scope = this.resolveMockupScope(settingKey);
    if (!this.isMockupPenActive(group, settingKey)) {
      return;
    }

    const frame = this.mockupFrameFromEvent(event);
    const state = this.getMockupState(group, settingKey);
    const usesQuad = this.usesMockupQuad(group);
    if (!frame || (usesQuad ? !state.quad : !state.rect)) {
      return;
    }

    const point = this.mockupPointFromEvent(event, frame);
    if (!point) {
      return;
    }

    this.mockupPointerDrag = {
      group,
      scope,
      mode: 'resize',
      corner,
      startX: point.x,
      startY: point.y,
      origRect: usesQuad ? null : state.rect ? { ...state.rect } : null,
      origQuad: usesQuad && state.quad ? this.cloneMockupQuad(state.quad) : null,
    };

    frame.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  }

  onMockupPointerMove(
    event: PointerEvent,
    group: AbstractControl,
    settingKey?: ExtraSettingKey | null,
  ): void {
    const drag = this.mockupPointerDrag;
    const scope = this.resolveMockupScope(settingKey);
    if (!drag || drag.group !== group || drag.scope !== scope) {
      return;
    }

    const frame = this.mockupFrameFromEvent(event);
    if (!frame) {
      return;
    }

    const point = this.mockupPointFromEvent(event, frame);
    if (!point) {
      return;
    }

    const state = this.getMockupState(group, settingKey);
    const usesQuad = this.usesMockupQuad(group);

    if (drag.mode === 'draw') {
      state.rect = this.mockupRectFromPoints(drag.startX, drag.startY, point.x, point.y);
      return;
    }

    if (drag.mode === 'resize' && drag.corner) {
      if (usesQuad && drag.origQuad) {
        state.quad = this.resizeMockupQuadCorner(drag.origQuad, drag.corner, point);
      } else if (drag.origRect) {
        state.rect = this.mockupResizeRect(drag.origRect, drag.corner, point);
      }
      return;
    }

    if (drag.mode === 'move') {
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      if (usesQuad && drag.origQuad) {
        state.quad = this.moveMockupQuad(drag.origQuad, dx, dy);
      } else if (drag.origRect) {
        state.rect = {
          ...drag.origRect,
          x: this.clampMockupCoord(drag.origRect.x + dx, 0, 1 - drag.origRect.width),
          y: this.clampMockupCoord(drag.origRect.y + dy, 0, 1 - drag.origRect.height),
        };
      }
    }
  }

  onMockupPointerUp(
    event: PointerEvent,
    group: AbstractControl,
    settingKey?: ExtraSettingKey | null,
  ): void {
    const drag = this.mockupPointerDrag;
    const scope = this.resolveMockupScope(settingKey);
    if (!drag || drag.group !== group || drag.scope !== scope) {
      return;
    }

    const frame = this.mockupFrameFromEvent(event);
    frame?.releasePointerCapture(event.pointerId);

    const state = this.getMockupState(group, settingKey);
    const usesQuad = this.usesMockupQuad(group);

    if ((drag.mode === 'resize' || drag.mode === 'move') && !usesQuad && state.rect) {
      state.rect = this.normalizeMockupRect(state.rect);
    }

    if (drag.mode === 'draw' && state.rect) {
      if (
        state.rect.width < this.mockupMinRectSize &&
        state.rect.height < this.mockupMinRectSize
      ) {
        const half = this.mockupDefaultRectSize / 2;
        state.rect = {
          x: this.clampMockupCoord(drag.startX - half, 0, 1 - this.mockupDefaultRectSize),
          y: this.clampMockupCoord(drag.startY - half, 0, 1 - this.mockupDefaultRectSize),
          width: this.mockupDefaultRectSize,
          height: this.mockupDefaultRectSize,
        };
      } else {
        state.rect = this.normalizeMockupRect(state.rect);
      }

      if (usesQuad) {
        state.quad = this.mockupQuadFromRect(state.rect);
        state.rect = null;
      }
    }

    this.mockupPointerDrag = null;
    this.refreshMockupValidationState();
  }

  private getMockupState(
    group: AbstractControl,
    settingKey?: ExtraSettingKey | null,
  ): ProductMockupState {
    const key = this.mockupScopeKey(group, this.resolveMockupScope(settingKey));
    let state = this.mockupStates.get(key);
    if (!state) {
      state = this.createEmptyMockupState();
      this.mockupStates.set(key, state);
    }
    return state;
  }

  private clearMockupState(group: AbstractControl, scope: MockupScope = 'node'): void {
    this.deactivateMockupPen(group, scope === 'node' ? null : scope);
    const key = this.mockupScopeKey(group, scope);
    this.mockupStates.delete(key);
    this.optionalMockupEnabled.delete(key);
    this.finishMockupUpload(key);
  }

  private clearExtraSettingItemMockups(group: AbstractControl, key: ExtraSettingKey): void {
    if (key === 'corners') {
      for (const item of this.getCorners(group).controls) {
        this.clearMockupState(item);
      }
      return;
    }
    if (key === 'bleed') {
      for (const item of this.getBleeds(group).controls) {
        this.clearMockupState(item);
      }
      return;
    }
    if (key === 'folding') {
      for (const item of this.getFoldings(group).controls) {
        this.clearMockupState(item);
      }
      return;
    }
    if (key === 'duplex') {
      for (const item of this.getDuplexes(group).controls) {
        this.clearMockupState(item);
      }
      return;
    }
    if (key === 'double-sided') {
      this.clearMockupState(group.get('doubleSided')!);
    }
  }

  private clearAllMockupStatesForGroup(group: AbstractControl): void {
    const prefix = `${this.getControlId(group)}:`;
    for (const key of [...this.mockupStates.keys()]) {
      if (key.startsWith(prefix)) {
        this.mockupStates.delete(key);
        this.optionalMockupEnabled.delete(key);
        this.finishMockupUpload(key);
      }
    }
  }

  private cloneAllMockupStates(from: AbstractControl, to: AbstractControl): void {
    const fromPrefix = `${this.getControlId(from)}:`;
    const toPrefix = `${this.getControlId(to)}:`;
    for (const [key, state] of this.mockupStates.entries()) {
      if (!key.startsWith(fromPrefix)) {
        continue;
      }
      const suffix = key.slice(fromPrefix.length);
      const newKey = `${toPrefix}${suffix}`;
      this.mockupStates.set(newKey, {
        url: state.url,
        uploading: false,
        progress: 0,
        penActive: false,
        rect: state.rect ? { ...state.rect } : null,
        quad: state.quad ? this.cloneMockupQuad(state.quad) : null,
      });
      if (this.optionalMockupEnabled.has(key)) {
        this.optionalMockupEnabled.add(newKey);
      }
    }
  }

  private createEmptyMockupState(): ProductMockupState {
    return { url: '', uploading: false, progress: 0, penActive: false, rect: null, quad: null };
  }

  private mockupFrameFromEvent(event: PointerEvent): HTMLElement | null {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return null;
    }
    return target.closest('.mockup-upload-preview__frame') as HTMLElement | null;
  }

  private mockupResizeRect(
    orig: MockupRect,
    corner: MockupCorner,
    point: { x: number; y: number },
  ): MockupRect {
    const right = orig.x + orig.width;
    const bottom = orig.y + orig.height;
    let x = orig.x;
    let y = orig.y;
    let width = orig.width;
    let height = orig.height;

    switch (corner) {
      case 'nw':
        x = point.x;
        y = point.y;
        width = right - x;
        height = bottom - y;
        break;
      case 'ne':
        y = point.y;
        width = point.x - orig.x;
        height = bottom - y;
        break;
      case 'sw':
        x = point.x;
        width = right - x;
        height = point.y - orig.y;
        break;
      case 'se':
        width = point.x - orig.x;
        height = point.y - orig.y;
        break;
    }

    if (width < 0) {
      x += width;
      width = -width;
    }
    if (height < 0) {
      y += height;
      height = -height;
    }

    return this.normalizeMockupRect({ x, y, width, height });
  }

  private mockupPointFromEvent(
    event: PointerEvent,
    frame: HTMLElement,
  ): { x: number; y: number } | null {
    const bounds = frame.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      return null;
    }
    return {
      x: this.clampMockupCoord((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: this.clampMockupCoord((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
  }

  private mockupRectFromPoints(x1: number, y1: number, x2: number, y2: number): MockupRect {
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    return this.normalizeMockupRect({ x, y, width, height });
  }

  private normalizeMockupRect(rect: MockupRect): MockupRect {
    const width = this.clampMockupCoord(rect.width, this.mockupMinRectSize, 1);
    const height = this.clampMockupCoord(rect.height, this.mockupMinRectSize, 1);
    return {
      x: this.clampMockupCoord(rect.x, 0, 1 - width),
      y: this.clampMockupCoord(rect.y, 0, 1 - height),
      width,
      height,
    };
  }

  private isMockupPointInRect(x: number, y: number, rect: MockupRect): boolean {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  }

  private cloneMockupQuad(quad: MockupQuad): MockupQuad {
    return {
      nw: { ...quad.nw },
      ne: { ...quad.ne },
      sw: { ...quad.sw },
      se: { ...quad.se },
    };
  }

  private mockupQuadFromRect(rect: MockupRect): MockupQuad {
    return {
      nw: { x: rect.x, y: rect.y },
      ne: { x: rect.x + rect.width, y: rect.y },
      sw: { x: rect.x, y: rect.y + rect.height },
      se: { x: rect.x + rect.width, y: rect.y + rect.height },
    };
  }

  private mockupBoundingBoxFromQuad(quad: MockupQuad): MockupRect {
    const xs = [quad.nw.x, quad.ne.x, quad.sw.x, quad.se.x];
    const ys = [quad.nw.y, quad.ne.y, quad.sw.y, quad.se.y];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x,
      y,
      width: Math.max(...xs) - x,
      height: Math.max(...ys) - y,
    };
  }

  private mockupQuadArea(quad: MockupQuad): number {
    const pts = [quad.nw, quad.ne, quad.se, quad.sw];
    let sum = 0;
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(sum) / 2;
  }

  private isMockupQuadComplete(quad: MockupQuad): boolean {
    const box = this.mockupBoundingBoxFromQuad(quad);
    if (box.width < this.mockupMinRectSize || box.height < this.mockupMinRectSize) {
      return false;
    }
    return this.mockupQuadArea(quad) >= this.mockupMinRectSize * this.mockupMinRectSize;
  }

  private isMockupPointInQuad(x: number, y: number, quad: MockupQuad): boolean {
    const pts = [quad.nw, quad.ne, quad.se, quad.sw];
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i, i += 1) {
      const xi = pts[i].x;
      const yi = pts[i].y;
      const xj = pts[j].x;
      const yj = pts[j].y;
      const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
  }

  private moveMockupQuad(orig: MockupQuad, dx: number, dy: number): MockupQuad {
    const corners: MockupCorner[] = ['nw', 'ne', 'sw', 'se'];
    let maxDxPos = Infinity;
    let maxDxNeg = -Infinity;
    let maxDyPos = Infinity;
    let maxDyNeg = -Infinity;

    for (const corner of corners) {
      const point = orig[corner];
      maxDxPos = Math.min(maxDxPos, 1 - point.x);
      maxDxNeg = Math.max(maxDxNeg, -point.x);
      maxDyPos = Math.min(maxDyPos, 1 - point.y);
      maxDyNeg = Math.max(maxDyNeg, -point.y);
    }

    const clampedDx = this.clampMockupCoord(dx, maxDxNeg, maxDxPos);
    const clampedDy = this.clampMockupCoord(dy, maxDyNeg, maxDyPos);

    return {
      nw: { x: orig.nw.x + clampedDx, y: orig.nw.y + clampedDy },
      ne: { x: orig.ne.x + clampedDx, y: orig.ne.y + clampedDy },
      sw: { x: orig.sw.x + clampedDx, y: orig.sw.y + clampedDy },
      se: { x: orig.se.x + clampedDx, y: orig.se.y + clampedDy },
    };
  }

  private resizeMockupQuadCorner(
    orig: MockupQuad,
    corner: MockupCorner,
    point: PhMockupPoint,
  ): MockupQuad {
    return {
      ...orig,
      [corner]: {
        x: this.clampMockupCoord(point.x, 0, 1),
        y: this.clampMockupCoord(point.y, 0, 1),
      },
    };
  }

  private isQuadPrintArea(area: PhMockupPrintArea): area is PhMockupPrintAreaQuad {
    return area.shape === 'quad';
  }

  private normalizeMockupQuadFromPrintArea(area: PhMockupPrintArea): MockupQuad | null {
    if (this.isQuadPrintArea(area)) {
      return {
        nw: { x: area.nw.x, y: area.nw.y },
        ne: { x: area.ne.x, y: area.ne.y },
        sw: { x: area.sw.x, y: area.sw.y },
        se: { x: area.se.x, y: area.se.y },
      };
    }
    if (
      Number.isFinite(area.x)
      && Number.isFinite(area.y)
      && Number.isFinite(area.width)
      && Number.isFinite(area.height)
    ) {
      return this.mockupQuadFromRect({
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
      });
    }
    return null;
  }

  private clampMockupCoord(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private setMockupUploadSub(scopeKey: string, sub: Subscription): void {
    this.mockupUploadSubs.set(scopeKey, sub);
  }

  private finishMockupUpload(scopeKey: string): void {
    const state = this.mockupStates.get(scopeKey);
    if (state) {
      state.uploading = false;
      state.progress = 0;
    }
    this.mockupUploadSubs.get(scopeKey)?.unsubscribe();
    this.mockupUploadSubs.delete(scopeKey);
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

    if (!this.phUploadValidation.validateExpressUpload(file)) {
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
    const next = this.cloneMaterialGroup(last, withDimensions);
    this.cloneAllMockupStates(last, next);
    materials.push(next);
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
    const next = this.cloneColorGroup(last);
    this.cloneAllMockupStates(last, next);
    colors.push(next);
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
      this.clearExtraSettingItemMockups(group, key);
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
    const corners = this.getCorners(group);
    const last = corners.at(corners.length - 1);
    const next = this.cloneCornerGroup(last);
    corners.push(next);
    this.cloneAllMockupStates(last, next);
    this.syncTreeExtraValidators(group);
    this.scheduleRailSync();
  }

  removeCorner(group: AbstractControl, index: number): void {
    const corners = this.getCorners(group);
    if (corners.length <= 1) {
      this.clearMockupState(corners.at(0));
      corners.clear();
      this.uncheckExtraSetting(group, 'corners');
      this.scheduleRailSync();
      return;
    }
    this.clearMockupState(corners.at(index));
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
    const next = this.cloneBleedGroup(last);
    bleeds.push(next);
    this.cloneAllMockupStates(last, next);
    this.syncTreeExtraValidators(group);
    this.scheduleRailSync();
  }

  removeBleed(group: AbstractControl, index: number): void {
    const bleeds = this.getBleeds(group);
    if (bleeds.length <= 1) {
      this.clearMockupState(bleeds.at(0));
      bleeds.clear();
      this.uncheckExtraSetting(group, 'bleed');
      this.scheduleRailSync();
      return;
    }
    this.clearMockupState(bleeds.at(index));
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
    const next = this.cloneDuplexGroup(last);
    duplexes.push(next);
    this.cloneAllMockupStates(last, next);
    this.syncTreeExtraValidators(group);
    this.scheduleRailSync();
  }

  removeDuplex(group: AbstractControl, index: number): void {
    const duplexes = this.getDuplexes(group);
    if (duplexes.length <= 1) {
      this.clearMockupState(duplexes.at(0));
      duplexes.clear();
      this.uncheckExtraSetting(group, 'duplex');
      this.scheduleRailSync();
      return;
    }
    this.clearMockupState(duplexes.at(index));
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
    const next = this.cloneFoldingGroup(last);
    foldings.push(next);
    this.cloneAllMockupStates(last, next);
    this.syncTreeExtraValidators(group);
    this.scheduleRailSync();
  }

  removeFolding(group: AbstractControl, index: number): void {
    const foldings = this.getFoldings(group);
    if (foldings.length <= 1) {
      this.clearMockupState(foldings.at(0));
      foldings.clear();
      this.uncheckExtraSetting(group, 'folding');
      this.scheduleRailSync();
      return;
    }
    this.clearMockupState(foldings.at(index));
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
    this.syncDynamicMaterialDimensionValidators();
    if (this.form.invalid || this.isSaving) {
      this.form.markAllAsTouched();
      return;
    }

    const mockupError = this.validateMockupsBeforeSave();
    if (mockupError) {
      this.mockupValidationActive = true;
      this.snackBar.open(mockupError, undefined, { duration: 5000 });
      this.scrollToFirstMockupError();
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

  private validateMockupsBeforeSave(): string | null {
    if (this.flexability === 'fixed') {
      for (const sizeGroup of this.sizes.controls) {
        if (!this.isMockupComplete(sizeGroup)) {
          const name = this.getSizeDisplayName(sizeGroup);
          return name
            ? this.translateService.instant('management.product-create.mockup-required-for-size', {
                name,
              })
            : this.translateService.instant('management.product-create.mockup-required-fixed');
        }
      }
      return this.validateOptionalMockupsBeforeSave();
    }

    if (!this.isMockupComplete(this.dynamicGroup)) {
      return this.translateService.instant('management.product-create.mockup-required-dynamic');
    }

    return this.validateOptionalMockupsBeforeSave();
  }

  private validateExtraSettingItemMockups(
    group: AbstractControl,
    nodeName: string,
  ): string | null {
    const checkItem = (item: AbstractControl, itemLabel: string): string | null => {
      if (this.isOptionalMockupEnabled(item, null) && !this.isMockupComplete(item, null)) {
        return this.translateService.instant('management.product-create.mockup-incomplete-setting', {
          name: `${nodeName} / ${itemLabel}`,
        });
      }
      return null;
    };

    const selected = (group.get('extraSettings')?.value as ExtraSettingKey[]) ?? [];

    if (selected.includes('corners')) {
      for (let i = 0; i < this.getCorners(group).length; i += 1) {
        const error = checkItem(
          this.getCorners(group).at(i),
          this.translateService.instant('management.product-create.corner-number', { n: i + 1 }),
        );
        if (error) {
          return error;
        }
      }
    }

    if (selected.includes('bleed')) {
      for (let i = 0; i < this.getBleeds(group).length; i += 1) {
        const error = checkItem(
          this.getBleeds(group).at(i),
          this.translateService.instant('management.product-create.bleed-number', { n: i + 1 }),
        );
        if (error) {
          return error;
        }
      }
    }

    if (selected.includes('folding')) {
      for (let i = 0; i < this.getFoldings(group).length; i += 1) {
        const error = checkItem(
          this.getFoldings(group).at(i),
          this.translateService.instant('management.product-create.folding-number', { n: i + 1 }),
        );
        if (error) {
          return error;
        }
      }
    }

    if (selected.includes('duplex')) {
      for (let i = 0; i < this.getDuplexes(group).length; i += 1) {
        const error = checkItem(
          this.getDuplexes(group).at(i),
          this.translateService.instant('management.product-create.duplex-number', { n: i + 1 }),
        );
        if (error) {
          return error;
        }
      }
    }

    if (selected.includes('double-sided')) {
      const label = this.translateService.instant(
        'management.product-create.extra-settings.double-sided',
      );
      return checkItem(this.getDoubleSided(group), label);
    }

    return null;
  }

  private validateOptionalMockupsBeforeSave(): string | null {
    const validateNode = (group: AbstractControl, nodeName: string): string | null => {
      if (
        this.isOptionalMockupOwner(group) &&
        this.isOptionalMockupEnabled(group, null) &&
        !this.isMockupComplete(group, null)
      ) {
        const labelKey = group.get('color')
          ? 'management.product-create.mockup-incomplete-color'
          : 'management.product-create.mockup-incomplete-material';
        return this.translateService.instant(labelKey, { name: nodeName });
      }

      return this.validateExtraSettingItemMockups(group, nodeName);
    };

    const walkMaterials = (materials: FormArray): string | null => {
      for (let mi = 0; mi < materials.length; mi += 1) {
        const material = materials.at(mi);
        const materialName =
          String(material.get('label.he')?.value ?? '').trim() ||
          this.translateService.instant('management.product-create.material-number', { n: mi + 1 });

        const materialError = validateNode(material, materialName);
        if (materialError) {
          return materialError;
        }

        const colors = this.getColors(material);
        for (let ci = 0; ci < colors.length; ci += 1) {
          const color = colors.at(ci);
          const colorName =
            String(color.get('label.he')?.value ?? '').trim() ||
            this.translateService.instant('management.product-create.color-number', { n: ci + 1 });

          const colorError = validateNode(color, `${materialName} / ${colorName}`);
          if (colorError) {
            return colorError;
          }
        }
      }
      return null;
    };

    if (this.flexability === 'fixed') {
      for (const sizeGroup of this.sizes.controls) {
        const sizeName =
          this.getSizeDisplayName(sizeGroup) ||
          this.translateService.instant('management.product-create.size-number', { n: 1 });
        const sizeError = validateNode(sizeGroup, sizeName);
        if (sizeError) {
          return sizeError;
        }

        const error = walkMaterials(this.getMaterials(sizeGroup));
        if (error) {
          return error;
        }
      }
      return null;
    }

    return walkMaterials(this.dynamicMaterials);
  }

  private getSizeDisplayName(sizeGroup: AbstractControl): string {
    const labelHe = String(sizeGroup.get('label.he')?.value ?? '').trim();
    if (labelHe) {
      return labelHe;
    }

    const length = sizeGroup.get('length')?.value;
    const width = sizeGroup.get('width')?.value;
    if (length != null && width != null && `${length}`.trim() && `${width}`.trim()) {
      return `${length}×${width}`;
    }

    return '';
  }

  private refreshMockupValidationState(): void {
    if (!this.mockupValidationActive) {
      return;
    }

    if (this.flexability === 'fixed') {
      if (this.sizes.controls.every((sizeGroup) => this.isMockupComplete(sizeGroup))) {
        this.mockupValidationActive = false;
      }
      return;
    }

    if (this.isMockupComplete(this.dynamicGroup)) {
      this.mockupValidationActive = false;
    }
  }

  private scrollToFirstMockupError(): void {
    setTimeout(() => {
      document
        .querySelector('.mockup-upload-section--error')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        mockup: this.readMockupForSave(this.dynamicGroup),
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
      mockup: this.readMockupForSave(sizeGroup),
      ...this.readTreeExtras(sizeGroup),
    };
  }

  private readMockupForSave(
    group: AbstractControl,
    settingKey?: ExtraSettingKey | null,
  ): PhMockup {
    const state = this.getMockupState(group, settingKey);
    if (this.usesMockupQuad(group)) {
      const quad = state.quad!;
      return {
        url: state.url.trim(),
        printArea: {
          shape: 'quad',
          nw: { ...quad.nw },
          ne: { ...quad.ne },
          sw: { ...quad.sw },
          se: { ...quad.se },
        },
      };
    }

    const rect = state.rect!;
    return {
      url: state.url.trim(),
      printArea: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  }

  private readOptionalMockupForSave(group: AbstractControl): PhMockup | undefined {
    if (!this.isOptionalMockupEnabled(group, null) || !this.isMockupComplete(group, null)) {
      return undefined;
    }
    return this.readMockupForSave(group, null);
  }

  private applyMockupFromProduct(
    group: AbstractControl,
    mockup?: PhMockup,
    settingKey: ExtraSettingKey | null = null,
  ): void {
    if (!mockup?.url?.trim() || !mockup.printArea) {
      return;
    }

    const scope = this.resolveMockupScope(settingKey);
    const state = this.getMockupState(group, settingKey);
    state.url = mockup.url.trim();
    state.penActive = false;
    state.uploading = false;
    state.progress = 0;

    if (this.usesMockupQuad(group)) {
      state.quad = this.normalizeMockupQuadFromPrintArea(mockup.printArea);
      state.rect = null;
    } else {
      const area = mockup.printArea;
      if (!this.isQuadPrintArea(area)) {
        state.rect = {
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
        };
      }
      state.quad = null;
    }

    if (settingKey !== null || this.isOptionalMockupOwner(group)) {
      this.optionalMockupEnabled.add(this.mockupScopeKey(group, scope));
    }
  }

  private readItemWithOptionalMockup<T extends Record<string, unknown>>(
    itemGroup: AbstractControl,
    fields: T,
  ): T & { mockup?: PhMockup } {
    const mockup = this.readOptionalMockupForSave(itemGroup);
    return mockup ? { ...fields, mockup } : fields;
  }

  private readDynamicMaterials(materials: FormArray): PhDynamicMaterial[] {
    return materials.controls.map((materialGroup) => {
      const mockup = this.readOptionalMockupForSave(materialGroup);
      return {
        weight: this.readNumericOrNull(materialGroup.get('weight')),
        label: this.readMaterialLabelForSave(materialGroup, materials),
        minLength: Number(materialGroup.get('minLength')!.value),
        maxLength: Number(materialGroup.get('maxLength')!.value),
        minHeight: Number(materialGroup.get('minHeight')!.value),
        maxHeight: Number(materialGroup.get('maxHeight')!.value),
        defaultLength: Number(materialGroup.get('defaultLength')!.value),
        defaultHeight: Number(materialGroup.get('defaultHeight')!.value),
        colors: this.readColors(materialGroup),
        ...(mockup ? { mockup } : {}),
        ...this.readTreeExtras(materialGroup),
      };
    });
  }

  private readMaterials(materials: FormArray): PhMaterial[] {
    return materials.controls.map((materialGroup) => {
      const mockup = this.readOptionalMockupForSave(materialGroup);
      return {
        weight: this.readNumericOrNull(materialGroup.get('weight')),
        label: this.readLabel(materialGroup.get('label')!),
        colors: this.readColors(materialGroup),
        ...(mockup ? { mockup } : {}),
        ...this.readTreeExtras(materialGroup),
      };
    });
  }

  private readColors(materialGroup: AbstractControl): PhColor[] {
    return this.getColors(materialGroup).controls.map((colorGroup) => {
      const mockup = this.readOptionalMockupForSave(colorGroup);
      return {
        color: String(colorGroup.get('color')!.value),
        label: this.readLabel(colorGroup.get('label')!),
        ...(mockup ? { mockup } : {}),
        ...this.readTreeExtras(colorGroup),
      };
    });
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
      extras.corners = this.getCorners(group).controls.map((cornerGroup) =>
        this.readItemWithOptionalMockup(cornerGroup, {
          type: cornerGroup.get('type')!.value as CornerType,
          radius: this.readNumericOrNull(cornerGroup.get('radius')),
        }),
      ) as PhCorner[];
    }

    if (selected.includes('bleed')) {
      extras.bleedSetting = this.readExtraSettingMode(group, 'bleedSetting');
      extras.bleeds = this.getBleeds(group).controls.map((bleedGroup) =>
        this.readItemWithOptionalMockup(bleedGroup, {
          size: this.readNumericOrNull(bleedGroup.get('size')),
        }),
      ) as PhBleed[];
    }

    if (selected.includes('folding')) {
      extras.foldingSetting = this.readExtraSettingMode(group, 'foldingSetting');
      extras.foldings = this.getFoldings(group).controls.map((foldingGroup) =>
        this.readItemWithOptionalMockup(foldingGroup, {
          count: Number(foldingGroup.get('count')!.value),
          offset: this.readNumericOrNull(foldingGroup.get('offset')),
        }),
      ) as PhFolding[];
    }

    if (selected.includes('duplex')) {
      extras.duplexSetting = this.readExtraSettingMode(group, 'duplexSetting');
      extras.duplexes = this.getDuplexes(group).controls.map((duplexGroup) =>
        this.readItemWithOptionalMockup(duplexGroup, {
          size: this.readNumericOrNull(duplexGroup.get('size')),
        }),
      ) as PhDuplex[];
    }

    if (selected.includes('double-sided')) {
      extras.doubleSided = this.readItemWithOptionalMockup(this.getDoubleSided(group), {
        ...this.readExtraSettingMode(group, 'doubleSided'),
      });
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

  private syncDynamicMaterialDimensionValidators(): void {
    for (const materialGroup of this.dynamicMaterials.controls) {
      this.applyDynamicMaterialDimensionErrors(materialGroup as FormGroup);
    }
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  private attachDynamicMaterialDimensionValidation(group: FormGroup): void {
    const dimensionKeys = [
      'minLength',
      'maxLength',
      'minHeight',
      'maxHeight',
      'defaultLength',
      'defaultHeight',
    ] as const;

    for (const key of dimensionKeys) {
      group.get(key)?.valueChanges.subscribe(() => {
        this.applyDynamicMaterialDimensionErrors(group);
      });
    }

    this.applyDynamicMaterialDimensionErrors(group);
  }

  private applyDynamicMaterialDimensionErrors(group: FormGroup): void {
    const clearKeyError = (controlName: string, errorKey: string) => {
      const control = group.get(controlName);
      if (!control?.errors?.[errorKey]) {
        return;
      }
      const nextErrors = { ...control.errors };
      delete nextErrors[errorKey];
      control.setErrors(Object.keys(nextErrors).length ? nextErrors : null);
    };

    for (const controlName of [
      'maxLength',
      'maxHeight',
      'defaultLength',
      'defaultHeight',
    ]) {
      clearKeyError(controlName, 'maxNotGreater');
      clearKeyError(controlName, 'defaultOutOfRange');
    }

    const minLength = Number(group.get('minLength')?.value);
    const maxLength = Number(group.get('maxLength')?.value);
    const minHeight = Number(group.get('minHeight')?.value);
    const maxHeight = Number(group.get('maxHeight')?.value);
    const defaultLength = Number(group.get('defaultLength')?.value);
    const defaultHeight = Number(group.get('defaultHeight')?.value);

    const hasLengthBounds =
      !Number.isNaN(minLength) && !Number.isNaN(maxLength);
    const hasHeightBounds =
      !Number.isNaN(minHeight) && !Number.isNaN(maxHeight);

    if (hasLengthBounds && maxLength <= minLength) {
      const maxControl = group.get('maxLength');
      maxControl?.setErrors({ ...(maxControl.errors || {}), maxNotGreater: true });
    }

    if (hasHeightBounds && maxHeight <= minHeight) {
      const maxControl = group.get('maxHeight');
      maxControl?.setErrors({ ...(maxControl.errors || {}), maxNotGreater: true });
    }

    if (
      hasLengthBounds &&
      !Number.isNaN(defaultLength) &&
      (defaultLength < minLength || defaultLength > maxLength)
    ) {
      const defaultControl = group.get('defaultLength');
      defaultControl?.setErrors({
        ...(defaultControl.errors || {}),
        defaultOutOfRange: true,
      });
    }

    if (
      hasHeightBounds &&
      !Number.isNaN(defaultHeight) &&
      (defaultHeight < minHeight || defaultHeight > maxHeight)
    ) {
      const defaultControl = group.get('defaultHeight');
      defaultControl?.setErrors({
        ...(defaultControl.errors || {}),
        defaultOutOfRange: true,
      });
    }

    group.updateValueAndValidity({ emitEvent: false });
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
    corners?: Array<{ type: CornerType; radius: number | null; mockup?: PhMockup }>,
  ): FormArray<FormGroup> {
    if (!corners?.length) {
      return new FormArray<FormGroup>([]);
    }
    return new FormArray<FormGroup>(corners.map((corner) => this.createCornerGroup(corner)));
  }

  private createCornerGroup(
    corner?: Partial<{ type: CornerType; radius: number | null; mockup?: PhMockup }>,
  ): FormGroup {
    const group = new FormGroup({
      type: new FormControl<CornerType>(corner?.type ?? 'rounded', { nonNullable: true }),
      radius: new FormControl<number | null>(corner?.radius ?? null),
    });
    this.applyMockupFromProduct(group, corner?.mockup, null);
    return group;
  }

  private cloneCornerGroup(source: AbstractControl): FormGroup {
    return this.createCornerGroup(source.getRawValue());
  }

  private createBleedsArray(
    bleeds?: Array<{ size: number | null; mockup?: PhMockup }>,
  ): FormArray<FormGroup> {
    if (!bleeds?.length) {
      return new FormArray<FormGroup>([]);
    }
    return new FormArray<FormGroup>(bleeds.map((bleed) => this.createBleedGroup(bleed)));
  }

  private createBleedGroup(bleed?: Partial<{ size: number | null; mockup?: PhMockup }>): FormGroup {
    const group = new FormGroup({
      size: new FormControl<number | null>(bleed?.size ?? null),
    });
    this.applyMockupFromProduct(group, bleed?.mockup, null);
    return group;
  }

  private cloneBleedGroup(source: AbstractControl): FormGroup {
    return this.createBleedGroup(source.getRawValue());
  }

  private createDuplexesArray(
    duplexes?: Array<{ size: number | null; mockup?: PhMockup }>,
  ): FormArray<FormGroup> {
    if (!duplexes?.length) {
      return new FormArray<FormGroup>([]);
    }
    return new FormArray<FormGroup>(duplexes.map((duplex) => this.createDuplexGroup(duplex)));
  }

  private createDuplexGroup(duplex?: Partial<{ size: number | null; mockup?: PhMockup }>): FormGroup {
    const group = new FormGroup({
      size: new FormControl<number | null>(duplex?.size ?? null),
    });
    this.applyMockupFromProduct(group, duplex?.mockup, null);
    return group;
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
    doubleSided?: Partial<{ mode: ExtraSettingMode; mockup?: PhMockup }>,
  ): FormGroup {
    const group = this.createExtraSettingModeGroup(doubleSided);
    this.applyMockupFromProduct(group, doubleSided?.mockup, null);
    return group;
  }

  private createFoldingsArray(
    foldings?: Array<{ count: number; offset: number | null; mockup?: PhMockup }>,
  ): FormArray<FormGroup> {
    if (!foldings?.length) {
      return new FormArray<FormGroup>([]);
    }
    return new FormArray<FormGroup>(foldings.map((folding) => this.createFoldingGroup(folding)));
  }

  private createFoldingGroup(
    folding?: Partial<{ count: number; offset: number | null; mockup?: PhMockup }>,
  ): FormGroup {
    const group = new FormGroup({
      count: new FormControl<number>(folding?.count ?? 1, { nonNullable: true }),
      offset: new FormControl<number | null>(folding?.offset ?? null),
    });
    this.applyMockupFromProduct(group, folding?.mockup, null);
    return group;
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
      mockup?: PhMockup;
    }>,
  ): FormGroup {
    const group = new FormGroup({
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
    this.applyMockupFromProduct(group, color?.mockup, null);
    return group;
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
      weight?: number | null;
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
      mockup?: PhMockup;
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

    const group = new FormGroup({
      weight: new FormControl<number | null>(material?.weight ?? null, [Validators.min(0)]),
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
    this.applyMockupFromProduct(group, material?.mockup, null);
    return group;
  }

  private createDynamicMaterialGroup(
    material?: Partial<{
      weight?: number | null;
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
      mockup?: PhMockup;
      minLength: number | null;
      maxLength: number | null;
      minHeight: number | null;
      maxHeight: number | null;
      defaultLength?: number | null;
      defaultHeight?: number | null;
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
    const resolvedDefaultLength =
      material?.defaultLength ?? material?.minLength ?? null;
    const resolvedDefaultHeight =
      material?.defaultHeight ?? material?.minHeight ?? null;
    const colors = material?.colors?.length
      ? new FormArray<FormGroup>(material.colors.map((color) => this.createColorGroup(color)))
      : new FormArray<FormGroup>([this.createColorGroup()]);

    const group = new FormGroup({
      weight: new FormControl<number | null>(material?.weight ?? null, [Validators.min(0)]),
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
      defaultLength: new FormControl<number | null>(resolvedDefaultLength, dimValidators),
      defaultHeight: new FormControl<number | null>(resolvedDefaultHeight, dimValidators),
      colors,
    });

    this.attachDynamicMaterialDimensionValidation(group);
    this.applyMockupFromProduct(group, material?.mockup, null);
    return group;
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
      doubleSided?: Partial<{ mode: ExtraSettingMode; mockup?: PhMockup }>;
      mockup?: PhMockup;
      materials: Array<{
        weight?: number | null;
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

    const group = new FormGroup({
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
    this.applyMockupFromProduct(group, size?.mockup, null);
    return group;
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
