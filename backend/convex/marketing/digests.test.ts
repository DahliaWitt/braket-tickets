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

    // Seed 101 admin prefs across two pages of 100. Only the first and last
    // admin have email addresses so each page sends exactly one digest —
    // avoids the workpool race that would crash convex-test if all 101
    // admins scheduled emails concurrently.
    for (let i = 0; i < 101; i += 1) {
      const adminWithEmail = i === 0 || i === 100;
      const adminUserId = adminWithEmail
        ? await t.mutation(api.testing.users.createUserDirectly, {
            name: `Admin ${i}`,
            email: `admin-${i}@test.com`,
          })
        : await t.run(async (ctx) =>
            // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- emailless admins intentionally bail before enqueueEmailDelivery; production mutation requires email
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

    // If pagination advances correctly: page 1 sends to admin 0, page 2 sends
    // to admin 100 → 2 distinct dedup rows. If pagination re-reads page 1
    // forever, only admin 0 sends and the second call dedups → 1 row.
    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    expect(dedupKeys).toHaveLength(2);
  });
});
