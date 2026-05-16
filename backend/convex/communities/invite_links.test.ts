import {convexTest} from '../setup.testing';
import {describe, it, expect, vi} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {addMember, removeMember, authz, authzUserId} from '../lib/authz';

type MagicLinkSeedArgs = {
  token?: string;
  createdBy?: Id<'users'>;
  organizerId?: Id<'organizers'>;
  status?: 'active' | 'paused' | 'disabled';
  label?: string;
  expiresAt?: number;
  maxRedemptions?: number;
  deletedAt?: number;
};

async function seedOrganizerHelper(
  t: ReturnType<typeof convexTest>,
  name = `Test Org ${crypto.randomUUID()}`,
): Promise<Id<'organizers'>> {
  return await t.mutation(api.testing.communities.seedOrganizer, {name});
}

async function seedMagicLinkHelper(
  t: ReturnType<typeof convexTest>,
  args: MagicLinkSeedArgs = {},
): Promise<{
  linkId: Id<'magic_links'>;
  createdBy: Id<'users'>;
  organizerId: Id<'organizers'>;
  token: string;
}> {
  const createdBy =
    args.createdBy ??
    ((await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Magic Link Owner',
      email: `magic-link-owner-${crypto.randomUUID()}@test.com`,
    })) as Id<'users'>);
  const organizerId = args.organizerId ?? (await seedOrganizerHelper(t));
  const token = args.token ?? `ml-${crypto.randomUUID()}`;

  const result = (await t.mutation(api.testing.magic_links.seedMagicLink, {
    createdBy,
    organizerId,
    status: args.status ?? 'active',
    label: args.label,
    expiresAt: args.expiresAt,
    maxRedemptions: args.maxRedemptions,
    token,
  })) as {linkId: Id<'magic_links'>; token: string};

  if (args.deletedAt !== undefined) {
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: deletedAt is not settable via seedMagicLink composite; raw patch needed to test soft-deleted link behavior
      await ctx.db.patch('magic_links', result.linkId, {
        deletedAt: args.deletedAt,
      });
    });
  }

  return {linkId: result.linkId, createdBy, organizerId, token: result.token};
}

async function assignRootAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, authzUserId(userId), 'root_admin');
  });
}

async function assignCommunityAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, authzUserId(userId), 'community_admin', {
      type: 'organizer',
      id: organizerId as string,
    });
  });
}

