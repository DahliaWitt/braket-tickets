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
- `frontend/public/_redirects`
- `frontend/public/_routes.json`
- `frontend/functions/asset-miss.ts`
- `frontend/functions/[[path]].ts`
- `frontend/functions/og-preview.ts`
- `frontend/wrangler.toml`
- `.github/workflows/deploy.yml`
- `.github/workflows/deploy-preview.yml`
- `frontend/package.json`
- `frontend/src/app/core/image-loader/braket-image-loader.ts`
- `frontend/src/app/app.config.ts` (`IMAGE_LOADER`, `IMAGE_CONFIG` providers)

Jump to:

- [Restore a blank or unreachable site](#restore-a-blank-or-unreachable-site)
- [Fix a frontend build or deploy failure](#fix-a-frontend-build-or-deploy-failure)
- [Fix CSP violations](#fix-csp-violations)
- [Restore the preview site](#restore-the-preview-site)
- [Event link OG previews](#event-link-og-previews)
- [Image transformations: dashboard configuration](#image-transformations-dashboard-configuration)
- [Image transformations: troubleshooting](#image-transformations-troubleshooting)

## Restore a blank or unreachable site

**Symptom:** `community.braket.gay` loads a blank page, an error page, or no page at all.

Check these items in order:

1. Check https://www.cloudflarestatus.com.
2. Check the latest production deployment in Cloudflare Pages.
3. Check https://status.convex.dev if the frontend loads but shows no data.
4. Check the browser console for JavaScript failures, CSP failures, or missing network requests.
5. Check Sentry for a spike in frontend errors.

The table below lists the common runtime causes:

| Symptom                      | Likely cause                               | Fix                                                                                                                   |
| ---------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Blank white page             | The JavaScript bundle did not load         | Check the latest Pages deployment and redeploy if needed                                                              |
| Page loads but no data       | The frontend cannot reach Convex           | Check the deployed `CONVEX_URL` and the Convex deployment health                                                      |
| CSP violation in the console | A CSP directive blocks a required resource | Check `frontend/public/_headers` and continue with [Fix CSP violations](#fix-csp-violations)                          |
| JavaScript MIME type error   | A stale hashed bundle URL returned HTML    | Check `frontend/functions/asset-miss.ts`; missing `*.js` and `*.css` assets must 404 instead of serving the SPA shell |
| `Application error`          | Angular failed during bootstrap            | Check Sentry for the stack trace                                                                                      |

If you need to redeploy unchanged frontend assets, use [Deployment & CI: Manually deploy Angular production](./deployment-ci.md#manually-deploy-angular-production). Rerunning the parent `CI` workflow on `main` only re-runs `deploy-frontend` when that run's `changes` job selected the frontend slice.

Cloudflare Pages keeps the Angular app fallback in `frontend/public/_redirects` so direct links to app routes, including unknown extensionless routes handled by Angular's not-found route, load the SPA shell. Stale hashed bundle requests such as `/chunk-OLD.js` would otherwise return `200 text/html`, which Safari reports as a JavaScript MIME type error. `frontend/public/_routes.json` routes root `*.js` and `*.css` requests through `frontend/functions/asset-miss.ts`; that function passes through real assets and returns 404 when the Pages asset binding falls back to HTML.

`frontend/public/_routes.json` also includes `/events/*`, which invokes the same Pages Function (`frontend/functions/[[path]].ts`) for `/events/:id` HTML shell requests so it can rewrite OG/Twitter meta tags for link unfurling — see [Event link OG previews](#event-link-og-previews). Without `/events/*` in the include list, the Function never runs for those paths and every `/events/:id` link unfurls with the static defaults from `frontend/src/index.html`.

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
- `connect-src` must include the Convex deployment URL and Stripe/Sentry endpoints
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

## Fix a stale static asset

**Symptom:** An image or audio file under `frontend/public/` was updated and deployed, but users still see the old version.

Static images and audio (`*.png`, `*.svg`, `*.webp`, `*.mp3`) are served with `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` (see `frontend/public/_headers`). They are not content-hashed, so browsers and the Cloudflare edge may serve a cached copy for up to 24 hours after a deploy, then revalidate in the background.

- If waiting up to a day is acceptable, do nothing.
- To propagate immediately, rename the file (and its references in code) so the URL changes — this is the expected workflow when replacing artwork.
- Hashed build outputs (`*.js`, `*.css`) are `immutable` and never go stale; `index.html` is `no-store`. The theme-init script is inlined in `index.html`, so it ships with every HTML response.

## Restore the preview site

**Symptom:** The current `develop` deployment is stale or broken.

Use `https://dev.community.braket.gay` for preview incidents. Use Cloudflare's direct Pages branch URL (`https://develop.braket-tickets-frontend.pages.dev`) only to distinguish a custom-domain routing problem from a Pages deployment problem.

Then check:

1. the latest `CI` run on `develop`, then the separate `Deploy Preview (develop)` workflow run
2. the frontend build output from `deploy-frontend-preview`
3. the Convex development deployment health

If the preview deploy pipeline is healthy but the site is stale, trigger a new preview deploy from GitHub Actions or push a no-op commit to `develop`:

```bash
git commit --allow-empty -m "chore: trigger preview redeploy"
git push origin develop
```

## Event link OG previews

**Symptom:** A link to `/events/:id` shared in Slack, Discord, iMessage, etc. unfurls with the generic Braket logo and homepage copy instead of the event's title, date, and flier.

The Pages Function chain is `frontend/functions/[[path]].ts` → [`frontend/functions/og-preview.ts`](../../frontend/functions/og-preview.ts) (`applyEventPreview`). For a GET request whose path matches `/events/:id` and whose asset response is the SPA HTML shell, it fetches `${CONVEX_SITE_URL}/api/events/{id}` (backend handler: `handleGetPublicEventPreview` in `backend/convex/http/_impl/events.ts`, rate-limited via the `getPublicEventPreview` bucket in `backend/convex/lib/rate_limits.ts`) and rewrites the shell's `<title>`, `og:title`, `og:description`, `og:url`, and — when the event has a poster — `og:image`/`og:image:alt` and `twitter:card` (upgraded from the static `summary` default to `summary_large_image`). See `frontend/src/index.html` for the static defaults this replaces.

This fetch has a 1.5s timeout (`AbortSignal.timeout`) and fails open on any error — a timeout, non-200, network failure, or malformed JSON all fall through to the untouched shell response, never a broken page. `_headers`-applied response headers (including CSP) are preserved on the rewritten response.

**Cache semantics — two layers:**

- The Convex endpoint sends `Cache-Control: public, max-age=300, stale-while-revalidate=600` (5 min fresh, 10 min stale-while-revalidate).
- The Function's outbound fetch also sets `cf: { cacheTtlByStatus: { "200-299": 300, "400-599": 0 }, cacheEverything: true }`, so a Cloudflare colo caches successful Convex responses for up to 300s independently of the browser-facing cache headers on the rewritten shell. Error statuses (including 404s for not-yet-published events) are never colo-cached — a draft that publishes starts unfurling correctly on the next fetch.

An event's title, date, or poster can take up to ~5 minutes to propagate into new unfurls after an edit, per the layers above.

**Config:** `CONVEX_SITE_URL` is set per environment in [`frontend/wrangler.toml`](../../frontend/wrangler.toml) — `[vars]` for production (`https://modest-impala-722.convex.site`), `[env.preview.vars]` for preview (`https://bright-swordfish-194.convex.site`). Once a Pages project defines `vars` in its Wrangler config file, that file becomes the source of truth and the same variable cannot also be set from the Pages dashboard ([Cloudflare docs](https://developers.cloudflare.com/pages/functions/wrangler-configuration/#source-of-truth)) — if `CONVEX_SITE_URL` looks wrong at runtime, the fix is in `wrangler.toml`, not the dashboard.

**Troubleshooting — event links unfurl with the generic logo:**

1. Confirm `/events/*` is present in `frontend/public/_routes.json`'s `include` list — without it the Function never runs for `/events/:id` requests.
2. Confirm `CONVEX_SITE_URL` in `frontend/wrangler.toml` (`[vars]` / `[env.preview.vars]`) points at the correct Convex deployment for the environment that served the broken unfurl.
3. Curl the Convex endpoint directly to isolate a backend problem from a Function problem:

   ```bash
   curl -i "https://modest-impala-722.convex.site/api/events/<event-id>"
   ```

   A 404 means the event id is wrong, or the event isn't published/public (the endpoint returns an identical 404 for missing and denied ids by design — see `backend/convex/http/_impl/events.ts`). A 429 means the `getPublicEventPreview` rate-limit bucket is exhausted; retry after the window. A non-JSON or unexpected-shape 200 body will also fail open in the Function — check the response against `PublicEventPreview` in `shared/contracts/public-event`.

4. If the endpoint returns a healthy preview but the unfurl is still stale, it's most likely the 5-minute Convex cache or the Function's 300s colo cache from step above — wait and re-share, or use the target platform's own cache-busting (e.g. append a query string) to force a fresh unfurl fetch.

## Image transformations: dashboard configuration

Event posters and community logos served on `community.braket.gay` and `dev.community.braket.gay` are transformed at the edge by Cloudflare Image Transformations (the URL-based `/cdn-cgi/image/` product). The Angular frontend wraps Convex storage URLs through the loader at [frontend/src/app/core/image-loader/braket-image-loader.ts](../../frontend/src/app/core/image-loader/braket-image-loader.ts), which produces URLs like:

```
https://community.braket.gay/cdn-cgi/image/format=auto,onerror=redirect,width=640/<convex-storage-url>
```

The loader passes through `data:`, `blob:`, `.svg`, and any non-`braket.gay` host (including `localhost` and bare `*.pages.dev`).

This runbook section assumes the dashboard configuration below has already been applied. If images stop loading, jump to [Image transformations: troubleshooting](#image-transformations-troubleshooting).

### One-time setup

Required dashboard config on the `braket.gay` zone. Cloudflare reorganizes its dashboard frequently, so these steps describe outcomes rather than exact click paths — the navigation prefix below was current as of May 2026 but may have shifted.

1. **Subscribe to the Images Free plan, then enable Transformations on the zone.**

   The zone-level Image Optimization tab (currently at `Speed → Settings → Image Optimization`) shows a **"Purchase Images Plan"** CTA on the Image Transformations card. This same CTA is the entry point for the Free tier even though the label implies payment — clicking it leads to a plan-selection screen where **Free** ($0/month, no card charge, errors instead of overage) is one of the options. After subscribing, the same Image Transformations card flips to a per-zone enable toggle.

   Free plan covers up to 5,000 unique transformations / month and counts account-wide (shared across every zone in the same Cloudflare account).

   If the plan-selection screen does NOT show a Free option, **stop** — that means Cloudflare's pricing model has changed and the runbook needs to be re-evaluated, not followed.

2. **Allow the Convex source origins.** Same screen → **Sources** → select **Specified origins** → add the production and staging Convex deployment hostnames:
   - `modest-impala-722.convex.cloud` (prod, behind `community.braket.gay`)
   - `bright-swordfish-194.convex.cloud` (staging, behind `dev.community.braket.gay`)

   Use the specific hostnames rather than `*.convex.cloud` — the wildcard would let any third-party Convex deployment burn the free-tier quota by routing transforms through this zone. If the Convex deployment is ever recreated (rare), update both this list and the curl example below.

3. **Set a usage notification (best-effort early warning).** Dashboard → **Notifications → Add** → product **Images** → trigger on `Images Transformations Usage`. Threshold: 1,000 transformations (early-warning at ~20% of free tier). This is the tripwire for a sibling project sharing the account budget; without it, free-tier exhaustion fails closed (the loader's `onerror=redirect` masks the failure as fallback to the original Convex URL — degraded but functional).

   **Caveat:** the "Images Transformations Usage" trigger may not be available on Free plan — Cloudflare gates some notification policies behind paid tiers. If the trigger isn't in the product list, this notification cannot be set; instead, spot-check usage manually at the zone-level Image Optimization page roughly weekly.

4. **Polish: no action needed on Free.** Polish requires the Pro plan and is automatically unavailable on Free (the dashboard shows "Upgrade to Pro" / "Requires Pro or higher" instead of a toggle). If the zone is ever upgraded to Pro or higher, **do NOT enable Polish on the same zone** — Polish and Image Transformations interact unpredictably (documented Cloudflare known issue).

After these steps, request a transformed image to verify:

```bash
curl -I -H 'Accept: image/avif,image/webp,image/*,*/*' \
  'https://community.braket.gay/cdn-cgi/image/format=auto,width=320/https://modest-impala-722.convex.cloud/api/storage/some-id'
```

The load-bearing assertion is `cf-resized: internal=ok/r` in the response headers — that header proves the transform pipeline ran. With the explicit `Accept` header above, `content-type` should also be `image/webp` (or `image/avif` on capable edges); without it, `curl` defaults to `Accept: */*` and Cloudflare may return the source's original format (often JPEG), which is correct behavior, not a failure. If you see `cf-not-resized: err=<code>` instead, jump to [troubleshooting](#image-transformations-troubleshooting) and look up the code.

### Cost & cap monitoring

- Free tier: 5,000 unique `(source, params)` combinations per calendar month. Cached transforms re-serve free of charge for the rest of the month.
- Beyond free tier: $0.50 / 1,000 unique transforms (Paid plan). NOT auto-enabled — overage on Free returns errors instead.
- Each call site uses the breakpoints `[320, 640, 1024, 1600]` (set in `IMAGE_CONFIG` in `app.config.ts`). Most posters generate at most 4 unique transforms.
- Monitor usage at the zone-level Image Optimization tab (`Speed → Settings → Image Optimization` as of May 2026) — the Image Transformations card shows transformations consumed / billing period once the plan is active.

## Image transformations: troubleshooting

### Symptom: image loads as the original Convex URL, no transform applied

**Possible causes (in order of likelihood):**

1. The user is on `localhost` or a bare `*.pages.dev` URL — the loader intentionally passes through. Verify by deploying to `dev.community.braket.gay` or production.
2. The image source is a `.svg`, `data:`, or `blob:` — these are passed through by design (vectors and inline data don't benefit from transformation).
3. Image Transformations is disabled on the zone. Re-check step 1 of [One-time setup](#one-time-setup).

### Symptom: HTTP 429, response header `cf-resized: err=9422` (free-tier exhausted)

The account-wide free tier has been exceeded. Behavior:

- Cached transforms keep serving from edge cache.
- New unique transforms return `9422`. **Because the loader includes `onerror=redirect`, the browser redirects to the original Convex URL** (degraded but functional, no broken `<img>` boxes).

**Fix:**

1. Check the account-wide usage at the dashboard (above). The cap is shared across every zone in the same Cloudflare account.
2. If the spike is from another project on the same account, isolate that project to its own Cloudflare account, or upgrade to the Images Paid plan ($0.50 / 1,000 transforms).
3. Confirm the `onerror=redirect` fallback is intact by inspecting a transform URL in DevTools — every URL should include the param.

### Symptom: HTTP 9524 ("could not perform resizing"), only on `pages.dev`

`/cdn-cgi/image/` does not work on raw `*.pages.dev` URLs. Use the custom domain (`dev.community.braket.gay` or `community.braket.gay`). The loader already filters for the `braket.gay` zone — this should not occur in normal operation.

### Symptom: HTTP 9524, even with allowlisted origin

Cloudflare community has documented intermittent `9524` failures on properly-allowlisted external origins ([Feb 2026 thread](https://community.cloudflare.com/t/image-transformations-cdn-cgi-image-returns-9524-for-all-external-images-on-zone/889637)). If this happens at scale:

1. Verify the source allowlist includes both `modest-impala-722.convex.cloud` (prod) and `bright-swordfish-194.convex.cloud` (staging) under **Specified origins**.
2. Open a Cloudflare support ticket; this is a known reliability issue.
3. Temporary mitigation: the `onerror=redirect` param means images degrade to original URLs rather than break.

### Symptom: poster looks visually wrong (text shifted, rendering altered)

Cloudflare community has documented rare cases where format-only AVIF/WebP transforms alter image content for >10MB JPEG sources ([Dec 2025 thread](https://community.cloudflare.com/t/image-resizing-format-only-transforms-alter-image-layout/868651)).

**Mitigation:** add an upload-side cap on poster dimensions (BRA-385 follow-up). Sub-10MB images do not exhibit this.

### Manually disable for a single image

If a specific image needs to bypass transformation (e.g., an animated WebP), use plain `<img src="...">` instead of `<img ngSrc="...">`. The loader is invoked only for `ngSrc`-bound images.

### Manually disable globally (rollback)

In `frontend/src/app/app.config.ts`, comment out the `IMAGE_LOADER` provider. The default Angular loader is a no-op and will pass `ngSrc` URLs through unchanged. Run `pnpm build` and redeploy.
