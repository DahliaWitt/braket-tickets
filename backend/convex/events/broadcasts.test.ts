import {describe, expect, it} from 'vitest';
import type {TicketStatus} from '@shared/domain/ticket-status';
import {createAutoDrainConvexTest} from '../setup.testing';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

const convexTest = createAutoDrainConvexTest();
type TestHarness = ReturnType<typeof convexTest>;

type QueuedSmtpArgs = {
  to?: string;
  subject?: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
};

/** Minimal event fields required by schema. */
const EVENT_SEED_BASE = {
  title: 'Test Event',
  date: '2026-06-15T02:00:00.000Z',
  location: 'The Void',
  price: 2000,
  totalTickets: 100,
  status: 'published' as const,
  visibility: 'public' as const,
};

// ── Shared Helpers ─────────────────────────────────────────────────

async function seedAdminAndEvent(t: TestHarness) {
  const adminId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Admin',
    email: 'admin@braket.gay',
    isRootAdmin: true,
  });
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Org',
    slug: 'test-org',
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    ...EVENT_SEED_BASE,
    organizerId,
  });
  return {adminId, eventId, asAdmin: t.withIdentity({subject: adminId})};
}

async function seedTicketHolder(
  t: TestHarness,
  eventId: Id<'events'>,
  email: string,
  status: TicketStatus = 'valid',
) {
  const userId = await t.mutation(api.testing.users.createUserDirectly, {
    name: `User ${email}`,
    email: email.toLowerCase(),
  });
  await t.mutation(api.testing.tickets.seedTicket, {
    userId: userId as Id<'users'>,
    eventId,
    status,
    tier: 'regular',
    trustSource: 'open_access',
  });
  return userId;
}

