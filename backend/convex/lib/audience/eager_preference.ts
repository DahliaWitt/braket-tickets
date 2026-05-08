import type {Doc, Id} from '../../_generated/dataModel';
import type {DatabaseWriter} from '../../_generated/server';
import {normalizeEmailOrNull} from '../../lib/validation';
import {ensureMarketingPreferenceExists} from '../marketing_emails/preferences';
import {ensureAddressMarketingPreferenceExists} from '../marketing_emails/address_preferences';
import {
  issueAddressMarketingUnsubscribeToken,
  issueUserMarketingUnsubscribeToken,
} from '../marketing_emails/tokens';
import {throwAppError} from '../../lib/errors';

type PrefWriter = Pick<DatabaseWriter, 'get' | 'insert' | 'patch' | 'query'>;

/**
 * Ensure a user marketing-preference row exists for this organizer and return
 * the unsub token to embed in the outgoing email. Creates the row lazily on
 * first send so the unsubscribe link resolves even if the user has never
 * interacted with this organizer before.
 *
 * A freshly-created row inherits the user's platform-wide stance:
 *   initial optedIn = !userGlobalOptOut
 *
 * This matters for operational codepaths (e.g. event broadcasts): the user
 * still receives the operational email, but the newly-minted preference row
 * accurately reflects their platform-level consent so future *marketing*
 * fan-outs to the same user via the same organizer will honor their existing
 * opt-out.
 *
 * Existing rows are never modified here — only the user's explicit consent
 * mutation should flip `optedIn`.
 */
export async function ensureUserMarketingPreferenceForSend(
  db: PrefWriter,
  args: {
    userId: Id<'users'>;
    organizerId: Id<'organizers'>;
    userGlobalOptOut: boolean;
    existingPreference?: Pick<
      Doc<'marketingEmailPreferences'>,
      '_id' | 'userId' | 'organizerId'
    >;
  },
): Promise<string> {
  const prefetchedPreference =
    args.existingPreference?.userId === args.userId &&
    args.existingPreference.organizerId === args.organizerId
      ? args.existingPreference
      : undefined;
  const preference =
    prefetchedPreference ??
    (await ensureMarketingPreferenceExists(db, {
      userId: args.userId,
      organizerId: args.organizerId,
      optedIn: !args.userGlobalOptOut,
    }));
  return await issueUserMarketingUnsubscribeToken(db, {
    preferenceId: preference._id,
    userId: preference.userId,
    organizerId: preference.organizerId,
  });
}

/**
 * Ensure an address-scoped marketing-preference row exists for this organizer
 * and return the unsub token. Used for guest-checkout and raw-inbox recipients
 * where no user account backs the address.
 *
 * Freshly-created rows start opted-in: the address has no platform-wide
 * stance to mirror, and the caller is about to send anyway. The unsub link in
 * the email is the address's means to flip the flag.
 */
export async function ensureAddressMarketingPreferenceForSend(
  db: PrefWriter,
  args: {email: string; organizerId: Id<'organizers'>},
): Promise<string> {
  const normalized = normalizeEmailOrNull(args.email);
  if (!normalized) {
    throwAppError(
      'EMPTY_EMAIL_AFTER_NORMALIZATION',
      'ensureAddressMarketingPreferenceForSend: email was empty after normalization',
    );
  }
  const preference = await ensureAddressMarketingPreferenceExists(db, {
    email: normalized,
    organizerId: args.organizerId,
    optedIn: true,
  });
  return await issueAddressMarketingUnsubscribeToken(db, {
    preferenceId: preference._id,
    email: preference.email,
    organizerId: preference.organizerId,
  });
}
