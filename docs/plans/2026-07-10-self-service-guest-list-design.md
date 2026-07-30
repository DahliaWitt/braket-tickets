# Self-Service Guest List Design

**Date:** 2026-07-10

**Status:** Approved

**Scope:** Community defaults, per-event artist/staff delegation, accountless access, quota enforcement, automatic admission and ticket delivery, organizer reporting, and source attribution.

## Problem

Event organizers currently collect artist and staff guest lists manually and then enter the resulting guests themselves. This makes the organizer a bottleneck at the same time they are handling other event work. Artists and staff need a constrained self-service path that does not require a Braket account, while organizers retain control over who can contribute, how many entries each person receives, and what remains on the event roster.

## Product Decisions

- Every community has an artist default of 2 guest slots and a staff default of 2 guest slots.
- Defaults are copied onto a per-person, per-event assignment when it is created. Changing a community default affects future assignments only.
- An organizer may override the copied grant for any assignment.
- An assignment grants the artist or staff member one event admission if they do not already have a valid admission. This admission does not consume a guest slot.
- Self-service guests require a name and email address.
- Existing Braket users manage assignments from a signed-in dashboard path. People without accounts use a reusable, revocable emailed link and never need to create an account.
- Access and mutations remain available until the repository's authoritative `hasEventEnded` helper returns true. They stop then, on cancellation, or immediately upon assignment revocation.
- Revoking an assignment preserves guests already added through it and preserves their source attribution.
- Lowering a grant below current usage preserves existing guests. It blocks additions until usage is below the new grant while continuing to allow edits and removals.
- Every self-service guest receives their ticket email automatically.
- Bulk staff assignment reuses the existing paste/CSV import surface and accepts name, email, and an optional per-event slot override.

## Architecture

The feature introduces a dedicated per-event guest-list assignment rather than making a guest record double as a permission grant. An assignment represents the relationship between an event and an artist or staff delegate. It owns identity resolution, role, quota, access credential, status, audit metadata, and the optional admission created for the delegate.

The existing `guests` table remains the event admission source for organizer-created guests, delegate admissions, and guests created through self-service. New optional source fields link self-service rows to their assignment. This keeps scanning, roster, PDF generation, broadcasts, and ticket-email delivery on the current admission path.

Successful email-delivery rows retain the provider-facing `recipient` and add an optional normalized `recipientKey`, indexed with source and source ID. New writes populate the key immediately. During rollout, recipient-scoped deduplication first uses the normalized index, then the exact-recipient index, and finally checks at most 100 unkeyed legacy rows for the same source. It fails closed if that bounded fallback would be exceeded rather than risking a duplicate send. The field stays optional until `backfillEmailDeliveryRecipientKeys` has migrated historical rows.

The boundaries are:

1. **Community defaults** determine the initial grant copied into a new assignment.
2. **Guest-list assignment** authorizes one person to manage a bounded set of guests for one event.
3. **Delegate admission** is an ordinary event guest admission created only when no valid admission already exists. It is attributed to the assignment but excluded from usage.
4. **Self-service guest** is an ordinary guest record linked to the assignment and counted toward its grant.

Assignments are retained after revocation so existing guest attribution remains resolvable. They are statused, not deleted.

## Data Model

### Community defaults

Add optional non-negative integer fields to `organizers`:

- `defaultArtistGuestSlots`
- `defaultStaffGuestSlots`

An absent field has an effective value of 2. This makes the feature immediately consistent for existing communities without a mandatory organizer backfill. Saving Community Settings persists explicit values.

### Guest-list assignments

Add a `guestListAssignments` table with fields equivalent to:

- `eventId`
- `organizerId` (denormalized from the event for community-scoped queries)
- `role`: `artist | staff`
- `displayName`
- `email` and normalized `emailKey`
- optional `userId` when linked to an existing user
- `grantedSlots`, copied from the community default or supplied as an override
- `usedSlots`, maintained transactionally with sourced guest creation/removal
- `status`: `active | revoked`
- digest-only reusable bearer credential metadata: `tokenDigest` and `tokenPrefix`
- optional pending credential digest/prefix used only during resend rotation
- `inviteState`: `pending | accepted | failed`
- optional `inviteAttemptId`, `lastInviteAcceptedAt`, and bounded non-PII `inviteFailureCode`
- `createdBy`, `createdAt`, and `invitedAt`
- optional `lastInviteSentAt`, `redeemedAt`, `revokedAt`, and `revokedBy`
- optional `admissionGuestId` when the assignment created a new guest admission

Indexes support paginated event lists, organizer lists, signed-in user lists, verified-email discovery, source usage, and token lookup. Index names include every indexed field in repository style. Active status and event end time are checked after indexed lookup; the bearer token is never stored in plaintext.

