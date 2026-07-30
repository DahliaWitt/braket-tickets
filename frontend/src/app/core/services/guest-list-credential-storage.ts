import type {BrowserPlatformService} from './browser-platform.service';

export const GUEST_LIST_TOKEN_STORAGE_PREFIX = 'bt-guest-list-token:';
export const GUEST_LIST_RECENT_ASSIGNMENT_STORAGE_KEY =
  'bt-guest-list-recent-assignment';

type GuestListCredentialStorage = Pick<
  BrowserPlatformService,
  'removeLocalStorageItem' | 'removeLocalStorageItemsWithPrefix'
>;

export function guestListTokenStorageKey(assignmentId: string): string {
  return `${GUEST_LIST_TOKEN_STORAGE_PREFIX}${assignmentId}`;
}

export function forgetAllGuestListCredentials(
  storage: GuestListCredentialStorage,
): void {
  storage.removeLocalStorageItemsWithPrefix(GUEST_LIST_TOKEN_STORAGE_PREFIX);
  storage.removeLocalStorageItem(GUEST_LIST_RECENT_ASSIGNMENT_STORAGE_KEY);
}
