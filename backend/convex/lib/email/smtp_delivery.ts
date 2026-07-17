'use node';

import nodemailer from 'nodemailer';
import {internal} from '../../_generated/api';
import type {ActionCtx} from '../../_generated/server';
import {logger} from '../logger';
import {withRetry} from '../resilience';
import type {EmailDeliverySource} from '../validators/email_delivery';

/**
 * SMTP transport shared by the provider actions in email/smtp.ts and the
 * Resend fallback path in email/resend_actions.ts. Both run in the Node
 * runtime, so they call these helpers directly instead of hopping through
 * ctx.runAction (cross-action calls are only for crossing runtimes).
 *
 * Node-runtime only: this module imports nodemailer and must not be imported
 * from default-runtime Convex modules.
 */

export type SmtpEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    content: string;
    encoding?: string;
    contentType?: string;
    cid?: string;
  }>;
};

export type SmtpDeliveryMetadata = {
  source: EmailDeliverySource;
  sourceId: string;
  recipient: string;
  critical?: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sendViaSmtp(
  args: SmtpEmailPayload,
  logLabel: string,
): Promise<void> {
  const defaultHost =
    logLabel === 'preview' ? 'smtp.ethereal.email' : 'smtp.gmail.com';
  const SMTP_HOST = process.env['SMTP_HOST'] || defaultHost;
  const SMTP_PORT = process.env['SMTP_PORT'] || '587';
  const SMTP_USER = process.env['SMTP_USER'];
  const SMTP_PASS = process.env['SMTP_PASS'];
  const SMTP_FROM =
    process.env['EMAIL_FROM'] || process.env['SMTP_FROM'] || SMTP_USER;
  const SMTP_REPLY_TO =
    process.env['EMAIL_REPLY_TO'] || process.env['SMTP_REPLY_TO'];

  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error(
      `${logLabel} email delivery is not configured (missing SMTP_USER/SMTP_PASS)`,
    );
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10),
    secure: SMTP_PORT === '465',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  try {
    await withRetry(
      () =>
        transporter.sendMail({
          from: `Braket Tickets <${SMTP_FROM}>`,
          replyTo: SMTP_REPLY_TO,
          to: args.to,
          subject: args.subject,
          html: args.html,
          text: args.text,
          headers: args.headers,
          attachments: args.attachments?.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.content,
            encoding: attachment.encoding || 'base64',
            contentType: attachment.contentType,
            cid: attachment.cid,
          })),
        }),
      {
        maxAttempts: 3,
        initialBackoffMs: 2000,
        base: 2,
        onRetry: (attempt, error) => {
          logger.warn('smtp', `${logLabel} email delivery retry`, {
            attempt,
            to: args.to,
            error,
          });
        },
      },
    );
    logger.info('smtp', `Email sent via ${logLabel} SMTP`, {
      to: args.to,
      host: SMTP_HOST,
    });
  } catch (error) {
    logger.error('smtp', `Failed to send ${logLabel} email`, error);
    throw new Error(`Failed to send ${logLabel} email`, {cause: error});
  }
}

/**
 * Delivers via the preview (Ethereal) SMTP transport, recording the outcome:
 * a failure records to emailDeliveryFailures and rethrows (callers must not
 * report false success); a success records to emailDeliveries.
 */
export async function deliverPreviewEmail(
  ctx: Pick<ActionCtx, 'runMutation'>,
  args: SmtpEmailPayload & SmtpDeliveryMetadata,
): Promise<void> {
  try {
    await sendViaSmtp(args, 'preview');
  } catch (error) {
    await ctx.runMutation(internal.email.email_delivery.recordFailure, {
      source: args.source,
      sourceId: args.sourceId,
      recipient: args.recipient,
      error: `Preview SMTP failed: ${errorMessage(error)}`,
    });
    throw error;
  }
  await ctx.runMutation(internal.email.email_delivery.recordDelivery, {
    emailId: `preview:${crypto.randomUUID()}`,
    source: args.source,
    sourceId: args.sourceId,
    recipient: args.recipient,
    critical: args.critical === true,
    manual: Boolean(args.attachments?.length),
    fallback: false,
    provider: 'smtp',
  });
}

/**
 * Delivers via the Gmail fallback SMTP transport. Throws on failure; the
 * caller (resend_actions.send) owns failure recording for this path.
 */
export async function deliverFallbackEmail(
  args: SmtpEmailPayload,
): Promise<void> {
  await sendViaSmtp(args, 'fallback');
}