Only one non-revoked assignment may exist for the same event and normalized email. Re-inviting a revoked identity creates a new assignment and credential rather than reactivating an old bearer token.

### Event self-service statistics

Add one `guestListEventStats` row per participating event. It stores the bounded overview counters that would otherwise require collecting and counting an unbounded assignment or guest set:

- `eventId`
- `selfServiceGuestCount`, including retained guests from revoked assignments
- `activeGrantedSlots`
- `activeArtistGuestCount` and `activeStaffGuestCount`
- `activeAssignmentCount`
- `totalGuestAdmissionCount`, covering every row in `guests` for the event

Assignment creation, grant changes, revocation, self-service guest creation, and sourced guest removal update self-service counters in the same transaction as their primary write. Every guest insertion/removal path—manual add, bulk import, delegate admission, self-service, and organizer/delegate removal—updates `totalGuestAdmissionCount`; edits and check-ins do not. `guestListAssignments.usedSlots` provides each row's `used / granted` value without collecting child guests. A repair/reconciliation internal function is bounded and resumable so test, migration, or operational recovery can rederive counters without a single unbounded transaction.

### Guest-list audit events

Add a dedicated `guestListAuditEvents` table rather than widening the admin-only audit union for accountless actors. It stores:

- `eventId` and `assignmentId`
- `actorKind`: `organizer | signed_in_delegate | token_delegate | system`
- optional `actorUserId`
- closed action union for create, grant change, invite/resend, revoke, user link, and guest add/edit/remove
- optional numeric `beforeValue` and `afterValue`
- `createdAt`

Indexes support bounded event and assignment audit queries. No name, email, note, raw token, token digest/prefix, or free-form payload is stored. Retention follows the existing administrative audit retention policy; cleanup is cursor-batched if that policy requires deletion.

### Rollout state

Add a singleton `guestListFeatureState` row with `emailKeyBackfillComplete`, `guestCountBackfillComplete`, and `enabledAt`. Assignment creation, resend, bulk assignment, and delegate functions fail closed until both backfills are verified and the feature is enabled. Read-only organizer settings may ship before enablement.

### Guest attribution and admission deduplication

Add optional fields to `guests`:

- normalized `emailKey`
- `sourceAssignmentId`
- `sourceKind`: `assignment_admission | self_service`
- snapshotted `sourceRole` and `sourceDisplayName`

Existing rows remain valid with these fields absent. All guest write paths—single add, edit, bulk import, tests, and seeds—populate or maintain `emailKey` when an email exists. Replace-based edit paths explicitly spread/preserve immutable source fields instead of reconstructing a row that drops them. A migration backfills existing guest emails so assignment admission checks can use an event/email index reliably. Source role/name are immutable attribution snapshots on the guest row; the Guest tab does not perform a per-row assignment join.

When an assignment is created, a shared admission resolver uses indexed point/range lookups and checks for a valid admission in this order:

1. an event ticket with status `valid` or `used` belonging to the linked user;
2. an event ticket with status `valid` or `used` matching the normalized verified roster email;
3. any extant guest row with the same normalized email, including a checked-in guest.

Add ticket index `by_event_and_rosterEmailLower_and_status` and guest index `by_event_and_emailKey`; use the existing user/event ticket index for linked users. When both a selected `userId` and verified-email match exist they must identify the same account, otherwise assignment creation rejects the mismatched identity without revealing another account.

If no valid admission exists, the assignment creates a guest row with the appropriate existing backend guest type (`artist guest` or `staff`), `sourceKind: assignment_admission`, and the assignment ID. The organizer UI presents an assignment admission as “Artist” or “Staff” rather than “Artist guest.” The new admission is immediately scheduled through the existing guest ticket-email path. It does not increment assignment or event self-service usage counters.

All public functions define explicit argument and return validators, cap user-controlled string and batch sizes with shared validators, and return bounded or paginated collections. Sensitive orchestration and email helpers remain internal. Single-assignment creation and resend accept client-generated idempotency keys; duplicate retries return the committed result without minting a second credential or scheduling duplicate email. Bulk staff creation retains the existing import batch idempotency contract.

## Authorization and Credentials

Organizer assignment management uses the existing event/community management checks from `backend/convex/lib/access.ts`. Feature code does not call the authorization component directly.

Member search is community-scoped and requires community-management access before it returns any identity data. Entering an arbitrary email does not disclose whether that address belongs to a Braket account or another community. Organizer responses omit token digests, prefixes, and internal delivery metadata.

Member search reuses the existing paginated community member search/index rather than scanning membership or user tables. Assignment admission lookup similarly uses event/user and event/email indexes; it does not scan all tickets or guests for an event.

Delegate authorization has two equivalent entry paths:

