import {TestBed} from '@angular/core/testing';
import {CommunitiesService} from '@/core/services/communities.service';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {provideZonelessChangeDetection} from '@angular/core';
import {describe, it, expect, beforeEach} from 'vitest';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../testing/mock-types';

describe('CommunitiesService', () => {
  let service: CommunitiesService;
  let convexClientMock: MockConvexClient;

  const mockCommunities = [
    {
      _id: 'org1' as const,
      _creationTime: 1234567890,
      name: 'Test Community 1',
      email: 'test1@example.com',
      contactInfo: 'Contact info 1',
    },
    {
      _id: 'org2' as const,
      _creationTime: 1234567891,
      name: 'Test Community 2',
      email: 'test2@example.com',
    },
  ];

  beforeEach(() => {
    convexClientMock = createMockConvexClient();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        CommunitiesService,
        {provide: CONVEX, useValue: convexClientMock},
      ],
    });
    service = TestBed.inject(CommunitiesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('list', () => {
    it('should return a list of communities', async () => {
      convexClientMock.client.query.mockResolvedValue(mockCommunities);

      const communities = await service.list();

      expect(communities.length).toBe(2);
      expect(communities[0].name).toBe('Test Community 1');
      expect(communities[0].email).toBe('test1@example.com');
      expect(communities[1].name).toBe('Test Community 2');
      expect(convexClientMock.client.query).toHaveBeenCalledWith(
        api.communities.list.list,
        {},
      );
    });

    it('should handle empty list', async () => {
      convexClientMock.client.query.mockResolvedValue([]);

      const communities = await service.list();

      expect(communities.length).toBe(0);
    });
  });

  describe('get', () => {
    it('should return a community by id', async () => {
      const mockCommunity = mockCommunities[0];
      convexClientMock.client.query.mockResolvedValue(mockCommunity);

      const community = await service.get('org1' as Id<'organizers'>);

      expect(community).toBeDefined();
      expect(community?.name).toBe('Test Community 1');
      expect(community?.email).toBe('test1@example.com');
      expect(convexClientMock.client.query).toHaveBeenCalledWith(
        api.communities.public.get,
        {
          id: 'org1',
        },
      );
    });

    it('should return null if community not found', async () => {
      convexClientMock.client.query.mockResolvedValue(null);

      const community = await service.get('nonexistent' as Id<'organizers'>);

      expect(community).toBeNull();
    });
  });

  describe('getBySlugOrId', () => {
    it('should return a community by slug or id', async () => {
      const mockCommunity = mockCommunities[0];
      convexClientMock.client.query.mockResolvedValue(mockCommunity);

      const community = await service.getBySlugOrId('test-community');

      expect(community).toBe(mockCommunity);
      expect(convexClientMock.client.query).toHaveBeenCalledWith(
        api.communities.public.getBySlugOrId,
        {slugOrId: 'test-community'},
      );
    });

    it('should retry transient lookup failures', async () => {
      const mockCommunity = mockCommunities[0];
      convexClientMock.client.query
        .mockRejectedValueOnce(new Error('Function execution timed out'))
        .mockResolvedValue(mockCommunity);

      await expect(service.getBySlugOrId('test-community')).resolves.toBe(
        mockCommunity,
      );
      expect(convexClientMock.client.query).toHaveBeenCalledTimes(2);
    });

    it('should not retry authorization failures', async () => {
      convexClientMock.client.query.mockRejectedValue(
        new Error('Unauthorized'),
      );

      await expect(service.getBySlugOrId('test-community')).rejects.toThrow(
        'Unauthorized',
      );
      expect(convexClientMock.client.query).toHaveBeenCalledTimes(1);
    });

    it('should not retry not-found lookup failures', async () => {
      convexClientMock.client.query.mockRejectedValue(
        new Error('Community not found'),
      );

      await expect(service.getBySlugOrId('missing-community')).rejects.toThrow(
        'Community not found',
      );
      expect(convexClientMock.client.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('should forward partial update args without requiring a name', async () => {
      convexClientMock.client.mutation.mockResolvedValue(undefined);

      await expect(
        service.update({
          id: 'org1' as Id<'organizers'>,
          vettingQuestions: [],
        }),
      ).resolves.toBeUndefined();

      expect(convexClientMock.client.mutation).toHaveBeenCalledWith(
        api.communities.profile.update,
        {
          id: 'org1',
          vettingQuestions: [],
        },
      );
    });
  });
});
