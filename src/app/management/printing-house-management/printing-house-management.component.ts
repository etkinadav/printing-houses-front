import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import * as maplibregl from 'maplibre-gl';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';

import { DirectionService } from '../../direction.service';
import { PhProductsService } from '../../ph-products/ph-products.service';
import { PhProduct } from '../../ph-products/ph-product.model';
import { PhPrintingHouseService } from '../../ph-printing-house/ph-printing-house.service';
import { PhPrintingHouse } from '../../ph-printing-house/ph-printing-house.model';
import { buildLogoCropTransform } from '../../ph-printing-house/logo-crop.util';
import { getMapStyleUrl, getMapTransformRequest } from '../../maptiler/maptiler-style-url';

@Component({
  selector: 'app-printing-house-management',
  templateUrl: './printing-house-management.component.html',
  styleUrls: ['./printing-house-management.component.css'],
  host: {
    class: 'fill-screen',
  },
})
export class PrintingHouseManagementComponent implements OnInit, OnDestroy, AfterViewInit {
  isRTL = true;
  isDarkMode = false;
  isLoading = true;
  hasError = false;
  productsLoading = false;
  productsLoadFailed = false;

  printingHouse?: PhPrintingHouse;
  products: PhProduct[] = [];

  logoImgTransform = '';

  @ViewChild('mapEl') mapEl?: ElementRef<HTMLDivElement>;
  @ViewChild('mapWrap') mapWrap?: ElementRef<HTMLDivElement>;
  @ViewChild('mapPin') mapPinEl?: ElementRef<HTMLDivElement>;
  @ViewChild('logoViewport') logoViewport?: ElementRef<HTMLDivElement>;
  @ViewChild('logoImg') logoImg?: ElementRef<HTMLImageElement>;

  private map?: maplibregl.Map;
  private marker?: maplibregl.Marker;
  private mapInitScheduled = false;
  private logoNaturalW = 0;
  private logoNaturalH = 0;
  private logoResizeObserver?: ResizeObserver;
  private mapResizeObserver?: ResizeObserver;

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;

  constructor(
    private directionService: DirectionService,
    private phPrintingHouseService: PhPrintingHouseService,
    private phProductsService: PhProductsService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private translate: TranslateService,
    private snackBar: MatSnackBar,
  ) {}

  get printingHouseId(): string {
    return this.printingHouse?._id ?? '';
  }

  get addressLine(): string {
    const addr = this.printingHouse?.address;
    if (!addr) return '';

    const parts: string[] = [];
    const streetLine = [addr.street, addr.houseNumber].filter((v) => !!v?.trim()).join(' ');
    if (streetLine) parts.push(streetLine);
    if (addr.city?.trim()) parts.push(addr.city.trim());

    const apartment = addr.apartment?.trim();
    if (apartment) {
      parts.push(`${this.translate.instant('printing-house-join.apartment')} ${apartment}`);
    }

    const floor = addr.floor?.trim();
    if (floor) {
      parts.push(`${this.translate.instant('printing-house-join.floor')} ${floor}`);
    }

    const notes = addr.notes?.trim();
    if (notes) parts.push(notes);

    return parts.join(', ');
  }

  get logoUrl(): string {
    const ph = this.printingHouse;
    return (ph?.logo?.url || ph?.logoUrl || '').trim();
  }