describe('validateToken', () => {
  it('returns valid for active link', async () => {
    const t = convexTest();
    await seedMagicLinkHelper(t, {token: 'test-token-123'});

    const result = await t.query(api.communities.invite_links.validateToken, {
      token: 'test-token-123',
    });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns invalid for non-existent token', async () => {
    const t = convexTest();

    const result = await t.query(api.communities.invite_links.validateToken, {
      token: 'does-not-exist',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid');
  });

  it('returns paused for paused link', async () => {
    const t = convexTest();
    await seedMagicLinkHelper(t, {token: 'paused-token', status: 'paused'});

    const result = await t.query(api.communities.invite_links.validateToken, {
      token: 'paused-token',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('paused');
  });

  it('returns disabled for disabled link', async () => {
    const t = convexTest();
    await seedMagicLinkHelper(t, {token: 'disabled-token', status: 'disabled'});

    const result = await t.query(api.communities.invite_links.validateToken, {
      token: 'disabled-token',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('disabled');
  });

  it('returns invalid for soft-deleted link', async () => {
    const t = convexTest();
    await seedMagicLinkHelper(t, {
      token: 'deleted-token',
      status: 'disabled',
      deletedAt: Date.now(),
    });

    const result = await t.query(api.communities.invite_links.validateToken, {
      token: 'deleted-token',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid');
  });

  it('returns expired for link past expiresAt', async () => {
    const t = convexTest();
    await seedMagicLinkHelper(t, {
      token: 'expired-token',
      expiresAt: Date.now() - 60_000,
    });

    const result = await t.query(api.communities.invite_links.validateToken, {
      token: 'expired-token',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('expired');
  });

  it('returns valid for link with future expiresAt', async () => {
    const t = convexTest();
    await seedMagicLinkHelper(t, {
      token: 'future-token',
      expiresAt: Date.now() + 3_600_000,
    });

    const result = await t.query(api.communities.invite_links.validateToken, {
      token: 'future-token',
    });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns maxed when redemptions >= maxRedemptions', async () => {
    const t = convexTest();
    const {createdBy: userId, linkId} = await seedMagicLinkHelper(t, {
      token: 'maxed-token',
      maxRedemptions: 2,
    });

    // Insert 2 redemptions to hit the cap
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_link_redemption_log state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_link_redemption_log', {
        magicLinkId: linkId,
        userId,
        redeemedAt: Date.now(),
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_link_redemption_log state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_link_redemption_log', {
        magicLinkId: linkId,
        userId,
        redeemedAt: Date.now(),
      });
    });

    const result = await t.query(api.communities.invite_links.validateToken, {
      token: 'maxed-token',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('maxed');
  });

  it('returns valid when redemptions < maxRedemptions', async () => {
    const t = convexTest();
    const {createdBy: userId, linkId} = await seedMagicLinkHelper(t, {
      token: 'partial-token',
      maxRedemptions: 3,
    });

    // Insert only 1 redemption (cap is 3)
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_link_redemption_log state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_link_redemption_log', {
        magicLinkId: linkId,
        userId,
        redeemedAt: Date.now(),
      });
    });

    const result = await t.query(api.communities.invite_links.validateToken, {
      token: 'partial-token',
    });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns valid when no maxRedemptions set (unlimited)', async () => {
    const t = convexTest();
    const {createdBy: userId, linkId} = await seedMagicLinkHelper(t, {
      token: 'unlimited-token',
    });

    // Insert many redemptions -- should still be valid
    await t.run(async (ctx) => {
      for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_link_redemption_log state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
        await ctx.db.insert('magic_link_redemption_log', {
          magicLinkId: linkId,
          userId,
          redeemedAt: Date.now(),
        });
      }
    });

    const result = await t.query(api.communities.invite_links.validateToken, {
      token: 'unlimited-token',
    });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns communityName from organizerId when set on link', async () => {
    const t = convexTest();
    const orgId = await seedOrganizerHelper(t, 'Direct Org');
    await seedMagicLinkHelper(t, {
      token: 'org-token',
      organizerId: orgId,
    });

    const result = await t.query(api.communities.invite_links.validateToken, {
      token: 'org-token',
    });
    expect(result.valid).toBe(true);
    expect(result.communityName).toBe('Direct Org');
  });

  it('logs sanitized warning on invalid token', async () => {
    const t = convexTest();
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      await t.query(api.communities.invite_links.validateToken, {
        token: 'no-such-token',
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[WARN][magic_links] [SECURITY:VALIDATE_TOKEN_FAILED]',
        expect.objectContaining({reason: 'invalid', tokenPrefix: '[REDACTED]'}),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('logs sanitized warning on expired token', async () => {
    const t = convexTest();
    await seedMagicLinkHelper(t, {
      token: 'warn-expired-token',
      expiresAt: Date.now() - 60_000,
    });

    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      await t.query(api.communities.invite_links.validateToken, {
        token: 'warn-expired-token',
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[WARN][magic_links] [SECURITY:VALIDATE_TOKEN_FAILED]',
        expect.objectContaining({reason: 'expired', tokenPrefix: '[REDACTED]'}),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not log console.warn on valid token', async () => {
    const t = convexTest();
    await seedMagicLinkHelper(t, {token: 'valid-warn-token'});

    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      await t.query(api.communities.invite_links.validateToken, {
        token: 'valid-warn-token',
      });

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('create mutation', () => {
  /** Helper to create a community admin user and return authenticated test client + userId. */
  async function setupCommunityAdmin(t: ReturnType<typeof convexTest>) {
    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup organizer creation; to be replaced with seedOrganizer composite
      ctx.db.insert('organizers', {
        name: 'Test Community',
        isPublicDirectory: true,
      }),
    );
    const userId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'promoter@test.com'}),
    );
    await assignCommunityAdmin(t, userId, orgId);
    const asCommunityAdmin = t.withIdentity({subject: userId});
    const createLink = (
      args: {
        label?: string;
        expiresAt?: number;
        maxRedemptions?: number;
      } = {},
    ) =>
      asCommunityAdmin.mutation(api.communities.invite_links.create, {
        organizerId: orgId,
        ...args,
      });
    return {userId, orgId, asCommunityAdmin, createLink};
  }

  it('community admin can create a link and gets back linkId, token, url', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    const result = await createLink();

    expect(result.linkId).toBeDefined();
    expect(result.token).toBeDefined();
    expect(result.url).toContain('http://localhost:4200/invite/');
    expect(result.url).toContain(result.token);
  });

  it('regular user (no community_admin role) cannot create', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerHelper(t, 'Regular User Org');
    const userId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'regular@test.com'}),
    );
    const asUser = t.withIdentity({subject: userId});

    await expect(
      asUser.mutation(api.communities.invite_links.create, {organizerId}),
    ).rejects.toThrow('Unauthorized');
  });

  it('admin can create', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerHelper(t, 'Admin Org');
    const adminId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'admin@test.com'}),
    );
    await assignRootAdmin(t, adminId);
    const asAdmin = t.withIdentity({subject: adminId});

    const result = await asAdmin.mutation(api.communities.invite_links.create, {
      organizerId,
    });
    expect(result.linkId).toBeDefined();
    expect(result.token).toBeDefined();
  });

  it('creates an audit log entry that appears in the magic-link audit category', async () => {
    const t = convexTest();
    const {userId, orgId, asCommunityAdmin, createLink} =
      await setupCommunityAdmin(t);

    const result = await createLink({label: 'QA Test Link'});

    const rawLogs = await t.run(async (ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', userId))
        .collect(),
    );
    expect(rawLogs).toHaveLength(1);
    expect(rawLogs[0].action).toBe('magic_link.create');
    expect(rawLogs[0].organizerId).toBe(orgId);
    expect(rawLogs[0].magicLinkId).toBe(result.linkId);
    expect(rawLogs[0].source).toBe('admin-ui');

    const magicLinkLogs = await asCommunityAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        actionCategory: 'magic-link',
        paginationOpts: {numItems: 10, cursor: null},
      },
    );
    expect(magicLinkLogs.page).toHaveLength(1);
    expect(magicLinkLogs.page[0].action).toBe('magic_link.create');
    expect(magicLinkLogs.page[0].magicLinkLabel).toBe('QA Test Link');
  });

  it('token is high-entropy URL-safe bearer material', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    const result = await createLink();
    expect(result.token.length).toBeGreaterThanOrEqual(40);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('URL format is correct', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    const result = await createLink();
    expect(result.url).toBe(`http://localhost:4200/invite/${result.token}`);
  });

  it('rejects label over 100 characters', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    await expect(
      createLink({
        label: 'x'.repeat(101),
      }),
    ).rejects.toThrow('Label must be 100 characters or less');
  });

  it('rejects expiresAt in the past', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    await expect(
      createLink({
        expiresAt: Date.now() - 60_000,
      }),
    ).rejects.toThrow('Expiration date must be in the future');
  });

  it('rejects maxRedemptions < 1', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    await expect(
      createLink({
        maxRedemptions: 0,
      }),
    ).rejects.toThrow('Max redemptions must be at least 1');
  });

  it('enforces 20 active link limit', async () => {
    const t = convexTest();
    const {userId, orgId, createLink} = await setupCommunityAdmin(t);

    // Insert 20 active links directly via DB
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
        await ctx.db.insert('magic_links', {
          token: `existing-token-${i}`,
          createdBy: userId,
          organizerId: orgId,
          status: 'active',
        });
      }
    });

    await expect(createLink()).rejects.toThrow(
      'Maximum 20 active magic links per community admin',
    );
  });

  it('scopes the active link limit to the target community', async () => {
    const t = convexTest();
    const {userId, createLink} = await setupCommunityAdmin(t);
    const otherOrgId = await seedOrganizerHelper(t, 'Other Community');

    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links rows in a different community
        await ctx.db.insert('magic_links', {
          token: `other-community-token-${i}`,
          createdBy: userId,
          organizerId: otherOrgId,
          status: 'active',
        });
      }
    });

    await expect(createLink()).resolves.toMatchObject({
      linkId: expect.any(String),
      token: expect.any(String),
    });
  });

  it('each call produces a unique token', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    const result1 = await createLink();
    const result2 = await createLink();

    expect(result1.token).not.toBe(result2.token);
    expect(result1.linkId).not.toBe(result2.linkId);
  });

  it('stores link data correctly in the database', async () => {
    const t = convexTest();
    const {userId, orgId, createLink} = await setupCommunityAdmin(t);

    const futureDate = Date.now() + 3_600_000;
    const result = await createLink({
      label: 'Test Link',
      expiresAt: futureDate,
      maxRedemptions: 50,
    });

    const link = await t.run(async (ctx) => ctx.db.get(result.linkId));
    expect(link).not.toBeNull();
    expect(link!.token).toBeUndefined();
    expect(link!.tokenDigest).toBeTruthy();
    expect(link!.tokenPrefix).toBe(result.token.slice(0, 8));
    expect(link!.createdBy).toBe(userId);
    expect(link!.organizerId).toBe(orgId);
    expect(link!.status).toBe('active');
    expect(link!.label).toBe('Test Link');
    expect(link!.expiresAt).toBe(futureDate);
    expect(link!.maxRedemptions).toBe(50);
  });

  it('unauthenticated user cannot create', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerHelper(t, 'Unauthenticated Org');

    await expect(
      t.mutation(api.communities.invite_links.create, {organizerId}),
    ).rejects.toThrow('Unauthenticated');
  });

  it('does not count soft-deleted links toward the 20 limit', async () => {
    const t = convexTest();
    const {userId, orgId, createLink} = await setupCommunityAdmin(t);

    // Insert 20 active links, but 5 are soft-deleted
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
        await ctx.db.insert('magic_links', {
          token: `limit-test-token-${i}`,
          createdBy: userId,
          organizerId: orgId,
          status: 'active',
          deletedAt: i < 5 ? Date.now() : undefined,
        });
      }
    });

    // 15 non-deleted active links -- should be able to create 5 more
    const result = await createLink();
    expect(result.linkId).toBeDefined();
  });

  it('auto-generates label when none is provided', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    const result = await createLink();
    const link = await t.run(async (ctx) => ctx.db.get(result.linkId));
    expect(link!.label).toBe('Link 1');
  });

  it('auto-generates sequential labels based on existing link count', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    // Create first link — should be "Link 1"
    const result1 = await createLink();
    const link1 = await t.run(async (ctx) => ctx.db.get(result1.linkId));
    expect(link1!.label).toBe('Link 1');

    // Create second link — should be "Link 2"
    const result2 = await createLink();
    const link2 = await t.run(async (ctx) => ctx.db.get(result2.linkId));
    expect(link2!.label).toBe('Link 2');
  });

  it('preserves explicit label when provided', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    const result = await createLink({
      label: 'VIP Entry',
    });
    const link = await t.run(async (ctx) => ctx.db.get(result.linkId));
    expect(link!.label).toBe('VIP Entry');
  });

  it('auto-generates label when empty string is provided', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    const result = await createLink({
      label: '   ',
    });
    const link = await t.run(async (ctx) => ctx.db.get(result.linkId));
    expect(link!.label).toBe('Link 1');
  });

  it('avoids duplicate labels after link deletion', async () => {
    const t = convexTest();
    const {createLink, asCommunityAdmin} = await setupCommunityAdmin(t);

    // Create two links: "Link 1" and "Link 2"
    const result1 = await createLink();
    await createLink();

    // Soft-delete "Link 1"
    await asCommunityAdmin.mutation(api.communities.invite_links.updateStatus, {
      linkId: result1.linkId,
      action: 'delete',
    });

    // Next link should be "Link 3", not "Link 2" (which still exists)
    const result3 = await createLink();
    const link3 = await t.run(async (ctx) => ctx.db.get(result3.linkId));
    expect(link3!.label).toBe('Link 3');
  });

  it('created link is findable by validateToken (roundtrip)', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    // Create via the real mutation (RLS-wrapped writer)
    const {token} = await createLink();

    // Validate via the bare query (no auth, same as anonymous /invite/:token)
    const result = await t.query(api.communities.invite_links.validateToken, {
      token,
    });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('truncated token returns invalid (BRA-210 regression)', async () => {
    const t = convexTest();
    const {createLink} = await setupCommunityAdmin(t);

    const {token} = await createLink();

    // Simulate what happens when a user copies the truncated display (first 12 chars)
    const truncated = token.slice(0, 12);
    const result = await t.query(api.communities.invite_links.validateToken, {
      token: truncated,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid');
  });
});

describe('updateStatus mutation', () => {
  /** Helper to create a community admin user, authenticate, and insert an active magic link. */
  async function setupCommunityAdminWithLink(
    t: ReturnType<typeof convexTest>,
    overrides?: {status?: 'active' | 'paused' | 'disabled'; deletedAt?: number},
  ) {
    const organizerId = await seedOrganizerHelper(t, 'Update Test Community');
    const userId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'promoter@test.com'}),
    );
    await assignCommunityAdmin(t, userId, organizerId);
    const asCommunityAdmin = t.withIdentity({subject: userId});

    const linkId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      ctx.db.insert('magic_links', {
        token: 'update-test-token',
        createdBy: userId,
        organizerId,
        status: overrides?.status ?? 'active',
        deletedAt: overrides?.deletedAt,
      }),
    );

    return {userId, organizerId, asCommunityAdmin, linkId};
  }

  it('pause from active succeeds', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t);

    const result = await asCommunityAdmin.mutation(
      api.communities.invite_links.updateStatus,
      {
        linkId,
        action: 'pause',
      },
    );
    expect(result.success).toBe(true);

    const link = await t.run(async (ctx) => ctx.db.get(linkId));
    expect(link!.status).toBe('paused');
  });

  it('resume from paused succeeds', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t, {
      status: 'paused',
    });

    const result = await asCommunityAdmin.mutation(
      api.communities.invite_links.updateStatus,
      {
        linkId,
        action: 'resume',
      },
    );
    expect(result.success).toBe(true);

    const link = await t.run(async (ctx) => ctx.db.get(linkId));
    expect(link!.status).toBe('active');
  });

  it('disable from active succeeds', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t);

    const result = await asCommunityAdmin.mutation(
      api.communities.invite_links.updateStatus,
      {
        linkId,
        action: 'disable',
      },
    );
    expect(result.success).toBe(true);

    const link = await t.run(async (ctx) => ctx.db.get(linkId));
    expect(link!.status).toBe('disabled');
  });

  it('disable from paused succeeds', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t, {
      status: 'paused',
    });

    const result = await asCommunityAdmin.mutation(
      api.communities.invite_links.updateStatus,
      {
        linkId,
        action: 'disable',
      },
    );
    expect(result.success).toBe(true);

    const link = await t.run(async (ctx) => ctx.db.get(linkId));
    expect(link!.status).toBe('disabled');
  });

  it('delete from active sets deletedAt and status=disabled', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t);

    const result = await asCommunityAdmin.mutation(
      api.communities.invite_links.updateStatus,
      {
        linkId,
        action: 'delete',
      },
    );
    expect(result.success).toBe(true);

    const link = await t.run(async (ctx) => ctx.db.get(linkId));
    expect(link!.status).toBe('disabled');
    expect(link!.deletedAt).toBeDefined();
    expect(typeof link!.deletedAt).toBe('number');
  });

  it('delete from paused sets deletedAt and status=disabled', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t, {
      status: 'paused',
    });

    const result = await asCommunityAdmin.mutation(
      api.communities.invite_links.updateStatus,
      {
        linkId,
        action: 'delete',
      },
    );
    expect(result.success).toBe(true);

    const link = await t.run(async (ctx) => ctx.db.get(linkId));
    expect(link!.status).toBe('disabled');
    expect(link!.deletedAt).toBeDefined();
  });

  it('delete from disabled sets deletedAt and status=disabled', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t, {
      status: 'disabled',
    });

    const result = await asCommunityAdmin.mutation(
      api.communities.invite_links.updateStatus,
      {
        linkId,
        action: 'delete',
      },
    );
    expect(result.success).toBe(true);

    const link = await t.run(async (ctx) => ctx.db.get(linkId));
    expect(link!.status).toBe('disabled');
    expect(link!.deletedAt).toBeDefined();
  });

  it('writes audit log entries for lifecycle actions', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerHelper(t, 'Magic Link Audit Org');
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Magic Link Admin',
      email: `magic-link-admin-${crypto.randomUUID()}@test.com`,
    })) as Id<'users'>;
    await assignCommunityAdmin(t, userId, organizerId);
    const asCommunityAdmin = t.withIdentity({subject: userId});

    const scenarios = [
      {
        initialStatus: 'active' as const,
        action: 'pause' as const,
        expectedAction: 'magic_link.pause',
      },
      {
        initialStatus: 'paused' as const,
        action: 'resume' as const,
        expectedAction: 'magic_link.resume',
      },
      {
        initialStatus: 'active' as const,
        action: 'disable' as const,
        expectedAction: 'magic_link.disable',
      },
      {
        initialStatus: 'active' as const,
        action: 'delete' as const,
        expectedAction: 'magic_link.delete',
      },
    ];

    const expectedActions: string[] = [];

    for (const [index, scenario] of scenarios.entries()) {
      const {linkId} = await seedMagicLinkHelper(t, {
        organizerId,
        createdBy: userId,
        status: scenario.initialStatus,
        label: `Lifecycle Link ${index + 1}`,
      });

      await asCommunityAdmin.mutation(
        api.communities.invite_links.updateStatus,
        {
          linkId,
          action: scenario.action,
        },
      );

      expectedActions.push(scenario.expectedAction);
    }

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', userId))
        .collect(),
    );

    expect(logs).toHaveLength(expectedActions.length);
    expect(logs.map((log) => log.action).sort()).toEqual(
      expectedActions.sort(),
    );
    for (const log of logs) {
      expect(log.organizerId).toBe(organizerId);
      expect(log.source).toBe('admin-ui');
      expect(log.magicLinkId).toBeDefined();
    }
  });

  it('resume from active fails (not in state machine)', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t);

    await expect(
      asCommunityAdmin.mutation(api.communities.invite_links.updateStatus, {
        linkId,
        action: 'resume',
      }),
    ).rejects.toThrow('Cannot resume a active link');
  });

  it('resume from disabled fails', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t, {
      status: 'disabled',
    });

    await expect(
      asCommunityAdmin.mutation(api.communities.invite_links.updateStatus, {
        linkId,
        action: 'resume',
      }),
    ).rejects.toThrow('Cannot resume a disabled link');
  });

  it('pause from disabled fails', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t, {
      status: 'disabled',
    });

    await expect(
      asCommunityAdmin.mutation(api.communities.invite_links.updateStatus, {
        linkId,
        action: 'pause',
      }),
    ).rejects.toThrow('Cannot pause a disabled link');
  });

  it('pause from paused fails', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t, {
      status: 'paused',
    });

    await expect(
      asCommunityAdmin.mutation(api.communities.invite_links.updateStatus, {
        linkId,
        action: 'pause',
      }),
    ).rejects.toThrow('Cannot pause a paused link');
  });

  it('action on deleted link fails', async () => {
    const t = convexTest();
    const {asCommunityAdmin, linkId} = await setupCommunityAdminWithLink(t, {
      status: 'disabled',
      deletedAt: Date.now(),
    });

    await expect(
      asCommunityAdmin.mutation(api.communities.invite_links.updateStatus, {
        linkId,
        action: 'delete',
      }),
    ).rejects.toThrow('Link has been deleted');
  });

  it('non-owner cannot modify link', async () => {
    const t = convexTest();
    // Create the link as one community admin
    const {linkId} = await setupCommunityAdminWithLink(t);

    // Create a different community admin
    const otherUserId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'other@test.com'}),
    );
    const asOther = t.withIdentity({subject: otherUserId});

    await expect(
      asOther.mutation(api.communities.invite_links.updateStatus, {
        linkId,
        action: 'pause',
      }),
    ).rejects.toThrow('Not authorized to modify this link');
  });

  it('admin can modify any link', async () => {
    const t = convexTest();
    const {linkId} = await setupCommunityAdminWithLink(t);

    // Create an admin user
    const adminId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'admin@test.com'}),
    );
    await assignRootAdmin(t, adminId);
    const asAdmin = t.withIdentity({subject: adminId});

    const result = await asAdmin.mutation(
      api.communities.invite_links.updateStatus,
      {
        linkId,
        action: 'pause',
      },
    );
    expect(result.success).toBe(true);

    const link = await t.run(async (ctx) => ctx.db.get(linkId));
    expect(link!.status).toBe('paused');
  });

  it('unauthenticated user cannot update status', async () => {
    const t = convexTest();
    const {linkId} = await setupCommunityAdminWithLink(t);

    await expect(
      t.mutation(api.communities.invite_links.updateStatus, {
        linkId,
        action: 'pause',
      }),
    ).rejects.toThrow('Unauthenticated');
  });
});

