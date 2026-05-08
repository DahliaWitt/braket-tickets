import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {CONVEX} from 'convex-angular';
import {beforeEach, describe, expect, it, vi, type Mock} from 'vitest';
import {type Id} from '@convex/_generated/dataModel';
import {
  PublicCommunitiesService,
  type PublicCommunity,
} from '@/core/services/public-communities.service';
import {createMockConvexClient} from '@/testing/mock-types';
import {DashboardPageDataService} from './dashboard-page-data.service';

describe('DashboardPageDataService', () => {
  let service: DashboardPageDataService;
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

  beforeEach(() => {
    publicCommunitiesServiceMock = {
      listDirectory: vi.fn().mockResolvedValue(mockPublicCommunities),
    };

    const convexMock = createMockConvexClient();
    let queryIndex = 0;
    const onUpdate = vi.fn(
      (_query: unknown, _args: unknown, onData: (data: unknown) => void) => {
        const current = queryIndex++;
        onData(current === 0 ? mockApprovals : mockApplications);
        return () => void 0;
      },
    );
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

    service = TestBed.inject(DashboardPageDataService);
  });

  it('exposes dashboard-scoped realtime and public directory data', async () => {
    TestBed.tick();

    await vi.waitFor(() => {
      expect(service.approvals()).toEqual(mockApprovals);
      expect(service.myApplications()).toEqual(mockApplications);
      expect(service.publicCommunities()).toEqual(mockPublicCommunities);
    });
  });
});
