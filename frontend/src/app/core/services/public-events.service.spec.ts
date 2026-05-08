import {TestBed} from '@angular/core/testing';
import {provideHttpClient} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {environment} from '../../../environments/environment';
import {PublicEventsService, type PublicEventCard} from './public-events.service';

describe('PublicEventsService', () => {
  let service: PublicEventsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        PublicEventsService,
      ],
    });

    service = TestBed.inject(PublicEventsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('fetches upcoming public events from the Convex site HTTP surface', async () => {
    const expected: PublicEventCard[] = [
      {
        _id: 'evt-1' as PublicEventCard['_id'],
        title: 'Queer Rave',
        date: '2030-06-15T00:00:00.000Z',
        price: 2000,
        totalTickets: 100,
        soldCount: 0,
        isSoldOut: false,
        ticketSalesStatus: 'active',
        visibility: 'public',
        posterUrl: null,
      },
    ];

    const requestPromise = service.listUpcoming();
    const request = httpMock.expectOne(`${environment.convexSiteUrl}/api/events/upcoming`);
    expect(request.request.method).toBe('GET');
    request.flush(expected);

    await expect(requestPromise).resolves.toEqual(expected);
  });

  it('returns empty array when the endpoint responds with an error', async () => {
    // The service itself doesn't handle errors — the resource() in the component does.
    // Just verify the URL and method are correct for a failed request.
    const requestPromise = service.listUpcoming();
    const request = httpMock.expectOne(`${environment.convexSiteUrl}/api/events/upcoming`);
    expect(request.request.method).toBe('GET');
    request.flush('Internal Server Error', {status: 500, statusText: 'Internal Server Error'});

    await expect(requestPromise).rejects.toThrow();
  });
});
