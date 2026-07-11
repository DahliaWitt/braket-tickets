/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";
import type { GenericId as Id } from "convex/values";

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: {
  auth: {
    public: {
      cancelEmailChange: FunctionReference<"mutation", "public", {}, null>;
      changePassword: FunctionReference<
        "mutation",
        "public",
        {
          currentPassword: string;
          newPassword: string;
          revokeOtherSessions?: boolean;
        },
        null
      >;
      completeSocialSignupOnboarding: FunctionReference<
        "mutation",
        "public",
        {},
        null
      >;
      linkSocialAccount: FunctionReference<
        "mutation",
        "public",
        { callbackURL?: string; provider: "google" | "discord" },
        { url: string }
      >;
      requestEmailChange: FunctionReference<
        "mutation",
        "public",
        { callbackURL?: string; newEmail: string },
        { message?: string; success: boolean }
      >;
      setPassword: FunctionReference<
        "mutation",
        "public",
        { newPassword: string },
        null
      >;
      syncCurrentUser: FunctionReference<
        "mutation",
        "public",
        {},
        {
          reason?: "provider_email_missing" | "provider_email_unverified";
          requiresSocialSignupCompletion?: boolean;
          status: "synced" | "blocked";
        }
      >;
      unlinkSocialAccount: FunctionReference<
        "mutation",
        "public",
        { accountId?: string; provider: "google" | "discord" },
        null
      >;
    };
  };
  communities: {
    admins: {
      grant: FunctionReference<
        "mutation",
        "public",
        { organizerId?: Id<"organizers">; userId: Id<"users"> },
        null
      >;
      isMemberOf: FunctionReference<
        "query",
        "public",
        { organizerId: Id<"organizers"> },
        boolean
      >;
      listByCommunity: FunctionReference<
        "query",
        "public",
        { organizerId: Id<"organizers"> },
        Array<{
          _id: Id<"users">;
          displayName: string;
          email?: string;
          organizerId: Id<"organizers">;
          userId: Id<"users">;
        }>
      >;
      listMyCommunities: FunctionReference<
        "query",
        "public",
        {},
        Array<Id<"organizers">>
      >;
      revoke: FunctionReference<
        "mutation",
        "public",
        { organizerId?: Id<"organizers">; userId: Id<"users"> },
        null
      >;
    };
    applications: {
      getMyApplication: FunctionReference<
        "query",
        "public",
        {},
        {
          _creationTime: number;
          _id: Id<"applications">;
          answers: Record<string, string | Array<string> | boolean | number>;
          denyReason?: string;
          organizerId?: Id<"organizers">;
          processedBy?: Id<"users">;
          reason?: string;
          status: "pending" | "approved" | "rejected" | "revoked";
          userId: Id<"users">;
        } | null
      >;
      getMyApplicationForOrganizer: FunctionReference<
        "query",
        "public",
        { organizerId: Id<"organizers"> },
        {
          _creationTime: number;
          _id: Id<"applications">;
          answers: Record<string, string | Array<string> | boolean | number>;
          denyReason?: string;
          organizerId?: Id<"organizers">;
          processedBy?: Id<"users">;
          reason?: string;
          status: "pending" | "approved" | "rejected" | "revoked";
          userId: Id<"users">;
        } | null
      >;
      getMyApplications: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          _creationTime: number;
          _id: Id<"applications">;
          denyReason?: string;
          organizerId?: Id<"organizers">;
          organizerLogoUrl?: string;
          organizerName: string;
          organizerSlug?: string;
          organizerStatus?: "draft" | "published";
          reason?: string;
          status: "pending" | "approved" | "rejected" | "revoked";
        }>
      >;
      list: FunctionReference<
        "query",
        "public",
        {
          organizerId?: Id<"organizers">;
          status?: "pending" | "approved" | "rejected" | "revoked";
        },
        Array<{
          _creationTime: number;
          _id: Id<"applications">;
          answers: Record<string, string | Array<string> | boolean | number>;
          denyReason?: string;
          organizer: {
            _creationTime: number;
            _id: Id<"organizers">;
            contactInfo?: string;
            email?: string;
            name: string;
            vettingQuestions?: Array<{
              id: string;
              options?: Array<string>;
              question: string;
              required: boolean;
              type: "text" | "long_text" | "boolean" | "select" | "checkbox";
            }>;
          } | null;
          organizerId?: Id<"organizers">;
          processedBy?: Id<"users">;
          processor: {
            _creationTime: number;
            _id: Id<"users">;
            authEmailVerified?: boolean;
            betterAuthUserId?: string;
            email?: string;
            emailVerificationTime?: number;
            globalMarketingOptOut?: boolean;
            image?: string;
            name?: string;
            pendingEmail?: string;
            socialSignupCompletionRequired?: boolean;
            termsAcceptedAt?: number;
          } | null;
          reason?: string;
          status: "pending" | "approved" | "rejected" | "revoked";
          user: {
            _creationTime: number;
            _id: Id<"users">;
            authEmailVerified?: boolean;
            betterAuthUserId?: string;
            email?: string;
            emailVerificationTime?: number;
            globalMarketingOptOut?: boolean;
            image?: string;
            name?: string;
            pendingEmail?: string;
            socialSignupCompletionRequired?: boolean;
            termsAcceptedAt?: number;
          } | null;
          userId: Id<"users">;
        }>
      >;
      reinstate: FunctionReference<
        "mutation",
        "public",
        { applicationId: Id<"applications">; force?: boolean },
        null | {
          conflict: "newer_application";
          newerStatus: "pending" | "approved" | "rejected" | "revoked";
        }
      >;
      review: FunctionReference<
        "mutation",
        "public",
        {
          applicationId: Id<"applications">;
          denyReason?: string;
          reason?: string;
          status: "approved" | "rejected";
        },
        null
      >;
      revoke: FunctionReference<
        "mutation",
        "public",
        { applicationId: Id<"applications">; reason?: string },
        null
      >;
      submit: FunctionReference<
        "mutation",
        "public",
        {
          answers: Record<string, string | Array<string> | boolean | number>;
          organizerId?: Id<"organizers">;
        },
        Id<"applications">
      >;
    };
    directory: {
      listEventsDirectory: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          _id: Id<"organizers">;
          codeOfConduct?: string;
          description?: string;
          logoUrl?: string;
          name: string;
          slug?: string;
          status: "draft" | "published";
          website?: string;
        }>
      >;
    };
    invite_links: {
      create: FunctionReference<
        "mutation",
        "public",
        {
          expiresAt?: number;
          label?: string;
          maxRedemptions?: number;
          organizerId: Id<"organizers">;
        },
        { linkId: Id<"magic_links">; token: string; url: string }
      >;
      listMyLinks: FunctionReference<
        "query",
        "public",
        { organizerId: Id<"organizers"> },
        Array<{
          _creationTime: number;
          _id: Id<"magic_links">;
          expiresAt?: number;
          label?: string;
          lastUsedAt?: number;
          maxRedemptions?: number;
          redemptionCount: number;
          status: "active" | "paused" | "disabled";
          tokenPrefix?: string;
        }>
      >;
      listPastMyLinks: FunctionReference<
        "query",
        "public",
        { organizerId: Id<"organizers"> },
        Array<{
          _creationTime: number;
          _id: Id<"magic_links">;
          deletedAt: number;
          expiresAt?: number;
          label?: string;
          lastUsedAt?: number;
          maxRedemptions?: number;
          redemptionCount: number;
          status: "active" | "paused" | "disabled";
          tokenPrefix?: string;
        }>
      >;
      redeem: FunctionReference<
        "mutation",
        "public",
        { token: string },
        {
          alreadyMember: boolean;
          alreadyRedeemed: boolean;
          message: string;
          success: boolean;
        }
      >;
      updateStatus: FunctionReference<
        "mutation",
        "public",
        {
          action: "pause" | "resume" | "disable" | "delete";
          linkId: Id<"magic_links">;
        },
        { success: boolean }
      >;
      validateToken: FunctionReference<
        "query",
        "public",
        { now?: number; token: string },
        {
          communityName?: string;
          error?: "invalid" | "paused" | "disabled" | "expired" | "maxed";
          valid: boolean;
        }
      >;
    };
    list: {
      list: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          _creationTime: number;
          _id: Id<"organizers">;
          codeOfConduct?: string;
          contactInfo?: string;
          description?: string;
          email?: string;
          isPlatformOrganizer?: boolean;
          isPublicDirectory: boolean;
          logoStorageId?: Id<"_storage"> | null;
          logoUrl?: string;
          name: string;
          slug?: string;
          status?: "draft" | "published";
          vettingQuestions?: Array<{
            id: string;
            options?: Array<string>;
            question: string;
            required: boolean;
            type: "text" | "long_text" | "boolean" | "select" | "checkbox";
          }>;
          website?: string;
        }>
      >;
    };
    management: {
      audit: {
        listAuditLogs: FunctionReference<
          "query",
          "public",
          {
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
            organizerId: Id<"organizers">;
            paginationOpts: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            sinceTimestamp?: number;
          },
          {
            continueCursor: string;
            isDone: boolean;
            page: Array<{
              _creationTime: number;
              _id: Id<"adminAuditLogs">;
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
                | "imported_tickets.check-in"
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
              adminName: string;
              applicationId?: Id<"applications">;
              applicationUserName?: string;
              deletedEventName?: string;
              eventId?: Id<"events">;
              eventName?: string;
              magicLinkLabel?: string;
              reason?: string;
              source?: string;
              targetUserName?: string;
              trustLinkLabel?: string;
            }>;
            pageStatus?: "SplitRecommended" | "SplitRequired" | null;
            splitCursor?: string | null;
          }
        >;
      };
      invites: {
        inviteToExisting: FunctionReference<
          "mutation",
          "public",
          { email: string; organizerId: Id<"organizers"> },
          { inviteId: Id<"admin_invites">; inviteUrl: string }
        >;
        redeem: FunctionReference<
          "mutation",
          "public",
          { token: string },
          { organizerId: Id<"organizers"> }
        >;
      };
      notification_preferences: {
        getMyNotificationPreference: FunctionReference<
          "query",
          "public",
          { organizerId: Id<"organizers"> },
          null | { digestHour: number; mode: "all" | "digest" }
        >;
        setMyNotificationPreference: FunctionReference<
          "mutation",
          "public",
          {
            digestHour?: number;
            mode: "all" | "digest" | "off";
            organizerId: Id<"organizers">;
          },
          null
        >;
      };
    };
    profile: {
      create: FunctionReference<
        "mutation",
        "public",
        {
          codeOfConduct?: string;
          contactInfo?: string;
          description?: string;
          email?: string;
          isPublicDirectory?: boolean;
          name: string;
          slug?: string;
          status?: "draft" | "published";
          vettingQuestions?: Array<{
            id: string;
            options?: Array<string>;
            question: string;
            required: boolean;
            type: "text" | "long_text" | "boolean" | "select" | "checkbox";
          }>;
        },
        Id<"organizers">
      >;
      getAdmin: FunctionReference<
        "query",
        "public",
        { id: Id<"organizers"> },
        {
          _creationTime: number;
          _id: Id<"organizers">;
          codeOfConduct?: string;
          contactInfo?: string;
          description?: string;
          email?: string;
          isPlatformOrganizer?: boolean;
          isPublicDirectory: boolean;
          logoStorageId?: Id<"_storage"> | null;
          logoUrl?: string;
          name: string;
          organizerPaymentReady?: boolean;
          organizerPayoutReady?: boolean;
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
        } | null
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        { id: Id<"organizers"> },
        null
      >;
      setPlatformOrganizer: FunctionReference<
        "mutation",
        "public",
        { isPlatformOrganizer: boolean; organizerId: Id<"organizers"> },
        null
      >;
      update: FunctionReference<
        "mutation",
        "public",
        {
          codeOfConduct?: string;
          contactInfo?: string;
          description?: string;
          email?: string;
          id: Id<"organizers">;
          isPublicDirectory?: boolean;
          logoStorageId?: Id<"_storage"> | null;
          name?: string;
          slug?: string;
          status?: "draft" | "published";
          vettingQuestions?: Array<{
            id: string;
            options?: Array<string>;
            question: string;
            required: boolean;
            type: "text" | "long_text" | "boolean" | "select" | "checkbox";
          }>;
          website?: string;
        },
        null
      >;
    };
    public: {
      get: FunctionReference<
        "query",
        "public",
        { id: Id<"organizers"> },
        {
          _creationTime: number;
          _id: Id<"organizers">;
          codeOfConduct?: string;
          contactInfo?: string;
          description?: string;
          email?: string;
          isPlatformOrganizer?: boolean;
          isPublicDirectory: boolean;
          logoStorageId?: Id<"_storage"> | null;
          logoUrl?: string;
          name: string;
          slug?: string;
          status?: "draft" | "published";
          vettingQuestions?: Array<{
            id: string;
            options?: Array<string>;
            question: string;
            required: boolean;
            type: "text" | "long_text" | "boolean" | "select" | "checkbox";
          }>;
          website?: string;
        } | null
      >;
      getBySlugOrId: FunctionReference<
        "query",
        "public",
        { slugOrId: string },
        {
          _creationTime: number;
          _id: Id<"organizers">;
          codeOfConduct?: string;
          contactInfo?: string;
          description?: string;
          email?: string;
          isPlatformOrganizer?: boolean;
          isPublicDirectory: boolean;
          logoStorageId?: Id<"_storage"> | null;
          logoUrl?: string;
          name: string;
          slug?: string;
          status?: "draft" | "published";
          vettingQuestions?: Array<{
            id: string;
            options?: Array<string>;
            question: string;
            required: boolean;
            type: "text" | "long_text" | "boolean" | "select" | "checkbox";
          }>;
          website?: string;
        } | null
      >;
    };
    scanners: {
      grant: FunctionReference<
        "mutation",
        "public",
        { organizerId: Id<"organizers">; userId: Id<"users"> },
        null
      >;
      hasAnyAssignment: FunctionReference<"query", "public", {}, boolean>;
      listByCommunity: FunctionReference<
        "query",
        "public",
        { organizerId: Id<"organizers"> },
        Array<{
          _id: Id<"users">;
          displayName: string;
          email?: string;
          organizerId: Id<"organizers">;
          userId: Id<"users">;
        }>
      >;
      myScannerEvents: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          _creationTime: number;
          _id: Id<"events">;
          checkedInCount?: number;
          date: string;
          description?: string;
          endDate?: string;
          inventoryId?: Id<"event_inventory">;
          isSoldOut?: boolean;
          lastCheckInAt?: number | null;
          location?: string;
          maxTicketsPerUser?: number;
          organizerId: Id<"organizers">;
          paidOutAt?: number;
          poster?: string;
          posterUrl: string | null;
          price: number;
          resaleEnabled?: boolean;
          resaleFeePct?: number;
          slidingScaleEnabled?: boolean;
          slidingScaleMax?: number;
          slidingScaleMin?: number;
          soldCount?: number;
          status: "draft" | "published" | "cancelled";
          supporterDefaultPrice?: number;
          ticketSalesStatus?: "active" | "paused" | "ended";
          title: string;
          totalTickets: number;
          visibility: "private" | "public_viewable" | "public";
        }>
      >;
      revoke: FunctionReference<
        "mutation",
        "public",
        { organizerId: Id<"organizers">; userId: Id<"users"> },
        null
      >;
      searchGrantCandidates: FunctionReference<
        "query",
        "public",
        { organizerId: Id<"organizers">; searchTerm: string },
        Array<{
          _id: Id<"users">;
          displayName: string;
          email?: string;
          organizerId: Id<"organizers">;
          userId: Id<"users">;
        }>
      >;
    };
    trust_links: {
      checkUserTrust: FunctionReference<
        "query",
        "public",
        { organizerId: Id<"organizers"> },
        {
          source: "direct" | "shared" | null;
          trusted: boolean;
          via: { _id: Id<"organizers">; name: string } | null;
        }
      >;
      create: FunctionReference<
        "mutation",
        "public",
        {
          trustedOrganizerId: Id<"organizers">;
          trustingOrganizerId: Id<"organizers">;
        },
        null
      >;
      getUserApprovals: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          organizerId: Id<"organizers">;
          organizerLogoUrl?: string;
          organizerName: string;
          source: "direct" | "shared";
          viaOrganizerId?: Id<"organizers">;
          viaOrganizerName?: string;
        }>
      >;
      list: FunctionReference<
        "query",
        "public",
        { direction?: "outgoing" | "incoming"; organizerId: Id<"organizers"> },
        Array<{
          direction: "outgoing" | "incoming";
          trustedMemberCount?: number;
          trustedOrganizerId: Id<"organizers">;
          trustedOrganizerName: string;
          trustingOrganizerId: Id<"organizers">;
          trustingOrganizerName: string;
        }>
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        {
          trustedOrganizerId: Id<"organizers">;
          trustingOrganizerId: Id<"organizers">;
        },
        null
      >;
    };
  };
  events: {
    analytics: {
      getEventAttendeeRosterPage: FunctionReference<
        "query",
        "public",
        {
          eventId: Id<"events">;
          includeRefunded: boolean;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            attendeeName: string;
            checkedInAt: number | null;
            checkedInByName: string | null;
            email: string | null;
            purchaseDate: number;
            status: "valid" | "checked_in" | "refunded" | "cancelled";
            ticketId: Id<"tickets">;
            tierName: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        }
      >;
      getEventCheckInPostMortem: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events"> },
        {
          peakHourCount: number;
          peakHourStartsAt: number | null;
          totalCheckedIn: number;
        }
      >;
      getEventCheckInSummary: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events"> },
        {
          checkedIn: number;
          lastCheckInAt: number | null;
          rate: number;
          totalActive: number;
        }
      >;
      getRecentCheckIns: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events">; limit?: number },
        Array<{
          attendeeName: string;
          checkedInAt: number;
          checkedInByName: string | null;
          ticketId: Id<"tickets">;
          tierName: string;
        }>
      >;
      searchEventAttendeesPage: FunctionReference<
        "query",
        "public",
        {
          eventId: Id<"events">;
          includeRefunded: boolean;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          query: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            attendeeName: string;
            checkedInAt: number | null;
            checkedInByName: string | null;
            email: string | null;
            purchaseDate: number;
            status: "valid" | "checked_in" | "refunded" | "cancelled";
            ticketId: Id<"tickets">;
            tierName: string;
          }>;
        }
      >;
    };
    analytics_export: {
      exportEventRosterCsv: FunctionReference<
        "action",
        "public",
        { eventId: Id<"events">; includeRefunded: boolean },
        { csv: string; filename: string }
      >;
    };
    broadcasts: {
      getAudience: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events">; includeExternalTicketHolders?: boolean },
        {
          exceedsCap: boolean;
          importedReachableCount: number;
          importedUnreachableCount: number;
          recipientCount: number;
        }
      >;
      listHistory: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events"> },
        Array<{
          _id: Id<"eventBroadcasts">;
          adminName: string;
          recipientCount: number;
          sentAt: number;
          subject: string;
        }>
      >;
      send: FunctionReference<
        "mutation",
        "public",
        {
          bodyJson?: string;
          eventId: Id<"events">;
          includeExternalTicketHolders?: boolean;
          message: string;
          subject: string;
        },
        | { recipientCount: number; success: true }
        | {
            count?: number;
            error:
              | "event_not_found"
              | "validation_error"
              | "too_many_recipients"
              | "no_recipients"
              | "already_sent";
            message?: string;
            success: false;
          }
      >;
    };
    check_in: {
      checkIn: FunctionReference<
        "mutation",
        "public",
        { eventId?: string; guestId?: string; ticketId?: string },
        {
          guest?: {
            _creationTime: number;
            _id: Id<"guests">;
            checkedInAt?: number;
            checkedInBy?: Id<"users">;
            email?: string;
            event?: { date: string; location?: string; title: string };
            eventId: Id<"events">;
            name: string;
            notes?: string;
            type: "guest" | "artist guest" | "staff";
          };
          imported?: {
            _creationTime: number;
            _id: Id<"importedTicketHolders">;
            checkedInAt?: number;
            checkedInBy?: Id<"users">;
            event?: { date: string; location?: string; title: string };
            eventId: Id<"events">;
            name: string;
            sourceLabel: string;
            ticketTypeLabel?: string;
          };
          message: string;
          success: boolean;
          ticket?: {
            _creationTime: number;
            _id: Id<"tickets">;
            checkedInAt?: number;
            checkedInBy?: Id<"users">;
            event?: { date: string; location?: string; title: string };
            eventId: Id<"events">;
            guestSessionId?: Id<"guest_sessions">;
            status: "valid" | "used" | "refunded" | "expired";
            tier: "regular" | "notaflof" | "supporter";
            user?: { email?: string; name?: string };
            userId?: Id<"users">;
          };
        }
      >;
      revertCheckIn: FunctionReference<
        "mutation",
        "public",
        { ticketId: Id<"tickets"> },
        { message: string; success: boolean }
      >;
    };
    guest_actions: {
      getGuestTicketPdf: FunctionReference<
        "action",
        "public",
        { guestId: Id<"guests"> },
        string
      >;
      sendTicket: FunctionReference<
        "action",
        "public",
        { guestId: Id<"guests">; skipIfAlreadyEmailed?: boolean },
        { status: "sent" | "skipped" }
      >;
    };
    guests: {
      add: FunctionReference<
        "mutation",
        "public",
        {
          email?: string;
          eventId: Id<"events">;
          name: string;
          notes?: string;
          type: "guest" | "artist guest" | "staff";
        },
        Id<"guests">
      >;
      addMany: FunctionReference<
        "mutation",
        "public",
        {
          batchKey: string;
          eventId: Id<"events">;
          rows: Array<{
            email?: string;
            name: string;
            notes?: string;
            type?: string;
          }>;
        },
        {
          insertedCount: number;
          outcomes: Array<{
            reason?: string;
            rowIndex: number;
            status: "inserted" | "skipped" | "invalid";
          }>;
          skippedCount: number;
        }
      >;
      listByEvent: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events"> },
        Array<{
          _creationTime: number;
          _id: Id<"guests">;
          checkedInAt?: number;
          checkedInBy?: Id<"users">;
          email?: string;
          emailSendLockedAt?: number | null;
          emailedAt?: number;
          eventId: Id<"events">;
          name: string;
          notes?: string;
          type: "guest" | "artist guest" | "staff";
        }>
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        { id: Id<"guests"> },
        null
      >;
      update: FunctionReference<
        "mutation",
        "public",
        {
          email?: string;
          id: Id<"guests">;
          name: string;
          notes?: string;
          type: "guest" | "artist guest" | "staff";
        },
        null
      >;
    };
    imported_tickets: {
      checkIn: FunctionReference<
        "mutation",
        "public",
        { id: Id<"importedTicketHolders"> },
        | {
            alreadyCheckedIn: boolean;
            entry: {
              _creationTime: number;
              _id: Id<"importedTicketHolders">;
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
            };
            success: true;
          }
        | { message: string; success: false }
      >;
      importBatch: FunctionReference<
        "mutation",
        "public",
        {
          batchKey: string;
          dedupMode: "skip" | "include";
          eventId: Id<"events">;
          rows: Array<{
            email?: string;
            externalRef?: string;
            name: string;
            orderRef?: string;
            purchaseDateRaw?: string;
            ticketTypeLabel?: string;
          }>;
          sourceLabel?: string;
        },
        {
          insertedCount: number;
          outcomes: Array<{
            reason?: string;
            rowIndex: number;
            status: "inserted" | "skipped" | "invalid";
          }>;
          skippedCount: number;
        }
      >;
      listByEvent: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events"> },
        Array<{
          _creationTime: number;
          _id: Id<"importedTicketHolders">;
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
        }>
      >;
      removeBatch: FunctionReference<
        "mutation",
        "public",
        { batchKey: string; eventId: Id<"events"> },
        { checkedInCount: number; removedCount: number }
      >;
      removeEntry: FunctionReference<
        "mutation",
        "public",
        { id: Id<"importedTicketHolders"> },
        null
      >;
    };
    management: {
      adminList: FunctionReference<
        "query",
        "public",
        { organizerId?: Id<"organizers"> },
        Array<{
          _creationTime: number;
          _id: Id<"events">;
          checkedInCount?: number;
          date: string;
          description?: string;
          endDate?: string;
          hasAnyTickets?: boolean;
          hasCompletedOrders?: boolean;
          inventoryId?: Id<"event_inventory">;
          isSoldOut?: boolean;
          lastCheckInAt?: number | null;
          location?: string;
          maxTicketsPerUser?: number;
          organizerId: Id<"organizers">;
          paidOutAt?: number;
          poster?: string;
          posterUrl: string | null;
          price: number;
          resaleEnabled?: boolean;
          resaleFeePct?: number;
          slidingScaleEnabled?: boolean;
          slidingScaleMax?: number;
          slidingScaleMin?: number;
          soldCount?: number;
          status: "draft" | "published" | "cancelled";
          supporterDefaultPrice?: number;
          ticketSalesStatus?: "active" | "paused" | "ended";
          title: string;
          totalTickets: number;
          visibility: "private" | "public_viewable" | "public";
        }>
      >;
      create: FunctionReference<
        "mutation",
        "public",
        {
          announcement?:
            | { mode: "skip" }
            | { mode: "now" }
            | { mode: "scheduled"; scheduledFor: number };
          date: string;
          description?: string;
          endDate?: string;
          location?: string;
          maxTicketsPerUser?: number;
          organizerId: Id<"organizers">;
          poster?: string;
          price: number;
          sliderConfig?: { enabled: boolean; max?: number; min?: number };
          status: "draft" | "published" | "cancelled";
          supporterDefaultPrice?: number;
          title: string;
          totalTickets: number;
          visibility: "private" | "public_viewable" | "public";
        },
        Id<"events">
      >;
      getForEdit: FunctionReference<
        "query",
        "public",
        { id: Id<"events"> },
        {
          _creationTime: number;
          _id: Id<"events">;
          checkedInCount?: number;
          date: string;
          description?: string;
          endDate?: string;
          inventoryId?: Id<"event_inventory">;
          isPlatformOrganizer: boolean;
          lastCheckInAt?: number | null;
          location?: string;
          maxTicketsPerUser?: number;
          organizerId: Id<"organizers">;
          organizerPaymentReady: boolean;
          paidOutAt?: number;
          poster?: string;
          posterUrl: string | null;
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
        }
      >;
      getManagementPurchases: FunctionReference<
        "action",
        "public",
        { eventId: Id<"events"> },
        {
          event: {
            _creationTime: number;
            _id: Id<"events">;
            checkedInCount?: number;
            date: string;
            description?: string;
            endDate?: string;
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
          };
          purchases: Array<{
            amount: number;
            createdAt: number;
            id: Id<"ticket_orders">;
            quantity: number;
            refundedAmountCents?: number;
            status: "completed" | "refunded";
            tickets: Array<{
              id: Id<"tickets">;
              status: "valid" | "used" | "refunded" | "expired";
              tier: "regular" | "notaflof" | "supporter";
            }>;
            tier: "regular" | "notaflof" | "supporter";
            userEmail?: string;
            userId?: Id<"users">;
            userName: string;
          }>;
        }
      >;
      getManagementResale: FunctionReference<
        "action",
        "public",
        { eventId: Id<"events"> },
        {
          event: {
            _creationTime: number;
            _id: Id<"events">;
            checkedInCount?: number;
            date: string;
            description?: string;
            endDate?: string;
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
          };
          resaleListings: Array<{
            _creationTime: number;
            _id: Id<"resale_listings">;
            buyerId?: Id<"users">;
            buyerName?: string;
            cancelledAt?: number;
            completedAt?: number;
            eventId: Id<"events">;
            lostProcessingFeeCents?: number;
            pendingOrderId?: Id<"ticket_orders">;
            resaleFeeCents?: number;
            sellerEmail?: string;
            sellerId: Id<"users">;
            sellerName: string;
            sellerRefundAmountCents?: number;
            sellerRefundAttempts?: number;
            sellerRefundCompletedAt?: number;
            sellerRefundFailedAt?: number | null;
            sellerRefundLastError?: string | null;
            sellerRefundNextRetryAt?: number | null;
            sellerRefundState?: "pending" | "retrying" | "completed" | "failed";
            status: "listed" | "pending" | "completed" | "cancelled";
            ticketId: Id<"tickets">;
          }>;
          resaleMetrics: {
            activeListings: number;
            cancelledListings: number;
            completedResales: number;
            notificationSubscribers: number;
            pendingListings: number;
            totalListings: number;
            totalLostProcessingFeesCents: number;
            totalRefundedToSellersCents: number;
            totalResaleFeesCents: number;
          };
        }
      >;
      getManagementSummary: FunctionReference<
        "action",
        "public",
        { eventId: Id<"events"> },
        {
          checkInStats: {
            buckets: Array<{ count: number; time: number }>;
            checkInRate: number;
            checkedIn: number;
          };
          event: {
            _creationTime: number;
            _id: Id<"events">;
            checkedInCount?: number;
            date: string;
            description?: string;
            endDate?: string;
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
          };
          heldCount: number;
          imported: {
            bySource: Array<{
              checkedIn: number;
              sourceLabel: string;
              total: number;
            }>;
            checkedIn: number;
            total: number;
          };
          isSoldOut: boolean;
          remainingCount: number;
          revenue: {
            grossCents: number;
            lostProcessingFeeCents: number;
            netCents: number;
            platformFeeCents: number;
            processingFeeCents: number;
            refundedCents: number;
          };
          revenueByTier: {
            notaflof: {
              grossCents: number;
              netCents: number;
              quantity: number;
            };
            regular: { grossCents: number; netCents: number; quantity: number };
            supporter: {
              grossCents: number;
              netCents: number;
              quantity: number;
            };
          };
          salesByDay: Array<{ date: string; quantity: number }>;
          soldCount: number;
          tierCounts: { notaflof: number; regular: number; supporter: number };
          totalTickets: number;
        }
      >;
      remove: FunctionReference<
        "mutation",
        "public",
        { id: Id<"events"> },
        null
      >;
      update: FunctionReference<
        "mutation",
        "public",
        {
          announcement?:
            | { mode: "skip" }
            | { mode: "now" }
            | { mode: "scheduled"; scheduledFor: number };
          date?: string;
          description?: string;
          endDate?: string | null;
          id: Id<"events">;
          location?: string;
          maxTicketsPerUser?: number;
          organizerId?: Id<"organizers">;
          poster?: string;
          price?: number;
          resaleEnabled?: boolean;
          resaleFeePct?: number;
          sliderConfig?: { enabled: boolean; max?: number; min?: number };
          slidingScaleEnabled?: boolean;
          slidingScaleMax?: number;
          slidingScaleMin?: number;
          status?: "draft" | "published" | "cancelled";
          supporterDefaultPrice?: number;
          ticketSalesStatus?: "active" | "paused" | "ended";
          title?: string;
          totalTickets?: number;
          visibility?: "private" | "public_viewable" | "public";
        },
        null
      >;
    };
    pricing: {
      getEventTierPricingStats: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events"> },
        {
          tiers: Array<{
            count: number;
            max: number;
            mean: number;
            median: number;
            min: number;
            mode: Array<number>;
            tier: "regular" | "notaflof" | "supporter";
          }>;
        }
      >;
    };
    public: {
      get: FunctionReference<
        "query",
        "public",
        { id: Id<"events"> },
        null | {
          _creationTime: number;
          _id: Id<"events">;
          checkedInCount?: number;
          date: string;
          description?: string;
          endDate?: string;
          guestCount: number;
          inventoryId?: Id<"event_inventory">;
          isPlatformOrganizer: boolean;
          lastCheckInAt?: number | null;
          location?: string;
          maxTicketsPerUser?: number;
          organizer: {
            _id: Id<"organizers">;
            codeOfConduct?: string;
            contactInfo?: string;
            email?: string;
            logoUrl?: string;
            name: string;
            slug?: string;
          } | null;
          organizerId: Id<"organizers">;
          organizerPaymentReady: boolean;
          paidOutAt?: number;
          poster?: string;
          posterUrl: string | null;
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
        }
      >;
      getAvailability: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events">; now: number },
        | null
        | {
            isSoldOut: boolean;
            isSubscribedToResaleNotifications?: boolean;
            purchaseAccess:
              | { allowed: true; source: "open_access" }
              | { allowed: true; source: "direct" }
              | {
                  allowed: true;
                  source: "shared";
                  viaOrganizerId: Id<"organizers">;
                }
              | { allowed: false };
            remainingTickets: number;
            resaleAvailable?: number;
            resaleEnabled?: boolean;
            soldCount: number;
            ticketSalesStatus?: "active" | "paused" | "ended";
            totalTickets: number;
            userTicketCount?: number;
          }
        | {
            isSoldOut: boolean;
            isSubscribedToResaleNotifications?: boolean;
            purchaseAccess:
              | { allowed: true; source: "open_access" }
              | { allowed: true; source: "direct" }
              | {
                  allowed: true;
                  source: "shared";
                  viaOrganizerId: Id<"organizers">;
                }
              | { allowed: false };
            remainingTickets?: number;
            resaleAvailable?: number;
            resaleEnabled?: boolean;
            soldCount?: number;
            ticketSalesStatus?: "active" | "paused" | "ended";
            totalTickets?: number;
            userTicketCount?: number;
          }
      >;
      getBatchAvailability: FunctionReference<
        "query",
        "public",
        { eventIds: Array<Id<"events">>; now: number },
        Record<
          string,
          | null
          | {
              isSoldOut: boolean;
              isSubscribedToResaleNotifications?: boolean;
              purchaseAccess:
                | { allowed: true; source: "open_access" }
                | { allowed: true; source: "direct" }
                | {
                    allowed: true;
                    source: "shared";
                    viaOrganizerId: Id<"organizers">;
                  }
                | { allowed: false };
              remainingTickets: number;
              resaleAvailable?: number;
              resaleEnabled?: boolean;
              soldCount: number;
              ticketSalesStatus?: "active" | "paused" | "ended";
              totalTickets: number;
              userTicketCount?: number;
            }
          | {
              isSoldOut: boolean;
              isSubscribedToResaleNotifications?: boolean;
              purchaseAccess:
                | { allowed: true; source: "open_access" }
                | { allowed: true; source: "direct" }
                | {
                    allowed: true;
                    source: "shared";
                    viaOrganizerId: Id<"organizers">;
                  }
                | { allowed: false };
              remainingTickets?: number;
              resaleAvailable?: number;
              resaleEnabled?: boolean;
              soldCount?: number;
              ticketSalesStatus?: "active" | "paused" | "ended";
              totalTickets?: number;
              userTicketCount?: number;
            }
        >
      >;
      list: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          _creationTime: number;
          _id: Id<"events">;
          checkedInCount?: number;
          date: string;
          description?: string;
          endDate?: string;
          inventoryId?: Id<"event_inventory">;
          isSoldOut?: boolean;
          lastCheckInAt?: number | null;
          location?: string;
          maxTicketsPerUser?: number;
          organizerId: Id<"organizers">;
          paidOutAt?: number;
          poster?: string;
          posterUrl: string | null;
          price: number;
          resaleEnabled?: boolean;
          resaleFeePct?: number;
          slidingScaleEnabled?: boolean;
          slidingScaleMax?: number;
          slidingScaleMin?: number;
          soldCount?: number;
          status: "draft" | "published" | "cancelled";
          supporterDefaultPrice?: number;
          ticketSalesStatus?: "active" | "paused" | "ended";
          title: string;
          totalTickets: number;
          visibility: "private" | "public_viewable" | "public";
        }>
      >;
      listByOrganizer: FunctionReference<
        "query",
        "public",
        {
          communityParam?: string;
          organizerId?: Id<"organizers">;
          slug?: string;
        },
        null | {
          events: Array<{
            _creationTime: number;
            _id: Id<"events">;
            checkedInCount?: number;
            date: string;
            description?: string;
            endDate?: string;
            inventoryId?: Id<"event_inventory">;
            isSoldOut?: boolean;
            lastCheckInAt?: number | null;
            location?: string;
            maxTicketsPerUser?: number;
            organizerId: Id<"organizers">;
            paidOutAt?: number;
            poster?: string;
            posterUrl: string | null;
            price: number;
            resaleEnabled?: boolean;
            resaleFeePct?: number;
            slidingScaleEnabled?: boolean;
            slidingScaleMax?: number;
            slidingScaleMin?: number;
            soldCount?: number;
            status: "draft" | "published" | "cancelled";
            supporterDefaultPrice?: number;
            ticketSalesStatus?: "active" | "paused" | "ended";
            title: string;
            totalTickets: number;
            visibility: "private" | "public_viewable" | "public";
          }>;
          organizerCodeOfConduct?: string;
          organizerDescription?: string;
          organizerLogoUrl?: string;
          organizerName: string;
        }
      >;
      upcoming: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          _creationTime: number;
          _id: Id<"events">;
          checkedInCount?: number;
          date: string;
          description?: string;
          endDate?: string;
          inventoryId?: Id<"event_inventory">;
          isSoldOut?: boolean;
          lastCheckInAt?: number | null;
          location?: string;
          maxTicketsPerUser?: number;
          organizerId: Id<"organizers">;
          paidOutAt?: number;
          poster?: string;
          posterUrl: string | null;
          price: number;
          resaleEnabled?: boolean;
          resaleFeePct?: number;
          slidingScaleEnabled?: boolean;
          slidingScaleMax?: number;
          slidingScaleMin?: number;
          soldCount?: number;
          status: "draft" | "published" | "cancelled";
          supporterDefaultPrice?: number;
          ticketSalesStatus?: "active" | "paused" | "ended";
          title: string;
          totalTickets: number;
          visibility: "private" | "public_viewable" | "public";
        }>
      >;
    };
    reminders: {
      getTicketReminderAudience: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events"> },
        {
          missingOrganizer: boolean;
          recipientCount: number;
          segment: "approved_no_ticket";
        }
      >;
      sendTicketPurchaseReminder: FunctionReference<
        "mutation",
        "public",
        {
          bodyJson?: string;
          eventId: Id<"events">;
          message: string;
          subject: string;
        },
        { recipientCount: number; segment: "approved_no_ticket" }
      >;
    };
  };
  guest_sessions: {
    actions: {
      initiateGuestSession: FunctionReference<
        "action",
        "public",
        {
          email: string;
          eventId?: Id<"events">;
          existingSessionToken?: string;
          magicLinkToken?: string;
        },
        { sessionToken: string }
      >;
    };
  };
  marketing: {
    emails: {
      cancelAnnouncement: FunctionReference<
        "mutation",
        "public",
        { eventMarketingEmailId: Id<"eventMarketingEmails"> },
        null
      >;
      clearGlobalMarketingOptOut: FunctionReference<
        "mutation",
        "public",
        {},
        null
      >;
      getAnnouncementStatus: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events"> },
        {
          _id: Id<"eventMarketingEmails">;
          recipientCount?: number;
          scheduledFor: number;
          sentAt?: number;
          status: "scheduled" | "sent" | "cancelled";
          totalClickCount: number;
          totalOpenCount: number;
          uniqueClickCount: number;
          uniqueOpenCount: number;
        } | null
      >;
      getGlobalOptOutStatus: FunctionReference<"query", "public", {}, boolean>;
      getRecipientCount: FunctionReference<
        "query",
        "public",
        {
          audienceScope?: "community" | "community_and_trusted";
          eventId?: Id<"events">;
          organizerId?: Id<"organizers">;
        },
        {
          cappedAt500: boolean;
          count: number;
          directCount: number;
          totalCount: number;
          trustLinkedCount: number;
        }
      >;
      getUserPreferences: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          isAdmin: boolean;
          optedIn: boolean;
          organizerId: Id<"organizers">;
          organizerLogoStorageId?: Id<"_storage"> | null;
          organizerName: string;
        }>
      >;
      reEnableAll: FunctionReference<"mutation", "public", {}, null>;
      scheduleAnnouncement: FunctionReference<
        "mutation",
        "public",
        {
          audienceScope?: "community" | "community_and_trusted";
          eventId: Id<"events">;
          scheduledFor: number;
        },
        Id<"eventMarketingEmails">
      >;
      unsubscribeAll: FunctionReference<"mutation", "public", {}, null>;
      updateMarketingPreference: FunctionReference<
        "mutation",
        "public",
        { optedIn: boolean; organizerId: Id<"organizers"> },
        null
      >;
    };
  };
  orders: {
    core: {
      claimFreeTicket: FunctionReference<
        "mutation",
        "public",
        {
          eventId: Id<"events">;
          quantity: number;
          tier: "regular" | "notaflof" | "supporter";
        },
        { orderId: Id<"ticket_orders">; success: boolean }
      >;
      claimFreeTicketAsGuest: FunctionReference<
        "mutation",
        "public",
        {
          eventId: Id<"events">;
          quantity: number;
          sessionToken: string;
          termsAccepted: boolean;
          tier: "regular" | "notaflof" | "supporter";
        },
        { orderId: Id<"ticket_orders">; success: boolean }
      >;
      getCheckoutStatus: FunctionReference<
        "query",
        "public",
        { orderId: Id<"ticket_orders">; sessionToken?: string },
        {
          completedAt?: number;
          expiresAt: number;
          kind: "primary" | "resale";
          orderId: Id<"ticket_orders">;
          releasedAt?: number;
          state: "open" | "completed" | "released";
        }
      >;
      listMyOrders: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          _id: Id<"ticket_orders">;
          amountCents: number;
          completedAt?: number;
          eventId: Id<"events">;
          expiresAt: number;
          kind: "primary" | "resale";
          quantity: number;
          releaseReason?:
            | "expired"
            | "payment_failed"
            | "cancelled"
            | "superseded"
            | "late_invalid";
          releasedAt?: number;
          state: "open" | "completed" | "released";
          tier: "regular" | "notaflof" | "supporter";
        }>
      >;
      open: FunctionReference<
        "mutation",
        "public",
        {
          eventId: Id<"events">;
          quantity: number;
          tier: "regular" | "notaflof" | "supporter";
          totalAmount: number;
        },
        {
          expiresAt: number;
          orderId: Id<"ticket_orders">;
          state: "open" | "completed" | "released";
        }
      >;
      openForGuest: FunctionReference<
        "mutation",
        "public",
        {
          eventId: Id<"events">;
          quantity: number;
          sessionToken: string;
          termsAccepted: boolean;
          tier: "regular" | "notaflof" | "supporter";
          totalAmount: number;
        },
        {
          expiresAt: number;
          orderId: Id<"ticket_orders">;
          state: "open" | "completed" | "released";
        }
      >;
      openResale: FunctionReference<
        "mutation",
        "public",
        {
          eventId: Id<"events">;
          tier: "regular" | "notaflof" | "supporter";
          totalAmount: number;
        },
        {
          expiresAt: number;
          orderId: Id<"ticket_orders">;
          state: "open" | "completed" | "released";
        }
      >;
      startCheckout: FunctionReference<
        "action",
        "public",
        {
          checkoutTheme?: "light" | "dark";
          orderId: Id<"ticket_orders">;
          sessionToken?: string;
        },
        {
          clientSecret: string;
          connectedAccountId: string | null;
          expiresAt: number;
          orderId: Id<"ticket_orders">;
          stripeCheckoutSessionId: string;
        }
      >;
      syncCheckoutSession: FunctionReference<
        "action",
        "public",
        { checkoutSessionId: string; sessionToken?: string },
        {
          completedAt?: number;
          expiresAt: number;
          kind: "primary" | "resale";
          orderId: Id<"ticket_orders">;
          releasedAt?: number;
          state: "open" | "completed" | "released";
        }
      >;
    };
  };
  payments: {
    refunds: {
      forceRefundAll: FunctionReference<
        "action",
        "public",
        { orderId: Id<"ticket_orders"> },
        {
          lostProcessingFee: number;
          refundedAmount: number;
          success: boolean;
          ticketsRefunded: number;
        }
      >;
      refund: FunctionReference<
        "action",
        "public",
        { orderId: Id<"ticket_orders"> },
        {
          lostProcessingFee: number;
          refundedAmount: number;
          success: boolean;
          ticketsRefunded: number;
        }
      >;
      refundTicket: FunctionReference<
        "action",
        "public",
        { ticketId: Id<"tickets"> },
        { lostProcessingFee: number; refundedAmount: number; success: boolean }
      >;
    };
  };
  resale: {
    listings: {
      cancelResaleListing: FunctionReference<
        "mutation",
        "public",
        { listingId: Id<"resale_listings"> },
        null
      >;
      getMyResaleListings: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events"> },
        Array<{
          _creationTime: number;
          _id: Id<"resale_listings">;
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
        }>
      >;
      getMyResaleListingsBatch: FunctionReference<
        "query",
        "public",
        { eventIds: Array<Id<"events">> },
        Record<
          string,
          Array<{
            _creationTime: number;
            _id: Id<"resale_listings">;
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
          }>
        >
      >;
      listTicketForResale: FunctionReference<
        "mutation",
        "public",
        { ticketId: Id<"tickets"> },
        Id<"resale_listings">
      >;
      subscribeToResaleNotifications: FunctionReference<
        "mutation",
        "public",
        { eventId: Id<"events"> },
        Id<"resale_notifications">
      >;
      unsubscribeFromResaleNotifications: FunctionReference<
        "mutation",
        "public",
        { eventId: Id<"events"> },
        null
      >;
    };
  };
  root_admin: {
    invites: {
      cancel: FunctionReference<
        "mutation",
        "public",
        { inviteId: Id<"admin_invites"> },
        null
      >;
      createWithCommunity: FunctionReference<
        "mutation",
        "public",
        { communityName: string; email: string },
        {
          inviteId: Id<"admin_invites">;
          inviteUrl: string;
          organizerId: Id<"organizers">;
        }
      >;
    };
  };
  seed: {
    actions: {
      clearBetterAuthUsers: FunctionReference<
        "action",
        "public",
        { emails: Array<string>; seedToken: string },
        null
      >;
      seedUserAndGetTokens: FunctionReference<
        "action",
        "public",
        {
          email: string;
          includeAuthArtifacts?: boolean;
          name: string;
          password: string;
          seedToken: string;
          verifyBetterAuth?: boolean;
        },
        {
          cookies: Array<{
            domain: string;
            expires: number;
            httpOnly: boolean;
            name: string;
            path: string;
            sameSite?: "Strict" | "Lax" | "None";
            secure: boolean;
            value: string;
          }>;
          email: string;
          refreshToken: string;
          token: string;
          userId: Id<"users">;
        }
      >;
    };
    ops: {
      checkSeedExists: FunctionReference<
        "query",
        "public",
        { seedToken: string },
        boolean
      >;
      clearAll: FunctionReference<
        "mutation",
        "public",
        { keepUsers?: boolean; seedToken: string },
        null
      >;
      generateUploadUrl: FunctionReference<
        "mutation",
        "public",
        { seedToken: string },
        string
      >;
      seedDemoData: FunctionReference<
        "mutation",
        "public",
        {
          barneyId: Id<"users">;
          charlieId: Id<"users">;
          cherylId: Id<"users">;
          cooperId: Id<"users">;
          kimId: Id<"users">;
          logoIds?: {
            lot45: Id<"_storage">;
            midnightSound: Id<"_storage">;
            sisterCity: Id<"_storage">;
          };
          nomiId: Id<"users">;
          posterIds?: {
            concreteWax: string;
            lowFrequency: string;
            nightMarket: string;
            rooftopListening: string;
            springFundraiser: string;
          };
          seedToken: string;
          stripeAccountLot45?: string;
          stripeAccountLot45Status?: {
            chargesEnabled: boolean;
            currentlyDue: Array<string>;
            onboardingStatus:
              | "not_started"
              | "in_progress"
              | "payout_settings_pending"
              | "complete"
              | "restricted";
            payoutsEnabled: boolean;
            userRequirementsClear: boolean;
          };
          stripeAccountSisterCity?: string;
          stripeAccountSisterCityStatus?: {
            chargesEnabled: boolean;
            currentlyDue: Array<string>;
            onboardingStatus:
              | "not_started"
              | "in_progress"
              | "payout_settings_pending"
              | "complete"
              | "restricted";
            payoutsEnabled: boolean;
            userRequirementsClear: boolean;
          };
          tobiasId: Id<"users">;
        },
        {
          communities: {
            deepEndId: Id<"organizers">;
            lot45Id: Id<"organizers">;
            midnightSoundId: Id<"organizers">;
            sisterCityId: Id<"organizers">;
          };
          events: {
            backyardSessionsId: Id<"events">;
            concreteWaxId: Id<"events">;
            lowFrequencyId: Id<"events">;
            nightMarketId: Id<"events">;
            rooftopListeningId: Id<"events">;
            springFundraiserId: Id<"events">;
          };
        }
      >;
      seedSandboxPurchaseFixture: FunctionReference<
        "mutation",
        "public",
        {
          eventDate?: string;
          eventPrice?: number;
          eventTitle?: string;
          organizerEmail?: string;
          organizerName?: string;
          organizerSlug?: string;
          seedToken: string;
          stripeConnectedAccountId: string;
          totalTickets?: number;
          visibility?: "private" | "public_viewable" | "public";
        },
        {
          eventCreated: boolean;
          eventId: Id<"events">;
          eventPath: string;
          organizerCreated: boolean;
          organizerId: Id<"organizers">;
        }
      >;
    };
  };
  storage: {
    files: {
      confirmUpload: FunctionReference<
        "action",
        "public",
        { mimeType: string; storageId: Id<"_storage"> },
        {
          error?: string;
          storageId?: Id<"_storage">;
          url?: string;
          valid: boolean;
        }
      >;
      generateUploadUrl: FunctionReference<"mutation", "public", {}, string>;
      validateUpload: FunctionReference<
        "mutation",
        "public",
        { fileName: string; fileSize: number; mimeType: string },
        { error?: string; valid: boolean }
      >;
    };
  };
  stripe: {
    actions: {
      checkAccountStatus: FunctionReference<
        "action",
        "public",
        { organizerId: Id<"organizers"> },
        {
          chargeReady: boolean;
          chargesEnabled: boolean;
          currentlyDue: Array<string>;
          onboardingStatus:
            | "not_started"
            | "in_progress"
            | "payout_settings_pending"
            | "complete"
            | "restricted";
          payoutReady: boolean;
          payoutsEnabled: boolean;
          userRequirementsClear: boolean;
        }
      >;
      createAccountOnboardingLink: FunctionReference<
        "action",
        "public",
        { organizerId: Id<"organizers">; returnOrigin?: string },
        { url: string }
      >;
      createAccountSession: FunctionReference<
        "action",
        "public",
        {
          components: {
            accountManagement?: boolean;
            accountOnboarding?: boolean;
            balances?: boolean;
            documents?: boolean;
            notificationBanner?: boolean;
            payments?: boolean;
          };
          organizerId: Id<"organizers">;
        },
        { clientSecret: string }
      >;
      createConnectedAccount: FunctionReference<
        "action",
        "public",
        { organizerId: Id<"organizers"> },
        { alreadyExists: boolean; stripeConnectedAccountId: string }
      >;
    };
  };
  testing: {
    admin: {
      getLatestAuditLog: FunctionReference<
        "query",
        "public",
        { action?: string; adminId?: Id<"users">; eventId?: Id<"events"> },
        {
          _creationTime: number;
          _id: Id<"adminAuditLogs">;
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
            | "imported_tickets.check-in"
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
        } | null
      >;
      seedAdminInvite: FunctionReference<
        "mutation",
        "public",
        {
          communityName: string;
          email: string;
          expiresAt?: number;
          invitedBy: Id<"users">;
          organizerId: Id<"organizers">;
          redeemedAt?: number;
          redeemedBy?: Id<"users">;
          status?: "pending" | "redeemed" | "cancelled";
          token?: string;
        },
        Id<"admin_invites">
      >;
      seedAdminNotificationPreference: FunctionReference<
        "mutation",
        "public",
        {
          digestHour?: number;
          mode?: "all" | "digest";
          organizerId: Id<"organizers">;
          userId: Id<"users">;
        },
        Id<"adminNotificationPreferences">
      >;
    };
    applications: {
      seedApplication: FunctionReference<
        "mutation",
        "public",
        {
          answers?: Record<string, string | Array<string> | boolean | number>;
          denyReason?: string;
          organizerId?: Id<"organizers">;
          processedBy?: Id<"users">;
          reason?: string;
          status: "pending" | "approved" | "rejected" | "revoked";
          userId: Id<"users">;
        },
        Id<"applications">
      >;
      seedApprovedApplication: FunctionReference<
        "mutation",
        "public",
        { organizerId: Id<"organizers">; userId: Id<"users"> },
        Id<"applications">
      >;
    };
    communities: {
      seedCommunityAdmin: FunctionReference<
        "mutation",
        "public",
        {
          grantedBy: Id<"users">;
          organizerId: Id<"organizers">;
          userId: Id<"users">;
        },
        null
      >;
      seedCommunityScanner: FunctionReference<
        "mutation",
        "public",
        {
          grantedBy: Id<"users">;
          organizerId: Id<"organizers">;
          userId: Id<"users">;
        },
        null
      >;
      seedOrganizer: FunctionReference<
        "mutation",
        "public",
        {
          codeOfConduct?: string;
          contactInfo?: string;
          description?: string;
          email?: string;
          isPlatformOrganizer?: boolean;
          isPublicDirectory?: boolean;
          logoStorageId?: Id<"_storage"> | null;
          name: string;
          slug?: string;
          status?: "draft" | "published";
          stripeChargesEnabled?: boolean;
          stripeConnectedAccountId?: string;
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
        },
        Id<"organizers">
      >;
      seedOrganizerNoVetting: FunctionReference<
        "mutation",
        "public",
        { name: string },
        Id<"organizers">
      >;
    };
    demo: {
      seedDemoData: FunctionReference<
        "mutation",
        "public",
        {
          barneyId: Id<"users">;
          charlieId: Id<"users">;
          cherylId: Id<"users">;
          cooperId: Id<"users">;
          kimId: Id<"users">;
          logoIds?: {
            lot45: Id<"_storage">;
            midnightSound: Id<"_storage">;
            sisterCity: Id<"_storage">;
          };
          nomiId: Id<"users">;
          posterIds?: {
            concreteWax: string;
            lowFrequency: string;
            nightMarket: string;
            rooftopListening: string;
            springFundraiser: string;
          };
          stripeAccountLot45?: string;
          stripeAccountLot45Status?: {
            chargesEnabled: boolean;
            currentlyDue: Array<string>;
            onboardingStatus:
              | "not_started"
              | "in_progress"
              | "payout_settings_pending"
              | "complete"
              | "restricted";
            payoutsEnabled: boolean;
            userRequirementsClear: boolean;
          };
          stripeAccountSisterCity?: string;
          stripeAccountSisterCityStatus?: {
            chargesEnabled: boolean;
            currentlyDue: Array<string>;
            onboardingStatus:
              | "not_started"
              | "in_progress"
              | "payout_settings_pending"
              | "complete"
              | "restricted";
            payoutsEnabled: boolean;
            userRequirementsClear: boolean;
          };
          tobiasId: Id<"users">;
        },
        {
          communities: {
            deepEndId: Id<"organizers">;
            lot45Id: Id<"organizers">;
            midnightSoundId: Id<"organizers">;
            sisterCityId: Id<"organizers">;
          };
          events: {
            backyardSessionsId: Id<"events">;
            concreteWaxId: Id<"events">;
            lowFrequencyId: Id<"events">;
            nightMarketId: Id<"events">;
            rooftopListeningId: Id<"events">;
            springFundraiserId: Id<"events">;
          };
        }
      >;
    };
    email: {
      getSentEmails: FunctionReference<
        "query",
        "public",
        { to: string },
        Array<{
          _creationTime: number;
          _id: Id<"testEmails">;
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
        }>
      >;
      logSentEmail: FunctionReference<
        "mutation",
        "public",
        {
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
        },
        null
      >;
    };
    events: {
      getEvent: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events"> },
        {
          _creationTime: number;
          _id: Id<"events">;
          checkedInCount?: number;
          date: string;
          description?: string;
          endDate?: string;
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
        } | null
      >;
      seedEvent: FunctionReference<
        "mutation",
        "public",
        {
          date: string;
          description?: string;
          endDate?: string;
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
          soldCount?: number;
          status?: "draft" | "published" | "cancelled";
          supporterDefaultPrice?: number;
          ticketSalesStatus?: "active" | "paused" | "ended";
          title: string;
          totalTickets?: number;
          visibility?: "private" | "public_viewable" | "public";
        },
        Id<"events">
      >;
      seedEventsBatch: FunctionReference<
        "mutation",
        "public",
        {
          events: Array<{
            date: string;
            description?: string;
            endDate?: string;
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
            soldCount?: number;
            status?: "draft" | "published" | "cancelled";
            supporterDefaultPrice?: number;
            ticketSalesStatus?: "active" | "paused" | "ended";
            title: string;
            totalTickets?: number;
            visibility?: "private" | "public_viewable" | "public";
          }>;
        },
        Array<Id<"events">>
      >;
      seedEventWithInventory: FunctionReference<
        "mutation",
        "public",
        {
          heldCount: number;
          organizerId: Id<"organizers">;
          soldCount: number;
          title: string;
          totalTickets: number;
        },
        Id<"events">
      >;
      seedEventWithMismatchedInventory: FunctionReference<
        "mutation",
        "public",
        { organizerId: Id<"organizers"> },
        { eventId: Id<"events">; otherEventId: Id<"events"> }
      >;
      seedEventWithoutInventory: FunctionReference<
        "mutation",
        "public",
        { organizerId: Id<"organizers">; title: string; totalTickets: number },
        Id<"events">
      >;
    };
    guest_sessions: {
      getGuestSessionByEmail: FunctionReference<
        "query",
        "public",
        { email: string },
        {
          _creationTime: number;
          _id: Id<"guest_sessions">;
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
        } | null
      >;
      seedGuestSession: FunctionReference<
        "mutation",
        "public",
        {
          clientKey?: string;
          convertedToUserId?: Id<"users">;
          email: string;
          expiresAt?: number;
          lastActiveAt?: number;
          magicLinkId?: Id<"magic_links">;
          sessionToken: string;
        },
        Id<"guest_sessions">
      >;
    };
    guests: {
      seedGuest: FunctionReference<
        "mutation",
        "public",
        {
          email?: string;
          eventId: Id<"events">;
          name: string;
          notes?: string;
          type: "guest" | "artist guest" | "staff";
        },
        Id<"guests">
      >;
    };
    magic_links: {
      seedMagicLink: FunctionReference<
        "mutation",
        "public",
        {
          createdBy: Id<"users">;
          expiresAt?: number;
          label?: string;
          maxRedemptions?: number;
          organizerId?: Id<"organizers">;
          status?: "active" | "paused" | "disabled";
          token?: string;
        },
        { linkId: Id<"magic_links">; token: string }
      >;
      seedMagicLinkRedemption: FunctionReference<
        "mutation",
        "public",
        {
          guestSessionId?: Id<"guest_sessions">;
          magicLinkId: Id<"magic_links">;
          userId?: Id<"users">;
        },
        Id<"magic_link_redemption_log">
      >;
    };
    marketing: {
      seedAddressMarketingPreference: FunctionReference<
        "mutation",
        "public",
        {
          email: string;
          optedIn: boolean;
          organizerId: Id<"organizers">;
          unsubToken: string;
        },
        Id<"emailAddressMarketingPreferences">
      >;
      seedMarketingPreference: FunctionReference<
        "mutation",
        "public",
        {
          optedIn: boolean;
          organizerId: Id<"organizers">;
          unsubToken: string;
          userId: Id<"users">;
        },
        Id<"marketingEmailPreferences">
      >;
    };
    orders: {
      seedPayment: FunctionReference<
        "mutation",
        "public",
        {
          amount: number;
          eventId: Id<"events">;
          guestSessionId?: Id<"guest_sessions">;
          quantity?: number;
          status: "pending" | "completed" | "refunded";
          stripePaymentIntentId?: string;
          tier?: "regular" | "notaflof" | "supporter";
          trustSource: "direct" | "shared" | "open_access";
          trustViaOrganizerId?: Id<"organizers">;
          userId: Id<"users">;
        },
        Id<"ticket_orders">
      >;
      seedSandboxPurchaseFixture: FunctionReference<
        "mutation",
        "public",
        {
          eventDate?: string;
          eventPrice?: number;
          eventTitle?: string;
          organizerEmail?: string;
          organizerName?: string;
          organizerSlug?: string;
          stripeConnectedAccountId: string;
          totalTickets?: number;
          visibility?: "private" | "public_viewable" | "public";
        },
        {
          eventCreated: boolean;
          eventId: Id<"events">;
          eventPath: string;
          organizerCreated: boolean;
          organizerId: Id<"organizers">;
        }
      >;
    };
    resale: {
      seedResaleListing: FunctionReference<
        "mutation",
        "public",
        {
          buyerId?: Id<"users">;
          cancelledAt?: number;
          completedAt?: number;
          eventId: Id<"events">;
          lostProcessingFeeCents?: number;
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
        },
        Id<"resale_listings">
      >;
    };
    tickets: {
      seedTicket: FunctionReference<
        "mutation",
        "public",
        {
          eventId: Id<"events">;
          guestSessionId?: Id<"guest_sessions">;
          orderId?: Id<"ticket_orders">;
          status: "valid" | "used" | "refunded" | "expired";
          tier: "regular" | "notaflof" | "supporter";
          trustSource?: "direct" | "shared" | "open_access";
          trustViaOrganizerId?: Id<"organizers">;
          userId: Id<"users">;
        },
        Id<"tickets">
      >;
    };
    token_migration_fixtures: {
      seedLegacyTokenRows: FunctionReference<
        "mutation",
        "public",
        {
          email: string;
          eventId: Id<"events">;
          organizerId: Id<"organizers">;
          userId: Id<"users">;
        },
        {
          addressPreferenceId: Id<"emailAddressMarketingPreferences">;
          adminInviteId: Id<"admin_invites">;
          guestSessionId: Id<"guest_sessions">;
          magicLinkId: Id<"magic_links">;
          marketingDeliveryId: Id<"marketingEmailDeliveries">;
          tokens: {
            addressUnsubscribe: string;
            adminInvite: string;
            emailChange: string;
            guestSession: string;
            magicLink: string;
            trackingClick: string;
            trackingOpen: string;
            userUnsubscribe: string;
          };
          userPreferenceId: Id<"marketingEmailPreferences">;
        }
      >;
    };
    trust_links: {
      seedTrustLink: FunctionReference<
        "mutation",
        "public",
        {
          createdBy: Id<"users">;
          status?: "active" | "paused" | "revoked";
          trustedOrganizerId: Id<"organizers">;
          trustingOrganizerId: Id<"organizers">;
        },
        null
      >;
    };
    users: {
      createUserDirectly: FunctionReference<
        "mutation",
        "public",
        {
          authEmailVerified?: boolean;
          betterAuthUserId?: string;
          email: string;
          isRootAdmin?: boolean;
          name: string;
          socialSignupCompletionRequired?: boolean;
          termsAcceptedAt?: number;
        },
        Id<"users">
      >;
      getByEmail: FunctionReference<
        "query",
        "public",
        { email: string },
        {
          _creationTime: number;
          _id: Id<"users">;
          authEmailVerified?: boolean;
          betterAuthUserId?: string;
          email?: string;
          emailVerificationTime?: number;
          globalMarketingOptOut?: boolean;
          image?: string;
          name?: string;
          pendingEmail?: string;
          socialSignupCompletionRequired?: boolean;
          termsAcceptedAt?: number;
        } | null
      >;
      getUserByEmail: FunctionReference<
        "query",
        "public",
        { email: string },
        {
          _creationTime: number;
          _id: Id<"users">;
          authEmailVerified?: boolean;
          betterAuthUserId?: string;
          email?: string;
          emailVerificationTime?: number;
          globalMarketingOptOut?: boolean;
          image?: string;
          name?: string;
          pendingEmail?: string;
          socialSignupCompletionRequired?: boolean;
          termsAcceptedAt?: number;
        } | null
      >;
      makeUserVetted: FunctionReference<
        "mutation",
        "public",
        { email?: string; organizerId: Id<"organizers">; userId?: Id<"users"> },
        null
      >;
      seedAppUser: FunctionReference<
        "mutation",
        "public",
        { email: string; name?: string },
        Id<"users">
      >;
      setRootAdminStatus: FunctionReference<
        "mutation",
        "public",
        { isRootAdmin: boolean; userId: Id<"users"> },
        null
      >;
      verifyAccountAndUser: FunctionReference<
        "mutation",
        "public",
        { email: string; verifyBetterAuth?: boolean },
        null
      >;
    };
    users_node: {
      seedUserAndGetTokens: FunctionReference<
        "action",
        "public",
        {
          email: string;
          includeAuthArtifacts?: boolean;
          name: string;
          password: string;
          verifyBetterAuth?: boolean;
        },
        {
          cookies: Array<{
            domain: string;
            expires: number;
            httpOnly: boolean;
            name: string;
            path: string;
            sameSite?: "Strict" | "Lax" | "None";
            secure: boolean;
            value: string;
          }>;
          email: string;
          refreshToken: string;
          token: string;
          userId: Id<"users">;
        }
      >;
    };
    utilities: {
      checkSeedExists: FunctionReference<"query", "public", {}, boolean>;
      clearAll: FunctionReference<
        "mutation",
        "public",
        { keepUsers?: boolean },
        null
      >;
      clearBetterAuthUsers: FunctionReference<
        "action",
        "public",
        { emails: Array<string> },
        null
      >;
      generateSeedUploadUrl: FunctionReference<
        "mutation",
        "public",
        {},
        string
      >;
      resetRateLimit: FunctionReference<
        "mutation",
        "public",
        {
          key: string;
          name: "requestEmailChange" | "cancelEmailChange" | "broadcastEmail";
        },
        null
      >;
    };
  };
  tickets: {
    actions: {
      generateTicketPdf: FunctionReference<
        "action",
        "public",
        { orderId: Id<"ticket_orders"> },
        string
      >;
      getMyTicketPdf: FunctionReference<
        "action",
        "public",
        { ticketId: Id<"tickets"> },
        string
      >;
    };
    public: {
      get: FunctionReference<
        "query",
        "public",
        { id: Id<"tickets"> },
        {
          _creationTime: number;
          _id: Id<"tickets">;
          checkedInAt?: number;
          checkedInBy?: Id<"users">;
          event: {
            _creationTime: number;
            _id: Id<"events">;
            checkedInCount?: number;
            date: string;
            description?: string;
            endDate?: string;
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
          } | null;
          eventId: Id<"events">;
          guestEmail?: string;
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
          user: {
            _id: Id<"users">;
            email?: string;
            image?: string;
            name?: string;
          } | null;
          userId?: Id<"users">;
        } | null
      >;
      getMyTickets: FunctionReference<
        "query",
        "public",
        {},
        Array<{
          _creationTime: number;
          _id: Id<"tickets">;
          checkedInAt?: number;
          checkedInBy?: Id<"users">;
          event: {
            _creationTime: number;
            _id: Id<"events">;
            checkedInCount?: number;
            date: string;
            description?: string;
            endDate?: string;
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
          } | null;
          eventId: Id<"events">;
          guestEmail?: string;
          guestSessionId?: Id<"guest_sessions">;
          orderId?: Id<"ticket_orders">;
          qrCode?: string;
          resaleSellerSettlement?: {
            lostProcessingFeeCents: number;
            resaleFeeCents: number;
            sellerPaidAmount: number;
            sellerRefundAmount: number;
          };
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
        }>
      >;
      listByEvent: FunctionReference<
        "query",
        "public",
        { eventId: Id<"events"> },
        Array<{
          _creationTime: number;
          _id: Id<"tickets">;
          checkedInAt?: number;
          checkedInBy?: Id<"users">;
          eventId: Id<"events">;
          guestEmail?: string;
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
          user: {
            _id: Id<"users">;
            email?: string;
            image?: string;
            name?: string;
          } | null;
          userId?: Id<"users">;
        }>
      >;
    };
  };
  users: {
    profile: {
      current: FunctionReference<
        "query",
        "public",
        {},
        {
          _creationTime: number;
          _id: Id<"users">;
          authEmailVerified?: boolean;
          betterAuthUserId?: string;
          communityAdminOrganizerIds: Array<Id<"organizers">>;
          defaultCommunityAdminOrganizerId?: Id<"organizers">;
          email?: string;
          emailVerificationTime?: number;
          globalMarketingOptOut?: boolean;
          id: Id<"users">;
          image?: string;
          isRootAdmin: boolean;
          name?: string;
          pendingEmail?: string;
          socialSignupCompletionRequired?: boolean;
          termsAcceptedAt?: number;
        } | null
      >;
      findByExactEmailForAdmin: FunctionReference<
        "query",
        "public",
        { email: string; organizerId: Id<"organizers"> },
        { _id: Id<"users">; email?: string } | null
      >;
      get: FunctionReference<
        "query",
        "public",
        { id: Id<"users"> },
        {
          _creationTime: number;
          _id: Id<"users">;
          authEmailVerified?: boolean;
          betterAuthUserId?: string;
          email?: string;
          emailVerificationTime?: number;
          globalMarketingOptOut?: boolean;
          image?: string;
          name?: string;
          pendingEmail?: string;
          socialSignupCompletionRequired?: boolean;
          termsAcceptedAt?: number;
        } | null
      >;
      getConnectedAccounts: FunctionReference<
        "action",
        "public",
        {},
        Array<{
          created: string;
          id: string;
          isEmailVerified?: boolean;
          provider: string;
          providerEmail?: string;
          providerId: string;
          updated?: string;
        }>
      >;
      list: FunctionReference<
        "query",
        "public",
        { organizerId?: Id<"organizers"> },
        Array<{
          _creationTime: number;
          _id: Id<"users">;
          authEmailVerified?: boolean;
          betterAuthUserId?: string;
          email?: string;
          emailVerificationTime?: number;
          globalMarketingOptOut?: boolean;
          image?: string;
          name?: string;
          pendingEmail?: string;
          socialSignupCompletionRequired?: boolean;
          termsAcceptedAt?: number;
        }>
      >;
      listWithApplications: FunctionReference<
        "query",
        "public",
        {
          organizerId: Id<"organizers">;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          search?: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            application: {
              _creationTime: number;
              _id: Id<"applications">;
              answers: Record<
                string,
                string | Array<string> | boolean | number
              >;
              denyReason?: string;
              organizerId?: Id<"organizers">;
              processedBy?: Id<"users">;
              reason?: string;
              status: "pending" | "approved" | "rejected" | "revoked";
              userId: Id<"users">;
            } | null;
            communityAccessSource?:
              | "approved_application"
              | "magic_link"
              | "direct_member"
              | "shared";
            isCommunityAdmin?: boolean;
            trustedViaOrganizerName?: string;
            user: {
              _creationTime: number;
              _id: Id<"users">;
              authEmailVerified?: boolean;
              betterAuthUserId?: string;
              email?: string;
              emailVerificationTime?: number;
              globalMarketingOptOut?: boolean;
              image?: string;
              name?: string;
              pendingEmail?: string;
              socialSignupCompletionRequired?: boolean;
              termsAcceptedAt?: number;
            };
          }>;
        }
      >;
      revokeMembership: FunctionReference<
        "mutation",
        "public",
        { organizerId: Id<"organizers">; userId: Id<"users"> },
        null
      >;
      search: FunctionReference<
        "query",
        "public",
        { organizerId?: Id<"organizers">; query: string },
        Array<{
          _creationTime: number;
          _id: Id<"users">;
          authEmailVerified?: boolean;
          betterAuthUserId?: string;
          email?: string;
          emailVerificationTime?: number;
          globalMarketingOptOut?: boolean;
          image?: string;
          name?: string;
          pendingEmail?: string;
          socialSignupCompletionRequired?: boolean;
          termsAcceptedAt?: number;
        }>
      >;
      setDefaultCommunityAdminOrganizer: FunctionReference<
        "mutation",
        "public",
        { organizerId: Id<"organizers"> },
        null
      >;
      update: FunctionReference<
        "mutation",
        "public",
        { image?: string; name?: string },
        null
      >;
    };
  };
};

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: {
  auth: {
    sync: {
      backfillAuthUserLinks: FunctionReference<
        "mutation",
        "internal",
        { actorUserId?: Id<"users">; cursor?: string | null },
        {
          collisionSample: Array<string>;
          collisions: number;
          continueCursor: string | null;
          isDone: boolean;
          linked: number;
          processed: number;
          skipped: number;
        }
      >;
      syncUser: FunctionReference<
        "mutation",
        "internal",
        {
          authEmailVerified?: boolean;
          betterAuthUserId: string;
          email?: string;
          emailVerificationTime?: number;
          image?: string;
          name?: string;
          socialSignupCompletionRequired?: boolean;
        },
        {
          created: boolean;
          requiresSocialSignupCompletion: boolean;
          userId: Id<"users">;
        }
      >;
    };
  };
  communities: {
    directory: {
      getBySlugInternal: FunctionReference<
        "query",
        "internal",
        { slug: string },
        {
          _id: Id<"organizers">;
          codeOfConduct?: string;
          description?: string;
          logoUrl?: string;
          name: string;
          slug?: string;
          status: "draft" | "published";
          website?: string;
        } | null
      >;
      listPublicDirectoryInternal: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _id: Id<"organizers">;
          codeOfConduct?: string;
          description?: string;
          logoUrl?: string;
          name: string;
          slug?: string;
          status: "draft" | "published";
          website?: string;
        }>
      >;
      users: {
        propagateMembershipChangeToTrustingOrganizersInternal: FunctionReference<
          "mutation",
          "internal",
          {
            organizerId: Id<"organizers">;
            paginationOpts?: {
              cursor: string | null;
              endCursor?: string | null;
              id?: number;
              maximumBytesRead?: number;
              maximumRowsRead?: number;
              numItems: number;
            };
            userId: Id<"users">;
          },
          {
            continueCursor: string;
            isDone: boolean;
            processedOrganizers: number;
          }
        >;
        runOrganizerDirectoryRebuildInternal: FunctionReference<
          "mutation",
          "internal",
          { organizerId: Id<"organizers"> },
          {
            continueCursor: string;
            isDone: boolean;
            processedUsers: number;
            restarted: boolean;
          }
        >;
      };
    };
    management: {
      audit: {
        cleanupOldAuditLogs: FunctionReference<
          "mutation",
          "internal",
          { cutoffTimestamp?: number },
          number
        >;
        logAdminAccess: FunctionReference<
          "mutation",
          "internal",
          {
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
              | "imported_tickets.check-in"
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
            adminId: Id<"users">;
            applicationId?: Id<"applications">;
            eventId?: Id<"events">;
            ipAddress?: string;
            organizerId?: Id<"organizers">;
            source?: string;
            targetUserId?: Id<"users">;
            userAgent?: string;
          },
          null
        >;
        recordCheckIn: FunctionReference<
          "mutation",
          "internal",
          {
            action:
              | "ticket.check-in"
              | "guest.check-in"
              | "imported_tickets.check-in";
            adminId: Id<"users">;
            eventId?: Id<"events">;
            ipAddress?: string;
            organizerId?: Id<"organizers">;
            source?: string;
            userAgent?: string;
          },
          null
        >;
      };
    };
    profile: {
      getInternal: FunctionReference<
        "query",
        "internal",
        { id: Id<"organizers"> },
        {
          _creationTime: number;
          _id: Id<"organizers">;
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
        } | null
      >;
    };
  };
  email: {
    email_delivery: {
      cleanupOldDeliveries: FunctionReference<"mutation", "internal", {}, null>;
      cleanupOldFailures: FunctionReference<"mutation", "internal", {}, null>;
      cleanupResendComponent: FunctionReference<
        "mutation",
        "internal",
        {},
        null
      >;
      hasDelivery: FunctionReference<
        "query",
        "internal",
        {
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
        },
        boolean
      >;
      recordDelivery: FunctionReference<
        "mutation",
        "internal",
        {
          critical: boolean;
          emailId: string;
          fallback: boolean;
          manual: boolean;
          provider: "resend" | "smtp";
          recipient: string;
          resendId?: string;
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
        },
        null
      >;
      recordFailure: FunctionReference<
        "mutation",
        "internal",
        {
          error: string;
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
        },
        null
      >;
    };
    resend: {
      getCircuitState: FunctionReference<
        "query",
        "internal",
        {},
        { openUntil?: number }
      >;
      handleEmailEvent: FunctionReference<
        "mutation",
        "internal",
        {
          event:
            | {
                created_at: string;
                data: {
                  bcc?: string | Array<string>;
                  broadcast_id?: string;
                  cc?: string | Array<string>;
                  created_at: string;
                  email_id: string;
                  from: string | Array<string>;
                  headers?: Array<{ name: string; value: string }>;
                  reply_to?: string | Array<string>;
                  subject: string;
                  tags?:
                    | Record<string, string>
                    | Array<{ name: string; value: string }>;
                  to: string | Array<string>;
                };
                type: "email.sent";
              }
            | {
                created_at: string;
                data: {
                  bcc?: string | Array<string>;
                  broadcast_id?: string;
                  cc?: string | Array<string>;
                  created_at: string;
                  email_id: string;
                  from: string | Array<string>;
                  headers?: Array<{ name: string; value: string }>;
                  reply_to?: string | Array<string>;
                  subject: string;
                  tags?:
                    | Record<string, string>
                    | Array<{ name: string; value: string }>;
                  to: string | Array<string>;
                };
                type: "email.delivered";
              }
            | {
                created_at: string;
                data: {
                  bcc?: string | Array<string>;
                  broadcast_id?: string;
                  cc?: string | Array<string>;
                  created_at: string;
                  email_id: string;
                  from: string | Array<string>;
                  headers?: Array<{ name: string; value: string }>;
                  reply_to?: string | Array<string>;
                  subject: string;
                  tags?:
                    | Record<string, string>
                    | Array<{ name: string; value: string }>;
                  to: string | Array<string>;
                };
                type: "email.delivery_delayed";
              }
            | {
                created_at: string;
                data: {
                  bcc?: string | Array<string>;
                  broadcast_id?: string;
                  cc?: string | Array<string>;
                  created_at: string;
                  email_id: string;
                  from: string | Array<string>;
                  headers?: Array<{ name: string; value: string }>;
                  reply_to?: string | Array<string>;
                  subject: string;
                  tags?:
                    | Record<string, string>
                    | Array<{ name: string; value: string }>;
                  to: string | Array<string>;
                };
                type: "email.complained";
              }
            | {
                created_at: string;
                data: {
                  bcc?: string | Array<string>;
                  bounce: { message: string; subType: string; type: string };
                  broadcast_id?: string;
                  cc?: string | Array<string>;
                  created_at: string;
                  email_id: string;
                  from: string | Array<string>;
                  headers?: Array<{ name: string; value: string }>;
                  reply_to?: string | Array<string>;
                  subject: string;
                  tags?:
                    | Record<string, string>
                    | Array<{ name: string; value: string }>;
                  to: string | Array<string>;
                };
                type: "email.bounced";
              }
            | {
                created_at: string;
                data: {
                  bcc?: string | Array<string>;
                  broadcast_id?: string;
                  cc?: string | Array<string>;
                  created_at: string;
                  email_id: string;
                  from: string | Array<string>;
                  headers?: Array<{ name: string; value: string }>;
                  open: {
                    ipAddress: string;
                    timestamp: string;
                    userAgent: string;
                  };
                  reply_to?: string | Array<string>;
                  subject: string;
                  tags?:
                    | Record<string, string>
                    | Array<{ name: string; value: string }>;
                  to: string | Array<string>;
                };
                type: "email.opened";
              }
            | {
                created_at: string;
                data: {
                  bcc?: string | Array<string>;
                  broadcast_id?: string;
                  cc?: string | Array<string>;
                  click: {
                    ipAddress: string;
                    link: string;
                    timestamp: string;
                    userAgent: string;
                  };
                  created_at: string;
                  email_id: string;
                  from: string | Array<string>;
                  headers?: Array<{ name: string; value: string }>;
                  reply_to?: string | Array<string>;
                  subject: string;
                  tags?:
                    | Record<string, string>
                    | Array<{ name: string; value: string }>;
                  to: string | Array<string>;
                };
                type: "email.clicked";
              }
            | {
                created_at: string;
                data: {
                  bcc?: string | Array<string>;
                  broadcast_id?: string;
                  cc?: string | Array<string>;
                  created_at: string;
                  email_id: string;
                  failed: { reason: string };
                  from: string | Array<string>;
                  headers?: Array<{ name: string; value: string }>;
                  reply_to?: string | Array<string>;
                  subject: string;
                  tags?:
                    | Record<string, string>
                    | Array<{ name: string; value: string }>;
                  to: string | Array<string>;
                };
                type: "email.failed";
              };
          id: string;
        },
        null
      >;
      recordResendSuccess: FunctionReference<"mutation", "internal", {}, null>;
      recordTransientFailure: FunctionReference<
        "mutation",
        "internal",
        {},
        null
      >;
    };
    resend_actions: {
      send: FunctionReference<
        "action",
        "internal",
        {
          attachments?: Array<{
            cid?: string;
            content: string;
            contentType?: string;
            encoding?: string;
            filename: string;
          }>;
          critical?: boolean;
          headers?: Record<string, string>;
          html: string;
          recipient: string;
          requireDelivery?: boolean;
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
          subject: string;
          text?: string;
          to: string;
        },
        null
      >;
    };
    smtp: {
      sendFallback: FunctionReference<
        "action",
        "internal",
        {
          attachments?: Array<{
            cid?: string;
            content: string;
            contentType?: string;
            encoding?: string;
            filename: string;
          }>;
          headers?: Record<string, string>;
          html: string;
          subject: string;
          text?: string;
          to: string;
        },
        null
      >;
      sendPreview: FunctionReference<
        "action",
        "internal",
        {
          attachments?: Array<{
            cid?: string;
            content: string;
            contentType?: string;
            encoding?: string;
            filename: string;
          }>;
          critical?: boolean;
          headers?: Record<string, string>;
          html: string;
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
          subject: string;
          text?: string;
          to: string;
        },
        null
      >;
    };
  };
  events: {
    analytics: {
      _getEventAttendeeRosterInternal: FunctionReference<
        "query",
        "internal",
        { eventId: Id<"events">; includeRefunded: boolean },
        Array<{
          attendeeName: string;
          checkedInAt: number | null;
          checkedInByName: string | null;
          email: string | null;
          purchaseDate: number;
          status: "valid" | "checked_in" | "refunded" | "cancelled";
          ticketId: Id<"tickets">;
          tierName: string;
        }>
      >;
      recordRosterExport: FunctionReference<
        "mutation",
        "internal",
        {
          adminId: Id<"users">;
          eventId: Id<"events">;
          includeRefunded: boolean;
          organizerId: Id<"organizers">;
          rowCount: number;
        },
        null
      >;
    };
    broadcasts: {
      deliverMissed: FunctionReference<
        "mutation",
        "internal",
        { email: string; eventId: Id<"events">; userId?: Id<"users"> },
        null
      >;
    };
    guests: {
      beginGuestTicketSend: FunctionReference<
        "mutation",
        "internal",
        { id: Id<"guests">; requireUnsent: boolean },
        {
          claimed: boolean;
          lockToken: number | null;
          reason: "claimed" | "already_sent" | "in_flight" | "not_found";
        }
      >;
      clearGuestTicketSendLock: FunctionReference<
        "mutation",
        "internal",
        { id: Id<"guests">; lockToken: number },
        null
      >;
      getInternal: FunctionReference<
        "query",
        "internal",
        { id: Id<"guests"> },
        {
          _creationTime: number;
          _id: Id<"guests">;
          checkedInAt?: number;
          checkedInBy?: Id<"users">;
          email?: string;
          emailSendLockedAt?: number | null;
          emailedAt?: number;
          eventId: Id<"events">;
          name: string;
          notes?: string;
          type: "guest" | "artist guest" | "staff";
        } | null
      >;
      markAsEmailed: FunctionReference<
        "mutation",
        "internal",
        { id: Id<"guests">; lockToken: number },
        null
      >;
    };
    imported_tickets: {
      redactByEmail: FunctionReference<
        "mutation",
        "internal",
        { cursor?: string | null; email: string; operatorUserId: Id<"users"> },
        { isDone: boolean; redactedCount: number }
      >;
    };
    management: {
      continueCancelledEventOrderCleanup: FunctionReference<
        "mutation",
        "internal",
        { eventId: Id<"events"> },
        null
      >;
      continueEventRemovalCleanup: FunctionReference<
        "mutation",
        "internal",
        { adminId: Id<"users">; eventId: Id<"events"> },
        null
      >;
      getInternal: FunctionReference<
        "query",
        "internal",
        { id: Id<"events"> },
        null | {
          _creationTime: number;
          _id: Id<"events">;
          checkedInCount?: number;
          date: string;
          description?: string;
          endDate?: string;
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
        }
      >;
      getManagementPurchasesInternal: FunctionReference<
        "query",
        "internal",
        { eventId: Id<"events">; requestUserId: Id<"users"> },
        {
          event: {
            _creationTime: number;
            _id: Id<"events">;
            checkedInCount?: number;
            date: string;
            description?: string;
            endDate?: string;
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
          };
          purchases: Array<{
            amount: number;
            createdAt: number;
            id: Id<"ticket_orders">;
            quantity: number;
            refundedAmountCents?: number;
            status: "completed" | "refunded";
            tickets: Array<{
              id: Id<"tickets">;
              status: "valid" | "used" | "refunded" | "expired";
              tier: "regular" | "notaflof" | "supporter";
            }>;
            tier: "regular" | "notaflof" | "supporter";
            userEmail?: string;
            userId?: Id<"users">;
            userName: string;
          }>;
        }
      >;
      getManagementResaleInternal: FunctionReference<
        "query",
        "internal",
        { eventId: Id<"events">; requestUserId: Id<"users"> },
        {
          event: {
            _creationTime: number;
            _id: Id<"events">;
            checkedInCount?: number;
            date: string;
            description?: string;
            endDate?: string;
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
          };
          resaleListings: Array<{
            _creationTime: number;
            _id: Id<"resale_listings">;
            buyerId?: Id<"users">;
            buyerName?: string;
            cancelledAt?: number;
            completedAt?: number;
            eventId: Id<"events">;
            lostProcessingFeeCents?: number;
            pendingOrderId?: Id<"ticket_orders">;
            resaleFeeCents?: number;
            sellerEmail?: string;
            sellerId: Id<"users">;
            sellerName: string;
            sellerRefundAmountCents?: number;
            sellerRefundAttempts?: number;
            sellerRefundCompletedAt?: number;
            sellerRefundFailedAt?: number | null;
            sellerRefundLastError?: string | null;
            sellerRefundNextRetryAt?: number | null;
            sellerRefundState?: "pending" | "retrying" | "completed" | "failed";
            status: "listed" | "pending" | "completed" | "cancelled";
            ticketId: Id<"tickets">;
          }>;
          resaleMetrics: {
            activeListings: number;
            cancelledListings: number;
            completedResales: number;
            notificationSubscribers: number;
            pendingListings: number;
            totalListings: number;
            totalLostProcessingFeesCents: number;
            totalRefundedToSellersCents: number;
            totalResaleFeesCents: number;
          };
        }
      >;
      getManagementSummaryInternal: FunctionReference<
        "query",
        "internal",
        { eventId: Id<"events">; requestUserId: Id<"users"> },
        {
          checkInStats: {
            buckets: Array<{ count: number; time: number }>;
            checkInRate: number;
            checkedIn: number;
          };
          event: {
            _creationTime: number;
            _id: Id<"events">;
            checkedInCount?: number;
            date: string;
            description?: string;
            endDate?: string;
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
          };
          heldCount: number;
          imported: {
            bySource: Array<{
              checkedIn: number;
              sourceLabel: string;
              total: number;
            }>;
            checkedIn: number;
            total: number;
          };
          isSoldOut: boolean;
          remainingCount: number;
          revenue: {
            grossCents: number;
            lostProcessingFeeCents: number;
            netCents: number;
            platformFeeCents: number;
            processingFeeCents: number;
            refundedCents: number;
          };
          revenueByTier: {
            notaflof: {
              grossCents: number;
              netCents: number;
              quantity: number;
            };
            regular: { grossCents: number; netCents: number; quantity: number };
            supporter: {
              grossCents: number;
              netCents: number;
              quantity: number;
            };
          };
          salesByDay: Array<{ date: string; quantity: number }>;
          soldCount: number;
          tierCounts: { notaflof: number; regular: number; supporter: number };
          totalTickets: number;
        }
      >;
    };
    public: {
      listPublicUpcomingInternal: FunctionReference<
        "query",
        "internal",
        {},
        Array<{
          _id: Id<"events">;
          date: string;
          description?: string;
          endDate?: string;
          isSoldOut: boolean;
          location?: string;
          organizerId?: Id<"organizers"> | null;
          posterUrl: string | null;
          price: number;
          slidingScaleEnabled?: boolean;
          slidingScaleMax?: number;
          slidingScaleMin?: number;
          soldCount: number;
          supporterDefaultPrice?: number;
          ticketSalesStatus?: "active" | "paused" | "ended";
          title: string;
          totalTickets: number;
          visibility: "private" | "public_viewable" | "public";
        }>
      >;
    };
  };
  guest_sessions: {
    core: {
      cleanupExpiredSessions: FunctionReference<
        "mutation",
        "internal",
        {},
        number
      >;
      clearResumeSessionToken: FunctionReference<
        "mutation",
        "internal",
        { sessionId: Id<"guest_sessions">; sessionToken: string },
        null
      >;
      getById: FunctionReference<
        "query",
        "internal",
        { sessionId: Id<"guest_sessions"> },
        {
          _creationTime: number;
          _id: Id<"guest_sessions">;
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
        } | null
      >;
      getBySessionToken: FunctionReference<
        "query",
        "internal",
        { now: number; sessionToken: string },
        {
          _creationTime: number;
          _id: Id<"guest_sessions">;
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
        } | null
      >;
      getReusableByEmail: FunctionReference<
        "query",
        "internal",
        { email: string; now: number },
        {
          _creationTime: number;
          _id: Id<"guest_sessions">;
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
        } | null
      >;
      getUnmigratedByEmail: FunctionReference<
        "query",
        "internal",
        { email: string },
        Array<{
          _creationTime: number;
          _id: Id<"guest_sessions">;
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
        }>
      >;
      initiate: FunctionReference<
        "mutation",
        "internal",
        {
          email: string;
          existingSessionToken?: string;
          magicLinkToken?: string;
          sessionToken: string;
        },
        { sessionToken: string }
      >;
      migrateGuestToUser: FunctionReference<
        "action",
        "internal",
        { email: string; userId: Id<"users"> },
        null
      >;
      migrateOneSession: FunctionReference<
        "mutation",
        "internal",
        { sessionId: Id<"guest_sessions">; userId: Id<"users"> },
        null
      >;
      prepareResumeSessionToken: FunctionReference<
        "mutation",
        "internal",
        { sessionId: Id<"guest_sessions">; sessionToken: string },
        { status: "prepared" | "already_pending" | "missing" }
      >;
      promoteResumeSessionToken: FunctionReference<
        "mutation",
        "internal",
        { sessionId: Id<"guest_sessions">; sessionToken: string },
        null
      >;
      rotateSessionToken: FunctionReference<
        "mutation",
        "internal",
        { sessionId: Id<"guest_sessions">; sessionToken: string },
        null
      >;
      updateLastActive: FunctionReference<
        "mutation",
        "internal",
        { sessionId: Id<"guest_sessions"> },
        null
      >;
    };
  };
  init: {
    registerCleanupCrons: FunctionReference<"mutation", "internal", {}, null>;
  };
  lib: {
    access: {
      _isCommunityAdminOrRoot: FunctionReference<
        "query",
        "internal",
        { organizerId: Id<"organizers">; userId: Id<"users"> },
        boolean
      >;
      _isEventAdmin: FunctionReference<
        "query",
        "internal",
        { eventId: Id<"events">; userId: Id<"users"> },
        boolean
      >;
      _isRootAdmin: FunctionReference<
        "query",
        "internal",
        { userId: Id<"users"> },
        boolean
      >;
    };
    auth_helpers: {
      getAuthUserIdInternal: FunctionReference<
        "query",
        "internal",
        {},
        Id<"users"> | null
      >;
    };
    better_auth: {
      onCreate: FunctionReference<
        "mutation",
        "internal",
        { doc: any; model: string },
        any
      >;
      onDelete: FunctionReference<
        "mutation",
        "internal",
        { doc: any; model: string },
        any
      >;
      onUpdate: FunctionReference<
        "mutation",
        "internal",
        { model: string; newDoc: any; oldDoc: any },
        any
      >;
    };
    email_dedup: {
      cleanupStaleEmailDedup: FunctionReference<
        "mutation",
        "internal",
        {},
        null
      >;
    };
    rate_limits: {
      applyOrderActionRateLimit: FunctionReference<
        "mutation",
        "internal",
        {
          key: string;
          name: "orderStartCheckout" | "orderSyncCheckoutSession";
        },
        null
      >;
      applyRateLimit: FunctionReference<
        "mutation",
        "internal",
        { key: string; name: "exportEventRoster" },
        null
      >;
      limitPublicEndpoint: FunctionReference<
        "mutation",
        "internal",
        {
          key: string;
          name:
            | "listPublicEvents"
            | "listPublicCommunity"
            | "getPublicCommunityBySlug"
            | "unsubscribeEndpoint";
        },
        null
      >;
    };
  };
  marketing: {
    digests: {
      sendDailyDigests: FunctionReference<
        "mutation",
        "internal",
        {
          paginationOpts?: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        null
      >;
    };
    emails: {
      getPreferencesByToken: FunctionReference<
        "query",
        "internal",
        { token: string },
        {
          globalMarketingOptOut: boolean;
          preferences: Array<{
            isAdmin: boolean;
            optedIn: boolean;
            organizerId: Id<"organizers">;
            organizerName: string;
          }>;
          unsubscribedFrom: {
            organizerId: Id<"organizers">;
            organizerName: string;
          } | null;
        } | null
      >;
      recordDeliveryClick: FunctionReference<
        "mutation",
        "internal",
        { token: string },
        string | null
      >;
      recordDeliveryOpen: FunctionReference<
        "mutation",
        "internal",
        { token: string },
        boolean
      >;
      sendAnnouncement: FunctionReference<
        "mutation",
        "internal",
        { eventMarketingEmailId: Id<"eventMarketingEmails"> },
        null
      >;
      sendAnnouncementBatch: FunctionReference<
        "mutation",
        "internal",
        {
          batchIndex: number;
          eventId: Id<"events">;
          eventMarketingEmailId: Id<"eventMarketingEmails">;
          organizerId: Id<"organizers">;
          recipients: Array<{
            email: string;
            globalMarketingOptOut?: boolean;
            marketingPreference?: {
              _id: Id<"marketingEmailPreferences">;
              organizerId: Id<"organizers">;
              userId: Id<"users">;
            };
            userId: Id<"users">;
            vettedViaOrganizerIds?: Array<Id<"organizers">>;
          }>;
          sentAt: number;
        },
        null
      >;
      toggleByToken: FunctionReference<
        "mutation",
        "internal",
        { optedIn: boolean; organizerId?: Id<"organizers">; token: string },
        null
      >;
      unsubscribeAllByToken: FunctionReference<
        "mutation",
        "internal",
        { token: string },
        null
      >;
      unsubscribeAllForUser: FunctionReference<
        "mutation",
        "internal",
        { adminOrganizerIds?: Array<Id<"organizers">>; userId: Id<"users"> },
        null
      >;
      unsubscribeByToken: FunctionReference<
        "mutation",
        "internal",
        { token: string },
        null
      >;
    };
  };
  migrations: {
    backfillAddressMarketingUnsubscribeTokenDigests: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillAdminInviteTokenDigests: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillEventBroadcastDeliveries: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillGuestSessionTokenDigests: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillMagicLinkTokenDigests: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillMarketingDeliveryTrackingTokenDigests: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    backfillUserMarketingUnsubscribeTokenDigests: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    clearLegacyUserEmailChangeTokens: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
    runTokenDigestBackfills: FunctionReference<
      "mutation",
      "internal",
      {
        batchSize?: number;
        cursor?: string | null;
        dryRun?: boolean;
        fn?: string;
        next?: Array<string>;
        oneBatchOnly?: boolean;
        reset?: boolean;
      },
      any
    >;
  };
  orders: {
    core: {
      applyExternalRefund: FunctionReference<
        "mutation",
        "internal",
        {
          auditAction?:
            "payment.refund" | "payment.force-refund-all" | "ticket.refund";
          auditSource?: string;
          connectedAccountNetCents?: number;
          ledgerRefundAmountCents?: number;
          lostProcessingFeeCents?: number;
          orderId: Id<"ticket_orders">;
          platformFeeCents?: number;
          processorFeeCents?: number;
          refundedAmountCents: number;
          refundedBy?: Id<"users">;
          stripeEventId?: string;
          stripeRefundId?: string;
          ticketIdsToRefund?: Array<Id<"tickets">>;
        },
        null
      >;
      bindCheckoutSession: FunctionReference<
        "mutation",
        "internal",
        {
          expiresAt?: number;
          orderId: Id<"ticket_orders">;
          stripeCheckoutSessionId: string;
        },
        {
          clientSecret: string;
          connectedAccountId: string | null;
          expiresAt: number;
          orderId: Id<"ticket_orders">;
          stripeCheckoutSessionId: string;
        }
      >;
      cancelOpenOrdersForEvent: FunctionReference<
        "mutation",
        "internal",
        { eventId: Id<"events"> },
        number
      >;
      clearCheckoutSession: FunctionReference<
        "mutation",
        "internal",
        { orderId: Id<"ticket_orders"> },
        null
      >;
      expire: FunctionReference<
        "mutation",
        "internal",
        { force?: boolean; orderId: Id<"ticket_orders"> },
        null
      >;
      getByCheckoutSessionId: FunctionReference<
        "query",
        "internal",
        { stripeCheckoutSessionId: string },
        {
          _creationTime: number;
          _id: Id<"ticket_orders">;
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
          tosAcceptedAt?: number;
          tosVersion?: string;
          trustSource: "direct" | "shared" | "open_access";
          trustViaOrganizerId?: Id<"organizers">;
          userId?: Id<"users">;
        } | null
      >;
      getByStripePaymentIntentId: FunctionReference<
        "query",
        "internal",
        { stripePaymentIntentId: string },
        {
          _creationTime: number;
          _id: Id<"ticket_orders">;
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
          tosAcceptedAt?: number;
          tosVersion?: string;
          trustSource: "direct" | "shared" | "open_access";
          trustViaOrganizerId?: Id<"organizers">;
          userId?: Id<"users">;
        } | null
      >;
      getHeldInventoryReconciliation: FunctionReference<
        "query",
        "internal",
        { eventId: Id<"events"> },
        {
          drift: number;
          eventId: Id<"events">;
          inventoryId: Id<"event_inventory">;
          openPrimaryHeldCount: number;
          storedHeldCount: number;
          title: string;
        }
      >;
      getInternal: FunctionReference<
        "query",
        "internal",
        { orderId: Id<"ticket_orders"> },
        {
          _creationTime: number;
          _id: Id<"ticket_orders">;
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
          tosAcceptedAt?: number;
          tosVersion?: string;
          trustSource: "direct" | "shared" | "open_access";
          trustViaOrganizerId?: Id<"organizers">;
          userId?: Id<"users">;
        } | null
      >;
      markLateInvalidRefunded: FunctionReference<
        "mutation",
        "internal",
        {
          connectedAccountNetCents?: number;
          orderId: Id<"ticket_orders">;
          platformFeeCents?: number;
          processorFeeCents?: number;
          refundedAmountCents: number;
          stripeEventId?: string;
          stripeRefundId: string;
        },
        null
      >;
      normalizeTicketOrderId: FunctionReference<
        "query",
        "internal",
        { candidate: string },
        Id<"ticket_orders"> | null
      >;
      prepareStripeOrderSettlement: FunctionReference<
        "mutation",
        "internal",
        {
          note?: string;
          orderId: Id<"ticket_orders">;
          stripeChargeId?: string;
          stripeEventId?: string;
          stripePaymentIntentId?: string;
        },
        {
          completedAt?: number;
          eventId?: Id<"events">;
          expiresAt: number;
          kind: "primary" | "resale";
          orderId: Id<"ticket_orders">;
          outcome: "completed" | "refund_required" | "already_refunded";
          refundedAmountCents?: number;
          releasedAt?: number;
          state: "open" | "completed" | "released";
          stripeChargeId?: string;
          stripePaymentIntentId?: string;
        }
      >;
      recordFinancialEvent: FunctionReference<
        "mutation",
        "internal",
        {
          amountCents?: number;
          connectedAccountId?: string;
          connectedAccountNetCents?: number;
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
          occurredAt?: number;
          orderId: Id<"ticket_orders">;
          platformFeeCents?: number;
          processorFeeCents?: number;
          stripeChargeId?: string;
          stripeDisputeId?: string;
          stripeEventId?: string;
          stripePaymentIntentId?: string;
          stripeRefundId?: string;
        },
        null
      >;
      releaseForPaymentFailure: FunctionReference<
        "mutation",
        "internal",
        {
          errorCode?: string;
          failureStage?:
            "account_setup" | "checkout_session" | "payment_intent";
          orderId: Id<"ticket_orders">;
        },
        null
      >;
      repairHeldInventoryCount: FunctionReference<
        "mutation",
        "internal",
        { eventId: Id<"events">; expectedStoredHeldCount?: number },
        {
          drift: number;
          eventId: Id<"events">;
          inventoryId: Id<"event_inventory">;
          openPrimaryHeldCount: number;
          repaired: boolean;
          storedHeldCount: number;
          title: string;
        }
      >;
      settlePaidOrderFromStripe: FunctionReference<
        "action",
        "internal",
        {
          note?: string;
          orderId: Id<"ticket_orders">;
          stripeChargeId?: string;
          stripeEventId?: string;
          stripePaymentIntentId?: string;
        },
        {
          completedAt?: number;
          expiresAt: number;
          kind: "primary" | "resale";
          orderId: Id<"ticket_orders">;
          releasedAt?: number;
          state: "open" | "completed" | "released";
        }
      >;
    };
  };
  payments: {
    refunds: {
      _getOrderOrganizer: FunctionReference<
        "query",
        "internal",
        { orderId: Id<"ticket_orders"> },
        Id<"organizers"> | null
      >;
      _getTicketOrderId: FunctionReference<
        "query",
        "internal",
        { ticketId: Id<"tickets"> },
        Id<"ticket_orders"> | null
      >;
      calculateRefundableAmount: FunctionReference<
        "query",
        "internal",
        { orderId: Id<"ticket_orders"> },
        {
          refundableAmount: number;
          totalTicketCount: number;
          validTicketCount: number;
        }
      >;
      calculateSingleTicketRefund: FunctionReference<
        "query",
        "internal",
        { ticketId: Id<"tickets"> },
        {
          canRefund: boolean;
          orderAmount?: number;
          orderEventId?: Id<"events">;
          orderId?: Id<"ticket_orders">;
          orderProcessorFee?: number;
          orderStripePaymentIntentId?: string;
          reason?: string;
          refundAmount: number;
        }
      >;
      getOrderFinancialInternal: FunctionReference<
        "query",
        "internal",
        { orderId: Id<"ticket_orders"> },
        {
          capturedAmountCents: number;
          eventId: Id<"events">;
          orderId: Id<"ticket_orders">;
          originalProcessorFeeCents: number;
          processorFeeCents: number;
          refundedAmountCents: number;
        } | null
      >;
    };
  };
  resale: {
    listings: {
      cleanupStaleResaleListings: FunctionReference<
        "mutation",
        "internal",
        {},
        null
      >;
      notifySubscribersForListedTicket: FunctionReference<
        "mutation",
        "internal",
        { eventId: Id<"events">; sellerId: Id<"users"> },
        number
      >;
      onSellerRefundComplete: FunctionReference<
        "mutation",
        "internal",
        {
          context: {
            eventId: Id<"events">;
            idempotencyKey: string;
            listingId: Id<"resale_listings">;
            lostProcessingFeeCents: number;
            refundAmountCents: number;
            retryCount: number;
            sellerOrderId: Id<"ticket_orders">;
            sellerOrderStripePaymentIntentId?: string;
          };
          result:
            | { kind: "success"; returnValue: any }
            | { error: string; kind: "failed" }
            | { kind: "canceled" };
          workId: string;
        },
        any
      >;
      processSellerRefund: FunctionReference<
        "action",
        "internal",
        {
          eventId: Id<"events">;
          idempotencyKey: string;
          listingId: Id<"resale_listings">;
          lostProcessingFeeCents: number;
          refundAmountCents: number;
          sellerOrderId: Id<"ticket_orders">;
          sellerOrderStripePaymentIntentId?: string;
        },
        {
          connectedAccountNetCents?: number;
          platformFeeCents?: number;
          processorFeeCents?: number;
          stripeRefundId: string;
        }
      >;
    };
  };
  storage: {
    files: {
      _cleanupOrphanedUploads: FunctionReference<
        "mutation",
        "internal",
        { afterCreationTime?: number; nowMs?: number },
        null
      >;
      _deleteStoredFile: FunctionReference<
        "mutation",
        "internal",
        { storageId: Id<"_storage"> },
        null
      >;
      _markUploadConfirmed: FunctionReference<
        "mutation",
        "internal",
        { storageId: Id<"_storage">; uploaderUserId: Id<"users"> },
        null
      >;
      getPublishedEmailImage: FunctionReference<
        "query",
        "internal",
        { storageId: string },
        null | { contentType: string; storageId: Id<"_storage"> }
      >;
    };
  };
  stripe: {
    actions: {
      backfillPaymentCapturedNet: FunctionReference<
        "action",
        "internal",
        { connectedAccountId: string },
        { enriched: number; failed: number; scanned: number; skipped: number }
      >;
      ingestExternalPayoutById: FunctionReference<
        "action",
        "internal",
        { connectedAccountId: string; stripePayoutId: string },
        { amountCents: number; ingested: boolean; status: string }
      >;
      processScheduledPayouts: FunctionReference<
        "action",
        "internal",
        {},
        null
      >;
      processStripeRefund: FunctionReference<
        "action",
        "internal",
        {
          amountCents: number;
          connectedAccountId?: string;
          idempotencyKey: string;
          paymentIntentId: string;
          reason?: string;
          refundApplicationFee?: boolean;
        },
        {
          connectedAccountNetCents?: number;
          platformFeeCents?: number;
          processorFeeCents?: number;
          refundId: string;
          success: boolean;
        }
      >;
      refreshConnectedAccountStatus: FunctionReference<
        "action",
        "internal",
        { stripeConnectedAccountId: string },
        null
      >;
      startTicketOrderCheckoutSession: FunctionReference<
        "action",
        "internal",
        {
          checkoutTheme?: "light" | "dark";
          orderId: Id<"ticket_orders">;
          sessionToken?: string;
        },
        {
          clientSecret: string;
          connectedAccountId: string | null;
          expiresAt: number;
          orderId: Id<"ticket_orders">;
          stripeCheckoutSessionId: string;
        }
      >;
      syncTicketOrderCheckoutSession: FunctionReference<
        "action",
        "internal",
        { checkoutSessionId: string; sessionToken?: string },
        {
          completedAt?: number;
          expiresAt: number;
          kind: "primary" | "resale";
          orderId: Id<"ticket_orders">;
          releasedAt?: number;
          state: "open" | "completed" | "released";
        }
      >;
      verifyAndProcessConnectWebhook: FunctionReference<
        "action",
        "internal",
        { payload: string; signature: string },
        null
      >;
      verifyAndProcessV2EventNotification: FunctionReference<
        "action",
        "internal",
        { payload: string; signature: string },
        null
      >;
      verifyAndProcessWebhook: FunctionReference<
        "action",
        "internal",
        { payload: string; signature: string },
        null
      >;
    };
    connect: {
      confirmPayout: FunctionReference<
        "mutation",
        "internal",
        {
          amountCents?: number;
          connectedAccountId?: string;
          currency?: string;
          metadataBatchId?: string;
          stripePayoutId: string;
        },
        null
      >;
      createPayoutIntent: FunctionReference<
        "mutation",
        "internal",
        {
          allocations: Array<{ amountCents: number; eventId: Id<"events"> }>;
          amountCents: number;
          connectedAccountId: string;
          currency: "usd";
          idempotencyKey: string;
        },
        {
          amountCents: number;
          batchId: Id<"payout_batches">;
          createdAt: number;
          currency: "usd";
          idempotencyKey: string;
          reused: boolean;
          status: "pending" | "submitted" | "paid" | "failed";
          stripePayoutId?: string;
        }
      >;
      failPayout: FunctionReference<
        "mutation",
        "internal",
        {
          connectedAccountId?: string;
          failureReason?: string;
          metadataBatchId?: string;
          stripePayoutId: string;
        },
        null
      >;
      failStalePendingBatch: FunctionReference<
        "mutation",
        "internal",
        { batchId: Id<"payout_batches">; failureReason: string },
        null
      >;
      getOrderByStripePaymentIntentId: FunctionReference<
        "query",
        "internal",
        { stripePaymentIntentId: string },
        {
          _id: Id<"ticket_orders">;
          amountCents: number;
          eventId: Id<"events">;
          guestSessionId?: Id<"guest_sessions">;
          status: string;
          stripeChargeId?: string;
          userId?: Id<"users">;
        } | null
      >;
      getOrganizerInternal: FunctionReference<
        "query",
        "internal",
        { organizerId: Id<"organizers"> },
        {
          _creationTime: number;
          _id: Id<"organizers">;
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
        } | null
      >;
      getSettlementDataForAccount: FunctionReference<
        "query",
        "internal",
        { eligibleBeforeMs: number; stripeConnectedAccountId: string },
        {
          confirmedAllocations: Array<{
            amountCents: number;
            eventId: Id<"events">;
          }>;
          events: Array<{
            _id: Id<"events">;
            date: number;
            eligible: boolean;
            title: string;
          }>;
          financialEvents: Array<{
            connectedAccountNetCents?: number;
            eventId: Id<"events">;
            kind: string;
          }>;
          inflightSubmittedCents: number;
          organizerId: Id<"organizers"> | null;
        }
      >;
      listNetlessCapturedRows: FunctionReference<
        "query",
        "internal",
        { stripeConnectedAccountId: string },
        Array<{
          eventId: Id<"events">;
          orderId: Id<"ticket_orders">;
          stripeChargeId: string | null;
          stripePaymentIntentId: string | null;
        }>
      >;
      listPayoutBatchesNeedingRecovery: FunctionReference<
        "query",
        "internal",
        { now: number },
        {
          pending: Array<{
            amountCents: number;
            batchId: Id<"payout_batches">;
            connectedAccountId: string;
            createdAt: number;
          }>;
          submitted: Array<{
            batchId: Id<"payout_batches">;
            connectedAccountId: string;
            stripePayoutId: string;
          }>;
        }
      >;
      listPayoutReadyConnectedAccounts: FunctionReference<
        "query",
        "internal",
        { cursor: string | null; numItems: number },
        { accounts: Array<string>; continueCursor: string; isDone: boolean }
      >;
      listPlatformOrganizerEligibleEventIds: FunctionReference<
        "query",
        "internal",
        { eligibleBeforeMs: number; limit: number },
        Array<Id<"events">>
      >;
      listUnrecordedStripePayoutIds: FunctionReference<
        "query",
        "internal",
        { stripePayoutIds: Array<string> },
        Array<string>
      >;
      markEventPaidOut: FunctionReference<
        "mutation",
        "internal",
        { eventId: Id<"events">; payoutAmountCents?: number },
        null
      >;
      markPayoutBatchSubmitted: FunctionReference<
        "mutation",
        "internal",
        { batchId: Id<"payout_batches">; stripePayoutId: string },
        null
      >;
      markPayoutSettingsVerified: FunctionReference<
        "mutation",
        "internal",
        { organizerId: Id<"organizers">; stripeConnectedAccountId: string },
        null
      >;
      storeConnectedAccountId: FunctionReference<
        "mutation",
        "internal",
        {
          onboardingStatus?:
            | "not_started"
            | "in_progress"
            | "payout_settings_pending"
            | "complete"
            | "restricted";
          organizerId: Id<"organizers">;
          stripeConnectedAccountId: string;
        },
        null
      >;
      updateOrganizerFromStripeAccount: FunctionReference<
        "mutation",
        "internal",
        {
          chargesEnabled: boolean;
          currentlyDue: Array<string>;
          onboardingStatus:
            | "not_started"
            | "in_progress"
            | "payout_settings_pending"
            | "complete"
            | "restricted";
          payoutsEnabled: boolean;
          stripeConnectedAccountId: string;
        },
        null
      >;
    };
    webhooks: {
      claimStripeWebhookEvent: FunctionReference<
        "mutation",
        "internal",
        {
          orderId?: Id<"ticket_orders">;
          stripeEventId: string;
          stripeEventType: string;
        },
        | {
            attempts: number;
            claimId: Id<"stripe_webhook_events">;
            disposition: "proceed";
            mode: "fresh" | "reclaimed_stale";
          }
        | {
            disposition: "skip";
            existingClaimId: Id<"stripe_webhook_events">;
            reason: "already_completed" | "already_failed" | "in_flight";
          }
      >;
      finalizeStripeWebhookEvent: FunctionReference<
        "mutation",
        "internal",
        {
          claimId: Id<"stripe_webhook_events">;
          failureReason?: "stale_timeout" | "order_not_found";
          orderId?: Id<"ticket_orders">;
          outcome: "completed" | "failed";
        },
        null
      >;
      reapStaleStripeWebhookClaims: FunctionReference<
        "mutation",
        "internal",
        {},
        { reaped: number }
      >;
      releaseStripeWebhookClaim: FunctionReference<
        "mutation",
        "internal",
        { claimId: Id<"stripe_webhook_events"> },
        null
      >;
    };
  };
  testing: {
    users: {
      _createUserDirectlyInternal: FunctionReference<
        "mutation",
        "internal",
        {
          authEmailVerified?: boolean;
          betterAuthUserId?: string;
          email: string;
          name: string;
          socialSignupCompletionRequired?: boolean;
          termsAcceptedAt?: number;
        },
        Id<"users">
      >;
      _getByEmailInternal: FunctionReference<
        "query",
        "internal",
        { email: string },
        {
          _creationTime: number;
          _id: Id<"users">;
          authEmailVerified?: boolean;
          betterAuthUserId?: string;
          email?: string;
          emailVerificationTime?: number;
          globalMarketingOptOut?: boolean;
          image?: string;
          name?: string;
          pendingEmail?: string;
          socialSignupCompletionRequired?: boolean;
          termsAcceptedAt?: number;
        } | null
      >;
      _verifyAccountAndUserInternal: FunctionReference<
        "mutation",
        "internal",
        { email: string },
        null
      >;
    };
  };
  tickets: {
    actions: {
      sendTicketsAction: FunctionReference<
        "action",
        "internal",
        { orderId: Id<"ticket_orders"> },
        null
      >;
    };
    public: {
      getByIdInternal: FunctionReference<
        "query",
        "internal",
        { id: Id<"tickets"> },
        {
          _creationTime: number;
          _id: Id<"tickets">;
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
        } | null
      >;
      getTicketByOrderInternal: FunctionReference<
        "query",
        "internal",
        { orderId: Id<"ticket_orders"> },
        {
          _creationTime: number;
          _id: Id<"tickets">;
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
        } | null
      >;
      getTicketsByOrderInternal: FunctionReference<
        "query",
        "internal",
        { orderId: Id<"ticket_orders"> },
        Array<{
          _creationTime: number;
          _id: Id<"tickets">;
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
        }>
      >;
    };
  };
  users: {
    profile: {
      getInternal: FunctionReference<
        "query",
        "internal",
        { id: Id<"users"> },
        {
          _creationTime: number;
          _id: Id<"users">;
          authEmailVerified?: boolean;
          betterAuthUserId?: string;
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
        } | null
      >;
    };
  };
};

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  payoutPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"payoutPool">;
  stripePool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"stripePool">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  authz: import("@djpanda/convex-authz/_generated/component.js").ComponentApi<"authz">;
};
