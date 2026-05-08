import {TestBed} from '@angular/core/testing';
import {MembersService} from '@/features/admin/services/members.service';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {provideZonelessChangeDetection} from '@angular/core';
import {describe, it, expect, beforeEach} from 'vitest';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../../testing/mock-types';

describe('MembersService', () => {
  let service: MembersService;
  let convexClientMock: MockConvexClient;

  beforeEach(() => {
    convexClientMock = createMockConvexClient();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        MembersService,
        {provide: CONVEX, useValue: convexClientMock},
      ],
    });
    service = TestBed.inject(MembersService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('revokeMembership', () => {
    it('should call users.revokeMembership mutation with organizerId', async () => {
      await service.revokeMembership('user1', 'org123');
      expect(convexClientMock.mutation).toHaveBeenCalledWith(
        api.users.profile.revokeMembership,
        {
          userId: 'user1',
          organizerId: 'org123',
        },
      );
    });
  });
});
