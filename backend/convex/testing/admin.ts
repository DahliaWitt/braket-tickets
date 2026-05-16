import {v} from 'convex/values';
import type {Doc, Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {insertAdminAuditLog} from '../lib/admin_audit_log';
import {digestBearerToken, tokenPrefix} from '../lib/token_digests';
import {adminInviteStatusValidator} from '../lib/validators/admin_invites';
import {adminNotificationPreferenceModeValidator} from '../lib/validators/admin_notification_preferences';
import {
  adminAuditLogValidator,
  testingMutation,
  testingQuery,
} from './wrappers';

interface InsertSeedAuditLogArgs {
  adminId: Id<'users'>;
  action: Doc<'adminAuditLogs'>['action'];
  organizerId?: Id<'organizers'>;
  eventId?: Id<'events'>;
  applicationId?: Id<'applications'>;
  magicLinkId?: Id<'magic_links'>;
  trustingOrganizerId?: Id<'organizers'>;
  trustedOrganizerId?: Id<'organizers'>;
  source?: string;
  reason?: string;
}

interface InsertSeedAdminInviteArgs {
  email: string;
  organizerId: Id<'organizers'>;
  communityName: string;
  invitedBy: Id<'users'>;
  status?: Doc<'admin_invites'>['status'];
  expiresAt?: number;
  token?: string;
  redeemedBy?: Id<'users'>;
  redeemedAt?: number;
}

interface UpsertSeedAdminNotificationPreferenceArgs {
  userId: Id<'users'>;
  organizerId: Id<'organizers'>;
  mode?: Doc<'adminNotificationPreferences'>['mode'];
  digestHour?: number;
}

export async function insertSeedAuditLog(
  ctx: MutationCtx,
  args: InsertSeedAuditLogArgs,
): Promise<Id<'adminAuditLogs'>> {
  return await insertAdminAuditLog(ctx, {
    adminId: args.adminId,
    action: args.action,
    organizerId: args.organizerId,
    eventId: args.eventId,
    applicationId: args.applicationId,
    magicLinkId: args.magicLinkId,
    trustingOrganizerId: args.trustingOrganizerId,
    trustedOrganizerId: args.trustedOrganizerId,
    source: args.source,
    reason: args.reason,
  });
}

export async function insertSeedAdminInvite(
  {db}: MutationCtx,
  args: InsertSeedAdminInviteArgs,
): Promise<Id<'admin_invites'>> {
  const token = args.token ?? crypto.randomUUID();
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- Test composite: direct insert with full control over invite state
  return await db.insert('admin_invites', {
    email: args.email,
    organizerId: args.organizerId,
    communityName: args.communityName,
    invitedBy: args.invitedBy,
    status: args.status ?? 'pending',
    expiresAt: args.expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
    tokenDigest: await digestBearerToken('admin_invite', token),
    tokenPrefix: tokenPrefix(token),
    redeemedBy: args.redeemedBy,
    redeemedAt: args.redeemedAt,
  });
}

export async function upsertSeedAdminNotificationPreference(
  {db}: MutationCtx,
  args: UpsertSeedAdminNotificationPreferenceArgs,
): Promise<Id<'adminNotificationPreferences'>> {
  const existing = await db
    .query('adminNotificationPreferences')
    .withIndex('by_user_and_community', (q) =>
      q.eq('userId', args.userId).eq('organizerId', args.organizerId),
    )
    .unique();

  /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Upsert pattern: update-or-create with no corresponding mutation */
  if (existing) {
    await db.patch('adminNotificationPreferences', existing._id, {
      mode: args.mode ?? 'all',
      digestHour: args.digestHour ?? 9,
    });
    return existing._id;
  }

  return await db.insert('adminNotificationPreferences', {
    userId: args.userId,
    organizerId: args.organizerId,
    mode: args.mode ?? 'all',
    digestHour: args.digestHour ?? 9,
  });
  /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */
}

/**
 * Gets the latest audit log entry.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const getLatestAuditLog = testingQuery({
  args: {
    adminId: v.optional(v.id('users')),
    eventId: v.optional(v.id('events')),
    action: v.optional(v.string()),
  },
  returns: v.union(adminAuditLogValidator, v.null()),
  handler: async ({db}, args) => {
    let logs: Doc<'adminAuditLogs'>[] = [];

    if (args.eventId) {
      logs = await db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', args.eventId))
        .order('desc')
        .take(10);
    } else if (args.adminId) {
      logs = await db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', args.adminId!))
        .order('desc')
        .take(10);
    } else {
      // Fallback to latest global
      const log = await db.query('adminAuditLogs').order('desc').first();
      if (log) logs.push(log);
    }

    if (args.action) {
      return logs.find((l) => l.action.includes(args.action!)) ?? null;
    }
    return logs[0] ?? null;
  },
});

/**
 * Seeds an admin invite directly into the database, bypassing RLS.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedAdminInvite = testingMutation({
  args: {
    email: v.string(),
    organizerId: v.id('organizers'),
    communityName: v.string(),
    invitedBy: v.id('users'),
    status: v.optional(adminInviteStatusValidator),
    expiresAt: v.optional(v.number()),
    token: v.optional(v.string()),
    redeemedBy: v.optional(v.id('users')),
    redeemedAt: v.optional(v.number()),
  },
  returns: v.id('admin_invites'),
  handler: insertSeedAdminInvite,
});

/**
 * Seeds an admin notification preference row directly into the database.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedAdminNotificationPreference = testingMutation({
  args: {
    userId: v.id('users'),
    organizerId: v.id('organizers'),
    mode: v.optional(adminNotificationPreferenceModeValidator),
    digestHour: v.optional(v.number()),
  },
  returns: v.id('adminNotificationPreferences'),
  handler: upsertSeedAdminNotificationPreference,
});
