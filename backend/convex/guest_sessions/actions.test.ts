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

  it('mints a fresh session for a tokenless re-entry even when the resume email fails', async () => {
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

    // Break the resume-email path: re-entry must still succeed. The courtesy
    // email is best-effort and can never block checkout.
    const originalSiteUrl = process.env['SITE_URL'];
    process.env['SITE_URL'] = 'not-a-url';
    let freshSessionToken: string;
    try {
      const result = await t.action(
        api.guest_sessions.actions.initiateGuestSession,
        {
          email,
          magicLinkToken: 'reuse-guest-magic-link',
        },
      );
      freshSessionToken = result.sessionToken;
    } finally {
      if (originalSiteUrl === undefined) {
        delete process.env['SITE_URL'];
      } else {
        process.env['SITE_URL'] = originalSiteUrl;
      }
    }

    expect(freshSessionToken).toBeTruthy();
    expect(freshSessionToken).not.toBe(existingSessionToken);

    // Old session is untouched: primary token still valid, no leftover
    // pending resume token after the failed send, no magic link attached.
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

    const sessions = await t.run(async (ctx) =>
      ctx.db
        .query('guest_sessions')
        .withIndex('by_email', (q) => q.eq('email', email))
        .collect(),
    );
    expect(sessions).toHaveLength(2);

    // The fresh session carries the magic link and its single redemption; the
    // old session gains neither.
    const oldSessionRedemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_guestSession', (q) => q.eq('guestSessionId', sessionId))
        .collect(),
    );
    expect(oldSessionRedemptions).toHaveLength(0);

    const linkRedemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId))
        .collect(),
    );
    expect(linkRedemptions).toHaveLength(1);
    const freshSession = sessions.find((s) => s._id !== sessionId);
    expect(linkRedemptions[0].guestSessionId).toBe(freshSession?._id);
    expect(freshSession?.magicLinkId).toBe(linkId);
  });

  it('burns at most one magic-link redemption per email across re-entries', async () => {
    const t = convexTest();
    const email = 'dedup-guest@example.com';
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'dedup-admin@test.com',
      name: 'Dedup Admin',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Dedup Guest Org',
      },
    )) as Id<'organizers'>;

    const {linkId} = await t.mutation(api.testing.magic_links.seedMagicLink, {
      createdBy: adminId,
      organizerId,
      token: 'dedup-guest-magic-link',
      status: 'active',
      maxRedemptions: 2,
    });

    // Same buyer redeems the link, then re-enters their email from another
    // browser context. The second session must not burn a second redemption.
    await t.action(api.guest_sessions.actions.initiateGuestSession, {
      email,
      magicLinkToken: 'dedup-guest-magic-link',
    });
    await t.action(api.guest_sessions.actions.initiateGuestSession, {
      email,
      magicLinkToken: 'dedup-guest-magic-link',
    });

    const linkRedemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId))
        .collect(),
    );
    expect(linkRedemptions).toHaveLength(1);

    const sessions = await t.run(async (ctx) =>
      ctx.db
        .query('guest_sessions')
        .withIndex('by_email', (q) => q.eq('email', email))
        .collect(),
    );
    expect(sessions).toHaveLength(2);
    // Both sessions still carry the magic link trust reference.
    for (const session of sessions) {
      expect(session.magicLinkId).toBe(linkId);
    }

    // A different email consumes the second (and final) redemption normally.
    await t.action(api.guest_sessions.actions.initiateGuestSession, {
      email: 'other-guest@example.com',
      magicLinkToken: 'dedup-guest-magic-link',
    });
    const allRedemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId))
        .collect(),
    );
    expect(allRedemptions).toHaveLength(2);
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
