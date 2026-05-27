import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, ReplaySubject, Subject } from 'rxjs';
import { environment } from 'src/environments/environment';
import { Router } from '@angular/router';

import { AuthData } from './auth-data.model';
import { DialogService } from '../dialog/dialog.service';
import { DirectionService } from '../direction.service';

const BACKEND_URL = environment.apiUrl + '/user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private isAuthenticated = false;
  private token: string;
  private tokenTimer: any;
  private userId: string;
  private authStatusListener = new Subject<boolean>();

  private rolesSubject = new ReplaySubject<string[]>(1);
  public roles$ = this.rolesSubject.asObservable();
  private userNameSubject = new BehaviorSubject<string>('');
  public userName$ = this.userNameSubject.asObservable();
  private emailSubject = new BehaviorSubject<string>('');
  public email$ = this.emailSubject.asObservable();

  selectedLanguage: string = 'he';
  private authCompleted = new Subject<void>();

  private user: any;
  private userUpdated = new Subject<any>();
  userUpdated$ = this.userUpdated.asObservable();

  /** Public routes that don't redirect to `/` on logout. */
  private static readonly PUBLIC_ROUTES = ['/tandc', '/terms', '/pp', '/privacy', '/home'];

  constructor(
    private http: HttpClient,
    private dialogService: DialogService,
    private router: Router,
    private directionService: DirectionService,
  ) {
    this.directionService.currentLanguage$.subscribe(lang => {
      this.selectedLanguage = lang;
    });
  }

  getToken() {
    return this.token;
  }

  getIsAuth() {
    return this.isAuthenticated;
  }

  getUserId() {
    return this.userId;
  }

  getEmail() {
    const email = localStorage.getItem('email');
    if (email && email !== 'undefined' && email.trim() !== '') {
      return email;
    }
    const subjectEmail = this.emailSubject.value;
    if (subjectEmail && subjectEmail !== 'undefined' && subjectEmail.trim() !== '') {
      return subjectEmail;
    }
    return '';
  }

  getAuthStatusListener() {
    return this.authStatusListener.asObservable();
  }

  createUser(email: string, password: string, provider: string = 'local') {
    const authData: AuthData = {
      email: email,
      password: password,
      printingService: '',
      branch: '',
      provider: provider,
      language: this.selectedLanguage,
    };
    this.http
      .post<{
        token: string,
        expiresIn: number,
        userId: string,
        home_printingServices_list: string[],
        home_branches_list: string[],
        provider: string,
        language: string,
        roles: string[],
        userName: string,
        email: string,
      }>(BACKEND_URL + '/signup', authData).subscribe({
        next: (response) => {
          this.handleSuccessfulAuth(response, authData);
        },
        error: (error) => {
          if (error.error && error.error.token) {
            this.handleSuccessfulAuth(error.error, authData);
            return;
          }
          console.error('Signup error:', error);
          this.authStatusListener.next(false);
        }
      });
  }

  checkEmail(email: string): Observable<any> {
    return this.http.post<boolean>(BACKEND_URL + '/checkemail', { email: email });
  }

  facebookLogin() {
    this.setIsFromSocial();
    this.http.get(BACKEND_URL + '/auth/facebook').subscribe(response => {
      window.location.href = response['url'];
      this.triggerAuthComplete();
    });
  }

  googleLogin() {
    this.setIsFromSocial();
    this.http.get(BACKEND_URL + '/auth/google').subscribe(response => {
      window.location.href = response['url'];
      this.triggerAuthComplete();
    });
  }

  setIsFromSocial() {
    localStorage.setItem('isfromSocial', 'true');
  }

  login(email: string, password: string, provider: string = 'local') {
    const authData: AuthData = {
      email: email,
      password: password,
      printingService: '',
      branch: '',
      provider: provider,
      language: '',
    };
    this.http
      .post<{
        token: string,
        expiresIn: number,
        userId: string,
        home_printingServices_list: string[],
        home_branches_list: string[],
        provider: string,
        language: string,
        roles: string[],
        userName: string,
        email: string,
      }>(BACKEND_URL + '/login', authData)
      .subscribe({
        next: (response) => this.handleSuccessfulAuth(response, authData),
        error: () => this.authStatusListener.next(false),
      });
  }

  private handleSuccessfulAuth(
    response: {
      token: string;
      expiresIn: number;
      userId: string;
      language: string;
      roles: string[];
      userName: string;
      email: string;
    },
    _authData: AuthData,
  ): void {
    const token = response.token;
    this.token = token;
    if (!token) {
      return;
    }
    const expiresInDuration = response.expiresIn;
    this.setAuthTimer(expiresInDuration);
    this.isAuthenticated = true;
    this.userId = response.userId;
    this.authStatusListener.next(true);
    const now = new Date();
    const expirationDate = new Date(now.getTime() + expiresInDuration * 1000);
    this.rolesSubject.next(response.roles);
    this.saveAuthData(
      token,
      expirationDate,
      response.userId,
      '',
      '',
      response.language,
      response.roles,
      response.userName,
      response.email,
    );
    if (response.language && response.language !== '') {
      this.directionService.toLanguageDirection(response.language);
    }
    this.dialogService.onCloseLoginDialog();
    this.triggerAuthComplete();
    this.updateUser(null);
    this.router.navigate(['/']);
  }

  triggerAuthComplete() {
    this.authCompleted.next();
  }

  autoAuthUser() {
    const authInformation = this.getAuthData();
    if (!authInformation) {
      return;
    }
    const now = new Date();
    const expiresIn = authInformation.expirationDate.getTime() - now.getTime();
    if (expiresIn > 0) {
      this.token = authInformation.token;
      this.isAuthenticated = true;
      this.userId = authInformation.userId;
      this.setAuthTimer(expiresIn / 1000);
      this.authStatusListener.next(true);
      this.rolesSubject.next(authInformation.roles);
      if (authInformation.language || authInformation.language === '') {
        this.directionService.toLanguageDirection(authInformation.language);
      }
      this.triggerAuthComplete();
    }
    this.userNameSubject.next(authInformation.userName);
    this.emailSubject.next(authInformation.email);
  }

  getAuthCompletedListener() {
    return this.authCompleted.asObservable();
  }

  logout(isRedirectToMain = true): Promise<void> {
    return new Promise((resolve) => {
      this.token = null;
      this.isAuthenticated = false;
      this.authStatusListener.next(false);
      this.userId = null;
      clearTimeout(this.tokenTimer);
      this.clearAuthData();
      this.rolesSubject.next([]);
      this.userNameSubject.next('');
      this.user = null;
      this.userUpdated.next(this.user);
      this.updateUser(null);
      if (isRedirectToMain) {
        const url = this.router.url.split('?')[0];
        const isOnPublicRoute = AuthService.PUBLIC_ROUTES.some(
          (r) => url === r || url.startsWith(r + '/')
        );
        if (!isOnPublicRoute) {
          const isAlreadyOnRoot = url === '/' || url === '';
          if (isAlreadyOnRoot) {
            resolve();
          } else {
            this.router.navigate(['/']).then(() => resolve());
          }
        } else {
          resolve();
        }
      } else {
        resolve();
      }
    });
  }

  private setAuthTimer(duration: number) {
    this.tokenTimer = setTimeout(() => {
      this.logout();
      this.dialogService.onOpenLoginDialog();
    }, duration * 1000);
  }

  saveAuthData(
    token: string,
    expirationDate: Date,
    userId: string,
    printingService: string,
    branch: string,
    language: string,
    roles: string[],
    userName: string,
    email: string,
  ) {
    localStorage.setItem('token', token);
    localStorage.setItem('expiration', expirationDate.toISOString());
    localStorage.setItem('userId', userId);
    localStorage.setItem('printingService', printingService || '');
    localStorage.setItem('branch', branch || '');
    localStorage.setItem('language', language || '');
    localStorage.setItem('roles', JSON.stringify(roles || []));
    localStorage.setItem('userName', userName || '');
    if (email && typeof email === 'string' && email.trim() !== '') {
      localStorage.setItem('email', email);
    }
    this.userNameSubject.next(userName || '');
  }

  private clearAuthData() {
    localStorage.removeItem('token');
    localStorage.removeItem('expiration');
    localStorage.removeItem('userId');
    localStorage.removeItem('printingService');
    localStorage.removeItem('branch');
    localStorage.removeItem('roles');
    localStorage.removeItem('userName');
    localStorage.removeItem('email');
    localStorage.removeItem('isfromSocial');
    localStorage.removeItem('hideLangModel');
  }

  /** Stub kept for compatibility with callers that referenced printingService/branch updates. */
  updateAuthData(printingService: string, branch: string) {
    localStorage.setItem('printingService', printingService || '');
    localStorage.setItem('branch', branch || '');
  }

  private getAuthData() {
    const token = localStorage.getItem('token');
    const expirationDate = localStorage.getItem('expiration');
    const userId = localStorage.getItem('userId');
    const language = localStorage.getItem('language');
    const rolesRaw = localStorage.getItem('roles');
    let roles: string[] = [];
    try {
      roles = rolesRaw ? JSON.parse(rolesRaw) : [];
    } catch {
      roles = [];
    }
    const userName = localStorage.getItem('userName');
    const email = localStorage.getItem('email');
    const invalidToken = !token || token === '' || token === 'undefined' || token === 'null';
    if (invalidToken || !expirationDate) {
      return false;
    }
    return {
      token: token,
      expirationDate: new Date(expirationDate),
      userId: userId,
      language: language,
      roles: roles,
      userName: userName,
      email: email,
    };
  }

  updateUser(user: any) {
    this.user = user;
    this.userUpdated.next(this.user);
  }

  /** Stub: in the original app this navigated to a system chat after social login. Always returns false here. */
  navigatePostLoginSystemChatAfterSocialIfNeeded(_userId: string): boolean {
    return false;
  }

  /** Stub: kept for compatibility. */
  clearPostLoginSystemChatIntent(): void {
    // no-op
  }

  onSendForgotPasswordEmail(email: string): Promise<any> {
    const url = `${BACKEND_URL}/forgotpassword/${email}`;
    return this.http.post<{}>(url, {}).toPromise();
  }

  onSubmitPassResetCode(email: string, code: string): Promise<any> {
    const url = `${BACKEND_URL}/checkresetpasswordcode/${email}/${code}`;
    return this.http.post<{}>(url, {}).toPromise();
  }

  onResetPassword(email: string, token: string, password: string): Promise<any> {
    const url = `${BACKEND_URL}/resetpassword/${email}`;
    return this.http.post<{}>(url, { token: token, password: password }).toPromise();
  }
}
