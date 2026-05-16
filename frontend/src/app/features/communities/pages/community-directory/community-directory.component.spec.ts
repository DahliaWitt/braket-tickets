import '../../../../../test-setup';
import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {manualChangeDetection} from '@angular/cdk/testing';
import {CommunityDirectoryComponent} from './community-directory.component';
import {CommunityDirectoryComponentHarness} from './community-directory.component.harness';
import {AuthService} from '@/core/services/auth.service';
import {PublicCommunitiesService} from '@/core/services/public-communities.service';
import {CONVEX} from 'convex-angular';
import {provideRouter} from '@angular/router';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockCommunities = [
  {
    _id: 'c1',
    name: 'Test Community',
    description: 'A test community',
    slug: 'test-community',
    website: 'https://test.com',
    logoUrl: null,
    status: 'published',
  },
  {
    _id: 'c2',
    name: 'Another Community',
    description: null,
    slug: 'another',
    website: null,
    logoUrl: 'https://logo.example.com/logo.png',
    status: 'published',
  },
];

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

/**
 * The community directory component calls injectQuery in this order:
 *   1. list               (authenticated only)
 *   2. getUserApprovals   (authenticated only)
 *   3. getMyApplications  (authenticated only)
 */
function createConvexMock(options: {
  communities?: unknown[];
  approvals?: unknown[];
  applications?: unknown[];
  listError?: Error | null;
}): MockConvexClient {
  const {
    communities = [],
    approvals = [],
    applications = [],
    listError = null,
  } = options;
  let callIndex = 0;
  const convexMock = createMockConvexClient();
  const onUpdate = vi
    .fn()
    .mockImplementation(
      (
        _query: unknown,
        _args: unknown,
        onData: (data: unknown) => void,
        onError?: (error: Error) => void,
      ) => {
        const idx = callIndex++;
        if (idx === 0) {
          if (listError) {
            onError?.(listError);
          } else {
            onData(communities);
          }
        } else if (idx === 1) {
          onData(approvals);
        } else {
          onData(applications);
        }
        return () => void 0;
      },
    );

  convexMock.onUpdate = onUpdate;
  convexMock.client.onUpdate = onUpdate;
  convexMock.mutation = vi.fn().mockResolvedValue(null);

  return convexMock;
}

// ---------------------------------------------------------------------------
// Auth mock
// ---------------------------------------------------------------------------

const isAuthenticatedSignal = signal(false);

const authServiceMock = {
  isAuthenticated: isAuthenticatedSignal,
};

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

