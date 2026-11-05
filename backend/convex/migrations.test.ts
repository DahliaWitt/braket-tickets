import {ConvexError} from 'convex/values';
import {describe, expect, it} from 'vitest';
import {convexTest} from './setup.testing';
import {api, internal} from './_generated/api';
import type {Id} from './_generated/dataModel';
import {digestBearerToken, tokenPrefix} from './lib/token_digests';
import {
  classifyMigrationDryRun,
  emailDeliveryRecipientKeyPatch,
  guestEmailKeyPatch,
} from './migrations';
import {UNNORMALIZABLE_RECIPIENT_KEY} from './lib/validators/email_delivery';
import {MAX_ASSIGNMENTS_PER_EVENT_STATS} from './lib/guest_list/event_stats';

async function runBackfill(
  t: ReturnType<typeof convexTest>,
  fn: Parameters<typeof t.mutation>[0],
): Promise<void> {
  await t.mutation(fn, {
    cursor: null,
    dryRun: false,
    batchSize: 100,
    oneBatchOnly: true,
  });
}

describe('token digest migrations', () => {
  it('dry-runs without committing and migrates legacy plaintext token rows idempotently', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      email: 'legacy-token-user@example.com',
      name: 'Legacy Token User',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Legacy Token Community',
        status: 'published',
      },
    )) as Id<'organizers'>;
    const eventId = (await t.mutation(api.testing.events.seedEvent, {
      title: 'Legacy Token Event',
      date: '2030-01-01',
      price: 2500,
      organizerId,
      visibility: 'public',
      ticketSalesStatus: 'active',
    })) as Id<'events'>;
    const fixtures = await t.mutation(
      api.testing.token_migration_fixtures.seedLegacyTokenRows,
      {
        userId,
        organizerId,
        eventId,
        email: 'legacy-token-user@example.com',
      },
    );

    await expect(
      t.mutation(internal.migrations.backfillMagicLinkTokenDigests, {
        cursor: null,
        dryRun: true,
        batchSize: 100,
        oneBatchOnly: true,
      }),
    ).rejects.toThrow('DRY RUN');

    const magicLinkAfterDryRun = await t.run(async (ctx) =>
      ctx.db.get(fixtures.magicLinkId),
    );
    expect(magicLinkAfterDryRun?.token).toBe(fixtures.tokens.magicLink);
    expect(magicLinkAfterDryRun?.tokenDigest).toBeUndefined();

    await runBackfill(t, internal.migrations.backfillMagicLinkTokenDigests);
    await runBackfill(t, internal.migrations.backfillAdminInviteTokenDigests);
    await runBackfill(t, internal.migrations.backfillGuestSessionTokenDigests);
    await runBackfill(
      t,
      internal.migrations.backfillUserMarketingUnsubscribeTokenDigests,
    );
    await runBackfill(
      t,
      internal.migrations.backfillAddressMarketingUnsubscribeTokenDigests,
    );
    await runBackfill(
      t,
      internal.migrations.backfillMarketingDeliveryTrackingTokenDigests,
    );
    await runBackfill(t, internal.migrations.clearLegacyUserEmailChangeTokens);

    const migrated = await t.run(async (ctx) => ({
      adminInvite: await ctx.db.get(fixtures.adminInviteId),
      magicLink: await ctx.db.get(fixtures.magicLinkId),
      guestSession: await ctx.db.get(fixtures.guestSessionId),
      userPreference: await ctx.db.get(fixtures.userPreferenceId),
      addressPreference: await ctx.db.get(fixtures.addressPreferenceId),
      delivery: await ctx.db.get(fixtures.marketingDeliveryId),
      user: await ctx.db.get(userId),
    }));

    expect(migrated.adminInvite?.token).toBeUndefined();
    expect(migrated.adminInvite?.tokenDigest).toBe(
      await digestBearerToken('admin_invite', fixtures.tokens.adminInvite),
    );
    expect(migrated.adminInvite?.tokenPrefix).toBe(
      tokenPrefix(fixtures.tokens.adminInvite),
    );

    expect(migrated.magicLink?.token).toBeUndefined();
    expect(migrated.magicLink?.tokenDigest).toBe(
      await digestBearerToken('magic_link', fixtures.tokens.magicLink),
    );
    expect(migrated.magicLink?.tokenPrefix).toBe(
      tokenPrefix(fixtures.tokens.magicLink),
    );

    expect(migrated.guestSession?.sessionToken).toBeUndefined();
    expect(migrated.guestSession?.sessionTokenDigest).toBe(
      await digestBearerToken('guest_session', fixtures.tokens.guestSession),
    );
    expect(migrated.guestSession?.sessionTokenPrefix).toBe(
      tokenPrefix(fixtures.tokens.guestSession),
    );

    expect(migrated.userPreference?.unsubToken).toBeUndefined();
    expect(migrated.userPreference?.unsubTokenDigest).toBe(
      await digestBearerToken(
        'marketing_unsubscribe_user',
        fixtures.tokens.userUnsubscribe,
      ),
    );
    expect(migrated.userPreference?.unsubTokenPrefix).toBe(
      tokenPrefix(fixtures.tokens.userUnsubscribe),
    );

    expect(migrated.addressPreference?.unsubToken).toBeUndefined();
    expect(migrated.addressPreference?.unsubTokenDigest).toBe(
      await digestBearerToken(
        'marketing_unsubscribe_address',
        fixtures.tokens.addressUnsubscribe,
      ),
    );
    expect(migrated.addressPreference?.unsubTokenPrefix).toBe(
      tokenPrefix(fixtures.tokens.addressUnsubscribe),
    );

    expect(migrated.delivery?.openToken).toBeUndefined();
    expect(migrated.delivery?.openTokenDigest).toBe(
      await digestBearerToken(
        'marketing_tracking_open',
        fixtures.tokens.trackingOpen,
      ),
    );
    expect(migrated.delivery?.openTokenPrefix).toBe(
      tokenPrefix(fixtures.tokens.trackingOpen),
    );
    expect(migrated.delivery?.clickToken).toBeUndefined();
    expect(migrated.delivery?.clickTokenDigest).toBe(
      await digestBearerToken(
        'marketing_tracking_click',
        fixtures.tokens.trackingClick,
      ),
    );
    expect(migrated.delivery?.clickTokenPrefix).toBe(
      tokenPrefix(fixtures.tokens.trackingClick),
    );

    expect(migrated.user?.emailChangeToken).toBeUndefined();
    expect(migrated.user?.emailChangeTokenExpiry).toBeUndefined();
    expect(migrated.user?.pendingEmail).toBe('updated-legacy@example.com');

    await runBackfill(t, internal.migrations.backfillMagicLinkTokenDigests);
    await runBackfill(t, internal.migrations.backfillAdminInviteTokenDigests);
    await runBackfill(t, internal.migrations.backfillGuestSessionTokenDigests);
    await runBackfill(
      t,
      internal.migrations.backfillUserMarketingUnsubscribeTokenDigests,
    );
    await runBackfill(
      t,
      internal.migrations.backfillAddressMarketingUnsubscribeTokenDigests,
    );
    await runBackfill(
      t,
      internal.migrations.backfillMarketingDeliveryTrackingTokenDigests,
    );
    await runBackfill(t, internal.migrations.clearLegacyUserEmailChangeTokens);

    const rerun = await t.run(async (ctx) => ({
      adminInvite: await ctx.db.get(fixtures.adminInviteId),
      magicLink: await ctx.db.get(fixtures.magicLinkId),
      guestSession: await ctx.db.get(fixtures.guestSessionId),
      userPreference: await ctx.db.get(fixtures.userPreferenceId),
      addressPreference: await ctx.db.get(fixtures.addressPreferenceId),
      delivery: await ctx.db.get(fixtures.marketingDeliveryId),
      user: await ctx.db.get(userId),
    }));
    expect(rerun).toEqual(migrated);
  });
});

