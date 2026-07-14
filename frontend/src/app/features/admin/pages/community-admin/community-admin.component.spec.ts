import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  type ParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {afterEach, describe, it, expect, vi} from 'vitest';
import {BehaviorSubject, of} from 'rxjs';
import {CommunityAdminComponent} from './community-admin.component';
import {CommunityAdminHarness} from './community-admin.harness';
import {AuthService} from '@/core/services/auth.service';
import {CONVEX} from 'convex-angular';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {BraAlertDialogService} from '@ui/components/composites/alert-dialog/alert-dialog.service';
import {CommunityContextService} from '@/features/admin/services/community-context.service';
import {CommunitiesService} from '@/core/services/communities.service';
import type {Id} from '@convex/_generated/dataModel';
import {type FunctionArgs, type FunctionReturnType} from 'convex/server';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {functionReferenceMatches} from '@/testing/convex-reference-matchers';
import {api} from '@convex/_generated/api';
import {toast} from 'ngx-sonner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Emit a Convex subscription result asynchronously (next microtask), mirroring
// the real ConvexReactClient / ConvexTestingClient, which never invoke the
// onUpdate callback synchronously from within onUpdate(). injectQueries()
// registers each key's subscription *after* calling convex.onUpdate(...), and
// its staleness guard drops any emission that arrives before registration
// completes. A synchronous emit would therefore be silently discarded. Every
// initial mock emission below must go through this so injectQueries() observes
// it. `await fixture.whenStable()` flushes the microtask.
function emitAsync(fn: () => void): void {
  queueMicrotask(fn);
}

function makeCommunityContextMock(options: {
  isLoading?: boolean;
  selectedId?: Id<'organizers'> | null;
  selectedName?: string | null;
  hasMultiple?: boolean;
  communities?: Id<'organizers'>[];
  isAdminOverride?: boolean;
}) {
  return {
    isLoading: vi.fn(() => options.isLoading ?? false),
    selectedCommunityId: vi.fn(() => options.selectedId ?? null),
    selectedCommunityName: vi.fn(() => options.selectedName ?? null),
    hasMultipleCommunities: vi.fn(() => options.hasMultiple ?? false),
    communities: vi.fn(() => options.communities ?? []),
    isAdminOverride: vi.fn(() => options.isAdminOverride ?? false),
    selectCommunity: vi.fn(),
    setAdminOverrideCommunity: vi.fn(),
    clearAdminOverride: vi.fn(),
    setResolvedNames: vi.fn(),
    resolvedNameFor: vi.fn((_id: unknown) => null),
  };
}

const FAKE_ORG_ID = 'org-abc' as Id<'organizers'>;
type MagicLinksList = FunctionReturnType<
  typeof api.communities.invite_links.listMyLinks
>;
type MagicLinkListItem = MagicLinksList[number];
type PastMagicLinksList = FunctionReturnType<
  typeof api.communities.invite_links.listPastMyLinks
>;
type CreateMagicLinkArgs = FunctionArgs<
  typeof api.communities.invite_links.create
>;
type UpdateMagicLinkStatusArgs = FunctionArgs<
  typeof api.communities.invite_links.updateStatus
>;

interface MagicLinksQueryController {
  active: MagicLinksList;
  past: PastMagicLinksList;
  activeSubscribers: ((links: MagicLinksList) => void)[];
  pastSubscribers: ((links: PastMagicLinksList) => void)[];
  setActive(links: MagicLinksList): void;
  setPast(links: PastMagicLinksList): void;
}

function createMagicLinksQueryController(
  active: MagicLinksList = [],
  past: PastMagicLinksList = [],
): MagicLinksQueryController {
  return {
    active,
    past,
    activeSubscribers: [],
    pastSubscribers: [],
    setActive(links) {
      this.active = links;
      for (const subscriber of this.activeSubscribers) {
        subscriber(links);
      }
    },
    setPast(links) {
      this.past = links;
      for (const subscriber of this.pastSubscribers) {
        subscriber(links);
      }
    },
  };
}

