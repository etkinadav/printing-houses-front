import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { NgModule } from '@angular/core';

import { HttpClient, HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AuthInterceptor } from './auth/auth-interceptor';
import { ErrorInterceptor } from './error-interceptor';
import { AngularMaterialModule } from './angular-material.module';

import { MainNavComponent } from './main-nav/main-nav.component';
import { HomeComponent } from './home/home.component';

import { BidiModule } from '@angular/cdk/bidi';

import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { PreloginComponent } from './auth/prelogin/prelogin.component';
import { SocialComponent } from './auth/social/social.component';
import { TAndCComponent } from './legal/t-and-c/t-and-c.component';
import { PrivacyPolicyComponent } from './legal/privacy-policy/privacy-policy.component';

import { UsersModule } from './user/users.module';

import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { ErrorComponent } from './error/error.component';
import { PhoneComponent, PhoneFormatDialogDirective } from './dialog/phone/phone.component';
import { LanguageChangeComponent } from './dialog/language-change/language-change.component';
import { MyProfileComponent, PhoneFormatDirective } from './my-profile/my-profile.component';
import { ProductCreateComponent } from './management/product-create/product-create.component';
import { CategoryEditComponent } from './management/category-edit/category-edit.component';

import { MatProgressBarModule } from '@angular/material/progress-bar';

@NgModule({
  declarations: [
    AppComponent,
    MainNavComponent,
    HomeComponent,
    PreloginComponent,
    SocialComponent,
    TAndCComponent,
    PrivacyPolicyComponent,
    ErrorComponent,
    PhoneComponent,
    PhoneFormatDialogDirective,
    LanguageChangeComponent,
    MyProfileComponent,
    PhoneFormatDirective,
    ProductCreateComponent,
    CategoryEditComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    BrowserAnimationsModule,
    HttpClientModule,
    AngularMaterialModule,
    BidiModule,
    TranslateModule.forRoot({
      loader: {
        provide: TranslateLoader,
        useFactory: (http: HttpClient) =>
          new TranslateHttpLoader(http, './assets/i18n/', `.json?v=${new Date().getTime()}`),
        deps: [HttpClient],
      },
    }),
    UsersModule,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatProgressBarModule,
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
    { provide: 'Direction', useValue: 'ltr' },
  ],
  bootstrap: [AppComponent],
})
export class AppModule { }

export function HttpLoaderFactory(http: HttpClient): TranslateHttpLoader {
  return new TranslateHttpLoader(http);
}
