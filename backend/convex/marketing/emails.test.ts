import {describe, expect, it} from 'vitest';
import {createAutoDrainConvexTest} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {addMember, addTrustLink, authz} from '../lib/authz';
import {
  isMarketingAudienceOverHardCap,
  MAX_MARKETING_AUDIENCE_USERS,
} from '../lib/marketing_emails/audience';
import {digestBearerToken, tokenPrefix} from '../lib/token_digests';

const convexTest = createAutoDrainConvexTest();
type T = ReturnType<typeof convexTest>;

const SEED_VETTING_QUESTION = {
  id: 'seed-q1',
  question: 'Why do you want to join?',
  type: 'text' as const,
  required: true,
};

async function seedOrg(t: T, name = 'Org') {
  return t.mutation(api.testing.communities.seedOrganizer, {name});
}

async function seedPublishedOrg(t: T, name: string) {
  return t.mutation(api.testing.communities.seedOrganizer, {
    name,
    status: 'published',
    vettingQuestions: [SEED_VETTING_QUESTION],
  });
}

async function seedUser(t: T, email: string) {
  return t.mutation(api.testing.users.createUserDirectly, {name: email, email});
}

async function approveUser(
  t: T,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
) {
  /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- intentionally approves user without creating a marketing preference; seedApplication(approved) auto-creates preferences which would break tests asserting "no preference row exists" */
  return t.run(async (ctx) => {
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for applications
    await ctx.db.insert('applications', {
      userId,
      organizerId,
      status: 'approved',
      answers: {},
    });
    await addMember(ctx, userId, organizerId);
  });
  /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
}

async function seedTrustLink(
  t: T,
  trustingOrganizerId: Id<'organizers'>,
  trustedOrganizerId: Id<'organizers'>,
) {
  return t.run(async (ctx) =>
    addTrustLink(ctx, trustingOrganizerId, trustedOrganizerId),
  );
}

async function seedCommunityAdmin(
  t: T,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
) {
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production mutation assigns community_admin role + membership in one step; authz.assignRole is an internal lib call with no public API equivalent
  return t.run(async (ctx) => {
    await authz.assignRole(ctx, userId, 'community_admin', {
      type: 'organizer',
      id: organizerId,
    });
    await addMember(ctx, userId, organizerId);
  });
}

async function seedMagicLinkRedemption(
  t: T,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
) {
  /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- magic_links and magic_link_redemption_log have no seed helpers; this simulates a completed magic link flow for test setup */
  return t.run(async (ctx) => {
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links
    const linkId = await ctx.db.insert('magic_links', {
      token: `tok-${Math.random()}`,
      createdBy: userId,
      organizerId,
      status: 'active',
    });
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_link_redemption_log
    await ctx.db.insert('magic_link_redemption_log', {
      magicLinkId: linkId,
      userId,
      redeemedAt: Date.now(),
    });
    await addMember(ctx, userId, organizerId);
  });
  /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
}

async function seedRootAdmin(t: T, name = 'Admin', email?: string) {
  return t.mutation(api.testing.users.createUserDirectly, {
    name,
    email: email ?? `${name.toLowerCase()}-${crypto.randomUUID()}@test.com`,
    isRootAdmin: true,
  });
}

async function seedMarketingPreference(
  t: T,
  args: {
    userId: Id<'users'>;
    organizerId: Id<'organizers'>;
    optedIn?: boolean;
    unsubToken?: string;
    updatedAt?: number;
  },
) {
  const unsubToken = args.unsubToken ?? `tok-${crypto.randomUUID()}`;
  await t.mutation(api.testing.marketing.seedMarketingPreference, {
    userId: args.userId,
    organizerId: args.organizerId,
    optedIn: args.optedIn ?? true,
    unsubToken,
  });
  return unsubToken;
}

async function seedAddressMarketingPreference(
  t: T,
  args: {
    email: string;
    organizerId: Id<'organizers'>;
    optedIn?: boolean;
    unsubToken?: string;
  },
) {
  const unsubToken = args.unsubToken ?? `addr-${crypto.randomUUID()}`;
  await t.mutation(api.testing.marketing.seedAddressMarketingPreference, {
    email: args.email,
    organizerId: args.organizerId,
    optedIn: args.optedIn ?? true,
    unsubToken,
  });
  return unsubToken;
}

describe('marketing_emails.getRecipientCount', () => {
  it('counts directly approved users', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, 'direct@test.com');
    await approveUser(t, userId, orgId);
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgId,
      optedIn: true,
      unsubToken: 'tok1',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });

    const adminId = await seedUser(t, 'admin@test.com');
    await seedCommunityAdmin(t, adminId, orgId);
    const result = await t
      .withIdentity({subject: adminId})
      .query(api.marketing.emails.getRecipientCount, {eventId});

    expect(result.count).toBe(1);
    expect(result.cappedAt500).toBe(false);
  });

  it('deduplicates users appearing in multiple approval paths', async () => {
    const t = convexTest();
    const org1 = await seedOrg(t, 'Org1');
    const org2 = await seedOrg(t, 'Org2');
    const userId = await seedUser(t, 'dup@test.com');

    await approveUser(t, userId, org1);
    await approveUser(t, userId, org2);
    await seedTrustLink(t, org1, org2);

    await seedMarketingPreference(t, {
      userId,
      organizerId: org1,
      optedIn: true,
      unsubToken: 'tok2',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'draft',
      visibility: 'public',
      organizerId: org1,
    });

    const adminId = await seedUser(t, 'admin@test.com');
    await seedCommunityAdmin(t, adminId, org1);
    const result = await t
      .withIdentity({subject: adminId})
      .query(api.marketing.emails.getRecipientCount, {eventId});

    expect(result.count).toBe(1); // deduplicated
  });

  it('deduplicates vetted users sharing the same email address', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t, 'Shared Inbox Org');
    const sharedEmail = `shared-${crypto.randomUUID()}@test.com`;
    const userA = await seedUser(t, sharedEmail);
    const userB = await seedUser(t, sharedEmail);

    await approveUser(t, userA, orgId);
    await approveUser(t, userB, orgId);
    await seedMarketingPreference(t, {userId: userA, organizerId: orgId});
    await seedMarketingPreference(t, {userId: userB, organizerId: orgId});

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Shared Inbox Test',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });

    const adminId = await seedUser(t, `admin-${crypto.randomUUID()}@test.com`);
    await seedCommunityAdmin(t, adminId, orgId);
    const result = await t
      .withIdentity({subject: adminId})
      .query(api.marketing.emails.getRecipientCount, {eventId});

    expect(result.count).toBe(1);
  });

  it('excludes opted-out users', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, 'optout@test.com');
    await approveUser(t, userId, orgId);
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgId,
      optedIn: false,
      unsubToken: 'tok3',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });

    const adminId = await seedUser(t, 'admin@test.com');
    await seedCommunityAdmin(t, adminId, orgId);
    const result = await t
      .withIdentity({subject: adminId})
      .query(api.marketing.emails.getRecipientCount, {eventId});

    expect(result.count).toBe(0);
  });

  it('counts magic-link-vetted users', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, 'magiclink@test.com');
    await seedMagicLinkRedemption(t, userId, orgId);
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgId,
      optedIn: true,
      unsubToken: 'tok4',
    });

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });

    const adminId = await seedUser(t, 'admin@test.com');
    await seedCommunityAdmin(t, adminId, orgId);
    const result = await t
      .withIdentity({subject: adminId})
      .query(api.marketing.emails.getRecipientCount, {eventId});

    expect(result.count).toBe(1);
  });

  it(
    'returns full audience count when recipients exceed 500',
    {timeout: 120_000},
    async () => {
      const t = convexTest();
      const orgId = await seedOrg(t);
      const adminId = await seedUser(t, 'admin-large-audience@test.com');
      await seedCommunityAdmin(t, adminId, orgId);

      const eventId = await t.mutation(api.testing.events.seedEvent, {
        title: 'Large Audience Test',
        date: '2026-12-01',
        price: 0,
        totalTickets: 100,
        status: 'draft',
        visibility: 'public',
        organizerId: orgId,
      });

      const recipientCount = 550;
      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- bulk load: no production path for creating 550 users/applications/preferences in one transaction; individual mutation calls would exceed Convex limits and miss the batch-threshold boundary being tested */
      await t.run(async (ctx) => {
        for (let index = 0; index < recipientCount; index += 1) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for users
          const userId = await ctx.db.insert('users', {
            name: `large-audience-${index}`,
            email: `large-audience-${index}@test.com`,
          });
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for applications
          await ctx.db.insert('applications', {
            userId,
            organizerId: orgId,
            status: 'approved',
            answers: {},
          });
          await addMember(ctx, userId, orgId);
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for marketingEmailPreferences
          await ctx.db.insert('marketingEmailPreferences', {
            userId,
            organizerId: orgId,
            optedIn: true,
            unsubToken: `audience-token-${index}-${crypto.randomUUID()}`,
            updatedAt: Date.now(),
          });
        }
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      const result = await t
        .withIdentity({subject: adminId})
        .query(api.marketing.emails.getRecipientCount, {eventId});

      expect(result.count).toBe(recipientCount);
      expect(result.cappedAt500).toBe(false);
    },
  );
});

