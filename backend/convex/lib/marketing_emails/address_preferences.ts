import type {Doc, Id} from '../../_generated/dataModel';
import type {DatabaseReader, DatabaseWriter} from '../../_generated/server';
import {collectAllQueryUnsafe} from '../../lib/query_scan';
import {normalizeEmail} from '../../lib/validation';
import {throwAppError} from '../errors';
import {
  digestBearerToken,
  generateBearerToken,
  tokenPrefix,
} from '../token_digests';
import {findIssuedMarketingUnsubscribeToken} from './tokens';

type AddressPreferenceReader = Pick<DatabaseReader, 'get' | 'query'>;
type AddressPreferenceWriter = Pick<
  DatabaseWriter,
  'get' | 'insert' | 'patch' | 'query'
>;

export type EmailAddressMarketingPreference = {
  organizerId: Id<'organizers'>;
  organizerName: string;
  optedIn: boolean;
  isAdmin: false;
};

export async function findAddressMarketingPreferenceByEmailAndOrganizer(
  db: Pick<DatabaseReader, 'query'>,
  args: {email: string; organizerId: Id<'organizers'>},
): Promise<Doc<'emailAddressMarketingPreferences'> | null> {
  return db
    .query('emailAddressMarketingPreferences')
    .withIndex('by_email_and_organizer', (query) =>
      query
        .eq('email', normalizeEmail(args.email))
        .eq('organizerId', args.organizerId),
    )
    .first();
}

export async function getAddressMarketingPreferencesByOrganizer(
  db: Pick<DatabaseReader, 'query'>,
  organizerId: Id<'organizers'>,
): Promise<Map<string, Doc<'emailAddressMarketingPreferences'>>> {
  const preferences = await collectAllQueryUnsafe(
    db
      .query('emailAddressMarketingPreferences')
      .withIndex('by_organizer_and_email', (query) =>
        query.eq('organizerId', organizerId),
      ),
  );

  return new Map(
    preferences.map((preference) => [preference.email, preference]),
  );
}

export async function ensureAddressMarketingPreferenceExists(
  db: AddressPreferenceWriter,
  args: {
    email: string;
    organizerId: Id<'organizers'>;
    optedIn?: boolean;
    updatedAt?: number;
    createToken?: () => string;
  },
): Promise<Doc<'emailAddressMarketingPreferences'>> {
  const normalizedEmail = normalizeEmail(args.email);
  const existing = await findAddressMarketingPreferenceByEmailAndOrganizer(db, {
    email: normalizedEmail,
    organizerId: args.organizerId,
  });
  if (existing) return existing;

  const now = args.updatedAt ?? Date.now();
  const token = args.createToken?.() ?? generateBearerToken();
  const insertedId = await db.insert('emailAddressMarketingPreferences', {
    email: normalizedEmail,
    organizerId: args.organizerId,
    optedIn: args.optedIn ?? true,
    unsubTokenDigest: await digestBearerToken(
      'marketing_unsubscribe_address',
      token,
    ),
    unsubTokenPrefix: tokenPrefix(token),
    updatedAt: now,
  });
  // Same-transaction read of a just-inserted id; guaranteed to resolve.
  const inserted = await db.get('emailAddressMarketingPreferences', insertedId);
  if (!inserted) {
    throw new Error(
      'ensureAddressMarketingPreferenceExists: inserted row could not be re-read',
    );
  }
  return inserted;
}

export async function findAddressMarketingPreferenceByToken(
  db: Pick<DatabaseReader, 'get' | 'query'>,
  token: string,
): Promise<Doc<'emailAddressMarketingPreferences'> | null> {
  const issuedToken = await findIssuedMarketingUnsubscribeToken(db, token);
  if (issuedToken?.kind === 'address' && issuedToken.addressPreferenceId) {
    return await db.get(
      'emailAddressMarketingPreferences',
      issuedToken.addressPreferenceId,
    );
  }

  const tokenDigest = await digestBearerToken(
    'marketing_unsubscribe_address',
    token,
  );
  return (
    (await db
      .query('emailAddressMarketingPreferences')
      .withIndex('by_unsub_tokenDigest', (query) =>
        query.eq('unsubTokenDigest', tokenDigest),
      )
      .first()) ??
    (await db
      .query('emailAddressMarketingPreferences')
      .withIndex('by_unsub_token', (query) => query.eq('unsubToken', token))
      .first())
  );
}

