import {describe, expect, it} from 'vitest';
import type {Id} from '../../_generated/dataModel';
import {buildBroadcastAudienceFromSources} from './broadcasts';

describe('buildBroadcastAudienceFromSources', () => {
  it('stops scanning once the capped unique recipient threshold is reached', async () => {
    let yieldedTickets = 0;
    let yieldedGuests = 0;

    const tickets = (async function* () {
      for (let index = 0; index < 1000; index += 1) {
        yieldedTickets += 1;
        yield {userId: `user-${index}` as Id<'users'>};
      }
    })();

    const guests = (async function* () {
      yieldedGuests += 1;
      yield {email: 'guest@example.com'};
    })();

    const audience = await buildBroadcastAudienceFromSources({
      tickets,
      guests,
      getUser: async (userId) => ({email: `${userId}@example.com`}),
      stopAfterRecipientCount: 501,
    });

    expect(audience.recipientCount).toBe(501);
    expect(audience.isComplete).toBe(false);
    expect(yieldedTickets).toBe(501);
    expect(yieldedGuests).toBe(0);
  });

  it('counts the full deduplicated audience when no cap is applied', async () => {
    const tickets = (async function* () {
      yield {userId: 'user-1' as Id<'users'>};
      yield {userId: 'user-1' as Id<'users'>};
      yield {userId: 'user-2' as Id<'users'>};
    })();

    const guests = (async function* () {
      yield {email: 'USER-2@example.com'};
      yield {email: 'guest@example.com'};
      yield {email: undefined};
    })();

    const audience = await buildBroadcastAudienceFromSources({
      tickets,
      guests,
      getUser: async (userId) =>
        userId === ('user-1' as Id<'users'>)
          ? {email: 'user-1@example.com'}
          : {email: 'user-2@example.com', globalMarketingOptOut: true},
    });

    expect(audience.recipientCount).toBe(3);
    expect(audience.isComplete).toBe(true);
    expect(audience.recipients).toEqual([
      {
        email: 'user-1@example.com',
        userId: 'user-1' as Id<'users'>,
        userGlobalOptOut: false,
      },
      {
        email: 'user-2@example.com',
        userId: 'user-2' as Id<'users'>,
        userGlobalOptOut: true,
      },
      {email: 'guest@example.com'},
    ]);
  });

  it('includes guest-session ticket owners and deduplicates them by email', async () => {
    const tickets = (async function* () {
      yield {guestSessionId: 'session-1' as Id<'guest_sessions'>};
      yield {guestSessionId: 'session-2' as Id<'guest_sessions'>};
      yield {userId: 'user-1' as Id<'users'>};
    })();

    const guests = (async function* () {
      yield {email: 'guest-owner@example.com'};
    })();

    const audience = await buildBroadcastAudienceFromSources({
      tickets,
      guests,
      getUser: async () => ({email: 'user@example.com'}),
      getGuestSessionEmail: async (guestSessionId) =>
        guestSessionId === ('session-1' as Id<'guest_sessions'>)
          ? 'guest-owner@example.com'
          : 'other-guest-owner@example.com',
    });

    expect(audience.recipientCount).toBe(3);
    expect(audience.isComplete).toBe(true);
    expect(audience.recipients).toEqual([
      {email: 'guest-owner@example.com'},
      {email: 'other-guest-owner@example.com'},
      {
        email: 'user@example.com',
        userId: 'user-1' as Id<'users'>,
        userGlobalOptOut: false,
      },
    ]);
  });
});
