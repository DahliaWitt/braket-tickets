import {describe, it, expect, beforeEach} from 'vitest';
import {signal, provideZonelessChangeDetection} from '@angular/core';
import type {WritableSignal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {CheckoutStore} from './checkout-store';
import {AuthService} from '@/core/services/auth.service';
import {type EventDetail} from '@/core/models/event.types';
import {type Id} from '@convex/_generated/dataModel';

/**
 * Minimal Event stub with the pricing fields the store reads. All other
 * Doc<'events'> fields are defaulted via the cast.
 */
function stubEvent(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    _id: 'event123' as Id<'events'>,
    _creationTime: Date.now(),
    title: 'Test Event',
    price: 2000, // $20
    supporterDefaultPrice: undefined,
    slidingScaleEnabled: true,
    slidingScaleMin: 500, // $5
    slidingScaleMax: 1000, // $10
    organizerPaymentReady: true,
    ...overrides,
  } as EventDetail;
}

describe('CheckoutStore', () => {
  let store: CheckoutStore;
  let event: WritableSignal<EventDetail | null>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        CheckoutStore,
        {
          provide: AuthService,
          useValue: {email: () => null, user: () => null},
        },
      ],
    });
    store = TestBed.inject(CheckoutStore);
    event = signal<EventDetail | null>(stubEvent());
    store.bind({
      event,
      remainingTickets: signal<number | null>(null),
      userTicketCount: signal(0),
      resaleEnabled: signal(false),
      resaleAvailable: signal(0),
      isSoldOut: signal(false),
    });
  });

  describe('m23 — community/sliding-scale bounds (frontend/backend parity)', () => {
    it('blocks an over-max slider amount and keeps the validation error set', () => {
      store.selectTier('notaflof');
      // Slider offers up to communitySliderMax; a value above slidingScaleMax
      // ($10) must be rejected exactly as the backend validator rejects it.
      store.updateCustomAmountFromSlider(15); // $15 > $10 max

      expect(store.slidingScaleError()).toBe('Maximum for community tier is $10.00');
      expect(store.customAmount()).toBe(1500);
    });

    it('does not clear a legitimate error when the slider re-fires with the same bad value', () => {
      store.selectTier('notaflof');
      store.updateCustomAmountFromInput('15'); // sets the max error
      expect(store.slidingScaleError()).not.toBeNull();

      // Regression guard: the slider path used to unconditionally clear the
      // error. It must not resurrect a submittable state for an invalid amount.
      store.updateCustomAmountFromSlider(15);
      expect(store.slidingScaleError()).toBe('Maximum for community tier is $10.00');
    });

    it('blocks a below-min slider amount', () => {
      store.selectTier('notaflof');
      store.updateCustomAmountFromSlider(2); // $2 < $5 min

      expect(store.slidingScaleError()).toBe('Minimum amount is $5.00');
      expect(store.customAmount()).toBe(200);
    });

    it('accepts an in-range slider amount and clears the error', () => {
      store.selectTier('notaflof');
      store.updateCustomAmountFromInput('15'); // error first
      expect(store.slidingScaleError()).not.toBeNull();

      store.updateCustomAmountFromSlider(8); // $8 within [5,10]
      expect(store.slidingScaleError()).toBeNull();
      expect(store.customAmount()).toBe(800);
    });

    it('still enforces the max on the typed input', () => {
      store.selectTier('notaflof');
      store.updateCustomAmountFromInput('12');

      expect(store.slidingScaleError()).toBe('Maximum for community tier is $10.00');
      expect(store.customAmount()).toBe(1200);
    });

    it('caps communitySliderMax at slidingScaleMax so the slider never offers a rejectable amount', () => {
      // price $20, slidingScaleMax $10 → slider tops out at $10, not $20.
      expect(store.communitySliderMax()).toBe(10);
    });

    it('leaves the slider at the price ceiling when no slidingScaleMax is configured', () => {
      event.set(stubEvent({slidingScaleMax: undefined}));
      expect(store.communitySliderMax()).toBe(20);
    });
  });

  describe('m25 — lock engages when session creation starts', () => {
    it('is unlocked before any session activity', () => {
      expect(store.checkoutLocked()).toBe(false);
    });

    it('locks the moment session creation begins, before the session id lands', () => {
      store.beginSessionCreation();
      expect(store.checkoutLocked()).toBe(true);
      expect(store.activeCheckoutSessionId()).toBeNull();
    });

    it('stays locked once the active session id is set, after the in-flight flag clears', () => {
      store.beginSessionCreation();
      store.setActiveCheckoutSession({
        orderId: 'order_1',
        stripeCheckoutSessionId: 'cs_1',
        connectedAccountId: null,
      });
      store.endSessionCreation();
      expect(store.checkoutLocked()).toBe(true);
    });

    it('releases the lock when session creation ends without a session id', () => {
      store.beginSessionCreation();
      store.endSessionCreation();
      expect(store.checkoutLocked()).toBe(false);
    });

    it('clears the in-flight lock on error/reset paths', () => {
      store.beginSessionCreation();
      store.setPaymentError('boom');
      expect(store.checkoutLocked()).toBe(false);

      store.beginSessionCreation();
      store.retryPayment();
      expect(store.checkoutLocked()).toBe(false);

      store.beginSessionCreation();
      store.closeCheckout();
      expect(store.checkoutLocked()).toBe(false);
    });
  });
});
