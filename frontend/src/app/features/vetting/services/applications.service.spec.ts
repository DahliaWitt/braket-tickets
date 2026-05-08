import { TestBed } from '@angular/core/testing';
import { ApplicationsService } from '@/features/vetting/services/applications.service';

import { AuthService } from '@/core/services/auth.service';
import { CONVEX } from 'convex-angular';
import { api } from '@convex/_generated/api';
import { type Id } from '@convex/_generated/dataModel';
import { type FunctionArgs } from 'convex/server';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockConvexClient,
  type MockConvexClient,
  createMockAuthService,
  type MockAuthService,
  createMockUser,
} from '../../../../testing/mock-types';

describe('ApplicationsService', () => {
  let service: ApplicationsService;
  let convexClientMock: MockConvexClient;
  let authServiceMock: MockAuthService;

  const mockApp = {
    _id: 'app1',
    userId: 'user1',
    status: 'pending',
    answers: { whyJoin: 'Because' },
    _creationTime: 123,
  };

  beforeEach(() => {
    convexClientMock = createMockConvexClient();

    authServiceMock = createMockAuthService({
      user: createMockUser({ _id: 'user1' as Id<'users'> }),
    });

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ApplicationsService,
        { provide: CONVEX, useValue: convexClientMock },
        { provide: AuthService, useValue: authServiceMock },
      ],
    });
    service = TestBed.inject(ApplicationsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getMyApplication', () => {
    it('should return application from convex query', async () => {
      convexClientMock.client.query.mockResolvedValue(mockApp);

      const result = await service.getMyApplication();

      expect(convexClientMock.client.query).toHaveBeenCalledWith(
        api.communities.applications['getMyApplication'],
        {},
      );
      expect(result?._id).toBe('app1');
    });

    it('should return null if no application found', async () => {
      convexClientMock.client.query.mockResolvedValue(null);
      const result = await service.getMyApplication();
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should call submit mutation with all answers and organizerId', async () => {
      convexClientMock.mutation.mockResolvedValue('new_id');

      const payload: FunctionArgs<typeof api.communities.applications.submit> = {
        organizerId: 'org1' as Id<'organizers'>,
        answers: { whyJoin: 'Test', custom: 'data' },
      };
      await service.create(payload);

      expect(convexClientMock.mutation).toHaveBeenCalledWith(api.communities.applications['submit'], {
        answers: { whyJoin: 'Test', custom: 'data' },
        organizerId: 'org1',
      });
    });
  });

  describe('approve', () => {
    it('should call review mutation', async () => {
      await service.approve(
        'app1' as Id<'applications'>,
        'user1' as Id<'users'>,
        'processor1' as Id<'users'>,
      );

      expect(convexClientMock.mutation).toHaveBeenCalledWith(api.communities.applications.review, {
        applicationId: 'app1',
        status: 'approved',
      });
    });
  });

  describe('reject', () => {
    it('should call review mutation with denyReason when provided', async () => {
      await service.reject(
        'app1' as Id<'applications'>,
        'processor1' as Id<'users'>,
        'Missing required details',
      );

      expect(convexClientMock.mutation).toHaveBeenCalledWith(api.communities.applications.review, {
        applicationId: 'app1',
        status: 'rejected',
        denyReason: 'Missing required details',
      });
    });

    it('should call review mutation without denyReason when omitted', async () => {
      await service.reject(
        'app1' as Id<'applications'>,
        'processor1' as Id<'users'>,
      );

      expect(convexClientMock.mutation).toHaveBeenCalledWith(api.communities.applications.review, {
        applicationId: 'app1',
        status: 'rejected',
      });
    });
  });
});
