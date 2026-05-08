import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {environment} from '../../../environments/environment';
import {
  PublicCommunitiesService,
  type PublicCommunity,
} from './public-communities.service';

describe('PublicCommunitiesService', () => {
  let service: PublicCommunitiesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        PublicCommunitiesService,
      ],
    });

    service = TestBed.inject(PublicCommunitiesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists public directory communities from the HTTP surface', async () => {
    const expected: PublicCommunity[] = [
      {
        _id: 'org-1' as PublicCommunity['_id'],
        name: 'Community One',
        status: 'published',
        slug: 'community-one',
      },
    ];

    const requestPromise = service.listDirectory();
    const request = httpMock.expectOne(`${environment.convexSiteUrl}/api/communities`);
    expect(request.request.method).toBe('GET');
    request.flush(expected);

    await expect(requestPromise).resolves.toEqual(expected);
  });

  it('loads a public community by slug from the HTTP surface', async () => {
    const expected: PublicCommunity = {
      _id: 'org-2' as PublicCommunity['_id'],
      name: 'Slug Community',
      status: 'published',
      slug: 'slug-community',
    };

    const requestPromise = service.getBySlug('slug-community');
    const request = httpMock.expectOne(`${environment.convexSiteUrl}/api/communities/slug-community`);
    expect(request.request.method).toBe('GET');
    request.flush(expected);

    await expect(requestPromise).resolves.toEqual(expected);
  });

  it('returns null when the slug endpoint responds with 404', async () => {
    const requestPromise = service.getBySlug('missing-community');
    const request = httpMock.expectOne(`${environment.convexSiteUrl}/api/communities/missing-community`);
    request.flush('Not Found', {status: 404, statusText: 'Not Found'});

    await expect(requestPromise).resolves.toBeNull();
  });
});