- **Signed-in:** the current user matches `assignment.userId`, or—only while `userId` is absent—their server-sourced, verified normalized account email matches the assignment. A successful verified-email match atomically and permanently links the assignment to that user unless an organizer explicitly changes the assignee.
- **Accountless:** the presented token hashes to the assignment's purpose-scoped digest.

Both paths then require all of the following:

- assignment status is active;
- the assignment belongs to the requested event;
- the event has not ended according to `backend/convex/lib/timezone.ts` `hasEventEnded`;
- the requested guest is linked to the same assignment for edit/remove operations.

Invalid, revoked, rate-limited, or expired links return the same neutral unavailable state without event, identity, usage, roster, or token-validity details. Revocation immediately invalidates both active and pending credentials. Tokens remain reusable until revocation or event end because delegates are expected to make several updates over time.

Invitation URLs place the credential in the URL fragment rather than the query string so it is not sent in referrers or ordinary server access logs. The client reads the fragment, stores the credential in a dedicated guest-list token service, and immediately removes it from the visible URL/history entry before resolving the assignment. Application logs, analytics, error reports, and audit records never contain the raw fragment or credential.

Implement a new `GuestListAssignmentTokenStoreService`; do not reuse the email-keyed checkout guest-session store. On browser-only route initialization it reads the fragment, calls `history.replaceState` before analytics/error reporting or network resolution, and stores the token through `BrowserPlatformService` under `bt-guest-list-token:<assignmentId>` after the first successful resolve. Storage persists so a delegate can return without an account, but an explicit “Forget this guest list” action, application logout on a shared device, and any revoked/ended/unavailable response clear the relevant entry. SSR never reads browser storage or resolves a fragment. Tests assert scrub-before-resolve ordering and cleanup.

Token validation uses the repository's purpose-scoped HMAC digest helper and constant-shape neutral errors. Initial invite and resend use explicit attempt state. The mutation stores a pending digest, `inviteState: pending`, and a unique `inviteAttemptId`; an internal action sends the raw token and reports provider acceptance. A compare-and-promote mutation changes the pending digest into the active digest and records `inviteState: accepted` only when the attempt ID still owns the pending state. A compare-and-clear failure mutation records `inviteState: failed` plus a bounded non-PII failure code. During resend, the current credential remains usable until pending provider acceptance. Later bounce/complaint webhooks update delivery observability but do not roll back an already promoted credential. “Accepted” means accepted by the configured provider, not proven inbox delivery. No plaintext credential is stored in Convex.

Public delegate functions return only the selected assignment's display-safe event fields, role, quota, delivery state, and sourced guests. They never return unrelated roster rows. Every read/write checks assignment ownership after indexed lookup; internal email actions accept IDs, reload authoritative data, and cannot be invoked directly by clients.

Automatic guest ticket delivery does not call the current public admin-only `events/guest_actions.sendTicket` from the scheduler. Add a separate internal action that accepts only `guestId`, reloads the guest, event, and source assignment, validates `sourceKind` plus assignment/event linkage, then uses the existing guest send lock, delivery ledger, PDF/template, and delivery helpers. The committing assignment/self-service mutation schedules this internal action. Public organizer resend keeps the existing admin authorization boundary; delegate Retry authorizes the assignment first and then schedules the same internal source-validated action.

Apply repository-standard rate limits to token resolution, self-service guest add/edit/remove/retry, organizer invite/resend, and bulk assignment creation. Accountless limits use a non-secret digest/prefix-derived key plus operation; signed-in and organizer limits use the authenticated user ID plus operation. Rate-limit responses remain neutral for token-resolution attempts.

Write PII-minimized admin audit events for assignment creation, grant changes, resend, revocation, verified-user linking, and delegate guest add/edit/remove. Records contain actor/assignment/event IDs, action, timestamps, and numeric before/after counts—not names, emails, bearer material, or free-form notes.

## Organizer Experience

### Community Settings

Add a Guest List Defaults section with non-negative numeric inputs for Artist slots and Staff slots. Both show 2 when no explicit value has been saved.

The settings container renders a distinct loading state until the server query returns confirmed values, renders a recoverable error state when that query fails, and does not mount or enable the save form in either state. The effective 2/2 fallback is applied by the backend response; the client never substitutes 2/2 while data is unresolved, so a slow or failed read cannot overwrite saved defaults.

An accessible help tip, available on hover and keyboard focus, states: “Defaults are copied when a person is assigned. Changing a default affects future assignments only. Existing event assignments keep their current grant.”

### Event guest-list management

Extend the event Guest List area with an overview and an Artists & Staff assignment view.

The overview shows:

- total self-service guests, including retained guests from revoked assignments;
- active granted capacity and active artist/staff usage;
- total event guest-list admissions, including manual entries and assignment admissions;
- the guest list itself.

