import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {describe, it, expect, vi, afterEach} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {ADMIN_AUDIT_ACTIONS} from '../lib/admin_audit_actions';

let _orgCounter = 0;

afterEach(() => {
  vi.useRealTimers();
});

async function seedEvent(
  t: ReturnType<typeof convexTest>,
): Promise<Id<'events'>> {
  _orgCounter += 1;
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Test Org',
    slug: `test-org-imp-${_orgCounter}`,
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
    email: `admin-imp-${_orgCounter}-${Date.now()}@test.com`,
    isRootAdmin: true,
  });
}

describe('importedTickets.importBatch', () => {
  it('maps RA-style structured rows into imported entries with a source label', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const result = await asAdmin.mutation(
      api.events.imported_tickets.importBatch,
      {
        eventId,
        batchKey: 'ra-1',
        dedupMode: 'skip',
        sourceLabel: 'RA',
        rows: [
          {
            name: 'Jamie Fan',
            email: 'jamie@example.com',
            externalRef: 'BARCODE-001',
            orderRef: 'ORDER-100',
            ticketTypeLabel: 'GA',
            purchaseDateRaw: '2026-07-06 12:28 ',
          },
        ],
      },
    );

    expect(result.insertedCount).toBe(1);
    const entries = await asAdmin.query(
      api.events.imported_tickets.listByEvent,
      {
        eventId,
      },
    );
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.name).toBe('Jamie Fan');
    expect(entry.email).toBe('jamie@example.com');
    expect(entry.externalRef).toBe('BARCODE-001');
    expect(entry.orderRef).toBe('ORDER-100');
    expect(entry.ticketTypeLabel).toBe('GA');
    // purchaseDateRaw stored raw (trimmed), display-only.
    expect(entry.purchaseDateRaw).toBe('2026-07-06 12:28');
    expect(entry.sourceLabel).toBe('RA');
  });

  it('defaults a blank source label to "External"', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'src-blank',
      dedupMode: 'skip',
      sourceLabel: '   ',
      rows: [{name: 'Nobody'}],
    });
    const entries = await asAdmin.query(
      api.events.imported_tickets.listByEvent,
      {
        eventId,
      },
    );
    expect(entries[0].sourceLabel).toBe('External');
  });

  it('within-batch barcode dupes: 1 in skip mode, 2 in include mode', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const skipEvent = await seedEvent(t);
    const skipResult = await asAdmin.mutation(
      api.events.imported_tickets.importBatch,
      {
        eventId: skipEvent,
        batchKey: 'skip-dupe',
        dedupMode: 'skip',
        rows: [
          {name: 'A', externalRef: 'DUP-1'},
          {name: 'B', externalRef: 'DUP-1'},
        ],
      },
    );
    expect(skipResult.insertedCount).toBe(1);
    expect(skipResult.skippedCount).toBe(1);

    const includeEvent = await seedEvent(t);
    const includeResult = await asAdmin.mutation(
      api.events.imported_tickets.importBatch,
      {
        eventId: includeEvent,
        batchKey: 'include-dupe',
        dedupMode: 'include',
        rows: [
          {name: 'A', externalRef: 'DUP-1'},
          {name: 'B', externalRef: 'DUP-1'},
        ],
      },
    );
    expect(includeResult.insertedCount).toBe(2);
    expect(includeResult.skippedCount).toBe(0);
  });

  it('three rows sharing an order number import as three; re-import skips on barcode', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const rows = [
      {
        name: 'Group Lead',
        email: 'lead@example.com',
        orderRef: 'ORD-9',
        externalRef: 'BC-1',
      },
      {
        name: 'Group Lead',
        email: 'lead@example.com',
        orderRef: 'ORD-9',
        externalRef: 'BC-2',
      },
      {
        name: 'Group Lead',
        email: 'lead@example.com',
        orderRef: 'ORD-9',
        externalRef: 'BC-3',
      },
    ];

    const first = await asAdmin.mutation(
      api.events.imported_tickets.importBatch,
      {
        eventId,
        batchKey: 'order-1',
        dedupMode: 'skip',
        rows,
      },
    );
    expect(first.insertedCount).toBe(3);

    const second = await asAdmin.mutation(
      api.events.imported_tickets.importBatch,
      {
        eventId,
        batchKey: 'order-2',
        dedupMode: 'skip',
        rows,
      },
    );
    expect(second.insertedCount).toBe(0);
    expect(second.skippedCount).toBe(3);
  });

  it('include mode re-import inserts all rows again', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const rows = [{name: 'X', externalRef: 'INC-1'}];
    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'inc-a',
      dedupMode: 'include',
      rows,
    });
    const second = await asAdmin.mutation(
      api.events.imported_tickets.importBatch,
      {
        eventId,
        batchKey: 'inc-b',
        dedupMode: 'include',
        rows,
      },
    );
    expect(second.insertedCount).toBe(1);

    const entries = await asAdmin.query(
      api.events.imported_tickets.listByEvent,
      {
        eventId,
      },
    );
    expect(entries).toHaveLength(2);
  });

  it('replay is idempotent in both dedup modes', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const asAdmin = t.withIdentity({subject: adminId});

    for (const dedupMode of ['skip', 'include'] as const) {
      const eventId = await seedEvent(t);
      const args = {
        eventId,
        batchKey: `replay-${dedupMode}`,
        dedupMode,
        rows: [
          {name: 'One', externalRef: 'R-1'},
          {name: 'Two', externalRef: 'R-2'},
        ],
      };
      const first = await asAdmin.mutation(
        api.events.imported_tickets.importBatch,
        args,
      );
      const second = await asAdmin.mutation(
        api.events.imported_tickets.importBatch,
        args,
      );
      expect(second).toEqual(first);
      const entries = await asAdmin.query(
        api.events.imported_tickets.listByEvent,
        {eventId},
      );
      expect(entries).toHaveLength(2);
    }
  });

  it('rejects a batch over the size cap and writes nothing', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const rows = Array.from({length: 501}, (_, i) => ({name: `N${i}`}));
    await expect(
      asAdmin.mutation(api.events.imported_tickets.importBatch, {
        eventId,
        batchKey: 'over-cap',
        dedupMode: 'skip',
        rows,
      }),
    ).rejects.toThrow(/maximum of 500 rows/i);

    const entries = await asAdmin.query(
      api.events.imported_tickets.listByEvent,
      {
        eventId,
      },
    );
    expect(entries).toHaveLength(0);
  });

  it('enforces the cumulative per-event cap of 5000', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    // 10 batches of 500 = 5000 (at the cap).
    for (let b = 0; b < 10; b += 1) {
      const rows = Array.from({length: 500}, (_, i) => ({
        name: `N${b}-${i}`,
        externalRef: `B${b}-${i}`,
      }));
      await asAdmin.mutation(api.events.imported_tickets.importBatch, {
        eventId,
        batchKey: `cap-${b}`,
        dedupMode: 'include',
        rows,
      });
    }

    await expect(
      asAdmin.mutation(api.events.imported_tickets.importBatch, {
        eventId,
        batchKey: 'cap-over',
        dedupMode: 'include',
        rows: [{name: 'OverTheLine'}],
      }),
    ).rejects.toThrow(/per-event limit of 5000/i);
  });

  it('rejects per-row string fields over their length caps', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const result = await asAdmin.mutation(
      api.events.imported_tickets.importBatch,
      {
        eventId,
        batchKey: 'lengths',
        dedupMode: 'skip',
        rows: [
          {name: 'x'.repeat(201)},
          {name: 'Valid', ticketTypeLabel: 'y'.repeat(101)},
          {name: 'Valid2', externalRef: 'z'.repeat(101)},
          {name: 'Valid3', purchaseDateRaw: 'd'.repeat(51)},
          {name: 'Valid4', email: `${'e'.repeat(250)}@example.com`},
          {name: 'Fine'},
        ],
      },
    );
    expect(result.insertedCount).toBe(1);
    const invalidIndexes = result.outcomes
      .filter((o) => o.status === 'invalid')
      .map((o) => o.rowIndex);
    expect(invalidIndexes).toEqual([0, 1, 2, 3, 4]);
  });

  it('imported email matching a native user creates no account linkage', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const userEmail = `linked-${Date.now()}@example.com`;
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Real User',
      email: userEmail,
    });

    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'linkage',
      dedupMode: 'skip',
      rows: [{name: 'Impersonator', email: userEmail, externalRef: 'LINK-1'}],
    });

    // The imported entry carries no userId reference; the user is untouched.
    const entries = await asAdmin.query(
      api.events.imported_tickets.listByEvent,
      {
        eventId,
      },
    );
    expect(entries).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(entries[0], 'userId')).toBe(
      false,
    );

    const tickets = await t.run(async (ctx) =>
      ctx.db
        .query('tickets')
        .filter((q) => q.eq(q.field('userId'), userId))
        .collect(),
    );
    expect(tickets).toHaveLength(0);
  });

  it('rejects callers without event edit access', async () => {
    const t = convexTest();
    const eventId = await seedEvent(t);
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Rando',
      email: `rando-imp-${Date.now()}@test.com`,
    });
    const asUser = t.withIdentity({subject: userId});

    await expect(
      asUser.mutation(api.events.imported_tickets.importBatch, {
        eventId,
        batchKey: 'noauth',
        dedupMode: 'skip',
        rows: [{name: 'X'}],
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('writes exactly one batch-level audit entry', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'audit-one',
      dedupMode: 'skip',
      rows: [{name: 'A'}, {name: 'B'}, {name: 'C'}],
    });

    const logs = await t.run(async (ctx) => {
      const all = await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .collect();
      return all.filter(
        (l) => l.action === ADMIN_AUDIT_ACTIONS.IMPORTED_TICKETS_IMPORT,
      );
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].reason).not.toContain('A');
  });
});

