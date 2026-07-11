import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {provideRouter} from '@angular/router';
import {BehaviorSubject, of} from 'rxjs';
import {vi, describe, it, expect} from 'vitest';
import {CommunityEventsComponent} from './community-events.component';
import {CommunityEventsComponentHarness} from './community-events.component.harness';
import {CONVEX} from 'convex-angular';
import {AuthService} from '@/core/services/auth.service';
import type {api} from '@convex/_generated/api';
import type {FunctionReturnType} from 'convex/server';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';

// Shape of a public community returned by the public communities HTTP service.
interface MockPublicCommunity {
  _id: string;
  name: string;
  description?: string;
  website?: string;
  logoUrl: string | null;
}

type MockListByOrganizerResult = NonNullable<
  FunctionReturnType<typeof api.events.public.listByOrganizer>
>;
type MockOrganizerEvent = MockListByOrganizerResult['events'][number];

function makeMockEvent(
  overrides: Partial<Omit<MockOrganizerEvent, '_id' | 'organizerId'>> & {
    _id?: string;
    organizerId?: string;
  } = {},
): MockOrganizerEvent {
  const {_id = 'evt1', organizerId = 'org1', ...eventOverrides} = overrides;
  return {
    _id: _id as MockOrganizerEvent['_id'],
    _creationTime: Date.now(),
    title: 'Test Event',
    date: '2026-06-01',
    price: 2000,
    totalTickets: 100,
    organizerId: organizerId as MockOrganizerEvent['organizerId'],
    ticketSalesStatus: 'active',
    posterUrl: null,
    status: 'published',
    visibility: 'public',
    ...eventOverrides,
  };
}

/**
 * Build a Convex client mock that serves both api.events.public.listByOrganizer and
 * api.communities.directory.listEventsDirectory. The two queries are mutually exclusive
 * (one uses skipToken while the other subscribes) so a single callIndex
 * counter dispatches the right payload for whichever subscription fires.
 */
function makeConvexClientMock(options: {
  organizerResult?: MockListByOrganizerResult | null;
  directoryResult?: MockPublicCommunity[];
  hanging?: boolean;
}): MockConvexClient {
  const convexMock = createMockConvexClient();
  const onUpdate = vi.fn(
    (_query: unknown, _args: unknown, onData: (value: unknown) => void) => {
      if (options.hanging) return () => void 0;
      // When organizerResult is provided, we're in "community selected" mode.
      // When directoryResult is provided, we're in "community picker" mode.
      // Since the two queries are mutually exclusive via skipToken, only one
      // subscription is ever active.
      if (
        options.organizerResult !== undefined &&
        options.organizerResult !== null
      ) {
        onData(options.organizerResult);
      } else {
        onData(options.directoryResult ?? []);
      }
      return () => void 0;
    },
  );

  convexMock.onUpdate = onUpdate;
  convexMock.client.onUpdate = onUpdate;
  return convexMock;
}

function makeActivatedRoute(
  queryParams: Record<string, string | null>,
  routeParams: Record<string, string | null> = {},
) {
  const queryParamMap = {
    get: (key: string) => queryParams[key] ?? null,
  };
  const paramMap = {
    get: (key: string) => routeParams[key] ?? null,
  };
  return {
    queryParamMap: of(queryParamMap),
    paramMap: of(paramMap),
    snapshot: {queryParamMap, paramMap},
  };
}

