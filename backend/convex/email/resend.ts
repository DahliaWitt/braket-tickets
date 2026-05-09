import {vOnEmailEventArgs} from '@convex-dev/resend';
import {v} from 'convex/values';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from '../_generated/server';
import type {EmailDeliverySource} from '../lib/validators/email_delivery';

async function recordTerminalProviderFailure(
  ctx: MutationCtx,
  args: {
    source: EmailDeliverySource;
    sourceId: string;
    recipient: string;
    error: string;
  },
): Promise<void> {
  const sourceFailures = await ctx.db
    .query('emailDeliveryFailures')
    .withIndex('by_source', (q) =>
      q.eq('source', args.source).eq('sourceId', args.sourceId),
    )
    .take(50);
  const existing = sourceFailures.find(
    (failure) =>
      failure.recipient === args.recipient && failure.error === args.error,
  );
  if (existing) return;

  await ctx.db.insert('emailDeliveryFailures', {
    source: args.source,
    sourceId: args.sourceId,
    recipient: args.recipient,
    error: args.error,
    failedAt: Date.now(),
  });
}

const CIRCUIT_PROVIDER = 'resend';
const CIRCUIT_WINDOW_MS = 2 * 60 * 1000;
const CIRCUIT_OPEN_MS = 5 * 60 * 1000;
const CIRCUIT_FAILURE_THRESHOLD = 3;

export const getCircuitState = internalQuery({
  args: {},
  returns: v.object({
    openUntil: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const row = await ctx.db
      .query('emailProviderCircuit')
      .withIndex('by_provider', (q) => q.eq('provider', CIRCUIT_PROVIDER))
      .first();
    return row?.openUntil ? {openUntil: row.openUntil} : {};
  },
});

export const recordTransientFailure = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const row = await ctx.db
      .query('emailProviderCircuit')
      .withIndex('by_provider', (q) => q.eq('provider', CIRCUIT_PROVIDER))
      .first();
    if (!row) {
      await ctx.db.insert('emailProviderCircuit', {
        provider: CIRCUIT_PROVIDER,
        failureCount: 1,
        windowStartedAt: now,
        updatedAt: now,
      });
      return null;
    }

    if (now - row.windowStartedAt > CIRCUIT_WINDOW_MS) {
      await ctx.db.patch('emailProviderCircuit', row._id, {
        failureCount: 1,
        windowStartedAt: now,
        updatedAt: now,
        openUntil: undefined,
      });
      return null;
    }

    const failureCount = row.failureCount + 1;
    await ctx.db.patch('emailProviderCircuit', row._id, {
      failureCount,
      updatedAt: now,
      ...(failureCount >= CIRCUIT_FAILURE_THRESHOLD
        ? {openUntil: now + CIRCUIT_OPEN_MS}
        : {}),
    });
    return null;
  },
});

export const recordResendSuccess = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await ctx.db
      .query('emailProviderCircuit')
      .withIndex('by_provider', (q) => q.eq('provider', CIRCUIT_PROVIDER))
      .first();
    if (!row) return null;
    await ctx.db.patch('emailProviderCircuit', row._id, {
      failureCount: 0,
      windowStartedAt: Date.now(),
      updatedAt: Date.now(),
      openUntil: undefined,
    });
    return null;
  },
});

export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event;
    if (
      event.type !== 'email.bounced' &&
      event.type !== 'email.failed' &&
      event.type !== 'email.complained'
    ) {
      return null;
    }

    const delivery = await ctx.db
      .query('emailDeliveries')
      .withIndex('by_emailId', (q) => q.eq('emailId', args.id))
      .first();
    if (!delivery) {
      return null;
    }

    const message =
      event.type === 'email.bounced'
        ? event.data.bounce.message
        : event.type === 'email.failed'
          ? event.data.failed.reason
          : 'Recipient marked email as spam';

    await recordTerminalProviderFailure(ctx, {
      source: delivery.source,
      sourceId: delivery.sourceId,
      recipient: delivery.recipient,
      error: message,
    });
    return null;
  },
});
