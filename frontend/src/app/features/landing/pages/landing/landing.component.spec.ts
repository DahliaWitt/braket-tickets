import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {LandingComponent} from './landing.component';
import {LandingComponentHarness} from './landing.component.harness';
import {AuthService} from '@/core/services/auth.service';
import {PublicCommunitiesService} from '@/core/services/public-communities.service';
import {PublicEventsService} from '@/core/services/public-events.service';
import {CONVEX} from 'convex-angular';
import {Router, provideRouter} from '@angular/router';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {vi, describe, it, expect} from 'vitest';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockEvent {
  _id: string;
  title: string;
  date: string;
  price: number;
  totalTickets: number;
  soldCount: number;
  posterUrl: string | null;
  location?: string;
  description?: string;
  visibility?: 'public' | 'public_viewable' | 'private';
}

interface MockCommunity {
  _id: string;
  name: string;
  description: string | null;
  website: string | null;
  logoUrl: string | null;
  slug?: string;
}

interface ConvexMockData {
  communities?: MockCommunity[];
  events?: MockEvent[];
}

function makeEvent(
  overrides: Partial<MockEvent> & {_id: string; title: string},
): MockEvent {
  return {
    date: new Date(2030, 5, 15).toISOString(),
    price: 2000,
    totalTickets: 100,
    soldCount: 0,
    posterUrl: null,
    ...overrides,
  };
}

function makeConvexMock({
  communities = [],
}: Omit<ConvexMockData, 'events'> = {}): MockConvexClient {
  const convexMock = createMockConvexClient();
  const onUpdate = vi
    .fn()
    .mockImplementation(
      (_query: unknown, _args: unknown, onData: (data: unknown) => void) => {
        void communities;
        onData([]);
        return () => void 0;
      },
    );

  convexMock.onUpdate = onUpdate;
  convexMock.client.onUpdate = onUpdate;
  convexMock.mutation = vi.fn().mockResolvedValue(null);
  return convexMock;
}

