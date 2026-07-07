import {internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';

/**
 * Schedules broadcast catch-up delivery for a recipient who just joined an
 * event's audience (primary purchase, resale settlement, guest add). Shared by
 * all three trigger sites so the guard and scheduler contract cannot drift.
 *
 * Scheduling is unconditional w.r.t. whether the event has any broadcasts:
 * pre-checking `eventBroadcasts` inside the caller's transaction would
 * OCC-couple every in-flight completion to a concurrent `sendBroadcast`, and a
 * no-op scheduled mutation is cheaper. No-ops when the recipient has no email.
 */
export async function scheduleBroadcastCatchup(
  ctx: Pick<MutationCtx, 'scheduler'>,
  args: {
    eventId: Id<'events'>;
    email: string | undefined;
    userId?: Id<'users'>;
  },
): Promise<void> {
  const email = args.email?.trim();
  if (!email) return;
  await ctx.scheduler.runAfter(0, internal.events.broadcasts.deliverMissed, {
    eventId: args.eventId,
    email,
    ...(args.userId ? {userId: args.userId} : {}),
  });
}
