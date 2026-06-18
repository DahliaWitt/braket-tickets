import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import type {ActionCtx, MutationCtx} from '../_generated/server';
import type {EmailDeliverySource} from './validators/email_delivery';
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

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
  requireDelivery?: boolean;
  attachments?: EmailAttachment[];
};

export type DeliveryMetadata = {
  source: EmailDeliverySource;
  sourceId: string;
  recipient: string;
  critical?: boolean;
};

async function captureTestEmail(
  ctx: Pick<MutationCtx, 'runMutation'>,
  payload: EmailPayload,
): Promise<void> {
  await ctx.runMutation(api.testing.email.logSentEmail, {
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    ...(payload.text ? {text: payload.text} : {}),
    ...(payload.headers ? {headers: payload.headers} : {}),
    ...(payload.attachments
      ? {
          attachments: payload.attachments.map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType ?? 'application/octet-stream',
            ...(attachment.cid ? {cid: attachment.cid} : {}),
            size: attachment.content.length,
          })),
        }
      : {}),
  });
}

export async function enqueueEmailDelivery(
  ctx: MutationCtx,
  payload: EmailPayload,
  metadata: DeliveryMetadata,
): Promise<void> {
  if (isTestEnvironment()) {
    await captureTestEmail(ctx, payload);
    return;
  }

  const critical =
    metadata.critical === true || payload.requireDelivery === true;
  if (isEmailPreviewMode()) {
    await ctx.scheduler.runAfter(0, internal.email.smtp.sendPreview, {
      ...payload,
      source: metadata.source,
      sourceId: metadata.sourceId,
      recipient: metadata.recipient,
      critical,
    });
    return;
  }

  if (critical || payload.attachments?.length) {
    await ctx.scheduler.runAfter(0, internal.email.resend_actions.send, {
      ...payload,
      source: metadata.source,
      sourceId: metadata.sourceId,
      recipient: metadata.recipient,
      critical,
    });
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
    critical,
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
    await captureTestEmail({runMutation}, payload);
    return;
  }

  const critical =
    metadata.critical === true || payload.requireDelivery === true;
  if (isEmailPreviewMode()) {
    if (!ctx.runAction) {
      throw new Error('Action context required for immediate email delivery');
    }
    await ctx.runAction(internal.email.smtp.sendPreview, {
      ...payload,
      source: metadata.source,
      sourceId: metadata.sourceId,
      recipient: metadata.recipient,
      critical,
    });
    return;
  }

  if (!ctx.runAction) {
    throw new Error('Action context required for immediate email delivery');
  }
  await ctx.runAction(internal.email.resend_actions.send, {
    ...payload,
    source: metadata.source,
    sourceId: metadata.sourceId,
    recipient: metadata.recipient,
    critical,
  });
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
