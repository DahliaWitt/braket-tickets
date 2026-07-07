import {describe, expect, it, vi} from 'vitest';
import {
  createAutoDrainConvexTest,
  finishAllScheduledFunctions,
} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Doc, Id} from '../_generated/dataModel';

const convexTest = createAutoDrainConvexTest();
type TestHarness = ReturnType<typeof convexTest>;

const TICKET_PRICE_CENTS = 2500;

async function createUser(
  t: TestHarness,
  name: string,
  email: string,
): Promise<Id<'users'>> {
  return await t.mutation(api.testing.users.createUserDirectly, {name, email});
}

async function createRootAdmin(
  t: TestHarness,
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
  t: TestHarness,
  overrides: Partial<{
    totalTickets: number;
    resaleEnabled: boolean;
    supporterDefaultPrice: number;
  }> = {},
): Promise<{eventId: Id<'events'>; organizerId: Id<'organizers'>}> {
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Catchup Test Organizer',
    isPlatformOrganizer: true,
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: 'Catchup Test Event',
    price: TICKET_PRICE_CENTS,
    totalTickets: overrides.totalTickets ?? 10,
    maxTicketsPerUser: 4,
    date: '2030-12-15',
    visibility: 'public',
    ticketSalesStatus: 'active',
    resaleEnabled: overrides.resaleEnabled,
    supporterDefaultPrice: overrides.supporterDefaultPrice,
    organizerId,
  });
  return {eventId, organizerId};
}

async function seedTicketHolder(
  t: TestHarness,
  eventId: Id<'events'>,
  email: string,
): Promise<Id<'users'>> {
  const userId = await createUser(t, `Holder ${email}`, email);
  await t.mutation(api.testing.tickets.seedTicket, {
    userId,
    eventId,
    status: 'valid',
    tier: 'regular',
    trustSource: 'open_access',
  });
  return userId;
}

async function sendBroadcastAs(
  t: TestHarness,
  adminId: Id<'users'>,
  eventId: Id<'events'>,
  subject: string,
  message = 'the venue is at 123 secret st.',
): Promise<void> {
  const result = await t
    .withIdentity({subject: adminId})
    .mutation(api.events.broadcasts.send, {eventId, subject, message});
  expect(result.success).toBe(true);
}

/** Completes a real paid primary purchase through the production path. */
async function purchaseTicket(
  t: TestHarness,
  userId: Id<'users'>,
  eventId: Id<'events'>,
  paymentSuffix: string,
): Promise<void> {
  const order = await t
    .withIdentity({subject: userId})
    .mutation(api.orders.core.open, {
      eventId,
      quantity: 1,
      tier: 'regular',
      totalAmount: TICKET_PRICE_CENTS,
    });
  await t.action(internal.orders.core.settlePaidOrderFromStripe, {
    orderId: order.orderId,
    stripePaymentIntentId: `pi_catchup_${paymentSuffix}`,
    stripeChargeId: `ch_catchup_${paymentSuffix}`,
    note: 'broadcast_catchup_test',
  });
}

async function getDeliveryRows(
  t: TestHarness,
  eventId: Id<'events'>,
  email: string,
): Promise<Doc<'eventBroadcastDeliveries'>[]> {
  return await t.run(async (ctx) =>
    ctx.db
      .query('eventBroadcastDeliveries')
      .withIndex('by_event_and_email', (q) =>
        q.eq('eventId', eventId).eq('email', email),
      )
      .collect(),
  );
}

/** Captured emails for a recipient, oldest-first. */
async function getCapturedEmails(
  t: TestHarness,
  to: string,
): Promise<{subject: string}[]> {
  const captured = await t.query(api.testing.email.getSentEmails, {to});
  return [...captured].reverse();
}

