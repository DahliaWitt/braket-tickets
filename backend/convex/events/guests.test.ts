import type {EventStatus} from '@shared/domain/event-status';
import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {addMember, authz} from '../lib/authz';
import {ADMIN_AUDIT_ACTIONS} from '../lib/admin_audit_actions';

let _guestTestOrgCounter = 0;

/** Seed a minimal event with an organizer. Returns the eventId. */
async function seedEvent(
  t: ReturnType<typeof convexTest>,
  overrides?: {
    title?: string;
    date?: string;
    price?: number;
    totalTickets?: number;
    status?: EventStatus;
  },
): Promise<Id<'events'>> {
  _guestTestOrgCounter += 1;
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Org',
    slug: `test-org-guests-${_guestTestOrgCounter}`,
  });
  return t.mutation(api.testing.events.seedEvent, {
    title: overrides?.title ?? 'Test Event',
    price: overrides?.price ?? 2500,
    totalTickets: overrides?.totalTickets ?? 100,
    date: overrides?.date ?? '2026-01-01T00:00:00.000Z',
    status: overrides?.status ?? 'published',
    visibility: 'public',
    organizerId,
  });
}

async function setupAdmin(
  t: ReturnType<typeof convexTest>,
): Promise<Id<'users'>> {
  return t.mutation(api.testing.users.createUserDirectly, {
    name: 'Admin',
    email: `admin-guests-${Date.now()}@test.com`,
    isRootAdmin: true,
  });
}

async function setupScanner(
  t: ReturnType<typeof convexTest>,
  organizerId: Id<'organizers'>,
  name = 'Door Person',
  email = 'door@test.com',
): Promise<Id<'users'>> {
  const userId = await t.mutation(api.testing.users.createUserDirectly, {
    name,
    email,
  });
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, userId, 'community_scanner', {
      type: 'organizer',
      id: organizerId,
    });
    await addMember(ctx, userId, organizerId);
  });
  return userId;
}

