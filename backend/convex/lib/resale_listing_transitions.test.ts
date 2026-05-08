import {describe, expect, it} from 'vitest';
import {ConvexError} from 'convex/values';
import {RESALE_LISTING_STATUSES} from '@shared/domain/resale-listing-status';
import {
  assertValidListingTransition,
  buildCompletionPatch,
  buildSellerRefundResolvedPatch,
  type ResaleListingStatus,
} from './resale_listing_transitions';

const LEGAL_PAIRS = new Set<`${ResaleListingStatus}->${ResaleListingStatus}`>([
  'listed->pending',
  'listed->cancelled',
  'pending->listed',
  'pending->completed',
]);

describe('assertValidListingTransition', () => {
  it('accepts every legal transition', () => {
    for (const from of RESALE_LISTING_STATUSES) {
      for (const to of RESALE_LISTING_STATUSES) {
        if (LEGAL_PAIRS.has(`${from}->${to}`)) {
          expect(() => assertValidListingTransition(from, to)).not.toThrow();
        }
      }
    }
  });

  it('rejects every illegal transition with INVALID_STATE', () => {
    for (const from of RESALE_LISTING_STATUSES) {
      for (const to of RESALE_LISTING_STATUSES) {
        if (LEGAL_PAIRS.has(`${from}->${to}`)) continue;

        let caught: unknown;
        try {
          assertValidListingTransition(from, to);
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(ConvexError);
        expect((caught as ConvexError<{code: string}>).data.code).toBe(
          'INVALID_STATE',
        );
      }
    }
  });
});

describe('buildCompletionPatch', () => {
  it('overlays cleanly with the resolved refund patch', () => {
    const now = 1_700_000_000_000;
    const merged = {
      ...buildCompletionPatch({
        sellerRefundAmountCents: 1200,
        resaleFeeCents: 100,
        lostProcessingFeeCents: 30,
        now,
      }),
      ...buildSellerRefundResolvedPatch({now}),
    };

    expect(merged).toStrictEqual({
      status: 'completed',
      completedAt: now,
      sellerRefundAmountCents: 1200,
      resaleFeeCents: 100,
      lostProcessingFeeCents: 30,
      sellerRefundState: 'completed',
      sellerRefundAttempts: 0,
      sellerRefundCompletedAt: now,
      sellerRefundFailedAt: null,
      sellerRefundNextRetryAt: null,
      sellerRefundLastError: null,
    });
  });
});
