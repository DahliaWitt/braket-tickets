---
title: Observability
category: Runbooks
order: 10
description: Incident response runbook — observability
access: public
---

# Observability Incidents

This runbook is for engineers who troubleshoot monitoring, logging, backups, and analytics collection. It assumes access to the NAS host, Sentry, and PostHog. Use it when PostHog is not receiving Convex logs, alerts stop arriving, backups stop running, or frontend analytics disappear.

Source of truth:

- `ops/docker-compose.yml`
- `frontend/scripts/runtime-config.ts`
- `frontend/public/_headers`
- `frontend/functions/ingest/`
- `frontend/functions/monitor/proxy.ts`

Jump to:

- [Restore the log forwarder](#restore-the-log-forwarder)
- [Restore backups](#restore-backups)
- [Restore frontend error reporting](#restore-frontend-error-reporting)
- [Investigate PostHog gaps](#investigate-posthog-gaps)
- [Launch analytics dashboards](#launch-analytics-dashboards)
- [Launch analytics alerts](#launch-analytics-alerts)
- [Replay QA checklist](#replay-qa-checklist)

## Restore the log forwarder

**Symptom:** PostHog stops receiving Convex logs even though users report backend failures.

The `convex-log-forwarder` Docker service streams Convex logs to the provider selected by `CONVEX_LOG_SINK`. Supported values are `posthog`, `sentry`, `both`, and `none`. The profile service reads `CONVEX_DEV_LOG_SINK` for preview/dev and maps it to runtime sink config in the same container.

Before delivery, the forwarder sanitizes the log message, raw Convex line, and structured Convex payload with `shared/log-sanitizer.mjs`. This is defense-in-depth for runtime or third-party log lines that bypass the backend `logger` wrapper.

Use `both` when Convex logs should land in PostHog and Sentry at the same time. The forwarder attempts both deliveries before reporting a partial sink failure.

If PostHog ingest is degraded in production, set `CONVEX_LOG_SINK=sentry` in Doppler and rerun the production deploy workflow.
If using the preview/dev profile, set `CONVEX_DEV_LOG_SINK=sentry` in Doppler and rerun the preview deploy workflow.

### Check the forwarder

```bash
# Check container status
docker ps | grep convex-log-forwarder

# Check logs for errors
docker logs convex-log-forwarder --tail 50

# Check if the process is connected to Convex
docker logs convex-log-forwarder 2>&1 | grep -i "connect\|error\|disconnect"
```

### Match the failure to the cause

| Cause                         | Fix                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing PostHog project token | Set `POSTHOG_LOGS_PROJECT_TOKEN` (or `POSTHOG_DEV_LOGS_PROJECT_TOKEN`) in Doppler and rerun the matching deploy workflow                                                      |
| Missing Sentry DSN            | Set `SENTRY_DSN` in the target Doppler config when the selected sink is `sentry` or `both`                                                                                    |
| Sink misconfigured            | Confirm `CONVEX_LOG_SINK` / `CONVEX_DEV_LOG_SINK` is one of `posthog`, `sentry`, `both`, or `none`                                                                            |
| Dual forwarding required      | Set `CONVEX_LOG_SINK=both` and rerun production deploy, or set `CONVEX_DEV_LOG_SINK=both` and rerun preview deploy                                                            |
| Rollback to Sentry required   | Set `CONVEX_LOG_SINK=sentry` and rerun production deploy, or set `CONVEX_DEV_LOG_SINK=sentry` and rerun preview deploy                                                        |
| Container crashed             | `docker compose -f ops/docker-compose.yml up -d convex-log-forwarder` (prod) or `docker compose -f ops/docker-compose.yml up -d convex-log-forwarder-dev` (dev-observability) |
| Convex deploy key expired     | Rotate `CONVEX_DEPLOY_KEY` and restart the service                                                                                                                            |
| Network connectivity          | Check the NAS can reach Convex and your chosen sink endpoint                                                                                                                  |

### Restart the forwarder

```bash
# Restart the production forwarder
docker compose -f ops/docker-compose.yml restart convex-log-forwarder

# Restart the preview/dev forwarder
docker compose -f ops/docker-compose.yml restart convex-log-forwarder-dev

# If it keeps crashing, check the full logs:
docker logs convex-log-forwarder --since 1h

# Verify the next reproduced backend error reaches the configured sink
```

The forwarder keeps a 5000-entry in-memory dedup cache. A restart clears that cache, so the configured sink can receive a short spike of repeated errors after the service comes back.

---

## Restore backups

**Symptom:** No recent backups in `/mnt/user/appdata/braket-tickets/convex-backups/`, or the backup container is not running.

### Check the backup service

```bash
# Check container status
docker ps | grep convex-backup

# Check last backup timestamp
ls -lt /mnt/user/appdata/braket-tickets/convex-backups/ | head -5

# Check bind-mount ownership. The backup container writes as UID/GID 100:101.
ls -ldn /mnt/user/appdata/braket-tickets/convex-backups

# Check container logs
docker compose -f ops/docker-compose.yml logs convex-backup --tail 20
```

### Restart the backup path

```bash
# Restart the backup container
docker compose -f ops/docker-compose.yml up -d convex-backup

# Repair host bind-mount permissions if logs show EACCES writing /backups.
chown 100:101 /mnt/user/appdata/braket-tickets/convex-backups
chmod 0770 /mnt/user/appdata/braket-tickets/convex-backups

# Run an immediate manual backup
docker compose -f ops/docker-compose.yml exec convex-backup /app/scripts/convex-backup.sh
```

### Check retention

Backups older than 30 days are automatically deleted (`BACKUP_RETENTION_DAYS=30`). If you need to adjust retention, update the environment variable in `ops/docker-compose.yml`.

### Verify a backup file

```bash
# Check that a backup file is a valid zip
unzip -t /mnt/user/appdata/braket-tickets/convex-backups/convex-prod-TIMESTAMP.zip

# To fully verify, import into a test Convex project (do NOT import into production)
```

---

## Restore frontend error reporting

**Symptom:** Production users reporting errors but PostHog logs are healthy and Sentry still shows no frontend issues.

### Check the frontend Sentry path

1. Check if Sentry SDK is initialized: open browser DevTools -> Network -> filter for `/monitor`
2. Verify `enableSentry` is `true` in the production environment config
3. Check if Sentry DSN is correct in the deployed frontend config
4. Check Sentry Dashboard → Settings → Client Keys for rate limits or disabled keys

### Match the failure to the cause

| Cause                             | Fix                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `enableSentry: false` in prod env | Check `frontend/scripts/runtime-config.ts` and the production build env vars. `enableSentry` becomes `true` when `SENTRY_DSN` is set      |
| Ad blocker blocking Sentry        | Reproduce without the ad blocker before you change code. The frontend already sends every non-blocked error because `sampleRate` is `1.0` |
| Sentry quota exceeded             | Check Sentry billing/quota; errors are dropped when quota is hit                                                                          |
| Monitor tunnel path broken        | Check `frontend/functions/monitor/proxy.ts`, the `/monitor` route, and the deployed Pages Function                                        |

The frontend `/monitor` tunnel strips the visitor IP headers that our proxy code controls (`cf-connecting-ip`, `cf-connecting-ipv6`, `true-client-ip`, `x-forwarded-for`, and `x-real-ip`). Cloudflare may still attach network-level client IP metadata on Worker subrequests to non-Cloudflare origins, so a strict no-forwarding guarantee requires either provider-side IP discard or a non-Worker intermediary that you control.

---

## Investigate PostHog gaps

**Symptom:** Analytics dashboard shows a gap in event data.

### Check the ingest path

1. Check PostHog Dashboard for ingestion status
2. On preview/production, verify the browser is calling same-origin `/ingest/...` endpoints instead of `us.i.posthog.com` directly
3. Confirm `/ingest/static/array.js`, `/ingest/array/<project-token>/config.js`, `/ingest/e/`, and the feedback capture path `/ingest/i/v0/e/` return success in the Network tab
4. Confirm a known test pageview or custom event appears in PostHog Events/Web Analytics for the expected project and `environment` filter. Do not treat `/ingest/e/` HTTP 200 alone as proof of ingestion; PostHog can return success for payloads that are later dropped, including payloads with a missing or invalid project token.
5. Verify the analytics service is initializing: check browser console for PostHog init messages
6. Check if Do Not Track or GPC is enabled in the test browser. The frontend opts PostHog out of passive SDK capture and SDK persistence for both signals, so no passive pageview/autocapture/replay events or PostHog browser storage should be expected while either signal is active. The footer feedback dialog submits the explicit `feedback_submitted` event through PostHog's documented single-event API and only closes after the HTTP response is successful; a non-2xx response or blocked request shows the failure toast instead.
7. For replay gaps, verify the PostHog replay ingestion settings. Sampling is controlled in PostHog, not in the frontend runtime config; PostHog's [recording controls guide](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record#sampling) documents deterministic sampling by session ID. Feedback dialog opens call `posthog.startSessionRecording()` with sampling, linked-flag, URL-trigger, and event-trigger overrides, but PostHog project-level recording disablement still wins.

### Repair the analytics path

PostHog analytics are non-critical. A gap in analytics data does not affect users. If the gap is due to a code issue:

1. Check `frontend/src/app/core/services/analytics.service.ts` for initialization errors
2. Verify both preview and production builds use the shared `POSTHOG_KEY`
3. Verify deployed frontend builds resolve `POSTHOG_HOST` to `/ingest`
4. Verify Convex backend env resolves `POSTHOG_HOST` to a full PostHog ingest host, not `/ingest`
5. Filter the PostHog project by `environment=preview` or `environment=production` to confirm traffic separation
6. Check the Pages Function at `frontend/functions/ingest/[[path]].ts` and the route splitter in `frontend/functions/ingest/proxy.ts` if proxy requests fail
7. Check PostHog status page for service outages

The `/ingest` Pages Function enriches JSON event payloads with Cloudflare `metroCode`, `country`, and `regionCode` as `metro_code`, `country_code`, and `region_code` when those fields are available. The proxy code strips the visitor IP headers that it controls (`cf-connecting-ip`, `cf-connecting-ipv6`, `true-client-ip`, `x-forwarded-for`, and `x-real-ip`), but Cloudflare may still attach network-level client IP metadata on Worker subrequests to non-Cloudflare origins.

---

## Launch analytics dashboards

Use `environment` as a required filter on every dashboard. Use
`schema_version=1` as the expected event contract for Braket-authored events.

### Launch Watchtower

- Unique visitors and signed-in users.
- Buyer funnel:
  `event_viewed` -> `checkout_panel_opened` -> `ticket_order_opened` ->
  `stripe_checkout_mounted` -> `checkout_completed` -> `tickets_issued`.
- `checkout_failed` grouped by `error_code`.
- `checkout_abandoned` grouped by `checkout_kind`.
- `feedback_submitted` grouped by `feedback_category`.
- `ticket_checked_in`.
- `ticket_checkin_failed`.

### Payment Health

- `ticket_order_opened`.
- `checkout_completed`.
- `tickets_issued`.
- Completed-to-issued ratio from `checkout_completed` and `tickets_issued`.
- `checkout_completed_without_tickets_issued`.
- Failed `payment_webhook_processed` events grouped by `stripe_event_type` and
  `error_code`.

`checkout_completed_without_tickets_issued` requires a reconciliation producer
before launch alerts are enabled. Until that event is emitted by code, use the
completed-to-issued ratio plus webhook failure counts as the operational proxy.

### Organizer Activation

- `stripe_connect_onboarding_started`.
- `stripe_connect_onboarding_completed`.
- `event_published`.
- First `tickets_issued` per organizer.

### Vetting And Access

- Gated `event_viewed` using `purchase_access_source` and `event_visibility`.
- `vetting_application_submitted`.
- `vetting_application_approved`.
- `vetting_application_rejected`.
- Checkout conversion after approval.

### Attendance

- Tickets issued by `event_id`.
- Check-ins by `event_id`.
- Check-in failures by `error_code`.
- Duplicate and wrong-event scan attempts if those `error_code` values exist in
  `ticket_checkin_failed`.

### Privacy And Data Quality

- Events missing `schema_version`.
- Events missing `environment`.
- Replay sample count.
- Event volume by event name.
- Internal and admin traffic volume by `actor_role`.

## Launch analytics alerts

Configure email alerts for these launch conditions:

| Condition                                       | First response                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checkout_completed_without_tickets_issued > 0` | Inspect the order, ticket rows, and webhook claim state before contacting the buyer. Enable this only after the reconciliation producer exists.                                                                                                                                                                                                                          |
| Failed `payment_webhook_processed`              | Group by `stripe_event_type` and `error_code`, then inspect `stripe_webhook_events` for claim state.                                                                                                                                                                                                                                                                     |
| Launch-day spike in `checkout_failed`           | Break down by `failure_stage`, `error_code`, `checkout_kind`, and `connected_account_present`.                                                                                                                                                                                                                                                                           |
| Event-day spike in `ticket_checkin_failed`      | Break down by `event_id`, `scan_source`, and `error_code`; check scanner network and event selection first.                                                                                                                                                                                                                                                              |
| Payment-category `feedback_submitted`           | Review the submitted `feedback_message` and optional `feedback_replay_url` values in PostHog, then check support channels and checkout health dashboards. If a tester saw the feedback failure toast instead, first check ad blockers, the `/ingest/i/v0/e/` request, PostHog SDK initialization, and PostHog ingest status before assuming the message reached PostHog. |

## Replay QA checklist

Before increasing session replay sampling or enabling triggered checkout-failure
recording, verify masking on:

- Guest checkout.
- Signed-in checkout.
- Stripe embedded checkout.
- Stripe Connect.
- Vetting submit and review.
- Ticket QR/PDF surfaces.
- Check-in scanner.
- Feedback dialog.
- Magic link surfaces.
- Unsubscribe and token confirmation surfaces.
