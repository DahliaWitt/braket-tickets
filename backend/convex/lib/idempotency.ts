/**
 * Shared contract for caller-supplied idempotency and import-batch keys.
 *
 * Public callers fully control these values. Keeping one small URL-safe policy
 * prevents oversized or malformed strings from reaching indexes and persisted
 * documents while allowing each domain to map failures to its own error code.
 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 64;

const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]+$/;

export function getIdempotencyKeyValidationError(
  value: string,
  label = 'Idempotency key',
): string | null {
  if (value.trim().length === 0) {
    return `${label} must not be blank`;
  }
  if (value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return `${label} exceeds maximum length of ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`;
  }
  if (!IDEMPOTENCY_KEY_REGEX.test(value)) {
    return `${label} is malformed`;
  }
  return null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

/**
 * Produces a deterministic, URL-safe SHA-256 key for composite internal
 * idempotency identities. JSON array encoding keeps component boundaries
 * unambiguous, and the 64-character hexadecimal digest fits the public key
 * policy without lossy truncation.
 */
export async function deriveIdempotencyKey(
  namespace: string,
  parts: readonly string[],
): Promise<string> {
  const payload = JSON.stringify([namespace, ...parts]);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return bytesToHex(new Uint8Array(digest));
}
