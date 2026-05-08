'use node';

import {v} from 'convex/values';
import {action, internalAction} from '../_generated/server';
import {internal} from '../_generated/api';
import type {Doc, Id} from '../_generated/dataModel';
import * as QRCode from 'qrcode';
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- importer is 'use node'; plugin heuristic misses that. Same pattern as stripe/_impl/checkout.ts.
import {
  createTicketBundlePdf,
  createTicketPdf,
  type TicketPdfData,
} from '../lib/ticket_template';
import {
  throwAppError,
  throwNotFound,
  throwUnauthenticated,
  throwUnauthorized,
} from '../lib/errors';
import {logger} from '../lib/logger';
import {purchasedTicketTemplate} from '../email/templates';
import {
  sendEmailDeliveryNow,
  type EmailAttachment,
} from '../lib/email_delivery_wrapper';

type TicketPdfEvent = Pick<Doc<'events'>, 'date' | 'title' | 'location'>;
type TicketPdfTicket = Pick<Doc<'tickets'>, '_id'>;
async function buildTicketPdfData(args: {
  event: TicketPdfEvent;
  ticket: TicketPdfTicket;
  attendeeName: string;
  promoterName: string;
}): Promise<{pdfData: TicketPdfData; qrCodeDataUrl: string}> {
  const qrCodeDataUrl = await QRCode.toDataURL(`TICKET:${args.ticket._id}`, {
    margin: 1,
    color: {dark: '#000000', light: '#FFFFFF'},
  });

  return {
    qrCodeDataUrl,
    pdfData: {
      eventTitle: args.event.title,
      promoterName: args.promoterName,
      attendeeName: args.attendeeName,
      eventDate: new Date(args.event.date).getTime(),
      ticketId: args.ticket._id,
      qrCodeDataUrl,
      ...(args.event.location ? {location: args.event.location} : {}),
    },
  };
}

export async function buildOrderTicketPdfArtifacts(args: {
  event: TicketPdfEvent;
  tickets: TicketPdfTicket[];
  attendeeName: string;
  promoterName: string;
}): Promise<
  Array<{
    pdfData: TicketPdfData;
    qrCodeDataUrl: string;
    ticketId: Id<'tickets'>;
  }>
> {
  return await Promise.all(
    args.tickets.map(async (ticket) => {
      const artifact = await buildTicketPdfData({
        event: args.event,
        ticket,
        attendeeName: args.attendeeName,
        promoterName: args.promoterName,
      });
      return {...artifact, ticketId: ticket._id};
    }),
  );
}

function ticketPdfFilename(
  eventTitle: string,
  ticketId: Id<'tickets'>,
): string {
  return `ticket-${eventTitle.replace(/\s+/g, '-').toLowerCase()}-${ticketId.substring(0, 8)}.pdf`;
}

/**
 * Generates a PDF ticket for a given order.
 * Used for manual download by event admins (root admin or community admin of the
 * event's organizer).
 *
 * Auth is delegated to `internal.lib.access._isEventAdmin` — that helper is
 * unit-tested in `convex/lib/permissions.test.ts`. This action runs in the Node
 * runtime (`"use node"`), which prevents convex-test from invoking it directly,
 * so the auth logic is verified through the helper's tests rather than here.
 *
 * @param orderId - The order ID to generate the ticket for.
 * @returns A Base64-encoded Data URL string of the PDF (e.g., "data:application/pdf;base64,...").
 * @throws Error if payment, event, buyer, or ticket is not found.
 */