// ── scheduleAnnouncement ────────────────────────────────────────────

describe('marketing_emails.scheduleAnnouncement', () => {
  async function setupEventWithAdmin(t: T) {
    const orgId = await seedOrg(t);
    const adminId = await seedUser(t, `admin-${crypto.randomUUID()}@test.com`);
    await seedCommunityAdmin(t, adminId, orgId);
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test Event',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });
    return {
      orgId,
      adminId,
      eventId,
      asAdmin: t.withIdentity({subject: adminId}),
    };
  }

  it('creates a scheduled record with future scheduledFor', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await setupEventWithAdmin(t);
    const scheduledFor = Date.now() + 2 * 60 * 1000;

    await asAdmin.mutation(api.marketing.emails.scheduleAnnouncement, {
      eventId,
      scheduledFor,
    });

    const record = await t.run((ctx) =>
      ctx.db
        .query('eventMarketingEmails')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );
    expect(record?.status).toBe('scheduled');
    expect(record?.scheduledFor).toBe(scheduledFor);
    expect(record?.totalOpenCount).toBe(0);
    expect(record?.uniqueOpenCount).toBe(0);
    expect(record?.totalClickCount).toBe(0);
    expect(record?.uniqueClickCount).toBe(0);
  });

  it('rejects scheduledFor less than 60 seconds away', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await setupEventWithAdmin(t);

    await expect(
      asAdmin.mutation(api.marketing.emails.scheduleAnnouncement, {
        eventId,
        scheduledFor: Date.now() + 30_000,
      }),
    ).rejects.toThrow();
  });

  it('rejects scheduledFor more than 90 days away', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await setupEventWithAdmin(t);

    await expect(
      asAdmin.mutation(api.marketing.emails.scheduleAnnouncement, {
        eventId,
        scheduledFor: Date.now() + 91 * 24 * 60 * 60 * 1000,
      }),
    ).rejects.toThrow();
  });

  it('cancels existing scheduled record before creating new one', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await setupEventWithAdmin(t);
    const first = Date.now() + 2 * 60 * 1000;
    const second = Date.now() + 3 * 60 * 1000;

    await asAdmin.mutation(api.marketing.emails.scheduleAnnouncement, {
      eventId,
      scheduledFor: first,
    });
    await asAdmin.mutation(api.marketing.emails.scheduleAnnouncement, {
      eventId,
      scheduledFor: second,
    });

    const records = await t.run((ctx) =>
      ctx.db
        .query('eventMarketingEmails')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    const scheduled = records.filter((r) => r.status === 'scheduled');
    const cancelled = records.filter((r) => r.status === 'cancelled');
    expect(scheduled).toHaveLength(1);
    expect(cancelled).toHaveLength(1);
    expect(scheduled[0].scheduledFor).toBe(second);
  });
});

describe('marketing_emails.cancelAnnouncement', () => {
  it('flips status to cancelled', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t);
    const adminId = await seedUser(t, `admin-${crypto.randomUUID()}@test.com`);
    await seedCommunityAdmin(t, adminId, orgId);
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'T',
      date: '2026-12-01',
      price: 0,
      totalTickets: 10,
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    await asAdmin.mutation(api.marketing.emails.scheduleAnnouncement, {
      eventId,
      scheduledFor: Date.now() + 2 * 60 * 1000,
    });

    const record = await t.run((ctx) =>
      ctx.db
        .query('eventMarketingEmails')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );

    await asAdmin.mutation(api.marketing.emails.cancelAnnouncement, {
      eventMarketingEmailId: record!._id,
    });

    const updated = await t.run((ctx) =>
      ctx.db.get('eventMarketingEmails', record!._id),
    );
    expect(updated?.status).toBe('cancelled');
  });

  it('throws if record is already sent', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t);
    const adminId = await seedUser(t, `admin2-${crypto.randomUUID()}@test.com`);
    await seedCommunityAdmin(t, adminId, orgId);
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'T',
      date: '2026-12-01',
      price: 0,
      totalTickets: 10,
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- eventMarketingEmails has no seed helper; pre-seeding a 'sent' record is the only way to test the cancellation guard
    const recordId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for eventMarketingEmails
      return ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() - 1000,
        status: 'sent',
        recipientCount: 5,
        sentAt: Date.now() - 500,
      });
    });

    await expect(
      t
        .withIdentity({subject: adminId})
        .mutation(api.marketing.emails.cancelAnnouncement, {
          eventMarketingEmailId: recordId,
        }),
    ).rejects.toThrow();
  });
});

// ── sendAnnouncement ────────────────────────────────────────────────

describe('marketing_emails.sendAnnouncement', () => {
  async function setupScheduledRecord(t: T) {
    const orgId = await seedOrg(t, `Org-${crypto.randomUUID()}`);
    const adminId = await seedUser(t, `admin-${crypto.randomUUID()}@test.com`);
    await seedCommunityAdmin(t, adminId, orgId);
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test Event',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- eventMarketingEmails has no seed helper; a pre-scheduled record is required to test sendAnnouncement
    const recordId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for eventMarketingEmails
      ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() - 1000,
        status: 'scheduled',
      }),
    );
    return {orgId, adminId, eventId, recordId};
  }

  it('no-ops when record status is cancelled', async () => {
    const t = convexTest();
    const {adminId, eventId} = await setupScheduledRecord(t);
    // Seed a record pre-cancelled
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- eventMarketingEmails has no seed helper; pre-seeding a 'cancelled' record is required to test the no-op guard in sendAnnouncement
    const recordId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for eventMarketingEmails
      ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() - 1000,
        status: 'cancelled',
      }),
    );

    // Call sendAnnouncement directly — should no-op, not throw
    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.sendAnnouncement, {
        eventMarketingEmailId: recordId,
      });
    });

    const record = await t.run((ctx) =>
      ctx.db.get('eventMarketingEmails', recordId),
    );
    // Status must remain 'cancelled' — sendAnnouncement must not flip it to 'sent'
    expect(record?.status).toBe('cancelled');
    expect(record?.recipientCount).toBeUndefined();
  });

  it('marks record sent and sets recipientCount when status is scheduled', async () => {
    const t = convexTest();
    const {orgId, recordId} = await setupScheduledRecord(t);

    // Seed an opted-in vetted user so recipientCount >= 0
    const userId = await seedUser(
      t,
      `recipient-${crypto.randomUUID()}@test.com`,
    );
    await approveUser(t, userId, orgId);
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgId,
      optedIn: true,
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.sendAnnouncement, {
        eventMarketingEmailId: recordId,
      });
    });

    const record = await t.run((ctx) =>
      ctx.db.get('eventMarketingEmails', recordId),
    );
    expect(record?.status).toBe('sent');
    expect(typeof record?.recipientCount).toBe('number');
    expect(record!.recipientCount!).toBeGreaterThanOrEqual(0);
    expect(record?.sentAt).toBeDefined();
    expect(record?.totalOpenCount).toBe(0);
    expect(record?.uniqueOpenCount).toBe(0);
    expect(record?.totalClickCount).toBe(0);
    expect(record?.uniqueClickCount).toBe(0);
  });

  it(
    'schedules announcement fan-out in batches beyond 500 recipients',
    {timeout: 120_000},
    async () => {
      const t = convexTest();
      const {orgId, recordId} = await setupScheduledRecord(t);
      const recipientCount = 550;

      /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- bulk load: no production path for creating 550 users/applications/preferences in one transaction; individual mutation calls would exceed Convex limits and miss the batch-threshold boundary being tested */
      await t.run(async (ctx) => {
        for (let index = 0; index < recipientCount; index += 1) {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for users
          const userId = await ctx.db.insert('users', {
            name: `batched-recipient-${index}`,
            email: `batched-recipient-${index}@test.com`,
          });
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for applications
          await ctx.db.insert('applications', {
            userId,
            organizerId: orgId,
            status: 'approved',
            answers: {},
          });
          await addMember(ctx, userId, orgId);
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for marketingEmailPreferences
          await ctx.db.insert('marketingEmailPreferences', {
            userId,
            organizerId: orgId,
            optedIn: true,
            unsubToken: `batch-token-${index}-${crypto.randomUUID()}`,
            updatedAt: Date.now(),
          });
        }
      });
      /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

      await t.run(async (ctx) => {
        await ctx.runMutation(internal.marketing.emails.sendAnnouncement, {
          eventMarketingEmailId: recordId,
        });
      });

      const record = await t.run((ctx) =>
        ctx.db.get('eventMarketingEmails', recordId),
      );
      expect(record?.status).toBe('sent');
      expect(record?.recipientCount).toBe(recipientCount);

      const scheduledFunctions = await t.run((ctx) =>
        ctx.db.system.query('_scheduled_functions').collect(),
      );
      const batchJobs = scheduledFunctions.filter((job) =>
        JSON.stringify(job).includes('sendAnnouncementBatch'),
      );
      expect(batchJobs).toHaveLength(Math.ceil(recipientCount / 100));

      const serializedBatchJobs = JSON.stringify(batchJobs);
      expect(serializedBatchJobs).toContain(
        `batched-recipient-${recipientCount - 1}@test.com`,
      );
      expect(serializedBatchJobs).toContain('marketingPreference');
    },
  );

  it('sends one scheduled announcement per shared inbox address', async () => {
    const t = convexTest();
    const {orgId, recordId} = await setupScheduledRecord(t);
    const sharedEmail = `shared-inbox-${crypto.randomUUID()}@test.com`;
    const userA = await seedUser(t, sharedEmail);
    const userB = await seedUser(t, sharedEmail);

    await approveUser(t, userA, orgId);
    await approveUser(t, userB, orgId);
    await seedMarketingPreference(t, {userId: userA, organizerId: orgId});
    await seedMarketingPreference(t, {userId: userB, organizerId: orgId});

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.sendAnnouncement, {
        eventMarketingEmailId: recordId,
      });
    });

    const record = await t.run((ctx) =>
      ctx.db.get('eventMarketingEmails', recordId),
    );
    expect(record?.status).toBe('sent');
    expect(record?.recipientCount).toBe(1);

    const scheduledFunctions = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const batchJobs = scheduledFunctions.filter((job) =>
      JSON.stringify(job).includes('sendAnnouncementBatch'),
    );
    expect(batchJobs).toHaveLength(1);

    const sharedEmailOccurrences =
      JSON.stringify(batchJobs).match(new RegExp(sharedEmail, 'g')) ?? [];
    expect(sharedEmailOccurrences).toHaveLength(1);
  });
});

