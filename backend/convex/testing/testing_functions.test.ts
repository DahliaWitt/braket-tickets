import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {convexTest as baseConvexTest} from '../setup.testing';
import {api} from '../_generated/api';
import {authz, authzUserId} from '../lib/authz';

const adapterFindOneMock = vi.hoisted(() => vi.fn());
const adapterUpdateOneMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/better_auth_adapter', async () => {
  const actual = await vi.importActual<
    typeof import('../lib/better_auth_adapter')
  >('../lib/better_auth_adapter');

  return {
    ...actual,
    adapterFindOne: adapterFindOneMock,
    adapterUpdateOne: adapterUpdateOneMock,
  };
});

const activeTests: Array<ReturnType<typeof baseConvexTest>> = [];

const convexTest = () => {
  const t = baseConvexTest();
  activeTests.push(t);
  return t;
};

afterEach(async () => {
  try {
    while (activeTests.length > 0) {
      const t = activeTests.shift();
      if (t) {
        await t.mutation(api.testing.utilities.clearAll, {});
      }
    }
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

describe('testing/users_node.seedUserAndGetTokens', () => {
  beforeEach(() => {
    process.env['IS_TEST'] = 'true';
    vi.restoreAllMocks();
    adapterFindOneMock.mockReset();
    adapterUpdateOneMock.mockReset();
    adapterUpdateOneMock.mockResolvedValue(null);
    adapterFindOneMock.mockResolvedValue({
      _id: 'ba-user-1',
      emailVerified: false,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
  });

  it('returns the app user linked to the Better Auth identity', async () => {
    const t = convexTest();
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- tests the seeding helpers themselves; raw insert sets up pre-existing user to verify seedUserAndGetTokens linking */
    const existingUserId = await t.run(async (ctx) =>
      ctx.db.insert('users', {
        email: 'seeded@example.com',
        name: 'Seeded User',
      }),
    );
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    const result = await t.action(api.testing.users_node.seedUserAndGetTokens, {
      email: 'seeded@example.com',
      password: 'Password123!',
      name: 'Seeded User',
    });

    expect(result.userId).toBe(existingUserId);
    expect(adapterFindOneMock).toHaveBeenCalled();
    expect(adapterUpdateOneMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        model: 'user',
        update: expect.objectContaining({
          emailVerified: true,
        }),
      }),
    );

    await t.run(async (ctx) => {
      const user = await ctx.db.get('users', existingUserId);
      expect(user?.betterAuthUserId).toBe('ba-user-1');
      expect(user?.authEmailVerified).toBe(true);
      expect(user?.emailVerificationTime).toEqual(expect.any(Number));
    });
  });

  it('retries Better Auth user lookup before falling back to an email-only app user', async () => {
    const t = convexTest();
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- tests seeding helpers; raw insert verifies retry/lookup behavior of seedUserAndGetTokens */
    const existingUserId = await t.run(async (ctx) =>
      ctx.db.insert('users', {
        email: 'delayed@example.com',
        name: 'Delayed User',
      }),
    );
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    adapterFindOneMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        _id: 'ba-user-delayed',
        emailVerified: false,
      });

    const result = await t.action(api.testing.users_node.seedUserAndGetTokens, {
      email: 'delayed@example.com',
      password: 'Password123!',
      name: 'Delayed User',
    });

    expect(result.userId).toBe(existingUserId);
    expect(adapterFindOneMock).toHaveBeenCalledTimes(3);

    await t.run(async (ctx) => {
      const user = await ctx.db.get('users', existingUserId);
      expect(user?.betterAuthUserId).toBe('ba-user-delayed');
      expect(user?.authEmailVerified).toBe(true);
    });
  });
});

describe('testing/users.makeUserVetted', () => {
  beforeEach(() => {
    process.env['IS_TEST'] = 'true';
  });

  it('syncs direct membership and approved marketing preference', async () => {
    const t = convexTest();
    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- tests makeUserVetted helper; raw inserts set up inputs to verify helper output */
    const userId = await t.run(async (ctx) =>
      ctx.db.insert('users', {
        email: 'member@example.com',
        name: 'Member User',
      }),
    );
    const organizerId = await t.run(async (ctx) =>
      ctx.db.insert('organizers', {
        name: 'Member Organizer',
        slug: 'member-organizer',
        status: 'published',
        isPublicDirectory: true,
      }),
    );
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    await t.mutation(api.testing.users.makeUserVetted, {
      userId,
      organizerId,
    });

    await t.run(async (ctx) => {
      const application = await ctx.db
        .query('applications')
        .withIndex('by_user_and_organizer_and_status', (q) =>
          q
            .eq('userId', userId)
            .eq('organizerId', organizerId)
            .eq('status', 'approved'),
        )
        .unique();
      expect(application?._id).toBeTruthy();

      const member = await authz.hasRole(ctx, authzUserId(userId), 'member', {
        type: 'organizer',
        id: organizerId as string,
      });
      expect(member).toBe(true);

      const marketingPreference = await ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', userId).eq('organizerId', organizerId),
        )
        .unique();
      expect(marketingPreference?.optedIn).toBe(true);

      const directoryEntry = await ctx.db
        .query('organizer_user_directory')
        .withIndex('by_organizer_and_user', (q) =>
          q.eq('organizerId', organizerId).eq('userId', userId),
        )
        .unique();
      expect(directoryEntry?.communityAccessSource).toBe(
        'approved_application',
      );
    });
  });
});

