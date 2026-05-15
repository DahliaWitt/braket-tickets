---
title: Deployment & CI
category: Runbooks
order: 5
description: Incident response runbook — deployment & ci
access: public
---

# Deployment & CI Incidents

This runbook is for engineers who troubleshoot CI or deploy failures. It assumes access to GitHub Actions, Cloudflare Pages, and the GitHub environment secrets used by the deploy workflows. Use it when CI fails, a deploy is skipped, or the frontend or backend does not update after a push.

Source of truth:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/deploy-preview.yml`
- `.github/workflows/release.yml`
- `.github/workflows/release-automerge.yml`
- `ops/docker-compose.yml`

Jump to:

- [Fix a failing CI job](#fix-a-failing-ci-job)
- [Fix Release Please automation](#fix-release-please-automation)
- [Check self-hosted runner capacity](#check-self-hosted-runner-capacity)
- [Explain why a deploy was skipped](#explain-why-a-deploy-was-skipped)
- [Restore a failed Convex deploy](#restore-a-failed-convex-deploy)
- [Restore a failed frontend deploy](#restore-a-failed-frontend-deploy)
- [Run a manual deploy](#run-a-manual-deploy)
- [Restore observability services](#restore-observability-services)
- [Roll back with a revert commit](#roll-back-with-a-revert-commit)
- [Run CI workflows locally with act](#run-ci-workflows-locally-with-act)

## Pipeline Map

| Workflow                   | Trigger                                                                                              | Jobs                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `CI`                       | Pushes to `main` or `develop`; pull requests targeting `main` or `develop`                           | `lint`, `test`, `stripe-contracts`, `build`, `storybook`, `e2e-check`, conditional `e2e`, branch-gated deploy call |
| `Release`                  | Pushes to `main`                                                                                     | Creates GitHub releases with `GITHUB_TOKEN` and opens or updates Release Please PRs with `RELEASE_PLEASE_TOKEN`    |
| `Release Automerge`        | Release Please pull requests targeting `main`                                                        | Validates the release PR branch, title, author, and changed files, then enables squash auto-merge                  |
| `Deploy to Production`     | Reusable workflow called from a successful `CI` push run on `main`                                   | `changes`, `deploy-convex`, `deploy-frontend`, `deploy-observability`, `record-deployment`                         |
| `Deploy Preview (develop)` | Reusable workflow called from a successful `CI` push run on `develop`, or manual `workflow_dispatch` | `changes`, `deploy-convex-dev`, `deploy-frontend-preview`, `deploy-observability-dev`, `record-deployment`         |

PRs do not deploy. Automatic deploys use `workflow_run` and the deploy workflows require the completed CI run to be a successful `push` event on `main` or `develop`. Pull request CI completions can never pass the deploy-context branch/event guard.

GitHub Actions jobs that need environment-scoped secrets use the selected GitHub environment. CI and component deploy jobs set `deployment: false` so they can read those secrets without adding entries to the repository Deployments sidebar. Only the final `record-deployment` job in each deploy workflow creates the GitHub Deployment record. That job runs after backend, frontend, and observability work and exits with the deploy result, so the Deployment record is successful only when the deploy workflow succeeds.

When troubleshooting automatic deploys, start from the parent `CI` run on the branch push, confirm it completed successfully, then open the separate `Deploy Preview (develop)` or `Deploy to Production` workflow run for deploy logs.

## Check self-hosted runner capacity

The repository uses five self-hosted GitHub Actions runners on the Whiterose host:

- `whiterose_1`
- `whiterose_2`
- `whiterose_3`
- `whiterose_4`
- `whiterose_5`

On Whiterose, the runner fleet is managed by the host-local Unraid compose project at `/boot/config/plugins/compose.manager/projects/github-runner/docker-compose.yml`. The containers are named `github-runner-1` through `github-runner-5`, use the `braket-runner:latest` image, and share the Docker socket plus cached `pnpm` and Playwright browser volumes.

Check GitHub registration state from a local shell with repository access:

```bash
gh api repos/DahliaWitt/braket-tickets/actions/runners --paginate \
  --jq '.runners[] | [.name,.status,.busy,([.labels[].name]|join(","))] | @tsv'
