import {v} from 'convex/values';

export const ADMIN_AUDIT_ACTIONS = {
  ACCOUNT_EMAIL_CHANGE_CANCELLED: 'account.email_change.cancelled',
  ACCOUNT_EMAIL_CHANGE_COMPLETED: 'account.email_change.completed',
  ACCOUNT_EMAIL_CHANGE_FAILED: 'account.email_change.failed',
  ACCOUNT_EMAIL_CHANGE_REQUESTED: 'account.email_change.requested',
  ACCOUNT_EMAIL_CHANGE_VERIFICATION_QUEUED:
    'account.email_change.verification_queued',
  ACCOUNT_PASSWORD_CREATED: 'account.password.created',
  ACCOUNT_PROVIDER_LINKED: 'account.provider.linked',
  ACCOUNT_PROVIDER_UNLINKED: 'account.provider.unlinked',
  ADMIN_INVITE_CANCEL: 'admin_invite.cancel',
  ADMIN_INVITE_CREATE: 'admin_invite.create',
  ADMIN_INVITE_REDEEM: 'admin_invite.redeem',
  APPLICATION_REVIEW: 'application.review',
  APPLICATION_REVOKE: 'application.revoke',
  AUTH_SOCIAL_SIGNIN_BLOCKED: 'auth.social_signin.blocked',
  AUTH_SOCIAL_SIGNIN_LINKED_EXISTING: 'auth.social_signin.linked_existing',
  AUTH_SOCIAL_SIGNUP_COMPLETED: 'auth.social_signup.completed',
  AUTH_SYNC_BACKFILL_COLLISION: 'auth_sync.backfill.collision',
  AUTH_SYNC_BACKFILL_LINKED: 'auth_sync.backfill.linked',
  AUTH_SYNC_BACKFILL_SKIPPED: 'auth_sync.backfill.skipped',
  COMMUNITY_ADMIN_GRANT: 'community_admin.grant',
  COMMUNITY_ADMIN_MEMBER_REPAIR: 'community_admin.member_repair',
  COMMUNITY_ADMIN_REVOKE: 'community_admin.revoke',
  COMMUNITY_SCANNER_GRANT: 'community_scanner.grant',
  COMMUNITY_SCANNER_REVOKE: 'community_scanner.revoke',
  EVENT_BROADCAST_EMAIL_SEND_ALL_HOLDERS:
    'event.broadcast-email.send.all_holders',
  EVENT_CREATE: 'event.create',
  EVENT_DELETE: 'event.delete',
  EVENT_MANAGEMENT_VIEW: 'event.management.view',
  EVENT_MARKETING_EMAIL_AUTO_CANCELLED: 'event.marketing-email.auto-cancelled',
  EVENT_ORGANIZER_REASSIGN_FROM: 'event.organizer_reassign.from',
  EVENT_ORGANIZER_REASSIGN_TO: 'event.organizer_reassign.to',
  EVENT_REMINDER_EMAIL_SEND_APPROVED_NO_TICKET:
    'event.reminder-email.send.approved_no_ticket',
  EVENT_ROSTER_EXPORTED: 'event_roster_exported',
  EVENT_UPDATE: 'event.update',
  GUEST_ADD: 'guest.add',
  GUEST_CHECK_IN: 'guest.check-in',
  MAGIC_LINK_CREATE: 'magic_link.create',
  MAGIC_LINK_DELETE: 'magic_link.delete',
  MAGIC_LINK_DISABLE: 'magic_link.disable',
  MAGIC_LINK_PAUSE: 'magic_link.pause',
  MAGIC_LINK_REDEMPTION: 'magic_link.redemption',
  MAGIC_LINK_RESUME: 'magic_link.resume',
  MARKETING_EMAIL_CANCELLED: 'marketing_email.cancelled',
  MARKETING_EMAIL_SCHEDULED: 'marketing_email.scheduled',
  MARKETING_EMAIL_SENT: 'marketing_email.sent',
  ORGANIZER_CASCADE_UNPUBLISH_EVENTS: 'organizer.cascadeUnpublishEvents',
  ORGANIZER_CLEANUP_ORPHANED_ANSWERS: 'organizer.cleanupOrphanedAnswers',
  ORGANIZER_SET_PLATFORM_ORGANIZER_FALSE:
    'organizer.setPlatformOrganizer:false',
  ORGANIZER_SET_PLATFORM_ORGANIZER_TRUE: 'organizer.setPlatformOrganizer:true',
  ORGANIZER_UPDATE: 'organizer.update',
  PAYMENT_FORCE_REFUND_ALL: 'payment.force-refund-all',
  PAYMENT_REFUND: 'payment.refund',
  TICKET_CHECK_IN: 'ticket.check-in',
  TICKET_CHECK_IN_REVERT: 'ticket.check-in.revert',
  TICKET_REFUND: 'ticket.refund',
  TRUST_LINK_CASCADE_DELETED: 'trust_link_cascade_deleted',
  TRUST_LINK_CREATED: 'trust_link_created',
  TRUST_LINK_PAUSED: 'trust_link_paused',
  TRUST_LINK_RESUMED: 'trust_link_resumed',
  TRUST_LINK_REVOKED: 'trust_link_revoked',
  USER_REVOKE: 'user.revoke',
  // No current producer — the vetting-reminder feature was deleted. Kept so
  // historical adminAuditLogs rows continue to read-validate against the
  // adminAuditActionValidator union below.
  VETTING_REMINDER_EMAIL_SEND_NO_APPLICATION:
    'vetting.reminder-email.send.no_application',
} as const;

