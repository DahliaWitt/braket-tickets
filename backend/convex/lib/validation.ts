/**
 * Input Validation Constants and Utilities
 *
 * Centralized validation limits to prevent storage abuse and DoS attacks.
 * All string fields should be validated against these limits before database insertion.
 */
import type {Doc} from '../_generated/dataModel';
import {ErrorMessages, throwInvalidInput} from './errors';
import {parseUtcInstant} from '@shared/event-time';
export {MAX_COMMUNITY_SLUG_LENGTH} from '@shared/domain/community-slug';
export {
  MAX_EVENT_TITLE_LENGTH,
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
} from '../../../shared/constants';

// User-related limits (already in users.ts, duplicated here for reference)
export const MAX_NAME_LENGTH = 100;

// Event-related limits
export const MAX_EVENT_DESCRIPTION_LENGTH = 5000;
export const MAX_EVENT_LOCATION_LENGTH = 500;

// Guest-related limits
export const MAX_GUEST_NAME_LENGTH = 200;
export const MAX_GUEST_EMAIL_LENGTH = 254; // RFC 5321
export const MAX_GUEST_NOTES_LENGTH = 1000;

// Community-related limits
export const MAX_COMMUNITY_NAME_LENGTH = 200;
export const MAX_COMMUNITY_EMAIL_LENGTH = 254;
export const MAX_COMMUNITY_CONTACT_LENGTH = 500;
export const MAX_VETTING_QUESTION_LENGTH = 1000;
export const MAX_VETTING_OPTION_LENGTH = 200;
export const MAX_COMMUNITY_DESCRIPTION_LENGTH = 2000;
export const MAX_COMMUNITY_WEBSITE_LENGTH = 2048;
export const MAX_CODE_OF_CONDUCT_LENGTH = 50000;

// Application-related limits
export const MAX_PASSWORD_LENGTH = 72; // bcrypt limit (passwords truncated silently beyond 72 chars)
export const MAX_EMAIL_LENGTH = 254; // RFC 5321
export const MAX_CALLBACK_URL_LENGTH = 2048;
export const MAX_ANSWER_STRING_LENGTH = 10000;
export const MAX_ANSWER_ARRAY_ITEMS = 50;
export const MAX_REASON_LENGTH = 500;

/**
 * Strips HTML tags from a string and trims whitespace.
 * Used for defense-in-depth on user-supplied name fields — Angular escapes
 * on render, but we also sanitize at the storage boundary.
 */
export function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

/**
 * Sanitizes a user display name: strips HTML tags, trims, and enforces MAX_NAME_LENGTH.
 * Returns undefined if the result is empty after sanitization.
 */
export function sanitizeName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = stripHtmlTags(value);
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, MAX_NAME_LENGTH);
}

/**
 * Validates a string field against a maximum length.
 * @throws Error if the string exceeds the maximum length
 */
export function validateStringLength(
  value: string | undefined | null,
  fieldName: string,
  maxLength: number,
): void {
  if (value && value.length > maxLength) {
    throwInvalidInput(
      `${fieldName} exceeds maximum length of ${maxLength} characters`,
      {fieldName, maxLength},
    );
  }
}

/**
 * Validates an array field against maximum item count and item length.
 * @throws Error if validation fails
 */
export function validateArrayField(
  value: (string | boolean | number)[] | undefined | null,
  fieldName: string,
  maxItems: number,
  maxItemLength: number,
): void {
  if (!value) return;
  if (value.length > maxItems) {
    throwInvalidInput(`${fieldName} exceeds maximum of ${maxItems} items`, {
      fieldName,
      maxItems,
    });
  }
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item === 'string' && item.length > maxItemLength) {
      throwInvalidInput(
        `${fieldName}[${i}] exceeds maximum length of ${maxItemLength} characters`,
        {fieldName, maxItemLength, itemIndex: i},
      );
    }
  }
}

/**
 * Validates application answers object.
 * @throws Error if any answer exceeds limits
 */
// Maximum number of answer keys per application (prevents DoS via massive objects)
export const MAX_ANSWER_KEYS = 50;