```

Check host state over SSH:

```bash
ssh whiterose 'cd /boot/config/plugins/compose.manager/projects/github-runner && docker compose ps'
ssh whiterose 'docker stats --no-stream github-runner-1 github-runner-2 github-runner-3 github-runner-4 github-runner-5'
ssh whiterose 'uptime && free -h && df -h /var/lib/docker /mnt/user /'
```

If a new runner container starts but GitHub rejects it with `The runner registration has been deleted from the server, please re-configure`, remove only the affected new runner container, clear that runner's persistent volume, and recreate it from the compose project. Do not clear volumes for active runners that may be running jobs.

## Fix Release Please automation

The `Release` workflow runs on pushes to `main` and sets `target-branch: main` so Release Please does not fall back to the repository default branch. It splits Release Please into two steps: the default `GITHUB_TOKEN` creates GitHub releases, and `RELEASE_PLEASE_TOKEN` opens or updates Release Please PRs so those PRs can trigger follow-up workflows. The token needs repository-scoped `Contents: Read and write`, `Pull requests: Read and write`, and `Issues: Read and write` permissions. If release creation fails with `Resource not accessible by personal access token`, confirm the workflow is still using the split-token shape instead of sending `RELEASE_PLEASE_TOKEN` to the create-release path; GitHub documents `Contents: Read and write` as required for the create-release endpoint.

The repository Actions workflow permission must allow GitHub Actions to create and approve pull requests. Verify it with:

```bash
gh api repos/DahliaWitt/braket-tickets/actions/permissions/workflow --jq '.'
```

Expected values:

```json
{
  "default_workflow_permissions": "write",
  "can_approve_pull_request_reviews": true
}
```

The repository auto-merge setting must also be enabled because `Release Automerge` runs `gh pr merge --auto`:

```bash
gh api repos/DahliaWitt/braket-tickets --jq '{allow_auto_merge,default_branch}'
```

Release Please reads conventional commits from `main` history when it builds the release pull request body and `CHANGELOG.md`. This repository uses a Git Flow-style branch model, so promotion PRs from `develop` to `main` must preserve branch ancestry with merge commits. Feature PRs into `develop` should use squash merge with a curated conventional PR title. Promotion PRs into `main` should use a merge commit, not squash or rebase, and their titles should be non-releasable, for example `chore(release): promote develop to main`.

The repository merge settings are part of the Release Please contract:

- Merge commits are enabled so `develop` can be promoted to `main` without rewriting commit SHAs.
- Rebase merges are disabled because they rewrite `develop` commits on `main` and make later `develop` -> `main` PRs look much larger than they are.
- Squash merges stay enabled for feature PRs into `develop`.
- Merge and squash commit bodies are blank so Release Please does not parse duplicate conventional commit messages from PR bodies or branch commit lists.

Verify the merge policy with:

```bash
gh api repos/DahliaWitt/braket-tickets \
  --jq '{allow_merge_commit,allow_squash_merge,allow_rebase_merge,merge_commit_title,merge_commit_message,squash_merge_commit_title,squash_merge_commit_message}'
```

Expected values:

```json
{
  "allow_merge_commit": true,
  "allow_squash_merge": true,
  "allow_rebase_merge": false,
  "merge_commit_title": "PR_TITLE",
  "merge_commit_message": "BLANK",
  "squash_merge_commit_title": "PR_TITLE",
  "squash_merge_commit_message": "BLANK"
}
```

## Fix a failing CI job

### `lint`

The `lint` job runs these checks:

- `pnpm check:convex-generated`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm check:convex-logging`
- `ifttt-lint` against the merge diff

GitHub Actions runs that freshness gate with the job's selected GitHub environment
(`development` for `develop` and preview PRs, `production` for `main` and production PRs)
and expects `CONVEX_DEPLOYMENT` to be present as an environment-scoped GitHub variable.
That variable is Doppler-synced and must exist before `pnpm check:convex-generated`
can resolve the existing Convex deployment.

Local repro:

```bash
pnpm check:convex-generated
pnpm lint
pnpm typecheck
pnpm check:convex-logging
```

If the failure is the file-coupling gate, reproduce it with the same pattern used in CI:

```bash
BASE_SHA=<base_sha_from_pr_or_push>
MERGE_BASE=$(git merge-base HEAD "${BASE_SHA:-HEAD~1}" 2>/dev/null || echo "HEAD~1")
git diff "$MERGE_BASE" HEAD | pnpm exec ifttt-lint -
```

### `test`

The `test` job runs frontend and Convex unit suites plus coverage assertions.