describe('marketing email tracking', () => {
  it('records opens and clicks against a delivery row and parent aggregate counters', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t, `Org-${crypto.randomUUID()}`);
    const userId = await seedUser(
      t,
      `recipient-${crypto.randomUUID()}@test.com`,
    );
    const adminId = await seedUser(t, `admin-${crypto.randomUUID()}@test.com`);
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Tracked Event',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- eventMarketingEmails has no seed helper; a pre-sent record is required to seed delivery tracking rows
    const recordId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for eventMarketingEmails
      ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() - 1000,
        status: 'sent',
        recipientCount: 1,
        sentAt: Date.now() - 1000,
      }),
    );

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- marketingEmailDeliveries has no seed helper; direct insert is the only way to set up tracking state for open/click tests
    await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for marketingEmailDeliveries
      ctx.db.insert('marketingEmailDeliveries', {
        eventMarketingEmailId: recordId,
        eventId,
        organizerId: orgId,
        userId,
        recipient: 'tracked@example.com',
        targetUrl: 'https://braket.gay/events/tracked-event',
        openToken: 'open-token',
        clickToken: 'click-token',
        sentAt: Date.now() - 1000,
        openCount: 0,
        clickCount: 0,
      }),
    );

    const redirectTarget = await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.recordDeliveryOpen, {
        token: 'open-token',
      });
      await ctx.runMutation(internal.marketing.emails.recordDeliveryOpen, {
        token: 'open-token',
      });
      await ctx.runMutation(internal.marketing.emails.recordDeliveryClick, {
        token: 'click-token',
      });
      return ctx.runMutation(internal.marketing.emails.recordDeliveryClick, {
        token: 'click-token',
      });
    });

    expect(redirectTarget).toBe('https://braket.gay/events/tracked-event');

    const delivery = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailDeliveries')
        .withIndex('by_eventMarketingEmail', (query) =>
          query.eq('eventMarketingEmailId', recordId),
        )
        .first(),
    );

    expect(delivery?.openCount).toBe(2);
    expect(delivery?.clickCount).toBe(2);
    expect(delivery?.openToken).toBeUndefined();
    expect(delivery?.clickToken).toBeUndefined();
    expect(delivery?.openTokenDigest).toBeTruthy();
    expect(delivery?.clickTokenDigest).toBeTruthy();
    expect(delivery?.openedAt).toBeDefined();
    expect(delivery?.clickedAt).toBeDefined();

    const emailRecord = await t.run((ctx) =>
      ctx.db.get('eventMarketingEmails', recordId),
    );
    expect(emailRecord?.totalOpenCount).toBe(2);
    expect(emailRecord?.uniqueOpenCount).toBe(1);
    expect(emailRecord?.totalClickCount).toBe(2);
    expect(emailRecord?.uniqueClickCount).toBe(1);
  });
});

describe('marketing_emails.updateMarketingPreference', () => {
  it('creates new preference row when none exists', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, `pref-${crypto.randomUUID()}@test.com`);

    await t
      .withIdentity({subject: userId})
      .mutation(api.marketing.emails.updateMarketingPreference, {
        organizerId: orgId,
        optedIn: false,
      });

    const pref = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', userId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(pref?.optedIn).toBe(false);
    expect(pref?.unsubToken).toBeUndefined();
    expect(typeof pref?.unsubTokenDigest).toBe('string');
  });

  it('patches existing preference row without storing a plaintext token', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, `pref2-${crypto.randomUUID()}@test.com`);

    await seedMarketingPreference(t, {
      userId,
      organizerId: orgId,
      optedIn: true,
      unsubToken: 'existing-tok',
    });

    await t
      .withIdentity({subject: userId})
      .mutation(api.marketing.emails.updateMarketingPreference, {
        organizerId: orgId,
        optedIn: false,
      });

    const pref = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', userId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(pref?.optedIn).toBe(false);
    expect(pref?.unsubToken).toBeUndefined();
    expect(pref?.unsubTokenDigest).toBe(
      await digestBearerToken('marketing_unsubscribe_user', 'existing-tok'),
    );
    expect(pref?.unsubTokenPrefix).toBe(tokenPrefix('existing-tok'));
  });

  it('throws when admin tries to opt out of their own community', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t);
    const adminId = await seedUser(
      t,
      `admin-optout-${crypto.randomUUID()}@test.com`,
    );
    await seedCommunityAdmin(t, adminId, orgId);
    await seedMarketingPreference(t, {
      userId: adminId,
      organizerId: orgId,
      optedIn: true,
    });

    await expect(
      t
        .withIdentity({subject: adminId})
        .mutation(api.marketing.emails.updateMarketingPreference, {
          organizerId: orgId,
          optedIn: false,
        }),
    ).rejects.toThrow(/admin/i);
  });

  it('allows admin to opt out of a community they do NOT admin', async () => {
    const t = convexTest();
    const adminOrgId = await seedOrg(t, `AdminOrg-${crypto.randomUUID()}`);
    const otherOrgId = await seedOrg(t, `OtherOrg-${crypto.randomUUID()}`);
    const adminId = await seedUser(
      t,
      `admin-other-${crypto.randomUUID()}@test.com`,
    );
    await seedCommunityAdmin(t, adminId, adminOrgId);
    await seedMarketingPreference(t, {
      userId: adminId,
      organizerId: otherOrgId,
      optedIn: true,
    });

    await t
      .withIdentity({subject: adminId})
      .mutation(api.marketing.emails.updateMarketingPreference, {
        organizerId: otherOrgId,
        optedIn: false,
      });

    const pref = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', adminId).eq('organizerId', otherOrgId),
        )
        .first(),
    );
    expect(pref?.optedIn).toBe(false);
  });
});

describe('marketing_emails.unsubscribeAll', () => {
  it('flips all preferences to false for authenticated user', async () => {
    const t = convexTest();
    const org1 = await seedOrg(t, `A-${crypto.randomUUID()}`);
    const org2 = await seedOrg(t, `B-${crypto.randomUUID()}`);
    const userId = await seedUser(t, `unsub-${crypto.randomUUID()}@test.com`);

    await seedMarketingPreference(t, {
      userId,
      organizerId: org1,
      optedIn: true,
      unsubToken: 't1',
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: org2,
      optedIn: true,
      unsubToken: 't2',
    });

    await t
      .withIdentity({subject: userId})
      .mutation(api.marketing.emails.unsubscribeAll, {});

    const prefs = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
    );
    expect(prefs.every((p) => p.optedIn === false)).toBe(true);
  });

  it('skips admin communities when unsubscribing from all', async () => {
    const t = convexTest();
    const adminOrg = await seedOrg(t, `AdminOrg-${crypto.randomUUID()}`);
    const regularOrg = await seedOrg(t, `RegularOrg-${crypto.randomUUID()}`);
    const userId = await seedUser(
      t,
      `admin-unsub-${crypto.randomUUID()}@test.com`,
    );
    await seedCommunityAdmin(t, userId, adminOrg);

    await seedMarketingPreference(t, {
      userId,
      organizerId: adminOrg,
      optedIn: true,
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: regularOrg,
      optedIn: true,
    });

    await t
      .withIdentity({subject: userId})
      .mutation(api.marketing.emails.unsubscribeAll, {});

    const [adminPref, regularPref] = await t.run((ctx) =>
      Promise.all([
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', userId).eq('organizerId', adminOrg),
          )
          .first(),
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', userId).eq('organizerId', regularOrg),
          )
          .first(),
      ]),
    );

    // Admin community preference stays opted in
    expect(adminPref?.optedIn).toBe(true);
    // Regular community preference is unsubscribed
    expect(regularPref?.optedIn).toBe(false);
  });
});