export function validateApplicationAnswers(
  answers: Record<string, string | string[] | boolean | number>,
): void {
  // SECURITY: Limit total number of answer keys to prevent storage abuse
  const keyCount = Object.keys(answers).length;
  if (keyCount > MAX_ANSWER_KEYS) {
    throwInvalidInput(`Too many answer fields: maximum is ${MAX_ANSWER_KEYS}`, {
      maxAnswerKeys: MAX_ANSWER_KEYS,
    });
  }

  for (const [key, value] of Object.entries(answers)) {
    if (typeof value === 'string') {
      validateStringLength(value, `Answer "${key}"`, MAX_ANSWER_STRING_LENGTH);
    } else if (Array.isArray(value)) {
      validateArrayField(
        value as (string | boolean | number)[],
        `Answer "${key}"`,
        MAX_ANSWER_ARRAY_ITEMS,
        MAX_ANSWER_STRING_LENGTH,
      );
    }
    // boolean and number don't need length validation
  }
}

type VettingQuestion = NonNullable<
  Doc<'organizers'>['vettingQuestions']
>[number];

const APPLICATION_METADATA_KEYS = new Set(['source']);

function isAnswerEmpty(value: string | string[] | boolean | number): boolean {
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function requireStringAnswer(
  question: VettingQuestion,
  value: string | string[] | boolean | number,
): string | null {
  if (typeof value !== 'string') {
    throwInvalidInput(`Answer "${question.id}" must be text`, {
      fieldName: question.id,
    });
  }
  if (question.required && value.trim().length === 0) {
    throwInvalidInput(`Answer "${question.id}" is required`, {
      fieldName: question.id,
    });
  }
  return value.trim().length === 0 ? null : value;
}

function getQuestionOptions(question: VettingQuestion): Set<string> {
  if (!question.options || question.options.length === 0) {
    throwInvalidInput(`Question "${question.id}" has no valid options`, {
      fieldName: question.id,
    });
  }
  return new Set(question.options);
}

function validateSingleChoiceAnswer(
  question: VettingQuestion,
  value: string | string[] | boolean | number,
): void {
  const answer = requireStringAnswer(question, value);
  if (answer === null) return;

  const options = getQuestionOptions(question);
  if (!options.has(answer)) {
    throwInvalidInput(`Answer "${question.id}" is not a valid option`, {
      fieldName: question.id,
    });
  }
}

function validateMultiChoiceAnswer(
  question: VettingQuestion,
  value: string | string[] | boolean | number,
): void {
  if (!Array.isArray(value)) {
    throwInvalidInput(`Answer "${question.id}" must be a list of options`, {
      fieldName: question.id,
    });
  }
  if (question.required && value.length === 0) {
    throwInvalidInput(`Answer "${question.id}" is required`, {
      fieldName: question.id,
    });
  }
  if (value.length === 0) return;

  const options = getQuestionOptions(question);
  const invalidOption = value.find((option) => !options.has(option));
  if (invalidOption !== undefined) {
    throwInvalidInput(`Answer "${question.id}" contains an invalid option`, {
      fieldName: question.id,
      option: invalidOption,
    });
  }
}

function validateBooleanAnswer(
  question: VettingQuestion,
  value: string | string[] | boolean | number,
): void {
  if (typeof value === 'boolean') return;
  if (!question.required && isAnswerEmpty(value)) return;
  throwInvalidInput(`Answer "${question.id}" must be true or false`, {
    fieldName: question.id,
  });
}

function validateAnswerForQuestion(
  question: VettingQuestion,
  value: string | string[] | boolean | number,
): void {
  switch (question.type) {
    case 'text':
    case 'long_text':
      requireStringAnswer(question, value);
      return;
    case 'select':
      validateSingleChoiceAnswer(question, value);
      return;
    case 'checkbox':
      validateMultiChoiceAnswer(question, value);
      return;
    case 'boolean':
      validateBooleanAnswer(question, value);
      return;
  }
}

export function validateApplicationAnswersForVettingQuestions(
  answers: Record<string, string | string[] | boolean | number>,
  questions: readonly VettingQuestion[],
): void {
  validateApplicationAnswers(answers);

  const questionById = new Map<string, VettingQuestion>();
  for (const question of questions) {
    if (questionById.has(question.id)) {
      throwInvalidInput(`Duplicate vetting question id "${question.id}"`, {
        fieldName: question.id,
      });
    }
    questionById.set(question.id, question);
  }

  for (const [key, value] of Object.entries(answers)) {
    if (APPLICATION_METADATA_KEYS.has(key)) {
      if (typeof value !== 'string') {
        throwInvalidInput(`Answer metadata "${key}" must be text`, {
          fieldName: key,
        });
      }
      continue;
    }

    const question = questionById.get(key);
    if (!question) {
      throwInvalidInput(`Unknown answer field "${key}"`, {fieldName: key});
    }
    validateAnswerForQuestion(question, value);
  }

  for (const question of questions) {
    if (!question.required) continue;
    const answer = answers[question.id];
    if (answer === undefined || isAnswerEmpty(answer)) {
      throwInvalidInput(`Answer "${question.id}" is required`, {
        fieldName: question.id,
      });
    }
  }
}

/**
 * Validates that a number is non-negative.
 * @throws Error if validation fails
 */
export function validateNonNegative(
  value: number | undefined | null,
  fieldName: string,
  zeroAllowed = false,
): void {
  if (value === undefined || value === null) return;
  if (value < 0) {
    throwInvalidInput(`${fieldName} cannot be negative`, {fieldName});
  }
  if (!zeroAllowed && value === 0) {
    throwInvalidInput(`${fieldName} cannot be zero`, {fieldName});
  }
}

/**
 * RFC 5322 compliant email validation regex (simplified, practical version).
 * Allows common valid emails while rejecting obvious garbage.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates an email address format and length.
 * @throws ConvexError if email is invalid
 */
export function validateEmail(email: string, fieldName = 'Email'): void {
  validateStringLength(email, fieldName, MAX_EMAIL_LENGTH);
  if (!EMAIL_REGEX.test(email)) {
    throwInvalidInput(`${fieldName} is invalid`, {fieldName});
  }
}

/**
 * Validates that a numeric value is an integer (not a float).
 */
export function validateInteger(
  value: number | undefined | null,
  fieldName: string,
): void {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value)) {
    throwInvalidInput(`${fieldName} must be a whole number`, {fieldName});
  }
}

