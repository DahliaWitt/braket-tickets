import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {ActivatedRoute, provideRouter, Router} from '@angular/router';
import {describe, it, expect, vi} from 'vitest';
import {CommunitySelectorComponent} from './community-selector.component';
import {CommunitySelectorHarness} from './community-selector.harness';
import {CommunityContextService} from '../../services/community-context.service';
import {CommunitiesService} from '@/core/services/communities.service';
import {AuthService} from '@/core/services/auth.service';
import {CONVEX} from 'convex-angular';
import type {Id} from '@convex/_generated/dataModel';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../../../testing/mock-types';

// ---------------------------------------------------------------------------
// Minimal mock for CommunityContextService — provides signals directly so
// tests can control state without standing up Convex.
// ---------------------------------------------------------------------------
function makeCommunityContextMock(options: {
  communities?: Id<'organizers'>[];
  selectedId?: Id<'organizers'> | null;
  selectedName?: string | null;
  hasMultiple?: boolean;
  isAdminOverride?: boolean;
}) {
  const communityList = options.communities ?? [];
  const selectedId = options.selectedId ?? communityList[0] ?? null;
  const selectedName = options.selectedName ?? null;
  const hasMultiple = options.hasMultiple ?? communityList.length > 1;
  const isAdminOverride = options.isAdminOverride ?? false;

  return {
    communities: vi.fn(() => communityList),
    selectedCommunityId: vi.fn(() => selectedId),
    selectedCommunityName: vi.fn(() => selectedName),
    hasMultipleCommunities: vi.fn(() => hasMultiple),
    isAdminOverride: vi.fn(() => isAdminOverride),
    selectCommunity: vi.fn(),
    setResolvedNames: vi.fn(),
    isLoading: vi.fn(() => false),
  };
}

