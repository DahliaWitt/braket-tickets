import {describe, it, expect, beforeEach, vi, afterEach} from 'vitest';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  provideZonelessChangeDetection,
} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {type HarnessLoader} from '@angular/cdk/testing';
import type {Stripe, StripeEmbeddedCheckout} from '@stripe/stripe-js';
import {
  STRIPE_JS_LOADER,
  StripePaymentComponent,
} from './stripe-payment.component';
import {AppStripePaymentHarness} from './stripe-payment.component.harness';

const loadStripeMock = vi.fn();

type StripeCheckoutClient = Pick<Stripe, 'createEmbeddedCheckoutPage'>;

function createStripeCheckoutMock(): StripeCheckoutClient {
  const embeddedCheckout = {
    mount: vi.fn(),
    destroy: vi.fn(),
    unmount: vi.fn(),
  } satisfies StripeEmbeddedCheckout;

  return {
    createEmbeddedCheckoutPage: vi.fn(async () => embeddedCheckout),
  } satisfies StripeCheckoutClient;
}

/**
 * Test host component wrapping StripePaymentComponent with required inputs.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StripePaymentComponent],
  template: `
    <app-stripe-payment
      [publishableKey]="publishableKey()"
      [checkoutSessionFetcher]="checkoutSessionFetcher"
      [mockPayments]="true"
      [amount]="amount()"
      [paymentLabel]="paymentLabel()"
      (paymentConfirmed)="confirmed = true"
      (paymentError)="lastError = $event"
    />
  `,
})
class TestHostComponent {
  readonly publishableKey = input<string>('pk_test_mock');
  readonly amount = input<number>(2500);
  readonly paymentLabel = input<string>('Total');
  confirmed = false;
  lastError: string | null = null;

  checkoutSessionFetcher = async () => ({
    clientSecret: 'cs_test_secret',
    orderId: 'order_test_123',
  });
}

describe('StripePaymentComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let loader: HarnessLoader;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    loader = TestbedHarnessEnvironment.loader(fixture);

    fixture.detectChanges();
    // Give mock Stripe time to initialize (async afterViewInit)
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should create the component', async () => {
    const harness = await loader.getHarness(AppStripePaymentHarness);
    expect(harness).toBeTruthy();
  });

  it('keeps the embedded checkout container hidden until checkout starts', async () => {
    const harness = await loader.getHarness(AppStripePaymentHarness);
    expect(await harness.isPaymentElementVisible()).toBe(false);
  });

  it('should have a start checkout button', async () => {
    const harness = await loader.getHarness(AppStripePaymentHarness);
    const btn = await harness.getPayButton();
    expect(btn).toBeTruthy();
  });

  it('should become ready after mock init', async () => {
    const harness = await loader.getHarness(AppStripePaymentHarness);
    // Mock fires 'ready' event via setTimeout(0), should be resolved after whenStable
    expect(await harness.isReady()).toBe(true);
  });

  it('should not show error initially', async () => {
    const harness = await loader.getHarness(AppStripePaymentHarness);
    expect(await harness.getErrorText()).toBeNull();
  });

  it('should not be in loading state initially', async () => {
    const harness = await loader.getHarness(AppStripePaymentHarness);
    expect(await harness.isLoading()).toBe(false);
  });

  it('mounts embedded checkout after the first click in mock mode', async () => {
    const harness = await loader.getHarness(AppStripePaymentHarness);

    expect(await harness.isReady()).toBe(true);

    await harness.clickPay();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.confirmed).toBe(false);
    expect(await harness.getPayButtonText()).toContain('COMPLETE MOCK PAYMENT');
    expect(await harness.isPaymentElementVisible()).toBe(true);
  });

  it('mounts embedded checkout for the current session', async () => {
    const harness = await loader.getHarness(AppStripePaymentHarness);

    await harness.clickPay();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.detectChanges();
    expect(await harness.isPaymentElementVisible()).toBe(true);
  });

  it('should emit paymentConfirmed after completing mock checkout', async () => {
    const harness = await loader.getHarness(AppStripePaymentHarness);

    expect(await harness.isReady()).toBe(true);

    await harness.clickPay();
    await fixture.whenStable();
    fixture.detectChanges();

    await harness.clickPay();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.confirmed).toBe(true);
    expect(host.lastError).toBeNull();
  });

  it('should show mock indicator text after embedded checkout mounts', async () => {
    const harness = await loader.getHarness(AppStripePaymentHarness);

    await harness.clickPay();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(await harness.isPaymentElementVisible()).toBe(true);
    const host = await (
      harness as unknown as {host(): Promise<{text(): Promise<string>}>}
    ).host();
    const text = await host.text();
    expect(text).toContain('MOCK');
  });

  it('registers a capture-phase beforeunload listener after mounting and removes it on destroy', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const harness = await loader.getHarness(AppStripePaymentHarness);

    // Mount the embedded checkout
    await harness.clickPay();
    await fixture.whenStable();
    fixture.detectChanges();

    // A capture-phase beforeunload listener must have been registered
    const addCalls = addSpy.mock.calls.filter(
      ([event, , capture]) => event === 'beforeunload' && capture === true,
    );
    expect(addCalls.length).toBeGreaterThan(0);

    // Destroy the component — the listener must be removed
    fixture.destroy();

    const removeCalls = removeSpy.mock.calls.filter(
      ([event, , capture]) => event === 'beforeunload' && capture === true,
    );
    expect(removeCalls.length).toBeGreaterThan(0);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe('StripePaymentComponent — Stripe.js loading', () => {
  async function setupProductionStripe(
    options: {
      connectedAccountId?: string | null;
      sessionConnectedAccountId?: string | null;
      stripe?: StripeCheckoutClient | null;
    } = {},
  ) {
    const stripe =
      'stripe' in options ? options.stripe : createStripeCheckoutMock();
    loadStripeMock.mockResolvedValue(stripe);

    await TestBed.configureTestingModule({
      imports: [StripePaymentComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: STRIPE_JS_LOADER, useValue: loadStripeMock},
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(StripePaymentComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('publishableKey', 'pk_test_real');
    fixture.componentRef.setInput('checkoutSessionFetcher', () =>
      Promise.resolve({
        clientSecret: 'cs_test_secret',
        connectedAccountId: options.sessionConnectedAccountId,
      }),
    );
    if ('connectedAccountId' in options) {
      fixture.componentRef.setInput(
        'connectedAccountId',
        options.connectedAccountId,
      );
    }

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return {component, fixture, stripe};
  }

  beforeEach(() => {
    loadStripeMock.mockReset();
  });

  it('loads Stripe.js with only the publishable key for platform checkout', async () => {
    const {component} = await setupProductionStripe();

    expect(loadStripeMock).not.toHaveBeenCalled();
    await component.handlePayment(new Event('click'));

    expect(loadStripeMock).toHaveBeenCalledTimes(1);
    expect(loadStripeMock).toHaveBeenCalledWith('pk_test_real');
    expect(component.isReady()).toBe(true);
    expect(component.error()).toBeNull();
  });

  it('loads Stripe.js with the session connected account on first checkout', async () => {
    const {component} = await setupProductionStripe({
      connectedAccountId: null,
      sessionConnectedAccountId: 'acct_connected_123',
    });

    expect(loadStripeMock).not.toHaveBeenCalled();
    await component.handlePayment(new Event('click'));

    expect(loadStripeMock).toHaveBeenCalledTimes(1);
    expect(loadStripeMock).toHaveBeenCalledWith('pk_test_real', {
      stripeAccount: 'acct_connected_123',
    });
    expect(component.isReady()).toBe(true);
    expect(component.error()).toBeNull();
  });

  it('falls back to the input connected account when the session omits it', async () => {
    const {component} = await setupProductionStripe({
      connectedAccountId: 'acct_input_123',
    });

    await component.handlePayment(new Event('click'));

    expect(loadStripeMock).toHaveBeenCalledWith('pk_test_real', {
      stripeAccount: 'acct_input_123',
    });
  });

  it('uses platform Stripe.js when the session explicitly returns null', async () => {
    const {component} = await setupProductionStripe({
      connectedAccountId: 'acct_stale_input',
      sessionConnectedAccountId: null,
    });

    await component.handlePayment(new Event('click'));

    expect(loadStripeMock).toHaveBeenCalledWith('pk_test_real');
  });

  it('does not load Stripe.js from the network in mock payment mode', async () => {
    await TestBed.configureTestingModule({
      imports: [StripePaymentComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: STRIPE_JS_LOADER, useValue: loadStripeMock},
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(StripePaymentComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('publishableKey', 'pk_test_mock');
    fixture.componentRef.setInput('checkoutSessionFetcher', () =>
      Promise.resolve({clientSecret: 'cs_test_secret'}),
    );
    fixture.componentRef.setInput('mockPayments', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(loadStripeMock).not.toHaveBeenCalled();
    expect(component.isReady()).toBe(true);
    expect(component.error()).toBeNull();
  });

  it('surfaces a checkout start error when Stripe.js fails to load', async () => {
    const {component} = await setupProductionStripe({stripe: null});

    await component.handlePayment(new Event('click'));

    expect(loadStripeMock).toHaveBeenCalledTimes(1);
    expect(component.isReady()).toBe(true);
    expect(component.error()).toBe('Stripe.js failed to load');
  });
});

describe('StripePaymentComponent — resetKey (BRA-395)', () => {
  let fixture: ComponentFixture<StripePaymentComponent>;
  let component: StripePaymentComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StripePaymentComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(StripePaymentComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('publishableKey', 'pk_test_mock');
    fixture.componentRef.setInput('checkoutSessionFetcher', () =>
      Promise.resolve({clientSecret: 'cs_test_secret'}),
    );
    fixture.componentRef.setInput('mockPayments', true);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should not destroy on initial resetKey value of 0', async () => {
    const fakeCheckout = {mount: vi.fn(), destroy: vi.fn()};
    (component as unknown as {embeddedCheckout: unknown}).embeddedCheckout =
      fakeCheckout;
    component.checkoutMounted.set(true);

    fixture.componentRef.setInput('resetKey', 0);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fakeCheckout.destroy).not.toHaveBeenCalled();
    expect(component.checkoutMounted()).toBe(true);
  });

  it('destroys mounted checkout and resets state when resetKey increments', async () => {
    const fakeCheckout = {mount: vi.fn(), destroy: vi.fn()};
    (component as unknown as {embeddedCheckout: unknown}).embeddedCheckout =
      fakeCheckout;
    component.checkoutMounted.set(true);

    fixture.componentRef.setInput('resetKey', 1);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fakeCheckout.destroy).toHaveBeenCalledTimes(1);
    expect(component.checkoutMounted()).toBe(false);
    expect(component.processing()).toBe(false);
    expect(component.error()).toBeNull();
    expect(
      (component as unknown as {embeddedCheckout: unknown}).embeddedCheckout,
    ).toBeNull();
  });

  it('does nothing when resetKey increments but no checkout is mounted', async () => {
    expect(
      (component as unknown as {embeddedCheckout: unknown}).embeddedCheckout,
    ).toBeNull();

    // Should not throw
    fixture.componentRef.setInput('resetKey', 1);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.checkoutMounted()).toBe(false);
  });
});

/**
 * Helper: creates a FailingFetcherHostComponent with a specific fetcher wired in
 * from the start (avoiding OnPush input propagation timing issues).
 */