describe('importedTickets.checkIn', () => {
  it('checks in an entry then reports already-checked-in on repeat', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'ci-1',
      dedupMode: 'skip',
      rows: [{name: 'Scanner Test', externalRef: 'CI-1'}],
    });
    const entryId = await t.run(async (ctx) => {
      const e = await ctx.db
        .query('importedTicketHolders')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first();
      return e!._id;
    });

    const first = await asAdmin.mutation(api.events.imported_tickets.checkIn, {
      id: entryId,
    });
    expect(first.success).toBe(true);
    if (first.success) expect(first.alreadyCheckedIn).toBe(false);

    const second = await asAdmin.mutation(api.events.imported_tickets.checkIn, {
      id: entryId,
    });
    expect(second.success).toBe(true);
    if (second.success) expect(second.alreadyCheckedIn).toBe(true);

    const entry = await t.run(async (ctx) =>
      ctx.db.get('importedTicketHolders', entryId),
    );
    expect(entry?.checkedInAt).toBeDefined();
    expect(entry?.checkedInBy).toBe(adminId);
  });
});

describe('importedTickets removal', () => {
  it('removes a single entry (audit-logged)', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'rm-1',
      dedupMode: 'skip',
      rows: [{name: 'Removable'}],
    });
    const entryId = await t.run(async (ctx) => {
      const e = await ctx.db
        .query('importedTicketHolders')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first();
      return e!._id;
    });

    await asAdmin.mutation(api.events.imported_tickets.removeEntry, {
      id: entryId,
    });
    const entries = await asAdmin.query(
      api.events.imported_tickets.listByEvent,
      {
        eventId,
      },
    );
    expect(entries).toHaveLength(0);
  });

  it('batch removal records the checked-in count in the audit entry', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'rm-batch',
      dedupMode: 'skip',
      rows: [
        {name: 'Checked', externalRef: 'RB-1'},
        {name: 'NotChecked', externalRef: 'RB-2'},
      ],
    });

    const checkedId = await t.run(async (ctx) => {
      const e = await ctx.db
        .query('importedTicketHolders')
        .withIndex('by_event_external_ref', (q) =>
          q.eq('eventId', eventId).eq('externalRef', 'RB-1'),
        )
        .first();
      return e!._id;
    });
    await asAdmin.mutation(api.events.imported_tickets.checkIn, {
      id: checkedId,
    });

    const result = await asAdmin.mutation(
      api.events.imported_tickets.removeBatch,
      {eventId, batchKey: 'rm-batch'},
    );
    expect(result.removedCount).toBe(2);
    expect(result.checkedInCount).toBe(1);

    const logs = await t.run(async (ctx) => {
      const all = await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .collect();
      return all.filter(
        (l) => l.action === ADMIN_AUDIT_ACTIONS.IMPORTED_TICKETS_BATCH_REMOVE,
      );
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].reason).toContain('1 checked in');

    const entries = await asAdmin.query(
      api.events.imported_tickets.listByEvent,
      {
        eventId,
      },
    );
    expect(entries).toHaveLength(0);
  });
});

