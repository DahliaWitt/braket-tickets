import {internalMutation} from '../_generated/server';
import {v} from 'convex/values';
import {paginationOptsValidator} from 'convex/server';
import {internal} from '../_generated/api';
import {guardEmailDedup, hasEmailDedup} from '../lib/email_dedup';
import {vettingDigestTemplate} from '../email/templates';
import {enqueueEmailDelivery} from '../lib/email_delivery_wrapper';

const DIGEST_BATCH_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export const sendDailyDigests = internalMutation({
  args: {
    paginationOpts: v.optional(paginationOptsValidator),
    // Epoch (ms) marking the start of this digest run. Computed once on the
    // first (cron-triggered) invocation and threaded through every paginated
    // continuation so the entire run shares one frozen time window.
    //
    // Convex pagination cursors are only valid against the exact index range
    // they came from. If a continuation recomputed `currentHour` from its own
    // wall-clock and a run straddled an hour boundary, the follow-up page would
    // query `.eq('digestHour', H+1)` with a cursor positioned in the digestHour-H
    // range and `.paginate()` would throw an invalid-cursor error — silently
    // dropping every admin past the first page (the per-day dedup key means no
    // same-day retry). Freezing the window also keeps `today` (dedup key + email
    // sourceId) stable across a midnight-UTC crossing.
    windowStartMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Freeze the run's time window on the first invocation; continuations carry
    // it forward untouched. All three derived values come from this single
    // epoch so the paginated query filter never changes mid-run.
    const windowStartMs = args.windowStartMs ?? Date.now();
    const currentHour = new Date(windowStartMs).getUTCHours();
    const cutoff = windowStartMs - DAY_MS;
    const today = new Date(windowStartMs).toISOString().slice(0, 10); // YYYY-MM-DD UTC

    const result = await ctx.db
      .query('adminNotificationPreferences')
      .withIndex('by_mode_and_digestHour', (q) =>
        q.eq('mode', 'digest').eq('digestHour', currentHour),
      )
      .paginate(
        args.paginationOpts ?? {
          numItems: DIGEST_BATCH_SIZE,
          cursor: null,
        },
      );

    const prefs = result.page;

    // Process all preferences in parallel
    await Promise.all(
      prefs.map(async (pref) => {
        // Dedup READ — cheap early exit for retries of committed sends.
        const dedupKey = `vetting-digest-${pref.userId}-${pref.organizerId}-${today}`;
        if (await hasEmailDedup(ctx, dedupKey)) return;

        // Cheap recipient eligibility checks first — skip the recentApps scan
        // and the per-applicant user fan-out when this pref will never send.
        const adminUser = await ctx.db.get('users', pref.userId);
        if (!adminUser?.email) return;

        const organizer = await ctx.db.get('organizers', pref.organizerId);
        if (!organizer) return;

        const recentApps = await ctx.db
          .query('applications')
          .withIndex('by_organizer_and_creation', (q) =>
            q.eq('organizerId', pref.organizerId).gte('_creationTime', cutoff),
          )
          .take(500);

        if (recentApps.length === 0) return;

        const applicantUsers = await Promise.all(
          recentApps.map((app) => ctx.db.get('users', app.userId)),
        );

        const applications = recentApps.map((app, i) => ({
          name: applicantUsers[i]?.name ?? 'Unknown',
          submittedAt: app._creationTime,
        }));

        // Dedup INSERT — only burns the slot when committed to sending.
        const alreadySent = await guardEmailDedup(ctx, dedupKey);
        if (alreadySent) return;

        const {subject, html} = vettingDigestTemplate(
          adminUser.name ?? 'Admin',
          organizer.name,
          applications,
          organizer.slug ?? (pref.organizerId as string),
        );

        await enqueueEmailDelivery(
          ctx,
          {to: adminUser.email, subject, html},
          {
            source: 'digest',
            sourceId: `${pref.organizerId as string}-${today}`,
            recipient: adminUser.email,
          },
        );
      }),
    );

    // Self-schedule continuation if batch was full. Carry the frozen window
    // forward so the continuation resumes the cursor against the same
    // digestHour index range it was created in — even if the run crosses an
    // hour or day boundary.
    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.marketing.digests.sendDailyDigests,
        {
          paginationOpts: {
            numItems: DIGEST_BATCH_SIZE,
            cursor: result.continueCursor,
          },
          windowStartMs,
        },
      );
    }

    return null;
  },
});