export const generateTicketPdf = action({
  args: {orderId: v.id('ticket_orders')},
  returns: v.string(), // Returns base64 data URL
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(
      internal.lib.auth_helpers.getAuthUserIdInternal,
      {},
    );
    if (!userId) throwUnauthenticated();

    const order = await ctx.runQuery(internal.orders.core.getInternal, {
      orderId: args.orderId,
    });
    if (!order) throwNotFound('Order');

    const isEventAdmin = await ctx.runQuery(internal.lib.access._isEventAdmin, {
      userId,
      eventId: order.eventId,
    });
    if (!isEventAdmin) throwUnauthorized();

    const eventP = ctx.runQuery(internal.events.management.getInternal, {
      id: order.eventId,
    });
    const [event, buyer, guestSession, tickets, organizer] = await Promise.all([
      eventP,
      order.userId
        ? ctx.runQuery(internal.users.profile.getInternal, {id: order.userId})
        : Promise.resolve(null),
      order.guestSessionId
        ? ctx.runQuery(internal.guest_sessions.core.getById, {
            sessionId: order.guestSessionId,
          })
        : Promise.resolve(null),
      ctx.runQuery(internal.tickets.public.getTicketsByOrderInternal, {
        orderId: args.orderId,
      }),
      eventP.then((e) =>
        e
          ? ctx.runQuery(internal.communities.profile.getInternal, {
              id: e.organizerId,
            })
          : null,
      ),
    ]);
    if (!event) throwNotFound('Event');

    // Resolve buyer: authenticated user or guest session
    let pdfBuyerName: string;
    if (order.userId) {
      if (!buyer) throwNotFound('Buyer');
      pdfBuyerName = buyer.name || buyer.email || 'Unknown Attendee';
    } else if (order.guestSessionId) {
      pdfBuyerName = guestSession?.email || 'Guest Attendee';
    } else {
      pdfBuyerName = 'Unknown Attendee';
    }

    if (tickets.length === 0) {
      throwAppError('NOT_FOUND', 'No tickets found for this order');
    }
    const pdfTickets = await buildOrderTicketPdfArtifacts({
      event,
      tickets,
      attendeeName: pdfBuyerName,
      promoterName: organizer?.name ?? 'BRAKET',
    });
    return await createTicketBundlePdf(
      pdfTickets.map((ticket) => ticket.pdfData),
    );
  },
});

/** Download a buyer's own valid ticket as a PDF. */
export const getMyTicketPdf = action({
  args: {ticketId: v.id('tickets')},
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(
      internal.lib.auth_helpers.getAuthUserIdInternal,
      {},
    );
    if (!userId) throwUnauthenticated();

    const ticket = await ctx.runQuery(internal.tickets.public.getByIdInternal, {
      id: args.ticketId,
    });
    if (!ticket) throwNotFound('Ticket');
    if (ticket.userId !== userId) throwUnauthorized();
    if (ticket.status !== 'valid')
      throwAppError('INVALID_STATE', 'Only valid tickets can be downloaded');

    const eventP = ctx.runQuery(internal.events.management.getInternal, {
      id: ticket.eventId,
    });
    const [event, buyer, organizer] = await Promise.all([
      eventP,
      ctx.runQuery(internal.users.profile.getInternal, {id: userId}),
      eventP.then((e) =>
        e
          ? ctx.runQuery(internal.communities.profile.getInternal, {
              id: e.organizerId,
            })
          : null,
      ),
    ]);
    if (!event) throwNotFound('Event');
    const pdfBuyerName = buyer?.name || buyer?.email || 'Unknown Attendee';

    const {pdfData} = await buildTicketPdfData({
      event,
      ticket,
      attendeeName: pdfBuyerName,
      promoterName: organizer?.name ?? 'BRAKET',
    });

    return await createTicketPdf(pdfData);
  },
});

/**
 * Internal action to generate and email tickets after a successful purchase.
 *
 * Workflow:
 * 1. Fetch order details.
 * 2. Fetch associated Event and Buyer (User).
 * 3. Retrieve all Tickets linked to the order.
 * 4. For each ticket:
 *    a. Generate a QR code.
 *    b. Generate a PDF using the shared template.
 * 5. Construct an email with all PDF tickets attached.
 * 6. Send through Resend manual delivery with SMTP fallback when allowed.
 *
 * @param orderId - The ID of the successful order.
 */
