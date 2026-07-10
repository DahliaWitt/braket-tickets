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
- Access and mutations remain available through the event end instant. They stop after the event ends or immediately upon assignment revocation.
- Revoking an assignment preserves guests already added through it and preserves their source attribution.
- Lowering a grant below current usage preserves existing guests. It blocks additions until usage is below the new grant while continuing to allow edits and removals.
- Every self-service guest receives their ticket email automatically.
- Bulk staff assignment reuses the existing paste/CSV import surface and accepts name, email, and an optional per-event slot override.

## Architecture

The feature introduces a dedicated per-event guest-list assignment rather than making a guest record double as a permission grant. An assignment represents the relationship between an event and an artist or staff delegate. It owns identity resolution, role, quota, access credential, status, audit metadata, and the optional admission created for the delegate.

The existing `guests` table remains the event admission source for organizer-created guests, delegate admissions, and guests created through self-service. New optional source fields link self-service rows to their assignment. This keeps scanning, roster, PDF generation, broadcasts, and ticket-email delivery on the current admission path.

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
- `status`: `active | revoked`
- digest-only reusable bearer credential metadata: `tokenDigest` and `tokenPrefix`
- `createdBy`, `createdAt`, and `invitedAt`
- optional `lastInviteSentAt`, `redeemedAt`, `revokedAt`, and `revokedBy`
- optional `admissionGuestId` when the assignment created a new guest admission

Indexes support event lists, organizer lists, signed-in user lists, verified-email discovery, and token lookup. Active status and event end time are checked after indexed lookup; the bearer token is never stored in plaintext.

Only one non-revoked assignment may exist for the same event and normalized email. Re-inviting a revoked identity creates a new assignment and credential rather than reactivating an old bearer token.

### Guest attribution and admission deduplication

Add optional fields to `guests`:

- normalized `emailKey`
- `sourceAssignmentId`
- `sourceKind`: `assignment_admission | self_service`

Existing rows remain valid with these fields absent. All guest write paths—single add, edit, bulk import, tests, and seeds—populate or maintain `emailKey` when an email exists. A migration backfills existing guest emails so assignment admission checks can use an event/email index reliably.

When an assignment is created, a shared admission resolver checks for a valid admission in this order:

1. a valid event ticket belonging to the linked user;
2. a valid event ticket matching the normalized verified email where the current ticket model exposes that identity;
3. an existing non-removed guest admission with the same normalized email.

If no valid admission exists, the assignment creates a guest row with the appropriate existing backend guest type (`artist guest` or `staff`), `sourceKind: assignment_admission`, and the assignment ID. The organizer UI presents an assignment admission as “Artist” or “Staff” rather than “Artist guest.” The new admission is immediately scheduled through the existing guest ticket-email path. It is not included in the assignment usage query.

## Authorization and Credentials

Organizer assignment management uses the existing event/community management checks from `backend/convex/lib/access.ts`. Feature code does not call the authorization component directly.

Delegate authorization has two equivalent entry paths:

- **Signed-in:** the current user matches `assignment.userId`, or their verified normalized account email matches the assignment. A successful verified-email match may link the assignment to that user for future indexed queries.
- **Accountless:** the presented token hashes to the assignment's purpose-scoped digest.

Both paths then require all of the following:

- assignment status is active;
- the assignment belongs to the requested event;
- the event has not ended according to the shared event-time helper;
- the requested guest is linked to the same assignment for edit/remove operations.

Invalid, revoked, or expired links return a neutral unavailable state without event, identity, usage, or roster details. Revocation immediately invalidates the credential. Tokens remain reusable until revocation or event end because delegates are expected to make several updates over time.

## Organizer Experience

### Community Settings

Add a Guest List Defaults section with non-negative numeric inputs for Artist slots and Staff slots. Both show 2 when no explicit value has been saved.

An accessible help tip, available on hover and keyboard focus, states: “Defaults are copied when a person is assigned. Changing a default affects future assignments only. Existing event assignments keep their current grant.”

### Event guest-list management

Extend the event Guest List area with an overview and an Artists & Staff assignment view.

The overview shows:

- self-service slots used out of total granted across active and revoked assignments;
- artist usage and staff usage;
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

Bulk staff rows accept `name`, `email`, and optional `slot override`. Role is always Staff. Preview, parsing, validation, row outcomes, idempotent batch behavior, and paste/CSV interaction reuse the current import implementation. Duplicate active assignments are reported as skipped rather than producing multiple credentials.