export type AdminAuditAction =
  (typeof ADMIN_AUDIT_ACTIONS)[keyof typeof ADMIN_AUDIT_ACTIONS];

export type AdminAuditActionCategory =
  | 'event'
  | 'application'
  | 'check-in'
  | 'payment'
  | 'trust-link'
  | 'role'
  | 'magic-link'
  | 'account'
  | 'email';

export const adminAuditActionCategoryValidator = v.union(
  v.literal('event'),
  v.literal('application'),
  v.literal('check-in'),
  v.literal('payment'),
  v.literal('trust-link'),
  v.literal('role'),
  v.literal('magic-link'),
  v.literal('account'),
  v.literal('email'),
);

const adminAuditActionLiterals = Object.values(ADMIN_AUDIT_ACTIONS).map(
  (value) => v.literal(value),
);

// Work around TypeScript/Convex codegen inference dropping a couple of action
// literals from the generated union: explicitly include organizer reassignment.
export const adminAuditActionValidator = v.union(
  ...adminAuditActionLiterals,
  v.literal(ADMIN_AUDIT_ACTIONS.EVENT_ORGANIZER_REASSIGN_FROM),
  v.literal(ADMIN_AUDIT_ACTIONS.EVENT_ORGANIZER_REASSIGN_TO),
);

export const adminAuditCheckInActionValidator = v.union(
  v.literal(ADMIN_AUDIT_ACTIONS.TICKET_CHECK_IN),
  v.literal(ADMIN_AUDIT_ACTIONS.GUEST_CHECK_IN),
);

