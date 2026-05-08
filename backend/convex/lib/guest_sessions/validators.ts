import {v} from 'convex/values';

export const guestSessionDocValidator = v.object({
  _id: v.id('guest_sessions'),
  _creationTime: v.number(),
  email: v.string(),
  clientKey: v.optional(v.string()),
  magicLinkId: v.optional(v.id('magic_links')),
  sessionToken: v.optional(v.string()),
  sessionTokenDigest: v.optional(v.string()),
  sessionTokenPrefix: v.optional(v.string()),
  pendingSessionTokenDigest: v.optional(v.string()),
  pendingSessionTokenPrefix: v.optional(v.string()),
  lastActiveAt: v.optional(v.number()),
  expiresAt: v.number(),
  convertedToUserId: v.optional(v.id('users')),
});
