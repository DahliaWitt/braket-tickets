/// <reference types="vite/client" />
import {ConvexError} from 'convex/values';
import type {CommunityPublicationStatus} from '@shared/domain/community-publication-status';
import type {EventStatus} from '@shared/domain/event-status';
import type {EventVisibility} from '@shared/domain/event-visibility';
import {beforeEach, describe, expect, it} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Doc, Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';
import {addMember, addTrustLink, authz, authzUserId} from './authz';
import {
  canCreateEvent,
  canEditEvent,
  canManageCommunity,
  canManageEvent,
  canViewCommunityMembers,
  canScanEvent,
  canViewCommunity,
  canViewEvent,
  canViewEventRoster,
  hasEventStaffAccess,
  isPlatformAdmin,
  requireEditEvent,
  requireManageCommunity,
  requirePlatformAdmin,
} from './access';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

let userCounter = 0;

async function createUser(
  t: ReturnType<typeof convexTest>,
  name: string,
): Promise<Id<'users'>> {
  userCounter += 1;
  return t.mutation(api.testing.users.createUserDirectly, {
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}.${userCounter}@test.example`,
  });
}

async function createOrganizer(
  t: ReturnType<typeof convexTest>,
  name: string,
  options: {
    withVetting?: boolean;
    status?: CommunityPublicationStatus;
    isPublicDirectory?: boolean;
  } = {},
): Promise<Id<'organizers'>> {
  // withVetting: false => organizer with no vetting questions (production doesn't allow
  // this on published orgs, but access.ts tests visibility still controls access).
  if (options.withVetting === false) {
    return t.mutation(api.testing.communities.seedOrganizerNoVetting, {name});
  }
  return t.mutation(api.testing.communities.seedOrganizer, {
    name,
    vettingQuestions: options.withVetting
      ? [
          {
            id: 'q1',
            question: 'Why join?',
            type: 'text' as const,
            required: true,
          },
        ]
      : undefined,
    status: options.status,
    isPublicDirectory: options.isPublicDirectory,
  });
}

async function createEvent(
  t: ReturnType<typeof convexTest>,
  organizerId: Id<'organizers'>,
  overrides: {
    visibility?: EventVisibility;
    status?: EventStatus;
  } = {},
): Promise<Id<'events'>> {
  return t.mutation(api.testing.events.seedEvent, {
    title: 'Test Event',
    organizerId,
    status: overrides.status ?? 'published',
    date: '2030-12-15',
    price: 1000,
    totalTickets: 100,
    visibility: overrides.visibility ?? 'private',
  });
}

async function loadEvent(
  t: ReturnType<typeof convexTest>,
  eventId: Id<'events'>,
): Promise<Doc<'events'>> {
  return t.run(async (ctx) => {
    const event = await ctx.db.get('events', eventId);
    if (!event) throw new Error('Expected seeded event');
    return event;
  });
}

async function loadOrganizer(
  t: ReturnType<typeof convexTest>,
  organizerId: Id<'organizers'>,
): Promise<Doc<'organizers'>> {
  return t.run(async (ctx) => {
    const organizer = await ctx.db.get('organizers', organizerId);
    if (!organizer) throw new Error('Expected seeded organizer');
    return organizer;
  });
}

async function assignRootAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, authzUserId(userId), 'root_admin');
  });
}

async function assignCommunityAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, authzUserId(userId), 'community_admin', {
      type: 'organizer',
      id: organizerId as string,
    });
  });
}

async function assignCommunityScanner(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, authzUserId(userId), 'community_scanner', {
      type: 'organizer',
      id: organizerId as string,
    });
  });
}

async function assignMember(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await addMember(ctx, userId, organizerId);
  });
}

beforeEach(() => {
  process.env['IS_TEST'] = 'true';
});

// ---------------------------------------------------------------------------
// canViewEvent
// ---------------------------------------------------------------------------

describe('canViewEvent', () => {
  it('anonymous CAN view public published event', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Org');
    const eventId = await createEvent(t, orgId, {visibility: 'public'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, null, event))).toBe(true);
  });

  it('anonymous CAN view public_viewable published event', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Org');
    const eventId = await createEvent(t, orgId, {
      visibility: 'public_viewable',
    });
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, null, event))).toBe(true);
  });

  it('anonymous CANNOT view private published event', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Org');
    const eventId = await createEvent(t, orgId, {visibility: 'private'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, null, event))).toBe(false);
  });

  it('authenticated non-member CANNOT view private published event', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Visitor');
    const orgId = await createOrganizer(t, 'Org');
    const eventId = await createEvent(t, orgId, {
      visibility: 'private',
      status: 'published',
    });
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, userId, event))).toBe(false);
  });

  it('scanner without membership CANNOT view private published event', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Scanner');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityScanner(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {
      visibility: 'private',
      status: 'published',
    });
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, userId, event))).toBe(false);
  });

  it('member CAN view private published event', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const orgId = await createOrganizer(t, 'Org');
    await assignMember(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {
      visibility: 'private',
      status: 'published',
    });
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, userId, event))).toBe(true);
  });

  it('trusted member CAN view private published event through one-hop shared access', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Trusted Member');
    const trustingOrgId = await createOrganizer(t, 'Trusting Org', {
      withVetting: true,
    });
    const trustedOrgId = await createOrganizer(t, 'Trusted Org', {
      withVetting: true,
    });
    await assignMember(t, userId, trustedOrgId);
    await t.run(async (ctx) => {
      await addTrustLink(ctx, trustingOrgId, trustedOrgId);
    });
    const eventId = await createEvent(t, trustingOrgId, {
      visibility: 'private',
      status: 'published',
    });
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, userId, event))).toBe(true);
  });

  it('anonymous CANNOT view public cancelled event', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Org');
    const eventId = await createEvent(t, orgId, {
      visibility: 'public',
      status: 'cancelled',
    });
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, null, event))).toBe(false);
  });

  it('anonymous CANNOT view private draft event', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Org');
    const eventId = await createEvent(t, orgId, {
      visibility: 'private',
      status: 'draft',
    });
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, null, event))).toBe(false);
  });

  it('authenticated non-member CANNOT view private draft event', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Visitor');
    const orgId = await createOrganizer(t, 'Org');
    const eventId = await createEvent(t, orgId, {
      visibility: 'private',
      status: 'draft',
    });
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, userId, event))).toBe(false);
  });

  it('admin CAN view draft event', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityAdmin(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {
      visibility: 'private',
      status: 'draft',
    });
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, userId, event))).toBe(true);
  });

  it('root admin CAN view draft event via global fallback', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Root');
    const orgId = await createOrganizer(t, 'Org');
    await assignRootAdmin(t, userId);
    const eventId = await createEvent(t, orgId, {
      visibility: 'private',
      status: 'draft',
    });
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEvent(ctx, userId, event))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canViewEventRoster
// ---------------------------------------------------------------------------

describe('canViewEventRoster', () => {
  it('scanner DENIED on draft event', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Scanner');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityScanner(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {status: 'draft'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEventRoster(ctx, userId, event))).toBe(
      false,
    );
  });

  it('scanner ALLOWED on published event', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Scanner');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityScanner(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {status: 'published'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEventRoster(ctx, userId, event))).toBe(
      true,
    );
  });

  it('admin ALLOWED on any status', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityAdmin(t, userId, orgId);

    for (const status of ['draft', 'published', 'cancelled'] as const) {
      const eventId = await createEvent(t, orgId, {status});
      const event = await loadEvent(t, eventId);
      expect(await t.run((ctx) => canViewEventRoster(ctx, userId, event))).toBe(
        true,
      );
    }
  });

  it('member DENIED roster access', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const orgId = await createOrganizer(t, 'Org');
    await assignMember(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {status: 'published'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEventRoster(ctx, userId, event))).toBe(
      false,
    );
  });

  it('scanner DENIED on cancelled event', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Scanner');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityScanner(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {status: 'cancelled'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canViewEventRoster(ctx, userId, event))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// canViewCommunity
// ---------------------------------------------------------------------------

describe('canViewCommunity', () => {
  it('anonymous CAN view non-draft public-directory community', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Public Org', {
      status: 'published',
      isPublicDirectory: true,
    });
    const organizer = await loadOrganizer(t, orgId);

    expect(await t.run((ctx) => canViewCommunity(ctx, null, organizer))).toBe(
      true,
    );
  });

  it('anonymous CAN view community with default isPublicDirectory: true', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Default Org');
    const organizer = await loadOrganizer(t, orgId);

    // isPublicDirectory defaults to true via seed helper
    expect(await t.run((ctx) => canViewCommunity(ctx, null, organizer))).toBe(
      true,
    );
  });

  it('anonymous CANNOT view draft community', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Draft Org', {status: 'draft'});
    const organizer = await loadOrganizer(t, orgId);

    expect(await t.run((ctx) => canViewCommunity(ctx, null, organizer))).toBe(
      false,
    );
  });

  it('anonymous CANNOT view isPublicDirectory:false community', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Hidden Org', {
      status: 'published',
      isPublicDirectory: false,
    });
    const organizer = await loadOrganizer(t, orgId);

    expect(await t.run((ctx) => canViewCommunity(ctx, null, organizer))).toBe(
      false,
    );
  });

  it('community admin CAN view draft community', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Draft Org', {status: 'draft'});
    await assignCommunityAdmin(t, userId, orgId);
    const organizer = await loadOrganizer(t, orgId);

    expect(await t.run((ctx) => canViewCommunity(ctx, userId, organizer))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// isPlatformAdmin
// ---------------------------------------------------------------------------

describe('isPlatformAdmin', () => {
  it('root_admin returns true', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Root');
    await assignRootAdmin(t, userId);

    expect(await t.run((ctx) => isPlatformAdmin(ctx, userId))).toBe(true);
  });

  it('community_admin returns false', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityAdmin(t, userId, orgId);

    expect(await t.run((ctx) => isPlatformAdmin(ctx, userId))).toBe(false);
  });

  it('regular user returns false', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Regular');

    expect(await t.run((ctx) => isPlatformAdmin(ctx, userId))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requirePlatformAdmin
// ---------------------------------------------------------------------------

describe('requirePlatformAdmin', () => {
  it('does not throw for root admin', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Root');
    await assignRootAdmin(t, userId);

    // t.run returns null for void handlers; assert it does not reject.
    await expect(
      t.run((ctx) => requirePlatformAdmin(ctx, userId)),
    ).resolves.toBeNull();
  });

  it('throws for non-admin', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Regular');

    await expect(
      t.run((ctx) => requirePlatformAdmin(ctx, userId)),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

// ---------------------------------------------------------------------------
// require variants that throw
// ---------------------------------------------------------------------------

describe('require variants', () => {
  it('requireEditEvent throws for unauthorized user', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Outsider');
    const orgId = await createOrganizer(t, 'Org');
    const eventId = await createEvent(t, orgId);
    const event = await loadEvent(t, eventId);

    await expect(
      t.run((ctx) => requireEditEvent(ctx, userId, event)),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  it('requireEditEvent passes for community admin', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityAdmin(t, userId, orgId);
    const eventId = await createEvent(t, orgId);
    const event = await loadEvent(t, eventId);

    // t.run returns null for void handlers; assert it does not reject.
    await expect(
      t.run((ctx) => requireEditEvent(ctx, userId, event)),
    ).resolves.toBeNull();
  });

  it('requireManageCommunity throws for regular user', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Regular');
    const orgId = await createOrganizer(t, 'Org');

    await expect(
      t.run((ctx) => requireManageCommunity(ctx, userId, orgId)),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

// ---------------------------------------------------------------------------
// hasEventStaffAccess composite
// ---------------------------------------------------------------------------

describe('hasEventStaffAccess', () => {
  it('community admin has staff access', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityAdmin(t, userId, orgId);
    const eventId = await createEvent(t, orgId);
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => hasEventStaffAccess(ctx, userId, event))).toBe(
      true,
    );
  });

  it('scanner has staff access', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Scanner');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityScanner(t, userId, orgId);
    const eventId = await createEvent(t, orgId);
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => hasEventStaffAccess(ctx, userId, event))).toBe(
      true,
    );
  });

  it('regular member does NOT have staff access', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const orgId = await createOrganizer(t, 'Org');
    await assignMember(t, userId, orgId);
    const eventId = await createEvent(t, orgId);
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => hasEventStaffAccess(ctx, userId, event))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// canEditEvent / canCreateEvent / canManageEvent / canScanEvent
// ---------------------------------------------------------------------------

describe('granular event permissions', () => {
  it('community admin can create, edit, manage, scan', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityAdmin(t, userId, orgId);
    const eventId = await createEvent(t, orgId);
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canCreateEvent(ctx, userId, orgId))).toBe(true);
    expect(await t.run((ctx) => canEditEvent(ctx, userId, event))).toBe(true);
    expect(await t.run((ctx) => canManageEvent(ctx, userId, event))).toBe(true);
    expect(await t.run((ctx) => canScanEvent(ctx, userId, event))).toBe(true);
  });

  it('scanner can scan but not create/edit/manage', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Scanner');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityScanner(t, userId, orgId);
    const eventId = await createEvent(t, orgId);
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canCreateEvent(ctx, userId, orgId))).toBe(
      false,
    );
    expect(await t.run((ctx) => canEditEvent(ctx, userId, event))).toBe(false);
    expect(await t.run((ctx) => canManageEvent(ctx, userId, event))).toBe(
      false,
    );
    expect(await t.run((ctx) => canScanEvent(ctx, userId, event))).toBe(true);
  });

  it('member cannot create/edit/manage/scan', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const orgId = await createOrganizer(t, 'Org');
    await assignMember(t, userId, orgId);
    const eventId = await createEvent(t, orgId);
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canCreateEvent(ctx, userId, orgId))).toBe(
      false,
    );
    expect(await t.run((ctx) => canEditEvent(ctx, userId, event))).toBe(false);
    expect(await t.run((ctx) => canManageEvent(ctx, userId, event))).toBe(
      false,
    );
    expect(await t.run((ctx) => canScanEvent(ctx, userId, event))).toBe(false);
  });

  it('root admin can create/edit/manage/scan via global fallback', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Root');
    const orgId = await createOrganizer(t, 'Org');
    await assignRootAdmin(t, userId);
    const eventId = await createEvent(t, orgId);
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canCreateEvent(ctx, userId, orgId))).toBe(true);
    expect(await t.run((ctx) => canEditEvent(ctx, userId, event))).toBe(true);
    expect(await t.run((ctx) => canManageEvent(ctx, userId, event))).toBe(true);
    expect(await t.run((ctx) => canScanEvent(ctx, userId, event))).toBe(true);
  });

  it('scanner cannot scan draft events (lifecycle gate)', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Scanner');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityScanner(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {status: 'draft'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canScanEvent(ctx, userId, event))).toBe(false);
  });

  it('scanner cannot scan cancelled events (lifecycle gate)', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Scanner');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityScanner(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {status: 'cancelled'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canScanEvent(ctx, userId, event))).toBe(false);
  });

  it('community admin bypasses lifecycle gate on scan (draft)', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityAdmin(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {status: 'draft'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canScanEvent(ctx, userId, event))).toBe(true);
  });

  it('community admin bypasses lifecycle gate on scan (cancelled)', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityAdmin(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {status: 'cancelled'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canScanEvent(ctx, userId, event))).toBe(true);
  });

  it('root admin bypasses lifecycle gate on scan (draft) via global fallback', async () => {
    // Root admin uses a distinct code path (global-scope fallback in
    // canWithFallback) from community admin (scoped grant). Verify the
    // global-fallback branch also honors the event:manage bypass so the
    // lifecycle gate does not silently strand root admins on non-published
    // events.
    const t = convexTest();
    const userId = await createUser(t, 'Root');
    const orgId = await createOrganizer(t, 'Org');
    await assignRootAdmin(t, userId);
    const eventId = await createEvent(t, orgId, {status: 'draft'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canScanEvent(ctx, userId, event))).toBe(true);
  });

  it('root admin bypasses lifecycle gate on scan (cancelled) via global fallback', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Root');
    const orgId = await createOrganizer(t, 'Org');
    await assignRootAdmin(t, userId);
    const eventId = await createEvent(t, orgId, {status: 'cancelled'});
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canScanEvent(ctx, userId, event))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canManageCommunity / canViewCommunityMembers
// ---------------------------------------------------------------------------

describe('community permissions', () => {
  it('community admin can manage community', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityAdmin(t, userId, orgId);

    expect(await t.run((ctx) => canManageCommunity(ctx, userId, orgId))).toBe(
      true,
    );
  });

  it('root admin can manage any community via global fallback', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Root');
    const orgId = await createOrganizer(t, 'Org');
    await assignRootAdmin(t, userId);

    expect(await t.run((ctx) => canManageCommunity(ctx, userId, orgId))).toBe(
      true,
    );
  });

  it('member cannot manage community', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const orgId = await createOrganizer(t, 'Org');
    await assignMember(t, userId, orgId);

    expect(await t.run((ctx) => canManageCommunity(ctx, userId, orgId))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// canViewCommunityMembers
// ---------------------------------------------------------------------------

describe('canViewCommunityMembers', () => {
  it('community admin ALLOWED', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityAdmin(t, userId, orgId);

    expect(
      await t.run((ctx) => canViewCommunityMembers(ctx, userId, orgId)),
    ).toBe(true);
  });

  it('root admin ALLOWED', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Root');
    const orgId = await createOrganizer(t, 'Org');
    await assignRootAdmin(t, userId);

    expect(
      await t.run((ctx) => canViewCommunityMembers(ctx, userId, orgId)),
    ).toBe(true);
  });

  it('member DENIED', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const orgId = await createOrganizer(t, 'Org');
    await assignMember(t, userId, orgId);

    expect(
      await t.run((ctx) => canViewCommunityMembers(ctx, userId, orgId)),
    ).toBe(false);
  });

  it('scanner DENIED community member list access', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Scanner');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityScanner(t, userId, orgId);

    expect(
      await t.run((ctx) => canViewCommunityMembers(ctx, userId, orgId)),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-org isolation
// ---------------------------------------------------------------------------

describe('cross-org isolation', () => {
  it('community_admin of org A CANNOT manage org B', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin A');
    const orgA = await createOrganizer(t, 'Org A');
    const orgB = await createOrganizer(t, 'Org B');
    await assignCommunityAdmin(t, userId, orgA);

    expect(await t.run((ctx) => canManageCommunity(ctx, userId, orgB))).toBe(
      false,
    );
  });

  it('community_admin of org A CANNOT edit event in org B', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin A');
    const orgA = await createOrganizer(t, 'Org A');
    const orgB = await createOrganizer(t, 'Org B');
    await assignCommunityAdmin(t, userId, orgA);
    const eventId = await createEvent(t, orgB);
    const event = await loadEvent(t, eventId);

    expect(await t.run((ctx) => canEditEvent(ctx, userId, event))).toBe(false);
  });

  it('community_admin of org A CANNOT view members of org B', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin A');
    const orgA = await createOrganizer(t, 'Org A');
    const orgB = await createOrganizer(t, 'Org B');
    await assignCommunityAdmin(t, userId, orgA);

    expect(
      await t.run((ctx) => canViewCommunityMembers(ctx, userId, orgB)),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Internal query exports
// ---------------------------------------------------------------------------

describe('internal query exports', () => {
  it('_isEventAdmin reflects canManageEvent', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignCommunityAdmin(t, userId, orgId);
    const eventId = await createEvent(t, orgId);

    expect(
      await t.query(internal.lib.access._isEventAdmin, {userId, eventId}),
    ).toBe(true);
  });

  it('_isEventAdmin returns false for unauthorized user', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Regular');
    const orgId = await createOrganizer(t, 'Org');
    const eventId = await createEvent(t, orgId);

    expect(
      await t.query(internal.lib.access._isEventAdmin, {userId, eventId}),
    ).toBe(false);
  });

  it('_isRootAdmin reflects isPlatformAdmin', async () => {
    const t = convexTest();
    const rootId = await createUser(t, 'Root');
    const regularId = await createUser(t, 'Regular');
    await assignRootAdmin(t, rootId);

    expect(
      await t.query(internal.lib.access._isRootAdmin, {userId: rootId}),
    ).toBe(true);
    expect(
      await t.query(internal.lib.access._isRootAdmin, {userId: regularId}),
    ).toBe(false);
  });

  it('_isCommunityAdminOrRoot reflects canManageCommunity', async () => {
    const t = convexTest();
    const rootId = await createUser(t, 'Root');
    const adminId = await createUser(t, 'Admin');
    const orgId = await createOrganizer(t, 'Org');
    await assignRootAdmin(t, rootId);
    await assignCommunityAdmin(t, adminId, orgId);

    expect(
      await t.query(internal.lib.access._isCommunityAdminOrRoot, {
        userId: rootId,
        organizerId: orgId,
      }),
    ).toBe(true);
    expect(
      await t.query(internal.lib.access._isCommunityAdminOrRoot, {
        userId: adminId,
        organizerId: orgId,
      }),
    ).toBe(true);
  });
});
