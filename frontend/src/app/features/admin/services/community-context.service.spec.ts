import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { CONVEX } from 'convex-angular';
import { CommunityContextService } from './community-context.service';
import type { Id } from '@convex/_generated/dataModel';
import { type MockConvexClient } from '../../../../testing/mock-types';

// Host component to satisfy injectConvexQuery's injection context requirement.
// The service is provided at this component level (not root) to mirror the
// community-admin shell provider pattern.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-community-context-host',
  template: '',
})
class CommunityContextHostComponent {
  service = TestBed.inject(CommunityContextService);
}

function createConvexMock(communities: Id<'organizers'>[] = []): {
  onUpdate: ReturnType<typeof vi.fn>;
  onPaginatedUpdate_experimental: ReturnType<typeof vi.fn>;
  localQueryResult: ReturnType<typeof vi.fn>;
  connectionState: ReturnType<typeof vi.fn>;
  subscribeToConnectionState: ReturnType<typeof vi.fn>;
  mutation: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  handleAuthError: ReturnType<typeof vi.fn>;
  client: {
    onUpdate: ReturnType<typeof vi.fn>;
    onPaginatedUpdate_experimental: ReturnType<typeof vi.fn>;
    localQueryResult: ReturnType<typeof vi.fn>;
    connectionState: ReturnType<typeof vi.fn>;
    subscribeToConnectionState: ReturnType<typeof vi.fn>;
  };
} {
  const onUpdate = vi
    .fn()
    .mockImplementation((_q: unknown, _args: unknown, onData: (v: unknown) => void) => {
      onData(communities);
      return () => void 0;
    });

  return {
    onUpdate,
    onPaginatedUpdate_experimental: vi.fn(),
    localQueryResult: vi.fn().mockReturnValue(undefined),
    query: vi.fn(),
    mutation: vi.fn(),
    action: vi.fn(),
    connectionState: vi.fn().mockReturnValue({
      hasInflightRequests: false,
      isWebSocketConnected: true,
      timeOfOldestInflightRequest: null,
      hasEverConnected: true,
      connectionCount: 1,
      connectionRetries: 0,
      inflightMutations: 0,
      inflightActions: 0,
    }),
    subscribeToConnectionState: vi.fn().mockImplementation(() => () => void 0),
    handleAuthError: vi.fn(),
    client: {
      onUpdate,
      onPaginatedUpdate_experimental: vi.fn(),
      localQueryResult: vi.fn().mockReturnValue(undefined),
      connectionState: vi.fn().mockReturnValue({
        hasInflightRequests: false,
        isWebSocketConnected: true,
        timeOfOldestInflightRequest: null,
        hasEverConnected: true,
        connectionCount: 1,
        connectionRetries: 0,
        inflightMutations: 0,
        inflightActions: 0,
      }),
      subscribeToConnectionState: vi.fn().mockImplementation(() => () => void 0),
    },
  };
}

