import {v} from 'convex/values';
import {internalMutation, internalQuery} from '../_generated/server';
import {emailDeliverySourceValidator} from '../lib/validators/email_delivery';
import {components} from '../_generated/api';
import {normalizeEmailOrNull} from '../lib/validation';

const LEGACY_RECIPIENT_SCAN_LIMIT = 100;

/**
 * Returns true if a successful delivery has been recorded for the given
 * source/sourceId pair and, when supplied, recipient. Recipient scoping lets a
 * corrected guest address receive its own ticket without discarding the durable
 * record that the old address was already served. This record is written inside
 * the send action before caller-side bookkeeping, so it survives a downstream
 * failure that would otherwise let a retry re-send. Failed sends record via
 * `recordFailure`, not here, so a genuine failure remains retryable.
 */
export const hasDelivery = internalQuery({
  args: {
    source: emailDeliverySourceValidator,
    sourceId: v.string(),
    recipient: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const recipient = args.recipient;
    if (!recipient) {
      return (
        (await ctx.db
          .query('emailDeliveries')
          .withIndex('by_source', (q) =>
            q.eq('source', args.source).eq('sourceId', args.sourceId),
          )
          .first()) !== null
      );
    }

    const recipientKey = normalizeEmailOrNull(recipient);
    if (recipientKey) {
      const normalizedDelivery = await ctx.db
        .query('emailDeliveries')
        .withIndex('by_source_and_recipientKey', (q) =>
          q
            .eq('source', args.source)
            .eq('sourceId', args.sourceId)
            .eq('recipientKey', recipientKey),
        )
        .first();
      if (normalizedDelivery) return true;
    }

    const exactDelivery = await ctx.db
      .query('emailDeliveries')
      .withIndex('by_source_and_recipient', (q) =>
        q
          .eq('source', args.source)
          .eq('sourceId', args.sourceId)
          .eq('recipient', recipient),
      )
      .first();
    if (exactDelivery || !recipientKey) return exactDelivery !== null;

    // During rollout, rows created before recipientKey was introduced remain
    // safe against case-only duplicates until the migration finishes. This
    // branch is bounded and disappears from the hot path once rows are keyed.
    const legacyDeliveries = await ctx.db
      .query('emailDeliveries')
      .withIndex('by_source', (q) =>
        q.eq('source', args.source).eq('sourceId', args.sourceId),
      )
      .filter((q) => q.eq(q.field('recipientKey'), undefined))
      .take(LEGACY_RECIPIENT_SCAN_LIMIT + 1);
    if (legacyDeliveries.length > LEGACY_RECIPIENT_SCAN_LIMIT) {
      throw new Error(
        'Email delivery recipient-key backfill is incomplete for a high-history source',
      );
    }
    return legacyDeliveries.some(
      (delivery) => normalizeEmailOrNull(delivery.recipient) === recipientKey,
    );
  },
});

export const recordDelivery = internalMutation({
  args: {
    emailId: v.string(),
    resendId: v.optional(v.string()),
    source: emailDeliverySourceValidator,
    sourceId: v.string(),
    recipient: v.string(),
    critical: v.boolean(),
    manual: v.boolean(),
    fallback: v.boolean(),
    provider: v.union(v.literal('resend'), v.literal('smtp')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const recipientKey = normalizeEmailOrNull(args.recipient);
    await ctx.db.insert('emailDeliveries', {
      emailId: args.emailId,
      ...(args.resendId ? {resendId: args.resendId} : {}),
      source: args.source,
      sourceId: args.sourceId,
      recipient: args.recipient,
      ...(recipientKey ? {recipientKey} : {}),
      critical: args.critical,
      manual: args.manual,
      fallback: args.fallback,
      provider: args.provider,
      sentAt: Date.now(),
    });
    return null;
  },
});

export const recordFailure = internalMutation({
  args: {
    source: emailDeliverySourceValidator,
    sourceId: v.string(),
    recipient: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('emailDeliveryFailures', {
      source: args.source,
      sourceId: args.sourceId,
      recipient: args.recipient,
      error: args.error,
      failedAt: Date.now(),
    });
    return null;
  },
});

const FAILURE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DELIVERY_METADATA_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESEND_FINALIZED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RESEND_ABANDONED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Delete emailDeliveryFailures records older than 30 days.
 *
 * Scheduled daily by crons.ts to prevent unbounded table growth.
 * Processes at most 500 records per run; cron frequency ensures
 * the backlog stays manageable under normal failure rates.
 */
export const cleanupOldFailures = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - FAILURE_RETENTION_MS;
    const old = await ctx.db
      .query('emailDeliveryFailures')
      .withIndex('by_failedAt', (q) => q.lt('failedAt', cutoff))
      .take(500);
    await Promise.all(
      old.map((row) => ctx.db.delete('emailDeliveryFailures', row._id)),
    );
    return null;
  },
});

/**
 * Delete emailDeliveries records older than 30 days.
 *
 * This keeps provider webhook correlation metadata long enough for delayed
 * terminal events while avoiding indefinite recipient PII retention.
 */
export const cleanupOldDeliveries = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - DELIVERY_METADATA_RETENTION_MS;
    const old = await ctx.db
      .query('emailDeliveries')
      .withIndex('by_sentAt', (q) => q.lt('sentAt', cutoff))
      .take(500);
    await Promise.all(
      old.map((row) => ctx.db.delete('emailDeliveries', row._id)),
    );
    return null;
  },
});

export const cleanupResendComponent = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, components.resend.lib.cleanupOldEmails, {
      olderThan: RESEND_FINALIZED_RETENTION_MS,
    });
    await ctx.scheduler.runAfter(
      0,
      components.resend.lib.cleanupAbandonedEmails,
      {
        olderThan: RESEND_ABANDONED_RETENTION_MS,
      },
    );
    return null;
  },
});