async function seedTicketHolders(
  t: TestHarness,
  eventId: Id<'events'>,
  count: number,
  status: TicketStatus = 'valid',
) {
  await t.run(async (ctx) => {
    for (let index = 0; index < count; index += 1) {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of many users+tickets; calling createUserDirectly+seedTicket per row would be prohibitively slow for audience cap tests
      const userId = await ctx.db.insert('users', {
        name: `User ${index}`,
        email: `holder-${index}@example.com`,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('tickets', {
        userId,
        eventId,
        status,
        tier: 'regular',
      });
    }
  });
}

async function seedGuestCheckoutTicketHolder(
  t: TestHarness,
  eventId: Id<'events'>,
  email: string,
  status: TicketStatus = 'valid',
) {
  await t.run(async (ctx) => {
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production mutation creates guest_sessions directly; this is internal state set by guest checkout flow
    const guestSessionId = await ctx.db.insert('guest_sessions', {
      email,
      sessionToken: `token-${email}`,
      expiresAt: Date.now() + 60_000,
    });
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- guest checkout ticket without a userId; seedTicket requires a userId so this cannot be produced by seedTicket
    await ctx.db.insert('tickets', {
      guestSessionId,
      eventId,
      status,
      tier: 'regular',
    });
  });
}

async function seedGuest(
  t: TestHarness,
  eventId: Id<'events'>,
  opts: {
    name: string;
    email?: string;
    type?: 'guest' | 'artist guest' | 'staff';
  },
) {
  await t.run(async (ctx) => {
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no testing/ composite for guests; seedGuest is a test-local helper because the audience broadcast tests are the primary consumers of guest list data
    await ctx.db.insert('guests', {
      eventId,
      name: opts.name,
      email: opts.email,
      type: opts.type ?? 'guest',
    });
  });
}

async function seedAddressMarketingPreference(
  t: TestHarness,
  args: {
    email: string;
    organizerId: Id<'organizers'>;
    optedIn?: boolean;
    unsubToken?: string;
  },
) {
  await t.run(async (ctx) => {
    const normalizedEmail = args.email.toLowerCase();
    const existing = await ctx.db
      .query('emailAddressMarketingPreferences')
      .withIndex('by_email_and_organizer', (q) =>
        q.eq('email', normalizedEmail).eq('organizerId', args.organizerId),
      )
      .first();

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- address-scoped marketing preferences do not yet have a dedicated test helper mutation */
    if (existing) {
      await ctx.db.patch('emailAddressMarketingPreferences', existing._id, {
        optedIn: args.optedIn ?? true,
        updatedAt: Date.now(),
      });
      return;
    }

    await ctx.db.insert('emailAddressMarketingPreferences', {
      email: normalizedEmail,
      organizerId: args.organizerId,
      optedIn: args.optedIn ?? true,
      unsubToken: args.unsubToken ?? `guest-pref-${crypto.randomUUID()}`,
      updatedAt: Date.now(),
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
  });
}

// ── getAudience ──────────────────────────────────────────────────────

describe('eventBroadcasts.getAudience', () => {
  it('counts valid ticket holders only (excludes refunded/expired/used)', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedTicketHolder(t, eventId, 'valid@example.com', 'valid');
    await seedTicketHolder(t, eventId, 'used@example.com', 'used');
    await seedTicketHolder(t, eventId, 'refunded@example.com', 'refunded');
    await seedTicketHolder(t, eventId, 'expired@example.com', 'expired');

    const result = await asAdmin.query(api.events.broadcasts.getAudience, {
      eventId,
    });

    expect(result.recipientCount).toBe(1);
    expect(result.exceedsCap).toBe(false);
  });

  it('includes guests with email', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedGuest(t, eventId, {name: 'Guest A', email: 'a@example.com'});
    await seedGuest(t, eventId, {name: 'Guest B', email: 'b@example.com'});

    const result = await asAdmin.query(api.events.broadcasts.getAudience, {
      eventId,
    });

    expect(result.recipientCount).toBe(2);
  });

  it('excludes guests without email', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedGuest(t, eventId, {name: 'No Email Guest'});
    await seedGuest(t, eventId, {name: 'Has Email', email: 'has@example.com'});

    const result = await asAdmin.query(api.events.broadcasts.getAudience, {
      eventId,
    });

    expect(result.recipientCount).toBe(1);
  });

  it('deduplicates across tickets and guests (case-insensitive email)', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    // Ticket holder with uppercase email
    await seedTicketHolder(t, eventId, 'ALICE@Example.COM');
    // Guest with same email in lowercase
    await seedGuest(t, eventId, {
      name: 'Alice Guest',
      email: 'alice@example.com',
    });
    // Unique guest
    await seedGuest(t, eventId, {name: 'Bob Guest', email: 'bob@example.com'});

    const result = await asAdmin.query(api.events.broadcasts.getAudience, {
      eventId,
    });

    // alice (deduped) + bob = 2
    expect(result.recipientCount).toBe(2);
  });

  it('includes a registered ticket holder even when their inbox opted out as a guest (broadcasts are operational)', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    expect(event).not.toBeNull();

    await seedTicketHolder(t, eventId, 'mixed-inbox@example.com');
    await seedAddressMarketingPreference(t, {
      email: 'mixed-inbox@example.com',
      organizerId: event!.organizerId,
      optedIn: false,
      unsubToken: 'mixed-inbox-optout-token',
    });

    const result = await asAdmin.query(api.events.broadcasts.getAudience, {
      eventId,
    });

    // Broadcasts deliver event info to every ticket holder regardless of
    // marketing preferences. Opt-outs still control *marketing* sends
    // from this organizer (see marketing/emails.test.ts).
    expect(result.recipientCount).toBe(1);
    expect(result.exceedsCap).toBe(false);
  });

  it('returns the exact audience count and flags cap overflow', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedTicketHolders(t, eventId, 501);

    const result = await asAdmin.query(api.events.broadcasts.getAudience, {
      eventId,
    });

    expect(result.recipientCount).toBe(501);
    expect(result.exceedsCap).toBe(true);
  });

  it('includes guest-checkout ticket holders in the audience', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedGuestCheckoutTicketHolder(t, eventId, 'guest-holder@example.com');

    const result = await asAdmin.query(api.events.broadcasts.getAudience, {
      eventId,
    });

    expect(result.recipientCount).toBe(1);
    expect(result.exceedsCap).toBe(false);
  });
  it('rejects unauthenticated users', async () => {
    const t = convexTest();
    const {eventId} = await seedAdminAndEvent(t);

    await expect(
      t.query(api.events.broadcasts.getAudience, {eventId}),
    ).rejects.toThrow('Unauthenticated');
  });

  it('rejects non-admin users', async () => {
    const t = convexTest();
    const {eventId} = await seedAdminAndEvent(t);

    const regularId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular',
      email: 'regular-audience@test-broadcasts.com',
    });
    const asRegular = t.withIdentity({subject: regularId});

    await expect(
      asRegular.query(api.events.broadcasts.getAudience, {eventId}),
    ).rejects.toThrow('Unauthorized');
  });
});