Local repro:

```bash
pnpm test:frontend
pnpm test:convex
```

If coverage artifacts are missing in CI, start by fixing the underlying test failure. The workflow fails hard when `frontend/coverage/coverage-final.json` or `backend/coverage/coverage-final.json` is not emitted.

### `stripe-contracts`

The Stripe contract lane is pinned to the GitHub `development` environment and runs:

```bash
pnpm test:convex:sandbox:preflight
pnpm test:convex:sandbox
```

If this job fails, treat it as a sandbox credential, fixture, or contract-drift problem, not a production payment incident.

### `build`

The frontend build job runs in `frontend/` and executes:

```bash
pnpm build --stats-json
pnpm exec size-limit --json
```

The size-limit report has two entries. Angular CLI budgets in `frontend/angular.json` still enforce the complete initial chunk set.

- `Braket Tickets Root Entrypoints`: `main*.js` plus `styles*.css`, brotlied. Use this to catch regressions in the root entrypoint assets.
- `Braket Tickets Total JS/CSS`: all emitted JavaScript and CSS, brotlied. This includes lazy route chunks for admin, docs, scanner, payment, and export flows.

This CI build job only injects `CONVEX_URL`, `SQUARE_APPLICATION_ID`, and `SQUARE_LOCATION_ID`. It is a build validation step, not the production deploy build. If the deploy build later fails, switch to [Restore a failed frontend deploy](#restore-a-failed-frontend-deploy) and check the deploy workflow secrets there.

### `e2e-check` and `e2e`

`e2e-check` decides whether the E2E suite runs at all:

```bash
npx tsx scripts/run-affected-e2e.ts --check-only
```

If `e2e` is skipped unexpectedly, inspect the `e2e-check` output first. The deploy path is not blocked by a skipped `e2e` job when the gate decides nothing relevant changed.

## Explain why a deploy was skipped

If an automatic deploy never started or the expected job is marked `skipped`, check these conditions first:

1. The parent `CI` run must have succeeded.
2. The triggering event must be a branch push, not a pull request.
3. The branch must be `main` for production or `develop` for preview.
4. The deploy workflow's `deploy-context` job must have resolved the expected branch (`main` for production, `develop` for preview).
5. The automatic deploy path forces all deploy slices after CI success. Manual deploys can still use `force_all=false` for targeted recovery.

Automatic deploys force every deploy slice after CI succeeds. The slice detector is only relevant for manual recovery runs with `force_all=false`:

| Slice           | Files that trigger it                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend`       | `backend/convex/**`, `convex.json`, `backend/package.json`, `backend/scripts/**`, `shared/**`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` |
| `frontend`      | `frontend/**`, `shared/**`, `package.json`, `pnpm-lock.yaml`                                                                                           |
| `observability` | `ops/**`, `shared/log-sanitizer.mjs`                                                                                                                   |

Manual targeted deploys also force all slices when their own orchestration changes:

- production: `.github/workflows/ci.yml` or `.github/workflows/deploy.yml`
- preview: `.github/workflows/ci.yml` or `.github/workflows/deploy-preview.yml`

If the wrong slice was skipped during a manual targeted run, fix the slice-detection logic in the workflow instead of force-running an unrelated deploy step.

## Restore a failed Convex deploy

Production uses `deploy-convex`; preview uses `deploy-convex-dev`. The production job sets `BRAKET_DEPLOY_ENV=production` before env sync so `backend/scripts/sync-env.ts` can distinguish the GitHub production environment from generic CI. Both jobs:

1. install dependencies
2. validate `ALLOW_LOCALHOST_CORS`
3. sync runtime env vars with `backend/scripts/sync-env.ts`
4. run `pnpm convex deploy` from the repo root

Common failure modes:

| Symptom                             | Verified cause path                                                                                                                       | Resolution                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ALLOW_LOCALHOST_CORS` safety abort | workflow guard in `deploy.yml` / `deploy-preview.yml`                                                                                     | Set `ALLOW_LOCALHOST_CORS` false in the target GitHub environment                          |
| env sync step fails                 | `backend/scripts/sync-env.ts`, missing `BRAKET_DEPLOY_ENV=production`, or missing GitHub environment secret such as `TOKEN_DIGEST_SECRET` | Fix the workflow env, secret, or allowlist mismatch, then rerun the workflow               |
| `pnpm convex deploy` fails          | schema or function problem                                                                                                                | Follow [Convex Backend](./convex-backend.md)                                               |
| deploy key invalid                  | `CONVEX_DEPLOY_KEY` in GitHub environment                                                                                                 | Rotate the GitHub environment secret; it is not synced through the Convex runtime env path |

## Restore a failed frontend deploy

Production uses:

```bash
pnpm wrangler pages deploy dist/frontend/browser --project-name=braket-tickets-frontend --branch=main
```

Preview uses:

```bash
pnpm wrangler pages deploy dist/frontend/browser --project-name=braket-tickets-frontend --branch=develop
```

Build step differences:

- production runs `pnpm build`
- preview runs `pnpm build:preview`

Common failure modes:

| Symptom                         | Likely source                                                              | Resolution                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| build fails before Pages deploy | frontend build or injected env mismatch                                    | Reproduce from `frontend/` with the same build command, then fix code or the GitHub environment secret                                    |
| `wrangler pages deploy` fails   | `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` or Cloudflare Pages issue | Fix the GitHub environment secret or retry after confirming Cloudflare is healthy                                                         |
| preview URL seems wrong         | custom dev domain or direct Pages branch URL mismatch                      | Use `https://dev.community.braket.gay` as the canonical preview URL; check the direct Pages branch URL only to isolate Cloudflare routing |

## Run a manual deploy

Prefer the GitHub Actions deploy workflows for normal releases. Use these manual commands only when you need to recover a skipped or failed deploy and you have confirmed the target environment.

### Manually deploy Convex dev

The `stg` Doppler config maps to the GitHub `development` environment and the shared Convex dev deployment. `CONVEX_DEPLOY_KEY` selects the deployment, so do not add `--deployment` to these commands.

```bash
cd /Users/dwitt/Workspace/braket-tickets

DOPPLER_CONFIG=stg pnpm sync:env:dev
doppler run --project braket-tickets --config stg -- pnpm convex deploy
```

If a dev deploy is blocked by a schema narrowing and the team has decided to discard all dev data, clear the currently deployed data before deploying the narrowed schema:

```bash
cd /Users/dwitt/Workspace/braket-tickets

pnpm seed:dev:clear
doppler run --project braket-tickets --config stg -- pnpm convex deploy
pnpm seed:dev:fresh
```

Use `pnpm seed:dev:clear` for this recovery path. The script creates a short-lived token-gated seed session, clears the dev deployment through `backend/convex/seed/`, and removes `DEV_SEED`, `DEV_SEED_TOKEN`, and `DEV_SEED_EXPIRES_AT` before exiting. If the script reports failed env cleanup, run the printed cleanup commands before retrying or deploying.

### Manually deploy Angular preview

Preview deploys build with the `stg` Doppler config and publish to the `develop` Cloudflare Pages branch. The build needs frontend runtime variables from Doppler. The deploy step needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the shell, matching the GitHub `development` environment secrets.

```bash
cd /Users/dwitt/Workspace/braket-tickets

DOPPLER_CONFIG=stg pnpm --filter frontend build:preview
cd frontend
pnpm wrangler pages deploy dist/frontend/browser --project-name=braket-tickets-frontend --branch=develop
```

If the Cloudflare credentials are stored in Doppler for your local operator account, wrap only the deploy command:

```bash
doppler run --project braket-tickets --config stg -- pnpm wrangler pages deploy dist/frontend/browser --project-name=braket-tickets-frontend --branch=develop
```

### Manually deploy Angular production

Production deploys build with the `prd` Doppler config and publish to the `main` Cloudflare Pages branch. Confirm the production Convex URL and Stripe publishable key before deploying.

```bash
cd /Users/dwitt/Workspace/braket-tickets

DOPPLER_CONFIG=prd pnpm --filter frontend build
cd frontend
pnpm wrangler pages deploy dist/frontend/browser --project-name=braket-tickets-frontend --branch=main
```

Use the same Cloudflare credential rules as preview: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` must come from an approved secret source before the `wrangler pages deploy` command runs.

## Restore observability services

Production deploy uses `ops/docker-compose.yml` and manages:

- `convex-log-forwarder`
- `convex-backup`

Preview/dev observability uses the same compose file with profile `dev-observability` and manages:

- `convex-log-forwarder-dev`

The observability deploy jobs pass the compose-consumed values from the Doppler-synced GitHub environment into `docker compose`, including Sentry DSNs, sink settings, and production backup retention settings.

Manual status checks:

```bash
docker compose -f ops/docker-compose.yml ps
docker compose -f ops/docker-compose.yml --profile dev-observability ps
```

The workflows use `up -d --build` when observability files changed, and `up -d` when a service is merely missing or offline.

If production observability is degraded, confirm the backup directory exists first:

```bash
ls -ld /mnt/user/appdata/braket-tickets/convex-backups
```

## Roll back with a revert commit

There is no separate deployment rollback workflow in this repo. The verified recovery path is:

1. identify the bad commit
2. create a revert commit
3. push to the same branch
4. let `CI` and the normal deploy workflow redeploy the reverted code

Do not force-push or bypass the existing workflows.

## Run CI workflows locally with act

[`act`](https://github.com/nektos/act) runs GitHub Actions workflows locally inside Docker containers. It is useful for validating workflow syntax, testing job logic, and iterating on CI changes without pushing.

### Prerequisites

- Docker Desktop running
- `act` installed: `brew install act`

### Configuration

The repo ships three files:

| File                     | Tracked | Purpose                                                                   |
| ------------------------ | ------- | ------------------------------------------------------------------------- |
| `.actrc`                 | yes     | Default flags: maps `self-hosted` to the custom `braket-act-runner` image |
| `.github/act/Dockerfile` | yes     | Extends `catthehacker/ubuntu:act-latest` with pnpm via corepack           |
| `.act.secrets`           | no      | Local secrets (copy from `.act.secrets.example`)                          |

On Apple Silicon Macs, `.actrc` sets `--container-architecture linux/amd64` so the x86_64 Docker images run under Rosetta emulation.

### Build the runner image

The CI workflow runs on a self-hosted runner with pnpm pre-installed. The base `catthehacker/ubuntu:act-latest` image does not include pnpm, so a custom image is required:

```bash
docker build --platform linux/amd64 -t braket-act-runner:latest .github/act/
```

This only needs to be done once (or when the pnpm version in `package.json` changes).

### Create your secrets file

```bash
# Generate from Doppler (covers all CI jobs):
doppler secrets download --project braket-tickets --config stg --format env --no-file \
  | grep -E '^(RESEND_|EMAIL_|SMTP_|CONVEX_DEPLOY|CODECOV|STRIPE_SECRET_KEY|STRIPE_WEBHOOK)' > .act.secrets
```

### Common commands

```bash
# Dry-run: validate workflow structure without Docker
act -j e2e --dryrun -W .github/workflows/ci.yml

# Run a specific job
act -j lint -W .github/workflows/ci.yml --secret-file .act.secrets

# Run the E2E job (skips dependency gates)
act -j e2e -W .github/workflows/ci.yml --secret-file .act.secrets

# List all jobs in a workflow
act -l -W .github/workflows/ci.yml
```

### Known limitations

act is best suited for validating individual jobs (especially `lint`). Heavier jobs have constraints:

- **Apple Silicon OOM**: x86_64 emulation consumes significantly more memory. The Angular build (`build` job) is OOM-killed (exit 137) under default Docker Desktop memory limits. Increase Docker Desktop memory to 8+ GB or validate builds natively.
- **Codecov upload**: The `test` job's Codecov upload fails because act copies files instead of running `git clone`, so the container has no `.git` directory. The tests themselves pass — the failure is cosmetic.
- **Job dependencies**: act resolves `needs:` chains, so `-j e2e` also runs `lint`, `test`, `build`, and `e2e-check`. If any dependency job fails (even for act-specific reasons), downstream jobs are skipped.
- **WebKit system deps**: The Playwright install step (`playwright install --with-deps`) installs OS packages via apt; this works but adds ~60s to startup.
- **Email secrets**: Email verification tests need Resend credentials in `.act.secrets`; SMTP credentials are fallback-only.

**Recommended workflow**: use `act -j lint` for workflow validation, and native `ALL_BROWSERS=true pnpm test:e2e` for browser coverage.

For faster iteration on E2E changes, use the native local runner instead of act:

```bash
# Run all smoke tests across all browsers (same scope as CI)
ALL_BROWSERS=true pnpm test:e2e

# Or with the serve/run split for repeated runs
pnpm test:e2e:serve
ALL_BROWSERS=true pnpm test:e2e:run --grep @smoke
```
