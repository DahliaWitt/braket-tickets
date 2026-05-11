import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {DashboardComponent} from './dashboard.component';
import {DashboardComponentHarness} from './dashboard.component.harness';
import {AuthService} from '@/core/services/auth.service';
import {
  DashboardDataService,
  type EventAvailability,
} from '@/features/dashboard/services/dashboard-data.service';
import {
  DashboardPageDataService,
  type DashboardApproval,
} from '@/features/dashboard/services/dashboard-page-data.service';
import {provideRouter} from '@angular/router';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {type UpcomingEvent} from '@/core/models/event.types';
import {type Community} from '@/core/services/communities.service';
import {vi, beforeAll, describe, it, expect, beforeEach} from 'vitest';
import type {Id} from '@convex/_generated/dataModel';
import type {ApplicationStatus} from '@shared/domain/application-status';
import type {CommunityPublicationStatus} from '@shared/domain/community-publication-status';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const ORG_ID_A = 'org-a' as Id<'organizers'>;
const ORG_ID_B = 'org-b' as Id<'organizers'>;

const mockEvent: UpcomingEvent = {
  _id: '1' as Id<'events'>,
  _creationTime: 123,
  totalTickets: 100,
  title: 'Test Event',
  date: '2024-12-25',
  location: 'Cyber City',
  description: 'A test event',
  price: 5000,
  status: 'published',
  organizerId: ORG_ID_A,
  visibility: 'private',
} as never;

const mockPublicEvent: UpcomingEvent = {
  _id: '2' as Id<'events'>,
  _creationTime: 124,
  totalTickets: 200,
  title: 'Public Party',
  date: '2024-12-30',
  location: 'Open Square',
  description: 'A public event',
  price: 3000,
  status: 'published',
  organizerId: ORG_ID_B,
  visibility: 'public',
} as never;

const mockViewableEvent: UpcomingEvent = {
  _id: '3' as Id<'events'>,
  _creationTime: 125,
  totalTickets: 50,
  title: 'Viewable Event',
  date: '2024-12-31',
  location: 'Gallery',
  description: 'A viewable event',
  price: 4000,
  status: 'published',
  organizerId: ORG_ID_B,
  visibility: 'public_viewable',
} as never;

interface PublicCommunity {
  _id: Id<'organizers'>;
  name: string;
  status: CommunityPublicationStatus;
  description?: string;
  slug?: string;
  logoUrl?: string;
}

const mockApprovals: DashboardApproval[] = [
  {
    organizerId: ORG_ID_A,
    organizerName: 'Underground Collective',
    source: 'direct',
  },
];

const mockPublicCommunities: PublicCommunity[] = [
  {
    _id: ORG_ID_A,
    name: 'Underground Collective',
    status: 'published',
    description: 'A community',
  },
  {
    _id: ORG_ID_B,
    name: 'Open Events',
    status: 'published',
    description: 'Public events',
  },
];

const mockPublicCommunitiesWithDraft: PublicCommunity[] = [
  {
    _id: ORG_ID_A,
    name: 'Underground Collective',
    status: 'published',
    description: 'A community',
  },
  {
    _id: ORG_ID_B,
    name: 'Open Events',
    status: 'draft',
    description: 'Public events',
  },
];

// ---------------------------------------------------------------------------
// Signals for DashboardDataService mock
// ---------------------------------------------------------------------------

const applicationStatusSignal = signal<string | null>(null);
const applicationReasonSignal = signal<string | null>(null);
const eventsSignal = signal<UpcomingEvent[]>([mockEvent]);
const communitiesSignal = signal<Community[]>([]);
const eventAvailabilitySignal = signal<Record<string, EventAvailability>>({});
const isLoadingSignal = signal(false);
const hasLoadErrorSignal = signal(false);
const approvalsSignal = signal<DashboardApproval[]>([]);
const approvalsLoadingSignal = signal(false);
const myApplicationsSignal = signal<typeof myApplicationsData>([]);
const myApplicationsLoadingSignal = signal(false);
const publicCommunitiesSignal = signal<PublicCommunity[]>([]);

const dashboardDataMock = {
  dashboardResource: {
    reload: vi.fn(),
  },
  applicationStatus: applicationStatusSignal,
  applicationReason: applicationReasonSignal,
  events: eventsSignal,
  communities: communitiesSignal,
  eventAvailability: eventAvailabilitySignal,
  isLoading: isLoadingSignal,
  hasLoadError: hasLoadErrorSignal,
};

