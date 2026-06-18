import type {Doc, Id} from '../../_generated/dataModel';
import {EVENT_VISIBILITY} from '@shared/domain/event-visibility';
import type {CallerIdentity} from '../caller_identity';
import {
  authz,
  authzUserId,
  listOneHopSharedAccessOrganizers,
  organizerScope,
} from '../authz';
import {throwUnauthorized} from '../errors';
import {type AccessCtx, canWithFallback} from './permissions';

export type PurchaseAccess =
  | {allowed: true; source: 'open_access'}
  | {allowed: true; source: 'direct'}
  | {allowed: true; source: 'shared'; viaOrganizerId: Id<'organizers'>}
  | {allowed: false};

export type PurchaseAccessGranted = Extract<PurchaseAccess, {allowed: true}>;

/**
 * True for `'public'` events only.
 * Used in purchase flows to bypass the community vetting gate.
 */
export function isOpenAccess(event: Doc<'events'>): boolean {
  return event.visibility === EVENT_VISIBILITY.PUBLIC;
}

/**
 * Whether a caller can purchase tickets for an event.
 *
 * Resolution order:
 * 1. Public events (visibility=public) -> open_access
 * 2. Guest callers cannot purchase gated events -> denied
 * 3. Direct membership/role in the event's organizer -> direct
 * 4. Membership in a one-hop trusted organizer -> shared
 * 5. Otherwise -> denied
 */
export async function canPurchaseEvent(
  ctx: AccessCtx,
  identity: CallerIdentity,
  event: Doc<'events'>,
): Promise<PurchaseAccess> {
  return canPurchaseEventForUser(
    ctx,
    identity.type === 'user' ? identity.userId : null,
    event,
  );
}

/**
 * Whether the current user-or-guest caller can purchase tickets for an event.
 *
 * Use this from read-model queries that only have an optional authenticated
 * user id. Mutations/actions that already resolved a full CallerIdentity should
 * call `canPurchaseEvent`.
 */
export async function canPurchaseEventForUser(
  ctx: AccessCtx,
  userId: Id<'users'> | null,
  event: Doc<'events'>,
): Promise<PurchaseAccess> {
  if (isOpenAccess(event)) {
    return {allowed: true, source: 'open_access'};
  }

  if (userId === null) {
    return {allowed: false};
  }

  return resolvePurchaseAccessForUser(ctx, userId, event.organizerId);
}

/**
 * Resolve purchase access for an authenticated user against an organizer.
 *
 * This is the core trust-ladder resolution shared by `canPurchaseEvent` after
 * open-access and guest checks, and by trust-link read models.
 */
export async function resolvePurchaseAccessForUser(
  ctx: AccessCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<PurchaseAccess> {
  if (
    await canWithFallback(
      ctx,
      authzUserId(userId),
      'event:purchase',
      organizerScope(organizerId),
    )
  ) {
    return {allowed: true, source: 'direct'};
  }

  const trustedOrganizers = await listOneHopSharedAccessOrganizers(
    ctx,
    organizerId,
  );
  for (const trustedOrg of trustedOrganizers) {
    if (
      await canWithFallback(
        ctx,
        authzUserId(userId),
        'event:purchase',
        organizerScope(trustedOrg._id),
      )
    ) {
      return {allowed: true, source: 'shared', viaOrganizerId: trustedOrg._id};
    }
  }

  return {allowed: false};
}

/**
 * Resolve whether a user may receive a holder-to-holder ticket transfer for
 * an event in this organizer. Unlike purchase access, this intentionally does
 * not grant open-access/public-event or root-admin fallback: recipients must
 * already be directly or trust-linked vetted for the community.
 */
export async function canReceiveTicketTransferForUser(
  ctx: AccessCtx,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<
  Extract<PurchaseAccess, {source: 'direct' | 'shared'}> | {allowed: false}
> {
  if (
    await authz.can(
      ctx,
      authzUserId(userId),
      'event:purchase',
      organizerScope(organizerId),
    )
  ) {
    return {allowed: true, source: 'direct'};
  }

  const trustedOrganizers = await listOneHopSharedAccessOrganizers(
    ctx,
    organizerId,
  );
  for (const trustedOrg of trustedOrganizers) {
    if (
      await authz.can(
        ctx,
        authzUserId(userId),
        'event:purchase',
        organizerScope(trustedOrg._id),
      )
    ) {
      return {allowed: true, source: 'shared', viaOrganizerId: trustedOrg._id};
    }
  }

  return {allowed: false};
}

/**
 * Require purchase access and return the granted access details.
 * Throws on denial.
 */
export async function requireEventPurchase(
  ctx: AccessCtx,
  identity: CallerIdentity,
  event: Doc<'events'>,
): Promise<PurchaseAccessGranted> {
  const access = await canPurchaseEvent(ctx, identity, event);
  if (!access.allowed) {
    throwUnauthorized();
  }
  return access;
}
