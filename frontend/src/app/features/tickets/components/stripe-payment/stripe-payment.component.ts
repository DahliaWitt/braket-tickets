import {
  Component,
  type ElementRef,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
  ChangeDetectionStrategy,
  InjectionToken,
  type AfterViewInit,
  output,
  input,
  viewChild,
} from '@angular/core';
import {
  loadStripe,
  type Stripe,
  type StripeEmbeddedCheckout,
} from '@stripe/stripe-js';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {logger} from '@/utils/logger';
import {createClickLock} from '@/utils/submit-guard';
import {environment} from '../../../../../environments/environment';
import {createMockStripeJs} from './stripe-payment.mock';

interface EmbeddedCheckoutSession {
  clientSecret: string;
  connectedAccountId?: string | null;
}

type StripeCheckoutClient = Pick<Stripe, 'createEmbeddedCheckoutPage'>;
type LoadStripeFn = typeof loadStripe;

export const STRIPE_JS_LOADER = new InjectionToken<LoadStripeFn>(
  'STRIPE_JS_LOADER',
  {
    providedIn: 'root',
    factory: () => loadStripe,
  },
);

/**
 * Embedded Checkout wrapper for ticket purchases.
 *
 * The parent decides when to open an order and returns a Checkout Session
 * client secret. This component mounts Stripe's managed embedded checkout UI
 * and emits completion/error signals back to the parent.
 */
@Component({
  selector: 'app-stripe-payment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardSkeletonComponent],
  templateUrl: './stripe-payment.component.html',
  styles: [
    `
      :host {
        display: block;
      }

      .embedded-checkout-shell {
        background:
          radial-gradient(
            circle at 12% -12%,
            hsl(var(--primary) / 0.16),
            transparent 34%
          ),
          hsl(var(--background));
        border: 1px solid hsl(var(--border));
        border-radius: 0.75rem;
        overflow: hidden;
      }

      .embedded-checkout-shell [data-testid='stripe-payment-element'] {
        min-height: 36rem;
      }

      :host ::ng-deep .embedded-checkout-shell iframe {
        display: block;
        width: 100% !important;
        border: 0;
        color-scheme: dark;
      }

      @media (max-width: 640px) {
        .embedded-checkout-shell {
          border-inline: 0;
          border-radius: 0;
          margin-inline: -1rem;
        }
      }
    `,
  ],
})
export class StripePaymentComponent implements AfterViewInit {
  private destroyRef = inject(DestroyRef);
  private loadStripe = inject(STRIPE_JS_LOADER);

  readonly publishableKey = input.required<string>();
  /**
   * Increment this key to destroy any mounted embedded checkout and reset
   * the component so the next handlePayment call mounts a fresh session.
   * Used by the parent to clear state when the sidebar closes or the user
   * retries after a failure.
   */
  readonly resetKey = input<number>(0);
  readonly checkoutSessionFetcher =
    input.required<() => Promise<EmbeddedCheckoutSession>>();
  /**
   * Connected account id when the active order is a direct charge on a
   * promoter's Stripe account. Null / undefined for platform-owned
   * events. Threaded into `loadStripe(...)` as `{stripeAccount}` so the
   * embedded Checkout session resolves on the correct account.
   */
  readonly connectedAccountId = input<string | null>(null);
  readonly mockPayments = input<boolean>(false);
  readonly buyerEmail = input<string | null>(null);
  readonly amount = input<number>(0);
  readonly paymentLabel = input<string>('Total');

  paymentConfirmed = output();
  paymentError = output<string>();

  readonly paymentElementContainer = viewChild.required<
    ElementRef<HTMLElement>
  >('paymentElementContainer');

  readonly processing = signal(false);
  readonly isInitializing = signal(false);
  readonly error = signal<string | null>(null);
  readonly isReady = signal(false);
  readonly checkoutMounted = signal(false);

