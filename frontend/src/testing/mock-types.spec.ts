import { describe, expect, it } from 'vitest';
import type { Id } from '@convex/_generated/dataModel';
import {
  createMockAuthService,
  createMockCommunityAdminUser,
  createMockRootAdminUser,
} from './mock-types';

describe('mock-types helpers', () => {
  it('derives community-admin auth state from organizer-scoped membership', () => {
    const auth = createMockAuthService({
      user: createMockCommunityAdminUser(['org-1' as Id<'organizers'>]),
    });

    expect(auth.userRole()).toBe('community_admin');
    expect(auth.isCommunityAdmin()).toBe(true);
  });

  it('derives root-admin auth state from explicit platform role', () => {
    const auth = createMockAuthService({
      user: createMockRootAdminUser(),
    });

    expect(auth.userRole()).toBe('root_admin');
    expect(auth.isCommunityAdmin()).toBe(false);
  });
});
