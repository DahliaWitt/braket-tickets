---
title: Community Access Ops
category: Runbooks
order: 3
description: Incident response runbook — community access ops
access: public
---

# Community Access Ops

This runbook is for community admins, root admins, and engineers who troubleshoot invite links or shared vetting. It assumes access to Convex Dashboard, the community-admin UI, and the affected organizer records. Use [Admin Operations](./admin-operations.md) for check-in, roster, and audit incidents.

Source of truth:

- `backend/convex/communities/invite_links.ts`
- `backend/convex/lib/magic_links/creation.ts`
- `backend/convex/lib/magic_links/redemption.ts`
- `backend/convex/lib/magic_links/validation.ts`
- `backend/convex/communities/trust_links.ts`
- `backend/convex/lib/access.ts`
- `backend/convex/lib/authz.ts`
- `backend/convex/users/profile.ts`
- `backend/convex/communities/directory/users.ts`
- `frontend/src/app/features/invite/pages/invite/invite.component.ts`
- `frontend/src/app/features/admin/pages/community-admin/community-admin.component.ts`
- `frontend/src/app/features/admin/services/vetting-trust-links.service.ts`

Jump to:

- [Validate an invite link](#validate-an-invite-link)
- [Create or manage a magic link](#create-or-manage-a-magic-link)
- [Explain a failed magic-link redemption](#explain-a-failed-magic-link-redemption)
- [Create or revoke a trust link](#create-or-revoke-a-trust-link)
- [Explain event visibility](#explain-event-visibility)
- [Explain why a user still cannot access a trusted community](#explain-why-a-user-still-cannot-access-a-trusted-community)
- [Rebuild the organizer admin directory projection](#rebuild-the-organizer-admin-directory-projection)
- [Reproduce the issue locally](#reproduce-the-issue-locally)

## Validate an invite link

The invite page validates `/invite/:token` with `api.communities.invite_links.validateToken`. The current validation states and invite-page messages are:

| Validation state | Current invite-page message                     |
| ---------------- | ----------------------------------------------- |
| `invalid`        | `This link does not exist or has been removed.` |
| `paused`         | `This link has been temporarily paused.`        |
| `disabled`       | `This link is no longer active.`                |
| `expired`        | `This link has expired.`                        |
| `maxed`          | `This link has reached its maximum uses.`       |

If the link is valid and the visitor is not signed in, the invite page shows sign-in and account-creation options. If the link is valid and the visitor is signed in, the page starts redemption automatically.

## Create or manage a magic link

Community admins create links from the `Magic Links` tab in the community-admin UI. Root admins can also create links through the backend path.

Magic-link bearer tokens are not recoverable from Convex after creation. The
create mutation returns the raw URL once, then list/read-model APIs expose only
a short token prefix for recognition. If an organizer loses the URL, create a
new magic link and disable or delete the old one as needed.

Use this checklist:

1. Confirm that the caller has community-admin access for at least one community, or root-admin access.
2. Confirm that the link label is 100 characters or fewer.
3. Confirm that `expiresAt` is in the future when the link uses an expiration date.
4. Confirm that `maxRedemptions` is at least `1` when the link uses a redemption cap.
5. Check whether the creator already has `20` non-deleted active magic links. The backend rejects the twenty-first active link.

The current create-time failures are:

- `Unauthorized`
- `Maximum 20 active magic links per community admin`
- `Label must be 100 characters or less`
- `Expiration date must be in the future`
- `Max redemptions must be at least 1`

The dashboard currently exposes these lifecycle actions:

- `pause`
- `resume`
- `delete`

The backend state machine also supports `disable`, which is why invite validation can return `disabled` even though the community-admin screen does not offer that action.

Admin-invite bearer tokens are also digest-only at rest. If an admin invite
email is lost, cancel the pending invite and send a new one rather than reading
the token from the database.

## Explain a failed magic-link redemption

`api.communities.invite_links.redeem` requires an authenticated user. The invite page never redeems for signed-out visitors.

Use this checklist:

1. Confirm that the visitor is authenticated. A valid link shows sign-in options until the session exists.
2. Re-check the token state with `validateToken` if the link sat idle for a while. A link can expire or max out between page load and redemption.
3. Check whether the backend returned one of the current redemption messages:
   - `You've already used this link`
   - `You are already a member of this community.`
   - `Welcome! You are now part of the community.`
4. Check `magic_link_redemption_log` for an existing row for the same `magicLinkId` and `userId`.
5. Check the audit log for `magic_link.redemption` after a successful redeem.

If the link was valid at page load but redemption throws a Convex error, the current backend messages are:

- `This link does not exist or has been removed`
- `This link has been temporarily paused`
- `This link is no longer active`
- `This link has expired`
- `This link has reached its maximum redemptions`

Treat that state as real drift between validation and redemption, not as a frontend rendering bug.

## Create or revoke a trust link

Trust links control shared vetting between organizers. The current backend rules are:

- trust is directional
- one trusted-organizer hop is the current product policy
- trust links are binary: a link either exists or it does not
- there is no pause, resume, or expiry state for trust links
- root admins can manage any trust link through the global permission fallback
- community admins can create and remove outgoing trust links for organizers they administer
- incoming-link visibility is scoped to admins of the queried organizer

The one-hop limit is a product decision for this phase, not a `convex-authz` limitation. Per-user organizer access is resolved centrally in `backend/convex/lib/authz.ts` with the library traversal query plus a fixed traversal depth.

Use this checklist:

1. Confirm that the trusting organizer and trusted organizer are different. The backend rejects self-links.
2. Confirm that both organizer records still exist.
3. Confirm that there is no existing link for the same pair before you create a new one.
4. Confirm that the caller administers the trusting organizer before expecting create or remove to succeed.
5. Check for an announcement warning before removal. Removing a trust link can change `audienceScope: "community_and_trusted"` recipient resolution immediately.

The current trust-link failures are:

- `Unauthorized`
- `Cannot create a trust link to yourself`
- `Organizer not found`
- `Trust link already exists`

Removal is idempotent. If a team removes a link and later wants to restore trust, the team creates the link again.

Operational limit:

- Outgoing trust-link rows compute `trustedMemberCount` via `countOrganizerMembers(...)` in `backend/convex/lib/authz.ts`.
- That count is clamped to the enumeration cap (`AUTHZ_RELATION_QUERY_CAP`, `1,000`): below the cap it is exact, at or above the cap it is reported as `1,000`. It never throws, so one at-cap trusted community cannot fail the whole trust-links page.
- The stricter enumeration helper `listOrganizerMembers(...)` still hard-fails at `1,000` members with `MEMBER_CAP_EXCEEDED`; that throw is intentional for callers that must read the full member list (roster, directory rebuild, marketing audience) until relation pagination exists.

## Explain event visibility

Event visibility is enforced centrally by `backend/convex/lib/access.ts`. Do not troubleshoot event reads by checking raw event rows alone.

| Event visibility  | Discoverable/viewable            | Purchasable                      |
| ----------------- | -------------------------------- | -------------------------------- |
| `private`         | authenticated, vetted users only | authenticated, vetted users only |
| `public_viewable` | anonymous users can view         | vetted users only                |
| `public`          | anonymous users can view         | no vetting required              |

Draft, cancelled, and draft-community events are visible only to callers with scoped `event:view` access. Public event list queries and event detail queries should agree because they both route through the same access helper.

## Explain why a user still cannot access a trusted community

`trust_links.checkUserTrust` returns one of three sources:

- `direct`
- `shared`
- `null`

Use this checklist:

1. Confirm whether the event organizer trusts the user's source organizer, not the other way around.
2. Confirm that the relevant trust link exists. There is no paused, resumed, or expired trust-link state anymore.
3. Confirm that the user is a member of the trusted organizer. Approved applications and magic-link redemptions seed that membership inline.
4. Confirm that the access path does not rely on chaining. One trusted-organizer hop is the current supported policy.
5. Confirm that the user did not lose direct access through membership removal or a revoked organizer-scoped application.

Troubleshoot against the centralized helpers, not raw tuple queries:

- event purchase authorization: `backend/convex/lib/access.ts` `canPurchaseEvent(...)`
- organizer-level membership state: `backend/convex/lib/authz.ts` `isMember(...)`, `listOrganizerMembers(...)`
- organizer trust status API: `backend/convex/communities/trust_links.ts` `checkUserTrust`

Keep these boundaries in mind:

- a magic-link redemption grants direct access to the community that issued the link
- removing a trust link stops shared access immediately
- root admins bypass community vetting checks

## Rebuild the organizer admin directory projection

`api.users.profile.listWithApplications` now reads from the derived `organizer_user_directory` table instead of rescanning organizer-wide applications, magic-link redemptions, and trust links on every page load.

Use this section when:

- an organizer admin list looks stale after a deploy
- trust-link create/remove behavior was repaired and the admin list needs parity rebuilt

Use this checklist:

1. Confirm the deploy that writes `organizer_user_directory` on application review, membership changes, magic-link redemption, and trust-link changes is already live.
2. Confirm the deploy that mirrors trust links into `organizer_trust_links` is already live.
3. Confirm the relevant mutation path has enqueued its background reconciliation job. Trust-link changes enqueue an organizer rebuild; direct membership changes update the changed row synchronously and enqueue bounded shared-row propagation.
4. Verify parity in the community-admin UI after the background job drains:
   - approved applications with an active authz member edge show `approved_application`
   - redeemed invite links with an active authz member edge show `magic_link`
   - direct member/admin grants that are not explained by an approved application or invite link show `direct_member`
   - shared vetting still shows `shared` plus `trustedViaOrganizerName`
   - pending, rejected, and revoked application-only users stay out of the Members list and remain visible through the application tabs/history
   - users with revoked application history reappear only when they regain current access through authz-backed direct, invite-link, or shared access
   - older source-less projection rows are rechecked against current authz access before being hidden

Operational notes:

- The admin directory projection is read-model state only. Do not use it to reason about authorization. Access control still resolves through `backend/convex/lib/access.ts` and `backend/convex/lib/authz.ts`.
- There is no supported manual `pnpm convex run` entrypoint for ad hoc organizer-directory rebuilds. If the projection stays stale after the background jobs should have drained, treat it as an engineering incident and inspect the queued rebuild or propagation rows before adding a one-off repair.
- `listWithApplications` fills each page with active projection rows before returning it, so legacy application-only rows cannot make the Members list look empty while active members exist later in the projection.
- If an organizer has more than `20` active outgoing trust links, `listWithApplications` still fails with `Too many active trust links (...)`. Treat that as a trust-link limit incident, not as projection drift.
- Trust-link create/remove now enqueues an asynchronous organizer rebuild instead of recomputing every shared member inline. Expect brief eventual consistency in the admin list immediately after a trust-link change.
- Direct membership changes still update the changed organizer row synchronously, but shared rows in trusting organizers are now propagated asynchronously in bounded background batches. Propagation requests are coalesced per `(trustedOrganizerId, userId)` pair to avoid duplicate scans under retries or bursts. Expect brief eventual consistency there too.

## Reproduce the issue locally

Start the local app:

```bash
pnpm dev
```

Then verify the affected flow:

1. Open `/community-admin/magic-links` and create a test link.
2. Open `/invite/:token` in a signed-out session and confirm that the page shows sign-in options.
3. Sign in and confirm that the page redeems the link automatically.
4. Open `/community-admin/shared-vetting` and confirm the current trust-link state before you pause, resume, or revoke anything.
