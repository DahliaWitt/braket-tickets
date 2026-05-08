import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
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

@Injectable({
  providedIn: 'root',
})
export class UnsubscribePreferencesService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.convexSiteUrl.replace(/\/$/, '');

  async loadPreferences(token: string): Promise<PreferencesResponse | null> {
    try {
      const result = await firstValueFrom(
        this.http.get<unknown>(
          `${this.apiBaseUrl}/api/unsubscribe-preferences?token=${encodeURIComponent(token)}`,
        ),
      );
      if (!isPreferencesResponse(result)) {
        logger.warn(
          'Unexpected unsubscribe preferences response shape',
          result,
        );
        return null;
      }
      return result;
    } catch (err) {
      logger.error('Failed to load unsubscribe preferences', err);
      return null;
    }
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
