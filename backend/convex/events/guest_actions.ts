'use node';

import {v} from 'convex/values';
import {action, type ActionCtx} from '../_generated/server';
import {internal} from '../_generated/api';
import * as QRCode from 'qrcode';
import {purchasedTicketTemplate} from '../email/templates';
import {sendEmailDeliveryNow} from '../lib/email_delivery_wrapper';
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- importer is 'use node'; plugin heuristic misses that. Same pattern as stripe/_impl/checkout.ts.
import {createTicketPdf} from '../lib/ticket_template';
import {
  throwAppError,
  throwNotFound,
  throwUnauthenticated,
  throwUnauthorized,
} from '../lib/errors';
import {eventStartInstantMs} from '@shared/event-time';
import {requireGuestTicketSendAccess} from './_impl/guest_ticket_access';

type GuestTicketPdfInput = {
  guest: {
    _id: string;
    name: string;
  };
  event: {
    title: string;
    date: string;
    location?: string;
  };
  promoterName: string;
};

async function buildGuestTicketPdf({
  guest,
  event,
  promoterName,
}: GuestTicketPdfInput): Promise<{
  pdfDataUrl: string;
  qrCodeDataUrl: string;
}> {
  const qrText = `GUEST:${guest._id}`;
  const qrCodeDataUrl = await QRCode.toDataURL(qrText, {
    margin: 1,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  const pdfDataUrl = await createTicketPdf({
    eventTitle: event.title,
    promoterName,
    attendeeName: guest.name,
    eventDate: requireEventStartInstantMs(event.date),
    ticketId: guest._id,
    qrCodeDataUrl,
    ...(event.location ? {location: event.location} : {}),
  });

  return {pdfDataUrl, qrCodeDataUrl};
}

function requireEventStartInstantMs(eventDate: string): number {
  const startsAtMs = eventStartInstantMs(eventDate);
  if (startsAtMs === null) {
    throwAppError('INVALID_EVENT_DATE', 'Event has an invalid date');
  }
  return startsAtMs;
}

export const sendTicket = action({
  args: {
    guestId: v.id('guests'),
    /**
     * When true (batch "send all"), the guest is skipped if already emailed so
     * a stale client cannot re-email the roster. Omitted/false for a deliberate
     * single resend, which is still deduped against concurrent in-flight sends.
     */
    skipIfAlreadyEmailed: v.optional(v.boolean()),
  },
  returns: v.object({
    status: v.union(v.literal('sent'), v.literal('skipped')),
  }),
  handler: async (ctx, args) => {
    const guest = await requireGuestTicketSendAccess(ctx, args.guestId);

    // Atomically claim the send so concurrent admins/tabs cannot double-send.
    const claim = await ctx.runMutation(
      internal.events.guests.beginGuestTicketSend,
      {
        id: args.guestId,
        requireUnsent: args.skipIfAlreadyEmailed === true,
      },
    );
    if (!claim.claimed) {
      return {status: 'skipped' as const};
    }

    try {
      return await deliverGuestTicket(ctx, guest);
    } catch (error) {
      // Release the lock so the failed send can be retried immediately.
      await ctx.runMutation(internal.events.guests.clearGuestTicketSendLock, {
        id: guest._id,
      });
      throw error;
    }
  },
});

async function deliverGuestTicket(
  ctx: ActionCtx,
  guest: Awaited<ReturnType<typeof requireGuestTicketSendAccess>>,
): Promise<{status: 'sent'}> {
  const eventP = ctx.runQuery(internal.events.management.getInternal, {
    id: guest.eventId,
  });
  const [event, organizer] = await Promise.all([
    eventP,
    eventP.then((e) =>
      e
        ? ctx.runQuery(internal.communities.profile.getInternal, {
            id: e.organizerId,
          })
        : null,
    ),
  ]);
  if (!event) throwNotFound('Event');

  const {pdfDataUrl, qrCodeDataUrl} = await buildGuestTicketPdf({
    guest,
    event,
    promoterName: organizer?.name ?? 'BRAKET',
  });

  const pdfBase64 = pdfDataUrl.split(',')[1];
  const {subject, html} = purchasedTicketTemplate(
    {title: event.title, date: event.date, location: event.location},
    guest.name,
    'cid:qrcode',
    true,
    {
      slug: organizer?.slug,
      hasCodeOfConduct: !!organizer?.codeOfConduct,
    },
  );

  await sendEmailDeliveryNow(
    ctx,
    {
      to: guest.email,
      subject,
      html,
      attachments: [
        {
          filename: `ticket-${guest.name.replace(/\s+/g, '-').toLowerCase()}.pdf`,
          content: pdfBase64,
          contentType: 'application/pdf',
        },
        {
          filename: 'qrcode.png',
          content: qrCodeDataUrl.split(',')[1],
          contentType: 'image/png',
          cid: 'qrcode',
        },
      ],
    },
    {
      source: 'ticket',
      sourceId: guest._id as string,
      recipient: guest.email,
      critical: true,
    },
  );

  await ctx.runMutation(internal.events.guests.markAsEmailed, {
    id: guest._id,
  });

  return {status: 'sent'};
}

/**
 * Generates a PDF guest ticket for download by event admins (root admin or
 * community admin of the event's organizer).
 *
 * Auth is delegated to `internal.lib.access._isEventAdmin` — that helper is
 * unit-tested in `convex/lib/permissions.test.ts`. This action runs in the Node
 * runtime (`"use node"`), which prevents convex-test from invoking it directly,
 * so the auth logic is verified through the helper's tests rather than here.
 */
export const getGuestTicketPdf = action({
  args: {guestId: v.id('guests')},
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(
      internal.lib.auth_helpers.getAuthUserIdInternal,
      {},
    );
    if (!userId) throwUnauthenticated();

    const guest = await ctx.runQuery(internal.events.guests.getInternal, {
      id: args.guestId,
    });
    if (!guest) throwNotFound('Guest');

    const eventP = ctx.runQuery(internal.events.management.getInternal, {
      id: guest.eventId,
    });
    const [isEventAdmin, event, organizer] = await Promise.all([
      ctx.runQuery(internal.lib.access._isEventAdmin, {
        userId,
        eventId: guest.eventId,
      }),
      eventP,
      eventP.then((e) =>
        e
          ? ctx.runQuery(internal.communities.profile.getInternal, {
              id: e.organizerId,
            })
          : null,
      ),
    ]);
    if (!isEventAdmin) throwUnauthorized();
    if (!event) throwNotFound('Event');

    const {pdfDataUrl} = await buildGuestTicketPdf({
      guest,
      event,
      promoterName: organizer?.name ?? 'BRAKET',
    });
    return pdfDataUrl;
  },
});
