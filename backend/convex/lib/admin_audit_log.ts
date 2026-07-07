import type {Doc, Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {
  getAdminAuditCategoryForAction,
  type AdminAuditAction,
} from './admin_audit_actions';
import {getRequestMetadataSafe} from './request_metadata';

export type AdminAuditLogInsert = Omit<
  Doc<'adminAuditLogs'>,
  '_id' | '_creationTime' | 'action'
> & {
  action: AdminAuditAction;
};

type AdminAuditLogDb = Pick<MutationCtx['db'], 'insert'>;
type AdminAuditLogWriteCtx = {
  db: AdminAuditLogDb;
  // When present, platform request metadata (client IP / User-Agent) is
  // captured onto the audit row unless the entry already provides it.
  // Scheduler-deferred writers lose request metadata at execution time —
  // they must capture before scheduling and pass ipAddress/userAgent in args.
  meta?: MutationCtx['meta'];
};

/**
 * Inserts an admin audit log entry with normalized optional fields.
 *
 * Keeps the table write shape consistent across callers while preserving the
 * exact field semantics passed in by each mutation.
 */
export async function insertAdminAuditLog(
  ctx: AdminAuditLogWriteCtx,
  entry: AdminAuditLogInsert,
): Promise<Id<'adminAuditLogs'>> {
  const actionCategory = getAdminAuditCategoryForAction(entry.action);
  const requestMetadata =
    ctx.meta !== undefined &&
    (entry.ipAddress === undefined || entry.userAgent === undefined)
      ? await getRequestMetadataSafe({meta: ctx.meta})
      : null;
  const ipAddress = entry.ipAddress ?? requestMetadata?.ip ?? undefined;
  const userAgent = entry.userAgent ?? requestMetadata?.userAgent ?? undefined;
  const document: AdminAuditLogInsert = {
    adminId: entry.adminId,
    action: entry.action,
    ...(actionCategory !== undefined ? {actionCategory} : {}),
    ...(entry.eventId !== undefined ? {eventId: entry.eventId} : {}),
    ...(entry.applicationId !== undefined
      ? {applicationId: entry.applicationId}
      : {}),
    ...(entry.targetUserId !== undefined
      ? {targetUserId: entry.targetUserId}
      : {}),
    ...(entry.magicLinkId !== undefined
      ? {magicLinkId: entry.magicLinkId}
      : {}),
    ...(entry.trustingOrganizerId !== undefined
      ? {trustingOrganizerId: entry.trustingOrganizerId}
      : {}),
    ...(entry.trustedOrganizerId !== undefined
      ? {trustedOrganizerId: entry.trustedOrganizerId}
      : {}),
    ...(entry.organizerId !== undefined
      ? {organizerId: entry.organizerId}
      : {}),
    ...(entry.source !== undefined ? {source: entry.source} : {}),
    ...(entry.reason !== undefined ? {reason: entry.reason} : {}),
    ...(entry.deletedEventName !== undefined
      ? {deletedEventName: entry.deletedEventName}
      : {}),
    ...(ipAddress !== undefined ? {ipAddress} : {}),
    ...(userAgent !== undefined ? {userAgent} : {}),
  };

  return await ctx.db.insert('adminAuditLogs', document);
}