export async function updateAddressMarketingPreferenceByToken(
  db: Pick<DatabaseWriter, 'get' | 'patch' | 'query'>,
  args: {token: string; optedIn: boolean; updatedAt?: number},
): Promise<void> {
  const preference = await findAddressMarketingPreferenceByToken(
    db,
    args.token,
  );
  if (!preference) {
    throwAppError('INVALID_TOKEN', 'invalid_token');
  }

  await db.patch('emailAddressMarketingPreferences', preference._id, {
    optedIn: args.optedIn,
    updatedAt: args.updatedAt ?? Date.now(),
  });
}

export async function updateAddressMarketingPreferenceInTokenScope(
  db: Pick<DatabaseWriter, 'get' | 'patch' | 'query'>,
  args: {
    token: string;
    organizerId: Id<'organizers'>;
    optedIn: boolean;
    updatedAt?: number;
  },
): Promise<void> {
  const tokenPreference = await findAddressMarketingPreferenceByToken(
    db,
    args.token,
  );
  if (!tokenPreference) {
    throwAppError('INVALID_TOKEN', 'invalid_token');
  }

  const preference = await findAddressMarketingPreferenceByEmailAndOrganizer(
    db,
    {
      email: tokenPreference.email,
      organizerId: args.organizerId,
    },
  );
  if (!preference) {
    throwAppError('INVALID_TOKEN', 'invalid_token');
  }

  await db.patch('emailAddressMarketingPreferences', preference._id, {
    optedIn: args.optedIn,
    updatedAt: args.updatedAt ?? Date.now(),
  });
}

export async function unsubscribeAllAddressMarketingPreferencesForEmail(
  db: Pick<DatabaseWriter, 'patch' | 'query'>,
  args: {email: string; updatedAt?: number},
): Promise<void> {
  const preferences = await collectAllQueryUnsafe(
    db
      .query('emailAddressMarketingPreferences')
      .withIndex('by_email', (query) =>
        query.eq('email', normalizeEmail(args.email)),
      ),
  );

  const updatedAt = args.updatedAt ?? Date.now();
  await Promise.all(
    preferences.map((preference) =>
      db.patch('emailAddressMarketingPreferences', preference._id, {
        optedIn: false,
        updatedAt,
      }),
    ),
  );
}

export async function getAddressMarketingPreferencesByToken(
  db: AddressPreferenceReader,
  token: string,
): Promise<{
  unsubscribedFrom: {
    organizerName: string;
    organizerId: Id<'organizers'>;
  } | null;
  globalMarketingOptOut: boolean;
  preferences: EmailAddressMarketingPreference[];
} | null> {
  const tokenPreference = await findAddressMarketingPreferenceByToken(
    db,
    token,
  );
  if (!tokenPreference) return null;

  const organizer = await db.get('organizers', tokenPreference.organizerId);
  const unsubscribedFrom = organizer
    ? {organizerName: organizer.name, organizerId: organizer._id}
    : null;

  const preferences = await collectAllQueryUnsafe(
    db
      .query('emailAddressMarketingPreferences')
      .withIndex('by_email', (query) =>
        query.eq('email', tokenPreference.email),
      ),
  );

  const preferencesWithNames = await Promise.all(
    preferences.map(async (preference) => {
      const prefOrganizer = await db.get('organizers', preference.organizerId);
      if (!prefOrganizer) return null;

      return {
        organizerId: preference.organizerId,
        organizerName: prefOrganizer.name,
        optedIn: preference.optedIn,
        isAdmin: false as const,
      };
    }),
  );

  return {
    unsubscribedFrom,
    globalMarketingOptOut: false,
    preferences: preferencesWithNames.filter(
      (preference): preference is EmailAddressMarketingPreference =>
        preference !== null,
    ),
  };
}
