import type {Doc, Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {
  batchGetStorageUrls,
  type StorageUrlContext,
} from '../../lib/storage_urls';
import {isOrganizerChargeReady, isOrganizerPayoutReady} from '../../lib/stripe_connect_state';

type CommunityDoc = Doc<'organizers'>;
type CommunityViewerDoc = Omit<
  CommunityDoc,
  | 'stripeConnectedAccountId'
  | 'stripeOnboardingStatus'
  | 'stripeChargesEnabled'
  | 'stripePayoutsEnabled'
  | 'stripeCurrentlyDue'
>;
type CommunityViewerWithLogoUrl = CommunityViewerDoc & {
  logoUrl?: string;
};
type CommunityAdminWithLogoUrl = CommunityDoc & {
  logoUrl?: string;
  organizerPaymentReady: boolean;
  organizerPayoutReady: boolean;
};

export async function resolveCommunityLogoUrl(
  ctx: StorageUrlContext,
  logoStorageId: Id<'_storage'> | null | undefined,
): Promise<string | undefined> {
  if (!logoStorageId) return undefined;
  return (await ctx.storage.getUrl(logoStorageId)) ?? undefined;
}

function toCommunityViewerWithLogoUrl(
  community: CommunityDoc,
  logoUrlMap: Map<string, string | null>,
): CommunityViewerWithLogoUrl {
  const {
    stripeConnectedAccountId: _stripeConnectedAccountId,
    stripeOnboardingStatus: _stripeOnboardingStatus,
    stripeChargesEnabled: _stripeChargesEnabled,
    stripePayoutsEnabled: _stripePayoutsEnabled,
    stripeCurrentlyDue: _stripeCurrentlyDue,
    ...viewerCommunity
  } = community;

  return {
    ...viewerCommunity,
    logoUrl: community.logoStorageId
      ? (logoUrlMap.get(community.logoStorageId) ?? undefined)
      : undefined,
  };
}

export async function mapCommunitiesWithLogoUrls(
  ctx: StorageUrlContext,
  communities: ReadonlyArray<CommunityDoc>,
): Promise<CommunityViewerWithLogoUrl[]> {
  const logoUrlMap = await batchGetStorageUrls(
    ctx,
    communities.map((community) => community.logoStorageId),
  );

  return communities.map((community) =>
    toCommunityViewerWithLogoUrl(community, logoUrlMap),
  );
}

function toCommunityAdminWithLogoUrl(
  community: CommunityDoc,
  logoUrlMap: Map<string, string | null>,
): CommunityAdminWithLogoUrl {
  return {
    ...community,
    logoUrl: community.logoStorageId
      ? (logoUrlMap.get(community.logoStorageId) ?? undefined)
      : undefined,
    organizerPaymentReady: isOrganizerChargeReady(community),
    organizerPayoutReady: isOrganizerPayoutReady(community),
  };
}

export async function mapAdminCommunitiesWithLogoUrls(
  ctx: StorageUrlContext,
  communities: ReadonlyArray<CommunityDoc>,
): Promise<CommunityAdminWithLogoUrl[]> {
  const logoUrlMap = await batchGetStorageUrls(
    ctx,
    communities.map((community) => community.logoStorageId),
  );

  return communities.map((community) =>
    toCommunityAdminWithLogoUrl(community, logoUrlMap),
  );
}

export async function loadCommunityWithLogoUrl(
  ctx: {db: QueryCtx['db']; storage: QueryCtx['storage']},
  communityId: Id<'organizers'>,
): Promise<CommunityViewerWithLogoUrl | null> {
  const community = await ctx.db.get('organizers', communityId);
  if (!community) return null;

  const [communityWithLogoUrl] = await mapCommunitiesWithLogoUrls(ctx, [
    community,
  ]);
  return communityWithLogoUrl ?? null;
}

export async function loadAdminCommunityWithLogoUrl(
  ctx: {db: QueryCtx['db']; storage: QueryCtx['storage']},
  communityId: Id<'organizers'>,
): Promise<CommunityAdminWithLogoUrl | null> {
  const community = await ctx.db.get('organizers', communityId);
  if (!community) return null;

  const [communityWithLogoUrl] = await mapAdminCommunitiesWithLogoUrls(ctx, [
    community,
  ]);
  return communityWithLogoUrl ?? null;
}
