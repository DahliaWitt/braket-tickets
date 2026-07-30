---
title: Security
category: Architecture
order: 3
description: Authz + handler authorization model after the ReBAC migration
access: public
---

# Convex Security Strategy (Authz + Handler Authorization)

This document is for developers working on the Braket Tickets Convex backend. It covers the current authorization and visibility model after the ReBAC migration to `@djpanda/convex-authz`.

**Scope**: backend authentication, authorization, membership state, trust traversal, and visibility rules. This does not cover frontend security, transport security, or third-party service hardening.

## 1. Core Model

The backend no longer uses a Row Level Security wrapper.

Public Convex endpoints now use bare `query()` / `mutation()` with explicit handler-level auth checks. Authorization is organized in three layers:

1. **`backend/convex/lib/authz.ts`** — role/relation state (membership, trust links, role grants). Only this file calls `components.authz.*`.
2. **`backend/convex/lib/access.ts`** — all authorization decisions (`can*` and `require*` functions). Consumes `backend/convex/lib/authz.ts`.
3. **Handlers** — call `access.ts` only. Never inline permission checks or call `authz.can()` directly.

At a high level:

1. Better Auth establishes the session.
2. A Convex handler derives the caller with `getAuthUserId(...)` or `ctx.auth.getUserIdentity()`.
3. The handler enforces authz using `access.ts` functions: `requirePermission(...)`, `requireCommunityAdmin(...)`, `requireEventAdmin(...)`, `canPurchaseEvent(...)`, `canViewEvent(...)`, etc.
4. Visibility-sensitive read paths use `access.ts` helpers for event lifecycle, event visibility, membership, and shared trust.

## 2. Source Of Truth

Authorization facts come from two places only:

### 2.1 Authz component state

Defined and wrapped in `backend/convex/lib/authz.ts`.

- Roles:
  - `root_admin` (global scope)
  - `community_admin` (`organizer:<id>` scope)
  - `community_scanner` (`organizer:<id>` scope)
- Relations:
  - `(user, member, organizer)`
  - `(organizer, trusts, organizer)`
  - `(organizer, trusted_by, organizer)` as an internal traversal-only reverse edge

These facts drive organizer admin rights, scanner rights, direct community membership, and cross-community trust. `backend/convex/lib/authz.ts` owns the graph semantics layered on top of these tuples.

### 2.2 Domain records and operational logs

These remain important, but they are **not** the authorization source of truth:

- `applications`
  - review workflow, status history, rejection/revocation reasons
- `magic_link_redemption_log`
  - redemption counts, idempotency, and timestamps
- `admin_invites`
  - invite lifecycle and acceptance flow
- `adminAuditLogs`
  - audit trail only

Do not use those tables to decide whether a user is a member of a community. Membership lives in authz tuples.

## 3. Roles And Relations

### 3.1 Roles

| Role                | Scope     | Effective permissions                                                              |
| ------------------- | --------- | ---------------------------------------------------------------------------------- |
| `root_admin`        | global    | `platform:admin`, `community:admin`, `community:scan`, `event:admin`, `event:scan` |
| `community_admin`   | organizer | `community:admin`, `community:scan`, `event:admin`, `event:scan`                   |
| `community_scanner` | organizer | `event:scan`                                                                       |

Role configuration lives in `backend/convex/lib/authz.ts`.

### 3.2 Relations

| Relation                             | Meaning                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `(user, member, organizer)`          | user is a member of that organizer's community                     |
| `(organizer, trusts, organizer)`     | trusting organizer accepts membership from the trusted organizer   |
| `(organizer, trusted_by, organizer)` | internal reverse edge used only for traversal-backed access checks |

Trust links are binary. There is no expiry state, pause state, or alternate trust-link table. The reverse `trusted_by` edge is implementation detail, not an admin-facing relation.

## 4. Required Access Patterns

### 4.1 Use the authz wrappers

Only `backend/convex/lib/authz.ts` may call `components.authz.rebac.*` directly.

`backend/convex/lib/authz.ts` owns authz graph semantics. Direct tuple helpers are configuration APIs, not policy APIs. Feature code must not combine direct trust-edge enumeration with membership checks to derive access.

Direct `Authz` class calls are allowed only in:

- `backend/convex/lib/authz.ts`
- `backend/convex/lib/access.ts`
- authz-management modules that grant or revoke roles and relations (membership, magic links, admin invites)