describe('guest-list migrations', () => {
  it('uses the definition batch size to process one event-stats row per transaction', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Guest-list migration batching',
        status: 'published',
      },
    );
    for (const [index, date] of [
      ['one', '2035-07-10T20:00:00.000Z'],
      ['two', '2035-07-11T20:00:00.000Z'],
    ] as const) {
      await t.mutation(api.testing.events.seedEvent, {
        title: `Migration event ${index}`,
        date,
        price: 2000,
        organizerId,
        visibility: 'public',
        ticketSalesStatus: 'active',
      });
    }

    await t.mutation(internal.migrations.backfillGuestListEventStats, {
      cursor: null,
      dryRun: false,
      oneBatchOnly: true,
    });

    const stats = await t.run((ctx) =>
      ctx.db.query('guestListEventStats').collect(),
    );
    expect(stats).toHaveLength(1);
  });

  it('advances the guests step by a full batch instead of one row per transaction', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Guest-list safe runner',
        status: 'published',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Guest-list safe runner event',
      date: '2035-07-10T20:00:00.000Z',
      price: 2000,
      organizerId,
      visibility: 'public',
      ticketSalesStatus: 'active',
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally legacy rows for migration batching regression
      await ctx.db.insert('guests', {
        eventId,
        name: 'Legacy Guest One',
        email: 'legacy-one@example.com',
        type: 'guest',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally legacy rows for migration batching regression
      await ctx.db.insert('guests', {
        eventId,
        name: 'Legacy Guest Two',
        email: 'legacy-two@example.com',
        type: 'guest',
      });
    });

    await t.mutation(internal.migrations.runGuestListBackfills, {
      batchSize: 100,
      oneBatchOnly: true,
    });

    const guests = await t.run((ctx) =>
      ctx.db
        .query('guests')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(guests.filter((guest) => guest.emailKey !== undefined)).toHaveLength(
      2,
    );
  });

  it('skips an event it cannot count instead of killing the series, and reports it', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Oversized rollout'},
    );
    const managerId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Oversized manager',
      email: 'oversized-manager@example.com',
      isRootAdmin: true,
    });
    const oversizedEventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Oversized legacy event',
      date: '2035-07-10T20:00:00.000Z',
      price: 2000,
      organizerId,
      visibility: 'public',
    });
    const healthyEventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Healthy event',
      date: '2035-07-11T20:00:00.000Z',
      price: 2000,
      organizerId,
      visibility: 'public',
    });
    await t.run(async (ctx) => {
      for (
        let index = 0;
        index <= MAX_ASSIGNMENTS_PER_EVENT_STATS;
        index += 1
      ) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- legacy over-cap data that production creation now rejects
        await ctx.db.insert('guestListAssignments', {
          eventId: oversizedEventId,
          organizerId,
          role: 'staff',
          displayName: `Legacy delegate ${index}`,
          email: `legacy-delegate-${index}@example.com`,
          emailKey: `legacy-delegate-${index}@example.com`,
          grantedSlots: 2,
          usedSlots: 0,
          status: 'active',
          inviteState: 'pending',
          createdBy: managerId,
          createdAt: index,
          invitedAt: index,
          idempotencyKey: `legacy-delegate-${index}`,
        });
      }
    });

    // The migrations component records `state.error` and stops scheduling the
    // rest of the series for any migration that throws (component/lib.ts). The
    // property that keeps the chain alive is therefore that this resolves.
    await expect(
      t.mutation(internal.migrations.backfillGuestListEventStats, {
        cursor: null,
        dryRun: false,
        batchSize: 2,
        oneBatchOnly: true,
      }),
    ).resolves.toMatchObject({processed: 2});

    // Later steps of the series still do their work.
    await t.mutation(
      internal.migrations.backfillGuestListAssignmentEventDates,
      {
        cursor: null,
        dryRun: false,
        batchSize: 1_000,
        oneBatchOnly: true,
      },
    );

    const [oversizedStats, healthyStats, assignmentsMissingDate] = await t.run(
      async (ctx) => [
        await ctx.db
          .query('guestListEventStats')
          .withIndex('by_eventId', (q) => q.eq('eventId', oversizedEventId))
          .unique(),
        await ctx.db
          .query('guestListEventStats')
          .withIndex('by_eventId', (q) => q.eq('eventId', healthyEventId))
          .unique(),
        (await ctx.db.query('guestListAssignments').collect()).filter(
          (assignment) => assignment.eventDate === undefined,
        ),
      ],
    );
    expect(oversizedStats).toBeNull();
    expect(healthyStats).not.toBeNull();
    expect(assignmentsMissingDate).toHaveLength(0);

    // The skipped event is enumerable, with actionable counts.
    const report = await t.query(
      internal.guest_list.maintenance.listEventsMissingGuestListStats,
      {},
    );
    expect(report.eventIds).toEqual([oversizedEventId]);
    expect(report.isDone).toBe(true);

    const detail = await t.query(
      internal.guest_list.maintenance.describeGuestListEventLoad,
      {eventId: oversizedEventId},
    );
    expect(detail.hasStatsRow).toBe(false);
    expect(detail.counters).toBeNull();
    expect(detail.overage).toMatchObject({
      eventId: oversizedEventId,
      activeAssignmentCount: MAX_ASSIGNMENTS_PER_EVENT_STATS + 1,
      activeAssignmentCountAtLeast: true,
      maxActiveAssignmentsPerEvent: MAX_ASSIGNMENTS_PER_EVENT_STATS,
    });
  });
});

