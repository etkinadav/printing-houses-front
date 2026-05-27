import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { HomeComponent } from './home/home.component';
import { SocialComponent } from './auth/social/social.component';
import { TAndCComponent } from './legal/t-and-c/t-and-c.component';
import { PrivacyPolicyComponent } from './legal/privacy-policy/privacy-policy.component';
import { MyProfileComponent } from './my-profile/my-profile.component';

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

    { path: '**', redirectTo: '/' },
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule],
    providers: [AuthGuard],
})
export class AppRoutingModule { }
