import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';

import { DirectionService } from '../../direction.service';
import { PhPrintingHouseService } from '../../ph-printing-house/ph-printing-house.service';
import { PhPrintingHouse } from '../../ph-printing-house/ph-printing-house.model';

@Component({
  selector: 'app-printing-house-management',
  templateUrl: './printing-house-management.component.html',
  styleUrls: ['./printing-house-management.component.css'],
  host: {
    class: 'fill-screen',
  },
})
export class PrintingHouseManagementComponent implements OnInit, OnDestroy {
  isRTL = true;
  isDarkMode = false;
  isLoading = true;
  hasError = false;

  printingHouse?: PhPrintingHouse;

  private directionSub?: Subscription;
  private darkModeSub?: Subscription;

  constructor(
    private directionService: DirectionService,
    private phPrintingHouseService: PhPrintingHouseService,
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

  load(): void {
    this.isLoading = true;
    this.hasError = false;

    this.phPrintingHouseService.getMyPrintingHouse().subscribe({
      next: (res) => {
        this.printingHouse = res.printingHouse;
        this.isLoading = false;
      },
      error: () => {
        this.hasError = true;
        this.isLoading = false;
      },
    });
  }
}

