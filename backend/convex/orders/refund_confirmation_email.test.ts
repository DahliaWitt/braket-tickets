import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Doc, Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';

/**
 * Buyer refund confirmation emails (CUJ 6.9 step 5).
 *
 * All refund state application funnels through
 * `internal.orders.core.applyExternalRefund` — admin refund actions call it
 * after Stripe accepts the refund, and the `charge.refunded` webhook calls it
 * for external/dashboard refunds. The confirmation email is enqueued inside
 * that mutation, deduplicated on the Stripe refund id (or cancelled-ticket
 * count for zero-dollar refunds).
 *
 * Connect routing note: connected-account vs platform refunds differ only in
 * how `executeStoredProcessorRefund` targets Stripe (covered in
 * payments/refund_processing.test.ts); the applied refund args — and
 * therefore the email — are identical, which the connect-ledger-fields test
 * below pins down.
 */

async function createUser(
  t: ReturnType<typeof convexTest>,
  name: string,
  email: string,
): Promise<Id<'users'>> {
  return await t.mutation(api.testing.users.createUserDirectly, {name, email});
}

async function createRootAdmin(
  t: ReturnType<typeof convexTest>,
  name: string,
  email: string,
): Promise<Id<'users'>> {
  return await t.mutation(api.testing.users.createUserDirectly, {
    name,
    email,
    isRootAdmin: true,
  });
}

async function createEventWithInventory(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<{title: string; price: number; totalTickets: number}> = {},
): Promise<{eventId: Id<'events'>; organizerId: Id<'organizers'>}> {
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Refund Test Organizer',
    isPlatformOrganizer: true,
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: overrides.title ?? 'Refund Test Event',
    price: overrides.price ?? 2500,
    totalTickets: overrides.totalTickets ?? 10,
    maxTicketsPerUser: 4,
    date: '2030-12-15',
    visibility: 'public',
    ticketSalesStatus: 'active',
    organizerId,
  });
  return {eventId, organizerId};
}

async function settlePaidOrder(
  t: ReturnType<typeof convexTest>,
  buyerId: Id<'users'>,
  eventId: Id<'events'>,
  args: {quantity: number; totalAmount: number; piSuffix: string},
): Promise<Id<'ticket_orders'>> {
  const asBuyer = t.withIdentity({subject: buyerId});
  const order = await asBuyer.mutation(api.orders.core.open, {
    eventId,
    quantity: args.quantity,
    tier: 'regular',
    totalAmount: args.totalAmount,
  });
  await t.action(internal.orders.core.settlePaidOrderFromStripe, {
    orderId: order.orderId,
    stripePaymentIntentId: `pi_${args.piSuffix}`,
    stripeChargeId: `ch_${args.piSuffix}`,
    note: 'initial_payment',
  });
  return order.orderId;
}

async function getOrderTickets(
  t: ReturnType<typeof convexTest>,
  orderId: Id<'ticket_orders'>,
): Promise<Array<Doc<'tickets'>>> {
  return await t.run(async (ctx) =>
    ctx.db
      .query('tickets')
      .withIndex('by_order', (q) => q.eq('orderId', orderId))
      .collect(),
  );
}

async function getRefundEmails(
  t: ReturnType<typeof convexTest>,
  to: string,
): Promise<Array<{subject: string; html: string}>> {
  const emails = await t.query(api.testing.email.getSentEmails, {to});
  return emails.filter((email) =>
    email.subject.toLowerCase().includes('refund'),
  );
}

