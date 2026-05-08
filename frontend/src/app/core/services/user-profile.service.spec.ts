import {TestBed} from '@angular/core/testing';
import {UserProfileService} from '@/core/services/user-profile.service';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {CONVEX} from 'convex-angular';

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  },
}));

describe('UserProfileService', () => {
  let service: UserProfileService;
  let convexClientMock: {
    mutation: ReturnType<typeof vi.fn>;
    action: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    convexClientMock = {
      mutation: vi.fn().mockResolvedValue({success: true}),
      action: vi.fn().mockResolvedValue([]),
    };

    TestBed.configureTestingModule({
      providers: [
        UserProfileService,
        {provide: CONVEX, useValue: convexClientMock},
      ],
    });

    service = TestBed.inject(UserProfileService);
  });

  describe('requestEmailChange', () => {
    it('should call auth.public.requestEmailChange with callback URL', async () => {
      await service.requestEmailChange('new-email@example.com');

      expect(convexClientMock.mutation).toHaveBeenCalled();
      const firstCall = convexClientMock.mutation.mock.calls[0];
      const payload = firstCall?.[1] as {newEmail: string; callbackURL: string};
      expect(payload.newEmail).toBe('new-email@example.com');
      expect(payload.callbackURL).toMatch(
        /\/confirm\/email-change\?flow=email-change$/,
      );
      expect(payload.callbackURL).toContain(window.location.origin);
    });

    it('should throw when backend returns failure', async () => {
      convexClientMock.mutation.mockResolvedValue({
        success: false,
        message: 'Email taken',
      });

      await expect(
        service.requestEmailChange('taken@example.com'),
      ).rejects.toThrow('Email taken');
    });
  });

  describe('updateProfile', () => {
    it('should call users.update with profile data', async () => {
      convexClientMock.mutation.mockResolvedValue(undefined);

      await service.updateProfile({name: 'New Name'});

      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        expect.anything(),
        {
          name: 'New Name',
        },
      );
    });
  });

  describe('getExternalAuths', () => {
    it('should call users.getConnectedAccounts action', async () => {
      convexClientMock.action.mockResolvedValue([{provider: 'google'}]);

      const result = await service.getExternalAuths();

      expect(convexClientMock.action).toHaveBeenCalled();
      expect(result).toEqual([{provider: 'google'}]);
    });
  });

  describe('getFileUrl', () => {
    it('should return HTTP URLs as-is', () => {
      expect(service.getFileUrl(null, 'http://example.com/img.jpg')).toBe(
        'http://example.com/img.jpg',
      );
      expect(service.getFileUrl(null, 'https://example.com/img.jpg')).toBe(
        'https://example.com/img.jpg',
      );
    });

    it('should return empty string for non-HTTP filenames', () => {
      expect(service.getFileUrl(null, 'local-file.jpg')).toBe('');
    });

    it('should return empty string for empty input', () => {
      expect(service.getFileUrl(null, '')).toBe('');
    });
  });
});
