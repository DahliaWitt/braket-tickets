import {describe, expect, it} from 'vitest';
import {
  buildTicketReminderDedupKey,
  normalizeTicketReminderContent,
} from './_impl/reminder_content';
import {
  buildOrganizerPaymentState,
  toEventDetail,
  toEventWithPosterUrl,
  toPublicEventCard,
} from '../lib/events/read_models';
import {isOpenAccess, isPubliclyVisible} from '../lib/access';
import type {Doc} from '../_generated/dataModel';
import {
  toEventCreateFields,
  toEventUpdatePatch,
  validateCreateEventInput,
  validateUpdateEventInput,
} from '../lib/events/writes';

describe('events model helpers', () => {
  it('builds organizer payment state for platform organizers', () => {
    expect(
      buildOrganizerPaymentState({
        _id: 'org_1' as never,
        _creationTime: 0,
        name: 'Platform',
        isPlatformOrganizer: true,
        isPublicDirectory: true,
      }),
    ).toEqual({
      organizerPaymentReady: true,
      isPlatformOrganizer: true,
    });
  });

  it('builds event detail without soldCount', () => {
    const result = toEventDetail(
      {
        _id: 'event_1' as never,
        _creationTime: 1,
        title: 'Event',
        date: '2030-01-01',
        price: 2000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: 'org_1' as never,
      },
      {
        posterUrl: 'https://example.com/poster.png',
        organizer: {
          _id: 'org_1' as never,
          _creationTime: 0,
          name: 'Org',
          isPublicDirectory: true,
          stripeConnectedAccountId: 'acct_123',
          stripeOnboardingStatus: 'complete',
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
        },
        organizerLogoUrl: 'https://example.com/org.png',
        guestCount: 7,
      },
    );

    expect(result).toMatchObject({
      _id: 'event_1',
      title: 'Event',
      posterUrl: 'https://example.com/poster.png',
      organizer: {
        _id: 'org_1',
        name: 'Org',
        logoUrl: 'https://example.com/org.png',
      },
      guestCount: 7,
      organizerPaymentReady: true,
      isPlatformOrganizer: false,
    });
  });

  it('normalizes legacy public events to canonical visibility in event detail', () => {
    const result = toEventDetail(
      {
        _id: 'event_legacy_public' as never,
        _creationTime: 1,
        title: 'Legacy Public Event',
        date: '2030-01-01',
        price: 2000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: 'org_1' as never,
      },
      {
        posterUrl: null,
        organizer: null,
        guestCount: 0,
      },
    );

    expect(result.visibility).toBe('public');
  });

  it('builds event create fields with slider config', () => {
    const result = toEventCreateFields({
      title: 'New Event',
      date: '2030-01-01',
      price: 1000,
      totalTickets: 50,
      status: 'draft',
      organizerId: 'org_1' as never,
      visibility: 'private',
      sliderConfig: {enabled: true, min: 500, max: 1500},
    });

    expect(result).toMatchObject({
      title: 'New Event',
      slidingScaleEnabled: true,
      slidingScaleMin: 500,
      slidingScaleMax: 1500,
    });
    expect(result).not.toHaveProperty('soldCount');
  });

  it('builds event update patches from slider config and explicit organizer changes', () => {
    expect(
      toEventUpdatePatch({
        title: 'Updated',
        organizerId: 'org_2' as never,
        ticketSalesStatus: 'paused',
        sliderConfig: {enabled: false},
      }),
    ).toEqual({
      title: 'Updated',
      organizerId: 'org_2',
      ticketSalesStatus: 'paused',
      slidingScaleEnabled: false,
      slidingScaleMin: undefined,
      slidingScaleMax: undefined,
    });
  });

  it('only projects sold counts when canonical availability is supplied', () => {
    const event = {
      _id: 'event_1' as never,
      _creationTime: 1,
      title: 'Event',
      date: '2030-01-01',
      price: 2000,
      totalTickets: 100,
      status: 'published' as const,
      visibility: 'public' as const,
      organizerId: 'org_1' as never,
      poster: 'poster_1',
    };
    const posterUrlMap = new Map([
      ['poster_1', 'https://example.com/poster.png'],
    ]);

    expect(toEventWithPosterUrl(event, posterUrlMap)).not.toHaveProperty(
      'soldCount',
    );

    expect(
      toEventWithPosterUrl(event, posterUrlMap, {
        soldCount: 4,
        isSoldOut: true,
      }),
    ).toMatchObject({
      soldCount: 4,
      isSoldOut: true,
      posterUrl: 'https://example.com/poster.png',
    });
  });

  it('builds public event cards from canonical inventory availability', () => {
    const result = toPublicEventCard(
      {
        _id: 'event_1' as never,
        _creationTime: 1,
        title: 'Event',
        date: '2030-01-01',
        price: 2000,
        totalTickets: 100,
        status: 'published' as const,
        visibility: 'public' as const,
        organizerId: 'org_1' as never,
      },
      new Map(),
      {
        soldCount: 5,
        isSoldOut: false,
      },
    );

    expect(result).toMatchObject({
      soldCount: 5,
      isSoldOut: false,
    });
  });

  it('builds a stable ticket reminder dedup key from trimmed subject text', () => {
    expect(
      buildTicketReminderDedupKey({
        userId: 'user_1' as never,
        eventId: 'event_1' as never,
        subject: '  Reminder subject  ',
      }),
    ).toBe('reminder:user_1:event_1:Reminder subject');
  });

  it('normalizes and validates reminder subject and message content', () => {
    expect(
      normalizeTicketReminderContent({
        subject: '  Reminder  ',
        message: '  Buy your ticket  ',
      }),
    ).toEqual({
      subject: 'Reminder',
      message: 'Buy your ticket',
    });
  });

  const validCreateEventBase = {
    title: 'My Event',
    date: '2030-12-15T20:00:00.000Z',
    price: 1000,
    totalTickets: 50,
    status: 'draft' as const,
    organizerId: 'org_1' as never,
    visibility: 'private' as const,
  };

  describe('validateCreateEventInput title', () => {
    it('accepts a normal title', () => {
      expect(() =>
        validateCreateEventInput(validCreateEventBase),
      ).not.toThrow();
    });

    it('rejects a whitespace-only title', () => {
      expect(() =>
        validateCreateEventInput({...validCreateEventBase, title: '   '}),
      ).toThrow('Title cannot be blank');
    });

    it('rejects a tab-only title', () => {
      expect(() =>
        validateCreateEventInput({...validCreateEventBase, title: '\t\t'}),
      ).toThrow('Title cannot be blank');
    });
  });

  describe('validateCreateEventInput date format', () => {
    it('rejects date-only strings (YYYY-MM-DD)', () => {
      expect(() =>
        validateCreateEventInput({...validCreateEventBase, date: '2026-01-15'}),
      ).toThrow(/date/i);
    });

    it('accepts full ISO 8601 UTC strings with a time component', () => {
      expect(() =>
        validateCreateEventInput({
          ...validCreateEventBase,
          date: '2026-01-15T12:00:00.000Z',
        }),
      ).not.toThrow();
    });
  });

  describe('validateUpdateEventInput whitespace title', () => {
    it('rejects a whitespace-only title', () => {
      expect(() => validateUpdateEventInput({title: '   '})).toThrow(
        'Title cannot be blank',
      );
    });

    it('accepts undefined title (no update)', () => {
      expect(() => validateUpdateEventInput({})).not.toThrow();
    });
  });

  it('resolves visibility helpers correctly', () => {
    const publicViewableEvent = {
      visibility: 'public_viewable',
    } as Doc<'events'>;
    const publicEvent = {visibility: 'public'} as Doc<'events'>;
    const privateEvent = {visibility: 'private'} as Doc<'events'>;

    expect(isPubliclyVisible(publicViewableEvent)).toBe(true);
    expect(isPubliclyVisible(publicEvent)).toBe(true);
    expect(isPubliclyVisible(privateEvent)).toBe(false);

    expect(isOpenAccess(publicEvent)).toBe(true);
    expect(isOpenAccess(publicViewableEvent)).toBe(false);
    expect(isOpenAccess(privateEvent)).toBe(false);
  });
});
