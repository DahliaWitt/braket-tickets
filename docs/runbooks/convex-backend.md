---
title: Convex Backend
category: Runbooks
order: 4
description: Incident response runbook — convex backend
access: public
---

# Convex Backend Incidents

This runbook is for engineers who support the Convex backend in production or preview. It assumes access to GitHub Actions, Convex Dashboard, and the backup host. Use it when deploys fail, functions throw, crons stop running, or data needs recovery.

Source of truth:

- `.github/workflows/deploy.yml`
- `.github/workflows/deploy-preview.yml`
- `backend/convex/crons.ts`
- `backend/convex/migrations.ts`
- `backend/convex/schema.ts`

Jump to:

- [Restore a failed Convex deploy](#restore-a-failed-convex-deploy)
- [Run a safe schema migration](#run-a-safe-schema-migration)
- [Investigate function errors](#investigate-function-errors)
- [Restore a failed cron job](#restore-a-failed-cron-job)
- [Restore data from backup](#restore-data-from-backup)

## Restore a failed Convex deploy

**Symptom:** `pnpm convex deploy` fails in CI, or functions do not update after a push to `main`. The deploy workflow runs that command from the repo root.

Start with these checks:

1. Check the failing `deploy-convex` or `deploy-convex-dev` job in GitHub Actions.
2. Read the first deploy error in the job output.
3. Classify the failure before you change code or secrets.

For manual dev deploy commands, including the destructive dev-data reset path for schema-narrowing changes, use [Deployment & CI: Run a manual deploy](./deployment-ci.md#run-a-manual-deploy).

The table below lists the common deploy failures:

| Cause              | Fix                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Schema validation  | See [Run a safe schema migration](#run-a-safe-schema-migration)                                   |
| Bundle error       | Fix the code error, push again                                                                    |
| Deploy key invalid | Regenerate in Convex Dashboard → Settings → Deploy Keys, update `CONVEX_DEPLOY_KEY` GitHub secret |
| Rate limit         | Wait 5 minutes, re-run the GitHub Action                                                          |

### Roll back with a revert commit

Convex does not have a built-in "rollback to previous deployment" command. To rollback:

1. Find the last known good commit: `git log --oneline main`
2. Create a revert commit: `git revert <bad-commit-sha>`
3. Push to main — CI will redeploy the reverted code
4. If the bad deployment included a schema change, you may need a migration from the next section

**Do NOT use `git reset --hard` or force-push to main.**

## Run a safe schema migration

**Symptom:** Deploy fails with "schema validation error" because a new required field was added to a table that has existing data.

### Use the two-phase deploy pattern

Adding a required field to an existing table requires two deploys:

1. **Phase 1:** Add the field as `v.optional(...)` in schema + backfill mutation
2. **Deploy Phase 1**, then run the backfill
3. **Phase 2:** Change the field to required (non-optional)
4. **Deploy Phase 2**

### Run the backfill with the right export path

Backfills in this repo are not uniform. Before running anything, read the exact file in `backend/convex/migrations/` and verify:

1. the exported function name
2. supported arguments
3. whether the function self-schedules with `ctx.scheduler.runAfter`
4. whether it supports `dryRun`

Verified examples from the current repo:

| Migration                    | Invocation                                                                                          | Notes                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Bearer token digest backfill | `pnpm convex run --prod migrations:runTokenDigestBackfills '{"dryRun":true}'` before the real run   | Uses `@convex-dev/migrations`; requires `TOKEN_DIGEST_SECRET` to be set first |
| Slug backfill                | `pnpm convex run --prod migrations/slug_backfill:backfillSlugs`                                     | No args; batches 100 organizers; self-schedules when more remain              |
| Community status backfill    | `pnpm convex run --prod migrations/community_status_backfill:run '{"dryRun":true}'`                 | Supports `dryRun` and `cursor`; returns `processed`, `updated`, `hasMore`     |
| Discord cleanup backfill     | `pnpm convex run --prod migrations/discord_cleanup_backfill:cleanDiscordFields '{"batchSize":100}'` | Supports `cursor` and `batchSize`; removes fields via `db.replace()`          |

### Bearer token digest migration

The token digest hardening migration moves app-owned bearer tokens from plaintext
fields to purpose-scoped HMAC digests. It covers admin invites, magic links,
guest sessions, marketing unsubscribe preferences, marketing tracking delivery
tokens, and legacy user email-change fields.

Before deploying or running the backfill:

1. Set `TOKEN_DIGEST_SECRET` in the target Convex environment. Use a new
   high-entropy secret per environment.
2. Confirm the widened schema is deployed: plaintext token fields are optional
   and corresponding `*Digest` fields/indexes exist.
3. Run a dry run:

```bash
pnpm convex run --prod migrations:runTokenDigestBackfills '{"dryRun":true}'
```

4. If the dry run succeeds, run the real migration:

```bash
pnpm convex run --prod migrations:runTokenDigestBackfills
```

5. Watch component progress:

```bash
pnpm convex run --prod --component migrations lib:getStatus --watch
```

6. Verify no app-owned plaintext token fields remain before a future schema
   narrowing deploy. Do not remove the legacy fallback code until this check is
   true in the target deployment.

Existing sent links keep working because lookups compute the digest from the
raw token presented by the URL. Newly sent unsubscribe emails use
`marketingUnsubscribeTokens` rows so future emails do not need recoverable raw
tokens on preference rows.

### Follow the operating rules

- If a migration supports `dryRun`, use it first.
- If a migration self-schedules, invoke it once and monitor logs instead of launching parallel copies.
- Do not invent `cursor`, `batchSize`, or `dryRun` arguments for a file that does not export them.
- Verify the target table after the backfill before tightening the schema in a second deploy.

### Recover after a failed schema deploy

If a deploy already failed due to a required field on existing data:

1. The failed deploy did NOT change production — the old code is still running
2. Fix the schema (make field optional), push, let CI deploy
3. Run backfill, then make field required in a follow-up

## Investigate function errors

**Symptom:** Users report backend failures, or function errors appear to be rising.

### Check the failing path

1. Search Sentry for the suspected `convex.function_name` or related error message.
2. Open matching events and read the sanitized Convex context to trace the failing path.
3. Check logs in Convex Dashboard if Sentry has no matching forwarded event.
4. If frontend capture is relevant, use Sentry for client-side context.

### Match the error to the likely cause

| Error Pattern                        | Likely Cause                     | Fix                                                                                                         |
| ------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| "Document not found"                 | Race condition or deleted data   | Check if a cron job is cleaning up data that's still referenced                                             |
| "Unauthorized"                       | Authorization check denied       | Check the user's role/permissions in the relevant community via `backend/convex/lib/access.ts` helpers      |
| "Rate limited"                       | Token bucket exhausted           | Check `backend/convex/lib/rate_limits.ts` for the limit config; may need to increase for legitimate traffic |
| "Function timeout"                   | Long-running query or action     | Check Convex Dashboard → Functions for execution time; optimize or split the function                       |
| OCC (Optimistic Concurrency Control) | Write contention on hot document | Multiple mutations writing to the same row simultaneously; add retry logic or redesign the write pattern    |

### Ask the frontend for debug logs

Users can enable frontend debug logging to help diagnose issues:

```javascript
// In browser console
localStorage.setItem('debug', 'verbose');
// Refresh page, reproduce issue, share console output
```

## Restore a failed cron job

**Symptom:** Scheduled tasks are not running (expired orders not releasing, guest sessions persisting, digests not sent).

### Check the cron state

1. Check Convex Dashboard → Crons for execution status and last run time
2. Check Convex Dashboard → Logs filtered to the cron function name

### Use the current cron reference

| Cron                                   | Schedule         | Monitors                                                                   |
| -------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| Cleanup old admin audit logs           | Daily            | Admin audit trail growth and retention                                     |
| Cleanup stale resale listings          | Every 30 minutes | Resale listings that have expired or become invalid                        |
| Cleanup expired guest sessions         | Hourly           | `guest_sessions` table, sessions past 24h                                  |
| Process scheduled Stripe payouts       | Daily            | Queues a bounded batch of payout-eligible events into the payout workpool  |
| Cleanup stale email dedup keys         | Every 6 hours    | `emailDedup` table, keys older than 24h                                    |
| Send daily vetting digests             | Hourly           | New vetting submissions for community admins                               |
| Cleanup old email delivery failures    | Daily            | `emailDeliveryFailures` rows older than 30 days                            |
| Cleanup Resend component email records | Daily            | Resend component delivery metadata after provider status retention windows |

Expired ticket orders are released by the order expiry path, not by a cron. If that path is broken, investigate `orders:expire` and the Stripe checkout expiry handler.

### Resume the cron path

Convex crons are part of the deployment — they cannot be individually restarted. If a cron is failing:

1. Check the error in Convex Logs
2. Fix the underlying function code
3. Deploy the fix — the cron will resume on its next scheduled run

If you need to run a cron function manually, look up the export path that `backend/convex/crons.ts` references, then run that export through the backend package. For example, the hourly digest cron maps to:

```bash
pnpm convex run --prod notification_digests:sendDailyDigests
```

## Restore data from backup

**Symptom:** Data corruption or accidental deletion requires restoring from backup.

### Recovery policy

Treat production restore as incident response, not routine maintenance. Preserve the current production state first, prove the candidate backup in a temporary or non-production deployment, and prefer the narrowest repair that fixes the incident. A full production `--replace-all` import is a last-resort rollback because it replaces production with an older snapshot and discards all production writes after that backup.

### Preserve current production first

Before inspecting old backups or making repair changes, capture the current production deployment, including file storage:

```bash
pnpm convex export --prod --include-file-storage --path /tmp/convex-prod-before-INCIDENT-$(date -u +%Y%m%dT%H%M%SZ).zip
```

Copy that file somewhere durable before continuing.

### Locate a candidate backup

Backups are stored on the self-hosted NAS at `/mnt/user/appdata/braket-tickets/convex-backups/`. The `convex-backup` Docker service runs daily, exporting the full Convex database including file storage.

If you are on the backup host, list available backup artifacts:

```bash
ls -la /mnt/user/appdata/braket-tickets/convex-backups/
# Files named: convex-prod-YYYYMMDDTHHMMSSZ.zip
```

Choose the backup closest to, but before, the incident. Keep the NAS path as the private source of backup artifacts; copy the selected zip to a local working path before using it in CLI commands.

### Restore into a temporary deployment first

Import the candidate backup into a temporary or otherwise non-production Convex deployment. Replace `TEMP_DEPLOYMENT` with the deployment name or ref selected for the incident rehearsal.

```bash
pnpm convex import --deployment TEMP_DEPLOYMENT --replace-all /path/to/convex-prod-TIMESTAMP.zip
```

This `--replace-all` is allowed only because the target is temporary/non-production. Verify the candidate there before touching production:

1. Open the temporary deployment in Convex Dashboard.
2. Check the affected tables, documents, and file storage references.
3. Compare the candidate state with the preserved production export and the incident timeline.
4. Decide the smallest repair that fixes production.

### Prefer narrow repair

Prefer application-level repair through existing Convex mutations/actions or a purpose-built incident repair function that changes only the affected documents. Record the exact document IDs, table names, and before/after state in the incident notes.

If a table-level import is the smallest acceptable repair, extract that table from the verified snapshot and use `--table` with an explicit format and either `--append` or `--replace`:

```bash
pnpm convex import --prod --table TABLE_NAME --format jsonLines --append /path/to/TABLE_NAME/documents.jsonl
```

Use `--replace` instead of `--append` only after confirming that replacing every document in that table is acceptable:

```bash
pnpm convex import --prod --table TABLE_NAME --format jsonLines --replace /path/to/TABLE_NAME/documents.jsonl
```

Do not use table import as a shortcut when a smaller application-level repair is possible.

### Last resort: full production rollback

Only run a full production replacement after explicit incident approval. The approver must accept downtime, loss of every production write after the selected backup, and the need to re-run or manually repair any external side effects that happened after the backup, such as payment, email, or webhook state.

With that approval recorded, run:

```bash
pnpm convex import --prod --replace-all /path/to/convex-prod-TIMESTAMP.zip
```

After the import, verify key tables, file storage, auth-critical flows, event purchase state, and organizer/admin access in Convex Dashboard and the app.

### Check backup health

Verify the backup container is running:

```bash
docker ps | grep convex-backup
docker compose -f ops/docker-compose.yml logs convex-backup --tail 20
```

If the container is not running, check Docker Compose on the NAS.
