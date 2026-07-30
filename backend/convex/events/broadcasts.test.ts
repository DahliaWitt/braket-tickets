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

// ── send (rich body) ──────────────────────────────────────────────────

describe('eventBroadcasts.send — rich body', () => {
  const richDoc = (content: unknown): string =>
    JSON.stringify({type: 'doc', content});

  it('validates + renders bodyJson, stores it, derives plain text, and sends rich HTML', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedTicketHolder(t, eventId, 'rich-holder@example.com');

    const bodyJson = richDoc([
      {
        type: 'paragraph',
        content: [
          {type: 'text', text: 'Doors ', marks: [{type: 'bold'}]},
          {type: 'text', text: 'at 9pm'},
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{type: 'text', text: 'bring ID'}],
              },
            ],
          },
        ],
      },
    ]);

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Rich Update',
      // Client best-effort plain text is ignored; server re-derives from bodyJson.
      message: 'client-supplied-should-be-ignored',
      bodyJson,
    });

    expect(result.success).toBe(true);

    const broadcast = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcasts')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );
    expect(broadcast).not.toBeNull();
    // Stored bodyJson is the SANITIZED document (structurally equal for a
    // clean input; raw client strings are never persisted).
    expect(JSON.parse(broadcast!.bodyJson!)).toEqual(JSON.parse(bodyJson));
    // message column is the server-derived plain text, not the client message.
    expect(broadcast!.message).toContain('Doors at 9pm');
    expect(broadcast!.message).toContain('- bring ID');
    expect(broadcast!.message).not.toContain(
      'client-supplied-should-be-ignored',
    );

    const capturedPayloads = await t.query(api.testing.email.getSentEmails, {
      to: 'rich-holder@example.com',
    });
    const payload = capturedPayloads[0] as QueuedSmtpArgs | null;
    expect(payload?.html).toContain('<strong');
    expect(payload?.html).toContain('<ul');
    expect(payload?.text).toContain('Doors at 9pm');
  });

  it('returns validation_error for a bodyJson with a javascript: link', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedTicketHolder(t, eventId, 'holder@example.com');

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Malicious',
      message: 'fallback',
      bodyJson: richDoc([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click',
              marks: [{type: 'link', attrs: {href: 'javascript:alert(1)'}}],
            },
          ],
        },
      ]),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_error');
    }

    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcasts')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(broadcasts).toHaveLength(0);
  });

  it('returns validation_error for a bodyJson with an unknown node type', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);

    await seedTicketHolder(t, eventId, 'holder@example.com');

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Bad node',
      message: 'fallback',
      bodyJson: richDoc([{type: 'script', content: []}]),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_error');
    }
  });

  // ── Inline-image security gate (adversarial) ────────────────────────
  const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  async function seedConfirmedImage(
    t: TestHarness,
    asAdmin: ReturnType<TestHarness['withIdentity']>,
  ): Promise<Id<'_storage'>> {
    const storageId = await t.run(async (ctx) => {
      const blob = new Blob([PNG_BYTES.buffer as ArrayBuffer], {
        type: 'image/png',
      });
      return await ctx.storage.store(blob);
    });
    const result = await asAdmin.action(api.storage.files.confirmUpload, {
      storageId,
      mimeType: 'image/png',
    });
    expect(result.valid).toBe(true);
    return storageId;
  }

  it('rejects a forged image src (arbitrary remote host, no storageId)', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);
    await seedTicketHolder(t, eventId, 'holder@example.com');

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Tracking pixel',
      message: 'fallback',
      bodyJson: richDoc([
        {
          type: 'image',
          attrs: {src: 'https://attacker.example/pixel.png', alt: 'x'},
        },
      ]),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_error');
    }
    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcasts')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(broadcasts).toHaveLength(0);
  });

  it('rejects an image whose storageId is not a confirmed upload', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);
    await seedTicketHolder(t, eventId, 'holder@example.com');

    // A well-formed but UNconfirmed storage id (stored, never confirmed).
    const unconfirmed = await t.run(async (ctx) => {
      const blob = new Blob([PNG_BYTES.buffer as ArrayBuffer], {
        type: 'image/png',
      });
      return await ctx.storage.store(blob);
    });

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Forged id',
      message: 'fallback',
      bodyJson: richDoc([
        {type: 'image', attrs: {storageId: unconfirmed, alt: 'x'}},
      ]),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_error');
    }
    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcasts')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(broadcasts).toHaveLength(0);
  });

  it('renders a confirmed image through the durable /api/images route', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);
    await seedTicketHolder(t, eventId, 'img-holder@example.com');
    const storageId = await seedConfirmedImage(t, asAdmin);

    // Smuggle preview-only / hostile extra attrs alongside the storageId: the
    // validator ignores them for rendering, and persistence must strip them.
    const bodyJson = richDoc([
      {
        type: 'image',
        attrs: {
          storageId,
          alt: 'flyer',
          src: 'https://signed.example/preview?sig=SECRET',
          onerror: 'alert(1)',
        },
      },
    ]);

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Confirmed image',
      message: 'fallback',
      bodyJson,
    });
    expect(result.success).toBe(true);

    const capturedPayloads = await t.query(api.testing.email.getSentEmails, {
      to: 'img-holder@example.com',
    });
    const payload = capturedPayloads[0] as QueuedSmtpArgs | null;
    // Durable, server-owned route — never the attacker host, never the signed
    // preview getUrl (which is not durable and must not be emailed).
    expect(payload?.html).toContain(
      `/api/images/${encodeURIComponent(storageId)}`,
    );
    expect(payload?.html).not.toContain('attacker');
    const signedPreviewUrl = await t.run((ctx) =>
      ctx.storage.getUrl(storageId),
    );
    expect(signedPreviewUrl).toBeTruthy();
    expect(payload?.html).not.toContain(signedPreviewUrl as string);

    // The send registered the image as published, so the public /api/images
    // route (which serves ONLY registered images) can resolve it.
    const published = await t.run((ctx) =>
      ctx.db
        .query('richEmailImages')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .first(),
    );
    expect(published).not.toBeNull();

    // Persistence regression: the stored bodyJson is the SANITIZED document —
    // the smuggled signed preview src and onerror attrs must not survive.
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcasts')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );
    expect(stored?.bodyJson).toContain(storageId);
    expect(stored?.bodyJson).not.toContain('signed.example');
    expect(stored?.bodyJson).not.toContain('onerror');
    expect(stored?.bodyJson).not.toContain('"src"');
  });

  it('rejects a body that renders past the amplification cap without burning the dedup slot', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);
    await seedTicketHolder(t, eventId, 'holder@example.com');

    // ~5KB of JSON (mostly empty paragraphs) renders to ~49KB of styled HTML —
    // past the rendered-size cap. Must fail as validation_error BEFORE the
    // dedup read so a corrected retry with the same subject still sends.
    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Amplified',
      message: 'fallback',
      bodyJson: richDoc([
        {type: 'paragraph', content: [{type: 'text', text: 'x'}]},
        ...Array.from({length: 250}, () => ({type: 'paragraph'})),
      ]),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_error');
    }

    // Same subject → same dedup key: succeeds only if the bomb never burned it.
    const retry = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Amplified',
      message: 'legit body',
    });
    expect(retry.success).toBe(true);
  });

  it('rejects an image confirmed by a different user (ownership)', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);
    await seedTicketHolder(t, eventId, 'holder@example.com');

    // A DIFFERENT user confirms an upload; the admin sender does not own it and
    // must not be able to republish it through the durable image route.
    const otherId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Other Uploader',
      email: 'other-uploader@example.com',
    });
    const storageId = await seedConfirmedImage(
      t,
      t.withIdentity({subject: otherId}),
    );

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Someone else image',
      message: 'fallback',
      bodyJson: richDoc([{type: 'image', attrs: {storageId, alt: 'x'}}]),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_error');
    }
    const broadcasts = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcasts')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(broadcasts).toHaveLength(0);
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

  it('returns already_sent (not no_recipients) when a committed broadcast later has an empty audience', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminAndEvent(t);
    await seedGuest(t, eventId, {name: 'Solo', email: 'solo@example.com'});

    const first = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Only Send',
      message: 'Hi',
    });
    expect(first.success).toBe(true);

    // Remove the only recipient so the audience is now empty on retry.
    const guestId = await t.run(
      async (ctx) =>
        (await ctx.db
          .query('guests')
          .withIndex('by_event', (q) => q.eq('eventId', eventId))
          .first())!._id,
    );
    await asAdmin.mutation(api.events.guests.remove, {id: guestId});

    const retry = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Only Send',
      message: 'Hi',
    });
    // A committed broadcast whose audience later emptied is a retry, not a
    // never-sent empty event.
    expect(retry.success).toBe(false);
    if (!retry.success) expect(retry.error).toBe('already_sent');
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

