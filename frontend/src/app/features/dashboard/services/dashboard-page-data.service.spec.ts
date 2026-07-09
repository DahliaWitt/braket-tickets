import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {CONVEX} from 'convex-angular';
import {beforeEach, describe, expect, it, vi, type Mock} from 'vitest';
import {type Id} from '@convex/_generated/dataModel';
import {api} from '@convex/_generated/api';
import {
  PublicCommunitiesService,
  type PublicCommunity,
} from '@/core/services/public-communities.service';
import {createMockConvexClient} from '@/testing/mock-types';
import {functionReferenceMatches} from '@/testing/convex-reference-matchers';
import {DashboardPageDataService} from './dashboard-page-data.service';

describe('DashboardPageDataService', () => {
  let publicCommunitiesServiceMock: {
    listDirectory: Mock;
  };

  const mockApprovals = [
    {
      organizerId: 'org-1' as Id<'organizers'>,
      organizerName: 'Test Community',
      source: 'direct' as const,
    },
  ];

  const mockApplications = [
    {
      _id: 'community-app-1',
      _creationTime: Date.now(),
      organizerId: 'org-2',
      organizerName: 'Pending Community',
      status: 'pending' as const,
    },
  ];

  const mockPublicCommunities: PublicCommunity[] = [
    {
      _id: 'org-public' as Id<'organizers'>,
      name: 'Public Community',
      slug: 'public-community',
      status: 'published',
    },
  ];

  // Builds a fresh TestBed module wired to the given onUpdate implementation so
  // each test controls Convex emission timing independently.
  function createService(onUpdate: Mock): DashboardPageDataService {
    TestBed.resetTestingModule();

    const convexMock = createMockConvexClient();
    convexMock.onUpdate = onUpdate;
    convexMock.client.onUpdate = onUpdate;

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        DashboardPageDataService,
        {
          provide: PublicCommunitiesService,
          useValue: publicCommunitiesServiceMock,
        },
        {provide: CONVEX, useValue: convexMock},
      ],
    });

    return TestBed.inject(DashboardPageDataService);
  }

  beforeEach(() => {
    publicCommunitiesServiceMock = {
      listDirectory: vi.fn().mockResolvedValue(mockPublicCommunities),
    };
  });

  it('exposes dashboard-scoped realtime and public directory data', async () => {
    // Emit asynchronously to mirror the real Convex client: injectQueries
    // registers the active subscription only after onUpdate returns, and its
    // settle guard drops any emission that arrives before that. A synchronous
    // settle here would be silently discarded. Key off the function reference
    // by name — the generated `api` proxy mints a fresh object per access, so
    // identity (`===`) never matches across the service/spec boundary.
    const onUpdate = vi.fn(
      (query: unknown, _args: unknown, settle: (data: unknown) => void) => {
        if (
          functionReferenceMatches(
            query,
            api.communities.trust_links.getUserApprovals,
          )
        ) {
          queueMicrotask(() => settle(mockApprovals));
        } else if (
          functionReferenceMatches(
            query,
            api.communities.applications.getMyApplications,
          )
        ) {
          queueMicrotask(() => settle(mockApplications));
        }
        return () => void 0;
      },
    );

    const service = createService(onUpdate);
    TestBed.tick();

    await vi.waitFor(() => {
      expect(service.approvals()).toEqual(mockApprovals);
      expect(service.myApplications()).toEqual(mockApplications);
      expect(service.publicCommunities()).toEqual(mockPublicCommunities);
      expect(service.approvalsLoading()).toBe(false);
      expect(service.myApplicationsLoading()).toBe(false);
    });
  });

  it('reports per-query loading until each query settles', () => {
    // Defer emission: store each key's settle callback and fire them manually so
    // the pending -> success transition is observable one query at a time. Key
    // the store by function name for the same proxy-identity reason as above.
    const settlers = new Map<string, (data: unknown) => void>();
    const deferredOnUpdate = vi.fn(
      (query: unknown, _args: unknown, settle: (data: unknown) => void) => {
        if (
          functionReferenceMatches(
            query,
            api.communities.trust_links.getUserApprovals,
          )
        ) {
          settlers.set('approvals', settle);
        } else if (
          functionReferenceMatches(
            query,
            api.communities.applications.getMyApplications,
          )
        ) {
          settlers.set('myApplications', settle);
        }
        return () => void 0;
      },
    );

    const service = createService(deferredOnUpdate);
    TestBed.tick();

    // Before any emission both keys are 'pending'.
    expect(service.approvalsLoading()).toBe(true);
    expect(service.myApplicationsLoading()).toBe(true);

    // Settle approvals only.
    settlers.get('approvals')?.(mockApprovals);
    TestBed.tick();
    expect(service.approvalsLoading()).toBe(false);
    expect(service.myApplicationsLoading()).toBe(true);
    expect(service.approvals()).toEqual(mockApprovals);

    // Settle applications.
    settlers.get('myApplications')?.(mockApplications);
    TestBed.tick();
    expect(service.myApplicationsLoading()).toBe(false);
    expect(service.myApplications()).toEqual(mockApplications);
  });
});
