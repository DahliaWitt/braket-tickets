---
title: Email Flows
category: Reference
categoryOrder: 6
order: 1
description: Email templates, triggers, testing, and deliverability
access: public
---

# Email Flows Documentation

This document covers all email templates, when they're triggered, how to test them, and deliverability considerations.

## Overview

Braket Tickets sends email through a delivery wrapper with three provider paths:

- **Production primary**: Resend Convex component and Resend API for attachment/manual sends
- **Production fallback**: Gmail SMTP for critical auth and ticket mail only after Resend pre-acceptance failures
- **Local/staging preview**: Ethereal SMTP on non-production deployments

All email templates use the distinctive "Pulp" voice: warm, playful, kaomoji-friendly, and careful not to commodify underground or community safety language.

---

## Email Templates

### 1. Verification Email

**Template Function**: `verificationTemplate()` in `backend/convex/email/templates.ts`

**When Triggered**:

- User signs up with email/password
- Better Auth's `sendVerificationEmail` callback is invoked

**Subject**: `Verify your email`

**CTA Button**: `Yep, This Is My Email`

**Flow**:

1. User submits registration form
2. Better Auth creates account with `emailVerified: false`
3. `sendVerificationEmail` callback builds `verificationTemplate()` and dispatches through `email/smtp.ts`
4. Email sent with verification link
5. User clicks link → redirected to `/login` with session established

**E2E Test**: `frontend/e2e/auth/verification-flow.e2e-spec.ts`

---

### 2. Password Reset Email

**Template Function**: `passwordResetTemplate()` in `backend/convex/email/templates.ts`

**When Triggered**:

- User clicks "Forgot Password" and submits their email

**Subject**: `Password reset link for Braket Tickets`

**CTA Button**: `Make New Password`

**Flow**:

1. User clicks "Forgot Password" on login page
2. User enters email address
3. Better Auth's `sendResetPassword` callback builds `passwordResetTemplate()` and dispatches through `email/smtp.ts`
4. Email sent with reset link
5. User clicks link → `/confirm/password-reset?token=xxx`
6. User sets new password
7. Success message shown, can login with new password

**E2E Test**: `frontend/e2e/auth/password-reset.e2e-spec.ts`

---

### 3. Email Change Confirmation

**Template Function**: `emailChangeConfirmationTemplate()` in `backend/convex/email/templates.ts`

**When Triggered**:

- Authenticated user requests email change in Account settings

**Subject**: `Confirm your Braket Tickets email change`

**CTA Button**: `Yep, That Was Me`

**Flow**:

1. User navigates to `/account`
2. User enters new email address in the email change form
3. `auth.public.requestEmailChange` validates and normalizes the new email
4. Better Auth sends confirmation email to CURRENT address via `auth.user.changeEmail.sendChangeEmailConfirmation`
5. User clicks the confirmation link in the CURRENT inbox
6. Better Auth approves the change request and redirects back to `/confirm/email-change?flow=email-change` without an OTT token
7. The frontend treats that marked callback as an "Almost Done" intermediate state and tells the user to check the new inbox without claiming more than the callback marker proves
8. Better Auth sends a second verification email to the NEW inbox
9. User clicks the verification link in the NEW inbox
10. Better Auth redirects to `/confirm/email-change?flow=email-change&ott=...`, the OTT is verified, the app profile syncs to the new Better Auth email, and the email update completes

**E2E Test**: `frontend/e2e/email-delivery.e2e-spec.ts`

**Security Notes**:

- Better Auth handles token expiry
- Confirmation goes to the current verified inbox (prevents silent account takeover)
- Better Auth enforces single-use verification semantics
- App-level request throttling allows three email-change requests per user per
  hour so a mistaken request can be canceled and retried during normal QA
  without waiting for the full window.

---

### 4. Ticket Purchase Confirmation

**Template Function**: `purchasedTicketTemplate()` in `backend/convex/email/templates.ts`

**When Triggered**:

- Successful ticket purchase via Stripe Checkout

**Subject**: `Your ticket for {eventTitle}`

**Content**:

- Event details (title, date, location)
- QR code for check-in (inline image via CID)
- PDF attachment with ticket

**Flow**:

1. User completes purchase via Stripe Checkout
2. `orders.syncCheckoutSession` or the Stripe webhook settles the order
3. Order settlement queues `tickets_actions.sendTicketsAction`
4. Email sent with inline QR and PDF attachment

**Attachments**:

- `ticket-{event-slug}-{ticket-id}.pdf` - Printable ticket PDF
- `qrcode.png` - Inline QR code image (CID: qrcode)

---

### 5. Guest Ticket Email

**Template Function**: `purchasedTicketTemplate()` (same as purchased tickets)

**When Triggered**:

- Admin sends ticket to guest via Guest List management

**Flow**:

1. Admin adds guest to event's guest list with email
2. Admin clicks "Send Ticket" for the guest
3. `guests_actions.sendTicket` generates QR code and PDF
4. Email sent to guest with ticket

**E2E Test**: `frontend/e2e/admin/check-in.e2e-spec.ts` (covers guest check-in)

