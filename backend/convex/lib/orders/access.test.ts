import {describe, expect, it} from 'vitest';
import {assertEventStillFulfillable, assertPurchasableEvent} from './access';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function purchasableEvent(overrides: {date: string; endDate?: string}) {
  return {
    status: 'published' as const,
    ticketSalesStatus: 'active' as const,
    ...overrides,
  };
}

describe('assertPurchasableEvent end-date gating', () => {
  it('allows purchase mid-event when endDate has not passed', () => {
    // Overnight event: started 4 hours ago, ends in 4 hours. Without an
    // endDate this could already be past the midnight fallback cutoff.
    const event = purchasableEvent({
      date: iso(-4 * HOUR_MS),
      endDate: iso(4 * HOUR_MS),
    });

    expect(() => assertPurchasableEvent(event)).not.toThrow();
  });

  it('blocks purchase once endDate has passed', () => {
    const event = purchasableEvent({
      date: iso(-8 * HOUR_MS),
      endDate: iso(-1 * HOUR_MS),
    });

    expect(() => assertPurchasableEvent(event)).toThrow(/already occurred/);
  });

  it('falls back to the day-granularity cutoff without an endDate', () => {
    // Two days ago is unambiguously past the event-local midnight cutoff.
    expect(() =>
      assertPurchasableEvent(purchasableEvent({date: iso(-2 * DAY_MS)})),
    ).toThrow(/already occurred/);

    // Two days out is unambiguously before it.
    expect(() =>
      assertPurchasableEvent(purchasableEvent({date: iso(2 * DAY_MS)})),
    ).not.toThrow();
  });
});

describe('assertEventStillFulfillable end-date gating', () => {
  it('keeps open orders fulfillable through the event window', () => {
    const event = purchasableEvent({
      date: iso(-4 * HOUR_MS),
      endDate: iso(4 * HOUR_MS),
    });

    expect(() => assertEventStillFulfillable(event)).not.toThrow();
  });

  it('blocks fulfillment once endDate has passed', () => {
    const event = purchasableEvent({
      date: iso(-8 * HOUR_MS),
      endDate: iso(-1 * HOUR_MS),
    });

    expect(() => assertEventStillFulfillable(event)).toThrow(
      /already occurred/,
    );
  });
});
