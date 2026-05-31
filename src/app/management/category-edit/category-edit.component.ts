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
import { Subscription } from 'rxjs';

import { DirectionService } from '../../direction.service';
import { PhCategoriesService } from '../../ph-categories/ph-categories.service';
import { PhCategory, SyncCategoryPayload } from '../../ph-categories/ph-category.model';

type CategoryFormLabel = { he?: string };

type CategoryFormSubCategory = {
  key?: string;
  label?: CategoryFormLabel;
};

type CategoryFormInput = {
  _id?: string | null;
  key?: string;
  label?: CategoryFormLabel;
  subCategories?: CategoryFormSubCategory[];
};

@Component({
  selector: 'app-category-edit',
  templateUrl: './category-edit.component.html',
  styleUrls: ['./category-edit.component.css'],
  host: {
    class: 'fill-screen',
  },
})
export class CategoryEditComponent implements OnInit, OnDestroy, AfterViewInit {
  isRTL = true;
  isDarkMode = false;
  isLoading = true;
  isSaving = false;
  private deletedCategoryIds: string[] = [];
  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private railResizeObserver?: ResizeObserver;

  form = new FormGroup({
    categories: new FormArray<FormGroup>([]),
  });

  constructor(
    private phCategoriesService: PhCategoriesService,
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

    this.loadCategories();
  }

  ngOnDestroy(): void {
    this.directionSub?.unsubscribe();
    this.darkModeSub?.unsubscribe();
    this.railResizeObserver?.disconnect();
  }

  ngAfterViewInit(): void {
    this.railResizeObserver = new ResizeObserver(() => this.syncTreeRailHeights());
    this.observeTreeRailFooters();
    this.scheduleRailSync();
  }

  get categories(): FormArray<FormGroup> {
    return this.form.controls.categories;
  }

  getSubCategories(categoryGroup: AbstractControl): FormArray<FormGroup> {
    return categoryGroup.get('subCategories') as FormArray<FormGroup>;
  }

  addCategory(): void {
    const last = this.categories.at(this.categories.length - 1);
    this.categories.push(this.cloneCategoryGroup(last));
    this.scheduleRailSync();
  }

  removeCategory(index: number): void {
    if (this.categories.length <= 1) {
      return;
    }

    const categoryId = this.categories.at(index).get('_id')?.value as string | null;
    if (categoryId) {
      this.deletedCategoryIds.push(categoryId);
    }

    this.categories.removeAt(index);
    this.scheduleRailSync();
  }

  addSubCategory(categoryGroup: AbstractControl): void {
    const subCategories = this.getSubCategories(categoryGroup);
    const last = subCategories.at(subCategories.length - 1);
    subCategories.push(this.cloneSubCategoryGroup(last));
    this.scheduleRailSync();
  }

  removeSubCategory(categoryGroup: AbstractControl, index: number): void {
    const subCategories = this.getSubCategories(categoryGroup);
    if (subCategories.length <= 1) {
      return;
    }

    subCategories.removeAt(index);
    this.scheduleRailSync();
  }

  onSave(): void {
    if (this.form.invalid || this.isSaving) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSaving = true;
    const payload = {
      categories: this.buildSyncPayload(),
      deletedIds: [...this.deletedCategoryIds],
    };

    this.phCategoriesService.syncCategories(payload).subscribe({
      next: (response) => {
        this.isSaving = false;
        this.deletedCategoryIds = [];
        this.populateCategories(response.categories ?? []);
        this.snackBar.open(
          this.translateService.instant('management.category-edit.saved'),
          undefined,
          { duration: 3000 },
        );
        this.scheduleRailSync();
      },
      error: () => {
        this.isSaving = false;
      },
    });
  }

