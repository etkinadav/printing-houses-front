import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { forkJoin, Subscription } from 'rxjs';
import * as maplibregl from 'maplibre-gl';

import { TranslateService } from '@ngx-translate/core';

import { DirectionService } from '../direction.service';
import { getMapStyleUrl, getMapTransformRequest } from '../maptiler/maptiler-style-url';
import { PhCategoriesService } from '../ph-categories/ph-categories.service';
import { PhCategory, PhLabel } from '../ph-categories/ph-category.model';
import { PhPrintingHouseService } from '../ph-printing-house/ph-printing-house.service';
import { PhPrintingHouseMapMarker } from '../ph-printing-house/ph-printing-house.model';
import { PhProductsService } from '../ph-products/ph-products.service';
import {
  PhCategoryGroup,
  PhProduct,
  PhProductPrintingHouseSummary,
} from '../ph-products/ph-product.model';

const MOBILE_CATALOG_MAX_WIDTH_PX = 991;

/** Default view: all of Israel. */
const ISRAEL_CENTER: [number, number] = [35.0, 31.5];
const ISRAEL_ZOOM = 6.75;

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  host: {
    class: 'fill-screen',
  },
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLDivElement>;
  @ViewChildren('markerEl') markerEls?: QueryList<ElementRef<HTMLDivElement>>;

  isRTL = true;
  isDarkMode = false;
  categoryGroups: PhCategoryGroup[] = [];
  mapPrintingHouses: PhPrintingHouseMapMarker[] = [];
  activeCategoryIndex: number | null = null;

  private map?: maplibregl.Map;
  private mapMarkers: maplibregl.Marker[] = [];
  private mapResizeObserver?: ResizeObserver;
  private markerElsSub?: Subscription;
  private hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private panelHovered = false;
  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private mapInitDone = false;

  constructor(
    private phProductsService: PhProductsService,
    private phCategoriesService: PhCategoriesService,
    private phPrintingHouseService: PhPrintingHouseService,
    private directionService: DirectionService,
    private translateService: TranslateService,
    private cdr: ChangeDetectorRef,
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
      printingHouses: this.phPrintingHouseService.listForMap(),
    }).subscribe({
      next: ({ categories, products, printingHouses }) => {
        this.categoryGroups = this.buildCategoryGroups(
          categories.categories ?? [],
          products.products ?? [],
        );
        this.mapPrintingHouses = (printingHouses.printingHouses ?? []).filter((ph) =>
          this.hasValidLocation(ph),
        );
        this.cdr.detectChanges();
        this.scheduleMapMarkersSync();
      },
      error: (error) => {
        console.error('ph-home', error);
      },
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
    this.setupMapResizeObserver();
    this.markerElsSub = this.markerEls?.changes.subscribe(() => this.syncMapMarkers());
    this.scheduleMapMarkersSync();
  }

  ngOnDestroy(): void {
    this.clearMapMarkers();
    this.map?.remove();
    this.map = undefined;
    this.mapResizeObserver?.disconnect();
    this.markerElsSub?.unsubscribe();
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

  phLogoUrl(ph: PhPrintingHouseMapMarker): string {
    return (ph.logo?.url || ph.logoUrl || '').trim();
  }

  getProductDisplayName(product: PhProduct): string {
    return product.name_he;
  }

  getPrintingHouseLogoUrl(product: PhProduct): string {
    const ph = this.resolvePrintingHouse(product);
    if (!ph) {
      return '';
    }
    return (ph.logo?.url || ph.logoUrl || '').trim();
  }

  getPrintingHouseLogo(product: PhProduct): PhProductPrintingHouseSummary['logo'] {
    return this.resolvePrintingHouse(product)?.logo;
  }

  getPrintingHouseName(product: PhProduct): string {
    const ph = this.resolvePrintingHouse(product);
    return (ph?.name || '').trim();
  }

  getPrintingHouseCity(product: PhProduct): string {
    const ph = this.resolvePrintingHouse(product);
    return (ph?.address?.city || '').trim();
  }

  hasPrintingHouseInfo(product: PhProduct): boolean {
    return (
      !!this.getPrintingHouseName(product) ||
      !!this.getPrintingHouseCity(product) ||
      !!this.getPrintingHouseLogoUrl(product)
    );
  }

  private resolvePrintingHouse(product: PhProduct): PhProductPrintingHouseSummary | null {
    const ref = product.printingHouseId;
    if (!ref || typeof ref === 'string') {
      return null;
    }
    return ref;
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

  private hasValidLocation(ph: PhPrintingHouseMapMarker): boolean {
    const lat = Number(ph.location?.lat);
    const lon = Number(ph.location?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon);
  }

  private initMap(): void {
    if (!this.mapEl?.nativeElement || this.mapInitDone) {
      return;
    }

    const styleUrl = getMapStyleUrl();
    const transformRequest = getMapTransformRequest();

    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: styleUrl,
      center: ISRAEL_CENTER,
      zoom: ISRAEL_ZOOM,
      attributionControl: false,
      ...(transformRequest ? { transformRequest } : {}),
    });

    this.map.on('error', (e) => console.error('home map error', e));
    this.map.once('load', () => {
      this.map?.resize();
      this.syncMapMarkers();
    });

    this.mapInitDone = true;
  }

  private setupMapResizeObserver(): void {
    const el = this.mapEl?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }

    this.mapResizeObserver?.disconnect();
    this.mapResizeObserver = new ResizeObserver(() => {
      if (this.map && !(this.map as maplibregl.Map & { _removed?: boolean })._removed) {
        this.map.resize();
      }
    });
    this.mapResizeObserver.observe(el);
  }

  private scheduleMapMarkersSync(): void {
    setTimeout(() => {
      if (!this.map) {
        return;
      }
      if (this.map.isStyleLoaded()) {
        this.syncMapMarkers();
      } else {
        this.map.once('load', () => this.syncMapMarkers());
      }
    }, 0);
  }

  private syncMapMarkers(): void {
    const map = this.map;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    this.clearMapMarkers();

    const houses = this.mapPrintingHouses;
    const elements = this.markerEls?.toArray() ?? [];
    if (!houses.length || elements.length !== houses.length) {
      return;
    }

    const bounds = new maplibregl.LngLatBounds();

    houses.forEach((ph, index) => {
      const el = elements[index]?.nativeElement;
      if (!el) {
        return;
      }

      const lat = Number(ph.location.lat);
      const lon = Number(ph.location.lon);
      el.hidden = false;

      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'bottom',
        draggable: false,
      })
        .setLngLat([lon, lat])
        .addTo(map);

      this.mapMarkers.push(marker);
      bounds.extend([lon, lat]);
    });

    if (this.mapMarkers.length > 0) {
      map.fitBounds(bounds, { padding: 72, maxZoom: 11, duration: 0 });
    } else {
      map.jumpTo({ center: ISRAEL_CENTER, zoom: ISRAEL_ZOOM });
    }
  }

  private clearMapMarkers(): void {
    for (const marker of this.mapMarkers) {
      marker.remove();
    }
    this.mapMarkers = [];
  }
}
