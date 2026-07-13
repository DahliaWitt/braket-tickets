import {inject, Injectable} from '@angular/core';
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {logger} from '@/utils/logger';
import {isRecord} from '@shared/type-guards';
import {environment} from '../../../../../environments/environment';

export interface CommunityPref {
  organizerName: string;
  organizerId: string;
  optedIn: boolean;
  isAdmin: boolean;
}

export interface PreferencesResponse {
  unsubscribedFrom: {organizerName: string; organizerId: string} | null;
  preferences: CommunityPref[];
  globalMarketingOptOut: boolean;
}

function isCommunityPref(value: unknown): value is CommunityPref {
  if (!isRecord(value)) return false;
  return (
    typeof value['organizerName'] === 'string' &&
    typeof value['organizerId'] === 'string' &&
    typeof value['optedIn'] === 'boolean' &&
    typeof value['isAdmin'] === 'boolean'
  );
}

function isPreferencesResponse(value: unknown): value is PreferencesResponse {
  if (!isRecord(value)) return false;

  const unsubscribedFrom = value['unsubscribedFrom'];
  const preferences = value['preferences'];

  const hasValidUnsubscribedFrom =
    unsubscribedFrom === null ||
    (isRecord(unsubscribedFrom) &&
      typeof unsubscribedFrom['organizerName'] === 'string' &&
      typeof unsubscribedFrom['organizerId'] === 'string');

  return (
    hasValidUnsubscribedFrom &&
    Array.isArray(preferences) &&
    preferences.every(isCommunityPref) &&
    typeof value['globalMarketingOptOut'] === 'boolean'
  );
}

/**
 * Statuses the unsubscribe endpoints return for a genuinely dead token:
 * 400 (`missing_token`) and 404 (`invalid_token`). Anything else — network
 * failure, 5xx, malformed payload — is a transient fetch failure the caller
 * should surface as retryable, not as an invalid link.
 */
const INVALID_TOKEN_STATUSES: ReadonlySet<number> = new Set([400, 404]);

@Injectable({
  providedIn: 'root',
})
export class UnsubscribePreferencesService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.convexSiteUrl.replace(/\/$/, '');

  /**
   * Loads preferences for an unsubscribe token.
   *
   * Returns `null` only when the backend rejected the token itself.
   * Throws on transient failures (network, 5xx, unexpected payload shape) so
   * a `resource()` loader can branch into a retry state instead of telling
   * the user their link is dead.
   */
  async loadPreferences(token: string): Promise<PreferencesResponse | null> {
    let result: unknown;
    try {
      result = await firstValueFrom(
        this.http.get<unknown>(
          `${this.apiBaseUrl}/api/unsubscribe-preferences?token=${encodeURIComponent(token)}`,
        ),
      );
    } catch (err) {
      if (
        err instanceof HttpErrorResponse &&
        INVALID_TOKEN_STATUSES.has(err.status)
      ) {
        logger.warn('Unsubscribe token rejected by backend', err.status);
        return null;
      }
      logger.error('Failed to load unsubscribe preferences', err);
      throw err;
    }
    if (!isPreferencesResponse(result)) {
      logger.warn('Unexpected unsubscribe preferences response shape', result);
      throw new Error('Unexpected unsubscribe preferences response shape');
    }
    return result;
  }

  async togglePreference(
    token: string,
    organizerId: string,
    optedIn: boolean,
  ): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiBaseUrl}/api/unsubscribe-toggle`, {
        token,
        organizerId,
        optedIn,
      }),
    );
  }

  async unsubscribeAll(token: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.apiBaseUrl}/api/unsubscribe-all`, {token}),
    );
  }
}