Feature code imports authorization decisions from `backend/convex/lib/access.ts`:

- `canViewEvent(...)`, `canPurchaseEvent(...)`, `canManageEvent(...)`
- `requirePermission(...)`, `requireCommunityAdmin(...)`, `requireEventAdmin(...)`
- `canViewEventRoster(...)`, `hasEventStaffAccess(...)`

Enumeration helpers in `authz.ts` are data queries, not authorization decisions — direct import is permitted:

- `isMember(...)`, `listOrganizerMembers(...)`, `listUserMemberships(...)`
- `listDirectTrustedOrganizers(...)`, `listDirectTrustingOrganizers(...)`
- `listOneHopSharedAccessOrganizers(...)`, `listPublishedTrustedAudienceOrganizers(...)`
- `addMember(...)`, `removeMember(...)`, `addTrustLink(...)`, `removeTrustLink(...)`

### 4.2 Use `requirePermission(...)`, not `authz.require(...)`

`authz.require(...)` throws a plain `Error`. Convex handlers must throw structured app errors.

Use `requirePermission(...)` from `backend/convex/lib/authz.ts`. Its implementation matters because it does:

1. a scoped `authz.can(...)` check
2. a global fallback `authz.can(...)` check when scope is present

That fallback is required so `root_admin` passes scoped checks. Without it, globally assigned roles do not fall through to organizer-scoped permissions.

## 5. Public Endpoint Rules

For public endpoints:

- Use bare `query()` / `mutation()`
- Authenticate explicitly in the handler
- Authorize explicitly in the handler or a domain helper
- Keep internal-only work in `internalQuery()` / `internalMutation()`

Example categories in the current codebase:

- community admin mutations use `requireCommunityAdmin(...)` or `requirePermission(..., 'community:admin', organizerScope)` from `access.ts`
- event admin flows use `requireEventAdmin(...)` from `access.ts`
- event scanner flows use `requirePermission(..., 'event:scan', organizerScope)` or `hasEventStaffAccess(...)` from `access.ts`
- purchase gates use `canPurchaseEvent(...)` from `access.ts`
- visibility checks use `canViewEvent(...)` from `access.ts`

There is no `queryWithRLS()` or `mutationWithRLS()` layer anymore.

## 6. Event Visibility

Event read access is centralized in `canViewEvent(...)` and list-style event queries must route through `filterViewableEvents(...)`.

| Event visibility  | Discoverable/viewable            | Purchasable                      |
| ----------------- | -------------------------------- | -------------------------------- |
| `private`         | authenticated, vetted users only | authenticated, vetted users only |
| `public_viewable` | anonymous users can view         | vetted users only                |
| `public`          | anonymous users can view         | no vetting required              |

Draft, cancelled, and draft-community events are readable only by organizers who can modify the event (scoped `event:manage`/`event:edit`) — community admins and root admins. Members and door-staff scanners hold neither permission, so they cannot read a community's unpublished or cancelled events (there is no standalone `event:view` permission). Public-facing reads must not reimplement the matrix directly.

## 7. Membership Write Points

Membership is written synchronously at the same time as the domain action that grants or removes access.

### 7.1 Application approval

Approval paths create or update the `applications` record **and** add the authz `member` relation.

Relevant files:

- `backend/convex/communities/applications.ts`
- `backend/convex/lib/users/membership.ts`

### 7.2 Magic link redemption

Redemption:

1. verifies the magic link
2. appends to `magic_link_redemption_log`
3. adds the authz `member` relation
4. seeds organizer marketing preference inline

Relevant file:

- `backend/convex/lib/magic_links/redemption.ts`

### 7.3 Admin invite acceptance

Invite acceptance grants the scoped `community_admin` role and also adds organizer membership.

Relevant file:

- `backend/convex/communities/management/invites.ts`

### 7.4 Membership revocation

Revocation updates or creates the organizer application state to `revoked` and removes the authz `member` relation.

Relevant file:

- `backend/convex/lib/users/membership.ts`

## 8. Marketing Preference Coupling

Membership-granting mutations must seed marketing preference synchronously in the same mutation. Do not defer this with `ctx.scheduler.runAfter(...)`.

Current rule:

- direct recipients require an explicit organizer preference row with `optedIn: true`
- global opt-out must be respected when seeding the row

Relevant files:

- `backend/convex/lib/marketing_emails/preferences.ts`
- `backend/convex/lib/magic_links/redemption.ts`
- `backend/convex/communities/admins.ts`
- `backend/convex/communities/management/invites.ts`

