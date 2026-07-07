import type {injectConvex} from 'convex-angular';
import {
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from 'convex/server';
import {type MutationOptions} from 'convex/browser';

export type SessionChannelMessage = {type: 'LOGIN'} | {type: 'LOGOUT'};

export type ConvexClientWithErrorHandling = ReturnType<typeof injectConvex> & {
  __braketAuthWrapped?: boolean;
};

export type ConvexQueryMethod = <Query extends FunctionReference<'query'>>(
  this: ConvexClientWithErrorHandling,
  query: Query,
  args: Query['_args'],
) => Promise<Awaited<Query['_returnType']>>;

export type ConvexMutationMethod = <
  Mutation extends FunctionReference<'mutation'>,
>(
  this: ConvexClientWithErrorHandling,
  mutation: Mutation,
  args: FunctionArgs<Mutation>,
  options?: MutationOptions,
) => Promise<Awaited<FunctionReturnType<Mutation>>>;

export type ConvexActionMethod = <Action extends FunctionReference<'action'>>(
  this: ConvexClientWithErrorHandling,
  action: Action,
  args: FunctionArgs<Action>,
) => Promise<Awaited<FunctionReturnType<Action>>>;

function isSessionMessageType(
  value: unknown,
): value is SessionChannelMessage['type'] {
  return value === 'LOGIN' || value === 'LOGOUT';
}

export function isValidSessionMessage(
  data: unknown,
): data is SessionChannelMessage {
  if (typeof data !== 'object' || data === null) return false;
  if (!Object.hasOwn(data, 'type')) return false;
  return isSessionMessageType(Reflect.get(data, 'type'));
}
