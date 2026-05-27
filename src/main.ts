/// <reference types="@angular/localize" />

import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { applyShellVhCssVariable } from './app/shell-viewport';

import { registerLocaleData } from '@angular/common';
import localeHe from '@angular/common/locales/he';
import localeEn from '@angular/common/locales/en';
import localeAr from '@angular/common/locales/ar';

applyShellVhCssVariable(document, window, 0);

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err =>
    console.error(err)
  );

if (localStorage.getItem('language') === 'en') {
  registerLocaleData(localeEn);
} else if (localStorage.getItem('language') === 'ar') {
  registerLocaleData(localeAr);
} else {
  registerLocaleData(localeHe);
}


// TAB CLICK
let currentTabIndex = 0;

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Tab') return;

  const tabbables = getTabElements();
  if (!tabbables.length) return;

  const active = document.activeElement;
  let idx = tabbables.findIndex(el => el === active);

  if (idx !== -1) {
    currentTabIndex = idx + (e.shiftKey ? -1 : 1);
  } else {
    currentTabIndex = 0;
  }

  if (currentTabIndex >= tabbables.length) currentTabIndex = 0;
  if (currentTabIndex < 0) currentTabIndex = tabbables.length - 1;

  let tried = 0;

  function tryFocusNext() {
    if (tried >= tabbables.length) return;
    tabbables[currentTabIndex].focus();
    setTimeout(() => {
      if (document.activeElement !== tabbables[currentTabIndex]) {
        currentTabIndex = (currentTabIndex + 1) % tabbables.length;
        tried++;
        tryFocusNext();
      }
    }, 0);
  }

  tryFocusNext();

  e.preventDefault();
});

function getTabElements(): HTMLElement[] {
  const dialogContainer = document.querySelector('mat-dialog-container');
  let nodeList = document.querySelectorAll('button, a, input, select, textarea, .my-tab-focus');
  if (dialogContainer) {
    nodeList = dialogContainer.querySelectorAll('button, a, input, select, textarea, .my-tab-focus');
  }
  const all = Array.from(nodeList).filter(
    (el, idx, arr) => arr.indexOf(el) === idx
  ).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      !el.hasAttribute('disabled') &&
      el.tabIndex !== -1 &&
      (el.offsetWidth > 0 || el.offsetHeight > 0)
  );
  return all;
}
