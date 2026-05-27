import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { DirectionService } from '../direction.service';

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.css'],
    host: {
        class: 'fill-screen',
    },
})
export class HomeComponent implements OnInit, OnDestroy {
    isRTL: boolean = true;
    isDarkMode: boolean = false;
    private directionSubscription: Subscription;
    private darkModeSubscription: Subscription;

    constructor(private directionService: DirectionService) { }

    ngOnInit(): void {
        this.directionSubscription = this.directionService.direction$.subscribe(direction => {
            this.isRTL = direction === 'rtl';
        });
        this.darkModeSubscription = this.directionService.isDarkMode$.subscribe(isDarkMode => {
            this.isDarkMode = isDarkMode;
        });
    }

    ngOnDestroy(): void {
        this.directionSubscription?.unsubscribe();
        this.darkModeSubscription?.unsubscribe();
    }
}