  ngOnInit(): void {
    this.directionSub = this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
    });
    this.darkModeSub = this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });

    this.load();
  }

  ngOnDestroy(): void {
    this.directionSub?.unsubscribe();
    this.darkModeSub?.unsubscribe();
    this.logoResizeObserver?.disconnect();
    this.mapResizeObserver?.disconnect();
    this.marker?.remove();
    this.map?.remove();
  }

  ngAfterViewInit(): void {
    this.scheduleMapInit();
    this.setupLogoViewportObserver();
    this.setupMapResizeObserver();
  }

  load(): void {
    this.isLoading = true;
    this.hasError = false;

    const idFromUrl = this.route.snapshot.paramMap.get('id');
    const request$ = idFromUrl
      ? this.phPrintingHouseService.getPrintingHouseById(idFromUrl)
      : this.phPrintingHouseService.getMyPrintingHouse();

    request$.subscribe({
      next: (res) => {
        this.printingHouse = res.printingHouse;
        this.isLoading = false;
        this.loadProducts();
        this.cdr.detectChanges();
        this.scheduleMapInit();
        setTimeout(() => {
          this.setupLogoViewportObserver();
          this.setupMapResizeObserver();
          this.updateLogoTransform();
          this.map?.resize();
        }, 0);
      },
      error: (err) => {
        console.error('load printing house failed', err);
        this.hasError = true;
        this.isLoading = false;
      },
    });
  }

  loadProducts(): void {
    const id = this.printingHouseId;
    if (!id) return;

    this.productsLoading = true;
    this.productsLoadFailed = false;

    this.phProductsService.getProductsByPrintingHouse(id).subscribe({
      next: (res) => {
        this.products = res.products ?? [];
        this.productsLoading = false;
      },
      error: () => {
        this.products = [];
        this.productsLoading = false;
        this.productsLoadFailed = true;
      },
    });
  }

  onAddProduct(): void {
    if (!this.printingHouseId) return;
    void this.router.navigate([
      '/management/printing-house',
      this.printingHouseId,
      'product',
      'create',
    ]);
  }

  onEditProduct(productId: string): void {
    if (!this.printingHouseId) return;
    void this.router.navigate([
      '/management/printing-house',
      this.printingHouseId,
      'product',
      productId,
      'edit',
    ]);
  }

  onDeleteProduct(product: PhProduct): void {
    const msg = this.translate.instant('management.printing-house.delete-product-confirm', {
      name: product.name_he,
    });
    if (!confirm(msg)) return;

    this.phProductsService.deleteProduct(product._id).subscribe({
      next: () => this.loadProducts(),
      error: () => {
        this.snackBar.open(
          this.translate.instant('management.printing-house.delete-product-failed'),
          undefined,
          { duration: 4000 },
        );
      },
    });
  }

  onLogoImgLoad(): void {
    const img = this.logoImg?.nativeElement;
    if (!img) return;
    this.logoNaturalW = img.naturalWidth || 0;
    this.logoNaturalH = img.naturalHeight || 0;
    this.updateLogoTransform();
    setTimeout(() => this.map?.resize(), 0);
  }

  private setupMapResizeObserver(): void {
    const el = this.mapWrap?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') return;

    this.mapResizeObserver?.disconnect();
    this.mapResizeObserver = new ResizeObserver(() => {
      if (this.map && !(this.map as any)._removed) {
        this.map.resize();
      }
    });
    this.mapResizeObserver.observe(el);
  }

  private setupLogoViewportObserver(): void {
    const el = this.logoViewport?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') return;

    this.logoResizeObserver?.disconnect();
    this.logoResizeObserver = new ResizeObserver(() => this.updateLogoTransform());
    this.logoResizeObserver.observe(el);
  }

  private updateLogoTransform(): void {
    const viewport = this.logoViewport?.nativeElement;
    if (!viewport) return;

    const img = this.logoImg?.nativeElement;
    if (img?.complete && img.naturalWidth) {
      this.logoNaturalW = img.naturalWidth;
      this.logoNaturalH = img.naturalHeight;
    }

    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (!vw || !vh) return;

    this.logoImgTransform = buildLogoCropTransform(
      this.printingHouse?.logo,
      vw,
      vh,
      this.logoNaturalW,
      this.logoNaturalH,
    );
  }

  private scheduleMapInit(): void {
    if (this.mapInitScheduled) return;
    if (!this.printingHouse || this.isLoading || this.hasError) return;

    this.mapInitScheduled = true;
    setTimeout(() => {
      this.mapInitScheduled = false;
      this.ensureMapReady();
    }, 0);
  }

  private ensureMapReady(): void {
    if (!this.mapEl?.nativeElement || !this.printingHouse) return;

    const lat = Number(this.printingHouse.location?.lat);
    const lon = Number(this.printingHouse.location?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    if (!this.map || (this.map as any)._removed) {
      this.initMap(lat, lon);
      return;
    }

    const applyCenter = () => {
      this.setMarkerAndCenter(lat, lon);
      this.map!.resize();
    };

    if (this.map.isStyleLoaded()) {
      applyCenter();
    } else {
      this.map.once('load', applyCenter);
    }
  }

  private initMap(lat: number, lon: number): void {
    if (!this.mapEl?.nativeElement) return;
    if (this.map && !(this.map as any)._removed) return;

    const styleUrl = getMapStyleUrl();
    const transformRequest = getMapTransformRequest();

    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: styleUrl,
      center: [lon, lat],
      zoom: 15,
      attributionControl: false,
      ...(transformRequest ? { transformRequest } : {}),
    });

    this.map.on('error', (e) => {
      console.error('Map error on management page', e);
    });

    const map = this.map;
    const centerWhenReady = () => {
      this.setMarkerAndCenter(lat, lon);
      map.resize();
    };

    if (map.isStyleLoaded()) {
      centerWhenReady();
    } else {
      map.once('load', centerWhenReady);
    }
  }

  private setMarkerAndCenter(lat: number, lon: number): void {
    const map = this.map;
    const pinEl = this.mapPinEl?.nativeElement;
    if (!map || !pinEl) return;

    pinEl.hidden = false;

    if (!this.marker) {
      this.marker = new maplibregl.Marker({
        element: pinEl,
        anchor: 'bottom',
        draggable: false,
      })
        .setLngLat([lon, lat])
        .addTo(map);
    } else {
      this.marker.setLngLat([lon, lat]);
    }

    map.jumpTo({ center: [lon, lat], zoom: 15 });
  }
}
