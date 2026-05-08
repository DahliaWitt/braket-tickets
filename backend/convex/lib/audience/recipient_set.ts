import type {Id} from '../../_generated/dataModel';
import {normalizeEmailOrNull} from '../../lib/validation';

/**
 * A candidate recipient surfaced by one of the audience loaders. The audience
 * module normalizes email and applies consent; callers only have to surface
 * the raw (ticket-holder, guest row, organizer member, approved applicant)
 * and supply a decide function that consults their policy.
 */
export type RecipientCandidate =
  | {
      kind: 'user';
      userId: Id<'users'>;
      email: string | null | undefined;
    }
  | {
      kind: 'address';
      email: string | null | undefined;
    };

/**
 * A finalized recipient, ready to feed into a template. `email` is always
 * normalized via `normalizeEmailOrNull` (see `lib/validation`). `userId` is
 * present iff the recipient resolved to an account — address-only recipients
 * (guests, trust-linked users without a preference row on this org) omit it.
 */
export type BuiltRecipient = {
  email: string;
  userId?: Id<'users'>;
};

export type RecipientSet = {
  recipients: BuiltRecipient[];
  /** True when the iterator was fully drained; false when the
   * `stopAfterRecipientCount` threshold short-circuited the walk. */
  isComplete: boolean;
};

/**
 * Walk an async-iterable of candidates, apply `decide`, normalize + dedupe by
 * email, and return the final recipient set.
 *
 * Dedup rules (all deterministic, iteration-order-independent at the
 * candidate level thanks to the seenUserIds / first-seen guards):
 * - Email is normalized via `normalizeEmailOrNull` (trim + lowercase).
 * - Among address-kind entries sharing an email, first-seen wins.
 * - A user-kind candidate upgrades an existing address-kind entry with the
 *   same email (so a guest row for `alice@x` followed by a ticket from user
 *   Alice yields a single recipient carrying `userId = alice`).
 * - When two distinct user-kind candidates share an email, FIRST user wins.
 *   This matches the address-kind rule and makes attribution (userId,
 *   vettedViaOrganizerIds downstream) stable regardless of the order in
 *   which the underlying tables were scanned.
 * - The same `userId` is never consulted twice — a seenUserIds set skips
 *   duplicate user candidates before running `decide`, so decide runs once
 *   per distinct userId and once per distinct address candidate.
 *
 * Bounded mode: when `stopAfterRecipientCount` is set and the recipient Map
 * hits that size, the walk returns `isComplete: false` without draining the
 * rest of the iterable. Callers use this to probe audience size without
 * scanning every ticket on huge events.
 */
export async function buildRecipientSet(args: {
  candidates: AsyncIterable<RecipientCandidate>;
  decide: (
    candidate: RecipientCandidate,
    normalizedEmail: string,
  ) => Promise<boolean>;
  stopAfterRecipientCount?: number;
}): Promise<RecipientSet> {
  const recipientsByEmail = new Map<string, BuiltRecipient>();
  const seenUserIds = new Set<Id<'users'>>();

  for await (const candidate of args.candidates) {
    if (candidate.kind === 'user' && seenUserIds.has(candidate.userId)) {
      continue;
    }

    const email = normalizeEmailOrNull(candidate.email);
    if (!email) continue;

    if (candidate.kind === 'user') {
      seenUserIds.add(candidate.userId);
    }

    if (!(await args.decide(candidate, email))) continue;

    const existing = recipientsByEmail.get(email);
    // Write when no entry yet, or upgrade an address-only entry to a user entry.
    // Never overwrite an existing user entry (first-user-wins tiebreak).
    const shouldWrite =
      existing === undefined ||
      (candidate.kind === 'user' && existing.userId === undefined);
    if (shouldWrite) {
      recipientsByEmail.set(email, {
        email,
        ...(candidate.kind === 'user' ? {userId: candidate.userId} : {}),
      });
    }

    if (
      args.stopAfterRecipientCount !== undefined &&
      recipientsByEmail.size >= args.stopAfterRecipientCount
    ) {
      return {recipients: [...recipientsByEmail.values()], isComplete: false};
    }
  }

  return {recipients: [...recipientsByEmail.values()], isComplete: true};
}
