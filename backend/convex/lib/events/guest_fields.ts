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
 * Runs the shared {@link validateGuestFields} rules — which apply the
 * deliberately lenient `@`-presence + length email check the guest / imported
 * paths share (see {@link validateOptionalEmailWithAt}) — then trims the email
 * so the stored value matches what scheduling and broadcast audience lookups
 * use downstream. Both the single-add and update mutations call this so the
 * rule cannot drift between paths.
 *
 * The guest paths intentionally do NOT apply the strict RFC-style
 * `validateEmail` regex: guest emails are optional and frequently pasted
 * from external sources, and the strict regex rejects legitimate-but-unusual
 * addresses (e.g. `user@localhost`) the product accepts through the admin UI.
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

  return args.email?.trim() || undefined;
}
