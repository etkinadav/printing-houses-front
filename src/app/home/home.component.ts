import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';

import { DirectionService } from '../direction.service';
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
    private directionService: DirectionService,
  ) {}

  ngOnInit(): void {
    this.directionSub = this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
    });
    this.darkModeSub = this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });

    this.phProductsService.getAllProducts().subscribe({
      next: (response) => {
        console.log('ph-products', response);
        this.categoryGroups = this.buildCategoryGroups(response.products ?? []);
      },
      error: (error) => {
        console.error('ph-products', error);
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

  private buildCategoryGroups(products: PhProduct[]): PhCategoryGroup[] {
    const categoryMap = new Map<string, Map<string, PhProduct[]>>();

    for (const product of products) {
      if (!categoryMap.has(product.category)) {
        categoryMap.set(product.category, new Map());
      }
      const subMap = categoryMap.get(product.category)!;
      if (!subMap.has(product.subCategory)) {
        subMap.set(product.subCategory, []);
      }
      subMap.get(product.subCategory)!.push(product);
    }

    const groups: PhCategoryGroup[] = [];
    for (const [categoryName, subMap] of categoryMap) {
      const subCategories = Array.from(subMap.entries()).map(([name, items]) => ({
        name,
        products: [...items].sort((a, b) => a.name.localeCompare(b.name)),
      }));
      subCategories.sort((a, b) => a.name.localeCompare(b.name));
      groups.push({ name: categoryName, subCategories });
    }

    return groups.sort((a, b) => a.name.localeCompare(b.name));
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
