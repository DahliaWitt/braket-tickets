import type {EventStatus} from '@shared/domain/event-status';
import {convexTest} from '../setup.testing';
import {afterEach, describe, it, expect, vi} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {GUEST_TICKET_SEND_LOCK_STALE_MS} from './_impl/guests';
import {addMember, authz} from '../lib/authz';
import {ADMIN_AUDIT_ACTIONS} from '../lib/admin_audit_actions';

let _guestTestOrgCounter = 0;

afterEach(() => vi.useRealTimers());

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

  it('allows the final guest admission and rejects overflow with a stable app error', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});
    await t.run((ctx) =>
      ctx.db.insert('guestListEventStats', {
        eventId,
        selfServiceGuestCount: 0,
        activeGrantedSlots: 0,
        activeArtistGuestCount: 0,
        activeStaffGuestCount: 0,
        activeAssignmentCount: 0,
        totalGuestAdmissionCount: 4_999,
      }),
    );

    await expect(
      asAdmin.mutation(api.events.guests.add, {
        eventId,
        name: 'Boundary guest',
        type: 'guest',
      }),
    ).resolves.toBeDefined();
    await expect(
      asAdmin.mutation(api.events.guests.add, {
        eventId,
        name: 'Overflow guest',
        type: 'guest',
      }),
    ).rejects.toThrow('GUEST_ADMISSION_CAP_EXCEEDED');

    await expect(
      t.run((ctx) =>
        ctx.db
          .query('guestListEventStats')
          .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
          .unique(),
      ),
    ).resolves.toMatchObject({totalGuestAdmissionCount: 5_000});
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

  it('rejects a blank name', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});

    await expect(
      asAdmin.mutation(api.events.guests.add, {
        eventId,
        name: '   ',
        type: 'guest',
      }),
    ).rejects.toThrow(/name is required/i);
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

