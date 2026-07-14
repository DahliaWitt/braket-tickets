import {afterEach, describe, expect, it, vi} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {authComponent} from '../lib/better_auth';
import {convexTest} from '../setup.testing';

describe('password change rollout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the legacy mutation addressable but fails closed for stale clients', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Legacy Password User',
      email: 'legacy-password@example.com',
    })) as Id<'users'>;
    const changePassword = vi.fn().mockResolvedValue({status: true});
    vi.spyOn(authComponent, 'getAuth').mockResolvedValue({
      auth: {api: {changePassword}} as never,
      headers: new Headers(),
    });

    await expect(
      t
        .withIdentity({subject: userId})
        .mutation(api.auth.public.changePassword, {
          currentPassword: 'old-password-123',
          newPassword: 'new-password-456',
        }),
    ).rejects.toThrow('Refresh this page before changing your password');
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('changes a password through the V2 action with the same Better Auth semantics', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Action Password User',
      email: 'action-password@example.com',
    })) as Id<'users'>;
    const changePassword = vi.fn().mockResolvedValue({status: true});
    vi.spyOn(authComponent, 'getAuth').mockResolvedValue({
      auth: {api: {changePassword}} as never,
      headers: new Headers(),
    });

    const result = await t
      .withIdentity({subject: userId})
      .action(api.auth.public.changePasswordV2, {
        currentPassword: 'old-password-123',
        newPassword: 'new-password-456',
        revokeOtherSessions: false,
      });

    expect(result).toBeNull();
    expect(changePassword).toHaveBeenCalledWith({
      body: {
        currentPassword: 'old-password-123',
        newPassword: 'new-password-456',
        revokeOtherSessions: false,
      },
      headers: expect.any(Headers),
    });
  });

  it('rejects unauthenticated V2 calls before invoking Better Auth', async () => {
    const t = convexTest();
    const changePassword = vi.fn().mockResolvedValue({status: true});
    vi.spyOn(authComponent, 'getAuth').mockResolvedValue({
      auth: {api: {changePassword}} as never,
      headers: new Headers(),
    });

    await expect(
      t.action(api.auth.public.changePasswordV2, {
        currentPassword: 'old-password-123',
        newPassword: 'new-password-456',
      }),
    ).rejects.toThrow('Unauthenticated');
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('preserves the per-user password-change rate limit on V2', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Rate Limited Password User',
      email: 'rate-limited-password@example.com',
    })) as Id<'users'>;
    const changePassword = vi.fn().mockResolvedValue({status: true});
    vi.spyOn(authComponent, 'getAuth').mockResolvedValue({
      auth: {api: {changePassword}} as never,
      headers: new Headers(),
    });
    const asUser = t.withIdentity({subject: userId});
    const args = {
      currentPassword: 'old-password-123',
      newPassword: 'new-password-456',
    };

    await asUser.action(api.auth.public.changePasswordV2, args);
    await asUser.action(api.auth.public.changePasswordV2, args);
    await asUser.action(api.auth.public.changePasswordV2, args);

    await expect(
      asUser.action(api.auth.public.changePasswordV2, args),
    ).rejects.toThrow('RateLimited');
    expect(changePassword).toHaveBeenCalledTimes(3);
  });

  it('durably charges failed current-password attempts against the V2 rate limit', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Failed Attempt Password User',
      email: 'failed-attempt-password@example.com',
    })) as Id<'users'>;
    const changePassword = vi
      .fn()
      .mockRejectedValue(new Error('Invalid password'));
    vi.spyOn(authComponent, 'getAuth').mockResolvedValue({
      auth: {api: {changePassword}} as never,
      headers: new Headers(),
    });
    const asUser = t.withIdentity({subject: userId});
    const args = {
      currentPassword: 'wrong-password-123',
      newPassword: 'new-password-456',
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        asUser.action(api.auth.public.changePasswordV2, args),
      ).rejects.toThrow('Invalid password');
    }

    await expect(
      asUser.action(api.auth.public.changePasswordV2, args),
    ).rejects.toThrow('RateLimited');
    expect(changePassword).toHaveBeenCalledTimes(3);
  });
});
