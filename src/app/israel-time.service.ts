import { Injectable } from '@angular/core';

/**
 * Returns the current time in Israel timezone (Asia/Jerusalem).
 * Ensures consistent time display regardless of browser/location.
 * Use this instead of new Date() when comparing with server timestamps or for expiration checks.
 */
@Injectable({
  providedIn: 'root',
})
export class IsraelTimeService {

  /**
   * Returns the current Date in Israel timezone (Asia/Jerusalem).
   */
  getNowTime(): Date {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(now);
    const year = parseInt(parts.find(p => p.type === 'year')?.value || '0');
    const month = parseInt(parts.find(p => p.type === 'month')?.value || '0') - 1;
    const day = parseInt(parts.find(p => p.type === 'day')?.value || '0');
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const second = parseInt(parts.find(p => p.type === 'second')?.value || '0');

    return new Date(year, month, day, hour, minute, second);
  }
}
