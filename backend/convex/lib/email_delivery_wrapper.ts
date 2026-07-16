import type {FunctionArgs} from 'convex/server';
import {v} from 'convex/values';
import {validate} from 'convex-helpers/validators';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import type {ActionCtx, MutationCtx} from '../_generated/server';
import type {EmailDeliverySource} from './validators/email_delivery';
import {providerEmailDeliveryArgs} from './validators/email_delivery';
import {isEmailPreviewMode} from './email_delivery_mode';
import {
  emailFromAddress,
  emailHeadersToArray,
  emailReplyTo,
  resend,
} from './resend_component';
import {isTestEnvironment} from './environment';

export type EmailAttachment = {
  filename: string;
  content: string;
  contentType?: string;
  encoding?: string;
  cid?: string;
};

/**
 * The renderable email content. Deliberately holds NO dispatch flags: every
 * field here is part of the provider action contract, so the payload can be
 * spread into provider args without leaking internal-only fields (the
 * original bug: a dispatch flag on the payload was spread into
 * email/smtp:sendPreview, whose validator rejects unknown fields).
 */
export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
};

export type DeliveryMetadata = {
  source: EmailDeliverySource;
  sourceId: string;
  recipient: string;
  critical?: boolean;
  /**
   * Internal-only dispatch flag: the caller requires this delivery to be
   * treated as critical (SMTP fallback, circuit breaker, failure records)
   * and to fail the originating request when delivery cannot be attempted.
   * Never passed to provider actions — buildProviderEmailArgs folds it into
   * `critical`.
   */
  requireDelivery?: boolean;
};

// Both provider actions (smtp.sendPreview, resend_actions.send) accept the
// providerEmailDeliveryArgs contract. sendPreview's generated arg type IS that
// contract exactly (send additionally tolerates a transitional, ignored
// requireDelivery field for one release), so it types the builder's output.
type ProviderEmailArgs = FunctionArgs<typeof internal.email.smtp.sendPreview>;

const providerArgsValidator = v.object(providerEmailDeliveryArgs);

/**
 * Builds the exact argument object provider actions accept. This is the ONLY
 * place dispatch payloads are converted into provider args: internal-only
 * metadata flags (requireDelivery) are folded into `critical` here and never
 * forwarded, because provider action validators reject unknown fields at
 * runtime — a spread that includes them bypasses TypeScript excess-property
 * checks and previously broke critical email-change delivery in preview mode.
 */
function buildProviderEmailArgs(
  payload: EmailPayload,
  metadata: DeliveryMetadata,
): ProviderEmailArgs & {critical: boolean} {
  return {
    ...payload,
    source: metadata.source,
    sourceId: metadata.sourceId,
    recipient: metadata.recipient,
    critical: metadata.critical === true || metadata.requireDelivery === true,
  };
}

// Typed against ActionCtx's runMutation (no nested-transaction options) so both
// MutationCtx and ActionCtx callers satisfy it.
async function captureTestEmail(
  ctx: Pick<ActionCtx, 'runMutation'>,
  payload: EmailPayload,
  metadata: DeliveryMetadata,
): Promise<void> {
  // Test-capture must not green-light payloads the real provider actions
  // would reject: validate the exact provider args before capturing, so
  // IS_TEST runs (unit tests and E2E) exercise the same contract that runs
  // against smtp.sendPreview / resend_actions.send in deployed environments.
  validate(providerArgsValidator, buildProviderEmailArgs(payload, metadata), {
    throw: true,
  });
  await ctx.runMutation(api.testing.email.logSentEmail, {
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    ...(payload.text ? {text: payload.text} : {}),
    ...(payload.headers ? {headers: payload.headers} : {}),
  });
}

export async function enqueueEmailDelivery(
  ctx: MutationCtx,
  payload: EmailPayload,
  metadata: DeliveryMetadata,
): Promise<void> {
  if (isTestEnvironment()) {
    await captureTestEmail(ctx, payload, metadata);
    return;
  }

  const providerArgs = buildProviderEmailArgs(payload, metadata);
  if (isEmailPreviewMode()) {
    await ctx.scheduler.runAfter(
      0,
      internal.email.smtp.sendPreview,
      providerArgs,
    );
    return;
  }

  if (providerArgs.critical || payload.attachments?.length) {
    await ctx.scheduler.runAfter(
      0,
      internal.email.resend_actions.send,
      providerArgs,
    );
    return;
  }

  const emailId = await resend.sendEmail(ctx, {
    from: emailFromAddress(),
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    replyTo: emailReplyTo(),
    headers: emailHeadersToArray(payload.headers),
  });

  await ctx.runMutation(internal.email.email_delivery.recordDelivery, {
    emailId,
    source: metadata.source,
    sourceId: metadata.sourceId,
    recipient: metadata.recipient,
    critical: providerArgs.critical,
    manual: false,
    fallback: false,
    provider: 'resend',
  });
}

export async function sendEmailDeliveryNow(
  ctx: Partial<Pick<ActionCtx, 'runAction' | 'runMutation'>>,
  payload: EmailPayload,
  metadata: DeliveryMetadata,
): Promise<void> {
  const runMutation = ctx.runMutation;
  if (isTestEnvironment() && runMutation) {
    await captureTestEmail({runMutation}, payload, metadata);
    return;
  }

  const providerArgs = buildProviderEmailArgs(payload, metadata);
  if (!ctx.runAction) {
    throw new Error('Action context required for immediate email delivery');
  }
  if (isEmailPreviewMode()) {
    await ctx.runAction(internal.email.smtp.sendPreview, providerArgs);
    return;
  }

  await ctx.runAction(internal.email.resend_actions.send, providerArgs);
}

export async function enqueueTicketEmailDelivery(
  ctx: Pick<MutationCtx, 'scheduler'>,
  args: {orderId: Id<'ticket_orders'>},
): Promise<void> {
  await ctx.scheduler.runAfter(
    0,
    internal.tickets.actions.sendTicketsAction,
    args,
  );
}
