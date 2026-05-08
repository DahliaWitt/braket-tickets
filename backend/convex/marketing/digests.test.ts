import {convexTest} from '../setup.testing';
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {api, internal} from '../_generated/api';

async function setupDigestData(digestHour: number) {
  const t = convexTest();
  const adminUserId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Admin User',
    email: 'admin@test.com',
  });
  const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Community',
  });
  const applicantUserId = await t.mutation(
    api.testing.users.createUserDirectly,
    {
      name: 'Applicant User',
      email: 'app@test.com',
    },
  );
  await t.mutation(api.testing.admin.seedAdminNotificationPreference, {
    userId: adminUserId,
    organizerId: orgId,
    mode: 'digest',
    digestHour,
  });
  return {t, adminUserId, orgId, applicantUserId};
}

describe('notification_digests.sendDailyDigests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends digest when digestHour matches current UTC hour and applications exist', async () => {
    const currentHour = 14;
    vi.setSystemTime(
      new Date(`2026-01-15T${String(currentHour).padStart(2, '0')}:00:00Z`),
    );

    const {t, orgId, applicantUserId} = await setupDigestData(currentHour);
    await t.mutation(api.testing.applications.seedApplication, {
      userId: applicantUserId,
      organizerId: orgId,
      status: 'pending',
    });

    await t.mutation(internal.marketing.digests.sendDailyDigests, {});

    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupKeys.length).toBeGreaterThan(0);
    expect(dedupKeys[0].key).toContain('vetting-digest');
  });

  it('skips sending when zero applications in last 24 hours', async () => {
    const currentHour = 9;
    vi.setSystemTime(new Date(`2026-01-15T09:00:00Z`));

    const {t} = await setupDigestData(currentHour);
    // No applications inserted

    await t.mutation(internal.marketing.digests.sendDailyDigests, {});

    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupKeys).toHaveLength(0);
  });

  it('skips when digestHour does not match current UTC hour', async () => {
    vi.setSystemTime(new Date(`2026-01-15T08:00:00Z`)); // hour 8

    const {t, orgId, applicantUserId} = await setupDigestData(9); // set for hour 9
    await t.mutation(api.testing.applications.seedApplication, {
      userId: applicantUserId,
      organizerId: orgId,
      status: 'pending',
    });

    await t.mutation(internal.marketing.digests.sendDailyDigests, {});

    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupKeys).toHaveLength(0);
  });

  it('dedup key prevents double-send on same day', async () => {
    const currentHour = 9;
    vi.setSystemTime(new Date(`2026-01-15T09:00:00Z`));

    const {t, orgId, applicantUserId} = await setupDigestData(currentHour);
    await t.mutation(api.testing.applications.seedApplication, {
      userId: applicantUserId,
      organizerId: orgId,
      status: 'pending',
    });

    // Run twice
    await t.mutation(internal.marketing.digests.sendDailyDigests, {});
    await t.mutation(internal.marketing.digests.sendDailyDigests, {});

    // Only one dedup key (second run is no-op)
    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupKeys).toHaveLength(1);
  });

  it('includes recently submitted applications in digest', async () => {
    const currentHour = 9;
    vi.setSystemTime(new Date(`2026-01-15T09:00:00Z`));

    const {t, orgId, applicantUserId} = await setupDigestData(currentHour);
    // Insert an application now (creationTime = now, within 24h)
    await t.mutation(api.testing.applications.seedApplication, {
      userId: applicantUserId,
      organizerId: orgId,
      status: 'pending',
    });

    await t.mutation(internal.marketing.digests.sendDailyDigests, {});
    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupKeys.length).toBeGreaterThan(0);
  });

  it('advances to later batches instead of re-reading the first page forever', async () => {
    const currentHour = 9;
    vi.setSystemTime(new Date(`2026-01-15T09:00:00Z`));

    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Batch Community',
    });

    for (let i = 0; i < 101; i += 1) {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- admin users intentionally have no email so sendDailyDigests bails before scheduling email actions; 101 concurrent schedules in Promise.all would race on the workpool globals singleton and crash the mutation
      const adminUserId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for users
        ctx.db.insert('users', {name: `Admin ${i}`}),
      );
      const applicantUserId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: `Applicant ${i}`,
          email: `app-${i}@test.com`,
        },
      );

      await t.mutation(api.testing.admin.seedAdminNotificationPreference, {
        userId: adminUserId,
        organizerId: orgId,
        mode: 'digest',
        digestHour: currentHour,
      });
      await t.mutation(api.testing.applications.seedApplication, {
        userId: applicantUserId,
        organizerId: orgId,
        status: 'pending',
      });
    }

    const secondBatchCursor = await t.run(async (ctx) => {
      const page = await ctx.db
        .query('adminNotificationPreferences')
        .withIndex('by_mode_and_digestHour', (q) =>
          q.eq('mode', 'digest').eq('digestHour', currentHour),
        )
        .paginate({numItems: 100, cursor: null});
      return page.continueCursor;
    });

    await t.mutation(internal.marketing.digests.sendDailyDigests, {});
    await t.mutation(internal.marketing.digests.sendDailyDigests, {
      paginationOpts: {numItems: 100, cursor: secondBatchCursor},
    });

    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupKeys).toHaveLength(101);
  });
});
