import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {APIError} from 'better-auth/api';
import {ConvexError} from 'convex/values';

const adapterFindManyMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/better_auth_adapter', async () => {
  const actual = await vi.importActual<
    typeof import('../lib/better_auth_adapter')
  >('../lib/better_auth_adapter');

  return {
    ...actual,
    adapterFindMany: adapterFindManyMock,
  };
});

import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {authComponent} from '../lib/better_auth';
import {convexTest} from '../setup.testing';

type BetterAuthUser = NonNullable<
  Awaited<ReturnType<typeof authComponent.safeGetAuthUser>>
>;

/**
 * convex-test serializes a thrown `ConvexError`'s structured `data` to a JSON
 * string across the mutation boundary (the real Convex client deserializes it
 * back to an object for the frontend). Normalize both shapes for assertions.
 */
function parseAppErrorData(error: unknown): {code: string; message: string} {
  const raw: unknown = (error as {data?: unknown}).data;
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as {code?: unknown}).code !== 'string' ||
    typeof (parsed as {message?: unknown}).message !== 'string'
  ) {
    throw new Error(
      `Unexpected ConvexError data shape: ${JSON.stringify(raw)}`,
    );
  }
  return parsed as {code: string; message: string};
}

describe('social auth public flows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    adapterFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AUTH_BASE_URL;
    delete process.env.SITE_URL;
  });

  it('maps a last-account unlink APIError by machine code', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'linked@example.com',
      name: 'Linked User',
      betterAuthUserId: 'ba-user-linked',
      authEmailVerified: true,
    })) as Id<'users'>;

    const unlinkAccountMock = vi.fn().mockRejectedValue(
      // Real code from better-auth account.mjs unlink-account; message rewritten
      // to prove routing is by code, not substring.
      APIError.from('BAD_REQUEST', {
        code: 'FAILED_TO_UNLINK_LAST_ACCOUNT',
        message: 'wording that would not match any legacy substring',
      }),
    );
    vi.spyOn(authComponent, 'getAuth').mockResolvedValue({
      auth: {api: {unlinkAccount: unlinkAccountMock}} as never,
      headers: new Headers(),
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: 'linked@example.com',
      name: 'Linked User',
    });

    let caught: unknown;
    try {
      await asUser.mutation(api.auth.public.unlinkSocialAccount, {
        provider: 'google',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConvexError);
    const data = parseAppErrorData(caught);
    expect(data.code).toBe('AUTH_UNLINK_ACCOUNT_FAILED');
    expect(data.message).toBe('Cannot remove the last login method.');
  });

  it('maps an already-linked link APIError by machine code', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'linked@example.com',
      name: 'Linked User',
      betterAuthUserId: 'ba-user-linked',
      authEmailVerified: true,
    })) as Id<'users'>;

    const linkSocialAccountMock = vi.fn().mockRejectedValue(
      APIError.from('BAD_REQUEST', {
        code: 'SOCIAL_ACCOUNT_ALREADY_LINKED',
        message: 'rewritten message with no matching substring',
      }),
    );
    vi.spyOn(authComponent, 'getAuth').mockResolvedValue({
      auth: {api: {linkSocialAccount: linkSocialAccountMock}} as never,
      headers: new Headers(),
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: 'linked@example.com',
      name: 'Linked User',
    });

    let caught: unknown;
    try {
      await asUser.mutation(api.auth.public.linkSocialAccount, {
        provider: 'google',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConvexError);
    const data = parseAppErrorData(caught);
    expect(data.code).toBe('AUTH_LINK_ACCOUNT_FAILED');
    expect(data.message).toBe(
      'This provider cannot be connected to this account right now.',
    );
  });

  it('does not rewrite emailVerificationTime during normal verified sign-in sync', async () => {
    const t = convexTest();
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- emailVerificationTime not settable via createUserDirectly; needed to test sync preserves existing value
    const userId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      ctx.db.insert('users', {
        email: 'linked@example.com',
        name: 'Linked User',
        betterAuthUserId: 'ba-user-linked',
        authEmailVerified: true,
        emailVerificationTime: 12345,
      }),
    );

    vi.spyOn(authComponent, 'safeGetAuthUser').mockResolvedValue({
      _id: 'ba-user-linked' as BetterAuthUser['_id'],
      _creationTime: 1,
      email: 'linked@example.com',
      emailVerified: true,
      name: 'Linked User',
      image: null,
      createdAt: 1,
      updatedAt: 1,
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: 'linked@example.com',
      name: 'Linked User',
    });

    const result = await asUser.mutation(api.auth.public.syncCurrentUser, {});
    expect(result).toEqual({
      status: 'synced',
      requiresSocialSignupCompletion: false,
    });

    await t.run(async (ctx) => {
      const user = await ctx.db.get(userId);
      expect(user?.authEmailVerified).toBe(true);
      expect(user?.emailVerificationTime).toBe(12345);
    });
  });

  it('returns cleared onboarding state after a credential account is added', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'linked@example.com',
      name: 'Linked User',
      betterAuthUserId: 'ba-user-linked',
      authEmailVerified: true,
      socialSignupCompletionRequired: true,
    })) as Id<'users'>;

    vi.spyOn(authComponent, 'safeGetAuthUser').mockResolvedValue({
      _id: 'ba-user-linked' as BetterAuthUser['_id'],
      _creationTime: 1,
      email: 'linked@example.com',
      emailVerified: true,
      name: 'Linked User',
      image: null,
      createdAt: 1,
      updatedAt: 1,
    });

    adapterFindManyMock.mockResolvedValueOnce([
      {providerId: 'credential', userId: 'ba-user-linked'},
      {providerId: 'google', userId: 'ba-user-linked'},
    ]);

    const asUser = t.withIdentity({
      subject: userId,
      email: 'linked@example.com',
      name: 'Linked User',
    });

    const result = await asUser.mutation(api.auth.public.syncCurrentUser, {});
    expect(result).toEqual({
      status: 'synced',
      requiresSocialSignupCompletion: false,
    });

    await t.run(async (ctx) => {
      const user = await ctx.db.get(userId);
      expect(user?.socialSignupCompletionRequired).toBe(false);
    });
  });

  it('flags newly created social users for onboarding completion', async () => {
    const t = convexTest();

    vi.spyOn(authComponent, 'safeGetAuthUser').mockResolvedValue({
      _id: 'ba-user-fresh' as BetterAuthUser['_id'],
      _creationTime: 1,
      email: 'fresh@example.com',
      emailVerified: true,
      name: 'Fresh User',
      image: null,
      createdAt: 1,
      updatedAt: 1,
    });

    const asUser = t.withIdentity({
      subject: 'ephemeral-user',
      email: 'fresh@example.com',
      name: 'Fresh User',
    });

    const result = await asUser.mutation(api.auth.public.syncCurrentUser, {});
    expect(result).toEqual({
      status: 'synced',
      requiresSocialSignupCompletion: true,
    });
  });

  it('syncs a verified Better Auth user through the user onCreate trigger', async () => {
    const t = convexTest();

    adapterFindManyMock.mockResolvedValueOnce([
      {providerId: 'google', userId: 'ba-user-triggered'},
    ]);

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.lib.better_auth.onCreate, {
        model: 'user',
        doc: {
          _id: 'ba-user-triggered',
          _creationTime: Date.now(),
          email: 'triggered@example.com',
          emailVerified: true,
          name: 'Triggered User',
          image: 'https://example.com/triggered.png',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      } as never);
    });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_betterAuthUserId', (q) =>
          q.eq('betterAuthUserId', 'ba-user-triggered'),
        )
        .unique();

      expect(user).toBeDefined();
      expect(user?.email).toBe('triggered@example.com');
      expect(user?.name).toBe('Triggered User');
      expect(user?.image).toBe('https://example.com/triggered.png');
      expect(user?.authEmailVerified).toBe(true);
      expect(user?.socialSignupCompletionRequired).toBe(true);
    });
  });

  it('syncs an existing Better Auth user when email verification completes', async () => {
    const t = convexTest();

    adapterFindManyMock.mockResolvedValueOnce([
      {providerId: 'google', userId: 'ba-user-verified-later'},
    ]);

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.lib.better_auth.onUpdate, {
        model: 'user',
        oldDoc: {
          _id: 'ba-user-verified-later',
          _creationTime: Date.now() - 1_000,
          email: 'verified-later@example.com',
          emailVerified: false,
          name: 'Verified Later',
          image: null,
          createdAt: Date.now() - 1_000,
          updatedAt: Date.now() - 1_000,
        },
        newDoc: {
          _id: 'ba-user-verified-later',
          _creationTime: Date.now() - 1_000,
          email: 'verified-later@example.com',
          emailVerified: true,
          name: 'Verified Later',
          image: null,
          createdAt: Date.now() - 1_000,
          updatedAt: Date.now(),
        },
      } as never);
    });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_betterAuthUserId', (q) =>
          q.eq('betterAuthUserId', 'ba-user-verified-later'),
        )
        .unique();

      expect(user).toBeDefined();
      expect(user?.email).toBe('verified-later@example.com');
      expect(user?.authEmailVerified).toBe(true);
      expect(user?.socialSignupCompletionRequired).toBe(true);
      expect(user?.emailVerificationTime).toBeTypeOf('number');
    });
  });

  it('syncs a verified Better Auth user through the session onCreate trigger', async () => {
    const t = convexTest();

    adapterFindManyMock.mockImplementation(async (_ctx, args) => {
      if (args.model === 'user') {
        return [
          {
            _id: 'ba-user-session',
            email: 'session@example.com',
            emailVerified: true,
            name: 'Session User',
            image: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ];
      }

      if (args.model === 'account') {
        return [{providerId: 'credential', userId: 'ba-user-session'}];
      }

      return [];
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.lib.better_auth.onCreate, {
        model: 'session',
        doc: {
          _id: 'session-doc-id',
          _creationTime: Date.now(),
          userId: 'ba-user-session',
          token: 'session-token',
          expiresAt: Date.now() + 60_000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      } as never);
    });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_betterAuthUserId', (q) =>
          q.eq('betterAuthUserId', 'ba-user-session'),
        )
        .unique();

      expect(user).toBeDefined();
      expect(user?.email).toBe('session@example.com');
      expect(user?.authEmailVerified).toBe(true);
      expect(user?.socialSignupCompletionRequired).toBe(false);
    });
  });

  it('clears social signup completion once a credential account exists', async () => {
    const t = convexTest();

    await t.mutation(api.testing.users.createUserDirectly, {
      email: 'social@example.com',
      name: 'Social User',
      betterAuthUserId: 'ba-user-social',
      authEmailVerified: true,
      socialSignupCompletionRequired: true,
    });

    adapterFindManyMock.mockImplementation(async (_ctx, args) => {
      if (args.model === 'user') {
        return [
          {
            _id: 'ba-user-social',
            email: 'social@example.com',
            emailVerified: true,
            name: 'Social User',
            image: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ];
      }

      if (args.model === 'account') {
        return [
          {providerId: 'credential', userId: 'ba-user-social'},
          {providerId: 'google', userId: 'ba-user-social'},
        ];
      }

      return [];
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.lib.better_auth.onCreate, {
        model: 'account',
        doc: {
          _id: 'credential-account-id',
          _creationTime: Date.now(),
          accountId: 'credential-account-id',
          providerId: 'credential',
          userId: 'ba-user-social',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      } as never);
    });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_betterAuthUserId', (q) =>
          q.eq('betterAuthUserId', 'ba-user-social'),
        )
        .unique();

      expect(user?.socialSignupCompletionRequired).toBe(false);
    });
  });

  it('keeps requiring onboarding completion for existing social-only users', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'fresh@example.com',
      name: 'Fresh User',
      betterAuthUserId: 'ba-user-fresh',
      authEmailVerified: true,
      socialSignupCompletionRequired: true,
    })) as Id<'users'>;

    vi.spyOn(authComponent, 'safeGetAuthUser').mockResolvedValue({
      _id: 'ba-user-fresh' as BetterAuthUser['_id'],
      _creationTime: 1,
      email: 'fresh@example.com',
      emailVerified: true,
      name: 'Fresh User',
      image: null,
      createdAt: 1,
      updatedAt: 1,
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: 'fresh@example.com',
      name: 'Fresh User',
    });

    const result = await asUser.mutation(api.auth.public.syncCurrentUser, {});
    expect(result).toEqual({
      status: 'synced',
      requiresSocialSignupCompletion: true,
    });
  });

  it('preserves a local absolute callbackURL for social account linking', async () => {
    process.env.AUTH_BASE_URL = 'http://127.0.0.1:3210';
    process.env.SITE_URL = 'https://community.braket.gay';

    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'linked@example.com',
      name: 'Linked User',
      betterAuthUserId: 'ba-user-linked',
      authEmailVerified: true,
    })) as Id<'users'>;

    const linkSocialAccountMock = vi.fn().mockResolvedValue({
      url: 'https://oauth.example/redirect',
    });
    vi.spyOn(authComponent, 'getAuth').mockResolvedValue({
      auth: {
        api: {
          linkSocialAccount: linkSocialAccountMock,
        },
      } as never,
      headers: new Headers(),
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: 'linked@example.com',
      name: 'Linked User',
    });

    const result = await asUser.mutation(api.auth.public.linkSocialAccount, {
      provider: 'google',
      callbackURL:
        'http://127.0.0.1:4202/confirm/social-link?returnUrl=%2Faccount',
    });

    expect(result).toEqual({url: 'https://oauth.example/redirect'});
    expect(linkSocialAccountMock).toHaveBeenCalledWith({
      body: {
        provider: 'google',
        callbackURL:
          'http://127.0.0.1:4202/confirm/social-link?returnUrl=%2Faccount&provider=google',
        errorCallbackURL:
          'http://127.0.0.1:4202/confirm/social-link?returnUrl=%2Faccount&provider=google',
      },
      headers: new Headers(),
    });
  });

  it('records provider-link audit logs from the Better Auth account trigger', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'linked@example.com',
      name: 'Linked User',
      betterAuthUserId: 'ba-user-linked',
      authEmailVerified: true,
    })) as Id<'users'>;

    adapterFindManyMock.mockImplementation(async (_ctx, args) => {
      if (args.model === 'user') {
        return [
          {
            _id: 'ba-user-linked',
            email: 'linked@example.com',
            emailVerified: true,
            name: 'Linked User',
            image: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ];
      }

      if (args.model === 'account') {
        return [
          {providerId: 'credential', userId: 'ba-user-linked'},
          {providerId: 'google', userId: 'ba-user-linked'},
        ];
      }

      return [];
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.lib.better_auth.onCreate, {
        model: 'account',
        doc: {
          _id: 'account-doc-id',
          _creationTime: Date.now(),
          accountId: 'google-account-id',
          providerId: 'google',
          userId: 'ba-user-linked',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      } as never);
    });

    const latestAudit = await t.run(async (ctx) => {
      return await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', userId))
        .order('desc')
        .first();
    });

    expect(latestAudit?.action).toBe('account.provider.linked');
    expect(latestAudit?.source).toBe('better_auth_account_trigger');
    expect(latestAudit?.reason).toBe('google');
  });

  it('persists terms acceptance for social signup completion', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'linked@example.com',
      name: 'Linked User',
      betterAuthUserId: 'ba-user-linked',
      authEmailVerified: true,
    })) as Id<'users'>;

    const asUser = t.withIdentity({
      subject: userId,
      email: 'linked@example.com',
      name: 'Linked User',
    });

    await asUser.mutation(api.auth.public.completeSocialSignupOnboarding, {});

    await t.run(async (ctx) => {
      const user = await ctx.db.get(userId);
      expect(user?.termsAcceptedAt).toBeTypeOf('number');
      expect(user?.socialSignupCompletionRequired).toBe(false);

      const latestAudit = await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', userId))
        .order('desc')
        .first();

      expect(latestAudit?.action).toBe('auth.social_signup.completed');
      expect(latestAudit?.source).toBe('social_signup_completion');
    });
  });
});
