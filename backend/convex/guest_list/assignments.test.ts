import {makeFunctionReference} from 'convex/server';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {rateLimiter} from '../lib/rate_limits';
import {GUEST_TICKET_SEND_LOCK_STALE_MS} from '../lib/guest_ticket_delivery';

afterEach(() => vi.useRealTimers());

const INVALID_IDEMPOTENCY_KEYS = [
  '',
  '   ',
  'a'.repeat(65),
  'contains spaces',
  'contains:punctuation',
] as const;

const enableFeature = makeFunctionReference<
  'mutation',
  Record<string, never>,
  null
>('testing/guest_list:enableFeature');
const cancelGuestListScheduledWork = makeFunctionReference<
  'mutation',
  Record<string, never>,
  null
>('testing/guest_list:cancelScheduledWork');
const seedHistoricalAssignment = makeFunctionReference<
  'mutation',
  {
    eventId: Id<'events'>;
    createdBy: Id<'users'>;
    displayName: string;
    email: string;
  },
  Id<'guestListAssignments'>
>('testing/guest_list:seedHistoricalAssignment');
const clearTicketRosterEmailProjection = makeFunctionReference<
  'mutation',
  {ticketId: Id<'tickets'>},
  null
>('testing/tickets:clearRosterEmailProjection');
const authorizeToken = makeFunctionReference<
  'mutation',
  {token: string},
  {status: 'available' | 'unavailable'}
>('guest_list/delegate:authorizeToken');
const claimSignedIn = makeFunctionReference<
  'mutation',
  {assignmentId: Id<'guestListAssignments'>},
  {status: 'available' | 'unavailable'}
>('guest_list/delegate:claimSignedIn');
const getDelegateView = makeFunctionReference<
  'action',
  {
    access:
      | {kind: 'signedIn'; assignmentId: Id<'guestListAssignments'>}
      | {kind: 'token'; token: string};
    paginationOpts: {numItems: number; cursor: string | null};
  },
  | {status: 'unavailable'}
  | {
      status: 'available';
      guests: {
        page: Array<{
          guestId: Id<'guests'>;
          name: string;
          email: string;
          emailedAt?: number;
          deliveryState: 'not_sent' | 'queued' | 'sent' | 'failed';
        }>;
        isDone: boolean;
        continueCursor: string;
      };
    }
>('guest_list/delegate:getView');
const listMine = makeFunctionReference<
  'mutation',
  {paginationOpts: {numItems: number; cursor: string | null}},
  {
    page: Array<{assignmentId: Id<'guestListAssignments'>; eventTitle: string}>;
    isDone: boolean;
    continueCursor: string;
  }
>('guest_list/delegate:listMine');
const markGuestTicketSendFailed = makeFunctionReference<
  'mutation',
  {id: Id<'guests'>; lockToken: number},
  null
>('events/guests:markGuestTicketSendFailed');
const canDeliverAutomaticTicket = makeFunctionReference<
  'query',
  {
    guestId: Id<'guests'>;
    assignmentId: Id<'guestListAssignments'>;
    eventId: Id<'events'>;
    recipient: string;
    sourceKind: 'assignment_admission' | 'self_service';
  },
  boolean
>('guest_list/invite_state:canDeliverAutomaticTicket');
const abortInviteAttempt = makeFunctionReference<
  'mutation',
  {
    assignmentId: Id<'guestListAssignments'>;
    attemptId: string;
    failureCode: string;
  },
  boolean
>('guest_list/invite_state:abortAttempt');

async function setup() {
  const t = convexTest();
  await t.mutation(enableFeature, {});
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Self-service guest-list assignments',
  });
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: 'Future delegated event',
    date: '2035-07-10T20:00:00.000Z',
    endDate: '2035-07-11T06:00:00.000Z',
    price: 2000,
    organizerId,
    visibility: 'public',
  });
  const managerId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Organizer',
    email: 'guest-list-organizer@example.com',
    isRootAdmin: true,
  });
  const delegateId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Touring Artist',
    email: 'touring-artist@example.com',
    authEmailVerified: true,
  });
  return {
    t,
    organizerId,
    eventId,
    managerId,
    delegateId,
    manager: t.withIdentity({subject: managerId}),
    delegate: t.withIdentity({subject: delegateId}),
  };
}