describe('CommunityContextService', () => {
  let service: CommunityContextService;
  const communityA = 'org-a' as Id<'organizers'>;
  const communityB = 'org-b' as Id<'organizers'>;

  function setup(communities: Id<'organizers'>[] = []) {
    const convexMock = createConvexMock(communities);

    TestBed.configureTestingModule({
      imports: [CommunityContextHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        CommunityContextService,
        { provide: CONVEX, useValue: convexMock as unknown as MockConvexClient },
      ],
    });

    TestBed.createComponent(CommunityContextHostComponent);
    TestBed.tick();

    service = TestBed.inject(CommunityContextService);
  }

  describe('creation', () => {
    it('should be created', () => {
      setup();
      expect(service).toBeTruthy();
    });
  });

  describe('communities signal', () => {
    it('returns empty array when no communities loaded', () => {
      setup([]);
      expect(service.communities()).toEqual([]);
    });

    it('returns communities from the query', () => {
      setup([communityA, communityB]);
      expect(service.communities()).toEqual([communityA, communityB]);
    });
  });

  describe('hasMultipleCommunities', () => {
    it('is false when zero communities', () => {
      setup([]);
      expect(service.hasMultipleCommunities()).toBe(false);
    });

    it('is false when exactly one community', () => {
      setup([communityA]);
      expect(service.hasMultipleCommunities()).toBe(false);
    });

    it('is true when more than one community', () => {
      setup([communityA, communityB]);
      expect(service.hasMultipleCommunities()).toBe(true);
    });
  });

  describe('auto-selection (single community)', () => {
    it('auto-selects the first community when only one exists', () => {
      setup([communityA]);
      expect(service.selectedCommunityId()).toBe(communityA);
    });

    it('auto-selects the first community when multiple exist and none is explicitly chosen', () => {
      setup([communityA, communityB]);
      expect(service.selectedCommunityId()).toBe(communityA);
    });

    it('returns null when no communities are available', () => {
      setup([]);
      expect(service.selectedCommunityId()).toBeNull();
    });
  });

  describe('selectCommunity', () => {
    it('overrides auto-selection with an explicit choice', () => {
      setup([communityA, communityB]);
      service.selectCommunity(communityB);
      expect(service.selectedCommunityId()).toBe(communityB);
    });

    it('returns the explicit id even when not in the communities list, and isAdminOverride becomes true', () => {
      setup([communityA]);
      const unknownId = 'org-unknown' as Id<'organizers'>;
      service.selectCommunity(unknownId);
      expect(service.selectedCommunityId()).toBe(unknownId);
      expect(service.isAdminOverride()).toBe(true);
    });
  });

  describe('isAdminOverride (derived from membership)', () => {
    it('is false by default when auto-selected community is in the list', () => {
      setup([communityA]);
      expect(service.isAdminOverride()).toBe(false);
    });

    it('is false when selected id is in communities list', () => {
      setup([communityA, communityB]);
      service.selectCommunity(communityA);
      expect(service.isAdminOverride()).toBe(false);
    });

    it('is true when selected id is not in communities list after loading settled', () => {
      setup([communityA]);
      const unknownId = 'org-override' as Id<'organizers'>;
      service.selectCommunity(unknownId);
      expect(service.isAdminOverride()).toBe(true);
    });

    it('is false while isLoading even when selected id is not in the empty list', () => {
      // Simulate loading: onUpdate never calls onData, so communities() = [] and isLoading() = true
      const loadingOnUpdate = vi.fn().mockImplementation(() => () => void 0);
      const loadingMock = {
        onUpdate: loadingOnUpdate,
        onPaginatedUpdate_experimental: vi.fn(),
        localQueryResult: vi.fn().mockReturnValue(undefined),
        query: vi.fn(),
        mutation: vi.fn(),
        action: vi.fn(),
        connectionState: vi.fn().mockReturnValue({
          hasInflightRequests: false,
          isWebSocketConnected: true,
          timeOfOldestInflightRequest: null,
          hasEverConnected: true,
          connectionCount: 1,
          connectionRetries: 0,
          inflightMutations: 0,
          inflightActions: 0,
        }),
        subscribeToConnectionState: vi.fn().mockImplementation(() => () => void 0),
        handleAuthError: vi.fn(),
        client: {
          onUpdate: loadingOnUpdate,
          onPaginatedUpdate_experimental: vi.fn(),
          localQueryResult: vi.fn().mockReturnValue(undefined),
          connectionState: vi.fn().mockReturnValue({
            hasInflightRequests: false,
            isWebSocketConnected: true,
            timeOfOldestInflightRequest: null,
            hasEverConnected: true,
            connectionCount: 1,
            connectionRetries: 0,
            inflightMutations: 0,
            inflightActions: 0,
          }),
          subscribeToConnectionState: vi.fn().mockImplementation(() => () => void 0),
        },
      };

      TestBed.configureTestingModule({
        imports: [CommunityContextHostComponent],
        providers: [
          provideZonelessChangeDetection(),
          CommunityContextService,
          { provide: CONVEX, useValue: loadingMock as unknown as MockConvexClient },
        ],
      });
      TestBed.createComponent(CommunityContextHostComponent);
      TestBed.tick();
      service = TestBed.inject(CommunityContextService);

      service.selectCommunity('org-unknown' as Id<'organizers'>);
      expect(service.isLoading()).toBe(true);
      expect(service.isAdminOverride()).toBe(false);
    });
  });

  describe('setAdminOverrideCommunity / clearAdminOverride (back-compat shims)', () => {
    it('setAdminOverrideCommunity is equivalent to selectCommunity', () => {
      setup([communityA]);
      const unknownId = 'org-override' as Id<'organizers'>;
      service.setAdminOverrideCommunity(unknownId);
      expect(service.selectedCommunityId()).toBe(unknownId);
      expect(service.isAdminOverride()).toBe(true);
    });

    it('clearAdminOverride clears _selectedId and reverts to auto-selection', () => {
      setup([communityA, communityB]);
      const overrideId = 'org-override' as Id<'organizers'>;
      service.setAdminOverrideCommunity(overrideId);
      service.clearAdminOverride();
      expect(service.isAdminOverride()).toBe(false);
      expect(service.selectedCommunityId()).toBe(communityA);
    });

    it('resolves community name for override id from resolved names map', () => {
      setup([communityA]);
      const overrideId = 'org-override' as Id<'organizers'>;
      service.setAdminOverrideCommunity(overrideId);
      service.setResolvedNames(new Map([[overrideId, 'Sister City']]));
      expect(service.selectedCommunityName()).toBe('Sister City');
    });
  });

  describe('selectedCommunityName', () => {
    it('returns null when no community is selected', () => {
      setup([]);
      expect(service.selectedCommunityName()).toBeNull();
    });

    it('returns null before names are resolved', () => {
      setup([communityA]);
      expect(service.selectedCommunityName()).toBeNull();
    });

    it('returns the resolved name for the selected community', () => {
      setup([communityA, communityB]);
      service.setResolvedNames(
        new Map([
          [communityA, 'Alpha Crew'],
          [communityB, 'Beta Squad'],
        ]),
      );
      expect(service.selectedCommunityName()).toBe('Alpha Crew');
    });

    it('returns correct name after explicit community selection', () => {
      setup([communityA, communityB]);
      service.setResolvedNames(
        new Map([
          [communityA, 'Alpha Crew'],
          [communityB, 'Beta Squad'],
        ]),
      );
      service.selectCommunity(communityB);
      expect(service.selectedCommunityName()).toBe('Beta Squad');
    });

    it('returns null if selected community has no resolved name entry', () => {
      setup([communityA]);
      service.setResolvedNames(new Map([[communityB, 'Beta Squad']]));
      expect(service.selectedCommunityName()).toBeNull();
    });
  });
});
