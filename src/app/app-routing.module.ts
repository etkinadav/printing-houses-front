import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { HomeComponent } from './home/home.component';
import { SocialComponent } from './auth/social/social.component';
import { TAndCComponent } from './legal/t-and-c/t-and-c.component';
import { PrivacyPolicyComponent } from './legal/privacy-policy/privacy-policy.component';
import { MyProfileComponent } from './my-profile/my-profile.component';
import { ProductCreateComponent } from './management/product-create/product-create.component';
import { CategoryEditComponent } from './management/category-edit/category-edit.component';
import { PrintingHouseJoinComponent } from './printing-house-join/printing-house-join.component';
import { PrintingHouseManagementComponent } from './management/printing-house-management/printing-house-management.component';
import { PrintingHousesListComponent } from './management/printing-houses-list/printing-houses-list.component';
import { PrintComponent } from './print/print.component';

import { AuthGuard } from './auth/auth.guard';

const routes: Routes = [
    { path: 'en', pathMatch: 'full', component: HomeComponent, data: { homeLang: 'en' } },
    { path: '', pathMatch: 'full', component: HomeComponent },
    { path: 'home', component: HomeComponent },

    { path: 'myprofile/:userId', component: MyProfileComponent },
    { path: 'myprofile/:userId/credit', component: MyProfileComponent },

    { path: 'tandc', component: TAndCComponent },
    { path: 'terms', component: TAndCComponent },
    { path: 'pp', component: PrivacyPolicyComponent },
    { path: 'privacy', component: PrivacyPolicyComponent },

    { path: 'social', component: SocialComponent },

    { path: 'print', component: PrintComponent, canActivate: [AuthGuard] },

    { path: 'management/product-create', component: ProductCreateComponent, canActivate: [AuthGuard] },
    {
      path: 'management/printing-house/:printingHouseId/product/create',
      component: ProductCreateComponent,
      canActivate: [AuthGuard],
    },
    {
      path: 'management/printing-house/:printingHouseId/product/:productId/edit',
      component: ProductCreateComponent,
      canActivate: [AuthGuard],
    },
    { path: 'management/category-edit', component: CategoryEditComponent },
    { path: 'join/printing-house', component: PrintingHouseJoinComponent, canActivate: [AuthGuard] },
    {
      path: 'management/printing-houses',
      component: PrintingHousesListComponent,
      canActivate: [AuthGuard],
    },
    {
      path: 'printing-house/:id',
      component: PrintingHouseManagementComponent,
      data: { phViewMode: 'user' },
    },
    { path: 'management/printing-house', component: PrintingHouseManagementComponent, canActivate: [AuthGuard] },
    {
      path: 'management/printing-house/:id',
      component: PrintingHouseManagementComponent,
      canActivate: [AuthGuard],
      data: { phViewMode: 'manager' },
    },

    { path: '**', redirectTo: '/' },
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule],
    providers: [AuthGuard],
})
export class AppRoutingModule { }
