import {Injectable, inject} from '@angular/core';
import {injectConvex} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {
  isAuthProviderId,
  type ExternalAuth,
} from '@/features/auth/models/external-auth.model';
import {BrowserPlatformService} from './browser-platform.service';
import {type FunctionReturnType} from 'convex/server';

type ConnectedAccount = FunctionReturnType<
  typeof api.users.profile.getConnectedAccounts
>[number];

/**
 * Handles user profile operations: profile updates, email changes,
 * external auth providers, and file URL resolution.
 * Pure delegation to Convex with no shared state.
 */
@Injectable({
  providedIn: 'root',
})
export class UserProfileService {
  private convex = injectConvex();
  private readonly browser = inject(BrowserPlatformService);

  /**
   * Retrieves list of external OAuth providers linked to current user's account.
   *
   * Note: This calls an action (not a query) because getConnectedAccounts needs
   * to access the Better Auth component via ctx.runQuery().
   */
  getExternalAuths(): Promise<ExternalAuth[]> {
    return this.convex
      .action(api.users.profile.getConnectedAccounts, {})
      .then((accounts) =>
        accounts.flatMap((account: ConnectedAccount) =>
          isAuthProviderId(account.provider)
            ? [{...account, provider: account.provider}]
            : [],
        ),
      );
  }

  /**
   * Updates the current user's profile information.
   */
  async updateProfile(profile: {name?: string}): Promise<void> {
    await this.convex.mutation(api.users.profile.update, profile);
  }

  /**
   * Initiates email address change for the current user.
   * Sends verification email to the new address.
   */
  async requestEmailChange(newEmail: string): Promise<void> {
    const result = await this.convex.mutation(
      api.auth.public.requestEmailChange,
      {
        newEmail,
        callbackURL: this.browser.absoluteUrl(
          '/confirm/email-change?flow=email-change',
        ),
      },
    );
    if (!result.success) {
      throw new Error(result.message || 'Failed to request email change');
    }
  }

  /**
   * Cancels a pending email change for the current user.
   */
  async cancelEmailChange(): Promise<void> {
    await this.convex.mutation(api.auth.public.cancelEmailChange, {});
  }

  /**
   * Resolves a file reference to a URL.
   * Currently only supports direct URLs (returns as-is if already HTTP).
   */
  getFileUrl(_record: unknown, filename: string, _options?: unknown): string {
    if (!filename) return '';
    if (filename.startsWith('http')) return filename;
    return '';
  }
}