describe('marketing_emails.getUserPreferences', () => {
  it('returns organizer-enriched preferences for the authenticated user', async () => {
    const t = convexTest();
    const userId = await seedUser(t, `prefs-${crypto.randomUUID()}@test.com`);
    const orgA = await seedOrg(t, `OrgA-${crypto.randomUUID()}`);
    const orgB = await seedOrg(t, `OrgB-${crypto.randomUUID()}`);
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgA,
      optedIn: true,
      unsubToken: 'pref-token-a',
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgB,
      optedIn: false,
      unsubToken: 'pref-token-b',
    });

    const result = await t
      .withIdentity({subject: userId})
      .query(api.marketing.emails.getUserPreferences, {});

    expect(result).toEqual(
      expect.arrayContaining([
        {
          organizerId: orgA,
          organizerName: expect.stringContaining('OrgA-'),
          optedIn: true,
          isAdmin: false,
        },
        {
          organizerId: orgB,
          organizerName: expect.stringContaining('OrgB-'),
          optedIn: false,
          isAdmin: false,
        },
      ]),
    );
  });

  it('returns isAdmin: true for communities where user is admin', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `admin-prefs-${crypto.randomUUID()}@test.com`,
    );
    const adminOrg = await seedOrg(t, `AdminOrg-${crypto.randomUUID()}`);
    const regularOrg = await seedOrg(t, `RegularOrg-${crypto.randomUUID()}`);

    await seedCommunityAdmin(t, userId, adminOrg);
    await seedMarketingPreference(t, {
      userId,
      organizerId: adminOrg,
      optedIn: true,
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: regularOrg,
      optedIn: true,
    });

    const result = await t
      .withIdentity({subject: userId})
      .query(api.marketing.emails.getUserPreferences, {});

    const adminPref = result.find((p) => p.organizerId === adminOrg);
    const regularPref = result.find((p) => p.organizerId === regularOrg);
    expect(adminPref?.isAdmin).toBe(true);
    expect(regularPref?.isAdmin).toBe(false);
  });
});

describe('marketing_emails.token flows', () => {
  it('unsubscribeByToken flips only the targeted organizer preference', async () => {
    const t = convexTest();
    const userId = await seedUser(t, `token-${crypto.randomUUID()}@test.com`);
    const orgA = await seedOrg(t, `OrgA-${crypto.randomUUID()}`);
    const orgB = await seedOrg(t, `OrgB-${crypto.randomUUID()}`);
    const tokenA = await seedMarketingPreference(t, {
      userId,
      organizerId: orgA,
      optedIn: true,
      unsubToken: 'target-token',
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgB,
      optedIn: true,
      unsubToken: 'other-token',
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.unsubscribeByToken, {
        token: tokenA,
      });
    });

    const [prefA, prefB] = await t.run((ctx) =>
      Promise.all([
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', userId).eq('organizerId', orgA),
          )
          .first(),
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', userId).eq('organizerId', orgB),
          )
          .first(),
      ]),
    );

    expect(prefA?.optedIn).toBe(false);
    expect(prefB?.optedIn).toBe(true);
  });

  it('getPreferencesByToken does not return sibling unsubscribe tokens', async () => {
    const t = convexTest();
    const userId = await seedUser(t, `manage-${crypto.randomUUID()}@test.com`);
    const orgA = await seedOrg(t, `OrgA-${crypto.randomUUID()}`);
    const orgB = await seedOrg(t, `OrgB-${crypto.randomUUID()}`);
    const tokenA = await seedMarketingPreference(t, {
      userId,
      organizerId: orgA,
      optedIn: false,
      unsubToken: 'manage-token-a',
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgB,
      optedIn: true,
      unsubToken: 'manage-token-b',
    });

    const result = await t.run((ctx) =>
      ctx.runQuery(internal.marketing.emails.getPreferencesByToken, {
        token: tokenA,
      }),
    );

    expect(result).toEqual({
      unsubscribedFrom: {
        organizerName: expect.stringContaining('OrgA-'),
        organizerId: orgA,
      },
      globalMarketingOptOut: false,
      preferences: expect.arrayContaining([
        {
          organizerName: expect.stringContaining('OrgA-'),
          organizerId: orgA,
          optedIn: false,
          isAdmin: false,
        },
        {
          organizerName: expect.stringContaining('OrgB-'),
          organizerId: orgB,
          optedIn: true,
          isAdmin: false,
        },
      ]),
    });
  });

  it('getPreferencesByToken marks admin communities', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `token-admin-prefs-${crypto.randomUUID()}@test.com`,
    );
    const adminOrg = await seedOrg(t, `AdminOrg-${crypto.randomUUID()}`);
    const regularOrg = await seedOrg(t, `RegularOrg-${crypto.randomUUID()}`);
    await seedCommunityAdmin(t, userId, adminOrg);
    const token = await seedMarketingPreference(t, {
      userId,
      organizerId: adminOrg,
      optedIn: true,
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: regularOrg,
      optedIn: true,
    });

    const result = await t.run((ctx) =>
      ctx.runQuery(internal.marketing.emails.getPreferencesByToken, {token}),
    );

    expect(result?.preferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({organizerId: adminOrg, isAdmin: true}),
        expect.objectContaining({organizerId: regularOrg, isAdmin: false}),
      ]),
    );
  });

  it('getPreferencesByToken supports address-scoped preferences for guest-only inboxes', async () => {
    const t = convexTest();
    const orgA = await seedOrg(t, `OrgA-${crypto.randomUUID()}`);
    const orgB = await seedOrg(t, `OrgB-${crypto.randomUUID()}`);
    const sharedEmail = `guest-shared-${crypto.randomUUID()}@test.com`;
    const tokenA = await seedAddressMarketingPreference(t, {
      email: sharedEmail,
      organizerId: orgA,
      optedIn: false,
      unsubToken: 'guest-manage-token-a',
    });
    await seedAddressMarketingPreference(t, {
      email: sharedEmail,
      organizerId: orgB,
      optedIn: true,
      unsubToken: 'guest-manage-token-b',
    });

    const result = await t.run((ctx) =>
      ctx.runQuery(internal.marketing.emails.getPreferencesByToken, {
        token: tokenA,
      }),
    );

    expect(result).toEqual({
      unsubscribedFrom: {
        organizerName: expect.stringContaining('OrgA-'),
        organizerId: orgA,
      },
      globalMarketingOptOut: false,
      preferences: expect.arrayContaining([
        {
          organizerName: expect.stringContaining('OrgA-'),
          organizerId: orgA,
          optedIn: false,
          isAdmin: false,
        },
        {
          organizerName: expect.stringContaining('OrgB-'),
          organizerId: orgB,
          optedIn: true,
          isAdmin: false,
        },
      ]),
    });
  });

  it('toggleByToken updates the targeted preference', async () => {
    const t = convexTest();
    const userId = await seedUser(t, `toggle-${crypto.randomUUID()}@test.com`);
    const orgId = await seedOrg(t, `Org-${crypto.randomUUID()}`);
    const token = await seedMarketingPreference(t, {
      userId,
      organizerId: orgId,
      optedIn: false,
      unsubToken: 'toggle-token',
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.toggleByToken, {
        token,
        optedIn: true,
      });
    });

    const updated = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', userId).eq('organizerId', orgId),
        )
        .first(),
    );

    expect(updated?.optedIn).toBe(true);
  });

  it('toggleByToken blocks admins from opting out of their own community with organizer scope', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `token-admin-toggle-${crypto.randomUUID()}@test.com`,
    );
    const orgId = await seedOrg(t, `AdminOrg-${crypto.randomUUID()}`);
    const token = await seedMarketingPreference(t, {
      userId,
      organizerId: orgId,
      optedIn: true,
    });
    await seedCommunityAdmin(t, userId, orgId);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.marketing.emails.toggleByToken, {
          token,
          organizerId: orgId,
          optedIn: false,
        }),
      ),
    ).rejects.toThrow(/admin/i);

    const unchanged = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', userId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(unchanged?.optedIn).toBe(true);
  });

  it('toggleByToken blocks admins from opting out through the token-owned preference', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `token-admin-direct-${crypto.randomUUID()}@test.com`,
    );
    const orgId = await seedOrg(t, `AdminOrg-${crypto.randomUUID()}`);
    const token = await seedMarketingPreference(t, {
      userId,
      organizerId: orgId,
      optedIn: true,
    });
    await seedCommunityAdmin(t, userId, orgId);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.marketing.emails.toggleByToken, {
          token,
          optedIn: false,
        }),
      ),
    ).rejects.toThrow(/admin/i);
  });

  it('unsubscribeByToken blocks admins from opting out of their own community', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `token-admin-one-click-${crypto.randomUUID()}@test.com`,
    );
    const orgId = await seedOrg(t, `AdminOrg-${crypto.randomUUID()}`);
    const token = await seedMarketingPreference(t, {
      userId,
      organizerId: orgId,
      optedIn: true,
    });
    await seedCommunityAdmin(t, userId, orgId);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.marketing.emails.unsubscribeByToken, {
          token,
        }),
      ),
    ).rejects.toThrow(/admin/i);
  });

  it('unsubscribeAllByToken flips all preferences for the token owner', async () => {
    const t = convexTest();
    const userId = await seedUser(t, `all-${crypto.randomUUID()}@test.com`);
    const otherUserId = await seedUser(
      t,
      `other-${crypto.randomUUID()}@test.com`,
    );
    const orgA = await seedOrg(t, `OrgA-${crypto.randomUUID()}`);
    const orgB = await seedOrg(t, `OrgB-${crypto.randomUUID()}`);
    const token = await seedMarketingPreference(t, {
      userId,
      organizerId: orgA,
      optedIn: true,
      unsubToken: 'unsubscribe-all-token',
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgB,
      optedIn: true,
      unsubToken: 'unsubscribe-all-token-b',
    });
    await seedMarketingPreference(t, {
      userId: otherUserId,
      organizerId: orgA,
      optedIn: true,
      unsubToken: 'untouched-token',
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.unsubscribeAllByToken, {
        token,
      });
    });

    const [userPrefs, otherPref] = await t.run((ctx) =>
      Promise.all([
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user', (q) => q.eq('userId', userId))
          .collect(),
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', otherUserId).eq('organizerId', orgA),
          )
          .first(),
      ]),
    );

    expect(userPrefs.every((pref) => pref.optedIn === false)).toBe(true);
    expect(otherPref?.optedIn).toBe(true);
  });

  it('unsubscribeAllByToken skips admin communities for the token owner', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `all-token-admin-${crypto.randomUUID()}@test.com`,
    );
    const adminOrg = await seedOrg(t, `AdminOrg-${crypto.randomUUID()}`);
    const regularOrg = await seedOrg(t, `RegularOrg-${crypto.randomUUID()}`);
    await seedCommunityAdmin(t, userId, adminOrg);
    const token = await seedMarketingPreference(t, {
      userId,
      organizerId: adminOrg,
      optedIn: true,
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: regularOrg,
      optedIn: true,
    });

    await t.run((ctx) =>
      ctx.runMutation(internal.marketing.emails.unsubscribeAllByToken, {
        token,
      }),
    );

    const [adminPref, regularPref, user] = await t.run((ctx) =>
      Promise.all([
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', userId).eq('organizerId', adminOrg),
          )
          .first(),
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', userId).eq('organizerId', regularOrg),
          )
          .first(),
        ctx.db.get(userId),
      ]),
    );

    expect(adminPref?.optedIn).toBe(true);
    expect(regularPref?.optedIn).toBe(false);
    expect(user?.globalMarketingOptOut).toBe(true);
  });

  it('unsubscribeAllByToken flips all address-scoped preferences for the same inbox', async () => {
    const t = convexTest();
    const orgA = await seedOrg(t, `OrgA-${crypto.randomUUID()}`);
    const orgB = await seedOrg(t, `OrgB-${crypto.randomUUID()}`);
    const sharedEmail = `guest-all-${crypto.randomUUID()}@test.com`;
    const token = await seedAddressMarketingPreference(t, {
      email: sharedEmail,
      organizerId: orgA,
      optedIn: true,
      unsubToken: 'guest-unsubscribe-all-a',
    });
    await seedAddressMarketingPreference(t, {
      email: sharedEmail,
      organizerId: orgB,
      optedIn: true,
      unsubToken: 'guest-unsubscribe-all-b',
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.unsubscribeAllByToken, {
        token,
      });
    });

    const prefs = await t.run((ctx) =>
      ctx.db
        .query('emailAddressMarketingPreferences')
        .withIndex('by_email', (q) => q.eq('email', sharedEmail))
        .collect(),
    );

    expect(prefs.every((pref) => pref.optedIn === false)).toBe(true);
  });
});

