import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {ADMIN_AUDIT_ACTIONS} from '../lib/admin_audit_actions';

let _orgCounter = 0;

async function seedEvent(
  t: ReturnType<typeof convexTest>,
): Promise<Id<'events'>> {
  _orgCounter += 1;
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Org',
    slug: `test-org-guest-import-${_orgCounter}`,
  });
  return t.mutation(api.testing.events.seedEvent, {
    title: 'Test Event',
    price: 2500,
    totalTickets: 100,
    date: '2026-01-01T00:00:00.000Z',
    status: 'published',
    visibility: 'public',
    organizerId,
  });
}

async function setupAdmin(
  t: ReturnType<typeof convexTest>,
): Promise<Id<'users'>> {
  return t.mutation(api.testing.users.createUserDirectly, {
    name: 'Admin',
    email: `admin-gi-${_orgCounter}-${Date.now()}@test.com`,
    isRootAdmin: true,
  });
}

describe('guests.addMany', () => {
  it('imports valid rows and returns structured outcomes', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const result = await asAdmin.mutation(api.events.guests.addMany, {
      eventId,
      batchKey: 'batch-1',
      rows: [
        {name: 'Alice', email: 'alice@example.com', type: 'guest'},
        {name: 'Bob', type: 'artist guest'},
        {name: 'Carol'},
      ],
    });

    expect(result.insertedCount).toBe(3);
    expect(result.skippedCount).toBe(0);
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.every((o) => o.status === 'inserted')).toBe(true);

    const guests = await asAdmin.query(api.events.guests.listByEvent, {
      eventId,
    });
    expect(guests.map((g) => g.name).sort()).toEqual(['Alice', 'Bob', 'Carol']);
    // Missing type defaults to guest.
    expect(guests.find((g) => g.name === 'Carol')?.type).toBe('guest');
  });

  it('allows the final imported guest and rejects overflow with the stable import error', async () => {
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
      asAdmin.mutation(api.events.guests.addMany, {
        eventId,
        batchKey: 'capacity-boundary',
        rows: [{name: 'Boundary import'}],
      }),
    ).resolves.toMatchObject({insertedCount: 1});
    await expect(
      asAdmin.mutation(api.events.guests.addMany, {
        eventId,
        batchKey: 'capacity-overflow',
        rows: [{name: 'Overflow import'}],
      }),
    ).rejects.toThrow('IMPORT_CAP_EXCEEDED');

    await expect(
      t.run((ctx) =>
        ctx.db
          .query('importBatches')
          .withIndex('by_event_batch_key_target', (q) =>
            q
              .eq('eventId', eventId)
              .eq('batchKey', 'capacity-overflow')
              .eq('target', 'guests'),
          )
          .unique(),
      ),
    ).resolves.toBeNull();
  });

  it('flags an invalid type row and defaults missing type to guest', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const result = await asAdmin.mutation(api.events.guests.addMany, {
      eventId,
      batchKey: 'batch-type',
      rows: [
        {name: 'Valid', type: 'staff'},
        {name: 'BadType', type: 'VIP'},
        {name: 'NoType'},
      ],
    });

    expect(result.insertedCount).toBe(2);
    const invalid = result.outcomes.find((o) => o.status === 'invalid');
    expect(invalid?.rowIndex).toBe(1);
    expect(invalid?.reason).toContain('invalid guest type');
    // Reason must not echo the offending value (PII discipline / no raw content).
    expect(invalid?.reason).not.toContain('VIP');

    const guests = await asAdmin.query(api.events.guests.listByEvent, {
      eventId,
    });
    expect(guests.find((g) => g.name === 'NoType')?.type).toBe('guest');
    expect(guests.find((g) => g.name === 'BadType')).toBeUndefined();
  });

  it('skips name+email duplicates within batch and against existing guests', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.events.guests.add, {
      eventId,
      name: 'Existing',
      email: 'existing@example.com',
      type: 'guest',
    });

    const result = await asAdmin.mutation(api.events.guests.addMany, {
      eventId,
      batchKey: 'batch-dup',
      rows: [
        // Matches existing guest (case-insensitive).
        {name: 'EXISTING', email: 'Existing@Example.com'},
        {name: 'Fresh', email: 'fresh@example.com'},
        // Duplicate of the row above within the batch.
        {name: 'fresh', email: 'FRESH@example.com'},
      ],
    });

    expect(result.insertedCount).toBe(1);
    expect(result.skippedCount).toBe(2);
    const guests = await asAdmin.query(api.events.guests.listByEvent, {
      eventId,
    });
    expect(guests.filter((g) => g.name.toLowerCase() === 'fresh')).toHaveLength(
      1,
    );
  });

  it('treats names differing only by internal whitespace as duplicates', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const result = await asAdmin.mutation(api.events.guests.addMany, {
      eventId,
      batchKey: 'batch-ws',
      rows: [
        {name: 'John  Doe', email: 'jd@example.com'},
        {name: 'John Doe', email: 'jd@example.com'},
      ],
    });

    expect(result.insertedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it('writes exactly one batch-level audit entry, not one per row', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.events.guests.addMany, {
      eventId,
      batchKey: 'batch-audit',
      rows: [{name: 'A'}, {name: 'B'}, {name: 'C'}],
    });

    const importLogs = await t.run(async (ctx) => {
      const logs = await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .collect();
      return logs.filter((l) => l.action === ADMIN_AUDIT_ACTIONS.GUEST_IMPORT);
    });
    expect(importLogs).toHaveLength(1);
    // Audit reason carries counts + batch key only, no names.
    expect(importLogs[0].reason).toContain('batch-audit');
    expect(importLogs[0].reason).not.toContain('A');
  });

  it('is idempotent under replay: repeated batch key inserts nothing', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const args = {
      eventId,
      batchKey: 'batch-replay',
      rows: [{name: 'Once'}, {name: 'Twice'}],
    };
    const first = await asAdmin.mutation(api.events.guests.addMany, args);
    const second = await asAdmin.mutation(api.events.guests.addMany, args);

    expect(first.insertedCount).toBe(2);
    expect(second).toEqual(first);

    const guests = await asAdmin.query(api.events.guests.listByEvent, {
      eventId,
    });
    expect(guests).toHaveLength(2);
  });

  it('rejects a batch over the size cap and writes nothing', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const rows = Array.from({length: 501}, (_, i) => ({name: `Guest ${i}`}));
    await expect(
      asAdmin.mutation(api.events.guests.addMany, {
        eventId,
        batchKey: 'batch-too-large',
        rows,
      }),
    ).rejects.toThrow(/maximum of 500 rows/i);

    const guests = await asAdmin.query(api.events.guests.listByEvent, {
      eventId,
    });
    expect(guests).toHaveLength(0);
  });

  it('email is optional; rows without email import cleanly', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const result = await asAdmin.mutation(api.events.guests.addMany, {
      eventId,
      batchKey: 'batch-no-email',
      rows: [{name: 'NoEmail'}],
    });
    expect(result.insertedCount).toBe(1);
  });

  it('rejects callers without event edit access', async () => {
    const t = convexTest();
    const eventId = await seedEvent(t);
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Rando',
      email: `rando-${Date.now()}@test.com`,
    });
    const asUser = t.withIdentity({subject: userId});

    await expect(
      asUser.mutation(api.events.guests.addMany, {
        eventId,
        batchKey: 'batch-noauth',
        rows: [{name: 'X'}],
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects invalid rows server-side even when preview is bypassed', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const longName = 'x'.repeat(201);
    const result = await asAdmin.mutation(api.events.guests.addMany, {
      eventId,
      batchKey: 'batch-server-validate',
      rows: [{name: longName}, {name: '   '}],
    });
    expect(result.insertedCount).toBe(0);
    expect(result.outcomes.every((o) => o.status === 'invalid')).toBe(true);
  });
});
