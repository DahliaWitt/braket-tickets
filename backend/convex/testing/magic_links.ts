import {v} from 'convex/values';
import {GenericDatabaseWriter} from 'convex/server';
import type {DataModel, Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {addMember} from '../lib/authz';
import {insertAdminAuditLog} from '../lib/admin_audit_log';
import {refreshOrganizerDirectoryForMembershipChange} from '../lib/users/organizer_directory';
import {ensureApprovedMarketingPreference} from '../lib/marketing_emails/preferences';
import {
  magicLinkStatusValidator,
  type MagicLinkStatus,
} from '../lib/validators/magic_links';
import {digestBearerToken, tokenPrefix} from '../lib/token_digests';
import {testingMutation} from './wrappers';
import {insertSeedOrganizer} from './communities';

interface InsertSeedMagicLinkArgs {
  createdBy: Id<'users'>;
  organizerId: Id<'organizers'>;
  status?: MagicLinkStatus;
  label?: string;
  token?: string;
  expiresAt?: number;
  maxRedemptions?: number;
}

/* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- the public magic-link
 * create flow is too restrictive here: it always sets status='active',
 * auto-generates the token, and runs limit checks that demo/test data would
 * exceed. Raw db is intentional here. */
export async function insertSeedMagicLink(
  db: GenericDatabaseWriter<DataModel>,
  args: InsertSeedMagicLinkArgs,
): Promise<{linkId: Id<'magic_links'>; token: string}> {
  const token = args.token ?? crypto.randomUUID().replaceAll('-', '');
  const linkId = await db.insert('magic_links', {
    tokenDigest: await digestBearerToken('magic_link', token),
    tokenPrefix: tokenPrefix(token),
    createdBy: args.createdBy,
    organizerId: args.organizerId,
    status: args.status ?? 'active',
    label: args.label,
    expiresAt: args.expiresAt,
    maxRedemptions: args.maxRedemptions,
  });
  return {linkId, token};
}
/* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

interface InsertSeedMagicLinkRedemptionArgs {
  magicLinkId: Id<'magic_links'>;
  userId?: Id<'users'>;
  guestSessionId?: Id<'guest_sessions'>;
  redeemedAt?: number;
}

export async function insertSeedMagicLinkRedemption(
  ctx: MutationCtx,
  args: InsertSeedMagicLinkRedemptionArgs,
): Promise<Id<'magic_link_redemption_log'>> {
  const link = await ctx.db.get('magic_links', args.magicLinkId);
  if (!link) {
    throw new Error('Magic link not found');
  }

  const redeemedAt = args.redeemedAt ?? Date.now();
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test seed helper for historical redemption fixtures.
  const redemptionId = await ctx.db.insert('magic_link_redemption_log', {
    magicLinkId: args.magicLinkId,
    userId: args.userId,
    guestSessionId: args.guestSessionId,
    redeemedAt,
  });

  if (args.userId && link.organizerId) {
    await addMember(ctx, args.userId, link.organizerId);
    await refreshOrganizerDirectoryForMembershipChange(ctx, {
      organizerId: link.organizerId,
      userId: args.userId,
    });
    await ensureApprovedMarketingPreference(ctx.db, {
      organizerId: link.organizerId,
      userId: args.userId,
    });
  }

  await insertAdminAuditLog(
    {db: ctx.db, meta: ctx.meta},
    {
      adminId: link.createdBy,
      action: 'magic_link.redemption',
      source: `redeemer:${args.userId ?? 'guest'} link:${args.magicLinkId} community_admin:${link.createdBy}`,
      magicLinkId: args.magicLinkId,
      organizerId: link.organizerId,
    },
  );

  return redemptionId;
}

const seedMagicLinkResultValidator = v.object({
  linkId: v.id('magic_links'),
  token: v.string(),
});

/**
 * Seeds a magic link directly into the database, bypassing RLS.
 * Allows setting custom status, expiry, and maxRedemptions for E2E test scenarios.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedMagicLink = testingMutation({
  args: {
    createdBy: v.id('users'),
    organizerId: v.optional(v.id('organizers')),
    status: v.optional(magicLinkStatusValidator),
    label: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    maxRedemptions: v.optional(v.number()),
    token: v.optional(v.string()),
  },
  returns: seedMagicLinkResultValidator,
  handler: async (ctx, args) => {
    const organizerId =
      args.organizerId ??
      (await insertSeedOrganizer(ctx, {
        name: `Magic Link Test Org ${crypto.randomUUID().slice(0, 8)}`,
        status: 'draft',
      }));
    return insertSeedMagicLink(ctx.db, {...args, organizerId});
  },
});

/**
 * Seeds a magic link redemption record.
 * Used to simulate a link that has already been redeemed (e.g. maxed-out link tests).
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedMagicLinkRedemption = testingMutation({
  args: {
    magicLinkId: v.id('magic_links'),
    userId: v.optional(v.id('users')),
    guestSessionId: v.optional(v.id('guest_sessions')),
  },
  returns: v.id('magic_link_redemption_log'),
  handler: async (ctx, args) => {
    return insertSeedMagicLinkRedemption(ctx, args);
  },
});
