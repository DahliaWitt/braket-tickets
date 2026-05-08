import {cronJobs} from 'convex/server';
import {internal} from './_generated/api';

const crons = cronJobs();

crons.interval(
  'cleanup old admin audit logs',
  {hours: 24},
  internal.communities.management.audit.cleanupOldAuditLogs,
  {},
);

crons.interval(
  'cleanup stale resale listings',
  {minutes: 30},
  internal.resale.listings.cleanupStaleResaleListings,
  {},
);

/**
 * Cleanup Expired Guest Sessions
 *
 * Runs every hour to delete guest sessions past their 24h hard expiry.
 * Sessions that were converted to user accounts (convertedToUserId set)
 * are preserved for audit trail.
 *
 * @see convex/guest_sessions.ts - cleanupExpiredSessions for implementation
 */
crons.interval(
  'cleanup expired guest sessions',
  {hours: 1},
  internal.guest_sessions.core.cleanupExpiredSessions,
  {},
);

/**
 * Process Scheduled Stripe Payouts
 *
 * Runs daily to pay out event revenue to organizers via Stripe Connect.
 * Queries events that use Stripe, have passed their event date, and
 * have not yet been paid out. For each eligible event, schedules a
 * payout action that transfers available balance to the organizer's
 * connected bank account.
 *
 * @see convex/stripe/actions.ts - processScheduledPayouts for implementation
 * @see convex/stripe/connect.ts - payout eligibility helpers
 */
crons.interval(
  'process scheduled Stripe payouts',
  {hours: 24},
  internal.stripe.actions.processScheduledPayouts,
  {},
);

/**
 * Cleanup Stale Email Dedup Keys
 *
 * Runs every 6 hours to delete idempotency keys older than 24h from the
 * emailDedup table. Keys only need to survive long enough to guard against
 * client retries — after 24h they are safe to prune.
 *
 * @see convex/lib/email_dedup.ts - cleanupStaleEmailDedup for implementation
 */
crons.interval(
  'cleanup stale email dedup keys',
  {hours: 6},
  internal.lib.email_dedup.cleanupStaleEmailDedup,
  {},
);

/**
 * Send Daily Vetting Digest Emails
 *
 * Runs every hour to send digest emails to community admins who have configured
 * a daily digest for vetting form submissions. Each admin's digestHour (0–23 UTC)
 * determines which hourly run sends their email.
 */
crons.interval(
  'send daily vetting digests',
  {hours: 1},
  internal.marketing.digests.sendDailyDigests,
  {},
);

/**
 * Clean Up Old Email Delivery Records
 *
 * Runs daily to delete email delivery records older than 30 days,
 * preventing unbounded table growth. Processes at most 500 records per run.
 */
crons.interval(
  'cleanup old email delivery failures',
  {hours: 24},
  internal.email.email_delivery.cleanupOldFailures,
  {},
);

crons.interval(
  'cleanup old email delivery metadata',
  {hours: 24},
  internal.email.email_delivery.cleanupOldDeliveries,
  {},
);

crons.interval(
  'cleanup resend component email records',
  {hours: 24},
  internal.email.email_delivery.cleanupResendComponent,
  {},
);

/**
 * Reap Stale Stripe Webhook Claims
 *
 * Runs every 30 minutes to promote `stripe_webhook_events` rows that have
 * been stuck in `pending` past REAPER_FAILURE_TIMEOUT_MS (24h) to `failed`.
 * This bounds the lifetime of claims abandoned by crashed actions whose
 * Stripe retries also exhausted, surfacing them for operator inspection.
 *
 * Processes at most REAPER_BATCH_SIZE (100) rows per run to keep the
 * mutation's transaction bounded and predictable.
 *
 * @see convex/stripe/_impl/webhook_claims.ts - reapStaleWebhookClaims
 * @see convex/stripe/webhooks.ts - reapStaleStripeWebhookClaims
 */
crons.interval(
  'reap stale Stripe webhook claims',
  {minutes: 30},
  internal.stripe.webhooks.reapStaleStripeWebhookClaims,
  {},
);

/**
 * Cleanup Orphaned Storage Uploads
 *
 * Runs hourly to delete stored files that were never confirmed via
 * confirmUpload. Files older than 1 hour without a confirmedUploads
 * record are orphans from abandoned uploads or client crashes.
 * Scans up to 500 entries and deletes at most 50 per run.
 *
 * @see convex/storage/files.ts - _cleanupOrphanedUploads
 */
crons.interval(
  'cleanup orphaned storage uploads',
  {hours: 1},
  internal.storage.files._cleanupOrphanedUploads,
  {},
);

export default crons;
