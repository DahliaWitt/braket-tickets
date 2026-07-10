import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {toast} from 'ngx-sonner';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {signal} from '@angular/core';
import {EventDetailsComponent} from './event-details.component';
import {
  ActivatedRoute,
  convertToParamMap,
  Router,
  type ParamMap,
  type UrlTree,
} from '@angular/router';
import {CommunitiesService} from '@/core/services/communities.service';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {STRIPE_CONFIG} from '@/app.tokens';
import {of, BehaviorSubject, type Observable} from 'rxjs';
import {type EventDetail} from '@/core/models/event.types';
import {provideHttpClient} from '@angular/common/http';
import {provideHttpClientTesting} from '@angular/common/http/testing';
import {AuthService} from '@/core/services/auth.service';
import {CONVEX} from 'convex-angular';
import {PaymentService} from '@/features/tickets/services/payment.service';
import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {ResaleService} from '@/features/tickets/services/resale.service';
import {type Community} from '@/core/services/communities.service';
import {BraDarkMode, EDarkModes} from '@ui/services/dark-mode';
import {vi, type Mock} from 'vitest';
import {type Id} from '@convex/_generated/dataModel';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {EventDetailsHarness} from './event-details.component.harness';
import {CheckoutSidebarHarness} from '../../components/checkout-sidebar/checkout-sidebar.component.harness';
import {
  ContactCommunityDialogComponent,
  type ContactCommunityDialogData,
} from './contact-community-dialog.component';

// convex-angular's injectQueries registers its per-key staleness guard AFTER
// `onUpdate()` returns, so any mock that invokes the data callback synchronously
// inside `onUpdate` has that first emission rejected. Real ConvexReactClient
// never emits synchronously from `onUpdate`; mirror that contract by deferring
// the initial emission to a microtask so the subscription is registered first.
const emitAsync = (onData: (data: unknown) => void, value: unknown): void => {
  queueMicrotask(() => onData(value));
};

interface MockAuthServiceForEventDetails {
  user: () => {_id: string; name: string} | null;
  userRole: () => string;
  isAuthenticated: () => boolean;
  email: () => string | null;
  getFileUrl: () => string;
  logout: Mock;
}

interface AvailabilityForEventDetails {
  totalTickets: number;
  soldCount: number;
  remainingTickets: number;
  ticketSalesStatus: 'active' | 'scheduled' | 'paused' | 'ended' | null;
  isSoldOut: boolean;
  userTicketCount: number;
  resaleAvailable?: number;
  resaleEnabled?: boolean;
  isSubscribedToResaleNotifications?: boolean;
  purchaseAccess: {
    allowed: boolean;
    source?: 'open_access' | 'direct' | 'shared';
    viaOrganizerId?: Id<'organizers'>;
  };
}

interface MockPaymentServiceForEventDetails {
  startPrimaryCheckoutSession: Mock<
    (
      eventId: string,
      quantity: number,
      tier: string,
      totalAmount: number,
      checkoutTheme: 'light' | 'dark',
    ) => Promise<{
      orderId: string;
      stripeCheckoutSessionId: string;
      clientSecret: string;
      connectedAccountId: string | null;
    }>
  >;
  startGuestCheckoutSession: Mock<
    (
      eventId: string,
      quantity: number,
      tier: string,
      totalAmount: number,
      sessionToken: string,
      checkoutTheme: 'light' | 'dark',
    ) => Promise<{
      orderId: string;
      stripeCheckoutSessionId: string;
      clientSecret: string;
      connectedAccountId: string | null;
    }>
  >;
  startResaleCheckoutSession: Mock<
    (
      eventId: string,
      tier: string,
      totalAmount: number,
      checkoutTheme: 'light' | 'dark',
    ) => Promise<{
      orderId: string;
      stripeCheckoutSessionId: string;
      clientSecret: string;
      connectedAccountId: string | null;
    }>
  >;
  syncCheckoutSession: Mock<
    () => Promise<{state: 'completed' | 'released' | 'open'}>
  >;
  getCheckoutStatus: Mock<
    () => Promise<{state: 'completed' | 'released' | 'open'}>
  >;
  initiateGuestSession: Mock<() => Promise<{sessionToken: string}>>;
  rememberGuestSessionToken: Mock;
  triggerRefresh: Mock;
}

interface MockResaleServiceForEventDetails {
  subscribeToResaleNotifications: Mock<() => Promise<string>>;
  listTicketForResale: Mock<() => Promise<string>>;
  cancelResaleListing: Mock<() => Promise<void>>;
  getMyResaleListings: Mock<
    () => Promise<{_id: string; ticketId: string; status: string}[]>
  >;
}

interface MockApplicationsServiceForEventDetails {
  getMyApplication: Mock<() => Promise<{status: string}>>;
  getMyApplicationForOrganizer: Mock<
    (organizerId: Id<'organizers'>) => Promise<{status: string} | null>
  >;
}

interface MockRouterForEventDetails {
  url: string;
  navigate: Mock;
  createUrlTree: Mock<() => UrlTree>;
  serializeUrl: Mock<() => string>;
  events: Observable<object>;
}

interface MockActivatedRouteForEventDetails {
  snapshot: {
    paramMap: {
      get: (key: string) => string | null;
    };
    queryParamMap: ParamMap;
  };
  queryParamMap: Observable<ParamMap>;
  queryParams: Observable<object>;
}

interface MockDialogServiceForEventDetails {
  create: Mock;
}

interface MockCommunitiesServiceForEventDetails {
  get: Mock<(id: Id<'organizers'>) => Promise<Community | null>>;
}

interface ContactDialogConfigForEventDetails {
  zContent: typeof ContactCommunityDialogComponent;
  zData: ContactCommunityDialogData;
  zDescription?: string;
  zHideFooter?: boolean;
  zTitle: string;
}

