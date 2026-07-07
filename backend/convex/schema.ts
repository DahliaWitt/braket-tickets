/**
 * # Braket Tickets Database Schema
 *
 * This schema defines the data model for the Braket Tickets platform, a ticketing
 * and community vetting system. The schema is designed around three core workflows:
 * user authentication, event ticketing, and community vetting.
 *
 * ## Key Table Relationships
 *
 * ```
 * users ─────┬────────> applications ────> organizers
 *            │                              │ ↑
 *            ├────────> ticket_orders ──────┤ │
 *            │              │               │ │
 *            └────────> tickets <───────────┤ │
 *                           │               │ │
 *                           └───────────> events│
 *                                               │
 *                          authz trust tuples ──┘
 *                          (organizer ↔ organizer)
 * ```
 *
 * - **users**: Application user table with custom fields. Linked to Better Auth's `user` table via email.
 * - **organizers** (communities): Event hosts with vetting question schemas. Events reference organizers.
 * - **applications**: User vetting submissions for communities.
 * - **events**: Ticketed events with pricing tiers and inventory limits.
 * - **event_inventory**: Canonical primary-ticket inventory counters linked from events.
 * - **ticket_orders**: Checkout/reservation lifecycle for primary and resale purchases.
 * - **order_financial_events**: Append-only payment/refund/dispute ledger.
 * - **tickets**: Individual admission records issued from completed orders.
 *
 * ## Ticket Order Lifecycle
 *
 * ```
 * User selects tickets → orders.open() creates OPEN ticket_order
 *                             │
 *                             ↓
 *               event_inventory.heldCount increments
 *                             │
 *                             ↓
 *         orders.startCheckout() creates embedded Stripe Checkout Session
 *                             │
 *          ┌──────────────────┴──────────────────┐
 *          ↓                                     ↓
 *   Checkout expires / fails               Checkout paid
 *   order released, hold removed                │
 *                                                ↓
 *                            completeFromStripe() completes order,
 *                            creates tickets, and records ledger events
 * ```
 *
 * **Important**: Primary runtime availability comes from `event_inventory`,
 * not from scanning tickets or financial ledger rows.
 *
 * ## Application Answers Schema
 *
 * The `applications.answers` field stores dynamic responses to community-defined
 * vetting questions. It uses `v.record()` with a union type to support:
 * - `string`: Text and long_text question types
 * - `string[]`: Checkbox (multi-select) question types
 * - `boolean`: Yes/no question types
 * - `number`: Numeric question types (if added)
 *
 * Keys in the record correspond to question IDs defined in `organizers.vettingQuestions`.
 *
 * @see convex/orders.ts - Order lifecycle, checkout entrypoints, and completion helpers
 */
import {defineSchema, defineTable} from 'convex/server';
import {v} from 'convex/values';
import {
  callerTrustSourceValidator,
  orderFinancialEventKindValidator,
  resaleListingStatusValidator,
  rosterStatusValidator,
  sellerRefundStateValidator,
  ticketOrderKindValidator,
  ticketOrderReleaseReasonValidator,
  ticketOrderStateValidator,
  ticketStatusValidator,
  tierValidator,
} from './lib/validators/ticketing';
import {
  applicationAnswersValidator,
  applicationStatusValidator,
} from './lib/validators/applications';
import {adminAuditLogFields} from './lib/admin_audit_log_validators';
import {
  eventStatusValidator,
  eventVisibilityValueValidator,
  ticketSalesStatusValidator,
} from './lib/validators/events';
import {guestTypeValidator} from './lib/validators/guests';
import {
  communityPublicationStatusValidator,
  organizerDirectoryJobStatusValidator,
} from './lib/validators/communities';
import {
  onboardingStatusValidator,
  payoutAllocationStatusValidator,
  payoutBatchOriginValidator,
  payoutBatchStatusValidator,
} from './lib/validators/stripe_connect';
import {
  webhookClaimStatusValidator,
  webhookFailureReasonValidator,
} from './lib/validators/stripe_webhooks';
import {vettingQuestionValidator} from './lib/communities/validators';
import {communityAccessSourceValidator} from './lib/users/validators';
import {adminNotificationPreferenceModeValidator} from './lib/validators/admin_notification_preferences';
import {adminInviteStatusValidator} from './lib/validators/admin_invites';
import {magicLinkStatusValidator} from './lib/validators/magic_links';
import {
  audienceScopeValidator,
  marketingEmailStatusValidator,
} from './lib/validators/marketing';
import {emailDeliverySourceValidator} from './lib/validators/email_delivery';

