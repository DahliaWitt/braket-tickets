import {TestBed} from '@angular/core/testing';
import {
  provideZonelessChangeDetection,
  signal,
  type WritableSignal,
} from '@angular/core';
import {beforeEach, describe, expect, it} from 'vitest';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {AuthService} from '@/core/services/auth.service';
import {CONVEX} from 'convex-angular';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import type {UserModel} from '@/testing/user-model';
import {CommunityAdminDefaultService} from './community-admin-default.service';

describe('CommunityAdminDefaultService', () => {
  let service: CommunityAdminDefaultService;
  let currentUser: WritableSignal<UserModel | null>;
  let convexClient: MockConvexClient;

  beforeEach(() => {
    currentUser = signal<UserModel | null>(null);
    convexClient = createMockConvexClient();
    convexClient.mutation.mockResolvedValue(null);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        CommunityAdminDefaultService,
        {provide: AuthService, useValue: {user: currentUser}},
        {provide: CONVEX, useValue: convexClient},
      ],
    });

    service = TestBed.inject(CommunityAdminDefaultService);
  });

  it('returns null when the current user has no default community', () => {
    currentUser.set({
      _id: 'user-1' as Id<'users'>,
      _creationTime: 1,
      email: 'admin@example.com',
    });

    expect(service.defaultCommunityId()).toBeNull();
  });

  it('reads the default community from the current user profile', () => {
    const communityId = 'org-a' as Id<'organizers'>;

    currentUser.set({
      _id: 'user-1' as Id<'users'>,
      _creationTime: 1,
      email: 'admin@example.com',
      defaultCommunityAdminOrganizerId: communityId,
    });

    expect(service.defaultCommunityId()).toBe(communityId);
  });

  it('reports whether a community is the saved default', () => {
    const communityId = 'org-a' as Id<'organizers'>;

    currentUser.set({
      _id: 'user-1' as Id<'users'>,
      _creationTime: 1,
      email: 'admin@example.com',
      defaultCommunityAdminOrganizerId: communityId,
    });

    expect(service.isDefaultCommunity(communityId)).toBe(true);
    expect(service.isDefaultCommunity('org-b' as Id<'organizers'>)).toBe(false);
    expect(service.isDefaultCommunity(null)).toBe(false);
  });

  it('persists the default community through Convex', async () => {
    const communityId = 'org-a' as Id<'organizers'>;

    await service.setDefaultCommunity(communityId);

    expect(convexClient.mutation).toHaveBeenCalledWith(
      api.users.profile.setDefaultCommunityAdminOrganizer,
      {organizerId: communityId},
    );
  });
});
