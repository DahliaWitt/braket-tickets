import type {Doc, Id} from '../../_generated/dataModel';
import type {DatabaseReader} from '../../_generated/server';
import {countMatchingInQuery} from '../../lib/query_scan';
import {logger} from '../../lib/logger';
import {
  loadFirstMagicLinkByToken,
  magicLinkRedemptionsByMagicLinkQuery,
} from '../../lib/indexed_loaders';
import type {MagicLinkValidationError} from '../../lib/validators/magic_links';

type LinkDocument = Doc<'magic_links'>;
type LinkCommunityName = string | undefined;

type MagicLinkQueryDb = Pick<DatabaseReader, 'get' | 'query'>;

export type {MagicLinkValidationError} from '../../lib/validators/magic_links';

export type ValidateTokenArgs = {
  token: string;
  now?: number;
};

export type MagicLinkValidationResult = {
  valid: boolean;
  error: undefined | MagicLinkValidationError;
  communityName?: LinkCommunityName;
};

type MagicLinkStateEvaluation =
  | {valid: true; link: LinkDocument}
  | {valid: false; error: MagicLinkValidationError};

export function logValidationFailure(token: string, reason: string): void {
  logger.warn('magic_links', '[SECURITY:VALIDATE_TOKEN_FAILED]', {
    reason,
    tokenPrefix: token.slice(0, 8),
    timestamp: Date.now(),
  });
}

export async function getValidMagicLinkByToken(
  db: MagicLinkQueryDb,
  args: ValidateTokenArgs,
): Promise<LinkDocument | null> {
  const link = await loadFirstMagicLinkByToken(db, args.token);
  const evaluation = await evaluateMagicLinkState(db, link, args.now ?? Date.now());
  return evaluation.valid ? evaluation.link : null;
}

export async function getCommunityNameForMagicLink(
  db: MagicLinkQueryDb,
  link: LinkDocument,
): Promise<LinkCommunityName> {
  const organizer = await db.get('organizers', link.organizerId);
  return organizer?.name;
}

async function getLinkRedemptionCount(
  db: MagicLinkQueryDb,
  linkId: Id<'magic_links'>,
  stopAfter?: number,
): Promise<number> {
  return await countMatchingInQuery(
    magicLinkRedemptionsByMagicLinkQuery(db, linkId),
    () => true,
    stopAfter,
  );
}

export async function evaluateMagicLinkState(
  db: MagicLinkQueryDb,
  link: LinkDocument | null,
  now: number,
): Promise<MagicLinkStateEvaluation> {
  if (!link || link.deletedAt) {
    return {valid: false, error: 'invalid'};
  }

  if (link.status === 'paused') {
    return {valid: false, error: 'paused'};
  }

  if (link.status === 'disabled') {
    return {valid: false, error: 'disabled'};
  }

  if (link.expiresAt && link.expiresAt < now) {
    return {valid: false, error: 'expired'};
  }

  if (link.maxRedemptions) {
    const redemptionCount = await getLinkRedemptionCount(db, link._id, link.maxRedemptions);
    if (redemptionCount >= link.maxRedemptions) {
      return {valid: false, error: 'maxed'};
    }
  }

  return {valid: true, link};
}

export async function validateMagicLinkToken(
  db: MagicLinkQueryDb,
  args: ValidateTokenArgs,
): Promise<MagicLinkValidationResult> {
  const link = await loadFirstMagicLinkByToken(db, args.token);
  const now = args.now ?? Date.now();
  const evaluation = await evaluateMagicLinkState(db, link, now);
  if (!evaluation.valid) {
    logValidationFailure(args.token, evaluation.error);
    return {valid: false, error: evaluation.error};
  }

  return {
    valid: true,
    error: undefined,
    communityName: await getCommunityNameForMagicLink(db, evaluation.link),
  };
}
