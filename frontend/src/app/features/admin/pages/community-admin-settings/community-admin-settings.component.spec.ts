import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {getFunctionName} from 'convex/server';
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {of} from 'rxjs';
import {CommunityAdminSettingsComponent} from './community-admin-settings.component';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {CommunityContextService} from '@/features/admin/services/community-context.service';
import type {Id} from '@convex/_generated/dataModel';
import {createMockConvexClient} from '../../../../../testing/mock-types';
import {toast} from 'ngx-sonner';
import {CommunityAdminSettingsHarness} from './community-admin-settings.component.harness';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_ORG_ID = 'org-abc' as Id<'organizers'>;

// Emit a Convex subscription result asynchronously (next microtask), mirroring
// the real ConvexReactClient, which never invokes the onUpdate callback
// synchronously from within onUpdate(). injectQueries() registers each key's
// subscription *after* calling convex.onUpdate(...), and its staleness guard
// drops any emission that arrives before registration completes — so a
// synchronous emit is silently discarded. Every INITIAL mock emission must go
// through this. `await fixture.whenStable()` (and advanceTimersByTimeAsync,
// which faketimers leaves microtasks real for) flushes the queued microtask.
function emitAsync(fn: () => void): void {
  queueMicrotask(fn);
}

function makeCommunityContextMock(options: {
  selectedId?: Id<'organizers'> | null;
}) {
  // Backed by a real signal so components' computeds that read
  // `selectedCommunityId()` recompute when a test changes the selected
  // community (mirrors production, where this is a `computed` signal).
  const selectedCommunityId = signal<Id<'organizers'> | null>(
    options.selectedId ?? FAKE_ORG_ID,
  );
  return {
    isLoading: vi.fn(() => false),
    selectedCommunityId,
    selectedCommunityName: vi.fn(() => 'Test Community'),
    hasMultipleCommunities: vi.fn(() => false),
    communities: vi.fn(() => [FAKE_ORG_ID]),
    selectCommunity: vi.fn(),
    setResolvedNames: vi.fn(),
    resolvedNameFor: vi.fn((_id: unknown) => null),
  };
}