describe('guests.update', () => {
  it('updates name, email, type, and notes', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Original Name',
      email: 'original@example.com',
      type: 'guest',
      notes: 'Original notes',
    });

    await asAdmin.mutation(api.events.guests.update, {
      id: guestId,
      name: 'Updated Name',
      email: 'updated@example.com',
      type: 'artist guest',
      notes: 'Updated notes',
    });

    const guests = await asAdmin.query(api.events.guests.listByEvent, {
      eventId,
    });
    const updated = guests.find((g) => g._id === guestId);
    expect(updated?.name).toBe('Updated Name');
    expect(updated?.email).toBe('updated@example.com');
    expect(updated?.type).toBe('artist guest');
    expect(updated?.notes).toBe('Updated notes');
  });

  it('clears optional fields omitted from the update', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Has Optional Fields',
      email: 'has-email@example.com',
      type: 'guest',
      notes: 'Has notes',
    });

    await asAdmin.mutation(api.events.guests.update, {
      id: guestId,
      name: 'No Optional Fields',
      type: 'guest',
    });

    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(guest?.name).toBe('No Optional Fields');
    expect(guest?.email).toBeUndefined();
    expect(guest?.notes).toBeUndefined();
  });

  it('preserves eventId, emailedAt, checkedInAt, and checkedInBy', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Metadata Guest',
      type: 'guest',
    });

    await t.mutation(internal.events.guests.markAsEmailed, {
      id: guestId,
      lockToken: Date.now(),
    });

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- guests.update must preserve check-in state set by ticket_check_in.checkIn, which requires full event/ticket setup; pre-setting checkedInAt/checkedInBy directly for this preservation test, matching the precedent at guests.test.ts (see "includes check-in status") */
    await t.run(async (ctx) => {
      await ctx.db.patch('guests', guestId, {
        checkedInAt: Date.now(),
        checkedInBy: adminId,
      });
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const beforeUpdate = await t.run(async (ctx) => ctx.db.get(guestId));

    await asAdmin.mutation(api.events.guests.update, {
      id: guestId,
      name: 'Metadata Guest Updated',
      type: 'guest',
    });

    const afterUpdate = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(afterUpdate?.eventId).toBe(eventId);
    expect(afterUpdate?.emailedAt).toBe(beforeUpdate?.emailedAt);
    expect(afterUpdate?.emailedAt).toBeDefined();
    expect(afterUpdate?.checkedInAt).toBe(beforeUpdate?.checkedInAt);
    expect(afterUpdate?.checkedInBy).toBe(adminId);
  });

  it('preserves an in-flight ticket-send lock so an edit cannot enable a double-send', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Send In Flight',
      email: 'in-flight@example.com',
      type: 'guest',
    });

    // A send action claims the lock; the PDF build + email dispatch is in
    // flight (the lock is held, not yet released).
    const claim = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: true},
    );
    expect(claim.claimed).toBe(true);
    const lockToken = claim.lockToken;
    expect(typeof lockToken).toBe('number');

    // A concurrent admin edit of an unrelated field must NOT clear the lock.
    await asAdmin.mutation(api.events.guests.update, {
      id: guestId,
      name: 'Send In Flight (renamed)',
      type: 'guest',
    });

    const afterUpdate = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(afterUpdate?.name).toBe('Send In Flight (renamed)');
    expect(afterUpdate?.emailSendLockedAt).toBe(lockToken);

    // Because the lock survived, a second send claim is still turned away as
    // in-flight — the edit did not open a double-send window.
    const second = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: false},
    );
    expect(second).toEqual({
      claimed: false,
      reason: 'in_flight',
      lockToken: null,
    });
  });

  it('preserves a released (null) send lock across an update', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Released Lock',
      email: 'released@example.com',
      type: 'guest',
    });

    // A completed send leaves emailSendLockedAt set to null (released, not
    // absent). An update must not resurrect it to `undefined`.
    const claim = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: true},
    );
    await t.mutation(internal.events.guests.markAsEmailed, {
      id: guestId,
      lockToken: claim.lockToken!,
    });

    await asAdmin.mutation(api.events.guests.update, {
      id: guestId,
      name: 'Released Lock (renamed)',
      type: 'guest',
    });

    const afterUpdate = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(afterUpdate?.emailSendLockedAt).toBeNull();
  });

  it('leaves a never-claimed send lock absent after an update', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Never Sent',
      type: 'guest',
    });

    const beforeUpdate = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(beforeUpdate?.emailSendLockedAt).toBeUndefined();

    await asAdmin.mutation(api.events.guests.update, {
      id: guestId,
      name: 'Never Sent (renamed)',
      type: 'guest',
    });

    // Carrying an absent lock through replace must not resurrect the field.
    const afterUpdate = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(afterUpdate?.emailSendLockedAt).toBeUndefined();
  });

  it('rejects non-admin users', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-update@test.com',
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
      asUser.mutation(api.events.guests.update, {
        id: guestId,
        name: 'Hacked Name',
        type: 'guest',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects a community admin from a different organizer', async () => {
    const t = convexTest();

    const rootAdminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asRootAdmin = t.withIdentity({subject: rootAdminId});
    const guestId = await asRootAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Org A Guest',
      type: 'guest',
    });

    // A community admin scoped to a different organizer must not be able to
    // edit a guest that belongs to another organizer's event.
    const otherOrganizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Other Org', slug: `other-org-guests-${Date.now()}`},
    );
    const otherAdminId = await t.mutation(
      api.testing.users.createUserDirectly,
      {name: 'Other Admin', email: `other-admin-${Date.now()}@test.com`},
    );
    await t.mutation(api.testing.communities.seedCommunityAdmin, {
      userId: otherAdminId,
      organizerId: otherOrganizerId,
      grantedBy: rootAdminId,
    });

    const asOtherAdmin = t.withIdentity({subject: otherAdminId});

    await expect(
      asOtherAdmin.mutation(api.events.guests.update, {
        id: guestId,
        name: 'Cross-Org Edit',
        type: 'guest',
      }),
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
      t.mutation(api.events.guests.update, {
        id: guestId,
        name: 'Guest',
        type: 'guest',
      }),
    ).rejects.toThrow('Unauthenticated');
  });

  it('throws not-found for an unknown guest id', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Temporary Guest',
      type: 'guest',
    });
    await asAdmin.mutation(api.events.guests.remove, {id: guestId});

    await expect(
      asAdmin.mutation(api.events.guests.update, {
        id: guestId,
        name: 'Ghost Guest',
        type: 'guest',
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('validates name, email, and notes length', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Guest',
      type: 'guest',
    });

    const longName = 'x'.repeat(201); // MAX_GUEST_NAME_LENGTH is 200
    await expect(
      asAdmin.mutation(api.events.guests.update, {
        id: guestId,
        name: longName,
        type: 'guest',
      }),
    ).rejects.toThrow(/exceeds maximum length/);

    const longEmail = 'x'.repeat(255) + '@example.com'; // Exceeds MAX_GUEST_EMAIL_LENGTH (254)
    await expect(
      asAdmin.mutation(api.events.guests.update, {
        id: guestId,
        name: 'Guest',
        email: longEmail,
        type: 'guest',
      }),
    ).rejects.toThrow(/exceeds maximum length/);

    const longNotes = 'x'.repeat(1001); // MAX_GUEST_NOTES_LENGTH is 1000
    await expect(
      asAdmin.mutation(api.events.guests.update, {
        id: guestId,
        name: 'Guest',
        notes: longNotes,
        type: 'guest',
      }),
    ).rejects.toThrow(/exceeds maximum length/);
  });

  it('rejects an email with no @ sign', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Guest',
      type: 'guest',
    });

    // update shares the guest paths' lenient `@`-presence rule: a value with no
    // `@` is obviously not an address and is rejected, but the strict RFC regex
    // is deliberately NOT applied (see the accepts-unusual-address test below).
    await expect(
      asAdmin.mutation(api.events.guests.update, {
        id: guestId,
        name: 'Guest',
        email: 'not-an-email',
        type: 'guest',
      }),
    ).rejects.toThrow('Email is invalid');
  });

  it('accepts an unusual but valid @ address the strict regex would reject', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Guest',
      type: 'guest',
    });

    // `user@localhost` has an `@` but no dotted domain, so the strict RFC regex
    // rejects it. The guest paths intentionally accept it — matching the admin
    // add/edit dialog, which submits any trimmed address containing `@`.
    await asAdmin.mutation(api.events.guests.update, {
      id: guestId,
      name: 'Guest',
      email: 'user@localhost',
      type: 'guest',
    });

    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(guest?.email).toBe('user@localhost');
  });

  it('trims surrounding whitespace from a valid email', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Guest',
      type: 'guest',
    });

    await asAdmin.mutation(api.events.guests.update, {
      id: guestId,
      name: 'Guest',
      email: '  spaced@example.com  ',
      type: 'guest',
    });

    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(guest?.email).toBe('spaced@example.com');
  });

  it('accepts a valid email', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Guest',
      type: 'guest',
    });

    await asAdmin.mutation(api.events.guests.update, {
      id: guestId,
      name: 'Guest',
      email: 'valid@example.com',
      type: 'guest',
    });

    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(guest?.email).toBe('valid@example.com');
  });

  it('rejects a blank name', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Original Name',
      type: 'guest',
    });

    await expect(
      asAdmin.mutation(api.events.guests.update, {
        id: guestId,
        name: '   ',
        type: 'guest',
      }),
    ).rejects.toThrow(/name is required/i);
  });

  it('writes an audit log entry on guest update', async () => {
    const t = convexTest();

    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);

    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Pre-Update Name',
      type: 'guest',
    });

    await asAdmin.mutation(api.events.guests.update, {
      id: guestId,
      name: 'Audited Update Name',
      type: 'guest',
    });

    const organizerId = await t.run(async (ctx) => {
      const event = await ctx.db.get(eventId);
      return event!.organizerId;
    });

    const auditLogs = await t.run(async (ctx) => {
      return await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .collect();
    });

    const guestUpdateLog = auditLogs.find(
      (log) => log.action === ADMIN_AUDIT_ACTIONS.GUEST_UPDATE,
    );
    expect(guestUpdateLog).toBeDefined();
    expect(guestUpdateLog?.adminId).toBe(adminId);
    expect(guestUpdateLog?.eventId).toBe(eventId);
    expect(guestUpdateLog?.organizerId).toBe(organizerId);
    expect(guestUpdateLog?.source).toBe('admin-ui');
    expect(guestUpdateLog?.reason).toBe('Audited Update Name');

    const result = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId,
        paginationOpts: {numItems: 25, cursor: null},
      },
    );
    const guestUpdateEntry = result.page.find(
      (entry) => entry.action === ADMIN_AUDIT_ACTIONS.GUEST_UPDATE,
    );
    expect(guestUpdateEntry).toBeDefined();
    expect(guestUpdateEntry?.reason).toBe('Audited Update Name');
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

