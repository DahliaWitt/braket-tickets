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
- [Verify vetting reminder unsubscribe compliance](#verify-vetting-reminder-unsubscribe-compliance)
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

| Cause                                         | Fix                                                                                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resend API key expired or rotated             | Update `RESEND_API_KEY` in Doppler for production, then run `DOPPLER_CONFIG=prd pnpm sync:env:prod`. Local/staging use Ethereal preview SMTP.       |
| Local/staging preview SMTP is missing         | Set `SMTP_HOST=smtp.ethereal.email`, `SMTP_PORT=587`, `SMTP_USER`, and `SMTP_PASS`, then sync the affected non-production deployment.               |
| Gmail fallback credentials expired or rotated | Update `SMTP_USER` and `SMTP_PASS`; fallback is only used for critical auth and ticket-delivery mail after Resend pre-acceptance transient failures |
| Resend sending limit reached                  | Check the Resend quota and raise the limit if needed                                                                                                |
| Email dedup guard blocked a legitimate retry  | Check the `emailDedup` table for the idempotency key                                                                                                |
| From address or domain is blocked             | Verify SPF, DKIM, and sender-domain status in Resend                                                                                                |

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
pnpm convex run --prod notification_digests:sendDailyDigests
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

## Verify vetting reminder unsubscribe compliance

**Symptom:** Vetting reminder emails are missing unsubscribe affordances or still reach opted-out users.

Check these items in order:

1. Trigger a vetting reminder via `reminders.sendVettingReminder` (Convex dashboard or CLI) and inspect the delivered message source.
2. Confirm the body contains a visible unsubscribe link and a link to `/account#email-preferences`.
3. Confirm the raw headers contain both `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
4. If an opted-out user still appears in the reminder audience, inspect:
   - `users.globalMarketingOptOut`
   - `marketingEmailPreferences` for the organizer where `isPlatformOrganizer: true`
5. If no platform organizer exists, `reminders.sendVettingReminder` will create one with slug `braket-platform-marketing` before issuing tokens.

Source of truth:

- `backend/convex/communities/management/reminders.ts`
- `backend/convex/email/templates.ts`
- `backend/convex/lib/marketing_emails/preferences.ts`

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
