/**
 * Single source of truth for guest field validation.
 *
 * The single-add and update mutations (`events/_impl/guests.ts`), the guest
 * bulk-add mutation, and the test seed helper (`testing/guests.ts`) all
 * validate guest fields through this module so the rules — including the shared
 * `@`-presence email check — cannot drift between paths.
 */
import {
  MAX_GUEST_EMAIL_LENGTH,
  MAX_GUEST_NAME_LENGTH,
  MAX_GUEST_NOTES_LENGTH,
  validateEmail,
  validateOptionalEmailWithAt,
  validateRequiredString,
  validateStringLength,
} from '../validation';

/**
 * Validates a guest's name, email, and notes against the shared rules: name is
 * required and length-capped, email is optional with an `@`-presence + length
 * check, notes are length-capped.
 * @throws ConvexError on the first field that fails.
 */
export function validateGuestFields(args: {
  name: string;
  email?: string;
  notes?: string;
}): void {
  validateRequiredString(args.name, 'Name');
  validateStringLength(args.name, 'Name', MAX_GUEST_NAME_LENGTH);
  validateOptionalEmailWithAt(args.email, MAX_GUEST_EMAIL_LENGTH, 'Email');
  validateStringLength(args.notes, 'Notes', MAX_GUEST_NOTES_LENGTH);
}

/**
 * Validates all guest fields and returns the trimmed email to persist.
 *
 * Runs the shared {@link validateGuestFields} rules, then trims the email and
 * applies the strict RFC format check. Both the single-add and update mutations
 * call this so neither can persist a malformed or untrimmed email: the stored
 * value later drives broadcast and ticket sends, and a non-address string would
 * enqueue a delivery that can never succeed (permanently consuming its
 * per-segment dedup slot) — exactly the outcome this guard prevents on direct
 * API calls that bypass the admin UI's own validation.
 *
 * @returns the trimmed email, or `undefined` when no email was provided
 * @throws ConvexError on the first field that fails
 */
export function validateGuestFieldsAndNormalizeEmail(args: {
  name: string;
  email?: string;
  notes?: string;
}): string | undefined {
  validateGuestFields(args);

  const trimmedEmail = args.email?.trim();
  if (trimmedEmail) {
    validateEmail(trimmedEmail, 'Email');
  }
  return trimmedEmail || undefined;
}