// ---------------------------------------------------------------------------
// Helper: create and compile the component under test with given mocks.
// ---------------------------------------------------------------------------
async function setup(options: {
  communities?: Id<'organizers'>[];
  selectedId?: Id<'organizers'> | null;
  selectedName?: string | null;
  hasMultiple?: boolean;
  isAdminOverride?: boolean;
  communitiesServiceGet?: (
    id: Id<'organizers'>,
  ) => Promise<{name: string; slug?: string | null} | null>;
  userRole?: 'root_admin' | 'community_admin';
}) {
  const activatedRouteStub = {
    snapshot: {
      queryParams: {},
      params: {},
      data: {},
      fragment: null,
      url: [],
    },
  };

  const ctxMock = makeCommunityContextMock({
    ...options,
    isAdminOverride: options.isAdminOverride ?? false,
  });

  const communitiesServiceMock = {
    get: options.communitiesServiceGet ?? vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
  };

  // Convex client mock is required because CommunitiesService injects it via
  // provideConvex() and injectConvexQuery.
  const convexClientMock: MockConvexClient = createMockConvexClient();

  // AuthService mock provides userRole signal for the batch-vs-individual fetch branch.
  const role = options.userRole ?? 'community_admin';
  const authServiceMock = {
    userRole: vi.fn(() => role),
  };

  await TestBed.configureTestingModule({
    imports: [CommunitySelectorComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([{path: '**', children: []}]),
      {provide: CommunityContextService, useValue: ctxMock},
      {provide: CommunitiesService, useValue: communitiesServiceMock},
      {provide: AuthService, useValue: authServiceMock},
      {provide: CONVEX, useValue: convexClientMock},
      {provide: ActivatedRoute, useValue: activatedRouteStub},
    ],
  }).compileComponents();

  const fixture: ComponentFixture<CommunitySelectorComponent> =
    TestBed.createComponent(CommunitySelectorComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    CommunitySelectorHarness,
  );

  return {
    fixture,
    harness,
    ctxMock,
    communitiesServiceMock,
    authServiceMock,
    activatedRouteStub,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('CommunitySelectorComponent', () => {
  describe('single community (no dropdown)', () => {
    const communityA = 'org-a' as Id<'organizers'>;

    it('renders the static community name label', async () => {
      const {harness} = await setup({
        communities: [communityA],
        selectedId: communityA,
        selectedName: 'Alpha Crew',
        hasMultiple: false,
        communitiesServiceGet: vi.fn().mockResolvedValue({name: 'Alpha Crew'}),
      });

      expect(await harness.isStaticNameVisible()).toBe(true);
      expect(await harness.getStaticNameText()).toBe('Alpha Crew');
    });

    it('does not render the dropdown when only one community', async () => {
      const {harness} = await setup({
        communities: [communityA],
        selectedId: communityA,
        selectedName: 'Alpha Crew',
        hasMultiple: false,
        communitiesServiceGet: vi.fn().mockResolvedValue({name: 'Alpha Crew'}),
      });

      expect(await harness.isDropdownVisible()).toBe(false);
    });
  });

  describe('multiple communities (dropdown)', () => {
    const communityA = 'org-a' as Id<'organizers'>;
    const communityB = 'org-b' as Id<'organizers'>;

    it('renders the dropdown when multiple communities exist', async () => {
      const {harness} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        communitiesServiceGet: vi
          .fn()
          .mockImplementation(async (id: Id<'organizers'>) =>
            id === communityA ? {name: 'Alpha Crew'} : {name: 'Beta Squad'},
          ),
      });

      expect(await harness.isDropdownVisible()).toBe(true);
    });

    it('does not render the static name label when multiple communities exist', async () => {
      const {harness} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        communitiesServiceGet: vi
          .fn()
          .mockImplementation(async (id: Id<'organizers'>) =>
            id === communityA ? {name: 'Alpha Crew'} : {name: 'Beta Squad'},
          ),
      });

      expect(await harness.isStaticNameVisible()).toBe(false);
    });

    it('calls selectCommunity on dropdown change', async () => {
      const {harness, ctxMock} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        communitiesServiceGet: vi
          .fn()
          .mockImplementation(async (id: Id<'organizers'>) =>
            id === communityA ? {name: 'Alpha Crew'} : {name: 'Beta Squad'},
          ),
      });

      await harness.selectCommunity(communityB);

      expect(ctxMock.selectCommunity).toHaveBeenCalledWith(communityB);
    });

    it('keeps the active community selected after async options resolve', async () => {
      const {harness} = await setup({
        communities: [communityA, communityB],
        selectedId: communityB,
        selectedName: null,
        hasMultiple: true,
        communitiesServiceGet: vi
          .fn()
          .mockImplementation(async (id: Id<'organizers'>) =>
            id === communityA ? {name: 'Puppy Pilled'} : {name: 'Braket'},
          ),
      });

      expect(await harness.getSelectedValue()).toBe(communityB);
    });

    it('navigates with the selected community slug when the user switches communities', async () => {
      const {fixture, harness, activatedRouteStub} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        communitiesServiceGet: vi
          .fn()
          .mockImplementation(async (id: Id<'organizers'>) =>
            id === communityA
              ? {name: 'Alpha Crew', slug: 'alpha-crew'}
              : {name: 'Beta Squad', slug: 'beta-squad'},
          ),
      });

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate');

      await harness.selectCommunity(communityB);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(navigateSpy).toHaveBeenCalledWith([], {
        relativeTo: activatedRouteStub,
        queryParams: {community: 'beta-squad'},
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  });

  describe('admin-override mode', () => {
    const overrideCommunity = 'org-override' as Id<'organizers'>;
    const userCommunityA = 'org-a' as Id<'organizers'>;
    const userCommunityB = 'org-b' as Id<'organizers'>;

    it('renders the static override community name instead of the dropdown', async () => {
      const {harness} = await setup({
        communities: [userCommunityA, userCommunityB],
        selectedId: overrideCommunity,
        selectedName: 'Sister City',
        hasMultiple: true,
        isAdminOverride: true,
        communitiesServiceGet: vi.fn().mockResolvedValue({name: 'Sister City'}),
        userRole: 'root_admin',
      });

      expect(await harness.isDropdownVisible()).toBe(false);
      expect(await harness.isStaticNameVisible()).toBe(true);
      expect(await harness.getStaticNameText()).toBe('Sister City');
    });

    it('does not render the dropdown even when the user administers multiple communities', async () => {
      const {harness} = await setup({
        communities: [userCommunityA, userCommunityB],
        selectedId: overrideCommunity,
        selectedName: 'Sister City',
        hasMultiple: true,
        isAdminOverride: true,
        communitiesServiceGet: vi.fn().mockResolvedValue({name: 'Sister City'}),
        userRole: 'root_admin',
      });

      expect(await harness.isDropdownVisible()).toBe(false);
    });

    it('renders nothing when override name is not yet resolved', async () => {
      const {harness} = await setup({
        communities: [userCommunityA],
        selectedId: overrideCommunity,
        selectedName: null,
        hasMultiple: false,
        isAdminOverride: true,
        communitiesServiceGet: vi.fn().mockResolvedValue(null),
        userRole: 'root_admin',
      });

      expect(await harness.isDropdownVisible()).toBe(false);
      expect(await harness.isStaticNameVisible()).toBe(false);
    });
  });

  describe('derived isAdminOverride semantics', () => {
    const communityA = 'org-a' as Id<'organizers'>;
    const communityB = 'org-b' as Id<'organizers'>;
    const nonMemberCommunity = 'org-non-member' as Id<'organizers'>;

    it('non-member selection: when isAdminOverride is true renders static community-name label', async () => {
      const {harness} = await setup({
        communities: [communityA, communityB],
        selectedId: nonMemberCommunity,
        selectedName: 'Non-Member Org',
        hasMultiple: true,
        isAdminOverride: true,
        communitiesServiceGet: vi
          .fn()
          .mockResolvedValue({name: 'Non-Member Org'}),
        userRole: 'root_admin',
      });

      expect(await harness.isStaticNameVisible()).toBe(true);
      expect(await harness.isDropdownVisible()).toBe(false);
    });

    it('member selection: when isAdminOverride is false renders community-selector-dropdown', async () => {
      const {harness} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        isAdminOverride: false,
        communitiesServiceGet: vi
          .fn()
          .mockImplementation(async (id: Id<'organizers'>) =>
            id === communityA ? {name: 'Alpha Crew'} : {name: 'Beta Squad'},
          ),
      });

      expect(await harness.isDropdownVisible()).toBe(true);
      expect(await harness.isStaticNameVisible()).toBe(false);
    });
  });

  describe('empty / no communities', () => {
    it('renders nothing when there are no communities', async () => {
      const {harness} = await setup({
        communities: [],
        selectedId: null,
        selectedName: null,
        hasMultiple: false,
      });

      expect(await harness.isDropdownVisible()).toBe(false);
      expect(await harness.isStaticNameVisible()).toBe(false);
    });
  });
});
