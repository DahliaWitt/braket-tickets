/**
 * User synchronization between Better Auth and application users table.
 *
 * Registered Convex functions live here; implementation details live in `_impl/`.
 */

import {v} from 'convex/values';

import {internalMutation} from '../_generated/server';
import {backfillAuthUserLinksHandler, syncUserHandler} from './_impl/sync';

export const syncUser = internalMutation({
  args: {
    betterAuthUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    authEmailVerified: v.optional(v.boolean()),
    emailVerificationTime: v.optional(v.number()),
    socialSignupCompletionRequired: v.optional(v.boolean()),
  },
  returns: v.object({
    userId: v.id('users'),
    created: v.boolean(),
    requiresSocialSignupCompletion: v.boolean(),
  }),
  handler: syncUserHandler,
});

export const backfillAuthUserLinks = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    actorUserId: v.optional(v.id('users')),
  },
  returns: v.object({
    processed: v.number(),
    linked: v.number(),
    skipped: v.number(),
    collisions: v.number(),
    continueCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
    collisionSample: v.array(v.string()),
  }),
  handler: backfillAuthUserLinksHandler,
});
