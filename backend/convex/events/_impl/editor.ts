import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {requireEventForEdit} from '../../lib/access';

/**
 * Resolve the authenticated caller and an event they are authorized to edit.
 *
 * Delegates to {@link requireEventForEdit} for the canonical
 * "authenticate → load → authorize" preamble so the null-check and
 * permission gate cannot drift from the shared implementation.
 *
 * The `db` parameter is accepted for backward compatibility with existing
 * callers but is no longer used — `requireEventForEdit` reads from `ctx.db`.
 */
export async function resolveEditableEventForCaller(
  ctx: QueryCtx | MutationCtx,
  _db: QueryCtx['db'],
  eventId: Id<'events'>,
): Promise<{userId: Id<'users'>; user: Doc<'users'>; event: Doc<'events'>}> {
  const {user, event} = await requireEventForEdit(ctx, eventId);
  return {userId: user._id, user, event};
}

export function pruneNoopEventPatch(
  event: Doc<'events'>,
  patch: Partial<Doc<'events'>>,
): Partial<Doc<'events'>> {
  const pruned: Partial<Doc<'events'>> = {};
  for (const key of Object.keys(patch) as Array<keyof Doc<'events'>>) {
    const nextValue = patch[key];
    if (nextValue === undefined) continue;
    if (event[key] !== nextValue) {
      (pruned as Record<string, unknown>)[key] = nextValue;
    }
  }
  return pruned;
}
