import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, map, merge, Subscription } from 'rxjs';
import * as maplibregl from 'maplibre-gl';

import { DirectionService } from '../direction.service';
import { getMapStyleUrl, getMapTransformRequest } from '../maptiler/maptiler-style-url';
import { PhPrintingHouseService } from '../ph-printing-house/ph-printing-house.service';

@Component({
  selector: 'app-printing-house-join',
  templateUrl: './printing-house-join.component.html',
  styleUrls: ['./printing-house-join.component.css'],
  host: {
    class: 'fill-screen',
  },
})
export class PrintingHouseJoinComponent implements OnInit, OnDestroy, AfterViewInit {
  isRTL = true;
  isDarkMode = false;

  private readonly imageUrlPattern = /^https?:\/\/.+/i;
  private readonly coordDecimals = 7;

  @ViewChild('mapEl') mapEl?: ElementRef<HTMLDivElement>;
  private map?: maplibregl.Map;
  private suppressAddressToMap = false;
  private suppressMapToAddress = false;
  private mapMoveEndTmr?: ReturnType<typeof setTimeout>;
  private geocodeRequestId = 0;
  private reverseGeocodeRequestId = 0;

  private readonly addressFieldKeys = [
    'city',
    'street',
    'houseNumber',
    'apartment',
    'floor',
    'postalCode',
    'notes',
  ] as const;