describe('refund confirmation emails', () => {
  const originalIsTest = process.env['IS_TEST'];

  beforeEach(() => {
    process.env['IS_TEST'] = 'true';
  });

  afterEach(() => {
    if (originalIsTest === undefined) {
      delete process.env['IS_TEST'];
    } else {
      process.env['IS_TEST'] = originalIsTest;
    }
  });

  it('standard order refund emails the buyer once with partial singular copy', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin', 'admin-std@example.com');
    const buyerEmail = 'std-buyer@example.com';
    const buyerId = await createUser(t, 'Std Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t, {
      title: 'Standard Refund Event',
    });
    const orderId = await settlePaidOrder(t, buyerId, eventId, {
      quantity: 2,
      totalAmount: 5000,
      piSuffix: 'std_refund',
    });

    // One ticket checked in: the standard refund preserves it, so this stays
    // a partial refund of the remaining valid ticket.
    const tickets = await getOrderTickets(t, orderId);
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates a checked-in ticket without the scanner flow
      await ctx.db.patch('tickets', tickets[0]!._id, {status: 'used'});
    });

    await t
      .withIdentity({subject: adminId})
      .action(api.payments.refunds.refund, {orderId});

    const refundEmails = await getRefundEmails(t, buyerEmail);
    expect(refundEmails).toHaveLength(1);
    expect(refundEmails[0]!.subject).toBe(
      'Your partial refund for Standard Refund Event',
    );
    expect(refundEmails[0]!.html).toContain('$25.00 USD');
    expect(refundEmails[0]!.html).toContain(
      'Your ticket has been cancelled and can no longer be used for entry.',
    );
    expect(refundEmails[0]!.html).toContain('5–10 business days');
    expect(refundEmails[0]!.html).toContain('Standard Refund Event');
  });

  it('force-refund-all emails a full-refund confirmation for the remaining balance', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(
      t,
      'Admin',
      'admin-force@example.com',
    );
    const buyerEmail = 'force-buyer@example.com';
    const buyerId = await createUser(t, 'Force Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t, {
      title: 'Force Refund Event',
    });
    const orderId = await settlePaidOrder(t, buyerId, eventId, {
      quantity: 2,
      totalAmount: 5000,
      piSuffix: 'force_refund',
    });
    const tickets = await getOrderTickets(t, orderId);
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates a checked-in ticket without the scanner flow
      await ctx.db.patch('tickets', tickets[0]!._id, {status: 'used'});
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await asAdmin.action(api.payments.refunds.refund, {orderId});
    await asAdmin.action(api.payments.refunds.forceRefundAll, {orderId});

    const refundEmails = await getRefundEmails(t, buyerEmail);
    expect(refundEmails).toHaveLength(2);
    const forceEmail = refundEmails.find((email) =>
      email.subject.startsWith('Your refund for'),
    );
    expect(forceEmail).toBeDefined();
    expect(forceEmail!.subject).toBe('Your refund for Force Refund Event');
    expect(forceEmail!.html).toContain('full refund');
    expect(forceEmail!.html).toContain('$25.00 USD');
    expect(forceEmail!.html).toContain(
      'Your ticket has been cancelled and can no longer be used for entry.',
    );
  });

  it('single-ticket refund emails partial singular copy for the exact ticket', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(
      t,
      'Admin',
      'admin-single@example.com',
    );
    const buyerEmail = 'single-buyer@example.com';
    const buyerId = await createUser(t, 'Single Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t, {
      title: 'Single Ticket Event',
    });
    const orderId = await settlePaidOrder(t, buyerId, eventId, {
      quantity: 2,
      totalAmount: 5000,
      piSuffix: 'single_refund',
    });
    const tickets = await getOrderTickets(t, orderId);

    await t
      .withIdentity({subject: adminId})
      .action(api.payments.refunds.refundTicket, {
        ticketId: tickets[0]!._id,
      });

    const refundEmails = await getRefundEmails(t, buyerEmail);
    expect(refundEmails).toHaveLength(1);
    expect(refundEmails[0]!.subject).toBe(
      'Your partial refund for Single Ticket Event',
    );
    expect(refundEmails[0]!.html).toContain('$25.00 USD');
    expect(refundEmails[0]!.html).toContain(
      'Your ticket has been cancelled and can no longer be used for entry.',
    );
  });

  it('zero-dollar free-claim refund emails free-ticket copy without settlement timing', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin', 'admin-free@example.com');
    const buyerEmail = 'free-buyer@example.com';
    const buyerId = await createUser(t, 'Free Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t, {
      title: 'Free Refund Event',
      price: 0,
    });
    const claim = await t
      .withIdentity({subject: buyerId})
      .mutation(api.orders.core.claimFreeTicket, {
        eventId,
        quantity: 1,
        tier: 'regular',
        idempotencyKey: 'idem-free-refund-claim',
      });

    await t
      .withIdentity({subject: adminId})
      .action(api.payments.refunds.refund, {orderId: claim.orderId});

    const refundEmails = await getRefundEmails(t, buyerEmail);
    expect(refundEmails).toHaveLength(1);
    expect(refundEmails[0]!.subject).toBe('Your refund for Free Refund Event');
    expect(refundEmails[0]!.html).toContain('no charge to send back');
    expect(refundEmails[0]!.html).toContain(
      'Your ticket has been cancelled and can no longer be used for entry.',
    );
    expect(refundEmails[0]!.html).not.toContain('5–10 business days');
  });

  it('external webhook refunds email the buyer, including connect ledger fields', async () => {
    const t = convexTest();
    const buyerEmail = 'webhook-buyer@example.com';
    const buyerId = await createUser(t, 'Webhook Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t, {
      title: 'External Refund Event',
    });
    const orderId = await settlePaidOrder(t, buyerId, eventId, {
      quantity: 2,
      totalAmount: 5000,
      piSuffix: 'ext_refund',
    });

    // Mirrors handleChargeRefunded's mutation call for a connected-account
    // (direct charge) refund; platform refunds pass the same shape without
    // the connect ledger fields and are covered by the admin-action tests.
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_external_1',
      ledgerRefundAmountCents: 5000,
      stripeEventId: 'evt_external_1',
      processorFeeCents: 175,
      platformFeeCents: 250,
      connectedAccountNetCents: -4575,
    });

    const refundEmails = await getRefundEmails(t, buyerEmail);
    expect(refundEmails).toHaveLength(1);
    expect(refundEmails[0]!.subject).toBe(
      'Your refund for External Refund Event',
    );
    expect(refundEmails[0]!.html).toContain('$50.00 USD');
    expect(refundEmails[0]!.html).toContain(
      '2 tickets have been cancelled and can no longer be used for entry.',
    );
  });

  it('duplicate webhook delivery of the same refund sends exactly one email', async () => {
    const t = convexTest();
    const buyerEmail = 'dup-buyer@example.com';
    const buyerId = await createUser(t, 'Dup Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t);
    const orderId = await settlePaidOrder(t, buyerId, eventId, {
      quantity: 2,
      totalAmount: 5000,
      piSuffix: 'dup_refund',
    });

    const webhookArgs = {
      orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_dup_1',
      ledgerRefundAmountCents: 5000,
      stripeEventId: 'evt_dup_1',
    };
    await t.mutation(internal.orders.core.applyExternalRefund, webhookArgs);
    await t.mutation(internal.orders.core.applyExternalRefund, webhookArgs);

    expect(await getRefundEmails(t, buyerEmail)).toHaveLength(1);
  });

  it('re-applying the same refund id with an explicit ticket list is deduplicated', async () => {
    const t = convexTest();
    const buyerEmail = 'echo-buyer@example.com';
    const buyerId = await createUser(t, 'Echo Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t);
    const orderId = await settlePaidOrder(t, buyerId, eventId, {
      quantity: 2,
      totalAmount: 5000,
      piSuffix: 'echo_refund',
    });
    const tickets = await getOrderTickets(t, orderId);
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates a checked-in ticket without the scanner flow
      await ctx.db.patch('tickets', tickets[0]!._id, {status: 'used'});
    });

    // Webhook applies the refund first (auto-selects only valid tickets).
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_echo_1',
      ledgerRefundAmountCents: 5000,
    });
    // A late application of the SAME Stripe refund with an explicit ticket
    // list (the admin action landing after its own webhook echo) still
    // cancels the listed ticket but must not send a second confirmation.
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_echo_1',
      ticketIdsToRefund: [tickets[0]!._id],
    });

    expect(await getRefundEmails(t, buyerEmail)).toHaveLength(1);
  });

  it('admin refund followed by its webhook echo sends exactly one email', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin', 'admin-echo@example.com');
    const buyerEmail = 'admin-echo-buyer@example.com';
    const buyerId = await createUser(t, 'Admin Echo Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t);
    const orderId = await settlePaidOrder(t, buyerId, eventId, {
      quantity: 2,
      totalAmount: 5000,
      piSuffix: 'admin_echo',
    });

    await t
      .withIdentity({subject: adminId})
      .action(api.payments.refunds.refund, {orderId});

    const stripeRefundId = await t.run(async (ctx) => {
      const financialEvents = await ctx.db
        .query('order_financial_events')
        .withIndex('by_order', (q) => q.eq('orderId', orderId))
        .collect();
      return financialEvents.find((row) => row.kind === 'payment_refunded')
        ?.stripeRefundId;
    });
    expect(stripeRefundId).toBeDefined();

    // Stripe's charge.refunded webhook echoes the refund the action created.
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 5000,
      stripeRefundId,
      ledgerRefundAmountCents: 5000,
      stripeEventId: 'evt_admin_echo',
    });

    expect(await getRefundEmails(t, buyerEmail)).toHaveLength(1);
  });

  it('sequential partial refunds each get their own confirmation', async () => {
    const t = convexTest();
    const buyerEmail = 'seq-buyer@example.com';
    const buyerId = await createUser(t, 'Seq Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t);
    const orderId = await settlePaidOrder(t, buyerId, eventId, {
      quantity: 2,
      totalAmount: 5000,
      piSuffix: 'seq_refund',
    });

    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 2500,
      stripeRefundId: 're_seq_1',
      ledgerRefundAmountCents: 2500,
    });
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_seq_2',
      ledgerRefundAmountCents: 2500,
    });

    const refundEmails = await getRefundEmails(t, buyerEmail);
    expect(refundEmails).toHaveLength(2);
    const partial = refundEmails.filter((email) =>
      email.subject.startsWith('Your partial refund for'),
    );
    const full = refundEmails.filter((email) =>
      email.subject.startsWith('Your refund for'),
    );
    expect(partial).toHaveLength(1);
    expect(full).toHaveLength(1);
    for (const email of refundEmails) {
      expect(email.html).toContain('$25.00 USD');
    }
  });

  it('guest orders email the guest session address', async () => {
    const t = convexTest();
    const guestEmail = 'refund-guest@example.com';
    const now = Date.now();
    const {eventId} = await createEventWithInventory(t, {
      title: 'Guest Refund Event',
    });
    const guestSessionId = await t.mutation(
      api.testing.guest_sessions.seedGuestSession,
      {
        email: guestEmail,
        clientKey: 'refund-guest-client',
        sessionToken: 'refund-guest-token',
        expiresAt: now + 24 * 60 * 60 * 1000,
        lastActiveAt: now,
      },
    );
    // seedPayment requires a userId arg, but insertSeedOrder clears it when
    // guestSessionId is set, so the order is guest-owned.
    const orderId = await t.mutation(api.testing.orders.seedPayment, {
      userId: await createUser(t, 'Placeholder', 'ph@example.com'),
      eventId,
      amount: 2500,
      quantity: 1,
      status: 'completed',
      tier: 'regular',
      guestSessionId,
      stripePaymentIntentId: 'pi_guest_refund',
      trustSource: 'open_access',
    });

    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 2500,
      stripeRefundId: 're_guest_1',
      ledgerRefundAmountCents: 2500,
    });

    const refundEmails = await getRefundEmails(t, guestEmail);
    expect(refundEmails).toHaveLength(1);
    expect(refundEmails[0]!.subject).toBe('Your refund for Guest Refund Event');
  });

  it('missing recipient skips the email without failing refund state application', async () => {
    const t = convexTest();
    const buyerEmail = 'vanished-buyer@example.com';
    const buyerId = await createUser(t, 'Vanished Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t);
    const orderId = await settlePaidOrder(t, buyerId, eventId, {
      quantity: 1,
      totalAmount: 2500,
      piSuffix: 'vanished_refund',
    });

    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates an order whose owning user row is gone
      await ctx.db.delete('users', buyerId);
    });

    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 2500,
      stripeRefundId: 're_vanished_1',
      ledgerRefundAmountCents: 2500,
    });

    const tickets = await getOrderTickets(t, orderId);
    expect(
      tickets.filter((ticket) => ticket.status === 'refunded'),
    ).toHaveLength(1);
    expect(await getRefundEmails(t, buyerEmail)).toHaveLength(0);
  });

  it('zero-dollar refunds of separate free tickets are not cross-deduplicated', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(
      t,
      'Admin',
      'admin-free-seq@example.com',
    );
    const buyerEmail = 'free-seq-buyer@example.com';
    const buyerId = await createUser(t, 'Free Seq Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t, {price: 0});
    const claim = await t
      .withIdentity({subject: buyerId})
      .mutation(api.orders.core.claimFreeTicket, {
        eventId,
        quantity: 2,
        tier: 'regular',
        idempotencyKey: 'idem-free-seq-claim',
      });
    const tickets = await getOrderTickets(t, claim.orderId);
    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.action(api.payments.refunds.refundTicket, {
      ticketId: tickets[0]!._id,
    });
    await asAdmin.action(api.payments.refunds.refundTicket, {
      ticketId: tickets[1]!._id,
    });

    expect(await getRefundEmails(t, buyerEmail)).toHaveLength(2);
  });
});
