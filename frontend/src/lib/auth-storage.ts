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
 * value. The synchronous session peek reads the same state, but through the
 * plugin's own `getCookie()` / `getSessionData()` client actions rather than
 * touching localStorage directly — so the peek can never disagree with what the
 * plugin would actually send on a request. Keep this prefix in lockstep with
 * the plugin config: a divergent prefix silently breaks the optimistic gate.
 */
export const BETTER_AUTH_STORAGE_PREFIX = 'braket-tickets';

/** Minimal cached session snapshot the app relies on for optimistic render. */
export interface CachedBetterAuthSession {
  user: {email: string; name?: string; image?: string | null};
  session?: {id?: string | null} | null;
}

/**
 * Result of synchronously peeking at the persisted Better Auth state.
 *
 * `known` is false whenever we cannot decide auth state from storage alone —
 * i.e. cookie/E2E mode (credential is an httpOnly cookie invisible to JS, so
 * the crossDomain plugin is not registered and its client actions are absent).
 * Callers must fall back to the authoritative async `getSession()` in that case.
 */
export interface CachedSessionPeek {
  known: boolean;
  /** Whether a non-empty credential is present in storage. */
  hasCredential: boolean;
  /** Cached user snapshot from the last `getSession`, when parseable. */
  session: CachedBetterAuthSession | null;
}

/**
 * Narrows the plugin's `getSessionData()` output into the minimal snapshot the
 * optimistic gate needs. The plugin already returns `null` for `{}`/corrupt
 * data; this only enforces the `user.email` shape the app reads. Anything else
 * (missing user, non-string email) is treated as no usable snapshot — the async
 * `getSession()` settle remains the authority.
 */
export function narrowCachedSession(
  data: Record<string, unknown> | null,
): CachedBetterAuthSession | null {
  if (!isRecord(data)) {
    return null;
  }

  const user = data['user'];
  if (!isRecord(user) || typeof user['email'] !== 'string') {
    return null;
  }

  return data as unknown as CachedBetterAuthSession;
}
