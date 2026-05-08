import type { injectConvex } from 'convex-angular';
import { type FunctionArgs, type FunctionReference, type FunctionReturnType } from 'convex/server';
import { type MutationOptions } from 'convex/browser';

export type SessionChannelMessage = { type: 'LOGIN' } | { type: 'LOGOUT' };

interface JwtPayload {
  iss?: string;
  exp?: number;
}

export type ConvexClientWithErrorHandling = ReturnType<typeof injectConvex> & {
  __braketAuthWrapped?: boolean;
};

export type ConvexQueryMethod = <Query extends FunctionReference<'query'>>(
  this: ConvexClientWithErrorHandling,
  query: Query,
  args: Query['_args'],
) => Promise<Awaited<Query['_returnType']>>;

export type ConvexMutationMethod = <Mutation extends FunctionReference<'mutation'>>(
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

export function extractDeploymentSlug(url: string): string | null {
  const match = url.match(/https?:\/\/([^.]+)\.convex\.(cloud|site)/);
  return match ? match[1] : null;
}

export function parseJwtPayload(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const payload: unknown = JSON.parse(atob(payloadBase64));
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Invalid token payload');
  }

  const issuer: unknown = Reflect.get(payload, 'iss');
  const expiry: unknown = Reflect.get(payload, 'exp');

  return {
    iss: typeof issuer === 'string' ? issuer : undefined,
    exp: typeof expiry === 'number' ? expiry : undefined,
  };
}

function isSessionMessageType(value: unknown): value is SessionChannelMessage['type'] {
  return value === 'LOGIN' || value === 'LOGOUT';
}

export function isValidSessionMessage(data: unknown): data is SessionChannelMessage {
  if (typeof data !== 'object' || data === null) return false;
  if (!Object.hasOwn(data, 'type')) return false;
  return isSessionMessageType(Reflect.get(data, 'type'));
}
