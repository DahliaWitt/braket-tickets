import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {batchGetUsers} from '../../lib/batch_utils';
import {normalizeEmailOrNull} from '../../lib/validation';
import type {AudienceScope} from '../../lib/validators/marketing';
import {
  listOrganizerMembers,
  listPublishedTrustedAudienceOrganizers,
} from '../../lib/authz';
import {evaluateConsent} from '../audience/policy';
import {getMarketingPreferencesByOrganizer} from './preferences';
import {throwAppError} from '../../lib/errors';

/**
 * Hard cap on the total number of distinct user IDs a marketing audience
 * can enumerate across the direct-member and trust-linked lanes combined.
 *
 * Rationale: `listOrganizerMembers` already caps individual org membership
 * at `AUTHZ_RELATION_QUERY_CAP` (1000), and `assertTrustLinkLimit` caps
 * trusted-org fan-out at 20 — so the theoretical upper bound is
 * 1000 + (20 * 1000) = 21_000 IDs. `batchGetUsers` on that many rows
 * consumes per-transaction read budget that can force the whole Convex
 * query to bounce, with no actionable error for the organizer.
 *
 * We throw a typed `AUDIENCE_TOO_LARGE` ConvexError when the total crosses
 * the cap so the frontend can surface "contact support — audience too
 * large for a single send" instead of a generic transaction failure.
 *
 * The cap is deliberately below the raw theoretical bound: at 21_000 users
 * the follow-on `batchGetUsers` + `getMarketingPreferencesByOrganizer`
 * already strains the query budget, so the cap protects the envelope at
 * build time rather than during the follow-on fan-out.
 */
export const MAX_MARKETING_AUDIENCE_USERS = 10_000;

export const MARKETING_AUDIENCE_TOO_LARGE_CODE = 'AUDIENCE_TOO_LARGE';

export function isMarketingAudienceOverHardCap(
  candidateCount: number,
): boolean {
  return candidateCount > MAX_MARKETING_AUDIENCE_USERS;
}

export type MarketingAnnouncementRecipient = {
  userId: Id<'users'>;
  email: string;
  marketingPreference?: Pick<
    Doc<'marketingEmailPreferences'>,
    '_id' | 'userId' | 'organizerId'
  >;
  vettedViaOrganizerIds?: Id<'organizers'>[]; // present for trust-linked recipients
  /**
   * Snapshot of the user's `globalMarketingOptOut` flag at audience-build
   * time. Trust-linked users without a preference row need this passed
   * through to the batch sender so `ensureUserMarketingPreferenceForSend`
   * can seed the per-organizer preference row with the correct opt-in
   * default instead of hardcoding `false`. Always false when the user
   * reached the recipient list (opted-out users are filtered upstream),
   * but carried explicitly so future refactors cannot silently break the
   * invariant.
   */
  globalMarketingOptOut?: boolean;
};

type AudienceCtx = QueryCtx | MutationCtx;

async function loadDirectVettedUserIds(
  ctx: AudienceCtx,
  organizerId: Id<'organizers'>,
): Promise<Set<Id<'users'>>> {
  const memberUserIds = await listOrganizerMembers(ctx, organizerId);
  return new Set(memberUserIds.map((userId) => userId as Id<'users'>));
}

/**
 * Returns two sets of "vetted" user IDs for the given organizer:
 *
 * - `direct`: users vetted through direct approvals or magic link redemptions
 *   for this organizer.
 * - `trustLinked`: users vetted only via trusted-organizer approvals, keyed
 *   by userId with an array of the trusted organizer IDs that approved them
 *   (sorted alphabetically by organizer name). Only populated when
 *   `audienceScope` is `'community_and_trusted'`.
 *
 * Direct takes priority: a user in `direct` is never added to `trustLinked`.
 *
 * Trust links are only followed when `audienceScope` is
 * `'community_and_trusted'`. Trusted organizers with `status !== 'published'`
 * are skipped.
 */