describe('importedTickets.redactByEmail', () => {
  it('redacts imported entries matching an email', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const targetEmail = `redact-${Date.now()}@example.com`;
    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'redact-1',
      dedupMode: 'skip',
      rows: [
        {name: 'To Redact', email: targetEmail, externalRef: 'RD-1'},
        {name: 'Keep', email: 'keep@example.com', externalRef: 'RD-2'},
      ],
    });

    const result = await t.mutation(
      internal.events.imported_tickets.redactByEmail,
      {email: targetEmail.toUpperCase(), operatorUserId: adminId},
    );
    expect(result.redactedCount).toBe(1);

    const entries = await asAdmin.query(
      api.events.imported_tickets.listByEvent,
      {
        eventId,
      },
    );
    const redacted = entries.find((e) => e.externalRef === 'RD-1');
    const kept = entries.find((e) => e.externalRef === 'RD-2');
    expect(redacted?.name).toBe('[redacted]');
    expect(redacted?.email).toBeUndefined();
    expect(kept?.name).toBe('Keep');
    expect(kept?.email).toBe('keep@example.com');
  });
});

describe('event deletion cascade', () => {
  it('deletes imported entries and import-batch records for the event', async () => {
    const t = convexTest();
    const adminId = await setupAdmin(t);
    const eventId = await seedEvent(t);
    const asAdmin = t.withIdentity({subject: adminId});

    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'cascade-1',
      dedupMode: 'skip',
      rows: [{name: 'Doomed', externalRef: 'CS-1'}],
    });

    vi.useFakeTimers();
    await asAdmin.mutation(api.events.management.remove, {id: eventId});
    await finishAllScheduledFunctions(t);
    vi.useRealTimers();

    const {entries, batches} = await t.run(async (ctx) => {
      const entries = await ctx.db
        .query('importedTicketHolders')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect();
      const batches = await ctx.db
        .query('importBatches')
        .withIndex('by_event_batch_key', (q) => q.eq('eventId', eventId))
        .collect();
      return {entries, batches};
    });
    expect(entries).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });
});
