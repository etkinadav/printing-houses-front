import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, Subscription } from 'rxjs';
import * as maplibregl from 'maplibre-gl';

import { DirectionService } from '../direction.service';
import { getMapTilerStyleUrl } from '../maptiler/maptiler-style-url';

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
  private suppressGeocode = false;
  private suppressMapMove = false;
  private mapMoveEndTmr?: any;

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
  ) {}

  ngOnInit(): void {
    this.directionSub = this.directionService.direction$.subscribe((direction) => {
      this.isRTL = direction === 'rtl';
    });
    this.darkModeSub = this.directionService.isDarkMode$.subscribe((isDarkMode) => {
      this.isDarkMode = isDarkMode;
    });

    this.addressSub = this.form.valueChanges
      .pipe(
        debounceTime(450),
        distinctUntilChanged((a, b) => JSON.stringify(this.addressPartsOf(a)) === JSON.stringify(this.addressPartsOf(b))),
      )
      .subscribe(() => {
        if (this.suppressGeocode) return;
        void this.geocodeAndFlyToAddress();
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

    this.snackBar.open(
      this.translateService.instant('printing-house-join.submitted'),
      undefined,
      { duration: 3000 },
    );
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

    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: getMapTilerStyleUrl(),
      center: initialCenter,
      zoom: 12,
      attributionControl: false,
    });

    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    this.map.on('load', () => {
      this.setCoordsFromCenter(this.map!.getCenter().lat, this.map!.getCenter().lng, { emit: false });
    });

    this.map.on('moveend', () => {
      if (this.suppressMapMove) return;
      clearTimeout(this.mapMoveEndTmr);
      this.mapMoveEndTmr = setTimeout(() => {
        const c = this.map!.getCenter();
        this.suppressGeocode = true;
        this.setCoordsFromCenter(c.lat, c.lng, { emit: true });
        this.suppressGeocode = false;
      }, 80);
    });
  }

  private setCoordsFromCenter(lat: number, lon: number, opts: { emit: boolean }): void {
    const latStr = Number(lat).toFixed(this.coordDecimals);
    const lonStr = Number(lon).toFixed(this.coordDecimals);
    this.form.controls.lat.setValue(latStr, { emitEvent: opts.emit });
    this.form.controls.lon.setValue(lonStr, { emitEvent: opts.emit });
  }

  private async geocodeAndFlyToAddress(): Promise<void> {
    // require minimal address to avoid hammering
    if (!this.form.controls.city.value.trim() || !this.form.controls.street.value.trim()) return;

    const q = this.buildAddressQuery();
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=1&accept-language=he,en`;

    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          // Nominatim requires a valid User-Agent / Referer in some setups; browser sends it implicitly.
        },
      });
      if (!res.ok) return;
      const data: any[] = await res.json();
      const first = data?.[0];
      if (!first?.lat || !first?.lon) return;

      const lat = Number(first.lat);
      const lon = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      this.suppressMapMove = true;
      this.map?.flyTo({ center: [lon, lat], zoom: 16, essential: true });
      this.suppressMapMove = false;

      this.suppressGeocode = true;
      this.setCoordsFromCenter(lat, lon, { emit: true });
      this.suppressGeocode = false;
    } catch {
      // swallow network errors (front-only)
    }
  }
}
