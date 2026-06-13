import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {describe, it, expect, vi} from 'vitest';
import type {Id} from '../_generated/dataModel';
import {api} from '../_generated/api';
import {authz} from '../lib/authz';

async function createRootAdmin(
  t: ReturnType<typeof convexTest>,
  user: {name: string; email?: string},
): Promise<Id<'users'>> {
  return t.mutation(api.testing.users.createUserDirectly, {
    name: user.name,
    email:
      user.email ??
      `admin-${user.name.toLowerCase().replace(/\s+/g, '-')}@test.com`,
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
  });
}

describe('ticketCheckIn.checkIn', () => {
  describe('invalid QR codes', () => {
    it('handles invalid ticket QR codes gracefully', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin User',
        email: 'admin@example.com',
      });

      const asAdmin = t.withIdentity({subject: adminId});

      const ticketRes = await asAdmin.mutation(api.events.check_in.checkIn, {
        ticketId: 'invalid-id-string',
      });

      expect(ticketRes.success).toBe(false);
      expect(ticketRes.message).toContain('Invalid Ticket QR Code');
    });

    it('handles invalid guest QR codes gracefully', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin User',
      });

      const asAdmin = t.withIdentity({subject: adminId});

      const guestRes = await asAdmin.mutation(api.events.check_in.checkIn, {
        guestId: 'invalid-id-string',
      });

      expect(guestRes.success).toBe(false);
      expect(guestRes.message).toContain('Invalid Guest QR Code');
    });
  });

  describe('authentication', () => {
    it('rejects non-admin, non-staff users for valid ticket', async () => {
      const t = convexTest();

      const userId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Regular User',
        email: 'regular@example.com',
      });

      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Attendee',
          email: 'attendee@example.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-01-01',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      const asUser = t.withIdentity({subject: userId});

      // Unauthorized callers receive a uniform "Ticket not found" response
      // (not an auth error) so they cannot probe ticket existence across
      // orgs by diffing response shapes.
      const result = await asUser.mutation(api.events.check_in.checkIn, {
        ticketId,
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Ticket not found');
    });

    it('throws for unauthenticated users', async () => {
      const t = convexTest();

      await expect(
        t.mutation(api.events.check_in.checkIn, {
          ticketId: 'some-id',
        }),
      ).rejects.toThrow('Unauthenticated');
    });
  });

  describe('ticket check-in', () => {
    it('successfully checks in a valid ticket', async () => {
      vi.useFakeTimers();
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
      });

      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Attendee',
          email: 'attendee@example.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-01-01',
        location: 'Test Venue',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      const asAdmin = t.withIdentity({subject: adminId});
      const beforeCheckIn = Date.now();

      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        ticketId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully checked in');
      expect(result.ticket).toBeDefined();
      expect(result.ticket?.status).toBe('used');
      expect(result.ticket?.checkedInBy).toBe(adminId);
      expect(result.ticket?.checkedInAt).toBeGreaterThanOrEqual(beforeCheckIn);
      expect(result.ticket?.event?.title).toBe('Test Event');
      expect(result.ticket?.user?.name).toBe('Attendee');

      await finishAllScheduledFunctions(t);

      const auditLogs = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].action).toBe('ticket.check-in');
      expect(auditLogs[0].eventId).toBe(eventId);
      vi.useRealTimers();
    });

    it('rejects already used ticket', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
      });

      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Attendee',
          email: 'attendee@example.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-01-01',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- seedTicket does not support pre-set checkedInAt/checkedInBy state; raw insert required to simulate already-used ticket */
      const ticketId = await t.run(async (ctx) =>
        ctx.db.insert('tickets', {
          userId: attendeeId,
          eventId,
          status: 'used', // Already used
          tier: 'regular',
          checkedInAt: Date.now() - 3600000, // 1 hour ago
          checkedInBy: adminId,
        }),
      );
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      const asAdmin = t.withIdentity({subject: adminId});

      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        ticketId,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Ticket is used');
      expect(result.ticket?.status).toBe('used');
    });

    it('rejects refunded ticket', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
      });

      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Attendee',
          email: 'attendee@example.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-01-01',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'refunded',
        tier: 'regular',
        trustSource: 'open_access',
      });

      const asAdmin = t.withIdentity({subject: adminId});

      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        ticketId,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Ticket is refunded');
    });

    it('returns ticket not found for non-existent ticket', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
      });

      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Attendee',
          email: 'attendee@example.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-01-01',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      // Create and delete a ticket to get a valid but non-existent ID
      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- deleting ticket to simulate non-existent ID; no public delete mutation for tickets
      await t.run(async (ctx) => ctx.db.delete(ticketId));

      const asAdmin = t.withIdentity({subject: adminId});

      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        ticketId,
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Ticket not found');
    });
  });

  describe('guest check-in', () => {
    it('successfully checks in a guest', async () => {
      vi.useFakeTimers();
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
      });

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'VIP Event',
        date: '2026-01-01',
        location: 'VIP Lounge',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      const guestId = await t.mutation(api.testing.guests.seedGuest, {
        eventId,
        name: 'VIP Guest',
        email: 'vip@example.com',
        type: 'artist guest',
        notes: 'Headliner DJ',
      });

      const asAdmin = t.withIdentity({subject: adminId});
      const beforeCheckIn = Date.now();

      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        guestId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Guest Checked In: VIP Guest');
      expect(result.guest).toBeDefined();
      expect(result.guest?.name).toBe('VIP Guest');
      expect(result.guest?.type).toBe('artist guest');
      expect(result.guest?.notes).toBe('Headliner DJ');
      expect(result.guest?.checkedInBy).toBe(adminId);
      expect(result.guest?.checkedInAt).toBeGreaterThanOrEqual(beforeCheckIn);
      expect(result.guest?.event?.title).toBe('VIP Event');

      await finishAllScheduledFunctions(t);

      const auditLogs = await t.run(async (ctx) =>
        ctx.db.query('adminAuditLogs').collect(),
      );
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].action).toBe('guest.check-in');
      vi.useRealTimers();
    });

    it('rejects already checked-in guest', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
      });

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-01-01',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- seedGuest does not support pre-set checkedInAt/checkedInBy; raw insert required to simulate already-checked-in guest */
      const checkedInAt = new Date('2026-02-27T07:30:00.000Z').getTime();
      const guestId = await t.run(async (ctx) =>
        ctx.db.insert('guests', {
          eventId,
          name: 'Already Here Guest',
          type: 'guest',
          checkedInAt,
          checkedInBy: adminId,
        }),
      );
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      const asAdmin = t.withIdentity({subject: adminId});

      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        guestId,
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Guest already checked in at 11:30:00 PM');
      expect(result.guest?.checkedInAt).toBeDefined();
    });

    it('returns guest not found for non-existent guest', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
      });

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-01-01',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      // Create and delete a guest to get a valid but non-existent ID
      const guestId = await t.mutation(api.testing.guests.seedGuest, {
        eventId,
        name: 'Temporary',
        type: 'guest',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- deleting guest to simulate non-existent ID; no public delete mutation for guests
      await t.run(async (ctx) => ctx.db.delete(guestId));

      const asAdmin = t.withIdentity({subject: adminId});

      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        guestId,
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Guest ticket not found');
    });
  });

  describe('edge cases', () => {
    it('returns error when no ticket or guest ID provided', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
      });

      const asAdmin = t.withIdentity({subject: adminId});

      const result = await asAdmin.mutation(api.events.check_in.checkIn, {});

      expect(result.success).toBe(false);
      expect(result.message).toBe('No ticket or guest ID provided');
    });

    it('checks in supporter tier tickets', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
      });

      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Supporter',
          email: 'supporter@example.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-01-01',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'supporter',
        trustSource: 'open_access',
      });

      const asAdmin = t.withIdentity({subject: adminId});

      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        ticketId,
      });

      expect(result.success).toBe(true);
      expect(result.ticket?.tier).toBe('supporter');
    });

    it('checks in notaflof tier tickets', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
      });

      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'NOTAFLOF User',
          email: 'notaflof@example.com',
        },
      );

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-01-01',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'notaflof',
        trustSource: 'open_access',
      });

      const asAdmin = t.withIdentity({subject: adminId});

      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        ticketId,
      });

      expect(result.success).toBe(true);
      expect(result.ticket?.tier).toBe('notaflof');
    });

    it('checks in staff guest type', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
      });

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-01-01',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });

      const guestId = await t.mutation(api.testing.guests.seedGuest, {
        eventId,
        name: 'Security Guard',
        type: 'staff',
      });

      const asAdmin = t.withIdentity({subject: adminId});

      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        guestId,
      });

      expect(result.success).toBe(true);
      expect(result.guest?.type).toBe('staff');
    });
  });

  describe('ticket tiers', () => {
    it.each(['regular', 'supporter', 'notaflof'] as const)(
      'checks in %s tier ticket successfully',
      async (tier) => {
        const t = convexTest();

        const adminId = await createRootAdmin(t, {
          name: 'Admin',
          email: 'admin@test.com',
        });

        const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
          name: 'Test Org',
        });
        const eventId = await t.mutation(api.testing.events.seedEvent, {
          title: 'Tier Test Event',
          date: '2030-06-01',
          price: 2000,
          totalTickets: 100,
          status: 'published',
          visibility: 'public',
          location: 'Test Location',
          organizerId: orgId,
        });

        const userId = await t.mutation(api.testing.users.createUserDirectly, {
          name: 'Attendee',
          email: 'attendee@test.com',
        });

        const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
          userId,
          eventId,
          status: 'valid',
          tier,
          trustSource: 'open_access',
        });

        const asAdmin = t.withIdentity({subject: adminId});
        const result = await asAdmin.mutation(api.events.check_in.checkIn, {
          ticketId,
        });

        expect(result.success).toBe(true);
        expect(result.ticket?.tier).toBe(tier);
        expect(result.ticket?.status).toBe('used');
      },
    );
  });

  describe('guest types', () => {
    it.each(['guest', 'artist guest', 'staff'] as const)(
      'checks in %s type guest successfully',
      async (guestType) => {
        const t = convexTest();

        const adminId = await createRootAdmin(t, {
          name: 'Admin',
          email: 'admin@test.com',
        });

        const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
          name: 'Test Org',
        });
        const eventId = await t.mutation(api.testing.events.seedEvent, {
          title: 'Guest Type Test Event',
          date: '2030-07-01',
          price: 2000,
          totalTickets: 100,
          status: 'published',
          visibility: 'public',
          location: 'Test Location',
          organizerId: orgId,
        });

        const guestId = await t.mutation(api.testing.guests.seedGuest, {
          eventId,
          name: `Test ${guestType}`,
          type: guestType,
        });

        const asAdmin = t.withIdentity({subject: adminId});
        const result = await asAdmin.mutation(api.events.check_in.checkIn, {
          guestId,
        });

        expect(result.success).toBe(true);
        expect(result.guest?.type).toBe(guestType);
        expect(result.guest?.checkedInAt).toBeDefined();
      },
    );
  });

  describe('door staff authorization', () => {
    it('allows door staff to check in tickets for their assigned event', async () => {
      const t = convexTest();

      await createRootAdmin(t, {
        name: 'Admin',
        email: 'admin@test.com',
      });
      const doorId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Door Person',
        email: 'door@test.com',
      });
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
        title: 'Test Event',
        date: '2026-03-01',
        price: 1000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });
      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      // Assign door staff via authz scoped role assignment
      await seedCommunityScanner(t, doorId, orgId);

      const asDoor = t.withIdentity({subject: doorId});
      const result = await asDoor.mutation(api.events.check_in.checkIn, {
        ticketId,
      });

      expect(result.success).toBe(true);
      expect(result.ticket?.status).toBe('used');
      expect(result.ticket?.checkedInBy).toBe(doorId);
    });

    it('rejects door staff scanning tickets for unassigned events', async () => {
      const t = convexTest();

      await createRootAdmin(t, {
        name: 'Admin',
        email: 'admin@test.com',
      });
      const doorId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Door Person',
        email: 'door@test.com',
      });
      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Attendee',
          email: 'attendee@test.com',
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
      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId: event2Id,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      // Assign door staff to org1 only
      await seedCommunityScanner(t, doorId, org1Id);

      const asDoor = t.withIdentity({subject: doorId});

      const result = await asDoor.mutation(api.events.check_in.checkIn, {
        ticketId,
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Ticket not found');
    });

    it('allows door staff to check in guests for their assigned event', async () => {
      const t = convexTest();

      await createRootAdmin(t, {
        name: 'Admin',
        email: 'admin@test.com',
      });
      const doorId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Door Person',
        email: 'door@test.com',
      });
      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Guest Event',
        date: '2026-03-01',
        price: 1000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });
      const guestId = await t.mutation(api.testing.guests.seedGuest, {
        eventId,
        name: 'VIP Guest',
        email: 'vip@test.com',
        type: 'guest',
      });

      // Assign door staff via authz scoped role assignment
      await seedCommunityScanner(t, doorId, orgId);

      const asDoor = t.withIdentity({subject: doorId});
      const result = await asDoor.mutation(api.events.check_in.checkIn, {
        guestId,
      });

      expect(result.success).toBe(true);
      expect(result.guest?.name).toBe('VIP Guest');
      expect(result.guest?.checkedInBy).toBe(doorId);
    });

    it('rejects door staff scanning guests for unassigned events', async () => {
      const t = convexTest();

      await createRootAdmin(t, {
        name: 'Admin',
        email: 'admin@test.com',
      });
      const doorId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Door Person',
        email: 'door@test.com',
      });
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
      const guestId = await t.mutation(api.testing.guests.seedGuest, {
        eventId: event2Id,
        name: 'VIP Guest',
        type: 'guest',
      });

      // Assign door staff to org1 only
      await seedCommunityScanner(t, doorId, org1Id);

      const asDoor = t.withIdentity({subject: doorId});

      const result = await asDoor.mutation(api.events.check_in.checkIn, {
        guestId,
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Guest ticket not found');
    });

    it('regular users without community scanner access are rejected', async () => {
      const t = convexTest();

      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Attendee',
          email: 'attendee@example.com',
        },
      );
      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Test Event',
        date: '2026-03-01',
        price: 1000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      });
      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      const randomUserId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Random User',
          email: 'random@example.com',
        },
      );

      const asRandom = t.withIdentity({subject: randomUserId});

      const result = await asRandom.mutation(api.events.check_in.checkIn, {
        ticketId,
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Ticket not found');
    });

    it('rejects scanner when event is in draft status (lifecycle gate)', async () => {
      const t = convexTest();

      const scannerId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Scanner',
        email: 'scanner-draft@test.com',
      });
      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {name: 'Attendee', email: 'attendee-draft@test.com'},
      );
      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Draft Event',
        date: '2030-06-01',
        price: 1000,
        totalTickets: 100,
        status: 'draft',
        visibility: 'public',
        organizerId: orgId,
      });
      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });
      await seedCommunityScanner(t, scannerId, orgId);

      const asScanner = t.withIdentity({subject: scannerId});
      const result = await asScanner.mutation(api.events.check_in.checkIn, {
        ticketId,
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Ticket not found');
    });

    it('rejects scanner when event is cancelled (lifecycle gate)', async () => {
      const t = convexTest();

      const scannerId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Scanner',
        email: 'scanner-cancel@test.com',
      });
      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {name: 'Attendee', email: 'attendee-cancel@test.com'},
      );
      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Cancelled Event',
        date: '2030-06-01',
        price: 1000,
        totalTickets: 100,
        status: 'cancelled',
        visibility: 'public',
        organizerId: orgId,
      });
      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });
      await seedCommunityScanner(t, scannerId, orgId);

      const asScanner = t.withIdentity({subject: scannerId});
      const result = await asScanner.mutation(api.events.check_in.checkIn, {
        ticketId,
      });
      expect(result.success).toBe(false);
      expect(result.message).toBe('Ticket not found');
    });

    it('admin bypasses lifecycle gate (can check in at draft events)', async () => {
      // Regression anchor: if `canScanEvent` is ever recoupled to
      // `event:roster`, admins without a roster grant would fail here
      // because roster gates on published status. Admin + draft succeeding
      // proves the scan path uses `event:manage` bypass, not roster.
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Root Admin',
        email: 'admin-draft@test.com',
      });
      const attendeeId = await t.mutation(
        api.testing.users.createUserDirectly,
        {name: 'Attendee', email: 'attendee-admin-draft@test.com'},
      );
      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Draft Event',
        date: '2030-06-01',
        price: 1000,
        totalTickets: 100,
        status: 'draft',
        visibility: 'public',
        organizerId: orgId,
      });
      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId: attendeeId,
        eventId,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      });

      const asAdmin = t.withIdentity({subject: adminId});
      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        ticketId,
      });
      expect(result.success).toBe(true);
      expect(result.ticket?.status).toBe('used');
    });
  });

  describe('response shape', () => {
    it('ticket check-in response includes user and event details', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
        email: 'admin@test.com',
      });

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Response Shape Event',
        date: '2030-09-01',
        price: 2500,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        location: 'Test Location',
        organizerId: orgId,
      });

      const userId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Response User',
        email: 'response@test.com',
      });

      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId,
        eventId,
        status: 'valid',
        tier: 'supporter',
        trustSource: 'open_access',
      });

      const asAdmin = t.withIdentity({subject: adminId});
      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        ticketId,
      });

      expect(result.success).toBe(true);
      expect(result.ticket).toMatchObject({
        _id: ticketId,
        userId,
        eventId,
        status: 'used',
        tier: 'supporter',
      });
      expect(result.ticket?.user?.name).toBe('Response User');
      expect(result.ticket?.user?.email).toBe('response@test.com');
      expect(result.ticket?.event?.title).toBe('Response Shape Event');
      expect(result.ticket?.event?.date).toBe('2030-09-01T12:00:00.000Z');
      expect(result.ticket?.checkedInAt).toBeDefined();
      expect(result.ticket?.checkedInBy).toBeDefined();
    });

    it('guest check-in response includes event details', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
        email: 'admin@test.com',
      });

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Guest Response Event',
        date: '2030-09-02',
        price: 3000,
        totalTickets: 75,
        status: 'published',
        visibility: 'public',
        location: 'Test Location',
        organizerId: orgId,
      });

      const guestId = await t.mutation(api.testing.guests.seedGuest, {
        eventId,
        name: 'Response Guest',
        email: 'guest@test.com',
        type: 'artist guest',
        notes: 'Plus two',
      });

      const asAdmin = t.withIdentity({subject: adminId});
      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        guestId,
      });

      expect(result.success).toBe(true);
      expect(result.guest).toMatchObject({
        _id: guestId,
        eventId,
        name: 'Response Guest',
        type: 'artist guest',
      });
      expect(result.guest?.email).toBe('guest@test.com');
      expect(result.guest?.notes).toBe('Plus two');
      expect(result.guest?.event?.title).toBe('Guest Response Event');
      expect(result.guest?.checkedInAt).toBeDefined();
    });

    it('error response includes ticket details for troubleshooting', async () => {
      const t = convexTest();

      const adminId = await createRootAdmin(t, {
        name: 'Admin',
        email: 'admin@test.com',
      });

      const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
        name: 'Test Org',
      });
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Error Response Event',
        date: '2030-09-03',
        price: 2000,
        totalTickets: 50,
        status: 'published',
        visibility: 'public',
        location: 'Test Location',
        organizerId: orgId,
      });

      const userId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Refunded User',
        email: 'refunded@test.com',
      });

      const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
        userId,
        eventId,
        status: 'refunded',
        tier: 'regular',
        trustSource: 'open_access',
      });

      const asAdmin = t.withIdentity({subject: adminId});
      const result = await asAdmin.mutation(api.events.check_in.checkIn, {
        ticketId,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('refunded');
      expect(result.ticket).toBeDefined();
      expect(result.ticket?._id).toBe(ticketId);
      expect(result.ticket?.status).toBe('refunded');
      expect(result.ticket?.event).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Counter cascade tests (checkedInCount / lastCheckInAt)
// ---------------------------------------------------------------------------

describe('checkIn / revertCheckIn — counter cascade', () => {
  async function setupEventWithTicket(
    t: ReturnType<typeof convexTest>,
    soldCount = 5,
  ) {
    const adminId = await createRootAdmin(t, {
      name: 'Admin',
    });
    const attendeeId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Attendee',
      email: 'att@test.com',
    });
    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Counter Test Event',
      date: '2030-01-01',
      price: 1000,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
      soldCount,
    });
    const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
      userId: attendeeId,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });
    return {adminId, attendeeId, orgId, eventId, ticketId};
  }

  it('checkIn increments checkedInCount and sets lastCheckInAt', async () => {
    const t = convexTest();
    const {adminId, eventId, ticketId} = await setupEventWithTicket(t);

    const before = await t.run((ctx) => ctx.db.get('events', eventId));
    expect(before?.checkedInCount).toBeUndefined();
    expect(before?.lastCheckInAt).toBeUndefined();

    const beforeTs = Date.now();
    const asAdmin = t.withIdentity({subject: adminId});
    await asAdmin.mutation(api.events.check_in.checkIn, {ticketId});

    const after = await t.run((ctx) => ctx.db.get('events', eventId));
    expect(after?.checkedInCount).toBe(1);
    expect(after?.lastCheckInAt).toBeGreaterThanOrEqual(beforeTs);
  });

  it('checkIn increments from existing count', async () => {
    const t = convexTest();
    const {adminId, orgId} = await setupEventWithTicket(t);

    // Create event with pre-existing checkedInCount; seedEvent does not support checkedInCount
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- seedEvent does not support checkedInCount; raw insert required to simulate pre-existing count */
    const eventId2 = await t.run((ctx) =>
      ctx.db.insert('events', {
        title: 'Event With Prior Count',
        date: '2030-01-01',
        price: 1000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
        checkedInCount: 3,
      }),
    );
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
    const attendee2 = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Attendee2',
      email: 'attendee2@test.com',
    });
    const ticket2 = await t.mutation(api.testing.tickets.seedTicket, {
      userId: attendee2,
      eventId: eventId2,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await asAdmin.mutation(api.events.check_in.checkIn, {ticketId: ticket2});

    const after = await t.run((ctx) => ctx.db.get('events', eventId2));
    expect(after?.checkedInCount).toBe(4);
  });

  it('revertCheckIn decrements checkedInCount, does NOT roll back lastCheckInAt', async () => {
    const t = convexTest();
    const {adminId, eventId, ticketId} = await setupEventWithTicket(t);

    const asAdmin = t.withIdentity({subject: adminId});

    // First check in
    await asAdmin.mutation(api.events.check_in.checkIn, {ticketId});
    const afterCheckIn = await t.run((ctx) => ctx.db.get('events', eventId));
    const lastCheckInAtAfterCheckIn = afterCheckIn?.lastCheckInAt;
    expect(afterCheckIn?.checkedInCount).toBe(1);
    expect(lastCheckInAtAfterCheckIn).toBeGreaterThan(0);

    // Now revert
    const result = await asAdmin.mutation(api.events.check_in.revertCheckIn, {
      ticketId,
    });
    expect(result.success).toBe(true);

    const afterRevert = await t.run((ctx) => ctx.db.get('events', eventId));
    // Counter decremented
    expect(afterRevert?.checkedInCount).toBe(0);
    // lastCheckInAt NOT rolled back
    expect(afterRevert?.lastCheckInAt).toBe(lastCheckInAtAfterCheckIn);

    // Ticket status back to valid
    const ticket = await t.run((ctx) => ctx.db.get('tickets', ticketId));
    expect(ticket?.status).toBe('valid');
    expect(ticket?.checkedInAt).toBeUndefined();
    expect(ticket?.checkedInBy).toBeUndefined();
  });

  it('revertCheckIn writes a revert audit log so ops can trace undo actions', async () => {
    vi.useFakeTimers();
    const t = convexTest();
    const {adminId, eventId, ticketId} = await setupEventWithTicket(t);

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.events.check_in.checkIn, {ticketId});
    await asAdmin.mutation(api.events.check_in.revertCheckIn, {ticketId});

    await finishAllScheduledFunctions(t);
    const auditLogs = await t.run((ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .filter((q) => q.eq(q.field('action'), 'ticket.check-in.revert'))
        .collect(),
    );
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].adminId).toBe(adminId);
    expect(auditLogs[0].eventId).toBe(eventId);
    expect(auditLogs[0].source).toBe('admin-ui');
    vi.useRealTimers();
  });

  it('revertCheckIn clamps checkedInCount at 0 even if counter is already 0', async () => {
    const t = convexTest();
    const {adminId, orgId} = await setupEventWithTicket(t);

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- seedEvent does not support checkedInCount; raw insert required to create event with pre-set counter */
    const eventId0 = await t.run((ctx) =>
      ctx.db.insert('events', {
        title: 'Zero Count Event',
        date: '2030-01-01',
        price: 1000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
        checkedInCount: 0,
      }),
    );
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
    const attendee0 = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'A0',
      email: 'a0@test.com',
    });
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- seedTicket does not support pre-set checkedInAt/checkedInBy; raw insert required to simulate a ticket that was manually checked in */
    const ticket0 = await t.run((ctx) =>
      ctx.db.insert('tickets', {
        userId: attendee0,
        eventId: eventId0,
        status: 'used',
        tier: 'regular',
        checkedInAt: Date.now() - 1000,
        checkedInBy: adminId,
      }),
    );
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const asAdmin = t.withIdentity({subject: adminId});
    await asAdmin.mutation(api.events.check_in.revertCheckIn, {
      ticketId: ticket0,
    });

    const event0 = await t.run((ctx) => ctx.db.get('events', eventId0));
    expect(event0?.checkedInCount).toBe(0); // clamped, not negative
  });

  it('revertCheckIn rejects non-used ticket', async () => {
    const t = convexTest();
    const {adminId, eventId} = await setupEventWithTicket(t);

    // Insert a valid (not used) ticket
    const attendeeRv = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'AtRv',
      email: 'atrv@test.com',
    });
    const ticketRv = await t.mutation(api.testing.tickets.seedTicket, {
      userId: attendeeRv,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.mutation(api.events.check_in.revertCheckIn, {
      ticketId: ticketRv,
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('valid');
  });

  it('concurrent check-ins end with correct count (no lost update)', async () => {
    // convex-test runs mutations sequentially (OCC retry is simulated),
    // so two mutations should each see their own consistent snapshot.
    const t = convexTest();
    const {adminId, orgId} = await setupEventWithTicket(t);

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- seedEvent does not support checkedInCount; raw insert required to create event for concurrent check-in count test */
    const eventC = await t.run((ctx) =>
      ctx.db.insert('events', {
        title: 'Concurrent Event',
        date: '2030-01-01',
        price: 1000,
        totalTickets: 100,
        status: 'published',
        visibility: 'public',
        organizerId: orgId,
      }),
    );
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
    const [a1, a2] = await Promise.all([
      t.mutation(api.testing.users.createUserDirectly, {
        name: 'C1',
        email: 'c1@test.com',
      }),
      t.mutation(api.testing.users.createUserDirectly, {
        name: 'C2',
        email: 'c2@test.com',
      }),
    ]);
    const [t1, t2] = await Promise.all([
      t.mutation(api.testing.tickets.seedTicket, {
        userId: a1,
        eventId: eventC,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      }),
      t.mutation(api.testing.tickets.seedTicket, {
        userId: a2,
        eventId: eventC,
        status: 'valid',
        tier: 'regular',
        trustSource: 'open_access',
      }),
    ]);

    const asAdmin = t.withIdentity({subject: adminId});
    // Run both check-ins — in convex-test these run sequentially
    await Promise.all([
      asAdmin.mutation(api.events.check_in.checkIn, {ticketId: t1}),
      asAdmin.mutation(api.events.check_in.checkIn, {ticketId: t2}),
    ]);

    const eventAfter = await t.run((ctx) => ctx.db.get('events', eventC));
    expect(eventAfter?.checkedInCount).toBe(2);
  });
});
