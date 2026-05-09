import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {internal} from '../_generated/api';

describe('email_delivery', () => {
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
