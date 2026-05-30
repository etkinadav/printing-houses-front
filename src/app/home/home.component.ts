import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { forkJoin, Subscription } from 'rxjs';

import { TranslateService } from '@ngx-translate/core';

import { DirectionService } from '../direction.service';
import { PhCategoriesService } from '../ph-categories/ph-categories.service';
import { PhCategory, PhLabel } from '../ph-categories/ph-category.model';
import { PhProductsService } from '../ph-products/ph-products.service';
import {
  PhCategoryGroup,
  PhProduct,
} from '../ph-products/ph-product.model';

/** Forward / reverse playback speed multiplier (0.5 = half speed). */
const PLAYBACK_SPEED = 0.5;

const MOBILE_CATALOG_MAX_WIDTH_PX = 991;

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  host: {
    class: 'fill-screen',
  },
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;

  isRTL = true;
  isDarkMode = false;
  categoryGroups: PhCategoryGroup[] = [];
  activeCategoryIndex: number | null = null;

  private playingReverse = false;
  private reverseRafId: number | null = null;
  private lastReverseTs: number | null = null;
  private hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private panelHovered = false;
  private directionSub?: Subscription;
  private darkModeSub?: Subscription;

  constructor(
    private phProductsService: PhProductsService,
    private phCategoriesService: PhCategoriesService,
    private directionService: DirectionService,
    private translateService: TranslateService,
  ) {}

  ngOnInit(): void {
    this.directionSub = this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
    });
    this.darkModeSub = this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });

    forkJoin({
      categories: this.phCategoriesService.getAllCategories(),
      products: this.phProductsService.getAllProducts(),
    }).subscribe({
      next: ({ categories, products }) => {
        this.categoryGroups = this.buildCategoryGroups(
          categories.categories ?? [],
          products.products ?? [],
        );
      },
      error: (error) => {
        console.error('ph-catalog', error);
      },
    });
  }

  ngAfterViewInit(): void {
    const video = this.videoRef.nativeElement;
    video.playbackRate = PLAYBACK_SPEED;
    void video.play().catch(() => {
      const resume = () => {
        video.playbackRate = PLAYBACK_SPEED;
        void video.play();
        document.removeEventListener('pointerdown', resume);
        document.removeEventListener('keydown', resume);
      };
      document.addEventListener('pointerdown', resume, { once: true });
      document.addEventListener('keydown', resume, { once: true });
    });
  }

  ngOnDestroy(): void {
    this.stopReverse();
    this.clearHoverCloseTimer();
    this.directionSub?.unsubscribe();
    this.darkModeSub?.unsubscribe();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.isMobileCatalogViewport()) {
      this.activeCategoryIndex = null;
    }
  }

  onCategoryClick(categoryIndex: number, event: Event): void {
    event.stopPropagation();
    if (!this.isMobileCatalogViewport()) {
      return;
    }
    this.activeCategoryIndex =
      this.activeCategoryIndex === categoryIndex ? null : categoryIndex;
  }

  onCategoryMouseEnter(categoryIndex: number): void {
    if (this.isMobileCatalogViewport()) {
      return;
    }
    this.clearHoverCloseTimer();
    this.activeCategoryIndex = categoryIndex;
  }

  onNavMouseLeave(): void {
    if (this.isMobileCatalogViewport()) {
      return;
    }
    this.scheduleHoverClose();
  }

  onPanelMouseEnter(): void {
    this.panelHovered = true;
    this.clearHoverCloseTimer();
  }

  onPanelMouseLeave(): void {
    this.panelHovered = false;
    if (!this.isMobileCatalogViewport()) {
      this.activeCategoryIndex = null;
    }
  }

  onVideoEnded(): void {
    if (this.playingReverse) {
      return;
    }
    this.startReverse();
  }

  getProductDisplayName(product: PhProduct): string {
    return product.name_he;
  }

  private buildCategoryGroups(
    categories: PhCategory[],
    products: PhProduct[],
  ): PhCategoryGroup[] {
    const productsBySub = new Map<string, PhProduct[]>();
    for (const product of products) {
      const categoryId = this.resolveCategoryId(product.category);
      if (!categoryId) {
        continue;
      }
      const key = `${categoryId}::${product.subCategory}`;
      if (!productsBySub.has(key)) {
        productsBySub.set(key, []);
      }
      productsBySub.get(key)!.push(product);
    }

    return categories.map((category) => {
      const subCategories = (category.subCategories || []).map((sub) => {
        const key = `${category._id}::${sub.key}`;
        const subProducts = productsBySub.get(key) ?? [];
        return {
          name: this.resolveLabel(sub.label),
          products: [...subProducts].sort((a, b) =>
            this.getProductDisplayName(a).localeCompare(this.getProductDisplayName(b)),
          ),
        };
      });

      return {
        name: this.resolveLabel(category.label),
        subCategories,
      };
    });
  }

  private resolveCategoryId(category: PhProduct['category']): string | null {
    if (!category) {
      return null;
    }
    return typeof category === 'string' ? category : category._id;
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

  private isMobileCatalogViewport(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= MOBILE_CATALOG_MAX_WIDTH_PX;
  }

  private scheduleHoverClose(): void {
    this.clearHoverCloseTimer();
    this.hoverCloseTimer = setTimeout(() => {
      if (!this.panelHovered) {
        this.activeCategoryIndex = null;
      }
    }, 120);
  }

  private clearHoverCloseTimer(): void {
    if (this.hoverCloseTimer != null) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
  }

  private startReverse(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) {
      return;
    }

    video.pause();
    this.playingReverse = true;
    this.lastReverseTs = null;
    this.reverseRafId = requestAnimationFrame(this.reverseStep);
  }

  private readonly reverseStep = (ts: number): void => {
    const video = this.videoRef?.nativeElement;
    if (!video || !this.playingReverse) {
      return;
    }

    if (this.lastReverseTs == null) {
      this.lastReverseTs = ts;
      this.reverseRafId = requestAnimationFrame(this.reverseStep);
      return;
    }

    const deltaSec = (ts - this.lastReverseTs) / 1000;
    this.lastReverseTs = ts;
    video.currentTime = Math.max(0, video.currentTime - deltaSec * PLAYBACK_SPEED);

    if (video.currentTime <= 0.01) {
      this.stopReverse();
      video.currentTime = 0;
      video.playbackRate = PLAYBACK_SPEED;
      void video.play();
      return;
    }

    this.reverseRafId = requestAnimationFrame(this.reverseStep);
  };

  private stopReverse(): void {
    this.playingReverse = false;
    this.lastReverseTs = null;
    if (this.reverseRafId != null) {
      cancelAnimationFrame(this.reverseRafId);
      this.reverseRafId = null;
    }
  }
}
