import type {ActionCtx, MutationCtx} from '../_generated/server';

export type SafeRequestMetadata = {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  scheduledFunctionId: string | null;
};

const EMPTY_METADATA: SafeRequestMetadata = {
  ip: null,
  userAgent: null,
  requestId: null,
  scheduledFunctionId: null,
};

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
  } catch {
    return EMPTY_METADATA;
  }
}
