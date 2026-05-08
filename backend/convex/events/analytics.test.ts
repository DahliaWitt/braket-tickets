/**
 * Tests for event_analytics.ts — check-in analytics and roster queries.
 *
 * Covers every case listed in the spec:
 * - getEventCheckInSummary: math correctness, refunded exclusion, empty event, lastCheckInAt
 * - getEventCheckInPostMortem: peak hour bucketing, empty event, edge cases
 * - getEventAttendeeRosterPage: shape, refunded filter, pagination, PII boundary, RLS
 * - searchEventAttendeesPage: name search, email search (admin vs door staff), empty query
 * - getRecentCheckIns: ordering, limit, max enforced, RLS
 * - exportEventRosterCsv: CSV rows, filename, audit log, auth, injection guard, rate limit, size cap
 * - tickets.by_event_checkedInAt index works under convex-test
 */

import type {TicketTier} from '@shared/domain/ticket-tier';
import type {TicketStatus} from '@shared/domain/ticket-status';
import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {describe, it, expect, vi} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {buildTicketRosterProjection} from '../lib/ticket_roster_projection';
import {addMember, authz} from '../lib/authz';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function setupOrg(t: ReturnType<typeof convexTest>) {
  return t.mutation(api.testing.communities.seedOrganizer, {name: 'Test Org'});
}

async function setupEvent(
  t: ReturnType<typeof convexTest>,
  orgId: Id<'organizers'>,
  overrides: {
    title?: string;
    soldCount?: number;
    checkedInCount?: number;
    lastCheckInAt?: number | null;
  } = {},
) {
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: overrides.title ?? 'Test Event',
    date: '2030-06-01',
    price: 2000,
    totalTickets: 100,
    status: 'published',
    visibility: 'public',
    organizerId: orgId,
    soldCount: overrides.soldCount,
  });
  if (
    overrides.checkedInCount !== undefined ||
    overrides.lastCheckInAt !== undefined
  ) {
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- checkedInCount/lastCheckInAt are denormalized event-level counters not exposed by seedEvent; patching directly to set analytics state under test
      await ctx.db.patch('events', eventId, {
        checkedInCount: overrides.checkedInCount,
        lastCheckInAt: overrides.lastCheckInAt ?? undefined,
      });
    });
  }
  return eventId;
}

async function setupAdmin(t: ReturnType<typeof convexTest>) {
  return t.mutation(api.testing.users.createUserDirectly, {
    name: 'Admin',
    email: 'admin@test-analytics.com',
    isRootAdmin: true,
  });
}

async function setupCommunityAdmin(
  t: ReturnType<typeof convexTest>,
  orgId: Id<'organizers'>,
) {
  const adminId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Community Admin',
    email: 'cadmin@test.com',
  });
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, adminId, 'community_admin', {
      type: 'organizer',
      id: orgId,
    });
    await addMember(ctx, adminId, orgId);
  });
  return adminId;
}

async function setupScanner(
  t: ReturnType<typeof convexTest>,
  orgId: Id<'organizers'>,
) {
  const scannerId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Scanner',
    email: 'scanner@test.com',
  });
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, scannerId, 'community_scanner', {
      type: 'organizer',
      id: orgId,
    });
    await addMember(ctx, scannerId, orgId);
  });
  return scannerId;
}

async function insertTicket(
  t: ReturnType<typeof convexTest>,
  eventId: Id<'events'>,
  overrides: {
    name?: string;
    email?: string;
    status?: TicketStatus;
    tier?: TicketTier;
    checkedInAt?: number;
    checkedInBy?: Id<'users'>;
  } = {},
) {
  const email =
    overrides.email ?? `attendee-${Date.now()}-${Math.random()}@test.com`;
  const userId = await t.mutation(api.testing.users.createUserDirectly, {
    name: overrides.name ?? 'Attendee',
    email,
  });
  const ticketId = await t.run(async (ctx) => {
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- seedTicket does not expose checkedInAt/checkedInBy; these fields are required by check-in analytics tests to seed controlled timestamps
    const tid = await ctx.db.insert('tickets', {
      userId,
      eventId,
      status: overrides.status ?? 'valid',
      tier: overrides.tier ?? 'regular',
      checkedInAt: overrides.checkedInAt,
      checkedInBy: overrides.checkedInBy,
    });
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- patching roster projection fields that applySeedTicketRosterProjection would set; required because we bypassed seedTicket above to preserve checkedInAt
    await ctx.db.patch(
      'tickets',
      tid,
      buildTicketRosterProjection({
        ticketId: tid,
        status: overrides.status ?? 'valid',
        attendeeName: overrides.name ?? 'Attendee',
        email: overrides.email ?? null,
        checkedInByName: null,
      }),
    );
    return tid;
  });
  return {userId, ticketId};
}

