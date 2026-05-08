/// <reference types="vite/client" />
import {ConvexError} from 'convex/values';
import type {CommunityPublicationStatus} from '@shared/domain/community-publication-status';
import type {EventStatus} from '@shared/domain/event-status';
import type {EventVisibility} from '@shared/domain/event-visibility';
import {beforeEach, describe, expect, it} from 'vitest';
import {api} from '../_generated/api';
import type {Doc, Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';
import {addMember, addTrustLink, authz, authzUserId} from './authz';
import type {CallerIdentity} from './caller_identity';
import {canPurchaseEvent, requireEventPurchase} from './access/purchase';

let userCounter = 0;

async function createUser(
  t: ReturnType<typeof convexTest>,
  name: string,
): Promise<Id<'users'>> {
  userCounter += 1;
  return t.mutation(api.testing.users.createUserDirectly, {
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}.${userCounter}@test.example`,
  });
}

async function createOrganizer(
  t: ReturnType<typeof convexTest>,
  name: string,
  options: {
    withVetting?: boolean;
    status?: CommunityPublicationStatus;
    isPublicDirectory?: boolean;
  } = {},
): Promise<Id<'organizers'>> {
  if (options.withVetting === false) {
    return t.mutation(api.testing.communities.seedOrganizerNoVetting, {name});
  }
  return t.mutation(api.testing.communities.seedOrganizer, {
    name,
    vettingQuestions: options.withVetting
      ? [
          {
            id: 'q1',
            question: 'Why join?',
            type: 'text' as const,
            required: true,
          },
        ]
      : undefined,
    status: options.status,
    isPublicDirectory: options.isPublicDirectory,
  });
}

async function createEvent(
  t: ReturnType<typeof convexTest>,
  organizerId: Id<'organizers'>,
  overrides: {
    visibility?: EventVisibility;
    status?: EventStatus;
  } = {},
): Promise<Id<'events'>> {
  return t.mutation(api.testing.events.seedEvent, {
    title: 'Test Event',
    organizerId,
    status: overrides.status ?? 'published',
    date: '2030-12-15',
    price: 1000,
    totalTickets: 100,
    visibility: overrides.visibility ?? 'private',
  });
}

async function loadEvent(
  t: ReturnType<typeof convexTest>,
  eventId: Id<'events'>,
): Promise<Doc<'events'>> {
  return t.run(async (ctx) => {
    const event = await ctx.db.get('events', eventId);
    if (!event) throw new Error('Expected seeded event');
    return event;
  });
}

async function assignRootAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, authzUserId(userId), 'root_admin');
  });
}

async function assignMember(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await addMember(ctx, userId, organizerId);
  });
}

function userIdentity(userId: Id<'users'>): CallerIdentity {
  return {type: 'user', userId, email: 'test@example.com'};
}

function guestIdentity(): CallerIdentity {
  return {
    type: 'guest',
    guestSessionId: 'placeholder_guest_session_id' as Id<'guest_sessions'>,
    email: 'guest@example.com',
    guestOwnerKey: 'guest-owner-key',
  };
}

beforeEach(() => {
  process.env['IS_TEST'] = 'true';
});

describe('canPurchaseEvent', () => {
  it('guest CAN purchase open-access event', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Org', {withVetting: true});
    const eventId = await createEvent(t, orgId, {visibility: 'public'});
    const event = await loadEvent(t, eventId);

    const result = await t.run((ctx) =>
      canPurchaseEvent(ctx, guestIdentity(), event),
    );
    expect(result).toEqual({allowed: true, source: 'open_access'});
  });

  it('guest CANNOT purchase private event from organizer without vetting questions', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Org', {withVetting: false});
    const eventId = await createEvent(t, orgId, {visibility: 'private'});
    const event = await loadEvent(t, eventId);

    const result = await t.run((ctx) =>
      canPurchaseEvent(ctx, guestIdentity(), event),
    );
    expect(result).toEqual({allowed: false});
  });

  it('guest CANNOT purchase private vetted event', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Org', {withVetting: true});
    const eventId = await createEvent(t, orgId, {visibility: 'private'});
    const event = await loadEvent(t, eventId);

    const result = await t.run((ctx) =>
      canPurchaseEvent(ctx, guestIdentity(), event),
    );
    expect(result).toEqual({allowed: false});
  });

  it('guest CANNOT purchase public_viewable event', async () => {
    const t = convexTest();
    const orgId = await createOrganizer(t, 'Org', {withVetting: true});
    const eventId = await createEvent(t, orgId, {
      visibility: 'public_viewable',
    });
    const event = await loadEvent(t, eventId);

    const result = await t.run((ctx) =>
      canPurchaseEvent(ctx, guestIdentity(), event),
    );
    expect(result).toEqual({allowed: false});
  });

  it('member CAN purchase private vetted event (direct)', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const orgId = await createOrganizer(t, 'Org', {withVetting: true});
    await assignMember(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {visibility: 'private'});
    const event = await loadEvent(t, eventId);

    const result = await t.run((ctx) =>
      canPurchaseEvent(ctx, userIdentity(userId), event),
    );
    expect(result).toEqual({allowed: true, source: 'direct'});
  });

  it('member CAN purchase public_viewable event (direct)', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const orgId = await createOrganizer(t, 'Org', {withVetting: true});
    await assignMember(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {
      visibility: 'public_viewable',
    });
    const event = await loadEvent(t, eventId);

    const result = await t.run((ctx) =>
      canPurchaseEvent(ctx, userIdentity(userId), event),
    );
    expect(result).toEqual({allowed: true, source: 'direct'});
  });

  it('trusted member CAN purchase via shared access with viaOrganizerId', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Trusted Member');
    const trustingOrgId = await createOrganizer(t, 'Trusting Org', {
      withVetting: true,
    });
    const trustedOrgId = await createOrganizer(t, 'Trusted Org', {
      withVetting: true,
    });

    await assignMember(t, userId, trustedOrgId);
    await t.run(async (ctx) => {
      await addTrustLink(ctx, trustingOrgId, trustedOrgId);
    });

    const eventId = await createEvent(t, trustingOrgId, {
      visibility: 'private',
    });
    const event = await loadEvent(t, eventId);

    const result = await t.run((ctx) =>
      canPurchaseEvent(ctx, userIdentity(userId), event),
    );
    expect(result).toEqual({
      allowed: true,
      source: 'shared',
      viaOrganizerId: trustedOrgId,
    });
  });

  it('non-member CANNOT purchase private vetted event', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Outsider');
    const orgId = await createOrganizer(t, 'Org', {withVetting: true});
    const eventId = await createEvent(t, orgId, {visibility: 'private'});
    const event = await loadEvent(t, eventId);

    const result = await t.run((ctx) =>
      canPurchaseEvent(ctx, userIdentity(userId), event),
    );
    expect(result).toEqual({allowed: false});
  });

  it('two-hop trust does NOT grant purchase access', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Chain Member');
    const orgA = await createOrganizer(t, 'Org A', {withVetting: true});
    const orgB = await createOrganizer(t, 'Org B', {withVetting: true});
    const orgC = await createOrganizer(t, 'Org C', {withVetting: true});

    await assignMember(t, userId, orgC);
    await t.run(async (ctx) => {
      await addTrustLink(ctx, orgA, orgB);
      await addTrustLink(ctx, orgB, orgC);
    });

    const eventId = await createEvent(t, orgA, {visibility: 'private'});
    const event = await loadEvent(t, eventId);

    const result = await t.run((ctx) =>
      canPurchaseEvent(ctx, userIdentity(userId), event),
    );
    expect(result).toEqual({allowed: false});
  });

  it('root admin CAN purchase private vetted event (direct via global fallback)', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Root');
    const orgId = await createOrganizer(t, 'Org', {withVetting: true});
    await assignRootAdmin(t, userId);
    const eventId = await createEvent(t, orgId, {visibility: 'private'});
    const event = await loadEvent(t, eventId);

    const result = await t.run((ctx) =>
      canPurchaseEvent(ctx, userIdentity(userId), event),
    );
    expect(result).toEqual({allowed: true, source: 'direct'});
  });
});

describe('requireEventPurchase', () => {
  it('throws on denial', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Outsider');
    const orgId = await createOrganizer(t, 'Org', {withVetting: true});
    const eventId = await createEvent(t, orgId, {visibility: 'private'});
    const event = await loadEvent(t, eventId);

    await expect(
      t.run((ctx) => requireEventPurchase(ctx, userIdentity(userId), event)),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  it('returns PurchaseAccessGranted on success', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'Member');
    const orgId = await createOrganizer(t, 'Org', {withVetting: true});
    await assignMember(t, userId, orgId);
    const eventId = await createEvent(t, orgId, {visibility: 'private'});
    const event = await loadEvent(t, eventId);

    const result = await t.run((ctx) =>
      requireEventPurchase(ctx, userIdentity(userId), event),
    );
    expect(result.allowed).toBe(true);
    expect(result.source).toBe('direct');
  });
});
