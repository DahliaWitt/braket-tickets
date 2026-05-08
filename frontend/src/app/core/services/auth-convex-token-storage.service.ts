import { inject, Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';
import { logger } from '@/utils/logger';
import { BrowserPlatformService } from '@/core/services/browser-platform.service';
import { extractDeploymentSlug, parseJwtPayload } from './auth.service.helpers';

const JWT_STORAGE_KEY = '__convexAuthJWT';
const REFRESH_TOKEN_STORAGE_KEY = '__convexAuthRefreshToken';
const VERIFIER_STORAGE_KEY = '__convexAuthOAuthVerifier';

@Injectable({
  providedIn: 'root',
})
export class AuthConvexTokenStorageService {
  private readonly browser = inject(BrowserPlatformService);

  clear(): void {
    this.browser.removeLocalStorageItem(JWT_STORAGE_KEY);
    this.browser.removeLocalStorageItem(REFRESH_TOKEN_STORAGE_KEY);
    this.browser.removeLocalStorageItem(VERIFIER_STORAGE_KEY);
  }

  purgeStaleSession(): void {
    const token = this.browser.getLocalStorageItem(JWT_STORAGE_KEY);
    if (!token) {
      return;
    }

    try {
      const payload = parseJwtPayload(token);
      const issuer = payload.iss;
      const expiry = payload.exp ?? 0;

      if (!issuer) {
        throw new Error('Token missing issuer');
      }

      const currentEnvUrl = environment.convexUrl.replace(/\/+$/, '').toLowerCase();
      const tokenIssuer = issuer.replace(/\/+$/, '').toLowerCase();
      const currentSlug = extractDeploymentSlug(currentEnvUrl);
      const tokenSlug = extractDeploymentSlug(tokenIssuer);
      const isSameDeployment = currentSlug && tokenSlug && currentSlug === tokenSlug;

      if (tokenIssuer !== currentEnvUrl && !isSameDeployment) {
        const isLocalIssuer =
          tokenIssuer.includes('localhost') || tokenIssuer.includes('127.0.0.1');
        if (isLocalIssuer) {
          logger.info(
            '[AuthService] Token from local issuer detected (likely E2E/dev). Skipping purge.',
          );
          return;
        }

        logger.warn('[AuthService] Proactively purging stale Convex token: issuer mismatch', {
          currentEnvUrl,
          tokenIssuer,
        });
        this.clear();
        return;
      }

      if (Date.now() >= expiry * 1000) {
        logger.warn('[AuthService] Proactively purging stale Convex token: expired');
        this.clear();
      }
    } catch (err) {
      logger.warn('[AuthService] Failed to validate stored Convex auth token. Purging it.', err);
      this.clear();
    }
  }
}