describe('guest-list sourced guests managed by the organizer', () => {
  /**
   * Guest-list assignments require the feature flag and an event that has not
   * ended, so this block seeds its own future event rather than reusing the
   * module-level `seedEvent` helper (which dates events in the past).
   */
  async function setupGuestListEvent(t: ReturnType<typeof convexTest>) {
    await t.mutation(api.testing.guest_list.enableFeature, {});
    _guestTestOrgCounter += 1;
    const suffix = `${_guestTestOrgCounter}-${Date.now()}`;
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Guest List Org',
        slug: `test-org-guest-list-${suffix}`,
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Guest List Event',
      price: 2000,
      totalTickets: 100,
      date: '2035-07-10T20:00:00.000Z',
      endDate: '2035-07-11T06:00:00.000Z',
      status: 'published',
      visibility: 'public',
      organizerId,
    });
    const managerId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Organizer',
      email: `guest-list-organizer-${suffix}@test.com`,
      isRootAdmin: true,
    });
    return {
      organizerId,
      eventId,
      managerId,
      manager: t.withIdentity({subject: managerId}),
      suffix,
    };
  }

  async function readStats(
    t: ReturnType<typeof convexTest>,
    eventId: Id<'events'>,
  ) {
    return await t.run((ctx) =>
      ctx.db
        .query('guestListEventStats')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .unique(),
    );
  }

  /**
   * Only jobs still awaiting execution. `cancelScheduledWork` leaves cancelled
   * rows behind, so the raw table cannot answer "was a new send queued?".
   */
  async function pendingJobsJson(
    t: ReturnType<typeof convexTest>,
  ): Promise<string> {
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    return JSON.stringify(
      scheduled.filter(
        (job) =>
          job.state.kind === 'pending' || job.state.kind === 'inProgress',
      ),
    );
  }

  /** Creates an assignment whose admission row is the delegate's OWN ticket. */
  async function seedAdmission(
    t: ReturnType<typeof convexTest>,
    setup: Awaited<ReturnType<typeof setupGuestListEvent>>,
    overrides?: {email?: string; idempotencyKey?: string; userId?: Id<'users'>},
  ) {
    const email = overrides?.email ?? `touring-artist-${setup.suffix}@test.com`;
    const assignment = await setup.manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId: setup.eventId,
        role: 'artist',
        displayName: 'Touring Artist',
        email,
        ...(overrides?.userId ? {userId: overrides.userId} : {}),
        idempotencyKey:
          overrides?.idempotencyKey ?? `admission-${setup.suffix}`,
      },
    );
    const admissionGuestId = assignment.admissionGuestId;
    if (!admissionGuestId) {
      throw new Error('expected the assignment to create an admission guest');
    }
    return {assignment, admissionGuestId, email};
  }

  it('requeues the delivery when an organizer corrects an assignment admission email', async () => {
    const t = convexTest();
    const setup = await setupGuestListEvent(t);
    const {assignment, admissionGuestId, email} = await seedAdmission(t, setup);

    // The ticket already went out — to the typo'd address.
    await t.mutation(api.testing.guest_list.cancelScheduledWork, {});
    const claim = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: admissionGuestId, requireUnsent: true},
    );
    await t.mutation(internal.events.guests.markAsEmailed, {
      id: admissionGuestId,
      lockToken: claim.lockToken!,
      recipient: email,
    });
    expect(
      await t.run((ctx) => ctx.db.get('guests', admissionGuestId)),
    ).toMatchObject({ticketDeliveryState: 'sent'});

    const corrected = `touring.artist-${setup.suffix}@test.com`;
    await setup.manager.mutation(api.events.guests.update, {
      id: admissionGuestId,
      name: 'Touring Artist',
      email: corrected,
      type: 'artist guest',
    });

    // Without the reset the artist's own ticket is stranded: emailedAt survives,
    // the state stays 'sent', nothing is queued, and delegate.retryTicket only
    // accepts self_service rows — so there is no retry path at all.
    const after = await t.run((ctx) => ctx.db.get('guests', admissionGuestId));
    expect(after?.email).toBe(corrected);
    expect(after?.emailKey).toBe(corrected.toLowerCase());
    expect(after?.emailedAt).toBeUndefined();
    expect(after?.ticketDeliveryState).toBe('queued');
    expect(after?.emailSendLockedAt).toBeNull();
    expect(after).toMatchObject({
      sourceAssignmentId: assignment.assignmentId,
      sourceKind: 'assignment_admission',
      sourceRole: 'artist',
      sourceDisplayName: 'Touring Artist',
    });
    expect(await pendingJobsJson(t)).toContain('sendAutomaticTicket');
  });

  it('lets the internal delivery gate accept a corrected assignment admission', async () => {
    const t = convexTest();
    const setup = await setupGuestListEvent(t);
    const {assignment, admissionGuestId} = await seedAdmission(t, setup);
    await t.mutation(api.testing.guest_list.cancelScheduledWork, {});

    const corrected = `gate-check-${setup.suffix}@test.com`;
    await setup.manager.mutation(api.events.guests.update, {
      id: admissionGuestId,
      name: 'Touring Artist',
      email: corrected,
      type: 'artist guest',
    });

    // The queued attempt is only useful if canDeliverAutomaticTicket accepts an
    // assignment_admission row whose email diverged from the assignment's.
    await expect(
      t.query(internal.guest_list.invite_state.canDeliverAutomaticTicket, {
        guestId: admissionGuestId,
        assignmentId: assignment.assignmentId,
        eventId: setup.eventId,
        recipient: corrected,
        sourceKind: 'assignment_admission',
      }),
    ).resolves.toBe(true);
    // The superseded address must not be deliverable.
    await expect(
      t.query(internal.guest_list.invite_state.canDeliverAutomaticTicket, {
        guestId: admissionGuestId,
        assignmentId: assignment.assignmentId,
        eventId: setup.eventId,
        recipient: `touring-artist-${setup.suffix}@test.com`,
        sourceKind: 'assignment_admission',
      }),
    ).resolves.toBe(false);
  });

  it('keeps the sent state when an admission edit does not change the email', async () => {
    const t = convexTest();
    const setup = await setupGuestListEvent(t);
    const {admissionGuestId, email} = await seedAdmission(t, setup);
    await t.mutation(api.testing.guest_list.cancelScheduledWork, {});
    const claim = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: admissionGuestId, requireUnsent: true},
    );
    await t.mutation(internal.events.guests.markAsEmailed, {
      id: admissionGuestId,
      lockToken: claim.lockToken!,
      recipient: email,
    });

    await setup.manager.mutation(api.events.guests.update, {
      id: admissionGuestId,
      name: 'Touring Artist (headliner)',
      email: email.toUpperCase(),
      type: 'artist guest',
      notes: 'Arrives at 8pm',
    });

    // Case-only differences normalize to the same emailKey, so nothing resets.
    const after = await t.run((ctx) => ctx.db.get('guests', admissionGuestId));
    expect(typeof after?.emailedAt).toBe('number');
    expect(after?.ticketDeliveryState).toBe('sent');
    expect(after?.name).toBe('Touring Artist (headliner)');
    expect(await pendingJobsJson(t)).not.toContain('sendAutomaticTicket');
  });

  it('refuses to clear the email on a guest-list sourced row', async () => {
    const t = convexTest();
    const setup = await setupGuestListEvent(t);
    const {admissionGuestId} = await seedAdmission(t, setup);

    await expect(
      setup.manager.mutation(api.events.guests.update, {
        id: admissionGuestId,
        name: 'Touring Artist',
        type: 'artist guest',
      }),
    ).rejects.toThrow(/Email is required/i);
  });

  it('preserves every stored field, including sourceIdempotencyKey, across an update', async () => {
    const t = convexTest();
    const setup = await setupGuestListEvent(t);
    const delegateId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Touring Artist',
      email: `delegate-${setup.suffix}@test.com`,
      authEmailVerified: true,
    });
    const {assignment} = await seedAdmission(t, setup, {
      email: `delegate-${setup.suffix}@test.com`,
      userId: delegateId,
    });
    const delegate = t.withIdentity({subject: delegateId});
    const added = await delegate.mutation(api.guest_list.delegate.addGuest, {
      access: {
        kind: 'signedIn' as const,
        assignmentId: assignment.assignmentId,
      },
      name: 'Plus One',
      email: `plus-one-${setup.suffix}@test.com`,
      idempotencyKey: `plus-one-${setup.suffix}`,
    });
    await t.mutation(api.testing.guest_list.cancelScheduledWork, {});

    const before = await t.run((ctx) =>
      ctx.db.get('guests', added.guest.guestId),
    );
    expect(before?.sourceIdempotencyKey).toBe(`plus-one-${setup.suffix}`);

    // Same email (so no delivery reset), new name + notes. `db.replace` rewrites
    // the whole document, so a dropped field would silently erase state — most
    // damagingly sourceIdempotencyKey, the delegate add-replay guard.
    await setup.manager.mutation(api.events.guests.update, {
      id: added.guest.guestId,
      name: 'Plus One (renamed)',
      email: `plus-one-${setup.suffix}@test.com`,
      type: 'guest',
      notes: 'Comped by the artist',
    });

    const after = await t.run((ctx) =>
      ctx.db.get('guests', added.guest.guestId),
    );
    expect(after).toEqual({
      ...before,
      name: 'Plus One (renamed)',
      notes: 'Comped by the artist',
    });
  });

  it('decrements only the admission total when removing a revoked assignment admission', async () => {
    const t = convexTest();
    const setup = await setupGuestListEvent(t);

    // Assignment A: revoked, keeps its admission row behind.
    const revoked = await seedAdmission(t, setup, {
      email: `revoked-artist-${setup.suffix}@test.com`,
      idempotencyKey: `revoked-${setup.suffix}`,
    });
    // Assignment B: stays active with one delegate-added self-service guest, so
    // the self-service and per-role used counters are non-zero at removal time.
    const delegateId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Active Artist',
      email: `active-artist-${setup.suffix}@test.com`,
      authEmailVerified: true,
    });
    const active = await seedAdmission(t, setup, {
      email: `active-artist-${setup.suffix}@test.com`,
      idempotencyKey: `active-${setup.suffix}`,
      userId: delegateId,
    });
    await t
      .withIdentity({subject: delegateId})
      .mutation(api.guest_list.delegate.addGuest, {
        access: {
          kind: 'signedIn' as const,
          assignmentId: active.assignment.assignmentId,
        },
        name: 'Plus One',
        email: `plus-one-${setup.suffix}@test.com`,
        idempotencyKey: `plus-one-${setup.suffix}`,
      });
    await setup.manager.mutation(api.guest_list.assignments.revoke, {
      assignmentId: revoked.assignment.assignmentId,
    });
    await t.mutation(api.testing.guest_list.cancelScheduledWork, {});

    const before = await readStats(t, setup.eventId);
    expect(before).toMatchObject({
      selfServiceGuestCount: 1,
      activeArtistGuestCount: 1,
      activeAssignmentCount: 1,
      totalGuestAdmissionCount: 3,
    });

    await setup.manager.mutation(api.events.guests.remove, {
      id: revoked.admissionGuestId,
    });

    // An admission row is not a slot-consuming self-service guest: only the
    // total moves, and the revoked assignment's pointer is cleared.
    const after = await readStats(t, setup.eventId);
    expect(after).toMatchObject({
      selfServiceGuestCount: 1,
      activeArtistGuestCount: 1,
      activeStaffGuestCount: 0,
      activeAssignmentCount: 1,
      activeGrantedSlots: before!.activeGrantedSlots,
      totalGuestAdmissionCount: 2,
    });
    expect(
      await t.run((ctx) => ctx.db.get('guests', revoked.admissionGuestId)),
    ).toBeNull();
    const revokedAssignment = await t.run((ctx) =>
      ctx.db.get('guestListAssignments', revoked.assignment.assignmentId),
    );
    expect(revokedAssignment?.admissionGuestId).toBeUndefined();
    expect(revokedAssignment?.usedSlots).toBe(0);
  });

  it('rejects removing the admission of a still-active assignment', async () => {
    const t = convexTest();
    const setup = await setupGuestListEvent(t);
    const {admissionGuestId} = await seedAdmission(t, setup);

    await expect(
      setup.manager.mutation(api.events.guests.remove, {id: admissionGuestId}),
    ).rejects.toThrow(/active assignment admission/i);
  });

  it('keeps incrementing the admission counter on manual add once the row exists', async () => {
    const t = convexTest();
    const setup = await setupGuestListEvent(t);
    await seedAdmission(t, setup);
    await t.mutation(api.testing.guest_list.cancelScheduledWork, {});
    expect(await readStats(t, setup.eventId)).toMatchObject({
      totalGuestAdmissionCount: 1,
    });

    await setup.manager.mutation(api.events.guests.add, {
      eventId: setup.eventId,
      name: 'Comped Friend',
      type: 'guest',
    });

    expect(await readStats(t, setup.eventId)).toMatchObject({
      totalGuestAdmissionCount: 2,
    });
  });
});