export const sendTicketsAction = internalAction({
  args: {orderId: v.id('ticket_orders')},
  returns: v.null(),
  handler: async (ctx, args) => {
    const order = await ctx.runQuery(internal.orders.core.getInternal, {
      orderId: args.orderId,
    });
    if (!order) throwNotFound('Order');

    const eventP = ctx.runQuery(internal.events.management.getInternal, {
      id: order.eventId,
    });
    const [event, buyer, guestSession, tickets, organizer] = await Promise.all([
      eventP,
      order.userId
        ? ctx.runQuery(internal.users.profile.getInternal, {
            id: order.userId,
          })
        : Promise.resolve(null),
      order.guestSessionId
        ? ctx.runQuery(internal.guest_sessions.core.getById, {
            sessionId: order.guestSessionId,
          })
        : Promise.resolve(null),
      ctx.runQuery(internal.tickets.public.getTicketsByOrderInternal, {
        orderId: args.orderId,
      }),
      eventP.then((e) =>
        e
          ? ctx.runQuery(internal.communities.profile.getInternal, {
              id: e.organizerId,
            })
          : null,
      ),
    ]);
    if (!event) throwNotFound('Event');

    // Resolve buyer info: authenticated user or guest session
    let buyerName: string;
    let buyerEmail: string;

    if (order.userId) {
      if (!buyer) throwNotFound('Buyer');
      buyerName = buyer.name || buyer.email || 'Unknown Attendee';
      buyerEmail = buyer.email || '';
    } else if (order.guestSessionId) {
      if (!guestSession) throwNotFound('Guest session');
      buyerName = guestSession.email;
      buyerEmail = guestSession.email;
    } else {
      throwAppError(
        'INVALID_STATE',
        'Order has no owner (userId or guestSessionId)',
      );
    }

    if (tickets.length === 0) {
      logger.warn('tickets_actions', 'No tickets found for order', {
        orderId: args.orderId,
      });
      // Sometimes tickets might not be committed yet if called too fast?
      // finalized is a mutation, so it should be there.
      throwAppError('NOT_FOUND', 'No tickets found for order');
    }

    const ticketArtifacts = await buildOrderTicketPdfArtifacts({
      event,
      tickets,
      attendeeName: buyerName,
      promoterName: organizer?.name ?? 'BRAKET',
    });
    const generatedTickets = await Promise.all(
      ticketArtifacts.map(async ({pdfData, qrCodeDataUrl, ticketId}) => {
        const dataUrl = await createTicketPdf(pdfData);
        const pdfBase64 = dataUrl.split(',')[1];
        return {
          qrCodeDataUrl,
          attachment: {
            filename: ticketPdfFilename(event.title, ticketId),
            content: pdfBase64,
            contentType: 'application/pdf',
          },
        };
      }),
    );

    const firstQrCodeDataUrl = generatedTickets[0]?.qrCodeDataUrl ?? '';
    const attachments: EmailAttachment[] = generatedTickets.map(
      (item) => item.attachment,
    );

    const isGuest = !!order.guestSessionId && !order.userId;
    const {subject, html} = purchasedTicketTemplate(
      {title: event.title, date: event.date, location: event.location},
      buyerName || 'Attendee',
      'cid:qrcode',
      isGuest,
    );

    // Add QR code image as a CID attachment for inline display
    attachments.push({
      filename: 'qrcode.png',
      content: firstQrCodeDataUrl.split(',')[1],
      contentType: 'image/png',
      cid: 'qrcode',
    });

    await sendEmailDeliveryNow(
      ctx,
      {
        to: buyerEmail,
        subject,
        html,
        attachments,
      },
      {
        source: 'ticket',
        sourceId: args.orderId as string,
        recipient: buyerEmail,
        critical: true,
      },
    );

    return null;
  },
});
