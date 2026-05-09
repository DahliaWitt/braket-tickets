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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentHour = new Date().getUTCHours();
    const cutoff = Date.now() - DAY_MS;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

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

    // Self-schedule continuation if batch was full
    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.marketing.digests.sendDailyDigests,
        {
          paginationOpts: {
            numItems: DIGEST_BATCH_SIZE,
            cursor: result.continueCursor,
          },
        },
      );
    }

    return null;
  },
});