// ── send ─────────────────────────────────────────────────────────────

describe('eventBroadcasts.send', () => {
  it('dispatches emails and inserts broadcast + audit records (happy path with 3 recipients)', async () => {
    const t = convexTest();
    const {adminId, eventId, asAdmin} = await seedAdminAndEvent(t);

    // 2 ticket holders + 1 guest = 3 unique recipients
    await seedTicketHolder(t, eventId, 'holder1@example.com');
    await seedTicketHolder(t, eventId, 'holder2@example.com');
    await seedGuest(t, eventId, {name: 'Guest 1', email: 'guest1@example.com'});

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Important Update',
      message: 'Doors open at 9pm!',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.recipientCount).toBe(3);
    }

    const broadcast = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcasts')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );
    expect(broadcast).not.toBeNull();
    expect(broadcast!.subject).toBe('Important Update');
    expect(broadcast!.message).toBe('Doors open at 9pm!');
    expect(broadcast!.recipientCount).toBe(3);
    expect(broadcast!.adminId).toEqual(adminId);
    expect(broadcast!.sentAt).toBeGreaterThan(0);

    const auditLog = await t.run(async (ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .first(),
    );
    expect(auditLog).not.toBeNull();
    expect(auditLog!.action).toBe('event.broadcast-email.send.all_holders');
    expect(auditLog!.adminId).toEqual(adminId);
    expect(auditLog!.source).toBe('admin-ui');
  });

  it('captures email payloads with unsubscribe links and RFC 8058 headers', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedTicketHolder(t, eventId, 'holder1@example.com');

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Compliance Check',
      message: 'Doors open at 9pm!',
    });

    expect(result.success).toBe(true);

    const capturedPayloads = await t.query(api.testing.email.getSentEmails, {
      to: 'holder1@example.com',
    });
    expect(capturedPayloads).toHaveLength(1);

    const payload = capturedPayloads[0] as QueuedSmtpArgs | null;
    expect(payload).not.toBeNull();
    expect(payload?.to).toBe('holder1@example.com');
    expect(payload?.subject).toBe('Compliance Check');
    expect(payload?.html).toContain('/api/unsubscribe?token=');
    expect(payload?.html).toContain('/account#email-preferences');
    expect(payload?.html).not.toContain(
      'u got this email cuz u have an account with us!! if u didnt want it... too bad XD jkjk',
    );
    expect(payload?.text).toContain('/api/unsubscribe?token=');
    expect(payload?.text).toContain('/account#email-preferences');
    expect(payload?.headers?.['List-Unsubscribe']).toContain(
      '/api/unsubscribe/one-click?token=',
    );
    expect(payload?.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
  });

  it('returns { success: false, error: "no_recipients" } when zero recipients', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Hello',
      message: 'Nobody here',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('no_recipients');
    }
  });

  it('fails closed when the audience exceeds the 500-recipient cap', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    for (let i = 0; i < 501; i += 1) {
      await seedGuest(t, eventId, {
        name: `Guest ${i}`,
        email: `guest-${i}@example.com`,
      });
    }

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Too many recipients',
      message: 'Should not send',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('too_many_recipients');
      expect(result.count).toBe(501);
    }
  });

  it('returns { success: false, error: "validation_error" } for empty subject', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: '   ', // whitespace-only trims to empty
      message: 'Body text',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_error');
      expect(result.message).toBe('Subject is required');
    }
  });

  it('returns { success: false, error: "validation_error" } for empty message', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Valid Subject',
      message: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_error');
      expect(result.message).toBe('Message is required');
    }
  });

  it('returns { success: false, error: "event_not_found" } for nonexistent event', async () => {
    const t = convexTest();
    const {asAdmin} = await seedAdminAndEvent(t);

    // Create and immediately delete to get a valid-format ID that resolves to nothing
    const throwawayOrgId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Throwaway Org',
        slug: 'throwaway-org',
      },
    );
    const throwawayEventId = await t.mutation(api.testing.events.seedEvent, {
      ...EVENT_SEED_BASE,
      organizerId: throwawayOrgId,
      title: 'Throwaway',
    });
    const deletedEventId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- deleting event to get a valid-format ID that resolves to nothing; tests fail-closed event_not_found guard
      await ctx.db.delete(throwawayEventId);
      return throwawayEventId;
    });

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId: deletedEventId,
      subject: 'Hello',
      message: 'Gone',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('event_not_found');
    }
  });

  it('rejects unauthenticated users (throws)', async () => {
    const t = convexTest();
    const {eventId} = await seedAdminAndEvent(t);

    await expect(
      t.mutation(api.events.broadcasts.send, {
        eventId,
        subject: 'Subject',
        message: 'Body',
      }),
    ).rejects.toThrow('Unauthenticated');
  });

  it('rejects non-admin users (throws)', async () => {
    const t = convexTest();
    const {eventId} = await seedAdminAndEvent(t);

    const regularId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular',
      email: 'regular-send@test-broadcasts.com',
    });
    const asRegular = t.withIdentity({subject: regularId});

    await expect(
      asRegular.mutation(api.events.broadcasts.send, {
        eventId,
        subject: 'Subject',
        message: 'Body',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('deduplicates across ticket holders and guests before sending', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    // One ticket holder with email OVERLAP@Example.COM
    await seedTicketHolder(t, eventId, 'OVERLAP@Example.COM');
    // Same email as guest (lowercase) — should be deduped
    await seedGuest(t, eventId, {
      name: 'Overlap Guest',
      email: 'overlap@example.com',
    });
    // Unique guest
    await seedGuest(t, eventId, {
      name: 'Unique Guest',
      email: 'unique@example.com',
    });

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Dedup Test',
      message: 'Testing deduplication',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // overlap (deduped) + unique = 2
      expect(result.recipientCount).toBe(2);
    }
  });

  it('includes registered ticket holders who opted out of this organizer (broadcasts are operational)', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    const optedOutUserId = await seedTicketHolder(
      t,
      eventId,
      'opted-out@example.com',
    );
    await seedTicketHolder(t, eventId, 'still-in@example.com');

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    expect(event).not.toBeNull();

    await t.mutation(api.testing.marketing.seedMarketingPreference, {
      userId: optedOutUserId,
      organizerId: event!.organizerId,
      optedIn: false,
      unsubToken: 'broadcast-optout-token',
    });

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Preference-aware update',
      message: 'Event info goes to every ticket holder.',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Both ticket holders receive the operational broadcast. The opt-out
      // only affects future marketing-announcement fan-outs.
      expect(result.recipientCount).toBe(2);
    }
  });

  it('includes guest-only recipients who opted out of this organizer (broadcasts are operational)', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    expect(event).not.toBeNull();

    await seedGuest(t, eventId, {
      name: 'Guest Opted Out',
      email: 'guest-opted-out@example.com',
    });
    await seedGuest(t, eventId, {
      name: 'Guest Still In',
      email: 'guest-still-in@example.com',
    });

    await seedAddressMarketingPreference(t, {
      email: 'guest-opted-out@example.com',
      organizerId: event!.organizerId,
      optedIn: false,
      unsubToken: 'guest-broadcast-optout-token',
    });

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Guest preference-aware update',
      message: 'Event info goes to every guest on the list.',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Guest comped into the event still receives operational broadcasts;
      // their address-level opt-out is honored by marketing announcements.
      expect(result.recipientCount).toBe(2);
    }
  });

  it('includes registered recipients whose inbox opted out as a guest (broadcasts are operational)', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId));
    expect(event).not.toBeNull();

    await seedTicketHolder(t, eventId, 'mixed-send@example.com');
    await seedTicketHolder(t, eventId, 'still-opted-in@example.com');
    await seedAddressMarketingPreference(t, {
      email: 'mixed-send@example.com',
      organizerId: event!.organizerId,
      optedIn: false,
      unsubToken: 'mixed-send-optout-token',
    });

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Address opt-out does not block operational sends',
      message: 'Every ticket holder gets event info.',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Prior guest-inbox opt-out does not block the operational broadcast;
      // the preference still governs marketing fan-outs from this organizer.
      expect(result.recipientCount).toBe(2);
    }
  });

  it('rejects oversized audiences instead of truncating them', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedTicketHolders(t, eventId, 2000);

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Too many',
      message: 'This should not send',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('too_many_recipients');
    }

    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcasts')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(broadcasts).toHaveLength(0);
  });

  it('sends to guest-checkout ticket holders', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedGuestCheckoutTicketHolder(t, eventId, 'guest-holder@example.com');

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Guest checkout',
      message: 'Included',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.recipientCount).toBe(1);
    }
  });
});

