import {inject, Injectable} from '@angular/core';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {
  GUEST_LIST_RECENT_ASSIGNMENT_STORAGE_KEY,
  guestListTokenStorageKey,
} from '@/core/services/guest-list-credential-storage';

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
    return this.browser.getLocalStorageItem(
      guestListTokenStorageKey(assignmentId),
    );
  }

  getMostRecent(): {assignmentId: string; token: string} | null {
    const assignmentId = this.browser.getLocalStorageItem(
      GUEST_LIST_RECENT_ASSIGNMENT_STORAGE_KEY,
    );
    if (!assignmentId) return null;
    const token = this.get(assignmentId);
    return token ? {assignmentId, token} : null;
  }

  rememberResolvedAssignment(assignmentId: string, token: string): void {
    this.browser.setLocalStorageItem(
      guestListTokenStorageKey(assignmentId),
      token,
    );
    this.browser.setLocalStorageItem(
      GUEST_LIST_RECENT_ASSIGNMENT_STORAGE_KEY,
      assignmentId,
    );
  }

  forget(assignmentId: string): void {
    this.browser.removeLocalStorageItem(guestListTokenStorageKey(assignmentId));
    if (
      this.browser.getLocalStorageItem(
        GUEST_LIST_RECENT_ASSIGNMENT_STORAGE_KEY,
      ) === assignmentId
    ) {
      this.browser.removeLocalStorageItem(
        GUEST_LIST_RECENT_ASSIGNMENT_STORAGE_KEY,
      );
    }
  }
}
