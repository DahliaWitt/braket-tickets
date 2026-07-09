/**
 * Single source of truth for guest field validation.
 *
 * The single-add mutation (`events/_impl/guests.ts`), the guest bulk-add
 * mutation, and the test seed helper (`testing/guests.ts`) all validate guest
 * fields through this helper so the rules — including the shared `@`-presence
 * email check — cannot drift between paths.
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
