---
title: Secret Rotation
category: Runbooks
order: 12
description: Incident response runbook — secret rotation
access: public
---

# Secret Rotation

This runbook is for engineers who rotate production or preview credentials. It assumes access to the provider dashboard, Doppler, and the GitHub environment secrets used by the deploy workflows. Use it for planned maintenance during a low-traffic window.

Store secrets in the right place before you rotate anything:

| Secret class                              | Source of truth                                          |
| ----------------------------------------- | -------------------------------------------------------- |
| Runtime values that sync into Convex      | Doppler `prd` or `stg`                                   |
| Deploy credentials used by GitHub Actions | GitHub `production` or `development` environment secrets |

## Rotate Stripe keys

### Rotate `STRIPE_SECRET_KEY`

1. Go to Stripe Dashboard -> Developers -> API Keys.
2. Roll the secret key. Stripe keeps the old and new keys valid for a short overlap period.
3. Update `STRIPE_SECRET_KEY` in Doppler `prd`.
4. Run `DOPPLER_CONFIG=prd pnpm sync:env:prod`.
5. Verify with a controlled live-mode checkout or the next production payment smoke test.

### Rotate Stripe webhook secrets

The app uses three webhook secrets:

- `STRIPE_WEBHOOK_SECRET` for platform events
- `STRIPE_WEBHOOK_SECRET_CONNECT` for connected-account v1 snapshot events
- `STRIPE_WEBHOOK_SECRET_V2_EVENTS` for Accounts V2 event destinations

To rotate either secret:

1. Go to Stripe Dashboard -> Developers -> Webhooks.
2. Select the endpoint and roll the secret.
3. Update the secret in Doppler `prd`.
4. Run `DOPPLER_CONFIG=prd pnpm sync:env:prod`.
5. Confirm delivery in Stripe Dashboard while the overlap window is still open.

### Rotate `STRIPE_PUBLISHABLE_KEY`

1. Update `STRIPE_PUBLISHABLE_KEY` in Doppler `prd`.
2. Trigger a frontend redeploy.
3. Verify that the next production checkout loads Stripe.js and opens Embedded Checkout.

If you rotate test-mode Stripe credentials for preview or sandbox work, repeat the same process in Doppler `stg` and rerun the matching preview or sandbox checks.

## Rotate Resend email credentials

1. Go to Resend Dashboard -> API Keys.
2. Create a new API key.
3. Update `RESEND_API_KEY` in Doppler `prd`.
4. Run `DOPPLER_CONFIG=prd pnpm sync:env:prod`.
5. Verify with a low-risk production email flow, such as a controlled password-reset or verification send.
6. Delete the old API key in Resend Dashboard.

## Rotate Gmail SMTP fallback credentials

1. Create or rotate the Google Workspace app password for the fallback sender.
2. Update `SMTP_USER` and `SMTP_PASS` in Doppler `prd`.
3. Run `DOPPLER_CONFIG=prd pnpm sync:env:prod`.
4. Verify a controlled critical email flow while Resend fallback is forced in staging first.

## Rotate the Convex deploy key

1. Generate a new deploy key in Convex Dashboard -> Settings -> Deploy Keys.
2. Update `CONVEX_DEPLOY_KEY` in the GitHub environment secrets that use it:
   - `production` for `.github/workflows/deploy.yml`
   - `development` for `.github/workflows/deploy-preview.yml` if the preview workflow uses the same key
3. Rerun the affected deploy workflow.
4. Delete the old key in Convex Dashboard after the new secret works.

## Rotate the Cloudflare deploy token

1. Go to Cloudflare Dashboard -> My Profile -> API Tokens.
2. Create a new token with `Cloudflare Pages: Edit`.
3. Update `CLOUDFLARE_API_TOKEN` in the GitHub environment secret that the affected workflow uses:
   - `production` for `.github/workflows/deploy.yml`
   - `development` for `.github/workflows/deploy-preview.yml`
4. Trigger the matching frontend deploy and confirm it succeeds.

## Rotate Sentry keys

1. Generate the new key in the provider dashboard.
2. Update the value in Doppler `prd`.
3. Redeploy the frontend if the key is embedded in the build.
4. Run `DOPPLER_CONFIG=prd pnpm sync:env:prod` for backend keys.

## Rotate the bearer token digest secret

`TOKEN_DIGEST_SECRET` keys HMAC digests for app-owned bearer tokens stored in
Convex. It is required before deploying token digest code or running
`migrations:runTokenDigestBackfills`.

Routine rotation is not a simple overwrite. Once plaintext tokens have been
removed, existing long-lived links cannot be re-digested without the raw token
from the user's URL. For emergency rotation:

1. Add dual-secret lookup support in code for the old and new secret.
2. Deploy that compatibility code.
3. Regenerate or expire long-lived token classes by product flow:
   - create replacement magic links/admin invites
   - let guest sessions expire or force rotation through the resume flow
   - issue new unsubscribe-link tokens on future email sends
4. Remove the old-secret fallback only after the old links are expired or
   intentionally invalidated.

Do not replace `TOKEN_DIGEST_SECRET` in production without a compatibility
deploy, or existing digest-only links will stop resolving.

## Use the post-rotation checklist

After you rotate any secret:

- [ ] Update Doppler if the secret is a runtime value.
- [ ] Sync Convex if the backend reads the secret at runtime.
- [ ] Update the GitHub environment secret if a deploy workflow reads the secret.
- [ ] Redeploy the frontend if the build embeds the secret.
- [ ] Revoke or delete the old key in the provider dashboard.
- [ ] Verify the affected flow before you close the change.
