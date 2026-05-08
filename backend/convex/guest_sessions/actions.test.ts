import {describe, expect, it} from 'vitest';
import {convexTest} from '../setup.testing';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

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
});
