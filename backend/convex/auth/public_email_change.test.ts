import {describe, it, expect, vi, afterEach} from 'vitest';
import {APIError} from 'better-auth/api';
import {convexTest} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {authComponent} from '../lib/better_auth';

describe('Email Change (Better Auth)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a CHANGE_EMAIL_DISABLED APIError from changeEmail by machine code', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Requester',
      email: 'requester@example.com',
    })) as Id<'users'>;

    // Force Better Auth's changeEmail to throw the real machine-coded APIError.
    const changeEmailMock = vi.fn().mockRejectedValue(
      // Mirrors better-auth's APIError.from("BAD_REQUEST",
      // BASE_ERROR_CODES.CHANGE_EMAIL_DISABLED) with a rewritten message to
      // prove detection no longer depends on message wording.
      APIError.from('BAD_REQUEST', {
        code: 'CHANGE_EMAIL_DISABLED',
        message: 'totally different wording that no substring would match',
      }),
    );
    vi.spyOn(authComponent, 'getAuth').mockResolvedValue({
      auth: {api: {changeEmail: changeEmailMock}} as never,
      headers: new Headers(),
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: 'requester@example.com',
      name: 'Requester',
    });

    const result = await asUser.mutation(api.auth.public.requestEmailChange, {
      newEmail: 'fresh@example.com',
      callbackURL: 'http://localhost:4200/confirm/email-change',
    });

    expect(changeEmailMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Email change is currently unavailable');

    // pendingEmail must be rolled back and the failure audited.
    const appUser = await t.run(async (ctx) => await ctx.db.get(userId));
    expect(appUser?.pendingEmail).toBeUndefined();

    const actions = await t.run(async (ctx) => {
      const logs = await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', userId))
        .collect();
      return logs.map((log) => log.action);
    });
    expect(actions).toContain('account.email_change.failed');
    expect(actions).not.toContain('account.email_change.verification_queued');
  });

  it('syncs app user email on Better Auth user onUpdate trigger', async () => {
    const t = convexTest();

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: pendingEmail + emailChangeToken fields not settable via createUserDirectly
    const userId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      return await ctx.db.insert('users', {
        name: 'Trigger User',
        email: 'old-email@example.com',
        pendingEmail: 'new-email@example.com',
        emailChangeToken: 'legacy-token',
        emailChangeTokenExpiry: Date.now() + 10000,
      });
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.lib.better_auth.onUpdate, {
        model: 'user',
        oldDoc: {
          _id: 'better-auth-user-id',
          _creationTime: Date.now() - 1000,
          email: 'old-email@example.com',
          emailVerified: false,
        },
        newDoc: {
          _id: 'better-auth-user-id',
          _creationTime: Date.now(),
          email: 'new-email@example.com',
          emailVerified: true,
        },
      } as never);
    });

    const updatedUser = await t.run(async (ctx) => await ctx.db.get(userId));
    expect(updatedUser?.email).toBe('new-email@example.com');
    expect(updatedUser?.pendingEmail).toBeUndefined();
    expect(updatedUser?.emailChangeToken).toBeUndefined();
    expect(updatedUser?.emailChangeTokenExpiry).toBeUndefined();
    expect(updatedUser?.authEmailVerified).toBe(true);
    expect(updatedUser?.betterAuthUserId).toBe('better-auth-user-id');
    expect(updatedUser?.emailVerificationTime).toBeTypeOf('number');

    const latestAudit = await t.run(async (ctx) => {
      return await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', userId))
        .order('desc')
        .first();
    });

    expect(latestAudit?.action).toBe('account.email_change.completed');
    expect(latestAudit?.source).toBe('better_auth_trigger');
  });

  it('logs request + verification_queued on successful change request', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Requester',
      email: 'requester@example.com',
    })) as Id<'users'>;

    const asUser = t.withIdentity({
      subject: userId,
      email: 'requester@example.com',
      name: 'Requester',
    });

    await asUser.mutation(api.auth.public.requestEmailChange, {
      newEmail: 'fresh@example.com',
      callbackURL: 'http://localhost:4200/confirm/email-change',
    });

    const appUser = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });
    expect(appUser?.pendingEmail).toBe('fresh@example.com');

    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', userId))
        .order('desc')
        .collect();
    });

    const actions = logs.map((log) => log.action);
    expect(actions).toContain('account.email_change.requested');
    expect(actions).toContain('account.email_change.verification_queued');
  });

  it('allows canceling a pending change and requesting a replacement immediately', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Retry Requester',
      email: 'retry-requester@example.com',
    })) as Id<'users'>;

    const asUser = t.withIdentity({
      subject: userId,
      email: 'retry-requester@example.com',
      name: 'Retry Requester',
    });

    const first = await asUser.mutation(api.auth.public.requestEmailChange, {
      newEmail: 'first-retry@example.com',
      callbackURL: 'http://localhost:4200/confirm/email-change',
    });
    expect(first.success).toBe(true);

    await asUser.mutation(api.auth.public.cancelEmailChange, {});

    const afterCancel = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });
    expect(afterCancel?.pendingEmail).toBeUndefined();

    const second = await asUser.mutation(api.auth.public.requestEmailChange, {
      newEmail: 'second-retry@example.com',
      callbackURL: 'http://localhost:4200/confirm/email-change',
    });
    expect(second.success).toBe(true);

    const afterSecondRequest = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });
    expect(afterSecondRequest?.pendingEmail).toBe('second-retry@example.com');
  });

  it('does not apply Better Auth email update after pending change is cancelled', async () => {
    const t = convexTest();

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: pendingEmail + emailChangeToken fields not settable via createUserDirectly
    const userId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      return await ctx.db.insert('users', {
        name: 'Cancelled Trigger User',
        email: 'old-email@example.com',
        pendingEmail: 'new-email@example.com',
        emailChangeToken: 'legacy-token',
        emailChangeTokenExpiry: Date.now() + 10000,
      });
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: 'old-email@example.com',
      name: 'Cancelled Trigger User',
    });

    await asUser.mutation(api.auth.public.cancelEmailChange, {});

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.lib.better_auth.onUpdate, {
        model: 'user',
        oldDoc: {
          _id: 'better-auth-user-id',
          _creationTime: Date.now() - 1000,
          email: 'old-email@example.com',
          emailVerified: false,
        },
        newDoc: {
          _id: 'better-auth-user-id',
          _creationTime: Date.now(),
          email: 'new-email@example.com',
          emailVerified: true,
        },
      } as never);
    });

    const updatedUser = await t.run(async (ctx) => await ctx.db.get(userId));
    expect(updatedUser?.email).toBe('old-email@example.com');
    expect(updatedUser?.pendingEmail).toBeUndefined();
    expect(updatedUser?.emailChangeToken).toBe('legacy-token');
    expect(updatedUser?.emailChangeTokenExpiry).toBeTypeOf('number');
    expect(updatedUser?.betterAuthUserId).toBeUndefined();
    expect(updatedUser?.emailVerificationTime).toBeUndefined();

    const latestAudit = await t.run(async (ctx) => {
      return await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', userId))
        .order('desc')
        .first();
    });

    expect(latestAudit?.action).toBe('account.email_change.cancelled');
  });

  it('still syncs safe profile fields when rejecting a stale verified email update', async () => {
    const t = convexTest();

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: pendingEmail + emailChangeToken fields not settable via createUserDirectly
    const userId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      return await ctx.db.insert('users', {
        name: '',
        image: 'https://example.com/old.png',
        email: 'old-email@example.com',
        pendingEmail: 'new-email@example.com',
        emailChangeToken: 'legacy-token',
        emailChangeTokenExpiry: Date.now() + 10000,
      });
    });

    const asUser = t.withIdentity({
      subject: userId,
      email: 'old-email@example.com',
      name: 'Profile Sync User',
    });

    await asUser.mutation(api.auth.public.cancelEmailChange, {});

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.lib.better_auth.onUpdate, {
        model: 'user',
        oldDoc: {
          _id: 'better-auth-user-id',
          _creationTime: Date.now() - 1000,
          email: 'old-email@example.com',
          emailVerified: false,
          name: '',
          image: 'https://example.com/old.png',
        },
        newDoc: {
          _id: 'better-auth-user-id',
          _creationTime: Date.now(),
          email: 'new-email@example.com',
          emailVerified: true,
          name: '<b>Profile Sync User</b>',
          image: 'https://example.com/new.png',
        },
      } as never);
    });

    const updatedUser = await t.run(async (ctx) => await ctx.db.get(userId));
    expect(updatedUser?.email).toBe('old-email@example.com');
    expect(updatedUser?.name).toBe('Profile Sync User');
    expect(updatedUser?.image).toBe('https://example.com/new.png');
    expect(updatedUser?.pendingEmail).toBeUndefined();
    expect(updatedUser?.emailChangeToken).toBe('legacy-token');
    expect(updatedUser?.emailChangeTokenExpiry).toBeTypeOf('number');
    expect(updatedUser?.betterAuthUserId).toBeUndefined();
    expect(updatedUser?.emailVerificationTime).toBeUndefined();
  });

  it('does not apply Better Auth email update before the new email is verified', async () => {
    const t = convexTest();

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: pendingEmail + emailChangeToken fields not settable via createUserDirectly
    const userId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      return await ctx.db.insert('users', {
        name: 'Unverified Trigger User',
        email: 'old-email@example.com',
        pendingEmail: 'new-email@example.com',
        emailChangeToken: 'legacy-token',
        emailChangeTokenExpiry: Date.now() + 10000,
      });
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.lib.better_auth.onUpdate, {
        model: 'user',
        oldDoc: {
          _id: 'better-auth-user-id',
          _creationTime: Date.now() - 1000,
          email: 'old-email@example.com',
          emailVerified: false,
        },
        newDoc: {
          _id: 'better-auth-user-id',
          _creationTime: Date.now(),
          email: 'new-email@example.com',
          emailVerified: false,
        },
      } as never);
    });

    const updatedUser = await t.run(async (ctx) => await ctx.db.get(userId));
    expect(updatedUser?.email).toBe('old-email@example.com');
    expect(updatedUser?.pendingEmail).toBe('new-email@example.com');
    expect(updatedUser?.emailChangeToken).toBe('legacy-token');
    expect(updatedUser?.emailChangeTokenExpiry).toBeTypeOf('number');
    expect(updatedUser?.authEmailVerified).toBeUndefined();
    expect(updatedUser?.betterAuthUserId).toBeUndefined();
    expect(updatedUser?.emailVerificationTime).toBeUndefined();
  });

  it('logs failed action when change request fails', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Requester',
      email: 'requester@example.com',
    })) as Id<'users'>;

    const asUser = t.withIdentity({
      subject: userId,
      email: 'requester@example.com',
      name: 'Requester',
    });

    const result = await asUser.mutation(api.auth.public.requestEmailChange, {
      newEmail: 'taken@example.com',
      callbackURL: 'http://localhost:4200/confirm/email-change',
    });
    expect(result.success).toBe(false);
    expect(result.message).toBe('Email address already in use');

    const appUser = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });
    expect(appUser?.pendingEmail).toBeUndefined();

    const logs = await t.run(async (ctx) => {
      return await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', userId))
        .order('desc')
        .collect();
    });

    const actions = logs.map((log) => log.action);
    expect(actions).toContain('account.email_change.requested');
    expect(actions).toContain('account.email_change.failed');
    expect(actions).not.toContain('account.email_change.verification_queued');
  });

  it('rejects duplicate target email case-insensitively before calling Better Auth', async () => {
    const t = convexTest();

    const requesterId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Requester',
        email: 'requester@example.com',
      },
    )) as Id<'users'>;

    await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Existing',
      email: 'Taken@Example.com',
    });

    const asUser = t.withIdentity({
      subject: requesterId,
      email: 'requester@example.com',
      name: 'Requester',
    });

    const result = await asUser.mutation(api.auth.public.requestEmailChange, {
      newEmail: 'taken@example.com',
      callbackURL: 'http://localhost:4200/confirm/email-change',
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Email address already in use');
  });

  it('blocks trigger sync when old email matches multiple app users', async () => {
    const t = convexTest();

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally invalid state: duplicate emails to test collision handling; createUserDirectly deduplicates by email
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      await ctx.db.insert('users', {
        name: 'Dup A',
        email: 'dup-old@example.com',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      await ctx.db.insert('users', {
        name: 'Dup B',
        email: 'dup-old@example.com',
      });
    });

    await expect(
      t.run(async (ctx) => {
        await ctx.runMutation(internal.lib.better_auth.onUpdate, {
          model: 'user',
          oldDoc: {
            _id: 'better-auth-user-id',
            _creationTime: Date.now() - 1000,
            email: 'dup-old@example.com',
            emailVerified: false,
          },
          newDoc: {
            _id: 'better-auth-user-id',
            _creationTime: Date.now(),
            email: 'dup-new@example.com',
            emailVerified: true,
          },
        } as never);
      }),
      // After the auth-helper SSOT consolidation, the collision error comes from
      // lookupUserByNormalizedEmailOrThrow, which intentionally omits the email
      // (PII) from the client-visible message. Match on the canonical phrasing.
    ).rejects.toThrow(/multiple app users share an email/i);
  });
});