// ── globalMarketingOptOut ───────────────────────────────────────────

describe('marketing_emails.globalMarketingOptOut', () => {
  it('unsubscribeAllForUser sets globalMarketingOptOut: true on user record', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `optout-internal-${crypto.randomUUID()}@test.com`,
    );
    const orgA = await seedOrg(t, `OA-${crypto.randomUUID()}`);
    const orgB = await seedOrg(t, `OB-${crypto.randomUUID()}`);
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgA,
      optedIn: true,
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgB,
      optedIn: true,
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.unsubscribeAllForUser, {
        userId,
      });
    });

    const user = await t.run((ctx) => ctx.db.get('users', userId));
    expect(user?.globalMarketingOptOut).toBe(true);

    const prefs = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
    );
    expect(prefs.every((p) => p.optedIn === false)).toBe(true);
  });

  it('unsubscribeAll (authenticated) sets globalMarketingOptOut: true on user record', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `optout-auth-${crypto.randomUUID()}@test.com`,
    );
    const orgA = await seedOrg(t, `OA-${crypto.randomUUID()}`);
    const orgB = await seedOrg(t, `OB-${crypto.randomUUID()}`);
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgA,
      optedIn: true,
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgB,
      optedIn: true,
    });

    await t
      .withIdentity({subject: userId})
      .mutation(api.marketing.emails.unsubscribeAll, {});

    const user = await t.run((ctx) => ctx.db.get('users', userId));
    expect(user?.globalMarketingOptOut).toBe(true);

    const prefs = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
    );
    expect(prefs.every((p) => p.optedIn === false)).toBe(true);
  });

  it('reEnableAll transactionally clears global opt-out and flips user preferences on', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `reenable-auth-${crypto.randomUUID()}@test.com`,
    );
    const otherUserId = await seedUser(
      t,
      `reenable-other-${crypto.randomUUID()}@test.com`,
    );
    const orgA = await seedOrg(t, `RA-${crypto.randomUUID()}`);
    const orgB = await seedOrg(t, `RB-${crypto.randomUUID()}`);
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgA,
      optedIn: false,
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgB,
      optedIn: true,
    });
    await seedMarketingPreference(t, {
      userId: otherUserId,
      organizerId: orgA,
      optedIn: false,
    });
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no narrower production mutation sets up this pre-existing global opt-out state
    await t.run((ctx) =>
      ctx.db.patch('users', userId, {globalMarketingOptOut: true}),
    );

    await t
      .withIdentity({subject: userId})
      .mutation(api.marketing.emails.reEnableAll, {});

    const [user, userPrefs, otherPref] = await t.run((ctx) =>
      Promise.all([
        ctx.db.get('users', userId),
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user', (q) => q.eq('userId', userId))
          .collect(),
        ctx.db
          .query('marketingEmailPreferences')
          .withIndex('by_user_and_organizer', (q) =>
            q.eq('userId', otherUserId).eq('organizerId', orgA),
          )
          .first(),
      ]),
    );

    expect(user?.globalMarketingOptOut).toBe(false);
    expect(userPrefs.every((pref) => pref.optedIn)).toBe(true);
    expect(otherPref?.optedIn).toBe(false);
  });

  it('unsubscribeAllByToken sets globalMarketingOptOut: true via unsubscribeAllForUser', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `optout-token-${crypto.randomUUID()}@test.com`,
    );
    const orgA = await seedOrg(t, `OA-${crypto.randomUUID()}`);
    const token = await seedMarketingPreference(t, {
      userId,
      organizerId: orgA,
      optedIn: true,
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.unsubscribeAllByToken, {
        token,
      });
    });

    const user = await t.run((ctx) => ctx.db.get('users', userId));
    expect(user?.globalMarketingOptOut).toBe(true);
  });

  it('getPreferencesByToken returns globalMarketingOptOut: false when not set', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `optout-query-${crypto.randomUUID()}@test.com`,
    );
    const orgA = await seedOrg(t, `OA-${crypto.randomUUID()}`);
    const token = await seedMarketingPreference(t, {
      userId,
      organizerId: orgA,
      optedIn: true,
    });

    const result = await t.run((ctx) =>
      ctx.runQuery(internal.marketing.emails.getPreferencesByToken, {token}),
    );

    expect(result).not.toBeNull();
    expect(result?.globalMarketingOptOut).toBe(false);
  });

  it('getPreferencesByToken returns globalMarketingOptOut: true after opt-out', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `optout-query2-${crypto.randomUUID()}@test.com`,
    );
    const orgA = await seedOrg(t, `OA-${crypto.randomUUID()}`);
    const token = await seedMarketingPreference(t, {
      userId,
      organizerId: orgA,
      optedIn: true,
    });

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production mutation sets globalMarketingOptOut directly; this simulates a user record already in the opted-out state to test query read behavior
    await t.run((ctx) =>
      ctx.db.patch('users', userId, {globalMarketingOptOut: true}),
    );

    const result = await t.run((ctx) =>
      ctx.runQuery(internal.marketing.emails.getPreferencesByToken, {token}),
    );

    expect(result?.globalMarketingOptOut).toBe(true);
  });

  it('getPreferencesByToken does not return sibling unsubscribe tokens', async () => {
    const t = convexTest();
    const userId = await seedUser(
      t,
      `no-redact-${crypto.randomUUID()}@test.com`,
    );
    const orgA = await seedOrg(t, `OA-${crypto.randomUUID()}`);
    const orgB = await seedOrg(t, `OB-${crypto.randomUUID()}`);
    const tokenA = await seedMarketingPreference(t, {
      userId,
      organizerId: orgA,
      optedIn: false,
      unsubToken: 'real-token-a',
    });
    await seedMarketingPreference(t, {
      userId,
      organizerId: orgB,
      optedIn: true,
      unsubToken: 'real-token-b',
    });

    const result = await t.run((ctx) =>
      ctx.runQuery(internal.marketing.emails.getPreferencesByToken, {
        token: tokenA,
      }),
    );

    expect(result).not.toBeNull();
    const prefB = result?.preferences.find((p) => p.organizerId === orgB);
    expect(prefB).toEqual({
      organizerId: orgB,
      organizerName: expect.any(String),
      optedIn: true,
      isAdmin: false,
    });
    expect(prefB).not.toHaveProperty('unsubToken');
  });
});

