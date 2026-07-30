import '../../../test-setup';
import {describe, expect, it, vi} from 'vitest';
import {
  forgetAllGuestListCredentials,
  GUEST_LIST_RECENT_ASSIGNMENT_STORAGE_KEY,
  GUEST_LIST_TOKEN_STORAGE_PREFIX,
  guestListTokenStorageKey,
} from './guest-list-credential-storage';

describe('guest-list credential storage', () => {
  it('uses one canonical key format for assignment credentials', () => {
    expect(guestListTokenStorageKey('assignment-1')).toBe(
      `${GUEST_LIST_TOKEN_STORAGE_PREFIX}assignment-1`,
    );
  });

  it('clears all guest-list credentials through the core-safe storage contract', () => {
    const storage = {
      removeLocalStorageItemsWithPrefix: vi.fn(),
      removeLocalStorageItem: vi.fn(),
    };

    forgetAllGuestListCredentials(storage);

    expect(storage.removeLocalStorageItemsWithPrefix).toHaveBeenCalledWith(
      GUEST_LIST_TOKEN_STORAGE_PREFIX,
    );
    expect(storage.removeLocalStorageItem).toHaveBeenCalledWith(
      GUEST_LIST_RECENT_ASSIGNMENT_STORAGE_KEY,
    );
  });
});
