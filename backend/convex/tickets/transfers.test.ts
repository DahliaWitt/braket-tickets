import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {describe, expect, it, vi} from 'vitest';
import {api} from '../_generated/api';
import {addMember, addTrustLink} from '../lib/authz';

async function seedTransferFixture(args?: {
  recipientEmail?: string;
  recipientName?: string;
  addRecipientDirectMembership?: boolean;
  resaleEnabled?: boolean;
}) {
  const t = convexTest();
  const senderId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Sender',
    email: 'sender@example.com',
  });
  const recipientId = await t.mutation(api.testing.users.createUserDirectly, {
    name: args?.recipientName ?? 'Recipient',
    email: args?.recipientEmail ?? 'recipient@example.com',
  });
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Transfer Org',
    status: 'published',
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: 'Transfer Event',
    date: '2027-06-01',
    price: 2500,
    totalTickets: 100,
    ticketSalesStatus: 'active',
    status: 'published',
    visibility: 'private',
    organizerId,
    resaleEnabled: args?.resaleEnabled ?? false,
  });
  await t.run(async (ctx) => {
    await addMember(ctx, senderId, organizerId);
    if (args?.addRecipientDirectMembership !== false) {
      await addMember(ctx, recipientId, organizerId);
    }
  });
  const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
    userId: senderId,
    eventId,
    status: 'valid',
    tier: 'regular',
    trustSource: 'direct',
  });

  return {t, senderId, recipientId, organizerId, eventId, ticketId};
}