---

### 6. Application Approved Email

**Template Function**: `applicationApprovedTemplate()` in `backend/convex/email/templates.ts`

**When Triggered**:

- Admin approves a user's vetting application

**Subject**: `You're approved for {communityName}. Yipee!`

**CTA Button**: `View Events`

**Flow**:

1. Admin reviews application in admin UI
2. Admin clicks "Approve"
3. `applications.review` sets `status: 'approved'` and `isTrusted: true`
4. Email sent to user notifying them of approval

---

### 7. Application Rejected Email

**Template Function**: `applicationRejectedTemplate()` in `backend/convex/email/templates.ts`

**When Triggered**:

- Admin rejects a user's vetting application

**Subject**: `Update on your {communityName} application`

**Flow**:

1. Admin reviews application in admin UI
2. Admin clicks "Reject"
3. `applications.review` sets `status: 'rejected'` and `isTrusted: false`
4. Email sent to user notifying them of rejection

---

### 8. Event Broadcast Email

**Template Function**: `eventBroadcastTemplate()` in `backend/convex/email/templates.ts`

**When Triggered**:

- Community admin sends a one-off update from `/community-admin/events/{id}/manage` → Email tab

**Subject**: Admin-authored

**CTA Button**: `View Event`

**Flow**:

1. Community admin sends a broadcast from the event management Email tab
2. `events.broadcasts.send` rebuilds the recipient list from valid ticket holders and guest emails
3. Recipient filtering honors organizer-level email opt-outs before fan-out
4. Registered users reuse `marketingEmailPreferences` tokens for unsubscribe
5. Guest-only inboxes use `emailAddressMarketingPreferences` so one-click unsubscribe still works without an account
6. Each delivered email includes:
   - A visible unsubscribe link
   - `List-Unsubscribe`
   - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
7. Delivery failures are recorded through Resend webhook events or explicit fallback failure records

**Compliance Notes**:

- Broadcast emails are treated as commercial/community bulk email, not purely transactional
- Future broadcasts skip recipients with organizer-level opt-outs
- Guest-only inboxes can manage preferences from the unsubscribe landing page even without a Braket account

---

## Template Locations

| Template            | Location                                     |
| ------------------- | -------------------------------------------- |
| All email templates | `backend/convex/email/templates.ts`          |
| SMTP transport      | `backend/convex/email/smtp.ts`               |
| Auth email logic    | `backend/convex/lib/better_auth.ts`          |
| Email change logic  | `backend/convex/auth/public.ts`              |
| Ticket emails       | `backend/convex/tickets/actions.ts`          |
| Guest ticket emails | `backend/convex/events/guest_actions.ts`     |
| Application emails  | `backend/convex/communities/applications.ts` |

---

## Testing Infrastructure

### Test Email Capture

When `IS_TEST=true` environment variable is set, the email system captures rows without contacting Resend or SMTP:

1. **Row Capture**: `backend/convex/lib/email_delivery_wrapper.ts` and `backend/convex/email/resend_actions.ts` write the rendered message to `testEmails`
2. **EmailHarness**: `frontend/e2e/helpers/email-harness.ts` retrieves and navigates to emails

Local and staging preview delivery uses Ethereal SMTP through the existing
`SMTP_*` variables when the deployment does not look like production. That
preview path is runtime delivery, separate from `IS_TEST=true` row capture.

### EmailHarness API

```typescript
const emailHarness = new EmailHarness(page, convexHelper);

// Navigate to the latest email for a recipient
await emailHarness.navigateToLatestEmail('user@example.com', /subject regex/i);

// Verify text content in email
await emailHarness.expectText(/expected text/i);

// Click a link in the email (extracts href and navigates)
await emailHarness.clickLink(/link text/i);

// Verify attachment exists
await emailHarness.expectAttachment('ticket.pdf');

// Verify QR code image exists
await emailHarness.expectQRCode();
```

### Running Email E2E Tests

```bash
# Run all E2E tests (includes email flows)
pnpm test:e2e

# Terminal 1: start the reusable E2E harness
pnpm test:e2e:serve

# Terminal 2: run specific email tests against the active harness
pnpm test:e2e:run --grep "verification"
pnpm test:e2e:run --grep "password reset"
pnpm test:e2e:run --grep "email change"
```

### Test Database Table

Emails are logged to `testEmails` table (see `backend/convex/schema.ts`):

```typescript
testEmails: defineTable({
  to: v.string(),
  subject: v.string(),
  html: v.string(), // Contains rendered email HTML in test mode
});
```

---

## Preview Templates Locally

To preview email templates without sending:

```typescript
// In a Node.js script or Convex action:
import {
  verificationTemplate,
  passwordResetTemplate,
} from './backend/convex/email/templates';

const {subject, html} = verificationTemplate(
  'https://example.com/verify?token=xxx',
);
console.log(html); // Copy and open in browser
```

Or use local/staging Ethereal preview delivery by setting
`SMTP_HOST=smtp.ethereal.email`, `SMTP_PORT=587`, `SMTP_USER`, and `SMTP_PASS`.

