---
title: Frontend & CDN
category: Runbooks
order: 8
description: Incident response runbook — frontend & cdn
access: public
---

# Frontend & CDN Incidents

This runbook is for engineers or admins who troubleshoot the deployed Angular frontend. It assumes access to Cloudflare Pages, GitHub Actions, and Sentry. Use it when the site is blank, unreachable, blocked by CSP, or stale in preview. Use [Deployment & CI](./deployment-ci.md) for backend deploy failures or broader workflow failures.

Source of truth:

- `frontend/public/_headers`
- `.github/workflows/deploy.yml`
- `.github/workflows/deploy-preview.yml`
- `frontend/package.json`

Jump to:

- [Restore a blank or unreachable site](#restore-a-blank-or-unreachable-site)
- [Fix a frontend build or deploy failure](#fix-a-frontend-build-or-deploy-failure)
- [Fix CSP violations](#fix-csp-violations)
- [Restore the preview site](#restore-the-preview-site)

## Restore a blank or unreachable site

**Symptom:** `community.braket.gay` loads a blank page, an error page, or no page at all.

Check these items in order:

1. Check https://www.cloudflarestatus.com.
2. Check the latest production deployment in Cloudflare Pages.
3. Check https://status.convex.dev if the frontend loads but shows no data.
4. Check the browser console for JavaScript failures, CSP failures, or missing network requests.
5. Check Sentry for a spike in frontend errors.

The table below lists the common runtime causes:

| Symptom                      | Likely cause                               | Fix                                                                                          |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Blank white page             | The JavaScript bundle did not load         | Check the latest Pages deployment and redeploy if needed                                     |
| Page loads but no data       | The frontend cannot reach Convex           | Check the deployed `CONVEX_URL` and the Convex deployment health                             |
| CSP violation in the console | A CSP directive blocks a required resource | Check `frontend/public/_headers` and continue with [Fix CSP violations](#fix-csp-violations) |
| `Application error`          | Angular failed during bootstrap            | Check Sentry for the stack trace                                                             |

If you need to redeploy, rerun the production deploy workflow or rerun the `deploy-frontend` job path described in [Deployment & CI](./deployment-ci.md).

## Fix a frontend build or deploy failure

**Symptom:** The frontend fails to build in CI, or the production or preview deploy fails before the site updates.

For manual Angular preview or production deploy commands, use [Deployment & CI: Run a manual deploy](./deployment-ci.md#run-a-manual-deploy).

Use these checks:

1. Check the `build` job in `.github/workflows/ci.yml` for frontend build failures.
2. Check `deploy-frontend` in `.github/workflows/deploy.yml` for production deploy failures.
3. Check `deploy-frontend-preview` in `.github/workflows/deploy-preview.yml` for preview deploy failures.

Common causes:

| Cause                             | Fix                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| TypeScript or Angular build error | Fix the failing source file and rerun CI                                                  |
| Missing frontend build variable   | Check the GitHub environment secret that the workflow injects                             |
| Bundle-size regression            | Review recent imports and the frontend budget settings                                    |
| Cloudflare deploy failure         | Check `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the target GitHub environment |

## Fix CSP violations

**Symptom:** The browser console shows `Refused to load`, `Refused to connect`, or similar Content Security Policy errors.

The current CSP lives in `frontend/public/_headers`. These directives matter most during incident response:

- `style-src 'unsafe-inline'` is required due to Angular/Tailwind runtime styles
- `connect-src` must include the Convex deployment URL and Stripe/PostHog/Sentry endpoints
- Stripe Embedded Checkout requires `script-src` entries for `https://js.stripe.com` and `https://*.js.stripe.com`
- Stripe Connect embedded components require `script-src` and `frame-src` entries for `https://connect-js.stripe.com` (distinct hostname; not covered by `*.js.stripe.com`). See BRA-433.
- Stripe Embedded Checkout requires `frame-src` entries for `https://js.stripe.com`, `https://*.js.stripe.com`, and `https://hooks.stripe.com`
- `connect-src` must also include `https://api.stripe.com` for Stripe API calls
- Stripe 3DS authentication renders base64-encoded images inside the 3DS iframe; `img-src` must include `data:` and `blob:` to allow them (see BRA-329)
- Developer help page embeds privacy-enhanced YouTube; `frame-src` must include `https://www.youtube-nocookie.com` (see BRA-434)

If a third-party service is blocked:

1. Identify the blocked domain from the browser console error
2. Add it to the appropriate CSP directive in `frontend/public/_headers`
3. Redeploy the frontend

## Restore the preview site

**Symptom:** The current `develop` deployment is stale or broken.

Use `https://dev.community.braket.gay` for preview incidents. Use Cloudflare's direct Pages branch URL (`https://develop.braket-tickets-frontend.pages.dev`) only to distinguish a custom-domain routing problem from a Pages deployment problem.

Then check:

1. the latest `Deploy Preview (develop)` workflow run
2. the frontend build output from `deploy-frontend-preview`
3. the Convex development deployment health

If the preview deploy pipeline is healthy but the site is stale, trigger a new preview deploy from GitHub Actions or push a no-op commit to `develop`:

```bash
git commit --allow-empty -m "chore: trigger preview redeploy"
git push origin develop
```
