import {describe, expect, it} from 'vitest';
import {convexTest} from '../../setup.testing';
import {api, internal} from '../../_generated/api';
import type {Id} from '../../_generated/dataModel';

/**
 * Query-level visibility matrix for `getPublicEventPreviewInternal`
 * (backs `GET /api/events/:id` — see `backend/convex/http/events_preview.test.ts`
 * for the HTTP-layer routing/contract tests).
 */
describe('getPublicEventPreviewInternal', () => {
  async function seedPublishedOrganizer(
    t: ReturnType<typeof convexTest>,
    name: string,
  ): Promise<Id<'organizers'>> {
    return t.mutation(api.testing.communities.seedOrganizer, {
      name,
      status: 'published',
    });
  }

  it('returns the preview payload for a published public event in a published community', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Public Preview Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Public Preview Event',
      date: '2026-05-01T20:00:00.000Z',
      location: 'The Vault',
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'public',
      ticketSalesStatus: 'active',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview).toMatchObject({
      _id: eventId,
      title: 'Public Preview Event',
      location: 'The Vault',
      organizerName: 'Public Preview Org',
      posterUrl: null,
    });
  });

  it('grants the easy-to-miss public_viewable visibility (no purchase gate on preview)', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Viewable Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Viewable Event',
      date: '2026-05-01T20:00:00.000Z',
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'public_viewable',
      ticketSalesStatus: 'active',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview).not.toBeNull();
    expect(preview?.organizerName).toBe('Viewable Org');
  });

  it('returns null for a private event (anonymous visitors are not eligible)', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Private Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Event',
      date: '2026-05-01T20:00:00.000Z',
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'private',
      ticketSalesStatus: 'active',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview).toBeNull();
  });

  it('returns null for a draft event', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Draft Event Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Draft Event',
      date: '2026-05-01T20:00:00.000Z',
      price: 1000,
      organizerId: orgId,
      status: 'draft',
      visibility: 'public',
      ticketSalesStatus: 'active',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview).toBeNull();
  });

  it('returns null for a cancelled event', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Cancelled Event Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Cancelled Event',
      date: '2026-05-01T20:00:00.000Z',
      price: 1000,
      organizerId: orgId,
      status: 'cancelled',
      visibility: 'public',
      ticketSalesStatus: 'active',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview).toBeNull();
  });

  it('returns null for a published event whose community was later unpublished', async () => {
    // The production `communities.profile.update` cascade auto-unpublishes
    // an organizer's events when the community itself goes to draft, so this
    // exact combination (published event + draft community) can't arise
    // through the normal flow going forward — but canViewEvent must still
    // defend against it for events that were already published before an
    // admin unpublished the community. Model that state directly via the
    // testing helper (see seedOrganizerStatusDirect for rationale).
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Later Draft Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Orphaned-Community Event',
      date: '2026-05-01T20:00:00.000Z',
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'public',
      ticketSalesStatus: 'active',
    });
    await t.mutation(api.testing.communities.seedOrganizerStatusDirect, {
      organizerId: orgId,
      status: 'draft',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview).toBeNull();
  });

  it('returns null (no throw) for a garbage id', async () => {
    const t = convexTest();

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: 'not-a-real-event-id'},
    );

    expect(preview).toBeNull();
  });

  it('passes through an https poster URL unchanged', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Https Poster Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Https Poster Event',
      date: '2026-05-01T20:00:00.000Z',
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'public',
      ticketSalesStatus: 'active',
      poster: 'https://cdn.example.com/poster.jpg',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview?.posterUrl).toBe('https://cdn.example.com/poster.jpg');
  });

  it('resolves a storage-id poster to an https URL', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Storage Poster Org');
    const storageId = await t.run(async (ctx) => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], {
        type: 'image/png',
      });
      return await ctx.storage.store(blob);
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Storage Poster Event',
      date: '2026-05-01T20:00:00.000Z',
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'public',
      ticketSalesStatus: 'active',
      poster: storageId,
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview?.posterUrl).not.toBeNull();
    expect(preview?.posterUrl?.startsWith('https://')).toBe(true);
  });

  it('drops an http:// poster URL to null — unfurlers reject non-https og:image', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Http Poster Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Http Poster Event',
      date: '2026-05-01T20:00:00.000Z',
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'public',
      ticketSalesStatus: 'active',
      poster: 'http://cdn.example.com/poster.jpg',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview?.posterUrl).toBeNull();
  });

  it('truncates a long description to 300 chars server-side', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Long Description Org');
    const longDescription = 'x'.repeat(1000);
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Long Description Event',
      date: '2026-05-01T20:00:00.000Z',
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'public',
      ticketSalesStatus: 'active',
      description: longDescription,
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview?.description).toHaveLength(300);
    expect(preview?.description).toBe(longDescription.slice(0, 300));
  });

  it('formats a single-day dateLabel via the shared timezone helper', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Single Day Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Single Day Event',
      date: '2026-02-27T07:30:00.000Z',
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'public',
      ticketSalesStatus: 'active',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview?.dateLabel).toBe('Thu, Feb 26, 2026, 11:30 PM PST');
  });

  it('formats an overnight dateLabel with an end time only (no repeated end date)', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Overnight Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Overnight Event',
      date: '2026-02-27T06:00:00.000Z', // 10pm Feb 26 event-local
      endDate: '2026-02-27T14:00:00.000Z', // 6am Feb 27 event-local
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'public',
      ticketSalesStatus: 'active',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview?.dateLabel).toBe(
      'Thu, Feb 26, 2026, 10:00 PM – 6:00 AM PST',
    );
    expect(preview?.dateLabel).not.toContain('Feb 27, 2026');
  });

  it('formats a multi-day dateLabel showing both dates', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'Multi Day Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Multi Day Event',
      date: '2026-02-27T06:00:00.000Z', // 10pm Feb 26 event-local
      endDate: '2026-03-01T04:00:00.000Z', // 8pm Feb 28 event-local
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'public',
      ticketSalesStatus: 'active',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview?.dateLabel).toContain('Feb 26, 2026');
    expect(preview?.dateLabel).toContain('Feb 28, 2026');
  });

  it('does not include an endDate field on the payload', async () => {
    const t = convexTest();
    const orgId = await seedPublishedOrganizer(t, 'No EndDate Field Org');
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'No EndDate Field Event',
      date: '2026-02-27T06:00:00.000Z',
      endDate: '2026-02-27T14:00:00.000Z',
      price: 1000,
      organizerId: orgId,
      status: 'published',
      visibility: 'public',
      ticketSalesStatus: 'active',
    });

    const preview = await t.query(
      internal.events.public.getPublicEventPreviewInternal,
      {id: eventId},
    );

    expect(preview).not.toBeNull();
    expect(preview).not.toHaveProperty('endDate');
  });
});