async function setup(
  communities: MockCommunity[] = [],
  events: MockEvent[] = [],
) {
  const authServiceSpy = {isAuthenticated: signal(false)};
  const convexMock = makeConvexMock({communities});
  const publicCommunitiesServiceMock = {
    listDirectory: vi.fn().mockResolvedValue(communities),
    getBySlug: vi.fn().mockResolvedValue(null),
  };
  const publicEventsServiceMock = {
    listUpcoming: vi.fn().mockResolvedValue(events),
  };

  await TestBed.configureTestingModule({
    imports: [LandingComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {provide: AuthService, useValue: authServiceSpy},
      {
        provide: PublicCommunitiesService,
        useValue: publicCommunitiesServiceMock,
      },
      {provide: PublicEventsService, useValue: publicEventsServiceMock},
      {provide: CONVEX, useValue: convexMock},
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigate');

  const fixture: ComponentFixture<LandingComponent> =
    TestBed.createComponent(LandingComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  const landingHarness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    LandingComponentHarness,
  );

  return {
    fixture,
    component: fixture.componentInstance,
    authServiceSpy,
    convexMock,
    publicCommunitiesServiceMock,
    router,
    landingHarness,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LandingComponent', () => {
  it('should navigate to login when login is requested', async () => {
    const {component, router} = await setup();
    component.login();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  // -----------------------------------------------------------------------
  // Computed signals
  // -----------------------------------------------------------------------

  describe('computed signals', () => {
    it('featuredEvent() returns the first public event', async () => {
      const events = [
        makeEvent({_id: 'evt-1', title: 'First Event'}),
        makeEvent({_id: 'evt-2', title: 'Second Event'}),
      ];

      const {component} = await setup([], events);
      expect(component.featuredEvent()).toEqual(events[0]);
    });

    it('shows sign-in pricing copy for public-viewable events before auth', async () => {
      const events = [
        makeEvent({
          _id: 'evt-viewable',
          title: 'Viewable Event',
          visibility: 'public_viewable',
        }),
      ];

      const {fixture} = await setup([], events);
      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('Sign in for pricing');
    });

    it('featuredEvent() returns null when no events', async () => {
      const {component} = await setup([], []);
      expect(component.featuredEvent()).toBeNull();
    });

    it('overflowEvents() returns events after the first (up to 3)', async () => {
      const events = [
        makeEvent({_id: 'evt-1', title: 'First'}),
        makeEvent({_id: 'evt-2', title: 'Second'}),
        makeEvent({_id: 'evt-3', title: 'Third'}),
        makeEvent({_id: 'evt-4', title: 'Fourth'}),
        makeEvent({_id: 'evt-5', title: 'Fifth'}),
      ];

      const {component} = await setup([], events);
      const overflow = component.overflowEvents();
      expect(overflow.length).toBe(3);
      expect(overflow[0]).toEqual(events[1]);
      expect(overflow[2]).toEqual(events[3]);
    });

    it('overflowEvents() returns empty array when only one event', async () => {
      const events = [makeEvent({_id: 'evt-1', title: 'Only Event'})];

      const {component} = await setup([], events);
      expect(component.overflowEvents().length).toBe(0);
    });

    it('shouldCenter() returns true when no events', async () => {
      const {component} = await setup([], []);
      expect(component.shouldCenter()).toBe(true);
    });

    it('shouldCenter() returns false when events exist', async () => {
      const events = [makeEvent({_id: 'evt-1', title: 'Event'})];

      const {component} = await setup([], events);
      expect(component.shouldCenter()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Featured event section
  // -----------------------------------------------------------------------

  describe('featured event section', () => {
    it('is NOT visible when no public events', async () => {
      const {landingHarness} = await setup([], []);
      expect(await landingHarness.hasFeaturedEventSection()).toBe(false);
    });

    it('IS visible when public events exist', async () => {
      const events = [
        makeEvent({
          _id: 'evt-1',
          title: 'Queer Rave',
          posterUrl: 'https://example.com/poster.jpg',
        }),
      ];

      const {landingHarness} = await setup([], events);
      expect(await landingHarness.hasFeaturedEventSection()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Overflow events section
  // -----------------------------------------------------------------------

  describe('overflow events section', () => {
    it('is NOT visible when only one event', async () => {
      const events = [makeEvent({_id: 'evt-1', title: 'Solo Event'})];

      const {landingHarness} = await setup([], events);
      expect(await landingHarness.hasOverflowEventsSection()).toBe(false);
    });

    it('IS visible when more than one event', async () => {
      const events = [
        makeEvent({_id: 'evt-1', title: 'Event A'}),
        makeEvent({_id: 'evt-2', title: 'Event B'}),
      ];

      const {landingHarness} = await setup([], events);
      expect(await landingHarness.hasOverflowEventsSection()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Browse all link
  // -----------------------------------------------------------------------

  describe('browse all events link', () => {
    it('is NOT shown when 4 or fewer events', async () => {
      const events = [
        makeEvent({_id: 'evt-1', title: 'A'}),
        makeEvent({_id: 'evt-2', title: 'B'}),
        makeEvent({_id: 'evt-3', title: 'C'}),
        makeEvent({_id: 'evt-4', title: 'D'}),
      ];

      const {landingHarness} = await setup([], events);
      expect(await landingHarness.hasBrowseAllLink()).toBe(false);
    });

    it('IS shown when more than 4 events', async () => {
      const events = [
        makeEvent({_id: 'evt-1', title: 'A'}),
        makeEvent({_id: 'evt-2', title: 'B'}),
        makeEvent({_id: 'evt-3', title: 'C'}),
        makeEvent({_id: 'evt-4', title: 'D'}),
        makeEvent({_id: 'evt-5', title: 'E'}),
      ];

      const {landingHarness} = await setup([], events);
      expect(await landingHarness.hasBrowseAllLink()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Communities section
  // -----------------------------------------------------------------------

  describe('communities section', () => {
    it('is NOT visible when no public communities', async () => {
      const {landingHarness} = await setup([]);
      expect(await landingHarness.hasCommunitiesSection()).toBe(false);
    });

    it('IS visible when public communities exist', async () => {
      const communities: MockCommunity[] = [
        {
          _id: 'org-1',
          name: 'Queer Collective',
          description: 'A space for everyone',
          website: 'https://example.com',
          logoUrl: null,
          slug: 'queer-collective',
        },
      ];

      const {landingHarness} = await setup(communities);
      expect(await landingHarness.hasCommunitiesSection()).toBe(true);
    });
  });
});
