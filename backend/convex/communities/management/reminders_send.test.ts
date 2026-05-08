import {describe, expect, it} from 'vitest';
import {api} from '../../_generated/api';
import {createAutoDrainConvexTest} from '../../setup.testing';

// Reminder sends schedule email actions; drain scheduled callbacks after each
// test so Vitest does not report teardown-time edge-runtime console RPCs.
const convexTest = createAutoDrainConvexTest();

describe('reminders', () => {
  it('excludes globally opted-out and platform-opted-out users from the audience', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';

    try {
      const adminId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Admin',
        email: 'reminder-admin@test.com',
        isRootAdmin: true,
      });
      const platformOrganizerId = await t.mutation(
        api.testing.communities.seedOrganizer,
        {
          name: 'Braket Tickets',
          slug: 'braket-platform-marketing',
          isPlatformOrganizer: true,
          isPublicDirectory: false,
          status: 'draft',
        },
      );

      await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Included User',
        email: 'included-reminder@test.com',
      });
      const organizerOptOutUserId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Organizer Opt Out',
          email: 'organizer-optout@test.com',
        },
      );
      const globalOptOutUserId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Global Opt Out',
          email: 'global-optout@test.com',
        },
      );
      const appliedUserId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Applied User',
          email: 'applied@test.com',
        },
      );
      const noEmailUserId = await t.run(async (ctx) =>
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- createUserDirectly requires email; this case needs a user with no email
        ctx.db.insert('users', {name: 'No Email User'}),
      );

      await t.mutation(api.testing.marketing.seedMarketingPreference, {
        userId: organizerOptOutUserId,
        organizerId: platformOrganizerId,
        optedIn: false,
        unsubToken: 'platform-optout-token',
      });

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- admin users intentionally have no email so reminder audience logic does not count the acting root admin as a recipient
        await ctx.db.patch('users', adminId, {email: ''});
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- this test needs to toggle globalMarketingOptOut directly on the user row
        await ctx.db.patch('users', globalOptOutUserId, {
          globalMarketingOptOut: true,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite exists for application seeding in this test
        await ctx.db.insert('applications', {
          userId: appliedUserId,
          organizerId: platformOrganizerId,
          status: 'approved',
          answers: {},
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite exists for application seeding in this test
        await ctx.db.insert('applications', {
          userId: noEmailUserId,
          organizerId: platformOrganizerId,
          status: 'pending',
          answers: {},
        });
      });

      const asAdmin = t.withIdentity({subject: adminId});
      const audience = await asAdmin.query(
        api.communities.management.reminders.getVettingReminderAudience,
        {},
      );

      expect(audience).toEqual({
        segment: 'no_application',
        recipientCount: 1,
      });
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });

  it('creates a platform preference row for recipients when sending reminders', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';

    try {
      const adminId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Admin',
        email: 'reminder-send-admin@test.com',
        isRootAdmin: true,
      });
      const firstRecipientId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'First Recipient',
          email: 'first-reminder@test.com',
        },
      );
      const optedOutUserId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: 'Global Opt Out',
          email: 'global-optout-reminder@test.com',
        },
      );

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- admin users intentionally have no email so sendVettingReminder does not schedule a reminder for the acting root admin in this test
        await ctx.db.patch('users', adminId, {email: ''});
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- this test needs a pre-existing global opt-out on the user row
        await ctx.db.patch('users', optedOutUserId, {
          globalMarketingOptOut: true,
        });
      });

      const asAdmin = t.withIdentity({subject: adminId});
      const result = await asAdmin.mutation(
        api.communities.management.reminders.sendVettingReminder,
        {
          subject: 'Finish your application',
          message: 'Complete your vetting application before Friday.',
        },
      );

      expect(result).toEqual({
        segment: 'no_application',
        recipientCount: 1,
      });

      const {platformOrganizer, prefs, issuedTokens} = await t.run(
        async (ctx) => {
          const platformOrganizer = await ctx.db
            .query('organizers')
            .withIndex('by_isPlatformOrganizer', (query) =>
              query.eq('isPlatformOrganizer', true),
            )
            .first();

          const prefs = platformOrganizer
            ? await ctx.db
                .query('marketingEmailPreferences')
                .withIndex('by_organizer_and_user', (query) =>
                  query.eq('organizerId', platformOrganizer._id),
                )
                .collect()
            : [];

          const issuedTokens = platformOrganizer
            ? await ctx.db
                .query('marketingUnsubscribeTokens')
                .withIndex('by_user', (query) =>
                  query.eq('userId', firstRecipientId),
                )
                .collect()
            : [];

          return {platformOrganizer, prefs, issuedTokens};
        },
      );

      expect(platformOrganizer).not.toBeNull();
      expect(platformOrganizer?.name).toBe('Braket Tickets');
      expect(platformOrganizer?.slug).toBe('braket-platform-marketing');

      const prefsByUserId = new Map(prefs.map((pref) => [pref.userId, pref]));
      expect(prefsByUserId.get(firstRecipientId)?.optedIn).toBe(true);
      expect(prefsByUserId.get(firstRecipientId)?.unsubToken).toBeUndefined();
      expect(
        prefsByUserId.get(firstRecipientId)?.unsubTokenDigest,
      ).toBeTruthy();
      expect(issuedTokens).toHaveLength(1);
      expect(issuedTokens[0]?.tokenDigest).toBeTruthy();
      expect(prefsByUserId.has(optedOutUserId)).toBe(false);
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });

  it('dedup key prevents duplicate sends even with different subjects', async () => {
    const t = convexTest();
    const originalIsTest = process.env['IS_TEST'];
    process.env['IS_TEST'] = 'true';

    try {
      const adminId = await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Admin',
        email: 'dedup-admin@test.com',
        isRootAdmin: true,
      });
      await t.mutation(api.testing.users.createUserDirectly, {
        name: 'Recipient',
        email: 'dedup-recipient@test.com',
      });

      await t.run(async (ctx) => {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- admin users intentionally have no email so sendVettingReminder does not schedule a reminder for the acting root admin
        await ctx.db.patch('users', adminId, {email: ''});
      });

      const asAdmin = t.withIdentity({subject: adminId});

      const firstResult = await asAdmin.mutation(
        api.communities.management.reminders.sendVettingReminder,
        {
          subject: 'Complete your application',
          message: 'Please finish your vetting application.',
        },
      );
      expect(firstResult.recipientCount).toBe(1);

      const secondResult = await asAdmin.mutation(
        api.communities.management.reminders.sendVettingReminder,
        {
          subject: 'URGENT: Complete your application NOW',
          message: 'Different message with different subject.',
        },
      );
      expect(secondResult.recipientCount).toBe(0);
    } finally {
      if (originalIsTest === undefined) {
        delete process.env['IS_TEST'];
      } else {
        process.env['IS_TEST'] = originalIsTest;
      }
    }
  });
});