describe('redeem mutation', () => {
  /** Helper to create a community admin, an active magic link, and a regular user who will redeem. */
  async function setupRedeemScenario(
    t: ReturnType<typeof convexTest>,
    linkOverrides?: {
      status?: 'active' | 'paused' | 'disabled';
      expiresAt?: number;
      maxRedemptions?: number;
      deletedAt?: number;
    },
  ) {
    const [promoterId, organizerId] = await t.run(async (ctx) =>
      Promise.all([
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
        ctx.db.insert('users', {email: 'promoter@test.com'}),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup organizer creation; to be replaced with seedOrganizer composite
        ctx.db.insert('organizers', {
          name: 'Redeem Test Community',
          isPublicDirectory: true,
        }),
      ]),
    );

    const linkId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      ctx.db.insert('magic_links', {
        token: 'redeem-test-token',
        createdBy: promoterId,
        organizerId,
        status: linkOverrides?.status ?? 'active',
        expiresAt: linkOverrides?.expiresAt,
        maxRedemptions: linkOverrides?.maxRedemptions,
        deletedAt: linkOverrides?.deletedAt,
      }),
    );
    await assignCommunityAdmin(t, promoterId, organizerId);

    const redeemerId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'redeemer@test.com'}),
    );
    const asRedeemer = t.withIdentity({subject: redeemerId});

    return {promoterId, organizerId, linkId, redeemerId, asRedeemer};
  }

  it('valid redemption records organizer access without mutating the user document', async () => {
    const t = convexTest();
    const {redeemerId, organizerId, linkId, asRedeemer} =
      await setupRedeemScenario(t);

    const result = await asRedeemer.mutation(
      api.communities.invite_links.redeem,
      {
        token: 'redeem-test-token',
      },
    );

    expect(result.success).toBe(true);
    expect(result.alreadyRedeemed).toBe(false);
    expect(result.alreadyMember).toBe(false);
    expect(result.message).toBe('Welcome! You are now part of the community.');

    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_magicLink_user', (q) =>
          q.eq('magicLinkId', linkId).eq('userId', redeemerId),
        )
        .collect(),
    );
    expect(redemptions).toHaveLength(1);

    const member = await t.run(async (ctx) =>
      authz.hasRole(ctx, redeemerId as string, 'member', {
        type: 'organizer',
        id: organizerId as string,
      }),
    );
    expect(member).toBe(true);
  });

  it('rejects active legacy links whose creator no longer manages the community', async () => {
    const t = convexTest();
    const {promoterId, organizerId, linkId, asRedeemer} =
      await setupRedeemScenario(t);

    await t.run(async (ctx) => {
      await authz.revokeRole(
        ctx,
        promoterId as string,
        'community_admin',
        {type: 'organizer', id: organizerId as string},
        promoterId as string,
      );
    });

    await expect(
      asRedeemer.mutation(api.communities.invite_links.redeem, {
        token: 'redeem-test-token',
      }),
    ).rejects.toThrow('This link is no longer active');

    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId))
        .collect(),
    );
    expect(redemptions).toHaveLength(0);
  });

  it('redemption record created with correct fields', async () => {
    const t = convexTest();
    const {linkId, redeemerId, asRedeemer} = await setupRedeemScenario(t);

    await asRedeemer.mutation(api.communities.invite_links.redeem, {
      token: 'redeem-test-token',
    });

    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId))
        .collect(),
    );

    expect(redemptions).toHaveLength(1);
    expect(redemptions[0].magicLinkId).toBe(linkId);
    expect(redemptions[0].userId).toBe(redeemerId);
    expect(typeof redemptions[0].redeemedAt).toBe('number');
  });

  it('expired link rejected', async () => {
    const t = convexTest();
    const {asRedeemer} = await setupRedeemScenario(t, {
      expiresAt: Date.now() - 60_000, // 1 minute ago
    });

    await expect(
      asRedeemer.mutation(api.communities.invite_links.redeem, {
        token: 'redeem-test-token',
      }),
    ).rejects.toThrow('This link has expired');
  });

  it('maxed link rejected', async () => {
    const t = convexTest();
    const {linkId, asRedeemer} = await setupRedeemScenario(t, {
      maxRedemptions: 2,
    });

    // Create 2 existing redemptions to hit the cap
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      const user1 = await ctx.db.insert('users', {email: 'u1@test.com'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      const user2 = await ctx.db.insert('users', {email: 'u2@test.com'});
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_link_redemption_log state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_link_redemption_log', {
        magicLinkId: linkId,
        userId: user1,
        redeemedAt: Date.now(),
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_link_redemption_log state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_link_redemption_log', {
        magicLinkId: linkId,
        userId: user2,
        redeemedAt: Date.now(),
      });
    });

    await expect(
      asRedeemer.mutation(api.communities.invite_links.redeem, {
        token: 'redeem-test-token',
      }),
    ).rejects.toThrow('This link has reached its maximum redemptions');
  });

  it('paused link rejected', async () => {
    const t = convexTest();
    const {asRedeemer} = await setupRedeemScenario(t, {status: 'paused'});

    await expect(
      asRedeemer.mutation(api.communities.invite_links.redeem, {
        token: 'redeem-test-token',
      }),
    ).rejects.toThrow('This link has been temporarily paused');
  });

  it('disabled link rejected', async () => {
    const t = convexTest();
    const {asRedeemer} = await setupRedeemScenario(t, {status: 'disabled'});

    await expect(
      asRedeemer.mutation(api.communities.invite_links.redeem, {
        token: 'redeem-test-token',
      }),
    ).rejects.toThrow('This link is no longer active');
  });

  it('deleted link rejected', async () => {
    const t = convexTest();
    const {asRedeemer} = await setupRedeemScenario(t, {
      status: 'disabled',
      deletedAt: Date.now(),
    });

    await expect(
      asRedeemer.mutation(api.communities.invite_links.redeem, {
        token: 'redeem-test-token',
      }),
    ).rejects.toThrow('This link does not exist or has been removed');
  });

  it('idempotency: same user redeems same link twice returns alreadyRedeemed=true', async () => {
    const t = convexTest();
    const {linkId, asRedeemer} = await setupRedeemScenario(t);

    // First redemption
    const first = await asRedeemer.mutation(
      api.communities.invite_links.redeem,
      {
        token: 'redeem-test-token',
      },
    );
    expect(first.success).toBe(true);
    expect(first.alreadyRedeemed).toBe(false);

    // Second redemption (idempotent) — user is now a member, so the member
    // message takes priority over the "already used this link" message.
    const second = await asRedeemer.mutation(
      api.communities.invite_links.redeem,
      {
        token: 'redeem-test-token',
      },
    );
    expect(second.success).toBe(true);
    expect(second.alreadyRedeemed).toBe(true);
    expect(second.alreadyMember).toBe(true);
    expect(second.message).toBe('You are already a member of this community.');

    // Count should still be 1
    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId))
        .collect(),
    );
    expect(redemptions).toHaveLength(1);
  });

  it('idempotency: already redeemed but membership removed shows alreadyRedeemed message (BRA-363)', async () => {
    const t = convexTest();
    const {linkId, organizerId, redeemerId, asRedeemer} =
      await setupRedeemScenario(t);

    // First redemption — user becomes a member
    const first = await asRedeemer.mutation(
      api.communities.invite_links.redeem,
      {
        token: 'redeem-test-token',
      },
    );
    expect(first.success).toBe(true);
    expect(first.alreadyRedeemed).toBe(false);

    // Admin removes them from the community
    await t.run(async (ctx) => {
      await removeMember(ctx, redeemerId, organizerId);
    });

    // Second redemption — they redeemed before but are no longer a member,
    // so the "already used this link" message is correct here.
    const second = await asRedeemer.mutation(
      api.communities.invite_links.redeem,
      {
        token: 'redeem-test-token',
      },
    );
    expect(second.success).toBe(true);
    expect(second.alreadyRedeemed).toBe(true);
    expect(second.alreadyMember).toBe(false);
    expect(second.message).toBe("You've already used this link");

    // Redemption log count stays at 1
    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId))
        .collect(),
    );
    expect(redemptions).toHaveLength(1);
  });

  it('already member still records redemption (BRA-137)', async () => {
    const t = convexTest();
    const {linkId, organizerId, redeemerId, asRedeemer} =
      await setupRedeemScenario(t);

    await t.run(async (ctx) => {
      await addMember(ctx, redeemerId, organizerId);
    });

    const result = await asRedeemer.mutation(
      api.communities.invite_links.redeem,
      {
        token: 'redeem-test-token',
      },
    );
    expect(result.success).toBe(true);
    expect(result.alreadyMember).toBe(true);
    expect(result.alreadyRedeemed).toBe(false);
    expect(result.message).toBe('You are already a member of this community.');

    // Redemption record IS created so admin counter reflects link usage
    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId))
        .collect(),
    );
    expect(redemptions).toHaveLength(1);
  });

  it('removed member can claim a magic link again', async () => {
    const t = convexTest();
    const {linkId, organizerId, redeemerId, asRedeemer} =
      await setupRedeemScenario(t, {
        maxRedemptions: 1,
      });

    await t.run(async (ctx) => {
      await addMember(ctx, redeemerId, organizerId);
      await removeMember(ctx, redeemerId, organizerId);
    });

    const result = await asRedeemer.mutation(
      api.communities.invite_links.redeem,
      {
        token: 'redeem-test-token',
      },
    );
    expect(result.success).toBe(true);
    expect(result.alreadyMember).toBe(false);
    expect(result.alreadyRedeemed).toBe(false);

    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId))
        .collect(),
    );
    expect(redemptions).toHaveLength(1);

    const member = await t.run(async (ctx) =>
      authz.hasRole(ctx, redeemerId as string, 'member', {
        type: 'organizer',
        id: organizerId as string,
      }),
    );
    expect(member).toBe(true);
  });

  it('already member consumes a limited-use slot (BRA-137)', async () => {
    const t = convexTest();
    const {linkId, organizerId, redeemerId, asRedeemer} =
      await setupRedeemScenario(t, {
        maxRedemptions: 1,
      });

    await t.run(async (ctx) => {
      await addMember(ctx, redeemerId, organizerId);
    });

    // Trusted user visits the link — now consumes the slot
    const result = await asRedeemer.mutation(
      api.communities.invite_links.redeem,
      {
        token: 'redeem-test-token',
      },
    );
    expect(result.success).toBe(true);
    expect(result.alreadyMember).toBe(true);

    // The single slot is now consumed
    const redemptions = await t.run(async (ctx) =>
      ctx.db
        .query('magic_link_redemption_log')
        .withIndex('by_magicLink', (q) => q.eq('magicLinkId', linkId))
        .collect(),
    );
    expect(redemptions).toHaveLength(1);

    // A new user should be rejected (cap reached)
    const newUserId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'newuser@test.com'}),
    );
    const asNewUser = t.withIdentity({subject: newUserId});

    await expect(
      asNewUser.mutation(api.communities.invite_links.redeem, {
        token: 'redeem-test-token',
      }),
    ).rejects.toThrow('This link has reached its maximum redemptions');
  });

  it('already member creates an audit log (BRA-137)', async () => {
    const t = convexTest();
    const {promoterId, organizerId, redeemerId, asRedeemer} =
      await setupRedeemScenario(t);

    await t.run(async (ctx) => {
      await addMember(ctx, redeemerId, organizerId);
    });

    await asRedeemer.mutation(api.communities.invite_links.redeem, {
      token: 'redeem-test-token',
    });

    // Audit log IS created for all redemptions
    const logs = await t.run(async (ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', promoterId))
        .collect(),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('magic_link.redemption');
  });

  it('audit log created with correct action', async () => {
    const t = convexTest();
    const {promoterId, linkId, redeemerId, asRedeemer} =
      await setupRedeemScenario(t);

    await asRedeemer.mutation(api.communities.invite_links.redeem, {
      token: 'redeem-test-token',
    });

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', promoterId))
        .collect(),
    );

    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('magic_link.redemption');
    expect(logs[0].source).toBe(
      `redeemer:${redeemerId} link:${linkId} community_admin:${promoterId}`,
    );
    expect(logs[0].adminId).toBe(promoterId);
  });

  it('non-existent token rejected', async () => {
    const t = convexTest();
    const redeemerId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'redeemer@test.com'}),
    );
    const asRedeemer = t.withIdentity({subject: redeemerId});

    await expect(
      asRedeemer.mutation(api.communities.invite_links.redeem, {
        token: 'nonexistent-token',
      }),
    ).rejects.toThrow('This link does not exist or has been removed');
  });

  it('unauthenticated user rejected', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerHelper(
      t,
      'Unauthenticated Redeem Org',
    );

    // Create a link so the token exists (to confirm failure is auth, not token)
    const promoterId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'p@test.com'}),
    );
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_links', {
        token: 'unauth-test-token',
        createdBy: promoterId,
        organizerId,
        status: 'active',
      });
    });

    await expect(
      t.mutation(api.communities.invite_links.redeem, {
        token: 'unauth-test-token',
      }),
    ).rejects.toThrow('Unauthenticated');
  });

  describe('redeem security logging', () => {
    it('logs sanitized warning for invalid token redemption', async () => {
      const t = convexTest();
      const redeemerId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
        ctx.db.insert('users', {email: 'redeemer@test.com'}),
      );
      const asRedeemer = t.withIdentity({subject: redeemerId});

      const warnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        await expect(
          asRedeemer.mutation(api.communities.invite_links.redeem, {
            token: 'bogus-token-xyz',
          }),
        ).rejects.toThrow('This link does not exist or has been removed');

        expect(warnSpy).toHaveBeenCalledWith(
          '[WARN][magic_links] [SECURITY:REDEEM_FAILED]',
          expect.objectContaining({
            reason: 'invalid',
            tokenPrefix: '[REDACTED]',
          }),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

describe('listMyLinks query', () => {
  /** Helper to create a community admin user and return authenticated test client + userId. */
  async function setupCommunityAdmin(t: ReturnType<typeof convexTest>) {
    const orgId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup organizer creation; to be replaced with seedOrganizer composite
      ctx.db.insert('organizers', {
        name: 'Test Community',
        isPublicDirectory: true,
      }),
    );
    const userId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'promoter@test.com'}),
    );
    await assignCommunityAdmin(t, userId, orgId);
    const asCommunityAdmin = t.withIdentity({subject: userId});
    return {userId, orgId, asCommunityAdmin};
  }

  it('returns empty array for unauthenticated user', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerHelper(t, 'Unauthed Links Org');

    const result = await t.query(api.communities.invite_links.listMyLinks, {
      organizerId,
    });
    expect(result).toEqual([]);
  });

  it('returns empty array when community admin has no links', async () => {
    const t = convexTest();
    const {orgId, asCommunityAdmin} = await setupCommunityAdmin(t);

    const result = await asCommunityAdmin.query(
      api.communities.invite_links.listMyLinks,
      {organizerId: orgId},
    );
    expect(result).toEqual([]);
  });

  it("returns only the caller's links, not other community admins' links", async () => {
    const t = convexTest();
    const {userId, orgId, asCommunityAdmin} = await setupCommunityAdmin(t);

    // Create a link for our community admin
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_links', {
        token: 'my-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'active',
      });
    });

    // Create a link for a different community admin
    const otherUserId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
      ctx.db.insert('users', {email: 'other@test.com'}),
    );
    const otherOrgId = await seedOrganizerHelper(t, 'Other List Org');
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_links', {
        token: 'other-link',
        createdBy: otherUserId,
        organizerId: otherOrgId,
        status: 'active',
      });
    });

    const result = await asCommunityAdmin.query(
      api.communities.invite_links.listMyLinks,
      {organizerId: orgId},
    );
    expect(result).toHaveLength(1);
    expect(result[0].tokenPrefix).toBe('my-link');
  });

  it("returns only the selected community's links for an admin who manages multiple communities", async () => {
    const t = convexTest();
    const {userId, orgId, asCommunityAdmin} = await setupCommunityAdmin(t);
    const otherOrgId = await seedOrganizerHelper(t, 'Second Managed Org');
    await assignCommunityAdmin(t, userId, otherOrgId);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for cross-community magic_links filtering
      await ctx.db.insert('magic_links', {
        token: 'selected-community-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'active',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for cross-community magic_links filtering
      await ctx.db.insert('magic_links', {
        token: 'other-managed-community-link',
        createdBy: userId,
        organizerId: otherOrgId,
        status: 'active',
      });
    });

    const result = await asCommunityAdmin.query(
      api.communities.invite_links.listMyLinks,
      {organizerId: orgId},
    );

    expect(result).toHaveLength(1);
    expect(result[0].tokenPrefix).toBe('selected');
  });

  it("hides the caller's links after their community admin access is revoked", async () => {
    const t = convexTest();
    const {userId, orgId, asCommunityAdmin} = await setupCommunityAdmin(t);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for legacy active link left behind after role revocation
      await ctx.db.insert('magic_links', {
        token: 'revoked-admin-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'active',
      });
      await authz.revokeRole(
        ctx,
        authzUserId(userId),
        'community_admin',
        {type: 'organizer', id: orgId as string},
        authzUserId(userId),
      );
    });

    const result = await asCommunityAdmin.query(
      api.communities.invite_links.listMyLinks,
      {organizerId: orgId},
    );
    expect(result).toEqual([]);
  });

  it('excludes soft-deleted links', async () => {
    const t = convexTest();
    const {userId, orgId, asCommunityAdmin} = await setupCommunityAdmin(t);

    await t.run(async (ctx) => {
      // Visible link
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_links', {
        token: 'visible-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'active',
      });
      // Soft-deleted link
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_links', {
        token: 'deleted-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'disabled',
        deletedAt: Date.now(),
      });
    });

    const result = await asCommunityAdmin.query(
      api.communities.invite_links.listMyLinks,
      {organizerId: orgId},
    );
    expect(result).toHaveLength(1);
    expect(result[0].tokenPrefix).toBe('visible-');
  });

  it('returns accurate redemptionCount', async () => {
    const t = convexTest();
    const {userId, orgId, asCommunityAdmin} = await setupCommunityAdmin(t);

    const linkId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      ctx.db.insert('magic_links', {
        token: 'counted-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'active',
      }),
    );

    // Add 3 redemptions
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
        const redeemer = await ctx.db.insert('users', {
          email: `r${i}@test.com`,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_link_redemption_log state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
        await ctx.db.insert('magic_link_redemption_log', {
          magicLinkId: linkId,
          userId: redeemer,
          redeemedAt: Date.now() + i * 1000,
        });
      }
    });

    const result = await asCommunityAdmin.query(
      api.communities.invite_links.listMyLinks,
      {organizerId: orgId},
    );
    expect(result).toHaveLength(1);
    expect(result[0].redemptionCount).toBe(3);
  });

  it('lastUsedAt is the most recent redemption timestamp', async () => {
    const t = convexTest();
    const {userId, orgId, asCommunityAdmin} = await setupCommunityAdmin(t);

    const linkId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      ctx.db.insert('magic_links', {
        token: 'last-used-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'active',
      }),
    );

    const timestamps = [1000, 3000, 2000];
    await t.run(async (ctx) => {
      for (const ts of timestamps) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup user creation; to be replaced with createUserDirectly composite
        const redeemer = await ctx.db.insert('users', {
          email: `r${ts}@test.com`,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_link_redemption_log state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
        await ctx.db.insert('magic_link_redemption_log', {
          magicLinkId: linkId,
          userId: redeemer,
          redeemedAt: ts,
        });
      }
    });

    const result = await asCommunityAdmin.query(
      api.communities.invite_links.listMyLinks,
      {organizerId: orgId},
    );
    expect(result).toHaveLength(1);
    expect(result[0].lastUsedAt).toBe(3000);
  });

  it('lastUsedAt is undefined when no redemptions', async () => {
    const t = convexTest();
    const {userId, orgId, asCommunityAdmin} = await setupCommunityAdmin(t);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_links', {
        token: 'unused-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'active',
      });
    });

    const result = await asCommunityAdmin.query(
      api.communities.invite_links.listMyLinks,
      {organizerId: orgId},
    );
    expect(result).toHaveLength(1);
    expect(result[0].redemptionCount).toBe(0);
    expect(result[0].lastUsedAt).toBeUndefined();
  });

  it('does not expose a reconstructable URL in list results', async () => {
    const t = convexTest();
    const {userId, orgId, asCommunityAdmin} = await setupCommunityAdmin(t);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_links', {
        token: 'url-test-token',
        createdBy: userId,
        organizerId: orgId,
        status: 'active',
      });
    });

    const result = await asCommunityAdmin.query(
      api.communities.invite_links.listMyLinks,
      {organizerId: orgId},
    );
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('url');
  });

  it('returns links of all statuses (active, paused, disabled)', async () => {
    const t = convexTest();
    const {userId, orgId, asCommunityAdmin} = await setupCommunityAdmin(t);

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_links', {
        token: 'active-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'active',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_links', {
        token: 'paused-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'paused',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_links', {
        token: 'disabled-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'disabled',
      });
    });

    const result = await asCommunityAdmin.query(
      api.communities.invite_links.listMyLinks,
      {organizerId: orgId},
    );
    expect(result).toHaveLength(3);

    const statuses = result.map((r: {status: string}) => r.status).sort();
    expect(statuses).toEqual(['active', 'disabled', 'paused']);
  });

  it('includes label, expiresAt, and maxRedemptions when set', async () => {
    const t = convexTest();
    const {userId, orgId, asCommunityAdmin} = await setupCommunityAdmin(t);

    const futureDate = Date.now() + 3_600_000;
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links state that seedMagicLink/seedMagicLinkRedemption composite covers; eslint-disable added during bulk refactor
      await ctx.db.insert('magic_links', {
        token: 'full-link',
        createdBy: userId,
        organizerId: orgId,
        status: 'active',
        label: 'My Party Link',
        expiresAt: futureDate,
        maxRedemptions: 50,
      });
    });

    const result = await asCommunityAdmin.query(
      api.communities.invite_links.listMyLinks,
      {organizerId: orgId},
    );
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('My Party Link');
    expect(result[0].expiresAt).toBe(futureDate);
    expect(result[0].maxRedemptions).toBe(50);
  });
});

