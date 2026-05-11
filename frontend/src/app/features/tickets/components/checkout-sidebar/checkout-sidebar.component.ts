import {
  afterNextRender,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  model,
  runInInjectionContext,
  signal,
  Injector,
  ChangeDetectionStrategy,
  type ElementRef,
  viewChild,
} from '@angular/core';
import {CurrencyPipe} from '@angular/common';
import {Router, RouterLink} from '@angular/router';
import {A11yModule} from '@angular/cdk/a11y';
import {form, FormField, required, email} from '@angular/forms/signals';
import {AuthService} from '@/core/services/auth.service';
import {sanitizeInternalReturnUrl} from '@/core/services/auth-navigation';
import {STRIPE_CONFIG, type StripeConfig} from '@/app.tokens';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {ZardSliderComponent} from '@ui/components/primitives/slider/slider.component';
import {BraCodeOfConductLinkComponent} from '@ui/components/primitives/code-of-conduct-link/code-of-conduct-link.component';
import {readInputValue} from '@ui/utils/dom-event';
import {StripePaymentComponent} from '../stripe-payment/stripe-payment.component';
import type {TicketTier} from '@shared/domain/ticket-tier';
import type {CheckoutKind} from '@/core/analytics/events';
import {EVENT_VISIBILITY} from '@shared/domain/event-visibility';
import {type EventDetail} from '@/core/models/event.types';

@Component({
  selector: 'app-checkout-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    RouterLink,
    A11yModule,
    FormField,
    ZardButtonComponent,
    ZardIconComponent,
    ZardInputDirective,
    ZardSliderComponent,
    BraCodeOfConductLinkComponent,
    StripePaymentComponent,
  ],
  templateUrl: './checkout-sidebar.component.html',
})
export class CheckoutSidebarComponent {
  // Services
  auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  stripeConfig = inject<StripeConfig>(STRIPE_CONFIG);

  // Guest inputs/outputs
  readonly isGuest = input(false);
  readonly guestEmail = input<string | null>(null);
  readonly guestEmailCollected = output<string>();

  // Guest email form state
  private readonly guestEmailSubmitted = signal(false);
  private readonly guestEmailModel = signal({email: ''});
  readonly guestEmailForm = form(this.guestEmailModel, (f) => {
    required(f.email);
    email(f.email);
  });

  // State inputs — parent owns all state
  readonly event = input.required<EventDetail>();
  readonly isOpen = model.required<boolean>();
  readonly initialized = input.required<boolean>();
  readonly paymentStatus = input.required<
    'idle' | 'processing' | 'success' | 'error'
  >();
  readonly paymentErrorMessage = input.required<string | null>();
  readonly ticketQuantity = input.required<number>();
  readonly selectedTier = input.required<TicketTier>();
  readonly purchaseBlockedByVetting = input(false);
  readonly customAmount = input.required<number>();
  readonly slidingScaleError = input.required<string | null>();
  readonly totalAmount = input.required<number>();
  readonly maxTickets = input.required<number>();
  readonly isAtMaxTickets = input.required<boolean>();
  readonly checkoutLocked = input<boolean>(false);
  readonly checkoutSessionFetcher = input.required<
    () => Promise<{
      clientSecret: string;
      connectedAccountId?: string | null;
      orderId?: string | null;
    }>
  >();
  /**
   * Connected account id when the active order is a direct charge. Null
   * for platform-owned events. Forwarded to the embedded Stripe payment
   * component so Stripe.js initializes with the correct
   * `{stripeAccount}` option.
   */
  readonly connectedAccountId = input<string | null>(null);
  readonly buyerEmail = input<string | null>(null);
  readonly stripeResetKey = input<number>(0);
  readonly orderId = input<string | null>(null);
  readonly isResalePurchase = input(false);
  readonly checkoutKind = input<CheckoutKind>('primary');
  private readonly closeButtonRef =
    viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  // Action outputs — child notifies parent of user actions
  closeRequested = output();
  quantityChanged = output<number>();
  tierSelected = output<TicketTier>();
  sliderChanged = output<number>();
  customAmountInput = output<string>();
  paymentConfirmed = output();
  paymentError = output<string>();
  freeTicketClaimed = output();
  retryPayment = output();

