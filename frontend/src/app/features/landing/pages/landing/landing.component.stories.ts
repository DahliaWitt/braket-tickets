import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {
  ActivatedRoute,
  Params,
  provideRouter,
  type Routes,
} from '@angular/router';
import type {Meta, StoryObj} from '@storybook/angular';
import {applicationConfig} from '@storybook/angular';
import {CONVEX} from 'convex-angular';
import type {FunctionReturnType} from 'convex/server';

import {AuthService} from '@/core/services/auth.service';
import {PublicCommunitiesService} from '@/core/services/public-communities.service';
import {type api} from '@convex/_generated/api';
import {createStoryConvexClient} from '../../../../../storybook/mocks/convex';

import {LandingComponent} from './landing.component';

type LandingStoryEvent = FunctionReturnType<
  typeof api.events.public.list
>[number];

interface LandingStoryCommunity {
  _id: string;
  name: string;
  description: string | null;
  website: string | null;
  logoUrl: string | null;
  slug?: string;
}

const landingStoryState = {
  events: [] as LandingStoryEvent[],
  communities: [] as LandingStoryCommunity[],
  routeQueryParams: {} as Params,
};

const STORY_EVENTS: LandingStoryEvent[] = [
  {
    _id: 'evt_void_sessions' as LandingStoryEvent['_id'],
    _creationTime: Date.now(),
    title: 'Void Sessions Vol. 12',
    date: '2026-06-20T22:00:00.000Z',
    price: 3500,
    organizerId: 'org_void' as LandingStoryEvent['organizerId'],
    totalTickets: 160,
    ticketSalesStatus: 'active',
    status: 'published',
    visibility: 'public',
    soldCount: 118,
    posterUrl: '/waterfallTexture.webp',
    location: 'East Warehouse',
    description:
      'A late-night warehouse session with dense low-end, projection work, and a strict no-phone floor policy.',
  },
  {
    _id: 'evt_signal_loss' as LandingStoryEvent['_id'],
    _creationTime: Date.now(),
    title: 'Signal Loss',
    date: '2026-07-05T20:30:00.000Z',
    price: 2200,
    organizerId: 'org_signal' as LandingStoryEvent['organizerId'],
    totalTickets: 110,
    ticketSalesStatus: 'active',
    status: 'published',
    visibility: 'public',
    soldCount: 43,
    posterUrl: null,
    location: 'Lower Level',
  },
  {
    _id: 'evt_body_language' as LandingStoryEvent['_id'],
    _creationTime: Date.now(),
    title: 'Body Language',
    date: '2026-07-18T21:00:00.000Z',
    price: 2800,
    organizerId: 'org_dancefloor' as LandingStoryEvent['organizerId'],
    totalTickets: 120,
    ticketSalesStatus: 'active',
    status: 'published',
    visibility: 'public',
    soldCount: 67,
    posterUrl: '/braket.svg',
    location: 'Studio Room',
  },
  {
    _id: 'evt_subterranean_archive' as LandingStoryEvent['_id'],
    _creationTime: Date.now(),
    title: 'Subterranean Archive',
    date: '2026-08-02T23:00:00.000Z',
    price: 4000,
    organizerId: 'org_void' as LandingStoryEvent['organizerId'],
    totalTickets: 90,
    ticketSalesStatus: 'active',
    status: 'published',
    visibility: 'public',
    soldCount: 72,
    posterUrl: '/waterfallTexture.webp',
    location: 'Archive Hall',
  },
  {
    _id: 'evt_afterhours_assembly' as LandingStoryEvent['_id'],
    _creationTime: Date.now(),
    title: 'Afterhours Assembly',
    date: '2026-08-16T22:30:00.000Z',
    price: 2600,
    organizerId: 'org_signal' as LandingStoryEvent['organizerId'],
    totalTickets: 140,
    ticketSalesStatus: 'active',
    status: 'published',
    visibility: 'public',
    soldCount: 51,
    posterUrl: null,
    location: 'North Gallery',
  },
];