The assignment view supports:

- searching existing community members;
- entering any valid email even when no Braket user exists;
- choosing Artist or Staff;
- accepting the snapshotted role default or entering an override;
- inviting, resending, editing a grant, and revoking;
- seeing `used / granted` for every person;
- expanding or navigating to the guests sourced from one assignment;
- bulk staff assignment using the shared import surface.

The optional slot override uses the same whole-number range as the backend: 0 through 100 inclusive. Invalid, fractional, negative, non-numeric, or out-of-range values keep the invite action disabled and show an inline validation message instead of relying on a mutation error.

Member search results use the native semantics of a labeled list containing buttons; they do not claim combobox/listbox semantics without the corresponding keyboard interaction. Selecting a result exposes an explicit linked-member state. If the organizer edits the selected email so it no longer matches that member, the client clears the hidden `userId`; the organizer can also choose “Use email only” explicitly. This prevents a stale account identity from being submitted with an unrelated address.

Assignment rows are paginated rather than returned as an unbounded event collection. The first page remains reactive; later pages are bounded point-in-time reads. The client deduplicates rows by assignment ID and discards later-page snapshots whenever the reactive first-page IDs or cursor change, preventing inserts at the page boundary from dropping or duplicating assignments. Expanding a row loads that assignment's guests through an indexed, bounded point-in-time query. While expanded, a change to that assignment's reactive `usedSlots` invalidates the cached guest page and triggers a bounded first-page refetch; older pages remain available only after an explicit Load more. The existing `guests.listByEvent` remains its current capped full-array roster in this release; it is not described or reimplemented as pagination. The accurate total comes from `guestListEventStats.totalGuestAdmissionCount`, so the cap cannot under-report the overview.

Bulk staff rows accept `name`, `email`, and optional `slot override`. Role is always Staff. Extend the shared import field union and config with target `assignmentStaff`, canonical field `slotOverride`, documented header synonyms, integer/range validation, and row-level preview errors. Extend `importBatches.target` with `assignmentStaff`; its batch key is scoped by event plus target, and the durable result keeps the existing inserted/skipped/invalid row outcome shape. Duplicate active assignments are reported as skipped rather than producing multiple credentials. The batch transaction creates assignment/admission records and queues bounded email work; it does not send inline.

The revoke dialog says that access will end immediately but existing guests and tickets will remain. If usage is nonzero, it includes the exact used count and explicitly states that source attribution will be preserved. A grant reduction below usage uses equivalent warning copy and explains that new additions remain blocked until usage falls below the grant.

### Existing Guest tab

Add a Source column or equivalent field to desktop and mobile guest presentations:

- self-service guest: `Added by Artist {displayName}` or `Added by Staff {displayName}`;
- automatically created delegate admission: `Artist assignment · {displayName}` or `Staff assignment · {displayName}`;
- legacy/admin-created guest: the existing manual/default presentation.

Attribution is rendered from the immutable source snapshot stored on each guest row and remains visible after revocation without N+1 reads. The retained assignment remains the authorization/audit lineage, not the Guest-tab display join.

Existing organizer controls are source-aware. Editing a self-service row preserves its immutable source fields and requires a valid email; changing the normalized recipient clears the prior sent marker and queues a recipient-scoped ticket attempt. Removing a self-service row uses the shared sourced-guest removal helper so assignment and event counters stay consistent. An `assignment_admission` row linked to an active assignment cannot be removed through the generic Guest tab; revocation must end the assignment first. This preserves the invariant that every active assignment retains the admission it created.

## Delegate Experience

### Existing users

The signed-in dashboard queries active assignments for the current user and their verified normalized email. A “Manage guest list” action appears only when at least one assigned event has not ended. The destination lists eligible events when there are multiple assignments, then opens the selected assignment.

Past, revoked, cancelled, and otherwise inactive assignments do not make the dashboard action active. The authoritative cutoff is `hasEventEnded`: an explicit valid `endDate` ends at `now >= endDate`; without a valid explicit end it remains available through the event's start calendar day in the platform event timezone and ends after that day passes. Malformed start dates fail closed. Cancelled events are unavailable regardless of time. Tests cover equality at the explicit end instant and the no-`endDate` day-boundary fallback.

### Accountless users

The invitation email contains a reusable management URL carrying the bearer credential in its fragment. The destination scrubs the fragment before resolving the token server-side or showing event information. The organizer can resend the same active invitation through a newly issued pending credential; credential rotation invalidates the previous link only after provider acceptance and compare-and-promote completion.

### Management page

The page loads one narrow delegate view model containing display-safe event fields, assignment usage, delivery state, and a bounded first page of that assignment's guests. Add and edit require name and email. Remove explains that the ticket will no longer be valid.