describe('ticket roster email backfill', () => {
  it('projects a legacy guest-checkout ticket into the roster email index', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Legacy roster'},
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Legacy roster event',
      date: '2035-07-10T20:00:00.000Z',
      price: 2000,
      organizerId,
      visibility: 'public',
    });
    const guestSessionId = await t.mutation(
      api.testing.guest_sessions.seedGuestSession,
      {
        email: 'Legacy.Buyer@Example.com',
        sessionToken: 'legacy-roster-session-token',
      },
    );
    const ticketId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- pre-projection guest-checkout ticket; production issuance always writes the projection
      ctx.db.insert('tickets', {
        eventId,
        guestSessionId,
        status: 'valid',
        tier: 'regular',
      }),
    );

    await t.mutation(internal.migrations.backfillTicketRosterEmailLower, {
      cursor: null,
      dryRun: false,
      batchSize: 100,
      oneBatchOnly: true,
    });

    const ticket = await t.run((ctx) => ctx.db.get('tickets', ticketId));
    expect(ticket?.rosterEmail).toBe('legacy.buyer@example.com');
    expect(ticket?.rosterEmailLower).toBe('legacy.buyer@example.com');
    expect(ticket?.rosterIsActive).toBe(true);

    // The dedup index the guest-list assignment path reads now finds the row.
    const indexed = await t.run((ctx) =>
      ctx.db
        .query('tickets')
        .withIndex('by_event_and_rosterEmailLower_and_status', (q) =>
          q
            .eq('eventId', eventId)
            .eq('rosterEmailLower', 'legacy.buyer@example.com')
            .eq('status', 'valid'),
        )
        .collect(),
    );
    expect(indexed.map((row) => row._id)).toEqual([ticketId]);
  });

  it('does not rewrite a ticket that already carries the projection', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Projected roster'},
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Projected roster event',
      date: '2035-07-10T20:00:00.000Z',
      price: 2000,
      organizerId,
      visibility: 'public',
    });
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Projected Buyer',
      email: 'projected-buyer@example.com',
    });
    const ticketId = await t.mutation(api.testing.tickets.seedTicket, {
      userId,
      eventId,
      status: 'valid',
      tier: 'regular',
      trustSource: 'open_access',
    });
    // A sentinel the projection builder would overwrite if the row were
    // patched. The email fields are already correct, so it must survive.
    await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- sentinel that makes an unnecessary rewrite observable
      ctx.db.patch('tickets', ticketId, {
        rosterAttendeeName: 'DO NOT REWRITE',
      }),
    );

    await t.mutation(internal.migrations.backfillTicketRosterEmailLower, {
      cursor: null,
      dryRun: false,
      batchSize: 100,
      oneBatchOnly: true,
    });

    const ticket = await t.run((ctx) => ctx.db.get('tickets', ticketId));
    expect(ticket?.rosterAttendeeName).toBe('DO NOT REWRITE');
    expect(ticket?.rosterEmailLower).toBe('projected-buyer@example.com');
  });
});

