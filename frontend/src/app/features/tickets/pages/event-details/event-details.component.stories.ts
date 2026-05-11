import {computed, signal} from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  type Params,
} from '@angular/router';
import type {Meta, StoryObj} from '@storybook/angular';
import {applicationConfig} from '@storybook/angular';
import {CONVEX} from 'convex-angular';
import type {FunctionReturnType} from 'convex/server';
import {of} from 'rxjs';

import {STRIPE_CONFIG} from '@/app.tokens';
import type {EventDetail} from '@/core/models/event.types';
import {AuthService} from '@/core/services/auth.service';
import {
  CommunitiesService,
  type Community,
} from '@/core/services/communities.service';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {type api} from '@convex/_generated/api';

import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {BraDarkMode, EDarkModes} from '@ui/services/dark-mode';
import {
  createStoryConvexClient,
  skipStoryConvexQueryUpdate,
} from '../../../../../storybook/mocks/convex';
import {PaymentService} from '../../services/payment.service';
import {ResaleService} from '../../services/resale.service';
import {EventDetailsComponent} from './event-details.component';

type TicketAvailability = NonNullable<
  FunctionReturnType<typeof api.events.public.getAvailability>
>;
type StoryUserRole = 'root_admin' | 'community_admin' | 'user';

interface StoryUser {
  _id: string;
  name: string;
}

type StoryTrustResult = FunctionReturnType<
  typeof api.communities.trust_links.checkUserTrust
>;

interface EventDetailsStoryState {
  queryState: 'loading' | 'resolved';
  event: EventDetail;
  availability: TicketAvailability;
  authenticated: boolean;
  user: StoryUser | null;
  userRole: StoryUserRole;
  email: string | null;
  trustResult: StoryTrustResult | null;
  applicationStatus: string | null;
  organizer: Community | null;
  queryParams: Params;
}

function buildEvent(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    _id: 'evt_story_public' as EventDetail['_id'],
    _creationTime: Date.now(),
    title: 'Void Sessions Vol. 12',
    date: '2026-06-20T22:00:00.000Z',
    price: 3500,
    supporterDefaultPrice: 5000,
    slidingScaleEnabled: true,
    slidingScaleMin: 1500,
    slidingScaleMax: 3000,
    maxTicketsPerUser: 4,
    totalTickets: 160,
    ticketSalesStatus: 'active',
    organizerPaymentReady: true,
    isPlatformOrganizer: false,
    visibility: 'public',
    status: 'published',
    organizerId: 'org_void' as EventDetail['organizerId'],
    posterUrl: '/waterfallTexture.webp',
    location: 'East Warehouse',
    description:
      'A late-night warehouse session with dense low-end, projection work, and a strict no-phone floor policy.',
    organizer: {
      _id: 'org_void' as never,
      name: 'Void Collective',
      slug: 'void-collective',
      logoUrl: '/braket.svg',
      email: 'hello@voidcollective.test',
      contactInfo: 'Signal-only contact hours: Tuesdays and Thursdays.',
    },
    guestCount: 0,
    ...overrides,
  } satisfies EventDetail;
}

function buildAvailability(
  overrides: Partial<TicketAvailability> = {},
): TicketAvailability {
  return {
    totalTickets: 160,
    soldCount: 64,
    remainingTickets: 96,
    ticketSalesStatus: 'active',
    isSoldOut: false,
    userTicketCount: 0,
    resaleAvailable: 0,
    resaleEnabled: false,
    isSubscribedToResaleNotifications: false,
    purchaseAccess: {allowed: true, source: 'direct'},
    ...overrides,
  } as TicketAvailability;
}

const PUBLIC_EVENT = buildEvent();
const VETTED_EVENT = buildEvent({
  _id: 'evt_story_vetted' as never,
  title: 'Signal House Assembly',
  visibility: 'private',
  organizerId: 'org_signal' as EventDetail['organizerId'],
  organizer: {
    _id: 'org_signal' as never,
    name: 'Signal House',
    slug: 'signal-house',
    logoUrl: undefined,
    email: undefined,
    contactInfo: 'Apply through the community vetting flow.',
  },
});
const RESALE_EVENT = buildEvent({
  _id: 'evt_story_resale' as never,
  title: 'Subterranean Archive',
  visibility: 'public_viewable',
  organizerId: 'org_archive' as EventDetail['organizerId'],
  organizer: {
    _id: 'org_archive' as never,
    name: 'Archive Hall',
    slug: 'archive-hall',
    logoUrl: undefined,
    email: 'access@archivehall.test',
    contactInfo: undefined,
  },
});