function makeMagicLink(
  overrides: Partial<MagicLinkListItem> = {},
): MagicLinkListItem {
  const tokenPrefix = overrides.tokenPrefix ?? 'qa-negat';
  return {
    _id: ('link-' + tokenPrefix) as Id<'magic_links'>,
    _creationTime: 1_714_000_000_000,
    tokenPrefix,
    label: 'QA Negative Redemption',
    status: 'active',
    redemptionCount: 0,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function createActivatedRouteMock(
  queryParams: Record<string, string | null>,
  routeParams: Record<string, string | null> = {},
  queryParamMap$?: BehaviorSubject<ParamMap>,
  routeParamMap$?: BehaviorSubject<ParamMap>,
) {
  return {
    queryParamMap: queryParamMap$ ?? of(convertToParamMap(queryParams)),
    paramMap: routeParamMap$ ?? of(convertToParamMap(routeParams)),
    snapshot: {
      queryParamMap: {
        get: (key: string) => queryParams[key] ?? null,
      },
      paramMap: {
        get: (key: string) => routeParams[key] ?? null,
      },
    },
  };
}

async function setup(options: {
  tab?: string;
  isLoading?: boolean;
  selectedId?: Id<'organizers'> | null;
  selectedName?: string | null;
  communitySlug?: string | null;
  communityLogo?: string | null;
  hasMultiple?: boolean;
  communities?: Id<'organizers'>[];
  isAdminOverride?: boolean;
  userRole?: string;
  queryParams?: Record<string, string | null>;
  routeParams?: Record<string, string | null>;
  queryParamMap$?: BehaviorSubject<ParamMap>;
  routeParamMap$?: BehaviorSubject<ParamMap>;
  getBySlugOrId?: ReturnType<typeof vi.fn>;
  communityBySlug?: {
    _id: Id<'organizers'>;
    name: string;
    slug?: string | null;
  } | null;
  magicLinksController?: MagicLinksQueryController;
  failLinks?: boolean;
  failLinksPast?: boolean;
  routerUrl?: string;
  spyOnNavigate?: boolean;
}) {
  const ctxMock = makeCommunityContextMock({
    isLoading: options.isLoading ?? false,
    selectedId:
      options.selectedId !== undefined ? options.selectedId : FAKE_ORG_ID,
    selectedName:
      options.selectedName !== undefined
        ? options.selectedName
        : 'Test Community',
    isAdminOverride: options.isAdminOverride ?? false,
    hasMultiple: options.hasMultiple ?? false,
    communities: options.communities ?? [FAKE_ORG_ID],
  });

  const authMock = {
    userRole: vi.fn(() => options.userRole ?? 'community_admin'),
    logout: vi.fn(),
    currentUser: vi.fn(() => ({_id: 'user-1' as Id<'users'>})),
  };

  // Convex client mock: used by injectConvexQuery inside CommunityAdminComponent
  // (magic-links query) and child components that are not stubbed in these tests.
  const convexMock: MockConvexClient = createMockConvexClient();
  const onUpdate = vi
    .fn()
    .mockImplementation(
      (
        _query: unknown,
        args: unknown,
        onData: (data: unknown) => void,
        onError?: (err: Error) => void,
      ) => {
        if (
          functionReferenceMatches(
            _query,
            api.communities.invite_links.listMyLinks,
          )
        ) {
          if (options.failLinks) {
            emitAsync(() => onError?.(new Error('active links boom')));
            return () => void 0;
          }
          const controller = options.magicLinksController;
          if (controller) {
            const subscriber = onData as (links: MagicLinksList) => void;
            controller.activeSubscribers.push(subscriber);
            emitAsync(() => subscriber(controller.active));
            return () => {
              controller.activeSubscribers =
                controller.activeSubscribers.filter((cb) => cb !== subscriber);
            };
          }
          emitAsync(() => onData([]));
          return () => void 0;
        }

        if (
          functionReferenceMatches(
            _query,
            api.communities.invite_links.listPastMyLinks,
          )
        ) {
          if (options.failLinksPast) {
            emitAsync(() => onError?.(new Error('past links boom')));
            return () => void 0;
          }
          const controller = options.magicLinksController;
          if (controller) {
            const subscriber = onData as (links: PastMagicLinksList) => void;
            controller.pastSubscribers.push(subscriber);
            emitAsync(() => subscriber(controller.past));
            return () => {
              controller.pastSubscribers = controller.pastSubscribers.filter(
                (cb) => cb !== subscriber,
              );
            };
          }
          emitAsync(() => onData([]));
          return () => void 0;
        }

        const looksLikeCommunitiesGetArgs =
          typeof args === 'object' &&
          args !== null &&
          'id' in args &&
          !('organizerId' in args);
        if (looksLikeCommunitiesGetArgs && options.communityLogo) {
          emitAsync(() =>
            onData({
              _id: FAKE_ORG_ID,
              name: options.selectedName ?? 'Test Community',
              logoUrl: options.communityLogo,
              slug: options.communitySlug ?? null,
              status: 'published',
            }),
          );
          return () => void 0;
        }
        if (looksLikeCommunitiesGetArgs) {
          emitAsync(() =>
            onData({
              _id: options.selectedId ?? FAKE_ORG_ID,
              name: options.selectedName ?? 'Test Community',
              logoUrl: null,
              slug: options.communitySlug ?? null,
              status: 'published',
            }),
          );
          return () => void 0;
        }

        const looksLikeMagicLinksArgs =
          typeof args === 'object' &&
          args !== null &&
          Object.keys(args).length === 0;
        if (looksLikeMagicLinksArgs) {
          emitAsync(() => onData([]));
          return () => void 0;
        }

        emitAsync(() => onData(undefined));
        return () => void 0;
      },
    );
  const onPaginatedUpdate = vi
    .fn()
    .mockImplementation(
      (
        _query: unknown,
        _args: unknown,
        _opts: unknown,
        onData: (data: {
          results: unknown[];
          status: string;
          loadMore: () => boolean;
        }) => void,
      ) => {
        onData({results: [], status: 'Exhausted', loadMore: () => false});
        return () => void 0;
      },
    );
  convexMock.client.onUpdate = onUpdate;
  convexMock.onUpdate = onUpdate;
  convexMock.client.onPaginatedUpdate_experimental = onPaginatedUpdate;
  convexMock.onPaginatedUpdate_experimental = onPaginatedUpdate;
  convexMock.mutation = vi.fn().mockResolvedValue({
    url: 'https://example.com/magic/token123',
    token: 'token123',
  });
  convexMock.client.mutation = convexMock.mutation;

  const dialogMock = {
    create: vi.fn(),
  };

  const communitiesServiceMock = {
    get: vi.fn().mockResolvedValue({name: 'Test Community'}),
    getBySlugOrId:
      options.getBySlugOrId ??
      vi.fn().mockResolvedValue(options.communityBySlug ?? null),
  };

  const activatedRouteMock = createActivatedRouteMock(
    options.queryParams ?? {},
    options.routeParams ?? {},
    options.queryParamMap$,
    options.routeParamMap$,
  );

  await TestBed.configureTestingModule({
    imports: [CommunityAdminComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([{path: '**', children: []}]),
      {provide: AuthService, useValue: authMock},
      {provide: CONVEX, useValue: convexMock},
      {provide: BraDialogService, useValue: dialogMock},
      // CommunityContextService is provided at component level — override it here
      {provide: CommunityContextService, useValue: ctxMock},
      {provide: CommunitiesService, useValue: communitiesServiceMock},
      {provide: ActivatedRoute, useValue: activatedRouteMock},
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  const navigateSpy = options.spyOnNavigate
    ? vi.spyOn(router, 'navigate').mockResolvedValue(true)
    : null;

  if (options.routerUrl) {
    await router.navigateByUrl(options.routerUrl);
  }

  const fixture: ComponentFixture<CommunityAdminComponent> =
    TestBed.createComponent(CommunityAdminComponent);

  if (options.tab !== undefined) {
    fixture.componentRef.setInput('tab', options.tab);
  }

  fixture.detectChanges();
  await fixture.whenStable();

  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    CommunityAdminHarness,
  );

  return {
    fixture,
    harness,
    ctxMock,
    authMock,
    convexMock,
    communitiesServiceMock,
    activatedRouteMock,
    navigateSpy,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommunityAdminComponent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create', async () => {
    const {fixture} = await setup({});
    expect(fixture.componentInstance).toBeTruthy();
  }, 15000);

  // -------------------------------------------------------------------------
  // Tab definitions
  // -------------------------------------------------------------------------

  describe('tabs', () => {
    it('renders all six tabs in the shell', async () => {
      const {harness} = await setup({tab: 'pending'});
      const labels = await harness.getTabLabels();

      expect(labels).toContain('Pending Apps');
      expect(labels).toContain('App History');
      expect(labels).toContain('Members');
      expect(labels).toContain('Events');
      expect(labels).toContain('Magic Links');
      expect(labels).toContain('Settings');
    });

    it('should render audit log tab in the tab list', async () => {
      const {harness} = await setup({tab: 'pending'});
      const labels = await harness.getTabLabels();
      expect(labels).toContain('Audit Log');
    });

    it('defaults to pending tab when no tab input is provided', async () => {
      const {fixture} = await setup({});
      expect(fixture.componentInstance.activeTab()).toBe('pending');
    });

    it('falls back to pending tab when an invalid tab value is provided', async () => {
      const {fixture} = await setup({tab: 'nonexistent'});

      expect(fixture.componentInstance.activeTab()).toBe('pending');
    });

    it('sets activeTab to "history" when tab input is "history"', async () => {
      const {fixture} = await setup({tab: 'history'});
      expect(fixture.componentInstance.activeTab()).toBe('history');
    });

    it('uses the live route tab param when component input binding is stale', async () => {
      const {fixture} = await setup({
        tab: 'pending',
        routeParams: {tab: 'history'},
      });

      expect(fixture.componentInstance.activeTab()).toBe('history');
    });

    it('keeps the mobile section selector aligned with live route params', async () => {
      const routeParamMap$ = new BehaviorSubject(
        convertToParamMap({tab: 'events'}),
      );
      const {fixture, harness} = await setup({
        tab: 'pending',
        routeParamMap$,
      });

      expect(await harness.getSelectedMobileSectionValue()).toBe('events');

      routeParamMap$.next(convertToParamMap({tab: 'settings'}));
      await fixture.whenStable();

      expect(await harness.getSelectedMobileSectionValue()).toBe('settings');
    });

    it('sets activeTab to "members" when tab input is "members"', async () => {
      const {fixture} = await setup({tab: 'members'});
      expect(fixture.componentInstance.activeTab()).toBe('members');
    });

    it('sets activeTab to "events" when tab input is "events"', async () => {
      const {fixture} = await setup({tab: 'events'});
      expect(fixture.componentInstance.activeTab()).toBe('events');
    });

    it('sets activeTab to "magic-links" when tab input is "magic-links"', async () => {
      const {fixture} = await setup({tab: 'magic-links'});
      expect(fixture.componentInstance.activeTab()).toBe('magic-links');
    });

    it('sets activeTab to "settings" when tab input is "settings"', async () => {
      const {fixture} = await setup({tab: 'settings'});
      expect(fixture.componentInstance.activeTab()).toBe('settings');
    });
  });

  // -------------------------------------------------------------------------
  // Community selector
  // -------------------------------------------------------------------------

  describe('community selector', () => {
    it('renders the community selector component when the user has multiple communities', async () => {
      const {harness} = await setup({tab: 'pending', hasMultiple: true});
      expect(await harness.hasCommunitySelector()).toBe(true);
    });
  });

  describe('community query param', () => {
    it('loads the community matching the community slug query param', async () => {
      const selectedCommunity = {
        _id: 'org-selected' as Id<'organizers'>,
        name: 'Lot 45',
        slug: 'lot-45',
      };
      const {communitiesServiceMock, ctxMock} = await setup({
        queryParams: {community: 'lot-45'},
        communityBySlug: selectedCommunity,
      });

      expect(communitiesServiceMock.getBySlugOrId).toHaveBeenCalledWith(
        'lot-45',
      );
      expect(ctxMock.selectCommunity).toHaveBeenCalledWith(
        selectedCommunity._id,
      );
    });

    it('ignores stale community query results after the URL changes', async () => {
      const queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
      const staleLookup = createDeferred<{
        _id: Id<'organizers'>;
        name: string;
        slug: string;
      } | null>();
      const currentLookup = createDeferred<{
        _id: Id<'organizers'>;
        name: string;
        slug: string;
      } | null>();
      const getBySlugOrId = vi.fn((slugOrId: string) => {
        if (slugOrId === 'lot-45') return staleLookup.promise;
        if (slugOrId === 'second-room') return currentLookup.promise;
        return Promise.resolve(null);
      });

      const {ctxMock, fixture} = await setup({
        queryParamMap$,
        getBySlugOrId,
      });

      queryParamMap$.next(convertToParamMap({community: 'lot-45'}));
      fixture.detectChanges();
      await fixture.whenStable();

      queryParamMap$.next(convertToParamMap({community: 'second-room'}));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(getBySlugOrId).toHaveBeenCalledWith('lot-45');
      expect(getBySlugOrId).toHaveBeenCalledWith('second-room');

      staleLookup.resolve({
        _id: 'org-stale' as Id<'organizers'>,
        name: 'Lot 45',
        slug: 'lot-45',
      });
      await fixture.whenStable();

      expect(ctxMock.selectCommunity).not.toHaveBeenCalledWith('org-stale');

      currentLookup.resolve({
        _id: 'org-current' as Id<'organizers'>,
        name: 'Second Room',
        slug: 'second-room',
      });
      await fixture.whenStable();

      expect(ctxMock.selectCommunity).toHaveBeenCalledWith('org-current');
    });

    it('ignores stale community query results after the URL query is cleared', async () => {
      const queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
      const staleLookup = createDeferred<{
        _id: Id<'organizers'>;
        name: string;
        slug: string;
      } | null>();
      const getBySlugOrId = vi.fn((slugOrId: string) => {
        if (slugOrId === 'lot-45') return staleLookup.promise;
        return Promise.resolve(null);
      });

      const {ctxMock, fixture} = await setup({
        queryParamMap$,
        getBySlugOrId,
      });

      queryParamMap$.next(convertToParamMap({community: 'lot-45'}));
      fixture.detectChanges();
      await fixture.whenStable();

      queryParamMap$.next(convertToParamMap({}));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(getBySlugOrId).toHaveBeenCalledWith('lot-45');
      expect(fixture.componentInstance.unresolvedCommunitySlug()).toBeNull();

      staleLookup.resolve({
        _id: 'org-stale' as Id<'organizers'>,
        name: 'Lot 45',
        slug: 'lot-45',
      });
      await fixture.whenStable();

      expect(ctxMock.selectCommunity).not.toHaveBeenCalledWith('org-stale');
    });

    it('keeps community query params on shell tab links', async () => {
      const {fixture} = await setup({
        queryParams: {community: 'lot-45'},
        communitySlug: 'lot-45',
        communityBySlug: {
          _id: 'org-selected' as Id<'organizers'>,
          name: 'Lot 45',
          slug: 'lot-45',
        },
        tab: 'settings',
        routerUrl: '/community-admin/settings?community=lot-45',
      });

      // With the beforeTabChange guard active, routerLink is null so hrefs
      // are not rendered on tab links. Verify the tabQueryParams computed
      // produces the correct value — the shell passes it to router.navigate().
      expect(fixture.componentInstance.tabQueryParams()).toEqual({
        community: 'lot-45',
      });
    });

    it('tabQueryParams includes community param even when selected community is not in user communities (override mode)', async () => {
      const {fixture} = await setup({
        communitySlug: 'lot-45',
        selectedId: FAKE_ORG_ID,
        isAdminOverride: true,
      });
      expect(fixture.componentInstance.tabQueryParams()).toEqual({
        community: 'lot-45',
      });
    });

    it('tabQueryParams falls back to selectedCommunityId when communityDoc has no slug', async () => {
      const {fixture} = await setup({
        communitySlug: null,
        selectedId: FAKE_ORG_ID,
      });
      expect(fixture.componentInstance.tabQueryParams()).toEqual({
        community: FAKE_ORG_ID,
      });
    });

    it('tabQueryParams is null when selectedCommunityId is null', async () => {
      const {fixture} = await setup({selectedId: null});
      expect(fixture.componentInstance.tabQueryParams()).toBeNull();
    });

    it('shows unresolved-community error card and preserves URL when slug does not resolve', async () => {
      // BRA-406: invalid slug now shows an error card instead of silently clearing the URL
      const {harness, navigateSpy} = await setup({
        queryParams: {community: 'missing-community'},
        communityBySlug: null,
        selectedId: null,
        spyOnNavigate: true,
      });

      const errorText = await harness.getUnresolvedCommunityError();
      expect(errorText).not.toBeNull();
      expect(errorText).toContain('missing-community');
      const headerText = await harness.getCustomHeaderText();
      expect(headerText).toContain('Community not found');
      expect(headerText).not.toContain('Test Community');
      // URL must NOT be cleared until the user explicitly picks a community
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });

  describe('community identity header', () => {
    it('renders the community logo as a native lazy-loaded image so user-uploaded logos with arbitrary aspect ratios do not trigger NG02952 warnings', async () => {
      const {harness} = await setup({
        selectedName: 'Lot 45',
        communityLogo: 'https://example.com/lot45-logo.png',
      });

      expect(await harness.hasCommunityLogo()).toBe(true);
      expect(await harness.communityLogoLazyLoads()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  describe('loading state', () => {
    it('shows loading skeletons while community context is resolving', async () => {
      const {harness} = await setup({isLoading: true, selectedId: null});
      expect(await harness.hasSkeletons()).toBe(true);
    });

    it('does not show the empty-state message while loading', async () => {
      const {harness} = await setup({isLoading: true, selectedId: null});
      expect(await harness.hasEmptyState()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Empty / no community state
  // -------------------------------------------------------------------------

  describe('no community assigned', () => {
    it('shows empty state when selectedCommunityId is null and not loading', async () => {
      const {harness} = await setup({isLoading: false, selectedId: null});
      expect(await harness.getEmptyStateText()).toBe('NO COMMUNITY ASSIGNED');
    });

    it('does not render tab content when no community is assigned', async () => {
      const {harness} = await setup({
        isLoading: false,
        selectedId: null,
        tab: 'pending',
      });
      expect(await harness.hasApplicationsTable()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Pending tab
  // -------------------------------------------------------------------------

  describe('pending tab', () => {
    it('renders the applications table with tableType="pending"', async () => {
      const {harness} = await setup({tab: 'pending'});
      expect(await harness.hasApplicationsTable()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // History tab
  // -------------------------------------------------------------------------

  describe('history tab', () => {
    it('renders the applications table with tableType="history"', async () => {
      const {harness} = await setup({tab: 'history'});
      expect(await harness.hasApplicationsTable()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Members tab
  // -------------------------------------------------------------------------

  describe('members tab', () => {
    it('renders the members table', async () => {
      const {harness} = await setup({tab: 'members'});
      expect(await harness.hasMembersTable()).toBe(true);
    });

    it('passes the selectedCommunityId as organizerId to the members table', async () => {
      const {harness} = await setup({tab: 'members', selectedId: FAKE_ORG_ID});
      expect(await harness.hasMembersTable()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Events tab
  // -------------------------------------------------------------------------

  describe('events tab', () => {
    it('renders the events table', async () => {
      const {harness} = await setup({tab: 'events'});
      expect(await harness.hasEventsTable()).toBe(true);
    });

    it('passes the selected community id to the events table query', async () => {
      const selectedId = 'org-selected' as Id<'organizers'>;
      const {convexMock} = await setup({tab: 'events', selectedId});

      expect(
        convexMock.client.onUpdate.mock.calls.some(
          ([queryRef, args]) =>
            functionReferenceMatches(
              queryRef,
              api.events.management.adminList,
            ) &&
            JSON.stringify(args) === JSON.stringify({organizerId: selectedId}),
        ),
      ).toBe(true);
    });

    it('does not render the events table on non-events tabs', async () => {
      const {harness} = await setup({tab: 'pending'});
      expect(await harness.hasEventsTable()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Magic-links tab
  // -------------------------------------------------------------------------

  describe('magic-links tab', () => {
    it('renders magic-links content (no other tables)', async () => {
      const {harness} = await setup({tab: 'magic-links'});
      // Sub-component tables should NOT appear on this tab
      expect(await harness.hasApplicationsTable()).toBe(false);
      expect(await harness.hasMembersTable()).toBe(false);
      expect(await harness.hasEventsTable()).toBe(false);
    });

    it('shows the magic links info card', async () => {
      const {harness} = await setup({tab: 'magic-links'});
      expect(await harness.hasMagicLinksInfo()).toBe(true);
      const text = await harness.getMagicLinksInfoText();
      expect(text).toContain('A shortcut past the application process');
    });

    it('uses level-two headings for mobile magic-link cards', async () => {
      const link = makeMagicLink({
        _id: 'link-heading' as Id<'magic_links'>,
        label: 'Heading Check',
      });
      const controller = createMagicLinksQueryController([link]);
      const {harness} = await setup({
        tab: 'magic-links',
        magicLinksController: controller,
      });

      expect(await harness.getMagicLinkMobileHeadingTags()).toEqual(['H2']);
    });

    it('scopes magic link queries to the selected community', async () => {
      const selectedId = 'org-selected' as Id<'organizers'>;
      const {convexMock} = await setup({
        tab: 'magic-links',
        selectedId,
      });

      expect(
        convexMock.client.onUpdate.mock.calls.some(
          ([queryRef, args]) =>
            functionReferenceMatches(
              queryRef,
              api.communities.invite_links.listMyLinks,
            ) &&
            JSON.stringify(args) === JSON.stringify({organizerId: selectedId}),
        ),
      ).toBe(true);
      expect(
        convexMock.client.onUpdate.mock.calls.some(
          ([queryRef, args]) =>
            functionReferenceMatches(
              queryRef,
              api.communities.invite_links.listPastMyLinks,
            ) &&
            JSON.stringify(args) === JSON.stringify({organizerId: selectedId}),
        ),
      ).toBe(true);
    });

    it('shows the CREATE LINK button when there are magic links', async () => {
      const {convexMock} = await setup({tab: 'magic-links'});

      // Override the mock to return a link
      convexMock.client.onUpdate.mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          onData: (data: unknown[]) => void,
        ) => {
          emitAsync(() =>
            onData([
              {
                _id: 'link-1',
                _creationTime: Date.now(),
                tokenPrefix: 'abc123de',
                status: 'active',
                redemptionCount: 0,
                label: 'Test Link',
              },
            ]),
          );
          return () => void 0;
        },
      );

      const newFixture = TestBed.createComponent(CommunityAdminComponent);
      newFixture.componentRef.setInput('tab', 'magic-links');
      newFixture.detectChanges();
      await newFixture.whenStable();

      const newHarness = await TestbedHarnessEnvironment.harnessForFixture(
        newFixture,
        CommunityAdminHarness,
      );
      expect(await newHarness.hasCreateLinkButton()).toBe(true);
    });

    it('shows the CREATE LINK button when only past magic links exist', async () => {
      const pastLink = {
        ...makeMagicLink({
          _id: 'link-past-only' as Id<'magic_links'>,
          tokenPrefix: 'pastonly',
          label: 'Past Only',
        }),
        deletedAt: Date.now(),
      } satisfies PastMagicLinksList[number];
      const controller = createMagicLinksQueryController([], [pastLink]);
      const {fixture, harness} = await setup({
        tab: 'magic-links',
        magicLinksController: controller,
      });

      expect(await harness.hasCreateLinkButton()).toBe(true);

      await harness.clickCreateLinkButton();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.hasCreateDialog()).toBe(true);
    });

    it('keeps the CREATE LINK button visible on the past magic-links filter', async () => {
      const activeLink = makeMagicLink({
        _id: 'link-active-with-past' as Id<'magic_links'>,
        tokenPrefix: 'active01',
        label: 'Active Link',
      });
      const pastLink = {
        ...makeMagicLink({
          _id: 'link-past-filter' as Id<'magic_links'>,
          tokenPrefix: 'pastflt',
          label: 'Past Filter',
        }),
        deletedAt: Date.now(),
      } satisfies PastMagicLinksList[number];
      const controller = createMagicLinksQueryController(
        [activeLink],
        [pastLink],
      );
      const {fixture, harness} = await setup({
        tab: 'magic-links',
        magicLinksController: controller,
      });

      await harness.setMagicLinksFilter('past');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.hasCreateLinkButton()).toBe(true);
    });

    it('opens the create dialog from the no-link empty-state CTA', async () => {
      const {fixture, harness} = await setup({tab: 'magic-links'});

      expect(await harness.hasMagicLinksEmptyState()).toBe(true);

      await harness.clickEmptyCreateLinkButton();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.hasCreateDialog()).toBe(true);
    });

    it('sets aria-label on all magic-link action buttons', async () => {
      const {convexMock} = await setup({tab: 'magic-links'});

      convexMock.client.onUpdate.mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          onData: (data: unknown[]) => void,
        ) => {
          emitAsync(() =>
            onData([
              {
                _id: 'link-1',
                _creationTime: Date.now(),
                tokenPrefix: 'abc123de',
                status: 'active',
                redemptionCount: 0,
                label: 'VIP Access',
              },
            ]),
          );
          return () => void 0;
        },
      );

      const newFixture = TestBed.createComponent(CommunityAdminComponent);
      newFixture.componentRef.setInput('tab', 'magic-links');
      newFixture.detectChanges();
      await newFixture.whenStable();

      const newHarness = await TestbedHarnessEnvironment.harnessForFixture(
        newFixture,
        CommunityAdminHarness,
      );
      const ariaLabels = await newHarness.getMagicLinkActionAriaLabels();

      // Every action button should have an aria-label
      expect(ariaLabels.length).toBeGreaterThan(0);
      for (const label of ariaLabels) {
        expect(label).toBeTruthy();
        expect(label).toContain('VIP Access');
      }
    });

    it('shows only the stored token prefix for persisted magic links', async () => {
      const link = makeMagicLink({
        _id: 'link-copy' as Id<'magic_links'>,
        tokenPrefix: 'copy-tok',
        label: 'VIP Access',
        status: 'active',
      });
      const controller = createMagicLinksQueryController([link]);
      const {fixture, harness} = await setup({
        tab: 'magic-links',
        magicLinksController: controller,
      });
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {clipboard: {writeText: writeTextSpy}});

      const prefixes = await harness.getMagicLinkTokenPrefixes();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(writeTextSpy).not.toHaveBeenCalled();
      expect(prefixes).toContain('copy-tok');
      expect(await harness.getMagicLinkActionAriaLabels()).not.toContain(
        'Copy link VIP Access',
      );
      expect(await harness.getMagicLinkCopyUnavailableNotes()).toContain(
        'Full link only available right after creation.',
      );
    });

    it('wraps the create dialog content in a CDK focus trap', async () => {
      const {convexMock} = await setup({tab: 'magic-links'});

      convexMock.client.onUpdate.mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          onData: (data: unknown[]) => void,
        ) => {
          emitAsync(() =>
            onData([
              {
                _id: 'link-1',
                _creationTime: Date.now(),
                tokenPrefix: 'abc123de',
                status: 'active',
                redemptionCount: 0,
                label: 'Test Link',
              },
            ]),
          );
          return () => void 0;
        },
      );

      const newFixture = TestBed.createComponent(CommunityAdminComponent);
      newFixture.componentRef.setInput('tab', 'magic-links');
      newFixture.detectChanges();
      await newFixture.whenStable();

      // Open the dialog
      newFixture.componentInstance.openCreateDialog();
      newFixture.detectChanges();
      await newFixture.whenStable();

      const newHarness = await TestbedHarnessEnvironment.harnessForFixture(
        newFixture,
        CommunityAdminHarness,
      );
      expect(await newHarness.hasCreateDialog()).toBe(true);
      expect(await newHarness.hasDialogFocusTrap()).toBe(true);
    });

    it('closes the create dialog on Escape key', async () => {
      const {convexMock} = await setup({tab: 'magic-links'});

      convexMock.client.onUpdate.mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          onData: (data: unknown[]) => void,
        ) => {
          emitAsync(() =>
            onData([
              {
                _id: 'link-1',
                _creationTime: Date.now(),
                tokenPrefix: 'abc123de',
                status: 'active',
                redemptionCount: 0,
                label: 'Test Link',
              },
            ]),
          );
          return () => void 0;
        },
      );

      const newFixture = TestBed.createComponent(CommunityAdminComponent);
      newFixture.componentRef.setInput('tab', 'magic-links');
      newFixture.detectChanges();
      await newFixture.whenStable();

      // Open the dialog
      newFixture.componentInstance.openCreateDialog();
      newFixture.detectChanges();
      await newFixture.whenStable();

      const newHarness = await TestbedHarnessEnvironment.harnessForFixture(
        newFixture,
        CommunityAdminHarness,
      );
      expect(await newHarness.hasCreateDialog()).toBe(true);

      // Press Escape via the harness
      await newHarness.sendEscapeToDialog();
      newFixture.detectChanges();
      await newFixture.whenStable();

      expect(await newHarness.hasCreateDialog()).toBe(false);
    });

    it('keeps the create-dialog backdrop non-focusable and hidden from assistive tech', async () => {
      const {convexMock} = await setup({tab: 'magic-links'});

      convexMock.client.onUpdate.mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          onData: (data: unknown[]) => void,
        ) => {
          emitAsync(() => onData([]));
          return () => void 0;
        },
      );

      const newFixture = TestBed.createComponent(CommunityAdminComponent);
      newFixture.componentRef.setInput('tab', 'magic-links');
      newFixture.detectChanges();
      await newFixture.whenStable();

      newFixture.componentInstance.openCreateDialog();
      newFixture.detectChanges();
      await newFixture.whenStable();

      const newHarness = await TestbedHarnessEnvironment.harnessForFixture(
        newFixture,
        CommunityAdminHarness,
      );
      expect(await newHarness.hasCreateDialog()).toBe(true);
      // Decorative dismiss surface: out of the a11y tree and tab order.
      expect(await newHarness.getDialogBackdropAriaHidden()).toBe('true');
      expect(await newHarness.getDialogBackdropTabIndex()).toBeNull();

      // Pointer dismissal still works.
      await newHarness.clickDialogBackdrop();
      newFixture.detectChanges();
      await newFixture.whenStable();
      expect(await newHarness.hasCreateDialog()).toBe(false);
    });

    it('applies truncate class to desktop label cell to prevent overflow', async () => {
      const {convexMock} = await setup({tab: 'magic-links'});

      convexMock.client.onUpdate.mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          onData: (data: unknown[]) => void,
        ) => {
          emitAsync(() =>
            onData([
              {
                _id: 'link-1',
                _creationTime: Date.now(),
                tokenPrefix: 'abc123de',
                status: 'active',
                redemptionCount: 0,
                label: 'A'.repeat(100),
              },
            ]),
          );
          return () => void 0;
        },
      );

      const newFixture = TestBed.createComponent(CommunityAdminComponent);
      newFixture.componentRef.setInput('tab', 'magic-links');
      newFixture.detectChanges();
      await newFixture.whenStable();

      const newHarness = await TestbedHarnessEnvironment.harnessForFixture(
        newFixture,
        CommunityAdminHarness,
      );
      const labelClass = await newHarness.getMagicLinkDesktopLabelClass();
      expect(labelClass).toContain('truncate');
      expect(labelClass).toContain('block');
    });

    it('falls back to token prefix in aria-label when link has no label', async () => {
      const {convexMock} = await setup({tab: 'magic-links'});

      convexMock.client.onUpdate.mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          onData: (data: unknown[]) => void,
        ) => {
          emitAsync(() =>
            onData([
              {
                _id: 'link-2',
                _creationTime: Date.now(),
                tokenPrefix: 'xyz789gh',
                status: 'active',
                redemptionCount: 0,
              },
            ]),
          );
          return () => void 0;
        },
      );

      const newFixture = TestBed.createComponent(CommunityAdminComponent);
      newFixture.componentRef.setInput('tab', 'magic-links');
      newFixture.detectChanges();
      await newFixture.whenStable();

      const newHarness = await TestbedHarnessEnvironment.harnessForFixture(
        newFixture,
        CommunityAdminHarness,
      );
      const ariaLabels = await newHarness.getMagicLinkActionAriaLabels();

      expect(ariaLabels.length).toBeGreaterThan(0);
      for (const label of ariaLabels) {
        expect(label).toBeTruthy();
        expect(label).toContain('xyz789gh');
      }
    });

    it('shows "Unlimited" in the redemption count cell for links without a cap', async () => {
      const {convexMock} = await setup({tab: 'magic-links'});

      convexMock.client.onUpdate.mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          onData: (data: unknown[]) => void,
        ) => {
          emitAsync(() =>
            onData([
              {
                _id: 'link-3',
                _creationTime: Date.now(),
                tokenPrefix: 'unlimit',
                status: 'active',
                redemptionCount: 7,
                label: 'Unlimited Link',
                // no maxRedemptions field
              },
            ]),
          );
          return () => void 0;
        },
      );

      const newFixture = TestBed.createComponent(CommunityAdminComponent);
      newFixture.componentRef.setInput('tab', 'magic-links');
      newFixture.detectChanges();
      await newFixture.whenStable();

      const newHarness = await TestbedHarnessEnvironment.harnessForFixture(
        newFixture,
        CommunityAdminHarness,
      );

      expect(await newHarness.hasUnlimitedCapDisplay()).toBe(true);
    });

    it('does not call the mutation and keeps dialog open when maxRedemptions is 0', async () => {
      const {fixture, convexMock} = await setup({tab: 'magic-links'});
      const errorSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');

      fixture.componentInstance.isCreateDialogOpen.set(true);
      fixture.componentInstance.createFormMaxRedemptions.set('0');
      fixture.detectChanges();
      await fixture.whenStable();

      await fixture.componentInstance.createLink();

      expect(convexMock.mutation).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        'Max redemptions must be at least 1',
      );
      expect(fixture.componentInstance.isCreateDialogOpen()).toBe(true);
      expect(fixture.componentInstance.isCreating()).toBe(false);
    });

    it('shows error feedback and keeps the create dialog open when create fails', async () => {
      const controller = createMagicLinksQueryController();
      const {fixture, harness, convexMock} = await setup({
        tab: 'magic-links',
        magicLinksController: controller,
      });
      const errorSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');
      convexMock.mutation.mockRejectedValue(new Error('Create failed'));

      await harness.clickEmptyCreateLinkButton();
      await fixture.whenStable();
      fixture.componentInstance.createFormLabel.set('Broken Link');
      fixture.componentInstance.createFormMaxRedemptions.set('1');

      await fixture.componentInstance.createLink();
      await fixture.whenStable();

      expect(errorSpy).toHaveBeenCalledWith('Create failed');
      expect(fixture.componentInstance.isCreateDialogOpen()).toBe(true);
      expect(fixture.componentInstance.isCreating()).toBe(false);
      expect(await harness.getActiveMagicLinkCount()).toBe(0);
    });

    it('creates, pauses, and deletes a magic link through confirmed lifecycle actions', async () => {
      const controller = createMagicLinksQueryController();
      const {fixture, harness, convexMock} = await setup({
        tab: 'magic-links',
        magicLinksController: controller,
      });
      const alertDialogService = TestBed.inject(BraAlertDialogService);
      const confirmSpy = vi
        .spyOn(alertDialogService, 'confirm')
        .mockImplementation((config) => {
          config.zOnOk?.(undefined);
          return {} as ReturnType<BraAlertDialogService['confirm']>;
        });
      const successSpy = vi
        .spyOn(toast, 'success')
        .mockImplementation(() => 'toast-id');
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {clipboard: {writeText: writeTextSpy}});

      convexMock.mutation.mockImplementation(
        (mutationRef: unknown, args: unknown) => {
          if (
            functionReferenceMatches(
              mutationRef,
              api.communities.invite_links.create,
            )
          ) {
            const createArgs = args as CreateMagicLinkArgs;
            const created = makeMagicLink({
              _id: 'link-created' as Id<'magic_links'>,
              tokenPrefix: 'created-',
              label: createArgs.label,
              maxRedemptions: createArgs.maxRedemptions,
              status: 'active',
            });
            controller.setActive([created]);
            return {
              linkId: created._id,
              token: 'created-token',
              url: `${window.location.origin}/invite/created-token`,
            };
          }

          if (
            functionReferenceMatches(
              mutationRef,
              api.communities.invite_links.updateStatus,
            )
          ) {
            const updateArgs = args as UpdateMagicLinkStatusArgs;
            const target = controller.active.find(
              (link) => link._id === updateArgs.linkId,
            );
            if (!target) {
              throw new Error('Expected active magic link in test controller');
            }

            if (updateArgs.action === 'pause') {
              controller.setActive(
                controller.active.map((link) =>
                  link._id === updateArgs.linkId
                    ? {...link, status: 'paused'}
                    : link,
                ),
              );
              return {success: true};
            }

            const deletedAt = Date.now();
            controller.setActive(
              controller.active.filter(
                (link) => link._id !== updateArgs.linkId,
              ),
            );
            controller.setPast([
              ...controller.past,
              {...target, status: 'disabled', deletedAt},
            ]);
            return {success: true};
          }

          throw new Error('Unexpected mutation in magic-link lifecycle test');
        },
      );

      await harness.clickEmptyCreateLinkButton();
      await fixture.whenStable();
      expect(await harness.hasCreateDialog()).toBe(true);
      fixture.componentInstance.createFormLabel.set('QA Negative Redemption');
      fixture.componentInstance.createFormMaxRedemptions.set('1');
      await fixture.componentInstance.createLink();
      await fixture.whenStable();

      await expect.poll(() => harness.getActiveMagicLinkCount()).toBe(1);
      await expect
        .poll(async () => (await harness.getActiveMagicLinkRowTexts())[0] ?? '')
        .toContain('active');
      await expect
        .poll(async () => (await harness.getActiveMagicLinkRowTexts())[0] ?? '')
        .toContain('QA Negative Redemption');
      expect(successSpy).toHaveBeenCalledWith('Magic link created');
      expect(writeTextSpy).toHaveBeenCalledWith(
        `${window.location.origin}/invite/created-token`,
      );
      expect(await harness.getMagicLinkActionAriaLabels()).toContain(
        'Copy link QA Negative Redemption',
      );
      await harness.clickMagicLinkAction('Copy link QA Negative Redemption');
      expect(writeTextSpy).toHaveBeenCalledTimes(2);
      expect(await harness.getMagicLinkCopyStatus()).toBe(
        'Copied link for QA Negative Redemption',
      );

      await harness.clickMagicLinkAction('Pause link QA Negative Redemption');
      await expect
        .poll(async () => (await harness.getActiveMagicLinkRowTexts())[0] ?? '')
        .toContain('paused');
      expect(successSpy).toHaveBeenCalledWith('Link paused');
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          zTitle: 'Pause Link',
          zOkText: 'Pause Link',
          zMaskClosable: false,
        }),
      );

      await harness.clickMagicLinkAction('Delete link QA Negative Redemption');
      await expect.poll(() => harness.getActiveMagicLinkCount()).toBe(0);
      expect(successSpy).toHaveBeenCalledWith('Link deleted');
      await harness.setMagicLinksFilter('past');
      await fixture.whenStable();

      await expect.poll(() => harness.getPastMagicLinkCount()).toBe(1);
      expect((await harness.getPastMagicLinkLabels()).join('\n')).toContain(
        'QA Negative Redemption',
      );
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          zTitle: 'Delete Link',
          zOkText: 'Delete Link',
          zOkDestructive: true,
          zMaskClosable: false,
        }),
      );
      expect(convexMock.mutation).toHaveBeenCalledWith(
        api.communities.invite_links.updateStatus,
        {
          linkId: 'link-created',
          action: 'pause',
        },
      );
      expect(convexMock.mutation).toHaveBeenCalledWith(
        api.communities.invite_links.updateStatus,
        {
          linkId: 'link-created',
          action: 'delete',
        },
      );
    });

    it('resumes a paused magic link and shows success feedback', async () => {
      const pausedLink = makeMagicLink({
        _id: 'link-paused' as Id<'magic_links'>,
        tokenPrefix: 'paused-t',
        label: 'Paused Access',
        status: 'paused',
      });
      const controller = createMagicLinksQueryController([pausedLink]);
      const {fixture, harness, convexMock} = await setup({
        tab: 'magic-links',
        magicLinksController: controller,
      });
      const successSpy = vi
        .spyOn(toast, 'success')
        .mockImplementation(() => 'toast-id');

      convexMock.mutation.mockImplementation(
        (mutationRef: unknown, args: unknown) => {
          if (
            functionReferenceMatches(
              mutationRef,
              api.communities.invite_links.updateStatus,
            )
          ) {
            const updateArgs = args as UpdateMagicLinkStatusArgs;
            expect(updateArgs).toEqual({
              linkId: 'link-paused',
              action: 'resume',
            });
            controller.setActive(
              controller.active.map((link) =>
                link._id === updateArgs.linkId
                  ? {...link, status: 'active'}
                  : link,
              ),
            );
            return {success: true};
          }

          throw new Error('Unexpected mutation in magic-link resume test');
        },
      );

      await harness.clickMagicLinkAction('Resume link Paused Access');
      await fixture.whenStable();

      await expect
        .poll(async () => (await harness.getActiveMagicLinkRowTexts())[0] ?? '')
        .toContain('active');
      expect(successSpy).toHaveBeenCalledWith('Link resumed');
      expect(await harness.getMagicLinkActionAriaLabels()).toContain(
        'Pause link Paused Access',
      );
    });

    it('keeps a magic link in the active list when delete is canceled', async () => {
      const controller = createMagicLinksQueryController([
        makeMagicLink({
          _id: 'link-cancel-delete' as Id<'magic_links'>,
          tokenPrefix: 'cancel-d',
          label: 'Keep This Link',
          status: 'active',
        }),
      ]);
      const {fixture, harness, convexMock} = await setup({
        tab: 'magic-links',
        magicLinksController: controller,
      });
      const alertDialogService = TestBed.inject(BraAlertDialogService);
      const confirmSpy = vi
        .spyOn(alertDialogService, 'confirm')
        .mockImplementation(() => {
          return {} as ReturnType<BraAlertDialogService['confirm']>;
        });

      await harness.clickMagicLinkAction('Delete link Keep This Link');
      await fixture.whenStable();

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          zTitle: 'Delete Link',
          zOkText: 'Delete Link',
          zCancelText: 'Cancel',
          zOkDestructive: true,
          zMaskClosable: false,
        }),
      );
      expect(convexMock.mutation).not.toHaveBeenCalledWith(
        api.communities.invite_links.updateStatus,
        expect.objectContaining({
          linkId: 'link-cancel-delete',
          action: 'delete',
        }),
      );
      expect(await harness.getActiveMagicLinkCount()).toBe(1);
      expect((await harness.getActiveMagicLinkRowTexts()).join('\n')).toContain(
        'Keep This Link',
      );
    });

    it('shows error feedback when a magic-link lifecycle action fails', async () => {
      const controller = createMagicLinksQueryController([
        makeMagicLink({
          _id: 'link-failure' as Id<'magic_links'>,
          tokenPrefix: 'failure-',
          label: 'Failure Link',
          status: 'active',
        }),
      ]);
      const {fixture, harness, convexMock} = await setup({
        tab: 'magic-links',
        magicLinksController: controller,
      });
      const alertDialogService = TestBed.inject(BraAlertDialogService);
      vi.spyOn(alertDialogService, 'confirm').mockImplementation((config) => {
        config.zOnOk?.(undefined);
        return {} as ReturnType<BraAlertDialogService['confirm']>;
      });
      const errorSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');
      convexMock.mutation.mockRejectedValue(new Error('Pause failed'));

      await harness.clickMagicLinkAction('Pause link Failure Link');
      await fixture.whenStable();

      expect(errorSpy).toHaveBeenCalledWith('Pause failed');
      expect((await harness.getActiveMagicLinkRowTexts()).join('\n')).toContain(
        'active',
      );
    });

    it('shows "Leave empty for unlimited" helper text in the create dialog', async () => {
      const {fixture} = await setup({tab: 'magic-links'});

      fixture.componentInstance.isCreateDialogOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        CommunityAdminHarness,
      );
      expect(await harness.hasMaxRedemptionsHint()).toBe(true);
    });

    it('does not show "Unlimited" in the redemption cell for links with a maxRedemptions cap of 0', async () => {
      const {convexMock} = await setup({tab: 'magic-links'});

      convexMock.client.onUpdate.mockImplementation(
        (
          _query: unknown,
          _args: unknown,
          onData: (data: unknown[]) => void,
        ) => {
          emitAsync(() =>
            onData([
              {
                _id: 'link-4',
                _creationTime: Date.now(),
                tokenPrefix: 'zerocap',
                status: 'active',
                redemptionCount: 0,
                label: 'Zero Cap Link',
                maxRedemptions: 0,
              },
            ]),
          );
          return () => void 0;
        },
      );

      const newFixture = TestBed.createComponent(CommunityAdminComponent);
      newFixture.componentRef.setInput('tab', 'magic-links');
      newFixture.detectChanges();
      await newFixture.whenStable();

      const newHarness = await TestbedHarnessEnvironment.harnessForFixture(
        newFixture,
        CommunityAdminHarness,
      );

      // A link with maxRedemptions: 0 (invalid DB state) should NOT show "Unlimited"
      expect(await newHarness.hasUnlimitedCapDisplay()).toBe(false);
    });

    it('routes the active magic-links query error to its own toast', async () => {
      const errorSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');
      const {fixture} = await setup({tab: 'magic-links', failLinks: true});
      await fixture.whenStable();

      // Consolidated onError must map the 'links' key to the active-links copy,
      // not the past-links copy.
      expect(errorSpy).toHaveBeenCalledWith('Failed to load your magic links');
      expect(errorSpy).not.toHaveBeenCalledWith(
        'Failed to load past magic links',
      );
    });

    it('routes the past magic-links query error to its own toast', async () => {
      const errorSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');
      const {fixture} = await setup({tab: 'magic-links', failLinksPast: true});
      await fixture.whenStable();

      expect(errorSpy).toHaveBeenCalledWith('Failed to load past magic links');
      expect(errorSpy).not.toHaveBeenCalledWith(
        'Failed to load your magic links',
      );
    });

    it('does not toast for the isMemberOf or community keys when they are the only active queries', async () => {
      const errorSpy = vi
        .spyOn(toast, 'error')
        .mockImplementation(() => 'toast-id');
      // On a non-magic-links tab the links/linksPast keys are skipToken, so the
      // consolidated onError never fires magic-link toasts here.
      const {fixture} = await setup({tab: 'pending'});
      await fixture.whenStable();

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('keeps isLoading tied to the links query, not the aggregate of all four queries', async () => {
      // On a non-magic-links tab the links key is skipToken (status 'skipped'),
      // so isLoading must be false even though isMemberOf/community subscribe.
      // An aggregate isLoading would leak those queries' pending state here.
      const {fixture} = await setup({tab: 'pending'});
      await fixture.whenStable();

      expect(fixture.componentInstance.isLoading()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Audit log tab
  // -------------------------------------------------------------------------

  describe('audit-log tab', () => {
    it('should render AuditLogTableComponent when audit-log tab is active', async () => {
      const {harness} = await setup({tab: 'audit-log'});
      expect(await harness.hasAuditLogTable()).toBe(true);
    });

    it('does not render audit log table on other tabs', async () => {
      const {harness} = await setup({tab: 'pending'});
      expect(await harness.hasAuditLogTable()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Settings tab
  // -------------------------------------------------------------------------

  describe('settings tab', () => {
    it('renders the settings component when settings tab is active', async () => {
      const {harness} = await setup({tab: 'settings'});
      expect(await harness.hasSettingsComponent()).toBe(true);
    });

    it('does not render settings component on other tabs', async () => {
      const {harness} = await setup({tab: 'pending'});
      expect(await harness.hasSettingsComponent()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Admin override
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Magic link copy
  // -------------------------------------------------------------------------

  describe('copyLink', () => {
    it('builds the URL from window.location.origin, not backend SITE_URL', async () => {
      const {fixture} = await setup({});
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {clipboard: {writeText: writeTextSpy}});

      await fixture.componentInstance.copyLink('abc123');

      expect(writeTextSpy).toHaveBeenCalledWith(
        `${window.location.origin}/invite/abc123`,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Admin override
  // -------------------------------------------------------------------------

  describe('admin override', () => {
    it('isAdminOverride is false for non-admin users', async () => {
      const {fixture} = await setup({userRole: 'community_admin'});
      expect(fixture.componentInstance.isAdminOverride()).toBe(false);
    });

    it('isAdminOverride is false for admin users when isMemberOf data is not yet loaded', async () => {
      const {fixture} = await setup({userRole: 'root_admin'});
      // communityQueries.results().isMemberOf is undefined when not loaded, so isAdminOverride should be false
      expect(fixture.componentInstance.isAdminOverride()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Unsaved changes guard
  // -------------------------------------------------------------------------

  describe('unsaved changes guard', () => {
    it('isDirty returns false when not on settings tab', async () => {
      const {fixture} = await setup({tab: 'pending'});
      expect(fixture.componentInstance.isDirty()).toBe(false);
    });

    it('isDirty returns false when on settings tab with no changes', async () => {
      const {fixture} = await setup({tab: 'settings'});
      expect(fixture.componentInstance.isDirty()).toBe(false);
    });

    it('handleBeforeTabChange allows navigation when not dirty', async () => {
      const {fixture} = await setup({tab: 'pending'});
      const result = fixture.componentInstance.handleBeforeTabChange({
        id: 'members',
        label: 'Members',
        path: '/community-admin/members',
      });
      expect(result).toBe(true);
    });

    it('handleBeforeTabChange allows navigation when on settings tab but clean', async () => {
      const {fixture} = await setup({tab: 'settings'});
      const result = fixture.componentInstance.handleBeforeTabChange({
        id: 'members',
        label: 'Members',
        path: '/community-admin/members',
      });
      expect(result).toBe(true);
    });

    it('handleBeforeTabChange shows dialog and resolves true when user discards', async () => {
      const {fixture} = await setup({tab: 'settings'});
      const alertDialogService = TestBed.inject(BraAlertDialogService);
      const confirmSpy = vi
        .spyOn(alertDialogService, 'confirm')
        .mockImplementation((config) => {
          config.zOnOk?.(undefined);
          return {} as ReturnType<BraAlertDialogService['confirm']>;
        });

      vi.spyOn(fixture.componentInstance, 'isDirty').mockReturnValue(true);

      const result = fixture.componentInstance.handleBeforeTabChange({
        id: 'members',
        label: 'Members',
        path: '/community-admin/members',
      });
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBe(true);
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          zTitle: 'Unsaved Changes',
          zOkDestructive: true,
          zMaskClosable: false,
        }),
      );
    });

    it('handleBeforeTabChange shows dialog and resolves false when user keeps editing', async () => {
      const {fixture} = await setup({tab: 'settings'});
      const alertDialogService = TestBed.inject(BraAlertDialogService);
      vi.spyOn(alertDialogService, 'confirm').mockImplementation((config) => {
        config.zOnCancel?.(undefined);
        return {} as ReturnType<BraAlertDialogService['confirm']>;
      });

      vi.spyOn(fixture.componentInstance, 'isDirty').mockReturnValue(true);

      const result = fixture.componentInstance.handleBeforeTabChange({
        id: 'members',
        label: 'Members',
        path: '/community-admin/members',
      });
      await expect(result).resolves.toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // organizerId query param handling (BRA-296: no double navigation)
  // -------------------------------------------------------------------------

  describe('organizerId query param', () => {
    it('calls selectCommunity (via loadCommunityBySlugOrId) when organizerId is present in query params', async () => {
      const ctxMock = makeCommunityContextMock({
        selectedId: FAKE_ORG_ID,
        selectedName: 'Test Community',
      });
      ctxMock.selectCommunity = vi.fn();

      const authMock = {
        userRole: vi.fn(() => 'root_admin'),
        logout: vi.fn(),
        currentUser: vi.fn(() => ({_id: 'user-1' as Id<'users'>})),
      };

      const convexMock: MockConvexClient = createMockConvexClient();
      const onUpdate = vi
        .fn()
        .mockImplementation(
          (
            _query: unknown,
            _args: unknown,
            onData: (data: unknown[]) => void,
          ) => {
            onData([]);
            return () => void 0;
          },
        );
      const onPaginatedUpdate = vi
        .fn()
        .mockImplementation(
          (
            _query: unknown,
            _args: unknown,
            _opts: unknown,
            onData: (data: {
              results: unknown[];
              status: string;
              loadMore: () => boolean;
            }) => void,
          ) => {
            onData({results: [], status: 'Exhausted', loadMore: () => false});
            return () => void 0;
          },
        );
      convexMock.client.onUpdate = onUpdate;
      convexMock.onUpdate = onUpdate;
      convexMock.client.onPaginatedUpdate_experimental = onPaginatedUpdate;
      convexMock.onPaginatedUpdate_experimental = onPaginatedUpdate;

      const activatedRouteMock = {
        queryParamMap: of(convertToParamMap({organizerId: FAKE_ORG_ID})),
        paramMap: of(convertToParamMap({})),
        snapshot: {
          queryParamMap: {
            get: (key: string) => (key === 'organizerId' ? FAKE_ORG_ID : null),
          },
          paramMap: {
            get: () => null,
          },
        },
      };

      await TestBed.configureTestingModule({
        imports: [CommunityAdminComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([{path: '**', children: []}]),
          {provide: AuthService, useValue: authMock},
          {provide: CONVEX, useValue: convexMock},
          {provide: BraDialogService, useValue: {create: vi.fn()}},
          {provide: CommunityContextService, useValue: ctxMock},
          {
            provide: CommunitiesService,
            useValue: {
              get: vi.fn().mockResolvedValue({name: 'Test Community'}),
              getBySlugOrId: vi
                .fn()
                .mockResolvedValue({_id: FAKE_ORG_ID, name: 'Test Community'}),
            },
          },
          {provide: ActivatedRoute, useValue: activatedRouteMock},
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(CommunityAdminComponent);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(ctxMock.selectCommunity).toHaveBeenCalledWith(FAKE_ORG_ID);
    });

    it('does not call router.navigate synchronously during construction when organizerId is present', async () => {
      const ctxMock = makeCommunityContextMock({
        selectedId: FAKE_ORG_ID,
        selectedName: 'Test Community',
      });

      const authMock = {
        userRole: vi.fn(() => 'root_admin'),
        logout: vi.fn(),
        currentUser: vi.fn(() => ({_id: 'user-1' as Id<'users'>})),
      };

      const convexMock: MockConvexClient = createMockConvexClient();
      const onUpdate = vi
        .fn()
        .mockImplementation(
          (
            _query: unknown,
            _args: unknown,
            onData: (data: unknown[]) => void,
          ) => {
            onData([]);
            return () => void 0;
          },
        );
      const onPaginatedUpdate = vi
        .fn()
        .mockImplementation(
          (
            _query: unknown,
            _args: unknown,
            _opts: unknown,
            onData: (data: {
              results: unknown[];
              status: string;
              loadMore: () => boolean;
            }) => void,
          ) => {
            onData({results: [], status: 'Exhausted', loadMore: () => false});
            return () => void 0;
          },
        );
      convexMock.client.onUpdate = onUpdate;
      convexMock.onUpdate = onUpdate;
      convexMock.client.onPaginatedUpdate_experimental = onPaginatedUpdate;
      convexMock.onPaginatedUpdate_experimental = onPaginatedUpdate;

      const activatedRouteMock = {
        queryParamMap: of(convertToParamMap({organizerId: FAKE_ORG_ID})),
        paramMap: of(convertToParamMap({})),
        snapshot: {
          queryParamMap: {
            get: (key: string) => (key === 'organizerId' ? FAKE_ORG_ID : null),
          },
          paramMap: {
            get: () => null,
          },
        },
      };

      await TestBed.configureTestingModule({
        imports: [CommunityAdminComponent],
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([{path: '**', children: []}]),
          {provide: AuthService, useValue: authMock},
          {provide: CONVEX, useValue: convexMock},
          {provide: BraDialogService, useValue: {create: vi.fn()}},
          {provide: CommunityContextService, useValue: ctxMock},
          {
            provide: CommunitiesService,
            useValue: {
              get: vi.fn().mockResolvedValue({name: 'Test Community'}),
              getBySlugOrId: vi
                .fn()
                .mockResolvedValue({_id: FAKE_ORG_ID, name: 'Test Community'}),
            },
          },
          {provide: ActivatedRoute, useValue: activatedRouteMock},
        ],
      }).compileComponents();

      const routerNavigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate');

      // Create the component — if navigate were called synchronously in the
      // constructor it would fire before detectChanges().
      TestBed.createComponent(CommunityAdminComponent);

      // navigate must NOT have been called synchronously during construction.
      expect(routerNavigateSpy).not.toHaveBeenCalled();
    });
  });

  describe('BRA-406: unresolved ?community slug', () => {
    it('shows error card and retains URL param when getBySlugOrId returns null', async () => {
      const {harness, fixture} = await setup({
        queryParams: {community: 'invalid-slug'},
        communityBySlug: null,
        selectedId: null,
        spyOnNavigate: false,
      });

      fixture.detectChanges();
      await fixture.whenStable();

      const errorText = await harness.getUnresolvedCommunityError();
      expect(errorText).not.toBeNull();
      expect(errorText).toContain('invalid-slug');
    });

    it('clears error card and selects community when pick button is clicked', async () => {
      const communityId = 'org-pick-1' as Id<'organizers'>;
      const {harness, fixture, ctxMock} = await setup({
        queryParams: {community: 'invalid-slug'},
        communityBySlug: null,
        selectedId: null,
        communities: [communityId],
        spyOnNavigate: true,
      });

      fixture.detectChanges();
      await fixture.whenStable();

      // Error card should be visible
      expect(await harness.getUnresolvedCommunityError()).not.toBeNull();

      // Click pick button
      await harness.pickUnresolvedCommunity(0);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(ctxMock.selectCommunity).toHaveBeenCalledWith(communityId);
    });
  });
});
