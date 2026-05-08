import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {ErrorMessages} from '../lib/errors';
import {addMember, authz} from '../lib/authz';

async function setupRootAdmin(t: ReturnType<typeof convexTest>, name: string) {
  return t.mutation(api.testing.users.createUserDirectly, {
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '-')}-perm@test-permissions.com`,
    isRootAdmin: true,
  });
}

describe('Events Admin Actions', () => {
  it('create event requires admin', async () => {
    const t = convexTest();
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular',
      email: 'regular-create@test-permissions.com',
    });
    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: 'test-org',
    });
    const asUser = t.withIdentity({subject: userId});

    await expect(asUser.mutation(api.events.management.create, {
      title: 'New Event',
      date: '2026-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'draft',
      visibility: 'private',
      organizerId,
    })).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
  });

  it('create event works for admin', async () => {
    const t = convexTest();
    const adminId = await setupRootAdmin(t, 'Admin');
    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: 'test-org',
    });
    const asAdmin = t.withIdentity({subject: adminId});

    const eventId = await asAdmin.mutation(api.events.management.create, {
      title: 'Admin Event',
      date: '2026-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'private',
      organizerId,
    });

    expect(eventId).toBeDefined();

    // Verify it exists
    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.title).toBe('Admin Event');
  });

  it('update event requires admin', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: 'test-org',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Original',
      date: '2026-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular',
      email: 'regular-update@test-permissions.com',
    });
    const asUser = t.withIdentity({subject: userId});

    await expect(asUser.mutation(api.events.management.update, {
      id: eventId,
      title: 'Hacked',
    })).rejects.toThrow(ErrorMessages.UNAUTHORIZED);
  });

  it('update event works for admin', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: 'test-org',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Original',
      date: '2026-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const adminId = await setupRootAdmin(t, 'Admin');
    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.events.management.update, {
      id: eventId,
      title: 'Updated',
    });

    const event = await t.run(async (ctx) => ctx.db.get('events', eventId as Id<'events'>));
    expect(event?.title).toBe('Updated');
  });

  it('update event cannot reassign organizer without destination access', async () => {
    const t = convexTest();
    const orgA = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org A',
      slug: 'org-a',
    });
    const orgB = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org B',
      slug: 'org-b',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Org A Event',
      date: '2026-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgA,
    });

    const adminAId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin A',
      email: 'admin-a-move-event@test-permissions.com',
    });
    await t.run(async (ctx) => {
      await authz.assignRole(ctx, adminAId as string, 'community_admin', {
        type: 'organizer',
        id: orgA as string,
      });
      await addMember(ctx, adminAId, orgA);
    });

    const asAdminA = t.withIdentity({subject: adminAId});
    await expect(asAdminA.mutation(api.events.management.update, {
      id: eventId,
      organizerId: orgB,
    })).rejects.toThrow(ErrorMessages.UNAUTHORIZED);

    const event = await t.run(async (ctx) =>
      ctx.db.get('events', eventId as Id<'events'>),
    );
    expect(event?.organizerId).toBe(orgA);
  });

  it('update event can reassign organizer with destination access', async () => {
    const t = convexTest();
    const orgA = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org A',
      slug: 'org-a',
    });
    const orgB = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org B',
      slug: 'org-b',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Org A Event',
      date: '2026-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgA,
    });

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin AB',
      email: 'admin-ab-move-event@test-permissions.com',
    });
    await t.run(async (ctx) => {
      await authz.assignRole(ctx, adminId as string, 'community_admin', {
        type: 'organizer',
        id: orgA as string,
      });
      await authz.assignRole(ctx, adminId as string, 'community_admin', {
        type: 'organizer',
        id: orgB as string,
      });
      await addMember(ctx, adminId, orgA);
      await addMember(ctx, adminId, orgB);
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await asAdmin.mutation(api.events.management.update, {
      id: eventId,
      organizerId: orgB,
    });

    const event = await t.run(async (ctx) =>
      ctx.db.get('events', eventId as Id<'events'>),
    );
    expect(event?.organizerId).toBe(orgB);

    const auditLogs = await t.run(async (ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    const fromLog = auditLogs.find(
      (log) => log.action === 'event.organizer_reassign.from',
    );
    expect(fromLog?.organizerId).toBe(orgA);
    const toLog = auditLogs.find(
      (log) => log.action === 'event.organizer_reassign.to',
    );
    expect(toLog?.organizerId).toBe(orgB);
  });

  it('update event with no changes is a no-op', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
      slug: 'test-org-noop',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Original',
      date: '2026-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const adminId = await setupRootAdmin(t, 'Noop Admin');
    const asAdmin = t.withIdentity({subject: adminId});

    const before = await t.run(async (ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    await asAdmin.mutation(api.events.management.update, {id: eventId});
    const after = await t.run(async (ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .collect(),
    );

    expect(after.length).toBe(before.length);
  });
});

describe('getForEdit community scoping', () => {
  it('rejects unauthenticated users', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org',
      slug: 'org',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test',
      date: '2026-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await expect(t.query(api.events.management.getForEdit, {id: eventId}))
      .rejects.toThrow(ErrorMessages.UNAUTHENTICATED);
  });

  it('rejects community admin from a different community', async () => {
    const t = convexTest();
    const orgA = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org A',
      slug: 'org-a',
    });
    const orgB = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org B',
      slug: 'org-b',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Org A Event',
      date: '2026-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgA,
    });
    const foreignAdminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin B',
      email: 'admin-b-perm@test-permissions.com',
    });
    await t.run(async (ctx) => {
      await authz.assignRole(ctx, foreignAdminId as string, 'community_admin', {
        type: 'organizer',
        id: orgB as string,
      });
      await addMember(ctx, foreignAdminId, orgB);
    });

    const asForeignAdmin = t.withIdentity({subject: foreignAdminId});
    await expect(asForeignAdmin.query(api.events.management.getForEdit, {id: eventId}))
      .rejects.toThrow(ErrorMessages.UNAUTHORIZED);
  });

  it('allows community admin of the same community', async () => {
    const t = convexTest();
    const orgA = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org A',
      slug: 'org-a',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Org A Event',
      date: '2026-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgA,
    });
    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin A',
      email: 'admin-a-perm@test-permissions.com',
    });
    await t.run(async (ctx) => {
      await authz.assignRole(ctx, adminId as string, 'community_admin', {
        type: 'organizer',
        id: orgA as string,
      });
      await addMember(ctx, adminId, orgA);
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(api.events.management.getForEdit, {id: eventId});
    expect(result).toBeDefined();
    expect(result.title).toBe('Org A Event');
  });

  it('allows root admin to edit any event', async () => {
    const t = convexTest();
    const orgA = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org A',
      slug: 'org-a',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Org A Event',
      date: '2026-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgA,
    });
    const rootAdminId = await setupRootAdmin(t, 'Root Admin');

    const asRoot = t.withIdentity({subject: rootAdminId});
    const result = await asRoot.query(api.events.management.getForEdit, {id: eventId});
    expect(result).toBeDefined();
    expect(result.title).toBe('Org A Event');
  });
});
