import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import * as maplibregl from 'maplibre-gl';
import { ActivatedRoute } from '@angular/router';

import { DirectionService } from '../../direction.service';
import { PhPrintingHouseService } from '../../ph-printing-house/ph-printing-house.service';
import { PhPrintingHouse } from '../../ph-printing-house/ph-printing-house.model';
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

  printingHouse?: PhPrintingHouse;

  logoCoverScale = 1;

  @ViewChild('mapEl') mapEl?: ElementRef<HTMLDivElement>;
  @ViewChild('mapPin') mapPinEl?: ElementRef<HTMLDivElement>;
  @ViewChild('logoImg') logoImg?: ElementRef<HTMLImageElement>;

  private map?: maplibregl.Map;
  private marker?: maplibregl.Marker;
  private mapInitScheduled = false;

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;

  constructor(
    private directionService: DirectionService,
    private phPrintingHouseService: PhPrintingHouseService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
  ) {}

  get logoUrl(): string {
    const ph = this.printingHouse;
    return (ph?.logo?.url || ph?.logoUrl || '').trim();
  }

  get logoZoom(): number {
    const z = this.printingHouse?.logo?.zoom;
    return typeof z === 'number' && Number.isFinite(z) ? z : 1;
  }

  get logoOffsetX(): number {
    const v = this.printingHouse?.logo?.offsetX;
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }

  get logoOffsetY(): number {
    const v = this.printingHouse?.logo?.offsetY;
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
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
    this.marker?.remove();
    this.map?.remove();
  }

  ngAfterViewInit(): void {
    this.scheduleMapInit();
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
        this.cdr.detectChanges();
        this.scheduleMapInit();
      },
      error: (err) => {
        console.error('load printing house failed', err);
        this.hasError = true;
        this.isLoading = false;
      },
    });
  }

  onLogoImgLoad(): void {
    const img = this.logoImg?.nativeElement;
    if (!img) return;
    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    const viewport = img.parentElement;
    if (!viewport || !w || !h) {
      this.logoCoverScale = 1;
      return;
    }
    const vw = viewport.clientWidth || 220;
    const vh = viewport.clientHeight || 220;
    this.logoCoverScale = Math.max(vw / w, vh / h);
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

    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

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