describe('guests.add', () => {
  it('creates a guest entry for an event', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);

    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});

    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'VIP Guest',
      type: 'guest',
    });

    expect(guestId).toBeDefined();

    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(guest?.name).toBe('VIP Guest');
    expect(guest?.type).toBe('guest');
    expect(guest?.eventId).toBe(eventId);
  });

  it('creates a guest with all optional fields', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);

    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});

    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'DJ Superstar',
      email: 'dj@example.com',
      type: 'artist guest',
      notes: 'Headliner - needs backstage pass',
    });

    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(guest?.name).toBe('DJ Superstar');
    expect(guest?.email).toBe('dj@example.com');
    expect(guest?.type).toBe('artist guest');
    expect(guest?.notes).toBe('Headliner - needs backstage pass');
  });

  it('creates staff guest type', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);

    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});

    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Security Staff',
      type: 'staff',
    });

    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(guest?.type).toBe('staff');
  });

  it('writes an audit log entry on guest addition', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Audited Guest',
      type: 'guest',
    });

    const auditLogs = await t.run(async (ctx) => {
      return await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .collect();
    });

    const guestAddLog = auditLogs.find(
      (log) => log.action === ADMIN_AUDIT_ACTIONS.GUEST_ADD,
    );
    expect(guestAddLog).toBeDefined();
    expect(guestAddLog?.adminId).toBe(adminId);
    expect(guestAddLog?.eventId).toBe(eventId);
    expect(guestAddLog?.source).toBe('admin-ui');
    expect(guestAddLog?.reason).toBe('Audited Guest');

    const organizerId = await t.run(async (ctx) => {
      const event = await ctx.db.get(eventId);
      return event!.organizerId;
    });
    expect(guestAddLog?.organizerId).toBe(organizerId);
  });

  it('audit log entry for guest addition is visible via listAuditLogs', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t, {title: 'Concrete & Wax'});

    const organizerId = await t.run(async (ctx) => {
      const event = await ctx.db.get(eventId);
      return event!.organizerId;
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'VIP Maria',
      type: 'guest',
    });

    const result = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId,
        paginationOpts: {numItems: 25, cursor: null},
      },
    );

    const guestAddEntry = result.page.find(
      (entry) => entry.action === ADMIN_AUDIT_ACTIONS.GUEST_ADD,
    );
    expect(guestAddEntry).toBeDefined();
    expect(guestAddEntry?.adminName).toBeTruthy();
    expect(guestAddEntry?.eventName).toBe('Concrete & Wax');
    expect(guestAddEntry?.reason).toBe('VIP Maria');
  });

  it('rejects non-admin users', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-guests@test.com',
    });

    const eventId = await seedEvent(t);

    const asUser = t.withIdentity({subject: userId});

    await expect(
      asUser.mutation(api.events.guests.add, {
        eventId,
        name: 'Guest',
        type: 'guest',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects unauthenticated users', async () => {
    const t = convexTest();

    const eventId = await seedEvent(t);

    await expect(
      t.mutation(api.events.guests.add, {
        eventId,
        name: 'Guest',
        type: 'guest',
      }),
    ).rejects.toThrow('Unauthenticated');
  });

  it('validates name length', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);

    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const longName = 'x'.repeat(201); // MAX_GUEST_NAME_LENGTH is 200

    await expect(
      asAdmin.mutation(api.events.guests.add, {
        eventId,
        name: longName,
        type: 'guest',
      }),
    ).rejects.toThrow('Name exceeds maximum length');
  });

  it('validates email length', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);

    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const longEmail = 'x'.repeat(255) + '@example.com'; // Exceeds MAX_GUEST_EMAIL_LENGTH (254)

    await expect(
      asAdmin.mutation(api.events.guests.add, {
        eventId,
        name: 'Guest',
        email: longEmail,
        type: 'guest',
      }),
    ).rejects.toThrow('Email exceeds maximum length');
  });

  it('validates email format when an email is provided', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);

    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});

    await expect(
      asAdmin.mutation(api.events.guests.add, {
        eventId,
        name: 'Guest',
        email: 'not-an-email',
        type: 'guest',
      }),
    ).rejects.toThrow('Email is invalid');
  });

  it('validates notes length', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);

    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const longNotes = 'x'.repeat(1001); // MAX_GUEST_NOTES_LENGTH is 1000

    await expect(
      asAdmin.mutation(api.events.guests.add, {
        eventId,
        name: 'Guest',
        notes: longNotes,
        type: 'guest',
      }),
    ).rejects.toThrow('Notes exceeds maximum length');
  });
});

describe('guests.remove', () => {
  it('removes a guest from the event', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);

    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Guest to Remove',
      type: 'guest',
    });

    await asAdmin.mutation(api.events.guests.remove, {id: guestId});

    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(guest).toBeNull();
  });

  it('rejects non-admin users', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-user-remove@test.com',
    });

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Guest',
      type: 'guest',
    });

    const asUser = t.withIdentity({subject: userId});

    await expect(
      asUser.mutation(api.events.guests.remove, {id: guestId}),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects unauthenticated users', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Guest',
      type: 'guest',
    });

    await expect(
      t.mutation(api.events.guests.remove, {id: guestId}),
    ).rejects.toThrow('Unauthenticated');
  });
});

// Note: Guest check-in is tested via ticketCheckIn.checkIn which handles both
// tickets and guests in a unified flow with duplicate check validation.