describe('testing/events.seedEvent', () => {
  beforeEach(() => {
    process.env['IS_TEST'] = 'true';
  });

  it('defaults omitted visibility to private', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Seed Event Default Org',
      },
    );

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Default Visibility Event',
      date: '2030-06-01',
      price: 1000,
      organizerId,
    });

    await t.run(async (ctx) => {
      const event = await ctx.db.get(eventId);

      expect(event?.visibility).toBe('private');
      expect(event?.ticketSalesStatus).toBe('active');
    });
  });
});

describe('testing function seed projections', () => {
  beforeEach(() => {
    process.env['IS_TEST'] = 'true';
  });

  it('seedCommunityScanner refreshes the organizer directory for direct members', async () => {
    const t = convexTest();
    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Granting Admin',
      email: 'granting-admin@example.com',
    });
    const scannerId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Scanner User',
      email: 'scanner-user@example.com',
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Scanner Seed Org',
      },
    );

    await t.mutation(api.testing.communities.seedCommunityScanner, {
      userId: scannerId,
      organizerId,
      grantedBy: adminId,
    });

    await t.run(async (ctx) => {
      const directoryEntry = await ctx.db
        .query('organizer_user_directory')
        .withIndex('by_organizer_and_user', (q) =>
          q.eq('organizerId', organizerId).eq('userId', scannerId),
        )
        .unique();

      expect(directoryEntry?._id).toBeTruthy();
      expect(directoryEntry?.communityAccessSource).toBe('direct_member');
    });
  });

  it('seedTrustLink mirrors the trust-link projection used by shared-access propagation', async () => {
    const t = convexTest();
    const createdBy = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Seed Trust Link Admin',
      email: 'seed-trust-link-admin@example.com',
    });
    const trustingOrganizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Seed Trusting Org',
      },
    );
    const trustedOrganizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Seed Trusted Org',
      },
    );
    const sharedUserId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email to avoid unrelated approval-email side effects in this projection test
      return await ctx.db.insert('users', {
        // Omit email so the approved application stays focused on directory
        // projection behavior without queuing unrelated notification work.
        name: 'Seed Shared User',
      });
    });

    await t.mutation(api.testing.applications.seedApprovedApplication, {
      userId: sharedUserId,
      organizerId: trustedOrganizerId,
    });

    await t.mutation(api.testing.trust_links.seedTrustLink, {
      trustingOrganizerId,
      trustedOrganizerId,
      createdBy,
    });

    await t.run(async (ctx) => {
      const trustLink = await ctx.db
        .query('organizer_trust_links')
        .withIndex('by_trustingOrganizerId_and_trustedOrganizerId', (q) =>
          q
            .eq('trustingOrganizerId', trustingOrganizerId)
            .eq('trustedOrganizerId', trustedOrganizerId),
        )
        .unique();

      expect(trustLink?._id).toBeTruthy();

      const directoryEntry = await ctx.db
        .query('organizer_user_directory')
        .withIndex('by_organizer_and_user', (q) =>
          q.eq('organizerId', trustingOrganizerId).eq('userId', sharedUserId),
        )
        .unique();

      expect(directoryEntry?.communityAccessSource).toBe('shared');
      expect(directoryEntry?.trustedViaOrganizerName).toBe('Seed Trusted Org');
    });
  });

  it('seedDemoData seeds shared-access rows used by the admin directory', async () => {
    vi.useFakeTimers();
    const t = convexTest();
    const cooperId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Cooper',
      email: 'cooper-seed@example.com',
    });
    const kimId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Kim',
      email: 'kim-seed@example.com',
    });
    const nomiId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Nomi',
      email: 'nomi-seed@example.com',
    });
    const barneyId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Barney',
      email: 'barney-seed@example.com',
    });
    const charlieId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Charlie',
      email: 'charlie-seed@example.com',
    });
    const tobiasId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Tobias',
      email: 'tobias-seed@example.com',
    });
    const cherylId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Cheryl',
      email: 'cheryl-seed@example.com',
    });

    const result = await t.mutation(api.testing.demo.seedDemoData, {
      cooperId,
      kimId,
      nomiId,
      barneyId,
      charlieId,
      tobiasId,
      cherylId,
    });

    await t.run(async (ctx) => {
      const sharedEntry = await ctx.db
        .query('organizer_user_directory')
        .withIndex('by_organizer_and_user', (q) =>
          q
            .eq('organizerId', result.communities.sisterCityId)
            .eq('userId', kimId),
        )
        .unique();

      expect(sharedEntry?._id).toBeTruthy();
      expect(sharedEntry?.communityAccessSource).toBe('shared');
      expect(sharedEntry?.trustedViaOrganizerName).toBe('Anfangszeit');

      const lot45OutboundTrustLink = await ctx.db
        .query('organizer_trust_links')
        .withIndex('by_trustingOrganizerId_and_trustedOrganizerId', (q) =>
          q
            .eq('trustingOrganizerId', result.communities.lot45Id)
            .eq('trustedOrganizerId', result.communities.sisterCityId),
        )
        .unique();

      expect(lot45OutboundTrustLink?._id).toBeTruthy();
    });
  });

  it('seedDemoData accepts the full connected-account status shape', async () => {
    vi.useFakeTimers();
    const t = convexTest();
    const cooperId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Cooper Status',
      email: 'cooper-status-seed@example.com',
    });
    const kimId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Kim Status',
      email: 'kim-status-seed@example.com',
    });
    const nomiId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Nomi Status',
      email: 'nomi-status-seed@example.com',
    });
    const barneyId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Barney Status',
      email: 'barney-status-seed@example.com',
    });
    const charlieId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Charlie Status',
      email: 'charlie-status-seed@example.com',
    });
    const tobiasId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Tobias Status',
      email: 'tobias-status-seed@example.com',
    });
    const cherylId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Cheryl Status',
      email: 'cheryl-status-seed@example.com',
    });

    const result = await t.mutation(api.testing.demo.seedDemoData, {
      cooperId,
      kimId,
      nomiId,
      barneyId,
      charlieId,
      tobiasId,
      cherylId,
      stripeAccountLot45: 'acct_status_lot45',
      stripeAccountLot45Status: {
        onboardingStatus: 'restricted',
        chargesEnabled: true,
        payoutsEnabled: false,
        userRequirementsClear: false,
        currentlyDue: ['tos.acceptance'],
      },
      stripeAccountSisterCity: 'acct_status_sister_city',
      stripeAccountSisterCityStatus: {
        onboardingStatus: 'complete',
        chargesEnabled: true,
        payoutsEnabled: true,
        userRequirementsClear: true,
        currentlyDue: [],
      },
    });

    await t.run(async (ctx) => {
      const lot45 = await ctx.db.get(result.communities.lot45Id);
      const sisterCity = await ctx.db.get(result.communities.sisterCityId);

      expect(lot45?.stripeConnectedAccountId).toBe('acct_status_lot45');
      expect(lot45?.stripeOnboardingStatus).toBe('restricted');
      expect(lot45?.stripeChargesEnabled).toBe(true);
      expect(lot45?.stripePayoutsEnabled).toBe(false);
      expect(lot45?.stripeCurrentlyDue).toStrictEqual(['tos.acceptance']);

      expect(sisterCity?.stripeConnectedAccountId).toBe(
        'acct_status_sister_city',
      );
      expect(sisterCity?.stripeOnboardingStatus).toBe('complete');
      expect(sisterCity?.stripeChargesEnabled).toBe(true);
      expect(sisterCity?.stripePayoutsEnabled).toBe(true);
      expect(sisterCity?.stripeCurrentlyDue).toStrictEqual([]);
    });
  });
});

