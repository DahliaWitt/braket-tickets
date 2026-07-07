import {isRecord} from '@shared/type-guards';

/**
 * Storage prefix for the Better Auth crossDomain client plugin.
 *
 * The plugin persists two localStorage keys under this prefix:
 *   - `${prefix}_cookie`       — the session credential (a JSON cookie map).
 *                                In crossDomain mode the request runs with
 *                                `credentials: "omit"`, so this value *is* the
 *                                credential, sent as a `Better-Auth-Cookie`
 *                                header. On logout the plugin sets it to `{}`.
 *   - `${prefix}_session_data` — the cached `/get-session` response snapshot
 *                                (`{ user, session }` or `{}`/absent).
 *
 * Single source of truth: `auth.client.ts` configures the plugin with this
 * value, and the synchronous session peek reads the same keys. Keep them in
 * lockstep — a divergent prefix silently breaks the optimistic auth gate.
 */
export const BETTER_AUTH_STORAGE_PREFIX = 'braket-tickets';

export function authCookieStorageKey(
  prefix: string = BETTER_AUTH_STORAGE_PREFIX,
): string {
  return `${prefix}_cookie`;
}

export function authSessionDataStorageKey(
  prefix: string = BETTER_AUTH_STORAGE_PREFIX,
): string {
  return `${prefix}_session_data`;
}

/** Minimal cached session snapshot the app relies on for optimistic render. */
export interface CachedBetterAuthSession {
  user: {email: string; name?: string; image?: string | null};
  session?: {id?: string | null} | null;
}

/**
 * Result of synchronously peeking at the persisted Better Auth state.
 *
 * `known` is false whenever we cannot decide auth state from storage alone —
 * i.e. cookie/E2E mode (credential is an httpOnly cookie invisible to JS) or a
 * corrupted credential value. Callers must fall back to the authoritative
 * async `getSession()` settle in that case.
 */
export interface CachedSessionPeek {
  known: boolean;
  /** Whether a non-empty credential is present in storage. */
  hasCredential: boolean;
  /** Cached user snapshot from the last `getSession`, when parseable. */
  session: CachedBetterAuthSession | null;
}

const UNKNOWN: CachedSessionPeek = {
  known: false,
  hasCredential: false,
  session: null,
};

/**
 * Interprets the raw persisted crossDomain values into a synchronous peek.
 *
 * `hasCredential` is true only when at least one stored cookie entry could
 * actually authenticate: a record with a non-empty string `value` that is not
 * expired. This mirrors the plugin's own `getCookie()`, which drops expired
 * entries before sending the `Better-Auth-Cookie` header — so an all-expired
 * credential (the lapsed-user case) provably behaves as logged out: the plugin
 * itself would send nothing usable. Both checks use the same client clock, so
 * clock skew cannot make the peek disagree with what the plugin would send.
 *
 * Corrupted credential JSON (not parseable as an object) yields `known: false`
 * so callers never fast-path on an unreadable state.
 *
 * @param cookieRaw - Raw `${prefix}_cookie` value, or null when absent.
 * @param sessionRaw - Raw `${prefix}_session_data` value, or null when absent.
 * @param nowMs - Clock for expiry checks; defaults to `Date.now()`.
 */
export function interpretAuthStorage(
  cookieRaw: string | null,
  sessionRaw: string | null,
  nowMs: number = Date.now(),
): CachedSessionPeek {
  let hasCredential: boolean;

  if (cookieRaw === null) {
    hasCredential = false;
  } else {
    let cookieParsed: unknown;
    try {
      cookieParsed = JSON.parse(cookieRaw);
    } catch {
      return UNKNOWN;
    }
    if (!isRecord(cookieParsed)) {
      return UNKNOWN;
    }
    hasCredential = Object.values(cookieParsed).some((entry) =>
      isUsableCredentialEntry(entry, nowMs),
    );
  }

  return {
    known: true,
    hasCredential,
    session: parseCachedSession(sessionRaw),
  };
}

/**
 * Whether a stored cookie entry could authenticate a request. Mirrors the
 * plugin's `getCookie()` filter (expired entries are dropped) plus a non-empty
 * string `value` requirement — an entry the plugin would serialize as
 * `key=`/`key=undefined` cannot validate server-side, so treating it as
 * no-credential is still provable, never optimistic.
 */
function isUsableCredentialEntry(entry: unknown, nowMs: number): boolean {
  if (!isRecord(entry)) {
    return false;
  }

  const value = entry['value'];
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  const expires = entry['expires'];
  if (typeof expires === 'string') {
    const expiresMs = Date.parse(expires);
    if (!Number.isNaN(expiresMs) && expiresMs < nowMs) {
      return false;
    }
  }

  return true;
}

function parseCachedSession(
  raw: string | null,
): CachedBetterAuthSession | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const user = parsed['user'];
  if (!isRecord(user) || typeof user['email'] !== 'string') {
    return null;
  }

  return parsed as unknown as CachedBetterAuthSession;
}
