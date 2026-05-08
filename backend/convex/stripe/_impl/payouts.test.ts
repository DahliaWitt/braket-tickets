import {describe, expect, it} from 'vitest';
import {
  buildPayoutPlan,
  computeEventSettlements,
  type EventSettlement,
  type FinancialEventRow,
} from './payouts';

const EVENT_A = 'evt_a';
const EVENT_B = 'evt_b';
const EVENT_C_FUTURE = 'evt_c_future';

const EVENTS = [
  {_id: EVENT_A, date: 1},
  {_id: EVENT_B, date: 2},
  {_id: EVENT_C_FUTURE, date: 100},
];

function captured(eventId: string, net: number): FinancialEventRow {
  return {eventId, kind: 'payment_captured', connectedAccountNetCents: net};
}

function refunded(eventId: string, net: number): FinancialEventRow {
  return {eventId, kind: 'payment_refunded', connectedAccountNetCents: net};
}

describe('computeEventSettlements', () => {
  it('sums captured and refunded nets per event using BalanceTransaction data', () => {
    const settlements = computeEventSettlements(
      [captured(EVENT_A, 10_000), refunded(EVENT_A, -2_500)],
      EVENTS,
      [],
    );
    const a = settlements.find((s) => s.eventId === EVENT_A)!;
    expect(a.capturedNetCents).toBe(10_000);
    expect(a.refundNetCents).toBe(-2_500);
    expect(a.payableCents).toBe(7_500);
  });

  it('skips rows without connectedAccountNetCents — no estimation', () => {
    const settlements = computeEventSettlements(
      [
        {eventId: EVENT_A, kind: 'payment_captured', connectedAccountNetCents: 1_000},
        {eventId: EVENT_A, kind: 'payment_captured'},
      ],
      EVENTS,
      [],
    );
    const a = settlements.find((s) => s.eventId === EVENT_A)!;
    expect(a.capturedNetCents).toBe(1_000);
  });

  it('ignores status-only kinds like dispute_opened', () => {
    const settlements = computeEventSettlements(
      [
        captured(EVENT_A, 5_000),
        {
          eventId: EVENT_A,
          kind: 'dispute_opened',
          connectedAccountNetCents: -9_999,
        },
      ],
      EVENTS,
      [],
    );
    expect(settlements[0]?.payableCents).toBe(5_000);
  });

  it('buckets dispute_funds_withdrawn and _reinstated under disputeNet', () => {
    const settlements = computeEventSettlements(
      [
        captured(EVENT_A, 10_000),
        {
          eventId: EVENT_A,
          kind: 'dispute_funds_withdrawn',
          connectedAccountNetCents: -4_000,
        },
        {
          eventId: EVENT_A,
          kind: 'dispute_funds_reinstated',
          connectedAccountNetCents: 4_000,
        },
      ],
      EVENTS,
      [],
    );
    const a = settlements.find((s) => s.eventId === EVENT_A)!;
    expect(a.disputeNetCents).toBe(0);
    expect(a.payableCents).toBe(10_000);
  });

  it('subtracts confirmed payout allocations per event', () => {
    const settlements = computeEventSettlements(
      [captured(EVENT_A, 10_000)],
      EVENTS,
      [{eventId: EVENT_A, amountCents: 6_000}],
    );
    expect(settlements[0]?.alreadyPaidOutCents).toBe(6_000);
    expect(settlements[0]?.payableCents).toBe(4_000);
  });

  it('drops events not present in the events list', () => {
    const settlements = computeEventSettlements(
      [captured('evt_unknown', 1_000)],
      EVENTS,
      [],
    );
    expect(settlements).toHaveLength(0);
  });
});

describe('buildPayoutPlan', () => {
  function settlement(
    overrides: Partial<EventSettlement> & Pick<EventSettlement, 'eventId'>,
  ): EventSettlement {
    return {
      eventId: overrides.eventId,
      eventDate: overrides.eventDate ?? 0,
      capturedNetCents: overrides.capturedNetCents ?? 0,
      refundNetCents: overrides.refundNetCents ?? 0,
      disputeNetCents: overrides.disputeNetCents ?? 0,
      alreadyPaidOutCents: overrides.alreadyPaidOutCents ?? 0,
      payableCents: overrides.payableCents ?? 0,
    };
  }

  it('reserves future-event funds and pays the eligible remainder', () => {
    const plan = buildPayoutPlan({
      connectedAccountId: 'acct_test',
      settlements: [
        settlement({eventId: EVENT_A, eventDate: 1, payableCents: 5_000}),
        settlement({
          eventId: EVENT_C_FUTURE,
          eventDate: 100,
          payableCents: 4_000,
        }),
      ],
      eligibleEventIds: new Set([EVENT_A]),
      availableBalanceCents: 10_000,
    });

    expect(plan.reservedCents).toBe(4_000);
    expect(plan.eligibleNetCents).toBe(5_000);
    expect(plan.payableCents).toBe(5_000);
    expect(plan.allocations).toStrictEqual([
      {eventId: EVENT_A, amountCents: 5_000},
    ]);
  });

  it('allocates oldest-first (FIFO by event date)', () => {
    const plan = buildPayoutPlan({
      connectedAccountId: 'acct_test',
      settlements: [
        settlement({eventId: EVENT_B, eventDate: 2, payableCents: 3_000}),
        settlement({eventId: EVENT_A, eventDate: 1, payableCents: 2_000}),
      ],
      eligibleEventIds: new Set([EVENT_A, EVENT_B]),
      availableBalanceCents: 10_000,
    });

    expect(plan.allocations.map((a) => a.eventId)).toStrictEqual([
      EVENT_A,
      EVENT_B,
    ]);
  });

  it('returns zero payable when available balance ≤ reserved', () => {
    const plan = buildPayoutPlan({
      connectedAccountId: 'acct_test',
      settlements: [
        settlement({eventId: EVENT_A, eventDate: 1, payableCents: 5_000}),
        settlement({
          eventId: EVENT_C_FUTURE,
          eventDate: 100,
          payableCents: 4_000,
        }),
      ],
      eligibleEventIds: new Set([EVENT_A]),
      availableBalanceCents: 4_000,
    });

    expect(plan.reservedCents).toBe(4_000);
    expect(plan.payableCents).toBe(0);
    expect(plan.allocations).toStrictEqual([]);
  });

  it('caps each allocation at the event payable when balance is tight', () => {
    const plan = buildPayoutPlan({
      connectedAccountId: 'acct_test',
      settlements: [
        settlement({eventId: EVENT_A, eventDate: 1, payableCents: 5_000}),
        settlement({eventId: EVENT_B, eventDate: 2, payableCents: 5_000}),
      ],
      eligibleEventIds: new Set([EVENT_A, EVENT_B]),
      availableBalanceCents: 7_000,
    });

    expect(plan.payableCents).toBe(7_000);
    expect(plan.allocations).toStrictEqual([
      {eventId: EVENT_A, amountCents: 5_000},
      {eventId: EVENT_B, amountCents: 2_000},
    ]);
  });

  it('skips events with non-positive payables', () => {
    const plan = buildPayoutPlan({
      connectedAccountId: 'acct_test',
      settlements: [
        settlement({eventId: EVENT_A, eventDate: 1, payableCents: 0}),
        settlement({eventId: EVENT_B, eventDate: 2, payableCents: -1_000}),
      ],
      eligibleEventIds: new Set([EVENT_A, EVENT_B]),
      availableBalanceCents: 10_000,
    });

    expect(plan.eligibleEvents).toHaveLength(0);
    expect(plan.payableCents).toBe(0);
  });
});
