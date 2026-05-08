---
title: Critical User Journeys
category: Architecture
order: 2
description: Essential workflows the platform must support
access: public
---

# Critical User Journeys (CUJs)

These critical user journeys define the workflows Braket Tickets must keep reliable for a safe, queer-centric ticketing platform for the FLINTA community.

## 1. Social Auth OAuth Flow

**Objective**: Rapid, secure access via Google or Discord identity.

1.  **Entry**: User clicks a social provider button on `/login` (`google`, `discord`).
2.  **Redirect**: Browser redirects to the provider OAuth2 authorization page.
3.  **Identity Verification**: Provider validates the user and returns a Better Auth callback token to the backend.
4.  **Automatic Provisioning**:
    - **Existing users**: Signed in to the corresponding app account.
    - **New users**: A new app account is created when provider data satisfies the allowed merge policy.
    - **Provider merge edge case**: Same verified email may map to an existing local account only when provider email is verified and matches exactly after normalization.
5.  **Landing**: User is redirected to `/dashboard` via sanitized callback route.

**Maintenance Note (2026-04-01)**:

- The frontend login flow expects Better Auth's OTT (`?ott=...`) callback path via the `crossDomain` plugin.
- The frontend also handles OAuth `code/state` params in `login.component.ts` and redirects to `/confirm/social-signin` for processing. This path remains active to support providers that return authorization codes.
- If social callback handling changes, re-check both the OTT path and the `code/state` redirect logic in `login.component.ts`.

## 2. Social Account Linking Flow

**Objective**: Add a social login method to an existing account.

1.  **Entry**: User navigates to their account page and views the connected providers section.
2.  **Initiation**: User clicks "Link" for Google or Discord.
3.  **Provider Authentication**: User is redirected to the chosen provider and signs in with their Google or Discord account.
4.  **Confirmation**: Provider redirects back to the app, where the user sees a "Provider connected" confirmation message.
5.  **Completion**: User returns to their account page and sees the newly linked provider in their connected providers list.

**Trigger**: Authenticated user adds a social login method from the account management page.

## 3. Password Authentication Flow

**Objective**: Secure access for users who prefer email-based credentials.

1.  **Input**: User enters email and password into the "Login" tab on `/login`.
2.  **Validation**: Frontend validates format; system checks credentials against Convex.
3.  **Security Gates**:
    - **Unverified Check**: If the email exists but isn't verified, the user is blocked with an `UnverifiedEmailError`.
    - **Credential Check**: If credentials are invalid, an "INVALID_EMAIL_OR_PASSWORD" error is shown.
4.  **Session Establishment**: Upon success, a secure auth cookie/token is established.
5.  **Redirect**: User is routed to `/dashboard`.

## 4. Password Reset Flow

**Objective**: Secure password recovery for users who have forgotten their credentials.

1.  **Initiation**: User clicks "Forgot password?" link on `/login` login tab.
2.  **Email Entry**: User enters their registered email address in the reset form.
3.  **Reset Request**: Frontend calls `passwordService.requestPasswordReset(email)` with redirect to `/confirm/password-reset`.
4.  **Backend Processing**: Better Auth generates a secure reset token and calls the `sendResetPassword` hook.
5.  **Email Delivery**: System sends a branded password reset email with the reset link containing the token.
6.  **User Action**: User receives email and clicks the reset link (`/confirm/password-reset?token=...`).
7.  **Password Form**: `ConfirmPasswordResetComponent` validates token presence and displays the password reset form.
8.  **Password Entry**: User enters new password (8-72 characters) and confirmation.
9.  **Reset Completion**: Frontend calls `passwordService.confirmPasswordReset(token, password, confirmPassword)`.
10. **Backend Validation**: Better Auth validates the token and updates the user's password.
11. **Success**: User sees success message with link to login and can now authenticate with the new password.

**Security Notes**:

- Server returns success even for non-existent emails to prevent email enumeration attacks.
- Reset tokens are single-use and time-limited.
- New password must meet strength requirements (8-72 characters, bcrypt limit).
- All password reset events are logged for audit purposes.

## 5. Account Sign Up Flow

**Objective**: Secure creation and identity verification of new community members.

