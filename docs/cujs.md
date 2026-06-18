---
title: Critical user journeys
category: Architecture
order: 2
description: User journeys that define what this product reliably does. The north star for development and agent work.
access: public
---

# Critical user journeys

This is the inventory of journeys this product must keep working. It is the reference humans and agents should consult when deciding what is important, what to test, what to monitor, and what to be careful with. Entries are organized by user goal, not by feature surface or admin page.

Each cluster heading names a user goal. The entries underneath are the journeys that achieve that goal, described at engineering grain with routes, mutations, and failure modes named. If you're doing canonical CUJ work in the Bargas-Avila sense, treat the cluster headings as the CUJs and the entries as tasks. The doc uses "CUJ" loosely throughout.

Ground rules:

- Each entry describes what a user does, sees, and ends up with. Internal mechanics (table names, indexes, validator shapes, enum vocabularies) belong in code, not in this doc. If you spot one creeping in during edits, take it out.
- Criticality is not the same as "this exists in the product." Some flows carry revenue. Some are safety promises this platform makes to its community. Some are operations continuity. The criticality tag on each entry says which.
- Every entry names the route(s) and the primary backend functions so the doc stays close to the code. If a route or mutation moves and this doc does not get updated, the next read should catch it.

If a journey is missing, add it. If an entry has drifted from what the code does, fix it. Don't pad with detail you'd be embarrassed to defend later.

## Reading an entry

Every entry uses the same shape:

- **Who**: the role(s) the journey is for.
- **Criticality**: one or more of _revenue_, _safety_, _ops_, with one line on why this matters.
- **Entry points**: routes, emails, or external triggers that start the flow.
- **Successful outcome**: the world-state when the journey ends well. This is what an end-to-end check should be able to assert.
- **Path**: numbered steps. Branches are called out where the journey forks.
- **Failure modes**: where users drop off or hit an error, and what they see.
- **Code anchors**: file paths to the route(s) and the load-bearing backend functions.

---

## 1. Get into your account and stay in control of it

_Authentication and account._

These are foundational. They sit underneath every other journey on the platform. They are also where the most sensitive security behavior lives, like account takeover prevention and email enumeration resistance. If these break, nothing else works.

### 1.1 Sign up with email and password

**Who**: anyone with an email address.
**Criticality**: safety. Email verification is what gates access to vetting and authenticated purchase.
**Entry points**: `/login` (Register tab).
**Successful outcome**: the user has an account with a verified email and can sign in.

**Path**

1. User opens `/login` and switches to the Register tab.
2. User enters name, email, and password.
3. The system checks the email isn't already in use. If it is, the user sees an error and stays on the form.
4. The system creates the account and sends a verification email. The user is redirected to `/login?registered=true` with a "check your email" message.
5. User opens the verification email and clicks the link. The link routes to `/confirm/verification/:token`.
6. On success, the user can sign in. From there they're prompted to apply to a community before they can buy authenticated tickets.

**Failure modes**

- Email already in use: blocked at step 3 with a clear error.
- Verification link expired or already used: user lands on a page that lets them request a new link.
- Verification email never arrives: there is no in-app retry surface today. Recovery is out of band.

**Code anchors**

- Routes: [login.component.ts](frontend/src/app/features/auth/pages/login/login.component.ts), [confirm-verification.component.ts](frontend/src/app/features/auth/pages/confirm/confirm-verification.component.ts)
- Backend: [auth/public.ts](backend/convex/auth/public.ts)

### 1.2 Sign in with email and password

**Who**: existing users with a verified email.
**Criticality**: revenue, ops. Every authenticated journey starts here.
**Entry points**: `/login` (Login tab).
**Successful outcome**: an authenticated session is established. The user lands at `/` (which is the dashboard for authenticated users) or, if the URL had a `returnUrl` query param, at that destination. The legacy `/dashboard` path redirects to `/`.

**Path**

1. User opens `/login` and enters email and password.
2. The system checks credentials. If the email exists but is not verified, the user is blocked and prompted to verify.
3. On invalid credentials, the user sees a generic error that does not reveal whether the email exists.
4. On success, an auth session is established and the user is redirected.

**Failure modes**

- Unverified account: user is blocked and shown the verify path.
- Wrong password: generic error. Rate limiting on the sign-in endpoint is delegated to Better Auth's defaults; if you need a specific policy, check what Better Auth ships with.
- Session sync fails after auth: the user is authenticated but has no profile. Dashboard handles this gracefully and prompts retry.

**Code anchors**

- Route: [login.component.ts](frontend/src/app/features/auth/pages/login/login.component.ts)
- Backend: [auth/public.ts](backend/convex/auth/public.ts)

### 1.3 Sign in with a social provider

**Who**: anyone with a Google or Discord account.
**Criticality**: revenue. The fastest path into the platform.
**Entry points**: `/login` (provider buttons).
**Successful outcome**: an authenticated session is established. New users get an account auto-provisioned; existing users sign into the matching account.

**Path**

1. User clicks Google or Discord on `/login`.
2. The browser is redirected to the provider's OAuth page.
3. The provider verifies the user and returns to the app's callback. The frontend handles two return paths: a token-based callback and an authorization code path that routes through `/confirm/social-signin`.
4. If the verified provider email matches an existing local account, the session is signed into that account. If not, a new account is provisioned.
5. New social signups may be required to complete a profile step before reaching the dashboard.

**Failure modes**

- Provider denies access: user is returned to `/login` with an error.
- Provider email is unverified: the merge is rejected to prevent account takeover.
- Profile completion is required but the user closes the tab: the next sign-in resumes the prompt.

**Code anchors**

- Routes: [login.component.ts](frontend/src/app/features/auth/pages/login/login.component.ts), [confirm-social-signin.component.ts](frontend/src/app/features/auth/pages/confirm/confirm-social-signin.component.ts), [complete-social-signup.component.ts](frontend/src/app/features/auth/pages/confirm/complete-social-signup.component.ts)
- Backend: [auth/public.ts](backend/convex/auth/public.ts)

### 1.4 Reset a forgotten password

**Who**: any user who registered with email and password.
**Criticality**: safety. Password reset is the recovery path for account access.
**Entry points**: `/login` "Forgot password?" link, password reset email.
**Successful outcome**: the user has set a new password and can sign in with it.

**Path**

1. User clicks "Forgot password?" on `/login` and enters their email.
2. The system always responds with success regardless of whether the email exists. This is intentional and prevents account enumeration.
3. If the email is registered, a password reset email is sent with a single-use, time-limited link.
4. User clicks the link, which opens `/confirm/password-reset?token=...`.
5. User enters and confirms a new password (8 to 72 characters).
6. The system validates the token and updates the password. User sees a success screen with a link back to login.

**Failure modes**

- Token expired or already used: user sees a clear error and can request a fresh link.
- Password fails strength check: form-level validation, no submission.

**Code anchors**

- Routes: [login.component.ts](frontend/src/app/features/auth/pages/login/login.component.ts), [confirm-password-reset.component.ts](frontend/src/app/features/auth/pages/confirm/confirm-password-reset.component.ts)
- Backend: [auth/public.ts](backend/convex/auth/public.ts)

### 1.5 Link or unlink a social provider

**Who**: authenticated users.
**Criticality**: ops. Convenience, not a hard requirement, but losing this path loses returning users.
**Entry points**: `/account` (connected providers section).
**Successful outcome**: the user's account has the desired set of linked providers.

**Path**

1. User opens `/account` and views the connected providers section.
2. To link: user clicks "Link" for a provider, completes provider auth, and is returned to `/confirm/social-link`. The provider now appears in the linked list.
3. To unlink: user confirms the unlink, the provider is removed from the linked list, and email-and-password access remains.

**Failure modes**

- Unlinking the only sign-in method: refused. The check is enforced by Better Auth's `unlinkAccount` API, which our handler delegates to. Auth setup lives in [lib/better_auth.ts](backend/convex/lib/better_auth.ts); if you change the providers list or password mode, re-verify the policy.
- Link or unlink errors from the provider or auth library are surfaced through the auth error mapper.