The revoke dialog says that access will end immediately but existing guests and tickets will remain. If usage is nonzero, it includes the exact used count and explicitly states that source attribution will be preserved. A grant reduction below usage uses equivalent warning copy and explains that new additions remain blocked until usage falls below the grant.

### Existing Guest tab

Add a Source column or equivalent field to desktop and mobile guest presentations:

- self-service guest: `Added by Artist {displayName}` or `Added by Staff {displayName}`;
- automatically created delegate admission: `Artist assignment · {displayName}` or `Staff assignment · {displayName}`;
- legacy/admin-created guest: the existing manual/default presentation.

Attribution is read through the retained assignment record and remains visible after revocation.

## Delegate Experience

### Existing users

The signed-in dashboard queries active assignments for the current user and their verified normalized email. A “Manage guest list” action appears only when at least one assigned event has not ended. The destination lists eligible events when there are multiple assignments, then opens the selected assignment.

Past, revoked, and otherwise inactive assignments do not make the dashboard action active.

### Accountless users

The invitation email contains a reusable management URL carrying the bearer credential. The destination resolves the token server-side before showing any event information. The organizer can resend the same active invitation through a newly issued credential; credential rotation invalidates the previous link only after the replacement email is successfully queued according to the established email-delivery pattern.

### Management page

The page shows event identity, role, `used / granted`, an Add Guest action, and only the entries sourced from the current assignment. Add and edit require name and email. Remove explains that the ticket will no longer be valid.

Add is disabled when usage is at or above the grant, while edit and remove remain available. The server remains authoritative so concurrent tabs or requests cannot exceed the grant.

Changing a self-service guest's email resets delivery state and schedules the ticket to the new normalized address. A failed send does not roll back or discard the admission; the page shows a retry state. Removing the guest follows the existing guest removal behavior and invalidates its QR admission because the record no longer exists.

## Mutation and Email Flow

Creating an assignment is an organizer-authorized operation that:

1. validates the event, role, identity, grant, and duplicate status;
2. snapshots the applicable community default when no override is supplied;
3. creates the digest-backed assignment credential;
4. resolves or creates the delegate's admission;
5. schedules the delegate admission ticket when a new admission was created;
6. sends the management invitation;
7. returns a non-sensitive organizer view model.

Adding a self-service guest is a delegate-authorized mutation that:

1. validates assignment access and event end time;
2. counts current `self_service` rows for that assignment;
3. rejects when usage is at or above the grant;
4. creates the sourced guest row;
5. schedules the existing guest ticket action automatically.

Convex mutation serialization and the authoritative count/write in one mutation prevent concurrent submissions from exceeding the grant. Email delivery is asynchronous. Delivery failure preserves the admission and is retriable through the existing delivery/guest send-lock behavior.

## Error and Edge-Case Behavior

- An assignment cannot be created with a negative, fractional, or unreasonably large grant; the implementation uses a documented upper bound shared by backend and UI validation.
- Duplicate normalized emails in a bulk upload are skipped with row-level outcomes.
- A delegate cannot view or modify another assignment's guests, even for the same event.
- An organizer may edit or remove sourced guests through existing organizer controls.
- Organizer removal of a sourced guest immediately reduces the assignment's used count.
- Revocation and below-usage reductions never delete or detach existing guest sources.
- Event cancellation follows the event's established admission policy; self-service management is unavailable when the shared access helper considers the event closed. The implementation must not invent a second lifecycle rule.
- If the delegate already has a valid ticket, assignment creation does not send or create a duplicate admission ticket. The management invitation is still sent.
- If invitation delivery fails, the assignment remains visible to the organizer with a retry state; the bearer secret is not logged or returned after the sending boundary.

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
- email scheduling, failures, retry behavior, and changed-email delivery state;
- authorization rejection for non-managing organizers and unrelated delegates.

Frontend tests use Angular CDK harnesses and cover:

- community settings defaults and accessible help-tip content;
- member search/email assignment and override behavior;
- assignment usage, totals, source labels, resend, edit, and revoke warnings;
- shared bulk-import integration for staff;
- dashboard action visibility for active future assignments only;
- signed-in and token-based delegate loading states;
- full-quota, below-usage, revoked, ended, invalid-link, and email-failure states;
- delegate add/edit/remove behavior without raw DOM selectors.

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