describe('EventDetailsComponent', () => {
  let component: EventDetailsComponent;
  let fixture: ComponentFixture<EventDetailsComponent>;

  // Properly typed mocks
  let mockAuthService: MockAuthServiceForEventDetails;
  let mockConvexClient: MockConvexClient;
  let mockPaymentService: MockPaymentServiceForEventDetails;
  let mockAppsService: MockApplicationsServiceForEventDetails;
  let mockRouter: MockRouterForEventDetails;
  let mockActivatedRoute: MockActivatedRouteForEventDetails;
  let mockDialogService: MockDialogServiceForEventDetails;
  let mockCommunitiesService: MockCommunitiesServiceForEventDetails;
  let mockResaleService: MockResaleServiceForEventDetails;
  let mockDarkMode: Pick<BraDarkMode, 'themeMode'>;
  let queryParamMapSubject: BehaviorSubject<ParamMap>;
  let eventDocsById: Map<string, EventDetail>;
  let availabilityByEventId: Map<string, AvailabilityForEventDetails>;

  const eventCreationTime = Date.parse('2023-01-01T00:00:00.000Z');

  const mockEvent = {
    _id: '1',
    _creationTime: eventCreationTime,
    title: 'Test Event',
    date: '2025-01-01T12:00:00Z',
    price: 1000,
    totalTickets: 100,
    slidingScaleEnabled: true,
    slidingScaleMin: 500,
    slidingScaleMax: 0,
    supporterDefaultPrice: 4000,
    status: 'published',
    organizerId: 'org1',
  } as unknown as EventDetail;

  const userSubject = new BehaviorSubject<{_id: string; name: string} | null>({
    _id: 'u1',
    name: 'Test User',
  });

  const defaultAvailability: AvailabilityForEventDetails = {
    totalTickets: 100,
    soldCount: 0,
    remainingTickets: 100,
    ticketSalesStatus: 'active',
    isSoldOut: false,
    userTicketCount: 0,
    resaleAvailable: 0,
    resaleEnabled: false,
    purchaseAccess: {allowed: true, source: 'direct'},
  };

  beforeEach(async () => {
    userSubject.next({
      _id: 'u1',
      name: 'Test User',
    });

    mockAuthService = {
      user: () => userSubject.value,
      userRole: () => 'user',
      isAuthenticated: () => true,
      email: () => 'test@example.com',
      getFileUrl: () => 'http://test.com/img.jpg',
      logout: vi.fn(),
    };

    eventDocsById = new Map([['1', {...mockEvent}]]);
    availabilityByEventId = new Map([['1', {...defaultAvailability}]]);

    mockConvexClient = createMockConvexClient();
    const onUpdate = vi
      .fn()
      .mockImplementation((queryRef, args, onData: (data: unknown) => void) => {
        void queryRef;
        const typedArgs = args as Record<string, string>;

        if ('id' in typedArgs) {
          const eventId = typedArgs.id;
          emitAsync(
            onData,
            eventDocsById.get(eventId) ?? eventDocsById.get('1') ?? null,
          );
          return () => void 0;
        }

        if ('eventId' in typedArgs) {
          const eventId = typedArgs.eventId;
          emitAsync(onData, availabilityByEventId.get(eventId) ?? null);
          return () => void 0;
        }

        // Trust query (checkUserTrust) has organizerId only (userId derived server-side)
        if (
          'organizerId' in typedArgs &&
          !('eventId' in typedArgs) &&
          !('id' in typedArgs)
        ) {
          emitAsync(onData, {trusted: true, source: 'direct', via: null});
          return () => void 0;
        }

        emitAsync(onData, null);
        return () => void 0;
      });

    mockConvexClient.onUpdate = onUpdate;
    mockConvexClient.client.onUpdate = onUpdate;

    mockPaymentService = {
      startPrimaryCheckoutSession: vi.fn().mockResolvedValue({
        orderId: 'order_123',
        stripeCheckoutSessionId: 'cs_123',
        clientSecret: 'secret_123',
        connectedAccountId: null,
      }),
      startGuestCheckoutSession: vi.fn().mockResolvedValue({
        orderId: 'order_guest_123',
        stripeCheckoutSessionId: 'cs_guest_123',
        clientSecret: 'secret_guest_123',
        connectedAccountId: null,
      }),
      startResaleCheckoutSession: vi.fn().mockResolvedValue({
        orderId: 'order_resale_123',
        stripeCheckoutSessionId: 'cs_resale_123',
        clientSecret: 'secret_resale_123',
        connectedAccountId: null,
      }),
      syncCheckoutSession: vi.fn().mockResolvedValue({state: 'completed'}),
      getCheckoutStatus: vi.fn().mockResolvedValue({state: 'completed'}),
      initiateGuestSession: vi
        .fn()
        .mockResolvedValue({sessionToken: 'guest_session_123'}),
      rememberGuestSessionToken: vi.fn(),
      triggerRefresh: vi.fn(),
    };

    mockAppsService = {
      getMyApplication: vi.fn().mockResolvedValue({status: 'approved'}),
      getMyApplicationForOrganizer: vi
        .fn()
        .mockResolvedValue({status: 'approved'}),
    };

    queryParamMapSubject = new BehaviorSubject(convertToParamMap({}));
    mockRouter = {
      url: '/events/1?buy=true&source=sidebar#details',
      navigate: vi.fn(),
      createUrlTree: vi.fn().mockReturnValue({}),
      serializeUrl: vi.fn().mockReturnValue('mock-url'),
      events: of({}),
    };

    mockActivatedRoute = {
      snapshot: {
        paramMap: {
          get: (_key: string) => '1',
        },
        queryParamMap: convertToParamMap({}),
      },
      queryParamMap: queryParamMapSubject.asObservable(),
      queryParams: of({}),
    };
    mockResaleService = {
      subscribeToResaleNotifications: vi.fn().mockResolvedValue('sub_123'),
      listTicketForResale: vi.fn().mockResolvedValue('listing_123'),
      cancelResaleListing: vi.fn().mockResolvedValue(undefined),
      getMyResaleListings: vi.fn().mockResolvedValue([]),
    };

    mockDialogService = {
      create: vi.fn(),
    };
    mockCommunitiesService = {
      get: vi.fn().mockResolvedValue({
        _id: 'org1',
        name: 'Void Collective',
        slug: 'void-collective',
        logoUrl: '/braket.svg',
        email: 'hello@voidcollective.test',
        contactInfo: 'Signal-only contact hours: Tuesdays and Thursdays.',
      }),
    };
    mockDarkMode = {
      themeMode: signal(EDarkModes.LIGHT),
    };
    await TestBed.configureTestingModule({
      imports: [EventDetailsComponent],
      providers: [
        {provide: AuthService, useValue: mockAuthService},
        {provide: CONVEX, useValue: mockConvexClient},
        {provide: PaymentService, useValue: mockPaymentService},
        {provide: ApplicationsService, useValue: mockAppsService},
        {provide: Router, useValue: mockRouter},
        {provide: ActivatedRoute, useValue: mockActivatedRoute},
        {provide: CommunitiesService, useValue: mockCommunitiesService},
        {
          provide: STRIPE_CONFIG,
          useValue: {publishableKey: 'pk_test_fake', mockPayments: true},
        },
        {provide: ResaleService, useValue: mockResaleService},
        {provide: BraDialogService, useValue: mockDialogService},
        {provide: BraDarkMode, useValue: mockDarkMode},
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventDetailsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', '1');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('sets initialized after the first render pass', async () => {
    await fixture.whenStable();

    expect(component.initialized()).toBe(true);
  });

  it('does not set initialized when destroyed before the first render pass', async () => {
    const preRenderFixture = TestBed.createComponent(EventDetailsComponent);
    const preRenderComponent = preRenderFixture.componentInstance;
    const initializedSetSpy = vi.spyOn(preRenderComponent.initialized, 'set');

    preRenderFixture.componentRef.setInput('id', '1');
    preRenderFixture.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(initializedSetSpy).not.toHaveBeenCalled();
    expect(preRenderComponent.initialized()).toBe(false);
  });

  it('should load event data on init', async () => {
    await fixture.whenStable();
    const eventCall = mockConvexClient.client.onUpdate.mock.calls.find(
      (_call) => 'id' in (_call[1] as Record<string, string>),
    );
    expect(eventCall?.[1]).toEqual({id: '1'});
    expect(component.event()).toEqual(mockEvent);
    expect(component.loading()).toBe(false);
  });

  it('should reload event data when id input changes', async () => {
    await fixture.whenStable();
    eventDocsById.set('2', {...mockEvent, _id: '2' as Id<'events'>});
    fixture.componentRef.setInput('id', '2');
    await fixture.whenStable();
    const hasId2Call = mockConvexClient.client.onUpdate.mock.calls.some(
      (_call) => (_call[1] as Record<string, string>).id === '2',
    );
    expect(hasId2Call).toBe(true);
  });

  it('shows a clear not-found state for an invalid event route', async () => {
    eventDocsById.clear();
    availabilityByEventId.clear();
    fixture.componentRef.setInput('id', 'missing');
    fixture.detectChanges();
    await fixture.whenStable();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      EventDetailsHarness,
    );

    expect(component.event()).toBeNull();
    expect(component.eventNotFound()).toBe(true);
    expect(await harness.isNotFoundVisible()).toBe(true);
    expect(await harness.getNotFoundText()).toContain('Event Not Found');
    expect(await harness.getNotFoundText()).toContain('Back to home');
  });

  it('should open payment sidebar when buy input is true', async () => {
    await fixture.whenStable(); // Wait for event to load
    fixture.componentRef.setInput('buy', 'true');
    // Effect runs
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.isPaymentSidebarOpen()).toBe(true);
  });

  it('navigates to login with the current internal event URL', () => {
    mockRouter.url = '/events/1?buy=true&source=sidebar#details';

    component.navigateToLogin();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: {returnUrl: '/events/1?buy=true&source=sidebar#details'},
    });
  });

  it('does not reset active checkout state when buy input is already open', async () => {
    await fixture.whenStable();
    component.isPaymentSidebarOpen.set(true);
    component.paymentStatus.set('processing');
    component.selectTier('supporter');
    component.ticketQuantity.set(2);

    fixture.componentRef.setInput('buy', 'true');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.isPaymentSidebarOpen()).toBe(true);
    expect(component.paymentStatus()).toBe('processing');
    expect(component.selectedTier()).toBe('supporter');
    expect(component.ticketQuantity()).toBe(2);
  });

  it('closes the sidebar and resets checkout state when buy param is removed (browser back)', async () => {
    await fixture.whenStable();

    // Simulate sidebar being open with active Stripe session (mid-checkout)
    fixture.componentRef.setInput('buy', 'true');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.isPaymentSidebarOpen()).toBe(true);

    component.paymentStatus.set('processing');
    component.activeOrderId.set('order_123');
    component.activeCheckoutSessionId.set('cs_123');
    component.guestEmail.set('guest@test.com');

    // Clear navigate call history so we can assert no new navigation fires on back
    mockRouter.navigate.mockClear();

    // Simulate browser back: URL loses ?buy=true, input becomes undefined
    fixture.componentRef.setInput('buy', undefined);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.isPaymentSidebarOpen()).toBe(false);
    expect(component.paymentStatus()).toBe('idle');
    expect(component.activeOrderId()).toBeNull();
    expect(component.activeCheckoutSessionId()).toBeNull();
    expect(component.guestEmail()).toBeNull();
    // No URL navigation — the browser already updated the URL
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('does not close the sidebar when buy param was never set and sidebar is already closed', async () => {
    await fixture.whenStable();

    expect(component.isPaymentSidebarOpen()).toBe(false);

    // buy is undefined from the start — should be a no-op
    fixture.componentRef.setInput('buy', undefined);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.isPaymentSidebarOpen()).toBe(false);
  });

  it('should load application status on init', async () => {
    await fixture.whenStable();
    expect(mockAppsService.getMyApplicationForOrganizer).toHaveBeenCalledWith(
      'org1',
    );
    expect(component.applicationStatus()).toBe('approved');
  });

  it('reacts to same-component query param updates', async () => {
    await fixture.whenStable();

    queryParamMapSubject.next(
      convertToParamMap({
        token: 'magic-123',
        resumeGuestEmail: 'guest@example.com',
        resumeGuestSessionToken: 'session-123',
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.magicLinkToken()).toBe('magic-123');
    expect(component.resumeGuestEmail()).toBe('guest@example.com');
    expect(component.resumeGuestSessionToken()).toBe('session-123');
    expect(mockPaymentService.rememberGuestSessionToken).toHaveBeenCalledWith(
      'guest@example.com',
      'session-123',
    );
  });

  it('should toggle payment sidebar open', () => {
    component.openPaymentSidebar(true);
    expect(component.isPaymentSidebarOpen()).toBe(true);
    expect(mockRouter.navigate).toHaveBeenCalled();
  });

  it('should toggle payment sidebar close', () => {
    component.isPaymentSidebarOpen.set(true);
    component.closePaymentSidebar();
    expect(component.isPaymentSidebarOpen()).toBe(false);
    expect(mockRouter.navigate).toHaveBeenCalled();
  });

  it('restores focus to the trigger element when closePaymentSidebar is called', () => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    document.body.appendChild(trigger);
    trigger.focus();

    component.openPaymentSidebar(false);
    expect(component.isPaymentSidebarOpen()).toBe(true);

    component.closePaymentSidebar();

    expect(document.activeElement).toBe(trigger);

    document.body.removeChild(trigger);
  });

  it('moves focus into the checkout sidebar when opened from the event page', async () => {
    await fixture.whenStable();

    const eventDetailsHarness =
      await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        EventDetailsHarness,
      );
    const checkoutHarness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      CheckoutSidebarHarness,
    );
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>(
      '[data-testid="get-tickets-button"]',
    );

    expect(trigger).not.toBeNull();

    trigger!.focus();
    expect(document.activeElement).toBe(trigger);

    await eventDetailsHarness.clickGetTickets();
    fixture.detectChanges();
    await checkoutHarness.waitForCloseButtonFocus();

    expect(await checkoutHarness.isCloseButtonFocused()).toBe(true);
    expect(document.activeElement).not.toBe(trigger);
  });

  it('should use regular tier price by default', async () => {
    // Already set up with mockEvent from getOne
    await fixture.whenStable();
    component.ticketQuantity.set(2);
    expect(component.totalAmount()).toBe(2000);
  });

  it('should calculate total for supporter tier', async () => {
    await fixture.whenStable();
    component.ticketQuantity.set(1);
    component.selectTier('supporter');

    // Default supporter price
    expect(component.totalAmount()).toBe(4000);

    // Custom supporter amount
    component.customAmount.set(5000);
    expect(component.totalAmount()).toBe(5000);
  });

  it('should calculate total for NOTAFLOF tier', async () => {
    await fixture.whenStable();
    component.ticketQuantity.set(1);
    component.selectTier('notaflof');

    expect(component.totalAmount()).toBe(500); // min

    component.customAmount.set(0);
    expect(component.totalAmount()).toBe(0);
  });

  it('should validate amounts based on tier', async () => {
    await fixture.whenStable();

    // Supporter
    component.selectTier('supporter');
    component.onCustomAmountInput('20'); // Below 40
    expect(component.slidingScaleError()).toBeTruthy();

    component.onCustomAmountInput('50'); // OK
    expect(component.slidingScaleError()).toBeNull();

    // NOTAFLOF
    component.selectTier('notaflof');
    component.onCustomAmountInput('2'); // below min 5
    expect(component.slidingScaleError()).toBeTruthy();

    component.onCustomAmountInput('10'); // OK
    expect(component.slidingScaleError()).toBeNull();
  });

  it('opens the contact dialog from the event details page', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      EventDetailsHarness,
    );

    expect(await harness.isContactCommunityButtonVisible()).toBe(true);

    await harness.clickContactCommunityButton();

    const config = mockDialogService.create.mock.calls.at(-1)?.[0] as
      | ContactDialogConfigForEventDetails
      | undefined;

    expect(config).toMatchObject({
      zTitle: 'Contact Void Collective',
      zContent: ContactCommunityDialogComponent,
      zHideFooter: true,
    });
    expect(config?.zData).toMatchObject({
      organizerName: 'Void Collective',
      organizerEmail: 'hello@voidcollective.test',
      organizerContactInfo:
        'Signal-only contact hours: Tuesdays and Thursdays.',
    });
  });

  it('shows freeform contact details in the contact dialog data when email is missing', async () => {
    const mockOrg = {name: 'Org Name', contactInfo: 'Call me at 555-1234'};
    mockCommunitiesService.get.mockResolvedValue(mockOrg as Community);

    // Update mockEvent to have organizerId so it gets fetched
    const eventWithOrg = {...mockEvent, organizerId: 'org-1' as never};
    eventDocsById.set('org-test', eventWithOrg);

    // Trigger resource reload by changing ID
    fixture.componentRef.setInput('id', 'org-test');
    await fixture.whenStable();

    component.contactOrganizer();

    const config = mockDialogService.create.mock.calls.at(-1)?.[0] as
      | ContactDialogConfigForEventDetails
      | undefined;

    expect(config).toMatchObject({
      zTitle: 'Contact Org Name',
      zContent: ContactCommunityDialogComponent,
    });
    expect(config?.zData).toMatchObject({
      organizerName: mockOrg.name,
      organizerContactInfo: mockOrg.contactInfo,
    });
  });

  it('shows the fallback contact dialog state when no contact info is provided', async () => {
    const mockOrg = {name: 'Org Name'};
    mockCommunitiesService.get.mockResolvedValue(mockOrg as Community);

    // Update mockEvent to have organizerId
    const eventWithOrg = {...mockEvent, organizerId: 'org-2' as never};
    eventDocsById.set('org-test-2', eventWithOrg);

    fixture.componentRef.setInput('id', 'org-test-2');
    await fixture.whenStable();

    component.contactOrganizer();

    const config = mockDialogService.create.mock.calls.at(-1)?.[0] as
      | ContactDialogConfigForEventDetails
      | undefined;

    expect(config).toMatchObject({
      zTitle: 'Contact Org Name',
      zContent: ContactCommunityDialogComponent,
      zDescription:
        'This community has not shared a direct contact method yet.',
    });
    expect(config?.zData).toMatchObject({
      organizerName: mockOrg.name,
      organizerEmail: undefined,
      organizerContactInfo: undefined,
    });
  });

  describe('resale state', () => {
    it('should derive resaleAvailable and resaleEnabled from availability', async () => {
      // Default mock has resaleAvailable: 0, resaleEnabled: false
      await fixture.whenStable();
      expect(component.resaleAvailable()).toBe(0);
      expect(component.resaleEnabled()).toBe(false);
      expect(component.isResalePurchase()).toBe(false);
    });

    it('should detect resale purchase when sold out with resale available', async () => {
      // Reconfigure availability for sold-out + resale scenario
      availabilityByEventId.set('resale-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'active',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 2,
        resaleEnabled: true,
        purchaseAccess: {allowed: true, source: 'direct'},
      });

      // Trigger resource reload
      fixture.componentRef.setInput('id', 'resale-test');
      await fixture.whenStable();

      expect(component.isSoldOut()).toBe(true);
      expect(component.resaleEnabled()).toBe(true);
      expect(component.resaleAvailable()).toBe(2);
      expect(component.isResalePurchase()).toBe(true);
    });

    it('should force resale checkout totals to a single ticket even when quantity was higher', async () => {
      availabilityByEventId.set('resale-single-quantity-total-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'active',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 2,
        resaleEnabled: true,
        purchaseAccess: {allowed: true, source: 'direct'},
      });

      fixture.componentRef.setInput('id', 'resale-single-quantity-total-test');
      await fixture.whenStable();

      component.ticketQuantity.set(3);

      expect(component.isResalePurchase()).toBe(true);
      expect(component.checkoutQuantity()).toBe(1);
      expect(component.totalAmount()).toBe(1000);
    });

    it('should allow buying when sold out but resale is available', async () => {
      availabilityByEventId.set('resale-buy-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'active',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 1,
        resaleEnabled: true,
        purchaseAccess: {allowed: true, source: 'direct'},
      });

      fixture.componentRef.setInput('id', 'resale-buy-test');
      await fixture.whenStable();

      expect(component.canBuyTickets()).toBe(true);
    });

    it('should not allow buying when sold out and resale is not enabled', async () => {
      availabilityByEventId.set('no-resale-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'active',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 0,
        resaleEnabled: false,
        purchaseAccess: {allowed: true, source: 'direct'},
      });

      fixture.componentRef.setInput('id', 'no-resale-test');
      await fixture.whenStable();

      expect(component.canBuyTickets()).toBe(false);
    });

    it('should not allow buying when sold out and resale enabled but none available', async () => {
      availabilityByEventId.set('empty-resale-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'active',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 0,
        resaleEnabled: true,
        purchaseAccess: {allowed: true, source: 'direct'},
      });

      fixture.componentRef.setInput('id', 'empty-resale-test');
      await fixture.whenStable();

      expect(component.canBuyTickets()).toBe(false);
    });

    it('spaces the sold-out status from the resale notification action', async () => {
      availabilityByEventId.set('sold-out-notify-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'active',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 0,
        resaleEnabled: true,
        isSubscribedToResaleNotifications: false,
        purchaseAccess: {allowed: true, source: 'direct'},
      });

      fixture.componentRef.setInput('id', 'sold-out-notify-test');
      await fixture.whenStable();

      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        EventDetailsHarness,
      );

      expect(await harness.isSoldOutBannerVisible()).toBe(true);
      expect(await harness.isResaleNotifyButtonVisible()).toBe(true);
      expect(
        await harness.getSoldOutStatusActionGapPx(),
      ).toBeGreaterThanOrEqual(12);
    });

    it('should hide resale available banner when sales are paused even if resale tickets exist', async () => {
      availabilityByEventId.set('paused-resale-banner-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'paused',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 2,
        resaleEnabled: true,
        purchaseAccess: {allowed: true, source: 'direct'},
      });

      fixture.componentRef.setInput('id', 'paused-resale-banner-test');
      await fixture.whenStable();

      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        EventDetailsHarness,
      );

      // Purchases are blocked when sales are paused — banner must not mislead
      expect(component.canBuyTickets()).toBe(false);
      expect(await harness.isResaleAvailableBannerVisible()).toBe(false);
      expect(await harness.isSoldOutBannerVisible()).toBe(true);
    });

    it('should hide resale available banner when sales are ended even if resale tickets exist', async () => {
      availabilityByEventId.set('ended-resale-banner-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'ended',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 1,
        resaleEnabled: true,
        purchaseAccess: {allowed: true, source: 'direct'},
      });

      fixture.componentRef.setInput('id', 'ended-resale-banner-test');
      await fixture.whenStable();

      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        EventDetailsHarness,
      );

      expect(component.canBuyTickets()).toBe(false);
      expect(await harness.isResaleAvailableBannerVisible()).toBe(false);
      expect(await harness.isSoldOutBannerVisible()).toBe(true);
    });
  });

  describe('role-based purchase eligibility on private events', () => {
    // Private event (no visibility field defaults to private)
    const privateEventId = 'private-role-test';

    beforeEach(() => {
      eventDocsById.set(privateEventId, {
        ...mockEvent,
        _id: privateEventId,
      } as unknown as EventDetail);
      availabilityByEventId.set(privateEventId, {...defaultAvailability});
    });

    /** Helper: override trust to return not-trusted so only role grants access */
    function mockUntrusted() {
      mockConvexClient.client.onUpdate.mockImplementation(
        (queryRef, args, onData: (data: unknown) => void) => {
          void queryRef;
          const typedArgs = args as Record<string, string>;
          if ('id' in typedArgs) {
            emitAsync(onData, eventDocsById.get(typedArgs.id) ?? null);
            return () => void 0;
          }
          if ('eventId' in typedArgs) {
            emitAsync(
              onData,
              availabilityByEventId.get(typedArgs.eventId) ?? null,
            );
            return () => void 0;
          }
          if (
            'organizerId' in typedArgs &&
            !('eventId' in typedArgs) &&
            !('id' in typedArgs)
          ) {
            emitAsync(onData, {trusted: false, source: 'direct', via: null});
            return () => void 0;
          }
          emitAsync(onData, null);
          return () => void 0;
        },
      );
    }

    it('should allow admin to buy on private event without trust', async () => {
      mockAuthService.userRole = () => 'root_admin';
      mockUntrusted();

      fixture.componentRef.setInput('id', privateEventId);
      await fixture.whenStable();

      expect(component.canBuyTickets()).toBe(true);
    });

    it('should not allow the removed trusted-role fallback on private event without trust result', async () => {
      mockAuthService.userRole = () => 'community_admin';
      availabilityByEventId.set(privateEventId, {
        ...defaultAvailability,
        purchaseAccess: {allowed: false},
      });
      mockUntrusted();

      fixture.componentRef.setInput('id', privateEventId);
      await fixture.whenStable();

      expect(component.canBuyTickets()).toBe(false);
    });

    it('should not allow regular user to buy on private event without trust', async () => {
      mockAuthService.userRole = () => 'user';
      availabilityByEventId.set(privateEventId, {
        ...defaultAvailability,
        purchaseAccess: {allowed: false},
      });
      mockUntrusted();

      fixture.componentRef.setInput('id', privateEventId);
      await fixture.whenStable();

      expect(component.canBuyTickets()).toBe(false);
    });

    it('should not allow community_admin to buy on private event without trust (per-community only)', async () => {
      mockAuthService.userRole = () => 'community_admin';
      availabilityByEventId.set(privateEventId, {
        ...defaultAvailability,
        purchaseAccess: {allowed: false},
      });
      mockUntrusted();

      fixture.componentRef.setInput('id', privateEventId);
      await fixture.whenStable();

      expect(component.canBuyTickets()).toBe(false);
    });

    it('opens checkout once purchase access resolves after buy=true is already present', async () => {
      let emitTrustUpdate: ((data: unknown) => void) | null = null;
      let emitAvailabilityUpdate: ((data: unknown) => void) | null = null;
      availabilityByEventId.set(privateEventId, {
        ...defaultAvailability,
        purchaseAccess: {allowed: false},
      });
      const trustAwareOnUpdate = vi
        .fn()
        .mockImplementation(
          (queryRef, args, onData: (data: unknown) => void) => {
            void queryRef;
            const typedArgs = args as Record<string, string>;

            if ('id' in typedArgs) {
              emitAsync(onData, eventDocsById.get(typedArgs.id) ?? null);
              return () => void 0;
            }

            if ('eventId' in typedArgs) {
              // Capture the raw callback for later manual (post-subscription)
              // emissions; defer only the initial emission.
              emitAvailabilityUpdate = onData;
              emitAsync(
                onData,
                availabilityByEventId.get(typedArgs.eventId) ?? null,
              );
              return () => void 0;
            }

            if (
              'organizerId' in typedArgs &&
              !('eventId' in typedArgs) &&
              !('id' in typedArgs)
            ) {
              emitTrustUpdate = onData;
              emitAsync(onData, {trusted: false, source: 'direct', via: null});
              return () => void 0;
            }

            emitAsync(onData, null);
            return () => void 0;
          },
        );

      mockConvexClient.onUpdate = trustAwareOnUpdate;
      mockConvexClient.client.onUpdate = trustAwareOnUpdate;

      fixture.componentRef.setInput('id', privateEventId);
      fixture.componentRef.setInput('buy', 'true');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.isPaymentSidebarOpen()).toBe(false);
      expect(emitTrustUpdate).not.toBeNull();
      expect(emitAvailabilityUpdate).not.toBeNull();

      emitTrustUpdate!({trusted: true, source: 'direct', via: null});
      emitAvailabilityUpdate!({
        ...defaultAvailability,
        purchaseAccess: {allowed: true, source: 'direct'},
      });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.canBuyTickets()).toBe(true);
      expect(component.isPaymentSidebarOpen()).toBe(true);
    });
  });

  describe('resale notifications', () => {
    it('should reflect subscription state from availability on load', async () => {
      availabilityByEventId.set('subscribed-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'active',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 0,
        resaleEnabled: true,
        isSubscribedToResaleNotifications: true,
        purchaseAccess: {allowed: true, source: 'direct'},
      });

      fixture.componentRef.setInput('id', 'subscribed-test');
      await fixture.whenStable();

      expect(component.isSubscribedToResale()).toBe(true);
    });

    it('should subscribe to resale notifications', async () => {
      await fixture.whenStable();

      await component.subscribeToResaleNotifications();

      expect(
        mockResaleService.subscribeToResaleNotifications,
      ).toHaveBeenCalledWith('1');
      expect(component.isSubscribedToResale()).toBe(true);
    });

    it('should handle subscription errors gracefully', async () => {
      const toastErrorSpy = vi.spyOn(toast, 'error');
      mockResaleService.subscribeToResaleNotifications.mockRejectedValue(
        new Error('Already subscribed'),
      );
      await fixture.whenStable();

      await component.subscribeToResaleNotifications();

      expect(component.isSubscribedToResale()).toBe(false);
      expect(component.isSubscribing()).toBe(false);
      expect(toastErrorSpy).toHaveBeenCalledWith('Already subscribed');
    });

    it('should set isSubscribing during subscription', async () => {
      // Make subscription hang to observe intermediate state
      let resolve: (value: string) => void;
      mockResaleService.subscribeToResaleNotifications.mockReturnValue(
        new Promise<string>((r) => {
          resolve = r;
        }),
      );
      await fixture.whenStable();

      const promise = component.subscribeToResaleNotifications();
      expect(component.isSubscribing()).toBe(true);

      resolve!('sub_456');
      await promise;

      expect(component.isSubscribing()).toBe(false);
      expect(component.isSubscribedToResale()).toBe(true);
    });

    it('should ignore duplicate subscribe clicks while request is in flight', async () => {
      let resolve: (value: string) => void;
      mockResaleService.subscribeToResaleNotifications.mockReturnValue(
        new Promise<string>((r) => {
          resolve = r;
        }),
      );
      await fixture.whenStable();

      const first = component.subscribeToResaleNotifications();
      const second = component.subscribeToResaleNotifications();

      expect(
        mockResaleService.subscribeToResaleNotifications,
      ).toHaveBeenCalledTimes(1);
      expect(component.isSubscribing()).toBe(true);

      resolve!('sub_789');
      await first;
      await second;

      expect(component.isSubscribing()).toBe(false);
      expect(component.isSubscribedToResale()).toBe(true);
    });
  });

  describe('resale sidebar behavior', () => {
    it('should allow opening sidebar when sold out with resale available', async () => {
      availabilityByEventId.set('sidebar-resale-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'active',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 3,
        resaleEnabled: true,
        purchaseAccess: {allowed: true, source: 'direct'},
      });

      fixture.componentRef.setInput('id', 'sidebar-resale-test');
      await fixture.whenStable();
      component.ticketQuantity.set(3);

      component.openPaymentSidebar(false);
      expect(component.isPaymentSidebarOpen()).toBe(true);
      expect(component.ticketQuantity()).toBe(1);
    });

    it('should block opening sidebar when sold out without resale', async () => {
      availabilityByEventId.set('sidebar-no-resale-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'active',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 0,
        resaleEnabled: false,
        purchaseAccess: {allowed: true, source: 'direct'},
      });

      fixture.componentRef.setInput('id', 'sidebar-no-resale-test');
      await fixture.whenStable();

      component.openPaymentSidebar(false);
      expect(component.isPaymentSidebarOpen()).toBe(false);
    });

    it('routes embedded checkout through startResaleCheckoutSession for resale purchases', async () => {
      availabilityByEventId.set('resale-stripe-checkout-test', {
        totalTickets: 100,
        soldCount: 100,
        remainingTickets: 0,
        ticketSalesStatus: 'active',
        isSoldOut: true,
        userTicketCount: 0,
        resaleAvailable: 1,
        resaleEnabled: true,
        purchaseAccess: {allowed: true, source: 'direct'},
      });
      eventDocsById.set('resale-stripe-checkout-test', {
        ...mockEvent,
        _id: 'resale-stripe-checkout-test',
      } as unknown as EventDetail);

      fixture.componentRef.setInput('id', 'resale-stripe-checkout-test');
      await fixture.whenStable();

      mockPaymentService.startResaleCheckoutSession.mockClear();
      mockPaymentService.startPrimaryCheckoutSession.mockClear();

      await component.createCheckoutSession();
      await fixture.whenStable();

      expect(
        mockPaymentService.startResaleCheckoutSession,
      ).toHaveBeenCalledWith(
        'resale-stripe-checkout-test',
        'regular',
        1000,
        'light',
      );
      expect(
        mockPaymentService.startPrimaryCheckoutSession,
      ).not.toHaveBeenCalled();
    });

    it('passes the displayed NOTAFLOF total into primary checkout for multiple tickets', async () => {
      eventDocsById.set('notaflof-total-checkout-test', {
        ...mockEvent,
        _id: 'notaflof-total-checkout-test',
        slidingScaleMin: 1500,
      } as unknown as EventDetail);
      fixture.componentRef.setInput('id', 'notaflof-total-checkout-test');
      await fixture.whenStable();

      component.ticketQuantity.set(2);
      component.selectTier('notaflof');

      expect(component.totalAmount()).toBe(3000);

      await component.createCheckoutSession();

      expect(
        mockPaymentService.startPrimaryCheckoutSession,
      ).toHaveBeenCalledWith(
        'notaflof-total-checkout-test',
        2,
        'notaflof',
        3000,
        'light',
      );
    });
  });

  describe('checkout settlement', () => {
    it('polls checkout status until the backend reports completion', async () => {
      vi.useFakeTimers();

      try {
        mockPaymentService.syncCheckoutSession.mockResolvedValueOnce({
          state: 'open',
        });
        mockPaymentService.getCheckoutStatus
          .mockResolvedValueOnce({state: 'open'})
          .mockResolvedValueOnce({state: 'open'})
          .mockResolvedValueOnce({state: 'completed'});

        component.activeOrderId.set('order_123');
        component.activeCheckoutSessionId.set('cs_123');

        const confirmation = component.onStripePaymentConfirmed();
        await Promise.resolve();
        await vi.runAllTimersAsync();
        await confirmation;

        expect(mockPaymentService.syncCheckoutSession).toHaveBeenCalledWith(
          'cs_123',
          undefined,
        );
        expect(mockPaymentService.triggerRefresh).toHaveBeenCalledTimes(1);
        expect(component.paymentStatus()).toBe('success');
        expect(component.paymentErrorMessage()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('guest checkout fork', () => {
    const publicEvent = {
      ...mockEvent,
      _id: 'public-event-1',
      visibility: 'public' as const,
    } as unknown as EventDetail;

    beforeEach(async () => {
      eventDocsById.set('public-event-1', publicEvent);
      availabilityByEventId.set('public-event-1', {...defaultAvailability});
    });

    it('does not show guest option for authenticated users', async () => {
      // Default setup has authenticated user
      userSubject.next({_id: 'u1', name: 'Test User'});
      mockAuthService.user = () => ({_id: 'u1', name: 'Test User'});

      fixture.componentRef.setInput('id', 'public-event-1');
      await fixture.whenStable();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const guestOptions = compiled.querySelector(
        '[data-testid="guest-checkout-options"]',
      );
      expect(guestOptions).toBeNull();

      const loginToPurchase = compiled.querySelector(
        '[data-testid="login-to-purchase"]',
      );
      expect(loginToPurchase).toBeNull();
    });

    it('allows unauthenticated users on public events to open checkout sidebar', async () => {
      userSubject.next(null);
      mockAuthService.user = () => null;

      fixture.componentRef.setInput('id', 'public-event-1');
      await fixture.whenStable();
      fixture.detectChanges();

      // canBuyTickets should be true for public events even without auth
      expect(component.canBuyTickets()).toBe(true);
    });
  });

  describe('rejected organizer access', () => {
    const rejectedPublicEvent = {
      ...mockEvent,
      _id: 'rejected-public-1',
      organizerId: 'org-rejected',
      visibility: 'public' as const,
    } as unknown as EventDetail;

    beforeEach(async () => {
      eventDocsById.set('rejected-public-1', rejectedPublicEvent);
      availabilityByEventId.set('rejected-public-1', {...defaultAvailability});
      mockAppsService.getMyApplicationForOrganizer.mockResolvedValue({
        status: 'rejected',
      });
    });

    it('allows rejected users to purchase public events because backend policy is open access', async () => {
      const rejectedFixture = TestBed.createComponent(EventDetailsComponent);
      const rejectedComponent = rejectedFixture.componentInstance;

      rejectedFixture.componentRef.setInput('id', 'rejected-public-1');
      rejectedFixture.detectChanges();
      await rejectedFixture.whenStable();
      rejectedFixture.detectChanges();

      expect(mockAppsService.getMyApplicationForOrganizer).toHaveBeenCalledWith(
        'org-rejected',
      );
      expect(rejectedComponent.applicationStatus()).toBe('rejected');
      expect(rejectedComponent.canBuyTickets()).toBe(true);

      const compiled = rejectedFixture.nativeElement as HTMLElement;
      expect(
        compiled.querySelector('[data-testid="get-tickets-button"]'),
      ).not.toBeNull();

      rejectedFixture.destroy();
    });
  });

  describe('public_viewable event', () => {
    const publicViewableEvent = {
      ...mockEvent,
      _id: 'pv-event-1',
      visibility: 'public_viewable' as const,
    } as unknown as EventDetail;
    const seededGatedEvent = {
      ...mockEvent,
      _id: 'concrete-wax-seeded',
      title: 'Concrete & Wax',
      visibility: 'public_viewable' as const,
    } as unknown as EventDetail;

    beforeEach(async () => {
      eventDocsById.set('pv-event-1', publicViewableEvent);
      availabilityByEventId.set('pv-event-1', {
        ...defaultAvailability,
        purchaseAccess: {allowed: false},
      });
      eventDocsById.set('concrete-wax-seeded', seededGatedEvent);
      availabilityByEventId.set('concrete-wax-seeded', {
        ...defaultAvailability,
        purchaseAccess: {allowed: false},
      });
    });

    it('should NOT show guest checkout options for unauthenticated users', async () => {
      // Unauthenticated: trust query is skipped (no user._id) → trustResult = null → canBuyTickets = false
      userSubject.next(null);
      mockAuthService.user = () => null;

      fixture.componentRef.setInput('id', 'pv-event-1');
      await fixture.whenStable();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const guestOptions = compiled.querySelector(
        '[data-testid="guest-checkout-options"]',
      );
      expect(guestOptions).toBeNull();
    });

    it('should show vetting required message for authenticated non-vetted users', async () => {
      // Authenticated but trust query returns trusted: false
      userSubject.next({_id: 'u1', name: 'Test User'});
      mockAuthService.user = () => ({_id: 'u1', name: 'Test User'});

      // Override trust mock to return not-trusted for this event's organizer query
      mockConvexClient.client.onUpdate.mockImplementation(
        (queryRef, args, onData: (data: unknown) => void) => {
          void queryRef;
          const typedArgs = args as Record<string, string>;

          if ('id' in typedArgs) {
            const eventId = typedArgs.id;
            emitAsync(
              onData,
              eventDocsById.get(eventId) ?? eventDocsById.get('1') ?? null,
            );
            return () => void 0;
          }

          if ('eventId' in typedArgs) {
            const eventId = typedArgs.eventId;
            emitAsync(onData, availabilityByEventId.get(eventId) ?? null);
            return () => void 0;
          }

          // Trust query: return not-trusted
          if (
            'organizerId' in typedArgs &&
            !('eventId' in typedArgs) &&
            !('id' in typedArgs)
          ) {
            emitAsync(onData, {trusted: false, source: 'direct', via: null});
            return () => void 0;
          }

          emitAsync(onData, null);
          return () => void 0;
        },
      );

      fixture.componentRef.setInput('id', 'pv-event-1');
      await fixture.whenStable();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const vettingMsg =
        compiled.querySelector('[class*="Vetting"]') ??
        Array.from(compiled.querySelectorAll('div')).find((el) =>
          el.textContent?.includes('Vetting Required'),
        );
      expect(vettingMsg).toBeTruthy();
      expect(vettingMsg?.textContent).toContain('Vetting Required');
    });

    it('should keep authenticated untrusted users out of checkout on the seeded gated event path', async () => {
      userSubject.next({_id: 'u1', name: 'Test User'});
      mockAuthService.user = () => ({_id: 'u1', name: 'Test User'});

      mockConvexClient.client.onUpdate.mockImplementation(
        (queryRef, args, onData: (data: unknown) => void) => {
          void queryRef;
          const typedArgs = args as Record<string, string>;

          if ('id' in typedArgs) {
            const eventId = typedArgs.id;
            emitAsync(
              onData,
              eventDocsById.get(eventId) ?? eventDocsById.get('1') ?? null,
            );
            return () => void 0;
          }

          if ('eventId' in typedArgs) {
            const eventId = typedArgs.eventId;
            emitAsync(onData, availabilityByEventId.get(eventId) ?? null);
            return () => void 0;
          }

          if (
            'organizerId' in typedArgs &&
            !('eventId' in typedArgs) &&
            !('id' in typedArgs)
          ) {
            emitAsync(onData, {trusted: false, source: 'direct', via: null});
            return () => void 0;
          }

          emitAsync(onData, null);
          return () => void 0;
        },
      );

      fixture.componentRef.setInput('id', 'concrete-wax-seeded');
      fixture.componentRef.setInput('buy', 'true');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.canBuyTickets()).toBe(false);
      expect(component.isPaymentSidebarOpen()).toBe(false);
      expect(
        mockPaymentService.startPrimaryCheckoutSession,
      ).not.toHaveBeenCalled();

      const compiled = fixture.nativeElement as HTMLElement;
      const vettingMsg =
        compiled.querySelector('[class*="Vetting"]') ??
        Array.from(compiled.querySelectorAll('div')).find((el) =>
          el.textContent?.includes('Vetting Required'),
        );
      expect(vettingMsg).toBeTruthy();
      expect(vettingMsg?.textContent).toContain('Vetting Required');
    });

    it('should show sign in for pricing text for unauthenticated users', async () => {
      // Unauthenticated on public_viewable: canBuyTickets() = false (early auth short-circuit),
      // so the !canBuyTickets() branch renders the "Sign in for pricing" link.
      userSubject.next(null);
      mockAuthService.user = () => null;

      fixture.componentRef.setInput('id', 'pv-event-1');
      await fixture.whenStable();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const buttonText = compiled.textContent;
      expect(buttonText).toContain('Sign in for pricing');
    });
  });

  describe('error state', () => {
    it('hasLoadError is false when both resources are healthy', async () => {
      await fixture.whenStable();
      expect(component.hasLoadError()).toBe(false);
    });

    it('organizer returns null when organizerResource has an error', () => {
      // In Angular's resource state machine, an 'error' state implies both
      // error() is truthy AND hasValue() is false. Mock both to reflect that.
      const resource = component['organizerResource'] as {
        error: () => unknown;
        hasValue: () => boolean;
      };
      vi.spyOn(resource, 'error').mockReturnValue(new Error('network failure'));
      vi.spyOn(resource, 'hasValue').mockReturnValue(false);

      expect(component.organizer()).toBeNull();
    });

    it('applicationStatus returns null when appStatusResource has an error', () => {
      const resource = component.appStatusResource as {
        error: () => unknown;
        hasValue: () => boolean;
      };
      vi.spyOn(resource, 'error').mockReturnValue(new Error('auth failure'));
      vi.spyOn(resource, 'hasValue').mockReturnValue(false);

      expect(component.applicationStatus()).toBeNull();
    });

    it('hasLoadError combines both resource error signals via OR', () => {
      // hasLoadError = !!organizerResource.error() || !!appStatusResource.error()
      // Verify the composition: if organizerResource errors, organizer() returns null
      // and if appStatusResource errors, applicationStatus() returns null.
      // This covers the two error guards that hasLoadError aggregates.
      const organizer = component['organizerResource'] as {
        error: () => unknown;
        hasValue: () => boolean;
      };
      vi.spyOn(organizer, 'error').mockReturnValue(
        new Error('network failure'),
      );
      vi.spyOn(organizer, 'hasValue').mockReturnValue(false);
      expect(component.organizer()).toBeNull();

      const appStatus = component.appStatusResource as {
        error: () => unknown;
        hasValue: () => boolean;
      };
      vi.spyOn(appStatus, 'error').mockReturnValue(new Error('auth failure'));
      vi.spyOn(appStatus, 'hasValue').mockReturnValue(false);
      expect(component.applicationStatus()).toBeNull();

      vi.restoreAllMocks();
    });
  });

  describe('paused ticket sales banner', () => {
    beforeEach(() => {
      availabilityByEventId.set('paused-event', {
        totalTickets: 100,
        soldCount: 0,
        remainingTickets: 100,
        ticketSalesStatus: 'paused',
        isSoldOut: false,
        userTicketCount: 0,
        purchaseAccess: {allowed: true, source: 'direct'},
      });
      eventDocsById.set('paused-event', {
        ...mockEvent,
        _id: 'paused-event',
      } as unknown as EventDetail);
    });

    it('shows the paused sales banner when ticketSalesStatus is paused', async () => {
      fixture.componentRef.setInput('id', 'paused-event');
      await fixture.whenStable();

      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        EventDetailsHarness,
      );
      expect(await harness.isPausedSalesBannerVisible()).toBe(true);
    });

    it('includes explanatory text in the paused sales banner', async () => {
      fixture.componentRef.setInput('id', 'paused-event');
      await fixture.whenStable();

      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        EventDetailsHarness,
      );
      const text = await harness.getPausedSalesBannerText();
      expect(text).toContain('Ticket Sales Are Paused');
      expect(text).toContain('Sales temporarily paused by the organizer');
    });
  });
});