**Code anchors**

- Routes: [account.component.ts](frontend/src/app/features/auth/pages/account/account.component.ts), [confirm-social-link.component.ts](frontend/src/app/features/auth/pages/confirm/confirm-social-link.component.ts)
- Backend: [auth/public.ts](backend/convex/auth/public.ts) (`unlinkSocialAccount`)

### 1.6 Change account email

**Who**: authenticated users.
**Criticality**: safety. The email is the account's identity and recovery channel. Compromise here is a takeover.
**Entry points**: `/account`.
**Successful outcome**: the account's email is updated to a new verified address.

**Path**

1. User enters a new email in `/account`.
2. The system validates the new email and checks for conflicts.
3. The system marks the change pending and sends a confirmation link to the **old** email address. This is the takeover defense: the legitimate owner can refuse the change by ignoring it.
4. User clicks the old-inbox link and lands on `/confirm/email-change`. The page acknowledges the request and prompts the user to verify the new inbox.
5. A second link is sent to the new inbox. User clicks it, which opens `/confirm/email-change?ott=...`.
6. The token is validated and the email is updated. User is returned to `/account` with the new email shown.

**Failure modes**

- New email already in use: blocked at step 2.
- User abandons after the first link: the change stays pending until the new-inbox link expires.

**Code anchors**

- Routes: [account.component.ts](frontend/src/app/features/auth/pages/account/account.component.ts), [confirm-email-change.component.ts](frontend/src/app/features/auth/pages/confirm/confirm-email-change.component.ts)

### 1.7 Manage marketing email preferences

**Who**: anyone receiving marketing email from the platform (authenticated users and guests).
**Criticality**: safety. Recipients expect opt-out to work, and the platform's deliverability across all organizers depends on it.
**Entry points**: any marketing email (one-click header, footer link), `/account` email preferences section.
**Successful outcome**: the user's marketing preferences match their stated intent. Per-organizer or global opt-out is honored on the next send.

**Path**

1. From an email: the user's mail client may issue a one-click POST to the unsubscribe endpoint, or the user clicks the footer link, which opens the preference center.
2. From the account page: authenticated users can toggle per-organizer marketing or unsubscribe from all organizers in one move.
3. The preference center (token-based, no login required) shows which organizer the user is opting out of and lists other organizers they're still opted into.
4. Transactional email (ticket confirmations, password resets) is not affected. Unsubscribe applies only to marketing.

**Failure modes**

- Token expired or invalid: preference center shows an error and asks the user to use the latest email.
- Server error during one-click POST: mail clients retry. Backend is idempotent.

**Code anchors**

- Routes: [unsubscribe.ts](frontend/src/app/features/legal/pages/unsubscribe/unsubscribe.ts), [account.component.ts](frontend/src/app/features/auth/pages/account/account.component.ts)
- HTTP: [/api/unsubscribe](backend/convex/http.ts), [/api/unsubscribe/one-click](backend/convex/http.ts), [/api/unsubscribe-preferences](backend/convex/http.ts), [/api/unsubscribe-toggle](backend/convex/http.ts), [/api/unsubscribe-all](backend/convex/http.ts)
- Backend: [marketing/emails.ts](backend/convex/marketing/emails.ts)

---

## 2. Earn access to a community you trust

_Joining a community._

This platform is community-vetted. Most authenticated buying happens after a community admin has approved the user, or after the user has redeemed a trusted invite link. Vetting is not paperwork. It is the safety promise the product makes.

### 2.1 Apply to a community via the vetting form

**Who**: authenticated users with a verified email.
**Criticality**: safety. This is the gate that decides who joins a community. Misuse here harms members.
**Entry points**: `/vetting/:id` (community-specific), prompts on the dashboard.
**Successful outcome**: an application record exists for the user against that community, with a status of pending, approved, or rejected. On approval, the user can buy tickets to that community's events.

**Path**

1. User lands on `/vetting/:id` for a specific community.
2. User reads the community's code of conduct and answers the vetting questions configured by that community admin.
3. User submits. The application enters pending state and the user is taken to a status screen on the dashboard.
4. A community admin reviews the application (see 7.3). The admin approves or rejects.
5. **Approved**: user receives an approval email. The dashboard shows access granted to that community. The user can now buy tickets.
6. **Rejected**: user receives a rejection email. The dashboard reflects the rejection.

A user can apply to multiple communities. Status is tracked per-community.

**Failure modes**

- User abandons partway through the form: no record is saved.
- Application stays pending too long: admins are nudged via the digest in 7.4. (Note: the platform-admin reminder in 8.2 nudges users who never applied at all, not pending applicants. There is no automated reminder for pending applications today.)
- User applies to a community that already approved them: the form short-circuits to the existing approved state.

**Code anchors**

- Route: [vetting.component.ts](frontend/src/app/features/vetting/pages/vetting/vetting.component.ts)
- Backend: [communities/applications.ts](backend/convex/communities/applications.ts) (`submit`, `getMyApplications`, `review`)
- Email: `applicationApprovedTemplate`, `applicationRejectedTemplate` in [email/templates.ts](backend/convex/email/templates.ts)

### 2.2 Redeem a community invite link

**Who**: anyone with a valid invite link, authenticated or not.
**Criticality**: safety, ops. This is the no-vetting path into a community. Trusted invites bypass the form, so abuse here breaks the safety model.
**Entry points**: `/invite/:token` (and legacy `/join/:token`, `/apply/:token` redirects).
**Successful outcome**: the user has community member access without going through the vetting form.

**Path**

1. User clicks an invite link.
2. The frontend validates the token. If the link is paused, disabled, expired, or maxed out, the user sees a clear error.
3. If the user is not signed in, they are routed to login or signup with the invite preserved as a return URL.
4. After authentication, the redemption mutation runs and grants the user member access to that community. The user is opted into that organizer's marketing unless they had previously opted out globally.
5. The user sees a confirmation and is redirected home.
6. If the user already has access (member or previously redeemed), the system reports success with a friendly "already a member" or "already used this link" message.

**Failure modes**

- Token revoked between page load and submit: user sees a refreshed error.
- Account creation succeeds but redemption fails: rare, but the link can be re-clicked.

**Code anchors**

- Route: [invite.component.ts](frontend/src/app/features/invite/pages/invite/invite.component.ts)
- Backend: [communities/invite_links.ts](backend/convex/communities/invite_links.ts) (`validateToken`, `redeem`)

---

## 3. Buy a ticket to an event you want to attend

_Buying a ticket._

This is the most critical journey on the platform. If buying a ticket breaks, there is no platform. It also has the most branching: paid vs free, member vs guest, fresh vs resumed checkout.

### 3.1 Buy a paid ticket as a vetted member

**Who**: authenticated members of the event's community (or a community trusted by it).
**Criticality**: revenue. Direct revenue path.
**Entry points**: `/dashboard`, `/events`, `/events/:id`.
**Successful outcome**: the user has a ticket record, has been emailed a confirmation with a PDF, and can see the QR code on `/tickets`.

**Path**

1. The user lands on the dashboard at `/`. The dashboard is the canonical discovery surface for vetted members and shows the events visible to them across every community they belong to (and every community trusted by those communities). Alternative entry: `/events` (filtered by community) or a direct event link from email.
2. User opens an event. The page shows the event's availability state. If sales are paused, ended, or sold out, the purchase action is disabled and the user sees a banner explaining why.
3. User picks a tier. Tiers are Regular, NOTAFLOF (sliding scale at or above a minimum), and Supporter (priced higher to support the community).
4. User clicks Buy. The system opens a ticket order, reserving inventory.
5. Stripe Embedded Checkout mounts in the page. User pays without leaving.
6. On completion, the order is finalized, the ticket is issued, and the user sees a confirmation. A confirmation email with a PDF ticket is sent.
7. User can view the ticket and QR at `/tickets`.

