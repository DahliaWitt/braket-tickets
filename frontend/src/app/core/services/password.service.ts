import {Injectable, inject} from '@angular/core';
import {injectConvex} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {logger} from '@/utils/logger';
import {retryWithDelays} from '@/utils/async-control';
import {isRetryableAuthBackendError} from '@/core/utils/auth.utils';
import {isCompromisedPasswordError} from '@/core/utils/auth-error-codes';
import {COMPROMISED_PASSWORD_MESSAGE} from '@shared/constants';
import {AUTH_CLIENT} from './auth-client.token';
import {BrowserPlatformService} from './browser-platform.service';

/**
 * Handles password reset, change, and email verification requests.
 * Pure Better Auth / Convex calls with no session state dependencies.
 *
 * Note: `confirmVerification` lives in AuthService because it writes
 * to the private session signal and calls updateConvexAuth().
 */
@Injectable({
  providedIn: 'root',
})
export class PasswordService {
  private convex = injectConvex();
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly browser = inject(BrowserPlatformService);

  /**
   * Sends a password reset email to the specified address.
   * Server returns success even for non-existent emails to prevent enumeration.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const {error} = await this.authClient.requestPasswordReset({
      email,
      redirectTo: this.browser.absoluteUrl('/confirm/password-reset'),
    });

    if (error) {
      logger.error('Password reset request failed:', error);
      throw new Error(error.message || 'Failed to send password reset email');
    }

    logger.info('Password reset email requested for:', email);
  }

  /**
   * Completes password reset using the token from the reset email.
   *
   * @param _emailArg - Unused; kept for API compatibility
   */
  async confirmPasswordReset(
    token: string,
    password: string,
    confirmPassword: string,
    _emailArg?: string,
  ): Promise<void> {
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match');
    }

    const {error} = await this.authClient.resetPassword({
      newPassword: password,
      token,
    });

    if (error) {
      if (isCompromisedPasswordError(error)) {
        // Expected, user-recoverable rejection — not an error-level event.
        throw new Error(COMPROMISED_PASSWORD_MESSAGE, {cause: error});
      }
      logger.error('Password reset confirmation failed:', error);
      const message = error.message || '';
      if (
        message.toLowerCase().includes('expired') ||
        message.toLowerCase().includes('invalid')
      ) {
        throw new Error(
          'Password reset link has expired. Please request a new one.',
        );
      }
      throw new Error(error.message || 'Failed to reset password');
    }

    logger.info('Password reset completed successfully');
  }

  /**
   * Changes password for the currently authenticated user.
   * Calls a Convex mutation which wraps the Better Auth changePassword API.
   * Direct client calls don't work with the cross-domain auth setup.
   */
  async updatePassword(
    oldPassword: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<void> {
    if (newPassword !== confirmPassword) {
      throw new Error('New passwords do not match');
    }

    try {
      const retryDelaysMs = [0, 300, 900, 1800, 3000] as const;
      await retryWithDelays({
        delaysMs: retryDelaysMs,
        run: async () => {
          await this.convex.mutation(api.auth.public.changePassword, {
            currentPassword: oldPassword,
            newPassword,
            revokeOtherSessions: true,
          });
          logger.info('Password updated successfully');
        },
        shouldRetry: (err, attemptIndex) => {
          const shouldRetry =
            isRetryableAuthBackendError(err) &&
            attemptIndex < retryDelaysMs.length - 1;
          if (shouldRetry) {
            logger.warn(
              `[updatePassword] Attempt ${attemptIndex + 1}/${retryDelaysMs.length} failed; retrying`,
              err,
            );
          }
          return shouldRetry;
        },
      });
    } catch (err) {
      logger.error('Password update failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.toLowerCase().includes('incorrect') ||
        message.toLowerCase().includes('wrong')
      ) {
        throw new Error('Current password is incorrect', {cause: err});
      }
      if (
        message.toLowerCase().includes('invalid') &&
        message.toLowerCase().includes('password')
      ) {
        throw new Error('Current password is incorrect', {cause: err});
      }
      throw new Error(message || 'Failed to update password', {cause: err});
    }
  }

  /**
   * Requests a new verification email for an unverified account.
   */
  async requestVerificationEmail(email: string): Promise<void> {
    const {error} = await this.authClient.sendVerificationEmail({
      email,
      callbackURL: this.browser.absoluteUrl('/login'),
    });

    if (error) {
      logger.error('Verification email request failed:', error);
      throw new Error(error.message || 'Failed to send verification email');
    }

    logger.info('Verification email requested for:', email);
  }
}
