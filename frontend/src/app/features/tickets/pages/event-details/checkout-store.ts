import {computed, inject, Injectable, signal, type Signal} from '@angular/core';
import {AuthService} from '@/core/services/auth.service';
import {type EventDetail} from '@/core/models/event.types';
import type {TicketTier} from '@shared/domain/ticket-tier';

interface CheckoutSources {
  event: Signal<EventDetail | null>;
  remainingTickets: Signal<number | null>;
  userTicketCount: Signal<number>;
  resaleEnabled: Signal<boolean>;
  resaleAvailable: Signal<number>;
  isSoldOut: Signal<boolean>;
}

@Injectable()
export class CheckoutStore {
  private readonly auth = inject(AuthService);
  private readonly sources = signal<CheckoutSources | null>(null);

  readonly paymentStatus = signal<'idle' | 'processing' | 'success' | 'error'>(
    'idle',
  );
  readonly paymentErrorMessage = signal<string | null>(null);
  readonly ticketQuantity = signal<number>(1);
  readonly selectedTier = signal<TicketTier>('regular');
  readonly customAmount = signal<number>(0);
  readonly slidingScaleError = signal<string | null>(null);
  readonly guestEmail = signal<string | null>(null);
  readonly guestSessionToken = signal<string | null>(null);
  readonly activeOrderId = signal<string | null>(null);
  readonly activeCheckoutSessionId = signal<string | null>(null);
  readonly activeConnectedAccountId = signal<string | null>(null);
  /**
   * Number of in-flight checkout-session creations (order open + Stripe session
   * round trip). The priced selection must lock the instant creation begins —
   * not only once the session id lands — otherwise the buyer can change
   * quantity/tier/amount mid-flight and the displayed "Total Due" diverges from
   * what Stripe actually charges.
   *
   * A counter (not a boolean) so an orphaned/stale creation's `endSession
   * creation` cannot release the lock a newer, still-in-flight creation is
   * holding (e.g. a remount via stripeResetKey while the previous fetch is
   * pending). begin/end are the sole owners; every begin is paired with an end
   * in a `finally`, so the counter self-balances.
   */
  private readonly sessionCreationCount = signal<number>(0);
  readonly sessionCreationInFlight = computed(
    () => this.sessionCreationCount() > 0,
  );
  readonly stripeResetKey = signal<number>(0);
  readonly guestTermsAccepted = signal<boolean>(false);

  readonly event = computed(() => this.sources()?.event() ?? null);
  readonly isResalePurchase = computed(
    () =>
      (this.sources()?.isSoldOut() ?? false) &&
      (this.sources()?.resaleEnabled() ?? false) &&
      (this.sources()?.resaleAvailable() ?? 0) > 0,
  );
  readonly checkoutQuantity = computed(() =>
    this.isResalePurchase() ? 1 : this.ticketQuantity(),
  );
  readonly totalAmount = computed(() => {
    const evt = this.event();
    if (!evt) return 0;

    const unitPrice =
      this.selectedTier() === 'regular' ? evt.price : this.customAmount();

    return unitPrice * this.checkoutQuantity();
  });
  readonly checkoutLocked = computed(
    () =>
      this.activeCheckoutSessionId() !== null || this.sessionCreationInFlight(),
  );
  readonly buyerEmail = computed(() => this.auth.email() ?? this.guestEmail());
  readonly maxTickets = computed(() => {
    const evt = this.event();
    const sources = this.sources();
    const remaining = sources?.remainingTickets() ?? null;
    const limit = evt?.maxTicketsPerUser ?? 4;
    const currentOwned = sources?.userTicketCount() ?? 0;
    const canBuyMore = Math.max(0, limit - currentOwned);

    if (remaining === null) {
      return canBuyMore;
    }

    return Math.min(canBuyMore, remaining);
  });
  readonly isAtMaxTickets = computed(
    () => this.ticketQuantity() >= this.maxTickets(),
  );
  readonly supporterSliderMax = computed(() => {
    const evt = this.event();
    if (!evt) return 200;
    const base = (evt.supporterDefaultPrice || evt.price || 4000) / 100;
    return Math.max(base * 3, 200);
  });
  readonly communitySliderMax = computed(() => {
    const evt = this.event();
    if (!evt) return 100;
    const priceDollars = (evt.price || 0) / 100;
    // The community/sliding-scale slider must never offer an amount the backend
    // rejects. validateTierPricing (backend/convex/lib/payments/pricing.ts)
    // throws when unitPrice > slidingScaleMax, so cap the slider at the
    // configured max when one exists. slidingScaleMax is optional (undefined =
    // no ceiling), mirroring the backend's `!== undefined` guard.
    const maxCents = evt.slidingScaleMax;
    if (maxCents === undefined) return priceDollars;
    return Math.min(priceDollars, maxCents / 100);
  });

