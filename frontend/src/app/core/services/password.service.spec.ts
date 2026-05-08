import { TestBed } from '@angular/core/testing';
import { PasswordService } from '@/core/services/password.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CONVEX } from 'convex-angular';
import { createMockConvexClient, type MockConvexClient } from '@/testing/mock-types';
import { logger } from '@/utils/logger';
import { AUTH_CLIENT, type AuthClient } from './auth-client.token';

const authClient = {
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  sendVerificationEmail: vi.fn(),
};

describe('PasswordService', () => {
  let service: PasswordService;
  let convexClientMock: MockConvexClient;

  beforeEach(() => {
    // Keep shared setup-file mock implementations intact; reset only call history here.
    vi.clearAllMocks();
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    vi.spyOn(logger, 'verbose').mockImplementation(() => undefined);

    convexClientMock = createMockConvexClient();
    convexClientMock.mutation.mockResolvedValue(undefined);
    authClient.requestPasswordReset.mockResolvedValue({ error: null });
    authClient.resetPassword.mockResolvedValue({ error: null });
    authClient.sendVerificationEmail.mockResolvedValue({ error: null });

    TestBed.configureTestingModule({
      providers: [
        PasswordService,
        { provide: CONVEX, useValue: convexClientMock },
        { provide: AUTH_CLIENT, useValue: authClient as unknown as AuthClient },
      ],
    });

    service = TestBed.inject(PasswordService);
  });

  describe('updatePassword', () => {
    it('should retry transient backend timeout errors', async () => {
      convexClientMock.mutation
        .mockRejectedValueOnce(new Error('Function execution timed out (maximum duration: 1s)'))
        .mockResolvedValueOnce(undefined);

      await service.updatePassword('old-password', 'new-password', 'new-password');

      expect(convexClientMock.mutation).toHaveBeenCalledTimes(2);
    });

    it('should throw when new passwords do not match', async () => {
      await expect(service.updatePassword('old', 'new1', 'new2')).rejects.toThrow(
        'New passwords do not match',
      );
    });
  });

  describe('requestPasswordReset', () => {
    it('should call authClient.requestPasswordReset with email and redirect', async () => {
      (authClient.requestPasswordReset as ReturnType<typeof vi.fn>).mockResolvedValue({
        error: null,
      });

      await service.requestPasswordReset('user@example.com');

      expect(authClient.requestPasswordReset).toHaveBeenCalledWith({
        email: 'user@example.com',
        redirectTo: expect.stringContaining('/confirm/password-reset') as unknown,
      });
    });
  });

  describe('confirmPasswordReset', () => {
    it('should throw when passwords do not match', async () => {
      await expect(service.confirmPasswordReset('token', 'pass1', 'pass2')).rejects.toThrow(
        'Passwords do not match',
      );
    });

    it('should call authClient.resetPassword with token and new password', async () => {
      vi.mocked(authClient.resetPassword).mockResolvedValue({ error: null });

      await service.confirmPasswordReset('token123', 'newpass', 'newpass');

      expect(authClient.resetPassword).toHaveBeenCalledWith({
        newPassword: 'newpass',
        token: 'token123',
      });
    });
  });

  describe('requestVerificationEmail', () => {
    it('should call authClient.sendVerificationEmail', async () => {
      vi.mocked(authClient.sendVerificationEmail).mockResolvedValue({
        error: null,
      });

      await service.requestVerificationEmail('user@example.com');

      expect(authClient.sendVerificationEmail).toHaveBeenCalledWith({
        email: 'user@example.com',
        callbackURL: expect.stringContaining('/login') as unknown,
      });
    });
  });
});
