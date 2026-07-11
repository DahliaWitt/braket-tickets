import {describe, it, expect, beforeEach, vi} from 'vitest';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
} from '@angular/core';
import {TestBed, type ComponentFixture} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideRouter, Router} from '@angular/router';
import {CheckoutSidebarComponent} from './checkout-sidebar.component';
import {CheckoutSidebarHarness} from './checkout-sidebar.component.harness';
import {AuthService} from '@/core/services/auth.service';
import {STRIPE_CONFIG} from '@/app.tokens';
import {type EventDetail} from '@/core/models/event.types';
import {type Id} from '@convex/_generated/dataModel';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class CheckoutSidebarRouteStubComponent {}

/**
 * Builds a minimal Event stub with the fields the component actually reads.
 * All other Doc<'events'> fields are left as defaults via the cast.
 */
function stubEvent(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    _id: 'event123' as Id<'events'>,
    _creationTime: Date.now(),
    title: 'Test Event',
    price: 4000, // $40
    supporterDefaultPrice: 5000, // $50
    slidingScaleEnabled: false,
    slidingScaleMin: 0,
    organizerPaymentReady: true,
    ...overrides,
  } as EventDetail;
}

describe('CheckoutSidebarComponent — logarithmic supporter slider', () => {
  let fixture: ComponentFixture<CheckoutSidebarComponent>;
  let component: CheckoutSidebarComponent;
  let harness: CheckoutSidebarHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [CheckoutSidebarComponent, CheckoutSidebarRouteStubComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          {path: '**', component: CheckoutSidebarRouteStubComponent},
        ]),
        {
          provide: AuthService,
          useValue: {isAuthenticated: () => false, user: () => null},
        },
        {
          provide: STRIPE_CONFIG,
          useValue: {publishableKey: 'pk_test_fake', mockPayments: true},
        },
      ],
    });

    fixture = TestBed.createComponent(CheckoutSidebarComponent);
    component = fixture.componentInstance;
    const router = TestBed.inject(Router);
    await router.navigateByUrl(
      '/events/event123?buy=true&source=sidebar#details',
    );

    // Set all required inputs to valid defaults
    const ref = fixture.componentRef;
    ref.setInput('event', stubEvent());
    ref.setInput('isOpen', false);
    ref.setInput('initialized', false);
    ref.setInput('paymentStatus', 'idle');
    ref.setInput('paymentErrorMessage', null);
    ref.setInput('ticketQuantity', 1);
    ref.setInput('selectedTier', 'supporter');
    ref.setInput('purchaseBlockedByVetting', false);
    ref.setInput('customAmount', 5000); // $50 (= supporterDefaultPrice)
    ref.setInput('slidingScaleError', null);
    ref.setInput('totalAmount', 5000);
    ref.setInput('maxTickets', 4);
    ref.setInput('isAtMaxTickets', false);
    ref.setInput('checkoutLocked', false);
    ref.setInput('checkoutSessionFetcher', () =>
      Promise.resolve({clientSecret: 'cs_fake'}),
    );

    fixture.detectChanges();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      CheckoutSidebarHarness,
    );
  });

  describe('supporterSliderPosition', () => {
    it('returns 0 when customAmount equals supporterDefaultPrice (min)', () => {
      // customAmount already set to 5000 (= supporterDefaultPrice)
      expect(component.supporterSliderPosition()).toBe(0);
    });

    it('returns 100 when customAmount equals supporterSliderMax', () => {
      // supporterSliderMax = max(50 * 3, 200) = 200 → $200 = 20000 cents
      const maxDollars = component.supporterSliderMax();
      fixture.componentRef.setInput('customAmount', maxDollars * 100);
      fixture.detectChanges();

      expect(component.supporterSliderPosition()).toBe(100);
    });

    it('maps midpoint to geometric mean (not arithmetic mean)', () => {
      const min = component.supporterMinDollars(); // 50
      const max = component.supporterSliderMax(); // 200
      const geometricMean = Math.sqrt(min * max); // sqrt(50 * 200) = 100
      fixture.componentRef.setInput('customAmount', geometricMean * 100);
      fixture.detectChanges();

      expect(component.supporterSliderPosition()).toBe(50);
    });

    it('clamps to 0 when customAmount is below min', () => {
      fixture.componentRef.setInput('customAmount', 1000); // $10, well below $50 min
      fixture.detectChanges();

      expect(component.supporterSliderPosition()).toBe(0);
    });

    it('clamps to 100 when customAmount is above max', () => {
      fixture.componentRef.setInput('customAmount', 99999_00); // way above max
      fixture.detectChanges();

      expect(component.supporterSliderPosition()).toBe(100);
    });
  });

  describe('supporterPositionToDollars', () => {
    it('returns min dollars at position 0', () => {
      const min = component.supporterMinDollars();
      expect(component.supporterPositionToDollars(0)).toBe(min);
    });

    it('returns max dollars at position 100', () => {
      const max = component.supporterSliderMax();
      expect(component.supporterPositionToDollars(100)).toBe(max);
    });

    it('returns geometric mean at position 50', () => {
      const min = component.supporterMinDollars();
      const max = component.supporterSliderMax();
      const expected = Math.round(Math.sqrt(min * max)); // 100
      expect(component.supporterPositionToDollars(50)).toBe(expected);
    });

    it('clamps to min for negative positions', () => {
      expect(component.supporterPositionToDollars(-5)).toBe(
        component.supporterMinDollars(),
      );
    });

    it('clamps to max for positions above 100', () => {
      expect(component.supporterPositionToDollars(150)).toBe(
        component.supporterSliderMax(),
      );
    });
  });

  describe('round-trip consistency', () => {
    it('positionToDollars(sliderPosition(amount)) is within $1 of the original', () => {
      const testAmounts = [6000, 7500, 10000, 15000, 20000]; // cents

      for (const cents of testAmounts) {
        fixture.componentRef.setInput('customAmount', cents);
        fixture.detectChanges();

        const position = component.supporterSliderPosition();
        const roundTrippedDollars =
          component.supporterPositionToDollars(position);
        const originalDollars = cents / 100;

        expect(
          Math.abs(roundTrippedDollars - originalDollars),
        ).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('supporterSliderMax', () => {
    it('defaults to max(3x base, 200)', () => {
      // base = supporterDefaultPrice / 100 = 50, 3x = 150, max(150, 200) = 200
      expect(component.supporterSliderMax()).toBe(200);
    });

    it('uses 3x base when that exceeds 200', () => {
      fixture.componentRef.setInput(
        'event',
        stubEvent({supporterDefaultPrice: 10000}),
      ); // $100
      fixture.detectChanges();

      // 3x $100 = $300 > $200
      expect(component.supporterSliderMax()).toBe(300);
    });
  });

  describe('custom amount input', () => {
    it('emits the input value instead of the raw DOM event', () => {
      const emitSpy = vi.spyOn(component.customAmountInput, 'emit');
      const host = fixture.nativeElement as HTMLElement;
      const input = host.querySelector<HTMLInputElement>(
        'input[aria-label="Enter custom supporter amount"]',
      );

      expect(input).not.toBeNull();

      input!.value = '42.5';
      input!.dispatchEvent(new Event('input', {bubbles: true}));

      expect(emitSpy).toHaveBeenCalledWith('42.5');
    });
  });

  describe('keyboard accessibility', () => {
    it('emits closeRequested when Escape is pressed inside the open dialog', async () => {
      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      const emitSpy = vi.spyOn(component.closeRequested, 'emit');

      await harness.pressEscape();

      expect(emitSpy).toHaveBeenCalled();
    });
  });

  describe('purchase blockers', () => {
    it('prioritizes the vetting requirement message over payment setup copy', async () => {
      fixture.componentRef.setInput(
        'event',
        stubEvent({
          organizerId: 'org123' as Id<'organizers'>,
          organizerPaymentReady: false,
        }),
      );
      fixture.componentRef.setInput('purchaseBlockedByVetting', true);
      fixture.componentRef.setInput('isGuest', false);
      fixture.detectChanges();

      expect(await harness.isVettingRequiredVisible()).toBe(true);
      expect(await harness.isPaymentSetupIncomplete()).toBe(false);
      expect(await harness.hasApplyForVettingLink()).toBe(true);
      expect(await harness.getVettingRequiredText()).toContain(
        'Tickets unavailable — community vetting required.',
      );
    });

    it('preserves the current URL on the guest sign-in CTA', async () => {
      fixture.componentRef.setInput('isGuest', true);
      fixture.componentRef.setInput('purchaseBlockedByVetting', false);
      fixture.detectChanges();

      const href = await harness.getGuestSidebarSignInHref();
      expect(href).not.toBeNull();

      const url = new URL(href!, 'http://localhost');
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('returnUrl')).toBe(
        '/events/event123?buy=true&source=sidebar#details',
      );
    });

    it('adds buy=true to the guest sign-in returnUrl when the sidebar opened before router URL sync', async () => {
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/events/event123?source=sidebar#details');

      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('isGuest', true);
      fixture.componentRef.setInput('purchaseBlockedByVetting', false);
      fixture.detectChanges();

      const href = await harness.getGuestSidebarSignInHref();
      expect(href).not.toBeNull();

      const url = new URL(href!, 'http://localhost');
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('returnUrl')).toBe(
        '/events/event123?source=sidebar&buy=true#details',
      );
    });

    it('preserves the current URL on the vetting sign-in CTA', async () => {
      fixture.componentRef.setInput('isGuest', true);
      fixture.componentRef.setInput('guestEmail', 'guest@example.com');
      fixture.componentRef.setInput('purchaseBlockedByVetting', true);
      fixture.detectChanges();

      const href = await harness.getCheckoutVettingSignInHref();
      expect(href).not.toBeNull();

      const url = new URL(href!, 'http://localhost');
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('returnUrl')).toBe(
        '/events/event123?buy=true&source=sidebar#details',
      );
    });
  });

  describe('max ticket notice copy', () => {
    it('omits the vetting referral for public events and pluralizes when remaining > 1', async () => {
      fixture.componentRef.setInput('event', stubEvent({visibility: 'public'}));
      fixture.componentRef.setInput('maxTickets', 2);
      fixture.componentRef.setInput('isAtMaxTickets', true);
      fixture.detectChanges();

      const text = await harness.getHostText();

      expect(text).toContain(
        'You can buy up to 2 more tickets for this event.',
      );
      expect(text).not.toContain(
        'Have your friends complete the vetting process.',
      );
    });

    it('keeps the vetting referral for vetted events', async () => {
      fixture.componentRef.setInput(
        'event',
        stubEvent({visibility: 'public_viewable'}),
      );
      fixture.componentRef.setInput('maxTickets', 2);
      fixture.componentRef.setInput('isAtMaxTickets', true);
      fixture.detectChanges();

      const text = await harness.getHostText();

      expect(text).toContain(
        'You can buy up to 2 more tickets for this event.',
      );
      expect(text).toContain('Have your friends complete the vetting process.');
    });

    it('uses singular copy when remaining is exactly 1', async () => {
      fixture.componentRef.setInput('event', stubEvent({visibility: 'public'}));
      fixture.componentRef.setInput('maxTickets', 1);
      fixture.componentRef.setInput('isAtMaxTickets', true);
      fixture.detectChanges();

      const text = await harness.getHostText();

      expect(text).toContain('You can buy 1 more ticket for this event.');
      expect(text).not.toContain('1 more tickets');
    });
  });

  describe('supporter tier label alignment', () => {
    it('shows "min" sub-label beneath the supporter price', async () => {
      fixture.componentRef.setInput('selectedTier', 'regular');
      fixture.detectChanges();

      expect(await harness.getSupporterMinLabelText()).toBe('min');
    });

    it('shows supporterDefaultPrice as the min price when set', async () => {
      // stubEvent sets supporterDefaultPrice: 5000 ($50) and price: 4000 ($40)
      // The header must use supporterDefaultPrice, not price + $1
      expect(await harness.getSupporterMinPriceText()).toMatch(/\$50\.00/);
    });

    it('falls back to price + $1 as min when supporterDefaultPrice is absent', async () => {
      fixture.componentRef.setInput(
        'event',
        stubEvent({price: 4000, supporterDefaultPrice: undefined}),
      );
      fixture.detectChanges();

      expect(await harness.getSupporterMinPriceText()).toMatch(/\$41\.00/);
    });

    it('uses supporterDefaultPrice of 0 as the min (not a fallback)', () => {
      fixture.componentRef.setInput(
        'event',
        stubEvent({price: 4000, supporterDefaultPrice: 0}),
      );
      fixture.detectChanges();

      // supporterDefaultPrice: 0 must be honoured — do not silently fall back to price + $1
      expect(component.supporterMinDollars()).toBe(0);
    });
  });

  describe('Stripe payment footer', () => {
    it('hides secure checkout when totalAmount is 0', async () => {
      fixture.componentRef.setInput('totalAmount', 0);
      fixture.componentRef.setInput('selectedTier', 'regular');
      fixture.detectChanges();

      expect(await harness.isStripePaymentVisible()).toBe(false);
      expect(await harness.isFreeTicketVisible()).toBe(true);
    });

    it('shows secure checkout when totalAmount is greater than 0', async () => {
      fixture.componentRef.setInput('totalAmount', 4000);
      fixture.componentRef.setInput('selectedTier', 'regular');
      fixture.detectChanges();

      expect(await harness.isStripePaymentVisible()).toBe(true);
      expect(await harness.isStripePayButtonVisible()).toBe(true);
      expect(await harness.isFreeTicketVisible()).toBe(false);
    });
  });

  describe('m24 — invalid custom amount CTA (never a free claim on a paid event)', () => {
    it('shows a disabled paid CTA (not GET TICKET) when a below-min amount collapses the total to 0', async () => {
      // Paid $40 event, community tier, buyer typed $0 → below the $5 min, so
      // totalAmount is 0 but a validation error is set. This must NOT morph into
      // the free "GET TICKET" claim path (which the backend rejects).
      fixture.componentRef.setInput(
        'event',
        stubEvent({slidingScaleEnabled: true, slidingScaleMin: 500}),
      );
      fixture.componentRef.setInput('selectedTier', 'notaflof');
      fixture.componentRef.setInput('customAmount', 0);
      fixture.componentRef.setInput('totalAmount', 0);
      fixture.componentRef.setInput('slidingScaleError', 'Minimum amount is $5.00');
      fixture.detectChanges();

      expect(await harness.isFreeTicketVisible()).toBe(false);
      expect(await harness.isStripePaymentVisible()).toBe(false);
      expect(await harness.isAmountInvalidVisible()).toBe(true);
      expect(await harness.isAmountInvalidCtaDisabled()).toBe(true);
      expect(await harness.getAmountInvalidMessage()).toContain(
        'Minimum amount is $5.00',
      );
    });

    it('shows the disabled CTA (not the live Stripe form) when an above-max amount keeps a positive total', async () => {
      // Community tier, $15 chosen against a $10 max → totalAmount > 0 but
      // invalid. The Stripe form must not mount for an amount the server rejects.
      fixture.componentRef.setInput(
        'event',
        stubEvent({slidingScaleEnabled: true, slidingScaleMin: 500}),
      );
      fixture.componentRef.setInput('selectedTier', 'notaflof');
      fixture.componentRef.setInput('customAmount', 1500);
      fixture.componentRef.setInput('totalAmount', 1500);
      fixture.componentRef.setInput(
        'slidingScaleError',
        'Maximum for community tier is $10.00',
      );
      fixture.detectChanges();

      expect(await harness.isStripePaymentVisible()).toBe(false);
      expect(await harness.isFreeTicketVisible()).toBe(false);
      expect(await harness.isAmountInvalidVisible()).toBe(true);
      expect(await harness.isAmountInvalidCtaDisabled()).toBe(true);
    });

    it('still shows the free GET TICKET path for a genuinely free ticket (no error)', async () => {
      fixture.componentRef.setInput('selectedTier', 'regular');
      fixture.componentRef.setInput('customAmount', 0);
      fixture.componentRef.setInput('totalAmount', 0);
      fixture.componentRef.setInput('slidingScaleError', null);
      fixture.detectChanges();

      expect(await harness.isAmountInvalidVisible()).toBe(false);
      expect(await harness.isFreeTicketVisible()).toBe(true);
    });

    it('locks quantity controls while the checkout session is locked (m25)', async () => {
      // Quantity 2 with room to move (not at max, above 1) so the disabled
      // state is driven purely by checkoutLocked, not the min/max clamps.
      fixture.componentRef.setInput('selectedTier', 'regular');
      fixture.componentRef.setInput('ticketQuantity', 2);
      fixture.componentRef.setInput('isAtMaxTickets', false);
      fixture.componentRef.setInput('totalAmount', 8000);
      fixture.componentRef.setInput('checkoutLocked', false);
      fixture.detectChanges();

      expect(await harness.isIncreaseDisabled()).toBe(false);
      expect(await harness.isDecreaseDisabled()).toBe(false);

      fixture.componentRef.setInput('checkoutLocked', true);
      fixture.detectChanges();

      expect(await harness.isIncreaseDisabled()).toBe(true);
      expect(await harness.isDecreaseDisabled()).toBe(true);
    });
  });

  describe('success copy', () => {
    it('uses claimed copy for authenticated free tickets', async () => {
      fixture.componentRef.setInput('paymentStatus', 'success');
      fixture.componentRef.setInput('totalAmount', 0);
      fixture.componentRef.setInput('isGuest', false);
      fixture.detectChanges();

      const text = await harness.getHostText();
      expect(text).toMatch(
        /Ticket claimed\. Your ticket\(s\) have been added to your wallet\./,
      );
      expect(text).not.toContain('Payment successful.');
    });

    it('keeps payment copy for authenticated paid orders', async () => {
      fixture.componentRef.setInput('paymentStatus', 'success');
      fixture.componentRef.setInput('totalAmount', 4000);
      fixture.componentRef.setInput('isGuest', false);
      fixture.detectChanges();

      const text = await harness.getHostText();
      expect(text).toContain(
        'Payment successful. Your tickets have been added to your wallet.',
      );
    });
  });

  describe('guest ToS assent (BRA-455)', () => {
    // Puts the sidebar into the guest ticket-selection view (email already
    // collected) so the payment gate cascade renders.
    function asGuestWithEmail(): void {
      fixture.componentRef.setInput('isGuest', true);
      fixture.componentRef.setInput('guestEmail', 'guest@example.com');
      fixture.componentRef.setInput('selectedTier', 'regular');
    }

    it('shows the assent block and gates the Stripe mount until accepted', async () => {
      asGuestWithEmail();
      fixture.componentRef.setInput('totalAmount', 4000);
      fixture.componentRef.setInput('termsAccepted', false);
      fixture.detectChanges();

      expect(await harness.isTermsCheckboxVisible()).toBe(true);
      expect(await harness.isStripePaymentVisible()).toBe(false);

      fixture.componentRef.setInput('termsAccepted', true);
      fixture.detectChanges();

      // Checkbox stays visible above the now-mounted payment element.
      expect(await harness.isTermsCheckboxVisible()).toBe(true);
      expect(await harness.isStripePaymentVisible()).toBe(true);
    });

    it('keeps the free ticket button disabled until terms are accepted', async () => {
      asGuestWithEmail();
      fixture.componentRef.setInput('totalAmount', 0);
      fixture.componentRef.setInput('termsAccepted', false);
      fixture.detectChanges();

      expect(await harness.isTermsCheckboxVisible()).toBe(true);
      expect(await harness.isFreeTicketVisible()).toBe(true);
      expect(await harness.isFreeTicketEnabled()).toBe(false);

      fixture.componentRef.setInput('termsAccepted', true);
      fixture.detectChanges();

      expect(await harness.isFreeTicketEnabled()).toBe(true);
    });

    it('links to the terms of service and privacy policy pages', async () => {
      asGuestWithEmail();
      fixture.componentRef.setInput('totalAmount', 4000);
      fixture.componentRef.setInput('termsAccepted', false);
      fixture.detectChanges();

      const hrefs = await harness.getTermsLinkHrefs();
      expect(hrefs.terms).toBe('/terms');
      expect(hrefs.privacy).toBe('/privacy');
    });

    it('emits termsAcceptedChange when the checkbox is toggled', async () => {
      asGuestWithEmail();
      fixture.componentRef.setInput('totalAmount', 4000);
      fixture.componentRef.setInput('termsAccepted', false);
      fixture.detectChanges();

      const emitSpy = vi.spyOn(component.termsAcceptedChange, 'emit');

      await harness.toggleTerms();

      expect(emitSpy).toHaveBeenCalledWith(true);
    });

    it('shows no assent checkbox for signed-in users', async () => {
      fixture.componentRef.setInput('isGuest', false);
      fixture.componentRef.setInput('selectedTier', 'regular');
      fixture.componentRef.setInput('totalAmount', 4000);
      fixture.detectChanges();

      expect(await harness.isTermsCheckboxVisible()).toBe(false);
      expect(await harness.isStripePaymentVisible()).toBe(true);
    });

    it('does not disable the free ticket button for signed-in users', async () => {
      fixture.componentRef.setInput('isGuest', false);
      fixture.componentRef.setInput('selectedTier', 'regular');
      fixture.componentRef.setInput('totalAmount', 0);
      fixture.detectChanges();

      expect(await harness.isTermsCheckboxVisible()).toBe(false);
      expect(await harness.isFreeTicketVisible()).toBe(true);
      expect(await harness.isFreeTicketEnabled()).toBe(true);
    });
  });
});