describe('self-service guest-list assignments', () => {
  it('rate-limits token authorization while returning only a neutral state', async () => {
    const {t} = await setup();
    await expect(
      t.mutation(authorizeToken, {token: 'invalid-token'}),
    ).resolves.toEqual({status: 'unavailable'});
    const rate = await t.run((ctx) =>
      rateLimiter.getValue(ctx, 'guestListTokenResolve', {key: 'invalid-'}),
    );
    expect(rate?.value).toBe(29);
  });

  it('consumes token resolution rate limits in getView and rejects malformed tokens before hashing', async () => {
    const {t} = await setup();
    await expect(
      t.action(getDelegateView, {
        access: {kind: 'token', token: 'not-a-valid-token'},
        paginationOpts: {numItems: 20, cursor: null},
      }),
    ).resolves.toEqual({status: 'unavailable'});
    expect(
      await t.run((ctx) =>
        rateLimiter.getValue(ctx, 'guestListTokenResolve', {key: 'not-a-va'}),
      ),
    ).toMatchObject({value: 29});

    const validShapeUnknownToken = 'a'.repeat(43);
    await expect(
      t.action(getDelegateView, {
        access: {kind: 'token', token: validShapeUnknownToken},
        paginationOpts: {numItems: 20, cursor: null},
      }),
    ).resolves.toEqual({status: 'unavailable'});
    expect(
      await t.run((ctx) =>
        rateLimiter.getValue(ctx, 'guestListTokenResolve', {key: 'aaaaaaaa'}),
      ),
    ).toMatchObject({value: 29});
  });

  it('idempotently claims a verified-email assignment before page subscription', async () => {
    const {t, manager, delegate, delegateId, eventId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Touring Artist',
        email: 'touring-artist@example.com',
        idempotencyKey: 'claim-before-view',
      },
    );

    await expect(
      delegate.mutation(claimSignedIn, {assignmentId: assignment.assignmentId}),
    ).resolves.toEqual({status: 'available'});
    await expect(
      delegate.mutation(claimSignedIn, {assignmentId: assignment.assignmentId}),
    ).resolves.toEqual({status: 'available'});

    const row = await t.run((ctx) =>
      ctx.db.get('guestListAssignments', assignment.assignmentId),
    );
    expect(row?.userId).toBe(delegateId);
    const audits = await t.run((ctx) =>
      ctx.db
        .query('guestListAuditEvents')
        .withIndex('by_assignmentId_and_createdAt', (q) =>
          q.eq('assignmentId', assignment.assignmentId),
        )
        .collect(),
    );
    expect(
      audits.filter((audit) => audit.action === 'assignment.user_link'),
    ).toHaveLength(1);
  });

  it('snapshots the role default, creates a non-slot admission, and is idempotent', async () => {
    const {t, manager, managerId, eventId, delegateId} = await setup();
    const args = {
      eventId,
      role: 'artist' as const,
      displayName: 'Touring Artist',
      email: ' Touring-Artist@Example.com ',
      userId: delegateId,
      idempotencyKey: 'artist-assignment-1',
    };

    const created = await manager.mutation(
      api.guest_list.assignments.create,
      args,
    );
    const replayed = await manager.mutation(
      api.guest_list.assignments.create,
      args,
    );

    expect(created.assignmentId).toBe(replayed.assignmentId);
    expect(created.grantedSlots).toBe(2);
    expect(created.usedSlots).toBe(0);
    expect(created.admissionGuestId).toBeDefined();

    const admission = await t.run(async (ctx) =>
      created.admissionGuestId
        ? ctx.db.get('guests', created.admissionGuestId)
        : null,
    );
    expect(admission).toMatchObject({
      eventId,
      email: 'Touring-Artist@Example.com',
      emailKey: 'touring-artist@example.com',
      sourceKind: 'assignment_admission',
      sourceRole: 'artist',
      sourceDisplayName: 'Touring Artist',
    });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const serialized = JSON.stringify(scheduled);
    expect(serialized).toContain('sendInviteAttempt');
    expect(serialized).toContain('sendAutomaticTicket');
    expect(serialized).not.toContain('"token"');
    const rate = await t.run((ctx) =>
      rateLimiter.getValue(ctx, 'guestListAssignmentCreate', {
        key: managerId,
      }),
    );
    expect(rate?.value).toBe(19);
  });

  it('rejects malformed assignment idempotency keys before lookup, rate limit, or persistence', async () => {
    const {t, manager, managerId, eventId} = await setup();

    for (const idempotencyKey of INVALID_IDEMPOTENCY_KEYS) {
      await expect(
        manager.mutation(api.guest_list.assignments.create, {
          eventId,
          role: 'staff',
          displayName: 'Invalid Key Staff',
          email: 'invalid-assignment-key@example.com',
          idempotencyKey,
        }),
      ).rejects.toThrow(/idempotency key/i);
    }

    const state = await t.run(async (ctx) => ({
      assignment: await ctx.db
        .query('guestListAssignments')
        .withIndex('by_eventId_and_status', (q) => q.eq('eventId', eventId))
        .first(),
      rate: await rateLimiter.getValue(ctx, 'guestListAssignmentCreate', {
        key: managerId,
      }),
    }));
    expect(state.assignment).toBeNull();
    expect(state.rate.value).toBe(20);
  });

  it('does not create an admission when a valid ticket follows more than twenty inactive tickets', async () => {
    vi.useFakeTimers();
    const {t, manager, eventId, delegateId} = await setup();
    for (let index = 0; index < 21; index += 1) {
      await t.mutation(api.testing.tickets.seedTicket, {
        userId: delegateId,
        eventId,
        status: 'refunded',
        tier: 'regular',
        trustSource: 'direct',
      });
    }
    const validTicketId = await t.mutation(api.testing.tickets.seedTicket, {
      userId: delegateId,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'direct',
    });
    await t.mutation(clearTicketRosterEmailProjection, {
      ticketId: validTicketId,
    });

    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Already Ticketed Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        idempotencyKey: 'valid-ticket-after-inactive-history',
      },
    );

    expect(assignment.admissionGuestId).toBeUndefined();
  });

  it('returns the declared event overview shape after assignment stats exist', async () => {
    const {manager, eventId} = await setup();
    await manager.mutation(api.guest_list.assignments.create, {
      eventId,
      role: 'artist',
      displayName: 'Overview Artist',
      email: 'overview-artist@example.com',
      idempotencyKey: 'overview-stats-shape',
    });

    await expect(
      manager.query(api.guest_list.assignments.getEventOverview, {eventId}),
    ).resolves.toEqual({
      selfServiceGuestCount: 0,
      activeGrantedSlots: 2,
      activeArtistGuestCount: 0,
      activeStaffGuestCount: 0,
      activeAssignmentCount: 1,
      totalGuestAdmissionCount: 1,
    });
  });

  it('counts a manual guest before the event has any assignments', async () => {
    const {manager, eventId} = await setup();
    await manager.mutation(api.events.guests.add, {
      eventId,
      name: 'Manual Guest',
      email: 'manual-guest@example.com',
      type: 'guest',
    });

    await expect(
      manager.query(api.guest_list.assignments.getEventOverview, {eventId}),
    ).resolves.toMatchObject({totalGuestAdmissionCount: 1});
  });

  it('counts imported guests before the event has any assignments', async () => {
    const {manager, eventId} = await setup();
    await manager.mutation(api.events.guests.addMany, {
      eventId,
      batchKey: 'guest-list-overview-import',
      rows: [
        {
          name: 'Imported Guest One',
          email: 'imported-one@example.com',
          type: 'guest',
        },
        {
          name: 'Imported Guest Two',
          email: 'imported-two@example.com',
          type: 'staff',
        },
      ],
    });

    await expect(
      manager.query(api.guest_list.assignments.getEventOverview, {eventId}),
    ).resolves.toMatchObject({totalGuestAdmissionCount: 2});
  });

  it('lets a signed-in delegate add required-email guests up to quota', async () => {
    const {manager, delegate, eventId, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'staff',
        displayName: 'Touring Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        grantedSlots: 1,
        idempotencyKey: 'staff-assignment-1',
      },
    );
    const access = {
      kind: 'signedIn' as const,
      assignmentId: assignment.assignmentId,
    };

    const added = await delegate.mutation(api.guest_list.delegate.addGuest, {
      access,
      name: 'Guest One',
      email: 'guest-one@example.com',
      idempotencyKey: 'guest-one',
    });
    expect(added.usedSlots).toBe(1);
    expect(added.guest.deliveryState).toBe('queued');

    await expect(
      delegate.mutation(api.guest_list.delegate.addGuest, {
        access,
        name: 'Guest Two',
        email: 'guest-two@example.com',
        idempotencyKey: 'guest-two',
      }),
    ).rejects.toThrow(/QUOTA_FULL/);
  });

  it('revocation preserves sourced guests and attribution while ending access', async () => {
    const {t, manager, delegate, eventId, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Touring Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        idempotencyKey: 'artist-revoke',
      },
    );
    const access = {
      kind: 'signedIn' as const,
      assignmentId: assignment.assignmentId,
    };
    const added = await delegate.mutation(api.guest_list.delegate.addGuest, {
      access,
      name: 'Retained Guest',
      email: 'retained@example.com',
      idempotencyKey: 'retained-guest',
    });

    const result = await manager.mutation(api.guest_list.assignments.revoke, {
      assignmentId: assignment.assignmentId,
    });
    expect(result.retainedGuestCount).toBe(1);
    expect(
      await t.run((ctx) => ctx.db.get('guests', added.guest.guestId)),
    ).toMatchObject({
      sourceAssignmentId: assignment.assignmentId,
      sourceKind: 'self_service',
      sourceDisplayName: 'Touring Artist',
    });
    await expect(
      delegate.action(getDelegateView, {
        access,
        paginationOpts: {numItems: 20, cursor: null},
      }),
    ).resolves.toEqual({status: 'unavailable'});
  });

  it('does not consume delegate add capacity for an idempotent replay', async () => {
    const {t, manager, delegate, eventId, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Touring Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        idempotencyKey: 'delegate-replay-assignment',
      },
    );
    const args = {
      access: {
        kind: 'signedIn' as const,
        assignmentId: assignment.assignmentId,
      },
      name: 'Replay Guest',
      email: 'replay-guest@example.com',
      idempotencyKey: 'delegate-replay-guest',
    };

    await delegate.mutation(api.guest_list.delegate.addGuest, args);
    const rateAfterInsert = await t.run((ctx) =>
      rateLimiter.getValue(ctx, 'guestListDelegateAdd', {key: delegateId}),
    );
    await delegate.mutation(api.guest_list.delegate.addGuest, args);
    const rateAfterReplay = await t.run((ctx) =>
      rateLimiter.getValue(ctx, 'guestListDelegateAdd', {key: delegateId}),
    );

    expect(rateAfterReplay?.value).toBe(rateAfterInsert?.value);
  });

  it('rejects malformed delegate idempotency keys before lookup, rate limit, or persistence', async () => {
    const {t, manager, delegate, eventId, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Touring Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        idempotencyKey: 'delegate-invalid-key-assignment',
      },
    );
    const access = {
      kind: 'signedIn' as const,
      assignmentId: assignment.assignmentId,
    };

    for (const idempotencyKey of INVALID_IDEMPOTENCY_KEYS) {
      await expect(
        delegate.mutation(api.guest_list.delegate.addGuest, {
          access,
          name: 'Invalid Key Guest',
          email: 'invalid-delegate-key@example.com',
          idempotencyKey,
        }),
      ).rejects.toThrow(/idempotency key/i);
    }

    const state = await t.run(async (ctx) => ({
      guest: await ctx.db
        .query('guests')
        .withIndex('by_sourceAssignmentId_and_sourceKind', (q) =>
          q
            .eq('sourceAssignmentId', assignment.assignmentId)
            .eq('sourceKind', 'self_service'),
        )
        .first(),
      rate: await rateLimiter.getValue(ctx, 'guestListDelegateAdd', {
        key: delegateId,
      }),
    }));
    expect(state.guest).toBeNull();
    expect(state.rate.value).toBe(20);
  });

  it('keeps guests when a grant drops below usage and decrements usage on removal', async () => {
    const {manager, delegate, eventId, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'staff',
        displayName: 'Touring Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        grantedSlots: 2,
        idempotencyKey: 'staff-reduce',
      },
    );
    const access = {
      kind: 'signedIn' as const,
      assignmentId: assignment.assignmentId,
    };
    const first = await delegate.mutation(api.guest_list.delegate.addGuest, {
      access,
      name: 'First',
      email: 'first@example.com',
      idempotencyKey: 'first',
    });
    await delegate.mutation(api.guest_list.delegate.addGuest, {
      access,
      name: 'Second',
      email: 'second@example.com',
      idempotencyKey: 'second',
    });

    const reduced = await manager.mutation(
      api.guest_list.assignments.updateGrant,
      {
        assignmentId: assignment.assignmentId,
        grantedSlots: 1,
      },
    );
    expect(reduced.belowUsage).toBe(true);

    const removed = await delegate.mutation(
      api.guest_list.delegate.removeGuest,
      {
        access,
        guestId: first.guest.guestId,
      },
    );
    expect(removed).toEqual({removed: true, usedSlots: 1});
    const view = await delegate.action(getDelegateView, {
      access,
      paginationOpts: {numItems: 20, cursor: null},
    });
    expect(view.status).toBe('available');
    if (view.status === 'available') expect(view.guests.page).toHaveLength(1);
  });

  it('durably imports transaction-safe staff batches with duplicate outcomes and overrides', async () => {
    const {t, manager, managerId, eventId} = await setup();
    const result = await manager.mutation(
      api.guest_list.assignments.bulkCreateStaff,
      {
        eventId,
        batchKey: 'staff-batch',
        rows: [
          {name: 'Crew', email: 'crew@example.com', slotOverride: 5},
          {name: 'Crew duplicate', email: ' CREW@example.com '},
        ],
      },
    );
    expect(result).toMatchObject({insertedCount: 1, skippedCount: 1});
    const batch = await t.run((ctx) =>
      ctx.db
        .query('importBatches')
        .withIndex('by_event_batch_key_target', (q) =>
          q
            .eq('eventId', eventId)
            .eq('batchKey', 'staff-batch')
            .eq('target', 'assignmentStaff'),
        )
        .unique(),
    );
    expect(batch?.target).toBe('assignmentStaff');
    const rateAfterInsert = await t.run((ctx) =>
      rateLimiter.getValue(ctx, 'guestListAssignmentBulkCreate', {
        key: managerId,
      }),
    );
    await manager.mutation(api.guest_list.assignments.bulkCreateStaff, {
      eventId,
      batchKey: 'staff-batch',
      rows: [{name: 'Ignored replay', email: 'ignored@example.com'}],
    });
    const rateAfterReplay = await t.run((ctx) =>
      rateLimiter.getValue(ctx, 'guestListAssignmentBulkCreate', {
        key: managerId,
      }),
    );
    expect(rateAfterReplay?.value).toBe(rateAfterInsert?.value);
    await expect(
      manager.mutation(api.guest_list.assignments.bulkCreateStaff, {
        eventId,
        batchKey: 'too-large',
        rows: Array.from({length: 51}, (_, index) => ({
          name: `Crew ${index}`,
          email: `crew-${index}@example.com`,
        })),
      }),
    ).rejects.toThrow(/BATCH_TOO_LARGE/);
  });

  it('rejects malformed staff batch keys before lookup, rate limit, or persistence', async () => {
    const {t, manager, managerId, eventId} = await setup();

    for (const batchKey of INVALID_IDEMPOTENCY_KEYS) {
      await expect(
        manager.mutation(api.guest_list.assignments.bulkCreateStaff, {
          eventId,
          batchKey,
          rows: [
            {
              name: 'Invalid Batch Staff',
              email: 'invalid-batch-key@example.com',
            },
          ],
        }),
      ).rejects.toThrow(/batch key/i);
    }

    const state = await t.run(async (ctx) => ({
      assignment: await ctx.db
        .query('guestListAssignments')
        .withIndex('by_eventId_and_status', (q) => q.eq('eventId', eventId))
        .first(),
      batch: await ctx.db
        .query('importBatches')
        .withIndex('by_event_batch_key_target', (q) => q.eq('eventId', eventId))
        .first(),
      rate: await rateLimiter.getValue(ctx, 'guestListAssignmentBulkCreate', {
        key: managerId,
      }),
    }));
    expect(state.assignment).toBeNull();
    expect(state.batch).toBeNull();
    expect(state.rate.value).toBe(5);
  });

  it('derives valid collision-resistant row keys and replays a max-length staff batch', async () => {
    const {t, manager, managerId, eventId} = await setup();
    const batchKey = 'b'.repeat(64);
    const args = {
      eventId,
      batchKey,
      rows: [
        {name: 'First Staff', email: 'first-batch-staff@example.com'},
        {name: 'Second Staff', email: 'second-batch-staff@example.com'},
      ],
    };

    const inserted = await manager.mutation(
      api.guest_list.assignments.bulkCreateStaff,
      args,
    );
    const rateAfterInsert = await t.run((ctx) =>
      rateLimiter.getValue(ctx, 'guestListAssignmentBulkCreate', {
        key: managerId,
      }),
    );
    const replayed = await manager.mutation(
      api.guest_list.assignments.bulkCreateStaff,
      args,
    );
    const state = await t.run(async (ctx) => ({
      assignments: await ctx.db
        .query('guestListAssignments')
        .withIndex('by_eventId_and_status', (q) => q.eq('eventId', eventId))
        .collect(),
      rate: await rateLimiter.getValue(ctx, 'guestListAssignmentBulkCreate', {
        key: managerId,
      }),
    }));

    expect(replayed).toEqual(inserted);
    expect(state.rate.value).toBe(rateAfterInsert.value);
    expect(state.assignments).toHaveLength(2);
    expect(
      new Set(state.assignments.map((assignment) => assignment.idempotencyKey))
        .size,
    ).toBe(2);
    for (const assignment of state.assignments) {
      expect(assignment.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{64}$/);
    }
  });

  it('rolls back the whole staff batch when assignment creation fails after validation', async () => {
    const {t, manager, eventId} = await setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 5001; index += 1) {
        await ctx.db.insert('guests', {
          eventId,
          name: `Existing Guest ${index}`,
          type: 'guest',
        });
      }
    });

    await expect(
      manager.mutation(api.guest_list.assignments.bulkCreateStaff, {
        eventId,
        batchKey: 'overflow-batch',
        rows: [{name: 'Crew', email: 'crew-overflow@example.com'}],
      }),
    ).rejects.toThrow(/exceeds the supported per-event limit/i);

    const assignments = await t.run((ctx) =>
      ctx.db
        .query('guestListAssignments')
        .withIndex('by_eventId_and_status', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(assignments).toEqual([]);
  });

  it('rejects invite resend and ignores a late invite failure after revocation', async () => {
    const {t, manager, eventId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'staff',
        displayName: 'Revoked Staff',
        email: 'revoked-staff@example.com',
        idempotencyKey: 'revoked-resend',
      },
    );
    await manager.mutation(api.guest_list.assignments.revoke, {
      assignmentId: assignment.assignmentId,
    });
    const revoked = await t.run((ctx) =>
      ctx.db.get('guestListAssignments', assignment.assignmentId),
    );
    await expect(
      t.mutation(internal.guest_list.invite_state.failAttempt, {
        assignmentId: assignment.assignmentId,
        attemptId: 'revoked-resend',
        failureCode: 'late_provider_failure',
      }),
    ).resolves.toBe(false);
    await expect(
      t.run((ctx) =>
        ctx.db.get('guestListAssignments', assignment.assignmentId),
      ),
    ).resolves.toEqual(revoked);
    await expect(
      manager.mutation(api.guest_list.assignments.resendInvite, {
        assignmentId: assignment.assignmentId,
        idempotencyKey: 'must-not-send',
      }),
    ).rejects.toThrow(/revoked/i);
  });

  it('rejects grant changes after an assignment is revoked', async () => {
    const {manager, eventId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Revoked Grant Artist',
        email: 'revoked-grant@example.com',
        idempotencyKey: 'revoked-grant',
      },
    );
    await manager.mutation(api.guest_list.assignments.revoke, {
      assignmentId: assignment.assignmentId,
    });

    await expect(
      manager.mutation(api.guest_list.assignments.updateGrant, {
        assignmentId: assignment.assignmentId,
        grantedSlots: 5,
      }),
    ).rejects.toThrow(/revoked/i);
  });

  it('rejects invite resend after the event is cancelled', async () => {
    const {manager, eventId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'staff',
        displayName: 'Cancelled Event Staff',
        email: 'cancelled-event-staff@example.com',
        idempotencyKey: 'cancelled-event-resend',
      },
    );
    await manager.mutation(api.events.management.update, {
      id: eventId,
      status: 'cancelled',
    });

    await expect(
      manager.mutation(api.guest_list.assignments.resendInvite, {
        assignmentId: assignment.assignmentId,
        idempotencyKey: 'cancelled-event-must-not-send',
      }),
    ).rejects.toThrow(/cancelled/i);
  });

  it('rejects invite resend after the event has ended', async () => {
    const {t, manager, managerId, organizerId} = await setup();
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Ended resend event',
      date: '2020-01-01T20:00:00.000Z',
      endDate: '2020-01-02T06:00:00.000Z',
      price: 2000,
      organizerId,
      visibility: 'public',
    });
    const assignmentId = await t.mutation(seedHistoricalAssignment, {
      eventId,
      createdBy: managerId,
      displayName: 'Ended Event Staff',
      email: 'ended-event-staff@example.com',
    });

    await expect(
      manager.mutation(api.guest_list.assignments.resendInvite, {
        assignmentId,
        idempotencyKey: 'ended-event-must-not-send',
      }),
    ).rejects.toThrow(/ended/i);
  });

  it('does not consume invite resend capacity for an idempotent replay', async () => {
    vi.useFakeTimers();
    const {t, manager, managerId, eventId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'staff',
        displayName: 'Replay Resend Staff',
        email: 'replay-resend@example.com',
        idempotencyKey: 'replay-resend-assignment',
      },
    );
    await manager.mutation(api.guest_list.assignments.resendInvite, {
      assignmentId: assignment.assignmentId,
      idempotencyKey: 'replay-resend-attempt',
    });
    const rateAfterFirst = await t.run((ctx) =>
      rateLimiter.getValue(ctx, 'guestListInviteResend', {key: managerId}),
    );

    await manager.mutation(api.guest_list.assignments.resendInvite, {
      assignmentId: assignment.assignmentId,
      idempotencyKey: 'replay-resend-attempt',
    });
    const rateAfterReplay = await t.run((ctx) =>
      rateLimiter.getValue(ctx, 'guestListInviteResend', {key: managerId}),
    );

    expect(rateAfterReplay?.value).toBe(rateAfterFirst?.value);
  });

  it('rejects malformed resend idempotency keys before lookup, rate limit, or persistence', async () => {
    const {t, manager, managerId, eventId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'staff',
        displayName: 'Invalid Resend Staff',
        email: 'invalid-resend-key@example.com',
        idempotencyKey: 'invalid-resend-assignment',
      },
    );
    const before = await t.run((ctx) =>
      ctx.db.get('guestListAssignments', assignment.assignmentId),
    );

    for (const idempotencyKey of INVALID_IDEMPOTENCY_KEYS) {
      await expect(
        manager.mutation(api.guest_list.assignments.resendInvite, {
          assignmentId: assignment.assignmentId,
          idempotencyKey,
        }),
      ).rejects.toThrow(/idempotency key/i);
    }

    const state = await t.run(async (ctx) => ({
      assignment: await ctx.db.get(
        'guestListAssignments',
        assignment.assignmentId,
      ),
      rate: await rateLimiter.getValue(ctx, 'guestListInviteResend', {
        key: managerId,
      }),
    }));
    expect(state.assignment).toEqual(before);
    expect(state.rate.value).toBe(5);
  });

  it.each([
    {
      title: 'cancelled',
      date: '2035-08-10T20:00:00.000Z',
      endDate: '2035-08-11T06:00:00.000Z',
      status: 'cancelled' as const,
    },
    {
      title: 'ended',
      date: '2020-01-01T20:00:00.000Z',
      endDate: '2020-01-02T06:00:00.000Z',
      status: 'published' as const,
    },
  ])('rejects assignment creation for a $title event', async (event) => {
    const {t, manager, organizerId} = await setup();
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: `${event.title} assignment event`,
      date: event.date,
      endDate: event.endDate,
      price: 2000,
      organizerId,
      visibility: 'public',
      status: event.status,
    });

    await expect(
      manager.mutation(api.guest_list.assignments.create, {
        eventId,
        role: 'staff',
        displayName: `${event.title} staff`,
        email: `${event.title}-staff@example.com`,
        idempotencyKey: `${event.title}-assignment`,
      }),
    ).rejects.toThrow(/event has ended|cancelled/i);
  });

  it('links verified-email assignments then paginates a single current indexed stream', async () => {
    const {t, manager, managerId, delegate, delegateId, eventId, organizerId} =
      await setup();
    const endedEventId = await manager.mutation(api.testing.events.seedEvent, {
      title: 'Ended delegated event',
      date: '2020-01-01T20:00:00.000Z',
      endDate: '2020-01-02T06:00:00.000Z',
      price: 2000,
      organizerId,
      visibility: 'public',
    });
    await t.mutation(seedHistoricalAssignment, {
      eventId: endedEventId,
      createdBy: managerId,
      displayName: 'Touring Artist',
      email: 'touring-artist@example.com',
    });
    const current = await manager.mutation(api.guest_list.assignments.create, {
      eventId,
      role: 'artist',
      displayName: 'Touring Artist',
      email: 'touring-artist@example.com',
      idempotencyKey: 'current-email-assignment',
    });

    const first = await delegate.mutation(listMine, {
      paginationOpts: {numItems: 1, cursor: null},
    });
    expect(first.page).toEqual([
      expect.objectContaining({
        assignmentId: current.assignmentId,
        eventTitle: 'Future delegated event',
      }),
    ]);
    expect(first.continueCursor).not.toBe('');
    expect(
      await t.run((ctx) =>
        ctx.db.get('guestListAssignments', current.assignmentId),
      ),
    ).toMatchObject({userId: delegateId});
    const audits = await t.run((ctx) =>
      ctx.db
        .query('guestListAuditEvents')
        .withIndex('by_assignmentId_and_createdAt', (q) =>
          q.eq('assignmentId', current.assignmentId),
        )
        .collect(),
    );
    expect(
      audits.filter((audit) => audit.action === 'assignment.user_link'),
    ).toHaveLength(1);
  });

  it('continues past a full hidden page before returning a current assignment', async () => {
    const {t, manager, delegate, delegateId, eventId, organizerId} =
      await setup();
    for (const index of [0, 1]) {
      const hiddenEventId = await manager.mutation(
        api.testing.events.seedEvent,
        {
          title: `Cancelled delegated event ${index}`,
          date: `2034-07-${String(10 + index).padStart(2, '0')}T20:00:00.000Z`,
          endDate: `2034-07-${String(11 + index).padStart(2, '0')}T06:00:00.000Z`,
          price: 2000,
          organizerId,
          visibility: 'public',
        },
      );
      await manager.mutation(api.guest_list.assignments.create, {
        eventId: hiddenEventId,
        role: 'staff',
        displayName: 'Touring Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        idempotencyKey: `cancelled-assignment-${index}`,
      });
      await t.run((ctx) =>
        ctx.db.patch('events', hiddenEventId, {status: 'cancelled'}),
      );
    }
    const current = await manager.mutation(api.guest_list.assignments.create, {
      eventId,
      role: 'artist',
      displayName: 'Touring Artist',
      email: 'touring-artist@example.com',
      userId: delegateId,
      idempotencyKey: 'current-after-hidden-page',
    });

    const result = await delegate.mutation(listMine, {
      paginationOpts: {numItems: 2, cursor: null},
    });

    expect(result.page).toEqual([
      expect.objectContaining({assignmentId: current.assignmentId}),
    ]);
    expect(result.continueCursor).not.toBe('');
  });

  it('exposes failed automatic ticket delivery and supports retry to queued then sent', async () => {
    vi.useFakeTimers();
    const {t, manager, delegate, eventId, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Touring Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        idempotencyKey: 'delivery-lifecycle',
      },
    );
    const access = {
      kind: 'signedIn' as const,
      assignmentId: assignment.assignmentId,
    };
    const added = await delegate.mutation(api.guest_list.delegate.addGuest, {
      access,
      name: 'Delivery Guest',
      email: 'delivery-guest@example.com',
      idempotencyKey: 'delivery-guest',
    });
    await t.mutation(cancelGuestListScheduledWork, {});
    const claim = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {
        id: added.guest.guestId,
        requireUnsent: true,
      },
    );
    expect(claim.claimed).toBe(true);
    await t.mutation(markGuestTicketSendFailed, {
      id: added.guest.guestId,
      lockToken: claim.lockToken!,
    });
    const failed = await delegate.action(getDelegateView, {
      access,
      paginationOpts: {numItems: 20, cursor: null},
    });
    expect(failed.status).toBe('available');
    if (failed.status === 'available') {
      expect(failed.guests.page[0]?.deliveryState).toBe('failed');
    }

    await expect(
      delegate.mutation(api.guest_list.delegate.retryTicket, {
        access,
        guestId: added.guest.guestId,
      }),
    ).resolves.toEqual({status: 'queued'});
    await t.mutation(cancelGuestListScheduledWork, {});
    expect(
      await t.run((ctx) => ctx.db.get('guests', added.guest.guestId)),
    ).toMatchObject({ticketDeliveryState: 'queued'});

    const retryClaim = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {
        id: added.guest.guestId,
        requireUnsent: true,
      },
    );
    await t.mutation(internal.events.guests.markAsEmailed, {
      id: added.guest.guestId,
      lockToken: retryClaim.lockToken!,
      recipient: 'delivery-guest@example.com',
    });
    const sent = await delegate.action(getDelegateView, {
      access,
      paginationOpts: {numItems: 20, cursor: null},
    });
    if (sent.status === 'available') {
      expect(sent.guests.page[0]?.deliveryState).toBe('sent');
    }
  });

  it('requeues a ticket after its send lock becomes stale', async () => {
    vi.useFakeTimers();
    const {t, manager, delegate, eventId, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Stale Lock Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        idempotencyKey: 'stale-lock-assignment',
      },
    );
    const access = {
      kind: 'signedIn' as const,
      assignmentId: assignment.assignmentId,
    };
    const added = await delegate.mutation(api.guest_list.delegate.addGuest, {
      access,
      name: 'Stale Lock Guest',
      email: 'stale-lock-guest@example.com',
      idempotencyKey: 'stale-lock-guest',
    });
    await t.mutation(cancelGuestListScheduledWork, {});
    await expect(
      t.mutation(internal.events.guests.beginGuestTicketSend, {
        id: added.guest.guestId,
        requireUnsent: true,
      }),
    ).resolves.toMatchObject({claimed: true});

    vi.advanceTimersByTime(GUEST_TICKET_SEND_LOCK_STALE_MS + 1);

    await expect(
      delegate.mutation(api.guest_list.delegate.retryTicket, {
        access,
        guestId: added.guest.guestId,
      }),
    ).resolves.toEqual({status: 'queued'});
    await t.mutation(cancelGuestListScheduledWork, {});
    await expect(
      t.mutation(internal.events.guests.beginGuestTicketSend, {
        id: added.guest.guestId,
        requireUnsent: true,
      }),
    ).resolves.toMatchObject({claimed: true, reason: 'claimed'});
  });

  it('queues a corrected recipient even after the old address received a ticket', async () => {
    vi.useFakeTimers();
    const {t, manager, delegate, eventId, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Touring Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        idempotencyKey: 'recipient-aware-delivery',
      },
    );
    const access = {
      kind: 'signedIn' as const,
      assignmentId: assignment.assignmentId,
    };
    const added = await delegate.mutation(api.guest_list.delegate.addGuest, {
      access,
      name: 'Address Change',
      email: 'old-address@example.com',
      idempotencyKey: 'address-change',
    });
    await t.mutation(cancelGuestListScheduledWork, {});
    const oldClaim = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {
        id: added.guest.guestId,
        requireUnsent: true,
      },
    );
    await t.mutation(internal.email.email_delivery.recordDelivery, {
      emailId: 'old-address-delivery',
      source: 'ticket',
      sourceId: added.guest.guestId,
      recipient: 'old-address@example.com',
      critical: true,
      manual: false,
      fallback: false,
      provider: 'resend',
    });

    await delegate.mutation(api.guest_list.delegate.updateGuest, {
      access,
      guestId: added.guest.guestId,
      name: 'Address Change',
      email: 'new-address@example.com',
    });
    await t.mutation(cancelGuestListScheduledWork, {});
    await t.mutation(internal.events.guests.markAsEmailed, {
      id: added.guest.guestId,
      lockToken: oldClaim.lockToken!,
      recipient: 'old-address@example.com',
    });

    expect(
      await t.run((ctx) => ctx.db.get('guests', added.guest.guestId)),
    ).toMatchObject({
      email: 'new-address@example.com',
      ticketDeliveryState: 'queued',
    });
    expect(
      (await t.run((ctx) => ctx.db.get('guests', added.guest.guestId)))
        ?.emailedAt,
    ).toBeUndefined();
    await expect(
      t.mutation(internal.events.guests.beginGuestTicketSend, {
        id: added.guest.guestId,
        requireUnsent: true,
      }),
    ).resolves.toMatchObject({claimed: true, reason: 'claimed'});
  });

  it('rechecks the snapshotted automatic-ticket source before provider delivery', async () => {
    vi.useFakeTimers();
    const {t, manager, delegate, eventId, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Delivery Check Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        idempotencyKey: 'delivery-check-assignment',
      },
    );
    await t.mutation(cancelGuestListScheduledWork, {});
    await expect(
      t.query(canDeliverAutomaticTicket, {
        guestId: assignment.admissionGuestId!,
        assignmentId: assignment.assignmentId,
        eventId,
        recipient: 'TOURING-ARTIST@EXAMPLE.COM',
        sourceKind: 'assignment_admission',
      }),
    ).resolves.toBe(true);

    const access = {
      kind: 'signedIn' as const,
      assignmentId: assignment.assignmentId,
    };
    const edited = await delegate.mutation(api.guest_list.delegate.addGuest, {
      access,
      name: 'Edited During Build',
      email: 'before-build@example.com',
      idempotencyKey: 'edited-during-build',
    });
    await t.mutation(cancelGuestListScheduledWork, {});
    const editedSnapshot = {
      guestId: edited.guest.guestId,
      assignmentId: assignment.assignmentId,
      eventId,
      recipient: 'before-build@example.com',
      sourceKind: 'self_service' as const,
    };
    await expect(
      t.query(canDeliverAutomaticTicket, editedSnapshot),
    ).resolves.toBe(true);

    await delegate.mutation(api.guest_list.delegate.updateGuest, {
      access,
      guestId: edited.guest.guestId,
      name: 'Edited During Build',
      email: 'after-build@example.com',
    });
    await t.mutation(cancelGuestListScheduledWork, {});
    await expect(
      t.query(canDeliverAutomaticTicket, editedSnapshot),
    ).resolves.toBe(false);
    await expect(
      t.query(canDeliverAutomaticTicket, {
        ...editedSnapshot,
        recipient: 'AFTER-BUILD@EXAMPLE.COM',
      }),
    ).resolves.toBe(true);

    const removed = await delegate.mutation(api.guest_list.delegate.addGuest, {
      access,
      name: 'Removed During Build',
      email: 'removed-during-build@example.com',
      idempotencyKey: 'removed-during-build',
    });
    await t.mutation(cancelGuestListScheduledWork, {});
    const removedSnapshot = {
      guestId: removed.guest.guestId,
      assignmentId: assignment.assignmentId,
      eventId,
      recipient: 'removed-during-build@example.com',
      sourceKind: 'self_service' as const,
    };
    await expect(
      t.query(canDeliverAutomaticTicket, removedSnapshot),
    ).resolves.toBe(true);
    await delegate.mutation(api.guest_list.delegate.removeGuest, {
      access,
      guestId: removed.guest.guestId,
    });
    await expect(
      t.query(canDeliverAutomaticTicket, removedSnapshot),
    ).resolves.toBe(false);
  });

  it('deduplicates a provider-accepted ticket after a case-only email edit', async () => {
    vi.useFakeTimers();
    const {t, manager, delegate, eventId, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Touring Artist',
        email: 'touring-artist@example.com',
        userId: delegateId,
        idempotencyKey: 'case-only-delivery',
      },
    );
    const access = {
      kind: 'signedIn' as const,
      assignmentId: assignment.assignmentId,
    };
    const added = await delegate.mutation(api.guest_list.delegate.addGuest, {
      access,
      name: 'Case Guest',
      email: 'Case.Guest@Example.com',
      idempotencyKey: 'case-guest',
    });
    await t.mutation(cancelGuestListScheduledWork, {});
    await t.mutation(internal.email.email_delivery.recordDelivery, {
      emailId: 'case-only-provider-accepted',
      source: 'ticket',
      sourceId: added.guest.guestId,
      recipient: 'Case.Guest@Example.com',
      critical: true,
      manual: false,
      fallback: false,
      provider: 'resend',
    });

    await delegate.mutation(api.guest_list.delegate.updateGuest, {
      access,
      guestId: added.guest.guestId,
      name: 'Case Guest',
      email: 'case.guest@example.com',
    });
    await expect(
      t.mutation(internal.events.guests.beginGuestTicketSend, {
        id: added.guest.guestId,
        requireUnsent: true,
      }),
    ).resolves.toEqual({
      claimed: false,
      reason: 'already_sent',
      lockToken: null,
    });
    expect(
      await t.run((ctx) => ctx.db.get('guests', added.guest.guestId)),
    ).toMatchObject({ticketDeliveryState: 'sent'});
  });

  it('applies source-aware organizer edits and protects active assignment admission', async () => {
    vi.useFakeTimers();
    const {t, manager, delegate, eventId, delegateId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'staff',
        displayName: 'Touring Staff',
        email: 'touring-artist@example.com',
        userId: delegateId,
        idempotencyKey: 'organizer-source-aware-edit',
      },
    );
    const access = {
      kind: 'signedIn' as const,
      assignmentId: assignment.assignmentId,
    };
    const added = await delegate.mutation(api.guest_list.delegate.addGuest, {
      access,
      name: 'Organizer Edited Guest',
      email: 'before-organizer-edit@example.com',
      idempotencyKey: 'organizer-edited-guest',
    });
    await t.mutation(cancelGuestListScheduledWork, {});
    const claim = await t.mutation(
      internal.events.guests.beginGuestTicketSend,
      {
        id: added.guest.guestId,
        requireUnsent: true,
      },
    );
    await t.mutation(internal.events.guests.markAsEmailed, {
      id: added.guest.guestId,
      lockToken: claim.lockToken!,
      recipient: 'before-organizer-edit@example.com',
    });

    await manager.mutation(api.events.guests.update, {
      id: added.guest.guestId,
      name: 'Organizer Corrected Guest',
      email: 'after-organizer-edit@example.com',
      type: 'staff',
    });
    await t.mutation(cancelGuestListScheduledWork, {});
    const corrected = await t.run((ctx) =>
      ctx.db.get('guests', added.guest.guestId),
    );
    expect(corrected).toMatchObject({
      email: 'after-organizer-edit@example.com',
      emailKey: 'after-organizer-edit@example.com',
      sourceAssignmentId: assignment.assignmentId,
      sourceKind: 'self_service',
      ticketDeliveryState: 'queued',
    });
    expect(corrected?.emailedAt).toBeUndefined();
    await expect(
      manager.mutation(api.events.guests.update, {
        id: added.guest.guestId,
        name: 'Missing Email',
        type: 'staff',
      }),
    ).rejects.toThrow(/Email is required/i);

    await expect(
      manager.mutation(api.events.guests.remove, {
        id: assignment.admissionGuestId!,
      }),
    ).rejects.toThrow(/active assignment admission/i);
    await expect(
      t.run((ctx) => ctx.db.get('guests', assignment.admissionGuestId!)),
    ).resolves.not.toBeNull();

    await manager.mutation(api.guest_list.assignments.revoke, {
      assignmentId: assignment.assignmentId,
    });
    await manager.mutation(api.events.guests.remove, {
      id: assignment.admissionGuestId!,
    });
    await expect(
      t.run((ctx) => ctx.db.get('guests', assignment.admissionGuestId!)),
    ).resolves.toBeNull();
    const revokedAssignment = await t.run((ctx) =>
      ctx.db.get('guestListAssignments', assignment.assignmentId),
    );
    expect(revokedAssignment?.admissionGuestId).toBeUndefined();
  });

  it('verifies guest-list backfills through resumable cursor batches before enablement', async () => {
    vi.useFakeTimers();
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Verification batches',
      },
    );
    for (const index of [0, 1, 2]) {
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: `Verification ${index}`,
        date: '2035-07-10T20:00:00.000Z',
        price: 1000,
        organizerId,
        visibility: 'public',
      });
      await t.run(async (ctx) => {
        await ctx.db.insert('guests', {
          eventId,
          name: `Guest ${index}`,
          email: `guest-${index}@example.com`,
          emailKey: `guest-${index}@example.com`,
          type: 'guest',
        });
        await ctx.db.insert('guestListEventStats', {
          eventId,
          selfServiceGuestCount: 0,
          activeGrantedSlots: 0,
          activeArtistGuestCount: 0,
          activeStaffGuestCount: 0,
          activeAssignmentCount: 0,
          totalGuestAdmissionCount: 1,
        });
      });
    }
    const first = await t.mutation(
      internal.guest_list.maintenance.recordBackfillVerification,
      {
        batchSize: 1,
      },
    );
    expect(first.inProgress).toBe(true);
    await expect(
      t.mutation(internal.guest_list.maintenance.enable, {}),
    ).rejects.toThrow(/not verified/i);
    await finishAllScheduledFunctions(t);
    await expect(
      t.mutation(internal.guest_list.maintenance.enable, {}),
    ).resolves.toBeNull();
    expect(
      await t.query(internal.guest_list.maintenance.getFeatureState, {}),
    ).toMatchObject({
      emailKeyBackfillComplete: true,
      guestCountBackfillComplete: true,
      verificationInProgress: false,
    });
  });

  it('refuses enablement when stored event stats do not match authoritative rows', async () => {
    vi.useFakeTimers();
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Mismatched verification stats',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Mismatched counters',
      date: '2035-07-10T20:00:00.000Z',
      price: 1000,
      organizerId,
      visibility: 'public',
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('guests', {
        eventId,
        name: 'Counted Guest',
        email: 'counted@example.com',
        emailKey: 'counted@example.com',
        type: 'guest',
      });
      await ctx.db.insert('guestListEventStats', {
        eventId,
        selfServiceGuestCount: 0,
        activeGrantedSlots: 0,
        activeArtistGuestCount: 0,
        activeStaffGuestCount: 0,
        activeAssignmentCount: 0,
        totalGuestAdmissionCount: 0,
      });
    });

    await t.mutation(
      internal.guest_list.maintenance.recordBackfillVerification,
      {batchSize: 1},
    );
    await finishAllScheduledFunctions(t);

    await expect(
      t.mutation(internal.guest_list.maintenance.enable, {}),
    ).rejects.toThrow(/not verified/i);
    expect(
      await t.query(internal.guest_list.maintenance.getFeatureState, {}),
    ).toMatchObject({
      guestCountBackfillComplete: false,
      verificationInProgress: false,
    });
  });

  it('reconciles exactly 5000 guests and fails closed on guest overflow', async () => {
    const {t, eventId} = await setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 5000; index += 1) {
        await ctx.db.insert('guests', {
          eventId,
          name: `Boundary Guest ${index}`,
          type: 'guest',
        });
      }
    });

    await expect(
      t.mutation(internal.guest_list.maintenance.reconcileEventCounters, {
        eventId,
      }),
    ).resolves.toBeNull();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('guestListEventStats')
          .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
          .unique(),
      ),
    ).toMatchObject({totalGuestAdmissionCount: 5000});

    await t.run((ctx) =>
      ctx.db.insert('guests', {
        eventId,
        name: 'Overflow Guest',
        type: 'guest',
      }),
    );
    await expect(
      t.mutation(internal.guest_list.maintenance.reconcileEventCounters, {
        eventId,
      }),
    ).rejects.toThrow(/exceeds the supported per-event limit/i);
    await t.run(async (ctx) => {
      const stats = await ctx.db
        .query('guestListEventStats')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .unique();
      if (stats) await ctx.db.delete('guestListEventStats', stats._id);
    });
    await expect(
      t.mutation(internal.migrations.backfillGuestListEventStats, {
        cursor: null,
        dryRun: false,
        batchSize: 100,
        oneBatchOnly: true,
      }),
    ).rejects.toThrow(/exceeds the supported per-event limit/i);
  }, 20_000);

  it('reconciles exactly 500 assignments and fails closed on assignment overflow', async () => {
    const {t, eventId, organizerId, managerId} = await setup();
    const insertAssignment = (
      ctx: Parameters<Parameters<typeof t.run>[0]>[0],
      index: number,
    ) =>
      ctx.db.insert('guestListAssignments', {
        eventId,
        organizerId,
        role: index % 2 === 0 ? ('artist' as const) : ('staff' as const),
        displayName: `Boundary Delegate ${index}`,
        email: `boundary-${index}@example.com`,
        emailKey: `boundary-${index}@example.com`,
        eventDate: '2035-07-10T20:00:00.000Z',
        grantedSlots: 2,
        usedSlots: 1,
        status: 'active' as const,
        inviteState: 'pending' as const,
        createdBy: managerId,
        createdAt: index,
        invitedAt: index,
        idempotencyKey: `boundary-${index}`,
      });
    await t.run(async (ctx) => {
      for (let index = 0; index < 500; index += 1) {
        await insertAssignment(ctx, index);
      }
    });

    await expect(
      t.mutation(internal.guest_list.maintenance.reconcileEventCounters, {
        eventId,
      }),
    ).resolves.toBeNull();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('guestListEventStats')
          .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
          .unique(),
      ),
    ).toMatchObject({activeAssignmentCount: 500, activeGrantedSlots: 1000});

    await t.run((ctx) => insertAssignment(ctx, 500));
    await expect(
      t.mutation(internal.guest_list.maintenance.reconcileEventCounters, {
        eventId,
      }),
    ).rejects.toThrow(/exceeds the supported per-event limit/i);
  }, 20_000);

  it('ignores a stale event-date synchronization chain after a newer update', async () => {
    vi.useFakeTimers();
    const {t, manager, eventId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Rescheduled Artist',
        email: 'rescheduled-artist@example.com',
        idempotencyKey: 'rescheduled-artist',
      },
    );
    await t.mutation(cancelGuestListScheduledWork, {});
    const staleDate = '2035-07-10T20:00:00.000Z';
    const currentDate = '2035-07-12T20:00:00.000Z';
    await manager.mutation(api.events.management.update, {
      id: eventId,
      date: currentDate,
      endDate: '2035-07-13T06:00:00.000Z',
    });
    await t.mutation(cancelGuestListScheduledWork, {});

    await t.mutation(internal.guest_list.maintenance.syncAssignmentEventDate, {
      eventId,
      eventDate: currentDate,
    });
    await t.mutation(internal.guest_list.maintenance.syncAssignmentEventDate, {
      eventId,
      eventDate: staleDate,
    });

    await expect(
      t.run((ctx) =>
        ctx.db.get('guestListAssignments', assignment.assignmentId),
      ),
    ).resolves.toMatchObject({eventDate: currentDate});
  });

  it('promotes only the owning invite attempt and preserves active token on resend failure', async () => {
    const {t, manager, eventId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Accountless',
        email: 'accountless@example.com',
        idempotencyKey: 'initial-attempt',
      },
    );
    await t.mutation(internal.guest_list.invite_state.prepareAttempt, {
      assignmentId: assignment.assignmentId,
      attemptId: 'initial-attempt',
      tokenDigest: 'prepared-digest',
      tokenPrefix: 'prepared',
    });
    expect(
      await t.mutation(internal.guest_list.invite_state.promoteAttempt, {
        assignmentId: assignment.assignmentId,
        attemptId: 'wrong-attempt',
      }),
    ).toBe(false);
    expect(
      await t.mutation(internal.guest_list.invite_state.promoteAttempt, {
        assignmentId: assignment.assignmentId,
        attemptId: 'initial-attempt',
      }),
    ).toBe(true);
    await manager.mutation(api.guest_list.assignments.resendInvite, {
      assignmentId: assignment.assignmentId,
      idempotencyKey: 'resend-attempt',
    });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const inviteJobs = scheduled.filter((job) =>
      JSON.stringify(job).includes('sendInviteAttempt'),
    );
    expect(inviteJobs.length).toBeGreaterThan(0);
    expect(JSON.stringify(inviteJobs)).not.toContain('"token"');
    await expect(
      t.mutation(internal.guest_list.invite_state.prepareAttempt, {
        assignmentId: assignment.assignmentId,
        attemptId: 'resend-attempt',
        tokenDigest: 'resend-digest',
        tokenPrefix: 'resend',
      }),
    ).resolves.toBe(true);
    expect(
      await t.mutation(internal.guest_list.invite_state.failAttempt, {
        assignmentId: assignment.assignmentId,
        attemptId: 'initial-attempt',
        failureCode: 'late_initial_failure',
      }),
    ).toBe(false);
    await t.mutation(internal.guest_list.invite_state.failAttempt, {
      assignmentId: assignment.assignmentId,
      attemptId: 'resend-attempt',
      failureCode: 'provider_rejected',
    });
    const row = await t.run((ctx) =>
      ctx.db.get('guestListAssignments', assignment.assignmentId),
    );
    expect(row?.inviteState).toBe('failed');
    expect(row?.tokenDigest).toBeDefined();
  });

  it('aborts a prepared resend when the event is cancelled before delivery', async () => {
    vi.useFakeTimers();
    const {t, manager, eventId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'artist',
        displayName: 'Cancelled Invite Artist',
        email: 'cancelled-invite@example.com',
        idempotencyKey: 'cancelled-invite-attempt',
      },
    );
    await t.mutation(cancelGuestListScheduledWork, {});
    await expect(
      t.mutation(internal.guest_list.invite_state.prepareAttempt, {
        assignmentId: assignment.assignmentId,
        attemptId: 'cancelled-invite-attempt',
        tokenDigest: 'accepted-invite-digest',
        tokenPrefix: 'accepted',
      }),
    ).resolves.toBe(true);
    await expect(
      t.mutation(internal.guest_list.invite_state.promoteAttempt, {
        assignmentId: assignment.assignmentId,
        attemptId: 'cancelled-invite-attempt',
      }),
    ).resolves.toBe(true);
    await manager.mutation(api.guest_list.assignments.resendInvite, {
      assignmentId: assignment.assignmentId,
      idempotencyKey: 'cancelled-invite-resend',
    });
    await t.mutation(cancelGuestListScheduledWork, {});
    await expect(
      t.mutation(internal.guest_list.invite_state.prepareAttempt, {
        assignmentId: assignment.assignmentId,
        attemptId: 'cancelled-invite-resend',
        tokenDigest: 'cancelled-resend-digest',
        tokenPrefix: 'cancelled',
      }),
    ).resolves.toBe(true);
    await manager.mutation(api.events.management.update, {
      id: eventId,
      status: 'cancelled',
    });

    await expect(
      t.query(internal.guest_list.invite_state.loadAttempt, {
        assignmentId: assignment.assignmentId,
        attemptId: 'cancelled-invite-resend',
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(internal.guest_list.invite_state.promoteAttempt, {
        assignmentId: assignment.assignmentId,
        attemptId: 'cancelled-invite-resend',
      }),
    ).resolves.toBe(false);
    await expect(
      t.mutation(abortInviteAttempt, {
        assignmentId: assignment.assignmentId,
        attemptId: 'cancelled-invite-resend',
        failureCode: 'event_inactive',
      }),
    ).resolves.toBe(true);
    const aborted = await t.run((ctx) =>
      ctx.db.get('guestListAssignments', assignment.assignmentId),
    );
    expect(aborted).toMatchObject({
      tokenDigest: 'accepted-invite-digest',
      tokenPrefix: 'accepted',
      inviteState: 'failed',
      inviteFailureCode: 'event_inactive',
    });
    expect(aborted?.pendingTokenDigest).toBeUndefined();
    expect(aborted?.pendingTokenPrefix).toBeUndefined();
  });

  it('aborts automatic ticket delivery when the event is cancelled', async () => {
    vi.useFakeTimers();
    const {t, manager, eventId} = await setup();
    const assignment = await manager.mutation(
      api.guest_list.assignments.create,
      {
        eventId,
        role: 'staff',
        displayName: 'Cancelled Ticket Staff',
        email: 'cancelled-ticket@example.com',
        idempotencyKey: 'cancelled-ticket-assignment',
      },
    );
    await t.mutation(cancelGuestListScheduledWork, {});
    await manager.mutation(api.events.management.update, {
      id: eventId,
      status: 'cancelled',
    });

    await expect(
      t.query(internal.guest_list.invite_state.getAssignmentForTicket, {
        assignmentId: assignment.assignmentId,
      }),
    ).resolves.toBeNull();
  });
});