export async function buildVettedUserIds(
  ctx: AudienceCtx,
  organizerId: Id<'organizers'>,
  audienceScope: AudienceScope = 'community',
): Promise<{
  direct: Set<Id<'users'>>;
  trustLinked: Map<Id<'users'>, Id<'organizers'>[]>;
}> {
  const direct = await loadDirectVettedUserIds(ctx, organizerId);

  // ── Trust-linked memberships (community_and_trusted scope only) ─────
  const trustLinked = new Map<Id<'users'>, Id<'organizers'>[]>();

  if (audienceScope === 'community_and_trusted') {
    const publishedTrustLinks = await listPublishedTrustedAudienceOrganizers(
      ctx,
      organizerId,
    );

    const trustedMembersByLink = await Promise.all(
      publishedTrustLinks.map((organizer) =>
        loadDirectVettedUserIds(ctx, organizer._id),
      ),
    );

    for (let index = 0; index < publishedTrustLinks.length; index++) {
      const trustedOrganizerId = publishedTrustLinks[index]!._id;
      const memberIds = trustedMembersByLink[index] ?? new Set<Id<'users'>>();

      for (const userId of memberIds) {
        // Direct takes priority — skip users already in direct.
        if (direct.has(userId)) continue;

        const existing = trustLinked.get(userId);
        if (existing === undefined) {
          // Check the combined cap BEFORE inserting a new user. This keeps
          // the cap decisive per-distinct-user — attribution backfill on an
          // already-seen user (the `else` branch below) never grows the
          // total user count, so it cannot trip the cap.
          if (direct.size + trustLinked.size >= MAX_MARKETING_AUDIENCE_USERS) {
            throwAppError(
              MARKETING_AUDIENCE_TOO_LARGE_CODE,
              `Marketing audience exceeds ${MAX_MARKETING_AUDIENCE_USERS} ` +
                'recipients across direct and trust-linked lanes. Split the ' +
                'send by narrowing `audienceScope` or pruning trust links.',
              {limit: MAX_MARKETING_AUDIENCE_USERS},
            );
          }
          trustLinked.set(userId, [trustedOrganizerId]);
        } else {
          if (!existing.includes(trustedOrganizerId)) {
            existing.push(trustedOrganizerId);
          }
        }
      }
    }
  }

  return {direct, trustLinked};
}

/**
 * Returns opted-in announcement recipients deduplicated by inbox address so
 * preview counts, delivery fan-out, and tracking totals stay aligned.
 *
 * Consent policies differ by audience lane (see `lib/audience/policy.ts`):
 * - `direct` users: `marketing-opt-in` — explicit `optedIn: true` row required.
 * - `trustLinked` users: `marketing-opt-out` — include unless the row says
 *   opt-out or the user has `globalMarketingOptOut`.
 *
 * Trust-linked recipients carry `vettedViaOrganizerIds` for attribution. The
 * batch sender creates an eager preference row and per-email unsubscribe token
 * before delivery.
 */
export async function getAnnouncementRecipients(
  ctx: AudienceCtx,
  organizerId: Id<'organizers'>,
  audienceScope: AudienceScope = 'community',
): Promise<MarketingAnnouncementRecipient[]> {
  const {direct, trustLinked} = await buildVettedUserIds(
    ctx,
    organizerId,
    audienceScope,
  );
  const preferenceByUserId = await getMarketingPreferencesByOrganizer(
    ctx.db,
    organizerId,
  );
  const userMap = await batchGetUsers(ctx, [...direct, ...trustLinked.keys()]);

  const distinctRecipientsByEmail = new Map<
    string,
    MarketingAnnouncementRecipient
  >();

  // ── Direct lane: marketing-opt-in (explicit row required) ────────────
  for (const userId of direct) {
    const user = userMap.get(userId);
    const email = normalizeEmailOrNull(user?.email);
    if (!email) continue;

    const preference = preferenceByUserId.get(userId);
    // marketing-opt-in requires an explicit opted-in row.
    if (!preference?.optedIn) continue;
    if (distinctRecipientsByEmail.has(email)) continue;

    distinctRecipientsByEmail.set(email, {
      userId,
      email,
      marketingPreference: {
        _id: preference._id,
        userId: preference.userId,
        organizerId: preference.organizerId,
      },
    });
  }

  // ── Trust-linked lane: marketing-opt-out (include unless negative signal) ──
  for (const [userId, vettedViaOrgIds] of trustLinked) {
    const user = userMap.get(userId);
    const email = normalizeEmailOrNull(user?.email);
    if (!email) continue;

    const preference = preferenceByUserId.get(userId) ?? null;
    const globalOptOut = user?.globalMarketingOptOut === true;
    const passes = evaluateConsent(
      {kind: 'marketing-opt-out'},
      {
        globalOptOut,
        userPreference: preference,
      },
    );
    if (!passes) continue;
    if (distinctRecipientsByEmail.has(email)) continue;

    distinctRecipientsByEmail.set(email, {
      userId,
      email,
      ...(preference
        ? {
            marketingPreference: {
              _id: preference._id,
              userId: preference.userId,
              organizerId: preference.organizerId,
            },
          }
        : {}),
      vettedViaOrganizerIds: vettedViaOrgIds,
      // Carry the flag forward even though it is always `false` when we
      // reach this branch (opted-out users were filtered by evaluateConsent
      // above). The batch sender uses this to derive the eager-pref
      // opt-in default instead of hardcoding it.
      globalMarketingOptOut: globalOptOut,
    });
  }

  return [...distinctRecipientsByEmail.values()];
}

export function getDistinctRecipientEmailCount(
  recipients: ReadonlyArray<MarketingAnnouncementRecipient>,
): number {
  const uniqueEmails = new Set<string>();

  for (const recipient of recipients) {
    uniqueEmails.add(recipient.email);
  }

  return uniqueEmails.size;
}
