import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {addMember, authz} from '../lib/authz';

async function createRootAdmin(
  t: ReturnType<typeof convexTest>,
  name: string,
  email = 'admin@test.com',
): Promise<Id<'users'>> {
  return t.mutation(api.testing.users.createUserDirectly, {
    name,
    email,
    isRootAdmin: true,
  });
}

async function seedCommunityScanner(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, userId, 'community_scanner', {
      type: 'organizer',
      id: organizerId,
    });
    await addMember(ctx, userId, organizerId);
  });
}

describe('Tickets', () => {
  it('requires explicit trust source when seedTicket auto-creates order and payment records', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Seed Buyer',
      email: 'seed-buyer@example.com',
    });

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Seed Org',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Seed Event',
      date: '2026-01-01',
      price: 100,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await expect(
      t.mutation(api.testing.tickets.seedTicket, {
        userId,
        eventId,
        status: 'valid',
        tier: 'regular',
      }),
    ).rejects.toThrow('seedTicket auto-create requires explicit trustSource');
  });

  it('getMyTickets returns tickets with event details', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Test User',
      email: 'test@example.com',
    });

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });

    const eventId1 = await t.mutation(api.testing.events.seedEvent, {
      title: 'Event 1',
      date: '2025-01-01',
      price: 100,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    const eventId2 = await t.mutation(api.testing.events.seedEvent, {
      title: 'Event 2',
      date: '2025-01-02',
      price: 200,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await t.mutation(api.testing.tickets.seedTicket, {
      userId,
      eventId: eventId1,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });
    await t.mutation(api.testing.tickets.seedTicket, {
      userId,
      eventId: eventId1,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });
    await t.mutation(api.testing.tickets.seedTicket, {
      userId,
      eventId: eventId2,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    const user = t.withIdentity({subject: userId});
    const tickets = await user.query(api.tickets.public.getMyTickets, {});

    expect(tickets.length).toBe(3);

    const t1 = tickets.find(
      (t) => t.eventId === eventId1 && t.event?.title === 'Event 1',
    );
    const t2 = tickets.find(
      (t) => t.eventId === eventId2 && t.event?.title === 'Event 2',
    );

    expect(t1).toBeDefined();
    expect(t1?.event).toBeDefined();
    expect(t2).toBeDefined();
    expect(t2?.event).toBeDefined();
  });

  it('normalizes legacy event visibility in ticket reads', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Legacy Holder',
      email: 'legacy-holder@example.com',
    });

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Legacy Org',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Legacy Visibility Event',
      date: '2026-08-01',
      price: 2500,
      totalTickets: 25,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
      userId,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    const user = t.withIdentity({subject: userId});

    const tickets = await user.query(api.tickets.public.getMyTickets, {});
    expect(tickets).toHaveLength(1);
    expect(tickets[0].event?.visibility).toBe('public');
    expect(tickets[0].event).not.toHaveProperty('isPublic');

    const ticket = await user.query(api.tickets.public.get, {id: ticketId});
    expect(ticket?.event?.visibility).toBe('public');
    expect(ticket?.event).not.toHaveProperty('isPublic');
  });

  it('getMyTickets returns event details even when organizer is draft', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Ticket Holder',
      email: 'holder@example.com',
    });

    // Create a draft organizer — isDraftOrganizer returns true for this,
    // which causes the events RLS read rule to block non-admin readers.
    const draftOrgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Draft Community',
      status: 'draft',
    });

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- seedEvent rejects published events under draft organizers; raw insert required to test that getMyTickets still returns event details despite draft organizer status */
    const eventId = await t.run(async (ctx) =>
      ctx.db.insert('events', {
        title: 'Draft Org Event',
        date: '2026-06-01',
        price: 2000,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        organizerId: draftOrgId,
      }),
    );
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    await t.mutation(api.testing.tickets.seedTicket, {
      userId,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    const user = t.withIdentity({subject: userId});
    const tickets = await user.query(api.tickets.public.getMyTickets, {});

    expect(tickets.length).toBe(1);
    // The fix: event enrichment uses rawDb, so draft-organizer events are
    // still returned. Before the fix, event was null here.
    expect(tickets[0].event).not.toBeNull();
    expect(tickets[0].event?.title).toBe('Draft Org Event');
  });

  it('getMyTickets returns tickets with roster projection fields', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Roster Holder',
      email: 'roster-holder@example.com',
    });

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Roster Org',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Roster Event',
      date: '2026-06-01',
      price: 1500,
      totalTickets: 25,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- seedTicket does not support roster projection fields (rosterAttendeeName, rosterEmail, etc.); raw insert required to test denormalization */
    await t.run(async (ctx) => {
      await ctx.db.insert('tickets', {
        userId,
        eventId,
        status: 'valid',
        tier: 'regular',
        rosterAttendeeName: 'Roster Holder',
        rosterAttendeeNameLower: 'roster holder',
        rosterEmail: 'roster-holder@example.com',
        rosterEmailLower: 'roster-holder@example.com',
        rosterCheckedInByName: null,
        rosterStatus: 'valid',
        rosterIsActive: true,
        rosterSortKey: 'roster holder\u0000ticket-1',
      });
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const user = t.withIdentity({subject: userId});
    const tickets = await user.query(api.tickets.public.getMyTickets, {});

    expect(tickets).toHaveLength(1);
    expect(tickets[0].rosterAttendeeName).toBe('Roster Holder');
    expect(tickets[0].rosterEmail).toBe('roster-holder@example.com');
    expect(tickets[0].rosterStatus).toBe('valid');
  });

  it('listByEvent returns tickets with user details', async () => {
    const t = convexTest();

    const adminId = await createRootAdmin(t, 'Admin');

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Admin Event',
      date: '2025-01-01',
      price: 100,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    const u1 = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User 1',
      email: 'user1@test.com',
    });
    const u2 = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User 2',
      email: 'user2@test.com',
    });

    await t.mutation(api.testing.tickets.seedTicket, {
      userId: u1,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });
    await t.mutation(api.testing.tickets.seedTicket, {
      userId: u2,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    const admin = t.withIdentity({subject: adminId});
    const tickets = await admin.query(api.tickets.public.listByEvent, {eventId});

    expect(tickets.length).toBe(2);
    expect(tickets[0].user).toBeDefined();
    expect(tickets[1].user).toBeDefined();

    const names = tickets.map((t) => t.user?.name).sort();
    expect(names).toEqual(['User 1', 'User 2']);
  });

  describe('listByEvent - door staff access', () => {
    it('allows door staff to list tickets for assigned event', async () => {
      const t = convexTest();

      await createRootAdmin(t, 'Admin', 'admin@test.com');
      const doorId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Door Person',
          email: 'door@test.com',
        },
      );
      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Attendee',
          email: 'attendee@test.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Staff Event',
        date: '2026-03-01',
        price: 1000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      // Assign door staff via the community-scoped scanner role
      await seedCommunityScanner(t, doorId, orgId);

      const asDoor = t.withIdentity({subject: doorId});
      const tickets = await asDoor.query(api.tickets.public.listByEvent, {eventId});

      expect(tickets.length).toBe(1);
      expect(tickets[0].user).toBeDefined();
      expect(tickets[0].user?.name).toBe('Attendee');
    });

    it('rejects door staff listing tickets for unassigned event', async () => {
      const t = convexTest();

      await createRootAdmin(t, 'Admin', 'admin@test.com');
      const doorId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Door Person',
          email: 'door@test.com',
        },
      );

      const org1Id = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Org 1',
      });
      const org2Id = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Org 2',
      });
      await t.mutation(api.testing.events.seedEvent, {
        title: 'Event 1',
        date: '2026-03-01',
        price: 1000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: org1Id,
      });
      const event2Id = await t.mutation(api.testing.events.seedEvent, {
        title: 'Event 2',
        date: '2026-03-01',
        price: 1000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: org2Id,
      });

      // Assign door staff to org1 only
      await seedCommunityScanner(t, doorId, org1Id);

      const asDoor = t.withIdentity({subject: doorId});

      await expect(
        asDoor.query(api.tickets.public.listByEvent, {eventId: event2Id}),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('listByEvent - community_scanners RBAC path', () => {
    it('allows community scanner to list tickets', async () => {
      const t = convexTest();

      await createRootAdmin(t, 'Admin', 'admin@test.com');
      const scannerId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Scanner',
          email: 'scanner@test.com',
        },
      );
      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Attendee',
          email: 'attendee@test.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Scanner Test Event',
        date: '2026-05-01',
        price: 1000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      // Assign via community_scanners
      await seedCommunityScanner(t, scannerId, orgId);

      const asScanner = t.withIdentity({subject: scannerId});
      const tickets = await asScanner.query(api.tickets.public.listByEvent, {eventId});

      expect(tickets.length).toBe(1);
      expect(tickets[0].user?.name).toBe('Attendee');
    });

    it('rejects a scanner not assigned to this community', async () => {
      const t = convexTest();

      await createRootAdmin(t, 'Admin', 'admin@test.com');
      const scannerId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Other Scanner',
          email: 'other@test.com',
        },
      );

      const org1Id = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Org 1',
      });
      const org2Id = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Org 2',
      });

      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Org 2 Event',
        date: '2026-05-01',
        price: 1000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: org2Id,
      });

      // Scanner is assigned to org1, not org2
      await seedCommunityScanner(t, scannerId, org1Id);

      const asScanner = t.withIdentity({subject: scannerId});

      await expect(
        asScanner.query(api.tickets.public.listByEvent, {eventId}),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('listByEvent - guestEmail population', () => {
    it('populates guestEmail from guest_sessions for guest checkout tickets', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, 'Admin');
      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Guest Email Event',
        date: '2026-06-01',
        price: 500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- no public seed for guest_sessions; bcrypt/email not available in edge-runtime */
      const guestSessionId = await t.run(async (ctx) =>
        ctx.db.insert('guest_sessions', {
          email: 'guest@checkout.com',
          sessionToken: 'tok-abc-123',
          expiresAt: Date.now() + 86400000,
        }),
      );
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- guest ticket has no userId (guest checkout); seedTicket requires userId */
      await t.run(async (ctx) => {
        await ctx.db.insert('tickets', {
          guestSessionId,
          eventId,
          status: 'valid',
          tier: 'regular',
        });
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      const admin = t.withIdentity({subject: adminId});
      const tickets = await admin.query(api.tickets.public.listByEvent, {eventId});

      expect(tickets.length).toBe(1);
      expect(tickets[0].guestEmail).toBe('guest@checkout.com');
      expect(tickets[0].user).toBeNull();
    });

    it('gracefully returns undefined guestEmail when guest_session is deleted', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, 'Admin');
      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Deleted Session Event',
        date: '2026-06-01',
        price: 500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- no public seed for guest_sessions; creating and immediately deleting to simulate orphaned ticket */
      const guestSessionId = await t.run(async (ctx) => {
        const id = await ctx.db.insert('guest_sessions', {
          email: 'deleted@guest.com',
          sessionToken: 'tok-deleted-456',
          expiresAt: Date.now() + 86400000,
        });
        // Immediately delete to simulate orphaned ticket
        await ctx.db.delete(id);
        return id;
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- guest ticket has no userId (guest checkout); seedTicket requires userId */
      await t.run(async (ctx) => {
        await ctx.db.insert('tickets', {
          guestSessionId,
          eventId,
          status: 'valid',
          tier: 'regular',
        });
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      const admin = t.withIdentity({subject: adminId});
      const tickets = await admin.query(api.tickets.public.listByEvent, {eventId});

      expect(tickets.length).toBe(1);
      // Deleted session → guestEmail is undefined, not an error
      expect(tickets[0].guestEmail).toBeUndefined();
    });
  });

  describe('Internal Ticket Queries', () => {
    it('getTicketsByOrderInternal returns tickets by order ID', async () => {
      const t = convexTest();

      const userId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Buyer',
          email: 'buyer@test.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Event',
        date: '2025-01-01',
        price: 100,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      const orderId = await t.mutation(api.testing.orders.seedPayment, {
        userId,
        eventId,
        amount: 100,
        status: 'completed',
        quantity: 1,
        trustSource: 'open_access',
      });

      // Create ticket linked to order
      const ticketWithOrder = await t.mutation(
        api.testing.tickets.seedTicket,
        {
          userId,
          eventId,
          orderId,
          status: 'valid',
          tier: 'regular',
        },
      );

      // Create unrelated ticket (different order)
      await t.mutation(api.testing.tickets.seedTicket, {
        userId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      const tickets = await t.run(async (ctx) => {
        return await ctx.runQuery(
          internal.tickets.public.getTicketsByOrderInternal,
          {orderId},
        );
      });

      expect(tickets.length).toBe(1);
      expect(tickets[0]._id).toBe(ticketWithOrder);
      expect(tickets[0].orderId).toBe(orderId);
    });

    it('getTicketByOrderInternal finds ticket with order ID', async () => {
      const t = convexTest();

      const userId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Buyer',
          email: 'buyer@test.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Event',
        date: '2025-01-01',
        price: 100,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      const orderId = await t.mutation(api.testing.orders.seedPayment, {
        userId,
        eventId,
        amount: 100,
        status: 'completed',
        quantity: 1,
        trustSource: 'open_access',
      });

      // Create ticket linked to order
      await t.mutation(api.testing.tickets.seedTicket, {
        userId,
        eventId,
        orderId,
        status: 'valid',
        tier: 'regular',
      });

      const ticket = await t.run(async (ctx) => {
        return await ctx.runQuery(internal.tickets.public.getTicketByOrderInternal, {
          orderId,
        });
      });

      expect(ticket).toBeDefined();
      expect(ticket?.orderId).toBe(orderId);
    });

    it('getTicketByOrderInternal returns null when no ticket is linked to the order', async () => {
      const t = convexTest();

      const userId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Buyer',
          email: 'buyer@test.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Event',
        date: '2025-01-01',
        price: 100,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      const orderId = await t.mutation(api.testing.orders.seedPayment, {
        userId,
        eventId,
        amount: 100,
        status: 'completed',
        quantity: 1,
        trustSource: 'open_access',
      });

      // Create ticket NOT linked to this order
      await t.mutation(api.testing.tickets.seedTicket, {
        userId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      const ticket = await t.run(async (ctx) => {
        return await ctx.runQuery(internal.tickets.public.getTicketByOrderInternal, {
          orderId,
        });
      });

      expect(ticket).toBeNull();
    });
  });
});
