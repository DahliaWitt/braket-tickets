import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ActivatedRoute, Params, provideRouter, type Routes } from '@angular/router';
import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { CONVEX } from 'convex-angular';

import { AuthService } from '@/core/services/auth.service';
import { PublicCommunitiesService } from '@/core/services/public-communities.service';

import { LandingComponent } from './landing.component';

interface LandingStoryEvent {
  _id: string;
  title: string;
  date: string;
  price: number;
  totalTickets: number;
  soldCount: number;
  posterUrl: string | null;
  location?: string;
  description?: string;
}

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
    _id: 'evt_void_sessions',
    title: 'Void Sessions Vol. 12',
    date: '2026-06-20T22:00:00.000Z',
    price: 3500,
    totalTickets: 160,
    soldCount: 118,
    posterUrl: '/waterfallTexture.webp',
    location: 'East Warehouse',
    description:
      'A late-night warehouse session with dense low-end, projection work, and a strict no-phone floor policy.',
  },
  {
    _id: 'evt_signal_loss',
    title: 'Signal Loss',
    date: '2026-07-05T20:30:00.000Z',
    price: 2200,
    totalTickets: 110,
    soldCount: 43,
    posterUrl: null,
    location: 'Lower Level',
  },
  {
    _id: 'evt_body_language',
    title: 'Body Language',
    date: '2026-07-18T21:00:00.000Z',
    price: 2800,
    totalTickets: 120,
    soldCount: 67,
    posterUrl: '/braket.svg',
    location: 'Studio Room',
  },
  {
    _id: 'evt_subterranean_archive',
    title: 'Subterranean Archive',
    date: '2026-08-02T23:00:00.000Z',
    price: 4000,
    totalTickets: 90,
    soldCount: 72,
    posterUrl: '/waterfallTexture.webp',
    location: 'Archive Hall',
  },
  {
    _id: 'evt_afterhours_assembly',
    title: 'Afterhours Assembly',
    date: '2026-08-16T22:30:00.000Z',
    price: 2600,
    totalTickets: 140,
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
  { path: '', component: LandingStoryRouteStubComponent },
  { path: 'login', component: LandingStoryRouteStubComponent },
  { path: 'events', component: LandingStoryRouteStubComponent },
  { path: 'events/:id', component: LandingStoryRouteStubComponent },
  { path: 'communities', component: LandingStoryRouteStubComponent },
  { path: 'communities/:slug', component: LandingStoryRouteStubComponent },
  { path: '**', component: LandingStoryRouteStubComponent },
];

class StoryPublicCommunitiesService {
  listDirectory(): Promise<LandingStoryCommunity[]> {
    return Promise.resolve(landingStoryState.communities);
  }

  getBySlug(slug: string): Promise<LandingStoryCommunity | null> {
    return Promise.resolve(
      landingStoryState.communities.find((community) => community.slug === slug) ?? null,
    );
  }
}

class StoryAuthService {
  readonly isAuthenticated = signal(false);

  handleOAuthCallback(_ott: string): Promise<void> {
    return Promise.resolve();
  }
}

function createStoryConvexClient() {
  const onUpdate = (
    _query: unknown,
    _args: unknown,
    onData: (data: unknown) => void,
  ): (() => void) => {
    onData(landingStoryState.events);
    return () => undefined;
  };

  const connectionState = () => ({
    hasInflightRequests: false,
    isWebSocketConnected: false,
    timeOfOldestInflightRequest: null,
    hasEverConnected: true,
    connectionCount: 1,
    connectionRetries: 0,
    inflightMutations: 0,
    inflightActions: 0,
  });

  return {
    query: async () => null,
    mutation: async () => null,
    action: async () => null,
    onUpdate,
    onPaginatedUpdate_experimental: () => () => undefined,
    localQueryResult: () => undefined,
    connectionState,
    subscribeToConnectionState: () => () => undefined,
    hasAuth: () => false,
    handleAuthError: () => undefined,
    client: {
      query: async () => null,
      mutation: async () => null,
      action: async () => null,
      onUpdate,
      onPaginatedUpdate_experimental: () => () => undefined,
      localQueryResult: () => undefined,
      connectionState,
      subscribeToConnectionState: () => () => undefined,
      hasAuth: () => false,
    },
  };
}

const storyConvexClient = createStoryConvexClient();

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
        { provide: CONVEX, useValue: storyConvexClient },
        { provide: AuthService, useClass: StoryAuthService },
        { provide: PublicCommunitiesService, useClass: StoryPublicCommunitiesService },
        { provide: ActivatedRoute, useFactory: createActivatedRoute },
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