describe('guest email key backfill decisions', () => {
  it('rewrites nothing when the stored key already matches', () => {
    expect(
      guestEmailKeyPatch({
        email: 'Guest@Example.com',
        emailKey: 'guest@example.com',
      }),
    ).toEqual({});
  });

  it('rewrites nothing for a guest with no email', () => {
    expect(guestEmailKeyPatch({})).toEqual({});
    expect(guestEmailKeyPatch({email: '   '})).toEqual({});
  });

  it('adds the normalized key to a legacy guest that needs one', () => {
    expect(guestEmailKeyPatch({email: ' Guest@Example.com '})).toEqual({
      emailKey: 'guest@example.com',
    });
  });

  it('clears a stale key when the email no longer normalizes', () => {
    expect(guestEmailKeyPatch({emailKey: 'stale@example.com'})).toEqual({
      emailKey: undefined,
    });
  });
});

describe('email delivery recipient key backfill', () => {
  it('keys unnormalizable recipients with the sentinel so they leave the legacy scan', () => {
    expect(emailDeliveryRecipientKeyPatch({recipient: '   '})).toEqual({
      recipientKey: UNNORMALIZABLE_RECIPIENT_KEY,
    });
    expect(
      emailDeliveryRecipientKeyPatch({
        recipient: 'Legacy@Example.com',
        recipientKey: 'legacy@example.com',
      }),
    ).toEqual({});
  });
});

