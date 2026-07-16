---
title: Email Delivery
category: Runbooks
order: 6
description: Incident response runbook — email delivery
access: public
---

# Email Delivery Incidents

This runbook is for engineers or admins who troubleshoot outbound email from Braket Tickets. It assumes access to Convex Dashboard and the Resend dashboard. Use it when transactional email, vetting digests, or delivery reputation looks wrong.

Source of truth:

- `backend/convex/email/resend_actions.ts`
- `backend/convex/email/smtp.ts` (Ethereal preview and Gmail SMTP fallback)
- `backend/convex/lib/email_delivery_wrapper.ts`
- `backend/convex/marketing/digests.ts`
- `backend/convex/lib/email_dedup.ts`

Jump to:

- [Restore transactional email delivery](#restore-transactional-email-delivery)
- [Restore daily vetting digests](#restore-daily-vetting-digests)
- [Verify bulk email unsubscribe compliance](#verify-bulk-email-unsubscribe-compliance)
- [Verify ticket purchase reminder delivery](#verify-ticket-purchase-reminder-delivery)
- [Investigate a bounce spike](#investigate-a-bounce-spike)

## Restore transactional email delivery

**Symptom:** Users do not receive verification, password-reset, ticket-confirmation, or vetting-notification email.

Start with these checks:

1. Check Convex Dashboard logs for failures in `email/` functions.
2. Check the Resend dashboard for delivery failures or bounces.
3. Confirm that `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and sender-domain DNS are valid.
4. For local or staging preview delivery, confirm `SMTP_HOST=smtp.ethereal.email`, `SMTP_PORT=587`, `SMTP_USER`, and `SMTP_PASS`.
5. For critical production auth or ticket email only, confirm Gmail SMTP fallback credentials are still valid.

The table below lists the common causes in the current system:

| Cause                                         | Fix                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resend API key expired or rotated             | Update `RESEND_API_KEY` in Doppler for production, then run `DOPPLER_CONFIG=prd pnpm sync:env:prod`. Local/staging use Ethereal preview SMTP.                                                                                                                                                                                                                                          |
| Local/staging preview SMTP is missing         | Set `SMTP_HOST=smtp.ethereal.email`, `SMTP_PORT=587`, `SMTP_USER`, and `SMTP_PASS`, then sync the affected non-production deployment.                                                                                                                                                                                                                                                  |
| Gmail fallback credentials expired or rotated | Update `SMTP_USER` and `SMTP_PASS`; fallback is only used for critical auth and ticket-delivery mail after Resend pre-acceptance transient failures                                                                                                                                                                                                                                    |
| Resend sending limit reached                  | Check the Resend quota and raise the limit if needed                                                                                                                                                                                                                                                                                                                                   |
| Email dedup guard blocked a legitimate retry  | Check the `emailDedup` table for the idempotency key                                                                                                                                                                                                                                                                                                                                   |
| From address or domain is blocked             | Verify SPF, DKIM, and sender-domain status in Resend                                                                                                                                                                                                                                                                                                                                   |
| Immediate vetting-notification recipient cap  | Immediate ("all" mode) vetting notifications are capped at 100 recipients per submission (`backend/convex/lib/applications/queries.ts`). Admins past the cap get no immediate email; Convex logs warn `Immediate vetting-notification recipients exceed cap; truncating` from the `applications` module. Affected admins still receive the daily digest if they switch to digest mode. |

If a legitimate email was blocked by the dedup guard:

1. Find the idempotency key in `emailDedup`.
2. Delete the row if you need to allow one more send.
3. Wait for the cleanup cron if the key is old enough to expire naturally.

The current code checks validation before it inserts the dedup key. If that ordering changes, a failed validation can burn the dedup slot and block the next legitimate send.

To verify the fix, trigger a real email flow on the same environment that is failing, then confirm both the Convex logs and the provider-side delivery record.

## Restore daily vetting digests

**Symptom:** Community admins do not receive the daily digest for new vetting applications.

Check these items in order:

1. Check Convex Dashboard -> Crons -> `send daily vetting digests` for the last run and status.
2. Confirm that new `applications` rows exist for the affected organizer.
3. Confirm that `adminNotificationPreferences` contains a row for the admin. No row means notifications are off.
4. Confirm that the admin's email address is verified.

If the cron ran but did not send the digest, invoke the current export path directly:

```bash
pnpm convex run --prod marketing/digests:sendDailyDigests
```

## Verify bulk email unsubscribe compliance

**Symptom:** A community announcement or event broadcast email is missing unsubscribe affordances.

Check these items in order:

1. Open the rendered message in Ethereal or the provider preview and confirm the body contains a visible unsubscribe link.
2. Inspect the raw headers and confirm both `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` are present.
3. For registered users, confirm the message links back to `/account#email-preferences`.
4. For guest-only inboxes, confirm the preference-management link lands on `/unsubscribe?token=...`.
5. If an opted-out inbox still received a bulk email, inspect the organizer-scoped preference row in:
   - `marketingEmailPreferences` for user-backed inboxes
   - `emailAddressMarketingPreferences` for guest-only inboxes
   - Guest→user migration (`backend/convex/lib/guest_sessions/migration.ts`)
     carries a guest-address opt-out onto the user's `marketingEmailPreferences`
     but never re-enables an existing user preference: an address row defaults to
     `optedIn: true` on first send, so migration only creates a new preference or
     propagates an unsubscribe. A user's explicit opt-out therefore survives a
     later same-email guest purchase.

Unsubscribe and tracking tokens are bearer credentials. App-owned tables store
only purpose-scoped digests for new tokens:

- `marketingUnsubscribeTokens.tokenDigest` stores newly issued unsubscribe-link
  tokens.
- `marketingEmailPreferences.unsubTokenDigest` and
  `emailAddressMarketingPreferences.unsubTokenDigest` support legacy preference
  links during the staged migration.
- `marketingEmailDeliveries.openTokenDigest` and `clickTokenDigest` back open
  and click tracking lookup.

Do not try to recover a raw unsubscribe, open, or click token from Convex. Create
or send a new email/link instead. The raw token still appears in the delivered
email URL and may be retained by the email provider or short-lived delivery
component records until their cleanup job runs.

Source of truth:

- `backend/convex/events/broadcasts.ts`
- `backend/convex/email/templates.ts`
- `backend/convex/marketing/emails.ts`

## Event broadcast catch-up for late ticket buyers

**Behavior:** Event broadcasts (`api.events.broadcasts.send`) are also delivered
to recipients who join the audience after the send. Primary order completion,
resale settlement, and guest-list adds each schedule
`internal.events.broadcasts.deliverMissed`, which sends every broadcast the
recipient's normalized email has not yet received, oldest-first.

**Delivery ledger:** `eventBroadcastDeliveries` stores one row per
(broadcast, normalized recipient email) with `origin: 'send' | 'catchup' | 'backfill'`.
This table — not `emailDedup` (24h TTL) — is the durable record of who received
which broadcast. Rows are never cleaned up; the durable dedup is the point.

Source of truth:

- `backend/convex/events/_impl/broadcasts_handlers.ts` — send fan-out and `deliverMissedBroadcasts`
- `backend/convex/lib/orders/complete.ts`, `backend/convex/lib/resale/settlement.ts`, `backend/convex/events/_impl/guests.ts` — scheduling triggers

### Backfill after deploy

Run `migrations:backfillEventBroadcastDeliveries` promptly after the feature
deploys. It seeds `eventBroadcastDeliveries` from historical `emailDeliveries`
rows with `source === 'broadcast'` so pre-feature broadcasts are not re-sent to
existing holders the next time they buy an additional ticket.

```bash
# Dry run first (throws "DRY RUN" by design after processing one batch)
pnpm convex run --prod migrations:backfillEventBroadcastDeliveries '{"dryRun":true}'

# Real run (self-schedules until the table is fully scanned)
pnpm convex run --prod migrations:backfillEventBroadcastDeliveries
```

**Coverage window:** `emailDeliveries` rows are pruned after 30 days
(`backend/convex/email/email_delivery.ts` `cleanupOldDeliveries`), so the
backfill only covers broadcasts sent in the last 30 days. For older broadcasts,
an existing holder who buys an additional ticket may receive one duplicate of
an old broadcast — accepted residual risk (bounded, one-time).

### Troubleshooting catch-up

| Cause                                       | Fix                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Late buyer did not receive a past broadcast | Check `eventBroadcastDeliveries` `by_event_and_email` for the normalized email. No row = catch-up never ran or was skipped; check Convex logs for `deliverMissed` warnings (missing `SITE_URL` or email credentials skip WITHOUT recording rows, so the next purchase retriggers). |
| Recipient received a broadcast twice        | Confirm the backfill migration ran after deploy; duplicates are expected only for broadcasts older than the 30-day `emailDeliveries` retention window.                                                                                                                             |

## Verify ticket purchase reminder delivery

**Symptom:** Ticket purchase reminder emails are not delivering, are sent to the wrong audience, or an admin reports being blocked from sending.

Source of truth:

- `backend/convex/events/_impl/reminders_handlers.ts` — mutation ordering contract
- `backend/convex/events/_impl/reminders.ts` — recipient loading and email queueing
- `backend/convex/events/_impl/reminder_content.ts` — dedup key construction and validation

### Safety controls

The send mutation enforces three layers of protection:

1. **Email dedup** (24h, key = `reminder:{userId}:{eventId}:{subject}`): prevents duplicate sends. Same admin + event + subject = blocked for 24h.
2. **Rate limit** (1 send per 15 min per admin+event): prevents rapid-fire sends even with different subjects.
3. **Batch cap** (500 recipients): hard limit on fan-out per send.

### Mutation ordering

auth → validate → dedup READ → audience load → soft-return (0 recipients) → dedup INSERT → rate limit → unsub token gen + fan-out → history → audit

The read-only dedup check sits before audience load so retries of committed sends always return early. The dedup insert sits after audience load so zero-recipient sends do not burn the 24h dedup slot.

### Recipient loading (bounded reads)

The audience builder uses a candidate-first strategy:

1. Streams approved applications (indexed), excludes users with completed orders
2. Caps candidates at 2× batch size (1000)
3. Does individual indexed preference lookups per candidate (not full-organizer scans)
4. Applies consent filtering, caps final recipients at 500

Worst-case read budget: ~13,000 documents (well under 16,384 transaction limit).

### Troubleshooting

| Cause                       | Fix                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin blocked by dedup      | Check `emailDedup` for key matching `reminder:{userId}:{eventId}:{subject}`. Delete the row if the original send failed silently.                                      |
| Admin blocked by rate limit | Wait 15 minutes, or check rate-limiter state in Convex dashboard.                                                                                                      |
| Zero recipients returned    | Verify approved applications exist for the event's organizer. Check that recipients have not all opted out via `marketingEmailPreferences` or `globalMarketingOptOut`. |
| Missing unsubscribe headers | Check `ticketPurchaseReminderTemplate` in `backend/convex/email/templates.ts` — should include `List-Unsubscribe` and `List-Unsubscribe-Post` headers.                 |
| Send history missing        | Check `ticketReminderSends` table for the event. If empty, the mutation may have rolled back (rate limit or other error after dedup).                                  |

## Rich email bodies and inline images

**Symptom:** A broadcast or ticket-reminder send fails with a validation error, a delivered email shows a broken inline image, or `/api/images/*` returns unexpected 404s.

Source of truth:

- `backend/convex/lib/email/rich_text_validator.ts` — fail-closed structural validation of the client `bodyJson` (allowlisted nodes/marks, URL schemes, size/depth caps)
- `backend/convex/lib/email/rich_text_render.ts` — pure-JS serializer to inline-styled email HTML (no DOM/TipTap at runtime; `rich_text_render.oracle.test.ts` pins it to TipTap's reference output)
- `backend/convex/lib/email/rich_text_images.ts` — sender-ownership gate, publish registry writes, durable URL construction
- `backend/convex/http/_impl/images.ts` — the public image route handler (registered in `backend/convex/http.ts`)
- `shared/email/rich-text-schema.ts` — the node/mark/scheme allowlist shared by editor, validator, and renderer (drift-tested on both sides)

### How inline images work

1. The composer uploads through `generateUploadUrl` → `confirmUpload` (magic-byte validated); the editor stores the **storage id** in the document — never a URL. The signed `getUrl` result is composer-preview only.
2. At send time the mutation verifies every image id is a confirmed upload **owned by the sender**, renders the body once, and registers each id in `richEmailImages` — all in the same transaction as the send.
3. Emails reference images as `GET {api-site-base}/api/images/{storageId}` (the `CONVEX_SITE_URL` domain, same base as the unsubscribe routes). The route is public (email clients are unauthenticated) but serves **only** ids present in `richEmailImages`; everything else 404s. Content type is clamped to the image allowlist and served with `nosniff`.

### Invariants

- **Published images are pinned.** `cleanupReplacedUpload` (`backend/convex/lib/upload_validation.ts`) skips any storage id present in `richEmailImages`, so replacing an event poster/community logo that was also emailed never breaks a delivered email. Do not delete blobs referenced by `richEmailImages` manually; their lifecycle belongs to the (planned) email-image GC.
- **Stored `bodyJson` is the sanitized document**, not the raw client string — signed preview URLs and stripped attributes are never persisted.
- **Size caps:** `bodyJson` ≤ 32KB and rendered HTML ≤ 32KB (`MAX_RICH_EMAIL_BODY_JSON_BYTES` / `MAX_RICH_EMAIL_RENDERED_HTML_BYTES` in `shared/constants.ts`); extracted plain text ≤ 5000 chars. All enforced before the dedup slot burns, so a rejected send can be corrected and retried with the same subject.

### Troubleshooting

| Cause                                   | Fix                                                                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Send rejected: "not a confirmed upload" | The body references a storage id without a `confirmedUploads` row owned by the sender. The composer must re-upload; hand-crafted `bodyJson` with foreign ids is rejected by design. |
| Send rejected: "too large to send"      | The rendered HTML exceeded the 32KB cap (usually many near-empty blocks). Shorten the body; the cap protects the ×500 recipient fan-out and Gmail's ~102KB clipping limit.          |
| `/api/images/{id}` 404 for a real image | Check `richEmailImages` for the id — only images published by an actual send are served. Posters, logos, and abandoned composer uploads 404 here by design (use signed URLs).       |
| Broken image in a delivered email       | Verify the blob still exists (`_storage`) and has a `richEmailImages` row. If the blob is gone, something bypassed the pinning rule in `cleanupReplacedUpload`.                     |
| Image renders as a download/blank       | The stored content type fell outside the jpeg/png/gif/webp allowlist and was clamped to `application/octet-stream` (polyglot defense in `getPublishedEmailImage`).                  |

## Investigate a bounce spike

**Symptom:** The Resend dashboard shows a bounce spike, or Sentry shows repeated email delivery failures.

Check the likely causes in this order:

1. Check the Resend dashboard for the bounce reason.
2. If valid addresses are bouncing, check the sender-domain DNS records.
3. If recipient servers are blocking mail, check whether `braket.gay` has landed on a block list.

For `braket.gay`, verify these records:

- **SPF:** `TXT` record allowing Resend's sending IPs
- **DKIM:** `CNAME` records per Resend's setup instructions
- **DMARC:** `TXT` record (at minimum `v=DMARC1; p=none`)

Use these checks:

```bash
dig TXT braket.gay
dig TXT _dmarc.braket.gay
```
