/**
 * Shared mock types for unit tests.
 *
 * This file provides properly typed mock factories to replace `any` types
 * in test files, maintaining the Zero-Any policy even in tests.
 */
import {vi} from 'vitest';
import {
  computed,
  signal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import type {Id} from '@convex/_generated/dataModel';
import type {UserModel} from '@/testing/user-model';

/**
 * Mock type for the `CONVEX` injection token value from `convex-angular`.
 * Keep this as a thin raw client shape for subscription and mutation tests.
 */
export type MockUserRole = 'root_admin' | 'community_admin' | 'user';

export interface MockConvexClient {
  query: ReturnType<typeof vi.fn>;
  mutation: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
  onUpdate: ReturnType<typeof vi.fn>;
  onPaginatedUpdate_experimental: ReturnType<typeof vi.fn>;
  localQueryResult: ReturnType<typeof vi.fn>;
  connectionState: ReturnType<typeof vi.fn>;
  subscribeToConnectionState: ReturnType<typeof vi.fn>;
  hasAuth?: ReturnType<typeof vi.fn>;
  client: {
    query: ReturnType<typeof vi.fn>;
    mutation: ReturnType<typeof vi.fn>;
    action: ReturnType<typeof vi.fn>;
    onUpdate: ReturnType<typeof vi.fn>;
    onPaginatedUpdate_experimental: ReturnType<typeof vi.fn>;
    localQueryResult: ReturnType<typeof vi.fn>;
    connectionState: ReturnType<typeof vi.fn>;
    subscribeToConnectionState: ReturnType<typeof vi.fn>;
    hasAuth?: ReturnType<typeof vi.fn>;
  };
  /** Compatibility field retained for tests that still assert this property. */
  handleAuthError: ReturnType<typeof vi.fn>;
}

/**
 * Creates a properly typed convex-angular mock.
 */
export function createMockConvexClient(): MockConvexClient {
  const query = vi.fn();
  const mutation = vi.fn();
  // Default to an object shape that keeps embedded Stripe Connect
  // components happy — their `fetchClientSecret` callback throws if the
  // action resolves to `undefined`, which would escape as an unhandled
  // rejection and fail otherwise-green specs. Individual tests override
  // per-call when they care about the response.
  const action = vi.fn().mockResolvedValue({clientSecret: 'seccs_test'});
  const onUpdate = vi.fn().mockReturnValue(() => void 0);
  const onPaginatedUpdate_experimental = vi.fn();
  const localQueryResult = vi.fn().mockReturnValue(undefined);
  const connectionState = vi.fn().mockReturnValue({
    hasInflightRequests: false,
    isWebSocketConnected: false,
    timeOfOldestInflightRequest: null,
    hasEverConnected: false,
    connectionCount: 0,
    connectionRetries: 0,
    inflightMutations: 0,
    inflightActions: 0,
  });
  const subscribeToConnectionState = vi.fn().mockReturnValue(() => void 0);
  const hasAuth = vi.fn().mockReturnValue(true);

  return {
    query,
    mutation,
    action,
    onUpdate,
    onPaginatedUpdate_experimental,
    localQueryResult,
    connectionState,
    subscribeToConnectionState,
    hasAuth,
    client: {
      query,
      mutation,
      action,
      onUpdate,
      onPaginatedUpdate_experimental,
      localQueryResult,
      connectionState,
      subscribeToConnectionState,
      hasAuth,
    },
    handleAuthError: vi.fn(),
  };
}

/**
 * Mock type for AuthService.
 */
export interface MockAuthService {
  user: WritableSignal<UserModel | null>;
  currentUser: Signal<(UserModel & {id: Id<'users'>}) | null>;
  isAuthenticated: WritableSignal<boolean>;
  isLoading: WritableSignal<boolean>;
  userRole: Signal<MockUserRole>;
  isCommunityAdmin: Signal<boolean>;
  signOut: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
}

/**
 * Creates a properly typed AuthService mock.
 */
export function createMockAuthService(
  overrides: Partial<{
    user: UserModel | null;
    isAuthenticated: boolean;
    isLoading: boolean;
  }> = {},
): MockAuthService {
  const user = signal(overrides.user ?? null);
  const isAuthenticated = signal(overrides.isAuthenticated ?? false);
  const isLoading = signal(overrides.isLoading ?? false);

  return {
    user,
    currentUser: computed(() => {
      const currentUser = user();
      if (!currentUser) {
        return null;
      }

      return {
        ...currentUser,
        id: currentUser._id,
      };
    }),
    isAuthenticated,
    isLoading,
    userRole: computed(() => {
      const currentUser = user();
      if (currentUser?.isRootAdmin) return 'root_admin';
      if ((currentUser?.communityAdminOrganizerIds?.length ?? 0) > 0)
        return 'community_admin';
      return 'user';
    }),
    isCommunityAdmin: computed(
      () => (user()?.communityAdminOrganizerIds?.length ?? 0) > 0,
    ),
    signOut: vi.fn(),
    updateUser: vi.fn(),
    refresh: vi.fn(),
  };
}

/**
 * Creates a mock user for testing.
 */
export function createMockUser(overrides: Partial<UserModel> = {}): UserModel {
  return {
    _id: 'user-1' as Id<'users'>,
    _creationTime: Date.now(),
    email: 'test@example.com',
    communityAdminOrganizerIds: [],
    ...overrides,
  };
}

/**
 * Creates a mock community-admin user for testing organizer-scoped auth.
 */
export function createMockCommunityAdminUser(
  communityAdminOrganizerIds: Id<'organizers'>[],
  overrides: Partial<UserModel> = {},
): UserModel {
  return createMockUser({
    ...overrides,
    communityAdminOrganizerIds,
  });
}

/**
 * Creates a mock root admin user for testing platform-scoped auth.
 */
export function createMockRootAdminUser(
  overrides: Partial<UserModel> = {},
): UserModel {
  return createMockUser({
    ...overrides,
    isRootAdmin: true,
  });
}
