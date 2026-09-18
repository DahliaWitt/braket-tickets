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
    // Rate-limit only tokenless entries: a caller presenting a valid session
    // token already holds the session credential, and re-entry with it is a
    // cheap reuse (no new session, no email). Tokenless entries mint sessions
    // and can trigger a courtesy email to the address, so they stay limited.
    await rateLimiter.limit(ctx, 'initiateGuestSession', {
      key: email,
      throws: true,
    });

    const existingSession = await ctx.runQuery(
      internal.guest_sessions.core.getResumeTargetByEmail,
      {
        email,
        now: Date.now(),
        // Scope "has something to resume" to the event the resume link will
        // point at; falls back to most-recently-active when no session holds
        // an open order for it.
        ...(args.eventId ? {eventId: args.eventId} : {}),
      },
    );

    if (existingSession && !existingSession.convertedToUserId) {
      // The buyer likely has an in-flight checkout in another browser context
      // (e.g. Instagram's in-app browser vs Safari). Email them a resume link
      // for that session as a best-effort courtesy, then continue minting a
      // fresh session for this device. This path must never block checkout —
      // hard-stopping here is what stranded real buyers behind a redacted
      // "Server Error" screen.
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

      // On success the resume token stays PENDING: session lookup accepts the
      // pending digest, and core.initiate promotes it to primary on first use.
      // Promoting here would rotate the old session's live credential and
      // break the original device's checkout — which, now that this path is
      // reachable without proof of possession, would let anyone typing an
      // email invalidate that email's in-flight session.
      if (!resumeEmailSent && resumeTokenPreparation.status === 'prepared') {
        await ctx.runMutation(
          internal.guest_sessions.core.clearResumeSessionToken,
          {
            sessionId: existingSession._id,
            sessionToken: resumeSessionToken,
          },
        );
      }
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