describe('CommunityEventsComponent', () => {
  let fixture: ComponentFixture<CommunityEventsComponent>;
  let harness: CommunityEventsComponentHarness;

  async function createComponent(
    queryParams: Record<string, string | null>,
    convexResult: MockListByOrganizerResult | null,
    directoryResult: MockPublicCommunity[] = [],
    isAuthenticated = false,
  ) {
    const convexClientMock = makeConvexClientMock({
      organizerResult: convexResult,
      directoryResult,
    });
    const authServiceMock = {
      isAuthenticated: signal(isAuthenticated),
    };

    await TestBed.configureTestingModule({
      imports: [CommunityEventsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: CONVEX, useValue: convexClientMock},
        {provide: AuthService, useValue: authServiceMock},
        {provide: ActivatedRoute, useValue: makeActivatedRoute(queryParams)},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommunityEventsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      CommunityEventsComponentHarness,
    );
  }

  it('should create', async () => {
    await createComponent(
      {community: 'org1'},
      {organizerName: 'Test Community', events: []},
    );
    expect(fixture.componentInstance).toBeTruthy();
  });

  describe('loading state', () => {
    it('shows skeleton loading state while query is in flight', async () => {
      const hangingConvexMock = makeConvexClientMock({hanging: true});

      await TestBed.configureTestingModule({
        imports: [CommunityEventsComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([]),
          {provide: CONVEX, useValue: hangingConvexMock},
          {provide: AuthService, useValue: {isAuthenticated: signal(false)}},
          {
            provide: ActivatedRoute,
            useValue: makeActivatedRoute({community: 'org1'}),
          },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(CommunityEventsComponent);
      fixture.detectChanges();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        CommunityEventsComponentHarness,
      );

      expect(await harness.isLoadingStateVisible()).toBe(true);
      expect(await harness.isErrorStateVisible()).toBe(false);
      expect(await harness.isEmptyStateVisible()).toBe(false);
    });
  });

  describe('community picker state (no community param)', () => {
    const mockCommunities: MockPublicCommunity[] = [
      {_id: 'org1', name: 'Community A', description: 'First', logoUrl: null},
      {_id: 'org2', name: 'Community B', logoUrl: null},
    ];

    it('shows community picker when community param is missing', async () => {
      await createComponent({}, null, mockCommunities);

      expect(await harness.isPickerStateVisible()).toBe(true);
      expect(await harness.isErrorStateVisible()).toBe(false);
      expect(await harness.isLoadingStateVisible()).toBe(false);
    });

    it('shows community picker when community param is null', async () => {
      await createComponent({community: null}, null, mockCommunities);

      expect(await harness.isPickerStateVisible()).toBe(true);
    });

    it('renders a card for each public community', async () => {
      await createComponent({}, null, mockCommunities);

      expect(await harness.getPickerCardCount()).toBe(2);
    });

    it('shows empty state when no public communities exist', async () => {
      await createComponent({}, null, []);

      expect(await harness.isPickerStateVisible()).toBe(true);
      // Empty state component renders inside the picker container
      expect(await harness.isEmptyStateVisible()).toBe(false);
      expect(await harness.isPickerEmptyStateVisible()).toBe(true);
      expect(await harness.getPickerEmptyStateTitle()).toBe(
        'no communities listed yet',
      );
      expect(await harness.getPickerEmptyHomeHref()).toBe('/');
    });

    it('does not show the picker empty state when communities exist', async () => {
      await createComponent({}, null, mockCommunities);

      expect(await harness.isPickerEmptyStateVisible()).toBe(false);
    });
  });

  describe('empty state', () => {
    it('shows empty state when organizer exists but has no events', async () => {
      await createComponent(
        {community: 'org1'},
        {organizerName: 'Empty Community', events: []},
      );

      expect(await harness.isEmptyStateVisible()).toBe(true);
      expect(await harness.isErrorStateVisible()).toBe(false);
      expect(await harness.isLoadingStateVisible()).toBe(false);
    });

    it('shows brand-voice copy and a browse CTA in the empty state', async () => {
      await createComponent(
        {community: 'org1'},
        {organizerName: 'Empty Community', events: []},
      );

      expect(await harness.getEmptyStateTitle()).toBe('nothing coming up');
      expect(await harness.getEmptyStateBrowseHref()).toBe('/events');
    });

    it('shows community name in header for empty state', async () => {
      await createComponent(
        {community: 'org1'},
        {organizerName: 'Empty Community', events: []},
      );

      const headerText = await harness.getCommunityNameHeaderText();
      expect(headerText).toContain('Empty Community');
    });

    it('shows description when present in empty state', async () => {
      await createComponent(
        {community: 'org1'},
        {
          organizerName: 'Empty Community',
          organizerDescription: 'A vibrant community',
          events: [],
        },
      );

      const description = await harness.getDescription();
      expect(description).toBe('A vibrant community');
    });

    it('hides description when absent in empty state', async () => {
      await createComponent(
        {community: 'org1'},
        {organizerName: 'Empty Community', events: []},
      );

      const description = await harness.getDescription();
      expect(description).toBeNull();
    });

    it('shows community logo in header when organizerLogoUrl is present', async () => {
      await createComponent(
        {community: 'org1'},
        {
          organizerName: 'Empty Community',
          organizerLogoUrl: 'https://example.com/logo.png',
          events: [],
        },
      );

      const avatar = await harness.getHeaderAvatar();
      expect(avatar).not.toBeNull();
      expect(await avatar!.hasImage()).toBe(true);
      expect(await avatar!.getImageSrc()).toBe('https://example.com/logo.png');
    });

    it('hides community logo in header when organizerLogoUrl is absent', async () => {
      await createComponent(
        {community: 'org1'},
        {organizerName: 'Empty Community', events: []},
      );

      const avatar = await harness.getHeaderAvatar();
      expect(avatar).toBeNull();
    });
  });

  describe('populated state', () => {
    const mockEvents: MockOrganizerEvent[] = [
      makeMockEvent({_id: 'evt1', title: 'Event One', price: 1500}),
      makeMockEvent({_id: 'evt2', title: 'Event Two', price: 2500}),
    ];

    it('renders event cards for each event', async () => {
      await createComponent(
        {community: 'org1'},
        {organizerName: 'Active Community', events: mockEvents},
      );

      expect(await harness.getEventCardCount()).toBe(2);
    });

    it('shows community name in page header', async () => {
      await createComponent(
        {community: 'org1'},
        {organizerName: 'Active Community', events: mockEvents},
      );

      const headerText = await harness.getCommunityNameHeaderText();
      expect(headerText).toContain('Active Community');
    });

    it('does not show error or empty states when events are present', async () => {
      await createComponent(
        {community: 'org1'},
        {organizerName: 'Active Community', events: mockEvents},
      );

      expect(await harness.isErrorStateVisible()).toBe(false);
      expect(await harness.isEmptyStateVisible()).toBe(false);
      expect(await harness.isLoadingStateVisible()).toBe(false);
    });

    it('shows description when present in loaded state', async () => {
      await createComponent(
        {community: 'org1'},
        {
          organizerName: 'Active Community',
          organizerDescription: 'Oakland nightlife',
          events: mockEvents,
        },
      );

      const description = await harness.getDescription();
      expect(description).toBe('Oakland nightlife');
    });

    it('hides description when absent in loaded state', async () => {
      await createComponent(
        {community: 'org1'},
        {organizerName: 'Active Community', events: mockEvents},
      );

      const description = await harness.getDescription();
      expect(description).toBeNull();
    });

    it('shows community logo in header when organizerLogoUrl is present', async () => {
      await createComponent(
        {community: 'org1'},
        {
          organizerName: 'Active Community',
          organizerLogoUrl: 'https://example.com/logo.png',
          events: mockEvents,
        },
      );

      const avatar = await harness.getHeaderAvatar();
      expect(avatar).not.toBeNull();
      expect(await avatar!.hasImage()).toBe(true);
    });

    it('hides public-viewable event prices from unauthenticated buyers', async () => {
      await createComponent(
        {community: 'org1'},
        {
          organizerName: 'Active Community',
          events: [
            makeMockEvent({
              title: 'Public Preview Event',
              price: 1800,
              visibility: 'public_viewable',
            }),
          ],
        },
      );

      const [card] = await harness.getEventCards();
      const buyText = await card.getBuyText();
      expect(buyText.trim()).toBe('Tickets');
      expect(buyText).not.toContain('$18');
    });

    it('shows public-viewable event prices to authenticated buyers', async () => {
      await createComponent(
        {community: 'org1'},
        {
          organizerName: 'Active Community',
          events: [
            makeMockEvent({
              title: 'Public Preview Event',
              price: 1800,
              visibility: 'public_viewable',
            }),
          ],
        },
        [],
        true,
      );

      const [card] = await harness.getEventCards();
      const buyText = await card.getBuyText();
      expect(buyText.trim()).toBe('Tickets');
      expect(buyText).not.toContain('Sign in for pricing');
    });
  });

  describe('BRA-390: null data shows error state, URL unchanged', () => {
    it('shows error state when query returns null for unknown slug', async () => {
      // Build a mock that explicitly delivers null (unknown organizer) for any query
      const nullReturnMock = createMockConvexClient();
      const onUpdateNull = vi.fn(
        (_query: unknown, _args: unknown, onData: (value: unknown) => void) => {
          onData(null);
          return () => void 0;
        },
      );
      nullReturnMock.onUpdate = onUpdateNull;
      nullReturnMock.client.onUpdate = onUpdateNull;

      await TestBed.configureTestingModule({
        imports: [CommunityEventsComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([]),
          {provide: CONVEX, useValue: nullReturnMock},
          {provide: AuthService, useValue: {isAuthenticated: signal(false)}},
          {
            provide: ActivatedRoute,
            useValue: makeActivatedRoute({community: 'nonexistent'}),
          },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(CommunityEventsComponent);
      fixture.detectChanges();
      await fixture.whenStable();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        CommunityEventsComponentHarness,
      );

      expect(await harness.isNotFoundVisible()).toBe(true);
      expect(await harness.isPickerStateVisible()).toBe(false);
      expect(await harness.isEmptyStateVisible()).toBe(false);
    });
  });

  describe('picker to community transition', () => {
    it('switches from picker to loaded state when community param is added', async () => {
      const mockCommunities: MockPublicCommunity[] = [
        {_id: 'org1', name: 'Community A', logoUrl: null},
      ];
      const mockEvents: MockOrganizerEvent[] = [
        makeMockEvent({_id: 'evt1', title: 'Event One'}),
      ];

      // Use BehaviorSubject so we can push a route change mid-test
      const queryParamMap$ = new BehaviorSubject<{
        get: (key: string) => string | null;
      }>({
        get: () => null, // no community param initially
      });

      const convexMock = makeConvexClientMock({
        organizerResult: {organizerName: 'Community A', events: mockEvents},
        directoryResult: mockCommunities,
      });

      await TestBed.configureTestingModule({
        imports: [CommunityEventsComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([]),
          {provide: CONVEX, useValue: convexMock},
          {provide: AuthService, useValue: {isAuthenticated: signal(false)}},
          {
            provide: ActivatedRoute,
            useValue: {
              queryParamMap: queryParamMap$,
              paramMap: of({get: () => null}),
              snapshot: {
                queryParamMap: {get: () => null},
                paramMap: {get: () => null},
              },
            },
          },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(CommunityEventsComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        CommunityEventsComponentHarness,
      );

      // Initially shows picker
      expect(await harness.isPickerStateVisible()).toBe(true);

      // Simulate route change: user selects a community
      queryParamMap$.next({
        get: (key: string) => (key === 'community' ? 'org1' : null),
      });
      fixture.detectChanges();
      await fixture.whenStable();

      // Picker should be gone, events should render
      expect(await harness.isPickerStateVisible()).toBe(false);
      expect(await harness.getEventCardCount()).toBe(1);
    });
  });
});
