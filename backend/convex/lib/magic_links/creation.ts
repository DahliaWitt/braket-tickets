import {countMatchingInQuery} from '../../lib/query_scan';
import {requireManageCommunity} from '../../lib/access';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {
  digestBearerToken,
  generateBearerToken,
  tokenPrefix,
} from '../token_digests';
import {buildMagicLinkUrl} from './read_models';
import {
  throwConflict,
  throwInvalidInput,
  throwNotFound,
} from '../../lib/errors';

type LinkCreatorCtx = MutationCtx;

export type MagicLinkCreateArgs = {
  organizerId: Id<'organizers'>;
  label?: string;
  expiresAt?: number;
  maxRedemptions?: number;
  createdAt?: number;
};

export type MagicLinkCreateResult = {
  linkId: Id<'magic_links'>;
  token: string;
  url: string;
};

function normalizeLabel(label?: string): string | undefined {
  const trimmedLabel = label?.trim();
  if (!trimmedLabel) return undefined;
  if (trimmedLabel.length > 100) {
    throwInvalidInput('Label must be 100 characters or less', {
      field: 'label',
    });
  }
  return trimmedLabel;
}

function validateCreateArgs(now: number, args: MagicLinkCreateArgs): void {
  if (args.expiresAt && args.expiresAt <= now) {
    throwInvalidInput('Expiration date must be in the future', {
      field: 'expiresAt',
    });
  }

  if (args.maxRedemptions !== undefined && args.maxRedemptions < 1) {
    throwInvalidInput('Max redemptions must be at least 1', {
      field: 'maxRedemptions',
    });
  }
}

async function getNextLinkLabel(
  ctx: LinkCreatorCtx,
  userId: Id<'users'>,
): Promise<string> {
  const existingLinkCount = await countMatchingInQuery(
    ctx.db
      .query('magic_links')
      .withIndex('by_createdBy', (q) => q.eq('createdBy', userId)),
  );
  return `Link ${existingLinkCount + 1}`;
}

async function assertCanCreateMagicLink(
  ctx: LinkCreatorCtx,
  user: Doc<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  const organizer = await ctx.db.get('organizers', organizerId);
  if (!organizer) {
    throwNotFound('Community');
  }

  await requireManageCommunity(ctx, user._id, organizerId);
}

async function assertActiveMagicLinkLimit(
  ctx: LinkCreatorCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  // TODO: Revisit and likely remove this per-creator active-link limit.
  // Magic links are community-scoped, so this cap may no longer match the model.
  const nonDeletedActiveCount = await countMatchingInQuery(
    ctx.db
      .query('magic_links')
      .withIndex('by_organizerId_and_createdBy_and_status', (q) =>
        q
          .eq('organizerId', organizerId)
          .eq('createdBy', userId)
          .eq('status', 'active'),
      ),
    (link) => !link.deletedAt,
    20,
  );
  if (nonDeletedActiveCount >= 20) {
    throwConflict('Maximum 20 active magic links per community admin');
  }
}

export async function createMagicLink(
  ctx: LinkCreatorCtx,
  user: Doc<'users'>,
  args: MagicLinkCreateArgs,
): Promise<MagicLinkCreateResult> {
  await assertCanCreateMagicLink(ctx, user, args.organizerId);

  const now = args.createdAt ?? Date.now();
  validateCreateArgs(now, args);

  await assertActiveMagicLinkLimit(ctx, user._id, args.organizerId);

  const token = generateBearerToken();
  const tokenDigest = await digestBearerToken('magic_link', token);
  const label =
    normalizeLabel(args.label) ?? (await getNextLinkLabel(ctx, user._id));
  const linkId = await ctx.db.insert('magic_links', {
    tokenDigest,
    tokenPrefix: tokenPrefix(token),
    createdBy: user._id,
    organizerId: args.organizerId,
    status: 'active',
    label,
    expiresAt: args.expiresAt,
    maxRedemptions: args.maxRedemptions,
  });

  return {
    linkId,
    token,
    url: buildMagicLinkUrl(token),
  };
}
