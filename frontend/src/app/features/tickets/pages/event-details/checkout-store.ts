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
    () => this.activeCheckoutSessionId() !== null,
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
    return (evt.price || 0) / 100;
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
    if (this.isResalePurchase()) {
      this.ticketQuantity.set(1);
      return;
    }

    const max = this.maxTickets();
    this.ticketQuantity.update((q) => Math.max(1, Math.min(max, q + delta)));
  }

  selectTier(tier: TicketTier): void {
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
    const amountCents = Math.round(value * 100);
    this.customAmount.set(amountCents);
    this.slidingScaleError.set(null);
  }

  updateCustomAmountFromInput(value: string): void {
    const val = parseFloat(value);
    const eventData = this.event();
    const tier = this.selectedTier();

    if (!eventData) return;

    if (isNaN(val) || val < 0) {
      this.slidingScaleError.set('Invalid amount');
      return;
    }

    const amountCents = Math.round(val * 100);
    let min: number;
    let max = 0;

    if (tier === 'notaflof') {
      min = eventData.slidingScaleMin || 0;
      max = eventData.slidingScaleMax || 0;
    } else if (tier === 'supporter') {
      min = eventData.supporterDefaultPrice || (eventData.price || 0) + 100;
    } else {
      return;
    }

    if (amountCents < min) {
      this.slidingScaleError.set(
        `Minimum amount is $${(min / 100).toFixed(2)}`,
      );
      this.customAmount.set(amountCents);
      return;
    }

    if (tier === 'notaflof' && max > 0 && amountCents > max) {
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