const schemaTables = {
  /**
   * Users table stores user accounts and authentication details.
   * Includes both generic auth fields and custom application fields.
   *
   * Note: Better Auth Component manages its own `user` table for authentication.
   * This `users` table contains application-specific fields and is linked to
   * Better Auth users via betterAuthUserId.
   */
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()), // Standard auth field
    email: v.optional(v.string()),
    /**
     * Stable Better Auth user id for primary auth identity lookup.
     */
    betterAuthUserId: v.optional(v.string()),

    // Account attributes
    /**
     * Temporary storage for new email address during change flow.
     */
    pendingEmail: v.optional(v.string()),
    /**
     * Secure token to verify email change request.
     */
    emailChangeToken: v.optional(v.string()),
    /**
     * Expiration timestamp (ms since epoch) for the email change token.
     * Tokens are valid for 1 hour after creation.
     */
    emailChangeTokenExpiry: v.optional(v.number()),
    /**
     * Timestamp (ms since epoch) when the auth email was verified.
     */
    emailVerificationTime: v.optional(v.number()),
    /**
     * Whether the Better Auth user email is currently verified.
     */
    authEmailVerified: v.optional(v.boolean()),
    /**
     * Timestamp (ms since epoch) when the user accepted terms during social signup completion.
     */
    termsAcceptedAt: v.optional(v.number()),
    /**
     * Durable gate for first-time social users who have not completed post-auth setup yet.
     */
    socialSignupCompletionRequired: v.optional(v.boolean()),
    /**
     * If true, the user has opted out of all marketing emails platform-wide.
     * Takes precedence over per-organizer preferences.
     */
    globalMarketingOptOut: v.optional(v.boolean()),
    /**
     * Preferred community-admin landing community.
     */
    defaultCommunityAdminOrganizerId: v.optional(v.id('organizers')),
  })
    .index('by_betterAuthUserId', ['betterAuthUserId'])
    .index('email', ['email'])
    .index('by_defaultCommunityAdminOrganizerId', [
      'defaultCommunityAdminOrganizerId',
    ])
    .searchIndex('search_name_email', {
      searchField: 'name',
      filterFields: ['email'],
    }),

  // TODO: Rename table organizers→communities (see GitHub issue)
  /**
   * Organizers are entities (individuals or groups) that can host events.
   * They can define vetting questions for applications.
   */
  organizers: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    contactInfo: v.optional(v.string()), // Additional contact information
    /**
     * Schema for vetting questions asked during application process.
     */
    vettingQuestions: v.optional(v.array(vettingQuestionValidator)),
    /** Stripe Connect account ID for receiving payouts. */
    stripeConnectedAccountId: v.optional(v.string()),
    /**
     * V2 onboarding lifecycle — replaces the legacy boolean.
     * See {@link onboardingStatusValidator} for state semantics.
     */
    stripeOnboardingStatus: v.optional(onboardingStatusValidator),
    /**
     * Cached from Stripe: whether the connected account can currently accept
     * card charges. Updated by the Accounts V2 event destination handlers and
     * read by checkout to gate third-party organizer sales.
     */
    stripeChargesEnabled: v.optional(v.boolean()),
    /**
     * Cached from Stripe: whether the connected account can currently receive
     * payouts. Sourced from Stripe Balance Settings
     * (`balance_settings.payments.payouts.status`). Gates the payout cron and
     * exposes account health in the UI.
     */
    stripePayoutsEnabled: v.optional(v.boolean()),
    /**
     * Cached `requirements.currently_due` array from the V2 account. Surfaced
     * to promoters so they know exactly which KYC fields Stripe is asking for.
     */
    stripeCurrentlyDue: v.optional(v.array(v.string())),
    /** Whether this organizer is the platform itself (Braket). Platform organizer events use direct Stripe charges — no Connect payout, no application fee. */
    isPlatformOrganizer: v.optional(v.boolean()),
    /** Short description/blurb for the community directory. */
    description: v.optional(v.string()),
    /** Community website URL. */
    website: v.optional(v.string()),
    /** Convex storage ID for the community logo/image. Null clears the logo. */
    logoStorageId: v.optional(v.union(v.id('_storage'), v.null())),
    /** Whether the community appears in the public directory on the homepage. */
    isPublicDirectory: v.boolean(),
    /** URL-friendly identifier. Auto-generated from name, manually overridable. */
    slug: v.optional(v.string()),
    /**
     * Application lifecycle status for this community.
     * - draft: Community profile can exist but applications are closed.
     * - published: Applications are open (requires at least one vetting question).
     */
    status: communityPublicationStatusValidator,
    codeOfConduct: v.optional(v.string()),
  })
    .index('by_stripeConnectedAccountId', ['stripeConnectedAccountId'])
    .index('by_isPublicDirectory', ['isPublicDirectory'])
    .index('by_slug', ['slug'])
    .index('by_isPlatformOrganizer', ['isPlatformOrganizer']),

  /**
   * Events available for ticket purchase or application.
   */
  events: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    /**
     * Must be ISO 8601 UTC with time component, e.g. '2026-12-15T20:00:00.000Z'.
     * Date-only strings (YYYY-MM-DD) are rejected at create time — see
     * validateISODate in lib/validation.ts.
     */
    date: v.string(),
    /**
     * Optional event end instant, same ISO 8601 UTC format as `date` and
     * validated to be after it. When absent, the event is treated as ending
     * at midnight (event timezone) after its start date — see hasEventEnded
     * in shared/event-time.ts.
     */
    endDate: v.optional(v.string()),
    location: v.optional(v.string()),
    poster: v.optional(v.string()), // URL or Storage ID
    /**
     * Base price in cents (USD).
     */
    price: v.number(),
    slidingScaleEnabled: v.optional(v.boolean()),
    slidingScaleMin: v.optional(v.number()),
    slidingScaleMax: v.optional(v.number()),
    totalTickets: v.number(),
    /**
     * Default price for 'supporter' tier in cents.
     */
    supporterDefaultPrice: v.optional(v.number()),
    maxTicketsPerUser: v.optional(v.number()),

    /**
     * Links to an organizer (community). Required — every event belongs to a community.
     * Platform-owned events use the organizer with isPlatformOrganizer: true.
     */
    organizerId: v.id('organizers'),

    /**
     * Controls whether tickets can currently be purchased.
     * - active: Tickets are on sale.
     * - paused: Sales temporarily stopped.
     * - ended: Sales closed.
     */
    ticketSalesStatus: ticketSalesStatusValidator,

    /**
     * Lifecycle status of the event itself.
     * - draft: Visible only to admins.
     * - published: Visible to public.
     * - cancelled: Event cancelled.
     */
    // LINT.IfChange
    status: eventStatusValidator,
    // LINT.ThenChange("./communities/scanners.ts")

    /**
     * Whether in-platform ticket resale is enabled for this event.
     * When enabled, users can list valid tickets for resale. Resale tickets
     * become purchasable only when the event is sold out.
     */
    resaleEnabled: v.optional(v.boolean()),
    /**
     * Resale fee percentage (0-100) deducted from the seller's refund.
     * Suggested default: 4.2% (roughly covers processor fees plus platform overhead).
     */
    resaleFeePct: v.optional(v.number()),
    /**
     * Controls event visibility and purchase access:
     * - 'private': Only authenticated, vetted users can view and purchase (default).
     * - 'public_viewable': Discoverable by unauthenticated users, but vetting required to purchase.
     * - 'public': Discoverable by unauthenticated users and purchasable without vetting.
     */
    visibility: eventVisibilityValueValidator,
    /**
     * Canonical pointer to the event's inventory row.
     *
     * Runtime availability for the new order flow must load inventory through
     * this field, not through a secondary index on the inventory table.
     *
     * Transitional note: kept optional until legacy seeds/tests are migrated.
     * New event creation must always populate it.
     */
    inventoryId: v.optional(v.id('event_inventory')),
    /**
     * Denormalized count of checked-in tickets for this event.
     * Incremented by confirmCheckIn (checkIn mutation), decremented by revertCheckIn.
     * Optional for backward compat — undefined is treated as 0.
     * @see coupled check-in counter writers in events/check_in.ts / events/analytics.ts
     */
    checkedInCount: v.optional(v.number()),
    /**
     * Timestamp (ms since epoch) of the most recent successful check-in for this event.
     * Set on every confirmCheckIn. Intentionally NOT rolled back on revertCheckIn —
     * it is a "most recent activity" marker, not a derived value.
     * Optional for backward compat — undefined means no check-ins yet.
     */
    lastCheckInAt: v.optional(v.union(v.number(), v.null())),
    /**
     * Timestamp (ms since epoch) when the event revenue was paid out to the organizer.
     */
    paidOutAt: v.optional(v.number()),
  })
    .index('by_status', ['status'])
    .index('by_status_date', ['status', 'date'])
    // Drives the "currently running" source for discovery: published events
    // whose endDate is still in the future (started-but-not-ended multi-day
    // events). Rows without an endDate sort before any string and are excluded
    // by a `> now` range.
    .index('by_status_endDate', ['status', 'endDate'])
    // Organizer-scoped variant so a single community page reads only its own
    // running events instead of a global endDate scan.
    .index('by_organizer_status_endDate', ['organizerId', 'status', 'endDate'])
    .index('by_organizer', ['organizerId'])
    .index('by_organizer_status', ['organizerId', 'status'])
    .index('by_organizer_status_visibility_date', [
      'organizerId',
      'status',
      'visibility',
      'date',
    ])
    .index('by_organizer_visibility_date', [
      'organizerId',
      'visibility',
      'date',
    ]),

  /**
   * Canonical scarce-ticket inventory for primary ticket sales.
   *
   * This row is the runtime source of truth for primary availability:
   *   remaining = event.totalTickets - soldCount - heldCount
   *
   * Runtime code should load this row through events.inventoryId and verify the
   * redundant eventId back-reference matches the event being purchased.
   */
  event_inventory: defineTable({
    /**
     * Redundant integrity field used to sanity-check the event pointer.
     * Do not query inventory by this field on the hot path.
     */
    eventId: v.id('events'),
    /**
     * Count of active sold primary tickets occupying capacity.
     * Counts valid and used tickets; refunded/revoked tickets are excluded.
     */
    soldCount: v.number(),
    /**
     * Count of primary tickets currently held by open orders.
     * Updated transactionally with ticket_orders state transitions.
     */
    heldCount: v.number(),
  }),

  /**
   * Individual tickets issued to users after successful order completion or assignment.
   */
  tickets: defineTable({
    /**
     * Owner of the ticket. Required for authenticated users, absent for guest
     * checkout tickets (which use guestSessionId instead). At least one of
     * userId or guestSessionId is always present.
     */
    userId: v.optional(v.id('users')),
    eventId: v.id('events'),
    /**
     * Canonical order that issued or now owns this ticket.
     */
    orderId: v.optional(v.id('ticket_orders')),
    /**
     * Guest session that owns this ticket (guest checkout flow).
     * Present only for tickets purchased without an account.
     * When a guest later creates an account, their tickets are migrated
     * by setting userId and clearing guestSessionId.
     */
    guestSessionId: v.optional(v.id('guest_sessions')),

    /**
     * - valid: Usable ticket.
     * - used: Already checked in.
     * - refunded: Payment refunded, ticket invalid.
     * - expired: Time limited ticket expired (rare).
     */
    status: ticketStatusValidator,
    /**
     * Pricing tier selected by user.
     * - regular: Standard price.
     * - notaflof: "No One Turned Away For Lack Of Funds" (sliding scale).
     * - supporter: Higher price to support the event.
     */
    tier: tierValidator,

    qrCode: v.optional(v.string()), // Data URL or text content
    checkedInAt: v.optional(v.number()), // Timestamp
    checkedInBy: v.optional(v.id('users')), // Admin who checked in
    rosterAttendeeName: v.optional(v.string()),
    rosterAttendeeNameLower: v.optional(v.string()),
    rosterEmail: v.optional(v.union(v.string(), v.null())),
    rosterEmailLower: v.optional(v.union(v.string(), v.null())),
    rosterCheckedInByName: v.optional(v.union(v.string(), v.null())),
    rosterStatus: rosterStatusValidator,
    rosterIsActive: v.optional(v.boolean()),
    rosterSortKey: v.optional(v.string()),
  })
    .index('by_user', ['userId'])
    .index('by_event_status', ['eventId', 'status'])
    .index('by_user_event', ['userId', 'eventId'])
    .index('by_order', ['orderId'])
    .index('by_guestSession', ['guestSessionId'])
    .index('by_guestSession_event', ['guestSessionId', 'eventId'])
    // Used by getRecentCheckIns and getEventCheckInPostMortem.
    // Descending on checkedInAt yields newest check-ins first.
    .index('by_event_checkedInAt', ['eventId', 'checkedInAt'])
    .index('by_event_and_roster_sort', ['eventId', 'rosterSortKey'])
    .index('by_event_and_roster_active_and_sort', [
      'eventId',
      'rosterIsActive',
      'rosterSortKey',
    ]),

  /**
   * Applications to attend events or join groups.
   * Used when vetting is required.
   */
  applications: defineTable({
    userId: v.id('users'),
    organizerId: v.optional(v.id('organizers')),
    status: applicationStatusValidator,

    processedBy: v.optional(v.id('users')),

    /** Optional deny reason provided by admin when rejecting an application. */
    denyReason: v.optional(v.string()),

    /** Optional reason provided by admin when revoking membership. */
    reason: v.optional(v.string()),

    /**
     * Flexible object storing answers to organizer's vetting questions.
     * Keys should match question IDs from `organizers.vettingQuestions`.
     */
    answers: applicationAnswersValidator,
  })
    .index('by_status', ['status'])
    .index('by_organizer_status', ['organizerId', 'status'])
    .index('by_user_status', ['userId', 'status'])
    .index('by_user_and_organizer', ['userId', 'organizerId'])
    .index('by_user_and_organizer_and_status', [
      'userId',
      'organizerId',
      'status',
    ])
    .index('by_organizer_and_creation', ['organizerId']),

  /**
   * Derived admin-directory rows for organizer-scoped membership review.
   *
   * Read model only. Never use this table for authorization or event/ticket
   * gating; membership remains sourced from authz tuples.
   */
  organizer_user_directory: defineTable({
    organizerId: v.id('organizers'),
    userId: v.id('users'),
    sortTime: v.number(),
    applicationId: v.optional(v.id('applications')),
    applicationCreationTime: v.optional(v.number()),
    applicationStatus: v.optional(applicationStatusValidator),
    applicationProcessedBy: v.optional(v.id('users')),
    applicationReason: v.optional(v.string()),
    applicationAnswers: v.optional(applicationAnswersValidator),
    isCommunityAdmin: v.optional(v.boolean()),
    communityAccessSource: v.optional(communityAccessSourceValidator),
    trustedViaOrganizerName: v.optional(v.string()),
  })
    .index('by_organizer_and_user', ['organizerId', 'userId'])
    .index('by_organizer_and_sortTime_and_user', [
      'organizerId',
      'sortTime',
      'userId',
    ]),

  /**
   * Coalesced rebuild state for organizer admin-directory projections.
   *
   * At most one row should exist per organizer. Used to avoid queueing duplicate
   * full rebuild jobs when several writes request the same projection refresh.
   */
  organizer_user_directory_rebuilds: defineTable({
    organizerId: v.id('organizers'),
    status: organizerDirectoryJobStatusValidator,
    continueCursor: v.optional(v.string()),
    restartRequested: v.optional(v.boolean()),
  }).index('by_organizer', ['organizerId']),

  /**
   * Coalesced propagation state for shared-access directory updates triggered
   * by direct membership changes in a trusted organizer.
   *
   * At most one row should exist per (organizer, user) pair. Used to avoid
   * queueing duplicate scans across trusting organizers for the same member.
   */
  organizer_user_directory_membership_propagations: defineTable({
    organizerId: v.id('organizers'),
    userId: v.id('users'),
    status: organizerDirectoryJobStatusValidator,
    continueCursor: v.optional(v.string()),
    restartRequested: v.optional(v.boolean()),
  }).index('by_organizer_and_user', ['organizerId', 'userId']),

  /**
   * Derived trust-link edges used for bounded pagination over incoming and
   * outgoing organizer trust relationships.
   *
   * Read model only. Authz tuples remain the source of truth.
   */
  organizer_trust_links: defineTable({
    trustingOrganizerId: v.id('organizers'),
    trustedOrganizerId: v.id('organizers'),
  })
    .index('by_trustingOrganizerId_and_trustedOrganizerId', [
      'trustingOrganizerId',
      'trustedOrganizerId',
    ])
    .index('by_trustedOrganizerId_and_trustingOrganizerId', [
      'trustedOrganizerId',
      'trustingOrganizerId',
    ]),

  /**
   * Admin notification preferences for community admins.
   * Controls how admins receive vetting notifications (all, or digest).
   */
  adminNotificationPreferences: defineTable({
    userId: v.id('users'),
    organizerId: v.id('organizers'),
    mode: adminNotificationPreferenceModeValidator,
    digestHour: v.number(), // 0–23 UTC
  })
    .index('by_user_and_community', ['userId', 'organizerId'])
    .index('by_organizer_and_mode', ['organizerId', 'mode'])
    .index('by_mode_and_digestHour', ['mode', 'digestHour']),

  /**
   * Canonical reservation / checkout attempt for both primary and resale sales.
   *
   * Orders own reservation lifecycle. Payment/refund history lives in
   * order_financial_events.
   */
  ticket_orders: defineTable({
    /**
     * Exactly one of userId or guestSessionId must be populated.
     */
    userId: v.optional(v.id('users')),
    guestSessionId: v.optional(v.id('guest_sessions')),
    eventId: v.id('events'),
    /**
     * - primary: consumes event_inventory heldCount while open
     * - resale: reserves a resale listing instead of primary inventory
     */
    kind: ticketOrderKindValidator,
    /**
     * Required for resale orders, absent for primary orders.
     */
    resaleListingId: v.optional(v.id('resale_listings')),
    /**
     * Primary orders may reserve multiple tickets. Resale orders are always 1.
     */
    quantity: v.number(),
    tier: tierValidator,
    /**
     * Snapshot of the buyer-visible amount in minor currency units (USD cents).
     */
    amountCents: v.number(),
    currency: v.literal('USD'),
    /**
     * Reservation / checkout state only. Do not encode refund or dispute state here.
     */
    state: ticketOrderStateValidator,
    /**
     * Populated when state === 'released'.
     */
    releaseReason: v.optional(ticketOrderReleaseReasonValidator),
    /**
     * Hard checkout hold expiration timestamp in ms since epoch.
     */
    expiresAt: v.number(),
    completedAt: v.optional(v.number()),
    releasedAt: v.optional(v.number()),
    /**
     * One Checkout Session per order. Used for idempotent embedded Checkout flows.
     */
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    /**
     * Snapshot of the Stripe connected account that owns this order's
     * charge. Populated at order creation for third-party promoter orders so
     * refunds, webhook sync, and ledger recording can reach the correct
     * account via the `Stripe-Account` header without re-querying the
     * organizer. Null for platform-organizer orders (no Connect account).
     */
    connectedAccountId: v.optional(v.string()),
    /**
     * Snapshotted authorization/trust basis for auditability.
     */
    trustSource: callerTrustSourceValidator,
    trustViaOrganizerId: v.optional(v.id('organizers')),
  })
    .index('by_owner_user_event_state', ['userId', 'eventId', 'state'])
    .index('by_owner_guest_event_state', ['guestSessionId', 'eventId', 'state'])
    .index('by_owner_user_event_state_kind_amountCents_tier_quantity', [
      'userId',
      'eventId',
      'state',
      'kind',
      'amountCents',
      'tier',
      'quantity',
    ])
    .index('by_owner_guest_event_state_kind_amountCents_tier_quantity', [
      'guestSessionId',
      'eventId',
      'state',
      'kind',
      'amountCents',
      'tier',
      'quantity',
    ])
    .index('by_event_and_state', ['eventId', 'state'])
    .index('by_stripeCheckoutSessionId', ['stripeCheckoutSessionId'])
    .index('by_stripePaymentIntentId', ['stripePaymentIntentId']),

  /**
   * Append-first money ledger for orders.
   *
   * This records captures, refunds, disputes, and resale settlement/refund work.
   * Rows are never used as a mutable status table. Capture/refund rows may be
   * enriched once Stripe balance-transaction fields become available so payout
   * settlement can use actual connected-account net values.
   */
  order_financial_events: defineTable({
    orderId: v.id('ticket_orders'),
    /**
     * Redundant linkage for event-centric reporting without an order join.
     */
    eventId: v.id('events'),
    currency: v.literal('USD'),
    kind: orderFinancialEventKindValidator,
    amountCents: v.optional(v.number()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    stripeRefundId: v.optional(v.string()),
    stripeDisputeId: v.optional(v.string()),
    /**
     * Source Stripe event ID for defense-in-depth dedup: the webhook claim row
     * in `stripe_webhook_events` guards double-delivery at the transport layer,
     * but the ledger also dedups on (orderId, kind, stripeEventId) so any
     * direct-callable mutation that forwards an event ID is idempotent on its
     * own.
     */
    stripeEventId: v.optional(v.string()),
    /**
     * Connected account id that owns the Stripe object backing this ledger
     * row. Snapshotted from `ticket_orders.connectedAccountId` at write
     * time so the payout settlement loop can query financial events for
     * one account without joining through `ticket_orders`. Absent on
     * platform-owned orders.
     */
    connectedAccountId: v.optional(v.string()),
    /**
     * Actual Stripe processing fee for this event in cents, copied from the
     * connected account's `BalanceTransaction.fee_details` row where
     * `type === 'stripe_fee'`. Optional because the fee is only known on
     * `payment_captured` and `payment_refunded` rows after the balance
     * transaction has been retrieved.
     */
    processorFeeCents: v.optional(v.number()),
    /**
     * Actual platform `application_fee` for this event in cents, copied from
     * the same `BalanceTransaction.fee_details` lookup (type `application_fee`).
     */
    platformFeeCents: v.optional(v.number()),
    /**
     * Net impact of this event on the connected account's Stripe balance,
     * copied from `BalanceTransaction.net` (which accounts for both the
     * Stripe fee and the application fee). This is the SoT for payout
     * settlement math — no estimation, no recomputation.
     */
    connectedAccountNetCents: v.optional(v.number()),
    note: v.optional(v.string()),
    occurredAt: v.number(),
  })
    .index('by_order', ['orderId'])
    .index('by_order_and_kind', ['orderId', 'kind'])
    .index('by_order_and_kind_and_stripeDisputeId', [
      'orderId',
      'kind',
      'stripeDisputeId',
    ])
    .index('by_order_and_kind_and_stripeRefundId', [
      'orderId',
      'kind',
      'stripeRefundId',
    ])
    .index('by_order_and_kind_and_stripeEventId', [
      'orderId',
      'kind',
      'stripeEventId',
    ])
    .index('by_event', ['eventId'])
    // Drives `getSettlementDataForAccount` — one range scan per
    // connected account per cron run, instead of an N+1 per-event
    // join through `ticket_orders`.
    .index('by_connectedAccountId', ['connectedAccountId']),

  /**
   * Stripe webhook transport ledger + idempotency claim row.
   *
   * One row per Stripe event delivery the app has observed. Acts as the atomic
   * claim primitive for webhook processing: each handler claims a row before
   * running any side effect, finalizes the row on success, and leaves it
   * pending on transient failure so Stripe retries can re-enter after the
   * stale threshold. A reaper cron marks rows that exceed the stale-timeout
   * as `failed` for operator review.
   *
   * Status lifecycle:
   *   (none) → pending → completed
   *                    → failed (terminal or reaped after stale timeout)
   *
   * Deduplication is per-event-id; concurrent deliveries of the same event
   * race on the unique-by-stripeEventId lookup inside the claim mutation, and
   * only one caller wins the `pending` claim.
   */
  stripe_webhook_events: defineTable({
    stripeEventId: v.string(),
    stripeEventType: v.string(),
    /**
     * Optional: many event types resolve to an order once the handler extracts
     * metadata. Populated on claim when known, on finalize otherwise.
     */
    orderId: v.optional(v.id('ticket_orders')),
    status: webhookClaimStatusValidator,
    /**
     * Timestamp of the most recent claim. Reclaim path refreshes this when a
     * stale pending row is taken over by a subsequent delivery. The transient
     * retry path (`releaseWebhookClaimForRetry`) zeroes this so the next
     * Stripe retry reclaims immediately instead of waiting for the stale
     * threshold.
     */
    claimedAt: v.number(),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    /**
     * Bounded enum so ops dashboards can aggregate by reason. New values
     * require a schema deploy — canonical validator is
     * `lib/validators/stripe_webhooks.ts::webhookFailureReasonValueValidator`
     * (the pre-wrapped optional lives alongside as
     * `webhookFailureReasonValidator`).
     */
    failureReason: webhookFailureReasonValidator,
    /**
     * Number of times this event has been claimed (1 on first insert, +1 per
     * stale reclaim). Lets the reaper and ops distinguish new failures from
     * repeated-retry failures.
     */
    attempts: v.number(),
  })
    .index('by_stripeEventId', ['stripeEventId'])
    .index('by_status_and_claimedAt', ['status', 'claimedAt'])
    // Ops dashboards filter failed rows by reason (e.g. count
    // `stale_timeout` vs `order_not_found` to distinguish stuck handlers
    // from dispatcher bugs). Without this index those queries would
    // scan-and-filter the whole table.
    .index('by_status_and_failureReason', ['status', 'failureReason']),

  /**
   * Durable intent row for one Stripe `payouts.create` attempt.
   *
   * Created `pending` BEFORE calling Stripe so the idempotency key, amount,
   * currency, and allocation set are persisted. Transitions to `submitted`
   * once Stripe returns a payout ID, and finally `paid` / `failed` when the
   * confirmation webhook arrives.
   *
   * Retries (timeouts, transient errors) reuse the same row: the same
   * idempotency key, amount, and allocations are submitted to Stripe, so the
   * payout is never double-created.
   */
  payout_batches: defineTable({
    /** Idempotency key submitted to Stripe. Deterministic per account/day. */
    idempotencyKey: v.string(),
    /** Connected account this payout targets. */
    connectedAccountId: v.string(),
    /** Exact amount submitted to Stripe for this payout (cents). */
    amountCents: v.number(),
    /** Stripe payout currency — explicit even while USD-only for clarity. */
    currency: v.literal('usd'),
    /** Lifecycle state. See {@link payoutBatchStatusValidator}. */
    status: payoutBatchStatusValidator,
    /** Stripe payout ID, populated only after Stripe returns one. */
    stripePayoutId: v.optional(v.string()),
    /**
     * How the batch came to exist. `cron` (or absent, for pre-field rows)
     * means the scheduled payout pipeline created it; `external` means a
     * payout was made outside the pipeline (Stripe dashboard) and ingested
     * from its `payout.paid` webhook so settlement stays truthful.
     */
    origin: v.optional(payoutBatchOriginValidator),
    createdAt: v.number(),
    submittedAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    /** Populated from the `payout.failed` webhook. */
    failureReason: v.optional(v.string()),
  })
    .index('by_idempotencyKey', ['idempotencyKey'])
    .index('by_connectedAccountId_and_status', ['connectedAccountId', 'status'])
    .index('by_stripePayoutId', ['stripePayoutId'])
    .index('by_status_and_createdAt', ['status', 'createdAt']),

  /**
   * Append-only Connect payout allocation ledger.
   *
   * One payout batch spans multiple events. One event may receive multiple
   * partial payouts across batches. Connect payout eligibility is derived from
   * these allocations, not from `events.paidOutAt`. For Connect events,
   * `paidOutAt` is only a fully-settled/display marker.
   *
   * Each row records: which batch owns the allocation, which event received
   * how many cents, and whether the confirming webhook has marked it paid
   * or failed.
   */
  payout_allocations: defineTable({
    /** Parent batch that submitted the payout to Stripe. */
    batchId: v.id('payout_batches'),
    /** Stripe payout ID mirrored from the batch for faster reverse lookup. */
    stripePayoutId: v.optional(v.string()),
    /** Connected account this allocation targets. */
    connectedAccountId: v.string(),
    /** Event that received this allocation. */
    eventId: v.id('events'),
    /** Amount allocated to this event in this payout (cents). */
    amountCents: v.number(),
    /** Lifecycle state. See {@link payoutAllocationStatusValidator}. */
    status: payoutAllocationStatusValidator,
    createdAt: v.number(),
    /** Set when `payout.paid` or `payout.failed` confirms the parent batch. */
    confirmedAt: v.optional(v.number()),
    /** Populated from the `payout.failed` webhook. */
    failureReason: v.optional(v.string()),
  })
    .index('by_batchId', ['batchId'])
    .index('by_stripePayoutId', ['stripePayoutId'])
    .index('by_eventId', ['eventId'])
    .index('by_connectedAccountId_and_status', [
      'connectedAccountId',
      'status',
    ]),

  /**
   * Resale listings track tickets listed for resale by their owners.
   *
   * Lifecycle: listed → pending → completed | cancelled
   * - listed: In queue, available when event sold out
   * - pending: Buyer mid-checkout (15 min TTL)
   * - completed: Resale finalized (seller refunded, buyer gets new ticket)
   * - cancelled: Seller withdrew, checked in, or admin cancelled
   *
   * FIFO ordering is achieved via _creationTime (oldest listed first).
   */
  resale_listings: defineTable({
    ticketId: v.id('tickets'),
    eventId: v.id('events'),
    sellerId: v.id('users'),
    status: resaleListingStatusValidator,
    buyerId: v.optional(v.id('users')),
    /**
     * Canonical open resale order holding this listing, if any.
     */
    pendingOrderId: v.optional(v.id('ticket_orders')),
    sellerRefundAmountCents: v.optional(v.number()),
    lostProcessingFeeCents: v.optional(v.number()),
    resaleFeeCents: v.optional(v.number()),
    sellerRefundState: v.optional(sellerRefundStateValidator),
    sellerRefundAttempts: v.optional(v.number()),
    sellerRefundCompletedAt: v.optional(v.number()),
    sellerRefundFailedAt: v.optional(v.union(v.number(), v.null())),
    sellerRefundNextRetryAt: v.optional(v.union(v.number(), v.null())),
    sellerRefundLastError: v.optional(v.union(v.string(), v.null())),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
  })
    .index('by_event_status', ['eventId', 'status'])
    .index('by_ticket', ['ticketId'])
    .index('by_status', ['status'])
    .index('by_seller_event', ['sellerId', 'eventId']),

  /**
   * Notification subscriptions for users who want to be alerted
   * when resale tickets become available for a sold-out event.
   */
  resale_notifications: defineTable({
    userId: v.id('users'),
    eventId: v.id('events'),
    /** Denormalized fallback; delivery should prefer users.email when available. */
    email: v.string(),
    notifiedAt: v.optional(v.number()),
  })
    .index('by_event', ['eventId'])
    .index('by_user_event', ['userId', 'eventId']),

  /**
   * Audit log for sensitive administrative actions.
   */
  adminAuditLogs: defineTable(adminAuditLogFields)
    .index('by_adminId', ['adminId'])
    .index('by_eventId', ['eventId'])
    .index('by_organizer', ['organizerId'])
    .index('by_organizer_and_actionCategory', [
      'organizerId',
      'actionCategory',
    ]),

  /**
   * Guest list for events (manual entries, staff, artists).
   */
  guests: defineTable({
    eventId: v.id('events'),
    name: v.string(),
    email: v.optional(v.string()),
    type: guestTypeValidator,
    notes: v.optional(v.string()),
    emailedAt: v.optional(v.number()),
    checkedInAt: v.optional(v.number()),
    checkedInBy: v.optional(v.id('users')),
  }).index('by_event', ['eventId']),

  /**
   * Temporary table for E2E testing to capture emails.
   * Should not be used in production logic.
   */
  testEmails: defineTable({
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    text: v.optional(v.string()),
    headers: v.optional(v.record(v.string(), v.string())),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          cid: v.optional(v.string()),
          size: v.number(), // Store size to save space
        }),
      ),
    ),
  }).index('by_to', ['to']),

  emailDedup: defineTable({
    key: v.string(),
    createdAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_createdAt', ['createdAt']),

  /** Tracks storage files that passed magic-byte validation via confirmUpload. */
  confirmedUploads: defineTable({
    storageId: v.id('_storage'),
    uploaderUserId: v.optional(v.id('users')),
    confirmedAt: v.number(),
  })
    .index('by_storageId', ['storageId'])
    .index('by_storageId_and_uploaderUserId', ['storageId', 'uploaderUserId']),

  eventBroadcasts: defineTable({
    eventId: v.id('events'),
    adminId: v.id('users'),
    subject: v.string(),
    message: v.string(),
    recipientCount: v.number(),
    sentAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_event_and_sentAt', ['eventId', 'sentAt']),

  ticketReminderSends: defineTable({
    eventId: v.id('events'),
    adminId: v.id('users'),
    subject: v.string(),
    message: v.string(),
    recipientCount: v.number(),
    sentAt: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_event_and_sentAt', ['eventId', 'sentAt']),

  /**
   * Admin invites for onboarding new community admins.
   * Root admin creates an invite → community is created → email sent with token.
   * Invitee redeems token to gain community_admin role.
   */
  admin_invites: defineTable({
    /** Email address of the invitee. */
    email: v.string(),
    /** The community created for this invite. */
    organizerId: v.id('organizers'),
    /** Denormalized fallback; read paths should prefer organizers.name when available. */
    communityName: v.string(),
    /** @deprecated Plaintext invite bearer token retained only for staged migration. */
    token: v.optional(v.string()),
    /** Purpose-scoped HMAC digest of the invite bearer token. */
    tokenDigest: v.optional(v.string()),
    /** Short display prefix only; never sufficient for redemption. */
    tokenPrefix: v.optional(v.string()),
    /** Root admin who created the invite. */
    invitedBy: v.id('users'),
    /** Invite lifecycle: pending → redeemed | cancelled. */
    status: adminInviteStatusValidator,
    /** Expiration timestamp (ms since epoch). Default: 7 days from creation. */
    expiresAt: v.number(),
    /** User who redeemed the invite (set on redemption). */
    redeemedBy: v.optional(v.id('users')),
    /** Timestamp when redeemed (ms since epoch). */
    redeemedAt: v.optional(v.number()),
  })
    .index('by_token', ['token'])
    .index('by_tokenDigest', ['tokenDigest'])
    .index('by_email', ['email'])
    .index('by_organizer', ['organizerId'])
    .index('by_status', ['status']),

  /**
   * Community admin-generated magic links that auto-vet users on redemption.
   * Links have a lifecycle: active ↔ paused → disabled (terminal).
   * Soft delete via deletedAt preserves audit trail.
   *
   * Count and lastUsedAt are NOT stored here — they are derived from
   * magic_link_redemption_log via indexed queries to avoid OCC write
   * contention when viral links get concurrent redemptions.
   */
  magic_links: defineTable({
    /** @deprecated Plaintext bearer token retained only for staged migration. */
    token: v.optional(v.string()),
    /** Purpose-scoped HMAC digest of the bearer token. */
    tokenDigest: v.optional(v.string()),
    /** Short display prefix only; never sufficient for redemption. */
    tokenPrefix: v.optional(v.string()),
    createdBy: v.id('users'),
    /** Community scope for the link. Every magic link must target one organizer. */
    organizerId: v.id('organizers'),
    status: magicLinkStatusValidator,
    label: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    maxRedemptions: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index('by_token', ['token'])
    .index('by_tokenDigest', ['tokenDigest'])
    .index('by_createdBy', ['createdBy', 'status'])
    .index('by_organizerId_and_createdBy_and_status', [
      'organizerId',
      'createdBy',
      'status',
    ])
    .index('by_organizerId', ['organizerId']),

  /**
   * Operational redemption log. Source of truth for counts, idempotency,
   * and timestamps. Never read this table to determine community membership
   * or gate event/ticket access; membership lives exclusively in authz tuples.
   */
  magic_link_redemption_log: defineTable({
    magicLinkId: v.id('magic_links'),
    userId: v.optional(v.id('users')),
    guestSessionId: v.optional(v.id('guest_sessions')),
    redeemedAt: v.number(),
  })
    .index('by_magicLink', ['magicLinkId'])
    .index('by_user', ['userId'])
    .index('by_magicLink_user', ['magicLinkId', 'userId'])
    .index('by_magicLink_guest', ['magicLinkId', 'guestSessionId'])
    .index('by_guestSession', ['guestSessionId']),

  /**
   * Temporary sessions for guest checkout (no account required).
   * Created when a user chooses "Continue as Guest" from a magic link.
   * Sessions have a 24h hard expiry + 2h sliding inactivity window.
   *
   * Guest sessions are created ONLY via internalMutation (insert returns false in RLS).
   * Email verification uses bcrypt which requires "use node" + action().
   */
  guest_sessions: defineTable({
    email: v.string(),
    /**
     * Stable opaque client-held key used to group repeated guest sessions from
     * the same browser without relying on raw email as an owner key.
     */
    clientKey: v.optional(v.string()),
    magicLinkId: v.optional(v.id('magic_links')), // optional for v2 direct guest checkout
    /** @deprecated Plaintext bearer token retained only for staged migration. */
    sessionToken: v.optional(v.string()),
    /** Purpose-scoped HMAC digest of the guest session bearer token. */
    sessionTokenDigest: v.optional(v.string()),
    /** Short display prefix only; never sufficient for session auth. */
    sessionTokenPrefix: v.optional(v.string()),
    /**
     * Temporary digest for a rotated resume token that has been emailed but not
     * yet promoted to primary. This keeps delivered resume links valid even if
     * post-send promotion fails.
     */
    pendingSessionTokenDigest: v.optional(v.string()),
    /** Short display prefix only; never sufficient for session auth. */
    pendingSessionTokenPrefix: v.optional(v.string()),
    lastActiveAt: v.optional(v.number()), // sliding 2h inactivity window
    expiresAt: v.number(), // 24h hard expiry
    convertedToUserId: v.optional(v.id('users')),
  })
    .index('by_email', ['email'])
    .index('by_clientKey', ['clientKey'])
    .index('by_sessionToken', ['sessionToken'])
    .index('by_sessionTokenDigest', ['sessionTokenDigest'])
    .index('by_pendingSessionTokenDigest', ['pendingSessionTokenDigest'])
    .index('by_magicLink', ['magicLinkId'])
    .index('by_expiresAt', ['expiresAt']),

  /**
   * Per-user, per-community marketing email opt-in preference.
   * Created automatically on vetting approval or magic link redemption.
   * Auto opt-in (optedIn: true) on creation.
   * unsubToken is a unique secret used for unauthenticated unsubscribe links.
   * Uniqueness on (userId, organizerId) is enforced by the upsert mutation — do not insert directly.
   */
  marketingEmailPreferences: defineTable({
    userId: v.id('users'),
    organizerId: v.id('organizers'),
    optedIn: v.boolean(),
    /** @deprecated Plaintext unsubscribe bearer token retained only for staged migration. */
    unsubToken: v.optional(v.string()),
    /** Purpose-scoped HMAC digest of the unsubscribe bearer token. */
    unsubTokenDigest: v.optional(v.string()),
    /** Short display prefix only; never sufficient for unsubscribe actions. */
    unsubTokenPrefix: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_user_and_organizer', ['userId', 'organizerId'])
    .index('by_organizer_and_user', ['organizerId', 'userId'])
    .index('by_unsub_token', ['unsubToken'])
    .index('by_unsub_tokenDigest', ['unsubTokenDigest'])
    .index('by_user', ['userId']),

  /**
   * Organizer-scoped marketing preferences for inboxes that are not tied to a
   * Braket user account (for example guest-only ticket holders).
   */
  emailAddressMarketingPreferences: defineTable({
    email: v.string(),
    organizerId: v.id('organizers'),
    optedIn: v.boolean(),
    /** @deprecated Plaintext unsubscribe bearer token retained only for staged migration. */
    unsubToken: v.optional(v.string()),
    /** Purpose-scoped HMAC digest of the unsubscribe bearer token. */
    unsubTokenDigest: v.optional(v.string()),
    /** Short display prefix only; never sufficient for unsubscribe actions. */
    unsubTokenPrefix: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_email_and_organizer', ['email', 'organizerId'])
    .index('by_organizer_and_email', ['organizerId', 'email'])
    .index('by_unsub_token', ['unsubToken'])
    .index('by_unsub_tokenDigest', ['unsubTokenDigest'])
    .index('by_email', ['email']),

  /**
   * Digest-only bearer tokens minted for unsubscribe links in newly-sent email.
   *
   * Legacy preference-table tokens remain supported during migration, but future
   * email sends use this table so preference rows do not need recoverable raw
   * tokens in order to generate a link.
   */
  marketingUnsubscribeTokens: defineTable({
    kind: v.union(v.literal('user'), v.literal('address')),
    tokenDigest: v.string(),
    tokenPrefix: v.string(),
    userPreferenceId: v.optional(v.id('marketingEmailPreferences')),
    addressPreferenceId: v.optional(v.id('emailAddressMarketingPreferences')),
    userId: v.optional(v.id('users')),
    email: v.optional(v.string()),
    organizerId: v.id('organizers'),
    createdAt: v.number(),
  })
    .index('by_tokenDigest', ['tokenDigest'])
    .index('by_user', ['userId'])
    .index('by_email', ['email'])
    .index('by_createdAt', ['createdAt']),

  /**
   * Scheduled or sent marketing email announcement for an event.
   * One record per event per send. Existing 'scheduled' record is cancelled
   * before creating a new one (reschedule flow).
   *
   * Insert-first-with-placeholder pattern: record is inserted with a placeholder
   * schedulerJobId, then the scheduler job is created with the record's real ID,
   * then the record is patched with the real schedulerJobId. This avoids a
   * circular dependency between the record ID and the scheduler job ID.
   */
  eventMarketingEmails: defineTable({
    eventId: v.id('events'),
    adminId: v.id('users'),
    scheduledFor: v.number(), // UTC ms
    status: marketingEmailStatusValidator,
    schedulerJobId: v.optional(v.id('_scheduled_functions')),
    recipientCount: v.optional(v.number()), // set at send time only
    sentAt: v.optional(v.number()),
    totalOpenCount: v.optional(v.number()),
    uniqueOpenCount: v.optional(v.number()),
    totalClickCount: v.optional(v.number()),
    uniqueClickCount: v.optional(v.number()),
    audienceScope: v.optional(audienceScopeValidator),
  })
    .index('by_event', ['eventId'])
    .index('by_event_and_status', ['eventId', 'status'])
    .index('by_status', ['status']),

  /**
   * Per-recipient delivery rows for marketing announcements.
   * Supports first-party open and click tracking without rewriting links
   * through a third-party domain.
   */
  marketingEmailDeliveries: defineTable({
    eventMarketingEmailId: v.id('eventMarketingEmails'),
    eventId: v.id('events'),
    organizerId: v.id('organizers'),
    userId: v.id('users'),
    recipient: v.string(),
    targetUrl: v.string(),
    /** @deprecated Plaintext tracking token retained only for staged migration. */
    openToken: v.optional(v.string()),
    /** @deprecated Plaintext tracking token retained only for staged migration. */
    clickToken: v.optional(v.string()),
    /** Purpose-scoped HMAC digest of the open tracking bearer token. */
    openTokenDigest: v.optional(v.string()),
    /** Purpose-scoped HMAC digest of the click tracking bearer token. */
    clickTokenDigest: v.optional(v.string()),
    openTokenPrefix: v.optional(v.string()),
    clickTokenPrefix: v.optional(v.string()),
    sentAt: v.number(),
    openCount: v.number(),
    clickCount: v.number(),
    openedAt: v.optional(v.number()),
    clickedAt: v.optional(v.number()),
    vettedViaOrganizerIds: v.optional(v.array(v.id('organizers'))),
  })
    .index('by_eventMarketingEmail', ['eventMarketingEmailId'])
    .index('by_open_token', ['openToken'])
    .index('by_open_tokenDigest', ['openTokenDigest'])
    .index('by_click_token', ['clickToken'])
    .index('by_click_tokenDigest', ['clickTokenDigest']),

  /**
   * Append-only log of per-recipient email delivery failures.
   *
   * Written when Resend or fallback SMTP reports a terminal delivery failure.
   * Pruned by a daily cleanup cron after 30 days.
   */
  emailDeliveryFailures: defineTable({
    source: emailDeliverySourceValidator,
    sourceId: v.string(),
    recipient: v.string(),
    error: v.string(),
    failedAt: v.number(),
  })
    .index('by_source', ['source', 'sourceId'])
    .index('by_failedAt', ['failedAt']),

  emailDeliveries: defineTable({
    emailId: v.string(),
    resendId: v.optional(v.string()),
    source: emailDeliverySourceValidator,
    sourceId: v.string(),
    recipient: v.string(),
    critical: v.boolean(),
    manual: v.boolean(),
    fallback: v.boolean(),
    provider: v.union(v.literal('resend'), v.literal('smtp')),
    sentAt: v.number(),
  })
    .index('by_emailId', ['emailId'])
    .index('by_resendId', ['resendId'])
    .index('by_source', ['source', 'sourceId'])
    .index('by_recipient', ['recipient'])
    .index('by_sentAt', ['sentAt']),

  emailProviderCircuit: defineTable({
    provider: v.string(),
    failureCount: v.number(),
    windowStartedAt: v.number(),
    updatedAt: v.number(),
    openUntil: v.optional(v.number()),
  }).index('by_provider', ['provider']),
};

export default defineSchema(schemaTables, {
  schemaValidation: true,
  strictTableNameTypes: true,
});