---

## Deliverability Considerations

### From Name/Address

- All production emails should be sent from `EMAIL_FROM`; `SMTP_FROM` remains a fallback while older environment sets are migrated.
- Recommendation: Use a dedicated sender like `noreply@braket.tickets` or `tickets@braket.gay`

### Subject Lines

Current subjects keep transactional wording straightforward, with playful voice mostly in headers and body copy:

- ✅ Clear and on-brand
- ✅ Lower risk for spam filters than older l33t/uwu-heavy subjects
- ⚠️ Keep kaomoji out of financial and account-security subjects

### Recommendations for Better Deliverability

1. **SPF/DKIM/DMARC**: Ensure DNS records are properly configured for sending domain
2. **Consistent From Address**: Use same address for all emails
3. **Subject Line A/B Testing**: Test deliverability with different subject styles
4. **Unsubscribe Headers**: Add List-Unsubscribe header for promotional emails
5. **Plain Text Alternative**: Templates include `text` param but could be improved

### Spam Trigger Warnings

These phrases may trigger spam filters:

- "OMG" - commonly flagged
- Excessive emoji/kaomoji in subjects
- "kthxbai", "lol", "XD" - informal language
- "Click here" - classic spam trigger

Keep transactional subjects plain, especially verification, password reset, email change, and payout notices.

---

## Missing/Recommended Emails

### Currently Not Implemented

1. **Welcome Email** - After successful verification (separate from verification email)
2. **Purchase Receipt** - Detailed receipt with line items, taxes, etc.
3. **Event Reminder** - 24h/1h before event starts
4. **Ticket Transfer Notification** - When ticket is transferred to another user
5. **Refund Confirmation** - When payment is refunded
6. **Account Security Alert** - Password changed, new login from new device
7. **Event Cancellation** - When an event is cancelled

### Recommended Additions

```typescript
// Suggested new templates in backend/convex/email/templates.ts:

export function welcomeTemplate(userName: string): EmailTemplate { ... }
export function eventReminderTemplate(event: Event, hoursUntil: number): EmailTemplate { ... }
export function ticketTransferTemplate(ticket: Ticket, newOwner: string): EmailTemplate { ... }
export function refundConfirmationTemplate(payment: Payment): EmailTemplate { ... }
export function securityAlertTemplate(action: string): EmailTemplate { ... }
```

---

## Environment Variables

### Production Email

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=noreply@braket.tickets
EMAIL_REPLY_TO=contact@braket.tickets
```

### Testing

```env
IS_TEST=true  # Captures email rows without calling Resend
```

### Local/Staging Preview

```env
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=ethereal_user@example.com
SMTP_PASS=ethereal_password
SMTP_FROM=ethereal_user@example.com
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Angular)                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Convex Backend                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     Better Auth                              ││
│  │  - sendVerificationEmail callback                           ││
│  │  - sendResetPassword callback                               ││
│  └──────────────────────────┬──────────────────────────────────┘│
│                             │                                    │
│                             ▼                                    │
│                             │                                    │
│  ┌──────────────────────────┼──────────────────────────────────┐│
│  │                          ▼                                  ││
│  │  ┌───────────────────────────────────────┐                 ││
│  │  │        email/templates.ts             │                 ││
│  │  │  - verificationTemplate               │                 ││
│  │  │  - passwordResetTemplate              │                 ││
│  │  │  - emailChangeConfirmationTemplate    │                 ││
│  │  │  - purchasedTicketTemplate            │                 ││
│  │  │  - applicationApprovedTemplate        │                 ││
│  │  │  - applicationRejectedTemplate        │                 ││
│  │  └──────────────────────────┬────────────┘                 ││
│  │                             │                               ││
│  │                             ▼                               ││
│  │  ┌───────────────────────────────────────┐                 ││
│  │  │  email delivery wrapper/actions       │                 ││
│  │  │  - IS_TEST → testEmails capture       │                 ││
│  │  │  - non-production → Ethereal SMTP     │                 ││
│  │  │  - prod primary → Resend              │                 ││
│  │  │  - critical fallback → Gmail SMTP     │                 ││
│  │  └──────────────────────────┬────────────┘                 ││
│  └─────────────────────────────┼───────────────────────────────┘│
└────────────────────────────────┼────────────────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────┐
              │     Resend / SMTP Providers      │
              └──────────────────────────────────┘
```

---

## Security Considerations

1. **XSS Prevention**: All user data is escaped via `escapeHtml()` before HTML interpolation
2. **Token Security**: Better Auth owns verification and email-change tokens, including expiry and single-use semantics. The app stores only `pendingEmail` so Account can show and cancel the in-progress request.
3. **Rate Limiting**: `requestEmailChange` allows three requests per user per hour and `cancelEmailChange` allows five cancellations per user per hour. See [Auth Incidents](./runbooks/auth-incidents.md#repair-email-change-requests-or-confirmation) for the incident checklist.
4. **Email Enumeration**: Registration handles duplicate emails securely (doesn't reveal existence)

---

## Changelog

- **2026-02-01**: Initial documentation created