/**
 * Normalizes an email address for case-insensitive comparisons and index
 * lookups. Trim handles whitespace that slips through copy-paste or guest
 * checkout forms — `emailAddressMarketingPreferences` writes via the trimmed
 * form, so any call site that only lowercased could silently miss a matching
 * preference row.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Nullable variant of {@link normalizeEmail}. Returns `null` for
 * null/undefined/empty/whitespace-only input so callers can replace the
 * "trim, check length, lowercase" pattern with a single truthy check.
 *
 * Used by audience/consent codepaths that iterate mixed user/guest records
 * where `email` may be missing. The strict {@link normalizeEmail} stays the
 * preferred form when the caller already knows the value is a non-empty
 * string (auth, migrations, admin invites).
 */
export function normalizeEmailOrNull(
  email: string | null | undefined,
): string | null {
  if (!email) return null;
  const normalized = normalizeEmail(email);
  return normalized.length > 0 ? normalized : null;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Validates that a string is a valid ISO 8601 UTC date string.
 * Rejects human-readable formats (e.g., "Dec 15, 2030") that would silently
 * corrupt index sort order on the by_status_date index.
 * @throws ConvexError if the value fails regex or strict UTC instant parsing
 */
export function validateISODate(value: string, field = 'date'): void {
  if (!ISO_DATE_REGEX.test(value) || parseUtcInstant(value) === null) {
    throwInvalidInput(
      ErrorMessages.INVALID_INPUT(
        field,
        'must be a valid ISO 8601 UTC date string (e.g., 2030-12-15T20:00:00.000Z)',
      ),
      {fieldName: field},
    );
  }
}