async function setup(options?: {
  selectedId?: Id<'organizers'> | null;
  organizerData?: Record<string, unknown>;
  adminData?: unknown[];
  scannerData?: unknown[];
  searchResultsData?: unknown[];
  deferSearch?: boolean;
  notifPrefData?: {mode: 'all' | 'digest'; digestHour: number} | null;
  queryParams?: Record<string, string | null>;
}) {
  const ctxMock = makeCommunityContextMock({
    selectedId:
      options?.selectedId !== undefined ? options.selectedId : FAKE_ORG_ID,
  });

  let orgData = options?.organizerData ?? {
    _id: FAKE_ORG_ID,
    name: 'Test Community',
    email: 'test@example.com',
    contactInfo: 'Call us',
    vettingQuestions: [],
  };
  const adminData = options?.adminData ?? [];
  const scannerData = options?.scannerData ?? [];
  // undefined means "not provided" (use default null); null means "no pref stored"
  const notifPrefData =
    options?.notifPrefData !== undefined ? options.notifPrefData : null;
  let organizerQueryOnData: ((data: unknown) => void) | null = null;

  const searchResultsData = options?.searchResultsData ?? [];
  // When set, the search query does NOT auto-resolve. Instead every
  // subscription is recorded so a test can resolve a specific in-flight
  // request by hand and assert the stale-data window.
  const deferSearch = options?.deferSearch ?? false;
  const searchSubscriptions: {
    args: {organizerId: string; searchTerm: string};
    onData: (data: unknown) => void;
  }[] = [];
  const convexMock = createMockConvexClient();
  const query = vi.fn().mockResolvedValue(null);
  const mutation = vi.fn().mockResolvedValue(null);
  const onUpdate = vi
    .fn()
    .mockImplementation(
      (queryRef: unknown, _args: unknown, onData: (data: unknown) => void) => {
        // Discriminate by the query's stable function name rather than args
        // shape + call order — args-shape routing silently misroutes any new
        // query that also carries `organizerId` (e.g. searchGrantCandidates).
        // Note: `api.x.y` (Convex's `anyApi` proxy) returns a NEW proxy object
        // on every property access, so `===` between two separate accesses is
        // always false — `getFunctionName` is the stable identity to compare.
        const name = getFunctionName(
          queryRef as Parameters<typeof getFunctionName>[0],
        );
        if (name === getFunctionName(api.communities.profile.getAdmin)) {
          organizerQueryOnData = onData;
          emitAsync(() => onData(orgData));
        } else if (
          name === getFunctionName(api.communities.admins.listByCommunity)
        ) {
          emitAsync(() => onData(adminData));
        } else if (
          name === getFunctionName(api.communities.scanners.listByCommunity)
        ) {
          emitAsync(() => onData(scannerData));
        } else if (
          name ===
          getFunctionName(
            api.communities.management.notification_preferences
              .getMyNotificationPreference,
          )
        ) {
          emitAsync(() => onData(notifPrefData));
        } else if (
          name ===
          getFunctionName(api.communities.scanners.searchGrantCandidates)
        ) {
          if (deferSearch) {
            searchSubscriptions.push({
              args: _args as {organizerId: string; searchTerm: string},
              onData,
            });
          } else {
            emitAsync(() => onData(searchResultsData));
          }
        } else {
          emitAsync(() => onData([]));
        }
        return () => void 0;
      },
    );

  const refreshOrganizerQuery = (nextData: Record<string, unknown>): void => {
    orgData = nextData;
    organizerQueryOnData?.(orgData);
  };

  convexMock.query = query;
  convexMock.client.query = query;
  convexMock.onUpdate = onUpdate;
  convexMock.client.onUpdate = onUpdate;
  convexMock.mutation = mutation;
  convexMock.client.mutation = mutation;

  const dialogMock = {
    create: vi.fn(),
  };
  const routerMock = {
    navigate: vi.fn().mockResolvedValue(true),
  };

  const routeMock = {
    queryParamMap: of(convertToParamMap(options?.queryParams ?? {})),
    snapshot: {
      queryParamMap: {
        get: (key: string) => options?.queryParams?.[key] ?? null,
      },
    },
  };

  await TestBed.configureTestingModule({
    imports: [CommunityAdminSettingsComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {provide: CONVEX, useValue: convexMock},
      {provide: BraDialogService, useValue: dialogMock},
      {provide: CommunityContextService, useValue: ctxMock},
      {provide: ActivatedRoute, useValue: routeMock},
      {provide: Router, useValue: routerMock},
    ],
  }).compileComponents();

  const fixture: ComponentFixture<CommunityAdminSettingsComponent> =
    TestBed.createComponent(CommunityAdminSettingsComponent);

  fixture.detectChanges();
  await fixture.whenStable();

  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    CommunityAdminSettingsHarness,
  );

  /**
   * Resolves the most recent in-flight `searchGrantCandidates` subscription
   * whose args match `searchTerm` (and optionally `organizerId`), pushing
   * `data` through its `onData`. Use with `deferSearch: true` to control the
   * in-flight window and assert stale-data handling.
   */
  const resolveSearch = (
    searchTerm: string,
    data: unknown[],
    organizerId?: string,
  ): boolean => {
    for (let i = searchSubscriptions.length - 1; i >= 0; i--) {
      const sub = searchSubscriptions[i];
      if (
        sub.args.searchTerm === searchTerm &&
        (organizerId === undefined || sub.args.organizerId === organizerId)
      ) {
        sub.onData(data);
        return true;
      }
    }
    return false;
  };

  return {
    fixture,
    harness,
    ctxMock,
    convexMock,
    dialogMock,
    routerNavigateSpy: routerMock.navigate,
    routeMock,
    refreshOrganizerQuery,
    resolveSearch,
    searchSubscriptions,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommunityAdminSettingsComponent', () => {
  it('should create', async () => {
    const {fixture} = await setup();
    expect(fixture.componentInstance).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Sections render
  // -----------------------------------------------------------------------

  describe('sections', () => {
    it('shows skeleton when organizer query is loading', async () => {
      const ctxMock = makeCommunityContextMock({selectedId: FAKE_ORG_ID});
      const convexMock = createMockConvexClient();
      // onUpdate never calls onData — simulates a pending query
      convexMock.client.onUpdate = vi.fn().mockReturnValue(() => void 0);

      await TestBed.configureTestingModule({
        imports: [CommunityAdminSettingsComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([]),
          {provide: CONVEX, useValue: convexMock},
          {provide: BraDialogService, useValue: {create: vi.fn()}},
          {provide: CommunityContextService, useValue: ctxMock},
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(CommunityAdminSettingsComponent);
      fixture.detectChanges();
      await fixture.whenStable();

      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        CommunityAdminSettingsHarness,
      );

      expect(await harness.hasSettingsSkeleton()).toBe(true);
      expect(await harness.hasProfileSection()).toBe(false);
    });

    it('renders the profile section', async () => {
      const {harness} = await setup();
      expect(await harness.hasProfileSection()).toBe(true);
    });

    it('renders the payments section', async () => {
      const {harness} = await setup();
      expect(await harness.hasPaymentsSection()).toBe(true);
    });

    it('renders the vetting questions section', async () => {
      const {harness} = await setup();
      expect(await harness.hasVettingSection()).toBe(true);
    });

    it('renders the team management section', async () => {
      const {harness} = await setup();
      expect(await harness.hasTeamSection()).toBe(true);
    });

    it('restricts the logo upload input to accepted raster image formats', async () => {
      const {harness} = await setup();
      expect(await harness.getLogoUploadAccept()).toBe(
        'image/jpeg,image/png,image/gif,image/webp',
      );
    });

    it('rejects unsupported logo files like CSV and shows the accepted formats', async () => {
      const {fixture} = await setup();
      const toastSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');
      const host = fixture.nativeElement as unknown as HTMLElement;
      const input = host.querySelector<HTMLInputElement>('#logoUpload');
      if (!input) {
        throw new Error('Expected logo upload input');
      }

      try {
        const file = new File(['name,email'], 'logo.csv', {type: 'text/csv'});
        Object.defineProperty(input, 'files', {
          configurable: true,
          value: [file],
        });

        input.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        await fixture.whenStable();

        expect(fixture.componentInstance.logoFile()).toBeNull();
        expect(fixture.componentInstance.logoFileName()).toBe('');
        expect(input.value).toBe('');
        expect(toastSpy).toHaveBeenCalledWith(
          'Unsupported file type. Accepted formats: JPG, PNG, GIF, WEBP.',
        );
      } finally {
        toastSpy.mockRestore();
      }
    });

    it('clears an existing local logo preview when a replacement file is unsupported', async () => {
      const {fixture} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          slug: 'test-community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [],
          logoUrl: 'https://example.com/logo.png',
        },
      });
      const toastSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');
      const revokeObjectURLSpy = vi
        .spyOn(URL, 'revokeObjectURL')
        .mockReturnValue(undefined);
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:logo-preview');

      try {
        const component = fixture.componentInstance;
        const host = fixture.nativeElement as unknown as HTMLElement;
        const input = host.querySelector<HTMLInputElement>('#logoUpload');
        if (!input) {
          throw new Error('Expected logo upload input');
        }

        const validFile = new File(['image-bytes'], 'logo.png', {
          type: 'image/png',
        });
        Object.defineProperty(input, 'files', {
          configurable: true,
          value: [validFile],
        });
        input.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        await fixture.whenStable();

        const invalidFile = new File(['name,email'], 'logo.csv', {
          type: 'text/csv',
        });
        Object.defineProperty(input, 'files', {
          configurable: true,
          value: [invalidFile],
        });
        input.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.logoFile()).toBeNull();
        expect(component.logoFileName()).toBe('');
        expect(component.logoPreviewUrl()).toBe('https://example.com/logo.png');
        expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:logo-preview');
        expect(toastSpy).toHaveBeenCalledWith(
          'Unsupported file type. Accepted formats: JPG, PNG, GIF, WEBP.',
        );
      } finally {
        toastSpy.mockRestore();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Stripe Connect
  // -----------------------------------------------------------------------

  describe('Stripe Connect', () => {
    it('connectWithStripe calls createConnectedAccount then refreshes status via checkAccountStatus', async () => {
      const {harness, convexMock} = await setup({
        queryParams: {
          community: 'test-community',
        },
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          slug: 'test-community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [],
        },
      });

      let actionCallIndex = 0;
      convexMock.action.mockImplementation(() => {
        if (actionCallIndex === 0) {
          actionCallIndex += 1;
          return {
            stripeConnectedAccountId: 'acct_test123',
            alreadyExists: false,
          };
        }
        if (actionCallIndex === 1) {
          actionCallIndex += 1;
          return {
            chargesEnabled: false,
            payoutsEnabled: false,
            userRequirementsClear: false,
            onboardingStatus: 'in_progress',
            currentlyDue: ['kyc.pending'],
            chargeReady: false,
            payoutReady: false,
          };
        }
        // Further calls come from the embedded component fetching an
        // Account Session. Return a stub secret so it doesn't throw.
        return {clientSecret: 'secret_test'};
      });

      await harness.clickConnectWithStripe();

      // V2: createConnectedAccount + checkAccountStatus, no redirect.
      const createArgs: unknown = convexMock.action.mock.calls[0]?.[1];
      if (!createArgs || typeof createArgs !== 'object') {
        throw new Error('Expected createConnectedAccount call arguments');
      }
      expect(Reflect.get(createArgs, 'organizerId')).toBe(FAKE_ORG_ID);

      const statusArgs: unknown = convexMock.action.mock.calls[1]?.[1];
      if (!statusArgs || typeof statusArgs !== 'object') {
        throw new Error('Expected checkAccountStatus call arguments');
      }
      expect(Reflect.get(statusArgs, 'organizerId')).toBe(FAKE_ORG_ID);

      // V2 flow continues in embedded components (account link is optional and
      // only used for hosted KYC when required).
      expect(Reflect.has(createArgs, 'returnKind')).toBe(false);
    });

    it('renders the embedded Connect component once the organizer has a Stripe account', async () => {
      const {harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [],
          stripeConnectedAccountId: 'acct_existing',
          stripeOnboardingStatus: 'complete',
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
          organizerPaymentReady: true,
        },
      });

      expect(await harness.hasStripeConnectEmbed()).toBe(true);
    });

    it('renders the embedded Connect component for a connected-but-incomplete account (BRA-392)', async () => {
      const {harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [],
          stripeConnectedAccountId: 'acct_existing',
          stripeOnboardingStatus: 'in_progress',
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
          organizerPaymentReady: false,
        },
      });

      // Embed is shown even before KYC — account-onboarding component mounts
      // as the primary path; hosted onboarding CTA is the fallback.
      expect(await harness.hasStripeConnectEmbed()).toBe(true);
    });

    it('shows onboarding-incomplete status when account is connected but KYC not done (BRA-391)', async () => {
      const {harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [],
          stripeConnectedAccountId: 'acct_existing',
          stripeOnboardingStatus: 'in_progress',
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
        },
      });

      expect(await harness.isStripeOnboardingIncomplete()).toBe(true);
      expect(await harness.isStripeConnected()).toBe(false);
    });

    it('shows payments-enabled status only when onboarding is complete (BRA-391)', async () => {
      const {harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [],
          stripeConnectedAccountId: 'acct_existing',
          stripeOnboardingStatus: 'restricted',
          stripeChargesEnabled: true,
          stripePayoutsEnabled: false,
          organizerPaymentReady: true,
        },
      });

      expect(await harness.isStripeConnected()).toBe(true);
      expect(await harness.isStripeOnboardingIncomplete()).toBe(false);
    });

    it('conveys Stripe charges/payouts/user-steps state as visible text, not dot color alone', async () => {
      const {fixture, harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [],
          stripeConnectedAccountId: 'acct_existing',
          stripeOnboardingStatus: 'in_progress',
          stripeChargesEnabled: true,
          stripePayoutsEnabled: false,
          organizerPaymentReady: false,
        },
      });

      fixture.componentInstance.stripeStatus.set({
        chargesEnabled: true,
        payoutsEnabled: false,
        userRequirementsClear: false,
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(await harness.getStripeChargesStateText()).toBe('enabled');
      expect(await harness.getStripePayoutsStateText()).toBe('pending');
      expect(await harness.getStripeUserStepsStateText()).toBe('pending');
    });

    it('shows "Continue Setup on Stripe" CTA for connected-but-incomplete account (BRA-393)', async () => {
      const {fixture} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [],
          stripeConnectedAccountId: 'acct_existing',
          stripeOnboardingStatus: 'in_progress',
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
          organizerPaymentReady: false,
        },
      });

      const host = fixture.nativeElement as HTMLElement;
      const cta = host.querySelector(
        '[data-testid="continue-stripe-onboarding-btn"]',
      );
      expect(cta).not.toBeNull();
    });

    it('continues hosted Stripe onboarding', async () => {
      const originSpy = vi
        .spyOn(BrowserPlatformService.prototype, 'origin')
        .mockReturnValue('https://dev.community.braket.gay');
      const assignSpy = vi
        .spyOn(BrowserPlatformService.prototype, 'assign')
        .mockImplementation(() => undefined);
      const {harness, convexMock} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [],
          stripeConnectedAccountId: 'acct_existing',
          stripeOnboardingStatus: 'in_progress',
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
          organizerPaymentReady: false,
        },
      });

      convexMock.action.mockResolvedValue({
        url: 'https://connect.stripe.test/onboarding-link',
      });

      await harness.clickContinueStripeOnboarding();

      expect(convexMock.action).toHaveBeenCalledWith(
        api.stripe.actions.createAccountOnboardingLink,
        {
          organizerId: FAKE_ORG_ID,
          returnOrigin: 'https://dev.community.braket.gay',
        },
      );
      expect(assignSpy).toHaveBeenCalledWith(
        'https://connect.stripe.test/onboarding-link',
      );

      originSpy.mockRestore();
      assignSpy.mockRestore();
    });

    it('passes the current browser origin when opening hosted Stripe onboarding', async () => {
      const originSpy = vi
        .spyOn(BrowserPlatformService.prototype, 'origin')
        .mockReturnValue('https://dev.community.braket.gay');
      const assignSpy = vi
        .spyOn(BrowserPlatformService.prototype, 'assign')
        .mockImplementation(() => undefined);
      const {fixture, convexMock} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [],
          stripeConnectedAccountId: 'acct_existing',
          stripeOnboardingStatus: 'in_progress',
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
          organizerPaymentReady: false,
        },
      });
      convexMock.action.mockResolvedValue({
        url: 'https://connect.stripe.test/onboarding-link',
      });

      await fixture.componentInstance.openStripeOnboarding();

      expect(convexMock.action).toHaveBeenCalledWith(
        api.stripe.actions.createAccountOnboardingLink,
        {
          organizerId: FAKE_ORG_ID,
          returnOrigin: 'https://dev.community.braket.gay',
        },
      );
      expect(assignSpy).toHaveBeenCalledWith(
        'https://connect.stripe.test/onboarding-link',
      );

      originSpy.mockRestore();
      assignSpy.mockRestore();
    });

    it('stripeOnboardingReturn=1 calls checkAccountStatus with community param as organizerId then clears URL', async () => {
      const {fixture, convexMock, routerNavigateSpy} = await setup({
        queryParams: {
          community: FAKE_ORG_ID,
          stripeOnboardingReturn: '1',
        },
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [],
        },
      });

      convexMock.action.mockResolvedValue({
        chargesEnabled: true,
        payoutsEnabled: true,
        userRequirementsClear: true,
        onboardingStatus: 'complete',
        currentlyDue: [],
        chargeReady: true,
        payoutReady: true,
      });

      fixture.detectChanges();
      await fixture.whenStable();

      // checkAccountStatus must be called with the organizerId from ?community=
      expect(convexMock.action).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({organizerId: FAKE_ORG_ID}),
      );

      // URL cleanup must null out stripeOnboardingReturn and community
      expect(routerNavigateSpy).toHaveBeenCalledWith([], {
        relativeTo: TestBed.inject(ActivatedRoute),
        queryParams: {
          stripeOnboardingReturn: null,
          stripeOnboardingRefresh: null,
          community: null,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    it('stripeOnboardingRefresh=1 does not call checkAccountStatus', async () => {
      const {fixture, convexMock, routerNavigateSpy} = await setup({
        queryParams: {
          community: 'test-community',
          stripeOnboardingRefresh: '1',
        },
      });

      fixture.detectChanges();
      await fixture.whenStable();

      expect(routerNavigateSpy).toHaveBeenCalledWith([], {
        relativeTo: TestBed.inject(ActivatedRoute),
        queryParams: {
          stripeOnboardingReturn: null,
          stripeOnboardingRefresh: null,
          community: null,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      expect(convexMock.action).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Profile form
  // -----------------------------------------------------------------------

  describe('profile form', () => {
    it('binds organizer name to profile form', async () => {
      const {fixture} = await setup();
      // After effect syncs, the model should reflect organizer data
      expect(fixture.componentInstance.profileModel().name).toBe(
        'Test Community',
      );
    });

    it('binds organizer email to profile form', async () => {
      const {fixture} = await setup();
      expect(fixture.componentInstance.profileModel().email).toBe(
        'test@example.com',
      );
    });

    it('binds organizer contactInfo to profile form', async () => {
      const {fixture} = await setup();
      expect(fixture.componentInstance.profileModel().contactInfo).toBe(
        'Call us',
      );
    });

    it('description textarea renders in profile section', async () => {
      const {harness} = await setup();
      expect(await harness.hasProfileDescription()).toBe(true);
    });

    it('website input renders in profile section', async () => {
      const {harness} = await setup();
      expect(await harness.hasProfileWebsite()).toBe(true);
    });

    it('slug input renders in profile section', async () => {
      const {harness} = await setup();
      expect(await harness.hasProfileSlug()).toBe(true);
    });

    it('binds organizer slug to profile form', async () => {
      const {fixture} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          slug: 'test-community',
          vettingQuestions: [],
        },
      });
      expect(fixture.componentInstance.profileModel().slug).toBe(
        'test-community',
      );
    });

    it('logo upload input renders in profile section', async () => {
      const {harness} = await setup();
      expect(await harness.hasLogoUpload()).toBe(true);
    });

    it('logo label is linked to upload input for accessibility', async () => {
      const {harness} = await setup();
      const labelFor = await harness.getLogoLabelFor();
      const inputId = await harness.getLogoUploadId();
      expect(labelFor).toBe('logoUpload');
      expect(inputId).toBe('logoUpload');
      expect(labelFor).toBe(inputId);
    });

    it('public directory toggle renders in profile section', async () => {
      const {harness} = await setup();
      expect(await harness.hasPublicDirectoryToggle()).toBe(true);
    });

    it('status controls render in profile section', async () => {
      const {harness} = await setup();
      expect(await harness.hasProfileStatusDraft()).toBe(true);
      expect(await harness.hasProfileStatusPublished()).toBe(true);
    });

    it('save button is disabled on fresh page load before user interaction (BRA-77)', async () => {
      const {harness} = await setup();

      // Save button should be disabled because profileDirty is false
      expect(await harness.isSaveButtonDisabled()).toBe(true);
    });

    it('save button stays disabled after organizer data loads — no false dirty (BRA-136)', async () => {
      const {fixture, harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Loaded Community',
          email: 'loaded@example.com',
          contactInfo: 'Phone',
          description: 'A cool place',
          website: 'https://example.com',
          isPublicDirectory: true,
          vettingQuestions: [],
        },
      });

      // After data loads, profileDirty should be false (model === pristine)
      expect(fixture.componentInstance.profileDirty()).toBe(false);
      expect(await harness.isSaveButtonDisabled()).toBe(true);
    });

    it('save button re-disables when user reverts changes to original values (BRA-136)', async () => {
      const {fixture, harness} = await setup();

      // Initially disabled
      expect(await harness.isSaveButtonDisabled()).toBe(true);

      // User changes name
      await harness.typeInProfileName('Different Name');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(await harness.isSaveButtonDisabled()).toBe(false);

      // User reverts to original name
      await harness.typeInProfileName('Test Community');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(await harness.isSaveButtonDisabled()).toBe(true);
    });

    it('keeps unsaved profile edits when the same community query refreshes', async () => {
      const {fixture, harness, refreshOrganizerQuery} = await setup();

      fixture.componentInstance.profileModel.update((m) => ({
        ...m,
        name: 'Modified Name',
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      refreshOrganizerQuery({
        _id: FAKE_ORG_ID,
        name: 'Server Refresh Name',
        email: 'refreshed@example.com',
        contactInfo: 'Call us',
        vettingQuestions: [],
      });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.profileModel().name).toBe(
        'Modified Name',
      );
      expect(fixture.componentInstance.profileDirty()).toBe(true);
      expect(await harness.isSaveButtonDisabled()).toBe(false);
    });

    it('clears profile dirty state after a successful save', async () => {
      const {fixture, harness, convexMock} = await setup();

      fixture.componentInstance.profileModel.update((m) => ({
        ...m,
        name: 'Saved Name',
      }));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fixture.componentInstance.profileDirty()).toBe(true);
      expect(await harness.isSaveButtonDisabled()).toBe(false);

      await fixture.componentInstance.saveProfile();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(convexMock.mutation).toHaveBeenCalled();
      expect(fixture.componentInstance.profileDirty()).toBe(false);
      expect(await harness.isSaveButtonDisabled()).toBe(true);
    });

    it('sends null for cleared profile fields so the backend removes them', async () => {
      const {fixture, convexMock} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          description: 'A cool place',
          website: 'https://example.com',
          slug: 'test-community',
          vettingQuestions: [],
        },
      });

      fixture.componentInstance.profileModel.update((m) => ({
        ...m,
        email: '',
        contactInfo: '',
        description: '',
        website: '',
        slug: '',
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      await fixture.componentInstance.saveProfile();

      const callArgs = convexMock.mutation.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      // Explicit null (not undefined) is the wire signal that persists a clear.
      expect(callArgs).toHaveProperty('email', null);
      expect(callArgs).toHaveProperty('contactInfo', null);
      expect(callArgs).toHaveProperty('description', null);
      expect(callArgs).toHaveProperty('website', null);
      // slug is intentionally NOT clearable (public URL key): a blank value is
      // sent as undefined so the backend leaves the stored slug unchanged.
      expect(callArgs['slug']).toBeUndefined();
    });

    it('save button becomes enabled after user edits profile name', async () => {
      const {fixture, harness} = await setup();

      // Initially disabled
      expect(await harness.isSaveButtonDisabled()).toBe(true);

      // Simulate user typing
      await harness.typeInProfileName('New Name');
      fixture.detectChanges();
      await fixture.whenStable();

      // Should be enabled now
      expect(await harness.isSaveButtonDisabled()).toBe(false);
    });

    it('changing status marks profile as dirty', async () => {
      const {fixture, harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          status: 'draft',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
          ],
        },
      });
      expect(await harness.isSaveButtonDisabled()).toBe(true);

      await harness.clickProfileStatusPublished();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.profileModel().status).toBe('published');
      expect(await harness.isSaveButtonDisabled()).toBe(false);
    });

    it('visibility toggle buttons have aria-pressed reflecting current status', async () => {
      const {fixture, harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          status: 'draft',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
          ],
        },
      });

      // Default status is 'draft'
      expect(await harness.getDraftAriaPressed()).toBe('true');
      expect(await harness.getPublishedAriaPressed()).toBe('false');

      // Switch to published
      await harness.clickProfileStatusPublished();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getDraftAriaPressed()).toBe('false');
      expect(await harness.getPublishedAriaPressed()).toBe('true');
    });
  });

  // -----------------------------------------------------------------------
  // Name and description length validation (BRA-332)
  // -----------------------------------------------------------------------

  describe('name and description length validation (BRA-332)', () => {
    it('shows name char counter with initial count', async () => {
      const {harness} = await setup();
      // "Test Community" has 14 chars
      const counterText = await harness.getNameCharCountText();
      expect(counterText).toBe('14/200');
    });

    it('shows description char counter at zero when description is empty', async () => {
      const {harness} = await setup();
      const counterText = await harness.getDescriptionCharCountText();
      expect(counterText).toBe('0/2000');
    });

    it('shows description char counter with loaded description', async () => {
      const description = 'A cool community';
      const {harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          description,
          vettingQuestions: [],
        },
      });
      const counterText = await harness.getDescriptionCharCountText();
      expect(counterText).toBe(`${description.length}/2000`);
    });

    it('name char counter updates as user types', async () => {
      const {fixture, harness} = await setup();

      await harness.setProfileName('Hi');
      fixture.detectChanges();
      await fixture.whenStable();

      const counterText = await harness.getNameCharCountText();
      expect(counterText).toBe('2/200');
    });

    it('save button is disabled when name is whitespace-only', async () => {
      const {fixture, harness} = await setup();

      fixture.componentInstance.profileModel.update((m) => ({
        ...m,
        name: '   ',
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.isSaveButtonDisabled()).toBe(true);
    });

    it('saveProfile does not call mutation when name is whitespace-only', async () => {
      const {fixture, convexMock} = await setup();

      fixture.componentInstance.profileModel.update((m) => ({
        ...m,
        name: '   ',
      }));
      await fixture.componentInstance.saveProfile();

      expect(convexMock.mutation).not.toHaveBeenCalled();
    });

    it('save button is disabled when name exceeds maxLength', async () => {
      const {fixture, harness} = await setup();

      // Programmatically set a name exceeding 200 chars to trigger validator
      const longName = 'A'.repeat(201);
      fixture.componentInstance.profileModel.update((m) => ({
        ...m,
        name: longName,
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.isSaveButtonDisabled()).toBe(true);
    });

    it('save button is disabled when description exceeds maxLength', async () => {
      const {fixture, harness} = await setup();

      // Programmatically set a description exceeding 2000 chars to trigger validator
      const longDescription = 'B'.repeat(2001);
      fixture.componentInstance.profileModel.update((m) => ({
        ...m,
        description: longDescription,
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.isSaveButtonDisabled()).toBe(true);
    });

    it('name maxlength attribute is set to 200', async () => {
      const {harness} = await setup();
      expect(await harness.getNameInputMaxlength()).toBe('200');
    });

    it('description maxlength attribute is set to 2000', async () => {
      const {harness} = await setup();
      expect(await harness.getDescriptionInputMaxlength()).toBe('2000');
    });

    it('name error message is hidden when name is within limit', async () => {
      const {harness} = await setup();
      expect(await harness.getNameMaxlengthError()).toBeNull();
    });

    it('name error message appears when name exceeds maxLength (programmatic set)', async () => {
      const {fixture, harness} = await setup();

      fixture.componentInstance.profileModel.update((m) => ({
        ...m,
        name: 'A'.repeat(201),
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getNameMaxlengthError()).toContain(
        'NAME EXCEEDS 200 CHARACTER LIMIT',
      );
    });

    it('description error message is hidden when description is within limit', async () => {
      const {harness} = await setup();
      expect(await harness.getDescriptionMaxlengthError()).toBeNull();
    });

    it('description error message appears when description exceeds maxLength (programmatic set)', async () => {
      const {fixture, harness} = await setup();

      fixture.componentInstance.profileModel.update((m) => ({
        ...m,
        description: 'B'.repeat(2001),
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getDescriptionMaxlengthError()).toContain(
        'DESCRIPTION EXCEEDS 2000 CHARACTER LIMIT',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Label associations (BRA-343)
  // -----------------------------------------------------------------------

  describe('label associations (BRA-343)', () => {
    it('profile name input has a programmatic label association', async () => {
      const {harness} = await setup();
      expect(await harness.hasLabelForInput('settings-name')).toBe(true);
    });

    it('profile email input has a programmatic label association', async () => {
      const {harness} = await setup();
      expect(await harness.hasLabelForInput('settings-email')).toBe(true);
    });

    it('contact info input has a programmatic label association', async () => {
      const {harness} = await setup();
      expect(await harness.hasLabelForInput('settings-contactInfo')).toBe(true);
    });

    it('description textarea has a programmatic label association', async () => {
      const {harness} = await setup();
      expect(await harness.hasLabelForInput('settings-description')).toBe(true);
    });

    it('website input has a programmatic label association', async () => {
      const {harness} = await setup();
      expect(await harness.hasLabelForInput('settings-website')).toBe(true);
    });

    it('url slug input has a programmatic label association', async () => {
      const {harness} = await setup();
      expect(await harness.hasLabelForInput('settings-slug')).toBe(true);
    });

    it('code of conduct textarea has a programmatic label association', async () => {
      const {harness} = await setup();
      expect(await harness.hasLabelForInput('settings-codeOfConduct')).toBe(
        true,
      );
    });

    it('public directory checkbox has a programmatic label association', async () => {
      const {harness} = await setup();
      expect(await harness.hasLabelForInput('settings-publicDirectory')).toBe(
        true,
      );
    });

    it('admin email input has an aria-label', async () => {
      const {harness} = await setup();
      expect(await harness.getInputAriaLabel('admin-email-input')).toBe(
        'Admin email address',
      );
    });

    it('scanner search input has an aria-label', async () => {
      const {harness} = await setup();
      expect(await harness.getInputAriaLabel('scanner-search-input')).toBe(
        'Search door staff members',
      );
    });

    it('first vetting question input has a label associated by id', async () => {
      const {fixture, harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
          ],
        },
      });
      fixture.detectChanges();
      await fixture.whenStable();
      expect(await harness.hasLabelForInput('settings-question-0')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------------

  describe('save', () => {
    it('calls communities.update with form data', async () => {
      const {fixture, convexMock} = await setup();

      // Model is already synced via effect
      await fixture.componentInstance.saveProfile();

      expect(convexMock.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: FAKE_ORG_ID,
          name: 'Test Community',
          status: 'draft',
        }),
      );
    });

    it('profile save does NOT send vettingQuestions — prevents data loss (BRA-77)', async () => {
      const {fixture, convexMock} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
            {
              id: 'q-2',
              question: 'Referral?',
              type: 'text',
              required: false,
              options: ['Friend', 'Social'],
            },
          ],
        },
      });

      // Verify initial state
      expect(fixture.componentInstance.vettingModel().length).toBe(2);

      // Modify profile to make it dirty so save will proceed
      fixture.componentInstance.profileModel.update((m) => ({
        ...m,
        name: 'Modified',
      }));
      await fixture.componentInstance.saveProfile();

      // Profile save must NOT include vettingQuestions — decoupled to prevent data loss
      const callArgs = convexMock.mutation.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(callArgs).toHaveProperty('name', 'Modified');
      expect(callArgs).not.toHaveProperty('vettingQuestions');

      // Vetting model should still have both questions after save
      expect(fixture.componentInstance.vettingModel().length).toBe(2);
    });

    it('saveVettingQuestions sends only vetting data (BRA-77)', async () => {
      const {fixture, convexMock} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
          ],
        },
      });

      await fixture.componentInstance.saveVettingQuestions();

      const callArgs = convexMock.mutation.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(callArgs).toHaveProperty('id', FAKE_ORG_ID);
      expect(callArgs).toHaveProperty('vettingQuestions');
      expect(callArgs).not.toHaveProperty('name');
      expect(callArgs).not.toHaveProperty('email');

      const sentQuestions = callArgs['vettingQuestions'] as Record<
        string,
        unknown
      >[];
      expect(sentQuestions).toHaveLength(1);
      expect(sentQuestions[0]).toMatchObject({
        id: 'q-1',
        question: 'Why join?',
      });
    });

    it('saveVettingQuestions is blocked when profile status change is unsaved', async () => {
      const {fixture, convexMock} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          status: 'published',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
          ],
        },
      });
      const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');

      fixture.componentInstance.setProfileStatus('draft');
      await fixture.componentInstance.saveVettingQuestions();

      expect(convexMock.mutation).not.toHaveBeenCalled();
      expect(toastSpy).toHaveBeenCalledWith(
        'Save profile status changes before saving questions.',
      );
      toastSpy.mockRestore();
    });

    it('blocks publishing when there are no vetting questions', async () => {
      const {fixture, convexMock} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          status: 'draft',
          vettingQuestions: [],
        },
      });

      // Bypass the UI guard to simulate a legacy/externally-set 'published'
      // state with no vetting questions, verifying saveProfile() also blocks it.
      fixture.componentInstance.profileModel.update((m) => ({
        ...m,
        status: 'published',
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      await fixture.componentInstance.saveProfile();
      await fixture.whenStable();

      expect(convexMock.mutation).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Vetting questions
  // -----------------------------------------------------------------------

  describe('vetting questions', () => {
    it('save-vetting button hidden when vetting is clean', async () => {
      const {harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
          ],
        },
      });

      expect(await harness.hasSaveVettingButton()).toBe(false);
    });

    it('save-vetting button appears after addQuestion', async () => {
      const {fixture, harness} = await setup();

      fixture.componentInstance.addQuestion();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.hasSaveVettingButton()).toBe(true);
    });

    it('save-vetting button is disabled when profile status change is unsaved', async () => {
      const {fixture, harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          status: 'published',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
          ],
        },
      });

      fixture.componentInstance.addQuestion();
      fixture.componentInstance.setProfileStatus('draft');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.hasSaveVettingButton()).toBe(true);
      expect(await harness.isSaveVettingDisabled()).toBe(true);
    });

    it('vettingDirty resets after saveVettingQuestions', async () => {
      const {fixture} = await setup();

      fixture.componentInstance.addQuestion();
      expect(fixture.componentInstance.vettingDirty()).toBe(true);

      await fixture.componentInstance.saveVettingQuestions();
      expect(fixture.componentInstance.vettingDirty()).toBe(false);
    });

    it('removeQuestion marks vetting as dirty', async () => {
      const {fixture} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
          ],
        },
      });

      expect(fixture.componentInstance.vettingDirty()).toBe(false);
      fixture.componentInstance.removeQuestion(0);
      expect(fixture.componentInstance.vettingDirty()).toBe(true);
    });

    it('removeQuestion does not throw orphan error and preserves remaining questions (BRA-135)', async () => {
      const {fixture, harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
            {id: 'q-2', question: 'Referral?', type: 'text', required: false},
            {id: 'q-3', question: 'Experience?', type: 'text', required: false},
          ],
        },
      });

      expect(await harness.getQuestionCount()).toBe(3);

      // Remove the middle question — previously the form() wrapper around vettingModel
      // threw "orphan field" errors when array items were removed (BRA-135)
      expect(() => {
        fixture.componentInstance.removeQuestion(1);
      }).not.toThrow();

      fixture.detectChanges();
      await fixture.whenStable();

      // Remaining questions should render without error
      expect(await harness.getQuestionCount()).toBe(2);
      const remaining = fixture.componentInstance.vettingModel();
      expect(remaining[0].id).toBe('q-1');
      expect(remaining[1].id).toBe('q-3');

      // Form should remain functional — adding another question should work
      expect(() => {
        fixture.componentInstance.addQuestion();
      }).not.toThrow();

      fixture.detectChanges();
      await fixture.whenStable();
      expect(await harness.getQuestionCount()).toBe(3);
    });

    it('onQuestionFieldChange updates question text and marks dirty (BRA-135)', async () => {
      const {fixture} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
          ],
        },
      });

      const fakeEvent = {
        target: {value: 'Updated question'},
      } as unknown as Event;
      fixture.componentInstance.onQuestionFieldChange(0, 'question', fakeEvent);

      expect(fixture.componentInstance.vettingModel()[0].question).toBe(
        'Updated question',
      );
      expect(fixture.componentInstance.vettingDirty()).toBe(true);
    });

    it('onQuestionFieldChange updates optionsString (BRA-135)', async () => {
      const {fixture} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [
            {
              id: 'q-1',
              question: 'Pick one',
              type: 'select',
              required: false,
              options: [],
              optionsString: '',
            },
          ],
        },
      });

      const fakeEvent = {target: {value: 'A, B, C'}} as unknown as Event;
      fixture.componentInstance.onQuestionFieldChange(
        0,
        'optionsString',
        fakeEvent,
      );

      expect(fixture.componentInstance.vettingModel()[0].optionsString).toBe(
        'A, B, C',
      );
      expect(fixture.componentInstance.vettingDirty()).toBe(true);
    });

    it('onRequiredChange toggles required flag and marks dirty (BRA-135)', async () => {
      const {fixture} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: false},
          ],
        },
      });

      expect(fixture.componentInstance.vettingModel()[0].required).toBe(false);

      const fakeEvent = {target: {checked: true}} as unknown as Event;
      fixture.componentInstance.onRequiredChange(0, fakeEvent);

      expect(fixture.componentInstance.vettingModel()[0].required).toBe(true);
      expect(fixture.componentInstance.vettingDirty()).toBe(true);
    });

    it('shows empty state when no vetting questions', async () => {
      const {harness} = await setup();
      expect(await harness.hasVettingEmptyState()).toBe(true);
      expect(await harness.getVettingEmptyText()).toBe(
        'No vetting questions yet. Add your first question to start screening applicants.',
      );
    });

    it('can add a new question', async () => {
      const {fixture, harness} = await setup();

      fixture.componentInstance.addQuestion();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.getQuestionCount()).toBe(1);
      expect(await harness.hasVettingEmptyState()).toBe(false);
    });

    it('new questions get a UUID id', async () => {
      const {fixture} = await setup();

      fixture.componentInstance.addQuestion();
      const questions = fixture.componentInstance.vettingModel();

      expect(questions.length).toBe(1);
      // crypto.randomUUID() returns a string matching UUID format
      expect(questions[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('onQuestionTypeChange does not throw orphan error (BRA-77)', async () => {
      const {fixture, harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
          ],
        },
      });

      expect(await harness.getQuestionCount()).toBe(1);

      // Change question type — previously this created a new object via spread,
      // stripping Signal Forms identity tracking → orphan error
      expect(() => {
        fixture.componentInstance.onQuestionTypeChange(0, 'select');
      }).not.toThrow();

      fixture.detectChanges();
      await fixture.whenStable();

      // Question should still be rendered and type updated
      expect(await harness.getQuestionCount()).toBe(1);
      expect(fixture.componentInstance.vettingModel()[0].type).toBe('select');
    });

    it('post-save Convex subscription update does not overwrite vetting model (BRA-77)', async () => {
      // Capture the onData callback to simulate post-save subscription push
      let capturedOnData: ((data: unknown) => void) | null = null;

      const orgData = {
        _id: FAKE_ORG_ID,
        name: 'Test Community',
        email: 'test@example.com',
        contactInfo: 'Call us',
        vettingQuestions: [
          {id: 'q-1', question: 'Why join?', type: 'text', required: true},
        ],
      };

      const ctxMock = makeCommunityContextMock({selectedId: FAKE_ORG_ID});

      const convexMock = createMockConvexClient();
      const query = vi.fn().mockResolvedValue(null);
      const mutation = vi.fn().mockResolvedValue(null);
      const onUpdate = vi
        .fn()
        .mockImplementation(
          (
            _query: unknown,
            _args: unknown,
            onData: (data: unknown) => void,
          ) => {
            const argsObj = _args as Record<string, unknown> | undefined;
            if (argsObj && 'id' in argsObj) {
              capturedOnData = onData;
              emitAsync(() => onData(orgData));
            } else {
              emitAsync(() => onData([]));
            }
            return () => void 0;
          },
        );

      convexMock.query = query;
      convexMock.client.query = query;
      convexMock.onUpdate = onUpdate;
      convexMock.client.onUpdate = onUpdate;
      convexMock.mutation = mutation;
      convexMock.client.mutation = mutation;

      const dialogMock = {create: vi.fn()};

      await TestBed.configureTestingModule({
        imports: [CommunityAdminSettingsComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([]),
          {provide: CONVEX, useValue: convexMock},
          {provide: BraDialogService, useValue: dialogMock},
          {provide: CommunityContextService, useValue: ctxMock},
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(CommunityAdminSettingsComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      // Second round: the mock emits on a microtask during the first
      // whenStable; the seeding effect then needs one more change-detection
      // pass to run (same stabilization pattern as the shared setup()).
      fixture.detectChanges();
      await fixture.whenStable();

      // Initial state: 1 question
      expect(fixture.componentInstance.vettingModel().length).toBe(1);

      // User adds a question locally
      fixture.componentInstance.addQuestion();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fixture.componentInstance.vettingModel().length).toBe(2);

      // Simulate Convex pushing back the OLD data (e.g. after a profile-only save)
      // This should NOT overwrite the local vetting model since it's already initialized
      if (capturedOnData) {
        (capturedOnData as (data: unknown) => void)({
          ...orgData,
          name: 'Updated Name',
        });
        fixture.detectChanges();
        await fixture.whenStable();
      }

      // Vetting model should still have 2 questions (local add preserved)
      expect(fixture.componentInstance.vettingModel().length).toBe(2);
    });

    it('typing in profile Name does not throw orphan signal error when questions exist (BRA-90)', async () => {
      const {fixture, harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          contactInfo: 'Call us',
          vettingQuestions: [
            {id: 'q-1', question: 'Why join?', type: 'text', required: true},
            {id: 'q-2', question: 'Referral?', type: 'text', required: false},
          ],
        },
      });

      // Verify questions rendered
      expect(await harness.getQuestionCount()).toBe(2);

      // Type in profile name — this previously threw "orphan field" on every keystroke
      await harness.typeInProfileName('New Name');
      fixture.detectChanges();
      await fixture.whenStable();

      // Questions should still be rendered (not destroyed by the profile edit)
      expect(await harness.getQuestionCount()).toBe(2);
      // Profile model updated independently
      expect(fixture.componentInstance.profileModel().name).toBe('New Name');
    });
  });

  // -----------------------------------------------------------------------
  // Team sections
  // -----------------------------------------------------------------------

  describe('team management', () => {
    it('renders admin list section', async () => {
      const {harness} = await setup();
      expect(await harness.hasAdminList()).toBe(true);
    });

    it('renders scanner list section', async () => {
      const {harness} = await setup();
      expect(await harness.hasScannerList()).toBe(true);
    });

    it('shows scanner empty state when no scanners', async () => {
      const {harness} = await setup();
      expect(await harness.hasScannerEmptyState()).toBe(true);
    });

    it('uses email as display fallback for nameless door staff', async () => {
      const {harness} = await setup({
        scannerData: [
          {
            _id: 'scanner-1' as Id<'users'>,
            userId: 'scanner-1' as Id<'users'>,
            organizerId: FAKE_ORG_ID,
            displayName: 'scanner@example.com',
            email: 'scanner@example.com',
          },
        ],
      });

      expect(await harness.getScannerListText()).toContain(
        'scanner@example.com',
      );
    });

    it('isLastAdmin is true when only one admin', async () => {
      const {fixture} = await setup({
        adminData: [
          {
            _id: 'ca-1' as Id<'organizer_user_directory'>,
            _creationTime: Date.now(),
            userId: 'user-1' as Id<'users'>,
            organizerId: FAKE_ORG_ID,
            grantedBy: 'user-1' as Id<'users'>,
          },
        ],
      });

      expect(fixture.componentInstance.isLastAdmin()).toBe(true);
    });

    it('grantAdmin calls communities.admins.grant when a platform user exists', async () => {
      const {fixture, harness, convexMock} = await setup();

      convexMock.client.query.mockResolvedValue({
        _id: 'user-existing' as Id<'users'>,
        email: 'existing@example.com',
      });

      await harness.typeAdminEmail('existing@example.com');
      fixture.detectChanges();
      await fixture.whenStable();
      await harness.clickGrantAdmin();
      await fixture.whenStable();

      expect(convexMock.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'user-existing',
          organizerId: FAKE_ORG_ID,
        }),
      );
      const mutationCalls = convexMock.mutation.mock.calls as unknown[][];
      const inviteCalled = mutationCalls.some((args) => {
        const callArgs = args[1] as Record<string, unknown> | undefined;
        return (
          callArgs &&
          'email' in callArgs &&
          'organizerId' in callArgs &&
          !('userId' in callArgs)
        );
      });
      expect(inviteCalled).toBe(false);
    });

    it('grantAdmin does not invite when no platform user exists', async () => {
      const {fixture, harness, convexMock} = await setup();

      convexMock.client.query.mockResolvedValue(null);

      await harness.typeAdminEmail('newuser@example.com');
      fixture.detectChanges();
      await fixture.whenStable();
      await harness.clickGrantAdmin();
      await fixture.whenStable();

      expect(convexMock.mutation).not.toHaveBeenCalled();
    });

    it('grantAdmin keeps the email input when no platform user exists', async () => {
      const {fixture, harness, convexMock} = await setup();

      convexMock.client.query.mockResolvedValue(null);
      await harness.typeAdminEmail('newuser@example.com');
      fixture.detectChanges();
      await fixture.whenStable();
      await harness.clickGrantAdmin();
      await fixture.whenStable();

      expect(fixture.componentInstance.newAdminEmail()).toBe(
        'newuser@example.com',
      );
    });

    it('shows copy that admins already have door staff access', async () => {
      const {harness} = await setup();

      expect(await harness.getDoorStaffHelpText()).toContain(
        'Admins already have door staff access.',
      );
    });

    // -----------------------------------------------------------------------
    // Door staff member search (BRA — "search for members under door staff")
    // -----------------------------------------------------------------------

    describe('door staff member search', () => {
      beforeEach(() => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      async function searchAndWait(
        fixture: ComponentFixture<CommunityAdminSettingsComponent>,
        harness: CommunityAdminSettingsHarness,
        term: string,
      ) {
        await harness.setScannerSearch(term);
        await vi.advanceTimersByTimeAsync(300);
        fixture.detectChanges();
        await fixture.whenStable();
      }

      it('renders no search panel when the term is empty', async () => {
        const {harness} = await setup();
        expect(await harness.hasScannerSearchResultsPanel()).toBe(false);
      });

      it('renders results from the search query for a non-email term', async () => {
        const {fixture, harness} = await setup({
          searchResultsData: [
            {
              _id: 'user-1' as Id<'users'>,
              userId: 'user-1' as Id<'users'>,
              organizerId: FAKE_ORG_ID,
              displayName: 'Ada Lovelace',
              email: 'ada@example.com',
            },
          ],
        });

        await searchAndWait(fixture, harness, 'ada');

        expect(await harness.hasScannerSearchResultsPanel()).toBe(true);
        expect(await harness.getScannerSearchResultCount()).toBe(1);
        const text = await harness.getScannerSearchResultText(0);
        expect(text).toContain('Ada Lovelace');
        expect(text).toContain('ada@example.com');
      });

      it('add-by-row calls communities.scanners.grant with the row userId', async () => {
        const {fixture, harness, convexMock} = await setup({
          searchResultsData: [
            {
              _id: 'user-1' as Id<'users'>,
              userId: 'user-1' as Id<'users'>,
              organizerId: FAKE_ORG_ID,
              displayName: 'Ada Lovelace',
              email: 'ada@example.com',
            },
          ],
        });

        await searchAndWait(fixture, harness, 'ada');
        await harness.clickScannerSearchResult(0);
        await fixture.whenStable();

        expect(convexMock.mutation).toHaveBeenCalledWith(
          api.communities.scanners.grant,
          {
            userId: 'user-1',
            organizerId: FAKE_ORG_ID,
          },
        );
      });

      it('clears the search term after a successful row grant', async () => {
        const {fixture, harness} = await setup({
          searchResultsData: [
            {
              _id: 'user-1' as Id<'users'>,
              userId: 'user-1' as Id<'users'>,
              organizerId: FAKE_ORG_ID,
              displayName: 'Ada Lovelace',
              email: 'ada@example.com',
            },
          ],
        });

        await searchAndWait(fixture, harness, 'ada');
        await harness.clickScannerSearchResult(0);
        await fixture.whenStable();

        expect(fixture.componentInstance.scanner.search()).toBe('');
      });

      it('disables a result row and labels it "admin" when the user is already an admin', async () => {
        const {fixture, harness} = await setup({
          adminData: [
            {
              _id: 'admin-1' as Id<'organizer_user_directory'>,
              userId: 'user-1' as Id<'users'>,
              organizerId: FAKE_ORG_ID,
              displayName: 'Ada Lovelace',
              email: 'ada@example.com',
            },
          ],
          searchResultsData: [
            {
              _id: 'user-1' as Id<'users'>,
              userId: 'user-1' as Id<'users'>,
              organizerId: FAKE_ORG_ID,
              displayName: 'Ada Lovelace',
              email: 'ada@example.com',
            },
          ],
        });

        await searchAndWait(fixture, harness, 'ada');

        expect(await harness.isScannerResultDisabled(0)).toBe(true);
        const text = await harness.getScannerSearchResultText(0);
        expect(text).toContain('admin');
      });

      it('disables a result row and labels it "added" when the user is already door staff', async () => {
        const {fixture, harness} = await setup({
          scannerData: [
            {
              _id: 'scanner-1' as Id<'users'>,
              userId: 'user-1' as Id<'users'>,
              organizerId: FAKE_ORG_ID,
              displayName: 'Ada Lovelace',
              email: 'ada@example.com',
            },
          ],
          searchResultsData: [
            {
              _id: 'user-1' as Id<'users'>,
              userId: 'user-1' as Id<'users'>,
              organizerId: FAKE_ORG_ID,
              displayName: 'Ada Lovelace',
              email: 'ada@example.com',
            },
          ],
        });

        await searchAndWait(fixture, harness, 'ada');

        expect(await harness.isScannerResultDisabled(0)).toBe(true);
        const text = await harness.getScannerSearchResultText(0);
        expect(text).toContain('added');
      });

      it('clicking a disabled result row is not possible via the harness', async () => {
        const {fixture, harness} = await setup({
          scannerData: [
            {
              _id: 'scanner-1' as Id<'users'>,
              userId: 'user-1' as Id<'users'>,
              organizerId: FAKE_ORG_ID,
              displayName: 'Ada Lovelace',
              email: 'ada@example.com',
            },
          ],
          searchResultsData: [
            {
              _id: 'user-1' as Id<'users'>,
              userId: 'user-1' as Id<'users'>,
              organizerId: FAKE_ORG_ID,
              displayName: 'Ada Lovelace',
              email: 'ada@example.com',
            },
          ],
        });

        await searchAndWait(fixture, harness, 'ada');

        await expect(harness.clickScannerSearchResult(0)).rejects.toThrow();
      });

      it('shows an "add by exact email" fallback when the term contains @ and no members match', async () => {
        const {fixture, harness} = await setup({searchResultsData: []});

        await searchAndWait(fixture, harness, 'nobody@example.com');

        expect(await harness.hasScannerEmailFallback()).toBe(true);
        expect(await harness.hasScannerSearchEmptyState()).toBe(false);
      });

      it('email fallback calls findByExactEmailForAdmin then grant', async () => {
        const {fixture, harness, convexMock} = await setup({
          searchResultsData: [],
        });

        convexMock.client.query.mockResolvedValue({
          _id: 'scanner-existing' as Id<'users'>,
          email: 'scanner@example.com',
        });

        await searchAndWait(fixture, harness, 'scanner@example.com');
        await harness.clickScannerEmailFallback();
        await fixture.whenStable();

        expect(convexMock.client.query).toHaveBeenCalledWith(
          api.users.profile.findByExactEmailForAdmin,
          expect.objectContaining({
            email: 'scanner@example.com',
            organizerId: FAKE_ORG_ID,
          }),
        );
        expect(convexMock.mutation).toHaveBeenCalledWith(
          api.communities.scanners.grant,
          {
            userId: 'scanner-existing',
            organizerId: FAKE_ORG_ID,
          },
        );
      });

      it('email fallback surfaces the unknown-email error and keeps the search term', async () => {
        const {fixture, harness, convexMock} = await setup({
          searchResultsData: [],
        });
        const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');

        convexMock.client.query.mockResolvedValue(null);

        await searchAndWait(fixture, harness, 'missing@example.com');
        await harness.clickScannerEmailFallback();
        await fixture.whenStable();

        expect(convexMock.mutation).not.toHaveBeenCalled();
        expect(toastSpy).toHaveBeenCalledWith(
          'No Braket account exists for that email yet.',
        );
        expect(fixture.componentInstance.scanner.search()).toBe(
          'missing@example.com',
        );
        toastSpy.mockRestore();
      });

      it('shows a "no members match" empty state for a non-email term with no results', async () => {
        const {fixture, harness} = await setup({searchResultsData: []});

        await searchAndWait(fixture, harness, 'nobody');

        expect(await harness.hasScannerSearchEmptyState()).toBe(true);
        expect(await harness.hasScannerEmailFallback()).toBe(false);
      });

      // ---------------------------------------------------------------------
      // Stale-results guard (wrong-user grant defense)
      // ---------------------------------------------------------------------

      const aliceRow = {
        _id: 'user-alice' as Id<'users'>,
        userId: 'user-alice' as Id<'users'>,
        organizerId: FAKE_ORG_ID,
        displayName: 'Alice',
        email: 'alice@example.com',
      };

      it('does not render stale rows or grant the wrong user during the in-flight window', async () => {
        const {fixture, harness, convexMock, resolveSearch} = await setup({
          deferSearch: true,
        });

        // Search "alice" and resolve it — Alice's row is current. The
        // detectChanges/whenStable after advancing the debounce lets the
        // injectQueries effect re-run and register the subscription for "alice".
        await harness.setScannerSearch('alice');
        await vi.advanceTimersByTimeAsync(300);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(resolveSearch('alice', [aliceRow])).toBe(true);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(await harness.getScannerSearchResultCount()).toBe(1);
        expect(await harness.getScannerSearchResultText(0)).toContain('Alice');

        // Edit to "bob" and fire the debounced query for "bob" — but DO NOT
        // resolve it. `injectQueries` preserves the scannerSearch key's prior
        // `results()` entry during the refetch.
        await harness.setScannerSearch('bob');
        await vi.advanceTimersByTimeAsync(300);
        fixture.detectChanges();
        await fixture.whenStable();

        // (a) Alice's row must NOT be rendered as a grantable/current result;
        // the neutral loading state shows instead of the stale row.
        expect(await harness.getScannerSearchResultCount()).toBe(0);
        expect(await harness.hasScannerSearchLoading()).toBe(true);
        expect(await harness.hasScannerSearchEmptyState()).toBe(false);
        expect(await harness.hasScannerEmailFallback()).toBe(false);

        // (b) The grant path for Alice is a hard no-op — the mutation is never
        // called with Alice's userId even though her data is still in .data().
        await fixture.componentInstance.grantScannerByRow(aliceRow);
        await fixture.whenStable();

        const grantedAlice = (
          convexMock.mutation.mock.calls as unknown[][]
        ).some((args) => {
          const callArgs = args[1] as Record<string, unknown> | undefined;
          return callArgs?.['userId'] === 'user-alice';
        });
        expect(grantedAlice).toBe(false);
      });

      it('pending status forces non-current during an in-flight refetch', async () => {
        const {fixture, harness, resolveSearch} = await setup({
          deferSearch: true,
        });

        // Resolve "alice" so there is retained data and a stamp for "alice".
        await harness.setScannerSearch('alice');
        await vi.advanceTimersByTimeAsync(300);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(resolveSearch('alice', [aliceRow])).toBe(true);
        fixture.detectChanges();
        await fixture.whenStable();

        // Fire the debounced query for "bob" but leave it unresolved. Per
        // convex-angular, an args change flips the scannerSearch key's
        // statuses() to 'pending' while results() retains the prior payload —
        // so this is exactly the in-flight window.
        await harness.setScannerSearch('bob');
        await vi.advanceTimersByTimeAsync(300);
        fixture.detectChanges();
        await fixture.whenStable();

        // The status gate makes results non-current independent of the stamp:
        // injectQueries reports the in-flight refetch as 'pending'...
        expect(
          fixture.componentInstance['queries'].statuses().scannerSearch,
        ).toBe('pending');
        // ...and the panel therefore renders zero grantable rows.
        expect(await harness.getScannerSearchResultCount()).toBe(0);
        expect(await harness.hasScannerSearchLoading()).toBe(true);
      });

      it('grants once results for the new term resolve (in-flight → current)', async () => {
        const {fixture, harness, convexMock, resolveSearch} = await setup({
          deferSearch: true,
        });
        const bobRow = {
          _id: 'user-bob' as Id<'users'>,
          userId: 'user-bob' as Id<'users'>,
          organizerId: FAKE_ORG_ID,
          displayName: 'Bob',
          email: 'bob@example.com',
        };

        await harness.setScannerSearch('alice');
        await vi.advanceTimersByTimeAsync(300);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(resolveSearch('alice', [aliceRow])).toBe(true);
        fixture.detectChanges();
        await fixture.whenStable();

        await harness.setScannerSearch('bob');
        await vi.advanceTimersByTimeAsync(300);
        fixture.detectChanges();
        await fixture.whenStable();
        // Now resolve "bob" — results become current for the visible term.
        expect(resolveSearch('bob', [bobRow])).toBe(true);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(await harness.getScannerSearchResultCount()).toBe(1);
        expect(await harness.getScannerSearchResultText(0)).toContain('Bob');

        await harness.clickScannerSearchResult(0);
        await fixture.whenStable();

        expect(convexMock.mutation).toHaveBeenCalledWith(
          api.communities.scanners.grant,
          {userId: 'user-bob', organizerId: FAKE_ORG_ID},
        );
      });

      it('does not grant a row fetched for a different community after switching', async () => {
        const OTHER_ORG_ID = 'org-other' as Id<'organizers'>;
        const {fixture, harness, ctxMock, convexMock, resolveSearch} =
          await setup({deferSearch: true});

        // Resolve results for the initially-selected community (FAKE_ORG_ID).
        await harness.setScannerSearch('alice');
        await vi.advanceTimersByTimeAsync(300);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(resolveSearch('alice', [aliceRow], FAKE_ORG_ID)).toBe(true);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(await harness.getScannerSearchResultCount()).toBe(1);

        // Switch the selected community to a different organizer. The rows on
        // screen were fetched for FAKE_ORG_ID and must no longer be grantable.
        ctxMock.selectedCommunityId.set(OTHER_ORG_ID);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(await harness.getScannerSearchResultCount()).toBe(0);

        await fixture.componentInstance.grantScannerByRow(aliceRow);
        await fixture.whenStable();

        const grantedAlice = (
          convexMock.mutation.mock.calls as unknown[][]
        ).some((args) => {
          const callArgs = args[1] as Record<string, unknown> | undefined;
          return callArgs?.['userId'] === 'user-alice';
        });
        expect(grantedAlice).toBe(false);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Notifications section
  // -----------------------------------------------------------------------

  describe('Notifications section', () => {
    it('shows notifications section', async () => {
      const {harness} = await setup();
      expect(await harness.hasNotificationsSection()).toBe(true);
    });

    it('uses high-contrast theme tokens for the save action', async () => {
      const {harness} = await setup();
      expect(await harness.saveNotificationsUsesHighContrastTokens()).toBe(
        true,
      );
    });

    it('defaults notifMode to off when no preference exists', async () => {
      const {harness} = await setup({notifPrefData: null});
      expect(await harness.getSelectedNotifMode()).toBe('off');
    });

    it('syncs mode from loaded preference', async () => {
      const {harness} = await setup({
        notifPrefData: {mode: 'all', digestHour: 9},
      });
      expect(await harness.getSelectedNotifMode()).toBe('all');
    });

    it('syncs digestHour from loaded preference', async () => {
      const {harness} = await setup({
        notifPrefData: {mode: 'digest', digestHour: 14},
      });
      expect(await harness.hasDigestHourSelect()).toBe(true);
    });

    it('hides digest hour select when mode is off', async () => {
      const {harness} = await setup();
      await harness.selectNotifMode('off');
      expect(await harness.hasDigestHourSelect()).toBe(false);
    });

    it('hides digest hour select when mode is all', async () => {
      const {harness} = await setup();
      await harness.selectNotifMode('all');
      expect(await harness.hasDigestHourSelect()).toBe(false);
    });

    it('shows digest hour select when Daily digest mode chosen', async () => {
      const {harness} = await setup();
      await harness.selectNotifMode('digest');
      expect(await harness.hasDigestHourSelect()).toBe(true);
    });

    it('calls setMyNotificationPreference on save', async () => {
      const {harness, convexMock} = await setup();
      await harness.selectNotifMode('all');
      await harness.clickSaveNotifications();

      expect(convexMock.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          organizerId: FAKE_ORG_ID,
          mode: 'all',
        }),
      );
    });

    it('includes digestHour when mode is digest', async () => {
      const {harness, convexMock} = await setup();
      await harness.selectNotifMode('digest');
      await harness.clickSaveNotifications();

      expect(convexMock.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          organizerId: FAKE_ORG_ID,
          mode: 'digest',
          digestHour: expect.any(Number) as number,
        }),
      );
    });

    it('does not include digestHour when mode is off', async () => {
      const {harness, convexMock} = await setup();
      await harness.selectNotifMode('off');
      await harness.clickSaveNotifications();

      const callArgs = convexMock.mutation.mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(callArgs).not.toHaveProperty('digestHour');
    });

    it('resets notifSaving after save completes', async () => {
      const {harness} = await setup();
      await harness.selectNotifMode('all');
      await harness.clickSaveNotifications();
      expect(await harness.isSaveNotificationsDisabled()).toBe(false);
    });
  });

  describe('BRA-297: published toggle gated on vetting questions', () => {
    it('shows publish-blocked warning and published button disabled when no vetting questions', async () => {
      const {harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          vettingQuestions: [],
          status: 'draft',
        },
      });

      expect(await harness.isPublishBlockedWarningVisible()).toBe(true);
      expect(await harness.isPublishButtonDisabled()).toBe(true);
    });

    it('does not show warning and published button enabled when vetting questions exist', async () => {
      const {harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          vettingQuestions: [
            {id: 'q1', question: 'Why?', type: 'text', required: true},
          ],
          status: 'draft',
        },
      });

      expect(await harness.isPublishBlockedWarningVisible()).toBe(false);
      expect(await harness.isPublishButtonDisabled()).toBe(false);
    });

    it('save button disabled when status is published but no vetting questions (blocked state)', async () => {
      const {harness} = await setup({
        organizerData: {
          _id: FAKE_ORG_ID,
          name: 'Test Community',
          email: 'test@example.com',
          vettingQuestions: [],
          status: 'published',
        },
      });

      expect(await harness.isSaveProfileDisabled()).toBe(true);
    });
  });
});
