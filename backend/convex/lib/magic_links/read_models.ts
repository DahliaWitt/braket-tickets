import type {Doc, Id} from '../../_generated/dataModel';
import type {DatabaseReader, QueryCtx} from '../../_generated/server';
import {
  loadAllMagicLinkRedemptionsByMagicLink,
  loadAllMagicLinksByOrganizer,
  loadFirstMagicLinkByToken,
} from '../../lib/indexed_loaders';
import {resolveSiteUrl} from '../../lib/site_url';
import type {MagicLinkStatus} from '../../lib/validators/magic_links';
import {canManageCommunity} from '../access';
import {throwInvalidState} from '../errors';

export type MagicLinkStatusAction = 'pause' | 'resume' | 'disable' | 'delete';
export type MagicLinkAdminStatus = MagicLinkStatus;

const STATE_MACHINE: Record<
  MagicLinkAdminStatus,
  readonly MagicLinkStatusAction[]
> = {
  active: ['pause', 'disable', 'delete'],
  paused: ['resume', 'disable', 'delete'],
  disabled: ['delete'],
};

type MagicLinkStatusTransition = {
  status: MagicLinkAdminStatus;
  deletedAt?: number;
};

type MagicLinksReadDb = Pick<DatabaseReader, 'query'>;
type MagicLinksReadCtx = QueryCtx;

export type MagicLinksListItem = {
  _id: Id<'magic_links'>;
  _creationTime: number;
  tokenPrefix?: string;
  label?: string;
  status: MagicLinkAdminStatus;
  expiresAt?: number;
  maxRedemptions?: number;
  redemptionCount: number;
  lastUsedAt?: number;
};

export function buildMagicLinkUrl(token: string): string {
  return `${resolveSiteUrl()}/invite/${token}`;
}

export function resolveMagicLinkTransition(
  currentStatus: MagicLinkAdminStatus,
  action: MagicLinkStatusAction,
): MagicLinkStatusTransition {
  const allowedActions = STATE_MACHINE[currentStatus] ?? [];
  if (!allowedActions.includes(action)) {
    const message = `Cannot ${action} a ${currentStatus} link`;
    throwInvalidState(message);
  }

  switch (action) {
    case 'pause':
      return {status: 'paused'};
    case 'resume':
      return {status: 'active'};
    case 'disable':
      return {status: 'disabled'};
    case 'delete':
      return {status: 'disabled', deletedAt: Date.now()};
  }

  throwInvalidState('Invalid transition action');
}

export async function getMagicLinkByTokenForInternal(
  ctx: QueryCtx,
  token: string,
): Promise<
  | (Doc<'magic_links'> & {
      status: MagicLinkAdminStatus;
      deletedAt?: number;
    })
  | null
> {
  return await loadFirstMagicLinkByToken(ctx.db, token);
}

async function loadMagicLinkRedemptionStats(
  db: MagicLinksReadDb,
  linkId: Id<'magic_links'>,
): Promise<{redemptionCount: number; lastUsedAt: number | undefined}> {
  const redemptions = await loadAllMagicLinkRedemptionsByMagicLink(db, linkId);

  const redemptionCount = redemptions.length;
  const lastUsedAt =
    redemptions.length > 0
      ? Math.max(...redemptions.map((r) => r.redeemedAt))
      : undefined;

  return {redemptionCount, lastUsedAt};
}

export type PastMagicLinksListItem = MagicLinksListItem & {deletedAt: number};

export async function mapMagicLinkForAdmin(
  db: MagicLinksReadDb,
  link: Doc<'magic_links'> & {status: MagicLinkAdminStatus},
): Promise<MagicLinksListItem> {
  const redemptionStats = await loadMagicLinkRedemptionStats(db, link._id);
  return {
    _id: link._id,
    _creationTime: link._creationTime,
    tokenPrefix: link.tokenPrefix ?? link.token?.slice(0, 8),
    label: link.label,
    status: link.status,
    expiresAt: link.expiresAt,
    maxRedemptions: link.maxRedemptions,
    redemptionCount: redemptionStats.redemptionCount,
    lastUsedAt: redemptionStats.lastUsedAt,
  };
}

export async function getMagicLinksForCommunityAdmin(
  ctx: MagicLinksReadCtx,
  adminId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<MagicLinksListItem[]> {
  if (!(await canManageCommunity(ctx, adminId, organizerId))) {
    return [];
  }

  const links = await loadAllMagicLinksByOrganizer(ctx.db, organizerId);

  const visibleLinks = links.filter((link) => !link.deletedAt) as Array<
    Doc<'magic_links'> & {status: MagicLinkAdminStatus}
  >;

  const result = await Promise.all(
    visibleLinks.map((link) => mapMagicLinkForAdmin(ctx.db, link)),
  );

  return result;
}

export async function getPastMagicLinksForCommunityAdmin(
  ctx: MagicLinksReadCtx,
  adminId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<PastMagicLinksListItem[]> {
  if (!(await canManageCommunity(ctx, adminId, organizerId))) {
    return [];
  }

  const links = await loadAllMagicLinksByOrganizer(ctx.db, organizerId);

  const deletedLinks = links.filter(
    (link) => link.deletedAt !== undefined,
  ) as Array<
    Doc<'magic_links'> & {status: MagicLinkAdminStatus; deletedAt: number}
  >;

  const result = await Promise.all(
    deletedLinks.map(async (link) => {
      const base = await mapMagicLinkForAdmin(ctx.db, link);
      return {...base, deletedAt: link.deletedAt};
    }),
  );

  return result;
}
