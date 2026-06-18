/**
 * Unified access-decision module.
 *
 * Every authorization check in the application should route through this
 * module. It consolidates event, community, and platform permission checks
 * into a single surface so callers never need to reason about scope fallback,
 * trust-link traversal, or visibility semantics directly.
 *
 * Implementation details:
 * - Scoped permission checks fall back to global scope for root_admin coverage.
 * - Purchase access resolves the full trust ladder: open_access -> direct -> shared -> denied.
 * - Visibility helpers in this module resolve the `visibility` enum and event lifecycle.
 *
 * Performance notes:
 *
 * canWithFallback first runs the scoped authz.can() query. If that denies,
 * it falls back to a per-request-memoized `isPlatformAdmin` probe (cached on
 * the ctx via WeakMap, keyed by userId). The `root_admin` role is the only
 * source of global permission grants (see ROLES in `authz.ts`), and it holds
 * every permission, so `platform:admin` is a valid proxy for "does any global
 * grant apply to this call?" — and caching it collapses N repeat admin probes
 * per request down to 1.
 *
 *  - non-admin, scoped grant present: 1 authz.can() call.
 *  - non-admin, scoped grant absent:  1 authz.can() + 1 platform:admin probe
 *    (cached thereafter — O(1) for every subsequent canWithFallback call
 *    in the same request with the same userId).
 *  - admin, first call:               1 scoped + 1 global. Admin cache fills.
 *  - admin, subsequent calls:         1 scoped + cached lookup (no component
 *    query). The scoped check still runs first because a cache-returning-true
 *    cannot short-circuit without breaking the negative-cache path.
 *
 * canPurchaseEvent worst case (denied after full trust traversal, N trust links):
 * (N+1) scoped authz.can() calls + 1 platform:admin probe + 1 relation query
 * + N db.get(trusted orgs). N is bounded by assertTrustLinkLimit. Typical N < 10.
 *
 * Naming convention:
 *
 * can* functions: canViewEvent, canEditEvent, canPurchaseEvent, etc.
 * require* functions: requireViewEvent, requireEditEvent, requireEventPurchase, etc.
 * Both use verb-first ordering (canViewX, requireViewX) for consistency.
 * requireEventPurchase is the exception — it returns PurchaseAccessGranted,
 * so the noun-first name distinguishes it from the void-returning require* functions.
 */

import type {Doc, Id} from '../_generated/dataModel';
import {internalQuery} from '../_generated/server';
import {v} from 'convex/values';
import {EVENT_VISIBILITY} from '@shared/domain/event-visibility';
import {organizerScope, authzUserId} from './authz';
import {
  derivePublicationStatus,
  isPublishedCommunity,
} from './community_status';
import {throwNotFound, throwUnauthorized} from './errors';
import {requireUser} from './auth_identity';
import {
  type AccessCtx,
  canWithFallback,
  isPlatformAdminCached,
} from './access/permissions';
import {resolvePurchaseAccessForUser} from './access/purchase';

// Re-export canonical publication-status helpers so callers already importing
// them from `lib/access.ts` keep working. Single source lives in
// `lib/community_status.ts`.
export {derivePublicationStatus, isPublishedCommunity};
export {
  canPurchaseEvent,
  canPurchaseEventForUser,
  canReceiveTicketTransferForUser,
  isOpenAccess,
  requireEventPurchase,
  resolvePurchaseAccessForUser,
  type PurchaseAccess,
  type PurchaseAccessGranted,
} from './access/purchase';

// Shared types

export type EventAnalyticsAccess =
  | {authorized: true; isDoorStaff: boolean}
  | {authorized: false; isDoorStaff: false};

type EventVisibilityOrganizer = Pick<
  Doc<'organizers'>,
  '_id' | 'status'
> | null;

type EventViewOptions = {
  organizer?: EventVisibilityOrganizer;
};

/**
 * True for `'public_viewable'` and `'public'` events.
 * Used in RLS read rules and availability queries to allow unauthenticated access.
 */
