import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
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

  it('freezes the time window across every continuation page over an hour+day boundary', async () => {
    // digestHour 23: the run starts at 23:59:59 UTC on Jan 15, but its
    // continuations are driven at 00:00:05 UTC on Jan 16 — flipping BOTH the
    // UTC hour (23 → 0) and the calendar day. Before the fix each continuation
    // recomputed `getUTCHours()` (= 0) and resumed the digestHour-23 cursor
    // against the digestHour-0 index range, which drops every admin past page 1
    // (Convex rejects the mismatched cursor; the per-day dedup key blocks any
    // same-day retry). The frozen `windowStartMs` threaded through every
    // self-scheduled page must keep the hour (23) and date (2026-01-15)
    // constant for the whole multi-page run.
    const digestHour = 23;
    const startMs = Date.parse('2026-01-15T23:59:59Z');
    vi.setSystemTime(new Date(startMs));

    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Boundary Community',
    });

    // 201 admins → THREE pages of 100/100/1, forcing two self-scheduled
    // continuation hops (page 1→2 and page 2→3) so the "every page" claim is
    // covered directly, not just the first hop. Only admins 0, 100, and 200
    // have an email, so each page sends exactly one digest — mirroring the
    // batch test above and avoiding the convex-test parallel-mutation race.
    const emailAdminIndexes = new Set([0, 100, 200]);
    for (let i = 0; i < 201; i += 1) {
      const adminUserId = emailAdminIndexes.has(i)
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

    // Page 1 runs at 23:59:59 and self-schedules the next page.
    await t.mutation(internal.marketing.digests.sendDailyDigests, {});

    // Advance past midnight, then let the real Convex scheduler drive the
    // remaining pages exactly as production would. This exercises the actual
    // continuation-threading path, not a hand-fed replay.
    vi.setSystemTime(new Date('2026-01-16T00:00:05Z'));
    await finishAllScheduledFunctions(t);

    // Every self-scheduled continuation must carry the SAME frozen epoch — this
    // is what keeps the digestHour cursor valid and the cutoff/today stable on
    // every hop. Asserting exact equality (not just "defined") also pins the
    // 24h application cutoff, which is derived from the same epoch.
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const continuations = scheduled.filter((job) =>
      JSON.stringify(job).includes('sendDailyDigests'),
    );
    // Two continuation hops: page 1→2 and page 2→3.
    expect(continuations.length).toBeGreaterThanOrEqual(2);
    for (const job of continuations) {
      const jobArgs = (job as {args: unknown[]}).args[0] as FunctionArgs<
        typeof internal.marketing.digests.sendDailyDigests
      >;
      expect(jobArgs.windowStartMs).toBe(startMs);
    }

    const dedupKeys = await t.run(async (ctx) =>
      ctx.db.query('emailDedup').collect(),
    );
    // All three pages delivered: no cursor crash, no dropped digests.
    expect(dedupKeys).toHaveLength(3);
    // Every dedup key uses the frozen start date (Jan 15), never the post-flip
    // date (Jan 16) — proving `today` stayed constant across the midnight run.
    for (const row of dedupKeys) {
      expect(row.key).toContain('2026-01-15');
      expect(row.key).not.toContain('2026-01-16');
    }
  });
});