  private loadCategories(): void {
    this.isLoading = true;
    this.phCategoriesService.getAllCategories().subscribe({
      next: (response) => {
        const categories = response.categories ?? [];
        if (categories.length === 0) {
          this.populateCategories([]);
          this.categories.push(this.createCategoryGroup());
        } else {
          this.populateCategories(categories);
        }
        this.isLoading = false;
        this.scheduleRailSync();
      },
      error: () => {
        this.isLoading = false;
        this.populateCategories([]);
        this.categories.push(this.createCategoryGroup());
        this.scheduleRailSync();
      },
    });
  }

  private populateCategories(categories: PhCategory[]): void {
    this.categories.clear();
    for (const category of categories) {
      this.categories.push(this.createCategoryGroup(category));
    }
  }

  private buildSyncPayload(): SyncCategoryPayload[] {
    return this.categories.controls.map((categoryGroup) => {
      const raw = categoryGroup.getRawValue() as {
        _id: string | null;
        key: string;
        label: { he: string };
        subCategories: Array<{ key: string; label: { he: string } }>;
      };

      return {
        _id: raw._id || undefined,
        key: raw.key || undefined,
        label: { he: String(raw.label?.he ?? '').trim() },
        subCategories: raw.subCategories.map((subCategory) => ({
          key: subCategory.key || undefined,
          label: { he: String(subCategory.label?.he ?? '').trim() },
        })),
      };
    });
  }

  private createLabelGroup(label?: CategoryFormLabel): FormGroup {
    return new FormGroup({
      he: new FormControl<string>(label?.he ?? '', {
        nonNullable: true,
        validators: [Validators.required],
      }),
    });
  }

  private createSubCategoryGroup(subCategory?: CategoryFormSubCategory): FormGroup {
    return new FormGroup({
      key: new FormControl<string>(subCategory?.key ?? '', { nonNullable: true }),
      label: this.createLabelGroup(subCategory?.label),
    });
  }

  private cloneSubCategoryGroup(source: AbstractControl): FormGroup {
    return this.createSubCategoryGroup(source.getRawValue());
  }

  private createSubCategoriesArray(subCategories?: CategoryFormSubCategory[]): FormArray<FormGroup> {
    if (!subCategories?.length) {
      return new FormArray<FormGroup>([this.createSubCategoryGroup()]);
    }

    return new FormArray<FormGroup>(
      subCategories.map((subCategory) => this.createSubCategoryGroup(subCategory)),
    );
  }

  private createCategoryGroup(category?: CategoryFormInput | PhCategory): FormGroup {
    return new FormGroup({
      _id: new FormControl<string | null>(category?._id ?? null),
      key: new FormControl<string>(category?.key ?? '', { nonNullable: true }),
      label: this.createLabelGroup(category?.label),
      subCategories: this.createSubCategoriesArray(category?.subCategories),
    });
  }

  private cloneCategoryGroup(source: AbstractControl): FormGroup {
    const raw = source.getRawValue() as CategoryFormInput;

    return this.createCategoryGroup({
      key: raw.key,
      label: raw.label,
      subCategories: raw.subCategories,
    });
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
    root.querySelectorAll('.tree-branch, .tree-branch__footer').forEach((element) => {
      this.railResizeObserver?.observe(element);
    });
  }

  private syncTreeRailHeights(): void {
    const root = this.elementRef.nativeElement;
    root.querySelectorAll<HTMLElement>('.tree-branch').forEach((branch) => {
      const footer = branch.querySelector<HTMLElement>('.tree-branch__footer');
      const railEnd = branch.querySelector<HTMLElement>('.tree-branch__rail-end');
      if (!footer) {
        return;
      }

      branch.style.setProperty('--tree-add-btn-height', `${footer.offsetHeight}px`);

      if (railEnd) {
        const branchRect = branch.getBoundingClientRect();
        const railEndRect = railEnd.getBoundingClientRect();
        const bottomOffset = Math.max(0, branchRect.bottom - railEndRect.top);
        branch.style.setProperty('--tree-rail-bottom', `${bottomOffset}px`);
      }
    });
  }
}
