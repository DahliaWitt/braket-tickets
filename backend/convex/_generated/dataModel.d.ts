/* eslint-disable */
/**
 * Generated data model types.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
  AnyDataModel,
} from "convex/server";
import type { GenericId } from "convex/values";

/**
 * A type describing your Convex data model.
 *
 * This type includes information about what tables you have, the type of
 * documents stored in those tables, and the indexes defined on them.
 *
 * This type is used to parameterize methods like `queryGeneric` and
 * `mutationGeneric` to make them type-safe.
 */

export type DataModel = {
  admin_invites: {
    document: {
      communityName: string;
      email: string;
      expiresAt: number;
      invitedBy: Id<"users">;
      organizerId: Id<"organizers">;
      redeemedAt?: number;
      redeemedBy?: Id<"users">;
      status: "pending" | "redeemed" | "cancelled";
      token?: string;
      tokenDigest?: string;
      tokenPrefix?: string;
      _id: Id<"admin_invites">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "communityName"
      | "email"
      | "expiresAt"
      | "invitedBy"
      | "organizerId"
      | "redeemedAt"
      | "redeemedBy"
      | "status"
      | "token"
      | "tokenDigest"
      | "tokenPrefix";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_email: ["email", "_creationTime"];
      by_organizer: ["organizerId", "_creationTime"];
      by_status: ["status", "_creationTime"];
      by_token: ["token", "_creationTime"];
      by_tokenDigest: ["tokenDigest", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  adminAuditLogs: {
    document: {
      action:
        | "account.email_change.cancelled"
        | "account.email_change.completed"
        | "account.email_change.failed"
        | "account.email_change.requested"
        | "account.email_change.verification_queued"
        | "account.password.created"
        | "account.provider.linked"
        | "account.provider.unlinked"
        | "admin_invite.cancel"
        | "admin_invite.create"
        | "admin_invite.redeem"
        | "application.reinstate"
        | "application.review"
        | "application.revoke"
        | "auth.social_signin.blocked"
        | "auth.social_signin.linked_existing"
        | "auth.social_signup.completed"
        | "auth_sync.backfill.collision"
        | "auth_sync.backfill.linked"
        | "auth_sync.backfill.skipped"
        | "community_admin.grant"
        | "community_admin.member_repair"
        | "community_admin.revoke"
        | "community_scanner.grant"
        | "community_scanner.revoke"
        | "event.broadcast-email.send.all_holders"
        | "event.create"
        | "event.delete"
        | "event.management.view"
        | "event.marketing-email.auto-cancelled"
        | "event.organizer_reassign.from"
        | "event.organizer_reassign.to"
        | "event.reminder-email.send.approved_no_ticket"
        | "event_roster_exported"
        | "event.update"
        | "guest.add"
        | "guest.check-in"
        | "guest.import"
        | "guest.update"
        | "imported_tickets.import"
        | "imported_tickets.remove"
        | "imported_tickets.batch_remove"
        | "imported_tickets.redact"
        | "imported_ticket.check-in"
        | "magic_link.create"
        | "magic_link.delete"
        | "magic_link.disable"
        | "magic_link.pause"
        | "magic_link.redemption"
        | "magic_link.resume"
        | "marketing_email.cancelled"
        | "marketing_email.scheduled"
        | "marketing_email.sent"
        | "organizer.cascadeUnpublishEvents"
        | "organizer.cleanupOrphanedAnswers"
        | "organizer.setPlatformOrganizer:false"
        | "organizer.setPlatformOrganizer:true"
        | "organizer.update"
        | "payment.force-refund-all"
        | "payment.refund"
        | "ticket.check-in"
        | "ticket.check-in.revert"
        | "ticket.refund"
        | "trust_link_cascade_deleted"
        | "trust_link_created"
        | "trust_link_paused"
        | "trust_link_resumed"
        | "trust_link_revoked"
        | "user.revoke"
        | "vetting.reminder-email.send.no_application"
        | "event.organizer_reassign.from"
        | "event.organizer_reassign.to";
      actionCategory?:
        | "event"
        | "application"
        | "check-in"
        | "payment"
        | "trust-link"
        | "role"
        | "magic-link"
        | "account"
        | "email";
      adminId: Id<"users">;
      applicationId?: Id<"applications">;
      deletedEventName?: string;
      eventId?: Id<"events">;
      ipAddress?: string;
      magicLinkId?: Id<"magic_links">;
      organizerId?: Id<"organizers">;
      reason?: string;
      source?: string;
      targetUserId?: Id<"users">;
      trustedOrganizerId?: Id<"organizers">;
      trustingOrganizerId?: Id<"organizers">;
      userAgent?: string;
      _id: Id<"adminAuditLogs">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "action"
      | "actionCategory"
      | "adminId"
      | "applicationId"
      | "deletedEventName"
      | "eventId"
      | "ipAddress"
      | "magicLinkId"
      | "organizerId"
      | "reason"
      | "source"
      | "targetUserId"
      | "trustedOrganizerId"
      | "trustingOrganizerId"
      | "userAgent";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_adminId: ["adminId", "_creationTime"];
      by_eventId: ["eventId", "_creationTime"];
      by_organizer: ["organizerId", "_creationTime"];
      by_organizer_and_actionCategory: [
        "organizerId",
        "actionCategory",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  adminNotificationPreferences: {
    document: {
      digestHour: number;
      mode: "all" | "digest";
      organizerId: Id<"organizers">;
      userId: Id<"users">;
      _id: Id<"adminNotificationPreferences">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "digestHour"
      | "mode"
      | "organizerId"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_mode_and_digestHour: ["mode", "digestHour", "_creationTime"];
      by_organizer_and_mode: ["organizerId", "mode", "_creationTime"];
      by_user_and_community: ["userId", "organizerId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  applications: {
    document: {
      answers: Record<string, string | Array<string> | boolean | number>;
      denyReason?: string;
      organizerId?: Id<"organizers">;
      processedBy?: Id<"users">;
      reason?: string;
      status: "pending" | "approved" | "rejected" | "revoked";
      userId: Id<"users">;
      _id: Id<"applications">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "answers"
      | `answers.${string}`
      | "denyReason"
      | "organizerId"
      | "processedBy"
      | "reason"
      | "status"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organizer_and_creation: ["organizerId", "_creationTime"];
      by_organizer_status: ["organizerId", "status", "_creationTime"];
      by_status: ["status", "_creationTime"];
      by_user_and_organizer: ["userId", "organizerId", "_creationTime"];
      by_user_and_organizer_and_status: [
        "userId",
        "organizerId",
        "status",
        "_creationTime",
      ];
      by_user_status: ["userId", "status", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  confirmedUploads: {
    document: {
      confirmedAt: number;
      storageId: Id<"_storage">;
      uploaderUserId?: Id<"users">;
      _id: Id<"confirmedUploads">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "confirmedAt"
      | "storageId"
      | "uploaderUserId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_storageId: ["storageId", "_creationTime"];
      by_storageId_and_uploaderUserId: [
        "storageId",
        "uploaderUserId",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  emailAddressMarketingPreferences: {
    document: {
      email: string;
      optedIn: boolean;
      organizerId: Id<"organizers">;
      unsubToken?: string;
      unsubTokenDigest?: string;
      unsubTokenPrefix?: string;
      updatedAt: number;
      _id: Id<"emailAddressMarketingPreferences">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "email"
      | "optedIn"
      | "organizerId"
      | "unsubToken"
      | "unsubTokenDigest"
      | "unsubTokenPrefix"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_email: ["email", "_creationTime"];
      by_email_and_organizer: ["email", "organizerId", "_creationTime"];
      by_organizer_and_email: ["organizerId", "email", "_creationTime"];
      by_unsub_token: ["unsubToken", "_creationTime"];
      by_unsub_tokenDigest: ["unsubTokenDigest", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  emailDedup: {
    document: {
      createdAt: number;
      key: string;
      _id: Id<"emailDedup">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "createdAt" | "key";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_createdAt: ["createdAt", "_creationTime"];
      by_key: ["key", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  emailDeliveries: {
    document: {
      critical: boolean;
      emailId: string;
      fallback: boolean;
      manual: boolean;
      provider: "resend" | "smtp";
      recipient: string;
      resendId?: string;
      sentAt: number;
      source:
        | "announcement"
        | "broadcast"
        | "digest"
        | "reminder"
        | "application"
        | "admin_invite"
        | "event"
        | "ticket"
        | "payout"
        | "resale_available"
        | "auth";
      sourceId: string;
      _id: Id<"emailDeliveries">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "critical"
      | "emailId"
      | "fallback"
      | "manual"
      | "provider"
      | "recipient"
      | "resendId"
      | "sentAt"
      | "source"
      | "sourceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_emailId: ["emailId", "_creationTime"];
      by_recipient: ["recipient", "_creationTime"];
      by_resendId: ["resendId", "_creationTime"];
      by_sentAt: ["sentAt", "_creationTime"];
      by_source: ["source", "sourceId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  emailDeliveryFailures: {
    document: {
      error: string;
      failedAt: number;
      recipient: string;
      source:
        | "announcement"
        | "broadcast"
        | "digest"
        | "reminder"
        | "application"
        | "admin_invite"
        | "event"
        | "ticket"
        | "payout"
        | "resale_available"
        | "auth";
      sourceId: string;
      _id: Id<"emailDeliveryFailures">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "error"
      | "failedAt"
      | "recipient"
      | "source"
      | "sourceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_failedAt: ["failedAt", "_creationTime"];
      by_source: ["source", "sourceId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  emailProviderCircuit: {
    document: {
      failureCount: number;
      openUntil?: number;
      provider: string;
      updatedAt: number;
      windowStartedAt: number;
      _id: Id<"emailProviderCircuit">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "failureCount"
      | "openUntil"
      | "provider"
      | "updatedAt"
      | "windowStartedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_provider: ["provider", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  event_inventory: {
    document: {
      eventId: Id<"events">;
      heldCount: number;
      soldCount: number;
      _id: Id<"event_inventory">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "eventId" | "heldCount" | "soldCount";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  eventBroadcastDeliveries: {
    document: {
      broadcastId: Id<"eventBroadcasts">;
      email: string;
      eventId: Id<"events">;
      origin: "send" | "catchup" | "backfill";
      sentAt: number;
      _id: Id<"eventBroadcastDeliveries">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "broadcastId"
      | "email"
      | "eventId"
      | "origin"
      | "sentAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_broadcast_and_email: ["broadcastId", "email", "_creationTime"];
      by_email: ["email", "_creationTime"];
      by_event_and_email: ["eventId", "email", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  eventBroadcasts: {
    document: {
      adminId: Id<"users">;
      eventId: Id<"events">;
      message: string;
      recipientCount: number;
      sentAt: number;
      subject: string;
      _id: Id<"eventBroadcasts">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "adminId"
      | "eventId"
      | "message"
      | "recipientCount"
      | "sentAt"
      | "subject";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event: ["eventId", "_creationTime"];
      by_event_and_sentAt: ["eventId", "sentAt", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  eventMarketingEmails: {
    document: {
      adminId: Id<"users">;
      audienceScope?: "community" | "community_and_trusted";
      eventId: Id<"events">;
      recipientCount?: number;
      scheduledFor: number;
      schedulerJobId?: Id<"_scheduled_functions">;
      sentAt?: number;
      status: "scheduled" | "sent" | "cancelled";
      totalClickCount?: number;
      totalOpenCount?: number;
      uniqueClickCount?: number;
      uniqueOpenCount?: number;
      _id: Id<"eventMarketingEmails">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "adminId"
      | "audienceScope"
      | "eventId"
      | "recipientCount"
      | "scheduledFor"
      | "schedulerJobId"
      | "sentAt"
      | "status"
      | "totalClickCount"
      | "totalOpenCount"
      | "uniqueClickCount"
      | "uniqueOpenCount";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event: ["eventId", "_creationTime"];
      by_event_and_status: ["eventId", "status", "_creationTime"];
      by_status: ["status", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  events: {
    document: {
      checkedInCount?: number;
      date: string;
      description?: string;
      inventoryId?: Id<"event_inventory">;
      lastCheckInAt?: number | null;
      location?: string;
      maxTicketsPerUser?: number;
      organizerId: Id<"organizers">;
      paidOutAt?: number;
      poster?: string;
      price: number;
      resaleEnabled?: boolean;
      resaleFeePct?: number;
      slidingScaleEnabled?: boolean;
      slidingScaleMax?: number;
      slidingScaleMin?: number;
      status: "draft" | "published" | "cancelled";
      supporterDefaultPrice?: number;
      ticketSalesStatus?: "active" | "paused" | "ended";
      title: string;
      totalTickets: number;
      visibility: "private" | "public_viewable" | "public";
      _id: Id<"events">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "checkedInCount"
      | "date"
      | "description"
      | "inventoryId"
      | "lastCheckInAt"
      | "location"
      | "maxTicketsPerUser"
      | "organizerId"
      | "paidOutAt"
      | "poster"
      | "price"
      | "resaleEnabled"
      | "resaleFeePct"
      | "slidingScaleEnabled"
      | "slidingScaleMax"
      | "slidingScaleMin"
      | "status"
      | "supporterDefaultPrice"
      | "ticketSalesStatus"
      | "title"
      | "totalTickets"
      | "visibility";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organizer: ["organizerId", "_creationTime"];
      by_organizer_status: ["organizerId", "status", "_creationTime"];
      by_organizer_status_visibility_date: [
        "organizerId",
        "status",
        "visibility",
        "date",
        "_creationTime",
      ];
      by_organizer_visibility_date: [
        "organizerId",
        "visibility",
        "date",
        "_creationTime",
      ];
      by_status: ["status", "_creationTime"];
      by_status_date: ["status", "date", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  guest_sessions: {
    document: {
      clientKey?: string;
      convertedToUserId?: Id<"users">;
      email: string;
      expiresAt: number;
      lastActiveAt?: number;
      magicLinkId?: Id<"magic_links">;
      pendingSessionTokenDigest?: string;
      pendingSessionTokenPrefix?: string;
      sessionToken?: string;
      sessionTokenDigest?: string;
      sessionTokenPrefix?: string;
      _id: Id<"guest_sessions">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "clientKey"
      | "convertedToUserId"
      | "email"
      | "expiresAt"
      | "lastActiveAt"
      | "magicLinkId"
      | "pendingSessionTokenDigest"
      | "pendingSessionTokenPrefix"
      | "sessionToken"
      | "sessionTokenDigest"
      | "sessionTokenPrefix";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_clientKey: ["clientKey", "_creationTime"];
      by_email: ["email", "_creationTime"];
      by_expiresAt: ["expiresAt", "_creationTime"];
      by_magicLink: ["magicLinkId", "_creationTime"];
      by_pendingSessionTokenDigest: [
        "pendingSessionTokenDigest",
        "_creationTime",
      ];
      by_sessionToken: ["sessionToken", "_creationTime"];
      by_sessionTokenDigest: ["sessionTokenDigest", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  guests: {
    document: {
      checkedInAt?: number;
      checkedInBy?: Id<"users">;
      email?: string;
      emailSendLockedAt?: number | null;
      emailedAt?: number;
      eventId: Id<"events">;
      name: string;
      notes?: string;
      type: "guest" | "artist guest" | "staff";
      _id: Id<"guests">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "checkedInAt"
      | "checkedInBy"
      | "email"
      | "emailedAt"
      | "emailSendLockedAt"
      | "eventId"
      | "name"
      | "notes"
      | "type";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event: ["eventId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  importBatches: {
    document: {
      batchKey: string;
      eventId: Id<"events">;
      result: {
        insertedCount: number;
        outcomes: Array<{
          reason?: string;
          rowIndex: number;
          status: "inserted" | "skipped" | "invalid";
        }>;
        skippedCount: number;
      };
      target: "guests" | "importedTickets";
      _id: Id<"importBatches">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "batchKey"
      | "eventId"
      | "result"
      | "result.insertedCount"
      | "result.outcomes"
      | "result.skippedCount"
      | "target";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event_batch_key_target: [
        "eventId",
        "batchKey",
        "target",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  importedTicketHolders: {
    document: {
      batchKey: string;
      checkedInAt?: number;
      checkedInBy?: Id<"users">;
      email?: string;
      eventId: Id<"events">;
      externalRef?: string;
      externalRefKey?: string;
      name: string;
      orderRef?: string;
      purchaseDateRaw?: string;
      sourceLabel: string;
      ticketTypeLabel?: string;
      _id: Id<"importedTicketHolders">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "batchKey"
      | "checkedInAt"
      | "checkedInBy"
      | "email"
      | "eventId"
      | "externalRef"
      | "externalRefKey"
      | "name"
      | "orderRef"
      | "purchaseDateRaw"
      | "sourceLabel"
      | "ticketTypeLabel";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event: ["eventId", "_creationTime"];
      by_event_batch_key: ["eventId", "batchKey", "_creationTime"];
      by_event_external_ref_key: ["eventId", "externalRefKey", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  magic_link_redemption_log: {
    document: {
      guestSessionId?: Id<"guest_sessions">;
      magicLinkId: Id<"magic_links">;
      redeemedAt: number;
      userId?: Id<"users">;
      _id: Id<"magic_link_redemption_log">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "guestSessionId"
      | "magicLinkId"
      | "redeemedAt"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_guestSession: ["guestSessionId", "_creationTime"];
      by_magicLink: ["magicLinkId", "_creationTime"];
      by_magicLink_guest: ["magicLinkId", "guestSessionId", "_creationTime"];
      by_magicLink_user: ["magicLinkId", "userId", "_creationTime"];
      by_user: ["userId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  magic_links: {
    document: {
      createdBy: Id<"users">;
      deletedAt?: number;
      expiresAt?: number;
      label?: string;
      maxRedemptions?: number;
      organizerId: Id<"organizers">;
      status: "active" | "paused" | "disabled";
      token?: string;
      tokenDigest?: string;
      tokenPrefix?: string;
      _id: Id<"magic_links">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "createdBy"
      | "deletedAt"
      | "expiresAt"
      | "label"
      | "maxRedemptions"
      | "organizerId"
      | "status"
      | "token"
      | "tokenDigest"
      | "tokenPrefix";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_createdBy: ["createdBy", "status", "_creationTime"];
      by_organizerId: ["organizerId", "_creationTime"];
      by_organizerId_and_createdBy_and_status: [
        "organizerId",
        "createdBy",
        "status",
        "_creationTime",
      ];
      by_token: ["token", "_creationTime"];
      by_tokenDigest: ["tokenDigest", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  marketingEmailDeliveries: {
    document: {
      clickCount: number;
      clickToken?: string;
      clickTokenDigest?: string;
      clickTokenPrefix?: string;
      clickedAt?: number;
      eventId: Id<"events">;
      eventMarketingEmailId: Id<"eventMarketingEmails">;
      openCount: number;
      openToken?: string;
      openTokenDigest?: string;
      openTokenPrefix?: string;
      openedAt?: number;
      organizerId: Id<"organizers">;
      recipient: string;
      sentAt: number;
      targetUrl: string;
      userId: Id<"users">;
      vettedViaOrganizerIds?: Array<Id<"organizers">>;
      _id: Id<"marketingEmailDeliveries">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "clickCount"
      | "clickedAt"
      | "clickToken"
      | "clickTokenDigest"
      | "clickTokenPrefix"
      | "eventId"
      | "eventMarketingEmailId"
      | "openCount"
      | "openedAt"
      | "openToken"
      | "openTokenDigest"
      | "openTokenPrefix"
      | "organizerId"
      | "recipient"
      | "sentAt"
      | "targetUrl"
      | "userId"
      | "vettedViaOrganizerIds";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_click_token: ["clickToken", "_creationTime"];
      by_click_tokenDigest: ["clickTokenDigest", "_creationTime"];
      by_eventMarketingEmail: ["eventMarketingEmailId", "_creationTime"];
      by_open_token: ["openToken", "_creationTime"];
      by_open_tokenDigest: ["openTokenDigest", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  marketingEmailPreferences: {
    document: {
      optedIn: boolean;
      organizerId: Id<"organizers">;
      unsubToken?: string;
      unsubTokenDigest?: string;
      unsubTokenPrefix?: string;
      updatedAt: number;
      userId: Id<"users">;
      _id: Id<"marketingEmailPreferences">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "optedIn"
      | "organizerId"
      | "unsubToken"
      | "unsubTokenDigest"
      | "unsubTokenPrefix"
      | "updatedAt"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organizer_and_user: ["organizerId", "userId", "_creationTime"];
      by_unsub_token: ["unsubToken", "_creationTime"];
      by_unsub_tokenDigest: ["unsubTokenDigest", "_creationTime"];
      by_user: ["userId", "_creationTime"];
      by_user_and_organizer: ["userId", "organizerId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  marketingUnsubscribeTokens: {
    document: {
      addressPreferenceId?: Id<"emailAddressMarketingPreferences">;
      createdAt: number;
      email?: string;
      kind: "user" | "address";
      organizerId: Id<"organizers">;
      tokenDigest: string;
      tokenPrefix: string;
      userId?: Id<"users">;
      userPreferenceId?: Id<"marketingEmailPreferences">;
      _id: Id<"marketingUnsubscribeTokens">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "addressPreferenceId"
      | "createdAt"
      | "email"
      | "kind"
      | "organizerId"
      | "tokenDigest"
      | "tokenPrefix"
      | "userId"
      | "userPreferenceId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_createdAt: ["createdAt", "_creationTime"];
      by_email: ["email", "_creationTime"];
      by_tokenDigest: ["tokenDigest", "_creationTime"];
      by_user: ["userId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  order_financial_events: {
    document: {
      amountCents?: number;
      connectedAccountId?: string;
      connectedAccountNetCents?: number;
      currency: "USD";
      eventId: Id<"events">;
      kind:
        | "payment_captured"
        | "payment_refunded"
        | "late_payment_after_release"
        | "dispute_opened"
        | "dispute_closed"
        | "dispute_funds_withdrawn"
        | "dispute_funds_reinstated"
        | "resale_seller_refund_queued"
        | "resale_seller_refund_completed"
        | "resale_seller_refund_failed";
      note?: string;
      occurredAt: number;
      orderId: Id<"ticket_orders">;
      platformFeeCents?: number;
      processorFeeCents?: number;
      stripeChargeId?: string;
      stripeDisputeId?: string;
      stripeEventId?: string;
      stripePaymentIntentId?: string;
      stripeRefundId?: string;
      _id: Id<"order_financial_events">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "amountCents"
      | "connectedAccountId"
      | "connectedAccountNetCents"
      | "currency"
      | "eventId"
      | "kind"
      | "note"
      | "occurredAt"
      | "orderId"
      | "platformFeeCents"
      | "processorFeeCents"
      | "stripeChargeId"
      | "stripeDisputeId"
      | "stripeEventId"
      | "stripePaymentIntentId"
      | "stripeRefundId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_connectedAccountId: ["connectedAccountId", "_creationTime"];
      by_event: ["eventId", "_creationTime"];
      by_order: ["orderId", "_creationTime"];
      by_order_and_kind: ["orderId", "kind", "_creationTime"];
      by_order_and_kind_and_stripeDisputeId: [
        "orderId",
        "kind",
        "stripeDisputeId",
        "_creationTime",
      ];
      by_order_and_kind_and_stripeEventId: [
        "orderId",
        "kind",
        "stripeEventId",
        "_creationTime",
      ];
      by_order_and_kind_and_stripeRefundId: [
        "orderId",
        "kind",
        "stripeRefundId",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  organizer_trust_links: {
    document: {
      trustedOrganizerId: Id<"organizers">;
      trustingOrganizerId: Id<"organizers">;
      _id: Id<"organizer_trust_links">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "trustedOrganizerId"
      | "trustingOrganizerId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_trustedOrganizerId_and_trustingOrganizerId: [
        "trustedOrganizerId",
        "trustingOrganizerId",
        "_creationTime",
      ];
      by_trustingOrganizerId_and_trustedOrganizerId: [
        "trustingOrganizerId",
        "trustedOrganizerId",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  organizer_user_directory: {
    document: {
      applicationAnswers?: Record<
        string,
        string | Array<string> | boolean | number
      >;
      applicationCreationTime?: number;
      applicationId?: Id<"applications">;
      applicationProcessedBy?: Id<"users">;
      applicationReason?: string;
      applicationStatus?: "pending" | "approved" | "rejected" | "revoked";
      communityAccessSource?:
        | "approved_application"
        | "magic_link"
        | "direct_member"
        | "shared";
      isCommunityAdmin?: boolean;
      organizerId: Id<"organizers">;
      sortTime: number;
      trustedViaOrganizerName?: string;
      userId: Id<"users">;
      _id: Id<"organizer_user_directory">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "applicationAnswers"
      | `applicationAnswers.${string}`
      | "applicationCreationTime"
      | "applicationId"
      | "applicationProcessedBy"
      | "applicationReason"
      | "applicationStatus"
      | "communityAccessSource"
      | "isCommunityAdmin"
      | "organizerId"
      | "sortTime"
      | "trustedViaOrganizerName"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organizer_and_sortTime_and_user: [
        "organizerId",
        "sortTime",
        "userId",
        "_creationTime",
      ];
      by_organizer_and_user: ["organizerId", "userId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  organizer_user_directory_membership_propagations: {
    document: {
      continueCursor?: string;
      organizerId: Id<"organizers">;
      restartRequested?: boolean;
      status: "queued" | "running";
      userId: Id<"users">;
      _id: Id<"organizer_user_directory_membership_propagations">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "continueCursor"
      | "organizerId"
      | "restartRequested"
      | "status"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organizer_and_user: ["organizerId", "userId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  organizer_user_directory_rebuilds: {
    document: {
      continueCursor?: string;
      organizerId: Id<"organizers">;
      restartRequested?: boolean;
      status: "queued" | "running";
      _id: Id<"organizer_user_directory_rebuilds">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "continueCursor"
      | "organizerId"
      | "restartRequested"
      | "status";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organizer: ["organizerId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  organizers: {
    document: {
      codeOfConduct?: string;
      contactInfo?: string;
      description?: string;
      email?: string;
      isPlatformOrganizer?: boolean;
      isPublicDirectory: boolean;
      logoStorageId?: Id<"_storage"> | null;
      name: string;
      slug?: string;
      status?: "draft" | "published";
      stripeChargesEnabled?: boolean;
      stripeConnectedAccountId?: string;
      stripeCurrentlyDue?: Array<string>;
      stripeOnboardingStatus?:
        | "not_started"
        | "in_progress"
        | "payout_settings_pending"
        | "complete"
        | "restricted";
      stripePayoutsEnabled?: boolean;
      vettingQuestions?: Array<{
        id: string;
        options?: Array<string>;
        question: string;
        required: boolean;
        type: "text" | "long_text" | "boolean" | "select" | "checkbox";
      }>;
      website?: string;
      _id: Id<"organizers">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "codeOfConduct"
      | "contactInfo"
      | "description"
      | "email"
      | "isPlatformOrganizer"
      | "isPublicDirectory"
      | "logoStorageId"
      | "name"
      | "slug"
      | "status"
      | "stripeChargesEnabled"
      | "stripeConnectedAccountId"
      | "stripeCurrentlyDue"
      | "stripeOnboardingStatus"
      | "stripePayoutsEnabled"
      | "vettingQuestions"
      | "website";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_isPlatformOrganizer: ["isPlatformOrganizer", "_creationTime"];
      by_isPublicDirectory: ["isPublicDirectory", "_creationTime"];
      by_slug: ["slug", "_creationTime"];
      by_stripeConnectedAccountId: [
        "stripeConnectedAccountId",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  payout_allocations: {
    document: {
      amountCents: number;
      batchId: Id<"payout_batches">;
      confirmedAt?: number;
      connectedAccountId: string;
      createdAt: number;
      eventId: Id<"events">;
      failureReason?: string;
      status: "pending_confirmation" | "paid" | "failed";
      stripePayoutId?: string;
      _id: Id<"payout_allocations">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "amountCents"
      | "batchId"
      | "confirmedAt"
      | "connectedAccountId"
      | "createdAt"
      | "eventId"
      | "failureReason"
      | "status"
      | "stripePayoutId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_batchId: ["batchId", "_creationTime"];
      by_connectedAccountId_and_status: [
        "connectedAccountId",
        "status",
        "_creationTime",
      ];
      by_eventId: ["eventId", "_creationTime"];
      by_stripePayoutId: ["stripePayoutId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  payout_batches: {
    document: {
      amountCents: number;
      confirmedAt?: number;
      connectedAccountId: string;
      createdAt: number;
      currency: "usd";
      failureReason?: string;
      idempotencyKey: string;
      origin?: "cron" | "external";
      status: "pending" | "submitted" | "paid" | "failed";
      stripePayoutId?: string;
      submittedAt?: number;
      _id: Id<"payout_batches">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "amountCents"
      | "confirmedAt"
      | "connectedAccountId"
      | "createdAt"
      | "currency"
      | "failureReason"
      | "idempotencyKey"
      | "origin"
      | "status"
      | "stripePayoutId"
      | "submittedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_connectedAccountId_and_status: [
        "connectedAccountId",
        "status",
        "_creationTime",
      ];
      by_idempotencyKey: ["idempotencyKey", "_creationTime"];
      by_status_and_createdAt: ["status", "createdAt", "_creationTime"];
      by_stripePayoutId: ["stripePayoutId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  resale_listings: {
    document: {
      buyerId?: Id<"users">;
      cancelledAt?: number;
      completedAt?: number;
      eventId: Id<"events">;
      lostProcessingFeeCents?: number;
      pendingOrderId?: Id<"ticket_orders">;
      resaleFeeCents?: number;
      sellerId: Id<"users">;
      sellerRefundAmountCents?: number;
      sellerRefundAttempts?: number;
      sellerRefundCompletedAt?: number;
      sellerRefundFailedAt?: number | null;
      sellerRefundLastError?: string | null;
      sellerRefundNextRetryAt?: number | null;
      sellerRefundState?: "pending" | "retrying" | "completed" | "failed";
      status: "listed" | "pending" | "completed" | "cancelled";
      ticketId: Id<"tickets">;
      _id: Id<"resale_listings">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "buyerId"
      | "cancelledAt"
      | "completedAt"
      | "eventId"
      | "lostProcessingFeeCents"
      | "pendingOrderId"
      | "resaleFeeCents"
      | "sellerId"
      | "sellerRefundAmountCents"
      | "sellerRefundAttempts"
      | "sellerRefundCompletedAt"
      | "sellerRefundFailedAt"
      | "sellerRefundLastError"
      | "sellerRefundNextRetryAt"
      | "sellerRefundState"
      | "status"
      | "ticketId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event_status: ["eventId", "status", "_creationTime"];
      by_seller_event: ["sellerId", "eventId", "_creationTime"];
      by_status: ["status", "_creationTime"];
      by_ticket: ["ticketId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  resale_notifications: {
    document: {
      email: string;
      eventId: Id<"events">;
      notifiedAt?: number;
      userId: Id<"users">;
      _id: Id<"resale_notifications">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "email"
      | "eventId"
      | "notifiedAt"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event: ["eventId", "_creationTime"];
      by_user_event: ["userId", "eventId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  stripe_webhook_events: {
    document: {
      attempts: number;
      claimedAt: number;
      completedAt?: number;
      failedAt?: number;
      failureReason?: "stale_timeout" | "order_not_found";
      orderId?: Id<"ticket_orders">;
      status: "pending" | "completed" | "failed";
      stripeEventId: string;
      stripeEventType: string;
      _id: Id<"stripe_webhook_events">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "attempts"
      | "claimedAt"
      | "completedAt"
      | "failedAt"
      | "failureReason"
      | "orderId"
      | "status"
      | "stripeEventId"
      | "stripeEventType";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_status_and_claimedAt: ["status", "claimedAt", "_creationTime"];
      by_status_and_failureReason: ["status", "failureReason", "_creationTime"];
      by_stripeEventId: ["stripeEventId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  testEmails: {
    document: {
      attachments?: Array<{
        cid?: string;
        contentType: string;
        filename: string;
        size: number;
      }>;
      headers?: Record<string, string>;
      html: string;
      subject: string;
      text?: string;
      to: string;
      _id: Id<"testEmails">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "attachments"
      | "headers"
      | `headers.${string}`
      | "html"
      | "subject"
      | "text"
      | "to";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_to: ["to", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  ticket_orders: {
    document: {
      amountCents: number;
      completedAt?: number;
      connectedAccountId?: string;
      currency: "USD";
      eventId: Id<"events">;
      expiresAt: number;
      guestSessionId?: Id<"guest_sessions">;
      kind: "primary" | "resale";
      quantity: number;
      releaseReason?:
        | "expired"
        | "payment_failed"
        | "cancelled"
        | "superseded"
        | "late_invalid";
      releasedAt?: number;
      resaleListingId?: Id<"resale_listings">;
      state: "open" | "completed" | "released";
      stripeChargeId?: string;
      stripeCheckoutSessionId?: string;
      stripePaymentIntentId?: string;
      tier: "regular" | "notaflof" | "supporter";
      trustSource: "direct" | "shared" | "open_access";
      trustViaOrganizerId?: Id<"organizers">;
      userId?: Id<"users">;
      _id: Id<"ticket_orders">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "amountCents"
      | "completedAt"
      | "connectedAccountId"
      | "currency"
      | "eventId"
      | "expiresAt"
      | "guestSessionId"
      | "kind"
      | "quantity"
      | "releasedAt"
      | "releaseReason"
      | "resaleListingId"
      | "state"
      | "stripeChargeId"
      | "stripeCheckoutSessionId"
      | "stripePaymentIntentId"
      | "tier"
      | "trustSource"
      | "trustViaOrganizerId"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event_and_state: ["eventId", "state", "_creationTime"];
      by_owner_guest_event_state: [
        "guestSessionId",
        "eventId",
        "state",
        "_creationTime",
      ];
      by_owner_guest_event_state_kind_amountCents_tier_quantity: [
        "guestSessionId",
        "eventId",
        "state",
        "kind",
        "amountCents",
        "tier",
        "quantity",
        "_creationTime",
      ];
      by_owner_user_event_state: [
        "userId",
        "eventId",
        "state",
        "_creationTime",
      ];
      by_owner_user_event_state_kind_amountCents_tier_quantity: [
        "userId",
        "eventId",
        "state",
        "kind",
        "amountCents",
        "tier",
        "quantity",
        "_creationTime",
      ];
      by_stripeCheckoutSessionId: ["stripeCheckoutSessionId", "_creationTime"];
      by_stripePaymentIntentId: ["stripePaymentIntentId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  ticketReminderSends: {
    document: {
      adminId: Id<"users">;
      eventId: Id<"events">;
      message: string;
      recipientCount: number;
      sentAt: number;
      subject: string;
      _id: Id<"ticketReminderSends">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "adminId"
      | "eventId"
      | "message"
      | "recipientCount"
      | "sentAt"
      | "subject";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event: ["eventId", "_creationTime"];
      by_event_and_sentAt: ["eventId", "sentAt", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  tickets: {
    document: {
      checkedInAt?: number;
      checkedInBy?: Id<"users">;
      eventId: Id<"events">;
      guestSessionId?: Id<"guest_sessions">;
      orderId?: Id<"ticket_orders">;
      qrCode?: string;
      rosterAttendeeName?: string;
      rosterAttendeeNameLower?: string;
      rosterCheckedInByName?: string | null;
      rosterEmail?: string | null;
      rosterEmailLower?: string | null;
      rosterIsActive?: boolean;
      rosterSortKey?: string;
      rosterStatus?: "valid" | "checked_in" | "refunded" | "cancelled";
      status: "valid" | "used" | "refunded" | "expired";
      tier: "regular" | "notaflof" | "supporter";
      userId?: Id<"users">;
      _id: Id<"tickets">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "checkedInAt"
      | "checkedInBy"
      | "eventId"
      | "guestSessionId"
      | "orderId"
      | "qrCode"
      | "rosterAttendeeName"
      | "rosterAttendeeNameLower"
      | "rosterCheckedInByName"
      | "rosterEmail"
      | "rosterEmailLower"
      | "rosterIsActive"
      | "rosterSortKey"
      | "rosterStatus"
      | "status"
      | "tier"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event_and_roster_active_and_sort: [
        "eventId",
        "rosterIsActive",
        "rosterSortKey",
        "_creationTime",
      ];
      by_event_and_roster_sort: ["eventId", "rosterSortKey", "_creationTime"];
      by_event_checkedInAt: ["eventId", "checkedInAt", "_creationTime"];
      by_event_status: ["eventId", "status", "_creationTime"];
      by_guestSession: ["guestSessionId", "_creationTime"];
      by_guestSession_event: ["guestSessionId", "eventId", "_creationTime"];
      by_order: ["orderId", "_creationTime"];
      by_user: ["userId", "_creationTime"];
      by_user_event: ["userId", "eventId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  users: {
    document: {
      authEmailVerified?: boolean;
      betterAuthUserId?: string;
      defaultCommunityAdminOrganizerId?: Id<"organizers">;
      email?: string;
      emailChangeToken?: string;
      emailChangeTokenExpiry?: number;
      emailVerificationTime?: number;
      globalMarketingOptOut?: boolean;
      image?: string;
      name?: string;
      pendingEmail?: string;
      socialSignupCompletionRequired?: boolean;
      termsAcceptedAt?: number;
      _id: Id<"users">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "authEmailVerified"
      | "betterAuthUserId"
      | "defaultCommunityAdminOrganizerId"
      | "email"
      | "emailChangeToken"
      | "emailChangeTokenExpiry"
      | "emailVerificationTime"
      | "globalMarketingOptOut"
      | "image"
      | "name"
      | "pendingEmail"
      | "socialSignupCompletionRequired"
      | "termsAcceptedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_betterAuthUserId: ["betterAuthUserId", "_creationTime"];
      by_defaultCommunityAdminOrganizerId: [
        "defaultCommunityAdminOrganizerId",
        "_creationTime",
      ];
      email: ["email", "_creationTime"];
    };
    searchIndexes: {
      search_name_email: {
        searchField: "name";
        filterFields: "email";
      };
    };
    vectorIndexes: {};
  };
};

/**
 * The names of all of your Convex tables.
 */
export type TableNames = TableNamesInDataModel<DataModel>;

/**
 * The type of a document stored in Convex.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Doc<TableName extends TableNames> = DocumentByName<
  DataModel,
  TableName
>;

/**
 * An identifier for a document in Convex.
 *
 * Convex documents are uniquely identified by their `Id`, which is accessible
 * on the `_id` field. To learn more, see [Document IDs](https://docs.convex.dev/using/document-ids).
 *
 * Documents can be loaded using `db.get(tableName, id)` in query and mutation functions.
 *
 * IDs are just strings at runtime, but this type can be used to distinguish them from other
 * strings when type checking.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Id<TableName extends TableNames | SystemTableNames> =
  GenericId<TableName>;