1.  **Initiation**: User navigates to the "Register" tab on `/login`.
2.  **Details**: User provides Name, Email, and Password.
3.  **Conflict Check**: System ensures the email is not already in use.
4.  **Verification Trigger**:
    - A `v.string()` token is generated.
    - A branded verification email is dispatched via the backend.
    - User is redirected to `/login?registered=true`, showing a "Check your email" success message.
5.  **Confirmation (`/confirm/verification/:token`)**:
    - User clicks the link in their email.
    - The `ConfirmVerificationComponent` calls `auth.confirmVerification(token)`.
    - Better Auth marks the email as verified, and the app sync stores that on `authEmailVerified` / `emailVerificationTime`.
6.  **Onboarding Entry**: User can now log in and proceed to the **Vetting Flow** (`/vetting`).

## 6. Vetting Application Flow

**Objective**: Ensure community safety via manual identity verification.

1.  **Requirement**: Logged-in user has a verified email but has not yet been approved for the target community.
2.  **Access**: User is automatically directed to the **Vetting Form** (`/vetting`) or manually navigates via the dashboard.
3.  **Application**: User provides referral info, social handles, and personal statement.
4.  **Conduct**: User agrees to zero-tolerance **Code of Conduct**.
5.  **Submission**: Application status becomes `pending`. User sees "Review in Progress" on dashboard.
6.  **Admin Review**: Admin reviews details at `/admin/pending`, tracing referrals and social footprint.
7.  **Finalization**: Admin **Approves** the application, granting the user access to purchase tickets for that community. Approval does not assign a platform role; it creates or updates the organizer-scoped application record and writes the authz `member` relation used by purchase gates.

## 7. Community Invite Redemption Flow

**Objective**: Grant community access via trusted invite links without manual vetting.

1.  **Link Creation**: Community admin creates a magic link (`/admin/invites`) with optional label, expiration, and max redemptions.
2.  **Link Sharing**: Admin shares the invite link (`/invite/:token`) with trusted individuals. Legacy paths `/join/:token` and `/apply/:token` redirect to `/invite/:token`.
3.  **Token Validation**: User clicks the link. Frontend calls `magic_links.validateToken` to check link status (active, paused, disabled, expired, or maxed).
4.  **Authentication Gate**:
    - **New users**: Redirected to create account (`/login?signup=true&returnUrl=/invite/:token`).
    - **Existing users**: Redirected to sign in (`/login?returnUrl=/invite/:token`).
5.  **Auto-Redemption**: Once authenticated, frontend automatically calls `magic_links.redeem` mutation to claim community access.
6.  **Membership Grant**: Backend appends a row to `magic_link_redemption_log`, writes the organizer-scoped authz `member` relation, and seeds the organizer marketing preference inline unless the user has already opted out globally.
7.  **Confirmation**: User sees success message and is redirected to home page after 2-second delay.

**Notes**:

- **New vs Existing Users**: Both must authenticate before redemption. New users create accounts; existing users sign in. The link itself does not create accounts.
- **Already Member**: If user already has community access, redemption succeeds with "already a member" message.
- **Already Redeemed**: If user previously used the same link, redemption succeeds with "already used this link" message.
- **Link States**: Links can be `active`, `paused`, `disabled`, or deleted by admins. Expired or maxed links show appropriate error messages.
- **Audit Trail**: Each redemption creates an `adminAuditLogs` entry linking redeemer, link, and community admin.
- **Marketing Opt-In**: Redemption automatically opts user into community marketing emails unless they have `globalMarketingOptOut: true`.

## 8. Event Discovery & Ticket Purchase

**Objective**: Enable vetted members to safely purchase tickets to underground events.

1.  **Browse Events**: Logged-in, vetted members view the dashboard (`/dashboard`) to see published events.
    - Events display status badges: **Available**, **Sold Out**, **Sales Paused**, or **Sales Ended**.
    - Note: **Sold Out** is computed from inventory (`remaining = totalTickets - soldCount - heldCount ≤ 0`), not stored as a status. The stored `ticketSalesStatus` values are: `active`, `paused`, `ended`.
2.  **Select Event**: User selects an event to view full details (`/events/:id`).
3.  **Availability Check**: System checks ticket availability:
    - **Sold Out**: Banner displayed, purchase button disabled.
    - **Sales Paused**: Banner displayed ("Ticket Sales Are Paused"), purchase blocked.
    - **Sales Ended**: Banner displayed ("Ticket Sales Have Ended"), purchase blocked.
    - **Security Note**: Non-admin users only see availability status (sold out or not), never exact ticket counts.
