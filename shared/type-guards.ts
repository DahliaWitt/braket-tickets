/**
 * Shared type guards for frontend and Convex backend.
 *
 * Centralize narrowing utilities so both runtimes use the same predicates.
 * Import via `@shared/type-guards`.
 */

/**
 * Narrows `unknown` to `Record<string, unknown>`.
 *
 * Returns `false` for `null`, arrays, primitives, and functions.
 * Use this instead of ad-hoc `typeof === 'object' && !== null` guards.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
