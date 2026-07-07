---
title: Privacy Requests
category: Runbooks
order: 12
description: Planned operations runbook — privacy access, correction, and deletion requests
access: public
---

# Privacy Request Operations

This runbook is for the Braket operator handling access, correction, deletion,
and California-style privacy requests sent to `contact@braket.gay`. It assumes
access to Convex Dashboard, Stripe Dashboard, Sentry, Resend, and the
private support inbox.

This is an operations checklist, not legal advice. Use it to preserve evidence,
verify the requester, collect the right data, minimize safely, and record what
could not be deleted because of payment, security, legal, provider, or backup
retention.

Source of truth:

- [`privacy-policy.html`](../../frontend/src/app/features/legal/pages/privacy-policy/privacy-policy.html)
- [`schema.ts`](../../backend/convex/schema.ts)
- [`email-delivery.md`](./email-delivery.md)
- [`payments.md`](./payments.md)
- [`convex-backend.md`](./convex-backend.md)

Provider references:

- [California DOJ CCPA page](https://www.oag.ca.gov/privacy/ccpa)
- [Sentry JavaScript data collected docs](https://docs.sentry.io/platforms/javascript/guides/react/data-management/data-collected/)
- [Sentry replay deletion docs](https://docs.sentry.io/product/explore/session-replay/replay-page-and-filters/)
- [Stripe deletion request docs](https://docs.stripe.com/privacy/deletion-requests)
- [Stripe redaction docs](https://docs.stripe.com/privacy/redaction)
- [Resend privacy policy](https://resend.com/legal/privacy-policy)
- [Resend email retention note](https://resend.com/docs/dashboard/webhooks/how-to-store-webhooks-data)

## Triage The Request

Start every request with a private request record. Do not put sensitive request
contents in Linear, public GitHub issues, or broad chat channels.

Record these fields:

| Field                  | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| Request ID             | `PRIV-YYYYMMDD-N`                                           |
| Received at            | Timestamp and inbox                                         |
| Requester email        | Address that sent the request                               |
| Request type           | access, correction, deletion, opt-out, limitation, or mixed |
| Account match          | Convex `users._id`, `guest_sessions._id`, or no match       |
| Verification status    | pending, verified, rejected, or needs legal review          |
| Due date               | 45 calendar days from receipt for California-style requests |
| Owner                  | Operator handling the request                               |
| Final response sent at | Timestamp                                                   |

Use only the information needed to verify and fulfill the request. The
California DOJ notes that verification data should be used only for that
purpose, and California-style requests generally need a response within 45
calendar days.

## Verify The Requester

Use the least invasive verification path that matches the request.

| Requester type           | Verification path                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Signed-in account holder | Ask the requester to email from the account email, or sign in and make the request from the same address.  |
| Guest ticket holder      | Match the email plus at least one order, event, ticket, or Stripe receipt detail already held by Braket.   |
| Organizer or admin       | Match the account email and confirm the organizer relationship before disclosing organizer or payout data. |
| Authorized agent         | Require proof of authorization and verify the account holder directly when possible.                       |
| No matching data         | Respond that no matching Braket account or guest record was found after reasonable search.                 |

Do not ask for a government ID unless legal counsel approves that step. Braket
usually has enough information to verify with account email, order details,
ticket details, and organizer/admin relationship.

Do not disclose community membership, vetting answers, guest-list records,
private-event attendance, payment records, or organizer data before
verification succeeds.

## Preserve Current State

Before deleting or minimizing anything, preserve enough state to prove what was
done. This protects refunds, chargebacks, safety investigations, and operator
accountability.

For a high-risk request, export production first:

```bash
pnpm convex export --prod --include-file-storage --path /tmp/convex-prod-before-PRIV-YYYYMMDD-N.zip
```

Store the export in a private operator location. Do not attach raw exports to
Linear or send them to the requester.

If the request only asks for correction or access, a full production export is
usually unnecessary. Capture the specific table names, document IDs, provider
IDs, and search terms used instead.

## Locate Braket Data

Search by the verified identifiers. Prefer indexed lookups in Convex Dashboard
or a reviewed internal query. Do not run ad hoc destructive mutations in
production.

| Identifier             | Where to search                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account email          | `users.email`, Better Auth component user table, `guest_sessions.email`, `emailAddressMarketingPreferences.email`, `resale_notifications.email`, `admin_invites.email`, `emailDeliveries.recipient`, `emailDeliveryFailures.recipient`, `eventBroadcastDeliveries.email`                                                                                                                          |
| Convex user ID         | `applications.userId`, `tickets.userId`, `ticket_orders.userId`, `resale_listings.sellerId`, `resale_listings.buyerId`, `resale_notifications.userId`, `marketingEmailPreferences.userId`, `marketingUnsubscribeTokens.userId`, `marketingEmailDeliveries.userId`, `magic_link_redemption_log.userId`, `adminAuditLogs.adminId`, `adminAuditLogs.targetUserId`, `confirmedUploads.uploaderUserId` |
| Guest session ID       | `guest_sessions._id`, `tickets.guestSessionId`, `ticket_orders.guestSessionId`, `magic_link_redemption_log.guestSessionId`                                                                                                                                                                                                                                                                        |
| Stripe identifiers     | `ticket_orders.stripeCheckoutSessionId`, `ticket_orders.stripePaymentIntentId`, `ticket_orders.stripeChargeId`, `order_financial_events.*`, `stripe_webhook_events.stripeEventId`, `organizers.stripeConnectedAccountId`, `payout_batches.stripePayoutId`, `payout_allocations.stripePayoutId`                                                                                                    |
| Organizer relationship | `organizers.email`, `organizers.stripeConnectedAccountId`, `adminAuditLogs.organizerId`, organizer-scoped authz roles, events, applications, broadcasts, reminders, and payout records                                                                                                                                                                                                            |

Current repo limitation: there is no production one-click data subject export or
deletion mutation. If a request requires broad Convex changes, create a
reviewed repair/export function or script, test it against a non-production
copy, and record the exact tables it touches.

## Prepare An Access Export

An access export should be understandable and scoped to the verified requester.
Do not send raw Convex table exports.

Include applicable records:

- Account profile: name, email, image URL, email verification, terms acceptance,
  and marketing opt-out state.
- Community and vetting: applications, statuses, answers, review outcomes,
  memberships, and organizer-specific marketing preferences.
- Tickets and orders: tickets, ticket status, check-in time, order amount,
  refund/dispute status, resale listing state, and relevant event details.
- Guest checkout: guest sessions, guest-owned tickets, guest orders, and magic
  link redemption records tied to the verified email.
- Communications: support request thread, Sentry Feedback text if retained,
  email preference records, announcement delivery records, and unsubscribe
  state.
- Organizer data: organizer profile, Stripe connected-account status stored by
  Braket, payout readiness fields, admin actions, and public event content.

Exclude or minimize:

- Raw bearer tokens, token digests, password or session internals, API keys, QR
  payloads, and ticket PDF internals.
- Other users' personal information in guest lists, rosters, applications,
  audit logs, email audiences, and community admin workflows.
- Internal fraud, security, rate-limit, and abuse signals if disclosure would
  compromise the Service.
- Provider-only records that Braket cannot export directly. Summarize the
  provider and give the requester the provider's privacy contact when needed.

## Handle Correction Requests

Use normal product paths first:

1. Ask the user to update editable account fields from account settings when
   practical.
2. Use existing admin workflows for organizer profile corrections.
3. Correct obvious stale email preference or opt-out state through the existing
   marketing preference flows.
4. Do not rewrite immutable payment, refund, dispute, webhook, or payout ledger
   records. Add a corrective note through a reviewed repair path if the current
   record is misleading.
5. Do not edit historical admin audit logs except under legal review.

## Handle Deletion Or Minimization

Deletion usually means minimization, not a full purge. Keep records that are
still needed for refunds, chargebacks, fraud prevention, safety, tax,
accounting, legal claims, security, or platform integrity.

Use this table to decide the action:

| Data area                                                           | Default action                                                                                                                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users` profile                                                     | Remove or replace directly identifying fields when the account is no longer needed. Preserve only fields needed for legal, security, opt-out, or audit reasons.        |
| Better Auth user/session data                                       | Disable or delete through a reviewed auth-specific path. Keep enough linkage to prevent account takeover and duplicate-account abuse.                                  |
| `applications` and vetting answers                                  | Delete or minimize where no safety, organizer, dispute, or audit need remains. Otherwise retain with access restricted.                                                |
| Community membership and authz roles                                | Revoke future access when deletion is requested. Preserve minimal historical audit where needed.                                                                       |
| `tickets`, `ticket_orders`, and `order_financial_events`            | Retain for transaction, refund, chargeback, admission, and accounting records. Minimize roster names/emails where possible after the event and risk periods end.       |
| `stripe_webhook_events`, `payout_batches`, and `payout_allocations` | Retain unless legal counsel approves a narrower repair. These are financial and webhook audit records.                                                                 |
| `resale_listings`                                                   | Retain completed resale settlement records. Cancel active listings when the user requests deletion and no legal hold applies.                                          |
| `guest_sessions`                                                    | Delete expired sessions where no transaction, ticket, magic-link, or security need remains. Minimize active sessions only after preserving ticket access expectations. |
| Marketing preferences                                               | Set opt-out before deleting anything. Keep suppression state needed to honor future unsubscribe requests.                                                              |
| Email delivery rows                                                 | Minimize app-owned delivery rows after operational need expires. Provider records follow Resend retention and support workflows.                                       |
| `adminAuditLogs`                                                    | Retain by default. They protect event, payment, access, and admin accountability.                                                                                      |
| File storage                                                        | Delete user-uploaded profile/community/event media only when no published event, organizer, audit, or legal need remains.                                              |
| Backups                                                             | Do not edit historical backups in place. Record that deleted or minimized data may remain until backup retention expires.                                              |

Never delete financial ledgers, webhook rows, audit rows, or provider IDs just
to make a data request look cleaner. If the record must stay, minimize direct
identifiers and document the retention reason.

## Handle Provider Data

### Stripe

Collect relevant Stripe IDs from Convex before opening Stripe Dashboard:

- Checkout Session, PaymentIntent, Charge, Refund, Dispute, and Event IDs.
- Connected account IDs from `organizers.stripeConnectedAccountId`.
- Payout IDs from payout tables when the requester is an organizer.

For buyer payment data, Stripe recommends redaction jobs for consumer deletion
requests when objects are eligible. Stripe may require open objects to be
finalized, disputes to close, or risk periods to pass before redaction. Stripe
may also retain data for legal, anti-money laundering, fraud, tax, accounting,
and regulatory reasons.

For organizer/merchant data, Stripe Connect may hold business, identity, tax,
bank, verification, payout, and compliance information. Braket can update or
disconnect Braket-side references where appropriate, but Stripe may retain
connected-account records under Stripe's own obligations.

Record the Stripe action taken:

- no Stripe data found
- redaction job created
- object not eligible yet, with reason
- requester directed to `privacy@stripe.com`
- organizer connected account closure or support flow started

### Sentry

Braket does not set a Sentry user ID or email in the frontend SDK, and
`sendDefaultPii` is disabled. Sentry events can still contain route, URL,
breadcrumb, device, browser, stack trace, performance, or replay context.

Search Sentry by:

- request timeframe
- route or URL
- release/environment
- error message reported by the requester
- submitted Sentry Feedback items in the same request window

If an issue or replay contains personal information, delete the issue or replay
where Sentry allows it. Sentry replay deletion can leave inaccessible metadata
until the organization's retention policy removes it. Record any support ticket
needed for metadata or bulk deletion.

Do not disable essential Sentry monitoring to fulfill DNT/GPC. The Privacy
Policy treats Sentry as error, security, and reliability monitoring.

### Resend And Email Providers

Production transactional email uses Resend when configured. Local and staging
preview mail can use Ethereal SMTP. Critical production fallback mail may use
SMTP fallback if Resend has a pre-acceptance transient failure.

Search app-owned email records by recipient:

- `emailDeliveries`
- `emailDeliveryFailures`
- `emailDedup`
- `eventBroadcasts`
- `eventBroadcastDeliveries` (durable per-recipient broadcast ledger; no TTL cleanup)
- `ticketReminderSends`
- marketing preference and delivery tables

Search Resend Dashboard by recipient and message ID where provider-side proof is
needed. Resend documents 30-day email data retention across plans, with flexible
retention for Enterprise. Resend also accepts privacy requests through its
support channel under its privacy policy.

For deletion:

1. Honor future email suppression in Braket first.
2. Minimize app-owned records when no delivery, abuse, support, or legal reason
   remains.
3. Ask Resend support for provider-side removal if the request requires it.
4. Record provider retention if the data is not immediately deletable.

## Send The Response

Send a concise response from the support inbox. Include:

- request type handled
- verification method used
- categories of data provided, corrected, deleted, or minimized
- records retained and the reason
- provider actions taken or provider contacts supplied
- date completed

Do not include internal table names unless they help the requester understand
the result. Do not include other users' personal information.

## Close The Request

Before closing the private request record:

1. Confirm no active ticket, refund, dispute, payout, safety, or legal issue was
   broken by the change.
2. Confirm marketing opt-out or suppression remains effective.
3. Confirm provider deletion/redaction jobs are complete or recorded as pending.
4. Confirm backups and provider retention exceptions are documented.
5. Save the final response and completion timestamp.