describe('guest ticket send lock', () => {
  async function seedGuestWithEmail(
    t: ReturnType<typeof convexTest>,
  ): Promise<Id<'guests'>> {
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});
    return asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Lock Guest',
      email: 'lock-guest@example.com',
      type: 'guest',
    });
  }

  /** Claims the send lock and returns its ownership token, failing if not granted. */
  async function claimLock(
    t: ReturnType<typeof convexTest>,
    guestId: Id<'guests'>,
    requireUnsent = true,
  ): Promise<number> {
    const claim = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent},
    );
    if (claim.lockToken === null) {
      throw new Error('expected claim to be granted');
    }
    return claim.lockToken;
  }

  it('claims an unclaimed guest and records the lock timestamp', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);

    const result = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: true},
    );

    expect(result.claimed).toBe(true);
    expect(result.reason).toBe('claimed');
    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(typeof guest?.emailSendLockedAt).toBe('number');
    // The returned token is the persisted lock timestamp.
    expect(result.lockToken).toBe(guest?.emailSendLockedAt);
  });

  // convex-test runs mutations sequentially, so this asserts the invariant a
  // real race relies on — once one claim holds the lock, any later claim is
  // turned away — rather than driving two genuinely simultaneous transactions.
  // The simultaneous case is covered by Convex's own OCC serialization of
  // writes to the same document.
  it('rejects a later claim while the lock is held', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);

    const first = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: true},
    );
    const second = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: true},
    );

    expect(first.claimed).toBe(true);
    expect(second).toEqual({
      claimed: false,
      reason: 'in_flight',
      lockToken: null,
    });
  });

  it('reports not_found when the guest was deleted before the claim', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    await t.run(async (ctx) => ctx.db.delete(guestId));

    const result = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: false},
    );

    expect(result).toEqual({
      claimed: false,
      reason: 'not_found',
      lockToken: null,
    });
  });

  it('skips an already-emailed guest in batch mode', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    const token = await claimLock(t, guestId);
    await t.mutation(internal.events.guests.markAsEmailed, {
      id: guestId,
      lockToken: token,
    });

    const result = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: true},
    );

    expect(result).toEqual({
      claimed: false,
      reason: 'already_sent',
      lockToken: null,
    });
  });

  it('skips a batch send when a delivery record exists but emailedAt was never written', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    // Simulate the failure window: the provider accepted the email (delivery
    // recorded) but the follow-up emailedAt write never landed.
    await t.mutation(internal.email.email_delivery.recordDelivery, {
      emailId: 'email-guest-1',
      source: 'ticket',
      sourceId: guestId,
      recipient: 'lock-guest@example.com',
      critical: true,
      manual: false,
      fallback: false,
      provider: 'resend',
    });

    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(guest?.emailedAt).toBeUndefined();

    const result = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: true},
    );

    expect(result).toEqual({
      claimed: false,
      reason: 'already_sent',
      lockToken: null,
    });
  });

  it('still allows a deliberate single resend when a delivery record exists', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    await t.mutation(internal.email.email_delivery.recordDelivery, {
      emailId: 'email-guest-1',
      source: 'ticket',
      sourceId: guestId,
      recipient: 'lock-guest@example.com',
      critical: true,
      manual: false,
      fallback: false,
      provider: 'resend',
    });

    const result = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: false},
    );

    expect(result.claimed).toBe(true);
    expect(result.reason).toBe('claimed');
  });

  it('allows a deliberate single resend of an already-emailed guest', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    const token = await claimLock(t, guestId);
    await t.mutation(internal.events.guests.markAsEmailed, {
      id: guestId,
      lockToken: token,
    });

    const result = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: false},
    );

    expect(result.claimed).toBe(true);
    expect(result.reason).toBe('claimed');
  });

  it('marks the guest emailed and releases the lock on success', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    const token = await claimLock(t, guestId);

    await t.mutation(internal.events.guests.markAsEmailed, {
      id: guestId,
      lockToken: token,
    });

    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(typeof guest?.emailedAt).toBe('number');
    expect(guest?.emailSendLockedAt).toBeNull();
  });

  it('releases the lock without emailing on the failure path', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    const token = await claimLock(t, guestId);

    await t.mutation(internal.events.guests.clearGuestTicketSendLock, {
      id: guestId,
      lockToken: token,
    });

    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(guest?.emailedAt).toBeUndefined();
    expect(guest?.emailSendLockedAt).toBeNull();

    // The freed lock lets a retry claim the guest again immediately.
    const reclaim = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: false},
    );
    expect(reclaim.claimed).toBe(true);
  });

  it('reclaims a stale lock left behind by a crashed send', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    await t.run(async (ctx) =>
      ctx.db.patch(guestId, {
        emailSendLockedAt: Date.now() - GUEST_TICKET_SEND_LOCK_STALE_MS - 1000,
      }),
    );

    const result = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {id: guestId, requireUnsent: false},
    );

    expect(result.claimed).toBe(true);
    expect(result.reason).toBe('claimed');
  });

  // The public (organizer "Resend") send path claims the lock, then spends
  // seconds building the PDF before dispatching. These cover the pre-dispatch
  // revalidation that keeps a superseded attempt from delivering to an address
  // that was corrected away mid-flight; the automatic path has its own gate
  // (canDeliverAutomaticTicket), the public one had none.
  it('reports an in-flight resend as current while it owns the lock and the recipient matches', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    const token = await claimLock(t, guestId);

    await expect(
      t.query(internal.events.guests.isGuestTicketSendCurrent, {
        id: guestId,
        lockToken: token,
        recipient: 'Lock-Guest@Example.com',
      }),
    ).resolves.toBe(true);
  });

  it('reports an in-flight resend as superseded once the recipient was edited away', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});
    const guestId = await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Edited Mid-Send',
      email: 'stale@example.com',
      type: 'guest',
    });
    const token = await claimLock(t, guestId);

    // A plain guest's update PRESERVES the lock, so the token check alone would
    // still pass — the recipient comparison is what stops the stale delivery.
    await asAdmin.mutation(api.events.guests.update, {
      id: guestId,
      name: 'Edited Mid-Send',
      email: 'corrected@example.com',
      type: 'guest',
    });

    await expect(
      t.query(internal.events.guests.isGuestTicketSendCurrent, {
        id: guestId,
        lockToken: token,
        recipient: 'stale@example.com',
      }),
    ).resolves.toBe(false);
    await expect(
      t.query(internal.events.guests.isGuestTicketSendCurrent, {
        id: guestId,
        lockToken: token,
        recipient: 'corrected@example.com',
      }),
    ).resolves.toBe(true);
  });

  it('reports an in-flight resend as superseded once a newer attempt took the lock', async () => {
    vi.useFakeTimers();
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    const token = await claimLock(t, guestId);

    // A guest-list email correction releases the lock (null) and queues a fresh
    // automatic attempt, which claims a new token. The clock is advanced so the
    // two claim timestamps — the lock ownership tokens — cannot collide.
    await t.mutation(internal.events.guests.clearGuestTicketSendLock, {
      id: guestId,
      lockToken: token,
    });
    vi.advanceTimersByTime(1_000);
    const newerToken = await claimLock(t, guestId, false);
    expect(newerToken).not.toBe(token);

    await expect(
      t.query(internal.events.guests.isGuestTicketSendCurrent, {
        id: guestId,
        lockToken: token,
        recipient: 'lock-guest@example.com',
      }),
    ).resolves.toBe(false);
    await expect(
      t.query(internal.events.guests.isGuestTicketSendCurrent, {
        id: guestId,
        lockToken: newerToken,
        recipient: 'lock-guest@example.com',
      }),
    ).resolves.toBe(true);
  });

  it('reports a deleted guest as no longer current', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    const token = await claimLock(t, guestId);
    const adminId = await setupAdmin(t);
    await t
      .withIdentity({subject: adminId})
      .mutation(api.events.guests.remove, {id: guestId});

    await expect(
      t.query(internal.events.guests.isGuestTicketSendCurrent, {
        id: guestId,
        lockToken: token,
        recipient: 'lock-guest@example.com',
      }),
    ).resolves.toBe(false);
  });

  it('does not let a stale attempt release a newer reclaimed lock', async () => {
    const t = convexTest();
    const guestId = await seedGuestWithEmail(t);
    // Attempt A's lock, now aged past the stale window.
    const staleTokenA = Date.now() - GUEST_TICKET_SEND_LOCK_STALE_MS - 1000;
    await t.run(async (ctx) =>
      ctx.db.patch(guestId, {emailSendLockedAt: staleTokenA}),
    );
    // Attempt B reclaims the stale lock and gets a fresh token.
    const tokenB = await claimLock(t, guestId, false);
    expect(tokenB).not.toBe(staleTokenA);

    // A resumes and tries to release with its old token — must be a no-op.
    await t.mutation(internal.events.guests.clearGuestTicketSendLock, {
      id: guestId,
      lockToken: staleTokenA,
    });
    expect(
      (await t.run(async (ctx) => ctx.db.get(guestId)))?.emailSendLockedAt,
    ).toBe(tokenB);

    // A's late success records emailedAt but must not clear B's lock either.
    await t.mutation(internal.events.guests.markAsEmailed, {
      id: guestId,
      lockToken: staleTokenA,
    });
    const guest = await t.run(async (ctx) => ctx.db.get(guestId));
    expect(typeof guest?.emailedAt).toBe('number');
    expect(guest?.emailSendLockedAt).toBe(tokenB);
  });
});
