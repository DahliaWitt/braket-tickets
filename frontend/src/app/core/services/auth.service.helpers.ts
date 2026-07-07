import type {injectConvex} from 'convex-angular';
import {
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from 'convex/server';
import {type MutationOptions} from 'convex/browser';

export type SessionChannelMessage = {type: 'LOGIN'} | {type: 'LOGOUT'};

/**
 * Hard upper bound for the auth-settled wait. If auth never reaches a decidable
 * state (Convex WebSocket died mid-handshake, browser offline during cold load,
 * profile query hung with a live session) the route guards would otherwise wait
 * forever. Shared by `waitForAuthSettled$` (guards) and the optimistic
 * reconciliation (AuthService) so both bail on the same budget. 15s is
 * comfortably above the normal cold-connect budget for Convex + Better Auth +
 * user profile sync.
 */
export const AUTH_SETTLE_TIMEOUT_MS = 15_000;

/**
 * Minimal shape auth guards and reconciliation need from the authenticated
 * user. Kept loose so individual callers can read other fields without a new
 * cast. Lives here (not auth.guards.ts) so AuthService can share the predicate
 * without a service→guards→service import cycle.
 */
export type SettledUser =
  | {socialSignupCompletionRequired?: boolean; _id?: string}
  | null
  | undefined;

export function requiresSocialSignupCompletion(user: SettledUser): boolean {
  return user?.socialSignupCompletionRequired === true;
}

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
