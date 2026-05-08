/**
 * Shared log sanitizer for frontend, Convex backend, and ops logging.
 *
 * Keep PII field matching and string redaction centralized so every runtime
 * scrubs the same data classes.
 */

export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_FIELD_PATTERNS = [
  // Authentication & Authorization
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'authToken',
  'apiKey',
  'apiSecret',
  'secret',
  'secretKey',
  'privateKey',
  'credential',
  'credentials',
  // Personal Identifiable Information (PII)
  'email',
  'phone',
  'phoneNumber',
  'ssn',
  'socialSecurity',
  'dob',
  'dateOfBirth',
  'address',
  'street',
  'creditCard',
  'cardNumber',
  'cvv',
  'iban',
  'accountNumber',
  'routingNumber',
  // Session & Security
  'sessionId',
  'sessionToken',
  'csrfToken',
  'xsrfToken',
  'nonce',
  // Payment
  'paymentToken',
  'cardToken',
  'sourceId',
  // Convex specific
  'convexToken',
  'adminKey',
];

const KEY_PART_PATTERN = /[A-Z]+(?=[A-Z][a-z]|\b)|[A-Z]?[a-z]+|\d+/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const US_PHONE_PATTERN =
  /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}/g;
const CARD_NUMBER_CANDIDATE_PATTERN = /\b(?:\d[ -]?){12,18}\d\b/g;
const STRIPE_SECRET_PATTERN = /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]+\b/g;
const STRIPE_WEBHOOK_SECRET_PATTERN = /\bwhsec_[A-Za-z0-9_]+\b/g;
const LABELED_SECRET_VALUE_PATTERN =
  /\b(token|secret|api[_ -]?key|authorization|bearer)(\s*[:=]?\s+)([A-Za-z0-9._~+/=-]{8,})\b/gi;

const NORMALIZED_SENSITIVE_FIELD_PATTERNS = SENSITIVE_FIELD_PATTERNS.map(
  (pattern) => normalizeKeyParts(pattern),
);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeKeyParts(key) {
  return key
    .split(/[^a-zA-Z0-9]+/)
    .flatMap((segment) => segment.match(KEY_PART_PATTERN) ?? [])
    .map((part) => part.toLowerCase());
}

function containsContiguousKeyParts(keyParts, patternParts) {
  if (patternParts.length === 0 || patternParts.length > keyParts.length) {
    return false;
  }

  for (
    let index = 0;
    index <= keyParts.length - patternParts.length;
    index += 1
  ) {
    const matches = patternParts.every(
      (part, offset) => keyParts[index + offset] === part,
    );
    if (matches) {
      return true;
    }
  }

  return false;
}

function isSensitiveKey(key) {
  const normalizedKey = normalizeKey(key);
  const keyParts = normalizeKeyParts(key);
  if (keyParts.length === 0) {
    return false;
  }

  return NORMALIZED_SENSITIVE_FIELD_PATTERNS.some((patternParts) => {
    if (containsContiguousKeyParts(keyParts, patternParts)) {
      return true;
    }

    return patternParts.length > 1 && normalizedKey === patternParts.join('');
  });
}

function isLuhnValid(raw) {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const charCode = digits.charCodeAt(i) - 48;
    if (charCode < 0 || charCode > 9) {
      return false;
    }

    let digit = charCode;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

export function sanitizeString(value) {
  const withCommonPiiRedacted = value
    .replace(EMAIL_PATTERN, REDACTED_VALUE)
    .replace(SSN_PATTERN, REDACTED_VALUE)
    .replace(US_PHONE_PATTERN, REDACTED_VALUE)
    .replace(STRIPE_SECRET_PATTERN, REDACTED_VALUE)
    .replace(STRIPE_WEBHOOK_SECRET_PATTERN, REDACTED_VALUE)
    .replace(
      LABELED_SECRET_VALUE_PATTERN,
      (_match, label, separator) => `${label}${separator}${REDACTED_VALUE}`,
    );

  return withCommonPiiRedacted.replace(
    CARD_NUMBER_CANDIDATE_PATTERN,
    (match) => (isLuhnValid(match) ? REDACTED_VALUE : match),
  );
}

export function sanitize(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Error) {
    const sanitized = new Error(sanitizeString(value.message));
    sanitized.name = value.name;
    if (value.stack) {
      sanitized.stack = sanitizeString(value.stack);
    }
    for (const key of Object.keys(value)) {
      const rawFieldValue = Reflect.get(value, key);
      const sanitizedFieldValue = isSensitiveKey(key)
        ? REDACTED_VALUE
        : sanitize(rawFieldValue);
      Reflect.set(sanitized, key, sanitizedFieldValue);
    }
    return sanitized;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  if (value instanceof Map) {
    const sanitized = new Map();
    for (const [key, val] of value) {
      sanitized.set(sanitize(key), sanitize(val));
    }
    return sanitized;
  }

  if (value instanceof Set) {
    const sanitized = new Set();
    for (const item of value) {
      sanitized.add(sanitize(item));
    }
    return sanitized;
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags);
  }

  if (isRecord(value)) {
    const sanitized = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[key] = isSensitiveKey(key) ? REDACTED_VALUE : sanitize(val);
    }
    return sanitized;
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  return value;
}
