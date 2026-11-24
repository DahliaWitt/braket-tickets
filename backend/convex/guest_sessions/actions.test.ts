import {describe, expect, it, vi} from 'vitest';
import {getFunctionName, type FunctionReference} from 'convex/server';
import {convexTest} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import type {ActionCtx} from '../_generated/server';
import {initiateGuestSessionHandler} from './_impl/actions';

describe('guest_sessions_actions.initiateGuestSession', () => {
  it('reuses an active session when the caller presents the existing session token', async () => {
    const t = convexTest();
    const email = 'reuse-guest@example.com';
    const existingSessionToken = 'existing-reuse-session-token';
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'reuse-admin@test.com',
      name: 'Reuse Admin',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Reuse Guest Org',
      },
    )) as Id<'organizers'>;

    const {linkId} = await t.mutation(api.testing.magic_links.seedMagicLink, {
      createdBy: adminId,
      organizerId,
      token: 'reuse-guest-magic-link',
      status: 'active',
    });

    const sessionId = await t.mutation(
      api.testing.guest_sessions.seedGuestSession,
      {
        email,
        sessionToken: existingSessionToken,
      },
    );

    const result = await t.action(
      api.guest_sessions.actions.initiateGuestSession,
      {
        email,
        existingSessionToken,
        magicLinkToken: 'reuse-guest-magic-link',
      },
    );

    expect(result.sessionToken).toBe(existingSessionToken);

    const session = await t.run(async (ctx) => ctx.db.get(sessionId));
    expect(session?.magicLinkId).toBe(linkId);

    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_guestSession', (q) => q.eq('guestSessionId', sessionId))
        .collect(),
    );
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0].magicLinkId).toBe(linkId);
    expect(redemptions[0].guestSessionId).toBe(sessionId);
    expect(redemptions[0].userId).toBeUndefined();
  });

  it('rejects creating a second active session for an email without the existing session token', async () => {
    const t = convexTest();
    const email = 'reuse-guest@example.com';
    const existingSessionToken = 'existing-reuse-session-token';
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'reuse-admin@test.com',
      name: 'Reuse Admin',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Reuse Guest Org',
      },
    )) as Id<'organizers'>;

    await t.mutation(api.testing.magic_links.seedMagicLink, {
      createdBy: adminId,
      organizerId,
      token: 'reuse-guest-magic-link',
      status: 'active',
    });

    const sessionId = await t.mutation(
      api.testing.guest_sessions.seedGuestSession,
      {
        email,
        sessionToken: existingSessionToken,
      },
    );

    const originalSiteUrl = process.env['SITE_URL'];
    process.env['SITE_URL'] = 'not-a-url';
    try {
      await expect(
        t.action(api.guest_sessions.actions.initiateGuestSession, {
          email,
          magicLinkToken: 'reuse-guest-magic-link',
        }),
      ).rejects.toThrow('active guest session already exists');
    } finally {
      if (originalSiteUrl === undefined) {
        delete process.env['SITE_URL'];
      } else {
        process.env['SITE_URL'] = originalSiteUrl;
      }
    }

    const session = await t.run(async (ctx) => ctx.db.get(sessionId));
    expect(session?.sessionToken).toBeUndefined();
    expect(session?.sessionTokenDigest).toBeTruthy();
    expect(session?.pendingSessionTokenDigest).toBeUndefined();
    expect(session?.pendingSessionTokenPrefix).toBeUndefined();
    expect(session?.magicLinkId).toBeUndefined();

    const resumed = await t.action(
      api.guest_sessions.actions.initiateGuestSession,
      {
        email,
        existingSessionToken,
      },
    );
    expect(resumed.sessionToken).toBe(existingSessionToken);

    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_guestSession', (q) => q.eq('guestSessionId', sessionId))
        .collect(),
    );
    expect(redemptions).toHaveLength(0);

    const sessions = await t.run(async (ctx) =>
      ctx.db
        .query('guest_sessions')
        .withIndex('by_email', (q) => q.eq('email', email))
        .collect(),
    );
    expect(sessions).toHaveLength(1);
  });

  it('does not reuse a session that is past the inactivity window', async () => {
    const t = convexTest();
    const email = 'guest@example.com';
    const staleToken = 'stale-session-token';
    const now = Date.now();

    await t.mutation(api.testing.guest_sessions.seedGuestSession, {
      email,
      sessionToken: staleToken,
      expiresAt: now + 24 * 60 * 60 * 1000,
      lastActiveAt: now - 3 * 60 * 60 * 1000,
    });

    const result = await t.action(
      api.guest_sessions.actions.initiateGuestSession,
      {
        email,
      },
    );

    expect(result.sessionToken).not.toBe(staleToken);

    const sessions = await t.run(async (ctx) =>
      ctx.db
        .query('guest_sessions')
        .withIndex('by_email', (q) => q.eq('email', email))
        .collect(),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionToken).not.toBe(staleToken);
  });

  it('rejects expired magic links during guest-session initiation', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'admin@test.com',
      name: 'Admin',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Expired Guest Org',
      },
    )) as Id<'organizers'>;

    await t.mutation(api.testing.magic_links.seedMagicLink, {
      createdBy: adminId,
      organizerId,
      token: 'expired-guest-magic-link',
      status: 'active',
      expiresAt: Date.now() - 60_000,
    });

    await expect(
      t.action(api.guest_sessions.actions.initiateGuestSession, {
        email: 'guest@test.com',
        magicLinkToken: 'expired-guest-magic-link',
      }),
    ).rejects.toThrow('expired');

    const sessions = await t.run(async (ctx) =>
      ctx.db
        .query('guest_sessions')
        .withIndex('by_email', (q) => q.eq('email', 'guest@test.com'))
        .collect(),
    );
    expect(sessions).toHaveLength(0);
  });

  it('rejects maxed-out magic links during guest-session initiation', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'admin@test.com',
      name: 'Admin',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Maxed Guest Org',
      },
    )) as Id<'organizers'>;

    const {linkId} = await t.mutation(api.testing.magic_links.seedMagicLink, {
      createdBy: adminId,
      organizerId,
      token: 'maxed-guest-magic-link',
      status: 'active',
      maxRedemptions: 1,
    });

    await t.mutation(api.testing.magic_links.seedMagicLinkRedemption, {
      magicLinkId: linkId,
      userId: adminId,
    });

    await expect(
      t.action(api.guest_sessions.actions.initiateGuestSession, {
        email: 'guest@test.com',
        magicLinkToken: 'maxed-guest-magic-link',
      }),
    ).rejects.toThrow('redemption limit');

    const sessions = await t.run(async (ctx) =>
      ctx.db
        .query('guest_sessions')
        .withIndex('by_email', (q) => q.eq('email', 'guest@test.com'))
        .collect(),
    );
    expect(sessions).toHaveLength(0);
  });

  it('allows guest-session initiation without a clientKey', async () => {
    const t = convexTest();

    const result = await t.action(
      api.guest_sessions.actions.initiateGuestSession,
      {
        email: 'guest@test.com',
      },
    );

    expect(result.sessionToken).toBeTruthy();
  });

  it('retires an inactive referenced session in place on replacement and allows checkout with the new session', async () => {
    const t = convexTest();
    vi.useFakeTimers();

    try {
      const email = 'replace-referenced@example.com';
      const staleToken = 'stale-referenced-token';
      const now = Date.now();

      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Replace Referenced Org',
        },
      );
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Replace Referenced Event',
        date: '2099-01-01T00:00:00.000Z',
        price: 0,
        organizerId,
        totalTickets: 10,
        status: 'published',
        visibility: 'public',
      });

      const oldSessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email,
          sessionToken: staleToken,
          expiresAt: now + 24 * 60 * 60 * 1000,
        },
      );

      // Claim a ticket under the first session so it owns a ticket and order.
      const firstOrder = await t.mutation(
        api.orders.core.claimFreeTicketAsGuest,
        {
          sessionToken: staleToken,
          eventId,
          quantity: 1,
          tier: 'regular',
          termsAccepted: true,
          idempotencyKey: 'idem-replace-first-claim',
        },
      );
      expect(firstOrder.orderId).toBeDefined();

      // Advance past the 2h sliding inactivity window.
      vi.advanceTimersByTime(3 * 60 * 60 * 1000);

      // Replace the inactive session.
      const replaced = await t.action(
        api.guest_sessions.actions.initiateGuestSession,
        {email},
      );
      expect(replaced.sessionToken).not.toBe(staleToken);

      // Old session is preserved with retiredAt set and credentials wiped.
      const oldSession = await t.run(async (ctx) =>
        ctx.db.get('guest_sessions', oldSessionId),
      );
      expect(oldSession).not.toBeNull();
      expect(oldSession!.email).toBe(email);
      expect(oldSession!.retiredAt).toBeTypeOf('number');
      expect(oldSession!.sessionToken).toBeUndefined();
      expect(oldSession!.sessionTokenDigest).toBeUndefined();
      expect(oldSession!.sessionTokenPrefix).toBeUndefined();
      expect(oldSession!.pendingSessionTokenDigest).toBeUndefined();
      expect(oldSession!.pendingSessionTokenPrefix).toBeUndefined();

      // Old token can no longer authenticate checkout or order reads.
      await expect(
        t.mutation(api.orders.core.claimFreeTicketAsGuest, {
          sessionToken: staleToken,
          eventId,
          quantity: 1,
          tier: 'regular',
          termsAccepted: true,
          idempotencyKey: 'idem-replace-old-token-blocked',
        }),
      ).rejects.toThrow('Unauthenticated');

      await expect(
        t.query(api.orders.core.getCheckoutStatus, {
          orderId: firstOrder.orderId,
          sessionToken: staleToken,
        }),
      ).rejects.toThrow('Guest session is invalid or expired');

      // New replacement session can complete checkout cleanly.
      const secondOrder = await t.mutation(
        api.orders.core.claimFreeTicketAsGuest,
        {
          sessionToken: replaced.sessionToken,
          eventId,
          quantity: 1,
          tier: 'regular',
          termsAccepted: true,
          idempotencyKey: 'idem-replace-new-token-works',
        },
      );
      expect(secondOrder.orderId).toBeDefined();
      expect(secondOrder.orderId).not.toBe(firstOrder.orderId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects binding a Stripe Checkout Session when the guest session was retired mid-checkout', async () => {
    const t = convexTest();
    vi.useFakeTimers();

    try {
      const now = Date.now();
      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Paid Race Org',
          isPlatformOrganizer: true,
        },
      );
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Paid Race Event',
        date: '2099-01-01T00:00:00.000Z',
        price: 2500,
        organizerId,
        totalTickets: 10,
        status: 'published',
        visibility: 'public',
      });

      const sessionToken = 'paid-race-guest-token';
      const sessionId = await t.mutation(
        api.testing.guest_sessions.seedGuestSession,
        {
          email: 'paid-race@example.com',
          sessionToken,
          expiresAt: now + 60_000,
        },
      );

      const opened = await t.mutation(api.orders.core.openForGuest, {
        sessionToken,
        eventId,
        quantity: 1,
        tier: 'regular',
        totalAmount: 2500,
        termsAccepted: true,
      });

      // Expire and retire the guest session while checkout creation is in flight.
      vi.advanceTimersByTime(120_000);
      const cleaned = await t.mutation(
        internal.guest_sessions.core.cleanupExpiredSessions,
        {},
      );
      expect(cleaned).toBe(1);

      await expect(
        t.mutation(internal.orders.core.bindCheckoutSession, {
          orderId: opened.orderId,
          stripeCheckoutSessionId: 'cs_test_revoked_guest',
          callerGuestSessionId: sessionId,
          callerGuestSessionToken: sessionToken,
        }),
      ).rejects.toThrow('Guest session is invalid or expired');

      await expect(
        t.query(internal.orders.core.assertGuestCheckoutAccess, {
          orderId: opened.orderId,
          callerGuestSessionId: sessionId,
          callerGuestSessionToken: sessionToken,
          now: Date.now(),
        }),
      ).rejects.toThrow('Guest session is invalid or expired');

      const order = await t.run(async (ctx) =>
        ctx.db.get('ticket_orders', opened.orderId),
      );
      expect(order?.stripeCheckoutSessionId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects updateLastActive when the presented token was rotated', async () => {
    const t = convexTest();
    const sessionId = await t.mutation(
      api.testing.guest_sessions.seedGuestSession,
      {
        email: 'rotated-last-active@example.com',
        sessionToken: 'original-last-active-token',
      },
    );

    await t.mutation(internal.guest_sessions.core.rotateSessionToken, {
      sessionId,
      sessionToken: 'rotated-last-active-token',
    });

    const staleAccepted = await t.mutation(
      internal.guest_sessions.core.updateLastActive,
      {
        sessionId,
        sessionToken: 'original-last-active-token',
      },
    );
    const currentAccepted = await t.mutation(
      internal.guest_sessions.core.updateLastActive,
      {
        sessionId,
        sessionToken: 'rotated-last-active-token',
      },
    );

    expect(staleAccepted).toBe(false);
    expect(currentAccepted).toBe(true);
  });

  it('detects an older active session behind a newer converted or inactive row for the same email', async () => {
    const t = convexTest();
    const email = 'reordered-email@example.com';
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'prior-owner@example.com',
      name: 'Prior Owner',
    })) as Id<'users'>;

    // Older session is still active.
    const activeSessionId = await t.mutation(
      api.testing.guest_sessions.seedGuestSession,
      {
        email,
        sessionToken: 'older-active-token',
      },
    );
    // Newer session for the same email is already converted.
    await t.mutation(api.testing.guest_sessions.seedGuestSession, {
      email,
      sessionToken: 'newer-converted-token',
      convertedToUserId: userId,
    });

    const reusable = await t.query(
      internal.guest_sessions.core.getReusableByEmail,
      {
        email,
        now: Date.now(),
      },
    );
    expect(reusable?._id).toBe(activeSessionId);

    await expect(
      t.mutation(internal.guest_sessions.core.initiate, {
        email,
        sessionToken: 'attempted-duplicate-token',
      }),
    ).rejects.toThrow('active guest session already exists');
  });

  it('falls through to initiate when an active session retires before resume preparation or during resume email failure', async () => {
    const email = 'race-fallthrough@example.com';
    const existingSession = {
      _id: 'guest_session_1' as Id<'guest_sessions'>,
      _creationTime: Date.now(),
      email,
      expiresAt: Date.now() + 60_000,
    };

    const runCase = async (
      mode: 'missing_on_prepare' | 'inactive_on_clear',
    ) => {
      const initiateCalls: Array<Record<string, unknown>> = [];
      const mockCtx = {
        runQuery: vi.fn(async (ref: FunctionReference<'query', 'internal'>) => {
          if (
            getFunctionName(ref) ===
            getFunctionName(internal.guest_sessions.core.getReusableByEmail)
          ) {
            return existingSession;
          }
          return null;
        }),
        runMutation: vi.fn(
          async (
            ref: FunctionReference<'mutation', 'internal'>,
            args: Record<string, unknown>,
          ) => {
            if (typeof ref === 'string') {
              // Child component call (e.g. rateLimiter)
              return {ok: true};
            }
            let name: string;
            try {
              name = getFunctionName(ref);
            } catch {
              return {ok: true};
            }
            if (
              name ===
              getFunctionName(
                internal.guest_sessions.core.prepareResumeSessionToken,
              )
            ) {
              return mode === 'missing_on_prepare'
                ? {status: 'missing'}
                : {status: 'prepared'};
            }
            if (
              name ===
              getFunctionName(
                internal.guest_sessions.core.clearResumeSessionToken,
              )
            ) {
              return {status: 'inactive'};
            }
            if (
              name === getFunctionName(internal.guest_sessions.core.initiate)
            ) {
              initiateCalls.push(args);
              return {sessionToken: String(args['sessionToken'])};
            }
            // Rate limiter component call
            return {ok: true};
          },
        ),
      } as unknown as ActionCtx;

      const originalSiteUrl = process.env['SITE_URL'];
      if (mode === 'inactive_on_clear') {
        process.env['SITE_URL'] = 'not-a-url';
      }
      try {
        const result = await initiateGuestSessionHandler(mockCtx, {email});
        expect(result.sessionToken).toBeTruthy();
        expect(initiateCalls).toHaveLength(1);
      } finally {
        if (originalSiteUrl === undefined) {
          delete process.env['SITE_URL'];
        } else {
          process.env['SITE_URL'] = originalSiteUrl;
        }
      }
    };

    await runCase('missing_on_prepare');
    await runCase('inactive_on_clear');
  });
});
