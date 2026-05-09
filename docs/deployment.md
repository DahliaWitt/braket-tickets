---
title: Deployment
category: Operations
order: 2
description: Deploying to production and preview environments
access: public
---

# Deployment Guide

This guide covers deploying Braket Tickets to production and preview environments.

## Production Deployment

### Prerequisites

1. A Cloudflare account with Pages enabled
2. The `production` GitHub environment is synced from Doppler `prd`
3. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist in Doppler `prd`

### Cloudflare Pages (Frontend)

The Angular frontend deploys to Cloudflare Pages for global CDN distribution.

**Automatic deployment**: The `CI` workflow automatically calls `.github/workflows/deploy.yml` after a successful push run on `main`. The nested `deploy-frontend` job builds the Angular app and deploys `dist/frontend/browser` to Cloudflare Pages.

The Angular frontend is built as a client-rendered single-page app. Cloudflare Pages serves the compiled browser assets from `dist/frontend/browser` and falls back to the app shell for client-side routes.

**Manual deployment** (from `frontend/` directory):

```bash
# Login to Cloudflare (first time only)
pnpm wrangler login

# Build and deploy
doppler run -p braket-tickets -c prd -- pnpm run build
doppler run -p braket-tickets -c prd -- pnpm run deploy
```

**Configuration**: `frontend/wrangler.toml`:

```toml
name = "braket-tickets-frontend"
pages_build_output_dir = "dist/frontend/browser"
```

**Environment variables**: The build injects environment variables via Angular `--define`, using `frontend/scripts/runtime-config.ts` to map `process.env` into the public frontend config.

Keep these in Doppler `prd`:

- `CONVEX_URL`
- `STRIPE_PUBLISHABLE_KEY`
- `POSTHOG_KEY`
- `POSTHOG_HOST`
- `SENTRY_DSN`

Set `POSTHOG_HOST=/ingest` so analytics traffic goes through the Cloudflare Pages reverse proxy.

### Convex Backend

Convex is a serverless backend. Deployment happens automatically via GitHub Actions, which run `pnpm convex deploy` from the repo root.

**Environment variables**: Use the sync script to push Doppler-managed backend variables to Convex:

```bash
DOPPLER_CONFIG=prd pnpm sync:env:prod
```

The sync script pushes a deliberate backend allowlist and does not mirror every environment variable. GitHub Actions can run `pnpm sync:env:prod` directly because the production environment secrets are injected by GitHub.

For non-production Convex environment sync, run the dev sync script from a
Doppler-injected staging shell:

```bash
DOPPLER_CONFIG=stg pnpm sync:env:dev
```

---

## Preview Deployment (develop branch)

Preview deployments let you test changes before merging to `main`.

### How It Works

- **Production** (`main` branch) → `community.braket.gay`
- **Preview** (`develop` branch) → `dev.community.braket.gay`

Cloudflare Pages automatically creates preview URLs for non-production branches. The workflow deploys to the same project but specifies `--branch=develop`.

### Setup

1. **Create GitHub environment**: Go to Settings → Environments → New environment → "development"

2. **Add secrets to `development` environment**:

| Secret                  | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `CONVEX_DEPLOY_KEY`     | Deploy key for dev Convex (from Convex dashboard)                 |
| `CONVEX_URL`            | Dev Convex HTTP endpoint                                          |
| `CLOUDFLARE_API_TOKEN`  | Environment-scoped Cloudflare Pages token with least privilege    |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (can reuse from production)                 |
| `POSTHOG_KEY`           | PostHog project key (preview events tagged `environment=preview`) |
| `SENTRY_DSN`            | Sentry DSN (use separate preview project)                         |

Preview builds force `POSTHOG_HOST=/ingest` automatically. Use PostHog filters like `environment=preview` to keep preview traffic out of production dashboards.

3. **Convex dev deployment**: Get the deploy key from Convex Dashboard → dev deployment → Settings → Deploy Keys.

### Testing

```bash
git push origin develop
```

Check GitHub Actions for the `CI` run on `develop`, then expand the nested `Deploy Preview (develop)` workflow job. Once complete, access `https://dev.community.braket.gay`.

### Promoting to Production

```bash
git checkout main
git merge develop
git push origin main
```

This triggers `CI`, which then calls the production deployment workflow after the required jobs succeed.

---

## Sentry Configuration

Use separate Sentry projects for production and preview:

- `production` GitHub environment → production Sentry project
- `development` GitHub environment → preview Sentry project

Keep the secret name (`SENTRY_DSN`) the same in both environments. The app tags events with `environment=production` or `environment=preview`.
