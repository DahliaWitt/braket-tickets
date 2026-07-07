import type {ActionCtx, MutationCtx} from '../_generated/server';
import {isUnitTestRuntime} from './environment';
import {logger} from './logger';

export type SafeRequestMetadata = {
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly scheduledFunctionId: string | null;
};

/** Audit-row request fields, normalized from `null` to omitted-when-absent. */
export type AuditRequestFields = {ipAddress?: string; userAgent?: string};

const EMPTY_METADATA: SafeRequestMetadata = Object.freeze({
  ip: null,
  userAgent: null,
  requestId: null,
  scheduledFunctionId: null,
});

/**
 * `ctx.meta.getRequestMetadata()` with a safe fallback for runtimes that do
 * not implement it (convex-test as of 0.0.54 shims `getFunctionMetadata` but
 * not `getRequestMetadata`).
 *
 * The returned `ip`/`userAgent` are platform-provided — unlike the
 * `x-forwarded-for`/`x-real-ip` headers parsed in `http/_impl/request_parsing.ts`
 * they cannot be spoofed by the client. Both are `null` for scheduled and cron
 * executions; metadata propagates through nested `runMutation`/`runAction`
 * calls but NOT through `ctx.scheduler` — capture before scheduling when an
 * audit trail needs it.
 */
export async function getRequestMetadataSafe(
  ctx: Pick<MutationCtx, 'meta'> | Pick<ActionCtx, 'meta'>,
): Promise<SafeRequestMetadata> {
  try {
    return await ctx.meta.getRequestMetadata();
  } catch (error) {
    // convex-test is the only runtime that reaches here — it does not implement
    // the getRequestMetadata syscall, so it throws on every call. Real
    // deployments support it, so a throw there is unexpected and worth
    // surfacing; keep quiet under vitest to avoid flooding the suite.
    if (!isUnitTestRuntime()) {
      logger.debug(
        'request_metadata',
        'getRequestMetadata() unavailable; using empty fallback',
        error,
      );
    }
    return EMPTY_METADATA;
  }
}

/**
 * Request metadata shaped for admin audit rows: `null` values from
 * `getRequestMetadataSafe` become omitted keys, so spreading the result sets a
 * field only when a real value exists. Fetch once per handler and reuse across
 * repeated inserts to avoid re-invoking the syscall in loops.
 */
export async function getAuditRequestFields(
  ctx: Pick<MutationCtx, 'meta'> | Pick<ActionCtx, 'meta'>,
): Promise<AuditRequestFields> {
  const {ip, userAgent} = await getRequestMetadataSafe(ctx);
  return {
    ...(ip !== null ? {ipAddress: ip} : {}),
    ...(userAgent !== null ? {userAgent} : {}),
  };
}
