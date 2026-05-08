import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VettingTrustLinksService } from '@/features/admin/services/vetting-trust-links.service';
import { CONVEX } from 'convex-angular';
import { AnalyticsService } from '@/core/services/analytics.service';
import { createMockConvexClient, type MockConvexClient } from '../../../../testing/mock-types';
import { api } from '@convex/_generated/api';
import { type Id } from '@convex/_generated/dataModel';

describe('VettingTrustLinksService', () => {
  let service: VettingTrustLinksService;
  let convexMock: MockConvexClient;
  let analyticsMock: { capture: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    convexMock = createMockConvexClient();
    analyticsMock = { capture: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        VettingTrustLinksService,
        { provide: CONVEX, useValue: convexMock },
        { provide: AnalyticsService, useValue: analyticsMock },
      ],
    });
    service = TestBed.inject(VettingTrustLinksService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('create', () => {
    it('should call mutation and track trust_link_created', async () => {
      convexMock.client.mutation.mockResolvedValue(null);

      const trustingId = 'org-a' as Id<'organizers'>;
      const trustedId = 'org-b' as Id<'organizers'>;

      await service.create(trustingId, trustedId);

      expect(convexMock.client.mutation).toHaveBeenCalledWith(api.communities.trust_links.create, {
        trustingOrganizerId: trustingId,
        trustedOrganizerId: trustedId,
      });
      expect(analyticsMock.capture).toHaveBeenCalledWith('trust_link_created', {
        trustingOrganizerId: trustingId,
        trustedOrganizerId: trustedId,
      });
    });

    it('should not track analytics if mutation throws', async () => {
      convexMock.client.mutation.mockRejectedValue(new Error('Duplicate'));

      await expect(
        service.create('org-a' as Id<'organizers'>, 'org-b' as Id<'organizers'>),
      ).rejects.toThrow('Duplicate');

      expect(analyticsMock.capture).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should call mutation and track trust_link_removed', async () => {
      convexMock.client.mutation.mockResolvedValue(null);
      const trustingId = 'org-a' as Id<'organizers'>;
      const trustedId = 'org-b' as Id<'organizers'>;

      await service.remove(trustingId, trustedId);

      expect(convexMock.client.mutation).toHaveBeenCalledWith(api.communities.trust_links.remove, {
        trustingOrganizerId: trustingId,
        trustedOrganizerId: trustedId,
      });
      expect(analyticsMock.capture).toHaveBeenCalledWith('trust_link_removed', {
        trustingOrganizerId: trustingId,
        trustedOrganizerId: trustedId,
      });
    });
  });
});
