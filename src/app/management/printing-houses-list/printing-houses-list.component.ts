import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { TranslateService } from '@ngx-translate/core';

import { DirectionService } from '../../direction.service';
import { PhPrintingHouseService } from '../../ph-printing-house/ph-printing-house.service';
import { PhPrintingHouse } from '../../ph-printing-house/ph-printing-house.model';

@Component({
  selector: 'app-printing-houses-list',
  templateUrl: './printing-houses-list.component.html',
  styleUrls: ['./printing-houses-list.component.css'],
  host: {
    class: 'fill-screen',
  },
})
export class PrintingHousesListComponent implements OnInit, OnDestroy {
  isRTL = true;
  isDarkMode = false;
  isLoading = true;
  hasError = false;
  printingHouses: PhPrintingHouse[] = [];

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;

  constructor(
    private phPrintingHouseService: PhPrintingHouseService,
    private directionService: DirectionService,
    private translate: TranslateService,
    private router: Router,
  ) {}

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
  }

  onAddPrintingHouse(): void {
    void this.router.navigate(['/join/printing-house']);
  }

  onOpenPrintingHouse(ph: PhPrintingHouse): void {
    if (!ph?._id) {
      return;
    }
    void this.router.navigate(['/management/printing-house', ph._id]);
  }

  phLogoUrl(ph: PhPrintingHouse): string {
    return (ph.logo?.url || ph.logoUrl || '').trim();
  }

  addressLine(ph: PhPrintingHouse): string {
    const addr = ph.address;
    if (!addr) {
      return '';
    }

    const parts: string[] = [];
    const streetLine = [addr.street, addr.houseNumber].filter((v) => !!v?.trim()).join(' ');
    if (streetLine) {
      parts.push(streetLine);
    }
    if (addr.city?.trim()) {
      parts.push(addr.city.trim());
    }

    const apartment = addr.apartment?.trim();
    if (apartment) {
      parts.push(`${this.translate.instant('printing-house-join.apartment')} ${apartment}`);
    }

    const floor = addr.floor?.trim();
    if (floor) {
      parts.push(`${this.translate.instant('printing-house-join.floor')} ${floor}`);
    }

    const notes = addr.notes?.trim();
    if (notes) {
      parts.push(notes);
    }

    return parts.join(', ');
  }

  load(): void {
    this.isLoading = true;
    this.hasError = false;

    this.phPrintingHouseService.listMine().subscribe({
      next: (res) => {
        this.printingHouses = res.printingHouses ?? [];
        this.isLoading = false;
      },
      error: (err) => {
        console.error('list printing houses failed', err);
        this.printingHouses = [];
        this.hasError = true;
        this.isLoading = false;
      },
    });
  }
}