describe('ticket transfers', () => {
  it('validates a direct vetted recipient without transferring yet', async () => {
    const {t, senderId, recipientId, ticketId} = await seedTransferFixture();
    const sender = t.withIdentity({subject: senderId});

    const result = await sender.mutation(
      api.tickets.transfers.validateRecipient,
      {
        ticketId,
        recipientEmail: ' recipient@example.com ',
      },
    );

    expect(result).toEqual({
      userId: recipientId,
      email: 'recipient@example.com',
      name: 'Recipient',
    });
    const ticket = await t.run((ctx) => ctx.db.get('tickets', ticketId));
    expect(ticket?.userId).toBe(senderId);
  });

  it('transfers a valid ticket to a direct vetted recipient and sends email', async () => {
    vi.useFakeTimers();
    const {t, senderId, recipientId, ticketId} = await seedTransferFixture();
    const sender = t.withIdentity({subject: senderId});
    const originalTicket = await t.run((ctx) =>
      ctx.db.get('tickets', ticketId),
    );

    try {
      await sender.mutation(api.tickets.transfers.transfer, {
        ticketId,
        recipientEmail: 'recipient@example.com',
      });
      await finishAllScheduledFunctions(t);

      const ticket = await t.run((ctx) => ctx.db.get('tickets', ticketId));
      expect(ticket?.userId).toBe(recipientId);
      expect(ticket?.orderId).toBeUndefined();
      expect(ticket?.guestSessionId).toBeUndefined();
      expect(ticket?.transferEmailPendingRecipientId).toBeUndefined();
      expect(ticket?.rosterAttendeeName).toBe('Recipient');
      expect(ticket?.rosterEmail).toBe('recipient@example.com');
      expect(ticket?.qrCode).toBeTruthy();
      expect(ticket?.qrCode).not.toBe(originalTicket?.qrCode);

      const senderTickets = await sender.query(
        api.tickets.public.getMyTickets,
        {},
      );
      expect(senderTickets).toHaveLength(0);

      const recipient = t.withIdentity({subject: recipientId});
      const recipientTickets = await recipient.query(
        api.tickets.public.getMyTickets,
        {},
      );
      expect(recipientTickets).toHaveLength(1);
      expect(recipientTickets[0]._id).toBe(ticketId);

      const emails = await t.query(api.testing.email.getSentEmails, {
        to: 'recipient@example.com',
      });
      expect(emails[0]?.subject).toContain('Ticket transferred');
      expect(emails[0]?.attachments?.map((a) => a.filename)).toEqual([
        'ticket-transfer-event-' + ticketId.substring(0, 8) + '.pdf',
        'qrcode.png',
      ]);

      const adminId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Root Admin',
        email: 'root@example.com',
        isRootAdmin: true,
      });
      const asAdmin = t.withIdentity({subject: adminId});
      const staleQrResult = await asAdmin.mutation(
        api.events.check_in.checkIn,
        {
          ticketQrCode: ticketId,
        },
      );
      expect(staleQrResult.success).toBe(false);
      expect(staleQrResult.message).toContain('QR Code has been replaced');

      const newQrResult = await asAdmin.mutation(api.events.check_in.checkIn, {
        ticketQrCode: ticket?.qrCode ?? '',
      });
      expect(newQrResult.success).toBe(true);
      expect(newQrResult.ticket?._id).toBe(ticketId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks repeat transfers until the transfer email action finishes', async () => {
    vi.useFakeTimers();
    const {t, senderId, recipientId, organizerId, ticketId} =
      await seedTransferFixture();
    const nextRecipientId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Next Recipient',
        email: 'next@example.com',
      },
    );
    await t.run(async (ctx) => {
      await addMember(ctx, nextRecipientId, organizerId);
    });
    const sender = t.withIdentity({subject: senderId});

    try {
      await sender.mutation(api.tickets.transfers.transfer, {
        ticketId,
        recipientEmail: 'recipient@example.com',
      });
      const pendingTicket = await t.run((ctx) =>
        ctx.db.get('tickets', ticketId),
      );
      expect(pendingTicket?.transferEmailPendingRecipientId).toBe(recipientId);

      const recipient = t.withIdentity({subject: recipientId});
      await expect(
        recipient.mutation(api.tickets.transfers.transfer, {
          ticketId,
          recipientEmail: 'next@example.com',
        }),
      ).rejects.toThrow(
        'Ticket transfer is still finishing. Try again in a moment.',
      );

      await finishAllScheduledFunctions(t);
      const completedTicket = await t.run((ctx) =>
        ctx.db.get('tickets', ticketId),
      );
      expect(completedTicket?.transferEmailPendingRecipientId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks resale for transferred tickets until holder payout exists', async () => {
    const {t, senderId, recipientId, ticketId} = await seedTransferFixture({
      resaleEnabled: true,
    });
    const sender = t.withIdentity({subject: senderId});
    await sender.mutation(api.tickets.transfers.transfer, {
      ticketId,
      recipientEmail: 'recipient@example.com',
    });

    const recipient = t.withIdentity({subject: recipientId});
    await expect(
      recipient.mutation(api.resale.listings.listTicketForResale, {
        ticketId,
      }),
    ).rejects.toThrow(
      'Tickets without purchase settlement cannot be listed for resale yet',
    );
  });

  it('allows recipients vetted through a trusted community', async () => {
    const {t, senderId, recipientId, organizerId, ticketId} =
      await seedTransferFixture({addRecipientDirectMembership: false});
    const trustedOrganizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Trusted Org',
        status: 'published',
      },
    );
    await t.run(async (ctx) => {
      await addTrustLink(ctx, organizerId, trustedOrganizerId);
      await addMember(ctx, recipientId, trustedOrganizerId);
    });
    const sender = t.withIdentity({subject: senderId});

    await expect(
      sender.mutation(api.tickets.transfers.transfer, {
        ticketId,
        recipientEmail: 'recipient@example.com',
      }),
    ).resolves.toMatchObject({userId: recipientId});
  });

  it('uses one generic error for missing or unvetted recipients', async () => {
    const {t, senderId, ticketId} = await seedTransferFixture();
    const unvettedId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Unvetted',
      email: 'unvetted@example.com',
    });
    expect(unvettedId).toBeTruthy();
    const sender = t.withIdentity({subject: senderId});

    await expect(
      sender.mutation(api.tickets.transfers.validateRecipient, {
        ticketId,
        recipientEmail: 'missing@example.com',
      }),
    ).rejects.toThrow('No vetted member was found for that email.');
    await expect(
      sender.mutation(api.tickets.transfers.validateRecipient, {
        ticketId,
        recipientEmail: 'unvetted@example.com',
      }),
    ).rejects.toThrow('No vetted member was found for that email.');
  });

  it('rejects transfer attempts by non-owners and for non-valid tickets', async () => {
    const {t, senderId, recipientId, ticketId} = await seedTransferFixture();
    const recipient = t.withIdentity({subject: recipientId});

    await expect(
      recipient.mutation(api.tickets.transfers.transfer, {
        ticketId,
        recipientEmail: 'recipient@example.com',
      }),
    ).rejects.toThrow('You can only transfer your own tickets.');

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Test fixture: simulate a previously redeemed ticket state after creating it through seedTicket. */
    await t.run(async (ctx) => {
      await ctx.db.patch('tickets', ticketId, {status: 'used'});
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
    const sender = t.withIdentity({subject: senderId});
    await expect(
      sender.mutation(api.tickets.transfers.transfer, {
        ticketId,
        recipientEmail: 'recipient@example.com',
      }),
    ).rejects.toThrow('Only valid tickets can be transferred.');
  });

  it('blocks transfer while the ticket has an active resale listing', async () => {
    const {t, senderId, recipientId, eventId, ticketId} =
      await seedTransferFixture({resaleEnabled: true});
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Test fixture: create an active resale listing without invoking the full resale workflow. */
    await t.run(async (ctx) => {
      await ctx.db.insert('resale_listings', {
        ticketId,
        eventId,
        sellerId: senderId,
        status: 'listed',
      });
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
    expect(recipientId).toBeTruthy();
    const sender = t.withIdentity({subject: senderId});

    await expect(
      sender.mutation(api.tickets.transfers.transfer, {
        ticketId,
        recipientEmail: 'recipient@example.com',
      }),
    ).rejects.toThrow(
      'Cancel the resale listing before transferring this ticket.',
    );
  });
});
