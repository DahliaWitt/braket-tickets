import type {Doc, Id} from '../../_generated/dataModel';
import type {DatabaseReader, DatabaseWriter} from '../../_generated/server';
import {collectAllQueryUnsafe} from '../../lib/query_scan';
import {
  digestBearerToken,
  generateBearerToken,
  tokenPrefix,
} from '../token_digests';

type MarketingPreferenceReader = Pick<DatabaseReader, 'get' | 'query'>;
type MarketingPreferenceWriter = Pick<
  DatabaseWriter,
  'get' | 'insert' | 'patch' | 'query'
>;

export type UserMarketingPreference = {
  organizerId: Id<'organizers'>;
  organizerName: string;
  organizerLogoStorageId: Id<'_storage'> | null | undefined;
  optedIn: boolean;
  isAdmin: boolean;
};

type PreferenceLookupArgs = {
  organizerId: Id<'organizers'>;
  userId: Id<'users'>;
};

export async function findMarketingPreferenceByUserAndOrganizer(
  db: Pick<DatabaseReader, 'query'>,
  args: PreferenceLookupArgs,
): Promise<Doc<'marketingEmailPreferences'> | null> {
  return db
    .query('marketingEmailPreferences')
    .withIndex('by_user_and_organizer', (query) =>
      query.eq('userId', args.userId).eq('organizerId', args.organizerId),
    )
    .first();
}

export async function getMarketingPreferencesByOrganizer(
  db: Pick<DatabaseReader, 'query'>,
  organizerId: Id<'organizers'>,
): Promise<Map<Id<'users'>, Doc<'marketingEmailPreferences'>>> {
  const preferences = await collectAllQueryUnsafe(
    db
      .query('marketingEmailPreferences')
      .withIndex('by_organizer_and_user', (query) =>
        query.eq('organizerId', organizerId),
      ),
  );

  return new Map(
    preferences.map((preference) => [preference.userId, preference]),
  );
}

export async function ensureMarketingPreferenceExists(
  db: MarketingPreferenceWriter,
  args: {
    organizerId: Id<'organizers'>;
    userId: Id<'users'>;
    optedIn?: boolean;
    updatedAt?: number;
    createToken?: () => string;
  },
): Promise<Doc<'marketingEmailPreferences'>> {
  const existing = await findMarketingPreferenceByUserAndOrganizer(db, args);
  if (existing) return existing;

  const now = args.updatedAt ?? Date.now();
  const token = args.createToken?.() ?? generateBearerToken();
  const insertedId = await db.insert('marketingEmailPreferences', {
    userId: args.userId,
    organizerId: args.organizerId,
    optedIn: args.optedIn ?? true,
    unsubTokenDigest: await digestBearerToken(
      'marketing_unsubscribe_user',
      token,
    ),
    unsubTokenPrefix: tokenPrefix(token),
    updatedAt: now,
  });
  // Same-transaction read of a just-inserted id; guaranteed to resolve.
  const inserted = await db.get('marketingEmailPreferences', insertedId);
  if (!inserted) {
    throw new Error(
      'ensureMarketingPreferenceExists: inserted row could not be re-read',
    );
  }
  return inserted;
}

export async function ensureApprovedMarketingPreference(
  db: MarketingPreferenceWriter & Pick<DatabaseReader, 'get'>,
  args: {
    userId: Id<'users'>;
    organizerId: Id<'organizers'> | undefined;
  },
): Promise<void> {
  if (!args.organizerId) return;

  const existing = await findMarketingPreferenceByUserAndOrganizer(db, {
    userId: args.userId,
    organizerId: args.organizerId,
  });
  const updatedAt = Date.now();

  if (existing) {
    await db.patch('marketingEmailPreferences', existing._id, {
      optedIn: true,
      updatedAt,
    });
    return;
  }

  const token = generateBearerToken();
  await db.insert('marketingEmailPreferences', {
    userId: args.userId,
    organizerId: args.organizerId,
    optedIn: true,
    unsubTokenDigest: await digestBearerToken(
      'marketing_unsubscribe_user',
      token,
    ),
    unsubTokenPrefix: tokenPrefix(token),
    updatedAt,
  });
}

