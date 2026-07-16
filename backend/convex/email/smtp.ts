'use node';

import nodemailer from 'nodemailer';
import {v} from 'convex/values';
import {internal} from '../_generated/api';
import {internalAction} from '../_generated/server';
import {logger} from '../lib/logger';
import {withRetry} from '../lib/resilience';
import {
  emailPayloadArgs,
  providerEmailDeliveryArgs,
} from '../lib/validators/email_delivery';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sendViaSmtp(
  args: {
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
  },
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

export const sendPreview = internalAction({
  args: providerEmailDeliveryArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
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
    return null;
  },
});

export const sendFallback = internalAction({
  args: emailPayloadArgs,
  returns: v.null(),
  handler: async (_ctx, args) => {
    await sendViaSmtp(args, 'fallback');
    return null;
  },
});