## 9. Purchase Gates And Trust Resolution

Ticket purchase and related gates use `canPurchaseEvent(...)` in `backend/convex/lib/access.ts`.

Possible outcomes:

| Source        | Meaning                                  |
| ------------- | ---------------------------------------- |
| `open_access` | event is open-access (public visibility) |
| `direct`      | user is a direct organizer member        |
| `shared`      | user is a member of a trusted organizer  |
| `none`        | no qualifying access path                |

Important implementation notes:

- `canPurchaseEvent(...)` checks visibility first (open-access fast path), then delegates to `authz.ts` for membership and trust resolution
- trust resolution uses `checkRelationWithTraversal` with the reverse `trusted_by` edge and `maxDepth: 2`, which preserves the current one-hop trust policy
- direct membership checks use `isMember(...)`
- shared access list expansion is still centralized in wrapper helpers because upstream list traversal APIs remain direct-only
- trust traversal intentionally treats application approval and magic-link admission as equivalent membership paths
- marketing audience expansion is intentionally stricter than purchase gating: it uses `listPublishedTrustedAudienceOrganizers(...)`, so only published trusted organizers contribute recipients

## 10. Staff Access And Sensitive Event Data

Staff visibility is controlled by `backend/convex/lib/access.ts`.

### 10.1 Live event staff access

`hasEventStaffAccess(...)` resolves:

- `isRootAdmin`
- `isEventAdmin`
- `isEventScanner`

`canViewEventRoster(...)` then applies the final visibility rule:

- root admins and event admins can always view staff data
- scanners can view staff data only when the event is `published`

### 10.2 Check-in

`backend/convex/events/check_in.ts` requires both:

- `hasEventStaffAccess(...)`
- `canViewEventRoster(...)`

That means root admins, event admins, and eligible scanners can check in attendees for the event.

### 10.3 CSV export

`backend/convex/events/analytics_export.ts` is stricter than live roster viewing:

- roster CSV export requires event-admin access
- scanners are rejected
- exports are rate-limited and audited

## 11. Performance And Query Boundaries

The authz migration intentionally removed ad hoc mirrors like `organizer_member_directory`.

Current guardrails:

- `listOrganizerMembers(...)` throws `MEMBER_CAP_EXCEEDED` at 1000 rows to avoid silent truncation
- trust and membership traversal helpers should not introduce unbounded scans
- one-hop shared-access helpers enforce the trust-link cap centrally
- trust-linked read paths should use authz wrapper queries rather than rebuilding separate membership mirrors

Relevant file:

- `backend/convex/lib/authz.ts`

## 12. What Was Removed

These legacy mechanisms are gone and should not appear in new code:

- `queryWithRLS()` / `mutationWithRLS()`
- `backend/convex/lib/rls.ts`
- `backend/convex/lib/permissions.ts` (consolidated into `backend/convex/lib/access.ts`)
- `backend/convex/lib/domain_access.ts` (consolidated into `backend/convex/lib/access.ts`)
- ticket query helpers (consolidated into `backend/convex/lib/access.ts`)
- `users.roles`
- `community_admins` table
- `community_scanners` table
- `vettingTrustLinks` table
- `organizer_member_directory` table
- using `magic_link_redemption_log` as an authorization gate

## 13. Developer Checklist

Before shipping an auth-sensitive change:

- [ ] public endpoints use bare `query()` / `mutation()` with explicit auth checks
- [ ] organizer-scoped checks go through `requirePermission(...)` or domain permission helpers
- [ ] no file outside `backend/convex/lib/authz.ts` calls `components.authz.*`
- [ ] no file outside `backend/convex/lib/access.ts` defines authorization decision functions (`can*`, `require*`)
- [ ] membership writes and marketing preference writes stay in the same mutation
- [ ] trust-linked access uses authz membership/trust relations, not workflow tables
- [ ] scanner vs admin visibility is verified for event staff data and exports
- [ ] targeted tests cover the changed permission or visibility boundary

## References

- `backend/convex/lib/authz.ts`
- `backend/convex/lib/access.ts`
- `backend/convex/communities/trust_links.ts`
- `backend/convex/lib/magic_links/redemption.ts`
- `backend/convex/lib/users/membership.ts`
- `docs/runbooks/community-access-ops.md`
- `docs/runbooks/admin-operations.md`
