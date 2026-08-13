import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { Router } from '@angular/router';
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

/** Default view: all of Israel. */
const ISRAEL_CENTER: [number, number] = [35.0, 31.5];
const ISRAEL_ZOOM = 6.75;
const PRODUCTS_PAGE_SIZE = 12;

const CATEGORY_ICONS: Array<{ match: RegExp; icon: string }> = [
  { match: /נייר|מסמך|paper|document|ورق/i, icon: 'description' },
  { match: /שלט|שילוט|sign|لافت/i, icon: 'storefront' },
  { match: /תמונ|קנבס|photo|canvas|صور/i, icon: 'photo' },
  { match: /מותג|מתנ|brand|منتج/i, icon: 'card_giftcard' },
  { match: /טקסטיל|חולצ|textile|قماش/i, icon: 'checkroom' },
  { match: /לייזר|laser|ليزر/i, icon: 'bolt' },
  { match: /תלת|3d|ثلاث/i, icon: 'view_in_ar' },
  { match: /cnc|כרסום/i, icon: 'precision_manufacturing' },
];

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
  host: {
    class: 'fill-screen-home',
    '[class.home-page--dark]': 'isDarkMode',
  },
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLDivElement>;
  @ViewChildren('markerEl') markerEls?: QueryList<ElementRef<HTMLDivElement>>;

  isRTL = true;
  isDarkMode = false;
  loading = true;

  categoryGroups: PhCategoryGroup[] = [];
  allProducts: PhProduct[] = [];
  mapPrintingHouses: PhPrintingHouseMapMarker[] = [];
  private allMapPrintingHouses: PhPrintingHouseMapMarker[] = [];

  searchQuery = '';
  selectedCategoryIndex: number | null = null;
  selectedCity = '';
  sortMode: 'name' | 'ph' = 'name';
  resultsVisibleCount = PRODUCTS_PAGE_SIZE;

  /** Soft filter UI (not all backed by product fields yet). */
  maxDistanceKm = 50;
  priceMin = '';
  priceMax = '';
  deliveryFilter: 'today' | '24h' | '3d' | 'any' = 'any';
  /** Enlarged map + single-column product list. */
  mapExpanded = false;
  /** Mobile filter panel — collapsed by default when filters sit above products. */
  filtersOpen = false;

  private map?: maplibregl.Map;
  private mapMarkers: maplibregl.Marker[] = [];
  private markerClickBindings: Array<{ el: HTMLElement; handler: (e: Event) => void }> = [];
  private mapResizeObserver?: ResizeObserver;
  private markerElsSub?: Subscription;
  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private mapInitDone = false;
  private rawCategories: PhCategory[] = [];

  constructor(
    private phProductsService: PhProductsService,
    private phCategoriesService: PhCategoriesService,
    private phPrintingHouseService: PhPrintingHouseService,
    private directionService: DirectionService,
    private translateService: TranslateService,
    private cdr: ChangeDetectorRef,
    private router: Router,
  ) {}

  get cityOptions(): string[] {
    const cities = new Set<string>();
    for (const product of this.allProducts) {
      const city = this.getPrintingHouseCity(product);
      if (city) {
        cities.add(city);
      }
    }
    return [...cities].sort((a, b) => a.localeCompare(b, 'he'));
  }

  get filteredProducts(): PhProduct[] {
    const q = this.searchQuery.trim().toLowerCase();
    let list = this.allProducts.slice();

    if (this.selectedCategoryIndex != null) {
      const group = this.categoryGroups[this.selectedCategoryIndex];
      if (group) {
        const ids = new Set(
          group.subCategories.flatMap((sub) => sub.products.map((p) => p._id)),
        );
        list = list.filter((p) => ids.has(p._id));
      }
    }

    if (q) {
      list = list.filter((product) => {
        const name = this.getProductDisplayName(product).toLowerCase();
        const ph = this.getPrintingHouseName(product).toLowerCase();
        const city = this.getPrintingHouseCity(product).toLowerCase();
        return name.includes(q) || ph.includes(q) || city.includes(q);
      });
    }

    if (this.selectedCity) {
      list = list.filter(
        (product) => this.getPrintingHouseCity(product) === this.selectedCity,
      );
    }

    if (this.sortMode === 'ph') {
      list.sort((a, b) =>
        this.getPrintingHouseName(a).localeCompare(this.getPrintingHouseName(b), 'he'),
      );
    } else {
      list.sort((a, b) =>
        this.getProductDisplayName(a).localeCompare(this.getProductDisplayName(b), 'he'),
      );
    }

    return list;
  }

  get visibleProducts(): PhProduct[] {
    return this.filteredProducts.slice(0, this.resultsVisibleCount);
  }

  get hasMoreProducts(): boolean {
    return this.resultsVisibleCount < this.filteredProducts.length;
  }

  get resultsCount(): number {
    return this.filteredProducts.length;
  }

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
        this.rawCategories = categories.categories ?? [];
        const productList = products.products ?? [];
        this.allProducts = productList;
        this.categoryGroups = this.buildCategoryGroups(this.rawCategories, productList).filter(
          (group) => group.subCategories.some((sub) => sub.products.length > 0),
        );
        this.allMapPrintingHouses = (printingHouses.printingHouses ?? [])
          .filter((ph) => this.hasValidLocation(ph))
          // Higher latitude behind lower latitude (north → south paint order).
          .sort((a, b) => Number(b.location.lat) - Number(a.location.lat));
        this.refreshVisibleMapHouses();
        this.loading = false;
        this.cdr.detectChanges();
        setTimeout(() => {
          this.initMap();
          this.setupMapResizeObserver();
          this.scheduleMapMarkersSync();
          this.map?.resize();
        }, 0);
      },
      error: (error) => {
        console.error('ph-home', error);
        this.loading = false;
        this.cdr.markForCheck();
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
    this.directionSub?.unsubscribe();
    this.darkModeSub?.unsubscribe();
  }

  categoryIcon(categoryName: string): string {
    for (const entry of CATEGORY_ICONS) {
      if (entry.match.test(categoryName)) {
        return entry.icon;
      }
    }
    return 'category';
  }

  onSearchInput(value: string): void {
    this.searchQuery = value;
    this.resultsVisibleCount = PRODUCTS_PAGE_SIZE;
  }

  onSelectCategory(index: number | null): void {
    this.selectedCategoryIndex = index;
    this.resultsVisibleCount = PRODUCTS_PAGE_SIZE;
    this.refreshVisibleMapHouses(true);
  }

  onCityChange(city: string): void {
    this.selectedCity = city;
    this.resultsVisibleCount = PRODUCTS_PAGE_SIZE;
  }

  onSortChange(mode: 'name' | 'ph'): void {
    this.sortMode = mode;
  }

  onToggleFilters(): void {
    this.filtersOpen = !this.filtersOpen;
  }

  onApplyFilters(): void {
    this.filtersOpen = false;
  }

  onClearFilters(): void {
    this.searchQuery = '';
    this.selectedCategoryIndex = null;
    this.selectedCity = '';
    this.maxDistanceKm = 50;
    this.priceMin = '';
    this.priceMax = '';
    this.deliveryFilter = 'any';
    this.sortMode = 'name';
    this.resultsVisibleCount = PRODUCTS_PAGE_SIZE;
    this.refreshVisibleMapHouses(true);
  }

  onShowMore(): void {
    this.resultsVisibleCount += PRODUCTS_PAGE_SIZE;
  }

  onToggleMapView(): void {
    this.setMapExpanded(!this.mapExpanded);
  }

  onCloseMapView(): void {
    this.setMapExpanded(false);
  }

  private setMapExpanded(expanded: boolean): void {
    if (this.mapExpanded === expanded) {
      return;
    }
    this.mapExpanded = expanded;
    this.cdr.detectChanges();
    requestAnimationFrame(() => {
      this.map?.resize();
      if (this.mapExpanded) {
        this.mapEl?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  phLogoUrl(ph: PhPrintingHouseMapMarker): string {
    return (ph.logo?.url || ph.logoUrl || '').trim();
  }

  getProductDisplayName(product: PhProduct): string {
    const lang = this.translateService.currentLang || 'he';
    if (lang === 'en' && product.name_en?.trim()) {
      return product.name_en.trim();
    }
    if (lang === 'ar' && product.name_ar?.trim()) {
      return product.name_ar.trim();
    }
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

  onProductClick(product: PhProduct): void {
    const productId = product?._id?.trim();
    const printingHouseId = this.resolvePrintingHouseId(product);
    if (!productId || !printingHouseId) {
      return;
    }
    void this.router.navigate(['/print'], {
      queryParams: {
        printingHouseId,
        productId,
      },
    });
  }

  onPrintingHouseClick(product: PhProduct, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    const printingHouseId = this.resolvePrintingHouseId(product);
    if (!printingHouseId) {
      return;
    }
    void this.router.navigate(['/printing-house', printingHouseId]);
  }

  /** Map markers: PHs with ≥1 product; if a category is selected, only PHs in that category. */
  private refreshVisibleMapHouses(syncMarkers = false): void {
    const houseIds = this.printingHouseIdsForMap();
    this.mapPrintingHouses = this.allMapPrintingHouses.filter((ph) => houseIds.has(ph._id));
    if (syncMarkers) {
      this.cdr.detectChanges();
      this.scheduleMapMarkersSync();
    }
  }

  private printingHouseIdsForMap(): Set<string> {
    const ids = new Set<string>();
    for (const product of this.productsForMapHouses()) {
      const houseId = this.resolvePrintingHouseId(product);
      if (houseId) {
        ids.add(houseId);
      }
    }
    return ids;
  }

  private productsForMapHouses(): PhProduct[] {
    if (this.selectedCategoryIndex == null) {
      return this.allProducts;
    }
    const group = this.categoryGroups[this.selectedCategoryIndex];
    if (!group) {
      return this.allProducts;
    }
    const productIds = new Set(
      group.subCategories.flatMap((sub) => sub.products.map((p) => p._id)),
    );
    return this.allProducts.filter((product) => productIds.has(product._id));
  }

  private resolvePrintingHouseId(product: PhProduct): string {
    const ref = product.printingHouseId;
    if (!ref) {
      return '';
    }
    if (typeof ref === 'string') {
      return ref.trim();
    }
    return (ref._id || '').trim();
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
      // Lower latitude (south) gets a higher z-index so northern markers sit behind.
      el.style.zIndex = String(Math.round((90 - lat) * 1000));

      const handler = (event: Event) => {
        event.stopPropagation();
        void this.router.navigate(['/printing-house', ph._id]);
      };
      el.addEventListener('click', handler);
      this.markerClickBindings.push({ el, handler });

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
      map.fitBounds(bounds, { padding: 48, maxZoom: 11, duration: 0 });
    } else {
      map.jumpTo({ center: ISRAEL_CENTER, zoom: ISRAEL_ZOOM });
    }
  }

  private clearMapMarkers(): void {
    for (const { el, handler } of this.markerClickBindings) {
      el.removeEventListener('click', handler);
    }
    this.markerClickBindings = [];

    for (const marker of this.mapMarkers) {
      marker.remove();
    }
    this.mapMarkers = [];
  }
}