// ── preference hooks respect global opt-out ─────────────────────────

describe('preference hooks seed direct recipients as opted in', () => {
  it('application approval with globalMarketingOptOut creates preference with optedIn: true', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t, `Org-${crypto.randomUUID()}`);

    const adminId = await seedRootAdmin(t);
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- createUserDirectly does not support globalMarketingOptOut; raw insert is required to set up a user with this field pre-set
    const applicantId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- omit email so approval tests stay focused on marketing-preference side effects, not queued decision emails
      ctx.db.insert('users', {
        name: 'Opted Out Applicant',
        globalMarketingOptOut: true,
      }),
    );
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no seed helper creates a pending application; raw insert required to set up state for api.communities.applications.review to process
    const applicationId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for applications
      ctx.db.insert('applications', {
        userId: applicantId,
        organizerId: orgId,
        status: 'pending',
        answers: {},
      }),
    );

    await t
      .withIdentity({subject: adminId})
      .mutation(api.communities.applications.review, {
        applicationId,
        status: 'approved',
      });

    const pref = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', applicantId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(pref).not.toBeNull();
    expect(pref?.optedIn).toBe(true);
  });

  it('application approval without globalMarketingOptOut creates preference with optedIn: true', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t, `Org-${crypto.randomUUID()}`);

    const adminId = await seedRootAdmin(t);
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- omit email so approval tests stay focused on marketing-preference side effects, not queued decision emails
    const applicantId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for users
      ctx.db.insert('users', {
        name: 'Normal Applicant',
      }),
    );
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no seed helper creates a pending application; raw insert required to set up state for api.communities.applications.review to process
    const applicationId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for applications
      ctx.db.insert('applications', {
        userId: applicantId,
        organizerId: orgId,
        status: 'pending',
        answers: {},
      }),
    );

    await t
      .withIdentity({subject: adminId})
      .mutation(api.communities.applications.review, {
        applicationId,
        status: 'approved',
      });

    const pref = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', applicantId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(pref).not.toBeNull();
    expect(pref?.optedIn).toBe(true);
  });

  it('magic link redemption with globalMarketingOptOut creates preference with optedIn: true', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t, `Org-${crypto.randomUUID()}`);

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- createUserDirectly requires a name field; promoter here is just an identity for magic link creation with no name needed
    const promoterId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for users
      ctx.db.insert('users', {
        email: `promoter-${crypto.randomUUID()}@test.com`,
      }),
    );
    await seedCommunityAdmin(t, promoterId, orgId);
    const token = `ml-optout-${crypto.randomUUID()}`;
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- magic_links has no seed helper; direct insert is the only way to set up an active magic link for redemption testing
    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links
      ctx.db.insert('magic_links', {
        token,
        createdBy: promoterId,
        organizerId: orgId,
        status: 'active',
      }),
    );

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- createUserDirectly does not support globalMarketingOptOut; raw insert required to test behavior when redeemer has this flag set
    const redeemerId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for users
      ctx.db.insert('users', {
        email: `redeemer-optout-${crypto.randomUUID()}@test.com`,
        globalMarketingOptOut: true,
      }),
    );

    await t
      .withIdentity({subject: redeemerId})
      .mutation(api.communities.invite_links.redeem, {token});

    const pref = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', redeemerId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(pref).not.toBeNull();
    expect(pref?.optedIn).toBe(true);
  });

  it('magic link redemption without globalMarketingOptOut creates preference with optedIn: true', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t, `Org-${crypto.randomUUID()}`);

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- createUserDirectly requires a name field; promoter here is just an identity for magic link creation with no name needed
    const promoterId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for users
      ctx.db.insert('users', {
        email: `promoter-${crypto.randomUUID()}@test.com`,
      }),
    );
    await seedCommunityAdmin(t, promoterId, orgId);
    const token = `ml-optin-${crypto.randomUUID()}`;
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- magic_links has no seed helper; direct insert is the only way to set up an active magic link for redemption testing
    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for magic_links
      ctx.db.insert('magic_links', {
        token,
        createdBy: promoterId,
        organizerId: orgId,
        status: 'active',
      }),
    );

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- createUserDirectly requires a name field; redeemer here is a minimal user record to test magic link redemption flow
    const redeemerId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for users
      ctx.db.insert('users', {
        email: `redeemer-normal-${crypto.randomUUID()}@test.com`,
      }),
    );

    await t
      .withIdentity({subject: redeemerId})
      .mutation(api.communities.invite_links.redeem, {token});

    const pref = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', redeemerId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(pref).not.toBeNull();
    expect(pref?.optedIn).toBe(true);
  });

  it('application approval flips an existing opted-out preference row back to optedIn: true', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t, `Org-${crypto.randomUUID()}`);

    const adminId = await seedRootAdmin(t);
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- omit email so approval tests stay focused on marketing-preference side effects, not queued decision emails
    const applicantId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for users
      ctx.db.insert('users', {
        name: 'Existing Opt-Out Applicant',
      }),
    );
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- no seed helper creates a pending application with a pre-existing opted-out preference row; this multi-step setup in one t.run is required to test the flip-back behavior */
    const applicationId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for marketingEmailPreferences
      await ctx.db.insert('marketingEmailPreferences', {
        userId: applicantId,
        organizerId: orgId,
        optedIn: false,
        unsubToken: 'existing-opt-out-token',
        updatedAt: 0,
      });

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for applications
      return ctx.db.insert('applications', {
        userId: applicantId,
        organizerId: orgId,
        status: 'pending',
        answers: {},
      });
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    await t
      .withIdentity({subject: adminId})
      .mutation(api.communities.applications.review, {
        applicationId,
        status: 'approved',
      });

    const pref = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', applicantId).eq('organizerId', orgId),
        )
        .first(),
    );
    expect(pref).not.toBeNull();
    expect(pref?.optedIn).toBe(true);
    expect(pref?.unsubToken).toBe('existing-opt-out-token');
  });
});

// ── getAnnouncementStatus ───────────────────────────────────────────