Add is disabled when usage is at or above the grant, while edit and remove remain available. The server remains authoritative so concurrent tabs or requests cannot exceed the grant.

Changing a self-service guest's email resets delivery state and schedules the ticket to the new normalized address. Ticket-delivery deduplication is scoped by guest ID and normalized recipient, so a successful send to an old address cannot suppress delivery to the corrected address. Completion also verifies that the attempted recipient still matches the guest's current email; a late old-address success never marks the new address as sent. A failed send does not roll back or discard the admission; the page shows a retry state. Removing the guest follows the existing guest removal behavior and invalidates its QR admission because the record no longer exists.

## Backend and Frontend Contracts

Use a shared delegate-access validator with either `{kind: 'signedIn', assignmentId}` or `{kind: 'token', token}`. Token reads return a discriminated `available | unavailable` result with no reason detail; authorized mutations use a closed `ConvexError` code set: `UNAVAILABLE`, `INVALID_INPUT`, `QUOTA_FULL`, `RATE_LIMITED`, and `DELIVERY_IN_FLIGHT`. All list cursors use Convex `paginationOptsValidator`.

| Registered function | Authorization | Core arguments | Return/pagination behavior |
| --- | --- | --- | --- |
| `communities.management.guest_list_settings.get` | Community manager | `organizerId` | Effective artist/staff defaults |
| `communities.management.guest_list_settings.update` | Community manager | `organizerId`, both integer defaults | Saved defaults; explicit return validator |
| Existing community member-search query | Community manager | Selected organizer, search text, pagination | Community members only; reused rather than duplicated |
| `guest_list.assignments.getEventOverview` | Event manager | `eventId` | Constant-size stats view |
| `guest_list.assignments.listByEvent` | Event manager | `eventId`, pagination | Projected assignment rows; never credential metadata |
| `guest_list.assignments.create` | Event manager | Event, role, display name, email, optional selected `userId`, optional grant, `idempotencyKey` | Creates pending assignment/admission transactionally and schedules internal invite/ticket actions; returns organizer view |
| `guest_list.assignments.bulkCreateStaff` | Event manager | Event, `batchKey`, bounded assignment rows | Durable import outcome; schedules bounded internal invite/ticket work |
| `guest_list.assignments.updateGrant` | Event manager | Assignment, integer grant | Before/after usage and warning-relevant result |
| `guest_list.assignments.revoke` | Event manager | Assignment | Revoked result with retained guest count |
| `guest_list.assignments.resendInvite` | Event manager | Assignment, `idempotencyKey` | Queues one pending invite attempt and returns current invite state |
| `guest_list.delegate.listMine` | Signed-in user | Pagination | Active, non-ended assignments linked by user/verified email |
| `guest_list.delegate.getView` | Shared delegate access | Access union, guest cursor | `available` display-safe assignment/event plus bounded guests, or neutral `unavailable` |
| `guest_list.delegate.addGuest` | Shared delegate access | Access union, name, email, `idempotencyKey` | Created guest and queued ticket state |
| `guest_list.delegate.updateGuest` | Shared delegate access | Access union, guest ID, name, email | Updated guest and queued ticket state when email changed |
| `guest_list.delegate.removeGuest` | Shared delegate access | Access union, guest ID | Removed result and new usage |
| `guest_list.delegate.retryTicket` | Shared delegate access | Access union, guest ID | `queued | alreadySent | inFlight` after scheduling the internal automatic-send action |

Internal-only contracts include invite attempt execution, compare-and-promote/clear, automatic source-ticket send, counter repair, feature-state enablement, and migrations. Each internal action reloads authoritative rows; no internal function trusts a role, email, quota, or source relationship supplied by its caller.

Frontend services import `FunctionArgs<typeof api...>` and `FunctionReturnType<typeof api...>` for every contract and never redeclare backend wire shapes. Routes are:

- `/guest-lists` for the signed-in list reached by the dashboard action;
- `/guest-lists/:assignmentId` for signed-in management;
- `/guest-list/manage#token=...` for email entry, scrubbed immediately to `/guest-list/manage` and then backed by the assignment token store.

The accountless route is intentionally outside authenticated route guards. Its component renders no event content until `getView` returns `available`.

## Mutation and Email Flow

Creating an assignment is an organizer-authorized operation that:

1. validates the event, role, identity, grant, idempotency key, and duplicate status;
2. snapshots the applicable community default when no override is supplied;
3. creates the assignment in pending invite state and schedules the internal digest/token attempt;
4. resolves or creates the delegate's admission;
5. schedules the delegate admission ticket when a new admission was created;
6. queues the management invitation without persisting its raw token;
7. returns a non-sensitive organizer view model.