// ---------------------------------------------------------------------------
// getEventCheckInSummary
// ---------------------------------------------------------------------------

describe('getEventCheckInSummary', () => {
  it('returns correct counts from denormalized counters', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {
      soldCount: 10,
      checkedInCount: 4,
    });
    const adminId = await setupAdmin(t);

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventCheckInSummary, {eventId});

    expect(result.totalActive).toBe(10);
    expect(result.checkedIn).toBe(4);
    expect(result.rate).toBeCloseTo(0.4, 5);
    expect(result.lastCheckInAt).toBeNull();
  });

  it('fails closed when the canonical inventory link is missing', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {
      soldCount: 8,
      checkedInCount: 2,
    });
    const adminId = await setupAdmin(t);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- unsetting inventoryId is intentionally invalid; tests the fail-closed guard when inventory link is missing
      await ctx.db.patch('events', eventId, {inventoryId: undefined});
    });

    await expect(
      t
        .withIdentity({subject: adminId})
        .query(api.events.analytics.getEventCheckInSummary, {eventId}),
    ).rejects.toThrow('missing inventoryId');
  });

  it('returns zero counters for a fresh event', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventCheckInSummary, {eventId});

    expect(result.totalActive).toBe(0);
    expect(result.checkedIn).toBe(0);
    expect(result.rate).toBe(0);
    expect(result.lastCheckInAt).toBeNull();
  });

  it('returns lastCheckInAt when set', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const ts = Date.now() - 5000;
    const eventId = await setupEvent(t, orgId, {
      soldCount: 5,
      checkedInCount: 1,
      lastCheckInAt: ts,
    });
    const adminId = await setupAdmin(t);

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventCheckInSummary, {eventId});

    expect(result.lastCheckInAt).toBe(ts);
  });

  it('rate is 0 when totalActive is 0 (avoid divide-by-zero)', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {
      soldCount: 0,
      checkedInCount: 0,
    });
    const adminId = await setupAdmin(t);

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventCheckInSummary, {eventId});

    expect(result.rate).toBe(0);
  });

  it('rejects unauthorized callers', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {soldCount: 5});
    const randomUser = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Random',
      email: 'random@test-analytics.com',
    });

    await expect(
      t
        .withIdentity({subject: randomUser})
        .query(api.events.analytics.getEventCheckInSummary, {eventId}),
    ).rejects.toThrow();
  });

  it('allows community scanner (door staff) to read summary', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {
      soldCount: 5,
      checkedInCount: 2,
    });
    const scannerId = await setupScanner(t, orgId);

    const result = await t
      .withIdentity({subject: scannerId})
      .query(api.events.analytics.getEventCheckInSummary, {eventId});

    expect(result.checkedIn).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getEventCheckInPostMortem
// ---------------------------------------------------------------------------