const eventDetailsStoryState: EventDetailsStoryState = {
  queryState: 'resolved',
  event: PUBLIC_EVENT,
  availability: buildAvailability(),
  authenticated: false,
  user: null,
  userRole: 'user',
  email: null,
  trustResult: null,
  applicationStatus: null,
  organizer: PUBLIC_EVENT.organizer as Community,
  queryParams: {},
};

class StoryAuthService {
  readonly user = computed(() => eventDetailsStoryState.user);
  readonly currentUser = computed(() => eventDetailsStoryState.user);
  readonly isAuthenticated = computed(
    () => eventDetailsStoryState.authenticated,
  );
  readonly email = computed(() => eventDetailsStoryState.email);

  userRole(): StoryUserRole {
    return eventDetailsStoryState.userRole;
  }
}

class StoryPaymentService {
  startPrimaryCheckoutSession(): Promise<{
    orderId: string;
    stripeCheckoutSessionId: string;
    clientSecret: string;
    connectedAccountId: null;
  }> {
    return Promise.resolve({
      orderId: 'order_story_primary',
      stripeCheckoutSessionId: 'cs_story_primary',
      clientSecret: 'secret_story_primary',
      connectedAccountId: null,
    });
  }

  startResaleCheckoutSession(): Promise<{
    orderId: string;
    stripeCheckoutSessionId: string;
    clientSecret: string;
    connectedAccountId: null;
  }> {
    return Promise.resolve({
      orderId: 'order_story_resale',
      stripeCheckoutSessionId: 'cs_story_resale',
      clientSecret: 'secret_story_resale',
      connectedAccountId: null,
    });
  }

  syncCheckoutSession(): Promise<{state: 'completed' | 'released' | 'open'}> {
    return Promise.resolve({state: 'completed'});
  }

  getCheckoutStatus(): Promise<{state: 'completed' | 'released' | 'open'}> {
    return Promise.resolve({state: 'completed'});
  }

  initiateGuestSession(): Promise<{sessionToken: string}> {
    return Promise.resolve({sessionToken: 'guest_session_story'});
  }

  triggerRefresh(): void {}

  claimFreeTicket(): Promise<{success: boolean}> {
    return Promise.resolve({success: true});
  }

  claimFreeTicketAsGuest(): Promise<{success: boolean}> {
    return Promise.resolve({success: true});
  }
}

class StoryApplicationsService {
  getMyApplication(): Promise<{status: string} | null> {
    return Promise.resolve(
      eventDetailsStoryState.applicationStatus
        ? {status: eventDetailsStoryState.applicationStatus}
        : null,
    );
  }

  getMyApplicationForOrganizer(): Promise<{status: string} | null> {
    return this.getMyApplication();
  }
}

class StoryCommunitiesService {
  get(): Promise<Community | null> {
    return Promise.resolve(eventDetailsStoryState.organizer);
  }
}

class StoryResaleService {
  subscribeToResaleNotifications(): Promise<string> {
    return Promise.resolve('sub_story');
  }

  unsubscribeFromResaleNotifications(): Promise<void> {
    return Promise.resolve();
  }
}

class StoryDialogService {
  create(): void {}
}

class StoryDarkModeService {
  themeMode(): EDarkModes.LIGHT {
    return EDarkModes.LIGHT;
  }
}

const storyConvexClient = createStoryConvexClient({
  onUpdate: ({args}) => {
    if (eventDetailsStoryState.queryState === 'loading') {
      return skipStoryConvexQueryUpdate();
    }

    const typedArgs = args as Record<string, unknown>;

    if ('id' in typedArgs) {
      return eventDetailsStoryState.event;
    }

    if ('eventId' in typedArgs) {
      return eventDetailsStoryState.availability;
    }

    if ('organizerId' in typedArgs) {
      return eventDetailsStoryState.trustResult;
    }

    return null;
  },
  hasAuth: () => eventDetailsStoryState.authenticated,
});

function createActivatedRoute(): Pick<
  ActivatedRoute,
  'snapshot' | 'queryParamMap' | 'queryParams'
> {
  const queryParamMap = convertToParamMap(eventDetailsStoryState.queryParams);

  return {
    snapshot: {
      queryParamMap,
    },
    queryParamMap: of(queryParamMap),
    queryParams: of(eventDetailsStoryState.queryParams),
  } as Pick<ActivatedRoute, 'snapshot' | 'queryParamMap' | 'queryParams'>;
}