Adding a self-service guest is a delegate-authorized mutation that:

1. validates assignment access and event end time;
2. reads the assignment's transactional `usedSlots` counter;
3. rejects when `usedSlots` is at or above the grant;
4. creates the sourced guest row and increments assignment/event counters in the same transaction;
5. schedules the existing guest ticket action automatically.

Convex mutation serialization and the authoritative assignment counter update in one mutation prevent concurrent submissions from exceeding the grant without collecting child rows. Organizer and delegate removal of self-service rows route through one shared guest-removal helper so sourced counters cannot drift. Generic organizer removal rejects the admission created for an active assignment. Organizer and delegate self-service edits share the same source-preserving, required-email, recipient-reset behavior. Email delivery is asynchronous and recipient-scoped. Delivery failure preserves the admission and is retriable through the existing delivery/guest send-lock behavior.

The per-event stats document is an intentional human-paced write point: it receives assignment/quota/guest-list changes, not scans, check-ins, ticket purchases, or email-delivery status updates. This keeps overview reads constant-time without adding a new aggregate dependency. If deployment insights later show OCC contention on this document, the repairable stats design permits sharding or asynchronous aggregation without changing quota correctness, which remains anchored on each assignment's `usedSlots`.

Bulk assignment mutations enforce the repository import batch cap and keep each transaction within document/read/write budgets. Email work is queued through existing internal delivery/workpool patterns instead of sending inline or invoking one action per row serially. Reconciliation and email-key backfill use the installed migrations component with cursor-based batches, dry-run coverage, resumability, and explicit verification.

Reactive subscriptions are page-level and narrow: the first assignment page, one stats row, and the existing capped guest roster. Later assignment pages and expanded assignment guests use bounded point-in-time reads, not live subscriptions. The client invalidates later assignment pages when the reactive boundary changes and refetches an expanded guest first page when that assignment's reactive usage changes. No list item creates its own event, user, assignment, or source subscription. Dashboard/event-end reads follow the repository's shared time-gating pattern; server-authoritative time is retained even where it limits query caching because a client-supplied timestamp cannot be trusted for access control.

## Migration and Release Sequence

This is a staged widen/backfill/enable rollout using the installed `@convex-dev/migrations` component:

1. **Widen and dual-write:** add optional organizer/guest fields, new tables, validators, indexes, and disabled `guestListFeatureState`. Update every guest creator/editor/importer/remover plus testing seeds in the same change to maintain `emailKey`, preserve immutable source fields across `db.replace`, and maintain total-admission stats when a stats row exists. Public assignment/delegate functions remain fail-closed while disabled.
2. **Backfill:** run dry-run-tested, cursor-resumable migrations for existing guest `emailKey` values, per-event `totalGuestAdmissionCount`/stats rows, and historical `emailDeliveries.recipientKey` values. Run `backfillEmailDeliveryRecipientKeys` after its optional field and index deploy but before enabling self-service guest lists. No assignment admission lookup relies on the new guest email index before this completes; recipient-scoped delivery remains protected during the email-delivery migration by the bounded legacy fallback.
3. **Verify:** use migration status plus bounded verification functions to confirm every guest with an email has the expected normalized key and every event's guest count matches its stats row. Mark the two completion flags only through an internal verifier that rechecks the migration state.
4. **Enable:** set `enabledAt` only after both guest-list verification flags are true and the recipient-key migration has completed. The organizer/delegate UI checks the feature-state query and does not expose creation or token flows earlier. Existing deployments can safely run widened code while backfill is underway.
5. **Reconcile:** run the bounded counter reconciliation after enablement and retain it as an internal repair tool. Source fields remain optional because legacy/manual guests legitimately have no assignment source; no unsafe narrowing deploy is required.

Runbook instructions name the exact migration functions, dry-run/status/verification commands, enable function, and rollback behavior after implementation confirms their generated names. The agent does not execute these against production.

## Error and Edge-Case Behavior

- An assignment cannot be created with a negative, fractional, or unreasonably large grant; the implementation uses a documented upper bound shared by backend and UI validation.
- Duplicate normalized emails in a bulk upload are skipped with row-level outcomes.
- A delegate cannot view or modify another assignment's guests, even for the same event.
- An organizer may edit self-service sourced guests through source-aware organizer controls; a valid email remains required and a changed address queues recipient-scoped delivery.
- Organizer removal of a self-service sourced guest immediately reduces the assignment's used count.
- The admission created for an active assignment cannot be removed through generic organizer controls. After revocation, ordinary removal policy applies without erasing attribution from retained rows.
- Revocation and below-usage reductions never delete or detach existing guest sources.
- Event cancellation follows the event's established admission policy; self-service management is unavailable when the shared access helper considers the event closed. The implementation must not invent a second lifecycle rule.
- If the delegate already has a valid ticket, assignment creation does not send or create a duplicate admission ticket. The management invitation is still sent.
- If invitation delivery fails, the assignment remains visible to the organizer with a retry state; the bearer secret is not logged or returned after the sending boundary.
- Member search never reveals users outside the selected community, and arbitrary-email assignment responses never reveal whether the email maps to an account.
- Raw invite credentials are absent from query strings, logs, analytics, audit rows, persisted database fields, and organizer API responses.
- Guest source labels require no assignment join, member/admission lookup uses indexes, and UI list items do not create N+1 subscriptions.

