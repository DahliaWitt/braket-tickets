import '../../../../test-setup';
import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {GuestListAssignmentTokenStoreService} from './guest-list-assignment-token-store.service';

describe('GuestListAssignmentTokenStoreService', () => {
  const calls: string[] = [];
  const storage = new Map<string, string>();
  const browser = {
    locationHash: vi.fn<() => string | null>(),
    replaceUrlWithoutHash: vi.fn(() => calls.push('scrub')),
    getLocalStorageItem: vi.fn((key: string) => storage.get(key) ?? null),
    setLocalStorageItem: vi.fn((key: string, value: string) => {
      calls.push(`store:${key}`);
      storage.set(key, value);
    }),
    removeLocalStorageItem: vi.fn((key: string) => storage.delete(key)),
    getLocalStorageKeys: vi.fn(() => [...storage.keys()]),
    removeLocalStorageItemsWithPrefix: vi.fn((prefix: string) => {
      for (const key of storage.keys()) {
        if (key.startsWith(prefix)) storage.delete(key);
      }
    }),
  };

  let service: GuestListAssignmentTokenStoreService;

  beforeEach(() => {
    calls.length = 0;
    storage.clear();
    vi.clearAllMocks();
    browser.locationHash.mockReturnValue('#token=invite-secret');

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {provide: BrowserPlatformService, useValue: browser},
      ],
    });
    service = TestBed.inject(GuestListAssignmentTokenStoreService);
  });

  it('scrubs the fragment before returning a credential to the caller', () => {
    const token = service.captureCredentialFromFragment();
    calls.push('resolve');

    expect(token).toBe('invite-secret');
    expect(calls).toEqual(['scrub', 'resolve']);
  });

  it('does not expose or store malformed fragments', () => {
    browser.locationHash.mockReturnValue('#utm_source=email');

    expect(service.captureCredentialFromFragment()).toBeNull();
    expect(browser.replaceUrlWithoutHash).toHaveBeenCalledOnce();
    expect(storage.size).toBe(0);
  });

  it('does nothing during server rendering', () => {
    browser.locationHash.mockReturnValue(null);

    expect(service.captureCredentialFromFragment()).toBeNull();
    expect(browser.replaceUrlWithoutHash).not.toHaveBeenCalled();
  });

  it('persists a credential only after the caller confirms a successful resolve', () => {
    const token = service.captureCredentialFromFragment();

    expect(storage.size).toBe(0);
    service.rememberResolvedAssignment('assignment-1', token!);

    expect(service.get('assignment-1')).toBe('invite-secret');
    expect(service.getMostRecent()).toEqual({
      assignmentId: 'assignment-1',
      token: 'invite-secret',
    });
  });

  it('clears an unavailable assignment and its recent pointer', () => {
    service.rememberResolvedAssignment('assignment-1', 'invite-secret');

    service.forget('assignment-1');

    expect(service.get('assignment-1')).toBeNull();
    expect(service.getMostRecent()).toBeNull();
  });
});