function setEventDetailsStoryState(
  nextState: Partial<EventDetailsStoryState> &
    Pick<EventDetailsStoryState, 'event' | 'availability'>,
): void {
  eventDetailsStoryState.queryState = nextState.queryState ?? 'resolved';
  eventDetailsStoryState.event = nextState.event;
  eventDetailsStoryState.availability = nextState.availability;
  eventDetailsStoryState.authenticated = nextState.authenticated ?? false;
  eventDetailsStoryState.user = nextState.user ?? null;
  eventDetailsStoryState.userRole = nextState.userRole ?? 'user';
  eventDetailsStoryState.email = nextState.email ?? null;
  eventDetailsStoryState.trustResult = nextState.trustResult ?? null;
  eventDetailsStoryState.applicationStatus =
    nextState.applicationStatus ?? null;
  eventDetailsStoryState.organizer =
    nextState.organizer ?? (nextState.event.organizer as Community) ?? null;
  eventDetailsStoryState.queryParams = nextState.queryParams ?? {};
}

const meta: Meta<EventDetailsComponent> = {
  title: 'Braket/Archetypes/EventDetails',
  component: EventDetailsComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        {provide: ActivatedRoute, useFactory: createActivatedRoute},
        {provide: CONVEX, useValue: storyConvexClient},
        {provide: AuthService, useClass: StoryAuthService},
        {provide: BraDarkMode, useClass: StoryDarkModeService},
        {provide: PaymentService, useClass: StoryPaymentService},
        {provide: ApplicationsService, useClass: StoryApplicationsService},
        {provide: CommunitiesService, useClass: StoryCommunitiesService},
        {provide: ResaleService, useClass: StoryResaleService},
        {provide: BraDialogService, useClass: StoryDialogService},
        {
          provide: STRIPE_CONFIG,
          useValue: {publishableKey: 'pk_test_storybook', mockPayments: true},
        },
      ],
    }),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Real event details page imported into Storybook. These stories document stable page states and gating logic around access, resale, and purchase affordances without simulating the full embedded checkout flow.',
      },
    },
  },
  argTypes: {
    id: {
      control: 'text',
      description:
        'Event id passed to the routed page component; stories set this from the mocked event state.',
    },
    buy: {
      control: 'text',
      description:
        'Optional direct-buy mode input used by route-driven purchase flows.',
    },
  },
};

export default meta;
type Story = StoryObj<EventDetailsComponent>;

function renderEventDetailsStory(
  state: Partial<EventDetailsStoryState> &
    Pick<EventDetailsStoryState, 'event' | 'availability'>,
) {
  setEventDetailsStoryState(state);
  return {
    props: {
      id: state.event._id,
    },
  };
}

export const Loading: Story = {
  render: () =>
    renderEventDetailsStory({
      queryState: 'loading',
      event: PUBLIC_EVENT,
      availability: buildAvailability(),
      authenticated: false,
    }),
};

export const PublicOnSale: Story = {
  render: () =>
    renderEventDetailsStory({
      event: PUBLIC_EVENT,
      availability: buildAvailability(),
      authenticated: false,
      trustResult: null,
    }),
};

export const VettingRequired: Story = {
  render: () =>
    renderEventDetailsStory({
      event: VETTED_EVENT,
      availability: buildAvailability(),
      authenticated: true,
      user: {_id: 'user_story_vetted', name: 'Guest List'},
      userRole: 'user',
      email: 'guest@braket.test',
      trustResult: {trusted: false, source: 'direct', via: null},
      applicationStatus: 'pending',
    }),
};

export const SoldOutWithResale: Story = {
  render: () =>
    renderEventDetailsStory({
      event: RESALE_EVENT,
      availability: buildAvailability({
        soldCount: 160,
        remainingTickets: 0,
        isSoldOut: true,
        resaleEnabled: true,
        resaleAvailable: 3,
        isSubscribedToResaleNotifications: true,
      }),
      authenticated: true,
      user: {_id: 'user_story_resale', name: 'Resale Fan'},
      userRole: 'user',
      email: 'resale@braket.test',
      trustResult: {
        trusted: true,
        source: 'shared',
        via: {_id: 'org_archive_hall' as never, name: 'Archive Hall'},
      },
      applicationStatus: 'approved',
    }),
};

export const SoldOutGetNotified: Story = {
  render: () =>
    renderEventDetailsStory({
      event: RESALE_EVENT,
      availability: buildAvailability({
        soldCount: 160,
        remainingTickets: 0,
        isSoldOut: true,
        resaleEnabled: true,
        resaleAvailable: 0,
        isSubscribedToResaleNotifications: false,
      }),
      authenticated: true,
      user: {_id: 'user_story_notify', name: 'Resale Watch'},
      userRole: 'user',
      email: 'notify@braket.test',
      trustResult: {
        trusted: true,
        source: 'direct',
        via: null,
      },
      applicationStatus: 'approved',
    }),
};