describe('token-gated seed facade', () => {
  const seedToken = 'seed-token-0123456789abcdef0123456789abcdef';
  const originalEnv = {...process.env};

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  function enableSeedSession(): void {
    process.env['DEV_SEED'] = 'true';
    process.env['DEV_SEED_TOKEN'] = seedToken;
    process.env['DEV_SEED_EXPIRES_AT'] = String(Date.now() + 60_000);
    process.env['CONVEX_CLOUD_URL'] = 'http://127.0.0.1:3210';
  }

  it('allows authorized seed existence checks', async () => {
    enableSeedSession();
    const t = convexTest();
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Facade authorization test setup
      await ctx.db.insert('organizers', {
        name: 'Anfangszeit',
        slug: 'anfangszeit',
        status: 'draft',
        isPublicDirectory: false,
      });
    });

    await expect(
      t.query(api.seed.ops.checkSeedExists, {seedToken}),
    ).resolves.toBe(true);
  });

  it('allows authorized clearAll through the seed facade', async () => {
    enableSeedSession();
    const t = convexTest();
    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Facade clear test setup
      return await ctx.db.insert('organizers', {
        name: 'Clear Me',
        slug: 'clear-me',
        status: 'draft',
        isPublicDirectory: false,
      });
    });

    await t.mutation(api.seed.ops.clearAll, {seedToken});

    await t.run(async (ctx) => {
      expect(await ctx.db.get(organizerId)).toBeNull();
    });
  });

  it('rejects unauthorized clearAll before destructive work', async () => {
    enableSeedSession();
    const t = convexTest();
    const organizerId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Facade rejection test setup
      return await ctx.db.insert('organizers', {
        name: 'Do Not Clear',
        slug: 'do-not-clear',
        status: 'draft',
        isPublicDirectory: false,
      });
    });

    await expect(
      t.mutation(api.seed.ops.clearAll, {
        seedToken: 'wrong-token-0123456789abcdef0123456789abcdef',
      }),
    ).rejects.toThrow('Seed authorization failed');

    await t.run(async (ctx) => {
      expect(await ctx.db.get(organizerId)).not.toBeNull();
    });
  });

  it('does not let DEV_SEED authorize generic testing helpers', async () => {
    enableSeedSession();
    process.env['IS_TEST'] = 'false';
    process.env['VITEST'] = 'false';
    process.env['NODE_ENV'] = 'test';
    const t = convexTest();

    await expect(
      t.query(api.testing.utilities.checkSeedExists, {}),
    ).rejects.toThrow('Calling a test only function');
  });
});
