import {describe, expect, it, vi} from 'vitest';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {getAppErrorCode} from '../lib/errors';
import {MAX_ASSIGNMENTS_PER_EVENT_STATS} from '../lib/guest_list/event_stats';
import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {GUEST_LIST_ENABLE_BLOCKED} from './maintenance';

type TestInstance = ReturnType<typeof convexTest>;

async function runVerification(
  t: TestInstance,
  acknowledgedOversizedEventIds?: Id<'events'>[],
): Promise<void> {
  await t.mutation(
    internal.guest_list.maintenance.recordBackfillVerification,
    acknowledgedOversizedEventIds
      ? {batchSize: 100, acknowledgedOversizedEventIds}
      : {batchSize: 100},
  );
  await finishAllScheduledFunctions(t);
}

/** Runs both migrations that `enable` gates on, so they record `isDone`. */
async function completeGatedMigrations(t: TestInstance): Promise<void> {
  await t.mutation(internal.migrations.runEmailDeliveryRecipientKeyBackfill, {});
  await t.mutation(internal.migrations.runTicketRosterEmailBackfill, {});
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

function blockersOf(error: unknown): string[] {
  const data: unknown = (error as {data?: unknown}).data;
  const blockers: unknown = (data as {blockers?: unknown}).blockers;
  return Array.isArray(blockers) ? (blockers as string[]) : [];
}

describe('guest-list enablement gate', () => {
  it('refuses to enable while a gated migration has not completed', async () => {
    const t = convexTest();
    vi.useFakeTimers();
    try {
      await runVerification(t);

      const error = await captureError(
        t.mutation(internal.guest_list.maintenance.enable, {}),
      );
      expect(getAppErrorCode(error)).toBe(GUEST_LIST_ENABLE_BLOCKED);
      expect(blockersOf(error)).toEqual([
        'recipientKeyBackfillIncomplete',
        'ticketRosterEmailBackfillIncomplete',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enables once verification and both gated migrations are complete', async () => {
    const t = convexTest();
    vi.useFakeTimers();
    try {
      await completeGatedMigrations(t);
      await runVerification(t);

      await expect(
        t.mutation(internal.guest_list.maintenance.enable, {}),
      ).resolves.toBeNull();

      const state = await t.query(
        internal.guest_list.maintenance.getFeatureState,
        {},
      );
      expect(state?.enabledAt).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to enable while verification has never run', async () => {
    const t = convexTest();
    await completeGatedMigrations(t);

    const error = await captureError(
      t.mutation(internal.guest_list.maintenance.enable, {}),
    );
    expect(getAppErrorCode(error)).toBe(GUEST_LIST_ENABLE_BLOCKED);
    expect(blockersOf(error)).toContain('verificationNeverRun');
  });
});

describe('guest-list verification with an uncountable event', () => {
  async function seedOversizedEvent(t: TestInstance): Promise<Id<'events'>> {
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Verification oversized'},
    );
    const managerId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Verification manager',
      email: 'verification-manager@example.com',
      isRootAdmin: true,
    });
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Verification oversized event',
      date: '2035-07-10T20:00:00.000Z',
      price: 2000,
      organizerId,
      visibility: 'public',
    });
    await t.run(async (ctx) => {
      for (let index = 0; index <= MAX_ASSIGNMENTS_PER_EVENT_STATS; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- legacy over-cap data that production creation now rejects
        await ctx.db.insert('guestListAssignments', {
          eventId,
          organizerId,
          role: 'staff',
          displayName: `Verification delegate ${index}`,
          email: `verification-delegate-${index}@example.com`,
          emailKey: `verification-delegate-${index}@example.com`,
          eventDate: '2035-07-10T20:00:00.000Z',
          grantedSlots: 2,
          usedSlots: 0,
          status: 'active',
          inviteState: 'pending',
          createdBy: managerId,
          createdAt: index,
          invitedAt: index,
          idempotencyKey: `verification-delegate-${index}`,
        });
      }
    });
    return eventId;
  }

  it('stays incomplete and names the blocker when an event cannot be counted', async () => {
    const t = convexTest();
    vi.useFakeTimers();
    try {
      await seedOversizedEvent(t);
      await completeGatedMigrations(t);
      await runVerification(t);

      const state = await t.query(
        internal.guest_list.maintenance.getFeatureState,
        {},
      );
      expect(state?.guestCountBackfillComplete).toBe(false);
      expect(state?.verificationInProgress).toBe(false);

      const error = await captureError(
        t.mutation(internal.guest_list.maintenance.enable, {}),
      );
      expect(getAppErrorCode(error)).toBe(GUEST_LIST_ENABLE_BLOCKED);
      expect(blockersOf(error)).toEqual(['guestCountBackfillIncomplete']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('completes when the operator explicitly acknowledges the uncountable event', async () => {
    const t = convexTest();
    vi.useFakeTimers();
    try {
      const eventId = await seedOversizedEvent(t);
      await completeGatedMigrations(t);
      await runVerification(t, [eventId]);

      const state = await t.query(
        internal.guest_list.maintenance.getFeatureState,
        {},
      );
      expect(state?.guestCountBackfillComplete).toBe(true);

      await expect(
        t.mutation(internal.guest_list.maintenance.enable, {}),
      ).resolves.toBeNull();

      // Acknowledged, never silently repaired: the event still has no counters,
      // so every guest-list write for it keeps failing closed.
      const detail = await t.query(
        internal.guest_list.maintenance.describeGuestListEventLoad,
        {eventId},
      );
      expect(detail.hasStatsRow).toBe(false);
      expect(detail.counters).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an acknowledgement mask a countable event with wrong counters', async () => {
    const t = convexTest();
    vi.useFakeTimers();
    try {
      const organizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {name: 'Acknowledgement scope'},
      );
      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Countable event',
        date: '2035-07-10T20:00:00.000Z',
        price: 2000,
        organizerId,
        visibility: 'public',
      });
      await completeGatedMigrations(t);

      // No stats row was ever written for this countable event.
      await runVerification(t, [eventId]);

      const state = await t.query(
        internal.guest_list.maintenance.getFeatureState,
        {},
      );
      expect(state?.guestCountBackfillComplete).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
