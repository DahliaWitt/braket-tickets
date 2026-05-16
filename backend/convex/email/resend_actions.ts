'use node';

import {Resend as ResendSdk} from 'resend';
import {v} from 'convex/values';
import {api, internal} from '../_generated/api';
import {env, internalAction} from '../_generated/server';
import {
  emailFromAddress,
  emailHeadersToArray,
  emailReplyTo,
  resend,
} from '../lib/resend_component';
import {isEmailPreviewMode} from '../lib/email_delivery_mode';
import {logger} from '../lib/logger';
import {emailDeliverySourceValidator} from '../lib/validators/email_delivery';
import {isTestEnvironment} from '../lib/environment';

const attachmentValidator = v.object({
  filename: v.string(),
  content: v.string(),
  encoding: v.optional(v.string()),
  contentType: v.optional(v.string()),
  cid: v.optional(v.string()),
});

function isRetryablePreAcceptanceError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return true;
  }
  const record = error as Record<string, unknown>;
  if (typeof record['resendId'] === 'string') {
    return false;
  }
  const status =
    typeof record['statusCode'] === 'number'
      ? record['statusCode']
      : typeof record['status'] === 'number'
        ? record['status']
        : undefined;
  if (status !== undefined) {
    return status === 429 || status >= 500;
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);
  if (message.includes('timeout') || message.includes('abort')) {
    return false;
  }
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeTestAttachments(
  attachments: Array<{
    filename: string;
    content: string;
    contentType?: string;
    cid?: string;
  }> = [],
): Array<{
  filename: string;
  contentType: string;
  cid?: string;
  size: number;
}> {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType ?? 'application/octet-stream',
    ...(attachment.cid ? {cid: attachment.cid} : {}),
    size: attachment.content.length,
  }));
}

export const send = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    text: v.optional(v.string()),
    headers: v.optional(v.record(v.string(), v.string())),
    attachments: v.optional(v.array(attachmentValidator)),
    requireDelivery: v.optional(v.boolean()),
    source: emailDeliverySourceValidator,
    sourceId: v.string(),
    recipient: v.string(),
    critical: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const critical = args.critical === true || args.requireDelivery === true;
    const fallbackPayload = {
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.text ? {text: args.text} : {}),
      ...(args.headers ? {headers: args.headers} : {}),
      ...(args.attachments ? {attachments: args.attachments} : {}),
    };
    const recordFallbackFailure = async (error: unknown): Promise<never> => {
      const message = errorMessage(error);
      await ctx.runMutation(internal.email.email_delivery.recordFailure, {
        source: args.source,
        sourceId: args.sourceId,
        recipient: args.recipient,
        error: `Fallback SMTP failed: ${message}`,
      });
      throw error;
    };
    const sendFallbackAndRecord = async (): Promise<void> => {
      try {
        await ctx.runAction(internal.email.smtp.sendFallback, fallbackPayload);
      } catch (error) {
        await recordFallbackFailure(error);
      }
      await ctx.runMutation(internal.email.email_delivery.recordDelivery, {
        emailId: `fallback:${crypto.randomUUID()}`,
        source: args.source,
        sourceId: args.sourceId,
        recipient: args.recipient,
        critical,
        manual: true,
        fallback: true,
        provider: 'smtp',
      });
    };

    if (isTestEnvironment()) {
      await ctx.runMutation(api.testing.email.logSentEmail, {
        to: args.to,
        subject: args.subject,
        html: args.html,
        ...(args.text ? {text: args.text} : {}),
        ...(args.headers ? {headers: args.headers} : {}),
        ...(args.attachments
          ? {attachments: sanitizeTestAttachments(args.attachments)}
          : {}),
      });
      return null;
    }

    if (isEmailPreviewMode()) {
      await ctx.runAction(internal.email.smtp.sendPreview, {
        ...fallbackPayload,
        source: args.source,
        sourceId: args.sourceId,
        recipient: args.recipient,
        critical,
      });
      return null;
    }

    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) {
      const error = new Error(
        'Email delivery is not configured (missing RESEND_API_KEY)',
      );
      await ctx.runMutation(internal.email.email_delivery.recordFailure, {
        source: args.source,
        sourceId: args.sourceId,
        recipient: args.recipient,
        error: error.message,
      });
      throw error;
    }

    let from: string;
    try {
      from = emailFromAddress();
    } catch (error) {
      await ctx.runMutation(internal.email.email_delivery.recordFailure, {
        source: args.source,
        sourceId: args.sourceId,
        recipient: args.recipient,
        error: errorMessage(error),
      });
      throw error;
    }
    const replyTo = emailReplyTo();
    const headers = emailHeadersToArray(args.headers);

    if (critical) {
      const circuit = await ctx.runQuery(
        internal.email.resend.getCircuitState,
        {},
      );
      if (circuit.openUntil && circuit.openUntil > Date.now()) {
        await sendFallbackAndRecord();
        return null;
      }
    }

    const sdk = new ResendSdk(apiKey);

    try {
      const emailId = await resend.sendEmailManually(
        ctx,
        {
          from,
          to: args.to,
          subject: args.subject,
          replyTo,
          headers,
        },
        async (emailId) => {
          const {data, error} = await sdk.emails.send(
            {
              from,
              to: args.to,
              subject: args.subject,
              html: args.html,
              text: args.text,
              replyTo,
              headers: args.headers,
              attachments: args.attachments?.map((attachment) => ({
                filename: attachment.filename,
                content: attachment.content,
                contentType: attachment.contentType,
                contentId: attachment.cid,
              })),
            },
            {
              idempotencyKey: emailId,
            },
          );

          if (error) {
            throw Object.assign(new Error(error.message), error);
          }
          if (!data?.id) {
            throw new Error(
              'Resend API accepted email without returning an id',
            );
          }
          return data.id;
        },
      );

      const status = await resend.get(ctx, emailId);
      await ctx.runMutation(internal.email.email_delivery.recordDelivery, {
        emailId,
        ...(status?.resendId ? {resendId: status.resendId} : {}),
        source: args.source,
        sourceId: args.sourceId,
        recipient: args.recipient,
        critical,
        manual: true,
        fallback: false,
        provider: 'resend',
      });
      await ctx.runMutation(internal.email.resend.recordResendSuccess, {});
    } catch (error) {
      if (critical && isRetryablePreAcceptanceError(error)) {
        await ctx.runMutation(internal.email.resend.recordTransientFailure, {});
        logger.warn(
          'resend',
          'Resend pre-acceptance failure; using SMTP fallback',
          {
            source: args.source,
            sourceId: args.sourceId,
            recipient: args.recipient,
            error,
          },
        );
        await sendFallbackAndRecord();
        return null;
      }

      await ctx.runMutation(internal.email.email_delivery.recordFailure, {
        source: args.source,
        sourceId: args.sourceId,
        recipient: args.recipient,
        error: errorMessage(error),
      });
      throw error;
    }

    return null;
  },
});
