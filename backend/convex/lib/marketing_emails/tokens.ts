import type {Doc, Id} from '../../_generated/dataModel';
import type {DatabaseReader, DatabaseWriter} from '../../_generated/server';
import {
  findMarketingPreferenceByUserAndOrganizer,
  getUserMarketingPreferences,
} from './preferences';
import {throwAppError} from '../errors';
import {
  digestBearerToken,
  generateBearerToken,
  tokenPrefix,
} from '../token_digests';

type TokenReader = Pick<DatabaseReader, 'get' | 'query'>;
type TokenWriter = Pick<DatabaseWriter, 'get' | 'insert' | 'patch' | 'query'>;

export type TokenScopedMarketingPreference = {
  organizerName: string;
  organizerId: Id<'organizers'>;
  optedIn: boolean;
  isAdmin: boolean;
};

export type MarketingPreferencesByToken = {
  unsubscribedFrom: {
    organizerName: string;
    organizerId: Id<'organizers'>;
  } | null;
  globalMarketingOptOut: boolean;
  preferences: TokenScopedMarketingPreference[];
} | null;

export async function findMarketingPreferenceByToken(
  db: Pick<DatabaseReader, 'get' | 'query'>,
  token: string,
): Promise<Doc<'marketingEmailPreferences'> | null> {
  const issuedToken = await findIssuedMarketingUnsubscribeToken(db, token);
  if (issuedToken?.kind === 'user' && issuedToken.userPreferenceId) {
    return await db.get(
      'marketingEmailPreferences',
      issuedToken.userPreferenceId,
    );
  }

  const tokenDigest = await digestBearerToken(
    'marketing_unsubscribe_user',
    token,
  );
  return (
    (await db
      .query('marketingEmailPreferences')
      .withIndex('by_unsub_tokenDigest', (query) =>
        query.eq('unsubTokenDigest', tokenDigest),
      )
      .first()) ??
    (await db
      .query('marketingEmailPreferences')
      .withIndex('by_unsub_token', (query) => query.eq('unsubToken', token))
      .first())
  );
}

export async function getMarketingPreferenceByTokenOrThrow(
  db: Pick<DatabaseReader, 'get' | 'query'>,
  token: string,
): Promise<Doc<'marketingEmailPreferences'>> {
  const preference = await findMarketingPreferenceByToken(db, token);
  if (!preference) throwAppError('INVALID_TOKEN', 'invalid_token');
  return preference;
}

export async function updateMarketingPreferenceByToken(
  db: TokenWriter,
  args: {
    token: string;
    optedIn: boolean;
    updatedAt?: number;
  },
): Promise<void> {
  const preference = await getMarketingPreferenceByTokenOrThrow(db, args.token);
  await db.patch('marketingEmailPreferences', preference._id, {
    optedIn: args.optedIn,
    updatedAt: args.updatedAt ?? Date.now(),
  });
}

export async function updateMarketingPreferenceInTokenScope(
  db: TokenWriter,
  args: {
    token: string;
    organizerId: Id<'organizers'>;
    optedIn: boolean;
    updatedAt?: number;
  },
): Promise<void> {
  const userId = await getUserIdByTokenOrThrow(db, args.token);
  const preference = await findMarketingPreferenceByUserAndOrganizer(db, {
    userId,
    organizerId: args.organizerId,
  });
  if (!preference) throwAppError('INVALID_TOKEN', 'invalid_token');

  await db.patch('marketingEmailPreferences', preference._id, {
    optedIn: args.optedIn,
    updatedAt: args.updatedAt ?? Date.now(),
  });
}

export async function getUserIdByTokenOrThrow(
  db: Pick<DatabaseReader, 'get' | 'query'>,
  token: string,
): Promise<Id<'users'>> {
  return (await getMarketingPreferenceByTokenOrThrow(db, token)).userId;
}

export async function getPreferencesByToken(
  db: TokenReader,
  token: string,
  options?: {
    getAdminOrganizerIds?: (userId: Id<'users'>) => Promise<Id<'organizers'>[]>;
  },
): Promise<MarketingPreferencesByToken> {
  const tokenPreference = await findMarketingPreferenceByToken(db, token);
  if (!tokenPreference) return null;

  const [organizer, user] = await Promise.all([
    db.get('organizers', tokenPreference.organizerId),
    db.get('users', tokenPreference.userId),
  ]);

  const unsubscribedFrom = organizer
    ? {organizerName: organizer.name, organizerId: organizer._id}
    : null;

  const globalMarketingOptOut = !!user?.globalMarketingOptOut;
  const adminOrganizerIds = options?.getAdminOrganizerIds
    ? await options.getAdminOrganizerIds(tokenPreference.userId)
    : undefined;

  const preferences = (
    await getUserMarketingPreferences(db, tokenPreference.userId, {
      adminOrganizerIds,
    })
  ).map((preference) => ({
    organizerName: preference.organizerName,
    organizerId: preference.organizerId,
    optedIn: preference.optedIn,
    isAdmin: preference.isAdmin,
  }));

  return {unsubscribedFrom, globalMarketingOptOut, preferences};
}

export async function findIssuedMarketingUnsubscribeToken(
  db: Pick<DatabaseReader, 'query'>,
  token: string,
): Promise<Doc<'marketingUnsubscribeTokens'> | null> {
  const userDigest = await digestBearerToken(
    'marketing_unsubscribe_user',
    token,
  );
  const userToken = await db
    .query('marketingUnsubscribeTokens')
    .withIndex('by_tokenDigest', (query) => query.eq('tokenDigest', userDigest))
    .first();
  if (userToken) return userToken;

  const addressDigest = await digestBearerToken(
    'marketing_unsubscribe_address',
    token,
  );
  return await db
    .query('marketingUnsubscribeTokens')
    .withIndex('by_tokenDigest', (query) =>
      query.eq('tokenDigest', addressDigest),
    )
    .first();
}

export async function issueUserMarketingUnsubscribeToken(
  db: Pick<DatabaseWriter, 'insert'>,
  args: {
    preferenceId: Id<'marketingEmailPreferences'>;
    userId: Id<'users'>;
    organizerId: Id<'organizers'>;
    createdAt?: number;
  },
): Promise<string> {
  const token = generateBearerToken();
  await db.insert('marketingUnsubscribeTokens', {
    kind: 'user',
    tokenDigest: await digestBearerToken('marketing_unsubscribe_user', token),
    tokenPrefix: tokenPrefix(token),
    userPreferenceId: args.preferenceId,
    userId: args.userId,
    organizerId: args.organizerId,
    createdAt: args.createdAt ?? Date.now(),
  });
  return token;
}

export async function issueAddressMarketingUnsubscribeToken(
  db: Pick<DatabaseWriter, 'insert'>,
  args: {
    preferenceId: Id<'emailAddressMarketingPreferences'>;
    email: string;
    organizerId: Id<'organizers'>;
    createdAt?: number;
  },
): Promise<string> {
  const token = generateBearerToken();
  await db.insert('marketingUnsubscribeTokens', {
    kind: 'address',
    tokenDigest: await digestBearerToken(
      'marketing_unsubscribe_address',
      token,
    ),
    tokenPrefix: tokenPrefix(token),
    addressPreferenceId: args.preferenceId,
    email: args.email,
    organizerId: args.organizerId,
    createdAt: args.createdAt ?? Date.now(),
  });
  return token;
}
