import {components} from '../_generated/api';
import type {ActionCtx, MutationCtx} from '../_generated/server';
import type {FunctionArgs} from 'convex/server';
import {isRecord} from '@shared/type-guards';

type AdapterCtx =
  | Pick<ActionCtx, 'runQuery' | 'runMutation'>
  | Pick<MutationCtx, 'runQuery' | 'runMutation'>;

/**
 * Thin wrappers over the Better Auth component's adapter functions.
 *
 * Argument types are pulled straight from the generated component API
 * (`FunctionArgs<typeof components.betterAuth.adapter.*>`) so this module stays
 * locked to the component contract: the `model` literal union, the per-model
 * `where`/`update` shapes, the where-clause operator/mode unions, and the
 * pagination options are all enforced by the compiler. No argument casts are
 * needed — callers pass a concrete model literal and the discriminated arg
 * union narrows automatically.
 *
 * Only the component's *result* types are `any`, so each helper still validates
 * the returned shape at runtime before handing it back to callers.
 */
type FindManyArgs = FunctionArgs<typeof components.betterAuth.adapter.findMany>;
type FindOneArgs = FunctionArgs<typeof components.betterAuth.adapter.findOne>;
type UpdateOneInput = FunctionArgs<
  typeof components.betterAuth.adapter.updateOne
>['input'];
type DeleteOneInput = FunctionArgs<
  typeof components.betterAuth.adapter.deleteOne
>['input'];

export async function adapterFindMany(
  ctx: AdapterCtx,
  input: FindManyArgs,
): Promise<Record<string, unknown>[]> {
  const result = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    input,
  );
  if (!isRecord(result)) return [];
  const page = result['page'];
  if (!Array.isArray(page)) return [];
  return page.filter(isRecord);
}

export async function adapterFindOne(
  ctx: AdapterCtx,
  input: FindOneArgs,
): Promise<Record<string, unknown> | null> {
  const result = await ctx.runQuery(
    components.betterAuth.adapter.findOne,
    input,
  );
  return isRecord(result) ? result : null;
}

export async function adapterDeleteOne(
  ctx: AdapterCtx,
  input: DeleteOneInput,
): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, {input});
}

export async function adapterUpdateOne(
  ctx: AdapterCtx,
  input: UpdateOneInput,
): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.updateOne, {input});
}