**Failure modes**

- Inventory ran out between page load and order open: order returns sold-out, user sees the updated state.
- Payment declined: order is released, inventory is freed, user can retry.
- User abandons mid-checkout: order expires on a timeout. Inventory is freed.
- Stripe webhook is delayed: confirmation page polls; meanwhile the email and ticket appear once the webhook settles.

**Code anchors**

- Routes: [event-details.component.ts](frontend/src/app/features/tickets/pages/event-details/event-details.component.ts), [tickets.component.ts](frontend/src/app/features/tickets/pages/tickets/tickets.component.ts)
- Backend: [orders/core.ts](backend/convex/orders/core.ts) (`open`, `startCheckout`, `syncCheckoutSession`, `getCheckoutStatus`)

### 3.2 Buy a paid ticket as a guest

**Who**: unauthenticated users.
**Criticality**: revenue. Critical for events that are open to guests, especially before someone goes through vetting.
**Entry points**: `/events/:id` (public events).
**Successful outcome**: the guest has a ticket reachable from a magic link in their email, with the option to convert to an account later.

**Path**

1. Unauthenticated user opens a public event page.
2. User enters name, email, and pays. No password, no email verification step.
3. A guest session token is created. The user is taken through embedded Stripe Checkout and the ticket is issued.
4. Confirmation email includes a magic link the guest can use to come back to their tickets.
5. If the guest later signs up with the same email, the tickets purchased as guest are migrated silently into the new account.

**Failure modes**

- Guest closes the tab during checkout: see 3.3 (resume).
- Email typo blocks delivery: there is no in-app recovery; the guest must check spelling and try again from a new flow.

**Code anchors**

- Route: [event-details.component.ts](frontend/src/app/features/tickets/pages/event-details/event-details.component.ts)
- Backend: [orders/core.ts](backend/convex/orders/core.ts) (`openForGuest`), [guest_sessions/core.ts](backend/convex/guest_sessions/core.ts), [guest_sessions/actions.ts](backend/convex/guest_sessions/actions.ts) (`initiateGuestSession`)

### 3.3 Resume an abandoned guest checkout

**Who**: guests who started but did not complete a purchase.
**Criticality**: revenue. Recovery of in-flight intent.
**Entry points**: emailed resume link.
**Successful outcome**: the guest returns to checkout with their cart and contact info preserved.

**Path**

1. Guest abandons mid-checkout. Backend captures session state.
2. After a short delay, an email is sent containing a resume link tied to the same guest session.
3. Guest clicks the link, lands back on the event page with the prior state, and can complete payment.

**Failure modes**

- Resume link expires: guest must start fresh. The cart is gone.
- Inventory was bought up while the user was away: standard sold-out behavior takes over.

**Code anchors**

- Backend: [guest_sessions/\_impl/actions.ts](backend/convex/guest_sessions/_impl/actions.ts), [guest_sessions/core.ts](backend/convex/guest_sessions/core.ts) (`prepareResumeSessionToken`, `promoteResumeSessionToken`)
- Email: `guestCheckoutResumeTemplate` in [email/templates.ts](backend/convex/email/templates.ts)

### 3.4 Claim a free ticket

**Who**: members or guests, on events that allow zero-priced tiers (a NOTAFLOF tier with a $0 minimum, or any other free configuration).
**Criticality**: revenue-adjacent. Free tickets do not produce revenue but they do consume inventory and produce attendance, both of which matter operationally.
**Entry points**: `/events/:id`.
**Successful outcome**: the user has a ticket without paying. Stripe is not involved.

**Path**

1. User picks a free tier on the event page. The checkout sidebar surfaces a "claim" CTA instead of "buy."
2. The system claims the ticket directly via the free-claim mutation. No Stripe Checkout is mounted.
3. The ticket is issued and a confirmation email is sent.

**Failure modes**

- User has already hit `maxTicketsPerUser` for this event: claim refused.
- Tier price is non-zero: the free-claim path is not offered; the user goes through normal paid checkout instead.

**Code anchors**

- Frontend: [checkout-sidebar.component.ts](frontend/src/app/features/tickets/components/checkout-sidebar/checkout-sidebar.component.ts)
- Backend: [orders/core.ts](backend/convex/orders/core.ts) (`claimFreeTicket`, `claimFreeTicketAsGuest`)

### 3.5 Access a purchased ticket (view, PDF, magic link)

**Who**: any ticket holder.
**Criticality**: ops. If a buyer cannot reach their ticket, they cannot get into the event.
**Entry points**: `/tickets`, ticket confirmation email, guest magic link.
**Successful outcome**: the user sees their ticket, has a QR code that scans at the door, and can download the ticket PDF.

**Path**

1. Authenticated user opens `/tickets`. Active and past tickets are listed.
2. Selecting a ticket shows the QR and option to download the PDF.
3. Guests use the magic link in their confirmation email to reach the same view.
4. The PDF is generated on demand and emailed alongside the original confirmation.

**Failure modes**

- Magic link expired or revoked: guest is asked to recover via email.
- PDF generation fails: in-app QR still scans at the door. The PDF is convenience, not the ticket itself.

**Code anchors**

- Route: [tickets.component.ts](frontend/src/app/features/tickets/pages/tickets/tickets.component.ts)
- Backend: [tickets/public.ts](backend/convex/tickets/public.ts) (`getMyTickets`, `get`), [tickets/actions.ts](backend/convex/tickets/actions.ts) (`generateTicketPdf`, `getMyTicketPdf`)

### 3.6 Subscribe to resale availability for a sold-out event

**Who**: members who want a ticket to a sold-out event.
**Criticality**: revenue. Demand capture for resale, and the only path most buyers will use to get into a sold-out show.
**Entry points**: `/events/:id` (resale section visible when sold out).
**Successful outcome**: the user is subscribed and will be emailed when a resale ticket is listed for that event.

**Path**

1. User opens a sold-out event page.
2. User clicks "Get notified" on the resale section.
3. A subscription record is created. When sellers list tickets, subscribers are emailed.
4. User can unsubscribe from the same control or via the email's footer link.

**Failure modes**

- User is already subscribed: the button reflects the subscribed state.
- Buyer is themselves a seller for this event: subscription is allowed but they cannot buy their own listing.

**Code anchors**

- Component: [event-details.component.ts](frontend/src/app/features/tickets/pages/event-details/event-details.component.ts)
- Backend: [resale/listings.ts](backend/convex/resale/listings.ts) (`subscribeToResaleNotifications`, `unsubscribeFromResaleNotifications`)
- Email: `resaleAvailableTemplate` in [email/templates.ts](backend/convex/email/templates.ts)

---

## 4. Release a ticket you can't use, or get into one for a sold-out event

_Reselling a ticket._

Resale is how buyers get into sold-out events and how sellers recoup costs when plans change. Both sides have to work for either to feel safe.

### 4.1 List a ticket for resale (and cancel a listing)

**Who**: ticket holders for events that have resale enabled.
**Criticality**: revenue. Listing is the seller-side input to resale supply.
**Entry points**: `/tickets`.
**Successful outcome**: the listing is in the FIFO queue. When a buyer purchases, the seller is refunded the original price minus the event's resale fee, and the original ticket transitions to transferred.

**Path**