describe('broadcast catch-up for late audience joins', () => {
  it('delivers a missed broadcast after a late primary purchase and records a catchup row', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin', 'admin@braket.gay');
    const {eventId} = await createEventWithInventory(t);
    await seedTicketHolder(t, eventId, 'existing-holder@example.com');

    await sendBroadcastAs(t, adminId, eventId, 'Secret Location');

    const buyerId = await createUser(t, 'Late Buyer', 'late-buyer@example.com');
    await purchaseTicket(t, buyerId, eventId, 'late_primary');
    await finishAllScheduledFunctions(t);

    const captured = await getCapturedEmails(t, 'late-buyer@example.com');
    expect(captured).toHaveLength(1);
    expect(captured[0].subject).toBe('Secret Location');

    const rows = await getDeliveryRows(t, eventId, 'late-buyer@example.com');
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('catchup');
  });

  it('does not re-send to a send-time holder who buys another ticket', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin', 'admin@braket.gay');
    const {eventId} = await createEventWithInventory(t);
    const holderId = await seedTicketHolder(
      t,
      eventId,
      'repeat-holder@example.com',
    );

    await sendBroadcastAs(t, adminId, eventId, 'Doors Update');
    await finishAllScheduledFunctions(t);

    await purchaseTicket(t, holderId, eventId, 'repeat_holder');
    await finishAllScheduledFunctions(t);

    const captured = await getCapturedEmails(t, 'repeat-holder@example.com');
    expect(captured).toHaveLength(1);

    const rows = await getDeliveryRows(t, eventId, 'repeat-holder@example.com');
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('send');
  });

  it('delivers a missed broadcast to a resale buyer after settlement', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin', 'admin@braket.gay');
    const sellerId = await createUser(t, 'Seller', 'resale-seller@example.com');
    const buyerId = await createUser(t, 'Buyer', 'resale-buyer@example.com');
    const {eventId} = await createEventWithInventory(t, {
      totalTickets: 1,
      resaleEnabled: true,
      supporterDefaultPrice: 5000,
    });

    const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
      userId: sellerId,
      eventId,
      status: 'valid',
      tier: 'supporter',
      trustSource: 'open_access',
    });
    await t.mutation(api.testing.resale.seedResaleListing, {
      ticketId,
      eventId,
      sellerId,
      status: 'listed',
    });

    await sendBroadcastAs(t, adminId, eventId, 'Resale Era Update');
    await finishAllScheduledFunctions(t);

    const order = await t
      .withIdentity({subject: buyerId})
      .mutation(api.orders.core.openResale, {
        eventId,
        tier: 'supporter',
        totalAmount: 5000,
      });
    await t.action(internal.orders.core.settlePaidOrderFromStripe, {
      orderId: order.orderId,
      stripePaymentIntentId: 'pi_catchup_resale',
      stripeChargeId: 'ch_catchup_resale',
      note: 'broadcast_catchup_test',
    });
    await finishAllScheduledFunctions(t);

    const captured = await getCapturedEmails(t, 'resale-buyer@example.com');
    expect(captured).toHaveLength(1);
    expect(captured[0].subject).toBe('Resale Era Update');

    const rows = await getDeliveryRows(t, eventId, 'resale-buyer@example.com');
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('catchup');
  });

  it('delivers a missed broadcast to a guest added after the send', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin', 'admin@braket.gay');
    const {eventId} = await createEventWithInventory(t);
    await seedTicketHolder(t, eventId, 'existing-holder@example.com');

    await sendBroadcastAs(t, adminId, eventId, 'Guest List Info');
    await finishAllScheduledFunctions(t);

    await t.withIdentity({subject: adminId}).mutation(api.events.guests.add, {
      eventId,
      name: 'Late Guest',
      email: 'Late-Guest@Example.COM',
      type: 'guest',
    });
    await finishAllScheduledFunctions(t);

    // Catch-up normalizes the trigger email before lookup/insert/send.
    const captured = await getCapturedEmails(t, 'late-guest@example.com');
    expect(captured).toHaveLength(1);
    expect(captured[0].subject).toBe('Guest List Info');

    const rows = await getDeliveryRows(t, eventId, 'late-guest@example.com');
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('catchup');
  });

  it('sends multiple missed broadcasts oldest-first and only the still-missing one later', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin One', 'admin1@braket.gay');
    // Distinct admins per send: the broadcastEmail rate limit is keyed
    // per admin+event (1 per 5 minutes).
    const admin2Id = await createRootAdmin(t, 'Admin Two', 'admin2@braket.gay');
    const admin3Id = await createRootAdmin(
      t,
      'Admin Three',
      'admin3@braket.gay',
    );
    const {eventId} = await createEventWithInventory(t);
    await seedTicketHolder(t, eventId, 'existing-holder@example.com');

    await sendBroadcastAs(t, adminId, eventId, 'First Update');
    vi.advanceTimersByTime(10);
    await sendBroadcastAs(t, admin2Id, eventId, 'Second Update');
    await finishAllScheduledFunctions(t);

    const buyerId = await createUser(t, 'Buyer', 'multi-buyer@example.com');
    await purchaseTicket(t, buyerId, eventId, 'multi_first');
    await finishAllScheduledFunctions(t);

    const afterFirstPurchase = await getCapturedEmails(
      t,
      'multi-buyer@example.com',
    );
    expect(afterFirstPurchase.map((email) => email.subject)).toEqual([
      'First Update',
      'Second Update',
    ]);

    // Third broadcast goes out while the buyer is already a holder, so it
    // arrives at send time; a second purchase must not re-send anything.
    vi.advanceTimersByTime(10);
    await sendBroadcastAs(t, admin3Id, eventId, 'Third Update');
    await finishAllScheduledFunctions(t);
    await purchaseTicket(t, buyerId, eventId, 'multi_second');
    await finishAllScheduledFunctions(t);

    const afterSecondPurchase = await getCapturedEmails(
      t,
      'multi-buyer@example.com',
    );
    expect(afterSecondPurchase.map((email) => email.subject)).toEqual([
      'First Update',
      'Second Update',
      'Third Update',
    ]);

    const rows = await getDeliveryRows(t, eventId, 'multi-buyer@example.com');
    expect(rows.map((row) => row.origin).sort()).toEqual([
      'catchup',
      'catchup',
      'send',
    ]);
  });

  it('no-ops when the event has no broadcasts', async () => {
    const t = convexTest();
    const {eventId} = await createEventWithInventory(t);

    const buyerId = await createUser(t, 'Buyer', 'quiet-buyer@example.com');
    await purchaseTicket(t, buyerId, eventId, 'no_broadcasts');
    await finishAllScheduledFunctions(t);

    expect(await getCapturedEmails(t, 'quiet-buyer@example.com')).toHaveLength(
      0,
    );
    expect(
      await getDeliveryRows(t, eventId, 'quiet-buyer@example.com'),
    ).toHaveLength(0);
  });

  it('is idempotent when deliverMissed runs twice for the same email', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin', 'admin@braket.gay');
    const {eventId} = await createEventWithInventory(t);
    await seedTicketHolder(t, eventId, 'existing-holder@example.com');

    await sendBroadcastAs(t, adminId, eventId, 'Run Twice');
    await finishAllScheduledFunctions(t);

    const lateId = await createUser(t, 'Late', 'double-run@example.com');
    await t.mutation(internal.events.broadcasts.deliverMissed, {
      eventId,
      email: 'double-run@example.com',
      userId: lateId,
    });
    await t.mutation(internal.events.broadcasts.deliverMissed, {
      eventId,
      email: 'double-run@example.com',
      userId: lateId,
    });
    await finishAllScheduledFunctions(t);

    expect(await getCapturedEmails(t, 'double-run@example.com')).toHaveLength(
      1,
    );
    expect(
      await getDeliveryRows(t, eventId, 'double-run@example.com'),
    ).toHaveLength(1);
  });

  it('skips scheduling for guests without email and tolerates blank trigger emails', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin', 'admin@braket.gay');
    const {eventId} = await createEventWithInventory(t);
    await seedTicketHolder(t, eventId, 'existing-holder@example.com');

    await sendBroadcastAs(t, adminId, eventId, 'No Email Guard');
    await finishAllScheduledFunctions(t);

    await t.withIdentity({subject: adminId}).mutation(api.events.guests.add, {
      eventId,
      name: 'No Email Guest',
      type: 'guest',
    });
    // Blank email must normalize to null and no-op instead of crashing.
    await t.mutation(internal.events.broadcasts.deliverMissed, {
      eventId,
      email: '   ',
    });
    await finishAllScheduledFunctions(t);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcastDeliveries')
        .withIndex('by_event_and_email', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    // Only the send-time row for the existing holder.
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('send');
  });

  it('records origin "send" delivery rows for every send-time recipient', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin', 'admin@braket.gay');
    const {eventId} = await createEventWithInventory(t);
    await seedTicketHolder(t, eventId, 'holder-one@example.com');
    await seedTicketHolder(t, eventId, 'holder-two@example.com');
    await t.withIdentity({subject: adminId}).mutation(api.events.guests.add, {
      eventId,
      name: 'Send Time Guest',
      email: 'Send-Guest@Example.COM',
      type: 'guest',
    });
    await finishAllScheduledFunctions(t);

    await sendBroadcastAs(t, adminId, eventId, 'Send Time Rows');
    await finishAllScheduledFunctions(t);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcastDeliveries')
        .withIndex('by_event_and_email', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(rows.every((row) => row.origin === 'send')).toBe(true);
    expect(rows.map((row) => row.email).sort()).toEqual([
      'holder-one@example.com',
      'holder-two@example.com',
      // Normalized by the audience builder before the row insert.
      'send-guest@example.com',
    ]);
  });

  it('backfills delivery rows from emailDeliveries idempotently, skipping bad rows', async () => {
    const t = convexTest();
    const adminId = await createRootAdmin(t, 'Admin', 'admin@braket.gay');
    const {eventId} = await createEventWithInventory(t);
    await seedTicketHolder(t, eventId, 'existing-holder@example.com');

    await sendBroadcastAs(t, adminId, eventId, 'Backfill Source');
    await finishAllScheduledFunctions(t);

    const broadcast = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcasts')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );
    expect(broadcast).not.toBeNull();
    const broadcastId = broadcast!._id;

    const recordDeliveryBase = {
      critical: false,
      manual: false,
      fallback: false,
      provider: 'smtp' as const,
    };
    // Pre-feature recipient known only via emailDeliveries.
    await t.mutation(internal.email.email_delivery.recordDelivery, {
      ...recordDeliveryBase,
      emailId: 'em_backfill_legacy',
      source: 'broadcast',
      sourceId: broadcastId as string,
      recipient: ' Legacy-Holder@Example.COM ',
    });
    // Already covered by the send-time row — must not duplicate.
    await t.mutation(internal.email.email_delivery.recordDelivery, {
      ...recordDeliveryBase,
      emailId: 'em_backfill_existing',
      source: 'broadcast',
      sourceId: broadcastId as string,
      recipient: 'existing-holder@example.com',
    });
    // Not a broadcast — must be ignored.
    await t.mutation(internal.email.email_delivery.recordDelivery, {
      ...recordDeliveryBase,
      emailId: 'em_backfill_ticket',
      source: 'ticket',
      sourceId: broadcastId as string,
      recipient: 'ticket-buyer@example.com',
    });
    // Unresolvable broadcast id — must be skipped without crashing.
    await t.mutation(internal.email.email_delivery.recordDelivery, {
      ...recordDeliveryBase,
      emailId: 'em_backfill_bad_id',
      source: 'broadcast',
      sourceId: 'not-a-valid-id',
      recipient: 'bad-id@example.com',
    });

    const runBackfill = async () =>
      t.mutation(internal.migrations.backfillEventBroadcastDeliveries, {
        cursor: null,
        dryRun: false,
        batchSize: 100,
        oneBatchOnly: true,
      });
    await runBackfill();

    const legacyDelivery = await t.run(async (ctx) =>
      ctx.db
        .query('emailDeliveries')
        .withIndex('by_emailId', (q) => q.eq('emailId', 'em_backfill_legacy'))
        .first(),
    );
    const rowsAfterFirstRun = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcastDeliveries')
        .withIndex('by_event_and_email', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(rowsAfterFirstRun).toHaveLength(2);
    const legacyRow = rowsAfterFirstRun.find(
      (row) => row.email === 'legacy-holder@example.com',
    );
    expect(legacyRow?.origin).toBe('backfill');
    expect(legacyRow?.sentAt).toBe(legacyDelivery?.sentAt);
    const holderRow = rowsAfterFirstRun.find(
      (row) => row.email === 'existing-holder@example.com',
    );
    expect(holderRow?.origin).toBe('send');

    await runBackfill();
    const rowsAfterSecondRun = await t.run(async (ctx) =>
      ctx.db
        .query('eventBroadcastDeliveries')
        .withIndex('by_event_and_email', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(rowsAfterSecondRun).toHaveLength(2);
  });
});
