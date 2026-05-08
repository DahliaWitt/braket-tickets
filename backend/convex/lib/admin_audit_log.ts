import type {Doc, Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {
  getAdminAuditCategoryForAction,
  type AdminAuditAction,
} from './admin_audit_actions';

export type AdminAuditLogInsert = Omit<
  Doc<'adminAuditLogs'>,
  '_id' | '_creationTime' | 'action'
> & {
  action: AdminAuditAction;
};

type AdminAuditLogDb = Pick<MutationCtx['db'], 'insert'>;
type AdminAuditLogWriteCtx = {db: AdminAuditLogDb};

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
  const document: AdminAuditLogInsert = {
    adminId: entry.adminId,
    action: entry.action,
    ...(actionCategory !== undefined ? {actionCategory} : {}),
    ...(entry.eventId !== undefined ? {eventId: entry.eventId} : {}),
    ...(entry.applicationId !== undefined ? {applicationId: entry.applicationId} : {}),
    ...(entry.magicLinkId !== undefined ? {magicLinkId: entry.magicLinkId} : {}),
    ...(entry.trustingOrganizerId !== undefined ?
      {trustingOrganizerId: entry.trustingOrganizerId} :
      {}),
    ...(entry.trustedOrganizerId !== undefined ?
      {trustedOrganizerId: entry.trustedOrganizerId} :
      {}),
    ...(entry.organizerId !== undefined ? {organizerId: entry.organizerId} : {}),
    ...(entry.source !== undefined ? {source: entry.source} : {}),
    ...(entry.reason !== undefined ? {reason: entry.reason} : {}),
    ...(entry.deletedEventName !== undefined ? {deletedEventName: entry.deletedEventName} : {}),
  };

  return await ctx.db.insert('adminAuditLogs', document);
}