4.  **Tier Selection**: If available, user chooses a ticket tier:
    - **Regular**: Standard price.
    - **NOTAFLOF**: "No One Turned Away For Lack Of Funds" (sliding scale - min price).
    - **Supporter**: Higher price point to support the community.
5.  **Payment (Stripe Embedded Checkout)**:
    - User clicks "Buy Ticket".
    - Frontend opens a `ticket_order`, which reserves inventory in `event_inventory`.
    - Frontend starts a Stripe Checkout Session in `ui_mode: "embedded_page"` and mounts Stripe's managed embedded checkout without leaving the page.
    - Completion is finalized through the shared order sync + webhook path.
6.  **Ticket Issuance**:
    - Upon successful payment, a `ticket` record is created in Convex.
    - User receives a "Payment Successful" confirmation.
7.  **Digital Entry**: User navigates to their tickets page (`/tickets`) to view their active ticket and QR code.

## 9. Ticket Resale Flow

**Objective**: Enable safe peer-to-peer ticket transfers when events sell out, ensuring sellers recoup costs and buyers gain event access.

**Seller Perspective**:

1.  **List Ticket**: Seller navigates to their tickets page (`/tickets`) and clicks "List for Resale" on a valid ticket.
2.  **Validation**: System verifies:
    - User owns the ticket
    - Ticket status is `valid`
    - Event has resale enabled
    - No existing active listing for this ticket
    - Ticket sales haven't ended and event hasn't occurred
3.  **Listing Created**: `resale_listings` record created with status `listed`. Listing enters the FIFO queue.
4.  **Wait for Sale**: Listing remains in queue until:
    - Event sells out (`remaining ≤ 0`)
    - A buyer purchases the resale ticket
5.  **Completion**:
    - When buyer completes payment, listing transitions to `completed`
    - Seller's original ticket status changes to `transferred`
    - Seller receives refund (original purchase price minus resale fee)

**Buyer Perspective**:

1.  **Event Sold Out**: Buyer views a sold-out event and sees "Resale Available" badge with queue count.
2.  **Notification (Optional)**: Buyer subscribes to resale notifications for the event and receives email via `resaleAvailableTemplate` when tickets are listed.
3.  **Purchase Attempt**: Buyer clicks "Buy Resale Ticket" on the event page.
4.  **Queue Assignment**: System assigns the oldest `listed` listing (FIFO), excluding buyer's own listings. Listing transitions to `pending`.
5.  **Checkout**: Buyer completes Stripe Embedded Checkout (same flow as primary purchase).
6.  **Ticket Transfer**:
    - Upon successful payment, a new `ticket` record is created for the buyer
    - Seller's original ticket marked `transferred`
    - Listing marked `completed`
    - Buyer receives confirmation and can view ticket at `/tickets`
7.  **Expiration Handling**: If buyer abandons checkout, listing reverts to `listed` after timeout and re-enters the queue.

**Notes**:

- **FIFO Queue**: Listings are processed first-in-first-out using `by_event_status` index with ascending order.
- **Sold Out Requirement**: Resale tickets only become purchasable when the event is sold out (`remaining ≤ 0`).
- **Self-Purchase Prevention**: Buyers cannot purchase their own resale listings.
- **Platform Fee**: Sellers receive original purchase price minus the event's `resaleFeePct` (configurable per event).
- **Notification System**: Users subscribe via `resale_notifications` table; emails sent when tickets are listed for sold-out events.
- **Stale Cleanup**: Cron job reverts `pending` listings back to `listed` if buyer abandons checkout.

## 10. At-The-Door Operations (Check-in)

**Objective**: Efficient and secure entry management using digital validation.

1.  **Admin Check-in**: Staff access the **Check-in Tool** (`/admin/check-in`).
2.  **Scanning**: Staff scans the attendee's QR code (via browser camera or manual UUID entry).
3.  **Validation**:
    - The tool verifies ticket status (`valid` and not already `used`).
    - Displays attendee name and ticket tier.
4.  **Entry Confirmation**: Staff clicks "Check In", updating the ticket record status to `used` with a timestamp.

## 11. Community Security & Accountability