  private stripe: StripeCheckoutClient | null = null;
  private loadedPublishableKey: string | null = null;
  private loadedConnectedAccountId: string | null = null;
  private embeddedCheckout: StripeEmbeddedCheckout | null = null;
  private paymentLock = createClickLock();
  private beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.beforeUnloadHandler) {
        window.removeEventListener(
          'beforeunload',
          this.beforeUnloadHandler,
          true,
        );
        this.beforeUnloadHandler = null;
      }
      this.embeddedCheckout?.destroy();
    });

    effect(() => {
      const key = this.resetKey();
      // Skip the initial value; only destroy on subsequent key increments.
      if (key === 0) return;
      untracked(() => this.destroyEmbeddedCheckout());
    });
  }

  private destroyEmbeddedCheckout(): void {
    if (this.beforeUnloadHandler) {
      window.removeEventListener(
        'beforeunload',
        this.beforeUnloadHandler,
        true,
      );
      this.beforeUnloadHandler = null;
    }
    if (this.embeddedCheckout) {
      this.embeddedCheckout.destroy();
      this.embeddedCheckout = null;
    }
    this.checkoutMounted.set(false);
    this.processing.set(false);
    this.error.set(null);
  }

  ngAfterViewInit() {
    this.isInitializing.set(true);
    this.initializeCheckoutReadiness();
  }

  private isMockMode(): boolean {
    return this.mockPayments() || environment.stripe.mockPayments;
  }

  private initializeCheckoutReadiness(): void {
    try {
      const publishableKey = this.publishableKey();
      if (!publishableKey) {
        throw new Error('Missing Stripe publishable key');
      }

      if (this.isMockMode()) {
        this.stripe = createMockStripeJs();
        this.loadedPublishableKey = publishableKey;
        this.loadedConnectedAccountId = null;
        this.isReady.set(true);
        return;
      }

      this.isReady.set(true);
    } catch (error: unknown) {
      logger.error('Embedded checkout initialization failed', error);
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Failed to initialize secure checkout',
      );
    } finally {
      this.isInitializing.set(false);
    }
  }

  private async loadStripeForSession(
    connectedAccountId: string | null,
  ): Promise<StripeCheckoutClient> {
    const publishableKey = this.publishableKey();
    if (!publishableKey) {
      throw new Error('Missing Stripe publishable key');
    }

    if (
      this.stripe &&
      this.loadedPublishableKey === publishableKey &&
      this.loadedConnectedAccountId === connectedAccountId
    ) {
      return this.stripe;
    }

    if (this.isMockMode()) {
      this.stripe = createMockStripeJs();
      this.loadedPublishableKey = publishableKey;
      this.loadedConnectedAccountId = connectedAccountId;
      return this.stripe;
    }

    const stripe = connectedAccountId
      ? await this.loadStripe(publishableKey, {
          stripeAccount: connectedAccountId,
        })
      : await this.loadStripe(publishableKey);
    if (!stripe) {
      throw new Error('Stripe.js failed to load');
    }

    this.stripe = stripe;
    this.loadedPublishableKey = publishableKey;
    this.loadedConnectedAccountId = connectedAccountId;
    return stripe;
  }

  private async mountEmbeddedCheckout() {
    if (this.embeddedCheckout) {
      return;
    }

    const container = this.paymentElementContainer();
    if (!container?.nativeElement) {
      throw new Error('Checkout container not found');
    }

    const session = await this.checkoutSessionFetcher()();
    const sessionConnectedAccountId =
      session.connectedAccountId === undefined
        ? this.connectedAccountId()
        : session.connectedAccountId;
    const stripe = await this.loadStripeForSession(sessionConnectedAccountId);

    this.embeddedCheckout = await stripe.createEmbeddedCheckoutPage({
      fetchClientSecret: () => Promise.resolve(session.clientSecret),
      onComplete: () => {
        this.processing.set(true);
        this.paymentConfirmed.emit();
      },
    });

    this.embeddedCheckout.mount(container.nativeElement);

    // Stripe registers a bubble-phase beforeunload listener that shows a dialog when
    // the user navigates away during an active checkout. We register a capture-phase
    // handler here so our destroy() call fires first, removing Stripe's listener before
    // it can show the dialog.
    if (this.beforeUnloadHandler) {
      window.removeEventListener(
        'beforeunload',
        this.beforeUnloadHandler,
        true,
      );
    }
    this.beforeUnloadHandler = () => {
      this.embeddedCheckout?.destroy();
      this.embeddedCheckout = null;
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler, true);

    this.checkoutMounted.set(true);
  }

  async handlePayment(event: Event) {
    event.preventDefault();

    await this.paymentLock(async () => {
      if (this.processing()) {
        return;
      }

      if (this.checkoutMounted() && this.isMockMode()) {
        this.processing.set(true);
        this.paymentConfirmed.emit();
        return;
      }

      this.processing.set(true);
      this.error.set(null);

      try {
        await this.mountEmbeddedCheckout();
      } catch (error: unknown) {
        logger.error('Embedded checkout failed to start', error);
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to start secure checkout';
        this.error.set(message);
        this.paymentError.emit(message);
      } finally {
        if (!this.checkoutMounted() || this.isMockMode()) {
          this.processing.set(false);
        }
      }
    });
  }
}
