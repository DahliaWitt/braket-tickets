import {describe, expect, it} from 'vitest';
import {convexTest} from './setup.testing';
import {api, internal} from './_generated/api';
import type {Id} from './_generated/dataModel';
import {digestBearerToken, tokenPrefix} from './lib/token_digests';

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
