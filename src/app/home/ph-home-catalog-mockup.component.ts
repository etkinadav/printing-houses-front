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
  buildEmptyHomeCatalogMockupViewModel,
  buildHomeCatalogMockupViewModel,
  PhHomeCatalogMockupViewModel,
  productHasHomeMockupImage,
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

  get canShow(): boolean {
    return (
      !!this.product?.catalogMockup?.canvasId ||
      !!this.product?.catalogMockup?.previewUrl?.trim() ||
      productHasHomeMockupImage(this.product)
    );
  }

  get emptyMockupImageUrl(): string {
    const empty = this.product ? buildEmptyHomeCatalogMockupViewModel(this.product) : null;
    return empty?.mockup?.url?.trim() || '';
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

    const product = this.product;
    const productId = product?._id?.trim();
    const canvasId = product?.catalogMockup?.canvasId;

    if (!product || !productId) {
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }

    // No catalog design — show the empty product mockup photo.
    if (!canvasId) {
      this.view = buildEmptyHomeCatalogMockupViewModel(product);
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
        // Fall back to empty product mockup when catalog canvas can't be loaded.
        this.view = buildEmptyHomeCatalogMockupViewModel(product);
        this.loading = false;
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
      this.view = view ?? buildEmptyHomeCatalogMockupViewModel(product);
    } catch {
      if (token !== this.loadToken) {
        return;
      }
      this.view = buildEmptyHomeCatalogMockupViewModel(product);
    } finally {
      if (token === this.loadToken) {
        this.loading = false;
        this.cdr.markForCheck();
      }
    }
  }
}
