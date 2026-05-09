import type {Doc} from '../../_generated/dataModel';

/**
 * Consent policy for an email-sending codepath.
 *
 * - `operational`: transactional-style event info (broadcasts to all ticket
 *   holders). The user bought a ticket; they get event updates regardless of
 *   marketing preferences. Unsub links still render so the email is CAN-SPAM
 *   compliant, but preference state does not filter delivery.
 * - `marketing-opt-in`: explicit opt-in required. Used for direct-vetted
 *   community announcements where the organizer must earn the send.
 * - `marketing-opt-out`: include unless a negative signal is present. Used for
 *   trust-linked announcements and ticket-purchase reminders — the user is
 *   already in-scope; honor opt-outs only.
 */
export type ConsentPolicy =
  | {kind: 'operational'}
  | {kind: 'marketing-opt-in'}
  | {kind: 'marketing-opt-out'};

/**
 * Inputs to a consent decision. Callers pre-load organizer-wide preference
 * maps once and pass per-candidate slices here — this type is the contract
 * between the loader and the decision function.
 *
 * Per-policy field consumption:
 *
 * | Field              | operational | marketing-opt-in | marketing-opt-out |
 * | ------------------ | ----------- | ---------------- | ----------------- |
 * | globalOptOut       | ignored     | ignored          | used              |
 * | userPreference     | ignored     | REQUIRED         | used              |
 * | addressPreference  | ignored     | ignored          | used              |
 *
 * For `marketing-opt-in`, `userPreference.optedIn` must be `true` or the
 * recipient is dropped; the other fields are never read.
 *
 * For `marketing-opt-out`, any negative signal (global opt-out, an explicit
 * opted-out user row, or an explicit opted-out address row) drops the
 * recipient; absence of a preference row is an implicit include.
 *
 * Callers should leave unused fields undefined rather than threading empty
 * maps through — the switch below reads only what its branch needs.
 */
export type ConsentInputs = {
  globalOptOut?: boolean;
  userPreference?: Doc<'marketingEmailPreferences'> | null;
  addressPreference?: Doc<'emailAddressMarketingPreferences'> | null;
};

export function evaluateConsent(
  policy: ConsentPolicy,
  inputs: ConsentInputs,
): boolean {
  switch (policy.kind) {
    case 'operational':
      return true;
    case 'marketing-opt-in':
      // Explicit opted-in row required. No row → not included.
      return inputs.userPreference?.optedIn === true;
    case 'marketing-opt-out':
      if (inputs.globalOptOut) return false;
      if (inputs.addressPreference && !inputs.addressPreference.optedIn) {
        return false;
      }
      if (inputs.userPreference && !inputs.userPreference.optedIn) {
        return false;
      }
      return true;
    default: {
      // Defense in depth: TS exhaustiveness already guards compile time, but a
      // future widening of `ConsentPolicy` (or a ConvexError deserialization
      // path that bypasses the type) must fail loudly instead of silently
      // returning `undefined` and tripping a truthy coerce at the call site.
      const _exhaustive: never = policy;
      throw new Error(
        `Unhandled consent policy: ${String((_exhaustive as {kind?: string}).kind)}`,
      );
    }
  }
}
