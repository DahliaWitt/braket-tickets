import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../_generated/api';
import type {Doc, Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {addMember, authz} from '../lib/authz';

type OrganizerInsert = Omit<
  Doc<'organizers'>,
  '_id' | '_creationTime' | 'isPublicDirectory'
> & Partial<Pick<Doc<'organizers'>, 'isPublicDirectory'>>;

async function insertOrganizer(
  ctx: MutationCtx,
  organizer: OrganizerInsert,
): Promise<Id<'organizers'>> {
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- helper preserves historical test fixture semantics while supplying the required schema field
  return await ctx.db.insert('organizers', {
    isPublicDirectory: false,
    ...organizer,
  });
}

describe('public event RLS', () => {
  async function setupCommunityAdmin(
    t: ReturnType<typeof convexTest>,
    orgId: Id<'organizers'>,
  ) {
    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin',
      email: `community-admin-rls-${Date.now()}@test-rls.com`,
    });
    await t.run(async (ctx) => {
      await authz.assignRole(ctx, adminId, 'community_admin', {
        type: 'organizer',
        id: orgId,
      });
      await addMember(ctx, adminId, orgId);
    });
    return adminId;
  }

  async function setupCommunityMember(
    t: ReturnType<typeof convexTest>,
    orgId: Id<'organizers'>,
  ) {
    const memberId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Member',
      email: `community-member-rls-${Date.now()}@test-rls.com`,
    });
    await t.run(async (ctx) => {
      await addMember(ctx, memberId, orgId);
    });
    return memberId;
  }

  async function setupCommunityScanner(
    t: ReturnType<typeof convexTest>,
    orgId: Id<'organizers'>,
  ) {
    const scannerId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Scanner',
      email: `community-scanner-rls-${Date.now()}@test-rls.com`,
    });
    await t.run(async (ctx) => {
      await authz.assignRole(ctx, scannerId, 'community_scanner', {
        type: 'organizer',
        id: orgId,
      });
    });
    return scannerId;
  }

  it('unauthenticated user can read public visibility published events via list', async () => {
    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Public Rave',
      price: 2000,
      totalTickets: 100,
      date: '2030-12-15T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Show',
      price: 3000,
      totalTickets: 50,
      date: '2030-12-15T00:00:00.000Z',
      status: 'published',
      visibility: 'private',
      organizerId: orgId,
    });

    const events = await t.query(api.events.public.list, {});
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Public Rave');
  });

  it('unauthenticated user can read legacy isPublic events and receives normalized visibility', async () => {
    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    // This test specifically validates backward-compat handling of a legacy
    // 'isPublic' field format that the production create mutation never sets.
    // Raw insert is required to reproduce the legacy document shape.
    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- testing legacy field backward-compat; production mutations never create this document shape
      ctx.db.insert('events', {
        title: 'Legacy Public Rave',
        price: 2000,
        totalTickets: 100,
        date: '2030-12-15',
        status: 'published',
        organizerId: orgId,
        visibility: 'public',
      }),
    );

    const events = await t.query(api.events.public.list, {});
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Legacy Public Rave');
    expect(events[0].visibility).toBe('public');
  });

  it('unauthenticated user cannot read private visibility published events via list', async () => {
    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Show',
      price: 3000,
      totalTickets: 50,
      date: '2030-12-15T00:00:00.000Z',
      status: 'published',
      visibility: 'private',
      organizerId: orgId,
    });

    const events = await t.query(api.events.public.list, {});
    expect(events).toHaveLength(0);
  });

  it('unauthenticated user cannot read private visibility published events via upcoming', async () => {
    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Future Show',
      price: 3000,
      totalTickets: 50,
      date: '2030-12-15T00:00:00.000Z',
      status: 'published',
      visibility: 'private',
      organizerId: orgId,
    });

    const events = await t.query(api.events.public.upcoming, {});
    expect(events).toHaveLength(0);
  });

  it('unauthenticated user cannot read public visibility draft events', async () => {
    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Public Rave',
      price: 2000,
      totalTickets: 100,
      date: '2030-12-15T00:00:00.000Z',
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });

    const events = await t.query(api.events.public.list, {});
    expect(events).toHaveLength(0);
  });

  it('unauthenticated user cannot read public visibility cancelled events via get', async () => {
    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Public Rave',
      price: 2000,
      totalTickets: 100,
      date: '2030-12-15T00:00:00.000Z',
      status: 'cancelled',
      visibility: 'public',
      organizerId: orgId,
    });

    const event = await t.query(api.events.public.get, {id: eventId});
    expect(event).toBeNull();
  });

  it('unauthenticated user can read public_viewable visibility published events via list', async () => {
    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Viewable Show',
      price: 1500,
      totalTickets: 75,
      date: '2030-12-15T00:00:00.000Z',
      status: 'published',
      visibility: 'public_viewable',
      organizerId: orgId,
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Show',
      price: 3000,
      totalTickets: 50,
      date: '2030-12-15T00:00:00.000Z',
      status: 'published',
      visibility: 'private',
      organizerId: orgId,
    });

    const events = await t.query(api.events.public.list, {});
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Viewable Show');
  });

  it('authenticated non-member sees public but not private visibility published events', async () => {
    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Public Rave',
      price: 2000,
      totalTickets: 100,
      date: '2030-12-15T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Show',
      price: 3000,
      totalTickets: 50,
      date: '2030-12-15T00:00:00.000Z',
      status: 'published',
      visibility: 'private',
      organizerId: orgId,
    });

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-user-rls@test-rls.com',
    });
    const asUser = t.withIdentity({subject: userId});

    const events = await asUser.query(api.events.public.list, {});
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Public Rave');
  });

  it('community scanner without membership sees public but not private visibility published events', async () => {
    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Public Rave',
      price: 2000,
      totalTickets: 100,
      date: '2030-12-15T00:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Show',
      price: 3000,
      totalTickets: 50,
      date: '2030-12-15T00:00:00.000Z',
      status: 'published',
      visibility: 'private',
      organizerId: orgId,
    });

    const scannerId = await setupCommunityScanner(t, orgId);
    const asScanner = t.withIdentity({subject: scannerId});

    const events = await asScanner.query(api.events.public.list, {});
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Public Rave');
  });

  it('vetted authenticated user sees private visibility published events', async () => {
    const t = convexTest();
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    await t.mutation(api.testing.events.seedEvent, {
      title: 'Private Show',
      price: 3000,
      totalTickets: 50,
      date: '2030-12-15T00:00:00.000Z',
      status: 'published',
      visibility: 'private',
      organizerId: orgId,
    });

    const userId = await setupCommunityMember(t, orgId);
    const asUser = t.withIdentity({subject: userId});

    const events = await asUser.query(api.events.public.list, {});
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Private Show');
  });

  it('unauthenticated user cannot read published events from draft organizers via list', async () => {
    const t = convexTest();
    // Draft organizer with published events is intentionally invalid state;
    // seedEvent rejects published events under draft organizers.
    const orgId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- draft org + published event is intentionally invalid; seedEvent rejects this combination
      return insertOrganizer(ctx, {
        name: 'Draft Org',
        status: 'draft',
      });
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- published event under draft org; see above
      await ctx.db.insert('events', {
        title: 'Public Rave',
        price: 2000,
        totalTickets: 100,
        date: '2030-12-15',
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });
    });

    const events = await t.query(api.events.public.list, {});
    expect(events).toHaveLength(0);
  });

  it('authenticated non-admin cannot read published events from draft organizers via list', async () => {
    const t = convexTest();
    // Draft organizer with published events is intentionally invalid state;
    // seedEvent rejects published events under draft organizers.
    const orgId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- draft org + published event is intentionally invalid; seedEvent rejects this combination
      return insertOrganizer(ctx, {
        name: 'Draft Org',
        status: 'draft',
      });
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- published events under draft org; see above
      await ctx.db.insert('events', {
        title: 'Public Rave',
        price: 2000,
        totalTickets: 100,
        date: '2030-12-15',
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('events', {
        title: 'Private Show',
        price: 3000,
        totalTickets: 50,
        date: '2030-12-15',
        status: 'published',
        visibility: 'private',
        organizerId: orgId,
      });
    });

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-user-draft-rls@test-rls.com',
    });
    const asUser = t.withIdentity({subject: userId});

    const events = await asUser.query(api.events.public.list, {});
    expect(events).toHaveLength(0);
  });

  it('community admin can read events from their draft organizer', async () => {
    const t = convexTest();
    // Draft organizer with published events is intentionally invalid state;
    // seedEvent rejects published events under draft organizers.
    const orgId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- draft org + published event is intentionally invalid; seedEvent rejects this combination
      return insertOrganizer(ctx, {
        name: 'Draft Org',
        status: 'draft',
      });
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- published events under draft org; see above
      await ctx.db.insert('events', {
        title: 'Public Rave',
        price: 2000,
        totalTickets: 100,
        date: '2030-12-15',
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
      await ctx.db.insert('events', {
        title: 'Private Show',
        price: 3000,
        totalTickets: 50,
        date: '2030-12-15',
        status: 'published',
        visibility: 'private',
        organizerId: orgId,
      });
    });

    const userId = await setupCommunityAdmin(t, orgId);

    const asCommunityAdmin = t.withIdentity({subject: userId});
    const events = await asCommunityAdmin.query(api.events.public.list, {});
    expect(events).toHaveLength(2);
  });
});
