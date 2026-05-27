import { Component, OnInit, OnDestroy, Inject, ChangeDetectorRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

import { DirectionService } from '../../direction.service';
import { AuthService } from 'src/app/auth/auth.service';
import { DialogService } from 'src/app/dialog/dialog.service';

import { UsersService } from 'src/app/user/users.service';

import { TranslateService } from '@ngx-translate/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-language-change',
  templateUrl: './language-change.component.html',
  styleUrls: ['./language-change.component.css'],
  host: {
    class: 'fill-screen-modal-language-change',
  },
})
export class LanguageChangeComponent implements OnInit, OnDestroy {
  isRTL: boolean = true;
  private directionSubscription: Subscription;
  isDarkMode: boolean = false;
  isLoading: boolean = false;

  private authStatusSub: Subscription;

  usedLanguage: string = 'he';
  browserLanguage: string = null;
  userIsAuthenticated = false;

  translatedTextTitle: string = '';
  translatedTextBtn: string = '';
  translatedTextClose: string = '';

  userId: string = null;
  isHover: boolean = false;

  constructor(
    private directionService: DirectionService,
    private authService: AuthService,
    private dialogService: DialogService,
    private usersService: UsersService,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private translate: TranslateService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
  ) {
    this.usedLanguage = data.usedLanguage;
    this.browserLanguage = data.browserLanguage;
  }

  async ngOnInit() {
    this.isLoading = true;
    this.directionSubscription = this.directionService.direction$.subscribe(direction => {
      this.isRTL = direction === 'rtl';
    });

    this.directionService.isDarkMode$.subscribe(isDarkMode => {
      this.isDarkMode = isDarkMode;
    });

    this.userIsAuthenticated = this.authService.getIsAuth();
    this.authStatusSub = this.authService
      .getAuthStatusListener()
      .subscribe(isAuthenticated => {
        this.userIsAuthenticated = isAuthenticated;
        this.userId = this.authService.getUserId();
        this.cdr.detectChanges();
      });

    this.translatedTextTitle = await this.getTranslationFromFile(this.browserLanguage, 'title');
    this.translatedTextBtn = await this.getTranslationFromFile(this.browserLanguage, 'btn');
    this.translatedTextClose = await this.getTranslationFromFile(this.browserLanguage, 'close');

    this.isLoading = false;

    setTimeout(() => {
      setInterval(() => {
        if (!this.isHover) {
          this.closeLanguageChangeDialog();
        }
      }, 2000);
    }, 8000);
  }

  closeLanguageChangeDialog() {
    localStorage.setItem('hideLangModel', this.usedLanguage);
    this.dialogService.onCloseLanguageChangeDialog();
  }

  ngOnDestroy() {
    if (this.directionSubscription) {
      this.directionSubscription.unsubscribe();
    }
    if (this.authStatusSub) {
      this.authStatusSub.unsubscribe();
    }
  }

  getTranslationFromFile(lang: string, text: string): Promise<string> {
    let modifiedLang = lang.toLowerCase();
    if (modifiedLang.length >= 2 && text) {
      modifiedLang = modifiedLang.substring(0, 2);
    } else {
      this.closeLanguageChangeDialog();
    }
    return this.http.get(`/assets/i18n/${modifiedLang}.json`).toPromise().then((translations: any) => {
      return translations['chainge-language.' + text] || '';
    });
  }

  chaingeLanguage() {
    let modifiedLang = this.browserLanguage.toLowerCase();
    if (modifiedLang.length >= 2) {
      modifiedLang = modifiedLang.substring(0, 2);
    }
    this.directionService.toLanguageDirection(modifiedLang);
    if (this.userIsAuthenticated && this.userId) {
      this.usersService.updateUserLanguage(modifiedLang);
    }
    this.dialogService.onCloseLanguageChangeDialog();
  }
}