const dashboardPageDataMock = {
  approvals: approvalsSignal,
  approvalsLoading: approvalsLoadingSignal,
  myApplications: myApplicationsSignal,
  myApplicationsLoading: myApplicationsLoadingSignal,
  publicCommunities: publicCommunitiesSignal,
};

const userSignal = signal({_id: '123', name: 'testuser'});
const userRoleSignal = signal('user');

const authServiceMock = {
  user: userSignal,
  userRole: userRoleSignal,
  isCommunityAdmin: signal(false),
  isScannerStaff: signal(false),
  isScannerStaffLoading: signal(false),
  isSyncingUser: signal(false),
  logout: vi.fn(),
};

let approvalsData: DashboardApproval[] = [];
let myApplicationsData: {
  _id: string;
  _creationTime: number;
  organizerId?: string;
  organizerName: string;
  organizerLogoUrl?: string;
  status: ApplicationStatus;
  denyReason?: string;
  reason?: string;
}[] = [];
let publicCommunitiesData: PublicCommunity[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let harness: DashboardComponentHarness;

  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  function setup(options?: {
    approvals?: DashboardApproval[];
    myApplications?: typeof myApplicationsData;
    publicCommunities?: PublicCommunity[];
    events?: UpcomingEvent[];
    applicationStatus?: string | null;
    eventAvailability?: Record<string, EventAvailability>;
    hasLoadError?: boolean;
  }) {
    // Configure data before TestBed creation (effects fire during component init)
    approvalsData = options?.approvals ?? [];
    myApplicationsData = options?.myApplications ?? [];
    publicCommunitiesData = options?.publicCommunities ?? [];
    applicationStatusSignal.set(options?.applicationStatus ?? null);
    applicationReasonSignal.set(null);
    eventsSignal.set(options?.events ?? [mockEvent]);
    communitiesSignal.set([]);
    eventAvailabilitySignal.set(options?.eventAvailability ?? {});
    isLoadingSignal.set(false);
    hasLoadErrorSignal.set(options?.hasLoadError ?? false);
    approvalsSignal.set(approvalsData);
    approvalsLoadingSignal.set(false);
    myApplicationsSignal.set(myApplicationsData);
    myApplicationsLoadingSignal.set(false);
    publicCommunitiesSignal.set(publicCommunitiesData);
    userRoleSignal.set('user');
  }

  async function createComponent(): Promise<void> {
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{path: '**', children: []}]),
        {provide: AuthService, useValue: authServiceMock},
        {provide: DashboardDataService, useValue: dashboardDataMock},
      ],
    });
    TestBed.overrideComponent(DashboardComponent, {
      set: {
        providers: [
          {provide: DashboardPageDataService, useValue: dashboardPageDataMock},
        ],
      },
    });
    await TestBed.compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      DashboardComponentHarness,
    );
  }

  function purchaseAccessFor(
    events: Pick<UpcomingEvent, '_id'>[],
  ): Record<string, EventAvailability> {
    return Object.fromEntries(
      events.map((event) => [
        event._id,
        {
          isSoldOut: false,
          userTicketCount: 0,
          ticketSalesStatus: 'active' as const,
          purchaseAccess: {allowed: true, source: 'direct' as const},
        },
      ]),
    );
  }

  beforeEach(() => {
    // Reset TestBed between tests so the Convex client mock call counter resets
    TestBed.resetTestingModule();
  });

  it('should create', async () => {
    setup();
    await createComponent();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should consume events from the service resource', async () => {
    setup();
    await createComponent();
    expect(fixture.componentInstance.rawEvents().length).toBe(1);
    expect(fixture.componentInstance.rawEvents()[0].title).toBe('Test Event');
  });

  // -----------------------------------------------------------------------
  // New user state (no community relationships)
  // -----------------------------------------------------------------------
  describe('new user state', () => {
    it('should detect new user when no approvals and no application', async () => {
      setup({approvals: [], applicationStatus: null});
      await createComponent();
      expect(fixture.componentInstance.isNewUser()).toBe(true);
    });

    it('should show "find your people" heading for new users', async () => {
      setup({
        approvals: [],
        applicationStatus: null,
        publicCommunities: mockPublicCommunities,
      });
      await createComponent();

      const heading = await harness.getNewUserHeading();
      expect(heading).toBe('find your people');
    });

    it('should render public communities directory for new users', async () => {
      setup({
        approvals: [],
        applicationStatus: null,
        publicCommunities: mockPublicCommunities,
      });
      await createComponent();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Underground Collective');
      expect(el.textContent).toContain('Open Events');
    });

    it('should only show apply links for published communities', async () => {
      setup({
        approvals: [],
        applicationStatus: null,
        publicCommunities: mockPublicCommunitiesWithDraft,
      });
      await createComponent();

      expect(await harness.getApplyLinkCount()).toBe(1);
    });

    it('should not be new user when approvals exist', async () => {
      setup({approvals: mockApprovals});
      await createComponent();
      expect(fixture.componentInstance.isNewUser()).toBe(false);
    });

    it('should not be new user when pending application exists', async () => {
      setup({
        approvals: [],
        myApplications: [
          {
            _id: 'app-1',
            _creationTime: 100,
            organizerId: ORG_ID_A,
            organizerName: 'Underground Collective',
            status: 'pending',
          },
        ],
      });
      await createComponent();
      expect(fixture.componentInstance.isNewUser()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Community grid (vetted user)
  // -----------------------------------------------------------------------
  describe('community grid', () => {
    it('should render community cells when approvals exist', async () => {
      setup({approvals: mockApprovals});
      await createComponent();

      const count = await harness.getCommunityCells();
      expect(count).toBe(1);
    });

    it('should display organizer name in community cell', async () => {
      setup({approvals: mockApprovals});
      await createComponent();

      const text = await harness.getCommunityCellText(0);
      expect(text).toBeTruthy();
      expect(text).toContain('Underground Collective');
    });

    it('should render multiple community cells', async () => {
      const multiApprovals: DashboardApproval[] = [
        {organizerId: ORG_ID_A, organizerName: 'Community A', source: 'direct'},
        {
          organizerId: ORG_ID_B,
          organizerName: 'Community B',
          source: 'shared',
          viaOrganizerId: ORG_ID_A,
          viaOrganizerName: 'Community A',
        },
      ];
      setup({approvals: multiApprovals});
      await createComponent();

      const count = await harness.getCommunityCells();
      expect(count).toBe(2);
    });

    it('should show "via" text for shared approvals', async () => {
      const sharedApprovals: DashboardApproval[] = [
        {
          organizerId: ORG_ID_B,
          organizerName: 'Shared Community',
          source: 'shared',
          viaOrganizerId: ORG_ID_A,
          viaOrganizerName: 'Origin Community',
        },
      ];
      setup({approvals: sharedApprovals});
      await createComponent();

      const text = await harness.getCommunityCellText(0);
      expect(text).toContain('via Origin Community');
    });

    it('should cap visible communities to 6 and show "Show All" button', async () => {
      const manyApprovals: DashboardApproval[] = Array.from(
        {length: 8},
        (_, i) => ({
          organizerId: `org-${i}` as Id<'organizers'>,
          organizerName: `Community ${i}`,
          source: 'direct' as const,
        }),
      );
      setup({approvals: manyApprovals});
      await createComponent();

      const count = await harness.getCommunityCells();
      expect(count).toBe(6);
      expect(fixture.componentInstance.hasMoreCommunities()).toBe(true);
    });

    it('should show only one card per community after re-submission (rejected then pending)', async () => {
      // Simulate re-submission: getMyApplications returns newest first (pending before rejected)
      setup({
        approvals: [],
        myApplications: [
          {
            _id: 'app-pending',
            _creationTime: 200,
            organizerId: ORG_ID_A,
            organizerName: 'Underground Collective',
            status: 'pending',
          },
          {
            _id: 'app-rejected',
            _creationTime: 100,
            organizerId: ORG_ID_A,
            organizerName: 'Underground Collective',
            status: 'rejected',
            reason: 'Incomplete answers',
          },
        ],
      });
      await createComponent();

      const entries = fixture.componentInstance.communityGridEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].status).toBe('pending');
    });
  });

  // -----------------------------------------------------------------------
  // Featured event
  // -----------------------------------------------------------------------
  describe('featured event', () => {
    it('should render featured event when accessible events exist', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        eventAvailability: purchaseAccessFor([mockEvent]),
      });
      await createComponent();

      const hasFeatured = await harness.hasFeaturedEvent();
      expect(hasFeatured).toBe(true);
    });

    it('should display the event title in the featured section', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        eventAvailability: purchaseAccessFor([mockEvent]),
      });
      await createComponent();

      const text = await harness.getFeaturedEventText();
      expect(text).toContain('Test Event');
    });

    it('should select the earliest accessible event as featured', async () => {
      const laterEvent: UpcomingEvent = {
        ...mockEvent,
        _id: '10' as Id<'events'>,
        title: 'Later Event',
        date: '2025-06-01',
      } as never;
      const earlierEvent: UpcomingEvent = {
        ...mockEvent,
        _id: '11' as Id<'events'>,
        title: 'Earlier Event',
        date: '2024-01-01',
      } as never;
      setup({
        approvals: mockApprovals,
        events: [laterEvent, earlierEvent],
        eventAvailability: purchaseAccessFor([laterEvent, earlierEvent]),
      });
      await createComponent();

      expect(fixture.componentInstance.featuredEvent()?.title).toBe(
        'Earlier Event',
      );
    });

    it('should show no featured event when backend returns no viewable events', async () => {
      setup({approvals: mockApprovals, events: []});
      await createComponent();

      const hasFeatured = await harness.hasFeaturedEvent();
      expect(hasFeatured).toBe(false);
    });

    it('should show "Get Tickets" CTA when user can purchase featured event', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        applicationStatus: 'approved',
        eventAvailability: {
          '1': {
            isSoldOut: false,
            userTicketCount: 0,
            ticketSalesStatus: 'active',
            purchaseAccess: {allowed: true, source: 'direct'},
          },
        },
      });
      await createComponent();

      const hasCta = await harness.hasGetTicketsCta();
      expect(hasCta).toBe(true);
    });

    it('should not show "Get Tickets" CTA when user cannot purchase', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        applicationStatus: null,
      });
      await createComponent();

      const hasCta = await harness.hasGetTicketsCta();
      expect(hasCta).toBe(false);
    });

    it('should link featured event card to details without buy param', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        applicationStatus: 'approved',
        eventAvailability: {
          '1': {
            isSoldOut: false,
            userTicketCount: 0,
            ticketSalesStatus: 'active',
            purchaseAccess: {allowed: true, source: 'direct'},
          },
        },
      });
      await createComponent();

      const href = await harness.getFeaturedEventHref();
      expect(href).toBe('/events/1');
    });

    it('should link Get Tickets CTA with buy=true when user can purchase', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        applicationStatus: 'approved',
        eventAvailability: {
          '1': {
            isSoldOut: false,
            userTicketCount: 0,
            ticketSalesStatus: 'active',
            purchaseAccess: {allowed: true, source: 'direct'},
          },
        },
      });
      await createComponent();

      const href = await harness.getGetTicketsHref();
      expect(href).toBe('/events/1?buy=true');
    });

    it('should not render Get Tickets CTA when event is sold out', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        eventAvailability: {
          '1': {
            isSoldOut: true,
            userTicketCount: 0,
            ticketSalesStatus: 'active',
            purchaseAccess: {allowed: true, source: 'direct'},
          },
        },
      });
      await createComponent();

      expect(await harness.hasGetTicketsCta()).toBe(false);
      expect(await harness.getGetTicketsHref()).toBeNull();
    });

    it('should hide events when availability is unavailable', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        eventAvailability: {},
      });
      await createComponent();

      expect(fixture.componentInstance.accessibleEvents()).toEqual([]);
      expect(fixture.componentInstance.featuredCanPurchase()).toBe(false);
      expect(await harness.hasFeaturedEvent()).toBe(false);
      expect(await harness.hasGetTicketsCta()).toBe(false);
    });

    it('should keep public events from rejected organizers because backend access allows open access', async () => {
      setup({
        approvals: [],
        myApplications: [
          {
            _id: 'app-rejected',
            _creationTime: 1,
            organizerId: ORG_ID_B,
            organizerName: 'Open Events',
            status: 'rejected',
            reason: 'Incomplete answers',
          },
        ],
        events: [mockPublicEvent],
        eventAvailability: {
          [mockPublicEvent._id]: {
            isSoldOut: false,
            userTicketCount: 0,
            ticketSalesStatus: 'active',
            purchaseAccess: {allowed: true, source: 'open_access'},
          },
        },
      });
      await createComponent();

      expect(fixture.componentInstance.accessibleEvents()).toEqual([
        mockPublicEvent,
      ]);
      expect(fixture.componentInstance.featuredEvent()).toEqual(
        mockPublicEvent,
      );
      expect(await harness.hasFeaturedEvent()).toBe(true);
      expect(await harness.hasGetTicketsCta()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Computed signal values
  // -----------------------------------------------------------------------
  describe('computed signals', () => {
    it('accessibleEvents should include events from approved orgs', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        eventAvailability: purchaseAccessFor([mockEvent]),
      });
      await createComponent();

      const accessible = fixture.componentInstance.accessibleEvents();
      expect(accessible.length).toBe(1);
      expect(accessible[0].title).toBe('Test Event');
    });

    it('accessibleEvents should include public events regardless of approval', async () => {
      setup({
        approvals: [],
        events: [mockPublicEvent],
        applicationStatus: 'pending',
        eventAvailability: purchaseAccessFor([mockPublicEvent]),
      });
      await createComponent();

      const accessible = fixture.componentInstance.accessibleEvents();
      expect(accessible.length).toBe(1);
      expect(accessible[0].title).toBe('Public Party');
    });

    it('accessibleEvents should keep private events returned by the backend access filter', async () => {
      const foreignPrivateEvent: UpcomingEvent = {
        ...mockEvent,
        _id: '30' as Id<'events'>,
        organizerId: ORG_ID_B,
        visibility: 'private',
      } as never;
      setup({
        approvals: mockApprovals,
        events: [foreignPrivateEvent],
        eventAvailability: purchaseAccessFor([foreignPrivateEvent]),
      });
      await createComponent();

      expect(fixture.componentInstance.accessibleEvents()).toEqual([
        foreignPrivateEvent,
      ]);
    });

    it('overflowEvents should be events after the first accessible event', async () => {
      const events: UpcomingEvent[] = [
        {
          ...mockEvent,
          _id: 'e1' as Id<'events'>,
          title: 'First',
          date: '2024-01-01',
        } as never,
        {
          ...mockEvent,
          _id: 'e2' as Id<'events'>,
          title: 'Second',
          date: '2024-02-01',
        } as never,
        {
          ...mockEvent,
          _id: 'e3' as Id<'events'>,
          title: 'Third',
          date: '2024-03-01',
        } as never,
      ];
      setup({
        approvals: mockApprovals,
        events,
        eventAvailability: purchaseAccessFor(events),
      });
      await createComponent();

      const overflow = fixture.componentInstance.overflowEvents();
      expect(overflow.length).toBe(2);
      expect(overflow[0].title).toBe('Second');
      expect(overflow[1].title).toBe('Third');
    });

    it('overflowEvents should cap at 3 items (indices 1-3)', async () => {
      const events: UpcomingEvent[] = Array.from(
        {length: 6},
        (_, i) =>
          ({
            ...mockEvent,
            _id: `e${i}` as Id<'events'>,
            title: `Event ${i}`,
            date: `2024-0${i + 1}-01`,
          }) as never,
      );
      setup({
        approvals: mockApprovals,
        events,
        eventAvailability: purchaseAccessFor(events),
      });
      await createComponent();

      expect(fixture.componentInstance.overflowEvents().length).toBe(3);
    });

    it('publicEvents should include only public-visibility events', async () => {
      setup({
        approvals: [],
        events: [mockEvent, mockPublicEvent],
        applicationStatus: 'pending',
      });
      await createComponent();

      const pub = fixture.componentInstance.publicEvents();
      expect(pub.length).toBe(1);
      expect(pub[0].title).toBe('Public Party');
    });

    it('viewableEvents should include public_viewable events not from approved orgs', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockViewableEvent],
        applicationStatus: 'pending',
        eventAvailability: {
          [mockViewableEvent._id]: {
            isSoldOut: false,
            userTicketCount: 0,
            ticketSalesStatus: 'active',
            purchaseAccess: {allowed: false},
          },
        },
      });
      await createComponent();

      const viewable = fixture.componentInstance.viewableEvents();
      expect(viewable.length).toBe(1);
      expect(viewable[0].title).toBe('Viewable Event');
    });

    it('viewableEvents should exclude public_viewable events with backend purchase access', async () => {
      const viewableFromApprovedOrg: UpcomingEvent = {
        ...mockViewableEvent,
        organizerId: ORG_ID_B,
      } as never;
      setup({
        approvals: [],
        events: [viewableFromApprovedOrg],
        eventAvailability: purchaseAccessFor([viewableFromApprovedOrg]),
      });
      await createComponent();

      expect(fixture.componentInstance.viewableEvents().length).toBe(0);
      expect(fixture.componentInstance.accessibleEvents()).toEqual([
        viewableFromApprovedOrg,
      ]);
    });

    it('showBrowseAll should be true when more than 4 accessible events', async () => {
      const events: UpcomingEvent[] = Array.from(
        {length: 5},
        (_, i) =>
          ({
            ...mockEvent,
            _id: `e${i}` as Id<'events'>,
            title: `Event ${i}`,
            date: `2024-0${i + 1}-01`,
          }) as never,
      );
      setup({
        approvals: mockApprovals,
        events,
        eventAvailability: purchaseAccessFor(events),
      });
      await createComponent();

      expect(fixture.componentInstance.showBrowseAll()).toBe(true);
    });

    it('showBrowseAll should be false when 4 or fewer accessible events', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        eventAvailability: purchaseAccessFor([mockEvent]),
      });
      await createComponent();

      expect(fixture.componentInstance.showBrowseAll()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Ticket purchasing
  // -----------------------------------------------------------------------
  describe('ticket purchasing', () => {
    const activeAvailability = {
      [mockEvent._id]: {
        isSoldOut: false,
        userTicketCount: 0,
        ticketSalesStatus: 'active' as const,
        purchaseAccess: {allowed: true, source: 'direct' as const},
      },
    };

    it('should allow ticket purchase when user is approved for the event organizer', async () => {
      setup({approvals: mockApprovals, eventAvailability: activeAvailability});
      await createComponent();

      expect(fixture.componentInstance.dashboardEvents()[0]?.canPurchase).toBe(
        true,
      );
    });

    it('should allow ticket purchase for platform admins without community approval', async () => {
      setup({approvals: [], eventAvailability: activeAvailability});
      userRoleSignal.set('root_admin');
      await createComponent();

      expect(fixture.componentInstance.dashboardEvents()[0]?.canPurchase).toBe(
        true,
      );
    });

    it('should not allow ticket purchase when user lacks community access', async () => {
      setup({
        approvals: [],
        eventAvailability: {
          [mockEvent._id]: {
            isSoldOut: false,
            userTicketCount: 0,
            ticketSalesStatus: 'active',
            purchaseAccess: {allowed: false},
          },
        },
      });
      await createComponent();

      expect(fixture.componentInstance.dashboardEvents()[0]?.canPurchase).toBe(
        false,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------
  describe('loading state', () => {
    it('should show skeleton when approvals are loading', async () => {
      // When approvalsLoading is true, skeleton should render.
      // Since our mock fires onData immediately, approvalsLoading goes false.
      // Test the isLoading path from DashboardDataService instead.
      setup();
      isLoadingSignal.set(true);
      await createComponent();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('z-skeleton')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Error state
  // -----------------------------------------------------------------------
  describe('error state', () => {
    it('should show error state when hasLoadError is true', async () => {
      setup({hasLoadError: true});
      await createComponent();

      const hasError = await harness.hasErrorState();
      expect(hasError).toBe(true);
    });

    it('should display correct error heading', async () => {
      setup({hasLoadError: true});
      await createComponent();

      const heading = await harness.getErrorStateHeading();
      expect(heading).toContain('hit a snag');
    });

    it('should show "Try Again" button in error state', async () => {
      setup({hasLoadError: true});
      await createComponent();

      const hasTryAgain = await harness.hasTryAgainButton();
      expect(hasTryAgain).toBe(true);
    });

    it('should not show error state when loading', async () => {
      setup();
      isLoadingSignal.set(true);
      await createComponent();

      const hasError = await harness.hasErrorState();
      expect(hasError).toBe(false);
    });

    it('should not show error state on successful load', async () => {
      setup({approvals: mockApprovals});
      await createComponent();

      const hasError = await harness.hasErrorState();
      expect(hasError).toBe(false);
    });

    it('should expose hasLoadError signal on the component', async () => {
      setup({hasLoadError: true});
      await createComponent();

      expect(fixture.componentInstance.hasLoadError()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Discover more section
  // -----------------------------------------------------------------------
  describe('discover more section', () => {
    const ORG_ID_C = 'org-c' as Id<'organizers'>;
    const ORG_ID_D = 'org-d' as Id<'organizers'>;
    const ORG_ID_E = 'org-e' as Id<'organizers'>;

    it('should show discover section when there are unapplied published communities', async () => {
      setup({
        approvals: mockApprovals, // approved for ORG_ID_A
        publicCommunities: mockPublicCommunities, // ORG_ID_A + ORG_ID_B both published
      });
      await createComponent();

      const hasSection = await harness.hasDiscoverSection();
      expect(hasSection).toBe(true);
    });

    it('should show up to 3 undiscovered communities', async () => {
      const manyPublicCommunities: PublicCommunity[] = [
        {_id: ORG_ID_A, name: 'Already Approved', status: 'published'},
        {_id: ORG_ID_B, name: 'Community B', status: 'published'},
        {_id: ORG_ID_C, name: 'Community C', status: 'published'},
        {_id: ORG_ID_D, name: 'Community D', status: 'published'},
        {_id: ORG_ID_E, name: 'Community E', status: 'published'},
      ];
      setup({
        approvals: mockApprovals, // approved for ORG_ID_A only
        publicCommunities: manyPublicCommunities,
      });
      await createComponent();

      const count = await harness.getDiscoverCommunityCount();
      expect(count).toBe(3);
    });

    it('should hide discover section when all communities are applied to', async () => {
      const allApprovals = [
        {
          organizerId: ORG_ID_A,
          organizerName: 'Underground Collective',
          source: 'direct' as const,
        },
        {
          organizerId: ORG_ID_B,
          organizerName: 'Open Events',
          source: 'direct' as const,
        },
      ];
      setup({
        approvals: allApprovals,
        publicCommunities: mockPublicCommunities, // both ORG_ID_A and ORG_ID_B
      });
      await createComponent();

      const hasSection = await harness.hasDiscoverSection();
      expect(hasSection).toBe(false);
    });

    it('should not show discover section for new users (isNewUser)', async () => {
      setup({
        approvals: [],
        myApplications: [],
        publicCommunities: mockPublicCommunities,
      });
      await createComponent();

      const hasSection = await harness.hasDiscoverSection();
      expect(hasSection).toBe(false);
    });

    it('should exclude draft communities from discover list', async () => {
      setup({
        approvals: mockApprovals, // approved for ORG_ID_A
        publicCommunities: mockPublicCommunitiesWithDraft, // ORG_ID_A published, ORG_ID_B draft
      });
      await createComponent();

      const hasSection = await harness.hasDiscoverSection();
      expect(hasSection).toBe(false);
    });

    it('should exclude communities with pending applications from discover list', async () => {
      setup({
        approvals: mockApprovals, // approved for ORG_ID_A
        myApplications: [
          {
            _id: 'app-1',
            _creationTime: 100,
            organizerId: ORG_ID_B,
            organizerName: 'Open Events',
            status: 'pending',
          },
        ],
        publicCommunities: mockPublicCommunities, // ORG_ID_A + ORG_ID_B
      });
      await createComponent();

      // Both communities are either approved or pending — nothing left to discover
      const hasSection = await harness.hasDiscoverSection();
      expect(hasSection).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Empty event state (vetted user, no events)
  // -----------------------------------------------------------------------
  describe('empty event state', () => {
    it('should show empty message when vetted user has no accessible events', async () => {
      setup({approvals: mockApprovals, events: []});
      await createComponent();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('nothing on the calendar yet');
    });

    it('should NOT show empty message when vetted user has exactly one accessible event', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        eventAvailability: purchaseAccessFor([mockEvent]),
      });
      await createComponent();

      const el = fixture.nativeElement as HTMLElement;
      expect(await harness.hasFeaturedEvent()).toBe(true);
      expect(el.textContent).not.toContain('nothing on the calendar yet');
    });

    it('should show empty message when events exist but none are accessible', async () => {
      setup({
        approvals: mockApprovals,
        events: [mockEvent],
        eventAvailability: {},
      });
      await createComponent();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('nothing on the calendar yet');
    });
  });
});