**Objective**: Maintain space safety through referral tracing and administrative control.

1.  **Referral Tracing**: If an incident occurs, admins use the **Admin Portal** to trace the problematic user back to their original application and the person who referred them.
2.  **Access Revocation**: Admins can revoke a user's approved application for a specific community, removing that organizer-scoped access.

## 12. Account Management & Support

**Objective**: Provide a self-service way for users to manage their data and get help.

1.  **Profile Management**: User manages their name and email via `/account`.
2.  **Email Verification**: New email/pass users must confirm their email via the link sent to their inbox (`/confirm/verification/:token`).
3.  **Support Access**: Users visit `/support` for process info or `/privacy` and `/terms` for legal compliance info.

## 13. Marketing Email Unsubscribe Flow

**Objective**: Allow recipients to opt out of marketing emails per-organizer or globally, via one-click or preference-center links.

1.  **Email Receipt**: User receives a marketing email (event announcement) from an organizer.
2.  **One-Click Unsubscribe**: Email client supporting RFC 8058 sends POST to `/api/unsubscribe/one-click?token=...`, which calls `unsubscribeByToken` to opt the user out from that organizer.
3.  **Link Click (Fallback)**: User clicks the "Unsubscribe" link in the email body, navigating to `/api/unsubscribe?token=...`.
4.  **Backend Processing**: HTTP endpoint calls `unsubscribeByToken` mutation, which updates `marketingEmailPreferences.optedIn` to `false` for that organizer.
5.  **Redirect**: Backend redirects to `/unsubscribe?token=...&done=true` to show confirmation.
6.  **Preference Center**: Frontend loads preferences via `/api/unsubscribe-preferences?token=...`, displaying which organizer was unsubscribed and showing other opted-in organizers.
7.  **Toggle Preference**: User can toggle individual organizer preferences via `/api/unsubscribe-toggle` or unsubscribe from all via `/api/unsubscribe-all`.
8.  **Account Settings**: Authenticated users can also manage preferences at `/account#email-preferences`.

**CAN-SPAM Compliance Notes**:

- Marketing emails include `List-Unsubscribe` header pointing to the one-click endpoint.
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header enables RFC 8058 one-click processing.
- Transactional emails (ticket confirmations, password resets) are not affected by marketing opt-out.
- Global opt-out sets `users.globalMarketingOptOut: true` and disables all marketing emails.

## 14. Email Change Flow

**Objective**: Allow authenticated users to securely change their account email address.

1.  **Request**: User enters a new email address in the account settings form (`/account`).
2.  **Validation**: Backend validates the new email format and checks for conflicts with existing accounts.
3.  **Pending State**: System sets `pendingEmail` on the user record and initiates the Better Auth email change flow.
4.  **Confirmation Email**: A branded confirmation email is sent to the **current email address** (not the new one).
5.  **User Clicks Current-Inbox Link**: User clicks the confirmation link in the current inbox, which redirects to `/confirm/email-change` without an OTT token.
6.  **Step-1 State Detection**: Frontend checks the authenticated user state:
    - **Pending**: Shows "Almost Done" message, prompting user to verify the link sent to their new inbox.
7.  **User Clicks New-Inbox Link**: User clicks the follow-up verification link in the new inbox, which navigates to `/confirm/email-change?ott=...`.
8.  **Backend Processing**: The one-time token (OTT) is validated and the email change is processed by Better Auth.
9.  **Completion**: Frontend shows "Email Changed!" and redirects back to `/account` with the updated email.

**Security Note**: The confirmation email is sent to the **old email address**, not the new one. This prevents account takeover: if an attacker gains temporary access to a user's session and attempts to change the email, the legitimate owner (who still controls the old email) receives the confirmation link and can deny the change by ignoring it.

## 15. Administrative Event Creation

**Objective**: Enable staff to list and configure new community events.

1.  **Initiation**: Admin navigates to `/admin/events/new`.
2.  **Configuration**:
    - **Flyer Upload**: Admin selects a 4:5 or 1:1 image for the event poster.
    - **Core Info**: Admin provides Title, Date (via Calendar picker), and Location.
    - **Ticketing Strategy**:
      - **Base Price**: Sets the standard ticket cost.
      - **Inventory**: Defines total available tickets.
      - **Sliding Scale**: Optionally enables NOTAFLOF tier with min/max bounds.
      - **Supporter Tier**: Optionally sets a higher default price for community support.
      - **Control**: Sets `maxTicketsPerUser` to prevent scalping.