describe('guests.listByEvent', () => {
  it('lists all guests for an event', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const eventId = await seedEvent(t);

    // Create multiple guests using the production mutation
    await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'VIP 1',
      type: 'guest',
    });
    await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Artist',
      type: 'artist guest',
    });
    await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Security',
      type: 'staff',
    });

    const guests = await asAdmin.query(api.events.guests.listByEvent, {
      eventId,
    });

    expect(guests.length).toBe(3);
    expect(guests.map((g) => g.name).sort()).toEqual([
      'Artist',
      'Security',
      'VIP 1',
    ]);
  });

  it('returns only guests for the specified event', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);

    const event1Id = await seedEvent(t, {title: 'Event 1'});
    const event2Id = await seedEvent(t, {title: 'Event 2', date: '2026-01-02'});

    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.events.guests.add, {
      eventId: event1Id,
      name: 'Guest for Event 1',
      type: 'guest',
    });
    await asAdmin.mutation(api.events.guests.add, {
      eventId: event2Id,
      name: 'Guest for Event 2',
      type: 'guest',
    });

    const event1Guests = await asAdmin.query(api.events.guests.listByEvent, {
      eventId: event1Id,
    });
    expect(event1Guests.length).toBe(1);
    expect(event1Guests[0].name).toBe('Guest for Event 1');

    const event2Guests = await asAdmin.query(api.events.guests.listByEvent, {
      eventId: event2Id,
    });
    expect(event2Guests.length).toBe(1);
    expect(event2Guests[0].name).toBe('Guest for Event 2');
  });

  it('returns empty array for event with no guests', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);

    const eventId = await seedEvent(t, {title: 'Empty Event'});

    const asAdmin = t.withIdentity({subject: adminId});
    const guests = await asAdmin.query(api.events.guests.listByEvent, {
      eventId,
    });

    expect(guests).toEqual([]);
  });

  it('includes check-in status', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);

    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Not Checked In',
      type: 'guest',
    });
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- guests.add does not set checkedIn state; ticket_check_in.checkIn does but requires full event setup; pre-setting for assertion test */
    await t.run(async (ctx) => {
      await ctx.db.insert('guests', {
        eventId,
        name: 'Checked In',
        type: 'guest',
        checkedInAt: Date.now(),
        checkedInBy: adminId,
      });
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const guests = await asAdmin.query(api.events.guests.listByEvent, {
      eventId,
    });

    const checkedIn = guests.find((g) => g.name === 'Checked In');
    const notCheckedIn = guests.find((g) => g.name === 'Not Checked In');

    expect(checkedIn?.checkedInAt).toBeDefined();
    expect(checkedIn?.checkedInBy).toBe(adminId);
    expect(notCheckedIn?.checkedInAt).toBeUndefined();
    expect(notCheckedIn?.checkedInBy).toBeUndefined();
  });

  it('rejects non-admin users', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-list@test.com',
    });

    const eventId = await seedEvent(t);

    const asUser = t.withIdentity({subject: userId});

    await expect(
      asUser.query(api.events.guests.listByEvent, {eventId}),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects unauthenticated users', async () => {
    const t = convexTest();

    const eventId = await seedEvent(t);

    await expect(
      t.query(api.events.guests.listByEvent, {eventId}),
    ).rejects.toThrow('Unauthenticated');
  });

  describe('door staff access', () => {
    it('allows door staff to list guests for assigned event', async () => {
      const t = convexTest();

      const eventId = await seedEvent(t, {
        title: 'Staff Event',
        date: '2026-03-01',
        price: 1000,
      });

      const organizerId = await t.run(async (ctx) => {
        const event = await ctx.db.get(eventId);
        if (!event) throw new Error('event not found');
        return event.organizerId;
      });

      const doorId = await setupScanner(t, organizerId);

      await t.mutation(api.testing.guests.seedGuest, {
        eventId,
        name: 'VIP Guest',
        type: 'guest',
      });
      await t.mutation(api.testing.guests.seedGuest, {
        eventId,
        name: 'Artist',
        type: 'artist guest',
      });

      const asDoor = t.withIdentity({subject: doorId});
      const guests = await asDoor.query(api.events.guests.listByEvent, {
        eventId,
      });

      expect(guests.length).toBe(2);
      expect(guests.map((g) => g.name).sort()).toEqual(['Artist', 'VIP Guest']);
    });

    it('rejects door staff listing guests for unassigned event', async () => {
      const t = convexTest();

      const doorId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Door Person',
        email: 'door@test.com',
      });

      const event1Id = await seedEvent(t, {
        title: 'Event 1',
        date: '2026-03-01',
        price: 1000,
      });
      const event2Id = await seedEvent(t, {
        title: 'Event 2',
        date: '2026-03-01',
        price: 1000,
      });

      const organizer1Id = await t.run(async (ctx) => {
        const event = await ctx.db.get(event1Id);
        if (!event) throw new Error('event not found');
        return event.organizerId;
      });

      // Assign door staff to event 1's community only
      await t.run(async (ctx) => {
        await authz.assignRole(ctx, doorId, 'community_scanner', {
          type: 'organizer',
          id: organizer1Id,
        });
        await addMember(ctx, doorId, organizer1Id);
      });

      const asDoor = t.withIdentity({subject: doorId});

      await expect(
        asDoor.query(api.events.guests.listByEvent, {eventId: event2Id}),
      ).rejects.toThrow('Unauthorized');
    });

    it('throws for door staff querying a draft event', async () => {
      const t = convexTest();

      const doorId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Door Person',
        email: 'door@test.com',
      });

      const draftEventId = await seedEvent(t, {
        title: 'Draft Event',
        date: '2026-03-01',
        price: 1000,
        status: 'draft',
      });

      const draftOrganizerId = await t.run(async (ctx) => {
        const event = await ctx.db.get(draftEventId);
        if (!event) throw new Error('event not found');
        return event.organizerId;
      });
      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- guests.add requires admin role; door staff cannot add guests to draft events; pre-seeding guest for the query test */
      await t.run(async (ctx) => {
        await ctx.db.insert('guests', {
          eventId: draftEventId,
          name: 'Hidden Guest',
          type: 'guest',
        });
        await authz.assignRole(ctx, doorId, 'community_scanner', {
          type: 'organizer',
          id: draftOrganizerId,
        });
        await addMember(ctx, doorId, draftOrganizerId);
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      const asDoor = t.withIdentity({subject: doorId});

      // Draft event roster must not be accessible to non-root scanners
      await expect(
        asDoor.query(api.events.guests.listByEvent, {eventId: draftEventId}),
      ).rejects.toThrow('Unauthorized');
    });

    it('allows root admin to list guests for a draft event (legacy root_admin flag)', async () => {
      const t = convexTest();

      const adminId = await setupAdmin(t);

      const draftEventId = await seedEvent(t, {
        title: 'Draft Event',
        date: '2026-03-01',
        price: 1000,
        status: 'draft',
      });

      const asAdmin = t.withIdentity({subject: adminId});
      await asAdmin.mutation(api.events.guests.add, {
        eventId: draftEventId,
        name: 'Admin Visible Guest',
        type: 'guest',
      });
      const guests = await asAdmin.query(api.events.guests.listByEvent, {
        eventId: draftEventId,
      });

      expect(guests.length).toBe(1);
      expect(guests[0].name).toBe('Admin Visible Guest');
    });

    it('allows root admin to list guests for a draft event (modern RBAC roles)', async () => {
      const t = convexTest();

      const adminId = await setupAdmin(t);

      const draftEventId = await seedEvent(t, {
        title: 'Draft Event',
        date: '2026-03-01',
        price: 1000,
        status: 'draft',
      });

      const asAdmin = t.withIdentity({subject: adminId});
      await asAdmin.mutation(api.events.guests.add, {
        eventId: draftEventId,
        name: 'RBAC Admin Guest',
        type: 'guest',
      });
      const guests = await asAdmin.query(api.events.guests.listByEvent, {
        eventId: draftEventId,
      });

      expect(guests.length).toBe(1);
      expect(guests[0].name).toBe('RBAC Admin Guest');
    });
  });
});
