import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';

import { AuthService } from '../auth.service';

@Component({
  selector: 'app-social',
  templateUrl: './social.component.html',
  styleUrls: ['./social.component.css'],
  host: {
    class: 'fill-screen-modal',
  },
})
export class SocialComponent implements OnInit {
  constructor(
    private router: Router,
    public authService: AuthService,
    private activatedRoute: ActivatedRoute,
  ) { }

  ngOnInit() {
    this.activatedRoute.queryParams.subscribe(params => {
      const queryParamsObject: { [p: string]: any } = { ...params };
      const now = new Date();
      const expiresInSec = Number(queryParamsObject['expiresIn']) || 0;

      this.authService.saveAuthData(
        queryParamsObject['token'],
        new Date(now.getTime() + expiresInSec * 1000),
        queryParamsObject['userId'],
        '',
        '',
        queryParamsObject['language'],
        queryParamsObject['roles'],
        queryParamsObject['userName'],
        queryParamsObject['email'],
      );
      this.authService.autoAuthUser();

      const oauthUserId = queryParamsObject['userId'];
      if (this.authService.navigatePostLoginSystemChatAfterSocialIfNeeded(oauthUserId)) {
        return;
      }
      this.router.navigate(['/']);
    });
  }
}