3.  **Validation**: Frontend ensures `supporterPrice > basePrice` and required fields are present.
4.  **Publishing**: Upon submission, the event is saved to Convex with a `published` status and becomes visible on user dashboards.

## 16. Administrative Event Modification

**Objective**: Allow staff to update event details or adjust ticket inventory.

1.  **Access**: Admin selects an existing event and navigates to `/admin/events/:id/edit`.
2.  **Modification**: Admin updates details (e.g., updating location, adjusting ticket counts, or uploading a revised flyer).
3.  **Save**: Admin submits the reactive form.
4.  **Sync**: Changes are persisted to Convex and immediately reflect for all users via real-time subscriptions.

## 17. Administrative Event Management & Sales Insights

**Objective**: Give organizers clear, transparent visibility into ticket sales and revenue, with controls to manage sales availability.

1.  **Access**: Admin navigates to `/admin/events/:id/manage` from the Admin Events list.
2.  **Status Visibility**:
    - View current ticket sales status: **Active**, **Paused**, **Ended**, or **Sold Out**.
    - Status banners provide clear visual indication of current state.
3.  **Ticket Sales Control**:
    - **Pause Sales**: Temporarily stop ticket sales (e.g., during capacity review).
    - **Resume Sales**: Re-enable ticket purchases after a pause.
    - **End Sales**: Permanently stop ticket sales for the event.
    - Note: These controls are immediately reflected on user-facing pages.
4.  **Sales Overview**:
    - View **tickets sold / total tickets** with percentage.
    - See **ticket tiers sold** (Regular, NOTAFLOF, Supporter).
    - Inspect **sales per day** area chart (aggregated in California time).
5.  **Revenue Transparency**:
    - View **gross revenue** and **net revenue**.
    - See explicit fee breakdown:
      - **Stripe fees** (2.9% + $0.30 per transaction)
      - **Platform fee** (2%)
6.  **Revenue by Ticket Type**:
    - Review gross + net revenue and quantity per tier.
7.  **Buyer List**:
    - Inspect purchases with buyer name/email, quantity, amount, tier, and purchase time.

## 18. Administrative Event Cancellation Flow

**Objective**: Enable organizers to cancel events while ensuring buyers are properly notified and refunds are handled appropriately.

1.  **Admin Decision**: Admin decides an event needs to be cancelled (e.g., venue issue, weather, performer cancellation).
2.  **Cancellation Action**: Admin navigates to the event management page and changes the event status to cancelled.
3.  **Immediate Effects**:
    - Event is immediately hidden from public event listings.
    - Buyers with pending purchases receive notification that their purchase attempt was cancelled.
    - No new purchases can be made for the event.
4.  **Existing Ticket Holders**:
    - Buyers with confirmed tickets retain their tickets (not automatically refunded).
    - Buyers receive notification that the event has been cancelled.
    - Admin can review the buyer list and process refunds manually if needed.
5.  **Admin Options After Cancellation**:
    - Admin can review all ticket holders and refund individually or in batches.
    - Admin can offer alternative compensation (e.g., future event credit, ticket transfer to rescheduled date).
    - Admin can communicate directly with ticket holders through the broadcast feature.
6.  **Record Keeping**:
    - Cancelled events remain visible in admin dashboards for reference.
    - All financial records and buyer information are preserved for accounting and support purposes.

**Notes**:

- **Pending vs. Confirmed Purchases**: Buyers who started but did not complete their purchase are automatically notified and their pending order is cancelled. Buyers who already purchased tickets keep their tickets and are notified about the cancellation, allowing the organizer to handle refunds case-by-case.
- **Rescheduling Flexibility**: Tickets are not automatically refunded because organizers may want to reschedule the event or offer alternative compensation. This gives organizers time to communicate options to ticket holders before processing refunds.
- **Protection Against Late Payments**: If a payment completes after the event is cancelled (e.g., due to processing delays), the buyer is automatically refunded to prevent charges for a cancelled event.

## 19. Event Broadcast Flow

**Objective**: Enable event admins to send informational messages to all ticket holders.