export const ADMIN_AUDIT_ACTIONS_BY_CATEGORY = {
  event: [
    ADMIN_AUDIT_ACTIONS.EVENT_CREATE,
    ADMIN_AUDIT_ACTIONS.EVENT_DELETE,
    ADMIN_AUDIT_ACTIONS.EVENT_MANAGEMENT_VIEW,
    ADMIN_AUDIT_ACTIONS.EVENT_ROSTER_EXPORTED,
    ADMIN_AUDIT_ACTIONS.EVENT_ORGANIZER_REASSIGN_FROM,
    ADMIN_AUDIT_ACTIONS.EVENT_ORGANIZER_REASSIGN_TO,
    ADMIN_AUDIT_ACTIONS.EVENT_UPDATE,
    ADMIN_AUDIT_ACTIONS.GUEST_ADD,
  ],
  application: [
    ADMIN_AUDIT_ACTIONS.APPLICATION_REVIEW,
    ADMIN_AUDIT_ACTIONS.APPLICATION_REVOKE,
  ],
  'check-in': [
    ADMIN_AUDIT_ACTIONS.GUEST_CHECK_IN,
    ADMIN_AUDIT_ACTIONS.TICKET_CHECK_IN,
    ADMIN_AUDIT_ACTIONS.TICKET_CHECK_IN_REVERT,
  ],
  payment: [
    ADMIN_AUDIT_ACTIONS.PAYMENT_FORCE_REFUND_ALL,
    ADMIN_AUDIT_ACTIONS.PAYMENT_REFUND,
    ADMIN_AUDIT_ACTIONS.TICKET_REFUND,
  ],
  'trust-link': [
    ADMIN_AUDIT_ACTIONS.TRUST_LINK_CASCADE_DELETED,
    ADMIN_AUDIT_ACTIONS.TRUST_LINK_CREATED,
    ADMIN_AUDIT_ACTIONS.TRUST_LINK_PAUSED,
    ADMIN_AUDIT_ACTIONS.TRUST_LINK_RESUMED,
    ADMIN_AUDIT_ACTIONS.TRUST_LINK_REVOKED,
  ],
  role: [
    ADMIN_AUDIT_ACTIONS.ADMIN_INVITE_CANCEL,
    ADMIN_AUDIT_ACTIONS.ADMIN_INVITE_CREATE,
    ADMIN_AUDIT_ACTIONS.ADMIN_INVITE_REDEEM,
    ADMIN_AUDIT_ACTIONS.COMMUNITY_ADMIN_GRANT,
    ADMIN_AUDIT_ACTIONS.COMMUNITY_ADMIN_MEMBER_REPAIR,
    ADMIN_AUDIT_ACTIONS.COMMUNITY_ADMIN_REVOKE,
    ADMIN_AUDIT_ACTIONS.COMMUNITY_SCANNER_GRANT,
    ADMIN_AUDIT_ACTIONS.COMMUNITY_SCANNER_REVOKE,
    ADMIN_AUDIT_ACTIONS.ORGANIZER_CASCADE_UNPUBLISH_EVENTS,
    ADMIN_AUDIT_ACTIONS.ORGANIZER_CLEANUP_ORPHANED_ANSWERS,
    ADMIN_AUDIT_ACTIONS.ORGANIZER_SET_PLATFORM_ORGANIZER_FALSE,
    ADMIN_AUDIT_ACTIONS.ORGANIZER_SET_PLATFORM_ORGANIZER_TRUE,
    ADMIN_AUDIT_ACTIONS.ORGANIZER_UPDATE,
    ADMIN_AUDIT_ACTIONS.USER_REVOKE,
  ],
  'magic-link': [
    ADMIN_AUDIT_ACTIONS.MAGIC_LINK_CREATE,
    ADMIN_AUDIT_ACTIONS.MAGIC_LINK_DELETE,
    ADMIN_AUDIT_ACTIONS.MAGIC_LINK_DISABLE,
    ADMIN_AUDIT_ACTIONS.MAGIC_LINK_PAUSE,
    ADMIN_AUDIT_ACTIONS.MAGIC_LINK_REDEMPTION,
    ADMIN_AUDIT_ACTIONS.MAGIC_LINK_RESUME,
  ],
  account: [
    ADMIN_AUDIT_ACTIONS.ACCOUNT_EMAIL_CHANGE_CANCELLED,
    ADMIN_AUDIT_ACTIONS.ACCOUNT_EMAIL_CHANGE_COMPLETED,
    ADMIN_AUDIT_ACTIONS.ACCOUNT_EMAIL_CHANGE_FAILED,
    ADMIN_AUDIT_ACTIONS.ACCOUNT_EMAIL_CHANGE_REQUESTED,
    ADMIN_AUDIT_ACTIONS.ACCOUNT_EMAIL_CHANGE_VERIFICATION_QUEUED,
    ADMIN_AUDIT_ACTIONS.ACCOUNT_PASSWORD_CREATED,
    ADMIN_AUDIT_ACTIONS.ACCOUNT_PROVIDER_LINKED,
    ADMIN_AUDIT_ACTIONS.ACCOUNT_PROVIDER_UNLINKED,
    ADMIN_AUDIT_ACTIONS.AUTH_SOCIAL_SIGNIN_BLOCKED,
    ADMIN_AUDIT_ACTIONS.AUTH_SOCIAL_SIGNIN_LINKED_EXISTING,
    ADMIN_AUDIT_ACTIONS.AUTH_SOCIAL_SIGNUP_COMPLETED,
    ADMIN_AUDIT_ACTIONS.AUTH_SYNC_BACKFILL_COLLISION,
    ADMIN_AUDIT_ACTIONS.AUTH_SYNC_BACKFILL_LINKED,
    ADMIN_AUDIT_ACTIONS.AUTH_SYNC_BACKFILL_SKIPPED,
  ],
  email: [
    ADMIN_AUDIT_ACTIONS.EVENT_BROADCAST_EMAIL_SEND_ALL_HOLDERS,
    ADMIN_AUDIT_ACTIONS.EVENT_MARKETING_EMAIL_AUTO_CANCELLED,
    ADMIN_AUDIT_ACTIONS.EVENT_REMINDER_EMAIL_SEND_APPROVED_NO_TICKET,
    ADMIN_AUDIT_ACTIONS.MARKETING_EMAIL_CANCELLED,
    ADMIN_AUDIT_ACTIONS.MARKETING_EMAIL_SCHEDULED,
    ADMIN_AUDIT_ACTIONS.MARKETING_EMAIL_SENT,
    ADMIN_AUDIT_ACTIONS.VETTING_REMINDER_EMAIL_SEND_NO_APPLICATION,
  ],
} as const satisfies Record<
  AdminAuditActionCategory,
  readonly AdminAuditAction[]
