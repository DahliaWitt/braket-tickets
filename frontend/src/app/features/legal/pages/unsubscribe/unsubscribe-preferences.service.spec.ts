import {HttpErrorResponse, provideHttpClient} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {environment} from '../../../../../environments/environment';
import {UnsubscribePreferencesService} from './unsubscribe-preferences.service';

describe('UnsubscribePreferencesService', () => {
  let service: UnsubscribePreferencesService;
  let httpMock: HttpTestingController;
  const apiBaseUrl = environment.convexSiteUrl.replace(/\/$/, '');

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(UnsubscribePreferencesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads preferences from the Convex site origin', async () => {
    const promise = service.loadPreferences('token with spaces');

    const req = httpMock.expectOne(
      `${apiBaseUrl}/api/unsubscribe-preferences?token=token%20with%20spaces`,
    );
    req.flush({
      unsubscribedFrom: null,
      preferences: [],
      globalMarketingOptOut: false,
    });

    await expect(promise).resolves.toEqual({
      unsubscribedFrom: null,
      preferences: [],
      globalMarketingOptOut: false,
    });
  });

  it('accepts admin metadata in preference payloads', async () => {
    const promise = service.loadPreferences('admin-token');

    const req = httpMock.expectOne(
      `${apiBaseUrl}/api/unsubscribe-preferences?token=admin-token`,
    );
    req.flush({
      unsubscribedFrom: null,
      preferences: [
        {
          organizerName: 'Admin Org',
          organizerId: 'org-1',
          optedIn: true,
          isAdmin: true,
        },
      ],
      globalMarketingOptOut: false,
    });

    await expect(promise).resolves.toEqual({
      unsubscribedFrom: null,
      preferences: [
        {
          organizerName: 'Admin Org',
          organizerId: 'org-1',
          optedIn: true,
          isAdmin: true,
        },
      ],
      globalMarketingOptOut: false,
    });
  });

  it('rejects preference payloads missing admin metadata', async () => {
    const promise = service.loadPreferences('missing-admin');

    const req = httpMock.expectOne(
      `${apiBaseUrl}/api/unsubscribe-preferences?token=missing-admin`,
    );
    req.flush({
      unsubscribedFrom: null,
      preferences: [
        {organizerName: 'Org', organizerId: 'org-1', optedIn: true},
      ],
      globalMarketingOptOut: false,
    });

    await expect(promise).rejects.toThrow(
      'Unexpected unsubscribe preferences response shape',
    );
  });

  it('throws for malformed preferences payloads so callers can retry', async () => {
    const promise = service.loadPreferences('bad-token');

    const req = httpMock.expectOne(
      `${apiBaseUrl}/api/unsubscribe-preferences?token=bad-token`,
    );
    req.flush({
      unsubscribedFrom: null,
      preferences: {not: 'an array'},
      globalMarketingOptOut: false,
    });

    await expect(promise).rejects.toThrow(
      'Unexpected unsubscribe preferences response shape',
    );
  });

  it('returns null when the backend rejects the token as invalid', async () => {
    const promise = service.loadPreferences('dead-token');

    const req = httpMock.expectOne(
      `${apiBaseUrl}/api/unsubscribe-preferences?token=dead-token`,
    );
    req.flush(
      {error: 'invalid_token'},
      {status: 404, statusText: 'Not Found'},
    );

    await expect(promise).resolves.toBeNull();
  });

  it('returns null when the backend reports a missing token', async () => {
    const promise = service.loadPreferences('');

    const req = httpMock.expectOne(
      `${apiBaseUrl}/api/unsubscribe-preferences?token=`,
    );
    req.flush(
      {error: 'missing_token'},
      {status: 400, statusText: 'Bad Request'},
    );

    await expect(promise).resolves.toBeNull();
  });

  it('throws on server errors so callers can retry', async () => {
    const promise = service.loadPreferences('flaky-token');

    const req = httpMock.expectOne(
      `${apiBaseUrl}/api/unsubscribe-preferences?token=flaky-token`,
    );
    req.flush(
      {error: 'oops'},
      {status: 500, statusText: 'Internal Server Error'},
    );

    await expect(promise).rejects.toBeInstanceOf(HttpErrorResponse);
  });

  it('throws on network failures so callers can retry', async () => {
    const promise = service.loadPreferences('offline-token');

    const req = httpMock.expectOne(
      `${apiBaseUrl}/api/unsubscribe-preferences?token=offline-token`,
    );
    req.error(new ProgressEvent('error'));

    await expect(promise).rejects.toBeInstanceOf(HttpErrorResponse);
  });

  it('posts preference toggles to the Convex site origin', async () => {
    const promise = service.togglePreference('pref-token', 'org-1', false);

    const req = httpMock.expectOne(`${apiBaseUrl}/api/unsubscribe-toggle`);
    expect(req.request.body).toEqual({
      token: 'pref-token',
      organizerId: 'org-1',
      optedIn: false,
    });
    req.flush({});

    await expect(promise).resolves.toBeUndefined();
  });

  it('posts unsubscribe-all requests to the Convex site origin', async () => {
    const promise = service.unsubscribeAll('all-token');

    const req = httpMock.expectOne(`${apiBaseUrl}/api/unsubscribe-all`);
    expect(req.request.body).toEqual({token: 'all-token'});
    req.flush({});

    await expect(promise).resolves.toBeUndefined();
  });
});
