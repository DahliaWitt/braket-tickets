'use node';

import type {ActionCtx} from '../../_generated/server';
import type {Id} from '../../_generated/dataModel';
import {internal} from '../../_generated/api';
import {logger} from '../../lib/logger';
import {rateLimiter} from '../../lib/rate_limits';
import {
  MAX_EMAIL_LENGTH,
  normalizeEmail,
  validateEmail,
  validateStringLength,
} from '../../lib/validation';
import {guestCheckoutResumeTemplate} from '../../email/templates';
import {sendEmailDeliveryNow} from '../../lib/email_delivery_wrapper';
import {resolveSiteUrl} from '../../lib/site_url';
import {throwPaymentAppError} from '../../lib/payment_errors';
import {generateBearerToken} from '../../lib/token_digests';

type InitiateGuestSessionArgs = {
  email: string;
  eventId?: Id<'events'>;
  existingSessionToken?: string;
  magicLinkToken?: string;
};

type InitiateGuestSessionResult = {
  sessionToken: string;
};

async function sendSessionResumeEmail(
  ctx: ActionCtx,
  args: {
    email: string;
    eventId?: Id<'events'>;
    magicLinkToken?: string;
  },
  existingSessionToken: string,
): Promise<boolean> {
  let resumeEmailSent = false;

  try {
    const siteUrl = resolveSiteUrl();
    const resumeUrl = new URL(
      args.eventId ? `/events/${args.eventId}` : '/',
      siteUrl,
    );
    resumeUrl.searchParams.set('buy', 'true');
    resumeUrl.searchParams.set('resumeGuestEmail', args.email);
    resumeUrl.searchParams.set('resumeGuestSessionToken', existingSessionToken);
    if (args.magicLinkToken) {
      resumeUrl.searchParams.set('token', args.magicLinkToken);
    }

    const event = args.eventId
      ? await ctx.runQuery(internal.events.management.getInternal, {
          id: args.eventId,
        })
      : null;
    const {subject, html} = guestCheckoutResumeTemplate({
      email: args.email,
      resumeUrl: resumeUrl.toString(),
      eventTitle: event?.title,
    });

    await sendEmailDeliveryNow(
      ctx,
      {
        to: args.email,
        subject,
        html,
      },
      {
        source: 'auth',
        sourceId: 'guest-session-resume',
        recipient: args.email,
        critical: true,
      },
    );
    resumeEmailSent = true;
  } catch (error) {
    logger.error(
      'guest_sessions_actions',
      '[INITIATE] Failed to send guest checkout resume email',
      error,
    );
  }

  return resumeEmailSent;
}

export async function initiateGuestSessionHandler(
  ctx: ActionCtx,
  args: InitiateGuestSessionArgs,
): Promise<InitiateGuestSessionResult> {
  const email = normalizeEmail(args.email);

  validateStringLength(email, 'Email', MAX_EMAIL_LENGTH);
  validateEmail(email, 'Email');

  await rateLimiter.limit(ctx, 'initiateGuestSession', {
    key: email,
    throws: true,
  });

  const resumableSessionFromToken = args.existingSessionToken
    ? await ctx.runQuery(internal.guest_sessions.core.getBySessionToken, {
        sessionToken: args.existingSessionToken,
        now: Date.now(),
      })
    : null;
  const hasValidExistingSessionToken =
    !!resumableSessionFromToken &&
    resumableSessionFromToken.email === email &&
    !resumableSessionFromToken.convertedToUserId;

  if (!hasValidExistingSessionToken) {
    const existingSession = await ctx.runQuery(
      internal.guest_sessions.core.getReusableByEmail,
      {
        email,
        now: Date.now(),
      },
    );

    if (existingSession && !existingSession.convertedToUserId) {
      const resumeSessionToken = generateBearerToken();
      const resumeTokenPreparation = await ctx.runMutation(
        internal.guest_sessions.core.prepareResumeSessionToken,
        {
          sessionId: existingSession._id,
          sessionToken: resumeSessionToken,
        },
      );

      const resumeEmailSent =
        resumeTokenPreparation.status === 'prepared'
          ? await sendSessionResumeEmail(
              ctx,
              {
                email,
                eventId: args.eventId,
                magicLinkToken: args.magicLinkToken,
              },
              resumeSessionToken,
            )
          : false;

      if (resumeEmailSent) {
        await ctx.runMutation(
          internal.guest_sessions.core.promoteResumeSessionToken,
          {
            sessionId: existingSession._id,
            sessionToken: resumeSessionToken,
          },
        );
      } else if (resumeTokenPreparation.status === 'prepared') {
        await ctx.runMutation(
          internal.guest_sessions.core.clearResumeSessionToken,
          {
            sessionId: existingSession._id,
            sessionToken: resumeSessionToken,
          },
        );
      }

      throwPaymentAppError(
        'SESSION_RESUME_REQUIRED',
        resumeEmailSent
          ? 'An active guest session already exists for this email. We sent a resume link to your email.'
          : 'An active guest session already exists for this email. Resume checkout from the same device or wait for the session to expire.',
      );
    }
  }

  const sessionToken = generateBearerToken();
  return await ctx.runMutation(internal.guest_sessions.core.initiate, {
    email,
    existingSessionToken: args.existingSessionToken,
    magicLinkToken: args.magicLinkToken,
    sessionToken,
  });
}
