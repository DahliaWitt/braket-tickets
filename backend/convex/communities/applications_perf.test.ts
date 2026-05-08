import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

describe('Applications Performance', () => {
  it('getMyApplication returns the most recent application', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Applicant',
      email: 'applicant-perf@example.com',
    })) as Id<'users'>;

    const asUser = t.withIdentity({subject: userId});

    // Submit 3 applications sequentially
    // We can't use `submit` mutation because it checks for pending applications
    // and throws if one exists. So we seed them via composites to simulate history
    // (e.g. older ones were rejected or revoked).

    // App 1 (Oldest)
    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      status: 'rejected',
      answers: {version: 1},
    });

    // App 2
    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      status: 'revoked',
      answers: {version: 2},
    });

    // App 3 (Newest / Current)
    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      status: 'pending',
      answers: {version: 3},
    });

    // Get
    const app = await asUser.query(api.communities.applications.getMyApplication, {});
    expect(app).toBeDefined();
    expect(app?.answers.version).toBe(3);
    expect(app?.status).toBe('pending');
  });

  it('getMyApplication returns null if no applications', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'New User',
      email: 'newuser-perf@example.com',
    })) as Id<'users'>;

    const asUser = t.withIdentity({subject: userId});
    const app = await asUser.query(api.communities.applications.getMyApplication, {});
    expect(app).toBeNull();
  });
});
