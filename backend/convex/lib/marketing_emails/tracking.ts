import type {Doc, Id} from '../../_generated/dataModel';
import type {DatabaseReader, DatabaseWriter} from '../../_generated/server';
import {collectAllQueryUnsafe} from '../../lib/query_scan';
import {
  digestBearerToken,
  generateBearerToken,
  tokenPrefix,
} from '../token_digests';

type DeliveryReader = Pick<DatabaseReader, 'query'>;
type DeliveryWriter = Pick<DatabaseWriter, 'get' | 'patch' | 'query'>;

export type MarketingDeliveryStats = {
  totalClickCount: number;
  totalOpenCount: number;
  uniqueClickCount: number;
  uniqueOpenCount: number;
};

export function createEmptyMarketingDeliveryStats(): MarketingDeliveryStats {
  return {
    totalClickCount: 0,
    totalOpenCount: 0,
    uniqueClickCount: 0,
    uniqueOpenCount: 0,
  };
}

export function readMarketingDeliveryStatsFromRecord(
  record: Pick<
    Doc<'eventMarketingEmails'>,
    | 'totalClickCount'
    | 'totalOpenCount'
    | 'uniqueClickCount'
    | 'uniqueOpenCount'
  >,
): MarketingDeliveryStats | null {
  if (
    record.totalClickCount === undefined ||
    record.totalOpenCount === undefined ||
    record.uniqueClickCount === undefined ||
    record.uniqueOpenCount === undefined
  ) {
    return null;
  }

  return {
    totalClickCount: record.totalClickCount,
    totalOpenCount: record.totalOpenCount,
    uniqueClickCount: record.uniqueClickCount,
    uniqueOpenCount: record.uniqueOpenCount,
  };
}

async function patchMarketingEmailStats(
  db: DeliveryWriter,
  eventMarketingEmailId: Id<'eventMarketingEmails'>,
  updates: {
    totalClickCountDelta?: number;
    totalOpenCountDelta?: number;
    uniqueClickCountDelta?: number;
    uniqueOpenCountDelta?: number;
  },
  currentStatsOverride?: MarketingDeliveryStats,
): Promise<void> {
  const email = await db.get('eventMarketingEmails', eventMarketingEmailId);
  if (!email) {
    return;
  }

  const currentStats =
    currentStatsOverride ??
    readMarketingDeliveryStatsFromRecord(email) ??
    (await summarizeMarketingDeliveryStats(db, eventMarketingEmailId));

  await db.patch('eventMarketingEmails', eventMarketingEmailId, {
    totalClickCount:
      currentStats.totalClickCount + (updates.totalClickCountDelta ?? 0),
    totalOpenCount:
      currentStats.totalOpenCount + (updates.totalOpenCountDelta ?? 0),
    uniqueClickCount:
      currentStats.uniqueClickCount + (updates.uniqueClickCountDelta ?? 0),
    uniqueOpenCount:
      currentStats.uniqueOpenCount + (updates.uniqueOpenCountDelta ?? 0),
  });
}

export function createMarketingTrackingToken(): string {
  return generateBearerToken();
}

export function buildMarketingTrackingUrls(args: {
  clickToken: string;
  openToken: string;
  apiBaseUrl: string;
}): {clickUrl: string; openPixelUrl: string} {
  const clickUrl = new URL('/api/marketing/click', args.apiBaseUrl);
  clickUrl.searchParams.set('token', args.clickToken);

  const openPixelUrl = new URL('/api/marketing/open', args.apiBaseUrl);
  openPixelUrl.searchParams.set('token', args.openToken);

  return {
    clickUrl: clickUrl.toString(),
    openPixelUrl: openPixelUrl.toString(),
  };
}

export async function createMarketingDelivery(
  db: Pick<DatabaseWriter, 'insert'>,
  args: {
    eventId: Id<'events'>;
    eventMarketingEmailId: Id<'eventMarketingEmails'>;
    organizerId: Id<'organizers'>;
    recipient: string;
    sentAt: number;
    targetUrl: string;
    userId: Id<'users'>;
    vettedViaOrganizerIds?: Id<'organizers'>[];
  },
): Promise<{clickToken: string; openToken: string}> {
  const clickToken = createMarketingTrackingToken();
  const openToken = createMarketingTrackingToken();
  const openTokenDigest = await digestBearerToken(
    'marketing_tracking_open',
    openToken,
  );
  const clickTokenDigest = await digestBearerToken(
    'marketing_tracking_click',
    clickToken,
  );

  await db.insert('marketingEmailDeliveries', {
    eventMarketingEmailId: args.eventMarketingEmailId,
    eventId: args.eventId,
    organizerId: args.organizerId,
    userId: args.userId,
    recipient: args.recipient,
    targetUrl: args.targetUrl,
    openTokenDigest,
    clickTokenDigest,
    openTokenPrefix: tokenPrefix(openToken),
    clickTokenPrefix: tokenPrefix(clickToken),
    sentAt: args.sentAt,
    openCount: 0,
    clickCount: 0,
    ...(args.vettedViaOrganizerIds !== undefined
      ? {vettedViaOrganizerIds: args.vettedViaOrganizerIds}
      : {}),
  });

  return {clickToken, openToken};
}