// ── external ticket-holder inclusion ─────────────────────────────────

describe('eventBroadcasts — external ticket holders', () => {
  async function seedAdminEventWithOrg(t: TestHarness) {
    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: `ext-broadcast-admin-${Date.now()}-${Math.random()}@braket.gay`,
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Ext Broadcast Org', slug: `ext-bc-${Date.now()}`},
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      ...EVENT_SEED_BASE,
      organizerId,
    });
    return {
      adminId,
      organizerId,
      eventId,
      asAdmin: t.withIdentity({subject: adminId}),
    };
  }

  it('getAudience reports the reachable/unreachable split for imported entries', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminEventWithOrg(t);

    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'bc-split-1',
      dedupMode: 'skip',
      rows: [
        {name: 'Reachable One', email: 'ext1@example.com', externalRef: 'X1'},
        {name: 'Reachable Two', email: 'ext2@example.com', externalRef: 'X2'},
        {name: 'No Email', externalRef: 'X3'},
      ],
    });

    const result = await asAdmin.query(api.events.broadcasts.getAudience, {
      eventId,
    });
    expect(result.importedReachableCount).toBe(2);
    expect(result.importedUnreachableCount).toBe(1);
    // Default ON: the 2 reachable imported entries join the audience.
    expect(result.recipientCount).toBe(2);
  });

  it('toggle ON includes imported entries with email; OFF excludes them', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminEventWithOrg(t);

    await seedTicketHolder(t, eventId, 'native@example.com');
    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'bc-toggle-1',
      dedupMode: 'skip',
      rows: [
        {name: 'Imported Emailed', email: 'imp@example.com', externalRef: 'T1'},
        {name: 'Imported NoEmail', externalRef: 'T2'},
      ],
    });

    const on = await asAdmin.query(api.events.broadcasts.getAudience, {
      eventId,
      includeExternalTicketHolders: true,
    });
    // native + 1 reachable imported.
    expect(on.recipientCount).toBe(2);

    const off = await asAdmin.query(api.events.broadcasts.getAudience, {
      eventId,
      includeExternalTicketHolders: false,
    });
    // native only.
    expect(off.recipientCount).toBe(1);
    // The split is reported regardless of the toggle.
    expect(off.importedReachableCount).toBe(1);
    expect(off.importedUnreachableCount).toBe(1);
  });

  it('send with toggle ON delivers to imported-with-email; OFF delivers to none of them', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminEventWithOrg(t);

    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'bc-send-on',
      dedupMode: 'skip',
      rows: [
        {
          name: 'Ext Recipient',
          email: 'extsend@example.com',
          externalRef: 'S1',
        },
      ],
    });

    const on = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Doors',
      message: 'Doors open at 9pm',
      includeExternalTicketHolders: true,
    });
    expect(on.success).toBe(true);
    if (on.success) expect(on.recipientCount).toBe(1);

    const captured = await t.query(api.testing.email.getSentEmails, {
      to: 'extsend@example.com',
    });
    expect(captured).toHaveLength(1);

    // A second event: same import, toggle OFF → no recipients at all.
    const second = await seedAdminEventWithOrg(t);
    await second.asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId: second.eventId,
      batchKey: 'bc-send-off',
      dedupMode: 'skip',
      rows: [
        {name: 'Ext Only', email: 'extoff@example.com', externalRef: 'S2'},
      ],
    });
    const off = await second.asAdmin.mutation(api.events.broadcasts.send, {
      eventId: second.eventId,
      subject: 'Doors',
      message: 'Doors open at 9pm',
      includeExternalTicketHolders: false,
    });
    // Only imported entries exist and they are excluded → no_recipients.
    expect(off.success).toBe(false);
    if (!off.success) expect(off.error).toBe('no_recipients');

    const capturedOff = await t.query(api.testing.email.getSentEmails, {
      to: 'extoff@example.com',
    });
    expect(capturedOff).toHaveLength(0);
  });

  it('broadening a same-subject retry (external off -> on) reaches only the newly included external holders', async () => {
    const t = convexTest();
    const {adminId, eventId, asAdmin} = await seedAdminEventWithOrg(t);

    await seedTicketHolder(t, eventId, 'native@example.com');
    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'broaden-1',
      dedupMode: 'skip',
      rows: [{name: 'Ext', email: 'external@example.com', externalRef: 'B1'}],
    });

    // First send excludes external holders: only the native holder is emailed.
    const first = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Set time',
      message: 'Set time change',
      includeExternalTicketHolders: false,
    });
    expect(first.success).toBe(true);
    if (first.success) expect(first.recipientCount).toBe(1);
    expect(
      await t.query(api.testing.email.getSentEmails, {
        to: 'external@example.com',
      }),
    ).toHaveLength(0);

    // The broadcast rate limit is 1 per 5 min per (admin, event); reset it to
    // simulate the elapsed window before the legitimate broadening resend.
    await t.mutation(api.testing.utilities.resetRateLimit, {
      name: 'broadcastEmail',
      key: `${adminId}:${eventId}`,
    });

    // Retry the SAME subject with external holders included: the external
    // recipient is reached, and the native holder is NOT re-emailed.
    const broadened = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Set time',
      message: 'Set time change',
      includeExternalTicketHolders: true,
    });
    expect(broadened.success).toBe(true);
    if (broadened.success) expect(broadened.recipientCount).toBe(1);
    expect(
      await t.query(api.testing.email.getSentEmails, {
        to: 'external@example.com',
      }),
    ).toHaveLength(1);
    // Native holder still has exactly one email from the first send.
    expect(
      await t.query(api.testing.email.getSentEmails, {
        to: 'native@example.com',
      }),
    ).toHaveLength(1);

    // A third send of the same subject with external on has nothing left.
    const third = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Set time',
      message: 'Set time change',
      includeExternalTicketHolders: true,
    });
    expect(third.success).toBe(false);
    if (!third.success) expect(third.error).toBe('already_sent');
  });

  it('a full send then a narrowing retry short-circuits as already_sent (no duplicate native email)', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminEventWithOrg(t);

    await seedTicketHolder(t, eventId, 'native2@example.com');
    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'narrow-1',
      dedupMode: 'skip',
      rows: [{name: 'Ext', email: 'external2@example.com', externalRef: 'N1'}],
    });

    // First send includes everyone (default toggle on).
    const first = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'All out',
      message: 'Goes to everyone',
    });
    expect(first.success).toBe(true);
    if (first.success) expect(first.recipientCount).toBe(2);

    // Retry the same subject with external OFF: the native segment was already
    // sent, so there is nothing new — never a duplicate to the native holder.
    const narrowed = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'All out',
      message: 'Goes to everyone',
      includeExternalTicketHolders: false,
    });
    expect(narrowed.success).toBe(false);
    if (!narrowed.success) expect(narrowed.error).toBe('already_sent');
    expect(
      await t.query(api.testing.email.getSentEmails, {
        to: 'native2@example.com',
      }),
    ).toHaveLength(1);
  });

  it('an email present as both native purchaser and imported entry receives exactly one send', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminEventWithOrg(t);

    const sharedEmail = 'shared@example.com';
    await seedTicketHolder(t, eventId, sharedEmail);
    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'bc-dedup-1',
      dedupMode: 'skip',
      rows: [
        // Same email as the native purchaser (different case to prove
        // normalized-email dedup), plus a distinct imported recipient.
        {name: 'Dup', email: sharedEmail.toUpperCase(), externalRef: 'D1'},
        {name: 'Distinct', email: 'distinct@example.com', externalRef: 'D2'},
      ],
    });

    const result = await asAdmin.mutation(api.events.broadcasts.send, {
      eventId,
      subject: 'Once',
      message: 'You should see this once',
    });
    expect(result.success).toBe(true);
    // native(shared) + distinct = 2 unique; the imported shared collides.
    if (result.success) expect(result.recipientCount).toBe(2);

    const capturedShared = await t.query(api.testing.email.getSentEmails, {
      to: sharedEmail,
    });
    expect(capturedShared).toHaveLength(1);
  });

  it('leaves native + guest recipients unaffected by imported inclusion', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await seedAdminEventWithOrg(t);

    await seedTicketHolder(t, eventId, 'nativeholder@example.com');
    await seedGuest(t, eventId, {name: 'A Guest', email: 'guest@example.com'});
    // No imported entries at all — the toggle path must not disturb the base.
    const result = await asAdmin.query(api.events.broadcasts.getAudience, {
      eventId,
    });
    expect(result.recipientCount).toBe(2);
    expect(result.importedReachableCount).toBe(0);
    expect(result.importedUnreachableCount).toBe(0);
  });
});