// ── listHistory ──────────────────────────────────────────────────────

describe('eventBroadcasts.listHistory', () => {
  it('returns broadcasts sorted by sentAt descending', async () => {
    const t = convexTest();
    const {adminId, eventId, asAdmin} = await seedAdminAndEvent(t);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production mutation creates eventBroadcasts directly; the send mutation creates them but also sends emails; inserting directly lets us set sentAt timestamps for sort order testing
      await ctx.db.insert('eventBroadcasts', {
        eventId,
        adminId,
        subject: 'Oldest',
        message: 'msg1',
        recipientCount: 5,
        sentAt: 1000,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('eventBroadcasts', {
        eventId,
        adminId,
        subject: 'Newest',
        message: 'msg3',
        recipientCount: 30,
        sentAt: 3000,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('eventBroadcasts', {
        eventId,
        adminId,
        subject: 'Middle',
        message: 'msg2',
        recipientCount: 15,
        sentAt: 2000,
      });
    });

    const result = await asAdmin.query(api.events.broadcasts.listHistory, {
      eventId,
    });

    expect(result).toHaveLength(3);
    expect(result[0].subject).toBe('Newest');
    expect(result[0].sentAt).toBe(3000);
    expect(result[1].subject).toBe('Middle');
    expect(result[1].sentAt).toBe(2000);
    expect(result[2].subject).toBe('Oldest');
    expect(result[2].sentAt).toBe(1000);
  });

  it('returns empty array when no broadcasts exist', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    const result = await asAdmin.query(api.events.broadcasts.listHistory, {
      eventId,
    });

    expect(result).toEqual([]);
  });

  it('includes admin name from users table', async () => {
    const t = convexTest();
    const {adminId, eventId, asAdmin} = await seedAdminAndEvent(t);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- inserting broadcast record directly to test listHistory; the send mutation also sends emails which we don't want here
      await ctx.db.insert('eventBroadcasts', {
        eventId,
        adminId,
        subject: 'Name Test',
        message: 'msg',
        recipientCount: 5,
        sentAt: Date.now(),
      });
    });

    const result = await asAdmin.query(api.events.broadcasts.listHistory, {
      eventId,
    });

    expect(result).toHaveLength(1);
    expect(result[0].adminName).toBe('Admin');
    expect(result[0].subject).toBe('Name Test');
    expect(result[0].recipientCount).toBe(5);
    expect(result[0]._id).toBeDefined();
  });

  it('shows "Unknown" when admin user record is missing', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    // Create a second admin, insert a broadcast referencing them, then delete
    const ghostAdminId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Ghost',
        email: 'ghost@braket.gay',
        isRootAdmin: true,
      },
    );

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- inserting broadcast with specific adminId then deleting the user to test Unknown fallback; this is an intentionally invalid state that production code cannot create
      await ctx.db.insert('eventBroadcasts', {
        eventId,
        adminId: ghostAdminId,
        subject: 'Ghost Broadcast',
        message: 'msg',
        recipientCount: 1,
        sentAt: Date.now(),
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- deleting user to simulate dangling adminId reference; no production delete mutation exists for users
      await ctx.db.delete(ghostAdminId);
    });

    const result = await asAdmin.query(api.events.broadcasts.listHistory, {
      eventId,
    });

    expect(result).toHaveLength(1);
    expect(result[0].adminName).toBe('Unknown');
  });

  it('rejects non-admin users', async () => {
    const t = convexTest();
    const {eventId} = await seedAdminAndEvent(t);

    const regularId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular',
      email: 'regular-history@test-broadcasts.com',
    });
    const asRegular = t.withIdentity({subject: regularId});

    await expect(
      asRegular.query(api.events.broadcasts.listHistory, {eventId}),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects unauthenticated users', async () => {
    const t = convexTest();
    const {eventId} = await seedAdminAndEvent(t);

    await expect(
      t.query(api.events.broadcasts.listHistory, {eventId}),
    ).rejects.toThrow('Unauthenticated');
  });
});

