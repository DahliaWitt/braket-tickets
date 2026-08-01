import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {internal} from '../_generated/api';
import {emailDeliveryRecipientKeyPatch} from '../migrations';
import {getAppErrorCode} from '../lib/errors';
import {
  EMAIL_DELIVERY_LEGACY_RECIPIENT_SCAN_EXCEEDED,
  UNNORMALIZABLE_RECIPIENT_KEY,
} from '../lib/validators/email_delivery';

describe('email_delivery', () => {
  describe('hasDelivery', () => {
    it('returns false when no delivery exists for the source/sourceId', async () => {
      const t = convexTest();

      const result = await t.query(internal.email.email_delivery.hasDelivery, {
        source: 'ticket',
        sourceId: 'guest-missing',
      });

      expect(result).toBe(false);
    });

    it('returns true once a delivery has been recorded, scoped to the pair', async () => {
      const t = convexTest();

      await t.mutation(internal.email.email_delivery.recordDelivery, {
        emailId: 'email-1',
        source: 'ticket',
        sourceId: 'guest-1',
        recipient: 'guest@example.com',
        critical: true,
        manual: false,
        fallback: false,
        provider: 'resend',
      });

      expect(
        await t.query(internal.email.email_delivery.hasDelivery, {
          source: 'ticket',
          sourceId: 'guest-1',
        }),
      ).toBe(true);
      expect(
        await t.query(internal.email.email_delivery.hasDelivery, {
          source: 'ticket',
          sourceId: 'guest-2',
        }),
      ).toBe(false);
    });

    it('scopes ticket delivery deduplication to the recipient when requested', async () => {
      const t = convexTest();

      await t.mutation(internal.email.email_delivery.recordDelivery, {
        emailId: 'email-recipient-aware',
        source: 'ticket',
        sourceId: 'guest-address-changed',
        recipient: 'old-address@example.com',
        critical: true,
        manual: false,
        fallback: false,
        provider: 'resend',
      });

      await expect(
        t.query(internal.email.email_delivery.hasDelivery, {
          source: 'ticket',
          sourceId: 'guest-address-changed',
          recipient: 'OLD-ADDRESS@example.com',
        }),
      ).resolves.toBe(true);
      await expect(
        t.query(internal.email.email_delivery.hasDelivery, {
          source: 'ticket',
          sourceId: 'guest-address-changed',
          recipient: 'new-address@example.com',
        }),
      ).resolves.toBe(false);

      const delivery = await t.run((ctx) =>
        ctx.db
          .query('emailDeliveries')
          .withIndex('by_emailId', (q) =>
            q.eq('emailId', 'email-recipient-aware'),
          )
          .unique(),
      );
      expect(delivery).toMatchObject({
        recipient: 'old-address@example.com',
        recipientKey: 'old-address@example.com',
      });
    });

    it('normalizes legacy recipient rows during rollout', async () => {
      const t = convexTest();
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- legacy pre-recipientKey delivery row required for migration coverage
        await ctx.db.insert('emailDeliveries', {
          emailId: 'legacy-case-delivery',
          source: 'ticket',
          sourceId: 'legacy-case-guest',
          recipient: 'Legacy.Guest@Example.com',
          critical: true,
          manual: false,
          fallback: false,
          provider: 'resend',
          sentAt: Date.now(),
        });
      });

      await expect(
        t.query(internal.email.email_delivery.hasDelivery, {
          source: 'ticket',
          sourceId: 'legacy-case-guest',
          recipient: 'legacy.guest@example.com',
        }),
      ).resolves.toBe(true);
      expect(
        emailDeliveryRecipientKeyPatch({
          recipient: 'Legacy.Guest@Example.com',
        }),
      ).toEqual({recipientKey: 'legacy.guest@example.com'});
    });

    it('fails closed with an actionable code above the legacy scan cap', async () => {
      const t = convexTest();
      await t.run(async (ctx) => {
        for (let index = 0; index < 101; index += 1) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- legacy pre-recipientKey rows required to exceed the bounded fallback
          await ctx.db.insert('emailDeliveries', {
            emailId: `legacy-overflow-${index}`,
            source: 'ticket',
            sourceId: 'legacy-overflow-guest',
            recipient: `Legacy.Overflow.${index}@Example.com`,
            critical: true,
            manual: false,
            fallback: false,
            provider: 'resend',
            sentAt: Date.now(),
          });
        }
      });

      const error = await t
        .query(internal.email.email_delivery.hasDelivery, {
          source: 'ticket',
          sourceId: 'legacy-overflow-guest',
          recipient: 'someone-else@example.com',
        })
        .then(
          () => null,
          (caught: unknown) => caught,
        );

      // A bare Error would reach production as a redacted "Server Error".
      expect(getAppErrorCode(error)).toBe(
        EMAIL_DELIVERY_LEGACY_RECIPIENT_SCAN_EXCEEDED,
      );
    });
  });

  describe('recordDelivery', () => {
    it('keys an unnormalizable recipient with the sentinel so it leaves the legacy scan', async () => {
      const t = convexTest();

      await t.mutation(internal.email.email_delivery.recordDelivery, {
        emailId: 'blank-recipient',
        source: 'ticket',
        sourceId: 'guest-blank-recipient',
        recipient: '   ',
        critical: true,
        manual: false,
        fallback: false,
        provider: 'resend',
      });

      const delivery = await t.run((ctx) =>
        ctx.db
          .query('emailDeliveries')
          .withIndex('by_emailId', (q) => q.eq('emailId', 'blank-recipient'))
          .unique(),
      );
      expect(delivery?.recipientKey).toBe(UNNORMALIZABLE_RECIPIENT_KEY);

      // The sentinel never answers a real normalized lookup.
      await expect(
        t.query(internal.email.email_delivery.hasDelivery, {
          source: 'ticket',
          sourceId: 'guest-blank-recipient',
          recipient: 'real-guest@example.com',
        }),
      ).resolves.toBe(false);
    });

    it('keeps sentinel rows out of the bounded legacy fallback', async () => {
      const t = convexTest();
      for (let index = 0; index < 101; index += 1) {
        await t.mutation(internal.email.email_delivery.recordDelivery, {
          emailId: `blank-${index}`,
          source: 'ticket',
          sourceId: 'guest-many-blank-recipients',
          recipient: ' ',
          critical: true,
          manual: false,
          fallback: false,
          provider: 'resend',
        });
      }

      // Unkeyed rows would have tripped the fail-closed cap.
      await expect(
        t.query(internal.email.email_delivery.hasDelivery, {
          source: 'ticket',
          sourceId: 'guest-many-blank-recipients',
          recipient: 'real-guest@example.com',
        }),
      ).resolves.toBe(false);
    });
  });

  describe('recordFailure', () => {
    it('inserts a failure record', async () => {
      const t = convexTest();

      await t.mutation(internal.email.email_delivery.recordFailure, {
        source: 'announcement',
        sourceId: 'ann-123',
        recipient: 'user@example.com',
        error: 'Connection refused after 3 attempts',
      });

      const failures = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );

      expect(failures).toHaveLength(1);
      expect(failures[0].source).toBe('announcement');
      expect(failures[0].sourceId).toBe('ann-123');
      expect(failures[0].recipient).toBe('user@example.com');
      expect(failures[0].error).toBe('Connection refused after 3 attempts');
      expect(failures[0].failedAt).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // cleanupOldFailures
  // ---------------------------------------------------------------------------

  describe('cleanupOldFailures', () => {
    it('deletes records older than 30 days', async () => {
      const t = convexTest();

      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- must set failedAt to specific past timestamps to test time-based cleanup; no production path allows this
      await t.run(async (ctx) => {
        // Old failure (should be deleted)
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for emailDeliveryFailures
        await ctx.db.insert('emailDeliveryFailures', {
          source: 'application',
          sourceId: 'app-old',
          recipient: 'old@example.com',
          error: 'old error',
          failedAt: thirtyOneDaysAgo,
        });
        // Recent failure (should be kept)
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for emailDeliveryFailures
        await ctx.db.insert('emailDeliveryFailures', {
          source: 'application',
          sourceId: 'app-new',
          recipient: 'new@example.com',
          error: 'recent error',
          failedAt: oneDayAgo,
        });
      });

      await t.mutation(internal.email.email_delivery.cleanupOldFailures, {});

      const remaining = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );

      expect(remaining).toHaveLength(1);
      expect(remaining[0].sourceId).toBe('app-new');
    });

    it('keeps all records when none are older than 30 days', async () => {
      const t = convexTest();

      const twentyNineDaysAgo = Date.now() - 29 * 24 * 60 * 60 * 1000;

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- must set failedAt to specific past timestamp; no production path allows this
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for emailDeliveryFailures
        await ctx.db.insert('emailDeliveryFailures', {
          source: 'ticket',
          sourceId: 'pay-recent',
          recipient: 'r@example.com',
          error: 'err',
          failedAt: twentyNineDaysAgo,
        });
      });

      await t.mutation(internal.email.email_delivery.cleanupOldFailures, {});

      const remaining = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );

      expect(remaining).toHaveLength(1);
    });

    it('deletes up to 500 records per run (batch cap)', async () => {
      const t = convexTest();

      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;

      // Insert 502 old records — must set failedAt to past timestamp, which has no production path.
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- must set failedAt to specific past timestamps; no production path allows this
      await t.run(async (ctx) => {
        for (let i = 0; i < 502; i++) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for emailDeliveryFailures
          await ctx.db.insert('emailDeliveryFailures', {
            source: 'broadcast',
            sourceId: `br-${i}`,
            recipient: `r${i}@example.com`,
            error: 'err',
            failedAt: thirtyOneDaysAgo,
          });
        }
      });

      await t.mutation(internal.email.email_delivery.cleanupOldFailures, {});

      const remaining = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );

      // Should have deleted 500, leaving 2
      expect(remaining).toHaveLength(2);
    });
  });

  describe('cleanupOldDeliveries', () => {
    it('deletes delivery metadata older than 30 days', async () => {
      const t = convexTest();

      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- must set sentAt to specific past timestamps to test time-based cleanup; no production path allows this
      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for emailDeliveries
        await ctx.db.insert('emailDeliveries', {
          emailId: 'old-email',
          source: 'broadcast',
          sourceId: 'broadcast-old',
          recipient: 'old@example.com',
          critical: false,
          manual: false,
          fallback: false,
          provider: 'resend',
          sentAt: thirtyOneDaysAgo,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for emailDeliveries
        await ctx.db.insert('emailDeliveries', {
          emailId: 'new-email',
          source: 'broadcast',
          sourceId: 'broadcast-new',
          recipient: 'new@example.com',
          critical: false,
          manual: false,
          fallback: false,
          provider: 'resend',
          sentAt: oneDayAgo,
        });
      });

      await t.mutation(internal.email.email_delivery.cleanupOldDeliveries, {});

      const remaining = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveries').collect(),
      );

      expect(remaining).toHaveLength(1);
      expect(remaining[0].emailId).toBe('new-email');
    });

    it('deletes up to 500 delivery metadata records per run', async () => {
      const t = convexTest();

      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- must set sentAt to specific past timestamps to test time-based cleanup; no production path allows this
      await t.run(async (ctx) => {
        for (let i = 0; i < 502; i++) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for emailDeliveries
          await ctx.db.insert('emailDeliveries', {
            emailId: `old-email-${i}`,
            source: 'broadcast',
            sourceId: `br-${i}`,
            recipient: `r${i}@example.com`,
            critical: false,
            manual: false,
            fallback: false,
            provider: 'resend',
            sentAt: thirtyOneDaysAgo,
          });
        }
      });

      await t.mutation(internal.email.email_delivery.cleanupOldDeliveries, {});

      const remaining = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveries').collect(),
      );

      expect(remaining).toHaveLength(2);
    });
  });
});
