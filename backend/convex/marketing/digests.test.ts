import {convexTest} from '../setup.testing';
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import type {FunctionArgs} from 'convex/server';
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

  it('freezes the time window so a continuation crossing an hour+day boundary keeps a valid cursor', async () => {
    // digestHour 23: run starts at 23:59:59 UTC on Jan 15, the continuation
    // fires at 00:00:00 UTC on Jan 16 — flipping BOTH the UTC hour (23 → 0)
    // and the calendar day. Before the fix the continuation recomputed
    // `getUTCHours()` (= 0) and resumed the digestHour-23 cursor against the
    // digestHour-0 index range, which `.paginate()` rejects as an invalid
    // cursor — throwing and silently dropping every admin past page 1. The
    // frozen `windowStartMs` threaded through the continuation must keep the
    // hour (23) and date (2026-01-15) constant for the whole run.
    const digestHour = 23;
    vi.setSystemTime(new Date('2026-01-15T23:59:59Z'));

    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Boundary Community',
    });

    // 101 admins → two pages of 100. Only the first (page 1) and last (page 2)
    // admin have an email so each page sends exactly one digest, mirroring the
    // batch test above and avoiding the convex-test parallel-mutation race.
    for (let i = 0; i < 101; i += 1) {
      const adminWithEmail = i === 0 || i === 100;
      const adminUserId = adminWithEmail
        ? await t.mutation(api.testing.users.createUserDirectly, {
            name: `Admin ${i}`,
            email: `boundary-admin-${i}@test.com`,
          })
        : await t.run(async (ctx) =>
            // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- emailless admins intentionally bail before enqueueEmailDelivery; production mutation requires email
            ctx.db.insert('users', {name: `Admin ${i}`}),
          );
      const applicantUserId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: `Boundary Applicant ${i}`,
          email: `boundary-app-${i}@test.com`,
        },
      );

      await t.mutation(api.testing.admin.seedAdminNotificationPreference, {
        userId: adminUserId,
        organizerId: orgId,
        mode: 'digest',
        digestHour,
      });
      await t.mutation(api.testing.applications.seedApplication, {
        userId: applicantUserId,
        organizerId: orgId,
        status: 'pending',
      });
    }

    // Page 1 runs at 23:59:59 and self-schedules the continuation.
    await t.mutation(internal.marketing.digests.sendDailyDigests, {});

    // Capture the exact args the production handler scheduled — this is what
    // proves the fix: the frozen window must ride along on the continuation.
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const continuation = scheduled.find((job) =>
      JSON.stringify(job).includes('sendDailyDigests'),
    );
    expect(continuation).toBeDefined();
    const continuationArgs = (continuation as {args: unknown[]})
      .args[0] as FunctionArgs<
      typeof internal.marketing.digests.sendDailyDigests
    >;
    // The continuation must carry the frozen window, not just the cursor.
    expect(continuationArgs.windowStartMs).toBeDefined();

    // The clock crosses the hour AND day boundary before the continuation runs.
    vi.setSystemTime(new Date('2026-01-16T00:00:00Z'));

    // Replay the scheduled continuation exactly as the Convex scheduler would.
    // Without the frozen window this throws an invalid-cursor error.
    await t.mutation(
      internal.marketing.digests.sendDailyDigests,
      continuationArgs,
    );

    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    // Both pages delivered: no cursor crash, no dropped digests.
    expect(dedupKeys).toHaveLength(2);
    // Every dedup key uses the frozen start date (Jan 15), never the post-flip
    // date (Jan 16) — proving `today` stayed constant across the midnight run.
    for (const row of dedupKeys) {
      expect(row.key).toContain('2026-01-15');
      expect(row.key).not.toContain('2026-01-16');
    }
  });
});