// ── Dedup guard ───────────────────────────────────────────────────────

describe('eventBroadcasts.send dedup', () => {
  it('returns already_sent when the same event+subject is sent twice', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedTicketHolder(t, eventId, 'holder@example.com');

    const first = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'First Send',
      message: 'Hello',
    });
    expect(first.success).toBe(true);

    const second = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'First Send',
      message: 'Hello',
    });
    expect(second.success).toBe(false);
    if (!second.success) {
      expect(second.error).toBe('already_sent');
    }
  });

  it('returns already_sent for a committed send even if the current audience later exceeds the cap', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedTicketHolder(t, eventId, 'holder@example.com');

    const first = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Audience Changed',
      message: 'Hello',
    });
    expect(first.success).toBe(true);

    await seedTicketHolders(t, eventId, 500);

    const second = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Audience Changed',
      message: 'Hello',
    });

    expect(second.success).toBe(false);
    if (!second.success) {
      expect(second.error).toBe('already_sent');
    }
  });

  it('allows sending to different events', async () => {
    const t = convexTest();
    const {asAdmin} = await seedAdminAndEvent(t);

    // Create two separate events to avoid the per-event rate limiter
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Org2',
        slug: 'org2',
      },
    );
    const eventId1 = await t.mutation(api.testing.events.seedEvent, {
      ...EVENT_SEED_BASE,
      organizerId,
      title: 'Event 1',
    });
    const eventId2 = await t.mutation(api.testing.events.seedEvent, {
      ...EVENT_SEED_BASE,
      organizerId,
      title: 'Event 2',
    });
    // Grant admin access (root admin already has it)
    await seedTicketHolder(t, eventId1, 'holder1@example.com');
    await seedTicketHolder(t, eventId2, 'holder2@example.com');

    const first = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId: eventId1,
      subject: 'First',
      message: 'Hello',
    });
    expect(first.success).toBe(true);

    const second = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId: eventId2,
      subject: 'Second',
      message: 'Hello again',
    });
    expect(second.success).toBe(true);
  });

  it('only records one broadcast when retried with the same content', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedTicketHolder(t, eventId, 'holder@example.com');

    await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Once',
      message: 'Only once',
    });

    // Retry with same event+subject — dedup key matches
    await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Once',
      message: 'Only once',
    });

    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcasts')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(broadcasts).toHaveLength(1);
  });
});