export async function recordMarketingDeliveryOpen(
  db: DeliveryWriter,
  args: {
    occurredAt?: number;
    token: string;
  },
): Promise<boolean> {
  const openTokenDigest = await digestBearerToken(
    'marketing_tracking_open',
    args.token,
  );
  const delivery = await db
    .query('marketingEmailDeliveries')
    .withIndex('by_open_tokenDigest', (query) =>
      query.eq('openTokenDigest', openTokenDigest),
    )
    .first();

  const legacyDelivery =
    delivery ??
    (await db
      .query('marketingEmailDeliveries')
      .withIndex('by_open_token', (query) => query.eq('openToken', args.token))
      .first());

  if (!legacyDelivery) {
    return false;
  }

  const deliveryDoc = legacyDelivery;
  const email = await db.get(
    'eventMarketingEmails',
    deliveryDoc.eventMarketingEmailId,
  );
  const currentStats =
    email === null ? null : readMarketingDeliveryStatsFromRecord(email);
  const fallbackStats =
    email !== null && currentStats === null
      ? await summarizeMarketingDeliveryStats(
          db,
          deliveryDoc.eventMarketingEmailId,
        )
      : currentStats;
  const occurredAt = args.occurredAt ?? Date.now();
  const isFirstOpen = deliveryDoc.openedAt === undefined;
  await db.patch('marketingEmailDeliveries', deliveryDoc._id, {
    openTokenDigest: deliveryDoc.openTokenDigest ?? openTokenDigest,
    openTokenPrefix: deliveryDoc.openTokenPrefix ?? tokenPrefix(args.token),
    openToken: undefined,
    openCount: deliveryDoc.openCount + 1,
    openedAt: deliveryDoc.openedAt ?? occurredAt,
  });
  await patchMarketingEmailStats(
    db,
    deliveryDoc.eventMarketingEmailId,
    {
      totalOpenCountDelta: 1,
      uniqueOpenCountDelta: isFirstOpen ? 1 : 0,
    },
    fallbackStats ?? undefined,
  );

  return true;
}

export async function recordMarketingDeliveryClick(
  db: DeliveryWriter,
  args: {
    occurredAt?: number;
    token: string;
  },
): Promise<string | null> {
  const clickTokenDigest = await digestBearerToken(
    'marketing_tracking_click',
    args.token,
  );
  const delivery = await db
    .query('marketingEmailDeliveries')
    .withIndex('by_click_tokenDigest', (query) =>
      query.eq('clickTokenDigest', clickTokenDigest),
    )
    .first();

  const legacyDelivery =
    delivery ??
    (await db
      .query('marketingEmailDeliveries')
      .withIndex('by_click_token', (query) =>
        query.eq('clickToken', args.token),
      )
      .first());

  if (!legacyDelivery) {
    return null;
  }

  const deliveryDoc = legacyDelivery;
  const email = await db.get(
    'eventMarketingEmails',
    deliveryDoc.eventMarketingEmailId,
  );
  const currentStats =
    email === null ? null : readMarketingDeliveryStatsFromRecord(email);
  const fallbackStats =
    email !== null && currentStats === null
      ? await summarizeMarketingDeliveryStats(
          db,
          deliveryDoc.eventMarketingEmailId,
        )
      : currentStats;
  const occurredAt = args.occurredAt ?? Date.now();
  const isFirstClick = deliveryDoc.clickedAt === undefined;
  await db.patch('marketingEmailDeliveries', deliveryDoc._id, {
    clickTokenDigest: deliveryDoc.clickTokenDigest ?? clickTokenDigest,
    clickTokenPrefix: deliveryDoc.clickTokenPrefix ?? tokenPrefix(args.token),
    clickToken: undefined,
    clickCount: deliveryDoc.clickCount + 1,
    clickedAt: deliveryDoc.clickedAt ?? occurredAt,
  });
  await patchMarketingEmailStats(
    db,
    deliveryDoc.eventMarketingEmailId,
    {
      totalClickCountDelta: 1,
      uniqueClickCountDelta: isFirstClick ? 1 : 0,
    },
    fallbackStats ?? undefined,
  );

  return deliveryDoc.targetUrl;
}

export async function summarizeMarketingDeliveryStats(
  db: DeliveryReader,
  eventMarketingEmailId: Id<'eventMarketingEmails'>,
): Promise<MarketingDeliveryStats> {
  const deliveries = await collectAllQueryUnsafe(
    db
      .query('marketingEmailDeliveries')
      .withIndex('by_eventMarketingEmail', (query) =>
        query.eq('eventMarketingEmailId', eventMarketingEmailId),
      ),
  );

  return deliveries.reduce<MarketingDeliveryStats>(
    (stats, delivery) => ({
      totalClickCount: stats.totalClickCount + delivery.clickCount,
      totalOpenCount: stats.totalOpenCount + delivery.openCount,
      uniqueClickCount: stats.uniqueClickCount + (delivery.clickedAt ? 1 : 0),
      uniqueOpenCount: stats.uniqueOpenCount + (delivery.openedAt ? 1 : 0),
    }),
    createEmptyMarketingDeliveryStats(),
  );
}
