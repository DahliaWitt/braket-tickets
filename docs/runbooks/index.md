---
title: Runbooks
category: Runbooks
categoryOrder: 5
order: 0
description: Incident response and planned operational work — routing index
access: public
---

# Incident Response Runbooks

This index is for engineers and admins who respond to Braket Tickets incidents or planned operational work. It assumes you can reach the dashboards and provider consoles in [Key URLs](#key-urls). Use it to route an incident to the right runbook quickly.

## Severity Levels

| Level     | Definition                      | Response Time | Examples                                                           |
| --------- | ------------------------------- | ------------- | ------------------------------------------------------------------ |
| **SEV-1** | Service down or payments broken | Immediate     | Convex deployment crash, Stripe webhooks failing, site unreachable |
| **SEV-2** | Major feature degraded          | < 1 hour      | Email delivery failing, check-in broken, vetting flow stuck        |
| **SEV-3** | Minor feature issue             | < 4 hours     | Analytics not tracking, audit logs missing, cosmetic errors        |

## Runbooks

| Runbook                                               | Covers                                                                                             | Typical Severity    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------- |
| [Deployment & CI](./deployment-ci.md)                 | GitHub Actions failures, skipped deploys, Cloudflare deploy failures, preview deploy recovery      | SEV-1 / SEV-2       |
| [Local Environment Recovery](./local-recovery.md)     | Broken local dev setup, Doppler/env drift, E2E harness recovery, local seeding                     | Developer workflow  |
| [Payment Incidents](./payments.md)                    | Stuck payments, failed refunds, Stripe webhook failures, revenue reconciliation                    | SEV-1               |
| [Stripe Connect Ops](./stripe-connect-ops.md)         | Organizer onboarding, Express dashboard access, payout readiness, scheduled payout troubleshooting | SEV-2               |
| [Stripe Sandbox Testing](./stripe-sandbox-testing.md) | Shared sandbox fixture reseeding, contract lane checks, scheduled verification                     | Planned maintenance |
| [Event Change Refunds](./event-change-refunds.md)     | Cancellation, postponement, reschedule, moved-event, and refund-request operations                 | Planned operations  |
| [Privacy Requests](./privacy-requests.md)             | Access, correction, deletion, minimization, and provider-side privacy request handling             | Planned operations  |
| [Convex Backend](./convex-backend.md)                 | Deployment failures, function errors, database issues, cron job failures                           | SEV-1 / SEV-2       |
| [Frontend & CDN](./frontend-cdn.md)                   | Cloudflare Pages outages, build failures, CSP violations, blank pages                              | SEV-1 / SEV-2       |
| [Auth Incidents](./auth-incidents.md)                 | Missing social providers, blocked sign-in, password reset, email-change, and auth sync issues      | SEV-2               |
| [Community Access Ops](./community-access-ops.md)     | Magic link failures, invite redemption, shared vetting, trust-link lifecycle                       | SEV-2               |
| [Email Delivery](./email-delivery.md)                 | Provider failures, bounces, missing transactional emails                                           | SEV-2               |
| [Admin Operations](./admin-operations.md)             | Check-in failures, roster mismatches, audit log gaps                                               | SEV-2 / SEV-3       |
| [Observability](./observability.md)                   | Sentry log forwarding, frontend error reporting, and backup failures                               | SEV-2 / SEV-3       |
| [Secret Rotation](./secret-rotation.md)               | Rotating Stripe keys, email credentials, Convex deploy keys                                        | Planned maintenance |
| [Social Auth Setup](./social-auth-setup.md)           | Obtaining Google and Discord OAuth credentials                                                     | Initial setup       |

## First Responder Checklist

When an incident is reported:

1. Classify the severity with the severity table in this document.
2. Check Sentry for recent Convex log volume and frontend error reporting.
3. Check Convex Dashboard for function failures or cron failures.
4. Check Cloudflare Pages or GitHub Actions if the incident looks deployment-related.
5. Open the matching runbook and follow the diagnostic steps.
6. Record the incident after you restore service.

## Key URLs

| Service          | URL                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Convex Dashboard | https://dashboard.convex.dev (project: modest-impala-722)                                                                                                          |
| Cloudflare Pages | https://dash.cloudflare.com → Pages → braket-tickets-frontend                                                                                                      |
| GitHub Actions   | https://github.com/DahliaWitt/braket-tickets/actions                                                                                                               |
| Sentry           | https://sentry.io (org: o96755, project: 4510889653895168)                                                                                                         |
| Production Site  | https://community.braket.gay                                                                                                                                       |
| Preview Site     | Cloudflare Pages `develop` branch; use `https://dev.community.braket.gay` for preview and the direct Pages branch URL only to isolate custom-domain routing issues |

## Convex Deployments

Single source of truth for deployment hostnames. Source: `doppler secrets get CONVEX_URL --plain --config <env>`.

| Environment | API host (`.convex.cloud`)          | HTTP-actions host (`.convex.site`) | Used by                    |
| ----------- | ----------------------------------- | ---------------------------------- | -------------------------- |
| Production  | `modest-impala-722.convex.cloud`    | `modest-impala-722.convex.site`    | `community.braket.gay`     |
| Staging     | `bright-swordfish-194.convex.cloud` | `bright-swordfish-194.convex.site` | `dev.community.braket.gay` |

The `.convex.cloud` host serves the API and storage URLs (e.g., poster `posterUrl` strings). The `.convex.site` host serves HTTP actions (auth callbacks, marketing tracking endpoints). When configuring third-party integrations against a deployment, pick the variant that matches what the integration calls — see [Social Auth Setup](./social-auth-setup.md) for OAuth callback URLs and [Frontend & CDN](./frontend-cdn.md) for image transformation source allowlists.

## Related Documentation

- [Deployment Guide](../deployment.md) — how deployments work
- [Environment Variables](../environment.md) — all env vars and their purpose
- [Payment Edge Cases](../payment-edge-cases.md) — known payment bugs and mitigations
- [Event Change Refunds](./event-change-refunds.md) — cancellation, reschedule, moved-event, and refund-request operations
- [Stripe Connect Ops](./stripe-connect-ops.md) — organizer onboarding, dashboard access, and payout operations
- [Stripe Sandbox Testing](./stripe-sandbox-testing.md) — fixture and contract-test operations
- [Privacy Requests](./privacy-requests.md) — access, correction, deletion, minimization, and provider-side privacy handling
- [Security](../security.md) — RLS rules and access control

## Post-Incident Checklist

Capture these before closing the incident:

1. Detection: what alerted first, and when?
2. Scope: which environment, workflow, route, or feature was affected?
3. Source of truth checked: which repo files or dashboards confirmed the diagnosis?
4. Mitigation: what exact command, deploy, or config change restored service?
5. Follow-up: what doc, test, monitor, or guardrail should change so the same issue is easier to catch next time?
