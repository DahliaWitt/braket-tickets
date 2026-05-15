---
title: Observability
category: Runbooks
order: 10
description: Incident response runbook — observability
access: public
---

# Observability Incidents

This runbook is for engineers who troubleshoot monitoring, logging, backups, and error collection. It assumes access to the NAS host and Sentry. Use it when Convex logs stop forwarding, alerts stop arriving, backups stop running, or frontend error reporting disappears.

Source of truth:

- `ops/docker-compose.yml`
- `frontend/scripts/runtime-config.ts`
- `frontend/public/_headers`
- `frontend/functions/monitor/proxy.ts`

Jump to:

- [Restore the log forwarder](#restore-the-log-forwarder)
- [Restore backups](#restore-backups)
- [Restore frontend error reporting](#restore-frontend-error-reporting)
- [Replay QA checklist](#replay-qa-checklist)

## Restore the log forwarder

**Symptom:** Sentry stops receiving forwarded Convex logs even though users report backend failures.

The `convex-log-forwarder` Docker service streams Convex logs to the provider selected by `CONVEX_LOG_SINK`. Supported values are `sentry` and `none`; compose defaults to `none` when no sink is set. The profile service reads `CONVEX_DEV_LOG_SINK` for preview/dev and maps it to runtime sink config in the same container.

Before delivery, the forwarder sanitizes the log message, raw Convex line, and structured Convex payload with `shared/log-sanitizer.mjs`. This is defense-in-depth for runtime or third-party log lines that bypass the backend `logger` wrapper.

Set `CONVEX_LOG_SINK=sentry` or `CONVEX_DEV_LOG_SINK=sentry` only when the matching Sentry DSN is configured. Use `none` to keep the forwarder connected without sending events to Sentry.

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

| Cause                     | Fix                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing Sentry DSN        | Set `SENTRY_DSN` in the target Doppler config when the selected sink is `sentry`                                                                                              |
| Sink misconfigured        | Confirm `CONVEX_LOG_SINK` / `CONVEX_DEV_LOG_SINK` is one of `sentry` or `none`                                                                                                |
| Forwarding paused         | Set `CONVEX_LOG_SINK=sentry` and rerun production deploy, or set `CONVEX_DEV_LOG_SINK=sentry` and rerun preview deploy                                                        |
| Container crashed         | `docker compose -f ops/docker-compose.yml up -d convex-log-forwarder` (prod) or `docker compose -f ops/docker-compose.yml up -d convex-log-forwarder-dev` (dev-observability) |
| Convex deploy key expired | Rotate `CONVEX_DEPLOY_KEY` and restart the service                                                                                                                            |
| Network connectivity      | Check the NAS can reach Convex and your chosen sink endpoint                                                                                                                  |

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

**Symptom:** Production users reporting frontend errors but Sentry shows no matching issues.

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

## Sentry feedback alerts

Payment feedback submitted through Sentry Feedback should be reviewed alongside
support channels and checkout health. The form is opened by
[`openSentryFeedback()`](../../frontend/src/app/core/services/sentry-loader.ts).
If a tester saw the feedback unavailable toast instead, first check Sentry SDK
initialization, the `/monitor` tunnel, Sentry project quota/rate limits, and
browser blockers before assuming the message reached Sentry.

## Replay QA checklist

Before increasing Sentry replay sampling or enabling triggered checkout-failure
recording, verify masking on:

- Guest checkout.
- Signed-in checkout.
- Stripe embedded checkout.
- Stripe Connect.
- Vetting submit and review.
- Ticket QR/PDF surfaces.
- Check-in scanner.
- Sentry Feedback form.
- Magic link surfaces.
- Unsubscribe and token confirmation surfaces.