async function setup(
  options: {
    communities?: unknown[];
    approvals?: unknown[];
    applications?: unknown[];
    isAuthenticated?: boolean;
  } = {},
) {
  const {
    communities = [],
    approvals = [],
    applications = [],
    isAuthenticated = false,
  } = options;

  isAuthenticatedSignal.set(isAuthenticated);

  const convexMock = createConvexMock({communities, approvals, applications});
  const publicCommunitiesServiceMock = {
    listDirectory: vi.fn().mockResolvedValue(communities),
    getBySlug: vi.fn().mockResolvedValue(null),
  };

  await TestBed.configureTestingModule({
    imports: [CommunityDirectoryComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {provide: AuthService, useValue: authServiceMock},
      {
        provide: PublicCommunitiesService,
        useValue: publicCommunitiesServiceMock,
      },
      {provide: CONVEX, useValue: convexMock},
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CommunityDirectoryComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    CommunityDirectoryComponentHarness,
  );

  return {fixture, harness};
}

async function setupError(
  options: {
    listDirectoryMock?: ReturnType<typeof vi.fn>;
  } = {},
) {
  isAuthenticatedSignal.set(false);

  const convexMock = createConvexMock({});
  const listDirectoryMock =
    options.listDirectoryMock ??
    vi.fn().mockRejectedValue(new Error('directory request failed'));
  const publicCommunitiesServiceMock = {
    listDirectory: listDirectoryMock,
    getBySlug: vi.fn().mockResolvedValue(null),
  };

  await TestBed.configureTestingModule({
    imports: [CommunityDirectoryComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {provide: AuthService, useValue: authServiceMock},
      {
        provide: PublicCommunitiesService,
        useValue: publicCommunitiesServiceMock,
      },
      {provide: CONVEX, useValue: convexMock},
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CommunityDirectoryComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    CommunityDirectoryComponentHarness,
  );

  return {fixture, harness, listDirectoryMock};
}

async function setupAuthenticatedError() {
  isAuthenticatedSignal.set(true);

  const convexMock = createConvexMock({
    listError: new Error('authenticated directory query failed'),
  });
  const publicCommunitiesServiceMock = {
    listDirectory: vi.fn().mockResolvedValue([]),
    getBySlug: vi.fn().mockResolvedValue(null),
  };

  await TestBed.configureTestingModule({
    imports: [CommunityDirectoryComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {provide: AuthService, useValue: authServiceMock},
      {
        provide: PublicCommunitiesService,
        useValue: publicCommunitiesServiceMock,
      },
      {provide: CONVEX, useValue: convexMock},
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CommunityDirectoryComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    CommunityDirectoryComponentHarness,
  );

  return {fixture, harness};
}

// ---------------------------------------------------------------------------
// Loading-state setup helper
// ---------------------------------------------------------------------------

async function setupLoading(
  options: {isAuthenticated: boolean} = {isAuthenticated: false},
) {
  isAuthenticatedSignal.set(options.isAuthenticated);

  // For authenticated path: Convex onUpdate never calls onData → query stays loading
  const convexMock = createMockConvexClient();
  convexMock.onUpdate = vi.fn().mockImplementation(() => () => void 0); // no onData call
  convexMock.client.onUpdate = convexMock.onUpdate;

  // For unauthenticated path: resource loader never resolves
  const publicCommunitiesServiceMock = {
    listDirectory: vi.fn().mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    ),
    getBySlug: vi.fn().mockResolvedValue(null),
  };

  await TestBed.configureTestingModule({
    imports: [CommunityDirectoryComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {provide: AuthService, useValue: authServiceMock},
      {
        provide: PublicCommunitiesService,
        useValue: publicCommunitiesServiceMock,
      },
      {provide: CONVEX, useValue: convexMock},
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CommunityDirectoryComponent);
  fixture.detectChanges();

  // The resource loader never resolves, so Angular keeps a PendingTask open —
  // whenStable() would hang. Use manualChangeDetection in each test to bypass
  // stabilization when querying the DOM.
  return {fixture};
}

async function setupRelationshipLoading() {
  isAuthenticatedSignal.set(true);

  let callIndex = 0;
  const convexMock = createMockConvexClient();
  const onUpdate = vi
    .fn()
    .mockImplementation(
      (_query: unknown, _args: unknown, onData: (data: unknown) => void) => {
        if (callIndex++ === 0) {
          onData(mockCommunities);
        }
        return () => void 0;
      },
    );

  convexMock.onUpdate = onUpdate;
  convexMock.client.onUpdate = onUpdate;

  const publicCommunitiesServiceMock = {
    listDirectory: vi.fn().mockResolvedValue(mockCommunities),
    getBySlug: vi.fn().mockResolvedValue(null),
  };

  await TestBed.configureTestingModule({
    imports: [CommunityDirectoryComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {provide: AuthService, useValue: authServiceMock},
      {
        provide: PublicCommunitiesService,
        useValue: publicCommunitiesServiceMock,
      },
      {provide: CONVEX, useValue: convexMock},
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CommunityDirectoryComponent);
  fixture.detectChanges();

  return {fixture};
}

async function setupRelationshipError() {
  isAuthenticatedSignal.set(true);

  let callIndex = 0;
  const convexMock = createMockConvexClient();
  const relationshipError = new Error('relationship failed');
  const onUpdate = vi
    .fn()
    .mockImplementation(
      (
        _query: unknown,
        _args: unknown,
        onData: (data: unknown) => void,
        onError?: (error: Error) => void,
      ) => {
        const idx = callIndex++;
        if (idx === 0) {
          onData(mockCommunities);
        } else {
          onError?.(relationshipError);
        }
        return () => void 0;
      },
    );

  convexMock.onUpdate = onUpdate;
  convexMock.client.onUpdate = onUpdate;

  const publicCommunitiesServiceMock = {
    listDirectory: vi.fn().mockResolvedValue(mockCommunities),
    getBySlug: vi.fn().mockResolvedValue(null),
  };

  await TestBed.configureTestingModule({
    imports: [CommunityDirectoryComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {provide: AuthService, useValue: authServiceMock},
      {
        provide: PublicCommunitiesService,
        useValue: publicCommunitiesServiceMock,
      },
      {provide: CONVEX, useValue: convexMock},
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CommunityDirectoryComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    CommunityDirectoryComponentHarness,
  );

  return {fixture, harness};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommunityDirectoryComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it('should create', async () => {
    const {fixture} = await setup();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should display heading', async () => {
    const {harness} = await setup();
    const heading = await harness.getHeading();
    expect(await heading.text()).toContain('Community Directory');
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------
  describe('with no communities', () => {
    it('should show empty state', async () => {
      const {harness} = await setup({communities: []});
      const emptyState = await harness.getEmptyState();
      expect(emptyState).toBeTruthy();
    });

    it('should not show community list', async () => {
      const {harness} = await setup({communities: []});
      const list = await harness.getCommunityList();
      expect(list).toBeNull();
    });

    it('should not show empty state when the unauthenticated directory request fails', async () => {
      const {harness} = await setupError();
      const emptyState = await harness.getEmptyState();
      expect(emptyState).toBeNull();
    });

    it('should not show empty state when the authenticated directory query fails', async () => {
      const {harness} = await setupAuthenticatedError();
      const emptyState = await harness.getEmptyState();
      expect(emptyState).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Community cards
  // -------------------------------------------------------------------------
  describe('with communities', () => {
    it('should render community cards', async () => {
      const {harness} = await setup({communities: mockCommunities});
      const cards = await harness.getCommunityCards();
      expect(cards.length).toBe(2);
    });

    it('should display community names', async () => {
      const {harness} = await setup({communities: mockCommunities});
      const cards = await harness.getCommunityCards();
      expect(await cards[0].text()).toContain('Test Community');
      expect(await cards[1].text()).toContain('Another Community');
    });

    it('should not show empty state', async () => {
      const {harness} = await setup({communities: mockCommunities});
      const emptyState = await harness.getEmptyState();
      expect(emptyState).toBeNull();
    });

    it('should show community list container', async () => {
      const {harness} = await setup({communities: mockCommunities});
      const list = await harness.getCommunityList();
      expect(list).toBeTruthy();
    });

    it('should render fallback description copy when a community description is missing', async () => {
      const {harness} = await setup({communities: mockCommunities});
      const fallbackDescriptions =
        await harness.getCommunityDescriptionFallbacks();
      expect(fallbackDescriptions.length).toBe(1);
      expect(await fallbackDescriptions[0].text()).toContain(
        'Profile coming soon.',
      );
    });

    it('should preserve the authored community description when present', async () => {
      const {harness} = await setup({communities: mockCommunities});
      const descriptions = await harness.getCommunityDescriptions();
      expect(descriptions.length).toBe(1);
      expect(await descriptions[0].text()).toContain('A test community');
    });
  });

  // -------------------------------------------------------------------------
  // Unauthenticated users
  // -------------------------------------------------------------------------
  describe('unauthenticated users', () => {
    it('should show "View Events" links (not Apply buttons)', async () => {
      const {harness} = await setup({
        communities: mockCommunities,
        isAuthenticated: false,
      });
      const viewEventsLinks = await harness.getViewEventsLinks();
      const applyButtons = await harness.getApplyButtons();
      expect(viewEventsLinks.length).toBe(2);
      expect(applyButtons.length).toBe(0);
    });

    it('should not show status badges when unauthenticated', async () => {
      const {harness} = await setup({
        communities: mockCommunities,
        isAuthenticated: false,
      });
      const accessBadge = await harness.getStatusBadge('status-access');
      const pendingBadge = await harness.getStatusBadge('status-pending');
      const rejectedBadge = await harness.getStatusBadge('status-rejected');
      expect(accessBadge).toBeNull();
      expect(pendingBadge).toBeNull();
      expect(rejectedBadge).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Authenticated users with no relationship
  // -------------------------------------------------------------------------
  describe('authenticated users with no relationship', () => {
    it('should show both "View Events" and "Apply" for each community', async () => {
      const {harness} = await setup({
        communities: mockCommunities,
        isAuthenticated: true,
        approvals: [],
        applications: [],
      });
      const applyButtons = await harness.getApplyButtons();
      const viewEventsLinks = await harness.getViewEventsLinks();
      expect(applyButtons.length).toBe(2);
      expect(viewEventsLinks.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Status badges
  // -------------------------------------------------------------------------
  describe('status badges', () => {
    it('blocks relationship CTA rendering until approvals and applications settle', async () => {
      const {fixture} = await setupRelationshipLoading();
      await manualChangeDetection(async () => {
        const harness = await TestbedHarnessEnvironment.harnessForFixture(
          fixture,
          CommunityDirectoryComponentHarness,
        );

        expect(await harness.getCommunityCards()).toHaveLength(2);
        expect(await harness.getApplyButtons()).toHaveLength(0);
        expect(await harness.getRelationshipSkeletons()).toHaveLength(2);
        expect(await harness.getStatusBadge('status-access')).toBeNull();
        expect(await harness.getStatusBadge('status-pending')).toBeNull();
        expect(await harness.getStatusBadge('status-rejected')).toBeNull();
      });
    });

    it('fails closed when relationship queries error', async () => {
      const {harness} = await setupRelationshipError();

      expect(await harness.getCommunityCards()).toHaveLength(2);
      expect(await harness.getApplyButtons()).toHaveLength(0);
      expect(await harness.getRelationshipErrorBadges()).toHaveLength(2);
      expect(await harness.getStatusBadge('status-access')).toBeNull();
      expect(await harness.getStatusBadge('status-pending')).toBeNull();
      expect(await harness.getStatusBadge('status-rejected')).toBeNull();
    });

    it('should show "Access" badge when user has an approval for a community', async () => {
      const {harness} = await setup({
        communities: mockCommunities,
        isAuthenticated: true,
        approvals: [
          {
            organizerId: 'c1',
            organizerName: 'Test Community',
            source: 'direct',
          },
        ],
        applications: [],
      });
      const badge = await harness.getStatusBadge('status-access');
      expect(badge).toBeTruthy();
    });

    it('should show "Pending" badge when user has a pending application', async () => {
      const {harness} = await setup({
        communities: mockCommunities,
        isAuthenticated: true,
        approvals: [],
        applications: [
          {
            _id: 'app-1',
            _creationTime: 100,
            organizerId: 'c1',
            organizerName: 'Test Community',
            status: 'pending',
          },
        ],
      });
      const badge = await harness.getStatusBadge('status-pending');
      expect(badge).toBeTruthy();
    });

    it('should show "Rejected" badge when user has a rejected application', async () => {
      const {harness} = await setup({
        communities: mockCommunities,
        isAuthenticated: true,
        approvals: [],
        applications: [
          {
            _id: 'app-2',
            _creationTime: 100,
            organizerId: 'c1',
            organizerName: 'Test Community',
            status: 'rejected',
          },
        ],
      });
      const badge = await harness.getStatusBadge('status-rejected');
      expect(badge).toBeTruthy();
    });

    it('shows a revise CTA for rejected applications when the community is published', async () => {
      const {harness} = await setup({
        communities: mockCommunities,
        isAuthenticated: true,
        approvals: [],
        applications: [
          {
            _id: 'app-2',
            _creationTime: 100,
            organizerId: 'c1',
            organizerName: 'Test Community',
            status: 'rejected',
          },
        ],
      });

      const reviseLinks = await harness.getReviseLinks();
      expect(reviseLinks.length).toBe(1);
      expect(await reviseLinks[0].text()).toContain('Revise');
      expect(await reviseLinks[0].getAttribute('href')).toBe(
        '/vetting/test-community',
      );
    });

    it('does not show a revise CTA for rejected applications when the community is unpublished', async () => {
      const {harness} = await setup({
        communities: [
          {
            ...mockCommunities[0],
            status: 'draft',
          },
        ],
        isAuthenticated: true,
        approvals: [],
        applications: [
          {
            _id: 'app-2',
            _creationTime: 100,
            organizerId: 'c1',
            organizerName: 'Test Community',
            status: 'rejected',
          },
        ],
      });

      expect(await harness.getStatusBadge('status-rejected')).toBeTruthy();
      expect(await harness.getReviseLinks()).toHaveLength(0);
    });

    it('does not show a revise CTA for revoked applications', async () => {
      const {harness} = await setup({
        communities: mockCommunities,
        isAuthenticated: true,
        approvals: [],
        applications: [
          {
            _id: 'app-revoked',
            _creationTime: 100,
            organizerId: 'c1',
            organizerName: 'Test Community',
            status: 'revoked',
          },
        ],
      });

      expect(await harness.getStatusBadge('status-rejected')).toBeTruthy();
      expect(await harness.getReviseLinks()).toHaveLength(0);
    });

    it('should handle mixed statuses across communities', async () => {
      const {harness} = await setup({
        communities: mockCommunities,
        isAuthenticated: true,
        approvals: [
          {
            organizerId: 'c1',
            organizerName: 'Test Community',
            source: 'direct',
          },
        ],
        applications: [
          {
            _id: 'app-1',
            _creationTime: 100,
            organizerId: 'c2',
            organizerName: 'Another Community',
            status: 'pending',
          },
        ],
      });
      const accessBadge = await harness.getStatusBadge('status-access');
      const pendingBadge = await harness.getStatusBadge('status-pending');
      expect(accessBadge).toBeTruthy();
      expect(pendingBadge).toBeTruthy();
    });

    it('should show "Apply" for community with no relationship even when other communities have status', async () => {
      const {harness} = await setup({
        communities: mockCommunities,
        isAuthenticated: true,
        // c1 has access, c2 has no relationship — should show Apply for c2
        approvals: [
          {
            organizerId: 'c1',
            organizerName: 'Test Community',
            source: 'direct',
          },
        ],
        applications: [],
      });
      const applyButtons = await harness.getApplyButtons();
      expect(applyButtons.length).toBe(1);
    });

    it('should show "Pending" badge after re-submission (newest pending overrides older rejected)', async () => {
      // getMyApplications returns newest first; pending app created after the rejected one
      const {harness} = await setup({
        communities: mockCommunities,
        isAuthenticated: true,
        approvals: [],
        applications: [
          {
            _id: 'app-pending',
            _creationTime: 200,
            organizerId: 'c1',
            organizerName: 'Test Community',
            status: 'pending',
          },
          {
            _id: 'app-rejected',
            _creationTime: 100,
            organizerId: 'c1',
            organizerName: 'Test Community',
            status: 'rejected',
          },
        ],
      });
      const pendingBadge = await harness.getStatusBadge('status-pending');
      const rejectedBadge = await harness.getStatusBadge('status-rejected');
      expect(pendingBadge).toBeTruthy();
      expect(rejectedBadge).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Clickable card links (BRA-290)
  // -------------------------------------------------------------------------
  describe('card clickable links', () => {
    it('should render a name link for each community', async () => {
      const {harness} = await setup({communities: mockCommunities});
      const nameLinks = await harness.getCommunityNameLinks();
      expect(nameLinks.length).toBe(2);
    });

    it('should render a linked logo slot for each community card', async () => {
      const {harness} = await setup({communities: mockCommunities});
      const logoSlots = await harness.getCommunityLogoSlots();
      expect(logoSlots.length).toBe(2);
    });

    it('should render fallback logo tiles when a community logo is missing', async () => {
      const {harness} = await setup({communities: mockCommunities});
      const fallbackLogos = await harness.getCommunityLogoFallbacks();
      expect(fallbackLogos.length).toBe(1);
      expect(await fallbackLogos[0].getInitialText()).toContain('T');
    });

    it('should still render uploaded community logos when available', async () => {
      const {harness} = await setup({communities: mockCommunities});
      const logoImages = await harness.getCommunityLogoImages();
      expect(logoImages.length).toBe(1);
    });

    it('community name links should contain the community name', async () => {
      const {harness} = await setup({communities: mockCommunities});
      const nameLinks = await harness.getCommunityNameLinks();
      expect(await nameLinks[0].text()).toContain('Test Community');
      expect(await nameLinks[1].text()).toContain('Another Community');
    });
  });

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------
  describe('layout', () => {
    it('should include content layout', async () => {
      const {fixture} = await setup();
      const contentLayout = (
        fixture.nativeElement as HTMLElement
      ).querySelector('app-content-layout');
      expect(contentLayout).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  describe('loading state', () => {
    // Angular resource() holds a PendingTask open while loading, so
    // whenStable() (called internally by harnessForFixture and every harness
    // method) would hang indefinitely. Wrap assertions in manualChangeDetection
    // to bypass stabilization and query the already-rendered DOM directly.

    it('should show skeleton cards while loading (unauthenticated)', async () => {
      const {fixture} = await setupLoading({isAuthenticated: false});
      await manualChangeDetection(async () => {
        const harness = await TestbedHarnessEnvironment.harnessForFixture(
          fixture,
          CommunityDirectoryComponentHarness,
        );
        expect(await harness.isShowingSkeleton()).toBe(true);
        const skeletonCards = await harness.getSkeletonCards();
        expect(skeletonCards.length).toBe(6);
      });
    });

    it('should show skeleton cards while loading (authenticated)', async () => {
      const {fixture} = await setupLoading({isAuthenticated: true});
      await manualChangeDetection(async () => {
        const harness = await TestbedHarnessEnvironment.harnessForFixture(
          fixture,
          CommunityDirectoryComponentHarness,
        );
        expect(await harness.isShowingSkeleton()).toBe(true);
      });
    });

    it('should hide skeleton after data loads', async () => {
      const {harness} = await setup({communities: mockCommunities});
      expect(await harness.isShowingSkeleton()).toBe(false);
    });

    it('should not show empty state while loading', async () => {
      const {fixture} = await setupLoading({isAuthenticated: false});
      await manualChangeDetection(async () => {
        const harness = await TestbedHarnessEnvironment.harnessForFixture(
          fixture,
          CommunityDirectoryComponentHarness,
        );
        const emptyState = await harness.getEmptyState();
        expect(emptyState).toBeNull();
      });
    });
  });

  describe('error state', () => {
    it('shows an explicit error state when the unauthenticated directory request fails', async () => {
      const {harness} = await setupError();
      const errorState = await harness.getErrorState();
      expect(errorState).toBeTruthy();
      expect(await errorState?.text()).toContain('Directory unavailable');
    });

    it('shows a retry action when the unauthenticated directory request fails', async () => {
      const {harness} = await setupError();
      const retryButton = await harness.getRetryButton();
      expect(retryButton).toBeTruthy();
      expect(await retryButton?.text()).toContain('Try Again');
    });

    it('retries the directory request from the error state', async () => {
      const listDirectoryMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('directory request failed'))
        .mockResolvedValueOnce(mockCommunities);
      const {fixture, harness} = await setupError({listDirectoryMock});

      const retryButton = await harness.getRetryButton();
      expect(retryButton).toBeTruthy();

      await retryButton?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const cards = await harness.getCommunityCards();
      expect(cards.length).toBe(2);
      expect(listDirectoryMock).toHaveBeenCalledTimes(2);
    });

    it('shows an explicit error state when the authenticated directory query fails', async () => {
      const {harness} = await setupAuthenticatedError();
      const errorState = await harness.getErrorState();
      expect(errorState).toBeTruthy();
      expect(await errorState?.text()).toContain('Directory unavailable');
    });

    it('refetches the authenticated directory queries when retrying a signed-in failure', async () => {
      const {fixture, harness} = await setupAuthenticatedError();
      const component = fixture.componentInstance as unknown as {
        allCommunitiesQuery: {refetch: () => void};
        approvalsQuery: {refetch: () => void};
        myApplicationsQuery: {refetch: () => void};
      };
      const allCommunitiesRefetch = vi.spyOn(
        component.allCommunitiesQuery,
        'refetch',
      );
      const approvalsRefetch = vi.spyOn(component.approvalsQuery, 'refetch');
      const applicationsRefetch = vi.spyOn(
        component.myApplicationsQuery,
        'refetch',
      );
      const retryButton = await harness.getRetryButton();
      expect(retryButton).toBeTruthy();

      await retryButton?.click();

      expect(allCommunitiesRefetch).toHaveBeenCalledTimes(1);
      expect(approvalsRefetch).toHaveBeenCalledTimes(1);
      expect(applicationsRefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('BRA-398: pending status beats rejected for same organizer', () => {
    it('shows pending badge when user has both pending (newer) and rejected (older) applications', async () => {
      const orgId = 'org-bra398';
      const community = {
        _id: orgId,
        name: 'BRA398 Community',
        slug: 'bra398',
        description: null,
        logoUrl: null,
      };
      // Newest-first: pending is first (newer), rejected is second (older)
      const applications = [
        {
          _id: 'app-1',
          organizerId: orgId,
          status: 'pending',
          _creationTime: Date.now() + 1000,
        },
        {
          _id: 'app-2',
          organizerId: orgId,
          status: 'rejected',
          _creationTime: Date.now(),
        },
      ];

      const {harness} = await setup({
        communities: [community],
        applications,
        approvals: [],
        isAuthenticated: true,
      });

      const pendingBadge = await harness.getStatusBadge('status-pending');
      expect(pendingBadge).not.toBeNull();
      const rejectedBadge = await harness.getStatusBadge('status-rejected');
      expect(rejectedBadge).toBeNull();
    });
  });

  describe('BRA-399: card renders for org surfaced only via applied-for community', () => {
    it('renders community card for org returned only because user has a pending application', async () => {
      const orgId = 'org-bra399';
      // Community returned by api.communities.list.list because of backend BRA-399 fix
      const community = {
        _id: orgId,
        name: 'BRA399 Community',
        slug: 'bra399',
        description: null,
        logoUrl: null,
      };
      const applications = [
        {
          _id: 'app-3',
          organizerId: orgId,
          status: 'pending',
          _creationTime: Date.now(),
        },
      ];

      const {harness} = await setup({
        communities: [community],
        applications,
        approvals: [],
        isAuthenticated: true,
      });

      const cards = await harness.getCommunityCards();
      expect(cards.length).toBe(1);
      const pendingBadge = await harness.getStatusBadge('status-pending');
      expect(pendingBadge).not.toBeNull();
    });
  });
});