export function isPubliclyVisible(event: Doc<'events'>): boolean {
  return (
    event.visibility === EVENT_VISIBILITY.PUBLIC_VIEWABLE ||
    event.visibility === EVENT_VISIBILITY.PUBLIC
  );
}

// Private helpers

async function loadEventOrganizer(
  ctx: AccessCtx,
  event: Doc<'events'>,
  options?: EventViewOptions,
): Promise<EventVisibilityOrganizer> {
  if (options?.organizer !== undefined) {
    return options.organizer;
  }
  return ctx.db.get('organizers', event.organizerId);
}

function requiresScopedEventView(
  event: Doc<'events'>,
  organizer: EventVisibilityOrganizer,
): boolean {
  return (
    event.status !== 'published' ||
    organizer === null ||
    !isPublishedCommunity(organizer)
  );
}

// Event access

/**
 * Whether a user (or anonymous visitor) can view an event.
 *
 * This is the single source of truth for event read access:
 * - Draft, cancelled, orphaned, and draft-community events require scoped event:view.
 * - Published public/public_viewable events in live communities are readable by everyone.
 * - Published private events in live communities require purchase eligibility.
 */
export async function canViewEvent(
  ctx: AccessCtx,
  userId: Id<'users'> | null,
  event: Doc<'events'>,
  options?: EventViewOptions,
): Promise<boolean> {
  const organizer = await loadEventOrganizer(ctx, event, options);
  if (
    event.status === 'published' &&
    organizer &&
    isPublishedCommunity(organizer)
  ) {
    if (isPubliclyVisible(event)) return true;

    if (userId !== null) {
      const purchaseAccess = await resolvePurchaseAccessForUser(
        ctx,
        userId,
        event.organizerId,
      );
      if (purchaseAccess.allowed) return true;
    }
  }

  if (userId !== null && requiresScopedEventView(event, organizer)) {
    return canWithFallback(
      ctx,
      authzUserId(userId),
      'event:view',
      organizerScope(event.organizerId),
    );
  }
  return false;
}

export async function filterViewableEvents(
  ctx: AccessCtx,
  userId: Id<'users'> | null,
  events: ReadonlyArray<Doc<'events'>>,
): Promise<Doc<'events'>[]> {
  const uniqueOrganizerIds = [
    ...new Set(events.map((event) => event.organizerId)),
  ];
  const organizers = await Promise.all(
    uniqueOrganizerIds.map((organizerId) =>
      ctx.db.get('organizers', organizerId),
    ),
  );
  const organizerById = new Map(
    uniqueOrganizerIds.map((organizerId, index) => [
      organizerId,
      organizers[index] ?? null,
    ]),
  );

  const decisions = await Promise.all(
    events.map((event) =>
      canViewEvent(ctx, userId, event, {
        organizer: organizerById.get(event.organizerId) ?? null,
      }),
    ),
  );

  return events.filter((_, index) => decisions[index]);
}

/**
 * Whether a user can view the event roster (attendee list).
 *
 * - Event managers can always see the roster.
 * - Roster-scoped users (scanners) can see it only for published events.
 */
export async function canViewEventRoster(
  ctx: AccessCtx,
  userId: Id<'users'>,
  event: Doc<'events'>,
): Promise<boolean> {
  if (
    await canWithFallback(
      ctx,
      authzUserId(userId),
      'event:manage',
      organizerScope(event.organizerId),
    )
  ) {
    return true;
  }
  if (
    (await canWithFallback(
      ctx,
      authzUserId(userId),
      'event:roster',
      organizerScope(event.organizerId),
    )) &&
    event.status === 'published'
  ) {
    return true;
  }
  return false;
}