  bind(sources: CheckoutSources): void {
    this.sources.set(sources);
  }

  setGuestSession(email: string, sessionToken: string): void {
    this.guestEmail.set(email);
    this.guestSessionToken.set(sessionToken);
  }

  setGuestTermsAccepted(accepted: boolean): void {
    this.guestTermsAccepted.set(accepted);
  }

  resetPaymentForm(): void {
    const evt = this.event();
    if (!evt) return;

    this.ticketQuantity.set(1);
    this.selectedTier.set('regular');
    this.customAmount.set(evt.price || 0);
    this.slidingScaleError.set(null);
    this.paymentErrorMessage.set(null);
    this.activeOrderId.set(null);
    this.activeCheckoutSessionId.set(null);
    this.activeConnectedAccountId.set(null);
    this.guestEmail.set(null);
    this.guestSessionToken.set(null);
    this.guestTermsAccepted.set(false);
  }

  resetSidebarState(): void {
    this.paymentStatus.set('idle');
    this.paymentErrorMessage.set(null);
    this.guestEmail.set(null);
    this.guestSessionToken.set(null);
    this.activeOrderId.set(null);
    this.activeCheckoutSessionId.set(null);
    this.activeConnectedAccountId.set(null);
    this.guestTermsAccepted.set(false);
  }

  closeCheckout(): void {
    this.guestEmail.set(null);
    this.guestSessionToken.set(null);
    this.activeOrderId.set(null);
    this.activeCheckoutSessionId.set(null);
    this.activeConnectedAccountId.set(null);
    this.guestTermsAccepted.set(false);
    this.stripeResetKey.update((k) => k + 1);
  }

  retryPayment(): void {
    this.paymentStatus.set('idle');
    this.activeOrderId.set(null);
    this.activeCheckoutSessionId.set(null);
    this.activeConnectedAccountId.set(null);
    this.stripeResetKey.update((k) => k + 1);
  }

  setPaymentError(message: string): void {
    this.paymentStatus.set('error');
    this.paymentErrorMessage.set(message);
    this.activeOrderId.set(null);
    this.activeCheckoutSessionId.set(null);
    this.activeConnectedAccountId.set(null);
  }

  /**
   * Engage the checkout lock as soon as session creation starts. Pair every
   * call with {@link endSessionCreation} in a `finally` so the lock releases on
   * error/cancel while a successful `setActiveCheckoutSession` keeps it locked
   * via the active session id.
   */
  beginSessionCreation(): void {
    this.sessionCreationCount.update((n) => n + 1);
  }

  endSessionCreation(): void {
    this.sessionCreationCount.update((n) => Math.max(0, n - 1));
  }

  setActiveCheckoutSession(result: {
    orderId: string;
    stripeCheckoutSessionId: string;
    connectedAccountId: string | null;
  }): void {
    this.activeOrderId.set(result.orderId);
    this.activeCheckoutSessionId.set(result.stripeCheckoutSessionId);
    this.activeConnectedAccountId.set(result.connectedAccountId);
  }