>;

export const SCANNER_WRITABLE_ADMIN_AUDIT_ACTIONS = [
  ADMIN_AUDIT_ACTIONS.TICKET_CHECK_IN,
  ADMIN_AUDIT_ACTIONS.TICKET_CHECK_IN_REVERT,
  ADMIN_AUDIT_ACTIONS.GUEST_CHECK_IN,
] as const satisfies readonly AdminAuditAction[];

const scannerWritableActionSet = new Set<string>(
  SCANNER_WRITABLE_ADMIN_AUDIT_ACTIONS,
);

export function getAdminAuditActionsForCategory(
  category: string,
): readonly AdminAuditAction[] | undefined {
  if (Object.hasOwn(ADMIN_AUDIT_ACTIONS_BY_CATEGORY, category)) {
    return ADMIN_AUDIT_ACTIONS_BY_CATEGORY[
      category as AdminAuditActionCategory
    ];
  }
  return undefined;
}

const actionCategoryEntries = Object.entries(
  ADMIN_AUDIT_ACTIONS_BY_CATEGORY,
) as [AdminAuditActionCategory, readonly AdminAuditAction[]][];

const adminAuditCategoryByAction = new Map<
  AdminAuditAction,
  AdminAuditActionCategory
>(
  actionCategoryEntries.flatMap(([category, actions]) =>
    actions.map((action) => [action, category] as const),
  ),
);

export function getAdminAuditCategoryForAction(
  action: AdminAuditAction,
): AdminAuditActionCategory | undefined {
  return adminAuditCategoryByAction.get(action);
}

export function isScannerWritableAdminAuditAction(action: string): boolean {
  return scannerWritableActionSet.has(action);
}
