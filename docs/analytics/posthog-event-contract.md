---
title: PostHog Event Contract
category: Analytics
order: 1
description: Product analytics event contract and privacy rules
access: public
---

# PostHog Event Contract

This contract is the source of truth for Braket Tickets PostHog events. Update
this document in the same change whenever adding, removing, or changing an
analytics event.

PostHog is used for product analytics, masked session replay, feature flags,
feedback context, and Convex business-event telemetry. Sentry remains the
exception debugging system.

## Source Of Truth

Frontend events capture user intent and friction only. They must not claim that
money moved, tickets were issued, access was granted, check-in succeeded, vetting
was reviewed, an event was published, or Stripe Connect completed.

Convex events are authoritative for:

- money and checkout state transitions
- ticket issuance
- check-in success and failure
- vetting submission and review
- event publish transitions
- Stripe Connect completion

## Common Properties

Every Braket event should include these common properties where the source can
provide them:

```ts
export type AnalyticsEnvironment =
  | 'production'
  | 'preview'
  | 'development'
  | 'test'
  | 'e2e';

export type ActorRole =
  | 'anonymous'
  | 'guest'
  | 'user'
  | 'community_admin'
  | 'root_admin'
  | 'scanner'
  | 'system';

export type AuthState = 'anonymous' | 'guest' | 'signed_in' | 'system';

export type CommonAnalyticsProps = {
  schema_version: 1;
  environment: AnalyticsEnvironment;
  route_template?: string;
  actor_role?: ActorRole;
  auth_state?: AuthState;
  build_commit_hash?: string;
  build_branch?: string;
  build_timestamp?: string;
};
```

Use past-tense snake_case event names. Event properties must be stable,
low-cardinality where possible, and scrubbed before delivery.

Domain values must match the repo:

```ts
export type EventVisibility = 'private' | 'public_viewable' | 'public';
export type PurchaseAccessSource =
  | 'open_access'
  | 'direct'
  | 'shared'
  | 'denied';
export type CheckoutKind = 'primary' | 'guest' | 'free' | 'resale';
export type PaymentProvider = 'stripe' | 'none';
```

Do not introduce unsupported visibility values such as `gated`, `unlisted`, or
`private_link` unless the shared domain model changes first.

## P0 Frontend Events

| Event                               | Source                                        | Required properties                                                               |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| `event_viewed`                      | Angular event details page                    | `event_id`, optional `organizer_id`, `event_visibility`, `purchase_access_source` |
| `checkout_panel_opened`             | Angular checkout sidebar/event details action | `event_id`, `checkout_kind`, optional `ticket_count`, `tier`                      |
| `stripe_checkout_mounted`           | Angular Stripe embedded checkout component    | `order_id`, `event_id`, `checkout_kind`                                           |
| `stripe_connect_onboarding_started` | Angular admin Connect entry point             | `organizer_id`, `connected_account_present`                                       |
| `feedback_submitted`                | Angular feedback dialog                       | `feedback_category`, `message_length`, `signed_in`, `has_replay_url`              |
| `trust_link_created`                | Existing Angular vetting trust links service  | existing safe properties after sanitizer                                          |
| `trust_link_removed`                | Existing Angular vetting trust links service  | existing safe properties after sanitizer                                          |

## P0 Backend Events