describe('listPastMyLinks', () => {
  async function setupAdmin(t: ReturnType<typeof convexTest>) {
    const orgId = await seedOrganizerHelper(t);
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Past Links Admin',
      email: `past-admin-${crypto.randomUUID()}@test.com`,
    })) as Id<'users'>;
    await assignCommunityAdmin(t, userId, orgId);
    const asAdmin = t.withIdentity({subject: userId});
    return {userId, orgId, asAdmin};
  }

  it('returns empty array for unauthenticated user', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizerHelper(t, 'Unauthed Past Links Org');
    const result = await t.query(api.communities.invite_links.listPastMyLinks, {
      organizerId,
    });
    expect(result).toEqual([]);
  });

  it('returns only soft-deleted links for the caller', async () => {
    const t = convexTest();
    const {userId, orgId, asAdmin} = await setupAdmin(t);

    const {linkId} = await seedMagicLinkHelper(t, {
      createdBy: userId,
      organizerId: orgId,
      label: 'Archived Link',
    });

    await asAdmin.mutation(api.communities.invite_links.updateStatus, {
      linkId,
      action: 'delete',
    });

    const result = await asAdmin.query(
      api.communities.invite_links.listPastMyLinks,
      {organizerId: orgId},
    );
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Archived Link');
  });

  it('excludes non-deleted (active) links', async () => {
    const t = convexTest();
    const {userId, orgId, asAdmin} = await setupAdmin(t);

    await seedMagicLinkHelper(t, {createdBy: userId, organizerId: orgId});

    const result = await asAdmin.query(
      api.communities.invite_links.listPastMyLinks,
      {organizerId: orgId},
    );
    expect(result).toEqual([]);
  });

  it('excludes other creators soft-deleted links', async () => {
    const t = convexTest();
    const {orgId, asAdmin} = await setupAdmin(t);

    const otherUserId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Other Admin',
        email: `other-${crypto.randomUUID()}@test.com`,
      },
    )) as Id<'users'>;
    const otherOrgId = await seedOrganizerHelper(t);
    await assignCommunityAdmin(t, otherUserId, otherOrgId);
    const asOther = t.withIdentity({subject: otherUserId});

    const {linkId: otherLinkId} = await seedMagicLinkHelper(t, {
      createdBy: otherUserId,
      organizerId: otherOrgId,
    });
    await asOther.mutation(api.communities.invite_links.updateStatus, {
      linkId: otherLinkId,
      action: 'delete',
    });

    const result = await asAdmin.query(
      api.communities.invite_links.listPastMyLinks,
      {organizerId: orgId},
    );
    expect(result).toEqual([]);
  });

  it('computes redemptionCount and lastUsedAt for past links', async () => {
    const t = convexTest();
    const {userId, orgId, asAdmin} = await setupAdmin(t);

    const {linkId} = await seedMagicLinkHelper(t, {
      createdBy: userId,
      organizerId: orgId,
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for redemption log; composite seedMagicLinkRedemption covers production path
      const redeemer = await ctx.db.insert('users', {
        email: `r-${crypto.randomUUID()}@test.com`,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_link_redemption_log state
      await ctx.db.insert('magic_link_redemption_log', {
        magicLinkId: linkId,
        userId: redeemer,
        redeemedAt: 5000,
      });
    });

    await asAdmin.mutation(api.communities.invite_links.updateStatus, {
      linkId,
      action: 'delete',
    });

    const result = await asAdmin.query(
      api.communities.invite_links.listPastMyLinks,
      {organizerId: orgId},
    );
    expect(result).toHaveLength(1);
    expect(result[0].redemptionCount).toBe(1);
    expect(result[0].lastUsedAt).toBe(5000);
  });

  it('deletedAt is present and positive on past links', async () => {
    const t = convexTest();
    const {userId, orgId, asAdmin} = await setupAdmin(t);

    const {linkId} = await seedMagicLinkHelper(t, {
      createdBy: userId,
      organizerId: orgId,
    });

    await asAdmin.mutation(api.communities.invite_links.updateStatus, {
      linkId,
      action: 'delete',
    });

    const result = await asAdmin.query(
      api.communities.invite_links.listPastMyLinks,
      {organizerId: orgId},
    );
    expect(result).toHaveLength(1);
    expect(typeof result[0].deletedAt).toBe('number');
    expect(result[0].deletedAt).toBeGreaterThan(0);
  });
});
