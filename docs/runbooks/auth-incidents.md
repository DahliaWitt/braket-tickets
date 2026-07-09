---
title: Auth Incidents
category: Runbooks
order: 2
description: Incident response runbook — auth incidents
access: public
---

# Auth Incidents

This runbook is for engineers and admins who troubleshoot sign-in, password reset, verification, email-change, or provider-linking issues. It assumes access to Convex Dashboard, the frontend routes, and the active auth environment variables. Use [Social Auth Setup](./social-auth-setup.md) for Google and Discord credential setup.

Source of truth:

- `backend/convex/lib/better_auth.ts`
- `backend/convex/auth/public.ts`
- `backend/convex/auth/sync.ts`
- `frontend/src/app/app.routes.ts`
- `frontend/src/app/core/services/auth.service.ts`
- `frontend/src/app/core/services/password.service.ts`
- `frontend/src/app/core/services/user-profile.service.ts`
- `frontend/src/app/features/auth/pages/confirm/confirm-email-change.component.ts`

Jump to:

- [Confirm the callback routes](#confirm-the-callback-routes)
- [Restore missing social buttons](#restore-missing-social-buttons)
- [Repair password reset delivery or confirmation](#repair-password-reset-delivery-or-confirmation)
- [Fix password creation or password-change failures](#fix-password-creation-or-password-change-failures)
- [Repair email-change requests or confirmation](#repair-email-change-requests-or-confirmation)
- [Handle blocked social sign-in](#handle-blocked-social-sign-in)
- [Repair auth sync after sign-in](#repair-auth-sync-after-sign-in)
- [Complete social signup onboarding](#complete-social-signup-onboarding)
- [Repair verification email links](#repair-verification-email-links)
- [Fix provider linking or unlinking](#fix-provider-linking-or-unlinking)
- [Reproduce the issue locally](#reproduce-the-issue-locally)

## Confirm the callback routes

The frontend currently handles these routes:

- `/confirm/verification`
- `/confirm/verification/:token`
- `/confirm/password-reset`
- `/confirm/email-change`
- `/confirm/social-signin`
- `/confirm/social-link`
- `/confirm/social-signup-complete`
- `/verify-email`
- `/api/auth/verify-email`

If the incident involves a redirect loop or the wrong landing page, confirm these routes before you change any provider settings.

## Restore missing social buttons

Google and Discord only appear when both the client ID and client secret exist in the active backend environment.

Check the affected environment, then sync it:

```bash
# staging / development deployment
DOPPLER_CONFIG=stg pnpm sync:env:dev

# production deployment
DOPPLER_CONFIG=prd pnpm sync:env:prod
```

To confirm the staging values reached Convex:

```bash
doppler run -p braket-tickets -c stg -- pnpm convex env list | grep -E "GOOGLE|DISCORD"
```

If the secrets are present and the buttons still do not render, investigate the auth bootstrap path instead of re-creating the provider app.

## Repair password reset delivery or confirmation

`PasswordService.requestPasswordReset()` sends users to `/confirm/password-reset` after they click the reset email. The request path deliberately returns success even when the email address does not belong to an account. That prevents account enumeration.

Use this checklist:

1. Confirm that the reset email links back to `/confirm/password-reset`.
2. Switch to [Email Delivery](./email-delivery.md) if the email never arrives.
3. Do not treat a success response from `requestPasswordReset()` as proof that the account exists.
4. If the confirmation page fails, check whether the client mapped the backend error to `Password reset link has expired. Please request a new one.`

If the user reports a generic reset failure after clicking the link, inspect the Better Auth callback error before you retry or resend mail.

## Fix password creation or password-change failures

The current password mutations are:

- `auth.public.setPassword`
- `auth.public.changePassword`

Use `setPassword` for an authenticated account that does not already have a password. Use `changePassword` for an authenticated account that must present the current password.

Use this checklist:

1. Confirm that the user is authenticated before you troubleshoot either mutation.
2. Confirm that the client and server both treat mismatched new passwords as a local validation error.
3. Check whether the UI mapped the backend failure to `Current password is incorrect`.
4. Check Convex logs for repeated `changePassword` or `setPassword` failures if the UI keeps retrying.

`changePassword` currently passes `revokeOtherSessions: true`, so session churn after a successful password change is expected.

## Repair email-change requests or confirmation

`UserProfileService.requestEmailChange()` calls `auth.public.requestEmailChange` with `/confirm/email-change?flow=email-change` as the callback URL.

`requestEmailChange` allows three requests per user per hour. This is
intentionally higher than one so an operator or QA tester can request, cancel,
and retry a mistaken email-change request without waiting for the whole
rate-limit window.

The current request-time failures are:

- `Please enter a valid email address`
- `New email must be different from current email`
- `Email address already in use`
- `User account not found`

The current confirmation-page failures are:

- `Invalid email change link. Please request a new one.` when the page is opened without `ott`, without the email-change flow marker, and the authenticated user does not still have `pendingEmail` (also covers links that only carry unrecognized query params such as `?token=...`)
- `Email change link has expired. Please request a new one.`
- `You must be signed in to complete this email change.`
- `Unable to find the account for this email change request.`

Use this checklist:

1. Confirm that the request path used `/confirm/email-change?flow=email-change` as the callback URL.
2. Confirm that the `users` row sets `pendingEmail` during the request.
3. Confirm that `auth.public.requestEmailChange` queued the verification email instead of returning a validation failure.
4. Check the callback query params for `flow=email-change`, `ott`, or `error` before you retry the flow. The first callback from the current inbox can legitimately arrive with `flow=email-change` and no `ott`.
5. If the marked callback arrives without `ott`, the page should show the "Almost Done" intermediate state even before the frontend resolves an authenticated session. The copy should direct the user to the new inbox without claiming account state was confirmed from the marker alone.
6. If the callback succeeds but the UI stays in the pending state, inspect the authenticated user payload and confirm whether `pendingEmail` still remains on the user.

Switch to [Email Delivery](./email-delivery.md) if the change-email message never arrives.

## Handle blocked social sign-in

`auth.public.syncCurrentUser` can return `status: "blocked"` for exactly two reasons:

- `provider_email_missing`
- `provider_email_unverified`

The frontend maps those reasons to these user-facing outcomes:

- missing email: sign in with the existing account first, then link the provider from account settings
- unverified email: verify the provider email first, or sign in with the existing account and link the provider manually

This state is not a generic outage. The provider did not supply a usable verified email, and `backend/convex/auth/sync.ts` refuses to create or link the app user without one.

## Repair auth sync after sign-in

The frontend retries `syncCurrentUser` on a bounded schedule. If sign-in succeeds but `authSyncFailed` becomes true:

1. Check Convex logs for auth-sync failures.
2. Look for verified-email failures such as:
   - `Auth sync blocked: verified identity email is required`
   - `Auth sync blocked: unverified identity email cannot create or link users`
3. Check for collisions in the `users` table on normalized email or Better Auth user ID.

While `authSyncFailed` is true and no app `users` profile is loaded, protected routes fail closed to `/`. That redirect is expected; repair the sync problem before troubleshooting account, tickets, dashboard, or vetting pages.

`backend/convex/auth/sync.ts` can link an existing app user by normalized email. `backend/convex/auth/sync.ts` throws if another user already owns that normalized email. Treat that case as a data-repair problem, not as a provider outage.

## Understand optimistic route activation (expected behaviors)

The frontend admits navigations optimistically from the persisted crossDomain credential in localStorage (`braket-tickets_cookie` / `braket-tickets_session_data`) before the Better Auth session settles. See `frontend/src/app/core/guards/auth.guards.ts` and `AuthService.scheduleOptimisticReconciliation` in `frontend/src/app/core/services/auth.service.ts`. Expected symptoms that are NOT bugs:

- A user whose session was revoked server-side (password change elsewhere, admin revocation) briefly sees the dashboard skeleton, then a "session expired. please log in again." toast and a redirect. This is the reconciliation path working as designed.
- A user with an expired stored credential goes straight to the landing page with no network wait — the guard treats a provably-expired credential as logged out.
- In E2E/cookie mode the crossDomain plugin is disabled, so none of the optimistic behavior applies; guards always await the settled session.

If users report being stuck on a skeleton dashboard indefinitely, that means auth never settled — check Better Auth endpoint reachability (`*.convex.site`) rather than the guards.

## Complete social signup onboarding

After a successful sync, the backend can still require a signup-completion step. When that happens:

- the frontend redirects to `/confirm/social-signup-complete`
- the completion mutation is `auth.public.completeSocialSignupOnboarding`
- completion clears `socialSignupCompletionRequired`
- completion also sets `termsAcceptedAt` if the field is missing

The gate is enforced server-side, not just by the frontend redirect:

- auth sync (`backend/convex/auth/_impl/sync.ts`) only clears
  `socialSignupCompletionRequired` for an existing user when `termsAcceptedAt`
  is already set. A credential account appearing on the Better Auth side (for
  example through a password reset) no longer ends the gate on its own.
- `auth.public.setPassword` refuses with `AUTH_SET_PASSWORD_FAILED` while
  `socialSignupCompletionRequired` is `true`, so a direct API call cannot
  create a credential account to skip terms acceptance.

If a user returns to the completion screen repeatedly:

1. Check the `users` row for `socialSignupCompletionRequired`.
2. Check whether `termsAcceptedAt` is still missing.
3. Confirm that `completeSocialSignupOnboarding` succeeds from the client.

## Repair verification email links

`backend/convex/lib/better_auth.ts` installs the `verify-email-ott` plugin. That plugin adds a one-time token to verification redirects. The frontend then handles `/verify-email` and `/api/auth/verify-email`.

Use this checklist:

1. Confirm that the verification link lands on one of the supported routes in [Confirm the callback routes](#confirm-the-callback-routes).
2. Confirm that the link carries the expected one-time token when the flow requires it.
3. Confirm that `BETTER_AUTH_SECRET`, `AUTH_BASE_URL`, and `CONVEX_SITE_URL` are correct in the target environment.
4. Switch to [Email Delivery](./email-delivery.md) if the verification email itself never arrives.

## Fix provider linking or unlinking

The current mutations are:

- `auth.public.linkSocialAccount`
- `auth.public.unlinkSocialAccount`

The frontend returns to `/confirm/social-link` after the provider flow. If linking or unlinking fails:

1. Confirm that the user can still authenticate with the primary account.
2. Confirm that the provider returns to `/confirm/social-link`.
3. Check the mapped Convex error before you retry.

Unlinking records the audit action `account.provider.unlinked`. If the UI reports success but the audit trail never appears, investigate the audit path as a second problem.

## Reproduce the issue locally

Start the local app:

```bash
pnpm dev
```

Then verify the affected flow:

1. Confirm that the provider button appears.
2. Confirm that sign-in reaches `/confirm/social-signin`.
3. Confirm that password reset links land on `/confirm/password-reset`.
4. Confirm that email-change links land on `/confirm/email-change`.
5. Confirm that verification links land on `/confirm/verification`.
6. Confirm that account linking returns to `/confirm/social-link`.