| Event                                       | Source                                         | Required properties                                                                                           |
| ------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ticket_order_opened`                       | Convex order open state                        | `order_id`, `event_id`, `checkout_kind`, `ticket_count`, `amount_cents`, `currency`, `purchase_access_source` |
| `checkout_completed`                        | Convex completion or Stripe webhook settlement | `order_id`, `event_id`, `checkout_kind`, `amount_cents`, `currency`, `payment_provider`                       |
| `checkout_failed`                           | Convex webhook/payment failure path            | `order_id`, `event_id`, `checkout_kind`, `error_code`, `failure_stage`                                        |
| `checkout_abandoned`                        | Convex reservation/session expiration          | `order_id`, `event_id`, `checkout_kind`, `abandonment_source`, `minutes_since_opened`                         |
| `tickets_issued`                            | Convex primary/free fulfillment                | `order_id`, `event_id`, `ticket_count`, `checkout_kind`                                                       |
| `payment_webhook_processed`                 | Stripe webhook dispatch claim/finalize path    | `stripe_event_type`, `result`, optional `error_code`, optional `order_id`                                     |
| `checkout_completed_without_tickets_issued` | Convex anomaly detector                        | `order_id`, `event_id`, `checkout_kind`                                                                       |
| `ticket_checked_in`                         | Convex check-in success                        | `event_id`, `ticket_id_hash` or `guest_id_hash`, `scan_source`, `actor_role`                                  |
| `ticket_checkin_failed`                     | Convex check-in failure                        | optional `event_id`, `error_code`, `scan_source`, `actor_role`                                                |
| `vetting_application_submitted`             | Convex vetting submit                          | `community_id`, optional `application_id_hash`                                                                |
| `vetting_application_approved`              | Convex vetting review                          | `community_id`, `reviewer_role`, optional `application_id_hash`                                               |
| `vetting_application_rejected`              | Convex vetting review                          | `community_id`, `reviewer_role`, optional `application_id_hash`                                               |
| `event_published`                           | Convex event management transition             | `event_id`, `organizer_id`, `event_visibility`, `ticket_tier_count`                                           |
| `stripe_connect_onboarding_completed`       | Convex Stripe Connect status transition        | `organizer_id`, `connected_account_present`, `stripe_charges_enabled`, `stripe_payouts_enabled`               |

## Allowed Properties

Allowed properties are bounded identifiers and product-state values that do not
contain personal, payment, secret, or free-text content. Examples:

- `event_id`
- `organizer_id`
- `community_id`
- `order_id`
- `checkout_kind`
- `ticket_count`
- `amount_cents`
- `currency`
- `payment_provider`
- `error_code`
- `failure_stage`
- `reviewer_role`
- `ticket_tier_count`
- `connected_account_present`
- `stripe_charges_enabled`
- `stripe_payouts_enabled`
- `route_template`

Hash ticket, guest, and application IDs before using them as analytics
properties unless direct operational debugging requires the raw ID and this
contract is updated in the same change.

## Privacy Rules

Never send these to PostHog:

- email addresses
- full names
- phone numbers
- postal addresses
- raw feedback messages
- vetting answers
- admin review notes
- Stripe client secrets
- Stripe account IDs
- payment method details
- checkout URLs or magic links with tokens
- unsubscribe tokens
- QR payloads or ticket PDFs
- buyer, guest, attendee, and roster table contents
- raw request or response bodies from replay network capture

Strip or redact any property whose key contains:

```ts
const DENYLIST_KEY_PARTS = [
  'email',
  'name',
  'phone',
  'address',
  'message',
  'description',
  'answer',
  'application',
  'token',
  'secret',
  'client_secret',
  'password',
  'qr',
  'magic',
  'link_url',
  'raw',
  'buyer',
  'guest_email',
  'customer',
];
```

`url` is denied unless it is produced by the route-template helper and stored as
`route_template`.

Session replay launch posture:

- use maximum text and input masking
- disable recording of request headers and bodies
- redact query strings and token-like path segments from replay network metadata
- add `.ph-no-capture` to sensitive UI regions
- use 25 percent general sampling unless cost or privacy review requires lower
  sampling

## Do Not Add

- No ad hoc event names.
- No raw free text.
- No PII.
- No client-only payment success events.
- No capture calls from Angular templates.
- No capture calls in reactive effects without a dedupe guard.

## P1 Deferred Analytics

The following event families are deferred P1 analytics work:

- resale events
- refund events
- magic link events
- marketing email events