  updateQuantity(delta: number): void {
    // Structural lock: the controls are disabled via checkoutLocked in the
    // template, but a zoneless disabled-state race (a synthetic event landing
    // before the disabled attribute applies) could still fire the handler once
    // a session is being created. Refuse the mutation so the charged amount can
    // never drift from the displayed total.
    if (this.checkoutLocked()) return;

    if (this.isResalePurchase()) {
      this.ticketQuantity.set(1);
      return;
    }

    const max = this.maxTickets();
    this.ticketQuantity.update((q) => Math.max(1, Math.min(max, q + delta)));
  }

  selectTier(tier: TicketTier): void {
    if (this.checkoutLocked()) return;
    if (this.selectedTier() === tier) {
      return;
    }

    this.selectedTier.set(tier);
    this.slidingScaleError.set(null);
    const evt = this.event();
    if (!evt) return;

    if (tier === 'regular') {
      this.customAmount.set(evt.price || 0);
    } else if (tier === 'supporter') {
      const supporterMin = (evt.price || 0) + 100;
      this.customAmount.set(
        Math.max(evt.supporterDefaultPrice || 0, supporterMin),
      );
    } else if (tier === 'notaflof') {
      this.customAmount.set(evt.slidingScaleMin || 0);
    }
  }

  updateCustomAmountFromSlider(value: number): void {
    if (this.checkoutLocked()) return;
    // The slider path previously set the amount and cleared the error
    // unconditionally, so a slider whose range exceeded slidingScaleMax could
    // submit an amount the backend rejects. Route it through the same
    // validation as the typed input so min/max are always enforced.
    this.applyCustomAmount(Math.round(value * 100));
  }

  updateCustomAmountFromInput(value: string): void {
    if (this.checkoutLocked()) return;
    const val = parseFloat(value);

    if (!this.event()) return;

    if (isNaN(val) || val < 0) {
      this.slidingScaleError.set('Invalid amount');
      return;
    }

    this.applyCustomAmount(Math.round(val * 100));
  }

  /**
   * Single source of truth for custom-amount (supporter / community) bounds
   * validation, shared by the slider and the typed input. Mirrors the backend
   * validator in backend/convex/lib/payments/pricing.ts:
   * - community (notaflof): min = slidingScaleMin, max = slidingScaleMax
   *   (a ceiling only applies when configured, matching the backend's
   *   `slidingScaleMax !== undefined` guard).
   * - supporter: min = supporterDefaultPrice, falling back to price + $1.00.
   *
   * On an out-of-range value it records the validation error AND stores the
   * amount (so the field reflects what the user chose) without ever clearing a
   * legitimate error — the createCheckoutSession guard then blocks submission.
   */
  private applyCustomAmount(amountCents: number): void {
    const eventData = this.event();
    if (!eventData) return;

    const tier = this.selectedTier();
    let min: number;
    let max: number | null = null;

    if (tier === 'notaflof') {
      min = eventData.slidingScaleMin || 0;
      max = eventData.slidingScaleMax ?? null;
    } else if (tier === 'supporter') {
      // Mirror the backend floor exactly: max(supporterDefaultPrice, price + 1
      // cent). Frontend uses price + $1 (stricter than the backend's +1 cent,
      // so never submittable-but-rejected) and the Math.max guards the case
      // where a configured supporterDefaultPrice sits at/below the regular
      // price — without it the frontend would accept an amount the backend's
      // validateTierPricing rejects. Matches selectTier's supporter floor.
      min = Math.max(
        eventData.supporterDefaultPrice || 0,
        (eventData.price || 0) + 100,
      );
    } else {
      // Regular tier carries no editable custom amount.
      return;
    }

    if (amountCents < min) {
      this.slidingScaleError.set(
        `Minimum amount is $${(min / 100).toFixed(2)}`,
      );
      this.customAmount.set(amountCents);
      return;
    }

    if (max !== null && amountCents > max) {
      this.slidingScaleError.set(
        `Maximum for community tier is $${(max / 100).toFixed(2)}`,
      );
      this.customAmount.set(amountCents);
      return;
    }

    this.slidingScaleError.set(null);
    this.customAmount.set(amountCents);
  }
}