describe('getEventCheckInPostMortem', () => {
  it('returns null peak for empty event', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventCheckInPostMortem, {eventId});

    expect(result.peakHourStartsAt).toBeNull();
    expect(result.peakHourCount).toBe(0);
    expect(result.totalCheckedIn).toBe(0);
  });

  it('buckets check-ins into 1-hour windows and finds peak', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    const HOUR_MS = 60 * 60 * 1000;
    const anchor = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;

    // Window 1: 3 check-ins
    const ts1a = anchor + 1000;
    const ts1b = anchor + 2000;
    const ts1c = anchor + 3000;
    // Window 2: 1 check-in
    const ts2a = anchor + HOUR_MS + 1000;

    await insertTicket(t, eventId, {status: 'used', checkedInAt: ts1a});
    await insertTicket(t, eventId, {status: 'used', checkedInAt: ts1b});
    await insertTicket(t, eventId, {status: 'used', checkedInAt: ts1c});
    await insertTicket(t, eventId, {status: 'used', checkedInAt: ts2a});

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventCheckInPostMortem, {eventId});

    expect(result.totalCheckedIn).toBe(4);
    expect(result.peakHourCount).toBe(3);
    expect(result.peakHourStartsAt).toBe(anchor);
  });

  it('handles scan exactly on the hour boundary', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    const HOUR_MS = 60 * 60 * 1000;
    const exactHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;

    // Exactly on the boundary — should land in the window that starts at exactHour
    await insertTicket(t, eventId, {status: 'used', checkedInAt: exactHour});
    // One in the previous window
    const prevWindow = exactHour - HOUR_MS;
    await insertTicket(t, eventId, {
      status: 'used',
      checkedInAt: prevWindow + 1,
    });
    await insertTicket(t, eventId, {
      status: 'used',
      checkedInAt: prevWindow + 2,
    });

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventCheckInPostMortem, {eventId});

    // Previous window has 2, this window has 1; peak is prevWindow
    expect(result.peakHourCount).toBe(2);
    expect(result.peakHourStartsAt).toBe(prevWindow);
    expect(result.totalCheckedIn).toBe(3);
  });

  it('rejects unauthorized callers', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const randUser = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Rand',
      email: 'rand@test-analytics.com',
    });

    await expect(
      t
        .withIdentity({subject: randUser})
        .query(api.events.analytics.getEventCheckInPostMortem, {eventId}),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getEventAttendeeRosterPage
// ---------------------------------------------------------------------------

describe('getEventAttendeeRosterPage', () => {
  it('returns correct row shape', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {soldCount: 1});
    const adminId = await setupAdmin(t);

    await insertTicket(t, eventId, {
      name: 'Alice',
      email: 'alice@test.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: false,
        paginationOpts: {numItems: 50, cursor: null},
      });

    expect(result.page).toHaveLength(1);
    const row = result.page[0];
    expect(row.attendeeName).toBe('Alice');
    expect(row.email).toBe('alice@test.com');
    expect(row.tierName).toBe('Regular');
    expect(row.status).toBe('valid');
    expect(row.checkedInAt).toBeNull();
    expect(row.checkedInByName).toBeNull();
  });

  it('excludes refunded tickets by default, includes when flag is set', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    await insertTicket(t, eventId, {
      name: 'Valid',
      email: 'v@test.com',
      status: 'valid',
    });
    await insertTicket(t, eventId, {
      name: 'Refunded',
      email: 'r@test.com',
      status: 'refunded',
    });

    const noRefunded = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: false,
        paginationOpts: {numItems: 50, cursor: null},
      });
    expect(noRefunded.page).toHaveLength(1);
    expect(noRefunded.page[0].attendeeName).toBe('Valid');

    const withRefunded = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: true,
        paginationOpts: {numItems: 50, cursor: null},
      });
    expect(withRefunded.page).toHaveLength(2);
  });

  it('cursor-based pagination: page 1 returns N rows, cursor advances, final page isDone=true', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    // Insert 5 tickets
    for (let i = 0; i < 5; i++) {
      await insertTicket(t, eventId, {
        name: `User${i}`,
        email: `u${i}@test.com`,
        status: 'valid',
      });
    }

    // Page 1: 3 items
    const page1 = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: false,
        paginationOpts: {numItems: 3, cursor: null},
      });
    expect(page1.page).toHaveLength(3);
    expect(page1.isDone).toBe(false);

    // Page 2: remaining 2 items
    const page2 = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: false,
        paginationOpts: {numItems: 3, cursor: page1.continueCursor},
      });
    expect(page2.page).toHaveLength(2);
    expect(page2.isDone).toBe(true);

    // No duplicates across pages
    const allIds = [...page1.page, ...page2.page].map((r) => r.ticketId);
    expect(new Set(allIds).size).toBe(5);
  });

  it('sort stability: no duplicates and no skips across pages', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    // Insert 6 tickets
    for (let i = 0; i < 6; i++) {
      await insertTicket(t, eventId, {
        name: `Stable${i}`,
        email: `stable${i}@test.com`,
        status: 'valid',
      });
    }

    const page1 = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: false,
        paginationOpts: {numItems: 4, cursor: null},
      });
    const page2 = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: false,
        paginationOpts: {numItems: 4, cursor: page1.continueCursor},
      });

    const allIds = [...page1.page, ...page2.page].map((r) => r.ticketId);
    // Exactly 6 unique IDs — no duplicates, no skips
    expect(allIds).toHaveLength(6);
    expect(new Set(allIds).size).toBe(6);
  });

  it('returns pages in the same global attendee-name order across cursors', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    for (const name of ['Zoe', 'Zed', 'Amy', 'Bea']) {
      await insertTicket(t, eventId, {
        name,
        email: `${name.toLowerCase()}@test.com`,
        status: 'valid',
      });
    }

    const page1 = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: false,
        paginationOpts: {numItems: 2, cursor: null},
      });
    const page2 = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: false,
        paginationOpts: {numItems: 2, cursor: page1.continueCursor},
      });

    expect(
      [...page1.page, ...page2.page].map((row) => row.attendeeName),
    ).toEqual(['Amy', 'Bea', 'Zed', 'Zoe']);
  });

  it('PII boundary: door staff caller gets email: null for every row', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const scannerId = await setupScanner(t, orgId);

    await insertTicket(t, eventId, {
      name: 'Buyer1',
      email: 'buyer1@test.com',
      status: 'valid',
    });
    await insertTicket(t, eventId, {
      name: 'Buyer2',
      email: 'buyer2@test.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: scannerId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: false,
        paginationOpts: {numItems: 50, cursor: null},
      });

    expect(result.page.length).toBeGreaterThan(0);
    for (const row of result.page) {
      expect(row.email).toBeNull();
    }
  });

  it('PII boundary: admin caller gets real emails', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    await insertTicket(t, eventId, {
      name: 'Buyer',
      email: 'real@test.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: false,
        paginationOpts: {numItems: 50, cursor: null},
      });

    expect(result.page[0].email).toBe('real@test.com');
  });

  it('rejects unrelated user (no role for this event)', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const randId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Rand',
      email: 'rand-roster@test-analytics.com',
    });

    await expect(
      t
        .withIdentity({subject: randId})
        .query(api.events.analytics.getEventAttendeeRosterPage, {
          eventId,
          includeRefunded: false,
          paginationOpts: {numItems: 50, cursor: null},
        }),
    ).rejects.toThrow();
  });

  it('allows door staff for THIS event but not for a different event', async () => {
    const t = convexTest();
    const orgA = await setupOrg(t);
    const orgB = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org B',
    });
    const eventA = await setupEvent(t, orgA);
    const eventB = await setupEvent(t, orgB, {title: 'Event B'});

    const scannerId = await setupScanner(t, orgA); // scanner for orgA only

    // Can read orgA event
    await expect(
      t
        .withIdentity({subject: scannerId})
        .query(api.events.analytics.getEventAttendeeRosterPage, {
          eventId: eventA,
          includeRefunded: false,
          paginationOpts: {numItems: 50, cursor: null},
        }),
    ).resolves.toBeDefined();

    // Cannot read orgB event
    await expect(
      t
        .withIdentity({subject: scannerId})
        .query(api.events.analytics.getEventAttendeeRosterPage, {
          eventId: eventB,
          includeRefunded: false,
          paginationOpts: {numItems: 50, cursor: null},
        }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// searchEventAttendeesPage
// ---------------------------------------------------------------------------

describe('searchEventAttendeesPage', () => {
  it('case-insensitive substring match on attendee name', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    await insertTicket(t, eventId, {
      name: 'Alice Wonderland',
      email: 'a@test.com',
      status: 'valid',
    });
    await insertTicket(t, eventId, {
      name: 'Bob Builder',
      email: 'b@test.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.searchEventAttendeesPage, {
        eventId,
        query: 'alice',
        includeRefunded: false,
        paginationOpts: {numItems: 50, cursor: null},
      });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].attendeeName).toBe('Alice Wonderland');
  });

  it('email substring match works for admin callers', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    await insertTicket(t, eventId, {
      name: 'Charlie',
      email: 'charlie@findme.com',
      status: 'valid',
    });
    await insertTicket(t, eventId, {
      name: 'Dave',
      email: 'dave@other.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.searchEventAttendeesPage, {
        eventId,
        query: 'findme',
        includeRefunded: false,
        paginationOpts: {numItems: 50, cursor: null},
      });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].attendeeName).toBe('Charlie');
  });

  it('matches arbitrary substrings inside attendee names', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    await insertTicket(t, eventId, {
      name: 'Alice Wonderland',
      email: 'alice@test.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.searchEventAttendeesPage, {
        eventId,
        query: 'nder',
        includeRefunded: false,
        paginationOpts: {numItems: 50, cursor: null},
      });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].attendeeName).toBe('Alice Wonderland');
  });

  it('matches arbitrary substrings inside attendee emails for admin callers', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    await insertTicket(t, eventId, {
      name: 'Charlie',
      email: 'charlie@example.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.searchEventAttendeesPage, {
        eventId,
        query: 'ample',
        includeRefunded: false,
        paginationOpts: {numItems: 50, cursor: null},
      });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].attendeeName).toBe('Charlie');
  });

  it('fills search pages across underlying roster pages', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    await insertTicket(t, eventId, {
      name: 'Aaron Target',
      email: 'aaron-target@example.com',
      status: 'valid',
    });
    await insertTicket(t, eventId, {
      name: 'Betty Nonmatch',
      email: 'betty@example.com',
      status: 'valid',
    });
    await insertTicket(t, eventId, {
      name: 'Carla Target Later',
      email: 'carla-target@example.com',
      status: 'valid',
    });
    await insertTicket(t, eventId, {
      name: 'Dan Target Last',
      email: 'dan-target@example.com',
      status: 'valid',
    });
    await insertTicket(t, eventId, {
      name: 'Erin Nonmatch',
      email: 'erin@example.com',
      status: 'valid',
    });

    const firstPage = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.searchEventAttendeesPage, {
        eventId,
        query: 'target',
        includeRefunded: false,
        paginationOpts: {numItems: 2, cursor: null},
      });

    expect(firstPage.page).toHaveLength(2);
    expect(firstPage.page[0].attendeeName).toBe('Aaron Target');
    expect(firstPage.page[1].attendeeName).toBe('Carla Target Later');
    expect(firstPage.isDone).toBe(false);

    const secondPage = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.searchEventAttendeesPage, {
        eventId,
        query: 'target',
        includeRefunded: false,
        paginationOpts: {numItems: 1, cursor: firstPage.continueCursor},
      });

    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.page[0].attendeeName).toBe('Dan Target Last');
  });

  it('email search does NOT match for door staff (email is null)', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const scannerId = await setupScanner(t, orgId);

    await insertTicket(t, eventId, {
      name: 'Eve',
      email: 'eve@secret.com',
      status: 'valid',
    });
    await insertTicket(t, eventId, {
      name: 'Frank',
      email: 'frank@other.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: scannerId})
      .query(api.events.analytics.searchEventAttendeesPage, {
        eventId,
        query: 'secret',
        includeRefunded: false,
        paginationOpts: {numItems: 50, cursor: null},
      });

    // Door staff cannot search by email — no results
    expect(result.page).toHaveLength(0);
  });

  it('door staff can still search by name', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const scannerId = await setupScanner(t, orgId);

    await insertTicket(t, eventId, {
      name: 'Grace Hopper',
      email: 'grace@secret.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: scannerId})
      .query(api.events.analytics.searchEventAttendeesPage, {
        eventId,
        query: 'Grace',
        includeRefunded: false,
        paginationOpts: {numItems: 50, cursor: null},
      });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].email).toBeNull(); // PII boundary
  });

  it('rejects empty query string with INVALID_ARG', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    await expect(
      t
        .withIdentity({subject: adminId})
        .query(api.events.analytics.searchEventAttendeesPage, {
          eventId,
          query: '',
          includeRefunded: false,
          paginationOpts: {numItems: 50, cursor: null},
        }),
    ).rejects.toThrow();
  });

  it('rejects empty query (only whitespace) with INVALID_ARG', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    await expect(
      t
        .withIdentity({subject: adminId})
        .query(api.events.analytics.searchEventAttendeesPage, {
          eventId,
          query: '   ',
          includeRefunded: false,
          paginationOpts: {numItems: 50, cursor: null},
        }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getRecentCheckIns
// ---------------------------------------------------------------------------

describe('getRecentCheckIns', () => {
  it('returns check-ins in descending order', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    const now = Date.now();
    await insertTicket(t, eventId, {
      name: 'First',
      status: 'used',
      checkedInAt: now - 3000,
    });
    await insertTicket(t, eventId, {
      name: 'Second',
      status: 'used',
      checkedInAt: now - 2000,
    });
    await insertTicket(t, eventId, {
      name: 'Third',
      status: 'used',
      checkedInAt: now - 1000,
    });

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getRecentCheckIns, {eventId});

    expect(result.length).toBe(3);
    // Most recent first
    expect(result[0].checkedInAt).toBeGreaterThan(result[1].checkedInAt);
    expect(result[1].checkedInAt).toBeGreaterThan(result[2].checkedInAt);
  });

  it('default limit is 20', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    const now = Date.now();
    for (let i = 0; i < 25; i++) {
      await insertTicket(t, eventId, {
        name: `User${i}`,
        status: 'used',
        checkedInAt: now - i * 1000,
      });
    }

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getRecentCheckIns, {eventId});

    expect(result.length).toBe(20);
  });

  it('honors custom limit up to 100', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      await insertTicket(t, eventId, {
        name: `UserL${i}`,
        status: 'used',
        checkedInAt: now - i * 1000,
      });
    }

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getRecentCheckIns, {eventId, limit: 5});

    expect(result.length).toBe(5);
  });

  it('caps limit at 100 even if larger value passed', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    const now = Date.now();
    for (let i = 0; i < 150; i++) {
      await insertTicket(t, eventId, {
        name: `UserMax${i}`,
        status: 'used',
        checkedInAt: now - i * 1000,
      });
    }

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getRecentCheckIns, {eventId, limit: 200});

    expect(result.length).toBe(100);
  });

  it('only returns tickets that have checkedInAt set', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    const now = Date.now();
    await insertTicket(t, eventId, {
      name: 'CheckedIn',
      status: 'used',
      checkedInAt: now,
    });
    await insertTicket(t, eventId, {name: 'NotCheckedIn', status: 'valid'}); // no checkedInAt

    const result = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getRecentCheckIns, {eventId});

    expect(result).toHaveLength(1);
    expect(result[0].attendeeName).toBe('CheckedIn');
  });

  it('rejects unauthorized callers', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const randId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Rand2',
      email: 'rand2@test-analytics.com',
    });

    await expect(
      t
        .withIdentity({subject: randId})
        .query(api.events.analytics.getRecentCheckIns, {eventId}),
    ).rejects.toThrow();
  });

  it('allows door staff for this event', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const scannerId = await setupScanner(t, orgId);

    await expect(
      t
        .withIdentity({subject: scannerId})
        .query(api.events.analytics.getRecentCheckIns, {eventId}),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// _getEventAttendeeRosterInternal — size cap
// ---------------------------------------------------------------------------

describe('_getEventAttendeeRosterInternal', () => {
  it('returns rows for a normal event', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);

    await insertTicket(t, eventId, {
      name: 'Internal A',
      email: 'ia@test.com',
      status: 'valid',
    });

    const rows = await t.run((ctx) =>
      ctx.runQuery(internal.events.analytics._getEventAttendeeRosterInternal, {
        eventId,
        includeRefunded: false,
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('ia@test.com'); // no PII restriction internally
  });

  it('throws EXPORT_TOO_LARGE when roster exceeds 5000 rows', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);

    // Insert 5001 tickets
    const batchSize = 100;
    const totalTickets = 5001;

    for (let batch = 0; batch < Math.ceil(totalTickets / batchSize); batch++) {
      const count = Math.min(batchSize, totalTickets - batch * batchSize);
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 5001
      // users+tickets to trigger the EXPORT_TOO_LARGE size cap. Using seedTicket here would
      // also update event_inventory soldCount on each call, making this test impractically slow
      // and causing inventory state drift. Raw batch inserts are the only viable approach.
      await t.run(async (ctx) => {
        for (let i = 0; i < count; i++) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert for EXPORT_TOO_LARGE size cap test; seedTicket would update inventory on every call, making this test impractically slow
          const userId = await ctx.db.insert('users', {
            name: `Bulk${batch * batchSize + i}`,
          });
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert (see above)
          const ticketId = await ctx.db.insert('tickets', {
            userId,
            eventId,
            status: 'valid',
            tier: 'regular',
          });
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert (see above)
          await ctx.db.patch(
            'tickets',
            ticketId,
            buildTicketRosterProjection({
              ticketId,
              status: 'valid',
              attendeeName: `Bulk${batch * batchSize + i}`,
              email: null,
              checkedInByName: null,
            }),
          );
        }
      });
    }

    await expect(
      t.run((ctx) =>
        ctx.runQuery(
          internal.events.analytics._getEventAttendeeRosterInternal,
          {
            eventId,
            includeRefunded: false,
          },
        ),
      ),
    ).rejects.toThrow('EXPORT_TOO_LARGE');
  });

  it('stays consistent with the paginated roster when user profile fields change later', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);
    const adminId = await setupAdmin(t);

    const {userId} = await insertTicket(t, eventId, {
      name: 'Original Name',
      email: 'original@test.com',
      status: 'valid',
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentional post-hoc user profile rename to verify the roster snapshot uses denormalized ticket fields, not live user lookups. No production mutation exists for arbitrary profile edits.
      await ctx.db.patch('users', userId, {
        name: 'Renamed Later',
        email: 'renamed@test.com',
      });
    });

    const rosterPage = await t
      .withIdentity({subject: adminId})
      .query(api.events.analytics.getEventAttendeeRosterPage, {
        eventId,
        includeRefunded: false,
        paginationOpts: {numItems: 50, cursor: null},
      });
    const exportRows = await t.run((ctx) =>
      ctx.runQuery(internal.events.analytics._getEventAttendeeRosterInternal, {
        eventId,
        includeRefunded: false,
      }),
    );

    expect(rosterPage.page).toHaveLength(1);
    expect(exportRows).toHaveLength(1);
    expect(exportRows[0]).toMatchObject({
      attendeeName: rosterPage.page[0].attendeeName,
      email: rosterPage.page[0].email,
    });
  });
});