1. User opens a ticket on `/tickets` and clicks "List for resale."
2. The system validates: the user owns the ticket, it is valid (not used or refunded), the event has resale enabled, no existing active listing exists, sales have not ended, and the event has not occurred.
3. A listing is created with status `listed` and enters the queue.
4. While listed, the seller can cancel the listing. Cancellation removes it from the queue. The original ticket remains theirs.
5. When a buyer purchases the ticket, the listing transitions to completed. The seller is refunded (minus the event's resale fee) and their original ticket is marked transferred.

**Failure modes**

- Validation fails at step 2: the user sees the specific reason.
- Buyer abandons mid-resale-checkout: a stale-cleanup job reverts the listing back to `listed` so it returns to the queue.

**Code anchors**

- Route: [tickets.component.ts](frontend/src/app/features/tickets/pages/tickets/tickets.component.ts)
- Backend: [resale/listings.ts](backend/convex/resale/listings.ts) (`listTicketForResale`, `cancelResaleListing`, `getMyResaleListings`)

### 4.2 Buy a resale ticket

**Who**: members of the event's community.
**Criticality**: revenue. The buyer side of resale is how sold-out events stay accessible.
**Entry points**: `/events/:id` (resale section, visible when the event is sold out and a listing is queued).
**Successful outcome**: the buyer has a ticket. The seller's original ticket is marked transferred. The seller's refund is queued.

**Path**

1. Buyer opens a sold-out event page with at least one queued listing.
2. Buyer clicks "Buy resale ticket." The system assigns the oldest queued listing that is not the buyer's own. Listing transitions to pending.
3. Stripe Embedded Checkout mounts. Buyer completes payment.
4. The new ticket is issued to the buyer. The seller's original ticket is marked transferred. The listing is marked completed. The seller's refund is processed.
5. Buyer can view the new ticket on `/tickets`.

**Failure modes**

- Buyer abandons checkout: a stale-listing cron reverts the listing to `listed` and it re-enters the queue.
- Buyer attempts to buy their own listing: blocked at assignment.
- Multiple buyers race for the same listing: the listing transitions to `pending` on assignment, which is what serializes access. The exact race semantics depend on Convex transaction isolation; verify in code if you need a strong guarantee.

**Code anchors**

- Route: [event-details.component.ts](frontend/src/app/features/tickets/pages/event-details/event-details.component.ts)
- Backend: [orders/core.ts](backend/convex/orders/core.ts) (`openResale`), [resale/listings.ts](backend/convex/resale/listings.ts)

### 4.3 Transfer a ticket to another vetted member

**Who**: ticket holders who want to give a valid ticket to another vetted member of the event's community or a trusted community.
**Criticality**: access control. A free transfer moves admission without changing inventory or payment ledger state.
**Entry points**: `/tickets`.
**Successful outcome**: the ticket leaves the sender's account, appears in the recipient's account, and the recipient receives the ticket PDF by email.

**Path**

1. Holder opens a valid ticket on `/tickets` and clicks "Transfer ticket."
2. Holder enters the recipient email.
3. The system validates that the email belongs to an existing Braket user who is directly or trust-linked vetted for the event's community.
4. The holder confirms the irreversible transfer.
5. The ticket owner changes to the recipient, the ticket is removed from the original order link, roster fields are rebuilt for the recipient, and the recipient email is sent.

**Failure modes**

- No user exists for that email, or the user is not vetted: the holder sees the same generic recipient error.
- The ticket is used, refunded, expired, or listed/pending for resale: transfer is refused.
- The holder attempts to transfer a ticket they do not own: transfer is refused.

**Code anchors**

- Route: [tickets.component.ts](frontend/src/app/features/tickets/pages/tickets/tickets.component.ts)
- Backend: [tickets/transfers.ts](backend/convex/tickets/transfers.ts) (`validateRecipient`, `transfer`)

---

## 5. Run the door at an event without slowing the line

_Attending an event: door staff._

Door staff are the people who actually let attendees in. The journey is short but unforgiving: lines back up fast and the consequences of letting in the wrong person are real.

### 5.1 Be assigned as door staff for a community

**Who**: anyone the community admin trusts to scan tickets.
**Criticality**: safety, ops. Scanner access is the only role that can mark tickets used.
**Entry points**: community admin grants the role from `/community-admin/settings`.
**Successful outcome**: the user can sign in, navigate to `/scanner`, and see only the events they are assigned to.

**Path**

1. Community admin opens the community admin Settings tab.
2. Admin enters a user's email and grants door staff access. The user's account must already exist.
3. The granted user, on next sign-in, sees the scanner entry on their dashboard. `/scanner` is now reachable.
4. Admin can revoke access from the same page.

**Failure modes**

- Email not in the system: admin sees an error explaining the user must have signed up first.
- User had access but it was revoked mid-event: their next navigation to `/scanner` redirects out.

**Code anchors**

- Route: [community-admin-settings.component.html:903](frontend/src/app/features/admin/pages/community-admin-settings/community-admin-settings.component.html:903)
- Backend: [communities/scanners.ts](backend/convex/communities/scanners.ts) (`grant`, `revoke`, `hasAnyAssignment`, `myScannerEvents`)

### 5.2 Check in attendees at the door

**Who**: door staff and admins.
**Criticality**: ops. The event runs on this. Slow check-in is bad. Wrong check-in is worse.
**Entry points**: `/scanner`.
**Successful outcome**: each valid attendee's ticket transitions from valid to used, with a check-in timestamp. The attendee is admitted.

**Path**

1. Staff opens `/scanner` and selects the active event.
2. Staff scans the attendee's QR via the browser camera, or picks the attendee out of the manual list of expected attendees if scanning isn't available.
3. The system validates the ticket: it must be valid and not already used.
4. The screen shows attendee name and tier. Staff confirms check-in. The ticket transitions to used with a timestamp and the attendee is admitted.

**Failure modes**

- Already-used ticket: clearly flagged. Staff has the option to revert (see 5.3) if it was a mistake.
- Refunded or transferred ticket: refused with explanation.
- Camera permission denied: the manual list remains available.

**Code anchors**

- Route: [check-in.component.ts](frontend/src/app/features/admin/pages/check-in/check-in.component.ts)
- Backend: [events/check_in.ts](backend/convex/events/check_in.ts) (`checkIn`)

### 5.3 Revert a mistaken check-in

**Who**: door staff and admins.
**Criticality**: ops. Mistakes happen and need a fast undo.
**Entry points**: `/scanner` activity feed, attendee detail.
**Successful outcome**: the ticket returns to valid. The check-in timestamp is cleared.

**Path**

1. Staff sees a recent check-in in the activity feed (or finds the attendee).
2. Staff clicks revert and confirms.
3. The ticket transitions back to valid. The attendee can be re-checked-in.

**Failure modes**

- Revert window expired: not currently enforced.

**Code anchors**

- Backend: [events/check_in.ts](backend/convex/events/check_in.ts) (`revertCheckIn`)

### 5.4 Review check-in activity, attendee roster, and export

**Who**: door staff and admins.
**Criticality**: ops. After-action review for accountability and operations.
**Entry points**: `/scanner`, event management page.
**Successful outcome**: the team can see live check-in throughput, search the attendee list, and export a CSV roster.

**Path**

1. During the event: staff sees a live activity feed and a summary strip with check-ins per minute and percentage admitted.
2. Staff can search the roster by name or email.
3. After the event: admins see post-mortem stats and can export a roster CSV.

**Failure modes**

- Export exceeds the row cap: the export is rejected with an `EXPORT_TOO_LARGE` error rather than truncated. The cap is set to a number large enough that this is rare in practice.

**Code anchors**

- Backend: [events/analytics.ts](backend/convex/events/analytics.ts), [events/analytics_export.ts](backend/convex/events/analytics_export.ts) (`exportEventRosterCsv`)

---

## 6. Put on an event and get paid for it

_Running an event: organizer arc._

This is the organizer's full arc, from connecting Stripe to receiving the payout. It is several distinct journeys, not one, and each has its own start and end.

### 6.1 Connect Stripe to receive payments

**Who**: community admins for non-platform organizers.
**Criticality**: revenue. Without this, the community cannot publish paid events. The platform organizer is a special case that does not need this.
**Entry points**: `/community-admin/settings`, `/admin/communities/:id/edit`.
**Successful outcome**: the community has a connected Stripe account with completed onboarding and verified payout settings.

**Path**

1. Admin opens the community editor or settings page.
2. The Stripe Connect section shows current status (none, in progress, or connected).
3. Admin clicks to begin onboarding. The page mounts Stripe's embedded Connect onboarding component (using `@stripe/connect-js`), not a redirect to a Stripe-hosted page.
4. Admin completes Stripe's identity, business, and bank-account steps inside the embedded component.
5. Stripe pings back via webhooks as fields complete. The page reflects status changes.
6. Once the account is fully onboarded with payouts capability, the community can be published and start selling.

**Failure modes**

- Stripe rejects the account or requires additional info: the embed surfaces it. Admin must come back to finish.
- Webhooks delayed: the page polls and eventually picks up the new state.

**Code anchors**

- Component: [stripe-connect-embed.component.ts](frontend/src/app/features/admin/components/stripe-connect/stripe-connect-embed.component.ts)
- Routes: [community-editor.component.html:492](frontend/src/app/features/admin/pages/communities/community-editor/community-editor.component.html:492), [community-admin-settings.component.html:464](frontend/src/app/features/admin/pages/community-admin-settings/community-admin-settings.component.html:464)
- Backend: [stripe/connect.ts](backend/convex/stripe/connect.ts), [stripe/\_impl/connect.ts](backend/convex/stripe/_impl/connect.ts)

### 6.2 Create and publish an event

**Who**: community admins (or root admin acting on behalf of a community).
**Criticality**: revenue. No event, no tickets.
**Entry points**: `/admin/events/new`, `/community-admin/events/new`.
**Successful outcome**: the event is published and visible to eligible buyers.

**Path**

1. Admin opens the event editor.
2. Admin uploads a flyer (4:5 or 1:1).
3. Admin fills in title, date, location, base price, total inventory, ticketing options (NOTAFLOF tier with min/max, supporter tier, max tickets per user, resale enabled or not, resale fee).
4. Form validates required fields and the relationship between supporter and base prices.
5. Admin optionally composes an announcement to schedule alongside publish. If provided, the system queues a marketing announcement at the chosen send time. (This is the same flow as 9.1, just initiated from the event editor.)
6. Admin publishes. The event appears on the community's public event list and on member dashboards.

**Publish gates**

Publishing an event requires the parent community to be published. Publishing the parent community has its own requirements: it must have at least one vetting question, and (for non-platform organizers) the community must have a Stripe Connect account that's ready to accept charges. So in practice, an admin trying to publish an event in a draft community will be sent back to the community settings to clear those gates first.

**Failure modes**

- Parent community is in draft: event publish is blocked.
- Image fails upload: form retains state, admin can retry.

**Code anchors**

- Route: [event-editor.component.ts](frontend/src/app/features/admin/pages/event-editor/event-editor.component.ts)
- Backend: [events/management.ts](backend/convex/events/management.ts) (`create`)

### 6.3 Edit a published event

**Who**: community admins.
**Criticality**: ops. Real events have changes (venue, time, capacity tweaks).
**Entry points**: `/admin/events/:id/edit`, `/community-admin/events/:id/edit`.
**Successful outcome**: changes persist and are reflected on user-facing pages immediately.

**Path**

1. Admin opens the event editor for an existing event.
2. Admin updates fields (location, inventory, prices, image).
3. Admin saves. Changes propagate via Convex subscriptions to all viewers in real time.

**Failure modes**

- Reducing inventory below the already-sold count: blocked at the inventory guard.
- Cancellation as part of an edit (status → cancelled) triggers open-order release and auto-cancels any scheduled marketing announcement for the event. See 6.8.

**Code anchors**

- Route: [event-editor.component.ts](frontend/src/app/features/admin/pages/event-editor/event-editor.component.ts)
- Backend: [events/management.ts](backend/convex/events/management.ts) (`update`)

### 6.4 Monitor event sales and revenue

**Who**: community admins.
**Criticality**: ops. Visibility into the live state of an event in flight.
**Entry points**: `/admin/events/:id/manage`, `/community-admin/events/:id/manage`.
**Successful outcome**: admin sees current sales status, sales-to-date, revenue with explicit fee breakdown, tier mix, sales-per-day, and the buyer list.

**Path**

1. Admin opens the event management page.
2. Status banner shows whether sales are active, paused, ended, or sold out.
3. Admin sees ticket counts (sold, total, percent), tier mix, and a sales-per-day chart in California time.
4. Revenue panel shows gross, net, Stripe fees, and platform fee, with revenue split by tier.
5. Buyer list shows name, email, quantity, amount, tier, and purchase time.
6. Admin can pause, resume, or end sales from this page. Changes are reflected immediately on user-facing pages.

**Failure modes**

- Stale data: the page subscribes to live state via Convex. If the WebSocket drops, the Convex client reconnects and the view re-renders when state catches up.

**Code anchors**

- Route: [event-management.ts](frontend/src/app/features/admin/pages/event-management/event-management.ts)
- Backend: [events/management.ts](backend/convex/events/management.ts) (`getManagementSummary`, `getManagementPurchases`, `getManagementResale`)

### 6.5 Manage the event guest list (plus-ones, comps, VIPs)

**Who**: community admins.
**Criticality**: ops. Door staff need a complete roster. Broadcasts and reminders include these guests.
**Entry points**: event management page, Guests tab.
**Successful outcome**: the guest list reflects the people the organizer plans to admit beyond ticket buyers. Each guest appears on the door roster and receives event broadcasts and reminders.

**Path**

1. Admin opens the Guests tab on the event management page.
2. Admin adds a guest with name, optional email, type, and optional notes. (This is the organizer adding a person, not a ticket holder bringing a +1; the platform does not currently expose a self-service plus-one feature.)
3. Admin can remove guests at any time.
4. Door staff see guests alongside ticket holders in the check-in roster (see 5.2 / 5.4). Broadcasts and reminders include them when the guest has an email.

**Failure modes**

- Name, email, or notes exceed length caps: rejected with a validation error.
- Guest with no email: still on the door roster, but not addressable for broadcasts or reminders.

**Code anchors**

- Component: [event-management-guests-tab.component.ts](frontend/src/app/features/admin/pages/event-management/components/event-management-guests-tab/event-management-guests-tab.component.ts)
- Backend: [events/guests.ts](backend/convex/events/guests.ts) (`add`, `remove`, `listByEvent`)

### 6.6 Send a broadcast to ticket holders

**Who**: community admins.
**Criticality**: ops, safety. Last-mile communication to people who hold tickets (venue change, weather, schedule). Often time-sensitive.
**Entry points**: event management page, Broadcast tab.
**Successful outcome**: every current ticket holder, including named guests and guest-checkout buyers, receives one copy of the email.

**Path**

1. Admin opens the broadcast tab on the event management page.
2. Page shows the audience preview count.
3. Admin enters subject and message.
4. Admin sends. Each recipient gets exactly one copy regardless of how many tickets they hold.
5. History tab shows past broadcasts with recipient counts and timestamps.

**Failure modes**

- No active ticket holders: send is blocked.
- Per-recipient bounces are recorded for observability. Send-time suppression is handled by the email provider; see 9.3.

**Code anchors**

- Backend: [events/broadcasts.ts](backend/convex/events/broadcasts.ts) (`getAudience`, `send`, `listHistory`)
- Email: `eventBroadcastTemplate` in [email/templates.ts](backend/convex/email/templates.ts)

### 6.7 Send a pre-event reminder to ticket holders

**Who**: community admins.
**Criticality**: ops. Reduces no-shows and surfaces last-minute logistics.
**Entry points**: event management page, ticket reminder tab.
**Successful outcome**: ticket holders receive a reminder email tied to the event details (when, where, anything organizers chose to add).

**Path**

1. Admin opens the ticket reminder tab.
2. Audience preview shows current ticket holders.
3. Admin sends. Recipients receive a reminder email distinct from a broadcast.

**Failure modes**

- Sent too late to matter: not enforced.

**Code anchors**

- Component: [ticket-reminder-tab](frontend/src/app/features/admin/components/ticket-reminder-tab/)
- Backend: [events/reminders.ts](backend/convex/events/reminders.ts) (`getTicketReminderAudience`, `sendTicketPurchaseReminder`)

### 6.8 Cancel an event

**Who**: community admins.
**Criticality**: ops, safety. Cancellation is a stressful path; clarity matters more than feature breadth.
**Entry points**: event management page.
**Successful outcome**: the event status is `cancelled`, it is hidden from public listings, no new purchases are accepted, and existing ticket holders are notified.

**Path**

1. Admin sets the event's status to cancelled. (Cancellation is a status transition through the standard event update path, not a separate mutation.)
2. The event is removed from public lists. New purchases are blocked.
3. Open ticket orders (people mid-checkout) are released. They will not be charged. The released-order state surfaces to the buyer at the next page check, but no automated cancellation email is sent today.
4. Any scheduled marketing announcement for this event is auto-cancelled.
5. Existing ticket holders keep their tickets until refunds are processed. They are not automatically emailed about the cancellation; the admin uses the broadcast feature (6.6) to notify them, then follows the [Event Change Refunds](runbooks/event-change-refunds.md) runbook to process cancellation refunds.
6. If a payment completes after cancellation (delayed Stripe webhook), the buyer is refunded automatically through the late-payment path.

**Failure modes**

- Cancellation race with in-progress payments: the late-payment refund handles this. No silent charge for a cancelled event.
- Admin forgets to broadcast: ticket holders don't hear about the cancellation until they check `/tickets` or notice the event is gone. This is a real product gap; consider it part of the playbook for any cancellation.

**Code anchors**

- Route: [event-management.ts](frontend/src/app/features/admin/pages/event-management/event-management.ts)

### 6.9 Refund a purchase

**Who**: community admins.
**Criticality**: revenue, safety. Refund correctness affects financial records and trust.
**Entry points**: event management page, user management surface.
**Successful outcome**: the customer's money is returned according to the applicable refund policy, affected tickets are cancelled, and inventory is freed.

**Path**

1. Admin locates the purchase.
2. Admin chooses the refund type:
   - **Standard**: refunds only unused tickets, preserves used ones.
   - **Force**: refunds all remaining balance regardless of used tickets.
   - **Single ticket**: refunds one ticket from a multi-ticket order.
3. The system validates that the payment is refundable and there is balance to refund.
4. Stripe processes the refund. Refunded tickets are cancelled. Inventory is updated.
5. The customer is emailed confirmation.

**Failure modes**

- External refund (admin clicked refund in Stripe dashboard instead): backend reconciles via webhooks.
- Chargeback: tracked through dispute path, not the refund path.

**Code anchors**

- Backend: [payments/refunds.ts](backend/convex/payments/refunds.ts) (`refund`, `forceRefundAll`, `refundTicket`)

### 6.10 Receive scheduled payouts

**Who**: connected organizers (one per community, except the platform organizer).
**Criticality**: revenue. This is the moment money actually leaves the platform and lands in the organizer's bank account.
**Entry points**: scheduled cron, Stripe webhook on payout events.
**Successful outcome**: the organizer receives a payout for each eligible event. They get an email when the payout is sent.

**Path**

1. A daily cron runs `processScheduledPayouts`. It identifies events that have ended and have not yet been paid out.
2. For each eligible event, a payout intent is created and submitted to Stripe.
3. Stripe processes the transfer. Webhooks confirm or fail.
4. On success, the event is marked paid out and an email is sent to the organizer.

**Failure modes**

- Stripe Connect onboarding enforces manual payout schedule before marking an account verified (`ensureManualPayoutSettings` in [stripe/\_impl/actions.ts](backend/convex/stripe/_impl/actions.ts)). If verification failed, onboarding throws `STRIPE_PAYOUT_SETTINGS_NOT_VERIFIED` and the account isn't usable for selling. Drift after verification (e.g. manual changes in the Stripe dashboard) would degrade the cron's behavior; per-account errors are caught and logged rather than failing the whole batch.
- Insufficient available balance (unsettled charges): the payout for that event is deferred until balance is available.

**Code anchors**

- Cron: [crons.ts](backend/convex/crons.ts)
- Backend: [stripe/actions.ts](backend/convex/stripe/actions.ts) (`processScheduledPayouts`), [stripe/\_impl/connect.ts](backend/convex/stripe/_impl/connect.ts)
- Email: `payoutSentTemplate` in [email/templates.ts](backend/convex/email/templates.ts)

---

## 7. Keep a community alive and well-run

_Running a community: admin arc._

A community is an ongoing thing, not a setup task. Members come and go, applications stack up, settings drift. This is the community admin's day-to-day.

### 7.1 Accept an admin invite

**Who**: someone invited to admin a community.
**Criticality**: ops. The first hour of a new admin's experience.
**Entry points**: emailed admin invite link, `/admin-invite/:token`.
**Successful outcome**: the invitee has community admin access for the named community and lands in `/community-admin`.

**Path**

1. Invitee clicks the link in their email. (For a first-admin invite, the community itself was already created upfront in the same mutation that issued the invite. See 8.1. The redemption only grants the role.)
2. If the invitee is not signed in, they are routed to login or signup with the invite preserved as a return URL.
3. The invitee's signed-in email must match the email the invite was issued to. If it doesn't, redemption is rejected.
4. After authentication and email match, the redemption mutation grants the community admin role. The invitee lands in the community admin area, scoped to that community.

**Failure modes**

- Invite already redeemed or expired: clear error.
- Invitee creates an account with a different email: the invite cannot be redeemed; the original email is required.

**Code anchors**

- Route: [invite-redeem.component.ts](frontend/src/app/features/invite-redeem/invite-redeem.component.ts)
- Email: `adminInviteTemplate` in [email/templates.ts](backend/convex/email/templates.ts)

### 7.2 Configure community profile and vetting questions

**Who**: community admins (and root admin).
**Criticality**: safety. Vetting questions and the code of conduct are the inputs to who joins. Description and contact info are the public face of the community.
**Entry points**: `/community-admin/settings`, `/admin/communities/:id/edit`.
**Successful outcome**: the community's public profile and vetting form match what the admin intends.

**Path**

1. Admin opens the settings or community editor.
2. Admin updates name, slug, description, contact info, website, code of conduct, public visibility, and vetting questions.
3. Vetting questions support text, long_text, boolean, select, and checkbox types.
4. Save persists changes. Public surfaces update via subscriptions.

**Failure modes**

- Slug conflict with another community: blocked, admin sees suggestion.
- Removing a vetting question used in pending applications: not blocked, but those answers stay associated with their original question text.

**Code anchors**

- Route: [community-admin-settings.component.ts](frontend/src/app/features/admin/pages/community-admin-settings/community-admin-settings.component.ts), [community-editor.component.ts](frontend/src/app/features/admin/pages/communities/community-editor/community-editor.component.ts)
- Backend: [communities/profile.ts](backend/convex/communities/profile.ts) (`getAdmin`, `update`)

### 7.3 Review pending applications

**Who**: community admins (and root admin).
**Criticality**: safety. Admins decide who gets in. Slow review degrades the user experience; sloppy review degrades community safety.
**Entry points**: `/community-admin/pending`, applicant detail.
**Successful outcome**: each application is reviewed and either approved or rejected. The applicant is notified.

**Path**

1. Admin opens the Pending tab. Applications are listed with applicant name, social handles, and the personal statement.
2. Admin opens an applicant and sees the full application.
3. Admin approves or rejects. Both produce email to the applicant. Approval creates the community access record. Rejection records the decision.
4. Admins can also revoke an approved application later (see 7.5).

**Failure modes**

- Multiple admins reviewing the same application: last write wins. The UI reflects state changes.

**Code anchors**

- Route: [community-admin.component.ts](frontend/src/app/features/admin/pages/community-admin/community-admin.component.ts)
- Backend: [communities/applications.ts](backend/convex/communities/applications.ts) (`list`, `review`, `revoke`)
- Email: `applicationApprovedTemplate`, `applicationRejectedTemplate`, sent through [lib/applications/notifications.ts](backend/convex/lib/applications/notifications.ts)

### 7.4 Receive daily vetting digest emails

**Who**: community admins who opt in.
**Criticality**: ops. Pull-to-push for application review. Without this, admins have to remember to log in.
**Entry points**: notification preferences, hourly cron.
**Successful outcome**: each opted-in admin receives a digest email at their chosen hour summarizing pending applications.

**Path**

1. Admin sets a digest hour in their notification preferences.
2. Hourly cron runs and matches admins whose preferred hour is the current hour.
3. Each matched admin receives a digest email with pending application counts and links.
4. Admin clicks through to review.

**Failure modes**

- Empty digest: skipped (no email sent if there are no pending applications for that admin's communities).
- Time-zone confusion: hour is UTC. The settings UI clarifies.

**Code anchors**

- Cron: [crons.ts](backend/convex/crons.ts)
- Backend: [marketing/digests.ts](backend/convex/marketing/digests.ts), [communities/management/notification_preferences.ts](backend/convex/communities/management/notification_preferences.ts)
- Email: `vettingDigestTemplate` in [email/templates.ts](backend/convex/email/templates.ts)

### 7.5 Manage members (view, search, revoke)

**Who**: community admins.
**Criticality**: safety. Removing access is part of how a community responds to incidents.
**Entry points**: `/community-admin/members`.
**Successful outcome**: the admin can see who has access and revoke any member. Revocation is recorded in the audit log.

**Path**

1. Admin opens the Members tab.
2. Admin searches by name or email and reviews member details.
3. Admin revokes access. The member loses purchase eligibility for that community immediately.
4. Audit log records the revocation with attribution.

**Failure modes**

- Member has an open order in flight when revoked: subsequent access checks will refuse, but the order's exact disposition (released, allowed to settle, etc.) is not specially handled by the revoke mutation. Verify in code if you need a strong claim.

**Code anchors**

- Route: [community-admin.component.ts](frontend/src/app/features/admin/pages/community-admin/community-admin.component.ts)
- Backend: [users/profile.ts](backend/convex/users/profile.ts) (`revokeMembership`), [communities/applications.ts](backend/convex/communities/applications.ts) (`revoke`)

### 7.6 Manage door staff for a community

**Who**: community admins.
**Criticality**: safety, ops. Door staff have the only role that can mark tickets used.
**Entry points**: `/community-admin/settings`.
**Successful outcome**: the desired set of users have door staff access for the community's events.

**Path**

1. Admin opens settings, scrolls to Door staff.
2. Admin adds a user by email, or removes an existing one.
3. The granted user gets immediate access on their next sign-in. Revocation takes effect on next navigation.

**Failure modes**

- Target email is not a registered account: admin sees an error.

**Code anchors**

- Route: [community-admin-settings.component.html:903](frontend/src/app/features/admin/pages/community-admin-settings/community-admin-settings.component.html:903)
- Backend: [communities/scanners.ts](backend/convex/communities/scanners.ts)

### 7.7 Manage trust links to other communities

**Who**: community admins (and root admin for cross-community setup).
**Criticality**: safety. Trust links extend a community's vetting decisions to another community. Misuse is the same kind of risk as approving applications.
**Entry points**: community admin trust-link management surface.
**Successful outcome**: the desired trust relationships exist, and approved members of trusted communities can buy tickets to events in the trusting community.

**Path**

1. Admin opens trust-link management.
2. Admin establishes a new trust: "this community" trusts "that community's approved members."
3. The system blocks self-trust and duplicate trust relationships, and enforces a per-community cap on total trust links.
4. Admin can remove a trust at any time. Removal is permanent; affected members of the trusted community lose visibility on the trusting community's events from that point forward.
5. If announcements were scheduled for an audience that includes the trusted community, removing trust shrinks the audience.

**Failure modes**

- Race with an in-progress purchase: the order is gated by access at purchase time, not at page load.

**Code anchors**

- Backend: [communities/trust_links.ts](backend/convex/communities/trust_links.ts)

### 7.8 Review the audit log

**Who**: community admins.
**Criticality**: safety, ops. Forensics for incidents, accountability for admin actions.
**Entry points**: `/community-admin/audit-log`.
**Successful outcome**: admin can read who did what, when, scoped to their community.

**Path**

1. Admin opens the Audit log tab.
2. Recent admin actions are listed (member revocations, application reviews, scanner grants/revokes, broadcasts, etc.).
3. Admin can filter and search.

**Failure modes**

- Logs older than retention are pruned by cron. Surface a clear "older than X" boundary.

**Code anchors**

- Route: [community-admin.component.ts](frontend/src/app/features/admin/pages/community-admin/community-admin.component.ts)
- Backend: [communities/management/audit.ts](backend/convex/communities/management/audit.ts) (`listAuditLogs`)

### 7.9 Manage invite links

**Who**: community admins.
**Criticality**: safety, revenue. Invite links bypass vetting; loose ones leak access. Tight ones onboard trusted people fast.
**Entry points**: `/community-admin/magic-links`.
**Successful outcome**: the admin has the set of active invite links they intend, with appropriate label, expiration, and max redemptions.

**Path**

1. Admin opens the Invite Links tab.
2. Admin creates a link with optional label, expiration, and max redemption count.
3. Admin shares the link out of band.
4. Admin can pause, disable, or delete the link from the same page.
5. Past redemptions and link history are visible.

**Failure modes**

- Link distributed beyond intended recipients: admin can pause or disable. Already-redeemed members keep their access until manually revoked.

**Code anchors**

- Backend: [communities/invite_links.ts](backend/convex/communities/invite_links.ts) (`create`, `updateStatus`, `listMyLinks`, `listPastMyLinks`)

---

## 8. Bootstrap a new community on the platform

_Root and platform admin work._

Root admins set up new communities and resolve cross-community concerns. Most product work does not happen here, but the platform cannot start a new tenant without it.

### 8.1 Create a community (and optionally invite its first admin)

**Who**: root admin only.
**Criticality**: ops. Tenant onboarding.
**Entry points**: `/admin/communities/new`, "Invite Admin" dialog.
**Successful outcome**: a community exists, with at least one admin assigned.

**Path**

1. Direct creation: root admin fills the form (name, slug, description, vetting questions, status), saves.
2. Invite flow: root admin enters invitee email and community name in the Invite Admin dialog; the system creates the community and sends an admin invite atomically.
3. After the invitee redeems (see 7.1), they become the first community admin.
4. Root admin can later invite additional admins.

**Failure modes**

- Slug conflict: blocked at save.
- Newly created community is in draft. The admin can't publish it until the gates in 6.1 (Stripe Connect onboarding for non-platform organizers) and 7.2 (at least one vetting question) are cleared. This isn't a creation-time failure; it's the next thing that will block them.

**Code anchors**

- Route: [community-editor.component.ts](frontend/src/app/features/admin/pages/communities/community-editor/community-editor.component.ts)
- Backend: [communities/profile.ts](backend/convex/communities/profile.ts), [communities/admins.ts](backend/convex/communities/admins.ts)

### 8.2 Send a vetting reminder to users who haven't applied anywhere

**Who**: platform admin only.
**Criticality**: ops. Conversion nudge for users who registered but never applied to a community.
**Entry points**: admin reminders page.
**Successful outcome**: users who have an account but no application receive a reminder email prompting them to apply.

**Path**

1. Platform admin opens the reminders page and views the audience preview (count of registered users with zero applications).
2. Admin enters subject and message and sends.
3. Recipients receive the reminder. Each is opted into the platform marketing organizer (or already opted out, in which case they are skipped).

**Failure modes**

- Audience is empty: no email is sent.
- Recipient has globally opted out of marketing: skipped.

**Code anchors**

- Frontend: [components/reminders](frontend/src/app/features/admin/components/reminders/)
- Backend: [communities/management/reminders.ts](backend/convex/communities/management/reminders.ts) (`getVettingReminderAudience`, `sendVettingReminder`)
- Email: `vettingReminderTemplate` in [email/templates.ts](backend/convex/email/templates.ts)

---

## 9. Reach the right people without hurting deliverability

_Marketing reach._

Email is the primary channel out to people who hold tickets, applied for vetting, or signed up for community events. The platform sends across a shared sender domain, which means deliverability is collective: a recipient who unsubscribes and keeps receiving mail damages the inbox reputation every organizer relies on. Opt-outs have to work the first time.

### 9.1 Schedule a cross-event marketing announcement

**Who**: community admins.
**Criticality**: revenue. Announcements drive sales for upcoming events to people who already opted in.
**Entry points**: marketing announcement card on community admin pages.
**Successful outcome**: the announcement is queued. Recipients who opted in receive it at the scheduled time.

**Path**

1. Admin opens the announcement composer.
2. Admin sets subject, body, and a send time.
3. The composer shows an audience preview computed from direct opt-ins plus opt-ins from trust-linked communities, excluding global and per-organizer opt-outs.
4. Admin schedules.
5. At the scheduled time, the announcement sends in batches.
6. Admin can cancel a scheduled announcement before it sends.

**Failure modes**

- Audience exceeds the platform cap (currently 500 recipients): the composer flags the audience as capped and the schedule action is disabled. Admin must narrow the audience before scheduling.
- Admin removes a trust link before send: audience shrinks.
- Bounces are recorded but do not block the send. See 9.3.

**Code anchors**

- Component: [marketing-announcement-card](frontend/src/app/features/admin/components/marketing-announcement-card/)
- Backend: [marketing/emails.ts](backend/convex/marketing/emails.ts) (`scheduleAnnouncement`, `cancelAnnouncement`, `sendAnnouncement`)
- Email: `eventAnnouncementTemplate` in [email/templates.ts](backend/convex/email/templates.ts)

### 9.2 Track marketing email engagement

**Who**: community admins (consumers); recipients (subjects, transparently).
**Criticality**: ops. Engagement signal informs send strategy.
**Entry points**: tracking pixel and click-redirect URLs embedded in marketing emails.
**Successful outcome**: open and click events are recorded for each delivery; admins can see engagement metrics.

**Path**

1. Recipient opens an email. The 1x1 image at `/api/marketing/open` is fetched.
2. Recipient clicks a link. The redirect at `/api/marketing/click` records the click and forwards them.
3. Backend updates the delivery record. Admins see counts.

**Failure modes**

- Mail clients block images: opens undercount; clicks remain accurate.
- Privacy-respecting clients strip tracking: same.

**Code anchors**

- HTTP: [/api/marketing/open](backend/convex/http.ts), [/api/marketing/click](backend/convex/http.ts)

### 9.3 Record email bounces and complaints

**Who**: nobody clicks through this; it runs in the background.
**Criticality**: ops. Bounce and complaint observability protects deliverability.
**Entry points**: Resend webhook at `/resend-webhook`.
**Successful outcome**: bounce, failed, and complaint events from the email provider are persisted as `emailDeliveryFailures` rows tied to the original delivery, where they can be inspected.

**Path**

1. The email provider posts an event to `/resend-webhook`.
2. For terminal failures (`email.bounced`, `email.failed`, `email.complained`), the platform writes a failure record linked to the original delivery and recipient.
3. For repeated transient failures from the provider as a whole, an internal circuit breaker opens to back off sends platform-wide.

**Failure modes**

- Webhook delivery failure: the provider retries.
- Failure records are written for observability and recipient-level analysis only. Automated send-time suppression is delegated to the email provider's own list management; the platform does not consult `emailDeliveryFailures` before sending.

**Code anchors**

- HTTP: [/resend-webhook](backend/convex/http.ts)
- Backend: [email/email_delivery.ts](backend/convex/email/email_delivery.ts), [email/resend.ts](backend/convex/email/resend.ts)

---

## 10. Find events and communities without an account

_Discovery and public surfaces._

Not every visitor is logged in. Some are deciding whether to apply; some are just looking; some are integrators consuming the public API. The discovery surfaces have to work without an account and without leaking operational data.

### 10.1 Browse the public community directory

**Who**: anyone, no login required.
**Criticality**: revenue. Discovery onramp.
**Entry points**: `/communities`, `/c/:slug` (redirects to events filtered by community).
**Successful outcome**: visitor sees the list of communities that opted into public listing, with name, description, logo, and upcoming public events.

**Path**

1. Visitor opens `/communities`.
2. The directory shows public communities.
3. Visitor opens a community to see its upcoming public events and basic profile.

**Failure modes**

- Community is set non-public: it is omitted from the directory but reachable by direct slug.

**Code anchors**

- Route: [community-directory.component.ts](frontend/src/app/features/communities/pages/community-directory/community-directory.component.ts)
- Backend: [communities/directory.ts](backend/convex/communities/directory.ts)

### 10.2 Browse public events without an account

**Who**: anyone, no login required.
**Criticality**: revenue. Public events are a primary acquisition path.
**Entry points**: `/events`, `/events/:id`.
**Successful outcome**: visitor sees event details and (for public events) can purchase as a guest.

**Path**

1. Visitor opens `/events` or a specific event page.
2. Public events show full details, the event poster, ticket tiers, and a buy button.
3. Non-public events redirect or hide depending on access.

**Failure modes**

- Event was just made non-public or cancelled: page reflects updated state.

**Code anchors**

- Routes: [community-events.component.ts](frontend/src/app/features/tickets/pages/community-events/community-events.component.ts), [event-details.component.ts](frontend/src/app/features/tickets/pages/event-details/event-details.component.ts)
- Backend: [events/public.ts](backend/convex/events/public.ts) (`list`, `upcoming`, `get`, `getAvailability`)

### 10.3 Public REST API for third-party integrators

**Who**: external developers embedding event or community data on other sites.
**Criticality**: ops. Few consumers but they depend on stable behavior.
**Entry points**: `/api/events/upcoming`, `/api/communities`, `/api/communities/{slug}`.
**Successful outcome**: a JSON response with the expected shape, served with CORS allowed origins respected and rate limits enforced.

**Path**

1. Integrator's server or browser makes a GET request.
2. CORS preflight (OPTIONS) returns the allowed origins.
3. GET returns event or community data.
4. Integrator handles rate limiting (HTTP 429 on overuse).

**Failure modes**

- Origin not allowed: CORS rejects.
- Rate limit exceeded: 429 with retry headers.

**Code anchors**

- HTTP: [http.ts](backend/convex/http.ts)
- Backend: [http/\_impl/events.ts](backend/convex/http/_impl/events.ts), [http/\_impl/communities.ts](backend/convex/http/_impl/communities.ts)

---

## What's not in here, on purpose

Some things you might expect to find but won't:

- **The authorization model.** Who can do what is in code: [`backend/convex/lib/access.ts`](backend/convex/lib/access.ts) and [`backend/convex/lib/authz.ts`](backend/convex/lib/authz.ts). The CUJs assume access checks pass; they do not document the access matrix.
- **Background cleanup crons** (stale resale listings, expired guest sessions, old audit logs, stale webhook claims, orphaned uploads). These keep the system healthy but are not user journeys. They live in [`backend/convex/crons.ts`](backend/convex/crons.ts).
- **Implementation details** (table names, indexes, validator shapes, internal field names). These rot and don't help readers of this doc. The code is the source of truth.
- **Pure infrastructure flows** (webhook claim reaper, internal queues, dedup keys). They have no user perspective and no end-to-end assertion to make.

If you think one of these belongs here, it has to clear the bar in _Reading an entry_ above: a user perspective, a verifiable outcome, real cost if it breaks, and enough surface area that unit tests alone can't catch a regression.