## Testing Strategy

Backend tests cover:

- effective 2/2 defaults and snapshot behavior;
- explicit per-person overrides;
- user-linked and accountless credential access;
- verified-email linking for a later-created account;
- digest-only lookup, credential rotation, revocation, and neutral invalid-link results;
- event-end cutoff using the shared event-time behavior;
- existing-ticket/guest admission deduplication;
- assignment admission creation, attribution, non-slot usage, and ticket scheduling;
- self-service add/edit/remove ownership and required email validation;
- atomic quota enforcement, including concurrent requests and grants below usage;
- retained guests and attribution after revocation;
- bulk staff validation, idempotency, duplicate handling, and optional overrides;
- per-assignment and per-event counter maintenance plus reconciliation;
- email scheduling, failures, retry behavior, and changed-email delivery state;
- recipient-scoped delivery deduplication, including a previously delivered guest whose email changes and a late completion for the old recipient;
- optional recipient-key writes, indexed lookup, bounded legacy fallback, migration patching, and fail-closed behavior above the legacy scan cap;
- source-aware organizer edits/removals and rejection of active assignment-admission deletion;
- authorization rejection for non-managing organizers and unrelated delegates;
- internal automatic-send source validation versus public admin resend authorization;
- staged feature-state/backfill guards, replace-path source preservation, and total-admission counter maintenance;
- invitation pending/accepted/failed states, attempt ownership, provider failure, late bounce behavior, and compare-and-promote/clear;
- `assignmentStaff` import parsing, durable batch target, row outcomes, batch cap, and queued fan-out;
- exact `hasEventEnded` boundary/fallback behavior and `valid | used` ticket deduplication;
- token-fragment scrubbing, neutral invalid-token results, rate limits, PII-minimized audit events, and two-phase credential rotation;
- bounded batch/function budgets, indexed admission lookup, subscription count, and stats-document contention assumptions;

Frontend tests use Angular CDK harnesses and cover:

- community settings defaults and accessible help-tip content;
- defaults loading/error gating that prevents unresolved 2/2 values from being saved;
- member search/email assignment and override behavior;
- optional override range validation, selected-member unlinking after email edits, and semantic native search-result controls;
- assignment usage, totals, source labels, resend, edit, and revoke warnings;
- assignment-page deduplication/invalidation and expanded-guest refetch after usage changes;
- shared bulk-import integration for staff;
- dashboard action visibility for active future assignments only;
- signed-in and token-based delegate loading states;
- full-quota, below-usage, revoked, ended, invalid-link, and email-failure states;
- delegate add/edit/remove behavior without raw DOM selectors.
- assignment-token storage, fragment scrub ordering, SSR no-op, unavailable cleanup, shared-device logout cleanup, and Forget action;
- generated `FunctionArgs`/`FunctionReturnType` contract use and signed-in/accountless route behavior.

Affected E2E coverage validates one signed-in delegate flow and one accountless flow, including the organizer's resulting source attribution and automatic ticket-email capture. Verification uses the repository E2E serve/run split and affected-test selection.

## Operational Documentation

Update `docs/runbooks/email-delivery.md` with the new invitation, delegate-admission, and automatic self-service guest ticket triggers, including retry behavior. Update `docs/runbooks/admin-operations.md` with defaults, assignment lifecycle, quota reduction, revocation, source preservation, bulk staff import, and accountless-link behavior.

## Out of Scope

- Delegating permissions other than guest-list management.
- Community-wide artist/staff identity profiles independent of an event.
- Retroactively changing existing assignment grants when a community default changes.
- Automatically deleting sourced guests on revocation or quota reduction.
- Requiring an account for email-only delegates.
- A configurable cutoff separate from event end time.

## Best Practices Audit

Pass 1 applied the Convex best-practices checklist to the approved design.

- Replaced per-add child-row counting and overview collection with transactional `usedSlots` and `guestListEventStats` counters. This avoids `.collect().length`, reduces subscription cost, and gives concurrent quota writes one authoritative assignment document.
- Required paginated assignment lists and bounded source-guest queries instead of unbounded event collections.
- Added explicit argument/return validators, shared input caps, internal function boundaries, and idempotency keys for credential/email-producing operations.
- Required one shared sourced-guest removal helper so organizer and delegate deletion paths update counters consistently.
- Added bounded, resumable counter reconciliation and corresponding tests.