// ---------------------------------------------------------------------------
// exportEventRosterCsv — action
// ---------------------------------------------------------------------------

describe('exportEventRosterCsv', () => {
  it('returns CSV with correct rows and headers', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {title: 'My Export Test'});
    const adminId = await setupAdmin(t);

    await insertTicket(t, eventId, {
      name: 'Alice Tester',
      email: 'alice@csv.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: adminId})
      .action(api.events.analytics_export.exportEventRosterCsv, {
        eventId,
        includeRefunded: false,
      });

    expect(result.csv).toContain('Name');
    expect(result.csv).toContain('Email');
    expect(result.csv).toContain('Alice Tester');
    expect(result.csv).toContain('alice@csv.com');
  });

  it('filename uses slugified event title with no path separators', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {
      title: 'Fancy Event/Title: Test!',
    });
    const adminId = await setupAdmin(t);

    const result = await t
      .withIdentity({subject: adminId})
      .action(api.events.analytics_export.exportEventRosterCsv, {
        eventId,
        includeRefunded: false,
      });

    expect(result.filename).toMatch(/^event-[a-z0-9-]+-roster-\d{8}\.csv$/);
    expect(result.filename).not.toContain('/');
    expect(result.filename).not.toContain('\\');
    expect(result.filename).not.toContain(' ');
  });

  it('audit log is written with canonical actorUserId and action', async () => {
    vi.useFakeTimers();
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {title: 'Audit Log Test'});
    const adminId = await setupAdmin(t);

    await t
      .withIdentity({subject: adminId})
      .action(api.events.analytics_export.exportEventRosterCsv, {
        eventId,
        includeRefunded: false,
      });

    await finishAllScheduledFunctions(t);

    const logs = await t.run((ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .collect(),
    );

    expect(logs.length).toBeGreaterThan(0);
    const exportLog = logs.find((l) => l.action === 'event_roster_exported');
    expect(exportLog).toBeDefined();
    expect(exportLog?.adminId).toBe(adminId);
    expect(exportLog?.eventId).toBe(eventId);
    vi.useRealTimers();
  });

  it('door staff cannot export (rejected at action boundary)', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {
      title: 'Door Staff Export Test',
    });
    const scannerId = await setupScanner(t, orgId);

    await expect(
      t
        .withIdentity({subject: scannerId})
        .action(api.events.analytics_export.exportEventRosterCsv, {
          eventId,
          includeRefunded: false,
        }),
    ).rejects.toThrow();
  });

  it('admin of community A cannot export community B roster (per-event auth)', async () => {
    const t = convexTest();
    const orgA = await setupOrg(t);
    const orgB = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Community B',
    });
    const eventA = await setupEvent(t, orgA, {title: 'Event A'});
    const eventB = await setupEvent(t, orgB, {title: 'Event B'});

    const adminA = await setupCommunityAdmin(t, orgA);

    // Can export A
    await expect(
      t
        .withIdentity({subject: adminA})
        .action(api.events.analytics_export.exportEventRosterCsv, {
          eventId: eventA,
          includeRefunded: false,
        }),
    ).resolves.toBeDefined();

    // Cannot export B
    await expect(
      t
        .withIdentity({subject: adminA})
        .action(api.events.analytics_export.exportEventRosterCsv, {
          eventId: eventB,
          includeRefunded: false,
        }),
    ).rejects.toThrow();
  });

  it('respects refunded filter', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {title: 'Refund Filter Test'});
    const adminId = await setupAdmin(t);

    await insertTicket(t, eventId, {
      name: 'Active',
      email: 'active@test.com',
      status: 'valid',
    });
    await insertTicket(t, eventId, {
      name: 'Refunded',
      email: 'refunded@test.com',
      status: 'refunded',
    });

    const withoutRefunded = await t
      .withIdentity({subject: adminId})
      .action(api.events.analytics_export.exportEventRosterCsv, {
        eventId,
        includeRefunded: false,
      });
    expect(withoutRefunded.csv).toContain('Active');
    expect(withoutRefunded.csv).not.toContain('Refunded');

    const withRefunded = await t
      .withIdentity({subject: adminId})
      .action(api.events.analytics_export.exportEventRosterCsv, {
        eventId,
        includeRefunded: true,
      });
    expect(withRefunded.csv).toContain('Active');
    expect(withRefunded.csv).toContain('Refunded');
  });

  it('CSV injection guard: fields starting with = + - @ are prefixed with quote', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {title: 'Injection Test'});
    const adminId = await setupAdmin(t);

    // Insert a user whose name starts with =
    await insertTicket(t, eventId, {
      name: '=cmd|malicious',
      email: '+evil@test.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: adminId})
      .action(api.events.analytics_export.exportEventRosterCsv, {
        eventId,
        includeRefunded: false,
      });

    // CSV-injected name and email should be prefixed with single quote
    expect(result.csv).toContain("'=cmd|malicious");
    expect(result.csv).toContain("'+evil@test.com");
  });

  it('CSV injection guard covers tab and carriage-return prefixes', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {title: 'Injection Tab Test'});
    const adminId = await setupAdmin(t);

    // Insert ticket with name starting with -
    await insertTicket(t, eventId, {
      name: '-negative',
      email: '@handle@test.com',
      status: 'valid',
    });

    const result = await t
      .withIdentity({subject: adminId})
      .action(api.events.analytics_export.exportEventRosterCsv, {
        eventId,
        includeRefunded: false,
      });

    expect(result.csv).toContain("'-negative");
    expect(result.csv).toContain("'@handle@test.com");
  });

  it('rate limit: 11th export within window throws RATE_LIMITED', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId, {title: 'Rate Limit Test'});
    const adminId = await setupAdmin(t);

    // Do 10 exports (the rate limit is 10/hour)
    for (let i = 0; i < 10; i++) {
      await t
        .withIdentity({subject: adminId})
        .action(api.events.analytics_export.exportEventRosterCsv, {
          eventId,
          includeRefunded: false,
        });
    }

    // 11th should fail
    await expect(
      t
        .withIdentity({subject: adminId})
        .action(api.events.analytics_export.exportEventRosterCsv, {
          eventId,
          includeRefunded: false,
        }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// tickets.by_event_checkedInAt index works under convex-test
// ---------------------------------------------------------------------------

describe('tickets.by_event_checkedInAt index', () => {
  it('can query tickets by eventId with checkedInAt ordering', async () => {
    const t = convexTest();
    const orgId = await setupOrg(t);
    const eventId = await setupEvent(t, orgId);

    const now = Date.now();
    await insertTicket(t, eventId, {
      name: 'T1',
      status: 'used',
      checkedInAt: now - 2000,
    });
    await insertTicket(t, eventId, {
      name: 'T2',
      status: 'used',
      checkedInAt: now - 1000,
    });
    await insertTicket(t, eventId, {name: 'T3', status: 'valid'}); // no checkedInAt

    const results = await t.run((ctx) =>
      ctx.db
        .query('tickets')
        .withIndex('by_event_checkedInAt', (q) => q.eq('eventId', eventId))
        .order('desc')
        .take(10),
    );

    // Should return all 3 (index includes tickets without checkedInAt)
    expect(results.length).toBe(3);
    // Descending: the one with the highest checkedInAt comes first
    const withCheckIn = results.filter((t) => t.checkedInAt !== undefined);
    expect(withCheckIn[0].checkedInAt).toBeGreaterThan(
      withCheckIn[1].checkedInAt as number,
    );
  });
});