  form = new FormGroup({
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    logoUrl: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(500), Validators.pattern(this.imageUrlPattern)],
    }),
    city: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    street: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    houseNumber: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(20)],
    }),
    apartment: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(20)],
    }),
    floor: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(20)],
    }),
    postalCode: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(20)],
    }),
    notes: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
    lat: new FormControl<string>('', {
      nonNullable: true,
    }),
    lon: new FormControl<string>('', {
      nonNullable: true,
    }),
  });

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;
  private addressSub?: Subscription;

  constructor(
    private directionService: DirectionService,
    private translateService: TranslateService,
    private snackBar: MatSnackBar,
    private phPrintingHouseService: PhPrintingHouseService,
  ) {}

  ngOnInit(): void {
    this.directionSub = this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
    });
    this.darkModeSub = this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });

    const addressChanges = this.addressFieldKeys.map((key) => this.form.controls[key].valueChanges);
    this.addressSub = merge(...addressChanges)
      .pipe(
        debounceTime(450),
        map(() => this.addressPartsOf(this.form.getRawValue())),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      )
      .subscribe(() => {
        if (this.suppressAddressToMap) return;
        void this.geocodeAddressToMap();
      });
  }

  ngOnDestroy(): void {
    this.directionSub?.unsubscribe();
    this.darkModeSub?.unsubscribe();
    this.addressSub?.unsubscribe();
    clearTimeout(this.mapMoveEndTmr);
    this.map?.remove();
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const payload = {
      name: this.form.controls.name.value,
      logoUrl: this.form.controls.logoUrl.value,
      address: {
        city: this.form.controls.city.value,
        street: this.form.controls.street.value,
        houseNumber: this.form.controls.houseNumber.value,
        apartment: this.form.controls.apartment.value,
        floor: this.form.controls.floor.value,
        postalCode: this.form.controls.postalCode.value,
        notes: this.form.controls.notes.value,
      },
      location: {
        lat: Number(this.form.controls.lat.value),
        lon: Number(this.form.controls.lon.value),
      },
    };

    this.phPrintingHouseService.createPrintingHouse(payload).subscribe({
      next: () => {
        this.snackBar.open(
          this.translateService.instant('printing-house-join.submitted'),
          undefined,
          { duration: 3000 },
        );
      },
      error: () => {
        this.snackBar.open(
          this.translateService.instant('printing-house-join.submit-failed'),
          undefined,
          { duration: 4000 },
        );
      },
    });
  }

  private addressPartsOf(v: any) {
    return {
      city: (v?.city ?? '').trim(),
      street: (v?.street ?? '').trim(),
      houseNumber: (v?.houseNumber ?? '').trim(),
      apartment: (v?.apartment ?? '').trim(),
      floor: (v?.floor ?? '').trim(),
      postalCode: (v?.postalCode ?? '').trim(),
      notes: (v?.notes ?? '').trim(),
    };
  }

  private buildAddressQuery(): string {
    const v = this.addressPartsOf(this.form.getRawValue());
    const parts = [
      [v.street, v.houseNumber].filter(Boolean).join(' '),
      v.city,
      v.postalCode,
      'Israel',
    ].filter(Boolean);
    return parts.join(', ');
  }

  private initMap(): void {
    if (!this.mapEl?.nativeElement) return;
    if (this.map && !((this.map as any)._removed)) return;

    const initialCenter: [number, number] = [34.7818, 32.0853]; // Tel Aviv
    const styleUrl = getMapStyleUrl();

    const transformRequest = getMapTransformRequest();

    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: styleUrl,
      center: initialCenter,
      zoom: 12,
      attributionControl: false,
      ...(transformRequest ? { transformRequest } : {}),
    });

    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    this.map.on('load', () => {
      this.setCoordsFromCenter(this.map!.getCenter().lat, this.map!.getCenter().lng, { emit: false });
    });

    this.map.on('moveend', () => {
      if (this.suppressMapToAddress) return;
      clearTimeout(this.mapMoveEndTmr);
      this.mapMoveEndTmr = setTimeout(() => {
        void this.reverseGeocodeMapToAddress();
      }, 300);
    });
  }

  private setCoordsFromCenter(lat: number, lon: number, opts: { emit: boolean }): void {
    const latStr = Number(lat).toFixed(this.coordDecimals);
    const lonStr = Number(lon).toFixed(this.coordDecimals);
    this.form.controls.lat.setValue(latStr, { emitEvent: opts.emit });
    this.form.controls.lon.setValue(lonStr, { emitEvent: opts.emit });
  }

  private async geocodeAddressToMap(): Promise<void> {
    const v = this.addressPartsOf(this.form.getRawValue());
    if (!v.city && !v.street) return;

    const requestId = ++this.geocodeRequestId;
    const q = this.buildAddressQuery();
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=1&accept-language=he,en`;

    try {
      const res = await fetch(url, { headers: this.nominatimHeaders() });
      if (!res.ok || requestId !== this.geocodeRequestId) return;

      const data: { lat?: string; lon?: string }[] = await res.json();
      const first = data?.[0];
      if (!first?.lat || !first?.lon) return;

      const lat = Number(first.lat);
      const lon = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      this.suppressMapToAddress = true;
      this.setCoordsFromCenter(lat, lon, { emit: false });

      const map = this.map;
      if (!map) {
        this.suppressMapToAddress = false;
        return;
      }

      const finish = () => {
        this.suppressMapToAddress = false;
      };
      map.once('moveend', finish);
      map.flyTo({ center: [lon, lat], zoom: 16, essential: true });
    } catch {
      this.suppressMapToAddress = false;
    }
  }

  private async reverseGeocodeMapToAddress(): Promise<void> {
    if (!this.map) return;

    const requestId = ++this.reverseGeocodeRequestId;
    const center = this.map.getCenter();
    const lat = center.lat;
    const lon = center.lng;

    this.setCoordsFromCenter(lat, lon, { emit: false });

    const structured = await this.fetchStructuredAddressFromCoordinates(lat, lon);
    if (!structured || requestId !== this.reverseGeocodeRequestId) return;

    this.form.patchValue(
      {
        city: structured.city,
        street: structured.street,
        houseNumber: structured.houseNumber,
        postalCode: structured.postalCode,
      },
      // Do not emit events here, otherwise the address change triggers geocoding and re-animates the map.
      { emitEvent: false },
    );
  }

  private nominatimHeaders(): HeadersInit {
    return {
      Accept: 'application/json',
      'User-Agent': 'Eazix-PrintingHouses-Front',
    };
  }

  private async fetchStructuredAddressFromCoordinates(
    lat: number,
    lon: number,
  ): Promise<{ city: string; street: string; houseNumber: string; postalCode: string } | null> {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=he,en`;

    try {
      const res = await fetch(url, { headers: this.nominatimHeaders() });
      if (!res.ok) return null;

      const data = await res.json();
      if (!data?.address) return null;

      const addr = data.address;
      return {
        city: this.resolveSettlementFromNominatim(addr),
        street: String(addr.road || addr.street || addr.pedestrian || addr.footway || addr.path || '').trim(),
        houseNumber: String(addr.house_number || '').trim(),
        postalCode: String(addr.postcode || '').trim(),
      };
    } catch {
      return null;
    }
  }

  /** Israeli settlements: prefer village/hamlet over regional council names (from phprint). */
  private resolveSettlementFromNominatim(addr: Record<string, unknown>): string {
    const v = (s: unknown) => (s && String(s).trim()) || '';
    const village = v(addr['village']);
    const hamlet = v(addr['hamlet']);
    const locality = v(addr['locality']);
    const town = v(addr['town']);
    const city = v(addr['city']);
    const municipality = v(addr['municipality']);

    const badAdminPrefixes = ['מועצה אזורית', 'מועצה מקומית', 'עיריית', 'עיריה'];
    const isBadAdmin = (s: string) => badAdminPrefixes.some((p) => s.startsWith(p));
    const cityIsBadAdmin = city && isBadAdmin(city);
    const munIsBadAdmin = municipality && isBadAdmin(municipality);

    if (cityIsBadAdmin || munIsBadAdmin) {
      return village || hamlet || locality || town || city || municipality || '';
    }

    return (
      village ||
      hamlet ||
      locality ||
      town ||
      city ||
      municipality ||
      v(addr['residential']) ||
      v(addr['state_district']) ||
      v(addr['state']) ||
      v(addr['county']) ||
      v(addr['suburb']) ||
      ''
    );
  }
}
