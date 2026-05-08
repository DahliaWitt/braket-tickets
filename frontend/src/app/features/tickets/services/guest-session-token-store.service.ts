import { inject, Injectable } from '@angular/core';

import { BrowserPlatformService } from '@/core/services/browser-platform.service';

const GUEST_SESSION_TOKEN_STORAGE_PREFIX = 'bt-guest-session-token:';

@Injectable({
  providedIn: 'root',
})
export class GuestSessionTokenStoreService {
  private readonly browser = inject(BrowserPlatformService);

  get(email: string): string | null {
    return this.browser.getLocalStorageItem(this.storageKey(email));
  }

  set(email: string, sessionToken: string): void {
    this.browser.setLocalStorageItem(this.storageKey(email), sessionToken);
  }

  private storageKey(email: string): string {
    return `${GUEST_SESSION_TOKEN_STORAGE_PREFIX}${email.trim().toLowerCase()}`;
  }
}