function createFailingFetcherHost(
  fetcher: () => Promise<{clientSecret: string}>,
) {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [StripePaymentComponent],
    template: `
      <app-stripe-payment
        [publishableKey]="'pk_test_mock'"
        [checkoutSessionFetcher]="checkoutSessionFetcher"
        [mockPayments]="true"
        (paymentConfirmed)="confirmed = true"
        (paymentError)="lastError = $event"
      />
    `,
  })
  class Host {
    confirmed = false;
    lastError: string | null = null;
    checkoutSessionFetcher = fetcher;
  }
  return Host;
}

describe('StripePaymentComponent — fetchClientSecret error handling (BRA-315)', () => {
  async function setupWithFetcher(
    fetcher: () => Promise<{clientSecret: string}>,
  ) {
    const Host = createFailingFetcherHost(fetcher);
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    const fixture = TestBed.createComponent(Host);
    const host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const loader = TestbedHarnessEnvironment.loader(fixture);
    const harness = await loader.getHarness(AppStripePaymentHarness);

    // Get child component to call handlePayment directly (avoids fire-and-forget timing)
    const debugEl = fixture.debugElement.query(
      (de) => de.componentInstance instanceof StripePaymentComponent,
    );
    const paymentComp = debugEl.componentInstance as StripePaymentComponent;

    return {fixture, host, loader, harness, paymentComp};
  }

  it('surfaces the error message when checkoutSessionFetcher rejects', async () => {
    const errorMessage = 'Session creation failed — try again';
    const {fixture, harness, paymentComp} = await setupWithFetcher(async () => {
      throw new Error(errorMessage);
    });

    expect(paymentComp.isReady()).toBe(true);
    await paymentComp.handlePayment(new Event('click'));
    fixture.detectChanges();

    expect(await harness.getErrorText()).toBe(errorMessage);
  });

  it('resets processing to false when checkoutSessionFetcher rejects', async () => {
    const {fixture, harness, paymentComp} = await setupWithFetcher(async () => {
      throw new Error('Network error');
    });

    expect(paymentComp.isReady()).toBe(true);
    await paymentComp.handlePayment(new Event('click'));
    fixture.detectChanges();

    expect(await harness.isLoading()).toBe(false);
    expect(await harness.isReady()).toBe(true);
  });

  it('emits paymentError output when checkoutSessionFetcher rejects', async () => {
    const errorMessage = 'Checkout session unavailable';
    const {fixture, host, paymentComp} = await setupWithFetcher(async () => {
      throw new Error(errorMessage);
    });

    await paymentComp.handlePayment(new Event('click'));
    fixture.detectChanges();

    expect(host.lastError).toBe(errorMessage);
    expect(host.confirmed).toBe(false);
  });

  it('uses a fallback message when checkoutSessionFetcher rejects with a non-Error', async () => {
    const {fixture, harness, paymentComp} = await setupWithFetcher(
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- intentionally testing non-Error rejection
      () => Promise.reject('string rejection'),
    );

    await paymentComp.handlePayment(new Event('click'));
    fixture.detectChanges();

    expect(await harness.getErrorText()).toBe(
      'Failed to start secure checkout',
    );
  });
});
