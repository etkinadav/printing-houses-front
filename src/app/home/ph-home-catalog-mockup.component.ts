import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { Subscription } from 'rxjs';

import { DirectionService } from '../direction.service';
import { PhCanvas } from '../ph-canvas/ph-canvas.model';
import { PhPrintingFile } from '../ph-printing-files/ph-printing-file.model';
import { PhProduct } from '../ph-products/ph-product.model';
import { PhProductsService } from '../ph-products/ph-products.service';
import {
  buildHomeCatalogMockupViewModel,
  PhHomeCatalogMockupViewModel,
} from './ph-home-catalog-mockup.util';

@Component({
  selector: 'app-ph-home-catalog-mockup',
  templateUrl: './ph-home-catalog-mockup.component.html',
  styleUrls: ['./ph-home-catalog-mockup.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhHomeCatalogMockupComponent implements OnChanges, OnDestroy {
  @Input() product: PhProduct | null = null;

  view: PhHomeCatalogMockupViewModel | null = null;
  loading = false;
  failed = false;
  isRTL = true;
  isDarkMode = false;

  private loadSub?: Subscription;
  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private loadToken = 0;

  constructor(
    private phProductsService: PhProductsService,
    private directionService: DirectionService,
    private cdr: ChangeDetectorRef,
  ) {
    this.directionSub = this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
      this.cdr.markForCheck();
    });
    this.darkModeSub = this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
      this.cdr.markForCheck();
    });
  }

  get hasCatalogCanvas(): boolean {
    return !!this.product?.catalogMockup?.canvasId;
  }

  get fallbackPreviewUrl(): string {
    return this.product?.catalogMockup?.previewUrl?.trim() || '';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['product']) {
      this.reload();
    }
  }

  ngOnDestroy(): void {
    this.loadSub?.unsubscribe();
    this.directionSub?.unsubscribe();
    this.darkModeSub?.unsubscribe();
    this.loadToken += 1;
  }

  private reload(): void {
    this.loadSub?.unsubscribe();
    this.view = null;
    this.failed = false;

    const product = this.product;
    const productId = product?._id?.trim();
    const canvasId = product?.catalogMockup?.canvasId;
    if (!product || !productId || !canvasId) {
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }

    const token = ++this.loadToken;
    this.loading = true;
    this.cdr.markForCheck();

    this.loadSub = this.phProductsService.getPublicCatalogMockup(productId).subscribe({
      next: (res) => {
        if (token !== this.loadToken) {
          return;
        }
        void this.applyPayload(product, res.canvas, res.files ?? [], token);
      },
      error: () => {
        if (token !== this.loadToken) {
          return;
        }
        this.loading = false;
        this.failed = true;
        this.cdr.markForCheck();
      },
    });
  }

  private async applyPayload(
    product: PhProduct,
    canvas: Pick<PhCanvas, 'printSettings' | 'sides'> & { _id?: string },
    files: PhPrintingFile[],
    token: number,
  ): Promise<void> {
    try {
      const view = await buildHomeCatalogMockupViewModel(product, canvas, files);
      if (token !== this.loadToken) {
        return;
      }
      this.view = view;
      this.failed = !view;
    } catch {
      if (token !== this.loadToken) {
        return;
      }
      this.view = null;
      this.failed = true;
    } finally {
      if (token === this.loadToken) {
        this.loading = false;
        this.cdr.markForCheck();
      }
    }
  }
}