  constructor() {
    effect((onCleanup) => {
      if (!this.isOpen()) {
        return;
      }

      runInInjectionContext(this.injector, () => {
        const focusRenderRef = afterNextRender({
          write: () => {
            if (!this.isOpen()) {
              return;
            }

            this.closeButtonRef().nativeElement.focus();
          },
        });

        onCleanup(() => focusRenderRef.destroy());
      });
    });
  }

  // Guest email form helpers
  protected isGuestEmailInvalid(): boolean {
    const field = this.guestEmailForm.email;
    if (typeof field !== 'function') return false;
    const state = field();
    return (state.touched() || this.guestEmailSubmitted()) && state.invalid();
  }

  protected submitGuestEmail(): void {
    this.guestEmailSubmitted.set(true);
    const formState = this.guestEmailForm();
    if (formState.invalid()) return;
    const emailValue = this.guestEmailModel().email.trim();
    this.guestEmailCollected.emit(emailValue);
  }

  loginQueryParams(): {returnUrl: string} {
    const currentUrl = sanitizeInternalReturnUrl(this.router.url);

    if (!this.isOpen()) {
      return {returnUrl: currentUrl};
    }

    const returnUrlTree = this.router.parseUrl(currentUrl);
    if (returnUrlTree.queryParams['buy'] !== 'true') {
      returnUrlTree.queryParams = {
        ...returnUrlTree.queryParams,
        buy: 'true',
      };
    }

    return {
      returnUrl: sanitizeInternalReturnUrl(
        this.router.serializeUrl(returnUrlTree),
      ),
    };
  }

  protected handleCustomAmountInput(event: globalThis.Event): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    this.customAmountInput.emit(value);
  }

  readonly maxTicketsNotice = computed(() => {
    const remaining = this.maxTickets();
    const base =
      remaining === 1
        ? `You can buy 1 more ticket for this event.`
        : `You can buy up to ${remaining} more tickets for this event.`;
    return this.event().visibility === EVENT_VISIBILITY.PUBLIC
      ? base
      : `${base} Have your friends complete the vetting process.`;
  });

  // Supporter slider min in dollars (reusable)
  readonly supporterMinDollars = computed(() => {
    const evt = this.event();
    const base =
      evt?.supporterDefaultPrice != null
        ? evt.supporterDefaultPrice
        : (evt?.price ?? 0) + 100;
    return base / 100;
  });

  // Number of discrete positions on the log slider
  private readonly LOG_SLIDER_STEPS = 100;

  // Convert customAmount (cents) to a logarithmic slider position (0–100)
  readonly supporterSliderPosition = computed(() => {
    const dollars = this.customAmount() / 100;
    const min = this.supporterMinDollars();
    const max = this.supporterSliderMax();
    if (min <= 0 || max <= min || dollars <= min) return 0;
    if (dollars >= max) return this.LOG_SLIDER_STEPS;
    return Math.round(
      (this.LOG_SLIDER_STEPS * Math.log(dollars / min)) / Math.log(max / min),
    );
  });

  // Convert a log slider position (0–100) back to dollars
  supporterPositionToDollars(position: number): number {
    const min = this.supporterMinDollars();
    const max = this.supporterSliderMax();
    if (position <= 0) return min;
    if (position >= this.LOG_SLIDER_STEPS) return max;
    return Math.round(
      min * Math.pow(max / min, position / this.LOG_SLIDER_STEPS),
    );
  }

  // Slider max for supporter tier: 3x the default price, or at least $200
  readonly supporterSliderMax = computed(() => {
    const evt = this.event();
    if (!evt) return 200;
    const base = (evt.supporterDefaultPrice || evt.price || 4000) / 100;
    return Math.max(base * 3, 200);
  });

  // Slider max for community tier: the regular price (ensures users pick "less than regular")
  readonly communitySliderMax = computed(() => {
    const evt = this.event();
    if (!evt) return 100;
    return (evt.price || 0) / 100;
  });
}
