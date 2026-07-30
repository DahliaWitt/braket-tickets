import {v} from 'convex/values';
import {testingMutation} from './wrappers';

/** Bootstrap-only feature-state switch for convex-test and E2E seeds. */
export const enableFeature = testingMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Bootstrap-only
     * test feature-state setup; production enablement is internal maintenance. */
    const existing = await ctx.db
      .query('guestListFeatureState')
      .withIndex('by_key', (q) => q.eq('key', 'singleton'))
      .unique();
    if (existing) {
      await ctx.db.patch('guestListFeatureState', existing._id, {
        emailKeyBackfillComplete: true,
        guestCountBackfillComplete: true,
        enabledAt: Date.now(),
      });
    } else {
      await ctx.db.insert('guestListFeatureState', {
        key: 'singleton',
        emailKeyBackfillComplete: true,
        guestCountBackfillComplete: true,
        enabledAt: Date.now(),
      });
    }
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
    return null;
  },
});

/**
 * Test-only scheduler control for guest-list lifecycle assertions. Fake timers
 * keep runAfter(0) work queued; cancelling it lets tests drive the same
 * production mutations manually without racing the background action.
 */
export const cancelScheduledWork = testingMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const scheduled = await ctx.db.system
      .query('_scheduled_functions')
      .take(1000);
    await Promise.all(scheduled.map((job) => ctx.scheduler.cancel(job._id)));
    return null;
  },
});