1.  **Access**: Admin navigates to the event management page and selects the "Broadcast" option.
2.  **Audience Preview**: Admin sees how many ticket holders will receive the message.
3.  **Message Composition**:
    - Admin enters a subject line for the email.
    - Admin writes the message content they want to send.
4.  **Sending**:
    - Admin clicks "Send Broadcast" to deliver the message.
    - System validates the message and confirms the audience size.
5.  **Recipient Experience**:
    - Each ticket holder receives an email with the subject and message.
    - Email includes event details and a link to view the event.
    - Each person receives only one copy, even if they hold multiple tickets.
6.  **Outcome**:
    - All eligible ticket holders receive the admin's message.
    - Admin can view a history of sent broadcasts with details on recipient count and send time.

**Notes**:

- **Recipient Eligibility**: Only current ticket holders receive broadcasts. People with refunded, used, or expired tickets do not receive messages.
- **Deduplication**: Each person receives exactly one copy, regardless of how many tickets they hold.
- **Guest Checkout**: People who purchased tickets without creating an account still receive broadcasts at their provided email address.
- **Named Guests**: Guests added by ticket holders are also included in the recipient list.

## 20. Data Access Security Model

**Objective**: Protect sensitive operational data while providing necessary information to users.

1.  **Ticket Availability (Non-Admin Users)**:
    - Users can only see:
      - Whether an event is **sold out** (boolean).
      - The current **ticket sales status** (active, paused, or ended).
    - Users **cannot** see: total ticket count, sold count, or remaining tickets.
2.  **Ticket Availability (Admin Users)**:
    - Admins receive full details: total tickets, sold count, remaining tickets, and sold out status.
3.  **Event Management Data**:
    - All management data (revenue, buyer list, sales charts) is restricted to admin users only.
    - Access is audited via `adminAuditLogs` table.
4.  **Handler-Level Authorization**:
    - All public-facing queries and mutations use bare `query` / `mutation` with explicit auth and authz checks in the handler.
    - Organizer-scoped permissions are enforced through `backend/convex/lib/authz.ts` and `backend/convex/lib/access.ts`.
    - Internal functions still use `internalQuery` / `internalMutation` for system-level operations.

## 21. Guest Checkout (No Account Required)

**Objective**: Allow unvetted users to purchase tickets for public events without creating an account.

1.  **Entry**: Unauthenticated user visits a public event page (`/events/:id`).
2.  **Purchase**: User enters name, email, and payment info directly.
3.  **Session**: A guest session token is created (no password, no email verification).
4.  **Payment**: Processed identically to authenticated purchases through embedded Stripe Checkout Sessions.
5.  **Ticket Delivery**: Guest receives ticket via email. Can view via magic link.
6.  **Migration**: If guest later creates an account with the same email, tickets are silently migrated.

## 22. Refund Flow

**Objective**: Enable admins to issue refunds while preserving accurate inventory and financial records.

**User Journey**:

1.  **Admin Initiates Refund**: Admin navigates to the event management or user management page and locates the purchase to refund.
2.  **Admin Chooses Refund Type**:
    - **Standard Refund**: Refunds only unused tickets, preserving the status of tickets that have already been used for event entry.
    - **Force Refund**: Refunds all remaining balance regardless of whether tickets have been used.
    - **Single Ticket Refund**: Refunds a specific ticket from a multi-ticket order.
3.  **System Validates**: The system checks that the payment can be refunded and that there are refundable tickets or balance available.
4.  **Refund Processed**: The system processes the refund through the payment provider.
5.  **Tickets Cancelled**: Refunded tickets are cancelled and can no longer be used for event entry.
6.  **Inventory Updated**: Event inventory is adjusted to reflect the cancelled tickets.
7.  **Customer Notified**: The customer receives confirmation of the refund.
8.  **Outcome**: The refund is complete. The customer has their money back (minus any non-refundable processing fees), the tickets are cancelled, and the event has accurate inventory.

**Notes**:

- **External Refunds**: Refunds initiated from the payment provider dashboard are automatically handled and reflected in the system.
- **Dispute-Related Refunds**: Chargebacks are tracked separately and managed through the payment dispute process.
- **Late Payments**: If a payment arrives after an order has expired or been released, the system automatically refunds the payment.
- **Processing Fees**: Non-refundable processing fees may be deducted from the refund amount.

