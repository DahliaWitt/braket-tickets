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
  overrides: Partial<{
    title: string;
    price: number;
    totalTickets: number;
    resaleEnabled: boolean;
  }> = {},
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
    resaleEnabled: overrides.resaleEnabled,
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
  // Match on the exact subject prefixes: seeded event titles contain the
  // word "Refund", so a substring match would also catch purchase emails.
  return emails.filter(
    (email) =>
      email.subject.startsWith('Your refund for') ||
      email.subject.startsWith('Your partial refund for'),
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

  it('a same-refund-id application that cancels additional tickets sends corrective copy', async () => {
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

    // The force refund's webhook echo lands first: it auto-selects only the
    // valid ticket, so its email reports one cancelled ticket.
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_echo_1',
      ledgerRefundAmountCents: 5000,
    });
    // The admin action's own application of the SAME Stripe refund then
    // cancels the used ticket. Suppressing it would leave the buyer's only
    // email claiming one cancelled ticket while two ended cancelled, so it
    // must send corrective copy for the additional cancellation.
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_echo_1',
      ticketIdsToRefund: [tickets[0]!._id],
    });
    // ...and a true duplicate of that second application stays deduplicated.
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_echo_1',
      ticketIdsToRefund: [tickets[0]!._id],
    });

    const refundEmails = await getRefundEmails(t, buyerEmail);
    expect(refundEmails).toHaveLength(2);
    const corrective = refundEmails.find((email) =>
      email.html.includes('No additional money was sent back for this refund'),
    );
    expect(corrective).toBeDefined();
    expect(corrective!.html).toContain(
      'Your ticket has been cancelled and can no longer be used for entry.',
    );
  });

  it('out-of-order partial refund webhooks yield one coherent final-state email', async () => {
    const t = convexTest();
    const buyerEmail = 'ooo-buyer@example.com';
    const buyerId = await createUser(t, 'OOO Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t, {
      title: 'Out Of Order Event',
    });
    const orderId = await settlePaidOrder(t, buyerId, eventId, {
      quantity: 2,
      totalAmount: 5000,
      piSuffix: 'ooo_refund',
    });

    // Two $25 refunds exist in Stripe; the SECOND one's webhook (cumulative
    // $50) arrives first. The email must describe the state transition it
    // applied — $50 and both tickets — not the individual $25 refund.
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_ooo_2',
      ledgerRefundAmountCents: 2500,
    });
    // The first refund's webhook arrives late with a stale cumulative total
    // and applies nothing new — no second email.
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 2500,
      stripeRefundId: 're_ooo_1',
      ledgerRefundAmountCents: 2500,
    });

    const refundEmails = await getRefundEmails(t, buyerEmail);
    expect(refundEmails).toHaveLength(1);
    expect(refundEmails[0]!.subject).toBe('Your refund for Out Of Order Event');
    expect(refundEmails[0]!.html).toContain('$50.00 USD');
    expect(refundEmails[0]!.html).toContain(
      '2 tickets have been cancelled and can no longer be used for entry.',
    );
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

  it('force-cancelling used tickets after an external full refund never claims a free ticket', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(
      t,
      'Admin',
      'admin-used-force@example.com',
    );
    const buyerEmail = 'used-force-buyer@example.com';
    const buyerId = await createUser(t, 'Used Force Buyer', buyerEmail);
    const {eventId} = await createEventWithInventory(t, {
      title: 'Used Force Event',
    });
    const orderId = await settlePaidOrder(t, buyerId, eventId, {
      quantity: 2,
      totalAmount: 5000,
      piSuffix: 'used_force',
    });
    const tickets = await getOrderTickets(t, orderId);
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- simulates a checked-in ticket without the scanner flow
      await ctx.db.patch('tickets', tickets[0]!._id, {status: 'used'});
    });

    // External dashboard full refund: money fully returned, but the webhook
    // auto-selection preserves the used ticket.
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 5000,
      stripeRefundId: 're_used_force_1',
      ledgerRefundAmountCents: 5000,
    });
    // Admin then force-cancels the surviving used ticket: zero additional
    // money moves on this paid order.
    await t
      .withIdentity({subject: adminId})
      .action(api.payments.refunds.forceRefundAll, {orderId});

    const refundEmails = await getRefundEmails(t, buyerEmail);
    expect(refundEmails).toHaveLength(2);
    // 100% of the money came back, so both are full refunds despite the
    // used ticket surviving the first application.
    for (const email of refundEmails) {
      expect(email.subject).toBe('Your refund for Used Force Event');
    }
    const moneyEmail = refundEmails.find((email) =>
      email.html.includes('$50.00 USD'),
    );
    const cancellationEmail = refundEmails.find((email) =>
      email.html.includes('No additional money was sent back for this refund'),
    );
    expect(moneyEmail).toBeDefined();
    expect(cancellationEmail).toBeDefined();
    expect(cancellationEmail!.html).not.toContain('free ticket');
    expect(cancellationEmail!.html).toContain(
      'Your ticket has been cancelled and can no longer be used for entry.',
    );
  });

  it('money-only refunds on resale-sold orders are suppressed (seller payout race)', async () => {
    const t = convexTest();
    const sellerEmail = 'seller-race@example.com';
    const sellerId = await createUser(t, 'Race Seller', sellerEmail);
    const buyerId = await createUser(t, 'Race Buyer', 'race-buyer@example.com');
    const {eventId} = await createEventWithInventory(t, {resaleEnabled: true});
    const orderId = await settlePaidOrder(t, sellerId, eventId, {
      quantity: 1,
      totalAmount: 2500,
      piSuffix: 'seller_race',
    });
    const tickets = await getOrderTickets(t, orderId);
    // A completed resale sale with the seller payout still in flight: the
    // transfer marks the seller's sold ticket 'refunded' and the listing
    // 'completed' (see applyResaleTicketTransfer); settlement has not yet
    // recorded the payout's financial event.
    await t.mutation(api.testing.resale.seedResaleListing, {
      ticketId: tickets[0]!._id,
      eventId,
      sellerId,
      buyerId,
      status: 'completed',
      sellerRefundAmountCents: 2250,
      resaleFeeCents: 250,
      sellerRefundState: 'pending',
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- mirrors applyResaleTicketTransfer marking the sold ticket refunded, without running the full resale checkout
      await ctx.db.patch('tickets', tickets[0]!._id, {status: 'refunded'});
    });

    // The seller-payout refund's charge.refunded webhook arriving BEFORE the
    // resale settlement records its financial event.
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 2250,
      stripeRefundId: 're_seller_race_1',
      ledgerRefundAmountCents: 2250,
    });

    expect(await getRefundEmails(t, sellerEmail)).toHaveLength(0);
    // Refund state still converges — only the email is suppressed.
    const financialEvents = await t.run(async (ctx) =>
      ctx.db
        .query('order_financial_events')
        .withIndex('by_order', (q) => q.eq('orderId', orderId))
        .collect(),
    );
    expect(financialEvents.some((row) => row.kind === 'payment_refunded')).toBe(
      true,
    );
  });

  it('genuine refunds on orders with settled resale history still email', async () => {
    const t = convexTest();
    const sellerEmail = 'settled-seller@example.com';
    const sellerId = await createUser(t, 'Settled Seller', sellerEmail);
    const buyerId = await createUser(
      t,
      'Settled Buyer',
      'settled-buyer@example.com',
    );
    const {eventId} = await createEventWithInventory(t, {
      title: 'Settled Resale Event',
      resaleEnabled: true,
    });
    const orderId = await settlePaidOrder(t, sellerId, eventId, {
      quantity: 2,
      totalAmount: 5000,
      piSuffix: 'settled_resale',
    });
    const tickets = await getOrderTickets(t, orderId);
    // One ticket was resold and the seller payout fully settled: the
    // listing's sellerRefundState is 'completed' and its financial event is
    // on the ledger.
    await t.mutation(api.testing.resale.seedResaleListing, {
      ticketId: tickets[0]!._id,
      eventId,
      sellerId,
      buyerId,
      status: 'completed',
      sellerRefundAmountCents: 2250,
      resaleFeeCents: 250,
      sellerRefundState: 'completed',
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- mirrors applyResaleTicketTransfer marking the sold ticket refunded, without running the full resale checkout
      await ctx.db.patch('tickets', tickets[0]!._id, {status: 'refunded'});
    });
    await t.mutation(internal.orders.core.recordFinancialEvent, {
      orderId,
      eventId,
      kind: 'payment_refunded',
      amountCents: 2250,
      stripeRefundId: 're_settled_payout',
    });

    // A later GENUINE money-only dashboard refund for part of the remaining
    // charge must not be swallowed by the order's resale history.
    await t.mutation(internal.orders.core.applyExternalRefund, {
      orderId,
      refundedAmountCents: 3250,
      stripeRefundId: 're_settled_genuine',
      ledgerRefundAmountCents: 1000,
    });

    const refundEmails = await getRefundEmails(t, sellerEmail);
    expect(refundEmails).toHaveLength(1);
    expect(refundEmails[0]!.subject).toBe(
      'Your partial refund for Settled Resale Event',
    );
    expect(refundEmails[0]!.html).toContain('$10.00 USD');
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
