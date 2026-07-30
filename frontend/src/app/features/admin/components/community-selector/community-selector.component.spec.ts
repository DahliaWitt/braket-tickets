import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {ActivatedRoute, provideRouter, Router} from '@angular/router';
import {describe, it, expect, vi} from 'vitest';
import {CommunitySelectorComponent} from './community-selector.component';
import {CommunitySelectorHarness} from './community-selector.harness';
import {CommunityContextService} from '../../services/community-context.service';
import {AuthService} from '@/core/services/auth.service';
import {CommunityAdminDefaultService} from '@/features/admin/services/community-admin-default.service';
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
  communityNamesById?: Record<
    string,
    {name: string; slug?: string | null} | null
  >;
  listCommunities?: {
    _id: Id<'organizers'>;
    name: string;
    slug?: string | null;
  }[];
  /** Per-ID lookups that never emit — the subscription stays pending. */
  pendingIds?: string[];
  userRole?: 'root_admin' | 'community_admin';
  isSelectedDefault?: boolean;
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

  // Convex mock drives name resolution: per-ID `communities.public.get`
  // subscriptions (args include `id`) and the root-admin batch
  // `communities.list.list` subscription (empty args). injectQuery/injectQueries
  // record the active subscription AFTER calling onUpdate, so emit
  // asynchronously via queueMicrotask; a synchronous emit would be dropped.
  const namesById = options.communityNamesById ?? {};
  const listData = options.listCommunities ?? [];
  const onUpdate = vi
    .fn()
    .mockImplementation(
      (
        _queryRef: unknown,
        args: Record<string, unknown>,
        onData: (d: unknown) => void,
      ) => {
        queueMicrotask(() => {
          if (args && 'id' in args) {
            if (options.pendingIds?.includes(String(args.id))) return;
            onData(namesById[String(args.id)] ?? null);
          } else {
            onData(listData);
          }
        });
        return () => void 0;
      },
    );
  const convexClientMock: MockConvexClient = createMockConvexClient();
  convexClientMock.onUpdate = onUpdate;
  convexClientMock.client.onUpdate = onUpdate;

  // AuthService mock provides userRole signal for the batch-vs-individual fetch branch.
  const role = options.userRole ?? 'community_admin';
  const authServiceMock = {
    userRole: vi.fn(() => role),
    user: vi.fn(() => ({_id: 'user-1'})),
  };
  const defaultServiceMock = {
    isDefaultCommunity: vi.fn(() => options.isSelectedDefault ?? false),
    setDefaultCommunity: vi.fn().mockResolvedValue(undefined),
  };

  await TestBed.configureTestingModule({
    imports: [CommunitySelectorComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([{path: '**', children: []}]),
      {provide: CommunityContextService, useValue: ctxMock},
      {provide: AuthService, useValue: authServiceMock},
      {provide: CommunityAdminDefaultService, useValue: defaultServiceMock},
      {provide: CONVEX, useValue: convexClientMock},
      {provide: ActivatedRoute, useValue: activatedRouteStub},
    ],
  }).compileComponents();

  const fixture: ComponentFixture<CommunitySelectorComponent> =
    TestBed.createComponent(CommunitySelectorComponent);
  fixture.detectChanges();
  // Flush the async (queueMicrotask) subscription emissions from the Convex
  // mock, then re-run change detection so options() reflects resolved names.
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    CommunitySelectorHarness,
  );

  return {
    fixture,
    harness,
    ctxMock,
    authServiceMock,
    defaultServiceMock,
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
        communityNamesById: {[communityA]: {name: 'Alpha Crew'}},
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
        communityNamesById: {[communityA]: {name: 'Alpha Crew'}},
      });

      expect(await harness.isDropdownVisible()).toBe(false);
    });

    it('does not render the default preference action when only one community exists', async () => {
      const {harness} = await setup({
        communities: [communityA],
        selectedId: communityA,
        selectedName: 'Alpha Crew',
        hasMultiple: false,
        isSelectedDefault: true,
        communityNamesById: {[communityA]: {name: 'Alpha Crew'}},
      });

      expect(await harness.hasSetDefaultButton()).toBe(false);
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
      });

      expect(await harness.isDropdownVisible()).toBe(true);
    });

    it('does not render the static name label when multiple communities exist', async () => {
      const {harness} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
      });

      expect(await harness.isStaticNameVisible()).toBe(false);
    });

    it('keeps pending name lookups out of options and resolved names', async () => {
      const {ctxMock} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        communityNamesById: {[communityA]: {name: 'Alpha Crew'}},
        pendingIds: [communityB],
      });

      // Only the resolved community is published; the still-loading one must
      // not surface as an 'Unknown' placeholder in the shared context (it
      // feeds selectedCommunityName() and the header label).
      const published = ctxMock.setResolvedNames.mock.lastCall?.[0] as Map<
        string,
        string
      >;
      expect(published.get(communityA)).toBe('Alpha Crew');
      expect(published.has(communityB)).toBe(false);
      expect([...published.values()]).not.toContain('Unknown');
    });

    it('calls selectCommunity on dropdown change', async () => {
      const {harness, ctxMock} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        communityNamesById: {
          [communityA]: {name: 'Alpha Crew'},
          [communityB]: {name: 'Beta Squad'},
        },
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
        communityNamesById: {
          [communityA]: {name: 'Puppy Pilled'},
          [communityB]: {name: 'Braket'},
        },
      });

      expect(await harness.getSelectedValue()).toBe(communityB);
    });

    it('navigates with the selected community slug when the user switches communities', async () => {
      const {fixture, harness, activatedRouteStub} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        communityNamesById: {
          [communityA]: {name: 'Alpha Crew', slug: 'alpha-crew'},
          [communityB]: {name: 'Beta Squad', slug: 'beta-squad'},
        },
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

    it('renders a set default action for multi-community admins', async () => {
      const {harness} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        communityNamesById: {
          [communityA]: {name: 'Alpha Crew', slug: 'alpha-crew'},
          [communityB]: {name: 'Beta Squad', slug: 'beta-squad'},
        },
      });

      expect(await harness.hasSetDefaultButton()).toBe(true);
      expect(await harness.getSetDefaultButtonText()).toContain('Set default');
      expect(await harness.isSetDefaultButtonDisabled()).toBe(false);
    });

    it('uses an opaque semantic button treatment with accessible dark-mode contrast', async () => {
      const {harness} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        isSelectedDefault: true,
      });

      expect(await harness.getSetDefaultButtonVariant()).toBe('secondary');
      const classes = await harness.getSetDefaultButtonClasses();
      expect(classes).toContain('bg-secondary');
      expect(classes).toContain('text-secondary-foreground');
      expect(classes).not.toContain('dark:bg-input/30');
      expect(classes).not.toContain('text-muted-foreground');
    });

    it('saves the selected community as the default', async () => {
      const {fixture, harness, defaultServiceMock} = await setup({
        communities: [communityA, communityB],
        selectedId: communityB,
        selectedName: null,
        hasMultiple: true,
        communityNamesById: {
          [communityA]: {name: 'Alpha Crew', slug: 'alpha-crew'},
          [communityB]: {name: 'Beta Squad', slug: 'beta-squad'},
        },
      });

      await harness.clickSetDefaultButton();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(defaultServiceMock.setDefaultCommunity).toHaveBeenCalledWith(
        communityB,
      );
    });

    it('shows the current community as default when it already matches', async () => {
      const {harness} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        isSelectedDefault: true,
      });

      expect(await harness.getSetDefaultButtonText()).toContain('Default');
      expect(await harness.isSetDefaultButtonDisabled()).toBe(true);
    });

    it('renders the default preference action for root admins with multiple platform communities', async () => {
      const {harness} = await setup({
        communities: [communityA, communityB],
        selectedId: communityA,
        selectedName: null,
        hasMultiple: true,
        userRole: 'root_admin',
      });

      expect(await harness.hasSetDefaultButton()).toBe(true);
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
        userRole: 'root_admin',
      });

      expect(await harness.isDropdownVisible()).toBe(false);
      expect(await harness.isStaticNameVisible()).toBe(true);
      expect(await harness.getStaticNameText()).toBe('Sister City');
      expect(await harness.hasSetDefaultButton()).toBe(false);
    });

    it('does not render the dropdown even when the user administers multiple communities', async () => {
      const {harness} = await setup({
        communities: [userCommunityA, userCommunityB],
        selectedId: overrideCommunity,
        selectedName: 'Sister City',
        hasMultiple: true,
        isAdminOverride: true,
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
