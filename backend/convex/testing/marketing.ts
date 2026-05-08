import {v} from 'convex/values';
import {digestBearerToken, tokenPrefix} from '../lib/token_digests';
import {testingMutation} from './wrappers';

/**
 * Seeds a marketing email preference row directly into the database, bypassing RLS.
 * Used to set up E2E test scenarios for unsubscribe link testing.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedMarketingPreference = testingMutation({
  args: {
    userId: v.id('users'),
    organizerId: v.id('organizers'),
    optedIn: v.boolean(),
    unsubToken: v.string(),
  },
  returns: v.id('marketingEmailPreferences'),
  handler: async ({db}, args) => {
    const existing = await db
      .query('marketingEmailPreferences')
      .withIndex('by_user_and_organizer', (q) =>
        q.eq('userId', args.userId).eq('organizerId', args.organizerId),
      )
      .unique();

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Upsert pattern: update-or-create with no corresponding mutation */
    if (existing) {
      await db.patch('marketingEmailPreferences', existing._id, {
        optedIn: args.optedIn,
        unsubTokenDigest: await digestBearerToken(
          'marketing_unsubscribe_user',
          args.unsubToken,
        ),
        unsubTokenPrefix: tokenPrefix(args.unsubToken),
        unsubToken: undefined,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await db.insert('marketingEmailPreferences', {
      userId: args.userId,
      organizerId: args.organizerId,
      optedIn: args.optedIn,
      unsubTokenDigest: await digestBearerToken(
        'marketing_unsubscribe_user',
        args.unsubToken,
      ),
      unsubTokenPrefix: tokenPrefix(args.unsubToken),
      updatedAt: Date.now(),
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
  },
});

/**
 * Seeds an email-address marketing preference row directly into the database,
 * bypassing RLS. Used for address-level opt-out test scenarios where the
 * preference is keyed by email, not userId.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedAddressMarketingPreference = testingMutation({
  args: {
    email: v.string(),
    organizerId: v.id('organizers'),
    optedIn: v.boolean(),
    unsubToken: v.string(),
  },
  returns: v.id('emailAddressMarketingPreferences'),
  handler: async ({db}, args) => {
    const normalizedEmail = args.email.trim().toLowerCase();
    const existing = await db
      .query('emailAddressMarketingPreferences')
      .withIndex('by_email_and_organizer', (q) =>
        q.eq('email', normalizedEmail).eq('organizerId', args.organizerId),
      )
      .unique();

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Upsert pattern: update-or-create with no corresponding mutation */
    if (existing) {
      await db.patch('emailAddressMarketingPreferences', existing._id, {
        optedIn: args.optedIn,
        unsubTokenDigest: await digestBearerToken(
          'marketing_unsubscribe_address',
          args.unsubToken,
        ),
        unsubTokenPrefix: tokenPrefix(args.unsubToken),
        unsubToken: undefined,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await db.insert('emailAddressMarketingPreferences', {
      email: normalizedEmail,
      organizerId: args.organizerId,
      optedIn: args.optedIn,
      unsubTokenDigest: await digestBearerToken(
        'marketing_unsubscribe_address',
        args.unsubToken,
      ),
      unsubTokenPrefix: tokenPrefix(args.unsubToken),
      updatedAt: Date.now(),
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
  },
});
