/**
 * Unit tests for StripeConnectEmbedComponent — F6 coverage.
 *
 * Focuses on the component-set change detection: when `components()` expands
 * beyond what the current Account Session was minted for, the existing
 * `StripeConnectInstance` must be torn down (logout + clear) and a new
 * instance created via `loadConnectAndInitialize`.
 */
import '../../../../../test-setup';
import {describe, it, expect, vi, beforeEach, type Mock} from 'vitest';
import {
  Component,
  ChangeDetectionStrategy,
  provideZonelessChangeDetection,
  computed,
  signal,
} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {CONVEX} from 'convex-angular';
import {StripeConnectEmbedComponent} from './stripe-connect-embed.component';
import {STRIPE_CONNECT_APPEARANCE_PALETTE} from '@/utils/brand-palette';
import type {
  IStripeConnectInitParams,
  IStripeConnectUpdateParams,
  StripeConnectInstance,
} from '@stripe/connect-js';
import {createMockConvexClient} from '../../../../../testing/mock-types';
import type {Id} from '@convex/_generated/dataModel';
import type {StripeConnectComponentKind} from './stripe-connect-embed.component';
import {mountMockConnectComponents} from './stripe-connect-embed.mock';
import {BraDarkMode, EDarkModes} from '@ui/services/dark-mode';

// ---------------------------------------------------------------------------
// Environment mock — disable mockPayments so the real `loadConnectAndInitialize`
// branch runs (we mock that function below).
// ---------------------------------------------------------------------------
vi.mock('../../../../../environments/environment', () => ({
  environment: {
    stripe: {publishableKey: 'pk_test_mock', mockPayments: false},
  },
}));

// ---------------------------------------------------------------------------
// Mock the Stripe Connect JS SDK so tests never hit the CDN.
// We track calls to `loadConnectAndInitialize` and expose a mock instance.
// ---------------------------------------------------------------------------
let mockInstanceLogout: Mock<() => Promise<void>>;
let mockInstanceCreate: Mock<() => HTMLElement>;
let mockInstanceUpdate: Mock<(options: IStripeConnectUpdateParams) => void>;
let mockInstance: Partial<StripeConnectInstance>;
const loadConnectSpy: Mock<(params: IStripeConnectInitParams) => void> =
  vi.fn();

vi.mock('@stripe/connect-js', () => ({
  loadConnectAndInitialize: (...args: unknown[]) => {
    loadConnectSpy(...(args as [IStripeConnectInitParams]));
    return mockInstance;
  },
}));

const FAKE_ORG_ID = 'org-stripe-test' as Id<'organizers'>;

function lastConnectInitParams(): IStripeConnectInitParams {
  const params = loadConnectSpy.mock.calls.at(-1)?.[0];
  if (!params) {
    throw new Error('Expected loadConnectAndInitialize to be called');
  }
  return params;
}

function lastConnectUpdateParams(): IStripeConnectUpdateParams {
  const params = mockInstanceUpdate.mock.calls.at(-1)?.[0];
  if (!params) {
    throw new Error('Expected Stripe Connect update to be called');
  }
  return params;
}

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

