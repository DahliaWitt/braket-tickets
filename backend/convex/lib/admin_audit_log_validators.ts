import {v} from 'convex/values';
import {
  adminAuditActionCategoryValidator,
  adminAuditActionValidator,
} from './admin_audit_actions';

export const adminAuditLogFields = {
  adminId: v.id('users'),
  action: adminAuditActionValidator,
  actionCategory: v.optional(adminAuditActionCategoryValidator),
  eventId: v.optional(v.id('events')),
  applicationId: v.optional(v.id('applications')),
  magicLinkId: v.optional(v.id('magic_links')),
  organizerId: v.optional(v.id('organizers')),
  trustingOrganizerId: v.optional(v.id('organizers')),
  trustedOrganizerId: v.optional(v.id('organizers')),
  source: v.optional(v.string()),
  reason: v.optional(v.string()),
  deletedEventName: v.optional(v.string()),
};

export const adminAuditLogValidator = v.object({
  _id: v.id('adminAuditLogs'),
  _creationTime: v.number(),
  ...adminAuditLogFields,
});