describe('marketing_emails.getAnnouncementStatus', () => {
  async function setupEventWithAdmin(t: T) {
    const orgId = await seedOrg(t, `Org-${crypto.randomUUID()}`);
    const adminId = await seedUser(t, `admin-${crypto.randomUUID()}@test.com`);
    await seedCommunityAdmin(t, adminId, orgId);
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test Event',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });
    return {
      orgId,
      adminId,
      eventId,
      asAdmin: t.withIdentity({subject: adminId}),
    };
  }

  it('returns null when no records exist for the event', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await setupEventWithAdmin(t);

    const result = await asAdmin.query(
      api.marketing.emails.getAnnouncementStatus,
      {eventId},
    );
    expect(result).toBeNull();
  });

  it('returns the most recent record when multiple exist', async () => {
    const t = convexTest();
    const {adminId, eventId, asAdmin} = await setupEventWithAdmin(t);

    // Insert an older cancelled record first
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- eventMarketingEmails has no seed helper; direct inserts required to test ordering when multiple records exist
    await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for eventMarketingEmails
      ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() + 2 * 60 * 1000,
        status: 'cancelled',
      }),
    );

    // Insert a newer scheduled record
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- eventMarketingEmails has no seed helper; direct inserts required to test ordering when multiple records exist
    await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for eventMarketingEmails
      ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() + 3 * 60 * 1000,
        status: 'scheduled',
      }),
    );

    const result = await asAdmin.query(
      api.marketing.emails.getAnnouncementStatus,
      {eventId},
    );
    expect(result).not.toBeNull();
    // Most recent record is the 'scheduled' one (inserted last = higher _creationTime)
    expect(result?.status).toBe('scheduled');
    expect(result?.uniqueOpenCount).toBe(0);
    expect(result?.uniqueClickCount).toBe(0);
  });

  it('aggregates open and click counts for sent announcements', async () => {
    const t = convexTest();
    const {adminId, eventId, asAdmin, orgId} = await setupEventWithAdmin(t);
    const userA = await seedUser(t, `open-a-${crypto.randomUUID()}@test.com`);
    const userB = await seedUser(t, `open-b-${crypto.randomUUID()}@test.com`);
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- eventMarketingEmails has no seed helper; a pre-sent record is required to seed delivery rows for open/click aggregation testing
    const recordId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for eventMarketingEmails
      ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() - 5 * 60_000,
        status: 'sent',
        recipientCount: 2,
        sentAt: Date.now() - 4 * 60_000,
      }),
    );

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- marketingEmailDeliveries has no seed helper; direct inserts with specific open/click counts are required to test aggregation logic */
    await t.run((ctx) =>
      Promise.all([
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for marketingEmailDeliveries
        ctx.db.insert('marketingEmailDeliveries', {
          eventMarketingEmailId: recordId,
          eventId,
          organizerId: orgId,
          userId: userA,
          recipient: 'open-a@example.com',
          targetUrl: 'https://braket.gay/events/a',
          openToken: 'status-open-a',
          clickToken: 'status-click-a',
          sentAt: Date.now() - 4 * 60_000,
          openCount: 2,
          clickCount: 1,
          openedAt: Date.now() - 3 * 60_000,
          clickedAt: Date.now() - 2 * 60_000,
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for marketingEmailDeliveries
        ctx.db.insert('marketingEmailDeliveries', {
          eventMarketingEmailId: recordId,
          eventId,
          organizerId: orgId,
          userId: userB,
          recipient: 'open-b@example.com',
          targetUrl: 'https://braket.gay/events/b',
          openToken: 'status-open-b',
          clickToken: 'status-click-b',
          sentAt: Date.now() - 4 * 60_000,
          openCount: 1,
          clickCount: 0,
          openedAt: Date.now() - 90_000,
        }),
      ]),
    );
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const result = await asAdmin.query(
      api.marketing.emails.getAnnouncementStatus,
      {eventId},
    );

    expect(result).toEqual(
      expect.objectContaining({
        _id: recordId,
        status: 'sent',
        uniqueOpenCount: 2,
        totalOpenCount: 3,
        uniqueClickCount: 1,
        totalClickCount: 1,
      }),
    );
  });
});

// ── send pipeline: audienceScope threading ──────────────────────────

describe('scheduleAnnouncement stores audienceScope', () => {
  async function setupEventWithAdmin(t: T) {
    const orgId = await seedOrg(t, `SchedScope-${crypto.randomUUID()}`);
    const adminId = await seedUser(
      t,
      `admin-ss-${crypto.randomUUID()}@test.com`,
    );
    await seedCommunityAdmin(t, adminId, orgId);
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Scope Test Event',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });
    return {
      orgId,
      adminId,
      eventId,
      asAdmin: t.withIdentity({subject: adminId}),
    };
  }

  it('stores audienceScope on the record when provided', async () => {
    const t = convexTest();
    const {orgId, eventId, asAdmin} = await setupEventWithAdmin(t);

    // Seed a published org and active trust link so scope is not fallen back
    const trustedOrgId = await seedPublishedOrg(
      t,
      `TrustedOrg-${crypto.randomUUID()}`,
    );
    await seedTrustLink(t, orgId, trustedOrgId);

    await asAdmin.mutation(api.marketing.emails.scheduleAnnouncement, {
      eventId,
      scheduledFor: Date.now() + 2 * 60 * 1000,
      audienceScope: 'community_and_trusted',
    });

    const record = await t.run((ctx) =>
      ctx.db
        .query('eventMarketingEmails')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );
    expect(record?.audienceScope).toBe('community_and_trusted');
  });

  it('stores undefined audienceScope when not provided (backward compat)', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await setupEventWithAdmin(t);

    await asAdmin.mutation(api.marketing.emails.scheduleAnnouncement, {
      eventId,
      scheduledFor: Date.now() + 2 * 60 * 1000,
    });

    const record = await t.run((ctx) =>
      ctx.db
        .query('eventMarketingEmails')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );
    expect(record?.audienceScope).toBeUndefined();
  });

  it('falls back to "community" when community_and_trusted but no active trust links', async () => {
    const t = convexTest();
    const {eventId, asAdmin} = await setupEventWithAdmin(t);

    await asAdmin.mutation(api.marketing.emails.scheduleAnnouncement, {
      eventId,
      scheduledFor: Date.now() + 2 * 60 * 1000,
      audienceScope: 'community_and_trusted',
    });

    const record = await t.run((ctx) =>
      ctx.db
        .query('eventMarketingEmails')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );
    // Fell back to 'community' because no published trust links exist
    expect(record?.audienceScope).toBe('community');
  });

  it('falls back to "community" when community_and_trusted but trust links point to non-published orgs', async () => {
    const t = convexTest();
    const {orgId, eventId, asAdmin} = await setupEventWithAdmin(t);

    // Seed a DRAFT (non-published) trusted org and active trust link
    const draftOrgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: `DraftOrg-${crypto.randomUUID()}`,
      status: 'draft',
    });
    await seedTrustLink(t, orgId, draftOrgId);

    await asAdmin.mutation(api.marketing.emails.scheduleAnnouncement, {
      eventId,
      scheduledFor: Date.now() + 2 * 60 * 1000,
      audienceScope: 'community_and_trusted',
    });

    const record = await t.run((ctx) =>
      ctx.db
        .query('eventMarketingEmails')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );
    expect(record?.audienceScope).toBe('community');
  });
});

describe('sendAnnouncement passes stored scope to recipient resolution', () => {
  it('uses audienceScope from record when resolving recipients', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t, `SendScope-${crypto.randomUUID()}`);
    const adminId = await seedUser(
      t,
      `admin-sendscope-${crypto.randomUUID()}@test.com`,
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Scope Send Test',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    // Seed a trusted org and trust-linked user
    const trustedOrgId = await seedPublishedOrg(
      t,
      `TrustTarget-${crypto.randomUUID()}`,
    );
    await seedTrustLink(t, orgId, trustedOrgId);
    const trustLinkedUser = await seedUser(
      t,
      `trust-send-${crypto.randomUUID()}@test.com`,
    );
    await approveUser(t, trustLinkedUser, trustedOrgId);
    // No preference row for trustLinkedUser at orgId — included by default in C&T scope

    // Also seed a direct user
    const directUser = await seedUser(
      t,
      `direct-send-${crypto.randomUUID()}@test.com`,
    );
    await approveUser(t, directUser, orgId);
    await seedMarketingPreference(t, {
      userId: directUser,
      organizerId: orgId,
      optedIn: true,
    });

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- eventMarketingEmails has no seed helper; pre-seeding a scheduled record with audienceScope is required to test the scope-threading behavior
    const recordId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for eventMarketingEmails
      ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() - 1000,
        status: 'scheduled',
        audienceScope: 'community_and_trusted',
      }),
    );

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.sendAnnouncement, {
        eventMarketingEmailId: recordId,
      });
    });

    const record = await t.run((ctx) =>
      ctx.db.get('eventMarketingEmails', recordId),
    );
    expect(record?.status).toBe('sent');
    // Both direct + trust-linked user should be in recipientCount
    expect(record?.recipientCount).toBe(2);

    // Confirm the trust-linked user appears in the scheduled batch args
    const scheduledFunctions = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const batchJobs = scheduledFunctions.filter((job) =>
      JSON.stringify(job).includes('sendAnnouncementBatch'),
    );
    const serialized = JSON.stringify(batchJobs);
    expect(serialized).toContain(trustLinkedUser);
  });

  it('defaults to community scope when audienceScope is absent on record', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t, `DefaultScope-${crypto.randomUUID()}`);
    const adminId = await seedUser(
      t,
      `admin-defscope-${crypto.randomUUID()}@test.com`,
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Default Scope Test',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    // Seed a trusted org and trust-linked user (should NOT appear in community scope)
    const trustedOrgId = await seedPublishedOrg(
      t,
      `TrustTargetDef-${crypto.randomUUID()}`,
    );
    await seedTrustLink(t, orgId, trustedOrgId);
    const trustLinkedUser = await seedUser(
      t,
      `trust-def-${crypto.randomUUID()}@test.com`,
    );
    await approveUser(t, trustLinkedUser, trustedOrgId);

    // Only direct user
    const directUser = await seedUser(
      t,
      `direct-def-${crypto.randomUUID()}@test.com`,
    );
    await approveUser(t, directUser, orgId);
    await seedMarketingPreference(t, {
      userId: directUser,
      organizerId: orgId,
      optedIn: true,
    });

    // Record has NO audienceScope — defaults to 'community'
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- eventMarketingEmails has no seed helper; pre-seeding a scheduled record without audienceScope is required to test backward-compat community-scope default
    const recordId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for eventMarketingEmails
      ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() - 1000,
        status: 'scheduled',
      }),
    );

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.sendAnnouncement, {
        eventMarketingEmailId: recordId,
      });
    });

    const record = await t.run((ctx) =>
      ctx.db.get('eventMarketingEmails', recordId),
    );
    expect(record?.status).toBe('sent');
    // Only 1 — the direct user; trust-linked excluded by default community scope
    expect(record?.recipientCount).toBe(1);

    const scheduledFunctions = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const batchJobs = scheduledFunctions.filter((job) =>
      JSON.stringify(job).includes('sendAnnouncementBatch'),
    );
    const serialized = JSON.stringify(batchJobs);
    expect(serialized).not.toContain(trustLinkedUser);
  });
});