## Security Audit

Pass 2 re-read the Pass 1 design and applied the Convex security-audit checklist.

- Tightened verified-email linking so it is server-sourced, requires a verified email, and cannot override an assignment already bound to another user.
- Scoped member search to the selected community and prevented arbitrary-email flows from disclosing account existence.
- Moved bearer credentials from query strings to scrubbed URL fragments and prohibited raw-token capture by logs, analytics, audit events, database fields, and organizer responses.
- Defined two-phase digest-only credential rotation so a failed resend cannot invalidate the last working link or persist plaintext.
- Added operation-specific rate limits for public delegate and organizer email/creation paths with neutral token-resolution errors.
- Restricted delegate return shapes to the authorized assignment and required internal email actions to reload authoritative records.
- Added PII-minimized audit logging for sensitive assignment and delegate mutations.

## Performance Audit

Pass 3 re-read the security-hardened design and applied the Convex performance-audit workflow using the hot-path, OCC, subscription, and function-budget checklists. No production insights were queried because this is a pre-implementation feature; findings are based on the concrete organizer/delegate read-write paths and current repository components.

- Snapshotted source role/name onto guest rows so the existing Guest tab avoids N+1 assignment reads while retaining immutable attribution.
- Required indexed member, ticket, guest-email, assignment, and source lookups; no scan-plus-filter path is part of admission or access resolution.
- Collapsed the delegate page into one narrow view model and limited reactive subscriptions to page-level resources, with expanded-row guest queries skipped unless selected.
- Kept assignment `usedSlots` as the quota correctness point and documented the event stats row as a low-frequency overview optimization, including the measured-signal threshold for future sharding.
- Bounded bulk mutations and routed email fan-out through existing delivery/workpool patterns; required migrations-component batching and verification for backfill/reconciliation.
- Preserved server-authoritative event time despite cache cost because client time cannot safely enforce access. This records the deliberate security-over-cache tradeoff.

## Code Review

Pass 4 used an independent code-reviewer agent to re-read the fully audited spec against current guest, email, migration, schema, import, event-time, route, and token-store code.

- Replaced the impossible scheduler call to the admin-authenticated public ticket action with a source-validating internal automatic-send action that reuses the existing lock and delivery ledger.
- Added a dedicated `guestListAuditEvents` model that can represent accountless actors without weakening the closed admin audit contract.
- Added a fail-closed staged rollout with dual writes, replace-field preservation, resumable backfills, verification flags, and explicit enablement before assignment creation.
- Defined invitation state/attempt fields and provider-acceptance compare-and-promote/clear choreography, including late bounce semantics.
- Added `totalGuestAdmissionCount`, named every write path that maintains it, and corrected the spec to retain the current capped guest roster rather than claiming pagination.
- Added a concrete registered-function contract table, error union, generated frontend typing requirement, and signed-in/accountless routes.
- Expanded import reuse into an explicit `assignmentStaff` target with slot override parsing, durable batch scope/outcomes, limits, and queued email behavior.
- Named `hasEventEnded` and documented its exact explicit-end, day-boundary fallback, malformed-date, cancellation, and equality semantics.
- Defined admission validity/status and the ticket/guest indexes needed for user/email deduplication.
- Replaced the nonexistent generic token abstraction with a dedicated assignment token store and specified fragment scrub ordering, browser/SSR behavior, persistence, and cleanup.
- The ten review findings produced the contract, rollout, routing, import, event-time, admission, and token-store changes listed above.

## Corrective Audit Addendum

### Best Practices corrective pass

Recorded recipient-scoped idempotency for changed-email delivery, one source-aware organizer edit/removal path, the active-assignment admission invariant, and server-aligned defaults and override validation.

### Security corrective pass

Recorded selected-member unlinking when email identity diverges, source ownership checks for organizer edits, generic-deletion protection for active delegate admissions, and current-recipient matching for late delivery completions.

### Performance corrective pass

Recorded the reactive first assignment page, point-in-time later pages, pagination-boundary invalidation, assignment-ID deduplication, and bounded expanded-guest refetch on usage change. Added the optional normalized delivery key and its capped legacy fallback to make the rollout read path explicit.

### Code Review corrective pass

Recorded loading/error states, override validation, identity unlinking, recipient-aware ticket delivery, source-aware organizer mutations, admission deletion protection, pagination invalidation, bounded guest refresh, native search-result semantics, and the recipient-key migration-before-enable sequence in the body and testing strategy.
