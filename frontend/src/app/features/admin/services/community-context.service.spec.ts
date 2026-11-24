import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {describe, it, expect, vi} from 'vitest';
import {CONVEX} from 'convex-angular';
import {CommunityContextService} from './community-context.service';
import type {Id} from '@convex/_generated/dataModel';
import {type MockConvexClient} from '../../../../testing/mock-types';

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

function createConvexMock(
  communities: Id<'organizers'>[] = [],
  options?: {defer?: boolean; error?: Error},
): {
  onUpdate: ReturnType<typeof vi.fn>;
  onPaginatedUpdate_experimental: ReturnType<typeof vi.fn>;
  localQueryResult: ReturnType<typeof vi.fn>;
  connectionState: ReturnType<typeof vi.fn>;
  subscribeToConnectionState: ReturnType<typeof vi.fn>;
  mutation: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  handleAuthError: ReturnType<typeof vi.fn>;
  emitCommunities: (next: Id<'organizers'>[]) => void;
  emitError: (err: Error) => void;
  client: {
    onUpdate: ReturnType<typeof vi.fn>;
    onPaginatedUpdate_experimental: ReturnType<typeof vi.fn>;
    localQueryResult: ReturnType<typeof vi.fn>;
    connectionState: ReturnType<typeof vi.fn>;
    subscribeToConnectionState: ReturnType<typeof vi.fn>;
  };
} {
  let latestOnData: ((v: unknown) => void) | null = null;
  let latestOnError: ((err: Error) => void) | null = null;
  const onUpdate = vi
    .fn()
    .mockImplementation(
      (
        _q: unknown,
        _args: unknown,
        onData: (v: unknown) => void,
        onError?: (err: Error) => void,
      ) => {
        latestOnData = onData;
        latestOnError = onError ?? null;
        if (!options?.defer) {
          if (options?.error) {
            onError?.(options.error);
          } else {
            onData(communities);
          }
        }
        return () => void 0;
      },
    );

  return {
    onUpdate,
    emitCommunities: (next: Id<'organizers'>[]) => latestOnData?.(next),
    emitError: (err: Error) => latestOnError?.(err),
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
      subscribeToConnectionState: vi
        .fn()
        .mockImplementation(() => () => void 0),
    },
  };
}

describe('CommunityContextService', () => {
  let service: CommunityContextService;
  const communityA = 'org-a' as Id<'organizers'>;
  const communityB = 'org-b' as Id<'organizers'>;

  function setup(
    communities: Id<'organizers'>[] = [],
    options?: {defer?: boolean; error?: Error},
  ) {
    const convexMock = createConvexMock(communities, options);

    TestBed.configureTestingModule({
      imports: [CommunityContextHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        CommunityContextService,
        {provide: CONVEX, useValue: convexMock as unknown as MockConvexClient},
      ],
    });

    TestBed.createComponent(CommunityContextHostComponent);
    TestBed.tick();

    service = TestBed.inject(CommunityContextService);
    return {convexMock};
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

  describe('selectCommunity (membership invariant)', () => {
    it('overrides auto-selection with an explicit choice in the managed list', () => {
      setup([communityA, communityB]);
      service.selectCommunity(communityB);
      expect(service.selectedCommunityId()).toBe(communityB);
    });

    it('falls back to the first managed community when an explicit ID is not in communities()', () => {
      setup([communityA]);
      const unknownId = 'org-unknown' as Id<'organizers'>;
      service.selectCommunity(unknownId);
      expect(service.selectedCommunityId()).toBe(communityA);
      expect(service.isAdminOverride()).toBe(false);
    });

    it('returns null while listMyCommunities is still loading, then honors an explicit selection once loaded', () => {
      const {convexMock} = setup([], {defer: true});
      service.selectCommunity(communityB);
      expect(service.isLoading()).toBe(true);
      expect(service.isLoaded()).toBe(false);
      expect(service.selectedCommunityId()).toBeNull();

      convexMock.emitCommunities([communityA, communityB]);
      TestBed.tick();

      expect(service.isLoaded()).toBe(true);
      expect(service.selectedCommunityId()).toBe(communityB);
    });

    it('reverts to the next valid community when the selected community is revoked live', () => {
      const {convexMock} = setup([communityA, communityB]);
      service.selectCommunity(communityA);
      expect(service.selectedCommunityId()).toBe(communityA);

      convexMock.emitCommunities([communityB]);
      TestBed.tick();

      expect(service.selectedCommunityId()).toBe(communityB);
    });

    it('treats pre-effect construction state as loading and unselected before injectQuery subscribes', () => {
      const convexMock = createConvexMock([communityA], {defer: true});
      TestBed.configureTestingModule({
        imports: [CommunityContextHostComponent],
        providers: [
          provideZonelessChangeDetection(),
          CommunityContextService,
          {
            provide: CONVEX,
            useValue: convexMock as unknown as MockConvexClient,
          },
        ],
      });

      // Intentionally do NOT call TestBed.tick() yet: injectQuery's effect has not run.
      TestBed.createComponent(CommunityContextHostComponent);
      const freshService = TestBed.inject(CommunityContextService);

      expect(freshService.isLoading()).toBe(true);
      expect(freshService.isLoaded()).toBe(false);
      expect(freshService.hasError()).toBe(false);
      expect(freshService.selectedCommunityId()).toBeNull();
    });

    it('exposes hasError and returns null selectedCommunityId when listMyCommunities fails before loading', () => {
      setup([], {error: new Error('network failed')});
      service.selectCommunity(communityA);
      expect(service.hasError()).toBe(true);
      expect(service.isLoaded()).toBe(false);
      expect(service.selectedCommunityId()).toBeNull();
    });

    it('keeps the last loaded community list and avoids hasError on a transient error after initial load', () => {
      const {convexMock} = setup([communityA, communityB]);
      service.selectCommunity(communityB);
      expect(service.selectedCommunityId()).toBe(communityB);

      convexMock.emitError(new Error('transient reconnect blip'));
      TestBed.tick();

      expect(service.isLoaded()).toBe(true);
      expect(service.hasError()).toBe(false);
      expect(service.selectedCommunityId()).toBe(communityB);
    });
  });

  describe('setAdminOverrideCommunity / clearAdminOverride (back-compat shims)', () => {
    it('clearAdminOverride clears _selectedId and reverts to auto-selection', () => {
      setup([communityA, communityB]);
      service.setAdminOverrideCommunity(communityB);
      expect(service.selectedCommunityId()).toBe(communityB);
      service.clearAdminOverride();
      expect(service.selectedCommunityId()).toBe(communityA);
    });

    it('stores and retrieves resolved slugs per community ID', () => {
      setup([communityA]);
      service.setResolvedSlugs(new Map([[communityA, 'alpha-crew']]));
      expect(service.resolvedSlugFor(communityA)).toBe('alpha-crew');
      expect(service.resolvedSlugFor(communityB)).toBeNull();
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