describe('sendAnnouncementBatch stores vettedViaOrganizerIds on delivery rows', () => {
  it('stores vettedViaOrganizerIds for trust-linked recipients', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t, `BatchVia-${crypto.randomUUID()}`);
    const adminId = await seedUser(
      t,
      `admin-batchvia-${crypto.randomUUID()}@test.com`,
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Batch Via Test',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- eventMarketingEmails has no seed helper; a pre-sent record is required to seed delivery batch rows
    const emailRecordId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for eventMarketingEmails
      ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() - 1000,
        status: 'sent',
        recipientCount: 1,
        sentAt: Date.now() - 500,
      }),
    );

    const trustedOrgId = await seedPublishedOrg(
      t,
      `TrustVia-${crypto.randomUUID()}`,
    );
    const trustLinkedUser = await seedUser(
      t,
      `via-user-${crypto.randomUUID()}@test.com`,
    );

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.sendAnnouncementBatch, {
        eventMarketingEmailId: emailRecordId,
        eventId,
        organizerId: orgId,
        sentAt: Date.now(),
        batchIndex: 0,
        recipients: [
          {
            userId: trustLinkedUser,
            email: `via-user-${crypto.randomUUID()}@test.com`,
            vettedViaOrganizerIds: [trustedOrgId],
          },
        ],
      });
    });

    const delivery = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailDeliveries')
        .withIndex('by_eventMarketingEmail', (q) =>
          q.eq('eventMarketingEmailId', emailRecordId),
        )
        .first(),
    );

    expect(delivery).not.toBeNull();
    expect(delivery?.vettedViaOrganizerIds).toEqual([trustedOrgId]);
  });

  it('does not set vettedViaOrganizerIds for direct recipients', async () => {
    const t = convexTest();
    const orgId = await seedOrg(t, `BatchDirect-${crypto.randomUUID()}`);
    const adminId = await seedUser(
      t,
      `admin-batchdirect-${crypto.randomUUID()}@test.com`,
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Batch Direct Test',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- eventMarketingEmails has no seed helper; a pre-sent record is required to seed delivery batch rows for direct recipients
    const emailRecordId = await t.run((ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for eventMarketingEmails
      ctx.db.insert('eventMarketingEmails', {
        eventId,
        adminId,
        scheduledFor: Date.now() - 1000,
        status: 'sent',
        recipientCount: 1,
        sentAt: Date.now() - 500,
      }),
    );

    const directUser = await seedUser(
      t,
      `direct-batch-${crypto.randomUUID()}@test.com`,
    );
    await seedMarketingPreference(t, {
      userId: directUser,
      organizerId: orgId,
      optedIn: true,
    });

    await t.run(async (ctx) => {
      await ctx.runMutation(internal.marketing.emails.sendAnnouncementBatch, {
        eventMarketingEmailId: emailRecordId,
        eventId,
        organizerId: orgId,
        sentAt: Date.now(),
        batchIndex: 0,
        recipients: [
          {
            userId: directUser,
            email: `direct-batch-${crypto.randomUUID()}@test.com`,
          },
        ],
      });
    });

    const delivery = await t.run((ctx) =>
      ctx.db
        .query('marketingEmailDeliveries')
        .withIndex('by_eventMarketingEmail', (q) =>
          q.eq('eventMarketingEmailId', emailRecordId),
        )
        .first(),
    );

    expect(delivery).not.toBeNull();
    expect(delivery?.vettedViaOrganizerIds).toBeUndefined();
  });
});

describe('getRecipientCount returns count breakdown', () => {
  async function setupOrgWithAdmin(t: T) {
    const orgId = await seedOrg(t, `CountBreak-${crypto.randomUUID()}`);
    const adminId = await seedUser(
      t,
      `admin-countbreak-${crypto.randomUUID()}@test.com`,
    );
    await seedCommunityAdmin(t, adminId, orgId);
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Count Breakdown Test',
      date: '2026-12-01',
      price: 0,
      totalTickets: 100,
      status: 'draft',
      visibility: 'public',
      organizerId: orgId,
    });
    return {
      orgId,
      adminId,
      eventId,
      asAdmin: t.withIdentity({subject: adminId}),
    };
  }

  it('returns directCount and trustLinkedCount=0 for community scope', async () => {
    const t = convexTest();
    const {orgId, eventId, asAdmin} = await setupOrgWithAdmin(t);

    const directUser = await seedUser(
      t,
      `direct-cnt-${crypto.randomUUID()}@test.com`,
    );
    await approveUser(t, directUser, orgId);
    await seedMarketingPreference(t, {
      userId: directUser,
      organizerId: orgId,
      optedIn: true,
    });

    const result = await asAdmin.query(api.marketing.emails.getRecipientCount, {
      eventId,
      audienceScope: 'community',
    });

    expect(result.count).toBe(1);
    expect(result.cappedAt500).toBe(false);
    expect(result.directCount).toBe(1);
    expect(result.trustLinkedCount).toBe(0);
    expect(result.totalCount).toBe(1);
  });

  it('returns directCount and trustLinkedCount for community_and_trusted scope', async () => {
    const t = convexTest();
    const {orgId, eventId, asAdmin} = await setupOrgWithAdmin(t);

    // Direct user
    const directUser = await seedUser(
      t,
      `direct-cnt2-${crypto.randomUUID()}@test.com`,
    );
    await approveUser(t, directUser, orgId);
    await seedMarketingPreference(t, {
      userId: directUser,
      organizerId: orgId,
      optedIn: true,
    });

    // Trust-linked user via published org
    const trustedOrgId = await seedPublishedOrg(
      t,
      `TrustCnt-${crypto.randomUUID()}`,
    );
    await seedTrustLink(t, orgId, trustedOrgId);
    const trustLinkedUser = await seedUser(
      t,
      `trust-cnt2-${crypto.randomUUID()}@test.com`,
    );
    await approveUser(t, trustLinkedUser, trustedOrgId);
    // No preference row — default included

    const result = await asAdmin.query(api.marketing.emails.getRecipientCount, {
      eventId,
      audienceScope: 'community_and_trusted',
    });

    expect(result.directCount).toBe(1);
    expect(result.trustLinkedCount).toBe(1);
    expect(result.totalCount).toBe(2);
    expect(result.count).toBe(2);
    expect(result.cappedAt500).toBe(false);
  });

  it('preserves backward-compat count and cappedAt500 fields when audienceScope is omitted', async () => {
    const t = convexTest();
    const {orgId, eventId, asAdmin} = await setupOrgWithAdmin(t);

    const directUser = await seedUser(
      t,
      `direct-compat-${crypto.randomUUID()}@test.com`,
    );
    await approveUser(t, directUser, orgId);
    await seedMarketingPreference(t, {
      userId: directUser,
      organizerId: orgId,
      optedIn: true,
    });

    const result = await asAdmin.query(api.marketing.emails.getRecipientCount, {
      eventId,
    });

    expect(result.count).toBe(1);
    expect(result.cappedAt500).toBe(false);
    expect(result.directCount).toBe(1);
    expect(result.trustLinkedCount).toBe(0);
    expect(result.totalCount).toBe(1);
  });

  it('does not hard-cap an audience exactly at the supported recipient limit', () => {
    expect(isMarketingAudienceOverHardCap(MAX_MARKETING_AUDIENCE_USERS)).toBe(
      false,
    );
    expect(
      isMarketingAudienceOverHardCap(MAX_MARKETING_AUDIENCE_USERS + 1),
    ).toBe(true);
  });
});
