import {components} from '../_generated/api';
import type {ActionCtx, MutationCtx} from '../_generated/server';
import {isRecord} from '@shared/type-guards';

type AdapterCtx =
  | Pick<ActionCtx, 'runQuery' | 'runMutation'>
  | Pick<MutationCtx, 'runQuery' | 'runMutation'>;

type AdapterWhere = {
  field: string;
  operator?: string;
  value: unknown;
};

/**
 * Better Auth adapter APIs are currently generated with opaque arg/result types.
 * Centralize the required type escape in one place and validate runtime shape.
 */
export async function adapterFindMany(
  ctx: AdapterCtx,
  input: {
    model: string;
    where?: AdapterWhere[];
    paginationOpts: {numItems: number; cursor: string | null};
  },
): Promise<Record<string, unknown>[]> {
  const result = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    input as never,
  );
  if (!isRecord(result)) return [];
  const page = result['page'];
  if (!Array.isArray(page)) return [];
  return page.filter(isRecord);
}

export async function adapterFindOne(
  ctx: AdapterCtx,
  input: {
    model: string;
    where: AdapterWhere[];
  },
): Promise<Record<string, unknown> | null> {
  const result = await ctx.runQuery(
    components.betterAuth.adapter.findOne,
    input as never,
  );
  return isRecord(result) ? result : null;
}

export async function adapterDeleteOne(
  ctx: AdapterCtx,
  input: {
    model: string;
    where: AdapterWhere[];
  },
): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
    input,
  } as never);
}

export async function adapterUpdateOne(
  ctx: AdapterCtx,
  input: {
    model: string;
    where: AdapterWhere[];
    update: Record<string, unknown>;
  },
): Promise<void> {
  await ctx.runMutation(components.betterAuth.adapter.updateOne, {
    input,
  } as never);
}