async function setup(
  initialComponents: readonly StripeConnectComponentKind[],
  options: {themeMode?: EDarkModes.LIGHT | EDarkModes.DARK} = {},
) {
  const convexMock = createMockConvexClient();
  convexMock.action.mockResolvedValue({clientSecret: 'cs_test_secret'});

  const componentsSignal =
    signal<readonly StripeConnectComponentKind[]>(initialComponents);
  const themeModeSignal = signal(options.themeMode ?? EDarkModes.LIGHT);
  const darkModeStub = {
    themeMode: computed(() => themeModeSignal()),
  } satisfies Pick<BraDarkMode, 'themeMode'>;

  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [StripeConnectEmbedComponent],
    template: `
      <app-stripe-connect-embed
        [organizerId]="orgId"
        [components]="components()"
      />
    `,
  })
  class DynamicHostComponent {
    readonly orgId = FAKE_ORG_ID;
    readonly components = componentsSignal;
  }

  await TestBed.configureTestingModule({
    imports: [DynamicHostComponent],
    providers: [
      provideZonelessChangeDetection(),
      {provide: CONVEX, useValue: convexMock},
      {provide: BraDarkMode, useValue: darkModeStub},
    ],
  }).compileComponents();

  const fixture: ComponentFixture<DynamicHostComponent> =
    TestBed.createComponent(DynamicHostComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  return {fixture, convexMock, componentsSignal, themeModeSignal};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StripeConnectEmbedComponent — component-set change detection (F6)', () => {
  beforeEach(() => {
    loadConnectSpy.mockClear();
    mockInstanceLogout = vi.fn().mockResolvedValue(undefined);
    mockInstanceCreate = vi.fn().mockReturnValue(document.createElement('div'));
    mockInstanceUpdate = vi.fn();
    mockInstance = {
      logout: mockInstanceLogout,
      create: mockInstanceCreate as unknown as StripeConnectInstance['create'],
      update: mockInstanceUpdate,
    };
  });

  it('initializes a Stripe Connect instance on first mount', async () => {
    await setup(['account-onboarding']);
    expect(loadConnectSpy).toHaveBeenCalledTimes(1);
  });

  it('initializes Stripe Connect with dark-mode appearance variables', async () => {
    await setup(['account-onboarding'], {themeMode: EDarkModes.DARK});

    const variables = lastConnectInitParams().appearance?.variables;
    expect(variables).toMatchObject(STRIPE_CONNECT_APPEARANCE_PALETTE.dark);
  });

  it('updates appearance on theme changes without rebuilding the account session', async () => {
    const {fixture, themeModeSignal} = await setup(['account-onboarding']);

    expect(loadConnectSpy).toHaveBeenCalledTimes(1);
    expect(mockInstanceUpdate).not.toHaveBeenCalled();

    themeModeSignal.set(EDarkModes.DARK);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(loadConnectSpy).toHaveBeenCalledTimes(1);
    expect(mockInstanceLogout).not.toHaveBeenCalled();
    const variables = lastConnectUpdateParams().appearance?.variables;
    expect(variables).toMatchObject(STRIPE_CONNECT_APPEARANCE_PALETTE.dark);
  });

  it('calls logout and re-initializes when components expand beyond the minted session (F6)', async () => {
    const {fixture, componentsSignal} = await setup(['account-onboarding']);

    // After initial mount, one loadConnect call for ['account-onboarding']
    expect(loadConnectSpy).toHaveBeenCalledTimes(1);
    expect(mockInstanceLogout).not.toHaveBeenCalled();

    // Replace mock instance reference before the second rebuild so we can
    // assert the old instance's logout was called. The new rebuild will
    // see `this.instance = null` after logout and call loadConnectAndInitialize
    // again with a fresh mockInstance value.
    const firstInstance = mockInstance;
    const secondInstanceLogout = vi.fn().mockResolvedValue(undefined);
    const secondInstanceCreate = vi
      .fn()
      .mockReturnValue(document.createElement('div'));
    mockInstance = {
      logout: secondInstanceLogout,
      create: secondInstanceCreate,
      update: vi.fn(),
    };

    // Swap to a non-subset component set for the same organizer
    componentsSignal.set(['account-management', 'notification-banner']);
    fixture.detectChanges();
    await fixture.whenStable();

    // Old instance must have been logged out
    expect(firstInstance.logout).toHaveBeenCalledTimes(1);
    // loadConnectAndInitialize must have been called a second time
    expect(loadConnectSpy).toHaveBeenCalledTimes(2);
  });

  it('does NOT call logout when switching to a subset of the minted components', async () => {
    // Start with account-management + notification-banner
    const {fixture, componentsSignal} = await setup([
      'account-management',
      'notification-banner',
    ]);

    expect(loadConnectSpy).toHaveBeenCalledTimes(1);

    // Switch to just account-management — a strict subset
    componentsSignal.set(['account-management']);
    fixture.detectChanges();
    await fixture.whenStable();

    // Instance should be reused, no logout
    expect(mockInstanceLogout).not.toHaveBeenCalled();
    // No second loadConnectAndInitialize call
    expect(loadConnectSpy).toHaveBeenCalledTimes(1);
  });
});

describe('mountMockConnectComponents', () => {
  it('renders placeholders with the branded mono label treatment', () => {
    const host = document.createElement('div');

    mountMockConnectComponents(host, ['account-onboarding']);

    const placeholder = host.querySelector<HTMLElement>(
      '[data-testid="stripe-connect-account-onboarding"]',
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder?.style.fontFamily).toContain('var(--font-mono');
    expect(placeholder?.style.fontSize).toBe('0.625rem');
    expect(placeholder?.style.lineHeight).toBe('1rem');
    expect(placeholder?.style.textTransform).toBe('uppercase');
    expect(placeholder?.style.letterSpacing).toBe('0.1em');
  });
});
