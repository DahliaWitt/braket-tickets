import {inject, Injectable} from '@angular/core';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';

const TOKEN_PREFIX = 'bt-guest-list-token:';
const RECENT_ASSIGNMENT_KEY = 'bt-guest-list-recent-assignment';

@Injectable({providedIn: 'root'})
export class GuestListAssignmentTokenStoreService {
  private readonly browser = inject(BrowserPlatformService);

  /**
   * Captures a fragment credential and scrubs it synchronously before making
   * the value available to any resolver, logger, or analytics integration.
   */
  captureCredentialFromFragment(): string | null {
    const hash = this.browser.locationHash();
    if (hash === null) return null;

    this.browser.replaceUrlWithoutHash();
    const token = new URLSearchParams(
      hash.startsWith('#') ? hash.slice(1) : hash,
    )
      .get('token')
      ?.trim();
    return token || null;
  }

  get(assignmentId: string): string | null {
    return this.browser.getLocalStorageItem(this.storageKey(assignmentId));
  }

  getMostRecent(): {assignmentId: string; token: string} | null {
    const assignmentId = this.browser.getLocalStorageItem(
      RECENT_ASSIGNMENT_KEY,
    );
    if (!assignmentId) return null;
    const token = this.get(assignmentId);
    return token ? {assignmentId, token} : null;
  }

  rememberResolvedAssignment(assignmentId: string, token: string): void {
    this.browser.setLocalStorageItem(this.storageKey(assignmentId), token);
    this.browser.setLocalStorageItem(RECENT_ASSIGNMENT_KEY, assignmentId);
  }

  forget(assignmentId: string): void {
    this.browser.removeLocalStorageItem(this.storageKey(assignmentId));
    if (
      this.browser.getLocalStorageItem(RECENT_ASSIGNMENT_KEY) === assignmentId
    ) {
      this.browser.removeLocalStorageItem(RECENT_ASSIGNMENT_KEY);
    }
  }

  forgetAll(): void {
    this.browser.removeLocalStorageItemsWithPrefix(TOKEN_PREFIX);
    this.browser.removeLocalStorageItem(RECENT_ASSIGNMENT_KEY);
  }

  private storageKey(assignmentId: string): string {
    return `${TOKEN_PREFIX}${assignmentId}`;
  }
}