export async function upsertMarketingPreference(
  db: MarketingPreferenceWriter,
  args: {
    organizerId: Id<'organizers'>;
    optedIn: boolean;
    userId: Id<'users'>;
    updatedAt?: number;
    createToken?: () => string;
  },
): Promise<void> {
  const existing = await findMarketingPreferenceByUserAndOrganizer(db, args);
  const updatedAt = args.updatedAt ?? Date.now();

  if (existing) {
    await db.patch('marketingEmailPreferences', existing._id, {
      optedIn: args.optedIn,
      updatedAt,
    });
    return;
  }

  const token = args.createToken?.() ?? generateBearerToken();
  await db.insert('marketingEmailPreferences', {
    userId: args.userId,
    organizerId: args.organizerId,
    optedIn: args.optedIn,
    unsubTokenDigest: await digestBearerToken(
      'marketing_unsubscribe_user',
      token,
    ),
    unsubTokenPrefix: tokenPrefix(token),
    updatedAt,
  });
}

export async function unsubscribeAllMarketingPreferencesForUser(
  db: Pick<DatabaseWriter, 'patch' | 'query'>,
  args: {
    userId: Id<'users'>;
    updatedAt?: number;
    /** Organizer IDs where the user is a community admin — these are skipped. */
    adminOrganizerIds?: Id<'organizers'>[];
  },
): Promise<void> {
  const preferences = await collectAllQueryUnsafe(
    db
      .query('marketingEmailPreferences')
      .withIndex('by_user', (query) => query.eq('userId', args.userId)),
  );

  const adminSet = args.adminOrganizerIds
    ? new Set(args.adminOrganizerIds)
    : undefined;

  const updatedAt = args.updatedAt ?? Date.now();
  await Promise.all(
    preferences
      .filter((preference) => !adminSet?.has(preference.organizerId))
      .map((preference) =>
        db.patch('marketingEmailPreferences', preference._id, {
          optedIn: false,
          updatedAt,
        }),
      ),
  );
}

export async function reEnableAllMarketingPreferencesForUser(
  db: Pick<DatabaseWriter, 'patch' | 'query'>,
  args: {
    userId: Id<'users'>;
    updatedAt?: number;
  },
): Promise<void> {
  const preferences = await collectAllQueryUnsafe(
    db
      .query('marketingEmailPreferences')
      .withIndex('by_user', (query) => query.eq('userId', args.userId)),
  );

  const updatedAt = args.updatedAt ?? Date.now();
  await Promise.all(
    preferences
      .filter((preference) => !preference.optedIn)
      .map((preference) =>
        db.patch('marketingEmailPreferences', preference._id, {
          optedIn: true,
          updatedAt,
        }),
      ),
  );
}

export async function getUserMarketingPreferences(
  db: MarketingPreferenceReader,
  userId: Id<'users'>,
  options?: {
    /** Organizer IDs where the user is a community admin. */
    adminOrganizerIds?: Id<'organizers'>[];
  },
): Promise<UserMarketingPreference[]> {
  const preferences = await collectAllQueryUnsafe(
    db
      .query('marketingEmailPreferences')
      .withIndex('by_user', (query) => query.eq('userId', userId)),
  );

  const adminSet = options?.adminOrganizerIds
    ? new Set(options.adminOrganizerIds)
    : undefined;

  const preferencesWithNulls = await Promise.all(
    preferences.map(async (preference) => {
      const organizer = await db.get('organizers', preference.organizerId);
      if (!organizer) return null;

      return {
        organizerId: preference.organizerId,
        organizerName: organizer.name,
        organizerLogoStorageId: organizer.logoStorageId,
        optedIn: preference.optedIn,
        isAdmin: adminSet?.has(preference.organizerId) ?? false,
      };
    }),
  );

  return preferencesWithNulls.filter(
    (preference): preference is UserMarketingPreference => preference !== null,
  );
}