export async function canCreateEvent(
  ctx: AccessCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<boolean> {
  return canWithFallback(
    ctx,
    authzUserId(userId),
    'event:create',
    organizerScope(organizerId),
  );
}

export async function canEditEvent(
  ctx: AccessCtx,
  userId: Id<'users'>,
  event: Doc<'events'>,
): Promise<boolean> {
  return canWithFallback(
    ctx,
    authzUserId(userId),
    'event:edit',
    organizerScope(event.organizerId),
  );
}

export async function canManageEvent(
  ctx: AccessCtx,
  userId: Id<'users'>,
  event: Doc<'events'>,
): Promise<boolean> {
  return canWithFallback(
    ctx,
    authzUserId(userId),
    'event:manage',
    organizerScope(event.organizerId),
  );
}

/**
 * Whether a user can scan (check in) tickets at an event.
 *
 * - Event managers can scan any status (handles pre-publish dry runs and
 *   post-cancellation cleanups authorized by an admin).
 * - Scanner-scoped users can scan only published events. Draft and cancelled
 *   events are not scannable by non-admin scanners.
 *
 * Mirrors `canViewEventRoster` so the read and write boundaries for door
 * staff stay aligned on the same lifecycle gate.
 */
export async function canScanEvent(
  ctx: AccessCtx,
  userId: Id<'users'>,
  event: Doc<'events'>,
): Promise<boolean> {
  if (
    await canWithFallback(
      ctx,
      authzUserId(userId),
      'event:manage',
      organizerScope(event.organizerId),
    )
  ) {
    return true;
  }
  if (
    (await canWithFallback(
      ctx,
      authzUserId(userId),
      'event:scan',
      organizerScope(event.organizerId),
    )) &&
    event.status === 'published'
  ) {
    return true;
  }
  return false;
}

/**
 * Resolve access for event analytics and roster read models.
 *
 * Community admins and platform admins receive full analytics access. Door
 * staff with scan permission receive analytics access with PII restrictions;
 * callers use `isDoorStaff` to suppress email fields and email search.
 */
export async function resolveEventAnalyticsAccess(
  ctx: AccessCtx,
  userId: Id<'users'>,
  event: Doc<'events'> | null,
): Promise<EventAnalyticsAccess> {
  if (!event) return {authorized: false, isDoorStaff: false};

  if (await isPlatformAdmin(ctx, userId)) {
    return {authorized: true, isDoorStaff: false};
  }

  if (await canManageCommunity(ctx, userId, event.organizerId)) {
    return {authorized: true, isDoorStaff: false};
  }

  if (await canScanEvent(ctx, userId, event)) {
    return {authorized: true, isDoorStaff: true};
  }

  return {authorized: false, isDoorStaff: false};
}

// Community access

/**
 * Whether a user (or anonymous visitor) can view a community.
 *
 * - Published communities in the public directory are viewable by everyone.
 * - Otherwise requires scoped community:view permission.
 */
export async function canViewCommunity(
  ctx: AccessCtx,
  userId: Id<'users'> | null,
  organizer: Doc<'organizers'>,
): Promise<boolean> {
  if (isPublishedCommunity(organizer) && organizer.isPublicDirectory) {
    return true;
  }
  if (userId !== null) {
    return canWithFallback(
      ctx,
      authzUserId(userId),
      'community:view',
      organizerScope(organizer._id),
    );
  }
  return false;
}

/**
 * Whether a user can read a community for the public vetting flow.
 *
 * This allows authenticated callers to load published communities that are
 * accepting applications, even when they are not in the public directory.
 */
export async function canViewCommunityForVetting(
  _ctx: AccessCtx,
  userId: Id<'users'> | null,
  organizer: Pick<Doc<'organizers'>, 'status' | 'vettingQuestions'>,
): Promise<boolean> {
  if (userId === null) {
    return false;
  }

  if (!isPublishedCommunity(organizer)) {
    return false;
  }

  return (organizer.vettingQuestions?.length ?? 0) > 0;
}

export async function canViewCommunityMembers(
  ctx: AccessCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<boolean> {
  return canWithFallback(
    ctx,
    authzUserId(userId),
    'community:members',
    organizerScope(organizerId),
  );
}

export async function canManageCommunity(
  ctx: AccessCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<boolean> {
  return canWithFallback(
    ctx,
    authzUserId(userId),
    'community:admin',
    organizerScope(organizerId),
  );
}

// Platform admin

export async function isPlatformAdmin(
  ctx: AccessCtx,
  userId: Id<'users'>,
): Promise<boolean> {
  // Route through the shared per-request cache so a handler that calls both
  // `isPlatformAdmin(...)` directly and `canWithFallback(...)` indirectly
  // only issues one `platform:admin` component query.
  return isPlatformAdminCached(ctx, authzUserId(userId));
}

export async function requirePlatformAdmin(
  ctx: AccessCtx,
  userId: Id<'users'>,
): Promise<void> {
  if (!(await isPlatformAdmin(ctx, userId))) {
    throwUnauthorized();
  }
}

// Composite: event staff access

/**
 * Whether a user has any staff-level access to an event.
 * True if the user can edit, view the roster, or scan the event.
 *
 * Implementation dedupes the `event:manage` and lifecycle-gate probes that
 * `canViewEventRoster` and `canScanEvent` each perform independently. We
 * short-circuit on `event:manage` first (bypasses lifecycle gate for both
 * roster and scan), then `event:edit` (no lifecycle gate), then — only if
 * the event is `published` — run roster and scan in parallel. This keeps
 * behavior identical to the three-function OR chain while cutting the
 * worst-case authz query count on denial paths.
 */
export async function hasEventStaffAccess(
  ctx: AccessCtx,
  userId: Id<'users'>,
  event: Doc<'events'>,
): Promise<boolean> {
  const scope = organizerScope(event.organizerId);
  const uid = authzUserId(userId);

  if (await canWithFallback(ctx, uid, 'event:manage', scope)) {
    return true;
  }
  if (await canWithFallback(ctx, uid, 'event:edit', scope)) {
    return true;
  }
  if (event.status !== 'published') {
    return false;
  }
  const [canRoster, canScan] = await Promise.all([
    canWithFallback(ctx, uid, 'event:roster', scope),
    canWithFallback(ctx, uid, 'event:scan', scope),
  ]);
  return canRoster || canScan;
}

// Require variants (throw on denial)

export async function requireViewEvent(
  ctx: AccessCtx,
  userId: Id<'users'> | null,
  event: Doc<'events'>,
): Promise<void> {
  if (!(await canViewEvent(ctx, userId, event))) {
    throwUnauthorized();
  }
}

export async function requireViewEventRoster(
  ctx: AccessCtx,
  userId: Id<'users'>,
  event: Doc<'events'>,
): Promise<void> {
  if (!(await canViewEventRoster(ctx, userId, event))) {
    throwUnauthorized();
  }
}

export async function requireCreateEvent(
  ctx: AccessCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  if (!(await canCreateEvent(ctx, userId, organizerId))) {
    throwUnauthorized();
  }
}

export async function requireEditEvent(
  ctx: AccessCtx,
  userId: Id<'users'>,
  event: Doc<'events'>,
): Promise<void> {
  if (!(await canEditEvent(ctx, userId, event))) {
    throwUnauthorized();
  }
}

/**
 * Require the caller to be allowed to reassign an event into a destination community.
 *
 * IMPORTANT: this is only the destination-community gate. Callers must still
 * separately require edit access on the source event (scoped to the source organizer).
 *
 * We intentionally require destination community admin rights (not just event:create)
 * because cross-community reassignment is a tenant-boundary operation.
 */
export async function requireReassignEventOrganizer(
  ctx: AccessCtx,
  userId: Id<'users'>,
  destinationOrganizerId: Id<'organizers'>,
): Promise<void> {
  await requireManageCommunity(ctx, userId, destinationOrganizerId);
}

export async function requireManageEvent(
  ctx: AccessCtx,
  userId: Id<'users'>,
  event: Doc<'events'>,
): Promise<void> {
  if (!(await canManageEvent(ctx, userId, event))) {
    throwUnauthorized();
  }
}

export async function requireScanEvent(
  ctx: AccessCtx,
  userId: Id<'users'>,
  event: Doc<'events'>,
): Promise<void> {
  if (!(await canScanEvent(ctx, userId, event))) {
    throwUnauthorized();
  }
}

export async function requireViewCommunity(
  ctx: AccessCtx,
  userId: Id<'users'> | null,
  organizer: Doc<'organizers'>,
): Promise<void> {
  if (!(await canViewCommunity(ctx, userId, organizer))) {
    throwUnauthorized();
  }
}

export async function requireViewCommunityMembers(
  ctx: AccessCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  if (!(await canViewCommunityMembers(ctx, userId, organizerId))) {
    throwUnauthorized();
  }
}

export async function requireManageCommunity(
  ctx: AccessCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  if (!(await canManageCommunity(ctx, userId, organizerId))) {
    throwUnauthorized();
  }
}

export async function requireEventStaffAccess(
  ctx: AccessCtx,
  userId: Id<'users'>,
  event: Doc<'events'>,
): Promise<void> {
  if (!(await hasEventStaffAccess(ctx, userId, event))) {
    throwUnauthorized();
  }
}

// Composed load-and-authorize helpers
//
// Each combines `requireUser` + `loadEventOrThrow` + the appropriate
// `require*` gate so the "authenticate → load → authorize" preamble
// cannot drift across callers. Returns both documents so callers avoid
// redundant DB reads.

/**
 * Load an event by ID or throw NOT_FOUND.
 *
 * Canonical null-check so every caller that needs the event document
 * (and cannot meaningfully continue without it) throws the same error
 * shape. Prefer this over inline `if (!event) throw…` — it guarantees
 * the error carries the structured `{code, message}` payload that
 * clients can branch on.
 */
export async function loadEventOrThrow(
  ctx: AccessCtx,
  eventId: Id<'events'>,
): Promise<Doc<'events'>> {
  const event = await ctx.db.get('events', eventId);
  if (!event) {
    throwNotFound('Event');
  }
  return event;
}

/**
 * Load an event and require edit access.
 *
 * Throws:
 * - UNAUTHENTICATED if no session
 * - NOT_FOUND if the event does not exist
 * - UNAUTHORIZED if the caller lacks edit permission
 */
export async function requireEventForEdit(
  ctx: AccessCtx,
  eventId: Id<'events'>,
): Promise<{user: Doc<'users'>; event: Doc<'events'>}> {
  const user = await requireUser(ctx);
  const event = await loadEventOrThrow(ctx, eventId);
  await requireEditEvent(ctx, user._id, event);
  return {user, event};
}

/**
 * Load an event and require manage access.
 *
 * Same composition and error set as {@link requireEventForEdit}, but
 * gates on the manage permission instead of edit.
 */
export async function requireEventForManage(
  ctx: AccessCtx,
  eventId: Id<'events'>,
): Promise<{user: Doc<'users'>; event: Doc<'events'>}> {
  const user = await requireUser(ctx);
  const event = await loadEventOrThrow(ctx, eventId);
  await requireManageEvent(ctx, user._id, event);
  return {user, event};
}

/**
 * Load an event and require roster view access.
 *
 * Same composition as {@link requireEventForEdit} but gates on the
 * roster view permission.
 */
export async function requireEventForRoster(
  ctx: AccessCtx,
  eventId: Id<'events'>,
): Promise<{user: Doc<'users'>; event: Doc<'events'>}> {
  const user = await requireUser(ctx);
  const event = await loadEventOrThrow(ctx, eventId);
  await requireViewEventRoster(ctx, user._id, event);
  return {user, event};
}

// Internal query exports (for cross-function permission checks)

export const _isEventAdmin = internalQuery({
  args: {userId: v.id('users'), eventId: v.id('events')},
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get('events', args.eventId);
    if (!event) return false;
    return canManageEvent(ctx, args.userId, event);
  },
});

export const _isRootAdmin = internalQuery({
  args: {userId: v.id('users')},
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return isPlatformAdmin(ctx, args.userId);
  },
});

export const _isCommunityAdminOrRoot = internalQuery({
  args: {userId: v.id('users'), organizerId: v.id('organizers')},
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return canManageCommunity(ctx, args.userId, args.organizerId);
  },
});
