import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {describe, it, expect, beforeEach} from 'vitest';
import {VettingTrustLinksService} from '@/features/admin/services/vetting-trust-links.service';
import {CONVEX} from 'convex-angular';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../../testing/mock-types';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';

describe('VettingTrustLinksService', () => {
  let service: VettingTrustLinksService;
  let convexMock: MockConvexClient;

  beforeEach(() => {
    convexMock = createMockConvexClient();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        VettingTrustLinksService,
        {provide: CONVEX, useValue: convexMock},
      ],
    });
    service = TestBed.inject(VettingTrustLinksService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('create', () => {
    it('should call mutation', async () => {
      convexMock.client.mutation.mockResolvedValue(null);

      const trustingId = 'org-a' as Id<'organizers'>;
      const trustedId = 'org-b' as Id<'organizers'>;

      await service.create(trustingId, trustedId);

      expect(convexMock.client.mutation).toHaveBeenCalledWith(
        api.communities.trust_links.create,
        {
          trustingOrganizerId: trustingId,
          trustedOrganizerId: trustedId,
        },
      );
    });

    it('should surface mutation errors', async () => {
      convexMock.client.mutation.mockRejectedValue(new Error('Duplicate'));

      await expect(
        service.create(
          'org-a' as Id<'organizers'>,
          'org-b' as Id<'organizers'>,
        ),
      ).rejects.toThrow('Duplicate');
    });
  });

  describe('remove', () => {
    it('should call mutation', async () => {
      convexMock.client.mutation.mockResolvedValue(null);
      const trustingId = 'org-a' as Id<'organizers'>;
      const trustedId = 'org-b' as Id<'organizers'>;

      await service.remove(trustingId, trustedId);

      expect(convexMock.client.mutation).toHaveBeenCalledWith(
        api.communities.trust_links.remove,
        {
          trustingOrganizerId: trustingId,
          trustedOrganizerId: trustedId,
        },
      );
    });
  });
});