describe('migration dry-run classification', () => {
  it('treats a partially advanced dry run as successful', () => {
    // getMigrationState reports "unknown" whenever a dry run stops part-way
    // through a table, which is every table larger than one batch.
    expect(
      classifyMigrationDryRun(
        new ConvexError({kind: 'DRY RUN', status: {state: 'unknown'}}),
      ),
    ).toBe('succeeded');
    expect(
      classifyMigrationDryRun(
        new ConvexError({kind: 'DRY RUN', status: {state: 'success'}}),
      ),
    ).toBe('succeeded');
  });

  it('treats a recorded migration error as a failed dry run', () => {
    expect(
      classifyMigrationDryRun(
        new ConvexError({
          kind: 'DRY RUN',
          status: {state: 'failed', error: 'boom'},
        }),
      ),
    ).toBe('failed');
  });

  it('refuses to recognize a foreign or reshaped payload', () => {
    expect(classifyMigrationDryRun(new Error('boom'))).toBe('unrecognized');
    expect(classifyMigrationDryRun(new ConvexError('boom'))).toBe(
      'unrecognized',
    );
    expect(classifyMigrationDryRun(new ConvexError({kind: 'DRY RUN'}))).toBe(
      'unrecognized',
    );
  });

  it('accepts the payload the installed component actually throws for a multi-batch dry run', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Dry run guard'},
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Dry run guard event',
      date: '2035-07-10T20:00:00.000Z',
      price: 2000,
      organizerId,
      visibility: 'public',
    });
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- legacy unkeyed guests needed to exceed one migration batch
        await ctx.db.insert('guests', {
          eventId,
          name: `Dry run guest ${index}`,
          email: `dry-run-${index}@example.com`,
          type: 'guest',
        });
      }
    });

    // A dry run over more rows than one batch must not surface as a failure.
    await expect(
      t.mutation(internal.migrations.runGuestListBackfills, {dryRun: true}),
    ).resolves.toBeNull();
  });
});