## 23. Community Creation Flow

**Objective**: Enable root administrators to establish new communities on the platform.

1.  **Initiation**: Root admin accesses community creation via one of two entry points:
    - **Direct Creation**: Navigate to `/admin/communities/new` to create a community manually.
    - **Invite Flow**: Use the "Invite Admin" dialog to create a community and invite its first admin in one action.
2.  **Direct Creation Process**:
    - Root admin fills out the community form with:
      - **Required Fields**: Name, slug (auto-generated from name, manually editable).
      - **Optional Fields**: Email, contact info, description, website, code of conduct.
      - **Visibility**: Toggle public directory listing visibility.
      - **Vetting Questions**: Define custom questions for event applications (text, long_text, boolean, select, checkbox types).
      - **Status**: Choose `draft` (default) or `published`.
    - Form validation ensures required fields are complete before submission.
    - Community is created and visible in the communities list.
    - Root admin is redirected to the communities list after successful creation.
3.  **Invite Flow Process**:
    - Root admin provides invitee email and community name via the "Invite Admin" dialog.
    - System creates the community and sends an invitation email to the new admin.
    - Invitee receives an email with a redemption link (`/admin-invite/:token`).
    - Invitee clicks the link and accepts the invitation, becoming the first community admin.
    - New admin can immediately manage the community and invite additional admins.
4.  **Publishing Constraints**:
    - Cannot publish without at least one vetting question.
    - For non-platform organizers: Requires Stripe Connect account with completed onboarding.
    - Platform organizer flag can only be set by root admin (special case for Braket itself).
5.  **Admin Assignment**:
    - **Post-Creation**: After direct creation, root admin can invite additional admins to the community.
    - **Invite Flow**: Admin is automatically assigned during community creation.
    - All admin assignments are tracked with attribution showing who granted access.
6.  **Audit Trail**: All community creation actions are logged with organizer ID and creation source for accountability.

**Note**: Both flows require root admin authentication.

## 24. Community Admin Management

**Objective**: Allow community organizers to manage their own events, staff, and members without root admin involvement.

1.  **Invitation**: Root admin or existing community admin sends an admin invite for a specific community.
2.  **Acceptance**: Invitee clicks magic link (`/admin-invite/:token`), which atomically creates the community (if new) and grants the admin role.
3.  **Scoping**: Community admins can only manage events, applications, and staff within their own community — they cannot see or modify other communities' data.
4.  **Staff Assignment**: Community admins assign scanners (door staff) for their community's events.
5.  **Audit Trail**: All admin actions are logged to `adminAuditLogs` with the community's `organizerId`.

## 25. Trust Link Management Flow

**Objective**: Allow members of one community to purchase tickets for events hosted by another community.

**Admin Journey**:

1.  **Setting Up Trust**: A root admin establishes a trust relationship between two communities:
    - They specify which community's events should become accessible (the trusting community).
    - They specify which community's approved members should gain access (the trusted community).
    - They can optionally set an expiration date for the trust relationship.

2.  **System Safeguards**: The system prevents invalid configurations:
    - A community cannot trust itself.
    - Duplicate active trust relationships between the same two communities are blocked.

3.  **Access Activation**: Once established, approved members of the trusted community can purchase tickets for the trusting community's events as if they were members of both communities.

4.  **Temporary Suspension**: The admin can pause the trust relationship at any time:
    - Members of the trusted community temporarily lose access to the trusting community's events.
    - The admin can later restore access by resuming the trust relationship.

5.  **Permanent Removal**: The admin can permanently revoke the trust:
    - Members of the trusted community lose access going forward.
    - The system warns the admin if any scheduled announcements were set to reach members of both communities, since the audience will shrink.

6.  **Operational Tracking**: All trust link management actions are logged for administrative oversight.

**Member Experience**:

- Approved members of the trusted community see events from both communities in their event listings.
- During purchase, their access is automatically verified without any additional steps.
- If a trust relationship is paused or revoked, they see only events from their own community.

## 26. Community Directory

**Objective**: Users browse communities on the platform.

1.  **Browse**: Users can browse the community directory without logging in.
2.  **Details**: Each community displays its name, description, logo, and upcoming public events.
3.  **Outcome**: Users can discover and explore communities to find events and groups that interest them.