const STORY_COMMUNITIES: LandingStoryCommunity[] = [
  {
    _id: 'org_dancefloor',
    name: 'Dancefloor',
    description: 'A queer dance community built around careful door culture.',
    website: null,
    logoUrl: null,
    slug: 'dancefloor',
  },
  {
    _id: 'org_void',
    name: 'Void Collective',
    description: 'Audio-forward nights and immersive projection work.',
    website: null,
    logoUrl: '/braket.svg',
    slug: 'void-collective',
  },
  {
    _id: 'org_signal',
    name: 'Signal House',
    description: 'Small-room sessions for DJs, artists, and friends.',
    website: null,
    logoUrl: null,
    slug: 'signal-house',
  },
];

@Component({
  selector: 'bt-story-landing-route-stub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class LandingStoryRouteStubComponent {}

const STORY_ROUTES: Routes = [
  {path: '', component: LandingStoryRouteStubComponent},
  {path: 'login', component: LandingStoryRouteStubComponent},
  {path: 'events', component: LandingStoryRouteStubComponent},
  {path: 'events/:id', component: LandingStoryRouteStubComponent},
  {path: 'communities', component: LandingStoryRouteStubComponent},
  {path: 'communities/:slug', component: LandingStoryRouteStubComponent},
  {path: '**', component: LandingStoryRouteStubComponent},
];

class StoryPublicCommunitiesService {
  listDirectory(): Promise<LandingStoryCommunity[]> {
    return Promise.resolve(landingStoryState.communities);
  }

  getBySlug(slug: string): Promise<LandingStoryCommunity | null> {
    return Promise.resolve(
      landingStoryState.communities.find(
        (community) => community.slug === slug,
      ) ?? null,
    );
  }
}

class StoryAuthService {
  readonly isAuthenticated = signal(false);

  handleOAuthCallback(_ott: string): Promise<void> {
    return Promise.resolve();
  }
}

const storyConvexClient = createStoryConvexClient({
  onUpdate: () => landingStoryState.events,
});

function createActivatedRoute(): Pick<ActivatedRoute, 'snapshot'> {
  return {
    snapshot: {
      queryParamMap: {
        get: (key: string) => {
          const value = landingStoryState.routeQueryParams[key];
          return typeof value === 'string' ? value : null;
        },
      },
    },
  } as Pick<ActivatedRoute, 'snapshot'>;
}

function setLandingStoryData({
  events,
  communities,
  routeQueryParams = {},
}: {
  events: LandingStoryEvent[];
  communities: LandingStoryCommunity[];
  routeQueryParams?: Params;
}): void {
  landingStoryState.events = events;
  landingStoryState.communities = communities;
  landingStoryState.routeQueryParams = routeQueryParams;
}

const meta: Meta<LandingComponent> = {
  title: 'Braket/Archetypes/Landing',
  component: LandingComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [
        provideRouter(STORY_ROUTES),
        {provide: CONVEX, useValue: storyConvexClient},
        {provide: AuthService, useClass: StoryAuthService},
        {
          provide: PublicCommunitiesService,
          useClass: StoryPublicCommunitiesService,
        },
        {provide: ActivatedRoute, useFactory: createActivatedRoute},
      ],
    }),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Real landing page imported into Storybook. Stories vary the public events and community directory data while preserving the actual app composition.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<LandingComponent>;

export const Default: Story = {
  render: () => {
    setLandingStoryData({
      events: STORY_EVENTS,
      communities: STORY_COMMUNITIES,
    });

    return {
      template: `<app-landing />`,
      moduleMetadata: {
        imports: [LandingComponent],
      },
    };
  },
};

export const LeanCatalog: Story = {
  render: () => {
    setLandingStoryData({
      events: STORY_EVENTS.slice(0, 1),
      communities: STORY_COMMUNITIES.slice(0, 2),
    });

    return {
      template: `<app-landing />`,
      moduleMetadata: {
        imports: [LandingComponent],
      },
    };
  },
};

export const HeroOnly: Story = {
  render: () => {
    setLandingStoryData({
      events: [],
      communities: [],
    });

    return {
      template: `<app-landing />`,
      moduleMetadata: {
        imports: [LandingComponent],
      },
    };
  },
};
